// v0.7 Fleet → Market (UPDATE-0.7.md §F6.7): scarce offers in two columns, newest first. Each card shows the
// terms, where the aircraft is handed over, the delivery ferry and the pilots' airline deadheads, and chips for
// the ladder gate, rated crew and how long the offer stays open. Lease… / Buy… opens the AcquireModal.

import { Lock, ShoppingCart, TrendingUp } from 'lucide-react';
import { useEffect } from 'react';
import { artFor } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { MARKET_LIVERY } from '../../data/livery';
import { typeOf } from '../../engine/core/perf';
import { DAY, fmtDay } from '../../engine/core/time';
import type { GameState } from '../../engine/core/types';
import { marketView, type MarketOfferView } from '../../engine/ops';
import { AircraftArt } from '../components/AircraftArt';
import { Flag } from '../components/ui';
import { money } from '../format';
import { store } from '../store';
import { markMarketSeen, offerKind, sellerOf } from './screenLogic';

/** '12 Jan · home ~14 Jan'. */
export function handoverLine(v: Pick<MarketOfferView, 'quote'>): string {
  const q = v.quote;
  return `Handover ${fmtDay(q.handover)}${q.legs.length ? ` · home ~${fmtDay(q.homeBy)}` : ' at our base'}`;
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

function OfferCard({ v, sel }: { v: MarketOfferView; sel: boolean }) {
  const o = v.offer;
  const t = typeOf(o.typeId);
  const kind = offerKind(o);
  const site = v.quote.site;
  const country = AIRPORT_BY_CODE[site]?.country;
  const lease = o.kind === 'dryLeaseIn';
  const dh = deadheadLine(v);
  return (
    <div className={`card mk-card ${sel ? 'selected' : ''} ${v.gate.ok ? '' : 'locked'}`} data-offer={o.id}>
      <div className="mk-top">
        <div className="mk-art"><AircraftArt typeId={artFor(o.typeId)} livery={MARKET_LIVERY} detail="simple" /></div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row gap-8 between">
            <b className="ellipsis">{t.short} · {o.builtYear} · {o.cabin.label}</b>
            <span className={`badge ${kind.tone}`}>{kind.label}</span>
          </div>
          <div className="small muted mk-where">{sellerOf(o)} · {(o.where ?? site).replace(/^Airbus, |^Boeing, /, '')}{country ? <> <Flag country={country} /></> : null}</div>
        </div>
      </div>
      <div className="mk-terms">
        <b className="num">{termsLine(v)}</b>
        {lease && <span className="small dim"> · reserves ${o.reservesPerFH.toLocaleString('en-US')}/FH</span>}
      </div>
      <div className="mk-deliv small">
        <div>{handoverLine(v)}</div>
        {v.quote.legs.length > 0 && <div className="muted">Ferry {v.quote.text}</div>}
        {dh && <div className="muted ellipsis">Pilots deadhead out: {dh}</div>}
      </div>
      <div className="mk-chips">
        <GateChip v={v} />
        <span className={`chip mk-chip ${v.crew.level === 'ok' ? 'good' : v.crew.level}`}>{v.crew.text}</span>
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

export function MarketView({ g, sel }: { g: GameState; sel: string | null }) {
  const list = marketView(g);
  const ids = list.map((v) => v.offer.id).join();
  // Seen on visit: the switch's dot clears; a deep link (Inbox) scrolls to its card.
  useEffect(() => {
    markMarketSeen(list.map((v) => v.offer.id));
    if (sel) document.querySelector(`.mk-card[data-offer="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, sel]);
  const early = g.now - g.started < 30 * DAY;
  return (
    <>
      <div className="small muted mb-8">Good airframes are scarce: about one offer a month, open for one to three weeks. Aircraft are handed over where they are; our pilots fly out on airlines and ferry them home.</div>
      {list.length ? (
        <div className="mk-grid">{list.map((v) => <OfferCard key={v.offer.id} v={v} sel={sel === v.offer.id} />)}</div>
      ) : (
        <div className="card sc-pad muted small">No aircraft on offer right now. Lessors call every few weeks{early ? '; the first offer usually comes within two months' : ''}. Turn on market alerts in Settings to hear about new ones.</div>
      )}
    </>
  );
}
