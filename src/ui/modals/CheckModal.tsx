// Check planning (B5): A- or C-check for one aircraft. Suggests ground gaps at eligible airports
// (ops.groundGaps / checkAirportOk) or a custom slot; books through ops.scheduleCheck. DESIGN.md §6.3.
// v0.7.2 (UPDATE-0.7.2.md §7.3): C-checks happen at real MRO hubs by type: the hub list (price level, ferry each way,
// all-in total, days away) first, then the earliest windows (cCheckSlots), then the plan in one line; a booked hub
// check lists its ferries and the pilots' airline tickets (checkLogistics). A-checks are unchanged.

import { Check, Plane, Ticket, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { flightsRev } from '../../engine/core/entities';
import { typeOf } from '../../engine/core/perf';
import { DAY, HOUR, dayStart, fmtDate, fmtDateTime, fmtDay, fmtDuration, fmtTime } from '../../engine/core/time';
import type { ActionResult, GameState } from '../../engine/core/types';
import { addRestToCCheck, bookCCheck, cCheckOptions, cCheckSlots, cancelCheck, checkAirportOk, checkLogistics, checkStatus, checkUsedAt, groundGaps, restRefitOptions, scheduleCheck, type CCheckOption } from '../../engine/ops';
import { Term } from '../components/Term';
import { money } from '../format';
import { Modal, Seg, Stepper } from '../components/ui';
import { KV } from '../screens/common';
import { durLabel } from '../screens/scheduleLogic';
import { store, useGame } from '../store';

type Kind = 'A' | 'C';
interface Slot { start: number; at: string; gap: number }

function suggestions(g: GameState, acId: string, kind: Kind, dur: number): Slot[] {
  const ac = g.fleet[acId];
  if (!ac) return [];
  const until = g.now + (kind === 'A' ? 60 : 240) * DAY;
  const out: Slot[] = [];
  for (const gp of groundGaps(g, ac, g.now + HOUR, until)) {
    if (!checkAirportOk(g, kind, gp.at)) continue;
    const start = Math.ceil((gp.from + 30) / 30) * 30;
    if (start + dur + 60 > gp.to) continue;
    out.push({ start, at: gp.at, gap: gp.to - gp.from });
    if (out.length >= 6) break;
  }
  return out;
}

type RestFit = 'fcrc' | 'overhead';

export function CheckModal({ aircraftId, checkKind, replace, restFit, backToRefit }: { aircraftId: string; checkKind?: Kind; replace?: string; restFit?: RestFit; backToRefit?: boolean }) {
  const [kind, setKind] = useState<Kind>(checkKind ?? (restFit ? 'C' : 'A'));
  return kind === 'C' ? <CCheckModal aircraftId={aircraftId} replace={replace} setKind={setKind} restFit={restFit} backToRefit={backToRefit} /> : <ACheckModal aircraftId={aircraftId} replace={replace} kind={kind} setKind={setKind} />;
}

const asFit = (x: unknown): RestFit | undefined => (x === 'fcrc' || x === 'overhead' ? x : undefined);

const legsBlock = (legs: { block: number }[]) => legs.reduce((n, l) => n + l.block, 0);
const pct = (p: number) => (p === 1 ? 'base price' : `${p < 1 ? '−' : '+'}${Math.round(Math.abs(1 - p) * 100)}%`);

/** v0.7.2 §7.3: the C-check at an MRO hub. */
function CCheckModal({ aircraftId, replace, setKind, restFit, backToRefit }: { aircraftId: string; replace?: string; setKind: (k: Kind) => void; restFit?: RestFit; backToRefit?: boolean }) {
  const g = useGame();
  const ac = g.fleet[aircraftId];
  const rev = flightsRev(g);
  // v0.7.3 §2.10: a flight crew rest compartment / overhead crew rest fitted with the check (ticked from the refit
  // modal, or already on the booked check).
  const [fit, setFit] = useState<RestFit | undefined>(() => {
    if (restFit) return restFit;
    const id = replace ?? (ac ? checkStatus(g, ac).nextC : null);
    return asFit(id ? g.maintenance[id]?.restFit : undefined);
  });
  const nMaint = Object.keys(g.maintenance).length;
  const restOpt = useMemo(() => restRefitOptions(g, aircraftId).find((o) => o.where === 'cCheck'), [g, aircraftId, rev, nMaint]); // eslint-disable-line react-hooks/exhaustive-deps
  const opts = useMemo(() => cCheckOptions(g, aircraftId, undefined, fit), [g, aircraftId, rev, g.now, fit]); // eslint-disable-line react-hooks/exhaustive-deps
  const [hub, setHub] = useState<string | null>(null);
  const code = hub ?? opts[0]?.hub.code ?? '';
  const slots = useMemo(() => (code ? cCheckSlots(g, aircraftId, code, 4, fit) : []), [g, aircraftId, code, rev, g.now, fit]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pick, setPick] = useState<number | null>(null);
  const start = pick !== null && slots.includes(pick) ? pick : slots[0];
  const opt: CCheckOption | undefined = useMemo(() => (start !== undefined ? cCheckOptions(g, aircraftId, start, fit).find((o) => o.hub.code === code) : undefined), [g, aircraftId, start, code, rev, fit]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ac) return null;
  const t = typeOf(ac.typeId);
  const st = checkStatus(g, ac);
  const oldId = replace ?? st.nextC;
  const old = oldId ? g.maintenance[oldId] : undefined;
  const inWork = old?.status === 'inWork';
  const lg = old ? checkLogistics(g, old.id) : null;
  const proj = start !== undefined ? checkUsedAt(g, ac, 'C', start) : null;
  const book = () => {
    if (start === undefined || !code) return;
    const res = store.act((gg): ActionResult<{ maintId: string }> => {
      if (old && old.status === 'planned') {
        const keep = { start: old.start, at: old.at, hub: old.hub?.code, restFit: asFit(old.restFit) };
        const c = cancelCheck(gg, old.id);
        if (!c.ok) return c;
        const r = bookCCheck(gg, ac.id, code, start, { restFit: fit });
        if (!r.ok) {
          if (keep.hub) bookCCheck(gg, ac.id, keep.hub, keep.start, { restFit: keep.restFit });
          else scheduleCheck(gg, ac.id, 'C', keep.start, keep.at);
        }
        return r;
      }
      return bookCCheck(gg, ac.id, code, start, { restFit: fit });
    });
    if (res.ok) done();
  };
  const done = () => (backToRefit ? store.openModal({ kind: 'refit', aircraftId, section: 'rest' }) : store.closeModal());
  // On a booked check the tick changes it at once (addRestToCCheck); otherwise it shapes the hubs, windows and booking.
  const planned = old?.status === 'planned' ? old : undefined;
  const toggleFit = () => {
    const next = fit ? undefined : asFit(restOpt?.id);
    if (planned) {
      if (store.act((gg) => addRestToCCheck(gg, planned.id, next ?? null)).ok) setFit(next);
    } else setFit(next);
  };
  const fitShown = !!restOpt || !!fit;
  const fo = opt?.ferryOut ?? [];
  const fh = opt?.ferryHome ?? [];
  return (
    <Modal title={`Plan a check: ${ac.reg}`} icon={<Wrench className="accent" />} onClose={done} footer={
      <>
        <span className="grow small muted">{opt?.ok ? `About ${money(opt.total)} all in` : ''}</span>
        <button className="btn" onClick={done}>{planned && !inWork && backToRefit ? 'Done' : 'Cancel'}</button>
        <button className="btn btn-primary" onClick={book} disabled={start === undefined || !opt?.ok || inWork}><Wrench /> {old && !inWork ? `Move C-check${opt ? ` to ${opt.hub.city}` : ''}` : `Book C-check${opt ? ` at ${opt.hub.city}` : ''}`}</button>
      </>
    }>
      <div className="col gap-12">
        <div className="row between wrap gap-12">
          <Seg<Kind> value="C" onChange={setKind} options={[{ value: 'A', label: 'A-check' }, { value: 'C', label: 'C-check' }]} />
          <span className="small muted">{t.cCheckDays} days at an <Term id="mro">MRO</Term> hub · due {fmtDate(st.cDue)} ({Math.round(st.cUsed * 100)}% used)</span>
        </div>
        {old && (
          <div className="ck-booked small">
            <b>{inWork ? 'In work' : 'Booked'}: {old.hub ? `${old.hub.name}, ` : ''}{AIRPORT_BY_CODE[old.at]?.city ?? old.at} {fmtDay(old.start)}–{fmtDay(old.end)}</b>
            {lg && (
              <div className="col gap-4 mt-4">
                {[...lg.ferryOut.map((f) => ['Ferry out', f] as const), ...lg.ferryHome.map((f) => ['Ferry home', f] as const)].map(([k, f]) => (
                  <span key={f.id} className="row gap-8"><Plane className="sc-ico-s" /><span className="muted">{k}</span> <span className="mono">{f.no}</span> {f.from}→{f.to} {fmtDay(f.std)} {fmtTime(f.std)}</span>
                ))}
                {lg.tickets.map((x) => (
                  <span key={`${x.no}${x.dep}`} className="row gap-8"><Ticket className="sc-ico-s" /><span className="muted">{x.crewIds.length} pilot{x.crewIds.length === 1 ? '' : 's'}</span> <span className="mono">{x.no}</span> {x.from}→{x.to} {fmtDay(x.dep)}{x.cost ? ` · ${money(x.cost)}` : ''}</span>
                ))}
                {!lg.tickets.length && <span className="muted">Airline tickets for the pilots are bought when the ferries are rostered (up to 14 days ahead).</span>}
              </div>
            )}
            {!inWork && <div className="muted mt-4">Pick a hub and a window to move it.</div>}
          </div>
        )}
        {fitShown && (
          <button className={`ck-restfit ${fit ? 'on' : ''}`} aria-pressed={!!fit} onClick={toggleFit} disabled={inWork || (!fit && !restOpt?.ok)}>
            <span className="hm-box" aria-hidden>{fit && <Check />}</span>
            <span className="col grow" style={{ minWidth: 0 }}>
              <b className="small">Also fit {fit === 'overhead' || restOpt?.id === 'overhead' ? 'an overhead crew rest' : 'a flight crew rest compartment'}{restOpt ? ` (+${restOpt.days} days, ~${money(restOpt.cost)})` : ''}{planned && fit ? ' · on this check' : ''}</b>
              {restOpt && <span className="small good">{restOpt.opens}</span>}
              {restOpt && !restOpt.ok && restOpt.why && <span className="small warn">{restOpt.why}</span>}
            </span>
          </button>
        )}
        <div className="upper dim">Hubs for the {t.short}</div>
        <div className="col gap-8">
          {opts.map((o) => (
            <button key={o.hub.code} className={`sc-slot ck-hub ${o.hub.code === code ? 'on' : ''}`} aria-pressed={o.hub.code === code} onClick={() => { setHub(o.hub.code); setPick(null); }}>
              <span className="row between gap-8"><b>{o.hub.name}</b><b className="num">{money(o.total)}</b></span>
              <span className="row between gap-8 small">
                <span className="muted">{o.hub.city} ({o.hub.code}) · {pct(o.hub.price)} · ferry {o.ferryOut.length ? fmtDuration(legsBlock(o.ferryOut)) : '—'} each way · {o.awayDays} days away</span>
                {!o.ok && o.why && <span className="warn">{o.why}</span>}
              </span>
            </button>
          ))}
          {!opts.length && <div className="small muted">No MRO hub takes this type.</div>}
        </div>
        <div className="upper dim">Earliest windows</div>
        <div className="row wrap gap-8">
          {slots.map((s0, i) => (
            <button key={s0} className={`cv-chip rf-chip ${s0 === start ? 'on' : ''}`} aria-pressed={s0 === start} onClick={() => setPick(s0)}>
              <b>{fmtDay(s0)}</b><span className="tiny dim">{i === 0 ? 'earliest' : fmtTime(s0)}</span>
            </button>
          ))}
          {!slots.length && <span className="small muted">No window long enough for the ferries and the check in the next year: clear some flights first.</span>}
        </div>
        {opt && start !== undefined && (
          <div className="cv-cost small ck-plan">
            <span>{fo.length ? <>Ferry out <b>{fmtDay(fo[0].std)} {fmtTime(fo[0].std)}</b> {fo[0].from}→{fo[fo.length - 1].to} ({fmtDuration(legsBlock(fo))}) · </> : null}check <b>{fmtDay(opt.start)}–{fmtDay(opt.end)}</b>{fh.length ? <> · ferry home <b>{fmtDay(fh[0].std)} {fmtTime(fh[0].std)}</b></> : null}</span>
            <span className="muted">Check {money(opt.checkCost)} · ferries {money(opt.ferryCost)} · 2 pilots fly home and back out on airline tickets, hotels ≈ {money(opt.crewCost)}</span>
            {proj && <span className={proj.used > 1 ? 'bad' : proj.used > 0.9 ? 'warn' : 'good'}>By then: {Math.round(proj.used * 100)}% used ({proj.fh} / {proj.limitFH} FH)</span>}
            {!opt.ok && opt.why && <span className="warn">{opt.why}</span>}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ACheckModal({ aircraftId, replace, kind, setKind }: { aircraftId: string; replace?: string; kind: Kind; setKind: (k: Kind) => void }) {
  const g = useGame();
  const ac = g.fleet[aircraftId];
  const [pick, setPick] = useState<number>(0);
  const [day, setDay] = useState(1);
  const [hour, setHour] = useState(22);
  const [at, setAt] = useState(g.company.homeBase);
  const rev = flightsRev(g);
  const t = ac ? typeOf(ac.typeId) : null;
  const dur = t ? (kind === 'A' ? t.aCheckHours * HOUR : t.cCheckDays * DAY) : 0;
  const slots = useMemo(() => suggestions(g, aircraftId, kind, dur), [g, aircraftId, kind, dur, rev, g.now]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ac || !t) return null;
  const st = checkStatus(g, ac);
  const custom = pick === -1;
  const chosen: Slot | undefined = custom ? { start: dayStart(g.now) + day * DAY + hour * HOUR, at, gap: 0 } : slots[pick];
  const airports = [g.company.homeBase, ac.at].filter((x, i, a) => a.indexOf(x) === i && checkAirportOk(g, kind, x));
  // An existing booking of this kind is moved, not refused (the auto-planner may have booked it beyond the Schedule view).
  const oldId = replace ?? (kind === 'A' ? st.nextA : st.nextC);
  const old = oldId ? g.maintenance[oldId] : undefined;
  const inWork = old?.status === 'inWork';
  const proj = chosen ? checkUsedAt(g, ac, kind, chosen.start) : null;
  const projLine = proj && (
    <span className={`small ${proj.used > 1 ? 'bad' : proj.used > 0.9 ? 'warn' : 'good'}`}>
      By then: {Math.round(proj.used * 100)}% used · {Math.max(0, 100 - Math.round(proj.used * 100))}% left ({proj.fh} / {proj.limitFH} FH)
    </span>
  );

  const book = () => {
    if (!chosen) return;
    const res = store.act((gg): ActionResult<{ maintId: string }> => {
      if (old && old.status === 'planned') {
        const c = cancelCheck(gg, old.id);
        if (!c.ok) return c;
        const r = scheduleCheck(gg, ac.id, kind, chosen.start, chosen.at);
        if (!r.ok) scheduleCheck(gg, ac.id, old.kind, old.start, old.at);
        return r;
      }
      return scheduleCheck(gg, ac.id, kind, chosen.start, chosen.at);
    });
    if (res.ok) store.closeModal();
  };

  return (
    <Modal title={`Plan a check: ${ac.reg}`} icon={<Wrench className="accent" />} onClose={() => store.closeModal()} footer={
      <>
        <button className="btn" onClick={() => store.closeModal()}>Cancel</button>
        <button className="btn btn-primary" onClick={book} disabled={!chosen || inWork}><Wrench /> {old && !inWork ? 'Move' : 'Book'} {kind}-check</button>
      </>
    }>
      <div className="col gap-16">
        <div className="row between wrap gap-12">
          <Seg<Kind> value={kind} onChange={(k) => { setKind(k); setPick(0); }} options={[{ value: 'A', label: 'A-check' }, { value: 'C', label: 'C-check' }]} />
          <span className="small muted">{kind === 'A' ? `${t.aCheckHours} h` : `${t.cCheckDays} days`} · {kind === 'A' ? 'home base or a major airport' : 'home base only'}</span>
        </div>
        <KV rows={[
          ['A-check due', `${fmtDate(st.aDue)} · ${Math.max(0, st.aHoursLeft)} FH left (${Math.round(st.aUsed * 100)}% used)`],
          ['C-check due', `${fmtDate(st.cDue)} · ${Math.round(st.cUsed * 100)}% used`],
          ...(old ? [[inWork ? 'In work' : 'Booked', `${old.kind}-check ${fmtDateTime(old.start)} UTC at ${old.at}${inWork ? '' : ' · pick a new slot to move it'}`] as [string, string]] : []),
        ]} />
        <div className="upper dim">Suggested slots</div>
        <div className="col gap-8">
          {!slots.length && <div className="small muted">No free ground time long enough at an eligible airport. Pick a custom slot: legs in the way must be cleared first.</div>}
          {slots.map((s, i) => (
            <button key={s.start} className={`sc-slot ${pick === i ? 'on' : ''}`} onClick={() => setPick(i)}>
              <b>{fmtDateTime(s.start)} UTC</b>
              <span className="muted">{s.at} · {AIRPORT_BY_CODE[s.at]?.city}</span>
              <span className="dim small">ground time {durLabel(s.gap)}</span>
              {pick === i && projLine}
            </button>
          ))}
          <button className={`sc-slot ${custom ? 'on' : ''}`} onClick={() => setPick(-1)}>
            <b>Custom slot</b>
            <span className="muted">{custom && chosen ? `${fmtDateTime(chosen.start)} UTC at ${chosen.at}` : 'Choose a date, time and airport'}</span>
            {custom && projLine}
          </button>
          {custom && (
            <div className="row wrap gap-16 sc-custom">
              <div className="field"><label>Day</label><Stepper value={day} min={0} max={240} onChange={setDay} format={(v) => fmtDay(dayStart(g.now) + v * DAY)} /></div>
              <div className="field"><label>Start (UTC)</label><Stepper value={hour} min={0} max={23} onChange={setHour} format={(v) => `${String(v).padStart(2, '0')}:00`} /></div>
              <div className="field"><label>Airport</label><Seg<string> value={at} onChange={setAt} options={airports.map((a) => ({ value: a, label: a }))} /></div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
