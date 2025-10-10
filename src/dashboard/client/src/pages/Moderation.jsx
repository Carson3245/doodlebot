import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGuild } from '../guildContext.js'
import { useAuth } from '../authContext.js'
import { formatDateTime } from '../utils.js'

const FILTER_DETAILS = {
  links: {
    label: 'Link filter',
    helper: 'Removes unapproved URLs and phishing attempts.'
  },
  invites: {
    label: 'Block server invites',
    helper: 'Stops users from advertising other servers.'
  },
  media: {
    label: 'Media attachments',
    helper: 'Restricts rich media uploads from new members.'
  },
  profanity: {
    label: 'Profanity filter',
    helper: 'Automatically removes messages with blocked words.'
  }
}

const TEMPLATE_LABELS = {
  warn: 'Warning DM',
  timeout: 'Timeout DM',
  ban: 'Ban DM'
}

function createQuickActionState() {
  return {
    kick: { user: '', reason: '', feedback: null, pending: false },
    ban: { user: '', reason: '', feedback: null, pending: false },
    timeout: { user: '', reason: '', duration: '', feedback: null, pending: false },
    warn: { user: '', reason: '', feedback: null, pending: false }
  }
}

function createEmptyCaseDetail() {
  return {
    loading: false,
    messages: [],
    participants: [],
    subject: '',
    status: null,
    openedAt: null,
    openedBy: null,
    error: null,
    sending: false,
    statusUpdating: false,
    unreadCount: 0
  }
}

const feedbackPalette = {
  success: { color: 'var(--success, #4caf50)' },
  error: { color: 'var(--danger, #e53935)' },
  info: { color: 'var(--accent, #4f86f7)' }
}

const CASE_FILTER_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'pending-response', label: 'Awaiting member reply' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'open', label: 'Open only' },
  { value: 'closed', label: 'Closed' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All cases' }
]

export default function ModerationPage() {
  const { authenticated, refreshAuth } = useAuth()
  const { selectedGuild } = useGuild()
  const [memberLookup, setMemberLookup] = useState({
    kick: { results: [], loading: false },
    ban: { results: [], loading: false },
    timeout: { results: [], loading: false },
    warn: { results: [], loading: false }
  })
  const lookupTimers = useRef({})
  const caseMenuRef = useRef(null)
  const eventSourceRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const [quickActionTargets, setQuickActionTargets] = useState({
    kick: null,
    ban: null,
    timeout: null,
    warn: null
  })
  const [stats, setStats] = useState({
    loading: true,
    bans: 0,
    timeouts: 0,
    kicks: 0,
    warnings: 0,
    cases: 0,
    updatedAt: null,
    error: null
  })
  const [caseInbox, setCaseInbox] = useState({
    loading: true,
    items: [],
    error: null,
    selectedCaseId: null,
    selectedCaseGuildId: null
  })
  const [caseDetail, setCaseDetail] = useState(() => createEmptyCaseDetail())
  const [caseReply, setCaseReply] = useState('')
  const [caseMenuOpen, setCaseMenuOpen] = useState(false)
  const [caseFilter, setCaseFilter] = useState('active')
  const caseCountSummary = useMemo(
    () => formatCaseFilterSummary(caseFilter, caseInbox.items.length),
    [caseFilter, caseInbox.items.length]
  )
  const conversationLocked = isCaseTerminal(caseDetail.status)
  const archivedCase = isCaseArchived(caseDetail.status)
  const [config, setConfig] = useState(null)
  const [keywordsInput, setKeywordsInput] = useState('')
  const [feedback, setFeedback] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [quickActions, setQuickActions] = useState(() => createQuickActionState())
  const [collapsedPanels, setCollapsedPanels] = useState(() => ({
    quickActions: true,
    filters: true,
    spam: true,
    escalation: true,
    alerts: true,
    templates: true
  }))

  const togglePanel = useCallback((panel) => {
    setCollapsedPanels((previous) => ({
      ...previous,
      [panel]: !previous[panel]
    }))
  }, [])

  useEffect(() => {
    Object.values(lookupTimers.current).forEach((timer) => clearTimeout(timer))
    lookupTimers.current = {}
    setMemberLookup({
      kick: { results: [], loading: false },
      ban: { results: [], loading: false },
      timeout: { results: [], loading: false },
      warn: { results: [], loading: false }
    })
    setQuickActions(createQuickActionState())
    setQuickActionTargets({ kick: null, ban: null, timeout: null, warn: null })
  }, [selectedGuild?.id])

  const keywordList = useMemo(() => config?.filters?.customKeywords ?? [], [config?.filters?.customKeywords])

  const loadStats = useCallback(async () => {
    if (!authenticated) {
      setStats({
        loading: false,
        bans: 0,
        timeouts: 0,
        kicks: 0,
        warnings: 0,
        cases: 0,
        updatedAt: null,
        error: null
      })
      return
    }
    try {
      setStats((prev) => ({ ...prev, loading: true, error: null }))
      const response = await fetch('/api/moderation/stats')
      if (response.status === 401) {
        refreshAuth()
        return
      }
      if (!response.ok) {
        throw new Error('Failed to load moderation stats')
      }
      const data = await response.json()
      setStats({
        loading: false,
        bans: data.bans ?? 0,
        timeouts: data.timeouts ?? 0,
        kicks: data.kicks ?? 0,
        warnings: data.warnings ?? 0,
        cases: data.cases ?? 0,
        updatedAt: data.updatedAt ?? null,
        error: null
      })
    } catch (error) {
      console.error('Failed to load moderation stats', error)
      setStats((prev) => ({
        ...prev,
        loading: false,
        error: 'Unable to load moderation stats.'
      }))
    }
  }, [authenticated, refreshAuth])

  const loadCases = useCallback(async () => {
    if (!authenticated) {
      setCaseInbox({
        loading: false,
        items: [],
        error: null,
        selectedCaseId: null,
        selectedCaseGuildId: null
      })
      setCaseDetail(createEmptyCaseDetail())
      setCaseReply('')
      return
    }

    try {
      setCaseInbox((prev) => ({ ...prev, loading: true, error: null }))
      const params = new URLSearchParams()
      if (selectedGuild?.id) {
        params.set('guildId', selectedGuild.id)
      }
      const statusParam = resolveCaseFilterParam(caseFilter)
      if (statusParam && statusParam !== 'all') {
        params.set('status', statusParam)
      }
      const query = params.toString()
      const response = await fetch(`/api/moderation/cases${query ? `?${query}` : ''}`)
      if (response.status === 401) {
        refreshAuth()
        return
      }
      if (!response.ok) {
        throw new Error('Failed to load moderation cases')
      }
      const data = await response.json()
      setCaseInbox((prev) => {
        const rawItems = Array.isArray(data) ? data : []
        const filteredItems = applyCaseFilter(rawItems, caseFilter)
        const hasCurrent =
          prev.selectedCaseId && filteredItems.some((item) => item.id === prev.selectedCaseId)
        const nextSelectedCaseId = hasCurrent ? prev.selectedCaseId : filteredItems[0]?.id ?? null
        const nextSelectedGuildId = nextSelectedCaseId
          ? filteredItems.find((item) => item.id === nextSelectedCaseId)?.guildId ??
            rawItems.find((item) => item.id === nextSelectedCaseId)?.guildId ??
            null
          : null
        return {
          loading: false,
          items: filteredItems,
          error: null,
          selectedCaseId: nextSelectedCaseId,
          selectedCaseGuildId: nextSelectedGuildId
        }
      })
    } catch (error) {
      console.error('Failed to load moderation cases', error)
      setCaseInbox((prev) => ({
        ...prev,
        loading: false,
        error: 'Unable to load moderation cases.'
      }))
    }
  }, [authenticated, caseFilter, refreshAuth, selectedGuild?.id])

  const loadCaseDetail = useCallback(
    async (caseId, guildId) => {
      if (!caseId || !guildId || !authenticated) {
        setCaseDetail(createEmptyCaseDetail())
        setCaseReply('')
        return
      }

      try {
        setCaseDetail((prev) => ({ ...prev, loading: true, error: null }))
        const response = await fetch(`/api/guilds/${guildId}/cases/${caseId}`)
        if (response.status === 401) {
          refreshAuth()
          return
        }
        if (!response.ok) {
          throw new Error('Failed to load case details')
        }
        const data = await response.json()
        setCaseDetail({
          loading: false,
          messages: Array.isArray(data?.messages) ? data.messages : [],
          participants: Array.isArray(data?.participants) ? data.participants : [],
          subject: data?.subject ?? '',
          status: data?.status ?? 'open',
          openedAt: data?.openedAt ?? null,
          openedBy: data?.openedBy ?? null,
          error: null,
          sending: false,
          statusUpdating: false,
          unreadCount: data?.unreadCount ?? 0
        })
        setCaseReply('')
        setCaseInbox((prev) => ({
          ...prev,
          items: prev.items.map((item) =>
            item.id === caseId ? { ...item, unreadCount: 0, status: data?.status ?? item.status } : item
          ),
          selectedCaseGuildId: guildId
        }))
      } catch (error) {
        console.error('Failed to load case detail', error)
        setCaseDetail((prev) => ({
          ...prev,
          loading: false,
          sending: false,
          statusUpdating: false,
          error: 'Unable to load the selected case.'
        }))
      }
    },
    [authenticated, refreshAuth]
  )

  const handleRealtimeEvent = useCallback(
    (event) => {
      if (!authenticated) {
        return
      }
      if (!event || typeof event !== 'object') {
        return
      }
      const { type, payload } = event
      if (!type) {
        return
      }
      if (type === 'connected') {
        return
      }
      if (type === 'stats:updated') {
        if (payload && typeof payload === 'object') {
          setStats({
            loading: false,
            bans: payload.bans ?? 0,
            timeouts: payload.timeouts ?? 0,
            kicks: payload.kicks ?? 0,
            warnings: payload.warnings ?? 0,
            cases: payload.cases ?? 0,
            updatedAt: payload.updatedAt ?? null,
            error: null
          })
        } else {
          loadStats()
        }
        return
      }

      if (
        type === 'case:message' ||
        type === 'cases:updated' ||
        type === 'case:status' ||
        type === 'case:created' ||
        type === 'case:deleted'
      ) {
        loadCases()
        const targetCaseId = payload?.caseId ?? payload?.id ?? null
        if (targetCaseId && caseInbox.selectedCaseId === targetCaseId) {
          const guildId =
            payload?.guildId ?? caseInbox.selectedCaseGuildId ?? selectedGuild?.id ?? null
          if (type === 'case:deleted' || payload?.deleted) {
            setCaseInbox((prev) => ({
              ...prev,
              selectedCaseId: null,
              selectedCaseGuildId: null
            }))
            setCaseMenuOpen(false)
            loadCaseDetail(null, null)
          } else if (guildId) {
            loadCaseDetail(targetCaseId, guildId)
          }
        }
      }
    },
    [
      authenticated,
      caseInbox.selectedCaseId,
      caseInbox.selectedCaseGuildId,
      loadCaseDetail,
      loadCases,
      loadStats,
      selectedGuild?.id
    ]
  )

  useEffect(() => {
    loadStats()
  }, [loadStats])

  useEffect(() => {
    loadCases()
  }, [loadCases])

  useEffect(() => {
    if (caseInbox.selectedCaseId) {
      const guildId = caseInbox.selectedCaseGuildId || selectedGuild?.id || null
      loadCaseDetail(caseInbox.selectedCaseId, guildId)
    } else {
      loadCaseDetail(null, null)
    }
  }, [caseInbox.selectedCaseGuildId, caseInbox.selectedCaseId, loadCaseDetail, selectedGuild?.id])

  useEffect(() => {
    if (!authenticated) {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      return
    }

    let cancelled = false

    const connect = () => {
      if (cancelled || eventSourceRef.current) {
        return
      }
      const source = new EventSource('/api/moderation/events')
      eventSourceRef.current = source

      source.onmessage = (event) => {
        if (!event?.data) {
          return
        }
        try {
          const parsed = JSON.parse(event.data)
          handleRealtimeEvent(parsed)
        } catch (error) {
          console.error('Failed to parse moderation event payload', error, event.data)
        }
      }

      source.onerror = () => {
        if (cancelled) {
          return
        }
        if (eventSourceRef.current) {
          eventSourceRef.current.close()
          eventSourceRef.current = null
        }
        if (typeof refreshAuth === 'function') {
          refreshAuth()
        }
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current)
        }
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null
          connect()
        }, 5000)
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
    }
  }, [authenticated, handleRealtimeEvent, refreshAuth])

  useEffect(() => {
    const handleClickAway = (event) => {
      if (!caseMenuRef.current) return
      if (!caseMenuRef.current.contains(event.target)) {
        setCaseMenuOpen(false)
      }
    }

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setCaseMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickAway)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickAway)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  useEffect(() => {
    if (!authenticated) {
      setConfig(null)
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)

    const loadModeration = async () => {
      try {
        const response = await fetch('/api/moderation')
        if (response.status === 401) {
          refreshAuth()
          return
        }
        if (!response.ok) {
          throw new Error('Failed to load moderation config')
        }
        const data = await response.json()
        if (active) {
          setConfig(data)
          setLoading(false)
        }
      } catch (error) {
        console.error('Failed to load moderation config', error)
        if (active) {
          setConfig(null)
          setLoading(false)
          setFeedback('Could not load moderation configuration.')
        }
      }
    }

    loadModeration()
    return () => {
      active = false
    }
  }, [authenticated, refreshAuth])

  const updateQuickAction = useCallback((action, patch) => {
    setQuickActions((prev) => ({
      ...prev,
      [action]: {
        ...prev[action],
        ...patch
      }
    }))
  }, [])

  const handleSelectCase = useCallback((caseId) => {
    setCaseInbox((prev) => {
      const match = prev.items.find((item) => item.id === caseId)
      return {
        ...prev,
        selectedCaseId: caseId,
        selectedCaseGuildId: match?.guildId ?? prev.selectedCaseGuildId ?? null
      }
    })
    setCaseMenuOpen(false)
  }, [])

  const handleSendCaseMessage = useCallback(
    async (event) => {
      event.preventDefault()
      if (!caseInbox.selectedCaseId) {
        return
      }
      const trimmed = caseReply.trim()
      if (!trimmed) {
        return
      }
      const guildId = selectedGuild?.id || caseInbox.selectedCaseGuildId
      if (!guildId) {
        setCaseDetail((prev) => ({
          ...prev,
          error: 'Select a guild to reply to this case.'
        }))
        return
      }
      if (!authenticated) {
        setCaseDetail((prev) => ({
          ...prev,
          error: 'Please log in with a moderator account to reply.'
        }))
        return
      }

      setCaseDetail((prev) => ({ ...prev, sending: true, error: null }))
      try {
        const response = await fetch(`/api/guilds/${guildId}/cases/${caseInbox.selectedCaseId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: trimmed })
        })
        if (response.status === 401) {
          refreshAuth()
          setCaseDetail((prev) => ({
            ...prev,
            sending: false,
            error: 'Session expired. Log in again.'
          }))
          return
        }
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data?.error || 'Unable to send message.')
        }
        setCaseReply('')
        await loadCaseDetail(caseInbox.selectedCaseId, guildId)
      } catch (error) {
        console.error('Failed to send case reply', error)
        setCaseDetail((prev) => ({
          ...prev,
          sending: false,
          error: error?.message ?? 'Failed to send message.'
        }))
        return
      }
      setCaseDetail((prev) => ({ ...prev, sending: false }))
      loadCases()
    },
    [
      authenticated,
      caseInbox.selectedCaseGuildId,
      caseInbox.selectedCaseId,
      caseReply,
      loadCaseDetail,
      loadCases,
      refreshAuth,
      selectedGuild?.id
    ]
  )

  const handleUpdateCaseStatus = useCallback(
    async (nextStatus) => {
      if (!caseInbox.selectedCaseId) {
        return
      }
      const guildId = selectedGuild?.id || caseInbox.selectedCaseGuildId
      if (!guildId) {
        setCaseDetail((prev) => ({
          ...prev,
          error: 'Select a guild before updating the case status.'
        }))
        return
      }
      if (!authenticated) {
        setCaseDetail((prev) => ({
          ...prev,
          error: 'Please log in with a moderator account to update the case status.'
        }))
        return
      }

      setCaseDetail((prev) => ({ ...prev, statusUpdating: true, error: null }))
      try {
        const response = await fetch(`/api/guilds/${guildId}/cases/${caseInbox.selectedCaseId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: nextStatus })
        })
        if (response.status === 401) {
          refreshAuth()
          setCaseDetail((prev) => ({
            ...prev,
            statusUpdating: false,
            error: 'Session expired. Log in again.'
          }))
          return
        }
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data?.error || 'Unable to update case status.')
        }
        setCaseDetail((prev) => ({
          ...prev,
          status: nextStatus,
          statusUpdating: false,
          error: null
        }))
        setCaseInbox((prev) => ({
          ...prev,
          items: prev.items.map((item) =>
            item.id === caseInbox.selectedCaseId ? { ...item, status: nextStatus } : item
          ),
          selectedCaseGuildId: guildId
        }))
        setCaseMenuOpen(false)
        loadCases()
      } catch (error) {
        console.error('Failed to update case status', error)
        setCaseDetail((prev) => ({
          ...prev,
          statusUpdating: false,
          error: error?.message ?? 'Failed to update status.'
        }))
      }
    },
    [authenticated, caseInbox.selectedCaseGuildId, caseInbox.selectedCaseId, loadCases, refreshAuth, selectedGuild?.id]
  )

  const handleDeleteCase = useCallback(async () => {
    if (!caseInbox.selectedCaseId) {
      return
    }

    const currentCaseId = caseInbox.selectedCaseId
    const currentGuildId = caseInbox.selectedCaseGuildId

    const confirmed =
      typeof window === 'undefined'
        ? true
        : window.confirm('Are you sure you want to delete this case? This cannot be undone.')
    if (!confirmed) {
      setCaseMenuOpen(false)
      return
    }

    const guildId = selectedGuild?.id || currentGuildId
    if (!guildId) {
      setCaseDetail((prev) => ({
        ...prev,
        error: 'Select a server before deleting the case.'
      }))
      return
    }
    if (!authenticated) {
      setCaseDetail((prev) => ({
        ...prev,
        error: 'Sign in with a moderator account to delete the case.'
      }))
      return
    }

    setCaseDetail((prev) => ({ ...prev, statusUpdating: true, error: null }))
    try {
      const response = await fetch(`/api/guilds/${guildId}/cases/${currentCaseId}`, {
        method: 'DELETE'
      })
      if (response.status === 401) {
        refreshAuth()
        setCaseDetail((prev) => ({
          ...prev,
          statusUpdating: false,
          error: 'Session expired. Please log in again.'
        }))
        return
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data?.error || 'Unable to delete case.')
      }

      let nextCaseId = null
      let nextCaseGuildId = null
      setCaseInbox((prev) => {
        const filtered = prev.items.filter((item) => item.id !== currentCaseId)
        nextCaseId = filtered[0]?.id ?? null
        nextCaseGuildId = nextCaseId
          ? filtered.find((item) => item.id === nextCaseId)?.guildId ??
            prev.selectedCaseGuildId ??
            selectedGuild?.id ??
            null
          : null
        return {
          ...prev,
          items: filtered,
          selectedCaseId: nextCaseId,
          selectedCaseGuildId: nextCaseGuildId
        }
      })

      setCaseDetail(createEmptyCaseDetail())
      setCaseReply('')
      setCaseMenuOpen(false)

      if (nextCaseId && nextCaseGuildId) {
        loadCaseDetail(nextCaseId, nextCaseGuildId)
      }

      loadCases()
    } catch (error) {
      console.error('Failed to delete case', error)
      setCaseDetail((prev) => ({
        ...prev,
        statusUpdating: false,
        error: error?.message ?? 'Failed to delete case.'
      }))
    }
  }, [
    authenticated,
    caseInbox.selectedCaseGuildId,
    caseInbox.selectedCaseId,
    loadCaseDetail,
    loadCases,
    refreshAuth,
    selectedGuild?.id
  ])

  const performMemberLookup = useCallback(
    async (action, query) => {
      if (!selectedGuild?.id) {
        return
      }
      try {
        const response = await fetch(`/api/guilds/${selectedGuild.id}/members?query=${encodeURIComponent(query)}&limit=10`)
        if (!response.ok) {
          throw new Error(`Status ${response.status}`)
        }
        const data = await response.json()
        const results = Array.isArray(data) ? data : []
        setMemberLookup((prev) => ({
          ...prev,
          [action]: { results, loading: false }
        }))
      } catch (error) {
        console.error('Failed to search members', error)
        setMemberLookup((prev) => ({
          ...prev,
          [action]: { results: [], loading: false }
        }))
      }
    },
    [selectedGuild?.id]
  )

  useEffect(() => {
    return () => {
      Object.values(lookupTimers.current).forEach((timer) => clearTimeout(timer))
    }
  }, [])

  const handleMemberPick = useCallback(
    (action, member) => {
      setQuickActionTargets((prev) => ({ ...prev, [action]: member }))
      updateQuickAction(action, { user: member.id })
      setMemberLookup((prev) => ({
        ...prev,
        [action]: { results: [], loading: false }
      }))
    },
    [updateQuickAction]
  )

  const handleMemberInput = useCallback(
    (action, value) => {
      updateQuickAction(action, { user: value })
      setQuickActionTargets((prev) => ({ ...prev, [action]: null }))
      if (!selectedGuild?.id || value.trim().length < 2) {
        setMemberLookup((prev) => ({
          ...prev,
          [action]: { results: [], loading: false }
        }))
        return
      }
      if (lookupTimers.current[action]) {
        clearTimeout(lookupTimers.current[action])
      }
      setMemberLookup((prev) => ({
        ...prev,
        [action]: { ...prev[action], loading: true }
      }))
      lookupTimers.current[action] = setTimeout(() => {
        performMemberLookup(action, value.trim())
      }, 250)
    },
    [performMemberLookup, selectedGuild?.id, updateQuickAction]
  )

  const handleMemberBlur = useCallback(
    (action) => {
      const value = quickActions[action].user.trim()
      if (!value) {
        setQuickActionTargets((prev) => ({ ...prev, [action]: null }))
        return
      }
      const match = memberLookup[action].results.find((member) => {
        const lower = value.toLowerCase()
        return (
          member.id === value ||
          (member.displayName && member.displayName.toLowerCase() === lower) ||
          (member.username && member.username.toLowerCase() === lower)
        )
      })
      if (match) {
        updateQuickAction(action, { user: match.id })
        setQuickActionTargets((prev) => ({ ...prev, [action]: match }))
      }
    },
    [memberLookup, quickActions, updateQuickAction]
  )

const submitQuickAction = useCallback(
    async (event, action) => {
      event.preventDefault()
      if (!authenticated) {
        updateQuickAction(action, {
          feedback: { type: 'error', text: 'Please log in with a moderator account.' },
          pending: false
        })
        return
      }

      const current = quickActions[action]
      const guildId = (selectedGuild?.id || caseInbox.selectedCaseGuildId || '').trim()
      const userInput = current.user.trim()
      const selectedMember = quickActionTargets[action]
      const userId = userInput || (selectedMember ? selectedMember.id : '')
      const trimmedReason = current.reason.trim()

      if (!guildId) {
        updateQuickAction(action, {
          feedback: { type: 'error', text: 'Select a server before running quick actions.' },
          pending: false
        })
        return
      }

      if (!userId) {
        updateQuickAction(action, {
          feedback: { type: 'error', text: 'Choose a member to moderate.' },
          pending: false
        })
        return
      }

      if (action === 'timeout') {
        const duration = Number(current.duration)
        if (!Number.isFinite(duration) || duration <= 0) {
          updateQuickAction(action, {
            feedback: { type: 'error', text: 'Set a valid timeout duration (minutes).' },
            pending: false
          })
          return
        }
      }

      updateQuickAction(action, {
        pending: true,
        feedback: { type: 'info', text: 'Submitting action...' }
      })

      const payload = {
        guildId,
        userId,
        reason: trimmedReason || 'Dashboard action'
      }

      if (action === 'timeout') {
        payload.durationMinutes = Math.min(
          Math.max(Number(current.duration), 1),
          10_080
        )
      }

      try {
        const response = await fetch(`/api/moderation/actions/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })

        if (response.status === 401) {
          refreshAuth()
          updateQuickAction(action, {
            pending: false,
            feedback: { type: 'error', text: 'Session expired. Log in again.' }
          })
          return
        }

        if (!response.ok) {
          const error = await response.json().catch(() => ({}))
          throw new Error(error.error || 'Unable to execute moderation action.')
        }

        const data = await response.json().catch(() => ({}))
        if (data?.stats) {
          setStats({
            loading: false,
            bans: data.stats.bans ?? 0,
            timeouts: data.stats.timeouts ?? 0,
            kicks: data.stats.kicks ?? 0,
            warnings: data.stats.warnings ?? 0,
            cases: data.stats.cases ?? 0,
            updatedAt: data.stats.updatedAt ?? new Date().toISOString(),
            error: null
          })
        } else {
          loadStats()
        }
        loadCases()

        setQuickActions((prev) => {
          const next = {
            ...prev[action],
            user: '',
            reason: '',
            feedback: { type: 'success', text: 'Action executed successfully.' },
            pending: false
          }
          if (action === 'timeout') {
            next.duration = ''
          }
          return {
            ...prev,
            [action]: next
          }
        })
        setQuickActionTargets((prev) => ({ ...prev, [action]: null }))
        setMemberLookup((prev) => ({
          ...prev,
          [action]: { results: [], loading: false }
        }))
      } catch (error) {
        console.error('Failed to execute quick action', error)
        updateQuickAction(action, {
          pending: false,
          feedback: { type: 'error', text: error?.message ?? 'Failed to execute action.' }
        })
      }
    },
    [
      authenticated,
      caseInbox.selectedCaseGuildId,
      loadCases,
      loadStats,
      quickActionTargets,
      quickActions,
      refreshAuth,
      selectedGuild?.id,
      updateQuickAction
    ]
  )

  const filters = config?.filters ?? {}
  const spam = config?.spam ?? {}
  const escalation = config?.escalation ?? {}
  const alerts = config?.alerts ?? {}
  const dmTemplates = config?.dmTemplates ?? {}

  const handleToggleFilter = (key) => {
    setConfig((prev) => ({
      ...prev,
      filters: {
        ...prev.filters,
        [key]: !prev.filters[key]
      }
    }))
  }

  const handleSpamChange = (key, value) => {
    setConfig((prev) => ({
      ...prev,
      spam: {
        ...prev.spam,
        [key]: value
      }
    }))
  }

  const handleEscalationChange = (key, value) => {
    setConfig((prev) => ({
      ...prev,
      escalation: {
        ...prev.escalation,
        [key]: value
      }
    }))
  }

  const handleAlertsChange = (key, value) => {
    setConfig((prev) => ({
      ...prev,
      alerts: {
        ...prev.alerts,
        [key]: value
      }
    }))
  }

  const handleTemplateChange = (key, value) => {
    setConfig((prev) => ({
      ...prev,
      dmTemplates: {
        ...prev.dmTemplates,
        [key]: value
      }
    }))
  }

  const handleAddKeyword = () => {
    const trimmed = keywordsInput.trim()
    if (!trimmed) {
      return
    }

    setConfig((prev) => ({
      ...prev,
      filters: {
        ...prev.filters,
        customKeywords: Array.from(new Set([...(prev.filters.customKeywords ?? []), trimmed]))
      }
    }))
    setKeywordsInput('')
  }

  const handleRemoveKeyword = (keyword) => {
    setConfig((prev) => ({
      ...prev,
      filters: {
        ...prev.filters,
        customKeywords: (prev.filters.customKeywords ?? []).filter((entry) => entry !== keyword)
      }
    }))
  }

  const handleSave = async () => {
    if (!config) {
      return
    }

    setSaving(true)
    setFeedback('Saving moderation configuration...')

    try {
      const response = await fetch('/api/moderation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      })

      if (response.status === 401) {
        refreshAuth()
        setFeedback('Session expired. Please log in again.')
        setSaving(false)
        return
      }

      if (!response.ok) {
        throw new Error('Failed to save moderation configuration.')
      }

      const saved = await response.json()
      setConfig(saved)
      setFeedback(`Saved at ${formatDateTime(Date.now())}`)
    } catch (error) {
      console.error('Failed to save moderation configuration', error)
      setFeedback('Could not save moderation configuration. Check server logs.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page moderation-page">
      <div className="moderation-page__layout">
        <div className="moderation-page__column moderation-page__column--primary">
          <section className="panel">
            <header className="panel__header">
              <div>
                <h2>Moderation overview</h2>
                <p>Monitor automated actions taken by the bot.</p>
              </div>
              <div className="panel__header-actions">
                <p className="panel__meta">
                  {stats.error
                    ? stats.error
                    : stats.updatedAt
                      ? `Updated ${formatDateTime(stats.updatedAt)}`
                      : 'Awaiting first update'}
                </p>
              </div>
            </header>
            <div className="panel__body stat-grid">
              <article className="stat-card">
                <p className="stat-card__label">Automated bans</p>
                <p className="stat-card__value">{stats.loading ? '--' : stats.bans}</p>
                <span className="stat-card__helper">Triggered by escalation rules</span>
              </article>
              <article className="stat-card">
                <p className="stat-card__label">Timeouts applied</p>
                <p className="stat-card__value">{stats.loading ? '--' : stats.timeouts}</p>
                <span className="stat-card__helper">Includes spam auto-timeouts</span>
              </article>
              <article className="stat-card">
                <p className="stat-card__label">Members kicked</p>
                <p className="stat-card__value">{stats.loading ? '--' : stats.kicks}</p>
                <span className="stat-card__helper">Manual removals logged</span>
              </article>
              <article className="stat-card">
                <p className="stat-card__label">Logged warnings</p>
                <p className="stat-card__value">{stats.loading ? '--' : stats.warnings}</p>
                <span className="stat-card__helper">Totals since last reset</span>
              </article>
              <article className="stat-card">
                <p className="stat-card__label">Cases on record</p>
                <p className="stat-card__value">{stats.loading ? '--' : stats.cases}</p>
                <span className="stat-card__helper">Stored in data/moderation/cases.json</span>
              </article>
            </div>
          </section>

          <section className="panel case-hub">
            <header className="panel__header">
              <div>
                <h2>Case inbox</h2>
                <p>Coordinate case conversations, triage actions, and close investigations.</p>
              </div>
              <div className="case-hub__toolbar panel__header-actions">
                <span className="panel__meta">
                  {caseInbox.loading ? 'Refreshing cases...' : caseCountSummary}
                </span>
                <label className="visually-hidden" htmlFor="case-filter">
                  Filter cases
                </label>
                <select
                  id="case-filter"
                  className="case-hub__filter"
                  value={caseFilter}
                  onChange={(event) => setCaseFilter(event.target.value)}
                  disabled={caseInbox.loading}
                >
                  {CASE_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={loadCases}
                  disabled={caseInbox.loading}
                >
                  Refresh
                </button>
              </div>
            </header>
            <div className="panel__body case-hub__body">
              <aside className="case-hub__list" aria-label="Case queue">
                {caseInbox.loading ? (
                  <p className="placeholder">Loading cases...</p>
                ) : caseInbox.error ? (
                  <p className="placeholder">{caseInbox.error}</p>
                ) : caseInbox.items.length === 0 ? (
                  <p className="placeholder">{formatEmptyCaseMessage(caseFilter)}</p>
                ) : (
                  <ul className="case-hub__items">
                    {caseInbox.items.map((item) => {
                      const isActive = item.id === caseInbox.selectedCaseId
                      const participant =
                        item.memberTag || item.userTag || item.memberName || item.userName || item.userId
                      const lastUpdate = item.updatedAt || item.createdAt
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            className={`case-card${isActive ? ' case-card--active' : ''}`}
                            onClick={() => handleSelectCase(item.id)}
                          >
                            <span className="case-card__title">{item.subject || item.reason || `Case ${item.id}`}</span>
                            <span className="case-card__participant">{participant || 'Unknown member'}</span>
                            <div className="case-card__footer">
                              <span className={`case-status case-status--${(item.status || 'open').toLowerCase()}`}>
                                {formatCaseStatus(item.status)}
                              </span>
                              {item.unreadCount > 0 && (
                                <span className="case-card__badge" aria-label={`${item.unreadCount} new messages`}>
                                  {item.unreadCount}
                                </span>
                              )}
                              {lastUpdate && (
                                <span className="case-card__time">{formatDateTime(lastUpdate)}</span>
                              )}
                            </div>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </aside>
              <div className="case-hub__conversation">
                {!caseInbox.selectedCaseId ? (
                  <div className="case-hub__placeholder">
                    <h3>Select a case</h3>
                    <p>Pick a case from the list to review history, reply to members, and trigger quick actions.</p>
                  </div>
                ) : (
                  <div className="case-hub__conversation-wrapper">
                    <header className="case-hub__conversation-header">
                      <div>
                        <h3>{caseDetail.subject || 'Member conversation'}</h3>
                        <p>
                          {caseDetail.openedBy
                            ? `Opened by ${caseDetail.openedBy.tag || caseDetail.openedBy.displayName || caseDetail.openedBy.id}`
                            : 'Waiting for case details'}
                          {caseDetail.openedAt ? ` • ${formatDateTime(caseDetail.openedAt)}` : ''}
                        </p>
                      </div>
                      <div className="case-hub__conversation-tools">
                        <button
                          type="button"
                          className="case-hub__menu-trigger"
                          ref={caseMenuRef}
                          onClick={() => setCaseMenuOpen((open) => !open)}
                          aria-haspopup="true"
                          aria-expanded={caseMenuOpen}
                        >
                          Actions
                        </button>
                        {caseMenuOpen && (
                          <div className="case-hub__menu" role="menu">
                            <button type="button" role="menuitem" onClick={() => handleCaseStatusChange('open')}>
                              {conversationLocked ? 'Reopen case' : 'Mark as open'}
                            </button>
                            <button type="button" role="menuitem" onClick={() => handleCaseStatusChange('pending-response')}>
                              Mark waiting on member
                            </button>
                            <button type="button" role="menuitem" onClick={() => handleCaseStatusChange('closed')}>
                              Close case
                            </button>
                            <button type="button" role="menuitem" onClick={() => handleCaseStatusChange('archived')}>
                              Archive case
                            </button>
                            <button type="button" role="menuitem" className="danger" onClick={handleDeleteCase}>
                              Delete case
                            </button>
                          </div>
                        )}
                      </div>
                    </header>
                    <div className="case-hub__participants">
                      {caseDetail.participants.length > 0 ? (
                        <ul>
                          {caseDetail.participants.map((participant) => (
                            <li key={participant.id}>
                              <span className={`case-participant case-participant--${participant.role}`}>
                                {participant.displayName || participant.tag || participant.id}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="placeholder">No participants recorded yet.</p>
                      )}
                    </div>
                    <div className="case-hub__conversation-body" ref={caseConversationRef}>
                      {caseDetail.loading ? (
                        <p className="placeholder">Loading conversation...</p>
                      ) : caseDetail.messages.length === 0 ? (
                        <p className="placeholder">No messages recorded for this case yet.</p>
                      ) : (
                        <ul className="case-messages">
                          {caseDetail.messages.map((message) => {
                            const role = (message.author?.role || 'member').toLowerCase()
                            return (
                              <li key={message.id || message.createdAt} className={`case-message case-message--${role}`}>
                                <header>
                                  <span className="case-message__author">
                                    {message.author?.displayName || message.author?.tag || message.author?.id || 'Membro'}
                                  </span>
                                  {message.createdAt && (
                                    <time dateTime={new Date(message.createdAt).toISOString()}>
                                      {formatDateTime(message.createdAt)}
                                    </time>
                                  )}
                                </header>
                                <p className="case-message__content">{message.content ?? ''}</p>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>

                    <form className="case-composer" onSubmit={handleSendCaseMessage}>
                      <label className="visually-hidden" htmlFor="case-reply">
                        Reply to member
                      </label>
                      <textarea
                        id="case-reply"
                        placeholder={
                          conversationLocked
                            ? 'This case is closed or archived. Reopen it to respond.'
                            : 'Type a reply to the member...'
                        }
                        value={caseReply}
                        onChange={(event) => setCaseReply(event.target.value)}
                        disabled={
                          !authenticated ||
                          caseDetail.sending ||
                          conversationLocked
                        }
                        rows={4}
                      />
                      <div className="case-composer__footer">
                        {caseDetail.error && <p className="form-helper form-helper--error">{caseDetail.error}</p>}
                        <button
                          type="submit"
                          className="button button--primary"
                          disabled={
                            !authenticated ||
                            caseDetail.sending ||
                            !caseInbox.selectedCaseId ||
                            conversationLocked
                          }
                        >
                          {caseDetail.sending ? 'Sending...' : 'Send message'}
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>

        <div className="moderation-page__column moderation-page__column--secondary">
          <section className={`panel panel--collapsible ${collapsedPanels.quickActions ? 'panel--collapsed' : ''}`}>
            <header className="panel__header">
              <div>
                <h2>Quick actions</h2>
                <p>Run manual moderation actions straight from the dashboard.</p>
              </div>
              <div className="panel__header-actions">
                <button
                  type="button"
                  className="panel__toggle"
                  aria-expanded={!collapsedPanels.quickActions}
                  aria-controls="panel-quick-actions"
                  onClick={() => togglePanel('quickActions')}
                >
                  {collapsedPanels.quickActions ? 'Expand' : 'Collapse'}
                  <span className="panel__toggle-icon" aria-hidden="true">▾</span>
                </button>
              </div>
            </header>
            <div
              id="panel-quick-actions"
              className="panel__body quick-actions"
              data-auth-signed-in
              hidden={collapsedPanels.quickActions}
            >
              {authenticated ? (
                <>
                  <p className="helper">
                    Your dashboard session will be used as the moderator identity. Pick a server in the header and search for a
                    member below to auto-fill their ID with avatar previews.
                  </p>
                  {selectedGuild ? (
                    <div className="quick-actions__grid">
                      <form className="form quick-action" data-action="kick" onSubmit={(event) => submitQuickAction(event, 'kick')}>
                        <h3>Kick</h3>
                        <div className="form-row">
                          <label htmlFor="kick-user">Member</label>
                          <input
                            id="kick-user"
                            name="user"
                            type="search"
                            placeholder="Search by name or ID"
                            value={quickActions.kick.user}
                            onChange={(event) => handleMemberInput('kick', event.target.value)}
                            onBlur={() => handleMemberBlur('kick')}
                            disabled={!authenticated || !selectedGuild || quickActions.kick.pending}
                            autoComplete="off"
                            aria-autocomplete="list"
                            required
                          />
                          {memberLookup.kick.loading && <p className="form-helper">Searching members...</p>}
                          {memberLookup.kick.results.length > 0 && (
                            <div className="member-suggestions">
                              {memberLookup.kick.results.map((member) => (
                                <button
                                  type="button"
                                  key={member.id}
                                  className="member-suggestion"
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => handleMemberPick('kick', member)}
                                >
                                  <span
                                    className="member-suggestion__avatar"
                                    style={
                                      member.avatar
                                        ? { backgroundImage: `url(${member.avatar})` }
                                        : undefined
                                    }
                                  >
                                    {!member.avatar &&
                                      (member.displayName || member.username || member.id)
                                        .slice(0, 2)
                                        .toUpperCase()}
                                  </span>
                                  <span className="member-suggestion__meta">
                                    <strong>{member.displayName || member.username || member.id}</strong>
                                    <small>{member.id}</small>
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                          {quickActionTargets.kick && (
                            <div className="member-pill">
                              <span
                                className="member-pill__avatar"
                                style={
                                  quickActionTargets.kick.avatar
                                    ? { backgroundImage: `url(${quickActionTargets.kick.avatar})` }
                                    : undefined
                                }
                              >
                                {!quickActionTargets.kick.avatar &&
                                  (quickActionTargets.kick.displayName ||
                                    quickActionTargets.kick.username ||
                                    quickActionTargets.kick.id)
                                    .slice(0, 2)
                                    .toUpperCase()}
                              </span>
                              <span>
                                {quickActionTargets.kick.displayName ||
                                  quickActionTargets.kick.username ||
                                  quickActionTargets.kick.id}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="form-row">
                          <label htmlFor="kick-reason">Reason</label>
                          <input
                            id="kick-reason"
                            name="reason"
                            placeholder="Rule violation, disruption..."
                            value={quickActions.kick.reason}
                            onChange={(event) => updateQuickAction('kick', { reason: event.target.value })}
                            disabled={!authenticated || !selectedGuild || quickActions.kick.pending}
                          />
                        </div>
                        <button type="submit" className="button button--primary" disabled={!authenticated || !selectedGuild || quickActions.kick.pending}>
                          {quickActions.kick.pending ? 'Processing...' : 'Kick member'}
                        </button>
                        {quickActions.kick.feedback && (
                          <p className="form-helper" style={feedbackPalette[quickActions.kick.feedback.type] ?? undefined}>
                            {quickActions.kick.feedback.text}
                          </p>
                        )}
                      </form>
                      <form className="form quick-action" data-action="ban" onSubmit={(event) => submitQuickAction(event, 'ban')}>
                        <h3>Ban</h3>
                        <div className="form-row">
                          <label htmlFor="ban-user">Member</label>
                          <input
                            id="ban-user"
                            name="user"
                            type="search"
                            placeholder="Search by name or ID"
                            value={quickActions.ban.user}
                            onChange={(event) => handleMemberInput('ban', event.target.value)}
                            onBlur={() => handleMemberBlur('ban')}
                            disabled={!authenticated || !selectedGuild || quickActions.ban.pending}
                            autoComplete="off"
                            aria-autocomplete="list"
                            required
                          />
                          {memberLookup.ban.loading && <p className="form-helper">Searching members...</p>}
                          {memberLookup.ban.results.length > 0 && (
                            <div className="member-suggestions">
                              {memberLookup.ban.results.map((member) => (
                                <button
                                  type="button"
                                  key={member.id}
                                  className="member-suggestion"
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => handleMemberPick('ban', member)}
                                >
                                  <span
                                    className="member-suggestion__avatar"
                                    style={
                                      member.avatar
                                        ? { backgroundImage: `url(${member.avatar})` }
                                        : undefined
                                    }
                                  >
                                    {!member.avatar &&
                                      (member.displayName || member.username || member.id)
                                        .slice(0, 2)
                                        .toUpperCase()}
                                  </span>
                                  <span className="member-suggestion__meta">
                                    <strong>{member.displayName || member.username || member.id}</strong>
                                    <small>{member.id}</small>
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                          {quickActionTargets.ban && (
                            <div className="member-pill">
                              <span
                                className="member-pill__avatar"
                                style={
                                  quickActionTargets.ban.avatar
                                    ? { backgroundImage: `url(${quickActionTargets.ban.avatar})` }
                                    : undefined
                                }
                              >
                                {!quickActionTargets.ban.avatar &&
                                  (quickActionTargets.ban.displayName ||
                                    quickActionTargets.ban.username ||
                                    quickActionTargets.ban.id)
                                    .slice(0, 2)
                                    .toUpperCase()}
                              </span>
                              <span>
                                {quickActionTargets.ban.displayName ||
                                  quickActionTargets.ban.username ||
                                  quickActionTargets.ban.id}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="form-row">
                          <label htmlFor="ban-reason">Reason</label>
                          <input
                            id="ban-reason"
                            name="reason"
                            placeholder="Spamming, abuse..."
                            value={quickActions.ban.reason}
                            onChange={(event) => updateQuickAction('ban', { reason: event.target.value })}
                            disabled={!authenticated || !selectedGuild || quickActions.ban.pending}
                          />
                        </div>
                        <button type="submit" className="button button--primary" disabled={!authenticated || !selectedGuild || quickActions.ban.pending}>
                          {quickActions.ban.pending ? 'Processing...' : 'Ban member'}
                        </button>
                        {quickActions.ban.feedback && (
                          <p className="form-helper" style={feedbackPalette[quickActions.ban.feedback.type] ?? undefined}>
                            {quickActions.ban.feedback.text}
                          </p>
                        )}
                      </form>
                      <form
                        className="form quick-action"
                        data-action="timeout"
                        onSubmit={(event) => submitQuickAction(event, 'timeout')}
                      >
                        <h3>Timeout</h3>
                        <div className="form-row">
                          <label htmlFor="timeout-user">Member</label>
                          <input
                            id="timeout-user"
                            name="user"
                            type="search"
                            placeholder="Search by name or ID"
                            value={quickActions.timeout.user}
                            onChange={(event) => handleMemberInput('timeout', event.target.value)}
                            onBlur={() => handleMemberBlur('timeout')}
                            disabled={!authenticated || !selectedGuild || quickActions.timeout.pending}
                            autoComplete="off"
                            aria-autocomplete="list"
                            required
                          />
                          {memberLookup.timeout.loading && <p className="form-helper">Searching members...</p>}
                          {memberLookup.timeout.results.length > 0 && (
                            <div className="member-suggestions">
                              {memberLookup.timeout.results.map((member) => (
                                <button
                                  type="button"
                                  key={member.id}
                                  className="member-suggestion"
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => handleMemberPick('timeout', member)}
                                >
                                  <span
                                    className="member-suggestion__avatar"
                                    style={
                                      member.avatar
                                        ? { backgroundImage: `url(${member.avatar})` }
                                        : undefined
                                    }
                                  >
                                    {!member.avatar &&
                                      (member.displayName || member.username || member.id)
                                        .slice(0, 2)
                                        .toUpperCase()}
                                  </span>
                                  <span className="member-suggestion__meta">
                                    <strong>{member.displayName || member.username || member.id}</strong>
                                    <small>{member.id}</small>
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                          {quickActionTargets.timeout && (
                            <div className="member-pill">
                              <span
                                className="member-pill__avatar"
                                style={
                                  quickActionTargets.timeout.avatar
                                    ? { backgroundImage: `url(${quickActionTargets.timeout.avatar})` }
                                    : undefined
                                }
                              >
                                {!quickActionTargets.timeout.avatar &&
                                  (quickActionTargets.timeout.displayName ||
                                    quickActionTargets.timeout.username ||
                                    quickActionTargets.timeout.id)
                                    .slice(0, 2)
                                    .toUpperCase()}
                              </span>
                              <span>
                                {quickActionTargets.timeout.displayName ||
                                  quickActionTargets.timeout.username ||
                                  quickActionTargets.timeout.id}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="form-row">
                          <label htmlFor="timeout-duration">Duration (min)</label>
                          <input
                            id="timeout-duration"
                            name="duration"
                            type="number"
                            min="1"
                            max="10080"
                            placeholder="60"
                            value={quickActions.timeout.duration}
                            onChange={(event) => updateQuickAction('timeout', { duration: event.target.value })}
                            disabled={!authenticated || !selectedGuild || quickActions.timeout.pending}
                            required
                          />
                        </div>
                        <div className="form-row">
                          <label htmlFor="timeout-reason">Reason</label>
                          <input
                            id="timeout-reason"
                            name="reason"
                            placeholder="Spamming, abuse..."
                            value={quickActions.timeout.reason}
                            onChange={(event) => updateQuickAction('timeout', { reason: event.target.value })}
                            disabled={!authenticated || !selectedGuild || quickActions.timeout.pending}
                          />
                        </div>
                        <button type="submit" className="button button--primary" disabled={!authenticated || !selectedGuild || quickActions.timeout.pending}>
                          {quickActions.timeout.pending ? 'Processing...' : 'Timeout member'}
                        </button>
                        {quickActions.timeout.feedback && (
                          <p className="form-helper" style={feedbackPalette[quickActions.timeout.feedback.type] ?? undefined}>
                            {quickActions.timeout.feedback.text}
                          </p>
                        )}
                      </form>
                      <form className="form quick-action" data-action="warn" onSubmit={(event) => submitQuickAction(event, 'warn')}>
                        <h3>Warn</h3>
                        <div className="form-row">
                          <label htmlFor="warn-user">Member</label>
                          <input
                            id="warn-user"
                            name="user"
                            type="search"
                            placeholder="Search by name or ID"
                            value={quickActions.warn.user}
                            onChange={(event) => handleMemberInput('warn', event.target.value)}
                            onBlur={() => handleMemberBlur('warn')}
                            disabled={!authenticated || !selectedGuild || quickActions.warn.pending}
                            autoComplete="off"
                            aria-autocomplete="list"
                            required
                          />
                          {memberLookup.warn.loading && <p className="form-helper">Searching members...</p>}
                          {memberLookup.warn.results.length > 0 && (
                            <div className="member-suggestions">
                              {memberLookup.warn.results.map((member) => (
                                <button
                                  type="button"
                                  key={member.id}
                                  className="member-suggestion"
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => handleMemberPick('warn', member)}
                                >
                                  <span
                                    className="member-suggestion__avatar"
                                    style={
                                      member.avatar
                                        ? { backgroundImage: `url(${member.avatar})` }
                                        : undefined
                                    }
                                  >
                                    {!member.avatar &&
                                      (member.displayName || member.username || member.id)
                                        .slice(0, 2)
                                        .toUpperCase()}
                                  </span>
                                  <span className="member-suggestion__meta">
                                    <strong>{member.displayName || member.username || member.id}</strong>
                                    <small>{member.id}</small>
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                          {quickActionTargets.warn && (
                            <div className="member-pill">
                              <span
                                className="member-pill__avatar"
                                style={
                                  quickActionTargets.warn.avatar
                                    ? { backgroundImage: `url(${quickActionTargets.warn.avatar})` }
                                    : undefined
                                }
                              >
                                {!quickActionTargets.warn.avatar &&
                                  (quickActionTargets.warn.displayName ||
                                    quickActionTargets.warn.username ||
                                    quickActionTargets.warn.id)
                                    .slice(0, 2)
                                    .toUpperCase()}
                              </span>
                              <span>
                                {quickActionTargets.warn.displayName ||
                                  quickActionTargets.warn.username ||
                                  quickActionTargets.warn.id}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="form-row">
                          <label htmlFor="warn-reason">Reason</label>
                          <textarea
                            id="warn-reason"
                            name="reason"
                            rows={3}
                            placeholder="Describe the violation..."
                            value={quickActions.warn.reason}
                            onChange={(event) => updateQuickAction('warn', { reason: event.target.value })}
                            disabled={!authenticated || !selectedGuild || quickActions.warn.pending}
                          />
                        </div>
                        <button type="submit" className="button button--primary" disabled={!authenticated || !selectedGuild || quickActions.warn.pending}>
                          {quickActions.warn.pending ? 'Processing...' : 'Log warning'}
                        </button>
                        {quickActions.warn.feedback && (
                          <p className="form-helper" style={feedbackPalette[quickActions.warn.feedback.type] ?? undefined}>
                            {quickActions.warn.feedback.text}
                          </p>
                        )}
                      </form>
                    </div>
                  ) : (
                    <p className="placeholder">Select a server to use quick actions.</p>
                  )}
                </>
              ) : (
                <p className="helper">Log in with your moderator account to unlock quick actions.</p>
              )}
            </div>
          </section>

          <section className={`panel panel--collapsible ${collapsedPanels.filters ? 'panel--collapsed' : ''}`}>
            <header className="panel__header">
              <div>
                <h2>Filters</h2>
                <p>Choose which messages are automatically removed by the bot.</p>
              </div>
              <div className="panel__header-actions">
                <button
                  type="button"
                  className="panel__toggle"
                  aria-expanded={!collapsedPanels.filters}
                  aria-controls="panel-filters"
                  onClick={() => togglePanel('filters')}
                >
                  {collapsedPanels.filters ? 'Expand' : 'Collapse'}
                  <span className="panel__toggle-icon" aria-hidden="true">▾</span>
                </button>
              </div>
            </header>
            <div className="panel__body filter-grid" id="panel-filters" hidden={collapsedPanels.filters}>
              {Object.entries(FILTER_DETAILS).map(([key, details]) => (
                <article key={key} className="filter-card">
                  <header>
                    <h3>{details.label}</h3>
                    <p>{details.helper}</p>
                  </header>
                  <button
                    type="button"
                    className={`toggle ${filters[key] ? 'toggle--on' : 'toggle--off'}`}
                    onClick={() => handleToggleFilter(key)}
                    disabled={loading}
                  >
                    <span />
                  </button>
                </article>
              ))}
            </div>
            <div className="panel__body keyword-manager" hidden={collapsedPanels.filters}>
              <div className="form-row">
                <label htmlFor="keyword-input">Custom keyword</label>
                <div className="keyword-input">
                  <input
                    id="keyword-input"
                    placeholder="Add word or phrase"
                    value={keywordsInput}
                    onChange={(event) => setKeywordsInput(event.target.value)}
                    disabled={loading}
                  />
                  <button type="button" className="button button--primary" onClick={handleAddKeyword} disabled={loading}>
                    Add
                  </button>
                </div>
                <p className="form-helper">Keywords are matched case-insensitively.</p>
              </div>
              <ul className="keyword-list">
                {keywordList.length === 0 ? (
                  <li className="placeholder">No custom keywords yet.</li>
                ) : (
                  keywordList.map((keyword) => (
                    <li key={keyword}>
                      <span>{keyword}</span>
                      <button type="button" onClick={() => handleRemoveKeyword(keyword)} disabled={loading}>
                        Remove
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </section>

          <section className={`panel panel--collapsible ${collapsedPanels.spam ? 'panel--collapsed' : ''}`}>
            <header className="panel__header">
              <div>
                <h2>Spam controls</h2>
                <p>Rate limit spammy senders and escalate automatically.</p>
              </div>
              <div className="panel__header-actions">
                <button
                  type="button"
                  className="panel__toggle"
                  aria-expanded={!collapsedPanels.spam}
                  aria-controls="panel-spam"
                  onClick={() => togglePanel('spam')}
                >
                  {collapsedPanels.spam ? 'Expand' : 'Collapse'}
                  <span className="panel__toggle-icon" aria-hidden="true">▾</span>
                </button>
              </div>
            </header>
            <div className="panel__body spam-grid" id="panel-spam" hidden={collapsedPanels.spam}>
              {loading ? (
                <p className="placeholder">Loading configuration...</p>
              ) : (
                <>
                  <div className="form-row">
                    <label htmlFor="spam-messages">Messages per minute</label>
                    <input
                      id="spam-messages"
                      type="number"
                      min="1"
                      max="120"
                      value={spam.messagesPerMinute ?? ''}
                      onChange={(event) => handleSpamChange('messagesPerMinute', Number(event.target.value))}
                    />
                    <p className="form-helper">Timeout users who exceed this rate.</p>
                  </div>
                  <div className="form-row">
                    <label htmlFor="spam-timeout">Timeout duration (minutes)</label>
                    <input
                      id="spam-timeout"
                      type="number"
                      min="1"
                      max="10080"
                      value={spam.autoTimeoutMinutes ?? ''}
                      onChange={(event) => handleSpamChange('autoTimeoutMinutes', Number(event.target.value))}
                    />
                    <p className="form-helper">Length of automatic timeouts.</p>
                  </div>
                  <div className="form-row">
                    <label htmlFor="spam-escalation">Escalation after warnings</label>
                    <input
                      id="spam-escalation"
                      type="number"
                      min="1"
                      max="10"
                      value={spam.escalationAfterWarnings ?? ''}
                      onChange={(event) => handleSpamChange('escalationAfterWarnings', Number(event.target.value))}
                    />
                    <p className="form-helper">After this many warnings escalate the response.</p>
                  </div>
                </>
              )}
            </div>
          </section>

          <section className={`panel panel--collapsible ${collapsedPanels.escalation ? 'panel--collapsed' : ''}`}>
            <header className="panel__header">
              <div>
                <h2>Escalation ladder</h2>
                <p>Fine-tune how many offences it takes to auto-timeout or ban.</p>
              </div>
              <div className="panel__header-actions">
                <button
                  type="button"
                  className="panel__toggle"
                  aria-expanded={!collapsedPanels.escalation}
                  aria-controls="panel-escalation"
                  onClick={() => togglePanel('escalation')}
                >
                  {collapsedPanels.escalation ? 'Expand' : 'Collapse'}
                  <span className="panel__toggle-icon" aria-hidden="true">▾</span>
                </button>
              </div>
            </header>
            <div className="panel__body escalation-grid" id="panel-escalation" hidden={collapsedPanels.escalation}>
              {loading ? (
                <p className="placeholder">Loading...</p>
              ) : (
                <>
                  <div className="form-row">
                    <label htmlFor="esc-warn">Warn threshold</label>
                    <input
                      id="esc-warn"
                      type="number"
                      min="1"
                      max="10"
                      value={escalation.warnThreshold ?? ''}
                      onChange={(event) => handleEscalationChange('warnThreshold', Number(event.target.value))}
                    />
                    <p className="form-helper">Escalate after this many warns.</p>
                  </div>
                  <div className="form-row">
                    <label htmlFor="esc-timeout">Timeout threshold</label>
                    <input
                      id="esc-timeout"
                      type="number"
                      min="1"
                      max="10"
                      value={escalation.timeoutThreshold ?? ''}
                      onChange={(event) => handleEscalationChange('timeoutThreshold', Number(event.target.value))}
                    />
                    <p className="form-helper">Issue a timeout after this many warns.</p>
                  </div>
                  <div className="form-row">
                    <label htmlFor="esc-ban">Ban threshold</label>
                    <input
                      id="esc-ban"
                      type="number"
                      min="1"
                      max="15"
                      value={escalation.banThreshold ?? ''}
                      onChange={(event) => handleEscalationChange('banThreshold', Number(event.target.value))}
                    />
                    <p className="form-helper">Ban the member after this many total offences.</p>
                  </div>
                </>
              )}
            </div>
          </section>

          <section className={`panel panel--collapsible ${collapsedPanels.alerts ? 'panel--collapsed' : ''}`}>
            <header className="panel__header">
              <div>
                <h2>Alerts &amp; notifications</h2>
                <p>Control who gets notified when automod fires.</p>
              </div>
              <div className="panel__header-actions">
                <button
                  type="button"
                  className="panel__toggle"
                  aria-expanded={!collapsedPanels.alerts}
                  aria-controls="panel-alerts"
                  onClick={() => togglePanel('alerts')}
                >
                  {collapsedPanels.alerts ? 'Expand' : 'Collapse'}
                  <span className="panel__toggle-icon" aria-hidden="true">▾</span>
                </button>
              </div>
            </header>
            <div className="panel__body form-grid" id="panel-alerts" hidden={collapsedPanels.alerts}>
              {loading ? (
                <p className="placeholder">Loading...</p>
              ) : (
                <>
                  <div className="form-row">
                    <label htmlFor="log-channel">Log channel ID</label>
                    <input
                      id="log-channel"
                      type="text"
                      placeholder="1234567890"
                      value={alerts.logChannelId ?? ''}
                      onChange={(event) => handleAlertsChange('logChannelId', event.target.value)}
                    />
                    <p className="form-helper">Where automod events are posted.</p>
                  </div>
                  <div className="form-row">
                    <label htmlFor="staff-role">Staff role ID</label>
                    <input
                      id="staff-role"
                      type="text"
                      placeholder="1234567890"
                      value={alerts.staffRoleId ?? ''}
                      onChange={(event) => handleAlertsChange('staffRoleId', event.target.value)}
                    />
                    <p className="form-helper">Role to ping when escalation happens.</p>
                  </div>
                  <div className="form-row">
                    <label htmlFor="notify-auto">Notify on auto-action</label>
                    <button
                      id="notify-auto"
                      type="button"
                      className={`toggle ${alerts.notifyOnAutoAction ? 'toggle--on' : 'toggle--off'}`}
                      onClick={() => handleAlertsChange('notifyOnAutoAction', !alerts.notifyOnAutoAction)}
                    >
                      <span />
                    </button>
                    <p className="form-helper">Toggle staff notifications for every automod action.</p>
                  </div>
                </>
              )}
            </div>
          </section>

          <section className={`panel panel--collapsible ${collapsedPanels.templates ? 'panel--collapsed' : ''}`}>
            <header className="panel__header">
              <div>
                <h2>DM templates</h2>
                <p>Customize the message members receive when a punishment is applied.</p>
              </div>
              <div className="panel__header-actions">
                <button
                  type="button"
                  className="panel__toggle"
                  aria-expanded={!collapsedPanels.templates}
                  aria-controls="panel-templates"
                  onClick={() => togglePanel('templates')}
                >
                  {collapsedPanels.templates ? 'Expand' : 'Collapse'}
                  <span className="panel__toggle-icon" aria-hidden="true">▾</span>
                </button>
              </div>
            </header>
            <div className="panel__body template-grid" id="panel-templates" hidden={collapsedPanels.templates}>
              {loading ? (
                <p className="placeholder">Loading...</p>
              ) : (
                Object.entries(dmTemplates).map(([key, template]) => (
                  <div key={key} className="template-card">
                    <h3>{TEMPLATE_LABELS[key] ?? key}</h3>
                    <p className="helper">Tokens supported: {'{guild}'}, {'{reason}'}, {'{duration}'}</p>
                    <textarea
                      rows={4}
                      value={template}
                      onChange={(event) => handleTemplateChange(key, event.target.value)}
                    />
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="panel">
            <header className="panel__header">
              <div>
                <h2>Review &amp; save</h2>
                <p>Changes affect future automod actions instantly after saving.</p>
              </div>
            </header>
            <div className="panel__body">
              <div className="form-row">
                <label>Status</label>
                <p className="list-subtext">
                  {feedback ? feedback : config ? `Loaded ${formatDateTime(Date.now())}` : 'No changes yet'}
                </p>
              </div>
              <button
                type="button"
                className="button button--primary"
                onClick={handleSave}
                disabled={!authenticated || saving || !config}
              >
                {saving ? 'Saving...' : 'Save moderation configuration'}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )

}

function formatCaseStatus(status) {
  const value = getStatusValue(status)
  switch (value) {
    case 'pending-response':
      return 'Awaiting member response'
    case 'pending':
      return 'Pending'
    case 'closed':
      return 'Closed'
    case 'archived':
      return 'Archived'
    case 'escalated':
      return 'Escalated'
    case 'open':
    default:
      return 'Open'
  }
}

function getStatusValue(status) {
  return String(status ?? 'open').toLowerCase()
}

function isCaseTerminal(status) {
  const value = getStatusValue(status)
  return value === 'closed' || value === 'archived'
}

function isCaseArchived(status) {
  return getStatusValue(status) === 'archived'
}

function applyCaseFilter(items, filter) {
  if (!Array.isArray(items)) {
    return []
  }
  const value = String(filter ?? 'all').toLowerCase()
  switch (value) {
    case 'active':
      return items.filter((item) => !isCaseTerminal(item.status))
    case 'archived':
      return items.filter((item) => isCaseArchived(item.status))
    case 'closed':
      return items.filter((item) => getStatusValue(item.status) === 'closed')
    case 'open':
      return items.filter((item) => getStatusValue(item.status) === 'open')
    case 'pending-response':
      return items.filter((item) => getStatusValue(item.status) === 'pending-response')
    case 'escalated':
      return items.filter((item) => getStatusValue(item.status) === 'escalated')
    case 'all':
    default:
      return [...items]
  }
}

function resolveCaseFilterParam(filter) {
  const value = String(filter ?? 'all').toLowerCase()
  if (value === 'active') {
    return 'all'
  }
  return value
}

function formatCaseFilterSummary(filter, count) {
  const value = String(filter ?? 'all').toLowerCase()
  const noun = count === 1 ? 'case' : 'cases'
  switch (value) {
    case 'active':
      return `${count} active ${noun}`
    case 'archived':
      return `${count} archived ${noun}`
    case 'closed':
      return `${count} closed ${noun}`
    case 'pending-response':
      return `${count} ${noun} awaiting response`
    case 'open':
      return `${count} open ${noun}`
    case 'escalated':
      return `${count} escalated ${noun}`
    case 'all':
    default:
      return `${count} ${noun}`
  }
}

function formatEmptyCaseMessage(filter) {
  const value = String(filter ?? 'all').toLowerCase()
  switch (value) {
    case 'active':
      return 'No active cases. Members can start a conversation through the bot.'
    case 'open':
      return 'No open cases.'
    case 'archived':
      return 'No archived cases.'
    case 'closed':
      return 'No closed cases.'
    case 'pending-response':
      return 'No cases awaiting a member response.'
    case 'escalated':
      return 'No escalated cases.'
    case 'all':
    default:
      return 'No cases found.'
  }
}
