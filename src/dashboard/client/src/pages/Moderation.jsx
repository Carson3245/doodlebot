import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth.jsx'
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

export default function ModerationPage() {
  const { authenticated, refreshAuth } = useAuth()
  const [stats] = useState({ bans: 0, timeouts: 0, warnings: 0, cases: 0 })
  const [config, setConfig] = useState(null)
  const [keywordsInput, setKeywordsInput] = useState('')
  const [feedback, setFeedback] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!authenticated) {
      setConfig(null)
      setLoading(false)
      return
    }

    let active = true
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
          setFeedback('Could not load moderation configuration.')
          setLoading(false)
        }
      }
    }

    loadModeration()
    return () => {
      active = false
    }
  }, [authenticated, refreshAuth])

  const filters = config?.filters ?? {}
  const spam = config?.spam ?? {}
  const escalation = config?.escalation ?? {}
  const alerts = config?.alerts ?? {}
  const dmTemplates = config?.dmTemplates ?? {}

  const keywordList = useMemo(() => filters.customKeywords ?? [], [filters.customKeywords])

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
    if (!trimmed) return
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
    if (!authenticated || !config) return
    setSaving(true)
    setFeedback('Saving configuration...')
    try {
      const response = await fetch('/api/moderation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      })
      if (response.status === 401) {
        refreshAuth()
        setFeedback('Session expired. Log in again.')
        return
      }
      if (!response.ok) {
        throw new Error('Failed to save moderation config')
      }
      const updated = await response.json()
      setConfig(updated)
      setFeedback('Moderation configuration updated!')
    } catch (error) {
      console.error('Failed to save moderation config', error)
      setFeedback('Could not save moderation configuration.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <section className="stat-grid" data-moderation-summary>
        <article className="stat-card">
          <p className="stat-card__label">Active bans</p>
          <p className="stat-card__value">{stats.bans}</p>
          <span className="stat-card__helper">Members currently banned</span>
        </article>
        <article className="stat-card">
          <p className="stat-card__label">Active timeouts</p>
          <p className="stat-card__value">{stats.timeouts}</p>
          <span className="stat-card__helper">Members muted right now</span>
        </article>
        <article className="stat-card">
          <p className="stat-card__label">Logged warnings</p>
          <p className="stat-card__value">{stats.warnings}</p>
          <span className="stat-card__helper">Total warnings on record</span>
        </article>
        <article className="stat-card">
          <p className="stat-card__label">Open cases</p>
          <p className="stat-card__value">{stats.cases}</p>
          <span className="stat-card__helper">Investigations still in progress</span>
        </article>
      </section>

      <section className="panel">
        <header className="panel__header">
          <div>
            <h2>Quick actions</h2>
            <p>Trigger common moderation actions without memorising every slash command.</p>
          </div>
        </header>
        <div className="panel__body quick-actions" data-auth-signed-in hidden>
          <p className="helper">Your session will be used to issue commands. Adjust the drafts before sending.</p>
          <div className="quick-actions__grid">
            <form className="form quick-action" data-action="ban">
              <h3>Ban</h3>
              <div className="form-row">
                <label htmlFor="ban-user">User / ID</label>
                <input id="ban-user" name="user" placeholder="@user or 123" required disabled />
              </div>
              <div className="form-row">
                <label htmlFor="ban-reason">Reason</label>
                <input id="ban-reason" name="reason" placeholder="Rule violation..." disabled />
              </div>
              <button type="submit" className="button button--primary" disabled>
                Submit ban
              </button>
              <p className="form-helper">API integration coming soon.</p>
            </form>

            <form className="form quick-action" data-action="timeout">
              <h3>Timeout</h3>
              <div className="form-row">
                <label htmlFor="timeout-user">User / ID</label>
                <input id="timeout-user" name="user" placeholder="@user or 123" required disabled />
              </div>
              <div className="form-grid">
                <div className="form-row">
                  <label htmlFor="timeout-duration">Duration (min)</label>
                  <input id="timeout-duration" name="duration" type="number" min="1" max="10080" step="5" placeholder="60" disabled />
                </div>
                <div className="form-row">
                  <label htmlFor="timeout-reason">Reason</label>
                  <input id="timeout-reason" name="reason" placeholder="Flood, spam..." disabled />
                </div>
              </div>
              <button type="submit" className="button button--primary" disabled>
                Apply timeout
              </button>
              <p className="form-helper">Wire up the endpoint to enable this action.</p>
            </form>

            <form className="form quick-action" data-action="warn">
              <h3>Warning</h3>
              <div className="form-row">
                <label htmlFor="warn-user">User / ID</label>
                <input id="warn-user" name="user" placeholder="@user or 123" required disabled />
              </div>
              <div className="form-row">
                <label htmlFor="warn-reason">Reason</label>
                <textarea id="warn-reason" name="reason" rows={3} placeholder="Describe the violation..." disabled />
              </div>
              <button type="submit" className="button button--primary" disabled>
                Log warning
              </button>
              <p className="form-helper">Persistence layer coming soon.</p>
            </form>
          </div>
        </div>
        <div className="panel__body" data-auth-signed-out>
          <p className="helper">Log in with your moderator account to unlock quick actions.</p>
        </div>
      </section>

      <section className="panel">
        <header className="panel__header">
          <div>
            <h2>Automoderation</h2>
            <p>Fine-tune filters, spam controls, and escalation rules.</p>
          </div>
        </header>
        <div className="panel__body automod-grid">
          <div className="automod-card">
            <header>
              <h3>Content filters</h3>
              <p className="helper">Choose what gets blocked automatically.</p>
            </header>
            {loading ? (
              <p className="placeholder">Loading...</p>
            ) : (
              <ul className="simple-list">
                {Object.entries(FILTER_DETAILS).map(([key, details]) => (
                  <li key={key} className="automod-toggle">
                    <div>
                      <strong>{details.label}</strong>
                      <span className="list-subtext">{details.helper}</span>
                    </div>
                    <button
                      type="button"
                      className={`toggle ${filters[key] ? 'toggle--on' : 'toggle--off'}`}
                      onClick={() => handleToggleFilter(key)}
                    >
                      <span />
                    </button>
                  </li>
                ))}
                <li>
                  <strong>Custom keywords</strong>
                  <span className="list-subtext">
                    Add phrases that should trigger automod. Current total: {keywordList.length}
                  </span>
                  <div className="keyword-editor">
                    <div className="keyword-input">
                      <input
                        type="text"
                        placeholder="Enter keyword"
                        value={keywordsInput}
                        onChange={(event) => setKeywordsInput(event.target.value)}
                      />
                      <button type="button" className="button button--primary" onClick={handleAddKeyword}>
                        Add
                      </button>
                    </div>
                    <div className="keyword-list">
                      {keywordList.length === 0 ? (
                        <span className="list-subtext">No custom keywords yet.</span>
                      ) : (
                        keywordList.map((keyword) => (
                          <span key={keyword} className="keyword-pill">
                            {keyword}
                            <button type="button" onClick={() => handleRemoveKeyword(keyword)} aria-label="Remove keyword">
                              x
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </li>
              </ul>
            )}
          </div>

          <div className="automod-card">
            <header>
              <h3>Spam controls</h3>
              <p className="helper">Limits that trigger automatic timeouts.</p>
            </header>
            {loading ? (
              <p className="placeholder">Loading...</p>
            ) : (
              <div className="form-grid">
                <div className="form-row">
                  <label htmlFor="spam-mpm">Messages per minute</label>
                  <input
                    id="spam-mpm"
                    type="number"
                    min="1"
                    max="120"
                    value={spam.messagesPerMinute ?? ''}
                    onChange={(event) => handleSpamChange('messagesPerMinute', Number(event.target.value))}
                  />
                  <p className="form-helper">Members exceeding this in a minute will be flagged.</p>
                </div>
                <div className="form-row">
                  <label htmlFor="spam-timeout">Auto-timeout (minutes)</label>
                  <input
                    id="spam-timeout"
                    type="number"
                    min="1"
                    max="10080"
                    value={spam.autoTimeoutMinutes ?? ''}
                    onChange={(event) => handleSpamChange('autoTimeoutMinutes', Number(event.target.value))}
                  />
                  <p className="form-helper">Duration applied after a spam breach.</p>
                </div>
                <div className="form-row">
                  <label htmlFor="spam-escalation">Warnings before escalation</label>
                  <input
                    id="spam-escalation"
                    type="number"
                    min="1"
                    max="10"
                    value={spam.escalationAfterWarnings ?? ''}
                    onChange={(event) => handleSpamChange('escalationAfterWarnings', Number(event.target.value))}
                  />
                  <p className="form-helper">After this many warns, the next action escalates.</p>
                </div>
              </div>
            )}
          </div>

          <div className="automod-card">
            <header>
              <h3>Escalation rules</h3>
              <p className="helper">Define how the bot escalates punishments automatically.</p>
            </header>
            {loading ? (
              <p className="placeholder">Loading...</p>
            ) : (
              <div className="form-grid">
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
                  <p className="form-helper">Warn members when they hit this count of automod triggers.</p>
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
              </div>
            )}
          </div>

          <div className="automod-card">
            <header>
              <h3>Alerts &amp; notifications</h3>
              <p className="helper">Control who gets notified when automod fires.</p>
            </header>
            {loading ? (
              <p className="placeholder">Loading...</p>
            ) : (
              <div className="form-grid">
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
                    type="button"
                    className={`toggle ${alerts.notifyOnAutoAction ? 'toggle--on' : 'toggle--off'}`}
                    onClick={() => handleAlertsChange('notifyOnAutoAction', !alerts.notifyOnAutoAction)}
                  >
                    <span />
                  </button>
                  <p className="form-helper">Toggle staff notifications for every automod action.</p>
                </div>
              </div>
            )}
          </div>
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
    </>
  )
}
