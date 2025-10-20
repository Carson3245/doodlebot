import fs from 'node:fs/promises'
import path from 'node:path'

import { getAllPeople, getPeopleSummary } from '../../people/peopleStore.js'
import { listAllCases } from '../../moderation/caseStore.js'

const TERMINAL_CASE_STATUSES = new Set(['closed', 'archived', 'resolved'])
const ENGAGEMENT_FILE = path.resolve(process.cwd(), 'data', 'engagement.json')

export async function loadPeople({ guildId = null } = {}) {
  const people = await getAllPeople()
  if (!guildId) {
    return people
  }
  const normalized = String(guildId)
  return people.filter((person) => (person.guildId ? String(person.guildId) === normalized : false))
}

export async function loadCases({ guildId = null } = {}) {
  const options = { guildId: guildId ? String(guildId) : null, includeTimeline: true }
  return listAllCases(options)
}

export async function buildOverviewSummary({
  guildId = null,
  date = new Date(),
  people = null,
  cases = null
} = {}) {
  const evaluationDate = normalizeDate(date) ?? new Date()
  const monthStart = startOfMonth(evaluationDate)
  const monthEnd = endOfMonth(monthStart)

  const peopleList = people ?? (await loadPeople({ guildId }))
  const casesList = cases ?? (await loadCases({ guildId }))

  const activeMembers = countActiveMembers(peopleList, monthEnd)
  const activePrevious = countActiveMembers(peopleList, subtractMonths(monthEnd, 1))
  const entriesThisMonth = peopleList.filter((person) => isWithinMonth(person.joinedAt, monthStart)).length
  const exitsThisMonth = peopleList.filter((person) => isWithinMonth(findOffboardedAt(person), monthStart)).length

  const openCases = casesList.filter((entry) => !TERMINAL_CASE_STATUSES.has(normalizeStatus(entry.status))).length
  const openPrevious = countOpenCasesAt(casesList, subtractMonths(monthEnd, 1))

  const engagementSnapshot = await buildEngagementSnapshot({ guildId, range: 'last_30_days' })
  const engagementPerDay = Math.round(engagementSnapshot.avg_per_day ?? 0)
  const engagementPrevious = Math.round(
    engagementSnapshot.summary?.previousMessagesPerDay ?? engagementSnapshot.avg_per_day ?? 0
  )

  return {
    active_members: activeMembers,
    entries_this_month: entriesThisMonth,
    exits_this_month: exitsThisMonth,
    open_cases: openCases,
    engagement_per_day: engagementPerDay,
    bot_status: 'online',
    trend: {
      active_members_vs_prev: computeChangeRatio(activeMembers, activePrevious),
      entries_vs_prev: computeChangeRatio(entriesThisMonth, 0),
      exits_vs_prev: computeChangeRatio(exitsThisMonth, 0),
      open_cases_vs_prev: computeChangeRatio(openCases, openPrevious),
      engagement_vs_prev: computeChangeRatio(engagementPerDay, engagementPrevious)
    },
    previous: {
      active_members: activePrevious,
      entries_this_month: 0,
      exits_this_month: 0,
      open_cases: openPrevious,
      engagement_per_day: engagementPrevious
    },
    metadata: {
      generated_at: new Date().toISOString()
    }
  }
}

export async function buildHeadcountSeries({
  guildId = null,
  months = 6,
  date = new Date(),
  people = null
} = {}) {
  const focusDate = normalizeDate(date) ?? new Date()
  const buckets = generateMonthBuckets(focusDate, months)
  const peopleList = people ?? (await loadPeople({ guildId }))

  const series = buckets.map((bucket) => {
    const value = countActiveMembers(peopleList, bucket.end)
    return {
      date: bucket.start.toISOString(),
      label: bucket.label,
      month: bucket.monthKey,
      members: value,
      value
    }
  })

  const history = series
  const current = series.length ? series[series.length - 1].value : 0
  const previous = series.length > 1 ? series[series.length - 2].value : 0
  const delta = current - previous

  return {
    series,
    history,
    summary: {
      current,
      previous,
      delta,
      percent: computeChangeRatioPercent(current, previous)
    }
  }
}

export async function buildFlowSeries({
  guildId = null,
  months = 6,
  date = new Date(),
  people = null
} = {}) {
  const focusDate = normalizeDate(date) ?? new Date()
  const buckets = generateMonthBuckets(focusDate, months)
  const peopleList = people ?? (await loadPeople({ guildId }))

  const series = buckets.map((bucket) => {
    const entries = peopleList.filter((person) => isWithinRange(person.joinedAt, bucket.start, bucket.end)).length
    const exits = peopleList.filter((person) => isWithinRange(findOffboardedAt(person), bucket.start, bucket.end)).length
    return {
      date: bucket.start.toISOString(),
      label: bucket.label,
      month: bucket.monthKey,
      entries,
      exits,
      net: entries - exits
    }
  })

  const current = sumFlowWindow(series.slice(-1))
  const previous = sumFlowWindow(series.slice(-2, -1))
  const delta = {
    entries: current.entries - previous.entries,
    exits: current.exits - previous.exits
  }
  const net = {
    current: current.entries - current.exits,
    previous: previous.entries - previous.exits,
    delta: current.entries - current.exits - (previous.entries - previous.exits)
  }

  return {
    series,
    history: series,
    summary: { current, previous, delta, net }
  }
}

export async function buildEngagementSnapshot({ guildId = null, range = 'last_30_days' } = {}) {
  const dataset = await readEngagementDataset()
  const normalizedRange = range || 'last_30_days'
  const normalizedGuild = guildId ? String(guildId) : null

  const entry =
    dataset.find(
      (item) =>
        (!normalizedGuild || String(item.guildId ?? '') === normalizedGuild) &&
        (item.range ?? 'last_30_days') === normalizedRange
    ) ??
    dataset.find((item) => (!normalizedGuild || !item.guildId) && (item.range ?? 'last_30_days') === normalizedRange) ??
    null

  if (!entry) {
    return {
      period: normalizedRange,
      avg_per_day: 0,
      delta_vs_prev: 0,
      channels: [],
      summary: {
        totalMessages: 0,
        previousTotalMessages: 0,
        messagesPerDay: 0,
        previousMessagesPerDay: 0,
        deltaPerDay: 0
      }
    }
  }

  const totalMessages = Number(entry.totalMessages ?? 0)
  const previousTotalMessages = Number(entry.previousTotalMessages ?? 0)
  const days = Number(entry.days ?? (normalizedRange === 'last_7_days' ? 7 : 30))
  const messagesPerDay = days > 0 ? totalMessages / days : 0
  const previousMessagesPerDay = days > 0 ? previousTotalMessages / days : 0

  const channels = Array.isArray(entry.channels)
    ? entry.channels.map((channel) => ({
        name: channel.name ?? channel.channel ?? '#general',
        count: Number(channel.count ?? channel.messages ?? 0),
        messages: Number(channel.messages ?? channel.count ?? 0)
      }))
    : []

  return {
    period: normalizedRange,
    avg_per_day: Math.round(messagesPerDay),
    delta_vs_prev: computeChangeRatio(messagesPerDay, previousMessagesPerDay),
    channels,
    summary: {
      totalMessages,
      previousTotalMessages,
      messagesPerDay,
      previousMessagesPerDay,
      deltaPerDay: messagesPerDay - previousMessagesPerDay
    }
  }
}

export async function buildAlerts({
  guildId = null,
  date = new Date(),
  people = null,
  cases = null
} = {}) {
  const peopleList = people ?? (await loadPeople({ guildId }))
  const casesList = cases ?? (await loadCases({ guildId }))
  const summary = await buildOverviewSummary({ guildId, date, people: peopleList, cases: casesList })
  const flow = await buildFlowSeries({ guildId, months: 2, date, people: peopleList })

  const alerts = []

  if (flow.series.length >= 2) {
    const current = flow.series[flow.series.length - 1]
    const previous = flow.series[flow.series.length - 2]
    const exitsCurrent = current.exits
    const exitsPrevious = previous.exits || 0
    const activeMembers = summary.active_members || 0
    const minimum = Math.max(5, Math.round(activeMembers * 0.05))

    if (exitsPrevious > 0 && exitsCurrent >= exitsPrevious * 2 && exitsCurrent >= minimum) {
      alerts.push({
        id: 'turnover_spike',
        severity: 'high',
        title: 'Turnover spike',
        body: 'Exits are 2x higher than last month. Review exit interviews.',
        cta: { label: 'Open report', href: '/cases?category=offboarding' },
        metrics: {
          exits_current: exitsCurrent,
          exits_previous: exitsPrevious,
          active_members: activeMembers
        }
      })
    }
  }

  const automodLoad = computeAutomodLoadFromCases(casesList, date)
  if (automodLoad && automodLoad.threshold > 0 && automodLoad.current >= automodLoad.threshold) {
    alerts.push({
      id: 'moderation_load',
      severity: 'medium',
      title: 'Moderation load',
      body: 'Automod activity is above the usual range. Review recent actions.',
      cta: { label: 'Open automod', href: '/moderation?tab=automod' },
      metrics: automodLoad
    })
  }

  return alerts
}

export async function buildPeopleCounters() {
  const summary = await getPeopleSummary()
  return {
    total: summary.total ?? 0,
    active: summary.active ?? 0,
    onboarding: summary.onboarding ?? 0,
    offboarded: summary.offboarded ?? 0
  }
}

async function readEngagementDataset() {
  try {
    const raw = await fs.readFile(ENGAGEMENT_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Failed to read engagement dataset:', error)
    }
    return []
  }
}

function generateMonthBuckets(date, months = 6) {
  const buckets = []
  const anchor = startOfMonth(date)
  for (let index = months - 1; index >= 0; index -= 1) {
    const monthStart = subtractMonths(anchor, index)
    const monthEnd = endOfMonth(monthStart)
    buckets.push({
      start: monthStart,
      end: monthEnd,
      label: monthStart.toLocaleString('en-US', { month: 'short' }),
      monthKey: formatMonthKey(monthStart)
    })
  }
  return buckets
}

function countActiveMembers(people, referenceDate) {
  return people.filter((person) => {
    const joinedAt = parseDate(person.joinedAt) ?? parseDate(person.createdAt)
    if (!joinedAt || joinedAt > referenceDate) {
      return false
    }
    const offboardedAt = findOffboardedAt(person)
    if (offboardedAt && offboardedAt <= referenceDate) {
      return false
    }
    if (normalizeStatus(person.status) === 'offboarded' && !offboardedAt) {
      return false
    }
    return true
  }).length
}

function countOpenCasesAt(cases, referenceDate) {
  return cases.filter((entry) => {
    const status = normalizeStatus(entry.status)
    if (TERMINAL_CASE_STATUSES.has(status)) {
      return false
    }
    const closedAt = parseDate(entry.closedAt ?? entry.closed_at ?? null)
    if (closedAt && closedAt <= referenceDate) {
      return false
    }
    const createdAt = parseDate(entry.createdAt)
    return createdAt ? createdAt <= referenceDate : true
  }).length
}

function computeAutomodLoadFromCases(cases, date = new Date()) {
  const now = normalizeDate(date) ?? new Date()
  const cutoff = now.getTime() - 24 * 60 * 60 * 1000
  const historyCutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000
  const dailyBuckets = new Map()
  let currentTotal = 0

  for (const entry of cases) {
    if (!entry?.actions) {
      continue
    }
    for (const action of entry.actions) {
      if (String(action?.source ?? '').toLowerCase() !== 'automod') {
        continue
      }
      const createdAt = parseDate(action.createdAt)
      if (!createdAt) {
        continue
      }
      const timestamp = createdAt.getTime()
      if (timestamp >= cutoff) {
        currentTotal += 1
      }
      if (timestamp >= historyCutoff) {
        const key = createdAt.toISOString().slice(0, 10)
        dailyBuckets.set(key, (dailyBuckets.get(key) ?? 0) + 1)
      }
    }
  }

  const history = Array.from(dailyBuckets.values()).sort((a, b) => a - b)
  const threshold = history.length ? calculatePercentile(history, 0.9) : 0
  return {
    current: currentTotal,
    threshold,
    history_days: history.length
  }
}

function sumFlowWindow(series) {
  return series.reduce(
    (accumulator, entry) => {
      return {
        entries: accumulator.entries + (entry.entries ?? 0),
        exits: accumulator.exits + (entry.exits ?? 0)
      }
    },
    { entries: 0, exits: 0 }
  )
}

function formatMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function startOfMonth(date) {
  const d = new Date(date)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfMonth(date) {
  const d = startOfMonth(date)
  d.setMonth(d.getMonth() + 1)
  d.setMilliseconds(-1)
  return d
}

function subtractMonths(date, amount) {
  const d = new Date(date)
  d.setMonth(d.getMonth() - amount)
  return startOfMonth(d)
}

function isWithinMonth(value, monthStart) {
  const date = parseDate(value)
  if (!date) {
    return false
  }
  const start = startOfMonth(monthStart)
  const end = endOfMonth(start)
  return date >= start && date <= end
}

function isWithinRange(value, start, end) {
  const date = parseDate(value)
  if (!date) {
    return false
  }
  return date >= start && date <= end
}

function findOffboardedAt(person) {
  return parseDate(person.offboardedAt ?? person.offboarded_at ?? null)
}

function parseDate(value) {
  if (!value) {
    return null
  }
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function normalizeStatus(status) {
  return typeof status === 'string' ? status.toLowerCase() : ''
}

function normalizeDate(value) {
  if (!value) {
    return null
  }
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function computeChangeRatio(current, previous) {
  const currentNumber = Number(current)
  const previousNumber = Number(previous)
  if (!Number.isFinite(currentNumber)) {
    return 0
  }
  if (!Number.isFinite(previousNumber) || previousNumber === 0) {
    return currentNumber > 0 ? 1 : 0
  }
  const delta = currentNumber - previousNumber
  return Number.isFinite(delta / previousNumber) ? +(delta / previousNumber).toFixed(4) : 0
}

function computeChangeRatioPercent(current, previous) {
  const ratio = computeChangeRatio(current, previous)
  return Number.isFinite(ratio) ? +(ratio * 100).toFixed(2) : 0
}

function calculatePercentile(values, percentile) {
  if (!Array.isArray(values) || !values.length) {
    return 0
  }
  const sorted = values.slice().sort((a, b) => a - b)
  const index = (sorted.length - 1) * percentile
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) {
    return sorted[lower]
  }
  const weight = index - lower
  return sorted[lower] * (1 - weight) + sorted[upper] * weight
}
