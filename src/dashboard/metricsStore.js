import { watch } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

const metricsDirectory = path.resolve(process.cwd(), 'data', 'metrics')
const overviewFile = path.join(metricsDirectory, 'overview.json')
const overviewFilename = path.basename(overviewFile)

const TERMINAL_CASE_STATUSES = new Set(['closed', 'archived'])

const fallbackMetrics = createDefaultMetrics()
let cachedMetrics = null
let watcherReady = false
let watcher = null
let watcherPromise = null

export function invalidateMetricsCache() {
  cachedMetrics = null
}

export async function getHeadcountSeries({ guildId = null, period = '30d', date = new Date(), memberCount = null } = {}) {
  await ensureWatcher()
  const metrics = await loadMetrics()
  const series = cloneAndNormalizeSeries(
    metrics.guilds?.[guildId]?.headcount ?? metrics.headcount ?? fallbackMetrics.headcount,
    date,
    memberCount
  )

  const sorted = series.sort((a, b) => a.date.getTime() - b.date.getTime())
  const periodMonths = Math.max(1, Math.round(resolvePeriodDays(period) / 30))
  const window = sorted.slice(-periodMonths)
  const summary = buildHeadcountSummary(sorted)

  return {
    series: window.length ? window.map(serializePoint) : sorted.map(serializePoint),
    history: sorted.map(serializePoint),
    summary
  }
}

export async function getFlowSeries({ guildId = null, period = '30d', date = new Date() } = {}) {
  await ensureWatcher()
  const metrics = await loadMetrics()
  const series = cloneFlowSeries(metrics.guilds?.[guildId]?.flow ?? metrics.flow ?? fallbackMetrics.flow)

  const sorted = series.sort((a, b) => a.date.getTime() - b.date.getTime())
  const periodMonths = Math.max(1, Math.round(resolvePeriodDays(period) / 30))
  const currentWindow = sorted.slice(-periodMonths)
  const previousWindow = sorted.slice(-2 * periodMonths, -periodMonths)

  const current = sumFlowWindow(currentWindow)
  const previous = sumFlowWindow(previousWindow)
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
    series: currentWindow.length ? currentWindow.map(serializeFlowPoint) : sorted.map(serializeFlowPoint),
    history: sorted.map(serializeFlowPoint),
    summary: { current, previous, delta, net }
  }
}

export async function getEngagementSnapshot({ guildId = null, period = '30d' } = {}) {
  await ensureWatcher()
  const metrics = await loadMetrics()
  const pool = metrics.guilds?.[guildId]?.engagement ?? metrics.engagement ?? fallbackMetrics.engagement
  const data = pool?.[period] ?? pool?.['30d'] ?? fallbackMetrics.engagement['30d']

  const days = resolvePeriodDays(period)
  const totalMessages = Number(data?.totalMessages ?? 0)
  const previousTotalMessages = Number(data?.previousTotalMessages ?? 0)
  const messagesPerDay = days > 0 ? totalMessages / days : 0
  const previousMessagesPerDay = days > 0 ? previousTotalMessages / days : 0

  const channels = Array.isArray(data?.channels) ? data.channels.map((item) => ({ ...item })) : []

  return {
    period,
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

export async function getOverviewKpis({
  guildId = null,
  period = '30d',
  date = new Date(),
  memberCount = null,
  moderation = null,
  clientReady = false
} = {}) {
  const [headcount, flow, engagement] = await Promise.all([
    getHeadcountSeries({ guildId, period, date, memberCount }),
    getFlowSeries({ guildId, period, date }),
    getEngagementSnapshot({ guildId, period })
  ])

  const activeCurrent = memberCount ?? headcount.summary.current ?? 0
  const previousActive = headcount.summary.previous ?? (headcount.summary.current ?? activeCurrent) - headcount.summary.delta
  const activeDelta = previousActive !== null ? activeCurrent - previousActive : headcount.summary.delta

  const entriesCurrent = flow.summary.current.entries
  const entriesPrevious = flow.summary.previous.entries
  const exitsCurrent = flow.summary.current.exits
  const exitsPrevious = flow.summary.previous.exits

  const openCaseStats = await computeCaseSnapshot({ moderation, guildId, period, date })

  const engagementPerDay = Math.round(engagement.summary.messagesPerDay)
  const engagementPreviousPerDay = Math.round(engagement.summary.previousMessagesPerDay)
  const engagementDelta = engagementPerDay - engagementPreviousPerDay

  return {
    active: Math.max(0, Math.round(activeCurrent)),
    activeDelta: Math.round(activeDelta),
    entriesMonth: Math.max(0, Math.round(entriesCurrent)),
    entriesDelta: Math.round(entriesCurrent - entriesPrevious),
    exitsMonth: Math.max(0, Math.round(exitsCurrent)),
    exitsDelta: Math.round(exitsCurrent - exitsPrevious),
    openCases: openCaseStats.current,
    openCasesDelta: openCaseStats.delta,
    engagementPerDay,
    engagementDelta,
    botStatus: clientReady ? 'Online' : 'Offline',
    botStatusDelta: 0
  }
}

async function computeCaseSnapshot({ moderation, guildId, period, date }) {
  if (!moderation || !guildId) {
    return { current: 0, delta: 0 }
  }

  try {
    const limit = 400
    const cases = await moderation.listCasesForGuild(guildId, { status: 'all', category: 'all', limit })
    const periodDays = resolvePeriodDays(period)
    const windowEnd = endOfDay(date)
    const windowStart = subtractDays(windowEnd, periodDays - 1)
    const previousEnd = subtractDays(windowStart, 1)
    const previousStart = subtractDays(previousEnd, periodDays - 1)

    let current = 0
    let openedCurrent = 0
    let openedPrevious = 0

    for (const entry of cases) {
      if (!entry) {
        continue
      }
      if (!TERMINAL_CASE_STATUSES.has(normalizeStatus(entry.status))) {
        current += 1
      }

      const createdAt = parseDate(entry.createdAt)
      if (!createdAt) {
        continue
      }
      if (createdAt >= windowStart && createdAt <= windowEnd) {
        openedCurrent += 1
        continue
      }
      if (createdAt >= previousStart && createdAt <= previousEnd) {
        openedPrevious += 1
      }
    }

    return { current, delta: openedCurrent - openedPrevious }
  } catch (error) {
    console.warn('Failed to compute case snapshot for metrics:', error)
    return { current: 0, delta: 0 }
  }
}

async function loadMetrics() {
  if (!watcherReady) {
    await ensureWatcher()
  }

  if (cachedMetrics) {
    return cachedMetrics
  }

  try {
    const contents = await fs.readFile(overviewFile, 'utf8')
    const parsed = JSON.parse(contents)
    cachedMetrics = mergeMetrics(parsed)
    return cachedMetrics
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Failed to load metrics data, using defaults:', error)
    }
    cachedMetrics = { ...fallbackMetrics }
    return cachedMetrics
  }
}

async function ensureWatcher() {
  if (watcherReady) {
    return
  }

  if (watcherPromise) {
    await watcherPromise
    return
  }

  watcherPromise = (async () => {
    try {
      await fs.mkdir(metricsDirectory, { recursive: true })
    } catch (error) {
      console.warn('Failed to create metrics directory:', error)
      return
    }

    try {
      watcher = watch(metricsDirectory, { persistent: false }, (eventType, filename) => {
        const normalized = typeof filename === 'string' ? filename : filename?.toString()
        if (eventType === 'rename') {
          cachedMetrics = null
          return
        }
        if (!normalized) {
          return
        }
        if (normalized === overviewFilename) {
          cachedMetrics = null
        }
      })
      watcher.on('error', (error) => {
        console.warn('Metrics watcher error:', error)
        watcherReady = false
        watcher = null
      })
      watcherReady = true
    } catch (error) {
      console.warn('Failed to watch metrics directory:', error)
    }
  })()

  try {
    await watcherPromise
  } finally {
    watcherPromise = null
  }
}

function mergeMetrics(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ...fallbackMetrics }
  }
  return {
    headcount: Array.isArray(raw.headcount) ? raw.headcount : [...fallbackMetrics.headcount],
    flow: Array.isArray(raw.flow) ? raw.flow : [...fallbackMetrics.flow],
    engagement: raw.engagement && typeof raw.engagement === 'object' ? raw.engagement : { ...fallbackMetrics.engagement },
    guilds: raw.guilds && typeof raw.guilds === 'object' ? raw.guilds : {}
  }
}

function cloneAndNormalizeSeries(series = [], referenceDate = new Date(), memberCount = null) {
  const normalized = series
    .map((point) => normalizePoint(point))
    .filter(Boolean)
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  if (memberCount !== null && memberCount !== undefined) {
    const monthKey = formatMonthKey(startOfMonth(referenceDate))
    const existing = normalized.find((point) => formatMonthKey(point.date) === monthKey)
    if (existing) {
      existing.value = Number(memberCount)
    } else {
      normalized.push({
        date: startOfMonth(referenceDate),
        value: Number(memberCount),
        label: formatMonthLabel(referenceDate)
      })
    }
  }

  return normalized.map((point) => ({ ...point }))
}

function normalizePoint(point = {}) {
  const value = Number(point.value)
  const date = parseDate(point.date)
  if (!date || Number.isNaN(value)) {
    return null
  }
  return {
    date,
    value,
    label: typeof point.label === 'string' ? point.label : formatMonthLabel(date)
  }
}

function cloneFlowSeries(series = []) {
  return series
    .map((point) => normalizeFlowPoint(point))
    .filter(Boolean)
    .map((point) => ({ ...point }))
}

function normalizeFlowPoint(point = {}) {
  const date = parseDate(point.date)
  const entries = Number(point.entries)
  const exits = Number(point.exits)
  if (!date || Number.isNaN(entries) || Number.isNaN(exits)) {
    return null
  }
  return {
    date,
    entries,
    exits,
    label: typeof point.label === 'string' ? point.label : formatMonthLabel(date)
  }
}

function buildHeadcountSummary(series = []) {
  if (!series.length) {
    return { current: 0, previous: 0, delta: 0, percent: 0 }
  }
  const sorted = [...series].sort((a, b) => a.date.getTime() - b.date.getTime())
  const latest = sorted.at(-1)
  const previous = sorted.length > 1 ? sorted.at(-2) : null
  const currentValue = latest?.value ?? 0
  const previousValue = previous?.value ?? null
  const delta = previousValue !== null ? currentValue - previousValue : 0
  const percent = previousValue ? (delta / previousValue) * 100 : 0
  return {
    current: currentValue,
    previous: previousValue,
    delta,
    percent
  }
}

function sumFlowWindow(series = []) {
  return series.reduce(
    (accumulator, point) => {
      accumulator.entries += Number(point.entries) || 0
      accumulator.exits += Number(point.exits) || 0
      return accumulator
    },
    { entries: 0, exits: 0 }
  )
}

function serializePoint(point) {
  return {
    date: point.date.toISOString(),
    value: point.value,
    label: point.label
  }
}

function serializeFlowPoint(point) {
  return {
    date: point.date.toISOString(),
    entries: point.entries,
    exits: point.exits,
    label: point.label
  }
}

function resolvePeriodDays(period = '30d') {
  if (period === '7d') {
    return 7
  }
  if (period === '90d') {
    return 90
  }
  if (period === '365d') {
    return 365
  }
  const numeric = Number(String(period).replace(/[^\d]/g, ''))
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 30
}

function parseDate(value) {
  if (!value) {
    return null
  }
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  return parsed
}

function startOfMonth(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(1)
  return d
}

function endOfDay(date) {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

function subtractDays(date, amount) {
  const d = new Date(date)
  d.setDate(d.getDate() - amount)
  return d
}

function formatMonthLabel(date) {
  return new Intl.DateTimeFormat('en-US', { month: 'short' }).format(date)
}

function formatMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function normalizeStatus(status) {
  return typeof status === 'string' ? status.toLowerCase() : ''
}

function createDefaultMetrics() {
  const increments = [4, 5, 4, 3, 4, 3]
  const exitBase = [18, 19, 20, 21, 22, 24]
  const now = startOfMonth(new Date())
  const months = increments.length
  const start = new Date(now)
  start.setMonth(start.getMonth() - (months - 1))

  let value = 108
  const headcount = []
  const flow = []

  for (let index = 0; index < months; index += 1) {
    const date = new Date(start)
    date.setMonth(start.getMonth() + index)
    const label = formatMonthLabel(date)
    value += increments[index]

    headcount.push({
      date: date.toISOString(),
      value,
      label
    })

    const exits = exitBase[index]
    const entries = exits + increments[index]
    flow.push({
      date: date.toISOString(),
      entries,
      exits,
      label
    })
  }

  const engagement = {
    '7d': {
      totalMessages: 3390,
      previousTotalMessages: 3122,
      channels: [
        { channel: '#general', messages: 1240 },
        { channel: '#support', messages: 880 },
        { channel: '#team-lounge', messages: 540 },
        { channel: '#announcements', messages: 310 },
        { channel: '#moderation', messages: 420 }
      ]
    },
    '30d': {
      totalMessages: 14460,
      previousTotalMessages: 13320,
      channels: [
        { channel: '#general', messages: 5620 },
        { channel: '#support', messages: 3920 },
        { channel: '#team-lounge', messages: 2180 },
        { channel: '#announcements', messages: 1180 },
        { channel: '#moderation', messages: 1560 }
      ]
    },
    '90d': {
      totalMessages: 42120,
      previousTotalMessages: 39780,
      channels: [
        { channel: '#general', messages: 16360 },
        { channel: '#support', messages: 11400 },
        { channel: '#team-lounge', messages: 6360 },
        { channel: '#announcements', messages: 3460 },
        { channel: '#moderation', messages: 4540 }
      ]
    }
  }

  return { headcount, flow, engagement }
}

