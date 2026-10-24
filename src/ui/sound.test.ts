import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CUES } from '../engine/core/cues';
import { audible, CAT_OF, COOLDOWN, CROSS_MS, holdAsleep, LO_AFTER, pickMerged, PRIORITY, SEQ, SOUND_MEANING, SOUND_OF, type SoundEvent, type SoundId } from './sound';

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
    expect(pickMerged(['lo', 'lo', 'hiLo', 'lo', 'lo', 'lo'], null, 0)).toBe('hiLo');
    expect(pickMerged(['hi', 'alarm', 'hi2'], null, 0)).toBe('alarm');
  });
  it('v0.9 round 4: inside the 4 s cross-sound window only a request that outranks the last sound plays; after it a lower one plays', () => {
    expect(CROSS_MS).toBe(4_000);
    expect(pickMerged(['hi'], { id: 'hiLo', at: 0 }, 1_000)).toBeNull();
    expect(pickMerged(['hi3'], { id: 'hi2', at: 0 }, 1_000)).toBe('hi3');
    // An AOG double 5 s after a crew alarm is heard; 2 s after it is not (one meaning at a time).
    expect(pickMerged(['hi2'], { id: 'alarm', at: 0 }, 2_000)).toBeNull();
    expect(pickMerged(['hi2'], { id: 'alarm', at: 0 }, 5_000)).toBe('hi2');
    expect(pickMerged(['hi'], { id: 'hi3', at: 0 }, 4_500)).toBe('hi');
  });
  it('the same sound never repeats inside its own cooldown: the urgent alarm not twice in 20 s', () => {
    expect(COOLDOWN.alarm).toBe(20_000);
    expect(pickMerged(['alarm'], { id: 'alarm', at: 0 }, 19_000)).toBeNull();
    expect(pickMerged(['alarm'], { id: 'alarm', at: 0 }, 21_000)).toBe('alarm');
    expect(pickMerged(['hi3'], { id: 'hi3', at: 0 }, 9_000)).toBeNull();
    expect(pickMerged(['hi3'], { id: 'hi3', at: 0 }, 11_000)).toBe('hi3');
  });
  it('asleep (interrupted context): nothing renders and at most the highest-priority request is held for the resume', () => {
    expect(holdAsleep(['lo', 'hi', 'hi2', 'hi'])).toEqual(['hi2']);
    expect(holdAsleep(['lo', 'alarm', 'hi3'])).toEqual(['alarm']);
    expect(holdAsleep([])).toEqual([]);
    expect(holdAsleep(['lo', 'lo', 'lo']).length).toBeLessThanOrEqual(1);
  });
});

describe('v0.9.1 sampled cabin chimes (§S.2)', () => {
  it('sequences the HI and LO samples like a cabin system: HIs 0.7–0.9 s apart, the LO after its HI as recorded', () => {
    expect(SEQ.hiLo).toEqual([['hi', 0], ['lo', LO_AFTER]]);
    expect(LO_AFTER).toBeGreaterThan(0.7);
    expect(LO_AFTER).toBeLessThan(1);
    for (const id of ['hi2', 'hi3'] as SoundId[]) {
      const q = SEQ[id]!;
      expect(q.every(([k]) => k === 'hi')).toBe(true);
      for (let i = 1; i < q.length; i++) {
        expect(q[i][1] - q[i - 1][1]).toBeGreaterThanOrEqual(0.7);
        expect(q[i][1] - q[i - 1][1]).toBeLessThanOrEqual(0.9);
      }
    }
    expect(SEQ.hi2).toHaveLength(2);
    expect(SEQ.hi3).toHaveLength(3);
    expect(SEQ.lo2!.map(([k]) => k)).toEqual(['lo', 'lo']);
  });
  it('the player\'s mapping: offer HI-LO, attention 1 HI, emergencies 2 HI, urgent 3 HI, calm 1 LO, milestones 2 LO; pause and resume silent', () => {
    expect(SOUND_OF.offerNew).toBe('hiLo');
    for (const e of ['counterReply', 'decision', 'notice'] as SoundEvent[]) expect(SOUND_OF[e], e).toBe('hi');
    for (const e of ['aog', 'sickCall', 'latePayer', 'offerLapsing', 'delayPenalty'] as SoundEvent[]) expect(SOUND_OF[e], e).toBe('hi2');
    for (const e of ['cancelRisk', 'airspaceActive', 'cashNegative', 'evacuation'] as SoundEvent[]) expect(SOUND_OF[e], e).toBe('hi3');
    for (const e of ['contractSigned', 'crewJoined', 'paymentIn', 'flightDep', 'flightArr'] as SoundEvent[]) expect(SOUND_OF[e], e).toBe('lo');
    for (const e of ['achievement', 'headUnlocked', 'delivered'] as SoundEvent[]) expect(SOUND_OF[e], e).toBe('lo2');
    expect('pause' in SOUND_OF || 'resume' in SOUND_OF).toBe(false);
    // No triple HI-LO left: every sequence with a LO after a HI is the single offer chime.
    for (const [id, q] of Object.entries(SEQ)) if (q!.some(([k]) => k === 'lo') && q!.some(([k]) => k === 'hi')) expect(id).toBe('hiLo');
  });
  it('flight chimes only when switched on; nothing with the master off', () => {
    const cfg = { on: true, cats: { alerts: true, chimes: true, flights: false, ui: true } };
    expect(audible(cfg, 'flightDep')).toBe(false);
    expect(audible({ ...cfg, cats: { ...cfg.cats, flights: true } }, 'flightArr')).toBe(true);
    expect(audible({ ...cfg, on: false }, 'offerNew')).toBe(false);
  });
});
