
import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useGuild } from '../guildContext.js'

const PERIOD_LABELS = {
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  '90d': 'last 90 days'
}

const KPI_UNITS = {
  active: { singular: 'member', plural: 'members' },
  entries: { singular: 'entry', plural: 'entries' },
  exits: { singular: 'exit', plural: 'exits' },
  openCases: { singular: 'case', plural: 'cases' },
  engagement: { singular: 'message', plural: 'messages' }
}

const FALLBACK_KPIS = {
  active: 128,
  activeDelta: 5,
  entriesMonth: 6,
  entriesDelta: 2,
  exitsMonth: 3,
  exitsDelta: -1,
  openCases: 14,
  openCasesDelta: 4,
  engagementPerDay: 482,
  engagementDelta: 38,
  botStatus: 'Online',
  botStatusDelta: 0
}

const FALLBACK_HEADCOUNT = [
  { month: 'Apr', value: 112 },
  { month: 'May', value: 118 },
  { month: 'Jun', value: 124 },
  { month: 'Jul', value: 126 },
  { month: 'Aug', value: 129 },
  { month: 'Sep', value: 131 }
]

const FALLBACK_FLOW = [
  { month: 'Apr', entries: 4, exits: 2 },
  { month: 'May', entries: 6, exits: 3 },
  { month: 'Jun', entries: 5, exits: 2 },
  { month: 'Jul', entries: 7, exits: 4 },
  { month: 'Aug', entries: 6, exits: 3 },
  { month: 'Sep', entries: 8, exits: 2 }
]

const FALLBACK_ENGAGEMENT = [
  { channel: '#general', messages: 182 },
  { channel: '#announcements', messages: 64 },
  { channel: '#support', messages: 148 },
  { channel: '#team-lounge', messages: 88 },
  { channel: '#moderation', messages: 42 }
]

export default function OverviewPage() {
  const { period = '30d' } = useOutletContext() ?? {}
  const periodLabel = PERIOD_LABELS[period] ?? 'the previous period'
  const { selectedGuild } = useGuild()

  const [kpis, setKpis] = useState({ loading: true, data: FALLBACK_KPIS, error: null })
  const [headcount, setHeadcount] = useState({ loading: true, data: FALLBACK_HEADCOUNT, error: null })
  const [flow, setFlow] = useState({ loading: true, data: FALLBACK_FLOW, error: null })
  const [engagement, setEngagement] = useState({ loading: true, data: FALLBACK_ENGAGEMENT, error: null })

  const guildId = selectedGuild?.id ?? null

  useEffect(() => {
    let cancelled = false

    const fetchKpis = async () => {
      try {
        const response = await fetch(`/api/metrics/kpis?date=${encodeURIComponent(new Date().toISOString().slice(0, 10))}`)
        if (!response.ok) throw new Error('Request failed')
        const payload = await response.json()
        if (!cancelled) {
          setKpis({ loading: false, data: { ...FALLBACK_KPIS, ...payload }, error: null })
        }
      } catch (error) {
        console.warn('Falling back to placeholder KPIs', error)
        if (!cancelled) {
          setKpis({ loading: false, data: FALLBACK_KPIS, error: 'Using cached metrics' })
        }
      }
    }

    fetchKpis()
    return () => {
      cancelled = true
    }
  }, [period, guildId])

  useEffect(() => {
    // TODO: replace with real API calls
    setHeadcount({ loading: true, data: FALLBACK_HEADCOUNT, error: null })
    setFlow({ loading: true, data: FALLBACK_FLOW, error: null })
    setEngagement({ loading: true, data: FALLBACK_ENGAGEMENT, error: null })
  }, [period, guildId])

  const kpiCards = useMemo(() => {
    const data = kpis.data
    return [
      { id: 'active', label: 'Active members', value: data.active, delta: data.activeDelta, unit: KPI_UNITS.active },
      { id: 'entries', label: 'Entries this month', value: data.entriesMonth, delta: data.entriesDelta, unit: KPI_UNITS.entries },
      { id: 'exits', label: 'Exits this month', value: data.exitsMonth, delta: data.exitsDelta, unit: KPI_UNITS.exits },
      { id: 'openCases', label: 'Open cases', value: data.openCases, delta: data.openCasesDelta, unit: KPI_UNITS.openCases },
      { id: 'engagement', label: 'Engagement per day', value: data.engagementPerDay, delta: data.engagementDelta, unit: KPI_UNITS.engagement },
      { id: 'botStatus', label: 'Bot status', value: data.botStatus, delta: data.botStatusDelta, format: (value) => value }
    ]
  }, [kpis.data])

  return (
    <div className="page overview-page">
      <header className="page__header">
        <div>
          <h1>Overview</h1>
          <p>Everything happening across moderation and people operations.</p>
        </div>
        <div className="page__header-actions">
          <button type="button" className="button button--ghost">Export snapshot</button>
          <button type="button" className="button button--primary">Daily summary</button>
        </div>
      </header>

      <section className="kpi-grid" aria-label="Key performance indicators">
        {kpiCards.map((kpi) => (
          <KpiCard
            key={kpi.id}
            label={kpi.label}
            value={kpi.format ? kpi.format(kpi.value) : formatNumber(kpi.value)}
            rawValue={kpi.value}
            delta={kpi.delta}
            loading={kpis.loading}
            periodLabel={periodLabel}
            unit={kpi.unit}
          />
        ))}
      </section>

      <section className="chart-grid" aria-label="Trends">
        <ChartCard title="Headcount by month" hint="Snapshot at the end of each month" status={headcount} />
        <ChartCard title="Entries vs exits" hint="Month-over-month flow" status={flow} />
        <ChartCard title="Engagement by channel" hint="Messages in the last 7 days" status={engagement} orientation="horizontal" />
      </section>

      <section className="split-grid">
        <div className="quick-actions" aria-label="Quick actions">
          <div className="section-title">
            <h2>Quick actions</h2>
            <p>Jump to the most common tasks.</p>
          </div>
          <div className="quick-actions__grid">
            <QuickActionButton label="Announce onboarding" description="Send the welcome packet to #announcements" />
            <QuickActionButton label="Daily summary" description="Post KPIs to the leadership channel" />
            <QuickActionButton label="Pause commands" description="Temporarily disable member commands" />
          </div>
        </div>
        <div className="alert-grid" aria-label="Alerts">
          <div className="section-title">
            <h2>Alerts</h2>
            <p>Areas that need follow-up.</p>
          </div>
          <AlertCard
            title="Turnover spike"
            message="Exits are 2× higher than last month. Review exit interviews."
            severity="warning"
            href="/people"
          />
          <AlertCard
            title="Moderation load"
            message="Auto actions ran 18 times in the last 24h. Adjust spam rules."
            severity="info"
            href="/moderation"
          />
        </div>
      </section>
    </div>
  )
}

function KpiCard({ label, value, rawValue, delta, loading, periodLabel, unit }) {
  const { trendLabel, deltaText, tooltip } = useMemo(() => buildDelta(rawValue, delta, periodLabel, unit), [rawValue, delta, periodLabel, unit])

  return (
    <article className="kpi-card" title={tooltip}>
      <p className="kpi-card__label">{label}</p>
      <p className="kpi-card__value">{loading ? '—' : value}</p>
      <p className={`kpi-card__delta kpi-card__delta--${trendLabel}`} aria-live="polite">
        {loading ? 'Calculating…' : deltaText}
      </p>
    </article>
  )
}

function buildDelta(current, delta, periodLabel, unit) {
  if (typeof current !== 'number' || typeof delta !== 'number' || Number.isNaN(current) || Number.isNaN(delta)) {
    return { trendLabel: 'neutral', deltaText: `vs ${periodLabel}`, tooltip: `Current period vs ${periodLabel}` }
  }
  const previous = current - delta
  let trendLabel = 'neutral'
  if (delta > 0) trendLabel = 'positive'
  if (delta < 0) trendLabel = 'negative'
  const percent = previous > 0 ? Math.round((delta / previous) * 100) : null
  const deltaPrefix = delta > 0 ? '+' : ''
  const unitLabel = unit ? (Math.abs(delta) === 1 ? unit.singular : unit.plural) : null
  const deltaMain = `${deltaPrefix}${delta}${unitLabel ? ' ' + unitLabel : ''}`
  const periodText = `vs ${periodLabel}`
  const deltaText = percent !== null ? `${deltaMain} (${percent}% ${periodText})` : `${deltaMain} ${periodText}`
  const currentUnit = unit ? (Math.abs(current) === 1 ? unit.singular : unit.plural) : null
  const previousUnit = unit ? (Math.abs(previous) === 1 ? unit.singular : unit.plural) : null
  const tooltip = [
    `Current: ${formatNumber(current)}${currentUnit ? ' ' + currentUnit : ''}`,
    `Previous: ${previous >= 0 ? formatNumber(previous) : '—'}${previousUnit ? ' ' + previousUnit : ''}`,
    `Change: ${deltaMain}${percent !== null ? ' (' + percent + '%)' : ''}`
  ].join('')
  return { trendLabel, deltaText, tooltip }
}

function ChartCard({ title, hint, status, orientation = 'vertical' }) {
  const { loading, error } = status
  let label = 'Connect a data source to unlock this chart.'
  if (loading) label = 'Loading data…'
  if (error) label = `Error: ${error}`
  return (
    <article className="chart-card">
      <header className="chart-card__header">
        <div>
          <h2>{title}</h2>
          {hint && <p>{hint}</p>}
        </div>
        <button type="button" className="button button--ghost chart-card__action">Details</button>
      </header>
      <div className="chart-card__body">
        <ChartPlaceholder status={status} label={label} orientation={orientation} />
      </div>
    </article>
  )
}

function ChartPlaceholder({ status, label, orientation }) {
  const stateClass = status.loading
    ? 'chart-placeholder--loading'
    : status.error
      ? 'chart-placeholder--error'
      : 'chart-placeholder--empty'
  return (
    <div className={`chart-placeholder ${stateClass} chart-placeholder--${orientation}`} role="img" aria-label={label}>
      <div className="chart-placeholder__content">
        <span>{label}</span>
        {!status.loading && (
          <button type="button" className="button button--ghost chart-placeholder__cta">Connect data</button>
        )}
      </div>
    </div>
  )
}

function QuickActionButton({ label, description }) {
  return (
    <button type="button" className="quick-action">
      <span className="quick-action__label">{label}</span>
      <span className="quick-action__description">{description}</span>
    </button>
  )
}

function AlertCard({ title, message, severity, href }) {
  return (
    <article className={`alert-card alert-card--${severity}`}>
      <h3>{title}</h3>
      <p>{message}</p>
      <a className="button button--ghost alert-card__cta" href={href}>
        Open report
      </a>
    </article>
  )
}

function formatNumber(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return value ?? '—'
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`
  }
  return value.toLocaleString()
}
