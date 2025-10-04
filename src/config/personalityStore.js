import fs from 'node:fs/promises';
import path from 'node:path';

const dataDirectory = path.resolve(process.cwd(), 'data');
const personalityFile = path.join(dataDirectory, 'personality.json');

const defaultPersonality = {
  welcomeMessage: 'Welcome to the server, {user}! We are glad to have you here.',
  tone: 'friendly',
  keywords: ['community', 'safety', 'fun'],
  conversation: {
    style: 'supportive',
    shortReplyChance: 0.2,
    acknowledgementPhrases: [
      'I hear you.',
      'That makes sense.',
      'Let us keep going.',
      'Thanks for sharing that.'
    ],
    keywordResponses: {
      help: 'I can offer suggestions or point you toward helpful resources. What is going on?',
      issue: 'Let us break the issue down together. What is the first thing we should look at?',
      thanks: 'Happy to help. Feel free to keep the conversation going.'
    }
  },
  ai: {
    mode: 'rules',
    huggingface: {
      modelId: 'Xenova/distilgpt2',
      maxNewTokens: 60,
      temperature: 0.7,
      topP: 0.9,
      repetitionPenalty: 1.1
    },
    ollama: {
      url: 'http://127.0.0.1:11434/api/generate',
      model: 'tinyllama',
      maxNewTokens: 60,
      temperature: 0.7,
      topP: 0.9
    }
  }
};

let cachedPersonality = null;
let isLoaded = false;

async function ensureDataDirectory() {
  await fs.mkdir(dataDirectory, { recursive: true });
}

function mergeDefaults(partial) {
  const merged = {
    ...defaultPersonality,
    ...partial,
    conversation: {
      ...defaultPersonality.conversation,
      ...(partial?.conversation ?? {})
    },
    ai: mergeAIConfig(partial?.ai)
  };

  merged.keywords = sanitizeKeywords(merged.keywords);
  merged.conversation.acknowledgementPhrases = sanitizePhrases(
    merged.conversation.acknowledgementPhrases
  );
  merged.conversation.keywordResponses = sanitizeKeywordResponses(
    merged.conversation.keywordResponses
  );

  merged.conversation.shortReplyChance = clampNumber(
    merged.conversation.shortReplyChance,
    0,
    1,
    defaultPersonality.conversation.shortReplyChance
  );

  merged.conversation.style = sanitizeStyle(merged.conversation.style);

  merged.ai.mode = sanitizeAIMode(merged.ai.mode);
  merged.ai.huggingface = sanitizeHuggingFaceConfig(merged.ai.huggingface);
  merged.ai.ollama = sanitizeOllamaConfig(merged.ai.ollama);

  return merged;
}

function mergeAIConfig(partial) {
  const defaults = defaultPersonality.ai;
  const huggingface = {
    ...defaults.huggingface,
    ...(partial?.huggingface ?? {})
  };
  const ollama = {
    ...defaults.ollama,
    ...(partial?.ollama ?? {})
  };

  return {
    mode: partial?.mode ?? defaults.mode,
    huggingface,
    ollama
  };
}

function sanitizeKeywords(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((keyword) => String(keyword).trim()).filter(Boolean);
  }

  return String(value)
    .split(',')
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

function sanitizePhrases(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((phrase) => String(phrase).trim()).filter(Boolean);
  }

  return String(value)
    .split('\n')
    .map((phrase) => phrase.trim())
    .filter(Boolean);
}

function sanitizeKeywordResponses(value) {
  const result = {};

  if (!value) {
    return result;
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    Object.entries(value).forEach(([key, response]) => {
      const trimmedKey = String(key).trim().toLowerCase();
      const trimmedResponse = String(response).trim();
      if (trimmedKey && trimmedResponse) {
        result[trimmedKey] = trimmedResponse;
      }
    });
    return result;
  }

  const pairs = String(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const pair of pairs) {
    const [key, response] = pair.split(':');
    const trimmedKey = key?.trim().toLowerCase();
    const trimmedResponse = response?.trim();
    if (trimmedKey && trimmedResponse) {
      result[trimmedKey] = trimmedResponse;
    }
  }

  return result;
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

function sanitizeAIMode(mode) {
  const allowed = ['rules', 'huggingface', 'ollama'];
  if (allowed.includes(mode)) {
    return mode;
  }
  return defaultPersonality.ai.mode;
}

function sanitizeHuggingFaceConfig(config) {
  const defaults = defaultPersonality.ai.huggingface;
  return {
    modelId: String(config?.modelId ?? defaults.modelId).trim() || defaults.modelId,
    maxNewTokens: clampNumber(config?.maxNewTokens, 8, 512, defaults.maxNewTokens),
    temperature: clampNumber(config?.temperature, 0.1, 2, defaults.temperature),
    topP: clampNumber(config?.topP, 0.1, 1, defaults.topP),
    repetitionPenalty: clampNumber(config?.repetitionPenalty, 0.5, 2, defaults.repetitionPenalty)
  };
}

function sanitizeOllamaConfig(config) {
  const defaults = defaultPersonality.ai.ollama;
  return {
    url: String(config?.url ?? defaults.url).trim() || defaults.url,
    model: String(config?.model ?? defaults.model).trim() || defaults.model,
    maxNewTokens: clampNumber(config?.maxNewTokens, 8, 512, defaults.maxNewTokens),
    temperature: clampNumber(config?.temperature, 0.1, 2, defaults.temperature),
    topP: clampNumber(config?.topP, 0.1, 1, defaults.topP)
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
