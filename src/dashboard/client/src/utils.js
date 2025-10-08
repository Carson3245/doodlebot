export function formatDuration(ms) {
  if (!ms) return '00:00:00'
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}

export function formatDateTime(value) {
  if (!value) return 'Never'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return String(value)
  }
}

export function initialsFromName(name) {
  if (!name) return '--'
  return name
    .split(' ')
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase()
}
