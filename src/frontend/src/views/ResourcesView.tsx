import { Card, Chip } from '../components/Card.tsx';
import { RoutePlanner } from '../components/RoutePlanner.tsx';
import { teamKind, teamStatusSentence } from '../lib/explain.ts';
import { enumLabel } from '../lib/format.ts';
import type { ConsoleState } from '../lib/useConsole.ts';
import type { LogEntry } from '../lib/operatorLog.ts';
import type { Resource } from '../lib/types.ts';

const TONE: Record<string, 'good' | 'info' | 'critical' | 'neutral'> = {
  available: 'good',
  deployed: 'info',
  en_route: 'info',
  unavailable: 'critical',
};

/** Who we have, where they are, what they are on, and what they can reach. */
export function ResourcesView({ state, log }: { state: ConsoleState; log: LogEntry[] }) {
  const { entities, resources, tasks, plan } = state;
  if (!entities) return null;

  const placeName = (id: string) => entities.assets.find((a) => a.id === id)?.name ?? id;
  const ready = resources.filter((r) => r.status === 'available');
  const off = resources.filter((r) => r.status === 'unavailable');
  const current = plan?.plan ?? null;

  return (
    <div className="stack">
      <Card title="Teams">
        <p className="summary">
          <strong>{ready.length} of {resources.length}</strong> teams can be tasked right now.
          {off.length > 0 && (
            <>
              {' '}
              {off.map((r) => r.name).join(', ')} {off.length === 1 ? 'is' : 'are'} cut off and not
              in any plan.
            </>
          )}
        </p>

        <table className="table">
          <thead>
            <tr>
              <th scope="col">Team</th>
              <th scope="col">Type</th>
              <th scope="col">Status</th>
              <th scope="col">Based at</th>
              <th scope="col">Can do</th>
            </tr>
          </thead>
          <tbody>
            {resources.map((unit: Resource) => (
              <tr key={unit.id}>
                <td className="cell-strong">{unit.name}</td>
                <td>{teamKind(unit.type)}</td>
                <td>
                  <Chip tone={TONE[unit.status] ?? 'neutral'}>{teamStatusSentence(unit.status)}</Chip>
                </td>
                <td>{placeName(unit.location_id)}</td>
                <td className="cell-soft">{unit.capabilities.map(enumLabel).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="two">
        <Card title="Current assignments">
          {!current || current.allocations.length === 0 ? (
            <p className="empty">
              Nothing assigned yet. Work out a plan to match teams to the ranked places.
            </p>
          ) : (
            <ul className="assignments">
              {current.allocations.map((allocation) => {
                const task = tasks.find((t) => t.id === allocation.task_id);
                const unit = resources.find((r) => r.id === allocation.resource_id);
                return (
                  <li key={`${allocation.task_id}-${allocation.resource_id}`} className="assignment">
                    <p className="assignment-head">
                      <strong>{unit?.name ?? allocation.resource_id}</strong> →{' '}
                      {placeName(task?.target_entity_id ?? '')}
                    </p>
                    <p className="fine">
                      {task ? enumLabel(task.task_type) : allocation.task_id} ·{' '}
                      {allocation.estimated_arrival_min <= 0
                        ? 'already on site'
                        : `arrives in ${Math.round(allocation.estimated_arrival_min)} min`}
                      {allocation.route &&
                        allocation.route.total_distance_km > 0 &&
                        ` · ${allocation.route.total_distance_km.toFixed(1)} km`}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}

          {current && current.unassigned_resources.length > 0 && (
            <p className="fine held">
              Held in reserve: {current.unassigned_resources.map((id) => resources.find((r) => r.id === id)?.name ?? id).join(', ')}
            </p>
          )}

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void state.optimize()}
            disabled={state.busy !== null}
          >
            {state.busy === 'optimize' ? 'Working it out…' : 'Work out a new plan'}
          </button>
        </Card>

        <Card title="Can we get there?">
          <RoutePlanner assets={entities.assets} onRoute={() => {}} />
        </Card>
      </div>

      <Card title="Your decisions">
        {log.length === 0 ? (
          <p className="empty">
            Nothing decided yet. Allocating or declining an action on the Overview records it here.
          </p>
        ) : (
          <ul className="decisions">
            {log.map((entry) => (
              <li key={`${entry.id}-${entry.at}`} className="decision" data-verdict={entry.verdict}>
                <Chip tone={entry.verdict === 'confirmed' ? 'good' : 'neutral'}>
                  {entry.verdict === 'confirmed' ? 'Allocated' : 'Declined'}
                </Chip>
                <span className="decision-text">{entry.action}</span>
                <span className="fine">
                  {new Date(entry.at).toLocaleTimeString('en-GB', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="fine">
          Recorded in this session. The engine has no write endpoint, so nothing is sent to the field.
        </p>
      </Card>
    </div>
  );
}
