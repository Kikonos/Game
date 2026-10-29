import { AlertTriangle, CheckCircle2, Info, Trophy, XCircle } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { store, useStore } from '../store';
import { useTouch } from '../useMedia';
import { toCss } from '../device';

export function Toasts() {
  const s = useStore();
  // v0.9.1 a tap dismisses a toast (it fades and leaves the stack); otherwise it stays 5 s.
  return (
    <>
      {/* With a dialog open the toasts move to the top centre, clear of its footer buttons. */}
      <div className={`toasts ${s.modal ? 'over-modal' : ''}`} aria-live="polite">
        {s.toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.kind} ${t.leaving ? 'leaving' : ''}`}
            role="status"
            onClick={() => store.dismissToast(t.id)}
          >
            {t.kind === 'good' ? <CheckCircle2 /> : t.kind === 'bad' ? <XCircle /> : t.kind === 'warn' ? <AlertTriangle /> : t.kind === 'achievement' ? <Trophy /> : <Info />}
            <div>
              <div className="t-title">{t.title}</div>
              {t.body && <div className="t-body">{t.body}</div>}
            </div>
          </div>
        ))}
      </div>
      <TapTip />
    </>
  );
}

const INTERACTIVE = 'button, a, input, select, textarea, label, [role="button"], [role="tab"]';

/**
 * Touch screens can't hover: tapping an element with data-tip (or a title on
 * non-interactive content) shows its tooltip as a callout.
 */
function TapTip() {
  const touch = useTouch();
  const [tip, setTip] = useState<{ text: string; el: Element } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!touch) return;
    let timer = 0;
    const hide = () => setTip(null);
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      const tipEl = t?.closest?.('[data-tip]');
      let text = tipEl?.getAttribute('data-tip') ?? '';
      let el: Element | null | undefined = tipEl;
      if (!text && t && !t.closest(INTERACTIVE)) {
        el = t.closest('[title]');
        text = el?.getAttribute('title') ?? '';
      }
      window.clearTimeout(timer);
      if (!text || !el) return hide();
      const target = el;
      setTip((cur) => (cur?.el === target ? null : { text, el: target }));
      timer = window.setTimeout(hide, 4500);
    };
    document.addEventListener('click', onClick, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [touch]);

  useLayoutEffect(() => {
    if (!tip || !box.current) return setPos(null);
    const r = tip.el.getBoundingClientRect();
    const b = box.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const left = Math.min(vw - b.width - 10, Math.max(10, r.left + r.width / 2 - b.width / 2));
    const above = r.top - b.height - 8;
    setPos({ left: toCss(left), top: toCss(above > 60 ? above : r.bottom + 8) });
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={box} className="tap-tip" role="tooltip" style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 }}>
      {tip.text}
    </div>
  );
}
