// Contracts (B5): Market (offer cards, urgent first), Active (MGH progress, next flight, crew problems,
// cancel with penalty) and Missed. DESIGN.md §6.3.

import { AlertTriangle, CalendarRange, CircleSlash, FileSearch, Handshake, Inbox as InboxIcon, Palette, Users } from 'lucide-react';
import { useMemo } from 'react';
import { flag } from '../../data/countries';
import { cancelContract, cancelCost, contractProgress, counterView, idleWindows, type IdleWindow, leadDays } from '../../engine/contracts';
import { flightsRev } from '../../engine/core/entities';
import { DAY, fmtDateTime, fmtDay } from '../../engine/core/time';
import type { Contract, ContractOffer, CrewExtra, GameState } from '../../engine/core/types';
import { BAL } from '../../engine/core/balance';
import { crewExtraFor, setCrewExtra } from '../../engine/crew';
import { Bar, Empty, Stepper, Tabs, Toggle } from '../components/ui';
import { money } from '../format';
import { store, useGame } from '../store';
import { ArchIcon, Chips, ScreenHead, useRenderCount } from './common';
import { contractColor } from './palette';
import { archLabel, expiryLabel, liveHook, marketOffers, missedOffers, productLine, reqChips, riskChips, routeSummary, offerDays } from './screenLogic';

type View = 'market' | 'active' | 'missed';

function OfferCard({ g, o, windows }: { g: GameState; o: ContractOffer; windows: IdleWindow[] }) {
  const hook = liveHook(g, o, windows);
  const cl = g.clients[o.clientId];
  const lead = leadDays(g, o.start);
  // v0.5.2: the client always answers before the offer lapses; its clock is paused while the counter is pending.
  const cv = counterView(g, o.id);
  const pending = cv?.state === 'pending';
  const paint = o.paint ? [{ label: `Their livery${o.paint.required ? ' · required' : ''}`, tone: o.paint.required ? ('warn' as const) : undefined, tip: o.paint.kind === 'full' ? 'Full repaint in the client colours for the contract' : 'Client titles and logo on a white aircraft' }] : [];
  const chips = [...paint, ...reqChips(o.requirements), ...riskChips(o.risk)];
  return (
    <button className={`card sc-offer ${o.urgency}`} onClick={() => store.openModal({ kind: 'offer', offerId: o.id })}>
      <div className="row between sc-offer-top">
        <span className="row gap-8 upper dim ellipsis"><ArchIcon a={o.archetype} />{archLabel(o)}</span>
        <span className="row gap-8 nowrap">
          {o.urgency !== 'normal' && <span className={`badge ${o.urgency === 'urgent' ? 'bad' : 'warn'}`}>{o.urgency === 'urgent' ? 'Urgent' : 'Short notice'}</span>}
          {pending ? (
            <span className="small accent nowrap" data-tip="The offer cannot lapse while the client considers your counter">Clock paused</span>
          ) : (
            <span className={`small num ${o.expires - g.now < 12 * 60 ? 'warn' : 'muted'}`}>{expiryLabel(g.now, o.expires)}</span>
          )}
        </span>
      </div>
      <div className="sc-offer-title ellipsis">{o.title}</div>
      <div className="small muted row gap-8">
        <span className="ellipsis">{cl ? `${flag(cl.country)} ${cl.name}` : 'Client'}</span>
        {o.broker && <span className="chip sc-chip sc-broker">via {o.broker}</span>}
      </div>
      <div className="sc-offer-route mono ellipsis">{routeSummary(o.pattern)}</div>
      <div className="small muted">{offerDays(o).map(fmtDay).join(' – ')} · {lead <= 0 ? 'starts now' : `starts in ${lead} d`}</div>
      <div className="row between sc-offer-money">
        <b>{productLine(o.product)}</b>
        <span className="muted small">est. <b className="num">{money(o.estValue)}</b></span>
      </div>
      <Chips chips={chips.slice(0, 6)} />
      {cv && <div className={`small sc-counter-line ${cv.tone === 'info' ? 'accent' : cv.tone}`}>{cv.text}</div>}
      {hook && !cv && <div className="small dim ellipsis">{hook}</div>}
    </button>
  );
}

function Market({ g }: { g: GameState }) {
  const list = marketOffers(g);
  const rev = flightsRev(g);
  const day = Math.floor(g.now / DAY);
  // Follow-on hints are checked against today's idle windows (they go stale once the aircraft moves).
  const windows = useMemo(() => (list.some((o) => o.hook) ? idleWindows(g) : []), [g, rev, day, list.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list.length) {
    return (
      <Empty icon={<InboxIcon />} title="No offers right now">
        Brokers and clients send work every few days. Idle aircraft attract gap-fit offers.
      </Empty>
    );
  }
  return <div className="sc-offer-grid">{list.map((o) => <OfferCard key={o.id} g={g} o={o} windows={windows} />)}</div>;
}

const STATUS_LABEL: Record<Contract['status'], string> = { signed: 'Signed', active: 'Flying', completed: 'Completed', cancelled: 'Cancelled' };

function confirmCancel(g: GameState, c: Contract) {
  const { penalty: pen, refund, total } = cancelCost(g, c.id);
  const cl = g.clients[c.clientId]?.name ?? 'The client';
  store.openModal({
    kind: 'confirm', danger: true, title: `Cancel ${c.title}?`, confirm: `Cancel and pay ${money(total)}`,
    body: `Penalty ${money(pen)}${refund > 0 ? ` plus ${money(refund)} refunded for legs not flown` : ''}. All future flights are removed, reliability drops by 5 and ${cl} will remember it.`,
    onConfirm: () => store.act((gg) => cancelContract(gg, c.id)),
  });
}

/** 'CS-TLI in Saudia colours' / 'Paint shop 3 May' for a contract with client paint. */
function paintLine(g: GameState, c: Contract): string {
  const client = g.clients[c.clientId]?.name ?? 'client';
  const painted = c.aircraftIds.filter((id) => g.fleet[id]?.paintedFor === c.id).map((id) => g.fleet[id].reg);
  if (painted.length) return `${painted.join(' + ')} in ${client} colours`;
  const m = Object.values(c.paint?.inMx ?? {}).map((id) => g.maintenance[id]).find((x) => x && (x.status === 'planned' || x.status === 'inWork'));
  return m ? `${c.paint!.kind === 'full' ? 'Repaint' : 'Decals'} in ${client} colours: paint shop ${m.at} ${fmtDay(m.start)}` : `${client} livery agreed`;
}

/** v0.6: this contract's extra crew (overrides the aircraft's); locked at the number the client pays for. */
function ContractExtra({ g, c }: { g: GameState; c: Contract }) {
  const eff = crewExtraFor(g, c.aircraftIds[0] ?? null, c.id);
  const min = Math.max(c.requirements.extraCabin, eff.paidMin);
  const set = (x: CrewExtra | null) => store.act((gg) => setCrewExtra(gg, { contractId: c.id }, x));
  const src = eff.paidMin ? `client pays for ${eff.paidMin}` : eff.source === 'client' ? 'client request' : eff.source === 'contract' ? 'set for this contract' : eff.source === 'aircraft' ? 'aircraft setting' : 'company default';
  return (
    <div className="row gap-12 wrap sc-contract-extra">
      <span className="row gap-8"><span className="small">Extra cabin</span><Stepper value={eff.cabin} min={min} max={BAL.crewExtra.cabinMax} onChange={(v) => set({ cabin: v, pilot: eff.pilot })} format={(v) => `+${v}`} /></span>
      <span className="row gap-8"><span className="small">Spare pilot</span><Toggle on={!!eff.pilot} onChange={(v) => set({ cabin: eff.cabin, pilot: v ? 1 : 0 })} label="Spare pilot" /></span>
      <span className="tiny dim">{src}</span>
      {c.crewExtra && !eff.paidMin && <button className="btn btn-sm btn-ghost" onClick={() => set(null)}>Reset</button>}
    </div>
  );
}

function ContractRow({ g, c, sel }: { g: GameState; c: Contract; sel: boolean }) {
  const p = contractProgress(g, c.id);
  const cl = g.clients[c.clientId];
  const regs = c.aircraftIds.map((id) => g.fleet[id]?.reg ?? '?').join(' + ');
  const next = p.nextFlightId ? g.flights[p.nextFlightId] : undefined;
  const prob = p.problemFlightId ? g.flights[p.problemFlightId] : undefined;
  const open = c.status === 'signed' || c.status === 'active';
  const mghR = p.mgh > 0 ? p.bhMonth / p.mgh : 0;
  return (
    <div className={`card sc-contract ${sel ? 'selected' : ''} ${open ? '' : 'closed'}`} style={{ ['--kc' as string]: contractColor(c.color) }}>
      <div className="sc-contract-main">
        <div className="row gap-8">
          <ArchIcon a={c.archetype} />
          <b className="ellipsis">{c.title}</b>
          <span className={`badge ${c.status === 'active' ? 'good' : c.status === 'cancelled' ? 'bad' : ''}`}>{STATUS_LABEL[c.status]}</span>
        </div>
        <div className="small muted ellipsis">{cl?.name ?? 'Client'} · <span className="mono">{regs}</span> · {fmtDay(c.start)} – {fmtDay(c.end)} · {productLine(c.product)}</div>
        {c.paint?.accepted && open && <div className="small muted ellipsis row gap-4"><Palette className="sc-ico-s" />{paintLine(g, c)}</div>}
        {open && (
          <div className="row gap-16 small sc-contract-facts">
            <span>{p.legsDone}/{p.legsTotal} legs</span>
            <span>Revenue {money(p.revenueToDate)}</span>
            {next && <span className="muted ellipsis">Next <span className="mono">{next.no} {next.from}→{next.to}</span> {fmtDateTime(next.std)}</span>}
          </div>
        )}
        {open && c.product.kind !== 'dry' && <ContractExtra g={g} c={c} />}
        {prob && (
          <button className="sc-prob small bad row gap-4" onClick={() => store.openModal({ kind: 'duty', id: prob.id })}><AlertTriangle className="sc-ico-s" />Crew problem on <span className="mono">{prob.no} {prob.from}→{prob.to}</span> {fmtDateTime(prob.std)}<span className="sc-prob-go"><Users className="sc-ico-s" /> Fix crew</span></button>
        )}
      </div>
      {open && c.product.kind === 'wet' && (
        <div className="sc-mgh" data-tip="Billable block hours this month against the minimum guarantee (MGH)">
          <div className="row between small"><span className="muted">MGH this month</span><span className="num">{p.bhMonth.toFixed(0)} / {p.mgh.toFixed(0)} BH</span></div>
          <Bar value={mghR} tone={mghR >= 1 ? 'good' : 'warn'} size="thin" />
        </div>
      )}
      {open && (
        <div className="sc-contract-actions">
          <button className="btn" onClick={() => store.navigate('schedule', { sel: { kind: 'aircraft', id: c.aircraftIds[0] }, view: String(Math.max(g.now, next?.std ?? c.start)) })} aria-label="Show on schedule"><CalendarRange /></button>
          <button className="btn" onClick={() => store.openModal({ kind: 'subcharter', contractId: c.id })} aria-label="Sub-charter legs to a rival" data-tip="Hand legs to a rival operator"><Handshake /></button>
          <button className="btn btn-danger" onClick={() => confirmCancel(g, c)} aria-label="Cancel contract"><CircleSlash /></button>
        </div>
      )}
    </div>
  );
}

function Active({ g, sel }: { g: GameState; sel: string | null }) {
  const rev = flightsRev(g);
  const hour = Math.floor(g.now / 60);
  const ids = Object.keys(g.contracts).join();
  const [open, closed] = useMemo(() => {
    const all = Object.values(g.contracts);
    const o = all.filter((c) => c.status === 'signed' || c.status === 'active').sort((a, b) => a.start - b.start);
    const cl = all.filter((c) => (c.status === 'completed' || c.status === 'cancelled') && c.end > g.now - 60 * DAY).sort((a, b) => b.end - a.end).slice(0, 8);
    return [o, cl];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, rev, hour, ids]);
  if (!open.length && !closed.length) {
    return (
      <Empty icon={<FileSearch />} title="No contracts yet">
        Accept an offer from the Market tab. Its flights appear on the Schedule straight away.
      </Empty>
    );
  }
  return (
    <div className="col gap-12">
      {open.map((c) => <ContractRow key={c.id} g={g} c={c} sel={sel === c.id} />)}
      {closed.length > 0 && <div className="upper dim mt-8">Recently finished</div>}
      {closed.map((c) => <ContractRow key={c.id} g={g} c={c} sel={sel === c.id} />)}
    </div>
  );
}

const MISSED_LABEL: Partial<Record<ContractOffer['status'], string>> = { lost: 'Lost', expired: 'Expired', declined: 'Declined' };

function Missed({ g }: { g: GameState }) {
  const list = missedOffers(g);
  if (!list.length) return <Empty icon={<InboxIcon />} title="Nothing missed">Offers that expire, go to a rival or that you decline stay here for two weeks.</Empty>;
  return (
    <div className="card sc-list">
      {list.map((o) => (
        <div key={o.id} className="sc-list-row">
          <ArchIcon a={o.archetype} />
          <div className="grow">
            <div className="ellipsis"><b>{o.title}</b></div>
            <div className="small muted ellipsis">{g.clients[o.clientId]?.name} · {routeSummary(o.pattern)} · {offerDays(o).map(fmtDay).join(' – ')}</div>
          </div>
          <div className="right small nowrap">
            <div className={o.status === 'lost' ? 'warn' : 'muted'}>{MISSED_LABEL[o.status]}{o.lostTo ? ` to ${o.lostTo}` : ''}</div>
            <div className="dim">{o.closedAt ? fmtDay(o.closedAt) : ''} · {money(o.estValue)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ContractsScreen() {
  useRenderCount('contracts');
  const g = useGame();
  const nav = store.nav;
  const view = (['market', 'active', 'missed'].includes(nav.view ?? '') ? nav.view : 'market') as View;
  const nMarket = marketOffers(g).length;
  const nActive = Object.values(g.contracts).filter((c) => c.status === 'signed' || c.status === 'active').length;
  const nMissed = missedOffers(g).length;
  return (
    <div className="screen sc-contracts">
      <ScreenHead title="Contracts" sub="Offers from brokers and clients, and the work you have signed.">
        <Tabs<View> value={view} onChange={(v) => store.navigate('contracts', { view: v })} tabs={[
          { id: 'market', label: 'Market', count: nMarket },
          { id: 'active', label: 'Active', count: nActive },
          { id: 'missed', label: 'Missed', count: nMissed },
        ]} />
      </ScreenHead>
      {view === 'market' && <Market g={g} />}
      {view === 'active' && <Active g={g} sel={nav.sel?.kind === 'contract' ? nav.sel.id : null} />}
      {view === 'missed' && <Missed g={g} />}
    </div>
  );
}
