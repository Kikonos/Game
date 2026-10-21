// v0.7 the Ladder on the Company screen (UPDATE-0.7.md §F8.5): five rungs left to right, each with its approval
// nodes (status chip, first unmet requirement, cost and time, unlocked types). Static SVG connectors join each
// node to its prerequisites (held paths green); they are measured once per layout change, nothing animates.

import { Award, BadgeCheck, Lock, TrendingUp } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { typeOf } from '../../engine/core/perf';
import { fmtDate, fmtDay } from '../../engine/core/time';
import type { GameState } from '../../engine/core/types';
import { ladder, RUNG0_TYPES, type LadderNode } from '../../engine/ops';
import { Bar, Card } from '../components/ui';
import { money } from '../format';
import { store } from '../store';

const shortOf = (ids: string[]) => ids.map((id) => typeOf(id)?.short ?? id);

/** The status chip of a node. */
export function nodeStatus(n: LadderNode): { label: string; tone: string } {
  if (n.state === 'held') return { label: `Held since ${fmtDay(n.heldSince ?? 0)}`, tone: 'good' };
  if (n.state === 'pending') return { label: n.pending?.waiting ? 'Waiting for crew' : `In progress · due ${fmtDay(n.pending?.done ?? 0)}`, tone: n.pending?.waiting ? 'warn' : 'info' };
  if (n.state === 'ready') return { label: 'Ready to apply', tone: 'accent' };
  return { label: 'Locked', tone: '' };
}

/** First unmet requirement in one line ('4 CPT + 4 FO rated on B767 · 0 + 0 now'). */
export function firstUnmet(n: LadderNode): string | null {
  if (n.state === 'held') return null;
  if (n.pending?.waiting) return n.pending.waiting;
  const r = n.reqs.find((x) => !x.ok);
  if (!r) return n.state === 'pending' ? null : 'Every requirement met';
  return r.have ? `${r.label} · ${/^[\d$]/.test(r.have) ? `${r.have} now` : r.have}` : r.label;
}

function NodeCard({ n }: { n: LadderNode }) {
  const st = nodeStatus(n);
  const unmet = firstUnmet(n);
  const types = shortOf(n.unlocksTypes);
  return (
    <button className={`ld-node s-${n.state}`} data-node={n.id} onClick={() => store.openModal({ kind: 'approval', id: n.id })}>
      <b className="ld-name">{n.name}</b>
      <span className={`badge ${st.tone}`}>{n.state === 'held' ? <BadgeCheck /> : n.state === 'locked' ? <Lock /> : null}{st.label}</span>
      {n.state === 'pending' && n.pending && <Bar value={n.pending.progress} size="thin" />}
      {unmet && <span className={`tiny ld-req ${n.state === 'locked' ? 'muted' : ''}`}>{unmet}</span>}
      {n.state !== 'held' && <span className="tiny dim">{money(n.cost)} · {n.days} days</span>}
      {types.length > 0 && <span className="ld-types">{types.slice(0, 4).map((t) => <span key={t} className="ld-type">{t}</span>)}</span>}
    </button>
  );
}

interface Edge { d: string; held: boolean }

export function LadderCard({ g }: { g: GameState }) {
  const rungs = ladder(g);
  const box = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<Edge[]>([]);
  const nodes = rungs.flatMap((r) => r.nodes);
  const sig = nodes.map((n) => `${n.id}:${n.state}:${firstUnmet(n)}`).join();
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const o = el.getBoundingClientRect();
      const at = (id: string) => el.querySelector<HTMLElement>(`[data-node="${id}"]`)?.getBoundingClientRect();
      const out: Edge[] = [];
      const join = (a: DOMRect | undefined, b: DOMRect | undefined, held: boolean) => {
        if (!a || !b) return;
        const x1 = a.right - o.left;
        const y1 = a.top + a.height / 2 - o.top;
        const x2 = b.left - o.left;
        const y2 = b.top + b.height / 2 - o.top;
        const mx = (x1 + x2) / 2;
        out.push({ d: `M${x1.toFixed(1)},${y1.toFixed(1)} C${mx.toFixed(1)},${y1.toFixed(1)} ${mx.toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`, held });
      };
      for (const n of nodes) {
        const to = at(n.id);
        if (!n.requires.length) join(at('rung0'), to, n.state === 'held');
        for (const r of n.requires) join(at(r), to, n.state === 'held' && nodes.find((x) => x.id === r)?.state === 'held');
      }
      setEdges((p) => (p.length === out.length && p.every((e, i) => e.d === out[i].d && e.held === out[i].held) ? p : out));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  const held = nodes.filter((n) => n.state === 'held').length;
  return (
    <Card className="ld-card" title="The Ladder" icon={<TrendingUp className="ico" />} sub={`${held} of ${nodes.length} approvals held · each opens bigger aircraft and work`}>
      <div className="ld-grid" ref={box}>
        <svg className="ld-lines" aria-hidden>
          {edges.map((e, i) => <path key={i} d={e.d} className={e.held ? 'held' : ''} />)}
        </svg>
        {rungs.map((r) => {
          const [k, ...rest] = r.title.split(' · ');
          return (
            <div key={r.index} className="ld-rung">
              <div className="ld-head"><span className="upper dim">{k}</span><b className="small">{rest.join(' · ')}</b></div>
              {r.index === 0 ? (
                <div className="ld-node s-held ld-start" data-node="rung0">
                  <b className="ld-name">Narrowbody charter & ACMI</b>
                  <span className="badge good"><Award /> Since {fmtDate(g.started)}</span>
                  <span className="tiny dim">Our AOC as it started</span>
                  <span className="ld-types">{shortOf(RUNG0_TYPES).slice(0, 5).map((t) => <span key={t} className="ld-type">{t}</span>)}</span>
                </div>
              ) : r.nodes.map((n) => <NodeCard key={n.id} n={n} />)}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
