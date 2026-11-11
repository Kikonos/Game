// v0.7 Fleet → Market (UPDATE-0.7.md §F6.7). v0.17 (UPDATE-0.17.md §N.1; lane `market-ui`): the lessor rating line
// with Ask lessors… and Short-term…, then Offers · Requests · In progress. Offers are four-line cards (OffersView); the
// terms, the delivery plan and the return conditions are in the dialogs (LoiModal for a lease through a letter of
// intent, AcquireModal for purchases, short-term and legacy offers).

import { DealsView } from './market/DealsView';
import { OffersView } from './market/OffersView';
import { RatingLine } from './market/RatingLine';
import { RequestsView } from './market/RequestsView';
import { Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BAL } from '../../engine/core/balance';
import { typeOf } from '../../engine/core/perf';
import { fmtDate, fmtDay, yearOf } from '../../engine/core/time';
import type { GameState, Ref } from '../../engine/core/types';
import { restOfAc } from '../../engine/crew';
import { marketView, type MarketOfferView } from '../../engine/ops';
import { Seg, Toggle } from '../components/ui';
import { Help } from '../components/Help';
import { money } from '../format';
import { store, useStore } from '../store';
import { markMarketSeen, unseenOffers } from './screenLogic';
import { lockOf } from '../../engine/scenario';
import { LockedPanel } from '../components/Locked';
import { marketCounts } from './market/marketLogic';

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

/** v0.7.3 an offer's rest as the crew would use it (v0.7.4: rolled bunks, else the curtained seats of its cabin). */
export const offerRest = (v: Pick<MarketOfferView, 'offer'>) => restOfAc(v.offer);

/** v0.7.2 F2: the market alert toggles live here (moved from Settings). */
function MarketAlerts() {
  const s = useStore();
  const st = s.settings;
  return (
    <div className="card mk-alerts">
      <span className="row gap-8"><b className="small row gap-6" style={{ alignItems: 'center' }}>Market alerts <Help title="Market alerts">
        A new aircraft offer brings an Inbox message, a quiet notice and a chip in the top bar.
      </Help></b><Toggle on={st.marketAlerts} onChange={(v) => store.setSettings({ marketAlerts: v })} label="Market alerts" /></span>
      <span className={`row gap-8 ${st.marketAlerts ? '' : 'set-off'}`}>
        <b className="small">Pause on new offers</b>
        <span className={st.marketAlerts ? '' : 'set-disabled'}><Toggle on={st.marketAlerts && st.autoPause.marketOffer} onChange={(v) => st.marketAlerts && store.setSettings({ autoPause: { ...st.autoPause, marketOffer: v } })} label="Pause on new offers" /></span>
        {!st.marketAlerts && <span className="tiny dim">Needs market alerts on</span>}
      </span>
    </div>
  );
}

type MarketTab = 'offers' | 'requests' | 'progress';

/** The tab a deep link opens: a request on Requests, a deal or a delivering aircraft on In progress. */
const tabOf = (sel: Ref | null | undefined): MarketTab | null => (sel?.kind === 'rfp' ? 'requests' : sel?.kind === 'deal' || sel?.kind === 'aircraft' ? 'progress' : sel?.kind === 'market' ? 'offers' : null);

export function MarketView({ g, sel, selRef }: { g: GameState; sel: string | null; selRef?: Ref | null }) {
  const all = marketView(g);
  const v17 = BAL.v017.on && !!g.leasing;
  const [tab, setTab] = useState<MarketTab>(() => tabOf(selRef) ?? 'offers');
  const want = tabOf(selRef);
  const selKey = selRef ? `${selRef.kind}:${selRef.id}` : '';
  // A deep link (Inbox, a card's button) opens its tab.
  useEffect(() => {
    if (want) setTab(want);
  }, [selKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const ids = all.map((v) => v.offer.id).join();
  // Seen on visit: the switch's dot clears.
  useEffect(() => {
    const ids = all.map((v) => v.offer.id);
    const fresh = unseenOffers(ids) > 0;
    markMarketSeen(ids);
    // v0.7.2: the top bar's offer chip goes once seen.
    if (fresh) store.emit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);
  // v0.15 a scenario's fixed fleet: the market is closed (a calm notice).
  const lock = lockOf(g, 'fleet');
  if (lock) return <LockedPanel title="Aircraft market closed" why={lock}>No leasing, buying, selling or dry leases out while the scenario runs.</LockedPanel>;
  if (!v17) {
    return (
      <>
        <MarketAlerts />
        <OffersView g={g} sel={sel} />
      </>
    );
  }
  const n = marketCounts(g, all.length);
  return (
    <>
      <MarketAlerts />
      <RatingLine g={g} />
      <div className="row gap-12 mb-8 mk17-tabs">
        <Seg<MarketTab> value={tab} onChange={setTab} options={[
          { value: 'offers', label: `Offers (${n.offers})` },
          { value: 'requests', label: `Requests (${n.requests})` },
          { value: 'progress', label: `In progress (${n.progress})` },
        ]} />
        {/* v0.22 how the market works, once, behind the '?' (it was a line here and a paragraph in each empty tab). */}
        <Help title="The aircraft market">
          <p><b>Offers.</b> Lessors call when an aircraft comes free.</p>
          <p><b>Requests.</b> Or ask them for the one you want: type, age, lease and start. They answer in one to three weeks with a proposal or a plain no. Short-term aircraft come from airlines in their quiet season.</p>
          <p><b>In progress.</b> A letter of intent starts the lessor's credit check. Once the lease is signed the aircraft goes through records, a check and paint before its ferry home.</p>
        </Help>
      </div>
      {tab === 'offers' && <OffersView g={g} sel={sel} />}
      {tab === 'requests' && <RequestsView g={g} sel={selRef} onOffers={() => setTab('offers')} />}
      {tab === 'progress' && <DealsView g={g} sel={selRef} />}
    </>
  );
}
