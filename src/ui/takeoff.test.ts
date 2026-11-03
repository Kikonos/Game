// v0.15 the loading screen's take-off: its shape (spool-up, roar building, the pass with its Doppler sweep, the fade
// into the distance), its timing and length, and the WebAudio graph it builds.
import { describe, expect, it } from 'vitest';
import { playTakeoff, TAKEOFF, takeoffFrame, takeoffLength, takeoffLoudness, takeoffPeak } from './takeoff';

const frames = (peak: number, step = 0.05) => {
  const out: { t: number; f: ReturnType<typeof takeoffFrame> }[] = [];
  for (let t = 0; t <= takeoffLength(peak) + 1e-9; t += step) out.push({ t, f: takeoffFrame(t, peak) });
  return out;
};

describe('v0.15 take-off: timing', () => {
  it('peaks 4.8 s in by default; synced to the loading screen it is clamped to a believable spool-up', () => {
    expect(takeoffPeak(null)).toBe(TAKEOFF.peak);
    expect(takeoffPeak(undefined)).toBe(TAKEOFF.peak);
    expect(takeoffPeak(Number.NaN)).toBe(TAKEOFF.peak);
    expect(takeoffPeak(0.4)).toBe(TAKEOFF.minPeak);
    expect(takeoffPeak(3.6)).toBe(3.6);
    expect(takeoffPeak(20)).toBe(TAKEOFF.peak);
  });

  it('lasts about 6–9 s, and is loudest at its peak time', () => {
    for (const peak of [TAKEOFF.minPeak, 3.6, TAKEOFF.peak]) {
      const len = takeoffLength(peak);
      expect(len).toBeGreaterThanOrEqual(6);
      expect(len).toBeLessThanOrEqual(9);
      const fs = frames(peak);
      const loudest = fs.reduce((m, x) => (takeoffLoudness(x.f) > takeoffLoudness(m.f) ? x : m));
      expect(Math.abs(loudest.t - peak)).toBeLessThan(0.2);
    }
  });
});

describe('v0.15 take-off: shape', () => {
  const peak = TAKEOFF.peak;
  const fs = frames(peak);
  const at = (t: number) => takeoffFrame(t, peak);
  const max = Math.max(...fs.map((x) => takeoffLoudness(x.f)));

  it('spools up from idle: N1 only rises, from 0.2 to take-off thrust before the roll is over', () => {
    expect(at(0).n1).toBeCloseTo(0.2);
    for (let i = 1; i < fs.length; i++) expect(fs[i].f.n1).toBeGreaterThanOrEqual(fs[i - 1].f.n1 - 1e-12);
    expect(at(peak - 1.5).n1).toBeCloseTo(1, 2);
  });

  it('the fan whine leads while the roar is still small; the roar builds with thrust and peaks after the pass', () => {
    expect(at(0.8).fan).toBeGreaterThan(at(0.8).roar * 3);
    expect(takeoffLoudness(at(0.8))).toBeLessThan(max * 0.12);
    const roarPeak = fs.reduce((m, x) => (x.f.roar > m.f.roar ? x : m));
    const fanPeak = fs.reduce((m, x) => (x.f.fan > m.f.fan ? x : m));
    expect(fanPeak.t).toBeLessThan(roarPeak.t);
  });

  it('sweeps down in pitch as it passes (Doppler) and moves from left to right', () => {
    expect(at(peak - 1).doppler).toBeGreaterThan(1.1);
    expect(at(peak + 1.5).doppler).toBeLessThan(0.85);
    expect(at(0).doppler).toBe(1);
    expect(at(0).pan).toBeLessThan(-0.5);
    expect(at(takeoffLength(peak)).pan).toBeGreaterThan(0.5);
  });

  it('fades into the distance: the low-pass closes and the level falls to silence', () => {
    const tail = fs.filter((x) => x.t > peak + 0.5);
    for (let i = 1; i < tail.length; i++) expect(tail[i].f.cut).toBeLessThanOrEqual(tail[i - 1].f.cut);
    expect(tail[tail.length - 1].f.cut).toBeLessThan(2000);
    expect(at(peak).cut).toBeGreaterThan(5000);
    expect(at(0).env).toBe(0);
    expect(at(takeoffLength(peak)).env).toBeCloseTo(0, 5);
    expect(takeoffLoudness(at(peak + 2.5))).toBeLessThan(max * 0.6);
  });
});

/** A recording stand-in for the WebAudio graph. */
class Param {
  value = 0;
  calls: string[] = [];
  setValueCurveAtTime(v: Float32Array, t: number, d: number) { this.calls.push(`curve ${v.length} ${t} ${d}`); }
  setValueAtTime() { this.calls.push('set'); }
  linearRampToValueAtTime(v: number, t: number) { this.calls.push(`lin ${v} ${t}`); }
  cancelScheduledValues() { this.calls.push('cancel'); }
}
class N {
  gain = new Param(); frequency = new Param(); Q = new Param(); pan = new Param(); playbackRate = new Param();
  type = ''; buffer: unknown = null; loop = false;
  starts: number[] = []; stops: number[] = [];
  connect<T>(n: T): T { return n; }
  start(t: number) { this.starts.push(t); }
  stop(t: number) { this.stops.push(t); }
}
class Ctx {
  currentTime = 2;
  sampleRate = 8000;
  nodes: N[] = [];
  private make() { const n = new N(); this.nodes.push(n); return n; }
  createGain() { return this.make(); }
  createBiquadFilter() { return this.make(); }
  createOscillator() { return this.make(); }
  createBufferSource() { return this.make(); }
  createStereoPanner() { return this.make(); }
  createBuffer(_ch: number, n: number) { const d = new Float32Array(n); return { getChannelData: () => d }; }
}

describe('v0.15 take-off: the graph', () => {
  it('starts every source at its start and stops them at its end; a stop fades out on its own stage', () => {
    const c = new Ctx();
    const r = playTakeoff(c as unknown as BaseAudioContext, new N() as unknown as AudioNode, 3, 4);
    expect(r.end).toBeCloseTo(3 + takeoffLength(4));
    const src = c.nodes.filter((n) => n.starts.length);
    expect(src.length).toBe(5); // two noises, the buzz-saw and two whines
    for (const s of src) {
      expect(s.starts).toEqual([3]);
      expect(s.stops[0]).toBeCloseTo(r.end + 0.05);
    }
    // The automation follows the model as value curves.
    expect(c.nodes.some((n) => n.frequency.calls.some((x) => x.startsWith('curve')))).toBe(true);
    c.currentTime = 5;
    r.stop(1.2);
    const stopStage = c.nodes.find((n) => n.gain.calls.includes('cancel'))!;
    expect(stopStage.gain.calls).toContain('lin 0 6.2');
    for (const s of src) expect(s.stops[1]).toBeCloseTo(6.25);
  });
});
