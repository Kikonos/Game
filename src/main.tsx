import './styles/theme.css';
import './styles/acmi/fonts.css';
import './styles/app.css';
import './styles/screens.css';
import './styles/touch/index.css';
import './styles/acmi/index.css';
import './styles/acmi/polish.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { serialize } from './engine/save';
import { App } from './ui/App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { registerOffline } from './ui/offline';
import { setResumeSave, store } from './ui/store';
import { installTouchClass } from './ui/useMedia';
import { installDevice } from './ui/device';
import { enableReadCache } from './engine/core/uiRev';
import { cleanReportsOnOpen, clearedTitle, noteCleared } from './ui/bugReports';

// The artifact host pads the page top/bottom by the safe-area insets itself
// (see --safe-t/--safe-b in app.css); it also runs the page under the side bars.
if (__EMBED__) document.documentElement.classList.add('embed');
// v0.15.1 (perf) the screens answer repeated questions (problem cards, offer fit) from a cache the engine never reads.
enableReadCache();
// v0.12 which device (html[data-device], data-input, data-standalone) and the UI size; before html.touch, which uses it.
installDevice({ device: store.settings.device, uiSize: store.settings.uiSize });
// html.touch drives the touch sizing in the CSS (see src/styles/touch/README.md).
installTouchClass();
// Lets iOS apply :active (pressed) styles on touch.
document.addEventListener('touchstart', () => {}, { passive: true });
// The UI is a fixed-layout game: Safari's page pinch-zoom would only push it off screen
// (the map handles its own pinch with pointer events).
document.addEventListener('gesturestart', (e) => e.preventDefault());

// When embedded in a host that supports live updates, hand the running game
// over to the next version instead of dropping the player back to the menu.
interface Hot {
  snapshot?: (fn: () => unknown) => void;
  ready?: (start: (data: { save?: string }) => void) => void;
  data?: { save?: string };
}
const hot = (globalThis as unknown as { claude?: { hot?: Hot } }).claude?.hot;
hot?.snapshot?.(() => ({ save: store.game ? serialize(store.game) : undefined }));

function start(data: { save?: string } = {}) {
  if (data.save) setResumeSave(data.save);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary scope="app">
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
  registerOffline();
  // v0.23.1 the player: "auto-delete fixed bugs when I open the game". Reports this version fixed, and the records the
  // game filed itself under an older version, go; one short toast says how many were fixed (Bug reports › Cleared).
  window.setTimeout(() => {
    cleanReportsOnOpen().then(({ fixed }) => {
      noteCleared(fixed);
      if (fixed.length) whenPlaying(() => store.toast('good', clearedTitle(fixed.length), 'Menu › Bug reports › Cleared says what each fix was.'));
    }, (e) => console.warn('[bug reports] clean-up skipped', e));
  }, 2500);
}

/**
 * Final debug round: runs `fn` once a game is on screen with no dialog over it. The clean-up finds fixes right after an
 * update, when What's New opens, and a dialog clears the toasts: shown then, the toast was gone in half a second (and
 * logged at game time 0).
 */
function whenPlaying(fn: () => void): void {
  const ready = () => store.screen === 'game' && !!store.game && !store.modal;
  if (ready()) return fn();
  const off = store.subscribe(() => {
    if (!ready()) return;
    off();
    // (After the render that closed the dialog.)
    window.setTimeout(fn, 0);
  });
}

if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
