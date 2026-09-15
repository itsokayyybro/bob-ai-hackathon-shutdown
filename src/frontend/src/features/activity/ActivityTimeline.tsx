import { useMemo, useState } from 'react'
import type { SimEvent } from '../../api'
import { AsyncState, SkeletonRows } from '../../components/AsyncState'
import { formatPercent, safeText, titleCase } from '../../presentation'

interface ActivityTimelineProps {
  events: SimEvent[]
  simulationMinutes: number
  isLoading: boolean
  isStale: boolean
  error?: string
  onRetry: () => void
}

type ActivityFilter = 'all' | 'processed' | 'pending'

export function ActivityTimeline({ events, simulationMinutes, isLoading, isStale, error, onRetry }: ActivityTimelineProps) {
  const [filter, setFilter] = useState<ActivityFilter>('all')
  const visibleEvents = useMemo(() => events
    .filter(event => filter === 'all' || (filter === 'processed' ? event.processed : !event.processed))
    .toSorted((left, right) => (left.time_offset_min || 0) - (right.time_offset_min || 0)), [events, filter])

  return (
    <section className="feature-panel activity-panel" aria-labelledby="activity-heading">
      <div className="panel-heading-row">
        <div>
          <p className="panel-eyebrow">T+{Math.max(0, simulationMinutes)} minutes</p>
          <h2 id="activity-heading">Activity timeline</h2>
        </div>
        <span className="count-badge">{events.length}</span>
      </div>

      <div className="segmented-control" aria-label="Filter timeline events">
        {(['all', 'processed', 'pending'] as const).map(value => (
          <button key={value} type="button" className={filter === value ? 'is-active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {titleCase(value)}
          </button>
        ))}
      </div>

      {error && events.length > 0 && <AsyncState kind="stale" title="Timeline may be stale" message={error} compact onRetry={onRetry} />}
      {!error && isStale && events.length > 0 && <AsyncState kind="stale" title="Showing last known activity" compact onRetry={onRetry} />}

      <div className="panel-scroll">
        {isLoading && !events.length ? (
          <>
            <span className="sr-only" role="status">Loading activity timeline</span>
            <SkeletonRows count={5} />
          </>
        ) : error && !events.length ? (
          <AsyncState kind="error" title="Activity unavailable" message={error} onRetry={onRetry} />
        ) : !visibleEvents.length ? (
          <AsyncState kind="empty" title="No matching activity" message={events.length ? 'Change the activity filter to see other events.' : 'No simulation events have been reported.'} />
        ) : (
          <ol className="timeline-list">
            {visibleEvents.map(event => (
              <li key={event.id} className={event.processed ? 'is-processed' : 'is-pending'}>
                <div className="timeline-rail" aria-hidden="true"><span /></div>
                <article>
                  <div className="timeline-heading">
                    <time>T+{Math.max(0, event.time_offset_min || 0)} min</time>
                    <span className="status-tag">{event.processed ? 'Processed' : 'Pending'}</span>
                  </div>
                  <h3>{titleCase(event.event_type)}</h3>
                  <p>{safeText(event.description, 'No event description supplied.')}</p>
                  <div className="timeline-meta">
                    {event.entity_id && <span>Entity {event.entity_id}</span>}
                    <span>{formatPercent(event.confidence)} confidence</span>
                    <span>{formatPercent(event.severity)} severity</span>
                  </div>
                </article>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
