// v0.12 five pieces take turns (TRACKS: Cruise, Night Flight, Golden Hour, Ops Room, Long Haul), a few minutes each.
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

const LOOKAHEAD = 4;
const TICK_MS = 1000;

/** Chord tones in semitones from the key (major, minor and suspended colours). */
const CHORDS: Record<string, number[]> = {
  Imaj7: [0, 4, 7, 11],
  Iadd9: [0, 4, 7, 14],
  ii7: [2, 5, 9, 12],
  IImaj: [2, 6, 9, 14],
  iii7: [4, 7, 11, 14],
  IVmaj7: [5, 9, 12, 16],
  Vsus: [7, 12, 14, 17],
  V7sus: [7, 12, 14, 17, 22],
  vi7: [9, 12, 16, 19],
  i7: [0, 3, 7, 10],
  i9: [0, 3, 7, 10, 14],
  iv7: [5, 8, 12, 15],
  bVImaj7: [8, 12, 15, 19],
  bVII: [10, 14, 17, 22],
  Isus2: [0, 2, 7, 12],
  IVsus2: [5, 7, 12, 17],
};

/** The lead voice: a soft electric piano, a bell, a plucked arpeggio, or none. */
type Lead = 'epiano' | 'bell' | 'pluck' | 'none';

/**
 * v0.12 one piece of the soundtrack: its tempo and harmony, the pad's colour, the lead and how busy it is, an optional
 * soft bass pulse, and how long it plays before the next one takes over (minutes).
 */
export interface Track {
  name: string;
  bpm: number;
  /** Beats per chord. */
  chordBeats: number;
  progressions: string[][];
  /** Keys (MIDI of the root, around C3–G3): warm, never shrill. */
  keys: number[];
  /** The melody's notes (semitones from the key): a pentatonic that never clashes with the pads. */
  scale: number[];
  /** Pad low-pass cut-off (Hz) and level. */
  padCut: number;
  padGain: number;
  lead: Lead;
  /** Share of beats (eighths for the pluck) that get a lead note. */
  density: number;
  /** A soft bass on beats 1 and 3 (or 1, 3½ for a little swing). */
  bass: boolean;
  minutes: number;
}

/** v0.12 the soundtrack: five calm pieces that take turns (the first one is the v0.9.1 music). */
export const TRACKS: Track[] = [
  { name: 'Cruise', bpm: 64, chordBeats: 8, progressions: [['Imaj7', 'vi7', 'IVmaj7', 'Vsus'], ['Imaj7', 'iii7', 'vi7', 'IVmaj7'], ['IVmaj7', 'Imaj7', 'ii7', 'Vsus']], keys: [50, 53, 55, 51, 48], scale: [0, 2, 4, 7, 9], padCut: 900, padGain: 0.032, lead: 'epiano', density: 0.32, bass: false, minutes: 4 },
  { name: 'Night Flight', bpm: 56, chordBeats: 8, progressions: [['i7', 'bVImaj7', 'iv7', 'bVII'], ['i9', 'iv7', 'bVImaj7', 'bVII']], keys: [48, 50, 45, 47], scale: [0, 3, 5, 7, 10], padCut: 650, padGain: 0.034, lead: 'bell', density: 0.18, bass: false, minutes: 4 },
  { name: 'Golden Hour', bpm: 72, chordBeats: 8, progressions: [['Imaj7', 'IImaj', 'vi7', 'IVmaj7'], ['IVmaj7', 'IImaj', 'Imaj7', 'Vsus']], keys: [53, 55, 52, 50], scale: [0, 2, 4, 7, 9], padCut: 1100, padGain: 0.026, lead: 'pluck', density: 0.7, bass: false, minutes: 3.5 },
  { name: 'Ops Room', bpm: 84, chordBeats: 8, progressions: [['ii7', 'V7sus', 'Imaj7', 'vi7'], ['IVmaj7', 'iii7', 'ii7', 'V7sus']], keys: [50, 48, 53], scale: [0, 2, 4, 7, 9], padCut: 800, padGain: 0.026, lead: 'epiano', density: 0.24, bass: true, minutes: 3.5 },
  { name: 'Long Haul', bpm: 50, chordBeats: 12, progressions: [['Isus2', 'IVsus2', 'Iadd9', 'Vsus'], ['Iadd9', 'vi7', 'IVsus2', 'Isus2']], keys: [48, 50, 46], scale: [0, 2, 7, 9, 12], padCut: 700, padGain: 0.036, lead: 'bell', density: 0.09, bass: false, minutes: 5 },
];

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
  private trackIx = 0;
  private trackStart = 0;
  private key = TRACKS[0].keys[0];
  private prog = TRACKS[0].progressions[0];
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
      d.delayTime.value = 0.7; // a dotted eighth at Cruise's 64 bpm: soft space for every piece
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

  /** v0.12 the piece playing now. */
  get track(): Track {
    return TRACKS[this.trackIx];
  }

  /** v0.12 on to the next piece at the next chord (the pads' long release carries the change). */
  nextTrack() {
    this.trackIx = (this.trackIx + 1) % TRACKS.length;
    this.trackStart = this.next;
    this.newSection();
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

  /** v0.10.2 back up now (a ring stopped early). */
  unduck() {
    const t = this.c.currentTime;
    this.duckUntil = t;
    const g = this.duckG.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.setTargetAtTime(1, t, DUCK.upTau);
  }

  private start() {
    if (this.timer) return;
    this.next = Math.max(this.next, this.c.currentTime + 0.1);
    // The first start picks a piece at random; afterwards they take turns in order.
    if (this.trackStart === 0) this.trackIx = Math.floor(this.rng() * TRACKS.length);
    this.trackStart = this.next;
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
    const tr = this.track;
    this.key = tr.keys[Math.floor(r() * tr.keys.length)];
    this.prog = tr.progressions[Math.floor(r() * tr.progressions.length)];
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
      const tr = this.track;
      this.playChord(this.next);
      this.next += tr.chordBeats * (60 / tr.bpm);
      this.chord++;
      if (this.chord >= this.prog.length) {
        this.chord = 0;
        this.cycle++;
        // v0.12 its minutes played: the next piece takes over at the end of the cycle.
        if (this.next - this.trackStart >= tr.minutes * 60) this.nextTrack();
        // Every 3–5 cycles a new key and progression; one cycle in four without the lead.
        else if (this.cycle % (3 + Math.floor(this.rng() * 3)) === 0) this.newSection();
        this.melody = this.rng() > 0.25;
      }
    }
  }

  private playChord(t: number) {
    const r = this.rng;
    const tr = this.track;
    const beat = 60 / tr.bpm;
    const tones = CHORDS[this.prog[this.chord]];
    const dur = tr.chordBeats * beat;
    // Voicing: a random inversion, spread across an octave and a half; a soft root below.
    const inv = Math.floor(r() * tones.length);
    const voiced = tones.map((x, i) => this.key + x + (i < inv ? 12 : 0));
    pad(this.c, this.level, hz(this.key + tones[0] - 12), t, dur, 0.05, tr.padCut);
    for (const m of voiced) pad(this.c, this.level, hz(m), t, dur, tr.padGain + r() * 0.01, tr.padCut);
    // v0.12 a soft bass pulse (Ops Room): the root an octave down on beats 1 and 3, now and then a swung pickup.
    if (tr.bass) {
      for (let b = 0; b < tr.chordBeats; b += 2) bass(this.c, this.level, hz(this.key + tones[0] - 24), t + b * beat + (b % 4 === 2 && r() < 0.3 ? beat / 2 : 0), beat * 1.6);
    }
    if (!this.melody || tr.lead === 'none') return;
    if (tr.lead === 'pluck') {
      // A rolling arpeggio on eighths over the chord tones, up and back, a few left out.
      const steps = tr.chordBeats * 2;
      const up = [...voiced, voiced[0] + 12];
      const seq = [...up, ...up.slice(1, -1).reverse()];
      for (let i = 0; i < steps; i++) {
        if (r() > tr.density) continue;
        pluck(this.c, this.level, this.echo, hz(seq[i % seq.length] + 12), t + i * beat / 2 + (r() - 0.5) * 0.02, 0.035 + r() * 0.02);
      }
      return;
    }
    // Sparse lead: on some beats, a note of the scale one or two octaves up, a little late or early.
    for (let b = 0; b < tr.chordBeats; b++) {
      if (r() > tr.density) continue;
      const deg = tr.scale[Math.floor(r() * tr.scale.length)];
      const oct = r() < 0.7 ? 24 : 12;
      const at = t + b * beat + (r() - 0.5) * 0.12 + (r() < 0.2 ? beat / 2 : 0);
      if (tr.lead === 'bell') bell(this.c, this.level, this.echo, hz(this.key + deg + oct), at, 0.04 + r() * 0.03);
      else epiano(this.c, this.level, this.echo, hz(this.key + deg + oct), at, 0.05 + r() * 0.04);
    }
  }
}

/** A warm pad voice: two slightly detuned sines and a triangle, low-passed, slow attack and release. */
function pad(c: AudioContext, out: AudioNode, f: number, t: number, dur: number, gain: number, cut = 900) {
  const g = c.createGain();
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = cut;
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

/** v0.12 a bell (Night Flight, Long Haul): a sine with an inharmonic partial, a soft strike and a long ring. */
function bell(c: AudioContext, out: AudioNode, echo: DelayNode | null, f: number, t: number, gain: number) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
  g.connect(out);
  if (echo) g.connect(echo);
  for (const [mul, amp] of [[1, 1], [2.76, 0.18], [5.4, 0.05]] as [number, number][]) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * mul;
    const a = c.createGain();
    a.gain.value = amp;
    o.connect(a).connect(g);
    o.start(t);
    o.stop(t + 4.6);
  }
}

/** v0.12 a plucked note (Golden Hour): a low-passed triangle, quick attack and short decay, into the echo. */
function pluck(c: AudioContext, out: AudioNode, echo: DelayNode | null, f: number, t: number, gain: number) {
  const g = c.createGain();
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2200;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
  lp.connect(g);
  g.connect(out);
  if (echo) g.connect(echo);
  const o = c.createOscillator();
  o.type = 'triangle';
  o.frequency.value = f;
  o.connect(lp);
  o.start(t);
  o.stop(t + 1);
}

/** v0.12 a soft bass note (Ops Room): a sine with a rounded attack. */
function bass(c: AudioContext, out: AudioNode, f: number, t: number, dur: number) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.07, t + 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(out);
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.value = f;
  o.connect(g);
  o.start(t);
  o.stop(t + dur + 0.05);
}
