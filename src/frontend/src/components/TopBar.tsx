import { simClock } from '../lib/format.ts';
import type { ConsoleState } from '../lib/useConsole.ts';

export type ViewId = 'overview' | 'resources' | 'timeline' | 'reports';

const TABS: { id: ViewId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'resources', label: 'Resources' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'reports', label: 'Reports' },
];

/** Product mark, tabs, live state, clock. Nothing else belongs up here. */
export function TopBar({
  state,
  view,
  onChangeView,
}: {
  state: ConsoleState;
  view: ViewId;
  onChangeView: (id: ViewId) => void;
}) {
  const { situation, error, busy } = state;
  const finished = (situation?.total_events ?? 0) > 0 && (situation?.pending_events ?? 0) === 0;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
            <path
              d="M2 13.5 7.4 4a1.6 1.6 0 0 1 2.8 0l1.7 3-2.1 3.7-1-1.8-2.6 4.6H2Z"
              fill="currentColor"
            />
            <path d="M12.2 7.6 18 17.6h-4.6l-3.5-6.1 2.3-3.9Z" fill="currentColor" opacity=".55" />
          </svg>
        </span>
        <span className="brand-name">ResponseAI</span>
      </div>

      <nav className="tabs" aria-label="Sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="tab"
            data-active={tab.id === view ? 'true' : undefined}
            aria-current={tab.id === view ? 'page' : undefined}
            onClick={() => onChangeView(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="topbar-right">
        <span className="live" data-state={error ? 'down' : 'up'}>
          <span className="live-dot" aria-hidden="true" />
          {error ? 'Disconnected' : 'Live'}
        </span>

        <span className="topbar-clock num">{simClock(situation?.sim_time_min ?? 0)}</span>

        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void state.advanceOne()}
          disabled={busy !== null || finished}
        >
          {busy === 'advance' ? 'Updating…' : finished ? 'All reports in' : 'Next report'}
        </button>
      </div>
    </header>
  );
}
