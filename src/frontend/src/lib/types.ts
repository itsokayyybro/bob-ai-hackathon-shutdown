/**
 * API response types.
 *
 * These mirror the FastAPI responses in src/backend/app/main.py. Field names and
 * shapes were verified against live responses from a running backend, not
 * inferred from the docs.
 */

export type AssetStatus =
  | 'operational'
  | 'damaged'
  | 'destroyed'
  | 'unknown'
  | 'flooded'
  | 'evacuated'
  | 'overloaded';

export type RoadStatus =
  | 'open'
  | 'partially_blocked'
  | 'blocked'
  | 'unknown'
  | 'high_risk';

export type ResourceStatus =
  | 'available'
  | 'deployed'
  | 'unavailable'
  | 'en_route';

export type ConflictStatus = 'none' | 'conflicting' | 'resolved';

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'very_low';

export interface PriorityScore {
  entity_id: string;
  entity_name: string;
  entity_type: string;
  priority_score: number;
  criticality_score: number;
  urgency_score: number;
  accessibility_factor: number;
  confidence_factor: number;
  impact_score: number;
  rank: number;
  explanation: string;
  supporting_factors: string[];
}

export interface Situation {
  sim_time_min: number;
  scenario: string;
  top_priorities: PriorityScore[];
  blocked_infrastructure: string[];
  evidence_conflicts: string[];
  unavailable_resources: string[];
  current_plan_summary: string;
  pending_events: number;
  total_events: number;
  processed_events: number;
}

export interface Asset {
  id: string;
  name: string;
  type: string;
  lat: number;
  lon: number;
  elevation_m: number | null;
  population: number;
  status: AssetStatus;
  criticality: number;
  importance: number;
  metadata: Record<string, unknown>;
}

export interface Road {
  id: string;
  name: string;
  from_node: string;
  to_node: string;
  distance_km: number;
  travel_time_min: number;
  status: RoadStatus;
  risk: number;
  confidence: number;
}

export interface Bridge {
  id: string;
  name: string;
  on_road: string;
  lat: number;
  lon: number;
  status: RoadStatus;
  capacity: string;
  confidence: number;
  conflict_status: ConflictStatus;
}

export interface Entities {
  assets: Asset[];
  roads: Road[];
  bridges: Bridge[];
}

export interface Resource {
  id: string;
  name: string;
  type: string;
  status: ResourceStatus;
  location_id: string;
  capabilities: string[];
  current_task_id: string | null;
  metadata: Record<string, unknown>;
}

export interface EvidenceSummary {
  entity_id: string;
  observation_type: string;
  best_value: string;
  confidence: number;
  conflict_status: ConflictStatus;
  confidence_level: ConfidenceLevel;
  supporting_observations: string[];
  conflicting_observations: string[];
  last_verified: string;
  source_count: number;
  recommendation: string | null;
}

export interface RawObservation {
  id: string;
  timestamp: string;
  source_type: string;
  source_id: string;
  observation_type: string;
  value: string;
  confidence: number;
  freshness: number;
  severity: number;
  raw_text: string | null;
  provenance: Record<string, unknown>;
}

export interface EvidenceBundle {
  entity_id: string;
  evidence_summaries: EvidenceSummary[];
  raw_observations: RawObservation[];
}

export interface SimEvent {
  id: string;
  time_offset_min: number;
  event_type: string;
  description: string;
  entity_id: string | null;
  observation_type: string | null;
  value: string | null;
  confidence: number;
  severity: number;
  processed: boolean;
}

export interface Timeline {
  events: SimEvent[];
  sim_time_min: number;
  processed_count: number;
  pending_count: number;
}

export interface Route {
  origin: string;
  destination: string;
  path_nodes: string[];
  path_edges: string[];
  total_distance_km: number;
  total_time_min: number;
  total_risk: number;
  feasible: boolean;
  blocked_alternatives: string[];
  reason: string;
  vehicle_type: string;
}

export interface Decision {
  decision_id?: string;
  id?: string;
  timestamp: string;
  recommended_action: string;
  target_entity_id: string | null;
  resource_id: string | null;
  priority: number;
  confidence: number;
  reasons: string[];
  constraints: string[];
  alternatives_considered: string[];
  human_verification_required: boolean;
  simulation_time_min: number;
}

export interface Allocation {
  task_id: string;
  resource_id: string;
  route: Route | null;
  estimated_arrival_min: number;
  priority_score: number;
  explanation: string;
}

export interface ResponsePlan {
  plan_id: string;
  simulation_time_min: number;
  allocations: Allocation[];
  unassigned_tasks: string[];
  unassigned_resources: string[];
  total_travel_time: number;
  coverage_score: number;
  explanation: string;
  decisions: Decision[];
}

export interface PlanResponse {
  plan: ResponsePlan | null;
  baseline: ResponsePlan | null;
}

export interface Task {
  id: string;
  name: string;
  task_type: string;
  target_entity_id: string;
  priority: number;
  urgency: number;
  status: string;
  required_capabilities: string[];
}

export interface AuditRecord {
  id: string;
  timestamp: string;
  event_type: string;
  entity_id: string | null;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  reason: string;
  confidence: number;
  sim_time_min: number;
}

export type BenchmarkMetrics = Record<string, number | string>;

export interface Benchmark {
  timestamp: string;
  scenario: string;
  sim_time_min: number;
  ai_system: BenchmarkMetrics;
  baseline: BenchmarkMetrics;
  improvements: Record<string, number | boolean>;
  methodology: string;
  disclaimer?: string;
}

export interface AskResponse {
  question: string;
  answer: string;
  context_snapshot: {
    sim_time_min: number;
    top_priority: string | null;
    blocked_count: number;
    conflict_count: number;
  };
}

export interface Health {
  status: string;
  version: string;
  simulation_time_min: number;
  assets: number;
  observations: number;
  pending_events: number;
}
