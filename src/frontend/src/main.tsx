import './index.css'
import App from './App'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('Root element not found. Ensure index.html contains <div id="root"></div>.')
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
