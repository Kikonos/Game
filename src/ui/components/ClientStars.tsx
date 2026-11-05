// v0.16.1 a client's star rating, 0–5 (contracts/prestige.ts clientStars): filled and empty stars, one accessible
// label ('3 of 5 stars'). The engine's four prestige levels stay as they are; the stars are the finer display.

import { Star } from 'lucide-react';
import { starsLabel } from '../../engine/contracts/prestige';
import type { Stars } from '../../engine/core/types';

export function ClientStars({ n, size = 12, label, className, tip }: { n: Stars; size?: number; label?: string; className?: string; tip?: string }) {
  return (
    <span className={`cl-stars${className ? ` ${className}` : ''}`} role="img" aria-label={label ?? starsLabel(n)} data-tip={tip}>
      {[0, 1, 2, 3, 4].map((i) => <Star key={i} width={size} height={size} className={i < n ? 'on' : 'off'} aria-hidden />)}
    </span>
  );
}
