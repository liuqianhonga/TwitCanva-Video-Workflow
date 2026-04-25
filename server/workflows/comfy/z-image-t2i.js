/**
 * z-image-t2i.js
 *
 * Pre-processor for z-image-t2i workflow.
 * Handles:
 *   - Variable injection via _meta.title (width, height, prompt)
 *   - KSampler seed randomisation
 */

export function inject(workflow, params) {
    const {
        prompt      = '',
        negativePrompt = '',
        aspectRatio = '1:1',
        seed        = null,
    } = params;

    const sizeMap = {
        '1:1':  { width: 1024, height: 1024 },
        '16:9': { width: 1344, height: 768  },
        '9:16': { width: 768,  height: 1344 },
        '4:3':  { width: 1152, height: 896  },
        '3:2':  { width: 1216, height: 832  },
        '2:3':  { width: 832,  height: 1216 },
    };
    const { width, height } = sizeMap[String(aspectRatio)] || sizeMap['1:1'];

    for (const [id, node] of Object.entries(workflow || {})) {
        if (!node || typeof node !== 'object' || !node.class_type) continue;
        const title = node._meta?.title || '';

        if (title === '$width.value') {
            node.inputs.value = width;
            console.log(`[z-image-t2i] width → ${width}`);
        }
        if (title === '$height.value') {
            node.inputs.value = height;
            console.log(`[z-image-t2i] height → ${height}`);
        }
        if (title === '$prompt.text!' || title === '$prompt') {
            node.inputs.text = prompt;
            console.log(`[z-image-t2i] prompt → ${prompt.length} chars`);
        }

        if (node.class_type === 'KSampler' && 'seed' in (node.inputs || {})) {
            node.inputs.seed = seed !== null ? seed : Math.floor(Math.random() * 1e18);
            console.log(`[z-image-t2i] KSampler seed → ${node.inputs.seed}`);
        }

        if (
            node.class_type &&
            (node.class_type.endsWith('Save') || node.class_type.endsWith('Preview'))
        ) {
            workflow.output_node = id;
        }
    }

    return workflow;
}
