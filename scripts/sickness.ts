// v0.17.2 sick calls measured (the player: "a lot of sick calls; a bit unrealistic"). Plays a save on (decisions by
// default, no new contracts) and counts every new sick block: episodes per crew member per year, sick days as a share
// of the crew's days, sick calls per day across the airline, and how many came the evening before (home) or at an
// outstation hotel before report (the ops disruption). Usage: npx tsx scripts/sickness.ts <save.json> [days]

import { readFileSync } from 'node:fs';
import { DAY } from '../src/engine/core/time';
import type { GameState } from '../src/engine/core/types';

async function main() {
  const [file, d0] = process.argv.slice(2);
  const { deserialize } = await import('../src/engine/save');
  const { advanceTo } = await import('../src/engine/sim');
  const { resolveDecision } = await import('../src/engine/ops');
  const g: GameState = deserialize(readFileSync(file, 'utf8'));
  const days = Number(d0 ?? 60);
  const end = g.now + days * DAY;
  const seen = new Set<string>();
  for (const c of Object.values(g.crew)) for (const b of c.blocks ?? []) if (b.why === 'sick') seen.add(`${c.id}:${b.from}`);
  let n = 0;
  let away = 0;
  let sickDays = 0;
  let crewDays = 0;
  const lens: number[] = [];
  const mSeen = new WeakSet<object>(g.messages);
  let msgs = 0;
  const decSeen = new Set<string>();
  let sickDecisions = 0;
  while (g.now < end && !g.gameOver) {
    for (const d of [...g.decisions]) {
      if (!decSeen.has(d.id) && /sick/i.test(`${d.kind} ${d.title}`)) sickDecisions++;
      decSeen.add(d.id);
      resolveDecision(g, d.id, d.defaultOption);
    }
    advanceTo(g, Math.min(end, g.now + 60));
    for (const m of g.messages) {
      if (mSeen.has(m)) break;
      mSeen.add(m);
      if (/sick/i.test(m.title)) msgs++;
    }
    if (g.now % DAY === 0) crewDays += Object.values(g.crew).filter((c) => c.status !== 'joining').length;
    for (const c of Object.values(g.crew)) {
      for (const b of c.blocks ?? []) {
        if (b.why !== 'sick') continue;
        const k = `${c.id}:${b.from}`;
        if (seen.has(k)) continue;
        seen.add(k);
        n++;
        if (c.loc !== c.base) away++;
        const len = Math.round((b.to - b.from) / DAY);
        lens.push(len);
        sickDays += len;
      }
    }
  }
  const crew = Object.values(g.crew).length;
  const years = crewDays / 365;
  lens.sort((a, b) => a - b);
  console.log(`${file.split('/').pop()} ${days} d · ${crew} crew · ${n} sick episodes (${away} away from base) · ${(n / Math.max(1, years)).toFixed(2)} per crew member per year · ${(n / days).toFixed(2)} sick calls a day across the airline · sick days ${((100 * sickDays) / Math.max(1, crewDays)).toFixed(2)} % of crew days · length median ${lens[Math.floor(lens.length / 2)] ?? 0} d (min ${lens[0] ?? 0}, max ${lens[lens.length - 1] ?? 0}) · inbox lines about sickness ${msgs} (${(msgs / days).toFixed(2)} a day) · sick-call decisions ${sickDecisions}`);
}

void main();
