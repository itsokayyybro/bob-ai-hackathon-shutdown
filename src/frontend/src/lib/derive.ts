/**
 * Everything the Overview shows, derived from real API responses.
 *
 * The headline figures deliberately partition the affected population into three
 * buckets that add up to the total, so the numbers can be checked against each
 * other and none of them is a vanity metric.
 */
import type {
  Asset,
  AuditRecord,
  Bridge,
  PriorityScore,
  Resource,
  Road,
  SimEvent,
  Situation,
  Task,
} from './types.ts';
import { placeKind, statusSentence, teamKind } from './explain.ts';

export interface Headline {
  cannotReach: number;
  needsConfirming: number;
  reachable: number;
  totalPeople: number;
  placesInTrouble: number;
  totalPlaces: number;
  roadsCut: number;
  bridgesClosed: number;
  teamsReady: number;
  teamsTotal: number;
  conflicts: number;
  damage: 'Severe' | 'Moderate' | 'Limited';
}

export function headline(
  assets: Asset[],
  roads: Road[],
  bridges: Bridge[],
  resources: Resource[],
  priorities: PriorityScore[],
  situation: Situation,
): Headline {
  const byId = new Map(priorities.map((p) => [p.entity_id, p]));

  let cannotReach = 0;
  let needsConfirming = 0;
  let reachable = 0;

  for (const asset of assets) {
    if (asset.population <= 0) continue;
    const priority = byId.get(asset.id);
    // No priority record means nothing has flagged it; treat as reachable.
    if (!priority) {
      reachable += asset.population;
    } else if (priority.accessibility_factor <= 0) {
      cannotReach += asset.population;
    } else if (priority.confidence_factor < 0.3) {
      needsConfirming += asset.population;
    } else {
      reachable += asset.population;
    }
  }

  const roadsCut = roads.filter((r) => r.status === 'blocked').length;
  const bridgesClosed = bridges.filter((b) => b.status === 'blocked').length;
  const placesInTrouble = assets.filter((a) => a.status !== 'operational').length;
  const teamsReady = resources.filter((r) => r.status === 'available').length;

  const cutShare = roads.length > 0 ? roadsCut / roads.length : 0;
  const reachShare = cannotReach / Math.max(1, cannotReach + needsConfirming + reachable);
  const damage: Headline['damage'] =
    reachShare > 0.35 || cutShare > 0.2 ? 'Severe' : reachShare > 0.1 ? 'Moderate' : 'Limited';

  return {
    cannotReach,
    needsConfirming,
    reachable,
    totalPeople: cannotReach + needsConfirming + reachable,
    placesInTrouble,
    totalPlaces: assets.length,
    roadsCut,
    bridgesClosed,
    teamsReady,
    teamsTotal: resources.length,
    conflicts: situation.evidence_conflicts.length,
    damage,
  };
}

/* ── Priority actions ─────────────────────────────────────────────────────── */

export interface Action {
  entityId: string;
  /** P1 / P2 / P3 — banded from the engine's rank. */
  band: 'P1' | 'P2' | 'P3';
  title: string;
  lines: string[];
  /** The unit the optimiser matched, if it matched one. */
  unit: Resource | null;
  /** Whether a team is actually available to take this on. */
  actionable: boolean;
  blockedReason: string | null;
  decisionId: string | null;
  priority: PriorityScore;
}

/**
 * The work queue, in the order the engine ranks it.
 *
 * Each entry says what needs doing, who could do it, and what is in the way —
 * which is the minimum an operator needs to press or refuse a button.
 */
export function priorityActions(
  priorities: PriorityScore[],
  assets: Asset[],
  resources: Resource[],
  tasks: Task[],
  allocationByEntity: Map<string, { resourceId: string; etaMin: number; decisionId: string | null }>,
  limit = 4,
): Action[] {
  const ranked = priorities.filter((p) => {
    const asset = assets.find((a) => a.id === p.entity_id);
    // Command centres and supply bases are where help comes from, not where it goes.
    return asset ? !['command_center', 'resource_base'].includes(asset.type) : true;
  });

  return ranked.slice(0, limit).map((priority, index) => {
    const asset = assets.find((a) => a.id === priority.entity_id);
    const task = tasks.find((t) => t.target_entity_id === priority.entity_id);
    const match = allocationByEntity.get(priority.entity_id);
    const unit = match ? (resources.find((r) => r.id === match.resourceId) ?? null) : null;

    const band: Action['band'] = index === 0 ? 'P1' : index === 1 ? 'P1' : index === 2 ? 'P2' : 'P3';

    const unreachable = priority.accessibility_factor <= 0;
    const blind = priority.confidence_factor < 0.15;

    // Name the job by what actually needs doing, worst constraint first.
    const title = task
      ? `${capitalise(task.task_type.replace(/_/g, ' '))} — ${priority.entity_name}`
      : asset && asset.status !== 'operational'
        ? `${capitalise(statusSentence(asset))} — ${priority.entity_name}`
        : unreachable
          ? `Reopen access to ${priority.entity_name}`
          : blind
            ? `Verify conditions at ${priority.entity_name}`
            : `Check on ${priority.entity_name}`;

    const lines: string[] = [];
    if (asset && asset.population > 0) {
      lines.push(`${asset.population.toLocaleString('en-US')} people at this ${placeKind(asset.type)}`);
    }

    lines.push(unreachable ? 'Road access: no usable route' : 'Road access: open');

    if (unit) {
      lines.push(
        match && match.etaMin > 0
          ? `${unit.name} can arrive in ${Math.round(match.etaMin)} min`
          : `${unit.name} is already there`,
      );
    } else if (task) {
      // A real job exists, so count only the teams that can actually do it.
      const capable = resources.filter(
        (r) => r.status === 'available' && r.capabilities.includes(task.task_type),
      );
      lines.push(
        capable.length > 0
          ? `${capable.length} team${capable.length === 1 ? '' : 's'} can do this job`
          : 'No suitable team free',
      );
    } else {
      // No job has been raised, so do not imply every free team is a candidate.
      const free = resources.filter((r) => r.status === 'available').length;
      lines.push(
        blind
          ? `Needs a team to look — ${free} free`
          : `No job raised yet — ${free} team${free === 1 ? '' : 's'} free`,
      );
    }

    const blockedReason = unreachable
      ? 'No route in. Clear a corridor or confirm access before tasking anyone.'
      : blind
        ? 'Our information is too old to act on. Confirm before committing anything scarce.'
        : null;

    return {
      entityId: priority.entity_id,
      band,
      title,
      lines,
      unit,
      actionable: !unreachable && unit !== null,
      blockedReason,
      decisionId: match?.decisionId ?? null,
      priority,
    };
  });
}

/* ── Recent updates ───────────────────────────────────────────────────────── */

export interface Update {
  id: string;
  atMin: number;
  text: string;
  tone: 'critical' | 'caution' | 'good';
}

/** The audit log, read as a feed. Tone comes from what the change actually was. */
export function recentUpdates(records: AuditRecord[], limit = 6): Update[] {
  return records.slice(0, limit).map((record) => {
    const newStatus = String(record.new_state?.status ?? '');
    const tone: Update['tone'] =
      ['blocked', 'destroyed', 'flooded', 'unavailable'].includes(newStatus)
        ? 'critical'
        : ['partially_blocked', 'overloaded', 'damaged', 'unknown', 'high_risk'].includes(newStatus)
          ? 'caution'
          : 'good';
    return { id: record.id, atMin: record.sim_time_min, text: record.reason, tone };
  });
}

/* ── What to watch ────────────────────────────────────────────────────────── */

export interface Watch {
  tone: 'critical' | 'caution' | 'info';
  text: string;
}

/**
 * Three things worth knowing that are not obvious from any single card.
 *
 * All of these are read off current state. The system does not forecast, so
 * nothing here predicts — the card is labelled accordingly.
 */
export function watchList(
  assets: Asset[],
  roads: Road[],
  bridges: Bridge[],
  priorities: PriorityScore[],
  resources: Resource[],
): Watch[] {
  const out: Watch[] = [];

  const cutOff = priorities
    .filter((p) => p.accessibility_factor <= 0)
    .map((p) => ({ priority: p, asset: assets.find((a) => a.id === p.entity_id) }))
    .filter((x) => (x.asset?.population ?? 0) > 0)
    .sort((a, b) => (b.asset?.population ?? 0) - (a.asset?.population ?? 0));

  if (cutOff.length > 0) {
    const people = cutOff.reduce((sum, x) => sum + (x.asset?.population ?? 0), 0);
    out.push({
      tone: 'critical',
      text: `${cutOff.length} places holding ${people.toLocaleString('en-US')} people have no route in. Largest is ${cutOff[0].asset?.name}.`,
    });
  }

  const disputed = bridges.filter((b) => b.conflict_status === 'conflicting');
  if (disputed.length > 0) {
    out.push({
      tone: 'caution',
      text: `Reports disagree on ${disputed.map((b) => b.name).join(' and ')}. Do not route heavy vehicles over it until confirmed.`,
    });
  }

  const cut = roads.filter((r) => r.status === 'blocked');
  if (cut.length > 0) {
    out.push({
      tone: 'caution',
      text: `${cut.map((r) => r.name).join(', ')} ${cut.length === 1 ? 'is' : 'are'} cut, forcing longer routes across the valley.`,
    });
  }

  const off = resources.filter((r) => r.status === 'unavailable');
  if (off.length > 0) {
    out.push({
      tone: 'critical',
      text: `${off.map((r) => r.name).join(', ')} cannot be reached, so ${off.length === 1 ? 'it is' : 'they are'} not in any plan.`,
    });
  }

  const stale = priorities.filter((p) => p.confidence_factor < 0.15);
  if (stale.length > 0) {
    out.push({
      tone: 'info',
      text: `${stale.length} place${stale.length === 1 ? '' : 's'} ${stale.length === 1 ? 'is' : 'are'} running on reports too old to rely on. Send a team to look if you can spare one.`,
    });
  }

  return out.slice(0, 4);
}

/* ── Resource overview ───────────────────────────────────────────────────── */

export interface ResourceGroup {
  type: string;
  label: string;
  total: number;
  ready: number;
}

export function resourceGroups(resources: Resource[]): ResourceGroup[] {
  const map = new Map<string, ResourceGroup>();
  for (const resource of resources) {
    const existing =
      map.get(resource.type) ??
      { type: resource.type, label: teamKind(resource.type), total: 0, ready: 0 };
    existing.total += 1;
    if (resource.status === 'available') existing.ready += 1;
    map.set(resource.type, existing);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

/* ── Situation timeline ──────────────────────────────────────────────────── */

export interface Milestone {
  id: string;
  atMin: number;
  label: string;
  done: boolean;
  isNow: boolean;
}

/**
 * A small number of labelled stops along the scenario, plus the current position.
 * Showing all thirteen events here would just be the History tab again.
 */
export function milestones(events: SimEvent[], simTimeMin: number, want = 4): Milestone[] {
  if (events.length === 0) return [];

  const processed = events.filter((e) => e.processed);
  const chosen: SimEvent[] = [];

  // First event, then evenly spaced samples, then the newest processed event.
  const step = Math.max(1, Math.floor(events.length / want));
  for (let i = 0; i < events.length && chosen.length < want; i += step) {
    chosen.push(events[i]);
  }
  const newest = processed[processed.length - 1];
  if (newest && !chosen.some((e) => e.id === newest.id)) {
    chosen[chosen.length - 1] = newest;
  }

  return chosen.map((event, index) => ({
    id: event.id,
    atMin: event.time_offset_min,
    label: index === 0 ? 'Flood begins' : shortLabel(event),
    done: event.processed,
    isNow: event.time_offset_min === simTimeMin,
  }));
}

function shortLabel(event: SimEvent): string {
  const map: Record<string, string> = {
    flood_detection: 'Flood detected',
    bridge_damage_report: 'Bridge damaged',
    conflicting_bridge_report: 'Reports conflict',
    road_blockage: 'Road cut',
    hospital_demand_surge: 'Casualties surge',
    resource_unavailable: 'Team cut off',
    bridge_confirmed_blocked: 'Crossing closed',
    village_isolation_confirmed: 'Village isolated',
    satellite_observation: 'Satellite update',
    alternate_route_opened: 'Detour opened',
    school_evacuation: 'School evacuated',
    normal_state: 'Flood begins',
  };
  return map[event.event_type] ?? capitalise(event.event_type.replace(/_/g, ' '));
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
