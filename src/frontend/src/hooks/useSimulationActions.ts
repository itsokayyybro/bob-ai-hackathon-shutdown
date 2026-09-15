import { useCallback, useRef, useState } from 'react'
import { dashboardApi, getErrorMessage } from '../api'
import type { InjectEventInput, InjectEventPayload } from '../api'
import type { RefreshResult } from './useDashboardData'

export type SimulationAction = 'next' | 'auto' | 'reset' | 'inject'
export type ActionFeedback = {
  type: 'success' | 'error' | 'warning'
  action: SimulationAction
  message: string
}

interface MutationCoordinator {
  prepareForMutation: () => Promise<void>
  refreshAfterMutation: (options: { includeBenchmark: boolean }) => Promise<RefreshResult>
  finishMutation: () => void
}

const actionLabels: Record<SimulationAction, string> = {
  next: 'Next event',
  auto: 'Auto play',
  reset: 'Reset',
  inject: 'Event injection',
}

export function useSimulationActions(coordinator: MutationCoordinator) {
  const [pendingAction, setPendingAction] = useState<SimulationAction | null>(null)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  const pendingRef = useRef<SimulationAction | null>(null)

  const runAction = useCallback(async (
    action: SimulationAction,
    mutation: () => Promise<unknown>,
    includeBenchmark: boolean,
  ): Promise<void> => {
    if (pendingRef.current) return

    pendingRef.current = action
    setPendingAction(action)
    setFeedback(null)

    try {
      await coordinator.prepareForMutation()
      try {
        await mutation()
      } catch (mutationError) {
        await coordinator.refreshAfterMutation({ includeBenchmark: true })
        throw mutationError
      }
      const refreshResult = await coordinator.refreshAfterMutation({ includeBenchmark })
      if (refreshResult.failed.length) {
        setFeedback({
          type: 'warning',
          action,
          message: `${actionLabels[action]} completed, but ${refreshResult.failed.length} panel${refreshResult.failed.length === 1 ? '' : 's'} could not refresh.`,
        })
      } else {
        setFeedback({
          type: 'success',
          action,
          message: `${actionLabels[action]} completed successfully.`,
        })
      }
    } catch (error) {
      setFeedback({
        type: 'error',
        action,
        message: `${actionLabels[action]} failed: ${getErrorMessage(error)}`,
      })
    } finally {
      coordinator.finishMutation()
      pendingRef.current = null
      setPendingAction(null)
    }
  }, [coordinator])

  const processNext = useCallback(() => runAction(
    'next',
    () => dashboardApi.processNextEvent(),
    true,
  ), [runAction])

  const autoPlay = useCallback(() => runAction(
    'auto',
    () => dashboardApi.autoPlay(),
    true,
  ), [runAction])

  const reset = useCallback(() => runAction(
    'reset',
    () => dashboardApi.resetSimulation(),
    false,
  ), [runAction])

  const inject = useCallback((event: InjectEventInput) => {
    const payload: InjectEventPayload = {
      ...event,
      source_type: 'field_report',
      metadata: {},
    }
    return runAction('inject', () => dashboardApi.injectEvent(payload), true)
  }, [runAction])

  const clearFeedback = useCallback(() => setFeedback(null), [])

  return {
    pendingAction,
    feedback,
    processNext,
    autoPlay,
    reset,
    inject,
    clearFeedback,
  }
}

export type SimulationActionsController = ReturnType<typeof useSimulationActions>
