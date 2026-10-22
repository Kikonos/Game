// v0.7.1 tap-to-explain glossary (UPDATE-0.7.1.md §5, §11): <Term id="fdp"> renders the term with a dotted underline;
// a tap opens one small popover with the one-line meaning and a 'Glossary ›' link. Any tap elsewhere dismisses it.
// One popover at a time (module-level state). Static: nothing animates.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { GLOSSARY, type TermId } from '../../data/glossary';
import { store } from '../store';
import { termSegments } from './problemLogic';

let closeOpen: (() => void) | null = null;

function Popover({ id, anchor, onClose, extra }: { id: TermId; anchor: HTMLElement; onClose: () => void; extra?: string }) {
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
    setPos({ left, top });
  }, [anchor]);
  useEffect(() => {
    const down = (e: Event) => {
      const t = e.target as Node | null;
      if (t && (box.current?.contains(t) || anchor.contains(t))) return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', esc, true);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', esc, true);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [anchor, onClose]);
  const e = GLOSSARY[id];
  return createPortal(
    <div ref={box} className="term-pop" role="dialog" aria-label={e.term} style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}>
      <b>{e.term}</b>
      <span className="small">{e.short}</span>
      {extra && <span className="small muted">{extra}</span>}
      <button className="btn btn-sm btn-ghost term-more" onClick={() => { onClose(); store.openModal({ kind: 'glossary', term: id }); }}>Glossary ›</button>
    </div>,
    document.body,
  );
}

/** v0.7.4 `extra`: a line about this very thing under the glossary meaning (e.g. this aircraft's longest day). */
export function Term({ id, children, extra }: { id: TermId; children?: ReactNode; extra?: string }) {
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
      {open && ref.current && <Popover id={id} anchor={ref.current} onClose={close} extra={extra} />}
    </>
  );
}

/** A card line with its glossary words wrapped in <Term>. */
export function Plain({ text, terms }: { text: string; terms?: TermId[] }) {
  const segs = termSegments(text, terms);
  return <>{segs.map((s, i) => (s.term ? <Term key={i} id={s.term}>{s.text}</Term> : <span key={i}>{s.text}</span>))}</>;
}
