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
  return (
    <button className="fb-lessor row gap-8 small" onClick={() => store.navigate('fleet', { view: 'market' })} data-tip={gradeWords(r.grade)}>
      <ShieldCheck className="sc-ico-s accent" aria-hidden />
      <span className="grow">
        <b>Lessor rating {r.grade} ({r.score})</b>
        <span className="muted"> · {lc > 0 ? `letters of credit ${money(lc)}${line ? ` of the ${money(line.limit)} line` : ''}` : line && !line.frozen && (r.grade === 'A' || r.grade === 'B') ? 'deposits can be letters of credit on the line' : 'lessors set our deposits by it'}</span>
      </span>
      <ChevronRight className="sc-ico-s dim" aria-hidden />
    </button>
  );
}
