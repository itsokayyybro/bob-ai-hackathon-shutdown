import { useCallback, useEffect, useRef, useState } from 'react'
import { dashboardApi, getErrorMessage, isAbortError } from '../api'
import type { EvidenceSummary, RawObservation } from '../api'

export type EvidenceStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error'

interface EntityEvidenceState {
  entityId: string | null
  evidence: EvidenceSummary[]
  observations: RawObservation[]
  status: EvidenceStatus
  error: string | null
}

const idleState: EntityEvidenceState = {
  entityId: null,
  evidence: [],
  observations: [],
  status: 'idle',
  error: null,
}

function loadingState(entityId: string): EntityEvidenceState {
  return {
    entityId,
    evidence: [],
    observations: [],
    status: 'loading',
    error: null,
  }
}

export function useEntityEvidence(
  entityId: string | null,
  dataRevision: number,
  suspended = false,
) {
  const [state, setState] = useState<EntityEvidenceState>(idleState)
  const [retryCount, setRetryCount] = useState(0)
  const requestSequenceRef = useRef(0)

  const invalidateRequest = useCallback((controller?: AbortController) => {
    ++requestSequenceRef.current
    controller?.abort()
  }, [])

  useEffect(() => {
    const requestId = ++requestSequenceRef.current

    if (!entityId) {
      queueMicrotask(() => {
        if (requestId === requestSequenceRef.current) setState(idleState)
      })
      return () => invalidateRequest()
    }

    if (suspended) {
      queueMicrotask(() => {
        if (requestId === requestSequenceRef.current) setState(loadingState(entityId))
      })
      return () => invalidateRequest()
    }

    const controller = new AbortController()
    queueMicrotask(() => {
      if (requestId === requestSequenceRef.current) setState(loadingState(entityId))
    })

    void dashboardApi.getEvidence(entityId, controller.signal)
      .then(response => {
        if (requestId !== requestSequenceRef.current) return
        const evidence = Array.isArray(response.evidence_summaries) ? response.evidence_summaries : []
        const observations = Array.isArray(response.raw_observations) ? response.raw_observations : []
        setState({
          entityId,
          evidence,
          observations,
          status: evidence.length || observations.length ? 'success' : 'empty',
          error: null,
        })
      })
      .catch(error => {
        if (requestId !== requestSequenceRef.current || isAbortError(error)) return
        setState({
          entityId,
          evidence: [],
          observations: [],
          status: 'error',
          error: getErrorMessage(error),
        })
      })

    return () => invalidateRequest(controller)
  }, [dataRevision, entityId, invalidateRequest, retryCount, suspended])

  const retry = useCallback(() => setRetryCount(count => count + 1), [])
  const visibleState: EntityEvidenceState = suspended && entityId
    ? loadingState(entityId)
    : entityId === state.entityId
      ? state
      : entityId
        ? loadingState(entityId)
        : idleState

  return { ...visibleState, retry }
}

export type EntityEvidenceController = ReturnType<typeof useEntityEvidence>
