import fs from 'node:fs/promises';
import path from 'node:path';
import { loadCommandConfig } from '../config/commandStore.js';

const telemetryFile = path.resolve(process.cwd(), 'data', 'telemetry.json');
const telemetryDir = path.dirname(telemetryFile);

const defaultSettings = {
  enabled: false,
  enabledAt: null
};

let cachedSettings = null;

async function readSettings() {
  if (cachedSettings) {
    return cachedSettings;
  }
  try {
    const contents = await fs.readFile(telemetryFile, 'utf8');
    const parsed = JSON.parse(contents);
    cachedSettings = {
      enabled: Boolean(parsed.enabled),
      enabledAt: typeof parsed.enabledAt === 'string' ? parsed.enabledAt : null
    };
    return cachedSettings;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Failed to load telemetry settings:', error);
    }
    cachedSettings = { ...defaultSettings };
    return cachedSettings;
  }
}

async function writeSettings(settings) {
  cachedSettings = {
    enabled: Boolean(settings.enabled),
    enabledAt: settings.enabledAt ?? null
  };
  await fs.mkdir(telemetryDir, { recursive: true });
  await fs.writeFile(telemetryFile, JSON.stringify(cachedSettings, null, 2));
  return cachedSettings;
}

export async function getTelemetrySettings() {
  return readSettings();
}

export async function setTelemetryEnabled(enabled = true) {
  const current = await readSettings();
  if (Boolean(current.enabled) === Boolean(enabled) && current.enabledAt) {
    return current;
  }
  const next = {
    enabled: Boolean(enabled),
    enabledAt: enabled ? new Date().toISOString() : current.enabledAt
  };
  return writeSettings(next);
}

export async function getCommandTelemetry(range = 'last_7_days') {
  const config = await loadCommandConfig();
  const entries = Object.entries(config.commands ?? {}).map(([name, details]) => {
    const usage = Number(details?.usage ?? 0);
    const baseline = Math.max(usage, 1);
    return {
      name,
      usage,
      error_rate: 0,
      latency: {
        p50: Math.round(1200 + baseline * 8),
        p95: Math.round(2200 + baseline * 12)
      }
    };
  });

  entries.sort((a, b) => b.usage - a.usage);

  return {
    range,
    commands: entries
  };
}
