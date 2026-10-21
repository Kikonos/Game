// v0.7 the ladder-step celebration (UPDATE-0.7.md §F8.5): a static card for a ladder goal message (an Award, the
// title and body, the aircraft it opened in our colours). The store opens it once per message, never over another
// dialog; the usual goal toast is not shown for these.

import { Award, TrendingUp } from 'lucide-react';
import { artFor } from '../../data/acmiTypes';
import { typeOf } from '../../engine/core/perf';
import { GOALS } from '../../engine/ops';
import { AircraftArt } from '../components/AircraftArt';
import { Modal } from '../components/ui';
import { store, useGame } from '../store';

export function LadderStepModal({ messageId }: { messageId: string }) {
  const g = useGame();
  const m = g.messages.find((x) => x.id === messageId);
  const close = () => store.closeModal();
  if (!m) return null;
  const def = GOALS.find((d) => `Goal reached: ${d.title}` === m.title);
  const acType = m.ref?.kind === 'aircraft' ? g.fleet[m.ref.id]?.typeId : undefined;
  const types = (def?.ladder?.types?.length ? def.ladder.types : acType ? [acType] : []).slice(0, 3);
  const co = g.company;
  // The body ends '… (B763 · A332) Reliability +1.': the art names the types; the reward gets its own line.
  const bm = /^([\s\S]*?)\s*(?:\(([^()]*)\))?\s*(Reliability [+−-]\d+)\.?$/.exec(m.body);
  const body = bm ? bm[1] : m.body;
  const reward = bm?.[3];
  const see = () => {
    store.update((gg) => {
      const x = gg.messages.find((y) => y.id === messageId);
      if (x) x.read = true;
    });
    store.closeModal();
    store.navigate('company', { view: 'ladder' });
  };
  return (
    <Modal className="ls-step" title={m.title.replace(/^Goal reached: /, '')} icon={<Award className="gold" />} onClose={close} footer={
      <>
        <button className="btn" onClick={close}>Close</button>
        <button className="btn btn-primary" onClick={see}><TrendingUp /> See the ladder</button>
      </>
    }>
      <div className="ls-step-k upper dim">A step up the ladder</div>
      {!types.length && <div className="ls-step-award"><Award /></div>}
      {types.length > 0 && (
        <div className="ap-types ls-step-types">
          {types.map((t) => (
            <div key={t} className="ap-type"><div className="ap-art"><AircraftArt typeId={artFor(t)} livery={co.livery} code={co.code} name={co.name} detail="simple" /></div><span className="tiny">{typeOf(t)?.short ?? t}</span></div>
          ))}
        </div>
      )}
      <p className="muted">{body}</p>
      {reward && <div className="tiny dim ls-step-reward">Reward: {reward}</div>}
    </Modal>
  );
}
