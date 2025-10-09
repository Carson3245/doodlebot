import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGuild } from '../guildContext.js'
import { useAuth } from '../authContext.js'
import { formatDateTime } from '../utils.js'

const FILTER_DETAILS = {
  links: {
    label: 'Link filter',
    helper: 'Removes unapproved URLs and phishing attempts.'
  },
  invites: {
    label: 'Block server invites',
    helper: 'Stops users from advertising other servers.'
  },
  media: {
    label: 'Media attachments',
    helper: 'Restricts rich media uploads from new members.'
  },
  profanity: {
    label: 'Profanity filter',
    helper: 'Automatically removes messages with blocked words.'
  }
}

const TEMPLATE_LABELS = {
  warn: 'Warning DM',
  timeout: 'Timeout DM',
  ban: 'Ban DM'
}

function createQuickActionState() {
  return {
    ban: { user: '', guildId: '', reason: '', feedback: null, pending: false },
    timeout: { user: '', guildId: '', reason: '', duration: '', feedback: null, pending: false },
    warn: { user: '', guildId: '', reason: '', feedback: null, pending: false }
  }
}

const feedbackPalette = {
  success: { color: 'var(--success, #4caf50)' },
  error: { color: 'var(--danger, #e53935)' },
  info: { color: 'var(--accent, #4f86f7)' }
}

const guildDatalistId = 'moderation-guild-options'

export default function ModerationPage() {
  const { authenticated, refreshAuth } = useAuth()
  const { selectedGuild } = useGuild()
  const [memberLookup, setMemberLookup] = useState({
    ban: { results: [], loading: false },
    timeout: { results: [], loading: false },
    warn: { results: [], loading: false }
  })
  const lookupTimers = useRef({})
  const [quickActionTargets, setQuickActionTargets] = useState({
    ban: null,
    timeout: null,
    warn: null
  })
  const [stats, setStats] = useState({
    loading: true,
    bans: 0,
    timeouts: 0,
    warnings: 0,
    cases: 0,
    updatedAt: null,
    error: null
  })
  const [recentCases, setRecentCases] = useState({
    loading: true,
    items: [],
    error: null
  })
  const [config, setConfig] = useState(null)
  const [keywordsInput, setKeywordsInput] = useState('')
  const [feedback, setFeedback] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [guildOptions, setGuildOptions] = useState([])
  const [quickActions, setQuickActions] = useState(() => createQuickActionState())
  useEffect(() => {
    Object.values(lookupTimers.current).forEach((timer) => clearTimeout(timer))
    lookupTimers.current = {}
    setMemberLookup({
      ban: { results: [], loading: false },
      timeout: { results: [], loading: false },
      warn: { results: [], loading: false }
    })
    if (selectedGuild?.id) {
      setQuickActions((prev) => ({
        ban: { ...prev.ban, guildId: selectedGuild.id },
        timeout: { ...prev.timeout, guildId: selectedGuild.id },
        warn: { ...prev.warn, guildId: selectedGuild.id }
      }))
    } else {
      setQuickActions((prev) => ({
        ban: { ...prev.ban, guildId: '' },
        timeout: { ...prev.timeout, guildId: '' },
        warn: { ...prev.warn, guildId: '' }
      }))
    }
    setQuickActionTargets({ ban: null, timeout: null, warn: null })
  }, [selectedGuild?.id])

  const keywordList = useMemo(() => config?.filters?.customKeywords ?? [], [config?.filters?.customKeywords])

  const loadStats = useCallback(async () => {
    if (!authenticated) {
      setStats({
        loading: false,
        bans: 0,
        timeouts: 0,
        warnings: 0,
        cases: 0,
        updatedAt: null,
        error: null
      })
      return
    }
    try {
      setStats((prev) => ({ ...prev, loading: true, error: null }))
      const response = await fetch('/api/moderation/stats')
      if (response.status === 401) {
        refreshAuth()
        return
      }
      if (!response.ok) {
        throw new Error('Failed to load moderation stats')
      }
      const data = await response.json()
      setStats({
        loading: false,
        bans: data.bans ?? 0,
        timeouts: data.timeouts ?? 0,
        warnings: data.warnings ?? 0,
        cases: data.cases ?? 0,
        updatedAt: data.updatedAt ?? null,
        error: null
      })
    } catch (error) {
      console.error('Failed to load moderation stats', error)
      setStats((prev) => ({
        ...prev,
        loading: false,
        error: 'Unable to load moderation stats.'
      }))
    }
  }, [authenticated, refreshAuth])

  const loadCases = useCallback(async () => {
    if (!authenticated) {
      setRecentCases({
        loading: false,
        items: [],
        error: null
      })
      return
    }

    try {
      setRecentCases((prev) => ({ ...prev, loading: true, error: null }))
      const response = await fetch('/api/moderation/cases')
      if (response.status === 401) {
        refreshAuth()
        return
      }
      if (!response.ok) {
        throw new Error('Failed to load moderation cases')
      }
      const data = await response.json()
      setRecentCases({
        loading: false,
        items: Array.isArray(data) ? data : [],
        error: null
      })
    } catch (error) {
      console.error('Failed to load moderation cases', error)
      setRecentCases((prev) => ({
        ...prev,
        loading: false,
        error: 'Unable to load recent moderation cases.'
      }))
    }
  }, [authenticated, refreshAuth])

  const loadGuilds = useCallback(async () => {
    if (!authenticated) {
      setGuildOptions([])
      return
    }

    try {
      const response = await fetch('/api/status')
      if (response.status === 401) {
        refreshAuth()
        return
      }
      if (!response.ok) {
        throw new Error('Failed to load guild list')
      }
      const data = await response.json()
      setGuildOptions(Array.isArray(data.guilds) ? data.guilds : [])
    } catch (error) {
      console.error('Failed to load guild options', error)
      setGuildOptions([])
    }
  }, [authenticated, refreshAuth])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  useEffect(() => {
    loadCases()
  }, [loadCases])

  useEffect(() => {
    loadGuilds()
  }, [loadGuilds])

  useEffect(() => {
    if (!authenticated) {
      setConfig(null)
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)

    const loadModeration = async () => {
      try {
        const response = await fetch('/api/moderation')
        if (response.status === 401) {
          refreshAuth()
          return
        }
        if (!response.ok) {
          throw new Error('Failed to load moderation config')
        }
        const data = await response.json()
        if (active) {
          setConfig(data)
          setLoading(false)
        }
      } catch (error) {
        console.error('Failed to load moderation config', error)
        if (active) {
          setConfig(null)
          setLoading(false)
          setFeedback('Could not load moderation configuration.')
        }
      }
    }

    loadModeration()
    return () => {
      active = false
    }
  }, [authenticated, refreshAuth])

  const updateQuickAction = useCallback((action, patch) => {
    setQuickActions((prev) => ({
      ...prev,
      [action]: {
        ...prev[action],
        ...patch
      }
    }))
  }, [])

  const performMemberLookup = useCallback(
    async (action, query) => {
      if (!selectedGuild?.id) {
        return
      }
      try {
        const response = await fetch(`/api/guilds/${selectedGuild.id}/members?query=${encodeURIComponent(query)}&limit=10`)
        if (!response.ok) {
          throw new Error(`Status ${response.status}`)
        }
        const data = await response.json()
        const results = Array.isArray(data) ? data : []
        setMemberLookup((prev) => ({
          ...prev,
          [action]: { results, loading: false }
        }))
      } catch (error) {
        console.error('Failed to search members', error)
        setMemberLookup((prev) => ({
          ...prev,
          [action]: { results: [], loading: false }
        }))
      }
    },
    [selectedGuild?.id]
  )

  useEffect(() => {
    return () => {
      Object.values(lookupTimers.current).forEach((timer) => clearTimeout(timer))
    }
  }, [])

  const handleMemberPick = useCallback(
    (action, member) => {
      setQuickActionTargets((prev) => ({ ...prev, [action]: member }))
      updateQuickAction(action, { user: member.id })
      setMemberLookup((prev) => ({
        ...prev,
        [action]: { results: [], loading: false }
      }))
    },
    [updateQuickAction]
  )

  const handleMemberInput = useCallback(
    (action, value) => {
      updateQuickAction(action, { user: value })
      setQuickActionTargets((prev) => ({ ...prev, [action]: null }))
      if (!selectedGuild?.id || value.trim().length < 2) {
        setMemberLookup((prev) => ({
          ...prev,
          [action]: { results: [], loading: false }
        }))
        return
      }
      if (lookupTimers.current[action]) {
        clearTimeout(lookupTimers.current[action])
      }
      setMemberLookup((prev) => ({
        ...prev,
        [action]: { ...prev[action], loading: true }
      }))
      lookupTimers.current[action] = setTimeout(() => {
        performMemberLookup(action, value.trim())
      }, 250)
    },
    [performMemberLookup, selectedGuild?.id, updateQuickAction]
  )

  const handleMemberBlur = useCallback(
    (action) => {
      const value = quickActions[action].user.trim()
      if (!value) {
        setQuickActionTargets((prev) => ({ ...prev, [action]: null }))
        return
      }
      const match = memberLookup[action].results.find((member) => {
        const lower = value.toLowerCase()
        return (
          member.id === value ||
          (member.displayName && member.displayName.toLowerCase() === lower) ||
          (member.username && member.username.toLowerCase() === lower)
        )
      })
      if (match) {
        updateQuickAction(action, { user: match.id })
        setQuickActionTargets((prev) => ({ ...prev, [action]: match }))
      }
    },
    [memberLookup, quickActions, updateQuickAction]
  )

const submitQuickAction = useCallback(
    async (event, action) => {
      event.preventDefault()
      if (!authenticated) {
        updateQuickAction(action, {
          feedback: { type: 'error', text: 'Please log in with a moderator account.' },
          pending: false
        })
        return
      }

      const current = quickActions[action]
      const guildId = (current.guildId || selectedGuild?.id || '').trim()
      const userInput = current.user.trim()
      const selectedMember = quickActionTargets[action]
      const userId = userInput || (selectedMember ? selectedMember.id : '')
      const trimmedReason = current.reason.trim()

      if (!guildId || !userId) {
        updateQuickAction(action, {
          feedback: { type: 'error', text: 'Provide both guild ID and member ID.' },
          pending: false
        })
        return
      }

      if (action === 'timeout') {
        const duration = Number(current.duration)
        if (!Number.isFinite(duration) || duration <= 0) {
          updateQuickAction(action, {
            feedback: { type: 'error', text: 'Set a valid timeout duration (minutes).' },
            pending: false
          })
          return
        }
      }

      updateQuickAction(action, {
        pending: true,
        feedback: { type: 'info', text: 'Submitting action...' }
      })

      const payload = {
        guildId,
        userId,
        reason: trimmedReason || 'Dashboard action'
      }

      if (action === 'timeout') {
        payload.durationMinutes = Math.min(
          Math.max(Number(current.duration), 1),
          10_080
        )
      }

      try {
        const response = await fetch(`/api/moderation/actions/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })

        if (response.status === 401) {
          refreshAuth()
          updateQuickAction(action, {
            pending: false,
            feedback: { type: 'error', text: 'Session expired. Log in again.' }
          })
          return
        }

        if (!response.ok) {
          const error = await response.json().catch(() => ({}))
          throw new Error(error.error || 'Unable to execute moderation action.')
        }

        const data = await response.json().catch(() => ({}))
        if (data?.stats) {
          setStats({
            loading: false,
            bans: data.stats.bans ?? 0,
            timeouts: data.stats.timeouts ?? 0,
            warnings: data.stats.warnings ?? 0,
            cases: data.stats.cases ?? 0,
            updatedAt: data.stats.updatedAt ?? new Date().toISOString(),
            error: null
          })
        } else {
          loadStats()
        }
        loadCases()

        setQuickActions((prev) => ({
          ...prev,
          [action]: {
            ...prev[action],
            user: '',
            reason: '',
            duration: action === 'timeout' ? '' : prev[action].duration,
            feedback: { type: 'success', text: 'Action executed successfully.' },
            pending: false
          }
        }))
        setQuickActionTargets((prev) => ({ ...prev, [action]: null }))
        setMemberLookup((prev) => ({
          ...prev,
          [action]: { results: [], loading: false }
        }))
      } catch (error) {
        console.error('Failed to execute quick action', error)
        updateQuickAction(action, {
          pending: false,
          feedback: { type: 'error', text: error?.message ?? 'Failed to execute action.' }
        })
      }
    },
    [authenticated, loadCases, loadStats, quickActionTargets, quickActions, refreshAuth, selectedGuild?.id, updateQuickAction]
  )

  const filters = config?.filters ?? {}
  const spam = config?.spam ?? {}
  const escalation = config?.escalation ?? {}
  const alerts = config?.alerts ?? {}
  const dmTemplates = config?.dmTemplates ?? {}

  const handleToggleFilter = (key) => {
    setConfig((prev) => ({
      ...prev,
      filters: {
        ...prev.filters,
        [key]: !prev.filters[key]
      }
    }))
  }

  const handleSpamChange = (key, value) => {
    setConfig((prev) => ({
      ...prev,
      spam: {
        ...prev.spam,
        [key]: value
      }
    }))
  }

  const handleEscalationChange = (key, value) => {
    setConfig((prev) => ({
      ...prev,
      escalation: {
        ...prev.escalation,
        [key]: value
      }
    }))
  }

  const handleAlertsChange = (key, value) => {
    setConfig((prev) => ({
      ...prev,
      alerts: {
        ...prev.alerts,
        [key]: value
      }
    }))
  }

  const handleTemplateChange = (key, value) => {
    setConfig((prev) => ({
      ...prev,
      dmTemplates: {
        ...prev.dmTemplates,
        [key]: value
      }
    }))
  }

  const handleAddKeyword = () => {
    const trimmed = keywordsInput.trim()
    if (!trimmed) {
      return
    }

    setConfig((prev) => ({
      ...prev,
      filters: {
        ...prev.filters,
        customKeywords: Array.from(new Set([...(prev.filters.customKeywords ?? []), trimmed]))
      }
    }))
    setKeywordsInput('')
  }

  const handleRemoveKeyword = (keyword) => {
    setConfig((prev) => ({
      ...prev,
      filters: {
        ...prev.filters,
        customKeywords: (prev.filters.customKeywords ?? []).filter((entry) => entry !== keyword)
      }
    }))
  }

  const handleSave = async () => {
    if (!config) {
      return
    }

    setSaving(true)
    setFeedback('Saving moderation configuration...')

    try {
      const response = await fetch('/api/moderation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      })

      if (response.status === 401) {
        refreshAuth()
        setFeedback('Session expired. Please log in again.')
        setSaving(false)
        return
      }

      if (!response.ok) {
        throw new Error('Failed to save moderation configuration.')
      }

      const saved = await response.json()
      setConfig(saved)
      setFeedback(`Saved at ${formatDateTime(Date.now())}`)
    } catch (error) {
      console.error('Failed to save moderation configuration', error)
      setFeedback('Could not save moderation configuration. Check server logs.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page moderation-page">
      <section className="panel">
        <header className="panel__header">
          <div>
            <h2>Moderation overview</h2>
            <p>Monitor automated actions taken by the bot.</p>
          </div>
          <p className="panel__meta">
            {stats.error
              ? stats.error
              : stats.updatedAt
                ? `Updated ${formatDateTime(stats.updatedAt)}`
                : 'Awaiting first update'}
          </p>
        </header>
        <div className="panel__body stat-grid">
          <article className="stat-card">
            <p className="stat-card__label">Automated bans</p>
            <p className="stat-card__value">{stats.loading ? '--' : stats.bans}</p>
            <span className="stat-card__helper">Triggered by escalation rules</span>
          </article>
          <article className="stat-card">
            <p className="stat-card__label">Timeouts applied</p>
            <p className="stat-card__value">{stats.loading ? '--' : stats.timeouts}</p>
            <span className="stat-card__helper">Includes spam auto-timeouts</span>
          </article>
          <article className="stat-card">
            <p className="stat-card__label">Logged warnings</p>
            <p className="stat-card__value">{stats.loading ? '--' : stats.warnings}</p>
            <span className="stat-card__helper">Totals since last reset</span>
          </article>
          <article className="stat-card">
            <p className="stat-card__label">Cases on record</p>
            <p className="stat-card__value">{stats.loading ? '--' : stats.cases}</p>
            <span className="stat-card__helper">Stored in data/moderation/cases.json</span>
          </article>
        </div>
      </section>

      <section className="panel">
        <header className="panel__header">
          <div>
            <h2>Quick actions</h2>
            <p>Run manual moderation actions straight from the dashboard.</p>
          </div>
        </header>
        <div className="panel__body quick-actions" data-auth-signed-in hidden={!authenticated}>
          <p className="helper">
            Your dashboard session will be used as the moderator identity. Provide the guild and user IDs to target.
          </p>
          <datalist id={guildDatalistId}>
            {guildOptions.map((guild) => (
              <option key={guild.id} value={guild.id}>
                {guild.name}
              </option>
            ))}
          </datalist>
          {selectedGuild ? (
            <div className="quick-actions__grid">
              <form className="form quick-action" data-action="ban" onSubmit={(event) => submitQuickAction(event, 'ban')}>
              <h3>Ban</h3>
              <div className="form-row">
                <label htmlFor="ban-guild">Guild ID</label>
                <input
                  id="ban-guild"
                  name="guildId"
                  list={guildDatalistId}
                  placeholder="1234567890"
                  value={quickActions.ban.guildId || selectedGuild?.id || ""}
                  onChange={(event) => updateQuickAction('ban', { guildId: event.target.value })}
                  disabled={!authenticated || !selectedGuild || quickActions.ban.pending}
                  required
                />
              </div>
              <div className="form-row">
                <label htmlFor="ban-user">Member</label>
                <input
                  id="ban-user"
                  name="user"
                  list="member-suggest-ban"
                  placeholder="@user or ID"
                  value={quickActions.ban.user}
                  onChange={(event) => handleMemberInput('ban', event.target.value)}
                  onBlur={() => handleMemberBlur('ban')}
                  disabled={!authenticated || !selectedGuild || quickActions.ban.pending}
                  required
                />
                <datalist id="member-suggest-ban">
                  {memberLookup.ban.results.map((member) => (
                    <option
                      key={member.id}
                      value={member.id}
                      label={`${member.displayName || member.username || member.id} (${member.id})`}
                    />
                  ))}
                </datalist>
                {memberLookup.ban.loading && <p className="form-helper">Searching members...</p>}
                {memberLookup.ban.results.length > 0 && (
                  <div className="member-suggestions">
                    {memberLookup.ban.results.map((member) => (
                      <button
                        type="button"
                        key={member.id}
                        className="member-suggestion"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleMemberPick('ban', member)}
                      >
                        <span
                          className="member-suggestion__avatar"
                          style={
                            member.avatar
                              ? { backgroundImage: `url(${member.avatar})` }
                              : undefined
                          }
                        >
                          {!member.avatar &&
                            (member.displayName || member.username || member.id)
                              .slice(0, 2)
                              .toUpperCase()}
                        </span>
                        <span className="member-suggestion__meta">
                          <strong>{member.displayName || member.username || member.id}</strong>
                          <small>{member.id}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {quickActionTargets.ban && (
                  <div className="member-pill">
                    <span
                      className="member-pill__avatar"
                      style={
                        quickActionTargets.ban.avatar
                          ? { backgroundImage: `url(${quickActionTargets.ban.avatar})` }
                          : undefined
                      }
                    >
                      {!quickActionTargets.ban.avatar &&
                        (quickActionTargets.ban.displayName ||
                          quickActionTargets.ban.username ||
                          quickActionTargets.ban.id)
                          .slice(0, 2)
                          .toUpperCase()}
                    </span>
                    <span>
                      {quickActionTargets.ban.displayName ||
                        quickActionTargets.ban.username ||
                        quickActionTargets.ban.id}
                    </span>
                  </div>
                )}
              </div>
              <div className="form-row">
                <label htmlFor="ban-reason">Reason</label>
                <input
                  id="ban-reason"
                  name="reason"
                  placeholder="Rule violation..."
                  value={quickActions.ban.reason}
                  onChange={(event) => updateQuickAction('ban', { reason: event.target.value })}
                  disabled={!authenticated || !selectedGuild || quickActions.ban.pending}
                />
              </div>
              <button type="submit" className="button button--primary" disabled={!authenticated || !selectedGuild || quickActions.ban.pending}>
                {quickActions.ban.pending ? 'Processing...' : 'Ban member'}
              </button>
              {quickActions.ban.feedback && (
                <p className="form-helper" style={feedbackPalette[quickActions.ban.feedback.type] ?? undefined}>
                  {quickActions.ban.feedback.text}
                </p>
              )}
            </form>

            <form className="form quick-action" data-action="timeout" onSubmit={(event) => submitQuickAction(event, 'timeout')}>
              <h3>Timeout</h3>
              <div className="form-row">
                <label htmlFor="timeout-guild">Guild ID</label>
                <input
                  id="timeout-guild"
                  name="guildId"
                  list={guildDatalistId}
                  placeholder="1234567890"
                  value={quickActions.timeout.guildId || selectedGuild?.id || ""}
                  onChange={(event) => updateQuickAction('timeout', { guildId: event.target.value })}
                  disabled={!authenticated || !selectedGuild || quickActions.timeout.pending}
                  required
                />
              </div>
              <div className="form-row">
                <label htmlFor="timeout-user">Member</label>
                <input
                  id="timeout-user"
                  name="user"
                  list="member-suggest-timeout"
                  placeholder="@user or ID"
                  value={quickActions.timeout.user}
                  onChange={(event) => handleMemberInput('timeout', event.target.value)}
                  onBlur={() => handleMemberBlur('timeout')}
                  disabled={!authenticated || !selectedGuild || quickActions.timeout.pending}
                  required
                />
                <datalist id="member-suggest-timeout">
                  {memberLookup.timeout.results.map((member) => (
                    <option
                      key={member.id}
                      value={member.id}
                      label={`${member.displayName || member.username || member.id} (${member.id})`}
                    />
                  ))}
                </datalist>
                {memberLookup.timeout.loading && <p className="form-helper">Searching members...</p>}
                {memberLookup.timeout.results.length > 0 && (
                  <div className="member-suggestions">
                    {memberLookup.timeout.results.map((member) => (
                      <button
                        type="button"
                        key={member.id}
                        className="member-suggestion"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleMemberPick('timeout', member)}
                      >
                        <span
                          className="member-suggestion__avatar"
                          style={
                            member.avatar
                              ? { backgroundImage: `url(${member.avatar})` }
                              : undefined
                          }
                        >
                          {!member.avatar &&
                            (member.displayName || member.username || member.id)
                              .slice(0, 2)
                              .toUpperCase()}
                        </span>
                        <span className="member-suggestion__meta">
                          <strong>{member.displayName || member.username || member.id}</strong>
                          <small>{member.id}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {quickActionTargets.timeout && (
                  <div className="member-pill">
                    <span
                      className="member-pill__avatar"
                      style={
                        quickActionTargets.timeout.avatar
                          ? { backgroundImage: `url(${quickActionTargets.timeout.avatar})` }
                          : undefined
                      }
                    >
                      {!quickActionTargets.timeout.avatar &&
                        (quickActionTargets.timeout.displayName ||
                          quickActionTargets.timeout.username ||
                          quickActionTargets.timeout.id)
                          .slice(0, 2)
                          .toUpperCase()}
                    </span>
                    <span>
                      {quickActionTargets.timeout.displayName ||
                        quickActionTargets.timeout.username ||
                        quickActionTargets.timeout.id}
                    </span>
                  </div>
                )}
              </div>
              <div className="form-row">
                <label htmlFor="timeout-duration">Duration (min)</label>
                <input
                  id="timeout-duration"
                  name="duration"
                  type="number"
                  min="1"
                  max="10080"
                  placeholder="60"
                  value={quickActions.timeout.duration}
                  onChange={(event) => updateQuickAction('timeout', { duration: event.target.value })}
                  disabled={!authenticated || !selectedGuild || quickActions.timeout.pending}
                  required
                />
              </div>
              <div className="form-row">
                <label htmlFor="timeout-reason">Reason</label>
                <input
                  id="timeout-reason"
                  name="reason"
                  placeholder="Spamming, abuse..."
                  value={quickActions.timeout.reason}
                  onChange={(event) => updateQuickAction('timeout', { reason: event.target.value })}
                  disabled={!authenticated || !selectedGuild || quickActions.timeout.pending}
                />
              </div>
              <button type="submit" className="button button--primary" disabled={!authenticated || !selectedGuild || quickActions.timeout.pending}>
                {quickActions.timeout.pending ? 'Processing...' : 'Timeout member'}
              </button>
              {quickActions.timeout.feedback && (
                <p className="form-helper" style={feedbackPalette[quickActions.timeout.feedback.type] ?? undefined}>
                  {quickActions.timeout.feedback.text}
                </p>
              )}
            </form>

            <form className="form quick-action" data-action="warn" onSubmit={(event) => submitQuickAction(event, 'warn')}>
              <h3>Warn</h3>
              <div className="form-row">
                <label htmlFor="warn-guild">Guild ID</label>
                <input
                  id="warn-guild"
                  name="guildId"
                  list={guildDatalistId}
                  placeholder="1234567890"
                  value={quickActions.warn.guildId || selectedGuild?.id || ""}
                  onChange={(event) => updateQuickAction('warn', { guildId: event.target.value })}
                  disabled={!authenticated || !selectedGuild || quickActions.warn.pending}
                  required
                />
              </div>
              <div className="form-row">
                <label htmlFor="warn-user">Member</label>
                <input
                  id="warn-user"
                  name="user"
                  list="member-suggest-warn"
                  placeholder="@user or ID"
                  value={quickActions.warn.user}
                  onChange={(event) => handleMemberInput('warn', event.target.value)}
                  onBlur={() => handleMemberBlur('warn')}
                  disabled={!authenticated || !selectedGuild || quickActions.warn.pending}
                  required
                />
                <datalist id="member-suggest-warn">
                  {memberLookup.warn.results.map((member) => (
                    <option
                      key={member.id}
                      value={member.id}
                      label={`${member.displayName || member.username || member.id} (${member.id})`}
                    />
                  ))}
                </datalist>
                {memberLookup.warn.loading && <p className="form-helper">Searching members...</p>}
                {memberLookup.warn.results.length > 0 && (
                  <div className="member-suggestions">
                    {memberLookup.warn.results.map((member) => (
                      <button
                        type="button"
                        key={member.id}
                        className="member-suggestion"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleMemberPick('warn', member)}
                      >
                        <span
                          className="member-suggestion__avatar"
                          style={
                            member.avatar
                              ? { backgroundImage: `url(${member.avatar})` }
                              : undefined
                          }
                        >
                          {!member.avatar &&
                            (member.displayName || member.username || member.id)
                              .slice(0, 2)
                              .toUpperCase()}
                        </span>
                        <span className="member-suggestion__meta">
                          <strong>{member.displayName || member.username || member.id}</strong>
                          <small>{member.id}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {quickActionTargets.warn && (
                  <div className="member-pill">
                    <span
                      className="member-pill__avatar"
                      style={
                        quickActionTargets.warn.avatar
                          ? { backgroundImage: `url(${quickActionTargets.warn.avatar})` }
                          : undefined
                      }
                    >
                      {!quickActionTargets.warn.avatar &&
                        (quickActionTargets.warn.displayName ||
                          quickActionTargets.warn.username ||
                          quickActionTargets.warn.id)
                          .slice(0, 2)
                          .toUpperCase()}
                    </span>
                    <span>
                      {quickActionTargets.warn.displayName ||
                        quickActionTargets.warn.username ||
                        quickActionTargets.warn.id}
                    </span>
                  </div>
                )}
              </div>
              <div className="form-row">
                <label htmlFor="warn-reason">Reason</label>
                <textarea
                  id="warn-reason"
                  name="reason"
                  rows={3}
                  placeholder="Describe the violation..."
                  value={quickActions.warn.reason}
                  onChange={(event) => updateQuickAction('warn', { reason: event.target.value })}
                  disabled={!authenticated || !selectedGuild || quickActions.warn.pending}
                />
              </div>
              <button type="submit" className="button button--primary" disabled={!authenticated || !selectedGuild || quickActions.warn.pending}>
                {quickActions.warn.pending ? 'Processing...' : 'Log warning'}
              </button>
              {quickActions.warn.feedback && (
                <p className="form-helper" style={feedbackPalette[quickActions.warn.feedback.type] ?? undefined}>
                  {quickActions.warn.feedback.text}
                </p>
              )}
            </form>
          </div>
        ) : (
          <p className="placeholder">Select a server to run quick actions.</p>
        )}
        {!authenticated && (
          <p className="helper">
            Log in with your moderator account to unlock quick actions.
          </p>
        )}
        </div>
      </section>

      <section className="panel">
        <header className="panel__header">
          <div>
            <h2>Recent moderation cases</h2>
            <p>Automatic and manual actions recorded by the bot.</p>
          </div>
        </header>
        <div className="panel__body">
          {recentCases.loading ? (
            <p className="placeholder">Loading recent cases...</p>
          ) : recentCases.error ? (
            <p className="placeholder">{recentCases.error}</p>
          ) : recentCases.items.length === 0 ? (
            <p className="placeholder">No cases logged yet.</p>
          ) : (
            <ul className="simple-list simple-list--rows">
              {recentCases.items.slice(0, 10).map((item) => (
                <li key={item.id} className="moderation-case">
                  <div className="list-row">
                    <strong>{capitalize(item.action)}</strong>
                    <span className="list-meta">{formatDateTime(item.createdAt)}</span>
                  </div>
                  <p className="list-subtext">
                    User: {item.userTag ? `${item.userTag} (${item.userId})` : item.userId}
                  </p>
                  {item.reason && <p className="list-subtext">Reason: {item.reason}</p>}
                  {item.durationMinutes ? (
                    <p className="list-subtext">Duration: {item.durationMinutes} minutes</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="panel">
        <header className="panel__header">
          <div>
            <h2>Filters</h2>
            <p>Choose which messages are automatically removed by the bot.</p>
          </div>
        </header>
        <div className="panel__body filter-grid">
          {Object.entries(FILTER_DETAILS).map(([key, details]) => (
            <article key={key} className="filter-card">
              <header>
                <h3>{details.label}</h3>
                <p>{details.helper}</p>
              </header>
              <button
                type="button"
                className={`toggle ${filters[key] ? 'toggle--on' : 'toggle--off'}`}
                onClick={() => handleToggleFilter(key)}
                disabled={loading}
              >
                <span />
              </button>
            </article>
          ))}
        </div>
        <div className="panel__body keyword-manager">
          <div className="form-row">
            <label htmlFor="keyword-input">Custom keyword</label>
            <div className="keyword-input">
              <input
                id="keyword-input"
                placeholder="Add word or phrase"
                value={keywordsInput}
                onChange={(event) => setKeywordsInput(event.target.value)}
                disabled={loading}
              />
              <button type="button" className="button button--primary" onClick={handleAddKeyword} disabled={loading}>
                Add
              </button>
            </div>
            <p className="form-helper">Keywords are matched case-insensitively.</p>
          </div>
          <ul className="keyword-list">
            {keywordList.length === 0 ? (
              <li className="placeholder">No custom keywords yet.</li>
            ) : (
              keywordList.map((keyword) => (
                <li key={keyword}>
                  <span>{keyword}</span>
                  <button type="button" onClick={() => handleRemoveKeyword(keyword)} disabled={loading}>
                    Remove
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </section>

      <section className="panel">
        <header className="panel__header">
          <div>
            <h2>Spam controls</h2>
            <p>Rate limit spammy senders and escalate automatically.</p>
          </div>
        </header>
        <div className="panel__body spam-grid">
          {loading ? (
            <p className="placeholder">Loading configuration...</p>
          ) : (
            <>
              <div className="form-row">
                <label htmlFor="spam-messages">Messages per minute</label>
                <input
                  id="spam-messages"
                  type="number"
                  min="1"
                  max="120"
                  value={spam.messagesPerMinute ?? ''}
                  onChange={(event) => handleSpamChange('messagesPerMinute', Number(event.target.value))}
                />
                <p className="form-helper">Timeout users who exceed this rate.</p>
              </div>
              <div className="form-row">
                <label htmlFor="spam-timeout">Timeout duration (minutes)</label>
                <input
                  id="spam-timeout"
                  type="number"
                  min="1"
                  max="10080"
                  value={spam.autoTimeoutMinutes ?? ''}
                  onChange={(event) => handleSpamChange('autoTimeoutMinutes', Number(event.target.value))}
                />
                <p className="form-helper">Length of automatic timeouts.</p>
              </div>
              <div className="form-row">
                <label htmlFor="spam-escalation">Escalation after warnings</label>
                <input
                  id="spam-escalation"
                  type="number"
                  min="1"
                  max="10"
                  value={spam.escalationAfterWarnings ?? ''}
                  onChange={(event) => handleSpamChange('escalationAfterWarnings', Number(event.target.value))}
                />
                <p className="form-helper">After this many warnings escalate the response.</p>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="panel">
        <header className="panel__header">
          <div>
            <h2>Escalation ladder</h2>
            <p>Fine-tune how many offences it takes to auto-timeout or ban.</p>
          </div>
        </header>
        <div className="panel__body escalation-grid">
          {loading ? (
            <p className="placeholder">Loading...</p>
          ) : (
            <>
              <div className="form-row">
                <label htmlFor="esc-warn">Warn threshold</label>
                <input
                  id="esc-warn"
                  type="number"
                  min="1"
                  max="10"
                  value={escalation.warnThreshold ?? ''}
                  onChange={(event) => handleEscalationChange('warnThreshold', Number(event.target.value))}
                />
                <p className="form-helper">Escalate after this many warns.</p>
              </div>
              <div className="form-row">
                <label htmlFor="esc-timeout">Timeout threshold</label>
                <input
                  id="esc-timeout"
                  type="number"
                  min="1"
                  max="10"
                  value={escalation.timeoutThreshold ?? ''}
                  onChange={(event) => handleEscalationChange('timeoutThreshold', Number(event.target.value))}
                />
                <p className="form-helper">Issue a timeout after this many warns.</p>
              </div>
              <div className="form-row">
                <label htmlFor="esc-ban">Ban threshold</label>
                <input
                  id="esc-ban"
                  type="number"
                  min="1"
                  max="15"
                  value={escalation.banThreshold ?? ''}
                  onChange={(event) => handleEscalationChange('banThreshold', Number(event.target.value))}
                />
                <p className="form-helper">Ban the member after this many total offences.</p>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="panel">
        <header className="panel__header">
          <div>
            <h2>Alerts &amp; notifications</h2>
            <p>Control who gets notified when automod fires.</p>
          </div>
        </header>
        <div className="panel__body form-grid">
          {loading ? (
            <p className="placeholder">Loading...</p>
          ) : (
            <>
              <div className="form-row">
                <label htmlFor="log-channel">Log channel ID</label>
                <input
                  id="log-channel"
                  type="text"
                  placeholder="1234567890"
                  value={alerts.logChannelId ?? ''}
                  onChange={(event) => handleAlertsChange('logChannelId', event.target.value)}
                />
                <p className="form-helper">Where automod events are posted.</p>
              </div>
              <div className="form-row">
                <label htmlFor="staff-role">Staff role ID</label>
                <input
                  id="staff-role"
                  type="text"
                  placeholder="1234567890"
                  value={alerts.staffRoleId ?? ''}
                  onChange={(event) => handleAlertsChange('staffRoleId', event.target.value)}
                />
                <p className="form-helper">Role to ping when escalation happens.</p>
              </div>
              <div className="form-row">
                <label htmlFor="notify-auto">Notify on auto-action</label>
                <button
                  id="notify-auto"
                  type="button"
                  className={`toggle ${alerts.notifyOnAutoAction ? 'toggle--on' : 'toggle--off'}`}
                  onClick={() => handleAlertsChange('notifyOnAutoAction', !alerts.notifyOnAutoAction)}
                >
                  <span />
                </button>
                <p className="form-helper">Toggle staff notifications for every automod action.</p>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="panel">
        <header className="panel__header">
          <div>
            <h2>DM templates</h2>
            <p>Customize the message members receive when a punishment is applied.</p>
          </div>
        </header>
        <div className="panel__body template-grid">
          {loading ? (
            <p className="placeholder">Loading...</p>
          ) : (
            Object.entries(dmTemplates).map(([key, template]) => (
              <div key={key} className="template-card">
                <h3>{TEMPLATE_LABELS[key] ?? key}</h3>
                <p className="helper">Tokens supported: {'{guild}'}, {'{reason}'}, {'{duration}'}</p>
                <textarea
                  rows={4}
                  value={template}
                  onChange={(event) => handleTemplateChange(key, event.target.value)}
                />
              </div>
            ))
          )}
        </div>
      </section>

      <section className="panel">
        <header className="panel__header">
          <div>
            <h2>Review &amp; save</h2>
            <p>Changes affect future automod actions instantly after saving.</p>
          </div>
        </header>
        <div className="panel__body">
          <div className="form-row">
            <label>Status</label>
            <p className="list-subtext">
              {feedback ? feedback : config ? `Loaded ${formatDateTime(Date.now())}` : 'No changes yet'}
            </p>
          </div>
          <button
            type="button"
            className="button button--primary"
            onClick={handleSave}
            disabled={!authenticated || saving || !config}
          >
            {saving ? 'Saving...' : 'Save moderation configuration'}
          </button>
        </div>
      </section>
    </div>
  )
}

function capitalize(text) {
  if (!text) return ''
  return text.charAt(0).toUpperCase() + text.slice(1)
}
