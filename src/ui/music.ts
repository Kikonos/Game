// v0.9.1 calm background music, generated live with WebAudio (no audio files, nothing recorded): warm pads on a slow
// chord cycle (Imaj7 – vi7 – IVmaj7 – Vsus and two cousins), 64 bpm, sparse electric-piano notes on top with a soft
// echo, no drums. Long-form variation from UI-side randomness (never the engine's RNG): the key moves every few
// cycles, voicings, octaves, note timing and velocity are drawn fresh, and some cycles leave the melody out.
// Notes are scheduled a few seconds ahead from a 1 s timer: no per-frame work. Its own gain stage (`level`) carries the
// settings' volume and the fades (on/off, hidden/visible); a second one (`duck`) dips it under chimes and alarms.

export interface AudioParamLike {
  value: number;
  setTargetAtTime(v: number, t: number, tau: number): unknown;
  cancelScheduledValues(t: number): unknown;
  setValueAtTime(v: number, t: number): unknown;
  linearRampToValueAtTime?(v: number, t: number): unknown;
  exponentialRampToValueAtTime?(v: number, t: number): unknown;
}

/** Seconds: a fade in or out (a few seconds, never a cut). */
export const MUSIC_FADE = 3;
/** The dip under a chime or an alarm: the level it falls to, how fast, and how slowly it comes back. */
export const DUCK = { level: 0.3, downTau: 0.08, upTau: 0.6 };
/** The music's own share of the master volume (low: it sits under everything). */
export const MUSIC_GAIN = 0.32;

const BPM = 64;
const BEAT = 60 / BPM;
/** Beats per chord (two bars of 4). */
const CHORD_BEATS = 8;
const LOOKAHEAD = 4;
const TICK_MS = 1000;

/** Progressions as scale degrees with chord tones in semitones from the key (maj7, m7, sus). */
const CHORDS: Record<string, number[]> = {
  Imaj7: [0, 4, 7, 11],
  ii7: [2, 5, 9, 12],
  iii7: [4, 7, 11, 14],
  IVmaj7: [5, 9, 12, 16],
  Vsus: [7, 12, 14, 17],
  vi7: [9, 12, 16, 19],
};
const PROGRESSIONS: string[][] = [
  ['Imaj7', 'vi7', 'IVmaj7', 'Vsus'],
  ['Imaj7', 'iii7', 'vi7', 'IVmaj7'],
  ['IVmaj7', 'Imaj7', 'ii7', 'Vsus'],
];
/** Keys (MIDI of the root, around D3–G3): warm, never shrill. */
const KEYS = [50, 53, 55, 51, 48];
/** The major pentatonic of the key: the melody never clashes with the pads. */
const PENTA = [0, 2, 4, 7, 9];

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * The music's target level for the settings (pure): the master switch and the Music switch both on, the Music volume
 * (the master volume applies after it, on the master bus), and nothing while the app is hidden.
 */
export function musicLevel(cfg: { on: boolean; music: boolean; musicVolume: number }, visible: boolean): number {
  return cfg.on && cfg.music && visible ? Math.max(0, Math.min(1, cfg.musicVolume)) * MUSIC_GAIN : 0;
}

type Rng = () => number;

/** The generator: wire it to an output, then start / setLevel / duck / stop. */
export class MusicPlayer {
  private readonly level: GainNode;
  private readonly duckG: GainNode;
  private readonly echo: DelayNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private next = 0;
  private chord = 0;
  private cycle = 0;
  private key = KEYS[0];
  private prog = PROGRESSIONS[0];
  private melody = true;
  private target = 0;
  private duckUntil = 0;

  constructor(private readonly c: AudioContext, out: AudioNode, private readonly rng: Rng = Math.random) {
    this.duckG = c.createGain();
    this.level = c.createGain();
    this.level.gain.value = 0;
    this.level.connect(this.duckG);
    this.duckG.connect(out);
    // A soft echo for the piano notes (one delay line with a low-passed feedback: a little space, cheap).
    try {
      const d = c.createDelay(1.5);
      d.delayTime.value = BEAT * 0.75;
      const fb = c.createGain();
      fb.gain.value = 0.28;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      d.connect(lp).connect(fb).connect(d);
      const wet = c.createGain();
      wet.gain.value = 0.35;
      lp.connect(wet).connect(this.level);
      this.echo = d;
    } catch {
      // no delay node (old WebKit): dry notes
    }
  }

  get gainParam(): AudioParamLike {
    return this.level.gain;
  }
  get duckParam(): AudioParamLike {
    return this.duckG.gain;
  }
  get running(): boolean {
    return this.timer !== null;
  }

  /** Fades to `v` over a few seconds (0: silent; the scheduler stops once the fade is over). */
  setLevel(v: number, fade = MUSIC_FADE) {
    const t = this.c.currentTime;
    const g = this.level.gain;
    this.target = v;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.setTargetAtTime(v, t, fade / 3);
    if (v > 0) this.start();
  }

  /** Dips under a chime or an alarm lasting `sec`, then comes back slowly. */
  duck(sec: number) {
    const t = this.c.currentTime;
    const g = this.duckG.gain;
    const until = t + Math.max(0.3, sec);
    this.duckUntil = Math.max(this.duckUntil, until);
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.setTargetAtTime(DUCK.level, t, DUCK.downTau);
    g.setTargetAtTime(1, this.duckUntil, DUCK.upTau);
  }

  private start() {
    if (this.timer) return;
    this.next = Math.max(this.next, this.c.currentTime + 0.1);
    this.newSection();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  /** Stops scheduling (notes already queued play out under the fade). */
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private newSection() {
    const r = this.rng;
    this.key = KEYS[Math.floor(r() * KEYS.length)];
    this.prog = PROGRESSIONS[Math.floor(r() * PROGRESSIONS.length)];
    this.chord = 0;
  }

  /** Schedules every chord starting inside the lookahead; stops itself after a fade to silence. */
  tick() {
    const c = this.c;
    if (c.state !== 'running') return;
    const now = c.currentTime;
    // Silent and faded out: no more notes (setLevel above 0 starts it again).
    if (this.target === 0 && this.level.gain.value < 0.002) {
      this.stop();
      return;
    }
    // Back from a pause of the clock (a suspended context): pick up from now, never a burst of old notes.
    if (this.next < now) this.next = now + 0.1;
    while (this.next < now + LOOKAHEAD) {
      this.playChord(this.next);
      this.next += CHORD_BEATS * BEAT;
      this.chord++;
      if (this.chord >= this.prog.length) {
        this.chord = 0;
        this.cycle++;
        // Every 3–5 cycles a new key and progression; one cycle in four without the piano.
        if (this.cycle % (3 + Math.floor(this.rng() * 3)) === 0) this.newSection();
        this.melody = this.rng() > 0.25;
      }
    }
  }

  private playChord(t: number) {
    const r = this.rng;
    const tones = CHORDS[this.prog[this.chord]];
    const dur = CHORD_BEATS * BEAT;
    // Voicing: a random inversion, spread across an octave and a half; a soft root below.
    const inv = Math.floor(r() * tones.length);
    const voiced = tones.map((x, i) => this.key + x + (i < inv ? 12 : 0));
    pad(this.c, this.level, hz(this.key + tones[0] - 12), t, dur, 0.05);
    for (const m of voiced) pad(this.c, this.level, hz(m), t, dur, 0.032 + r() * 0.01);
    if (!this.melody) return;
    // Sparse piano: on about a third of the beats, a note of the pentatonic one or two octaves up, a little late or early.
    for (let b = 0; b < CHORD_BEATS; b++) {
      if (r() > 0.32) continue;
      const deg = PENTA[Math.floor(r() * PENTA.length)];
      const oct = r() < 0.7 ? 24 : 12;
      const at = t + b * BEAT + (r() - 0.5) * 0.12 + (r() < 0.2 ? BEAT / 2 : 0);
      epiano(this.c, this.level, this.echo, hz(this.key + deg + oct), at, 0.05 + r() * 0.04);
    }
  }
}

/** A warm pad voice: two slightly detuned sines and a triangle, low-passed, slow attack and release. */
function pad(c: AudioContext, out: AudioNode, f: number, t: number, dur: number, gain: number) {
  const g = c.createGain();
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 2);
  g.gain.setValueAtTime(gain, t + dur - 1);
  g.gain.linearRampToValueAtTime(0.0001, t + dur + 2.5);
  lp.connect(g).connect(out);
  for (const [det, type] of [[-4, 'sine'], [4, 'sine'], [0, 'triangle']] as [number, OscillatorType][]) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = det;
    o.connect(lp);
    o.start(t);
    o.stop(t + dur + 2.6);
  }
}

/** A soft electric-piano note: a sine with a faint octave partial, quick attack, long gentle decay, into the echo. */
function epiano(c: AudioContext, out: AudioNode, echo: DelayNode | null, f: number, t: number, gain: number) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
  g.connect(out);
  if (echo) g.connect(echo);
  for (const [mul, amp] of [[1, 1], [2, 0.12]] as [number, number][]) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * mul;
    const a = c.createGain();
    a.gain.value = amp;
    o.connect(a).connect(g);
    o.start(t);
    o.stop(t + 2.9);
  }
}
