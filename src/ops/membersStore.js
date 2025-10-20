import { readJson, writeJson } from '../control-center/data/jsonStore.js'

const MEMBERS_FILE = 'ops/members.json'

const defaultData = {
  updatedAt: null,
  members: []
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
      const payload = await readJson(MEMBERS_FILE, defaultData)
      cache = normalizeData(payload)
      return cache
    } catch (error) {
      console.warn('Failed to load members dataset, falling back to defaults:', error)
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
  const members = Array.isArray(source.members) ? source.members : []
  const normalizedMembers = members
    .map((member) => normalizeMember(member))
    .filter(Boolean)
  return {
    updatedAt: source.updatedAt ?? null,
    members: normalizedMembers
  }
}

function normalizeMember(member) {
  if (!member || typeof member !== 'object') {
    return null
  }
  const id = member.id ? String(member.id) : null
  const guildId = member.guild_id ?? member.guildId
  if (!id || !guildId) {
    return null
  }

  return {
    id,
    guildId: String(guildId),
    username: typeof member.username === 'string' ? member.username : null,
    bot: Boolean(member.bot),
    joinedAt: normalizeDate(member.joined_at ?? member.joinedAt),
    leftAt: normalizeDate(member.left_at ?? member.leftAt),
    status: typeof member.status === 'string' ? member.status : null,
    dept: typeof member.dept === 'string' ? member.dept : null,
    notes: typeof member.notes === 'string' ? member.notes : null,
    createdAt: normalizeDate(member.created_at ?? member.createdAt) ?? normalizeDate(member.joined_at ?? member.joinedAt),
    updatedAt: normalizeDate(member.updated_at ?? member.updatedAt)
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
    members: data.members
  }
  await writeJson(MEMBERS_FILE, payload)
  cache = payload
  return cache
}

export async function listMembers({ guildId = null, includeBots = false } = {}) {
  const data = await loadData()
  let results = data.members
  if (guildId) {
    const normalized = String(guildId)
    results = results.filter((member) => member.guildId === normalized)
  }
  if (!includeBots) {
    results = results.filter((member) => !member.bot)
  }
  return results.map((member) => ({ ...member }))
}

export async function getMember({ guildId, memberId }) {
  if (!guildId || !memberId) {
    return null
  }
  const normalizedGuild = String(guildId)
  const normalizedMember = String(memberId)
  const data = await loadData()
  const entry = data.members.find(
    (member) => member.guildId === normalizedGuild && member.id === normalizedMember
  )
  return entry ? { ...entry } : null
}

export async function upsertMember(member) {
  const normalized = normalizeMember(member)
  if (!normalized) {
    throw new Error('Invalid member payload')
  }
  const data = await loadData()
  const index = data.members.findIndex(
    (entry) => entry.guildId === normalized.guildId && entry.id === normalized.id
  )
  const now = new Date().toISOString()
  const updated = {
    ...normalized,
    joinedAt: normalized.joinedAt ?? now,
    createdAt: normalized.createdAt ?? now,
    updatedAt: now
  }
  if (index >= 0) {
    data.members[index] = { ...data.members[index], ...updated }
  } else {
    data.members.push(updated)
  }
  data.updatedAt = now
  await persist(data)
  return { ...updated }
}

export async function markMemberLeft({ guildId, memberId, leftAt = null }) {
  if (!guildId || !memberId) {
    throw new Error('guildId and memberId are required')
  }
  const data = await loadData()
  const normalizedGuild = String(guildId)
  const normalizedMember = String(memberId)
  const index = data.members.findIndex(
    (entry) => entry.guildId === normalizedGuild && entry.id === normalizedMember
  )
  if (index === -1) {
    return null
  }
  const timestamp = normalizeDate(leftAt) ?? new Date().toISOString()
  data.members[index] = {
    ...data.members[index],
    leftAt: timestamp,
    updatedAt: timestamp
  }
  data.updatedAt = timestamp
  await persist(data)
  return { ...data.members[index] }
}

export async function removeMember({ guildId, memberId }) {
  if (!guildId || !memberId) {
    return false
  }
  const data = await loadData()
  const normalizedGuild = String(guildId)
  const normalizedMember = String(memberId)
  const nextMembers = data.members.filter(
    (entry) => !(entry.guildId === normalizedGuild && entry.id === normalizedMember)
  )
  if (nextMembers.length === data.members.length) {
    return false
  }
  data.members = nextMembers
  data.updatedAt = new Date().toISOString()
  await persist(data)
  return true
}

export async function resetMembersData() {
  cache = null
  await writeJson(MEMBERS_FILE, clone(defaultData))
}
