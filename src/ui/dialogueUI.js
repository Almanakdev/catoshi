// Cozy bottom-centre dialogue box.
//
// Built entirely from src/ui/kit.js primitives plus one small stylesheet of its
// own, so the look matches every other panel and nothing needs an image asset:
// the portrait is a cat face drawn into a canvas from the NPC's own fur/accent
// colours.
//
// Contract-critical bit: opening switches the game into 'dialogue' mode and
// locks the player, and EVERY exit path (Esc, choice click, last line, close(),
// a second say() interrupting the first) runs the same teardown exactly once.

import * as UI from './kit.js';
import { npc as npcById } from '../data/npcs.js';

const CHARS_PER_SEC = 45;

const CSS = `
.sp-dlg-catch{
  position:fixed; inset:0; z-index:44; background:transparent; cursor:pointer;
}
.sp-dlg{
  position:fixed; left:50%; bottom:38px; transform:translateX(-50%) translateY(14px);
  width:min(720px, calc(100vw - 40px)); box-sizing:border-box;
  z-index:45; opacity:0; pointer-events:none;
  transition:opacity .18s ease, transform .18s cubic-bezier(.2,1.3,.5,1);
  font-family:"Hiragino Maru Gothic ProN","Quicksand",ui-rounded,"Nunito",system-ui,sans-serif;
}
.sp-dlg.sp-on{ opacity:1; transform:translateX(-50%) translateY(0); pointer-events:auto; }

.sp-dlg-box{
  position:relative;
  background:linear-gradient(180deg,var(--sp-cream) 0%,var(--sp-cream-deep) 100%);
  border:2px solid rgba(59,47,38,.16); border-radius:20px;
  box-shadow:0 14px 34px var(--sp-shadow), inset 0 1px 0 rgba(255,255,255,.75);
  padding:14px 18px 14px 96px; min-height:104px; color:var(--sp-ink);
}
.sp-dlg-portrait{
  position:absolute; left:-14px; top:-18px;
  width:88px; height:88px; border-radius:50%;
  border:3px solid var(--sp-cream); background:var(--sp-cream);
  box-shadow:0 6px 16px var(--sp-shadow);
  overflow:hidden;
}
.sp-dlg-portrait canvas{ display:block; width:100%; height:100%; }
.sp-dlg-name{
  display:inline-flex; align-items:center; gap:6px;
  background:linear-gradient(180deg,#e07a63,var(--sp-red)); color:#fff8ef;
  border-radius:999px; padding:3px 14px; font-size:13px; font-weight:900;
  letter-spacing:.02em; box-shadow:0 3px 0 rgba(59,47,38,.18);
  margin:0 0 8px;
}
.sp-dlg-text{
  font-size:15px; font-weight:700; line-height:1.5; min-height:3em;
  white-space:pre-wrap; word-break:break-word;
}
.sp-dlg-text .sp-caret{ opacity:.45; }
.sp-dlg-foot{ display:flex; align-items:center; gap:8px; margin-top:10px; min-height:30px; }
.sp-dlg-choices{ display:flex; flex-wrap:wrap; gap:8px; }
.sp-dlg-hint{
  margin-left:auto; font-size:11px; font-weight:800; color:var(--sp-ink-soft);
  opacity:.9; white-space:nowrap;
}
.sp-dlg-hint kbd{
  display:inline-block; background:var(--sp-ink); color:var(--sp-cream);
  border-radius:6px; padding:1px 6px; margin:0 3px; font-family:inherit; font-size:11px;
}
.sp-dlg-next{
  position:absolute; right:16px; bottom:12px; font-size:14px; color:var(--sp-red);
  animation:sp-dlg-bob .9s ease-in-out infinite;
}
@keyframes sp-dlg-bob{ 0%,100%{ transform:translateY(0) } 50%{ transform:translateY(3px) } }
@media (max-width:640px){
  .sp-dlg-box{ padding-left:80px; }
  .sp-dlg-portrait{ width:72px; height:72px; }
}
`;

let cssInjected = false;
function injectCss() {
  if (cssInjected) return;
  cssInjected = true;
  UI.injectStyles();
  const s = document.createElement('style');
  s.id = 'sp-dialogue-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ---------------------------------------------------------------- portrait
/** Draws a front-facing cartoon cat head. No assets, just arcs and triangles. */
function drawCatFace(ctx, size, { fur = '#e8a55c', accent = '#c8503f', belly = '#f7ead6', eye = '#2f2a24' } = {}) {
  const s = size;
  ctx.clearRect(0, 0, s, s);

  // soft background disc
  const g = ctx.createLinearGradient(0, 0, 0, s);
  g.addColorStop(0, '#fffaf0');
  g.addColorStop(1, '#f0e0be');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); ctx.fill();

  const cx = s * 0.5, cy = s * 0.56, r = s * 0.3;

  // ears
  const ear = (dir) => {
    ctx.beginPath();
    ctx.moveTo(cx + dir * r * 0.86, cy - r * 0.62);
    ctx.lineTo(cx + dir * r * 1.05, cy - r * 1.42);
    ctx.lineTo(cx + dir * r * 0.24, cy - r * 0.96);
    ctx.closePath();
    ctx.fillStyle = fur; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + dir * r * 0.78, cy - r * 0.72);
    ctx.lineTo(cx + dir * r * 0.9, cy - r * 1.2);
    ctx.lineTo(cx + dir * r * 0.42, cy - r * 0.94);
    ctx.closePath();
    ctx.fillStyle = accent; ctx.fill();
  };
  ear(-1); ear(1);

  // head
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * 1.12, r, 0, 0, Math.PI * 2);
  ctx.fillStyle = fur; ctx.fill();

  // muzzle
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.34, r * 0.6, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = belly; ctx.fill();

  // eyes
  for (const dx of [-0.42, 0.42]) {
    ctx.beginPath();
    ctx.ellipse(cx + r * dx, cy - r * 0.06, r * 0.15, r * 0.19, 0, 0, Math.PI * 2);
    ctx.fillStyle = eye; ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + r * dx + r * 0.06, cy - r * 0.14, r * 0.05, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fill();
  }

  // nose + mouth
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.11, cy + r * 0.16);
  ctx.lineTo(cx + r * 0.11, cy + r * 0.16);
  ctx.lineTo(cx, cy + r * 0.31);
  ctx.closePath();
  ctx.fillStyle = accent; ctx.fill();

  ctx.strokeStyle = 'rgba(59,47,38,.55)';
  ctx.lineWidth = Math.max(1, s * 0.014);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.31);
  ctx.quadraticCurveTo(cx - r * 0.18, cy + r * 0.5, cx - r * 0.3, cy + r * 0.34);
  ctx.moveTo(cx, cy + r * 0.31);
  ctx.quadraticCurveTo(cx + r * 0.18, cy + r * 0.5, cx + r * 0.3, cy + r * 0.34);
  ctx.stroke();

  // whiskers
  ctx.strokeStyle = 'rgba(59,47,38,.32)';
  ctx.lineWidth = Math.max(1, s * 0.01);
  for (const dir of [-1, 1]) {
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + dir * r * 0.45, cy + r * 0.26 + i * r * 0.09);
      ctx.lineTo(cx + dir * r * 1.16, cy + r * 0.18 + i * r * 0.19);
      ctx.stroke();
    }
  }
}

// ---------------------------------------------------------------------------
export function createDialogueUI(game) {
  injectCss();

  const doc = document;
  const catcher = UI.el('div', 'sp-dlg-catch');
  catcher.style.display = 'none';

  const root = UI.el('div', 'sp-dlg');
  const box = UI.el('div', 'sp-dlg-box');
  const portrait = UI.el('div', 'sp-dlg-portrait');
  const canvas = doc.createElement('canvas');
  canvas.width = canvas.height = 176;
  portrait.append(canvas);
  const nameChip = UI.el('div', 'sp-dlg-name', '');
  const textEl = UI.el('div', 'sp-dlg-text', '');
  const foot = UI.el('div', 'sp-dlg-foot');
  const choicesEl = UI.el('div', 'sp-dlg-choices');
  const hint = UI.el('div', 'sp-dlg-hint');
  hint.innerHTML = '<kbd>Space</kbd> continue · <kbd>Esc</kbd> close';
  const nextArrow = UI.el('div', 'sp-dlg-next', '▼');
  foot.append(choicesEl, hint);
  box.append(portrait, nameChip, textEl, foot, nextArrow);
  root.append(box);
  doc.body.append(catcher, root);

  const ctx = canvas.getContext('2d');

  // ------------------------------------------------------------------ state
  let open = false;
  let lines = [];
  let lineIdx = 0;
  let shown = 0;          // characters revealed of the current line
  let typing = false;
  let rafId = 0;
  let lastT = 0;
  let choices = null;
  let settle = null;      // the pending promise resolver
  let closing = false;    // re-entrancy guard for teardown
  let prevMode = 'explore';

  // ------------------------------------------------------------- typewriter
  function tick(now) {
    rafId = 0;
    if (!open || !typing) return;
    const dt = Math.min(0.12, Math.max(0, (now - lastT) / 1000));
    lastT = now;
    const line = lines[lineIdx] || '';
    shown = Math.min(line.length, shown + dt * CHARS_PER_SEC);
    render();
    if (shown >= line.length) { typing = false; onLineComplete(); return; }
    rafId = requestAnimationFrame(tick);
  }

  function startTyping() {
    const line = lines[lineIdx] || '';
    shown = 0;
    typing = line.length > 0;
    choicesEl.replaceChildren();
    nextArrow.style.display = 'none';
    render();
    if (!typing) { onLineComplete(); return; }
    lastT = performance.now();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }

  function render() {
    const line = lines[lineIdx] || '';
    textEl.textContent = line.slice(0, Math.floor(shown));
  }

  function onLineComplete() {
    const last = lineIdx >= lines.length - 1;
    if (last && choices && choices.length) showChoices();
    else nextArrow.style.display = '';
  }

  function showChoices() {
    nextArrow.style.display = 'none';
    choicesEl.replaceChildren();
    for (const c of choices) {
      if (!c) continue;
      const b = UI.button(c.label || String(c.id || '…'), {
        cls: c.tone === 'good' ? 'sp-good' : c.tone === 'ghost' ? 'sp-ghost' : 'sp-primary',
        icon: c.icon,
        onClick: (ev) => { ev.stopPropagation(); pick(c.id == null ? null : c.id); },
      });
      choicesEl.append(b);
    }
    const first = choicesEl.firstChild;
    if (first && first.focus) { try { first.focus(); } catch { /* ignore */ } }
  }

  function pick(id) {
    finish(id);
  }

  // -------------------------------------------------------------- advancing
  /** Space / click: finish the line, then step to the next one. */
  function advance() {
    if (!open) return;
    if (typing) {
      typing = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      shown = (lines[lineIdx] || '').length;
      render();
      onLineComplete();
      return;
    }
    // Waiting on a choice — the buttons are the only way out.
    if (lineIdx >= lines.length - 1 && choices && choices.length) return;
    if (lineIdx < lines.length - 1) { lineIdx++; startTyping(); return; }
    finish(null);
  }

  // ------------------------------------------------------------ open / close
  function onKey(e) {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); return; }
    if (e.code === 'Space' || e.key === ' ' || e.key === 'Enter') {
      // Let a focused choice button handle its own Enter/Space press.
      const a = doc.activeElement;
      if (a && a.tagName === 'BUTTON' && choicesEl.contains(a)) return;
      e.preventDefault(); e.stopPropagation();
      advance();
    }
  }

  function onCatchClick(e) { e.preventDefault(); advance(); }

  function enter() {
    if (open) return;
    open = true;
    closing = false;
    prevMode = (game && typeof game.mode === 'string' && game.mode !== 'dialogue') ? game.mode : 'explore';
    try { if (game && typeof game.setMode === 'function') game.setMode('dialogue'); } catch (err) { console.error('[dialogue] setMode', err); }
    try { if (game && game.player && typeof game.player.lock === 'function') game.player.lock(true); } catch (err) { console.error('[dialogue] lock', err); }
    try { if (game && game.interactions && typeof game.interactions.lock === 'function') game.interactions.lock(true); } catch { /* optional */ }
    catcher.style.display = '';
    root.classList.add('sp-on');
    window.addEventListener('keydown', onKey, true);
    catcher.addEventListener('click', onCatchClick);
    box.addEventListener('click', onCatchClick);
  }

  /** The single exit path. Idempotent — safe to call from anywhere. */
  function finish(result) {
    if (!open || closing) return;
    closing = true;

    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    typing = false;
    window.removeEventListener('keydown', onKey, true);
    catcher.removeEventListener('click', onCatchClick);
    box.removeEventListener('click', onCatchClick);
    root.classList.remove('sp-on');
    catcher.style.display = 'none';
    choicesEl.replaceChildren();

    const resolve = settle;
    settle = null;
    lines = []; choices = null; lineIdx = 0; shown = 0;
    open = false;

    try { if (game && game.interactions && typeof game.interactions.lock === 'function') game.interactions.lock(false); } catch { /* optional */ }
    try { if (game && game.player && typeof game.player.lock === 'function') game.player.lock(false); } catch (err) { console.error('[dialogue] unlock', err); }
    try { if (game && typeof game.setMode === 'function') game.setMode(prevMode === 'dialogue' ? 'explore' : prevMode); } catch (err) { console.error('[dialogue] restore mode', err); }

    closing = false;
    if (resolve) { try { resolve(result == null ? null : result); } catch (err) { console.error('[dialogue] resolve', err); } }
  }

  // -------------------------------------------------------------------- api
  /**
   * @param {object|string} npcOrSpec  an NPCS record, an npc id, or
   *                                   { name, fur, accent, belly, eye }
   * @param {string|string[]} text     one line or many
   * @param {object} [opts]            { choices: [{ id, label, icon, tone }] }
   * @returns {Promise<string|null>}   the chosen id, or null if dismissed
   */
  function say(npcOrSpec, text, opts = {}) {
    // A second say() while one is open cancels the first (resolving it null).
    if (open) finish(null);

    let spec = npcOrSpec;
    if (typeof spec === 'string') spec = npcById(spec) || { name: spec };
    if (!spec || typeof spec !== 'object') spec = { name: '' };

    const list = Array.isArray(text) ? text : [text];
    lines = list
      .filter((l) => l != null)
      .map((l) => String(l))
      .filter((l) => l.trim().length > 0);
    if (!lines.length) lines = ['…'];
    lineIdx = 0;

    const raw = opts && Array.isArray(opts.choices) ? opts.choices : null;
    choices = raw && raw.length ? raw.filter(Boolean) : null;

    nameChip.textContent = spec.name || 'Someone';
    try {
      drawCatFace(ctx, canvas.width, {
        fur: spec.fur, accent: spec.accent, belly: spec.belly, eye: spec.eye,
      });
    } catch (err) { console.error('[dialogue] portrait', err); }

    hint.innerHTML = choices
      ? '<kbd>Space</kbd> continue · <kbd>Esc</kbd> cancel'
      : '<kbd>Space</kbd> continue · <kbd>Esc</kbd> close';

    enter();
    startTyping();

    return new Promise((resolve) => { settle = resolve; });
  }

  function close() { finish(null); }

  function destroy() {
    finish(null);
    root.remove();
    catcher.remove();
  }

  return {
    say, close, destroy,
    get open() { return open; },
    get element() { return root; },
  };
}

export default createDialogueUI;
