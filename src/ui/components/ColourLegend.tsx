// v0.7.1 colour legends (UPDATE-0.7.1.md §5, §10): a small '?' button (44 px) that opens a popover listing what
// red, amber, grey, dotted and solid mean on this screen. Static; a tap elsewhere closes it.

import { HelpCircle } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { toCss } from '../device';
import type { ScreenHintId } from '../screenHints';
import { HintNote } from './ScreenHint';

export interface LegendItem {
  /** A swatch class (lg-sw-… / sc-cal-sw k-…) or a custom node. */
  swatch: string | ReactNode;
  label: string;
}

/** The box's width in the page's px (styles/acmi/v071.css .lg-pop). */
const POP_W = 300;

/**
 * v0.12 `hint`: the screen's folded first-time hint shows on top of the list.
 * v0.22 `gestures`: what a tap, a hold and a pinch do on this screen (it used to be a line on the screen itself).
 */
export function ColourLegend({ title, items, align, hint, gestures }: { title: string; items: LegendItem[]; align?: 'left' | 'right'; hint?: ScreenHintId; gestures?: string[] }) {
  const [open, setOpen] = useState(false);
  // v0.22 the box is placed on the page itself (not inside its row, which clips it on a phone), on the side of the
  // button with more room (the roster board's '?' sits at the foot of the screen, where the box used to open below the
  // screen's edge), and never grows past the screen's own box: a long list scrolls inside.
  const btn = useRef<HTMLButtonElement>(null);
  const [fit, setFit] = useState<{ left: number; top?: number; bottom?: number; max: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !btn.current) return setFit(null);
    const r = btn.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    // The room inside the screen's own box (the top bar and the tab bar sit over what is outside it).
    const s = btn.current.closest('.screen')?.getBoundingClientRect();
    const below = Math.min(vh, s?.bottom ?? Infinity) - r.bottom - 20;
    const above = r.top - Math.max(0, s?.top ?? 0) - 20;
    const up = below < 360 && above > below;
    const left = Math.min(toCss(vw) - POP_W - 8, Math.max(8, align === 'left' ? toCss(r.left) : toCss(r.right) - POP_W));
    setFit({ left, ...(up ? { bottom: toCss(vh - r.top) + 8 } : { top: toCss(r.bottom) + 8 }), max: Math.max(160, toCss(up ? above : below)) });
  }, [open, align]);
  return (
    <span className="sc-pop-wrap lg-wrap">
      <button ref={btn} className={`btn btn-icon lg-btn ${open ? 'btn-on' : ''}`} onClick={() => setOpen(!open)} aria-label={`${title}: what the colours mean`} aria-expanded={open}><HelpCircle /></button>
      {open && createPortal(
        <>
          <button className="sc-pop-shade" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="sc-pop lg-pop lg-fixed card" role="dialog" aria-label={title} style={fit ? { left: fit.left, top: fit.top, bottom: fit.bottom, maxHeight: fit.max } : { left: 0, top: 0, visibility: 'hidden' }}>
            {hint && <HintNote id={hint} />}
            <b>{title}</b>
            <div className="lg-list">
              {items.map((it, i) => (
                <div key={i} className="lg-item small">
                  {typeof it.swatch === 'string' ? <span className={`lg-sw ${it.swatch}`} aria-hidden /> : it.swatch}
                  <span>{it.label}</span>
                </div>
              ))}
            </div>
            {gestures && gestures.length > 0 && (
              <>
                <b>Gestures</b>
                <div className="lg-list">{gestures.map((t, i) => <div key={i} className="lg-item small"><span>{t}</span></div>)}</div>
              </>
            )}
          </div>
        </>,
        document.body,
      )}
    </span>
  );
}
