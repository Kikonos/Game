import { Building2, Check, Coffee, Globe2, Lock, Network, Plane, Wand2, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AIRPORT_BY_CODE, AIRPORTS, AIRPORTS_BY_REGION, SIZE_LABEL } from '../../data/airports';
import { flag } from '../../data/countries';
import { CONTINENT_ORDER, CONTINENTS, REGIONS, REGION_BY_ID } from '../../data/regions';
import * as A from '../../engine/actions';
import { hubMonthlyCost, HUB_MONTHLY } from '../../engine/economy';
import {
  LONG_HAUL_FEE, LONG_HAUL_LEVEL, REVENUE_MGMT_FEE, REVENUE_MGMT_LEVEL, continentUnlock, maxHubs, regionMass, regionUnlock,
  unlockedContinents,
} from '../../engine/progression';
import { homeContinent } from '../../engine/state';
import type { GameState, HubUpgrades } from '../../engine/types';
import { Bar, Card } from '../components/ui';
import { money } from '../format';
import { WorldMap } from '../map/WorldMap';
import { store, useGame } from '../store';
import { mapRotate } from './common';

const UPGRADE_ICON: Record<keyof HubUpgrades, React.ReactNode> = { lounge: <Coffee />, maintenance: <Wrench />, connections: <Network /> };

function RegionCard({ g, id }: { g: GameState; id: string }) {
  const r = REGION_BY_ID[id];
  const unlocked = g.unlockedRegions.includes(id);
  const o = regionUnlock(g, id);
  const maxMass = Math.max(...REGIONS.map((x) => regionMass(x.id)));
  return (
    <div className={`card region-unlock ${unlocked ? 'unlocked' : ''}`}>
      <div className="row between">
        <b>{r.name}</b>
        {unlocked ? <span className="badge good"><Check size={12} /> {id === g.airline.homeRegion ? 'Home' : 'Unlocked'}</span> : <span className="badge"><Lock size={12} /> Level {o.level}</span>}
      </div>
      <p className="small muted">{r.blurb}</p>
      <div className="row between tiny dim"><span>{AIRPORTS_BY_REGION[id].length} airports</span><span>Market size</span></div>
      <Bar value={regionMass(id) / maxMass} size="thin" />
      {!unlocked && (
        <button className="btn btn-primary btn-sm mt-12" disabled={!o.available} onClick={() => store.act((gg) => A.unlockRegion(gg, id), { sound: 'levelup' })} title={o.reason}>
          {o.available ? `Unlock for ${money(o.fee)}` : `${o.reason} · ${money(o.fee)}`}
        </button>
      )}
    </div>
  );
}

function Hubs({ g }: { g: GameState }) {
  const [code, setCode] = useState('');
  const options = useMemo(() => AIRPORTS.filter((a) => g.unlockedRegions.includes(a.region) && a.size >= 2 && !g.hubs.some((h) => h.code === a.code))
    .sort((a, b) => b.size - a.size || b.pop - a.pop), [g.unlockedRegions.length, g.hubs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = options.find((a) => a.code === code) ?? options[0];
  const limit = maxHubs(g.level);
  return (
    <Card title="Hubs" icon={<Building2 className="ico" />} sub={`${g.hubs.length} of ${limit} allowed at level ${g.level}`}>
      <div className="hub-list">
        {g.hubs.map((h) => {
          const a = AIRPORT_BY_CODE[h.code];
          const based = g.fleet.filter((x) => x.hub === h.code).length;
          return (
            <div key={h.code} className="hub-row">
              <div className="row between">
                <div className="row gap-8"><span className="code">{h.code}</span><b>{a.city}</b><span className="dim small">{flag(a.country)} {SIZE_LABEL[a.size]}</span></div>
                <span className="small muted">{based} aircraft · {money(hubMonthlyCost(g, h.code))}/mo</span>
              </div>
              <div className="upgrades">
                {(Object.keys(A.HUB_UPGRADES) as (keyof HubUpgrades)[]).map((k) => {
                  const u = A.HUB_UPGRADES[k];
                  const owned = h.upgrades[k];
                  return (
                    <div key={k} className={`upgrade ${owned ? 'owned' : ''}`}>
                      <div className="row gap-8">{UPGRADE_ICON[k]}<b className="small">{u.name}</b></div>
                      <div className="tiny dim">{u.desc}</div>
                      {owned ? <span className="badge good mt-8"><Check size={12} /> Built · {money(u.monthly)}/mo</span> : (
                        <button className="btn btn-xs mt-8" onClick={() => store.act((gg) => A.upgradeHub(gg, h.code, k), { sound: 'cash' })}>Build {money(u.cost)}</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="divider" />
      <div className="upper dim mb-8">Open a new hub</div>
      {g.hubs.length >= limit ? (
        <div className="small muted">Reach level {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find((l) => maxHubs(l) > g.hubs.length) ?? 10} to open another hub.</div>
      ) : sel ? (
        <div className="row gap-8 wrap">
          <select className="select sm grow" value={sel.code} onChange={(e) => setCode(e.target.value)}>
            {options.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.city} ({SIZE_LABEL[a.size]}) · {REGION_BY_ID[a.region].name}</option>)}
          </select>
          <button className="btn btn-primary btn-sm" onClick={() => store.act((gg) => A.openHub(gg, sel.code), { sound: 'cash' })}>Open for {money(A.hubOpenCost(sel.code))}</button>
          <div className="tiny dim" style={{ width: '100%' }}>Running cost up to {money(HUB_MONTHLY[sel.size])}/month, scaling with aircraft based there. Hubs let you fly routes between any of their destinations.</div>
        </div>
      ) : <div className="small muted">No more airports available in your regions.</div>}
    </Card>
  );
}

export function Expansion() {
  const g = useGame();
  const home = homeContinent(g);
  const homeRegions = REGIONS.filter((r) => r.continent === home);
  const others = CONTINENT_ORDER.filter((c) => c !== home);
  const contDone = unlockedContinents(g).length;
  const airports = AIRPORTS.map((a) => ({ code: a.code, state: g.hubs.some((h) => h.code === a.code) ? ('hub' as const) : g.unlockedRegions.includes(a.region) ? ('open' as const) : ('locked' as const) }));
  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>Expansion</h1>
          <div className="subtitle">Region by region, continent by continent — until the whole world is your network.</div>
        </div>
        <div className="actions">
          <span className="chip"><Globe2 size={14} /> {g.unlockedRegions.length} / {REGIONS.length} regions</span>
          <span className="chip">{contDone} / {CONTINENT_ORDER.length} continents</span>
        </div>
      </div>
      <section className="card expansion-map">
        <WorldMap rotate={mapRotate(g)} routes={[]} airports={airports} regionLabels={REGIONS.map((r) => ({ id: r.id, locked: !g.unlockedRegions.includes(r.id) }))} interactive controls animate={false} />
      </section>

      <h2 className="section-title"><span className="dot" style={{ background: CONTINENTS[home].color }} /> {CONTINENTS[home].name} — your home continent</h2>
      <div className="grid-auto">
        {homeRegions.map((r) => <RegionCard key={r.id} g={g} id={r.id} />)}
      </div>

      <h2 className="section-title">Licences & systems</h2>
      <div className="grid-2">
        <div className={`card license ${g.licenses.longHaul ? 'unlocked' : ''}`}>
          <div className="row gap-12"><Plane className="accent" /><div><b>Long-Haul Operations Certificate</b><div className="small muted">Fly intercontinental routes and apply for traffic rights on other continents.</div></div></div>
          {g.licenses.longHaul ? <span className="badge good mt-12"><Check size={12} /> Certified</span> : (
            <button className="btn btn-primary btn-sm mt-12" disabled={g.level < LONG_HAUL_LEVEL || g.cash < LONG_HAUL_FEE} onClick={() => store.act((gg) => A.buyLongHaulLicense(gg))}>
              {g.level < LONG_HAUL_LEVEL ? <><Lock size={13} /> Requires level {LONG_HAUL_LEVEL}</> : `Apply for ${money(LONG_HAUL_FEE)}`}
            </button>
          )}
        </div>
        <div className={`card license ${g.licenses.revenueMgmt ? 'unlocked' : ''}`}>
          <div className="row gap-12"><Wand2 className="accent" /><div><b>Revenue Management System</b><div className="small muted">Automatically re-optimises every fare each week. $150K/month to run.</div></div></div>
          {g.licenses.revenueMgmt ? (
            <div className="row gap-8 mt-12"><span className="badge good"><Check size={12} /> Installed</span>
              <button className="btn btn-xs" onClick={() => store.update((gg) => { gg.policies.autoPricing = !gg.policies.autoPricing; })}>{g.policies.autoPricing ? 'Auto-pricing ON' : 'Auto-pricing OFF'}</button>
            </div>
          ) : (
            <button className="btn btn-primary btn-sm mt-12" disabled={g.level < REVENUE_MGMT_LEVEL || g.cash < REVENUE_MGMT_FEE} onClick={() => store.act((gg) => A.buyRevenueManagement(gg))}>
              {g.level < REVENUE_MGMT_LEVEL ? <><Lock size={13} /> Requires level {REVENUE_MGMT_LEVEL}</> : `Install for ${money(REVENUE_MGMT_FEE)}`}
            </button>
          )}
        </div>
      </div>

      <h2 className="section-title">Other continents</h2>
      <div className="grid-3">
        {others.map((c) => {
          const o = continentUnlock(g, c);
          const regs = REGIONS.filter((r) => r.continent === c);
          const unlocked = regs.every((r) => g.unlockedRegions.includes(r.id));
          return (
            <div key={c} className={`card continent ${unlocked ? 'unlocked' : ''}`} style={{ ['--cc' as string]: CONTINENTS[c].color }}>
              <div className="row between"><h3>{CONTINENTS[c].name}</h3>{unlocked ? <span className="badge good"><Check size={12} /> Open</span> : <span className="badge"><Lock size={12} /> Level {o.level}</span>}</div>
              <div className="small muted">{regs.map((r) => r.name).join(' · ')}</div>
              <div className="tiny dim mt-8">{regs.reduce((s, r) => s + AIRPORTS_BY_REGION[r.id].length, 0)} airports</div>
              {!unlocked && (
                <button className="btn btn-primary btn-sm mt-12" disabled={!o.available} onClick={() => store.act((gg) => A.unlockContinent(gg, c))} title={o.reason}>
                  {o.available ? `Unlock for ${money(o.fee)}` : `${o.reason} · ${money(o.fee)}`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <h2 className="section-title">Hubs</h2>
      <Hubs g={g} />
    </div>
  );
}
