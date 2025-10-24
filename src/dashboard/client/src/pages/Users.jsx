import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '../authContext.js'
import { useGuild } from '../guildContext.js'

const DEFAULT_ROSTER = { results: [], total: 0 }

const STATUS_FILTERS = [
  { value: 'all', label: 'All users' },
  { value: 'pending', label: 'Pending verification' },
  { value: 'approved', label: 'Verified' },
  { value: 'rejected', label: 'Rejected' }
]

const TIMEOUT_PRESETS = [
  { value: 300, label: '5 minutes' },
  { value: 900, label: '15 minutes' },
  { value: 3600, label: '1 hour' },
  { value: 21600, label: '6 hours' },
  { value: 86400, label: '24 hours' },
  { value: 604800, label: '7 days' }
]

const BAN_DELETE_WINDOWS = [
  { value: 0, label: 'Keep messages' },
  { value: 1, label: 'Past day' },
  { value: 3, label: 'Past 3 days' },
  { value: 7, label: 'Past 7 days' }
]

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric'
})

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
})

const RELATIVE_FORMATTER = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

const VERIFICATION_STATE_LABELS = {
  pending: 'Pending verification',
  approved: 'Verified',
  rejected: 'Rejected',
  cancelled: 'Cancelled'
}

const VERIFICATION_ORDER = {
  pending: 0,
  rejected: 1,
  approved: 2,
  cancelled: 3
}

export default function UsersPage() {
  const { user } = useAuth()
  const { selectedGuild } = useGuild()

  const [filters, setFilters] = useState({ search: '', status: 'all' })
  const [roster, setRoster] = useState({ loading: true, data: DEFAULT_ROSTER, error: null })
  const [message, setMessage] = useState(null)
  const [selectedPerson, setSelectedPerson] = useState(null)
  const [drawerState, setDrawerState] = useState({ loading: false, verification: null, history: [], error: null })
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false)
  const [moreActionsOpen, setMoreActionsOpen] = useState(false)
  const [activeAction, setActiveAction] = useState(null)

  const moreActionsRef = useRef(null)
  const [reloadKey, setReloadKey] = useState(0)

  const permissions = useMemo(() => {
    const granted = new Set(user?.permissions ?? [])
    return {
      canManagePeople: granted.has('people:actions'),
      canManageVerification: granted.has('verification:manage'),
      canExport: granted.has('people:import') || granted.has('people:read')
    }
  }, [user])

  const verificationBacklog = useMemo(() => {
    const results = Array.isArray(roster.data?.results) ? roster.data.results : []
    return results.filter((person) => deriveVerificationState(person) === 'pending').length
  }, [roster.data])

  const refreshRoster = useCallback(() => {
    setReloadKey((value) => value + 1)
  }, [])

  const closeMessage = useCallback(() => setMessage(null), [])

  useEffect(() => {
    if (!moreActionsOpen) {
      return
    }
    function handleClick(event) {
      if (moreActionsRef.current && !moreActionsRef.current.contains(event.target)) {
        setMoreActionsOpen(false)
      }
    }
    function handleKeydown(event) {
      if (event.key === 'Escape') {
        setMoreActionsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeydown)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeydown)
    }
  }, [moreActionsOpen])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function loadRoster() {
      setRoster((previous) => ({ ...previous, loading: true, error: null }))

      const params = new URLSearchParams()
      params.set('limit', '250')
      if (selectedGuild?.id) {
        params.set('guildId', selectedGuild.id)
      }

      try {
        const response = await fetch(`/api/people?${params.toString()}`, { signal: controller.signal })
        if (!response.ok) throw new Error(`Request failed with status ${response.status}`)
        const data = await response.json()

        if (cancelled) {
          return
        }

        const rawItems = Array.isArray(data?.results)
          ? data.results
          : Array.isArray(data?.items)
          ? data.items
          : []

        const verificationMap = createVerificationMap(data?.verifications)
        const rosterEntries = rawItems.map((person) =>
          normalizeRosterPerson(person, { guildId: selectedGuild?.id ?? null, verificationMap })
        )

        let combined = rosterEntries.slice()

        if (selectedGuild?.id) {
          try {
            const directoryResponse = await fetch(
              `/api/guilds/${selectedGuild.id}/members?limit=250`,
              { signal: controller.signal }
            )
            if (directoryResponse.ok) {
              const members = await directoryResponse.json()
              const seen = new Set(
                rosterEntries
                  .map((person) => person.discordId ?? person.personId ?? person.id)
                  .filter(Boolean)
                  .map((value) => String(value))
              )
              const directoryEntries = members
                .map((member) => normalizeDirectoryMember(member, { guildId: selectedGuild.id, verificationMap }))
                .filter((entry) => {
                  if (!entry.discordId) {
                    return false
                  }
                  if (seen.has(String(entry.discordId))) {
                    return false
                  }
                  seen.add(String(entry.discordId))
                  return true
                })
              combined = combined.concat(directoryEntries)
            }
          } catch (directoryError) {
            if (directoryError.name !== 'AbortError') {
              console.error('Failed to load directory members', directoryError)
            }
          }
        }

        setRoster({
          loading: false,
          data: { results: combined, total: combined.length, verifications: verificationMap },
          error: null
        })
      } catch (error) {
        if (error.name === 'AbortError') {
          return
        }
        console.error('Failed to load roster', error)
        if (!cancelled) {
          setRoster({ loading: false, data: DEFAULT_ROSTER, error: 'Unable to load users.' })
        }
      }
    }

    loadRoster()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [selectedGuild?.id, reloadKey])

  useEffect(() => {
    if (!selectedPerson) {
      return
    }
    const match = roster.data?.results?.find((person) => person.id === selectedPerson.id)
    if (match) {
      setSelectedPerson((previous) => ({ ...previous, ...match }))
    }
  }, [roster.data, selectedPerson])

  useEffect(() => {
    if (!selectedPerson) {
      setDrawerState({ loading: false, verification: null, history: [], error: null })
      return
    }

    const controller = new AbortController()
    const params = new URLSearchParams()
    if (selectedPerson.guildId) {
      params.set('guildId', selectedPerson.guildId)
    }
    if (selectedPerson.discordId) {
      params.set('memberId', selectedPerson.discordId)
    }

    setDrawerState({ loading: true, verification: null, history: [], error: null })

    fetch(`/api/people/${encodeURIComponent(selectedPerson.personId ?? selectedPerson.id)}/verification?${params.toString()}`, {
      signal: controller.signal
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Status ${response.status}`)
        }
        return response.json()
      })
      .then((data) => {
        setDrawerState({
          loading: false,
          verification: data?.verification ?? null,
          history: Array.isArray(data?.history) ? data.history : [],
          error: null
        })
      })
      .catch((error) => {
        if (error.name === 'AbortError') {
          return
        }
        console.error('Failed to load verification detail', error)
        setDrawerState({ loading: false, verification: null, history: [], error: 'Unable to load verification.' })
      })

    return () => {
      controller.abort()
    }
  }, [selectedPerson])

  const handleSelectPerson = useCallback((person) => {
    setSelectedPerson(person)
  }, [])

  const handleCloseDrawer = useCallback(() => {
    setSelectedPerson(null)
    setDrawerState({ loading: false, verification: null, history: [], error: null })
    setActiveAction(null)
  }, [])

  const executePersonAction = useCallback(
    async (person, action, payload) => {
      if (!permissions.canManagePeople || !person?.personId) {
        return
      }
      const body = {
        action,
        ...payload,
        guildId: person.guildId ?? selectedGuild?.id ?? null,
        memberId: person.discordId ?? null
      }
      const response = await fetch(`/api/people/${encodeURIComponent(person.personId)}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        throw new Error(errorBody?.error ?? `Request failed with status ${response.status}`)
      }
      const result = await response.json().catch(() => ({}))
      refreshRoster()
      if (result?.person && selectedPerson?.id === result.person.id) {
        setSelectedPerson((previous) => ({ ...previous, ...normalizeRosterPerson(result.person, { guildId: previous.guildId, verificationMap: roster.data?.verifications ?? new Map() }) }))
      }
      return result
    },
    [permissions.canManagePeople, refreshRoster, roster.data?.verifications, selectedGuild?.id, selectedPerson?.id]
  )

  const handleModerationAction = useCallback(
    async (action, person, values) => {
      try {
        await executePersonAction(person, action, values)
        setMessage({ type: 'success', text: VERIFICATION_ACTION_MESSAGES[action] ?? 'Action completed.' })
      } catch (error) {
        console.error('Failed to execute action', error)
        setMessage({ type: 'error', text: error.message ?? 'Unable to complete action.' })
      }
    },
    [executePersonAction]
  )

  const handleStartVerification = useCallback(
    async (person) => {
      if (!permissions.canManageVerification || !person) {
        return
      }
      try {
        const params = new URLSearchParams()
        if (selectedGuild?.id) {
          params.set('guildId', selectedGuild.id)
        }
        const response = await fetch(
          `/api/people/${encodeURIComponent(person.personId ?? person.id)}/verify?${params.toString()}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guildId: person.guildId ?? selectedGuild?.id ?? null,
              memberId: person.discordId ?? null
            })
          }
        )
        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}))
          throw new Error(errorBody?.error ?? `Status ${response.status}`)
        }
        const data = await response.json()
        setMessage({ type: 'success', text: data?.created ? 'Verification started.' : 'Verification already in progress.' })
        refreshRoster()
        if (selectedPerson?.id === person.id) {
          setSelectedPerson((previous) => ({ ...previous, verification: data?.verification ?? previous.verification }))
        }
      } catch (error) {
        console.error('Failed to start verification', error)
        setMessage({ type: 'error', text: error.message ?? 'Unable to start verification.' })
      }
    },
    [permissions.canManageVerification, refreshRoster, selectedGuild?.id, selectedPerson?.id]
  )

  const handleExport = useCallback(
    (format) => {
      if (!permissions.canExport) {
        return
      }
      const params = new URLSearchParams({ format })
      if (selectedGuild?.id) {
        params.set('guildId', selectedGuild.id)
      }
      if (filters.search) {
        params.set('search', filters.search)
      }
      const url = `/api/people/export?${params.toString()}`
      window.open(url, '_blank', 'noopener')
    },
    [filters.search, permissions.canExport, selectedGuild?.id]
  )

  const filteredResults = useMemo(() => {
    return Array.isArray(roster.data?.results) ? filterUsers(roster.data.results, filters) : []
  }, [filters, roster.data?.results])

  const hasActiveFilters = filters.status !== 'all'

  return (
    <div className="page users-page">
      <header className="users-page__header">
        <div>
          <h1>Users</h1>
          <p>Review verification answers, approve new members, and take action on verified users.</p>
        </div>
        <div className="users-page__actions">
          {permissions.canExport && (
            <div className="users-actions" ref={moreActionsRef}>
              <button
                type="button"
                className="button button--ghost"
                aria-expanded={moreActionsOpen}
                onClick={() => setMoreActionsOpen((value) => !value)}
              >
                More actions
              </button>
              {moreActionsOpen ? (
                <div className="users-actions__menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => handleExport('csv')}>
                    Export CSV
                  </button>
                  <button type="button" role="menuitem" onClick={() => handleExport('pdf')}>
                    Export PDF
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </header>

      {message ? (
        <div className={`inline-alert inline-alert--${message.type === 'error' ? 'error' : 'success'}`}>
          <span>{message.text}</span>
          <button type="button" className="inline-alert__close" onClick={closeMessage}>
            Dismiss
          </button>
        </div>
      ) : null}

      {verificationBacklog > 0 && (
        <div className="inline-alert inline-alert--info users-page__backlog" role="status">
          <span>
            {verificationBacklog === 1
              ? 'There is 1 member waiting for verification.'
              : `There are ${verificationBacklog} members waiting for verification.`}
          </span>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setFilters((previous) => ({ ...previous, status: 'pending' }))}
          >
            View verification queue
          </button>
        </div>
      )}

      <UsersToolbar
        filters={filters}
        onChange={setFilters}
        onViewQueue={() => setFilters((previous) => ({ ...previous, status: 'pending' }))}
        advancedOpen={advancedFiltersOpen}
        onToggleAdvanced={() => setAdvancedFiltersOpen((value) => !value)}
      />

      {hasActiveFilters ? (
        <div className="users-filter-summary">
          <span>Filters active.</span>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setFilters({ search: '', status: 'all' })}
          >
            Clear filters
          </button>
        </div>
      ) : null}

      <UsersTable
        loading={roster.loading}
        error={roster.error}
        users={filteredResults}
        onSelect={handleSelectPerson}
      />

      {selectedPerson ? (
        <UserDrawer
          person={selectedPerson}
          verificationState={deriveVerificationState({ ...selectedPerson, verification: drawerState.verification ?? selectedPerson.verification })}
          onClose={handleCloseDrawer}
          onStartVerification={handleStartVerification}
          canStartVerification={permissions.canManageVerification}
          canManageActions={permissions.canManagePeople && selectedPerson.personId}
          drawerState={drawerState}
          onOpenAction={setActiveAction}
        />
      ) : null}

      {activeAction && selectedPerson ? (
        <ModerationModal
          action={activeAction}
          person={selectedPerson}
          onClose={() => setActiveAction(null)}
          onSubmit={async (payload) => {
            await handleModerationAction(activeAction, selectedPerson, payload)
            setActiveAction(null)
          }}
        />
      ) : null}
    </div>
  )
}

function UsersToolbar({ filters, onChange, onViewQueue, advancedOpen, onToggleAdvanced }) {
  return (
    <section className="users-toolbar" aria-label="Users filters">
      <div className="users-toolbar__row">
        <input
          type="search"
          className="input users-toolbar__search"
          placeholder="Search by username or tag"
          value={filters.search}
          onChange={(event) => onChange({ ...filters, search: event.target.value })}
        />
        <button type="button" className="button button--primary" onClick={onViewQueue}>
          View verification queue
        </button>
        <button type="button" className="button button--ghost" onClick={onToggleAdvanced}>
          {advancedOpen ? 'Hide filters' : 'Show filters'}
        </button>
      </div>
      {advancedOpen ? (
        <div className="users-toolbar__filters">
          <label>
            <span>Status</span>
            <select
              value={filters.status}
              onChange={(event) => onChange({ ...filters, status: event.target.value })}
            >
              {STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </section>
  )
}

function UsersTable({ loading, error, users, onSelect }) {
  if (loading) {
    return <p className="text-muted">Loading users…</p>
  }
  if (error) {
    return <p className="text-danger">{error}</p>
  }
  if (!users.length) {
    return <p className="users-table__empty">No users match your filters.</p>
  }
  return (
    <div className="table-responsive">
      <table className="users-table">
        <thead>
          <tr>
            <th scope="col">User</th>
            <th scope="col">Verification</th>
            <th scope="col">Account age</th>
            <th scope="col">Timezone</th>
          </tr>
        </thead>
        <tbody>
          {users.map((person) => (
            <tr key={person.id} onClick={() => onSelect(person)}>
              <td>
                <div className="users-table__identity">
                  <Avatar url={person.avatar} name={person.displayName} />
                  <div>
                    <div className="users-table__name">{person.displayName}</div>
                    {person.tag ? <div className="users-table__tag">{person.tag}</div> : null}
                  </div>
                </div>
              </td>
              <td>
                <VerificationBadge state={deriveVerificationState(person)} verification={person.verification} />
              </td>
              <td>{formatRelativeDate(person.accountCreatedAt)}</td>
              <td>{person.timezone ?? 'Unknown'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function UserDrawer({
  person,
  verificationState,
  onClose,
  onStartVerification,
  canStartVerification,
  canManageActions,
  drawerState,
  onOpenAction
}) {
  const responses = normalizeResponses(drawerState.verification?.responses ?? person.verification?.responses)
  const pending = verificationState === 'pending'
  return (
    <aside className="profile-drawer" role="complementary" aria-label={`${person.displayName} profile`}>
      <header className="profile-drawer__header">
        <div>
          <h2>{person.displayName}</h2>
          {person.tag ? <p className="profile-drawer__meta">{person.tag}</p> : null}
        </div>
        <button type="button" className="button button--ghost" onClick={onClose}>
          Close
        </button>
      </header>

      <section className="profile-drawer__section">
        <h3>Account details</h3>
        <dl className="users-drawer__meta-grid">
          <DetailItem label="Verification status" value={<VerificationBadge state={verificationState} verification={drawerState.verification ?? person.verification} expanded />} />
          <DetailItem label="Account created" value={formatDate(person.accountCreatedAt)} />
          <DetailItem label="Joined server" value={formatDate(person.joinedAt)} />
          <DetailItem label="Last seen" value={formatDate(person.lastSeenAt)} />
          <DetailItem label="Timezone" value={person.timezone ?? 'Unknown'} />
        </dl>
      </section>

      <section className="profile-drawer__section">
        <h3>Verification responses</h3>
        {drawerState.loading ? (
          <p>Loading responses…</p>
        ) : drawerState.error ? (
          <p className="text-danger">{drawerState.error}</p>
        ) : responses.length === 0 ? (
          <p>No verification responses recorded.</p>
        ) : (
          <ul className="users-responses">
            {responses.map((entry) => (
              <li key={entry.id}>
                <strong className="users-responses__question">{entry.question}</strong>
                <p className="users-responses__answer">{entry.answer}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="profile-drawer__section">
        <h3>Actions</h3>
        {pending ? (
          <div className="users-drawer__actions">
            {canStartVerification ? (
              <button type="button" className="button button--primary" onClick={() => onStartVerification(person)}>
                Start verification
              </button>
            ) : (
              <p className="text-muted">You do not have permission to start verification.</p>
            )}
          </div>
        ) : canManageActions ? (
          <div className="users-drawer__actions users-drawer__actions--grid">
            <button type="button" className="button button--ghost" onClick={() => onOpenAction('warn')}>
              Warn
            </button>
            <button type="button" className="button button--ghost" onClick={() => onOpenAction('timeout')}>
              Timeout
            </button>
            <button type="button" className="button button--ghost" onClick={() => onOpenAction('kick')}>
              Kick
            </button>
            <button type="button" className="button button--ghost" onClick={() => onOpenAction('ban')}>
              Ban
            </button>
            <button type="button" className="button button--ghost" onClick={() => onOpenAction('note')}>
              Add note
            </button>
            <button type="button" className="button button--ghost" onClick={() => onOpenAction('dm')}>
              Send DM
            </button>
          </div>
        ) : (
          <p className="text-muted">Moderation actions become available after verification.</p>
        )}
      </section>
    </aside>
  )
}

function ModerationModal({ action, person, onClose, onSubmit }) {
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState(createDefaultActionForm())
  const title = MODERATION_TITLES[action] ?? 'Moderation action'

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    try {
      await onSubmit(mapFormToPayload(action, form))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal title={`${title} for ${person.displayName}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="users-modal__form">
        {rendersReasonField(action) ? (
          <label>
            <span>Reason</span>
            <textarea
              required={action !== 'dm' && action !== 'note'}
              value={form.reason}
              onChange={(event) => setForm({ ...form, reason: event.target.value })}
            />
          </label>
        ) : null}

        {action === 'timeout' ? (
          <label>
            <span>Duration</span>
            <select
              value={form.durationSec}
              onChange={(event) => setForm({ ...form, durationSec: Number(event.target.value) })}
              required
            >
              {TIMEOUT_PRESETS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {action === 'ban' ? (
          <label>
            <span>Delete recent messages</span>
            <select
              value={form.deleteMessageDays}
              onChange={(event) => setForm({ ...form, deleteMessageDays: Number(event.target.value) })}
            >
              {BAN_DELETE_WINDOWS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {(action === 'dm' || action === 'note') && (
          <label>
            <span>{action === 'dm' ? 'Message' : 'Note'}</span>
            <textarea
              required
              value={form.message}
              onChange={(event) => setForm({ ...form, message: event.target.value })}
            />
          </label>
        )}

        {supportsDmToggle(action) ? (
          <label className="users-modal__checkbox">
            <input
              type="checkbox"
              checked={form.dmUser}
              onChange={(event) => setForm({ ...form, dmUser: event.target.checked })}
            />
            <span>Send DM to user</span>
          </label>
        ) : null}

        <footer className="users-modal__footer">
          <button type="button" className="button button--ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

function Modal({ title, children, onClose }) {
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header className="modal__header">
          <h2 id="modal-title">{title}</h2>
          <button type="button" className="button button--ghost" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  )
}

function Avatar({ url, name }) {
  if (url) {
    return <img src={url} alt={name} className="users-table__avatar" />
  }
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return (
    <span className="users-table__avatar users-table__avatar--fallback" aria-hidden>
      {initials || '?'}
    </span>
  )
}

function VerificationBadge({ state, verification, expanded = false }) {
  const normalized = state ?? deriveVerificationState({ verification })
  const label = VERIFICATION_STATE_LABELS[normalized] ?? normalized
  const decidedAt = verification?.decidedAt ?? verification?.updatedAt ?? null
  return (
    <span className={`users-badge users-badge--${normalized}`}>
      {label}
      {expanded && decidedAt ? <span className="users-badge__meta">{formatDateTime(decidedAt)}</span> : null}
    </span>
  )
}

function DetailItem({ label, value }) {
  return (
    <div className="users-drawer__meta-item">
      <dt>{label}</dt>
      <dd>{value ?? '—'}</dd>
    </div>
  )
}

const MODERATION_TITLES = {
  warn: 'Warn user',
  timeout: 'Timeout user',
  kick: 'Kick user',
  ban: 'Ban user',
  note: 'Add note',
  dm: 'Send DM'
}

const VERIFICATION_ACTION_MESSAGES = {
  warn: 'Warning recorded.',
  timeout: 'Timeout issued.',
  kick: 'Member kicked.',
  ban: 'Member banned.',
  note: 'Note added.',
  dm: 'Message sent.'
}

function createDefaultActionForm() {
  return {
    reason: '',
    durationSec: TIMEOUT_PRESETS[1]?.value ?? 900,
    deleteMessageDays: BAN_DELETE_WINDOWS[0].value,
    dmUser: true,
    message: ''
  }
}

function mapFormToPayload(action, form) {
  switch (action) {
    case 'warn':
      return { reason: form.reason, dmUser: form.dmUser }
    case 'timeout':
      return { reason: form.reason, dmUser: form.dmUser, durationSec: form.durationSec }
    case 'kick':
      return { reason: form.reason, dmUser: form.dmUser }
    case 'ban':
      return {
        reason: form.reason,
        dmUser: form.dmUser,
        deleteMessageDays: form.deleteMessageDays
      }
    case 'note':
      return { message: form.message }
    case 'dm':
      return { message: form.message, dmUser: true }
    default:
      return {}
  }
}

function supportsDmToggle(action) {
  return ['warn', 'timeout', 'kick', 'ban'].includes(action)
}

function rendersReasonField(action) {
  return ['warn', 'timeout', 'kick', 'ban'].includes(action)
}

function createVerificationMap(source) {
  const map = new Map()
  if (!source || typeof source !== 'object') {
    return map
  }
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object') {
      map.set(String(key), value)
    }
  }
  return map
}

function normalizeRosterPerson(person, { guildId, verificationMap }) {
  const discordId = person.discordId ?? person.discord_id ?? null
  const verification = person.verification ?? (discordId ? verificationMap.get(String(discordId)) ?? null : null)
  const displayName = person.displayName ?? person.username ?? person.name ?? `Member ${person.id ?? ''}`
  return {
    id: person.id ?? person.memberId ?? person.member_id ?? discordId ?? displayName,
    personId: person.id ?? person.memberId ?? person.member_id ?? null,
    guildId: person.guildId ?? person.guild_id ?? guildId ?? null,
    displayName,
    tag: person.discordTag ?? person.discord_tag ?? null,
    avatar: person.avatar ?? null,
    discordId,
    verification,
    rosterStatus: (person.status ?? 'active').toLowerCase(),
    accountCreatedAt: person.accountCreatedAt ?? person.createdAt ?? person.firstSeenAt ?? person.joinedAt ?? null,
    firstSeenAt: person.firstSeenAt ?? null,
    joinedAt: person.joinedAt ?? null,
    lastSeenAt: person.lastSeenAt ?? null,
    timezone: person.timezone ?? null,
    source: 'roster'
  }
}

function normalizeDirectoryMember(member, { guildId, verificationMap }) {
  const verification = member.id ? verificationMap.get(String(member.id)) ?? null : null
  return {
    id: `discord:${member.id}`,
    personId: null,
    guildId,
    displayName: member.displayName ?? member.username ?? member.tag ?? `Member ${member.id}`,
    tag: member.tag ?? null,
    avatar: member.avatar ?? null,
    discordId: member.id ?? null,
    verification,
    rosterStatus: 'not_onboarded',
    accountCreatedAt: member.createdAt ?? null,
    joinedAt: member.joinedAt ?? null,
    lastSeenAt: null,
    timezone: null,
    source: 'directory'
  }
}

function filterUsers(users, filters) {
  const search = filters.search.trim().toLowerCase()
  let filtered = users.slice()
  if (search) {
    filtered = filtered.filter((person) => {
      const name = (person.displayName ?? '').toLowerCase()
      const tag = (person.tag ?? '').toLowerCase()
      return name.includes(search) || tag.includes(search)
    })
  }
  if (filters.status && filters.status !== 'all') {
    filtered = filtered.filter((person) => {
      const state = deriveVerificationState(person)
      if (filters.status === 'pending') {
        return state === 'pending'
      }
      return state === filters.status
    })
  }
  return filtered.sort((a, b) => {
    const leftState = deriveVerificationState(a)
    const rightState = deriveVerificationState(b)
    const leftOrder = VERIFICATION_ORDER[leftState] ?? 99
    const rightOrder = VERIFICATION_ORDER[rightState] ?? 99
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder
    }
    const leftName = (a.displayName ?? '').toLowerCase()
    const rightName = (b.displayName ?? '').toLowerCase()
    if (leftName < rightName) return -1
    if (leftName > rightName) return 1
    return 0
  })
}

function deriveVerificationState(person) {
  const state = (person?.verification?.state ?? '').toLowerCase()
  if (state === 'approved' || state === 'rejected') {
    return state
  }
  if (state === 'pending' || state === 'cancelled') {
    return state === 'cancelled' ? 'pending' : 'pending'
  }
  const status = (person?.rosterStatus ?? person?.status ?? '').toLowerCase()
  if (status === 'not_onboarded' || status === 'onboarding') {
    return 'pending'
  }
  return 'approved'
}

function normalizeResponses(responses) {
  if (!responses) {
    return []
  }
  if (Array.isArray(responses)) {
    return responses.map((entry, index) => ({
      id: entry.id ?? index,
      question: entry.question ?? entry.prompt ?? entry.title ?? `Question ${index + 1}`,
      answer: normalizeResponseValue(entry.answer ?? entry.response ?? entry.value ?? '')
    }))
  }
  if (typeof responses === 'object') {
    return Object.entries(responses).map(([key, value], index) => ({
      id: key ?? index,
      question: value?.question ?? value?.prompt ?? key,
      answer: normalizeResponseValue(value?.answer ?? value?.response ?? value ?? '')
    }))
  }
  return []
}

function normalizeResponseValue(value) {
  if (Array.isArray(value)) {
    return value.join(', ')
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value, null, 2)
  }
  return String(value ?? '')
}

function formatRelativeDate(value) {
  if (!value) {
    return 'Unknown'
  }
  try {
    const date = new Date(value)
    const diffMs = date.getTime() - Date.now()
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
    if (Math.abs(diffDays) >= 1) {
      return formatRelative(diffDays, 'day', date)
    }
    const diffHours = Math.round(diffMs / (1000 * 60 * 60))
    return formatRelative(diffHours, 'hour', date)
  } catch {
    return value
  }
}

function formatRelative(amount, unit, date) {
  try {
    const now = Date.now()
    const diff = date.getTime() - now
    const divisions = {
      year: 1000 * 60 * 60 * 24 * 365,
      month: 1000 * 60 * 60 * 24 * 30,
      day: 1000 * 60 * 60 * 24,
      hour: 1000 * 60 * 60,
      minute: 1000 * 60
    }
    const divisor = divisions[unit]
    if (!divisor) {
      return RELATIVE_FORMATTER.format(amount, unit)
    }
    const value = Math.round(diff / divisor)
    return RELATIVE_FORMATTER.format(value, unit)
  } catch {
    return DATE_FORMATTER.format(date)
  }
}

function formatDate(value) {
  if (!value) {
    return 'Unknown'
  }
  try {
    return DATE_FORMATTER.format(new Date(value))
  } catch {
    return value
  }
}

function formatDateTime(value) {
  if (!value) {
    return null
  }
  try {
    return DATE_TIME_FORMATTER.format(new Date(value))
  } catch {
    return value
  }
}
