// v0.23.1 the Network screen (report bmwdolc94ctrb): our scheduled routes, their studies and the markets, on the rail
// between Contracts and Schedule (was Contracts › Network). The view itself loads lazily with its stylesheet.

import { lazy, Suspense } from 'react';
import { useGame } from '../store';
import { ScreenHead, useRenderCount } from './common';

const NetworkView = lazy(() => import('./network'));

export function NetworkScreen() {
  useRenderCount('network');
  const g = useGame();
  return (
    <div className="screen sc-network">
      <ScreenHead title="Network" />
      <Suspense fallback={null}><NetworkView g={g} /></Suspense>
    </div>
  );
}
