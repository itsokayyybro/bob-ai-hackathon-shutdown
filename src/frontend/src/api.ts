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
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
      if (!r.ok) throw new ApiError(`API ${path}: ${r.status}`, r.status)
      return r.json()
    } catch (e) {
      if (e instanceof ApiError) throw e
      throw new Error(`Network error: ${e}`)
    }
  },
}

// ── Domain Types ─────────────────────────────────────────────────────────────

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
  last_verified?: string
}

export interface RawObservation {
  id: string
  source_type: string
  observation_type?: string
  value: string
  confidence: number
  freshness: number
  timestamp: string
  raw_text: string | null
  severity?: number
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

/** Decision from GET /decisions or GET /decisions/{id} */
export interface Decision {
  id: string
  timestamp: string
  recommended_action: string
  target_entity_id: string | null
  resource_id: string | null
  priority: number
  confidence: number
  reasons: string[]
  constraints: string[]
  alternatives_considered: string[]
  human_verification_required: boolean
  simulation_time_min: number
  operator_status: string | null       // accepted | rejected | modified | null
  operator_notes: string | null
  is_current: boolean
  // B7 enrichment (present when fetched via GET /decisions/{id})
  ai_explanation?: string
  task_id?: string | null
  route_feasible?: boolean | null
  estimated_arrival_min?: number | null
  resource_type?: string | null
  capability?: string | null
  supporting_factors?: string[]
  human_verification_required_b7?: boolean
  last_evidence_verified?: string | null
  target_entity_accessibility?: number | null
}

/** One entry in plan_changes[] returned by /simulate/next and /simulate/event */
export interface PlanChange {
  task_id: string
  entity_id: string
  previous_resource_id: string | null
  new_resource_id: string | null
  previous_eta_min: number | null
  new_eta_min: number | null
  previous_route_feasible: boolean
  new_route_feasible: boolean
  change_reason: string
  triggering_event_id: string | null
  triggering_event_type: string | null
  affected_infrastructure_id: string | null
  review_required: boolean
}

/** Result from POST /simulate/next or /simulate/event */
export interface SimulationStepResult {
  status: string
  event?: {
    id: string
    time_offset_min: number
    event_type: string
    description: string
    entity_id: string | null
  }
  situation_update?: Situation
  plan_changes?: PlanChange[]
  affected_decision_ids?: string[]
}

/** Allocation in /plan response */
export interface AllocationResult {
  task_id: string
  resource_id: string
  estimated_arrival_min: number
  priority_score: number
  explanation: string
  route?: {
    feasible: boolean
    path_nodes: string[]
    path_edges: string[]
    total_distance_km: number
    total_time_min: number
    total_risk: number
    reason: string
  } | null
  // B7 enrichment
  task_id_b7?: string | null
  route_feasible?: boolean | null
  resource_type?: string | null
  capability?: string | null
  supporting_factors?: string[]
  target_entity_accessibility?: number | null
}

/** Full plan from GET /plan */
export interface ResponsePlan {
  plan_id: string
  simulation_time_min: number
  allocations: AllocationResult[]
  unassigned_tasks: string[]
  total_travel_time: number
  coverage_score: number
  explanation: string
}
