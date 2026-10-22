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
  it('counts down in h:mm, then shows the time', () => {
    expect(countdown(80, 0)).toBe('1:20');
    expect(countdown(5, 0)).toBe('0:05');
    expect(countdown(-3, 0)).toBe('0:00');
    expect(countdown(25 * 60, 8 * 60 + 30)).toBe('08:30');
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
