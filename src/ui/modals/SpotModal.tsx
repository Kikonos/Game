// v0.17 (UPDATE-0.17.md §I, §N.3; lane `market-ui`): Short-term aircraft from airlines in their quiet season. Family
// (one already on our AOC), months (3–9), from; the airlines with spare aircraft in that window. Ask.

import { CalendarClock } from 'lucide-react';
import { useState } from 'react';
import type { RatingFamily } from '../../data/acmiTypes';
import { SPOT_SOURCES } from '../../data/market';
import { BAL } from '../../engine/core/balance';
import { typeOf } from '../../engine/core/perf';
import { fromUTC, toDate } from '../../engine/core/time';
import { askSpot, spotSources } from '../../engine/leasing';
import { Modal, Seg, Stepper } from '../components/ui';
import { store, useGame } from '../store';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function SpotModal({ family: wanted }: { family?: RatingFamily }) {
  const g = useGame();
  // Families an airline subleases (data/market.ts SPOT_SOURCES) that are already on our AOC.
  const spotFams = [...new Set(SPOT_SOURCES.map((s) => typeOf(s.typeId).family))];
  const fams = (g.company.aocFamilies ?? []).filter((f) => spotFams.includes(f));
  const [fam, setFam] = useState<RatingFamily | undefined>(wanted && fams.includes(wanted) ? wanted : fams[0]);
  const P = BAL.v017.spot;
  const [months, setMonths] = useState(4);
  const d = toDate(g.now);
  const opts = Array.from({ length: 12 }, (_, i) => {
    const y = d.getUTCFullYear() + Math.floor((d.getUTCMonth() + i) / 12);
    const m = (d.getUTCMonth() + i) % 12;
    return { t: i === 0 ? g.now : fromUTC(y, m + 1, 1), label: i === 0 ? 'Now' : `${MONTHS[m]} ${y}` };
  });
  const [from, setFrom] = useState(opts[0].t);
  const who = fam ? spotSources(g, { family: fam, months, from }) : [];
  const open = (g.leasing?.rfps ?? []).some((r) => r.spot && r.status === 'open');
  const close = () => store.closeModal();
  const ask = () => {
    if (!fam) return;
    const r = store.act((gg) => askSpot(gg, { family: fam, months, from }));
    if (!r.ok) return;
    close();
    store.navigate('fleet', { view: 'market', sel: { kind: 'rfp', id: r.data!.rfpId } });
  };
  const blocker = !fam ? `Short-term aircraft need a family we already fly: airlines sublease ${spotFams.join(', ')}` : open ? 'A short-term request is already out' : !who.length ? `No airline has a spare ${fam} for ${months} months from then` : null;
  return (
    <Modal title="Short-term aircraft" icon={<CalendarClock className="accent" />} onClose={close} footer={
      <>
        {blocker && <span className="grow small muted">{blocker}</span>}
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn btn-primary" onClick={ask} disabled={!!blocker}><CalendarClock /> Ask the airlines</button>
      </>
    }>
      <div className="rf-rows">
        <div className="small muted">Airlines sublease spare aircraft in their quiet season: quick to start, at a premium (rent 15–30 % over a normal lease), back on a fixed date. No lessor credit check: the airline asks a deposit only.</div>
        {fams.length > 0 && (
          <div className="rf-row">
            <span className="upper dim">Family</span>
            <Seg<RatingFamily> value={fam ?? fams[0]} onChange={setFam} options={fams.map((f) => ({ value: f, label: f }))} />
          </div>
        )}
        <div className="rf-row">
          <span className="upper dim">Months</span>
          <Stepper value={months} onChange={setMonths} min={P.months[0]} max={P.months[1]} format={(v) => `${v} months`} />
        </div>
        <div className="rf-row">
          <span className="upper dim">From</span>
          <select className="select input" value={from} onChange={(e) => setFrom(Number(e.target.value))} aria-label="From">
            {opts.map((o) => <option key={o.t} value={o.t}>{o.label}</option>)}
          </select>
        </div>
        <div className="rf-box">
          <b className="small">{who.length ? `Airlines with spare ${fam === 'B737' ? '737' : fam}s in that window: ${who.join(', ')}` : 'No airline has a spare one in that window'}</b>
          <span className="tiny dim">They answer in 3–10 days with 0–2 offers. The aircraft goes back to the airline's base on the return date; late costs twice the daily rent.</span>
        </div>
      </div>
    </Modal>
  );
}
