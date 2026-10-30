// v0.7.1 Crew Control (UPDATE-0.7.1.md §3.11): the four-line card with its visual aid and the missing seats on the
// left, the nine ranked solutions on the right, each with cost, timing and consequences; a tap expands the preview
// (what changes, what is still missing, knock-on), the options (candidates with one reason each, jet classes, source
// trips) and Apply (two taps where the engine asks for a confirm). After a fix the view is re-read; crewed → Close.
// Engine: crew/control.ts (crewControl, applyCrewFix). Calm: nothing animates.

import { ArrowLeftRight, CalendarPlus, CalendarRange, Check, CircleSlash, Clock, Handshake, Hourglass, PhoneCall, PlaneTakeoff, Ticket, TimerOff, Users, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { flightsRev } from '../../engine/core/entities';
import { fmtTime } from '../../engine/core/time';
import type { CrewFix, Role } from '../../engine/core/types';
import { applyCrewFix, crewAlertKind, crewControl, crewRev, outOfHours, ROLE_WORD, type CrewSolution, type FixOption, type OohInfo } from '../../engine/crew';
import { Modal } from '../components/ui';
import { ProblemCardView } from '../components/ProblemCard';
import { cardUnderStrip } from '../../engine/problems/crew';
import { ReasonIcon, ReasonLine } from '../components/ReasonIcon';
import { money } from '../format';
import { Dot } from '../screens/common';
import { spanLabel } from '../screens/screenLogic';
import { store, useGame } from '../store';
import { canTake, chooseWord, defaultPicks, goneText, hurtTone, keepHurt, seatPlan } from './crewControlLogic';
import { HintButton, ScreenHint } from '../components/ScreenHint';

const FIX_ICON: Record<CrewFix, ReactNode> = {
  autoFix: <Wand2 />, deadhead: <Ticket />, delay: <Clock />, jet: <PlaneTakeoff />, callIn: <PhoneCall />, discretion: <Hourglass />,
  swap: <ArrowLeftRight />, subcharter: <Handshake />, cancel: <CircleSlash />,
  // v0.12.1
  buyBack: <CalendarPlus />,
};
const MULTI: CrewFix[] = ['deadhead', 'callIn'];
const LEVEL_TONE = { legal: 'good', tight: 'warn', illegal: 'bad' } as const;

function Option({ o, on, onTap, multi, role, seat, disabled }: { o: FixOption; on: boolean; onTap: () => void; multi: boolean; role?: Role; seat?: Role; disabled?: boolean }) {
  const tone = o.level ? LEVEL_TONE[o.level] : undefined;
  // v0.9 §R.4 a call-in candidate on standby: the name in bold, the standby kind and 'No overtime' as chips, the
  // response time underneath ('Rita Costa · Home standby (early) · ready in 1:30').
  const sby = /^(.*?) · ((?:Home|Hotel|Airport) standby[^·]*?|Reserve)(?: · (.*))?$/.exec(o.label);
  const noOt = !!sby && o.sub === 'No overtime';
  return (
    <button className={`cc-opt ${on ? 'on' : ''} ${o.level === 'illegal' ? 'illegal' : ''} ${disabled ? 'off' : ''}`} onClick={onTap} aria-pressed={on} disabled={disabled}>
      <span className={`cc-opt-check ${multi ? 'box' : 'radio'} ${on ? 'on' : ''}`} aria-hidden>{on && <Check />}</span>
      <span className="grow col cc-opt-main">
        <span className="row gap-8">{tone && <Dot tone={tone} />}{role && <span className={`sc-role r-${role}`}>{role}</span>}<b className="ellipsis">{sby ? sby[1] : o.label}</b>{seat && <span className="chip sc-chip good nowrap">{seat} seat</span>}{sby && <span className="chip sc-chip nowrap cc-sby">{sby[2].trim()}</span>}{noOt && <span className="chip sc-chip good nowrap">No overtime</span>}</span>
        {(sby ? sby[3] ?? (noOt ? '' : o.sub) : o.sub) && <span className="small muted">{sby ? sby[3] ?? o.sub : o.sub}</span>}
        {o.reason && <ReasonLine reason={o.reason} tone={o.level === 'illegal' ? 'bad' : 'warn'} />}
      </span>
      {o.cost > 0 && <span className="num small nowrap">{money(o.cost)}</span>}
    </button>
  );
}

/** v0.9 §T.4 one line under the title: who and which limit (the card's WHY and gauge carry the numbers, said once: §V). */
function OohStrip({ list }: { list: OohInfo[] }) {
  const x = list[0];
  if (!x) return null;
  const pct = x.max > 0 ? Math.min(100, (x.value / x.max) * 100) : 100;
  return (
    <div className="cc-ooh" role="note">
      <TimerOff className="cc-ooh-ico" aria-hidden />
      <span className="grow col cc-ooh-main">
        <span className="small"><span className={`sc-role r-${x.role}`}>{x.role}</span> <b>{x.name}</b> {x.limitText}{list.length > 1 ? ` · and ${list.length - 1} other${list.length > 2 ? 's' : ''}` : ''}</span>
      </span>
      {x.max > 0 && <span className="bar thin bad cc-ooh-bar" aria-hidden><span style={{ width: `${pct}%` }} /></span>}
    </div>
  );
}

const seatWords = (m: { role: Role; n: number }[]) => m.map((x) => `${x.n} ${x.n === 1 ? ROLE_WORD[x.role][0] : ROLE_WORD[x.role][1]}`).join(' and ');
/** 'Still needs 1 senior cabin crew afterwards': an available fix that leaves the flight short says so on its row. */
function leftover(s: CrewSolution): string | null {
  const a = s.preview.after;
  if (!s.available || a.level === 'ok' || a.level === 'tight' || a.level === 'cancelled' || a.level === 'subchartered') return null;
  return a.missing.length ? `Still needs ${seatWords(a.missing)} afterwards` : 'Still not a legal crew afterwards';
}

function Row({ s, open, onOpen, children }: { s: CrewSolution; open: boolean; onOpen: () => void; children?: ReactNode }) {
  const left = leftover(s);
  // The engine's own timing chip ('leaves 15:45 (+11h 45m)', 'lands 06:50') wins; else one from the new departure.
  const timing = s.chips.find((c) => /^leaves|^lands|^arrives|^wheels/i.test(c)) ?? (s.newDeparture !== null ? `leaves ${fmtTime(s.newDeparture)}` : undefined);
  // The engine's chips carry the price when there is one; our own cost chip only says 'free'.
  const chips = s.chips.filter((c) => c !== timing);
  const priced = chips.some((c) => /^[−-]?\$/.test(c));
  return (
    <div className={`cc-row ${s.available ? '' : 'off'} ${open ? 'open' : ''}`} data-fix={s.id}>
      <button className="cc-row-head" onClick={onOpen} aria-expanded={open} disabled={!s.available && !open && !s.why}>
        <span className={`cc-rank ${s.rank === 1 && s.available ? 'top' : ''}`}>{s.rank}</span>
        <span className="cc-ico" aria-hidden>{FIX_ICON[s.id]}</span>
        <span className="grow col cc-row-main">
          <span className="row gap-8 wrap">
            <b>{s.label}</b>
            {s.available ? (
              <>
                {!priced && <span className={`chip sc-chip ${s.cost > 0 ? '' : 'good'}`}>{s.cost > 0 ? money(s.cost) : 'free'}</span>}
                {timing && <span className="chip sc-chip">{timing}</span>}
                {keepHurt(chips, 3).map((c) => <span key={c} className={`chip sc-chip ${hurtTone(c) ?? (/−|Morale|Fatigue|Reliab/.test(c) ? 'warn' : '')}`}>{c}</span>)}
              </>
            ) : (
              <span className="chip sc-chip">not now</span>
            )}
          </span>
          <span className={`small ${left ? 'warn' : s.available ? 'muted' : 'dim'} ellipsis`}>{left ?? (s.available ? s.consequences[0] ?? s.desc : s.why ?? s.desc)}</span>
        </span>
      </button>
      {open && <div className="cc-row-body">{children}</div>}
    </div>
  );
}

export function CrewControlModal({ flightId, fix }: { flightId: string; fix?: CrewFix }) {
  const g = useGame();
  const s = store;
  const rev = flightsRev(g);
  const crev = crewRev(g);
  const hour = Math.floor(g.now / 60);
  const edits = s.editCount;
  // Nine previews on a copy of the state: once per crew / flight revision, game hour and player edit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => crewControl(g, flightId), [g, flightId, rev, crev, hour, edits]);
  const [open, setOpen] = useState<CrewFix | null>(fix ?? null);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [confirm, setConfirm] = useState<CrewFix | null>(null);
  const [done, setDone] = useState<string[] | null>(null);
  const close = () => store.closeModal();
  const f = g.flights[flightId];
  useEffect(() => setConfirm(null), [open]);
  if (!view || !f) {
    return (
      <Modal title="Crew Control" icon={<Users className="accent" />} onClose={close} footer={<button className="btn btn-primary" onClick={close}>Close</button>}>
        <p className="muted">{done ? done.join('. ') + '.' : 'This flight has left or no longer exists.'}</p>
      </Modal>
    );
  }
  // v0.9 §T: a named crew member over a legal limit reads 'Crew out of hours' (its own icon), a seat with nobody 'Crew shortage'.
  const hours = crewAlertKind(g, flightId) === 'hours';
  const ooh = hours ? outOfHours(g, flightId) : [];
  const title = hours ? `Crew out of hours · ${view.no} ${view.from} → ${view.to}` : `Crew Control · ${view.no} ${view.from} → ${view.to}`;
  // The title says 'Crew out of hours': the stage colour sits on its icon, and no banner repeats it (§V).
  const icon = hours ? <TimerOff className={view.stage === 'amber' ? 'warn' : 'bad'} /> : <Users className="accent" />;
  const left = view.std - g.now;
  const when = `Departs ${fmtTime(view.std)} UTC (${fmtTime(view.std, view.from)} ${view.from}) · ${left > 0 ? `in ${spanLabel(Math.floor(left / 60) * 60 || left)}` : 'now'}`;
  if (view.stage === 'ok') {
    return (
      <Modal title={title} icon={<Users className="accent" />} onClose={close} footer={<button className="btn btn-primary" onClick={close}>Close</button>}>
        <div className="col gap-8">
          <div className="row gap-8"><Dot tone="good" /><b>{view.no} is crewed</b></div>
          <div className="small muted">{when}</div>
          {done && <div className="small">{done.join('. ')}.</div>}
          <div className="row gap-8 wrap">
            {f.dutyId && <button className="btn" onClick={() => store.openModal({ kind: 'duty', id: f.id })}><Users /> Adjust crew</button>}
            <button className="btn" onClick={() => { close(); store.navigate('schedule', { sel: { kind: 'aircraft', id: view.aircraftId }, view: String(view.std) }); }}><CalendarRange /> Schedule</button>
          </div>
        </div>
      </Modal>
    );
  }
  const stage = view.stage;
  const roleOf = (id: string): Role => g.crew[id]?.role ?? 'CC';
  const sel = (x: CrewSolution) => {
    const ids = picked[x.id];
    if (ids?.length) return ids;
    if (!x.options?.length) return [];
    // Default: the first option; deadhead / call-in take one person per missing seat (best first).
    if (MULTI.includes(x.id)) return defaultPicks(view.missing, x.options.map((o) => ({ id: o.id, role: roleOf(o.id) })));
    return [x.options[0].id];
  };
  const toggle = (x: CrewSolution, id: string) => {
    const cur = sel(x);
    const next = MULTI.includes(x.id) ? (cur.includes(id) ? cur.filter((y) => y !== id) : [...cur, id]) : [id];
    setPicked({ ...picked, [x.id]: next });
    setConfirm(null);
  };
  const apply = (x: CrewSolution) => {
    if (x.confirm && confirm !== x.id) return setConfirm(x.id);
    const ids = sel(x);
    const opts = MULTI.includes(x.id) ? { crewIds: ids, confirmed: true } : { optionId: ids[0], confirmed: true };
    const r = store.act((gg) => applyCrewFix(gg, flightId, x.id, opts), { toastOk: false });
    setConfirm(null);
    if (r.ok && r.data) {
      setDone(r.data.changes);
      setPicked({});
      if (!r.data.after) return; // the memo re-reads: stage 'ok' or the flight has gone
      setOpen(null);
    }
  };
  return (
    <Modal size="xwide" className="cc-modal" title={<>{title}<HintButton id="crewControl" align="left" /></>} icon={icon} onClose={close} footer={
      <>
        <span className="small dim grow cc-foot-note">{done ? `Applied: ${done[0]}` : 'Tap a solution to see what it changes, then Apply.'}</span>
        <button className="btn" onClick={() => f.dutyId && store.openModal({ kind: 'duty', id: f.id })} disabled={!f.dutyId}><Users /> Adjust crew</button>
        <button className="btn btn-primary" onClick={close}>Close</button>
      </>
    }>
      <div className="cc-head">
        <span className="small muted">{when} · {view.reg}</span>
        {(!hours || stage === 'gate') && <span className={`cs-banner ${stage === 'red' || stage === 'gate' ? 'red' : 'amber'}`}>{stage === 'gate' ? 'HELD AT THE GATE' : 'CREW SHORTAGE'}</span>}
      </div>
      {hours && <OohStrip list={ooh} />}
      <ScreenHint id="crewControl" />
      <div className="cc-cols">
        <div className="cc-left col gap-12">
          <ProblemCardView card={hours && ooh.length ? cardUnderStrip(view.card, ooh, view.no) : view.card} g={g} hideActions />
          <div>
            <div className="upper dim">Missing seats</div>
            <div className="cc-seats">
              {view.missing.map((m) => (
                <span key={m.role} className="cc-seat">
                  <b>{m.n}</b>
                  <span className="col" style={{ gap: 0 }}><span className="small">{m.n === 1 ? ROLE_WORD[m.role][0] : ROLE_WORD[m.role][1]}</span><span className={`sc-role r-${m.role}`}>{m.role}</span></span>
                </span>
              ))}
              {!view.missing.length && <span className="small muted">Every seat is filled, but not legally.</span>}
            </div>
          </div>
          {view.illegal.some((x) => !ooh.some((y) => y.crewId === x.crewId)) && (
            <div className="col gap-4">
              <div className="upper dim">Can't legally fly it</div>
              {/* v0.9 round 4 (§V): crew the strip already names are not listed again. */}
              {view.illegal.filter((x) => !ooh.some((y) => y.crewId === x.crewId)).map((x) => (
                <div key={x.crewId} className="cc-illegal">
                  <span className={`sc-role r-${x.role}`}>{x.role}</span>
                  <ReasonLine reason={x.reason} tone="bad" name={x.name} />
                </div>
              ))}
            </div>
          )}
          <div className="tiny dim">{view.unit.revenueLegs ? `This fix covers ${view.unit.flightIds.length} leg${view.unit.flightIds.length === 1 ? '' : 's'} · ${view.unit.pax} passengers` : 'An empty flight: no passengers wait for it.'}</div>
        </div>
        <div className="cc-right">
          <div className="upper dim cc-sol-head">Solutions · best first</div>
          <div className="cc-rows">
            {view.solutions.filter((x) => !x.dominated).map((x) => {
              const isOpen = open === x.id;
              const ids = sel(x);
              const multi = MULTI.includes(x.id);
              const canApply = x.available && (!x.options?.length || ids.length > 0);
              return (
                <Row key={x.id} s={x} open={isOpen} onOpen={() => setOpen(isOpen ? null : x.id)}>
                  <div className="small muted">{x.desc}</div>
                  {x.options && x.options.length > 0 && (() => {
                    // Candidates: the role chip, the seat each tick fills, and no second tick for a seat already taken.
                    const plan = multi ? seatPlan(view.missing, ids.map((id) => ({ id, role: roleOf(id) }))) : null;
                    const seats = view.missing.reduce((n, m) => n + m.n, 0);
                    return (
                      <div className="cc-opts">
                        <div className="tiny dim">{multi ? `${chooseWord(x.id)} (${Math.min(ids.length, seats)} of ${seats} seat${seats === 1 ? '' : 's'})` : x.id === 'jet' ? 'Jet class' : 'Take the crew of'}</div>
                        {x.options.slice(0, 8).map((o) => {
                          const on = ids.includes(o.id);
                          const role = multi ? roleOf(o.id) : undefined;
                          return <Option key={o.id} o={o} on={on} onTap={() => toggle(x, o.id)} multi={multi} role={role} seat={plan?.seat[o.id]} disabled={!!plan && !on && !canTake(plan, role!)} />;
                        })}
                        {x.options.length > 8 && <div className="tiny dim">… {x.options.length - 8} more</div>}
                      </div>
                    );
                  })()}
                  {x.available && (
                    <div className="cc-preview">
                      <div className="tiny dim">What changes</div>
                      {x.preview.changes.length ? x.preview.changes.slice(0, 6).map((c, i) => <div key={i} className="small row gap-8"><Check className="sc-ico-s good" /><span>{c}</span></div>) : <div className="small muted">Nothing yet.</div>}
                      {(() => {
                        // A cancel or sub-charter leaves no flight to crew: say so, and keep its own legs out of the knock-on list.
                        const gone = goneText(x.id, view.no, x.consequences);
                        const after = x.preview.after.level;
                        const tone = gone ? 'off' : after === 'ok' ? 'good' : after === 'tight' ? 'warn' : 'bad';
                        const text = gone ?? (after === 'ok' ? `${view.no} is then crewed` : after === 'tight' ? `${view.no} is then crewed, but close to a limit` : `${view.no} then still needs ${x.preview.after.missing.map((m) => `${m.n} ${m.n === 1 ? ROLE_WORD[m.role][0] : ROLE_WORD[m.role][1]}`).join(' and ') || 'a legal crew'}`);
                        const ripple = gone ? x.preview.ripple.filter((r) => !view.unit.flightIds.includes(r.flightId)) : x.preview.ripple;
                        return (
                          <>
                            <div className={`small row gap-8 ${tone === 'off' ? 'muted' : tone}`}><Dot tone={tone} /><span>{text}</span></div>
                            {ripple.map((r, i) => <div key={i} className={`small row gap-8 ${r.tone}`}><Dot tone={r.tone} /><span><span className="mono">{r.no}</span> {r.text}</span></div>)}
                          </>
                        );
                      })()}
                      {x.consequences.slice(1).map((c, i) => <div key={`c${i}`} className="small muted">{c}</div>)}
                    </div>
                  )}
                  <div className="row gap-8 wrap cc-apply">
                    {x.available ? (
                      <>
                        <button className={`btn ${confirm === x.id ? 'btn-danger' : 'btn-primary'}`} onClick={() => apply(x)} disabled={!canApply}>
                          {confirm === x.id ? `Yes, ${x.label.toLowerCase()}` : x.confirm ? `${x.label} · confirm` : `Apply · ${x.label}`}
                        </button>
                        {confirm === x.id && <button className="btn" onClick={() => setConfirm(null)}>Keep as is</button>}
                        {x.cost > 0 && <span className="small muted">{money(x.cost)}{x.newDeparture !== null && x.newDeparture > view.std ? ` · ${spanLabel(x.newDeparture - view.std)} late` : ''}</span>}
                      </>
                    ) : (
                      // The reason already heads the row (§V: said once).
                      !x.why && <span className="small dim">Not available for this flight.</span>
                    )}
                  </div>
                </Row>
              );
            })}
          </div>
          {/* v0.8 fix pack: a private jet that can't beat a cheaper fix is one muted line, not a row. */}
          {view.solutions.filter((x) => x.dominated).map((x) => <div key={x.id} className="small dim cc-dominated" data-fix={x.id}>{x.why}</div>)}
          <div className="tiny dim cc-legend"><ReasonIcon code="place" /> wrong place · <ReasonIcon code="rest" /> needs rest · <ReasonIcon code="fdp" /> day too long · <ReasonIcon code="busy" /> busy · <ReasonIcon code="sick" /> sick · <ReasonIcon code="rating" /> not rated · <ReasonIcon code="leave" /> on leave · <ReasonIcon code="hours" /> out of hours</div>
        </div>
      </div>
    </Modal>
  );
}
