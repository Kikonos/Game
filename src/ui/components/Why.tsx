// v0.7.1 the WHY? button (UPDATE-0.7.1.md §10): a red or amber dot with a 44 × 44 hit area wherever a dot stands for
// a problem (Schedule, Fleet, Crew, Contracts, Finance). A tap opens the card behind it (problemAt). It is a span, so
// it can sit inside a row that is itself a button; the tap never reaches the row.

import { problemAt } from '../../engine/problems';
import type { Ref } from '../../engine/core/types';
import { store } from '../store';

export function Why({ refs, tone, label, className }: { refs: Ref | Ref[]; tone?: 'good' | 'warn' | 'bad' | 'info' | 'off' | null; label?: string; className?: string }) {
  const list = Array.isArray(refs) ? refs : [refs];
  const open = (e: { stopPropagation: () => void; preventDefault: () => void }) => {
    e.stopPropagation();
    e.preventDefault();
    const g = store.game;
    if (!g) return;
    for (const r of list) {
      const card = problemAt(g, r);
      if (card) return store.openModal({ kind: 'problem', subject: card.subject });
    }
    store.toast('info', 'Nothing wrong here any more', 'The problem behind this dot has been dealt with.');
  };
  return (
    <span className={`why ${className ?? ''}`} role="button" tabIndex={0} aria-label={label ?? 'Why?'} data-tip={label ?? 'Why? Tap for the story'} onClick={open} onKeyDown={(k) => (k.key === 'Enter' || k.key === ' ') && open(k)}>
      <span className={`sc-dot why-dot ${tone ?? 'bad'}`} aria-hidden>?</span>
    </span>
  );
}
