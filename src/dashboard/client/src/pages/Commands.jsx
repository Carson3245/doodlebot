import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth.jsx'

export default function CommandsPage() {
  const { authenticated, refreshAuth } = useAuth()
  const [commands, setCommands] = useState({ loading: true, items: [], error: null })
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [saving, setSaving] = useState({})

  useEffect(() => {
    if (!authenticated) {
      setCommands({ loading: false, items: [], error: null })
      return
    }

    let active = true
    const loadCommands = async () => {
      try {
        const response = await fetch('/api/commands')
        if (response.status === 401) {
          refreshAuth()
          return
        }
        if (!response.ok) {
          throw new Error('Failed to load commands')
        }
        const data = await response.json()
        if (!active) return
        setCommands({ loading: false, items: Array.isArray(data) ? data : [], error: null })
      } catch (error) {
        console.error('Failed to load commands', error)
        if (!active) return
        setCommands({ loading: false, items: [], error: 'Could not load commands.' })
      }
    }

    loadCommands()
    return () => {
      active = false
    }
  }, [authenticated, refreshAuth])

  const categories = useMemo(() => {
    const set = new Set(commands.items.map((command) => command.category || 'General'))
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [commands.items])

  const filteredCommands = useMemo(() => {
    let items = commands.items
    if (categoryFilter !== 'all') {
      items = items.filter((command) => (command.category || 'General') === categoryFilter)
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      items = items.filter(
        (command) =>
          command.name.toLowerCase().includes(q) || (command.description || '').toLowerCase().includes(q)
      )
    }
    return items
  }, [commands.items, categoryFilter, search])

  const stats = useMemo(() => {
    const total = commands.items.length
    const enabled = commands.items.filter((command) => command.enabled !== false).length
    return {
      total,
      enabled,
      disabled: total - enabled
    }
  }, [commands.items])

  const handleUpdate = async (name, payload) => {
    setSaving((prev) => ({ ...prev, [name]: true }))
    try {
      const response = await fetch(`/api/commands/${name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (response.status === 401) {
        refreshAuth()
        return
      }
      if (!response.ok) {
        throw new Error('Failed to update command')
      }
      const updated = await response.json()
      setCommands((prev) => ({
        ...prev,
        items: prev.items.map((command) =>
          command.name === name
            ? {
                ...command,
                enabled: updated.enabled !== undefined ? updated.enabled : command.enabled,
                customCooldown:
                  updated.cooldown !== undefined ? (updated.cooldown === null ? null : updated.cooldown) : command.customCooldown,
                category: updated.category ?? command.category,
                notes: updated.notes ?? command.notes
              }
            : command
        )
      }))
    } catch (error) {
      console.error('Failed to update command configuration', error)
      alert('Could not update command configuration. Check the server logs.')
    } finally {
      setSaving((prev) => ({ ...prev, [name]: false }))
    }
  }

  return (
    <>
      <section className="panel">
        <header className="panel__header">
          <div>
            <h2>Slash commands</h2>
            <p>Enable, categorize, and adjust cooldowns for the registered commands.</p>
          </div>
        </header>
        <div className="panel__body command-controls">
          <div className="command-stats">
            <div>
              <span className="stat-label">Total</span>
              <span className="stat-value">{stats.total}</span>
            </div>
            <div>
              <span className="stat-label">Enabled</span>
              <span className="stat-value">{stats.enabled}</span>
            </div>
            <div>
              <span className="stat-label">Disabled</span>
              <span className="stat-value">{stats.disabled}</span>
            </div>
          </div>
          <div className="command-filters">
            <input
              type="search"
              placeholder="Search commands..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="all">All categories</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="panel__body">
          {commands.loading ? (
            <div className="placeholder">Loading commands...</div>
          ) : commands.error ? (
            <div className="placeholder">{commands.error}</div>
          ) : filteredCommands.length === 0 ? (
            <div className="placeholder">No commands match your filters.</div>
          ) : (
            <div className="command-grid">
              {filteredCommands.map((command) => (
                <CommandCard
                  key={command.name}
                  command={command}
                  saving={Boolean(saving[command.name])}
                  onUpdate={handleUpdate}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <header className="panel__header">
          <div>
            <h2>Ideas</h2>
            <p>Extend this view with toggles or a deploy button once authentication is ready.</p>
          </div>
        </header>
        <div className="panel__body">
          <ul className="bullet-list">
            <li>Allow admins to enable/disable slash commands per guild.</li>
            <li>Push command updates without a full restart.</li>
            <li>Track how often each command runs (pair with the Logs page).</li>
          </ul>
        </div>
      </section>
    </>
  )
}

function CommandCard({ command, saving, onUpdate }) {
  const [local, setLocal] = useState({
    enabled: command.enabled !== false,
    customCooldown: command.customCooldown ?? '',
    category: command.category || 'General',
    notes: command.notes ?? ''
  })

  useEffect(() => {
    setLocal({
      enabled: command.enabled !== false,
      customCooldown: command.customCooldown ?? '',
      category: command.category || 'General',
      notes: command.notes ?? ''
    })
  }, [command.enabled, command.customCooldown, command.category, command.notes])

  const handleToggle = () => {
    const next = !local.enabled
    setLocal((prev) => ({ ...prev, enabled: next }))
    onUpdate(command.name, { enabled: next })
  }

  const handleBlur = () => {
    const payload = {
      enabled: local.enabled,
      customCooldown:
        local.customCooldown === '' || local.customCooldown === null
          ? null
          : Number(local.customCooldown),
      category: local.category,
      notes: local.notes
    }
    onUpdate(command.name, payload)
  }

  return (
    <article className={`command-card${local.enabled ? '' : ' command-card--disabled'}`}>
      <header className="command-card__header">
        <div>
          <strong>/{command.name}</strong>
          <span className="command-card__category">{local.category}</span>
        </div>
        <button
          type="button"
          className={`toggle ${local.enabled ? 'toggle--on' : 'toggle--off'}`}
          onClick={handleToggle}
          aria-pressed={local.enabled}
        >
          <span />
        </button>
      </header>
      <p className="command-card__description">{command.description || 'No description provided.'}</p>
      <div className="command-card__meta">
        <div>
          <span className="meta-label">Default cooldown</span>
          <span className="meta-value">{command.cooldown ?? 0}s</span>
        </div>
        <div>
          <span className="meta-label">Custom cooldown</span>
          <input
            type="number"
            min="0"
            placeholder="inherit"
            value={local.customCooldown === '' || local.customCooldown === null ? '' : local.customCooldown}
            onChange={(event) =>
              setLocal((prev) => ({
                ...prev,
                customCooldown: event.target.value
              }))
            }
            onBlur={handleBlur}
          />
        </div>
      </div>
      <div className="command-card__meta">
        <div>
          <span className="meta-label">Category</span>
          <input
            type="text"
            value={local.category}
            onChange={(event) => setLocal((prev) => ({ ...prev, category: event.target.value }))}
            onBlur={handleBlur}
          />
        </div>
        <div>
          <span className="meta-label">Usage (lifetime)</span>
          <span className="meta-value">{command.usage ?? 0}</span>
        </div>
      </div>
      <label className="meta-label" htmlFor={`notes-${command.name}`}>
        Notes
      </label>
      <textarea
        id={`notes-${command.name}`}
        rows={2}
        placeholder="Internal notes or deployment reminders."
        value={local.notes}
        onChange={(event) => setLocal((prev) => ({ ...prev, notes: event.target.value }))}
        onBlur={handleBlur}
      />
      {saving && <span className="command-card__saving">Saving...</span>}
    </article>
  )
}
