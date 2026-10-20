// Training (B5): type rating, conversion, command upgrade or SCCM course for one crew member (crew.trainCrew).

import { GraduationCap } from 'lucide-react';
import { useState } from 'react';
import { ACMI_TYPES_LIST, type RatingFamily } from '../../data/acmiTypes';
import { BAL } from '../../engine/core/balance';
import { DAY, dayStart, fmtDate } from '../../engine/core/time';
import type { CrewMember, TrainingKind } from '../../engine/core/types';
import { crewName, trainCrew } from '../../engine/crew';
import { Modal, Seg } from '../components/ui';
import { money } from '../format';
import { KV } from '../screens/common';
import { isPilotRole, ROLE_LABEL } from '../screens/screenLogic';
import { store, useGame } from '../store';

const KIND_LABEL: Record<TrainingKind, string> = { typeRating: 'Type rating', conversion: 'Conversion', command: 'Command upgrade', sccm: 'SCCM course' };

function cost(c: CrewMember, kind: TrainingKind): { days: number; cost: number } {
  const p = isPilotRole(c.role);
  if (kind === 'typeRating') return p ? { days: BAL.typeRating.pilotDays, cost: BAL.typeRating.pilotCost } : { days: BAL.typeRating.cabinDays, cost: BAL.typeRating.cabinCost };
  if (kind === 'conversion') return p ? { days: BAL.conversion.pilotDays, cost: BAL.conversion.pilotCost } : { days: BAL.conversion.cabinDays, cost: BAL.conversion.cabinCost };
  if (kind === 'command') return { days: BAL.commandUpgrade.days, cost: BAL.commandUpgrade.cost };
  return { days: BAL.sccmCourse.days, cost: BAL.sccmCourse.cost };
}

export function TrainModal({ crewId }: { crewId: string }) {
  const g = useGame();
  const c = g.crew[crewId];
  const kinds: TrainingKind[] = ['typeRating', 'conversion'];
  if (c?.role === 'FO') kinds.push('command');
  if (c?.role === 'CC') kinds.push('sccm');
  const fams = [...new Set(ACMI_TYPES_LIST.map((t) => t.family))].filter((f) => !c?.ratings.includes(f));
  const [kind, setKind] = useState<TrainingKind>('typeRating');
  const [family, setFamily] = useState<RatingFamily>(fams[0] ?? 'A320');
  if (!c) return null;
  const needsFamily = kind === 'typeRating' || kind === 'conversion';
  const fam = needsFamily ? family : c.ratings[0] ?? family;
  const q = cost(c, kind);
  const train = () => {
    const res = store.act((gg) => trainCrew(gg, c.id, kind, fam));
    if (res.ok) store.closeModal();
  };
  return (
    <Modal title={`Train ${crewName(c)}`} icon={<GraduationCap className="accent" />} onClose={() => store.closeModal()} footer={
      <>
        <button className="btn" onClick={() => store.closeModal()}>Cancel</button>
        <button className="btn btn-primary" onClick={train} disabled={g.company.cash < q.cost}><GraduationCap /> Start for {money(q.cost)}</button>
      </>
    }>
      <div className="col gap-16">
        <div className="small muted">{ROLE_LABEL[c.role]} · rated {c.ratings.join(', ') || 'none'} · {Math.round(c.totalHours).toLocaleString('en-US')} h</div>
        <div className="sc-seg-wrap"><Seg<TrainingKind> value={kind} onChange={setKind} options={kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))} /></div>
        {needsFamily && (
          <div className="field">
            <label>New type</label>
            <select className="select" value={family} onChange={(e) => setFamily(e.target.value as RatingFamily)}>
              {fams.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        )}
        <KV rows={[
          ['Course', `${q.days} days`],
          ['Back on the line', fmtDate(dayStart(g.now) + q.days * DAY)],
          ['Cost', money(q.cost)],
        ]} />
        <div className="small dim">Rostered duties in the course window are re-crewed automatically.</div>
      </div>
    </Modal>
  );
}
