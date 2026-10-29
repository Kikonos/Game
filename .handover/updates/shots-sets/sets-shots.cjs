// Crew sets review screenshots (iPad home-screen size 1180×820 at DPR 2): the mixed dual-rated case.
// An A320 family (2 × A320) and an A330-200; 4 cabin crew hired for the A320 who also hold the A330; 3 A330 cabin crew
// who also hold the A320; 2 A320 cabin crew made pursers (12 pursers for 10 sets: two fly cabin crew seats).
// usage: node sets-shots.cjs <url> <outdir> <prefix> [theme...]
const L = require('../shots-visualB/lib.cjs');
const fs = require('fs');
const url = process.argv[2] || 'http://localhost:5491/';
const out = process.argv[3] || __dirname;
const prefix = process.argv[4] || 'after';
const themes = process.argv.slice(5).length ? process.argv.slice(5) : ['dark'];
fs.mkdirSync(out, { recursive: true });
const errors = [];
const { sleep } = L;

async function run(T) {
  const { browser, page } = await L.open(url, T, errors);
  const shot = (name, clip) => L.shot(page, out, `${prefix}-${T}-${name}`, clip);
  await L.start(page, url, T, { days: 0 });
  await page.evaluate(() => {
    const s = window.__contrail;
    s.dev.addType('a332');
    const g = s.game;
    const ids = (fam, role) => Object.values(g.crew).filter((c) => c.ratings[0] === fam && c.role === role && c.ratings.length === 1).map((c) => c.id).sort();
    for (const id of ids('A330/340', 'CC').slice(0, 4)) g.crew[id].ratings = ['A320', 'A330/340'];
    for (const id of ids('A320', 'CC').slice(0, 2)) g.crew[id].role = 'PUR';
    for (const id of ids('A330/340', 'CC').slice(0, 3)) g.crew[id].ratings = ['A330/340', 'A320'];
    s.emit();
  });
  await L.calm(page);
  await page.evaluate(() => window.__contrail.navigate('crew', { view: 'people' }));
  await sleep(600);
  await shot('01-sets-strip', { x: 0, y: 0, width: 1180, height: 420 });
  await page.evaluate(() => window.__contrail.navigate('crew', { view: 'plan' }));
  await sleep(600);
  await shot('02-planning');
  await page.evaluate(() => window.scrollBy(0, 400));
  await page.locator('.cp-grid').evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
  await sleep(300);
  await shot('03-planning-cards');
  // Hire: cabin crew on the A320 and the A330.
  await page.evaluate(() => window.__contrail.openModal({ kind: 'hire', role: 'CC', family: 'A320' }));
  await sleep(500);
  await page.locator('.hm-tick', { hasText: 'A330/A340' }).first().click().catch(() => {});
  await sleep(400);
  await shot('04-hire-cc-two-types');
  await page.evaluate(() => { const s = window.__contrail; s.modal = null; s.emit(); });
  // The A320 card's primary button (round up / complete).
  const btn = await page.locator('.cp-card').first().locator('.cp-actions .btn').first().textContent().catch(() => '');
  console.log(T, 'A320 button:', btn);
  if (/Round up|Hire to complete/.test(btn || '')) {
    await page.locator('.cp-card').first().locator('.cp-actions .btn').first().click();
    await sleep(500);
    await shot('05-a320-round-up');
  }
  await browser.close();
}

(async () => {
  for (const T of themes) await run(T);
  console.log('ERRORS:', errors.join('\n'));
})();
