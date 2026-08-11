/**
 * End-to-end browser validation on a mobile viewport (390×844, dpr 2).
 * Serves the production build, drives the game with pointer + keyboard input,
 * and asserts core flows: start, gestures, obstacles, game over, high score,
 * restart, pause/resume. Saves screenshots to scratch/screenshots/.
 *
 * Usage: npm run build && npm run validate
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shotDir = process.env.SHOT_DIR || join(root, 'screenshots');
mkdirSync(shotDir, { recursive: true });

const PORT = 4173;
let failures = 0;
const check = (cond, label) => {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}`);
  }
};

// ---- serve dist -----------------------------------------------------------
// Spawn vite's entry directly (an npx wrapper would survive server.kill()).
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: root,
  stdio: 'pipe',
});
process.on('exit', () => server.kill());
process.on('SIGINT', () => {
  server.kill();
  process.exit(1);
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview server timeout')), 20000);
  server.stdout.on('data', (d) => {
    if (String(d).includes('localhost')) {
      clearTimeout(t);
      resolve();
    }
  });
  server.on('exit', () => reject(new Error('preview exited early')));
});
const BASE = `http://localhost:${PORT}`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

function collectErrors(page, sink) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') sink.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => sink.push(`pageerror: ${err.message}`));
}

async function newMobilePage(url) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  const errors = [];
  collectErrors(page, errors);
  await page.goto(url, { waitUntil: 'load' });
  return { ctx, page, errors };
}

const S = (page) => page.evaluate(() => {
  const s = window.__osloRush;
  return {
    phase: s.phase,
    paused: s.paused,
    lane: s.lane,
    y: s.y,
    sliding: s.sliding,
    score: s.score,
    distance: s.distance,
    speed: s.speed,
    obstacleIds: s.obstacleIds,
  };
});

async function swipe(page, dx, dy) {
  const cx = 195;
  const cy = 500;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 5 });
  await page.mouse.up();
}

// ===========================================================================
console.log('\n— Session 1: menu, gestures, obstacle variety (debug, seeded) —');
{
  const { ctx, page, errors } = await newMobilePage(`${BASE}/?debug=1&seed=7`);
  await page.waitForFunction(() => !!window.__osloRush);
  await page.waitForTimeout(900); // splash fade + menu settle
  check((await S(page)).phase === 'menu', 'boots into menu');
  check(await page.locator('.screen.show .tap-cta').isVisible(), 'start CTA visible');
  check(await page.locator('#debug').isVisible(), 'debug panel present with ?debug=1');
  await page.screenshot({ path: join(shotDir, '1-menu.png') });

  await page.mouse.click(195, 420);
  await page.waitForTimeout(400);
  check((await S(page)).phase === 'running', 'tap starts the run');
  await page.evaluate(() => window.__osloRush.setInvincible(true));

  // Gesture/keyboard checks wait on game state (headless rendering can run at
  // a few fps, so fixed sleeps would race the next frame).
  const reach = async (fn, label) => {
    const ok = await page
      .waitForFunction(fn, { timeout: 2500 })
      .then(() => true)
      .catch(() => false);
    check(ok, label);
  };

  // Touch-style gestures (pointer events). The run always starts in lane 1.
  await swipe(page, -90, 0);
  await reach(() => window.__osloRush.lane === 0, 'swipe left changes lane (1→0)');
  await swipe(page, 90, 0);
  await reach(() => window.__osloRush.lane === 1, 'swipe right changes lane back');
  await swipe(page, 0, -90);
  await reach(() => window.__osloRush.y > 0.15, 'swipe up jumps');
  await page.waitForTimeout(900);
  await swipe(page, 0, 90);
  await reach(() => window.__osloRush.sliding, 'swipe down slides');
  await page.waitForTimeout(900);

  // Keyboard controls.
  await page.keyboard.press('ArrowLeft');
  await reach(() => window.__osloRush.lane === 0, 'ArrowLeft changes lane');
  await page.keyboard.press('KeyD');
  await reach(() => window.__osloRush.lane === 1, 'KeyD changes lane back');
  await page.keyboard.press('Space');
  await reach(() => window.__osloRush.y > 0.15, 'Space jumps');
  await page.waitForTimeout(900);
  await page.keyboard.press('ArrowDown');
  await reach(() => window.__osloRush.sliding, 'ArrowDown slides');

  // Obstacle variety via forced spawns.
  for (const id of ['tram', 'scooter', 'barrier', 'overhead', 'cones', 'boxes', 'bikerack']) {
    await page.evaluate((i) => window.__osloRush.forceSpawn(i), id);
  }
  await page.waitForTimeout(300);
  const ids = (await S(page)).obstacleIds;
  for (const id of ['tram', 'scooter', 'barrier', 'overhead']) {
    check(ids.includes(id), `obstacle type present: ${id}`);
  }

  // Let it run to build up speed & scenery, then screenshot gameplay.
  // (Headless software rendering can be slow — wait on distance, not time.)
  await page.waitForFunction(() => window.__osloRush.distance > 100, { timeout: 40000 });
  const mid = await S(page);
  check(mid.phase === 'running' && mid.distance > 100, `still running at ${mid.distance | 0}m (invincible)`);
  check(mid.speed > 8, `speed increased to ${mid.speed.toFixed(1)} m/s`);
  await page.screenshot({ path: join(shotDir, '2-gameplay.png') });

  // Landscape + back (resize robustness).
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  check((await S(page)).phase === 'running', 'survives orientation change');

  check(errors.length === 0, `no console errors (${errors.length})`);
  if (errors.length) console.error(errors.slice(0, 8).join('\n'));
  await ctx.close();
}

// ===========================================================================
console.log('\n— Session 2: game over, high score, restart, pause —');
{
  const { ctx, page, errors } = await newMobilePage(`${BASE}/?seed=11`);
  await page.waitForFunction(() => !!window.__osloRush);
  await page.waitForTimeout(600);
  await page.mouse.click(195, 420);
  await page.waitForTimeout(300);
  check((await S(page)).phase === 'running', 'run started');

  // Hint should appear for a first-time player.
  const hintShown = await page
    .waitForFunction(() => document.querySelector('.hud-hint')?.classList.contains('show'), { timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  check(hintShown, 'control hint appears early');

  // No input → the intro overhead bar guarantees a collision.
  await page.waitForFunction(() => window.__osloRush.phase === 'gameover', { timeout: 40000 });
  console.log('  ✓ collision ends the run (no-input crash)');
  await page.waitForTimeout(500);
  check(await page.locator('.go-retry').isVisible(), 'game-over screen with retry button');
  const goScore = parseInt(await page.locator('.go-score').textContent(), 10);
  check(goScore > 0, `final score shown (${goScore})`);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('oslorush.v1') || '{}'));
  check(stored.high === goScore, `high score persisted (${stored.high})`);
  await page.screenshot({ path: join(shotDir, '3-gameover.png') });

  // Restart — must be immediate and clean.
  await page.locator('.go-retry').click();
  await page.waitForTimeout(400);
  const re = await S(page);
  check(re.phase === 'running', 'retry restarts instantly');
  check(re.distance < 20, `distance reset (${re.distance.toFixed(1)}m)`);
  check(re.score < 20, 'score reset');

  // Second restart via game-over tap (repeated restarts).
  await page.waitForFunction(() => window.__osloRush.phase === 'gameover', { timeout: 40000 });
  await page.waitForTimeout(500);
  await page.mouse.click(195, 700);
  await page.waitForTimeout(400);
  check((await S(page)).phase === 'running', 'second restart works (screen tap)');

  // High score survives reload.
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('oslorush.v1') || '{}').high);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__osloRush);
  await page.waitForTimeout(700);
  const bestChip = await page.locator('.start-best').textContent();
  check(bestChip.includes(String(before)), `menu shows persisted best (${before})`);

  // Pause on blur, resume via tap.
  await page.mouse.click(195, 420);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(200);
  check((await S(page)).paused === true, 'auto-pauses on blur');
  check(await page.locator('.screen.show .tap-cta').isVisible(), 'pause overlay visible');
  const distAtPause = (await S(page)).distance;
  await page.waitForTimeout(800);
  check(Math.abs((await S(page)).distance - distAtPause) < 0.01, 'world frozen while paused');
  await page.mouse.click(195, 500);
  await page.waitForTimeout(1100); // countdown 0.7s
  const resumed = await S(page);
  check(resumed.paused === false && resumed.phase === 'running', 'tap resumes after countdown');

  // Manual pause button.
  await page.locator('.hud-pause').click();
  await page.waitForTimeout(200);
  check((await S(page)).paused === true, 'HUD pause button pauses');

  check(errors.length === 0, `no console errors (${errors.length})`);
  if (errors.length) console.error(errors.slice(0, 8).join('\n'));
  await ctx.close();
}

// ===========================================================================
console.log('\n— Session 3: desktop viewport smoke —');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  collectErrors(page, errors);
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__osloRush);
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  check(await page.evaluate(() => window.__osloRush.phase === 'running'), 'Enter starts on desktop');
  await page.waitForTimeout(2500);
  check(errors.length === 0, `no console errors (${errors.length})`);
  if (errors.length) console.error(errors.slice(0, 8).join('\n'));
  await ctx.close();
}

await browser.close();
server.kill();

console.log(failures === 0 ? '\nAll browser checks passed ✅' : `\n${failures} browser checks FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
