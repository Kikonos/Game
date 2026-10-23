// Contracts (B5): Market (offer cards, urgent first), Active (MGH progress, next flight, crew problems,
// cancel with penalty) and Missed. DESIGN.md §6.3.

import { AlertTriangle, CalendarRange, ChevronDown, ChevronRight, CircleSlash, FileSearch, Handshake, Inbox as InboxIcon, Medal, Palette, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { flag } from '../../data/countries';
import { cancelContract, cancelCost, contractProgress, counterView, idleWindows, type IdleWindow, leadDays, offerClientLine, offerCompetition, standing } from '../../engine/contracts';
import { marketOutlook } from '../../engine/ops';
import { OutlookTiles } from '../modals/V08Modals';
import { v08Chips } from './v08Logic';
import { flightsRev } from '../../engine/core/entities';
import { DAY, fmtDateTime, fmtDay } from '../../engine/core/time';
import type { Contract, ContractOffer, CrewExtra, GameState } from '../../engine/core/types';
import { BAL } from '../../engine/core/balance';
import { crewExtraFor, setCrewExtra, shortFlights } from '../../engine/crew';
import { problemAt } from '../../engine/problems';
import { ProblemCardView } from '../components/ProblemCard';
import { Why } from '../components/Why';
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
  // v0.7.4 the client's cabin request (a quick reconfiguration at their expense).
  const cabin = o.cabin ? [{ label: `Their cabin: ${o.cabin.layout === 'two-class' ? 'two-class' : 'all economy'}${o.cabin.required ? ' · required' : ''}`, tone: o.cabin.required ? ('warn' as const) : undefined, tip: `A 48 h reconfiguration before the start; they pay ${o.cabin.clientShare >= 1 ? 'all of it' : 'half'}${o.cabin.revert ? ', and for putting it back' : ''}` }] : [];
  const chips = [...paint, ...cabin, ...reqChips(o.requirements, o.pattern), ...riskChips(o.risk)];
  // v0.7.1 §13: a WHY? dot when the offer can't be flown as it stands or a counter is about to expire.
  const prob = problemAt(g, { kind: 'offer', id: o.id });
  return (
    <button className={`card sc-offer ${o.urgency}`} onClick={() => store.openModal({ kind: 'offer', offerId: o.id })}>
      <div className="row between sc-offer-top">
        <span className="row gap-8 upper dim ellipsis"><ArchIcon a={o.archetype} />{archLabel(o)}</span>
        <span className="row gap-8 nowrap">
          {prob && <Why refs={{ kind: 'offer', id: o.id }} tone={prob.severity === 'red' ? 'bad' : 'warn'} label={`${prob.what}: why?`} />}
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
        <b>{productLine(o.product, o)}</b>
        <span className="muted small">est. <b className="num">{money(o.estValue)}</b></span>
      </div>
      <Chips chips={v08Chips(o, offerClientLine(g, o.id), offerCompetition(g, o.id).level)} />
      <Chips chips={chips.slice(0, 4)} />
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
  const [open, setOpen] = useState(false);
  const eff = crewExtraFor(g, c.aircraftIds[0] ?? null, c.id);
  const min = Math.max(c.requirements.extraCabin, eff.paidMin);
  const set = (x: CrewExtra | null) => store.act((gg) => setCrewExtra(gg, { contractId: c.id }, x), { toastOk: false });
  const src = eff.paidMin ? `client pays for ${eff.paidMin}` : eff.source === 'client' ? 'client request' : eff.source === 'contract' ? 'set for this contract' : eff.source === 'aircraft' ? 'aircraft setting' : 'company default';
  const what = eff.cabin || eff.pilot ? [eff.cabin ? `+${eff.cabin} cabin` : '', eff.pilot ? 'spare pilot' : ''].filter(Boolean).join(' · ') : 'legal minimum';
  if (!open) {
    return (
      <button className="sc-extra-sum small" onClick={() => setOpen(true)} aria-expanded={false}>
        <Users className="sc-ico-s" /><span>Crew: <b>{what}</b></span><span className="dim">{src}</span><ChevronDown className="sc-ico-s dim" />
      </button>
    );
  }
  return (
    <div className="row gap-12 wrap sc-contract-extra">
      <span className="row gap-8"><span className="small">Extra cabin</span><Stepper value={eff.cabin} min={min} max={BAL.crewExtra.cabinMax} onChange={(v) => set({ cabin: v, pilot: eff.pilot })} format={(v) => `+${v}`} /></span>
      <span className="row gap-8"><span className="small">Spare pilot</span><Toggle on={!!eff.pilot} onChange={(v) => set({ cabin: eff.cabin, pilot: v ? 1 : 0 })} label="Spare pilot" /></span>
      <span className="tiny dim">{src}</span>
      {c.crewExtra && !eff.paidMin && <button className="btn btn-sm btn-ghost" onClick={() => set(null)}>Reset</button>}
      <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>Done</button>
    </div>
  );
}

function ContractRow({ g, c, sel }: { g: GameState; c: Contract; sel: boolean }) {
  const p = contractProgress(g, c.id);
  const cl = g.clients[c.clientId];
  const regs = c.aircraftIds.map((id) => g.fleet[id]?.reg ?? '?').join(' + ');
  const next = p.nextFlightId ? g.flights[p.nextFlightId] : undefined;
  // v0.7.1 §4: the crew problem told as the four-line card (the same one as the sheet, the duty modal and the Inbox);
  // the warning ladder's short flights of this contract count too.
  const shortId = p.problemFlightId ?? shortFlights(g).find((x) => g.flights[x.flightId]?.contractId === c.id)?.flightId;
  const prob = shortId ? g.flights[shortId] : undefined;
  const card = prob ? problemAt(g, { kind: 'flight', id: prob.id }) : null;
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
        <div className="small muted ellipsis">{cl?.name ?? 'Client'} · <span className="mono">{regs}</span> · {fmtDay(c.start)} – {fmtDay(c.end)} · {productLine(c.product, c)}</div>
        {c.paint?.accepted && open && <div className="small muted ellipsis row gap-4"><Palette className="sc-ico-s" />{paintLine(g, c)}</div>}
        {c.cabin?.accepted && open && <div className="small muted ellipsis">Their cabin: {c.cabin.layout === 'two-class' ? 'two-class' : 'all economy'} · {c.cabin.clientShare >= 1 ? 'they pay' : 'they pay half'}{c.cabin.revert ? ' · put back after' : ''}</div>}
        {open && (
          <div className="row gap-16 small sc-contract-facts">
            <span>{p.legsDone}/{p.legsTotal} legs</span>
            <span>Revenue {money(p.revenueToDate)}</span>
            {next && <span className="muted ellipsis">Next <span className="mono">{next.no} {next.from}→{next.to}</span> {fmtDateTime(next.std)}</span>}
          </div>
        )}
        {open && c.product.kind !== 'dry' && <ContractExtra g={g} c={c} />}
        {prob && (card ? (
          <ProblemCardView card={card} g={g} hideActions>
            <button className="btn btn-primary btn-sm" onClick={() => store.openModal({ kind: 'crewControl', flightId: prob.id })}><Users /> Crew Control</button>
            <button className="btn btn-sm" onClick={() => store.openModal({ kind: 'duty', id: prob.id })}>Adjust crew</button>
          </ProblemCardView>
        ) : (
          <button className="sc-prob small bad row gap-4" onClick={() => store.openModal({ kind: 'duty', id: prob.id })}><AlertTriangle className="sc-ico-s" />Crew problem on <span className="mono">{prob.no} {prob.from}→{prob.to}</span> {fmtDateTime(prob.std)}<span className="sc-prob-go"><Users className="sc-ico-s" /> Fix crew</span></button>
        ))}
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
            <div className="small muted ellipsis">{[g.clients[o.clientId]?.name, routeSummary(o.pattern), offerDays(o).map(fmtDay).join(' – ')].filter(Boolean).join(' · ')}</div>
            {o.lostWhy && <div className="small warn ellipsis">{o.lostTo ?? 'A rival'} {o.lostWhy}</div>}
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

/** v0.8 the standing strip (tap: Company › Overview) and the market outlook tiles (tap: the outlook dialog). */
function HeadStrip({ g }: { g: GameState }) {
  const day = Math.floor(g.now / DAY);
  // Standing and the outlook move at most daily / monthly.
  const [st, o] = useMemo(() => [standing(g), marketOutlook(g)], [g, day, g.company.standing]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="v8-head-strip">
      <button className={`v8-standing t${st.tier}`} onClick={() => store.navigate('company', { view: 'overview' })} aria-label={`Standing: ${st.name}`}>
        <Medal className="sc-ico-s" />
        <span className="col" style={{ minWidth: 0 }}>
          <b className="ellipsis">{st.name} · <span className="muted v8-st-text">{st.text.toLowerCase()}</span></b>
          {st.next && <span className="small dim ellipsis">{st.next}</span>}
        </span>
        <ChevronRight className="sc-ico-s dim" />
      </button>
      <button className="v8-outlook-btn" onClick={() => store.openModal({ kind: 'outlook' })} aria-label="Market outlook">
        <OutlookTiles o={o} now={g.now} />
      </button>
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
      <HeadStrip g={g} />
      {view === 'market' && <Market g={g} />}
      {view === 'active' && <Active g={g} sel={nav.sel?.kind === 'contract' ? nav.sel.id : null} />}
      {view === 'missed' && <Missed g={g} />}
    </div>
  );
}
