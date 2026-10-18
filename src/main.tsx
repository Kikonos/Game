import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';
import './styles/app.css';
import './styles/screens.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { serialize } from './engine/save';
import { App } from './ui/App';
import { registerOffline } from './ui/offline';
import { setResumeSave, store } from './ui/store';

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
      <App />
    </StrictMode>,
  );
  registerOffline();
}

if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
