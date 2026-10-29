// v0.12 devices: the detection over real browsers (user agents, platforms, touch points, pointers), the player's
// override in Settings, the settings defaults for old saves and the UI size.

import { describe, expect, it } from 'vitest';
import { autoUiSize, deviceAttr, detectDevice, type DeviceSignals, resolveDevice, uiZoom, wantsTouchSizing } from './device';
import { settingsFrom } from './store';

const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const APP_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const CHROME_IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1';
const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const EDGE_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
const FIREFOX_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0';
const CHROME_ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const CHROME_ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const FIREFOX_ANDROID = 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0';
const CHROME_LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const finger = { maxTouchPoints: 5, anyCoarse: true, anyFine: false };
const mouse = { maxTouchPoints: 0, anyCoarse: false, anyFine: true };
const both = { maxTouchPoints: 10, anyCoarse: true, anyFine: true };
const sig = (ua: string, platform: string, input: typeof finger, extra: Partial<DeviceSignals> = {}): DeviceSignals => ({ ua, platform, standalone: false, ...input, ...extra });

const TABLE: [string, DeviceSignals, string, string, string, boolean][] = [
  // name, signals, kind, form, input, standalone
  ['iPhone Safari', sig(SAFARI_IPHONE, 'iPhone', finger), 'iphone', 'phone', 'touch', false],
  ['iPhone home-screen app', sig(APP_IPHONE, 'iPhone', finger, { standalone: true }), 'iphone', 'phone', 'touch', true],
  ['iPad Safari (asks for the desktop site: Mac UA, touch points)', sig(SAFARI_MAC, 'MacIntel', finger), 'ipad', 'tablet', 'touch', false],
  ['iPad with keyboard and trackpad', sig(SAFARI_MAC, 'MacIntel', both), 'ipad', 'tablet', 'hybrid', false],
  ['iPad home-screen app', sig(SAFARI_MAC, 'MacIntel', finger, { standalone: true }), 'ipad', 'tablet', 'touch', true],
  ['iPad Chrome', sig(CHROME_IPAD, 'iPad', finger), 'ipad', 'tablet', 'touch', false],
  ['Mac Safari', sig(SAFARI_MAC, 'MacIntel', mouse), 'mac', 'computer', 'mouse', false],
  ['Mac Chrome (Client Hints)', sig(CHROME_MAC, 'MacIntel', mouse, { chPlatform: 'macOS', chMobile: false }), 'mac', 'computer', 'mouse', false],
  ['Mac Chrome installed app', sig(CHROME_MAC, 'MacIntel', mouse, { chPlatform: 'macOS', chMobile: false, standalone: true }), 'mac', 'computer', 'mouse', true],
  ['Windows Chrome', sig(CHROME_WIN, 'Win32', mouse, { chPlatform: 'Windows', chMobile: false }), 'windows', 'computer', 'mouse', false],
  ['Windows Edge', sig(EDGE_WIN, 'Win32', mouse, { chPlatform: 'Windows', chMobile: false }), 'windows', 'computer', 'mouse', false],
  ['Windows Firefox', sig(FIREFOX_WIN, 'Win32', mouse), 'windows', 'computer', 'mouse', false],
  ['Windows touch laptop (Edge)', sig(EDGE_WIN, 'Win32', both, { chPlatform: 'Windows', chMobile: false }), 'windows', 'computer', 'hybrid', false],
  ['Windows tablet mode (no mouse)', sig(EDGE_WIN, 'Win32', { maxTouchPoints: 10, anyCoarse: true, anyFine: false }, { chPlatform: 'Windows' }), 'windows', 'computer', 'touch', false],
  ['Android phone Chrome', sig(CHROME_ANDROID_PHONE, 'Linux armv81', finger, { chPlatform: 'Android', chMobile: true }), 'android-phone', 'phone', 'touch', false],
  ['Android tablet Chrome', sig(CHROME_ANDROID_TABLET, 'Linux armv81', finger, { chPlatform: 'Android', chMobile: false }), 'android-tablet', 'tablet', 'touch', false],
  ['Android Chrome asking for the desktop site', sig(CHROME_LINUX, 'Linux armv81', finger, { chPlatform: 'Android', chMobile: true }), 'android-phone', 'phone', 'touch', false],
  ['Android Firefox phone (no Client Hints)', sig(FIREFOX_ANDROID, 'Linux aarch64', finger), 'android-phone', 'phone', 'touch', false],
  ['Linux desktop Chrome', sig(CHROME_LINUX, 'Linux x86_64', mouse, { chPlatform: 'Linux', chMobile: false }), 'linux', 'computer', 'mouse', false],
  ['Nothing known', sig('', '', mouse), 'other', 'computer', 'mouse', false],
];

describe('device detection (v0.12)', () => {
  it.each(TABLE)('%s', (_name, s, kind, form, input, standalone) => {
    expect(detectDevice(s)).toEqual({ kind, form, input, standalone });
  });

  it('the screen size never decides: the signals carry no size, and a narrow Mac window is still a Mac', () => {
    const mac = detectDevice(sig(SAFARI_MAC, 'MacIntel', mouse));
    expect(mac.kind).toBe('mac');
    // The size only matters for the UI size on a computer, and a narrow window keeps Normal.
    expect(autoUiSize(mac, 600, 500)).toBe('normal');
  });

  it('html[data-device] values', () => {
    expect(deviceAttr('android-phone')).toBe('android');
    expect(deviceAttr('android-tablet')).toBe('android');
    expect(deviceAttr('linux')).toBe('other');
    expect(deviceAttr('iphone')).toBe('iphone');
    expect(deviceAttr('windows')).toBe('windows');
  });

  it('phones and tablets keep the touch sizing whatever is attached; computers follow their pointer', () => {
    expect(wantsTouchSizing(detectDevice(sig(SAFARI_MAC, 'MacIntel', both)))).toBe(true);
    expect(wantsTouchSizing(detectDevice(sig(SAFARI_IPHONE, 'iPhone', finger)))).toBe(true);
    expect(wantsTouchSizing(detectDevice(sig(EDGE_WIN, 'Win32', both)))).toBe(false);
  });
});

describe('the Device override (Settings › Display)', () => {
  const mac = detectDevice(sig(SAFARI_MAC, 'MacIntel', mouse));
  const ipad = detectDevice(sig(SAFARI_MAC, 'MacIntel', finger));
  const iphone = detectDevice(sig(SAFARI_IPHONE, 'iPhone', finger, { standalone: true }));

  it('Auto is what was detected', () => {
    expect(resolveDevice(mac, 'auto')).toEqual(mac);
    expect(resolveDevice(ipad, 'auto')).toEqual(ipad);
  });

  it('iPhone and iPad make a computer a touch device of that kind', () => {
    expect(resolveDevice(mac, 'iphone')).toMatchObject({ kind: 'iphone', form: 'phone', input: 'touch' });
    expect(resolveDevice(mac, 'ipad')).toMatchObject({ kind: 'ipad', form: 'tablet', input: 'hybrid' });
    expect(resolveDevice(ipad, 'iphone')).toMatchObject({ kind: 'iphone', form: 'phone', input: 'touch' });
  });

  it('Computer turns an iPad into a Mac and a phone into a plain computer; a computer stays itself', () => {
    expect(resolveDevice(ipad, 'computer')).toMatchObject({ kind: 'mac', form: 'computer', input: 'hybrid' });
    expect(resolveDevice(iphone, 'computer')).toMatchObject({ kind: 'other', form: 'computer', standalone: true });
    expect(resolveDevice(mac, 'computer')).toEqual(mac);
  });
});

describe('settings and UI size', () => {
  it('settings saved before devices: Device and Size on Auto; a stored choice stays; junk falls back', () => {
    expect(settingsFrom({}).device).toBe('auto');
    expect(settingsFrom({}).uiSize).toBe('auto');
    expect(settingsFrom({ units: 'nm' }).device).toBe('auto');
    expect(settingsFrom({ device: 'ipad', uiSize: 'large' })).toMatchObject({ device: 'ipad', uiSize: 'large' });
    expect(settingsFrom({ device: 'toaster' as never, uiSize: 9 as never })).toMatchObject({ device: 'auto', uiSize: 'auto' });
  });

  it('Auto: Larger on a big computer screen, Normal on laptops, phones and tablets', () => {
    const mac = detectDevice(sig(SAFARI_MAC, 'MacIntel', mouse));
    const ipad = detectDevice(sig(SAFARI_MAC, 'MacIntel', finger));
    expect(autoUiSize(mac, 2560, 1300)).toBe('large');
    expect(autoUiSize(mac, 1440, 820)).toBe('normal');
    expect(autoUiSize(mac, 1920, 960)).toBe('normal');
    expect(autoUiSize(ipad, 2560, 1300)).toBe('normal');
  });

  it('Larger grows only as far as the window keeps its layout room; Smaller and Normal are as chosen', () => {
    expect(uiZoom('normal', 1280, 800)).toBe(1);
    expect(uiZoom('small', 1280, 800)).toBe(0.92);
    expect(uiZoom('large', 2560, 1300)).toBe(1.2);
    expect(uiZoom('large', 1280, 760)).toBe(1.08);
    expect(uiZoom('large', 1100, 700)).toBe(1);
    // Phone-sized windows are never enlarged.
    expect(uiZoom('large', 852, 393)).toBe(1);
    // The rail tier keeps 760×560.
    expect(uiZoom('large', 1000, 800)).toBe(1.2);
    expect(uiZoom('large', 800, 600)).toBe(1.05);
  });
});
