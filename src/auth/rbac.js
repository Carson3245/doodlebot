export const Roles = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MOD: 'mod',
  VIEWER: 'viewer'
}

const ROLE_INHERITANCE = {
  [Roles.OWNER]: [Roles.ADMIN, Roles.MOD, Roles.VIEWER],
  [Roles.ADMIN]: [Roles.MOD, Roles.VIEWER],
  [Roles.MOD]: [Roles.VIEWER],
  [Roles.VIEWER]: []
}

export const Permissions = {
  VIEW_OVERVIEW: 'overview:read',
  VIEW_PEOPLE: 'people:read',
  MANAGE_PEOPLE: 'people:actions',
  IMPORT_PEOPLE: 'people:import',
  MANAGE_PEOPLE_NOTES: 'people:notes',
  VIEW_CASES: 'cases:read',
  MANAGE_CASES: 'cases:manage',
  VIEW_CHECKINS: 'checkins:read',
  UPDATE_CHECKINS: 'checkins:update',
  VIEW_INSIGHTS: 'insights:read',
  MANAGE_ALERTS: 'alerts:manage',
  MANAGE_SETTINGS: 'settings:write',
  MANAGE_RBAC: 'rbac:manage',
  MANAGE_VERIFICATION: 'verification:manage',
  EXECUTE_DANGEROUS: 'ops:dangerous',
  ANNOUNCE_PEOPLE: 'people:announce',
  ROLESYNC: 'people:rolesync',
  OFFBOARD: 'people:offboard',
  VIEW_AUDIT: 'audit:read'
}

const PERMISSION_MATRIX = new Map([
  [Permissions.VIEW_OVERVIEW, new Set([Roles.OWNER, Roles.ADMIN, Roles.MOD, Roles.VIEWER])],
  [Permissions.VIEW_PEOPLE, new Set([Roles.OWNER, Roles.ADMIN, Roles.MOD, Roles.VIEWER])],
  [Permissions.MANAGE_PEOPLE, new Set([Roles.OWNER, Roles.ADMIN, Roles.MOD])],
  [Permissions.IMPORT_PEOPLE, new Set([Roles.OWNER, Roles.ADMIN])],
  [Permissions.MANAGE_PEOPLE_NOTES, new Set([Roles.OWNER, Roles.ADMIN, Roles.MOD])],
  [Permissions.VIEW_CASES, new Set([Roles.OWNER, Roles.ADMIN, Roles.MOD, Roles.VIEWER])],
  [Permissions.MANAGE_CASES, new Set([Roles.OWNER, Roles.ADMIN, Roles.MOD])],
  [Permissions.VIEW_CHECKINS, new Set([Roles.OWNER, Roles.ADMIN, Roles.MOD, Roles.VIEWER])],
  [Permissions.UPDATE_CHECKINS, new Set([Roles.OWNER, Roles.ADMIN, Roles.MOD])],
  [Permissions.VIEW_INSIGHTS, new Set([Roles.OWNER, Roles.ADMIN, Roles.MOD, Roles.VIEWER])],
  [Permissions.MANAGE_ALERTS, new Set([Roles.OWNER, Roles.ADMIN])],
  [Permissions.MANAGE_SETTINGS, new Set([Roles.OWNER, Roles.ADMIN])],
  [Permissions.MANAGE_RBAC, new Set([Roles.OWNER, Roles.ADMIN])],
  [Permissions.MANAGE_VERIFICATION, new Set([Roles.OWNER, Roles.ADMIN, Roles.MOD])],
  [Permissions.EXECUTE_DANGEROUS, new Set([Roles.OWNER])],
  [Permissions.ANNOUNCE_PEOPLE, new Set([Roles.OWNER, Roles.ADMIN])],
  [Permissions.ROLESYNC, new Set([Roles.OWNER, Roles.ADMIN, Roles.MOD])],
  [Permissions.OFFBOARD, new Set([Roles.OWNER, Roles.ADMIN])],
  [Permissions.VIEW_AUDIT, new Set([Roles.OWNER, Roles.ADMIN])]
])

export function normalizeRoles(roles = []) {
  const normalized = new Set()
  for (const role of roles) {
    if (!role) {
      continue
    }
    const key = String(role).toLowerCase()
    if (Object.values(Roles).includes(key)) {
      normalized.add(key)
      for (const inherited of ROLE_INHERITANCE[key] ?? []) {
        normalized.add(inherited)
      }
    }
  }
  if (normalized.size === 0) {
    normalized.add(Roles.VIEWER)
  }
  return Array.from(normalized)
}

export function derivePermissionsForRoles(roles = []) {
  const normalizedRoles = normalizeRoles(roles)
  const permissions = new Set()
  for (const [permission, allowedRoles] of PERMISSION_MATRIX.entries()) {
    for (const role of normalizedRoles) {
      if (allowedRoles.has(role)) {
        permissions.add(permission)
        break
      }
    }
  }
  return permissions
}

export function hasPermission(rolesOrPermissions, permission) {
  if (!permission) {
    return true
  }
  if (rolesOrPermissions instanceof Set) {
    return rolesOrPermissions.has(permission)
  }
  const permissions = derivePermissionsForRoles(rolesOrPermissions)
  return permissions.has(permission)
}

export function requirePermission(permission) {
  return (req, res, next) => {
    const access = req.rbac ?? {}
    const permissions = access.permissions instanceof Set ? access.permissions : new Set()
    if (!permissions.has(permission)) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
    next()
  }
}

export function summarizeAccess(roles = []) {
  const normalizedRoles = normalizeRoles(roles)
  const permissions = Array.from(derivePermissionsForRoles(normalizedRoles)).sort()
  return {
    roles: normalizedRoles,
    permissions
  }
}
