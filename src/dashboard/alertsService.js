import { loadAlertRules } from '../ops/alertRulesStore.js'
import { createAlert, findOpenAlert, listAlerts, updateAlert, resolveAlert as markResolved } from '../ops/alertsStore.js'
import { listMembers } from '../ops/membersStore.js'
import { listMessageCounts } from '../ops/messagesStore.js'
import { listVoiceSessions } from '../ops/voiceSessionsStore.js'
import { listModerationActions } from '../moderation/moderationActionsStore.js'
import { listVerifications } from '../ops/verificationStore.js'
import { buildOverviewSnapshot } from './overviewService.js'

const EVALUATION_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

let intervalHandle = null

export function startAlertsEngine(client) {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
  const evaluateAllGuilds = async () => {
    try {
      const guilds = client.guilds.cache.map((guild) => guild.id)
      for (const guildId of guilds) {
        await evaluateAlertsForGuild(guildId)
      }
    } catch (error) {
      console.error('Failed to evaluate alerts for guilds:', error)
    }
  }
  evaluateAllGuilds().catch((error) => {
    console.error('Initial alert evaluation failed:', error)
  })
  intervalHandle = setInterval(evaluateAllGuilds, EVALUATION_INTERVAL_MS)
}

export async function listActiveAlerts(guildId) {
  return listAlerts({ guildId, state: 'open' })
}

export async function evaluateAlertsForGuild(guildId) {
  if (!guildId) {
    return []
  }
  const rules = await loadAlertRules()
  if (!rules.length) {
    return []
  }

  const evaluationContext = await buildEvaluationContext(guildId)
  const triggeredAlerts = []

  for (const rule of rules) {
    const result = evaluateRule(rule, evaluationContext)
    if (!result.triggered) {
      continue
    }

    const existing = await findOpenAlert({ guildId, ruleKey: rule.key })
    const payload = {
      guildId,
      ruleKey: rule.key,
      title: rule.title ?? rule.description ?? 'Alert',
      body: result.message ?? rule.description ?? 'Alert triggered.',
      severity: rule.severity ?? 'info',
      actions: Array.isArray(rule.actions) ? rule.actions : [],
      meta: result.meta ?? {}
    }

    if (existing) {
      await updateAlert(existing.id, {
        title: payload.title,
        body: payload.body,
        severity: payload.severity,
        actions: payload.actions,
        meta: payload.meta,
        state: 'open'
      })
      triggeredAlerts.push(existing)
    } else {
      const created = await createAlert(payload)
      triggeredAlerts.push(created)
    }
  }

  return triggeredAlerts
}

async function buildEvaluationContext(guildId) {
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  const [members, messages, voiceSessions, moderationActions, pendingVerifications, overview] = await Promise.all([
    listMembers({ guildId, includeBots: false }),
    listMessageCounts({ guildId, from: thirtyDaysAgo.toISOString(), to: now.toISOString() }),
    listVoiceSessions({ guildId, from: thirtyDaysAgo.toISOString(), to: now.toISOString(), includeOpen: false }),
    listModerationActions({ guildId }),
    listVerifications({ guildId, state: 'pending' }),
    buildOverviewSnapshot({ guildId })
  ])

  const actionsLast24h = moderationActions.filter((action) => {
    if (!action.createdAt) {
      return false
    }
    const created = new Date(action.createdAt).getTime()
    return created >= oneDayAgo.getTime()
  })

  const messageStats = computeMessageStats(messages, now)
  const voiceStats = computeVoiceStats(voiceSessions, now)
  const memberStats = computeMemberStats(members, now)

  return {
    now,
    guildId,
    members,
    overview,
    messageStats,
    voiceStats,
    memberStats,
    actionsLast24h,
    pendingVerifications: pendingVerifications.length
  }
}

function computeMemberStats(members, referenceDate) {
  const activeMembers = countActiveMembers(members, referenceDate)
  const currentMonth = monthBounds(referenceDate)
  const previousMonth = monthBounds(offsetMonth(referenceDate, -1))
  const leavesCurrent = members.filter((member) => isWithin(member.leftAt, currentMonth.start, currentMonth.end)).length
  const leavesPrevious = members.filter((member) =>
    isWithin(member.leftAt, previousMonth.start, previousMonth.end)
  ).length
  return {
    activeMembers,
    leavesCurrent,
    leavesPrevious
  }
}

function computeMessageStats(entries, referenceDate) {
  const todayKey = toDateKey(referenceDate)
  const totalsByChannel = new Map()
  const historyByChannel = new Map()
  for (const entry of entries) {
    const channelId = entry.channelId
    if (!channelId) {
      continue
    }
    const sum = totalsByChannel.get(channelId) ?? 0
    totalsByChannel.set(channelId, sum + entry.count)
    const map = historyByChannel.get(channelId) ?? new Map()
    map.set(entry.date, entry.count)
    historyByChannel.set(channelId, map)
  }

  const averages = new Map()
  const todaysCounts = new Map()
  const lastSeenByChannel = new Map()
  for (const [channelId, map] of historyByChannel.entries()) {
    let total = 0
    let count = 0
    let latest = null
    for (const [dateKey, value] of map.entries()) {
      total += value
      count += 1
      const timestamp = new Date(dateKey).getTime()
      if (Number.isFinite(timestamp) && (!latest || timestamp > latest)) {
        latest = timestamp
      }
    }
    averages.set(channelId, count > 0 ? total / count : 0)
    todaysCounts.set(channelId, map.get(todayKey) ?? 0)
    if (latest) {
      lastSeenByChannel.set(channelId, latest)
    }
  }

  return {
    todaysCounts,
    averages,
    lastSeenByChannel
  }
}

function computeVoiceStats(sessions, referenceDate) {
  const todayStart = clampToUtcStart(referenceDate)
  const todayEnd = clampToUtcEnd(referenceDate)
  const totalByChannel = new Map()
  const todaySecondsByChannel = new Map()
  for (const session of sessions) {
    const channelId = session.channelId
    if (!channelId) {
      continue
    }
    const duration = Number(session.durationSec) || 0
    const total = totalByChannel.get(channelId) ?? 0
    totalByChannel.set(channelId, total + duration)

    if (session.startedAt) {
      const started = new Date(session.startedAt)
      if (started >= todayStart && started <= todayEnd) {
        const todayTotal = todaySecondsByChannel.get(channelId) ?? 0
        todaySecondsByChannel.set(channelId, todayTotal + duration)
      }
    }
  }

  const averages = new Map()
  for (const [channelId, total] of totalByChannel.entries()) {
    averages.set(channelId, total / Math.max(1, sessions.length))
  }

  return {
    averages,
    todaysSeconds: todaySecondsByChannel
  }
}

function evaluateRule(rule, context) {
  switch (rule.key) {
    case 'leave_spike':
      return evaluateLeaveSpikeRule(rule, context)
    case 'moderation_load':
      return evaluateModerationLoadRule(rule, context)
    case 'unverified_backlog':
      return evaluateVerificationBacklogRule(rule, context)
    case 'message_surge':
      return evaluateMessageSurgeRule(rule, context)
    case 'voice_spike':
      return evaluateVoiceSpikeRule(rule, context)
    case 'channel_silence':
      return evaluateChannelSilenceRule(rule, context)
    default:
      return { triggered: false }
  }
}

function evaluateLeaveSpikeRule(rule, context) {
  const threshold = rule.threshold ?? {}
  const multiplier = Number(threshold.multiplier ?? 2)
  const minimumAbsolute = Number(threshold.minimum ?? 5)
  const minimumPercent = Number(threshold.percent ?? 0.05)
  const { leavesCurrent, leavesPrevious, activeMembers } = context.memberStats
  const minimumRelative = Math.round(activeMembers * minimumPercent)
  const minimum = Math.max(minimumAbsolute, minimumRelative)

  const triggered =
    leavesCurrent >= multiplier * Math.max(1, leavesPrevious) && leavesCurrent >= minimum && leavesCurrent > 0

  return {
    triggered,
    meta: {
      leavesCurrent,
      leavesPrevious,
      activeMembers,
      multiplier,
      minimum
    },
    message: triggered
      ? `Leaves this month (${leavesCurrent}) are above threshold (previous ${leavesPrevious}).`
      : undefined
  }
}

function evaluateModerationLoadRule(rule, context) {
  const threshold = Number(rule.params?.threshold ?? 15)
  const actions = context.actionsLast24h.length
  const triggered = actions >= threshold
  return {
    triggered,
    meta: {
      actionsLast24h: actions,
      threshold
    },
    message: triggered ? `Automated moderation executed ${actions} times in the last 24h.` : undefined
  }
}

function evaluateVerificationBacklogRule(rule, context) {
  const threshold = Number(rule.params?.threshold ?? 5)
  const pending = context.pendingVerifications ?? 0
  const triggered = pending >= threshold
  return {
    triggered,
    meta: {
      pending,
      threshold
    },
    message: triggered
      ? `${pending} members are waiting for verification.`
      : undefined
  }
}

function evaluateMessageSurgeRule(rule, context) {
  const multiplier = Number(rule.params?.multiplier ?? 2)
  const results = []
  for (const [channelId, todayCount] of context.messageStats.todaysCounts.entries()) {
    const average = context.messageStats.averages.get(channelId) ?? 0
    if (todayCount >= multiplier * Math.max(1, average) && todayCount >= 20) {
      results.push({ channelId, todayCount, average })
    }
  }
  if (!results.length) {
    return { triggered: false }
  }
  const top = results.sort((a, b) => b.todayCount - a.todayCount)[0]
  return {
    triggered: true,
    meta: {
      channelId: top.channelId,
      todayCount: top.todayCount,
      average: top.average,
      multiplier
    },
    message: `Channel ${top.channelId} saw ${top.todayCount} messages today (avg ${Math.round(top.average)}).`
  }
}

function evaluateVoiceSpikeRule(rule, context) {
  const multiplier = Number(rule.params?.multiplier ?? 2)
  const results = []
  for (const [channelId, seconds] of context.voiceStats.todaysSeconds.entries()) {
    const averageSeconds = context.voiceStats.averages.get(channelId) ?? 0
    if (seconds >= multiplier * Math.max(1, averageSeconds) && seconds >= 30 * 60) {
      results.push({ channelId, seconds, averageSeconds })
    }
  }
  if (!results.length) {
    return { triggered: false }
  }
  const top = results.sort((a, b) => b.seconds - a.seconds)[0]
  return {
    triggered: true,
    meta: {
      channelId: top.channelId,
      seconds: top.seconds,
      averageSeconds: top.averageSeconds,
      multiplier
    },
    message: `Voice channel ${top.channelId} logged ${Math.round(top.seconds / 60)} minutes today (avg ${Math.round(
      top.averageSeconds / 60
    )}).`
  }
}

function evaluateChannelSilenceRule(rule, context) {
  const channelIds = Array.isArray(rule.params?.channelIds) ? rule.params.channelIds : []
  const thresholdDays = Number(rule.params?.days ?? 3)
  if (!channelIds.length) {
    return { triggered: false }
  }
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000
  const now = context.now.getTime()
  for (const channelIdRaw of channelIds) {
    const channelId = String(channelIdRaw)
    let lastSeen = null
    const historyMap = context.messageStats.todaysCounts // we only tracked todays counts, need more info
    for (const entry of context.overview.engagementByChannel ?? []) {
      // placeholder: we only know aggregated counts
      if (entry.channelId === channelId && entry.lastMessageAt) {
        lastSeen = new Date(entry.lastMessageAt).getTime()
        break
      }
    }
    if (!lastSeen) {
      continue
    }
    if (now - lastSeen >= thresholdMs) {
      return {
        triggered: true,
        meta: {
          channelId,
          lastSeen,
          thresholdDays
        },
        message: `Channel ${channelId} is quiet for ${Math.round((now - lastSeen) / (24 * 60 * 60 * 1000))} days.`
      }
    }
  }
  return { triggered: false }
}

export async function listGuildAlerts({ guildId = null, state = null } = {}) {
  return listAlerts({ guildId, state })
}

export async function resolveAlertById(alertId) {
  return markResolved(alertId)
}function offsetMonth(date, delta) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1, 0, 0, 0, 0))
}

function monthBounds(date) {
  const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0))
  const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999))
  return { start: monthStart, end: monthEnd }
}

function toDateKey(date) {
  const d = new Date(date)
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function clampToUtcStart(date) {
  const d = new Date(date)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0))
}

function clampToUtcEnd(date) {
  const d = new Date(date)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999))
}

function countActiveMembers(members, reference) {
  const referenceTime = new Date(reference).getTime()
  return members.filter((member) => {
    const joinedAt = member.joinedAt ? new Date(member.joinedAt).getTime() : null
    const leftAt = member.leftAt ? new Date(member.leftAt).getTime() : null
    if (joinedAt && joinedAt > referenceTime) {
      return false
    }
    if (leftAt && leftAt <= referenceTime) {
      return false
    }
    return true
  }).length
}

function isWithin(value, start, end) {
  if (!value) {
    return false
  }
  const timestamp = new Date(value).getTime()
  return timestamp >= start.getTime() && timestamp <= end.getTime()
}

