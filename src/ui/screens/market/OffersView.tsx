// v0.17 Fleet › Market › Offers (UPDATE-0.17.md §N.1, §N.2; lane `market-ui`): every open offer of every source
// (lessor calls, proposals to our requests, failure batches, short-term subleases, new builds, legacy offers), newest
// first, in four-line cards: what it is · the terms · when it is ready · chips and the one button. The rest lines, the
// ferry, the deadheads and the return terms are in the dialog. Filter chips: All · Narrowbody · Widebody · Short-term ·
// Has bunks. Two columns on the iPad, one on the iPhone.

import { BedDouble, FileSignature, ShoppingCart, Sparkles, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { artFor } from '../../../data/acmiTypes';
import { MARKET_LIVERY } from '../../../data/livery';
import { BAL } from '../../../engine/core/balance';
import { DAY } from '../../../engine/core/time';
import type { GameState } from '../../../engine/core/types';
import { hasBunks, restOfAc } from '../../../engine/crew';
import { inductionPlan, loiQuote, tightNow, tightWord, usesLoi } from '../../../engine/leasing';
import { marketView, type MarketOfferView } from '../../../engine/ops';
import { AircraftArt } from '../../components/AircraftArt';
import { store } from '../../store';
import { GateChip } from '../Market';
import { isExoticType, lessorLabel, offerDaysLeft, offerMatches, offerReadyLine, offerTermsLine, sourceBadge, tName, type OfferFilter } from './marketLogic';

interface Row { v: MarketOfferView; loi: boolean; ready: number; home: number | null; bunks: boolean; tight: string | null }

/** The ready and home days shown on the card: after the letter of intent's credit check and the transition. */
function rowOf(g: GameState, v: MarketOfferView): Row {
  const o = v.offer;
  const loi = usesLoi(g, o);
  const q = loi ? loiQuote(g, o.id) : null;
  const ready = q ? q.ready : o.source ? inductionPlan(g, o).ready : v.quote.handover;
  // The ferry home after the handover, as the delivery quote plans it.
  const ferry = v.quote.legs.length ? v.quote.homeBy - v.quote.handover : 0;
  const t = BAL.v017.on && g.leasing ? tightNow(g, o.typeId) : null;
  return { v, loi, ready, home: ferry > 0 ? ready + ferry : null, bunks: hasBunks(restOfAc(o)), tight: t === null ? null : tightWord(t) };
}

/** 'AerCap · ex-Vueling', 'TUI fly Deutschland, sublease', 'Carlyle Aviation Partners · ex-TAROM'. */
function sellerLine(o: MarketOfferView['offer']): string {
  const who = lessorLabel(o).name;
  if (o.source === 'spot' && o.spot) return `${o.spot.airline}, sublease`;
  if (o.batchOf) return `${who} · ex-${o.batchOf}`;
  return o.exOperator ? `${who} · ex-${o.exOperator}` : who;
}

function OfferCard17({ g, r, sel }: { g: GameState; r: Row; sel: boolean }) {
  const o = r.v.offer;
  const badge = sourceBadge(o);
  const left = offerDaysLeft(g.now, o);
  const gate = r.v.gate;
  const crew = r.v.crew;
  const open = () => store.openModal(r.loi ? { kind: 'loi', offerId: o.id } : { kind: 'acquire', offerId: o.id });
  return (
    <div className={`card mk-card mk17-card ${sel ? 'selected' : ''} ${gate.ok ? '' : 'locked'}`} data-offer={o.id}>
      <div className="mk-top">
        <div className="mk-art"><AircraftArt typeId={artFor(o.typeId, o.variant)} livery={MARKET_LIVERY} detail="simple" /></div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row gap-8 between">
            <b className="ellipsis">{tName(o.typeId)} · {o.builtYear} · {o.cabin.label}</b>
            <span className={`badge ${badge.tone}`}>{badge.label}</span>
          </div>
          <div className="small muted ellipsis" data-tip={lessorLabel(o).tip}>{sellerLine(o)}</div>
        </div>
      </div>
      <div className="mk17-line num ellipsis"><b>{offerTermsLine(o)}</b></div>
      <div className="mk17-line small muted ellipsis">{offerReadyLine(g.now, o, r.ready, r.home)} · <span className={left <= 2 ? 'warn' : ''}>{left <= 1 ? 'last day' : `open ${left} more days`}</span></div>
      <div className="row gap-8 mk17-foot">
        <div className="mk-chips grow">
          <GateChip v={r.v} />
          <span className={`chip mk-chip ${crew.level === 'ok' ? 'good' : crew.level}`} data-tip={crew.level === 'ok' ? undefined : crew.text}>{crew.level === 'ok' ? crew.text : crew.text.replace(/: .*$/, '')}</span>
          {r.tight && <span className="chip mk-chip" data-tip="How hard this type is to find now">{r.tight}</span>}
          {isExoticType(o.typeId) && <span className="chip mk-chip warn" data-tip="A rare type: the dialog says what it takes"><Sparkles className="sc-ico-s" />Rare</span>}
          {r.bunks && <span className="chip mk-chip good"><BedDouble className="sc-ico-s" />Bunks</span>}
        </div>
        {gate.ok
          ? <button className="btn btn-primary" onClick={open}>{r.loi ? <><FileSignature /> Sign LOI…</> : <><ShoppingCart /> {o.kind === 'dryLeaseIn' ? 'Lease…' : 'Buy…'}</>}</button>
          : <button className="btn" onClick={() => store.navigate('company', { view: 'ladder' })}><TrendingUp /> See the ladder</button>}
      </div>
    </div>
  );
}

const FILTERS: { id: OfferFilter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'narrow', label: 'Narrowbody' }, { id: 'wide', label: 'Widebody' }, { id: 'spot', label: 'Short-term' }, { id: 'bunks', label: 'Has bunks' },
];

export function OffersView({ g, sel }: { g: GameState; sel?: string | null }) {
  const [f, setF] = useState<OfferFilter>('all');
  const day = Math.floor(g.now / DAY);
  const ids = g.market.aircraft.map((o) => `${o.id}:${o.expires}`).join();
  // Rows recomputed daily, on a new offer, or on a deal or request change (the transition plans read the CAMO's load).
  const rows = useMemo(() => marketView(g).map((v) => rowOf(g, v)), [g, day, ids, g.leasing?.rev, Object.keys(g.fleet).length]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = rows.filter((r) => offerMatches(r.v.offer, f, r.bunks));
  useEffect(() => {
    if (sel) document.querySelector(`.mk-card[data-offer="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);
  const n = (id: OfferFilter) => rows.filter((r) => offerMatches(r.v.offer, id, r.bunks)).length;
  return (
    <>
      {rows.length > 0 && (
        <div className="mk17-filters row gap-8 mb-8" role="group" aria-label="Filter offers">
          {FILTERS.map((x) => (
            <button key={x.id} className={`mk-filter ${f === x.id ? 'on' : ''}`} aria-pressed={f === x.id} onClick={() => setF(x.id)}>
              {x.id === 'bunks' && <BedDouble />}{x.label}{x.id !== 'all' && f === x.id ? ` (${n(x.id)})` : ''}
            </button>
          ))}
        </div>
      )}
      {list.length ? (
        <div className="mk-grid">{list.map((r) => <OfferCard17 key={r.v.offer.id} g={g} r={r} sel={sel === r.v.offer.id} />)}</div>
      ) : rows.length ? (
        <div className="card sc-pad muted small">None of the {rows.length} offer{rows.length === 1 ? '' : 's'} fits this filter. <button className="btn btn-sm" onClick={() => setF('all')}>Show all</button></div>
      ) : (
        <div className="card sc-pad muted small row gap-12 mk17-empty">
          <span className="grow">No aircraft on offer right now. Lessors call when an aircraft comes free; or ask them for the one you want.</span>
          {g.leasing && BAL.v017.on && <button className="btn btn-sm btn-primary" onClick={() => store.openModal({ kind: 'rfp' })}><FileSignature /> Ask lessors…</button>}
        </div>
      )}
    </>
  );
}
