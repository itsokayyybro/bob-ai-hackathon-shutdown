import type { BenchmarkResult } from '../../api'
import { AsyncState } from '../../components/AsyncState'
import { finiteNumber, formatNumber, formatPercent } from '../../presentation'

interface MetricsPanelProps {
  benchmark: BenchmarkResult | null
  simulationMinutes: number
  isLoading: boolean
  isRefreshing: boolean
  error?: string
  onRetry: () => void
}

function recordNumber(record: Record<string, unknown> | undefined, key: string): number | null {
  return finiteNumber(record?.[key])
}

export function MetricsPanel({ benchmark, simulationMinutes, isLoading, isRefreshing, error, onRetry }: MetricsPanelProps) {
  const aiCoverage = recordNumber(benchmark?.ai_system, 'coverage_rate')
  const baselineCoverage = recordNumber(benchmark?.baseline, 'coverage_rate')
  const travelMinutes = recordNumber(benchmark?.ai_system, 'total_travel_time_min')
  const travelReduction = recordNumber(benchmark?.improvements, 'travel_time_reduction_pct')
  const conflictsDetected = recordNumber(benchmark?.improvements, 'conflicts_detected')
  const confidence = recordNumber(benchmark?.ai_system, 'decision_confidence_avg')

  return (
    <section className="feature-panel metrics-panel" aria-labelledby="metrics-heading">
      <div className="panel-heading-row">
        <div>
          <p className="panel-eyebrow">T+{Math.max(0, simulationMinutes)} minutes</p>
          <h2 id="metrics-heading">Response benchmark</h2>
        </div>
        {isRefreshing && benchmark && (
          <span className="state-chip is-refreshing" role="status">Refreshing benchmark…</span>
        )}
      </div>

      {isLoading && !benchmark ? (
        <AsyncState kind="loading" title="Loading benchmark" />
      ) : error && !benchmark ? (
        <AsyncState kind="error" title="Benchmark unavailable" message={error} onRetry={onRetry} />
      ) : !benchmark ? (
        <AsyncState kind="empty" title="No benchmark result yet" message="Process a simulation event to compare AI-assisted and baseline response plans." />
      ) : (
        <>
          {error && <AsyncState kind="stale" title="Showing the last benchmark" message={error} compact onRetry={onRetry} />}
          <dl className="metric-grid">
            <div className={aiCoverage !== null && aiCoverage >= 0.8 ? 'is-good' : 'is-warning'} title="Share of affected locations covered by the AI-assisted response plan">
              <dt>AI coverage</dt><dd>{formatPercent(aiCoverage)}</dd><span>affected locations</span>
            </div>
            <div className={baselineCoverage !== null && baselineCoverage >= 0.8 ? 'is-good' : 'is-warning'} title="Share of affected locations covered by the baseline plan">
              <dt>Baseline coverage</dt><dd>{formatPercent(baselineCoverage)}</dd><span>affected locations</span>
            </div>
            <div title="Estimated total travel time for the AI-assisted plan">
              <dt>AI travel time</dt><dd>{formatNumber(travelMinutes, 0)}</dd><span>minutes total</span>
            </div>
            <div className={travelReduction !== null && travelReduction > 0 ? 'is-good' : 'is-warning'} title="Percentage reduction in travel time compared with baseline">
              <dt>Travel reduction</dt><dd>{formatNumber(travelReduction, 1, '%')}</dd><span>versus baseline</span>
            </div>
            <div className="is-warning" title="Evidence conflicts surfaced by the AI system">
              <dt>Conflicts surfaced</dt><dd>{formatNumber(conflictsDetected)}</dd><span>evidence conflicts</span>
            </div>
            <div className={confidence !== null && confidence >= 0.7 ? 'is-good' : 'is-warning'} title="Average confidence of AI-assisted decisions">
              <dt>Decision confidence</dt><dd>{formatPercent(confidence)}</dd><span>average confidence</span>
            </div>
          </dl>
          {benchmark.methodology && (
            <details className="methodology-note">
              <summary>Benchmark methodology</summary>
              <p>{benchmark.methodology}</p>
            </details>
          )}
        </>
      )}
    </section>
  )
}
