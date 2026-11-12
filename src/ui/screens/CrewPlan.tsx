// v0.7.4 Crew planning (Crew screen, third view): per aircraft type family the crew SETS needed, complete now and with
// the joiners, a clean per-role table and one verdict line; Round up opens the hire flow pre-filled with exactly the
// crew that complete the sets. The People view keeps a one-line summary per family that links here.

import { CalendarClock, Check, GraduationCap, UserPlus } from 'lucide-react';
import type { RatingFamily } from '../../data/acmiTypes';
import type { GameState } from '../../engine/core/types';
import { awayOnDryLease, conversionClasses, crewPeakCard, crewPlan, deploymentSets, familyName, peakForecast, peakGroups, peakId, roundTargets, setWords, type FamilyPlan } from '../../engine/crew';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { fmtDay } from '../../engine/core/time';
import { ProblemCardView, runAction } from '../components/ProblemCard';
import { typeOf } from '../../engine/core/perf';
import { Term } from '../components/Term';
import { Help } from '../components/Help';
import { store } from '../store';
import { baseDay, isPilotRole } from './screenLogic';
import { planSentence, setsWhyLines } from './crewPlanLogic';
import { lockOf } from '../../engine/scenario';
import { LockNote } from '../components/Locked';

const ROLE_WORD: Record<string, string> = { CPT: 'Captains', FO: 'First officers', PUR: 'Pursers', CC: 'Cabin crew' };
/** v0.22 the '?' on the Have column: where crew rated on two fleets are counted (it used to be a bracket on every line). */
const DUAL_NOTE = 'They count once: in the fleet they were hired for, and as backup in the other. When their own fleet has all it needs, the spare ones count where they are needed.';

/**
 * Crew types held with no aircraft of them flying (converted ahead, or left over): idle but paid. `leased`: every
 * aircraft of the type is away on a dry lease (v0.8), so the crew wait for its return.
 */
function idleTypes(g: GameState, plans: FamilyPlan[]): { family: RatingFamily; pilots: number; cabin: number; leased: boolean }[] {
  const flown = new Set(plans.map((p) => p.family));
  const away = new Set(Object.values(g.fleet).filter((ac) => awayOnDryLease(g, ac)).map((ac) => typeOf(ac.typeId).family));
  const idle = new Map<RatingFamily, { pilots: number; cabin: number }>();
  for (const c of Object.values(g.crew)) {
    for (const f of c.ratings) {
      if (flown.has(f)) continue;
      const x = idle.get(f) ?? { pilots: 0, cabin: 0 };
      if (isPilotRole(c.role)) x.pilots++;
      else x.cabin++;
      idle.set(f, x);
    }
  }
  return [...idle].map(([family, x]) => ({ family, ...x, leased: away.has(family) }));
}

/** One family: sets, the verdict, the role table and the round-up buttons. */
/** v0.23 people booked on classes onto a type, in a line for its card: '39 in classes for this type (10 PUR, 29 CC) · last one ends 19 Jul'. */
function bookedLine(g: GameState, family: RatingFamily): string | null {
  const ks = conversionClasses(g).filter((k) => k.family === family);
  const ids = ks.flatMap((k) => k.crewIds).filter((id) => g.crew[id]);
  if (!ids.length) return null;
  const by = ['CPT', 'FO', 'PUR', 'CC'].map((r) => [r, ids.filter((id) => g.crew[id].role === r).length] as const).filter(([, n]) => n > 0);
  return `${ids.length} in classes for this type (${by.map(([r, n]) => `${n} ${r}`).join(', ')}) · last one ends ${baseDay(g, Math.max(...ks.map((k) => k.end)) - 1)}`;
}

function FamilyCard({ p, lock, trainLock, booked }: { p: FamilyPlan; lock?: string | null; trainLock?: string | null; booked?: string | null }) {
  const t = roundTargets(p);
  const short = p.setsComplete < p.setsNeeded;
  const pct = (n: number) => `${Math.min(100, (n / Math.max(1, p.setsNeeded)) * 100)}%`;
  return (
    <div className={`card cp-card ${short ? 'short' : ''}`}>
      <div className="row between gap-8 cp-head">
        {/* v0.14 why N per aircraft, what limits them, who fills which seats (three short lines); v0.22 behind the '?'. */}
        <span className="row gap-8"><b className="cp-name">{p.label}</b>
          <Help title="How crew sets work">{setsWhyLines(p).map((l) => <p key={l}>{l}</p>)}</Help>
        </span>
        <span className="small muted">{p.types.map((x) => `${x.short} ×${x.aircraft}`).join(' · ')}</span>
      </div>
      <div className="cp-sets">
        <div className="cp-num"><span className="tiny dim">Sets needed</span><b className="num">{p.setsNeeded}</b><span className="tiny muted">{p.setsPerAircraft} per aircraft</span></div>
        <div className="cp-num"><span className="tiny dim">Complete now</span><b className={`num ${p.setsNow < p.setsNeeded ? 'warn' : ''}`}>{p.setsNow}</b><span className="tiny muted">working today</span></div>
        <div className="cp-num"><span className="tiny dim">With joiners</span><b className={`num ${short ? 'warn' : 'good'}`}>{p.setsComplete}</b><span className="tiny muted">{p.limiting ? `limited by ${ROLE_WORD[p.limiting].toLowerCase()}` : 'all roles covered'}</span></div>
        <div className="cp-bar" aria-hidden>
          <span className="cp-bar-now" style={{ width: pct(p.setsNow) }} />
          <span className="cp-bar-join" style={{ width: pct(p.setsComplete) }} />
        </div>
      </div>
      <div className={`small cp-verdict ${short ? 'warn' : 'good'}`}>{p.verdict}</div>
      <div className="tiny muted">
        <Term id="crewSet">One set</Term>: {p.types.map((x) => `${p.types.length > 1 ? `${x.short} ` : ''}${setWords(x.set)}`).join(' · ')}{p.augmented ? ' · plus a third pilot (FO) or a second CPT + FO for the long days flown with 3 or 4 pilots' : ''}
      </div>
      <table className="cp-table">
        <thead>
          <tr><th>Role</th><th>Have{(p.alsoRated.length > 0 || p.backupFrom.length > 0) && <> <Help title="Crew rated on two fleets">{DUAL_NOTE}</Help></>}</th><th>Needed</th><th>Joining</th><th>Off now</th><th>Short / over</th></tr>
        </thead>
        <tbody>
          {p.roles.map((r) => (
            <tr key={r.role}>
              <td><b>{r.role}</b> <span className="tiny muted">{ROLE_WORD[r.role]}</span></td>
              <td className="num">{r.have}{r.shared ? <span className="tiny muted cp-shared">{r.shared} shared</span> : null}</td>
              <td className="num">{r.need}</td>
              <td className="num">{r.joining || '–'}</td>
              <td className="num">{r.away || '–'}</td>
              <td className={`num ${r.balance < 0 ? 'warn' : r.balance > 0 ? 'muted' : 'good'}`}>
                {r.balance < 0 ? `short ${-r.balance}` : r.balance > 0 ? `+${r.balance}` : 'exact'}
                {r.covered > 0 && <span className="tiny muted cp-covered">{coverWords(r)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {p.alsoRated.map((b) => b.spill ? (
        <div key={`as${b.family}`} className="tiny muted cp-backup">{backupWho(b)} hired for the {b.label} also rated here · counted here</div>
      ) : (
        <div key={`a${b.family}`} className="tiny muted cp-backup">{backupWho(b)} also rated on the {b.label} · counted here</div>
      ))}
      {p.backupFrom.map((b) => b.spill ? (
        <div key={`fs${b.family}`} className="tiny muted cp-backup">{backupWho(b)} hired here also rated on the {b.label} · counted in the {b.label}</div>
      ) : (
        <div key={`f${b.family}`} className="tiny muted cp-backup">{backupWho(b)} from the {b.label} also rated here · counted in the {b.label}</div>
      ))}
      {booked && <div className="tiny good cp-backup">{booked}</div>}
      {p.clientCabin > 0 && <div className="tiny muted"><Term id="dampLease">Mixed crew</Term>: clients' crew fly about {p.clientCabin} cabin {p.clientCabin === 1 ? 'place' : 'places'}</div>}
      {p.dryLeased > 0 && <div className="tiny muted">Dry lease out: {p.dryLeased} more {p.dryLeased === 1 ? 'aircraft is' : 'aircraft are'} away with the lessee's crews; no sets until {p.dryLeased === 1 ? 'it comes' : 'they come'} back.</div>}
      {/* v0.15 a scenario's hiring allowance. */}
      <LockNote why={lock} />
      <div className="row gap-8 cp-actions">
        {t.complete !== null ? (
          <button className="btn btn-primary" onClick={() => store.openModal({ kind: 'roundUp', family: p.family, target: t.complete! })}><UserPlus /> Hire to complete {t.complete} sets</button>
        ) : (
          // v0.14 a complete family: a quiet 'Sets complete' and the round-up as a small secondary button.
          <span className="small good row gap-4 cp-done"><Check className="sc-ico-s" /> Sets complete</span>
        )}
        {t.complete === null && t.next !== null && (
          <button className="btn btn-sm" onClick={() => store.openModal({ kind: 'roundUp', family: p.family, target: t.next! })}><UserPlus /> Round up to {t.next} sets</button>
        )}
        {t.complete === null && t.next === null && (
          <button className="btn btn-ghost btn-sm" onClick={() => store.openModal({ kind: 'roundUp', family: p.family, target: t.spare })}>Add a spare set</button>
        )}
        {/* v0.23 train the crew we have onto this type: the class planner. */}
        <button className={`btn ${t.complete !== null ? '' : 'btn-sm'} cp-classes ${trainLock ? 'locked' : ''}`} onClick={() => store.openModal({ kind: 'classPlan', family: p.family })} disabled={!!trainLock} data-tip={trainLock ?? undefined}><GraduationCap /> Plan classes</button>
      </div>
    </div>
  );
}

/** v0.11.2 seniors in junior seats: 'with 2 PUR' on the cabin crew row, '2 in CC seats' on the pursers' row. */
function coverWords(r: { role: string; covered: number }): string {
  if (r.role === 'CC') return ` with ${r.covered} PUR`;
  return ` ${r.covered} in CC seats`;
}

/** '3 cabin crew' / '2 pilots and 3 cabin crew'. */
function backupWho(b: { cabin: number; pilots: number }): string {
  const parts = [b.pilots ? `${b.pilots} pilot${b.pilots === 1 ? '' : 's'}` : '', b.cabin ? `${b.cabin} cabin crew` : ''].filter(Boolean);
  return parts.join(' and ');
}

/**
 * Peak-staffing round: the busy months ahead short of crew (crew/forecast.ts), shown only when there is a gap: a quiet
 * line with a prefilled Hire button, or the four-line card when the gap is serious (a whole set, any pilot, or too late
 * to hire in time). People view (under the sets strip) and Planning view (on top).
 */
export function PeakHeadsUp({ g }: { g: GameState }) {
  const groups = peakGroups(peakForecast(g));
  if (!groups.length) return null;
  return (
    <div className="cp-peak" aria-label="Busy months ahead">
      {groups.map((xs) => {
        const id = peakId(xs[0].month, xs[0].family);
        const card = crewPeakCard(g, id);
        if (!card) return null;
        if (xs.some((x) => x.serious)) return <ProblemCardView key={id} g={g} card={card} />;
        const hire = card.actions[0];
        return (
          <div key={id} className="cp-peak-line">
            <CalendarClock className="sc-ico-s cp-peak-ico" aria-hidden />
            <span className="small cp-peak-text">{card.what}<span className="muted"> · hire by {fmtDay(Math.min(...xs.map((x) => x.hireBy)))}</span></span>
            {hire && <button className="btn btn-sm" onClick={() => runAction(g, hire)}><UserPlus /> {hire.label}</button>}
          </div>
        );
      })}
    </div>
  );
}

export function CrewPlanView({ g }: { g: GameState }) {
  const plans = crewPlan(g);
  const idle = idleTypes(g, plans);
  return (
    <div className="cp-view">
      <PeakHeadsUp g={g} />
      {!plans.length && <div className="small muted">No aircraft in the fleet yet.</div>}
      <div className="cp-grid">
        {plans.map((p) => <FamilyCard key={p.family} p={p} lock={lockOf(g, 'hiring')} trainLock={lockOf(g, 'training')} booked={bookedLine(g, p.family)} />)}
      </div>
      {idle.length > 0 && (
        <div className="small muted cp-idle">
          {idle.map((x) => `${familyName(x.family)}: ${x.pilots ? `${x.pilots} pilot${x.pilots === 1 ? '' : 's'}` : ''}${x.pilots && x.cabin ? ' and ' : ''}${x.cabin ? `${x.cabin} cabin crew` : ''} hold it; ${x.leased ? 'its aircraft are away on dry lease' : 'no aircraft of it in the fleet'}`).join(' · ')}
        </div>
      )}
    </div>
  );
}

/** People view: one plain sentence per fleet ('A320: 2 of 5 full crews · short 6 cabin crew'), tap → Planning. */
/**
 * Rotations round (v0.16.4): one line per crew set on station, so the player sees the rotations as they run: "Set 2 at
 * Hamburg: 23 of 35 days · home 7 Jun", and under it who went home early and why.
 */
export function DeploymentStrip({ g }: { g: GameState }) {
  const lines = deploymentSets(g);
  if (!lines.length) return null;
  // Two deployments at one station (two aircraft): each line names its aircraft.
  const perBase = new Map<string, Set<string>>();
  for (const l of lines) perBase.set(l.base, (perBase.get(l.base) ?? new Set()).add(l.deploymentId));
  const regOf = (id: string) => g.fleet[g.deployments[id]?.aircraftId ?? '']?.reg;
  return (
    <div className="cp-deploy">
      <div className="tiny dim">On station · crews rotate every {g.company.policies.rotationWeeks} weeks <Help title="Crews on station">Days off are spent at the hotel. A set stays to the end when the deployment ends within a week of its change.</Help></div>
      <div className="cp-strip">
        {lines.map((l) => {
          const city = AIRPORT_BY_CODE[l.base]?.city ?? l.base;
          return (
            <div key={`${l.deploymentId}:${l.set}`} className={`cp-chip static ${l.crew ? '' : 'short'}`}>
              <span className="cp-line">
                <b>Set {l.set + 1} at {city}{(perBase.get(l.base)?.size ?? 0) > 1 && regOf(l.deploymentId) ? ` · ${regOf(l.deploymentId)}` : ''}</b>
                <span>{l.crew ? `${l.day} of ${l.of} days · home ${fmtDay(l.home)}` : `not crewed yet · ${l.of}-day tour to ${fmtDay(l.home)}`}</span>
                {l.early.map((e) => <span key={e.name} className="tiny warn">{e.name} goes home early: {e.why}</span>)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PlanStrip({ g, onOpen }: { g: GameState; onOpen: () => void }) {
  const plans = crewPlan(g);
  if (!plans.length) return null;
  return (
    <div className="cp-strip">
      {plans.map((p) => {
        const short = p.setsComplete < p.setsNeeded;
        // v0.14 one sentence (was the label, 'n of m sets' and the shortfall as role codes).
        const text = planSentence(p);
        const cut = text.indexOf(': ');
        return (
          <button key={p.family} className={`cp-chip ${short ? 'short' : ''}`} onClick={onOpen} aria-label={`${text}. Open crew planning`}>
            <span className="cp-line"><b>{text.slice(0, cut)}</b><span className={short ? 'warn' : 'good'}>{text.slice(cut + 1)}</span></span>
          </button>
        );
      })}
    </div>
  );
}
