// v0.7 sign a market offer (UPDATE-0.7.md §F6.7): terms, the delivery plan as a small timeline (sign → pilots fly
// out on airlines → handover at the site → ferry legs with night stops → home), costs now and later, the return
// conditions and warnings (gate pending, rated pilots, cash after signing). Signing runs acquireAircraft.

import { AlertTriangle, ShoppingCart } from 'lucide-react';
import { artFor } from '../../data/acmiTypes';
import { enginesOf, variantOf } from '../../data/variants';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { MARKET_LIVERY } from '../../data/livery';
import { typeOf } from '../../engine/core/perf';
import { fmtDay, fmtDuration, fmtTime } from '../../engine/core/time';
import { acquireAircraft, marketView } from '../../engine/ops';
import { AircraftArt } from '../components/AircraftArt';
import { Modal } from '../components/ui';
import { money } from '../format';
import { KV } from '../screens/common';
import { dayIn, GateChip, offerRest, typeName } from '../screens/Market';
import { RestTwoLiner } from '../components/RestLines';
import { offerKind, sellerOf } from '../screens/screenLogic';
import { store, useGame } from '../store';

const city = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;

export function AcquireModal({ offerId }: { offerId: string }) {
  const g = useGame();
  const v = marketView(g).find((x) => x.offer.id === offerId);
  const close = () => store.closeModal();
  if (!v) {
    return (
      <Modal title="Offer gone" icon={<ShoppingCart className="accent" />} onClose={close} footer={<button className="btn" onClick={close}>Close</button>}>
        <p className="muted">This offer has gone: the seller placed the aircraft elsewhere.</p>
      </Modal>
    );
  }
  const o = v.offer;
  const t = typeOf(o.typeId);
  const q = v.quote;
  const lease = o.kind === 'dryLeaseIn';
  const now = lease ? o.deposit : o.price;
  const after = g.company.cash - now;
  // The engine refuses below the deposit (a buy's deposit is the price).
  const short = g.company.cash < o.deposit;
  const blocker = !v.gate.ok ? 'Approval needed first' : short ? `Needs ${money(o.deposit)} · ${money(g.company.cash)} cash` : null;
  const sign = () => {
    const res = store.act((gg) => acquireAircraft(gg, o.id));
    if (!res.ok) return;
    close();
    store.navigate('fleet', { sel: { kind: 'aircraft', id: res.data!.aircraftId } });
  };
  const warns: { tone: 'warn' | 'bad'; text: string }[] = [];
  if (v.gate.pending.length) warns.push({ tone: 'warn', text: v.gate.text });
  if (v.crew.level !== 'ok') warns.push({ tone: v.crew.level, text: `${v.crew.text}. Without rated pilots the aircraft waits at ${city(q.site)} and pays parking.` });
  if (after < 0) warns.push({ tone: 'bad', text: `Costs ${money(now)} now: ${money(-after)} more than the cash on hand.` });
  else if (after < 500_000) warns.push({ tone: 'warn', text: `Leaves ${money(after)} in cash after signing.` });
  const site = city(q.site);
  const label = lease ? `${o.newBuild ? 'Sign new-build lease' : 'Sign lease'} · ${money(o.deposit)} deposit` : `Buy · ${money(o.price)}`;
  // In time order (the pilots arrive after the handover, for the ferry); the airline itinerary is an estimate.
  const steps: { k: string; t: number; title: string; sub?: string; tone?: string }[] = [
    { k: 'sign', t: g.now, title: `Sign today, ${fmtDay(g.now)}`, sub: lease ? `Deposit ${money(o.deposit)} now` : `${money(o.price)} now` },
  ];
  const dh = q.deadhead;
  if (dh.length) steps.push({
    k: 'dh', t: dh[0].dep, title: `Pilots fly out on airlines · ${dayIn(g.now, dh[0].dep)}`,
    sub: `e.g. ${dh.map((l) => `${l.no} ${l.from}–${l.to} ${fmtDay(l.dep)} ${fmtTime(l.dep, l.from)}`).join(' · ')} (booked nearer the date)`,
  });
  steps.push({
    k: 'hand', t: q.handover, title: `Handover at ${site} · ${dayIn(g.now, q.handover)}`,
    sub: q.legs.length ? `${lease ? 'Lessor' : 'Seller'} acceptance: inspection, records and test flight (36 h)` : 'At our base: no ferry',
  });
  q.legs.forEach((l, i) => steps.push({
    k: `leg${i}`, t: l.std, title: `Ferry ${l.from}–${l.to} · ${dayIn(g.now, l.std)} ${fmtTime(l.std, l.from)} local`, sub: `${fmtDuration(l.block)} block${l.nightStopAfter ? ` · night stop at ${city(l.to)}` : ''}`,
  }));
  if (q.legs.length) steps.push({ k: 'home', t: q.homeBy, title: `Home at ${city(g.company.homeBase)} · ~${dayIn(g.now, q.homeBy)}`, tone: 'good' });
  steps.sort((a, b) => a.t - b.t);
  const name = typeName(o.typeId);
  // 'an A330', 'an 8…', 'an 11…/18…'; 'a 737'.
  const article = o.newBuild ? 'a new-build ' : /^(A|E|8|1[18]\d\d(?!\d))/.test(name) ? 'an ' : 'a ';
  const kind = offerKind(o);
  return (
    <Modal className="aq-modal" title={`${lease ? 'Lease' : 'Buy'} ${article}${name}`} icon={<ShoppingCart className="accent" />} onClose={close} footer={
      <>
        {blocker && <span className="grow small warn">{blocker}</span>}
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn btn-primary" onClick={sign} disabled={!!blocker}><ShoppingCart /> {label}</button>
      </>
    }>
      <div className="aq-top">
        <div className="aq-art"><AircraftArt typeId={artFor(o.typeId, o.variant)} livery={MARKET_LIVERY} detail="simple" /></div>
        <div className="col gap-4 grow" style={{ minWidth: 0 }}>
          <div className="row gap-8"><b>{t.name}</b><span className={`badge ${kind.tone}`}>{kind.label}</span></div>
          <div className="small muted">{sellerOf(o)} · {o.where ?? q.site} · built {o.builtYear} · {o.cabin.label}</div>
          {/* v0.10 the airframe's engines (and exit layout where it sets the seat limit) */}
          <div className="small muted">{enginesOf(o.typeId, o.variant)}{variantOf(o.typeId, o.variant)?.maxSeats ? ` · ${variantOf(o.typeId, o.variant)!.label}, up to ${variantOf(o.typeId, o.variant)!.maxSeats} seats` : ''}</div>
          <div className="row gap-8 wrap"><GateChip v={v} /><span className={`chip mk-chip ${v.crew.level === 'ok' ? 'good' : v.crew.level}`}>{v.crew.text}</span></div>
          <RestTwoLiner g={g} rest={offerRest(v)} typeId={o.typeId} />
        </div>
      </div>
      <div className="aq-cols">
        <div className="col gap-8" style={{ minWidth: 0 }}>
          <div className="upper dim">Delivery plan</div>
          <ol className="aq-steps">
            {steps.map((s) => (
              <li key={s.k} className={s.tone ?? ''}>
                <span className="aq-dot" aria-hidden />
                <span className="col" style={{ minWidth: 0 }}><b className="small">{s.title}</b>{s.sub && <span className="small muted">{s.sub}</span>}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="col gap-8" style={{ minWidth: 0 }}>
          <div className="upper dim">Costs</div>
          <KV rows={[
            [lease ? 'Deposit now' : 'Price now', money(now)],
            ...(lease ? [['Rent from handover', `${money(o.rentPerMonth)}/month × ${o.leaseMonths}`], ['Reserves', `$${o.reservesPerFH.toLocaleString('en-US')}/FH`]] as [string, string][] : []),
            ...(q.legs.length ? [['Delivery ferry', `≈ ${money(q.fuel + q.fees)} fuel & fees`], ['Delivery crew', `≈ ${money(q.crew)} tickets, hotels`]] as [string, string][] : []),
            ['Cash after signing', money(after)],
          ]} />
          {v.returnText && <div className="small muted">{v.returnText}; repaint white.</div>}
          <div className="tiny dim">Offer open {v.daysLeft} more day{v.daysLeft === 1 ? '' : 's'}.</div>
        </div>
      </div>
      {warns.length > 0 && (
        <div className="col gap-4 mt-12">
          {warns.map((w, i) => <div key={i} className={`small row gap-8 cv-warn ${w.tone}`}><AlertTriangle className="sc-ico-s" /><span>{w.text}</span></div>)}
        </div>
      )}
    </Modal>
  );
}
