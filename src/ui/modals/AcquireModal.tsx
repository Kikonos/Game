// v0.7 sign a market offer (UPDATE-0.7.md §F6.7): terms, the delivery plan as a small timeline (sign → pilots fly
// out on airlines → handover at the site → ferry legs with night stops → home), costs now and later, the return
// conditions and warnings (gate pending, rated pilots, cash after signing). Signing runs acquireAircraft.

import { AlertTriangle, ShoppingCart } from 'lucide-react';
import { artFor } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { MARKET_LIVERY } from '../../data/livery';
import { typeOf } from '../../engine/core/perf';
import { fmtDay, fmtDuration, fmtTime } from '../../engine/core/time';
import { acquireAircraft, marketView } from '../../engine/ops';
import { AircraftArt } from '../components/AircraftArt';
import { Modal } from '../components/ui';
import { money } from '../format';
import { KV } from '../screens/common';
import { GateChip } from '../screens/Market';
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
  const steps: { k: string; title: string; sub?: string; tone?: string }[] = [
    { k: 'sign', title: `Sign today, ${fmtDay(g.now)}`, sub: lease ? `Deposit ${money(o.deposit)} now` : `${money(o.price)} now` },
  ];
  if (q.deadhead.length) steps.push({ k: 'dh', title: 'Pilots fly out on airlines', sub: q.deadhead.map((l) => `${l.no} ${l.from}–${l.to} ${fmtDay(l.dep)} ${fmtTime(l.dep, l.from)}`).join(' · ') });
  steps.push({ k: 'hand', title: `Handover at ${site} · ${fmtDay(q.handover)}`, sub: q.legs.length ? 'Acceptance: inspection, records and a test flight (36 h)' : 'At our base: no ferry' });
  q.legs.forEach((l, i) => steps.push({
    k: `leg${i}`, title: `Ferry ${l.from}–${l.to} · ${fmtDay(l.std)} ${fmtTime(l.std, l.from)} local`, sub: `${fmtDuration(l.block)} block${l.nightStopAfter ? ` · night stop at ${city(l.to)}` : ''}`,
  }));
  if (q.legs.length) steps.push({ k: 'home', title: `Home at ${city(g.company.homeBase)} · ~${fmtDay(q.homeBy)}`, tone: 'good' });
  const kind = offerKind(o);
  return (
    <Modal className="aq-modal" title={`${lease ? 'Lease' : 'Buy'} ${t.short}`} icon={<ShoppingCart className="accent" />} onClose={close} footer={
      <>
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn btn-primary" onClick={sign} disabled={!v.gate.ok}><ShoppingCart /> {label}</button>
      </>
    }>
      <div className="aq-top">
        <div className="aq-art"><AircraftArt typeId={artFor(o.typeId)} livery={MARKET_LIVERY} detail="simple" /></div>
        <div className="col gap-4 grow" style={{ minWidth: 0 }}>
          <div className="row gap-8"><b>{t.name}</b><span className={`badge ${kind.tone}`}>{kind.label}</span></div>
          <div className="small muted">{sellerOf(o)} · {o.where ?? q.site} · built {o.builtYear} · {o.cabin.label}</div>
          <div className="row gap-8 wrap"><GateChip v={v} /><span className={`chip mk-chip ${v.crew.level === 'ok' ? 'good' : v.crew.level}`}>{v.crew.text}</span></div>
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
