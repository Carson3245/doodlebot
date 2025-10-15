import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../authContext.js'
import { useGuild } from '../guildContext.js'

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'offboarded', label: 'Offboarded' }
]

const STATUS_LABELS = {
  active: 'Active',
  onboarding: 'Onboarding',
  inactive: 'Inactive',
  offboarded: 'Offboarded'
}

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric'
})

const TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
})

const RELATIVE_FORMATTER = new Intl.RelativeTimeFormat('en', { style: 'short' })

const CHECKIN_LABELS = {
  '7d': '7 day',
  '30d': '30 day',
  '90d': '90 day'
}

const DEFAULT_ROSTER = { results: [], total: 0 }

export default function PeoplePage() {
  const { user } = useAuth()
  const { selectedGuild } = useGuild()

  const [filters, setFilters] = useState({ status: 'all', department: 'all', search: '' })
  const [roster, setRoster] = useState({ loading: true, data: DEFAULT_ROSTER, error: null })
  const [summary, setSummary] = useState({ loading: true, data: null, error: null })
  const [dueCheckins, setDueCheckins] = useState({ loading: true, data: [], error: null })
  const [reloadKey, setReloadKey] = useState(0)
  const [message, setMessage] = useState(null)

  const [selectedPerson, setSelectedPerson] = useState(null)
  const [drawerCheckins, setDrawerCheckins] = useState({ loading: false, data: [], error: null })
  const [drawerCases, setDrawerCases] = useState({ loading: false, data: [], error: null })
  const [activeModal, setActiveModal] = useState(null)
  const [modalContext, setModalContext] = useState(null)

  const permissions = useMemo(() => {
    const granted = new Set(user?.permissions ?? [])
    return {
      manage: granted.has('people:manage'),
      import: granted.has('people:import'),
      announce: granted.has('people:announce'),
      rolesync: granted.has('people:rolesync'),
      offboard: granted.has('people:offboard'),
      checkinsRead: granted.has('checkins:read'),
      checkinsUpdate: granted.has('checkins:update')
    }
  }, [user])

  const refreshRoster = useCallback(() => {
    setReloadKey((value) => value + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function loadRoster() {
      setRoster((previous) => ({ ...previous, loading: true, error: null }))
      const params = new URLSearchParams()
      if (filters.status && filters.status !== 'all') {
        params.set('status', filters.status)
      }
      if (filters.department && filters.department !== 'all') {
        params.set('department', filters.department)
      }
      if (filters.search) {
        params.set('search', filters.search)
      }
      if (selectedGuild?.id) {
        params.set('guildId', selectedGuild.id)
      }
      try {
        const response = await fetch(`/api/people?${params.toString()}`, { signal: controller.signal })
        if (!response.ok) throw new Error(`Request failed with status ${response.status}`)
        const data = await response.json()
        if (!cancelled) {
          setRoster({ loading: false, data: data ?? DEFAULT_ROSTER, error: null })
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          return
        }
        console.error('Failed to load roster', error)
        if (!cancelled) {
          setRoster({ loading: false, data: DEFAULT_ROSTER, error: 'Unable to load roster.' })
        }
      }
    }

    loadRoster()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [filters, selectedGuild?.id, reloadKey])

  useEffect(() => {
    if (!permissions.checkinsRead) {
      setDueCheckins({ loading: false, data: [], error: null })
      return
    }
    const controller = new AbortController()
    let cancelled = false

    async function loadDue() {
      setDueCheckins((previous) => ({ ...previous, loading: true, error: null }))
      try {
        const response = await fetch('/api/people/checkins/due?withinHours=168&includeMissed=true', {
          signal: controller.signal
        })
        if (!response.ok) throw new Error(`Status ${response.status}`)
        const payload = await response.json()
        if (!cancelled) {
          setDueCheckins({ loading: false, data: payload?.results ?? [], error: null })
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          return
        }
        console.error('Failed to load due check-ins', error)
        if (!cancelled) {
          setDueCheckins({ loading: false, data: [], error: 'Unable to load check-ins.' })
        }
      }
    }

    loadDue()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [permissions.checkinsRead, reloadKey])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function loadSummary() {
      setSummary((previous) => ({ ...previous, loading: true, error: null }))
      try {
        const response = await fetch('/api/people/summary', { signal: controller.signal })
        if (!response.ok) throw new Error(`Status ${response.status}`)
        const data = await response.json()
        if (!cancelled) {
          setSummary({ loading: false, data, error: null })
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          return
        }
        console.error('Failed to load people summary', error)
        if (!cancelled) {
          setSummary({ loading: false, data: null, error: 'Unable to load summary.' })
        }
      }
    }

    loadSummary()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  useEffect(() => {
    if (!selectedPerson) {
      return
    }
    const match = roster.data?.results?.find((person) => person.id === selectedPerson.id)
    if (match) {
      setSelectedPerson((previous) => ({ ...previous, ...match }))
    }
  }, [roster.data, selectedPerson?.id])

  const handleAnnounce = useCallback(
    async (person) => {
      if (!permissions.announce) {
        return
      }
      try {
        const response = await fetch(`/api/people/${person.id}/actions/announce`, { method: 'POST' })
        if (!response.ok) throw new Error(`Status ${response.status}`)
        setMessage({ type: 'success', text: `Announcement queued for ${person.displayName}.` })
        refreshRoster()
      } catch (error) {
        console.error('Failed to mark announcement', error)
        setMessage({ type: 'error', text: 'Unable to trigger announcement.' })
      }
    },
    [permissions.announce, refreshRoster]
  )

  const handleRoleSync = useCallback(
    async (person) => {
      if (!permissions.rolesync) {
        return
      }
      try {
        const response = await fetch(`/api/people/${person.id}/actions/rolesync`, { method: 'POST' })
        if (!response.ok) throw new Error(`Status ${response.status}`)
        setMessage({ type: 'success', text: `Role sync requested for ${person.displayName}.` })
        refreshRoster()
      } catch (error) {
        console.error('Failed to sync roles', error)
        setMessage({ type: 'error', text: 'Unable to sync roles right now.' })
      }
    },
    [permissions.rolesync, refreshRoster]
  )

  const handleOpenOffboard = useCallback(
    (person) => {
      if (!permissions.offboard) {
        return
      }
      setActiveModal('offboard')
      setModalContext({ person })
    },
    [permissions.offboard]
  )

  const handleSelectPerson = useCallback(
    (person) => {
      setSelectedPerson(person)
      if (permissions.checkinsRead) {
        setDrawerCheckins({ loading: true, data: [], error: null })
        fetch(`/api/people/${person.id}/checkins`)
          .then(async (response) => {
            if (!response.ok) throw new Error(`Status ${response.status}`)
            const data = await response.json()
            setDrawerCheckins({ loading: false, data: data?.checkins ?? [], error: null })
          })
          .catch((error) => {
            console.error('Failed to load checkins for person', error)
            setDrawerCheckins({ loading: false, data: [], error: 'Unable to load check-ins.' })
          })
      } else {
        setDrawerCheckins({ loading: false, data: [], error: null })
      }

      if (person.guildId) {
        setDrawerCases({ loading: true, data: [], error: null })
        fetch(`/api/moderation/cases?guildId=${person.guildId}&status=open&limit=6`)
          .then(async (response) => {
            if (!response.ok) throw new Error(`Status ${response.status}`)
            const data = await response.json()
            setDrawerCases({ loading: false, data: Array.isArray(data) ? data : [], error: null })
          })
          .catch((error) => {
            console.error('Failed to load case history', error)
            setDrawerCases({ loading: false, data: [], error: 'Unable to load case history.' })
          })
      } else {
        setDrawerCases({ loading: false, data: [], error: null })
      }
    },
    [permissions.checkinsRead]
  )

  const handleCloseDrawer = useCallback(() => {
    setSelectedPerson(null)
    setDrawerCheckins({ loading: false, data: [], error: null })
    setDrawerCases({ loading: false, data: [], error: null })
  }, [])

  const handleRecordCheckin = useCallback(
    async ({ personId, cadence, status, notes }) => {
      if (!permissions.checkinsUpdate) {
        return
      }
      try {
        const response = await fetch(`/api/people/${personId}/checkins/${cadence}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, notes })
        })
        if (!response.ok) throw new Error(`Status ${response.status}`)
        const data = await response.json()
        const updatedCheckins = data?.checkins ?? []
        setDrawerCheckins({ loading: false, data: updatedCheckins, error: null })
        if (data?.person) {
          setSelectedPerson((previous) =>
            previous && previous.id === data.person.id ? { ...previous, ...data.person } : previous
          )
        }
        setMessage({ type: 'success', text: 'Check-in updated.' })
        refreshRoster()
      } catch (error) {
        console.error('Failed to update check-in', error)
        setMessage({ type: 'error', text: 'Unable to update check-in.' })
      }
    },
    [permissions.checkinsUpdate, refreshRoster]
  )

  const openModal = useCallback((name, context = null) => {
    setActiveModal(name)
    setModalContext(context)
  }, [])

  const closeModal = useCallback(() => {
    setActiveModal(null)
    setModalContext(null)
  }, [])

  return (
    <div className="page people-page">
      <header className="page__header">
        <div>
          <h1>People</h1>
          <p>Track onboarding, departments, and upcoming check-ins.</p>
        </div>
        <div className="page__header-actions">
          {permissions.manage && (
            <button type="button" className="button button--primary" onClick={() => openModal('add')}>
              Add person
            </button>
          )}
          {permissions.import && (
            <button type="button" className="button button--ghost" onClick={() => openModal('import')}>
              Import CSV
            </button>
          )}
          {permissions.checkinsRead && (
            <button type="button" className="button button--ghost" onClick={() => openModal('onboarding')}>
              Onboarding checklist
            </button>
          )}
        </div>
      </header>

      <section className="panel people-summary" aria-live="polite">
        {summary.loading ? (
          <p>Calculating roster snapshot…</p>
        ) : summary.error ? (
          <p className="text-danger">{summary.error}</p>
        ) : summary.data ? (
          <div className="summary-grid">
            <SummaryMetric label="Total" value={summary.data.total} />
            <SummaryMetric label="Active" value={summary.data.active} />
            <SummaryMetric label="Onboarding" value={summary.data.onboarding} />
            <SummaryMetric label="Offboarded" value={summary.data.offboarded} />
          </div>
        ) : null}
      </section>

      <PeopleToolbar filters={filters} onChange={setFilters} />

      {message && (
        <div className={`inline-alert inline-alert--${message.type}`} role="status">
          <span>{message.text}</span>
          <button type="button" className="inline-alert__close" onClick={() => setMessage(null)}>
            Dismiss
          </button>
        </div>
      )}

      <section className="panel roster-panel" aria-live="polite">
        {roster.loading ? (
          <div className="table-placeholder">Loading roster…</div>
        ) : roster.error ? (
          <div className="table-placeholder table-placeholder--error">
            <p>{roster.error}</p>
            <button type="button" className="button button--ghost" onClick={refreshRoster}>
              Try again
            </button>
          </div>
        ) : roster.data.results.length === 0 ? (
          <div className="table-placeholder">
            <p>No profiles match these filters.</p>
            <button type="button" className="button button--ghost" onClick={() => setFilters({ status: 'all', department: 'all', search: '' })}>
              Reset filters
            </button>
          </div>
        ) : (
          <table className="people-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Department</th>
                <th scope="col">Status</th>
                <th scope="col">Next check-in</th>
                <th scope="col">Last check-in</th>
                <th scope="col" className="people-table__actions-heading">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {roster.data.results.map((person) => (
                <tr key={person.id}>
                  <td>
                    <button type="button" className="link-button" onClick={() => handleSelectPerson(person)}>
                      <span className="people-table__name">{person.displayName}</span>
                      {person.title && <span className="people-table__sub">{person.title}</span>}
                    </button>
                  </td>
                  <td>{person.department ?? '—'}</td>
                  <td>
                    <StatusBadge status={person.status} />
                  </td>
                  <td>{formatCheckin(person.checkins?.next)}</td>
                  <td>{formatCompleted(person.checkins?.lastCompleted)}</td>
                  <td>
                    <div className="people-table__actions">
                      <button
                        type="button"
                        className="button button--ghost"
                        disabled={!permissions.announce}
                        onClick={() => handleAnnounce(person)}
                      >
                        Announce
                      </button>
                      <button
                        type="button"
                        className="button button--ghost"
                        disabled={!permissions.rolesync}
                        onClick={() => handleRoleSync(person)}
                      >
                        Role sync
                      </button>
                      <button
                        type="button"
                        className="button button--ghost"
                        disabled={!permissions.offboard}
                        onClick={() => handleOpenOffboard(person)}
                      >
                        Offboard
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {permissions.checkinsRead && (
        <section className="panel due-checkins" aria-live="polite">
          <div className="section-title">
            <h2>Upcoming check-ins</h2>
            <p>7/30/90 day follow-ups due soon.</p>
          </div>
          {dueCheckins.loading ? (
            <p>Checking upcoming touchpoints…</p>
          ) : dueCheckins.error ? (
            <p className="text-danger">{dueCheckins.error}</p>
          ) : dueCheckins.data.length === 0 ? (
            <p>Nothing due in the next 7 days.</p>
          ) : (
            <ul className="checkin-list">
              {dueCheckins.data.slice(0, 6).map((entry) => (
                <li key={`${entry.personId}-${entry.cadence}`}>
                  <div>
                    <strong>{entry.displayName}</strong>
                    <span>{CHECKIN_LABELS[entry.cadence] ?? entry.cadence} check-in</span>
                  </div>
                  <div>
                    <span>{formatDue(entry.dueAt)}</span>
                    {permissions.checkinsUpdate && (
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() => handleRecordCheckin({ personId: entry.personId, cadence: entry.cadence, status: 'completed' })}
                      >
                        Mark complete
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {selectedPerson && (
        <ProfileDrawer
          person={selectedPerson}
          checkins={drawerCheckins}
          cases={drawerCases}
          onClose={handleCloseDrawer}
          onRecordCheckin={handleRecordCheckin}
          canUpdateCheckins={permissions.checkinsUpdate}
        />
      )}

      {activeModal === 'add' && (
        <AddPersonModal
          onClose={closeModal}
          onSuccess={() => {
            closeModal()
            setMessage({ type: 'success', text: 'Person added to roster.' })
            refreshRoster()
          }}
        />
      )}

      {activeModal === 'import' && (
        <ImportRosterModal
          onClose={closeModal}
          onSuccess={(result) => {
            closeModal()
            setMessage({
              type: 'success',
              text: `Imported ${result.inserted} new people${result.updated ? `, updated ${result.updated}` : ''}.`
            })
            refreshRoster()
          }}
        />
      )}

      {activeModal === 'onboarding' && (
        <OnboardingModal
          onClose={closeModal}
          checkins={dueCheckins}
          onMark={(personId, cadence) => handleRecordCheckin({ personId, cadence, status: 'completed' })}
          canUpdateCheckins={permissions.checkinsUpdate}
        />
      )}

      {activeModal === 'offboard' && modalContext?.person && (
        <OffboardModal
          person={modalContext.person}
          onClose={closeModal}
          onSuccess={() => {
            closeModal()
            setMessage({ type: 'success', text: `${modalContext.person.displayName} offboarded.` })
            refreshRoster()
          }}
        />
      )}
    </div>
  )
}

function PeopleToolbar({ filters, onChange }) {
  return (
    <section className="people-toolbar">
      <div className="toolbar-field">
        <label htmlFor="people-search">Search</label>
        <input
          id="people-search"
          type="search"
          placeholder="Search people…"
          value={filters.search}
          onChange={(event) => onChange({ ...filters, search: event.target.value })}
        />
      </div>
      <div className="toolbar-field">
        <label htmlFor="people-status">Status</label>
        <select
          id="people-status"
          value={filters.status}
          onChange={(event) => onChange({ ...filters, status: event.target.value })}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="toolbar-field">
        <label htmlFor="people-department">Department</label>
        <input
          id="people-department"
          type="text"
          placeholder="All departments"
          value={filters.department === 'all' ? '' : filters.department}
          onChange={(event) => {
            const value = event.target.value.trim()
            onChange({ ...filters, department: value ? value : 'all' })
          }}
        />
      </div>
    </section>
  )
}

function SummaryMetric({ label, value }) {
  return (
    <div className="summary-metric">
      <p className="summary-metric__label">{label}</p>
      <p className="summary-metric__value">{value}</p>
    </div>
  )
}

function StatusBadge({ status }) {
  const label = STATUS_LABELS[status] ?? status
  return <span className={`status-badge status-badge--${status ?? 'unknown'}`}>{label ?? 'Unknown'}</span>
}

function formatCheckin(entry) {
  if (!entry?.dueAt) {
    return '—'
  }
  return `${CHECKIN_LABELS[entry.cadence] ?? entry.cadence}: ${formatDue(entry.dueAt)}`
}

function formatCompleted(entry) {
  if (!entry?.completedAt) {
    return '—'
  }
  return `${CHECKIN_LABELS[entry.cadence] ?? entry.cadence}: ${formatDate(entry.completedAt)}`
}

function formatDate(value) {
  if (!value) {
    return '—'
  }
  try {
    return DATE_FORMATTER.format(new Date(value))
  } catch (_error) {
    return value
  }
}

function formatDue(value) {
  if (!value) {
    return '—'
  }
  try {
    const date = new Date(value)
    const now = Date.now()
    const diffMs = date.getTime() - now
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
    if (Math.abs(diffDays) <= 7) {
      if (diffDays === 0) {
        return 'Today'
      }
      return RELATIVE_FORMATTER.format(diffDays, 'day')
    }
    return TIME_FORMATTER.format(date)
  } catch (_error) {
    return value
  }
}

function ProfileDrawer({ person, checkins, cases, onClose, onRecordCheckin, canUpdateCheckins }) {
  return (
    <aside className="profile-drawer" role="complementary" aria-label={`${person.displayName} profile`}>
      <header className="profile-drawer__header">
        <div>
          <h2>{person.displayName}</h2>
          {person.title && <p>{person.title}</p>}
          {person.department && <p className="profile-drawer__meta">{person.department}</p>}
        </div>
        <button type="button" className="button button--ghost" onClick={onClose}>
          Close
        </button>
      </header>

      <section className="profile-drawer__section">
        <h3>Details</h3>
        <dl className="profile-drawer__list">
          <DetailRow label="Status" value={<StatusBadge status={person.status} />} />
          <DetailRow label="Location" value={person.location ?? '—'} />
          <DetailRow label="Timezone" value={person.timezone ?? '—'} />
          <DetailRow label="Email" value={person.email ?? '—'} />
          <DetailRow label="Joined" value={formatDate(person.joinedAt)} />
          <DetailRow label="Last seen" value={formatDate(person.lastSeenAt)} />
          <DetailRow label="Tags" value={person.tags?.length ? person.tags.join(', ') : '—'} />
        </dl>
      </section>

      <section className="profile-drawer__section">
        <h3>Check-ins</h3>
        {checkins.loading ? (
          <p>Loading check-ins…</p>
        ) : checkins.error ? (
          <p className="text-danger">{checkins.error}</p>
        ) : checkins.data.length === 0 ? (
          <p>No check-in history yet.</p>
        ) : (
          <ul className="drawer-checkin-list">
            {checkins.data.map((entry) => (
              <li key={entry.id}>
                <div>
                  <strong>{CHECKIN_LABELS[entry.cadence] ?? entry.cadence}</strong>
                  <span className={`status-badge status-badge--${entry.status}`}>{entry.status}</span>
                </div>
                <div>
                  <span>{entry.status === 'completed' ? formatDate(entry.completedAt) : formatDue(entry.dueAt)}</span>
                  {canUpdateCheckins && entry.status === 'pending' && (
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => onRecordCheckin({ personId: person.id, cadence: entry.cadence, status: 'completed' })}
                    >
                      Mark complete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="profile-drawer__section">
        <h3>Recent cases</h3>
        {cases.loading ? (
          <p>Loading case history…</p>
        ) : cases.error ? (
          <p className="text-danger">{cases.error}</p>
        ) : cases.data.length === 0 ? (
          <p>No recent cases for this member.</p>
        ) : (
          <ul className="case-list">
            {cases.data.map((entry) => (
              <li key={entry.id}>
                <div>
                  <strong>{entry.subject ?? `Case #${entry.id}`}</strong>
                  <span>{entry.status}</span>
                </div>
                <span>{formatDate(entry.updatedAt ?? entry.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  )
}

function DetailRow({ label, value }) {
  return (
    <div className="profile-detail">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function AddPersonModal({ onClose, onSuccess }) {
  const [form, setForm] = useState({
    displayName: '',
    title: '',
    department: '',
    status: 'active',
    email: '',
    location: '',
    timezone: '',
    joinedAt: ''
  })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const payload = {
        displayName: form.displayName,
        title: form.title || null,
        department: form.department || null,
        status: form.status,
        email: form.email || null,
        location: form.location || null,
        timezone: form.timezone || null,
        joinedAt: form.joinedAt || null
      }
      const response = await fetch('/api/people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!response.ok) throw new Error(`Status ${response.status}`)
      onSuccess()
    } catch (submissionError) {
      console.error('Failed to add person', submissionError)
      setError('Unable to add person right now.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal title="Add person" onClose={onClose}>
      <form className="modal-form" onSubmit={handleSubmit}>
        <label>
          Name
          <input
            required
            value={form.displayName}
            onChange={(event) => setForm({ ...form, displayName: event.target.value })}
          />
        </label>
        <label>
          Title
          <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </label>
        <label>
          Department
          <input
            value={form.department}
            onChange={(event) => setForm({ ...form, department: event.target.value })}
          />
        </label>
        <label>
          Status
          <select
            value={form.status}
            onChange={(event) => setForm({ ...form, status: event.target.value })}
          >
            {STATUS_OPTIONS.filter((option) => option.value !== 'all').map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Email
          <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        </label>
        <label>
          Location
          <input
            value={form.location}
            onChange={(event) => setForm({ ...form, location: event.target.value })}
          />
        </label>
        <label>
          Timezone
          <input
            value={form.timezone}
            onChange={(event) => setForm({ ...form, timezone: event.target.value })}
          />
        </label>
        <label>
          Joined date
          <input
            type="date"
            value={form.joinedAt}
            onChange={(event) => setForm({ ...form, joinedAt: event.target.value })}
          />
        </label>
        {error && <p className="text-danger">{error}</p>}
        <footer className="modal-footer">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

function ImportRosterModal({ onClose, onSuccess }) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const rows = parseCsv(text)
      if (!rows.length) {
        throw new Error('No rows parsed')
      }
      const response = await fetch('/api/people/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: rows })
      })
      if (!response.ok) throw new Error(`Status ${response.status}`)
      const result = await response.json()
      onSuccess(result)
    } catch (submissionError) {
      console.error('Failed to import roster', submissionError)
      setError('Unable to import CSV. Confirm the format and try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal title="Import roster" onClose={onClose}>
      <form className="modal-form" onSubmit={handleSubmit}>
        <p className="modal-form__help">
          Paste CSV data with headers: <code>Name,Email,Department,Status</code>
        </p>
        <textarea
          rows={8}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={'Name,Email,Department,Status\nJordan,jordan@example.com,HR,Onboarding'}
        />
        {error && <p className="text-danger">{error}</p>}
        <footer className="modal-footer">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={pending || !text.trim()}>
            {pending ? 'Importing…' : 'Import'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

function OnboardingModal({ onClose, checkins, onMark, canUpdateCheckins }) {
  const entries = checkins?.data ?? []
  return (
    <Modal title="Onboarding checklist" onClose={onClose}>
      {checkins.loading ? (
        <p>Loading upcoming onboarding tasks…</p>
      ) : checkins.error ? (
        <p className="text-danger">{checkins.error}</p>
      ) : entries.length === 0 ? (
        <p>All onboarding check-ins are up to date.</p>
      ) : (
        <ul className="modal-checkin-list">
          {entries.map((entry) => (
            <li key={`${entry.personId}-${entry.cadence}`}>
              <div>
                <strong>{entry.displayName}</strong>
                <span>{CHECKIN_LABELS[entry.cadence] ?? entry.cadence} check-in</span>
                <span>{formatDue(entry.dueAt)}</span>
              </div>
              {canUpdateCheckins && (
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => onMark(entry.personId, entry.cadence)}
                >
                  Mark complete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <footer className="modal-footer">
        <button type="button" className="button button--primary" onClick={onClose}>
          Close
        </button>
      </footer>
    </Modal>
  )
}

function OffboardModal({ person, onClose, onSuccess }) {
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/people/${person.id}/actions/offboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      })
      if (!response.ok) throw new Error(`Status ${response.status}`)
      onSuccess()
    } catch (submissionError) {
      console.error('Failed to offboard person', submissionError)
      setError('Unable to offboard this person.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal title={`Offboard ${person.displayName}`} onClose={onClose}>
      <form className="modal-form" onSubmit={handleSubmit}>
        <p className="modal-form__help">This will mark the person as offboarded and close any pending check-ins.</p>
        <label>
          Reason (optional)
          <textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        {error && <p className="text-danger">{error}</p>}
        <footer className="modal-footer">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={pending}>
            {pending ? 'Offboarding…' : 'Confirm'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

function Modal({ title, children, onClose }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal__header">
          <h2>{title}</h2>
          <button type="button" className="button button--ghost" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  )
}

function parseCsv(text) {
  const trimmed = text.trim()
  if (!trimmed) {
    return []
  }
  const lines = trimmed.split(/\r?\n/)
  if (lines.length === 0) {
    return []
  }
  const headers = lines[0].split(',').map((header) => header.trim().toLowerCase())
  const nameIndex = headers.indexOf('name')
  const emailIndex = headers.indexOf('email')
  const departmentIndex = headers.indexOf('department')
  const statusIndex = headers.indexOf('status')
  const records = []
  for (let index = 1; index < lines.length; index += 1) {
    const parts = lines[index].split(',')
    if (!parts.length) {
      continue
    }
    const record = {
      displayName: parts[nameIndex]?.trim() ?? '',
      email: emailIndex >= 0 ? parts[emailIndex]?.trim() ?? null : null,
      department: departmentIndex >= 0 ? parts[departmentIndex]?.trim() ?? null : null,
      status: statusIndex >= 0 ? parts[statusIndex]?.trim().toLowerCase() ?? 'active' : 'active'
    }
    if (record.displayName) {
      records.push(record)
    }
  }
  return records
}
