import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useNavigate, useParams } from "react-router-dom"

import { useAuth } from "../authContext.js"
import { useGuild } from "../guildContext.js"

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "open", label: "Open" },
  { value: "pending-response", label: "Awaiting member" },
  { value: "escalated", label: "Escalated" },
  { value: "closed", label: "Closed" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All statuses" }
]

const CATEGORY_OPTIONS = [
  { value: "all", label: "All categories" },
  { value: "moderation", label: "Moderation" },
  { value: "ticket", label: "Tickets" }
]

const SLA_OPTIONS = [
  { value: "all", label: "All SLA states" },
  { value: "overdue", label: "Overdue" },
  { value: "due-soon", label: "Due soon" },
  { value: "pending", label: "Pending" },
  { value: "met", label: "Met" },
  { value: "none", label: "No SLA" }
]

const SORT_OPTIONS = [
  { value: "updatedAt", label: "Last update" },
  { value: "createdAt", label: "Created" },
  { value: "lastMessageAt", label: "Last message" },
  { value: "sla", label: "SLA due" }
]

const SAVED_FILTERS = [
  { id: "active", label: "Active queue", filters: { status: "active", assignee: "all", sla: "all" } },
  { id: "mine", label: "My queue", filters: { status: "active", assignee: "me" } },
  { id: "overdue", label: "SLA overdue", filters: { status: "active", sla: "overdue", assignee: "all" } },
  { id: "escalated", label: "Escalated", filters: { status: "escalated", assignee: "all", sla: "all" } }
]

const INITIAL_FILTERS = {
  status: "active",
  category: "all",
  assignee: "all",
  sla: "all",
  search: "",
  sortBy: "updatedAt",
  direction: "desc",
  mine: false
}

export default function CasesPage() {
  const { selectedGuild } = useGuild()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { caseId: routeCaseId } = useParams()
  const selectedCaseId = routeCaseId ?? null
  const [filters, setFilters] = useState(INITIAL_FILTERS)
  const [savedFilter, setSavedFilter] = useState("active")
  const [casesState, setCasesState] = useState({ loading: true, total: 0, items: [], error: null })
  const [caseDetail, setCaseDetail] = useState({ loading: false, data: null, error: null })
  const [composer, setComposer] = useState("")
  const [refreshKey, setRefreshKey] = useState(0)
  const eventSourceRef = useRef(null)

  const guildId = selectedGuild?.id ?? null

  const effectiveFilters = useMemo(() => {
    const base = { ...filters }
    if (base.assignee === "me") {
      base.mine = true
    } else if (base.mine) {
      base.mine = false
    }
    return base
  }, [filters])

  const navigateToCase = useCallback(
    (caseId, options = {}) => {
      const target = caseId ? `/cases/${caseId}` : "/cases"
      const currentTarget = selectedCaseId ? `/cases/${selectedCaseId}` : "/cases"
      if (target === currentTarget) {
        return
      }
      navigate(target, options)
    },
    [navigate, selectedCaseId]
  )

  const fetchCases = useCallback(async (abortSignal) => {
    if (!guildId) {
      setCasesState({ loading: false, total: 0, items: [], error: null })
      setCaseDetail({ loading: false, data: null, error: null })
      navigateToCase(null, { replace: true })
      return
    }

    setCasesState((prev) => ({ ...prev, loading: true, error: null }))

    const params = new URLSearchParams({
      guildId,
      status: effectiveFilters.status,
      category: effectiveFilters.category,
      assignee: effectiveFilters.assignee,
      sla: effectiveFilters.sla,
      sortBy: effectiveFilters.sortBy,
      direction: effectiveFilters.direction
    })
    if (effectiveFilters.search) {
      params.set("search", effectiveFilters.search)
    }
    if (effectiveFilters.mine) {
      params.set("mine", "true")
    }

    try {
      const response = await fetch(`/api/cases?${params.toString()}`, { signal: abortSignal })
      if (!response.ok) {
        throw new Error(`Status ${response.status}`)
      }
      const payload = await response.json()
      const items = Array.isArray(payload?.items) ? payload.items : []
      setCasesState({ loading: false, total: payload?.total ?? items.length, items, error: null })
      if (items.length) {
        const hasSelected = selectedCaseId
          ? items.some((item) => item.id === selectedCaseId)
          : false
        if (!hasSelected) {
          const fallbackId = items[0]?.id ?? null
          if (fallbackId) {
            navigateToCase(fallbackId, { replace: true })
          }
        }
      } else {
        setCaseDetail({ loading: false, data: null, error: null })
        navigateToCase(null, { replace: true })
      }
    } catch (error) {
      if (error.name === "AbortError") {
        return
      }
      console.error("Failed to load cases", error)
      setCasesState({ loading: false, total: 0, items: [], error: "Unable to load cases." })
    }
  }, [guildId, effectiveFilters, navigateToCase, selectedCaseId])

  useEffect(() => {
    const controller = new AbortController()
    fetchCases(controller.signal)
    return () => controller.abort()
  }, [fetchCases, refreshKey])

  const loadCaseDetail = useCallback(async (caseId) => {
    if (!caseId) {
      setCaseDetail({ loading: false, data: null, error: null })
      return
    }
    setCaseDetail((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const params = new URLSearchParams()
      if (guildId) {
        params.set("guildId", guildId)
      }
      const queryString = params.toString()
      const url = queryString.length ? `/api/cases/${caseId}?${queryString}` : `/api/cases/${caseId}`
      const response = await fetch(url)
      if (!response.ok) {
        if (response.status === 404) {
          setCaseDetail({ loading: false, data: null, error: "Case not found." })
          return
        }
        throw new Error(`Status ${response.status}`)
      }
      const payload = await response.json()
      setCaseDetail({ loading: false, data: payload, error: null })
    } catch (error) {
      console.error("Failed to load case detail", error)
      setCaseDetail({ loading: false, data: null, error: "Unable to load case details." })
    }
  }, [guildId])

  useEffect(() => {
    if (!selectedCaseId) {
      setCaseDetail({ loading: false, data: null, error: null })
      return
    }
    loadCaseDetail(selectedCaseId)
  }, [selectedCaseId, loadCaseDetail])

  useEffect(() => {
    if (!guildId) {
      return
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    const source = new EventSource("/api/cases/events")
    eventSourceRef.current = source

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data || "{}")
        if (!payload?.payload?.guildId || payload.payload.guildId !== guildId) {
          return
        }
        const type = payload.type ?? ""
        if (type === "cases:updated" || type === "case:status" || type === "case:assignment" || type === "case:sla") {
          setRefreshKey((value) => value + 1)
        }
        if (type === "case:message" && payload.payload?.caseId === selectedCaseId) {
          loadCaseDetail(selectedCaseId)
        }
      } catch (error) {
        console.warn("Failed to handle case event", error)
      }
    }

    source.onerror = () => {
      source.close()
      eventSourceRef.current = null
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
    }
  }, [guildId, selectedCaseId, loadCaseDetail])

  const handleSelectSavedFilter = useCallback((id) => {
    const preset = SAVED_FILTERS.find((entry) => entry.id === id)
    if (!preset) {
      setSavedFilter(null)
      return
    }
    setSavedFilter(id)
    setFilters((prev) => ({ ...prev, ...preset.filters }))
    setRefreshKey((value) => value + 1)
  }, [])

  const handleFilterChange = useCallback((key, value) => {
    setSavedFilter(null)
    setFilters((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleSearchChange = useCallback((value) => {
    setSavedFilter(null)
    setFilters((prev) => ({ ...prev, search: value }))
  }, [])

  const currentCase = caseDetail.data

  const assignMe = useCallback(async () => {
    if (!currentCase) {
      return
    }
    const targetGuildId = guildId ?? currentCase.guildId ?? null
    if (!targetGuildId) {
      return
    }
    try {
      const payload = {
        guildId: targetGuildId,
        assigneeId: user?.id ?? null,
        assigneeTag: buildUserTag(user)
      }
      await fetch(`/api/cases/${currentCase.id}/assignee`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
      await loadCaseDetail(currentCase.id)
      setRefreshKey((value) => value + 1)
    } catch (error) {
      console.error("Failed to assign case", error)
      alert("Unable to assign this case right now.")
    }
  }, [currentCase, guildId, user, loadCaseDetail])

  const clearAssignee = useCallback(async () => {
    if (!currentCase) {
      return
    }
    const targetGuildId = guildId ?? currentCase.guildId ?? null
    if (!targetGuildId) {
      return
    }
    try {
      await fetch(`/api/cases/${currentCase.id}/assignee`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guildId: targetGuildId })
      })
      await loadCaseDetail(currentCase.id)
      setRefreshKey((value) => value + 1)
    } catch (error) {
      console.error("Failed to clear assignee", error)
      alert("Unable to clear the assignee right now.")
    }
  }, [currentCase, guildId, loadCaseDetail])

  const updateCaseStatus = useCallback(async (nextStatus) => {
    if (!currentCase) {
      return
    }
    const targetGuildId = guildId ?? currentCase.guildId ?? null
    if (!targetGuildId) {
      return
    }
    try {
      await fetch(`/api/cases/${currentCase.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guildId: targetGuildId, status: nextStatus })
      })
      await loadCaseDetail(currentCase.id)
      setRefreshKey((value) => value + 1)
    } catch (error) {
      console.error("Failed to update case status", error)
      alert("Unable to update the case status.")
    }
  }, [currentCase, guildId, loadCaseDetail])

  const updateSla = useCallback(async () => {
    if (!currentCase) {
      return
    }
    const targetGuildId = guildId ?? currentCase.guildId ?? null
    if (!targetGuildId) {
      return
    }
    const value = window.prompt(
      "Enter SLA due date and time (ISO or YYYY-MM-DD HH:MM). Leave empty to clear.",
      currentCase.sla?.dueAt ? new Date(currentCase.sla.dueAt).toISOString() : ""
    )
    if (value === null) {
      return
    }
    const body = value.trim()
      ? { guildId: targetGuildId, dueAt: value.trim() }
      : { guildId: targetGuildId, dueAt: null }
    try {
      await fetch(`/api/cases/${currentCase.id}/sla`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      })
      await loadCaseDetail(currentCase.id)
      setRefreshKey((value) => value + 1)
    } catch (error) {
      console.error("Failed to update SLA", error)
      alert("Unable to update the SLA for this case.")
    }
  }, [currentCase, guildId, loadCaseDetail])

  const sendMessage = useCallback(async () => {
    if (!currentCase) {
      return
    }
    const content = composer.trim()
    const targetGuildId = guildId ?? currentCase.guildId ?? null
    if (!targetGuildId || !content) {
      return
    }
    setComposer("")
    try {
      await fetch(`/api/cases/${currentCase.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guildId: targetGuildId, content })
      })
      await loadCaseDetail(currentCase.id)
    } catch (error) {
      console.error("Failed to send message", error)
      alert("Unable to deliver your message.")
    }
  }, [currentCase, guildId, composer, loadCaseDetail])

  const triggerQuickAction = useCallback(async (action) => {
    if (!currentCase || !guildId) {
      return
    }
    const reason = window.prompt(`Provide a reason for ${action} (optional).`, "")
    try {
      await fetch(`/api/moderation/actions/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          userId: currentCase.userId,
          reason: reason ?? "",
          caseId: currentCase.id
        })
      })
      await loadCaseDetail(currentCase.id)
      setRefreshKey((value) => value + 1)
    } catch (error) {
      console.error(`Failed to run ${action}`, error)
      alert(`Unable to run the ${action} action.`)
    }
  }, [currentCase, guildId, loadCaseDetail])

  return (
    <div className="page cases-page">
      <header className="page__header">
        <div>
          <h1>Cases</h1>
          <p>Monitor, triage, and resolve member cases across the workspace.</p>
        </div>
        <div className="cases-header__filters">
          <SavedFiltersBar active={savedFilter} onSelect={handleSelectSavedFilter} />
          <div className="cases-filter-grid">
            <select value={filters.status} onChange={(event) => handleFilterChange("status", event.target.value)}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select value={filters.category} onChange={(event) => handleFilterChange("category", event.target.value)}>
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select value={filters.assignee} onChange={(event) => handleFilterChange("assignee", event.target.value)}>
              <option value="all">All assignees</option>
              <option value="me">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
            </select>
            <select value={filters.sla} onChange={(event) => handleFilterChange("sla", event.target.value)}>
              {SLA_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select value={filters.sortBy} onChange={(event) => handleFilterChange("sortBy", event.target.value)}>
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <input
              type="search"
              value={filters.search}
              placeholder="Search cases, members, subject..."
              onChange={(event) => handleSearchChange(event.target.value)}
            />
          </div>
        </div>
      </header>

      <div className="case-workspace">
        <aside className="case-list" role="navigation" aria-label="Cases">
          {casesState.loading ? (
            <p className="placeholder">Loading cases...</p>
          ) : casesState.error ? (
            <p className="placeholder error">{casesState.error}</p>
          ) : casesState.items.length === 0 ? (
            <p className="placeholder">No cases match the current filters.</p>
          ) : (
            <ul>
              {casesState.items.map((item) => (
                <CaseListItem
                  key={item.id}
                  item={item}
                  active={selectedCaseId === item.id}
                  onSelect={() => navigateToCase(item.id)}
                />
              ))}
            </ul>
          )}
        </aside>

        <section className="case-detail" aria-live="polite">
          {!selectedCaseId ? (
            <div className="placeholder">
              <p>Select a case to see its details.</p>
            </div>
          ) : caseDetail.loading ? (
            <div className="placeholder">
              <p>Loading case details...</p>
            </div>
          ) : caseDetail.error ? (
            <div className="placeholder error">
              <p>{caseDetail.error}</p>
            </div>
          ) : currentCase ? (
            <CaseDetail
              caseData={currentCase}
              composer={composer}
              onComposerChange={setComposer}
              onSendMessage={sendMessage}
              onUpdateStatus={updateCaseStatus}
              onAssignMe={assignMe}
              onClearAssignee={clearAssignee}
              onUpdateSla={updateSla}
              onQuickAction={triggerQuickAction}
            />
          ) : null}
        </section>
      </div>
    </div>
  )
}

function SavedFiltersBar({ active, onSelect }) {
  return (
    <div className="saved-filters">
      {SAVED_FILTERS.map((filter) => (
        <button
          key={filter.id}
          type="button"
          className={`saved-filter ${active === filter.id ? "saved-filter--active" : ""}`}
          onClick={() => onSelect(filter.id)}
        >
          {filter.label}
        </button>
      ))}
    </div>
  )
}

function CaseListItem({ item, active, onSelect }) {
  const assigneeLabel = item.assignee?.tag ?? item.assignee?.displayName ?? "Unassigned"
  return (
    <li className={`case-list__item ${active ? "case-list__item--active" : ""}`}>
      <button type="button" onClick={onSelect}>
        <div className="case-list__title">
          <h3>{item.subject ?? `Case ${item.id}`}</h3>
          <span className={`case-status case-status--${(item.status ?? "open").toLowerCase()}`}>{formatStatus(item.status)}</span>
        </div>
        <div className="case-list__meta">
          <span className="case-list__member">{item.userTag ?? item.userId ?? "Member"}</span>
          <span className="case-list__assignee">{assigneeLabel}</span>
          <SlaBadge sla={item.sla} />
        </div>
        <div className="case-list__timestamps">
          <span>Updated {formatRelative(item.updatedAt)}</span>
          {item.unreadCount > 0 ? <span className="case-list__badge">{item.unreadCount}</span> : null}
        </div>
      </button>
    </li>
  )
}

function CaseDetail({ caseData, composer, onComposerChange, onSendMessage, onUpdateStatus, onAssignMe, onClearAssignee, onUpdateSla, onQuickAction }) {
  const status = caseData.status ?? "open"
  const assigneeLabel = caseData.assignee?.tag ?? caseData.assignee?.displayName ?? "Unassigned"

  return (
    <div className="case-detail__content">
      <header className="case-detail__header">
        <div>
          <h2>{caseData.subject ?? `Case ${caseData.id}`}</h2>
          <p>Opened {formatRelative(caseData.createdAt)} by {caseData.userTag ?? caseData.userId ?? "member"}.</p>
        </div>
        <div className="case-detail__status">
          <span className={`case-status case-status--${status.toLowerCase()}`}>{formatStatus(status)}</span>
          <SlaBadge sla={caseData.sla} />
        </div>
      </header>

      <section className="case-detail__section">
        <h3>Ownership</h3>
        <p className="case-detail__assignee">Currently assigned to <strong>{assigneeLabel}</strong></p>
        <div className="case-detail__actions">
          <button type="button" className="button button--primary" onClick={onAssignMe}>Assign to me</button>
          <button type="button" className="button button--ghost" onClick={onClearAssignee}>Clear assignee</button>
          <button type="button" className="button button--ghost" onClick={onUpdateSla}>Set SLA</button>
        </div>
      </section>

      <section className="case-detail__section">
        <h3>Case actions</h3>
        <div className="case-detail__actions">
          <button type="button" className="button" onClick={() => onUpdateStatus("open")}>Reopen</button>
          <button type="button" className="button" onClick={() => onUpdateStatus("escalated")}>Escalate</button>
          <button type="button" className="button button--danger" onClick={() => onUpdateStatus("closed")}>Close case</button>
        </div>
        <div className="case-detail__quick">
          <p>Quick actions</p>
          <div className="case-detail__actions">
            <button type="button" className="button button--ghost" onClick={() => onQuickAction("warn")}>Warn</button>
            <button type="button" className="button button--ghost" onClick={() => onQuickAction("timeout")}>Timeout</button>
            <button type="button" className="button button--ghost" onClick={() => onQuickAction("kick")}>Kick</button>
            <button type="button" className="button button--ghost" onClick={() => onQuickAction("ban")}>Ban</button>
          </div>
        </div>
      </section>

      <section className="case-detail__section">
        <h3>Timeline</h3>
        <Timeline caseData={caseData} />
      </section>

      <section className="case-detail__section">
        <h3>Reply</h3>
        <textarea
          rows={3}
          value={composer}
          onChange={(event) => onComposerChange(event.target.value)}
          placeholder="Send a message to the member"
        />
        <div className="case-detail__actions">
          <button type="button" className="button button--primary" onClick={onSendMessage} disabled={!composer.trim()}>Send message</button>
        </div>
      </section>
    </div>
  )
}

function Timeline({ caseData }) {
  const actions = Array.isArray(caseData.actions) ? caseData.actions : []
  const messages = Array.isArray(caseData.messages) ? caseData.messages : []

  const items = [...actions.map((entry) => ({ type: "action", ...entry })), ...messages.map((entry) => ({ type: "message", ...entry }))]
    .sort((a, b) => new Date(a.createdAt ?? a.timestamp ?? 0).getTime() - new Date(b.createdAt ?? b.timestamp ?? 0).getTime())

  if (!items.length) {
    return <p className="placeholder">No activity recorded yet.</p>
  }

  return (
    <ul className="case-timeline">
      {items.map((item) => (
        <li key={`${item.type}-${item.id ?? item.createdAt}`}>{renderTimelineItem(item)}</li>
      ))}
    </ul>
  )
}

function renderTimelineItem(item) {
  if (item.type === "message") {
    return (
      <article className="timeline-message">
        <header>
          <span>{item.authorTag ?? item.authorId ?? "System"}</span>
          <time>{formatRelative(item.createdAt)}</time>
        </header>
        <p>{item.body ?? item.content ?? ""}</p>
      </article>
    )
  }
  const label = item.status ? `Status changed to ${formatStatus(item.status)}` : item.action ? `Action ${item.action}` : "Update"
  return (
    <article className="timeline-action">
      <header>
        <span>{item.actorTag ?? item.actorId ?? "System"}</span>
        <time>{formatRelative(item.createdAt)}</time>
      </header>
      <p>{label}</p>
      {item.note ? <p className="timeline-note">{item.note}</p> : null}
    </article>
  )
}

function SlaBadge({ sla }) {
  if (!sla || !sla.dueAt) {
    return <span className="sla-badge sla-badge--none">No SLA</span>
  }
  const state = sla.state ?? resolveSlaState({ sla })
  let label = "SLA"
  if (state === "overdue") label = "Overdue"
  else if (state === "due-soon") label = "Due soon"
  else if (state === "pending") label = "On track"
  else if (state === "met") label = "Met"

  return (
    <span className={`sla-badge sla-badge--${state}`}>
      {label} | {formatRelative(sla.dueAt)}
    </span>
  )
}

function resolveSlaState(entry) {
  if (!entry || !entry.sla || !entry.sla.dueAt) {
    return "none"
  }
  if (entry.sla.completedAt) {
    return "met"
  }
  const normalizedStatus = entry.status ? String(entry.status).toLowerCase() : null
  if (normalizedStatus === "closed" || normalizedStatus === "archived") {
    return "met"
  }
  const due = Date.parse(entry.sla.dueAt)
  if (!Number.isFinite(due)) {
    return "none"
  }
  const now = Date.now()
  if (due < now) {
    return "overdue"
  }
  const hours = (due - now) / (1000 * 60 * 60)
  if (hours <= 24) {
    return "due-soon"
  }
  return "pending"
}

function buildUserTag(user) {
  if (!user) {
    return null
  }
  if (user.globalName) {
    return user.globalName
  }
  if (user.username) {
    return user.discriminator && user.discriminator !== "0" ? `${user.username}#${user.discriminator}` : user.username
  }
  return null
}

function formatRelative(value) {
  if (!value) {
    return "unknown"
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "unknown"
  }
  const diff = Date.now() - date.getTime()
  const minutes = Math.round(diff / (1000 * 60))
  if (minutes < 1) {
    return "just now"
  }
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }
  const days = Math.round(hours / 24)
  if (days < 7) {
    return `${days}d ago`
  }
  return date.toLocaleDateString()
}

function formatStatus(value) {
  const normalized = String(value ?? "open").toLowerCase()
  switch (normalized) {
    case "pending-response":
      return "Awaiting reply"
    case "escalated":
      return "Escalated"
    case "closed":
      return "Closed"
    case "archived":
      return "Archived"
    case "open":
      return "Open"
    default:
      return normalized.replace(/-/g, " ")
  }
}
