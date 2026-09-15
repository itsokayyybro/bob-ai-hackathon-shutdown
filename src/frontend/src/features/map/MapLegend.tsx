export function MapLegend() {
  return (
    <details className="map-tool map-legend" open>
      <summary>Map legend</summary>
      <div className="legend-sections">
        <section>
          <h3>Marker fill · priority</h3>
          <ul>
            <li><span className="legend-swatch fill-high" />High</li>
            <li><span className="legend-swatch fill-medium" />Medium</li>
            <li><span className="legend-swatch fill-low" />Low</li>
            <li><span className="legend-swatch fill-none" />Not prioritized</li>
          </ul>
        </section>
        <section>
          <h3>Marker outline · status</h3>
          <ul>
            <li><span className="legend-swatch outline-operational" />Operational / open</li>
            <li><span className="legend-swatch outline-warning" />Damaged / at risk</li>
            <li><span className="legend-swatch outline-blocked" />Blocked / unavailable</li>
            <li><span className="legend-ring" />Selected object</li>
          </ul>
        </section>
        <section>
          <h3>Routes</h3>
          <ul>
            <li><span className="legend-line" />Open or restricted road</li>
            <li><span className="legend-line is-blocked" />Blocked road</li>
          </ul>
        </section>
      </div>
    </details>
  )
}
