// v0.20.1 a small, discreet '?' the player taps to read an explanation (the player: "For questions I asked you, it can
// be a small question mark I can press to see the info ... I never want once-off questions that I ask to become
// permanent visual clutter"). Explanations live here, not as lines on the screen. The glossary's popover (Term.tsx):
// one at a time, closes on a tap elsewhere, Escape or a scroll, keeps clear of the bug button; works by touch and keys.

import { useRef, type ReactNode } from 'react';
import { PopBox, usePopover } from './Term';

/** `title`: the popover's heading (and what the button is about: "Open tender: what it means"). `children`: the text. */
export function Help({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  const [open, toggle, close] = usePopover();
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <>
      {/* A span, not a button: it also sits inside cards that are buttons themselves (its tap never opens the card). */}
      <span ref={ref} role="button" tabIndex={0} className={`help-q ${open ? 'on' : ''} ${className ?? ''}`} aria-label={`${title}: what it means`} aria-expanded={open} onClick={toggle} onKeyDown={(k) => (k.key === 'Enter' || k.key === ' ') && toggle(k)}>?</span>
      {open && ref.current && (
        <PopBox anchor={ref.current} onClose={close} label={title}>
          <b>{title}</b>
          {/* v0.21 a block, so an answer can be a few short paragraphs; a long one scrolls inside the box. */}
          <div className="small help-body">{children}</div>
        </PopBox>
      )}
    </>
  );
}
