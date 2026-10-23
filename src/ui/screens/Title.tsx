import { Download, FolderOpen, Play, Plus, Settings, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AIRCRAFT_BY_ID } from '../../data/aircraft';
import { AIRPORTS } from '../../data/airports';
import { BRAND_LIVERY } from '../../data/livery';
import { latestSave, loadFromSlot } from '../../engine/save';
import { AircraftArt } from '../components/AircraftArt';
import { LogoMark } from '../components/Logo';
import { GlobalModals } from '../game/Modals';
import { money } from '../format';
import { WorldMap, type MapRoute } from '../map/WorldMap';
import { offline, promptInstall } from '../offline';
import { store, useStore } from '../store';
import { CURRENT, whatsNewToShow } from '../../data/whatsNew';

const AMBIENT: [string, string][] = [
  ['LHR', 'JFK'], ['DXB', 'LHR'], ['SIN', 'SYD'], ['HND', 'LAX'], ['CDG', 'GRU'], ['FRA', 'PVG'], ['DOH', 'JNB'],
  ['IST', 'DEL'], ['AMS', 'ORD'], ['MAD', 'MEX'], ['ICN', 'SFO'], ['HKG', 'MEL'], ['ATL', 'MIA'], ['DXB', 'BKK'],
  ['JFK', 'LAX'], ['LHR', 'SIN'], ['SCL', 'LIM'], ['BOG', 'MIA'], ['ADD', 'NBO'], ['YYZ', 'LHR'], ['AKL', 'SYD'],
  ['PEK', 'CDG'], ['BOM', 'DXB'], ['CAI', 'FRA'], ['GRU', 'EZE'], ['SEA', 'ANC'], ['DEN', 'ORD'], ['MNL', 'NRT'],
];

const SHOWCASE = ['a320ceo', 'b738', 'b752', 'b763', 'a333', 'b772', 'b77w', 'b744', 'a359', 'a388'];

function useOffline() {
  return useSyncExternalStore(
    (fn) => { offline.listeners.add(fn); return () => offline.listeners.delete(fn); },
    () => `${offline.online}-${offline.ready}-${!!offline.installPrompt}`,
  );
}

export function Title() {
  useStore();
  useOffline();
  const save = useMemo(() => latestSave(), []);
  const [show, setShow] = useState(0);
  // "What's new" once per version, after the loading screen (never over another dialog).
  useEffect(() => {
    // v0.9 §X: the first v0.9 launch catches up on v0.8 and v0.7.4 too (once), then the normal rule.
    if (whatsNewToShow(store.settings.seenWhatsNew, !!store.settings.whatsNewCatchUp).length && !store.modal) store.openModal({ kind: 'whatsNew' });
  }, []);
  // Advance every 6 s; a tap on the card skips ahead and restarts the timer.
  useEffect(() => {
    const id = setTimeout(() => setShow((s) => (s + 1) % SHOWCASE.length), 6000);
    return () => clearTimeout(id);
  }, [show]);
  const routes: MapRoute[] = useMemo(
    () => AMBIENT.map(([a, b], i) => ({ id: `amb${i}`, from: a, to: b, weight: 0.35, planes: 1, color: i % 3 === 0 ? '#8b5cff' : '#3ee6ff' })),
    [],
  );
  const airports = useMemo(() => AIRPORTS.filter((a) => a.size >= 4).map((a) => ({ code: a.code, state: 'open' as const })), []);
  const t = AIRCRAFT_BY_ID[SHOWCASE[show]];

  const cont = () => {
    if (!save) return;
    try {
      const g = loadFromSlot(save.slot);
      if (g) store.loadGame(g);
    } catch (e) {
      store.toast('bad', 'Could not load save', (e as Error).message);
    }
  };

  return (
    <div className="title">
      <div className="title-map">
        <WorldMap routes={routes} airports={airports} interactive={false} animate={store.settings.mapAnimations} controls={false} fit={['SFO', 'NRT', 'SYD', 'GRU', 'LHR']} />
      </div>
      <div className="title-vignette" />
      <div className="title-content">
        <div className="title-left">
          <div className="row gap-16 title-brand">
            <LogoMark size={104} />
            <div>
              <h1 className="title-word">BLOCK<br />HOURS</h1>
              <div className="title-tag">ACMI &amp; CHARTER</div>
            </div>
          </div>
          <p className="title-pitch">
            Run an ACMI operator: lease out aircraft with crew, maintenance and insurance by the block hour. Season bases, AOG rescues, charters and repatriation flights.
          </p>
          <div className="title-menu">
            {save && (
              <button className="menu-btn primary" onClick={cont}>
                <Play />
                <div>
                  <div className="mb-t">Continue</div>
                  <div className="mb-s">{save.company} · {save.date} · {money(save.cash)} · {save.fleet} aircraft</div>
                </div>
              </button>
            )}
            <button className={`menu-btn ${save ? '' : 'primary'}`} onClick={() => store.setScreen('newgame')}>
              <Plus />
              <div>
                <div className="mb-t">New Operator</div>
                <div className="mb-s">Two A320s, sixty crew and a summer to win</div>
              </div>
            </button>
            <button className="menu-btn" onClick={() => store.openModal({ kind: 'saves', mode: 'load' })}>
              <FolderOpen />
              <div>
                <div className="mb-t">Load Game</div>
                <div className="mb-s">Saves are stored on this device — or import a file</div>
              </div>
            </button>
            <div className="row gap-8 mt-8">
              <button className="btn btn-ghost" onClick={() => store.openModal({ kind: 'settings' })}><Settings /> Settings</button>
              {offline.installPrompt && <button className="btn btn-ghost" onClick={() => void promptInstall()}><Download /> Install app</button>}
            </div>
          </div>
        </div>
        <div className="title-right">
          <div className="showcase card" key={t.id} role="button" tabIndex={0} aria-label="Next featured aircraft" onClick={() => setShow((s) => (s + 1) % SHOWCASE.length)}>
            <div className="showcase-head">
              <div className="upper dim">Featured aircraft</div>
              <h3>{t.name}</h3>
            </div>
            <div className="showcase-art">
              <AircraftArt typeId={t.id} livery={BRAND_LIVERY} code="BH" name="Block Hours" />
            </div>
            <div className="showcase-specs">
              <div><span className="dim small">Seats</span><b>{t.typicalSeats}–{t.maxSeats}</b></div>
              <div><span className="dim small">Range</span><b>{t.rangeKm.toLocaleString()} km</b></div>
              <div><span className="dim small">Price</span><b>{money(t.price, 0)}</b></div>
            </div>
            <p className="small muted showcase-fact">{t.fact}</p>
            <div className="showcase-dots" aria-hidden>
              {SHOWCASE.map((id, i) => <span key={id} className={i === show ? 'on' : ''} />)}
            </div>
          </div>
        </div>
      </div>
      <div className="title-foot">
        <span className={`chip ${offline.online ? '' : 'active'}`}>
          {offline.online ? <Wifi size={14} /> : <WifiOff size={14} />}
          {offline.ready ? 'Offline ready — plays without internet' : offline.online ? 'Online' : 'Offline mode'}
        </span>
        <span className="dim small">{CURRENT.version} {CURRENT.name} · {AIRPORTS.length} airports · {SHOWCASE.length} aircraft types</span>
      </div>
      <GlobalModals />
    </div>
  );
}
