// v0.18.1 the small 'Specs' link that opens an aircraft spec sheet (ui/specs/SpecSheet.tsx, its own lazy chunk) from
// wherever an aircraft is owned or considered: Fleet cards, Market offers, the letter of intent and acquire dialogs,
// Ask lessors, the offer dialog's aircraft list. The sheet sits above any dialog (below the bug button), holds game
// time while open, and Escape or Close puts it away, leaving the dialog under it as it was.

import { FileText } from 'lucide-react';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { SpecSubject } from './specLogic';
import './specsLink.css';

/** What the sheet shows: one aircraft, an offer, a type, or up to three offers side by side. */
export type SpecTarget = SpecSubject | { kind: 'compare'; offerIds: string[] };

const Sheet = lazy(() => import('./SpecSheet'));

/** The sheet in a layer of its own, above dialogs (portal to the body). */
export function SpecLayer({ target, onClose }: { target: SpecTarget; onClose: () => void }) {
  return createPortal(
    <div className="spec-layer" onKeyDown={(e) => e.stopPropagation()}>
      <Suspense fallback={<div className="modal-backdrop"><div className="spec-wait" aria-busy="true" /></div>}>
        <Sheet target={target} onClose={onClose} />
      </Suspense>
    </div>,
    document.body,
  );
}

export function SpecsLink({ subject, label = 'Specs', className = '', children }: { subject: SpecTarget; label?: string; className?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button" className={`btn btn-sm spec-link ${className}`} aria-label={`${label}: aircraft spec sheet`}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        {children ?? <><FileText aria-hidden /> {label}</>}
      </button>
      {open && <SpecLayer target={subject} onClose={() => setOpen(false)} />}
    </>
  );
}
