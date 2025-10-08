import fs from 'node:fs/promises';
import path from 'node:path';

const dataDirectory = path.resolve(process.cwd(), 'data');
const styleFile = path.join(dataDirectory, 'style.json');

export const CREATIVITY_PRESETS = Object.freeze({
  grounded: {
    temperature: 0.35,
    topP: 0.6
  },
  balanced: {
    temperature: 0.65,
    topP: 0.85
  },
  playful: {
    temperature: 0.9,
    topP: 0.95
  }
});

export const PERSONALITY_PRESETS = Object.freeze({
  cosmicGuide: {
    identity: {
      name: 'Doodley',
      pronouns: 'they/them',
      bio: 'Doodley is the cheerful cosmic guide of Planet Doodle, always ready to make conversations sparkle.'
    },
    voice: {
      tone: 'warm and whimsical',
      pace: 'steady',
      signaturePhrases: ['sparkly greetings', 'stardust vibes', 'shooting star smiles'],
      emojiFlavor: 'twinkles'
    },
    response: {
      usesNickname: true,
      addsSignOff: false,
      signOffText: '✨ Doodley out!'
    }
  },
  chillNavigator: {
    identity: {
      name: 'Doodley',
      pronouns: 'they/them',
      bio: 'Doodley keeps conversations breezy and grounded, guiding members through Planet Doodle with relaxed vibes.'
    },
    voice: {
      tone: 'calm and friendly',
      pace: 'unhurried',
      signaturePhrases: ['breathing easy', 'cozy orbit', 'breeze check-in'],
      emojiFlavor: 'sparkles'
    },
    response: {
      usesNickname: false,
      addsSignOff: false,
      signOffText: '✨ Doodley out!'
    }
  },
  highEnergyHost: {
    identity: {
      name: 'Doodley',
      pronouns: 'they/them',
      bio: 'Doodley is a high-energy cosmic host hyping every member who stops by Planet Doodle.'
    },
    voice: {
      tone: 'excited and upbeat',
      pace: 'animated',
      signaturePhrases: ['cosmic confetti', 'party stardust', 'interstellar high-five'],
      emojiFlavor: '✨💫'
    },
    response: {
      usesNickname: true,
      addsSignOff: true,
      signOffText: '💫 Catch you in the next orbit!'
    }
  }
});

const FEATURE_KEYS = new Set(['brainTracking', 'chatReplies']);

const defaultStyle = {
  identity: {
    name: 'Doodley',
    pronouns: 'they/them',
    bio: 'Doodley is the cheerful cosmic guide of Planet Doodle, always ready to make conversations sparkle.'
  },
  voice: {
    tone: 'warm and whimsical',
    pace: 'steady',
    signaturePhrases: ['sparkly greetings', 'stardust vibes'],
    emojiFlavor: 'twinkles'
  },
  response: {
    usesNickname: true,
    addsSignOff: false,
    signOffText: '✨ Doodley out!'
  },
  creativity: {
    temperature: 0.65,
    topP: 0.85
  },
  features: {
    brainTracking: true,
    chatReplies: true
  }
};

let cachedStyle = null;
let loaded = false;

export async function loadStyle() {
  if (loaded && cachedStyle) {
    return cachedStyle;
  }

  try {
    const raw = await fs.readFile(styleFile, 'utf8');
    const parsed = JSON.parse(raw);
    cachedStyle = mergeStyle(parsed);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Failed to load style configuration:', error);
    }
    cachedStyle = defaultStyle;
    await persistStyle(defaultStyle);
  }

  loaded = true;
  return cachedStyle;
}

export async function saveStyle(update) {
  const base = loaded && cachedStyle ? cachedStyle : await loadStyle();
  const merged = mergeStyle({
    identity: { ...base.identity, ...(update?.identity ?? {}) },
    voice: { ...base.voice, ...(update?.voice ?? {}) },
    response: { ...base.response, ...(update?.response ?? {}) },
    creativity: { ...base.creativity, ...(update?.creativity ?? {}) },
    features: { ...base.features, ...(update?.features ?? {}) }
  });
  await persistStyle(merged);
  cachedStyle = merged;
  loaded = true;
  return merged;
}

export function getStyleSync() {
  return cachedStyle ?? defaultStyle;
}

export async function applyCreativityPreset(presetName) {
  const preset = CREATIVITY_PRESETS[presetName];
  if (!preset) {
    throw new Error(`UnknownCreativityPreset ${presetName}`);
  }
  return saveStyle({ creativity: preset });
}

export function getCreativityPresetNames() {
  return Object.keys(CREATIVITY_PRESETS);
}

export async function setCreativityControls({ temperature, topP }) {
  const next = {};
  if (temperature !== undefined) {
    next.temperature = temperature;
  }
  if (topP !== undefined) {
    next.topP = topP;
  }
  if (Object.keys(next).length === 0) {
    const current = getStyleSync();
    return current.creativity;
  }
  const updated = await saveStyle({ creativity: next });
  return updated.creativity;
}

export async function toggleFeatureFlag(featureKey, enabled) {
  if (!FEATURE_KEYS.has(featureKey)) {
    throw new Error(`UnknownFeatureFlag ${featureKey}`);
  }
  const updated = await saveStyle({ features: { [featureKey]: Boolean(enabled) } });
  return updated.features;
}

export async function applyPersonalityPreset(presetName) {
  const preset = PERSONALITY_PRESETS[presetName];
  if (!preset) {
    throw new Error(`UnknownPersonalityPreset ${presetName}`);
  }
  return saveStyle({
    identity: preset.identity,
    voice: preset.voice,
    response: preset.response
  });
}

export function getPersonalityPresetNames() {
  return Object.keys(PERSONALITY_PRESETS);
}

export async function updatePersonalitySections({ identity, voice, response }) {
  const payload = {};
  if (identity) {
    payload.identity = identity;
  }
  if (voice) {
    payload.voice = voice;
  }
  if (response) {
    payload.response = response;
  }
  if (Object.keys(payload).length === 0) {
    return getStyleSync();
  }
  return saveStyle(payload);
}

function mergeStyle(partial = {}) {
  const identity = sanitizeIdentity(partial.identity);
  const voice = sanitizeVoice(partial.voice);
  const response = sanitizeResponse(partial.response);
  const creativity = sanitizeCreativity(partial.creativity);
  const features = sanitizeFeatures(partial.features);
  return { identity, voice, response, creativity, features };
}

function sanitizeIdentity(identity = {}) {
  const name = 'Doodley';
  return {
    name,
    pronouns: sanitizeString(identity.pronouns, defaultStyle.identity.pronouns),
    bio: sanitizeString(identity.bio, defaultStyle.identity.bio)
  };
}

function sanitizeVoice(voice = {}) {
  return {
    tone: sanitizeString(voice.tone, defaultStyle.voice.tone),
    pace: sanitizeString(voice.pace, defaultStyle.voice.pace),
    signaturePhrases: sanitizeArray(voice.signaturePhrases, defaultStyle.voice.signaturePhrases),
    emojiFlavor: sanitizeString(voice.emojiFlavor, defaultStyle.voice.emojiFlavor)
  };
}

function sanitizeResponse(response = {}) {
  return {
    usesNickname: Boolean(response.usesNickname ?? defaultStyle.response.usesNickname),
    addsSignOff: Boolean(response.addsSignOff ?? defaultStyle.response.addsSignOff),
    signOffText: sanitizeString(response.signOffText, defaultStyle.response.signOffText)
  };
}

function sanitizeCreativity(creativity = {}) {
  return {
    temperature: clampNumber(creativity.temperature, 0.1, 1.2, defaultStyle.creativity.temperature),
    topP: clampNumber(creativity.topP, 0.1, 1, defaultStyle.creativity.topP)
  };
}

function sanitizeFeatures(features = {}) {
  return {
    brainTracking:
      features.brainTracking !== undefined ? Boolean(features.brainTracking) : defaultStyle.features.brainTracking,
    chatReplies: features.chatReplies !== undefined ? Boolean(features.chatReplies) : defaultStyle.features.chatReplies
  };
}

function sanitizeString(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : fallback;
}

function sanitizeArray(value, fallback) {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const cleaned = value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return cleaned.length ? cleaned.slice(0, 10) : fallback;
}

function clampNumber(value, min, max, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(Math.max(number, min), max);
}

async function persistStyle(data) {
  await fs.mkdir(dataDirectory, { recursive: true });
  await fs.writeFile(styleFile, JSON.stringify(data, null, 2));
}
