// v0.18 aircraft spec sheets: the cabin geometry of every type for the seat map (ui/specs/seatMap.ts builds the
// top-down layout of passenger accommodation, the "LOPA", from it and a cabin's seats per class). Lengths in inches
// from the first cabin item behind the flight deck, nose to tail; widths are the cabin's floor width.
//
// Sources (the note in /home/user/work/specs/lopa-sources.md has the links):
// - Euro Atlantic Airways' own spec sheets (2025-26) are the ground truth for the 767-300ER (CS-TSU 16C/251Y, CS-TST
//   309Y), the 777-200ER (CS-TSW 30C/24W/239Y), the A330-200 (CS-TGD 12C/283Y) and the A330-300 (CS-TGI 27C/16W/247Y):
//   door positions, galleys and lavatories by door zone, seats abreast (767 Y 2-4-2, J 1-2-1; 777 J staggered 1-2-1,
//   W 2-4-2, Y 3-3-3; A330 J 2-2-2, W and Y 2-4-2), pitch (J 44-45 in, W 36-37, Y 30-32), bed length 76 in, screens.
// - Airbus and Boeing airport planning documents ("Aircraft characteristics", ACAPS) for door counts and cabin widths:
//   A320 two door pairs and two overwing exit pairs; A321ceo four door pairs; A321neo Airbus Cabin Flex door 2 deleted,
//   two overwing exit pairs added and door 3 moved aft (Runway Girl Network, Aircraft Interiors International);
//   737-800 two door pairs and two overwing pairs, 737-900ER plus a mid-cabin exit pair aft of the wing; 757-200 four
//   Type I pairs (the popular option; three plus overwing exits on some, Aircraft Commerce 757 guide); A330/A340-300
//   four pairs (A340 door 3 a Type I); A340-600 four Type A pairs and one oversize Type III pair over the wing (FAA
//   TCDS via Flight International); 777-200ER four pairs, -300ER five; 787 and A350 four; 747 five main-deck pairs and
//   one upper-deck pair (-400 Type I, -8 one pair at the forward third: FAA special conditions 2011); A380 five main
//   and three upper-deck pairs.
// - Crew rest: A330/A340 lower-deck module at the forward end of the aft hold, entered by a stair house in the cabin
//   (FAA special conditions, Delta Flight Products); 777, 787 and A350 overhead compartments in the crown, the pilots'
//   forward by door 1 and the cabin crew's aft (Boeing 2003, Executive Traveller); 747-400 pilots' bunks behind the
//   flight deck on the upper deck, cabin crew overhead aft; A380 cabin crew under the main deck aft, pilots behind
//   the flight deck (Executive Traveller, Flightglobal).
// - Galleys and lavatories: typical operator layouts (aeroLOPA-style seat maps of TAP, TUI, Condor, Hi Fly, Wamos,
//   Privilege, Titan, Air Belgium, SmartLynx): forward galley and lavatory at door 1, aft galley across the tail.
// Not drawn (a plain seat table instead): the 777-8 and 777-9 (no cabin in airline service yet).

export type Side = 'L' | 'R' | 'C' | 'LC' | 'CR' | 'LCR';
/** G galley · WC lavatory · ST stairs · CR crew rest room on the deck · CL closet. */
export type MonKind = 'G' | 'WC' | 'ST' | 'CR' | 'CL';

export type Seg =
  /** A door pair (L and R) and its cross-aisle: Type A / B / C / I floor-level doors, Type II mid-cabin exits. */
  | { k: 'door'; kind: 'A' | 'B' | 'C' | 'I' | 'II'; len: number }
  /** A pair of overwing exits (Type III) and the extra legroom of the exit row behind it. */
  | { k: 'ow'; len: number }
  /** Galleys, lavatories, stairs across the cabin. */
  | { k: 'mon'; len: number; items: [MonKind, Side][] }
  /** Seats; `max` caps the seats abreast (the nose of a 747, a tapering tail). */
  | { k: 'seats'; len: number; max?: number };

/** A point along the deck: the start of the n-th (1-based) door or overwing pair, plus inches. */
export type Anchor = ['d' | 'o', number, number];

export interface DeckGeo {
  id: 'main' | 'upper';
  /** Cabin floor width, inches. */
  width: number;
  segs: Seg[];
  /** Nose (flight deck) and tail cone drawn ahead of and behind the cabin, inches. 0: the deck ends flat (A380 upper). */
  nose: number;
  tail: number;
  /** Wing root leading and trailing edge (main deck only). */
  wing?: [Anchor, Anchor];
}

export interface RestSpot {
  /** Overhead in the crown, under the floor, or a room on the deck. */
  where: 'overhead' | 'lower' | 'room';
  deck: 'main' | 'upper';
  /** By this door (1-based). */
  door: number;
  /** Inches the compartment runs aft from the door. */
  len: number;
}

export interface TypeLopa {
  decks: DeckGeo[];
  /** Seats abreast per class (blocks between aisles): standard and dense economy. */
  y: number[];
  yDense?: number[];
  w?: number[];
  j: number[];
  /** Upper deck patterns (two-deck types). */
  upper?: { y: number[]; w?: number[]; j: number[] };
  /** Where bunks go when fitted (pilots, cabin crew). */
  rest?: { fc?: RestSpot; cc?: RestSpot };
  /** Why no seat map is drawn (a plain seat table instead). */
  noMap?: string;
  /** Sources in short. */
  src: string;
}

const D = (kind: 'A' | 'B' | 'C' | 'I' | 'II' = 'A', len?: number): Seg => ({ k: 'door', kind, len: len ?? (kind === 'A' || kind === 'B' ? 42 : kind === 'II' ? 22 : 30) });
const OW = (len = 10): Seg => ({ k: 'ow', len });
const S = (len: number, max?: number): Seg => ({ k: 'seats', len, ...(max ? { max } : {}) });
const M = (len: number, ...items: [MonKind, Side][]): Seg => ({ k: 'mon', len, items });

// ---------- narrowbodies ----------
const FWD_NARROW = M(40, ['WC', 'L'], ['G', 'R']);
const AFT_NARROW = [M(38, ['WC', 'L'], ['WC', 'R']), D('C'), M(32, ['G', 'LCR'])];

const A320: DeckGeo = {
  id: 'main', width: 146, nose: 150, tail: 300,
  // Rows 1-10, the two overwing exit rows (11 and 12 on a 180-seat cabin), rows behind.
  segs: [FWD_NARROW, D('C'), S(300), OW(), S(31), OW(), S(569), ...AFT_NARROW],
  wing: [['o', 1, -110], ['o', 2, 150]],
};
const A321_4: DeckGeo = {
  id: 'main', width: 146, nose: 150, tail: 300,
  segs: [FWD_NARROW, D('C'), S(270), D('C'), S(430), D('C'), S(450), ...AFT_NARROW],
  wing: [['d', 2, 70], ['d', 3, -20]],
};
const A321_ACF: DeckGeo = {
  id: 'main', width: 146, nose: 150, tail: 300,
  // Door 2 deleted; two overwing exit pairs over the wing; door 3 four frames further aft.
  segs: [FWD_NARROW, D('C'), S(340), OW(), S(31), OW(), S(370), D('C'), S(400), ...AFT_NARROW],
  wing: [['o', 1, -110], ['d', 2, -40]],
};
const B738: DeckGeo = {
  id: 'main', width: 139, nose: 150, tail: 300,
  // Overwing exit rows near the middle (rows 15-16 of 32 on a 189-seat cabin).
  segs: [FWD_NARROW, D('I'), S(430), OW(), S(31), OW(), S(469), M(38, ['WC', 'L'], ['WC', 'R']), D('I'), M(32, ['G', 'LCR'])],
  wing: [['o', 1, -120], ['o', 2, 140]],
};
const B739: DeckGeo = {
  id: 'main', width: 139, nose: 150, tail: 300,
  // The -900ER's extra mid-cabin exit pair aft of the wing lets it seat 220.
  segs: [FWD_NARROW, D('I'), S(490), OW(), S(31), OW(), S(350), D('II'), S(230), M(38, ['WC', 'L'], ['WC', 'R']), D('I'), M(32, ['G', 'LCR'])],
  wing: [['o', 1, -120], ['o', 2, 150]],
};
const B752: DeckGeo = {
  id: 'main', width: 139, nose: 160, tail: 320,
  // Four Type I door pairs (doors 2 ahead of and 3 behind the wing).
  segs: [FWD_NARROW, D('I'), S(190), D('I'), S(540), D('I'), S(420), M(38, ['WC', 'L'], ['WC', 'R']), D('I'), M(36, ['G', 'LCR'])],
  wing: [['d', 2, 150], ['d', 3, -30]],
};
const B753: DeckGeo = {
  id: 'main', width: 139, nose: 160, tail: 320,
  segs: [FWD_NARROW, D('I'), S(240), D('I'), S(350), OW(), S(31), OW(), S(400), D('I'), S(430), M(38, ['WC', 'L'], ['WC', 'R']), D('I'), M(36, ['G', 'LCR'])],
  wing: [['o', 1, -140], ['d', 3, -10]],
};

// ---------- widebodies ----------
const B763: DeckGeo = {
  id: 'main', width: 186, nose: 190, tail: 420,
  // Euro Atlantic CS-TSU / CS-TST: lavatory and galley at door 1; lavatories and a galley at door 2; lavatories ahead
  // of door 3 (behind the wing); four lavatories and the aft galley at door 4.
  segs: [M(44, ['WC', 'L'], ['G', 'CR']), D('A'), S(300), M(40, ['WC', 'L'], ['G', 'C'], ['WC', 'R']), D('I', 34), S(520),
    M(36, ['WC', 'L'], ['WC', 'R']), D('I', 34), S(360), M(40, ['WC', 'L'], ['WC', 'C'], ['WC', 'R']), D('A'), M(44, ['G', 'LCR'])],
  wing: [['d', 2, 60], ['d', 3, -10]],
};
const A332: DeckGeo = {
  id: 'main', width: 208, nose: 220, tail: 480,
  // Euro Atlantic CS-TGD: galleys at door 1; a lavatory at door 2; lavatories at door 3; lavatories and galleys aft.
  segs: [M(50, ['G', 'LC'], ['WC', 'R']), D('A'), S(290), M(36, ['WC', 'R'], ['CL', 'L']), D('A'), S(570), M(38, ['WC', 'L'], ['WC', 'R']), D('A'), S(390),
    M(40, ['WC', 'L'], ['WC', 'C'], ['WC', 'R']), D('A'), M(60, ['G', 'LCR'])],
  wing: [['d', 2, 110], ['d', 3, -30]],
};
const A333: DeckGeo = {
  id: 'main', width: 208, nose: 220, tail: 480,
  // Euro Atlantic CS-TGI: lavatory and galley at door 1; lavatories and a galley at door 2; four lavatories at door 3.
  segs: [M(50, ['WC', 'L'], ['G', 'C'], ['CL', 'R']), D('A'), S(390), M(48, ['WC', 'L'], ['G', 'C'], ['WC', 'R']), D('A'), S(600),
    M(40, ['WC', 'L'], ['WC', 'C'], ['WC', 'R']), D('A'), S(470), M(40, ['WC', 'R'], ['CL', 'L']), D('A'), M(60, ['G', 'LCR'])],
  wing: [['d', 2, 120], ['d', 3, -40]],
};
/** A340-200/-300: as the A330, door 3 a smaller Type I exit behind the wing. */
const a34 = (g: DeckGeo): DeckGeo => {
  let n = 0;
  return { ...g, segs: g.segs.map((s) => (s.k === 'door' && ++n === 3 ? D('I', 34) : s)) };
};
const A345: DeckGeo = {
  id: 'main', width: 208, nose: 220, tail: 500,
  segs: [M(50, ['WC', 'L'], ['G', 'C'], ['CL', 'R']), D('A'), S(400), M(48, ['WC', 'L'], ['G', 'C'], ['WC', 'R']), D('A'), S(640),
    M(40, ['WC', 'L'], ['WC', 'C'], ['WC', 'R']), D('I', 34), S(560), M(40, ['WC', 'R'], ['CL', 'L']), D('A'), M(60, ['G', 'LCR'])],
  wing: [['d', 2, 160], ['d', 3, -40]],
};
const A346: DeckGeo = {
  id: 'main', width: 208, nose: 220, tail: 520,
  // Four Type A pairs and one oversize Type III pair over the wing (doors 2 and 3 are 74 ft apart).
  segs: [M(50, ['WC', 'L'], ['G', 'C'], ['CL', 'R']), D('A'), S(420), M(48, ['WC', 'L'], ['G', 'C'], ['WC', 'R']), D('A'), S(330), OW(14), S(330),
    M(40, ['WC', 'L'], ['WC', 'C'], ['WC', 'R']), D('A'), S(820), M(40, ['WC', 'L'], ['G', 'C'], ['WC', 'R']), D('A'), M(60, ['G', 'LCR'])],
  wing: [['o', 1, -200], ['d', 3, -40]],
};
const B772: DeckGeo = {
  id: 'main', width: 231, nose: 240, tail: 520,
  // Euro Atlantic CS-TSW: galleys at door 1; business behind; a galley and lavatories at door 2; lavatories at door 3;
  // lavatories and a galley at door 4, the aft galley across.
  segs: [M(40, ['G', 'LCR']), D('A'), M(34, ['WC', 'L'], ['G', 'C']), S(240), M(36, ['WC', 'L'], ['G', 'C'], ['WC', 'R']), D('A'), S(470),
    M(40, ['WC', 'L'], ['WC', 'C'], ['WC', 'R']), D('A'), S(610), M(40, ['WC', 'L'], ['G', 'C'], ['WC', 'R']), D('A'), M(50, ['G', 'LCR'])],
  wing: [['d', 2, 150], ['d', 3, -20]],
};
const B77W: DeckGeo = {
  id: 'main', width: 231, nose: 240, tail: 560,
  segs: [M(40, ['G', 'LCR']), D('A'), M(34, ['WC', 'L'], ['G', 'C']), S(300), M(36, ['WC', 'L'], ['G', 'C'], ['WC', 'R']), D('A'), S(380),
    M(40, ['WC', 'L'], ['WC', 'R']), D('A'), S(420), M(40, ['WC', 'L'], ['WC', 'C'], ['WC', 'R']), D('A'), S(660), M(40, ['WC', 'L'], ['G', 'C'], ['WC', 'R']), D('A'), M(50, ['G', 'LCR'])],
  wing: [['d', 2, 160], ['d', 3, 40]],
};
const b787 = (a: number, b: number, c: number, tail: number): DeckGeo => ({
  id: 'main', width: 216, nose: 220, tail,
  segs: [M(40, ['G', 'LCR']), D('A'), M(30, ['WC', 'L']), S(a), M(40, ['WC', 'L'], ['G', 'C'], ['WC', 'R']), D('A'), S(b),
    M(36, ['WC', 'L'], ['WC', 'R']), D('A'), S(c), M(36, ['WC', 'L'], ['WC', 'C'], ['WC', 'R']), D('A'), M(48, ['G', 'LCR'])],
  wing: [['d', 2, Math.round(b * 0.22)], ['d', 3, -30]],
});
const a350 = (a: number, b: number, c: number, tail: number): DeckGeo => ({
  id: 'main', width: 221, nose: 230, tail,
  segs: [M(40, ['G', 'LCR']), D('A'), M(30, ['WC', 'L']), S(a), M(40, ['WC', 'L'], ['G', 'C'], ['WC', 'R']), D('A'), S(b),
    M(36, ['WC', 'L'], ['WC', 'R']), D('A'), S(c), M(36, ['WC', 'L'], ['WC', 'C'], ['WC', 'R']), D('A'), M(50, ['G', 'LCR'])],
  wing: [['d', 2, Math.round(b * 0.25)], ['d', 3, -30]],
});
const A388_MAIN: DeckGeo = {
  id: 'main', width: 260, nose: 250, tail: 560,
  // Five pairs (M1-M5); the forward staircase behind M1, the aft one ahead of M5.
  segs: [M(40, ['G', 'LCR']), D('A'), M(60, ['ST', 'C'], ['WC', 'L'], ['WC', 'R']), S(340), M(40, ['WC', 'L'], ['G', 'C'], ['WC', 'R']), D('A'), S(420),
    M(40, ['WC', 'L'], ['WC', 'R']), D('A'), S(400), M(40, ['WC', 'L'], ['G', 'C'], ['WC', 'R']), D('A'), S(360), M(60, ['ST', 'C'], ['WC', 'L'], ['WC', 'R']), D('A'), M(50, ['G', 'LCR'])],
  wing: [['d', 2, 120], ['d', 4, -60]],
};
const A388_UPPER: DeckGeo = {
  id: 'upper', width: 232, nose: 120, tail: 260,
  // Three pairs (U1-U3); the stairs from the main deck at both ends.
  segs: [M(50, ['ST', 'C'], ['G', 'L'], ['G', 'R']), D('A'), M(36, ['WC', 'L'], ['WC', 'R']), S(720), M(40, ['WC', 'L'], ['G', 'C'], ['WC', 'R']), D('A'), S(660),
    M(50, ['ST', 'C'], ['WC', 'L'], ['WC', 'R']), D('A'), M(40, ['G', 'LCR'])],
};
/** 747 main deck: the nose section ahead of door 1, the stairs to the upper deck at door 2 (-300/-400/-8). */
const b747main = (z: number[], tail: number, stairsAt2 = true): DeckGeo => ({
  id: 'main', width: 240, nose: 160, tail,
  segs: [S(z[0], 6), D('A'), M(40, ['G', 'C'], ['WC', 'R'], ...(stairsAt2 ? [] : [['ST', 'L'] as [MonKind, Side]])), S(z[1]), M(40, ...(stairsAt2 ? [['ST', 'L'] as [MonKind, Side]] : [['WC', 'L'] as [MonKind, Side]]), ['G', 'C'], ['WC', 'R']), D('A'), S(z[2]),
    D('A'), S(z[3]), M(40, ['WC', 'L'], ['WC', 'R']), D('A'), S(z[4]), M(40, ['WC', 'L'], ['G', 'C'], ['WC', 'R']), D('A'), M(50, ['G', 'LCR'])],
  wing: [['d', 2, 60], ['d', 4, -40]],
});
/** 747 upper deck behind the flight deck: the pilots' rest room, a galley, seats either side of the exit pair, the stairs aft. */
const b747upper = (a: number, b: number, short = false): DeckGeo => ({
  id: 'upper', width: 138, nose: 150, tail: 40,
  segs: short
    ? [M(40, ['ST', 'L'], ['WC', 'R']), S(a), D('I', 26), S(b), M(30, ['G', 'LCR'])]
    : [M(44, ['CR', 'L'], ['WC', 'R']), M(30, ['G', 'LCR']), S(a), D('I', 30), S(b), M(44, ['ST', 'L'], ['WC', 'R'])],
});

const NARROW_J = [2, 2];
const OVERHEAD = (cc: number): TypeLopa['rest'] => ({ fc: { where: 'overhead', deck: 'main', door: 1, len: 120 }, cc: { where: 'overhead', deck: 'main', door: cc, len: 180 } });
const LDMCR: TypeLopa['rest'] = { fc: { where: 'room', deck: 'main', door: 1, len: 60 }, cc: { where: 'lower', deck: 'main', door: 3, len: 200 } };

export const LOPA: Record<string, TypeLopa> = {
  a320ceo: { decks: [A320], y: [3, 3], j: NARROW_J, src: 'Airbus A320 Aircraft Characteristics; operator seat maps' },
  a320neo: { decks: [A320], y: [3, 3], j: NARROW_J, src: 'Airbus A320 Aircraft Characteristics; operator seat maps' },
  a321ceo: { decks: [A321_4], y: [3, 3], j: NARROW_J, src: 'Airbus A321 Aircraft Characteristics; operator seat maps' },
  a321neo: { decks: [A321_ACF], y: [3, 3], j: NARROW_J, src: 'Airbus Cabin Flex (Runway Girl Network 2016-18)' },
  b738: { decks: [B738], y: [3, 3], j: NARROW_J, src: 'Boeing 737 ACAPS; operator seat maps' },
  b739: { decks: [B739], y: [3, 3], j: NARROW_J, src: 'Boeing 737 ACAPS (mid-cabin exits)' },
  b752: { decks: [B752], y: [3, 3], j: NARROW_J, src: 'Boeing 757 ACAPS; Aircraft Commerce 757 guide' },
  b753: { decks: [B753], y: [3, 3], j: NARROW_J, src: 'Boeing 757 ACAPS' },
  b763: { decks: [B763], y: [2, 4, 2], j: [1, 2, 1], src: 'Euro Atlantic CS-TSU and CS-TST spec sheets', rest: { fc: { where: 'room', deck: 'main', door: 1, len: 50 } } },
  a332: { decks: [A332], y: [2, 4, 2], yDense: [3, 3, 3], w: [2, 4, 2], j: [2, 2, 2], rest: LDMCR, src: 'Euro Atlantic CS-TGD spec sheet; Airbus A330 AC' },
  a333: { decks: [A333], y: [2, 4, 2], yDense: [3, 3, 3], w: [2, 4, 2], j: [2, 2, 2], rest: LDMCR, src: 'Euro Atlantic CS-TGI spec sheet; Airbus A330 AC' },
  a339: { decks: [A333], y: [2, 4, 2], yDense: [3, 3, 3], w: [2, 4, 2], j: [1, 2, 1], rest: LDMCR, src: 'Airbus A330neo AC; operator seat maps' },
  a342: { decks: [a34(A332)], y: [2, 4, 2], w: [2, 4, 2], j: [2, 2, 2], rest: LDMCR, src: 'Airbus A340 AC (door 3 Type I)' },
  a343: { decks: [a34(A333)], y: [2, 4, 2], w: [2, 4, 2], j: [2, 2, 2], rest: LDMCR, src: 'Airbus A340 AC (door 3 Type I)' },
  a345: { decks: [A345], y: [2, 4, 2], w: [2, 3, 2], j: [2, 2, 2], rest: LDMCR, src: 'Airbus A340 AC' },
  a346: { decks: [A346], y: [2, 4, 2], w: [2, 4, 2], j: [2, 2, 2], rest: LDMCR, src: 'Airbus A340 AC; FAA TCDS (4 Type A + 1 Type III pair)' },
  b772: { decks: [B772], y: [3, 3, 3], yDense: [3, 4, 3], w: [2, 4, 2], j: [1, 2, 1], rest: OVERHEAD(4), src: 'Euro Atlantic CS-TSW spec sheet; Boeing 777 ACAPS' },
  b77w: { decks: [B77W], y: [3, 4, 3], w: [2, 4, 2], j: [1, 2, 1], rest: OVERHEAD(5), src: 'Boeing 777 ACAPS; operator seat maps' },
  b778: { decks: [], y: [3, 4, 3], j: [1, 2, 1], noMap: 'No 777-8 flies passengers yet: Boeing\'s figures only', src: 'Boeing 777X brochure' },
  b779: { decks: [], y: [3, 4, 3], j: [1, 2, 1], noMap: 'No 777-9 flies passengers yet: Boeing\'s figures only', src: 'Boeing 777X brochure' },
  b788: { decks: [b787(270, 430, 400, 460)], y: [3, 3, 3], w: [2, 3, 2], j: [1, 2, 1], rest: OVERHEAD(4), src: 'Boeing 787 ACAPS; operator seat maps' },
  b789: { decks: [b787(320, 500, 470, 480)], y: [3, 3, 3], w: [2, 3, 2], j: [1, 2, 1], rest: OVERHEAD(4), src: 'Boeing 787 ACAPS; operator seat maps' },
  b78x: { decks: [b787(360, 560, 520, 480)], y: [3, 3, 3], w: [2, 3, 2], j: [1, 2, 1], rest: OVERHEAD(4), src: 'Boeing 787 ACAPS; operator seat maps' },
  a359: { decks: [a350(360, 540, 500, 500)], y: [3, 3, 3], w: [2, 4, 2], j: [1, 2, 1], rest: OVERHEAD(4), src: 'Airbus A350 AC; operator seat maps' },
  a35u: { decks: [a350(360, 540, 500, 500)], y: [3, 3, 3], w: [2, 4, 2], j: [1, 2, 1], rest: OVERHEAD(4), src: 'Airbus A350 AC; Singapore Airlines A350-900ULR' },
  a35k: { decks: [a350(450, 620, 580, 520)], y: [3, 3, 3], w: [2, 4, 2], j: [1, 2, 1], rest: OVERHEAD(4), src: 'Airbus A350-1000 AC' },
  a388: {
    decks: [A388_MAIN, A388_UPPER], y: [3, 4, 3], j: [1, 2, 1], w: [2, 4, 2], upper: { y: [2, 4, 2], w: [2, 3, 2], j: [1, 2, 1] },
    rest: { fc: { where: 'room', deck: 'main', door: 1, len: 50 }, cc: { where: 'lower', deck: 'main', door: 4, len: 260 } }, src: 'Airbus A380 AC; Hi Fly and Emirates seat maps',
  },
  b744: {
    decks: [b747main([170, 230, 430, 400, 460], 560), b747upper(170, 330)], y: [3, 4, 3], w: [2, 4, 2], j: [2, 2, 2], upper: { y: [3, 3], w: [2, 2], j: [2, 2] },
    rest: { fc: { where: 'room', deck: 'upper', door: 0, len: 44 }, cc: { where: 'overhead', deck: 'main', door: 5, len: 160 } }, src: 'Boeing 747-400 ACAPS; ATSB 1990 (upper deck Type I exits)',
  },
  b748: {
    decks: [b747main([180, 270, 470, 430, 500], 580), b747upper(190, 420)], y: [3, 4, 3], w: [2, 4, 2], j: [1, 2, 1], upper: { y: [3, 3], w: [2, 2], j: [2, 2] },
    rest: { fc: { where: 'room', deck: 'upper', door: 0, len: 44 }, cc: { where: 'overhead', deck: 'main', door: 5, len: 160 } }, src: 'Boeing 747-8 ACAPS; FAA special conditions 2011 (upper deck exits)',
  },
  b743: {
    decks: [b747main([170, 230, 430, 400, 440], 560), b747upper(170, 330)], y: [3, 4, 3], j: [2, 2, 2], upper: { y: [3, 3], j: [2, 2] },
    rest: { cc: { where: 'overhead', deck: 'main', door: 5, len: 160 } }, src: 'Boeing 747 ACAPS (stretched upper deck)',
  },
  b741: {
    decks: [b747main([170, 230, 430, 400, 440], 560, false), b747upper(150, 160, true)], y: [3, 4, 3], j: [2, 2, 2], upper: { y: [3, 3], j: [2, 2] },
    rest: { cc: { where: 'overhead', deck: 'main', door: 5, len: 160 } }, src: 'Boeing 747 ACAPS (short upper deck, spiral stairs)',
  },
  b742: {
    decks: [b747main([170, 230, 430, 400, 440], 560, false), b747upper(150, 160, true)], y: [3, 4, 3], j: [2, 2, 2], upper: { y: [3, 3], j: [2, 2] },
    rest: { cc: { where: 'overhead', deck: 'main', door: 5, len: 160 } }, src: 'Boeing 747 ACAPS (short upper deck, spiral stairs)',
  },
};

/** The deck geometry of an airframe: the A321neo's variant (Cabin Flex or four door pairs). */
export function lopaOf(typeId: string, variant?: string): TypeLopa | undefined {
  const l = LOPA[typeId];
  if (!l) return undefined;
  if (typeId === 'a321neo' && variant === 'classic') return { ...l, decks: [A321_4], src: 'Airbus A321 Aircraft Characteristics (four door pairs)' };
  return l;
}
