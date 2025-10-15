import { getAllPeople } from './peopleStore.js'

function isDue(entry, horizonMs) {
  if (!entry?.dueAt || entry.status !== 'pending') {
    return false
  }
  const due = new Date(entry.dueAt).getTime()
  if (Number.isNaN(due)) {
    return false
  }
  const now = Date.now()
  return due <= now + horizonMs
}

export async function getDueCheckins({ withinHours = 24, includeMissed = false } = {}) {
  const horizonMs = Math.max(Number(withinHours) || 0, 0) * 60 * 60 * 1000
  const people = await getAllPeople()
  const dueEntries = []

  for (const person of people) {
    const checkins = Array.isArray(person.checkins) ? person.checkins : []
    for (const entry of checkins) {
      if (isDue(entry, horizonMs)) {
        dueEntries.push({ person, checkin: entry })
      } else if (includeMissed && entry.status === 'missed') {
        dueEntries.push({ person, checkin: entry })
      }
    }
  }

  dueEntries.sort((a, b) => {
    const aDue = a.checkin.dueAt ? new Date(a.checkin.dueAt).getTime() : Number.POSITIVE_INFINITY
    const bDue = b.checkin.dueAt ? new Date(b.checkin.dueAt).getTime() : Number.POSITIVE_INFINITY
    return aDue - bDue
  })

  return dueEntries
}

export function startCheckinScheduler({
  intervalMs = 30 * 60 * 1000,
  withinHours = 24,
  includeMissed = false,
  onDueCheckins = () => {},
  logger = console
} = {}) {
  let timer = null
  let stopped = false

  async function tick() {
    if (stopped) {
      return
    }
    try {
      const due = await getDueCheckins({ withinHours, includeMissed })
      if (due.length) {
        onDueCheckins(due)
      }
    } catch (error) {
      logger?.warn?.('Check-in scheduler failed to poll due check-ins:', error)
    }
  }

  timer = setInterval(() => {
    tick().catch((error) => {
      logger?.warn?.('Check-in scheduler tick error:', error)
    })
  }, Math.max(Number(intervalMs) || 60_000, 5_000))

  // Run immediately on start
  tick().catch((error) => {
    logger?.warn?.('Initial check-in scheduler run failed:', error)
  })

  return {
    stop() {
      stopped = true
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }
  }
}
