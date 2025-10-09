import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth.jsx'
import { formatDateTime } from '../utils.js'

const SECTIONS = [
  { id: 'identity', label: 'Identity & Voice' },
  { id: 'messaging', label: 'Messaging Style' },
  { id: 'brain', label: 'Brain Insights' }
]

export default function SettingsPage() {
  const { authenticated, refreshAuth } = useAuth()
  const [activeSection, setActiveSection] = useState('identity')
  const [loading, setLoading] = useState(false)
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
    totalTrackedUsers: 0,
    averageMessageLength: 0,
    updatedAt: null,
    topTalkers: [],
    recentVisitors: [],
    loading: true
  })

  const loadStyle = useCallback(async () => {
    if (!authenticated) {
      return
    }
    setLoading(true)
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
      setFeedback((prev) => ({
        ...prev,
        identity: 'Could not load settings.',
        messaging: 'Could not load settings.'
      }))
    } finally {
      setLoading(false)
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
            signaturePhrases: identityForm.signaturePhrases
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean),
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
        throw new Error('Failed to save messaging preferences')
      }
      setFeedback((prev) => ({
        ...prev,
        messaging: 'Messaging preferences updated!'
      }))
    } catch (error) {
      console.error('Failed to save messaging style', error)
      setFeedback((prev) => ({
        ...prev,
        messaging: 'Could not save messaging style.'
      }))
    }
  }

  const talkers = useMemo(() => {
    if (!Array.isArray(brain.topTalkers) || brain.topTalkers.length === 0) {
      return [{ id: 'placeholder', displayName: 'No talkers yet.' }]
    }
    return brain.topTalkers
  }, [brain.topTalkers])

  const recentVisitors = useMemo(() => {
    if (!Array.isArray(brain.recentVisitors) || brain.recentVisitors.length === 0) {
      return [{ id: 'placeholder', displayName: 'No visitors yet.' }]
    }
    return brain.recentVisitors
  }, [brain.recentVisitors])

  return (
    <div className="page settings-page">
      <section className="page-intro">
        <h2>Style presets stay in sync with the in-Discord <code>/tune</code> command.</h2>
        <p>
          All changes persist to <code>data/style.json</code>. Apply a preset from Discord or tweak values here—both
          interfaces share the same store.
        </p>
      </section>

      <div className="settings-container">
        <nav className="settings-nav" aria-label="Settings categories">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              className="settings-nav__item"
              data-section={section.id}
              aria-selected={activeSection === section.id}
              onClick={() => setActiveSection(section.id)}
            >
              {section.label}
            </button>
          ))}
        </nav>

        <section className="settings-content">
          <article
            className={`settings-section${activeSection === 'identity' ? '' : ' hidden'}`}
            id="section-identity"
            data-section="identity"
          >
            <header className="settings-section__header">
              <h2>Identity &amp; Voice</h2>
              <p>Keep Doodley grounded in their story while adjusting tone and cadence.</p>
            </header>

            <form id="identity-form" className="panel form-panel" onSubmit={handleIdentitySubmit}>
              <div className="form-row">
                <label htmlFor="style-name">Bot name</label>
                <input id="style-name" name="name" type="text" value="Doodley" readOnly />
                <p className="form-helper">Doodley never forgets their own name.</p>
              </div>

              <div className="form-row">
                <label htmlFor="style-pronouns">Pronouns</label>
                <input
                  id="style-pronouns"
                  name="pronouns"
                  type="text"
                  value={identityForm.pronouns}
                  onChange={(event) => setIdentityForm((prev) => ({ ...prev, pronouns: event.target.value }))}
                  placeholder="they/them"
                  disabled={!authenticated || loading}
                />
              </div>

              <div className="form-row">
                <label htmlFor="style-bio">Persona bio</label>
                <textarea
                  id="style-bio"
                  name="bio"
                  rows={4}
                  value={identityForm.bio}
                  onChange={(event) => setIdentityForm((prev) => ({ ...prev, bio: event.target.value }))}
                  placeholder="Describe Doodley's story and mission."
                  disabled={!authenticated || loading}
                />
              </div>

              <div className="form-grid">
                <div className="form-row">
                  <label htmlFor="style-tone">Voice tone</label>
                  <input
                    id="style-tone"
                    name="tone"
                    type="text"
                    value={identityForm.tone}
                    onChange={(event) => setIdentityForm((prev) => ({ ...prev, tone: event.target.value }))}
                    placeholder="warm and whimsical"
                    disabled={!authenticated || loading}
                  />
                </div>

                <div className="form-row">
                  <label htmlFor="style-pace">Pacing</label>
                  <input
                    id="style-pace"
                    name="pace"
                    type="text"
                    value={identityForm.pace}
                    onChange={(event) => setIdentityForm((prev) => ({ ...prev, pace: event.target.value }))}
                    placeholder="steady"
                    disabled={!authenticated || loading}
                  />
                </div>
              </div>

              <div className="form-row">
                <label htmlFor="style-phrases">Signature phrases</label>
                <input
                  id="style-phrases"
                  name="signaturePhrases"
                  type="text"
                  value={identityForm.signaturePhrases}
                  onChange={(event) =>
                    setIdentityForm((prev) => ({ ...prev, signaturePhrases: event.target.value }))
                  }
                  placeholder="sparkly greetings, stardust vibes"
                  disabled={!authenticated || loading}
                />
                <p className="form-helper">Comma-separated values. Up to ten phrases are stored.</p>
              </div>

              <div className="form-row">
                <label htmlFor="style-emoji">Emoji flavor</label>
                <input
                  id="style-emoji"
                  name="emojiFlavor"
                  type="text"
                  value={identityForm.emojiFlavor}
                  onChange={(event) => setIdentityForm((prev) => ({ ...prev, emojiFlavor: event.target.value }))}
                  placeholder="twinkles"
                  disabled={!authenticated || loading}
                />
              </div>

              <div className="form-actions">
                <button type="submit" className="button button--primary" disabled={!authenticated || loading}>
                  Save identity
                </button>
                <p className="form-feedback" role="status">
                  {feedback.identity}
                </p>
              </div>
            </form>
          </article>

          <article
            className={`settings-section${activeSection === 'messaging' ? '' : ' hidden'}`}
            id="section-messaging"
            data-section="messaging"
          >
            <header className="settings-section__header">
              <h2>Messaging style</h2>
              <p>Choose how friendly, concise, or high-energy Doodley should be in replies.</p>
            </header>

            <form id="messaging-form" className="panel form-panel" onSubmit={handleMessagingSubmit}>
              <div className="form-row checkbox-row">
                <input
                  id="style-nickname"
                  name="usesNickname"
                  type="checkbox"
                  checked={messagingForm.usesNickname}
                  onChange={(event) =>
                    setMessagingForm((prev) => ({ ...prev, usesNickname: event.target.checked }))
                  }
                  disabled={!authenticated}
                />
                <label htmlFor="style-nickname">Include the member&apos;s name or nickname in replies</label>
              </div>

              <div className="form-row checkbox-row">
                <input
                  id="style-signoff"
                  name="addsSignOff"
                  type="checkbox"
                  checked={messagingForm.addsSignOff}
                  onChange={(event) =>
                    setMessagingForm((prev) => ({ ...prev, addsSignOff: event.target.checked }))
                  }
                  disabled={!authenticated}
                />
                <label htmlFor="style-signoff">Add a sign-off to each reply</label>
              </div>

              <div className="form-row">
                <label htmlFor="style-signoff-text">Sign-off text</label>
                <input
                  id="style-signoff-text"
                  name="signOffText"
                  type="text"
                  value={messagingForm.signOffText}
                  onChange={(event) =>
                    setMessagingForm((prev) => ({ ...prev, signOffText: event.target.value }))
                  }
                  placeholder="Doodley out!"
                  disabled={!authenticated}
                />
              </div>

              <div className="form-grid">
                <div className="form-row">
                  <label htmlFor="style-temperature">Creativity (temperature)</label>
                  <input
                    id="style-temperature"
                    name="temperature"
                    type="number"
                    step="0.05"
                    min="0.1"
                    max="1.2"
                    value={messagingForm.temperature}
                    onChange={(event) =>
                      setMessagingForm((prev) => ({ ...prev, temperature: event.target.value }))
                    }
                    placeholder="0.65"
                    disabled={!authenticated}
                  />
                  <p className="form-helper">Lower numbers keep responses grounded.</p>
                </div>

                <div className="form-row">
                  <label htmlFor="style-topp">Vocabulary breadth (top-p)</label>
                  <input
                    id="style-topp"
                    name="topP"
                    type="number"
                    step="0.05"
                    min="0.1"
                    max="1"
                    value={messagingForm.topP}
                    onChange={(event) => setMessagingForm((prev) => ({ ...prev, topP: event.target.value }))}
                    placeholder="0.85"
                    disabled={!authenticated}
                  />
                  <p className="form-helper">Reduce to limit rare words and focus the voice.</p>
                </div>
              </div>

              <div className="form-actions">
                <button type="submit" className="button button--primary" disabled={!authenticated}>
                  Save messaging style
                </button>
                <p className="form-feedback" role="status">
                  {feedback.messaging}
                </p>
              </div>
            </form>
          </article>

          <article
            className={`settings-section${activeSection === 'brain' ? '' : ' hidden'}`}
            id="section-brain"
            data-section="brain"
          >
            <header className="settings-section__header">
              <h2>Doodley Brain</h2>
              <p>Inspect how the bot perceives member activity. Data is local and never leaves your machine.</p>
            </header>

            <div className="panel form-panel">
              <dl className="quick-stats">
                <div>
                  <dt>Tracked members</dt>
                  <dd>{brain.totalTrackedUsers ?? 0}</dd>
                </div>
                <div>
                  <dt>Avg message length</dt>
                  <dd>{brain.averageMessageLength ?? 0}</dd>
                </div>
                <div>
                  <dt>Last update</dt>
                  <dd>{formatDateTime(brain.updatedAt)}</dd>
                </div>
              </dl>
            </div>

            <div className="panel list-panel">
              <h3>Top conversationalists</h3>
              <ul className="simple-list">
                {talkers.map((person) => (
                  <li key={person.userId ?? person.id}>
                    <strong>{person.displayName || person.userId}</strong>
                    {person.messageCount !== undefined && (
                      <span className="list-meta">
                        {person.messageCount} messages · Avg length {person.averageLength ?? 0}
                      </span>
                    )}
                    {person.lastSeenAt && (
                      <span className="list-subtext">Last seen {formatDateTime(person.lastSeenAt)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div className="panel list-panel">
              <h3>Recent visitors</h3>
              <ul className="simple-list">
                {recentVisitors.map((person) => (
                  <li key={person.userId ?? person.id}>
                    <strong>{person.displayName || person.userId}</strong>
                    {person.lastSeenAt && (
                      <span className="list-subtext">Last seen {formatDateTime(person.lastSeenAt)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </article>
        </section>
      </div>
    </div>
  )
}
