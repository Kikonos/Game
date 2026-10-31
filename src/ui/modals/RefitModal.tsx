// v0.7 cabin refit (UPDATE-0.7.md §F7.5): layout and start on the left; what it costs, the seats and cabin-crew
// minimum before and after, what work it opens and closes, the lessor's reinstatement at the lease return and any
// clash on the right. v0.7.2 (UPDATE-0.7.2.md F6, §3.3): cabin work happens in our own hangar at home base and starts
// as soon as the aircraft is free: the earliest windows (refitSlots) come first, the first pre-selected, with a plain
// "Why not sooner?"; the two-week day grid stays behind 'Another day…'. v0.7.3 (UPDATE-0.7.3.md §2.10): a "Crew rest"
// section: today's pilot and cabin crew rest and the longest day, then each crew rest refit (class, days, cost, seats,
// what it opens); home options book a slot here, the compartments go with a C-check (the check dialog, ticked).

import { AlertTriangle, BedDouble, CalendarDays, ChevronLeft, ChevronRight, Sofa, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CabinLayout } from '../../data/acmiTypes';
import type { GameState, Minute, RestRefitId } from '../../engine/core/types';
import { flightsOf, flightsRev } from '../../engine/core/entities';
import { route } from '../../engine/contracts/plan';
import { etopsCap, typeOf } from '../../engine/core/perf';
import { DAY, HOUR, dayStart, fmtDay, fmtDuration, fmtTime, toDate } from '../../engine/core/time';
import { bookRefit, bookRestRefit, cabinOptions, cancelCheck, refitKindText, refitQuote, refitSlots, refitStations, refitTerms, restRefitOptions, twoClassInstead, restRefitQuote, type RefitQuote, type RestRefitOption } from '../../engine/ops';
import { longestDay, restOf, restShort, restText } from '../../engine/crew';
import { longestDetail, restTerm } from '../components/RestLines';
import { REST_FIT_LABEL } from '../screens/Fleet';
import { Term } from '../components/Term';
import { Modal, Seg } from '../components/ui';
import { money } from '../format';
import { layoutLabel } from '../screens/screenLogic';
import { store, useGame } from '../store';

/** How far the custom-day grid reaches. */
const SCAN_WEEKS = 26;
const PAGE = 14;
/** Earliest windows listed (the dialog fits 750 px). */
const SLOTS = 4;

/** 'Busy until 22 Apr: flies Drama production unit' → "CS-TQA is busy until 22 Apr: booked on ‘Drama production unit’". */
export function busySentence(reg: string, why: string): string {
  const m = /^Busy until ([^:]+): (.*)$/.exec(why);
  if (!m) return why;
  let what = m[2];
  const fl = /^flies ([A-Z0-9]{2,3}\d+ [A-Z]{3}[–-][A-Z]{3})$/.exec(what);
  if (fl) what = `flying ${fl[1]}`;
  else if (what.startsWith('flies ')) what = `booked on ‘${what.slice(6)}’`;
  return `${reg} is busy until ${m[1]}: ${what}`;
}

/** Where the aircraft will be at t (its last planned arrival before t), as refitQuote's ferry in measures it. Pure. */
function plannedAt(g: GameState, aircraftId: string, t: Minute): string {
  const ac = g.fleet[aircraftId];
  let at = ac.at;
  let free = g.now;
  const cur = ac.flightId ? g.flights[ac.flightId] : undefined;
  if (cur) {
    at = cur.to;
    free = cur.eta ?? cur.sta;
  }
  for (const f of flightsOf(g, aircraftId)) {
    if (f.status !== 'scheduled' || f.sta > t || f.sta < free) continue;
    at = f.to;
    free = f.sta;
  }
  return at;
}

/** 'today 14:00', 'tomorrow 06:30', 'Thu 12 Nov 08:00'. */
export function whenLabel(now: Minute, t: Minute): string {
  const d = dayStart(t);
  const d0 = dayStart(now);
  const day = d === d0 ? 'today' : d === d0 + DAY ? 'tomorrow' : `${toDate(t).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${fmtDay(t)}`;
  return `${day} ${fmtTime(t)}`;
}

type Mode = 'cabin' | 'rest';

const SIDE_WORD: Record<RestRefitOption['side'], string> = { fc: 'pilots', cc: 'cabin crew', both: 'pilots and cabin crew' };

/** One crew rest refit: label, class chip, days · cost · seats, what it opens (or why not). */
function RestOptionRow({ o, on, onPick }: { o: RestRefitOption; on: boolean; onPick: () => void }) {
  const seats = o.seats ? ` · ${o.seats > 0 ? '+' : '−'}${Math.abs(o.seats)} seats` : '';
  return (
    <button className={`rf-opt ${on ? 'on' : ''}`} aria-pressed={on} onClick={onPick} disabled={!o.ok}>
      <span className="row wrap gap-8 between">
        <b className="small">{o.label}</b>
        <span className="row gap-4"><span className="chip sc-chip nowrap">Class {o.cls}</span><span className="chip sc-chip nowrap">{SIDE_WORD[o.side]}</span></span>
      </span>
      <span className="small muted">{o.where === 'cCheck' ? `With a C-check · +${o.days} days` : `${o.days} day${o.days === 1 ? '' : 's'} at home base`} · {money(o.cost)}{seats}</span>
      {o.ok ? <span className="small rf-opt-opens">{o.opens}</span> : <span className="small warn">{o.why}</span>}
    </button>
  );
}

export function RefitModal({ aircraftId, layout, offerId, rest, restOption, after }: { aircraftId: string; layout?: CabinLayout; offerId?: string; rest?: boolean; restOption?: RestRefitId; /** v0.7.2.2 from an idle gap: windows from here */ after?: number }) {
  const g = useGame();
  const ac = g.fleet[aircraftId];
  const t = ac ? typeOf(ac.typeId) : null;
  const presets = useMemo(() => (ac ? cabinOptions(ac.typeId) : []), [ac]);
  const rev0 = flightsRev(g);
  const nMaint0 = Object.keys(g.maintenance).length;
  // v0.7.3 crew rest refits for this airframe (any type: the A321LR and 757 take recliners too).
  const restOpts = useMemo(() => (ac ? restRefitOptions(g, aircraftId) : []), [g, aircraftId, rev0, nMaint0, ac?.rest]); // eslint-disable-line react-hooks/exhaustive-deps
  // v0.7.4 the Crew rest section is always there: every aircraft has seat rest (with or without upgrades to fit).
  const restOffer = restOpts.length > 0;
  const [mode, setMode] = useState<Mode>(rest ? 'rest' : 'cabin');
  const [optId, setOptId] = useState<RestRefitId | null>(restOption ?? null);
  const ropt = restOpts.find((o) => o.id === optId && o.ok) ?? restOpts.find((o) => o.ok && o.where === 'home') ?? restOpts.find((o) => o.ok) ?? restOpts[0];
  const viaCheck = mode === 'rest' && ropt?.where === 'cCheck';
  const [label, setLabel] = useState(() => (layout && presets.find((p) => p.layout === layout)?.label) || presets.find((p) => p.label !== ac?.cabin.label)?.label || presets[0]?.label || '');
  const stations = useMemo(() => refitStations(g, aircraftId), [g, aircraftId, ac?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const station = stations[0]?.code ?? g.company.homeBase;
  const rev = flightsRev(g);
  const key = mode === 'rest' ? (ropt && !viaCheck ? `rest:${ropt.id}` : '') : label;
  const noRest = mode === 'rest' && !ropt;
  const nMaint = Object.keys(g.maintenance).length;
  const plan = useMemo(() => (key ? refitSlots(g, aircraftId, key, SLOTS, after ?? 0) : { slots: [], busyUntil: null, busyWhy: null }), [g, aircraftId, key, rev, g.now, nMaint, after]); // eslint-disable-line react-hooks/exhaustive-deps
  const quoteAt = (s: Minute): RefitQuote => (mode === 'rest' ? restRefitQuote(g, aircraftId, ropt?.id ?? 'curtainJ', s) : refitQuote(g, aircraftId, label, station, s));
  // Custom days (the grid behind 'Another day…'), quoted on demand.
  const days = useMemo(() => {
    const out: number[] = [];
    for (let d = dayStart(g.now) + 6 * HOUR; out.length < SCAN_WEEKS * 7; d += DAY) if (d >= g.now) out.push(d);
    return out;
  }, [g.now]);
  const quotes = useMemo(() => new Map<number, RefitQuote>(), [g, aircraftId, key, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const quote = (d: number) => {
    let x = quotes.get(d);
    if (!x) quotes.set(d, (x = quoteAt(d)));
    return x;
  };
  const [picked, setPicked] = useState<number | null>(null);
  const [grid, setGrid] = useState(false);
  const start = picked ?? plan.slots[0]?.start ?? days[0];
  const mon0 = days[0] - ((toDate(days[0]).getUTCDay() + 6) % 7) * DAY;
  const pageOf = (d: number) => Math.floor((d - mon0) / (PAGE * DAY));
  const lastPage = pageOf(days[days.length - 1]);
  const [pg, setPg] = useState<number | null>(null);
  const page = Math.min(lastPage, Math.max(0, pg ?? pageOf(start)));
  const cells = Array.from({ length: PAGE }, (_, k) => mon0 + (page * PAGE + k) * DAY);
  const inRange = (d: number) => d >= days[0] && d <= days[days.length - 1];
  const reset = () => { setPicked(null); setPg(null); };
  // Opened from an offer's 'Plan refit…': back to that offer.
  const close = () => (offerId && store.game?.offers[offerId] ? store.openModal({ kind: 'offer', offerId }) : store.closeModal());
  if (!ac || !t) return null;
  const q = quote(start);
  const from = plannedAt(g, aircraftId, start - 1);
  const ferry = route(ac.typeId, from, station, etopsCap(g.company.approvals, ac.typeId))?.reduce((n, l) => n + l.block, 0) ?? null;
  const leased = ac.ownership.kind === 'dryLeaseIn';
  const book = () => {
    if (viaCheck && ropt) {
      store.openModal({ kind: 'check', aircraftId, checkKind: 'C', restFit: ropt.id === 'overhead' ? 'overhead' : 'fcrc', backToRefit: true });
      return;
    }
    const ok = mode === 'rest'
      ? !!ropt && store.act((gg) => bookRestRefit(gg, aircraftId, ropt.id, start)).ok
      : store.act((gg) => bookRefit(gg, aircraftId, label, station, start)).ok;
    if (ok) close();
  };
  // A refit already booked: show it (and the way to call it off) instead of an empty picker.
  const booked = Object.values(g.maintenance).find((x) => x.aircraftId === aircraftId && x.kind === 'refit' && (x.status === 'planned' || x.status === 'inWork'));
  const bookedWhat = booked?.restFit ? `a crew rest refit (${REST_FIT_LABEL[booked.restFit].toLowerCase()})` : booked?.refit ? (booked.refit.restSeats !== undefined ? (booked.refit.restSeats ? 'crew rest seats fitted' : 'crew rest seats removed') : `a refit to ${booked.refit.cabin.label}`) : 'a refit';
  const cancelBooked = () => booked && store.openModal({
    kind: 'confirm', title: 'Cancel this refit?', confirm: 'Cancel the refit', danger: true,
    body: `${ac.reg} stays ${ac.cabin.label}. Free before the work starts; its ferry to ${booked.at} is removed.`,
    onConfirm: () => { if (store.act((gg) => cancelCheck(gg, booked.id)).ok) store.openModal({ kind: 'refit', aircraftId, rest: mode === 'rest' }); },
  });
  const bookLabel = mode === 'rest' ? (viaCheck ? 'Add to the C-check…' : `Book · ${money(q.cost)}`) : `Book refit · ${money(q.cost)}`;
  // A C-check add-on with a check already booked: it can still be ticked there (the dialog applies it at once).
  const canBook = noRest ? false : viaCheck ? !!ropt?.ok : q.ok;
  const now = restOf(g, aircraftId);
  // v0.12.1 the VIP retrofit picked while a two-class cabin (2 days, tens of thousands) meets the need: say so. The need
  // is the offer this was opened from, else the signed work on the aircraft that wants premium seats.
  const sel = presets.find((p) => p.label === label);
  const offer = offerId ? g.offers[offerId] : undefined;
  const work = offer ? [{ title: offer.title, req: offer.requirements }] : Object.values(g.contracts).filter((c) => (c.status === 'signed' || c.status === 'active') && c.aircraftIds.includes(aircraftId) && c.requirements.minPremium).map((c) => ({ title: c.title, req: c.requirements }));
  const cheaper = sel?.layout === 'vip' && ac.cabin.layout !== 'two-class' && work.every((w) => twoClassInstead(ac.typeId, w.req)) ? twoClassInstead(ac.typeId) : null;
  const need = work.find((w) => w.req.minPremium)?.title;
  return (
    <Modal size="wide" className="rf-modal" title={`${mode === 'rest' ? 'Crew rest' : 'Cabin refit'} · ${ac.reg}`} icon={mode === 'rest' ? <BedDouble className="accent" /> : <Sofa className="accent" />} onClose={close} footer={
      <>
        <button className="btn" onClick={close}>Cancel</button>
        <span className="grow small muted">{viaCheck ? 'Fitted during the C-check at an MRO hub' : q.ok ? `${fmtDay(q.start)} – ${fmtDay(q.end)} at ${station}` : ''}</span>
        <button className="btn btn-primary" onClick={book} disabled={!canBook}>{viaCheck ? <Wrench /> : mode === 'rest' ? <BedDouble /> : <Sofa />} {bookLabel}</button>
      </>
    }>
      <div className="cv-cols">
        <div className="col gap-12" style={{ minWidth: 0 }}>
          <Seg<Mode> value={mode} onChange={(m) => { setMode(m); reset(); setGrid(false); }} options={[{ value: 'cabin', label: 'Cabin layout' }, { value: 'rest', label: 'Crew rest' }]} />
          {mode === 'cabin' ? (
            <>
              <div className="small muted">{t.name} · now <b>{ac.cabin.label}</b> {layoutLabel(ac.cabin.layout)}</div>
              <div className="cv-chips">
                {presets.map((p) => {
                  const cur = p.label === ac.cabin.label;
                  const tm = refitTerms(ac.typeId, p.layout, p);
                  return (
                    <button key={p.label} className={`cv-chip rf-chip ${p.label === label ? 'on' : ''} ${cur ? 'off' : ''}`} onClick={() => { setLabel(p.label); reset(); }} aria-pressed={p.label === label}>
                      <b>{p.label}</b>
                      <span className="tiny dim">{cur ? 'current' : `${layoutLabel(p.layout)} · ${p.j + p.w + p.y} seats`}</span>
                      {!cur && tm && <span className={`tiny ${tm.kind === 'quick' ? 'good' : 'warn'}`}>{tm.kind === 'quick' ? `${tm.days * 24} h` : `${tm.days} days`} · {money(tm.cost)}</span>}
                    </button>
                  );
                })}
              </div>
              <div className="small muted"><Term id="quickRefit">Quick reconfiguration</Term> (about 48 h): the seats we hold, moved rows and class divider, curtains. VIP is a full retrofit with new premium seats.</div>
            </>
          ) : (
            <>
              <div className="small rf-now">
                <span><Term id={restTerm(now.fc)}>Pilots rest</Term>: <b>{restText(now.fc, 'fc', ac.typeId)}</b></span>
                <span><Term id={restTerm(now.cc)}>Cabin crew rest</Term>: <b>{restText(now.cc, 'cc', ac.typeId)}</b></span>
                <span className="muted"><Term id="longestDay" extra={longestDetail(g, now, ac.typeId)} own>Longest day</Term>: {longestDay(g, now, ac.typeId).text.replace(/^Longest day: /, '')}</span>
              </div>
              <div className="small muted">Curtained {ac.cabin.j >= 4 ? 'business' : 'economy'} seats come with the cabin: nothing to fit, and they are only blocked on flights where someone rests.{ac.cabin.j >= 4 ? '' : ' A cabin with business seats gives class 2 rest.'}</div>
              {restOffer ? (
                <div className="rf-opts" role="group" aria-label="Crew rest refits">
                  {restOpts.map((o) => <RestOptionRow key={o.id} o={o} on={o.id === ropt?.id} onPick={() => { setOptId(o.id); reset(); setGrid(false); }} />)}
                </div>
              ) : <div className="small rf-why">No crew rest upgrade for the {t.short}{t.id === 'b763' ? ' (767-300ERs never have crew bunks)' : ''}.</div>}
            </>
          )}
          {noRest ? null : viaCheck ? (
            <div className="small rf-why"><b>With a C-check.</b> {ropt?.label} takes a hangar at an MRO hub: it is added to the next C-check (+{ropt?.days} days), best booked with it. {ropt?.ok ? '' : ropt?.why}</div>
          ) : (<>
          <div className="small muted rf-where">At {stations[0]?.name ?? `our hangar, ${station}`}{ferry === null ? ' · no ferry route' : ferry ? ` · ferry ${fmtDuration(ferry)} from ${from}` : ''}</div>
          <div className="upper dim">{booked ? 'Booked' : 'Earliest start'}</div>
          {booked ? (
            <div className="rf-booked">
              <span className="small">{ac.reg} already has {bookedWhat} booked: <b>{fmtDay(booked.start)} – {fmtDay(booked.end)}</b> at {stations.find((x) => x.code === booked.at)?.name ?? booked.at}{booked.status === 'inWork' ? ' · in work now' : ''}.</span>
              <span className="small muted">{booked.status === 'planned' ? 'One refit at a time: cancel it (free before the work starts) to book a different one.' : 'The work has started; book the next one when it is done.'}</span>
              {booked.status === 'planned' && <button className="btn btn-sm" onClick={cancelBooked}>Cancel that refit</button>}
            </div>
          ) : (<>
          {plan.busyUntil !== null && plan.busyWhy && <div className="small rf-why"><b>Why not sooner?</b> {busySentence(ac.reg, plan.busyWhy)}.</div>}
          {plan.slots.length ? (
            <div className="rf-slots" role="group" aria-label="Earliest windows">
              {plan.slots.map((s, i) => {
                const on = s.start === start;
                const d = Math.round((s.end - s.start) / DAY);
                return (
                  <button key={s.start} className={`rf-slot ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => { setPicked(s.start); setPg(null); }}>
                    <span className="rf-slot-k">{i === 0 ? 'Earliest' : 'Then'}</span>
                    <span className="rf-slot-v">{whenLabel(g.now, s.start)} – {fmtDay(s.end)} <span className="dim">({d} day{d === 1 ? '' : 's'})</span></span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="small warn">{plan.busyWhy ? busySentence(ac.reg, plan.busyWhy) : `No free window in the next ${SCAN_WEEKS} weeks: move flights first.`}</div>
          )}
          <button className="btn btn-sm rf-more" onClick={() => setGrid(!grid)} aria-expanded={grid}><CalendarDays /> {grid ? 'Hide days' : 'Another day…'}</button>
          {grid && (
            <>
              <div className="row between gap-8">
                <span className="upper dim">Start day</span>
                <span className="row gap-4 rf-nav">
                  <button className="btn btn-sm btn-icon" onClick={() => setPg(page - 1)} disabled={page <= 0} aria-label="Earlier weeks"><ChevronLeft /></button>
                  <span className="small muted nowrap">{fmtDay(Math.max(cells[0], days[0]))} – {fmtDay(Math.min(cells[PAGE - 1], days[days.length - 1]))}</span>
                  <button className="btn btn-sm btn-icon" onClick={() => setPg(page + 1)} disabled={page >= lastPage} aria-label="Later weeks"><ChevronRight /></button>
                </span>
              </div>
              <div className="rf-grid" role="group" aria-label="Start day">
                {cells.map((d) => {
                  if (!inRange(d)) return <span key={d} className="rf-blank" aria-hidden />;
                  const dq = quote(d);
                  const dt = toDate(d);
                  const on = d === start;
                  return (
                    <button key={d} className={`cv-day ${dt.getUTCDay() === 1 ? 'mon' : ''} ${on ? 'on' : ''} ${dq.ok ? '' : 'rf-off'}`} onClick={() => setPicked(d)} aria-pressed={on} title={dq.ok ? undefined : dq.why ?? undefined}>
                      <span className="tiny">{dt.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span>
                      <b>{dt.getUTCDate()}</b>
                      <span className="tiny dim">{dt.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}</span>
                    </button>
                  );
                })}
              </div>
              <div className="small dim">Greyed days clash with flights or checks.</div>
            </>
          )}
          </>)}
          </>)}
        </div>
        <div className="col gap-12 cv-right" style={{ minWidth: 0 }}>
          <div className="upper dim">Summary</div>
          <div className="cv-cost">
            {mode === 'cabin' && q.kind && <div className={`small ${q.kind === 'quick' ? 'good' : 'warn'}`}><b>{refitKindText(q.kind, q.days)}</b></div>}
            <div className="row between small"><span className="muted">{viaCheck ? 'Extra days on the C-check' : 'Out of service'}</span><b className="num">{noRest ? '–' : `${viaCheck ? ropt?.days ?? 0 : q.days} days`}</b></div>
            {mode === 'rest' ? (
              <div className="row between small"><span className="muted">Seats</span><b className="num">{viaCheck ? `${ac.cabin.total} (no change)` : `${q.seatsFrom} → ${q.seatsTo}`}</b></div>
            ) : (
              <>
                <div className="row between small"><span className="muted">Seats</span><b className="num">{q.seatsFrom} → {q.seatsTo}</b></div>
                <div className="row between small"><span className="muted">Cabin crew minimum</span><b className="num">{q.cabinMinFrom} → {q.cabinMinTo}</b></div>
                {q.restFrom && q.restTo && <div className="row between small"><span className="muted nowrap"><Term id="crewRest">Crew rest</Term></span><b className="num right">{restShort(q.restFrom.cc)}{q.restTo.cc?.kind !== q.restFrom.cc?.kind ? ` → ${restShort(q.restTo.cc)}` : ''}</b></div>}
              </>
            )}
            {q.ferryIn.length > 0 && <div className="row between small"><span className="muted">Ferry in</span><span className="num">{q.ferryIn.map((l) => `${l.from}–${l.to}`).join(', ')} {fmtDay(q.ferryIn[0].std)}</span></div>}
            {/* v0.12.1 a premium retrofit's breakdown: seats × price, engineering, days by the seats. */}
            {mode === 'cabin' && q.parts?.map((x) => <div key={x} className="small muted rf-part">{x}</div>)}
            <div className="row between"><b>Cost</b><b className="num">{noRest ? '–' : money(viaCheck ? ropt?.cost ?? 0 : q.cost)}</b></div>
            <div className="small dim">{viaCheck ? 'Paid with the check.' : 'Paid when the work starts. Free to cancel until then.'}</div>
          </div>
          {mode === 'cabin' && cheaper && <div className="small rf-why"><b>Only need business seats?</b> {cheaper.label} two-class: European business with the middle seat blocked, no new seats. {cheaper.days * 24} h, {money(cheaper.cost)}{need ? `, enough for ${need}` : ''}.</div>}
          {mode === 'rest' && <div className="small muted">Seats used for crew rest are blocked only on flights where someone rests in them; every other flight sells them.</div>}
          {viaCheck && ropt?.ok && <div className="small"><span className="good">{ropt.opens}</span></div>}
          {!viaCheck && (q.opens.length > 0 || q.closes.length > 0) && (
            <div className="col gap-4 small">
              {q.opens.length > 0 && <div><span className="good">Opens:</span> {q.opens.join(', ')}</div>}
              {q.closes.length > 0 && <div><span className="warn">Closes:</span> {q.closes.join(', ')}</div>}
            </div>
          )}
          {mode === 'cabin' && leased && <div className="small muted">{q.reinstateAtReturn ? `Leased: the lessor consents; reinstated at the lease return ≈ ${money(q.reinstateAtReturn)}.` : 'Leased: back to the delivered cabin, nothing to reinstate.'}</div>}
          {!noRest && !viaCheck && !q.ok && q.why && !booked && <div className="small row gap-8 cv-warn bad"><AlertTriangle className="sc-ico-s" /><span>{q.why}</span></div>}
        </div>
      </div>
    </Modal>
  );
}
