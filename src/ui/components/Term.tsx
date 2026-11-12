// v0.7.1 tap-to-explain glossary (UPDATE-0.7.1.md §5, §11): <Term id="fdp"> renders the term with a dotted underline;
// a tap opens one small popover with the one-line meaning and a 'Glossary ›' link. Any tap elsewhere dismisses it.
// One popover at a time (module-level state). Static: nothing animates.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { GLOSSARY, type TermId } from '../../data/glossary';
import { store } from '../store';
import { termSegments } from './problemLogic';
import { toCss, uiZoomNow } from '../device';
import { placePop, type Insets } from './popPlace';

let closeOpen: (() => void) | null = null;

/**
 * The small floating box under (or above) its anchor: closes on a tap elsewhere, Escape, a scroll, a dialog or a tab
 * change. v0.20.1 shared by the glossary terms and the '?' notes (Help.tsx); kept clear of the bug button's corner.
 * v0.23.1 every '?' box of the game opens through it (the screen tips, the colour legends, the map's Up next): placed on
 * the page itself, whole on the screen, under its button, else above or beside it (popPlace.ts). They used to hang off
 * their button inside the screen, where Crew's tip opened off the left edge and Up next's was cut off by its panel
 * (player reports bmwdgjk45aj1h, bmwdgkcfg2ur3). `className`: the box's own look (its width).
 */
export function PopBox({ anchor, onClose, label, children, className }: { anchor: HTMLElement; onClose: () => void; label: string; children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = anchor.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    // v0.22 the placement is popPlace.ts: under the anchor or above it, whole on the screen, inside the device's safe
    // area (a phone on its side: the camera island's strip and the home bar) and clear of the bug button, by where the
    // button really is (a phone on its side moves it in by the safe area).
    const bug = document.querySelector('.bug-corner')?.getBoundingClientRect() ?? null;
    const { left, top: y } = placePop(r, b, window.innerWidth, window.innerHeight, safeInsets(), bug);
    // v0.12 rects are screen px; the popover is placed in the page's px (Settings › Size zooms the page).
    setPos({ left: toCss(left), top: toCss(y) });
  }, [anchor]);
  useEffect(() => {
    const down = (e: Event) => {
      const t = e.target as Node | null;
      if (t && (box.current?.contains(t) || anchor.contains(t))) return;
      onClose();
    };
    // Escape closes the box alone (not the dialog under it, nor the menu behind).
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    // v0.21 a scroll of the page behind closes it; a scroll inside the box itself (a long answer) does not.
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
    <div ref={box} className={`term-pop ${className ?? ''}`} role="dialog" aria-label={label} style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}>
      {children}
    </div>,
    document.body,
  );
}
/** The device's safe-area insets in screen px (the page's own --safe-* lengths, read off a probe; 0 where none). */
function safeInsets(): Insets {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:var(--vp-safe-t,0px) var(--safe-r,0px) var(--vp-safe-b,0px) var(--safe-l,0px)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const z = uiZoomNow();
  const px = (v: string) => (parseFloat(v) || 0) * z;
  const out = { t: px(cs.paddingTop), r: px(cs.paddingRight), b: px(cs.paddingBottom), l: px(cs.paddingLeft) };
  probe.remove();
  return out;
}

/**
 * One popover at a time: opening one closes the one that was open. Returns [open, toggle, close] for a component's
 * own popover.
 */
export function usePopover(): [boolean, (e: { stopPropagation: () => void; preventDefault?: () => void }) => void, () => void] {
  const [open, setOpen] = useState(false);
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
  return [open, toggle, close];
}

function Popover({ id, anchor, onClose, extra, own }: { id: TermId; anchor: HTMLElement; onClose: () => void; extra?: string; own?: boolean }) {
  const e = GLOSSARY[id];
  return (
    <PopBox anchor={anchor} onClose={onClose} label={e.term}>
      <b>{e.term}</b>
      {!(own && extra) && <span className="small">{e.short}</span>}
      {extra && <span className={`small ${own ? '' : 'muted'}`}>{extra}</span>}
      <button className="btn btn-sm btn-ghost term-more" onClick={() => { onClose(); store.openModal({ kind: 'glossary', term: id }); }}>Glossary ›</button>
    </PopBox>
  );
}

/**
 * v0.7.4 `extra`: a line about this very thing under the glossary meaning (e.g. this aircraft's longest day).
 * v0.9 `own`: `extra` says it all, so it replaces the glossary meaning (no line said twice).
 */
export function Term({ id, children, extra, own }: { id: TermId; children?: ReactNode; extra?: string; own?: boolean }) {
  const [open, toggle, close] = usePopover();
  const ref = useRef<HTMLSpanElement>(null);
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
