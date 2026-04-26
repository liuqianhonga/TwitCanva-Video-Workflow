/**
 * fish-audio-tts.js
 *
 * Pre-processor for Fish Audio TTS workflow.
 * Handles:
 *   - Prompt injection via $prompt.text! title
 *   - Reference audio file (voice cloning)
 */

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import os from 'os';

export async function inject(workflow, params) {
    const {
        prompt       = '',
        voiceReferenceUrl = '',
    } = params;

    let referencePath = '';

    // Handle reference audio: download URL or decode base64 to temp file
    if (voiceReferenceUrl) {
        try {
            const tmpDir = os.tmpdir();
            const tmpFile = path.join(tmpDir, `voice_ref_${Date.now()}.mp3`);
            let buffer;

            if (voiceReferenceUrl.startsWith('data:')) {
                // Decode base64 data URL
                const base64Content = voiceReferenceUrl.includes(',')
                    ? voiceReferenceUrl.split(',')[1]
                    : voiceReferenceUrl;
                buffer = Buffer.from(base64Content, 'base64');
            } else {
                // Fetch from URL
                const response = await fetch(voiceReferenceUrl);
                if (!response.ok) throw new Error(`Failed to fetch reference audio: ${response.status}`);
                buffer = Buffer.from(await response.arrayBuffer());
            }

            fs.writeFileSync(tmpFile, buffer);
            referencePath = tmpFile;
            console.log(`[fish-audio-tts] Reference audio saved to: ${tmpFile}`);
        } catch (err) {
            console.warn('[fish-audio-tts] Failed to load reference audio, proceeding without it:', err.message);
        }
    }

    for (const [id, node] of Object.entries(workflow || {})) {
        if (!node || typeof node !== 'object' || !node.class_type) continue;
        const title = node._meta?.title || '';

        // Inject prompt text into TextNode and FishAudioTTS
        if (title === '$prompt.text!' || title === '$prompt') {
            node.inputs.text = prompt;
            console.log(`[fish-audio-tts] prompt → ${prompt.length} chars (node ${id})`);
        }

        if (node.class_type === 'FishAudioTTS') {
            node.inputs.text = prompt;
            if (referencePath) {
                node.inputs.reference_audio = referencePath;
            }
            console.log(`[fish-audio-tts] FishAudioTTS updated (node ${id})`);
        }

        // Mark output node
        if (node.class_type === 'SaveAudio') {
            workflow.output_node = id;
        }
    }

    return workflow;
}
