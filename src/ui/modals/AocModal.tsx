// v0.17 (UPDATE-0.17.md §N.3; lane `market-ui`): Add a type: what, cost, time, what it needs; Apply (§N.3).
// Step 0: a slot that renders nothing until the lane fills it (opened by the store's 'aoc' modal; see game/Modals.tsx).
import type { RatingFamily } from '../../data/acmiTypes';

export function AocModal(props: { family?: RatingFamily }) {
  void props;
  return null;
}
