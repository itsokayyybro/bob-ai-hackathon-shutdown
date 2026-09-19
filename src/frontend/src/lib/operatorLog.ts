import { useCallback, useState } from 'react';

export type Verdict = 'confirmed' | 'rejected';

export interface LogEntry {
  id: string;
  verdict: Verdict;
  action: string;
  target: string | null;
  simTimeMin: number;
  at: number;
}

/**
 * The operator's own record of what they accepted and what they overruled.
 *
 * The backend deliberately has no write endpoint for allocations yet, so these
 * verdicts live in the session and are labelled as such everywhere they appear.
 * The console should never imply it changed engine state when it did not.
 */
export function useOperatorLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);

  const record = useCallback(
    (verdict: Verdict, decisionId: string, action: string, target: string | null, simTimeMin: number) => {
      setEntries((prev) => [
        { id: decisionId, verdict, action, target, simTimeMin, at: Date.now() },
        ...prev.filter((e) => e.id !== decisionId),
      ]);
    },
    [],
  );

  const verdictFor = useCallback(
    (decisionId: string): Verdict | null =>
      entries.find((e) => e.id === decisionId)?.verdict ?? null,
    [entries],
  );

  return { entries, record, verdictFor };
}
