import crypto from 'node:crypto'
import { readJson, writeJson } from '../control-center/data/jsonStore.js'

const SESSIONS_FILE = 'ops/voice_sessions.json'

const defaultData = {
  updatedAt: null,
  sessions: []
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
      const payload = await readJson(SESSIONS_FILE, defaultData)
      cache = normalizeData(payload)
      return cache
    } catch (error) {
      console.warn('Failed to load voice sessions dataset, using defaults:', error)
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
  const sessions = Array.isArray(source.sessions) ? source.sessions : []
  const normalizedSessions = sessions
    .map((session) => normalizeSession(session))
    .filter(Boolean)
  return {
    updatedAt: source.updatedAt ?? null,
    sessions: normalizedSessions
  }
}

function normalizeSession(session) {
  if (!session || typeof session !== 'object') {
    return null
  }
  const id = session.id ? String(session.id) : crypto.randomUUID()
  const guildId = session.guild_id ?? session.guildId
  const memberId = session.member_id ?? session.memberId
  const channelId = session.channel_id ?? session.channelId
  const startedAt = normalizeDate(session.started_at ?? session.startedAt)
  if (!guildId || !memberId || !channelId || !startedAt) {
    return null
  }
  const endedAt = normalizeDate(session.ended_at ?? session.endedAt)
  const durationSec = Number.isFinite(Number(session.duration_sec ?? session.durationSec))
    ? Number(session.duration_sec ?? session.durationSec)
    : calculateDurationSeconds(startedAt, endedAt)

  return {
    id,
    guildId: String(guildId),
    memberId: String(memberId),
    channelId: String(channelId),
    startedAt,
    endedAt,
    durationSec,
    metadata: session.metadata && typeof session.metadata === 'object' ? { ...session.metadata } : {}
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

function calculateDurationSeconds(startedAt, endedAt) {
  if (!startedAt || !endedAt) {
    return 0
  }
  const start = new Date(startedAt).getTime()
  const end = new Date(endedAt).getTime()
  const diff = Math.max(0, end - start)
  return Math.round(diff / 1000)
}

async function persist(data) {
  const payload = {
    updatedAt: data.updatedAt ?? new Date().toISOString(),
    sessions: data.sessions
  }
  await writeJson(SESSIONS_FILE, payload)
  cache = payload
  return cache
}

function createId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex')
}

export async function startVoiceSession({
  guildId,
  channelId,
  memberId,
  startedAt = new Date(),
  metadata = {}
}) {
  if (!guildId || !channelId || !memberId) {
    throw new Error('guildId, channelId, and memberId are required to start a voice session')
  }
  const data = await loadData()
  const normalizedGuild = String(guildId)
  const normalizedChannel = String(channelId)
  const normalizedMember = String(memberId)
  const timestamp = normalizeDate(startedAt) ?? new Date().toISOString()

  const session = {
    id: createId(),
    guildId: normalizedGuild,
    channelId: normalizedChannel,
    memberId: normalizedMember,
    startedAt: timestamp,
    endedAt: null,
    durationSec: 0,
    metadata: metadata && typeof metadata === 'object' ? { ...metadata } : {}
  }

  data.sessions.push(session)
  data.updatedAt = timestamp
  await persist(data)
  return { ...session }
}

export async function endVoiceSession({
  guildId,
  channelId,
  memberId,
  endedAt = new Date()
}) {
  if (!guildId || !channelId || !memberId) {
    throw new Error('guildId, channelId, and memberId are required to end a voice session')
  }
  const data = await loadData()
  const normalizedGuild = String(guildId)
  const normalizedChannel = String(channelId)
  const normalizedMember = String(memberId)
  const timestamp = normalizeDate(endedAt) ?? new Date().toISOString()

  const index = data.sessions
    .slice()
    .reverse()
    .findIndex(
      (session) =>
        session.guildId === normalizedGuild &&
        session.channelId === normalizedChannel &&
        session.memberId === normalizedMember &&
        session.endedAt === null
    )

  if (index === -1) {
    return null
  }

  const actualIndex = data.sessions.length - 1 - index
  const session = data.sessions[actualIndex]
  const durationSec = calculateDurationSeconds(session.startedAt, timestamp)
  data.sessions[actualIndex] = {
    ...session,
    endedAt: timestamp,
    durationSec
  }
  data.updatedAt = timestamp
  await persist(data)
  return { ...data.sessions[actualIndex] }
}

export async function listVoiceSessions({
  guildId = null,
  channelId = null,
  memberId = null,
  from = null,
  to = null,
  includeOpen = false
} = {}) {
  const data = await loadData()
  let sessions = data.sessions
  if (guildId) {
    const normalized = String(guildId)
    sessions = sessions.filter((session) => session.guildId === normalized)
  }
  if (channelId) {
    const normalized = String(channelId)
    sessions = sessions.filter((session) => session.channelId === normalized)
  }
  if (memberId) {
    const normalized = String(memberId)
    sessions = sessions.filter((session) => session.memberId === normalized)
  }
  if (from || to) {
    const fromTs = from ? new Date(from).getTime() : null
    const toTs = to ? new Date(to).getTime() : null
    sessions = sessions.filter((session) => {
      const start = new Date(session.startedAt).getTime()
      const end = session.endedAt ? new Date(session.endedAt).getTime() : start
      if (fromTs && end < fromTs) {
        return false
      }
      if (toTs && start > toTs) {
        return false
      }
      return true
    })
  }
  if (!includeOpen) {
    sessions = sessions.filter((session) => session.endedAt !== null)
  }
  return sessions.map((session) => ({ ...session }))
}

export async function resetVoiceSessionsData() {
  cache = null
  await writeJson(SESSIONS_FILE, clone(defaultData))
}
