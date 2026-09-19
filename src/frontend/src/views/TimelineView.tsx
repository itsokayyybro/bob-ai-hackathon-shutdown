import { Card, Chip } from '../components/Card.tsx';
import { api } from '../lib/api.ts';
import { useFetch } from '../lib/useConsole.ts';
import { clockOffset, enumLabel, stateSummary } from '../lib/format.ts';
import type { ConsoleState } from '../lib/useConsole.ts';
import type { SimEvent } from '../lib/types.ts';

/** What has happened, and what the system changed because of it. */
export function TimelineView({ state }: { state: ConsoleState }) {
  const { timeline, situation } = state;
  const audit = useFetch(() => api.audit(60), [state.lastSync]);

  if (!timeline || !situation) return null;

  const done = timeline.events.filter((e) => e.processed);
  const ahead = timeline.events.filter((e) => !e.processed);

  return (
    <div className="stack">
      <Card title="Scenario reports">
        <p className="summary">
          <strong>{done.length} of {timeline.events.length}</strong> reports have been taken in.
          {ahead.length > 0 && ` ${ahead.length} more will arrive as the clock advances.`}
        </p>
        <ol className="events">
          {timeline.events.map((event) => (
            <EventRow key={event.id} event={event} isNow={event.time_offset_min === situation.sim_time_min} />
          ))}
        </ol>
      </Card>

      <Card title="What the system changed">
        {audit.loading && <p className="empty">Loading…</p>}
        {audit.error && <p className="error-text">{audit.error}</p>}
        {audit.data && audit.data.audit_log.length === 0 && (
          <p className="empty">Nothing has changed yet.</p>
        )}
        {audit.data && audit.data.audit_log.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">What changed</th>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">Why</th>
              </tr>
            </thead>
            <tbody>
              {audit.data.audit_log.map((record) => (
                <tr key={record.id}>
                  <td className="num cell-time">{clockOffset(record.sim_time_min)}</td>
                  <td className="cell-strong">{enumLabel(record.event_type)}</td>
                  <td className="cell-soft cell-was">{stateSummary(record.previous_state)}</td>
                  <td className="cell-strong">{stateSummary(record.new_state)}</td>
                  <td className="cell-soft">{record.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function EventRow({ event, isNow }: { event: SimEvent; isNow: boolean }) {
  return (
    <li className="event-row" data-pending={!event.processed ? 'true' : undefined}>
      <span className="num event-time">{clockOffset(event.time_offset_min)}</span>
      <span className="event-node" aria-hidden="true" />
      <div className="event-body">
        <p className="event-desc">{event.description}</p>
        <p className="fine event-meta">
          {event.value && (
            <>
              Reported as <strong>{enumLabel(event.value)}</strong> ·{' '}
            </>
          )}
          {event.processed ? 'taken into the picture' : 'not yet taken in'}
        </p>
      </div>
      {isNow && <Chip tone="info">Now</Chip>}
    </li>
  );
}
