import { pipeline } from '@xenova/transformers';

let generatorPromise = null;
let currentModelId = null;

function getHuggingFaceDefaults(config = {}) {
  return {
    modelId: config.modelId || 'Xenova/distilgpt2',
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
  generatorPromise = pipeline('text-generation', modelId, { quantized: true });
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

export async function generateWithOllama(prompt, config = {}) {
  const url = config.url?.trim() || 'http://127.0.0.1:11434/api/generate';
  const model = config.model?.trim() || 'tinyllama';
  const maxNewTokens = Math.max(16, Number(config.maxNewTokens) || 60);
  const temperature = Number.isFinite(Number(config.temperature)) ? Number(config.temperature) : 0.7;
  const topP = Number.isFinite(Number(config.topP)) ? Number(config.topP) : 0.9;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: {
        temperature,
        top_p: topP,
        num_predict: maxNewTokens
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama request failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  const text = data?.response || data?.generated_text || '';
  return String(text).trim();
}

export function resetHuggingFaceCache() {
  generatorPromise = null;
  currentModelId = null;
}
