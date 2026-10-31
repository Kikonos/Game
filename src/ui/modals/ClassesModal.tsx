// v0.6 conversion classes (UPDATE-0.6.md §F2.3): planned and running classes with their dates, phase and members;
// cancel a class or one member, guarded by a confirm with the refund (100% / 50% / none once running).

import { GraduationCap, UserMinus } from 'lucide-react';
import { useState } from 'react';
import type { TrainingClass } from '../../engine/core/types';
import { DAY } from '../../engine/core/time';
import { baseDay } from '../screens/screenLogic';
import { cancelConversion, conversionClasses, courseText, crewName, familyLabel, refundShare } from '../../engine/crew';
import { Bar, Empty, Modal } from '../components/ui';
import { money } from '../format';
import { store, useGame } from '../store';

const refundText = (share: number, amount: number) => (share >= 1 ? `${money(amount)} refunded in full` : share > 0 ? `${money(amount)} refunded (half: less than 14 days to the start)` : 'No refund: the class is under way');

export function ClassesModal() {
  const g = useGame();
  const list = conversionClasses(g);
  const [open, setOpen] = useState<string | null>(list[0]?.id ?? null);
  const cancel = (k: TrainingClass, crewId?: string) => {
    const share = refundShare(g, k);
    const n = crewId ? 1 : k.crewIds.length;
    const amount = Math.round(k.costPerHead * n * share);
    const c = crewId ? g.crew[crewId] : undefined;
    store.openModal({
      kind: 'confirm', danger: true, confirm: crewId ? 'Take off the class' : 'Cancel class',
      title: crewId ? `Take ${c ? crewName(c) : 'them'} off ${k.no}?` : `Cancel ${k.no}?`,
      body: `${refundText(share, amount)}. ${crewId ? 'They go' : `${n} ${k.group === 'pilot' ? 'pilots' : 'cabin crew'} go`} back on the roster and keep their current ratings.`,
      onConfirm: () => {
        store.act((gg) => cancelConversion(gg, k.id, crewId));
        store.openModal({ kind: 'classes' });
      },
    });
  };
  return (
    <Modal size="wide" title="Conversion classes" icon={<GraduationCap className="accent" />} onClose={() => store.closeModal()}>
      {!list.length ? (
        <Empty icon={<GraduationCap />} title="No classes booked">Select crew in the Crew tab and choose Convert… to send them on a type conversion.</Empty>
      ) : (
        <div className="col gap-8">
          {list.map((k) => {
            const running = k.status === 'running';
            const prog = running ? Math.min(1, Math.max(0, (g.now - k.start) / (k.end - k.start))) : 0;
            const day = Math.floor((g.now - k.start) / DAY) + 1;
            const share = refundShare(g, k);
            const on = open === k.id;
            return (
              <div key={k.id} className={`card cl-class ${running ? 'running' : ''}`}>
                <button className="cl-head" onClick={() => setOpen(on ? null : k.id)} aria-expanded={on}>
                  <span className="col grow" style={{ minWidth: 0 }}>
                    <span className="row gap-8"><b>{k.no}</b><span className={`badge ${running ? 'info' : ''}`}>{running ? `Day ${day} of ${Math.round((k.end - k.start) / DAY)}` : 'Booked'}</span></span>
                    <span className="small muted ellipsis">Conversion {familyLabel(k.family)} · {k.crewIds.length} {k.group === 'pilot' ? 'pilots' : 'cabin crew'}{k.course === 'ccq' ? ` · ${courseText(g, k)}` : ''} · {baseDay(g, k.start)} – {baseDay(g, k.end - 1)}</span>
                  </span>
                  <span className="right nowrap"><b className="num">{money(k.costPerHead * k.crewIds.length)}</b><span className="tiny dim">{share ? `${Math.round(share * 100)}% refundable` : 'paid'}</span></span>
                </button>
                {running && <Bar value={prog} size="thin" />}
                {on && (
                  <div className="col gap-4 cl-members">
                    {k.crewIds.map((id) => {
                      const c = g.crew[id];
                      if (!c) return null;
                      return (
                        <div key={id} className="row gap-8 cl-member">
                          <span className={`sc-role r-${c.role}`}>{c.role}</span>
                          <button className="sc-seat-name ellipsis grow" onClick={() => store.navigate('crew', { sel: { kind: 'crew', id }, view: 'people' })}>{crewName(c)}</button>
                          {k.drop?.[id] && <span className="tiny dim nowrap">drops {k.drop[id]}</span>}
                          <button className="btn btn-ghost btn-icon" onClick={() => cancel(k, id)} aria-label={`Take ${crewName(c)} off ${k.no}`}><UserMinus /></button>
                        </div>
                      );
                    })}
                    <button className="btn btn-danger cl-cancel" onClick={() => cancel(k)}>Cancel {k.no}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
