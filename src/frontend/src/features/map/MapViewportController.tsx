import { useCallback, useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import type { MapPosition } from './mapUtils'

interface MapViewportControllerProps {
  positions: MapPosition[]
  selectedPosition: MapPosition | null
  resetRequest: number
  focusRequest: number
  layoutRevision: string
}

export function MapViewportController({
  positions,
  selectedPosition,
  resetRequest,
  focusRequest,
  layoutRevision,
}: MapViewportControllerProps) {
  const map = useMap()
  const didInitialFitRef = useRef(false)
  const previousResetRef = useRef(resetRequest)
  const previousFocusRef = useRef(focusRequest)

  const containerCanRender = useCallback(() => {
    const container = map.getContainer()
    return container.clientWidth > 64 && container.clientHeight > 64
  }, [map])

  const fitAll = useCallback(() => {
    if (!positions.length || !containerCanRender()) return false
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    map.fitBounds(positions, {
      padding: [32, 32],
      maxZoom: 14,
      animate: !reduceMotion,
    })
    return true
  }, [containerCanRender, map, positions])

  const fitPendingBounds = useCallback(() => {
    const initialFitPending = !didInitialFitRef.current
    const resetPending = previousResetRef.current !== resetRequest
    if ((!initialFitPending && !resetPending) || !fitAll()) return
    if (initialFitPending) didInitialFitRef.current = true
    if (resetPending) previousResetRef.current = resetRequest
  }, [fitAll, resetRequest])

  const focusSelection = useCallback(() => {
    if (previousFocusRef.current === focusRequest || !selectedPosition || !containerCanRender()) return
    previousFocusRef.current = focusRequest
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    map.setView(selectedPosition, Math.max(map.getZoom(), 14), { animate: !reduceMotion })
  }, [containerCanRender, focusRequest, map, selectedPosition])

  useEffect(() => {
    fitPendingBounds()
  }, [fitPendingBounds])

  useEffect(() => {
    focusSelection()
  }, [focusSelection])

  useEffect(() => {
    const refreshViewport = () => {
      map.invalidateSize({ pan: false })
      fitPendingBounds()
      focusSelection()
    }
    const frame = window.requestAnimationFrame(refreshViewport)
    const timer = window.setTimeout(refreshViewport, 180)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [fitPendingBounds, focusSelection, layoutRevision, map])

  useEffect(() => {
    const container = map.getContainer()
    const refreshViewport = () => {
      map.invalidateSize({ pan: false })
      fitPendingBounds()
      focusSelection()
    }
    const observer = new ResizeObserver(refreshViewport)
    observer.observe(container)
    window.addEventListener('orientationchange', refreshViewport)
    return () => {
      observer.disconnect()
      window.removeEventListener('orientationchange', refreshViewport)
    }
  }, [fitPendingBounds, focusSelection, map])

  return null
}
