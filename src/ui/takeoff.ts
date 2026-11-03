// v0.15 the take-off on the loading screen: a twin-jet departure heard from beside the runway, synthesised live with
// WebAudio (nothing downloaded, works offline). About 8.5 s: the engines spool up at the far end (a rising fan whine
// and the buzz-saw of the fan tips), the roar builds as take-off thrust is set, the aircraft rolls towards us, rotates
// and passes with a Doppler sweep (left to right), and the roar fades into the distance behind a closing low-pass as it
// climbs away. The shape is a small model, pure and tested (`takeoffFrame`): engine speed (N1), the aircraft's place
// and speed, distance (level and air absorption), engine directivity (the fan whine radiates forwards, the jet roar
// aft, so the roar is loudest just after it passes) and the Doppler factor. The WebAudio graph follows it through
// value curves. It plays once per launch (sound.ts decides when).

/** v0.15 the take-off's timing (s) and level. */
export const TAKEOFF = {
  /** From the start to the loudest moment (just after the aircraft passes, climbing), when nothing asks otherwise. */
  peak: 4.8,
  /** The shortest lead-in (a quick spool-up) when it is synced to the loading screen's plane. */
  minPeak: 3.0,
  /** From the loudest moment to silence. */
  tail: 3.8,
  /** The loudest moment comes this long after the aircraft is abeam (the roar radiates aft). */
  afterAbeam: 0.6,
  /** Its share of the master volume. */
  gain: 0.5,
};

/** v0.15 the peak time for a start that would like it `untilLiftOff` s from now (null: no wish): clamped to a believable spool-up. */
export function takeoffPeak(untilLiftOff: number | null | undefined): number {
  if (untilLiftOff == null || !Number.isFinite(untilLiftOff)) return TAKEOFF.peak;
  return Math.max(TAKEOFF.minPeak, Math.min(TAKEOFF.peak, untilLiftOff));
}

/** v0.15 the whole sound's length (s) for a peak time. */
export const takeoffLength = (peak: number) => peak + TAKEOFF.tail;

/** v0.15 the take-off at one moment: linear gains of each layer (0–1), the air-absorption cut-off, Doppler, pan. */
export interface TakeoffFrame {
  /** Engine speed, 0.2 (idle) to 1 (take-off thrust). */
  n1: number;
  /** Fan whine and buzz-saw. */
  fan: number;
  /** Jet roar (broadband). */
  roar: number;
  /** Low rumble. */
  rumble: number;
  /** Air absorption low-pass (Hz). */
  cut: number;
  /** Doppler factor (above 1 approaching, below 1 going away). */
  doppler: number;
  /** Stereo position, -1 left to 1 right. */
  pan: number;
  /** Overall envelope (the soft start and the fade into the distance). */
  env: number;
  /** Distance (m). */
  dist: number;
}

const SOUND_SPEED = 343;
/** Model geometry: the start of the roll (m down the runway), our offset from the centreline (m), speeds (m/s). */
const GEO = { start: 420, offset: 70, rotateV: 80, climbV: 85, climbRate: 14 };

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => {
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};

/** v0.15 the take-off model at `t` s into a take-off whose loudest moment is at `peak` (pure). */
export function takeoffFrame(t: number, peak: number = TAKEOFF.peak): TakeoffFrame {
  const len = takeoffLength(peak);
  const abeam = peak - TAKEOFF.afterAbeam;
  const roll = Math.min(2.5, 0.62 * abeam);
  const release = abeam - roll;
  // N1: up to about 55 % and a breath to stabilise, then on to take-off thrust as the brakes come off.
  const sp = release + 0.4;
  const n1 = 0.2 + 0.35 * smooth(0, 0.5 * sp, t) + 0.45 * smooth(0.42 * sp, sp, t);
  // Where it is: waiting at the far end, rolling towards us (accelerating), then climbing away.
  let x: number;
  let speed: number;
  if (t < release) {
    x = -GEO.start;
    speed = 0;
  } else if (t < abeam) {
    const u = (t - release) / roll;
    x = -GEO.start * (1 - Math.pow(u, 1.8));
    speed = GEO.rotateV * Math.pow(u, 0.9);
  } else {
    x = GEO.climbV * (t - abeam);
    speed = GEO.climbV;
  }
  const h = Math.max(0, t - (abeam - 0.4)) * GEO.climbRate;
  const dist = Math.hypot(x, GEO.offset, h);
  const near = GEO.offset / dist;
  // The angle between its heading and us: cos > 0 while it comes towards us.
  const cos = -x / dist;
  const theta = Math.acos(Math.max(-1, Math.min(1, cos)));
  const fwd = 0.35 + 0.65 * Math.pow((1 + cos) / 2, 2);
  const aft = 0.3 + 0.7 * Math.exp(-Math.pow((theta - 2.44) / 0.6, 2));
  const env = smooth(0, 0.3, t) * (1 - smooth(len - 2.4, len, t));
  return {
    n1,
    fan: n1 * n1 * near * fwd,
    roar: Math.pow(n1, 5) * near * aft,
    rumble: Math.pow(n1, 3) * Math.pow(near, 0.6) * (h > 0 ? 0.75 : 1),
    cut: 500 + 12000 * Math.pow(near, 1.6),
    doppler: SOUND_SPEED / (SOUND_SPEED - speed * cos),
    pan: Math.max(-1, Math.min(1, x / (Math.abs(x) + GEO.offset))) * 0.7,
    env,
    dist,
  };
}

/** v0.15 rough loudness of a frame (the layers as they are mixed): what peaks at `peak`. */
export function takeoffLoudness(f: TakeoffFrame): number {
  return f.env * Math.hypot(f.roar * MIX.roar, f.fan * (MIX.buzz + MIX.whine), f.rumble * MIX.rumble);
}

/** Layer levels in the mix. */
const MIX = { roar: 0.55, hiss: 0.1, rumble: 0.4, buzz: 0.1, whine: 0.035, whine2: 0.015 };
/** Value-curve resolution (points per second). */
const RES = 60;

type Param = AudioParam & { setValueCurveAtTime?: AudioParam['setValueCurveAtTime'] };

/** A value curve over [t, t + dur] (linear ramps where value curves are missing). */
function follow(p: Param, v: Float32Array, t: number, dur: number) {
  try {
    if (p.setValueCurveAtTime) {
      p.setValueCurveAtTime(v, t, dur);
      return;
    }
  } catch {
    // fall back to ramps
  }
  p.setValueAtTime(v[0], t);
  for (let i = 1; i < v.length; i++) p.linearRampToValueAtTime(v[i], t + (dur * i) / (v.length - 1));
}

function noise(c: BaseAudioContext, sec: number, brown: boolean): AudioBuffer {
  const n = Math.floor(c.sampleRate * sec);
  const b = c.createBuffer(1, n, c.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  return b;
}

/**
 * v0.15 plays the take-off into `out` from `t0`, its loudest moment `peak` s in. Returns its end time and a stop
 * (a short fade, for a game starting or the app going to the background).
 */
export function playTakeoff(c: BaseAudioContext, out: AudioNode, t0: number, peak: number = TAKEOFF.peak): { end: number; stop: (fade: number) => void } {
  const len = takeoffLength(peak);
  const n = Math.ceil(len * RES) + 1;
  const curves = {
    rate: new Float32Array(n), roarBand: new Float32Array(n), roar: new Float32Array(n), hiss: new Float32Array(n),
    rumble: new Float32Array(n), shaft: new Float32Array(n), buzzBand: new Float32Array(n), buzz: new Float32Array(n),
    w1: new Float32Array(n), w2: new Float32Array(n), whine: new Float32Array(n), whine2: new Float32Array(n),
    cut: new Float32Array(n), pan: new Float32Array(n), env: new Float32Array(n),
  };
  for (let i = 0; i < n; i++) {
    const f = takeoffFrame((i / (n - 1)) * len, peak);
    const shaft = (18 + 62 * f.n1) * f.doppler;
    curves.rate[i] = f.doppler;
    curves.roarBand[i] = (420 + 380 * f.n1) * f.doppler;
    curves.roar[i] = f.roar * MIX.roar;
    curves.hiss[i] = f.roar * MIX.hiss;
    curves.rumble[i] = f.rumble * MIX.rumble;
    curves.shaft[i] = shaft;
    curves.buzzBand[i] = 1000 * f.doppler;
    curves.buzz[i] = f.fan * MIX.buzz * smooth(0.45, 0.85, f.n1);
    curves.w1[i] = shaft * 22;
    curves.w2[i] = shaft * 52;
    curves.whine[i] = f.fan * MIX.whine;
    curves.whine2[i] = f.fan * MIX.whine2;
    curves.cut[i] = Math.min(c.sampleRate / 2 - 100, f.cut);
    curves.pan[i] = f.pan;
    curves.env[i] = f.env * TAKEOFF.gain;
  }
  const end = t0 + len;
  const sources: AudioScheduledSourceNode[] = [];
  const gainOf = (v: Float32Array) => {
    const g = c.createGain();
    g.gain.value = 0;
    follow(g.gain, v, t0, len);
    return g;
  };
  // Output: env → a stop stage (its own gain, so a stop never fights the value curve) → out; stereo pan when there is one.
  const stopG = c.createGain();
  stopG.connect(out);
  const env = gainOf(curves.env);
  env.connect(stopG);
  let into: AudioNode = env;
  try {
    const p = c.createStereoPanner();
    follow(p.pan, curves.pan, t0, len);
    p.connect(env);
    into = p;
  } catch {
    // no panner (old WebKit): centred
  }
  // Air absorption: everything but the rumble passes the closing low-pass.
  const air = c.createBiquadFilter();
  air.type = 'lowpass';
  air.Q.value = 0.5;
  follow(air.frequency, curves.cut, t0, len);
  air.connect(into);

  // Jet roar: noise through a broad band around a few hundred Hz (its centre Doppler-shifted), and a little hiss.
  const white = c.createBufferSource();
  white.buffer = noise(c, 3, false);
  white.loop = true;
  follow(white.playbackRate, curves.rate, t0, len);
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 0.35;
  follow(band.frequency, curves.roarBand, t0, len);
  white.connect(band).connect(gainOf(curves.roar)).connect(air);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2400;
  white.connect(hp).connect(gainOf(curves.hiss)).connect(air);
  sources.push(white);

  // Rumble: brown noise under 160 Hz (it carries far, so it skips the absorption).
  const brown = c.createBufferSource();
  brown.buffer = noise(c, 3, true);
  brown.loop = true;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 160;
  brown.connect(lp).connect(gainOf(curves.rumble)).connect(into);
  sources.push(brown);

  // The fan: the buzz-saw (a sawtooth at the shaft rate, its harmonics through a band), the blade-pass whine and a
  // higher compressor whine, all rising with N1 and swept by the Doppler.
  const saw = c.createOscillator();
  saw.type = 'sawtooth';
  follow(saw.frequency, curves.shaft, t0, len);
  const sawBand = c.createBiquadFilter();
  sawBand.type = 'bandpass';
  sawBand.Q.value = 0.9;
  follow(sawBand.frequency, curves.buzzBand, t0, len);
  saw.connect(sawBand).connect(gainOf(curves.buzz)).connect(air);
  const w1 = c.createOscillator();
  w1.type = 'triangle';
  follow(w1.frequency, curves.w1, t0, len);
  w1.connect(gainOf(curves.whine)).connect(air);
  const w2 = c.createOscillator();
  w2.type = 'sine';
  follow(w2.frequency, curves.w2, t0, len);
  w2.connect(gainOf(curves.whine2)).connect(air);
  sources.push(saw, w1, w2);

  for (const s of sources) {
    s.start(t0);
    s.stop(end + 0.05);
  }
  let stopped = false;
  return {
    end,
    stop: (fade: number) => {
      if (stopped) return;
      stopped = true;
      const now = c.currentTime;
      if (now >= end) return;
      stopG.gain.cancelScheduledValues(now);
      stopG.gain.setValueAtTime(stopG.gain.value, now);
      stopG.gain.linearRampToValueAtTime(0, now + fade);
      for (const s of sources) {
        try {
          s.stop(now + fade + 0.05);
        } catch {
          // already stopped
        }
      }
    },
  };
}
