import { useCallback, useMemo, useRef, useState } from 'react'
import { AppHeader } from './components/AppHeader'
import { MobileNavigation } from './components/MobileNavigation'
import type { MobileView } from './components/MobileNavigation'
import { ResponsiveWorkbench } from './components/ResponsiveWorkbench'
import type { WorkbenchTab } from './components/ResponsiveWorkbench'
import { ActivityTimeline } from './features/activity/ActivityTimeline'
import { AIChatPanel } from './features/chat/AIChatPanel'
import type { ChatPrompt } from './features/chat/AIChatPanel'
import { EntityPanel } from './features/entity/EntityPanel'
import type { DashboardEntity } from './features/entity/EntityPanel'
import { DisasterMap } from './features/map/DisasterMap'
import { parseMapFeatures } from './features/map/mapUtils'
import { MetricsPanel } from './features/metrics/MetricsPanel'
import { PriorityPanel } from './features/priorities/PriorityPanel'
import { ResourcesPanel } from './features/resources/ResourcesPanel'
import { SimulationControls } from './features/simulation/SimulationControls'
import { useDashboardData } from './hooks/useDashboardData'
import type { DashboardEndpoint } from './hooks/useDashboardData'
import { useEntityEvidence } from './hooks/useEntityEvidence'
import { useSimulationActions } from './hooks/useSimulationActions'
import { finiteNumber, safeText } from './presentation'

const endpointLabels: Record<DashboardEndpoint, string> = {
  situation: 'Situation feed',
  resources: 'Resource feed',
  timeline: 'Activity timeline',
  map: 'Map data',
  benchmark: 'Benchmark',
}

type SidePanel = 'priorities' | 'detail'

export default function App() {
  const dashboard = useDashboardData()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mobileView, setMobileView] = useState<MobileView>('overview')
  const [sidePanel, setSidePanel] = useState<SidePanel>('priorities')
  const [workbenchTab, setWorkbenchTab] = useState('activity')
  const [mapFocusRequest, setMapFocusRequest] = useState(0)
  const [promptQueue, setPromptQueue] = useState<ChatPrompt[]>([])
  const promptIdRef = useRef(0)

  const mutationCoordinator = useMemo(() => ({
    prepareForMutation: dashboard.prepareForMutation,
    refreshAfterMutation: dashboard.refreshAfterMutation,
    finishMutation: dashboard.finishMutation,
  }), [dashboard.finishMutation, dashboard.prepareForMutation, dashboard.refreshAfterMutation])
  const simulation = useSimulationActions(mutationCoordinator)
  const evidenceState = useEntityEvidence(
    selectedId,
    dashboard.dataRevision,
    simulation.pendingAction !== null,
  )

  const sortedPriorities = useMemo(() => (
    [...(dashboard.situation?.top_priorities || [])]
      .sort((left, right) => (finiteNumber(right.priority_score) || 0) - (finiteNumber(left.priority_score) || 0))
      .map((priority, index) => ({ ...priority, rank: index + 1 }))
  ), [dashboard.situation])

  const prioritiesById = useMemo(() => {
    const values = new Map(sortedPriorities.map(priority => [priority.entity_id, priority]))
    return Object.fromEntries(values)
  }, [sortedPriorities])

  const priorityScores = useMemo(() => Object.fromEntries(
    sortedPriorities.map(priority => [priority.entity_id, finiteNumber(priority.priority_score) || 0]),
  ), [sortedPriorities])

  const entitiesById = useMemo(() => {
    const parsed = parseMapFeatures(dashboard.mapData?.features)
    const entries = parsed.points
      .filter(point => point.id)
      .map(point => {
        const entity: DashboardEntity = {
          id: point.id || '',
          name: point.name,
          type: point.type,
          status: point.status,
          population: finiteNumber(point.properties.population),
          criticality: finiteNumber(point.properties.criticality),
        }
        return [entity.id, entity] as const
      })
    return Object.fromEntries(entries)
  }, [dashboard.mapData])

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id)
    setMapFocusRequest(request => request + 1)
  }, [])

  const handleLocate = useCallback(() => {
    setMobileView('map')
    setMapFocusRequest(request => request + 1)
    window.requestAnimationFrame(() => {
      document.getElementById('map-heading')?.focus({ preventScroll: true })
    })
  }, [])

  const handleAskAI = useCallback((question: string) => {
    const id = ++promptIdRef.current
    setWorkbenchTab('chat')
    setMobileView('actions')
    setPromptQueue(current => [...current, { id, question }])
  }, [])

  const handlePromptConsumed = useCallback((id: number) => {
    setPromptQueue(current => current[0]?.id === id ? current.slice(1) : current)
  }, [])

  const pendingPrompt = promptQueue[0] || null
  const endpointErrorEntries = Object.entries(dashboard.endpointErrors) as [DashboardEndpoint, string][]
  const dashboardFeedErrorCount = endpointErrorEntries.filter(([endpoint]) => endpoint !== 'benchmark').length
  const ageOnlyStale = dashboard.isStale && dashboardFeedErrorCount === 0
  const layoutRevision = `${mobileView}:${sidePanel}:${workbenchTab}`

  const workbenchTabs: WorkbenchTab[] = [
    {
      id: 'activity',
      label: 'Activity',
      badge: dashboard.timeline.filter(event => !event.processed).length,
      content: (
        <ActivityTimeline
          events={dashboard.timeline}
          simulationMinutes={dashboard.situation?.sim_time_min ?? 0}
          isLoading={dashboard.initialLoading}
          isStale={ageOnlyStale}
          error={dashboard.endpointErrors.timeline}
          onRetry={() => void dashboard.refresh('manual')}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      badge: dashboard.situation?.pending_events ?? 0,
      content: (
        <SimulationControls
          pendingEvents={dashboard.situation?.pending_events ?? 0}
          pendingAction={simulation.pendingAction}
          feedback={simulation.feedback}
          onNext={() => void simulation.processNext()}
          onAutoPlay={() => void simulation.autoPlay()}
          onReset={() => void simulation.reset()}
          onInject={event => void simulation.inject(event)}
          onClearFeedback={simulation.clearFeedback}
        />
      ),
    },
    {
      id: 'resources',
      label: 'Resources',
      badge: dashboard.resources.length,
      content: (
        <ResourcesPanel
          resources={dashboard.resources}
          isLoading={dashboard.initialLoading}
          isStale={ageOnlyStale}
          error={dashboard.endpointErrors.resources}
          onRetry={() => void dashboard.refresh('manual')}
        />
      ),
    },
    {
      id: 'metrics',
      label: 'Metrics',
      content: (
        <MetricsPanel
          benchmark={dashboard.benchmark}
          simulationMinutes={dashboard.situation?.sim_time_min ?? 0}
          isLoading={dashboard.benchmarkLoading}
          isRefreshing={dashboard.benchmarkRefreshing}
          error={dashboard.endpointErrors.benchmark}
          onRetry={() => void dashboard.refreshBenchmark('manual')}
        />
      ),
    },
    {
      id: 'chat',
      label: 'AI assistant',
      content: <AIChatPanel pendingPrompt={pendingPrompt} onPromptConsumed={handlePromptConsumed} />,
    },
  ]

  return (
    <div className="app-shell" data-mobile-view={mobileView}>
      <a className="skip-link" href="#dashboard-workspace">Skip to dashboard workspace</a>
      <AppHeader
        scenario={safeText(dashboard.situation?.scenario, 'Bhote Valley emergency simulation')}
        simulationMinutes={dashboard.situation?.sim_time_min ?? 0}
        processedEvents={dashboard.situation?.processed_events ?? 0}
        totalEvents={dashboard.situation?.total_events ?? 0}
        conflictCount={dashboard.situation?.evidence_conflicts?.length ?? 0}
        connectionState={dashboard.connectionState}
        refreshing={dashboard.refreshing || dashboard.benchmarkLoading || dashboard.benchmarkRefreshing}
        lastUpdated={dashboard.lastUpdated}
        onRefresh={() => void dashboard.refreshAll()}
      />

      {endpointErrorEntries.length > 0 && (
        <section className="alert-region" aria-label="Data connection alerts">
          {endpointErrorEntries.map(([endpoint, message]) => (
            <div className="connection-alert" role="alert" key={endpoint}>
              <div>
                <strong>{endpointLabels[endpoint]} unavailable</strong>
                <p>{message}</p>
              </div>
              <div className="alert-actions">
                <button type="button" className="text-button" onClick={() => void dashboard.refreshAll()}>Retry</button>
                <button type="button" className="text-button" onClick={() => dashboard.dismissError(endpoint)}>Dismiss</button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="incident-strip" aria-labelledby="incident-summary-heading">
        <h2 id="incident-summary-heading" className="sr-only">Current incident summary</h2>
        <div className="incident-plan">
          <span>Current plan</span>
          <p>{safeText(dashboard.situation?.current_plan_summary, dashboard.initialLoading ? 'Connecting to the situation feed…' : 'No current plan summary is available.')}</p>
        </div>
        <dl>
          <div><dt>Blocked infrastructure</dt><dd>{dashboard.situation?.blocked_infrastructure?.length ?? 0}</dd></div>
          <div><dt>Unavailable resources</dt><dd>{dashboard.situation?.unavailable_resources?.length ?? 0}</dd></div>
        </dl>
      </section>

      <main id="dashboard-workspace" className="dashboard-main" tabIndex={-1}>
        <div className="dashboard-workspace">
          <div className="tablet-side-column">
            <nav className="side-panel-tabs" aria-label="Side panels">
              <button type="button" aria-pressed={sidePanel === 'priorities'} onClick={() => setSidePanel('priorities')}>Priorities</button>
              <button type="button" aria-pressed={sidePanel === 'detail'} onClick={() => setSidePanel('detail')}>Entity detail</button>
            </nav>
            <div id="priority-region" className={`side-region priority-region${sidePanel === 'priorities' ? ' is-tablet-active' : ''}`}>
              <PriorityPanel
                priorities={sortedPriorities}
                conflicts={dashboard.situation?.evidence_conflicts || []}
                selectedId={selectedId}
                isLoading={dashboard.initialLoading}
                isStale={ageOnlyStale}
                error={dashboard.endpointErrors.situation}
                onSelect={handleSelect}
                onRetry={() => void dashboard.refresh('manual')}
              />
            </div>
            <div id="detail-region" className={`side-region detail-region${sidePanel === 'detail' ? ' is-tablet-active' : ''}`}>
              <EntityPanel
                selectedId={selectedId}
                entity={selectedId ? entitiesById[selectedId] || null : null}
                priority={selectedId ? prioritiesById[selectedId] || null : null}
                evidenceState={evidenceState}
                onLocate={handleLocate}
                onAskAI={handleAskAI}
              />
            </div>
          </div>

          <div className="map-region">
            <DisasterMap
              mapData={dashboard.mapData}
              priorities={priorityScores}
              selectedId={selectedId}
              isLoading={dashboard.initialLoading}
              isStale={ageOnlyStale}
              error={dashboard.endpointErrors.map}
              layoutRevision={layoutRevision}
              focusRequest={mapFocusRequest}
              onSelect={handleSelect}
              onRetry={() => void dashboard.refresh('manual')}
            />
          </div>
        </div>

        <ResponsiveWorkbench tabs={workbenchTabs} activeTab={workbenchTab} onTabChange={setWorkbenchTab} />
      </main>
      <MobileNavigation activeView={mobileView} onChange={setMobileView} hasSelection={Boolean(selectedId)} />
    </div>
  )
}
