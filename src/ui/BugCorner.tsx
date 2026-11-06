// v0.17.1 the one way to report a bug (player: "a little discreet button in the corner, barely noticeable"): a faint bug
// in the lower left corner of every screen, above every dialog. A press freezes game time (invisibly: the speed is
// untouched), notes where the player is (screen, open dialog and its subject, selection), takes a screenshot of exactly
// what is shown (the button itself left out), then opens the report form over everything. Closing the form lets time
// run again as it was. The layout keeps the corner free (--bug-inset in v0171.css), so the button never covers a control.

import { Bug } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { BugContext, BugShot } from './bugReports';
import { captureScreen } from './bugShot';
import { BugForm, contextNow, prefillNow } from './modals/BugReportModals';
import { store } from './store';

const nextFrame = () => new Promise<void>((ok) => requestAnimationFrame(() => ok()));
/** Left out of the screenshot: the button and the capture shield. */
const skip = (el: Element) => el.classList.contains('bug-corner') || el.classList.contains('bug-shield');

export function BugCorner() {
  const [phase, setPhase] = useState<'idle' | 'capturing' | 'form'>('idle');
  const [data, setData] = useState<{ shot: BugShot | null; ctx: BugContext } | null>(null);
  /** The game's holdTime before the press (restored when the form closes). */
  const held = useRef<boolean | null>(null);
  const release = () => {
    if (held.current !== null) store.holdTime = held.current;
    held.current = null;
  };
  useEffect(() => release, []);

  const press = async () => {
    if (phase !== 'idle') return;
    held.current = store.holdTime;
    store.holdTime = true;
    let ctx: BugContext;
    try {
      ctx = contextNow(store.game, prefillNow());
    } catch (e) {
      console.warn('[bug report] context', e);
      ctx = contextNow(null);
    }
    flushSync(() => setPhase('capturing'));
    await nextFrame();
    await nextFrame();
    const shot = await captureScreen(skip);
    setData({ shot, ctx });
    setPhase('form');
  };
  const close = () => {
    setPhase('idle');
    setData(null);
    release();
  };

  return (
    <>
      {phase === 'idle' && (
        <button className="bug-corner" onClick={press} aria-label="Report a bug" title="Report a bug">
          <Bug aria-hidden />
        </button>
      )}
      {/* While the picture is taken nothing on screen can be tapped (invisible; not in the picture). */}
      {phase === 'capturing' && <div className="bug-shield" aria-busy="true" />}
      {phase === 'form' && data && (
        // Keys typed here stay here (Space would pause, numbers change speed in the shell).
        <div className="bug-layer" onKeyDown={(e) => e.stopPropagation()}>
          <BugForm shot={data.shot} ctx={data.ctx} onClose={close} />
        </div>
      )}
    </>
  );
}
