// The basket. A card grid of everything the cat is carrying, with category
// filters, three sort orders and a capacity read-out.
//
// Rebuilt from EV.INVENTORY — never polled.

import { EV } from '../game/bus.js';
import { injectStyles, el, panel, badge } from './kit.js';
import { CATEGORIES, ingredient } from '../data/ingredients.js';

const STYLE_ID = 'sp-inv-style';

const CSS = `
.spi-body{ flex:1; min-height:0; display:flex; flex-direction:column; gap:8px; }
.spi-tools{ display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.spi-chip{
  font-family:inherit; font-weight:800; font-size:11px; cursor:pointer;
  border:1.5px solid rgba(59,47,38,.14); border-radius:999px;
  background:rgba(255,255,255,.6); color:var(--sp-ink); padding:4px 10px;
}
.spi-chip:hover{ border-color:var(--sp-red); }
.spi-chip.spi-on{ background:var(--sp-red); color:#fff8ef; border-color:rgba(0,0,0,.12); }
.spi-chip:focus-visible{ outline:2px solid var(--sp-red); outline-offset:2px; }
.spi-sel{
  font-family:inherit; font-weight:800; font-size:11px; color:var(--sp-ink);
  border:1.5px solid rgba(59,47,38,.14); border-radius:10px;
  background:rgba(255,255,255,.7); padding:4px 8px;
}
.spi-grid{
  flex:1; min-height:0; overflow:auto; padding:2px 4px 2px 2px;
  display:grid; gap:8px;
  grid-template-columns:repeat(auto-fill, minmax(124px, 1fr));
  align-content:start;
}
.spi-grid::-webkit-scrollbar{ width:8px; }
.spi-grid::-webkit-scrollbar-thumb{ background:rgba(59,47,38,.2); border-radius:8px; }

.spi-card{
  background:rgba(255,255,255,.6); border:1.5px solid rgba(59,47,38,.1);
  border-radius:14px; padding:9px; display:flex; flex-direction:column;
  align-items:center; gap:5px; text-align:center;
}
.spi-ring{
  position:relative; width:52px; height:52px; border-radius:50%;
  display:flex; align-items:center; justify-content:center;
}
.spi-ring > i{
  position:absolute; inset:4px; border-radius:50%; background:#fff8ec;
  display:flex; align-items:center; justify-content:center; font-size:23px; font-style:normal;
}
.spi-qty{
  position:absolute; right:-4px; bottom:-4px; z-index:1;
  min-width:20px; height:20px; padding:0 5px; border-radius:999px;
  background:var(--sp-ink); color:var(--sp-cream);
  font-size:11px; font-weight:800; display:flex; align-items:center; justify-content:center;
}
.spi-name{ font-size:12px; font-weight:800; line-height:1.2; }
.spi-stars{ font-size:10px; letter-spacing:1px; color:var(--sp-gold); }
.spi-sub{ font-size:10px; font-weight:700; color:var(--sp-ink-soft); }
.spi-empty{ grid-column:1/-1; text-align:center; padding:34px 10px; color:var(--sp-ink-soft); font-size:13px; }
`;

function styleOnce() {
  injectStyles();
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Green when fresh, amber as it fades. */
function freshColor(f) {
  const t = clamp01(f);
  // 0 -> amber (#d99a3a), 1 -> green (#7ea36a)
  const a = [217, 154, 58], b = [126, 163, 106];
  const mix = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
}

function stars(q) {
  const n = Math.max(0, Math.min(5, Math.round(clamp01(q) * 5)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

export function createInventoryUI(game) {
  styleOnce();

  const id = 'inventory';
  const state = game.state;
  const offs = [];

  const p = panel({
    id: 'sp-panel-inventory',
    title: 'Basket',
    sub: '',
    pos: {
      left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
      width: 'min(760px, 92vw)', height: 'min(560px, 84vh)',
    },
    onClose: () => game.panels.close(id),
  });
  p.root.setAttribute('role', 'dialog');
  p.root.setAttribute('aria-label', 'Basket');

  const body = el('div', 'spi-body');
  const tools = el('div', 'spi-tools');
  const grid = el('div', 'spi-grid');
  body.append(tools, grid);
  p.body.append(body);

  let filter = 'all';
  let sort = 'name';
  let open = false;

  // ------------------------------------------------------------- toolbar
  const chips = [];
  function addChip(key, label) {
    const b = el('button', 'spi-chip', label);
    b.type = 'button';
    b.addEventListener('click', () => { filter = key; syncChips(); render(); });
    chips.push({ key, b });
    tools.append(b);
  }
  addChip('all', 'All');
  for (const key in CATEGORIES) addChip(key, `${CATEGORIES[key].icon} ${CATEGORIES[key].name}`);

  function syncChips() {
    for (const c of chips) c.b.classList.toggle('spi-on', c.key === filter);
  }
  syncChips();

  const spacer = el('span', 'sp-spacer');
  const sortSel = el('select', 'spi-sel');
  sortSel.setAttribute('aria-label', 'Sort basket');
  for (const [v, label] of [['name', 'Sort: Name'], ['freshness', 'Sort: Freshness'], ['value', 'Sort: Value']]) {
    const o = el('option', null, label); o.value = v; sortSel.append(o);
  }
  sortSel.addEventListener('change', () => { sort = sortSel.value; render(); });
  const cap = badge('0/0', '🧺');
  tools.append(spacer, sortSel, cap);

  // -------------------------------------------------------------- render
  function render() {
    const items = (state.inventory || []).slice();
    const rows = items.filter((s) => {
      if (filter === 'all') return true;
      const ing = ingredient(s.id);
      return ing && ing.cat === filter;
    });

    rows.sort((a, b) => {
      const ia = ingredient(a.id), ib = ingredient(b.id);
      if (sort === 'freshness') return (a.freshness || 0) - (b.freshness || 0);
      if (sort === 'value') return ((ib && ib.value) || 0) - ((ia && ia.value) || 0);
      const na = (ia && ia.name) || a.id, nb = (ib && ib.name) || b.id;
      return na.localeCompare(nb);
    });

    grid.textContent = '';
    if (!rows.length) {
      grid.append(el('div', 'spi-empty', filter === 'all'
        ? 'The basket is empty. Visit a stall and stock up.'
        : 'Nothing in this category yet.'));
    } else {
      for (const slot of rows) grid.append(card(slot));
    }

    const count = typeof state.invCount === 'function' ? state.invCount() : 0;
    const capacity = typeof state.invCapacity === 'function' ? state.invCapacity() : 0;
    cap.set(`${count}/${capacity}`, '🧺');
    p.setTitle('Basket', `${count}/${capacity} carried`);
  }

  function card(slot) {
    const ing = ingredient(slot.id);
    const c = el('div', 'spi-card');

    const ring = el('div', 'spi-ring');
    const f = clamp01(slot.freshness == null ? 1 : slot.freshness);
    ring.style.background =
      `conic-gradient(${freshColor(f)} 0turn ${f.toFixed(3)}turn, rgba(59,47,38,.13) ${f.toFixed(3)}turn 1turn)`;
    const inner = el('i', null, (ing && ing.icon) || '📦');
    const qty = el('span', 'spi-qty', String(slot.qty));
    ring.append(inner, qty);

    const name = el('div', 'spi-name', (ing && ing.name) || slot.id);
    const st = el('div', 'spi-stars', stars(slot.quality));
    st.title = `Quality ${Math.round(clamp01(slot.quality) * 100)}%`;
    const sub = el('div', 'spi-sub', `${Math.round(f * 100)}% fresh · ${(ing && ing.value) || 0}¢`);

    c.append(ring, name, st, sub);
    c.title = `${(ing && ing.name) || slot.id}\nQuality ${Math.round(clamp01(slot.quality) * 100)}%\nFreshness ${Math.round(f * 100)}%`;
    return c;
  }

  offs.push(game.bus.on(EV.INVENTORY, () => { if (open) render(); }));
  offs.push(game.bus.on(EV.SHOP_UPGRADED, () => { if (open) render(); }));

  // ----------------------------------------------------------------- api
  const api = {
    id,
    open() {
      if (open) return;
      open = true;
      render();
      p.show();
      sortSel.blur();
    },
    close() {
      if (!open) return;
      open = false;
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
