import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { useStore } from '../store';

export function Toasts() {
  const s = useStore();
  return (
    <div className="toasts" aria-live="polite">
      {s.toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind} ${t.leaving ? 'leaving' : ''}`}>
          {t.kind === 'good' ? <CheckCircle2 /> : t.kind === 'bad' ? <XCircle /> : t.kind === 'warn' ? <AlertTriangle /> : <Info />}
          <div>
            <div className="t-title">{t.title}</div>
            {t.body && <div className="t-body">{t.body}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
