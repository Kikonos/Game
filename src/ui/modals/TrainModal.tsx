// Training (B5, v0.6): type conversion (the bulk ConvertModal for this one person: same rules and prices),
// command upgrade or SCCM course for one crew member (crew.trainCrew).

import { ArrowRight, GraduationCap } from 'lucide-react';
import { useState } from 'react';
import { BAL } from '../../engine/core/balance';
import { DAY, dayStart, fmtDate } from '../../engine/core/time';
import type { TrainingKind } from '../../engine/core/types';
import { classOf, crewName, trainCrew } from '../../engine/crew';
import { Modal, Seg } from '../components/ui';
import { money } from '../format';
import { KV } from '../screens/common';
import { ROLE_LABEL } from '../screens/screenLogic';
import { store, useGame } from '../store';

type Kind = 'convert' | Extract<TrainingKind, 'command' | 'sccm'>;
const KIND_LABEL: Record<Kind, string> = { convert: 'Type conversion…', command: 'Command upgrade', sccm: 'SCCM course' };

export function TrainModal({ crewId }: { crewId: string }) {
  const g = useGame();
  const c = g.crew[crewId];
  const kinds: Kind[] = ['convert'];
  if (c?.role === 'FO') kinds.push('command');
  if (c?.role === 'CC') kinds.push('sccm');
  const [kind, setKind] = useState<Kind>('convert');
  if (!c) return null;
  const k = classOf(g, c.id);
  const q = kind === 'command' ? { days: BAL.commandUpgrade.days, cost: BAL.commandUpgrade.cost } : { days: BAL.sccmCourse.days, cost: BAL.sccmCourse.cost };
  const convert = () => store.openModal({ kind: 'convert', crewIds: [c.id] });
  const train = () => {
    const res = store.act((gg) => trainCrew(gg, c.id, kind as TrainingKind, c.ratings[0] ?? 'A320'));
    if (res.ok) store.closeModal();
  };
  return (
    <Modal title={`Train ${crewName(c)}`} icon={<GraduationCap className="accent" />} onClose={() => store.closeModal()} footer={
      <>
        <button className="btn" onClick={() => store.closeModal()}>Cancel</button>
        {kind === 'convert'
          ? <button className="btn btn-primary" onClick={convert}><ArrowRight /> Plan the conversion</button>
          : <button className="btn btn-primary" onClick={train} disabled={g.company.cash < q.cost}><GraduationCap /> Start for {money(q.cost)}</button>}
      </>
    }>
      <div className="col gap-16">
        <div className="small muted">{ROLE_LABEL[c.role]} · rated {c.ratings.join(', ') || 'none'} · {Math.round(c.totalHours).toLocaleString('en-US')} h</div>
        {k && <div className="small warn">Booked on {k.no} ({fmtDate(k.start)} – {fmtDate(k.end - 1)}). Cancel it from the classes chip on the Crew screen.</div>}
        {kinds.length > 1 && <div className="sc-seg-wrap"><Seg<Kind> value={kind} onChange={setKind} options={kinds.map((x) => ({ value: x, label: KIND_LABEL[x] }))} /></div>}
        {kind === 'convert' ? (
          <div className="small muted">A type conversion puts this person in a class on the new type, with the same rules and prices as a bulk conversion: pilots about 6 weeks, cabin crew about 8 days. To convert several people at once, use Select on the Crew screen.</div>
        ) : (
          <>
            <KV rows={[
              ['Course', `${q.days} days`],
              ['Back on the line', fmtDate(dayStart(g.now) + q.days * DAY)],
              ['Cost', money(q.cost)],
            ]} />
            <div className="small dim">Rostered duties in the course window are re-crewed automatically.</div>
          </>
        )}
      </div>
    </Modal>
  );
}
