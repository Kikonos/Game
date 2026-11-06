// v0.17 Fleet › Market (UPDATE-0.17.md §N.1; lane `market-ui`): the header line 'Lessor rating C · start-up · deposit
// 3 months · Why?' with the two buttons on the right (Ask lessors…, Short-term…). Why? opens the score's parts, one
// line each with its points.

import { CalendarClock, ChevronDown, ChevronUp, FileSignature, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { BAL } from '../../../engine/core/balance';
import type { GameState } from '../../../engine/core/types';
import { depositMonthsFor, gradeWords, rating } from '../../../engine/leasing';
import { lockOf } from '../../../engine/scenario';
import { store } from '../../store';
import { ratingLine, ratingParts } from './marketLogic';

export function RatingLine({ g }: { g: GameState }) {
  const [why, setWhy] = useState(false);
  if (!g.leasing || !BAL.v017.on) return null;
  const r = rating(g);
  const parts = ratingParts(r);
  const lock = lockOf(g, 'fleet');
  return (
    <div className={`card mk17-rating grade-${r.grade}`}>
      <div className="row gap-12 mk17-rating-row">
        <ShieldCheck className="sc-ico accent" aria-hidden />
        <span className="grow mk17-rating-text">
          <b>{ratingLine(r, depositMonthsFor(r))}</b>
          <button className="btn btn-ghost btn-sm mk17-why" aria-expanded={why} onClick={() => setWhy(!why)}>Why?{why ? <ChevronUp /> : <ChevronDown />}</button>
        </span>
        {!lock && (
          <span className="row gap-8 mk17-asks">
            <button className="btn" onClick={() => store.openModal({ kind: 'spot' })}><CalendarClock /> Short-term…</button>
            <button className="btn btn-primary" onClick={() => store.openModal({ kind: 'rfp' })}><FileSignature /> Ask lessors…</button>
          </span>
        )}
      </div>
      {why && (
        <div className="mk17-why-box">
          <div className="small muted mb-8">{gradeWords(r.grade)}. Score {r.score} of 100: A from 75, B from 55, C from 35. Lessors check it again at their credit committee.</div>
          <div className="mk17-parts">
            {parts.map((p) => (
              <div key={p.label} className="row gap-8 small">
                <span className="grow">{p.label}</span>
                <b className={`num ${p.tone}`}>{p.pts}</b>
              </div>
            ))}
            <div className="row gap-8 small mk17-parts-sum"><span className="grow">Starting score</span><b className="num">{BAL.v017.credit.base}</b></div>
          </div>
        </div>
      )}
    </div>
  );
}
