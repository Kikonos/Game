// v0.17 (UPDATE-0.17.md §H, §N.3; lane `market-ui`): Add a type to our AOC. Four lines (what · cost · time · what it
// needs) and Apply. The first widebody family rides on Widebody operations (no variation), and the 737, 757/767 and
// the rest each need their own.

import { ClipboardCheck, Users } from 'lucide-react';
import { useState } from 'react';
import { ACMI_TYPES_LIST, type RatingFamily } from '../../data/acmiTypes';
import { typeOf } from '../../engine/core/perf';
import { fmtDay } from '../../engine/core/time';
import { aocView, applyVariation, needsVariation, variationCrew, variationQuote } from '../../engine/leasing';
import { Modal } from '../components/ui';
import { Term } from '../components/Term';
import { AOC_NOTE } from '../screens/company/AocTypes';
import { money } from '../format';
import { store, useGame } from '../store';

/** Families a player can add: every family of a type on the market, not yet on the AOC. */
function families(held: RatingFamily[]): RatingFamily[] {
  const all: RatingFamily[] = [];
  for (const t of ACMI_TYPES_LIST) if (t.available && !all.includes(t.family) && !held.includes(t.family)) all.push(t.family);
  return all;
}

export function AocModal({ family: wanted }: { family?: RatingFamily }) {
  const g = useGame();
  const view = aocView(g);
  const list = families(view.families);
  // The family a fleet aircraft or a deal needs first, else the first one.
  const needed = [...Object.values(g.fleet).map((a) => a.typeId), ...(g.leasing?.deals ?? []).map((d) => d.offer.typeId)].map((id) => typeOf(id).family).find((f) => list.includes(f) && needsVariation(g, f));
  const [fam, setFam] = useState<RatingFamily | undefined>(wanted && list.includes(wanted) ? wanted : needed ?? list[0]);
  const close = () => store.closeModal();
  const q = fam ? variationQuote(g, fam) : null;
  const pending = fam ? view.variations.find((v) => v.family === fam) : undefined;
  const need = fam ? variationCrew(fam) : null;
  const apply = () => {
    if (!fam) return;
    const r = store.act((gg) => applyVariation(gg, fam));
    if (r.ok) close();
  };
  const blocker = !fam ? 'Every family we could fly is on our AOC' : pending ? `Filed: due ${fmtDay(pending.done)}` : !q ? (view.withWidebody === fam ? 'Comes with Widebody operations' : 'No variation needed') : g.company.cash < q.cost ? `Needs ${money(q.cost)} · ${money(g.company.cash)} cash` : null;
  return (
    <Modal title={<Term id="aocVariation" extra={AOC_NOTE}>Add a type to our AOC</Term>} icon={<ClipboardCheck className="accent" />} onClose={close} footer={
      <>
        {blocker && <span className="grow small muted">{blocker}</span>}
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn btn-primary" onClick={apply} disabled={!!blocker}><ClipboardCheck /> Apply{q ? ` (${money(q.cost)})` : ''}</button>
      </>
    }>
      <div className="col gap-12">
        <div className="small muted">On our AOC: {view.families.join(', ') || 'none yet'}</div>
        {list.length > 0 && (
          <div className="ao-fam" role="group" aria-label="Family">
            {list.map((f) => <button key={f} className={`mk-filter ${fam === f ? 'on' : ''}`} aria-pressed={fam === f} onClick={() => setFam(f)}>{f}</button>)}
          </div>
        )}
        {fam && (
          <div className="rf-box">
            <div className="row gap-8 small"><b className="nowrap">What</b><span>Add the {fam} to our AOC: OM-B, the MEL, the training and maintenance programmes.</span></div>
            <div className="row gap-8 small"><b className="nowrap">Cost</b><span>{q ? money(q.cost) : view.withWidebody === fam ? 'Included in Widebody operations' : 'Nothing'}</span></div>
            <div className="row gap-8 small"><b className="nowrap">Time</b><span>{pending ? `Due ${fmtDay(pending.done)}` : q ? `${q.days} days: about ${fmtDay(q.due)} if filed today` : 'At the grant of Widebody operations'}</span></div>
            <div className="row gap-8 small"><b className="nowrap">Needs</b><span>{need ? `${need.CPT} rated captains and ${need.FO} first officers before the grant${q && (q.missing.CPT || q.missing.FO) ? ` (${q.missing.CPT + q.missing.FO} more to rate)` : ''}` : ''}</span></div>
          </div>
        )}
        {/* v0.24 conversions onto the type open once the variation is filed (leasing/aoc.ts crewTypeBlock). */}
        {q && pending && (q.missing.CPT > 0 || q.missing.FO > 0) && (
          <div className="row gap-8"><span className="small muted grow">Conversions take about 6 weeks</span><button className="btn btn-sm" onClick={() => { close(); store.navigate('crew'); }}><Users /> Book conversions</button></div>
        )}
      </div>
    </Modal>
  );
}
