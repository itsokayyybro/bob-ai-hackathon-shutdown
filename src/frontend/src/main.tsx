import './index.css'
import App from './App'
import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Root render error:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <main className="root-error">
          <h1>Emergency Operations Center could not render</h1>
          <p>{this.state.error.message || 'Unexpected frontend error.'}</p>
          <button className="btn primary" onClick={() => window.location.reload()}>
            Reload dashboard
          </button>
        </main>
      )
    }

    return this.props.children
  }
}

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('Root element not found. Ensure index.html contains <div id="root"></div>.')
}

createRoot(rootEl).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
)
