import { useMemo, useState } from 'react'
import type { PriorityScore } from '../../api'
import { AsyncState, SkeletonRows } from '../../components/AsyncState'
import { clampUnit, entityIcon, formatNumber, formatPercent, priorityLevel } from '../../presentation'

interface PriorityPanelProps {
  priorities: PriorityScore[]
  conflicts: string[]
  selectedId: string | null
  isLoading: boolean
  isStale: boolean
  error?: string
  onSelect: (id: string) => void
  onRetry: () => void
}

function conflictEntityIds(conflicts: string[]): Set<string> {
  return new Set(conflicts.flatMap(conflict => conflict.match(/[A-Za-z]+\d+/g) || []))
}

export function PriorityPanel({
  priorities,
  conflicts,
  selectedId,
  isLoading,
  isStale,
  error,
  onSelect,
  onRetry,
}: PriorityPanelProps) {
  const [showAll, setShowAll] = useState(false)
  const conflictIds = useMemo(() => conflictEntityIds(conflicts), [conflicts])
  const visiblePriorities = showAll ? priorities : priorities.slice(0, 12)

  return (
    <section className="feature-panel priority-panel" aria-labelledby="priority-heading">
      <div className="panel-heading-row">
        <div>
          <p className="panel-eyebrow">Current incident</p>
          <h2 id="priority-heading">Priority queue</h2>
        </div>
        <span className="count-badge" aria-label={`${priorities.length} priorities`}>{priorities.length}</span>
      </div>

      {error && priorities.length > 0 && (
        <AsyncState kind="stale" title="Priorities may be stale" message={error} compact onRetry={onRetry} />
      )}
      {!error && isStale && priorities.length > 0 && (
        <AsyncState kind="stale" title="Showing last known priorities" compact onRetry={onRetry} />
      )}

      {conflicts.length > 0 && (
        <details className="conflict-summary">
          <summary>{conflicts.length} evidence conflict{conflicts.length === 1 ? '' : 's'}</summary>
          <ul>
            {conflicts.map((conflict, index) => <li key={`${conflict}-${index}`}>{conflict}</li>)}
          </ul>
        </details>
      )}

      <div className="panel-scroll">
        {isLoading && !priorities.length ? (
          <>
            <span className="sr-only" role="status">Loading priority queue</span>
            <SkeletonRows count={6} />
          </>
        ) : error && !priorities.length ? (
          <AsyncState kind="error" title="Priorities unavailable" message={error} onRetry={onRetry} />
        ) : !priorities.length ? (
          <AsyncState kind="empty" title="No active priorities" message="No locations currently require prioritization." />
        ) : (
          <ol className="priority-list">
            {visiblePriorities.map(priority => {
              const level = priorityLevel(priority.priority_score)
              const selected = selectedId === priority.entity_id
              return (
                <li key={priority.entity_id}>
                  <button
                    type="button"
                    className={`priority-card is-${level}${selected ? ' is-selected' : ''}`}
                    onClick={() => onSelect(priority.entity_id)}
                    aria-current={selected ? 'true' : undefined}
                    aria-label={`Select ${priority.entity_name}, rank ${priority.rank}, ${level} priority`}
                  >
                    <span className="priority-card-topline">
                      <span className="priority-rank">#{priority.rank}</span>
                      <span className="entity-icon" aria-hidden="true">{entityIcon(priority.entity_type)}</span>
                      <span className="priority-name">{priority.entity_name}</span>
                      {conflictIds.has(priority.entity_id) && <span className="conflict-marker" title="Conflicting evidence">Conflict</span>}
                      <span className={`priority-level is-${level}`}>{level}</span>
                    </span>
                    <progress
                      className={`priority-score is-${level}`}
                      max={1}
                      value={clampUnit(priority.priority_score)}
                      aria-label={`Priority score ${formatPercent(priority.priority_score)}`}
                    />
                    <span className="priority-metrics">
                      <span><b>{formatNumber(priority.priority_score, 3)}</b> score</span>
                      <span><b>{formatPercent(priority.urgency_score)}</b> urgency</span>
                      <span><b>{formatPercent(priority.accessibility_factor)}</b> access</span>
                      <span><b>{formatPercent(priority.confidence_factor)}</b> confidence</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </div>

      {priorities.length > 12 && (
        <div className="panel-footer">
          <span>Showing {visiblePriorities.length} of {priorities.length}</span>
          <button type="button" className="text-button" onClick={() => setShowAll(value => !value)}>
            {showAll ? 'Show top 12' : 'Show all priorities'}
          </button>
        </div>
      )}
    </section>
  )
}
