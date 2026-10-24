// v0.9 §5.4 the celebration card of a department head just earned: the head's icon and title, what earned it, three
// candidates side by side (name, years, skill bar, salary, one line, Hire) and Not now. Queued like ladder steps, never
// over another dialog. `ids`: several earned at once (an old save) — a row of chips switches between them. Static.

import { PartyPopper, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { HEAD_DEFS } from '../../data/heads';
import type { HeadId } from '../../engine/core/types';
import { headView, hireHead } from '../../engine/ops';
import { NamedIcon } from '../components/NamedIcon';
import { Modal } from '../components/ui';
import { money } from '../format';
import { store, useGame } from '../store';

const TIER = ['Junior', 'Experienced', 'Senior'];

export function HeadUnlockedModal({ id, ids }: { id: HeadId; ids?: HeadId[] }) {
  const g = useGame();
  const [cur, setCur] = useState<HeadId>(id);
  const v = headView(g, cur);
  const def = HEAD_DEFS[cur];
  const close = () => store.closeModal();
  const team = () => {
    close();
    store.navigate('company', { view: 'team', sel: { kind: 'head', id: cur } });
  };
  const hire = (i: number) => {
    const r = store.act((gg) => hireHead(gg, cur, i));
    if (!r.ok) return;
    const rest = (ids ?? []).filter((x) => x !== cur && !headView(g, x).person);
    if (rest.length) setCur(rest[0]);
    else team();
  };
  return (
    <Modal size="wide" className="v9-unlock" title={`You've earned ${/^[AEIOU]/.test(def.title) ? 'an' : 'a'} ${def.title}`} icon={<PartyPopper className="gold" />} onClose={close} footer={
      <>
        <button className="btn" onClick={close}>Not now</button>
        <button className="btn" onClick={team}><Users /> Company › Team</button>
      </>
    }>
      {ids && ids.length > 1 && (
        <div className="row gap-8 wrap v9-unlock-tabs">
          {ids.map((x) => (
            <button key={x} className={`chip v9-unlock-tab ${x === cur ? 'active' : ''}`} onClick={() => setCur(x)} aria-pressed={x === cur}>
              <NamedIcon name={HEAD_DEFS[x].icon} />{HEAD_DEFS[x].title}
            </button>
          ))}
        </div>
      )}
      <div className="row gap-12 v9-unlock-head">
        <span className="v9-unlock-ico"><NamedIcon name={def.icon} /></span>
        <div className="col gap-4">
          <b>{def.earnedText}</b>
          <span className="small muted">{def.does[0]}. Never: {def.never[0].toLowerCase()}.</span>
        </div>
      </div>
      {v.person ? (
        <p className="muted">{v.person.name} already runs it.</p>
      ) : !v.candidates.length ? (
        <p className="muted">New candidates soon. They will show on Company › Team.</p>
      ) : (
        <div className="v9-cands">
          {v.candidates.map((c, i) => (
            <div key={`${c.name}-${i}`} className="card v9-cand">
              <div className="tiny upper dim">{TIER[i] ?? 'Candidate'}</div>
              <b>{c.name}</b>
              <span className="small muted">{c.years} years</span>
              <div className="col gap-4">
                <div className="row between tiny"><span className="dim">Skill</span><span className="num">{Math.round(c.skill * 100)}</span></div>
                <div className="bar thin good"><span style={{ width: `${Math.round(c.skill * 100)}%` }} /></div>
              </div>
              <span className="small"><b className="num">{money(c.salary)}</b><span className="muted"> a month</span></span>
              <span className="small muted v9-cand-blurb">{c.blurb}</span>
              <button className="btn btn-primary" onClick={() => hire(i)}><UserPlus /> Hire</button>
            </div>
          ))}
        </div>
      )}
      <div className="tiny dim">Higher skill means fewer mistakes. You can switch them off or let them go at any time.</div>
    </Modal>
  );
}
