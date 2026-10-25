// v0.7 Fleet → Market (UPDATE-0.7.md §F6.7): scarce offers in two columns, newest first. Each card shows the
// terms, where the aircraft is handed over, the delivery ferry and the pilots' airline deadheads, and chips for
// the ladder gate, rated crew and how long the offer stays open. Lease… / Buy… opens the AcquireModal.

import { BedDouble, Lock, ShoppingCart, TrendingUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { artFor } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { MARKET_LIVERY } from '../../data/livery';
import { typeOf } from '../../engine/core/perf';
import { DAY, fmtDate, fmtDay, yearOf } from '../../engine/core/time';
import type { GameState } from '../../engine/core/types';
import { hasBunks, restOfAc } from '../../engine/crew';
import { marketView, type MarketOfferView } from '../../engine/ops';
import { AircraftArt } from '../components/AircraftArt';
import { RestTwoLiner } from '../components/RestLines';
import { Flag, Toggle } from '../components/ui';
import { money } from '../format';
import { store, useStore } from '../store';
import { markMarketSeen, offerKind, sellerOf, unseenOffers } from './screenLogic';

/** '12 Jan', or '12 Jan 2028' outside the current year. */
export const dayIn = (now: number, t: number) => (yearOf(t) === yearOf(now) ? fmtDay(t) : fmtDate(t));

/** Type name without the maker: 'A330-200', '767-300ER'. */
export const typeName = (typeId: string) => typeOf(typeId).name.replace(/^(Airbus|Boeing) /, '');

/** 'Handover 12 Jan · home ~14 Jan'. */
export function handoverLine(now: number, v: Pick<MarketOfferView, 'quote'>): string {
  const q = v.quote;
  return `Handover ${dayIn(now, q.handover)}${q.legs.length ? ` · home ~${dayIn(now, q.homeBy)}` : ' at our base'}`;
}

/** 'LA 8070 LIS–GRU · LA 3456 GRU–SCL' (the first airline itinerary of the delivery pilots). */
export const deadheadLine = (v: Pick<MarketOfferView, 'quote'>) => v.quote.deadhead.map((l) => `${l.no} ${l.from}–${l.to}`).join(' · ');

export function termsLine(v: Pick<MarketOfferView, 'offer'>): string {
  const o = v.offer;
  return o.kind === 'dryLeaseIn' ? `${money(o.rentPerMonth)}/month · ${o.leaseMonths} months · deposit ${money(o.deposit)}` : `Price ${money(o.price)}`;
}

export function GateChip({ v }: { v: Pick<MarketOfferView, 'gate'> }) {
  const gt = v.gate;
  if (!gt.ok) return <span className="chip mk-chip bad"><Lock className="sc-ico-s" />{gt.text}</span>;
  if (gt.pending.length) return <span className="chip mk-chip warn" data-tip={gt.text}>{gt.text.replace(/: you can sign.*$/, ': signs now, flies after')}</span>;
  return <span className="chip mk-chip good">{gt.text === 'No approval needed' ? 'No approval needed' : 'Approved'}</span>;
}

function OfferCard({ g, now, v, sel }: { g: GameState; now: number; v: MarketOfferView; sel: boolean }) {
  const o = v.offer;
  const kind = offerKind(o);
  const site = v.quote.site;
  const country = AIRPORT_BY_CODE[site]?.country;
  const lease = o.kind === 'dryLeaseIn';
  const dh = deadheadLine(v);
  return (
    <div className={`card mk-card ${sel ? 'selected' : ''} ${v.gate.ok ? '' : 'locked'}`} data-offer={o.id}>
      <div className="mk-top">
        <div className="mk-art"><AircraftArt typeId={artFor(o.typeId, o.variant)} livery={MARKET_LIVERY} detail="simple" /></div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row gap-8 between">
            <b className="ellipsis">{typeName(o.typeId)} · {o.builtYear} · {o.cabin.label}</b>
            <span className={`badge ${kind.tone}`}>{kind.label}</span>
          </div>
          <div className="small muted mk-where">{sellerOf(o)} · {(o.where ?? site).replace(/^Airbus, |^Boeing, /, '')}{country ? <> <Flag country={country} /></> : null}</div>
        </div>
      </div>
      <div className="mk-terms">
        <b className="num">{termsLine(v)}</b>
        {lease && <span className="small dim"> · reserves ${o.reservesPerFH.toLocaleString('en-US')}/FH</span>}
      </div>
      {/* v0.7.3 §2.6 item 2: pilots' and cabin crew's rest, rolled per airframe, and the longest day they allow. */}
      <RestTwoLiner g={g} rest={offerRest(v)} typeId={o.typeId} />
      <div className="mk-deliv small">
        <div>{handoverLine(now, v)}</div>
        {v.quote.legs.length > 0 && <div className="muted">Ferry {v.quote.text}</div>}
        {dh && <div className="muted ellipsis">Pilots deadhead out: {dh}</div>}
      </div>
      <div className="mk-chips">
        <GateChip v={v} />
        <span className={`chip mk-chip ${v.crew.level === 'ok' ? 'good' : v.crew.level}`}>{v.crew.text}</span>
        {hasBunks(offerRest(v)) && <span className="chip mk-chip good"><BedDouble className="sc-ico-s" />Bunks</span>}
        <span className="chip mk-chip">{v.daysLeft <= 1 ? 'Last day' : `Open ${v.daysLeft} more days`}</span>
      </div>
      <div className="row gap-8 mk-foot">
        {v.returnText && <span className="tiny dim grow mk-ret">{v.returnText}</span>}
        {!v.returnText && <span className="grow" />}
        {v.gate.ok
          ? <button className="btn btn-primary" onClick={() => store.openModal({ kind: 'acquire', offerId: o.id })}><ShoppingCart /> {lease ? 'Lease…' : 'Buy…'}</button>
          : <button className="btn" onClick={() => store.navigate('company', { view: 'ladder' })}><TrendingUp /> See the ladder</button>}
      </div>
    </div>
  );
}

/** v0.7.3 an offer's rest as the crew would use it (v0.7.4: rolled bunks, else the curtained seats of its cabin). */
export const offerRest = (v: Pick<MarketOfferView, 'offer'>) => restOfAc(v.offer);

/** v0.7.2 F2: the market alert toggles live here (moved from Settings). */
function MarketAlerts() {
  const s = useStore();
  const st = s.settings;
  return (
    <div className="card mk-alerts">
      <span className="row gap-8"><b className="small">Market alerts</b><Toggle on={st.marketAlerts} onChange={(v) => store.setSettings({ marketAlerts: v })} label="Market alerts" /></span>
      <span className={`row gap-8 ${st.marketAlerts ? '' : 'set-off'}`}>
        <b className="small">Pause on new offers</b>
        <span className={st.marketAlerts ? '' : 'set-disabled'}><Toggle on={st.marketAlerts && st.autoPause.marketOffer} onChange={(v) => st.marketAlerts && store.setSettings({ autoPause: { ...st.autoPause, marketOffer: v } })} label="Pause on new offers" /></span>
        {!st.marketAlerts && <span className="tiny dim">Needs market alerts on</span>}
      </span>
      <span className="tiny dim grow mk-alerts-note">Alerts: an Inbox message, a quiet notice and a chip in the top bar.</span>
    </div>
  );
}

export function MarketView({ g, sel }: { g: GameState; sel: string | null }) {
  const all = marketView(g);
  // v0.7.3 'Has bunks': offers with any class 1 facility (local to the visit).
  const [bunks, setBunks] = useState(false);
  const list = bunks ? all.filter((v) => hasBunks(offerRest(v))) : all;
  const ids = all.map((v) => v.offer.id).join();
  // Seen on visit: the switch's dot clears; a deep link (Inbox) scrolls to its card.
  useEffect(() => {
    const ids = all.map((v) => v.offer.id);
    const fresh = unseenOffers(ids) > 0;
    markMarketSeen(ids);
    // v0.7.2: the top bar's offer chip goes once seen.
    if (fresh) store.emit();
    if (sel) document.querySelector(`.mk-card[data-offer="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, sel]);
  const early = g.now - g.started < 30 * DAY;
  return (
    <>
      <MarketAlerts />
      <div className="row gap-12 mb-8 mk-intro">
        <span className="small muted grow">Good airframes are scarce: about one offer a month, open for one to three weeks. Aircraft are handed over where they are; our pilots fly out on airlines and ferry them home.</span>
        <button className={`mk-filter ${bunks ? 'on' : ''}`} aria-pressed={bunks} onClick={() => setBunks(!bunks)}><BedDouble /> Has bunks{bunks ? ` (${list.length})` : ''}</button>
      </div>
      {list.length ? (
        <div className="mk-grid">{list.map((v) => <OfferCard key={v.offer.id} g={g} now={g.now} v={v} sel={sel === v.offer.id} />)}</div>
      ) : bunks && all.length ? (
        <div className="card sc-pad muted small">None of the {all.length} offer{all.length === 1 ? '' : 's'} has bunks (class 1 rest for the pilots or the cabin crew). <button className="btn btn-sm" onClick={() => setBunks(false)}>Show all</button></div>
      ) : (
        <div className="card sc-pad muted small">No aircraft on offer right now. Lessors call every few weeks{early ? '; the first offer usually comes within two months' : ''}.{store.settings.marketAlerts ? ' Market alerts are on: you will hear about new ones.' : ' Turn on market alerts above to hear about new ones.'}</div>
      )}
    </>
  );
}
