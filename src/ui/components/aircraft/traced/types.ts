// Traced side profiles: one file per aircraft type (traced/<typeId>.ts exporting
// `profile`), loaded by load.ts. CANONICAL FRAME (same as the renderer's internal
// geometry): nose faces LEFT, x grows aft, y grows DOWN (SVG). Units: fractions
// of the fuselage length L measured from the nose tip (x = 0) to the aft end of
// the tail cone (x = 1). y = 0 at the height of the nose tip; a point 10% of L
// below the nose tip has y = 0.10.

export interface TracedProfile {
  typeId: string; source: string;            // e.g. 'airbus-boeing-comparison.jpg crop [x0,y0,x1,y1]'
  lengthPx: number;                          // fuselage length in source pixels (scale record)
  top: [number, number][];                   // upper fuselage line nose tip → tail cone end, ≥ 50 points, ≥ 20 of them in x ≤ 0.15 (nose); follows the crown UNDER the fin root (exclude the fin)
  bottom: [number, number][];                // lower fuselage line nose tip → tail cone end, ≥ 50 points, ≥ 20 in the nose; EXCLUDE landing gear, engines and wing (follow the belly through the wing-root fairing)
  cockpit: [number, number][][];             // one polygon per visible windscreen pane (dark glass), traced from the photo: usually 3 (or 2) side panes; include the forward pane if visible
  windows: { y: number; h: number; from: number; to: number; pitch: number; gaps: [number, number][] };  // passenger window row: centre y, height, x-range, pitch, gaps (doors/emergency exits/wing box)
  doors: { x: number; w: number; h: number; y: number }[];   // main doors (x = fore edge)
  fin?: [number, number][];                  // vertical fin polygon (root along the crown, leading edge, tip, trailing edge) — required for types where the renderer's parametric fin is visibly wrong
  wingRoot?: { from: number; to: number; y: number };        // where the wing meets the fuselage (x-range, y of the root chord centre)
  engines?: { x: number; y: number; w: number; h: number }[];  // nacelle bounding boxes (same frame)
  outline?: [number, number][];              // FULL closed silhouette (fuselage + wing + fin + nacelles) — used instead of top/bottom for the Concorde
  notes?: string;
}
