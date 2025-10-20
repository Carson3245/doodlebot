import { readJson, writeJson } from '../control-center/data/jsonStore.js'

const CHANNELS_FILE = 'ops/channels.json'

const defaultData = {
  updatedAt: null,
  channels: []
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
      const payload = await readJson(CHANNELS_FILE, defaultData)
      cache = normalizeData(payload)
      return cache
    } catch (error) {
      console.warn('Failed to load channels dataset, using defaults:', error)
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
  const channels = Array.isArray(source.channels) ? source.channels : []
  const normalizedChannels = channels
    .map((channel) => normalizeChannel(channel))
    .filter(Boolean)
  return {
    updatedAt: source.updatedAt ?? null,
    channels: normalizedChannels
  }
}

function normalizeChannel(channel) {
  if (!channel || typeof channel !== 'object') {
    return null
  }
  const id = channel.id ? String(channel.id) : null
  const guildId = channel.guild_id ?? channel.guildId
  if (!id || !guildId) {
    return null
  }
  const type = typeof channel.type === 'string' ? channel.type : 'text'
  return {
    id,
    guildId: String(guildId),
    name: typeof channel.name === 'string' ? channel.name : null,
    type,
    createdAt: normalizeDate(channel.created_at ?? channel.createdAt) ?? null,
    updatedAt: normalizeDate(channel.updated_at ?? channel.updatedAt) ?? null,
    metadata: channel.metadata && typeof channel.metadata === 'object' ? { ...channel.metadata } : {}
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

async function persist(data) {
  const payload = {
    updatedAt: data.updatedAt ?? new Date().toISOString(),
    channels: data.channels
  }
  await writeJson(CHANNELS_FILE, payload)
  cache = payload
  return cache
}

export async function listChannels({ guildId = null, type = null } = {}) {
  const data = await loadData()
  let results = data.channels
  if (guildId) {
    const normalized = String(guildId)
    results = results.filter((channel) => channel.guildId === normalized)
  }
  if (type) {
    const normalizedType = String(type).toLowerCase()
    results = results.filter((channel) => channel.type === normalizedType)
  }
  return results.map((channel) => ({ ...channel }))
}

export async function upsertChannel(channel) {
  const normalized = normalizeChannel(channel)
  if (!normalized) {
    throw new Error('Invalid channel payload')
  }
  const data = await loadData()
  const index = data.channels.findIndex(
    (entry) => entry.guildId === normalized.guildId && entry.id === normalized.id
  )
  const now = new Date().toISOString()
  const updated = {
    ...normalized,
    updatedAt: now
  }
  if (index >= 0) {
    data.channels[index] = { ...data.channels[index], ...updated }
  } else {
    data.channels.push({ ...updated, createdAt: updated.createdAt ?? now })
  }
  data.updatedAt = now
  await persist(data)
  return { ...updated }
}

export async function removeChannel({ guildId, channelId }) {
  if (!guildId || !channelId) {
    return false
  }
  const data = await loadData()
  const normalizedGuild = String(guildId)
  const normalizedChannel = String(channelId)
  const nextChannels = data.channels.filter(
    (entry) => !(entry.guildId === normalizedGuild && entry.id === normalizedChannel)
  )
  if (nextChannels.length === data.channels.length) {
    return false
  }
  data.channels = nextChannels
  data.updatedAt = new Date().toISOString()
  await persist(data)
  return true
}

export async function resetChannelsData() {
  cache = null
  await writeJson(CHANNELS_FILE, clone(defaultData))
}
