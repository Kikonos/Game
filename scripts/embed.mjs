// Turns dist-embed/index.html into a body fragment (page.html) for hosts that
// supply their own <html>/<head> wrapper, keeping references to the built assets.
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist-embed/index.html', 'utf8');
const pick = (re) => [...html.matchAll(re)].map((m) => m[0].replace(/\s+crossorigin/g, ''));
const title = html.match(/<title>.*?<\/title>/)[0];
const metas = pick(/<meta name="(theme-color|description)"[^>]*>/g);
const icon = pick(/<link rel="icon"[^>]*>/g);
const styles = pick(/<link rel="stylesheet"[^>]*>/g);
const scripts = pick(/<script type="module"[^>]*><\/script>/g);
const page = [title, ...metas, ...icon, ...styles, '<div id="root"></div>', ...scripts].join('\n') + '\n';
writeFileSync('dist-embed/page.html', page);
console.log(page);
