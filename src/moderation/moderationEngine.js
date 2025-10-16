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
  findActiveCaseForMember,
  appendCaseMessage,
  updateCaseStatus,
  listCases,
  getCaseForGuild,
  getCase,
  deleteCase,
  setCaseAssignee,
  updateCaseSla
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
    this.supportChannelCache = new Map()

    onModerationConfigChange((config) => {
      this.config = config
      this.logChannelCache.clear()
      this.supportChannelCache.clear()
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

    if (this.shouldBypassMember(message.member) || this.isWhitelisted(message)) {
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

  isWhitelisted(message) {
    try {
      const scopes = this.config.scopes ?? {}
      const channelAllow = new Set(scopes.channelAllow ?? [])
      const roleAllow = new Set(scopes.roleAllow ?? [])
      const userAllow = new Set(scopes.userAllow ?? [])
      if (!message) return false
      if (userAllow.has(String(message.author?.id))) return true
      if (channelAllow.has(String(message.channelId))) return true
      const roles = message.member?.roles?.cache ? Array.from(message.member.roles.cache.keys()) : []
      for (const r of roles) {
        if (roleAllow.has(String(r))) return true
      }
      return false
    } catch {
      return false
    }
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

  async kick({ guildId, userId, moderatorId, moderatorTag, reason }) {
    await this.init()
    const context = await this.resolveContext({ guildId, userId, moderatorId })
    if (!context || !context.member) {
      throw new Error('Unable to resolve member for kick action')
    }
    const { guild, member, moderatorTag: resolvedTag } = context
    await this.applyPenalty('kick', {
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
      const evidence = {
        content: message.content ?? '',
        messageId: message.id ?? null,
        channelId: message.channelId ?? null,
        jumpUrl: message.url ?? null,
        attachments: Array.from(message.attachments?.values?.() ?? [])
      }
      await this.applyPenalty('warn', {
        guild,
        member,
        userId: member.id,
        userTag: member.user?.tag ?? null,
        reason: violation.message ?? reason,
        source: violation.type,
        metadata: { ...(violation.metadata ?? {}), evidence }
      })
    } catch (error) {
      console.error('Failed to apply automod warning:', error)
    }
  }

  async handleSpam(message) {
    const spamConfig = this.config.spam ?? {}
    const perMinute = spamConfig.messagesPerMinute ?? 0
    const limits = spamConfig.limits ?? {}
    const windowSec = Math.max(3, limits.windowSec ?? 10)
    if (perMinute <= 0 && !limits.messages && !limits.mentions && !limits.links && !limits.emojis && !limits.attachments) {
      return null
    }

    const now = Date.now()
    // legacy per-minute bucket
    if (perMinute > 0) {
      const minute = this.spamBuckets.get(`m:${message.author.id}`) ?? []
      minute.push(now)
      while (minute.length && minute[0] < now - 60_000) minute.shift()
      this.spamBuckets.set(`m:${message.author.id}`, minute)
      if (minute.length > perMinute) {
        return await this.timeoutForSpam(message, `Automated timeout: ${minute.length} messages in 60 seconds`, { window: '60s', messages: minute.length })
      }
    }

    const key = (t) => `${t}:${message.author.id}`
    const step = (k) => {
      const arr = this.spamBuckets.get(k) ?? []
      arr.push(now)
      while (arr.length && arr[0] < now - windowSec * 1000) arr.shift()
      this.spamBuckets.set(k, arr)
      return arr.length
    }

    const msgCount = limits.messages ? step(key('s:msg')) : 0
    const mentionCount = limits.mentions ? (message.mentions?.users?.size ?? 0) + (message.mentions?.roles?.size ?? 0) : 0
    const mentionBucket = limits.mentions ? step(key(`s:men:${mentionCount}`)) : 0 // simple tick
    const linkMatches = (String(message.content ?? '').match(/(https?:\/\/|www\.)\S+/gi) || []).length
    const linkBucket = limits.links && linkMatches > 0 ? step(key(`s:lnk`)) + (linkMatches - 1) : 0
    const emojiMatches = (String(message.content ?? '').match(/<a?:\w+:\d+>|[\u{1F300}-\u{1FAFF}]/gu) || []).length
    const emojiBucket = limits.emojis && emojiMatches > 0 ? step(key('s:emo')) + Math.max(0, emojiMatches - 1) : 0
    const attachCount = limits.attachments ? (message.attachments?.size ?? 0) : 0
    const attachBucket = limits.attachments && attachCount > 0 ? step(key('s:att')) + Math.max(0, attachCount - 1) : 0

    const violations = []
    if (limits.messages && msgCount > limits.messages) violations.push('messages')
    if (limits.mentions && mentionCount > limits.mentions) violations.push('mentions')
    if (limits.links && linkMatches > limits.links) violations.push('links')
    if (limits.emojis && emojiMatches > limits.emojis) violations.push('emojis')
    if (limits.attachments && attachCount > limits.attachments) violations.push('attachments')

    if (violations.length) {
      const reason = `Automated timeout: ${violations.join(', ')} spike in ${windowSec}s`
      return await this.timeoutForSpam(message, reason, {
        window: `${windowSec}s`,
        messages: msgCount,
        mentions: mentionCount,
        links: linkMatches,
        emojis: emojiMatches,
        attachments: attachCount
      })
    }

    return null
  }

  async timeoutForSpam(message, reason, metrics) {
    const spamConfig = this.config.spam ?? {}
    const guild = message.guild
    const member = message.member
    if (!guild || !member) return { type: 'spam', reason }
    const duration = spamConfig.autoTimeoutMinutes ?? 10
    try {
      await this.applyPenalty('timeout', {
        guild,
        member,
        userId: member.id,
        userTag: member.user?.tag ?? null,
        reason,
        durationMinutes: duration,
        source: 'spam-detector',
        metadata: { spam: metrics, evidence: { content: message.content ?? '', messageId: message.id ?? null, channelId: message.channelId ?? null, jumpUrl: message.url ?? null, attachments: Array.from(message.attachments?.values?.() ?? []) } }
      })
    } catch (error) {
      console.error('Failed to apply spam timeout:', error)
    }
    return { type: 'spam', reason }
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
      } else if (action === 'kick') {
        await this.ensureMemberModeratable(member, 'kick')
        await member.kick(reason ?? 'Kick issued.')
        await this.sendDm(member, 'kick', reason)
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

    const { entry, action: actionRecord, totals } = await recordCase({
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

    await this.notifyLog(guild, entry, actionRecord)

    await this.evaluateEscalation(guild, member, entry, totals)
  }

  async ensureMemberModeratable(member, action) {
    if (!member) {
      throw new Error(`Cannot ${action}: member not found`)
    }
    if (action === 'kick') {
      if (!member.kickable) {
        throw new Error('Cannot kick: missing permissions or hierarchy issue')
      }
      return
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
          await updateCaseStatus({
            guildId: guild.id,
            caseId: entry.id,
            status: 'escalated',
            actorType: 'system',
            note: `Escalated after ${totals.warnings} warnings.`
          }).catch(() => {})
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
          await updateCaseStatus({
            guildId: guild.id,
            caseId: entry.id,
            status: 'escalated',
            actorType: 'system',
            note: `Escalated after crossing warning threshold (${totals.warnings}).`
          }).catch(() => {})
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
          await updateCaseStatus({
            guildId: guild.id,
            caseId: entry.id,
            status: 'escalated',
            actorType: 'system',
            note: 'Escalated to ban due to repeated offences.'
          }).catch(() => {})
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
    const result = await ensureMemberCase({
      guildId: guild.id,
      guildName: guild.name ?? null,
      userId: member.id,
      userTag: member.user?.tag ?? null,
      reason,
      initialMessage,
      category: 'moderation'
    })
    return result.case
  }

  async openSupportRequest({
    guildId,
    userId,
    requestedById,
    requestedByTag,
    category = 'ticket',
    topicId = null,
    topicLabel = null,
    reason,
    origin = 'slash',
    intakeChannelId = null
  }) {
    await this.init()
    if (!guildId || !userId) {
      throw new Error('Guild and user are required to open a support request')
    }

    const normalizedCategory = category === 'ticket' ? 'ticket' : 'moderation'
    const context = await this.resolveContext({ guildId, userId, fetchMemberOptional: false })
    if (!context || !context.guild || !context.member) {
      throw new Error('Unable to resolve member for support request')
    }

    const { guild, member } = context
    const trimmedReason = typeof reason === 'string' ? reason.trim() : ''
    const initialMessage = trimmedReason.length
      ? trimmedReason
      : normalizedCategory === 'ticket'
        ? 'Member opened a support ticket.'
        : 'Member requested moderation assistance.'

    const supportConfig = this.config.support ?? {}
    const targetChannelId = intakeChannelId ?? supportConfig.intakeChannelId ?? null

    const ensured = await ensureMemberCase({
      guildId: guild.id,
      guildName: guild.name ?? null,
      userId: member.id,
      userTag: member.user?.tag ?? null,
      reason: trimmedReason.length ? trimmedReason : null,
      initialMessage,
      category: normalizedCategory,
      ticketType: topicId,
      supportTopicLabel: topicLabel,
      supportContext: origin,
      source: 'support',
      allowExisting: false,
      intakeChannelId: targetChannelId
    })

    const caseEntry = ensured.case
    const message = ensured.message ?? caseEntry.messages?.[caseEntry.messages.length - 1] ?? null

    await this.notifyStaffOfMemberMessage({
      guildId: guild.id,
      memberDisplay: member?.toString?.() ?? member.user?.tag ?? member.id,
      caseEntry
    })

    await this.sendSupportIntakeMessage({
      guild,
      member,
      caseEntry,
      channelId: targetChannelId,
      topicLabel,
      reason: trimmedReason,
      category: normalizedCategory,
      requestedById,
      requestedByTag,
      origin
    })

    return { case: caseEntry, message, created: ensured.created, intakeChannelId: targetChannelId }
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
      actorType: 'moderator',
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

    const ensured = await ensureMemberCase({
      guildId: guild.id,
      guildName: guild.name ?? null,
      userId: member.id,
      userTag: member.user?.tag ?? null,
      initialMessage: null,
      category: 'moderation'
    })
    const caseEntry = ensured.case

    const message = await appendCaseMessage({
      guildId: guild.id,
      caseId: caseEntry.id,
      authorType: 'member',
      authorId: member.id,
      authorTag: member.user?.tag ?? null,
      body: trimmed,
      via: 'member'
    })

    await this.notifyStaffOfMemberMessage({
      guildId: guild.id,
      memberDisplay: member?.toString?.() ?? member?.user?.tag ?? null,
      caseEntry
    })

    return { caseEntry, message }
  }

  async routeMemberDirectMessage({ user, body, attachments = [] }) {
    await this.init()
    if (!user) {
      return null
    }

    const baseContent = typeof body === 'string' ? body : ''
    const trimmed = baseContent.trim()
    const attachmentLines = (Array.isArray(attachments) ? attachments : [])
      .map((attachment) => {
        const url = attachment?.url ?? attachment?.proxyURL ?? attachment?.attachment ?? null
        return url ? `Attachment: ${url}` : null
      })
      .filter(Boolean)

    let combined = trimmed
    if (attachmentLines.length) {
      const attachmentText = attachmentLines.join('\n')
      combined = combined.length ? `${combined}\n\n${attachmentText}` : attachmentText
    }

    const finalBody = combined.trim()
    if (!finalBody.length) {
      return null
    }

    let caseEntry = await findActiveCaseForMember(user.id)
    if (!caseEntry) {
      const mutualGuilds = await this.findMemberGuilds(user.id)
      for (const { guild, member } of mutualGuilds) {
        const ensured = await ensureMemberCase({
          guildId: guild.id,
          guildName: guild.name ?? null,
          userId: user.id,
          userTag: resolveUserTag(user),
          initialMessage: finalBody,
          category: 'moderation'
        })
        caseEntry = ensured.case
        const message = ensured.message ?? caseEntry.messages?.[caseEntry.messages.length - 1] ?? null
        await this.notifyStaffOfMemberMessage({
          guildId: guild.id,
          memberDisplay: member?.toString?.() ?? resolveUserTag(user) ?? user.id,
          caseEntry
        })
        return { caseEntry, message }
      }
      return null
    }

    const message = await appendCaseMessage({
      guildId: caseEntry.guildId,
      caseId: caseEntry.id,
      authorType: 'member',
      authorId: user.id,
      authorTag: resolveUserTag(user),
      body: finalBody,
      via: 'dm'
    })

    await this.notifyStaffOfMemberMessage({
      guildId: caseEntry.guildId,
      memberDisplay: user?.toString?.() ?? resolveUserTag(user) ?? user.id,
      caseEntry
    })

    return { caseEntry, message }
  }

  async listCasesForGuild(guildId, options = {}) {
    await this.init()
    return listCases({ guildId, ...(options ?? {}) })
  }

  async getCase(caseId) {
    await this.init()
    return getCase(caseId)
  }

  async getCaseDetails(guildId, caseId) {
    await this.init()
    return getCaseForGuild(guildId, caseId)
  }

  async getUserTotals(guildId, userId) {
    await this.init()
    return getUserTotals(guildId, userId)
  }

  async setCaseStatus({ guildId, caseId, status, moderatorId, moderatorTag, note }) {
    await this.init()
    return updateCaseStatus({
      guildId,
      caseId,
      status,
      actorId: moderatorId ? String(moderatorId) : null,
      actorTag: moderatorTag ?? null,
      actorType: 'moderator',
      note: note ?? null
    })
  }

  async setCaseAssignee({
    guildId,
    caseId,
    assigneeId,
    assigneeTag,
    assigneeDisplayName,
    moderatorId,
    moderatorTag
  }) {
    await this.init()
    return setCaseAssignee({
      guildId,
      caseId,
      assigneeId,
      assigneeTag,
      assigneeDisplayName,
      actorId: moderatorId ? String(moderatorId) : null,
      actorTag: moderatorTag ?? null
    })
  }

  async setCaseSla({ guildId, caseId, dueAt, moderatorId, moderatorTag }) {
    await this.init()
    return updateCaseSla({
      guildId,
      caseId,
      dueAt,
      actorId: moderatorId ? String(moderatorId) : null,
      actorTag: moderatorTag ?? null
    })
  }

  async deleteCase({ guildId, caseId, moderatorId, moderatorTag }) {
    await this.init()
    return deleteCase({
      guildId,
      caseId,
      actorId: moderatorId ? String(moderatorId) : null,
      actorTag: moderatorTag ?? null,
      actorType: 'moderator'
    })
  }


  async notifyLog(guild, caseEntry, actionRecord) {
    const alerts = this.config.alerts ?? {}
    const logChannelId = alerts.logChannelId
    if (!logChannelId) {
      return
    }

    try {
      if (!caseEntry) {
        return
      }
      const channel = await this.getLogChannel(guild, logChannelId)
      if (!channel || !channel.isTextBased()) {
        return
      }

      const actionType = actionRecord?.type ?? 'update'
      const actionLabel = actionType.charAt(0).toUpperCase() + actionType.slice(1)
      const reason =
        actionRecord?.reason ?? caseEntry.metadata?.reason ?? 'No reason provided.'

      const embed = new EmbedBuilder()
        .setTitle(`Moderation action: ${actionLabel}`)
        .setColor(this.colorForAction(actionType))
        .addFields(
          { name: 'User', value: `<@${caseEntry.userId}> (${caseEntry.userId})`, inline: false },
          { name: 'Case ID', value: caseEntry.id, inline: true },
          {
            name: 'Reason',
            value: reason,
            inline: false
          }
        )
        .setTimestamp(new Date(actionRecord?.createdAt ?? caseEntry.updatedAt ?? Date.now()))

      if (caseEntry.subject) {
        embed.setDescription(caseEntry.subject)
      }

      if (actionRecord?.durationMinutes) {
        embed.addFields({
          name: 'Duration',
          value: `${actionRecord.durationMinutes} minutes`,
          inline: true
        })
      }

      if (actionRecord?.moderatorId) {
        embed.addFields({
          name: 'Moderator',
          value: actionRecord.moderatorTag
            ? `${actionRecord.moderatorTag} (${actionRecord.moderatorId})`
            : `<@${actionRecord.moderatorId}>`,
          inline: true
        })
      }

      if (caseEntry.status) {
        const statusLabel = caseEntry.status
          .split('-')
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' ')
        embed.addFields({
          name: 'Case status',
          value: statusLabel,
          inline: true
        })
      }

      if (actionRecord?.source) {
        embed.addFields({ name: 'Source', value: actionRecord.source, inline: true })
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

  async notifyStaffOfMemberMessage({ guildId, memberDisplay, caseEntry }) {
    const alerts = this.config.alerts ?? {}
    if (!alerts.notifyOnAutoAction || !alerts.staffRoleId || !alerts.logChannelId) {
      return
    }

    const logGuild = await this.client.guilds.fetch(guildId).catch(() => null)
    if (!logGuild) {
      return
    }

    const channel = await this.getLogChannel(logGuild, alerts.logChannelId)
    if (!channel || !channel.isTextBased()) {
      return
    }

    const mention = `<@&${alerts.staffRoleId}>`
    const display =
      typeof memberDisplay === 'string' && memberDisplay.trim().length
        ? memberDisplay.trim()
        : caseEntry?.userTag
          ? caseEntry.userTag
          : caseEntry?.userId
            ? `<@${caseEntry.userId}>`
            : 'a member'
    const guildName = logGuild.name ?? 'the server'
    const caseId = caseEntry?.id ?? 'unknown'
    const categoryLabel = caseEntry?.category === 'ticket' ? 'ticket' : 'case'

    await channel
      .send(
        `${mention} New ${categoryLabel} update from ${display} in ${guildName}. Open case ${caseId} in the dashboard.`
      )
      .catch(() => {})
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

  async getSupportChannel(guild, channelId) {
    if (!channelId) {
      return null
    }
    const cacheKey = `${guild.id}:${channelId}`
    if (this.supportChannelCache.has(cacheKey)) {
      return this.supportChannelCache.get(cacheKey)
    }

    const channel =
      guild.channels?.fetch
        ? await guild.channels.fetch(channelId).catch(() => null)
        : await this.client.channels.fetch(channelId).catch(() => null)

    if (channel) {
      this.supportChannelCache.set(cacheKey, channel)
    }

    return channel
  }

  async sendSupportIntakeMessage({
    guild,
    member,
    caseEntry,
    channelId,
    topicLabel,
    reason,
    category,
    requestedById,
    requestedByTag,
    origin
  }) {
    if (!guild || !channelId) {
      return
    }

    const channel = await this.getSupportChannel(guild, channelId)
    if (!channel || !channel.isTextBased()) {
      return
    }

    const alerts = this.config.alerts ?? {}
    const mention = null
    const color = category === 'ticket' ? 0x4f86f7 : 0xffb020
    const description = reason && reason.length ? reason : 'No description provided.'

    const embed = new EmbedBuilder()
      .setTitle(category === 'ticket' ? 'New support ticket' : 'New moderation case request')
      .setColor(color)
      .setDescription(description)
      .setTimestamp(caseEntry?.createdAt ? new Date(caseEntry.createdAt) : new Date())
      .addFields(
        {
          name: 'Member',
          value:
            member?.toString?.() ??
            (member?.user?.tag ? `${member.user.tag} (${member.id})` : `<@${member?.id ?? 'unknown'}>`),
          inline: false
        },
        {
          name: 'Category',
          value: category === 'ticket' ? 'Ticket' : 'Moderation case',
          inline: true
        }
      )

    if (topicLabel) {
      embed.addFields({ name: 'Topic', value: topicLabel, inline: true })
    }

    if (caseEntry?.id) {
      embed.addFields({ name: 'Case ID', value: caseEntry.id, inline: true })
    }

    const openedByDifferent = requestedById && requestedById !== member?.id
    if (openedByDifferent) {
      const display = requestedByTag ? `${requestedByTag} (${requestedById})` : `<@${requestedById}>`
      embed.addFields({ name: 'Requested by', value: display, inline: true })
    }

    embed.addFields({
      name: 'Origin',
      value: origin === 'dm' ? 'Direct message' : 'In-server command',
      inline: true
    })

    try {
      await channel.send({ content: mention ?? undefined, embeds: [embed] })
    } catch (error) {
      console.error('Failed to post support intake message:', error)
    }
  }

  async findMemberGuilds(userId) {
    if (!userId) {
      return []
    }

    let guildCollection = this.client.guilds?.cache ?? null
    if (!guildCollection || guildCollection.size === 0) {
      const fetched = await this.client.guilds?.fetch?.().catch(() => null)
      if (fetched) {
        guildCollection = fetched
      }
    }

    if (!guildCollection) {
      return []
    }

    const results = []
    for (const guild of guildCollection.values()) {
      if (!guild?.members?.fetch) {
        continue
      }
      const member = await guild.members.fetch(userId).catch(() => null)
      if (member) {
        results.push({ guild, member })
      }
    }

    return results
  }

  colorForAction(action) {
    switch (action) {
      case 'warn':
        return 0xffc107
      case 'timeout':
        return 0x02a9f7
      case 'kick':
        return 0xff7043
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

function resolveUserTag(user) {
  if (!user) {
    return null
  }
  if (typeof user.tag === 'string' && user.tag.length) {
    return user.tag
  }
  const username = user.username ?? null
  if (!username) {
    return null
  }
  const discriminator = user.discriminator && user.discriminator !== '0' ? `#${user.discriminator}` : ''
  return `${username}${discriminator}`
}

function defaultTemplateFor(action) {
  switch (action) {
    case 'warn':
      return 'You received a warning in {guild}. Reason: {reason}'
    case 'timeout':
      return 'You have been timed out in {guild}. Duration: {duration} minutes. Reason: {reason}'
    case 'kick':
      return 'You have been removed from {guild}. Reason: {reason}'
    case 'ban':
      return 'You have been banned from {guild}. Reason: {reason}'
    default:
      return null
  }
}
