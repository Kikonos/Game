// v0.14.1 (CODE-06) the error boundary: a caught error is cleared by a new key; a dialog that fails closes with a toast.
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';
import { store } from './store';

describe('v0.14.1 error boundary', () => {
  it('holds the error until the key changes (another tab, another dialog)', () => {
    const err = new Error('boom');
    expect(ErrorBoundary.getDerivedStateFromError(err)).toEqual({ error: err });
    expect(ErrorBoundary.getDerivedStateFromProps({ scope: 'screen', resetKey: 'map', children: null }, { error: err, key: 'map' })).toBeNull();
    expect(ErrorBoundary.getDerivedStateFromProps({ scope: 'screen', resetKey: 'fleet', children: null }, { error: err, key: 'map' })).toEqual({ error: null, key: 'fleet' });
  });

  it('a dialog that fails to draw is closed with a toast, logged once to the console', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.openModal({ kind: 'menu' });
    expect(store.modal).not.toBeNull();
    const toasts = store.toasts.length;
    const b = new ErrorBoundary({ scope: 'modal', children: null });
    b.componentDidCatch(new Error('Cannot read properties of undefined'), { componentStack: '' });
    expect(store.modal).toBeNull();
    expect(store.toasts.length).toBe(toasts + 1);
    expect(store.toasts[store.toasts.length - 1].title).toBe('That window could not open');
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
