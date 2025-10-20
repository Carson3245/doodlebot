import { readJson, writeJson } from '../control-center/data/jsonStore.js'

const MESSAGES_FILE = 'ops/messages_daily.json'

const defaultData = {
  updatedAt: null,
  entries: []
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
      const payload = await readJson(MESSAGES_FILE, defaultData)
      cache = normalizeData(payload)
      return cache
    } catch (error) {
      console.warn('Failed to load message metrics dataset, using defaults:', error)
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
  const entries = Array.isArray(source.entries) ? source.entries : []
  const normalizedEntries = entries
    .map((entry) => normalizeEntry(entry))
    .filter(Boolean)
  return {
    updatedAt: source.updatedAt ?? null,
    entries: normalizedEntries
  }
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null
  }
  const guildId = entry.guild_id ?? entry.guildId
  const channelId = entry.channel_id ?? entry.channelId
  const date = normalizeDate(entry.date)
  if (!guildId || !channelId || !date) {
    return null
  }
  return {
    guildId: String(guildId),
    channelId: String(channelId),
    date,
    count: Number.isFinite(Number(entry.count)) ? Number(entry.count) : 0
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
  const year = parsed.getUTCFullYear()
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0')
  const day = String(parsed.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function persist(data) {
  const payload = {
    updatedAt: data.updatedAt ?? new Date().toISOString(),
    entries: data.entries
  }
  await writeJson(MESSAGES_FILE, payload)
  cache = payload
  return cache
}

export async function recordMessageCount({ guildId, channelId, date = new Date(), count = 1 }) {
  if (!guildId || !channelId) {
    throw new Error('guildId and channelId are required to record message counts')
  }
  const normalizedDate = normalizeDate(date)
  if (!normalizedDate) {
    throw new Error('Invalid date provided')
  }
  const data = await loadData()
  const normalizedGuild = String(guildId)
  const normalizedChannel = String(channelId)

  const index = data.entries.findIndex(
    (entry) =>
      entry.guildId === normalizedGuild &&
      entry.channelId === normalizedChannel &&
      entry.date === normalizedDate
  )

  if (index >= 0) {
    const value = data.entries[index].count + Number(count || 0)
    data.entries[index] = {
      ...data.entries[index],
      count: value
    }
  } else {
    data.entries.push({
      guildId: normalizedGuild,
      channelId: normalizedChannel,
      date: normalizedDate,
      count: Number(count || 0)
    })
  }
  data.updatedAt = new Date().toISOString()
  await persist(data)
  return true
}

export async function listMessageCounts({
  guildId = null,
  channelId = null,
  from = null,
  to = null
} = {}) {
  const data = await loadData()
  let results = data.entries
  if (guildId) {
    const normalized = String(guildId)
    results = results.filter((entry) => entry.guildId === normalized)
  }
  if (channelId) {
    const normalized = String(channelId)
    results = results.filter((entry) => entry.channelId === normalized)
  }
  if (from || to) {
    const normalizedFrom = from ? normalizeDate(from) : null
    const normalizedTo = to ? normalizeDate(to) : null
    results = results.filter((entry) => {
      if (normalizedFrom && entry.date < normalizedFrom) {
        return false
      }
      if (normalizedTo && entry.date > normalizedTo) {
        return false
      }
      return true
    })
  }
  return results.map((entry) => ({ ...entry }))
}

export async function getMessageSummary({
  guildId,
  from,
  to
} = {}) {
  const entries = await listMessageCounts({ guildId, from, to })
  const total = entries.reduce((sum, entry) => sum + entry.count, 0)
  const groupedByChannel = new Map()
  for (const entry of entries) {
    const key = entry.channelId
    const current = groupedByChannel.get(key) ?? 0
    groupedByChannel.set(key, current + entry.count)
  }
  const channels = Array.from(groupedByChannel.entries()).map(([channelId, count]) => ({
    channelId,
    count
  }))
  return {
    total,
    channels
  }
}

export async function resetMessagesData() {
  cache = null
  await writeJson(MESSAGES_FILE, clone(defaultData))
}
