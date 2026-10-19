// Screenshots of the aircraft art gallery (dev only).
// usage: node scripts/art-shots.cjs <baseUrl> <outDir> [types] [livery]
//   e.g. node scripts/art-shots.cjs http://localhost:5101 /tmp/shots a320neo,b738 redsplit
// Writes <outDir>/gallery-<size>-<bg>.png, compare-<bg>.png and <typeId>-hero.png (dark bg) at 2x.
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');

const [base, outDir, types = '', livery = 'contrail'] = process.argv.slice(2);
if (!base || !outDir) {
  console.error('usage: node scripts/art-shots.cjs <baseUrl> <outDir> [types] [livery]');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const url = (params) => {
  const q = new URLSearchParams({ livery, ...params });
  if (types) q.set('types', types);
  return `${base.replace(/\/$/, '')}/gallery.html?${q}`;
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  const load = async (u) => {
    await page.goto(u, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
  };
  for (const size of ['hero', 'card', 'mini']) {
    for (const bg of ['dark', 'blue']) {
      await load(url({ size, bg }));
      const file = path.join(outDir, `gallery-${size}-${bg}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(file);
      if (size === 'hero' && bg === 'dark') {
        for (const el of await page.$$('figure[data-size="hero"]')) {
          const id = await el.getAttribute('data-type');
          const f = path.join(outDir, `${id}-hero.png`);
          await el.screenshot({ path: f });
          console.log(f);
        }
      }
    }
  }
  for (const bg of ['dark', 'blue']) {
    await load(url({ compare: '1', bg }));
    const file = path.join(outDir, `compare-${bg}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(file);
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
