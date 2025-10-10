import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'

const moderationDirectory = path.resolve(process.cwd(), 'data', 'moderation')
const casesFile = path.join(moderationDirectory, 'cases.json')

const MAX_CASES = 500
const MAX_MESSAGES_PER_CASE = 400
const MAX_ACTIONS_PER_CASE = 100
const MAX_AUDIT_LOG_ENTRIES = 400
const MAX_PARTICIPANTS = 25

const STATUS_ALIASES = new Map([
  ['pendingresponse', 'pending-response'],
  ['pending-response', 'pending-response'],
  ['waiting', 'pending-response'],
  ['escalated', 'escalated'],
  ['pending', 'pending'],
  ['closed', 'closed'],
  ['archived', 'archived'],
  ['archive', 'archived'],
  ['open', 'open']
])

const DEFAULT_STATUS = 'open'

const TERMINAL_STATUSES = new Set(['closed', 'archived'])

const defaultData = {
  updatedAt: null,
  stats: {
    warnings: 0,
    timeouts: 0,
    bans: 0,
    kicks: 0,
    cases: 0
  },
  cases: [],
  userTotals: {}
}

let cache = null
let loaded = false

const storeEvents = new EventEmitter()
storeEvents.setMaxListeners(50)

function emitStoreEvent(type, payload) {
  const envelope = {
    type,
    payload: payload ?? null,
    timestamp: new Date().toISOString()
  }
  storeEvents.emit('event', envelope)
}

export function onModerationStoreEvent(listener) {
  if (typeof listener !== 'function') {
    return () => {}
  }
  storeEvents.on('event', listener)
  return () => {
    storeEvents.off('event', listener)
  }
}

export async function recordCase(entry) {
  validateCasePayload(entry)
  const data = await loadData()
  const now = new Date().toISOString()
  const { caseEntry, created } = getOrCreateActiveCase(data, entry, now)

  ensureParticipant(caseEntry, {
    type: 'member',
    id: caseEntry.userId,
    tag: caseEntry.userTag ?? null
  })
  if (entry.moderatorId) {
    ensureParticipant(caseEntry, {
      type: 'moderator',
      id: entry.moderatorId,
      tag: entry.moderatorTag ?? null
    })
  }
  assignCaseSubject(caseEntry, entry)

  const actionRecord = createActionRecord(entry, now)
  caseEntry.actions.unshift(actionRecord)
  caseEntry.actions.splice(MAX_ACTIONS_PER_CASE)

  const systemMessage = createMessage({
    authorType: 'system',
    body: buildSystemMessage(entry),
    via: entry.source ?? 'system'
  })
  registerCaseMessage(data, caseEntry, systemMessage, { markUnread: false })

  const auditRecord = {
    id: createId(),
    type: 'action',
    action: entry.action,
    moderatorId: entry.moderatorId ? String(entry.moderatorId) : null,
    moderatorTag: entry.moderatorTag ?? null,
    actorType: entry.moderatorId ? 'moderator' : 'system',
    createdAt: now,
    metadata: entry.metadata ?? null
  }
  caseEntry.auditLog.push(auditRecord)
  trimAuditLog(caseEntry)

  caseEntry.updatedAt = now
  caseEntry.lastMessageAt = now
  data.updatedAt = now

  const statsKey = actionToStatKey(entry.action)
  if (statsKey) {
    data.stats[statsKey] = (data.stats[statsKey] ?? 0) + 1
  }

  if (created) {
    data.stats.cases = (data.stats.cases ?? 0) + 1
    data.updatedAt = now
  }

  const totals = updateUserTotals(data, caseEntry, statsKey, now, created)
  sortCases(data)
  await persistData(data)

  emitStoreEvent('stats:updated', buildStatsSnapshot(data))
  emitStoreEvent('cases:updated', summarizeCaseUpdate(caseEntry))

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
  initialMessage,
  category = 'moderation',
  ticketType = null,
  supportTopicLabel = null,
  supportContext = null,
  allowExisting = true,
  source = 'member',
  intakeChannelId = null,
  intakeThreadId = null,
  intakeMessageId = null
}) {
  if (!guildId || !userId) {
    throw new Error('guildId and userId are required to open a member case')
  }
  const data = await loadData()
  const now = new Date().toISOString()
  const normalizedCategory = normalizeCategory(category)

  const existing =
    allowExisting === false
      ? null
      : data.cases.find(
          (item) =>
            item.guildId === String(guildId) &&
            item.userId === String(userId) &&
            !isTerminalStatus(item.status) &&
            normalizeCategory(item.category) === normalizedCategory
        )

  if (existing) {
    let updated = false
    ensureParticipant(existing, {
      type: 'member',
      id: String(userId),
      tag: userTag ?? null
    })
    if (reason && (!existing.metadata || !existing.metadata.reason)) {
      existing.metadata = buildInitialMetadata({ metadata: existing.metadata, reason })
      updated = true
    }
    if (supportTopicLabel) {
      existing.metadata = buildInitialMetadata({
        metadata: existing.metadata,
        supportTopicLabel,
        reason: existing.metadata?.reason ?? reason ?? null,
        supportContext: supportContext ?? existing.metadata?.supportContext ?? null
      })
      updated = true
    }
    if (supportContext && existing.metadata?.supportContext !== supportContext) {
      existing.metadata = buildInitialMetadata({
        metadata: existing.metadata,
        supportContext,
        reason: existing.metadata?.reason ?? reason ?? null,
        supportTopicLabel: supportTopicLabel ?? existing.metadata?.supportTopic ?? null
      })
      updated = true
    }
    if (ticketType && existing.ticketType !== String(ticketType)) {
      existing.ticketType = String(ticketType)
      updated = true
    }
    if (intakeChannelId && existing.intakeChannelId !== String(intakeChannelId)) {
      existing.intakeChannelId = String(intakeChannelId)
      updated = true
    }
    if (intakeThreadId && existing.intakeThreadId !== String(intakeThreadId)) {
      existing.intakeThreadId = String(intakeThreadId)
      updated = true
    }
    if (intakeMessageId && existing.intakeMessageId !== String(intakeMessageId)) {
      existing.intakeMessageId = String(intakeMessageId)
      updated = true
    }
    if (initialMessage) {
      const message = createMessage({
        authorType: 'member',
        authorId: String(userId),
        authorTag: userTag ?? null,
        body: initialMessage,
        via: 'member'
      })
      registerCaseMessage(data, existing, message)
      applyCaseStatus(
        data,
        existing,
        'pending-response',
        {
          type: 'member',
          id: String(userId),
          tag: userTag ?? null,
          note: 'Member sent a new message when opening the case.'
        },
        message.createdAt
      )
      await persistData(data)
      emitStoreEvent('case:message', {
        guildId: existing.guildId,
        caseId: existing.id,
        message
      })
      emitStoreEvent('cases:updated', summarizeCaseUpdate(existing))
      emitStoreEvent('stats:updated', buildStatsSnapshot(data))
      return { case: existing, created: false, message }
    }
    if (updated) {
      existing.updatedAt = now
      data.updatedAt = now
      await persistData(data)
      emitStoreEvent('cases:updated', summarizeCaseUpdate(existing))
    }
    return { case: existing, created: false, message: null }
  }

  const metadata = buildInitialMetadata({
    metadata: {},
    reason,
    supportTopicLabel,
    supportContext
  })

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
    source: source ?? 'member',
    status: initialMessage ? 'pending-response' : 'open',
    category: normalizedCategory,
    ticketType,
    metadata,
    intakeChannelId,
    intakeThreadId,
    intakeMessageId
  })

  ensureParticipant(newCase, {
    type: 'member',
    id: String(userId),
    tag: userTag ?? null
  })
  assignCaseSubject(newCase, {
    reason,
    supportTopicLabel,
    category: normalizedCategory
  })

  let appendedMessage = null
  if (initialMessage) {
    const message = createMessage({
      authorType: 'member',
      authorId: String(userId),
      authorTag: userTag ?? null,
      body: initialMessage,
      via: 'member'
    })
    registerCaseMessage(data, newCase, message)
    applyCaseStatus(data, newCase, 'pending-response', {
      type: 'member',
      id: String(userId),
      tag: userTag ?? null,
      note: 'Member opened a new support case.'
    }, message.createdAt)
    appendedMessage = message
  }

  newCase.lastMessageAt = newCase.messages[0]?.createdAt ?? now
  newCase.updatedAt = now
  data.stats.cases = (data.stats.cases ?? 0) + 1
  data.updatedAt = now

  data.cases.unshift(newCase)
  trimCaseList(data)
  await persistData(data)
  emitStoreEvent('case:created', summarizeCaseUpdate(newCase))
  if (newCase.messages[0]) {
    emitStoreEvent('case:message', {
      guildId: newCase.guildId,
      caseId: newCase.id,
      message: newCase.messages[0]
    })
  }
  emitStoreEvent('cases:updated', summarizeCaseUpdate(newCase))
  emitStoreEvent('stats:updated', buildStatsSnapshot(data))
  return { case: newCase, created: true, message: appendedMessage }
}

async function findActiveCaseForMemberInternal(userId) {
  if (!userId) {
    return null
  }

  const data = await loadData()
  const key = String(userId)
  const candidates = data.cases
    .filter((entry) => entry.userId === key)
    .sort((left, right) => {
      const leftTimestamp = left.lastMessageAt ?? left.updatedAt ?? left.createdAt ?? ''
      const rightTimestamp = right.lastMessageAt ?? right.updatedAt ?? right.createdAt ?? ''
      return rightTimestamp.localeCompare(leftTimestamp)
    })

  if (!candidates.length) {
    return null
  }

  const active = candidates.find((entry) => !isTerminalStatus(entry.status ?? DEFAULT_STATUS))
  const selected = active ?? candidates[0]
  return { ...selected }
}

export { findActiveCaseForMemberInternal as findActiveCaseForMember }

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

  const normalizedAuthorType = typeof authorType === 'string' ? authorType.toLowerCase() : 'system'
  if (normalizedAuthorType === 'bot') {
    return null
  }

  const data = await loadData()
  const caseEntry = findCase(data, guildId, caseId)
  if (!caseEntry) {
    throw new Error('Case not found')
  }

  const message = createMessage({
    authorType: normalizedAuthorType,
    authorId,
    authorTag,
    body,
    via
  })
  registerCaseMessage(data, caseEntry, message)
  if (authorType === 'member') {
    applyCaseStatus(data, caseEntry, 'pending-response', {
      type: 'member',
      id: authorId ? String(authorId) : null,
      tag: authorTag ?? null,
      note: 'Member replied via bot channel.'
    }, message.createdAt)
  }
  await persistData(data)
  emitStoreEvent('case:message', {
    guildId: caseEntry.guildId,
    caseId: caseEntry.id,
    message
  })
  emitStoreEvent('cases:updated', summarizeCaseUpdate(caseEntry))
  emitStoreEvent('stats:updated', buildStatsSnapshot(data))
  return message
}

export async function updateCaseStatus({
  guildId,
  caseId,
  status,
  actorId,
  actorTag,
  actorType = 'system',
  note
}) {
  const normalized = normalizeStatus(status)
  if (!normalized) {
    throw new Error('Invalid case status')
  }

  const data = await loadData()
  const caseEntry = findCase(data, guildId, caseId)
  if (!caseEntry) {
    throw new Error('Case not found')
  }

  const now = new Date().toISOString()
  applyCaseStatus(
    data,
    caseEntry,
    normalized,
    {
      type: actorType,
      id: actorId ? String(actorId) : null,
      tag: actorTag ?? null,
      note: note ?? null
    },
    now
  )

  await persistData(data)
  emitStoreEvent('case:status', summarizeCaseUpdate(caseEntry))
  emitStoreEvent('cases:updated', summarizeCaseUpdate(caseEntry))
  emitStoreEvent('stats:updated', buildStatsSnapshot(data))
  return caseEntry
}

export async function deleteCase({ guildId, caseId, actorId, actorTag, actorType = 'system' }) {
  if (!caseId) {
    throw new Error('Case ID is required to delete a case')
  }

  const data = await loadData()
  const index = data.cases.findIndex(
    (entry) => entry.id === caseId && (!guildId || entry.guildId === String(guildId))
  )

  if (index === -1) {
    throw new Error('Case not found')
  }

  const [removed] = data.cases.splice(index, 1)
  const now = new Date().toISOString()
  data.updatedAt = now

  adjustStatsAfterRemoval(data, removed)
  rebuildUserTotalsForMember(data, removed.guildId, removed.userId)
  sortCases(data)
  await persistData(data)

  const payload = {
    guildId: removed.guildId ?? null,
    caseId: removed.id ?? caseId,
    actorId: actorId ? String(actorId) : null,
    actorTag: actorTag ?? null,
    actorType: actorType ?? 'system'
  }

  emitStoreEvent('case:deleted', payload)
  emitStoreEvent('cases:updated', { ...payload, deleted: true })
  emitStoreEvent('stats:updated', buildStatsSnapshot(data))

  return removed
}

export async function listCases({ guildId, status, category = 'all', limit = 50 }) {
  const data = await loadData()
  let items = data.cases.filter((item) => item.guildId === String(guildId))
  if (status && status !== 'all') {
    const normalized = normalizeStatus(status)
    if (!normalized) {
      return []
    }
    items = items.filter((item) => item.status === normalized)
  }
  const normalizedCategory = String(category ?? 'all').toLowerCase().trim()
  if (normalizedCategory && normalizedCategory !== 'all') {
    items = items.filter(
      (item) => normalizeCategory(item.category) === normalizeCategory(normalizedCategory)
    )
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
    kicks: data.stats.kicks ?? 0,
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

function buildStatsSnapshot(data) {
  const stats = data?.stats ?? {}
  const casesCount =
    stats.cases ?? (Array.isArray(data?.cases) ? data.cases.length : 0)
  return {
    updatedAt: data?.updatedAt ?? null,
    warnings: stats.warnings ?? 0,
    timeouts: stats.timeouts ?? 0,
    bans: stats.bans ?? 0,
    kicks: stats.kicks ?? 0,
    cases: casesCount
  }
}

function summarizeCaseUpdate(caseEntry) {
  if (!caseEntry) {
    return null
  }
  return {
    guildId: caseEntry.guildId ?? null,
    caseId: caseEntry.id ?? null,
    status: caseEntry.status ?? null,
    updatedAt: caseEntry.updatedAt ?? caseEntry.createdAt ?? null,
    unreadCount: caseEntry.unreadCount ?? 0,
    subject: caseEntry.subject ?? null,
    userId: caseEntry.userId ?? null,
    userTag: caseEntry.userTag ?? null,
    lastMessageAt: caseEntry.lastMessageAt ?? null,
    category: normalizeCategory(caseEntry.category),
    ticketType: caseEntry.ticketType ?? null
  }
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
    (item) => item.guildId === guildId && item.userId === userId && !isTerminalStatus(item.status)
  )

  if (existing) {
    return { caseEntry: existing, created: false }
  }

  const newCase = createCaseShell({
    guildId,
    guildName: entry.guildName,
    userId,
    userTag: entry.userTag,
    status: normalizeStatus(entry.status) ?? DEFAULT_STATUS,
    source: entry.source ?? 'system',
    category: 'moderation',
    metadata: buildInitialMetadata(entry),
    openedBy: {
      type: entry.moderatorId ? 'moderator' : 'system',
      id: entry.moderatorId ? String(entry.moderatorId) : 'system',
      tag: entry.moderatorTag ?? null,
      at: now,
      reason: entry.reason ?? null
    }
  })

  ensureParticipant(newCase, {
    type: 'member',
    id: userId,
    tag: entry.userTag ?? null
  })
  if (entry.moderatorId) {
    ensureParticipant(newCase, {
      type: 'moderator',
      id: String(entry.moderatorId),
      tag: entry.moderatorTag ?? null
    })
  }
  assignCaseSubject(newCase, entry)

  data.cases.unshift(newCase)
  trimCaseList(data)
  return { caseEntry: newCase, created: true }
}

function createCaseShell({
  guildId,
  guildName,
  userId,
  userTag,
  status,
  source,
  openedBy,
  category,
  ticketType,
  metadata,
  subject,
  intakeChannelId,
  intakeThreadId,
  intakeMessageId
}) {
  const now = new Date().toISOString()
  return {
    id: createId(),
    guildId: String(guildId),
    guildName: guildName ?? null,
    userId: String(userId),
    userTag: userTag ?? null,
    status: status ?? 'open',
    source: source ?? 'system',
    category: normalizeCategory(category),
    ticketType: ticketType ? String(ticketType) : null,
    intakeChannelId: intakeChannelId ? String(intakeChannelId) : null,
    intakeThreadId: intakeThreadId ? String(intakeThreadId) : null,
    intakeMessageId: intakeMessageId ? String(intakeMessageId) : null,
    metadata: typeof metadata === 'object' && metadata !== null ? { ...metadata } : {},
    openedBy: openedBy ?? {
      type: 'system',
      id: 'system',
      at: now
    },
    createdAt: now,
    updatedAt: now,
    lastMessageAt: null,
    subject: subject ?? null,
    participants: [],
    unreadCount: 0,
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
  const normalizedType = typeof authorType === 'string' ? authorType.toLowerCase() : 'system'
  const content = String(body ?? '').trim()
  const tag = typeof authorTag === 'string' && authorTag.trim().length ? authorTag.trim() : null
  const authorIdString = authorId ? String(authorId) : null
  const authorProfile = buildAuthorProfile(normalizedType, authorIdString, tag)

  return {
    id: createId(),
    authorType: normalizedType,
    authorRole: normalizedType,
    role: normalizedType,
    authorId: authorIdString,
    authorTag: tag,
    author: authorProfile,
    authorProfile,
    authorLabel: authorProfile.displayName,
    authorName: authorProfile.displayName,
    displayName: authorProfile.displayName,
    username: authorProfile.username,
    body: content,
    content,
    via: via ?? null,
    createdAt: new Date().toISOString()
  }
}

function updateUserTotals(data, caseEntry, statsKey, now, caseCreated = false) {
  const key = getTotalsKey(caseEntry.guildId, caseEntry.userId)
  const previous = data.userTotals[key] ?? defaultTotals()
  const totals = {
    ...previous,
    cases: (previous.cases ?? 0) + (caseCreated ? 1 : 0),
    lastActionAt: now
  }

  if (!caseCreated && (totals.cases ?? 0) === 0) {
    totals.cases = 1
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

function registerCaseMessage(data, caseEntry, message, { markUnread } = {}) {
  if (!Array.isArray(caseEntry.messages)) {
    caseEntry.messages = []
  }
  caseEntry.messages.push(message)
  trimMessages(caseEntry)

  caseEntry.lastMessageAt = message.createdAt
  caseEntry.updatedAt = message.createdAt
  data.updatedAt = message.createdAt

  ensureParticipantFromMessage(caseEntry, message)

  if (markUnread === true || (markUnread === undefined && message.authorType === 'member')) {
    caseEntry.unreadCount = Math.min(
      (caseEntry.unreadCount ?? 0) + 1,
      caseEntry.messages.length
    )
  } else if (markUnread === false || (markUnread === undefined && message.authorType === 'moderator')) {
    caseEntry.unreadCount = 0
  }

  caseEntry.auditLog.push({
    id: createId(),
    type: 'message',
    authorType: message.authorType ?? 'system',
    authorId: message.authorId ? String(message.authorId) : null,
    authorTag: message.authorTag ?? null,
    createdAt: message.createdAt,
    note: null
  })
  trimAuditLog(caseEntry)
}

function applyCaseStatus(data, caseEntry, status, actor = {}, timestamp = new Date().toISOString()) {
  const normalized = normalizeStatus(status)
  if (!normalized) {
    return false
  }

  const current = caseEntry.status ?? DEFAULT_STATUS
  const changed = current !== normalized
  if (!changed && !actor.note) {
    return false
  }

  caseEntry.status = normalized
  caseEntry.updatedAt = timestamp
  data.updatedAt = timestamp

  const entry = {
    id: createId(),
    type: 'status',
    status: normalized,
    note: actor.note ?? null,
    actorId: actor.id ?? null,
    actorTag: actor.tag ?? null,
    actorType: actor.type ?? 'system',
    createdAt: timestamp
  }
  if (entry.actorId) {
    entry.actorId = String(entry.actorId)
  }
  caseEntry.auditLog.push(entry)
  trimAuditLog(caseEntry)

  if (isTerminalStatus(normalized)) {
    caseEntry.unreadCount = 0
  }

  return true
}

function trimMessages(caseEntry) {
  if (caseEntry.messages.length > MAX_MESSAGES_PER_CASE) {
    caseEntry.messages.splice(0, caseEntry.messages.length - MAX_MESSAGES_PER_CASE)
  }
}

function trimAuditLog(caseEntry) {
  if (!Array.isArray(caseEntry.auditLog)) {
    caseEntry.auditLog = []
    return
  }
  if (caseEntry.auditLog.length > MAX_AUDIT_LOG_ENTRIES) {
    caseEntry.auditLog.splice(0, caseEntry.auditLog.length - MAX_AUDIT_LOG_ENTRIES)
  }
}

function ensureParticipant(caseEntry, participant) {
  if (!participant) {
    return
  }
  const normalized = normalizeParticipant(participant)
  if (!normalized) {
    return
  }
  if (!Array.isArray(caseEntry.participants)) {
    caseEntry.participants = []
  }
  const key = `${normalized.type}:${normalized.id}`
  const existingIndex = caseEntry.participants.findIndex(
    (item) => `${item.type ?? 'member'}:${item.id}` === key
  )
  if (existingIndex !== -1) {
    caseEntry.participants[existingIndex] = {
      ...caseEntry.participants[existingIndex],
      ...normalized,
      addedAt: caseEntry.participants[existingIndex].addedAt ?? normalized.addedAt
    }
    return
  }
  caseEntry.participants.push(normalized)
  if (caseEntry.participants.length > MAX_PARTICIPANTS) {
    caseEntry.participants.splice(0, caseEntry.participants.length - MAX_PARTICIPANTS)
  }
}

function ensureParticipantFromMessage(caseEntry, message) {
  if (!message) {
    return
  }
  if (message.authorType === 'member' && message.authorId) {
    ensureParticipant(caseEntry, {
      type: 'member',
      id: String(message.authorId),
      tag: message.authorTag ?? null
    })
  } else if (message.authorType === 'moderator' && message.authorId) {
    ensureParticipant(caseEntry, {
      type: 'moderator',
      id: String(message.authorId),
      tag: message.authorTag ?? null
    })
  }
}

function normalizeParticipant(participant = {}) {
  const id = participant.id ?? participant.userId ?? null
  if (!id) {
    return null
  }
  const now = new Date().toISOString()
  const typeValue = typeof participant.type === 'string' ? participant.type.toLowerCase() : null
  const allowedTypes = new Set(['member', 'moderator', 'system', 'bot', 'other'])
  const type = allowedTypes.has(typeValue) ? typeValue : 'member'
  return {
    id: String(id),
    type,
    tag: participant.tag ?? null,
    displayName: participant.displayName ?? null,
    username: participant.username ?? null,
    addedAt: participant.addedAt ?? now
  }
}

function normalizeParticipants(raw, fallback = {}) {
  const participants = []
  const seen = new Set()
  const push = (value) => {
    const normalized = normalizeParticipant(value)
    if (!normalized) {
      return
    }
    const key = `${normalized.type}:${normalized.id}`
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    participants.push(normalized)
  }

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      push(entry)
    }
  }

  if (fallback.userId) {
    push({ type: 'member', id: fallback.userId, tag: fallback.userTag ?? null })
  }

  if (participants.length > MAX_PARTICIPANTS) {
    return participants.slice(-MAX_PARTICIPANTS)
  }

  return participants
}

function normalizeActionRecord(raw = {}) {
  const createdAt = raw.createdAt ?? new Date().toISOString()
  const durationValue = raw.durationMinutes ?? raw.duration ?? null
  const durationNumber = Number(durationValue)
  const typeValue =
    typeof raw.type === 'string'
      ? raw.type.toLowerCase()
      : typeof raw.action === 'string'
        ? raw.action.toLowerCase()
        : 'action'
  return {
    id: raw.id ?? createId(),
    type: typeValue,
    reason: raw.reason ?? null,
    durationMinutes: Number.isFinite(durationNumber) && durationNumber > 0 ? durationNumber : null,
    moderatorId: raw.moderatorId ? String(raw.moderatorId) : null,
    moderatorTag: raw.moderatorTag ?? null,
    createdAt,
    source: raw.source ?? null,
    metadata: raw.metadata ?? null
  }
}

function normalizeMessageRecord(raw = {}) {
  const createdAt = raw.createdAt ?? new Date().toISOString()
  const typeValue =
    typeof raw.authorType === 'string'
      ? raw.authorType.toLowerCase()
      : typeof raw.role === 'string'
        ? raw.role.toLowerCase()
        : typeof raw.authorRole === 'string'
          ? raw.authorRole.toLowerCase()
          : 'system'
  if (typeValue === 'bot') {
    return null
  }
  const bodySource =
    typeof raw.body === 'string'
      ? raw.body
      : typeof raw.content === 'string'
        ? raw.content
          : ''
  const body = bodySource.trim()
  const content =
    typeof raw.content === 'string' && raw.content.trim().length
      ? raw.content.trim()
      : body
  const tag =
    typeof raw.authorTag === 'string' && raw.authorTag.trim().length
      ? raw.authorTag.trim()
      : typeof raw.author === 'string' && raw.author.trim().length
        ? raw.author.trim()
        : typeof raw.authorName === 'string' && raw.authorName.trim().length
          ? raw.authorName.trim()
          : typeof raw.username === 'string' && raw.username.trim().length
            ? raw.username.trim()
            : null
  const authorId =
    raw.authorId
      ? String(raw.authorId)
      : raw.userId
        ? String(raw.userId)
        : null
  const authorProfile = buildAuthorProfile(typeValue, authorId, tag)
  return {
    id: raw.id ?? createId(),
    authorType: typeValue,
    authorRole: typeValue,
    role: typeValue,
    authorId,
    authorTag: tag,
    author: authorProfile,
    authorProfile,
    authorLabel: authorProfile.displayName,
    authorName: authorProfile.displayName,
    displayName: authorProfile.displayName,
    username: authorProfile.username,
    body,
    content,
    via: raw.via ?? null,
    createdAt
  }
}

function buildAuthorProfile(authorType, authorId, tag) {
  const normalizedType = typeof authorType === 'string' ? authorType.toLowerCase() : 'system'
  const role =
    normalizedType === 'moderator'
      ? 'moderator'
      : normalizedType === 'system'
        ? 'system'
        : 'member'
  const fallbackLabel = role === 'moderator' ? 'Moderator' : role === 'system' ? 'System' : 'Member'
  const displayName = tag ?? authorId ?? fallbackLabel

  return {
    id: authorId ?? null,
    tag: tag ?? null,
    role,
    displayName,
    username: tag ?? authorId ?? fallbackLabel
  }
}

function normalizeAuditRecord(raw = {}) {
  const createdAt = raw.createdAt ?? new Date().toISOString()
  const type = typeof raw.type === 'string' ? raw.type.toLowerCase() : 'message'
  const actorType =
    typeof raw.actorType === 'string'
      ? raw.actorType.toLowerCase()
      : typeof raw.authorType === 'string'
        ? raw.authorType.toLowerCase()
        : 'system'
  return {
    id: raw.id ?? createId(),
    type,
    status: raw.status ?? null,
    action: raw.action ?? null,
    note: raw.note ?? null,
    actorId: raw.actorId ? String(raw.actorId) : raw.moderatorId ? String(raw.moderatorId) : null,
    actorTag: raw.actorTag ?? raw.moderatorTag ?? null,
    actorType,
    createdAt,
    metadata: raw.metadata ?? null
  }
}

function coerceNonNegativeInteger(value, fallback = 0) {
  if (value === null || value === undefined || value === '') {
    return fallback
  }
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return fallback
  }
  return Math.max(0, Math.floor(number))
}

function normalizeStatus(status) {
  if (status === null || status === undefined) {
    return DEFAULT_STATUS
  }
  const key = String(status).toLowerCase().trim()
  if (!key.length) {
    return DEFAULT_STATUS
  }
  if (STATUS_ALIASES.has(key)) {
    return STATUS_ALIASES.get(key)
  }
  return null
}

function normalizeCategory(category) {
  if (!category) {
    return 'moderation'
  }
  const key = String(category).toLowerCase().trim()
  if (key === 'ticket' || key === 'tickets') {
    return 'ticket'
  }
  return 'moderation'
}

function buildInitialMetadata(entry = {}) {
  const base = typeof entry.metadata === 'object' && entry.metadata !== null ? { ...entry.metadata } : {}
  if (entry.reason && !base.reason) {
    base.reason = entry.reason
  }
  if (entry.supportTopicLabel && !base.supportTopic) {
    base.supportTopic = entry.supportTopicLabel
  }
  if (entry.supportContext && !base.supportContext) {
    base.supportContext = entry.supportContext
  }
  return base
}

function assignCaseSubject(caseEntry, entry = {}) {
  if (caseEntry.subject && caseEntry.subject.trim()) {
    caseEntry.subject = caseEntry.subject.trim()
    return
  }

  const category = normalizeCategory(caseEntry.category)
  const supportTopic =
    entry.supportTopicLabel ??
    caseEntry.metadata?.supportTopic ??
    null
  if (supportTopic) {
    const prefix = category === 'ticket' ? 'Ticket' : 'Case'
    caseEntry.subject = `${prefix}: ${supportTopic}`.slice(0, 200)
    return
  }

  const reason = entry.reason ?? caseEntry.metadata?.reason ?? null
  if (typeof reason === 'string' && reason.trim().length) {
    caseEntry.subject = reason.trim().slice(0, 200)
    return
  }

  const action = entry.action ?? caseEntry.actions?.[0]?.type ?? null
  if (typeof action === 'string' && action.trim().length) {
    caseEntry.subject = `Moderation: ${capitalize(action)}`
    return
  }

  const memberMessage = caseEntry.messages?.find((message) => message.authorType === 'member' && message.body)
  if (memberMessage) {
    caseEntry.subject = memberMessage.body.slice(0, 80)
    return
  }

  caseEntry.subject = `Case for ${caseEntry.userTag ?? caseEntry.userId}`
}

function capitalize(text) {
  if (typeof text !== 'string' || !text.length) {
    return ''
  }
  return text.charAt(0).toUpperCase() + text.slice(1)
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

function isTerminalStatus(status) {
  if (!status) {
    return false
  }
  const normalized = String(status).toLowerCase().trim()
  return TERMINAL_STATUSES.has(normalized)
}

function adjustStatsAfterRemoval(data, caseEntry) {
  if (!caseEntry) {
    return
  }
  if (!data.stats) {
    data.stats = { warnings: 0, timeouts: 0, bans: 0, cases: 0 }
  }
  data.stats.cases = Math.max(0, (data.stats.cases ?? 0) - 1)
  for (const action of caseEntry.actions ?? []) {
    const key = actionToStatKey(action?.type)
    if (key) {
      data.stats[key] = Math.max(0, (data.stats[key] ?? 0) - 1)
    }
  }
}

function rebuildUserTotalsForMember(data, guildId, userId) {
  if (!guildId || !userId) {
    return
  }
  const key = getTotalsKey(guildId, userId)
  const related = data.cases.filter(
    (entry) => entry.guildId === String(guildId) && entry.userId === String(userId)
  )

  if (!related.length) {
    delete data.userTotals[key]
    return
  }

  const totals = defaultTotals()
  totals.cases = related.length
  let latest = null

  for (const entry of related) {
    latest = pickLatest(latest, entry.updatedAt)
    latest = pickLatest(latest, entry.lastMessageAt)
    latest = pickLatest(latest, entry.createdAt)
    for (const action of entry.actions ?? []) {
      const statKey = actionToStatKey(action?.type)
      if (statKey) {
        totals[statKey] = (totals[statKey] ?? 0) + 1
      }
      latest = pickLatest(latest, action?.createdAt)
    }
  }

  totals.lastActionAt = latest
  data.userTotals[key] = totals
}

function pickLatest(current, candidate) {
  if (!candidate) {
    return current ?? null
  }
  if (!current) {
    return candidate
  }
  return candidate > current ? candidate : current
}

function actionToStatKey(action) {
  switch (action) {
    case 'warn':
      return 'warnings'
    case 'timeout':
      return 'timeouts'
    case 'ban':
      return 'bans'
    case 'kick':
      return 'kicks'
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
    kicks: 0,
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
        status: normalizeStatus(item.status) ?? DEFAULT_STATUS,
        source: item.source ?? 'system',
        category: normalizeCategory(item.category),
        ticketType: item.ticketType ? String(item.ticketType) : null,
        intakeChannelId: item.intakeChannelId ? String(item.intakeChannelId) : null,
        intakeThreadId: item.intakeThreadId ? String(item.intakeThreadId) : null,
        intakeMessageId: item.intakeMessageId ? String(item.intakeMessageId) : null,
        metadata: typeof item.metadata === 'object' && item.metadata !== null ? { ...item.metadata } : {},
        openedBy: item.openedBy ?? null,
        createdAt: item.createdAt ?? new Date().toISOString(),
        updatedAt: item.updatedAt ?? item.createdAt ?? new Date().toISOString(),
        lastMessageAt: item.lastMessageAt ?? null,
        subject:
          typeof item.subject === 'string' && item.subject.trim().length
            ? item.subject.trim()
            : null,
        participants: normalizeParticipants(item.participants, {
          userId: item.userId ? String(item.userId) : null,
          userTag: item.userTag ?? null
        }),
        unreadCount: coerceNonNegativeInteger(item.unreadCount, 0),
        actions: Array.isArray(item.actions)
          ? item.actions
              .slice(0, MAX_ACTIONS_PER_CASE)
              .map((action) => normalizeActionRecord(action))
          : [],
        messages: Array.isArray(item.messages)
          ? item.messages
              .slice(-MAX_MESSAGES_PER_CASE)
              .map((message) => normalizeMessageRecord(message))
              .filter(Boolean)
          : [],
        auditLog: Array.isArray(item.auditLog)
          ? item.auditLog
              .slice(-MAX_AUDIT_LOG_ENTRIES)
              .map((entry) => normalizeAuditRecord(entry))
              .filter(Boolean)
          : []
      }))
      .filter((item) => item.guildId && item.userId)
      .map((caseEntry) => {
        ensureParticipant(caseEntry, {
          type: 'member',
          id: caseEntry.userId,
          tag: caseEntry.userTag ?? null
        })
        if (caseEntry.unreadCount > caseEntry.messages.length) {
          caseEntry.unreadCount = caseEntry.messages.length
        }
        assignCaseSubject(caseEntry, {
          reason: caseEntry.metadata?.reason ?? null,
          action: caseEntry.actions[0]?.type ?? null
        })
        trimAuditLog(caseEntry)
        trimMessages(caseEntry)
        return caseEntry
      })
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
