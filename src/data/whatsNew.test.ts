import { describe, expect, it } from 'vitest';
import { GLOSSARY } from './glossary';
import { CURRENT, unseenEntries, WHATS_NEW, whatsNewToShow } from './whatsNew';

const v = (xs: { version: string }[]) => xs.map((e) => e.version);

describe("v0.9 What's new catch-up (UPDATE-0.9.md §X)", () => {
  it('first v0.9 launch shows v0.9, v0.8 and v0.7.4 even when v0.8 was seen; then the normal rule', () => {
    // v0.9.1 is the newest now: it comes first and a v0.9 player sees it alone.
    // v0.10.1 is the newest now: it comes first.
    expect(CURRENT.version).toBe('v0.10.1');
    expect(v(whatsNewToShow('v0.8', false))).toEqual(['v0.10.1', 'v0.10', 'v0.9.1', 'v0.9', 'v0.8', 'v0.7.4']);
    expect(v(whatsNewToShow('v0.8', true))).toEqual(['v0.10.1', 'v0.10', 'v0.9.1', 'v0.9']);
    expect(v(whatsNewToShow('v0.9', true))).toEqual(['v0.10.1', 'v0.10', 'v0.9.1']);
    expect(v(whatsNewToShow('v0.9.1', true))).toEqual(['v0.10.1', 'v0.10']);
    expect(v(whatsNewToShow('v0.10', true))).toEqual(['v0.10.1']);
    expect(whatsNewToShow('v0.10.1', true)).toEqual([]);
    expect(v(whatsNewToShow('v0.7.4', false))).toEqual(['v0.10.1', 'v0.10', 'v0.9.1', 'v0.9', 'v0.8', 'v0.7.4']);
  });
  it('a fresh install gets the newest only; an older player everything since their version', () => {
    expect(whatsNewToShow('', false)).toEqual([CURRENT]);
    expect(v(whatsNewToShow('v0.7.2', false))).toEqual(['v0.10.1', 'v0.10', 'v0.9.1', 'v0.9', 'v0.8', 'v0.7.4', 'v0.7.3', 'v0.7.2.2', 'v0.7.2.1']);
    expect(whatsNewToShow('v0.7.2', true)).toEqual(unseenEntries('v0.7.2'));
  });
  it("v0.9.1: the tuning entry lists the music and the crew changes in plain words", () => {
    const e = WHATS_NEW.find((x) => x.version === 'v0.9.1')!;
    const all = [...e.features, ...e.improvements].join('\n');
    expect(all).toContain('Calm background music (Settings → Sound to change the volume or turn it off).');
    expect(all).toMatch(/can’t be crewed in time/);
  });
});


describe('v0.9 round 4 texts (§V, §Y.2, §R)', () => {
  it("What's new: every 450-seat type, fuel at cost on charters not Hajj, the catch-up rule, one days-off phrase", () => {
    const v09 = WHATS_NEW.find((e) => e.version === 'v0.9')!;
    const all = [...v09.features, ...v09.improvements].join('\n');
    expect(all).toMatch(/Jumbo loads \(420\+ seats\) for the 747-400 and other 450-seat jets, and charters with fuel billed at cost/);
    expect(all).not.toMatch(/Hajj[^.]*with fuel at cost/);
    expect(all).toMatch(/also shows the notes of the versions you skipped, once/);
    expect(all).toMatch(/8–10 days off a month in 2–3-day blocks \(one block a week is the 36 h rest\) and 4 weeks’ leave/);
  });
  it('glossary: the A380 takes a jumbo load, fuel at cost is a government and military term, standby cuts the day that follows', () => {
    expect(GLOSSARY.jumboLoad.short).toMatch(/only a 777-300ER, a 747-400 or an A380 takes it in one go\.$/);
    expect(GLOSSARY.fuelAtCost.short).toMatch(/Common on government and military charters\.$/);
    expect(GLOSSARY.fuelAtCost.short).not.toContain('Hajj');
    expect(GLOSSARY.airportStandby.short).toBe('Standby at the airport, ready at once. It counts in full as duty; called after 4 h, the day that follows is cut by the standby beyond 4 h; standby plus flying stays within 16 h.');
    expect(GLOSSARY.homeStandby.short).toMatch(/called after 6 h, the day is cut by the standby beyond 6 h\.$/);
    expect(GLOSSARY.daysOff.short).toMatch(/8–10 days off a month in 2–3-day blocks \(one block a week is the 36 h rest\) and 4 weeks’ leave/);
  });
});
