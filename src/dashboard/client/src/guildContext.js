import { createContext, useContext } from 'react'

export const GuildContext = createContext(null)

export function useGuild() {
  const context = useContext(GuildContext)
  if (!context) {
    throw new Error('useGuild must be used within a GuildProvider')
  }
  return context
}
