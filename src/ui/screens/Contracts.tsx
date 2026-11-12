// Contracts (B5): Market (offer cards, urgent first), Active (MGH progress, next flight, crew problems,
// cancel with penalty) and Missed. DESIGN.md §6.3.

import { AlertTriangle, CalendarRange, ChevronDown, ChevronRight, CircleSlash, Clock, Crown, FileSearch, Handshake, Inbox as InboxIcon, Medal, Palette, PhoneIncoming, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { flag } from '../../data/countries';
import { cancelContract, cancelCost, contractProgress, counterView, idleWindows, type IdleWindow, leadDays, offerClientLine, offerCompetition, standing } from '../../engine/contracts';
import { dryLeaseView, marketOutlook } from '../../engine/ops';
import { OutlookTiles } from '../modals/V08Modals';
import { v08Chips } from './v08Logic';
import { flightsRev } from '../../engine/core/entities';
import { DAY, fmtDateTime, fmtDay } from '../../engine/core/time';
import type { Contract, ContractOffer, CrewExtra, GameState } from '../../engine/core/types';
import { crewExtraFor, extraCabinMax, setCrewExtra, shortFlights } from '../../engine/crew';
import { problemAt } from '../../engine/problems';
import { ProblemCardView } from '../components/ProblemCard';
import { Why } from '../components/Why';
import { Bar, Empty, Seg, Stepper, Tabs, Toggle } from '../components/ui';
import { money } from '../format';
import { store, useClock, useGame } from '../store';
import { ArchIcon, Chips, ScreenHead, useRenderCount } from './common';
import { contractColor } from './palette';
import { archLabel, COUNTDOWN_MIN, expiryLabel, fuelLine, offerModal, liveHook, marketOffers, missedOffers, productLine, reqChips, riskChips, routeSummary, offerDays, v09Chips } from './screenLogic';
import { LeadsView, leadsUrgent, salesTabCount } from './contracts/SalesView';
import { FilterView, HiddenOffersRow, OfferQuickChips } from './contracts/FilterView';
import { hiddenOffers } from '../../engine/contracts/filter';
import { clientStars, PRESTIGE_NAME, playerLevel, playerStars, starsLabel } from '../../engine/contracts/prestige';
import { ClientStars } from '../components/ClientStars';
import { OriginTag, ShapeTags } from '../components/ShapeTags';
import { contractOrigin, offerOrigin } from '../../engine/commercial';
import { shapeOf } from '../../engine/contracts/shape';
import { analystView } from '../../engine/ops';
import { ScreenHint } from '../components/ScreenHint';
import { clientList } from '../../engine/contracts';
import { ClientsView } from './Clients';
import { openTenders, TendersView } from './Tenders';
import { MarketsView } from './Markets';
import { cancelWarning, lockOf, rulesOf } from '../../engine/scenario';
import { LockedPanel, LockNote, lockedProps } from '../components/Locked';
import { isRouteContract, routeName, seasonWord } from './network/networkLogic';

type View = 'market' | 'active' | 'tenders' | 'missed' | 'clients' | 'markets' | /** v0.16.3 the Market hub's Leads segment (was the Sales tab) */ 'leads' | 'filter';
/** v0.16.3 the Market hub's segments; 'sales' (old links) opens Leads. */
type Hub = 'market' | 'leads' | 'tenders';
const HUB: Record<string, Hub> = { market: 'market', leads: 'leads', sales: 'leads', tenders: 'tenders' };

/** v0.14 the card's time left: hours and minutes ticking with the clock in the last 6 h, a phone call marked. */
function OfferLeft({ o, now }: { o: ContractOffer; now: number }) {
  const left = o.expires - now;
  return left < COUNTDOWN_MIN ? <OfferCountdown o={o} /> : <span className={`small num ${left < 12 * 60 ? 'warn' : 'muted'}`}>{expiryLabel(now, o.expires)}</span>;
}
function OfferCountdown({ o }: { o: ContractOffer }) {
  const now = Math.floor(useClock());
  const left = o.expires - now;
  return (
    <span className={`small num row gap-4 nowrap v14-left ${left <= 60 ? 'bad' : 'warn'}`}>
      {o.call ? <PhoneIncoming className="sc-ico-s" /> : <Clock className="sc-ico-s" />}{expiryLabel(now, o.expires)}
    </span>
  );
}

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
  // v0.9 the analyst's score (when hired and on): once per offer and game hour.
  const av = useMemo(() => analystView(g, o.id), [g, o.id, o.status, Math.floor(g.now / 60)]); // eslint-disable-line react-hooks/exhaustive-deps
  const chips = [...v09Chips(o, av), ...paint, ...cabin, ...reqChips(o.requirements, o.pattern, { shape: true }), ...riskChips(o.risk)];
  // v0.16.3 the restructuring label the client prices in.
  if (o.distressPct) chips.unshift({ label: `Restructuring ${Math.round(o.distressPct * 100)} %`, tone: 'warn', tip: 'The client knows the company is in a court-protected restructuring and prices the risk' });
  // v0.7.1 §13: a WHY? dot when the offer can't be flown as it stands or a counter is about to expire.
  const prob = problemAt(g, { kind: 'offer', id: o.id });
  return (
    <button className={`card sc-offer ${o.urgency}`} onClick={() => store.openModal(offerModal(g, o.id))}>
      <div className="row between sc-offer-top">
        <span className="row gap-8 upper dim ellipsis"><ArchIcon a={o.archetype} />{archLabel(o)}</span>
        <span className="row gap-8 nowrap">
          {prob && <Why refs={{ kind: 'offer', id: o.id }} tone={prob.severity === 'red' ? 'bad' : 'warn'} label={`${prob.what}: why?`} />}
          {/* v0.16 a stretch offer: a client one level above ours. */}
          {o.stretch && <span className="badge pr-stretch" data-tip="A client with more stars than yours: a taste of what's to come">Stretch offer</span>}
          {/* v0.19.4 out of reach for the fleet today (a double-decker load). */}
          {o.reach && <span className="badge pr-stretch" data-tip="No aircraft of ours can fly it yet: a taste of progression">Stretch: out of reach</span>}
          {o.urgency !== 'normal' && <span className={`badge ${o.urgency === 'urgent' ? 'bad' : 'warn'}`}>{o.urgency === 'urgent' ? 'Urgent' : 'Short notice'}</span>}
          {pending ? (
            <span className="small accent nowrap" data-tip="The offer cannot lapse while the client considers your counter">Clock paused</span>
          ) : (
            <OfferLeft o={o} now={g.now} />
          )}
        </span>
      </div>
      <div className="sc-offer-title ellipsis">{o.title}</div>
      <div className="small muted row gap-8">
        <span className="ellipsis">{cl ? `${flag(cl.country)} ${cl.name}` : 'Client'}</span>
        {cl && <ClientStars n={clientStars(cl)} size={11} />}
        {o.broker && <span className="chip sc-chip sc-broker">via {o.broker}</span>}
        {/* v0.20.1 won in a tender or worked from a lead: a small tag (the story is in the offer). */}
        <OriginTag v={offerOrigin(g, o)} />
      </div>
      {/* v0.18 body and haul at a glance, beside the route. */}
      <div className="sc-offer-route-row"><span className="sc-offer-route mono ellipsis">{routeSummary(o.pattern)}</span><ShapeTags s={shapeOf(o)} compact /></div>
      <div className="small muted">{offerDays(o).map(fmtDay).join(' – ')} · {lead <= 0 ? 'starts now' : `starts in ${lead} d`}</div>
      <div className="row between sc-offer-money">
        <b>{productLine(o.product, o)}</b>
        <span className="muted small">est. <b className="num">{money(o.estValue)}</b></span>
      </div>
      {/* v0.16 (G) who pays the fuel, on every card. */}
      <div className="small muted">{fuelLine(o.product)}</div>
      <Chips chips={v08Chips(o, offerClientLine(g, o.id), offerCompetition(g, o.id).level)} />
      <Chips chips={chips.slice(0, 4)} />
      {cv && <div className={`small sc-counter-line ${cv.tone === 'info' ? 'accent' : cv.tone}`}>{cv.text}</div>}
      {hook && !cv && <div className="small dim ellipsis">{hook}</div>}
    </button>
  );
}

/**
 * v0.16.3 the Market hub's segmented control: Offers · Leads · Tenders with their counts (Leads amber when one goes
 * cold within three days), so bidding on a lead sits next to the offers (the player: "the sales tab should be a sub tab
 * under market for easier access to bid for leads").
 */
function MarketSeg({ g, hub, counts }: { g: GameState; hub: Hub; counts: Record<Hub, number> }) {
  const hot = leadsUrgent(g);
  const label = (name: string, n: number, warn = 0) => <>{name}{n > 0 && <span className={`mh-count ${warn ? 'hot' : ''}`}>{n}</span>}</>;
  return (
    <div className="mh-seg" data-hub={hub}>
      <Seg<Hub> value={hub} options={[
        { value: 'market', label: label('Offers', counts.market) },
        { value: 'leads', label: label('Leads', counts.leads, hot) },
        { value: 'tenders', label: label('Tenders', counts.tenders) },
      ]} onChange={(v) => store.navigate('contracts', { view: v })} />
      {hub === 'leads' && hot > 0 && <span className="small mh-urgent">{hot} lead{hot === 1 ? '' : 's'} go{hot === 1 ? 'es' : ''} cold within 3 days</span>}
    </div>
  );
}

function Market({ g }: { g: GameState }) {
  const list = marketOffers(g);
  const rev = flightsRev(g);
  const day = Math.floor(g.now / DAY);
  // Follow-on hints are checked against today's idle windows (they go stale once the aircraft moves).
  const windows = useMemo(() => (list.some((o) => o.hook) ? idleWindows(g) : []), [g, rev, day, list.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // v0.15 a scenario's market: closed (a calm notice), or only its kind of work (a line above the offers).
  const r = rulesOf(g);
  const lock = r && r.market !== 'on' ? lockOf(g, 'market') ?? lockOf(g, 'market', { archetype: 'dryLeaseOut' }) : null;
  if (r?.market === 'off') return <LockedPanel title="No new work in this scenario" why={lock ?? ''}>Your signed work is under Active.</LockedPanel>;
  const note = r?.market === 'themed' ? <LockNote className="mb-8" why={`This scenario’s market: ${r.say?.market ?? r.why}.`} /> : null;
  // v0.18 quick chips (body, haul) whenever there is anything on the market or they are set.
  const quick = list.length || hiddenOffers(g).length || g.filter?.bodies?.length || g.filter?.hauls?.length ? <OfferQuickChips g={g} /> : null;
  if (!list.length) {
    return (
      <>
        {note}
        {quick}
        {hiddenOffers(g).length ? (
          <Empty icon={<InboxIcon />} title="No offers fit your filter">Tap All above, or open the hidden ones below.</Empty>
        ) : (
          <Empty icon={<InboxIcon />} title="No offers right now" />
        )}
        <HiddenOffersRow g={g} />
      </>
    );
  }
  // v0.16 "N offers hidden by your filter" (ui/screens/contracts/FilterView.tsx).
  return <>{note}{quick}<div className="sc-offer-grid">{list.map((o) => <OfferCard key={o.id} g={g} o={o} windows={windows} />)}</div><HiddenOffersRow g={g} /></>;
}

const STATUS_LABEL: Record<Contract['status'], string> = { signed: 'Signed', active: 'Flying', completed: 'Completed', cancelled: 'Cancelled' };

function confirmCancel(g: GameState, c: Contract) {
  const { penalty: pen, refund, total } = cancelCost(g, c.id);
  // v0.15 a scenario's own contract under a 'penalty' rule: cancelling it ends the scenario with no stars.
  const warn = cancelWarning(g, c.id);
  const cl = g.clients[c.clientId]?.name ?? 'The client';
  store.openModal({
    kind: 'confirm', danger: true, title: `Cancel ${c.title}?`, confirm: warn ? `Cancel, pay ${money(total)} and end the scenario` : `Cancel and pay ${money(total)}`,
    body: `${warn ? `${warn} ` : ''}Penalty ${money(pen)}${refund > 0 ? ` plus ${money(refund)} refunded for legs not flown` : ''}. All future flights are removed, reliability drops by 5 and ${cl} will remember it.`,
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
      <span className="row gap-8"><span className="small">Extra cabin</span><Stepper value={eff.cabin} min={min} max={Math.max(min, extraCabinMax(g, c.aircraftIds[0] ?? null, c.requirements.extraCabin))} onChange={(v) => set({ cabin: v, pilot: eff.pilot })} format={(v) => `+${v}`} /></span>
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
  // v0.14.1 (UI-5) a dry lease by its lease (the map panel's dates and invoiced total), not legs and accrual.
  const dry = c.product.kind === 'dry' ? dryLeaseView(g, c.id) : null;
  const mghR = p.mgh > 0 ? p.bhMonth / p.mgh : 0;
  // v0.15 the scenario's locks on this contract (cancel, hand-overs): the buttons stay, disabled, with the reason.
  const lockCancel = open ? lockOf(g, 'cancel', { contractId: c.id }) : null;
  const lockSub = open ? lockOf(g, 'subcharter') : null;
  return (
    <div className={`card sc-contract ${sel ? 'selected' : ''} ${open ? '' : 'closed'}`} style={{ ['--kc' as string]: contractColor(c.color) }}>
      <div className="sc-contract-main">
        <div className="row gap-8 sc-contract-head">
          <ArchIcon a={c.archetype} />
          <b className="ellipsis">{c.title}</b>
          <span className={`badge ${c.status === 'active' ? 'good' : c.status === 'cancelled' ? 'bad' : ''}`}>{STATUS_LABEL[c.status]}</span>
          <ShapeTags s={shapeOf(c, (id) => g.fleet[id]?.typeId)} compact className="sc-contract-shape" />
          <OriginTag v={contractOrigin(g, c)} help />
        </div>
        {/* v0.14.1 (merge) a dry lease by its lease dates (fx-money UI-5); other work by the client's local days (fx-comm). */}
        <div className="small muted ellipsis">{cl?.name ?? 'Client'} · <span className="mono">{regs}</span> · {dry ? `${fmtDay(dry.lease[0])} – ${fmtDay(dry.lease[1])}` : offerDays(c).map(fmtDay).join(' – ')} · {productLine(c.product, c)}</div>
        {c.paint?.accepted && open && <div className="small muted ellipsis row gap-4"><Palette className="sc-ico-s" />{paintLine(g, c)}</div>}
        {c.cabin?.accepted && open && <div className="small muted ellipsis">Their cabin: {c.cabin.layout === 'two-class' ? 'two-class' : 'all economy'} · {c.cabin.clientShare >= 1 ? 'they pay' : 'they pay half'}{c.cabin.revert ? ' · put back after' : ''}</div>}
        {open && (
          <div className="row gap-16 small sc-contract-facts">
            {dry ? <span>{dry.fhSoFar.toLocaleString('en-US')} FH flown by them</span> : <span>{p.legsDone}/{p.legsTotal} legs</span>}
            <span>{dry ? 'Invoiced' : 'Revenue'} {money(dry ? dry.income : p.revenueToDate)}</span>
            {next && <span className="muted ellipsis">Next <span className="mono">{next.no} {next.from}→{next.to}</span> {fmtDateTime(next.std)}</span>}
          </div>
        )}
        {open && c.product.kind !== 'dry' && <ContractExtra g={g} c={c} />}
        {(lockCancel || lockSub) && <LockNote why={lockCancel ?? lockSub} />}
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
          <button className={`btn ${lockSub ? 'locked' : ''}`} onClick={() => store.openModal({ kind: 'subcharter', contractId: c.id })} aria-label="Sub-charter legs to a rival" data-tip="Hand legs to a rival operator" {...lockedProps(lockSub)}><Handshake /></button>
          <button className={`btn btn-danger ${lockCancel ? 'locked' : ''}`} onClick={() => confirmCancel(g, c)} aria-label="Cancel contract" {...lockedProps(lockCancel)}><CircleSlash /></button>
        </div>
      )}
    </div>
  );
}

/** v0.19 one compact line per open route contract ('Scheduled · LIS–OXB · summer 2027'); tap: the route page. */
function RouteContractLines({ g }: { g: GameState }) {
  const list = Object.values(g.contracts).filter((c) => isRouteContract(c) && (c.status === 'signed' || c.status === 'active') && c.sched && g.network?.routes[c.sched.routeId]);
  if (!list.length) return null;
  return (
    <div className="card sc-list sc-route-lines">
      {list.sort((a, b) => a.start - b.start).map((c) => {
        const r = g.network!.routes[c.sched!.routeId];
        return (
          <button key={c.id} className="sc-list-row sc-route-line" onClick={() => store.openModal({ kind: 'route', routeId: r.id })}>
            <ArchIcon a={c.archetype} />
            <span className="grow ellipsis small"><span className="upper dim">Scheduled</span> · <b>{routeName(r)}</b> · {seasonWord(c.sched!.season)}</span>
            <ChevronRight className="sc-ico-s dim" />
          </button>
        );
      })}
    </div>
  );
}

function Active({ g, sel }: { g: GameState; sel: string | null }) {
  const rev = flightsRev(g);
  const hour = Math.floor(g.now / 60);
  const ids = Object.keys(g.contracts).join();
  const [open, closed] = useMemo(() => {
    // v0.19 route contracts (our scheduled flying) are one compact line each, below the ACMI work.
    const all = Object.values(g.contracts).filter((c) => !isRouteContract(c));
    const o = all.filter((c) => c.status === 'signed' || c.status === 'active').sort((a, b) => a.start - b.start);
    const cl = all.filter((c) => (c.status === 'completed' || c.status === 'cancelled') && c.end > g.now - 60 * DAY).sort((a, b) => b.end - a.end).slice(0, 8);
    return [o, cl];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, rev, hour, ids]);
  const routeLines = <RouteContractLines g={g} />;
  if (!open.length && !closed.length) {
    return (
      <>
        <Empty icon={<FileSearch />} title="No contracts yet">Accept an offer from the Market tab.</Empty>
        {routeLines}
      </>
    );
  }
  return (
    <div className="col gap-12">
      {open.map((c) => <ContractRow key={c.id} g={g} c={c} sel={sel === c.id} />)}
      {routeLines}
      {closed.length > 0 && <div className="upper dim mt-8">Recently finished</div>}
      {closed.map((c) => <ContractRow key={c.id} g={g} c={c} sel={sel === c.id} />)}
    </div>
  );
}

const MISSED_LABEL: Partial<Record<ContractOffer['status'], string>> = { lost: 'Lost', expired: 'Expired', declined: 'Declined' };

function Missed({ g }: { g: GameState }) {
  const list = missedOffers(g);
  if (!list.length) return <Empty icon={<InboxIcon />} title="Nothing missed">Kept here for two weeks.</Empty>;
  return (
    <div className="card sc-list">
      {list.map((o) => (
        <div key={o.id} className="sc-list-row">
          <ArchIcon a={o.archetype} />
          <div className="grow">
            <div className="row gap-8"><b className="ellipsis">{o.title}</b><ShapeTags s={shapeOf(o)} compact /></div>
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
  const lv = playerLevel(g);
  return (
    <div className="v8-head-strip">
      <button className={`v8-standing t${st.tier}`} onClick={() => store.navigate('company', { view: 'overview' })} aria-label={`Standing: ${st.name}`}>
        <Medal className="sc-ico-s" />
        <span className="col" style={{ minWidth: 0 }}>
          <b className="ellipsis">{st.name}<span className="muted v8-st-text"> · {st.text.toLowerCase()}</span></b>
          {st.next && <span className="small dim ellipsis">{st.next}</span>}
        </span>
        <ChevronRight className="sc-ico-s dim" />
      </button>
      {/* v0.16 our level on the client ladder (offers come at this level; tap: the Prestige card). */}
      {/* v0.16.1 shown as stars (the engine's level behind them). */}
      <button className="pr-level" onClick={() => store.navigate('company', { view: 'overview' })} aria-label={`Your rating: ${starsLabel(playerStars(g))}, ${PRESTIGE_NAME[lv]}`} data-tip="Offers come at your stars, with one stretch offer a month from a client with more">
        <Crown className="sc-ico-s" /><ClientStars n={playerStars(g)} size={13} label="" /><span className="small muted">{PRESTIGE_NAME[lv]}</span>
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
  const raw = nav.view === 'sales' ? 'leads' : nav.view;
  const view = (['market', 'active', 'tenders', 'missed', 'clients', 'markets', 'leads', 'filter'].includes(raw ?? '') ? raw : 'market') as View;
  const hub: Hub | null = HUB[view] ?? null;
  const nMarket = marketOffers(g).length;
  const nLeads = salesTabCount(g);
  const nTenders = openTenders(g);
  const nActive = Object.values(g.contracts).filter((c) => (c.status === 'signed' || c.status === 'active') && !isRouteContract(c)).length;
  const nMissed = missedOffers(g).length;
  // v0.11 Clients moved here from Company. Same rule as the Clients list's first filter (a job done, a contract or an open offer); moves at most daily.
  const day = Math.floor(g.now / 1440);
  const nClients = useMemo(() => clientList(g, 'working').length, [g, day, store.editCount]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="screen sc-contracts">
      <ScreenHead hint="contracts" title="Contracts">
        <Tabs<View> value={hub ? 'market' : view} onChange={(v) => store.navigate('contracts', { view: v })} tabs={[
          // v0.16.3 one Market tab: offers, the leads pipeline and the tender board as segments (Sales and Tenders were tabs).
          { id: 'market', label: 'Market', count: nMarket + nLeads + nTenders || undefined },
          { id: 'active', label: 'Active', count: nActive },
          // v0.23.1 the Network moved to its own screen (the rail, under Contracts).
          { id: 'missed', label: 'Missed', count: nMissed },
          { id: 'clients', label: 'Clients', count: nClients || undefined },
          // v0.14 market presence, the trade fairs and sales trips (moved here from Company › Team).
          { id: 'markets', label: 'Markets' },
          // v0.16 the offer filter.
          { id: 'filter', label: 'Filter' },
        ]} />
      </ScreenHead>
      <ScreenHint id="contracts" />
      <HeadStrip g={g} />
      {hub && <MarketSeg g={g} hub={hub} counts={{ market: nMarket, leads: nLeads, tenders: nTenders }} />}
      {view === 'market' && <Market g={g} />}
      {view === 'leads' && <LeadsView g={g} />}
      {view === 'tenders' && <TendersView g={g} />}
      {view === 'active' && <Active g={g} sel={nav.sel?.kind === 'contract' ? nav.sel.id : null} />}
      {view === 'missed' && <Missed g={g} />}
      {view === 'clients' && <ClientsView g={g} />}
      {view === 'markets' && <MarketsView g={g} />}
      {view === 'filter' && <FilterView g={g} />}
    </div>
  );
}
