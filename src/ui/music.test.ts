import { describe, expect, it, vi } from 'vitest';
import { DUCK, MUSIC_FADE, MUSIC_GAIN, musicLevel, MusicPlayer } from './music';
import { settingsFrom } from './store';
import { CAT_OF, SOUND_MEANING } from './sound';

/** A recording stand-in for the WebAudio graph: params log their automation, sources count their starts. */
class Param {
  value: number;
  calls: [string, number, number?, number?][] = [];
  constructor(v = 1) {
    this.value = v;
  }
  setTargetAtTime(v: number, t: number, tau: number) { this.calls.push(['target', v, t, tau]); }
  cancelScheduledValues(t: number) { this.calls.push(['cancel', t]); }
  setValueAtTime(v: number, t: number) { this.calls.push(['set', v, t]); }
  linearRampToValueAtTime(v: number, t: number) { this.calls.push(['lin', v, t]); }
  exponentialRampToValueAtTime(v: number, t: number) { this.calls.push(['exp', v, t]); }
}
class Node {
  gain = new Param();
  frequency = new Param(440);
  detune = new Param(0);
  delayTime = new Param(0);
  Q = new Param(1);
  type = '';
  connect<T>(n: T): T { return n; }
}
class Source extends Node {
  starts: number[] = [];
  start(t: number) { this.starts.push(t); }
  stop() {}
}
class MockCtx {
  currentTime = 10;
  state: 'running' | 'suspended' = 'running';
  sources: Source[] = [];
  createGain() { return new Node(); }
  createBiquadFilter() { return new Node(); }
  createDelay() { return new Node(); }
  createOscillator() { const s = new Source(); this.sources.push(s); return s; }
}
const player = (ctx: MockCtx) => new MusicPlayer(ctx as unknown as AudioContext, new Node() as unknown as AudioNode, () => 0.5);

describe('v0.9.1 background music: settings', () => {
  it('is on by default at a low volume; old settings without it get the defaults; a choice is kept', () => {
    const d = settingsFrom({});
    expect(d.music).toBe(true);
    expect(d.musicVolume).toBeGreaterThan(0);
    expect(d.musicVolume).toBeLessThanOrEqual(0.4);
    // A v0.9 settings blob (no music fields) keeps its own choices and gains the music at its default.
    const old = settingsFrom({ sound: true, volume: 0.8, ambience: 'cabin' });
    expect(old.music).toBe(true);
    expect(old.ambience).toBe('cabin');
    expect(settingsFrom({ music: false, musicVolume: 0.7 })).toMatchObject({ music: false, musicVolume: 0.7 });
  });

  it('plays only with the master switch and the Music switch on, at the Music volume, never while the app is hidden; ambience stays its own setting', () => {
    const cfg = { on: true, music: true, musicVolume: 0.5 };
    expect(musicLevel(cfg, true)).toBeCloseTo(0.5 * MUSIC_GAIN);
    expect(musicLevel({ ...cfg, music: false }, true)).toBe(0);
    expect(musicLevel({ ...cfg, on: false }, true)).toBe(0);
    expect(musicLevel(cfg, false)).toBe(0);
    expect(CAT_OF.music).toBe('music');
    expect(CAT_OF.ambCabin).toBe('ambience');
    expect(SOUND_MEANING.some((m) => m.id === 'music' && m.name === 'Music')).toBe(true);
  });
});

describe('v0.9.1 background music: fades, ducking, scheduling', () => {
  it('fades in and out over a few seconds (never a cut), and stops scheduling once silent', () => {
    vi.useFakeTimers();
    const ctx = new MockCtx();
    const p = player(ctx);
    p.setLevel(0.1);
    const g = p.gainParam as unknown as Param;
    const up = g.calls.find((c) => c[0] === 'target')!;
    expect(up[1]).toBe(0.1);
    expect(up[3]! * 3).toBeCloseTo(MUSIC_FADE);
    expect(p.running).toBe(true);
    // Hidden: to silence with a time constant (a fade), not a set to 0.
    g.calls = [];
    g.value = 0.1;
    p.setLevel(0, 1.5);
    expect(g.calls.some((c) => c[0] === 'set' && c[1] === 0)).toBe(false);
    expect(g.calls.find((c) => c[0] === 'target')).toEqual(['target', 0, 10, 0.5]);
    g.value = 0.0001;
    p.tick();
    expect(p.running).toBe(false);
    vi.useRealTimers();
  });

  it('dips under a chime or an alarm and comes back after it', () => {
    vi.useFakeTimers();
    const ctx = new MockCtx();
    const p = player(ctx);
    p.setLevel(0.1);
    p.duck(2.6);
    const d = (p.duckParam as unknown as Param).calls.filter((c) => c[0] === 'target');
    expect(d[0]).toEqual(['target', DUCK.level, 10, DUCK.downTau]);
    expect(d[1][1]).toBe(1);
    expect(d[1][2]).toBeCloseTo(12.6);
    p.stop();
    vi.useRealTimers();
  });

  it('schedules notes a few seconds ahead from a timer, none while the context sleeps, and no burst of old notes on the resume', () => {
    vi.useFakeTimers();
    const ctx = new MockCtx();
    const p = player(ctx);
    p.setLevel(0.1);
    const n = ctx.sources.length;
    expect(n).toBeGreaterThan(0);
    for (const s of ctx.sources) expect(Math.min(...s.starts)).toBeLessThan(ctx.currentTime + 4 + 8);
    // Asleep: the timer ticks, nothing is scheduled.
    ctx.state = 'suspended';
    vi.advanceTimersByTime(30_000);
    expect(ctx.sources.length).toBe(n);
    // Awake 5 minutes later: new notes start from now, not in the past.
    ctx.state = 'running';
    ctx.currentTime += 300;
    vi.advanceTimersByTime(1_000);
    const fresh = ctx.sources.slice(n);
    expect(fresh.length).toBeGreaterThan(0);
    for (const s of fresh) expect(Math.min(...s.starts)).toBeGreaterThanOrEqual(ctx.currentTime);
    p.stop();
    vi.useRealTimers();
  });
});

describe('v0.12 the soundtrack: five pieces taking turns', () => {
  it('has five named pieces, each playable, and moves on to the next after its minutes', async () => {
    const { TRACKS } = await import('./music');
    expect(TRACKS.map((t) => t.name)).toEqual(['Cruise', 'Night Flight', 'Golden Hour', 'Ops Room', 'Long Haul']);
    vi.useFakeTimers();
    const ctx = new MockCtx();
    const p = player(ctx);
    p.setLevel(0.1);
    const first = p.track.name;
    const seen = new Set([first]);
    // Play on for longer than every piece's minutes put together: each one takes its turn.
    for (let i = 0; i < 25 * 60; i++) {
      ctx.currentTime += 1;
      vi.advanceTimersByTime(1000);
      seen.add(p.track.name);
    }
    expect(seen.size).toBe(TRACKS.length);
    p.stop();
    vi.useRealTimers();
  });

  it('Next piece changes the piece at once and keeps scheduling notes', () => {
    vi.useFakeTimers();
    const ctx = new MockCtx();
    const p = player(ctx);
    p.setLevel(0.1);
    const a = p.track.name;
    p.nextTrack();
    expect(p.track.name).not.toBe(a);
    const n = ctx.sources.length;
    ctx.currentTime += 10;
    vi.advanceTimersByTime(10_000);
    expect(ctx.sources.length).toBeGreaterThan(n);
    p.stop();
    vi.useRealTimers();
  });
});

describe('v0.15.1 Terminal: the menus\' lounge piece', () => {
  class LoungeCtx extends MockCtx {
    sampleRate = 8000;
    buffers = 0;
    createBufferSource() { const s = new Source(); this.sources.push(s); return s; }
    createBuffer(_ch: number, n: number) { this.buffers++; const d = new Float32Array(n); return { duration: n / 8000, getChannelData: () => d }; }
  }

  it('is its own piece, never in the in-game playlist, with the lounge arrangement, a Rhodes lead and maj9 harmony', async () => {
    const { TERMINAL, TRACKS, COMP, BASS_LINES, MELODY_SLOTS } = await import('./music');
    expect(TERMINAL.name).toBe('Terminal');
    expect(TERMINAL.lounge).toBe(true);
    expect(TERMINAL.lead).toBe('rhodes');
    expect(TERMINAL.bpm).toBeGreaterThanOrEqual(70);
    expect(TERMINAL.bpm).toBeLessThanOrEqual(84);
    expect(TRACKS).not.toContain(TERMINAL);
    expect(TRACKS.map((t) => t.name)).not.toContain('Terminal');
    // Slow ninth chords: every progression leans on maj9 / 9 / sus colours and keeps to the key's chords.
    for (const prog of TERMINAL.progressions) {
      expect(prog.length).toBe(4);
      expect(prog.filter((ch) => /9|sus/.test(ch)).length).toBeGreaterThanOrEqual(3);
    }
    // Keys a step apart (C to G), so the key moves gently.
    expect([...TERMINAL.keys].sort((a, b) => a - b)).toEqual(TERMINAL.keys);
    for (let i = 1; i < TERMINAL.keys.length; i++) expect(TERMINAL.keys[i] - TERMINAL.keys[i - 1]).toBeLessThanOrEqual(2);
    // Every pattern fits its two-bar chord.
    for (const pat of COMP) for (const [b, len] of pat) expect(b + len).toBeLessThanOrEqual(TERMINAL.chordBeats);
    for (const line of BASS_LINES) for (const [b, , len] of line) expect(b + len).toBeLessThanOrEqual(TERMINAL.chordBeats);
    for (const b of MELODY_SLOTS) expect(b).toBeLessThan(TERMINAL.chordBeats);
  });

  it('a Terminal player plays it alone and loops it without a gap: still Terminal, still scheduling, 20 minutes on', async () => {
    const { TERMINAL } = await import('./music');
    vi.useFakeTimers();
    const ctx = new LoungeCtx();
    const p = new MusicPlayer(ctx as unknown as AudioContext, new Node() as unknown as AudioNode, Math.random, [TERMINAL]);
    p.setLevel(0.1);
    expect(p.track.name).toBe('Terminal');
    expect(p.playing).toBe(true);
    let last = ctx.sources.length;
    expect(last).toBeGreaterThan(20);
    for (let min = 0; min < 20; min++) {
      ctx.currentTime += 60;
      vi.advanceTimersByTime(60_000);
      expect(p.track.name).toBe('Terminal');
      expect(ctx.sources.length).toBeGreaterThan(last);
      // No gap: something starts in every minute.
      expect(ctx.sources.slice(last).some((s) => s.starts[0] < ctx.currentTime + 1)).toBe(true);
      last = ctx.sources.length;
    }
    // The kit's noise and the hall's hum are made once (no convolver here: the hall is left out, the notes play dry).
    expect(ctx.buffers).toBe(2);
    p.nextTrack();
    expect(p.track.name).toBe('Terminal');
    p.setLevel(0);
    expect(p.playing).toBe(false);
    p.stop();
    vi.useRealTimers();
  });

  it('every voice starts silent: no gain is left at its default when its source starts (the start click)', async () => {
    const { TERMINAL } = await import('./music');
    vi.useFakeTimers();
    const ctx = new LoungeCtx();
    const made: Node[] = [];
    ctx.createGain = () => { const n = new Node(); made.push(n); return n; };
    const p = new MusicPlayer(ctx as unknown as AudioContext, new Node() as unknown as AudioNode, () => 0.5, [TERMINAL]);
    p.setLevel(0.1);
    // Every gain that is automated from (near) silence at a time was set to 0 before that.
    const automated = made.filter((n) => (n.gain as Param).calls.some((c) => c[0] === 'set' && c[1] === 0.0001));
    expect(automated.length).toBeGreaterThan(10);
    for (const n of automated) expect(n.gain.value).toBe(0);
    p.stop();
    vi.useRealTimers();
  });

  it('voices chords close, within an octave; the bass sits where an upright does', async () => {
    const { closeVoicing, bassRoot } = await import('./music');
    expect(closeVoicing([55, 59, 62, 66], 58)).toEqual([59, 62, 66, 67]);
    for (const v of [[48, 52, 55, 59, 62], [70, 74, 77, 81]]) {
      const c = closeVoicing(v, 58);
      expect(Math.min(...c)).toBeGreaterThanOrEqual(58);
      expect(Math.max(...c)).toBeLessThan(70);
      expect(new Set(c.map((m) => m % 12))).toEqual(new Set(v.map((m) => m % 12)));
    }
    for (const m of [27, 36, 43, 48, 55, 64]) {
      const b = bassRoot(m);
      expect(b).toBeGreaterThanOrEqual(31);
      expect(b).toBeLessThanOrEqual(43);
      expect(Math.abs(b - m) % 12).toBe(0);
    }
  });

  it('the key moves to a neighbour, never a leap; the PA chime stays in the key', async () => {
    const { nextKey, chimeNotes, TERMINAL } = await import('./music');
    const keys = TERMINAL.keys;
    expect(nextKey(keys, 48, () => 0.9)).toBe(50);
    expect(nextKey(keys, 55, () => 0.1)).toBe(53);
    expect(nextKey(keys, 51, () => 0.2)).toBe(50);
    expect(nextKey(keys, 51, () => 0.8)).toBe(53);
    // No key yet: any of them.
    expect(keys).toContain(nextKey(keys, 0, () => 0.3));
    for (const r of [0, 0.3, 0.5, 0.79, 0.99]) {
      const notes = chimeNotes(r);
      expect(notes.length).toBeGreaterThanOrEqual(2);
      expect(notes.length).toBeLessThanOrEqual(3);
      for (const n of notes) expect([0, 4, 7]).toContain(n);
    }
  });

  it('the hall\'s hum is a soft, steady, wordless bed that loops without a click', async () => {
    const { humSamples } = await import('./music');
    let seed = 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const d = humSamples(rng, 8000, 6);
    expect(d.length).toBe(48000);
    let sq = 0;
    let jump = 0;
    for (let i = 0; i < d.length; i++) {
      sq += d[i] * d[i];
      if (i) jump = Math.max(jump, Math.abs(d[i] - d[i - 1]));
    }
    expect(Math.sqrt(sq / d.length)).toBeCloseTo(0.25, 2);
    // Low and smooth (no voice-like formants): one sample to the next moves little against the level.
    expect(jump).toBeLessThan(0.25);
    // The loop point is no bigger a step than the steps inside it.
    expect(Math.abs(d[0] - d[d.length - 1])).toBeLessThanOrEqual(jump);
    // Steady: every second carries some of it (no long holes).
    for (let s = 0; s < 6; s++) {
      let e = 0;
      for (let i = s * 8000; i < (s + 1) * 8000; i++) e += d[i] * d[i];
      expect(Math.sqrt(e / 8000)).toBeGreaterThan(0.1);
    }
  });

  it('the hall\'s impulse response dies away to nothing, high frequencies first, with unit energy a channel', async () => {
    const { hallImpulse, HALL } = await import('./music');
    let seed = 3;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const rate = 8000;
    const [l, r] = hallImpulse(rng, rate);
    expect(l.length).toBe(Math.floor(rate * HALL.sec));
    expect(r.length).toBe(l.length);
    const energy = (d: Float32Array, a: number, b: number) => { let e = 0; for (let i = a; i < b; i++) e += d[i] * d[i]; return e; };
    expect(energy(l, 0, l.length)).toBeCloseTo(1, 3);
    // Silent through the pre-delay, loud early, nearly gone at the end (−60 dB at rt60).
    expect(energy(l, 0, Math.floor(rate * HALL.predelay) - 1)).toBe(0);
    const n = l.length;
    expect(energy(l, 0, n >> 2)).toBeGreaterThan(energy(l, n >> 1, n) * 20);
    expect(energy(l, n - (n >> 3), n)).toBeLessThan(0.002);
    // Two different channels (a wide, airy hall), not one copied.
    let dot = 0;
    for (let i = 0; i < n; i++) dot += l[i] * r[i];
    expect(Math.abs(dot)).toBeLessThan(0.2);
  });
});
