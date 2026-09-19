import { useState, useEffect, useCallback, useRef, Component } from 'react'
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { api } from './api'
import type {
  Situation, Resource, EvidenceSummary, BenchmarkResult,
  Decision, PlanChange, SimulationStepResult, AllocationResult,
  ResponsePlan, RawObservation,
} from './api'

// ── Error Boundary ─────────────────────────────────────────────────────────

class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: string | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error) { return { error: error.message || 'Unknown error' } }
  componentDidCatch(error: Error, info: React.ErrorInfo) { console.error('ErrorBoundary:', error, info) }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 24, color: '#ef4444', fontFamily: 'monospace' }}>
        <h2>⚠ Application Error</h2><p>{this.state.error}</p>
        <button className="btn" onClick={() => window.location.reload()}>Reload</button>
      </div>
    )
    return this.props.children
  }
}

function LoadingScreen({ message }: { message?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0a0e1a', color: '#94a3b8', fontFamily: 'sans-serif', fontSize: 16, flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 32 }}>⏳</div>
      <div>{message || 'Loading Emergency Operations Center…'}</div>
    </div>
  )
}

function BackendError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0a0e1a', color: '#ef4444', fontFamily: 'sans-serif', padding: 32, flexDirection: 'column', gap: 16, textAlign: 'center' }}>
      <div style={{ fontSize: 48 }}>⚠️</div>
      <h2>Backend Unavailable</h2>
      <p style={{ color: '#94a3b8', maxWidth: 500 }}>{message}</p>
      <button className="btn primary" onClick={onRetry}>Retry Connection</button>
      <p style={{ fontSize: 12, color: '#64748b' }}>Ensure the backend server is running on port 8000.</p>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

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
  if (score >= 0.7) return 'CRITICAL'
  if (score >= 0.45) return 'NEEDS ATTENTION'
  return 'OPERATIONAL'
}

function priorityBadgeClass(score: number): string {
  if (score >= 0.7) return 'high'
  if (score >= 0.45) return 'medium'
  return 'low'
}

function urgencyLabel(score: number): string {
  if (score >= 0.8) return 'EXTREME'
  if (score >= 0.6) return 'HIGH'
  if (score >= 0.4) return 'MODERATE'
  return 'LOW'
}

function accessLabel(score: number): string {
  if (score <= 0.1) return 'ISOLATED'
  if (score <= 0.4) return 'RESTRICTED'
  if (score <= 0.7) return 'DIFFICULT'
  return 'ACCESSIBLE'
}

function confidenceLabel(score: number): string {
  if (score >= 0.75) return 'HIGH'
  if (score >= 0.5) return 'MEDIUM'
  if (score >= 0.25) return 'LOW'
  return 'VERY LOW'
}

function freshnessLabel(score: number): string {
  if (score >= 0.8) return 'Recent'
  if (score >= 0.5) return 'Aging'
  return 'Stale'
}

function formatTime(isoStr: string): string {
  try { return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
  catch { return isoStr }
}

function humanizeEventType(et: string): string {
  return et.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function humanizeObsType(ot: string): string {
  const map: Record<string, string> = {
    accessibility: 'Accessibility', damage: 'Damage assessment',
    flood_level: 'Flood level', capacity: 'Facility capacity',
    bridge_status: 'Bridge status', road_status: 'Road status',
    resource_status: 'Resource status', structural: 'Structural integrity',
    demand: 'Demand / Surge', weather: 'Weather',
  }
  return map[ot] || ot.replace(/_/g, ' ')
}

function humanizeSourceType(st: string): string {
  const map: Record<string, string> = {
    satellite: '🛰 Satellite', drone: '🚁 Drone', field_report: '📋 Field Report',
    emergency_call: '📞 Emergency Call', hospital: '🏥 Hospital Report',
    school: '🏫 School Report', sensor: '📡 Sensor', authority_report: '🏛 Authority',
    simulation: '⚡ Simulation',
  }
  return map[st] || st
}

// ── Map Component ────────────────────────────────────────────────────────────

interface MapFeature {
  type: string
  geometry: { type: string; coordinates: number[] | number[][] }
  properties: Record<string, unknown>
}

interface MapProps {
  mapData: { features: MapFeature[] } | null
  priorities: Record<string, number>
  selectedId: string | null
  onSelect: (id: string) => void
  highlightedRoute?: string[] | null   // entity IDs on active route
}

function DisasterMap({ mapData, priorities, selectedId, onSelect, highlightedRoute }: MapProps) {
  if (!mapData) return <div className="loading-spinner">Loading map…</div>

  const features = mapData.features || []
  const points = features.filter(f => f.geometry.type === 'Point')
  const lines = features.filter(f => f.geometry.type === 'LineString')

  return (
    <MapContainer center={[28.11, 85.705]} zoom={12} style={{ height: '100%', width: '100%' }}>
      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution='&copy; <a href="https://carto.com/">CARTO</a>' />

      {lines.map((f, i) => {
        const props = f.properties
        const status = props.status as string || 'open'
        const coords = f.geometry.coordinates as number[][]
        const color = STATUS_COLOR[status] || '#3b82f6'
        const isActive = highlightedRoute && (highlightedRoute.includes(props.id as string) || highlightedRoute.includes(props.from_node as string))
        return (
          <Polyline
            key={i}
            positions={coords.map(c => [c[1], c[0]] as [number, number])}
            color={isActive ? '#f59e0b' : color}
            weight={isActive ? 4 : status === 'blocked' ? 3 : 2}
            opacity={isActive ? 1 : status === 'blocked' ? 0.9 : 0.6}
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
        const isHighlighted = highlightedRoute?.includes(id)

        let color = STATUS_COLOR[status] || '#3b82f6'
        if (!isResource && !isBridge && priority > 0) color = priorityColor(priority)
        if (isBridge) color = STATUS_COLOR[(props.status as string) || 'open']
        if (isHighlighted) color = '#f59e0b'

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
              {priority > 0 && <><br />Priority: {priorityLabel(priority)}</>}
              {props.conflict_status === 'conflicting' && <><br /><span style={{ color: '#f59e0b' }}>⚠ CONFLICTING EVIDENCE</span></>}
            </Popup>
          </CircleMarker>
        )
      })}
    </MapContainer>
  )
}

// ── Human-Friendly Priority Panel ────────────────────────────────────────────

function PriorityPanel({
  priorities, selectedId, onSelect, conflicts
}: {
  priorities: { entity_id: string; entity_name: string; entity_type: string; priority_score: number; urgency_score: number; accessibility_factor: number; confidence_factor: number; impact_score: number; explanation: string; supporting_factors: string[]; rank: number }[]
  selectedId: string | null
  onSelect: (id: string) => void
  conflicts: string[]
}) {
  const entityConflicts = new Set(conflicts.map(c => c.split(':')[0].trim()))

  return (
    <div className="panel">
      <div className="panel-header">
        🎯 Current Priorities
        <span className="count-badge">{priorities.length}</span>
      </div>
      {conflicts.length > 0 && (
        <div className="conflict-alert">
          <strong>⚠ {conflicts.length} Evidence Conflict{conflicts.length > 1 ? 's' : ''} Detected</strong>
          {conflicts.slice(0, 2).map((c, i) => <div key={i} style={{ marginTop: 2 }}>{c.slice(0, 70)}</div>)}
        </div>
      )}
      <div className="panel-scroll">
        {priorities.length === 0 && (
          <div className="empty-state">No priority data yet.<br />Advance the simulation to generate priorities.</div>
        )}
        {priorities.slice(0, 12).map(p => {
          const hasConflict = entityConflicts.has(p.entity_id) || entityConflicts.has(p.entity_name)
          const population = Math.round(p.impact_score * 10000)
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
                {hasConflict && <span className="conflict-flag" title="Evidence conflict">⚠</span>}
                <span className={`priority-badge ${priorityBadgeClass(p.priority_score)}`}>
                  {priorityLabel(p.priority_score)}
                </span>
              </div>

              {/* Human-readable summary — the key change from raw scores */}
              <div className="priority-human-summary">
                {population > 0 && (
                  <span className="priority-fact">👥 {population.toLocaleString()} affected</span>
                )}
                <span className={`priority-fact urgency-${p.urgency_score >= 0.6 ? 'high' : 'low'}`}>
                  Urgency: {urgencyLabel(p.urgency_score)}
                </span>
                <span className={`priority-fact access-${p.accessibility_factor <= 0.4 ? 'isolated' : 'ok'}`}>
                  Access: {accessLabel(p.accessibility_factor)}
                </span>
                <span className={`priority-fact conf-${p.confidence_factor >= 0.5 ? 'ok' : 'low'}`}>
                  Evidence: {confidenceLabel(p.confidence_factor)} confidence
                </span>
                {hasConflict && <span className="priority-fact conflict">⚠ Conflicting reports</span>}
              </div>

              <div className="priority-bar">
                <div className="priority-bar-fill" style={{ width: `${p.priority_score * 100}%`, background: priorityColor(p.priority_score) }} />
              </div>

              {/* Technical scores available as secondary detail */}
              <div className="priority-meta" title={`P=${p.priority_score.toFixed(3)} U=${p.urgency_score.toFixed(2)} A=${p.accessibility_factor.toFixed(2)} C=${p.confidence_factor.toFixed(2)}`}>
                Score: {p.priority_score.toFixed(3)} · {p.explanation.slice(0, 50)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Recommendation / Action Panel ─────────────────────────────────────────────

function RecommendationPanel({
  selectedId,
  entities,
  priorities,
  decisions,
  plan,
  resources,
  onDecisionUpdate,
  onQuestion,
}: {
  selectedId: string | null
  entities: Record<string, { name: string; type: string; status: string; population?: number }>
  priorities: Record<string, { priority_score: number; urgency_score: number; accessibility_factor: number; confidence_factor: number; explanation: string; supporting_factors: string[] }>
  decisions: Decision[]
  plan: ResponsePlan | null
  resources: Resource[]
  onDecisionUpdate: () => void
  onQuestion: (q: string) => void
}) {
  const [evidence, setEvidence] = useState<EvidenceSummary[]>([])
  const [rawObs, setRawObs] = useState<RawObservation[]>([])
  const [evidenceLoading, setEvidenceLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [lastConfirmedAt, setLastConfirmedAt] = useState<string | null>(null)
  const [evidenceError, setEvidenceError] = useState<string | null>(null)

  // Load evidence when selection changes
  useEffect(() => {
    if (!selectedId) { setEvidence([]); setRawObs([]); return }
    setEvidenceLoading(true)
    setEvidenceError(null)
    api.get(`/evidence/${selectedId}`)
      .then(d => { setEvidence(d.evidence_summaries || []); setRawObs(d.raw_observations || []) })
      .catch(e => setEvidenceError(`Unable to load evidence: ${e}`))
      .finally(() => setEvidenceLoading(false))
  }, [selectedId])

  if (!selectedId) {
    return (
      <div className="panel panel-right">
        <div className="panel-header">📋 Entity Detail</div>
        <div className="empty-state" style={{ marginTop: 60 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>👆</div>
          Select a location from the map<br />or priority queue to review it.
        </div>
      </div>
    )
  }

  const entity = entities[selectedId]
  const priority = priorities[selectedId]
  const status = entity?.status || 'unknown'

  // Find the current decision for this entity
  const currentDecision = decisions.find(d => d.target_entity_id === selectedId && d.is_current)

  // Find plan allocation for this entity
  const allocation: AllocationResult | undefined = plan?.allocations.find(a => {
    // We need to match by task target - but we only have resource_id on allocation
    // Check if this allocation's resource matches what the decision recommends
    return currentDecision && a.resource_id === currentDecision.resource_id
  })

  // Find recommended resource
  const recommendedResource = currentDecision?.resource_id
    ? resources.find(r => r.id === currentDecision.resource_id)
    : null

  const handleConfirm = async (status: 'accepted' | 'rejected') => {
    if (!currentDecision) return
    setConfirming(true)
    setConfirmError(null)
    try {
      await api.post(`/decisions/${currentDecision.id}/confirm`, {
        status,
        operator_notes: notes.trim() || null,
      })
      setLastConfirmedAt(new Date().toLocaleTimeString())
      setNotes('')
      onDecisionUpdate()
    } catch (e) {
      setConfirmError(`Failed to submit decision: ${e}`)
    } finally {
      setConfirming(false)
    }
  }

  const decisionStatus = currentDecision?.operator_status

  return (
    <div className="panel panel-right">
      <div className="panel-header">
        {ENTITY_ICONS[entity?.type || ''] || '📍'} {entity?.name || selectedId}
      </div>
      <div className="panel-scroll">

        {/* ── Entity Summary ── */}
        <div className="evidence-section">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <span className={`status-tag ${status}`}>{status}</span>
            {entity?.type && <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{entity.type.replace(/_/g, ' ').toUpperCase()}</span>}
          </div>
          {(entity?.population ?? 0) > 0 && (
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
              👥 {entity!.population!.toLocaleString()} people affected
            </div>
          )}
          {priority && (
            <div style={{ marginTop: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span className={`priority-badge ${priorityBadgeClass(priority.priority_score)}`}>
                  {priorityLabel(priority.priority_score)}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>score {priority.priority_score.toFixed(3)}</span>
              </div>
              <div style={{ height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
                <div style={{ height: '100%', width: `${priority.priority_score * 100}%`, background: priorityColor(priority.priority_score), borderRadius: 3 }} />
              </div>
            </div>
          )}
        </div>

        {/* ── WHY IS THIS HIGH PRIORITY? ── */}
        {priority && (
          <div className="evidence-section">
            <div className="evidence-section-title">WHY IS THIS HIGH PRIORITY?</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6, lineHeight: 1.5 }}>
              {priority.explanation}
            </div>
            {priority.supporting_factors.length > 0 && (
              <div>
                {priority.supporting_factors.map((f, i) => (
                  <div key={i} className="why-factor">
                    <span style={{ color: 'var(--accent-blue)' }}>+</span> {f}
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              <span className="detail-chip">Urgency: {urgencyLabel(priority.urgency_score)}</span>
              <span className={`detail-chip ${priority.accessibility_factor <= 0.4 ? 'chip-danger' : ''}`}>
                Access: {accessLabel(priority.accessibility_factor)}
              </span>
              <span className={`detail-chip ${priority.confidence_factor < 0.5 ? 'chip-warn' : ''}`}>
                Evidence: {confidenceLabel(priority.confidence_factor)} confidence
              </span>
            </div>
          </div>
        )}

        {/* ── RECOMMENDATION / ACTION REVIEW ── */}
        {currentDecision ? (
          <div className="recommendation-panel">
            <div className="rec-header">
              <span className="rec-title-icon">⚡</span>
              <span className="rec-title">RECOMMENDED RESPONSE</span>
              {decisionStatus ? (
                <span className={`decision-status-badge ${decisionStatus}`}>
                  {decisionStatus === 'accepted' ? '✓ ACCEPTED' : decisionStatus === 'rejected' ? '✗ REJECTED' : '✎ MODIFIED'}
                </span>
              ) : (
                <span className="decision-status-badge pending">AWAITING REVIEW</span>
              )}
            </div>

            <div className="rec-human-required">
              🔍 Human verification required
            </div>

            <div className="rec-action">{currentDecision.recommended_action}</div>

            <div className="rec-details">
              {recommendedResource && (
                <div className="rec-detail-row">
                  <span className="rec-detail-label">Resource</span>
                  <span className="rec-detail-value">{recommendedResource.name}</span>
                </div>
              )}
              {recommendedResource && (
                <div className="rec-detail-row">
                  <span className="rec-detail-label">Capability</span>
                  <span className="rec-detail-value">{recommendedResource.capabilities.join(', ') || recommendedResource.type}</span>
                </div>
              )}
              {allocation?.route?.path_nodes && allocation.route.path_nodes.length > 0 && (
                <div className="rec-detail-row">
                  <span className="rec-detail-label">Route</span>
                  <span className="rec-detail-value">{allocation.route.path_nodes.join(' → ')}</span>
                </div>
              )}
              {(currentDecision.estimated_arrival_min != null || allocation?.estimated_arrival_min != null) && (
                <div className="rec-detail-row">
                  <span className="rec-detail-label">ETA</span>
                  <span className="rec-detail-value rec-eta">
                    {Math.round(currentDecision.estimated_arrival_min ?? allocation?.estimated_arrival_min ?? 0)} min
                  </span>
                </div>
              )}
              <div className="rec-detail-row">
                <span className="rec-detail-label">Confidence</span>
                <span className={`rec-detail-value ${currentDecision.confidence >= 0.7 ? 'conf-high' : currentDecision.confidence >= 0.4 ? 'conf-med' : 'conf-low'}`}>
                  {Math.round(currentDecision.confidence * 100)}%
                </span>
              </div>
              <div className="rec-detail-row">
                <span className="rec-detail-label">Route Status</span>
                <span className={`rec-detail-value ${currentDecision.route_feasible !== false ? 'conf-high' : 'conf-low'}`}>
                  {currentDecision.route_feasible === false ? '⚠ Route may be blocked' : allocation?.route?.feasible === false ? '⚠ Route may be blocked' : '✓ Route feasible'}
                </span>
              </div>
            </div>

            {currentDecision.reasons.length > 0 && (
              <div className="rec-reasons">
                <div className="rec-reasons-title">Supporting reasons</div>
                {currentDecision.reasons.map((r, i) => (
                  <div key={i} className="rec-reason-item">• {r}</div>
                ))}
              </div>
            )}

            {/* Decision buttons */}
            {!decisionStatus && (
              <div className="rec-actions">
                <input
                  className="notes-input"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Operator notes (optional)…"
                />
                <div className="rec-buttons">
                  <button
                    className="btn success rec-btn"
                    onClick={() => handleConfirm('accepted')}
                    disabled={confirming}
                  >
                    ✓ Accept
                  </button>
                  <button
                    className="btn danger rec-btn"
                    onClick={() => handleConfirm('rejected')}
                    disabled={confirming}
                  >
                    ✗ Reject
                  </button>
                  <button
                    className="btn rec-btn"
                    onClick={() => onQuestion(`Why is ${entity?.name} the highest priority? What evidence supports this recommendation?`)}
                  >
                    💬 Ask Bob
                  </button>
                </div>
                {confirmError && <div className="error-msg">{confirmError}</div>}
              </div>
            )}

            {/* Confirmed status */}
            {decisionStatus && (
              <div className={`decision-confirmed ${decisionStatus}`}>
                <div className="confirmed-header">
                  {decisionStatus === 'accepted' ? '✓ ACCEPTED BY OPERATOR' : decisionStatus === 'rejected' ? '✗ REJECTED BY OPERATOR' : '✎ MODIFIED BY OPERATOR'}
                </div>
                <div className="confirmed-id">Decision ID: {currentDecision.id}</div>
                {currentDecision.operator_notes && (
                  <div className="confirmed-notes">Notes: {currentDecision.operator_notes}</div>
                )}
                {lastConfirmedAt && <div className="confirmed-time">Confirmed at {lastConfirmedAt}</div>}
                <button
                  className="btn"
                  style={{ marginTop: 6, fontSize: 10 }}
                  onClick={() => onQuestion(`What happened after the decision for ${entity?.name}? What is the current plan?`)}
                >
                  💬 Ask Bob about this decision
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="evidence-section">
            <div className="empty-state" style={{ padding: '12px 0' }}>
              No response recommendation currently requires review for this entity.
            </div>
          </div>
        )}

        {/* ── WHAT WE KNOW (Evidence Summaries) ── */}
        <div className="evidence-section">
          <div className="evidence-section-title">WHAT WE KNOW</div>
          {evidenceLoading ? (
            <div className="loading-spinner" style={{ padding: '8px 0' }}>Loading evidence…</div>
          ) : evidenceError ? (
            <div className="error-msg">{evidenceError}</div>
          ) : evidence.length > 0 ? (
            evidence.map((e, i) => (
              <div key={i} className={`evidence-item ${e.conflict_status === 'conflicting' ? 'conflicting' : ''}`}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>{humanizeObsType(e.observation_type)}</div>
                  <div className="evidence-value">
                    {e.best_value.toUpperCase()}
                    {e.conflict_status === 'conflicting' && <span style={{ color: 'var(--accent-yellow)', marginLeft: 6, fontSize: 10 }}>⚠ CONFLICTING REPORTS</span>}
                  </div>
                  {e.recommendation && <div style={{ fontSize: 10, color: 'var(--accent-yellow)', marginTop: 2 }}>{e.recommendation.slice(0, 100)}</div>}
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{e.source_count} source{e.source_count !== 1 ? 's' : ''}</div>
                </div>
                <div style={{ textAlign: 'right', minWidth: 70 }}>
                  <div className="confidence-bar">
                    <div className={`confidence-fill ${e.confidence >= 0.75 ? 'high' : e.confidence >= 0.5 ? 'medium' : 'low'}`} style={{ width: `${e.confidence * 100}%` }} />
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{confidenceLabel(e.confidence)} ({Math.round(e.confidence * 100)}%)</div>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state" style={{ padding: '8px 0', fontSize: 11 }}>
              No verified evidence available for this entity.
            </div>
          )}
        </div>

        {/* ── SOURCE REPORTS (Raw Observations) ── */}
        {rawObs.length > 0 && (
          <div className="evidence-section">
            <div className="evidence-section-title">SOURCE REPORTS ({rawObs.length})</div>
            {rawObs.map((o, i) => (
              <div key={i} className="source-report-item">
                <div className="source-report-header">
                  <span className="source-type-label">{humanizeSourceType(o.source_type)}</span>
                  <span className="source-time">{formatTime(o.timestamp)}</span>
                  <span className={`source-freshness ${o.freshness >= 0.6 ? 'fresh' : 'stale'}`}>{freshnessLabel(o.freshness)}</span>
                </div>
                <div className="source-report-value">
                  <span className="source-value">{o.value.toUpperCase()}</span>
                  <span className="source-confidence">Conf: {Math.round(o.confidence * 100)}%</span>
                </div>
                {o.raw_text && (
                  <div className="source-raw-text">"{o.raw_text.slice(0, 90)}"</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Quick Ask Bob Prompts ── */}
        <div className="evidence-section">
          <div className="evidence-section-title">ASK BOB</div>
          {[
            `Why is ${entity?.name || 'this'} high priority?`,
            `Which resources can reach ${entity?.name || 'here'}?`,
            `What evidence supports the recommendation for ${entity?.name || 'this'}?`,
          ].map(q => (
            <button key={q} className="btn" style={{ width: '100%', marginBottom: 4, textAlign: 'left', padding: '5px 8px', fontSize: 11 }} onClick={() => onQuestion(q)}>
              💬 {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Resources Panel (with task visibility) ────────────────────────────────────

function ResourcesPanel({
  resources,
  decisions,
  entities,
}: {
  resources: Resource[]
  decisions: Decision[]
  entities: Record<string, { name: string }>
}) {
  const resourceIcon: Record<string, string> = {
    rescue_team: '🚒', ambulance: '🚑', engineering_team: '🔧',
    supply_vehicle: '🚛', medical_unit: '🏥',
  }

  // Build a map: resource_id → current decision
  const resourceDecisions = decisions.reduce((acc, d) => {
    if (d.resource_id && d.is_current && !acc[d.resource_id]) {
      acc[d.resource_id] = d
    }
    return acc
  }, {} as Record<string, Decision>)

  const grouped = resources.reduce((acc, r) => {
    acc[r.status] = [...(acc[r.status] || []), r]
    return acc
  }, {} as Record<string, Resource[]>)

  const statusOrder = ['available', 'deployed', 'en_route', 'unavailable']
  const statusLabel: Record<string, string> = {
    available: 'Available', deployed: 'Deployed', en_route: 'En Route', unavailable: 'Unavailable',
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {statusOrder.map(status => {
        const items = grouped[status] || []
        if (!items.length) return null
        return (
          <div key={status}>
            <div style={{ padding: '4px 12px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
              {statusLabel[status]} ({items.length})
            </div>
            {items.map(r => {
              const dec = resourceDecisions[r.id]
              const targetName = dec?.target_entity_id ? entities[dec.target_entity_id]?.name || dec.target_entity_id : null

              return (
                <div key={r.id} className="resource-item">
                  <span className="resource-icon">{resourceIcon[r.type] || '👤'}</span>
                  <div className="resource-info" style={{ flex: 1 }}>
                    <div className="resource-name">{r.name}</div>
                    <div className="resource-detail">{r.capabilities.join(', ') || r.type}</div>
                    {targetName && (
                      <div style={{ fontSize: 10, color: 'var(--accent-yellow)', marginTop: 2 }}>
                        → Recommended for {targetName}
                        {dec?.estimated_arrival_min != null && ` (${Math.round(dec.estimated_arrival_min)}min ETA)`}
                      </div>
                    )}
                    {dec?.operator_status === 'accepted' && (
                      <div style={{ fontSize: 9, color: 'var(--accent-green)', marginTop: 1 }}>✓ Operator accepted</div>
                    )}
                  </div>
                  <span className={`status-tag ${r.status}`}>{statusLabel[r.status] || r.status}</span>
                </div>
              )
            })}
          </div>
        )
      })}
      {resources.length === 0 && (
        <div className="empty-state">No resources loaded yet.</div>
      )}
    </div>
  )
}

// ── Situation Change / Plan Change Alert ─────────────────────────────────────

function PlanChangeAlert({
  planChanges,
  entities,
  resources,
  lastEvent,
  onReview,
  onDismiss,
}: {
  planChanges: PlanChange[]
  entities: Record<string, { name: string }>
  resources: Resource[]
  lastEvent: SimulationStepResult['event'] | null
  onReview: (change: PlanChange) => void
  onDismiss: () => void
}) {
  const reviewRequired = planChanges.filter(c => c.review_required)
  if (planChanges.length === 0) return null

  const infraId = planChanges.find(c => c.affected_infrastructure_id)?.affected_infrastructure_id
  const infraName = infraId ? (entities[infraId]?.name || infraId) : null
  const triggerType = planChanges[0]?.triggering_event_type

  return (
    <div className="plan-change-banner">
      <div className="plan-change-banner-header">
        <span className="plan-change-icon">⚠</span>
        <span className="plan-change-title">SITUATION UPDATED</span>
        <button className="plan-change-dismiss" onClick={onDismiss}>✕</button>
      </div>
      {infraName && (
        <div className="plan-change-infra">
          {infraName}
          {triggerType && <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>— {humanizeEventType(triggerType)}</span>}
        </div>
      )}
      {lastEvent && (
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '4px 0' }}>
          {lastEvent.description}
        </div>
      )}
      <div className="plan-change-count">
        {planChanges.length} response plan{planChanges.length !== 1 ? 's' : ''} affected
        {reviewRequired.length > 0 && <span style={{ color: 'var(--accent-red)', marginLeft: 8 }}>{reviewRequired.length} require review</span>}
      </div>
      <div className="plan-change-items">
        {planChanges.slice(0, 4).map((c, i) => {
          const entityName = entities[c.entity_id]?.name || c.entity_id
          const prevRes = c.previous_resource_id ? resources.find(r => r.id === c.previous_resource_id)?.name || c.previous_resource_id : null
          const newRes = c.new_resource_id ? resources.find(r => r.id === c.new_resource_id)?.name || c.new_resource_id : null
          return (
            <div key={i} className={`plan-change-item ${c.review_required ? 'review-required' : ''}`}>
              <div className="plan-change-entity">{entityName}</div>
              {prevRes !== newRes && (
                <div className="plan-change-resource-change">
                  {prevRes ? prevRes : 'No resource'} → {newRes ? newRes : 'Unassigned'}
                </div>
              )}
              {c.previous_eta_min != null && c.new_eta_min != null && (
                <div className="plan-change-eta">
                  ETA: {Math.round(c.previous_eta_min)}min → {Math.round(c.new_eta_min)}min
                </div>
              )}
              {c.review_required && (
                <button className="btn primary" style={{ padding: '3px 8px', fontSize: 10, marginTop: 4 }} onClick={() => onReview(c)}>
                  Review Change
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Before/After Plan Comparison Modal ───────────────────────────────────────

function PlanComparisonModal({
  change,
  entities,
  resources,
  decisions,
  onClose,
  onAcceptNew,
}: {
  change: PlanChange
  entities: Record<string, { name: string }>
  resources: Resource[]
  decisions: Decision[]
  onClose: () => void
  onAcceptNew: (decisionId: string) => void
}) {
  const entityName = entities[change.entity_id]?.name || change.entity_id
  const prevRes = change.previous_resource_id ? resources.find(r => r.id === change.previous_resource_id)?.name || change.previous_resource_id : 'None'
  const newRes = change.new_resource_id ? resources.find(r => r.id === change.new_resource_id)?.name || change.new_resource_id : 'None assigned'

  const currentDecision = decisions.find(d => d.target_entity_id === change.entity_id && d.is_current)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>⚠ PLAN CHANGE — {entityName}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="plan-comparison">
            <div className="plan-before">
              <div className="plan-col-label">PREVIOUS PLAN</div>
              <div className="plan-col-resource">{prevRes}</div>
              {change.previous_eta_min != null && (
                <div className="plan-col-eta">ETA: {Math.round(change.previous_eta_min)} min</div>
              )}
              <div className={`plan-col-feasible ${change.previous_route_feasible ? 'ok' : 'bad'}`}>
                Route: {change.previous_route_feasible ? 'Feasible' : 'Not feasible'}
              </div>
            </div>

            <div className="plan-arrow">
              ↓ {change.triggering_event_type ? humanizeEventType(change.triggering_event_type) : 'SITUATION CHANGE'} ↓
            </div>

            <div className="plan-after">
              <div className="plan-col-label">UPDATED PLAN</div>
              <div className="plan-col-resource" style={{ color: change.new_resource_id !== change.previous_resource_id ? 'var(--accent-yellow)' : undefined }}>{newRes}</div>
              {change.new_eta_min != null && (
                <div className="plan-col-eta" style={{ color: change.new_eta_min > (change.previous_eta_min ?? 0) ? 'var(--accent-yellow)' : 'var(--accent-green)' }}>
                  ETA: {Math.round(change.new_eta_min)} min
                  {change.previous_eta_min != null && change.new_eta_min > change.previous_eta_min && ` (+${Math.round(change.new_eta_min - change.previous_eta_min)}min)`}
                </div>
              )}
              <div className={`plan-col-feasible ${change.new_route_feasible ? 'ok' : 'bad'}`}>
                Route: {change.new_route_feasible ? 'Feasible' : 'Not feasible'}
              </div>
            </div>
          </div>

          <div className="plan-change-reason">
            <strong>Why changed:</strong> {change.change_reason}
          </div>

          {currentDecision && !currentDecision.operator_status && (
            <div className="modal-actions">
              <button
                className="btn success"
                onClick={() => onAcceptNew(currentDecision.id)}
              >
                ✓ Accept New Plan
              </button>
              <button className="btn danger" onClick={() => {
                if (currentDecision) onAcceptNew(currentDecision.id)  // treat as review
              }}>
                ✗ Reject / Escalate
              </button>
              <button className="btn" onClick={onClose}>Close</button>
            </div>
          )}
          {(!currentDecision || currentDecision.operator_status) && (
            <div className="modal-actions">
              <button className="btn primary" onClick={onClose}>Close</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Simulation Controls ───────────────────────────────────────────────────────

interface InjectForm {
  event_type: string; entity_id: string; observation_type: string
  value: string; confidence: number; description: string
}

function SimControls({
  situation, pendingEvents, onNext, onAutoPlay, onReset, onInject, loading, lastEvent,
}: {
  situation: Situation | null
  pendingEvents: number
  onNext: () => void
  onAutoPlay: () => void
  onReset: () => void
  onInject: (form: InjectForm) => void
  loading: boolean
  lastEvent: SimulationStepResult['event'] | null
}) {
  const [showInject, setShowInject] = useState(false)
  const [form, setForm] = useState<InjectForm>({
    event_type: 'road_blockage', entity_id: 'R7', observation_type: 'road_status',
    value: 'blocked', confidence: 0.85, description: 'Operator injected event',
  })

  const PRESET_EVENTS = [
    { label: '🚧 Block Road R7', event_type: 'road_blockage', entity_id: 'R7', observation_type: 'road_status', value: 'blocked', confidence: 0.9, description: 'Road R7 blocked by landslide' },
    { label: '🌉 Block Bridge B2', event_type: 'bridge_damage_report', entity_id: 'B2', observation_type: 'bridge_status', value: 'blocked', confidence: 0.88, description: 'Bridge B2 structural damage' },
    { label: '🏥 Overload HP1', event_type: 'hospital_demand_surge', entity_id: 'HP1', observation_type: 'capacity', value: 'overloaded', confidence: 0.95, description: 'Health post HP1 overloaded with casualties' },
    { label: '🏘 Isolate V3', event_type: 'village_isolation_confirmed', entity_id: 'V3', observation_type: 'accessibility', value: 'isolated', confidence: 0.9, description: 'Gorkhe Gaun isolated by road damage' },
    { label: '🚒 RT2 unavailable', event_type: 'resource_unavailable', entity_id: 'RT2', observation_type: 'resource_status', value: 'unavailable', confidence: 1.0, description: 'Rescue Team Bravo unavailable' },
    { label: '⚠ B2 conflicting', event_type: 'conflicting_bridge_report', entity_id: 'B2', observation_type: 'bridge_status', value: 'open', confidence: 0.55, description: 'Conflicting report: B2 may be passable' },
  ]

  return (
    <div className="bottom-section">
      <div className="panel-header">
        ⚡ Bhote Valley Emergency Simulation
        {situation && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            T+{situation.sim_time_min}min · {situation.processed_events}/{situation.total_events} events
          </span>
        )}
      </div>
      <div className="sim-controls">
        <button className="btn primary" onClick={onNext} disabled={loading || pendingEvents === 0}>
          ⏭ Next Event ({pendingEvents} remaining)
        </button>
        <button className="btn success" onClick={onAutoPlay} disabled={loading || pendingEvents === 0}>
          ▶ Auto Play
        </button>
        <button className="btn danger" onClick={onReset} disabled={loading}>
          ↺ Reset
        </button>
        <button className="btn" onClick={() => setShowInject(s => !s)}>
          💉 {showInject ? 'Hide' : 'Inject Event'}
        </button>
      </div>

      {/* Last event result */}
      {lastEvent && (
        <div className="event-result-banner">
          <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--text-primary)' }}>
            ✓ EVENT PROCESSED: {humanizeEventType(lastEvent.event_type)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
            {lastEvent.description}
          </div>
        </div>
      )}

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
                  {['road_blockage', 'bridge_damage_report', 'bridge_confirmed_blocked', 'conflicting_bridge_report', 'hospital_demand_surge', 'school_evacuation', 'resource_unavailable', 'satellite_observation', 'village_isolation_confirmed', 'alternate_route_opened'].map(v => <option key={v} value={v}>{v}</option>)}
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
                  {['bridge_status', 'road_status', 'capacity', 'accessibility', 'flood_level', 'resource_status', 'damage'].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label>Value</label>
                <select value={form.value} onChange={e => setForm(s => ({ ...s, value: e.target.value }))}>
                  {['blocked', 'open', 'partially_blocked', 'overloaded', 'unavailable', 'isolated', 'flooded', 'evacuation_required', 'damaged'].map(v => <option key={v} value={v}>{v}</option>)}
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

// ── Benchmark Panel ───────────────────────────────────────────────────────────

function BenchmarkPanel({ benchmark }: { situation?: Situation | null; benchmark: BenchmarkResult | null }) {
  const [collapsed, setCollapsed] = useState(false)
  const ai = benchmark?.ai_system
  const base = benchmark?.baseline
  const imp = benchmark?.improvements

  return (
    <div className="bottom-section">
      <div className="panel-header" style={{ cursor: 'pointer' }} onClick={() => setCollapsed(s => !s)}>
        📊 System Performance
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }}>
          {collapsed ? '▼ expand' : '▲ collapse'}
        </span>
      </div>
      {collapsed ? (
        <div className="loading-spinner">Click to expand benchmark metrics</div>
      ) : !benchmark ? (
        <div className="loading-spinner">Run simulation events to see performance metrics</div>
      ) : (
        <div className="metric-grid">
          <div className="metric-item">
            <div className="metric-label">AI Coverage</div>
            <div className={`metric-value ${(ai?.coverage_rate as number) >= 0.8 ? 'good' : 'warn'}`}>{((ai?.coverage_rate as number) * 100).toFixed(0)}%</div>
          </div>
          <div className="metric-item">
            <div className="metric-label">Baseline Coverage</div>
            <div className={`metric-value ${(base?.coverage_rate as number) >= 0.8 ? 'good' : 'warn'}`}>{((base?.coverage_rate as number) * 100).toFixed(0)}%</div>
          </div>
          <div className="metric-item">
            <div className="metric-label">AI Travel (min)</div>
            <div className="metric-value info">{(ai?.total_travel_time_min as number).toFixed(0)}</div>
          </div>
          <div className="metric-item">
            <div className="metric-label">Time Saved</div>
            <div className={`metric-value ${(imp?.travel_time_reduction_pct as number) > 0 ? 'good' : 'warn'}`}>{(imp?.travel_time_reduction_pct as number).toFixed(1)}%</div>
          </div>
          <div className="metric-item">
            <div className="metric-label">Conflicts Found</div>
            <div className="metric-value warn">{imp?.conflicts_detected as number}</div>
          </div>
          <div className="metric-item">
            <div className="metric-label">Avg Confidence</div>
            <div className={`metric-value ${(ai?.decision_confidence_avg as number) >= 0.7 ? 'good' : 'warn'}`}>{((ai?.decision_confidence_avg as number) * 100).toFixed(0)}%</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Bob AI Interface ───────────────────────────────────────────────────────────

interface AIChatMessage { role: 'user' | 'bot'; text: string }

const BOB_PROMPTS = [
  '❓ Why is Gorkhe Gaun high priority?',
  '🚒 Which resources can reach Gorkhe Gaun?',
  '🔄 What changed after the bridge blockage?',
  '⚡ Which decisions need review?',
  '⚠ Show conflicting evidence.',
]

function AIChatPanel({ pendingQuestion, onClear }: { pendingQuestion: string | null; onClear: () => void }) {
  const [messages, setMessages] = useState<AIChatMessage[]>([
    { role: 'bot', text: '🤖 I\'m your operational intelligence assistant.\n\nI can answer questions about this emergency using the actual current situation data.\n\nTry one of the prompts below, or type your own question.' }
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
    if (pendingQuestion) { sendMessage(pendingQuestion); onClear() }
  }, [pendingQuestion, sendMessage, onClear])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="bottom-section ai-chat">
      <div className="panel-header">🤖 Bob — Operational Intelligence Assistant</div>
      <div className="ai-prompt-chips">
        {BOB_PROMPTS.map(p => (
          <button key={p} className="ai-prompt-chip" onClick={() => sendMessage(p.replace(/^[^\s]+\s/, ''))} disabled={loading}>
            {p}
          </button>
        ))}
      </div>
      <div className="ai-messages">
        {messages.map((m, i) => (
          <div key={i} className={`ai-message ${m.role === 'user' ? 'user' : 'bot'}`}>{m.text}</div>
        ))}
        {loading && <div className="ai-message bot">⏳ Querying current situation…</div>}
        <div ref={bottomRef} />
      </div>
      <div className="ai-input-area">
        <input
          className="ai-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { sendMessage(input); setInput('') } }}
          placeholder="Ask about the situation, evidence, resources, or plans…"
        />
        <button className="btn primary" onClick={() => { sendMessage(input); setInput('') }} disabled={loading}>Send</button>
      </div>
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [situation, setSituation] = useState<Situation | null>(null)
  const [resources, setResources] = useState<Resource[]>([])
  const [mapData, setMapData] = useState<{ features: MapFeature[] } | null>(null)
  const [benchmark, setBenchmark] = useState<BenchmarkResult | null>(null)
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [plan, setPlan] = useState<ResponsePlan | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [initialLoad, setInitialLoad] = useState(true)
  const [backendError, setBackendError] = useState(false)

  // Plan change state
  const [activePlanChanges, setActivePlanChanges] = useState<PlanChange[]>([])
  const [lastSimEvent, setLastSimEvent] = useState<SimulationStepResult['event'] | null>(null)
  const [reviewingChange, setReviewingChange] = useState<PlanChange | null>(null)

  const refreshDecisions = useCallback(async () => {
    try {
      const d = await api.get('/decisions?limit=30')
      setDecisions(d.decisions || [])
    } catch {}
  }, [])

  const refreshPlan = useCallback(async () => {
    try {
      const p = await api.get('/plan')
      if (p.plan) setPlan(p.plan)
    } catch {}
  }, [])

  const refresh = useCallback(async () => {
    try {
      const [sit, res, map] = await Promise.all([
        api.get('/situation'),
        api.get('/resources'),
        api.get('/map-data'),
      ])
      setSituation(sit)
      setResources(res.resources || [])
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
    refreshDecisions()
    refreshPlan()
    const interval = setInterval(() => {
      refresh()
      refreshDecisions()
    }, 5000)
    return () => clearInterval(interval)
  }, [refresh, refreshBenchmark, refreshDecisions, refreshPlan])

  const handleNextEvent = useCallback(async () => {
    setLoading(true)
    try {
      const result: SimulationStepResult = await api.post('/simulate/next')
      if (result.situation_update) setSituation(result.situation_update)
      if (result.plan_changes && result.plan_changes.length > 0) {
        setActivePlanChanges(result.plan_changes)
      }
      if (result.event) setLastSimEvent(result.event)
      await Promise.all([refresh(), refreshBenchmark(), refreshDecisions(), refreshPlan()])
    } catch (e) { setError(`Event failed: ${e}`) }
    finally { setLoading(false) }
  }, [refresh, refreshBenchmark, refreshDecisions, refreshPlan])

  const handleAutoPlay = useCallback(async () => {
    setLoading(true)
    try {
      await api.post('/simulate/auto', null)
      await Promise.all([refresh(), refreshBenchmark(), refreshDecisions(), refreshPlan()])
    } catch (e) { setError(`Auto play failed: ${e}`) }
    finally { setLoading(false) }
  }, [refresh, refreshBenchmark, refreshDecisions, refreshPlan])

  const handleReset = useCallback(async () => {
    setLoading(true)
    try {
      await api.post('/simulate/reset')
      setActivePlanChanges([])
      setLastSimEvent(null)
      setBenchmark(null)
      setPlan(null)
      setDecisions([])
      await refresh()
    } catch (e) { setError(`Reset failed: ${e}`) }
    finally { setLoading(false) }
  }, [refresh])

  const handleInject = useCallback(async (form: InjectForm) => {
    setLoading(true)
    try {
      const result: SimulationStepResult = await api.post('/simulate/event', { ...form, source_type: 'field_report', metadata: {} })
      if (result.situation_update) setSituation(result.situation_update)
      if (result.plan_changes && result.plan_changes.length > 0) {
        setActivePlanChanges(result.plan_changes)
      }
      if (result.event) setLastSimEvent(result.event)
      await Promise.all([refresh(), refreshBenchmark(), refreshDecisions(), refreshPlan()])
    } catch (e) { setError(`Inject failed: ${e}`) }
    finally { setLoading(false) }
  }, [refresh, refreshBenchmark, refreshDecisions, refreshPlan])

  const handleDecisionUpdate = useCallback(async () => {
    await refreshDecisions()
    await refresh()
  }, [refreshDecisions, refresh])

  const handleAcceptNewPlan = useCallback(async (decisionId: string) => {
    try {
      await api.post(`/decisions/${decisionId}/confirm`, { status: 'accepted', operator_notes: 'Accepted via plan change review' })
      await refreshDecisions()
      setReviewingChange(null)
    } catch (e) { setError(`Accept failed: ${e}`) }
  }, [refreshDecisions])

  if (initialLoad) return <LoadingScreen message="Connecting to Emergency Operations Center…" />
  if (backendError && !situation) return <BackendError message="Unable to connect to the backend API. The backend server must be running." onRetry={refresh} />

  // Build priority map
  const priorities = situation?.top_priorities?.reduce((acc, p) => {
    acc[p.entity_id] = p
    return acc
  }, {} as Record<string, typeof situation.top_priorities[0]>) || {}

  const priorityScores = Object.fromEntries(Object.entries(priorities).map(([k, v]) => [k, v.priority_score]))

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

  // Active route from plan for selected entity
  const selectedAllocation = plan?.allocations.find(a => {
    const dec = decisions.find(d => d.resource_id === a.resource_id && d.target_entity_id === selectedId && d.is_current)
    return !!dec
  })
  const highlightedRoute = selectedAllocation?.route?.path_nodes || null

  const reviewChanges = activePlanChanges.filter(c => c.review_required)

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
          {reviewChanges.length > 0 && (
            <span style={{ background: 'rgba(239,68,68,0.2)', color: 'var(--accent-red)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600, marginLeft: 8 }}>
              ⚠ {reviewChanges.length} plan change{reviewChanges.length !== 1 ? 's' : ''} need review
            </span>
          )}
          <div className="eoc-sim-time">
            T+{situation?.sim_time_min ?? 0}min
            {' · '}
            {situation?.processed_events ?? 0}/{situation?.total_events ?? 0} events
            {(situation?.evidence_conflicts?.length ?? 0) > 0 && (
              <span style={{ color: 'var(--accent-yellow)', marginLeft: 6 }}>⚠ {situation!.evidence_conflicts.length} conflicts</span>
            )}
          </div>
        </header>

        {/* Main 3-column */}
        <div className="eoc-main">
          {/* LEFT: Human-readable priority queue */}
          <PriorityPanel
            priorities={sortedPriorities}
            selectedId={selectedId}
            onSelect={setSelectedId}
            conflicts={situation?.evidence_conflicts || []}
          />

          {/* CENTER: Map + plan change alert + resources overlay */}
          <div className="map-container">
            <DisasterMap
              mapData={mapData}
              priorities={priorityScores}
              selectedId={selectedId}
              onSelect={setSelectedId}
              highlightedRoute={highlightedRoute}
            />

            {/* Plan change alert overlay */}
            {activePlanChanges.length > 0 && (
              <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 1000, maxWidth: 320 }}>
                <PlanChangeAlert
                  planChanges={activePlanChanges}
                  entities={entities}
                  resources={resources}
                  lastEvent={lastSimEvent}
                  onReview={c => setReviewingChange(c)}
                  onDismiss={() => setActivePlanChanges([])}
                />
              </div>
            )}

            {/* Map legend */}
            <div style={{ position: 'absolute', bottom: 10, left: 10, zIndex: 1000, background: 'rgba(10,14,26,0.9)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 10 }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>LEGEND</div>
              {[
                ['#ef4444', 'Critical / Blocked'],
                ['#f59e0b', 'Needs Attention'],
                ['#22c55e', 'Operational'],
                ['#3b82f6', 'Flooded'],
                ['#64748b', 'Unknown / Stale'],
              ].map(([c, l]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />
                  <span style={{ color: 'var(--text-secondary)' }}>{l}</span>
                </div>
              ))}
            </div>

            {/* Resources overlay */}
            <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000, width: 220, maxHeight: '45%', background: 'rgba(17,24,39,0.95)', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '5px 8px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                Response Resources
              </div>
              <ResourcesPanel resources={resources} decisions={decisions} entities={entities} />
            </div>
          </div>

          {/* RIGHT: Recommendation + Evidence workspace */}
          <RecommendationPanel
            selectedId={selectedId}
            entities={entities}
            priorities={priorities}
            decisions={decisions}
            plan={plan}
            resources={resources}
            onDecisionUpdate={handleDecisionUpdate}
            onQuestion={q => setPendingQuestion(q)}
          />
        </div>

        {/* BOTTOM: Controls | Benchmark | Bob */}
        <div className="bottom-panel">
          <SimControls
            situation={situation}
            pendingEvents={situation?.pending_events ?? 0}
            onNext={handleNextEvent}
            onAutoPlay={handleAutoPlay}
            onReset={handleReset}
            onInject={handleInject}
            loading={loading}
            lastEvent={lastSimEvent}
          />
          <BenchmarkPanel situation={situation} benchmark={benchmark} />
          <AIChatPanel pendingQuestion={pendingQuestion} onClear={() => setPendingQuestion(null)} />
        </div>
      </div>

      {/* Plan comparison modal */}
      {reviewingChange && (
        <PlanComparisonModal
          change={reviewingChange}
          entities={entities}
          resources={resources}
          decisions={decisions}
          onClose={() => setReviewingChange(null)}
          onAcceptNew={handleAcceptNewPlan}
        />
      )}
    </ErrorBoundary>
  )
}
