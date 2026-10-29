// v0.12 an iPhone held upright: a calm, centred 'Turn your phone sideways' card over the game (the player plays in
// landscape; the map, schedule and roster board need the width). 'Play upright' hides it until the app restarts.

import { Smartphone } from 'lucide-react';
import { useState } from 'react';
import { deviceNow } from '../device';
import { PORTRAIT, useMedia } from '../useMedia';

export function RotateHint() {
  const portrait = useMedia(PORTRAIT);
  const narrow = useMedia('(max-width: 699.98px)');
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || !portrait || !narrow || deviceNow().form !== 'phone') return null;
  return (
    <div className="rotate-hint" role="dialog" aria-modal="true" aria-label="Turn your phone sideways">
      <div className="rotate-card">
        <span className="rotate-ico" aria-hidden><Smartphone /></span>
        <h2>Turn your phone sideways</h2>
        <p className="muted">BLOCK HOURS is laid out for landscape: the map, the schedule and the roster board need the width.</p>
        <button className="btn btn-ghost" onClick={() => setDismissed(true)}>Play upright anyway</button>
      </div>
    </div>
  );
}
