import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './styles.css'
import { AuthProvider } from './auth.jsx'
import { GuildProvider } from './guild.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <GuildProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </GuildProvider>
    </AuthProvider>
  </StrictMode>,
)
