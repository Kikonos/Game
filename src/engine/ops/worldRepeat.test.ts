// v0.25 world events: one live event per zone (warIraq and airspaceIraq overlapped: 'reopened' while still closed),
// seasons for weather events, a cooldown per template and 'again' texts.

import { describe, expect, it } from 'vitest';
import { TPL_BY_ID } from '../../data/worldEvents';
import { DAY, toDate } from '../core/time';
import type { WorldEvent } from '../core/types';
import { newGame } from '../contracts/testkit';
import { AGAIN_DAYS, allowed, cooldownOf, dailyWorld, isLive, loadWorld, startEvent } from './world';

describe('v0.25 one live event per zone', () => {
  it('the Iraq war blocks the Iraq airspace closure while it lasts, and the other way round', () => {
    const g = newGame(7);
    const e = startEvent(g, TPL_BY_ID.warIraq);
    expect(allowed(g, TPL_BY_ID.airspaceIraq)).toBe(false);
    g.now = e.end + 1;
    expect(isLive(g, e)).toBe(false);
    const h = newGame(7);
    startEvent(h, TPL_BY_ID.airspaceIraq);
    expect(allowed(h, TPL_BY_ID.warIraq)).toBe(false);
  });

  it('over three years: never two live events in one zone, the same template never inside its cooldown, months kept', () => {
    for (const seed of [7, 41]) {
      const g = newGame(seed);
      const seen: WorldEvent[] = [];
      for (let i = 0; i < 3 * 365; i++) {
        g.now += DAY;
        dailyWorld(g);
        const live = (g.world?.events ?? []).filter((e) => isLive(g, e) && e.zoneId);
        expect(new Set(live.map((e) => e.zoneId)).size).toBe(live.length);
        for (const e of g.world?.events ?? []) if (!seen.includes(e)) seen.push(e);
      }
      const byTpl = new Map<string, number[]>();
      for (const e of seen) byTpl.set(e.tpl, [...(byTpl.get(e.tpl) ?? []), e.start]);
      for (const [tpl, starts] of byTpl) {
        const t = TPL_BY_ID[tpl];
        if (!t) continue;
        starts.sort((a, b) => a - b);
        for (let k = 1; k < starts.length; k++) expect(starts[k] - starts[k - 1]).toBeGreaterThanOrEqual(cooldownOf(t) * DAY);
        if (t.months) for (const s of starts) expect(t.months).toContain(toDate(s).getUTCMonth());
      }
    }
  });
});

describe('v0.25 seasons and repeats', () => {
  it('hurricanes at Punta Cana in the season (June–November), the Sindh floods in the monsoon', () => {
    expect(TPL_BY_ID.hurricanePuj.months).toEqual([5, 6, 7, 8, 9, 10]);
    expect(TPL_BY_ID.floodsSindh.months).toEqual([6, 7, 8]);
    expect(TPL_BY_ID.calimaCanaries.months).not.toContain(6);
    expect(TPL_BY_ID.windMadeira.months).not.toContain(6);
  });

  it('a strike is not called again for 60 days; inside 120 days the message says "again"', () => {
    const g = newGame(7);
    const t = TPL_BY_ID.strikeEnav;
    const e1 = startEvent(g, t);
    expect(e1.title).toBe(t.title);
    g.now = e1.end + DAY;
    expect(allowed(g, t)).toBe(false);
    g.now = e1.start + 61 * DAY;
    expect(allowed(g, t)).toBe(true);
    const e2 = startEvent(g, t);
    expect(e2.title).toBe(t.again!.title);
    g.now = e2.start + (AGAIN_DAYS + 1) * DAY;
    const e3 = startEvent(g, t);
    expect(e3.title).toBe(t.title);
  });

  it('a disaster does not repeat for a year and a half', () => {
    expect(cooldownOf(TPL_BY_ID.hurricanePuj)).toBe(540);
    expect(cooldownOf(TPL_BY_ID.quakeAdana)).toBe(540);
    expect(cooldownOf(TPL_BY_ID.coupNiger)).toBe(180);
    expect(cooldownOf(TPL_BY_ID.ashEtna)).toBe(30);
  });

  it('an older save: the last starts come from the events it kept; a fresh game gets nothing new', () => {
    const g = newGame(7);
    loadWorld(g);
    expect(g.world?.lastTpl).toBeUndefined();
    const e = startEvent(g, TPL_BY_ID.strikeEnav);
    delete g.world!.lastTpl;
    loadWorld(g);
    expect(g.world!.lastTpl).toEqual({ strikeEnav: e.start });
    expect(allowed(g, TPL_BY_ID.strikeEnav)).toBe(false);
  });
});
