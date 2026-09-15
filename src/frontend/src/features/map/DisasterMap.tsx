import { Fragment, useMemo, useRef, useState } from 'react'
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { MapData } from '../../api'
import { AsyncState } from '../../components/AsyncState'
import { clampUnit, finiteNumber, formatNumber, formatPercent, titleCase } from '../../presentation'
import { MapLayersPanel } from './MapLayersPanel'
import type { MapLayerVisibility } from './MapLayersPanel'
import { MapLegend } from './MapLegend'
import { MapViewportController } from './MapViewportController'
import {
  parseMapFeatures,
  priorityFill,
  statusColor,
} from './mapUtils'
import type { MapLayerId } from './mapUtils'

interface DisasterMapProps {
  mapData: MapData | null
  priorities: Record<string, number>
  selectedId: string | null
  isLoading: boolean
  isStale: boolean
  error?: string
  layoutRevision: string
  focusRequest: number
  onSelect: (id: string) => void
  onRetry: () => void
}

const initialVisibility: MapLayerVisibility = {
  assets: true,
  roads: true,
  bridges: true,
  resources: true,
}

function MappedObjectList({
  points,
  selectedId,
  onSelect,
}: {
  points: ReturnType<typeof parseMapFeatures>['points']
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const selectablePoints = points
    .filter(point => point.id)
    .toSorted((left, right) => left.name.localeCompare(right.name))

  return (
    <details className="map-tool mapped-object-list">
      <summary>Mapped objects ({selectablePoints.length})</summary>
      {selectablePoints.length ? (
        <ul>
          {selectablePoints.map(point => (
            <li key={point.key}>
              <button
                type="button"
                className={point.id === selectedId ? 'is-selected' : ''}
                aria-current={point.id === selectedId ? 'true' : undefined}
                onClick={() => point.id && onSelect(point.id)}
              >
                <span>{point.name}</span>
                <small>{titleCase(point.type)} · {titleCase(point.status)}</small>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>No selectable mapped objects.</p>
      )}
    </details>
  )
}

export function DisasterMap({
  mapData,
  priorities,
  selectedId,
  isLoading,
  isStale,
  error,
  layoutRevision,
  focusRequest,
  onSelect,
  onRetry,
}: DisasterMapProps) {
  const [visibility, setVisibility] = useState<MapLayerVisibility>(initialVisibility)
  const [tileState, setTileState] = useState<'loading' | 'ready' | 'error'>('loading')
  const tileErrorRef = useRef(false)
  const [resetRequest, setResetRequest] = useState(0)
  const parsed = useMemo(() => parseMapFeatures(mapData?.features), [mapData])
  const allPositions = useMemo(() => [
    ...parsed.points.map(point => point.position),
    ...parsed.lines.flatMap(line => line.positions),
  ], [parsed.lines, parsed.points])
  const selectedPosition = parsed.points.find(point => point.id === selectedId)?.position || null

  const toggleLayer = (layer: MapLayerId) => {
    setVisibility(current => ({ ...current, [layer]: !current[layer] }))
  }

  return (
    <section className="feature-panel map-panel" aria-labelledby="map-heading">
      <div className="panel-heading-row map-heading-row">
        <div>
          <p className="panel-eyebrow">Common operating picture</p>
          <h2 id="map-heading" tabIndex={-1}>Incident map</h2>
        </div>
        <div className="map-heading-actions">
          <span className={`tile-state is-${tileState}`}>
            {tileState === 'loading' ? 'Loading basemap' : tileState === 'error' ? 'Basemap unavailable' : 'Basemap ready'}
          </span>
          <button type="button" className="button button-secondary" onClick={() => setResetRequest(value => value + 1)} disabled={!allPositions.length}>
            Reset view
          </button>
        </div>
      </div>

      <div className="map-region-content">
        <div className="map-stage">
          <MapContainer
            center={[28.11, 85.705]}
            zoom={12}
            className="leaflet-map"
            preferCanvas
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
              eventHandlers={{
                loading: () => {
                  tileErrorRef.current = false
                  setTileState('loading')
                },
                load: () => setTileState(tileErrorRef.current ? 'error' : 'ready'),
                tileerror: () => {
                  tileErrorRef.current = true
                  setTileState('error')
                },
              }}
            />

            {visibility.roads && parsed.lines.map(line => {
              const color = statusColor(line.status)
              const blocked = ['blocked', 'destroyed'].includes(line.status.toLowerCase())
              return (
                <Polyline
                  key={line.key}
                  positions={line.positions}
                  pathOptions={{
                    color,
                    weight: blocked ? 4 : 3,
                    opacity: blocked ? 0.95 : 0.72,
                    dashArray: blocked ? '8 6' : undefined,
                  }}
                >
                  <Popup>
                    <strong>{line.name}</strong><br />
                    Status: {titleCase(line.status)}<br />
                    {finiteNumber(line.properties.distance_km) !== null && <>{formatNumber(line.properties.distance_km, 1)} km<br /></>}
                    {finiteNumber(line.properties.travel_time_min) !== null && <>{formatNumber(line.properties.travel_time_min)} min travel<br /></>}
                    {finiteNumber(line.properties.risk) !== null && <>Risk: {formatPercent(line.properties.risk)}</>}
                  </Popup>
                </Polyline>
              )
            })}

            {parsed.points.map(point => {
              if (!visibility[point.kind]) return null
              const priority = point.id ? clampUnit(priorities[point.id]) : 0
              const fillColor = priority > 0 ? priorityFill(priority) : '#475569'
              const borderColor = statusColor(point.status)
              const baseRadius = point.kind === 'resources' ? 7 : point.kind === 'bridges' ? 9 : 9 + priority * 8
              const selected = point.id === selectedId

              return (
                <Fragment key={point.key}>
                  {selected && (
                    <CircleMarker
                      center={point.position}
                      radius={baseRadius + 6}
                      pathOptions={{ color: '#f8fafc', fillOpacity: 0, weight: 3, opacity: 1 }}
                      interactive={false}
                    />
                  )}
                  <CircleMarker
                    center={point.position}
                    radius={baseRadius}
                    pathOptions={{
                      color: borderColor,
                      fillColor,
                      fillOpacity: 0.88,
                      weight: 3,
                      opacity: 1,
                    }}
                    eventHandlers={point.id ? { click: () => point.id && onSelect(point.id) } : undefined}
                  >
                    <Popup>
                      <strong>{point.name}</strong><br />
                      Type: {titleCase(point.type)}<br />
                      Status: {titleCase(point.status)}
                      {finiteNumber(point.properties.population) !== null && <><br />Population: {finiteNumber(point.properties.population)?.toLocaleString()}</>}
                      {priority > 0 && <><br />Priority: {priority.toFixed(3)}</>}
                      {finiteNumber(point.properties.confidence) !== null && <><br />Confidence: {formatPercent(point.properties.confidence)}</>}
                      {point.properties.conflict_status === 'conflicting' && <><br /><b>Conflicting evidence</b></>}
                    </Popup>
                  </CircleMarker>
                </Fragment>
              )
            })}

            <MapViewportController
              positions={allPositions}
              selectedPosition={selectedPosition}
              resetRequest={resetRequest}
              focusRequest={focusRequest}
              layoutRevision={layoutRevision}
            />
          </MapContainer>

          <div className="map-notices" aria-live="polite">
            {isLoading && !mapData && <AsyncState kind="loading" title="Loading incident features" compact />}
            {error && !mapData && <AsyncState kind="error" title="Map data unavailable" message={error} compact onRetry={onRetry} />}
            {error && mapData && <AsyncState kind="stale" title="Map features may be stale" message={error} compact onRetry={onRetry} />}
            {!error && isStale && mapData && <AsyncState kind="stale" title="Showing last known map features" compact onRetry={onRetry} />}
            {!isLoading && mapData && !parsed.points.length && !parsed.lines.length && (
              <AsyncState kind="empty" title="No valid map features" message="List and detail views remain available." compact />
            )}
            {parsed.invalidCount > 0 && (
              <div className="map-warning" role="status">
                Skipped {parsed.invalidCount} malformed map feature{parsed.invalidCount === 1 ? '' : 's'}.
              </div>
            )}
            {tileState === 'error' && (
              <div className="map-warning" role="status">
                Basemap tiles could not load. Operational markers and non-map panels remain available.
              </div>
            )}
          </div>
        </div>

        <div className="map-support" aria-label="Map tools">
          <MapLayersPanel visibility={visibility} onToggle={toggleLayer} />
          <MapLegend />
          <MappedObjectList points={parsed.points} selectedId={selectedId} onSelect={onSelect} />
        </div>
      </div>
    </section>
  )
}
