import { useMemo, useState } from 'react';
import type { Asset, Bridge, PriorityScore, Resource, Road } from '../lib/types.ts';
import { severityOf } from '../lib/explain.ts';

/**
 * Map of the valley.
 *
 * Answers three questions and nothing more: where the places are, which roads are
 * cut, and which place is in the worst trouble. Labels are place names, never
 * database codes. No grid, no coordinate readout, no targeting marks.
 */

const W = 900;
const H = 620;
const PAD_X = 34;
const PAD_Y = 30;

type LayerKey = 'roads' | 'damage' | 'teams' | 'labels';

const LAYERS: { key: LayerKey; label: string }[] = [
  { key: 'roads', label: 'Road network' },
  { key: 'damage', label: 'Damage and closures' },
  { key: 'teams', label: 'Teams on site' },
  { key: 'labels', label: 'Place names' },
];

interface Props {
  assets: Asset[];
  roads: Road[];
  bridges: Bridge[];
  resources?: Resource[];
  priorities?: PriorityScore[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  routeEdges?: string[];
}

interface Placed {
  asset: Asset;
  x: number;
  y: number;
  r: number;
  severity: 'critical' | 'warning' | 'stable';
  worst: boolean;
  teams: number;
  label: { x: number; y: number; anchor: 'start' | 'end' | 'middle' };
}

export function PlacesMap({
  assets,
  roads,
  bridges,
  resources = [],
  priorities = [],
  selectedId,
  onSelect,
  routeEdges = [],
}: Props) {
  const [on, setOn] = useState<Record<LayerKey, boolean>>({
    roads: true,
    damage: true,
    teams: true,
    labels: true,
  });

  const layout = useMemo(
    () => buildLayout(assets, bridges, priorities, resources),
    [assets, bridges, priorities, resources],
  );

  if (!layout) return <p className="empty">No places to show yet.</p>;

  const { places, toX, toY, pxPerKm } = layout;
  const placeById = new Map(places.map((p) => [p.asset.id, p]));
  const routeSet = new Set(routeEdges);
  const cutRoads = roads.filter((r) => r.status === 'blocked');

  return (
    <div className="map">
      <div className="map-frame">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="map-svg"
          role="img"
          aria-label={`Map of ${assets.length} places. ${cutRoads.length} road${cutRoads.length === 1 ? '' : 's'} cut.`}
        >
          {/* Roads recede; only damage draws the eye, because only damage changes a plan. */}
          {on.roads && (
            <g>
              {roads.map((road) => {
                const from = placeById.get(road.from_node);
                const to = placeById.get(road.to_node);
                if (!from || !to) return null;
                const cut = road.status === 'blocked';
                const rough = road.status === 'partially_blocked' || road.status === 'high_risk';
                if (cut && !on.damage) return null;
                return (
                  <g key={road.id}>
                    {routeSet.has(road.id) && (
                      <line className="map-route" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
                    )}
                    <line
                      className={
                        cut ? 'map-road map-road-cut' : rough ? 'map-road map-road-rough' : 'map-road'
                      }
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                    >
                      <title>{`${road.name} — ${label(road.status)}, ${road.distance_km} km`}</title>
                    </line>
                  </g>
                );
              })}
            </g>
          )}

          {/* A cut road says so in a word. Nobody should have to decode a colour. */}
          {on.damage && (
            <g>
              {cutRoads.map((road) => {
                const from = placeById.get(road.from_node);
                const to = placeById.get(road.to_node);
                if (!from || !to) return null;
                const mx = (from.x + to.x) / 2;
                const my = (from.y + to.y) / 2;
                return (
                  <g key={`cut-${road.id}`} className="map-tag map-tag-cut">
                    <rect x={mx - 19} y={my - 9} width="38" height="18" rx="9" />
                    <text x={mx} y={my + 4} textAnchor="middle">
                      CUT
                    </text>
                  </g>
                );
              })}

              {bridges.map((bridge) => {
                const closed = bridge.status === 'blocked';
                const disputed = bridge.conflict_status === 'conflicting';
                if (!closed && !disputed) return null;
                const x = toX(bridge.lon);
                const y = toY(bridge.lat);
                return (
                  <g
                    key={bridge.id}
                    className={closed ? 'map-tag map-tag-closed' : 'map-tag map-tag-unsure'}
                  >
                    <title>{`${bridge.name} — ${closed ? 'crossing closed' : 'reports disagree'}`}</title>
                    <rect
                      x={x - (closed ? 46 : 58)}
                      y={y - 9}
                      width={closed ? 92 : 116}
                      height="18"
                      rx="9"
                    />
                    <text x={x} y={y + 4} textAnchor="middle">
                      {closed ? 'BRIDGE CLOSED' : 'BRIDGE UNCONFIRMED'}
                    </text>
                  </g>
                );
              })}
            </g>
          )}

          {/* Places */}
          <g>
            {places.map((place) => {
              const selected = selectedId === place.asset.id;
              return (
                <g
                  key={place.asset.id}
                  className="map-place"
                  data-severity={place.severity}
                  data-selected={selected ? 'true' : undefined}
                  onClick={onSelect ? () => onSelect(place.asset.id) : undefined}
                  onKeyDown={
                    onSelect
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSelect(place.asset.id);
                          }
                        }
                      : undefined
                  }
                  tabIndex={onSelect ? 0 : undefined}
                  role={onSelect ? 'button' : undefined}
                  aria-label={`${place.asset.name}${place.asset.population > 0 ? `, ${place.asset.population.toLocaleString('en-US')} people` : ''}${place.worst ? ', highest priority' : ''}`}
                >
                  {place.worst && (
                    <circle className="map-worst" cx={place.x} cy={place.y} r={place.r + 6} />
                  )}
                  {selected && (
                    <circle className="map-selected" cx={place.x} cy={place.y} r={place.r + 10} />
                  )}
                  <circle className="map-dot" cx={place.x} cy={place.y} r={place.r} />

                  {on.labels && (
                    <>
                      <text
                        className="map-label"
                        x={place.label.x}
                        y={place.label.y}
                        textAnchor={place.label.anchor}
                        data-worst={place.worst ? 'true' : undefined}
                      >
                        {place.asset.name}
                      </text>
                      <text
                        className="map-sub"
                        x={place.label.x}
                        y={place.label.y + 12}
                        textAnchor={place.label.anchor}
                      >
                        {sub(place, on.teams)}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </g>

          {/* Scale bar, computed from the projection. */}
          <g className="map-scale" transform={`translate(${PAD_X} ${H - 18})`} aria-hidden="true">
            <line x1="0" y1="0" x2={pxPerKm * 2} y2="0" />
            <line x1="0" y1="-4" x2="0" y2="4" />
            <line x1={pxPerKm} y1="-3" x2={pxPerKm} y2="3" />
            <line x1={pxPerKm * 2} y1="-4" x2={pxPerKm * 2} y2="4" />
            <text x="0" y="-9">
              0
            </text>
            <text x={pxPerKm * 2} y="-9" textAnchor="middle">
              2 km
            </text>
          </g>
        </svg>

        <fieldset className="layers">
          <legend className="layers-title">Layers</legend>
          {LAYERS.map((layer) => (
            <label key={layer.key} className="layer">
              <input
                type="checkbox"
                checked={on[layer.key]}
                onChange={(e) => setOn({ ...on, [layer.key]: e.target.checked })}
              />
              <span>{layer.label}</span>
            </label>
          ))}
        </fieldset>
      </div>

      <div className="map-key">
        <Key swatch={<Dash colour="var(--map-road)" />} text="Road open" />
        <Key swatch={<Dash colour="var(--critical)" dashed />} text="Road cut" />
        <Key swatch={<Dot fill="var(--critical)" />} text="In trouble" />
        <Key swatch={<Dot fill="#fff" stroke="var(--line-strong)" />} text="Working normally" />
        <span className="fine map-key-note">Bigger circle means more people</span>
      </div>
    </div>
  );
}

function Key({ swatch, text }: { swatch: React.ReactNode; text: string }) {
  return (
    <span className="map-key-item">
      {swatch}
      {text}
    </span>
  );
}

function Dash({ colour, dashed }: { colour: string; dashed?: boolean }) {
  return (
    <svg width="24" height="10" aria-hidden="true">
      <line
        x1="1"
        y1="5"
        x2="23"
        y2="5"
        stroke={colour}
        strokeWidth="2.5"
        strokeDasharray={dashed ? '4 3' : undefined}
      />
    </svg>
  );
}

function Dot({ fill, stroke }: { fill: string; stroke?: string }) {
  return (
    <svg width="12" height="12" aria-hidden="true">
      <circle cx="6" cy="6" r="4.5" fill={fill} stroke={stroke} strokeWidth={stroke ? 1.8 : 0} />
    </svg>
  );
}

function label(status: string): string {
  if (status === 'blocked') return 'cut';
  if (status === 'partially_blocked') return 'passable with difficulty';
  if (status === 'high_risk') return 'open but risky';
  if (status === 'unknown') return 'condition unknown';
  return 'open';
}

function sub(place: Placed, showTeams: boolean): string {
  const bits: string[] = [];
  if (place.asset.population > 0) bits.push(`${place.asset.population.toLocaleString('en-US')} people`);
  if (showTeams && place.teams > 0) bits.push(`${place.teams} team${place.teams === 1 ? '' : 's'}`);
  return bits.join(' · ');
}

/* ── Layout ───────────────────────────────────────────────────────────────── */

function buildLayout(
  assets: Asset[],
  bridges: Bridge[],
  priorities: PriorityScore[],
  resources: Resource[],
) {
  const points = [...assets, ...bridges].filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon),
  );
  if (points.length === 0) return null;

  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);

  const pad = 0.14;
  const latSpan = Math.max(Math.max(...lats) - Math.min(...lats), 0.002);
  const lonSpan = Math.max(Math.max(...lons) - Math.min(...lons), 0.002);
  const minLat = Math.min(...lats) - latSpan * pad;
  const maxLat = Math.max(...lats) + latSpan * pad;
  const minLon = Math.min(...lons) - lonSpan * pad;
  const maxLon = Math.max(...lons) + lonSpan * pad;

  const boxW = W - PAD_X * 2;
  const boxH = H - PAD_Y * 2;
  const geoW = (maxLon - minLon) * kx;
  const geoH = maxLat - minLat;
  const scale = Math.min(boxW / geoW, boxH / geoH);
  const offX = PAD_X + (boxW - geoW * scale) / 2;
  const offY = PAD_Y + (boxH - geoH * scale) / 2;

  const toX = (lon: number) => offX + (lon - minLon) * kx * scale;
  const toY = (lat: number) => offY + (maxLat - lat) * scale;

  const worstId =
    priorities.find((p) => {
      const asset = assets.find((a) => a.id === p.entity_id);
      return asset ? !['command_center', 'resource_base'].includes(asset.type) : false;
    })?.entity_id ?? null;

  const teams = new Map<string, number>();
  for (const r of resources) teams.set(r.location_id, (teams.get(r.location_id) ?? 0) + 1);

  const placed: Placed[] = assets.map((asset) => {
    const priority = priorities.find((p) => p.entity_id === asset.id);
    return {
      asset,
      x: toX(asset.lon),
      y: toY(asset.lat),
      r: 5 + Math.sqrt(Math.max(0, asset.population)) / 9,
      severity: priority ? severityOf(priority, asset) : 'stable',
      worst: asset.id === worstId,
      teams: teams.get(asset.id) ?? 0,
      label: { x: 0, y: 0, anchor: 'start' as const },
    };
  });

  placeLabels(placed);

  return { places: placed, toX, toY, pxPerKm: scale / 110.9 };
}

/**
 * Greedy label placement. The names are the point of the map, so they must not
 * collide: each place tries right, left, above, then below and takes the first
 * slot that clears every label already placed. Largest population goes first so
 * the most important names get the best positions.
 */
function placeLabels(places: Placed[]) {
  const taken: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const order = [...places].sort((a, b) => b.r - a.r);

  for (const place of order) {
    const width = Math.max(place.asset.name.length * 6.1, 62);
    const options: { x: number; y: number; anchor: 'start' | 'end' | 'middle' }[] = [
      { x: place.x + place.r + 7, y: place.y - 1, anchor: 'start' },
      { x: place.x - place.r - 7, y: place.y - 1, anchor: 'end' },
      { x: place.x, y: place.y - place.r - 11, anchor: 'middle' },
      { x: place.x, y: place.y + place.r + 18, anchor: 'middle' },
      { x: place.x + place.r + 7, y: place.y + 15, anchor: 'start' },
      { x: place.x - place.r - 7, y: place.y + 15, anchor: 'end' },
      { x: place.x + place.r + 7, y: place.y - 16, anchor: 'start' },
      { x: place.x - place.r - 7, y: place.y - 16, anchor: 'end' },
    ];

    let chosen = options[0];
    for (const option of options) {
      const box = boxFor(option, width);
      if (box.x1 < 2 || box.x2 > W - 2 || box.y1 < 8 || box.y2 > H - 26) continue;
      if (taken.some((t) => hits(t, box))) continue;
      chosen = option;
      break;
    }

    place.label = chosen;
    taken.push(boxFor(chosen, width));
  }
}

function boxFor(
  pos: { x: number; y: number; anchor: 'start' | 'end' | 'middle' },
  width: number,
) {
  const x1 =
    pos.anchor === 'start' ? pos.x : pos.anchor === 'end' ? pos.x - width : pos.x - width / 2;
  return { x1, y1: pos.y - 10, x2: x1 + width, y2: pos.y + 16 };
}

function hits(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
) {
  return !(a.x2 < b.x1 || b.x2 < a.x1 || a.y2 < b.y1 || b.y2 < a.y1);
}
