// v0.14 Contracts › Tenders: the tender board. Open RFPs (deadline first, a Bid button), my bids waiting for the
// award, and the results (won / lost to whom and why / no bid). A row opens the bid form (modals/TenderModal.tsx).

import { CalendarClock, FileSignature, Gavel, Trophy } from 'lucide-react';
import { useMemo } from 'react';
import { flag } from '../../data/countries';
import { roundAt, roundName, tenderBoard, type TenderRow } from '../../engine/commercial';
import { DAY, fmtDay, fmtDayAt, toDate, toLocal } from '../../engine/core/time';
import type { GameState } from '../../engine/core/types';
import { Empty } from '../components/ui';
import { store } from '../store';
import { lockOf } from '../../engine/scenario';
import { LockedPanel } from '../components/Locked';
import { BodyTag, KindTag } from '../components/ShapeTags';
import { Help } from '../components/Help';

const days = (t: number, now: number) => Math.max(0, Math.ceil((t - now) / DAY));
/** v0.20.1 the contest in facts: who else bids, when bids close, when the airline decides. */
export const tenderFacts = (t: Pick<TenderRow, 'rivals' | 'deadline' | 'resultAt' | 'status'>): string => {
  const who = t.rivals ? `${t.rivals} other operator${t.rivals === 1 ? '' : 's'}` : 'No other operator';
  return t.status === 'open' ? `${who} bidding · bids close ${fmtDay(t.deadline)} · award ${fmtDay(t.resultAt)}` : `${who} bid · award ${fmtDay(t.resultAt)}`;
};
// v0.14.1 the programme's days on the base's local calendar (it starts at local midnight: the evening before in UTC),
// as the airline's own text says them.
const span = (t: TenderRow) => `${fmtDayAt(t.base, t.start)} – ${fmtDayAt(t.base, t.end - 1)} ${toDate(toLocal(t.base, t.start)).getUTCFullYear()}`;

/** The season line: the round open now, or when the next one opens. */
export function seasonLine(now: number): string {
  const r = roundAt(now);
  if (r) return `${r.kind === 'summer' ? 'Summer' : 'Winter'} tender season: airlines ask for ${roundName(r.key)} capacity until ${fmtDay(r.until - 1)}.`;
  const d = toDate(now);
  const mo = d.getUTCMonth();
  return mo >= 2 && mo <= 4 ? 'Next round: winter capacity, June to August.' : 'Next round: summer capacity, November to February.';
}

function Row({ g, t, kind }: { g: GameState; t: TenderRow; kind: 'open' | 'mine' | 'result' }) {
  const open = () => store.openModal({ kind: 'tender', tenderId: t.id });
  const left = days(t.deadline, g.now);
  return (
    <button className={`v14-tn-row ${t.status}`} onClick={open} aria-label={`${t.client} tender`}>
      <span className="v14-tn-ico">{kind === 'result' ? (t.status === 'won' ? <Trophy /> : <Gavel />) : kind === 'mine' ? <CalendarClock /> : <FileSignature />}</span>
      <span className="col grow" style={{ minWidth: 0, gap: 2 }}>
        <span className="row gap-6 v14-tn-head" style={{ minWidth: 0, alignItems: 'center' }}>
          <b className="ellipsis">{flag(t.country)} {t.client}{t.invited && <span className="chip v14-chip">Invitation</span>}</b>
          {kind === 'open' && <KindTag kind="tender" />}
          <BodyTag body={t.body} />
        </span>
        <span className="small muted ellipsis">{t.round !== roundName(t.roundKey) ? `${t.round} · ` : ''}{t.base}{t.kind === 'hajj' ? '–JED/MED' : ''} · {span(t)} · {t.wanted}</span>
        {kind !== 'result' && <span className="small muted ellipsis v0201-facts">{tenderFacts(t)}</span>}
        {kind === 'result' && t.result && (
          <span className={`small ellipsis ${t.status === 'won' ? 'good' : 'warn'}`}>{t.status === 'won' ? `Won: ${t.result.why}` : `${t.result.winnerName}: ${t.result.why}`}</span>
        )}
        {kind === 'result' && t.status === 'noBid' && <span className="small dim">You did not bid</span>}
        {kind === 'result' && t.status === 'withdrawn' && <span className="small dim">Withdrawn: the airline no longer flies{t.bid ? ' (our bid with it)' : ''}</span>}
        {t.bid && kind !== 'result' && <span className="small accent ellipsis">Your bid: ${t.bid.rate.toLocaleString('en-US')}/BH · MGH {t.bid.mgh} · {t.bid.reg}</span>}
      </span>
      <span className="right small nowrap">
        {kind === 'open' && <span className={`num ${left <= 3 ? 'warn' : 'muted'}`}>{left ? `closes in ${left} d` : 'closes today'}</span>}
        {kind === 'mine' && <span className="muted">award in {days(t.resultAt, g.now)} d</span>}
        {kind === 'result' && <span className={t.status === 'won' ? 'good' : t.status === 'lost' ? 'warn' : 'dim'}>{t.status === 'won' ? 'Won' : t.status === 'lost' ? 'Lost' : t.status === 'withdrawn' ? 'Withdrawn' : 'No bid'}</span>}
        {kind === 'open' && !t.bid && <span className="btn btn-primary v14-bid-btn">Bid</span>}
      </span>
    </button>
  );
}

export function TendersView({ g }: { g: GameState }) {
  const day = Math.floor(g.now / DAY);
  const b = useMemo(() => tenderBoard(g), [g, day, store.editCount, g.com?.tenders.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const none = !b.open.length && !b.mine.length && !b.results.length;
  // v0.15 no tenders in a scenario: a calm notice instead of the board.
  const lock = lockOf(g, 'tenders');
  if (lock) return <LockedPanel title="Tender board closed" why={lock}>No requests for proposals come in while the scenario runs.</LockedPanel>;
  return (
    <div className="col gap-12 v14-tenders">
      {/* v0.22 the season line is a status and stays; how a tender works sits behind its '?'. */}
      <div className="small muted v14-season">{seasonLine(g.now)} <Help title="Tenders">
        <p>Airlines send requests for proposals: for next summer from November to February, for next winter from June to August.</p>
        <p>Your bid: a rate per block hour, an MGH, an aircraft, the crew and the dates. The award is decided on price, reliability, relationship, aircraft age and fit.</p>
        <p>With Widebody operations and a widebody, widebody requests come too: Hajj and Umrah lift, long-haul leisure cover.</p>
      </Help></div>
      {none && <Empty icon={<FileSignature />} title="No tenders yet" />}
      {b.open.length > 0 && (
        <section className="col gap-4">
          <div className="upper dim">Open requests</div>
          <div className="card v14-list">{b.open.filter((t) => !t.bid).concat(b.open.filter((t) => !!t.bid)).map((t) => <Row key={t.id} g={g} t={t} kind="open" />)}</div>
        </section>
      )}
      {b.mine.filter((t) => t.status === 'closed').length > 0 && (
        <section className="col gap-4">
          <div className="upper dim">My bids: waiting for the award</div>
          <div className="card v14-list">{b.mine.filter((t) => t.status === 'closed').map((t) => <Row key={t.id} g={g} t={t} kind="mine" />)}</div>
        </section>
      )}
      {b.results.length > 0 && (
        <section className="col gap-4">
          <div className="upper dim">Results</div>
          <div className="card v14-list">{b.results.map((t) => <Row key={t.id} g={g} t={t} kind="result" />)}</div>
        </section>
      )}
    </div>
  );
}

/** Tenders open to bid on (the tab's count). */
export const openTenders = (g: GameState): number => (g.com?.tenders ?? []).filter((t) => t.status === 'open' && !t.bid).length;
