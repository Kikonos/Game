// Rotations round (v0.16.4): plays a saved game on for N days with the simple policy of scripts/invariants.ts (decisions
// answered by default, at most three open offers accepted a step unless --nosign) and logs every crew ticket bought,
// classified against the deployments' tours (scripts/ticketlog.ts). Usage:
//   npx tsx scripts/rotations.ts <save.json> [days] [--nosign] [--inv] [--out=<report.md>] [--json=<rows.json>]
// Prints the classification report, coverage counters (legs flown, cancelled, uncovered, red crew alarms) and the
// invariants summary with --inv.

import { readFileSync, writeFileSync } from 'node:fs';
import { DAY, fmtDateTime } from '../src/engine/core/time';
import type { GameState } from '../src/engine/core/types';
import { createTicketLog } from './ticketlog';

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const flag = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
  const { deserialize } = await import('../src/engine/save');
  const { advanceTo } = await import('../src/engine/sim');
  const { acceptOffer, feasibilityAll } = await import('../src/engine/contracts');
  const { resolveDecision } = await import('../src/engine/ops');
  const { createChecker } = await import('./invariants');
  if (!args[0]) {
    console.log('usage: rotations.ts <save.json> [days] [--nosign] [--inv] [--out=report.md] [--json=rows.json]');
    return;
  }
  const g: GameState = deserialize(readFileSync(args[0], 'utf8'));
  const days = Number(args[1] ?? 60);
  const sign = !process.argv.includes('--nosign');
  const inv = process.argv.includes('--inv') ? createChecker() : null;
  const log = createTicketLog(g.now);
  const start = { legs: g.stats.legs, cancelled: g.stats.cancelled, uncovered: g.stats.uncovered ?? 0, red: g.stats.crewRed ?? 0, amber: g.stats.crewAmber ?? 0, msgs: g.messages.length, cash: g.company.cash, sub: g.stats.subchartered ?? 0 };
  const end = g.now + days * DAY;
  const step = 60;
  let nextPlay = g.now;
  const wall = performance.now();
  inv?.observe(g);
  log.observe(g);
  while (g.now < end && !g.gameOver) {
    if (g.now >= nextPlay) {
      nextPlay = g.now + 6 * 60;
      for (const d of [...g.decisions]) resolveDecision(g, d.id, d.defaultOption);
      if (sign) {
        const open = Object.values(g.offers).filter((o) => o.status === 'open' && o.start >= g.now && g.now < o.expires).sort((a, b) => b.estValue - a.estValue || (a.id < b.id ? -1 : 1));
        for (const o of open.slice(0, 3)) {
          const r = feasibilityAll(g, o.id).find((x) => (x.level === 'ok' || x.level === 'warn') && x.estMargin > 0);
          if (r && acceptOffer(g, o.id, [r.aircraftId]).ok) break;
        }
      }
    }
    try {
      advanceTo(g, Math.min(end, g.now + step));
    } catch (e) {
      console.log(`EXCEPTION at ${fmtDateTime(g.now)}: ${(e as Error).stack}`);
      break;
    }
    inv?.observe(g);
    log.observe(g);
  }
  inv?.finish(g);
  const reds = g.messages.slice(start.msgs).filter((m) => m.topic === 'crewRed' || m.topic === 'crewHours').length;
  const title = `${args[0].split('/').pop()} played ${days} days (${fmtDateTime(g.now - days * DAY)} → ${fmtDateTime(g.now)}${sign ? '' : ', no new contracts'})`;
  const cov = `Coverage: legs flown +${g.stats.legs - start.legs}, cancelled +${g.stats.cancelled - start.cancelled}, uncovered at departure +${(g.stats.uncovered ?? 0) - start.uncovered}, sub-chartered +${(g.stats.subchartered ?? 0) - start.sub}, red crew alarms +${(g.stats.crewRed ?? 0) - start.red} (messages ${reds}), amber +${(g.stats.crewAmber ?? 0) - start.amber}, cash ${Math.round(start.cash / 1000)}K → ${Math.round(g.company.cash / 1000)}K${g.gameOver ? ` GAME OVER ${g.gameOver.reason}` : ''}.`;
  // The P&L of the months played (closed statements and the open one), by line, to read a cash difference.
  const pl = [...g.finance.history, g.finance.current]
    .slice(-Math.ceil(days / 30) - 1)
    .map((st) => `- ${st.month}: ${Object.entries(st.lines).filter(([, v]) => Math.abs(v ?? 0) >= 1000).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([k, v]) => `${k} ${Math.round((v ?? 0) / 1000)}K`).join(', ')}`)
    .join('\n');
  const rep = `${log.report(g, title)}\n\n${cov}\n\nP&L by month (the last ${Math.ceil(days / 30) + 1}):\n${pl}\n\n${((performance.now() - wall) / 1000).toFixed(1)} s.\n`;
  console.log(rep);
  if (inv) inv.print(`save ${args[0]}`);
  const out = flag('out');
  if (out) writeFileSync(out, rep);
  const js = flag('json');
  if (js) log.save(js);
}

void main();
