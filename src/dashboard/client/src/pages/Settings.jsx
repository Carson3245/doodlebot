import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../authContext.js'
import { useGuild } from '../guildContext.js'
import { formatDateTime } from '../utils.js'

const SECTIONS = [
  { id: 'identity', label: 'Identity & Voice' },
  { id: 'messaging', label: 'Messaging Style' },
  { id: 'brain', label: 'Brain Insights' },
  { id: 'rbac', label: 'RBAC Mapping' },
  { id: 'verification', label: 'Verification Flow' },
  { id: 'alerts', label: 'Alerts' }
]

const BOT_ROLES = ['owner', 'admin', 'mod', 'viewer']

const createQuestionId = () =>
  typeof window !== 'undefined' && window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `q-${Math.random().toString(36).slice(2, 8)}`

function normalizeList(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export default function SettingsPage() {
  const { authenticated, refreshAuth } = useAuth()
  const { selectedGuild } = useGuild()
  const [activeSection, setActiveSection] = useState('identity')

  const [loadingPersona, setLoadingPersona] = useState(false)
  const [identityForm, setIdentityForm] = useState({
    pronouns: '',
    bio: '',
    tone: '',
    pace: '',
    signaturePhrases: '',
    emojiFlavor: ''
  })
  const [messagingForm, setMessagingForm] = useState({
    usesNickname: false,
    addsSignOff: false,
    signOffText: '',
    temperature: '',
    topP: ''
  })
  const [feedback, setFeedback] = useState({ identity: '', messaging: '' })

  const [brain, setBrain] = useState({
    loading: true,
    totalTrackedUsers: 0,
    averageMessageLength: 0,
    updatedAt: null,
    topTalkers: [],
    recentVisitors: []
  })

  const [rbacState, setRbacState] = useState({ loading: false, error: null })
  const [rbacForm, setRbacForm] = useState({
    defaultRole: 'viewer',
    owner: '',
    admin: '',
    mod: '',
    viewer: ''
  })
  const [rbacFeedback, setRbacFeedback] = useState('')

  const [verificationState, setVerificationState] = useState({ loading: false, error: null })
  const [verificationForm, setVerificationForm] = useState({
    channelId: '',
    staffChannelId: '',
    approvedRoleIds: '',
    questions: []
  })
  const [verificationFeedback, setVerificationFeedback] = useState('')

  const [alertsState, setAlertsState] = useState({ loading: false, error: null, items: [] })

  const guildId = selectedGuild?.id ?? null
  const loadStyle = useCallback(async () => {
    if (!authenticated) {
      return
    }
    setLoadingPersona(true)
    try {
      const response = await fetch('/api/style')
      if (response.status === 401) {
        refreshAuth()
        return
      }
      if (!response.ok) {
        throw new Error('Failed to load style configuration')
      }
      const style = await response.json()
      setIdentityForm({
        pronouns: style.identity?.pronouns ?? '',
        bio: style.identity?.bio ?? '',
        tone: style.voice?.tone ?? '',
        pace: style.voice?.pace ?? '',
        signaturePhrases: Array.isArray(style.voice?.signaturePhrases)
          ? style.voice.signaturePhrases.join(', ')
          : '',
        emojiFlavor: style.voice?.emojiFlavor ?? ''
      })
      setMessagingForm({
        usesNickname: Boolean(style.response?.usesNickname),
        addsSignOff: Boolean(style.response?.addsSignOff),
        signOffText: style.response?.signOffText ?? '',
        temperature:
          style.creativity?.temperature !== undefined ? String(style.creativity.temperature) : '',
        topP: style.creativity?.topP !== undefined ? String(style.creativity.topP) : ''
      })
    } catch (error) {
      console.error(error)
      setFeedback({
        identity: 'Could not load persona.',
        messaging: 'Could not load persona.'
      })
    } finally {
      setLoadingPersona(false)
    }
  }, [authenticated, refreshAuth])

  const loadBrain = useCallback(async () => {
    if (!authenticated) return
    try {
      const response = await fetch('/api/brain')
      if (response.status === 401) {
        refreshAuth()
        return
      }
      if (!response.ok) {
        throw new Error('Failed to load brain data')
      }
      const data = await response.json()
      setBrain({
        loading: false,
        totalTrackedUsers: data.totalTrackedUsers ?? 0,
        averageMessageLength: data.averageMessageLength ?? 0,
        updatedAt: data.updatedAt ?? null,
        topTalkers: Array.isArray(data.topTalkers) ? data.topTalkers : [],
        recentVisitors: Array.isArray(data.recentVisitors) ? data.recentVisitors : []
      })
    } catch (error) {
      console.error(error)
      setBrain((prev) => ({
        ...prev,
        loading: false
      }))
    }
  }, [authenticated, refreshAuth])

  const loadRbac = useCallback(async () => {
    if (!authenticated || !guildId) {
      setRbacState({ loading: false, error: guildId ? null : 'Select a guild to configure RBAC.' })
      return
    }
    setRbacState({ loading: true, error: null })
    try {
      const response = await fetch(`/api/settings/rbac?guild_id=${guildId}`)
      if (response.status === 401) {
        refreshAuth()
        return
      }
      if (response.status === 403) {
        setRbacState({ loading: false, error: 'You do not have permission to manage RBAC.' })
        return
      }
      if (!response.ok) {
        throw new Error('Failed to load RBAC configuration')
      }
      const payload = await response.json()
      setRbacForm({
        defaultRole: payload.defaultRole ?? 'viewer',
        owner: (payload.assignments?.owner ?? []).join(', '),
        admin: (payload.assignments?.admin ?? []).join(', '),
        mod: (payload.assignments?.mod ?? []).join(', '),
        viewer: (payload.assignments?.viewer ?? []).join(', ')
      })
      setRbacState({ loading: false, error: null })
    } catch (error) {
      console.error(error)
      setRbacState({ loading: false, error: 'Unable to load RBAC settings.' })
    }
  }, [authenticated, guildId, refreshAuth])

  const loadVerification = useCallback(async () => {
    if (!authenticated || !guildId) {
      setVerificationState({
        loading: false,
        error: guildId ? null : 'Select a guild to configure verification.'
      })
      return
    }
    setVerificationState({ loading: true, error: null })
    try {
      const response = await fetch(`/api/settings/verification?guild_id=${guildId}`)
      if (response.status === 401) {
        refreshAuth()
        return
      }
      if (response.status === 403) {
        setVerificationState({
          loading: false,
          error: 'You do not have permission to manage verification flow.'
        })
        return
      }
      if (!response.ok) {
        throw new Error('Failed to load verification settings')
      }
      const payload = await response.json()
      setVerificationForm({
        channelId: payload.channelId ?? '',
        staffChannelId: payload.staffChannelId ?? '',
        approvedRoleIds: Array.isArray(payload.approvedRoleIds)
          ? payload.approvedRoleIds.join(', ')
          : '',
        questions: Array.isArray(payload.questions)
          ? payload.questions.map((question) => ({
              id: question.id ?? createQuestionId(),
              label: question.label ?? '',
              placeholder: question.placeholder ?? '',
              type: question.type ?? 'text',
              required: question.required !== false
            }))
          : []
      })
      setVerificationState({ loading: false, error: null })
    } catch (error) {
      console.error(error)
      setVerificationState({ loading: false, error: 'Unable to load verification settings.' })
    }
  }, [authenticated, guildId, refreshAuth])

  const loadAlerts = useCallback(async () => {
    if (!authenticated || !guildId) {
      setAlertsState({
        loading: false,
        error: guildId ? null : 'Select a guild to view alerts.',
        items: []
      })
      return
    }
    setAlertsState({ loading: true, error: null, items: [] })
    try {
      const response = await fetch(`/api/alerts?guild_id=${guildId}`)
      if (response.status === 401) {
        refreshAuth()
        return
      }
      if (response.status === 403) {
        setAlertsState({
          loading: false,
          error: 'You do not have permission to view alerts.',
          items: []
        })
        return
      }
      if (!response.ok) {
        throw new Error('Failed to load alerts')
      }
      const payload = await response.json()
      setAlertsState({ loading: false, error: null, items: Array.isArray(payload) ? payload : [] })
    } catch (error) {
      console.error(error)
      setAlertsState({
        loading: false,
        error: 'Unable to load alerts.',
        items: []
      })
    }
  }, [authenticated, guildId, refreshAuth])
  useEffect(() => {
    if (!authenticated) return
    loadStyle()
  }, [authenticated, loadStyle])

  useEffect(() => {
    if (!authenticated) return
    loadBrain()
    const interval = setInterval(loadBrain, 30_000)
    return () => clearInterval(interval)
  }, [authenticated, loadBrain])

  useEffect(() => {
    if (!authenticated) return
    loadRbac()
    loadVerification()
    loadAlerts()
  }, [authenticated, guildId, loadRbac, loadVerification, loadAlerts])

  const handleIdentitySubmit = async (event) => {
    event.preventDefault()
    if (!authenticated) {
      setFeedback((prev) => ({ ...prev, identity: 'Log in to update the persona.' }))
      return
    }

    setFeedback((prev) => ({ ...prev, identity: 'Saving...' }))
    try {
      const response = await fetch('/api/style', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identity: {
            pronouns: identityForm.pronouns,
            bio: identityForm.bio
          },
          voice: {
            tone: identityForm.tone,
            pace: identityForm.pace,
            signaturePhrases: normalizeList(identityForm.signaturePhrases),
            emojiFlavor: identityForm.emojiFlavor
          }
        })
      })
      if (response.status === 401) {
        refreshAuth()
        setFeedback((prev) => ({
          ...prev,
          identity: 'Session expired. Log in again.'
        }))
        return
      }
      if (!response.ok) {
        throw new Error('Failed to save identity')
      }
      setFeedback((prev) => ({
        ...prev,
        identity: 'Identity updated!'
      }))
    } catch (error) {
      console.error('Failed to save identity', error)
      setFeedback((prev) => ({
        ...prev,
        identity: 'Could not save identity.'
      }))
    }
  }

  const handleMessagingSubmit = async (event) => {
    event.preventDefault()
    if (!authenticated) {
      setFeedback((prev) => ({ ...prev, messaging: 'Log in to update messaging style.' }))
      return
    }

    setFeedback((prev) => ({ ...prev, messaging: 'Saving...' }))
    try {
      const response = await fetch('/api/style', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response: {
            usesNickname: messagingForm.usesNickname,
            addsSignOff: messagingForm.addsSignOff,
            signOffText: messagingForm.signOffText
          },
          creativity: {
            temperature: messagingForm.temperature,
            topP: messagingForm.topP
          }
        })
      })
      if (response.status === 401) {
        refreshAuth()
        setFeedback((prev) => ({
          ...prev,
          messaging: 'Session expired. Log in again.'
        }))
        return
      }
      if (!response.ok) {
        throw new Error('Failed to save messaging style')
      }
      setFeedback((prev) => ({
        ...prev,
        messaging: 'Messaging style updated!'
      }))
    } catch (error) {
      console.error('Failed to save messaging style', error)
      setFeedback((prev) => ({
        ...prev,
        messaging: 'Could not save messaging style.'
      }))
    }
  }

  const handleRbacSubmit = async (event) => {
    event.preventDefault()
    if (!authenticated || !guildId) {
      setRbacFeedback('Select a guild to update RBAC.')
      return
    }
    setRbacFeedback('Saving...')
    try {
      const response = await fetch('/api/settings/rbac', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guildId,
          defaultRole: rbacForm.defaultRole,
          assignments: BOT_ROLES.map((role) => ({
            rbacKey: role,
            discordRoleIds: normalizeList(rbacForm[role])
          }))
        })
      })
      if (response.status === 401) {
        refreshAuth()
        setRbacFeedback('Session expired. Log in again.')
        return
      }
      if (response.status === 403) {
        setRbacFeedback('You do not have permission to update RBAC.')
        return
      }
      if (!response.ok) {
        throw new Error('Failed to update RBAC')
      }
      setRbacFeedback('RBAC mapping updated.')
      loadRbac()
    } catch (error) {
      console.error('Failed to save RBAC mapping', error)
      setRbacFeedback('Could not save RBAC mapping.')
    }
  }

  const handleVerificationSubmit = async (event) => {
    event.preventDefault()
    if (!authenticated || !guildId) {
      setVerificationFeedback('Select a guild to update verification settings.')
      return
    }
    setVerificationFeedback('Saving...')
    try {
      const response = await fetch('/api/settings/verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guildId,
          channelId: verificationForm.channelId || null,
          staffChannelId: verificationForm.staffChannelId || null,
          approvedRoleIds: normalizeList(verificationForm.approvedRoleIds),
          questions: verificationForm.questions.map((question) => ({
            id: question.id,
            label: question.label,
            placeholder: question.placeholder,
            required: Boolean(question.required),
            type: question.type ?? 'text'
          }))
        })
      })
      if (response.status === 401) {
        refreshAuth()
        setVerificationFeedback('Session expired. Log in again.')
        return
      }
      if (response.status === 403) {
        setVerificationFeedback('You do not have permission to update verification.')
        return
      }
      if (!response.ok) {
        throw new Error('Failed to update verification settings')
      }
      setVerificationFeedback('Verification settings updated.')
      loadVerification()
    } catch (error) {
      console.error('Failed to save verification settings', error)
      setVerificationFeedback('Could not save verification settings.')
    }
  }

  const handleResolveAlert = async (alertId) => {
    if (!alertId) {
      return
    }
    try {
      const response = await fetch(`/api/alerts/${alertId}/resolve`, { method: 'POST' })
      if (response.status === 401) {
        refreshAuth()
        return
      }
      if (!response.ok) {
        throw new Error('Failed to resolve alert')
      }
      loadAlerts()
    } catch (error) {
      console.error('Failed to resolve alert', error)
    }
  }

  const handleAddQuestion = () => {
    setVerificationForm((prev) => ({
      ...prev,
      questions: [
        ...prev.questions,
        {
          id: createQuestionId(),
          label: '',
          placeholder: '',
          required: true,
          type: 'text'
        }
      ]
    }))
  }

  const handleUpdateQuestion = (questionId, updates) => {
    setVerificationForm((prev) => ({
      ...prev,
      questions: prev.questions.map((question) =>
        question.id === questionId ? { ...question, ...updates } : question
      )
    }))
  }

  const handleRemoveQuestion = (questionId) => {
    setVerificationForm((prev) => ({
      ...prev,
      questions: prev.questions.filter((question) => question.id !== questionId)
    }))
  }
  const renderIdentityForm = () => (
    <form className="settings-card settings-form" onSubmit={handleIdentitySubmit}>
      <h2>Persona</h2>
      <p className="text-muted">Tune how the bot introduces itself and speaks in channels.</p>
      <div className="settings-form-grid">
        <label>
          Pronouns
          <input
            value={identityForm.pronouns}
            onChange={(event) => setIdentityForm({ ...identityForm, pronouns: event.target.value })}
          />
        </label>
        <label className="span-2">
          Bio
          <textarea
            rows={3}
            value={identityForm.bio}
            onChange={(event) => setIdentityForm({ ...identityForm, bio: event.target.value })}
          />
        </label>
        <label>
          Tone
          <input
            value={identityForm.tone}
            onChange={(event) => setIdentityForm({ ...identityForm, tone: event.target.value })}
          />
        </label>
        <label>
          Pace
          <input
            value={identityForm.pace}
            onChange={(event) => setIdentityForm({ ...identityForm, pace: event.target.value })}
          />
        </label>
        <label className="span-2">
          Signature phrases (comma separated)
          <textarea
            rows={2}
            value={identityForm.signaturePhrases}
            onChange={(event) =>
              setIdentityForm({ ...identityForm, signaturePhrases: event.target.value })
            }
          />
        </label>
        <label>
          Emoji flavor
          <input
            value={identityForm.emojiFlavor}
            onChange={(event) => setIdentityForm({ ...identityForm, emojiFlavor: event.target.value })}
          />
        </label>
      </div>
      <footer className="settings-actions">
        <span className="text-muted">{feedback.identity}</span>
        <button type="submit" className="button button--primary" disabled={loadingPersona}>
          {loadingPersona ? 'Saving...' : 'Save persona'}
        </button>
      </footer>
    </form>
  )

  const renderMessagingForm = () => (
    <form className="settings-card settings-form" onSubmit={handleMessagingSubmit}>
      <h2>Messaging style</h2>
      <p className="text-muted">Adjust how the bot closes messages and references members.</p>
      <div className="settings-form-grid">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={messagingForm.usesNickname}
            onChange={(event) =>
              setMessagingForm({ ...messagingForm, usesNickname: event.target.checked })
            }
          />
          Refer to members by nickname
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={messagingForm.addsSignOff}
            onChange={(event) =>
              setMessagingForm({ ...messagingForm, addsSignOff: event.target.checked })
            }
          />
          Add a sign-off to messages
        </label>
        <label className="span-2">
          Sign-off text
          <input
            value={messagingForm.signOffText}
            onChange={(event) =>
              setMessagingForm({ ...messagingForm, signOffText: event.target.value })
            }
            placeholder="Thanks for reaching out!"
          />
        </label>
        <label>
          Temperature
          <input
            value={messagingForm.temperature}
            onChange={(event) =>
              setMessagingForm({ ...messagingForm, temperature: event.target.value })
            }
            placeholder="0.3"
          />
        </label>
        <label>
          top_p
          <input
            value={messagingForm.topP}
            onChange={(event) => setMessagingForm({ ...messagingForm, topP: event.target.value })}
            placeholder="0.8"
          />
        </label>
      </div>
      <footer className="settings-actions">
        <span className="text-muted">{feedback.messaging}</span>
        <button type="submit" className="button button--primary">
          Save messaging style
        </button>
      </footer>
    </form>
  )

  const renderBrainSection = () => (
    <div className="settings-card">
      <div className="settings-card-header">
        <div>
          <h2>Doodle Brain</h2>
          <p className="text-muted">Inspect how the bot perceives member activity.</p>
        </div>
        <span className="text-muted">Data never leaves your machine.</span>
      </div>
      {brain.loading ? (
        <p className="text-muted">Gathering insights...</p>
      ) : (
        <>
          <div className="settings-metric-grid">
            <div>
              <p className="label">Tracked members</p>
              <p className="value">{brain.totalTrackedUsers}</p>
            </div>
            <div>
              <p className="label">Avg message length</p>
              <p className="value">{brain.averageMessageLength}</p>
            </div>
            <div>
              <p className="label">Last update</p>
              <p className="value">
                {brain.updatedAt ? formatDateTime(brain.updatedAt) : 'Not available'}
              </p>
            </div>
          </div>
          <div className="settings-split">
            <div className="settings-card-subsection">
              <h3>Top conversationalists</h3>
              {brain.topTalkers.length === 0 ? (
                <p className="text-muted">No conversations tracked yet.</p>
              ) : (
                <ul className="settings-list">
                  {brain.topTalkers.map((talker) => (
                    <li key={talker.id ?? talker.name}>
                      <strong>{talker.name ?? 'Member'}</strong>
                      <span className="text-muted">
                        {talker.messages ?? 0} messages - Avg length {talker.averageLength ?? 0}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="settings-card-subsection">
              <h3>Recent visitors</h3>
              {brain.recentVisitors.length === 0 ? (
                <p className="text-muted">No recent entries.</p>
              ) : (
                <ul className="settings-list">
                  {brain.recentVisitors.map((visitor) => (
                    <li key={visitor.id ?? visitor.name}>
                      <strong>{visitor.name ?? 'Member'}</strong>
                      <span className="text-muted">
                        Last seen {visitor.lastSeen ? formatDateTime(visitor.lastSeen) : 'recently'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
  const renderRbacSection = () => (
    <form className="settings-card settings-form" onSubmit={handleRbacSubmit}>
      <div className="settings-card-header">
        <div>
          <h2>RBAC mapping</h2>
          <p className="text-muted">
            Map Discord roles to DoodleBot access tiers. Changes apply to the current guild only.
          </p>
        </div>
        <span className="text-muted">
          Default guild: {selectedGuild?.name ?? 'Select a guild'}
        </span>
      </div>
      {rbacState.error ? <p className="text-danger">{rbacState.error}</p> : null}
      <div className="settings-form-grid">
        <label>
          Default role
          <select
            value={rbacForm.defaultRole}
            onChange={(event) => setRbacForm({ ...rbacForm, defaultRole: event.target.value })}
          >
            {BOT_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
        {BOT_ROLES.map((role) => (
          <label key={role} className="span-2">
            Discord role IDs for <strong>{role}</strong>
            <input
              value={rbacForm[role]}
              onChange={(event) => setRbacForm({ ...rbacForm, [role]: event.target.value })}
              placeholder="1234567890, 9988776655"
            />
          </label>
        ))}
      </div>
      <footer className="settings-actions">
        <span className="text-muted">{rbacFeedback}</span>
        <button type="submit" className="button button--primary" disabled={rbacState.loading}>
          {rbacState.loading ? 'Saving...' : 'Save RBAC mapping'}
        </button>
      </footer>
    </form>
  )

  const renderVerificationSection = () => (
    <form className="settings-card settings-form" onSubmit={handleVerificationSubmit}>
      <div className="settings-card-header">
        <div>
          <h2>Verification flow</h2>
          <p className="text-muted">
            Configure the dedicated verification channel, staff notifications, and onboarding questions.
          </p>
        </div>
        <span className="text-muted">
          Default guild: {selectedGuild?.name ?? 'Select a guild'}
        </span>
      </div>
      {verificationState.error ? <p className="text-danger">{verificationState.error}</p> : null}
      <div className="settings-form-grid">
        <label>
          Verification channel ID
          <input
            value={verificationForm.channelId}
            onChange={(event) =>
              setVerificationForm({ ...verificationForm, channelId: event.target.value })
            }
            placeholder="1234567890"
          />
        </label>
        <label>
          Staff notifications channel ID
          <input
            value={verificationForm.staffChannelId}
            onChange={(event) =>
              setVerificationForm({ ...verificationForm, staffChannelId: event.target.value })
            }
            placeholder="1234567890"
          />
        </label>
        <label className="span-2">
          Approved role IDs (comma separated)
          <input
            value={verificationForm.approvedRoleIds}
            onChange={(event) =>
              setVerificationForm({ ...verificationForm, approvedRoleIds: event.target.value })
            }
            placeholder="1111, 2222"
          />
        </label>
      </div>

      <div className="settings-card-subsection">
        <div className="settings-card-header">
          <div>
            <h3>Verification questions</h3>
            <p className="text-muted">These questions appear when a member clicks "Start verification".</p>
          </div>
          <button type="button" className="button button--ghost" onClick={handleAddQuestion}>
            Add question
          </button>
        </div>
        {verificationForm.questions.length === 0 ? (
          <p className="text-muted">No questions configured. Add one to get started.</p>
        ) : (
          <div className="question-list">
            {verificationForm.questions.map((question) => (
              <div key={question.id} className="question-item">
                <div className="question-header">
                  <strong>{question.label || 'New question'}</strong>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => handleRemoveQuestion(question.id)}
                  >
                    Remove
                  </button>
                </div>
                <label>
                  Prompt
                  <input
                    value={question.label}
                    onChange={(event) =>
                      handleUpdateQuestion(question.id, { label: event.target.value })
                    }
                    placeholder="What brings you to the community?"
                  />
                </label>
                <label>
                  Placeholder
                  <input
                    value={question.placeholder}
                    onChange={(event) =>
                      handleUpdateQuestion(question.id, { placeholder: event.target.value })
                    }
                    placeholder="Write your answer..."
                  />
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={question.required}
                    onChange={(event) =>
                      handleUpdateQuestion(question.id, { required: event.target.checked })
                    }
                  />
                  Required
                </label>
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="settings-actions">
        <span className="text-muted">{verificationFeedback}</span>
        <button type="submit" className="button button--primary" disabled={verificationState.loading}>
          {verificationState.loading ? 'Saving...' : 'Save verification flow'}
        </button>
      </footer>
    </form>
  )

  const renderAlertsSection = () => (
    <div className="settings-card">
      <div className="settings-card-header">
        <div>
          <h2>Alerts</h2>
          <p className="text-muted">Live rules engine results for the selected guild.</p>
        </div>
        <div className="settings-actions">
          <button type="button" className="button button--ghost" onClick={loadAlerts}>
            Refresh
          </button>
        </div>
      </div>
      {alertsState.error ? <p className="text-danger">{alertsState.error}</p> : null}
      {alertsState.loading ? (
        <p className="text-muted">Checking alerts...</p>
      ) : alertsState.items.length === 0 ? (
        <p className="text-muted">No active alerts. Everything looks calm.</p>
      ) : (
        <ul className="settings-alert-list">
          {alertsState.items.map((alert) => (
            <li key={alert.id} className={`alert-card alert-card--${alert.severity ?? 'info'}`}>
              <header>
                <span className="alert-card__badge">{(alert.severity ?? 'info').toUpperCase()}</span>
                <h3>{alert.title ?? 'Alert'}</h3>
              </header>
              <p>{alert.body ?? 'Review activity in the dashboard.'}</p>
              <footer>
                <span className="alert-card__meta">
                  {alert.createdAt ? formatDateTime(alert.createdAt) : 'Just now'}
                  {alert.ruleKey ? ` • Rule: ${alert.ruleKey}` : ''}
                </span>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => handleResolveAlert(alert.id)}
                >
                  Resolve
                </button>
              </footer>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  const renderSection = () => {
    switch (activeSection) {
      case 'identity':
        return renderIdentityForm()
      case 'messaging':
        return renderMessagingForm()
      case 'brain':
        return renderBrainSection()
      case 'rbac':
        return renderRbacSection()
      case 'verification':
        return renderVerificationSection()
      case 'alerts':
        return renderAlertsSection()
      default:
        return null
    }
  }

  const heroSubtitle = useMemo(() => {
    if (!selectedGuild) {
      return 'Select a guild in the header to edit RBAC and verification settings.'
    }
    return `Configuring ${selectedGuild.name}`
  }, [selectedGuild])

  return (
    <div className="page settings-page">
      <header className="page__header">
        <div>
          <h1>Settings</h1>
          <p>Control the bot persona, guild access, verification, and alerts.</p>
        </div>
      </header>

      <section className="settings-hero">
        <div>
          <h2>Style presets stay in sync with /tune</h2>
          <p className="text-muted">
            Apply presets from Discord or tweak values here—both interfaces write to the same store.
          </p>
        </div>
        <span>{heroSubtitle}</span>
      </section>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`settings-nav__button${activeSection === section.id ? ' is-active' : ''}`}
              onClick={() => setActiveSection(section.id)}
            >
              {section.label}
            </button>
          ))}
        </nav>
        <section className="settings-content" aria-live="polite">
          {renderSection()}
        </section>
      </div>
    </div>
  )
}
