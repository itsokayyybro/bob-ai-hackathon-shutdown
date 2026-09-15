import { useState, useEffect, useCallback, useRef, Component } from 'react'
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { api } from './api'
import type { Situation, Resource, EvidenceSummary, BenchmarkResult } from './api'

class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: string | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { error: error.message || 'Unknown error' }
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#ef4444', fontFamily: 'monospace' }}>
          <h2>⚠ Application Error</h2>
          <p>{this.state.error}</p>
          <button className="btn" onClick={() => window.location.reload()}>Reload</button>
        </div>
      )
    }
    return this.props.children
  }
}

function LoadingScreen({ message }: { message?: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#0a0e1a', color: '#94a3b8',
      fontFamily: 'sans-serif', fontSize: 16, flexDirection: 'column', gap: 12
    }}>
      <div style={{ fontSize: 32 }}>⏳</div>
      <div>{message || 'Loading Emergency Operations Center…'}</div>
    </div>
  )
}

function BackendError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#0a0e1a', color: '#ef4444',
      fontFamily: 'sans-serif', padding: 32, flexDirection: 'column', gap: 16, textAlign: 'center'
    }}>
      <div style={{ fontSize: 48 }}>⚠️</div>
      <h2>Backend Unavailable</h2>
      <p style={{ color: '#94a3b8', maxWidth: 500 }}>{message}</p>
      <button className="btn primary" onClick={onRetry}>Retry Connection</button>
      <p style={{ fontSize: 12, color: '#64748b' }}>
        Ensure the backend server is running on port 8000.
      </p>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const ENTITY_ICONS: Record<string, string> = {
  hospital: '🏥', health_post: '⚕️', school: '🏫', shelter: '🛖',
  hydropower: '⚡', command_center: '📡', village: '🏘️',
  resource_base: '📦', bridge: '🌉', road: '🛣️',
  rescue_team: '🚒', ambulance: '🚑', engineering_team: '🔧',
  supply_vehicle: '🚛', medical_unit: '🏥',
}

const STATUS_COLOR: Record<string, string> = {
  operational: '#22c55e', open: '#22c55e',
  damaged: '#f59e0b', partially_blocked: '#f59e0b', high_risk: '#f97316',
  blocked: '#ef4444', destroyed: '#ef4444', unavailable: '#ef4444',
  flooded: '#3b82f6', overloaded: '#ef4444', evacuated: '#a855f7',
  unknown: '#64748b',
}

function priorityColor(score: number): string {
  if (score >= 0.7) return '#ef4444'
  if (score >= 0.45) return '#f59e0b'
  return '#22c55e'
}

function priorityLabel(score: number): string {
  if (score >= 0.7) return 'high'
  if (score >= 0.45) return 'medium'
  return 'low'
}

function confidenceLabel(score: number): string {
  if (score >= 0.75) return 'high'
  if (score >= 0.5) return 'medium'
  return 'low'
}

// ── Map Component ─────────────────────────────────────────────────────────────

interface MapProps {
  mapData: { features: MapFeature[] } | null
  priorities: Record<string, number>
  selectedId: string | null
  onSelect: (id: string) => void
}

interface MapFeature {
  type: string
  geometry: { type: string; coordinates: number[] | number[][] }
  properties: Record<string, unknown>
}

function DisasterMap({ mapData, priorities, selectedId, onSelect }: MapProps) {
  if (!mapData) return <div className="loading-spinner">Loading map…</div>

  const features = mapData.features || []
  const points = features.filter(f => f.geometry.type === 'Point')
  const lines = features.filter(f => f.geometry.type === 'LineString')

  return (
    <MapContainer
      center={[28.11, 85.705]}
      zoom={12}
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
      />

      {/* Roads */}
      {lines.map((f, i) => {
        const props = f.properties
        const status = props.status as string || 'open'
        const coords = f.geometry.coordinates as number[][]
        const color = STATUS_COLOR[status] || '#3b82f6'
        return (
          <Polyline
            key={i}
            positions={coords.map(c => [c[1], c[0]] as [number, number])}
            color={color}
            weight={status === 'blocked' ? 3 : 2}
            opacity={status === 'blocked' ? 0.9 : 0.6}
            dashArray={status === 'blocked' ? '6 4' : undefined}
          >
            <Popup>
              <b>{props.name as string}</b><br />
              Status: <span style={{ color }}>{status.toUpperCase()}</span><br />
              {props.distance_km as number} km · {props.travel_time_min as number} min<br />
              Risk: {((props.risk as number) * 100).toFixed(0)}%
            </Popup>
          </Polyline>
        )
      })}

      {/* Assets & Resources */}
      {points.map((f, i) => {
        const props = f.properties
        const coords = f.geometry.coordinates as number[]
        const id = props.id as string
        const type = props.type as string
        const status = props.status as string || 'operational'
        const priority = priorities[id] || 0
        const isResource = type === 'resource'
        const isBridge = type === 'bridge'
        const isSelected = id === selectedId

        let color = STATUS_COLOR[status] || '#3b82f6'
        if (!isResource && !isBridge && priority > 0) {
          color = priorityColor(priority)
        }
        if (isBridge) color = STATUS_COLOR[(props.status as string) || 'open']

        const radius = isResource ? 5 : isBridge ? 7 : Math.max(8, 8 + (priority || 0) * 10)

        return (
          <CircleMarker
            key={i}
            center={[coords[1], coords[0]]}
            radius={isSelected ? radius + 4 : radius}
            color={isSelected ? '#ffffff' : color}
            fillColor={color}
            fillOpacity={0.85}
            weight={isSelected ? 3 : 1}
            eventHandlers={{ click: () => !isResource && onSelect(id) }}
          >
            <Popup>
              <b>{props.name as string}</b><br />
              Type: {type}<br />
              Status: <span style={{ color }}>{status.toUpperCase()}</span>
              {(props.population as number) > 0 && <><br />Population: {(props.population as number).toLocaleString()}</>}
              {priority > 0 && <><br />Priority: {priority.toFixed(3)}</>}
              {(props.confidence as number) && <><br />Confidence: {((props.confidence as number) * 100).toFixed(0)}%</>}
              {props.conflict_status === 'conflicting' && <><br /><span style={{ color: '#f59e0b' }}>⚠ CONFLICTING EVIDENCE</span></>}
            </Popup>
          </CircleMarker>
        )
      })}
    </MapContainer>
  )
}

// ── Priority Panel ────────────────────────────────────────────────────────────

function PriorityPanel({
  priorities, selectedId, onSelect, conflicts
}: {
  priorities: { entity_id: string; entity_name: string; entity_type: string; priority_score: number; urgency_score: number; accessibility_factor: number; confidence_factor: number; explanation: string; supporting_factors: string[]; rank: number }[]
  selectedId: string | null
  onSelect: (id: string) => void
  conflicts: string[]
}) {
  const entityConflicts = new Set(conflicts.map(c => c.split(':')[0].trim().split('/')[0]))

  return (
    <div className="panel">
      <div className="panel-header">
        🎯 Priority Queue
        <span className="count-badge">{priorities.length}</span>
      </div>
      {conflicts.length > 0 && (
        <div className="conflict-alert">
          <strong>⚠ {conflicts.length} Evidence Conflict{conflicts.length > 1 ? 's' : ''}</strong>
          {conflicts.slice(0, 2).map((c, i) => <div key={i}>{c.slice(0, 60)}…</div>)}
        </div>
      )}
      <div className="panel-scroll">
        {priorities.slice(0, 12).map(p => {
          const label = priorityLabel(p.priority_score)
          const hasConflict = entityConflicts.has(p.entity_id)
          return (
            <div
              key={p.entity_id}
              className={`priority-card ${selectedId === p.entity_id ? 'active' : ''}`}
              onClick={() => onSelect(p.entity_id)}
            >
              <div className="priority-card-header">
                <span className="priority-rank">#{p.rank}</span>
                <span className="priority-name">
                  {ENTITY_ICONS[p.entity_type] || '📍'} {p.entity_name}
                </span>
                {hasConflict && <span className="conflict-flag">⚠</span>}
                <span className={`priority-badge ${label}`}>{label}</span>
              </div>
              <div className="priority-bar">
                <div
                  className="priority-bar-fill"
                  style={{ width: `${p.priority_score * 100}%`, background: priorityColor(p.priority_score) }}
                />
              </div>
              <div className="priority-meta">
                <span>P: {p.priority_score.toFixed(3)}</span>
                <span>U: {(p.urgency_score * 100).toFixed(0)}%</span>
                <span>A: {(p.accessibility_factor * 100).toFixed(0)}%</span>
                <span>C: {(p.confidence_factor * 100).toFixed(0)}%</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Right Panel (Entity Detail + Evidence) ────────────────────────────────────

function EntityPanel({
  selectedId, entities, priorities, onQuestion
}: {
  selectedId: string | null
  entities: Record<string, { name: string; type: string; status: string; population?: number; criticality?: number; metadata?: Record<string, unknown> }>
  priorities: Record<string, { priority_score: number; urgency_score: number; accessibility_factor: number; confidence_factor: number; explanation: string; supporting_factors: string[] }>
  onQuestion: (q: string) => void
}) {
  const [evidence, setEvidence] = useState<EvidenceSummary[]>([])
  const [rawObs, setRawObs] = useState<{ id: string; source_type: string; value: string; confidence: number; freshness: number; timestamp: string; raw_text: string | null }[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!selectedId) { setEvidence([]); setRawObs([]); return }
    setLoading(true)
    api.get(`/evidence/${selectedId}`)
      .then(d => { setEvidence(d.evidence_summaries || []); setRawObs(d.raw_observations || []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [selectedId])

  if (!selectedId) {
    return (
      <div className="panel panel-right">
        <div className="panel-header">📋 Entity Detail</div>
        <div className="loading-spinner" style={{ marginTop: 40 }}>
          Select a location from the map or priority queue
        </div>
      </div>
    )
  }

  const entity = entities[selectedId]
  const priority = priorities[selectedId]
  const status = entity?.status || 'unknown'

  return (
    <div className="panel panel-right">
      <div className="panel-header">
        {ENTITY_ICONS[entity?.type || ''] || '📍'} {entity?.name || selectedId}
      </div>
      <div className="panel-scroll">
        {/* Entity header */}
        <div className="evidence-section">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <span className={`status-tag ${status}`}>{status}</span>
            {entity?.type && <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{entity.type.replace('_', ' ').toUpperCase()}</span>}
          </div>
          {entity?.population ? <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>👥 {entity.population.toLocaleString()} people</div> : null}
          {priority && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>PRIORITY SCORE</div>
              <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${priority.priority_score * 100}%`, background: priorityColor(priority.priority_score), borderRadius: 3 }} />
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{priority.explanation}</div>
              {priority.supporting_factors.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  {priority.supporting_factors.map((f, i) => (
                    <span key={i} style={{ display: 'inline-block', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 5px', fontSize: 10, marginRight: 3, marginTop: 2, color: 'var(--text-secondary)' }}>{f}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Evidence summaries */}
        {loading ? (
          <div className="loading-spinner">Loading evidence…</div>
        ) : evidence.length > 0 ? (
          <div className="evidence-section">
            <div className="evidence-section-title">Evidence Summaries ({evidence.length})</div>
            {evidence.map((e, i) => (
              <div key={i} className={`evidence-item ${e.conflict_status === 'conflicting' ? 'conflicting' : ''}`}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{e.observation_type.replace('_', ' ').toUpperCase()}</div>
                  <div className="evidence-value">
                    {e.best_value.toUpperCase()}
                    {e.conflict_status === 'conflicting' && <span style={{ color: 'var(--accent-yellow)', marginLeft: 6 }}>⚠ CONFLICT</span>}
                  </div>
                  {e.recommendation && <div style={{ fontSize: 10, color: 'var(--accent-yellow)', marginTop: 2 }}>{e.recommendation.slice(0, 100)}</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="confidence-bar">
                    <div className={`confidence-fill ${confidenceLabel(e.confidence)}`} style={{ width: `${e.confidence * 100}%` }} />
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{(e.confidence * 100).toFixed(0)}% · {e.source_count} src</div>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* Raw observations */}
        {rawObs.length > 0 && (
          <div className="evidence-section">
            <div className="evidence-section-title">Raw Observations ({rawObs.length})</div>
            {rawObs.map((o, i) => (
              <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid var(--border)', marginBottom: 2 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{o.timestamp.slice(11, 16)}</span>
                  <span style={{ fontSize: 10, color: 'var(--accent-blue)', textTransform: 'uppercase' }}>{o.source_type}</span>
                  <span style={{ fontSize: 10, fontWeight: 600 }}>{o.value.toUpperCase()}</span>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>conf={Math.round(o.confidence * 100)}% fresh={Math.round(o.freshness * 100)}%</span>
                </div>
                {o.raw_text && <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 2, fontStyle: 'italic' }}>"{o.raw_text.slice(0, 80)}"</div>}
              </div>
            ))}
          </div>
        )}

        {/* Quick questions */}
        <div className="evidence-section">
          <div className="evidence-section-title">Quick Questions</div>
          {[
            `What is the priority for ${entity?.name}?`,
            `What evidence supports this?`,
            `What route should we use?`,
          ].map(q => (
            <button key={q} className="btn" style={{ width: '100%', marginBottom: 4, textAlign: 'left', padding: '4px 8px' }} onClick={() => onQuestion(q)}>
              💬 {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Resources Panel ───────────────────────────────────────────────────────────

function ResourcesPanel({ resources }: { resources: Resource[] }) {
  const resourceIcon: Record<string, string> = {
    rescue_team: '🚒', ambulance: '🚑', engineering_team: '🔧',
    supply_vehicle: '🚛', medical_unit: '🏥',
  }

  const grouped = resources.reduce((acc, r) => {
    acc[r.status] = [...(acc[r.status] || []), r]
    return acc
  }, {} as Record<string, Resource[]>)

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {['available', 'deployed', 'en_route', 'unavailable'].map(status => {
        const items = grouped[status] || []
        if (!items.length) return null
        return (
          <div key={status}>
            <div style={{ padding: '4px 12px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', background: 'var(--bg-card)' }}>
              {status} ({items.length})
            </div>
            {items.map(r => (
              <div key={r.id} className="resource-item">
                <span className="resource-icon">{resourceIcon[r.type] || '👤'}</span>
                <div className="resource-info">
                  <div className="resource-name">{r.name}</div>
                  <div className="resource-detail">@ {r.location_id} · {r.capabilities.join(', ')}</div>
                </div>
                <span className={`status-tag ${r.status}`}>{r.status}</span>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// ── Simulation Controls ───────────────────────────────────────────────────────

interface InjectForm {
  event_type: string
  entity_id: string
  observation_type: string
  value: string
  confidence: number
  description: string
}

function SimControls({
  pendingEvents, onNext, onAutoPlay, onReset, onInject, loading
}: {
  pendingEvents: number
  onNext: () => void
  onAutoPlay: () => void
  onReset: () => void
  onInject: (form: InjectForm) => void
  loading: boolean
}) {
  const [showInject, setShowInject] = useState(false)
  const [form, setForm] = useState<InjectForm>({
    event_type: 'road_blockage',
    entity_id: 'R7',
    observation_type: 'road_status',
    value: 'blocked',
    confidence: 0.85,
    description: 'Operator injected event',
  })

  const PRESET_EVENTS = [
    { label: 'Block Road R7', event_type: 'road_blockage', entity_id: 'R7', observation_type: 'road_status', value: 'blocked', confidence: 0.9, description: 'Road R7 blocked by landslide' },
    { label: 'Block Bridge B2', event_type: 'bridge_damage_report', entity_id: 'B2', observation_type: 'bridge_status', value: 'blocked', confidence: 0.88, description: 'Bridge B2 structural damage' },
    { label: 'Overload HP1', event_type: 'hospital_demand_surge', entity_id: 'HP1', observation_type: 'capacity', value: 'overloaded', confidence: 0.95, description: 'Health post HP1 overloaded with casualties' },
    { label: 'Isolate V3', event_type: 'village_isolation_confirmed', entity_id: 'V3', observation_type: 'accessibility', value: 'isolated', confidence: 0.9, description: 'Village V3 (Gorkhe Gaun) isolated by road damage' },
    { label: 'Resource RT2 unavailable', event_type: 'resource_unavailable', entity_id: 'RT2', observation_type: 'resource_status', value: 'unavailable', confidence: 1.0, description: 'Rescue Team Bravo unavailable' },
    { label: 'Conflict: B2 open', event_type: 'conflicting_bridge_report', entity_id: 'B2', observation_type: 'bridge_status', value: 'open', confidence: 0.55, description: 'Conflicting report: B2 may be passable' },
  ]

  return (
    <div className="bottom-section">
      <div className="panel-header">⚡ Simulation Controls</div>
      <div className="sim-controls">
        <button className="btn primary" onClick={onNext} disabled={loading || pendingEvents === 0}>
          ⏭ Next Event ({pendingEvents})
        </button>
        <button className="btn success" onClick={onAutoPlay} disabled={loading || pendingEvents === 0}>
          ▶ Auto Play
        </button>
        <button className="btn danger" onClick={onReset} disabled={loading}>
          ↺ Reset
        </button>
        <button className="btn" onClick={() => setShowInject(s => !s)}>
          ⚡ {showInject ? 'Hide' : 'Inject Event'}
        </button>
      </div>
      {showInject && (
        <div style={{ padding: '0 12px 8px', overflowY: 'auto', flex: 1 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>Quick Presets</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {PRESET_EVENTS.map(p => (
              <button key={p.label} className="btn" style={{ padding: '3px 8px', fontSize: 10 }}
                onClick={() => onInject({ event_type: p.event_type, entity_id: p.entity_id, observation_type: p.observation_type, value: p.value, confidence: p.confidence, description: p.description })}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="inject-form">
            <div className="form-row">
              <div>
                <label>Event Type</label>
                <select value={form.event_type} onChange={e => setForm(s => ({ ...s, event_type: e.target.value }))}>
                  <option value="road_blockage">road_blockage</option>
                  <option value="bridge_damage_report">bridge_damage_report</option>
                  <option value="bridge_confirmed_blocked">bridge_confirmed_blocked</option>
                  <option value="conflicting_bridge_report">conflicting_bridge_report</option>
                  <option value="hospital_demand_surge">hospital_demand_surge</option>
                  <option value="school_evacuation">school_evacuation</option>
                  <option value="resource_unavailable">resource_unavailable</option>
                  <option value="satellite_observation">satellite_observation</option>
                  <option value="village_isolation_confirmed">village_isolation_confirmed</option>
                  <option value="alternate_route_opened">alternate_route_opened</option>
                </select>
              </div>
              <div>
                <label>Entity ID</label>
                <input value={form.entity_id} onChange={e => setForm(s => ({ ...s, entity_id: e.target.value }))} placeholder="B1, R4, H1…" />
              </div>
            </div>
            <div className="form-row">
              <div>
                <label>Observation Type</label>
                <select value={form.observation_type} onChange={e => setForm(s => ({ ...s, observation_type: e.target.value }))}>
                  <option value="bridge_status">bridge_status</option>
                  <option value="road_status">road_status</option>
                  <option value="capacity">capacity</option>
                  <option value="accessibility">accessibility</option>
                  <option value="flood_level">flood_level</option>
                  <option value="resource_status">resource_status</option>
                  <option value="damage">damage</option>
                </select>
              </div>
              <div>
                <label>Value</label>
                <select value={form.value} onChange={e => setForm(s => ({ ...s, value: e.target.value }))}>
                  <option value="blocked">blocked</option>
                  <option value="open">open</option>
                  <option value="partially_blocked">partially_blocked</option>
                  <option value="overloaded">overloaded</option>
                  <option value="unavailable">unavailable</option>
                  <option value="isolated">isolated</option>
                  <option value="flooded">flooded</option>
                  <option value="evacuation_required">evacuation_required</option>
                  <option value="damaged">damaged</option>
                </select>
              </div>
              <div>
                <label>Confidence</label>
                <input type="number" min="0" max="1" step="0.05" value={form.confidence} onChange={e => setForm(s => ({ ...s, confidence: parseFloat(e.target.value) }))} />
              </div>
            </div>
            <input value={form.description} onChange={e => setForm(s => ({ ...s, description: e.target.value }))} placeholder="Description…" />
            <button className="btn primary" onClick={() => onInject(form)}>Inject Event</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Metrics Panel ─────────────────────────────────────────────────────────────

function MetricsPanel({ situation, benchmark }: { situation: Situation | null; benchmark: BenchmarkResult | null }) {
  const ai = benchmark?.ai_system
  const base = benchmark?.baseline
  const imp = benchmark?.improvements

  return (
    <div className="bottom-section">
      <div className="panel-header">📊 Benchmark Metrics <span className="count-badge" style={{ marginLeft: 'auto' }} onClick={() => {}}>T+{situation?.sim_time_min ?? 0}min</span></div>
      {!benchmark ? (
        <div className="loading-spinner">Run simulation events to see metrics</div>
      ) : (
        <div className="metric-grid">
          <div className="metric-item">
            <div className="metric-label">AI Coverage</div>
            <div className={`metric-value ${(ai?.coverage_rate as number) >= 0.8 ? 'good' : 'warn'}`}>
              {((ai?.coverage_rate as number) * 100).toFixed(0)}%
            </div>
          </div>
          <div className="metric-item">
            <div className="metric-label">Base Coverage</div>
            <div className={`metric-value ${(base?.coverage_rate as number) >= 0.8 ? 'good' : 'warn'}`}>
              {((base?.coverage_rate as number) * 100).toFixed(0)}%
            </div>
          </div>
          <div className="metric-item">
            <div className="metric-label">AI Travel (min)</div>
            <div className="metric-value info">{(ai?.total_travel_time_min as number).toFixed(0)}</div>
          </div>
          <div className="metric-item">
            <div className="metric-label">Travel Save %</div>
            <div className={`metric-value ${(imp?.travel_time_reduction_pct as number) > 0 ? 'good' : 'warn'}`}>
              {(imp?.travel_time_reduction_pct as number).toFixed(1)}%
            </div>
          </div>
          <div className="metric-item">
            <div className="metric-label">Conflicts Found</div>
            <div className="metric-value warn">{imp?.conflicts_detected as number}</div>
          </div>
          <div className="metric-item">
            <div className="metric-label">Confidence</div>
            <div className={`metric-value ${(ai?.decision_confidence_avg as number) >= 0.7 ? 'good' : 'warn'}`}>
              {((ai?.decision_confidence_avg as number) * 100).toFixed(0)}%
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── AI Chat Panel ─────────────────────────────────────────────────────────────

interface AIChatMessage { role: 'user' | 'bot'; text: string }

function AIChatPanel({ pendingQuestion, onClear }: { pendingQuestion: string | null; onClear: () => void }) {
  const [messages, setMessages] = useState<AIChatMessage[]>([
    { role: 'bot', text: '👋 Ask me about the emergency situation.\n\nTry: "What is the highest priority?"\n"Why is H1 critical?"\n"What evidence conflicts exist?"' }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const sendMessage = useCallback(async (question: string) => {
    if (!question.trim()) return
    setMessages(m => [...m, { role: 'user', text: question }])
    setLoading(true)
    try {
      const data = await api.post('/ai/question', { question })
      setMessages(m => [...m, { role: 'bot', text: data.answer || 'No answer.' }])
    } catch {
      setMessages(m => [...m, { role: 'bot', text: 'Error reaching AI backend.' }])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (pendingQuestion) {
      sendMessage(pendingQuestion)
      onClear()
    }
  }, [pendingQuestion, sendMessage, onClear])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="bottom-section ai-chat">
      <div className="panel-header">🤖 IBM Bob AI Interface</div>
      <div className="ai-messages">
        {messages.map((m, i) => (
          <div key={i} className={`ai-message ${m.role === 'user' ? 'user' : 'bot'}`}>
            {m.text}
          </div>
        ))}
        {loading && <div className="ai-message bot">⏳ Thinking…</div>}
        <div ref={bottomRef} />
      </div>
      <div className="ai-input-area">
        <input
          className="ai-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { sendMessage(input); setInput('') } }}
          placeholder="Ask about the emergency… (Enter to send)"
        />
        <button className="btn primary" onClick={() => { sendMessage(input); setInput('') }} disabled={loading}>
          Send
        </button>
      </div>
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [situation, setSituation] = useState<Situation | null>(null)
  const [resources, setResources] = useState<Resource[]>([])
  const [_simEvents, setSimEvents] = useState<unknown[]>([])
  const [mapData, setMapData] = useState<{ features: MapFeature[] } | null>(null)
  const [benchmark, setBenchmark] = useState<BenchmarkResult | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [initialLoad, setInitialLoad] = useState(true)
  const [backendError, setBackendError] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [sit, res, evts, map] = await Promise.all([
        api.get('/situation'),
        api.get('/resources'),
        api.get('/timeline'),
        api.get('/map-data'),
      ])
      setSituation(sit)
      setResources(res.resources || [])
      setSimEvents(evts.events || [])
      setMapData(map)
      setError(null)
      setBackendError(false)
    } catch (e) {
      setError(`Backend unreachable: ${e}`)
      setBackendError(true)
    } finally {
      setInitialLoad(false)
    }
  }, [])

  const refreshBenchmark = useCallback(async () => {
    try {
      const b = await api.get('/benchmark')
      if (b.ai_system) setBenchmark(b)
    } catch {}
  }, [])

  useEffect(() => {
    refresh()
    refreshBenchmark()
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [refresh, refreshBenchmark])

  if (initialLoad) {
    return <LoadingScreen message="Connecting to Emergency Operations Center…" />
  }

  if (backendError && !situation) {
    return <BackendError message="Unable to connect to the backend API. The backend server must be running." onRetry={refresh} />
  }

  const handleNextEvent = async () => {
    setLoading(true)
    try {
      await api.post('/simulate/next')
      await refresh()
      await refreshBenchmark()
    } catch (e) { setError(`Event failed: ${e}`) }
    finally { setLoading(false) }
  }

  const handleAutoPlay = async () => {
    setLoading(true)
    try {
      await api.post('/simulate/auto', null)
      await refresh()
      await refreshBenchmark()
    } catch (e) { setError(`Auto play failed: ${e}`) }
    finally { setLoading(false) }
  }

  const handleReset = async () => {
    setLoading(true)
    try {
      await api.post('/simulate/reset')
      await refresh()
      setBenchmark(null)
    } catch (e) { setError(`Reset failed: ${e}`) }
    finally { setLoading(false) }
  }

  const handleInject = async (form: InjectForm) => {
    setLoading(true)
    try {
      await api.post('/simulate/event', { ...form, source_type: 'field_report', metadata: {} })
      await refresh()
      await refreshBenchmark()
    } catch (e) { setError(`Inject failed: ${e}`) }
    finally { setLoading(false) }
  }

  // Build priority map
  const priorities = situation?.top_priorities?.reduce((acc, p) => {
    acc[p.entity_id] = p
    return acc
  }, {} as Record<string, typeof situation.top_priorities[0]>) || {}

  const priorityScores = Object.fromEntries(
    Object.entries(priorities).map(([k, v]) => [k, v.priority_score])
  )

  // Build entity map from map data
  const entities = mapData?.features?.reduce((acc, f) => {
    const p = f.properties
    if (p.id && f.geometry.type === 'Point') {
      acc[p.id as string] = {
        name: p.name as string,
        type: p.type as string,
        status: p.status as string,
        population: p.population as number,
      }
    }
    return acc
  }, {} as Record<string, { name: string; type: string; status: string; population?: number }>) || {}

  const sortedPriorities = situation?.top_priorities
    ?.map((p, i) => ({ ...p, rank: i + 1 }))
    ?.sort((a, b) => b.priority_score - a.priority_score) || []

  return (
    <ErrorBoundary>
    <div className="eoc-layout">
      {/* Header */}
      <header className="eoc-header">
        <div className="status-indicator" />
        <div className="eoc-title">⚡ AI Emergency Operations Center</div>
        <div className="eoc-scenario">🏔 Bhote Valley Emergency Simulation</div>
        {error && <span style={{ color: 'var(--accent-red)', fontSize: 11, marginLeft: 8 }}>⚠ {error}</span>}
        {backendError && !situation && <span style={{ color: 'var(--accent-yellow)', fontSize: 11, marginLeft: 8 }}>⚠ Backend reconnecting…</span>}
        <div className="eoc-sim-time">
          T+{situation?.sim_time_min ?? 0}min
          {' · '}
          {situation?.processed_events ?? 0}/{situation?.total_events ?? 0} events
          {' · '}
          {(situation?.evidence_conflicts?.length ?? 0) > 0 && (
            <span style={{ color: 'var(--accent-yellow)' }}>⚠ {situation!.evidence_conflicts.length} conflicts</span>
          )}
        </div>
      </header>

      {/* Main 3-column */}
      <div className="eoc-main">
        {/* LEFT: Priority queue */}
        <PriorityPanel
          priorities={sortedPriorities}
          selectedId={selectedId}
          onSelect={setSelectedId}
          conflicts={situation?.evidence_conflicts || []}
        />

        {/* CENTER: Map */}
        <div className="map-container">
          <DisasterMap
            mapData={mapData}
            priorities={priorityScores}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          {/* Map legend */}
          <div style={{ position: 'absolute', bottom: 10, left: 10, zIndex: 1000, background: 'rgba(10,14,26,0.9)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 10 }}>
            <div style={{ color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>LEGEND</div>
            {[['#ef4444', 'High Priority / Blocked'], ['#f59e0b', 'Medium / At Risk'], ['#22c55e', 'Low / Operational'], ['#3b82f6', 'Flooded']].map(([c, l]) => (
              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />
                <span style={{ color: 'var(--text-secondary)' }}>{l}</span>
              </div>
            ))}
          </div>
          {/* Resource panel overlay */}
          <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000, width: 200, maxHeight: '40%', background: 'rgba(17,24,39,0.95)', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '5px 8px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Resources
            </div>
            <ResourcesPanel resources={resources} />
          </div>
        </div>

        {/* RIGHT: Entity detail + evidence */}
        <EntityPanel
          selectedId={selectedId}
          entities={entities}
          priorities={priorities}
          onQuestion={q => setPendingQuestion(q)}
        />
      </div>

      {/* BOTTOM: Controls | Metrics | AI Chat */}
      <div className="bottom-panel">
        <SimControls
          pendingEvents={situation?.pending_events ?? 0}
          onNext={handleNextEvent}
          onAutoPlay={handleAutoPlay}
          onReset={handleReset}
          onInject={handleInject}
          loading={loading}
        />
        <MetricsPanel situation={situation} benchmark={benchmark} />
        <AIChatPanel pendingQuestion={pendingQuestion} onClear={() => setPendingQuestion(null)} />
      </div>
    </div>
    </ErrorBoundary>
  )
}
