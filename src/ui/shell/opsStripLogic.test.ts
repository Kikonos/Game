import { describe, expect, it } from 'vitest';
import { countdown, fitStrip, type StripId } from './opsStripLogic';
import { hurtTone, keepHurt } from '../modals/crewControlLogic';

const items = (warns: StripId[]) => [
  ...warns.map((id) => ({ id, warn: true, w: 140 })),
  { id: 'next' as const, warn: false, w: 180 },
  { id: 'airborne' as const, warn: false, w: 80 },
  { id: 'onTime' as const, warn: false, w: 100 },
  { id: 'crew' as const, warn: false, w: 160 },
];

describe('v0.7.2 ops strip fit', () => {
  it('keeps everything when it fits', () => {
    const r = fitStrip(items([]), 2000, 8, 52);
    expect([...r.show].sort()).toEqual(['airborne', 'crew', 'next', 'onTime']);
    expect(r.folded).toBe(0);
  });
  it('drops CREW, then ON TIME, then AIRBORNE, then NEXT', () => {
    expect([...fitStrip(items([]), 380, 8, 52).show].sort()).toEqual(['airborne', 'next', 'onTime']);
    expect([...fitStrip(items([]), 270, 8, 52).show].sort()).toEqual(['airborne', 'next']);
    expect([...fitStrip(items([]), 190, 8, 52).show]).toEqual(['next']);
    expect([...fitStrip(items(['crewShort']), 150, 8, 52).show]).toEqual(['crewShort']);
  });
  it('never drops warnings: extra ones fold into +N', () => {
    const r = fitStrip(items(['crewShort', 'aog', 'market']), 260, 8, 52);
    expect([...r.show]).toEqual(['crewShort']);
    expect(r.folded).toBe(2);
    const one = fitStrip(items(['crewShort']), 10, 8, 52);
    expect([...one.show]).toEqual(['crewShort']);
  });
  it('says when as the whole phrase: a duration under 24 h, a date and time (no "in") from 24 h', () => {
    const now = 1440 * 3 + 8 * 60 + 30;
    expect(countdown(now + 80, now)).toBe('in 1h 20m');
    expect(countdown(now + 5, now)).toBe('in 5m');
    expect(countdown(now + 600, now)).toBe('in 10h');
    expect(countdown(now - 3, now)).toBe('now');
    expect(countdown(now + 24 * 60 - 1, now)).toBe('in 23h 59m');
    const at24 = countdown(now + 24 * 60, now);
    expect(at24).not.toMatch(/^in /);
    expect(at24).toMatch(/ 08:30$/);
    const far = countdown(now + 40 * 60, now);
    expect(far).toMatch(/^\d{1,2} [A-Z][a-z]{2} 00:30$/);
  });
  it('slims warning chips before dropping ON TIME, so two facts sit beside a warning', () => {
    const it = [{ id: 'market' as const, warn: true, w: 170, ws: 120 }, ...items([])];
    // full: 170+180+80+100+160 + 4·8 = 722; without CREW 554; slim 504.
    const r = fitStrip(it, 510, 8, 52);
    expect(r.slim).toBe(true);
    expect([...r.show].sort()).toEqual(['airborne', 'market', 'next', 'onTime']);
    const wide = fitStrip(it, 560, 8, 52);
    expect(wide.slim).toBe(false);
    expect(wide.show.has('crew')).toBe(false);
  });
});

describe('v0.7.2 sub-charter Hurts chips', () => {
  it('red from −3, amber below, null for other chips', () => {
    expect(hurtTone('Hurts: reliability −2 · the client notices')).toBe('warn');
    expect(hurtTone('Hurts: reliability −3.4 · the client notices')).toBe('bad');
    expect(hurtTone('$38K')).toBeNull();
  });
  it('keeps the Hurts chip when trimming', () => {
    expect(keepHurt(['a', 'b', 'c', 'Hurts: reliability −1'], 3)).toEqual(['a', 'b', 'Hurts: reliability −1']);
  });
});
