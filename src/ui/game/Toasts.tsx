import { AlertTriangle, CheckCircle2, History, Info, Trophy, X, XCircle } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Message } from '../../engine/core/types';
import { store, useStore, type Toast } from '../store';
import { useTouch } from '../useMedia';
import { toCss } from '../device';
import { openMessage } from '../screens/Inbox';
import { shownToasts, withoutOpenSubject } from '../toastLogic';

/** v0.12.1 what a toast (or its log line) opens: its Inbox message's target, else its ref; nothing to open: false. */
export function openToast(t: Pick<Toast, 'msgId' | 'ref' | 'title' | 'body'>): boolean {
  const g = store.game;
  if (!g) return false;
  const m = t.msgId ? g.messages.find((x) => x.id === t.msgId) : undefined;
  if (m) {
    openMessage(g, m);
    return true;
  }
  if (!t.ref) return false;
  openMessage(g, { id: '', t: g.now, read: true, tone: 'info', cat: 'ops', title: t.title, body: t.body ?? '', ref: t.ref } as Message);
  return true;
}

export function Toasts() {
  const s = useStore();
  // v0.12.1 a phone on its side shows two at most, the urgent ones first (the rest wait in the log).
  const short = typeof window !== 'undefined' && window.innerHeight < 500;
  // v0.12.1 what a dialog shows has no toast about it over its title ("Decision: …", "New offer: …").
  const g = s.game;
  const m = s.modal;
  const dec = !g ? undefined : m?.kind === 'decision' ? g.decisions.find((d) => d.id === m.decisionId) : !m && s.decisionOpen ? g.decisions[0] : undefined;
  const open = dec ? { title: dec.title, ref: dec.ref } : m?.kind === 'offer' ? { ref: { kind: 'offer' as const, id: m.offerId } } : m?.kind === 'crewControl' ? { ref: { kind: 'flight' as const, id: m.flightId } } : null;
  const all = withoutOpenSubject(s.toasts, open);
  const list = short ? shownToasts(all, 2) : all;
  // v0.9.1 a tap dismisses a toast (it fades and leaves the stack). v0.12.1 a tap opens what it is about when it is about
  // something; hovering or touching holds it; the urgent ones stay until closed (×); the clock button opens the log.
  return (
    <>
      {/* With a dialog open the toasts move to the top centre, clear of its footer buttons. */}
      <div className={`toasts ${s.modal ? 'over-modal' : ''}`} aria-live="polite">
        {s.toasts.length > 0 && !s.modal && (
          <button className="toast-log-btn" onClick={() => store.navigate('inbox', { view: 'popups' })} aria-label="Recent pop-ups" title="Recent pop-ups">
            <History />
          </button>
        )}
        {list.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.kind} ${t.leaving ? 'leaving' : ''} ${t.held ? 'held' : ''} ${t.sticky ? 'sticky' : ''} ${t.ref || t.msgId ? 'linked' : ''}`}
            role="status"
            onPointerEnter={(e) => { if (e.pointerType === 'mouse') store.holdToast(t.id, true); }}
            onPointerLeave={(e) => { if (e.pointerType === 'mouse') store.holdToast(t.id, false); }}
            onPointerDown={(e) => { if (e.pointerType !== 'mouse') store.holdToast(t.id, true); }}
            onPointerUp={(e) => { if (e.pointerType !== 'mouse') store.holdToast(t.id, false); }}
            onPointerCancel={() => store.holdToast(t.id, false)}
            onClick={() => {
              store.dismissToast(t.id);
              openToast(t);
            }}
          >
            {t.kind === 'good' ? <CheckCircle2 /> : t.kind === 'bad' ? <XCircle /> : t.kind === 'warn' ? <AlertTriangle /> : t.kind === 'achievement' ? <Trophy /> : <Info />}
            <div className="grow">
              <div className="t-title">{t.title}</div>
              {t.body && <div className="t-body">{t.body}</div>}
            </div>
            <button className="toast-x" aria-label="Close" onClick={(e) => { e.stopPropagation(); store.dismissToast(t.id); }}><X /></button>
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
