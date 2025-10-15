export const Roles = {
  ADMIN: 'admin',
  RH_LITE: 'rh-lite',
  MODERATOR: 'mod',
  MANAGER: 'manager',
  READ_ONLY: 'read-only'
}

const ROLE_INHERITANCE = {
  [Roles.ADMIN]: [Roles.RH_LITE, Roles.MODERATOR, Roles.MANAGER, Roles.READ_ONLY],
  [Roles.RH_LITE]: [Roles.MANAGER, Roles.READ_ONLY],
  [Roles.MANAGER]: [Roles.READ_ONLY],
  [Roles.MODERATOR]: [Roles.READ_ONLY],
  [Roles.READ_ONLY]: []
}

export const Permissions = {
  VIEW_PEOPLE: 'people:read',
  MANAGE_PEOPLE: 'people:manage',
  IMPORT_PEOPLE: 'people:import',
  ANNOUNCE_PEOPLE: 'people:announce',
  ROLESYNC: 'people:rolesync',
  OFFBOARD: 'people:offboard',
  VIEW_CHECKINS: 'checkins:read',
  UPDATE_CHECKINS: 'checkins:update',
  VIEW_AUDIT: 'audit:read',
  VIEW_INSIGHTS: 'insights:read',
  MANAGE_SETTINGS: 'settings:write'
}

const PERMISSION_MATRIX = new Map([
  [Permissions.VIEW_PEOPLE, new Set([Roles.ADMIN, Roles.RH_LITE, Roles.MODERATOR, Roles.MANAGER, Roles.READ_ONLY])],
  [Permissions.MANAGE_PEOPLE, new Set([Roles.ADMIN, Roles.RH_LITE, Roles.MANAGER])],
  [Permissions.IMPORT_PEOPLE, new Set([Roles.ADMIN, Roles.RH_LITE])],
  [Permissions.ANNOUNCE_PEOPLE, new Set([Roles.ADMIN, Roles.RH_LITE, Roles.MANAGER])],
  [Permissions.ROLESYNC, new Set([Roles.ADMIN, Roles.RH_LITE, Roles.MODERATOR])],
  [Permissions.OFFBOARD, new Set([Roles.ADMIN, Roles.RH_LITE])],
  [Permissions.VIEW_CHECKINS, new Set([Roles.ADMIN, Roles.RH_LITE, Roles.MANAGER, Roles.READ_ONLY])],
  [Permissions.UPDATE_CHECKINS, new Set([Roles.ADMIN, Roles.RH_LITE, Roles.MANAGER])],
  [Permissions.VIEW_AUDIT, new Set([Roles.ADMIN, Roles.RH_LITE])],
  [Permissions.VIEW_INSIGHTS, new Set([Roles.ADMIN, Roles.RH_LITE, Roles.MANAGER])],
  [Permissions.MANAGE_SETTINGS, new Set([Roles.ADMIN])]
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
    normalized.add(Roles.READ_ONLY)
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
