// On-screen controls for touch devices.
//
// The keyboard game is WASD + Shift + Space + E + five panel shortcuts. This
// module is the thumb equivalent: a floating stick bottom-left, an action
// cluster bottom-right, and a menu sheet that stands in for the letter keys.
//
// It owns no gameplay. Movement goes straight into the controller's analog
// input (`setMoveVector` / `setRun` / `requestJump`), the action button calls
// the same `interactions.use()` the E key does, and the sheet opens the same
// panels the shortcuts open. Anything that hides the HUD hides these too, so
// the mini-games and dialogue keep the screen to themselves.
//
// Built from kit.js primitives and its CSS custom properties, per the UI rules.

import { EV } from '../game/bus.js';
import { injectStyles, el } from './kit.js';
import { IS_TOUCH } from '../engine/device.js';

const STYLE_ID = 'sp-touch-style';

/** Deflection in pixels that counts as a full push of the stick. */
const STICK_RADIUS = 52;
/** Half-width of the square the stick may float inside, in pixels. */
const STICK_ZONE = 86;

const CSS = `
.tc-root{
  position:fixed; inset:0; z-index:18; pointer-events:none;
  font-family:"Hiragino Maru Gothic ProN","Quicksand",ui-rounded,"Nunito",system-ui,sans-serif;
  font-weight:800; color:#fff;
  opacity:1; transition:opacity .18s ease;
  -webkit-user-select:none; user-select:none; -webkit-tap-highlight-color:transparent;
}
.tc-root.tc-off{ opacity:0; }
.tc-root.tc-off *{ pointer-events:none !important; }

/* ------------------------------------------------------------------ stick */
.tc-stick{
  position:absolute;
  left:calc(env(safe-area-inset-left, 0px) + 10px);
  bottom:calc(env(safe-area-inset-bottom, 0px) + 10px);
  width:${STICK_ZONE * 2}px; height:${STICK_ZONE * 2}px;
  pointer-events:auto; touch-action:none;
}
.tc-ring{
  position:absolute; left:50%; top:50%; width:118px; height:118px; margin:-59px 0 0 -59px;
  border-radius:50%;
  background:radial-gradient(circle at 50% 42%, rgba(248,240,255,.20), rgba(30,18,48,.34));
  border:2px solid rgba(255,255,255,.30);
  box-shadow:0 6px 18px rgba(10,4,20,.42), inset 0 1px 0 rgba(255,255,255,.22);
  backdrop-filter:blur(3px);
  transition:opacity .18s ease;
  opacity:.62;
}
.tc-stick.tc-live .tc-ring{ opacity:1; }
.tc-knob{
  position:absolute; left:50%; top:50%; width:56px; height:56px; margin:-28px 0 0 -28px;
  border-radius:50%;
  background:linear-gradient(180deg, rgba(255,255,255,.94), rgba(226,208,248,.86));
  border:2px solid rgba(255,255,255,.6);
  box-shadow:0 4px 12px rgba(10,4,20,.5);
  will-change:transform;
}
.tc-stick.tc-live .tc-knob{ background:linear-gradient(180deg,#fff,#ffc8da); }

/* ---------------------------------------------------------------- actions */
.tc-actions{
  position:absolute;
  right:calc(env(safe-area-inset-right, 0px) + 12px);
  bottom:calc(env(safe-area-inset-bottom, 0px) + 14px);
  display:grid; grid-template-columns:repeat(3, auto); gap:10px;
  justify-items:end; align-items:end;
  pointer-events:none;
}
.tc-btn{
  pointer-events:auto; touch-action:none; -webkit-tap-highlight-color:transparent;
  display:grid; place-items:center; gap:1px;
  font-family:inherit; font-weight:900; color:#fff;
  border:2px solid rgba(255,255,255,.28); border-radius:50%;
  background:rgba(30,18,48,.62); backdrop-filter:blur(4px);
  box-shadow:0 5px 16px rgba(10,4,20,.45), inset 0 1px 0 rgba(255,255,255,.2);
  width:62px; height:62px; font-size:19px; line-height:1;
  transition:transform .07s ease, background .12s ease, border-color .12s ease, opacity .16s ease;
}
.tc-btn .tc-cap{ font-size:9px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; opacity:.78; }
.tc-btn.tc-press{ transform:scale(.93); background:rgba(255,122,154,.62); }
.tc-btn.tc-on{ background:linear-gradient(180deg,#3ae014,#1a9a10); border-color:transparent; color:#142010; }

/* Interact: the big one, and the only one that ever disappears. */
.tc-use{
  grid-column:1 / span 3; grid-row:2;
  width:88px; height:88px; font-size:26px;
  background:linear-gradient(180deg,#ff9ab2,#c45a9a);
  border-color:rgba(255,255,255,.45);
}
.tc-use .tc-cap{ font-size:9.5px; opacity:.95; max-width:78px; text-align:center;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tc-use.tc-idle{ opacity:0; transform:scale(.82); pointer-events:none; }
.tc-menu{ grid-column:1; grid-row:1; }
.tc-run{ grid-column:2; grid-row:1; }
.tc-jump{ grid-column:3; grid-row:1; }
.tc-sheet{
  position:absolute; inset:0; z-index:1;
  display:none; align-items:flex-end; justify-content:center;
  background:rgba(10,4,20,.55); backdrop-filter:blur(4px);
  pointer-events:auto;
}
.tc-sheet.tc-shown{ display:flex; }
.tc-sheet-card{
  width:100%; max-width:520px;
  padding:16px 16px calc(env(safe-area-inset-bottom, 0px) + 18px);
  background:linear-gradient(180deg,var(--sp-cream),var(--sp-cream-deep));
  border-top:2px solid rgba(59,47,38,.16);
  border-radius:22px 22px 0 0;
  box-shadow:0 -10px 34px rgba(10,4,20,.5);
  animation:tc-rise .22s cubic-bezier(.2,1.2,.5,1) both;
}
@keyframes tc-rise{ from{ transform:translateY(24px); opacity:0 } to{ transform:none; opacity:1 } }
@media (prefers-reduced-motion:reduce){ .tc-sheet-card{ animation:none; } }
.tc-sheet-head{
  display:flex; align-items:center; margin:0 2px 12px;
  font-size:12px; letter-spacing:.1em; text-transform:uppercase; color:var(--sp-red);
}
.tc-sheet-grid{ display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; }
.tc-tile{
  pointer-events:auto; font-family:inherit; cursor:pointer;
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px;
  padding:12px 4px; min-height:74px;
  border:2px solid rgba(59,47,38,.14); border-radius:14px;
  background:rgba(255,255,255,.6); color:var(--sp-ink);
  font-size:11px; font-weight:800; letter-spacing:.02em;
}
.tc-tile .tc-tile-ico{ font-size:22px; line-height:1; }
.tc-tile:active{ background:#fff; border-color:var(--sp-red); transform:translateY(1px); }

/* Landscape phones: everything shrinks so the city keeps the middle. */
@media (max-height:520px){
  .tc-stick{ width:150px; height:150px; }
  .tc-ring{ width:100px; height:100px; margin:-50px 0 0 -50px; }
  .tc-knob{ width:48px; height:48px; margin:-24px 0 0 -24px; }
  .tc-btn{ width:52px; height:52px; font-size:16px; }
  .tc-use{ width:72px; height:72px; font-size:22px; }
  .tc-sheet-grid{ grid-template-columns:repeat(6, 1fr); }
  .tc-tile{ min-height:62px; padding:8px 4px; }
}
`;

function styleOnce() {
  injectStyles();
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

/** A no-op handle, so callers never have to null-check on desktop. */
const INERT = {
  root: null,
  update() {},
  setVisible() {},
  closeSheet() {},
  destroy() {},
  get enabled() { return false; },
};

/**
 * @param {object} game the usual game context (bus, panels, player, audio…)
 * @param {{ force?: boolean }} [opts] `force` builds the controls on a desktop too.
 */
export function createTouchControls(game, opts = {}) {
  if (!IS_TOUCH && !opts.force) return INERT;
  if (typeof document === 'undefined') return INERT;
  styleOnce();

  const bus = game.bus;
  const offs = [];
  const on = (evt, cb) => { offs.push(bus.on(evt, cb)); };
  const sfx = (n) => { try { game.audio && game.audio.play(n); } catch { /* muted */ } };

  const root = el('div', 'tc-root');
  root.setAttribute('aria-hidden', 'true');

  // ------------------------------------------------------------------ stick
  const stick = el('div', 'tc-stick');
  const ring = el('div', 'tc-ring');
  const knob = el('div', 'tc-knob');
  stick.append(ring, knob);

  let stickId = null;      // the pointer that owns the stick
  let originX = 0, originY = 0;

  /** Move the visual ring to where the thumb landed, clamped inside the zone. */
  function placeRing(clientX, clientY) {
    const r = stick.getBoundingClientRect();
    const half = r.width / 2;
    const lx = Math.max(-half + 46, Math.min(half - 46, clientX - r.left - half));
    const ly = Math.max(-half + 46, Math.min(half - 46, clientY - r.top - half));
    ring.style.transform = `translate(${lx}px, ${ly}px)`;
    knob.style.transform = `translate(${lx}px, ${ly}px)`;
    originX = r.left + half + lx;
    originY = r.top + half + ly;
  }

  function driveStick(clientX, clientY) {
    let dx = clientX - originX;
    let dy = clientY - originY;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      const k = STICK_RADIUS / len;
      dx *= k; dy *= k;
    }
    const base = ring.style.transform || 'translate(0px, 0px)';
    knob.style.transform = `${base} translate(${dx}px, ${dy}px)`;
    // Screen-up is forward; the controller wants +Z for forward.
    setMove(dx / STICK_RADIUS, -dy / STICK_RADIUS);
  }

  function releaseStick() {
    stickId = null;
    stick.classList.remove('tc-live');
    ring.style.transform = '';
    knob.style.transform = '';
    setMove(0, 0);
  }

  function setMove(x, z) {
    const c = game.player && game.player.controls;
    if (c && typeof c.setMoveVector === 'function') c.setMoveVector(x, z);
  }

  stick.addEventListener('pointerdown', (e) => {
    if (stickId != null) return;
    e.preventDefault();
    stickId = e.pointerId;
    stick.setPointerCapture?.(e.pointerId);
    stick.classList.add('tc-live');
    placeRing(e.clientX, e.clientY);
    driveStick(e.clientX, e.clientY);
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    e.preventDefault();
    driveStick(e.clientX, e.clientY);
  });
  const stickEnd = (e) => {
    if (e.pointerId !== stickId) return;
    try { stick.releasePointerCapture?.(e.pointerId); } catch { /* already gone */ }
    releaseStick();
  };
  stick.addEventListener('pointerup', stickEnd);
  stick.addEventListener('pointercancel', stickEnd);

  // ---------------------------------------------------------------- buttons
  /**
   * A round button that fires on pointerdown (a `click` costs ~90ms of tap
   * disambiguation, which is felt in a jump).
   */
  function makeBtn(cls, glyph, caption, onDown, onUp) {
    const b = el('button', `tc-btn ${cls}`.trim());
    b.type = 'button';
    b.append(el('span', null, glyph));
    if (caption) b.append(el('span', 'tc-cap', caption));
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.classList.add('tc-press');
      b.setPointerCapture?.(e.pointerId);
      if (onDown) onDown();
    });
    const up = (e) => {
      if (!b.classList.contains('tc-press')) return;
      b.classList.remove('tc-press');
      try { b.releasePointerCapture?.(e.pointerId); } catch { /* already gone */ }
      if (onUp) onUp();
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  }

  const actions = el('div', 'tc-actions');

  const useBtn = makeBtn('tc-use tc-idle', '🐾', 'Use', () => {
    if (game.mode !== 'explore') return;
    try { game.interactions.use(game); } catch (err) { console.error('[touch] interact failed', err); }
  });
  useBtn.setAttribute('aria-label', 'Interact');

  const jumpBtn = makeBtn('tc-jump', '⤴', 'Jump', () => {
    const c = game.player && game.player.controls;
    if (c && typeof c.requestJump === 'function') c.requestJump();
  });
  jumpBtn.setAttribute('aria-label', 'Jump');

  let running = false;
  const runBtn = makeBtn('tc-run', '»', 'Run', () => {
    running = !running;
    runBtn.classList.toggle('tc-on', running);
    const c = game.player && game.player.controls;
    if (c && typeof c.setRun === 'function') c.setRun(running);
    sfx('click');
  });
  runBtn.setAttribute('aria-label', 'Toggle run');

  // ------------------------------------------------------------------- menu
  const menuBtn = makeBtn('tc-menu', '☰', '', () => openSheet(true));
  menuBtn.setAttribute('aria-label', 'Open menu');

  actions.append(menuBtn, runBtn, jumpBtn, useBtn);

  const sheet = el('div', 'tc-sheet');
  const card = el('div', 'tc-sheet-card');
  const head = el('div', 'tc-sheet-head');
  head.append(el('span', null, 'Menu'));
  const grid = el('div', 'tc-sheet-grid');
  card.append(head, grid);
  sheet.append(card);
  sheet.addEventListener('pointerdown', (e) => { if (e.target === sheet) openSheet(false); });

  function tile(icon, label, run) {
    const b = el('button', 'tc-tile');
    b.type = 'button';
    b.append(el('span', 'tc-tile-ico', icon), el('span', null, label));
    b.addEventListener('click', () => {
      openSheet(false);
      try { run(); } catch (err) { console.error(`[touch] "${label}" failed`, err); }
    });
    return b;
  }

  const openPanel = (id) => () => { try { game.panels.open(id); } catch { /* not built */ } };

  grid.append(
    tile('🎒', 'Bag', openPanel('inventory')),
    tile('📖', 'Recipes', openPanel('recipes')),
    tile('📜', 'Quests', openPanel('quests')),
    tile('🗺', 'Map', openPanel('map')),
    tile('🏗', 'Upgrades', openPanel('upgrades')),
    tile('⚙️', 'Settings', openPanel('settings')),
    tile('💬', 'Chat', () => { if (game.social && game.social.toggleChat) game.social.toggleChat(); }),
    tile('🐱', 'Meow', () => {
      if (!game.player) return;
      game.player.setAction('meow');
      sfx('meow');
    }),
  );

  function openSheet(v) {
    const showing = sheet.classList.contains('tc-shown');
    if (v === showing) return;
    sheet.classList.toggle('tc-shown', !!v);
    // A finger on the stick when the sheet covers it never gets a pointerup.
    if (v) releaseStick();
    sfx(v ? 'ui_open' : 'ui_close');
  }

  root.append(stick, actions, sheet);
  document.body.append(root);

  // ------------------------------------------------------------------ prompt
  // The interact button mirrors the keyboard prompt exactly: same label, same
  // moment of appearing, so there is one truth about what E does right now.
  const cap = useBtn.querySelector('.tc-cap');
  on(EV.PROMPT, (p) => {
    const text = p && p.text ? String(p.text) : '';
    useBtn.classList.toggle('tc-idle', !text);
    if (text) {
      if (cap) cap.textContent = text.length > 14 ? `${text.slice(0, 13)}…` : text;
      useBtn.title = text;
      useBtn.setAttribute('aria-label', text);
    }
  });

  // ------------------------------------------------------------- visibility
  let visible = true;
  let panelsOpen = 0;

  on(EV.PANEL_OPEN, () => { panelsOpen++; releaseStick(); apply(); });
  on(EV.PANEL_CLOSE, () => { panelsOpen = Math.max(0, panelsOpen - 1); apply(); });

  /**
   * The stick and buttons belong to walking around. Cooking, fishing, dialogue
   * and cutscenes own the whole screen and their own input, so the cluster goes
   * away rather than sitting on top of them. The sheet is exempt: it is modal
   * chrome of its own and stays usable while it is up.
   */
  function apply() {
    const sheetUp = sheet.classList.contains('tc-shown');
    const off = !visible || game.mode !== 'explore' || panelsOpen > 0;
    if (off && stickId != null) releaseStick();
    root.classList.toggle('tc-off', off && !sheetUp);
  }

  function update() { apply(); }

  function setVisible(v) { visible = !!v; if (!visible) { releaseStick(); openSheet(false); } apply(); }

  function destroy() {
    for (const un of offs) { try { un(); } catch { /* ignore */ } }
    offs.length = 0;
    releaseStick();
    root.remove();
  }

  apply();

  return {
    root, update, setVisible, destroy,
    closeSheet: () => openSheet(false),
    get enabled() { return true; },
  };
}
