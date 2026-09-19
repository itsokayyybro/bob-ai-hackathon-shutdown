import type {
  AskResponse,
  Benchmark,
  Entities,
  EvidenceBundle,
  Health,
  PlanResponse,
  PriorityScore,
  Resource,
  Route,
  Situation,
  Task,
  Timeline,
  AuditRecord,
  Decision,
} from './types.ts';

/**
 * In dev, Vite proxies /api to the backend (see vite.config.ts). In production
 * the backend serves the built frontend from its own root, so requests go to
 * the same origin with no prefix. VITE_API_BASE_URL overrides both.
 */
const API_BASE =
  import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? '/api' : '');

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError(`Cannot reach the backend at ${API_BASE || 'this host'}`, 0);
  }
  if (!response.ok) {
    throw new ApiError(`${path} returned ${response.status}`, response.status);
  }
  return (await response.json()) as T;
}

function get<T>(path: string): Promise<T> {
  return request<T>(path);
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

export const api = {
  health: () => get<Health>('/health'),
  situation: () => get<Situation>('/situation'),
  entities: () => get<Entities>('/entities'),
  resources: () => get<{ resources: Resource[] }>('/resources'),
  tasks: () => get<{ tasks: Task[] }>('/tasks'),
  priorities: () => get<{ priorities: PriorityScore[] }>('/priorities'),
  timeline: () => get<Timeline>('/timeline'),
  plan: () => get<PlanResponse>('/plan'),
  audit: (limit = 50) => get<{ audit_log: AuditRecord[] }>(`/audit?limit=${limit}`),
  decisions: (limit = 20) =>
    get<{ decisions: Decision[] }>(`/decisions?limit=${limit}`),
  benchmark: () => get<Benchmark>('/benchmark'),
  evidence: (entityId: string) =>
    get<EvidenceBundle>(`/evidence/${encodeURIComponent(entityId)}`),
  route: (origin: string, destination: string, vehicleType: string) =>
    get<Route>(
      `/routes?origin=${encodeURIComponent(origin)}` +
        `&destination=${encodeURIComponent(destination)}` +
        `&vehicle_type=${encodeURIComponent(vehicleType)}`,
    ),

  optimize: () => post<unknown>('/optimize'),
  advanceOne: () => post<{ status: string }>('/simulate/next'),
  advanceAll: () => post<{ status: string; events_processed: number }>('/simulate/auto'),
  reset: () => post<{ status: string }>('/simulate/reset'),
  ask: (question: string) => post<AskResponse>('/ai/question', { question }),
};
