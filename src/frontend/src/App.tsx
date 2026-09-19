import { useCallback, useState } from 'react';
import { TopBar, type ViewId } from './components/TopBar.tsx';
import { Overview } from './views/Overview.tsx';
import { ResourcesView } from './views/ResourcesView.tsx';
import { TimelineView } from './views/TimelineView.tsx';
import { ReportsView } from './views/ReportsView.tsx';
import { useConsole } from './lib/useConsole.ts';
import { useOperatorLog, type Verdict } from './lib/operatorLog.ts';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';

export default function App() {
  const state = useConsole();
  const [view, setView] = useState<ViewId>('overview');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { entries, record, verdictFor } = useOperatorLog();

  /** Opening a place means "show me the evidence behind it". */
  const openPlace = useCallback((id: string) => {
    setSelectedId(id);
    setView('reports');
  }, []);

  const onVerdict = useCallback(
    (verdict: Verdict, decisionId: string, action: string, target: string | null) => {
      record(verdict, decisionId, action, target, state.situation?.sim_time_min ?? 0);
    },
    [record, state.situation?.sim_time_min],
  );

  if (state.loading) {
    return (
      <div className="splash">
        <p className="splash-line">Loading the current picture…</p>
      </div>
    );
  }

  if (state.error && !state.situation) {
    return (
      <div className="splash">
        <h1 className="splash-title">Cannot reach the engine</h1>
        <p className="splash-line">{state.error}</p>
        <button type="button" className="btn btn-primary" onClick={() => void state.refresh()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar state={state} view={view} onChangeView={setView} />

      <main className="main">
        {state.error && (
          <p className="notice" role="status">
            {state.error} Showing the last picture received.
          </p>
        )}

        {view === 'overview' && (
          <Overview
            state={state}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOpenPlace={openPlace}
            goTo={setView}
            verdictFor={verdictFor}
            onVerdict={onVerdict}
          />
        )}
        {view === 'resources' && <ResourcesView state={state} log={entries} />}
        {view === 'timeline' && <TimelineView state={state} />}
        {view === 'reports' && (
          <ReportsView state={state} selectedId={selectedId} onSelect={setSelectedId} />
        )}
      </main>
    </div>
  );
}
