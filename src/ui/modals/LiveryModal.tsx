// Livery sheet (v0.5.1, LIVERY.md §3.3): hosts the ART lane's LiveryEditor in a full-height dialog.
// Company: the company livery (+ "Use on all aircraft"). Aircraft: Company · All white · Custom, locked
// while client paint is on or booked. New Game uses LiverySheet with local state (no game yet).

import { Palette } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { artFor } from '../../data/acmiTypes';
import { WHITE_LIVERY } from '../../data/livery';
import type { GameState, Livery, LiveryRef } from '../../engine/core/types';
import { liveryOf, paintStatus, setAircraftLivery, setCompanyLivery, setFleetLivery } from '../../engine/ops';
import { LiveryEditor } from '../components/livery/LiveryEditor';
import { Modal } from '../components/ui';
import { store, useGame } from '../store';

const DEFAULT_TYPES = ['a320ceo', 'b738', 'b763', 'b77w'];

/** Preview chips: the given art types first (fleet / this aircraft), topped up with the defaults, at most 5. */
export function previewTypes(first: string[]): string[] {
  return [...new Set([...first, ...DEFAULT_TYPES])].slice(0, 5);
}

const fleetTypes = (g: GameState) => [...new Set(Object.values(g.fleet).map((a) => artFor(a.typeId, a.variant)))];

/** Full-height sheet around the editor; `children` is the editor. */
function Sheet({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <Modal size="xwide" className="lv-modal" icon={<Palette className="accent" />} title={title} onClose={onClose}>
      {children}
    </Modal>
  );
}

/** New Game: the company livery with local state; Save hands it back. */
export function LiverySheet({ value, code, name, onSave, onCancel }: { value: Livery; code: string; name: string; onSave: (l: Livery) => void; onCancel: () => void }) {
  const [lv, setLv] = useState<Livery>(() => structuredClone(value));
  return (
    <Sheet title="Company livery" onClose={onCancel}>
      <LiveryEditor
        value={lv} onChange={setLv} code={code} name={name} mode="company" types={previewTypes(['a320ceo'])}
        onSave={() => onSave(lv)} onCancel={onCancel} footer={<span className="lv-foot-note">Every aircraft wears it unless you choose otherwise.</span>}
      />
    </Sheet>
  );
}

function CompanyLivery() {
  const g = useGame();
  const c = g.company;
  const [lv, setLv] = useState<Livery>(() => structuredClone(c.livery));
  const close = () => store.closeModal();
  const save = () => {
    if (store.act((gg) => setCompanyLivery(gg, lv)).ok) close();
  };
  // "Use on all aircraft" asks first, as on the Company screen; Cancel keeps the editor open
  const [ask, setAsk] = useState(false);
  const fleet = Object.values(g.fleet);
  const isLocked = (id: string) => paintStatus(g, id).locked;
  const locked = fleet.filter((ac) => isLocked(ac.id)).length;
  const others = fleet.filter((ac) => !isLocked(ac.id) && (ac.livery ?? 'company') !== 'company').length;
  const applyAll = () => {
    setAsk(false);
    if (!store.act((gg) => setCompanyLivery(gg, lv), { toastOk: false }).ok) return;
    if (store.act((gg) => setFleetLivery(gg, 'company')).ok) close();
  };
  return (
    <>
    <Sheet title="Company livery" onClose={ask ? () => setAsk(false) : close}>
      <LiveryEditor
        value={lv} onChange={setLv} code={c.code} name={c.name} reg={Object.values(g.fleet)[0]?.reg ?? `${c.regPrefix}BHA`} acName={Object.values(g.fleet)[0]?.name} mode="company" types={previewTypes(fleetTypes(g))}
        onApplyAll={() => setAsk(true)} onSave={save} onCancel={close} resetTo={c.livery}
        footer={<span className="lv-foot-note">Free and instant. Aircraft in client colours keep them.</span>}
      />
    </Sheet>
    {ask && (
      <Modal title="Company livery on every aircraft?" onClose={() => setAsk(false)} footer={
        <>
          <button className="btn" onClick={() => setAsk(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={applyAll}>Use on all aircraft</button>
        </>
      }>
        <p className="muted">
          Saves this livery{others > 0 ? ` and puts ${others} aircraft with their own livery back in the company colours` : ' for the whole fleet'}.
          {locked ? ` ${locked} in client colours keep them.` : ''} Free and instant.
        </p>
      </Modal>
    )}
    </>
  );
}

function AircraftLivery({ aircraftId }: { aircraftId: string }) {
  const g = useGame();
  const ac = g.fleet[aircraftId];
  const [ref, setRef] = useState<LiveryRef>(() => structuredClone(ac?.livery ?? 'company'));
  if (!ac) return null;
  const c = g.company;
  const st = paintStatus(g, ac.id);
  const close = () => store.closeModal();
  const worn = liveryOf(g, ac);
  // Locked: show what it wears (client colours); otherwise what the choice resolves to.
  const value: Livery = st.locked ? worn.livery : ref === 'company' ? c.livery : ref === 'white' ? WHITE_LIVERY : ref.custom;
  const code = st.locked ? worn.code : typeof ref === 'object' ? ref.custom.code?.text ?? c.code : c.code;
  const name = st.locked ? worn.name : typeof ref === 'object' ? ref.custom.titles?.text ?? c.name : c.name;
  const save = () => {
    if (store.act((gg) => setAircraftLivery(gg, ac.id, ref)).ok) close();
  };
  // Custom from All white starts from the company livery (as on the Fleet card), not a blank airframe
  const pickRef = (r: LiveryRef) => setRef(typeof r === 'object' && ref === 'white' ? { custom: structuredClone(c.livery) } : r);
  return (
    <Sheet title={<><span className="mono">{ac.reg}</span> livery</>} onClose={close}>
      <LiveryEditor
        value={value} onChange={(l) => setRef({ custom: l })} code={code} name={name} reg={ac.reg} acName={ac.name} mode="aircraft"
        types={previewTypes([artFor(ac.typeId, ac.variant)])} aircraft={{ ref, onRef: pickRef, locked: st.locked ? st.why ?? 'In client colours' : undefined }}
        onSave={st.locked ? undefined : save} onCancel={close}
        footer={st.locked ? undefined : <span className="lv-foot-note">Free and instant.</span>}
      />
    </Sheet>
  );
}

export function LiveryModal({ target }: { target: 'company' | { aircraftId: string } }) {
  return target === 'company' ? <CompanyLivery /> : <AircraftLivery aircraftId={target.aircraftId} />;
}
