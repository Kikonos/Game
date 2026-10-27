// Peak-staffing heads-up screenshots (iPad home-screen size 1180×820 at DPR 2), light and dark.
// usage: node staffing-shots.cjs <url> <outdir> [theme...]
const L = require('../shots-visualB/lib.cjs');
const fs = require('fs');
const url = process.argv[2] || 'http://localhost:5481/';
const out = process.argv[3] || __dirname;
const themes = process.argv.slice(4).length ? process.argv.slice(4) : ['dark', 'light'];
fs.mkdirSync(out, { recursive: true });
const errors = [];
const { sleep } = L;

async function run(T) {
  const { browser, page } = await L.open(url, T, errors);
  const shot = (name, clip) => L.shot(page, out, `${T}-${name}`, clip);

  // A serious gap: next month a captain and more than a set of cabin crew short (the four-line card).
  await L.start(page, url, T, { days: 20 });
  const gaps = await page.evaluate(() => window.__contrail.dev.peak({ CPT: 1, CC: 4 }));
  console.log(T, 'serious', JSON.stringify(gaps));
  await page.evaluate(() => window.__contrail.navigate('crew', { view: 'people' }));
  await sleep(600);
  await shot('01-crew-people-card');
  await page.evaluate(() => window.__contrail.navigate('crew', { view: 'plan' }));
  await sleep(600);
  await shot('02-crew-planning-card');
  // WHAT YOU CAN DO → Hire, prefilled.
  await page.locator('.cp-peak .pc button', { hasText: 'Hire' }).first().click();
  await sleep(500);
  await shot('03-hire-prefilled');
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => { const s = window.__contrail; s.modal = null; s.emit(); });
  // The next day's Inbox note (once per month and gap).
  await page.evaluate(() => window.__contrail.dev.advance(1440));
  await L.calm(page);
  await page.evaluate(() => window.__contrail.navigate('inbox'));
  await sleep(600);
  await shot('04a-inbox-note');
  // Tapping the note opens Crew › Planning.
  await page.locator('.sc-msg', { hasText: 'needs' }).first().click().catch(() => {});
  await sleep(600);
  await shot('04b-inbox-note-tapped');

  // A small gap: one cabin crew short (a quiet line with a prefilled Hire).
  await L.start(page, url, T, { days: 20 });
  const small = await page.evaluate(() => window.__contrail.dev.peak({ CC: 1 }));
  console.log(T, 'small', JSON.stringify(small));
  await page.evaluate(() => window.__contrail.navigate('crew', { view: 'people' }));
  await sleep(600);
  await shot('05-crew-people-quiet-line');
  await browser.close();
}

(async () => {
  for (const T of themes) await run(T);
  console.log('ERRORS:', errors.join('\n'));
})();
