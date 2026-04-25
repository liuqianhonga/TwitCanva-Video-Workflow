/**
 * flux2-klein-image-edit.js
 *
 * Pre-processor for flux2-klein-image-edit workflow.
 * Handles:
 *   - Variable injection via _meta.title (width, height, prompt)
 *   - LoadImage node injection (3 images: nodes 76, 81, 698)
 *   - Conditional chain disabling: if fewer than 3 images provided,
 *     the extra chains are disabled via _disabled + placeholder image
 *   - KSampler seed randomisation
 *
 * Image chain architecture:
 *   Node 76  → chain 1 (always active with any image)
 *   Node 81  → chain 2 (active with 2+ images)
 *   Node 698 → chain 3 (active with 3 images)
 * CFGGuider positive ← chain result via ReferenceLatent chain
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Remote ComfyUI deployment ─────────────────────────────────────────────────
// COMFYUI_INPUT_DIR: local writable directory on the backend server where
//   images are saved before being served over HTTP.
//   Example: /tmp/comfyui-input  or  D:\comfyui_input
// COMFYUI_INPUT_URL_BASE: HTTP URL where ComfyUI fetches images.
//   Must be the externally accessible URL of the backend's /comfyui-input route.
//   Example: http://your-server:3001/comfyui-input
//   ComfyUI needs a custom LoadImageFromURL node to load via HTTP.
// Both variables are required for remote deployment.
const COMFY_INPUT_DIR = process.env.COMFYUI_INPUT_DIR;
const COMFY_INPUT_URL_BASE = process.env.COMFYUI_INPUT_URL_BASE;

if (!COMFY_INPUT_DIR || !COMFY_INPUT_URL_BASE) {
    throw new Error(`[flux2-klein] COMFYUI_INPUT_DIR and COMFYUI_INPUT_URL_BASE must both be set for remote deployment. ` +
        `COMFYUI_INPUT_DIR=${COMFY_INPUT_DIR}, COMFYUI_INPUT_URL_BASE=${COMFY_INPUT_URL_BASE}`);
}

const LATENT_SIZE_MAP = {
    '1:1':  { width: 1024, height: 1024 },
    '16:9': { width: 1344, height: 768  },
    '9:16': { width: 768,  height: 1344 },
    '4:3':  { width: 1152, height: 896  },
    '3:2':  { width: 1216, height: 832  },
    '2:3':  { width: 832,  height: 1216 },
};

function saveBase64Image(dataUrl, prefix = 'ref') {
    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
        console.warn(`[flux2-klein] saveBase64Image: invalid dataUrl type=${typeof dataUrl}`);
        return null;
    }
    const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) {
        console.warn(`[flux2-klein] saveBase64Image: regex mismatch`);
        return null;
    }
    const ext    = match[1] === 'jpeg' ? 'jpg' : match[1];
    const base64 = match[2];
    const name   = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${ext}`;
    const filePath = path.join(COMFY_INPUT_DIR, name);

    try {
        fs.mkdirSync(COMFY_INPUT_DIR, { recursive: true });
        fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
        if (!fs.existsSync(filePath)) {
            console.error(`[flux2-klein] writeFileSync succeeded but file missing: ${filePath}`);
            return null;
        }
        console.log(`[flux2-klein] Saved: ${filePath} (${fs.statSync(filePath).size} bytes)`);

        // Return URL or filename based on deployment mode
        if (COMFY_INPUT_URL_BASE) {
            return `${COMFY_INPUT_URL_BASE}/${name}`;
        }
        return name;
    } catch (err) {
        console.error(`[flux2-klein] Failed to save image: ${err.message}`);
        return null;
    }
}

export function inject(workflow, params) {
    const {
        prompt      = '',
        negativePrompt = '',
        aspectRatio = '1:1',
        seed        = null,
        imageBase64Array = [],
    } = params;

    console.log(`[flux2-klein] inject called: imageBase64Array.length=${imageBase64Array?.length}, type=${typeof imageBase64Array}, isArray=${Array.isArray(imageBase64Array)}`);
    if (imageBase64Array?.length > 0) {
        console.log(`[flux2-klein] image[0] type=${typeof imageBase64Array[0]}, prefix=${String(imageBase64Array[0]).slice(0, 60)}`);
    }

    const { width, height } = LATENT_SIZE_MAP[String(aspectRatio)] || LATENT_SIZE_MAP['1:1'];

    // Collect LoadImage nodes in the order they appear (node ID numeric order)
    const loadImageNodes = Object.entries(workflow || {})
        .filter(([, n]) =>
            n &&
            typeof n === 'object' &&
            n.class_type === 'LoadImage' &&
            n.inputs?.image
        )
        .sort(([a], [b]) => Number(a) - Number(b));

    // ── Inject images into LoadImage nodes ───────────────────────────────────
    // Chain mapping (from workflow analysis):
    //   Node 76  → chain 1: 76 → 130 → 134:117 → 134:116 → 134:118 → 132:121 → 703:702
    //   Node 81  → chain 2: 81 → 131 → 132:120 → 132:119 → 132:121 → 703:702
    //   Node 698 → chain 3: 698 → 699 → 703:701 → 703:700 → 703:702
    // CFGGuider positive ← 703:702, negative ← 703:700
    // All 3 chains must be valid (or properly disabled) for the sampler to run.
    const count = imageBase64Array?.length || 0;

    const chain1Only  = new Set(['130', '134:117', '134:116', '134:118']);  // always active with any image
    const chain2All  = new Set(['81',  '131',  '132:120', '132:119', '132:121']);  // needs 2+ images
    const chain3All  = new Set(['698', '699',  '703:701', '703:700', '703:702']);  // needs 3 images

    // Determine which nodes to disable
    for (const [id, node] of Object.entries(workflow || {})) {
        if (!node || typeof node !== 'object' || !node.class_type) continue;
        const imgIdx = loadImageNodes.findIndex(([nid]) => nid === id);

        if (imgIdx >= 0) {
            // It's a LoadImage node
            if (imgIdx < count) {
                const dataUrl = imageBase64Array[imgIdx];
                const filename = saveBase64Image(dataUrl, `img${imgIdx + 1}`);
                if (filename) {
                    node.inputs.image = filename;
                    node._disabled = false;
                    console.log(`[flux2-klein] LoadImage ${id} → ${filename}`);
                }
            } else {
                // Not enough images — save a tiny 1x1 transparent PNG as placeholder
                // This prevents "invalid file" errors while _disabled=true still
                // causes the node to produce empty output, which downstream handles.
                const placeholder = saveBase64Image(
                    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
                    `placeholder${imgIdx + 1}`
                );
                if (placeholder) {
                    node.inputs.image = placeholder;
                    node._disabled = true;
                    console.log(`[flux2-klein] LoadImage ${id} → placeholder: ${placeholder} (disabled)`);
                }
            }
        } else if (count < 2 && chain2All.has(id)) {
            node._disabled = true;
            console.log(`[flux2-klein] Node ${id} (chain2) → disabled`);
        } else if (count < 3 && chain3All.has(id)) {
            node._disabled = true;
            console.log(`[flux2-klein] Node ${id} (chain3) → disabled`);
        }
    }

    // ── Inject _meta.title variables ─────────────────────────────────────────
    for (const [id, node] of Object.entries(workflow || {})) {
        if (!node || typeof node !== 'object') continue;
        const title = node._meta?.title || '';

        if (title === 'width') {
            node.inputs.value = width;
            console.log(`[flux2-klein] width → ${width}`);
        }
        if (title === 'height') {
            node.inputs.value = height;
            console.log(`[flux2-klein] height → ${height}`);
        }
        if (title === 'prompt') {
            node.inputs.string = prompt;
            console.log(`[flux2-klein] prompt → ${prompt.length} chars`);
        }

        // KSampler seed
        if (node.class_type === 'KSampler' && 'seed' in (node.inputs || {})) {
            node.inputs.seed = seed !== null ? seed : Math.floor(Math.random() * 1e18);
        }
    }

    return workflow;
}
