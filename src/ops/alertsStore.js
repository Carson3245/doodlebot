import crypto from 'node:crypto'
import { readJson, writeJson } from '../control-center/data/jsonStore.js'

const ALERTS_FILE = 'ops/alerts.json'

const defaultData = {
  updatedAt: null,
  alerts: []
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
      const payload = await readJson(ALERTS_FILE, defaultData)
      cache = normalizeData(payload)
      return cache
    } catch (error) {
      console.warn('Failed to load alerts dataset, using defaults:', error)
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
  const alerts = Array.isArray(source.alerts) ? source.alerts : []
  return {
    updatedAt: source.updatedAt ?? null,
    alerts: alerts.map((alert) => normalizeAlert(alert)).filter(Boolean)
  }
}

function normalizeAlert(alert) {
  if (!alert || typeof alert !== 'object') {
    return null
  }
  const id = alert.id ? String(alert.id) : createId()
  const guildId = alert.guild_id ?? alert.guildId
  if (!guildId) {
    return null
  }
  return {
    id,
    guildId: String(guildId),
    ruleKey: alert.ruleKey ?? alert.rule_key ?? 'custom',
    title: alert.title ?? 'Alert',
    body: alert.body ?? alert.description ?? '',
    severity: alert.severity ?? 'info',
    state: alert.state ?? 'open',
    actions: Array.isArray(alert.actions) ? alert.actions : [],
    createdAt: alert.createdAt ?? alert.created_at ?? new Date().toISOString(),
    updatedAt: alert.updatedAt ?? alert.updated_at ?? new Date().toISOString(),
    resolvedAt: alert.resolvedAt ?? alert.resolved_at ?? null,
    meta: alert.meta && typeof alert.meta === 'object' ? { ...alert.meta } : {}
  }
}

function createId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex')
}

async function persist(data) {
  const payload = {
    updatedAt: data.updatedAt ?? new Date().toISOString(),
    alerts: data.alerts
  }
  await writeJson(ALERTS_FILE, payload)
  cache = payload
  return cache
}

export async function listAlerts({ guildId = null, state = null } = {}) {
  const data = await loadData()
  let items = data.alerts
  if (guildId) {
    const normalizedGuild = String(guildId)
    items = items.filter((alert) => alert.guildId === normalizedGuild)
  }
  if (state) {
    const normalizedState = String(state).toLowerCase()
    items = items.filter((alert) => alert.state === normalizedState)
  }
  return items
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export async function getAlertById(alertId) {
  const data = await loadData()
  return data.alerts.find((alert) => alert.id === String(alertId)) ?? null
}

export async function findOpenAlert({ guildId, ruleKey }) {
  if (!guildId || !ruleKey) {
    return null
  }
  const data = await loadData()
  return (
    data.alerts.find(
      (alert) => alert.guildId === String(guildId) && alert.ruleKey === ruleKey && alert.state === 'open'
    ) ?? null
  )
}

export async function createAlert(entry) {
  const data = await loadData()
  const alert = normalizeAlert({
    ...entry,
    id: entry.id ?? createId(),
    createdAt: entry.createdAt ?? new Date().toISOString(),
    updatedAt: entry.updatedAt ?? new Date().toISOString(),
    state: entry.state ?? 'open'
  })
  data.alerts.push(alert)
  data.updatedAt = new Date().toISOString()
  await persist(data)
  return alert
}

export async function updateAlert(alertId, updater) {
  const data = await loadData()
  const index = data.alerts.findIndex((alert) => alert.id === String(alertId))
  if (index === -1) {
    return null
  }
  const current = data.alerts[index]
  const next = normalizeAlert({ ...current, ...updater, id: current.id, guildId: current.guildId })
  data.alerts[index] = { ...next, updatedAt: new Date().toISOString() }
  data.updatedAt = new Date().toISOString()
  await persist(data)
  return data.alerts[index]
}

export async function resolveAlert(alertId) {
  return updateAlert(alertId, {
    state: 'resolved',
    resolvedAt: new Date().toISOString()
  })
}

export async function resetAlertsData() {
  cache = null
  await writeJson(ALERTS_FILE, clone(defaultData))
}
