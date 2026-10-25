// Company (B5): reputation, approvals (apply, progress), policies and goals; competitors for context.
// v0.7: the Ladder across the top (Ladder.tsx); IOSA and DG stay below as other approvals. DESIGN.md §6.3.

import { useMemo } from 'react';
import { Award, BadgeCheck, Building2, ChevronRight, Flag as FlagIcon, Medal, Palette, Settings2, ShieldCheck, Target } from 'lucide-react';
import { clientList, rivalSummary, standing, STANDING_NAME } from '../../engine/contracts';
import { BAL } from '../../engine/core/balance';
import { fmtDate } from '../../engine/core/time';
import type { GameState, Policies } from '../../engine/core/types';
import { artFor } from '../../data/acmiTypes';
import { APPROVALS, applyApproval, approvalBlocker, GOALS, liveryOf, paintStatus, setFleetLivery, setPolicies, type ApprovalDef } from '../../engine/ops';
import { moraleSummary, policyPreview } from '../../engine/crew';
import { AircraftArt } from '../components/AircraftArt';
import { TailBadge } from '../components/Logo';
import { Bar, Card, Seg, Stepper, Tabs, Toggle } from '../components/ui';
import { money } from '../format';
import { store, useGame } from '../store';
import { KV, ScreenHead, useRenderCount } from './common';
import { LadderCard } from './Ladder';
import { ClientsView } from './Clients';
import { RivalsView } from './Rivals';
import { TeamView } from './Team';
import { AchievementsView } from './Achievements';
import { achievementsView, headsView } from '../../engine/ops';
import { ScreenHint } from '../components/ScreenHint';

type View = 'overview' | 'team' | 'clients' | 'rivals' | 'achievements';

/** v0.8 company standing (§1.6): three static steps, what this one brings, what is missing for the next. */
export function StandingCard({ g }: { g: GameState }) {
  const st = standing(g);
  return (
    <Card title="Standing" icon={<Medal className="ico" />} sub={st.text}>
      <div className="v8-tiers" role="img" aria-label={`Standing: ${st.name}`}>
        {([0, 1, 2] as const).map((t) => (
          <span key={t} className={`v8-tier ${t === st.tier ? 'on' : t < st.tier ? 'past' : ''}`}>{STANDING_NAME[t]}</span>
        ))}
      </div>
      <ul className="v8-lines mt-8">{st.effects.map((e) => <li key={e}>{e}</li>)}</ul>
      {st.progress.length > 0 && (
        <div className="col gap-8 mt-8">
          {st.progress.map((p) => (
            <div key={p.label} className="v8-prog">
              <div className="row between small"><span className="muted">{p.label}</span><span className={`num ${p.have >= p.need ? 'good' : ''}`}>{p.have} / {p.need}</span></div>
              <Bar value={p.need ? p.have / p.need : 1} size="thin" tone={p.have >= p.need ? 'good' : undefined} />
            </div>
          ))}
        </div>
      )}
      {st.next && <div className="small mt-8"><span className="muted">Still needed:</span> {st.next}</div>}
    </Card>
  );
}

/** v0.7: approvals outside the Ladder (IOSA, DG). */
const OTHER = new Set(['iosa', 'dg']);

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
      {APPROVALS.filter((a) => OTHER.has(a.id)).map((a) => {
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

const signedK = (v: number) => `${v >= 0 ? '+' : '−'}${money(Math.abs(v))}`;

/**
 * v0.6: one-line morale / cost effect of a policy (policyPreview, pure): the current setting against the market
 * standard, or at the market standard what the next step up would do.
 */
function effect(g: GameState, market: Partial<Policies>, up: Partial<Policies>, label: string, morale: (p: Policies) => string | null): string {
  const p = g.company.policies;
  const atMarket = (Object.keys(market) as (keyof Policies)[]).every((k) => p[k] === market[k]);
  const other = atMarket ? up : market;
  const pv = policyPreview(g, other);
  const sign = atMarket ? 1 : -1;
  const dT = Math.round(sign * (pv.target - pv.targetNow) * 10) / 10;
  // No closed month yet: estimate from the crew on the books instead of the (empty) finance history.
  const dC = g.finance.history.length ? sign * (pv.costPerMonth - pv.costNow) : sign * (estPolicyCost(g, { ...p, ...other }) - estPolicyCost(g, p));
  const parts: string[] = [];
  const m = morale(atMarket ? { ...p, ...up } : p);
  if (m) parts.push(m);
  else if (dT) parts.push(`Morale target ${dT > 0 ? '+' : '−'}${Math.abs(dT)}`);
  if (Math.abs(dC) >= 500) parts.push(`≈ ${signedK(dC)}/month`);
  if (!parts.length) return atMarket ? 'Market standard' : '';
  return atMarket ? `${label}: ${parts.join(' · ')}` : `${parts.join(' · ')} vs market`;
}

/** Days a month crew spend away from base (hotel nights, per diems) in the start-of-game estimate. */
const AWAY_DAYS = 14;

/** Monthly per diems and hotels at policies p for the crew on the books (estimate before the first closed month). */
function estPolicyCost(g: GameState, p: Policies): number {
  let v = 0;
  for (const c of Object.values(g.crew)) v += AWAY_DAYS * ((BAL.perDiem[c.role] ?? 54) * (p.perDiemPct / 100) + (BAL.hotelPerNight[p.hotelTier] ?? BAL.hotelPerNight[4]));
  return v;
}

const hotelMorale = (p: Policies) => {
  const d = BAL.morale.hotelDay[p.hotelTier] ?? 0;
  return d ? `Morale ${d > 0 ? '+' : '−'}${Math.abs(d)}/night away` : null;
};

function PolicyForm({ g }: { g: GameState }) {
  const p = g.company.policies;
  const set = (patch: Partial<Policies>) => store.act((gg) => setPolicies(gg, patch), { toastOk: false });
  const row = (label: string, desc: string, ctl: React.ReactNode, fx?: string) => (
    <div className="set-row sc-policy"><div><b>{label}</b><div className="tiny dim">{desc}</div>{fx && <div className="tiny sc-policy-fx">{fx}</div>}</div>{ctl}</div>
  );
  const market = policyPreview(g, { perDiemPct: 100, rotationWeeks: 5, hotelTier: 4 });
  return (
    <div className="col">
      {row('Auto-roster', 'Crew new and changed flights automatically', <Toggle on={p.autoRoster} onChange={(v) => set({ autoRoster: v })} label="Auto-roster" />)}
      {row('Use tight duties', 'Allow duties within 30 min of a limit', <Toggle on={p.allowTight} onChange={(v) => set({ allowTight: v })} label="Tight duties" />)}
      {row('Auto deadhead', 'Buy deadhead tickets for crew automatically', <Toggle on={p.autoDeadhead} onChange={(v) => set({ autoDeadhead: v })} label="Auto deadhead" />)}
      {row('Auto A-checks', 'Plan A-checks in free slots (C-checks need you)', <Toggle on={p.autoMaintenance} onChange={(v) => set({ autoMaintenance: v })} label="Auto A-checks" />)}
      {row('Default extra cabin crew', 'Above the legal minimum; each aircraft and contract can set its own', <Stepper value={p.extraCabin} min={0} max={BAL.crewExtra.cabinMax} onChange={(v) => set({ extraCabin: v })} />)}
      {row('Crew hotels', 'Better hotels lift morale and cost more (wet leases: client hotels)', <Seg<number> value={p.hotelTier} onChange={(v) => set({ hotelTier: v as Policies['hotelTier'] })} options={[3, 4, 5].map((v) => ({ value: v, label: `${v}★` }))} />, effect(g, { hotelTier: 4 }, { hotelTier: 5 }, 'At 5★', hotelMorale))}
      {row('Per diems', '100% is the market rate', <Stepper value={p.perDiemPct} min={80} max={150} step={10} onChange={(v) => set({ perDiemPct: v })} format={(v) => `${v}%`} />, effect(g, { perDiemPct: 100 }, { perDiemPct: 110 }, 'At 110%', () => null))}
      {row('Rotation', 'Weeks away before crews rotate home', <Seg<number> value={p.rotationWeeks} onChange={(v) => set({ rotationWeeks: v as Policies['rotationWeeks'] })} options={[4, 5, 6].map((v) => ({ value: v, label: `${v} wk` }))} />, effect(g, { rotationWeeks: 5 }, { rotationWeeks: 4 }, 'At 4 weeks', () => null))}
      <div className="set-row sc-policy sc-policy-sum">
        <div><b>Crew morale target {market.targetNow}</b><div className="tiny dim">{market.target !== market.targetNow ? `${market.target} at market policies · ` : ''}Crew drift toward it; hotels, days off away and long tours move them day to day</div></div>
        <span className="num muted small nowrap">{Object.keys(g.crew).length ? `now ${moraleSummary(g).avg}` : ''}</span>
      </div>
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

function LiveryCard({ g }: { g: GameState }) {
  const c = g.company;
  const fleet = Object.values(g.fleet);
  const count = { company: 0, white: 0, custom: 0, client: 0 };
  for (const ac of fleet) count[liveryOf(g, ac).source]++;
  const locked = fleet.filter((ac) => paintStatus(g, ac.id).locked).length;
  const others = fleet.length - count.company - locked;
  const typeId = artFor(fleet[0]?.typeId ?? 'a320ceo', fleet[0]?.variant);
  const parts = [
    `${count.company} in company colours`,
    count.white ? `${count.white} all white` : '',
    count.custom ? `${count.custom} custom` : '',
    count.client ? `${count.client} in client colours` : '',
  ].filter(Boolean);
  const applyAll = () => store.openModal({
    kind: 'confirm', title: 'Company livery on every aircraft?', confirm: 'Use on all aircraft',
    body: `${others} aircraft with their own livery go back to the company colours.${locked ? ` ${locked} in client colours keep them.` : ''} Free and instant.`,
    onConfirm: () => store.act((gg) => setFleetLivery(gg, 'company')),
  });
  return (
    <Card title="Livery" icon={<Palette className="ico" />} actions={<TailBadge primary={c.livery.primary} secondary={c.livery.secondary} code={c.code} livery={c.livery} size={34} />}>
      <div className="sc-livery-art"><AircraftArt typeId={typeId} livery={c.livery} code={c.code} name={c.name} /></div>
      <div className="small muted">{fleet.length ? parts.join(' · ') : 'No aircraft yet.'}</div>
      <div className="row gap-8 mt-12 wrap">
        <button className="btn btn-primary grow" onClick={() => store.openModal({ kind: 'livery', target: 'company' })}><Palette /> Edit livery</button>
        <button className="btn grow" onClick={applyAll} disabled={others <= 0}>Use on all aircraft</button>
      </div>
    </Card>
  );
}

export function CompanyScreen() {
  useRenderCount('company');
  const g = useGame();
  const c = g.company;
  const fleet = Object.values(g.fleet).length;
  // v0.8: Overview · Clients · Rivals (older deep links such as 'ladder' land on the overview).
  const nv = store.nav.view;
  const view: View = nv === 'clients' || nv === 'rivals' || nv === 'team' || nv === 'achievements' ? nv : 'overview';
  const heads = headsView(g);
  const waiting = heads.filter((h) => h.unlocked && !h.person).length + heads.reduce((n, h) => n + h.proposals.length, 0);
  const got = achievementsView(g).filter((a) => a.at !== null).length;
  // Same rule as the Clients list's first filter (a job done, a contract or an open offer); moves at most daily.
  const day = Math.floor(g.now / 1440);
  const nClients = useMemo(() => clientList(g, 'working').length, [g, day, store.editCount]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`screen sc-company v8-company ${view}`}>
      <ScreenHead title={c.name} sub={`${c.icao} · callsign ${c.callsign} · home base ${c.homeBase}${c.ceo && c.ceo !== 'You' ? ` · CEO ${c.ceo}` : ''}`}>
        <Tabs<View> value={view} onChange={(v) => store.navigate('company', { view: v })} tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'team', label: 'Team', count: waiting || undefined },
          { id: 'clients', label: 'Clients', count: nClients || undefined },
          { id: 'rivals', label: 'Rivals', count: g.rivals.filter((r) => (r.status ?? 'active') === 'active').length || undefined },
          { id: 'achievements', label: 'Achievements', count: got || undefined },
        ]} />
      </ScreenHead>
      {(view === 'team' || view === 'overview') && <ScreenHint id={view === 'team' ? 'team' : 'company'} />}
      {view === 'team' && <TeamView g={g} />}
      {view === 'achievements' && <AchievementsView g={g} />}
      {view === 'clients' && <ClientsView g={g} />}
      {view === 'rivals' && <RivalsView g={g} />}
      {view === 'overview' && <Overview g={g} fleet={fleet} />}
    </div>
  );
}

function Overview({ g, fleet }: { g: GameState; fleet: number }) {
  const c = g.company;
  return (
    <>
      <LadderCard g={g} />
      <div className="sc-company-cols">
        <div className="col gap-16">
          <LiveryCard g={g} />
          <Card title="Reputation" icon={<ShieldCheck className="ico" />}><Reputation g={g} /></Card>
          <StandingCard g={g} />
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
          <Card title="Other approvals" icon={<BadgeCheck className="ico" />} bodyClass="flush"><Approvals g={g} /></Card>
          {g.rivals.length > 0 && (
            <button className="card v8-rivals-link" onClick={() => store.navigate('company', { view: 'rivals' })}>
              <span className="grow">{rivalSummary(g)}</span><ChevronRight className="sc-ico-s dim" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
