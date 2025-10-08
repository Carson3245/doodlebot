import fs from 'node:fs/promises';
import path from 'node:path';

const dataDirectory = path.resolve(process.cwd(), 'data');
const commandFile = path.join(dataDirectory, 'commands.json');

const defaultConfig = {
  commands: {}
};

let cachedConfig = null;
let loaded = false;

export async function loadCommandConfig() {
  if (loaded && cachedConfig) {
    return cachedConfig;
  }

  try {
    const raw = await fs.readFile(commandFile, 'utf8');
    cachedConfig = mergeConfig(JSON.parse(raw));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Failed to load command configuration:', error);
    }
    cachedConfig = defaultConfig;
    await persistConfig(defaultConfig);
  }

  loaded = true;
  return cachedConfig;
}

export async function saveCommandConfig(update) {
  const current = await loadCommandConfig();
  const merged = mergeConfig({
    commands: {
      ...current.commands,
      ...(update?.commands ?? {})
    }
  });

  cachedConfig = merged;
  loaded = true;
  await persistConfig(merged);
  return merged;
}

export function getCommandConfigSync() {
  return cachedConfig ?? defaultConfig;
}

function mergeConfig(partial = {}) {
  const commands = {};
  const rawCommands = partial.commands ?? {};
  for (const [key, value] of Object.entries(rawCommands)) {
    commands[key] = sanitizeCommandConfig(value);
  }
  return {
    commands
  };
}

function sanitizeCommandConfig(value = {}) {
  return {
    enabled: value.enabled !== undefined ? Boolean(value.enabled) : true,
    cooldown: Number.isFinite(Number(value.cooldown)) ? Number(value.cooldown) : null,
    category: typeof value.category === 'string' && value.category.trim().length ? value.category.trim() : null,
    notes: typeof value.notes === 'string' && value.notes.trim().length ? value.notes.trim() : null
  };
}

async function persistConfig(data) {
  await fs.mkdir(dataDirectory, { recursive: true });
  await fs.writeFile(commandFile, JSON.stringify(data, null, 2));
}
