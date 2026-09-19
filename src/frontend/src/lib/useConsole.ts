import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api.ts';
import type {
  Entities,
  PlanResponse,
  PriorityScore,
  Resource,
  Situation,
  Task,
  Timeline,
} from './types.ts';

const POLL_MS = 5000;

export interface ConsoleState {
  situation: Situation | null;
  entities: Entities | null;
  resources: Resource[];
  tasks: Task[];
  timeline: Timeline | null;
  plan: PlanResponse | null;
  /** Every scored entity, not just the top ten in /situation. */
  priorities: PriorityScore[];
  /** First-load only. Polls never blank the console out. */
  loading: boolean;
  error: string | null;
  lastSync: number | null;
  /** Ticks up whenever a poll brought a new simulation time. */
  pulse: number;
  refresh: () => Promise<void>;
  busy: string | null;
  advanceOne: () => Promise<void>;
  advanceAll: () => Promise<void>;
  optimize: () => Promise<void>;
  reset: () => Promise<void>;
}

/**
 * Single source of shared state for the console. The backend is authoritative and
 * cheap to read, so the console polls the whole picture every 5 s rather than
 * maintaining a client-side cache that could disagree with the engine.
 */
export function useConsole(): ConsoleState {
  const [situation, setSituation] = useState<Situation | null>(null);
  const [entities, setEntities] = useState<Entities | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [priorities, setPriorities] = useState<PriorityScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [pulse, setPulse] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  const lastTime = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [
        nextSituation,
        nextEntities,
        nextResources,
        nextTasks,
        nextTimeline,
        nextPlan,
        nextPriorities,
      ] = await Promise.all([
        api.situation(),
        api.entities(),
        api.resources(),
        api.tasks(),
        api.timeline(),
        api.plan(),
        api.priorities(),
      ]);

      setSituation(nextSituation);
      setEntities(nextEntities);
      setResources(nextResources.resources);
      setTasks(nextTasks.tasks);
      setTimeline(nextTimeline);
      setPlan(nextPlan);
      setPriorities(nextPriorities.priorities);
      setError(null);
      setLastSync(Date.now());

      if (lastTime.current !== null && nextSituation.sim_time_min !== lastTime.current) {
        setPulse((n) => n + 1);
      }
      lastTime.current = nextSituation.sim_time_min;
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 0
          ? 'The backend is not responding. Start it with: uvicorn app.main:app --port 8000'
          : e instanceof Error
            ? e.message
            : 'Unknown error',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const run = useCallback(
    async (name: string, action: () => Promise<unknown>) => {
      setBusy(name);
      try {
        await action();
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Action failed');
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  return {
    situation,
    entities,
    resources,
    tasks,
    timeline,
    plan,
    priorities,
    loading,
    error,
    lastSync,
    pulse,
    refresh,
    busy,
    advanceOne: () => run('advance', api.advanceOne),
    advanceAll: () => run('all', api.advanceAll),
    optimize: () => run('optimize', api.optimize),
    reset: () => run('reset', api.reset),
  };
}

/** On-demand fetch for the panels that are not part of the shared picture. */
export function useFetch<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // The fetcher closes over the caller's deps; those deps drive the refetch.
  const ref = useRef(fetcher);
  ref.current = fetcher;

  useEffect(() => {
    let live = true;
    setLoading(true);
    ref
      .current()
      .then((value) => {
        if (!live) return;
        setData(value);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setError(e instanceof Error ? e.message : 'Request failed');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, reload: () => setNonce((n) => n + 1) };
}
