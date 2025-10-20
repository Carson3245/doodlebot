import crypto from 'node:crypto'
import { readJson, writeJson } from '../control-center/data/jsonStore.js'

const VERIFICATIONS_FILE = 'ops/verifications.json'

const defaultData = {
  updatedAt: null,
  verifications: []
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
      const payload = await readJson(VERIFICATIONS_FILE, defaultData)
      cache = normalizeData(payload)
      return cache
    } catch (error) {
      console.warn('Failed to load verification dataset, using defaults:', error)
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
  const items = Array.isArray(source.verifications) ? source.verifications : []
  const normalized = items
    .map((entry) => normalizeEntry(entry))
    .filter(Boolean)
  return {
    updatedAt: source.updatedAt ?? null,
    verifications: normalized
  }
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null
  }
  const id = entry.id ? String(entry.id) : createId()
  const guildId = entry.guild_id ?? entry.guildId
  const memberId = entry.member_id ?? entry.memberId
  if (!guildId || !memberId) {
    return null
  }
  const state = normalizeState(entry.state)
  return {
    id,
    guildId: String(guildId),
    memberId: String(memberId),
    state,
    responses: Array.isArray(entry.responses) || entry.responses?.constructor === Object ? entry.responses : [],
    createdAt: normalizeDate(entry.created_at ?? entry.createdAt) ?? new Date().toISOString(),
    updatedAt: normalizeDate(entry.updated_at ?? entry.updatedAt) ?? new Date().toISOString(),
    reviewerId: entry.reviewer_id ? String(entry.reviewer_id) : null,
    decidedAt: normalizeDate(entry.decided_at ?? entry.decidedAt),
    meta: entry.meta && typeof entry.meta === 'object' ? { ...entry.meta } : {}
  }
}

function normalizeState(value) {
  const normalized = String(value ?? 'pending').toLowerCase()
  if (['pending', 'approved', 'rejected', 'cancelled'].includes(normalized)) {
    return normalized
  }
  return 'pending'
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
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex')
}

async function persist(data) {
  const payload = {
    updatedAt: data.updatedAt ?? new Date().toISOString(),
    verifications: data.verifications
  }
  await writeJson(VERIFICATIONS_FILE, payload)
  cache = payload
  return cache
}

export async function createVerification({
  guildId,
  memberId,
  responses = [],
  state = 'pending',
  meta = {},
  createdAt = new Date()
}) {
  if (!guildId || !memberId) {
    throw new Error('guildId and memberId are required to create a verification')
  }
  const data = await loadData()
  const now = normalizeDate(createdAt) ?? new Date().toISOString()
  const entry = {
    id: createId(),
    guildId: String(guildId),
    memberId: String(memberId),
    state: normalizeState(state),
    responses,
    createdAt: now,
    updatedAt: now,
    reviewerId: null,
    decidedAt: null,
    meta: meta && typeof meta === 'object' ? { ...meta } : {}
  }
  data.verifications.push(entry)
  data.updatedAt = now
  await persist(data)
  return { ...entry }
}

export async function updateVerificationState({
  verificationId,
  state,
  reviewerId = null,
  decidedAt = new Date()
}) {
  if (!verificationId) {
    throw new Error('verificationId is required to update verification state')
  }
  const data = await loadData()
  const normalizedId = String(verificationId)
  const index = data.verifications.findIndex((entry) => entry.id === normalizedId)
  if (index === -1) {
    return null
  }
  const timestamp = normalizeDate(decidedAt) ?? new Date().toISOString()
  const stateValue = normalizeState(state)
  data.verifications[index] = {
    ...data.verifications[index],
    state: stateValue,
    reviewerId: reviewerId ? String(reviewerId) : data.verifications[index].reviewerId,
    decidedAt: timestamp,
    updatedAt: timestamp
  }
  data.updatedAt = timestamp
  await persist(data)
  return { ...data.verifications[index] }
}

export async function listVerifications({
  guildId = null,
  state = null
} = {}) {
  const data = await loadData()
  let results = data.verifications
  if (guildId) {
    const normalized = String(guildId)
    results = results.filter((entry) => entry.guildId === normalized)
  }
  if (state) {
    const normalizedState = normalizeState(state)
    results = results.filter((entry) => entry.state === normalizedState)
  }
  return results
    .slice()
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map((entry) => ({ ...entry }))
}

export async function getVerificationById(verificationId) {
  if (!verificationId) {
    return null
  }
  const data = await loadData()
  const normalized = String(verificationId)
  const entry = data.verifications.find((item) => item.id === normalized)
  return entry ? { ...entry } : null
}

export async function resetVerificationsData() {
  cache = null
  await writeJson(VERIFICATIONS_FILE, clone(defaultData))
}
