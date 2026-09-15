import { useMemo, useState } from 'react'
import type { Resource } from '../../api'
import { AsyncState, SkeletonRows } from '../../components/AsyncState'
import { entityIcon, safeText, statusClass, titleCase } from '../../presentation'

interface ResourcesPanelProps {
  resources: Resource[]
  isLoading: boolean
  isStale: boolean
  error?: string
  onRetry: () => void
}

const knownStatuses = ['available', 'deployed', 'en_route', 'unavailable']

function normalizeStatus(status: string): string {
  return typeof status === 'string'
    ? status.trim().toLowerCase().replace(/[\s-]+/g, '_')
    : ''
}

function statusGroup(status: string): string {
  const normalized = normalizeStatus(status)
  return knownStatuses.includes(normalized) ? normalized : 'other'
}

export function ResourcesPanel({ resources, isLoading, isStale, error, onRetry }: ResourcesPanelProps) {
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')

  const types = useMemo(() => (
    [...new Set(resources.map(resource => resource.type).filter(Boolean))].sort()
  ), [resources])

  const visibleResources = useMemo(() => resources.filter(resource => {
    const matchesStatus = statusFilter === 'all' || statusGroup(resource.status) === statusFilter
    const matchesType = typeFilter === 'all' || resource.type === typeFilter
    return matchesStatus && matchesType
  }), [resources, statusFilter, typeFilter])

  const groups = useMemo(() => {
    const grouped = new Map<string, Resource[]>()
    for (const resource of visibleResources) {
      const group = statusGroup(resource.status)
      const existing = grouped.get(group)
      if (existing) existing.push(resource)
      else grouped.set(group, [resource])
    }
    return [...knownStatuses, 'other']
      .map(status => ({ status, resources: grouped.get(status) || [] }))
      .filter(group => group.resources.length)
  }, [visibleResources])

  const hasUnknownStatus = resources.some(resource => statusGroup(resource.status) === 'other')

  return (
    <section className="feature-panel resources-panel" aria-labelledby="resources-heading">
      <div className="panel-heading-row">
        <div>
          <p className="panel-eyebrow">Capacity</p>
          <h2 id="resources-heading">Response resources</h2>
        </div>
        <span className="count-badge">{resources.length}</span>
      </div>

      <div className="compact-filters" aria-label="Resource filters">
        <label htmlFor="resource-status-filter">
          Status
          <select id="resource-status-filter" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            {knownStatuses.map(status => <option key={status} value={status}>{titleCase(status)}</option>)}
            {hasUnknownStatus && <option value="other">Other / unknown</option>}
          </select>
        </label>
        <label htmlFor="resource-type-filter">
          Type
          <select id="resource-type-filter" value={typeFilter} onChange={event => setTypeFilter(event.target.value)}>
            <option value="all">All types</option>
            {types.map(type => <option key={type} value={type}>{titleCase(type)}</option>)}
          </select>
        </label>
      </div>

      {error && resources.length > 0 && (
        <AsyncState kind="stale" title="Resources may be stale" message={error} compact onRetry={onRetry} />
      )}
      {!error && isStale && resources.length > 0 && (
        <AsyncState kind="stale" title="Showing last known resources" compact onRetry={onRetry} />
      )}

      <div className="panel-scroll">
        {isLoading && !resources.length ? (
          <>
            <span className="sr-only" role="status">Loading response resources</span>
            <SkeletonRows count={4} />
          </>
        ) : error && !resources.length ? (
          <AsyncState kind="error" title="Resources unavailable" message={error} onRetry={onRetry} />
        ) : !visibleResources.length ? (
          <AsyncState
            kind="empty"
            title={resources.length ? 'No resources match these filters' : 'No resources reported'}
            message={resources.length ? 'Change a status or type filter to see more resources.' : 'The operation has not reported any response resources.'}
          />
        ) : (
          <div className="resource-groups">
            {groups.map(group => (
              <section key={group.status} aria-labelledby={`resource-group-${group.status}`}>
                <h3 id={`resource-group-${group.status}`}>
                  {group.status === 'other' ? 'Other / unknown status' : titleCase(group.status)}
                  <span>{group.resources.length}</span>
                </h3>
                <ul className="resource-list">
                  {group.resources.map(resource => (
                    <li key={resource.id}>
                      <span className="resource-icon" aria-hidden="true">{entityIcon(resource.type)}</span>
                      <div>
                        <strong>{safeText(resource.name, resource.id)}</strong>
                        <p>{titleCase(resource.type)} · {resource.location_id ? `At ${resource.location_id}` : 'Location unknown'}</p>
                        <p>{resource.capabilities?.length ? resource.capabilities.join(', ') : 'No capabilities listed'}</p>
                      </div>
                      <span className={`status-tag ${statusClass(resource.status)}`}>{titleCase(resource.status)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
