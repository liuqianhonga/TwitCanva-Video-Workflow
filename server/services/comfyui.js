/**
 * comfyui.js
 *
 * ComfyUI API service for remote workflow execution.
 * Supports two modes:
 *   1. workflow_id + inputs  (ComfyUI-Manager style, legacy)
 *   2. workflow file + dynamic injection  (config-driven, preferred)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_POLL_INTERVAL_MS = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Workflow file cache to avoid repeated disk reads
const workflowCache = new Map();

function getComfyHeaders(apiKey, includeContentType = false) {
    const headers = {};
    if (includeContentType) {
        headers['Content-Type'] = 'application/json';
    }
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
        headers['X-API-Key'] = apiKey;
    }
    return headers;
}

function normalizeBaseUrl(baseUrl) {
    if (!baseUrl) throw new Error('COMFYUI_BASE_URL not configured');
    return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function withTimeout(ms) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ms);
    return { controller, timeout };
}

async function safeJson(response) {
    const text = await response.text();
    if (!text || text === 'null') {
        return { _raw: text || '(empty)' };
    }
    try {
        return JSON.parse(text);
    } catch {
        return { _raw: text };
    }
}

function fmtError(data, statusText) {
    if (!data || typeof data !== 'object') {
        return statusText;
    }
    if (data?.error !== undefined) {
        return typeof data.error === 'string'
            ? data.error
            : JSON.stringify(data.error);
    }
    if (data?.message !== undefined) {
        return typeof data.message === 'string'
            ? data.message
            : JSON.stringify(data.message);
    }
    return statusText;
}

function getPromptEntry(history, promptId) {
    if (!history) return null;
    if (history[promptId]) return history[promptId];
    if (history.prompt_id === promptId) return history;
    return null;
}

function detectAssetKind(item) {
    const text = [
        item?.filename || '',
        item?.url || '',
        item?.format || '',
        item?.mime || '',
        item?.content_type || '',
        item?.type || '',
    ].join(' ').toLowerCase();

    if (/\.(mp4|webm|mov|mkv|avi|gif)(\?|$)/.test(text) || text.includes('video/') || text.includes('h264') || text.includes('h265')) {
        return 'video';
    }
    if (/\.(png|jpg|jpeg|webp|bmp|svg)(\?|$)/.test(text) || text.includes('image/')) {
        return 'image';
    }
    return 'unknown';
}

function collectAssetItems(value, out = []) {
    if (Array.isArray(value)) {
        for (const item of value) {
            collectAssetItems(item, out);
        }
        return out;
    }

    if (!value || typeof value !== 'object') {
        return out;
    }

    if (value.filename || value.url) {
        out.push(value);
    }

    for (const v of Object.values(value)) {
        if (v && typeof v === 'object') {
            collectAssetItems(v, out);
        }
    }

    return out;
}

function collectOutputAssets(outputs, mode) {
    if (!outputs || typeof outputs !== 'object') return [];

    const assets = [];
    const seen = new Set();

    for (const nodeOutput of Object.values(outputs)) {
        if (!nodeOutput || typeof nodeOutput !== 'object') continue;

        const items = collectAssetItems(nodeOutput);
        for (const item of items) {
            if (!item || (!item.filename && !item.url)) continue;

            const key = `${item.filename || ''}::${item.url || ''}`;
            if (seen.has(key)) continue;

            const kind = detectAssetKind(item);
            if (mode === 'video' && kind === 'image') continue;
            if (mode === 'image' && kind === 'video') continue;

            seen.add(key);
            assets.push(item);
        }
    }

    return assets;
}


function buildViewUrl(baseUrl, asset) {
    if (asset.url) {
        try {
            return new URL(asset.url, baseUrl).toString();
        } catch {
            return asset.url;
        }
    }

    const viewUrl = new URL('/view', baseUrl);
    viewUrl.searchParams.set('filename', asset.filename);
    if (asset.subfolder) viewUrl.searchParams.set('subfolder', asset.subfolder);
    if (asset.type) viewUrl.searchParams.set('type', asset.type);
    return viewUrl.toString();
}

function detectFileExtension(asset, contentType, fallback) {
    if (asset?.filename?.includes('.')) {
        return asset.filename.split('.').pop().toLowerCase();
    }

    if (contentType) {
        if (contentType.includes('image/png')) return 'png';
        if (contentType.includes('image/jpeg')) return 'jpg';
        if (contentType.includes('image/webp')) return 'webp';
        if (contentType.includes('video/mp4')) return 'mp4';
        if (contentType.includes('video/webm')) return 'webm';
    }

    return fallback;
}

// ── Workflow file loader & injector ─────────────────────────────────────────

/**
 * Load a ComfyUI workflow JSON file (with caching).
 * @param {string} filePath - Absolute path to workflow JSON
 * @returns {object} Parsed workflow object
 */
function loadWorkflowTemplate(filePath) {
    if (workflowCache.has(filePath)) {
        return workflowCache.get(filePath);
    }

    if (!fs.existsSync(filePath)) {
        throw new Error(`ComfyUI workflow file not found: ${filePath}`);
    }

    const workflow = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    workflowCache.set(filePath, workflow);
    console.log(`[ComfyUI] Loaded workflow: ${path.basename(filePath)}`);
    return workflow;
}

/**
 * Built-in generic injector — handles standard _meta.title variable nodes
 * and KSampler seed randomisation.
 *
 * Variable naming convention (from ComfyUI Manager export):
 *   "$width.value"   → Int node → set inputs.value
 *   "$height.value"  → Int node → set inputs.value
 *   "$prompt.text!"  → Text node → set inputs.text
 *   KSampler seeds   → randomise or set seed
 *
 * @param {object} workflow - Already-loaded workflow JSON object (deep copy)
 * @param {object} params   - { prompt, negativePrompt, aspectRatio, seed, imageBase64Array }
 * @returns {object} The workflow object (mutated in-place for performance)
 */
function injectWorkflow(workflow, params) {
    const {
        prompt      = '',
        negativePrompt = '',
        aspectRatio = '1:1',
        seed        = null,
    } = params;

    const sizeMap = {
        '1:1':  { width: 1024, height: 1024 },
        '16:9': { width: 1344, height: 768 },
        '9:16': { width: 768,  height: 1344 },
        '4:3':  { width: 1152, height: 896 },
        '3:4':  { width: 896,  height: 1152 },
        '3:2':  { width: 1216, height: 832 },
        '2:3':  { width: 832,  height: 1216 },
        '5:4':  { width: 1152, height: 896 },
        '4:5':  { width: 896,  height: 1152 },
        '21:9': { width: 1536, height: 640 },
    };

    const parseAspectRatioValue = (value) => {
        if (!value) return null;
        const normalized = String(value).trim().toLowerCase();
        if (!normalized || normalized === 'auto') return null;

        const parsePair = (w, h) => {
            const width = Number(w);
            const height = Number(h);
            if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
                return null;
            }
            return width / height;
        };

        if (normalized.includes(':')) {
            const [w, h] = normalized.split(':');
            return parsePair(w, h);
        }
        if (normalized.includes('/')) {
            const [w, h] = normalized.split('/');
            return parsePair(w, h);
        }

        const ratio = Number(normalized);
        return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
    };

    const ratio = parseAspectRatioValue(aspectRatio);
    const fallbackSize = ratio
        ? {
            width: Math.max(64, Math.round(Math.sqrt(1024 * 1024 * ratio) / 64) * 64),
            height: Math.max(64, Math.round(Math.sqrt((1024 * 1024) / ratio) / 64) * 64),
        }
        : sizeMap['1:1'];

    const { width, height } = sizeMap[String(aspectRatio)] || fallbackSize;

    for (const [id, node] of Object.entries(workflow || {})) {
        // Skip internal keys like _meta that aren't actual nodes
        if (!node || typeof node !== 'object' || !node.class_type) continue;
        const title = node._meta?.title || '';

        // Width / Height Int nodes
        if (title === '$width.value') {
            node.inputs.value = width;
            console.log(`[ComfyUI] $width.value → ${width} (node ${id})`);
        }
        if (title === '$height.value') {
            node.inputs.value = height;
            console.log(`[ComfyUI] $height.value → ${height} (node ${id})`);
        }

        // Prompt Text nodes
        if (title === '$prompt.text!' || title === '$prompt') {
            node.inputs.text = prompt;
            console.log(`[ComfyUI] ${title} → ${prompt.length} chars (node ${id})`);
        }

        // KSampler seed
        if (node.class_type === 'KSampler' && 'seed' in (node.inputs || {})) {
            node.inputs.seed = seed !== null ? seed : Math.floor(Math.random() * 1e18);
            console.log(`[ComfyUI] KSampler seed → ${node.inputs.seed} (node ${id})`);
        }

        // Save / Preview output node
        if (
            node.class_type &&
            (node.class_type.endsWith('Save') || node.class_type.endsWith('Preview'))
        ) {
            workflow.output_node = id;
        }
    }

    return workflow;
}

// ── Legacy: ComfyUI-Manager-style submit ─────────────────────────────────────

async function submitComfyPrompt({ baseUrl, apiKey, workflowId, inputs, timeoutMs }) {
    const endpoint = `${normalizeBaseUrl(baseUrl)}/prompt`;
    const { controller, timeout } = withTimeout(timeoutMs);

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: getComfyHeaders(apiKey, true),
            body: JSON.stringify({ workflow_id: workflowId, inputs }),
            signal: controller.signal
        });

        const data = await safeJson(response);

        if (!response.ok) {
            const msg = fmtError(data, response.statusText);
            throw new Error(`ComfyUI submit failed: ${msg}`);
        }

        const promptId = data?.prompt_id || data?.promptId || data?.id;
        if (!promptId) throw new Error('ComfyUI submit response missing prompt_id');

        return promptId;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Submit a fully-formed ComfyUI workflow JSON to the /prompt endpoint.
 */
async function submitComfyWorkflow({ baseUrl, apiKey, workflow, timeoutMs }) {
    const endpoint = `${normalizeBaseUrl(baseUrl)}/prompt`;
    const { controller, timeout } = withTimeout(timeoutMs);

    try {
        // Strip _meta before sending to ComfyUI API (only numeric node IDs should be sent)
        const { _meta, ...nodeDefs } = workflow;
        const payload = { prompt: nodeDefs };
        console.log('[ComfyUI] Submitting workflow keys:', Object.keys(nodeDefs).filter(k => !k.startsWith('_')));
        console.log('[ComfyUI] Payload preview:', JSON.stringify(payload).slice(0, 500));

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: getComfyHeaders(apiKey, true),
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        const data = await safeJson(response);

        console.log('[ComfyUI] Response status:', response.status);
        console.log('[ComfyUI] Response body:', JSON.stringify(data).slice(0, 1000));

        if (!response.ok) {
            console.error('[ComfyUI] Error response data:', data, typeof data);
            const msg = fmtError(data, response.statusText);
            throw new Error(`ComfyUI submit failed: ${msg}`);
        }

        const promptId = data?.prompt_id || data?.promptId || data?.id;
        if (!promptId) throw new Error('ComfyUI submit response missing prompt_id');

        return promptId;
    } finally {
        clearTimeout(timeout);
    }
}

async function pollComfyHistory({ baseUrl, apiKey, promptId, timeoutMs, pollIntervalMs }) {
    const start = Date.now();
    const endpoint = `${normalizeBaseUrl(baseUrl)}/history/${promptId}`;

    while (Date.now() - start < timeoutMs) {
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: getComfyHeaders(apiKey)
        });

        const data = await safeJson(response);

        if (!response.ok) {
            const msg = data?.error || data?.message || response.statusText;
            throw new Error(`ComfyUI history failed: ${msg}`);
        }

        const entry = getPromptEntry(data, promptId);
        const statusStr = entry?.status?.status_str || entry?.status;

        if (statusStr === 'error' || statusStr === 'failed') {
            const errorMsg = entry?.status?.messages?.map(m => m?.[1]?.message).filter(Boolean).join('; ')
                || 'ComfyUI workflow failed';
            throw new Error(errorMsg);
        }

        if (entry?.outputs && Object.keys(entry.outputs).length > 0) {
            return entry.outputs;
        }

        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error('ComfyUI workflow timed out');
}

async function downloadComfyAsset({ baseUrl, apiKey, asset, fallbackExt }) {
    const assetUrl = buildViewUrl(normalizeBaseUrl(baseUrl), asset);
    const response = await fetch(assetUrl, {
        method: 'GET',
        headers: getComfyHeaders(apiKey)
    });

    if (!response.ok) {
        throw new Error(`Failed to download ComfyUI output: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const ext = detectFileExtension(asset, response.headers.get('content-type'), fallbackExt);

    return { buffer, ext };
}

async function runComfyWorkflow({ mode, workflowId, inputs, baseUrl, apiKey, timeoutMs, pollIntervalMs }) {
    const effectiveTimeout   = timeoutMs        || DEFAULT_TIMEOUT_MS;
    const effectivePoll      = pollIntervalMs   || DEFAULT_POLL_INTERVAL_MS;

    const promptId = await submitComfyPrompt({
        baseUrl, apiKey, workflowId, inputs, timeoutMs: effectiveTimeout
    });

    const outputs = await pollComfyHistory({
        baseUrl, apiKey, promptId,
        timeoutMs: effectiveTimeout, pollIntervalMs: effectivePoll
    });

    const assets = collectOutputAssets(outputs, mode);
    if (assets.length === 0) throw new Error(`ComfyUI returned no ${mode} output`);

    return downloadComfyAsset({
        baseUrl, apiKey, asset: assets[0],
        fallbackExt: mode === 'video' ? 'mp4' : 'png'
    });
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function generateComfyImage({
    prompt,
    imageBase64Array,
    aspectRatio,
    resolution,
    workflowId,
    workflowFile,
    workflowPreprocessor,  // optional custom pre-processor module path
    baseUrl,
    apiKey,
    timeoutMs,
    pollIntervalMs,
}) {
    if (!workflowId && !workflowFile) {
        throw new Error('ComfyUI image workflow not configured');
    }

    const effectiveTimeout = timeoutMs        || DEFAULT_TIMEOUT_MS;
    const effectivePoll    = pollIntervalMs   || DEFAULT_POLL_INTERVAL_MS;

    if (workflowFile) {
        // Load workflow JSON (no nodes wrapper — top-level keys are node IDs)
        const workflow = JSON.parse(JSON.stringify(loadWorkflowTemplate(workflowFile)));

        // Save original (before injection) for debug comparison
        const debugDir = path.join(process.cwd(), 'server', 'debug');
        fs.mkdirSync(debugDir, { recursive: true });
        const debugBefore = path.join(debugDir, `wf_before_${Date.now()}.json`);
        fs.writeFileSync(debugBefore, JSON.stringify(workflow, null, 2));
        console.log('[ComfyUI] Before-injection saved:', debugBefore);

        // Use custom pre-processor if configured, otherwise fall back to built-in injector
        if (workflowPreprocessor) {
            console.log('[ComfyUI] Using preprocessor:', workflowPreprocessor);
            const fileUrl = 'file:///' + workflowPreprocessor.replace(/\\/g, '/');
            console.log('[ComfyUI] fileUrl:', fileUrl);
            const mod = await import(fileUrl);
            console.log('[ComfyUI] mod.inject:', typeof mod.inject);
            mod.inject(workflow, { prompt, negativePrompt: '', aspectRatio, seed: null, imageBase64Array });
            console.log('[ComfyUI] After inject - node 104 value:', workflow['104']?.inputs?.value, 'node 111 text length:', workflow['111']?.inputs?.text?.length);
        } else {
            injectWorkflow(workflow, { prompt, negativePrompt: '', aspectRatio, imageBase64Array });
        }

        // Save after-injection for debug
        const debugAfter = path.join(debugDir, `wf_after_${Date.now()}.json`);
        fs.writeFileSync(debugAfter, JSON.stringify(workflow, null, 2));
        console.log('[ComfyUI] After-injection saved:', debugAfter);

        const outputNodeId = workflow.output_node ? String(workflow.output_node) : null;

        const promptId = await submitComfyWorkflow({
            baseUrl, apiKey, workflow, timeoutMs: effectiveTimeout
        });

        const outputs = await pollComfyHistory({
            baseUrl, apiKey, promptId,
            timeoutMs: effectiveTimeout, pollIntervalMs: effectivePoll
        });

        // Try specific output node first, then fall back to all outputs
        const assets = outputNodeId && outputs[outputNodeId]
            ? collectOutputAssets({ [outputNodeId]: outputs[outputNodeId] }, 'image')
            : collectOutputAssets(outputs, 'image');
        if (assets.length === 0) throw new Error('ComfyUI returned no image output');

        const { buffer, ext } = await downloadComfyAsset({
            baseUrl, apiKey, asset: assets[0], fallbackExt: 'png'
        });
        return { imageBuffer: buffer, imageFormat: ext };
    }

    // Legacy: ComfyUI-Manager workflow_id + inputs
    const inputs = {
        prompt: prompt || '',
        aspectRatio,
        resolution,
        referenceImages: imageBase64Array || [],
    };

    const { buffer, ext } = await runComfyWorkflow({
        mode: 'image', workflowId, inputs,
        baseUrl, apiKey, timeoutMs: effectiveTimeout, pollIntervalMs: effectivePoll
    });
    return { imageBuffer: buffer, imageFormat: ext };
}

export async function generateComfyVideo({
    prompt,
    imageBase64,
    lastFrameBase64,
    aspectRatio,
    resolution,
    duration,
    fps,
    videoMode,
    workflowId,
    workflowFile,
    workflowPreprocessor,
    nodeId,
    baseUrl,
    apiKey,
    timeoutMs,
    pollIntervalMs,
}) {
    if (!workflowId && !workflowFile) {
        throw new Error('ComfyUI video workflow not configured');
    }

    const effectiveTimeout = timeoutMs        || DEFAULT_TIMEOUT_MS;
    const effectivePoll    = pollIntervalMs   || DEFAULT_POLL_INTERVAL_MS;

    if (workflowFile) {
        // Load workflow JSON (no nodes wrapper — top-level keys are node IDs)
        const workflow = JSON.parse(JSON.stringify(loadWorkflowTemplate(workflowFile)));

        // Debug: save before/after with workflow name for easy identification
        const wfShortName = path.basename(workflowFile).replace('.json', '');
        const debugDir = path.join(process.cwd(), 'server', 'debug');
        fs.mkdirSync(debugDir, { recursive: true });
        fs.writeFileSync(path.join(debugDir, `wf_before_${wfShortName}_${Date.now()}.json`), JSON.stringify(workflow, null, 2));

        if (workflowPreprocessor) {
            // Custom pre-processor path (e.g. ltx-2-3-i2v.js)
            const fileUrl = 'file:///' + workflowPreprocessor.replace(/\\/g, '/');
            const mod = await import(fileUrl);
            await mod.inject(workflow, {
                prompt,
                duration: duration ?? 5,
                fps:        fps || 24,
                aspectRatio: aspectRatio || '16:9',
                resolution: resolution || 'Auto',
                imageBase64,
                nodeId,
                seed:       null,
            });
            fs.writeFileSync(path.join(debugDir, `wf_after_${wfShortName}_${Date.now()}.json`), JSON.stringify(workflow, null, 2));
        } else {
            // Built-in injector (legacy video workflows)
            injectWorkflow(workflow, {
                prompt, negativePrompt: '', aspectRatio,
                startImage: imageBase64,
                endImage:   lastFrameBase64,
                duration,
            });
            fs.writeFileSync(path.join(debugDir, `wf_after_${wfShortName}_${Date.now()}.json`), JSON.stringify(workflow, null, 2));
        }

        const promptId = await submitComfyWorkflow({
            baseUrl, apiKey, workflow, timeoutMs: effectiveTimeout
        });

        const outputs = await pollComfyHistory({
            baseUrl, apiKey, promptId,
            timeoutMs: effectiveTimeout, pollIntervalMs: effectivePoll
        });

        const assets = collectOutputAssets(outputs, 'video');
        if (assets.length === 0) throw new Error('ComfyUI returned no video output');

        const { buffer } = await downloadComfyAsset({
            baseUrl, apiKey, asset: assets[0], fallbackExt: 'mp4'
        });
        return buffer;
    }

    // Legacy: ComfyUI-Manager workflow_id + inputs
    const inputs = {
        prompt: prompt || '',
        aspectRatio, resolution, duration, videoMode,
        startImage: imageBase64,
        endImage:   lastFrameBase64,
    };

    return runComfyWorkflow({
        mode: 'video', workflowId, inputs,
        baseUrl, apiKey, timeoutMs: effectiveTimeout, pollIntervalMs: effectivePoll
    });
}
