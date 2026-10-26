// Livery paint check pictures (dev only): every listed type in each body preset and a dark full-colour custom,
// rendered by the real compose.ts in Chromium (hero size, 2x), plus a contact sheet per preset.
// usage: node scripts/paint-shots.cjs <baseUrl> <outDir> [types]
//   e.g. npx vite --port 5101 & node scripts/paint-shots.cjs http://localhost:5101 /tmp/paint
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');

const TYPES = 'a320ceo,a321neo,b738,b752,b763,a332,a332-alt-engines,a346,b772,b77w,b789,a359,b744,b744-alt-engines,b748,a388';
const [base, outDir, types = TYPES] = process.argv.slice(2);
if (!base || !outDir) {
  console.error('usage: node scripts/paint-shots.cjs <baseUrl> <outDir> [types]');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
// the livery's own colours (red tail, navy accents) for the presets; a dark navy full colour with a gold line
const RUNS = [
  { id: 'eurowhite', q: { livery: 'redsplit', secondary: '#0b1f4d', tail: 'split', preset: 'eurowhite' } },
  { id: 'cheatline', q: { livery: 'redsplit', secondary: '#0b1f4d', tail: 'stripe', preset: 'cheatline' } },
  { id: 'fullColour', q: { livery: 'redsplit', secondary: '#ffffff', tail: 'solid', preset: 'fullColour' } },
  { id: 'bellyBand', q: { livery: 'navysolid', secondary: '#d6283c', tail: 'solid', preset: 'bellyBand' } },
  { id: 'classicBelly', q: { livery: 'logo', primary: '#1f6f6b', secondary: '#d23b2a', tail: 'solid', preset: 'classicBelly' } },
  { id: 'twoTone', q: { livery: 'logo', primary: '#2a9fd6', secondary: '#ffffff', tail: 'solid', preset: 'twoTone' } },
  {
    id: 'darkCustom',
    q: {
      livery: 'logo', primary: '#13294b', secondary: '#c8a24a', tail: 'solid',
      body: JSON.stringify({ color: '#13294b', engines: '#13294b', lip: '#c3c8d0', stripes: [{ color: '#c8a24a', y: 0.62, h: 0.025 }] }),
    },
  },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1560, height: 900 }, deviceScaleFactor: 2 });
  for (const run of RUNS) {
    const q = new URLSearchParams({ ...run.q, types, size: 'hero', bg: 'light' });
    await page.goto(`${base.replace(/\/$/, '')}/gallery.html?${q}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    // the painted bitmaps are blobs: wait until every hero shows one
    await page.waitForFunction(() => [...document.querySelectorAll('figure[data-size="hero"] image')].every((i) => (i.getAttribute('href') || '').startsWith('blob:')), null, { timeout: 60000 }).catch(() => console.warn('not all painted'));
    await page.waitForTimeout(300);
    const files = [];
    for (const el of await page.$$('figure[data-size="hero"]')) {
      const id = await el.getAttribute('data-type');
      const f = path.join(outDir, `${run.id}-${id}.png`);
      await (await el.$('.g-box')).screenshot({ path: f });
      files.push(f);
    }
    await page.screenshot({ path: path.join(outDir, `sheet-${run.id}.png`), fullPage: true });
    console.log(run.id, files.length);
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
