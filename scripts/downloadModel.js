#!/usr/bin/env node
import process from 'node:process';
import { personalityStore } from '../src/config/personalityStore.js';

async function downloadModel(modelId) {
  console.log(`Preparing Hugging Face model cache for ${modelId}...`);
  const transformers = await import('@xenova/transformers');
  const generator = await transformers.pipeline('text-generation', modelId, { quantized: true });
  await generator('Model warmup prompt.', { max_new_tokens: 1, temperature: 0.7 });
  console.log('Model cache is ready.');
}

async function main() {
  try {
    const personality = await personalityStore.load();
    const configuredModel = personality?.ai?.huggingface?.modelId;
    const fallbackModel = personalityStore.defaults.ai.huggingface.modelId;
    const modelId = configuredModel || fallbackModel;

    await downloadModel(modelId);
    process.exit(0);
  } catch (error) {
    console.error('Failed to prepare Hugging Face model cache.');
    if (error?.message) {
      console.error(error.message);
    }
    if (error?.cause?.message) {
      console.error(error.cause.message);
    }
    process.exit(1);
  }
}

main();
