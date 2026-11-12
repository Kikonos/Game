// v0.9 §14.2 the first-time hint of a screen: one slim static line under the header (a 360 px card floating over the map),
// Got it · Don't show again. No animation. v0.12: once seen it folds into the screen's '?' button (HintButton in the
// screen head, or the '?' the screen already has: Schedule and map colours), which shows it again on a tap.

import { HelpCircle, Lightbulb } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { PopBox, usePopover } from './Term';
import { foldHint, HINT_SEEN_MS, hintMode, SCREEN_HINTS, type ScreenHintId } from '../screenHints';
import { store, useStore } from '../store';

const fold = (id: ScreenHintId) => {
  const s = store.settings;
  if (!s.screenHintsFolded.includes(id)) store.setSettings({ screenHintsFolded: foldHint(s.screenHintsFolded, id) });
};
const off = (id: ScreenHintId) => store.setSettings({ screenHintsSeen: [...store.settings.screenHintsSeen, id] });

export function ScreenHint({ id, className }: { id: ScreenHintId; className?: string }) {
  const s = useStore();
  const strip = hintMode(id, s.settings) === 'strip';
  // Seen once: leaving the screen after the strip has shown a moment folds it into '?' for next time.
  useEffect(() => {
    if (!strip) return;
    const t0 = performance.now();
    return () => { if (performance.now() - t0 >= HINT_SEEN_MS) fold(id); };
  }, [strip, id]);
  if (!strip) return null;
  return (
    <div className={`v9-hint ${className ?? ''}`} role="note" data-hint={id}>
      <Lightbulb className="v9-hint-ico" aria-hidden />
      <span className="small grow v9-hint-t">{SCREEN_HINTS[id]}</span>
      <span className="row gap-8 v9-hint-b">
        <button className="btn btn-sm" onClick={() => fold(id)}>Got it</button>
        <button className="btn btn-sm btn-ghost" onClick={() => off(id)}>Don’t show again</button>
      </span>
    </div>
  );
}

/** v0.12 the hint's text inside another '?' popover (Schedule and map colours) while it is folded; nothing otherwise. */
export function HintNote({ id }: { id: ScreenHintId }) {
  const s = useStore();
  if (hintMode(id, s.settings) !== 'fold') return null;
  return (
    <div className="v12-hint-note small" data-hint-note={id}>
      <Lightbulb className="v9-hint-ico" aria-hidden />
      <span className="grow">{SCREEN_HINTS[id]}</span>
    </div>
  );
}

/** v0.12 a folded hint's '?' button (screen heads, dialog titles): tap for the hint; nothing while the strip shows or after
 *  'Don't show again'. */
export function HintButton({ id }: { id: ScreenHintId; align?: 'left' | 'right' }) {
  const s = useStore();
  const [open, toggle, close] = usePopover();
  const ref = useRef<HTMLButtonElement>(null);
  if (hintMode(id, s.settings) !== 'fold') return null;
  return (
    <span className="sc-pop-wrap v12-hint-wrap">
      <button ref={ref} className={`btn btn-icon v12-hint-btn ${open ? 'btn-on' : ''}`} onClick={toggle} aria-label="Tip for this screen" aria-expanded={open} data-hint-btn={id}><HelpCircle /></button>
      {/* v0.23.1 on the page itself, whole on the screen (it opened off the left edge of Crew: bmwdgjk45aj1h). */}
      {open && ref.current && (
        <PopBox anchor={ref.current} onClose={close} label="Tip" className="v12-hint-pop">
          <div className="row gap-8"><Lightbulb className="v9-hint-ico" aria-hidden /><span className="small">{SCREEN_HINTS[id]}</span></div>
          <span className="row gap-8">
            <button className="btn btn-sm" onClick={close}>Got it</button>
            <button className="btn btn-sm btn-ghost" onClick={() => { close(); off(id); }}>Don’t show again</button>
          </span>
        </PopBox>
      )}
    </span>
  );
}
