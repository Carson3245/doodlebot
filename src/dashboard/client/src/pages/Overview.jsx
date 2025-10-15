
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

const MONTH_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'short' })

const HEADCOUNT_HISTORY = [
  { date: '2024-04-01', label: 'Apr', value: 112 },
  { date: '2024-05-01', label: 'May', value: 117 },
  { date: '2024-06-01', label: 'Jun', value: 121 },
  { date: '2024-07-01', label: 'Jul', value: 124 },
  { date: '2024-08-01', label: 'Aug', value: 128 },
  { date: '2024-09-01', label: 'Sep', value: 131 }
]

const FLOW_HISTORY = [
  { date: '2024-04-01', label: 'Apr', entries: 22, exits: 18 },
  { date: '2024-05-01', label: 'May', entries: 24, exits: 19 },
  { date: '2024-06-01', label: 'Jun', entries: 24, exits: 20 },
  { date: '2024-07-01', label: 'Jul', entries: 24, exits: 21 },
  { date: '2024-08-01', label: 'Aug', entries: 26, exits: 22 },
  { date: '2024-09-01', label: 'Sep', entries: 27, exits: 24 }
]

const ENGAGEMENT_CHANNELS = [
  { channel: '#general', messages: 5620 },
  { channel: '#support', messages: 3920 },
  { channel: '#team-lounge', messages: 2180 },
  { channel: '#announcements', messages: 1180 },
  { channel: '#moderation', messages: 1560 }
]

const FALLBACK_KPIS = {
  active: 131,
  activeDelta: 3,
  entriesMonth: 27,
  entriesDelta: 1,
  exitsMonth: 24,
  exitsDelta: 2,
  openCases: 14,
  openCasesDelta: 4,
  engagementPerDay: 482,
  engagementDelta: 38,
  botStatus: 'Online',
  botStatusDelta: 0
}

const FALLBACK_HEADCOUNT = {
  series: HEADCOUNT_HISTORY.map((point) => ({ ...point })),
  history: HEADCOUNT_HISTORY.map((point) => ({ ...point })),
  summary: { current: 131, previous: 128, delta: 3, percent: 2.3 }
}

const FALLBACK_FLOW = {
  series: FLOW_HISTORY.map((point) => ({ ...point })),
  history: FLOW_HISTORY.map((point) => ({ ...point })),
  summary: {
    current: { entries: 27, exits: 24 },
    previous: { entries: 26, exits: 22 },
    delta: { entries: 1, exits: 2 },
    net: { current: 3, previous: 4, delta: -1 }
  }
}

const FALLBACK_ENGAGEMENT = {
  period: '30d',
  channels: ENGAGEMENT_CHANNELS.map((channel) => ({ ...channel })),
  summary: {
    totalMessages: 14460,
    previousTotalMessages: 13320,
    messagesPerDay: 482,
    previousMessagesPerDay: 444,
    deltaPerDay: 38
  }
}

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
    const controller = new AbortController()
    let cancelled = false

    const fetchKpis = async () => {
      setKpis((previous) => ({ ...previous, loading: true, error: null }))
      const params = new URLSearchParams({
        period,
        date: new Date().toISOString().slice(0, 10)
      })
      if (guildId) {
        params.set('guildId', guildId)
      }

      try {
        const response = await fetch(`/api/metrics/kpis?${params.toString()}`, { signal: controller.signal })
        if (!response.ok) throw new Error(`Request failed with status ${response.status}`)
        const payload = await response.json()
        if (!cancelled) {
          setKpis({ loading: false, data: { ...FALLBACK_KPIS, ...payload }, error: null })
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          return
        }
        console.warn('Falling back to placeholder KPIs', error)
        if (!cancelled) {
          setKpis({ loading: false, data: FALLBACK_KPIS, error: 'Using cached metrics' })
        }
      }
    }

    fetchKpis()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [period, guildId])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    const loadHeadcount = async () => {
      setHeadcount((previous) => ({ ...previous, loading: true, error: null }))
      const params = new URLSearchParams({ period, date: new Date().toISOString().slice(0, 10) })
      if (guildId) {
        params.set('guildId', guildId)
      }
      try {
        const response = await fetch(`/api/metrics/headcount?${params.toString()}`, { signal: controller.signal })
        if (!response.ok) throw new Error(`Request failed with status ${response.status}`)
        const payload = await response.json()
        if (!cancelled) {
          setHeadcount({ loading: false, data: payload, error: null })
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          return
        }
        console.warn('Falling back to placeholder headcount metrics', error)
        if (!cancelled) {
          setHeadcount({ loading: false, data: FALLBACK_HEADCOUNT, error: 'Using cached metrics' })
        }
      }
    }

    const loadFlow = async () => {
      setFlow((previous) => ({ ...previous, loading: true, error: null }))
      const params = new URLSearchParams({ period, date: new Date().toISOString().slice(0, 10) })
      if (guildId) {
        params.set('guildId', guildId)
      }
      try {
        const response = await fetch(`/api/metrics/flow?${params.toString()}`, { signal: controller.signal })
        if (!response.ok) throw new Error(`Request failed with status ${response.status}`)
        const payload = await response.json()
        if (!cancelled) {
          setFlow({ loading: false, data: payload, error: null })
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          return
        }
        console.warn('Falling back to placeholder flow metrics', error)
        if (!cancelled) {
          setFlow({ loading: false, data: FALLBACK_FLOW, error: 'Using cached metrics' })
        }
      }
    }

    const loadEngagement = async () => {
      setEngagement((previous) => ({ ...previous, loading: true, error: null }))
      const params = new URLSearchParams({ period })
      if (guildId) {
        params.set('guildId', guildId)
      }
      try {
        const response = await fetch(`/api/metrics/engagement?${params.toString()}`, { signal: controller.signal })
        if (!response.ok) throw new Error(`Request failed with status ${response.status}`)
        const payload = await response.json()
        if (!cancelled) {
          setEngagement({ loading: false, data: payload, error: null })
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          return
        }
        console.warn('Falling back to placeholder engagement metrics', error)
        if (!cancelled) {
          setEngagement({ loading: false, data: FALLBACK_ENGAGEMENT, error: 'Using cached metrics' })
        }
      }
    }

    loadHeadcount()
    loadFlow()
    loadEngagement()

    return () => {
      cancelled = true
      controller.abort()
    }
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
        <ChartCard
          title="Headcount by month"
          hint="Snapshot at the end of each month"
          status={headcount}
          render={(data) => <HeadcountPreview data={data} />}
        />
        <ChartCard
          title="Entries vs exits"
          hint="Month-over-month flow"
          status={flow}
          render={(data) => <FlowPreview data={data} />}
        />
        <ChartCard
          title="Engagement by channel"
          hint="Messages in the selected period"
          status={engagement}
          orientation="horizontal"
          render={(data) => <EngagementPreview data={data} />}
        />
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

function ChartCard({ title, hint, status, orientation = 'vertical', render }) {
  const { loading, error, data } = status

  let content
  if (loading) {
    content = <ChartPlaceholder status={status} label="Loading data…" orientation={orientation} hideCta />
  } else if (error) {
    const errorMessage = typeof error === 'string' ? error : 'Unable to load data'
    content = (
      <ChartPlaceholder
        status={{ loading: false, error: true }}
        label={`Error: ${errorMessage}`}
        orientation={orientation}
      />
    )
  } else if (render && hasChartData(data)) {
    content = render(data)
  } else if (hasChartData(data)) {
    content = (
      <ChartPlaceholder
        status={{ loading: false, error: null }}
        label="Visualization coming soon."
        orientation={orientation}
        hideCta
      />
    )
  } else {
    content = (
      <ChartPlaceholder
        status={{ loading: false, error: null }}
        label="Connect a data source to unlock this chart."
        orientation={orientation}
      />
    )
  }

  return (
    <article className="chart-card">
      <header className="chart-card__header">
        <div>
          <h2>{title}</h2>
          {hint && <p>{hint}</p>}
        </div>
        <button type="button" className="button button--ghost chart-card__action">Details</button>
      </header>
      <div className="chart-card__body">{content}</div>
    </article>
  )
}

function ChartPlaceholder({ status, label, orientation, hideCta = false }) {
  const stateClass = status.loading
    ? 'chart-placeholder--loading'
    : status.error
      ? 'chart-placeholder--error'
      : 'chart-placeholder--empty'
  return (
    <div className={`chart-placeholder ${stateClass} chart-placeholder--${orientation}`} role="img" aria-label={label}>
      <div className="chart-placeholder__content">
        <span>{label}</span>
        {!hideCta && !status.loading && (
          <button type="button" className="button button--ghost chart-placeholder__cta">Connect data</button>
        )}
      </div>
    </div>
  )
}

function HeadcountPreview({ data }) {
  const history = Array.isArray(data?.history) && data.history.length ? data.history : data?.series ?? []
  const points = history.slice(-6)
  const summary = data?.summary ?? {}
  const currentValue = typeof summary.current === 'number' ? summary.current : points.at(-1)?.value ?? null
  const previousValue =
    typeof summary.previous === 'number'
      ? summary.previous
      : points.length > 1
        ? points.at(-2)?.value ?? null
        : null

  return (
    <div className="chart-preview">
      <p className="chart-preview__lead">
        <strong>{currentValue !== null ? formatNumber(Math.round(currentValue)) : '—'}</strong>
        <span> members</span>
      </p>
      <TrendPill current={currentValue} previous={previousValue} unit={KPI_UNITS.active} />
      <ul className="chart-preview__list">
        {points.map((point) => (
          <li className="chart-preview__list-item" key={point.date ?? point.label}>
            <span>{point.label ?? formatMonthLabelFromInput(point.date, '—')}</span>
            <span>{formatNumber(point.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function FlowPreview({ data }) {
  const history = Array.isArray(data?.history) && data.history.length ? data.history : data?.series ?? []
  const points = history.slice(-6)
  const summary = data?.summary ?? {}
  const currentEntries = typeof summary.current?.entries === 'number' ? summary.current.entries : null
  const currentExits = typeof summary.current?.exits === 'number' ? summary.current.exits : null
  const netCurrent =
    typeof summary.net?.current === 'number'
      ? summary.net.current
      : currentEntries !== null && currentExits !== null
        ? currentEntries - currentExits
        : null
  const netPrevious =
    typeof summary.net?.previous === 'number'
      ? summary.net.previous
      : typeof summary.previous?.entries === 'number' && typeof summary.previous?.exits === 'number'
        ? summary.previous.entries - summary.previous.exits
        : null

  return (
    <div className="chart-preview">
      <p className="chart-preview__lead">
        <strong>{currentEntries !== null ? formatNumber(currentEntries) : '—'}</strong> entries
        <span> vs {currentExits !== null ? formatNumber(currentExits) : '—'} exits</span>
      </p>
      <TrendPill
        current={netCurrent}
        previous={netPrevious}
        unit={KPI_UNITS.active}
        suffix="net change vs last period"
      />
      <table className="chart-preview__table">
        <thead>
          <tr>
            <th>Month</th>
            <th>Entries</th>
            <th>Exits</th>
            <th>Net</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => {
            const net =
              typeof point.entries === 'number' && typeof point.exits === 'number'
                ? point.entries - point.exits
                : null
            return (
              <tr key={point.date ?? point.label}>
                <td>{point.label ?? formatMonthLabelFromInput(point.date, '—')}</td>
                <td>{formatNumber(point.entries)}</td>
                <td>{formatNumber(point.exits)}</td>
                <td>{formatSignedNumber(net)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function EngagementPreview({ data }) {
  const channels = Array.isArray(data?.channels) ? data.channels : []
  const summary = data?.summary ?? {}
  const currentPerDay = typeof summary.messagesPerDay === 'number' ? summary.messagesPerDay : null
  const previousPerDay =
    typeof summary.previousMessagesPerDay === 'number' ? summary.previousMessagesPerDay : null
  const totalMessages =
    typeof summary.totalMessages === 'number' && summary.totalMessages > 0
      ? summary.totalMessages
      : channels.reduce((total, channel) => total + (Number(channel.messages) || 0), 0)

  return (
    <div className="chart-preview chart-preview--horizontal">
      <p className="chart-preview__lead">
        <strong>{currentPerDay !== null ? formatNumber(Math.round(currentPerDay)) : '—'}</strong> avg messages/day
      </p>
      <TrendPill
        current={currentPerDay}
        previous={previousPerDay}
        unit={KPI_UNITS.engagement}
        suffix="per day vs last period"
      />
      <ul className="chart-preview__channels">
        {channels.map((channel) => {
          const messages = Number(channel.messages) || 0
          const share = totalMessages ? Math.round((messages / totalMessages) * 100) : 0
          return (
            <li key={channel.channel} className="chart-preview__channel">
              <div className="chart-preview__channel-row">
                <span className="chart-preview__channel-name">{channel.channel}</span>
                <span className="chart-preview__channel-value">{formatNumber(messages)}</span>
              </div>
              <div className="chart-preview__meter" aria-hidden="true">
                <span
                  className="chart-preview__meter-bar"
                  style={{ width: `${Math.max(0, Math.min(share, 100))}%` }}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function TrendPill({ current, previous, unit, suffix = 'vs last period' }) {
  if (typeof current !== 'number' || Number.isNaN(current)) {
    return <span className="chart-preview__delta chart-preview__delta--neutral">{suffix}</span>
  }

  if (typeof previous !== 'number' || Number.isNaN(previous)) {
    const rounded = Math.round(current)
    const unitLabel = unit ? (Math.abs(rounded) === 1 ? unit.singular : unit.plural) : null
    return (
      <span className="chart-preview__delta chart-preview__delta--neutral">
        {`${formatNumber(rounded)}${unitLabel ? ' ' + unitLabel : ''} ${suffix}`}
      </span>
    )
  }

  const delta = current - previous
  if (Math.round(delta) === 0) {
    return <span className="chart-preview__delta chart-preview__delta--neutral">No change {suffix}</span>
  }

  const direction = delta > 0 ? 'positive' : 'negative'
  const absDelta = Math.abs(delta)
  const roundedDelta = Math.round(absDelta)
  const unitLabel = unit ? (roundedDelta === 1 ? unit.singular : unit.plural) : null
  const percent = previous !== 0 ? Math.round((absDelta / Math.abs(previous)) * 100) : null
  const prefix = delta > 0 ? '+' : '−'

  return (
    <span className={`chart-preview__delta chart-preview__delta--${direction}`}>
      {`${prefix}${formatNumber(roundedDelta)}${unitLabel ? ' ' + unitLabel : ''}`}
      {percent !== null ? ` (${prefix}${percent}%)` : ''} {suffix}
    </span>
  )
}

function hasChartData(data) {
  if (!data) {
    return false
  }
  if (Array.isArray(data) && data.length) {
    return true
  }
  if (Array.isArray(data.series) && data.series.length) {
    return true
  }
  if (Array.isArray(data.history) && data.history.length) {
    return true
  }
  if (Array.isArray(data.channels) && data.channels.length) {
    return true
  }
  return false
}

function formatSignedNumber(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—'
  }
  if (value === 0) {
    return '0'
  }
  return `${value > 0 ? '+' : '−'}${formatNumber(Math.abs(value))}`
}

function formatMonthLabelFromInput(value, fallback) {
  if (!value) {
    return fallback ?? '—'
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return fallback ?? value
  }
  return MONTH_FORMATTER.format(parsed)
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
