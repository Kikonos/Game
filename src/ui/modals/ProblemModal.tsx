// v0.7.1 the WHY? dialog (UPDATE-0.7.1.md §10): the full four-line card of one problem with its visual aid and action
// buttons. With `hint` it is the first-time story for that kind of problem (HINTS), with 'Don't show again' / 'Got it'.

import { Lightbulb, ShieldAlert } from 'lucide-react';
import { HINTS } from '../../data/glossary';
import type { ProblemRef } from '../../engine/core/types';
import { problemFor } from '../../engine/problems';
import { Modal } from '../components/ui';
import { ProblemCardView } from '../components/ProblemCard';
import { store, useGame } from '../store';

export function ProblemModal({ subject, hint }: { subject: ProblemRef; hint?: boolean }) {
  const g = useGame();
  const card = problemFor(g, subject);
  const h = hint ? HINTS[subject.kind] : undefined;
  const close = () => store.closeModal();
  const never = () => {
    store.hintSeen(subject.kind);
    close();
  };
  const title = h ? h.title : card ? 'Why?' : 'Dealt with';
  return (
    <Modal className="pm-modal" title={title} icon={h ? <Lightbulb className="gold" /> : <ShieldAlert className={card?.severity === 'red' ? 'bad' : 'warn'} />} onClose={close} footer={
      h ? (
        <>
          <button className="btn" onClick={never}>Don't show again</button>
          <button className="btn btn-primary" onClick={close}>Got it</button>
        </>
      ) : <button className="btn btn-primary" onClick={close}>Close</button>
    }>
      {h && <p className="pm-hint">{h.text}</p>}
      {card ? (
        <ProblemCardView card={card} g={g} />
      ) : (
        <p className="muted">{h ? 'That one has been dealt with in the meantime; the card shows on the next warning of this kind.' : 'This has been dealt with: nothing is wrong here any more.'}</p>
      )}
      {h && <div className="tiny dim mt-8">Shown once, the first time this kind of problem appears. 'Don't show again' keeps it off for good; the card itself stays on every warning.</div>}
    </Modal>
  );
}
