import fs from 'node:fs/promises';
import path from 'node:path';

const dataDirectory = path.resolve(process.cwd(), 'data');
const personalityFile = path.join(dataDirectory, 'personality.json');

const defaultPersonality = {
  welcomeMessage: 'Welcome to the server, {user}! We are glad to have you here.',
  tone: 'friendly',
  conversation: {
    style: 'supportive',
    guidance: 'Keep responses encouraging, community-focused, and clear.',
    responseLength: 80
  },
  ai: {
    huggingface: {
      modelId: 'Xenova/distilgpt2',
      maxNewTokens: 60,
      temperature: 0.7,
      topP: 0.9,
      repetitionPenalty: 1.1
    }
  }
};

let cachedPersonality = null;
let isLoaded = false;

async function ensureDataDirectory() {
  await fs.mkdir(dataDirectory, { recursive: true });
}

function mergeDefaults(partial = {}) {
  const conversationPartial = partial.conversation ?? {};
  const aiPartial = partial.ai ?? {};

  const hasCustomGuidance = Object.prototype.hasOwnProperty.call(conversationPartial, 'guidance');
  const hasCustomResponseLength = Object.prototype.hasOwnProperty.call(conversationPartial, 'responseLength');

  const conversation = {
    style: sanitizeStyle(conversationPartial.style),
    guidance: hasCustomGuidance
      ? sanitizeGuidance(conversationPartial.guidance)
      : defaultPersonality.conversation.guidance,
    responseLength: clampNumber(
      hasCustomResponseLength ? conversationPartial.responseLength : defaultPersonality.conversation.responseLength,
      16,
      160,
      defaultPersonality.conversation.responseLength
    )
  };

  return {
    welcomeMessage: sanitizeWelcome(partial.welcomeMessage),
    tone: sanitizeTone(partial.tone),
    conversation,
    ai: mergeAIConfig(aiPartial)
  };
}

function mergeAIConfig(partial = {}) {
  return {
    huggingface: sanitizeHuggingFaceConfig(partial.huggingface)
  };
}

function sanitizeWelcome(value) {
  if (value === null || value === undefined) {
    return defaultPersonality.welcomeMessage;
  }

  const trimmed = String(value).trim();
  return trimmed || defaultPersonality.welcomeMessage;
}

function sanitizeTone(value) {
  const allowed = ['friendly', 'professional', 'playful', 'serious'];
  if (allowed.includes(value)) {
    return value;
  }
  return defaultPersonality.tone;
}

function sanitizeGuidance(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (Array.isArray(value)) {
    return value
      .map((line) => String(line).trim())
      .filter(Boolean)
      .join('\n');
  }

  return String(value).trim();
}

function clampNumber(value, min, max, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const number = Number(value);
  if (Number.isNaN(number)) {
    return fallback;
  }
  return Math.min(Math.max(number, min), max);
}

function sanitizeStyle(style) {
  const allowed = ['supportive', 'informative', 'playful', 'concise'];
  if (allowed.includes(style)) {
    return style;
  }
  return defaultPersonality.conversation.style;
}

function sanitizeHuggingFaceConfig(config = {}) {
  const defaults = defaultPersonality.ai.huggingface;
  return {
    modelId: String(config.modelId ?? defaults.modelId).trim() || defaults.modelId,
    maxNewTokens: clampNumber(config.maxNewTokens, 16, 512, defaults.maxNewTokens),
    temperature: clampNumber(config.temperature, 0.1, 2, defaults.temperature),
    topP: clampNumber(config.topP, 0.1, 1, defaults.topP),
    repetitionPenalty: clampNumber(config.repetitionPenalty, 0.5, 2, defaults.repetitionPenalty)
  };
}

async function loadPersonality() {
  if (isLoaded && cachedPersonality) {
    return cachedPersonality;
  }

  try {
    const data = await fs.readFile(personalityFile, 'utf8');
    const parsed = JSON.parse(data);
    cachedPersonality = mergeDefaults(parsed);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Failed to load personality configuration:', error);
    }
    cachedPersonality = defaultPersonality;
    await savePersonality(defaultPersonality);
  }

  isLoaded = true;
  return cachedPersonality;
}

async function savePersonality(update) {
  const merged = mergeDefaults(update);
  await ensureDataDirectory();
  await fs.writeFile(personalityFile, JSON.stringify(merged, null, 2));
  cachedPersonality = merged;
  isLoaded = true;
  return cachedPersonality;
}

function getPersonalitySync() {
  return cachedPersonality ?? defaultPersonality;
}

export const personalityStore = {
  load: loadPersonality,
  save: savePersonality,
  get: getPersonalitySync,
  defaults: defaultPersonality
};
