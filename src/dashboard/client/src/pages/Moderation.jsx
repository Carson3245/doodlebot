import { useCallback, useEffect, useMemo, useState } from "react"

const EMPTY_CONFIG = {
  filters: {
    links: true,
    invites: true,
    media: false,
    profanity: true,
    customKeywords: []
  },
  spam: {
    messagesPerMinute: 8,
    autoTimeoutMinutes: 10,
    escalationAfterWarnings: 3,
    limits: {
      windowSec: 10,
      messages: 6,
      mentions: 6,
      links: 4,
      emojis: 20,
      attachments: 4
    }
  },
  scopes: {
    channelAllow: [],
    roleAllow: [],
    userAllow: []
  },
  raidMode: {
    enabled: false,
    defaultSlowmodeSec: 10,
    lockChannels: []
  },
  escalation: {
    warnThreshold: 2,
    timeoutThreshold: 3,
    banThreshold: 5
  },
  alerts: {
    logChannelId: null,
    staffRoleId: null,
    notifyOnAutoAction: true
  },
  support: {
    intakeChannelId: null
  },
  dmTemplates: {
    warn: "You received a warning in {guild}. Reason: {reason}",
    timeout: "You have been timed out in {guild} for {duration} minutes. Reason: {reason}",
    ban: "You have been banned from {guild}. Reason: {reason}"
  }
}

const EMPTY_STATS = {
  warnings: 0,
  timeouts: 0,
  bans: 0,
  cases: 0,
  updatedAt: null
}

export default function ModerationPage() {
  const [config, setConfig] = useState(null)
  const [draft, setDraft] = useState(null)
  const [stats, setStats] = useState(EMPTY_STATS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [configResponse, statsResponse] = await Promise.all([
        fetch("/api/moderation"),
        fetch("/api/moderation/stats")
      ])

      if (!configResponse.ok) {
        throw new Error(`Failed to load moderation settings (${configResponse.status})`)
      }

      const fetchedConfig = cloneConfig(await configResponse.json())
      const statsPayload = statsResponse.ok ? await statsResponse.json() : EMPTY_STATS

      setConfig(fetchedConfig)
      setDraft(cloneConfig(fetchedConfig))
      setStats(normalizeStats(statsPayload))
      setMessage(null)
    } catch (loadError) {
      console.error("Failed to load moderation settings", loadError)
      setError("Unable to load moderation settings. Try again in a moment.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const dirty = useMemo(() => {
    if (!config || !draft) {
      return false
    }
    return JSON.stringify(config) !== JSON.stringify(draft)
  }, [config, draft])

  const changes = useMemo(() => {
    if (!config || !draft) {
      return []
    }
    const diff = []

    const compare = (label, path, formatter = formatValue) => {
      const previous = getByPath(config, path)
      const next = getByPath(draft, path)
      if (JSON.stringify(previous) !== JSON.stringify(next)) {
        diff.push(`${label}: ${formatter(previous)} → ${formatter(next)}`)
      }
    }

    const compareList = (label, path) => {
      compare(label, path, formatListValue)
    }

    const compareTemplate = (key) => {
      if (getByPath(config, `dmTemplates.${key}`) !== getByPath(draft, `dmTemplates.${key}`)) {
        diff.push(`DM template (${key}) updated`)
      }
    }

    compare("Link filter", "filters.links", formatToggle)
    compare("Invite filter", "filters.invites", formatToggle)
    compare("Media filter", "filters.media", formatToggle)
    compare("Profanity filter", "filters.profanity", formatToggle)
    compareList("Custom keywords", "filters.customKeywords")

    compare("Spam: messages per minute", "spam.messagesPerMinute")
    compare("Spam: auto-timeout (minutes)", "spam.autoTimeoutMinutes")
    compare("Spam: escalate after warnings", "spam.escalationAfterWarnings")
    compare("Spam window (seconds)", "spam.limits.windowSec")
    compare("Spam: message burst", "spam.limits.messages")
    compare("Spam: mention burst", "spam.limits.mentions")
    compare("Spam: link burst", "spam.limits.links")
    compare("Spam: emoji burst", "spam.limits.emojis")
    compare("Spam: attachment burst", "spam.limits.attachments")

    compareList("Bypass channels", "scopes.channelAllow")
    compareList("Bypass roles", "scopes.roleAllow")
    compareList("Bypass users", "scopes.userAllow")

    compare("Raid mode ready", "raidMode.enabled", formatToggle)
    compare("Raid default slowmode", "raidMode.defaultSlowmodeSec")
    compareList("Raid lock channels", "raidMode.lockChannels")

    compare("Warn threshold", "escalation.warnThreshold")
    compare("Timeout threshold", "escalation.timeoutThreshold")
    compare("Ban threshold", "escalation.banThreshold")

    compare("Log channel", "alerts.logChannelId", formatId)
    compare("Staff role", "alerts.staffRoleId", formatId)
    compare("Notify on auto-action", "alerts.notifyOnAutoAction", formatToggle)

    compare("Support intake channel", "support.intakeChannelId", formatId)

    compareTemplate("warn")
    compareTemplate("timeout")
    compareTemplate("ban")

    return diff
  }, [config, draft])

  const updateDraft = useCallback((path, value) => {
    setDraft((previous) => {
      if (!previous) {
        return previous
      }
      const next = cloneConfig(previous)
      setByPath(next, path, value)
      return next
    })
    setMessage(null)
  }, [])

  const handleBooleanChange = useCallback((path) => (event) => {
    updateDraft(path, event.target.checked)
  }, [updateDraft])

  const handleNumberChange = useCallback((path) => (event) => {
    const numeric = Number(event.target.value)
    updateDraft(path, Number.isFinite(numeric) ? numeric : 0)
  }, [updateDraft])

  const handleListChange = useCallback((path) => (event) => {
    updateDraft(path, parseList(event.target.value))
  }, [updateDraft])

  const handleIdChange = useCallback((path) => (event) => {
    const trimmed = event.target.value.trim()
    updateDraft(path, trimmed.length ? trimmed : null)
  }, [updateDraft])

  const handleTemplateChange = useCallback((key) => (event) => {
    updateDraft(`dmTemplates.${key}`, event.target.value)
  }, [updateDraft])

  const handleReset = useCallback(() => {
    if (!config) {
      return
    }
    setDraft(cloneConfig(config))
    setMessage(null)
  }, [config])

  const handleSave = useCallback(async () => {
    if (!draft || !dirty) {
      return
    }
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch("/api/moderation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft)
      })
      if (!response.ok) {
        throw new Error(`Failed to save moderation settings (${response.status})`)
      }
      const payload = cloneConfig(await response.json())
      setConfig(payload)
      setDraft(cloneConfig(payload))
      setMessage("Moderation settings saved successfully.")
    } catch (saveError) {
      console.error("Failed to save moderation settings", saveError)
      setError("Unable to save moderation settings. Check the server logs for details.")
    } finally {
      setSaving(false)
    }
  }, [draft, dirty])

  if (loading) {
    return <div className="page-placeholder">Loading moderation settings...</div>
  }

  return (
    <div className="page moderation-page">
      <header className="page__header">
        <div>
          <h1>Moderation configuration</h1>
          <p>Define how the automation engine filters content, escalates cases, and communicates with members.</p>
        </div>
      </header>

      {error ? <div className="callout callout--error">{error}</div> : null}
      {message ? <div className="callout">{message}</div> : null}

      {!draft ? (
        <div className="page-placeholder">Configuration unavailable.</div>
      ) : (
        <>
          <ModerationStats stats={stats} />

          <section className="panel">
            <header className="panel__header">
              <div>
                <h2>Rules & filters</h2>
                <p>Enable automatic removal of risky or unwanted content.</p>
              </div>
            </header>
            <div className="panel__body moderation-grid">
              <ToggleField
                label="Block suspicious links"
                description="Removes known phishing and malware URLs."
                checked={draft.filters.links}
                onChange={handleBooleanChange("filters.links")}
              />
              <ToggleField
                label="Block invite links"
                description="Prevents members from advertising other servers."
                checked={draft.filters.invites}
                onChange={handleBooleanChange("filters.invites")}
              />
              <ToggleField
                label="Block media from new members"
                description="Restricts images, videos, and attachments until onboarding is complete."
                checked={draft.filters.media}
                onChange={handleBooleanChange("filters.media")}
              />
              <ToggleField
                label="Filter profanity"
                description="Automatically deletes messages containing banned words."
                checked={draft.filters.profanity}
                onChange={handleBooleanChange("filters.profanity")}
              />
            </div>
            <div className="panel__body">
              <FormGroup label="Custom keywords" helper="One keyword per line. Messages containing these phrases will be removed.">
                <textarea
                  rows={4}
                  value={formatListForTextarea(draft.filters.customKeywords)}
                  onChange={handleListChange("filters.customKeywords")}
                />
              </FormGroup>
            </div>
          </section>

          <section className="panel">
            <header className="panel__header">
              <div>
                <h2>Spam controls</h2>
                <p>Fine-tune how quickly the bot intervenes when members flood channels.</p>
              </div>
            </header>
            <div className="panel__body moderation-grid">
              <NumberField
                label="Messages per minute"
                description="Maximum messages a member can send before actions trigger."
                value={draft.spam.messagesPerMinute}
                min={1}
                onChange={handleNumberChange("spam.messagesPerMinute")}
              />
              <NumberField
                label="Auto-timeout (minutes)"
                description="Duration applied when a spam threshold is exceeded."
                value={draft.spam.autoTimeoutMinutes}
                min={1}
                onChange={handleNumberChange("spam.autoTimeoutMinutes")}
              />
              <NumberField
                label="Escalate after warnings"
                description="Number of warnings before the bot times-out the member."
                value={draft.spam.escalationAfterWarnings}
                min={1}
                onChange={handleNumberChange("spam.escalationAfterWarnings")}
              />
              <NumberField
                label="Spam window (seconds)"
                description="Interval used when counting messages, mentions, or links."
                value={draft.spam.limits.windowSec}
                min={3}
                onChange={handleNumberChange("spam.limits.windowSec")}
              />
              <NumberField
                label="Message burst"
                description="Messages allowed inside the window."
                value={draft.spam.limits.messages}
                min={1}
                onChange={handleNumberChange("spam.limits.messages")}
              />
              <NumberField
                label="Mention burst"
                description="Mentions allowed inside the window."
                value={draft.spam.limits.mentions}
                min={1}
                onChange={handleNumberChange("spam.limits.mentions")}
              />
              <NumberField
                label="Link burst"
                description="Links allowed before intervention."
                value={draft.spam.limits.links}
                min={1}
                onChange={handleNumberChange("spam.limits.links")}
              />
              <NumberField
                label="Emoji burst"
                description="Emoji reactions allowed inside the window."
                value={draft.spam.limits.emojis}
                min={1}
                onChange={handleNumberChange("spam.limits.emojis")}
              />
              <NumberField
                label="Attachment burst"
                description="Attachments allowed before a warning is issued."
                value={draft.spam.limits.attachments}
                min={1}
                onChange={handleNumberChange("spam.limits.attachments")}
              />
            </div>
          </section>

          <section className="panel">
            <header className="panel__header">
              <div>
                <h2>Scopes & bypass lists</h2>
                <p>Allow trusted channels, roles, or users to skip automated filters.</p>
              </div>
            </header>
            <div className="panel__body moderation-grid">
              <FormGroup label="Channel allowlist" helper="Channel IDs, one per line or separated by commas.">
                <textarea
                  rows={4}
                  value={formatListForTextarea(draft.scopes.channelAllow)}
                  onChange={handleListChange("scopes.channelAllow")}
                />
              </FormGroup>
              <FormGroup label="Role allowlist" helper="Role IDs, one per line or separated by commas.">
                <textarea
                  rows={4}
                  value={formatListForTextarea(draft.scopes.roleAllow)}
                  onChange={handleListChange("scopes.roleAllow")}
                />
              </FormGroup>
              <FormGroup label="User allowlist" helper="User IDs, one per line or separated by commas.">
                <textarea
                  rows={4}
                  value={formatListForTextarea(draft.scopes.userAllow)}
                  onChange={handleListChange("scopes.userAllow")}
                />
              </FormGroup>
            </div>
          </section>

          <section className="panel">
            <header className="panel__header">
              <div>
                <h2>Raid mode</h2>
                <p>Define how the server responds when raid mode is enabled.</p>
              </div>
            </header>
            <div className="panel__body moderation-grid">
              <ToggleField
                label="Raid mode ready"
                description="Preconfigure the response so staff can toggle it instantly."
                checked={draft.raidMode.enabled}
                onChange={handleBooleanChange("raidMode.enabled")}
              />
              <NumberField
                label="Default slowmode (seconds)"
                description="Applied when raid mode starts."
                value={draft.raidMode.defaultSlowmodeSec}
                min={0}
                onChange={handleNumberChange("raidMode.defaultSlowmodeSec")}
              />
              <FormGroup label="Channels to lock" helper="Channel IDs, one per line.">
                <textarea
                  rows={4}
                  value={formatListForTextarea(draft.raidMode.lockChannels)}
                  onChange={handleListChange("raidMode.lockChannels")}
                />
              </FormGroup>
            </div>
          </section>

          <section className="panel">
            <header className="panel__header">
              <div>
                <h2>Escalation ladder</h2>
                <p>Configure when the bot warns, times-out, or bans repeat offenders.</p>
              </div>
            </header>
            <div className="panel__body moderation-grid">
              <NumberField
                label="Warnings before timeout"
                description="Number of warnings issued before escalating to a timeout."
                value={draft.escalation.warnThreshold}
                min={1}
                onChange={handleNumberChange("escalation.warnThreshold")}
              />
              <NumberField
                label="Timeouts before ban"
                description="Timeout actions before a ban is considered."
                value={draft.escalation.timeoutThreshold}
                min={1}
                onChange={handleNumberChange("escalation.timeoutThreshold")}
              />
              <NumberField
                label="Ban threshold"
                description="Total strikes before a permanent ban."
                value={draft.escalation.banThreshold}
                min={1}
                onChange={handleNumberChange("escalation.banThreshold")}
              />
            </div>
          </section>

          <section className="panel">
            <header className="panel__header">
              <div>
                <h2>Notifications & routing</h2>
                <p>Choose where the bot posts logs and who receives alerts.</p>
              </div>
            </header>
            <div className="panel__body moderation-grid">
              <FormGroup label="Log channel ID" helper="Channel ID where moderation logs are posted.">
                <input
                  type="text"
                  value={draft.alerts.logChannelId ?? ""}
                  onChange={handleIdChange("alerts.logChannelId")}
                  placeholder="000000000000000000"
                />
              </FormGroup>
              <FormGroup label="Staff role ID" helper="Role mentioned when new actions fire.">
                <input
                  type="text"
                  value={draft.alerts.staffRoleId ?? ""}
                  onChange={handleIdChange("alerts.staffRoleId")}
                  placeholder="000000000000000000"
                />
              </FormGroup>
              <ToggleField
                label="Notify on automatic actions"
                description="Send an alert whenever the bot acts without staff input."
                checked={draft.alerts.notifyOnAutoAction}
                onChange={handleBooleanChange("alerts.notifyOnAutoAction")}
              />
              <FormGroup label="Support intake channel" helper="/support requests and DMs are forwarded to this channel.">
                <input
                  type="text"
                  value={draft.support.intakeChannelId ?? ""}
                  onChange={handleIdChange("support.intakeChannelId")}
                  placeholder="000000000000000000"
                />
              </FormGroup>
            </div>
          </section>

          <section className="panel">
            <header className="panel__header">
              <div>
                <h2>Direct message templates</h2>
                <p>Customize the messages sent to members when moderation actions fire.</p>
              </div>
            </header>
            <div className="panel__body template-grid">
              <FormGroup label="Warn template" helper="Use {guild} and {reason} to personalize the message.">
                <textarea
                  rows={4}
                  value={draft.dmTemplates.warn}
                  onChange={handleTemplateChange("warn")}
                />
              </FormGroup>
              <FormGroup label="Timeout template" helper="Use {duration} to mention the timeout length.">
                <textarea
                  rows={4}
                  value={draft.dmTemplates.timeout}
                  onChange={handleTemplateChange("timeout")}
                />
              </FormGroup>
              <FormGroup label="Ban template">
                <textarea
                  rows={4}
                  value={draft.dmTemplates.ban}
                  onChange={handleTemplateChange("ban")}
                />
              </FormGroup>
            </div>
          </section>

          <section className="panel review-panel">
            <header className="panel__header">
              <div>
                <h2>Review & save</h2>
                <p>Review the pending changes before applying them to the bot.</p>
              </div>
            </header>
            <div className="panel__body">
              {changes.length === 0 ? (
                <p>No changes pending.</p>
              ) : (
                <ul className="change-list">
                  {changes.map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ul>
              )}
            </div>
            <footer className="panel__footer review-actions">
              <button type="button" className="button button--primary" disabled={!dirty || saving} onClick={handleSave}>
                {saving ? "Saving..." : "Save changes"}
              </button>
              <button type="button" className="button button--ghost" disabled={!dirty || saving} onClick={handleReset}>
                Discard changes
              </button>
              <button type="button" className="button button--ghost" disabled={saving} onClick={loadData}>
                Reload
              </button>
            </footer>
          </section>
        </>
      )}
    </div>
  )
}

function ModerationStats({ stats }) {
  if (!stats) {
    return null
  }

  return (
    <section className="panel">
      <header className="panel__header">
        <div>
          <h2>Recent automation</h2>
          <p>Actions recorded by the moderation engine.</p>
        </div>
      </header>
      <div className="panel__body stat-grid">
        <StatCard label="Warnings" value={stats.warnings} />
        <StatCard label="Timeouts" value={stats.timeouts} />
        <StatCard label="Bans" value={stats.bans} />
        <StatCard label="Active cases" value={stats.cases} />
      </div>
      {stats.updatedAt ? (
        <footer className="panel__footer">
          <small>Last updated: {formatTimestamp(stats.updatedAt)}</small>
        </footer>
      ) : null}
    </section>
  )
}

function StatCard({ label, value }) {
  return (
    <div>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  )
}

function ToggleField({ label, description, checked, onChange }) {
  return (
    <label className="moderation-toggle">
      <input type="checkbox" checked={Boolean(checked)} onChange={onChange} />
      <span>
        <strong>{label}</strong>
        {description ? <p>{description}</p> : null}
      </span>
    </label>
  )
}

function NumberField({ label, description, value, min, onChange }) {
  return (
    <FormGroup label={label} helper={description}>
      <input type="number" value={value ?? 0} min={min} onChange={onChange} />
    </FormGroup>
  )
}

function FormGroup({ label, helper, children }) {
  return (
    <div className="moderation-form-group">
      <label>{label}</label>
      {children}
      {helper ? <p className="form-helper">{helper}</p> : null}
    </div>
  )
}

function cloneConfig(input) {
  return JSON.parse(JSON.stringify(input ?? EMPTY_CONFIG))
}

function normalizeStats(stats) {
  if (!stats) {
    return EMPTY_STATS
  }
  return {
    warnings: stats.warnings ?? 0,
    timeouts: stats.timeouts ?? 0,
    bans: stats.bans ?? 0,
    cases: stats.cases ?? stats.totalCases ?? 0,
    updatedAt: stats.updatedAt ?? null
  }
}

function setByPath(target, path, value) {
  const parts = path.split(".")
  let cursor = target
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index]
    if (typeof cursor[key] !== "object" || cursor[key] === null) {
      cursor[key] = {}
    }
    cursor = cursor[key]
  }
  cursor[parts[parts.length - 1]] = value
}

function getByPath(target, path) {
  const parts = path.split(".")
  return parts.reduce((acc, key) => (acc !== null && acc !== undefined ? acc[key] : undefined), target)
}

function parseList(text) {
  return text
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function formatListForTextarea(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return ""
  }
  return list.join("\n")
}

function formatListValue(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return "None"
  }
  return value.join(", ")
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") {
    return "None"
  }
  if (Array.isArray(value)) {
    return formatListValue(value)
  }
  if (typeof value === "boolean") {
    return formatToggle(value)
  }
  return String(value)
}

function formatToggle(value) {
  return value ? "Enabled" : "Disabled"
}

function formatId(value) {
  return value ? value : "Not set"
}

function formatTimestamp(value) {
  if (!value) {
    return "Never"
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "Unknown"
  }
  return date.toLocaleString()
}
