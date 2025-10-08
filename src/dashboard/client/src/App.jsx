import { Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/Layout.jsx'
import DashboardPage from './pages/Dashboard.jsx'
import SettingsPage from './pages/Settings.jsx'
import CommandsPage from './pages/Commands.jsx'
import LogsPage from './pages/Logs.jsx'
import ModerationPage from './pages/Moderation.jsx'

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/commands" element={<CommandsPage />} />
        <Route path="/moderation" element={<ModerationPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="*" element={<DashboardPage />} />
      </Route>
    </Routes>
  )
}

export default App
