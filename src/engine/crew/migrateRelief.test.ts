// v0.18.3 old saves: cruise relief pilots become first officers (crew, seats, hire orders), one Inbox note, once.

import { describe, expect, it } from 'vitest';
import type { GameState } from '../core/types';
import { deserialize, serialize } from '../save';
import { addCrew, fixtureGame } from './fixtures';
import { complement, canFill } from '../core/perf';
import { crewPay, migrateRelief } from '.';

/** An old save's shape: a relief pilot on the books, in a seat and on order (roles the game no longer has). */
function oldSave(): { g: GameState; crp: string } {
  const g = fixtureGame();
  const [crp] = addCrew(g, { FO: 1 }, 'A330/340');
  const c = g.crew[crp] as unknown as { role: string; salary: number; hired: number };
  c.role = 'CRP';
  c.salary = 5_500;
  const p = Object.values(g.pairings)[0];
  if (p) (p.slots as { role: string; crewId: string | null; above?: boolean }[]).push({ role: 'CRP', crewId: null, above: true });
  (g.hires as unknown as { role: string }[]).push({ ...(g.hires[0] ?? { id: 'h1', family: 'A330/340', base: 'LIS', crewId: crp, ordered: g.now, ready: g.now, cost: 0 }), role: 'CRP' });
  return { g, crp };
}

describe('v0.18.3 no cruise relief rank', () => {
  it('3 pilots are 1 CPT + 2 FO, 4 are 2 + 2; a captain may sit in any FO seat', () => {
    expect(complement('a333', 300, { augment: 1 }).filter((r) => r === 'CPT' || r === 'FO')).toEqual(['CPT', 'FO', 'FO']);
    expect(complement('a333', 300, { augment: 2 }).filter((r) => r === 'CPT' || r === 'FO')).toEqual(['CPT', 'CPT', 'FO', 'FO']);
    expect(canFill('FO', 'CPT')).toBe(true);
    expect(canFill('CPT', 'FO')).toBe(false);
  });
  it('a relief pilot becomes a first officer: same ratings and hire date, FO pay, seats and orders too, one note', () => {
    const { g, crp } = oldSave();
    const before = { ...g.crew[crp] };
    const n0 = g.messages.length;
    expect(migrateRelief(g)).toBeGreaterThan(0);
    const c = g.crew[crp];
    expect(c.role).toBe('FO');
    expect(c.ratings).toEqual(before.ratings);
    expect(c.hired).toBe(before.hired);
    expect(c.salary).toBe(Math.max(5_500, crewPay(g, c)));
    expect(c.salary).toBeGreaterThan(5_500);
    expect(Object.values(g.pairings).every((p) => p.slots.every((s) => (s.role as string) !== 'CRP'))).toBe(true);
    expect(g.hires.every((h) => (h.role as string) !== 'CRP')).toBe(true);
    expect(g.messages.length).toBe(n0 + 1);
    expect(g.messages[0].title).toBe('Cruise relief pilots are now first officers');
    // Once only.
    expect(migrateRelief(g)).toBe(0);
    expect(g.messages.length).toBe(n0 + 1);
  });
  it('an old save loads with them as first officers and the note', () => {
    const { g, crp } = oldSave();
    const h = deserialize(serialize(g));
    expect(h.crew[crp].role).toBe('FO');
    expect(h.messages.filter((m) => m.title === 'Cruise relief pilots are now first officers')).toHaveLength(1);
    const again = deserialize(serialize(h));
    expect(again.messages.filter((m) => m.title === 'Cruise relief pilots are now first officers')).toHaveLength(1);
  });
});
