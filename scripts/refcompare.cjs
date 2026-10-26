// Side-by-side checks against reference side-view livery art (dev only; the references are not in the repo).
// usage: node scripts/refcompare.cjs <baseUrl> <refDir> <outDir>
// Each run renders one of our types in a livery with the reference's STRUCTURE (neutral colours, our own logo and
// titles) at the reference's scale, and stacks it under the mirrored reference (nose right, like ours).
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');

const [base, refDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const TEAL = '#1f6f6b', RED = '#d23b2a', BLUE = '#2a9fd6', NAVY = '#0b2a5b';
const classic = { primary: TEAL, secondary: RED, tail: 'solid', logo: { id: 'kite', color: '#ffffff', color2: TEAL },
  body: { belly: { color: '#c6cdd4', split: 0.62, tilt: 0, windows: true }, noseBand: { color: TEAL, accent: RED }, finRoot: RED, noseLogo: true },
  titles: { color: TEAL } };
const twoTone = { primary: '#ffffff', secondary: BLUE, tail: 'solid', code: { color: BLUE }, logo: { id: 'globe', color: BLUE, color2: '#ffffff' },
  stickers: [{ id: 'code', kind: 'code', side: 'fin', scale: 1.15 }, { id: 'titles', kind: 'titles', side: 'fuselage', scale: 1 }],
  body: { color: BLUE, belly: { color: '#ffffff', split: 0.62, tilt: 0, windows: true, line: { color: NAVY, h: 0.018 } }, engines: '#ffffff', engineLogo: true },
  titles: { color: '#ffffff' } };
const wrap = { primary: NAVY, secondary: '#7fb3e6', tail: 'solid', code: { color: '#ffffff' }, reg: { fleet: true },
  body: { tailWrap: NAVY, engines: NAVY, stripes: [{ color: '#d23b2a', y: 0.56, h: 0.02 }] }, titles: { color: NAVY } };
const RUNS = [
  { ref: 'ref-b744.jpg', type: 'b744', lv: classic, reg: 'CS-TBL' },
  { ref: 'ref-b772.jpg', type: 'b772', lv: classic, reg: 'CS-TBM' },
  { ref: 'ref-b77w.jpg', type: 'b77w', lv: classic, reg: 'CS-TBN' },
  { ref: 'ref-b772-klm.jpg', type: 'b772', lv: twoTone, reg: 'PH-BHA', out: 'b772-twotone' },
  { ref: 'ref-b737-reg.jpg', type: 'b738', lv: wrap, reg: 'CS-TBP' },
  { ref: 'ref-b788-reg.jpg', type: 'b788', lv: wrap, reg: 'CS-TBQ' },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 }, deviceScaleFactor: 2 });
  for (const r of RUNS) {
    const q = new URLSearchParams({ types: r.type, size: 'hero', bg: 'light', lv: JSON.stringify(r.lv), reg: r.reg, w: '1000', code: 'BH', name: 'Block Hours' });
    await page.goto(`${base.replace(/\/$/, '')}/gallery.html?${q}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.querySelectorAll('figure image')].every((i) => (i.getAttribute('href') || '').startsWith('blob:')), null, { timeout: 60000 }).catch(() => console.warn('not painted'));
    await page.waitForTimeout(300);
    const f = path.join(outDir, `ours-${r.out ?? r.type}.png`);
    await (await page.$('figure[data-size="hero"] .g-box')).screenshot({ path: f });
    console.log(f, r.ref);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
