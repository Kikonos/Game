// v0.17.1 the bug button's screenshot: exactly what the player sees, drawn from the page (modern-screenshot, loaded only
// when the button is pressed, so the main bundle stays small; bundled, so it works offline). WebGL canvases (the 3D
// globe) keep no picture after they are shown, so each registers a render-now hook: the capture draws a fresh frame
// and reads it in the same task. The picture is scaled to at most MAX_W pixels wide and compressed (WebP where the
// browser can write it, else JPEG) so a report stays small. Any failure gives null: the report is filed without it.

import type { BugShot } from './bugReports';

/** Widest screenshot in pixels, and the compression quality. */
export const MAX_W = 1600;
export const QUALITY = 0.7;
/** A capture that takes longer than this gives up (the report is still filed, without a picture). */
const TIMEOUT_MS = 12000;

interface CanvasHook { canvas: HTMLCanvasElement; render: () => void }
const hooks = new Set<CanvasHook>();

/** A WebGL canvas tells the capture how to draw a fresh frame (the globe). Returns the unregister function. */
export function registerCaptureCanvas(canvas: HTMLCanvasElement, render: () => void): () => void {
  const h = { canvas, render };
  hooks.add(h);
  return () => void hooks.delete(h);
}

/** The scale for a viewport `w` CSS px wide at device ratio `dpr`: sharp as the screen, never wider than MAX_W. Pure. */
export const shotScale = (w: number, dpr: number): number => Math.max(0.25, Math.min(dpr || 1, MAX_W / Math.max(1, w)));

/** The page background (the theme's), so the picture has no transparent holes. */
function pageBackground(): string {
  for (const el of [document.body, document.documentElement]) {
    const c = getComputedStyle(el).backgroundColor;
    if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c;
  }
  return '#0b1220';
}

/** Encodes a canvas: WebP when the browser writes it (Chrome), else JPEG (Safari). */
function encode(c: HTMLCanvasElement): string {
  const webp = c.toDataURL('image/webp', QUALITY);
  if (webp.startsWith('data:image/webp')) return webp;
  return c.toDataURL('image/jpeg', QUALITY);
}

/**
 * Takes the screenshot. `skip` elements (the button, the capture shield) are left out. Resolves null on any failure or
 * after TIMEOUT_MS.
 */
export async function captureScreen(skip: (el: Element) => boolean): Promise<BugShot | null> {
  const restore: (() => void)[] = [];
  try {
    const { domToCanvas } = await import('modern-screenshot');
    // WebGL: draw a frame now and keep its picture for the clone (the drawing buffer is gone after it is shown).
    for (const h of hooks) {
      if (!h.canvas.isConnected) continue;
      try {
        h.render();
        const url = h.canvas.toDataURL('image/png');
        const own = Object.getOwnPropertyDescriptor(h.canvas, 'toDataURL');
        Object.defineProperty(h.canvas, 'toDataURL', { configurable: true, value: () => url });
        restore.push(() => {
          if (own) Object.defineProperty(h.canvas, 'toDataURL', own);
          else delete (h.canvas as unknown as { toDataURL?: unknown }).toDataURL;
        });
      } catch {
        /* that canvas comes out blank; the rest of the picture is still worth having */
      }
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = shotScale(w, window.devicePixelRatio || 1);
    const work = domToCanvas(document.body, {
      width: w,
      height: h,
      scale,
      backgroundColor: pageBackground(),
      filter: (n) => !(n instanceof Element && skip(n)),
      timeout: 6000,
      // Fonts are embedded from the app's own files (cached for offline play).
      fetch: { requestInit: { cache: 'force-cache' } },
    });
    const canvas = await Promise.race([work, new Promise<null>((ok) => setTimeout(() => ok(null), TIMEOUT_MS))]);
    if (!canvas || !canvas.width || !canvas.height) return null;
    const url = encode(canvas);
    return url.length > 100 ? { url, w: canvas.width, h: canvas.height } : null;
  } catch (e) {
    console.warn('[bug report] no screenshot', e);
    return null;
  } finally {
    for (const r of restore) r();
  }
}
