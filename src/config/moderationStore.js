import fs from 'node:fs/promises';
import path from 'node:path';

const dataDirectory = path.resolve(process.cwd(), 'data');
const moderationFile = path.join(dataDirectory, 'moderation.json');

const defaultModeration = {
  filters: {
    links: true,
    invites: true,
    media: false,
    profanity: true,
    customKeywords: []
  },
  spam: {
    messagesPerMinute: 8,
    autoTimeoutMinutes: 10,
    escalationAfterWarnings: 3
  },
  escalation: {
    warnThreshold: 2,
    timeoutThreshold: 3,
    banThreshold: 5
  },
  alerts: {
    logChannelId: null,
    staffRoleId: null,
    notifyOnAutoAction: true
  },
  support: {
    intakeChannelId: null
  },
  dmTemplates: {
    warn: 'You received a warning in {guild}. Reason: {reason}',
    timeout: 'You have been timed out in {guild} for {duration} minutes. Reason: {reason}',
    ban: 'You have been banned from {guild}. Reason: {reason}'
  }
};

let cachedModeration = null;
let loaded = false;
const subscribers = new Set();

export async function loadModerationConfig() {
  if (loaded && cachedModeration) {
    return cachedModeration;
  }

  try {
    const raw = await fs.readFile(moderationFile, 'utf8');
    cachedModeration = mergeModeration(JSON.parse(raw));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Failed to load moderation configuration:', error);
    }
    cachedModeration = defaultModeration;
    await persistModeration(defaultModeration);
  }

  loaded = true;
  notifySubscribers();
  return cachedModeration;
}

export async function saveModerationConfig(update) {
  const current = await loadModerationConfig();
  const merged = mergeModeration({
    ...current,
    ...update
  });
  cachedModeration = merged;
  loaded = true;
  await persistModeration(merged);
  notifySubscribers();
  return merged;
}

export function getModerationConfigSync() {
  return cachedModeration ?? defaultModeration;
}

export function onModerationConfigChange(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }
  subscribers.add(listener);
  if (cachedModeration) {
    listener(cachedModeration);
  }
  return () => {
    subscribers.delete(listener);
  };
}

function mergeModeration(partial = {}) {
  return {
    filters: mergeFilters(partial.filters ?? {}),
    spam: mergeSpam(partial.spam ?? {}),
    escalation: mergeEscalation(partial.escalation ?? {}),
    alerts: mergeAlerts(partial.alerts ?? {}),
    support: mergeSupport(partial.support ?? {}),
    dmTemplates: mergeTemplates(partial.dmTemplates ?? {})
  };
}

function mergeFilters(filters) {
  return {
    links: filters.links !== undefined ? Boolean(filters.links) : defaultModeration.filters.links,
    invites: filters.invites !== undefined ? Boolean(filters.invites) : defaultModeration.filters.invites,
    media: filters.media !== undefined ? Boolean(filters.media) : defaultModeration.filters.media,
    profanity: filters.profanity !== undefined ? Boolean(filters.profanity) : defaultModeration.filters.profanity,
    customKeywords: Array.isArray(filters.customKeywords)
      ? filters.customKeywords.map((entry) => String(entry || '').trim()).filter(Boolean)
      : defaultModeration.filters.customKeywords
  };
}

function mergeSpam(spam) {
  return {
    messagesPerMinute: clampNumber(spam.messagesPerMinute, 1, 120, defaultModeration.spam.messagesPerMinute),
    autoTimeoutMinutes: clampNumber(spam.autoTimeoutMinutes, 1, 10_080, defaultModeration.spam.autoTimeoutMinutes),
    escalationAfterWarnings: clampNumber(
      spam.escalationAfterWarnings,
      1,
      10,
      defaultModeration.spam.escalationAfterWarnings
    )
  };
}

function mergeEscalation(escalation) {
  return {
    warnThreshold: clampNumber(escalation.warnThreshold, 1, 10, defaultModeration.escalation.warnThreshold),
    timeoutThreshold: clampNumber(escalation.timeoutThreshold, 1, 10, defaultModeration.escalation.timeoutThreshold),
    banThreshold: clampNumber(escalation.banThreshold, 1, 15, defaultModeration.escalation.banThreshold)
  };
}

function mergeAlerts(alerts) {
  return {
    logChannelId: sanitizeId(alerts.logChannelId),
    staffRoleId: sanitizeId(alerts.staffRoleId),
    notifyOnAutoAction:
      alerts.notifyOnAutoAction !== undefined ? Boolean(alerts.notifyOnAutoAction) : defaultModeration.alerts.notifyOnAutoAction
  };
}

function mergeSupport(support) {
  return {
    intakeChannelId: sanitizeId(support.intakeChannelId)
  };
}

function mergeTemplates(templates) {
  const out = {};
  for (const [key, value] of Object.entries(defaultModeration.dmTemplates)) {
    out[key] = typeof templates[key] === 'string' && templates[key].trim().length ? templates[key].trim() : value;
  }
  return out;
}

function sanitizeId(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const str = String(value).trim();
  return /^\d+$/.test(str) ? str : null;
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

async function persistModeration(data) {
  await fs.mkdir(dataDirectory, { recursive: true });
  await fs.writeFile(moderationFile, JSON.stringify(data, null, 2));
}

function notifySubscribers() {
  for (const listener of subscribers) {
    try {
      listener(cachedModeration ?? defaultModeration);
    } catch (error) {
      console.error('Moderation subscriber failed:', error);
    }
  }
}
