import type { Problem } from '../lib/explain.ts';
import { accessLabel, needLabel } from '../lib/explain.ts';

/**
 * One place in a list, stated as a problem rather than a row of scores.
 *
 * The heading says what is wrong; the line underneath gives the two facts that
 * decide whether you can do anything about it — how many people, and whether you
 * can get there.
 */
export function ProblemRow({ problem, onOpen }: { problem: Problem; onOpen: () => void }) {
  const { priority, asset, severity } = problem;
  const people = asset?.population ?? 0;
  const unreachable = priority.accessibility_factor <= 0;

  return (
    <li className="problem-row" data-severity={severity}>
      <button type="button" className="problem-button" onClick={onOpen}>
        <span className="problem-main">
          <span className="problem-headline">{problem.headline}</span>
          <span className="problem-meta">
            {people > 0 && <>{people.toLocaleString('en-US')} people · </>}
            {accessLabel(priority.accessibility_factor)} · {needLabel(priority.criticality_score)}
          </span>
        </span>
        {unreachable && <span className="problem-flag">Cannot reach</span>}
        <span className="problem-open" aria-hidden="true">
          →
        </span>
      </button>
    </li>
  );
}
