import { Card } from '../components/Card.tsx';
import { PlacesMap } from '../components/PlacesMap.tsx';
import {
  EventCard,
  PriorityActions,
  RecentUpdates,
  ResourceOverview,
  SituationTimeline,
  WatchCard,
} from '../components/OverviewCards.tsx';
import {
  headline,
  priorityActions,
  recentUpdates,
  resourceGroups,
  watchList,
  milestones,
  type Action,
} from '../lib/derive.ts';
import { api } from '../lib/api.ts';
import { useFetch } from '../lib/useConsole.ts';
import type { ConsoleState } from '../lib/useConsole.ts';
import type { Verdict } from '../lib/operatorLog.ts';
import type { ViewId } from '../components/TopBar.tsx';

interface Props {
  state: ConsoleState;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenPlace: (id: string) => void;
  goTo: (view: ViewId) => void;
  verdictFor: (decisionId: string) => Verdict | null;
  onVerdict: (verdict: Verdict, decisionId: string, action: string, target: string | null) => void;
}

/**
 * Three columns: what happened on the left, where it happened in the middle, what
 * to do about it on the right. Reading across the top row answers the whole
 * question — situation, geography, action.
 */
export function Overview({
  state,
  selectedId,
  onSelect,
  onOpenPlace,
  goTo,
  verdictFor,
  onVerdict,
}: Props) {
  const { situation, entities, resources, tasks, timeline, plan, priorities } = state;
  const audit = useFetch(() => api.audit(20), [state.lastSync]);

  if (!situation || !entities) return null;

  const ranked = priorities.length > 0 ? priorities : situation.top_priorities;
  const stats = headline(entities.assets, entities.roads, entities.bridges, resources, ranked, situation);

  // Map each allocated task back to the place it serves, so actions can show the
  // matched unit without guessing.
  const allocationByEntity = new Map<
    string,
    { resourceId: string; etaMin: number; decisionId: string | null }
  >();
  for (const allocation of plan?.plan?.allocations ?? []) {
    const task = tasks.find((t) => t.id === allocation.task_id);
    if (!task) continue;
    const decision = plan?.plan?.decisions.find((d) => d.resource_id === allocation.resource_id);
    allocationByEntity.set(task.target_entity_id, {
      resourceId: allocation.resource_id,
      etaMin: allocation.estimated_arrival_min,
      decisionId: decision?.decision_id ?? decision?.id ?? null,
    });
  }

  const actions = priorityActions(ranked, entities.assets, resources, tasks, allocationByEntity);
  const watch = watchList(entities.assets, entities.roads, entities.bridges, ranked, resources);
  const groups = resourceGroups(resources);
  const stops = milestones(timeline?.events ?? [], situation.sim_time_min);

  function allocate(action: Action) {
    if (action.decisionId) {
      onVerdict('confirmed', action.decisionId, action.title, action.entityId);
    } else {
      // Nothing matched yet — ask the engine to plan against the current picture.
      void state.optimize();
    }
  }

  return (
    <div className="overview">
      <div className="col col-left">
        <EventCard simTimeMin={situation.sim_time_min} stats={stats} />
        <RecentUpdates
          updates={recentUpdates(audit.data?.audit_log ?? [])}
          onSeeAll={() => goTo('timeline')}
        />
        <WatchCard items={watch} />
      </div>

      <div className="col col-mid">
        <Card padded={false} className="card-map">
          <PlacesMap
            assets={entities.assets}
            roads={entities.roads}
            bridges={entities.bridges}
            resources={resources}
            priorities={ranked}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        </Card>
        <SituationTimeline
          stops={stops}
          processed={situation.processed_events}
          total={situation.total_events}
          onSeeAll={() => goTo('timeline')}
        />
      </div>

      <div className="col col-right">
        <PriorityActions
          actions={actions}
          verdictFor={verdictFor}
          onAllocate={allocate}
          onOpen={onOpenPlace}
          onSeeAll={() => goTo('resources')}
        />
        <ResourceOverview
          groups={groups}
          ready={stats.teamsReady}
          total={stats.teamsTotal}
          onSeeAll={() => goTo('resources')}
        />
      </div>
    </div>
  );
}
