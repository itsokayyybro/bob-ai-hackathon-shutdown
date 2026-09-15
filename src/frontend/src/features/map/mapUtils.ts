import type { MapFeature } from '../../api'
import { finiteNumber, safeText } from '../../presentation'

export type MapPosition = [number, number]
export type MapLayerId = 'assets' | 'roads' | 'bridges' | 'resources'

export interface ParsedPointFeature {
  key: string
  id: string | null
  name: string
  type: string
  status: string
  kind: Exclude<MapLayerId, 'roads'>
  position: MapPosition
  properties: Record<string, unknown>
}

export interface ParsedLineFeature {
  key: string
  id: string | null
  name: string
  status: string
  positions: MapPosition[]
  properties: Record<string, unknown>
}

export interface ParsedMapFeatures {
  points: ParsedPointFeature[]
  lines: ParsedLineFeature[]
  invalidCount: number
}

function coordinateToPosition(value: unknown): MapPosition | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const longitude = finiteNumber(value[0])
  const latitude = finiteNumber(value[1])
  if (longitude === null || latitude === null) return null
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null
  return [latitude, longitude]
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function stableFeatureKey(feature: MapFeature, id: string | null, name: string): string {
  const signature = JSON.stringify(feature.geometry?.coordinates ?? null)
  return `${feature.geometry?.type || 'unknown'}:${id || name}:${stableHash(signature)}`
}

function uniqueFeatureKey(
  feature: MapFeature,
  id: string | null,
  name: string,
  keyCounts: Map<string, number>,
): string {
  const baseKey = stableFeatureKey(feature, id, name)
  const occurrence = (keyCounts.get(baseKey) || 0) + 1
  keyCounts.set(baseKey, occurrence)
  return occurrence === 1 ? baseKey : `${baseKey}:duplicate:${occurrence}`
}

function pointKind(type: string, properties: Record<string, unknown>): ParsedPointFeature['kind'] {
  const normalizedType = type.toLowerCase()
  const category = safeText(properties.category, '').toLowerCase()
  const featureKind = safeText(properties.feature_kind, '').toLowerCase()
  if (normalizedType === 'bridge' || category === 'bridge' || featureKind === 'bridge') return 'bridges'
  if (
    normalizedType === 'resource'
    || category === 'resource'
    || featureKind === 'resource'
    || typeof properties.resource_type === 'string'
  ) return 'resources'
  return 'assets'
}

export function parseMapFeatures(features: MapFeature[] | undefined): ParsedMapFeatures {
  const points: ParsedPointFeature[] = []
  const lines: ParsedLineFeature[] = []
  const keyCounts = new Map<string, number>()
  let invalidCount = 0

  for (const feature of Array.isArray(features) ? features : []) {
    if (!feature || typeof feature !== 'object' || !feature.geometry || !feature.properties) {
      invalidCount += 1
      continue
    }

    const id = typeof feature.properties.id === 'string' && feature.properties.id.trim()
      ? feature.properties.id.trim()
      : null
    const name = safeText(feature.properties.name, id || 'Unnamed map object')
    const status = safeText(feature.properties.status, feature.geometry.type === 'LineString' ? 'open' : 'unknown')

    if (feature.geometry.type === 'Point') {
      const position = coordinateToPosition(feature.geometry.coordinates)
      if (!position) {
        invalidCount += 1
        continue
      }
      const type = safeText(feature.properties.type, 'location')
      points.push({
        key: uniqueFeatureKey(feature, id, name, keyCounts),
        id,
        name,
        type,
        status,
        kind: pointKind(type, feature.properties),
        position,
        properties: feature.properties,
      })
      continue
    }

    if (feature.geometry.type === 'LineString' && Array.isArray(feature.geometry.coordinates)) {
      const positions: MapPosition[] = []
      let malformed = false

      for (const coordinate of feature.geometry.coordinates) {
        const position = coordinateToPosition(coordinate)
        if (!position) {
          malformed = true
          break
        }
        positions.push(position)
      }

      if (malformed || positions.length < 2) {
        invalidCount += 1
        continue
      }

      lines.push({
        key: uniqueFeatureKey(feature, id, name, keyCounts),
        id,
        name,
        status,
        positions,
        properties: feature.properties,
      })
      continue
    }

    invalidCount += 1
  }

  return { points, lines, invalidCount }
}

export function statusColor(status: string): string {
  const colors: Record<string, string> = {
    operational: '#34d399',
    open: '#34d399',
    available: '#34d399',
    damaged: '#fbbf24',
    partially_blocked: '#fbbf24',
    high_risk: '#fb923c',
    blocked: '#fb7185',
    destroyed: '#fb7185',
    unavailable: '#fb7185',
    overloaded: '#fb7185',
    flooded: '#60a5fa',
    deployed: '#fbbf24',
    en_route: '#38bdf8',
    evacuated: '#c084fc',
    unknown: '#94a3b8',
  }
  return colors[status.toLowerCase()] || colors.unknown
}

export function priorityFill(score: number): string {
  if (score >= 0.7) return '#e11d48'
  if (score >= 0.45) return '#d97706'
  return '#059669'
}
