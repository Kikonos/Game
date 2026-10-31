// v0.14 Contracts › Tenders: the tender board. Open RFPs (deadline first, a Bid button), my bids waiting for the
// award, and the results (won / lost to whom and why / no bid). A row opens the bid form (modals/TenderModal.tsx).

import { CalendarClock, FileSignature, Gavel, Trophy } from 'lucide-react';
import { useMemo } from 'react';
import { flag } from '../../data/countries';
import { roundAt, roundName, tenderBoard, type TenderRow } from '../../engine/commercial';
import { DAY, fmtDay } from '../../engine/core/time';
import type { GameState } from '../../engine/core/types';
import { Empty } from '../components/ui';
import { money } from '../format';
import { store } from '../store';

const days = (t: number, now: number) => Math.max(0, Math.ceil((t - now) / DAY));
const window = (t: TenderRow) => `${fmtDay(t.start)} – ${fmtDay(t.end - 1)}`;

/** The season line: the round open now, or when the next one opens. */
export function seasonLine(now: number): string {
  const r = roundAt(now);
  if (r) return `${r.kind === 'summer' ? 'Summer' : 'Winter'} tender season: airlines ask for ${roundName(r.key)} capacity until ${fmtDay(r.until - 1)}.`;
  const d = new Date(Date.UTC(2000, 0, 1) + now * 60_000);
  const mo = d.getUTCMonth();
  return mo >= 2 && mo <= 4 ? 'Next round: winter capacity, June to August.' : 'Next round: summer capacity, November to February.';
}

function Row({ g, t, kind }: { g: GameState; t: TenderRow; kind: 'open' | 'mine' | 'result' }) {
  const open = () => store.openModal({ kind: 'tender', tenderId: t.id });
  const left = days(t.deadline, g.now);
  return (
    <button className={`sc-list-row v14-tn-row ${t.status}`} onClick={open} aria-label={`${t.client} tender`}>
      <span className="v14-tn-ico">{kind === 'result' ? (t.status === 'won' ? <Trophy /> : <Gavel />) : kind === 'mine' ? <CalendarClock /> : <FileSignature />}</span>
      <span className="col grow" style={{ minWidth: 0, gap: 2 }}>
        <b className="ellipsis">{flag(t.country)} {t.client}{t.invited && <span className="chip v14-chip">Invitation</span>}</b>
        <span className="small muted ellipsis">{t.base} · {window(t)} · {t.wanted}</span>
        {kind === 'result' && t.result && (
          <span className={`small ellipsis ${t.status === 'won' ? 'good' : 'warn'}`}>{t.status === 'won' ? `Won: ${t.result.why}` : `${t.result.winnerName}: ${t.result.why}`}</span>
        )}
        {kind === 'result' && t.status === 'noBid' && <span className="small dim">You did not bid</span>}
        {t.bid && kind !== 'result' && <span className="small accent ellipsis">Your bid: {money(t.bid.rate)}/BH · MGH {t.bid.mgh} · {t.bid.reg}</span>}
      </span>
      <span className="right small nowrap">
        {kind === 'open' && <span className={`num ${left <= 3 ? 'warn' : 'muted'}`}>{left ? `closes in ${left} d` : 'closes today'}</span>}
        {kind === 'mine' && <span className="muted">result about {fmtDay(t.resultAt)}</span>}
        {kind === 'result' && <span className={t.status === 'won' ? 'good' : t.status === 'lost' ? 'warn' : 'dim'}>{t.status === 'won' ? 'Won' : t.status === 'lost' ? 'Lost' : 'No bid'}</span>}
        {kind === 'open' && !t.bid && <span className="btn btn-primary v14-bid-btn">Bid</span>}
      </span>
    </button>
  );
}

export function TendersView({ g }: { g: GameState }) {
  const day = Math.floor(g.now / DAY);
  const b = useMemo(() => tenderBoard(g), [g, day, store.editCount, g.com?.tenders.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const none = !b.open.length && !b.mine.length && !b.results.length;
  return (
    <div className="col gap-12 v14-tenders">
      <div className="small muted v14-season">{seasonLine(g.now)} Decided on price, reliability, relationship, aircraft age and fit.</div>
      {none && (
        <Empty icon={<FileSignature />} title="No tenders yet">
          Airlines send requests for proposals for next summer from November to February. Your bid: a rate per block hour, an MGH, an aircraft, the crew and the dates.
        </Empty>
      )}
      {b.open.length > 0 && (
        <section className="col gap-4">
          <div className="upper dim">Open requests</div>
          <div className="card sc-list">{b.open.filter((t) => !t.bid).concat(b.open.filter((t) => !!t.bid)).map((t) => <Row key={t.id} g={g} t={t} kind="open" />)}</div>
        </section>
      )}
      {b.mine.filter((t) => t.status === 'closed').length > 0 && (
        <section className="col gap-4">
          <div className="upper dim">My bids: waiting for the award</div>
          <div className="card sc-list">{b.mine.filter((t) => t.status === 'closed').map((t) => <Row key={t.id} g={g} t={t} kind="mine" />)}</div>
        </section>
      )}
      {b.results.length > 0 && (
        <section className="col gap-4">
          <div className="upper dim">Results</div>
          <div className="card sc-list">{b.results.map((t) => <Row key={t.id} g={g} t={t} kind="result" />)}</div>
        </section>
      )}
    </div>
  );
}

/** Tenders open to bid on (the tab's count). */
export const openTenders = (g: GameState): number => (g.com?.tenders ?? []).filter((t) => t.status === 'open' && !t.bid).length;
