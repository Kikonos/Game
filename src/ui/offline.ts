// Offline support: registers the service worker that precaches the whole game,
// and tracks install / connectivity state for the UI.

type Listener = () => void;

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const offline = {
  ready: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  installPrompt: null as InstallPromptEvent | null,
  listeners: new Set<Listener>(),
  emit() {
    for (const l of this.listeners) l();
  },
};

export function registerOffline() {
  window.addEventListener('online', () => { offline.online = true; offline.emit(); });
  window.addEventListener('offline', () => { offline.online = false; offline.emit(); });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    offline.installPrompt = e as InstallPromptEvent;
    offline.emit();
  });
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      registerSW({
        immediate: true,
        onOfflineReady() {
          offline.ready = true;
          offline.emit();
        },
        onRegisteredSW(_url, reg) {
          if (reg?.active) {
            offline.ready = true;
            offline.emit();
          }
        },
      });
    })
    .catch(() => {
      // Service workers can be unavailable (e.g. sandboxed previews); the game still runs.
    });
}

export async function promptInstall() {
  const p = offline.installPrompt;
  if (!p) return;
  await p.prompt();
  offline.installPrompt = null;
  offline.emit();
}
