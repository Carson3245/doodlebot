import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from './auth.jsx'

const GuildContext = createContext(null)
const STORAGE_KEY = 'doodlebot.selectedGuild'

export function GuildProvider({ children }) {
  const { authenticated } = useAuth()
  const [guilds, setGuilds] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedGuildId, setSelectedGuildId] = useState(() => {
    if (typeof window === 'undefined') {
      return null
    }
    return sessionStorage.getItem(STORAGE_KEY)
  })

  const fetchGuilds = useCallback(async () => {
    if (!authenticated) {
      setGuilds([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/guilds')
      if (!response.ok) {
        throw new Error(`Status ${response.status}`)
      }
      const data = await response.json()
      const items = Array.isArray(data.guilds) ? data.guilds : []
      setGuilds(items)
      if (items.length > 0 && selectedGuildId) {
        const exists = items.some((guild) => guild.id === selectedGuildId)
        if (!exists) {
          setSelectedGuildId(null)
          sessionStorage.removeItem(STORAGE_KEY)
        }
      }
    } catch (err) {
      console.error('Failed to load guilds', err)
      setError('Unable to load guild list.')
    } finally {
      setLoading(false)
    }
  }, [authenticated, selectedGuildId])

  useEffect(() => {
    fetchGuilds()
  }, [fetchGuilds, authenticated])

  const selectGuild = useCallback((guildId) => {
    if (typeof window !== 'undefined') {
      if (guildId) {
        sessionStorage.setItem(STORAGE_KEY, guildId)
      } else {
        sessionStorage.removeItem(STORAGE_KEY)
      }
    }
    setSelectedGuildId(guildId || null)
  }, [])

  const selectedGuild = useMemo(
    () => guilds.find((guild) => guild.id === selectedGuildId) ?? null,
    [guilds, selectedGuildId]
  )

  const value = useMemo(
    () => ({
      guilds,
      loading,
      error,
      selectedGuild,
      selectedGuildId,
      selectGuild,
      refreshGuilds: fetchGuilds
    }),
    [guilds, loading, error, selectedGuild, selectedGuildId, selectGuild, fetchGuilds]
  )

  return <GuildContext.Provider value={value}>{children}</GuildContext.Provider>
}

export function useGuild() {
  const context = useContext(GuildContext)
  if (!context) {
    throw new Error('useGuild must be used within a GuildProvider')
  }
  return context
}
