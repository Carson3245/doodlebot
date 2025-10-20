import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useGuild } from '../guildContext.js'

const RANGE_DEFAULT = 'last_30d'

const QUICK_ACTIONS = [
  {
    id: 'daily-summary',
    label: 'Daily summary',
    type: 'action',
    description: 'Compile a Discord-ready snapshot of members, flow, and engagement.'
  },
  {
    id: 'verify-backlog',
    label: 'Verify backlog',
    type: 'link',
    href: '/people?status=pending',
    description: 'Jump to the verification queue and clear pending approvals.'
  },
  {
    id: 'open-mod-queue',
    label: 'Open mod queue',
    type: 'link',
    href: '/cases?queue=active',
    description: 'Review active and escalated cases that need attention.'
  },
  {
    id: 'tune-filters',
    label: 'Tune filters',
    type: 'link',
    href: '/moderation#filters',
    description: 'Adjust automod filters and escalation rules.'
  }
]

function formatNumber(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return '0'
  }
  return number.toLocaleString()
}

function formatVoiceMinutes(value) {
  const minutes = Math.max(0, Math.round(Number(value) || 0))
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours === 0) {
    return `${remainder}m`
  }
  return `${hours}h ${String(remainder).padStart(2, '0')}m`
}

function formatTimestamp(value) {
  if (!value) {
    return null
  }
  try {
    const date = new Date(value)
    return date.toLocaleString()
  } catch (_error) {
    return null
  }
}

export default function OverviewPage() {
  const { selectedGuild } = useGuild()
  const guildId = selectedGuild?.id ?? null
  const [overview, setOverview] = useState({ loading: true, data: null, error: null })
  const [notice, setNotice] = useState(null)
  const [runningAction, setRunningAction] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function loadOverview() {
      setOverview((previous) => ({ ...previous, loading: true, error: null }))
      const params = new URLSearchParams({ range: RANGE_DEFAULT })
      if (guildId) {
        params.set('guild_id', guildId)
      }
      try {
        const response = await fetch(`/api/overview?${params.toString()}`, { signal: controller.signal })
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}))
          throw new Error(payload?.error ?? `Request failed with status ${response.status}`)
        }
        const payload = await response.json()
        if (!cancelled) {
          setOverview({ loading: false, data: payload, error: null })
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          return
        }
        console.error('Failed to load overview snapshot', error)
        if (!cancelled) {
          setOverview({
            loading: false,
            data: null,
            error: error?.message ?? 'Unable to load overview.'
          })
        }
      }
    }

    loadOverview()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [guildId])

  const metrics = overview.data ?? {
    activeMembers: 0,
    joinsThisMonth: 0,
    leavesThisMonth: 0,
    openCases: 0,
    messagesPerDay: 0,
    voiceMinutesPerDay: 0,
    monthEndMembers: [],
    joinsVsLeaves: [],
    engagementByChannel: [],
    voiceByChannel: [],
    alerts: []
  }

  const kpis = useMemo(
    () => [
      { id: 'active-members', label: 'Active members', value: formatNumber(metrics.activeMembers) },
      { id: 'joins', label: 'Joins this month', value: formatNumber(metrics.joinsThisMonth) },
      { id: 'leaves', label: 'Leaves this month', value: formatNumber(metrics.leavesThisMonth) },
      { id: 'open-cases', label: 'Open cases', value: formatNumber(metrics.openCases) },
      { id: 'messages', label: 'Messages / day', value: formatNumber(metrics.messagesPerDay) },
      { id: 'voice', label: 'Voice time / day', value: formatVoiceMinutes(metrics.voiceMinutesPerDay) }
    ],
    [metrics]
  )

  const alerts = useMemo(() => {
    if (!Array.isArray(metrics.alerts)) {
      return []
    }
    return metrics.alerts
  }, [metrics.alerts])

  const monthEndRows = useMemo(() => {
    if (!Array.isArray(metrics.monthEndMembers)) {
      return []
    }
    return metrics.monthEndMembers.map((entry) => ({
      month: entry.month ?? '',
      members: formatNumber(entry.members ?? 0)
    }))
  }, [metrics.monthEndMembers])

  const flowRows = useMemo(() => {
    if (!Array.isArray(metrics.joinsVsLeaves)) {
      return []
    }
    return metrics.joinsVsLeaves.map((entry) => ({
      month: entry.month ?? '',
      joins: formatNumber(entry.joins ?? 0),
      leaves: formatNumber(entry.leaves ?? 0),
      net: formatNumber(entry.net ?? (entry.joins ?? 0) - (entry.leaves ?? 0))
    }))
  }, [metrics.joinsVsLeaves])

  const topMessageChannels = useMemo(() => {
    if (!Array.isArray(metrics.engagementByChannel)) {
      return []
    }
    return metrics.engagementByChannel.slice(0, 5).map((channel) => ({
      id: channel.channelId ?? channel.id ?? channel.name ?? 'channel',
      name: channel.name ?? `#${channel.channelId ?? 'channel'}`,
      value: formatNumber(channel.messages ?? channel.count ?? 0)
    }))
  }, [metrics.engagementByChannel])

  const topVoiceChannels = useMemo(() => {
    if (!Array.isArray(metrics.voiceByChannel)) {
      return []
    }
    return metrics.voiceByChannel.slice(0, 5).map((channel) => ({
      id: channel.channelId ?? channel.id ?? channel.name ?? 'channel',
      name: channel.name ?? `#${channel.channelId ?? 'channel'}`,
      value: formatVoiceMinutes(channel.minutes ?? channel.count ?? 0)
    }))
  }, [metrics.voiceByChannel])

  const runDailySummary = useCallback(async () => {
    setNotice(null)
    setRunningAction('daily-summary')
    try {
      const response = await fetch('/api/actions/daily-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildId })
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error ?? `Request failed with status ${response.status}`)
      }

      if (!response.body) {
        setNotice({ type: 'success', message: 'Daily summary generated.' })
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let summaryText = ''

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read()
        if (done) {
          break
        }
        buffer += decoder.decode(value, { stream: true })
        const segments = buffer.split('\n\n')
        buffer = segments.pop() ?? ''
        for (const segment of segments) {
          const trimmed = segment.trim()
          if (!trimmed.startsWith('data:')) {
            continue
          }
          const raw = trimmed.slice(5).trim()
          if (!raw) {
            continue
          }
          try {
            const event = JSON.parse(raw)
            if (event.status === 'error') {
              throw new Error(event.error || 'Daily summary failed.')
            }
            if (event.summary) {
              summaryText = event.summary
            }
          } catch (_error) {
            // ignore JSON parsing errors for partial chunks
          }
        }
      }

      setNotice({
        type: 'success',
        message: summaryText
          ? 'Daily summary generated and delivered.'
          : 'Daily summary generated.'
      })
    } catch (error) {
      console.error('Failed to run daily summary quick action:', error)
      setNotice({
        type: 'error',
        message: error?.message ?? 'Unable to run daily summary.'
      })
    } finally {
      setRunningAction(null)
    }
  }, [guildId])

  const renderNotice = () => {
    if (!notice) {
      return null
    }
    return (
      <div className={`inline-alert inline-alert--${notice.type}`} role="status">
        <span>{notice.message}</span>
        <button type="button" className="inline-alert__close" onClick={() => setNotice(null)}>
          Dismiss
        </button>
      </div>
    )
  }

  const renderAlerts = () => {
    if (overview.loading) {
      return <p className="text-muted">Checking alerts…</p>
    }
    if (alerts.length === 0) {
      return <p className="text-muted">No active alerts.</p>
    }
    return alerts.map((alert) => (
      <article key={alert.id ?? alert.rule} className={`alert-card alert-card--${alert.severity ?? 'info'}`}>
        <header>
          <span className="alert-card__badge">{(alert.severity ?? 'info').toUpperCase()}</span>
          <h3>{alert.title ?? 'Alert'}</h3>
        </header>
        <p>{alert.body ?? alert.description ?? 'Review activity in the dashboard.'}</p>
        <footer>
          <span className="alert-card__meta">
            {formatTimestamp(alert.createdAt) ?? 'Just now'}
            {alert.rule ? ` • Rule: ${alert.rule}` : null}
          </span>
          {alert.href ? (
            <Link to={alert.href} className="button button--ghost">
              View details
            </Link>
          ) : null}
        </footer>
      </article>
    ))
  }

  return (
    <div className="page overview-page">
      <header className="page__header">
        <div>
          <h1>Overview</h1>
          <p>Ops snapshot for the last 30 days.</p>
        </div>
      </header>

      {renderNotice()}

      <section className="panel kpi-panel" aria-live="polite">
        {overview.loading ? (
          <p className="text-muted">Loading KPIs…</p>
        ) : overview.error ? (
          <p className="text-danger">{overview.error}</p>
        ) : (
          <ul className="kpi-grid">
            {kpis.map((kpi) => (
              <li key={kpi.id} className="kpi-card">
                <p className="kpi-card__label">{kpi.label}</p>
                <p className="kpi-card__value">{kpi.value}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel quick-actions" aria-live="polite">
        <h2>Quick actions</h2>
        <div className="quick-actions__grid">
          {QUICK_ACTIONS.map((action) => {
            const disabled = runningAction === action.id
            if (action.type === 'action') {
              return (
                <button
                  key={action.id}
                  type="button"
                  className="quick-action"
                  onClick={runDailySummary}
                  disabled={disabled}
                >
                  <span>{action.label}</span>
                  <span className="quick-action__description">{action.description}</span>
                </button>
              )
            }
            return (
              <Link
                key={action.id}
                to={action.href}
                className="quick-action"
              >
                <span>{action.label}</span>
                <span className="quick-action__description">{action.description}</span>
              </Link>
            )
          })}
        </div>
      </section>

      <section className="panel tables-panel">
        <div className="tables-panel__column">
          <header className="section-title">
            <h2>Members at month end</h2>
            <p>Snapshot count captured at the end of each month.</p>
          </header>
          {monthEndRows.length === 0 ? (
            <p className="text-muted">No headcount snapshots yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col" className="text-right">
                    Members
                  </th>
                </tr>
              </thead>
              <tbody>
                {monthEndRows.map((row) => (
                  <tr key={row.month}>
                    <td>{row.month}</td>
                    <td className="text-right">{row.members}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="tables-panel__column">
          <header className="section-title">
            <h2>Joins vs leaves</h2>
            <p>Monthly entries and exits with net change.</p>
          </header>
          {flowRows.length === 0 ? (
            <p className="text-muted">No join/leave activity on record.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col" className="text-right">
                    Joins
                  </th>
                  <th scope="col" className="text-right">
                    Leaves
                  </th>
                  <th scope="col" className="text-right">
                    Net
                  </th>
                </tr>
              </thead>
              <tbody>
                {flowRows.map((row) => (
                  <tr key={row.month}>
                    <td>{row.month}</td>
                    <td className="text-right">{row.joins}</td>
                    <td className="text-right">{row.leaves}</td>
                    <td className="text-right">{row.net}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="panel channels-panel">
        <div className="channels-panel__column">
          <header className="section-title">
            <h2>Top text channels</h2>
            <p>Average messages per day for the selected range.</p>
          </header>
          {topMessageChannels.length === 0 ? (
            <div className="empty-state">
              <p>No engagement data yet.</p>
              <p className="text-muted">Enable telemetry to see per-channel metrics.</p>
            </div>
          ) : (
            <ul className="channel-list">
              {topMessageChannels.map((channel) => (
                <li key={channel.id}>
                  <span className="channel-list__name">{channel.name}</span>
                  <span className="channel-list__value">{channel.value}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="channels-panel__column">
          <header className="section-title">
            <h2>Top voice channels</h2>
            <p>Average voice minutes per day for the selected range.</p>
          </header>
          {topVoiceChannels.length === 0 ? (
            <div className="empty-state">
              <p>No voice activity captured.</p>
              <p className="text-muted">Grant voice intent to gather live data.</p>
            </div>
          ) : (
            <ul className="channel-list">
              {topVoiceChannels.map((channel) => (
                <li key={channel.id}>
                  <span className="channel-list__name">{channel.name}</span>
                  <span className="channel-list__value">{channel.value}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="panel alerts-panel">
        <header className="section-title">
          <h2>Alerts</h2>
          <p>Rules engine highlights from the selected guild.</p>
        </header>
        {renderAlerts()}
      </section>
    </div>
  )
}
