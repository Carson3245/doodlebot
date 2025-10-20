import { readJson, writeJson } from '../control-center/data/jsonStore.js'

const ACTIONS_FILE = 'moderation/actions.json'

const defaultData = {
  updatedAt: null,
  actions: []
}

let cache = null
let loadingPromise = null

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

async function loadData() {
  if (cache) {
    return cache
  }
  if (loadingPromise) {
    return loadingPromise
  }
  loadingPromise = (async () => {
    try {
      const payload = await readJson(ACTIONS_FILE, defaultData)
      cache = normalizeData(payload)
      return cache
    } catch (error) {
      console.warn('Failed to load moderation actions dataset:', error)
      cache = clone(defaultData)
      return cache
    }
  })()
  try {
    return await loadingPromise
  } finally {
    loadingPromise = null
  }
}

function normalizeData(input) {
  const source = input && typeof input === 'object' ? input : defaultData
  const actions = Array.isArray(source.actions) ? source.actions : []
  return {
    updatedAt: source.updatedAt ?? null,
    actions: actions.map((action) => normalizeAction(action)).filter(Boolean)
  }
}

function normalizeAction(action) {
  if (!action || typeof action !== 'object') {
    return null
  }
  const id = action.id ? String(action.id) : createId()
  const guildId = action.guild_id ?? action.guildId
  const memberId = action.member_id ?? action.memberId
  if (!guildId || !memberId) {
    return null
  }
  return {
    id,
    guildId: String(guildId),
    memberId: String(memberId),
    action: typeof action.action === 'string' ? action.action : 'note',
    reason: typeof action.reason === 'string' ? action.reason : null,
    actorId: action.actor_id ? String(action.actor_id) : null,
    actorTag: typeof action.actor_tag === 'string' ? action.actor_tag : null,
    createdAt: normalizeDate(action.created_at ?? action.createdAt) ?? new Date().toISOString(),
    durationSec: Number.isFinite(Number(action.duration_sec ?? action.durationSec))
      ? Number(action.duration_sec ?? action.durationSec)
      : null,
    evidenceUrl: typeof action.evidence_url === 'string' ? action.evidence_url : null,
    dmUser: Boolean(action.dm_user ?? action.dmUser ?? false),
    metadata: action.metadata && typeof action.metadata === 'object' ? { ...action.metadata } : {}
  }
}

function normalizeDate(value) {
  if (!value) {
    return null
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  return parsed.toISOString()
}

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

async function persist(data) {
  const payload = {
    updatedAt: data.updatedAt ?? new Date().toISOString(),
    actions: data.actions
  }
  await writeJson(ACTIONS_FILE, payload)
  cache = payload
  return cache
}

export async function recordModerationAction(entry) {
  const data = await loadData()
  const normalized = normalizeAction(entry)
  if (!normalized) {
    throw new Error('Invalid moderation action payload')
  }
  const now = new Date().toISOString()
  data.actions.push({ ...normalized, createdAt: normalized.createdAt ?? now })
  data.updatedAt = now
  await persist(data)
  return { ...normalized }
}

export async function listModerationActions({ guildId = null, memberId = null } = {}) {
  const data = await loadData()
  let results = data.actions
  if (guildId) {
    const normalized = String(guildId)
    results = results.filter((action) => action.guildId === normalized)
  }
  if (memberId) {
    const normalized = String(memberId)
    results = results.filter((action) => action.memberId === normalized)
  }
  return results
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((action) => ({ ...action }))
}

export async function resetModerationActions() {
  cache = null
  await writeJson(ACTIONS_FILE, clone(defaultData))
}
