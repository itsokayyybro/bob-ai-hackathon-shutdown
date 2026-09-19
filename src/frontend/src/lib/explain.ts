/**
 * The translation layer.
 *
 * The engine speaks in normalised floats: criticality 0.43, accessibility 0.0,
 * confidence 0.008. None of that tells a coordinator what is wrong or what to do.
 * Everything in this file turns an engine number into the sentence a person would
 * actually say, and nothing here invents a fact the API did not provide.
 */
import type {
  Asset,
  Bridge,
  PriorityScore,
  RawObservation,
  Resource,
  Road,
  Route,
  Situation,
} from './types.ts';

export type Severity = 'critical' | 'warning' | 'stable';

/* ── Words for numbers ────────────────────────────────────────────────────── */

/** How badly this place needs help, in words. */
export function needLabel(criticality: number): string {
  if (criticality >= 0.5) return 'Very high need';
  if (criticality >= 0.35) return 'High need';
  if (criticality >= 0.2) return 'Moderate need';
  return 'Low need';
}

/** How fast it is getting worse. */
export function urgencyLabel(urgency: number): string {
  if (urgency >= 0.8) return 'Deteriorating now';
  if (urgency >= 0.5) return 'Getting worse';
  if (urgency > 0) return 'Slow change';
  return 'Not changing';
}

/** Whether you can physically get there. This is the one operators act on most. */
export function accessLabel(access: number): string {
  if (access <= 0) return 'No usable route';
  if (access < 0.5) return 'Hard to reach';
  if (access < 0.85) return 'Reachable with care';
  return 'Clear route';
}

/** How much recent, trustworthy reporting backs the picture. */
export function informationLabel(confidence: number): string {
  if (confidence >= 0.6) return 'Well confirmed';
  if (confidence >= 0.3) return 'Thinly confirmed';
  if (confidence >= 0.1) return 'Barely confirmed';
  return 'Almost no current information';
}

/** Plain reading of an asset's status enum. */
export function statusSentence(asset: Asset): string {
  switch (asset.status) {
    case 'overloaded':
      return 'taking more casualties than it can handle';
    case 'flooded':
      return 'under flood water';
    case 'damaged':
      return 'damaged and running below capacity';
    case 'destroyed':
      return 'out of action';
    case 'evacuated':
      return 'evacuated';
    case 'unknown':
      return 'in an unknown condition';
    default:
      return 'still working normally';
  }
}

/** What kind of place this is, in words a non-specialist reads. */
export function placeKind(type: string): string {
  const map: Record<string, string> = {
    hospital: 'district hospital',
    health_post: 'health post',
    school: 'school',
    shelter: 'shelter',
    hydropower: 'hydropower station',
    command_center: 'command centre',
    village: 'village',
    resource_base: 'supply base',
    intersection: 'junction',
  };
  return map[type] ?? type.replace(/_/g, ' ');
}

export function roadStatusSentence(status: string): string {
  switch (status) {
    case 'blocked':
      return 'Cut';
    case 'partially_blocked':
      return 'Passable with difficulty';
    case 'high_risk':
      return 'Open but dangerous';
    case 'unknown':
      return 'Condition unknown';
    default:
      return 'Open';
  }
}

export function teamKind(type: string): string {
  const map: Record<string, string> = {
    rescue_team: 'Rescue team',
    ambulance: 'Ambulance',
    engineering_team: 'Engineering team',
    supply_vehicle: 'Supply vehicle',
    medical_unit: 'Medical unit',
  };
  return map[type] ?? type.replace(/_/g, ' ');
}

export function teamStatusSentence(status: string): string {
  switch (status) {
    case 'available':
      return 'Ready to task';
    case 'deployed':
      return 'On a job';
    case 'en_route':
      return 'Travelling';
    case 'unavailable':
      return 'Cannot be reached';
    default:
      return status.replace(/_/g, ' ');
  }
}

/** How old a report is, and whether that still counts for anything. */
export function reportAge(observation: RawObservation): string {
  const ageMin = Math.max(0, (Date.now() - new Date(observation.timestamp).getTime()) / 60000);
  const age =
    ageMin < 1 ? 'just now' : ageMin < 60 ? `${Math.round(ageMin)} min ago` : `${(ageMin / 60).toFixed(1)} h ago`;
  if (observation.freshness < 0.15) return `${age} — too old to rely on`;
  if (observation.freshness < 0.5) return `${age} — losing reliability`;
  return age;
}

export function sourceName(sourceType: string): string {
  const map: Record<string, string> = {
    satellite: 'Satellite imagery',
    drone: 'Drone flight',
    field_report: 'Field team',
    emergency_call: 'Emergency call',
    hospital: 'Hospital',
    school: 'School',
    sensor: 'Sensor reading',
    authority_report: 'Local authority',
    simulation: 'Baseline record',
  };
  return map[sourceType] ?? sourceType.replace(/_/g, ' ');
}

/* ── Severity, used to colour only what is genuinely alarming ─────────────── */

export function severityOf(priority: PriorityScore, asset: Asset | undefined): Severity {
  const bad = asset ? ['flooded', 'destroyed', 'overloaded'].includes(asset.status) : false;
  if (bad || priority.accessibility_factor <= 0 || priority.urgency_score >= 0.8) return 'critical';
  if (priority.priority_score >= 0.3 || priority.confidence_factor < 0.3) return 'warning';
  return 'stable';
}

/* ── The headline: what is wrong, in one sentence ──────────────────────────── */

export interface Problem {
  /** Sentence for a heading — no trailing full stop. */
  headline: string;
  /** One or two sentences explaining the consequence and the complication. */
  detail: string;
  /** Short plain facts worth putting next to the sentence. */
  facts: { label: string; value: string; severity?: Severity }[];
  severity: Severity;
  asset: Asset | undefined;
  priority: PriorityScore;
}

/**
 * Compose the problem statement for a place from what the engine actually knows:
 * its status, the people behind it, whether it can be reached, and how stale the
 * reporting is.
 */
export function describeProblem(
  priority: PriorityScore,
  assets: Asset[],
  roads: Road[],
): Problem {
  const asset = assets.find((a) => a.id === priority.entity_id);
  const severity = severityOf(priority, asset);
  const people = asset?.population ?? 0;

  const headline = asset
    ? asset.status === 'operational'
      ? `${asset.name} needs attention`
      : `${asset.name} is ${statusSentence(asset)}`
    : `${priority.entity_name} needs attention`;

  const sentences: string[] = [];

  if (asset && people > 0) {
    sentences.push(
      `It is the ${placeKind(asset.type)} for ${people.toLocaleString('en-US')} people.`,
    );
  } else if (asset) {
    sentences.push(`It is the ${placeKind(asset.type)} for this valley.`);
  }

  // The complication that actually changes the dispatch decision.
  const cutRoads = asset
    ? roads.filter(
        (r) => r.status === 'blocked' && (r.from_node === asset.id || r.to_node === asset.id),
      )
    : [];

  if (priority.accessibility_factor <= 0) {
    sentences.push('There is no route into it that we can currently trust, so nothing can be sent until access is restored or verified.');
  } else if (cutRoads.length > 0) {
    const names = cutRoads.map((r) => r.name).join(' and ');
    sentences.push(`${names} is cut, so anything you send has to go the long way round.`);
  } else if (priority.accessibility_factor < 0.85) {
    sentences.push('The route in is usable but not clear, so allow extra travel time.');
  }

  if (priority.confidence_factor < 0.3) {
    sentences.push(
      'Our picture of it is built on old or disputed reports, so confirm on the ground before committing anything scarce.',
    );
  }

  const facts: Problem['facts'] = [];
  if (people > 0) {
    facts.push({ label: 'People depending on it', value: people.toLocaleString('en-US') });
  }
  facts.push({
    label: 'Getting there',
    value: accessLabel(priority.accessibility_factor),
    severity: priority.accessibility_factor <= 0 ? 'critical' : priority.accessibility_factor < 0.85 ? 'warning' : 'stable',
  });
  facts.push({
    label: 'How it is trending',
    value: urgencyLabel(priority.urgency_score),
    severity: priority.urgency_score >= 0.8 ? 'critical' : 'stable',
  });
  facts.push({
    label: 'What we know',
    value: informationLabel(priority.confidence_factor),
    severity: priority.confidence_factor < 0.3 ? 'warning' : 'stable',
  });

  return {
    headline,
    detail: sentences.join(' '),
    facts,
    severity,
    asset,
    priority,
  };
}

/* ── The recommendation, in words ──────────────────────────────────────────── */

export interface Recommended {
  /** "Send Ambulance Unit 2 to Gorkha Health Post" */
  headline: string;
  /** Why this unit, in plain terms. */
  detail: string;
  /** The practical steps, if travel is involved. */
  journey: string | null;
  confidenceSentence: string;
}

export function describeRecommendation(
  unit: Resource | null,
  targetName: string,
  route: Route | null,
  etaMin: number,
  confidence: number,
  jobKind: string | null,
): Recommended {
  const unitName = unit?.name ?? 'the assigned unit';

  const headline = `Send ${unitName} to ${targetName}`;

  const reasons: string[] = [];
  if (etaMin <= 0) {
    reasons.push(`${unitName} is already at ${targetName}, so it can start immediately.`);
  } else if (route?.feasible) {
    reasons.push(
      `${unitName} can reach ${targetName} in about ${Math.round(etaMin)} minutes on a route that is currently open.`,
    );
  } else {
    reasons.push(`${unitName} is the closest available match, but the route needs checking.`);
  }

  if (unit && jobKind) {
    reasons.push(`It is a ${teamKind(unit.type).toLowerCase()}, which is what a ${jobKind} job needs.`);
  }

  const journey =
    route && route.feasible && route.total_time_min > 0
      ? `${route.total_distance_km.toFixed(1)} km, roughly ${Math.round(route.total_time_min)} minutes, ${Math.max(0, route.path_nodes.length - 1)} legs.`
      : null;

  const confidenceSentence =
    confidence >= 0.8
      ? 'We are confident in this call.'
      : confidence >= 0.5
        ? 'We are reasonably confident, but confirm the route before the unit leaves.'
        : 'We are not confident. Treat this as a starting point, not an instruction.';

  return { headline, detail: reasons.join(' '), journey, confidenceSentence };
}

/* ── What could make the recommendation wrong ──────────────────────────────── */

export interface Doubt {
  entityId: string;
  headline: string;
  detail: string;
  advice: string;
}

/**
 * Turn disagreeing sources into the warning a coordinator needs before routing
 * anything heavy. Only bridges carry an explicit conflict flag in the API, and
 * bridges are exactly where a wrong call strands a vehicle.
 */
export function describeDoubts(bridges: Bridge[], situation: Situation): Doubt[] {
  const doubts: Doubt[] = [];

  for (const bridge of bridges) {
    if (bridge.conflict_status !== 'conflicting') continue;
    doubts.push({
      entityId: bridge.id,
      headline: `Two reports disagree about ${bridge.name}`,
      detail:
        'One field team reported it damaged. Another reported it still passable. Both are recent enough to matter, so we cannot tell which is right.',
      advice: `Do not route heavy vehicles over ${bridge.name} until a team confirms it. Send an engineering team to look if you can spare one.`,
    });
  }

  for (const bridge of bridges) {
    if (bridge.status !== 'blocked' || bridge.conflict_status === 'conflicting') continue;
    doubts.push({
      entityId: bridge.id,
      headline: `${bridge.name} is closed`,
      detail: `The crossing is impassable, which removes every route that depended on it. It carried ${bridge.capacity} vehicles.`,
      advice: 'Plan around it. Routes shown elsewhere already exclude it.',
    });
  }

  if (situation.unavailable_resources.length > 0) {
    const names = situation.unavailable_resources.join(', ');
    doubts.push({
      entityId: '',
      headline:
        situation.unavailable_resources.length === 1
          ? `${names} cannot be reached`
          : `${situation.unavailable_resources.length} units cannot be reached`,
      detail: `${names} ${situation.unavailable_resources.length === 1 ? 'is' : 'are'} cut off by road damage and cannot be tasked, so the plan below works without ${situation.unavailable_resources.length === 1 ? 'it' : 'them'}.`,
      advice: 'Re-check once corridors reopen — that frees capacity immediately.',
    });
  }

  return doubts;
}
