import type { ReactNode } from 'react';

/**
 * The one container in the app. A white MD3 surface with a title row and an
 * optional link on the right — nothing nests inside another card.
 */
export function Card({
  title,
  icon,
  link,
  children,
  className,
  padded = true,
}: {
  title?: string;
  icon?: ReactNode;
  link?: { label: string; onClick: () => void };
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`}>
      {title && (
        <header className="card-head">
          {icon && <span className="card-icon">{icon}</span>}
          <h2 className="card-title">{title}</h2>
          {link && (
            <button type="button" className="card-link" onClick={link.onClick}>
              {link.label}
              <span aria-hidden="true"> →</span>
            </button>
          )}
        </header>
      )}
      <div className={padded ? 'card-body' : 'card-body card-body-flush'}>{children}</div>
    </section>
  );
}

/** Tonal status chip — light fill, dark text, MD3 style. */
export function Chip({
  tone,
  children,
}: {
  tone: 'critical' | 'caution' | 'good' | 'info' | 'neutral';
  children: ReactNode;
}) {
  return (
    <span className="chip" data-tone={tone}>
      {children}
    </span>
  );
}

/** Tonal callout for something that changes what the reader should do. */
export function Callout({
  tone,
  title,
  children,
}: {
  tone: 'danger' | 'caution' | 'good' | 'info';
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="callout" data-tone={tone}>
      <h4 className="callout-title">{title}</h4>
      {children && <div className="callout-body">{children}</div>}
    </div>
  );
}

/** Label above a value. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <span className="field-value">{children}</span>
    </div>
  );
}

/** Entity code — the shared vocabulary with the audit log and IBM Bob. */
export function Code({ children }: { children: ReactNode }) {
  return <span className="code">{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
