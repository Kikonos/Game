// v0.15 the launch's sound: the take-off once per launch on the first tap outside a game, the Terminal music held
// until it fades, and the crossfade into the game playlist when a game starts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { musicTargets, takeoffOnUnlock } from './sound';

describe('v0.15 launch rules (pure)', () => {
  it('the take-off only on the launch\'s first unlock, with the sound on, outside a game', () => {
    expect(takeoffOnUnlock({ armed: true, on: true, inGame: false })).toBe(true);
    expect(takeoffOnUnlock({ armed: false, on: true, inGame: false })).toBe(false);
    expect(takeoffOnUnlock({ armed: true, on: false, inGame: false })).toBe(false);
    expect(takeoffOnUnlock({ armed: true, on: true, inGame: true })).toBe(false);
  });
  it('Terminal on the menus (held for the take-off), the playlist in a game, nothing with the music off', () => {
    expect(musicTargets(0.1, false, false)).toEqual({ terminal: 0.1, game: 0 });
    expect(musicTargets(0.1, false, true)).toEqual({ terminal: 0, game: 0 });
    expect(musicTargets(0.1, true, false)).toEqual({ terminal: 0, game: 0.1 });
    expect(musicTargets(0.1, true, true)).toEqual({ terminal: 0, game: 0.1 });
    expect(musicTargets(0, false, false)).toEqual({ terminal: 0, game: 0 });
  });
});

class P {
  value = 1;
  setValueCurveAtTime() {}
  setValueAtTime() {}
  setTargetAtTime(v: number) { this.value = v; }
  linearRampToValueAtTime() {}
  exponentialRampToValueAtTime() {}
  cancelScheduledValues() {}
}
class N {
  gain = new P(); frequency = new P(); Q = new P(); pan = new P(); playbackRate = new P(); detune = new P(); delayTime = new P();
  threshold = new P(); ratio = new P();
  type = ''; buffer: unknown = null; loop = false;
  connect<T>(n: T): T { return n; }
  disconnect() {}
  start() {}
  stop() {}
}
class Ctx {
  static last: Ctx | null = null;
  currentTime = 0;
  sampleRate = 8000;
  state = 'running';
  destination = new N();
  constructor() { Ctx.last = this; }
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
  createGain() { return new N(); }
  createBiquadFilter() { return new N(); }
  createOscillator() { return new N(); }
  createBufferSource() { return new N(); }
  createStereoPanner() { return new N(); }
  createDelay() { return new N(); }
  createConvolver() { return new N(); }
  createDynamicsCompressor() { return new N(); }
  createBuffer(_c: number, n: number) { const d = new Float32Array(n); return { duration: n / 8000, getChannelData: () => d }; }
}

/** A fresh `sound` (a new launch), with WebAudio and the session store stubbed. */
async function launch(session: Map<string, string>) {
  vi.resetModules();
  vi.stubGlobal('window', { AudioContext: Ctx });
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => session.set(k, v) });
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  const { sound, TAKEOFF_DELAY } = await import('./sound');
  return { sound, delay: TAKEOFF_DELAY * 1000 };
}

describe('v0.15 the launch, end to end on a stand-in context', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('the first tap on the menus plays the take-off once; Terminal waits for it, then loops; a game crossfades it away', async () => {
    const session = new Map<string, string>();
    const { sound, delay } = await launch(session);
    expect(sound.takeoffWaiting).toBe(true);
    sound.unlock();
    expect(sound.takeoffWaiting).toBe(false);
    vi.advanceTimersByTime(delay + 10);
    const c = Ctx.last!;
    const s1 = sound.state;
    expect(s1.takeoff?.playing).toBe(true);
    expect(s1.terminal).toBe(false);
    expect(s1.track).toBeNull();
    // A second tap (a wake) never plays it again.
    sound.unlock();
    vi.advanceTimersByTime(delay + 10);
    expect(sound.state.takeoff?.end).toBe(s1.takeoff!.end);
    // The take-off nearly over: the Terminal comes in.
    c.currentTime = s1.musicHold + 0.1;
    vi.advanceTimersByTime(10_000);
    expect(sound.state.terminal).toBe(true);
    expect(sound.musicTrack).toBe('Terminal');
    // A game starts: the playlist takes over.
    sound.setScene(true);
    expect(sound.state.terminal).toBe(false);
    expect(sound.state.game).toBe(true);
    expect(sound.musicTrack).not.toBe('Terminal');
    // Back on the title: Terminal again, no take-off.
    sound.setScene(false);
    expect(sound.musicTrack).toBe('Terminal');
    expect(session.get('bh.takeoff')).toBe('1');
    // A reload in the same session: no take-off.
    const again = await launch(session);
    expect(again.sound.takeoffWaiting).toBe(false);
    again.sound.unlock();
    vi.advanceTimersByTime(delay + 10);
    expect(again.sound.state.takeoff).toBeNull();
    expect(again.sound.state.terminal).toBe(true);
  });

  it('never in a game: a first tap that opens a game (Continue) or a start straight into one plays no take-off', async () => {
    const a = await launch(new Map());
    a.sound.unlock();
    a.sound.setScene(true);
    vi.advanceTimersByTime(a.delay + 10);
    expect(a.sound.state.takeoff).toBeNull();
    expect(a.sound.state.game).toBe(true);
    const b = await launch(new Map());
    b.sound.setScene(true);
    b.sound.unlock();
    vi.advanceTimersByTime(b.delay + 10);
    expect(b.sound.state.takeoff).toBeNull();
    // And it is not saved for later: back on the title, still none.
    b.sound.setScene(false);
    b.sound.unlock();
    vi.advanceTimersByTime(b.delay + 10);
    expect(b.sound.state.takeoff).toBeNull();
  });

  it('follows the Sound setting: off, no take-off and no hint; music off, a take-off and no Terminal', async () => {
    const a = await launch(new Map());
    a.sound.configure({ on: false });
    expect(a.sound.takeoffWaiting).toBe(false);
    a.sound.unlock();
    vi.advanceTimersByTime(a.delay + 10);
    expect(a.sound.state.takeoff).toBeNull();
    const b = await launch(new Map());
    b.sound.configure({ music: false });
    b.sound.unlock();
    vi.advanceTimersByTime(b.delay + 10);
    expect(b.sound.state.takeoff?.playing).toBe(true);
    Ctx.last!.currentTime = 60;
    vi.advanceTimersByTime(60_000);
    expect(b.sound.state.terminal).toBe(false);
    expect(b.sound.musicTrack).toBeNull();
  });

  it('a take-off still sounding when a game starts fades out at once', async () => {
    const { sound, delay } = await launch(new Map());
    sound.unlock();
    vi.advanceTimersByTime(delay + 10);
    expect(sound.state.takeoff).not.toBeNull();
    sound.setScene(true);
    expect(sound.state.takeoff).toBeNull();
    expect(sound.state.musicHold).toBe(0);
  });
});
