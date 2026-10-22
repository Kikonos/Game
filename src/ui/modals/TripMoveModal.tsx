// v0.7.2.1 Trip swap: the confirm pop-up for moving a whole trip to another aircraft (Schedule drag and drop, or
// the flight sheet's 'Move trip to…'). Verdict first in big words, then the legs, the before/after money table and
// plain notes (ferries, crew, what the first aircraft is free for). Everything comes from quoteTripMove.

import { ArrowRightLeft, Plane, TriangleAlert } from 'lucide-react';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { typeOf } from '../../engine/core/perf';
import { fmtDateTime, fmtDuration, fmtTime } from '../../engine/core/time';
import { MONEY_LINES, moneyTotal, moveTrip, quoteTripMove, type TripMoney, type TripMoveQuote } from '../../engine/ops/tripMove';
import { Modal } from '../components/ui';
import { store, useGame } from '../store';

/** '$12,400' to the nearest hundred (a quote, not an invoice). */
export function usdRound(v: number): string {
  return `$${(Math.round(Math.abs(v) / 100) * 100).toLocaleString('en-US')}`;
}
/** '+$12,400' / '−$8,900' / '$0'. */
export function usdSigned(v: number): string {
  const r = Math.round(v / 100) * 100;
  return r > 0 ? `+${usdRound(r)}` : r < 0 ? `−${usdRound(r)}` : '$0';
}
/** Table cell: costs as '−$5,700', revenue as '$32,600', nothing as a dash. */
const cell = (v: number) => (Math.round(v / 100) === 0 ? '—' : v < 0 ? `−${usdRound(v)}` : usdRound(v));
const tone = (v: number) => (Math.round(v / 100) === 0 ? 'dim' : v > 0 ? 'good' : 'bad');

/** 'You gain $12,400' / 'You lose $8,900' / 'About the same'. */
export function verdictText(q: Pick<TripMoveQuote, 'verdict' | 'net'>): string {
  return q.verdict === 'gain' ? `You gain ${usdRound(q.net)}` : q.verdict === 'loss' ? `You lose ${usdRound(q.net)}` : 'About the same';
}

const city = (c: string) => AIRPORT_BY_CODE[c]?.city ?? c;

function MoneyTable({ q }: { q: TripMoveQuote }) {
  const row = (key: keyof TripMoney | 'net', label: string, hint: string | undefined, b: number, a: number, d: number) => (
    <tr key={key} className={key === 'net' ? 'tm-net' : undefined}>
      <td title={hint}>{label}</td>
      <td className="num">{cell(b)}</td>
      <td className="num">{cell(a)}</td>
      <td className={`num ${tone(d)}`}>{Math.round(d / 100) === 0 ? '—' : usdSigned(d)}</td>
    </tr>
  );
  return (
    <div className="table-wrap tm-table">
      <table className="table">
        <thead>
          <tr>
            <th />
            <th className="num">Before<span className="tm-th-reg">{q.sourceReg}</span></th>
            <th className="num">After<span className="tm-th-reg">{q.targetReg}</span></th>
            <th className="num">Difference</th>
          </tr>
        </thead>
        <tbody>
          {MONEY_LINES.map((l) => row(l.key, l.label, l.hint, q.before[l.key], q.after[l.key], q.diff[l.key]))}
          {row('net', 'Result', 'Revenue less the costs above', moneyTotal(q.before), moneyTotal(q.after), q.net)}
        </tbody>
      </table>
      <div className="tiny dim tm-est">Crew costs are an estimate from the new roster; the rest at today's fuel price and the contract's rates.</div>
    </div>
  );
}

export function TripMoveModal({ flightId, targetId }: { flightId: string; targetId: string }) {
  const g = useGame();
  const close = () => store.closeModal();
  const f = g.flights[flightId];
  const tgt = g.fleet[targetId];
  if (!f || !tgt) {
    return <Modal title="Move trip" onClose={close}><p className="muted">This flight or aircraft is no longer in the schedule.</p></Modal>;
  }
  const q = quoteTripMove(g, flightId, targetId);
  const src = g.fleet[q.sourceId];
  const go = () => {
    const r = store.act((gg) => moveTrip(gg, flightId, targetId, q.net));
    if (r.ok) close();
  };
  const ferries = q.positioning.filter((x) => x.added);
  const dropped = q.positioning.filter((x) => !x.added);
  const why = q.reasons[0];
  return (
    <Modal className="tm-modal" size="wide" title={`Move trip ${q.label} to ${q.targetReg}?`} icon={<ArrowRightLeft className="accent" />} onClose={close} footer={
      <>
        {!q.ok && <span className="grow small bad tm-foot-why">{why}</span>}
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn btn-primary" onClick={go} disabled={!q.ok} title={q.ok ? undefined : why}><ArrowRightLeft /> Move trip</button>
      </>
    }>
      <div className="col gap-12">
        {q.ok && q.full ? (
          <div className={`tm-verdict ${q.verdict}`}>
            <b>{verdictText(q)}</b>
            <span className="small muted">compared with leaving it on {q.sourceReg}</span>
          </div>
        ) : (
          <div className="tm-verdict blocked">
            <b><TriangleAlert /> Can't move it to {q.targetReg}</b>
            <span className="small">{q.reasons.join(' · ')}</span>
          </div>
        )}
        <div className="tm-cols">
          <div className="col gap-10 tm-side">
            <div className="upper dim tiny">The trip</div>
            <div className="tm-legs">
              {q.legs.map((l) => (
                <div key={l.id} className="tm-leg">
                  <span className="mono dim">{l.no}</span>
                  <b>{l.from} → {l.to}</b>
                  <span className="num">
                    {l.newStd !== l.std && <s className="dim">{fmtTime(l.std)}</s>} {fmtDateTime(l.newStd)}–{fmtTime(l.newSta)}
                  </span>
                </div>
              ))}
              {ferries.map((x, i) => (
                <div key={`a${i}`} className="tm-leg tm-ferry">
                  <span className="tm-tag">FERRY</span>
                  <b>{x.from} → {x.to} <span className="tiny dim mono nowrap">{x.reg}</span></b>
                  <span className="num">{fmtDateTime(x.std)}–{fmtTime(x.sta)}</span>
                </div>
              ))}
            </div>
            <div className="small muted">
              {src ? `${src.reg} (${typeOf(src.typeId).short})` : q.sourceReg} → {tgt.reg} ({typeOf(tgt.typeId).short}, {tgt.cabin.label}) · {city(q.legs[0]?.from ?? '')}
              {q.shift > 0 && <> · leaves {fmtDuration(q.shift)} later</>}
            </div>
            {q.full && (
              <ul className="tm-notes small">
                {q.warnings.map((w) => <li key={w} className="warn">{w}</li>)}
                {q.notes.map((n) => <li key={n}>{n}</li>)}
                {dropped.length > 0 && !q.notes.some((n) => n.startsWith('No longer')) && <li>No longer needed: {dropped.map((x) => `${x.reg} ${x.from}–${x.to}`).join(', ')}.</li>}
                {q.crewOff.length > 0 && <li className="dim">Off: {q.crewOff.join(', ')}</li>}
                {q.crewOn.length > 0 && <li className="dim">On: {q.crewOn.join(', ')}</li>}
              </ul>
            )}
          </div>
          <div className="tm-main">
            {q.full ? <MoneyTable q={q} /> : (
              <div className="tm-empty small muted"><Plane /> The money is worked out once {q.targetReg} can take the trip.</div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
