import { useState } from 'react';
import { api } from '../lib/api.ts';
import { Code, Empty, Field } from './Card.tsx';
import { minutes, pct } from '../lib/format.ts';
import type { Asset, Route } from '../lib/types.ts';

const VEHICLES = ['heavy', 'medium', 'light'];

/**
 * Route query against the live graph.
 *
 * The answer that matters is not the path — it is whether the path survives the
 * current accessibility weights, and what it had to give up. So the result leads
 * with feasibility and names the corridors it refused.
 */
export function RoutePlanner({
  assets,
  onRoute,
  initialOrigin = 'CC1',
  initialDestination = 'V3',
}: {
  assets: Asset[];
  onRoute: (route: Route | null) => void;
  initialOrigin?: string;
  initialDestination?: string;
}) {
  const [origin, setOrigin] = useState(initialOrigin);
  const [destination, setDestination] = useState(initialDestination);
  const [vehicle, setVehicle] = useState('heavy');
  const [route, setRoute] = useState<Route | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOf = (id: string) => assets.find((a) => a.id === id)?.name ?? id;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await api.route(origin, destination, vehicle);
      setRoute(result);
      onRoute(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Route query failed');
      setRoute(null);
      onRoute(null);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="planner">
      <form className="planner-form" onSubmit={submit}>
        <label className="planner-field">
          <span className="caps">From</span>
          <select value={origin} onChange={(e) => setOrigin(e.target.value)}>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id} — {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="planner-field">
          <span className="caps">To</span>
          <select value={destination} onChange={(e) => setDestination(e.target.value)}>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id} — {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="planner-field planner-field-narrow">
          <span className="caps">Vehicle</span>
          <select value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
            {VEHICLES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-strong" disabled={pending}>
          {pending ? 'Solving…' : 'Find route'}
        </button>
      </form>

      {error && <p className="error-inline">{error}</p>}

      {!route && !error && (
        <Empty>
          Pick an origin and destination to solve against the current accessibility
          weights. Blocked corridors are excluded, not routed through.
        </Empty>
      )}

      {route && (
        <div className="route" data-feasible={route.feasible ? 'true' : 'false'}>
          <div className="route-verdict">
            <span className="num route-verdict-word">
              {route.feasible ? 'Route holds' : 'No feasible route'}
            </span>
            <span className="caps route-verdict-sub">
              {nameOf(route.origin)} → {nameOf(route.destination)} · {route.vehicle_type}
            </span>
          </div>

          {route.feasible && (
            <>
              <div className="route-figures">
                <Field label="Distance">
                  <span className="mono">{route.total_distance_km.toFixed(1)} km</span>
                </Field>
                <Field label="Travel">
                  <span className="mono">{minutes(route.total_time_min)}</span>
                </Field>
                <Field label="Accrued risk">
                  <span className="mono" data-tone={route.total_risk > 0.25 ? 'silt' : undefined}>
                    {pct(route.total_risk, 1)}
                  </span>
                </Field>
                <Field label="Hops">
                  <span className="mono">{Math.max(0, route.path_nodes.length - 1)}</span>
                </Field>
              </div>

              <ol className="route-path">
                {route.path_nodes.map((node, index) => (
                  <li key={`${node}-${index}`} className="route-stop">
                    <Code>{node}</Code>
                    <span className="route-stop-name">{nameOf(node)}</span>
                    {index < route.path_edges.length && (
                      <span className="mono route-edge">via {route.path_edges[index]}</span>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}

          <p className="route-reason">{route.reason}</p>

          {route.blocked_alternatives.length > 0 && (
            <p className="route-blocked">
              <span className="caps">Refused</span>
              {route.blocked_alternatives.map((id) => (
                <Code key={id}>{id}</Code>
              ))}
              <span className="caps route-blocked-note">below accessibility threshold</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
