import { listMembers } from '../ops/membersStore.js'
import { listChannels } from '../ops/channelsStore.js'
import { listMessageCounts } from '../ops/messagesStore.js'
import { listVoiceSessions } from '../ops/voiceSessionsStore.js'
import { listAllCases } from '../moderation/caseStore.js'

const DEFAULT_TOP_CHANNELS = 5

export async function buildOverviewSnapshot({
  guildId = null,
  from = null,
  to = null
} = {}) {
  const { rangeStart, rangeEnd, days } = normalizeRange({ from, to })

  const [members, channels, messageCounts, voiceSessions, cases] = await Promise.all([
    listMembers({ guildId, includeBots: false }),
    listChannels({ guildId }),
    listMessageCounts({ guildId, from: rangeStart, to: rangeEnd }),
    listVoiceSessions({ guildId, from: rangeStart, to: rangeEnd, includeOpen: false }),
    listAllCases({ guildId, includeTimeline: false })
  ])

  const channelIndex = buildChannelIndex(channels)

  const activeMembers = countActiveMembers(members, rangeEnd)
  const joinsThisMonth = countJoinsInMonth(members, rangeEnd)
  const leavesThisMonth = countLeavesInMonth(members, rangeEnd)
  const openCases = countOpenCases(cases)

  const totalMessages = messageCounts.reduce((sum, entry) => sum + entry.count, 0)
  const messagesPerDay = days > 0 ? Math.round(totalMessages / days) : 0

  const totalVoiceSeconds = voiceSessions.reduce((sum, session) => sum + session.durationSec, 0)
  const voiceMinutesPerDay = days > 0 ? Math.round(totalVoiceSeconds / 60 / days) : 0

  const monthSeries = buildMonthSeries(members, rangeEnd, 6)
  const flowSeries = buildFlowSeries(members, 6, rangeEnd)

  const messagesByChannel = aggregateMessagesByChannel(messageCounts)
  const voiceByChannelRaw = aggregateVoiceByChannel(voiceSessions)

  const engagementByChannel = pickTopChannels(messagesByChannel, channelIndex, DEFAULT_TOP_CHANNELS).map(
    (entry) => ({
      channelId: entry.channelId,
      name: entry.name,
      messages: entry.count
    })
  )

  const voiceByChannel = pickTopChannels(voiceByChannelRaw, channelIndex, DEFAULT_TOP_CHANNELS).map((entry) => ({
    channelId: entry.channelId,
    name: entry.name,
    minutes: Math.round(entry.count / 60)
  }))

  return {
    activeMembers,
    joinsThisMonth,
    leavesThisMonth,
    openCases,
    messagesPerDay,
    voiceMinutesPerDay,
    monthEndMembers: monthSeries.map((bucket) => ({
      month: bucket.monthKey,
      members: bucket.members
    })),
    joinsVsLeaves: flowSeries.map((bucket) => ({
      month: bucket.monthKey,
      joins: bucket.joins,
      leaves: bucket.leaves,
      net: bucket.net
    })),
    engagementByChannel,
    voiceByChannel,
    alerts: []
  }
}

function normalizeRange({ from, to }) {
  const end = to ? safeDate(to) ?? new Date() : new Date()
  const start = from ? safeDate(from) : null
  const rangeStart = start ?? new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000)
  const startDay = clampToUtcStart(rangeStart)
  const endDay = clampToUtcEnd(end)
  const days = Math.max(1, Math.round((endDay.getTime() - startDay.getTime()) / (24 * 60 * 60 * 1000)) + 1)
  return { rangeStart: startDay.toISOString(), rangeEnd: endDay.toISOString(), days }
}

function safeDate(value) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function clampToUtcStart(date) {
  const d = new Date(date)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0))
}

function clampToUtcEnd(date) {
  const d = new Date(date)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999))
}

function buildChannelIndex(channels) {
  const index = new Map()
  for (const channel of channels) {
    index.set(channel.id, channel.name ?? `#${channel.id}`)
  }
  return index
}

function countActiveMembers(members, referenceIso) {
  const reference = new Date(referenceIso).getTime()
  return members.filter((member) => {
    const joinedAt = member.joinedAt ? new Date(member.joinedAt).getTime() : null
    const leftAt = member.leftAt ? new Date(member.leftAt).getTime() : null
    if (joinedAt && joinedAt > reference) {
      return false
    }
    if (leftAt && leftAt <= reference) {
      return false
    }
    return true
  }).length
}

function countJoinsInMonth(members, referenceIso) {
  const { monthStart, monthEnd } = monthBounds(referenceIso)
  return members.filter((member) => {
    if (!member.joinedAt) {
      return false
    }
    const joined = new Date(member.joinedAt).getTime()
    return joined >= monthStart && joined <= monthEnd
  }).length
}

function countLeavesInMonth(members, referenceIso) {
  const { monthStart, monthEnd } = monthBounds(referenceIso)
  return members.filter((member) => {
    if (!member.leftAt) {
      return false
    }
    const left = new Date(member.leftAt).getTime()
    return left >= monthStart && left <= monthEnd
  }).length
}

function countOpenCases(cases) {
  return cases.filter((entry) => {
    const status = String(entry.status ?? '').toLowerCase()
    return !['closed', 'resolved', 'archived'].includes(status)
  }).length
}

function monthBounds(referenceIso) {
  const refDate = new Date(referenceIso)
  const start = Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth(), 1, 0, 0, 0, 0)
  const end = Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth() + 1, 0, 23, 59, 59, 999)
  return { monthStart: start, monthEnd: end }
}

function buildMonthSeries(members, referenceIso, monthsBack = 6) {
  const buckets = []
  const reference = new Date(referenceIso)
  for (let offset = monthsBack - 1; offset >= 0; offset -= 1) {
    const year = reference.getUTCFullYear()
    const month = reference.getUTCMonth() - offset
    const bucketDate = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999))
    buckets.push({
      monthKey: buildMonthKey(bucketDate),
      end: bucketDate,
      members: countActiveMembers(members, bucketDate.toISOString())
    })
  }
  return buckets
}

function buildFlowSeries(members, monthsBack = 6, referenceIso = new Date()) {
  const buckets = []
  const reference = new Date(referenceIso)
  for (let offset = monthsBack - 1; offset >= 0; offset -= 1) {
    const year = reference.getUTCFullYear()
    const month = reference.getUTCMonth() - offset
    const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0))
    const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999))
    const joins = members.filter((member) => isWithin(member.joinedAt, start, end)).length
    const leaves = members.filter((member) => isWithin(member.leftAt, start, end)).length
    buckets.push({
      monthKey: buildMonthKey(end),
      joins,
      leaves,
      net: joins - leaves
    })
  }
  return buckets
}

function buildMonthKey(date) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function isWithin(value, start, end) {
  if (!value) {
    return false
  }
  const ts = new Date(value).getTime()
  return ts >= start.getTime() && ts <= end.getTime()
}

function aggregateMessagesByChannel(entries) {
  const grouped = new Map()
  for (const entry of entries) {
    const current = grouped.get(entry.channelId) ?? 0
    grouped.set(entry.channelId, current + entry.count)
  }
  return Array.from(grouped.entries()).map(([channelId, count]) => ({
    channelId,
    count
  }))
}

function aggregateVoiceByChannel(sessions) {
  const grouped = new Map()
  for (const session of sessions) {
    const current = grouped.get(session.channelId) ?? 0
    grouped.set(session.channelId, current + session.durationSec)
  }
  return Array.from(grouped.entries()).map(([channelId, count]) => ({
    channelId,
    count
  }))
}

function pickTopChannels(entries, channelIndex, limit) {
  return entries
    .map((entry) => ({
      channelId: entry.channelId,
      name: channelIndex.get(entry.channelId) ?? `#${entry.channelId}`,
      count: entry.count
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}
