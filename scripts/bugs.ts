// v0.16.1 reads a "Bug reports › Export all" file (*.blockhours-bugs.json): lists every report with its context and
// writes each snapshot, and the current save, out as plain save files for scripts/invariants.ts and acmi-bot --from.
//
//   npx tsx scripts/bugs.ts <file.blockhours-bugs.json> [outDir] [--all]
//
// v0.17.2 reports already in src/data/fixedReports.ts are marked "(known, fixed in vX)" and their snapshot and screenshot
// are not written unless --all; the ids the export left out (already sent, or fixed in the player's version) are listed.
//
// Writes <outDir>/<n>-<id>.blockhours.json per report, its screenshot beside it as <n>-<id>.jpg (or .webp/.png; v0.17.1)
// and <outDir>/current.blockhours.json (outDir: ./bugs-out). A report made without a game has no snapshot file.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXED_REPORTS } from '../src/data/fixedReports';
import { isCrewAlarm, parseBugsFile, shotExt, snapshotText, snapshotTextFor } from '../src/ui/bugReports';

function main(): void {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const all = process.argv.includes('--all');
  const [file, outDir = 'bugs-out'] = args;
  if (!file) {
    console.log('usage: bugs.ts <file.blockhours-bugs.json> [outDir]');
    process.exit(1);
  }
  const data = parseBugsFile(readFileSync(file, 'utf8'));
  mkdirSync(outDir, { recursive: true });
  console.log(`${data.app} · exported ${data.exportedAt} · ${data.company ?? '(no game)'} · ${data.reports.length} report(s)`);
  if (data.skipped?.length) console.log(`left out of this export: ${data.skipped.map((x) => `${x.id} (${x.status}${FIXED_REPORTS[x.id] ? `, fixed in ${FIXED_REPORTS[x.id].version}` : ''})`).join(', ')}`);
  const alarms = data.reports.filter(isCrewAlarm).length;
  if (alarms) console.log(`${alarms} of them are crew alarms the game filed itself: npx tsx scripts/crewcheck.ts <file> judges each one (RIGHT / WRONG / UNSURE)`);
  const texts = new Map<string, string>();
  data.reports.forEach((r, i) => {
    const c = r.context;
    const stem = `${String(i + 1).padStart(2, '0')}-${r.id}`;
    // v0.22.1 a crew alarm filed by the game: one line, its snapshot written when it carries one (alarms of the same
    // game minute share one).
    if (isCrewAlarm(r) && r.alarm) {
      const a = r.alarm;
      // v0.23.1 a snapshot kept as the changes since the record before is rebuilt into the whole game.
      if (r.snapshot) writeFileSync(join(outDir, `${stem}.blockhours.json`), snapshotTextFor(r, data.reports, texts));
      console.log(`\n[${i + 1}] crew alarm (${a.kind}) · game ${c.gameTime} · ${a.no} ${a.leg} · ${a.title}`);
      if (a.why) console.log(`  why: ${a.why}`);
      if (a.hurt) console.log(`  hurt: ${a.hurt}`);
      if (a.evidence.length) console.log(`  checked: ${a.evidence.join('; ')}`);
      console.log(r.snapshot ? `  snapshot → ${join(outDir, `${stem}.blockhours.json`)}${r.snapBase ? ` (rebuilt from the changes since ${r.snapBase})` : ''}` : r.snapOf ? `  snapshot: shared with ${r.snapOf}` : '  no snapshot kept');
      return;
    }
    const name = `${stem}.blockhours.json`;
    const known = FIXED_REPORTS[r.id];
    const write = !known || all;
    if (r.snapshot && write) writeFileSync(join(outDir, name), snapshotText(r.snapshot));
    const ext = shotExt(r.shot);
    const shotName = ext && write ? `${stem}.${ext}` : null;
    if (shotName && r.shot) writeFileSync(join(outDir, shotName), Buffer.from(r.shot.slice(r.shot.indexOf(',') + 1), 'base64'));
    console.log(`\n[${i + 1}] ${r.title}${known ? ` (known, fixed in ${known.version}: ${known.what})` : ''}`);
    console.log(`  id ${r.id}`);
    console.log(`  written ${new Date(r.createdAt).toISOString()} · game ${c.gameTime} (${c.gameTimeLocal}) · ${c.version}`);
    console.log(`  screen ${c.screen.tab}${c.screen.view ? ` › ${c.screen.view}` : ''}${c.screen.modal ? ` · dialog ${c.screen.modal}` : ''}${c.screen.sel ? ` · selected ${c.screen.sel.kind} ${c.screen.sel.id}` : ''}`);
    if (r.what) console.log(`  what: ${r.what}`);
    if (r.expected) console.log(`  expected: ${r.expected}`);
    if (c.entity) {
      console.log(`  about: ${c.entity.label}`);
      for (const l of c.entity.lines) console.log(`    ${l}`);
    }
    if (c.inbox.length) console.log(`  inbox: ${c.inbox.slice(0, 6).join(' | ')}`);
    console.log(`  device: ${[c.device.kind, c.device.form, c.device.input, c.device.standalone ? 'home-screen app' : '', c.device.viewport, c.device.theme].filter(Boolean).join(' · ')}`);
    if (c.hold) console.log(`  hold: ${JSON.stringify(c.hold)}`);
    console.log(!write ? '  snapshot not written (known; --all writes it)' : r.snapshot ? `  snapshot → ${join(outDir, name)}` : '  no snapshot (no game was running)');
    console.log(shotName ? `  screenshot → ${join(outDir, shotName)}${r.shotSize ? ` (${r.shotSize.w}×${r.shotSize.h})` : ''}` : '  no screenshot');
  });
  if (data.currentSave) {
    writeFileSync(join(outDir, 'current.blockhours.json'), data.currentSave);
    console.log(`\ncurrent save → ${join(outDir, 'current.blockhours.json')}`);
  }
}

main();
