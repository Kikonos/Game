// Company (B5): reputation, approvals (apply, progress), policies and goals; competitors for context.
// DESIGN.md §6.3.

import { Award, BadgeCheck, Building2, Flag as FlagIcon, Settings2, ShieldCheck, Target } from 'lucide-react';
import { flag } from '../../data/countries';
import { rivalFleetText } from '../../engine/contracts/clients';
import { fmtDate } from '../../engine/core/time';
import type { GameState, Policies } from '../../engine/core/types';
import { APPROVALS, applyApproval, approvalBlocker, GOALS, setPolicies, type ApprovalDef } from '../../engine/ops';
import { Bar, Card, Seg, Stepper, Toggle } from '../components/ui';
import { money } from '../format';
import { store, useGame } from '../store';
import { KV, ScreenHead, useRenderCount } from './common';

function Reputation({ g }: { g: GameState }) {
  const r = g.company.reputation;
  const row = (label: string, v: number, tip: string) => (
    <div className="sc-rep" data-tip={tip}>
      <div className="row between"><b>{label}</b><span className="num">{Math.round(v)}</span></div>
      <Bar value={v / 100} tone={v >= 60 ? 'good' : v >= 40 ? 'warn' : 'bad'} />
      <div className="tiny dim">{tip}</div>
    </div>
  );
  return (
    <div className="col gap-12">
      {row('Reliable', r.reliable, 'On-time departures, completed programmes and legal crews raise it; AOGs, cancellations and sub-charters lower it.')}
      {row('Clean', r.clean, 'Humanitarian and repatriation work raise it; deportation and other sensitive flying lower it.')}
    </div>
  );
}

function apply(a: ApprovalDef) {
  store.openModal({
    kind: 'confirm', title: `Apply for ${a.name}?`, confirm: `Apply for ${money(a.cost)}`,
    body: `${a.desc} Costs ${money(a.cost)} and takes about ${a.days} days.`,
    onConfirm: () => store.act((g) => applyApproval(g, a.id)),
  });
}

function Approvals({ g }: { g: GameState }) {
  const c = g.company;
  return (
    <div className="sc-list">
      {APPROVALS.map((a) => {
        const held = c.approvals.includes(a.id);
        const p = c.pendingApprovals.find((x) => x.id === a.id);
        const block = held || p ? null : approvalBlocker(g, a.id);
        const prog = p ? Math.min(1, Math.max(0, (g.now - p.started) / Math.max(1, p.done - p.started))) : 0;
        return (
          <div key={a.id} className="sc-list-row">
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row gap-8"><b>{a.name}</b>{held && <span className="badge good"><BadgeCheck /> Held</span>}{p && <span className="badge info">In progress</span>}</div>
              <div className="small muted">{a.desc}</div>
              {p && (
                <div className="row gap-8 small mt-8"><Bar value={prog} size="thin" /><span className="nowrap dim">ready {fmtDate(p.done)}</span></div>
              )}
              {block && <div className="tiny warn">{block}</div>}
            </div>
            {!held && !p && (
              <div className="right nowrap">
                <div className="num"><b>{money(a.cost)}</b></div>
                <div className="tiny dim">{a.days} days</div>
              </div>
            )}
            {!held && !p && <button className="btn" disabled={!!block} onClick={() => apply(a)}>Apply</button>}
          </div>
        );
      })}
    </div>
  );
}

function PolicyForm({ g }: { g: GameState }) {
  const p = g.company.policies;
  const set = (patch: Partial<Policies>) => store.act((gg) => setPolicies(gg, patch), { toastOk: false });
  const row = (label: string, desc: string, ctl: React.ReactNode) => (
    <div className="set-row sc-policy"><div><b>{label}</b><div className="tiny dim">{desc}</div></div>{ctl}</div>
  );
  return (
    <div className="col">
      {row('Auto-roster', 'Crew new and changed flights automatically', <Toggle on={p.autoRoster} onChange={(v) => set({ autoRoster: v })} label="Auto-roster" />)}
      {row('Use tight duties', 'Allow duties within 30 min of a limit', <Toggle on={p.allowTight} onChange={(v) => set({ allowTight: v })} label="Tight duties" />)}
      {row('Auto deadhead', 'Buy deadhead tickets for crew automatically', <Toggle on={p.autoDeadhead} onChange={(v) => set({ autoDeadhead: v })} label="Auto deadhead" />)}
      {row('Auto A-checks', 'Plan A-checks in free slots (C-checks need you)', <Toggle on={p.autoMaintenance} onChange={(v) => set({ autoMaintenance: v })} label="Auto A-checks" />)}
      {row('Extra cabin crew', 'Above the legal minimum on every flight', <Stepper value={p.extraCabin} min={0} max={2} onChange={(v) => set({ extraCabin: v })} />)}
      {row('Crew hotels', 'Better hotels lift morale and cost more', <Seg<number> value={p.hotelTier} onChange={(v) => set({ hotelTier: v as Policies['hotelTier'] })} options={[3, 4, 5].map((v) => ({ value: v, label: `${v}★` }))} />)}
      {row('Per diems', '100% is the market rate', <Stepper value={p.perDiemPct} min={80} max={150} step={10} onChange={(v) => set({ perDiemPct: v })} format={(v) => `${v}%`} />)}
      {row('Rotation', 'Weeks away before crews rotate home', <Seg<number> value={p.rotationWeeks} onChange={(v) => set({ rotationWeeks: v as Policies['rotationWeeks'] })} options={[4, 5, 6].map((v) => ({ value: v, label: `${v} wk` }))} />)}
    </div>
  );
}

function Goals({ g }: { g: GameState }) {
  return (
    <div className="col gap-12">
      {GOALS.map((d) => {
        const st = g.goals.find((x) => x.id === d.id);
        let v = 0;
        try {
          v = st?.done ? 1 : d.progress(g);
        } catch {
          v = 0;
        }
        return (
          <div key={d.id} className="sc-goal">
            <div className="row between">
              <b className="row gap-8">{st?.done ? <Award className="sc-ico-s good" /> : <Target className="sc-ico-s dim" />}{d.title}</b>
              <span className="small dim">{st?.done ? `done ${fmtDate(st.done)}` : `${Math.min(99, Math.floor(v * 100))}%`}</span>
            </div>
            <div className="small muted">{d.desc}</div>
            <Bar value={v} size="thin" tone={st?.done ? 'good' : undefined} />
          </div>
        );
      })}
    </div>
  );
}

export function CompanyScreen() {
  useRenderCount('company');
  const g = useGame();
  const c = g.company;
  const fleet = Object.values(g.fleet).length;
  return (
    <div className="screen sc-company">
      <ScreenHead title={c.name} sub={`${c.icao} · callsign ${c.callsign} · home base ${c.homeBase}${c.ceo && c.ceo !== 'You' ? ` · CEO ${c.ceo}` : ''}`} />
      <div className="sc-company-cols">
        <div className="col gap-16">
          <Card title="Reputation" icon={<ShieldCheck className="ico" />}><Reputation g={g} /></Card>
          <Card title="Goals" icon={<FlagIcon className="ico" />}><Goals g={g} /></Card>
          <Card title="Company" icon={<Building2 className="ico" />}>
            <KV rows={[
              ['Operating since', fmtDate(g.started)],
              ['Aircraft', String(fleet)],
              ['Crew', String(Object.keys(g.crew).length)],
              ['Approvals held', c.approvals.length ? c.approvals.map((a) => APPROVALS.find((x) => x.id === a)?.name ?? a.toUpperCase()).join(', ') : 'none'],
            ]} />
          </Card>
        </div>
        <div className="col gap-16">
          <Card title="Policies" icon={<Settings2 className="ico" />}><PolicyForm g={g} /></Card>
          <Card title="Approvals" icon={<BadgeCheck className="ico" />} bodyClass="flush"><Approvals g={g} /></Card>
          {g.rivals.length > 0 && (
            <Card title="Competitors" sub="Other ACMI and charter operators bidding for the same work" bodyClass="flush">
              <div className="sc-list">
                {g.rivals.map((r) => (
                  <div key={r.id} className="sc-list-row">
                    <span className="sc-flag-s" aria-hidden>{flag(r.country)}</span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <b className="ellipsis">{r.name}</b>
                      <div className="small muted ellipsis">{rivalFleetText(r)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
