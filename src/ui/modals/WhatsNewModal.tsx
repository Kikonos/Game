// "What's new" (player request): shown once on the Title screen after an update ('Version X is live!'), with the
// new features and improvements of that version; Settings → What's new reopens it. Data: data/whatsNew.ts.

import { Sparkles, Wrench } from 'lucide-react';
import { CURRENT } from '../../data/whatsNew';
import { Modal } from '../components/ui';
import { store } from '../store';

export function WhatsNewModal() {
  const close = () => {
    store.setSettings({ seenWhatsNew: CURRENT.version });
    store.closeModal();
  };
  return (
    <Modal className="wn-modal" title={`Version ${CURRENT.version.replace(/^v/, '')} is live!`} icon={<Sparkles className="gold" />} onClose={close} footer={
      <button className="btn btn-primary" onClick={close}>Got it</button>
    }>
      <div className="col gap-12">
        <div className="small muted">{CURRENT.name}</div>
        <div className="wn-head"><Sparkles className="accent" /> New features</div>
        <ul className="wn-list">
          {CURRENT.features.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
        {CURRENT.improvements.length > 0 && (
          <>
            <div className="wn-head"><Wrench className="accent" /> Improvements and fixes</div>
            <ul className="wn-list">
              {CURRENT.improvements.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
