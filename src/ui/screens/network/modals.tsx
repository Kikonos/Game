// v0.19 the Network dialogs in their own chunk (loaded the first time one opens): the route page, the launch wizard
// and the rotation move.

import '../../../styles/acmi/v019.css';
import { RotationMoveModal } from '../../modals/RotationMoveModal';
import type { ModalSpec } from '../../store';
import { LaunchWizard } from './LaunchWizard';
import { RoutePage } from './RoutePage';

export type NetworkModalSpec = Extract<ModalSpec, { kind: 'route' | 'routeLaunch' | 'rotationMove' }>;

export default function NetworkModals({ m }: { m: NetworkModalSpec }) {
  switch (m.kind) {
    case 'route': return <RoutePage key={`${m.routeId}:${m.tab ?? ''}`} routeId={m.routeId} tab={m.tab} />;
    case 'routeLaunch': return <LaunchWizard key={`${m.routeId ?? ''}:${m.marketId ?? ''}`} routeId={m.routeId} marketId={m.marketId} />;
    case 'rotationMove': return <RotationMoveModal key={`${m.rotId}@${m.delta}`} rotId={m.rotId} delta={m.delta} back={m.back} />;
  }
}
