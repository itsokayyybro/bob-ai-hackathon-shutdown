import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

export type AsyncStateKind = 'loading' | 'empty' | 'error' | 'stale' | 'success'

interface AsyncStateProps {
  kind: AsyncStateKind
  title: string
  message?: string
  compact?: boolean
  onRetry?: () => void
}

export function AsyncState({ kind, title, message, compact = false, onRetry }: AsyncStateProps) {
  const liveRole = kind === 'error' ? 'alert' : kind === 'loading' || kind === 'success' ? 'status' : undefined
  return (
    <div className={`async-state is-${kind}${compact ? ' is-compact' : ''}`} role={liveRole}>
      {kind === 'loading' && <span className="async-spinner" aria-hidden="true" />}
      <div>
        <strong>{title}</strong>
        {message && <p>{message}</p>}
      </div>
      {onRetry && (
        <button type="button" className="text-button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}

export function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div className="skeleton-list" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton-row" key={index}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  )
}

interface AppErrorBoundaryState {
  error: Error | null
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Dashboard render failed:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <main className="fatal-error" id="dashboard-workspace">
        <div className="fatal-error-card" role="alert">
          <p className="panel-eyebrow">Application error</p>
          <h1>The operations dashboard could not render</h1>
          <p>{this.state.error.message || 'An unexpected frontend error occurred.'}</p>
          <button type="button" className="button button-primary" onClick={() => window.location.reload()}>
            Reload dashboard
          </button>
        </div>
      </main>
    )
  }
}
