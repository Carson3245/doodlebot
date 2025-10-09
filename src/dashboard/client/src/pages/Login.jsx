import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../authContext.js'
import logoSrc from '../assets/logo.svg'

export default function LoginPage() {
  const navigate = useNavigate()
  const { authenticated, loading, oauthEnabled } = useAuth()

  useEffect(() => {
    if (!loading && authenticated) {
      navigate('/')
    }
  }, [authenticated, loading, navigate])

  useEffect(() => {
    document.body.classList.add('auth-page-active')
    return () => {
      document.body.classList.remove('auth-page-active')
    }
  }, [])

  return (
    <div className="page auth-page">
      <div className="auth-card">
        <div className="auth-card__logo">
          <img src={logoSrc} alt="Planet Doodle logo" />
        </div>
        <h1 className="auth-card__title">Welcome back</h1>
        <p className="auth-card__subtitle">Sign in with your Discord account to manage your servers.</p>
        <div className="auth-card__actions">
          {oauthEnabled ? (
            <a className="button button--primary button--lg" href="/auth/login">Continue with Discord</a>
          ) : (
            <p className="auth-card__error">Discord OAuth is not configured for this dashboard.</p>
          )}
        </div>
      </div>
    </div>
  )
}
