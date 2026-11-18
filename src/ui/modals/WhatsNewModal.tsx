// "What's new" (player request): shown once on the Title screen after an update ('Version X is live!'), with the
// new features, fixes and improvements of every version newer than the last one seen (v0.8 fix pack: a player
// jumping two versions sees both, newest first); Settings → What's new shows them all. Data: data/whatsNew.ts.

import { Bug, Sparkles, Wrench } from 'lucide-react';
import { CURRENT, WHATS_NEW, whatsNewToShow, type WhatsNewEntry } from '../../data/whatsNew';
import { Modal } from '../components/ui';
import { store } from '../store';

function Entry({ e, head, bare }: { e: WhatsNewEntry; head: boolean; bare?: boolean }) {
  return (
    <div className="col gap-12 wn-entry" data-version={e.version}>
      {bare ? null : head ? <div className="wn-version"><b>{e.version}</b> <span className="muted">{e.name}</span></div> : <div className="small muted">{e.name}</div>}
      <div className="wn-head"><Sparkles className="accent" /> New features</div>
      <ul className="wn-list">
        {e.features.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
      {!!e.fixes?.length && (
        <>
          <div className="wn-head"><Bug className="accent" /> Fixes</div>
          <ul className="wn-list">
            {e.fixes.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </>
      )}
      {e.improvements.length > 0 && (
        <>
          <div className="wn-head"><Wrench className="accent" /> Improvements and fixes</div>
          <ul className="wn-list">
            {e.improvements.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}

const count = (e: WhatsNewEntry) => {
  const n = e.features.length + (e.fixes?.length ?? 0) + e.improvements.length;
  return `${n} change${n === 1 ? '' : 's'}`;
};

/** `all`: every version (Settings); else what is new since settings.seenWhatsNew (the update popup). One tap closes. */
export function WhatsNewModal({ all }: { all?: boolean }) {
  const close = () => {
    store.setSettings({ seenWhatsNew: CURRENT.version, whatsNewCatchUp: 'v0.9' });
    store.closeModal();
  };
  // v0.9 §X: the one-time catch-up (v0.9, v0.8, v0.7.4 even if v0.8 was seen), then what is new since the last one seen.
  const unseen = whatsNewToShow(store.settings.seenWhatsNew, !!store.settings.whatsNewCatchUp);
  const list = all ? WHATS_NEW : unseen.length ? unseen : [CURRENT];
  const head = list.length > 1;
  return (
    <Modal className="wn-modal" title={all ? "What's new" : `Version ${CURRENT.version.replace(/^v/, '')} is live!`} icon={<Sparkles className="gold" />} onClose={close} footer={
      <button className="btn btn-primary" onClick={close}>Got it</button>
    }>
      <div className="col gap-16">
        {/* v0.25 r2: the newest version open, older ones folded to one line each (a tap opens one). */}
        {list.map((e, i) => i === 0 ? <Entry key={e.version} e={e} head={head} /> : (
          <details key={e.version} className="wn-fold" data-version={e.version}>
            <summary><b>{e.version}</b> <span className="muted">{e.name}</span><span className="wn-count dim small">{count(e)}</span></summary>
            <Entry e={e} head={false} bare />
          </details>
        ))}
      </div>
    </Modal>
  );
}
