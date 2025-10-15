import { useEffect, useMemo, useRef, useState } from 'react'

import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '../authContext.js'

import { useGuild } from '../guildContext.js'



const LOGO_SRC = '/assets/logo.svg'



const NAV_ITEMS = [

  { label: 'Overview', to: '/' },

  { label: 'People', to: '/people' },

  { label: 'Cases', to: '/cases' },

  { label: 'Commands', to: '/commands' },

  { label: 'Moderation', to: '/moderation' },

  { label: 'Insights', to: '/insights' },

  { label: 'Settings', to: '/settings' }

]



const PERIOD_OPTIONS = [

  { label: 'Last 7 days', value: '7d' },

  { label: 'Last 30 days', value: '30d' },

  { label: 'Last 90 days', value: '90d' }

]



export function AppLayout() {

  const location = useLocation()

  const { authenticated } = useAuth()

  const { selectedGuild, guilds } = useGuild()

  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [focusMode, setFocusMode] = useState(true)

  const [searchQuery, setSearchQuery] = useState('')

  const [period, setPeriod] = useState(PERIOD_OPTIONS[1].value)
  const [helpOpen, setHelpOpen] = useState(false)

  const navRef = useRef(null)

  const indicatorRef = useRef(null)



  const activePath = location.pathname || '/'



  useEffect(() => {

    setSidebarOpen(false)

  }, [location.pathname])



  useEffect(() => {

    document.body.classList.toggle('auth-locked', !authenticated)

  }, [authenticated])



  useEffect(() => {

    document.body.classList.toggle('focus-mode', focusMode)

  }, [focusMode])



  const selectedGuildName = selectedGuild?.name ?? 'All servers'



  useEffect(() => {
    if (!helpOpen) {
      return undefined
    }
    const handleClickOutside = (event) => {
      if (document.querySelector('.topbar__help-wrapper')?.contains(event.target)) {
        return
      }
      setHelpOpen(false)
    }
    window.addEventListener('pointerdown', handleClickOutside)
    return () => window.removeEventListener('pointerdown', handleClickOutside)
  }, [helpOpen])

  useEffect(() => {

    const navEl = navRef.current

    const indicator = indicatorRef.current

    if (!navEl || !indicator) return



    const activeLink = navEl.querySelector('a.sidebar__link--active')

    if (!activeLink) {

      indicator.style.opacity = 0

      return

    }

    const navRect = navEl.getBoundingClientRect()

    const linkRect = activeLink.getBoundingClientRect()

    indicator.style.opacity = 1

    indicator.style.transform = `translateY(${linkRect.top - navRect.top + navEl.scrollTop}px)`

    indicator.style.height = `${linkRect.height}px`

  }, [activePath, sidebarOpen])



  return (

    <div className="app-shell">

      <aside className={`sidebar${sidebarOpen ? ' sidebar--open' : ''}`} data-navigation>

        <div className="sidebar__brand">

          <img src={LOGO_SRC} alt="DoodleBot logo" className="sidebar__logo" />

          <div className="sidebar__brand-meta">

            <p className="sidebar__title">DoodleBot</p>

            <p className="sidebar__subtitle">Control Center</p>

          </div>

        </div>

        <nav className="sidebar__nav" ref={navRef} aria-label="Main navigation">

          <span className="sidebar__indicator" ref={indicatorRef} aria-hidden="true" />

          <ul className="sidebar__group">

            {NAV_ITEMS.map((item) => (

              <li key={item.to}>

                <NavLink

                  to={item.to}

                  end={item.to === '/'}

                  className={({ isActive }) =>

                    `sidebar__link${isActive ? ' sidebar__link--active' : ''}`

                  }

                >

                  <span className="sidebar__link-label">{item.label}</span>

                </NavLink>

              </li>

            ))}

          </ul>

        </nav>

        <div className="sidebar__footer">

          <button

            className="sidebar__focus"

            type="button"

            onClick={() => setFocusMode((prev) => !prev)}

          >

            {focusMode ? 'Exit focus mode' : 'Focus mode'}

          </button>

          <p className="sidebar__version">v0.1 � Doodley</p>

        </div>

      </aside>



      <div className="main-area">

        <Topbar

          onToggleSidebar={() => setSidebarOpen((prev) => !prev)}

          searchQuery={searchQuery}

          onSearchChange={setSearchQuery}

          selectedGuildName={selectedGuildName}

          guildCount={guilds?.length ?? 0}

          period={period}

          onPeriodChange={setPeriod}

        />

        <main className="content">

          <Outlet context={{ searchQuery, period, focusMode }} />

        </main>

      </div>

    </div>

  )

}



function Topbar({

  onToggleSidebar,

  searchQuery,

  onSearchChange,

  selectedGuildName,

  guildCount,

  period,

  onPeriodChange

}) {

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

    <header className="topbar" role="banner">

      <div className="topbar__left">

        <button className="topbar__hamburger" type="button" onClick={onToggleSidebar} aria-label="Toggle navigation">

          <span />

          <span />

          <span />

        </button>

        <div className="topbar__search">

          <input

            type="search"

            value={searchQuery}

            onChange={(event) => onSearchChange(event.target.value)}

            placeholder="Search dashboards, people, cases..."

            aria-label="Global search"

          />

        </div>

      </div>

      <div className="topbar__center">

        <button className="topbar__selector" type="button">

          <span className="topbar__selector-label">{selectedGuildName}</span>

          <span className="topbar__selector-meta">{guildCount} connected</span>

        </button>

        <select

          className="topbar__select"

          value={period}

          onChange={(event) => onPeriodChange(event.target.value)}

          aria-label="Date range"

        >

          {PERIOD_OPTIONS.map((option) => (

            <option key={option.value} value={option.value}>

              {option.label}

            </option>

          ))}

        </select>

        <button
          className="topbar__help"
          type="button"
          aria-label="Help and shortcuts"
          title="Open help and shortcuts"
          onClick={() => console.info('Help menu coming soon')}
        >
          <span>Help</span>
        </button>

      </div>

      <div className="topbar__right">

        {authenticated ? (

          <div className="topbar__profile" data-auth-signed-in>

            <span className="topbar__avatar" data-auth-avatar style={avatar.style} aria-hidden={avatar.text.length === 0}>

              {avatar.text}

            </span>

            <span className="topbar__name" data-auth-username>

              {displayName}

            </span>

            <button type="button" className="button button--ghost" data-auth-logout onClick={logout}>

              Logout

            </button>

          </div>

        ) : oauthEnabled ? (

          <a className="button button--primary" href="/auth/login" data-auth-signed-out data-auth-login>

            {loading ? 'Checking access...' : 'Login with Discord'}

          </a>

        ) : null}

      </div>

    </header>

  )

}

