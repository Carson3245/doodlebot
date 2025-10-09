import { useCallback, useEffect, useMemo, useState } from 'react'
import { AuthContext } from './authContext.js'

export function AuthProvider({ children }) {
  const [state, setState] = useState({
    loading: true,
    authenticated: false,
    oauthEnabled: true,
    user: null,
    error: null
  })

  const loadAuthStatus = useCallback(async () => {
    try {
      const response = await fetch('/auth/status')
      if (!response.ok) {
        throw new Error(`Status ${response.status}`)
      }
      const data = await response.json()
      setState({
        loading: false,
        authenticated: Boolean(data.authenticated),
        oauthEnabled: data.oauthEnabled !== false,
        user: data.user ?? null,
        error: null
      })
    } catch (error) {
      console.error('Failed to load auth status', error)
      setState({
        loading: false,
        authenticated: false,
        oauthEnabled: true,
        user: null,
        error: 'Unable to reach authentication service.'
      })
    }
  }, [])

  useEffect(() => {
    loadAuthStatus()
  }, [loadAuthStatus])

  const logout = useCallback(async () => {
    try {
      await fetch('/auth/logout', { method: 'POST' })
    } catch (error) {
      console.error('Failed to log out', error)
    } finally {
      loadAuthStatus()
    }
  }, [loadAuthStatus])

  const value = useMemo(
    () => ({
      ...state,
      refreshAuth: loadAuthStatus,
      logout
    }),
    [state, loadAuthStatus, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

