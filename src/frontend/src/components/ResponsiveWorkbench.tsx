import { useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

export interface WorkbenchTab {
  id: string
  label: string
  content: ReactNode
  badge?: number
}

interface ResponsiveWorkbenchProps {
  tabs: WorkbenchTab[]
  activeTab: string
  onTabChange: (tab: string) => void
}

export function ResponsiveWorkbench({ tabs, activeTab, onTabChange }: ResponsiveWorkbenchProps) {
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  const selectedTabId = tabs.some(tab => tab.id === activeTab) ? activeTab : tabs[0]?.id

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    if (!tabs.length) return

    let nextIndex: number
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (currentIndex + 1) % tabs.length
        break
      case 'ArrowLeft':
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = tabs.length - 1
        break
      default:
        return
    }

    event.preventDefault()
    const nextTab = tabs[nextIndex]
    onTabChange(nextTab.id)
    tabRefs.current.get(nextTab.id)?.focus()
  }

  return (
    <aside className="workbench" aria-label="Operational tools">
      <div className="workbench-tabs" role="tablist" aria-label="Operational tools" aria-orientation="horizontal">
        {tabs.map((tab, index) => {
          const selected = selectedTabId === tab.id
          return (
            <button
              key={tab.id}
              ref={element => {
                if (element) tabRefs.current.set(tab.id, element)
                else tabRefs.current.delete(tab.id)
              }}
              id={`workbench-tab-${tab.id}`}
              type="button"
              role="tab"
              tabIndex={selected ? 0 : -1}
              aria-selected={selected}
              aria-controls={`workbench-panel-${tab.id}`}
              className={selected ? 'is-active' : ''}
              onClick={() => onTabChange(tab.id)}
              onKeyDown={event => handleKeyDown(event, index)}
            >
              {tab.label}
              {typeof tab.badge === 'number' && <span className="tab-badge">{tab.badge}</span>}
            </button>
          )
        })}
      </div>
      <div className="workbench-panels">
        {tabs.map(tab => (
          <div
            key={tab.id}
            id={`workbench-panel-${tab.id}`}
            role="tabpanel"
            aria-labelledby={`workbench-tab-${tab.id}`}
            className="workbench-panel"
            hidden={selectedTabId !== tab.id}
          >
            {tab.content}
          </div>
        ))}
      </div>
    </aside>
  )
}
