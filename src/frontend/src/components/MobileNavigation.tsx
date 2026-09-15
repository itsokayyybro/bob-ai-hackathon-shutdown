export type MobileView = 'overview' | 'map' | 'detail' | 'actions'

interface MobileNavigationProps {
  activeView: MobileView
  onChange: (view: MobileView) => void
  hasSelection: boolean
}

const items: { id: MobileView; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'map', label: 'Map' },
  { id: 'detail', label: 'Detail' },
  { id: 'actions', label: 'Actions' },
]

export function MobileNavigation({ activeView, onChange, hasSelection }: MobileNavigationProps) {
  return (
    <nav className="mobile-navigation" aria-label="Dashboard sections">
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          className={activeView === item.id ? 'is-active' : ''}
          aria-current={activeView === item.id ? 'page' : undefined}
          onClick={() => onChange(item.id)}
        >
          <span>{item.label}</span>
          {item.id === 'detail' && hasSelection && <span className="nav-notification" aria-label="Entity selected" />}
        </button>
      ))}
    </nav>
  )
}
