// v0.17 Finance › The bank (UPDATE-0.17.md §K.1, §N.1; lane `market-ui`): one line "Lessor rating B (63) · letters of
// credit $450K of the line"; tap: Fleet › Market, where Why? lists the rating's parts.

import { ChevronRight, ShieldCheck } from 'lucide-react';
import { BAL } from '../../../engine/core/balance';
import type { GameState } from '../../../engine/core/types';
import { gradeWords, lcInUse, rating } from '../../../engine/leasing';
import { money } from '../../format';
import { store } from '../../store';

export function LessorRating({ g }: { g: GameState }) {
  if (!BAL.v017.on || !g.leasing) return null;
  const r = rating(g);
  const lc = lcInUse(g);
  const line = g.treasury?.credit;
  // v0.20.1 a bank row like the others (Financing.tsx BankRow): name and a plain line, the grade on the right.
  return (
    <div className="fb-row">
      <div className="fb-line">
        <button className="fb-tap fb-lessor" onClick={() => store.navigate('fleet', { view: 'market' })} data-tip={gradeWords(r.grade)}>
          <span className="fb-ico" aria-hidden><ShieldCheck /></span>
          <span className="fb-name"><b>Lessor rating</b><span className="small muted">{lc > 0 ? `Letters of credit ${money(lc)}${line ? ` of the ${money(line.limit)} line` : ''}` : line && !line.frozen && (r.grade === 'A' || r.grade === 'B') ? 'Deposits can be letters of credit on the line' : 'Lessors set our deposits by it'}</span></span>
          <span className="num fb-val">{r.grade} <span className="dim">({r.score})</span></span>
          <ChevronRight className="fb-chev" aria-hidden />
        </button>
      </div>
    </div>
  );
}
