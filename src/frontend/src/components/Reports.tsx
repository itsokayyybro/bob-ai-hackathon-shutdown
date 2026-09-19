import { Callout } from './Card.tsx';
import { informationLabel, reportAge, sourceName } from '../lib/explain.ts';
import { enumLabel } from '../lib/format.ts';
import type { EvidenceBundle, EvidenceSummary, RawObservation } from '../lib/types.ts';

/**
 * What we were told, and how much of it we believe.
 *
 * The engine weighs each report by how much the source type is trusted, how sure
 * the reporter was, and how much the clock has eroded it. Rather than printing
 * those three numbers, this says what they mean: which report is currently
 * carrying the answer, which one is being discounted, and why.
 */
export function Reports({ bundle }: { bundle: EvidenceBundle }) {
  const { evidence_summaries: claims, raw_observations: reports } = bundle;

  if (claims.length === 0 && reports.length === 0) {
    return (
      <p className="body-text">
        Nobody has reported on this yet. Everything shown about it comes from records made
        before the flood, so treat it as a starting assumption rather than fact.
      </p>
    );
  }

  return (
    <div className="reports">
      {claims.map((claim) => (
        <Claim
          key={`${claim.entity_id}-${claim.observation_type}`}
          claim={claim}
          reports={reports.filter((r) => r.observation_type === claim.observation_type)}
        />
      ))}

      {reports.filter((r) => !claims.some((c) => c.observation_type === r.observation_type)).length >
        0 && (
        <div className="claim">
          <h4 className="claim-question">Other reports on file</h4>
          <ul className="report-list">
            {reports
              .filter((r) => !claims.some((c) => c.observation_type === r.observation_type))
              .map((report) => (
                <ReportItem key={report.id} report={report} role="logged" />
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Turn the fused claim into the question it answers. */
function questionFor(observationType: string): string {
  const map: Record<string, string> = {
    bridge_status: 'Is the bridge usable?',
    road_status: 'Is the road usable?',
    accessibility: 'Can we get there?',
    capacity: 'Can it cope with what is arriving?',
    flood_level: 'How high is the water?',
    structural: 'Is the structure sound?',
    population: 'How many people are there?',
    damage: 'How badly is it damaged?',
    resource_status: 'Is this unit usable?',
    demand: 'What does it need?',
    weather: 'What is the weather doing?',
  };
  return map[observationType] ?? `What is the ${enumLabel(observationType)}?`;
}

function Claim({ claim, reports }: { claim: EvidenceSummary; reports: RawObservation[] }) {
  const disputed = claim.conflict_status === 'conflicting';

  const ranked = [...reports].sort((a, b) => b.freshness * b.confidence - a.freshness * a.confidence);

  return (
    <div className="claim" data-disputed={disputed ? 'true' : undefined}>
      <h4 className="claim-question">{questionFor(claim.observation_type)}</h4>

      <p className="claim-answer">
        Our best answer is <strong>{enumLabel(claim.best_value)}</strong>.
      </p>

      <p className="body-text claim-trust">
        {informationLabel(claim.confidence)} — based on {claim.source_count} report
        {claim.source_count === 1 ? '' : 's'}.
        {disputed && ' The reports do not agree with each other, which is why we are not sure.'}
      </p>

      {/* The engine's own recommendation string names internal fields and entity
          codes, so say the same thing in the operator's language instead. */}
      {disputed && (
        <Callout tone="caution" title="Send someone to confirm this">
          <p className="body-text">
            Until a team verifies it on the ground, do not commit anything that depends on this
            being true. The two reports cancel each other out, which is why our confidence sits at{' '}
            {Math.round(claim.confidence * 100)}%.
          </p>
        </Callout>
      )}

      <ul className="report-list">
        {ranked.map((report) => (
          <ReportItem
            key={report.id}
            report={report}
            role={
              claim.conflicting_observations.includes(report.id)
                ? 'against'
                : claim.supporting_observations.includes(report.id)
                  ? 'for'
                  : 'logged'
            }
          />
        ))}
      </ul>
    </div>
  );
}

function ReportItem({
  report,
  role,
}: {
  report: RawObservation;
  role: 'for' | 'against' | 'logged';
}) {
  // A report the engine has effectively stopped counting.
  const discounted = report.freshness < 0.15;

  return (
    <li className="report" data-role={role} data-discounted={discounted ? 'true' : undefined}>
      <p className="report-said">
        <strong>{sourceName(report.source_type)}</strong> said{' '}
        <strong>{enumLabel(report.value)}</strong>
      </p>
      {report.raw_text && <p className="report-quote">“{report.raw_text}”</p>}
      <p className="report-weight">
        {reportAge(report)}
        {role === 'against' && ' · this is the report that disagrees'}
        {discounted && ' · barely counted now'}
      </p>
    </li>
  );
}
