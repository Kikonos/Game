// Side-profile spec for one aircraft type, in REAL METRES.
//
// Frame: x = metres aft of the nose tip (nose points LEFT), y = metres above
// the fuselage centreline (up is positive). The renderer flips y for SVG.
// Nose and tail-cone outlines use units of fuselage height H instead, so a
// family shares them across stretches.

/**
 * Cubic Bezier chain as a flat list: x0,y0 then (c1x,c1y, c2x,c2y, x,y) per
 * segment. Nose chains: u = H-units aft of the nose tip, v = H-units above
 * the centreline. Tail chains: u = H-units relative to the tail tip (<= 0).
 */
export type Chain = readonly number[];

export interface NoseSpec {
  /** Tip to crown: starts at the tip, ends at v = 0.5 (or at the hump top for a 747). */
  upper: Chain;
  /** Tip to belly: starts at the same tip, ends at v = -0.5. */
  lower: Chain;
  /** Radome joint line, H-units aft of the tip (fine line, optional). */
  radome?: number;
}

export interface TailConeSpec {
  /** Crown (v = 0.5) to the tail tip top, u <= 0 relative to the tip. */
  upper: Chain;
  /** Belly (v = -0.5) to the tail tip bottom. */
  lower: Chain;
  /** Dark APU exhaust drawn at the tip, height in H-units (0 = none). */
  apu?: number;
  /** 777-style vertical blade trailing edge (draws the cut-off end as a line). */
  blade?: boolean;
}

/** 747 upper deck: nose.upper ends at the hump top; the hump runs aft to x1 then fairs into the crown. */
export interface HumpSpec {
  /** End of the flat hump top, metres from the nose. */
  x1: number;
  /** Length of the fairing back down to the main crown (m). */
  fair: number;
}

export type CockpitStyle =
  | 'airbus' | 'a350' | 'a380' | 'b737' | 'b757' | 'b787' | 'b777' | 'b747'
  | 'embraer' | 'crj' | 'atr' | 'q400' | 'c919' | 'a220' | 'overture';

export interface CockpitSpec {
  style: CockpitStyle;
  /** Anchor = lower front corner of the windscreen, in nose H-units. */
  u: number;
  v: number;
  /** Size multiplier for the preset panes (default 1). */
  scale?: number;
}

export type FinTip = 'square' | 'round' | 'raked' | 'ttail';

export interface FinSpec {
  /** Leading edge at the root (where it meets the crown), m from the nose. */
  x: number;
  rootChord: number;
  tipChord: number;
  /** Tip height above the crown (y = H/2), m: real overall height - gear stance - H/2. */
  height: number;
  /** Leading-edge sweep, degrees. */
  sweep: number;
  /** Dorsal fillet: starts `len` m ahead of the root LE on the crown and meets the LE `h` m up; `knee` = straight ramp with a sharp knee (737/757). */
  fillet?: { len: number; h: number; knee?: boolean };
  tip?: FinTip;
  /** Leading-edge bow (A350/787 curved fin), fraction of root chord. */
  bow?: number;
  /** Rudder chord as a fraction of local chord (hinge line); 0 hides it. */
  rudder?: number;
}

export interface StabSpec {
  /** Root leading edge, m from the nose. */
  x: number;
  /** Root height above the centreline (m). Ignored for T-tails (sits on the fin tip). */
  y: number;
  rootChord: number;
  tipChord: number;
  /** Semi-span (m), projected rise = span*sin(dihedral), tip LE = x + span*tan(sweep). */
  span: number;
  sweep: number;
  dihedral: number;
  /** Apparent root thickness (m). */
  thickness?: number;
  tTail?: boolean;
  /** Overture-style: no horizontal tail at all. */
  none?: boolean;
}

export type TipDevice =
  | 'none' | 'winglet' | 'blended' | 'sharklet' | 'raked' | 'scimitar' | 'curved' | 'folding' | 'fence';

export interface WingSpec {
  /** Root leading edge at the fuselage side, m from the nose. */
  x: number;
  /** Root height above centreline (m); low wing ~ -0.3H, high wing ~ +0.5H. */
  y: number;
  rootChord: number;
  tipChord: number;
  /** Semi-span from root to tip (m) — about (span - fuselage width) / 2. */
  span: number;
  /** Leading-edge sweep (deg). */
  sweep: number;
  /** Dihedral (deg); projected tip rise = span*sin(dihedral). */
  dihedral: number;
  /** Apparent root thickness (m). */
  thickness?: number;
  tip: TipDevice;
  /** Height of the tip device (m). */
  tipH?: number;
  /** High-wing turboprop (drawn with a fairing on the crown). */
  high?: boolean;
  /**
   * Draw the side view as the root aerofoil section (LE at x, y = chord line) instead of the
   * projected planform: high-wing turboprops, whose nacelles are then slung beneath the wing
   * and whose propellers are drawn in front of it.
   */
  section?: boolean;
  /** Delta planform (Overture): long root chord, tip close to the trailing edge. */
  delta?: boolean;
}

export type EngineStyle =
  | 'plain'      // CFM56-5 / LEAP-1A / Trent / CF6: separate fan & core exhausts
  | 'longduct'   // V2500 / RB211-535 mixed-flow long cowl
  | 'gtf'        // PW1000G: big round fan, short cowl
  | 'chevron'    // GEnx / LEAP-1B / Trent 1000: serrated fan nozzle
  | 'ge90'       // GE90 / GE9X: huge
  | 'flatbottom' // CFM56-7 on the 737NG
  | 'rear'       // fuselage-mounted (CRJ)
  | 'trent900'   // Trent 900 / GP7200 (A380): long fan cowl, short core and plug
  | 'turboprop'  // PW127 / PW150 nacelle with propeller
  | 'supersonic';// rectangular inlet, long nacelle

export interface EngineSpec {
  mount: 'underwing' | 'rear' | 'turboprop';
  style: EngineStyle;
  /** Intake lip (front of nacelle), m from the nose. */
  x: number;
  /** Nacelle centreline height above the fuselage centreline (m). */
  y: number;
  /** Max nacelle diameter (m). */
  dia: number;
  /** Nacelle length incl. exhaust plug (m). */
  len: number;
  /** Wing station 0..1 (root..tip) the pylon meets; underwing/turboprop only. */
  station?: number;
  /** Inboard engine of a 4-engine wing: drawn first and a touch darker. */
  inboard?: boolean;
  /** Far-side engine: drawn behind the fuselage, darker. */
  far?: boolean;
  /** Propeller (turboprops). */
  prop?: { dia: number; blades: number };
  /** Q400: nacelle continues aft past the wing (gear bay) (m behind intake). */
  tailLen?: number;
}

/** Bulge under the belly (wing-body fairing) or ATR gear sponson (drawn, no wheels). */
export interface FairingSpec {
  x0: number;
  x1: number;
  /** Depth below the belly line (m). */
  depth: number;
  /** Top seam height above the belly line (m): outlines a separate pod (ATR sponson). Default: low fairing seam. */
  rise?: number;
}

export interface DoorSpec {
  /** Front edge, m from the nose. */
  x: number;
  w?: number;
  h?: number;
  /** Sill height above the centreline (m); default per kind. */
  y?: number;
  kind?: 'pax' | 'exit' | 'cargo';
}

export interface WindowRow {
  x0: number;
  x1: number;
  /** Centre height above the centreline (m). */
  y: number;
  pitch: number;
  w: number;
  h: number;
  /** Extra [from, to] ranges with no windows (doors are skipped automatically). */
  gaps?: readonly (readonly [number, number])[];
}

export interface AircraftProfile {
  id: string;
  /** Nose tip to tail-cone tip (m) — normally the type's overall length. */
  length: number;
  /** Fuselage external height H (m); A380 = full double-deck height. */
  height: number;
  nose: NoseSpec;
  cockpit: CockpitSpec;
  tail: TailConeSpec;
  hump?: HumpSpec;
  fin: FinSpec;
  stab: StabSpec;
  wing: WingSpec;
  engines: EngineSpec[];
  fairing?: FairingSpec;
  sponson?: FairingSpec;
  doors: DoorSpec[];
  windows: WindowRow[];
  /** Titles box (forward upper fuselage): left x, centre y, max width, letter height (m). */
  titles?: { x: number; y: number; w: number; size: number };
  /** Real data used by the sanity test (m). */
  ref: { overallHeight: number; span: number };
}
