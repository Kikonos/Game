// v0.7.1 the Glossary (UPDATE-0.7.1.md §10, §11): every term with its one-line meaning in two columns and a 'Show me'
// link to where it appears. Opened from Settings and from every <Term> popover (that term is highlighted).

import { BookOpenText, ChevronRight } from 'lucide-react';
import { useEffect } from 'react';
import { GLOSSARY, type TermId } from '../../data/glossary';
import { glossaryTarget } from '../components/problemLogic';
import { Modal } from '../components/ui';
import { store } from '../store';

export function GlossaryModal({ term }: { term?: TermId }) {
  const ids = (Object.keys(GLOSSARY) as TermId[]).sort((a, b) => GLOSSARY[a].term.localeCompare(GLOSSARY[b].term));
  useEffect(() => {
    if (term) document.querySelector(`[data-term="${term}"]`)?.scrollIntoView({ block: 'center' });
  }, [term]);
  const show = (id: TermId) => {
    const w = GLOSSARY[id].where;
    if (!w) return;
    const t = glossaryTarget(w);
    store.closeModal({ all: true });
    store.navigate(t.tab, { view: t.view });
  };
  return (
    <Modal size="wide" className="gl-modal" title="Glossary" icon={<BookOpenText className="accent" />} onClose={() => store.closeModal()} footer={<button className="btn btn-primary" onClick={() => store.closeModal()}>Close</button>}>
      <p className="small muted gl-intro">Plain meanings of the words the game uses. Tap any underlined word in a warning for the same line.</p>
      <div className="gl-grid">
        {ids.map((id) => {
          const e = GLOSSARY[id];
          return (
            <div key={id} className={`gl-entry ${term === id ? 'on' : ''}`} data-term={id}>
              <div className="gl-term"><b>{e.term}</b></div>
              <div className="small muted">{e.short}</div>
              {e.where && (
                <button className="btn btn-sm btn-ghost gl-show" onClick={() => show(id)}>Show me · {glossaryTarget(e.where).label} <ChevronRight /></button>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
