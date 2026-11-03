// v0.15 the Ops Map's 3D globe switch: the globe button (by the zoom controls), the lazily loaded globe itself (three.js
// comes with it, in its own chunk, only when the player opens the globe) and the fallback. If WebGL is missing or the
// globe fails to draw (or its chunk cannot load), the flat map comes back with a quiet note, and the globe is not tried
// again this session. The player's choice is kept in settings (Display › 3D globe hides the button altogether).

import { Globe as GlobeIcon } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { ErrorBoundary } from '../ErrorBoundary';
import { store } from '../store';
import type { GlobeProps } from './globe/Globe';

const GlobeLazy = lazy(() => import('./globe/Globe'));

/** The globe failed once this session (no WebGL, a lost chunk): the flat map only, until a reload. */
let broken = false;
/** When the note about it goes (ms, performance.now()). */
let noteUntil = 0;
const NOTE_MS = 6000;

/** Whether the Map shows the globe now, and how to switch (call while rendering: reads settings). */
export function useGlobe(): { on: boolean; show: (on: boolean) => void; failed: boolean; fail: () => void } {
  const [failed, setFailed] = useState(broken);
  const st = store.settings;
  return {
    on: st.globe && st.globeView && !failed,
    show: (on: boolean) => store.setSettings({ globeView: on }),
    failed,
    fail: () => {
      if (!broken) noteUntil = performance.now() + NOTE_MS;
      broken = true;
      setFailed(true);
    },
  };
}

/** The globe button at the top of the flat map's zoom controls. */
export function GlobeButton({ onClick }: { onClick: () => void }) {
  return <button className="btn btn-icon btn-sm" onClick={onClick} aria-label="3D globe" title="3D globe"><GlobeIcon /></button>;
}

/** The lazily loaded globe inside a 'view' error boundary (a failure falls back to the flat map). */
export function GlobeHost({ onFail, ...p }: GlobeProps & { onFail: () => void }) {
  return (
    <ErrorBoundary scope="view" onError={onFail}>
      <Suspense fallback={<div className="globe-wait" />}>
        <GlobeLazy {...p} onUnavailable={onFail} />
      </Suspense>
    </ErrorBoundary>
  );
}

/** A quiet note on the flat map for a few seconds after the globe could not open. */
export function GlobeNote({ show }: { show: boolean }) {
  const left = () => noteUntil - performance.now();
  const [on, setOn] = useState(() => show && left() > 0);
  useEffect(() => {
    if (!show || left() <= 0) return;
    setOn(true);
    const t = window.setTimeout(() => setOn(false), left());
    return () => window.clearTimeout(t);
  }, [show]);
  return on ? <div className="globe-note" role="status">The 3D globe is not available here, so the flat map is shown.</div> : null;
}
