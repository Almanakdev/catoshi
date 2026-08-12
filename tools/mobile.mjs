// Mobile layout check: boots the built game at three phone viewports, drives
// the on-screen controls, and fails on anything that overlaps, runs off the
// screen, or leaves the player with no way out.
//
//   npm run build && node tools/mobile.mjs [--shots]
//
// Companion to tools/smoke.mjs, which walks the same game with a keyboard at
// desktop size. It serves dist/ over its own tiny static server, so no dev
// server has to be running.

import { chromium, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const SHOTS = path.join(ROOT, 'tools', 'shots-mobile');
const PORT = 4174;
const BASE = `http://localhost:${PORT}`;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.vrm': 'application/octet-stream',
  '.png': 'image/png', '.txt': 'text/plain', '.fbx': 'application/octet-stream',
};

function serve() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(DIST, p);
      if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    s.listen(PORT, () => resolve(s));
  });
}

/** Short portrait, tall portrait, and the landscape case where height is scarce. */
const VIEWPORTS = [
  { name: 'iphone-se', width: 375, height: 667 },
  { name: 'iphone-14', width: 390, height: 844 },
  { name: 'landscape', width: 844, height: 390 },
];

const errors = [];
const bad = (t) => { console.log(`   ✗ ${t}`); errors.push(t); };
const info = (t) => console.log(`   ${t}`);

async function shot(page, name) {
  if (!process.argv.includes('--shots')) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

/** Bounding boxes + the computed bits that decide whether a box counts. */
function rects(page, selectors) {
  return page.evaluate((sels) => {
    const out = {};
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el) { out[s] = null; continue; }
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      out[s] = {
        x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
        display: cs.display,
      };
    }
    return out;
  }, selectors);
}

const shown = (a) => !!a && a.w > 0 && a.h > 0 && a.display !== 'none';
const overlaps = (a, b) =>
  shown(a) && shown(b) &&
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Every HUD / control box that must stay inside the viewport and off each other. */
const CHROME = [
  '.tc-stick', '.tc-actions', '.tc-use', '.tc-menu', '.tc-run', '.tc-jump',
  '.sph-tl', '.sph-tc', '.sph-tr', '.sph-bl', '.sph-br', '.sph-quest',
  '#game-chrome', '#minimap-wrap', '#chat', '.spgd-banner',
];

/** Pairs that shared a corner before the mobile layout existed. */
const MUST_NOT_TOUCH = [
  ['#game-chrome', '.sph-tl'], ['#game-chrome', '.sph-tc'],
  ['.sph-tl', '.sph-bl'], ['.sph-bl', '.sph-br'], ['.sph-bl', '.sph-quest'],
  ['.sph-tl', '#minimap-wrap'], ['.sph-tc', '#minimap-wrap'], ['.sph-tr', '#minimap-wrap'],
  ['.tc-stick', '.sph-bl'], ['.tc-actions', '.sph-br'],
  ['.tc-actions', '.spgd-banner'], ['.tc-stick', '.spgd-banner'],
];

async function checkViewport(browser, vp) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: devices['iPhone 13'].userAgent,
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  console.log(`\n▶ ${vp.name} (${vp.width}×${vp.height})`);
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1800);

  // ---------------------------------------------------------------- landing
  info(`html classes: ${await page.evaluate(() => document.documentElement.className)}`);
  const nav = await rects(page, ['.lp-nav-toggle', '.lp-nav-links']);
  if (!shown(nav['.lp-nav-toggle'])) bad(`${vp.name}: hamburger not shown`);
  if (shown(nav['.lp-nav-links'])) bad(`${vp.name}: inline nav links still shown`);

  const flow = await page.evaluate(() => {
    const l = document.getElementById('landing');
    return { scrollW: l.scrollWidth, clientW: l.clientWidth };
  });
  if (flow.scrollW > flow.clientW + 1) bad(`${vp.name}: landing scrolls sideways`);
  await shot(page, `${vp.name}-01-landing`);

  await page.click('.lp-nav-toggle');
  await page.waitForTimeout(300);
  if (await page.evaluate(() => getComputedStyle(document.querySelector('.lp-drawer')).display) === 'none') {
    bad(`${vp.name}: nav drawer did not open`);
  }
  await shot(page, `${vp.name}-02-drawer`);
  await page.click('.lp-nav-toggle');
  await page.waitForTimeout(200);

  // ------------------------------------------------------------- into play
  await page.click('.lp-hero [data-play-now]');
  await page.waitForTimeout(400);
  await shot(page, `${vp.name}-03-gate`);
  await page.fill('#wg-username', 'ThumbChef');
  await page.click('[data-wg-connect]');
  await page.waitForSelector('#start.ready', { timeout: 30000 });
  await page.click('#start-new');
  await page.waitForTimeout(2500);
  const skip = await page.$('#tut-skip');
  if (skip) { await skip.click(); await page.waitForTimeout(500); }
  await page.waitForTimeout(500);
  await shot(page, `${vp.name}-04-game`);

  // ------------------------------------------------- controls exist and fit
  const g = await rects(page, CHROME);
  for (const [k, v] of Object.entries(g)) {
    if (v) info(`${k.padEnd(16)} ${shown(v) ? `${v.x},${v.y} ${v.w}×${v.h}` : 'hidden'}`);
  }
  if (!shown(g['.tc-stick'])) bad(`${vp.name}: no thumbstick`);
  if (!shown(g['.tc-actions'])) bad(`${vp.name}: no action buttons`);
  for (const [a, b] of MUST_NOT_TOUCH) {
    if (overlaps(g[a], g[b])) bad(`${vp.name}: ${a} overlaps ${b}`);
  }
  for (const [k, v] of Object.entries(g)) {
    // #chat is deliberately parked off-screen until the menu slides it in.
    if (!shown(v) || k === '#chat') continue;
    if (v.x < -1 || v.x + v.w > vp.width + 1) bad(`${vp.name}: ${k} off the side`);
    if (v.y < -1 || v.y + v.h > vp.height + 1) bad(`${vp.name}: ${k} off the bottom`);
  }

  // ----------------------------------------------- the stick actually walks
  const before = await page.evaluate(() => ({ ...window.__catoshi.player.position }));
  const s = g['.tc-stick'];
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 60, { steps: 6 });
  await page.waitForTimeout(900);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({ ...window.__catoshi.player.position }));
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  info(`thumbstick walked ${moved.toFixed(2)} units`);
  if (moved < 0.5) bad(`${vp.name}: thumbstick did not move the cat`);

  // ------------------------------------------------------ chat slides in/out
  await page.click('.tc-menu');
  await page.waitForTimeout(300);
  await page.click('.tc-sheet-grid .tc-tile:nth-child(7)');   // Chat
  await page.waitForTimeout(900);
  const chat = (await rects(page, ['#chat']))['#chat'];
  if (chat.y + chat.h > vp.height + 1 || chat.x + chat.w > vp.width + 1) {
    bad(`${vp.name}: opened chat is off screen`);
  }
  await shot(page, `${vp.name}-05-chat`);
  await page.click('#chat-close');
  await page.waitForTimeout(400);

  // ------------------------------------------------------- sheet and a panel
  await page.click('.tc-menu');
  await page.waitForTimeout(350);
  if (!await page.evaluate(() => document.querySelector('.tc-sheet').classList.contains('tc-shown'))) {
    bad(`${vp.name}: menu sheet did not open`);
  }
  await shot(page, `${vp.name}-06-sheet`);
  await page.click('.tc-sheet-grid .tc-tile:nth-child(2)');   // Recipes
  await page.waitForTimeout(500);
  const pb = (await rects(page, ['.sp-panel:not(.sp-hidden)']))['.sp-panel:not(.sp-hidden)'];
  if (pb && (pb.x < -1 || pb.x + pb.w > vp.width + 1 || pb.y < -1 || pb.y + pb.h > vp.height + 1)) {
    bad(`${vp.name}: open panel does not fit the screen`);
  }
  await shot(page, `${vp.name}-07-recipes`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ----------------------------------- cooking: tappable, and escapable
  await page.evaluate(() => {
    const g2 = window.__catoshi;
    g2.state.addItem('rice', 6); g2.state.addItem('salmon', 6);
    window.__cookPromise = g2.cooking.start('salmon_nigiri');
  });
  await page.waitForTimeout(1200);
  const ck = await rects(page, ['.ck-stage', '.ck-arena', '.ck-stop']);
  info(`cook hint: ${await page.textContent('.ck-hint')}`);
  for (const k of ['.ck-stage', '.ck-stop']) {
    const v = ck[k];
    if (!shown(v)) { bad(`${vp.name}: ${k} missing while cooking`); continue; }
    if (v.x < -1 || v.x + v.w > vp.width + 1 || v.y < -1 || v.y + v.h > vp.height + 1) {
      bad(`${vp.name}: ${k} does not fit the screen`);
    }
  }
  await shot(page, `${vp.name}-08-cooking`);
  const ar = ck['.ck-arena'];
  if (shown(ar)) {
    for (let i = 0; i < 4; i++) {
      await page.touchscreen.tap(ar.x + ar.w / 2, ar.y + ar.h / 2);
      await page.waitForTimeout(320);
    }
  }
  await page.click('.ck-stop');
  await page.waitForTimeout(700);
  const afterCook = await page.evaluate(() => window.__catoshi.mode);
  if (afterCook !== 'explore') bad(`${vp.name}: Stop left mode as "${afterCook}"`);

  // ------------------------------- fishing: a tap surface and a way out
  await page.evaluate(() => { window.__fish = window.__catoshi.fishing.start('spot_harbor_steps'); });
  await page.waitForTimeout(900);
  const fx = await rects(page, ['.spf-touch', '.spf-esc']);
  if (!shown(fx['.spf-touch'])) bad(`${vp.name}: fishing has no tap surface`);
  if (!shown(fx['.spf-esc'])) bad(`${vp.name}: fishing has no pack-up button`);
  await shot(page, `${vp.name}-09-fishing`);
  await page.click('.spf-esc');
  await page.waitForTimeout(900);
  const afterFish = await page.evaluate(() => window.__catoshi.mode);
  if (afterFish !== 'explore') bad(`${vp.name}: pack up left mode as "${afterFish}"`);

  for (const e of consoleErrors.slice(0, 5)) bad(`${vp.name}: console: ${e}`);
  await ctx.close();
}

async function run() {
  const server = await serve();
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
  });

  for (const vp of VIEWPORTS) await checkViewport(browser, vp);

  await browser.close();
  server.close();

  console.log('\n' + '='.repeat(64));
  if (errors.length) {
    console.log(`FAILED — ${errors.length} problem(s):`);
    for (const e of errors) console.log('  • ' + e);
    process.exit(1);
  }
  console.log('MOBILE LAYOUT OK');
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
