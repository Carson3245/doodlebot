import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const auditDirectory = path.resolve(process.cwd(), 'data', 'audit')
const auditFile = path.join(auditDirectory, 'log.json')

const MAX_AUDIT_ENTRIES = 2000

const defaultData = {
  updatedAt: null,
  entries: []
}

let cache = null
let loadingPromise = null

function createId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return crypto.randomBytes(16).toString('hex')
}

function cloneEntry(entry) {
  return {
    id: entry.id,
    action: entry.action,
    actorId: entry.actorId,
    actorTag: entry.actorTag,
    actorRoles: Array.isArray(entry.actorRoles) ? [...entry.actorRoles] : [],
    guildId: entry.guildId,
    targetId: entry.targetId,
    targetType: entry.targetType,
    targetLabel: entry.targetLabel ?? null,
    metadata: entry.metadata ? JSON.parse(JSON.stringify(entry.metadata)) : null,
    createdAt: entry.createdAt
  }
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
      const contents = await fs.readFile(auditFile, 'utf8')
      const parsed = JSON.parse(contents)
      cache = {
        updatedAt: parsed.updatedAt ?? null,
        entries: Array.isArray(parsed.entries) ? parsed.entries.map((entry) => normalizeEntry(entry)) : []
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('Failed to load audit log, falling back to defaults:', error)
      }
      cache = JSON.parse(JSON.stringify(defaultData))
    }
    return cache
  })()

  try {
    return await loadingPromise
  } finally {
    loadingPromise = null
  }
}

function normalizeEntry(entry = {}) {
  const normalized = {
    id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : createId(),
    action: typeof entry.action === 'string' ? entry.action.trim() : 'unknown',
    actorId: entry.actorId ? String(entry.actorId) : null,
    actorTag: typeof entry.actorTag === 'string' ? entry.actorTag : null,
    actorRoles: Array.isArray(entry.actorRoles)
      ? entry.actorRoles.map((role) => String(role).toLowerCase())
      : [],
    guildId: entry.guildId ? String(entry.guildId) : null,
    targetId: entry.targetId ? String(entry.targetId) : null,
    targetType: typeof entry.targetType === 'string' ? entry.targetType.trim() : null,
    targetLabel: typeof entry.targetLabel === 'string' ? entry.targetLabel : null,
    metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : null,
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString()
  }

  return normalized
}

async function persistData(data) {
  await fs.mkdir(auditDirectory, { recursive: true })
  const payload = JSON.stringify(
    {
      updatedAt: data.updatedAt,
      entries: data.entries
    },
    null,
    2
  )
  await fs.writeFile(auditFile, payload)
  cache = data
  return cache
}

export async function recordAuditEntry({
  action,
  actorId = null,
  actorTag = null,
  actorRoles = [],
  guildId = null,
  targetId = null,
  targetType = null,
  targetLabel = null,
  metadata = null
} = {}) {
  const data = await loadData()
  const now = new Date().toISOString()
  const entry = normalizeEntry({
    id: createId(),
    action,
    actorId,
    actorTag,
    actorRoles,
    guildId,
    targetId,
    targetType,
    targetLabel,
    metadata,
    createdAt: now
  })

  data.entries.unshift(entry)
  if (data.entries.length > MAX_AUDIT_ENTRIES) {
    data.entries.length = MAX_AUDIT_ENTRIES
  }
  data.updatedAt = now

  await persistData(data)
  return cloneEntry(entry)
}

export async function listAuditEntries({
  limit = 100,
  offset = 0,
  actorId = null,
  targetId = null,
  guildId = null,
  action = null
} = {}) {
  const data = await loadData()
  const normalizedLimit = Math.min(Math.max(Number(limit) || 25, 1), 250)
  const normalizedOffset = Math.max(Number(offset) || 0, 0)

  let entries = data.entries
  if (actorId) {
    entries = entries.filter((entry) => entry.actorId === String(actorId))
  }
  if (targetId) {
    entries = entries.filter((entry) => entry.targetId === String(targetId))
  }
  if (guildId) {
    entries = entries.filter((entry) => entry.guildId === String(guildId))
  }
  if (action) {
    const normalizedAction = String(action).toLowerCase()
    entries = entries.filter((entry) => entry.action.toLowerCase() === normalizedAction)
  }

  const total = entries.length
  const sliced = entries.slice(normalizedOffset, normalizedOffset + normalizedLimit).map(cloneEntry)

  return {
    total,
    limit: normalizedLimit,
    offset: normalizedOffset,
    entries: sliced
  }
}

export async function clearAuditLog() {
  const data = {
    updatedAt: new Date().toISOString(),
    entries: []
  }
  await persistData(data)
  return data
}

export async function getAuditStats() {
  const data = await loadData()
  return {
    updatedAt: data.updatedAt,
    totalEntries: data.entries.length
  }
}
