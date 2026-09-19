/**
 * Domain constants mirrored from the backend.
 *
 * Source of truth: src/backend/app/config.py. These are duplicated here only so
 * the console can show operators *why* an observation carries the weight it does.
 * The backend remains authoritative for every score it returns.
 */

/** Priority weights — Settings.priority_weight_*. Verified: the weighted sum of
 *  the five factors reproduces the API's priority_score exactly. */
export const PRIORITY_WEIGHTS = [
  { key: 'criticality_score', weight: 0.3, label: 'Criticality', tone: 'flood' },
  { key: 'urgency_score', weight: 0.25, label: 'Urgency', tone: 'silt' },
  { key: 'impact_score', weight: 0.2, label: 'Impact', tone: 'sky' },
  { key: 'accessibility_factor', weight: 0.15, label: 'Access', tone: 'glacial' },
  { key: 'confidence_factor', weight: 0.1, label: 'Confidence', tone: 'text-mid' },
] as const;

export type PriorityFactorKey = (typeof PRIORITY_WEIGHTS)[number]['key'];

/** Settings.reliability_* — baseline trust per source type. */
export const SOURCE_RELIABILITY: Record<string, number> = {
  satellite: 0.85,
  drone: 0.9,
  field_report: 0.88,
  emergency_call: 0.75,
  hospital: 0.95,
  school: 0.85,
  sensor: 0.8,
  authority_report: 0.92,
  simulation: 1.0,
};

export const DEFAULT_RELIABILITY = 0.7;

export function sourceReliability(sourceType: string): number {
  return SOURCE_RELIABILITY[sourceType] ?? DEFAULT_RELIABILITY;
}

/** Settings.freshness_lambda_* — decay rate per hour, freshness = exp(-λ·age). */
export const FRESHNESS_LAMBDA: Record<string, number> = {
  bridge_status: 2.0,
  road_status: 1.5,
  capacity: 2.0,
  structural: 0.5,
  population: 0.1,
  flood_level: 3.0,
};

export const DEFAULT_LAMBDA = 1.0;

export function freshnessLambda(observationType: string): number {
  return FRESHNESS_LAMBDA[observationType] ?? DEFAULT_LAMBDA;
}

/** Conflict threshold — Settings.conflict_weight_difference_threshold. */
export const CONFLICT_THRESHOLD = 0.3;

/* ── Presentation mappings ───────────────────────────────────────────────── */

export type Tone = 'glacial' | 'silt' | 'flood' | 'sky' | 'neutral';

export const ASSET_STATUS_TONE: Record<string, Tone> = {
  operational: 'glacial',
  evacuated: 'sky',
  damaged: 'silt',
  overloaded: 'silt',
  unknown: 'silt',
  flooded: 'flood',
  destroyed: 'flood',
};

export const ROAD_STATUS_TONE: Record<string, Tone> = {
  open: 'glacial',
  partially_blocked: 'silt',
  high_risk: 'silt',
  unknown: 'silt',
  blocked: 'flood',
};

export const RESOURCE_STATUS_TONE: Record<string, Tone> = {
  available: 'glacial',
  en_route: 'sky',
  deployed: 'sky',
  unavailable: 'flood',
};

/** Short codes for the survey plate. Assets are labelled by their real IDs; the
 *  glyph carries the facility class so the plate reads without a legend lookup. */
export const ENTITY_GLYPH: Record<string, string> = {
  command_center: '◼',
  hospital: '✚',
  health_post: '+',
  school: '▲',
  shelter: '⌂',
  hydropower: '≈',
  village: '●',
  resource_base: '▣',
  bridge: '⌇',
  intersection: '○',
};

export const RESOURCE_GLYPH: Record<string, string> = {
  rescue_team: '◆',
  ambulance: '✚',
  engineering_team: '⚙',
  supply_vehicle: '▮',
  medical_unit: '⊕',
};

const WORD_OVERRIDES: Record<string, string> = {
  id: 'ID',
  eta: 'ETA',
  ai: 'AI',
  pct: '%',
  min: 'min',
  km: 'km',
};

/** turn `bridge_status` into `Bridge status`, `total_travel_time_min` into
 *  `Total travel time min`. Used for API keys we render verbatim. */
export function humanise(raw: string): string {
  const words = raw.split(/[_\s]+/).filter(Boolean);
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (WORD_OVERRIDES[lower]) return WORD_OVERRIDES[lower];
      if (index === 0) return lower.charAt(0).toUpperCase() + lower.slice(1);
      return lower;
    })
    .join(' ');
}
