// v0.16 Company › Team › Sales managers (UPDATE-0.16.md §C.5; lane sales): one row per manager (market, skill, salary,
// leads found; let go), and a hire for a market from three candidates. Sits under the heads in Team's left list.

import { UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { MARKET_IDS, MARKET_BY_ID } from '../../../data/markets';
import { fireSalesRep, hireSalesRep, repCandidates, repRehireDays, salesRepsView, type SalesRepView } from '../../../engine/commercial';
import { BAL } from '../../../engine/core/balance';
import type { GameState } from '../../../engine/core/types';
import { Bar } from '../../components/ui';
import { money } from '../../format';
import { store } from '../../store';

const pct = (x: number) => Math.round(x * 100);
const R = BAL.v016.sales.reps;

function RepRow({ r, on }: { r: SalesRepView; on: boolean }) {
  const fire = () => store.openModal({
    kind: 'confirm', danger: true, title: `Let ${r.name} go?`, confirm: 'Let go',
    body: `One month's salary in severance (${money(r.salary)}). New candidates after 30 days.`,
    onConfirm: () => store.act((g) => fireSalesRep(g, r.id)),
  });
  return (
    <div className={`v16s-team-row ${on ? 'on' : ''}`}>
      <span className="col grow" style={{ minWidth: 0, gap: 2 }}>
        <b className="ellipsis">{r.name} <span className="small muted">· {r.marketName}</span></b>
        <span className="small muted ellipsis">Skill {pct(r.skill)} · {money(r.salary)}/mo · {r.leads} lead{r.leads === 1 ? '' : 's'} found · {r.status}</span>
      </span>
      <button className="btn btn-ghost v9-fire" onClick={fire}>Let go</button>
    </div>
  );
}

function Hire({ g, taken }: { g: GameState; taken: Set<string> }) {
  const free = MARKET_IDS.filter((m) => !taken.has(m));
  const [market, setMarket] = useState<string>('');
  const [open, setOpen] = useState(false);
  const m = free.includes(market as (typeof free)[number]) ? market : free[0];
  const wait = repRehireDays(g);
  const cands = m && open ? repCandidates(g, m) : [];
  if (!free.length) return null;
  return (
    <div className="v16s-team-block">
      {!open ? (
        <button className="btn" onClick={() => setOpen(true)}><UserPlus /> Hire a sales manager</button>
      ) : (
        <>
          <div className="row gap-8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="select grow" value={m} aria-label="Market" onChange={(e) => setMarket(e.target.value)}>
              {free.map((id) => <option key={id} value={id}>{MARKET_BY_ID[id].name}</option>)}
            </select>
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>Close</button>
          </div>
          <div className="tiny dim">One manager per market, up to {R.max}. About {R.leadsPerMonth} leads a month × skill in their market, +{R.pitches} pitches a season, {BAL.v016.sales.lead.workedPerRep} more proposals in work. Joins in {R.joinDays} days.</div>
          {wait > 0 ? <div className="small muted">New candidates in {wait} day{wait === 1 ? '' : 's'}.</div> : cands.map((c, i) => (
            <div key={`${c.name}-${i}`} className="v8-box v9-cand-row">
              <div className="row gap-12">
                <div className="col grow" style={{ minWidth: 0, gap: 2 }}>
                  <b>{c.name} <span className="small muted">· {c.years} years</span></b>
                  <span className="small muted">{c.blurb}</span>
                  <span className="row gap-8 small"><span className="dim">Skill {pct(c.skill)}</span><Bar value={c.skill} size="thin" tone="good" /><span className="num nowrap">{money(c.salary)}/mo</span></span>
                </div>
                <button className="btn btn-primary" onClick={() => store.act((g2) => hireSalesRep(g2, m, i))}><UserPlus /> Hire</button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export function SalesStaff({ g }: { g: GameState }) {
  const reps = salesRepsView(g);
  const sel = store.nav.sel?.kind === 'rep' ? store.nav.sel.id : null;
  const taken = new Set(reps.map((r) => r.market));
  return (
    <div className="v16s-team">
      <div className="v16s-team-head small muted row gap-6" style={{ alignItems: 'center' }}><Users className="sc-ico-s" /> Sales managers · {reps.length} of {R.max}</div>
      {reps.map((r) => <RepRow key={r.id} r={r} on={r.id === sel} />)}
      {!reps.length && <div className="small dim" style={{ padding: '0 12px 6px' }}>Nobody yet. A regional sales manager finds leads in one market and adds a pair of hands to the desk.</div>}
      {reps.length < R.max && <Hire g={g} taken={taken} />}
    </div>
  );
}
