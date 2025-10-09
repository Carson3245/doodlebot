import fs from 'node:fs/promises';
import path from 'node:path';

const dataDirectory = path.resolve(process.cwd(), 'data');
const commandFile = path.join(dataDirectory, 'commands.json');

const defaultConfig = {
  commands: {}
};

let cachedConfig = null;
let loaded = false;
const subscribers = new Set();

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
  notifySubscribers();
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
  notifySubscribers();
  return merged;
}

export function getCommandConfigSync() {
  return cachedConfig ?? defaultConfig;
}

export function getCommandSettings(name) {
  if (!name) {
    return sanitizeCommandConfig();
  }
  const normalized = String(name).toLowerCase();
  const config = getCommandConfigSync();
  return config.commands[normalized] ? sanitizeCommandConfig(config.commands[normalized]) : sanitizeCommandConfig();
}

export async function incrementCommandUsage(name) {
  if (!name) {
    return;
  }
  const normalized = String(name).toLowerCase();
  const current = await loadCommandConfig();
  const command = current.commands[normalized] ?? sanitizeCommandConfig();
  const updated = {
    commands: {
      ...current.commands,
      [normalized]: {
        ...command,
        usage: (command.usage ?? 0) + 1
      }
    }
  };
  await saveCommandConfig(updated);
}

export function onCommandConfigChange(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }
  subscribers.add(listener);
  if (cachedConfig) {
    listener(cachedConfig);
  }
  return () => {
    subscribers.delete(listener);
  };
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
    notes: typeof value.notes === 'string' && value.notes.trim().length ? value.notes.trim() : null,
    usage: Number.isFinite(Number(value.usage)) ? Number(value.usage) : 0
  };
}

async function persistConfig(data) {
  await fs.mkdir(dataDirectory, { recursive: true });
  await fs.writeFile(commandFile, JSON.stringify(data, null, 2));
}

function notifySubscribers() {
  for (const listener of subscribers) {
    try {
      listener(cachedConfig ?? defaultConfig);
    } catch (error) {
      console.error('Command config subscriber failed:', error);
    }
  }
}
