// v0.7 the Ladder on the Company screen (UPDATE-0.7.md §F8.5): five rungs left to right, each with its approval
// nodes (status chip, first unmet requirement, cost and time, unlocked types). Static SVG connectors join each
// node to its prerequisites (held paths green); they are measured once per layout change, nothing animates.

import { Award, BadgeCheck, Lock, TrendingUp } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { typeOf } from '../../engine/core/perf';
import { fmtDate, fmtDay } from '../../engine/core/time';
import type { ApprovalId, GameState } from '../../engine/core/types';
import { ladder, RUNG0_TYPES, waitingFor, type ApprovalReq, type LadderNode } from '../../engine/ops';
import { Bar, Card } from '../components/ui';
import { money } from '../format';
import { store } from '../store';
import { cssRect } from '../device';

type Box = ReturnType<typeof cssRect>;

const shortOf = (ids: string[]) => ids.map((id) => typeOf(id)?.short ?? id);

/** Whether a node waits on a prerequisite approval not yet held (Locked) rather than on its own requirements (Not ready). */
export const prereqMissing = (n: LadderNode, held: ReadonlySet<ApprovalId>) => n.requires.some((r) => !held.has(r));

/** v0.10.2 the chip's short form of what a filed application waits for. */
const WAIT_SHORT: Record<string, string> = { 'rated pilots': 'crew', 'the ETOPS maintenance programme': 'the programme', 'technical reliability': 'reliability', 'a clean crew record': 'a clean record' };

/** The status chip of a node. `held`: the approvals held (Locked vs Not ready). */
export function nodeStatus(n: LadderNode, held?: ReadonlySet<ApprovalId>): { label: string; tone: string; locked: boolean } {
  if (n.state === 'held') return { label: `Held since ${fmtDay(n.heldSince ?? 0)}`, tone: 'good', locked: false };
  if (n.state === 'pending') return { label: n.pending?.waiting ? `Waiting for ${WAIT_SHORT[waitingFor(n.pending.waiting)] ?? 'a requirement'}` : `In progress · due ${fmtDay(n.pending?.done ?? 0)}`, tone: n.pending?.waiting ? 'warn' : 'info', locked: false };
  if (n.state === 'ready') return { label: 'Ready to apply', tone: 'accent', locked: false };
  if (held && !prereqMissing(n, held)) return { label: 'Not ready', tone: '', locked: false };
  return { label: 'Locked', tone: '', locked: true };
}

/** A requirement's label in player words: 'ETOPS 120 held 120 days' → 'Needs ETOPS 120 for 120 days'. */
export function reqLabel(r: ApprovalReq): string {
  const m = /^(.+) held(?: (\d+) days)?$/.exec(r.label);
  return m ? `Needs ${m[1]}${m[2] ? ` for ${m[2]} days` : ''}` : r.label;
}

/** The filing fee: met once the application is in. */
export const isCashReq = (r: ApprovalReq) => /^Cash /.test(r.label);

/** First unmet requirement in one line ('4 CPT + 4 FO rated on B767 · 0 + 0 now'). A filed node shows only what it waits for. */
export function firstUnmet(n: LadderNode): string | null {
  if (n.state === 'held') return null;
  if (n.state === 'pending') return n.pending?.waiting ?? (n.pending?.findings ? `${n.pending.findings} authority finding${n.pending.findings > 1 ? 's' : ''}: +${n.pending.findings * 30} days` : null);
  const r = n.reqs.find((x) => !x.ok);
  if (!r) return 'Every requirement met';
  const label = reqLabel(r);
  if (!r.have || r.have === 'not held') return label;
  if (/ held \d+ days$/.test(r.label)) return `${label} · ${r.have.replace(/ days$/, '')} so far`;
  return `${label} · ${/^[\d$]/.test(r.have) ? `${r.have} now` : r.have}`;
}

function NodeCard({ n, held }: { n: LadderNode; held: ReadonlySet<ApprovalId> }) {
  const st = nodeStatus(n, held);
  const unmet = firstUnmet(n);
  const types = shortOf(n.unlocksTypes);
  return (
    <button className={`ld-node s-${n.state}`} data-node={n.id} onClick={() => store.openModal({ kind: 'approval', id: n.id })}>
      <b className="ld-name">{n.name}</b>
      <span className={`badge ${st.tone}`}>{n.state === 'held' ? <BadgeCheck /> : st.locked ? <Lock /> : null}{st.label}</span>
      {n.state === 'pending' && n.pending && <Bar value={n.pending.progress} size="thin" />}
      {unmet && <span className={`tiny ld-req ${st.locked ? 'muted' : ''}`}>{unmet}</span>}
      {n.state !== 'held' && <span className="tiny dim">{money(n.cost)}{n.grantCost ? ` + ${money(n.grantCost)}` : ''} · {n.days} days</span>}
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
  const heldIds = new Set<ApprovalId>(g.company.approvals);
  const sig = nodes.map((n) => `${n.id}:${n.state}:${firstUnmet(n)}`).join();
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      // v0.12 in the page's own px (Settings › Size zooms the page; rects are screen px).
      const o = cssRect(el);
      const at = (id: string) => { const n = el.querySelector<HTMLElement>(`[data-node="${id}"]`); return n ? cssRect(n) : undefined; };
      const out: Edge[] = [];
      const cards = Array.from(el.querySelectorAll<HTMLElement>('[data-node]')).map((c) => cssRect(c));
      const f = (v: number) => v.toFixed(1);
      const join = (a: Box | undefined, b: Box | undefined, held: boolean) => {
        if (!a || !b) return;
        const x1 = a.right - o.left;
        const y1 = a.top + a.height / 2 - o.top;
        const x2 = b.left - o.left;
        const y2 = b.top + b.height / 2 - o.top;
        // Skipping a rung: the opaque cards between would hide a straight curve, so it drops through the column gap
        // into the clear lane (above, between or below those cards) nearest the two ends, runs along it and rises again.
        const mid = cards.filter((c) => c.left >= a.right - 1 && c.right <= b.left + 1).map((c) => [c.top - o.top, c.bottom - o.top]);
        if (mid.length) {
          const lanes = [Math.min(...mid.map((m) => m[0])) - 6, ...mid.flatMap((m) => [m[0] - 5, m[1] + 5]), Math.max(...mid.map((m) => m[1])) + 8];
          const want = (y1 + y2) / 2;
          const ch = lanes.filter((y) => mid.every((m) => y < m[0] - 3 || y > m[1] + 3)).sort((p, q) => Math.abs(p - want) - Math.abs(q - want))[0];
          const ga = Math.min(...cards.filter((c) => c.left >= a.right - 1).map((c) => c.left)) - o.left;
          const gb = Math.max(...cards.filter((c) => c.right <= b.left + 1).map((c) => c.right)) - o.left;
          if (ch !== undefined && ga < gb) {
            out.push({ d: `M${f(x1)},${f(y1)} C${f(ga)},${f(y1)} ${f(x1)},${f(ch)} ${f(ga)},${f(ch)} L${f(gb)},${f(ch)} C${f(x2)},${f(ch)} ${f(gb)},${f(y2)} ${f(x2)},${f(y2)}`, held });
            return;
          }
        }
        const mx = (x1 + x2) / 2;
        out.push({ d: `M${f(x1)},${f(y1)} C${f(mx)},${f(y1)} ${f(mx)},${f(y2)} ${f(x2)},${f(y2)}`, held });
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
              ) : r.nodes.map((n) => <NodeCard key={n.id} n={n} held={heldIds} />)}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
