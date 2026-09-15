import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  dashboardApi,
  getErrorMessage,
  isAbortError,
} from '../api'
import type {
  BenchmarkResult,
  MapData,
  Resource,
  SimEvent,
  Situation,
} from '../api'

export type DashboardEndpoint = 'situation' | 'resources' | 'timeline' | 'map' | 'benchmark'
export type RefreshReason = 'initial' | 'poll' | 'manual' | 'mutation'
export type ConnectionState = 'connected' | 'refreshing' | 'stale' | 'offline'

export interface RefreshResult {
  committed: boolean
  succeeded: DashboardEndpoint[]
  failed: DashboardEndpoint[]
}

interface SettledValue<K extends DashboardEndpoint, V> {
  key: K
  value: V | null
  error: unknown
}

async function settle<K extends DashboardEndpoint, V>(
  key: K,
  request: Promise<V>,
): Promise<SettledValue<K, V>> {
  try {
    return { key, value: await request, error: null }
  } catch (error) {
    return { key, value: null, error }
  }
}

const emptyRefreshResult: RefreshResult = {
  committed: false,
  succeeded: [],
  failed: [],
}

export function useDashboardData() {
  const [situation, setSituation] = useState<Situation | null>(null)
  const [resources, setResources] = useState<Resource[]>([])
  const [timeline, setTimeline] = useState<SimEvent[]>([])
  const [mapData, setMapData] = useState<MapData | null>(null)
  const [benchmark, setBenchmark] = useState<BenchmarkResult | null>(null)
  const [endpointErrors, setEndpointErrors] = useState<Partial<Record<DashboardEndpoint, string>>>({})
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [benchmarkLoading, setBenchmarkLoading] = useState(true)
  const [benchmarkRefreshing, setBenchmarkRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [lastRefreshHadError, setLastRefreshHadError] = useState(false)
  const [lastBenchmarkRefreshHadError, setLastBenchmarkRefreshHadError] = useState(false)
  const [dataRevision, setDataRevision] = useState(0)
  const [clock, setClock] = useState(0)

  const mountedRef = useRef(false)
  const benchmarkRef = useRef<BenchmarkResult | null>(null)
  const refreshSequenceRef = useRef(0)
  const benchmarkSequenceRef = useRef(0)
  const activeRefreshControllerRef = useRef<AbortController | null>(null)
  const activeBenchmarkControllerRef = useRef<AbortController | null>(null)
  const activeRefreshRef = useRef<Promise<RefreshResult> | null>(null)
  const activeBenchmarkRef = useRef<Promise<boolean> | null>(null)
  const mutationPausedRef = useRef(false)

  const invalidateActiveReads = useCallback((releaseOperations = false) => {
    ++refreshSequenceRef.current
    ++benchmarkSequenceRef.current
    activeRefreshControllerRef.current?.abort()
    activeBenchmarkControllerRef.current?.abort()

    if (releaseOperations) {
      activeRefreshRef.current = null
      activeBenchmarkRef.current = null
    }
  }, [])

  const runRefresh = useCallback(async (reason: RefreshReason): Promise<RefreshResult> => {
    const requestId = ++refreshSequenceRef.current
    const controller = new AbortController()
    activeRefreshControllerRef.current = controller
    if (mountedRef.current) setRefreshing(true)

    const [situationResult, resourcesResult, timelineResult, mapResult] = await Promise.all([
      settle('situation', dashboardApi.getSituation(controller.signal)),
      settle('resources', dashboardApi.getResources(controller.signal)),
      settle('timeline', dashboardApi.getTimeline(controller.signal)),
      settle('map', dashboardApi.getMapData(controller.signal)),
    ])

    if (!mountedRef.current || requestId !== refreshSequenceRef.current) {
      return emptyRefreshResult
    }

    const results = [situationResult, resourcesResult, timelineResult, mapResult]
    const succeeded: DashboardEndpoint[] = []
    const failed: DashboardEndpoint[] = []

    if (situationResult.error === null && situationResult.value) {
      setSituation(situationResult.value)
      succeeded.push('situation')
    } else if (!isAbortError(situationResult.error)) {
      failed.push('situation')
    }

    if (resourcesResult.error === null && resourcesResult.value) {
      setResources(Array.isArray(resourcesResult.value.resources) ? resourcesResult.value.resources : [])
      succeeded.push('resources')
    } else if (!isAbortError(resourcesResult.error)) {
      failed.push('resources')
    }

    if (timelineResult.error === null && timelineResult.value) {
      setTimeline(Array.isArray(timelineResult.value.events) ? timelineResult.value.events : [])
      succeeded.push('timeline')
    } else if (!isAbortError(timelineResult.error)) {
      failed.push('timeline')
    }

    if (mapResult.error === null && mapResult.value) {
      setMapData({
        ...mapResult.value,
        features: Array.isArray(mapResult.value.features) ? mapResult.value.features : [],
      })
      succeeded.push('map')
    } else if (!isAbortError(mapResult.error)) {
      failed.push('map')
    }

    setEndpointErrors(previous => {
      const next = { ...previous }
      for (const result of results) {
        if (result.error === null) {
          delete next[result.key]
        } else if (!isAbortError(result.error)) {
          next[result.key] = getErrorMessage(result.error)
        }
      }
      return next
    })

    if (succeeded.length) setLastUpdated(new Date())
    setLastRefreshHadError(failed.length > 0)
    setInitialLoading(false)
    setRefreshing(false)
    if (reason === 'mutation') setDataRevision(revision => revision + 1)

    return { committed: true, succeeded, failed }
  }, [])

  const refresh = useCallback((reason: RefreshReason = 'manual'): Promise<RefreshResult> => {
    if (mutationPausedRef.current && reason !== 'mutation') {
      return Promise.resolve(emptyRefreshResult)
    }

    if (activeRefreshRef.current) return activeRefreshRef.current

    const operation = runRefresh(reason)
    activeRefreshRef.current = operation
    const releaseOperation = () => {
      if (activeRefreshRef.current === operation) activeRefreshRef.current = null
    }
    void operation.then(releaseOperation, releaseOperation)
    return operation
  }, [runRefresh])

  const runBenchmarkRefresh = useCallback(async (): Promise<boolean> => {
    const requestId = ++benchmarkSequenceRef.current
    const controller = new AbortController()
    activeBenchmarkControllerRef.current = controller

    if (mountedRef.current) {
      setBenchmarkLoading(benchmarkRef.current === null)
      setBenchmarkRefreshing(true)
    }

    const result = await settle('benchmark', dashboardApi.getBenchmark(controller.signal))

    if (!mountedRef.current || requestId !== benchmarkSequenceRef.current) return false

    setBenchmarkLoading(false)
    setBenchmarkRefreshing(false)

    if (result.error === null && result.value) {
      benchmarkRef.current = result.value
      setBenchmark(result.value)
      setLastBenchmarkRefreshHadError(false)
      setEndpointErrors(previous => {
        const next = { ...previous }
        delete next.benchmark
        return next
      })
      return true
    }

    if (!isAbortError(result.error)) {
      setLastBenchmarkRefreshHadError(true)
      setEndpointErrors(previous => ({
        ...previous,
        benchmark: getErrorMessage(result.error),
      }))
    }
    return false
  }, [])

  const refreshBenchmark = useCallback((reason: RefreshReason = 'manual'): Promise<boolean> => {
    if (mutationPausedRef.current && reason !== 'mutation') return Promise.resolve(false)
    if (activeBenchmarkRef.current) return activeBenchmarkRef.current

    const operation = runBenchmarkRefresh()
    activeBenchmarkRef.current = operation
    const releaseOperation = () => {
      if (activeBenchmarkRef.current === operation) activeBenchmarkRef.current = null
    }
    void operation.then(releaseOperation, releaseOperation)
    return operation
  }, [runBenchmarkRefresh])

  const refreshAll = useCallback(async (): Promise<RefreshResult> => {
    const [result] = await Promise.all([
      refresh('manual'),
      refreshBenchmark('manual'),
    ])
    return result
  }, [refresh, refreshBenchmark])

  const prepareForMutation = useCallback(async (): Promise<void> => {
    mutationPausedRef.current = true

    const pending: Promise<unknown>[] = []
    if (activeRefreshRef.current) pending.push(activeRefreshRef.current)
    if (activeBenchmarkRef.current) pending.push(activeBenchmarkRef.current)

    invalidateActiveReads()
    if (pending.length) await Promise.all(pending)
    if (mountedRef.current) setRefreshing(false)
  }, [invalidateActiveReads])

  const refreshAfterMutation = useCallback(async (
    options: { includeBenchmark: boolean },
  ): Promise<RefreshResult> => {
    const result = await refresh('mutation')
    const succeeded = [...result.succeeded]
    const failed = [...result.failed]

    if (options.includeBenchmark) {
      const benchmarkSucceeded = await refreshBenchmark('mutation')
      if (benchmarkSucceeded) {
        succeeded.push('benchmark')
      } else {
        failed.push('benchmark')
      }
    } else {
      ++benchmarkSequenceRef.current
      activeBenchmarkControllerRef.current?.abort()
      benchmarkRef.current = null
      setBenchmark(null)
      setBenchmarkLoading(false)
      setBenchmarkRefreshing(false)
      setLastBenchmarkRefreshHadError(false)
      setEndpointErrors(previous => {
        const next = { ...previous }
        delete next.benchmark
        return next
      })
    }
    return { ...result, succeeded, failed }
  }, [refresh, refreshBenchmark])

  const finishMutation = useCallback(() => {
    mutationPausedRef.current = false
  }, [])

  const dismissError = useCallback((endpoint: DashboardEndpoint) => {
    setEndpointErrors(previous => {
      const next = { ...previous }
      delete next[endpoint]
      return next
    })
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void refresh('initial')
    void refreshBenchmark('initial')

    const pollInterval = window.setInterval(() => {
      void refresh('poll')
    }, 5_000)
    const clockInterval = window.setInterval(() => setClock(Date.now()), 5_000)

    return () => {
      mountedRef.current = false
      window.clearInterval(pollInterval)
      window.clearInterval(clockInterval)
      invalidateActiveReads(true)
    }
  }, [invalidateActiveReads, refresh, refreshBenchmark])

  const isStale = useMemo(() => {
    if (initialLoading) return false
    if (lastRefreshHadError) return true
    if (!lastUpdated) return true
    return clock - lastUpdated.getTime() > 15_000
  }, [clock, initialLoading, lastRefreshHadError, lastUpdated])

  const benchmarkUnhealthy = lastBenchmarkRefreshHadError || Boolean(endpointErrors.benchmark)
  const connectionState: ConnectionState = !initialLoading && !situation && endpointErrors.situation
    ? 'offline'
    : isStale || benchmarkUnhealthy
      ? 'stale'
      : initialLoading || benchmarkLoading || refreshing || benchmarkRefreshing
        ? 'refreshing'
        : 'connected'

  return {
    situation,
    resources,
    timeline,
    mapData,
    benchmark,
    endpointErrors,
    initialLoading,
    refreshing,
    benchmarkLoading,
    benchmarkRefreshing,
    lastUpdated,
    isStale,
    connectionState,
    dataRevision,
    refresh,
    refreshBenchmark,
    refreshAll,
    prepareForMutation,
    refreshAfterMutation,
    finishMutation,
    dismissError,
  }
}

export type DashboardDataController = ReturnType<typeof useDashboardData>
