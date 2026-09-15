import type { MapLayerId } from './mapUtils'

export type MapLayerVisibility = Record<MapLayerId, boolean>

interface MapLayersPanelProps {
  visibility: MapLayerVisibility
  onToggle: (layer: MapLayerId) => void
}

const layers: { id: MapLayerId; label: string; description: string }[] = [
  { id: 'assets', label: 'Critical assets', description: 'Hospitals, shelters, villages, and facilities' },
  { id: 'roads', label: 'Road network', description: 'Open, restricted, and blocked route segments' },
  { id: 'bridges', label: 'Bridges', description: 'Bridge status and structural risk' },
  { id: 'resources', label: 'Resources', description: 'Teams, vehicles, and medical units' },
]

export function MapLayersPanel({ visibility, onToggle }: MapLayersPanelProps) {
  return (
    <details className="map-tool map-layers" open>
      <summary>Visible layers</summary>
      <fieldset>
        <legend className="sr-only">Choose map layers</legend>
        {layers.map(layer => (
          <label key={layer.id}>
            <input
              type="checkbox"
              checked={visibility[layer.id]}
              onChange={() => onToggle(layer.id)}
            />
            <span><b>{layer.label}</b><small>{layer.description}</small></span>
          </label>
        ))}
      </fieldset>
    </details>
  )
}
