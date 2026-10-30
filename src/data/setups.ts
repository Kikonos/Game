// v0.12 New-company start setups (the player: "other presets when starting a new company with other short-haul
// aircraft and setups. Every preset must start with short-haul only."). Each setup is its own fleet, crew sized to it
// (crew sets per aircraft, as the Planning view counts them), cash and a short difficulty label. Every one is
// narrowbody short-haul only. Built by engine/newGame.ts (createGame); shown on the New Game screen.

export type SetupId = 'classic' | 'boeing' | 'leisure' | 'newtech' | 'mixed' | 'veterans' | 'shoestring';

/** One start aircraft: the type, owned or dry-leased in, the year it was built and how worn it is. */
export interface SetupAircraft {
  typeId: string;
  owned: boolean;
  built: number;
  /** 'fresh': checks just done; 'mid': halfway (the classic start's leased A320); 'worn': A- and C-check due soon, more open defects. */
  wear: 'fresh' | 'mid' | 'worn';
  /** Lessor of a leased one. */
  lessor?: string;
  /** Cabin preset index (data/acmiTypes cabins; default the first). */
  cabin?: number;
  /** Scenarios: no crew comes with it (the player hires or converts them). */
  noCrew?: boolean;
}

export interface StartSetup {
  id: SetupId;
  name: string;
  /** One plain line for the card. */
  blurb: string;
  fleet: SetupAircraft[];
  /** Crew sets per aircraft (5 is what the Planning view asks for; fewer is a thin start). */
  sets: number;
  cash: number;
  difficulty: 1 | 2 | 3;
  /** Why it is easier or harder, a few words. */
  why: string;
}

export const DIFFICULTY_LABEL: Record<1 | 2 | 3, string> = { 1: 'Easy', 2: 'Normal', 3: 'Hard' };

export const START_SETUPS: StartSetup[] = [
  {
    id: 'classic', name: 'Classic pair', blurb: 'Two A320s: one owned and older, one leased.',
    fleet: [{ typeId: 'a320ceo', owned: true, built: 2006, wear: 'mid' }, { typeId: 'a320ceo', owned: false, built: 2013, wear: 'mid', lessor: 'AerCap' }],
    sets: 5, cash: 3_000_000, difficulty: 2, why: 'The standard start',
  },
  {
    id: 'boeing', name: 'Boeing shop', blurb: 'Two 737-800s, the charter workhorse of Europe.',
    fleet: [{ typeId: 'b738', owned: true, built: 2007, wear: 'mid' }, { typeId: 'b738', owned: false, built: 2014, wear: 'mid', lessor: 'SMBC Aviation Capital' }],
    sets: 5, cash: 3_000_000, difficulty: 2, why: 'The standard start on Boeing',
  },
  {
    id: 'leisure', name: 'Leisure workhorses', blurb: 'Two A321s with 220 seats for tour operators.',
    fleet: [{ typeId: 'a321ceo', owned: true, built: 2009, wear: 'mid' }, { typeId: 'a321ceo', owned: false, built: 2015, wear: 'mid', lessor: 'Avolon' }],
    sets: 5, cash: 3_000_000, difficulty: 2, why: 'More seats, more rent',
  },
  {
    id: 'newtech', name: 'New tech', blurb: 'One leased A320neo: low fuel burn and a big cash cushion.',
    fleet: [{ typeId: 'a320neo', owned: false, built: 2020, wear: 'fresh', lessor: 'Air Lease Corporation' }],
    sets: 5, cash: 5_000_000, difficulty: 2, why: 'One aircraft, a big cushion',
  },
  {
    id: 'mixed', name: 'Mixed fleet', blurb: 'An A320 and a 737-800: two type ratings, two crew pools.',
    fleet: [{ typeId: 'a320ceo', owned: true, built: 2006, wear: 'mid' }, { typeId: 'b738', owned: false, built: 2013, wear: 'mid', lessor: 'AerCap' }],
    sets: 5, cash: 3_000_000, difficulty: 3, why: 'Crews cannot swap aircraft',
  },
  {
    id: 'veterans', name: 'Owned veterans', blurb: 'Two old A320s you own: no rent, but more maintenance.',
    fleet: [{ typeId: 'a320ceo', owned: true, built: 2003, wear: 'worn' }, { typeId: 'a320ceo', owned: true, built: 2004, wear: 'worn' }],
    sets: 5, cash: 1_800_000, difficulty: 2, why: 'Checks due soon, less cash',
  },
  {
    id: 'shoestring', name: 'Shoestring', blurb: 'One leased A320, a small crew and tight cash.',
    fleet: [{ typeId: 'a320ceo', owned: false, built: 2009, wear: 'mid', lessor: 'Carlyle Aviation Partners' }],
    sets: 4, cash: 1_500_000, difficulty: 3, why: 'Thin crew, little cash',
  },
];

export const SETUP_BY_ID: Record<string, StartSetup> = Object.fromEntries(START_SETUPS.map((s) => [s.id, s]));
export const DEFAULT_SETUP: SetupId = 'classic';
