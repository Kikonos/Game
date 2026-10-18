import { Armchair, Check } from 'lucide-react';
import { useState } from 'react';
import { AIRCRAFT_BY_ID } from '../../data/aircraft';
import { CLASS_COLOR, CLASS_NAME, CLASSES, type CabinClass, productsFor, seatProduct } from '../../data/seats';
import * as A from '../../engine/actions';
import { type CabinConfig, cabinPresets, maxRowsFor, sectionSeats, validateCabin } from '../../engine/cabin';
import { refitDays } from '../../engine/economy';
import { SeatMap } from '../components/SeatMap';
import { Bar, Modal, Stepper } from '../components/ui';
import { money } from '../format';
import { store, useGame } from '../store';

export function CabinEditor({ typeId, value, onChange }: { typeId: string; value: CabinConfig; onChange: (c: CabinConfig) => void }) {
  const t = AIRCRAFT_BY_ID[typeId];
  const v = validateCabin(t, value);
  const presets = cabinPresets(t);
  const comfort = (() => {
    let s = 0, n = 0;
    for (const c of CLASSES) {
      const sec = value[c];
      if (!sec || sec.rows <= 0) continue;
      const seats = sectionSeats(t, sec);
      s += seatProduct(sec.product).comfort * seats;
      n += seats;
    }
    return n ? s / n : 0;
  })();

  const setSection = (cls: CabinClass, product: string | null, rows?: number) => {
    const next: CabinConfig = { ...value };
    if (!product) delete next[cls];
    else {
      const cur = value[cls];
      const max = maxRowsFor(t, value, cls, product);
      const r = rows ?? (cur && cur.product === product ? cur.rows : Math.min(max, cls === 'Y' ? max : 3));
      next[cls] = { product, rows: Math.max(0, Math.min(r, max)) };
    }
    // Keep economy filling the rest of the cabin when premium cabins change.
    if (cls !== 'Y' && next.Y) {
      const yMax = maxRowsFor(t, next, 'Y', next.Y.product);
      if (next.Y.rows > yMax) next.Y = { ...next.Y, rows: yMax };
    }
    onChange(next);
  };

  return (
    <div className="cabin-editor">
      <div className="row wrap gap-8 mb-12">
        <span className="small dim">Presets:</span>
        {presets.map((p) => (
          <button key={p.id} className="chip" title={p.desc} onClick={() => onChange(structuredClone(p.config))}>{p.name}</button>
        ))}
      </div>
      <div className="cabin-rows">
        {CLASSES.map((cls) => {
          const products = productsFor(t, cls);
          if (!products.length) return null;
          const sec = value[cls];
          const p = sec ? seatProduct(sec.product) : null;
          const max = sec ? maxRowsFor(t, value, cls, sec.product) : 0;
          return (
            <div key={cls} className={`cabin-row ${sec ? '' : 'off'}`}>
              <div className="cr-class">
                <span className="dot" style={{ background: CLASS_COLOR[cls] }} />
                <b>{CLASS_NAME[cls]}</b>
              </div>
              <select className="select sm" value={sec?.product ?? ''} onChange={(e) => setSection(cls, e.target.value || null)}>
                {cls !== 'Y' && <option value="">— None —</option>}
                {products.map((pp) => <option key={pp.id} value={pp.id}>{pp.name}</option>)}
              </select>
              {sec && p ? (
                <>
                  <Stepper value={sec.rows} min={0} max={max} onChange={(r) => setSection(cls, sec.product, r)} format={(r) => `${r} rows`} />
                  <div className="cr-info">
                    <b className="num">{sectionSeats(t, sec)}</b> <span className="dim small">seats</span>
                    <div className="tiny dim">{p.abreast(t)}-abreast · {p.pitch(t)}" pitch · comfort {p.comfort}</div>
                  </div>
                </>
              ) : <div className="tiny dim cr-info">Cabin not offered — passengers spill to other classes.</div>}
            </div>
          );
        })}
      </div>
      <div className="cabin-meters">
        <div>
          <div className="row between small"><span className="muted">Seats</span><b className="num">{v.total} / {t.maxSeats}</b></div>
          <Bar value={v.total / t.maxSeats} tone={v.total > t.maxSeats ? 'bad' : undefined} />
        </div>
        <div>
          <div className="row between small"><span className="muted">Cabin length used</span><b className="num">{Math.round((v.lengthUsed / t.cabinLength) * 100)}%</b></div>
          <Bar value={v.lengthUsed / t.cabinLength} tone={v.lengthUsed > t.cabinLength ? 'bad' : undefined} />
        </div>
        <div>
          <div className="row between small"><span className="muted">Average comfort</span><b className="num">{Math.round(comfort)}</b></div>
          <Bar value={comfort / 100} tone="auto" />
        </div>
      </div>
      {v.errors.length > 0 && <div className="badge bad mt-8">{v.errors[0]}</div>}
      <div className="seatmap-wrap mt-12"><SeatMap typeId={typeId} cabin={value} /></div>
      <div className="tiny dim mt-8">Seat products, pitch and abreast layouts follow real-world airline practice. Premium cabins need galleys and lavatories, which take extra space.</div>
    </div>
  );
}

export function CabinModal({ aircraftId }: { aircraftId: string }) {
  const g = useGame();
  const ac = g.fleet.find((a) => a.id === aircraftId);
  const [cabin, setCabin] = useState<CabinConfig>(() => structuredClone(ac?.pendingCabin ?? ac?.cabin ?? {}));
  if (!ac) return null;
  const t = AIRCRAFT_BY_ID[ac.typeId];
  const v = validateCabin(t, cabin);
  const cost = A.refitCost(ac, cabin);
  const unchanged = JSON.stringify(cabin) === JSON.stringify(ac.pendingCabin ?? ac.cabin);
  const apply = () => {
    const res = store.act((gg) => A.reconfigure(gg, ac.id, cabin));
    if (res.ok) store.closeModal();
  };
  return (
    <Modal
      title={`Cabin · ${ac.reg}`}
      icon={<Armchair className="accent" />}
      size="wide"
      onClose={() => store.closeModal()}
      footer={
        <>
          <span className="small muted grow">
            {ac.status === 'delivering' ? 'Free — installed before delivery.' : `Refit: ${money(cost)} · out of service ${refitDays(t)} days`}
          </span>
          <button className="btn" onClick={() => store.closeModal()}>Cancel</button>
          <button className="btn btn-primary" disabled={!v.ok || unchanged} onClick={apply}><Check /> Apply cabin</button>
        </>
      }
    >
      <div className="small muted mb-12">{t.name} · cabin length {t.cabinLength}" · exit limit {t.maxSeats} seats</div>
      <CabinEditor typeId={ac.typeId} value={cabin} onChange={setCabin} />
    </Modal>
  );
}
