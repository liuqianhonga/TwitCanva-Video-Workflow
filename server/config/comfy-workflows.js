/**
 * comfy-workflows.js
 *
 * ComfyUI workflow registry.
 * Maps logical keys to their workflow JSON and optional pre-processor.
 *
 * Key naming: comfy-{modelName}-{mode}
 *   modelName: specific model identifier (z-image, flux2, etc.)
 *   mode:      t2i | i2i-single | i2i-multi
 *
 * Each entry:
 *   json   - absolute path to the workflow JSON
 *   module - absolute path to the pre-processor JS (optional)
 *
 * The pre-processor is a JS module that exports:
 *   inject(workflow, params) → modified workflow
 * It handles workflow-specific variable injection (LoadImage base64,
 * custom _meta.title variables, etc.).
 *
 * If no module is specified, a built-in generic injector is used
 * that handles standard _meta.title variables (width, height, prompt).
 *
 * Usage:
 *   import COMFY_WORKFLOWS from './config/comfy-workflows.js';
 *   const workflowFile = COMFY_WORKFLOWS['comfy-z-image-t2i'].json;
 *   const preprocessor = COMFY_WORKFLOWS['comfy-z-image-t2i'].module;
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = path.resolve(__dirname, '../workflows/comfy');

const COMFY_WORKFLOWS = {
    // ── Z-Image ────────────────────────────────────────────────────────────────
    'comfy-z-image-t2i': {
        json:   path.join(WORKFLOWS_DIR, 'z-image-t2i.json'),
        module: path.join(WORKFLOWS_DIR, 'z-image-t2i.js'),
    },

    // ── Flux.2 Klein Image Edit ───────────────────────────────────────────────
    'comfy-flux2-klein-image-edit': {
        json:   path.join(WORKFLOWS_DIR, 'flux2-klein-image-edit.json'),
        module: path.join(WORKFLOWS_DIR, 'flux2-klein-image-edit.js'),
    },

    // ── LTX Video I2V ───────────────────────────────────────────────────────
    'comfy-ltx-video-i2v': {
        json:   path.join(WORKFLOWS_DIR, 'ltx-2-3-i2v.json'),
        module: path.join(WORKFLOWS_DIR, 'ltx-2-3-i2v.js'),
    },

    // ── Fish Audio TTS ──────────────────────────────────────────────────────
    'comfy-audio-tts': {
        json:   path.join(WORKFLOWS_DIR, 'fish-audio-tts.json'),
        module: path.join(WORKFLOWS_DIR, 'fish-audio-tts.js'),
    },
};

export default COMFY_WORKFLOWS;
