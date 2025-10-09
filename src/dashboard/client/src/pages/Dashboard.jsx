import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth.jsx'
import { useGuild } from '../guild.jsx'
import { formatDuration } from '../utils.js'

const STATUS_REFRESH_MS = 15_000

export default function DashboardPage() {
  const { authenticated, refreshAuth } = useAuth()
  const { guilds, selectedGuild } = useGuild()
  const [status, setStatus] = useState({
    loading: true,
    status: 'offline',
    username: null,
    uptime: 0,
    guilds: [],
    error: null
  })
  const [messageForm, setMessageForm] = useState({
    channelId: '',
    message: '',
    feedback: null
  })

  useEffect(() => {
    if (!authenticated) {
      setStatus((prev) => ({ ...prev, loading: false }))
      return
    }

    let active = true

    const fetchStatus = async () => {
      try {
        const response = await fetch('/api/status')
        if (response.status === 401) {
          refreshAuth()
          return
        }
        if (!response.ok) {
          throw new Error(`Status ${response.status}`)
        }
        const data = await response.json()
        if (!active) return
        setStatus({
          loading: false,
          status: data.status ?? 'offline',
          username: data.username ?? null,
          uptime: data.uptime ?? 0,
          guilds: Array.isArray(data.guilds) ? data.guilds : [],
          error: null
        })
      } catch (error) {
        console.error('Failed to load bot status', error)
        if (!active) return
        setStatus((prev) => ({
          ...prev,
          loading: false,
          error: 'Unable to load bot status. Check the server logs.'
        }))
      }
    }

    fetchStatus()
    const timer = setInterval(fetchStatus, STATUS_REFRESH_MS)

    return () => {
      active = false
      clearInterval(timer)
    }
  }, [authenticated, refreshAuth])

  const guildSummary = useMemo(() => {
    const pool = selectedGuild ? [selectedGuild] : status.guilds
    if (!pool || pool.length === 0) {
      return [{ id: 'placeholder', name: 'No guilds connected yet.', placeholder: true }]
    }
    return pool.map((guild) => ({
      ...guild,
      initials: (guild.name || '')
        .split(' ')
        .map((part) => part.charAt(0))
        .join('')
        .slice(0, 2)
        .toUpperCase()
    }))
  }, [selectedGuild, status.guilds])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!authenticated) {
      setMessageForm((prev) => ({
        ...prev,
        feedback: { type: 'error', text: 'Please log in to send messages.' }
      }))
      return
    }

    setMessageForm((prev) => ({
      ...prev,
      feedback: { type: 'info', text: 'Sending message...' }
    }))

    try {
      const response = await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: messageForm.channelId.trim(),
          message: messageForm.message.trim()
        })
      })

      if (response.status === 401) {
        refreshAuth()
        setMessageForm((prev) => ({
          ...prev,
          feedback: { type: 'error', text: 'Session expired. Log in again.' }
        }))
        return
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Unable to send message')
      }

      setMessageForm({
        channelId: '',
        message: '',
        feedback: { type: 'success', text: 'Message sent successfully!' }
      })
    } catch (error) {
      console.error('Failed to send message', error)
      setMessageForm((prev) => ({
        ...prev,
        feedback: { type: 'error', text: 'Could not reach the server.' }
      }))
    }
  }

  const feedbackColor =
    messageForm.feedback?.type === 'success'
      ? '#63e6be'
      : messageForm.feedback?.type === 'error'
        ? '#ff6b6b'
        : undefined

  return (
    <div className="page dashboard-page">
      <section className="stat-grid">
        <article className="stat-card">
          <p className="stat-card__label">Bot status</p>
          <p className="stat-card__value" id="bot-status">
            {status.loading ? 'Loading...' : status.status === 'online' ? 'Online' : 'Offline'}
          </p>
          <span className="stat-card__helper">Live data from the running client</span>
        </article>
        <article className="stat-card">
          <p className="stat-card__label">Discord user</p>
          <p className="stat-card__value" id="bot-username">
            {status.loading ? 'Loading...' : status.username ?? 'N/A'}
          </p>
          <span className="stat-card__helper">Updates when the bot is connected</span>
        </article>
        <article className="stat-card">
          <p className="stat-card__label">Connected guilds</p>
          <p className="stat-card__value" id="guild-count">
            {status.loading ? '--' : guilds.length}
          </p>
          <span className="stat-card__helper">Refreshed from /api/status</span>
        </article>
        <article className="stat-card">
          <p className="stat-card__label">Uptime</p>
          <p className="stat-card__value" id="bot-uptime">
            {status.loading ? '00:00:00' : formatDuration(status.uptime)}
          </p>
          <span className="stat-card__helper">Since the last bot reboot</span>
        </article>
      </section>

      <section className="panel-grid">
        <article className="panel" id="status-card">
          <header className="panel__header">
            <div>
              <h2>Selected server</h2>
              <p>You're currently managing this guild via the dashboard.</p>
            </div>
          </header>
          <div className="panel__body">
            <ul id="guild-list" className="simple-list guild-list">
              {guildSummary.map((guild) => (
                <li key={guild.id} className="guild-list__item">
                  <span className="guild-avatar">
                    {guild.placeholder ? (
                      '--'
                    ) : guild.icon ? (
                      <img
                        src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`}
                        alt={`${guild.name} icon`}
                        loading="lazy"
                      />
                    ) : (
                      guild.initials || '??'
                    )}
                  </span>
                  <div className="guild-details">
                    <strong>{guild.name}</strong>
                    {guild.placeholder ? (
                      <span className="list-subtext">Invite Doodley to your first server.</span>
                    ) : (
                      <>
                        <span className="list-meta">{guild.id}</span>
                        <span className="list-subtext">
                          {guild.memberCount ? `${guild.memberCount} members` : 'Member count unavailable'}
                        </span>
                        {guild.description && <span className="list-subtext">{guild.description}</span>}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </article>

        <article className="panel">
          <header className="panel__header">
            <div>
              <h2>Quick outbound message</h2>
              <p>Send a one-off message to any channel. Secure this endpoint before production.</p>
            </div>
          </header>
          <div className="panel__body">
            <form className="form" onSubmit={handleSubmit}>
              <div className="form-row">
                <label htmlFor="channel-id">Channel ID</label>
                <input
                  id="channel-id"
                  name="channelId"
                  placeholder="1234567890"
                  value={messageForm.channelId}
                  onChange={(event) =>
                    setMessageForm((prev) => ({ ...prev, channelId: event.target.value }))
                  }
                  required
                  disabled={!authenticated}
                />
              </div>

              <div className="form-row">
                <label htmlFor="message-content">Message</label>
                <textarea
                  id="message-content"
                  name="message"
                  rows={4}
                  placeholder="Hello, explorers of Planet Doodle!"
                  value={messageForm.message}
                  onChange={(event) =>
                    setMessageForm((prev) => ({ ...prev, message: event.target.value }))
                  }
                  required
                  disabled={!authenticated}
                />
              </div>

              <div className="form-actions">
                <button type="submit" className="button button--primary" disabled={!authenticated}>
                  Send message
                </button>
                <p className="form-helper">Only authenticated admins should access this action.</p>
              </div>
            </form>
            <p
              className="form-feedback"
              role="status"
              style={feedbackColor ? { color: feedbackColor } : undefined}
            >
              {messageForm.feedback?.text ?? ''}
            </p>
          </div>
        </article>
      </section>
    </div>
  )
}
