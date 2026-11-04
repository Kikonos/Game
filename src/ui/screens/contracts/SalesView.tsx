// v0.16 Contracts › Sales (UPDATE-0.16.md §C; lane sales): the leads pipeline (send a proposal, drop, open the offer
// under negotiation; days left), the brokers (relation, register, a visit) and the pre-season pitches (the window,
// who to pitch, the answers due). Two columns on an iPad, one on a phone; every row three lines at most.

import { Briefcase, Handshake, Megaphone, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { flag } from '../../../data/countries';
import {
  brokerView, dropLead, leadsView, pitchAirline, pitchTargets, pitchesView, registerBroker, salesDesk, visitBroker, workLead, type BrokerView, type LeadView,
} from '../../../engine/commercial';
import { fmtDay } from '../../../engine/core/time';
import type { GameState } from '../../../engine/core/types';
import { Bar, Empty } from '../../components/ui';
import { money } from '../../format';
import { store } from '../../store';

const pct = (x: number) => `${Math.round(x * 100)} %`;
const usdK = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1e3)}K`);

/** Leads waiting for a proposal (the tab's count). Pure. */
export const salesTabCount = (g: GameState): number => (g.com?.leads ?? []).filter((l) => l.stage === 'lead').length;

/** The right-hand words of a lead row: what happens next and when. */
function nextLine(l: LeadView): { text: string; tone: string } {
  const d = l.daysLeft;
  if (l.stage === 'lead') return { text: d <= 0 ? 'Goes cold today' : `Cold in ${d} d`, tone: d <= 3 ? 'warn' : 'muted' };
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
        <b className="ellipsis">{flag(l.country)} {l.clientName} <span className={`chip v16s-chip ${l.stage === 'signed' ? 'good' : l.stage === 'negotiation' ? 'accent' : l.stage === 'lost' || l.stage === 'cold' ? 'warn' : ''}`}>{l.stageName}</span></b>
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
        <span className="small muted ellipsis">{b.focus}</span>
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
                {targets.map((t) => <option key={t.client.id} value={t.client.id}>{t.client.name}{t.stretch ? ' · one level up' : ''}{t.cost ? '' : ' · free'}</option>)}
              </select>
              <button className="btn btn-primary" disabled={!chosen || quotaFull} onClick={() => chosen && store.act((g) => pitchAirline(g, chosen.client.id))}>
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
                <b className="ellipsis">{flag(p.country)} {p.clientName} <span className="small muted">· {p.seasonLabel}</span></b>
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

export function SalesView({ g }: { g: GameState }) {
  const day = Math.floor(g.now / 1440);
  const leads = useMemo(() => leadsView(g), [g, day, store.editCount, g.com?.leads?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const brokers = useMemo(() => brokerView(g), [g, day, store.editCount]); // eslint-disable-line react-hooks/exhaustive-deps
  const desk = salesDesk(g);
  const sel = store.nav.sel?.kind === 'lead' ? store.nav.sel.id : null;
  const liveLeads = leads.filter((l) => l.stage === 'lead' || l.stage === 'proposal' || l.stage === 'negotiation');
  const past = leads.filter((l) => !(l.stage === 'lead' || l.stage === 'proposal' || l.stage === 'negotiation')).slice(0, 8);
  return (
    <div className="col gap-12 v16s-sales-wrap">
      <div className="small muted v16s-desk">
        Your sales desk: {desk.worked} of {desk.cap} proposals in work{desk.repsJoined ? ` · ${desk.repsJoined} sales manager${desk.repsJoined === 1 ? '' : 's'}` : ''} · registered with {desk.registered} of 5 brokers.
        About half the work finds you; the rest you chase here: brokers, fairs and visits (Markets tab), pitches, sales managers (Company › Team).
      </div>
      <div className="v16s-sales">
        <div className="col gap-12">
          <section className="card v16s-card col gap-8">
            <div className="row between" style={{ alignItems: 'baseline' }}>
              <b className="row gap-6" style={{ alignItems: 'center' }}><Handshake className="sc-ico-s" /> Leads pipeline</b>
              <span className="small muted">lead → proposal → offer → signed</span>
            </div>
            {!liveLeads.length && !past.length && (
              <Empty icon={<Handshake />} title="No leads yet">
                Register with a broker, go to a fair or visit a client (Markets tab), pitch an airline before the season. A lead waits 14 days for your proposal, then goes cold.
              </Empty>
            )}
            {liveLeads.length > 0 && <div className="v16s-list">{liveLeads.map((l) => <LeadRow key={l.id} l={l} on={l.id === sel} />)}</div>}
            {past.length > 0 && (
              <>
                <div className="upper dim" style={{ marginTop: 4 }}>Closed lately</div>
                <div className="v16s-list">{past.map((l) => <LeadRow key={l.id} l={l} on={l.id === sel} />)}</div>
              </>
            )}
          </section>
        </div>
        <div className="col gap-12">
          <section className="card v16s-card col gap-8">
            <div className="row between" style={{ alignItems: 'baseline' }}>
              <b className="row gap-6" style={{ alignItems: 'center' }}><Briefcase className="sc-ico-s" /> Brokers</b>
              <span className="small muted">leads on busy days; their cut on each deal</span>
            </div>
            <div className="v16s-list">{brokers.map((b) => <BrokerRow key={b.id} b={b} />)}</div>
          </section>
          <Pitches g={g} />
        </div>
      </div>
    </div>
  );
}
