// v0.7.1 tap-to-explain glossary (UPDATE-0.7.1.md §5, §11): <Term id="fdp"> renders the term with a dotted underline;
// a tap opens one small popover with the one-line meaning and a 'Glossary ›' link. Any tap elsewhere dismisses it.
// One popover at a time (module-level state). Static: nothing animates.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { GLOSSARY, type TermId } from '../../data/glossary';
import { store } from '../store';
import { termSegments } from './problemLogic';
import { toCss } from '../device';

let closeOpen: (() => void) | null = null;

/** The one small popover (glossary terms and the "?" info taps): placed under its anchor, any tap elsewhere shuts it. */
function Pop({ anchor, onClose, label, children }: { anchor: HTMLElement; onClose: () => void; label: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = anchor.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(vw - b.width - 8, Math.max(8, r.left + r.width / 2 - b.width / 2));
    const below = r.bottom + 8;
    const top = below + b.height <= vh - 8 ? below : Math.max(8, r.top - b.height - 8);
    // v0.12 rects are screen px; the popover is placed in the page's px (Settings › Size zooms the page).
    setPos({ left: toCss(left), top: toCss(top) });
  }, [anchor]);
  useEffect(() => {
    const down = (e: Event) => {
      const t = e.target as Node | null;
      if (t && (box.current?.contains(t) || anchor.contains(t))) return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // A scroll of the page behind shuts it; a scroll inside the popover itself (a long answer) does not.
    const scroll = (e: Event) => { if (!box.current?.contains(e.target as Node | null)) onClose(); };
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', esc, true);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', esc, true);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [anchor, onClose]);
  // A dialog the game opens (auto-pause, a card) or a tab change closes it: never left floating over the new view.
  const shut = useRef(onClose);
  shut.current = onClose;
  useEffect(() => {
    const m0 = store.modal, n0 = store.nav;
    const off = store.subscribe(() => { if (store.modal !== m0 || store.nav !== n0) shut.current(); });
    return () => { off(); };
  }, []);
  return createPortal(
    <div ref={box} className="term-pop" role="dialog" aria-label={label} style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}>
      {children}
    </div>,
    document.body,
  );
}

function Popover({ id, anchor, onClose, extra, own }: { id: TermId; anchor: HTMLElement; onClose: () => void; extra?: string; own?: boolean }) {
  const e = GLOSSARY[id];
  return (
    <Pop anchor={anchor} onClose={onClose} label={e.term}>
      <b>{e.term}</b>
      {!(own && extra) && <span className="small">{e.short}</span>}
      {extra && <span className={`small ${own ? '' : 'muted'}`}>{extra}</span>}
      <button className="btn btn-sm btn-ghost term-more" onClick={() => { onClose(); store.openModal({ kind: 'glossary', term: id }); }}>Glossary ›</button>
    </Pop>
  );
}

/**
 * v0.21 a small, quiet "?" beside a label (the player: "a small question mark I can press to see the info … never
 * permanent visual clutter"). A tap opens the same popover as a glossary term with a title and a few plain lines; a
 * tap elsewhere shuts it. One open at a time, shared with <Term>. It is a span, so it can sit inside a row or label.
 */
export function Info({ title, children, label, className }: { title: string; children: ReactNode; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const close = () => {
    setOpen(false);
    if (closeOpen === close) closeOpen = null;
  };
  const toggle = (e: { stopPropagation: () => void; preventDefault?: () => void }) => {
    e.stopPropagation();
    e.preventDefault?.();
    if (open) return close();
    closeOpen?.();
    closeOpen = close;
    setOpen(true);
  };
  useEffect(() => () => { if (closeOpen === close) closeOpen = null; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <span ref={ref} className={`info-dot ${open ? 'on' : ''} ${className ?? ''}`} role="button" tabIndex={0} aria-label={label ?? `${title}: what this means`} aria-expanded={open} onClick={toggle} onKeyDown={(k) => (k.key === 'Enter' || k.key === ' ') && toggle(k)}>
        <i aria-hidden>?</i>
      </span>
      {open && ref.current && <Pop anchor={ref.current} onClose={close} label={title}><b>{title}</b><div className="info-body small">{children}</div></Pop>}
    </>
  );
}

/**
 * v0.7.4 `extra`: a line about this very thing under the glossary meaning (e.g. this aircraft's longest day).
 * v0.9 `own`: `extra` says it all, so it replaces the glossary meaning (no line said twice).
 */
export function Term({ id, children, extra, own }: { id: TermId; children?: ReactNode; extra?: string; own?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const close = () => {
    setOpen(false);
    if (closeOpen === close) closeOpen = null;
  };
  const toggle = (e: { stopPropagation: () => void; preventDefault?: () => void }) => {
    e.stopPropagation();
    e.preventDefault?.();
    if (open) return close();
    closeOpen?.();
    closeOpen = close;
    setOpen(true);
  };
  useEffect(() => () => { if (closeOpen === close) closeOpen = null; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const e = GLOSSARY[id];
  if (!e) return <>{children}</>;
  return (
    <>
      <span ref={ref} className={`term ${open ? 'on' : ''}`} tabIndex={0} aria-label={`${e.term}: tap for its meaning`} onClick={toggle} onKeyDown={(k) => (k.key === 'Enter' || k.key === ' ') && toggle(k)}>
        {children ?? e.term}
      </span>
      {open && ref.current && <Popover id={id} anchor={ref.current} onClose={close} extra={extra} own={own} />}
    </>
  );
}

/** A card line with its glossary words wrapped in <Term>. */
export function Plain({ text, terms }: { text: string; terms?: TermId[] }) {
  const segs = termSegments(text, terms);
  return <>{segs.map((s, i) => (s.term ? <Term key={i} id={s.term}>{s.text}</Term> : <span key={i}>{s.text}</span>))}</>;
}
