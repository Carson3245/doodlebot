import { readJson, writeJson } from '../control-center/data/jsonStore.js'

const RULES_FILE = 'ops/alerts.rules.json'

const DEFAULT_RULES = [
  {
    key: 'leave_spike',
    title: 'Leave spike',
    description: 'Exits are >=2x last month',
    severity: 'high',
    threshold: { multiplier: 2, minimum: 5, percent: 0.05 },
    actions: ['dashboard']
  },
  {
    key: 'moderation_load',
    title: 'Moderation load',
    description: 'Auto actions ran N times in 24h',
    severity: 'medium',
    params: { threshold: 15 },
    actions: ['dashboard']
  },
  {
    key: 'channel_silence',
    title: 'Channel silence',
    description: 'No messages in a watched channel for X days',
    severity: 'low',
    params: { channelIds: [], days: 3 },
    actions: ['dashboard']
  },
  {
    key: 'unverified_backlog',
    title: 'Verification backlog',
    description: 'Pending verification queue above threshold',
    severity: 'medium',
    params: { threshold: 5 },
    actions: ['dashboard']
  },
  {
    key: 'message_surge',
    title: 'Message surge',
    description: 'Channel messages today spiked',
    severity: 'medium',
    params: { multiplier: 2 },
    actions: ['dashboard']
  },
  {
    key: 'voice_spike',
    title: 'Voice time spike',
    description: 'Voice minutes today spiked',
    severity: 'low',
    params: { multiplier: 2 },
    actions: ['dashboard']
  }
]

let cachedRules = null
let loadingPromise = null

export async function loadAlertRules() {
  if (cachedRules) {
    return cachedRules
  }
  if (loadingPromise) {
    return loadingPromise
  }
  loadingPromise = (async () => {
    try {
      const rules = await readJson(RULES_FILE, DEFAULT_RULES)
      cachedRules = Array.isArray(rules) ? rules : DEFAULT_RULES
    } catch (error) {
      console.warn('Failed to load alert rules, using defaults:', error)
      cachedRules = DEFAULT_RULES
    }
    return cachedRules
  })()
  try {
    return await loadingPromise
  } finally {
    loadingPromise = null
  }
}

export async function saveAlertRules(rules) {
  const normalized = Array.isArray(rules) ? rules : DEFAULT_RULES
  await writeJson(RULES_FILE, normalized)
  cachedRules = normalized
  return normalized
}

export function resetAlertRulesCache() {
  cachedRules = null
}
