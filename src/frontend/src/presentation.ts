export const ENTITY_ICONS: Record<string, string> = {
  hospital: '🏥',
  health_post: '⚕️',
  school: '🏫',
  shelter: '⛺',
  hydropower: '⚡',
  command_center: '📡',
  village: '🏘️',
  resource: '📦',
  resource_base: '📦',
  bridge: '🌉',
  road: '🛣️',
  rescue_team: '🚒',
  ambulance: '🚑',
  engineering_team: '🔧',
  supply_vehicle: '🚛',
  medical_unit: '🏥',
}

export function entityIcon(type: unknown): string {
  return typeof type === 'string' ? ENTITY_ICONS[type] || '📍' : '📍'
}

export function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function clampUnit(value: unknown): number {
  const number = finiteNumber(value)
  if (number === null) return 0
  return Math.min(1, Math.max(0, number))
}

export function formatPercent(value: unknown, digits = 0): string {
  const number = finiteNumber(value)
  return number === null ? '—' : `${(number * 100).toFixed(digits)}%`
}

export function formatNumber(value: unknown, digits = 0, suffix = ''): string {
  const number = finiteNumber(value)
  return number === null ? '—' : `${number.toFixed(digits)}${suffix}`
}

export function safeText(value: unknown, fallback = 'Unknown'): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export function titleCase(value: unknown, fallback = 'Unknown'): string {
  return safeText(value, fallback)
    .replaceAll('_', ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
}

export function statusClass(value: unknown): string {
  const status = safeText(value, 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '-')
  return `status-${status}`
}

export function priorityLevel(value: unknown): 'high' | 'medium' | 'low' {
  const score = clampUnit(value)
  if (score >= 0.7) return 'high'
  if (score >= 0.45) return 'medium'
  return 'low'
}

export function formatTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'Time unavailable'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
