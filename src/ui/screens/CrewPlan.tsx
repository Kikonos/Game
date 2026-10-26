// v0.7.4 Crew planning (Crew screen, third view): per aircraft type family the crew SETS needed, complete now and with
// the joiners, a clean per-role table and one verdict line; Round up opens the hire flow pre-filled with exactly the
// crew that complete the sets. The People view keeps a one-line summary per family that links here.

import { Check, UserPlus } from 'lucide-react';
import type { RatingFamily } from '../../data/acmiTypes';
import type { GameState } from '../../engine/core/types';
import { BAL } from '../../engine/core/balance';
import { awayOnDryLease, crewPlan, familyName, roundTargets, SETS_DETACHED, SETS_WHY, setWords, type FamilyPlan } from '../../engine/crew';
import { typeOf } from '../../engine/core/perf';
import { Term } from '../components/Term';
import { store } from '../store';
import { isPilotRole } from './screenLogic';

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
  return (
    <div className={`card cp-card ${short ? 'short' : ''}`}>
      <div className="row between gap-8 cp-head">
        <b className="cp-name">{p.label}</b>
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
              <td className={`num ${r.balance < 0 ? 'warn' : r.balance > 0 ? 'muted' : 'good'}`}>{r.balance < 0 ? `short ${-r.balance}` : r.balance > 0 ? `+${r.balance}` : 'exact'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {p.alsoRated.map((b) => (
        <div key={`a${b.family}`} className="tiny muted cp-backup">{backupWho(b)} also rated on the {b.label} <span className="dim">(backup there; counted here, where they were hired)</span></div>
      ))}
      {p.backupFrom.map((b) => (
        <div key={`f${b.family}`} className="tiny muted cp-backup">{backupWho(b)} from the {b.label} also rated here <span className="dim">(backup; counted in the {b.label})</span></div>
      ))}
      {p.clientCabin > 0 && <div className="tiny muted"><Term id="dampLease">Mixed crew</Term>: clients' own cabin crew fly about {p.clientCabin} of the cabin places in these sets; only ours are counted.</div>}
      {p.dryLeased > 0 && <div className="tiny muted">Dry lease out: {p.dryLeased} more {p.dryLeased === 1 ? 'aircraft is' : 'aircraft are'} away with the lessee's crews; no sets until {p.dryLeased === 1 ? 'it comes' : 'they come'} back.</div>}
      <div className="row gap-8 cp-actions">
        {t.complete !== null ? (
          <button className="btn btn-primary" onClick={() => store.openModal({ kind: 'roundUp', family: p.family, target: t.complete! })}><UserPlus /> Hire to complete {t.complete} sets</button>
        ) : t.next !== null ? (
          <button className="btn btn-primary" onClick={() => store.openModal({ kind: 'roundUp', family: p.family, target: t.next! })}><UserPlus /> Round up to {t.next} sets</button>
        ) : (
          <button className="btn" disabled><Check /> Sets complete</button>
        )}
        {t.complete === null && t.next === null && (
          <button className="btn btn-ghost small" onClick={() => store.openModal({ kind: 'roundUp', family: p.family, target: t.spare })}>Add a spare set</button>
        )}
      </div>
    </div>
  );
}

/** '3 cabin crew' / '2 pilots and 3 cabin crew'. */
function backupWho(b: { cabin: number; pilots: number }): string {
  const parts = [b.pilots ? `${b.pilots} pilot${b.pilots === 1 ? '' : 's'}` : '', b.cabin ? `${b.cabin} cabin crew` : ''].filter(Boolean);
  return parts.join(' and ');
}

export function CrewPlanView({ g }: { g: GameState }) {
  const plans = crewPlan(g);
  const idle = idleTypes(g, plans);
  return (
    <div className="cp-view">
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

/** People view: one calm line per family ('A320 family · 18 of 20 sets · short 2 CPT, 1 PUR'), tap → Planning. */
export function PlanStrip({ g, onOpen }: { g: GameState; onOpen: () => void }) {
  const plans = crewPlan(g);
  if (!plans.length) return null;
  return (
    <div className="cp-strip">
      {plans.map((p) => {
        const short = p.setsComplete < p.setsNeeded;
        const miss = p.roles.filter((r) => r.balance < 0).map((r) => `${-r.balance} ${r.role}`).join(', ');
        return (
          <button key={p.family} className={`cp-chip ${short ? 'short' : ''}`} onClick={onOpen} aria-label={`${p.label}: ${p.setsComplete} of ${p.setsNeeded} crew sets. Open crew planning`}>
            <b>{p.label}</b>
            <span className={`num ${short ? 'warn' : 'good'}`}>{p.setsComplete} of {p.setsNeeded} sets</span>
            {short && <span className="tiny muted">short {miss}</span>}
          </button>
        );
      })}
    </div>
  );
}
