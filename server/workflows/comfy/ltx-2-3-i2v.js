/**
 * ltx-2-3-i2v.js
 *
 * Pre-processor for ltx-2-3-i2v (LTX Video Image-to-Video) workflow.
 * Supports workflow variables via _meta.title placeholders:
 *   - $prompt
 *   - $width.value
 *   - $height.value
 *   - $length.value
 *   - $frame_rate.value
 *   - $image
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COMFY_INPUT_DIR = process.env.COMFYUI_INPUT_DIR || 'Z:\\input';

const RESOLUTION_HEIGHT_MAP = {
    '720p': 720,
    '1080p': 1080,
};

const ASPECT_RATIO_MAP = {
    '16:9': { w: 16, h: 9 },
    '9:16': { w: 9, h: 16 },
};

async function getImageDimensions(dataUrl) {
    if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;

    try {
        const match = dataUrl.match(/^data:image\/\w+;base64,(.+)$/);
        if (!match) return null;
        const buffer = Buffer.from(match[1], 'base64');

        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
            return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
        }

        if (buffer[0] === 0xff && buffer[1] === 0xd8) {
            let i = 2;
            while (i < buffer.length - 1) {
                if (buffer[i] !== 0xff) {
                    i++;
                    continue;
                }
                const marker = buffer[i + 1];
                if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)) {
                    return {
                        height: buffer.readUInt16BE(i + 5),
                        width: buffer.readUInt16BE(i + 7),
                    };
                }
                i += 2 + buffer.readUInt16BE(i + 2);
            }
        }

        if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
            if (buffer.toString('ascii', 12, 16) === 'VP8 ' && buffer[16] === 0x9d && buffer[17] === 0x01 && buffer[18] === 0x2a) {
                return {
                    width: buffer.readUInt16LE(26) & 0x3fff,
                    height: buffer.readUInt16LE(28) & 0x3fff,
                };
            }
            if (buffer.toString('ascii', 12, 16) === 'VP8L') {
                const bits = buffer.readUInt32LE(21);
                return {
                    width: (bits & 0x3fff) + 1,
                    height: ((bits >> 14) & 0x3fff) + 1,
                };
            }
        }

        return null;
    } catch {
        return null;
    }
}

function sanitizePrefix(value, fallback = 'ltx_src') {
    const s = String(value || '').trim();
    if (!s) return fallback;
    return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || fallback;
}

function saveImageToInputDir(dataUrl, prefix = 'ltx_img') {
    if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;

    const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) return null;

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const base64 = match[2];
    const name = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${ext}`;
    const filePath = path.join(COMFY_INPUT_DIR, name);

    try {
        fs.mkdirSync(COMFY_INPUT_DIR, { recursive: true });
        fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
        return fs.existsSync(filePath) ? filePath : null;
    } catch {
        return null;
    }
}

function roundToMultipleOf32(value) {
    return Math.max(32, Math.round(value / 32) * 32);
}

function resolveTargetSize({ aspectRatio, resolution, imageDims }) {
    const shouldUseImageSize = (aspectRatio === 'Auto' || resolution === 'Auto') && imageDims?.width && imageDims?.height;

    if (shouldUseImageSize) {
        return {
            width: roundToMultipleOf32(imageDims.width),
            height: roundToMultipleOf32(imageDims.height),
        };
    }

    const ratio = ASPECT_RATIO_MAP[aspectRatio] || ASPECT_RATIO_MAP['16:9'];
    const targetHeight = RESOLUTION_HEIGHT_MAP[resolution] || 720;
    const targetWidth = Math.round((targetHeight * ratio.w) / ratio.h);

    return {
        width: roundToMultipleOf32(targetWidth),
        height: roundToMultipleOf32(targetHeight),
    };
}

function setNodeInputByTitle(workflow, title, key, value) {
    for (const [, node] of Object.entries(workflow || {})) {
        if (!node || typeof node !== 'object') continue;
        const nodeTitle = node._meta?.title || '';
        if (nodeTitle === title && node.inputs && key in node.inputs) {
            node.inputs[key] = value;
            return true;
        }
    }
    return false;
}

export async function inject(workflow, params) {
    const {
        prompt = '',
        duration = 5,
        fps = 30,
        aspectRatio = '16:9',
        resolution = 'Auto',
        imageBase64 = null,
        seed = null,
        nodeId = null,
    } = params;

    const imageDims = await getImageDimensions(imageBase64);
    const targetSize = resolveTargetSize({ aspectRatio, resolution, imageDims });

    if (imageBase64) {
        const imagePrefix = sanitizePrefix(nodeId || 'ltx_src', 'ltx_src');
        const imagePath = saveImageToInputDir(imageBase64, imagePrefix);
        if (imagePath) {
            setNodeInputByTitle(workflow, '$image', 'image', imagePath);
        }
    }

    setNodeInputByTitle(workflow, '$width.value', 'value', targetSize.width);
    setNodeInputByTitle(workflow, '$height.value', 'value', targetSize.height);
    setNodeInputByTitle(workflow, '$duration.value', 'value', duration);
    setNodeInputByTitle(workflow, '$fps.value', 'value', fps);

    for (const [, node] of Object.entries(workflow || {})) {
        if (!node || typeof node !== 'object') continue;
        const title = node._meta?.title || '';

        if (title === '$prompt' && node.inputs && 'value' in node.inputs) {
            node.inputs.value = prompt;
        }

        if (node.class_type === 'RandomNoise' && 'noise_seed' in (node.inputs || {})) {
            node.inputs.noise_seed = seed !== null ? seed : Math.floor(Math.random() * 1e18);
        }
    }


    return workflow;
}
