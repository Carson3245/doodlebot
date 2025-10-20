import { PermissionsBitField } from 'discord.js'
import { normalizeRoles, derivePermissionsForRoles, Roles } from '../auth/rbac.js'
import { getGuildAssignments, resolveRolesForMember } from '../ops/rbacAssignmentsStore.js'

function unique(array) {
  return Array.from(new Set(array))
}

export async function resolveDashboardAccess({ client, userId = null, guildId = null }) {
  const fallback = buildFallbackAccess()
  if (!userId) {
    return fallback
  }

  const resolvedGuildId = guildId ?? process.env.GUILD_ID ?? null
  let mappedRoles = []

  if (resolvedGuildId) {
    let guild = null
    let member = null

    try {
      const assignments = await getGuildAssignments(resolvedGuildId)
      guild = await client.guilds.fetch(resolvedGuildId).catch(() => null)
      if (guild) {
        member = await guild.members.fetch(userId).catch(() => null)
        if (member) {
          if (guild.ownerId && guild.ownerId === member.id && !mappedRoles.includes(Roles.OWNER)) {
            mappedRoles.push(Roles.OWNER)
          }
          const discordRoles = Array.from(member.roles.cache.keys())
          const resolvedRoles = await resolveRolesForMember({
            guildId: resolvedGuildId,
            discordRoleIds: discordRoles
          })
          if (resolvedRoles.length) {
            mappedRoles.push(...resolvedRoles)
          }

          if (!mappedRoles.length) {
            const permissions = member.permissions
            if (
              permissions?.has(PermissionsBitField.Flags.Administrator) ||
              permissions?.has(PermissionsBitField.Flags.ManageGuild)
            ) {
              mappedRoles.push(Roles.ADMIN)
            } else if (
              permissions?.has(PermissionsBitField.Flags.ModerateMembers) ||
              permissions?.has(PermissionsBitField.Flags.ManageChannels) ||
              permissions?.has(PermissionsBitField.Flags.KickMembers) ||
              permissions?.has(PermissionsBitField.Flags.BanMembers)
            ) {
              mappedRoles.push(Roles.MOD)
            }
          }
        }
      }
      if (!mappedRoles.length && assignments?.defaultRole) {
        mappedRoles.push(assignments.defaultRole)
      }
    } catch (error) {
      console.error('Failed to resolve Discord roles for dashboard access:', error)
    }
  }

  if (!mappedRoles.length) {
    mappedRoles.push(Roles.VIEWER)
  }

  const normalizedRoles = normalizeRoles(unique(mappedRoles))
  const permissions = derivePermissionsForRoles(normalizedRoles)
  return {
    guildId: resolvedGuildId,
    roles: normalizedRoles,
    permissions
  }
}

function buildFallbackAccess() {
  const roles = normalizeRoles([Roles.VIEWER])
  return {
    guildId: process.env.GUILD_ID ?? null,
    roles,
    permissions: derivePermissionsForRoles(roles)
  }
}
