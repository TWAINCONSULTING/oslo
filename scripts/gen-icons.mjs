/**
 * Generates PWA icons (PNG) from an inline SVG using headless Chromium.
 * Run once: `npm run icons`. Outputs to public/icons/.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const svg = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6ea7dd"/>
      <stop offset="1" stop-color="#f2e2c4"/>
    </linearGradient>
    <radialGradient id="coin" cx="0.35" cy="0.3" r="0.9">
      <stop offset="0" stop-color="#ffd75e"/>
      <stop offset="0.6" stop-color="#ffb703"/>
      <stop offset="1" stop-color="#e08e00"/>
    </radialGradient>
  </defs>
  <rect width="128" height="128" rx="${pad ? 0 : 28}" fill="url(#sky)"/>
  <path d="M0 96 L26 74 L44 88 L70 62 L96 84 L128 60 L128 128 L0 128 Z" fill="#456d80" opacity="0.85"/>
  <rect x="14" y="86" width="100" height="42" fill="#3e4750"/>
  <rect x="24" y="104" width="80" height="3" rx="1.5" fill="#88929c"/>
  <rect x="24" y="114" width="80" height="3" rx="1.5" fill="#88929c"/>
  <circle cx="64" cy="52" r="34" fill="url(#coin)" stroke="#b26f00" stroke-width="4"/>
  <path d="M48 66 L64 34 L80 66" fill="none" stroke="#0e2a47" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const executablePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();

async function render(size, padded, name) {
  await page.setViewportSize({ width: size, height: size });
  const scale = padded ? 0.72 : 1;
  const off = ((1 - scale) / 2) * 100;
  await page.setContent(`
    <style>html,body{margin:0;background:${padded ? '#6ea7dd' : 'transparent'}}</style>
    <div style="position:fixed;left:${off}%;top:${off}%;width:${scale * 100}%;height:${scale * 100}%">
      ${svg(padded)}
    </div>`);
  const buf = await page.screenshot({ omitBackground: !padded });
  writeFileSync(join(outDir, name), buf);
  console.log('wrote', name);
}

await render(512, false, 'icon-512.png');
await render(192, false, 'icon-192.png');
await render(180, true, 'icon-180.png');
await render(512, true, 'icon-maskable-512.png');
await browser.close();
