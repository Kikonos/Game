// v0.14 Contracts › Markets (the player: "Rather than the Team tab, add it to the Contracts tab"): how well known we are
// in each market of the world (a bar each: ordinary offers come mostly from where we are known), the trade fairs
// ahead grouped by region (dates, city, the trip's cost, who can go; pick one for the flights out and back on real
// airlines, as crew deadhead), a client to visit, and the trips booked and done with what they brought back.
// Company › Team keeps one line: who is away, linking here.

import { Briefcase, CalendarDays, ChevronRight, Globe2, Home, Plane, PlaneLanding, PlaneTakeoff, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { flag } from '../../data/countries';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { MARKET_BY_ID, MARKETS, type MarketId } from '../../data/markets';
import {
  bookTrip, cancelTrip, fairsAhead, homeMarket, presenceIn, presenceText, presenceView, presenceWord, travellers, tripNow, tripQuote, tripsView, tripTitle,
  type FairView, type Traveller, type TripQuote,
} from '../../engine/commercial';
import type { CommercialLeg } from '../../engine/ops/commercial';
import { DAY, fmtDay, fmtTime } from '../../engine/core/time';
import type { GameState } from '../../engine/core/types';
import { Seg } from '../components/ui';
import { money } from '../format';
import { store } from '../store';

const city = (c: string) => AIRPORT_BY_CODE[c]?.city ?? c;
const span = (a: number, b: number) => (fmtDay(a) === fmtDay(b) ? fmtDay(a) : `${fmtDay(a)} – ${fmtDay(b)}`);

/** Company › Team: one line, who is away (or nobody), linking to Contracts › Markets. */
export function AwayLine({ g }: { g: GameState }) {
  const away = travellers(g).filter((t) => t.tripId);
  const text = away.length
    ? away.map((t) => `${t.who === 'ceo' ? 'You' : t.name.split(' ')[0]}: ${tripNow(g, g.com!.trips.find((x) => x.id === t.tripId)!)}`).join(' · ')
    : 'Nobody is away';
  return (
    <button className="v14-away-line" onClick={() => store.navigate('contracts', { view: 'markets' })} aria-label="Sales trips and fairs: Contracts, Markets">
      <Briefcase className="sc-ico-s" />
      <span className="ellipsis grow small">{text}</span>
      <span className="small accent nowrap row">Markets <ChevronRight className="sc-ico-s" /></span>
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
      <span className="small muted">{q.where} · meetings {span(q.start, q.end)} · {q.meets}</span>
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

/** The presence bars: home first, then the best known. */
function Presence({ g }: { g: GameState }) {
  const day = Math.floor(g.now / DAY);
  const rows = useMemo(() => presenceView(g), [g, day, store.editCount]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="card v14-mk-card">
      <div className="v14-mk-head"><b>Where we’re known</b></div>
      {rows.map((r) => (
        <div key={r.id} className="v14-pres-row" title={`${r.name}: ${presenceWord(r.value)}. ${r.demand}`}>
          <span className="v14-pres-name ellipsis">
            {r.home && <Home className="v14-pres-home" aria-label="Home market" />}
            {r.short}
          </span>
          <span className="v14-pres-bar"><span style={{ width: `${Math.max(1.5, r.value)}%` }} /></span>
          <span className="v14-pres-val num">{Math.round(r.value)}</span>
          <span className={`v14-pres-season tiny ${r.season === 'Peak season' ? 'accent' : 'dim'}`}>{r.season === 'Peak season' ? 'Peak' : r.season ? 'Quiet' : ''}</span>
        </div>
      ))}
      <span className="tiny dim v14-mk-foot">Most offers come from where we’re known. Fairs, visits, jobs flown there and happy clients build it; it fades slowly without them.</span>
    </section>
  );
}

interface Group {
  id: MarketId | 'world';
  name: string;
  value: number | null;
  /** What its clients ask for (data/markets.ts). */
  demand: string;
  fairs: FairView[];
}

export function MarketsView({ g }: { g: GameState }) {
  const day = Math.floor(g.now / DAY);
  const people = travellers(g);
  const free = people.filter((p) => !p.tripId);
  const [who0, setWho] = useState<Traveller>(free[0]?.who ?? 'ceo');
  const who = free.some((p) => p.who === who0) ? who0 : free[0]?.who ?? 'ceo';
  const [pick, setPick] = useState<{ fairId?: string; clientId?: string } | null>(null);
  const fairs = useMemo(() => fairsAhead(g), [g, day, store.editCount]); // eslint-disable-line react-hooks/exhaustive-deps
  // The trip's cost for each fair (the free traveller's tickets, pass, hotel and per diem), once a day.
  const costs = useMemo(() => new Map(fairs.map((f) => [f.id, free.length ? tripQuote(g, who, { fairId: f.id }) : null])), [fairs, who, free.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const home = homeMarket(g);
  const groups = useMemo(() => {
    const by = new Map<string, Group>();
    for (const f of fairs) {
      const id = f.market;
      const gr = by.get(id) ?? {
        id, name: id === 'world' ? 'Worldwide' : MARKET_BY_ID[id].name, value: id === 'world' ? null : presenceIn(g, id),
        demand: id === 'world' ? 'Airlines from every continent: better known everywhere a little.' : MARKET_BY_ID[id].demand, fairs: [],
      };
      gr.fairs.push(f);
      by.set(id, gr);
    }
    const order = (x: Group) => (x.id === home ? -1 : x.id === 'world' ? MARKETS.length : MARKETS.findIndex((m) => m.id === x.id));
    return [...by.values()].sort((a, b) => order(a) - order(b));
  }, [fairs, home]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useMemo(() => (pick ? tripQuote(g, who, pick) : null), [g, who, pick, Math.floor(g.now / 60), store.editCount]); // eslint-disable-line react-hooks/exhaustive-deps
  const clients = useMemo(() => Object.values(g.clients).filter((c) => (c.kind === 'airline' || c.kind === 'tourOperator') && !c.rivalId && c.ceased === undefined && AIRPORT_BY_CODE[c.base] && c.base !== g.company.homeBase)
    .sort((a, b) => b.relation - a.relation || a.name.localeCompare(b.name)), [g, day]); // eslint-disable-line react-hooks/exhaustive-deps
  const trips = tripsView(g);
  const book = () => {
    if (!pick) return;
    const r = store.act((gg) => bookTrip(gg, who, pick));
    if (r.ok) setPick(null);
  };
  const goes = free.map((p) => (p.who === 'ceo' ? 'You' : p.name.split(' ')[0])).join(' or ');
  return (
    <div className="v14-markets">
      <div className="col gap-12 v14-mk-side">
        <Presence g={g} />
        <section className="card v14-mk-card">
          <div className="v14-mk-head"><b>Who travels</b></div>
          {people.map((p) => (
            <div key={p.who} className="row gap-8 v14-mk-person">
              <Users className="sc-ico-s dim" />
              <span className="col grow" style={{ minWidth: 0 }}>
                <span className="ellipsis small"><b>{p.name}</b> <span className="muted">· {p.title}</span></span>
                <span className="tiny muted ellipsis">{p.tripId ? tripNow(g, g.com!.trips.find((x) => x.id === p.tripId)!) : 'In the office'}</span>
              </span>
            </div>
          ))}
          {!g.heads?.analyst?.hired && <span className="tiny dim">Hire a commercial analyst (Company › Team) to send a second person.</span>}
        </section>
      </div>
      <div className="col gap-12 v14-mk-main">
        <section className="card v14-mk-card">
          <div className="v14-mk-head">
            <b>Trade fairs</b>
            {free.length > 1
              ? <Seg<Traveller> value={who} onChange={setWho} options={free.map((p) => ({ value: p.who, label: p.who === 'ceo' ? 'You' : p.name.split(' ')[0] }))} />
              : <span className="tiny dim">{free.length ? `${goes} can go` : 'Everyone is away'}</span>}
          </div>
          {groups.map((gr) => (
            <div key={gr.id} className="v14-fair-group">
              <div className="v14-fair-region">
                {gr.id === 'world' ? <Globe2 className="sc-ico-s" /> : gr.id === home ? <Home className="sc-ico-s" /> : null}
                <span className="upper">{gr.name}</span>
                {gr.value !== null && <span className="tiny dim num">{presenceWord(gr.value)} · {Math.round(gr.value)}</span>}
              </div>
              <span className="tiny dim v14-fair-demand">{gr.demand}</span>
              {gr.fairs.map((f) => {
                const c = costs.get(f.id);
                const on = pick?.fairId === f.id;
                return [
                  <button key={f.id} className={`v14-fair ${on ? 'on' : ''}`} onClick={() => setPick(on ? null : { fairId: f.id })} disabled={!!f.tripId || !free.length} aria-pressed={on}>
                    <CalendarDays className="sc-ico-s dim" />
                    <span className="col grow" style={{ minWidth: 0 }}>
                      <b className="ellipsis">{f.name}</b>
                      <span className="small muted ellipsis">{span(f.start, f.end)} · {f.where}</span>
                    </span>
                    <span className="v14-fair-cost small nowrap">
                      {f.tripId ? <span className="accent">Booked</span> : c?.ok ? <b className="num">{money(c.total)}</b> : <span className="dim">pass {money(f.pass)}</span>}
                    </span>
                  </button>,
                  on && q ? <QuoteCard key={`${f.id}-q`} q={q} who={who} onBook={book} onClose={() => setPick(null)} /> : null,
                ];
              })}
            </div>
          ))}
          {!groups.length && <span className="small dim">No fairs in the next months.</span>}
        </section>
        {free.length > 0 && (
          <section className="card v14-mk-card">
            <div className="set-row v14-field">
              <div><b>Visit a client</b><div className="tiny dim">A day at their office: a better relation, maybe work</div></div>
              <select className="select" value={pick?.clientId ?? ''} aria-label="Client to visit" onChange={(e) => setPick(e.target.value ? { clientId: e.target.value } : null)}>
                <option value="">Choose…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{flag(c.country)} {c.name} · {city(c.base)}</option>)}
              </select>
            </div>
            {pick?.clientId && q && <QuoteCard q={q} who={who} onBook={book} onClose={() => setPick(null)} />}
          </section>
        )}
        <section className="card v14-mk-card">
          <div className="v14-mk-head"><b>Trips</b></div>
          {!trips.length && <div className="small dim">No trips yet.</div>}
          {trips.map((t) => (
            <div key={t.id} className={`v14-trip ${t.status}`}>
              <div className="row between gap-8">
                <b className="ellipsis small">{t.who === 'ceo' ? 'You' : t.name.split(' ')[0]} · {tripTitle(t)}</b>
                <span className="tiny muted nowrap">{fmtDay(t.out.std)} – {fmtDay(t.back.sta)}</span>
              </div>
              <span className="tiny muted">{tripNow(g, t)} · {money(t.cost.tickets + t.cost.pass + t.cost.hotel + t.cost.perDiem)}</span>
              {t.status === 'done' && (
                <span className="tiny">
                  Met {t.met?.length ? t.met.map((id) => g.clients[id]?.name).filter(Boolean).join(', ') : 'nobody new'}
                  {t.leads?.length ? ` · ${t.leads.length} lead${t.leads.length > 1 ? 's' : ''}: ${t.leads.map((l) => `${g.clients[l.clientId]?.name} (${l.kind === 'rfp' ? 'invitation to tender' : 'offer'})`).join(', ')}` : ' · no firm leads'}
                  {t.presence?.length ? ` · better known in ${presenceText(t)}` : ''}
                </span>
              )}
              {t.status === 'planned' && g.now < t.out.std && (
                <div className="row end"><button className="btn btn-ghost" onClick={() => store.act((gg) => cancelTrip(gg, t.id))}>Call off</button></div>
              )}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
