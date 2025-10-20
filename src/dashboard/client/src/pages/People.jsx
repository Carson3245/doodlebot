import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../authContext.js'
import { useGuild } from '../guildContext.js'

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'offboarded', label: 'Offboarded' },
  { value: 'not_onboarded', label: 'Not onboarded' }
]

const STATUS_LABELS = {
  active: 'Active',
  onboarding: 'Onboarding',
  inactive: 'Inactive',
  offboarded: 'Offboarded',
  not_onboarded: 'Not onboarded'
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

const VERIFICATION_LABELS = {
  '7d': '7 day verification',
  '30d': '30 day verification',
  '90d': '90 day verification'
}

const DEFAULT_ROSTER = { results: [], total: 0 }

const MODERATION_SUCCESS_MESSAGES = {
  warn: 'Warning recorded.',
  timeout: 'Timeout issued.',
  kick: 'Member kicked.',
  ban: 'Member banned.',
  note: 'Note added to timeline.'
}

const MODERATION_ACTION_LABELS = {
  warn: 'Warned',
  timeout: 'Timed out',
  kick: 'Kicked',
  ban: 'Banned',
  note: 'Note added',
  dm: 'Message sent'
}

const TIMEOUT_PRESETS = [
  { value: 60, label: '1 minute' },
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
  const [drawerActions, setDrawerActions] = useState({ loading: false, data: [], error: null })
  const [activeModal, setActiveModal] = useState(null)
  const [modalContext, setModalContext] = useState(null)

  const verificationBacklog = useMemo(() => {
    const results = Array.isArray(roster.data?.results) ? roster.data.results : []
    return results.filter((person) => (person.status ?? '').toLowerCase() === 'not_onboarded').length
  }, [roster.data])

  const openModal = useCallback((name, context = null) => {
    setActiveModal(name)
    setModalContext(context)
  }, [])

  const closeModal = useCallback(() => {
    setActiveModal(null)
    setModalContext(null)
  }, [])

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

  const executePersonAction = useCallback(
    async ({ personId, payload }) => {
      const response = await fetch(`/api/people/${personId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        throw new Error(errorBody?.error ?? `Request failed with status ${response.status}`)
      }
      const result = await response.json().catch(() => ({}))
      if (result?.counters) {
        setSummary({ loading: false, data: result.counters, error: null })
      }
      refreshRoster()
      if (result?.person) {
        setSelectedPerson((previous) =>
          previous && previous.id === result.person.id ? { ...previous, ...result.person } : previous
        )
      }
      return result
    },
    [refreshRoster]
  )

  const handleExport = useCallback(
    (format) => {
      const params = new URLSearchParams({ format })
      if (selectedGuild?.id) {
        params.set('guildId', selectedGuild.id)
      }
      if (filters.status && filters.status !== 'all') {
        params.set('status', filters.status)
      }
      if (filters.department && filters.department !== 'all') {
        params.set('department', filters.department)
      }
      if (filters.search) {
        params.set('search', filters.search)
      }
      const url = `/api/people/export?${params.toString()}`
      try {
        window.open(url, '_blank', 'noopener')
        setMessage({ type: 'success', text: 'Export started in a new tab.' })
      } catch (error) {
        console.error('Failed to export people', error)
        setMessage({ type: 'error', text: 'Unable to start export.' })
      }
    },
    [filters.department, filters.search, filters.status, selectedGuild]
  )

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
      params.set('limit', '250')
      if (selectedGuild?.id) {
        params.set('guildId', selectedGuild.id)
      }
      try {
        const response = await fetch(`/api/people?${params.toString()}`, { signal: controller.signal })
        if (!response.ok) throw new Error(`Request failed with status ${response.status}`)
        const data = await response.json()
        if (!cancelled) {
          const rawItems = Array.isArray(data?.items)
            ? data.items
            : Array.isArray(data?.results)
              ? data.results
              : []

          let results = rawItems.map((person) => {
            const displayName =
              person.displayName ?? person.username ?? person.name ?? `Member ${person.id ?? ''}`
            const nextVerification = person.nextVerification ?? person.next_verification ?? null
            const lastVerification = person.lastVerification ?? person.last_verification ?? null
            return {
              ...person,
              id: person.id ?? person.memberId ?? person.member_id ?? person.discordId ?? person.discord_id,
              displayName,
              status: (person.status ?? 'active').toLowerCase(),
              department: person.department ?? null,
              title: person.title ?? null,
              guildId: person.guildId ?? person.guild_id ?? selectedGuild?.id ?? null,
              discordId: person.discordId ?? person.discord_id ?? null,
              discordTag: person.discordTag ?? person.discord_tag ?? null,
              source: 'roster',
              checkins: {
                next: nextVerification
                  ? {
                      cadence: nextVerification.cadence ?? nextVerification.type ?? '7d',
                      dueAt: nextVerification.dueAt ?? nextVerification
                    }
                  : null,
                lastCompleted: lastVerification
                  ? {
                      cadence: lastVerification.cadence ?? lastVerification.type ?? '7d',
                      completedAt: lastVerification.completedAt ?? lastVerification
                    }
                  : null
              }
            }
          })

          const counters = data?.counters ?? null

          if (selectedGuild?.id) {
            const existingKeyMap = new Map()
            const existingKeys = new Set()
            results.forEach((person) => {
              const key =
                person.discordId ?? person.discord_id ?? person.externalId ?? person.id ?? null
              if (key) {
                const normalized = String(key)
                existingKeys.add(normalized)
                existingKeyMap.set(normalized, person)
              }
            })

            try {
              const directoryResponse = await fetch(
                `/api/guilds/${selectedGuild.id}/members?limit=250`,
                { signal: controller.signal }
              )
              if (directoryResponse.ok) {
                const members = await directoryResponse.json()
                const directoryEntries = []
                for (const member of members) {
                  const discordId = member?.id ? String(member.id) : null
                  if (!discordId) {
                    continue
                  }
                  if (existingKeys.has(discordId)) {
                    const existing = existingKeyMap.get(discordId)
                    if (existing) {
                      existing.discordId = discordId
                      existing.discordTag = member.tag ?? null
                    }
                    continue
                  }
                  directoryEntries.push({
                    id: `discord:${discordId}`,
                    discordId,
                    discordTag: member.tag ?? null,
                    guildId: selectedGuild.id,
                    displayName:
                      member.displayName ?? member.username ?? member.tag ?? `Member ${discordId}`,
                    title: member.username ?? null,
                    status: 'not_onboarded',
                    department: null,
                    timezone: null,
                    location: null,
                    email: null,
                    tags: [],
                    roles: [],
                    joinedAt: member.joinedAt ?? null,
                    lastSeenAt: null,
                    checkins: {
                      stats: { pending: 0, completed: 0, missed: 0 },
                      next: null,
                      lastCompleted: null,
                      history: []
                    },
                    source: 'directory'
                  })
                }
                results = results.concat(directoryEntries)
              }
            } catch (directoryError) {
              if (directoryError.name !== 'AbortError') {
                console.error('Failed to load guild directory', directoryError)
              } else {
                return
              }
            }
          }

          results.sort((a, b) => {
            const left = (a.displayName ?? '').toLowerCase()
            const right = (b.displayName ?? '').toLowerCase()
            if (left < right) return -1
            if (left > right) return 1
            return 0
          })

          setRoster({
            loading: false,
            data: { results, total: results.length },
            error: null
          })
          if (counters) {
            setSummary({ loading: false, data: counters, error: null })
          }
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
        const response = await fetch('/api/people/checkins/upcoming?days=30&includeMissed=true', {
          signal: controller.signal
        })
        if (!response.ok) throw new Error(`Status ${response.status}`)
        const payload = await response.json()
        const items = Array.isArray(payload)
          ? payload.map((entry) => ({
              personId: entry.person_id ?? entry.personId,
              displayName: entry.name ?? entry.displayName ?? 'Member',
              cadence: entry.type ?? entry.cadence ?? '7d',
              dueAt: entry.due_at ?? entry.dueAt ?? null,
              department: entry.department ?? null
            }))
          : []
        if (!cancelled) {
          setDueCheckins({ loading: false, data: items, error: null })
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          return
        }
        console.error('Failed to load upcoming verifications', error)
        if (!cancelled) {
          setDueCheckins({ loading: false, data: [], error: 'Unable to load verifications.' })
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
      const isDirectoryPerson = person.source === 'directory'

      if (permissions.checkinsRead && !isDirectoryPerson) {
        setDrawerCheckins({ loading: true, data: [], error: null })
        fetch(`/api/people/${person.id}/checkins`)
          .then(async (response) => {
            if (!response.ok) throw new Error(`Status ${response.status}`)
            const data = await response.json()
            setDrawerCheckins({ loading: false, data: data?.checkins ?? [], error: null })
          })
          .catch((error) => {
            console.error('Failed to load verifications for person', error)
            setDrawerCheckins({ loading: false, data: [], error: 'Unable to load verifications.' })
          })
      } else {
        setDrawerCheckins({ loading: false, data: [], error: null })
      }

      if (person.guildId && !isDirectoryPerson) {
        setDrawerCases({ loading: true, data: [], error: null })
        const params = new URLSearchParams({
          guildId: person.guildId,
          status: 'active',
          limit: '6',
          includeArchived: 'false'
        })
        fetch(`/api/cases?${params.toString()}`)
          .then(async (response) => {
            if (!response.ok) throw new Error(`Status ${response.status}`)
            const payload = await response.json()
            const items = Array.isArray(payload?.items)
              ? payload.items
              : Array.isArray(payload)
                ? payload
                : []
            setDrawerCases({ loading: false, data: items, error: null })
          })
          .catch((error) => {
            console.error('Failed to load case history', error)
            setDrawerCases({ loading: false, data: [], error: 'Unable to load case history.' })
          })
      } else {
        setDrawerCases({ loading: false, data: [], error: null })
      }

      if (permissions.manage && person.guildId && !isDirectoryPerson) {
        setDrawerActions({ loading: true, data: [], error: null })
        const params = new URLSearchParams()
        params.set('guildId', person.guildId)
        if (person.discordId ?? person.discord_id) {
          params.set('memberId', person.discordId ?? person.discord_id)
        }
        fetch(`/api/people/${person.id}/actions/log?${params.toString()}`)
          .then(async (response) => {
            if (!response.ok) throw new Error(`Status ${response.status}`)
            const payload = await response.json()
            const items = Array.isArray(payload) ? payload : []
            setDrawerActions({ loading: false, data: items, error: null })
          })
          .catch((error) => {
            console.error('Failed to load moderation history', error)
            setDrawerActions({
              loading: false,
              data: [],
              error: 'Unable to load moderation history.'
            })
          })
      } else {
        setDrawerActions({ loading: false, data: [], error: null })
      }
    },
    [permissions.checkinsRead, permissions.manage]
  )

  const handleCloseDrawer = useCallback(() => {
    setSelectedPerson(null)
    setDrawerCheckins({ loading: false, data: [], error: null })
    setDrawerCases({ loading: false, data: [], error: null })
    setDrawerActions({ loading: false, data: [], error: null })
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
        setMessage({ type: 'success', text: 'Verification updated.' })
        refreshRoster()
      } catch (error) {
        console.error('Failed to update verification', error)
        setMessage({ type: 'error', text: 'Unable to update verification.' })
      }
    },
    [permissions.checkinsUpdate, refreshRoster]
  )

  const handleOpenPersonAction = useCallback(
    (action, person) => {
      if (!person) {
        return
      }
      if (action === 'directory:add') {
        openModal('add', {
          defaults: {
            displayName: person.displayName,
            title: person.title ?? null,
            status: 'onboarding',
            guildId: person.guildId ?? selectedGuild?.id ?? null,
            discordId: person.discordId ?? person.id,
            discordTag: person.discordTag ?? null
          }
        })
        return
      }
      if (action === 'announce') {
        handleAnnounce(person)
        return
      }
      if (action === 'rolesync') {
        handleRoleSync(person)
        return
      }
      if (action === 'offboard') {
        handleOpenOffboard(person)
        return
      }
      if (['warn', 'timeout', 'kick', 'ban', 'note'].includes(action)) {
        openModal('moderation_action', {
          person,
          action,
          guildId: person.guildId ?? selectedGuild?.id ?? null,
          memberId: person.discordId ?? person.id ?? null
        })
        return
      }
      setActiveModal(action)
      setModalContext({ person })
    },
    [handleAnnounce, handleOpenOffboard, handleRoleSync, openModal, selectedGuild?.id]
  )

  return (
    <div className="page people-page">
      <header className="page__header">
        <div>
          <h1>People</h1>
          <p>Track onboarding, departments, and upcoming verifications.</p>
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
          <button type="button" className="button button--ghost" onClick={() => handleExport('csv')}>
            Export CSV
          </button>
          <button type="button" className="button button--ghost" onClick={() => handleExport('pdf')}>
            Export PDF
          </button>
        </div>
      </header>

      <section className="panel people-summary" aria-live="polite">
        {summary.loading ? (
          <p>Calculating roster snapshot�</p>
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

    {verificationBacklog > 0 && (
      <div className="inline-alert inline-alert--info verification-alert" role="status">
        <span>
          {verificationBacklog === 1
            ? 'There is 1 member waiting for verification.'
            : `There are ${verificationBacklog} members waiting for verification.`}
        </span>
        <button
          type="button"
          className="button button--ghost"
          onClick={() =>
            setFilters((previous) => ({
              ...previous,
              status: 'not_onboarded'
            }))
          }
        >
          View queue
        </button>
      </div>
    )}

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
          <div className="table-placeholder">Loading roster�</div>
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
                <th scope="col">Next verification</th>
                <th scope="col">Last verification</th>
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
                  <td>{person.department ?? '�'}</td>
                  <td>
                    <StatusBadge status={person.status} />
                  </td>
                  <td>{formatVerification(person.checkins?.next)}</td>
                  <td>{formatVerificationCompleted(person.checkins?.lastCompleted)}</td>
                  <td>
                    <PersonActionsSelect
                      person={person}
                      permissions={permissions}
                      onSelect={handleOpenPersonAction}
                    />
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
            <h2>Upcoming verifications</h2>
            <p>7/30/90 day follow-ups due soon.</p>
          </div>
          {dueCheckins.loading ? (
            <p>Checking upcoming verifications�</p>
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
                    <span>{VERIFICATION_LABELS[entry.cadence] ?? entry.cadence} verification</span>
                  </div>
                  <div>
                    <span>{formatVerificationDue(entry.dueAt)}</span>
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
          actions={drawerActions}
          onClose={handleCloseDrawer}
          onRecordCheckin={handleRecordCheckin}
          canUpdateCheckins={permissions.checkinsUpdate}
          canManageActions={permissions.manage}
        />
      )}

      {activeModal === 'add' && (
        <AddPersonModal
          defaults={modalContext?.defaults}
          defaultGuildId={selectedGuild?.id ?? null}
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

      {activeModal === 'moderation_action' && modalContext?.person && (
        <ModerationActionModal
          person={modalContext.person}
          action={modalContext.action}
          defaultGuildId={modalContext.guildId ?? selectedGuild?.id ?? null}
          defaultMemberId={modalContext.memberId ?? modalContext.person.discordId ?? modalContext.person.id}
          onClose={closeModal}
          onSubmit={async (payload) => {
            try {
              await executePersonAction({ personId: modalContext.person.id, payload })
              const successText =
                MODERATION_SUCCESS_MESSAGES[modalContext.action] ?? 'Action completed.'
              setMessage({ type: 'success', text: successText })
              closeModal()
              refreshRoster()
            } catch (error) {
              throw error
            }
          }}
        />
      )}

      {activeModal === 'dm' && modalContext?.person && (
        <DmModal
          person={modalContext.person}
          onClose={closeModal}
          onSubmit={async (payload) => {
            try {
              await executePersonAction({ personId: modalContext.person.id, payload })
              setMessage({ type: 'success', text: 'Message sent via DreamGen.' })
              closeModal()
            } catch (error) {
              throw error
            }
          }}
        />
      )}

      {activeModal === 'schedule_checkin' && modalContext?.person && (
        <ScheduleCheckinModal
          person={modalContext.person}
          onClose={closeModal}
          onSubmit={async (payload) => {
            try {
              await executePersonAction({ personId: modalContext.person.id, payload })
              setMessage({ type: 'success', text: 'Verification scheduled.' })
              closeModal()
            } catch (error) {
              throw error
            }
          }}
        />
      )}

      {activeModal === 'assign_department' && modalContext?.person && (
        <AssignDepartmentModal
          person={modalContext.person}
          onClose={closeModal}
          onSubmit={async (payload) => {
            try {
              await executePersonAction({ personId: modalContext.person.id, payload })
              setMessage({ type: 'success', text: 'Department updated.' })
              closeModal()
            } catch (error) {
              throw error
            }
          }}
        />
      )}

      {activeModal === 'open_case' && modalContext?.person && (
        <OpenCaseModal
          person={modalContext.person}
          onClose={closeModal}
          onSubmit={async (payload) => {
            try {
              await executePersonAction({ personId: modalContext.person.id, payload })
              setMessage({ type: 'success', text: 'Case opened for this person.' })
              closeModal()
            } catch (error) {
              throw error
            }
          }}
        />
      )}

      {activeModal === 'set_status' && modalContext?.person && (
        <SetStatusModal
          person={modalContext.person}
          onClose={closeModal}
          onSubmit={async (payload) => {
            try {
              await executePersonAction({ personId: modalContext.person.id, payload })
              setMessage({ type: 'success', text: 'Status updated.' })
              closeModal()
            } catch (error) {
              throw error
            }
          }}
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
          placeholder="Search people..."
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

function PersonActionsSelect({ person, permissions, onSelect }) {
  if (person?.source === 'directory') {
    return (
      <button
        type="button"
        className="button button--ghost"
        onClick={() => onSelect('directory:add', person)}
      >
        Add to roster
      </button>
    )
  }

  const actions = [
    { value: 'warn', label: 'Warn' },
    { value: 'timeout', label: 'Timeout' },
    { value: 'kick', label: 'Kick' },
    { value: 'ban', label: 'Ban' },
    { value: 'note', label: 'Add note' },
    { value: 'dm', label: 'Send DM' },
    { value: 'schedule_checkin', label: 'Schedule verification' },
    { value: 'assign_department', label: 'Assign department' },
    { value: 'open_case', label: 'Open case' },
    { value: 'set_status', label: 'Set status' }
  ]

  if (permissions.announce) {
    actions.push({ value: 'announce', label: 'Announce onboarding' })
  }
  if (permissions.rolesync) {
    actions.push({ value: 'rolesync', label: 'Sync roles' })
  }
  if (permissions.offboard) {
    actions.push({ value: 'offboard', label: 'Offboard' })
  }

  if (!actions.length) {
    return <span className="text-muted">No actions available</span>
  }

  return (
    <select
      className="people-actions__select"
      defaultValue=""
      onChange={(event) => {
        const { value } = event.target
        if (value) {
          onSelect(value, person)
        }
        event.target.value = ''
      }}
    >
      <option value="" disabled>
        Choose action...
      </option>
      {actions.map((action) => (
        <option key={action.value} value={action.value}>
          {action.label}
        </option>
      ))}
    </select>
  )
}
function StatusBadge({ status }) {
  const label = STATUS_LABELS[status] ?? status
  return <span className={`status-badge status-badge--${status ?? 'unknown'}`}>{label ?? 'Unknown'}</span>
}

function formatVerification(entry) {
  if (!entry?.dueAt) {
    return 'N/A'
  }
  return `${VERIFICATION_LABELS[entry.cadence] ?? entry.cadence}: ${formatVerificationDue(entry.dueAt)}`
}


function formatVerificationCompleted(entry) {
  if (!entry?.completedAt) {
    return 'N/A'
  }
  return `${VERIFICATION_LABELS[entry.cadence] ?? entry.cadence}: ${formatVerificationDate(entry.completedAt)}`
}


function formatVerificationDate(value) {
  if (!value) {
    return 'N/A'
  }
  try {
    return DATE_FORMATTER.format(new Date(value))
  } catch (_error) {
    return value
  }
}


function formatVerificationDue(value) {
  if (!value) {
    return 'N/A'
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


function ProfileDrawer({
  person,
  checkins,
  cases,
  actions,
  onClose,
  onRecordCheckin,
  canUpdateCheckins,
  canManageActions
}) {
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
          <DetailRow label="Location" value={person.location ?? '�'} />
          <DetailRow label="Timezone" value={person.timezone ?? '�'} />
          <DetailRow label="Email" value={person.email ?? '�'} />
          <DetailRow label="Joined" value={formatVerificationDate(person.joinedAt)} />
          <DetailRow label="Last seen" value={formatVerificationDate(person.lastSeenAt)} />
          <DetailRow label="Tags" value={person.tags?.length ? person.tags.join(', ') : '�'} />
        </dl>
      </section>

      <section className="profile-drawer__section">
        <h3>Verifications</h3>
        {checkins.loading ? (
          <p>Loading verifications�</p>
        ) : checkins.error ? (
          <p className="text-danger">{checkins.error}</p>
        ) : checkins.data.length === 0 ? (
          <p>No verification history yet.</p>
        ) : (
          <ul className="drawer-checkin-list">
            {checkins.data.map((entry) => (
              <li key={entry.id}>
                <div>
                  <strong>{VERIFICATION_LABELS[entry.cadence] ?? entry.cadence}</strong>
                  <span className={`status-badge status-badge--${entry.status}`}>{entry.status}</span>
                </div>
                <div>
                  <span>{entry.status === 'completed' ? formatVerificationDate(entry.completedAt) : formatVerificationDue(entry.dueAt)}</span>
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
          <p>Loading case history�</p>
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
                <span>{formatVerificationDate(entry.updatedAt ?? entry.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManageActions ? (
        <section className="profile-drawer__section">
          <h3>Moderation history</h3>
          {actions.loading ? (
            <p>Loading moderation history…</p>
          ) : actions.error ? (
            <p className="text-danger">{actions.error}</p>
          ) : actions.data.length === 0 ? (
            <p>No moderation actions recorded for this member.</p>
          ) : (
            <ul className="drawer-action-list">
              {actions.data.map((entry) => (
                <li key={entry.id}>
                  <div>
                    <strong>{MODERATION_ACTION_LABELS[entry.action] ?? entry.action}</strong>
                    <span>{formatVerificationDate(entry.createdAt)}</span>
                  </div>
                  {entry.reason ? <p>{entry.reason}</p> : null}
                  <footer>
                    {entry.actorTag ? <span>By {entry.actorTag}</span> : null}
                    {entry.durationSec ? <span>{formatDuration(entry.durationSec)}</span> : null}
                    {entry.dmUser ? <span>Member notified</span> : null}
                    {entry.evidenceUrl ? (
                      <a href={entry.evidenceUrl} target="_blank" rel="noopener noreferrer">
                        Evidence
                      </a>
                    ) : null}
                  </footer>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
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

function AddPersonModal({ onClose, onSuccess, defaults = {}, defaultGuildId = null }) {
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

  const metadata = useMemo(
    () => ({
      guildId: defaults.guildId ?? defaultGuildId ?? null,
      discordId: defaults.discordId ?? defaults.discord_id ?? null,
      discordTag: defaults.discordTag ?? defaults.discord_tag ?? null
    }),
    [defaults, defaultGuildId]
  )

  useEffect(() => {
    const normalizeDateInput = (value) => {
      if (!value) {
        return ''
      }
      try {
        const date = new Date(value)
        if (Number.isNaN(date.getTime())) {
          return ''
        }
        return date.toISOString().slice(0, 10)
      } catch (_error) {
        return ''
      }
    }

    setForm({
      displayName: defaults.displayName ?? defaults.name ?? '',
      title: defaults.title ?? defaults.username ?? '',
      department: defaults.department ?? '',
      status: defaults.status ?? 'active',
      email: defaults.email ?? '',
      location: defaults.location ?? '',
      timezone: defaults.timezone ?? '',
      joinedAt: normalizeDateInput(defaults.joinedAt ?? defaults.joined_at ?? '')
    })
  }, [defaults])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const payload = {
        displayName: form.displayName,
        title: form.title || null,
        department: form.department || null,
        status: form.status || 'active',
        email: form.email || null,
        location: form.location || null,
        timezone: form.timezone || null,
        joinedAt: form.joinedAt ? new Date(form.joinedAt).toISOString() : null,
        discordId: metadata.discordId,
        discordTag: metadata.discordTag,
        guildId: metadata.guildId
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
            {pending ? 'Saving�' : 'Save'}
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
            {pending ? 'Importing�' : 'Import'}
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
        <p>Loading upcoming onboarding tasks�</p>
      ) : checkins.error ? (
        <p className="text-danger">{checkins.error}</p>
      ) : entries.length === 0 ? (
        <p>All onboarding verifications are up to date.</p>
      ) : (
        <ul className="modal-checkin-list">
          {entries.map((entry) => (
            <li key={`${entry.personId}-${entry.cadence}`}>
              <div>
                <strong>{entry.displayName}</strong>
                <span>{VERIFICATION_LABELS[entry.cadence] ?? entry.cadence} verification</span>
                <span>{formatVerificationDue(entry.dueAt)}</span>
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
        <p className="modal-form__help">This will mark the person as offboarded and close any pending verifications.</p>
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
            {pending ? 'Offboarding�' : 'Confirm'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

function formatDuration(value) {
  const seconds = Number(value) || 0
  if (seconds <= 0) {
    return null
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 1) {
    return `${seconds}s`
  }
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours === 0) {
    return `${minutes}m`
  }
  if (remainingMinutes === 0) {
    return `${hours}h`
  }
  return `${hours}h ${remainingMinutes}m`
}

function ModerationActionModal({ person, action, defaultGuildId, defaultMemberId, onClose, onSubmit }) {
  const [reason, setReason] = useState('')
  const [dmUser, setDmUser] = useState(action !== 'note')
  const [duration, setDuration] = useState(TIMEOUT_PRESETS[2].value)
  const [deleteDays, setDeleteDays] = useState(0)
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)

  const isTimeout = action === 'timeout'
  const isBan = action === 'ban'
  const allowDm = action !== 'note'

  const titles = {
    warn: `Warn ${person.displayName}`,
    timeout: `Timeout ${person.displayName}`,
    kick: `Kick ${person.displayName}`,
    ban: `Ban ${person.displayName}`,
    note: `Add note for ${person.displayName}`
  }

  const descriptions = {
    warn: 'Send a moderated warning and optionally DM the member.',
    timeout: 'Restrict the member from chatting or joining voice for the selected duration.',
    kick: 'Remove the member from the guild. They can rejoin with an invite.',
    ban: 'Ban the member from the guild and optionally delete recent messages.',
    note: 'Add a private note to the member history without notifying them.'
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const trimmedReason = reason.trim()
    if (!trimmedReason) {
      setError('Reason is required.')
      return
    }
    if (allowDm && dmUser && !message.trim()) {
      setError('Message is required when DMing the member.')
      return
    }
    setPending(true)
    setError(null)
    try {
      const payload = {
        action,
        reason: trimmedReason,
        guildId: defaultGuildId ?? null,
        memberId: defaultMemberId ?? null,
        dmUser: allowDm ? dmUser : false,
        evidenceUrl: evidenceUrl.trim() ? evidenceUrl.trim() : null
      }
      if (allowDm && dmUser && message.trim()) {
        payload.message = message.trim()
      }
      if (isTimeout) {
        payload.durationSec = Number(duration) || 0
      }
      if (isBan) {
        payload.deleteMessageDays = Number(deleteDays) || 0
      }
      if (action === 'note') {
        payload.dmUser = false
      }
      await onSubmit(payload)
    } catch (submissionError) {
      setError(submissionError.message ?? 'Unable to submit action.')
      setPending(false)
      return
    }
  }

  return (
    <Modal title={titles[action] ?? 'Moderation action'} onClose={onClose}>
      <form className="modal-form" onSubmit={handleSubmit}>
        <p className="modal-form__help">{descriptions[action] ?? 'Provide context before confirming.'}</p>
        <label>
          Reason
          <textarea
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why are you taking this action?"
          />
        </label>
        {isTimeout ? (
          <label>
            Duration
            <select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>
              {TIMEOUT_PRESETS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {isBan ? (
          <label>
            Delete recent messages
            <select value={deleteDays} onChange={(event) => setDeleteDays(Number(event.target.value))}>
              {BAN_DELETE_WINDOWS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Evidence URL (optional)
          <input
            type="url"
            value={evidenceUrl}
            onChange={(event) => setEvidenceUrl(event.target.value)}
            placeholder="https://"
          />
        </label>
        {allowDm ? (
          <label className="checkbox-row">
            <input type="checkbox" checked={dmUser} onChange={(event) => setDmUser(event.target.checked)} />
            Notify member via DM
          </label>
        ) : null}
        {allowDm && dmUser ? (
          <label>
            DM message
            <textarea
              rows={3}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={`Hi ${person.displayName}, we're following up on …`}
            />
          </label>
        ) : null}
        {error && <p className="text-danger">{error}</p>}
        <footer className="modal-footer">
          <button type="button" className="button button--ghost" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={pending}>
            {pending ? 'Saving…' : 'Confirm'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

function DmModal({ person, onClose, onSubmit }) {
  const [targetType, setTargetType] = useState('user')
  const [targetId, setTargetId] = useState('')
  const [message, setMessage] = useState(`Hi ${person.displayName},`)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!targetId.trim()) {
      setError('Target ID is required.')
      return
    }
    if (!message.trim()) {
      setError('Message cannot be empty.')
      return
    }
    setPending(true)
    setError(null)
    try {
      await onSubmit({
        action: 'dm',
        ...(targetType === 'channel' ? { channel: targetId.trim() } : { user: targetId.trim() }),
        message: message.trim()
      })
    } catch (submissionError) {
      setError(submissionError.message ?? 'Unable to send message.')
      setPending(false)
      return
    }
  }

  return (
    <Modal title={`Send DM to ${person.displayName}`} onClose={onClose}>
      <form className="modal-form" onSubmit={handleSubmit}>
        <label>
          Target type
          <select value={targetType} onChange={(event) => setTargetType(event.target.value)}>
            <option value="user">User ID</option>
            <option value="channel">Channel ID</option>
          </select>
        </label>
        <label>
          Target ID
          <input
            type="text"
            inputMode="numeric"
            pattern="\d+"
            placeholder="Enter Snowflake ID"
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
          />
        </label>
        <label>
          Message
          <textarea rows={5} value={message} onChange={(event) => setMessage(event.target.value)} />
        </label>
        {error && <p className="text-danger">{error}</p>}
        <footer className="modal-footer">
          <button type="button" className="button button--ghost" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={pending}>
            {pending ? 'Sending�' : 'Send message'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

function ScheduleCheckinModal({ person, onClose, onSubmit }) {
  const [cadence, setCadence] = useState('7d')
  const [customDate, setCustomDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() + 3)
    return date.toISOString().slice(0, 16)
  })
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (event) => {
    event.preventDefault()
    const payload = {
      action: 'schedule_checkin',
      type: cadence,
      due_at: cadence === 'custom' ? new Date(customDate).toISOString() : null,
      notes: notes.trim() || null
    }
    if (cadence === 'custom' && (!customDate || Number.isNaN(new Date(customDate).getTime()))) {
      setError('Select a valid due date.')
      return
    }
    setPending(true)
    setError(null)
    try {
      await onSubmit(payload)
    } catch (submissionError) {
      setError(submissionError.message ?? 'Unable to schedule verification.')
      setPending(false)
      return
    }
  }

  return (
    <Modal title={`Schedule verification for ${person.displayName}`} onClose={onClose}>
      <form className="modal-form" onSubmit={handleSubmit}>
        <fieldset>
          <legend>Cadence</legend>
          <label>
            <input
              type="radio"
              name="checkin-cadence"
              value="7d"
              checked={cadence === '7d'}
              onChange={() => setCadence('7d')}
            />
            7 day verification
          </label>
          <label>
            <input
              type="radio"
              name="checkin-cadence"
              value="30d"
              checked={cadence === '30d'}
              onChange={() => setCadence('30d')}
            />
            30 day verification
          </label>
          <label>
            <input
              type="radio"
              name="checkin-cadence"
              value="90d"
              checked={cadence === '90d'}
              onChange={() => setCadence('90d')}
            />
            90 day verification
          </label>
          <label>
            <input
              type="radio"
              name="checkin-cadence"
              value="custom"
              checked={cadence === 'custom'}
              onChange={() => setCadence('custom')}
            />
            Custom date
          </label>
        </fieldset>
        {cadence === 'custom' && (
          <label>
            Due at
            <input
              type="datetime-local"
              value={customDate}
              onChange={(event) => setCustomDate(event.target.value)}
            />
          </label>
        )}
        <label>
          Notes (optional)
          <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        {error && <p className="text-danger">{error}</p>}
        <footer className="modal-footer">
          <button type="button" className="button button--ghost" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={pending}>
            {pending ? 'Scheduling�' : 'Schedule verification'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

function AssignDepartmentModal({ person, onClose, onSubmit }) {
  const [department, setDepartment] = useState(person.department ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!department.trim()) {
      setError('Department name is required.')
      return
    }
    setPending(true)
    setError(null)
    try {
      await onSubmit({
        action: 'assign_department',
        department: department.trim()
      })
    } catch (submissionError) {
      setError(submissionError.message ?? 'Unable to assign department.')
      setPending(false)
      return
    }
  }

  return (
    <Modal title={`Assign department for ${person.displayName}`} onClose={onClose}>
      <form className="modal-form" onSubmit={handleSubmit}>
        <label>
          Department
          <input
            type="text"
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
            placeholder="e.g. Support"
          />
        </label>
        {error && <p className="text-danger">{error}</p>}
        <footer className="modal-footer">
          <button type="button" className="button button--ghost" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={pending}>
            {pending ? 'Saving�' : 'Save changes'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

function OpenCaseModal({ person, onClose, onSubmit }) {
  const [category, setCategory] = useState('conduct')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    setPending(true)
    setError(null)
    try {
      await onSubmit({
        action: 'open_case',
        category,
        title: title.trim(),
        notes: notes.trim() || null
      })
    } catch (submissionError) {
      setError(submissionError.message ?? 'Unable to open case.')
      setPending(false)
      return
    }
    setPending(false)
  }

  return (
    <Modal title={`Open case for ${person.displayName}`} onClose={onClose}>
      <form className="modal-form" onSubmit={handleSubmit}>
        <label>
          Category
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="conduct">Conduct</option>
            <option value="performance">Performance</option>
            <option value="support">Support</option>
            <option value="wellbeing">Wellbeing</option>
          </select>
        </label>
        <label>
          Title
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Short summary of the case"
          />
        </label>
        <label>
          Notes (optional)
          <textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        {error && <p className="text-danger">{error}</p>}
        <footer className="modal-footer">
          <button type="button" className="button button--ghost" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={pending}>
            {pending ? 'Opening�' : 'Open case'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

function SetStatusModal({ person, onClose, onSubmit }) {
  const [status, setStatus] = useState(person.status ?? 'active')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await onSubmit({
        action: 'set_status',
        status
      })
    } catch (submissionError) {
      setError(submissionError.message ?? 'Unable to update status.')
      setPending(false)
      return
    }
    setPending(false)
  }

  return (
    <Modal title={`Set status for ${person.displayName}`} onClose={onClose}>
      <form className="modal-form" onSubmit={handleSubmit}>
        <fieldset>
          <legend>Status</legend>
          <label>
            <input
              type="radio"
              name="person-status"
              value="active"
              checked={status === 'active'}
              onChange={() => setStatus('active')}
            />
            Active
          </label>
          <label>
            <input
              type="radio"
              name="person-status"
              value="onboarding"
              checked={status === 'onboarding'}
              onChange={() => setStatus('onboarding')}
            />
            Onboarding
          </label>
          <label>
            <input
              type="radio"
              name="person-status"
              value="offboarded"
              checked={status === 'offboarded'}
              onChange={() => setStatus('offboarded')}
            />
            Offboarded
          </label>
          <label>
            <input
              type="radio"
              name="person-status"
              value="inactive"
              checked={status === 'inactive'}
              onChange={() => setStatus('inactive')}
            />
            Inactive
          </label>
        </fieldset>
        {error && <p className="text-danger">{error}</p>}
        <footer className="modal-footer">
          <button type="button" className="button button--ghost" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={pending}>
            {pending ? 'Saving�' : 'Update status'}
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














