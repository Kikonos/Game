import { Coffee, Crown, Heart, Luggage, Megaphone, Rocket, Star, Utensils, Wifi } from 'lucide-react';
import { useState } from 'react';
import { REGION_BY_ID } from '../../data/regions';
import * as A from '../../engine/actions';
import { refFare } from '../../engine/economy';
import type { CampaignType, GameState } from '../../engine/types';
import { formatDate } from '../../engine/util';
import { Bar, Card, Seg, Stars } from '../components/ui';
import { compact, money, pct } from '../format';
import { store, useGame } from '../store';

function positioning(g: GameState): { label: string; desc: string } {
  let ratio = 0, n = 0;
  for (const r of g.routes) { ratio += r.prices.Y / refFare(r.dist, 'Y'); n++; }
  const avg = n ? ratio / n : 1;
  const q = g.stats.avgQuality;
  if (avg < 0.85 && q < 50) return { label: 'Ultra low-cost', desc: 'Rock-bottom fares, no frills. Volume is everything.' };
  if (avg < 0.95) return { label: 'Low-cost carrier', desc: 'Cheap and cheerful — passengers come for the price.' };
  if (q > 68 && avg > 1.1) return { label: 'Premium carrier', desc: 'Travellers pay more for your superior product.' };
  if (q > 60) return { label: 'Full-service airline', desc: 'A solid, comfortable product at fair prices.' };
  return { label: 'Value carrier', desc: 'A balanced product at market prices.' };
}

export function Brand() {
  const g = useGame();
  const p = g.policies;
  const pos = positioning(g);
  const [region, setRegion] = useState(g.airline.homeRegion);
  const set = (fn: (gg: GameState) => void) => store.update(fn);
  const active = g.campaigns.filter((c) => c.endDay >= g.day);
  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>Brand & Service</h1>
          <div className="subtitle">What passengers experience — and how they hear about you.</div>
        </div>
      </div>
      <div className="grid-3 mb-16">
        <div className="card brand-hero span-2">
          <div className="upper dim">Brand perception</div>
          <h2>{pos.label}</h2>
          <p className="muted">{pos.desc}</p>
          <div className="grid-3 mt-12">
            <div><div className="tiny dim">Reputation</div><div className="row gap-8"><b className="big">{Math.round(g.reputation)}</b><Stars value={g.reputation} /></div></div>
            <div><div className="tiny dim">Product quality</div><b className="big">{Math.round(g.stats.avgQuality)}</b><Bar value={g.stats.avgQuality / 100} tone="auto" size="thin" /></div>
            <div><div className="tiny dim">Reliability</div><b className="big">{pct(g.stats.reliability, 1)}</b><Bar value={(g.stats.reliability - 0.9) * 10} tone="auto" size="thin" /></div>
          </div>
          <div className="tiny dim mt-12">Reputation drifts toward a target set by comfort, reliability and value for money. It boosts demand on every route.</div>
        </div>
        <Card title="Frequent flyer programme" icon={<Crown className="ico" />}>
          {g.loyalty.active ? (
            <>
              <div className="kpi-value">{compact(g.loyalty.members)}</div>
              <div className="small muted">members since {formatDate(g.loyalty.since)}</div>
              <div className="small mt-8">Demand boost: <b className="good">+{Math.round(Math.min(12, 3 + g.loyalty.members / 400_000))}%</b> · cost $0.40 per passenger</div>
            </>
          ) : (
            <>
              <p className="small muted">Reward loyal travellers with miles. +3–12% demand on every route and better reputation. Costs $0.40 per passenger.</p>
              <button className="btn btn-primary btn-sm" disabled={g.level < A.LOYALTY_LEVEL} onClick={() => store.act((gg) => A.launchLoyalty(gg), { sound: 'levelup' })}>
                {g.level < A.LOYALTY_LEVEL ? `Requires level ${A.LOYALTY_LEVEL}` : `Launch for ${money(A.LOYALTY_COST)}`}
              </button>
            </>
          )}
        </Card>
      </div>

      <h2 className="section-title">Onboard product</h2>
      <div className="grid-2">
        <div className="card policy">
          <div className="row gap-12"><Utensils className="accent" /><div className="grow"><b>Economy catering</b><div className="small muted">Free meals cost money but delight passengers. Buy-on-board earns ancillary revenue.</div></div></div>
          <Seg value={p.cateringY} onChange={(v) => set((gg) => { gg.policies.cateringY = v; })} options={[{ value: 0, label: 'Buy on board' }, { value: 1, label: 'Free snack' }, { value: 2, label: 'Hot meal' }]} />
        </div>
        <div className="card policy">
          <div className="row gap-12"><Coffee className="accent" /><div className="grow"><b>Premium cabin dining</b><div className="small muted">Gourmet menus and fine wines for business & first.</div></div></div>
          <Seg value={p.cateringPremium} onChange={(v) => set((gg) => { gg.policies.cateringPremium = v; })} options={[{ value: 0, label: 'Standard' }, { value: 1, label: 'Gourmet' }]} />
        </div>
        <div className="card policy">
          <div className="row gap-12"><Luggage className="accent" /><div className="grow"><b>Checked baggage</b><div className="small muted">Bag fees bring in ~$11 per passenger, but travellers dislike them.</div></div></div>
          <Seg value={p.bagsFee ? 1 : 0} onChange={(v) => set((gg) => { gg.policies.bagsFee = v === 1; })} options={[{ value: 0, label: 'Included' }, { value: 1, label: 'Paid extra' }]} />
        </div>
        <div className="card policy">
          <div className="row gap-12"><Wifi className="accent" /><div className="grow"><b>In-flight Wi-Fi</b><div className="small muted">Paid Wi-Fi earns a little; free Wi-Fi wins hearts. Costs $18–30K per aircraft per month.</div></div></div>
          <Seg value={p.wifi} onChange={(v) => set((gg) => { gg.policies.wifi = v; })} options={[{ value: 0, label: 'None' }, { value: 1, label: 'Paid' }, { value: 2, label: 'Free' }]} />
        </div>
      </div>

      <h2 className="section-title">Marketing campaigns</h2>
      <div className="grid-3">
        {(Object.keys(A.CAMPAIGNS) as Exclude<CampaignType, 'route'>[]).map((k) => {
          const c = A.CAMPAIGNS[k];
          return (
            <div key={k} className="card campaign">
              <div className="row gap-12">{k === 'global' ? <Rocket className="accent" /> : k === 'regional' ? <Megaphone className="accent" /> : <Heart className="accent" />}<b>{c.name}</b></div>
              <p className="small muted">{c.desc}</p>
              {k !== 'global' && (
                <select className="select sm" value={region} onChange={(e) => setRegion(e.target.value)}>
                  {g.unlockedRegions.map((r) => <option key={r} value={r}>{REGION_BY_ID[r].name}</option>)}
                </select>
              )}
              <button className="btn btn-primary btn-sm mt-8" onClick={() => store.act((gg) => A.launchCampaign(gg, k, k === 'global' ? 'global' : region), { sound: 'cash' })}>Launch · {money(c.cost)}</button>
            </div>
          );
        })}
      </div>
      {active.length > 0 && (
        <Card title="Running campaigns" icon={<Star className="ico" />} className="mt-16">
          {active.map((c) => (
            <div key={c.id} className="row between small campaign-row">
              <span><b>{c.type === 'global' ? 'Global brand campaign' : `${A.CAMPAIGNS[c.type as Exclude<CampaignType, 'route'>]?.name ?? 'Campaign'} · ${REGION_BY_ID[c.target]?.name ?? c.target}`}</b></span>
              <span className="muted">+{Math.round(c.boost * 100)}% demand · until {formatDate(c.endDay)}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
