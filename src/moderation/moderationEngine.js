import { EmbedBuilder, PermissionFlagsBits } from 'discord.js'
import {
  getModerationConfigSync,
  loadModerationConfig,
  onModerationConfigChange
} from '../config/moderationStore.js'
import {
  recordCase,
  getUserTotals,
  getModerationStats,
  getRecentCases,
  ensureMemberCase,
  appendCaseMessage,
  updateCaseStatus,
  listCases,
  getCaseForGuild
} from './caseStore.js'

const LINK_REGEX = /(https?:\/\/|www\.)\S+/i
const INVITE_REGEX = /(discord\.gg|discord(?:app)?\.com\/invite)/i
const DEFAULT_PROFANITY = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'bastard',
  'slut',
  'cunt',
  'whore',
  'dick',
  'pussy'
]

export class ModerationEngine {
  constructor(client) {
    this.client = client
    this.config = getModerationConfigSync()
    this.initialized = false
    this.loadingConfig = null
    this.spamBuckets = new Map()
    this.profanity = new Set(DEFAULT_PROFANITY)
    this.logChannelCache = new Map()

    onModerationConfigChange((config) => {
      this.config = config
      this.logChannelCache.clear()
    })
  }

  async init() {
    if (this.initialized) {
      return
    }
    if (!this.loadingConfig) {
      this.loadingConfig = loadModerationConfig().then((config) => {
        this.config = config
        this.initialized = true
        this.loadingConfig = null
      })
    }
    await this.loadingConfig
  }

  async handleMessage(message) {
    await this.init()

    if (!message.guild || message.author.bot) {
      return { actionTaken: false }
    }

    if (this.shouldBypassMember(message.member)) {
      return { actionTaken: false }
    }

    const violation = this.detectViolation(message)
    if (violation) {
      await this.enforceViolation(message, violation)
      return { actionTaken: true, violations: [violation] }
    }

    const spamViolation = await this.handleSpam(message)
    if (spamViolation) {
      return { actionTaken: true, violations: [spamViolation] }
    }

    return { actionTaken: false }
  }

  async warn({ guildId, userId, moderatorId, moderatorTag, reason }) {
    await this.init()
    const context = await this.resolveContext({ guildId, userId, moderatorId })
    if (!context) {
      throw new Error('Unable to resolve member for warn action')
    }
    const { guild, member, moderatorTag: resolvedTag } = context
    await this.applyPenalty('warn', {
      guild,
      member,
      userId,
      userTag: member.user?.tag ?? null,
      moderatorId,
      moderatorTag: moderatorTag ?? resolvedTag ?? null,
      reason,
      source: 'dashboard'
    })
  }

  async timeout({ guildId, userId, moderatorId, moderatorTag, reason, durationMinutes }) {
    await this.init()
    const context = await this.resolveContext({ guildId, userId, moderatorId })
    if (!context) {
      throw new Error('Unable to resolve member for timeout action')
    }
    const { guild, member, moderatorTag: resolvedTag } = context
    await this.applyPenalty('timeout', {
      guild,
      member,
      userId,
      userTag: member.user?.tag ?? null,
      moderatorId,
      moderatorTag: moderatorTag ?? resolvedTag ?? null,
      reason,
      durationMinutes,
      source: 'dashboard'
    })
  }

  async ban({ guildId, userId, moderatorId, moderatorTag, reason }) {
    await this.init()
    const context = await this.resolveContext({ guildId, userId, moderatorId, fetchMemberOptional: true })
    if (!context) {
      throw new Error('Unable to resolve guild for ban action')
    }
    const { guild, member, moderatorTag: resolvedTag } = context
    const userTag = member?.user?.tag ?? null
    await this.applyPenalty('ban', {
      guild,
      member,
      userId,
      userTag,
      moderatorId,
      moderatorTag: moderatorTag ?? resolvedTag ?? null,
      reason,
      source: 'dashboard'
    })
  }

  async getStats() {
    return getModerationStats()
  }

  async getRecentCases(limit = 20) {
    return getRecentCases(limit)
  }

  async resolveContext({ guildId, userId, moderatorId, fetchMemberOptional = false }) {
    if (!guildId || !userId) {
      return null
    }

    const guild = await this.client.guilds.fetch(guildId).catch(() => null)
    if (!guild) {
      return null
    }

    let member = await guild.members.fetch(userId).catch(() => null)
    if (!member && !fetchMemberOptional) {
      return null
    }

    const moderator =
      moderatorId && guild.members?.fetch
        ? await guild.members.fetch(moderatorId).catch(() => null)
        : null

    return {
      guild,
      member,
      moderatorTag: moderator?.user?.tag ?? null
    }
  }

  shouldBypassMember(member) {
    if (!member) {
      return false
    }
    const permissions = member.permissions
    if (!permissions) {
      return false
    }
    return (
      permissions.has(PermissionFlagsBits.Administrator) ||
      permissions.has(PermissionFlagsBits.ManageMessages) ||
      permissions.has(PermissionFlagsBits.ManageGuild)
    )
  }

  detectViolation(message) {
    const filters = this.config.filters ?? {}
    const content = String(message.content ?? '').toLowerCase()

    if (filters.links && LINK_REGEX.test(content)) {
      return {
        type: 'links',
        message: 'Link sharing is restricted in this server.',
        metadata: { content }
      }
    }

    if (filters.invites && INVITE_REGEX.test(content)) {
      return {
        type: 'invites',
        message: 'Sharing Discord invites is blocked.',
        metadata: { content }
      }
    }

    if (filters.media && message.attachments?.size > 0 && !this.shouldBypassMember(message.member)) {
      return {
        type: 'media',
        message: 'Media uploads are currently restricted.',
        metadata: { attachments: message.attachments.size }
      }
    }

    if (filters.profanity && this.containsProfanity(content)) {
      return {
        type: 'profanity',
        message: 'Please keep the conversation respectful.',
        metadata: { content }
      }
    }

    const keywords = filters.customKeywords ?? []
    if (Array.isArray(keywords) && keywords.length > 0) {
      for (const keyword of keywords) {
        if (!keyword) continue
        const normalized = keyword.toLowerCase()
        if (normalized && content.includes(normalized)) {
          return {
            type: 'keyword',
            message: `The term "${keyword}" is not allowed here.`,
            metadata: { keyword, content }
          }
        }
      }
    }

    return null
  }

  containsProfanity(content) {
    if (!content) {
      return false
    }
    const words = content
      .replace(/[^a-z0-9\s]/gi, ' ')
      .split(' ')
      .filter(Boolean)
    return words.some((word) => this.profanity.has(word))
  }

  async enforceViolation(message, violation) {
    if (message.deletable) {
      await message.delete().catch(() => {})
    }

    const guild = message.guild
    const member = message.member
    if (!guild || !member) {
      return
    }

    const reason = `Automod: ${violation.type}`
    try {
      await this.applyPenalty('warn', {
        guild,
        member,
        userId: member.id,
        userTag: member.user?.tag ?? null,
        reason: violation.message ?? reason,
        source: violation.type,
        metadata: violation.metadata ?? {}
      })
    } catch (error) {
      console.error('Failed to apply automod warning:', error)
    }
  }

  async handleSpam(message) {
    const spamConfig = this.config.spam ?? {}
    const limit = spamConfig.messagesPerMinute ?? 0
    if (limit <= 0) {
      return null
    }

    const now = Date.now()
    const bucket = this.spamBuckets.get(message.author.id) ?? []
    bucket.push(now)
    while (bucket.length && bucket[0] < now - 60_000) {
      bucket.shift()
    }
    this.spamBuckets.set(message.author.id, bucket)

    if (bucket.length > limit) {
      this.spamBuckets.set(message.author.id, [])
      const guild = message.guild
      const member = message.member
      if (!guild || !member) {
        return { type: 'spam' }
      }

      const duration = spamConfig.autoTimeoutMinutes ?? 10
      const reason = `Automated timeout: ${bucket.length} messages in 60 seconds`
      try {
        await this.applyPenalty('timeout', {
          guild,
          member,
          userId: member.id,
          userTag: member.user?.tag ?? null,
          reason,
          durationMinutes: duration,
          source: 'spam-detector',
          metadata: { messages: bucket.length }
        })
      } catch (error) {
        console.error('Failed to apply spam timeout:', error)
      }
      return { type: 'spam', reason }
    }

    return null
  }

  async applyPenalty(action, context) {
    const {
      guild,
      member,
      userId,
      userTag,
      moderatorId,
      moderatorTag,
      reason,
      durationMinutes,
      source,
      metadata
    } = context

    if (!guild || !userId) {
      return
    }

    const actingModerator = this.client.user
    const resolvedModeratorId = moderatorId ?? actingModerator?.id ?? null
    const resolvedModeratorTag =
      moderatorTag ?? actingModerator ? `${actingModerator?.username}#${actingModerator?.discriminator ?? '0'}` : null

    try {
      if (action === 'timeout') {
        const duration = Math.max(1, durationMinutes ?? this.config.spam?.autoTimeoutMinutes ?? 10)
        const durationMs = duration * 60 * 1000
        await this.ensureMemberModeratable(member, 'timeout')
        await member.timeout(durationMs, reason ?? 'Timeout applied.')
        await this.sendDm(member, 'timeout', reason, duration)
      } else if (action === 'ban') {
        if (member?.bannable) {
          await member.ban({ reason: reason ?? 'Ban issued.' })
        } else {
          await guild.bans.create(userId, { reason: reason ?? 'Ban issued.' })
        }
        await this.sendDm(member, 'ban', reason)
      } else {
        await this.sendDm(member, 'warn', reason)
      }
    } catch (error) {
      console.error(`Failed to execute ${action} for ${userId}:`, error)
      throw error
    }

    const { entry, totals } = await recordCase({
      guildId: guild.id,
      guildName: guild.name ?? null,
      userId,
      userTag: userTag ?? null,
      moderatorId: resolvedModeratorId,
      moderatorTag: resolvedModeratorTag,
      action,
      reason: reason ?? null,
      durationMinutes: action === 'timeout' ? durationMinutes ?? this.config.spam?.autoTimeoutMinutes ?? 10 : null,
      source: source ?? 'system',
      metadata: metadata ?? null
    })

    await this.notifyLog(guild, entry)

    await this.evaluateEscalation(guild, member, entry, totals)
  }

  async ensureMemberModeratable(member, action) {
    if (!member) {
      throw new Error(`Cannot ${action}: member not found`)
    }
    if (!member.moderatable) {
      throw new Error(`Cannot ${action}: missing permissions or hierarchy issue`)
    }
  }

  async evaluateEscalation(guild, member, entry, totals) {
    const escalation = this.config.escalation ?? {}
    if (entry.action === 'warn') {
      const warnThreshold = escalation.warnThreshold ?? 0
      const timeoutThreshold = escalation.timeoutThreshold ?? 0
      if (warnThreshold > 0 && totals.warnings % warnThreshold === 0) {
        try {
          await this.applyPenalty('timeout', {
            guild,
            member: await this.ensureMemberForEscalation(guild, member, entry.userId),
            userId: entry.userId,
            userTag: entry.userTag,
            reason: `Auto-timeout after ${totals.warnings} warnings.`,
            durationMinutes: this.config.spam?.autoTimeoutMinutes ?? 10,
            source: 'auto-escalation',
            metadata: { escalatedFrom: 'warn' }
          })
        } catch (error) {
          console.error('Failed to escalate warning to timeout:', error)
        }
        return
      }

      if (timeoutThreshold > 0 && totals.warnings % timeoutThreshold === 0) {
        try {
          await this.applyPenalty('timeout', {
            guild,
            member: await this.ensureMemberForEscalation(guild, member, entry.userId),
            userId: entry.userId,
            userTag: entry.userTag,
            reason: `Auto-timeout after ${totals.warnings} warnings.`,
            durationMinutes: this.config.spam?.autoTimeoutMinutes ?? 10,
            source: 'auto-escalation',
            metadata: { escalatedFrom: 'warn-threshold' }
          })
        } catch (error) {
          console.error('Failed to escalate warning threshold to timeout:', error)
        }
      }
    } else if (entry.action === 'timeout') {
      const timeoutThreshold = escalation.timeoutThreshold ?? 0
      const banThreshold = escalation.banThreshold ?? 0
      const offences = (totals.warnings ?? 0) + (totals.timeouts ?? 0)

      if ((timeoutThreshold > 0 && totals.timeouts % timeoutThreshold === 0) || (banThreshold > 0 && offences >= banThreshold)) {
        try {
          await this.applyPenalty('ban', {
            guild,
            member: await this.ensureMemberForEscalation(guild, member, entry.userId, true),
            userId: entry.userId,
            userTag: entry.userTag,
            reason: `Auto-ban after repeated offences (warnings: ${totals.warnings}, timeouts: ${totals.timeouts}).`,
            source: 'auto-escalation',
            metadata: { escalatedFrom: 'timeout' }
          })
        } catch (error) {
          console.error('Failed to escalate timeout to ban:', error)
        }
      }
    }
  }

  async ensureMemberForEscalation(guild, member, userId, optional = false) {
    if (member) {
      return member
    }
    if (!guild) {
      return null
    }
    const fetched = await guild.members.fetch(userId).catch(() => null)
    if (!fetched && !optional) {
      throw new Error('Member not found for escalation')
    }
    return fetched
  }

  async openMemberCase({ guild, member, reason, initialMessage }) {
    await this.init()
    if (!guild || !member) {
      throw new Error('Guild and member are required')
    }
    return ensureMemberCase({
      guildId: guild.id,
      guildName: guild.name ?? null,
      userId: member.id,
      userTag: member.user?.tag ?? null,
      reason,
      initialMessage
    })
  }

  async postModeratorMessage({ guildId, caseId, moderatorId, moderatorTag, body }) {
    await this.init()
    const trimmed = String(body ?? '').trim()
    if (!trimmed) {
      throw new Error('Message cannot be empty')
    }

    const message = await appendCaseMessage({
      guildId,
      caseId,
      authorType: 'moderator',
      authorId: moderatorId ? String(moderatorId) : null,
      authorTag: moderatorTag ?? null,
      body: trimmed,
      via: 'dashboard'
    })

    await updateCaseStatus({
      guildId,
      caseId,
      status: 'open',
      actorId: moderatorId ? String(moderatorId) : null,
      actorTag: moderatorTag ?? null,
      note: 'Moderator replied from dashboard.'
    }).catch(() => {})

    const caseEntry = await getCaseForGuild(guildId, caseId)
    if (caseEntry) {
      const guild = await this.client.guilds.fetch(guildId).catch(() => null)
      const member =
        guild && caseEntry.userId ? await guild.members.fetch(caseEntry.userId).catch(() => null) : null
      if (member) {
        const header = `Moderation update from ${guild.name}`
        const dm = [`${header}:`, '', trimmed]
        await member.user.send(dm.join('\n')).catch(() => {})
      }
    }

    return message
  }

  async postMemberMessage({ guild, member, body }) {
    await this.init()
    if (!guild || !member) {
      return null
    }
    const trimmed = String(body ?? '').trim()
    if (!trimmed) {
      return null
    }

    const caseEntry = await ensureMemberCase({
      guildId: guild.id,
      guildName: guild.name ?? null,
      userId: member.id,
      userTag: member.user?.tag ?? null,
      initialMessage: null
    })

    const message = await appendCaseMessage({
      guildId: guild.id,
      caseId: caseEntry.id,
      authorType: 'member',
      authorId: member.id,
      authorTag: member.user?.tag ?? null,
      body: trimmed,
      via: 'member'
    })

    const alerts = this.config.alerts ?? {}
    if (alerts.notifyOnAutoAction && alerts.staffRoleId) {
      const logGuild = await this.client.guilds.fetch(guild.id).catch(() => null)
      const channel = logGuild ? await this.getLogChannel(logGuild, alerts.logChannelId) : null
      if (channel && channel.isTextBased()) {
        const mention = `<@&${alerts.staffRoleId}>`
        await channel
          .send(
            `${mention} New support message from ${member} in ${guild.name}. Open case ${caseEntry.id} in the dashboard.`
          )
          .catch(() => {})
      }
    }

    return { caseEntry, message }
  }

  async listCasesForGuild(guildId, { status = 'all', limit = 50 } = {}) {
    await this.init()
    return listCases({ guildId, status, limit })
  }

  async getCaseDetails(guildId, caseId) {
    await this.init()
    return getCaseForGuild(guildId, caseId)
  }

  async setCaseStatus({ guildId, caseId, status, moderatorId, moderatorTag, note }) {
    await this.init()
    return updateCaseStatus({
      guildId,
      caseId,
      status,
      actorId: moderatorId ? String(moderatorId) : null,
      actorTag: moderatorTag ?? null,
      note: note ?? null
    })
  }


  async notifyLog(guild, entry) {
    const alerts = this.config.alerts ?? {}
    const logChannelId = alerts.logChannelId
    if (!logChannelId) {
      return
    }

    try {
      const channel = await this.getLogChannel(guild, logChannelId)
      if (!channel || !channel.isTextBased()) {
        return
      }

      const embed = new EmbedBuilder()
        .setTitle(`Automod: ${entry.action}`)
        .setColor(this.colorForAction(entry.action))
        .addFields(
          { name: 'User', value: `<@${entry.userId}> (${entry.userId})`, inline: false },
          {
            name: 'Reason',
            value: entry.reason ?? 'No reason provided.',
            inline: false
          }
        )
        .setTimestamp(new Date(entry.createdAt ?? Date.now()))

      if (entry.durationMinutes) {
        embed.addFields({
          name: 'Duration',
          value: `${entry.durationMinutes} minutes`,
          inline: true
        })
      }

      if (entry.moderatorId) {
        embed.addFields({
          name: 'Moderator',
          value: entry.moderatorTag ? `${entry.moderatorTag} (${entry.moderatorId})` : `<@${entry.moderatorId}>`,
          inline: true
        })
      }

      const mentionStaff = alerts.notifyOnAutoAction && alerts.staffRoleId ? `<@&${alerts.staffRoleId}>` : null
      await channel.send({
        content: mentionStaff ?? undefined,
        embeds: [embed]
      })
    } catch (error) {
      console.error('Failed to send moderation log message:', error)
    }
  }

  async getLogChannel(guild, channelId) {
    if (!channelId) {
      return null
    }
    const cacheKey = `${guild.id}:${channelId}`
    if (this.logChannelCache.has(cacheKey)) {
      return this.logChannelCache.get(cacheKey)
    }

    const channel =
      guild.channels?.fetch
        ? await guild.channels.fetch(channelId).catch(() => null)
        : await this.client.channels.fetch(channelId).catch(() => null)

    if (channel) {
      this.logChannelCache.set(cacheKey, channel)
    }

    return channel
  }

  colorForAction(action) {
    switch (action) {
      case 'warn':
        return 0xffc107
      case 'timeout':
        return 0x02a9f7
      case 'ban':
        return 0xd32f2f
      default:
        return 0x7289da
    }
  }

  async sendDm(member, templateKey, reason, duration) {
    if (!member?.user) {
      return
    }

    const templates = this.config.dmTemplates ?? {}
    const template = templates[templateKey] ?? defaultTemplateFor(templateKey)
    if (!template) {
      return
    }

    const message = template
      .replace(/{guild}/g, member.guild?.name ?? 'this server')
      .replace(/{reason}/g, reason ?? 'No reason provided.')
      .replace(/{duration}/g, duration ? String(duration) : 'N/A')

    await member.user.send(message).catch(() => {})
  }
}

function defaultTemplateFor(action) {
  switch (action) {
    case 'warn':
      return 'You received a warning in {guild}. Reason: {reason}'
    case 'timeout':
      return 'You have been timed out in {guild}. Duration: {duration} minutes. Reason: {reason}'
    case 'ban':
      return 'You have been banned from {guild}. Reason: {reason}'
    default:
      return null
  }
}
