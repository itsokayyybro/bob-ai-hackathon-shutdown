import type { ConnectionState } from '../hooks/useDashboardData'

interface AppHeaderProps {
  scenario: string
  simulationMinutes: number
  processedEvents: number
  totalEvents: number
  conflictCount: number
  connectionState: ConnectionState
  refreshing: boolean
  lastUpdated: Date | null
  onRefresh: () => void
}

const connectionLabels: Record<ConnectionState, string> = {
  connected: 'Connected',
  refreshing: 'Refreshing',
  stale: 'Data stale',
  offline: 'Offline',
}

export function AppHeader({
  scenario,
  simulationMinutes,
  processedEvents,
  totalEvents,
  conflictCount,
  connectionState,
  refreshing,
  lastUpdated,
  onRefresh,
}: AppHeaderProps) {
  const progressMax = Math.max(totalEvents, 1)
  const safeProgress = Math.min(Math.max(processedEvents, 0), progressMax)

  return (
    <header className="app-header">
      <div className="brand-block">
        <span className="brand-mark" aria-hidden="true">S</span>
        <div>
          <p className="brand-kicker">Emergency intelligence</p>
          <h1>Sentinel Operations Center</h1>
          <p className="scenario-name">{scenario || 'Bhote Valley emergency simulation'}</p>
        </div>
      </div>

      <div className="incident-summary" aria-label="Current simulation state">
        <div className="summary-metric">
          <span>Simulation time</span>
          <strong>T+{Math.max(0, simulationMinutes)} min</strong>
        </div>
        <div className="event-progress">
          <div>
            <span>Events processed</span>
            <strong>{Math.max(0, processedEvents)} / {Math.max(0, totalEvents)}</strong>
          </div>
          <progress value={safeProgress} max={progressMax} aria-label={`${safeProgress} of ${totalEvents} events processed`} />
        </div>
        <div className={`summary-metric ${conflictCount ? 'has-warning' : ''}`}>
          <span>Evidence conflicts</span>
          <strong>{Math.max(0, conflictCount)}</strong>
        </div>
      </div>

      <div className="connection-block">
        <div className={`connection-state is-${connectionState}`}>
          <span className="connection-dot" aria-hidden="true" />
          <span>{connectionLabels[connectionState]}</span>
        </div>
        <span className="sr-only" aria-live="polite">
          {connectionState === 'offline'
            ? 'Dashboard connection is offline.'
            : connectionState === 'stale'
              ? 'Some dashboard data is stale.'
              : ''}
        </span>
        <p className="last-updated">
          {lastUpdated
            ? <>Updated <time dateTime={lastUpdated.toISOString()}>{lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></>
            : 'Awaiting first update'}
        </p>
        <button
          type="button"
          className="button button-secondary refresh-button"
          onClick={onRefresh}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing…' : 'Refresh now'}
        </button>
      </div>
    </header>
  )
}
