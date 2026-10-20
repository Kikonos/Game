// Manual roster adjustment (BRIEF "Player decisions"): who holds each seat of a duty's trip, legality warnings,
// and changes (replace, add an extra, take off, swap with someone on another trip, release a lock). Illegal
// choices are shown red with reasons and need a second tap ("assign anyway"); they stay flagged on the schedule.
// Engine: crew/rosterActions.ts (dutyCrew, dutyCandidates, dutyLegality, assignCrew, unassignCrew, swapCrew, unlockCrew).

import { ArrowLeftRight, ChevronLeft, Lock, LockOpen, Plus, UserMinus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { flightsRev } from '../../engine/core/entities';
import { BAL } from '../../engine/core/balance';
import { DAY, fmtDateTime, fmtDuration, fmtTime } from '../../engine/core/time';
import type { GameState, Role } from '../../engine/core/types';
import {
  assignCrew, crewRev, dutyCandidates, dutyCrew, dutyLegality, dutyOf, rosterOf, swapCrew, unassignCrew, unlockCrew,
  type DutyCandidate, type DutyCrewView, type RosterSlotView,
} from '../../engine/crew';
import { Modal, Seg } from '../components/ui';
import { money } from '../format';
import { Dot } from '../screens/common';
import { contractColor } from '../screens/palette';
import { ROLE_LABEL, ROLES } from '../screens/screenLogic';
import { store, useGame } from '../store';

const LEVEL_TONE = { legal: 'good', tight: 'warn', illegal: 'bad' } as const;
const LEVEL_LABEL = { legal: 'Legal', tight: 'Tight', illegal: 'Illegal' } as const;
const PAGE = 30;

/** 'LIS-CDG-LIS' for a duty's operated legs; 'positioning' when it only rides. */
export function dutyRoute(g: GameState, dutyId: string): string {
  const d = g.duties[dutyId];
  if (!d) return '';
  const fl = d.flightIds.map((id) => g.flights[id]).filter(Boolean);
  if (!fl.length) return d.deadheadIds.length ? 'positioning' : 'standby';
  return [fl[0].from, ...fl.map((f) => f.to)].join('-');
}

/** The other trip a candidate flies at the same time (for a swap), if exactly one overlaps this trip. */
function overlapDuty(g: GameState, v: DutyCrewView, crewId: string): string | null {
  const ds = v.dutyIds.map((id) => g.duties[id]).filter((d) => d && !d.done);
  if (!ds.length) return null;
  const from = Math.min(...ds.map((d) => d.report));
  const to = Math.max(...ds.map((d) => d.release));
  const other = rosterOf(g, crewId, from, to).filter((d) => d.pairingId !== v.pairingId && !d.done);
  const pairings = new Set(other.map((d) => d.pairingId));
  return pairings.size === 1 ? other[0].id : null;
}

interface Pick {
  /** Seat being changed (null: add a crew member above the complement). */
  seat: RosterSlotView | null;
  role: Role;
}

function Seat({ s, busy, later, onChange, onRemove, onUnlock }: { s: RosterSlotView; busy: boolean; later: boolean; onChange: () => void; onRemove: () => void; onUnlock: () => void }) {
  const tone = s.crewId ? (s.level ? LEVEL_TONE[s.level] : 'off') : later ? 'off' : 'bad';
  return (
    <div className={`sc-seat ${s.crewId ? '' : later ? 'open' : 'vacant'} ${s.level ?? ''}`}>
      <span className={`sc-role r-${s.role}`}>{s.role}</span>
      <span className="grow col sc-seat-who">
        <span className="row gap-8">
          <Dot tone={tone} />
          {s.crewId ? (
            <button className="sc-seat-name ellipsis" onClick={() => store.navigate('crew', { sel: { kind: 'crew', id: s.crewId! } })}>{s.name}</button>
          ) : (
            <b className={later ? 'muted' : 'bad'}>{later ? 'Open seat' : 'Empty seat'}</b>
          )}
        </span>
        <span className="small muted row gap-8">
          {s.crewId ? <span className={s.level ? LEVEL_TONE[s.level] : ''}>{s.level ? LEVEL_LABEL[s.level] : 'Flown'}</span> : <span>{ROLE_LABEL[s.role]} needed</span>}
          {s.extra && <span className="chip sc-chip">extra</span>}
          {s.locked && <span className="row gap-4 accent"><Lock className="sc-ico-s" />set by you</span>}
        </span>
      </span>
      {s.locked && s.crewId && (
        <button className="btn btn-ghost btn-icon" onClick={onUnlock} disabled={busy} aria-label="Let the auto-roster change this seat" data-tip="Let the auto-roster change this seat again"><LockOpen /></button>
      )}
      {s.crewId && (
        <button className="btn btn-ghost btn-icon" onClick={onRemove} disabled={busy} aria-label={`Take ${s.name} off`}><UserMinus /></button>
      )}
      <button className="btn" onClick={onChange} disabled={busy}>{s.crewId ? 'Change' : 'Assign'}</button>
    </div>
  );
}

function Candidate({ c, confirm, swapWith, onTap }: { c: DutyCandidate; confirm: boolean; swapWith: boolean; onTap: () => void }) {
  return (
    <button className={`sc-cand ${c.level} ${confirm ? 'confirm' : ''}`} onClick={onTap}>
      <Dot tone={LEVEL_TONE[c.level]} />
      <span className="grow col sc-cand-main">
        <span className="row gap-8">
          <b className="ellipsis">{c.name}</b>
          <span className={`sc-role r-${c.role}`}>{c.role}</span>
          {c.onPairing && <span className="chip sc-chip">on this trip</span>}
        </span>
        <span className="small muted ellipsis">
          at {c.loc} · {c.block28dH} h block in 28 d{c.ticket > 0 ? ` · ticket ${money(c.ticket)}` : ''}
        </span>
        {c.reasons.length > 0 && <span className={`small sc-cand-why ${LEVEL_TONE[c.level]}`}>{c.reasons.slice(0, 2).join(' · ')}</span>}
        {confirm && (
          <span className="small bad sc-cand-confirm">
            {swapWith ? 'Tap again to swap them between the two trips.' : 'Tap again to assign anyway. The duty stays flagged red until you fix it.'}
          </span>
        )}
      </span>
      {swapWith && <ArrowLeftRight className="sc-ico-s dim" />}
    </button>
  );
}

function Picker({ g, v, pick, setPick, back }: { g: GameState; v: DutyCrewView; pick: Pick; setPick: (p: Pick) => void; back: () => void }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const rev = flightsRev(g);
  const crev = crewRev(g);
  const holder = pick.seat?.crewId ?? null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => dutyCandidates(g, v.dutyId, pick.role).filter((c) => c.crewId !== holder), [g, v.dutyId, pick.role, holder, rev, crev, g.now]);
  const shown = all ? list : list.slice(0, PAGE);
  const tap = (c: DutyCandidate) => {
    const swapDuty = holder && c.codes.includes('overlap') ? overlapDuty(g, v, c.crewId) : null;
    if (c.level === 'illegal' && confirm !== c.crewId) return setConfirm(c.crewId);
    const res = swapDuty
      ? store.act((gg) => swapCrew(gg, v.dutyId, holder!, swapDuty, c.crewId, { force: c.level === 'illegal' && !c.codes.every((x) => x === 'overlap') }))
      : store.act((gg) => assignCrew(gg, v.dutyId, c.crewId, pick.role, { replace: holder ?? undefined, force: c.level === 'illegal' }));
    if (res.ok) back();
    else setConfirm(null);
  };
  return (
    <div className="col gap-12">
      <div className="row gap-8 wrap">
        <button className="btn btn-ghost" onClick={back}><ChevronLeft /> Seats</button>
        <span className="grow small muted">
          {pick.seat?.crewId ? <>Replace <b>{pick.seat.name}</b> ({pick.role})</> : pick.seat ? <>Fill the empty {pick.role} seat</> : <>Add a crew member above the complement</>}
        </span>
        {!pick.seat && (
          <div className="sc-seg-wrap"><Seg<Role> value={pick.role} onChange={(role) => setPick({ ...pick, role })} options={ROLES.map((r) => ({ value: r, label: r }))} /></div>
        )}
      </div>
      {!list.length && <div className="small muted sc-pad">Nobody rated on this type can take a {pick.role} seat. Hire or train crew from the Crew tab.</div>}
      <div className="col">
        {shown.map((c) => (
          <Candidate key={c.crewId} c={c} confirm={confirm === c.crewId} swapWith={!!holder && c.codes.includes('overlap') && !!overlapDuty(g, v, c.crewId)} onTap={() => tap(c)} />
        ))}
      </div>
      {list.length > shown.length && <button className="btn btn-ghost" onClick={() => setAll(true)}>Show all {list.length}</button>}
    </div>
  );
}

export function DutyModal({ id }: { id: string }) {
  const g = useGame();
  const [pick, setPick] = useState<Pick | null>(null);
  const [forceOff, setForceOff] = useState<string | null>(null);
  const rev = flightsRev(g);
  const crev = crewRev(g);
  const v = useMemo(() => dutyCrew(g, id), [g, id, rev, crev, g.now]); // eslint-disable-line react-hooks/exhaustive-deps
  const legal = useMemo(() => (v ? dutyLegality(g, v.dutyId) : null), [g, v, rev, crev, g.now]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => store.closeModal();
  const d = dutyOf(g, id);
  if (!v || !d || !legal) {
    return (
      <Modal title="Crew" icon={<Users className="accent" />} onClose={close}>
        <p className="muted">This flight has no duty yet: crew are rostered up to 14 days ahead, and flights flown by a rival or already landed have none.</p>
      </Modal>
    );
  }
  const ac = v.aircraftId ? g.fleet[v.aircraftId] : undefined;
  const c = v.contractId ? g.contracts[v.contractId] : undefined;
  const first = g.flights[d.flightIds[0]];
  const open = v.dutyIds.map((x) => g.duties[x]).filter((x) => x && !x.done);
  const busy = v.inProgress;
  const route = dutyRoute(g, d.id);
  const later = d.report > g.now + BAL.rosterHorizonDays * DAY && v.slots.every((x) => !x.crewId);
  const remove = (s: RosterSlotView) => {
    if (!s.crewId) return;
    if (!s.extra && forceOff !== s.crewId) return setForceOff(s.crewId);
    store.act((gg) => unassignCrew(gg, v.dutyId, s.crewId!, { force: !s.extra }));
    setForceOff(null);
  };
  return (
    <Modal size="wide" className="sc-duty-modal" title={`Crew · ${route}`} icon={<Users className="accent" />} onClose={close} footer={
      pick ? undefined : (
        <>
          <button className="btn" onClick={() => setPick({ seat: null, role: 'CC' })} disabled={busy}><Plus /> Add crew member</button>
          <span className="grow" />
          <button className="btn btn-primary" onClick={close}>Done</button>
        </>
      )
    }>
      <div className="col gap-12">
        <div className="sc-duty-head">
          <div className="col gap-4" style={{ minWidth: 0 }}>
            <span className="small muted">
              Report {fmtDateTime(d.report)} UTC{first ? ` (${fmtTime(d.report, first.from)} at ${first.from})` : ''} · release {fmtTime(d.release)} UTC
            </span>
            <span className="small muted">
              FDP {fmtDuration(d.fdp)} of {fmtDuration(d.maxFdp + (d.discretion ?? 0))} · {d.sectors} sector{d.sectors === 1 ? '' : 's'}{d.augment ? ` · +${d.augment} pilot${d.augment > 1 ? 's' : ''}` : ''}
              {ac ? ` · ${ac.reg}` : ''}
            </span>
            <span className="small dim">
              {v.kind === 'tour' ? 'Deployment tour' : 'Trip'} of {open.length} dut{open.length === 1 ? 'y' : 'ies'} still to fly: a change applies to all of them.
            </span>
          </div>
          {c && <span className="chip sc-chip sc-kchip ellipsis" style={{ ['--kc' as string]: contractColor(c.color) }}><span className="sc-kdot" />{c.title}</span>}
        </div>
        {later ? (
          <div className="sc-legal later">
            <div className="row gap-8"><Dot tone="off" /><b>Not rostered yet</b></div>
            <div className="small muted">The auto-roster fills duties {BAL.rosterHorizonDays} days ahead. You can still pick crew now; your choices are locked in.</div>
          </div>
        ) : (
        <div className={`sc-legal ${legal.level}`}>
          <div className="row gap-8"><Dot tone={LEVEL_TONE[legal.level]} /><b>{legal.level === 'legal' ? 'Legal: every seat filled, all limits kept' : legal.level === 'tight' ? 'Legal but tight' : 'Illegal: this duty cannot fly as rostered'}</b></div>
          {legal.warnings.slice(0, 5).map((w, i) => (
            <div key={i} className={`small row gap-8 ${LEVEL_TONE[w.level]}`}><Dot tone={LEVEL_TONE[w.level]} /><span>{w.text}</span></div>
          ))}
          {legal.warnings.length > 5 && <div className="tiny dim">… {legal.warnings.length - 5} more</div>}
        </div>
        )}
        {busy && <div className="small warn">A duty of this trip is under way. You can change the crew after it releases.</div>}
        {pick ? (
          <Picker g={g} v={v} pick={pick} setPick={setPick} back={() => setPick(null)} />
        ) : (
          <div className="col">
            {v.slots.map((s) => (
              <div key={`${s.index}-${s.crewId ?? 'empty'}`} className="col gap-4">
                <Seat s={s} busy={busy} later={later} onChange={() => setPick({ seat: s, role: s.role })} onRemove={() => remove(s)} onUnlock={() => s.crewId && store.act((gg) => unlockCrew(gg, v.dutyId, s.crewId!), { toastOk: false })} />
                {forceOff && forceOff === s.crewId && (
                  <div className="sc-force row gap-8">
                    <span className="small bad grow">{g.company.policies.autoRoster
                      ? `The ${s.role} seat is required. Take ${s.name ?? 'them'} off? The auto-roster puts someone else in the seat; if nobody legal is free it stays empty and the flight is flagged red.`
                      : `The ${s.role} seat is required. Leave it empty? The flight is flagged red until you fill it.`}</span>
                    <button className="btn" onClick={() => setForceOff(null)}>Keep</button>
                    <button className="btn btn-danger" onClick={() => remove(s)}>{g.company.policies.autoRoster ? 'Take off' : 'Leave empty'}</button>
                  </div>
                )}
              </div>
            ))}
            <div className="tiny dim">Seats you set are locked: the rolling re-plan keeps them (flagged red if they become illegal). Tap the open lock to hand a seat back to the auto-roster.</div>
          </div>
        )}
      </div>
    </Modal>
  );
}
