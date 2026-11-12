// v0.23.1 the crew-alarm filing as the game does it, without the browser: plays a save on (no player moves), files every
// crew alarm that reaches the player the way the app does (bugReports.ts addCrewAlarms: one whole game now and then,
// the changes since the record before otherwise), and writes a Bug reports export of them with the sizes. The export
// is what scripts/crewcheck.ts reads.
//
//   npx tsx scripts/alarmfile.ts <save.json> <days> <out.blockhours-bugs.json> [--every=H]
//
// --every=H also files a stand-in record every H game hours (a size test: as many records as the player's 60, spread
// over the months the game is played, whatever the alarms).

import { readFileSync, writeFileSync } from 'node:fs';
import { fmtDateTime } from '../src/engine/core/time';
import { takeCrewAlarmRecords } from '../src/engine/crew/selfCheck';
import { deserialize, serialize } from '../src/engine/save';
import { advanceTo } from '../src/engine/sim';
import { addCrewAlarms, CREW_ALARM_SNAP_CHARS, exportFile, isCrewAlarm, memoryStore, storageBytes, type BugContext, type BugReport } from '../src/ui/bugReports';
import { CURRENT } from '../src/data/whatsNew';
import { crewAlarmEntry } from '../src/ui/selfCheckFiler';

async function main(): Promise<void> {
  const [file, daysArg = '20', out = 'alarms.blockhours-bugs.json'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const every = Number(process.argv.find((a) => a.startsWith('--every='))?.slice(8) ?? 0) * 60;
  let next = every ? 0 : Infinity;
  if (!file) {
    console.log('usage: alarmfile.ts <save.json> <days> <out.blockhours-bugs.json>');
    process.exit(1);
  }
  const g = deserialize(readFileSync(file, 'utf8'));
  const store = memoryStore();
  const end = g.now + Number(daysArg) * 1440;
  let filed = 0;
  let ms = 0;
  const t0 = Date.now();
  while (g.now < end) {
    advanceTo(g, Math.min(end, g.now + 60), new Set());
    if (g.selfCheck?.pending.length) g.selfCheck.pending = [];
    const stand = every && g.now >= next;
    if (stand) next = g.now + every;
    if (!g.selfCheck?.alarms?.length && !stand) continue;
    const recs = takeCrewAlarmRecords(g);
    const batch = recs.map((r) => crewAlarmEntry(g, r));
    if (stand && !batch.length) batch.push({ t: g.now, kind: 'short', flightId: `size-${g.now}`, no: 'SIZE', leg: 'stand-in', title: 'Stand-in record (size test)', evidence: [], verdict: 'confirmed' });
    const ctx: BugContext = { version: CURRENT.version, gameTime: `${fmtDateTime(g.now)} UTC`, gameTimeLocal: '', now: g.now, company: g.company.name, seed: g.seed, screen: { tab: 'map' }, inbox: [], settings: {}, device: { viewport: 'script', dpr: 1, ua: 'alarmfile' } };
    const a = Date.now();
    const text = serialize(g, 'bug');
    const done = await addCrewAlarms(batch, () => ctx, () => text, (t) => fmtDateTime(t), store, Date.now() + filed);
    ms += Date.now() - a;
    filed += done.length;
  }
  const list = await store.list();
  const alarms = list.filter(isCrewAlarm);
  const full = (await Promise.all(alarms.map((r) => store.get(r.id)))) as BugReport[];
  const whole = full.filter((r) => r.size > 0 && !r.snapBase);
  const deltas = full.filter((r) => r.snapBase);
  const none = full.filter((r) => !r.size && !r.snapOf);
  const chars = full.reduce((s, r) => s + r.size, 0);
  const text = exportFile(full, g);
  writeFileSync(out, text);
  const kb = (n: number) => `${Math.round(n / 1024)} KB`;
  console.log(`${Number(daysArg)} days from ${file}: ${filed} crew alarm(s) filed, ${alarms.length} kept (in ${((Date.now() - t0) / 1000).toFixed(0)} s; filing ${ms} ms in all)`);
  console.log(`snapshots: ${whole.length} whole (${kb(whole.reduce((s, r) => s + r.size * 2, 0))}), ${deltas.length} as changes (${kb(deltas.reduce((s, r) => s + r.size * 2, 0))}, median ${kb(2 * (deltas.map((r) => r.size).sort((x, y) => x - y)[Math.floor(deltas.length / 2)] ?? 0))}), ${full.filter((r) => r.snapOf).length} shared, ${none.length} without`);
  console.log(`on the device: ${kb(storageBytes(alarms))} (${chars.toLocaleString('en-US')} of ${CREW_ALARM_SNAP_CHARS.toLocaleString('en-US')} characters); the same as whole games: ${kb(whole.length ? (whole.reduce((s, r) => s + r.size, 0) / whole.length) * 2 * (whole.length + deltas.length) : 0)}`);
  console.log(`export ${out}: ${kb(Buffer.byteLength(text, 'utf8'))}`);
}

void main();
