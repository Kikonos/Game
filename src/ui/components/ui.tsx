import { Minus, Plus, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { flag } from '../../data/countries';

export function Modal({
  title, icon, children, footer, onClose, size, className,
}: {
  title: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose?: () => void;
  size?: 'wide' | 'xwide';
  className?: string;
}) {
  useEffect(() => {
    if (!onClose) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${size ?? ''} ${className ?? ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          {icon}
          <h2>{title}</h2>
          {onClose && (
            <button className="btn btn-ghost btn-icon btn-sm close" onClick={onClose} aria-label="Close">
              <X />
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Stepper({
  value, onChange, min = 0, max = 99, step = 1, format,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => ReactNode;
}) {
  return (
    <div className="stepper">
      <button onClick={() => onChange(Math.max(min, value - step))} disabled={value <= min} aria-label="Decrease"><Minus /></button>
      <span className="val">{format ? format(value) : value}</span>
      <button onClick={() => onChange(Math.min(max, value + step))} disabled={value >= max} aria-label="Increase"><Plus /></button>
    </div>
  );
}

export function Seg<T extends string | number>({
  value, options, onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.value)} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on} aria-label={label} />;
}

export function Bar({ value, tone, size, title }: { value: number; tone?: 'good' | 'warn' | 'bad' | 'auto'; size?: 'thick' | 'thin'; title?: string }) {
  const v = Math.max(0, Math.min(1, value));
  const t = tone === 'auto' ? (v > 0.66 ? 'good' : v > 0.33 ? 'warn' : 'bad') : tone;
  return (
    <div className={`bar ${t ?? ''} ${size ?? ''}`} title={title}>
      <span style={{ width: `${v * 100}%` }} />
    </div>
  );
}

export function Kpi({ label, icon, value, sub, children, className }: {
  label: ReactNode; icon?: ReactNode; value: ReactNode; sub?: ReactNode; children?: ReactNode; className?: string;
}) {
  return (
    <div className={`card kpi ${className ?? ''}`}>
      <div className="kpi-label">{icon}{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
      {children}
    </div>
  );
}

export function Card({ title, icon, sub, actions, children, className, bodyClass }: {
  title?: ReactNode; icon?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string;
}) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || actions) && (
        <div className="card-head">
          {icon}
          {title && <h3>{title}</h3>}
          {sub && <span className="sub">{sub}</span>}
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      <div className={`card-body ${bodyClass ?? ''}`}>{children}</div>
    </section>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: {
  value: T;
  tabs: { id: T; label: ReactNode; icon?: ReactNode; count?: number }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`tab ${value === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
          {t.icon}
          {t.label}
          {t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Flag({ country }: { country: string }) {
  return <span className="flag" aria-hidden>{flag(country)}</span>;
}

export function Trend({ value, invert }: { value: number; invert?: boolean }) {
  const good = invert ? value < 0 : value > 0;
  if (Math.abs(value) < 0.005) return <span className="dim">—</span>;
  return <span className={good ? 'good' : 'bad'}>{value > 0 ? '▲' : '▼'} {Math.abs(value * 100).toFixed(0)}%</span>;
}

/** Sortable table state. */
export function useSort<T>(rows: T[], initial: { key: string; dir: 1 | -1 }, getters: Record<string, (r: T) => number | string>) {
  const [sort, setSort] = useState(initial);
  const sorted = useMemo(() => {
    const g = getters[sort.key];
    if (!g) return rows;
    return [...rows].sort((a, b) => {
      const va = g(a);
      const vb = g(b);
      if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb)) * sort.dir;
      return ((va as number) - (vb as number)) * sort.dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);
  const th = (key: string, label: ReactNode, className = '') => (
    <th
      className={`sortable ${sort.key === key ? 'sorted' : ''} ${className}`}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : -1 }))}
    >
      {label}
      {sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </th>
  );
  return { sorted, th };
}

export function Stars({ value }: { value: number }) {
  const stars = Math.round((value / 100) * 10) / 2;
  return (
    <span className="stars" aria-label={`${stars} stars`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, stars - i));
        return (
          <svg key={i} viewBox="0 0 24 24" width="13" height="13">
            <defs>
              <linearGradient id={`sg${i}-${Math.round(fill * 10)}`}>
                <stop offset={`${fill * 100}%`} stopColor="#f5c451" />
                <stop offset={`${fill * 100}%`} stopColor="rgba(148,170,220,0.25)" />
              </linearGradient>
            </defs>
            <path fill={`url(#sg${i}-${Math.round(fill * 10)})`} d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.5L12 17.3 6.1 20.5l1.3-6.5L2.5 9.4l6.6-.8z" />
          </svg>
        );
      })}
    </span>
  );
}
