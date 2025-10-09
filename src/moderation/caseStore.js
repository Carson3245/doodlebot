import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const moderationDirectory = path.resolve(process.cwd(), 'data', 'moderation')
const casesFile = path.join(moderationDirectory, 'cases.json')

const MAX_CASES = 500
const MAX_MESSAGES_PER_CASE = 400
const MAX_ACTIONS_PER_CASE = 100

const defaultData = {
  updatedAt: null,
  stats: {
    warnings: 0,
    timeouts: 0,
    bans: 0,
    cases: 0
  },
  cases: [],
  userTotals: {}
}

let cache = null
let loaded = false

export async function recordCase(entry) {
  validateCasePayload(entry)
  const data = await loadData()
  const now = new Date().toISOString()
  const { caseEntry, created } = getOrCreateActiveCase(data, entry, now)

  const actionRecord = createActionRecord(entry, now)
  caseEntry.actions.unshift(actionRecord)
  caseEntry.actions.splice(MAX_ACTIONS_PER_CASE)

  const systemMessage = createMessage({
    authorType: 'system',
    body: buildSystemMessage(entry),
    via: entry.source ?? 'system'
  })
  caseEntry.messages.push(systemMessage)
  trimMessages(caseEntry)

  const auditRecord = {
    id: createId(),
    type: 'action',
    action: entry.action,
    moderatorId: entry.moderatorId ? String(entry.moderatorId) : null,
    moderatorTag: entry.moderatorTag ?? null,
    createdAt: now,
    metadata: entry.metadata ?? null
  }
  caseEntry.auditLog.push(auditRecord)

  caseEntry.updatedAt = now
  caseEntry.lastMessageAt = now

  const statsKey = actionToStatKey(entry.action)
  if (statsKey) {
    data.stats[statsKey] = (data.stats[statsKey] ?? 0) + 1
  }

  if (created) {
    data.stats.cases = (data.stats.cases ?? 0) + 1
    data.updatedAt = now
  }

  const totals = updateUserTotals(data, caseEntry, statsKey, now)
  sortCases(data)
  await persistData(data)

  return {
    entry: caseEntry,
    action: actionRecord,
    totals
  }
}

export async function ensureMemberCase({
  guildId,
  guildName,
  userId,
  userTag,
  reason,
  initialMessage
}) {
  if (!guildId || !userId) {
    throw new Error('guildId and userId are required to open a member case')
  }
  const data = await loadData()
  const now = new Date().toISOString()

  const existing = data.cases.find(
    (item) => item.guildId === String(guildId) && item.userId === String(userId) && item.status !== 'closed'
  )

  if (existing) {
    if (initialMessage) {
      const message = createMessage({
        authorType: 'member',
        authorId: String(userId),
        authorTag: userTag ?? null,
        body: initialMessage,
        via: 'member'
      })
      existing.messages.push(message)
      trimMessages(existing)
      existing.lastMessageAt = message.createdAt
      existing.updatedAt = message.createdAt
      await persistData(data)
    }
    return existing
  }

  const newCase = createCaseShell({
    guildId,
    guildName,
    userId,
    userTag,
    openedBy: {
      type: 'member',
      id: String(userId),
      tag: userTag ?? null,
      at: now,
      reason: reason ?? null
    },
    source: 'member',
    status: 'open'
  })

  if (reason) {
    newCase.metadata.reason = reason
  }

  if (initialMessage) {
    newCase.messages.push(
      createMessage({
        authorType: 'member',
        authorId: String(userId),
        authorTag: userTag ?? null,
        body: initialMessage,
        via: 'member'
      })
    )
  }

  newCase.lastMessageAt = newCase.messages[0]?.createdAt ?? now
  newCase.updatedAt = now

  data.cases.unshift(newCase)
  trimCaseList(data)
  await persistData(data)
  return newCase
}

export async function appendCaseMessage({
  guildId,
  caseId,
  authorType,
  authorId,
  authorTag,
  body,
  via
}) {
  if (!body || !body.trim()) {
    throw new Error('Message body cannot be empty')
  }

  const data = await loadData()
  const caseEntry = findCase(data, guildId, caseId)
  if (!caseEntry) {
    throw new Error('Case not found')
  }

  const message = createMessage({
    authorType,
    authorId,
    authorTag,
    body,
    via
  })
  caseEntry.messages.push(message)
  trimMessages(caseEntry)

  caseEntry.lastMessageAt = message.createdAt
  caseEntry.updatedAt = message.createdAt

  caseEntry.auditLog.push({
    id: createId(),
    type: 'message',
    authorType,
    authorId: authorId ? String(authorId) : null,
    authorTag: authorTag ?? null,
    createdAt: message.createdAt
  })

  await persistData(data)
  return message
}

export async function updateCaseStatus({ guildId, caseId, status, actorId, actorTag, note }) {
  if (!['open', 'pending', 'closed'].includes(status)) {
    throw new Error('Invalid case status')
  }

  const data = await loadData()
  const caseEntry = findCase(data, guildId, caseId)
  if (!caseEntry) {
    throw new Error('Case not found')
  }

  const now = new Date().toISOString()
  caseEntry.status = status
  caseEntry.updatedAt = now
  caseEntry.auditLog.push({
    id: createId(),
    type: 'status',
    status,
    note: note ?? null,
    actorId: actorId ? String(actorId) : null,
    actorTag: actorTag ?? null,
    createdAt: now
  })

  await persistData(data)
  return caseEntry
}

export async function listCases({ guildId, status, limit = 50 }) {
  const data = await loadData()
  let items = data.cases.filter((item) => item.guildId === String(guildId))
  if (status && status !== 'all') {
    items = items.filter((item) => item.status === status)
  }
  return items.slice(0, Math.max(0, Math.min(limit, MAX_CASES)))
}

export async function getCase(caseId) {
  const data = await loadData()
  return data.cases.find((entry) => entry.id === caseId) ?? null
}

export async function getCaseForGuild(guildId, caseId) {
  const data = await loadData()
  return data.cases.find((entry) => entry.id === caseId && entry.guildId === String(guildId)) ?? null
}

export async function getModerationStats() {
  const data = await loadData()
  return {
    updatedAt: data.updatedAt,
    warnings: data.stats.warnings ?? 0,
    timeouts: data.stats.timeouts ?? 0,
    bans: data.stats.bans ?? 0,
    cases: data.stats.cases ?? data.cases.length
  }
}

export async function getRecentCases(limit = 50) {
  const data = await loadData()
  return data.cases.slice(0, Math.max(0, Math.min(limit, MAX_CASES)))
}

export async function getUserTotals(guildId, userId) {
  if (!guildId || !userId) {
    return defaultTotals()
  }
  const data = await loadData()
  const totalsKey = getTotalsKey(guildId, userId)
  return data.userTotals[totalsKey] ? { ...data.userTotals[totalsKey] } : defaultTotals()
}

function validateCasePayload(entry = {}) {
  if (!entry.guildId || !entry.userId || !entry.action) {
    throw new Error('Invalid moderation case payload')
  }
}

function getOrCreateActiveCase(data, entry, now) {
  const guildId = String(entry.guildId)
  const userId = String(entry.userId)
  const existing = data.cases.find(
    (item) => item.guildId === guildId && item.userId === userId && item.status !== 'closed'
  )

  if (existing) {
    return { caseEntry: existing, created: false }
  }

  const newCase = createCaseShell({
    guildId,
    guildName: entry.guildName,
    userId,
    userTag: entry.userTag,
    status: entry.status ?? 'open',
    source: entry.source ?? 'system',
    openedBy: {
      type: entry.moderatorId ? 'moderator' : 'system',
      id: entry.moderatorId ? String(entry.moderatorId) : 'system',
      tag: entry.moderatorTag ?? null,
      at: now,
      reason: entry.reason ?? null
    }
  })

  data.cases.unshift(newCase)
  trimCaseList(data)
  return { caseEntry: newCase, created: true }
}

function createCaseShell({ guildId, guildName, userId, userTag, status, source, openedBy }) {
  const now = new Date().toISOString()
  return {
    id: createId(),
    guildId: String(guildId),
    guildName: guildName ?? null,
    userId: String(userId),
    userTag: userTag ?? null,
    status: status ?? 'open',
    source: source ?? 'system',
    metadata: {},
    openedBy: openedBy ?? {
      type: 'system',
      id: 'system',
      at: now
    },
    createdAt: now,
    updatedAt: now,
    lastMessageAt: null,
    actions: [],
    messages: [],
    auditLog: []
  }
}

function createActionRecord(entry, createdAt) {
  return {
    id: createId(),
    type: entry.action,
    reason: entry.reason ?? null,
    durationMinutes: entry.durationMinutes ?? null,
    moderatorId: entry.moderatorId ? String(entry.moderatorId) : null,
    moderatorTag: entry.moderatorTag ?? null,
    createdAt,
    source: entry.source ?? 'system',
    metadata: entry.metadata ?? null
  }
}

function buildSystemMessage(entry) {
  const parts = []
  if (entry.action === 'warn') {
    parts.push('Automatic warning issued.')
  } else if (entry.action === 'timeout') {
    parts.push(
      `Automatic timeout issued${entry.durationMinutes ? ` for ${entry.durationMinutes} minute(s)` : ''}.`
    )
  } else if (entry.action === 'ban') {
    parts.push('Automatic ban issued.')
  } else {
    parts.push('Moderation action recorded.')
  }
  if (entry.reason) {
    parts.push(`Reason: ${entry.reason}`)
  }
  return parts.join(' ')
}

function createMessage({ authorType, authorId, authorTag, body, via }) {
  return {
    id: createId(),
    authorType,
    authorId: authorId ? String(authorId) : null,
    authorTag: authorTag ?? null,
    body: String(body ?? '').trim(),
    via: via ?? null,
    createdAt: new Date().toISOString()
  }
}

function updateUserTotals(data, caseEntry, statsKey, now) {
  const key = getTotalsKey(caseEntry.guildId, caseEntry.userId)
  const previous = data.userTotals[key] ?? defaultTotals()
  const totals = {
    ...previous,
    cases: (previous.cases ?? 0) + 1,
    lastActionAt: now
  }

  if (statsKey && statsKey in totals) {
    totals[statsKey] = (previous[statsKey] ?? 0) + 1
  }

  data.userTotals[key] = totals
  return { ...totals }
}

function findCase(data, guildId, caseId) {
  return data.cases.find(
    (entry) => entry.id === caseId && (!guildId || entry.guildId === String(guildId))
  )
}

function trimMessages(caseEntry) {
  if (caseEntry.messages.length > MAX_MESSAGES_PER_CASE) {
    caseEntry.messages.splice(0, caseEntry.messages.length - MAX_MESSAGES_PER_CASE)
  }
}

function trimCaseList(data) {
  if (data.cases.length > MAX_CASES) {
    data.cases.length = MAX_CASES
  }
}

function sortCases(data) {
  data.cases.sort((a, b) => {
    const left = a.updatedAt ?? a.createdAt
    const right = b.updatedAt ?? b.createdAt
    return right.localeCompare(left)
  })
}

function actionToStatKey(action) {
  switch (action) {
    case 'warn':
      return 'warnings'
    case 'timeout':
      return 'timeouts'
    case 'ban':
      return 'bans'
    default:
      return null
  }
}

function getTotalsKey(guildId, userId) {
  return `${guildId}:${userId}`
}

function defaultTotals() {
  return {
    warnings: 0,
    timeouts: 0,
    bans: 0,
    cases: 0,
    lastActionAt: null
  }
}

function createId() {
  return crypto.randomBytes(8).toString('hex')
}

async function loadData() {
  if (loaded && cache) {
    return cache
  }

  try {
    const raw = await fs.readFile(casesFile, 'utf8')
    cache = mergeWithDefaults(JSON.parse(raw))
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Failed to load moderation cases:', error)
    }
    cache = JSON.parse(JSON.stringify(defaultData))
    await persistData(cache)
  }

  loaded = true
  return cache
}

function mergeWithDefaults(raw = {}) {
  const data = {
    updatedAt: raw.updatedAt ?? null,
    stats: {
      warnings: raw.stats?.warnings ?? 0,
      timeouts: raw.stats?.timeouts ?? 0,
      bans: raw.stats?.bans ?? 0,
      cases: raw.stats?.cases ?? (Array.isArray(raw.cases) ? raw.cases.length : 0)
    },
    cases: [],
    userTotals: {}
  }

  if (Array.isArray(raw.cases)) {
    data.cases = raw.cases
      .map((item) => ({
        id: item.id ?? createId(),
        guildId: item.guildId ? String(item.guildId) : null,
        guildName: item.guildName ?? null,
        userId: item.userId ? String(item.userId) : null,
        userTag: item.userTag ?? null,
        status: ['open', 'pending', 'closed'].includes(item.status) ? item.status : 'open',
        source: item.source ?? 'system',
        metadata: typeof item.metadata === 'object' && item.metadata !== null ? item.metadata : {},
        openedBy: item.openedBy ?? null,
        createdAt: item.createdAt ?? new Date().toISOString(),
        updatedAt: item.updatedAt ?? item.createdAt ?? new Date().toISOString(),
        lastMessageAt: item.lastMessageAt ?? null,
        actions: Array.isArray(item.actions) ? item.actions.slice(0, MAX_ACTIONS_PER_CASE) : [],
        messages: Array.isArray(item.messages) ? item.messages.slice(-MAX_MESSAGES_PER_CASE) : [],
        auditLog: Array.isArray(item.auditLog) ? item.auditLog.slice(-MAX_MESSAGES_PER_CASE) : []
      }))
      .filter((item) => item.guildId && item.userId)
  }

  if (raw.userTotals && typeof raw.userTotals === 'object') {
    for (const [key, value] of Object.entries(raw.userTotals)) {
      data.userTotals[key] = {
        warnings: value?.warnings ?? 0,
        timeouts: value?.timeouts ?? 0,
        bans: value?.bans ?? 0,
        cases: value?.cases ?? 0,
        lastActionAt: value?.lastActionAt ?? null
      }
    }
  }

  sortCases(data)
  return data
}

async function persistData(data) {
  cache = data
  loaded = true
  await fs.mkdir(moderationDirectory, { recursive: true })
  await fs.writeFile(casesFile, JSON.stringify(data, null, 2))
}
