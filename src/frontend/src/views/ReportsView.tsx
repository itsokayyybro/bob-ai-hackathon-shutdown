import { useMemo } from 'react';
import { Card, Chip } from '../components/Card.tsx';
import { Reports } from '../components/Reports.tsx';
import { api } from '../lib/api.ts';
import { useFetch } from '../lib/useConsole.ts';
import {
  accessLabel,
  informationLabel,
  needLabel,
  placeKind,
  roadStatusSentence,
  statusSentence,
  urgencyLabel,
} from '../lib/explain.ts';
import type { ConsoleState } from '../lib/useConsole.ts';

interface Subject {
  id: string;
  name: string;
  kind: string;
  needsAttention: boolean;
  note: string;
}

/**
 * Where the evidence lives. Pick a subject, read what was reported about it and
 * how much of that the system still believes.
 */
export function ReportsView({
  state,
  selectedId,
  onSelect,
}: {
  state: ConsoleState;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { entities, priorities, situation } = state;

  const subjects = useMemo<Subject[]>(() => {
    if (!entities) return [];

    const bridges: Subject[] = entities.bridges.map((bridge) => ({
      id: bridge.id,
      name: bridge.name,
      kind: 'Crossing',
      needsAttention: bridge.conflict_status === 'conflicting' || bridge.status === 'blocked',
      note:
        bridge.conflict_status === 'conflicting'
          ? 'Reports disagree'
          : roadStatusSentence(bridge.status),
    }));

    const places: Subject[] = entities.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      kind: capitalise(placeKind(asset.type)),
      needsAttention: asset.status !== 'operational',
      note:
        asset.status !== 'operational'
          ? capitalise(statusSentence(asset))
          : asset.population > 0
            ? `${asset.population.toLocaleString('en-US')} people`
            : 'Working normally',
    }));

    const roads: Subject[] = entities.roads.map((road) => ({
      id: road.id,
      name: road.name,
      kind: 'Road',
      needsAttention: road.status !== 'open',
      note: roadStatusSentence(road.status),
    }));

    return [...bridges, ...places, ...roads].sort(
      (a, b) => Number(b.needsAttention) - Number(a.needsAttention),
    );
  }, [entities]);

  const active = selectedId ?? subjects[0]?.id ?? null;
  const subject = subjects.find((s) => s.id === active) ?? null;
  const priority = priorities.find((p) => p.entity_id === active) ?? null;

  const evidence = useFetch(
    () => (active ? api.evidence(active) : Promise.resolve(null)),
    [active, state.lastSync],
  );

  const flagged = subjects.filter((s) => s.needsAttention).length;

  return (
    <div className="reports-view">
      <Card title="Subjects" padded={false}>
        <p className="subjects-note fine">
          {flagged} of {subjects.length} need attention. Those are listed first.
        </p>
        <ul className="subjects">
          {subjects.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="subject"
                data-active={item.id === active ? 'true' : undefined}
                data-flagged={item.needsAttention ? 'true' : undefined}
                onClick={() => onSelect(item.id)}
              >
                <span className="subject-name">{item.name}</span>
                <span className="fine subject-note">
                  {item.kind} · {item.note}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <div className="stack">
        <Card title={subject ? subject.name : 'Select a subject'}>
          {subject && (
            <p className="summary">
              {subject.kind}. {subject.note}.
              {situation?.evidence_conflicts.some((c) => c.includes(subject.name)) &&
                ' Our sources do not agree about it, so confidence is low.'}
            </p>
          )}

          {priority && (
            <ul className="readings">
              <Reading label="Need" value={needLabel(priority.criticality_score)} />
              <Reading label="Trend" value={urgencyLabel(priority.urgency_score)} />
              <Reading
                label="Getting there"
                value={accessLabel(priority.accessibility_factor)}
                tone={priority.accessibility_factor <= 0 ? 'critical' : undefined}
              />
              <Reading
                label="What we know"
                value={informationLabel(priority.confidence_factor)}
                tone={priority.confidence_factor < 0.3 ? 'caution' : undefined}
              />
            </ul>
          )}
        </Card>

        <Card title="What we were told">
          {evidence.loading && <p className="empty">Loading reports…</p>}
          {evidence.error && <p className="error-text">{evidence.error}</p>}
          {!evidence.loading && !evidence.error && evidence.data && (
            <Reports bundle={evidence.data} />
          )}
        </Card>
      </div>
    </div>
  );
}

function Reading({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'critical' | 'caution';
}) {
  return (
    <li className="reading">
      <span className="label">{label}</span>
      {tone ? <Chip tone={tone}>{value}</Chip> : <span className="reading-value">{value}</span>}
    </li>
  );
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
