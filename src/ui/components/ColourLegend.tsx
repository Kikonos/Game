// v0.7.1 colour legends (UPDATE-0.7.1.md §5, §10): a small '?' button (44 px) that opens a popover listing what
// red, amber, grey, dotted and solid mean on this screen. Static; a tap elsewhere closes it.

import { HelpCircle } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { toCss } from '../device';
import type { ScreenHintId } from '../screenHints';
import { HintNote } from './ScreenHint';

export interface LegendItem {
  /** A swatch class (lg-sw-… / sc-cal-sw k-…) or a custom node. */
  swatch: string | ReactNode;
  label: string;
}

/**
 * v0.12 `hint`: the screen's folded first-time hint shows on top of the list.
 * v0.22 `gestures`: what a tap, a hold and a pinch do on this screen (it used to be a line on the screen itself).
 */
export function ColourLegend({ title, items, align, hint, gestures }: { title: string; items: LegendItem[]; align?: 'left' | 'right'; hint?: ScreenHintId; gestures?: string[] }) {
  const [open, setOpen] = useState(false);
  // v0.22 the box opens to the side with more room (the roster board's '?' sits at the foot of the screen, where the
  // box used to open below the screen's edge) and never grows past it: a long list scrolls inside.
  const btn = useRef<HTMLButtonElement>(null);
  const [fit, setFit] = useState<{ up: boolean; max: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !btn.current) return setFit(null);
    const r = btn.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 20;
    const above = r.top - 20;
    const up = below < 360 && above > below;
    setFit({ up, max: Math.max(160, toCss(up ? above : below)) });
  }, [open]);
  return (
    <span className="sc-pop-wrap lg-wrap">
      <button ref={btn} className={`btn btn-icon lg-btn ${open ? 'btn-on' : ''}`} onClick={() => setOpen(!open)} aria-label={`${title}: what the colours mean`} aria-expanded={open}><HelpCircle /></button>
      {open && (
        <>
          <button className="sc-pop-shade" aria-label="Close" onClick={() => setOpen(false)} />
          <div className={`sc-pop lg-pop card ${align === 'left' ? 'left' : ''} ${fit?.up ? 'up' : ''}`} role="dialog" aria-label={title} style={fit ? { maxHeight: fit.max } : { visibility: 'hidden' }}>
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
        </>
      )}
    </span>
  );
}
