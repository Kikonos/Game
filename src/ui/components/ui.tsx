import { Minus, Plus, X } from 'lucide-react';
import { type ReactNode, type RefObject, type TouchEvent, useEffect, useMemo, useRef, useState } from 'react';
import { flag } from '../../data/countries';
import { tierNow } from '../useMedia';

const FIELD = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), select, textarea';

/**
 * While a dialog is open, track the on-screen keyboard through the visual viewport: the
 * backdrop shrinks to the visible area (--vv-top / --vv-h on <html>) and the focused field
 * is scrolled into view, so inputs never end up under the keyboard.
 */
function useKeyboardAware(dialog: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    let timer = 0;
    const reveal = () => {
      const a = document.activeElement;
      if (a instanceof HTMLElement && dialog.current?.contains(a) && a.matches(FIELD)) a.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    const update = () => {
      if (!vv) return;
      // The layout viewport keeps its height when the keyboard opens; the visual viewport shrinks.
      const kb = Math.max(window.innerHeight, document.documentElement.clientHeight) - vv.height - vv.offsetTop;
      if (kb > 40) {
        root.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
        root.style.setProperty('--vv-h', `${Math.round(vv.height)}px`);
        window.clearTimeout(timer);
        timer = window.setTimeout(reveal, 60);
      } else {
        root.style.removeProperty('--vv-top');
        root.style.removeProperty('--vv-h');
      }
    };
    // The keyboard animates in after focus; reveal again once it has settled.
    const onFocus = (e: FocusEvent) => {
      if (!(e.target instanceof Element) || !e.target.matches(FIELD)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(reveal, 350);
    };
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    document.addEventListener('focusin', onFocus);
    update();
    return () => {
      window.clearTimeout(timer);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      document.removeEventListener('focusin', onFocus);
      root.style.removeProperty('--vv-top');
      root.style.removeProperty('--vv-h');
    };
  }, [dialog]);
}

/**
 * Dialog. Wide/medium tiers: centred card (normal ~600px, wide ~900px, xwide ~1180px) with the
 * header and footer fixed and only the body scrolling. Compact tier: a bottom sheet that can be
 * dragged down to dismiss.
 */
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
  const sheet = useRef<HTMLDivElement>(null);
  useKeyboardAware(sheet);
  // The header gets a hairline once the body scrolls under it.
  const [scrolled, setScrolled] = useState(false);
  // Compact tier: dialogs are bottom sheets, and dragging the grip/header down dismisses them.
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const dragStart = (e: TouchEvent) => {
    if (!onClose || e.touches.length !== 1 || (e.target as Element).closest('button') || tierNow() !== 'compact') return;
    drag.current = { y: e.touches[0].clientY, dy: 0 };
  };
  const dragMove = (e: TouchEvent) => {
    const d = drag.current;
    const el = sheet.current;
    if (!d || !el) return;
    d.dy = Math.max(0, e.touches[0].clientY - d.y);
    el.style.transition = 'none';
    el.style.transform = `translateY(${d.dy}px)`;
  };
  const dragEnd = () => {
    const d = drag.current;
    const el = sheet.current;
    drag.current = null;
    if (!d || !el) return;
    el.style.transition = '';
    el.style.transform = '';
    if (d.dy > 90) onClose?.();
  };
  const grab = { onTouchStart: dragStart, onTouchMove: dragMove, onTouchEnd: dragEnd, onTouchCancel: dragEnd };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={sheet} className={`modal ${size ?? ''} ${className ?? ''} ${scrolled ? 'scrolled' : ''}`} role="dialog" aria-modal="true">
        {onClose && <div className="sheet-grip" aria-hidden {...grab} />}
        <div className="modal-head" {...grab}>
          {icon}
          <h2>{title}</h2>
          {onClose && (
            <button className="btn btn-ghost btn-icon btn-sm close" onClick={onClose} aria-label="Close">
              <X />
            </button>
          )}
        </div>
        <div className="modal-body" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 2)}>{children}</div>
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
                <stop offset={`${fill * 100}%`} style={{ stopColor: 'var(--gold)' }} />
                <stop offset={`${fill * 100}%`} style={{ stopColor: 'rgba(var(--line-rgb),0.25)' }} />
              </linearGradient>
            </defs>
            <path fill={`url(#sg${i}-${Math.round(fill * 10)})`} d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.5L12 17.3 6.1 20.5l1.3-6.5L2.5 9.4l6.6-.8z" />
          </svg>
        );
      })}
    </span>
  );
}
