import { Card, Chip } from './Card.tsx';
import { clockOffset, simClock } from '../lib/format.ts';
import type {
  Action,
  Headline,
  Milestone,
  ResourceGroup,
  Update,
  Watch,
} from '../lib/derive.ts';

/* ── Event summary ────────────────────────────────────────────────────────── */

/**
 * The headline card. The three figures partition the affected population, so they
 * sum to the total shown beneath them — an operator can sanity-check the split at
 * a glance rather than trusting three unrelated counters.
 */
export function EventCard({ simTimeMin, stats }: { simTimeMin: number; stats: Headline }) {
  return (
    <Card className="card-event">
      <div className="event-head">
        <span className="event-badge" aria-hidden="true">
          <WaterGlyph />
        </span>
        <div className="event-titles">
          <h2 className="event-name">Bhote Koshi Flood</h2>
          <p className="fine event-where">Bhote Valley · Nepal-inspired scenario</p>
          <p className="fine event-when">{simClock(simTimeMin)} since onset</p>
        </div>
        <Chip tone="critical">Active</Chip>
      </div>

      <div className="stat-row">
        <Stat value={stats.cannotReach} label="Cannot reach" tone="critical" />
        <Stat value={stats.needsConfirming} label="Unconfirmed" tone="caution" />
        <Stat value={stats.reachable} label="Reachable now" tone="good" />
      </div>

      <div className="mini-row">
        <Mini label="Affected" value={stats.totalPeople.toLocaleString('en-US')} />
        <Mini label="Routes lost" value={routesLost(stats)} />
        <Mini label="Damage" value={stats.damage} />
      </div>

      <p className="fine event-note">
        The three figures above divide all {stats.totalPeople.toLocaleString('en-US')} affected
        people by whether we can actually get to them.
      </p>
    </Card>
  );
}

function Stat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: 'critical' | 'caution' | 'good';
}) {
  return (
    <div className="stat" data-tone={tone}>
      <span className="num stat-value">{value.toLocaleString('en-US')}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

/** "1 road, 1 bridge" — says what was lost rather than a bare count. */
function routesLost(stats: Headline): string {
  const parts: string[] = [];
  if (stats.roadsCut > 0) parts.push(`${stats.roadsCut} road${stats.roadsCut === 1 ? '' : 's'}`);
  if (stats.bridgesClosed > 0) {
    parts.push(`${stats.bridgesClosed} bridge${stats.bridgesClosed === 1 ? '' : 's'}`);
  }
  return parts.length > 0 ? parts.join(', ') : 'None';
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="mini">
      <span className="label">{label}</span>
      <span className="mini-value">{value}</span>
    </div>
  );
}

/* ── Priority actions ─────────────────────────────────────────────────────── */

/**
 * The work queue and the only place in the app that dispatches anything. Each row
 * carries the band, what needs doing, who can do it, and the button — or the
 * reason there is no button.
 */
export function PriorityActions({
  actions,
  verdictFor,
  onAllocate,
  onOpen,
  onSeeAll,
}: {
  actions: Action[];
  verdictFor: (id: string) => 'confirmed' | 'rejected' | null;
  onAllocate: (action: Action) => void;
  onOpen: (entityId: string) => void;
  onSeeAll: () => void;
}) {
  return (
    <Card title="Priority actions" link={{ label: 'See all', onClick: onSeeAll }} padded={false}>
      {actions.length === 0 ? (
        <p className="empty">Nothing ranked yet. Take in the next report to start.</p>
      ) : (
        <ul className="actions">
          {actions.map((action) => {
            const verdict = action.decisionId ? verdictFor(action.decisionId) : null;
            return (
              <li key={action.entityId} className="action">
                <span className="band" data-band={action.band}>
                  {action.band}
                </span>

                <div className="action-main">
                  <button type="button" className="action-title" onClick={() => onOpen(action.entityId)}>
                    {action.title}
                  </button>
                  <ul className="action-lines">
                    {action.lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  {action.blockedReason && (
                    <p className="action-blocked">{action.blockedReason}</p>
                  )}
                </div>

                <div className="action-cta">
                  {verdict === 'confirmed' ? (
                    <Chip tone="good">Allocated</Chip>
                  ) : verdict === 'rejected' ? (
                    <Chip tone="neutral">Declined</Chip>
                  ) : action.actionable ? (
                    <button
                      type="button"
                      className={action.band === 'P1' ? 'btn btn-danger' : 'btn btn-primary'}
                      onClick={() => onAllocate(action)}
                    >
                      Allocate
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-quiet"
                      onClick={() => onOpen(action.entityId)}
                    >
                      Review
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ── Recent updates ──────────────────────────────────────────────────────── */

export function RecentUpdates({
  updates,
  onSeeAll,
}: {
  updates: Update[];
  onSeeAll: () => void;
}) {
  return (
    <Card title="Recent updates" link={{ label: 'See all', onClick: onSeeAll }} padded={false}>
      {updates.length === 0 ? (
        <p className="empty">Nothing has changed yet.</p>
      ) : (
        <ul className="updates">
          {updates.map((update) => (
            <li key={update.id} className="update">
              <span className="num update-time">{clockOffset(update.atMin)}</span>
              <span className="update-dot" data-tone={update.tone} aria-hidden="true" />
              <span className="update-text">{update.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ── What to watch ───────────────────────────────────────────────────────── */

export function WatchCard({ items }: { items: Watch[] }) {
  return (
    <Card title="What to watch">
      {items.length === 0 ? (
        <p className="empty">Nothing outstanding. The picture is consistent.</p>
      ) : (
        <ul className="watch">
          {items.map((item) => (
            <li key={item.text} className="watch-item">
              <span className="watch-mark" data-tone={item.tone} aria-hidden="true">
                {item.tone === 'critical' ? '!' : item.tone === 'caution' ? '?' : 'i'}
              </span>
              <span className="watch-text">{item.text}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="fine watch-note">
        Read from the current picture. The system does not forecast.
      </p>
    </Card>
  );
}

/* ── Resource overview ───────────────────────────────────────────────────── */

export function ResourceOverview({
  groups,
  ready,
  total,
  onSeeAll,
}: {
  groups: ResourceGroup[];
  ready: number;
  total: number;
  onSeeAll: () => void;
}) {
  return (
    <Card title="Teams" link={{ label: 'See all', onClick: onSeeAll }}>
      <p className="fine resource-summary">
        <strong className="resource-ready">{ready}</strong> of {total} ready to task
      </p>
      <ul className="resources">
        {groups.map((group) => (
          <li key={group.type} className="resource">
            <span className="num resource-count">{group.total}</span>
            <span className="resource-label">{group.label}s</span>
            <span className="fine resource-ready-line">
              {group.ready === group.total
                ? 'all ready'
                : group.ready === 0
                  ? 'none ready'
                  : `${group.ready} ready`}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ── Situation timeline ──────────────────────────────────────────────────── */

export function SituationTimeline({
  stops,
  processed,
  total,
  onSeeAll,
}: {
  stops: Milestone[];
  processed: number;
  total: number;
  onSeeAll: () => void;
}) {
  const progress = total > 0 ? (processed / total) * 100 : 0;

  return (
    <Card title="Situation timeline" link={{ label: 'View details', onClick: onSeeAll }}>
      <div className="stepper">
        <div className="stepper-rail" aria-hidden="true">
          <span className="stepper-fill" style={{ width: `${progress}%` }} />
        </div>
        <ol className="stepper-stops">
          {stops.map((stop) => (
            <li key={stop.id} className="stop" data-done={stop.done ? 'true' : undefined}>
              <span className="stop-node" aria-hidden="true" />
              <span className="num stop-time">{clockOffset(stop.atMin)}</span>
              <span className="stop-label">{stop.label}</span>
            </li>
          ))}
          <li className="stop stop-now">
            <span className="stop-node" aria-hidden="true" />
            <span className="num stop-time">Now</span>
            <span className="stop-label">
              {processed} of {total} reports in
            </span>
          </li>
        </ol>
      </div>
    </Card>
  );
}

/* ── Glyph ───────────────────────────────────────────────────────────────── */

function WaterGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M2 7c2-1.6 3.6-1.6 5.6 0s3.6 1.6 5.6 0 3.6-1.6 4.8-.6M2 12c2-1.6 3.6-1.6 5.6 0s3.6 1.6 5.6 0 3.6-1.6 4.8-.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
