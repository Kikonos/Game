// v0.7.1 Crew Control (UPDATE-0.7.1.md §3.11): the four-line card with its visual aid and the missing seats on the
// left, the nine ranked solutions on the right, each with cost, timing and consequences; a tap expands the preview
// (what changes, what is still missing, knock-on), the options (candidates with one reason each, jet classes, source
// trips) and Apply (two taps where the engine asks for a confirm). After a fix the view is re-read; crewed → Close.
// Engine: crew/control.ts (crewControl, applyCrewFix). Calm: nothing animates.

import { ArrowLeftRight, CalendarRange, Check, CircleSlash, Clock, Handshake, Hourglass, PhoneCall, PlaneTakeoff, Ticket, Users, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { flightsRev } from '../../engine/core/entities';
import { fmtTime } from '../../engine/core/time';
import type { CrewFix } from '../../engine/core/types';
import { applyCrewFix, crewControl, crewRev, ROLE_WORD, type CrewSolution, type FixOption } from '../../engine/crew';
import { Modal } from '../components/ui';
import { ProblemCardView } from '../components/ProblemCard';
import { ReasonIcon, ReasonLine } from '../components/ReasonIcon';
import { money } from '../format';
import { Dot } from '../screens/common';
import { spanLabel } from '../screens/screenLogic';
import { store, useGame } from '../store';

const FIX_ICON: Record<CrewFix, ReactNode> = {
  autoFix: <Wand2 />, deadhead: <Ticket />, delay: <Clock />, jet: <PlaneTakeoff />, callIn: <PhoneCall />, discretion: <Hourglass />,
  swap: <ArrowLeftRight />, subcharter: <Handshake />, cancel: <CircleSlash />,
};
const MULTI: CrewFix[] = ['deadhead', 'callIn'];
const LEVEL_TONE = { legal: 'good', tight: 'warn', illegal: 'bad' } as const;

function Option({ o, on, onTap, multi }: { o: FixOption; on: boolean; onTap: () => void; multi: boolean }) {
  const tone = o.level ? LEVEL_TONE[o.level] : undefined;
  return (
    <button className={`cc-opt ${on ? 'on' : ''} ${o.level === 'illegal' ? 'illegal' : ''}`} onClick={onTap} aria-pressed={on}>
      <span className={`cc-opt-check ${multi ? 'box' : 'radio'} ${on ? 'on' : ''}`} aria-hidden>{on && <Check />}</span>
      <span className="grow col cc-opt-main">
        <span className="row gap-8">{tone && <Dot tone={tone} />}<b className="ellipsis">{o.label}</b></span>
        <span className="small muted">{o.sub}</span>
        {o.reason && <ReasonLine reason={o.reason} tone={o.level === 'illegal' ? 'bad' : 'warn'} />}
      </span>
      {o.cost > 0 && <span className="num small nowrap">{money(o.cost)}</span>}
    </button>
  );
}

function Row({ s, open, onOpen, children }: { s: CrewSolution; open: boolean; onOpen: () => void; children?: ReactNode }) {
  const timing = s.newDeparture !== null ? `leaves ${fmtTime(s.newDeparture)}` : s.chips.find((c) => /^lands|^arrives|^wheels/i.test(c));
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
                {chips.slice(0, 3).map((c) => <span key={c} className={`chip sc-chip ${/−|Morale|Fatigue|Reliab/.test(c) ? 'warn' : ''}`}>{c}</span>)}
              </>
            ) : (
              <span className="chip sc-chip">not now</span>
            )}
          </span>
          <span className={`small ${s.available ? 'muted' : 'dim'} ellipsis`}>{s.available ? s.consequences[0] ?? s.desc : s.why ?? s.desc}</span>
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
  const title = `Crew Control · ${view.no} ${view.from} → ${view.to}`;
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
  const sel = (x: CrewSolution) => {
    const ids = picked[x.id];
    if (ids?.length) return ids;
    if (!x.options?.length) return [];
    // Default: the first option; deadhead / call-in take one person per missing seat (best first).
    if (MULTI.includes(x.id)) {
      const out: string[] = [];
      const need = view.missing.map((m) => ({ ...m }));
      for (const o of x.options) {
        const crew = g.crew[o.id];
        const slot = need.find((m) => m.n > 0 && (!crew || crew.role === m.role || (m.role === 'FO' && crew.role === 'CPT') || (m.role === 'CC' && (crew.role === 'SCC' || crew.role === 'CSD'))));
        if (slot) { slot.n--; out.push(o.id); }
      }
      return out.length ? out : [x.options[0].id];
    }
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
    <Modal size="xwide" className="cc-modal" title={title} icon={<Users className="accent" />} onClose={close} footer={
      <>
        <span className="small dim grow cc-foot-note">{done ? `Applied: ${done[0]}` : 'Tap a solution to see what it changes, then Apply.'}</span>
        <button className="btn" onClick={() => f.dutyId && store.openModal({ kind: 'duty', id: f.id })} disabled={!f.dutyId}><Users /> Adjust crew</button>
        <button className="btn btn-primary" onClick={close}>Close</button>
      </>
    }>
      <div className="cc-head">
        <span className="small muted">{when} · {view.reg}</span>
        <span className={`cs-banner ${stage === 'red' || stage === 'gate' ? 'red' : 'amber'}`}>{stage === 'gate' ? 'HELD AT THE GATE' : 'CREW SHORTAGE'}</span>
      </div>
      <div className="cc-cols">
        <div className="cc-left col gap-12">
          <ProblemCardView card={view.card} g={g} hideActions />
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
          {view.illegal.length > 0 && (
            <div className="col gap-4">
              <div className="upper dim">Can't legally fly it</div>
              {view.illegal.map((x) => (
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
            {view.solutions.map((x) => {
              const isOpen = open === x.id;
              const ids = sel(x);
              const multi = MULTI.includes(x.id);
              const canApply = x.available && (!x.options?.length || ids.length > 0);
              return (
                <Row key={x.id} s={x} open={isOpen} onOpen={() => setOpen(isOpen ? null : x.id)}>
                  <div className="small muted">{x.desc}{!x.available && x.why ? ` ${x.why}.` : ''}</div>
                  {x.options && x.options.length > 0 && (
                    <div className="cc-opts">
                      <div className="tiny dim">{multi ? `Choose who flies in (${ids.length} of ${view.missing.reduce((n, m) => n + m.n, 0)} seats)` : x.id === 'jet' ? 'Jet class' : 'Take the crew of'}</div>
                      {x.options.slice(0, 8).map((o) => <Option key={o.id} o={o} on={ids.includes(o.id)} onTap={() => toggle(x, o.id)} multi={multi} />)}
                      {x.options.length > 8 && <div className="tiny dim">… {x.options.length - 8} more</div>}
                    </div>
                  )}
                  {x.available && (
                    <div className="cc-preview">
                      <div className="tiny dim">What changes</div>
                      {x.preview.changes.length ? x.preview.changes.slice(0, 6).map((c, i) => <div key={i} className="small row gap-8"><Check className="sc-ico-s good" /><span>{c}</span></div>) : <div className="small muted">Nothing yet.</div>}
                      <div className={`small row gap-8 ${x.preview.after.level === 'ok' ? 'good' : x.preview.after.level === 'tight' ? 'warn' : 'bad'}`}>
                        <Dot tone={x.preview.after.level === 'ok' ? 'good' : x.preview.after.level === 'tight' ? 'warn' : 'bad'} />
                        <span>{x.preview.after.level === 'ok' ? `${view.no} is then crewed` : x.preview.after.level === 'tight' ? `${view.no} is then crewed, but close to a limit` : `${view.no} then still needs ${x.preview.after.missing.map((m) => `${m.n} ${m.n === 1 ? ROLE_WORD[m.role][0] : ROLE_WORD[m.role][1]}`).join(' and ') || 'a legal crew'}`}</span>
                      </div>
                      {x.preview.ripple.map((r, i) => <div key={i} className={`small row gap-8 ${r.tone}`}><Dot tone={r.tone} /><span><span className="mono">{r.no}</span> {r.text}</span></div>)}
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
                      <span className="small dim">{x.why ?? 'Not available for this flight.'}</span>
                    )}
                  </div>
                </Row>
              );
            })}
          </div>
          <div className="tiny dim cc-legend"><ReasonIcon code="place" /> wrong place · <ReasonIcon code="rest" /> needs rest · <ReasonIcon code="fdp" /> day too long · <ReasonIcon code="busy" /> busy · <ReasonIcon code="sick" /> sick · <ReasonIcon code="rating" /> not rated · <ReasonIcon code="leave" /> on leave · <ReasonIcon code="hours" /> out of hours</div>
        </div>
      </div>
    </Modal>
  );
}
