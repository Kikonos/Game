// v0.9 §14.2 the first-time hint of a screen: one slim static line under the header (a 360 px card floating over the map),
// Got it · Don't show again. No animation.

import { Lightbulb } from 'lucide-react';
import { useState } from 'react';
import { hiddenThisSession, hideForSession, SCREEN_HINTS, type ScreenHintId } from '../screenHints';
import { store, useStore } from '../store';

export function ScreenHint({ id, className }: { id: ScreenHintId; className?: string }) {
  const s = useStore();
  const [, bump] = useState(0);
  if (s.settings.screenHintsSeen.includes(id) || hiddenThisSession(id)) return null;
  return (
    <div className={`v9-hint ${className ?? ''}`} role="note" data-hint={id}>
      <Lightbulb className="v9-hint-ico" aria-hidden />
      <span className="small grow v9-hint-t">{SCREEN_HINTS[id]}</span>
      <span className="row gap-8 v9-hint-b">
        <button className="btn btn-sm" onClick={() => { hideForSession(id); bump((x) => x + 1); }}>Got it</button>
        <button className="btn btn-sm btn-ghost" onClick={() => store.setSettings({ screenHintsSeen: [...s.settings.screenHintsSeen, id] })}>Don’t show again</button>
      </span>
    </div>
  );
}
