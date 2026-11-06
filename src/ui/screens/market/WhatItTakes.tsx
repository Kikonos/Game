// v0.17 player addition (UPDATE-0.17.md §T; lane `market-ui`): "What it takes" for a rare type (A380, 747-400/-8, the
// rare A340s, 747 classics), or any type the ladder or the AOC holds back: one line per requirement, met or not, from
// the engine's exoticPath. Never hides a type: it says what is missing.

import { CheckCircle2, CircleDashed, Sparkles } from 'lucide-react';
import type { GameState } from '../../../engine/core/types';
import { exoticPath } from '../../../engine/leasing';
import { tName } from './marketLogic';

export function WhatItTakes({ g, typeId, always }: { g: GameState; typeId: string; always?: boolean }) {
  const p = exoticPath(g, typeId);
  const open = p.steps.filter((s) => !s.ok && s.key !== 'cash' && s.key !== 'source').length;
  if (!p.exotic && !always && !open) return null;
  return (
    <div className="rf-box rf-path">
      <div className="row gap-8"><Sparkles className="sc-ico-s accent" /><b className="small">What it takes{p.exotic ? `: a ${tName(typeId)} is rare` : ''}</b></div>
      {p.exotic && <div className="small muted">Hard and expensive, never impossible: rare types come from specialist lessors and airlines retiring them, or for sale.</div>}
      <ul>
        {p.steps.map((s) => (
          <li key={s.key} className={`small ${s.ok ? 'ok' : 'no'}`}>
            {s.ok ? <CheckCircle2 aria-label="Met" /> : <CircleDashed aria-label="Not yet" />}<span>{s.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
