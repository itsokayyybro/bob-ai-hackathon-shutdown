/** Simulation clock: 105 -> "T+01:45". The scenario runs on minutes from onset. */
export function simClock(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return `T+${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/** Bare offset for timeline gutters: 105 -> "01:45". */
export function clockOffset(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/** 0.5337 -> "53%". Scores are shown as percentages everywhere in the console. */
export function pct(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** 0.5337 -> ".53" — the compact form used inside gauges and ladders. */
export function score(value: number): string {
  const fixed = value.toFixed(2);
  return fixed.startsWith('0') ? fixed.slice(1) : fixed;
}

export function count(value: number): string {
  return value.toLocaleString('en-US');
}

export function minutes(value: number): string {
  if (value < 1) return '<1 min';
  if (value < 60) return `${Math.round(value)} min`;
  const hours = Math.floor(value / 60);
  const mins = Math.round(value % 60);
  return mins === 0 ? `${hours} h` : `${hours} h ${mins} min`;
}

/** Wall-clock time of an observation, in the operator's locale. */
export function clockTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** How stale an observation is, expressed against the decay that matters. */
export function ageHours(iso: string, now = Date.now()): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, (now - then) / 3_600_000);
}

export function ageLabel(iso: string, now = Date.now()): string {
  const hours = ageHours(iso, now);
  if (hours < 1 / 60) return 'just now';
  if (hours < 1) return `${Math.round(hours * 60)} min ago`;
  if (hours < 24) {
    const whole = Math.floor(hours);
    const mins = Math.round((hours - whole) * 60);
    return mins === 0 ? `${whole} h ago` : `${whole} h ${mins} min ago`;
  }
  return `${Math.floor(hours / 24)} d ago`;
}

/** Replace snake_case enum values with display text: `partially_blocked` -> `partially blocked`. */
export function enumLabel(value: string): string {
  return value.replace(/_/g, ' ');
}

/** Split the backend's markdown-ish AI answers into renderable blocks. The
 *  deterministic provider emits `**bold**` headers, `•`/`-` bullets and blank-line
 *  paragraphs, so we handle exactly those rather than pulling in a md parser. */
export interface TextBlock {
  kind: 'heading' | 'bullet' | 'text';
  content: string;
}

export function parseAnswer(answer: string): TextBlock[] {
  return answer
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const bullet = line.match(/^(?:[•\-*]|\d+\.)\s+(.*)$/);
      if (bullet) return { kind: 'bullet' as const, content: strip(bullet[1]) };
      if (/^#{1,4}\s/.test(line))
        return { kind: 'heading' as const, content: strip(line.replace(/^#{1,4}\s*/, '')) };
      if (/^\*\*[^*]+\*\*:?$/.test(line))
        return { kind: 'heading' as const, content: strip(line) };
      return { kind: 'text' as const, content: strip(line) };
    });
}

function strip(text: string): string {
  return text.replace(/\*\*/g, '').replace(/^\*|\*$/g, '').trim();
}

/**
 * Audit records carry loose state blobs like `{status: "open"}` or
 * `{status: "blocked", confidence: 0.748, conflict: "none"}`. Render them as a
 * compact reading rather than dumping JSON at the operator.
 */
export function stateSummary(state: Record<string, unknown> | null): string {
  if (!state) return '—';
  const parts = Object.entries(state)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => {
      const shown =
        typeof value === 'number'
          ? Number.isInteger(value)
            ? String(value)
            : value.toFixed(2)
          : String(value).replace(/_/g, ' ');
      return key === 'status' ? shown : `${key.replace(/_/g, ' ')} ${shown}`;
    });
  return parts.length > 0 ? parts.join(' · ') : '—';
}
