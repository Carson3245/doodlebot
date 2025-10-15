import fs from 'node:fs/promises'
import path from 'node:path'
import { derivePermissionsForRoles, normalizeRoles, Roles } from '../auth/rbac.js'

const dashboardDirectory = path.resolve(process.cwd(), 'data', 'dashboard')
const rbacFile = path.join(dashboardDirectory, 'rbac.json')

const defaultData = {
  updatedAt: null,
  defaultRoles: [Roles.READ_ONLY],
  assignments: {}
}

let cache = null
let loadingPromise = null

async function loadData() {
  if (cache) {
    return cache
  }
  if (loadingPromise) {
    return loadingPromise
  }

  loadingPromise = (async () => {
    try {
      const contents = await fs.readFile(rbacFile, 'utf8')
      const parsed = JSON.parse(contents)
      cache = {
        updatedAt: parsed.updatedAt ?? null,
        defaultRoles: Array.isArray(parsed.defaultRoles)
          ? normalizeRoles(parsed.defaultRoles)
          : [...defaultData.defaultRoles],
        assignments: parsed.assignments && typeof parsed.assignments === 'object' ? parsed.assignments : {}
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('Failed to load dashboard RBAC assignments:', error)
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

async function persistData(data) {
  await fs.mkdir(dashboardDirectory, { recursive: true })
  const payload = JSON.stringify(
    {
      updatedAt: data.updatedAt,
      defaultRoles: data.defaultRoles,
      assignments: data.assignments
    },
    null,
    2
  )
  await fs.writeFile(rbacFile, payload)
  cache = data
  return cache
}

export async function getRolesForUser(userId) {
  if (!userId) {
    return [...defaultData.defaultRoles]
  }
  const data = await loadData()
  const explicit = data.assignments?.[userId]
  if (Array.isArray(explicit) && explicit.length) {
    return normalizeRoles(explicit)
  }

  const envAdmins = new Set(
    String(process.env.DASHBOARD_DEFAULT_ADMIN_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  )

  if (envAdmins.has(String(userId))) {
    return [Roles.ADMIN, Roles.READ_ONLY]
  }

  return [...data.defaultRoles]
}

export async function setRolesForUser(userId, roles) {
  if (!userId) {
    throw new Error('userId is required to assign roles')
  }
  const data = await loadData()
  const normalized = normalizeRoles(roles)
  const now = new Date().toISOString()
  const assignments = { ...data.assignments }
  assignments[userId] = normalized
  const updated = {
    updatedAt: now,
    defaultRoles: data.defaultRoles,
    assignments
  }
  await persistData(updated)
  return normalizeRoles(normalized)
}

export async function listAssignments() {
  const data = await loadData()
  const entries = Object.entries(data.assignments).map(([userId, roles]) => ({
    userId,
    roles: normalizeRoles(roles)
  }))
  return {
    updatedAt: data.updatedAt,
    defaultRoles: data.defaultRoles,
    assignments: entries
  }
}

export async function getUserAccessSummary(userId) {
  const roles = await getRolesForUser(userId)
  const permissions = derivePermissionsForRoles(roles)
  return {
    roles,
    permissions
  }
}

export async function resetRbacCache() {
  cache = null
}
