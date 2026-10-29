// v0.12 devices: which device the game runs on (iPhone, iPad, Android, Mac, Windows, other), how the player points
// (touch, mouse/trackpad or both) and whether it runs as a home-screen app. Settings › Display › Device can override it.
//
// detectDevice() is pure over DeviceSignals, so the table of real browsers in device.test.ts pins it down; readSignals()
// gathers them from the browser (UA Client Hints where there are some, navigator.platform / userAgent, maxTouchPoints
// and the pointer / hover media queries). Screen size never decides the device: a Mac window made narrow is a Mac in a
// narrow window, and the layout tier (useMedia.ts) still comes from the window size alone.
//
// What it changes (installDevice): <html data-device="iphone|ipad|android|mac|windows|other" data-form="phone|tablet|
// computer" data-input="touch|mouse|hybrid" data-standalone>, for the few places a device needs its own treatment;
// phones and tablets keep the touch sizing (html.touch) even with a keyboard and trackpad attached; the default UI size.

export type DeviceKind = 'iphone' | 'ipad' | 'android-phone' | 'android-tablet' | 'mac' | 'windows' | 'linux' | 'other';
export type DeviceForm = 'phone' | 'tablet' | 'computer';
export type InputKind = 'touch' | 'mouse' | 'hybrid';
/** Settings › Display › Device. */
export type DevicePref = 'auto' | 'iphone' | 'ipad' | 'computer';
/** Settings › Display › Size. */
export type UiSizePref = 'auto' | 'small' | 'normal' | 'large';
export type UiSize = Exclude<UiSizePref, 'auto'>;

/** Everything the detection reads, as plain values (tests pass a table of real browsers). */
export interface DeviceSignals {
  ua: string;
  /** navigator.platform ('MacIntel', 'Win32', 'iPhone', 'iPad', 'Linux armv8l', …); '' when absent. */
  platform: string;
  /** UA Client Hints (Chromium browsers): navigator.userAgentData.platform ('macOS', 'Windows', 'Android', …) and .mobile. */
  chPlatform?: string;
  chMobile?: boolean;
  maxTouchPoints: number;
  /** (any-pointer: coarse): some pointer is a finger. */
  anyCoarse: boolean;
  /** (any-pointer: fine) or (any-hover: hover): some pointer is a mouse, trackpad or pen. */
  anyFine: boolean;
  /** (display-mode: standalone | fullscreen | minimal-ui) or navigator.standalone (iOS home-screen app). */
  standalone: boolean;
}

export interface Device {
  kind: DeviceKind;
  form: DeviceForm;
  input: InputKind;
  /** Runs as an installed app (home screen, dock, Start menu), not in a browser tab. */
  standalone: boolean;
}

/** The value of html[data-device]: Android phones and tablets share one, Linux and the rest are 'other'. */
export type DeviceAttr = 'iphone' | 'ipad' | 'android' | 'mac' | 'windows' | 'other';

export const DEVICE_NAME: Record<DeviceKind, string> = {
  iphone: 'iPhone', ipad: 'iPad', 'android-phone': 'Android phone', 'android-tablet': 'Android tablet',
  mac: 'Mac', windows: 'Windows computer', linux: 'Linux computer', other: 'Computer',
};

export const INPUT_NAME: Record<InputKind, string> = { touch: 'touch', mouse: 'mouse or trackpad', hybrid: 'touch and mouse' };

/** Which device, from the signals. Pure. */
export function detectDevice(s: DeviceSignals): Device {
  const ua = s.ua || '';
  const pf = (s.platform || '').toLowerCase();
  const ch = (s.chPlatform || '').toLowerCase();
  const touchPoints = s.maxTouchPoints || 0;
  let kind: DeviceKind;
  if (/iphone|ipod/i.test(ua) || pf === 'iphone' || pf === 'ipod') kind = 'iphone';
  else if (/ipad/i.test(ua) || pf === 'ipad') kind = 'ipad';
  else if (/android/i.test(ua) || ch === 'android') {
    // Android phones say 'Mobile' in the UA (Client Hints: mobile = true); tablets don't. Never the screen size.
    const mobile = s.chMobile ?? /mobile/i.test(ua);
    kind = mobile ? 'android-phone' : 'android-tablet';
  } else if (/macintosh|mac os x/i.test(ua) || pf.startsWith('mac') || ch === 'macos') {
    // iPadOS Safari asks for the desktop site with a Mac user agent; a Mac has no touch screen.
    kind = touchPoints > 1 ? 'ipad' : 'mac';
  } else if (/windows/i.test(ua) || pf.startsWith('win') || ch === 'windows') kind = 'windows';
  else if (/cros|linux|x11/i.test(ua) || pf.startsWith('linux') || ch === 'linux' || ch === 'chrome os' || ch === 'chromeos') kind = 'linux';
  else kind = 'other';
  const form: DeviceForm = kind === 'iphone' || kind === 'android-phone' ? 'phone' : kind === 'ipad' || kind === 'android-tablet' ? 'tablet' : 'computer';
  const hasTouch = touchPoints > 0 || s.anyCoarse;
  // A phone or tablet with nothing but a finger reports no fine pointer; a keyboard with trackpad or a mouse adds one.
  const hasMouse = s.anyFine;
  const input: InputKind = form !== 'computer' && !hasMouse ? 'touch' : hasTouch && hasMouse ? 'hybrid' : hasTouch ? 'touch' : 'mouse';
  return { kind, form, input, standalone: !!s.standalone };
}

/** The device after the player's override (Settings › Display › Device). Pure. */
export function resolveDevice(detected: Device, pref: DevicePref): Device {
  if (pref === 'iphone') return { ...detected, kind: 'iphone', form: 'phone', input: detected.input === 'mouse' ? 'touch' : detected.input };
  if (pref === 'ipad') return { ...detected, kind: 'ipad', form: 'tablet', input: detected.input === 'mouse' ? 'hybrid' : detected.input };
  if (pref === 'computer' && detected.form !== 'computer') {
    // An iPad already reports a Mac; other phones and tablets become a plain computer.
    return { ...detected, kind: detected.kind === 'ipad' ? 'mac' : 'other', form: 'computer', input: detected.input === 'touch' ? 'hybrid' : detected.input };
  }
  return detected;
}

export function deviceAttr(kind: DeviceKind): DeviceAttr {
  return kind === 'android-phone' || kind === 'android-tablet' ? 'android' : kind === 'linux' ? 'other' : kind;
}

/** 'Auto: iPhone' style label for Settings. */
export function deviceLabel(d: Device): string {
  return DEVICE_NAME[d.kind];
}

/** Phones and tablets keep the touch sizing whatever is attached; a computer follows its main pointer. */
export function wantsTouchSizing(d: Device): boolean {
  return d.form !== 'computer';
}

// ---------- UI size ----------

/** The scale of each size (Smaller keeps 12 px text at 11 px, the floor). */
export const UI_SCALE: Record<UiSize, number> = { small: 0.92, normal: 1, large: 1.2 };

/**
 * The size 'Auto' picks: Larger on a computer whose window is big (a 27" screen at 100 %), Normal everywhere else.
 * The window size only adds to the device here (a phone or tablet is never enlarged). Pure.
 */
export function autoUiSize(d: Device, vw: number, vh: number): UiSize {
  return d.form === 'computer' && vw >= 2000 && vh >= 1150 ? 'large' : 'normal';
}

/**
 * The zoom actually applied for a size in a window: Larger only grows as far as the window keeps the room its
 * layout tier was made for (1180×700 for the wide tier, 760×560 for the rail tier; never on phone-sized windows), so
 * the CSS media queries, which see the real window, still describe what is on screen. Pure.
 */
export function uiZoom(size: UiSize, vw: number, vh: number): number {
  const z = UI_SCALE[size];
  if (z <= 1) return z;
  const wide = vw >= 1100 && vh >= 500;
  const medium = !wide && vw >= 700 && vh >= 500;
  if (!wide && !medium) return 1;
  const [mw, mh] = wide ? [1180, 700] : [760, 560];
  const fit = Math.min(z, vw / mw, vh / mh);
  return Math.max(1, Math.floor(fit * 100) / 100);
}

// ---------- browser glue ----------

const mm = (q: string): boolean => {
  try {
    return typeof matchMedia === 'function' && matchMedia(q).matches;
  } catch {
    return false;
  }
};

/** Reads the signals from this browser. */
export function readSignals(): DeviceSignals {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & {
    standalone?: boolean;
    userAgentData?: { platform?: string; mobile?: boolean };
  };
  return {
    ua: nav.userAgent ?? '',
    platform: nav.platform ?? '',
    chPlatform: nav.userAgentData?.platform || undefined,
    chMobile: nav.userAgentData ? !!nav.userAgentData.mobile : undefined,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    anyCoarse: mm('(any-pointer: coarse)'),
    anyFine: mm('(any-pointer: fine)') || mm('(any-hover: hover)'),
    standalone: nav.standalone === true || mm('(display-mode: standalone)') || mm('(display-mode: fullscreen)') || mm('(display-mode: minimal-ui)'),
  };
}

let detected: Device = { kind: 'other', form: 'computer', input: 'mouse', standalone: false };
let current: Device = detected;
let pref: DevicePref = 'auto';
let sizePref: UiSizePref = 'auto';
let zoom = 1;
const listeners = new Set<() => void>();

/** What the browser says, before any override. */
export const detectedDevice = (): Device => detected;
/** The device in use (detected, or the player's override). */
export const deviceNow = (): Device => current;
/** The UI size zoom applied to <html> (1: none). Coordinates read from the page (getBoundingClientRect, clientX) are
 * in screen pixels; divide by this to get the page's own CSS pixels. */
export const uiZoomNow = (): number => zoom;
/** Screen pixels (getBoundingClientRect, clientX, innerWidth) → the page's own CSS pixels under the UI size zoom. */
export const toCss = (screenPx: number): number => screenPx / zoom;
/** An element's box in the page's own CSS pixels (getBoundingClientRect is in screen pixels). */
export function cssRect(el: Element): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
  const r = el.getBoundingClientRect();
  return { left: r.left / zoom, top: r.top / zoom, right: r.right / zoom, bottom: r.bottom / zoom, width: r.width / zoom, height: r.height / zoom };
}
/** The size 'Auto' would pick here and now. */
export const autoUiSizeNow = (): UiSize => autoUiSize(current, typeof innerWidth === 'number' ? innerWidth : 1180, typeof innerHeight === 'number' ? innerHeight : 820);
export const uiSizeNow = (): UiSize => (sizePref === 'auto' ? autoUiSizeNow() : sizePref);

export function onDeviceChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Browsers that zoom a page as Chromium 128+, Firefox 126+ and Safari do (getBoundingClientRect in screen pixels).
// If one does not, the UI size stays at 100 % rather than misplace drags and pop-ups.
let zoomOk: boolean | null = null;
function zoomBehaves(): boolean {
  if (zoomOk !== null) return zoomOk;
  try {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:0;top:0;width:100px;height:1px;visibility:hidden;zoom:2;pointer-events:none';
    document.body.appendChild(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    zoomOk = Math.abs(w - 200) < 1;
  } catch {
    zoomOk = false;
  }
  return zoomOk;
}

function apply() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.device = deviceAttr(current.kind);
  root.dataset.form = current.form;
  root.dataset.input = current.input;
  if (current.standalone) root.dataset.standalone = '';
  else delete root.dataset.standalone;
  const size = uiSizeNow();
  const z = document.body && zoomBehaves() ? uiZoom(size, innerWidth, innerHeight) : 1;
  if (z !== zoom || root.style.getPropertyValue('--ui-zoom') === '') {
    zoom = z;
    // CSS zoom on the root scales every px of the design; --ui-zoom lets viewport units (100dvh) follow it.
    root.style.zoom = z === 1 ? '' : String(z);
    root.style.setProperty('--ui-zoom', String(z));
  }
  root.dataset.uiSize = size;
  for (const fn of listeners) fn();
}

/** Applies the player's choices (Settings › Display › Device and Size). */
export function setDevicePrefs(p: { device?: DevicePref; uiSize?: UiSizePref }) {
  if (p.device) pref = p.device;
  if (p.uiSize) sizePref = p.uiSize;
  current = resolveDevice(detected, pref);
  apply();
}

let installed = false;
/** Detects the device once, sets the <html> attributes and keeps them current (a trackpad attached, the window resized). */
export function installDevice(p: { device?: DevicePref; uiSize?: UiSizePref } = {}) {
  if (p.device) pref = p.device;
  if (p.uiSize) sizePref = p.uiSize;
  const redetect = () => {
    detected = detectDevice(readSignals());
    current = resolveDevice(detected, pref);
    apply();
  };
  redetect();
  if (installed || typeof window === 'undefined') return;
  installed = true;
  for (const q of ['(any-pointer: coarse)', '(any-pointer: fine)', '(any-hover: hover)', '(display-mode: standalone)']) {
    try {
      matchMedia(q).addEventListener('change', redetect);
    } catch {
      // old browser
    }
  }
  let t = 0;
  window.addEventListener('resize', () => {
    window.clearTimeout(t);
    t = window.setTimeout(apply, 120);
  });
  if (!document.body) document.addEventListener('DOMContentLoaded', apply, { once: true });
}
