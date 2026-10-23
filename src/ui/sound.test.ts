import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CUES } from '../engine/core/cues';
import { CAT_OF, COOLDOWN, CROSS_MS, holdAsleep, pickMerged, PRIORITY, SOUND_MEANING, SOUND_OF, type SoundEvent, type SoundId } from './sound';

describe('v0.9 sound table (§S.3)', () => {
  it('maps every engine cue to exactly one sound', () => {
    for (const c of CUES) expect(SOUND_OF[c], c).toBeTruthy();
  });

  it('keeps the urgent alarm for crew shortage and crew out of hours only', () => {
    const alarm = (Object.keys(SOUND_OF) as SoundEvent[]).filter((e) => SOUND_OF[e] === 'alarm').sort();
    expect(alarm).toEqual(['crewOutOfHours', 'crewShortage']);
  });

  it('matches the table in UPDATE-0.9.md §S.3', () => {
    const doc = readFileSync(new URL('../../docs/acmi/UPDATE-0.9.md', import.meta.url), 'utf8');
    const part = doc.slice(doc.indexOf('### S.3'), doc.indexOf('### S.4'));
    let rows = 0;
    for (const line of part.split('\n')) {
      if (!line.startsWith('| `')) continue;
      const cols = line.split('|').map((x) => x.trim());
      const events = [...cols[1].matchAll(/`(\w+)`/g)].map((m) => m[1]);
      const snd = /`(\w+)`/.exec(cols[cols.length - 2])?.[1];
      for (const e of events) expect(SOUND_OF[e as SoundEvent], e).toBe(snd);
      rows++;
    }
    expect(rows).toBeGreaterThan(20);
  });

  it('gives every chime and alert a priority and a cooldown, and every sound a test row', () => {
    for (const id of Object.keys(CAT_OF) as SoundId[]) {
      if (CAT_OF[id] === 'chimes' || CAT_OF[id] === 'alerts') {
        expect(PRIORITY[id], id).toBeGreaterThan(0);
        expect(COOLDOWN[id], id).toBeGreaterThan(0);
      }
      expect(SOUND_MEANING.some((m) => m.id === id), id).toBe(true);
    }
  });
});

describe('v0.9 merge and cooldown (§S.4)', () => {
  it('plays the highest priority of a burst once', () => {
    expect(pickMerged(['low', 'low', 'highLow', 'low', 'low', 'low'], null, 0)).toBe('highLow');
    expect(pickMerged(['high', 'alarm', 'double'], null, 0)).toBe('alarm');
  });
  it('v0.9 round 4: inside the 4 s cross-sound window only a request that outranks the last sound plays; after it a lower one plays', () => {
    expect(CROSS_MS).toBe(4_000);
    expect(pickMerged(['high'], { id: 'highLow', at: 0 }, 1_000)).toBeNull();
    expect(pickMerged(['triple'], { id: 'double', at: 0 }, 1_000)).toBe('triple');
    // An AOG double 5 s after a crew alarm is heard; 2 s after it is not (one meaning at a time).
    expect(pickMerged(['double'], { id: 'alarm', at: 0 }, 2_000)).toBeNull();
    expect(pickMerged(['double'], { id: 'alarm', at: 0 }, 5_000)).toBe('double');
    expect(pickMerged(['high'], { id: 'triple', at: 0 }, 4_500)).toBe('high');
  });
  it('the same sound never repeats inside its own cooldown: the urgent alarm not twice in 20 s', () => {
    expect(COOLDOWN.alarm).toBe(20_000);
    expect(pickMerged(['alarm'], { id: 'alarm', at: 0 }, 19_000)).toBeNull();
    expect(pickMerged(['alarm'], { id: 'alarm', at: 0 }, 21_000)).toBe('alarm');
    expect(pickMerged(['triple'], { id: 'triple', at: 0 }, 9_000)).toBeNull();
    expect(pickMerged(['triple'], { id: 'triple', at: 0 }, 11_000)).toBe('triple');
  });
  it('asleep (interrupted context): nothing renders and at most the highest-priority request is held for the resume', () => {
    expect(holdAsleep(['low', 'high', 'double', 'high'])).toEqual(['double']);
    expect(holdAsleep(['low', 'alarm', 'triple'])).toEqual(['alarm']);
    expect(holdAsleep([])).toEqual([]);
    expect(holdAsleep(['low', 'low', 'low']).length).toBeLessThanOrEqual(1);
  });
});
