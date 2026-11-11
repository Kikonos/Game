// v0.22 where the small popover (a '?' note or a glossary word: Term.tsx PopBox) goes: under its anchor when there is
// room, else above it; always whole on the screen, inside the device's safe area (a phone on its side has the camera
// island and rounded corners left and right, the home bar below; upright, the status bar above) and clear of the bug
// button's corner. Pure; every number is in screen pixels.

export interface Box { left: number; top: number; right: number; bottom: number; width: number; height: number }
export interface Insets { l: number; r: number; t: number; b: number }

const GAP = 8;
/** Screen px kept free around the lower left corner when the bug button cannot be measured (it and its gap). */
export const BUG_ZONE = 48;

export function placePop(anchor: Box, box: { width: number; height: number }, vw: number, vh: number, safe: Insets = { l: 0, r: 0, t: 0, b: 0 }, bug: Box | null = null): { left: number; top: number } {
  const minX = GAP + safe.l;
  const maxX = Math.max(minX, vw - GAP - safe.r - box.width);
  let left = Math.min(maxX, Math.max(minX, anchor.left + anchor.width / 2 - box.width / 2));
  const minY = GAP + safe.t;
  const maxY = Math.max(minY, vh - GAP - safe.b - box.height);
  const below = anchor.bottom + GAP;
  const above = anchor.top - box.height - GAP;
  // Under the anchor when it fits, else above it; when neither fits, the side with more room, kept on the screen.
  let top = below <= maxY ? below : above >= minY ? above : Math.min(maxY, Math.max(minY, vh - anchor.bottom > anchor.top ? below : above));
  // The bug button lives in the lower left corner, above everything: the box starts to its right there; with no room
  // beside it, above it.
  const zone = bug && bug.width ? { right: bug.right + GAP, top: bug.top - GAP } : { right: BUG_ZONE, top: vh - BUG_ZONE };
  if (left < zone.right && top + box.height > zone.top) {
    if (maxX >= zone.right) left = Math.max(left, zone.right);
    else top = Math.max(minY, zone.top - box.height);
  }
  return { left, top };
}
