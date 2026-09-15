import type { PriorityScore } from '../../api'
import type { EntityEvidenceController } from '../../hooks/useEntityEvidence'
import {
  entityIcon,
  formatNumber,
  formatPercent,
  formatTimestamp,
  safeText,
  statusClass,
  titleCase,
} from '../../presentation'
import { AsyncState } from '../../components/AsyncState'

export interface DashboardEntity {
  id: string
  name: string
  type: string
  status: string
  population: number | null
  criticality: number | null
}

interface EntityPanelProps {
  selectedId: string | null
  entity: DashboardEntity | null
  priority: PriorityScore | null
  evidenceState: EntityEvidenceController
  onLocate: () => void
  onAskAI: (question: string) => void
}

export function EntityPanel({
  selectedId,
  entity,
  priority,
  evidenceState,
  onLocate,
  onAskAI,
}: EntityPanelProps) {
  if (!selectedId) {
    return (
      <aside className="feature-panel entity-panel" aria-labelledby="entity-heading">
        <div className="panel-heading-row">
          <div>
            <p className="panel-eyebrow">Inspection</p>
            <h2 id="entity-heading">Entity detail</h2>
          </div>
        </div>
        <AsyncState
          kind="empty"
          title="No location selected"
          message="Choose an item in the priority queue or mapped-object list to inspect evidence and status."
        />
      </aside>
    )
  }

  const name = entity?.name || priority?.entity_name || selectedId
  const type = entity?.type || priority?.entity_type || 'location'
  const status = entity?.status || 'unknown'
  const evidenceMatchesSelection = evidenceState.entityId === selectedId

  return (
    <aside className="feature-panel entity-panel" aria-labelledby="entity-heading">
      <div className="panel-heading-row entity-heading">
        <span className="entity-heading-icon" aria-hidden="true">{entityIcon(type)}</span>
        <div>
          <p className="panel-eyebrow">Selected entity · {selectedId}</p>
          <h2 id="entity-heading">{name}</h2>
        </div>
        <span className={`status-tag ${statusClass(status)}`}>{titleCase(status)}</span>
      </div>

      <div className="entity-actions">
        <button type="button" className="button button-secondary" onClick={onLocate}>
          Locate on map
        </button>
        <button
          type="button"
          className="button button-primary"
          onClick={() => onAskAI(`For ${name} (${selectedId}), summarize the current priority, evidence, and recommended next action.`)}
        >
          Ask AI
        </button>
      </div>

      <div className="panel-scroll">
        <section className="entity-section" aria-labelledby="entity-status-heading">
          <h3 id="entity-status-heading">Operational picture</h3>
          <dl className="detail-grid">
            <div><dt>Type</dt><dd>{titleCase(type)}</dd></div>
            <div><dt>Status</dt><dd>{titleCase(status)}</dd></div>
            <div><dt>Population</dt><dd>{entity?.population === null || entity?.population === undefined ? '—' : entity.population.toLocaleString()}</dd></div>
            <div><dt>Criticality</dt><dd>{formatPercent(entity?.criticality)}</dd></div>
          </dl>
          {priority && (
            <div className="priority-detail">
              <div className="score-heading">
                <span>Priority score</span>
                <strong>{formatNumber(priority.priority_score, 3)}</strong>
              </div>
              <progress max={1} value={Math.min(1, Math.max(0, priority.priority_score))} />
              <p>{safeText(priority.explanation, 'No priority explanation is available.')}</p>
              {Array.isArray(priority.supporting_factors) && priority.supporting_factors.length > 0 && (
                <ul className="factor-list" aria-label="Supporting factors">
                  {priority.supporting_factors.map(factor => <li key={factor}>{factor}</li>)}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className="entity-section" aria-labelledby="evidence-heading">
          <h3 id="evidence-heading">Evidence summaries</h3>
          {evidenceState.status === 'loading' || !evidenceMatchesSelection ? (
            <AsyncState kind="loading" title="Loading current evidence" compact />
          ) : evidenceState.status === 'error' ? (
            <AsyncState kind="error" title="Evidence unavailable" message={evidenceState.error || undefined} compact onRetry={evidenceState.retry} />
          ) : evidenceState.status === 'empty' ? (
            <AsyncState kind="empty" title="No evidence recorded" message="This entity has no evidence summaries or observations yet." compact />
          ) : (
            <div className="evidence-list">
              {evidenceState.evidence.length === 0 && (
                <p className="empty-copy">No fused evidence summaries are available.</p>
              )}
              {evidenceState.evidence.map(summary => (
                <article
                  key={`${summary.entity_id}-${summary.observation_type}`}
                  className={`evidence-card${summary.conflict_status === 'conflicting' ? ' has-conflict' : ''}`}
                >
                  <div className="evidence-card-heading">
                    <div>
                      <span>{titleCase(summary.observation_type)}</span>
                      <strong>{titleCase(summary.best_value)}</strong>
                    </div>
                    <span>{formatPercent(summary.confidence)} confidence</span>
                  </div>
                  <p>{summary.source_count ?? 0} source{summary.source_count === 1 ? '' : 's'} · {titleCase(summary.conflict_status)}</p>
                  {summary.recommendation && <p className="recommendation">{summary.recommendation}</p>}
                  {(summary.supporting_observations?.length > 0 || summary.conflicting_observations?.length > 0) && (
                    <details>
                      <summary>View evidence details</summary>
                      {summary.supporting_observations?.length > 0 && (
                        <div><b>Supporting</b><ul>{summary.supporting_observations.map(item => <li key={item}>{item}</li>)}</ul></div>
                      )}
                      {summary.conflicting_observations?.length > 0 && (
                        <div><b>Conflicting</b><ul>{summary.conflicting_observations.map(item => <li key={item}>{item}</li>)}</ul></div>
                      )}
                    </details>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="entity-section" aria-labelledby="observation-heading">
          <h3 id="observation-heading">Raw observations</h3>
          {evidenceState.status === 'loading' || !evidenceMatchesSelection ? (
            <AsyncState kind="loading" title="Loading raw observations" compact />
          ) : evidenceState.status === 'error' ? (
            <AsyncState kind="error" title="Raw observations unavailable" message={evidenceState.error || undefined} compact onRetry={evidenceState.retry} />
          ) : evidenceState.observations.length === 0 ? (
            <p className="empty-copy">No raw observations are available.</p>
          ) : (
            <ol className="observation-list">
              {evidenceState.observations.map(observation => (
                <li key={observation.id}>
                  <div>
                    <time dateTime={observation.timestamp}>{formatTimestamp(observation.timestamp)}</time>
                    <strong>{titleCase(observation.value)}</strong>
                    <span>{titleCase(observation.source_type)}</span>
                  </div>
                  <p>{observation.raw_text || 'No field note supplied.'}</p>
                  <span>{formatPercent(observation.confidence)} confidence · {formatPercent(observation.freshness)} freshness</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="entity-section" aria-labelledby="quick-question-heading">
          <h3 id="quick-question-heading">Quick questions</h3>
          <div className="quick-question-list">
            {[
              `Why is ${name} (${selectedId}) prioritized?`,
              `What evidence supports the current assessment for ${name} (${selectedId})?`,
              `What is the safest response route to ${name} (${selectedId})?`,
            ].map(question => (
              <button key={question} type="button" className="text-button question-button" onClick={() => onAskAI(question)}>
                {question}
              </button>
            ))}
          </div>
        </section>
      </div>
    </aside>
  )
}
