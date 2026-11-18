// v0.25 (the Malteser save, 3 Aug 2027): seven 'goes home early' notes chimed in one minute, each reading 'Block 28d
// 102:07 > 100:00'. A burst for one set is one Inbox note now, the reason in plain words; day lists read 'A, B and C'.

import { describe, expect, it } from 'vitest';
import { dayList } from './buyBack';
import { plainWhy } from './reasons';

describe('plain reasons', () => {
  it('reads the limits in words', () => {
    expect(plainWhy('Block 28d 102:07 > 100:00')).toBe('Over 100 block hours in 28 days');
    expect(plainWhy('Duty 7d 61:10 > 60:00')).toBe('Over 60 duty hours in 7 days');
    expect(plainWhy('Block year 901:00 > 900:00')).toBe('Over 900 block hours this year');
    expect(plainWhy('Rest 9:58 < 10:00')).toBe('Short of rest (9:58 of 10:00)');
    expect(plainWhy('No 36 h recovery in 168 h')).toBe('Due a weekly rest (36 h off)');
    expect(plainWhy('Trip dissolved')).toBe('Trip dissolved');
  });
  it('lists days with the month once', () => {
    const k = Math.floor(Date.UTC(2027, 8, 9) / 86_400_000) - Math.floor(Date.UTC(2000, 0, 1) / 86_400_000);
    expect(dayList([k])).toBe('Thu 9 Sep 2027');
    expect(dayList([k, k + 1, k + 2])).toBe('Thu 9, Fri 10 and Sat 11 Sep 2027');
    expect(dayList([k + 21, k + 22])).toBe('Thu 30 Sep 2027 and Fri 1 Oct 2027');
  });
});

describe('goes home early: one note per set and minute', () => {
  it('merges the names of a burst into one unread note', async () => {
    const { fixtureGame } = await import('./fixtures');
    const { earlyHomeNote } = await import('./roster');
    const g = fixtureGame();
    const [a, b, c, d] = Object.values(g.crew);
    const n0 = g.messages.length;
    const tail = 'day 5 of 35; the set was due home 24 Aug 2027 12:00.';
    earlyHomeNote(g, a, 'Set 2 at RUH', 'Over 100 block hours in 28 days', tail);
    expect(g.messages[0].title).toBe(`${a.first} ${a.last} goes home early`);
    expect(g.messages[0].body).toBe(`Over 100 block hours in 28 days. Set 2 at RUH, ${tail}`);
    earlyHomeNote(g, b, 'Set 2 at RUH', 'Over 100 block hours in 28 days', tail);
    earlyHomeNote(g, c, 'Set 2 at RUH', 'Short of rest (9:58 of 10:00)', tail);
    // Another set: its own note.
    earlyHomeNote(g, d, 'Set 1 at RUH', 'Over 100 block hours in 28 days', tail);
    expect(g.messages.length - n0).toBe(2);
    const m = g.messages.find((x) => x.title.startsWith('Set 2 at RUH'))!;
    expect(m.title).toBe('Set 2 at RUH: 3 crew go home early');
    expect(m.body).toBe(`${a.first} ${a.last} and ${b.first} ${b.last}: over 100 block hours in 28 days; ${c.first} ${c.last}: short of rest (9:58 of 10:00). Set 2 at RUH, ${tail}`);
    // Read, or a minute later: a new note.
    m.read = true;
    earlyHomeNote(g, d, 'Set 2 at RUH', 'Over 100 block hours in 28 days', tail);
    expect(g.messages.length - n0).toBe(3);
  });
});
