import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../authContext.js'
import { useGuild } from '../guildContext.js'

export default function GuildSelectionPage() {
  const navigate = useNavigate()
  const { authenticated, loading: authLoading } = useAuth()
  const { guilds, loading, error, selectedGuildId, selectGuild, refreshGuilds } = useGuild()

  useEffect(() => {
    if (!authLoading && !authenticated) {
      navigate('/')
    }
  }, [authenticated, authLoading, navigate])

  const handleSelect = (guildId) => {
    selectGuild(guildId)
    navigate('/')
  }

  return (
    <div className="page guild-picker">
      <header className="page__header">
        <div>
          <h1>Select a server</h1>
          <p>Choose the guild you want to manage. You can switch at any time.</p>
        </div>
        <button type="button" className="button button--ghost" onClick={refreshGuilds} disabled={loading}>
          Refresh
        </button>
      </header>

      {error && <div className="callout callout--error">{error}</div>}

      <div className="guild-picker__grid">
        {loading ? (
          <div className="page-placeholder">Loading guilds...</div>
        ) : guilds.length === 0 ? (
          <div className="page-placeholder">No guilds found. Invite the bot to a server to get started.</div>
        ) : (
          guilds.map((guild) => {
            const isActive = guild.id === selectedGuildId
            const iconUrl = guild.icon
              ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`
              : null
            return (
              <button
                key={guild.id}
                type="button"
                className={`guild-card${isActive ? ' guild-card--active' : ''}`}
                onClick={() => handleSelect(guild.id)}
              >
                <span className="guild-card__icon" aria-hidden="true">
                  {iconUrl ? <img src={iconUrl} alt="" loading="lazy" /> : guild.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="guild-card__name">{guild.name}</span>
                {guild.memberCount !== null && (
                  <span className="guild-card__meta">{guild.memberCount} members</span>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
