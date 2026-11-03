// v0.15 the globe's settings and its fallback: older settings get the globe button (flat map on, no idle spin); a
// globe that fails to draw is a 'view' boundary: the screen is told, the clock is not stopped, nothing is drawn.
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../../ErrorBoundary';
import { settingsFrom, store } from '../../store';

describe('v0.15 globe settings', () => {
  it('gives settings saved before the globe its defaults, and keeps a choice once made', () => {
    const s = settingsFrom({ mapAnimations: false });
    expect(s.globe).toBe(true);
    expect(s.globeView).toBe(false);
    expect(s.globeSpin).toBe(false);
    const t = settingsFrom({ globe: false, globeView: true, globeSpin: true });
    expect([t.globe, t.globeView, t.globeSpin]).toEqual([false, true, true]);
  });

  it('falls back quietly when the globe cannot draw: told once, the game not paused, nothing drawn', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();
    const paused = store.paused;
    const b = new ErrorBoundary({ scope: 'view', onError, children: null });
    const err = new Error('WebGL unavailable');
    b.componentDidCatch(err, { componentStack: '' });
    expect(onError).toHaveBeenCalledWith(err);
    expect(store.paused).toBe(paused);
    b.state = { error: err, key: undefined };
    expect(b.render()).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
