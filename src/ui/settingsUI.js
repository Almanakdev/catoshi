// Settings + save management.
//
// Everything writes straight into `state.settings` (the live object the rest of
// the game reads) and then persists via `game.save.saveSettings()`. UI scale is
// applied immediately to `--sp-scale` and the root font-size so panels and the
// HUD grow together.

import { EV } from '../game/bus.js';
import { injectStyles, el, panel, button, money } from './kit.js';

const STYLE_ID = 'sp-settings-style';

const CSS = `
.spg-body{ flex:1; min-height:0; display:flex; flex-direction:column; gap:10px; overflow:auto; padding-right:4px; }
.spg-body::-webkit-scrollbar{ width:8px; }
.spg-body::-webkit-scrollbar-thumb{ background:rgba(59,47,38,.2); border-radius:8px; }
.spg-h{ font-size:11px; letter-spacing:.05em; text-transform:uppercase; color:var(--sp-red); margin-top:2px; }
.spg-row{ display:flex; align-items:center; gap:10px; font-size:12.5px; font-weight:800; }
.spg-row > label{ flex:0 0 118px; }
.spg-row input[type=range]{ flex:1; min-width:80px; accent-color:var(--sp-red); }
.spg-row .spg-num{ flex:0 0 44px; text-align:right; font-variant-numeric:tabular-nums; color:var(--sp-ink-soft); }
.spg-seg{ display:flex; gap:5px; }
.spg-segbtn{
  font-family:inherit; font-weight:800; font-size:11.5px; cursor:pointer;
  border:1.5px solid rgba(59,47,38,.14); border-radius:9px; padding:4px 12px;
  background:rgba(255,255,255,.65); color:var(--sp-ink);
}
.spg-segbtn.spg-on{ background:var(--sp-red); color:#fff8ef; border-color:rgba(0,0,0,.12); }
.spg-segbtn:focus-visible{ outline:2px solid var(--sp-red); outline-offset:2px; }
.spg-check{ display:flex; align-items:center; gap:8px; font-size:12.5px; font-weight:800; cursor:pointer; }
.spg-check input{ width:16px; height:16px; accent-color:var(--sp-red); }

.spg-slot{
  display:flex; align-items:center; gap:7px;
  background:rgba(255,255,255,.6); border:1.5px solid rgba(59,47,38,.1);
  border-radius:12px; padding:7px 10px; font-size:12px; font-weight:800;
}
.spg-slot .spg-name{ flex:0 0 62px; }
.spg-slot .spg-info{ flex:1; min-width:0; font-size:11px; font-weight:700; color:var(--sp-ink-soft);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.spg-slot .sp-btn{ padding:4px 10px; font-size:11.5px; }
.spg-danger{
  display:flex; align-items:center; gap:8px; flex-wrap:wrap;
  background:rgba(200,80,63,.09); border:1.5px dashed rgba(200,80,63,.4);
  border-radius:12px; padding:8px 10px; font-size:11.5px; font-weight:700; color:var(--sp-ink-soft);
}
.spg-danger .spg-msg{ flex:1; min-width:120px; }
`;

function styleOnce() {
  injectStyles();
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

const QUALITY_NAMES = ['Low', 'Medium', 'High'];
const BASE_FONT_PX = 16;

/** Exported so main.js can apply the saved scale before any panel exists. */
export function applyUiScale(scale) {
  const s = Math.max(0.8, Math.min(1.4, Number(scale) || 1));
  document.documentElement.style.setProperty('--sp-scale', String(s));
  document.documentElement.style.fontSize = `${Math.round(BASE_FONT_PX * s)}px`;
  return s;
}

export function createSettingsUI(game) {
  styleOnce();

  const id = 'settings';
  const state = game.state;
  const offs = [];

  const p = panel({
    id: 'sp-panel-settings',
    title: 'Settings',
    sub: '',
    pos: {
      left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
      width: 'min(520px, 94vw)', height: 'min(600px, 90vh)',
    },
    onClose: () => game.panels.close(id),
  });
  p.root.setAttribute('role', 'dialog');
  p.root.setAttribute('aria-label', 'Settings');

  const body = el('div', 'spg-body');
  p.body.append(body);

  let open = false;
  let confirmingNew = false;

  const S = () => state.settings;

  function persist() {
    try { if (game.save && typeof game.save.saveSettings === 'function') game.save.saveSettings(); }
    catch (err) { console.error('[settings] saveSettings threw', err); }
  }

  function applyAudio() {
    const a = game.audio;
    if (!a) return;
    const s = S();
    try {
      if (typeof a.applySettings === 'function') a.applySettings(s);
      else {
        if (typeof a.setMaster === 'function') a.setMaster(s.master);
        if (typeof a.setMusic === 'function') a.setMusic(s.music);
        if (typeof a.setSfx === 'function') a.setSfx(s.sfx);
      }
    } catch (err) { console.error('[settings] audio apply threw', err); }
  }

  // ------------------------------------------------------------- controls
  function slider(label, key, { min = 0, max = 1, step = 0.05, fmt } = {}, onInput) {
    const row = el('div', 'spg-row');
    // No id/for pairing on purpose — global DOM ids are a collision risk, and
    // aria-label gives the same screen-reader result.
    const lab = el('label', null, label);
    const input = el('input');
    input.type = 'range';
    input.min = String(min); input.max = String(max); input.step = String(step);
    input.value = String(S()[key]);
    input.setAttribute('aria-label', label);
    const num = el('span', 'spg-num', fmt ? fmt(S()[key]) : `${Math.round(S()[key] * 100)}%`);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      S()[key] = v;
      num.textContent = fmt ? fmt(v) : `${Math.round(v * 100)}%`;
      if (onInput) onInput(v);
      persist();
    });
    row.append(lab, input, num);
    return row;
  }

  function segment(label, options, get, set) {
    const row = el('div', 'spg-row');
    row.append(el('label', null, label));
    const seg = el('div', 'spg-seg');
    seg.setAttribute('role', 'group');
    const btns = [];
    options.forEach((opt, i) => {
      const b = el('button', 'spg-segbtn', opt);
      b.type = 'button';
      b.addEventListener('click', () => { set(i); sync(); persist(); });
      btns.push(b);
      seg.append(b);
    });
    function sync() { btns.forEach((b, i) => b.classList.toggle('spg-on', i === get())); }
    sync();
    row.append(seg);
    row.sync = sync;
    return row;
  }

  function checkbox(label, key) {
    const wrap = el('label', 'spg-check');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = !!S()[key];
    input.addEventListener('change', () => { S()[key] = input.checked; persist(); });
    wrap.append(input, el('span', null, label));
    wrap.sync = () => { input.checked = !!S()[key]; };
    return wrap;
  }

  // ---------------------------------------------------------------- build
  body.append(el('div', 'spg-h', 'Sound'));
  const sMaster = slider('Master', 'master', {}, applyAudio);
  const sMusic = slider('Music', 'music', {}, applyAudio);
  const sSfx = slider('Effects', 'sfx', {}, applyAudio);
  body.append(sMaster, sMusic, sSfx);

  body.append(el('div', 'spg-h', 'Display'));
  const segQuality = segment('Quality', QUALITY_NAMES, () => Number(S().quality) || 0, (i) => {
    S().quality = i;
    if (typeof game.setQuality === 'function') {
      try { game.setQuality(i); } catch (err) { console.error('[settings] setQuality threw', err); }
    }
  });
  const sScale = slider('UI scale', 'uiScale',
    { min: 0.8, max: 1.4, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    (v) => applyUiScale(v));
  body.append(segQuality, sScale);

  body.append(el('div', 'spg-h', 'Controls'));
  const cInvert = checkbox('Invert vertical look', 'invertY');
  const cHints = checkbox('Show hints and tooltips', 'showHints');
  body.append(cInvert, cHints);

  body.append(el('div', 'spg-h', 'Saved games'));
  const slotWrap = el('div', 'sp-col');
  body.append(slotWrap);

  const danger = el('div', 'spg-danger');
  body.append(danger);

  // ------------------------------------------------------------- save UI
  function slotLabel(s) {
    if (s.broken) return 'Damaged file';
    if (s.empty) return 'Empty';
    const hour = Math.floor(s.hour || 0);
    return `Day ${s.day} · ${String(hour).padStart(2, '0')}:00 · ${money(s.coins)} · ⭐${s.reputation}`;
  }

  function renderSlots() {
    slotWrap.textContent = '';
    const save = game.save;
    if (!save || typeof save.listSlots !== 'function') {
      slotWrap.append(el('div', 'spg-info', 'Saving is unavailable in this browser.'));
      return;
    }
    let slots = [];
    try { slots = save.listSlots() || []; } catch (err) { console.error('[settings] listSlots threw', err); }

    for (const s of slots) {
      const row = el('div', 'spg-slot');
      row.append(el('span', 'spg-name', s.slot === 'auto' ? 'Auto' : s.slot.replace('slot', 'Slot ')));
      row.append(el('span', 'spg-info', slotLabel(s)));

      const saveBtn = button('Save', {
        onClick: () => { try { save.save(s.slot); } catch (err) { console.error(err); } renderSlots(); },
      });
      const loadBtn = button('Load', {
        cls: 'sp-good',
        onClick: () => {
          let res = { ok: false };
          try { res = save.load(s.slot) || { ok: false }; } catch (err) { console.error(err); }
          if (res.ok) {
            game.bus.emit(EV.TOAST, { text: 'Game loaded', icon: '📂', tone: 'good' });
            game.panels.closeAll();
          } else {
            game.bus.emit(EV.TOAST, { text: `Could not load (${res.reason || 'error'})`, icon: '⚠️', tone: 'bad' });
          }
          renderSlots();
        },
      });
      const delBtn = button('Delete', {
        cls: 'sp-ghost',
        onClick: () => { try { save.erase(s.slot); } catch (err) { console.error(err); } renderSlots(); },
      });
      loadBtn.disabled = s.empty || s.broken;
      delBtn.disabled = s.empty;
      row.append(saveBtn, loadBtn, delBtn);
      slotWrap.append(row);
    }
  }

  function renderDanger() {
    danger.textContent = '';
    if (!confirmingNew) {
      danger.append(el('span', 'spg-msg', 'Start over from day one. Settings are kept.'));
      danger.append(button('New Game', {
        cls: 'sp-ghost', icon: '🔁',
        onClick: () => { confirmingNew = true; renderDanger(); },
      }));
      return;
    }
    danger.append(el('span', 'spg-msg', 'Really start a new game? Anything unsaved is lost.'));
    danger.append(button('Yes, start over', {
      cls: 'sp-primary',
      onClick: () => {
        confirmingNew = false;
        renderDanger();
        game.panels.closeAll();
        if (typeof game.newGame === 'function') {
          try { game.newGame(); return; } catch (err) { console.error('[settings] newGame threw', err); }
        }
        // Fallback: merging an empty blob over the defaults IS a fresh run.
        try { state.fromJSON({}); } catch (err) { console.error('[settings] reset threw', err); }
        game.bus.emit(EV.TOAST, { text: 'New game', icon: '🌱', tone: 'good' });
      },
    }));
    danger.append(button('Cancel', {
      cls: 'sp-ghost',
      onClick: () => { confirmingNew = false; renderDanger(); },
    }));
  }

  function syncAll() {
    const s = S();
    sMaster.querySelector('input').value = String(s.master);
    sMusic.querySelector('input').value = String(s.music);
    sSfx.querySelector('input').value = String(s.sfx);
    sScale.querySelector('input').value = String(s.uiScale);
    sMaster.querySelector('.spg-num').textContent = `${Math.round(s.master * 100)}%`;
    sMusic.querySelector('.spg-num').textContent = `${Math.round(s.music * 100)}%`;
    sSfx.querySelector('.spg-num').textContent = `${Math.round(s.sfx * 100)}%`;
    sScale.querySelector('.spg-num').textContent = `${Math.round(s.uiScale * 100)}%`;
    segQuality.sync();
    cInvert.sync();
    cHints.sync();
  }

  offs.push(game.bus.on(EV.SAVE, () => { if (open) renderSlots(); }));
  offs.push(game.bus.on(EV.LOAD, () => { if (open) { syncAll(); renderSlots(); } }));

  // Apply the persisted scale once at construction.
  applyUiScale(S().uiScale);

  // ----------------------------------------------------------------- api
  const api = {
    id,
    open() {
      confirmingNew = false;
      syncAll();
      renderSlots();
      renderDanger();
      if (open) return;
      open = true;
      p.show();
    },
    close() {
      if (!open) return;
      open = false;
      confirmingNew = false;
      persist();
      p.hide();
    },
    get isOpen() { return open; },
    destroy() {
      for (const un of offs) { try { un(); } catch { /* ignore */ } }
      offs.length = 0;
      p.destroy();
    },
  };

  game.panels.register(id, api);
  return api;
}
