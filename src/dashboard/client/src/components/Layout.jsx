import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import logoSrc from '../assets/logo.svg'

const NAV_ITEMS = [
  { label: 'Dashboard', to: '/' },
  { label: 'Persona & Voice', to: '/settings' },
  { label: 'Commands', to: '/commands' },
  { label: 'Moderation', to: '/moderation' },
  { label: 'Logs', to: '/logs', section: 'Insights' }
]

const PRIMARY_ITEMS = NAV_ITEMS.slice(0, 4)
const INSIGHT_ITEMS = NAV_ITEMS.slice(4)

export function AppLayout() {
  const location = useLocation()
  const { authenticated } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  useEffect(() => {
    document.body.classList.toggle('auth-locked', !authenticated)
  }, [authenticated])

  return (
    <>
      <div className="app-shell">
        <aside className={`sidebar${sidebarOpen ? ' sidebar--open' : ''}`} data-navigation>
          <SidebarBrand />
          <nav className="sidebar__nav" aria-label="Primary">
            <SidebarSection label="Overview">
              <SidebarLink to="/" end>
                Dashboard
              </SidebarLink>
            </SidebarSection>
            <SidebarSection label="Config">
              {PRIMARY_ITEMS.slice(1).map((item) => (
                <SidebarLink key={item.to} to={item.to}>
                  {item.label}
                </SidebarLink>
              ))}
            </SidebarSection>
            <SidebarSection label="Insights">
              {INSIGHT_ITEMS.map((item) => (
                <SidebarLink key={item.to} to={item.to}>
                  {item.label}
                </SidebarLink>
              ))}
            </SidebarSection>
          </nav>
          <SidebarFooter />
        </aside>

        <div className="main-area">
          <Topbar onToggleSidebar={() => setSidebarOpen((prev) => !prev)} />
          <main className="content">
            <Outlet />
          </main>
        </div>
      </div>
      <AuthOverlay />
    </>
  )
}

function SidebarBrand() {
  return (
    <div className="sidebar__brand">
      <img src={logoSrc} alt="Planet Doodley logo" className="sidebar__logo" />
      <div>
        <p className="sidebar__title">Planet Doodle</p>
        <p className="sidebar__subtitle">Control Center</p>
      </div>
    </div>
  )
}

function SidebarSection({ label, children }) {
  return (
    <div className="sidebar__group">
      <p className="sidebar__label">{label}</p>
      {children}
    </div>
  )
}

function SidebarLink({ children, ...props }) {
  return (
    <NavLink {...props} className="sidebar__link">
      {children}
    </NavLink>
  )
}

function SidebarFooter() {
  return (
    <div className="sidebar__footer">
      <p className="sidebar__version">v0.1 · Doodley</p>
      <button className="sidebar__collapse" type="button" aria-label="Toggle navigation" disabled>
        <span />
        <span />
        <span />
      </button>
    </div>
  )
}

function Topbar({ onToggleSidebar }) {
  const { authenticated, oauthEnabled, user, logout, loading } = useAuth()

  const displayName = useMemo(() => {
    if (!user) return 'Not signed in'
    if (user.displayName) return user.displayName
    if (user.globalName) return user.globalName
    if (user.username && user.discriminator && user.discriminator !== '0') {
      return `${user.username}#${user.discriminator}`
    }
    return user.username ?? 'Member'
  }, [user])

  const avatar = useMemo(() => {
    if (!user) return { text: '--', style: {} }
    if (user.avatar) {
      const format = user.avatar.startsWith('a_') ? 'gif' : 'png'
      const url = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${format}?size=64`
      return { text: '', style: { backgroundImage: `url("${url}")` } }
    }
    const initials = (user.globalName || user.username || 'User')
      .split(' ')
      .map((part) => part.charAt(0))
      .join('')
      .slice(0, 2)
      .toUpperCase()
    return { text: initials, style: {} }
  }, [user])

  return (
    <header className="topbar">
      <div className="topbar__left">
        <button className="topbar__hamburger" type="button" onClick={onToggleSidebar} aria-label="Toggle navigation">
          <span />
          <span />
          <span />
        </button>
        <div>
          <h1 className="topbar__title">Control Center</h1>
          <p className="topbar__subtitle">Manage Doodley for your community with confidence.</p>
        </div>
      </div>
      <div className="topbar__right">
        <div className="topbar__auth">
          {authenticated ? (
            <div className="topbar__profile" data-auth-signed-in>
              <span className="topbar__avatar" data-auth-avatar style={avatar.style}>
                {avatar.text}
              </span>
              <span className="topbar__name" data-auth-username>
                {displayName}
              </span>
              <button type="button" className="button button--ghost" data-auth-logout onClick={logout}>
                Logout
              </button>
            </div>
          ) : (
            oauthEnabled && (
              <a className="button button--primary" href="/auth/login" data-auth-signed-out data-auth-login>
                {loading ? 'Checking access...' : 'Login with Discord'}
              </a>
            )
          )}
        </div>
      </div>
    </header>
  )
}

function AuthOverlay() {
  const { authenticated, oauthEnabled, error, loading } = useAuth()

  if (authenticated) {
    return null
  }

  return (
    <div className="auth-overlay" data-auth-overlay>
      <div className="auth-overlay__panel">
        <img src={logoSrc} alt="Planet Doodley logo" className="auth-overlay__logo" />
        <h2>Log in to manage Doodley</h2>
        <p className="auth-overlay__helper">Use your Discord account to access the control panel.</p>
        {error && <p className="auth-overlay__error">{error}</p>}
        {!oauthEnabled ? (
          <p className="auth-overlay__error">Discord OAuth2 is not configured. Ask an admin to finish setup.</p>
        ) : (
          <a className="button button--primary" href="/auth/login" data-auth-login data-auth-signed-out>
            {loading ? 'Checking access...' : 'Sign in with Discord'}
          </a>
        )}
      </div>
    </div>
  )
}
