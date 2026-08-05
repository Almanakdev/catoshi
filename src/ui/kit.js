// Cozy cartoon UI toolkit.
//
// Every panel in the game is built from these helpers so the look stays
// consistent and nothing has to be hand-written into index.html. Styles are
// injected once from here, keyed to CSS custom properties so a re-skin is a
// one-file change.

let injected = false;

export const THEME = {
  cream: '#fbf3e2',
  creamDeep: '#f2e4c8',
  ink: '#3b2f26',
  inkSoft: '#6d5a49',
  red: '#c8503f',
  redSoft: '#e87f6c',
  gold: '#f0b93f',
  green: '#7ea36a',
  blue: '#5f97b8',
  pink: '#e6a7bd',
  wood: '#a3764c',
  shadow: 'rgba(59, 47, 38, 0.22)',
};

const CSS = `
:root{
  --sp-cream:${THEME.cream}; --sp-cream-deep:${THEME.creamDeep};
  --sp-ink:${THEME.ink}; --sp-ink-soft:${THEME.inkSoft};
  --sp-red:${THEME.red}; --sp-gold:${THEME.gold}; --sp-green:${THEME.green};
  --sp-blue:${THEME.blue}; --sp-wood:${THEME.wood};
  --sp-shadow:${THEME.shadow};
  --sp-radius:16px;
  --sp-scale:1;
}
.sp-font{ font-family:"Hiragino Maru Gothic ProN","Quicksand",ui-rounded,"Nunito",system-ui,sans-serif; }

.sp-panel{
  position:fixed; box-sizing:border-box;
  background:linear-gradient(180deg,var(--sp-cream) 0%,var(--sp-cream-deep) 100%);
  color:var(--sp-ink);
  border:2px solid rgba(59,47,38,.16);
  border-radius:var(--sp-radius);
  box-shadow:0 10px 26px var(--sp-shadow), inset 0 1px 0 rgba(255,255,255,.7);
  font-family:"Hiragino Maru Gothic ProN","Quicksand",ui-rounded,"Nunito",system-ui,sans-serif;
  font-weight:700;
  padding:12px 14px;
  z-index:20;
  pointer-events:auto;
}
.sp-panel.sp-hidden{ display:none; }
.sp-panel .sp-head{
  display:flex; align-items:center; gap:8px;
  font-size:13px; letter-spacing:.04em; text-transform:uppercase;
  color:var(--sp-red); margin:-2px 0 8px;
}
.sp-panel .sp-head .sp-title{ flex:1; }
.sp-panel .sp-head .sp-sub{ color:var(--sp-ink-soft); text-transform:none; letter-spacing:0; font-size:12px; }

.sp-close{
  border:0; background:rgba(59,47,38,.08); color:var(--sp-ink);
  width:24px; height:24px; border-radius:50%; cursor:pointer;
  font-size:14px; line-height:1; font-weight:900;
}
.sp-close:hover{ background:var(--sp-red); color:#fff; }

.sp-btn{
  font-family:inherit; font-weight:800; font-size:13px;
  border:2px solid rgba(59,47,38,.18); border-radius:12px;
  background:linear-gradient(180deg,#fff8ea,#f1e0be);
  color:var(--sp-ink); padding:7px 14px; cursor:pointer;
  box-shadow:0 3px 0 rgba(59,47,38,.16); transition:transform .08s, box-shadow .08s, filter .12s;
}
.sp-btn:hover{ filter:brightness(1.04); }
.sp-btn:active{ transform:translateY(2px); box-shadow:0 1px 0 rgba(59,47,38,.16); }
.sp-btn[disabled]{ opacity:.45; cursor:not-allowed; box-shadow:none; }
.sp-btn.sp-primary{ background:linear-gradient(180deg,#e07a63,var(--sp-red)); color:#fff8ef; border-color:rgba(0,0,0,.12); }
.sp-btn.sp-good{ background:linear-gradient(180deg,#94bd80,var(--sp-green)); color:#fff; border-color:rgba(0,0,0,.12); }
.sp-btn.sp-ghost{ background:rgba(255,255,255,.4); box-shadow:none; }

.sp-row{ display:flex; align-items:center; gap:8px; }
.sp-col{ display:flex; flex-direction:column; gap:6px; }
.sp-spacer{ flex:1; }
.sp-muted{ color:var(--sp-ink-soft); font-weight:700; }
.sp-mono{ font-family:ui-monospace,"SFMono-Regular",Menlo,monospace; }
.sp-small{ font-size:11px; }

.sp-list{ overflow:auto; display:flex; flex-direction:column; gap:6px; padding-right:4px; }
.sp-list::-webkit-scrollbar{ width:8px; }
.sp-list::-webkit-scrollbar-thumb{ background:rgba(59,47,38,.2); border-radius:8px; }

.sp-item{
  display:flex; align-items:center; gap:9px;
  background:rgba(255,255,255,.55); border:1.5px solid rgba(59,47,38,.1);
  border-radius:12px; padding:7px 9px; cursor:pointer; text-align:left;
  font-family:inherit; font-weight:700; font-size:13px; color:var(--sp-ink); width:100%;
  transition:background .12s, border-color .12s, transform .08s;
}
.sp-item:hover{ background:#fff; border-color:var(--sp-red); }
.sp-item.sp-sel{ background:#fff; border-color:var(--sp-red); box-shadow:0 0 0 2px rgba(200,80,63,.18); }
.sp-item[disabled]{ opacity:.45; cursor:not-allowed; }
.sp-item .sp-ico{ font-size:19px; width:24px; text-align:center; flex:0 0 24px; }
.sp-item .sp-name{ flex:1; }
.sp-item .sp-meta{ color:var(--sp-ink-soft); font-size:12px; }

.sp-bar{ height:9px; border-radius:9px; background:rgba(59,47,38,.14); overflow:hidden; }
.sp-bar > i{ display:block; height:100%; border-radius:9px; background:var(--sp-green); transition:width .18s ease; }

.sp-badge{
  display:inline-flex; align-items:center; gap:5px;
  background:rgba(255,255,255,.7); border:1.5px solid rgba(59,47,38,.12);
  border-radius:999px; padding:3px 10px; font-size:12px; font-weight:800;
}

.sp-scrim{
  position:fixed; inset:0; background:rgba(43,33,26,.42);
  backdrop-filter:blur(2px); z-index:19;
}
.sp-scrim.sp-hidden{ display:none; }

.sp-toast-wrap{
  position:fixed; left:50%; bottom:86px; transform:translateX(-50%);
  display:flex; flex-direction:column-reverse; gap:6px; align-items:center;
  z-index:60; pointer-events:none;
}
.sp-toast{
  font-family:"Hiragino Maru Gothic ProN","Quicksand",ui-rounded,system-ui,sans-serif;
  font-weight:800; font-size:13px;
  background:linear-gradient(180deg,#fffaf0,#f3e5c9); color:var(--sp-ink);
  border:2px solid rgba(59,47,38,.14); border-radius:999px;
  padding:7px 16px; box-shadow:0 6px 16px var(--sp-shadow);
  animation:sp-pop .28s cubic-bezier(.2,1.5,.5,1) both;
}
.sp-toast.sp-good{ border-color:rgba(126,163,106,.7); }
.sp-toast.sp-bad{ border-color:rgba(200,80,63,.7); }
.sp-toast.sp-out{ animation:sp-fade .3s ease forwards; }
@keyframes sp-pop{ from{ transform:translateY(10px) scale(.9); opacity:0 } to{ transform:none; opacity:1 } }
@keyframes sp-fade{ to{ opacity:0; transform:translateY(-6px) } }

.sp-prompt{
  position:fixed; left:50%; bottom:120px; transform:translateX(-50%);
  font-family:"Hiragino Maru Gothic ProN","Quicksand",ui-rounded,system-ui,sans-serif;
  font-weight:800; font-size:14px; color:var(--sp-ink);
  background:linear-gradient(180deg,#fffaf0,#f2e3c6);
  border:2px solid rgba(59,47,38,.16); border-radius:999px;
  padding:8px 18px; box-shadow:0 6px 18px var(--sp-shadow);
  z-index:22; pointer-events:none; opacity:0; transition:opacity .16s;
}
.sp-prompt.sp-on{ opacity:1; }
.sp-prompt kbd{
  display:inline-block; background:var(--sp-ink); color:var(--sp-cream);
  border-radius:6px; padding:1px 7px; margin-right:6px; font-size:12px; font-family:inherit;
}

.sp-fade{ position:fixed; inset:0; background:#241c16; opacity:0; pointer-events:none; transition:opacity .3s; z-index:70; }
.sp-fade.sp-on{ opacity:1; }

@media (max-width:820px){
  .sp-panel{ font-size:12px; }
}
`;

export function injectStyles() {
  if (injected) return;
  injected = true;
  const el = document.createElement('style');
  el.id = 'sp-kit';
  el.textContent = CSS;
  document.head.appendChild(el);
}

/** Create an element with class/text/attrs in one call. */
export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/**
 * A floating panel. `pos` accepts any subset of {left,right,top,bottom,width,height}
 * as CSS strings. Returns { root, body, setTitle, show, hide, toggle, visible, destroy }.
 */
export function panel({ id, title, sub, pos = {}, closable = true, onClose, cls = '' } = {}) {
  injectStyles();
  const root = el('div', `sp-panel sp-hidden ${cls}`.trim());
  if (id) root.id = id;
  for (const k in pos) root.style[k] = pos[k];

  let head = null, titleEl = null, subEl = null;
  if (title != null) {
    head = el('div', 'sp-head');
    titleEl = el('span', 'sp-title', title);
    subEl = el('span', 'sp-sub', sub || '');
    head.append(titleEl, subEl);
    if (closable) {
      const x = el('button', 'sp-close', '✕');
      x.addEventListener('click', () => { api.hide(); if (onClose) onClose(); });
      head.append(x);
    }
    root.append(head);
  }
  const body = el('div', 'sp-col');
  root.append(body);
  document.body.append(root);

  const api = {
    root, body, head,
    setTitle(t, s) { if (titleEl) titleEl.textContent = t; if (subEl && s != null) subEl.textContent = s; },
    show() { root.classList.remove('sp-hidden'); return api; },
    hide() { root.classList.add('sp-hidden'); return api; },
    toggle(v) { const on = v == null ? root.classList.contains('sp-hidden') : v; on ? api.show() : api.hide(); return on; },
    get visible() { return !root.classList.contains('sp-hidden'); },
    destroy() { root.remove(); },
  };
  return api;
}

export function button(label, { cls = '', onClick, icon } = {}) {
  const b = el('button', `sp-btn ${cls}`.trim());
  b.textContent = (icon ? icon + ' ' : '') + label;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

/** A selectable list row: icon + name + right-hand meta. */
export function item({ icon = '', name = '', meta = '', disabled = false, onClick } = {}) {
  const b = el('button', 'sp-item');
  const i = el('span', 'sp-ico', icon);
  const n = el('span', 'sp-name', name);
  const m = el('span', 'sp-meta', meta);
  b.append(i, n, m);
  b.disabled = !!disabled;
  if (onClick) b.addEventListener('click', onClick);
  b.setIcon = (v) => { i.textContent = v; };
  b.setName = (v) => { n.textContent = v; };
  b.setMeta = (v) => { m.textContent = v; };
  return b;
}

export function bar(value = 0, color) {
  const b = el('div', 'sp-bar');
  const f = el('i');
  if (color) f.style.background = color;
  f.style.width = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
  b.append(f);
  b.set = (v, c) => {
    f.style.width = `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
    if (c) f.style.background = c;
  };
  return b;
}

export function badge(text, icon) {
  const b = el('span', 'sp-badge');
  b.textContent = (icon ? icon + ' ' : '') + text;
  b.set = (t, i) => { b.textContent = (i ? i + ' ' : '') + t; };
  return b;
}

export function scrim(onClick) {
  injectStyles();
  const s = el('div', 'sp-scrim sp-hidden');
  if (onClick) s.addEventListener('click', onClick);
  document.body.append(s);
  return {
    el: s,
    show() { s.classList.remove('sp-hidden'); },
    hide() { s.classList.add('sp-hidden'); },
    get visible() { return !s.classList.contains('sp-hidden'); },
  };
}

// ------------------------------------------------------------------ toasts
let toastWrap = null;
export function toast(text, { icon = '', tone = '', ms = 2200 } = {}) {
  injectStyles();
  if (!toastWrap) { toastWrap = el('div', 'sp-toast-wrap'); document.body.append(toastWrap); }
  const t = el('div', `sp-toast ${tone ? 'sp-' + tone : ''}`.trim(), (icon ? icon + ' ' : '') + text);
  toastWrap.append(t);
  while (toastWrap.children.length > 4) toastWrap.firstChild.remove();
  setTimeout(() => {
    t.classList.add('sp-out');
    setTimeout(() => t.remove(), 320);
  }, ms);
  return t;
}

// ------------------------------------------------------------------ prompt
let promptEl = null;
export function prompt(text, key) {
  injectStyles();
  if (!promptEl) { promptEl = el('div', 'sp-prompt'); document.body.append(promptEl); }
  if (!text) { promptEl.classList.remove('sp-on'); return; }
  promptEl.innerHTML = '';
  if (key) { const k = el('kbd', null, key); promptEl.append(k); }
  promptEl.append(document.createTextNode(text));
  promptEl.classList.add('sp-on');
}

// ------------------------------------------------------------------- fade
let fadeEl = null;
export function fade(on) {
  injectStyles();
  if (!fadeEl) { fadeEl = el('div', 'sp-fade'); document.body.append(fadeEl); }
  fadeEl.classList.toggle('sp-on', !!on);
}

/** Fade out, run fn, fade back in. Returns a promise resolved after the fade-in. */
export function fadeThen(fn, { out = 320, hold = 40, inMs = 320 } = {}) {
  return new Promise((resolve) => {
    fade(true);
    setTimeout(() => {
      try { fn && fn(); } catch (e) { console.error('[fadeThen]', e); }
      setTimeout(() => { fade(false); setTimeout(resolve, inMs); }, hold);
    }, out);
  });
}

export function money(n) { return `${Math.round(n)}` + '¢'; }
