// v0.15 the welcome card of a new game: a few plain points on how the job works (a scenario: its briefing), one
// button. Opened once by the store when a new game starts (never on a load); its low chime rings as it appears.

import { PlaneTakeoff } from 'lucide-react';
import { Modal } from '../components/ui';
import { store, useGame } from '../store';
import { welcomeCard } from '../welcome';

export function WelcomeModal() {
  const g = useGame();
  const w = welcomeCard(g);
  const close = () => store.closeModal();
  return (
    <Modal className="v15-welcome" title={w.title} icon={<PlaneTakeoff className="accent" />} onClose={close} footer={
      <button className="btn btn-primary" onClick={close} autoFocus>{w.button}</button>
    }>
      <p className="muted v15-welcome-lead">{w.lead}</p>
      <ul className="v15-welcome-points">
        {w.points.map((p) => <li key={p}>{p}</li>)}
      </ul>
    </Modal>
  );
}
