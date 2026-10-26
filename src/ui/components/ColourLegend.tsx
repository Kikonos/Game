// v0.7.1 colour legends (UPDATE-0.7.1.md §5, §10): a small '?' button (44 px) that opens a popover listing what
// red, amber, grey, dotted and solid mean on this screen. Static; a tap elsewhere closes it.

import { HelpCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { ScreenHintId } from '../screenHints';
import { HintNote } from './ScreenHint';

export interface LegendItem {
  /** A swatch class (lg-sw-… / sc-cal-sw k-…) or a custom node. */
  swatch: string | ReactNode;
  label: string;
}

/** v0.12 `hint`: the screen's folded first-time hint shows on top of the list. */
export function ColourLegend({ title, items, align, hint }: { title: string; items: LegendItem[]; align?: 'left' | 'right'; hint?: ScreenHintId }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="sc-pop-wrap lg-wrap">
      <button className={`btn btn-icon lg-btn ${open ? 'btn-on' : ''}`} onClick={() => setOpen(!open)} aria-label={`${title}: what the colours mean`} aria-expanded={open}><HelpCircle /></button>
      {open && (
        <>
          <button className="sc-pop-shade" aria-label="Close" onClick={() => setOpen(false)} />
          <div className={`sc-pop lg-pop card ${align === 'left' ? 'left' : ''}`} role="dialog" aria-label={title}>
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
          </div>
        </>
      )}
    </span>
  );
}
