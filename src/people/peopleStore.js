import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { recordAuditEntry } from '../audit/auditLog.js'

const peopleDirectory = path.resolve(process.cwd(), 'data', 'people')
const peopleFile = path.join(peopleDirectory, 'people.json')

const CHECKIN_CADENCES = [
  { key: '7d', days: 7 },
  { key: '30d', days: 30 },
  { key: '90d', days: 90 }
]

const PERSON_STATUSES = new Set(['active', 'onboarding', 'inactive', 'offboarded'])
const CHECKIN_STATUSES = new Set(['pending', 'completed', 'missed'])
const MAX_CHECKINS_PER_PERSON = 60

const defaultData = createDefaultData()

let cache = null
let loadingPromise = null

function createDefaultData() {
  const now = new Date().toISOString()
  const members = [
    {
      id: '1001',
      guildId: null,
      displayName: 'Avery Johnson',
      title: 'Support Lead',
      department: 'Support',
      status: 'active',
      timezone: 'America/Los_Angeles',
      location: 'Seattle, WA',
      email: 'avery@example.com',
      tags: ['manager', 'mentor'],
      roles: ['Manager'],
      joinedAt: new Date(Date.now() - 240 * 24 * 60 * 60 * 1000).toISOString(),
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
      managerId: null,
      avatar: null,
      pronouns: 'they/them',
      lastAnnouncedAt: now,
      lastRolesyncAt: now,
      checkins: [],
      checkinStats: { pending: 0, completed: 0, missed: 0 },
      lastCheckInAt: null,
      nextCheckInAt: null
    },
    {
      id: '1002',
      guildId: null,
      displayName: 'Jordan Patel',
      title: 'People Operations',
      department: 'HR',
      status: 'onboarding',
      timezone: 'America/New_York',
      location: 'Brooklyn, NY',
      email: 'jordan@example.com',
      tags: ['onboarding'],
      roles: ['People Ops'],
      joinedAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString(),
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
      managerId: '1001',
      avatar: null,
      pronouns: 'she/her',
      checkins: [],
      checkinStats: { pending: 0, completed: 0, missed: 0 },
      lastCheckInAt: null,
      nextCheckInAt: null
    }
  ]

  for (const person of members) {
    seedCheckins(person)
    refreshPersonCheckinSummary(person)
  }

  return {
    updatedAt: now,
    people: members
  }
}

function createId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return crypto.randomBytes(16).toString('hex')
}

async function loadData() {
  if (cache) {
    return cache
  }

  if (loadingPromise) {
    return loadingPromise
  }

  loadingPromise = (async () => {
    try {
      const contents = await fs.readFile(peopleFile, 'utf8')
      const parsed = JSON.parse(contents)
      const people = Array.isArray(parsed.people) ? parsed.people.map((person) => normalizePerson(person)) : []
      cache = {
        updatedAt: parsed.updatedAt ?? null,
        people
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('Failed to load people data, using defaults:', error)
      }
      cache = JSON.parse(JSON.stringify(defaultData))
    }
    return cache
  })()

  try {
    return await loadingPromise
  } finally {
    loadingPromise = null
  }
}

function normalizePerson(person = {}) {
  const normalized = {
    id: String(person.id ?? createId()),
    guildId: person.guildId ? String(person.guildId) : null,
    displayName: typeof person.displayName === 'string' && person.displayName.trim().length
      ? person.displayName.trim()
      : 'Unnamed member',
    title: typeof person.title === 'string' ? person.title.trim() : null,
    department: typeof person.department === 'string' ? person.department.trim() : null,
    status: PERSON_STATUSES.has(String(person.status).toLowerCase())
      ? String(person.status).toLowerCase()
      : 'active',
    timezone: typeof person.timezone === 'string' ? person.timezone.trim() : null,
    location: typeof person.location === 'string' ? person.location.trim() : null,
    email: typeof person.email === 'string' ? person.email.trim() : null,
    tags: Array.isArray(person.tags)
      ? Array.from(new Set(person.tags.map((tag) => String(tag).trim()).filter(Boolean)))
      : [],
    roles: Array.isArray(person.roles)
      ? Array.from(new Set(person.roles.map((role) => String(role).trim()).filter(Boolean)))
      : [],
    joinedAt: person.joinedAt ? new Date(person.joinedAt).toISOString() : null,
    firstSeenAt: person.firstSeenAt ? new Date(person.firstSeenAt).toISOString() : null,
    lastSeenAt: person.lastSeenAt ? new Date(person.lastSeenAt).toISOString() : null,
    createdAt: person.createdAt ? new Date(person.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: person.updatedAt ? new Date(person.updatedAt).toISOString() : new Date().toISOString(),
    managerId: person.managerId ? String(person.managerId) : null,
    avatar: typeof person.avatar === 'string' ? person.avatar : null,
    pronouns: typeof person.pronouns === 'string' ? person.pronouns.trim() : null,
    note: typeof person.note === 'string' ? person.note : null,
    externalId: typeof person.externalId === 'string' ? person.externalId.trim() : null,
    lastAnnouncedAt: person.lastAnnouncedAt ? new Date(person.lastAnnouncedAt).toISOString() : null,
    lastRolesyncAt: person.lastRolesyncAt ? new Date(person.lastRolesyncAt).toISOString() : null,
    offboardedAt: person.offboardedAt ? new Date(person.offboardedAt).toISOString() : null,
    checkins: Array.isArray(person.checkins)
      ? person.checkins.map((entry) => normalizeCheckin(entry)).filter(Boolean)
      : [],
    checkinStats: person.checkinStats && typeof person.checkinStats === 'object'
      ? {
          pending: Number(person.checkinStats.pending ?? 0),
          completed: Number(person.checkinStats.completed ?? 0),
          missed: Number(person.checkinStats.missed ?? 0)
        }
      : { pending: 0, completed: 0, missed: 0 },
    lastCheckInAt: person.lastCheckInAt ? new Date(person.lastCheckInAt).toISOString() : null,
    nextCheckInAt: person.nextCheckInAt ? new Date(person.nextCheckInAt).toISOString() : null
  }

  seedCheckins(normalized)
  refreshPersonCheckinSummary(normalized)

  return normalized
}

function normalizeCheckin(entry = {}) {
  const cadence = typeof entry.cadence === 'string' ? entry.cadence.toLowerCase() : null
  if (!CHECKIN_CADENCES.some((item) => item.key === cadence)) {
    return null
  }
  const status = typeof entry.status === 'string' ? entry.status.toLowerCase() : 'pending'
  const normalizedStatus = CHECKIN_STATUSES.has(status) ? status : 'pending'

  const normalized = {
    id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : createId(),
    cadence,
    status: normalizedStatus,
    dueAt: normalizeDate(entry.dueAt),
    completedAt: normalizeDate(entry.completedAt),
    completedBy: entry.completedBy ? String(entry.completedBy) : null,
    completedByTag: typeof entry.completedByTag === 'string' ? entry.completedByTag : null,
    assignedTo: entry.assignedTo ? String(entry.assignedTo) : null,
    assignedToTag: typeof entry.assignedToTag === 'string' ? entry.assignedToTag : null,
    notes: typeof entry.notes === 'string' ? entry.notes : null,
    createdAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : new Date().toISOString()
  }

  return normalized
}

function normalizeDate(value) {
  if (!value) {
    return null
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return date.toISOString()
}

async function persistData(data) {
  await fs.mkdir(peopleDirectory, { recursive: true })
  const payload = JSON.stringify(
    {
      updatedAt: data.updatedAt,
      people: data.people
    },
    null,
    2
  )
  await fs.writeFile(peopleFile, payload)
  cache = data
  return cache
}

function clonePerson(person) {
  return JSON.parse(JSON.stringify(person))
}

function ensureCheckins(person) {
  if (!Array.isArray(person.checkins)) {
    person.checkins = []
  }
  return person.checkins
}

function seedCheckins(person) {
  const checkins = ensureCheckins(person)
  const existingCadences = new Set(checkins.map((entry) => entry.cadence))
  const baseDate = person.joinedAt ? new Date(person.joinedAt) : new Date()
  const startDate = Number.isNaN(baseDate.getTime()) ? new Date() : baseDate

  for (const cadence of CHECKIN_CADENCES) {
    if (!existingCadences.has(cadence.key)) {
      const dueAt = new Date(startDate)
      dueAt.setDate(dueAt.getDate() + cadence.days)
      checkins.push(
        normalizeCheckin({
          cadence: cadence.key,
          status: 'pending',
          dueAt: dueAt.toISOString()
        })
      )
    }
  }
}

function refreshPersonCheckinSummary(person) {
  const checkins = ensureCheckins(person)
  checkins.sort((a, b) => {
    const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Infinity
    const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Infinity
    return aDue - bDue
  })

  const pending = []
  const completed = []
  const missed = []

  for (const entry of checkins) {
    if (entry.status === 'completed') {
      completed.push(entry)
    } else if (entry.status === 'missed') {
      missed.push(entry)
    } else {
      pending.push(entry)
    }
  }

  const mostRecentCompleted = completed
    .filter((entry) => entry.completedAt)
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())[0] ?? null

  const nextPending = pending
    .filter((entry) => entry.dueAt)
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0] ?? null

  person.checkinStats = {
    pending: pending.length,
    completed: completed.length,
    missed: missed.length
  }
  person.lastCheckInAt = mostRecentCompleted ? mostRecentCompleted.completedAt : null
  person.nextCheckInAt = nextPending ? nextPending.dueAt : null

  if (checkins.length > MAX_CHECKINS_PER_PERSON) {
    person.checkins = checkins.slice(-MAX_CHECKINS_PER_PERSON)
  }
}

function applySort(people, sortBy, direction) {
  const dir = direction === 'desc' ? -1 : 1
  if (sortBy === 'joinedAt') {
    return people.sort((a, b) => ((a.joinedAt ?? '') > (b.joinedAt ?? '') ? dir : -dir))
  }
  if (sortBy === 'status') {
    return people.sort((a, b) => ((a.status ?? '') > (b.status ?? '') ? dir : -dir))
  }
  if (sortBy === 'department') {
    return people.sort((a, b) => ((a.department ?? '') > (b.department ?? '') ? dir : -dir))
  }
  if (sortBy === 'nextCheckInAt') {
    return people.sort((a, b) => ((a.nextCheckInAt ?? '') > (b.nextCheckInAt ?? '') ? dir : -dir))
  }
  return people.sort((a, b) => ((a.displayName ?? '') > (b.displayName ?? '') ? dir : -dir))
}

export async function listPeople({
  guildId = null,
  status = null,
  search = null,
  department = null,
  tag = null,
  limit = 50,
  offset = 0,
  sortBy = 'displayName',
  direction = 'asc'
} = {}) {
  const data = await loadData()
  const normalizedLimit = Math.min(Math.max(Number(limit) || 50, 1), 250)
  const normalizedOffset = Math.max(Number(offset) || 0, 0)

  let people = data.people.map(clonePerson)

  if (guildId) {
    people = people.filter((person) => person.guildId === String(guildId))
  }
  if (status) {
    const statuses = String(status)
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
    if (statuses.length) {
      people = people.filter((person) => statuses.includes(person.status))
    }
  }
  if (department) {
    const departments = String(department)
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
    if (departments.length) {
      people = people.filter((person) => departments.includes((person.department ?? '').toLowerCase()))
    }
  }
  if (tag) {
    const tags = String(tag)
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
    if (tags.length) {
      people = people.filter((person) =>
        person.tags.some((entry) => tags.includes(String(entry).toLowerCase()))
      )
    }
  }
  if (search) {
    const needle = String(search).trim().toLowerCase()
    if (needle.length >= 2) {
      people = people.filter((person) => {
        return (
          person.displayName.toLowerCase().includes(needle) ||
          (person.email ?? '').toLowerCase().includes(needle) ||
          (person.department ?? '').toLowerCase().includes(needle) ||
          (person.tags ?? []).some((tagValue) => String(tagValue).toLowerCase().includes(needle))
        )
      })
    }
  }

  applySort(people, sortBy, direction)

  const total = people.length
  const paged = people.slice(normalizedOffset, normalizedOffset + normalizedLimit)
  const results = paged.map(serializePersonSummary)

  return {
    total,
    limit: normalizedLimit,
    offset: normalizedOffset,
    results
  }
}

export async function getPerson(personId) {
  if (!personId) {
    return null
  }
  const data = await loadData()
  const entry = data.people.find((person) => person.id === String(personId))
  return entry ? clonePerson(entry) : null
}

export async function createPerson(payload = {}, auditContext = {}) {
  const data = await loadData()
  const now = new Date().toISOString()
  const person = normalizePerson({
    ...payload,
    id: payload.id ?? createId(),
    createdAt: now,
    updatedAt: now
  })

  if (data.people.some((existing) => existing.id === person.id)) {
    throw new Error('A person with that id already exists')
  }

  data.people.push(person)
  data.updatedAt = now
  await persistData(data)

  await recordAuditEntry({
    action: 'people.create',
    actorId: auditContext.actorId ?? null,
    actorTag: auditContext.actorTag ?? null,
    actorRoles: auditContext.actorRoles ?? [],
    targetId: person.id,
    targetType: 'person',
    targetLabel: person.displayName,
    metadata: { person }
  })

  return clonePerson(person)
}

export async function updatePerson(personId, updates = {}, auditContext = {}) {
  if (!personId) {
    throw new Error('personId is required')
  }
  const data = await loadData()
  const index = data.people.findIndex((person) => person.id === String(personId))
  if (index === -1) {
    throw new Error('Person not found')
  }

  const current = data.people[index]
  const next = normalizePerson({ ...current, ...updates, id: current.id, createdAt: current.createdAt })
  next.updatedAt = new Date().toISOString()

  data.people[index] = next
  data.updatedAt = next.updatedAt
  await persistData(data)

  await recordAuditEntry({
    action: auditContext.action ?? 'people.update',
    actorId: auditContext.actorId ?? null,
    actorTag: auditContext.actorTag ?? null,
    actorRoles: auditContext.actorRoles ?? [],
    targetId: next.id,
    targetType: 'person',
    targetLabel: next.displayName,
    metadata: { updates }
  })

  return clonePerson(next)
}

export async function upsertPeople(records = [], auditContext = {}) {
  if (!Array.isArray(records) || !records.length) {
    return { inserted: 0, updated: 0 }
  }
  const data = await loadData()
  const now = new Date().toISOString()
  let inserted = 0
  let updated = 0

  for (const record of records) {
    if (!record) {
      continue
    }
    const id = record.id ? String(record.id) : createId()
    const index = data.people.findIndex((person) => person.id === id)
    if (index === -1) {
      const created = normalizePerson({ ...record, id, createdAt: now, updatedAt: now })
      data.people.push(created)
      inserted += 1
      await recordAuditEntry({
        action: 'people.import',
        actorId: auditContext.actorId ?? null,
        actorTag: auditContext.actorTag ?? null,
        actorRoles: auditContext.actorRoles ?? [],
        targetId: created.id,
        targetType: 'person',
        targetLabel: created.displayName,
        metadata: { mode: 'insert' }
      })
    } else {
      const existing = data.people[index]
      const merged = normalizePerson({ ...existing, ...record, id, createdAt: existing.createdAt })
      merged.updatedAt = now
      data.people[index] = merged
      updated += 1
      await recordAuditEntry({
        action: 'people.importUpdate',
        actorId: auditContext.actorId ?? null,
        actorTag: auditContext.actorTag ?? null,
        actorRoles: auditContext.actorRoles ?? [],
        targetId: merged.id,
        targetType: 'person',
        targetLabel: merged.displayName,
        metadata: { mode: 'update' }
      })
    }
  }

  data.updatedAt = now
  await persistData(data)

  return { inserted, updated }
}

export async function markPersonAnnounced(personId, auditContext = {}) {
  const person = await getPerson(personId)
  if (!person) {
    throw new Error('Person not found')
  }
  return updatePerson(
    person.id,
    { lastAnnouncedAt: new Date().toISOString() },
    {
      ...auditContext,
      action: 'people.announce'
    }
  )
}

export async function markPersonRolesSynced(personId, auditContext = {}) {
  const person = await getPerson(personId)
  if (!person) {
    throw new Error('Person not found')
  }
  return updatePerson(
    person.id,
    { lastRolesyncAt: new Date().toISOString() },
    {
      ...auditContext,
      action: 'people.rolesync'
    }
  )
}

export async function offboardPerson(personId, { reason = null } = {}, auditContext = {}) {
  const data = await loadData()
  const index = data.people.findIndex((person) => person.id === String(personId))
  if (index === -1) {
    throw new Error('Person not found')
  }
  const now = new Date().toISOString()
  const person = data.people[index]
  person.status = 'offboarded'
  person.offboardedAt = now
  person.updatedAt = now
  person.nextCheckInAt = null
  person.checkins = ensureCheckins(person).map((entry) => {
    if (entry.status === 'pending') {
      return { ...entry, status: 'missed', updatedAt: now }
    }
    return entry
  })
  refreshPersonCheckinSummary(person)
  data.people[index] = person
  data.updatedAt = now
  await persistData(data)

  await recordAuditEntry({
    action: 'people.offboard',
    actorId: auditContext.actorId ?? null,
    actorTag: auditContext.actorTag ?? null,
    actorRoles: auditContext.actorRoles ?? [],
    targetId: person.id,
    targetType: 'person',
    targetLabel: person.displayName,
    metadata: { reason }
  })

  return clonePerson(person)
}

export async function recordCheckin(personId, cadence, {
  status = 'completed',
  notes = null,
  assignedTo = undefined,
  assignedToTag = undefined,
  completedAt = null,
  actorId = null,
  actorTag = null
} = {}) {
  const data = await loadData()
  const index = data.people.findIndex((person) => person.id === String(personId))
  if (index === -1) {
    throw new Error('Person not found')
  }
  const normalizedCadence = String(cadence).toLowerCase()
  if (!CHECKIN_CADENCES.some((entry) => entry.key === normalizedCadence)) {
    throw new Error('Unsupported check-in cadence')
  }

  const person = data.people[index]
  ensureCheckins(person)
  let entry = person.checkins.find((item) => item.cadence === normalizedCadence)
  if (!entry) {
    entry = normalizeCheckin({ cadence: normalizedCadence, status: 'pending' })
    person.checkins.push(entry)
  }

  const now = new Date().toISOString()
  const normalizedStatus = CHECKIN_STATUSES.has(String(status).toLowerCase())
    ? String(status).toLowerCase()
    : 'completed'
  entry.status = normalizedStatus
  entry.updatedAt = now
  if (normalizedStatus === 'completed') {
    entry.completedAt = completedAt ? new Date(completedAt).toISOString() : now
    entry.completedBy = actorId ? String(actorId) : entry.completedBy
    entry.completedByTag = actorTag ?? entry.completedByTag ?? null
    entry.notes = notes ?? entry.notes ?? null
  } else if (normalizedStatus === 'pending') {
    entry.completedAt = null
    entry.completedBy = null
    entry.completedByTag = null
    entry.notes = notes ?? null
  } else if (normalizedStatus === 'missed') {
    entry.completedAt = null
    entry.completedBy = null
    entry.completedByTag = null
    entry.notes = notes ?? entry.notes ?? null
  }

  if (assignedTo !== undefined) {
    entry.assignedTo = assignedTo ? String(assignedTo) : null
  }
  if (assignedToTag !== undefined) {
    entry.assignedToTag = assignedToTag ?? null
  }

  refreshPersonCheckinSummary(person)

  data.people[index] = person
  data.updatedAt = now
  await persistData(data)

  await recordAuditEntry({
    action: 'people.checkin',
    actorId: actorId ?? null,
    actorTag: actorTag ?? null,
    targetId: person.id,
    targetType: 'person',
    targetLabel: person.displayName,
    metadata: {
      cadence: normalizedCadence,
      status: normalizedStatus,
      notes: notes ?? null
    }
  })

  return clonePerson(person)
}

export async function listCheckinsForPerson(personId) {
  const person = await getPerson(personId)
  if (!person) {
    throw new Error('Person not found')
  }
  return person.checkins
    .slice()
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

export async function getPeopleSummary() {
  const data = await loadData()
  const total = data.people.length
  const active = data.people.filter((person) => person.status === 'active').length
  const onboarding = data.people.filter((person) => person.status === 'onboarding').length
  const offboarded = data.people.filter((person) => person.status === 'offboarded').length
  return {
    updatedAt: data.updatedAt,
    total,
    active,
    onboarding,
    offboarded
  }
}

export async function getAllPeople() {
  const data = await loadData()
  return data.people.map(clonePerson)
}

function serializePersonSummary(person) {
  const summaryCheckins = ensureCheckins(person)
  const next = summaryCheckins
    .filter((entry) => entry.status === 'pending' && entry.dueAt)
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0] ?? null
  const lastCompleted = summaryCheckins
    .filter((entry) => entry.status === 'completed' && entry.completedAt)
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())[0] ?? null

  return {
    id: person.id,
    guildId: person.guildId,
    displayName: person.displayName,
    title: person.title,
    department: person.department,
    status: person.status,
    timezone: person.timezone,
    location: person.location,
    email: person.email,
    tags: person.tags,
    roles: person.roles,
    joinedAt: person.joinedAt,
    lastSeenAt: person.lastSeenAt,
    managerId: person.managerId,
    avatar: person.avatar,
    pronouns: person.pronouns,
    lastAnnouncedAt: person.lastAnnouncedAt,
    lastRolesyncAt: person.lastRolesyncAt,
    offboardedAt: person.offboardedAt,
    checkins: {
      stats: person.checkinStats,
      next,
      lastCompleted,
      history: summaryCheckins
        .filter((entry) => entry.status !== 'pending')
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 6)
    }
  }
}
