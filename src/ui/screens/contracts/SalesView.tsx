// v0.16 Contracts › Sales (UPDATE-0.16.md §C; lane sales): the leads pipeline (send a proposal, drop, open the offer
// under negotiation; days left), the brokers (relation, register, a visit) and the pre-season pitches (the window,
// who to pitch, the answers due). Every row three lines at most.
// v0.16.3 Sales lives under Contracts › Market as the Leads segment (Offers · Leads · Tenders): the pipeline on top,
// one tap to send a proposal, and the sales desk (brokers, pitches, sales managers) folded away under it.

import { Briefcase, ChevronDown, ChevronRight, Handshake, Megaphone, Send, Users } from 'lucide-react';
import { useEffect } from 'react';
import { useMemo, useState } from 'react';
import { salesRepsView } from '../../../engine/commercial';
import { DAY } from '../../../engine/core/time';
import { flag } from '../../../data/countries';
import {
  brokerView, dropLead, leadsView, pitchAirline, pitchTargets, pitchesView, registerBroker, salesDesk, visitBroker, workLead, type BrokerView, type LeadView,
} from '../../../engine/commercial';
import { fmtDay } from '../../../engine/core/time';
import type { GameState } from '../../../engine/core/types';
import { Bar, Empty } from '../../components/ui';
import { money } from '../../format';
import { store } from '../../store';
import { BodyTag } from '../../components/ShapeTags';
import { Seg } from '../../components/ui';

const pct = (x: number) => `${Math.round(x * 1000) / 10} %`;
const usdK = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1e3)}K`);

/** Leads waiting for a proposal (the segment's count). Pure. */
export const salesTabCount = (g: GameState): number => (g.com?.leads ?? []).filter((l) => l.stage === 'lead').length;
/** v0.16.3 leads going cold within three days (the segment's count turns amber). Pure. */
export const leadsUrgent = (g: GameState): number => (g.com?.leads ?? []).filter((l) => l.stage === 'lead' && l.expires - g.now <= 3 * DAY).length;

/** The right-hand words of a lead row: what happens next and when. */
function nextLine(l: LeadView): { text: string; tone: string } {
  const d = l.daysLeft;
  if (l.stage === 'lead') return { text: d <= 0 ? 'Goes cold today' : `Goes cold in ${d} day${d === 1 ? '' : 's'}`, tone: d <= 3 ? 'warn' : 'muted' };
  if (l.stage === 'proposal') return { text: d <= 0 ? 'Answer due' : `Answer in ${d} d`, tone: 'muted' };
  if (l.stage === 'negotiation') return { text: l.offerOpen ? `Answer by ${fmtDay(l.expires)}` : 'Offer closed', tone: 'accent' };
  return { text: fmtDay(l.moved), tone: 'dim' };
}

function LeadRow({ l, on }: { l: LeadView; on: boolean }) {
  const done = l.stage === 'signed' || l.stage === 'lost' || l.stage === 'cold';
  const next = nextLine(l);
  const drop = () => store.openModal({ kind: 'confirm', title: `Drop the ${l.clientName} lead?`, body: `${l.title ?? 'The job'}, about ${usdK(l.value)}. Nothing else is lost.`, confirm: 'Drop', danger: true, onConfirm: () => store.act((g) => dropLead(g, l.id)) });
  return (
    <div className={`v16s-row ${on ? 'on' : ''} ${done ? 'done' : ''}`} data-lead={l.id}>
      <span className="col grow" style={{ minWidth: 0, gap: 2 }}>
        <span className="row gap-6 v16s-head" style={{ minWidth: 0, alignItems: 'center' }}>
          <b className="ellipsis">{flag(l.country)} {l.clientName} <span className={`chip v16s-chip ${l.stage === 'signed' ? 'good' : l.stage === 'negotiation' ? 'accent' : l.stage === 'lost' || l.stage === 'cold' ? 'warn' : ''}`}>{l.stageName}</span></b>
          {l.shown && <BodyTag body={l.shown} />}
        </span>
        <span className="small muted ellipsis">{l.title ?? 'A job'} · about {usdK(l.value)} · {l.sourceName}</span>
        {done && l.why ? <span className="small dim ellipsis">{l.why}</span> : <span className={`small ${next.tone}`}>{next.text}</span>}
      </span>
      {!done && (
        <span className="v16s-acts">
          {l.stage === 'lead' && <button className="btn btn-primary" onClick={() => store.act((g) => workLead(g, l.id))}><Send /> Send proposal</button>}
          {l.stage === 'negotiation' && l.offerOpen && l.offerId && <button className="btn btn-primary" onClick={() => store.openModal({ kind: 'offer', offerId: l.offerId! })}>Open offer</button>}
          {(l.stage === 'lead' || l.stage === 'proposal') && <button className="btn btn-ghost" onClick={drop} aria-label="Drop the lead">Drop</button>}
        </span>
      )}
    </div>
  );
}

function BrokerRow({ b }: { b: BrokerView }) {
  const rel = b.rel;
  return (
    <div className="v16s-row">
      <span className="col grow" style={{ minWidth: 0, gap: 2 }}>
        <b className="ellipsis">{b.name} <span className="chip v16s-chip">{pct(b.commission)} commission</span></b>
        <span className="small muted v16s-focus">{b.focus}</span>
        {rel ? (
          <span className="row gap-8 small" style={{ alignItems: 'center' }}>
            <span className="v16s-bar"><Bar value={rel.relation / 100} size="thin" tone="good" title={`Relation ${rel.relation}`} /></span>
            <span className="muted nowrap ellipsis">relation {rel.relation} · about {b.leadsPerMonth} lead{b.leadsPerMonth === 1 ? '' : 's'} a month · {rel.deals} deal{rel.deals === 1 ? '' : 's'}</span>
          </span>
        ) : (
          <span className="small dim">Not registered: they do not know us</span>
        )}
      </span>
      <span className="v16s-acts">
        {!rel && <button className="btn btn-primary" onClick={() => store.act((g) => registerBroker(g, b.id))}>Register</button>}
        {rel && <button className="btn" disabled={!b.canVisit} title={b.canVisit ? 'A day at their office: +5 relation' : 'Once a month'} onClick={() => store.act((g) => visitBroker(g, b.id))}>Visit · {money(b.visitCost)}</button>}
      </span>
    </div>
  );
}

function Pitches({ g }: { g: GameState }) {
  const desk = salesDesk(g);
  const targets = pitchTargets(g).filter((t) => !t.pitched);
  const made = pitchesView(g);
  const [pick, setPick] = useState('');
  const chosen = targets.find((t) => t.client.id === pick) ?? targets[0];
  // v0.19.4 a narrowbody or a widebody, when we could offer them either.
  const [bodyPick, setBody] = useState<'narrow' | 'wide' | null>(null);
  const body = chosen && bodyPick && chosen.bodies.includes(bodyPick) ? bodyPick : chosen?.body ?? 'narrow';
  const w = desk.window;
  const quotaFull = desk.pitches.used >= desk.pitches.max;
  return (
    <section className="card v16s-card col gap-8">
      <div className="row between" style={{ alignItems: 'baseline' }}>
        <b className="row gap-6" style={{ alignItems: 'center' }}><Megaphone className="sc-ico-s" /> Pre-season pitches</b>
        {w && <span className="small muted">{desk.pitches.used} of {desk.pitches.max} this season</span>}
      </div>
      {w ? (
        <>
          <div className="small muted">Pitch an airline now for {w.label} cover (window closes {fmtDay(w.until - 1)}). A visit costs {money(1_500)}, free when we met them lately; the answer comes in 2–6 weeks.</div>
          {targets.length ? (
            <div className="v16s-pitch-form">
              <select className="select" value={chosen?.client.id ?? ''} aria-label="Airline to pitch" onChange={(e) => setPick(e.target.value)}>
                {targets.map((t) => <option key={t.client.id} value={t.client.id}>{t.client.name}{t.stretch ? ' · more stars than yours' : ''}{t.cost ? '' : ' · free'}</option>)}
              </select>
              {chosen && chosen.bodies.length > 1 ? (
                <Seg<'narrow' | 'wide'> value={body} onChange={setBody} options={[{ value: 'narrow', label: 'Narrowbody' }, { value: 'wide', label: 'Widebody' }]} />
              ) : chosen ? <BodyTag body={body} /> : null}
              <button className="btn btn-primary" disabled={!chosen || quotaFull} onClick={() => chosen && store.act((g) => pitchAirline(g, chosen.client.id, body))}>
                Pitch{chosen && chosen.cost ? ` · ${money(chosen.cost)}` : ''}
              </button>
            </div>
          ) : (
            <div className="small dim">No airline left to pitch at your level this season.</div>
          )}
        </>
      ) : (
        <div className="small muted">Pitch airlines for summer cover from October to February, for winter cover from April to August. That is when they plan their seasons.</div>
      )}
      {made.length > 0 && (
        <div className="v16s-list">
          {made.slice(0, 12).map((p) => (
            <div key={p.id} className="v16s-row v16s-row-s">
              <span className="col grow" style={{ minWidth: 0, gap: 2 }}>
                <span className="row gap-6 v16s-head" style={{ minWidth: 0, alignItems: 'center' }}>
                  <b className="ellipsis">{flag(p.country)} {p.clientName} <span className="small muted">· {p.seasonLabel}</span></b>
                  {p.shown && <BodyTag body={p.shown} />}
                </span>
                <span className={`small ${p.tone === 'good' ? 'good' : p.tone === 'warn' ? 'dim' : 'muted'}`}>{p.status}</span>
              </span>
              <span className="small dim nowrap">{fmtDay(p.at)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** v0.16.3 the sales desk, folded under the pipeline: brokers, pitches and the sales managers (hired in Team). */
function SalesDesk({ g, brokers }: { g: GameState; brokers: BrokerView[] }) {
  const [open, setOpen] = useState(() => { try { return sessionStorage.getItem('bh:salesDesk') === '1'; } catch { return false; } });
  const toggle = () => { setOpen(!open); try { sessionStorage.setItem('bh:salesDesk', open ? '0' : '1'); } catch { /* private window */ } };
  const desk = salesDesk(g);
  const reps = salesRepsView(g);
  const w = desk.window;
  const summary = `${desk.registered} of 5 brokers · ${w ? `${desk.pitches.used} of ${desk.pitches.max} pitches this season` : 'no pitch window now'} · ${desk.repsJoined ? `${desk.repsJoined} sales manager${desk.repsJoined === 1 ? '' : 's'}` : 'no sales manager'}`;
  return (
    <section className="col gap-0">
      <button className="mh-desk" onClick={toggle} aria-expanded={open} aria-label="Sales desk">
        {open ? <ChevronDown className="sc-ico-s dim" /> : <ChevronRight className="sc-ico-s dim" />}
        <span className="col grow mh-desk-t" style={{ gap: 2 }}>
          <b className="row gap-6" style={{ alignItems: 'center' }}><Briefcase className="sc-ico-s" /> Sales desk</b>
          <span className="small muted ellipsis">{summary}</span>
        </span>
        <span className="small dim nowrap">{desk.worked} of {desk.cap} proposals in work</span>
      </button>
      {open && (
        <div className="v16s-sales mh-desk-body">
          <div className="col gap-12">
            <section className="card v16s-card col gap-8">
              <div className="row between" style={{ alignItems: 'baseline' }}>
                <b className="row gap-6" style={{ alignItems: 'center' }}><Briefcase className="sc-ico-s" /> Brokers</b>
                <span className="small muted v16s-hint">leads on busy days; their cut on each deal</span>
              </div>
              <div className="v16s-list">{brokers.map((b) => <BrokerRow key={b.id} b={b} />)}</div>
            </section>
          </div>
          <div className="col gap-12">
            <Pitches g={g} />
            <section className="card v16s-card col gap-8">
              <div className="row between" style={{ alignItems: 'baseline' }}>
                <b className="row gap-6" style={{ alignItems: 'center' }}><Users className="sc-ico-s" /> Sales managers</b>
                <button className="btn btn-sm" onClick={() => store.navigate('company', { view: 'team' })}>Team</button>
              </div>
              {reps.length ? (
                <div className="v16s-list">{reps.map((r) => (
                  <div key={r.id} className="v16s-row v16s-row-s">
                    <span className="col grow" style={{ minWidth: 0, gap: 2 }}>
                      <b className="ellipsis">{r.name} <span className="small muted">· {r.marketName}</span></b>
                      <span className="small muted ellipsis">{r.status}</span>
                    </span>
                  </div>
                ))}</div>
              ) : (
                <div className="small muted">None yet. A regional sales manager (hired in Company › Team) brings leads from their market and works more proposals at once.</div>
              )}
            </section>
          </div>
        </div>
      )}
    </section>
  );
}

/** v0.16.3 Contracts › Market › Leads: the pipeline first (one tap sends a proposal), the sales desk folded under it. */
export function LeadsView({ g }: { g: GameState }) {
  const day = Math.floor(g.now / 1440);
  const leads = useMemo(() => leadsView(g), [g, day, store.editCount, g.com?.leads?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const brokers = useMemo(() => brokerView(g), [g, day, store.editCount]); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = store.nav.sel?.kind === 'lead' ? store.nav.sel.id : null;
  // A deep link from the Inbox (a lead going cold) scrolls to its row.
  useEffect(() => {
    if (sel) document.querySelector(`.v16s-row[data-lead="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);
  const live = leads.filter((l) => l.stage === 'lead' || l.stage === 'proposal' || l.stage === 'negotiation');
  // Soonest to go cold first; then proposals and offers on the market.
  const order = (l: LeadView) => (l.stage === 'lead' ? 0 : l.stage === 'negotiation' ? 1 : 2);
  live.sort((a, b) => order(a) - order(b) || a.daysLeft - b.daysLeft);
  const past = leads.filter((l) => !(l.stage === 'lead' || l.stage === 'proposal' || l.stage === 'negotiation')).slice(0, 6);
  const waiting = live.filter((l) => l.stage === 'lead').length;
  return (
    <div className="col gap-12 v16s-sales-wrap">
      <section className="card v16s-card col gap-8">
        <div className="row between" style={{ alignItems: 'baseline' }}>
          <b className="row gap-6" style={{ alignItems: 'center' }}><Handshake className="sc-ico-s" /> Leads{waiting ? <span className="small muted">· {waiting} waiting for a proposal</span> : null}</b>
          <span className="small muted v16s-hint">lead → proposal → offer → signed</span>
        </div>
        {!live.length && !past.length && (
          <Empty icon={<Handshake />} title="No leads yet">
            Register with a broker (below), go to a fair or visit a client (Markets tab), pitch an airline before the season. A lead waits 14 days for your proposal, then goes cold.
          </Empty>
        )}
        {live.length > 0 && <div className="v16s-list">{live.map((l) => <LeadRow key={l.id} l={l} on={l.id === sel} />)}</div>}
        {past.length > 0 && (
          <>
            <div className="upper dim" style={{ marginTop: 4 }}>Closed lately</div>
            <div className="v16s-list">{past.map((l) => <LeadRow key={l.id} l={l} on={l.id === sel} />)}</div>
          </>
        )}
      </section>
      <SalesDesk g={g} brokers={brokers} />
    </div>
  );
}
