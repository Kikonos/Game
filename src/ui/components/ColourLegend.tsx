// v0.7.1 colour legends (UPDATE-0.7.1.md §5, §10): a small '?' button (44 px) that opens a popover listing what
// red, amber, grey, dotted and solid mean on this screen. Static; a tap elsewhere closes it.

import { HelpCircle } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import type { ScreenHintId } from '../screenHints';
import { HintNote } from './ScreenHint';
import { PopBox, usePopover } from './Term';

export interface LegendItem {
  /** A swatch class (lg-sw-… / sc-cal-sw k-…) or a custom node. */
  swatch: string | ReactNode;
  label: string;
}

/**
 * v0.12 `hint`: the screen's folded first-time hint shows on top of the list.
 * v0.22 `gestures`: what a tap, a hold and a pinch do on this screen (it used to be a line on the screen itself).
 */
export function ColourLegend({ title, items, hint, gestures }: { title: string; items: LegendItem[]; align?: 'left' | 'right'; hint?: ScreenHintId; gestures?: string[] }) {
  // v0.22 the box is placed on the page itself (not inside its row, which clips it on a phone); v0.23.1 by the same rule
  // as every '?' box (Term.tsx PopBox): under the button, else above or beside it, whole on the screen; a long list
  // scrolls inside.
  const [open, toggle, close] = usePopover();
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <span className="sc-pop-wrap lg-wrap">
      <button ref={btn} className={`btn btn-icon lg-btn ${open ? 'btn-on' : ''}`} onClick={toggle} aria-label={`${title}: what the colours mean`} aria-expanded={open}><HelpCircle /></button>
      {open && btn.current && (
        <PopBox anchor={btn.current} onClose={close} label={title} className="lg-pop">
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
        </PopBox>
      )}
    </span>
  );
}
