// v0.7.4 Crew planning (Crew screen, third view): per aircraft type family the crew SETS needed, complete now and with
// the joiners, a clean per-role table and one verdict line; Round up opens the hire flow pre-filled with exactly the
// crew that complete the sets. The People view keeps a one-line summary per family that links here.

import { CalendarClock, Check, Info, UserPlus } from 'lucide-react';
import { useState } from 'react';
import type { RatingFamily } from '../../data/acmiTypes';
import type { GameState } from '../../engine/core/types';
import { BAL } from '../../engine/core/balance';
import { awayOnDryLease, crewPeakCard, crewPlan, familyName, peakForecast, peakGroups, peakId, roundTargets, SETS_DETACHED, SETS_WHY, setWords, type FamilyPlan } from '../../engine/crew';
import { fmtDay } from '../../engine/core/time';
import { ProblemCardView, runAction } from '../components/ProblemCard';
import { typeOf } from '../../engine/core/perf';
import { Term } from '../components/Term';
import { store } from '../store';
import { isPilotRole } from './screenLogic';
import { planSentence, setsWhyLines } from './crewPlanLogic';

const ROLE_WORD: Record<string, string> = { CPT: 'Captains', FO: 'First officers', CRP: 'Relief pilots', PUR: 'Pursers', CC: 'Cabin crew' };

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
function FamilyCard({ p }: { p: FamilyPlan }) {
  const t = roundTargets(p);
  const short = p.setsComplete < p.setsNeeded;
  const pct = (n: number) => `${Math.min(100, (n / Math.max(1, p.setsNeeded)) * 100)}%`;
  // v0.14 the "i": why N per aircraft, what limits them, who fills which seats (three short lines).
  const [why, setWhy] = useState(false);
  return (
    <div className={`card cp-card ${short ? 'short' : ''}`}>
      <div className="row between gap-8 cp-head">
        <span className="row gap-4"><b className="cp-name">{p.label}</b>
          <button className={`btn btn-icon btn-ghost cp-info ${why ? 'on' : ''}`} onClick={() => setWhy(!why)} aria-expanded={why} aria-label={`How ${p.label} crew sets work`} title="How crew sets work"><Info /></button>
        </span>
        <span className="small muted">{p.types.map((x) => `${x.short} ×${x.aircraft}`).join(' · ')}</span>
      </div>
      {why && (
        <ul className="small muted cp-why">
          {setsWhyLines(p).map((l) => <li key={l}>{l}</li>)}
        </ul>
      )}
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
        <Term id="crewSet">One set</Term>: {p.types.map((x) => `${p.types.length > 1 ? `${x.short} ` : ''}${setWords(x.set)}`).join(' · ')}{p.augmented ? ' · plus relief pilots for the long days flown with 3 or 4 pilots' : ''}
      </div>
      <table className="cp-table">
        <thead>
          <tr><th>Role</th><th>Have</th><th>Needed</th><th>Joining</th><th>Off now</th><th>Short / over</th></tr>
        </thead>
        <tbody>
          {p.roles.map((r) => (
            <tr key={r.role}>
              <td><b>{r.role}</b> <span className="tiny muted">{ROLE_WORD[r.role]}</span></td>
              <td className="num">{r.have}{r.shared ? <span className="tiny muted"> ({r.shared} shared)</span> : null}</td>
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
        <div key={`as${b.family}`} className="tiny muted cp-backup">{backupWho(b)} hired for the {b.label} also rated here <span className="dim">(counted here, where they are needed: the {b.label} has all it needs)</span></div>
      ) : (
        <div key={`a${b.family}`} className="tiny muted cp-backup">{backupWho(b)} also rated on the {b.label} <span className="dim">(backup there; counted here, where they were hired)</span></div>
      ))}
      {p.backupFrom.map((b) => b.spill ? (
        <div key={`fs${b.family}`} className="tiny muted cp-backup">{backupWho(b)} hired here also rated on the {b.label} <span className="dim">(counted in the {b.label}, where they are needed: this family has all it needs)</span></div>
      ) : (
        <div key={`f${b.family}`} className="tiny muted cp-backup">{backupWho(b)} from the {b.label} also rated here <span className="dim">(backup; counted in the {b.label})</span></div>
      ))}
      {p.clientCabin > 0 && <div className="tiny muted"><Term id="dampLease">Mixed crew</Term>: clients' own cabin crew fly about {p.clientCabin} of the cabin places in these sets; only ours are counted.</div>}
      {p.dryLeased > 0 && <div className="tiny muted">Dry lease out: {p.dryLeased} more {p.dryLeased === 1 ? 'aircraft is' : 'aircraft are'} away with the lessee's crews; no sets until {p.dryLeased === 1 ? 'it comes' : 'they come'} back.</div>}
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
      </div>
    </div>
  );
}

/** v0.11.2 seniors in junior seats: 'with 2 PUR' on the cabin crew row, '2 in CC seats' on the pursers' row. */
function coverWords(r: { role: string; covered: number }): string {
  if (r.role === 'CC') return ` with ${r.covered} PUR`;
  if (r.role === 'CRP') return ` with ${r.covered} FO`;
  return ` ${r.covered} in ${r.role === 'PUR' ? 'CC' : 'CRP'} seats`;
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
      <div className="small muted cp-intro">
        {SETS_WHY}{plans.some((p) => p.setsPerAircraft > BAL.crewSetsPerAircraft) ? ` ${SETS_DETACHED}` : ''} The role you have fewest of decides how many sets are complete.
      </div>
      {!plans.length && <div className="small muted">No aircraft in the fleet yet.</div>}
      <div className="cp-grid">
        {plans.map((p) => <FamilyCard key={p.family} p={p} />)}
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
