import { useState } from 'react'
import type { FormEvent } from 'react'
import type { InjectEventInput } from '../../api'
import type { ActionFeedback, SimulationAction } from '../../hooks/useSimulationActions'

interface SimulationControlsProps {
  pendingEvents: number
  pendingAction: SimulationAction | null
  feedback: ActionFeedback | null
  onNext: () => void
  onAutoPlay: () => void
  onReset: () => void
  onInject: (event: InjectEventInput) => void
  onClearFeedback: () => void
}

type InjectionFormState = Omit<InjectEventInput, 'confidence'> & { confidence: string }
type ValidationField = 'entity_id' | 'description' | 'confidence'

interface InjectionValidationError {
  field: ValidationField
  message: string
}

const ENTITY_ID_MAX_LENGTH = 64
const DESCRIPTION_MAX_LENGTH = 500
const INJECTION_ERROR_ID = 'injection-validation-error'

const defaultForm: InjectionFormState = {
  event_type: 'road_blockage',
  entity_id: 'R7',
  observation_type: 'road_status',
  value: 'blocked',
  confidence: '0.85',
  description: 'Operator injected event',
}

const presetEvents: { label: string; event: InjectEventInput }[] = [
  { label: 'Block road R7', event: { event_type: 'road_blockage', entity_id: 'R7', observation_type: 'road_status', value: 'blocked', confidence: 0.9, description: 'Road R7 blocked by landslide' } },
  { label: 'Block bridge B2', event: { event_type: 'bridge_damage_report', entity_id: 'B2', observation_type: 'bridge_status', value: 'blocked', confidence: 0.88, description: 'Bridge B2 structural damage' } },
  { label: 'Overload HP1', event: { event_type: 'hospital_demand_surge', entity_id: 'HP1', observation_type: 'capacity', value: 'overloaded', confidence: 0.95, description: 'Health post HP1 overloaded with casualties' } },
  { label: 'Isolate village V3', event: { event_type: 'village_isolation_confirmed', entity_id: 'V3', observation_type: 'accessibility', value: 'isolated', confidence: 0.9, description: 'Village V3 isolated by road damage' } },
  { label: 'Mark RT2 unavailable', event: { event_type: 'resource_unavailable', entity_id: 'RT2', observation_type: 'resource_status', value: 'unavailable', confidence: 1, description: 'Rescue Team Bravo unavailable' } },
  { label: 'Report B2 open conflict', event: { event_type: 'conflicting_bridge_report', entity_id: 'B2', observation_type: 'bridge_status', value: 'open', confidence: 0.55, description: 'Conflicting report: B2 may be passable' } },
]

const pendingLabels: Record<SimulationAction, string> = {
  next: 'Processing next event…',
  auto: 'Processing all pending events…',
  reset: 'Resetting the simulation…',
  inject: 'Injecting operator event…',
}

export function SimulationControls({
  pendingEvents,
  pendingAction,
  feedback,
  onNext,
  onAutoPlay,
  onReset,
  onInject,
  onClearFeedback,
}: SimulationControlsProps) {
  const [showInjection, setShowInjection] = useState(false)
  const [form, setForm] = useState<InjectionFormState>(defaultForm)
  const [validationError, setValidationError] = useState<InjectionValidationError | null>(null)
  const busy = pendingAction !== null

  const updateFormField = (field: keyof InjectionFormState, value: string) => {
    setForm(current => ({ ...current, [field]: value }))
    setValidationError(current => current?.field === field ? null : current)
  }

  const submitInjection = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const confidence = Number(form.confidence)
    if (!form.entity_id.trim()) {
      setValidationError({ field: 'entity_id', message: 'Enter an entity ID.' })
      return
    }
    if (!form.description.trim()) {
      setValidationError({ field: 'description', message: 'Enter an event description.' })
      return
    }
    if (!form.confidence.trim() || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      setValidationError({ field: 'confidence', message: 'Confidence must be a number from 0 to 1.' })
      return
    }
    setValidationError(null)
    onInject({ ...form, entity_id: form.entity_id.trim(), description: form.description.trim(), confidence })
  }

  const confirmReset = () => {
    if (window.confirm('Reset the entire simulation? This clears simulation progress and current benchmark results.')) {
      onReset()
    }
  }

  return (
    <section className="feature-panel simulation-panel" aria-labelledby="simulation-heading">
      <div className="panel-heading-row">
        <div>
          <p className="panel-eyebrow">Scenario control</p>
          <h2 id="simulation-heading">Simulation actions</h2>
        </div>
        <span className="count-badge">{Math.max(0, pendingEvents)} pending</span>
      </div>

      <div className="primary-actions">
        <button type="button" className="button button-primary" onClick={onNext} disabled={busy || pendingEvents === 0}>
          Process next event
        </button>
        <button type="button" className="button button-secondary" onClick={onAutoPlay} disabled={busy || pendingEvents === 0}>
          Process all pending
        </button>
        <button type="button" className="button button-danger" onClick={confirmReset} disabled={busy}>
          Reset simulation
        </button>
        <button
          type="button"
          className="button button-secondary"
          aria-expanded={showInjection}
          aria-controls="injection-controls"
          onClick={() => setShowInjection(value => !value)}
        >
          {showInjection ? 'Hide event injection' : 'Inject an event'}
        </button>
      </div>

      {pendingAction && <p className="action-progress" role="status"><span aria-hidden="true" />{pendingLabels[pendingAction]}</p>}
      {feedback && (
        <div className={`action-feedback is-${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>
          <p>{feedback.message}</p>
          <button type="button" className="text-button" onClick={onClearFeedback}>Dismiss</button>
        </div>
      )}

      <div id="injection-controls" className="injection-controls" hidden={!showInjection}>
        <div className="preset-section">
          <div>
            <h3>Immediate presets</h3>
            <p>Each preset executes as soon as it is selected.</p>
          </div>
          <div className="preset-list">
            {presetEvents.map(preset => (
              <button
                key={preset.label}
                type="button"
                className="button button-quiet"
                onClick={() => onInject(preset.event)}
                disabled={busy}
              >
                Run: {preset.label}
              </button>
            ))}
          </div>
        </div>

        <form className="injection-form" onSubmit={submitInjection}>
          <h3>Custom field report</h3>
          <div className="form-grid">
            <label htmlFor="event-type">Event type
              <select id="event-type" value={form.event_type} disabled={busy} onChange={event => updateFormField('event_type', event.target.value)}>
                {['road_blockage', 'bridge_damage_report', 'bridge_confirmed_blocked', 'conflicting_bridge_report', 'hospital_demand_surge', 'school_evacuation', 'resource_unavailable', 'satellite_observation', 'village_isolation_confirmed', 'alternate_route_opened'].map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label htmlFor="entity-id">Entity ID
              <input
                id="entity-id"
                value={form.entity_id}
                disabled={busy}
                maxLength={ENTITY_ID_MAX_LENGTH}
                aria-invalid={validationError?.field === 'entity_id'}
                aria-describedby={validationError?.field === 'entity_id' ? INJECTION_ERROR_ID : undefined}
                onChange={event => updateFormField('entity_id', event.target.value)}
                placeholder="B1, R4, H1…"
              />
            </label>
            <label htmlFor="observation-type">Observation type
              <select id="observation-type" value={form.observation_type} disabled={busy} onChange={event => updateFormField('observation_type', event.target.value)}>
                {['bridge_status', 'road_status', 'capacity', 'accessibility', 'flood_level', 'resource_status', 'damage'].map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label htmlFor="observation-value">Value
              <select id="observation-value" value={form.value} disabled={busy} onChange={event => updateFormField('value', event.target.value)}>
                {['blocked', 'open', 'partially_blocked', 'overloaded', 'unavailable', 'isolated', 'flooded', 'evacuation_required', 'damaged'].map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label htmlFor="confidence">Confidence (0–1)
              <input
                id="confidence"
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={form.confidence}
                disabled={busy}
                aria-invalid={validationError?.field === 'confidence'}
                aria-describedby={validationError?.field === 'confidence' ? INJECTION_ERROR_ID : undefined}
                onChange={event => updateFormField('confidence', event.target.value)}
              />
            </label>
            <label className="form-span" htmlFor="event-description">Description
              <input
                id="event-description"
                value={form.description}
                disabled={busy}
                maxLength={DESCRIPTION_MAX_LENGTH}
                aria-invalid={validationError?.field === 'description'}
                aria-describedby={validationError?.field === 'description' ? INJECTION_ERROR_ID : undefined}
                onChange={event => updateFormField('description', event.target.value)}
                placeholder="Describe the observed change"
              />
            </label>
          </div>
          {validationError && <p id={INJECTION_ERROR_ID} className="field-error" role="alert">{validationError.message}</p>}
          <button type="submit" className="button button-primary" disabled={busy}>Inject custom event</button>
        </form>
      </div>
    </section>
  )
}
