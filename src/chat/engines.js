let generatorPromise = null;
let currentModelId = null;
let transformersModulePromise = null;

function loadPipeline() {
  if (!transformersModulePromise) {
    transformersModulePromise = import('@xenova/transformers')
      .then((module) => {
        if (module?.pipeline) {
          return module.pipeline;
        }

        const missingExport = new Error('TransformersPipelineUnavailable 2005');
        throw missingExport;
      })
      .catch((error) => {
        transformersModulePromise = null;
        const wrapped = new Error('TransformersDependencyMissing 2004');
        wrapped.cause = error;
        throw wrapped;
      });
  }

  return transformersModulePromise;
}

function getHuggingFaceDefaults(config = {}) {
  return {
    modelId: config.modelId || 'Xenova/TinyLlama-1.1B-Chat-v1.0',
    maxNewTokens: Math.max(16, Number(config.maxNewTokens) || 60),
    temperature: Number.isFinite(Number(config.temperature)) ? Number(config.temperature) : 0.7,
    topP: Number.isFinite(Number(config.topP)) ? Number(config.topP) : 0.9,
    repetitionPenalty: Number.isFinite(Number(config.repetitionPenalty))
      ? Number(config.repetitionPenalty)
      : 1.1
  };
}

async function getGenerator(modelId) {
  if (generatorPromise && currentModelId === modelId) {
    return generatorPromise;
  }

  currentModelId = modelId;
  generatorPromise = loadPipeline()
    .then((pipeline) => pipeline('text-generation', modelId, { quantized: true }))
    .catch((error) => {
      generatorPromise = null;
      currentModelId = null;
      throw error;
    });

  return generatorPromise;
}

export async function generateWithHuggingFace(prompt, config = {}) {
  const options = getHuggingFaceDefaults(config);
  const generator = await getGenerator(options.modelId);
  const output = await generator(prompt, {
    max_new_tokens: options.maxNewTokens,
    temperature: options.temperature,
    top_p: options.topP,
    repetition_penalty: options.repetitionPenalty
  });

  const result = output?.[0]?.generated_text ?? '';
  const continuation = result.slice(prompt.length).trim();
  return continuation.length ? continuation : result.trim();
}

export function resetHuggingFaceCache() {
  generatorPromise = null;
  currentModelId = null;
  transformersModulePromise = null;
}
