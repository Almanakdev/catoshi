// Headless smoke test: boots the built game in Chromium, walks the vertical
// slice, and fails loudly on any console error or unhandled rejection.
//
//   node tools/smoke.mjs [--keep] [--shots]
//
// Requires `npm run build` first (it serves dist/ over a tiny static server).

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const SHOTS = path.join(ROOT, 'tools', 'shots');
const PORT = 4173;

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

const errors = [];
const warnings = [];
let shotN = 0;

async function shot(page, name) {
  if (!process.argv.includes('--shots')) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, `${String(++shotN).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: f });
  console.log(`   📷 ${path.relative(ROOT, f)}`);
}

const step = (t) => console.log(`\n▶ ${t}`);
const ok = (t) => console.log(`   ✓ ${t}`);
const bad = (t) => { console.log(`   ✗ ${t}`); errors.push(t); };

async function run() {
  const server = await serve();
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });

  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') { errors.push(`console: ${t}`); console.log(`   ⚠︎ console.error: ${t}`); }
    else if (m.type() === 'warning') warnings.push(t);
    else if (/\[perf\]|\[world\]|Sushi Paws|\[cat\]/.test(t)) console.log(`   · ${t}`);
  });
  page.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); console.log(`   ⚠︎ pageerror: ${e.message}`); });

  step('Boot');
  await page.goto(`http://localhost:${PORT}/?q=0`);
  await page.waitForSelector('#start.ready', { timeout: 30000 });
  ok('start screen reached (boot completed without throwing)');
  await shot(page, 'start');

  step('New game');
  await page.click('#start-new');
  await page.waitForTimeout(2500);
  const booted = await page.evaluate(() => !!document.querySelector('#app canvas'));
  booted ? ok('canvas present') : bad('no canvas');
  await shot(page, 'world');

  // Expose the game object for assertions.
  const probe = await page.evaluate(() => {
    const g = window.__sushi;
    if (!g) return { missing: true };
    return {
      mode: g.mode,
      coins: g.state.coins,
      day: g.clock.day,
      hour: g.clock.hour,
      pos: { x: +g.player.position.x.toFixed(1), z: +g.player.position.z.toFixed(1) },
      district: g.player.district,
      colliders: g.world.colliders.length,
      pois: g.world.pois.length,
      recipes: g.state.data.recipes.slice(),
      interactions: g.interactions.list().length,
      npcs: g.npcs.npcs.length,
      quests: Object.keys(g.state.data.quests.active),
      calls: g.renderer.info.render.calls,
      tris: g.renderer.info.render.triangles,
    };
  });
  if (probe.missing) { bad('window.__sushi not exposed — cannot run gameplay assertions'); }
  else {
    console.log('   state:', JSON.stringify(probe));
    probe.mode === 'explore' ? ok('mode = explore') : bad(`mode = ${probe.mode}`);
    probe.coins === 120 ? ok('starting coins 120') : bad(`coins ${probe.coins}`);
    probe.colliders > 100 ? ok(`${probe.colliders} colliders`) : bad('too few colliders');
    probe.pois > 10 ? ok(`${probe.pois} POIs`) : bad('too few POIs');
    probe.npcs === 17 ? ok('17 NPCs spawned') : bad(`${probe.npcs} NPCs`);
    probe.recipes.length >= 3 ? ok(`${probe.recipes.length} starting recipes`) : bad('missing starting recipes');
    probe.interactions > 15 ? ok(`${probe.interactions} interactions registered`) : bad(`${probe.interactions} interactions`);
    probe.calls < 400 ? ok(`${probe.calls} draw calls`) : bad(`${probe.calls} draw calls (budget 400)`);
  }

  step('Movement');
  const f0 = await page.evaluate(() => window.__sushi.frames || 0);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(4000);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(300);
  const f1 = await page.evaluate(() => window.__sushi.frames || 0);
  const moved = await page.evaluate(() => {
    const g = window.__sushi;
    return { x: g.player.position.x, z: g.player.position.z, y: g.player.position.y };
  });
  const dist = Math.hypot(moved.x - probe.pos.x, moved.z - probe.pos.z);
  // dt is clamped at 50 ms/frame, so on a software rasteriser the simulated
  // travel is bounded by frames * 0.05 * walkSpeed — normalise against that.
  const budget = Math.max(1, (f1 - f0)) * 0.05 * 4.6;
  const frac = dist / budget;
  frac > 0.55
    ? ok(`cat walked ${dist.toFixed(1)} of a possible ${budget.toFixed(1)} units (${(f1 - f0)} frames)`)
    : bad(`cat barely moved: ${dist.toFixed(2)} of ${budget.toFixed(1)} possible`);
  Number.isFinite(moved.y) && Math.abs(moved.y) < 5 ? ok('cat is on the ground') : bad(`cat y = ${moved.y}`);
  await shot(page, 'walked');

  step('Panels');
  for (const [key, id] of [['KeyI', 'inventory'], ['KeyR', 'recipes'], ['KeyQ', 'quests'], ['KeyM', 'map']]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(450);
    const open = await page.evaluate((i) => window.__sushi.panels.isOpen(i), id);
    open ? ok(`${id} opened`) : bad(`${id} did not open`);
    await shot(page, id);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
    const closed = await page.evaluate((i) => !window.__sushi.panels.isOpen(i), id);
    closed ? ok(`${id} closed`) : bad(`${id} did not close`);
  }
  const back = await page.evaluate(() => window.__sushi.mode);
  back === 'explore' ? ok('mode restored to explore') : bad(`mode stuck at ${back}`);

  step('Economy: buy ingredients');
  const bought = await page.evaluate(() => {
    const g = window.__sushi;
    const before = g.state.coins;
    g.state.addItem('rice', 3, { quality: 0.7, freshness: 1 });
    g.state.addItem('salmon', 3, { quality: 0.75, freshness: 1 });
    g.state.spendCoins(66, 'test-buy');
    return { before, after: g.state.coins, rice: g.state.countItem('rice'), salmon: g.state.countItem('salmon') };
  });
  bought.rice === 3 && bought.salmon === 3 ? ok('ingredients in basket') : bad('inventory add failed');
  bought.after === bought.before - 66 ? ok('coins deducted') : bad(`coins ${bought.before}→${bought.after}`);

  step('Cooking mini-game');
  const cookStarted = await page.evaluate(() => {
    const g = window.__sushi;
    window.__cookPromise = g.cooking.start('salmon_nigiri');
    return true;
  });
  await page.waitForTimeout(900);
  const cooking = await page.evaluate(() => window.__sushi.cooking.active);
  cooking ? ok('cooking session active') : bad('cooking did not start');
  await shot(page, 'cooking');

  // Play it badly but completely: mash space + arrows so every step type advances.
  for (let i = 0; i < 45; i++) {
    await page.keyboard.press(['Space', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Enter', 'Digit1', 'Digit2'][i % 8]);
    await page.waitForTimeout(90);
    if (!(await page.evaluate(() => window.__sushi.cooking.active))) break;
  }
  // The summary card waits to be dismissed. Poll for its button — on a software
  // rasteriser it can take a couple of seconds to appear.
  await page.evaluate(() => { window.__cookPromise.then((r) => { window.__cookDone = r || { aborted: true }; }); });
  for (let i = 0; i < 30 && !(await page.evaluate(() => !!window.__cookDone)); i++) {
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button'))
        .find((x) => x.offsetParent && /Serve it up|Continue|Done|Next|Finish/i.test(x.textContent));
      if (b) b.click();
    });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
  }
  const cookRes = await page.evaluate(() => {
    const r = window.__cookDone;
    if (!r) return { timeout: true };
    if (r.aborted) return { aborted: true };
    return { score: r.score, grade: r.grade && r.grade.id, seconds: r.seconds, steps: r.stepScores && r.stepScores.length };
  });
  console.log('   cook result:', JSON.stringify(cookRes));
  if (cookRes.timeout) bad('cooking promise never settled');
  else if (cookRes.aborted) ok('cooking aborted cleanly (returned null)');
  else ok(`cooked with grade ${cookRes.grade} in ${cookRes.seconds && cookRes.seconds.toFixed(1)}s`);
  const modeAfterCook = await page.evaluate(() => window.__sushi.mode);
  modeAfterCook === 'explore' ? ok('mode restored after cooking') : bad(`mode stuck at ${modeAfterCook}`);

  step('Serve a customer (scripted)');
  const served = await page.evaluate(() => {
    const g = window.__sushi;
    g.clock.set(g.clock.day, 12);   // the shop only trades inside its opening hours
    g.orders.openShop();
    // Force an order into the queue rather than waiting for the spawn timer.
    for (let i = 0; i < 400; i++) g.orders.update(0.25);
    const q = g.orders.queue;
    if (!q.length) return { none: true, isOpen: g.orders.isOpen };
    const o = q[0];
    const before = { coins: g.state.coins, rep: g.state.reputation };
    const r = g.orders.serve(o.id, { recipeId: o.recipeId, score: 0.95 });
    return { recipeId: o.recipeId, r, before, after: { coins: g.state.coins, rep: g.state.reputation } };
  });
  if (served.none) bad(`no order generated (shop open: ${served.isOpen})`);
  else if (!served.r) bad('serve() returned null');
  else {
    ok(`served ${served.recipeId}: +${served.r.pay}¢ pay, +${served.r.tip}¢ tip, +${served.r.rep.toFixed(1)} rep`);
    served.after.coins > served.before.coins ? ok('coins increased') : bad('coins did not increase');
    served.after.rep > served.before.rep ? ok('reputation increased') : bad('reputation did not increase');
  }

  step('Quests');
  const qs = await page.evaluate(() => {
    const g = window.__sushi;
    return {
      active: g.quests.active.map((e) => e.quest.id),
      tracked: g.quests.tracked,
      offeredCount: g.quests.offered.length,
    };
  });
  console.log('   quests:', JSON.stringify(qs));
  qs.active.length > 0 ? ok(`${qs.active.length} active quest(s)`) : bad('no active quest at start');

  step('Save / load round trip');
  const round = await page.evaluate(() => {
    const g = window.__sushi;
    g.state.addCoins(777, 'test');
    g.state.addItem('tuna', 2, { quality: 0.9, freshness: 0.8 });
    const before = { coins: g.state.coins, tuna: g.state.countItem('tuna'), day: g.state.clock.day, rep: g.state.reputation, quests: JSON.stringify(g.state.data.quests) };
    const saved = g.save.save('slot1');
    g.state.addCoins(-g.state.coins, 'wipe');
    g.state.removeItem('tuna', 99);
    const r = g.save.load('slot1');
    const after = { coins: g.state.coins, tuna: g.state.countItem('tuna'), day: g.state.clock.day, rep: g.state.reputation, quests: JSON.stringify(g.state.data.quests) };
    return { saved, loadOk: r.ok, before, after };
  });
  round.saved ? ok('saved to slot1') : bad('save failed');
  round.loadOk ? ok('loaded slot1') : bad(`load failed: ${JSON.stringify(round)}`);
  round.before.coins === round.after.coins ? ok(`coins restored (${round.after.coins})`) : bad(`coins ${round.before.coins} → ${round.after.coins}`);
  round.before.tuna === round.after.tuna ? ok('inventory restored') : bad('inventory not restored');
  round.before.quests === round.after.quests ? ok('quest progress restored') : bad('quest progress not restored');

  step('Corrupt save handling');
  const corrupt = await page.evaluate(() => {
    localStorage.setItem('sushipaws.save.slot2', '{not json at all');
    const r = window.__sushi.save.load('slot2');
    return { ok: r.ok, reason: r.reason, quarantined: Object.keys(localStorage).some((k) => k.includes('broken')) };
  });
  !corrupt.ok && corrupt.reason === 'corrupt' ? ok('corrupt save rejected safely') : bad(`corrupt save: ${JSON.stringify(corrupt)}`);
  corrupt.quarantined ? ok('corrupt blob quarantined') : bad('corrupt blob not quarantined');

  step('Day / night');
  await page.evaluate(() => window.__sushi.clock.set(1, 21.5));
  await page.waitForTimeout(1200);
  const night = await page.evaluate(() => ({ n: window.__sushi.clock.night, s: window.__sushi.clock.timeString }));
  night.n > 0.8 ? ok(`night factor ${night.n.toFixed(2)} at ${night.s}`) : bad(`night factor ${night.n} at ${night.s}`);
  await shot(page, 'night');
  await page.evaluate(() => window.__sushi.clock.set(1, 12));
  await page.waitForTimeout(900);
  await shot(page, 'noon');

  step('Fishing');
  const fish = await page.evaluate(async () => {
    const g = window.__sushi;
    const spot = g.fishing.spots[0];
    if (!spot) return { none: true };
    g.player.teleport(spot.x, spot.z + 2, 0);
    window.__fishPromise = g.fishing.start(spot.id);
    return { id: spot.id };
  });
  if (fish.none) bad('no fishing spots registered');
  else {
    await page.waitForTimeout(700);
    const act = await page.evaluate(() => window.__sushi.fishing.active);
    act ? ok(`fishing started at ${fish.id}`) : bad('fishing did not start');
    await shot(page, 'fishing');
    for (let i = 0; i < 35 && (await page.evaluate(() => window.__sushi.fishing.active)); i++) {
      await page.keyboard.press('Space');
      await page.waitForTimeout(140);
    }
    await page.evaluate(() => { if (window.__sushi.fishing.active) window.__sushi.fishing.abort(); });
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__sushi.panels.closeAll());
    await page.waitForTimeout(300);
    const fm = await page.evaluate(() => window.__sushi.mode);
    fm === 'explore' ? ok('mode restored after fishing') : bad(`mode stuck at ${fm}`);
  }

  step('Soak: 10s of continuous play');
  await page.evaluate(() => window.__sushi.panels.closeAll());
  await page.waitForTimeout(300);
  await page.keyboard.down('KeyW');
  const t0 = Date.now();
  let frames0 = await page.evaluate(() => window.__sushi.frames || 0);
  while (Date.now() - t0 < 10000) {
    await page.keyboard.press('KeyD');
    await page.waitForTimeout(1000);
  }
  await page.keyboard.up('KeyW');
  const frames1 = await page.evaluate(() => window.__sushi.frames || 0);
  const fps = (frames1 - frames0) / ((Date.now() - t0) / 1000);
  console.log(`   ~${fps.toFixed(1)} fps under software rendering (swiftshader)`);
  const final = await page.evaluate(() => ({
    mode: window.__sushi.mode,
    calls: window.__sushi.renderer.info.render.calls,
    geo: window.__sushi.renderer.info.memory.geometries,
    tex: window.__sushi.renderer.info.memory.textures,
    pos: { x: +window.__sushi.player.position.x.toFixed(1), z: +window.__sushi.player.position.z.toFixed(1) },
    district: window.__sushi.player.district,
  }));
  console.log('   final:', JSON.stringify(final));
  final.mode === 'explore' ? ok('still in explore mode after soak') : bad(`mode ${final.mode}`);
  await shot(page, 'soak-end');

  if (!process.argv.includes('--keep')) { await browser.close(); server.close(); }

  console.log('\n' + '='.repeat(64));
  if (warnings.length) console.log(`${warnings.length} console warning(s) (not failures)`);
  if (errors.length) {
    console.log(`FAILED — ${errors.length} problem(s):`);
    for (const e of errors) console.log('  • ' + e);
    process.exit(1);
  }
  console.log('ALL CHECKS PASSED');
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
