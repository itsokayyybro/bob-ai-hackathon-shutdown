const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'
const REQUEST_TIMEOUT_MS = 15_000
const REQUEST_TIMEOUT_SECONDS = REQUEST_TIMEOUT_MS / 1_000

export class ApiError extends Error {
  readonly status: number | null
  readonly detail: string | null

  constructor(message: string, status: number | null, detail: string | null = null) {
    super(message)
    this.status = status
    this.detail = detail
    this.name = 'ApiError'
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

function extractErrorDetail(payload: unknown): string | null {
  if (typeof payload === 'string') return payload.trim() || null
  if (!payload || typeof payload !== 'object') return null

  const record = payload as Record<string, unknown>
  for (const key of ['detail', 'message', 'error', 'msg']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (Array.isArray(value)) {
      const details = value
        .map(item => extractErrorDetail(item))
        .filter((item): item is string => Boolean(item))
      if (details.length) return details.join('; ')
    }
  }
  return null
}

function createAbortError(): Error {
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const callerSignal = init.signal
  const controller = new AbortController()
  let abortSource: 'caller' | 'timeout' | null = null

  const abortForCaller = () => {
    if (abortSource) return
    abortSource = 'caller'
    controller.abort()
  }

  if (callerSignal) {
    callerSignal.addEventListener('abort', abortForCaller, { once: true })
    if (callerSignal.aborted) abortForCaller()
  }

  const timeoutId = globalThis.setTimeout(() => {
    if (abortSource) return
    abortSource = 'timeout'
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
    })
    const rawBody = await response.text()
    let payload: unknown

    if (rawBody) {
      try {
        payload = JSON.parse(rawBody)
      } catch {
        payload = rawBody
      }
    }

    if (!response.ok) {
      const detail = extractErrorDetail(payload)
      const summary = `API ${path} returned ${response.status}`
      throw new ApiError(detail ? `${summary}: ${detail}` : summary, response.status, detail)
    }

    return payload as T
  } catch (error) {
    if (abortSource === 'timeout') {
      const detail = `No response was received within ${REQUEST_TIMEOUT_SECONDS} seconds.`
      throw new ApiError(`API ${path} timed out after ${REQUEST_TIMEOUT_SECONDS} seconds. Retry the request.`, null, detail)
    }
    if (abortSource === 'caller') {
      if (isAbortError(error)) throw error
      throw createAbortError()
    }
    if (isAbortError(error) || error instanceof ApiError) throw error
    const detail = getErrorMessage(error)
    throw new ApiError(`Unable to reach ${path}: ${detail}`, null, detail)
  } finally {
    globalThis.clearTimeout(timeoutId)
    callerSignal?.removeEventListener('abort', abortForCaller)
  }
}

export const api = {
  get<T>(path: string, signal?: AbortSignal): Promise<T> {
    return request<T>(path, { signal })
  },

  post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    return request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
      signal,
    })
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

export interface RawObservation {
  id: string
  source_type: string
  value: string
  confidence: number
  freshness: number
  timestamp: string
  raw_text: string | null
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
  geometry: {
    type: string
    coordinates: unknown
  }
  properties: Record<string, unknown>
}

export interface MapData {
  features: MapFeature[]
}

export interface BenchmarkResult {
  timestamp: string
  scenario: string
  sim_time_min: number
  ai_system: Record<string, unknown>
  baseline: Record<string, unknown>
  improvements: Record<string, unknown>
  methodology: string
}

export interface EvidenceResponse {
  evidence_summaries: EvidenceSummary[]
  raw_observations: RawObservation[]
}

export interface ResourceResponse {
  resources: Resource[]
}

export interface TimelineResponse {
  events: SimEvent[]
}

export interface AiQuestionResponse {
  answer?: string
}

export interface InjectEventInput {
  event_type: string
  entity_id: string
  observation_type: string
  value: string
  confidence: number
  description: string
}

export interface InjectEventPayload extends InjectEventInput {
  source_type: 'field_report'
  metadata: Record<string, never>
}

export const dashboardApi = {
  getSituation: (signal?: AbortSignal) => api.get<Situation>('/situation', signal),
  getResources: (signal?: AbortSignal) => api.get<ResourceResponse>('/resources', signal),
  getTimeline: (signal?: AbortSignal) => api.get<TimelineResponse>('/timeline', signal),
  getMapData: (signal?: AbortSignal) => api.get<MapData>('/map-data', signal),
  getBenchmark: (signal?: AbortSignal) => api.get<BenchmarkResult>('/benchmark', signal),
  getEvidence: (entityId: string, signal?: AbortSignal) =>
    api.get<EvidenceResponse>(`/evidence/${entityId}`, signal),
  askQuestion: (question: string, signal?: AbortSignal) =>
    api.post<AiQuestionResponse>('/ai/question', { question }, signal),
  processNextEvent: (signal?: AbortSignal) =>
    api.post<unknown>('/simulate/next', undefined, signal),
  autoPlay: (signal?: AbortSignal) =>
    api.post<unknown>('/simulate/auto', undefined, signal),
  resetSimulation: (signal?: AbortSignal) =>
    api.post<unknown>('/simulate/reset', undefined, signal),
  injectEvent: (event: InjectEventPayload, signal?: AbortSignal) =>
    api.post<unknown>('/simulate/event', event, signal),
}
