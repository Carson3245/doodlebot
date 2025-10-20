import { readJson, writeJson } from '../control-center/data/jsonStore.js'
import { Roles } from '../auth/rbac.js'

const ASSIGNMENTS_FILE = 'ops/rbac_assignments.json'

const defaultData = {
  updatedAt: null,
  guilds: {}
}

const BASE_ROLES = [Roles.OWNER, Roles.ADMIN, Roles.MOD, Roles.VIEWER]

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
      const payload = await readJson(ASSIGNMENTS_FILE, defaultData)
      cache = normalizeData(payload)
      return cache
    } catch (error) {
      console.warn('Failed to load RBAC assignments dataset, using defaults:', error)
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
  const guilds = source.guilds && typeof source.guilds === 'object' ? source.guilds : {}
  const normalizedGuilds = {}
  for (const [guildId, assignment] of Object.entries(guilds)) {
    normalizedGuilds[String(guildId)] = normalizeGuildAssignment(assignment)
  }
  return {
    updatedAt: source.updatedAt ?? null,
    guilds: normalizedGuilds
  }
}

function normalizeGuildAssignment(assignment) {
  const source = assignment && typeof assignment === 'object' ? assignment : {}
  const entries = source.assignments && typeof source.assignments === 'object' ? source.assignments : {}
  const normalizedAssignments = {}
  for (const [key, value] of Object.entries(entries)) {
    const normalizedKey = String(key).toLowerCase()
    normalizedAssignments[normalizedKey] = Array.isArray(value)
      ? value
          .map((roleId) => (roleId ? String(roleId) : null))
          .filter(Boolean)
      : []
  }
  const defaultRole = BASE_ROLES.includes(String(source.defaultRole))
    ? String(source.defaultRole)
    : Roles.VIEWER
  return {
    defaultRole,
    assignments: normalizedAssignments
  }
}

async function persist(data) {
  const payload = {
    updatedAt: data.updatedAt ?? new Date().toISOString(),
    guilds: data.guilds
  }
  await writeJson(ASSIGNMENTS_FILE, payload)
  cache = payload
  return cache
}

export async function getGuildAssignments(guildId) {
  const data = await loadData()
  if (!guildId) {
    return structuredClone(defaultData)
  }
  const normalizedGuild = String(guildId)
  const existing = data.guilds[normalizedGuild]
  if (existing) {
    return {
      guildId: normalizedGuild,
      defaultRole: existing.defaultRole,
      assignments: { ...existing.assignments }
    }
  }
  return {
    guildId: normalizedGuild,
    defaultRole: Roles.VIEWER,
    assignments: {}
  }
}

export async function setGuildAssignments(guildId, { defaultRole = Roles.VIEWER, assignments = {} }) {
  if (!guildId) {
    throw new Error('guildId is required to set RBAC assignments')
  }
  const data = await loadData()
  const normalizedGuild = String(guildId)
  const payload = normalizeGuildAssignment({
    defaultRole,
    assignments
  })
  const now = new Date().toISOString()
  data.guilds[normalizedGuild] = payload
  data.updatedAt = now
  await persist(data)
  return {
    guildId: normalizedGuild,
    defaultRole: payload.defaultRole,
    assignments: { ...payload.assignments },
    updatedAt: now
  }
}

export async function listAllAssignments() {
  const data = await loadData()
  return Object.entries(data.guilds).map(([guildId, value]) => ({
    guildId,
    defaultRole: value.defaultRole,
    assignments: { ...value.assignments }
  }))
}

export async function resolveRolesForMember({ guildId, discordRoleIds = [] } = {}) {
  const assignments = await getGuildAssignments(guildId)
  const roleIds = new Set(
    Array.isArray(discordRoleIds)
      ? discordRoleIds.map((roleId) => String(roleId))
      : []
  )
  const resolved = new Set()
  for (const [rbacKey, mappedRoles] of Object.entries(assignments.assignments)) {
    if (!mappedRoles || !mappedRoles.length) {
      continue
    }
    for (const roleId of mappedRoles) {
      if (roleIds.has(roleId)) {
        resolved.add(rbacKey)
        break
      }
    }
  }
  if (!resolved.size) {
    resolved.add(assignments.defaultRole ?? Roles.VIEWER)
  }
  if (!resolved.has(Roles.VIEWER)) {
    resolved.add(Roles.VIEWER)
  }
  return Array.from(resolved)
}

export async function resetAssignmentsData() {
  cache = null
  await writeJson(ASSIGNMENTS_FILE, clone(defaultData))
}
