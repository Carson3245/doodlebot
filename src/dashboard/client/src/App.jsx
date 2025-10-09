import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/Layout.jsx'
import DashboardPage from './pages/Dashboard.jsx'
import SettingsPage from './pages/Settings.jsx'
import CommandsPage from './pages/Commands.jsx'
import LogsPage from './pages/Logs.jsx'
import ModerationPage from './pages/Moderation.jsx'
import GuildSelectionPage from './pages/GuildSelection.jsx'
import LoginPage from './pages/Login.jsx'
import { useAuth } from './authContext.js'
import { useGuild } from './guildContext.js'

function AuthGuard() {
  const { loading, authenticated } = useAuth()
  if (loading) {
    return <div className="page-placeholder">Checking session...</div>
  }
  if (!authenticated) {
    return <Navigate to="/login" replace />
  }
  return <Outlet />
}

function GuildGuard() {
  const { loading, selectedGuild } = useGuild()
  if (loading) {
    return <div className="page-placeholder">Loading guilds...</div>
  }
  if (!selectedGuild) {
    return <Navigate to="/guilds" replace />
  }
  return <Outlet />
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AuthGuard />}>
        <Route path="/guilds" element={<GuildSelectionPage />} />
        <Route element={<GuildGuard />}>
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/commands" element={<CommandsPage />} />
            <Route path="/moderation" element={<ModerationPage />} />
            <Route path="/logs" element={<LogsPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
