// v0.16 Company › Team › Nominated posts (UPDATE-0.16.md §F): the Compliance Monitoring Manager (ORO.GEN.200): who holds
// it, what it does for us, hire from three candidates, let go. Sits under the sales managers in Team's left list.

import { ShieldCheck, UserPlus } from 'lucide-react';
import { useState } from 'react';
import type { GameState } from '../../../engine/core/types';
import { complianceView, fireComplianceManager, hireComplianceManager } from '../../../engine/ops/compliance';
import { Bar } from '../../components/ui';
import { money } from '../../format';
import { store } from '../../store';

const pct = (x: number) => Math.round(x * 100);

export function NominatedPosts({ g }: { g: GameState }) {
  const v = complianceView(g);
  const [open, setOpen] = useState(false);
  const on = store.nav.sel?.kind === 'compliance';
  const h = v.hired;
  const fire = () => h && store.openModal({
    kind: 'confirm', danger: true, title: `Let ${h.name} go?`, confirm: 'Let go',
    body: `One month's salary in severance (${money(h.salary)}). You cover compliance monitoring yourself again; new candidates after 30 days.`,
    onConfirm: () => store.act((g2) => fireComplianceManager(g2)),
  });
  return (
    <div className="v16s-team">
      <div className="v16s-team-head small muted row gap-6" style={{ alignItems: 'center' }}><ShieldCheck className="sc-ico-s" /> Nominated posts</div>
      <div className={`v16s-team-row ${on ? 'on' : ''}`}>
        <span className="col grow" style={{ minWidth: 0, gap: 2 }}>
          <b className="ellipsis">Compliance Monitoring Manager</b>
          {h ? (
            <>
              <span className="small muted ellipsis">{h.name} · skill {pct(h.skill)} · {money(h.salary)}/mo · {v.status}</span>
              <span className="small good ellipsis">{v.effect}{v.rampSaved >= 1 ? ` · about ${Math.round(v.rampSaved)} ramp finding${Math.round(v.rampSaved) === 1 ? '' : 's'} avoided` : ''}</span>
            </>
          ) : (
            <span className="small muted ellipsis">Nobody: you cover it yourself. {v.does[1]}.</span>
          )}
        </span>
        {h ? <button className="btn btn-ghost v9-fire" onClick={fire}>Let go</button> : !open && <button className="btn" onClick={() => setOpen(true)}><UserPlus /> Hire</button>}
      </div>
      {!h && open && (
        <div className="v16s-team-block">
          <div className="tiny dim">{v.does.join('. ')}. Joins in 14 days; paid under salaries.</div>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-ghost" onClick={() => setOpen(false)}>Close</button></div>
          {v.rehireDays > 0 ? <div className="small muted">New candidates in {v.rehireDays} day{v.rehireDays === 1 ? '' : 's'}.</div> : v.candidates.map((c, i) => (
            <div key={`${c.name}-${i}`} className="v8-box v9-cand-row">
              <div className="row gap-12">
                <div className="col grow" style={{ minWidth: 0, gap: 2 }}>
                  <b>{c.name} <span className="small muted">· {c.years} years</span></b>
                  <span className="small muted">{c.blurb}</span>
                  <span className="row gap-8 small"><span className="dim">Skill {pct(c.skill)}</span><Bar value={c.skill} size="thin" tone="good" /><span className="num nowrap">{money(c.salary)}/mo</span></span>
                </div>
                <button className="btn btn-primary" onClick={() => { if (store.act((g2) => hireComplianceManager(g2, i)).ok) setOpen(false); }}><UserPlus /> Hire</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
