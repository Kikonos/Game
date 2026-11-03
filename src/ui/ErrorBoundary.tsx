// v0.14.1 (CODE-06) React error boundaries: a drawing bug in one screen or dialog no longer blanks the whole app.
// The game state is untouched by drawing, so on a catch the clock is paused and the autosave written at once; then
// a calm panel says so (a screen: tap to go back to the map; the app: tap to reload), and a dialog simply closes with
// a toast. Each error is logged to the console once.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { store } from './store';

/** v0.15 'view': an optional view inside a screen (the 3D globe): nothing is paused; it draws nothing and calls onError. */
export type BoundaryScope = 'app' | 'screen' | 'modal' | 'view';

interface Props {
  scope: BoundaryScope;
  /** A new key (another tab, another dialog) clears a caught error and draws the children again. */
  resetKey?: unknown;
  /** v0.15 'view' scope: told of the error (the screen falls back to another view). */
  onError?: (error: Error) => void;
  children: ReactNode;
}

interface State {
  error: Error | null;
  key: unknown;
}

/** Holds the clock and writes the autosave now (the state is fine: only a screen failed to draw). Never throws. */
function keepGameSafe(): void {
  try {
    if (store.game && !store.paused) store.togglePause();
    store.saveAuto(true);
  } catch (e) {
    console.error('[Block Hours] could not autosave after a render error', e);
  }
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(p: Props, s: State): Partial<State> | null {
    return p.resetKey !== s.key ? { error: null, key: p.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[Block Hours] a ${this.props.scope} failed to draw`, error, info.componentStack);
    if (this.props.scope === 'view') {
      this.props.onError?.(error);
      return;
    }
    keepGameSafe();
    if (this.props.scope === 'modal') {
      store.closeModal();
      store.toast('bad', 'That window could not open', 'Something went wrong drawing it. Your game is safe and paused.');
    }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    if (this.props.scope === 'modal' || this.props.scope === 'view') return null;
    const app = this.props.scope === 'app';
    const go = () => {
      if (app) location.reload();
      else {
        this.setState({ error: null });
        store.navigate('map');
      }
    };
    return (
      <div role="alert" className="crash-panel" onClick={go} style={{
        position: app ? 'fixed' : 'relative', inset: app ? 0 : undefined, minHeight: app ? undefined : '60%', display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center', cursor: 'pointer', background: app ? 'var(--bg, #0d1117)' : undefined, color: 'var(--text, #e6edf3)',
      }}>
        <b style={{ fontSize: 18 }}>Something went wrong</b>
        <div className="muted">Your game is safe: it is paused and autosaved.</div>
        <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); go(); }}>{app ? 'Tap to reload' : 'Back to the map'}</button>
      </div>
    );
  }
}
