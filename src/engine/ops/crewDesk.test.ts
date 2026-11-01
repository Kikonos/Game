// v0.14.1 (CREW-4 / UI-1) the crew desk only buys a fix that crews the flight. It used to apply the cheapest fix
// within its limits without looking at what it left (S0228: a $16.7K jet for 1 of 10 missing seats, announced as
// 'The crew desk fixed BLU1278'; S1027 BLU1570: a call-in that left the first officer seat empty, 'fixed' and
// 'still short' chimed in the same minute), and re-bought tickets for the same flight every 6 h.

import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import type { Flight, GameState } from '../core/types';
import { flightCrewStatus, shortFlights } from '../crew';
import { releaseCrew } from '../crew/roster';
import { touchCrew } from '../crew/timeline';
import { fixtureGame } from '../crew/fixtures';
import { demoFlights } from '../dev';
import { advanceTo } from '../sim';
import { crewDeskHour, hireHead, unlockHead } from './heads';

/** A demo game with the crew desk hired and one flight 20–40 h out stripped of its pilots. */
function shortFlight(): { g: GameState; f: Flight } {
  const g = fixtureGame(5);
  demoFlights(g, undefined, 4, 'revenue');
  advanceTo(g, g.now + 60);
  unlockHead(g, 'crewDesk');
  if (!hireHead(g, 'crewDesk', 2).ok) throw new Error('no desk');
  g.company.cash = 10_000_000;
  const f = Object.values(g.flights).filter((x) => x.status === 'scheduled' && x.dutyId && x.std > g.now + 20 * 60 && x.std < g.now + 40 * 60).sort((a, b) => a.std - b.std)[0];
  const d = g.duties[f.dutyId!];
  const p = g.pairings[d.pairingId];
  for (const s of [...p.slots]) if (s.crewId && (s.role === 'CPT' || s.role === 'FO')) releaseCrew(g, p, s.crewId);
  // The trip's first leg short (the desk takes the earliest).
  const first = shortFlights(g).find((r) => g.flights[r.flightId].dutyId === d.id);
  return { g, f: g.flights[first!.flightId] };
}

const deskNotes = (g: GameState, t: number) => g.messages.filter((m) => m.t >= t && m.topic === 'head' && m.cat === 'crew');

describe('v0.14.1 the crew desk buys only what crews the flight', () => {
  it('a fix that would leave a seat empty is not bought; the desk says so once and never as "fixed"', () => {
    const { g, f } = shortFlight();
    // Every other captain is off sick: no fix can fill the captain seat, a first officer can still be found.
    const p = g.pairings[g.duties[f.dutyId!].pairingId];
    for (const c of Object.values(g.crew)) if (c.role === 'CPT' && !p.slots.some((s) => s.crewId === c.id)) c.blocks = [...(c.blocks ?? []), { from: g.now, to: g.now + 5 * DAY, why: 'leave' }];
    touchCrew(g);
    expect(shortFlights(g).find((r) => r.flightId === f.id)?.stage).toBe('amber');
    const cash = g.company.cash;
    const fo = p.slots.filter((s) => s.role === 'FO' && s.crewId).length;
    const t = g.now;
    expect(crewDeskHour(g)).toBe(0);
    expect(p.slots.filter((s) => s.role === 'FO' && s.crewId).length).toBe(fo);
    expect(g.company.cash).toBe(cash);
    const notes = deskNotes(g, t);
    expect(notes.some((m) => /fixed|crewed/.test(m.title))).toBe(false);
    expect(notes.filter((m) => m.ref?.id === f.id).map((m) => m.title)).toEqual([`The crew desk left ${f.no} to you`]);
    expect(notes[0].body).toMatch(/would still leave 1 captain missing/);
    // Six hours on, same shortage: nothing new.
    const n = g.messages.length;
    crewDeskHour(g);
    expect(deskNotes(g, t).length).toBe(notes.length);
    expect(g.messages.length).toBe(n);
  });

  it('a fix that crews the flight is bought and said plainly, once', () => {
    const { g, f } = shortFlight();
    const t = g.now;
    expect(crewDeskHour(g)).toBeGreaterThan(0);
    expect(['ok', 'tight']).toContain(flightCrewStatus(g, f.id).level);
    const notes = deskNotes(g, t).filter((m) => m.ref?.id === f.id);
    expect(notes.length).toBe(1);
    expect(notes[0].title).toMatch(/^The crew desk crewed /);
    // No second 'crewed' / 'still short' message from Crew Control beside the desk's note.
    expect(g.messages.filter((m) => m.t >= t && m.ref?.id === f.id && m.topic !== 'head').length).toBe(0);
    expect(g.now).toBeLessThan(f.std + DAY);
  });
});
