import { describe, expect, it } from 'vitest';
import { GLOSSARY } from './glossary';
import { CURRENT, unseenEntries, WHATS_NEW, whatsNewToShow } from './whatsNew';

const v = (xs: { version: string }[]) => xs.map((e) => e.version);

describe("v0.9 What's new catch-up (UPDATE-0.9.md §X)", () => {
  it('first v0.9 launch shows v0.9, v0.8 and v0.7.4 even when v0.8 was seen; then the normal rule', () => {
    // v0.9.1 is the newest now: it comes first and a v0.9 player sees it alone.
    // v0.18 is the newest now: it comes first (v0.17.2 went out with it). v0.18.1 after it.
    expect(CURRENT.version).toBe('v0.19.3');
    expect(v(whatsNewToShow('v0.8', false))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12', 'v0.11.4', 'v0.11.3', 'v0.11.2', 'v0.11.1', 'v0.11', 'v0.10.1', 'v0.10', 'v0.9.1', 'v0.9', 'v0.8', 'v0.7.4']);
    expect(v(whatsNewToShow('v0.8', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12', 'v0.11.4', 'v0.11.3', 'v0.11.2', 'v0.11.1', 'v0.11', 'v0.10.1', 'v0.10', 'v0.9.1', 'v0.9']);
    expect(v(whatsNewToShow('v0.9', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12', 'v0.11.4', 'v0.11.3', 'v0.11.2', 'v0.11.1', 'v0.11', 'v0.10.1', 'v0.10', 'v0.9.1']);
    expect(v(whatsNewToShow('v0.9.1', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12', 'v0.11.4', 'v0.11.3', 'v0.11.2', 'v0.11.1', 'v0.11', 'v0.10.1', 'v0.10']);
    expect(v(whatsNewToShow('v0.10', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12', 'v0.11.4', 'v0.11.3', 'v0.11.2', 'v0.11.1', 'v0.11', 'v0.10.1']);
    expect(v(whatsNewToShow('v0.10.1', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12', 'v0.11.4', 'v0.11.3', 'v0.11.2', 'v0.11.1', 'v0.11']);
    expect(v(whatsNewToShow('v0.11', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12', 'v0.11.4', 'v0.11.3', 'v0.11.2', 'v0.11.1']);
    expect(v(whatsNewToShow('v0.11.1', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12', 'v0.11.4', 'v0.11.3', 'v0.11.2']);
    expect(v(whatsNewToShow('v0.11.2', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12', 'v0.11.4', 'v0.11.3']);
    expect(v(whatsNewToShow('v0.11.3', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12', 'v0.11.4']);
    expect(v(whatsNewToShow('v0.11.4', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12']);
    expect(v(whatsNewToShow('v0.12', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13']);
    expect(v(whatsNewToShow('v0.13', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14']);
    expect(v(whatsNewToShow('v0.14', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1']);
    expect(v(whatsNewToShow('v0.14.1', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15']);
    expect(v(whatsNewToShow('v0.15', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16']);
    expect(v(whatsNewToShow('v0.16', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1']);
    expect(v(whatsNewToShow('v0.16.1', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2']);
    expect(v(whatsNewToShow('v0.16.2', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3']);
    expect(v(whatsNewToShow('v0.16.3', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4']);
    expect(v(whatsNewToShow('v0.16.4', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17']);
    expect(v(whatsNewToShow('v0.17', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1']);
    expect(v(whatsNewToShow('v0.17.1', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2']);
    expect(v(whatsNewToShow('v0.17.2', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18']);
    expect(v(whatsNewToShow('v0.18', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1']);
    expect(v(whatsNewToShow('v0.18.1', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2']);
    expect(v(whatsNewToShow('v0.18.2', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3']);
    expect(v(whatsNewToShow('v0.18.3', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19']);
    expect(v(whatsNewToShow('v0.19', true))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1']);
    expect(v(whatsNewToShow('v0.19.1', true))).toEqual(['v0.19.2']);
    expect(whatsNewToShow('v0.19.2', true)).toEqual([]);
    expect(v(whatsNewToShow('v0.7.4', false))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12', 'v0.11.4', 'v0.11.3', 'v0.11.2', 'v0.11.1', 'v0.11', 'v0.10.1', 'v0.10', 'v0.9.1', 'v0.9', 'v0.8', 'v0.7.4']);
  });
  it('v0.19.3 leave from away on top, v0.19.2 kept below it, in plain words', () => {
    expect(WHATS_NEW.slice(0, 2).map((e) => `${e.version} ${e.name}`)).toEqual(['v0.19.3 Leave from away', 'v0.19.2 Your own routes']);
    const txt = [...WHATS_NEW[0].features, ...WHATS_NEW[0].improvements, ...(WHATS_NEW[0].fixes ?? [])].join('\n');
    for (const s of ['first day of leave', 'last day', 'next duty', 'keeps its days', 'not duty', 'SGN→LIS']) expect(txt).toContain(s);
    expect(txt).not.toMatch(/§|leaveTrip|FTL\.|horizon/);
  });
  it('v0.19.2 your own routes on top, v0.19.1 kept below it, in plain words', () => {
    expect(WHATS_NEW.slice(1, 3).map((e) => `${e.version} ${e.name}`)).toEqual(['v0.19.2 Your own routes', 'v0.19.1 Emergency swap']);
    const txt = [...WHATS_NEW[1].features, ...WHATS_NEW[1].improvements, ...(WHATS_NEW[1].fixes ?? [])].join('\n');
    for (const s of ['Build your own route', 'any airport', 'fuel stops', 'rough guess', 'flat map', 'Range from', '"5 weeks"', 'paint shop']) expect(txt).toContain(s);
    expect(txt).not.toMatch(/§|O&D|ETOPS cap|customTruth/);
  });
  it('v0.19 scheduled routes on top, v0.18.3 kept below it (one release), in plain words', () => {
    expect(WHATS_NEW.slice(3, 5).map((e) => `${e.version} ${e.name}`)).toEqual(['v0.19 Scheduled routes', 'v0.18.3 Pilot pairs']);
    const txt = [...WHATS_NEW[3].features, ...WHATS_NEW[3].improvements, ...(WHATS_NEW[3].fixes ?? [])].join('\n');
    for (const s of ['Contracts › Network', 'market study', 'recommends', 'load factor', 'live animals', 'drag it: the whole rotation moves', 'sub-charter (no penalty)', 'ticket cash']) expect(txt).toContain(s);
    // The same release: the screen polish, the smooth map and the second bug batch of 8 Nov.
    for (const s of ['Calmer screens', 'Panning and zooming the map is smooth', 'Annual leave starts and ends at home', 'Day off moved', 'stay on standby at the hotel', 'crew out of hours']) expect(txt).toContain(s);
    expect(txt).not.toMatch(/§|EU261|unearned/);
  });
  it('v0.18.3 pilot pairs (no cruise relief rank), Convert, the map strip and the calendar, in plain words', () => {
    expect(WHATS_NEW.slice(4, 6).map((e) => `${e.version} ${e.name}`)).toEqual(['v0.18.3 Pilot pairs', 'v0.18.2 Crew utilisation']);
    const e183 = WHATS_NEW[4];
    const txt = [...e183.features, ...e183.improvements, ...(e183.fixes ?? [])].join('\n');
    for (const s of ['3 pilots are a captain and 2 first officers', 'pairs A and B', 'sit as first officer', 'at the controls', 'Convert', 'scrolls sideways', 'All aircraft', 'Positioning', 'layover', 'Cruise relief pilots are now first officers']) expect(txt).toContain(s);
    expect(txt).not.toMatch(/\bCRP\b/);
  });
  it('v0.18.2 crew utilisation, in plain words, with the weekly-rest and leave fixes', () => {
    expect(WHATS_NEW.slice(5, 7).map((e) => `${e.version} ${e.name}`)).toEqual(['v0.18.2 Crew utilisation', 'v0.18.1 Leave & monthly rosters']);
    const v182 = WHATS_NEW[5];
    const txt = [...v182.features, ...v182.improvements, ...(v182.fixes ?? [])].join('\n');
    for (const s of ['Crew › Utilisation', '60–85 h a month', 'unpaid leave', 'redundant', 'follow the flying', 'stands one down', 'stops hiring', '168 h', 'Leave no longer cuts a rotation']) expect(txt).toContain(s);
  });
  it('v0.18.1 leave and the monthly roster, in plain words, with the fixes from the reports', () => {
    expect(WHATS_NEW.slice(6, 9).map((e) => `${e.version} ${e.name}`)).toEqual(['v0.18.1 Leave & monthly rosters', 'v0.18 Rosters, maps & spec sheets', 'v0.17.2 Your reports']);
    const v181 = WHATS_NEW[6];
    const txt = [...v181.features, ...v181.improvements, ...(v181.fixes ?? [])].join('\n');
    for (const s of ['yearly allowance', 'Crew › Leave', 'comes out on the 15th', 'layover', 'boarding passes', 'flight numbers']) expect(txt).toContain(s);
  });
  it('v0.18 goes out with v0.17.2: both entries, the spec sheets in v0.18', () => {
    expect(WHATS_NEW.slice(7, 9).map((e) => `${e.version} ${e.name}`)).toEqual(['v0.18 Rosters, maps & spec sheets', 'v0.17.2 Your reports']);
    const v18 = WHATS_NEW[7];
    const all = [...v18.features, ...v18.improvements].join('\n');
    for (const s of ['Aircraft spec sheets', 'A seat map for every type', 'Compare up to three Market offers', 'their own sheet', 'wraps east–west']) expect(all).toContain(s);
  });
  it('a fresh install gets the newest only; an older player everything since their version', () => {
    expect(whatsNewToShow('', false)).toEqual([CURRENT]);
    expect(v(whatsNewToShow('v0.7.2', false))).toEqual(['v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12', 'v0.11.4', 'v0.11.3', 'v0.11.2', 'v0.11.1', 'v0.11', 'v0.10.1', 'v0.10', 'v0.9.1', 'v0.9', 'v0.8', 'v0.7.4', 'v0.7.3', 'v0.7.2.2', 'v0.7.2.1']);
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
