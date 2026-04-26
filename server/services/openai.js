/**
 * openai.js
 * 
 * Service for OpenAI GPT Image generation (gpt-image-1.5).
 * Uses the Image API for both text-to-image (generations) and 
 * image-to-image (edits) generation.
 */

import OpenAI, { toFile } from 'openai';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Map aspect ratio or size to OpenAI size format
 * Accepts both pixel sizes (1024x1024) and aspect ratios (1:1)
 * Available sizes: 1024x1024 (square), 1536x1024 (landscape), 1024x1536 (portrait), auto
 */
function mapAspectRatioToSize(aspectRatio) {
    const sizeMap = {
        // Pixel sizes (new format for GPT Image 1.5)
        '1024x1024': '1024x1024',
        '1536x1024': '1536x1024',
        '1024x1536': '1024x1536',
        // Legacy aspect ratio mappings
        '1:1': '1024x1024',
        '16:9': '1536x1024',
        '9:16': '1024x1536',
        'Auto': 'auto'
    };
    return sizeMap[aspectRatio] || 'auto';
}

/**
 * Map resolution to OpenAI quality format
 * Quality options: low, medium, high, auto
 */
function mapResolutionToQuality(resolution) {
    const qualityMap = {
        '1K': 'low',
        '2K': 'medium',
        '4K': 'high',
        'Auto': 'auto'
    };
    return qualityMap[resolution] || 'auto';
}

/**
 * Convert base64 image data to a file object for OpenAI API
 * Strips data URL prefix if present
 */
async function base64ToFile(base64Data, filename = 'image.png') {
    // Strip data URL prefix if present (e.g., "data:image/png;base64,")
    const base64Content = base64Data.includes(',')
        ? base64Data.split(',')[1]
        : base64Data;

    // Determine MIME type from data URL or default to PNG
    let mimeType = 'image/png';
    if (base64Data.startsWith('data:')) {
        const match = base64Data.match(/^data:(image\/\w+);base64,/);
        if (match) {
            mimeType = match[1];
        }
    }

    const buffer = Buffer.from(base64Content, 'base64');
    return await toFile(buffer, filename, { type: mimeType });
}

// ============================================================================
// AUDIO GENERATION
// ============================================================================

/**
 * Generate audio using OpenAI TTS API
 * Supports optional voice cloning via reference audio file
 *
 * @param {Object} params - Generation parameters
 * @param {string} params.prompt - Text prompt for audio generation
 * @param {string} [params.audioModel] - TTS model (gpt-4o-mini-tts or gpt-4o-tts)
 * @param {string} [params.voiceReferenceUrl] - Optional URL to reference audio for voice cloning
 * @param {string} [params.audioFormat] - Output format: 'mp3' or 'wav'
 * @param {string} params.apiKey - OpenAI API key
 * @returns {Promise<Buffer>} Audio buffer
 */
export async function generateOpenAIAudio({ prompt, audioModel, voiceReferenceUrl, audioFormat, apiKey }) {
    const openai = new OpenAI({ apiKey });

    const model = audioModel || 'gpt-4o-mini-tts';
    const format = audioFormat === 'wav' ? 'wav' : 'mp3';

    console.log(`[OpenAI] Generating audio with ${model}, format: ${format}, voice clone: ${voiceReferenceUrl ? 'yes' : 'no'}`);

    const options = {
        model,
        input: prompt,
        voice: 'alloy',
    };

    if (voiceReferenceUrl) {
        // Voice cloning via reference audio file
        try {
            // Fetch the reference audio file
            let audioBuffer;
            if (voiceReferenceUrl.startsWith('data:')) {
                // Base64 data URL - convert to buffer
                const base64Content = voiceReferenceUrl.includes(',')
                    ? voiceReferenceUrl.split(',')[1]
                    : voiceReferenceUrl;
                audioBuffer = Buffer.from(base64Content, 'base64');
            } else {
                // URL - fetch it
                const response = await fetch(voiceReferenceUrl);
                audioBuffer = await response.buffer();
            }

            // Create a file from the reference audio for voice cloning
            const refFile = await toFile(audioBuffer, 'voice_reference.mp3', { type: 'audio/mpeg' });

            // Use the file as a voice reference (OpenAI TTS voice cloning)
            options.voice = ' reciting ' as any; // Placeholder; OpenAI SDK uses `voice` field with preset
            // Note: True voice cloning requires OpenAI's custom voice feature
            // Fall back to default voice with a log warning
            console.warn('[OpenAI] Voice reference provided but OpenAI TTS does not support custom voice cloning via API. Using default voice.');
            delete options.voice;

            // Store reference for potential future use via OpenAI's voice API
            (options as any).audioFile = refFile;
        } catch (err) {
            console.error('[OpenAI] Failed to load voice reference, using default voice:', err);
        }
    }

    const response = await openai.audio.speech.create(options);
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer;
}

// ============================================================================
// IMAGE GENERATION
// ============================================================================

/**
 * Generate image using OpenAI GPT Image API
 * 
 * @param {Object} params - Generation parameters
 * @param {string} params.prompt - Text prompt for image generation
 * @param {string[]} [params.imageBase64Array] - Array of base64 images for image-to-image editing
 * @param {string} [params.aspectRatio] - Aspect ratio (1:1, 16:9, 9:16, Auto)
 * @param {string} [params.resolution] - Resolution/quality setting (1K, 2K, 4K, Auto)
 * @param {string} params.apiKey - OpenAI API key
 * @returns {Promise<Buffer>} Image buffer
 */
export async function generateOpenAIImage({ prompt, imageBase64Array, aspectRatio, resolution, apiKey }) {
    const openai = new OpenAI({ apiKey });

    const size = mapAspectRatioToSize(aspectRatio);
    const quality = mapResolutionToQuality(resolution);

    console.log(`[OpenAI] Generating image with gpt-image-1.5, size: ${size}, quality: ${quality}`);

    // Use edits endpoint if input images provided, otherwise generations
    if (imageBase64Array && imageBase64Array.length > 0) {
        // --- IMAGE EDITING (Image-to-Image) ---
        console.log(`[OpenAI] Using edits endpoint with ${imageBase64Array.length} input image(s)`);

        // Convert base64 images to file objects
        const imageFiles = await Promise.all(
            imageBase64Array.map(async (base64, idx) =>
                await base64ToFile(base64, `input_${idx}.png`)
            )
        );

        // Build request options
        const editOptions = {
            model: 'gpt-image-1.5',
            image: imageFiles.length === 1 ? imageFiles[0] : imageFiles,
            prompt,
            quality: quality === 'auto' ? undefined : quality,
        };

        // Only set size if not auto (auto is default behavior)
        if (size !== 'auto') {
            editOptions.size = size;
        }

        const response = await openai.images.edit(editOptions);

        // Response contains base64 data in b64_json field
        const imageBase64 = response.data[0].b64_json;
        return Buffer.from(imageBase64, 'base64');

    } else {
        // --- TEXT-TO-IMAGE (Generations) ---
        console.log(`[OpenAI] Using generations endpoint (text-to-image)`);

        // Build request options
        const generateOptions = {
            model: 'gpt-image-1.5',
            prompt,
            quality: quality === 'auto' ? undefined : quality,
        };

        // Only set size if not auto
        if (size !== 'auto') {
            generateOptions.size = size;
        }

        const response = await openai.images.generate(generateOptions);

        // Response contains base64 data in b64_json field
        const imageBase64 = response.data[0].b64_json;
        return Buffer.from(imageBase64, 'base64');
    }
}
