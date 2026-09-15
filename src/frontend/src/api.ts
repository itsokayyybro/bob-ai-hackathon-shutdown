const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

export const api = {
  get: async (path: string) => {
    try {
      const r = await fetch(`${API_BASE}${path}`)
      if (!r.ok) throw new ApiError(`API ${path}: ${r.status}`, r.status)
      return r.json()
    } catch (e) {
      if (e instanceof ApiError) throw e
      throw new Error(`Network error: ${e}`)
    }
  },
  post: async (path: string, body?: unknown) => {
    try {
      const r = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!r.ok) throw new ApiError(`API ${path}: ${r.status}`, r.status)
      return r.json()
    } catch (e) {
      if (e instanceof ApiError) throw e
      throw new Error(`Network error: ${e}`)
    }
  },
}

export interface PriorityScore {
  entity_id: string
  entity_name: string
  entity_type: string
  priority_score: number
  criticality_score: number
  urgency_score: number
  accessibility_factor: number
  confidence_factor: number
  impact_score: number
  rank: number
  explanation: string
  supporting_factors: string[]
}

export interface Resource {
  id: string
  name: string
  type: string
  status: string
  location_id: string
  capabilities: string[]
  current_task_id: string | null
  metadata: Record<string, unknown>
}

export interface SimEvent {
  id: string
  time_offset_min: number
  event_type: string
  description: string
  entity_id: string | null
  observation_type: string | null
  value: string | null
  confidence: number
  severity: number
  processed: boolean
}

export interface EvidenceSummary {
  entity_id: string
  observation_type: string
  best_value: string
  confidence: number
  conflict_status: string
  confidence_level: string
  supporting_observations: string[]
  conflicting_observations: string[]
  source_count: number
  recommendation: string | null
}

export interface Situation {
  sim_time_min: number
  scenario: string
  top_priorities: PriorityScore[]
  blocked_infrastructure: string[]
  evidence_conflicts: string[]
  unavailable_resources: string[]
  current_plan_summary: string
  pending_events: number
  total_events: number
  processed_events: number
}

export interface MapFeature {
  type: string
  geometry: { type: string; coordinates: number[] | number[][] }
  properties: Record<string, unknown>
}

export interface BenchmarkResult {
  timestamp: string
  scenario: string
  sim_time_min: number
  ai_system: Record<string, number | string>
  baseline: Record<string, number | string>
  improvements: Record<string, number | boolean>
  methodology: string
}
