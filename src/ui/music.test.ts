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
