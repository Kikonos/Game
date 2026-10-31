// v0.14 Company › Team › Sales trips & fairs: who can travel (you, the commercial analyst once hired) and where they
// are now; the trade fairs ahead (pick one: the flights out and back on real airlines, as crew deadhead, and the
// cost) or a client to visit; the trips booked and done with what they brought back.

import { Briefcase, CalendarDays, Plane, PlaneLanding, PlaneTakeoff, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { flag } from '../../data/countries';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { bookTrip, cancelTrip, fairsAhead, travellers, tripNow, tripQuote, tripsView, tripTitle, type Traveller, type TripQuote } from '../../engine/commercial';
import type { CommercialLeg } from '../../engine/ops/commercial';
import { DAY, fmtDay, fmtTime } from '../../engine/core/time';
import type { GameState } from '../../engine/core/types';
import { Seg } from '../components/ui';
import { money } from '../format';
import { store } from '../store';

const city = (c: string) => AIRPORT_BY_CODE[c]?.city ?? c;

/** The row at the top of the Team list. */
export function SalesRow({ g, on }: { g: GameState; on: boolean }) {
  const away = travellers(g).filter((t) => t.tripId);
  return (
    <button className={`v8-row v9-head-row v14-sales-row ${on ? 'on' : ''}`} onClick={() => store.select({ kind: 'head', id: 'sales' })} aria-pressed={on}>
      <span className="v9-head-ico"><Briefcase /></span>
      <span className="col grow" style={{ minWidth: 0, gap: 3 }}>
        <b className="ellipsis">Sales trips & fairs</b>
        <span className="small muted ellipsis">{away.length ? away.map((t) => `${t.name.split(' ')[0]}: ${tripNow(g, g.com!.trips.find((x) => x.id === t.tripId)!)}`).join(' · ') : 'Meet clients, bring back work'}</span>
      </span>
    </button>
  );
}

function Legs({ legs, label, icon }: { legs: CommercialLeg[]; label: string; icon: React.ReactNode }) {
  return (
    <div className="v14-legs">
      <span className="row gap-8 small muted">{icon}{label}</span>
      {legs.map((l, i) => (
        <span key={i} className="row gap-8 small v14-leg">
          <b className="mono">{l.no}</b>
          <span className="mono">{l.from}–{l.to}</span>
          <span className="num">{fmtDay(l.dep)} {fmtTime(l.dep)} UTC <span className="dim">({fmtTime(l.dep, l.from)} local)</span></span>
        </span>
      ))}
    </div>
  );
}

function QuoteCard({ q, who, onBook, onClose }: { q: TripQuote; who: Traveller; onBook: () => void; onClose: () => void }) {
  return (
    <div className="v8-box col gap-8 v14-quote">
      <div className="row between">
        <b>{q.title}</b>
        <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close"><X /></button>
      </div>
      <span className="small muted">{q.where} · meetings {fmtDay(q.start)}{q.end - q.start > DAY ? ` – ${fmtDay(q.end)}` : ''} · {q.meets}</span>
      {q.ok ? (
        <>
          <Legs legs={q.legsOut} label="Out" icon={<PlaneTakeoff className="sc-ico-s" />} />
          <Legs legs={q.legsBack} label="Back" icon={<PlaneLanding className="sc-ico-s" />} />
          <span className="small">Seats {money(q.tickets)}{q.pass ? ` · pass ${money(q.pass)}` : ''} · hotel {q.nights} night{q.nights > 1 ? 's' : ''} {money(q.hotel)} · per diem {money(q.perDiem)}</span>
          <div className="row between">
            <b>Total {money(q.total)}</b>
            <button className="btn btn-primary" onClick={onBook}><Plane /> Book {who === 'ceo' ? 'my' : 'the'} trip</button>
          </div>
        </>
      ) : <span className="small warn">{q.why}</span>}
    </div>
  );
}

export function SalesPanel({ g }: { g: GameState }) {
  const day = Math.floor(g.now / DAY);
  const people = travellers(g);
  const free = people.filter((p) => !p.tripId);
  const [who, setWho] = useState<Traveller>(free[0]?.who ?? 'ceo');
  const [pick, setPick] = useState<{ fairId?: string; clientId?: string } | null>(null);
  const fairs = useMemo(() => fairsAhead(g), [g, day]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useMemo(() => (pick ? tripQuote(g, who, pick) : null), [g, who, pick, Math.floor(g.now / 60), store.editCount]); // eslint-disable-line react-hooks/exhaustive-deps
  const clients = useMemo(() => Object.values(g.clients).filter((c) => (c.kind === 'airline' || c.kind === 'tourOperator') && !c.rivalId && c.ceased === undefined && AIRPORT_BY_CODE[c.base] && c.base !== g.company.homeBase)
    .sort((a, b) => b.relation - a.relation || a.name.localeCompare(b.name)), [g, day]); // eslint-disable-line react-hooks/exhaustive-deps
  const trips = tripsView(g);
  const book = () => {
    if (!pick) return;
    const r = store.act((gg) => bookTrip(gg, who, pick));
    if (r.ok) setPick(null);
  };
  return (
    <div className="col gap-16 v8-detail v14-sales">
      <div className="row gap-12">
        <span className="v9-head-ico lg"><Briefcase /></span>
        <div className="col grow" style={{ minWidth: 0, gap: 2 }}>
          <span className="v8-name">Sales trips & fairs</span>
          <span className="small muted">They fly on airline seats like our crew deadheading. Clients met think better of us; some bring work.</span>
        </div>
      </div>
      <div className="col gap-4">
        <div className="upper dim">Who travels</div>
        {people.map((p) => (
          <div key={p.who} className="v8-box row gap-8">
            <Users className="sc-ico-s dim" />
            <span className="col grow" style={{ minWidth: 0 }}>
              <b className="ellipsis">{p.name} <span className="small muted">· {p.title}</span></b>
              <span className="small muted ellipsis">{p.tripId ? tripNow(g, g.com!.trips.find((x) => x.id === p.tripId)!) : 'In the office'}</span>
            </span>
          </div>
        ))}
        {!g.heads?.analyst?.hired && <span className="tiny dim">Hire a commercial analyst (Team) to send a second person.</span>}
      </div>
      {free.length > 0 && (
        <div className="col gap-8">
          <div className="row between">
            <div className="upper dim">Plan a trip</div>
            {free.length > 1 && <Seg<Traveller> value={who} onChange={setWho} options={free.map((p) => ({ value: p.who, label: p.who === 'ceo' ? 'You' : p.name.split(' ')[0] }))} />}
          </div>
          {fairs.map((f) => (
            <button key={f.id} className={`v8-row v14-fair ${pick?.fairId === f.id ? 'on' : ''}`} onClick={() => setPick({ fairId: f.id })} disabled={!!f.tripId} aria-pressed={pick?.fairId === f.id}>
              <CalendarDays className="sc-ico-s dim" />
              <span className="col grow" style={{ minWidth: 0 }}>
                <b className="ellipsis">{f.name} <span className="small muted">· {f.where}</span></b>
                <span className="small muted ellipsis">{fmtDay(f.start)} – {fmtDay(f.end)} · pass {money(f.pass)}{f.tripId ? ' · booked' : ''}</span>
              </span>
            </button>
          ))}
          {pick?.fairId && q && <QuoteCard q={q} who={who} onBook={book} onClose={() => setPick(null)} />}
          <div className="set-row v14-field">
            <div><b>Visit a client</b><div className="tiny dim">One or two days at their office</div></div>
            <select className="select" value={pick?.clientId ?? ''} aria-label="Client to visit" onChange={(e) => setPick(e.target.value ? { clientId: e.target.value } : null)}>
              <option value="">Choose…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{flag(c.country)} {c.name} · {city(c.base)}</option>)}
            </select>
          </div>
          {pick?.clientId && q && <QuoteCard q={q} who={who} onBook={book} onClose={() => setPick(null)} />}
        </div>
      )}
      <div className="col gap-4">
        <div className="upper dim">Trips</div>
        {!trips.length && <div className="small dim">No trips yet.</div>}
        {trips.map((t) => (
          <div key={t.id} className={`v8-box col gap-4 v14-trip ${t.status}`}>
            <div className="row between gap-8">
              <b className="ellipsis">{t.name.split(' ')[0]} · {tripTitle(t)}</b>
              <span className="small muted nowrap">{fmtDay(t.out.std)} – {fmtDay(t.back.sta)}</span>
            </div>
            <span className="small muted">{tripNow(g, t)} · {money(t.cost.tickets + t.cost.pass + t.cost.hotel + t.cost.perDiem)}</span>
            {t.status === 'done' && (
              <span className="small">
                Met {t.met?.length ? t.met.map((id) => g.clients[id]?.name).filter(Boolean).join(', ') : 'nobody new'}
                {t.leads?.length ? ` · ${t.leads.length} lead${t.leads.length > 1 ? 's' : ''}: ${t.leads.map((l) => `${g.clients[l.clientId]?.name} (${l.kind === 'rfp' ? 'invitation to tender' : 'offer'})`).join(', ')}` : ' · no firm leads'}
              </span>
            )}
            {t.status === 'planned' && g.now < t.out.std && (
              <div className="row end"><button className="btn btn-ghost" onClick={() => store.act((gg) => cancelTrip(gg, t.id))}>Call off</button></div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
