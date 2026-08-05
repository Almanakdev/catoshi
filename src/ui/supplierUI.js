// Supplier shop: shelf on the left, basket on the right, one Buy button.
//
// Prices, availability and stock all come from src/data/suppliers.js so the
// panel never invents economy rules. Sold units are remembered per supplier
// per day so a stall visibly runs out.

import { EV } from '../game/bus.js';
import { injectStyles, el, panel, button, money } from './kit.js';
import { supplier, stockFor, priceFor, tierFor, isOpenAt } from '../data/suppliers.js';
import { ingredient } from '../data/ingredients.js';
import { npc as npcById } from '../data/npcs.js';

const STYLE_ID = 'sp-supplier-style';

const CSS = `
.sps-body{ flex:1; min-height:0; display:grid; grid-template-columns:1fr 260px; gap:12px; }
.sps-col{ min-height:0; display:flex; flex-direction:column; gap:7px; }
.sps-scroll{ flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; gap:5px; padding-right:4px; }
.sps-scroll::-webkit-scrollbar{ width:8px; }
.sps-scroll::-webkit-scrollbar-thumb{ background:rgba(59,47,38,.2); border-radius:8px; }
.sps-h{ font-size:11px; letter-spacing:.05em; text-transform:uppercase; color:var(--sp-red); }

.sps-row{
  display:flex; align-items:center; gap:8px;
  background:rgba(255,255,255,.6); border:1.5px solid rgba(59,47,38,.1);
  border-radius:12px; padding:6px 9px; font-size:12.5px; font-weight:800;
}
.sps-row.sps-out{ opacity:.45; }
.sps-row .sps-ico{ font-size:19px; width:24px; text-align:center; flex:0 0 24px; }
.sps-row .sps-name{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sps-row .sps-meta{ font-size:11px; font-weight:700; color:var(--sp-ink-soft); text-align:right; line-height:1.25; }
.sps-stars{ color:var(--sp-gold); font-size:10px; letter-spacing:.5px; }
.sps-price{ color:var(--sp-red); font-weight:900; font-variant-numeric:tabular-nums; min-width:42px; text-align:right; }

.sps-step{
  width:24px; height:24px; flex:0 0 24px; border-radius:8px; cursor:pointer;
  font-family:inherit; font-weight:900; font-size:14px; line-height:1;
  border:1.5px solid rgba(59,47,38,.16); background:linear-gradient(180deg,#fff8ea,#f1e0be);
  color:var(--sp-ink);
}
.sps-step:hover{ border-color:var(--sp-red); }
.sps-step[disabled]{ opacity:.35; cursor:not-allowed; }
.sps-step:focus-visible{ outline:2px solid var(--sp-red); outline-offset:2px; }
.sps-num{ min-width:22px; text-align:center; font-variant-numeric:tabular-nums; }

.sps-side{
  background:rgba(255,255,255,.55); border:1.5px solid rgba(59,47,38,.1);
  border-radius:14px; padding:10px; display:flex; flex-direction:column; gap:8px; min-height:0;
}
.sps-total{ display:flex; align-items:baseline; gap:8px; font-size:15px; }
.sps-total b{ color:var(--sp-red); font-size:19px; font-variant-numeric:tabular-nums; }
.sps-note{ font-size:11px; font-weight:700; color:var(--sp-ink-soft); line-height:1.4; }
.sps-note.sps-warn{ color:var(--sp-red); }
.sps-tier{
  background:rgba(240,185,63,.12); border:1.5px solid rgba(240,185,63,.4);
  border-radius:12px; padding:7px 9px; font-size:11.5px; font-weight:700; line-height:1.45;
}
.sps-tier b{ color:var(--sp-ink); }
.sps-empty{ padding:18px 6px; text-align:center; color:var(--sp-ink-soft); font-size:12px; }
@media (max-width:860px){ .sps-body{ grid-template-columns:1fr 210px; } }
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
function stars(q) {
  const n = Math.max(0, Math.min(5, Math.round(clamp01(q) * 5)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

export function createSupplierUI(game) {
  styleOnce();

  const id = 'supplier';
  const state = game.state;
  const offs = [];

  /** `${supplierId}|${day}` -> { ingredientId: soldUnits } */
  const soldToday = Object.create(null);

  const p = panel({
    id: 'sp-panel-supplier',
    title: 'Supplier',
    sub: '',
    pos: {
      left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
      width: 'min(820px, 94vw)', height: 'min(560px, 86vh)',
    },
    onClose: () => game.panels.close(id),
  });
  p.root.setAttribute('role', 'dialog');
  p.root.setAttribute('aria-label', 'Supplier');

  const body = el('div', 'sps-body');
  const left = el('div', 'sps-col');
  const shelfHead = el('div', 'sps-h', 'On the table');
  const shelf = el('div', 'sps-scroll');
  left.append(shelfHead, shelf);

  const side = el('div', 'sps-side');
  const tierBox = el('div', 'sps-tier');
  const basketHead = el('div', 'sps-h', 'Basket');
  const basketList = el('div', 'sps-scroll');
  const totalRow = el('div', 'sps-total');
  const totalVal = el('b', null, '0¢');
  totalRow.append(el('span', null, 'Total'), totalVal);
  const noteRow = el('div', 'sps-note', '');
  const buyBtn = button('Buy', { cls: 'sp-primary', icon: '🧾' });
  const clearBtn = button('Clear', { cls: 'sp-ghost' });
  const btnRow = el('div', 'sp-row');
  btnRow.append(buyBtn, clearBtn);
  side.append(tierBox, basketHead, basketList, totalRow, noteRow, btnRow);

  body.append(left, side);
  p.body.append(body);

  let open = false;
  let sup = null;
  /** ingredientId -> qty in basket */
  let basket = Object.create(null);

  function dayKey() {
    const day = (game.clock && game.clock.day) || (state.clock && state.clock.day) || 1;
    return `${sup ? sup.id : '?'}|${day}`;
  }

  function soldMap() {
    const k = dayKey();
    if (!soldToday[k]) soldToday[k] = Object.create(null);
    return soldToday[k];
  }

  function relLevel() {
    if (!sup || !sup.npc) return 0;
    return (typeof state.relationship === 'function' && state.relationship(sup.npc)) || 0;
  }

  function remaining(row) {
    const sold = soldMap()[row.id] || 0;
    return Math.max(0, (row.qty || 0) - sold);
  }

  function basketCount() {
    let n = 0;
    for (const k in basket) n += basket[k];
    return n;
  }

  function basketTotal() {
    const rel = relLevel();
    let t = 0;
    for (const k in basket) {
      const price = priceFor(sup, k, rel);
      t += (price || 0) * basket[k];
    }
    return t;
  }

  // ---------------------------------------------------------------- shelf
  function renderShelf() {
    shelf.textContent = '';
    if (!sup) return;
    const rel = relLevel();
    const rows = stockFor(sup, rel);
    if (!rows.length) { shelf.append(el('div', 'sps-empty', 'Nothing on the table today.')); return; }

    for (const row of rows) {
      const ing = ingredient(row.id);
      const left0 = remaining(row);
      const inBasket = basket[row.id] || 0;
      const node = el('div', 'sps-row');
      if (left0 - inBasket <= 0) node.classList.add('sps-out');

      node.append(el('span', 'sps-ico', (ing && ing.icon) || '📦'));

      const nameCol = el('div', 'sps-name');
      nameCol.append(el('div', null, (ing && ing.name) || row.id));
      nameCol.append(el('div', 'sps-stars', stars(ing ? ing.quality : 0.7)));
      node.append(nameCol);

      const meta = el('div', 'sps-meta');
      meta.textContent = `${Math.max(0, left0 - inBasket)} left`;
      node.append(meta);
      node.append(el('span', 'sps-price', money(row.price || 0)));

      const minus = el('button', 'sps-step', '−');
      minus.type = 'button';
      minus.setAttribute('aria-label', `Remove one ${(ing && ing.name) || row.id}`);
      minus.disabled = inBasket <= 0;
      minus.addEventListener('click', () => { setQty(row.id, inBasket - 1, left0); });

      const num = el('span', 'sps-num', String(inBasket));

      const plus = el('button', 'sps-step', '+');
      plus.type = 'button';
      plus.setAttribute('aria-label', `Add one ${(ing && ing.name) || row.id}`);
      plus.disabled = inBasket >= left0;
      plus.addEventListener('click', () => { setQty(row.id, inBasket + 1, left0); });

      node.append(minus, num, plus);
      shelf.append(node);
    }
  }

  function setQty(ingId, qty, max) {
    const q = Math.max(0, Math.min(max, Math.floor(qty)));
    if (q <= 0) delete basket[ingId]; else basket[ingId] = q;
    renderShelf();
    renderBasket();
  }

  // --------------------------------------------------------------- basket
  function renderBasket() {
    basketList.textContent = '';
    const keys = Object.keys(basket);
    if (!keys.length) {
      basketList.append(el('div', 'sps-empty', 'Nothing picked yet.'));
    } else {
      const rel = relLevel();
      for (const k of keys) {
        const ing = ingredient(k);
        const price = priceFor(sup, k, rel) || 0;
        const row = el('div', 'sps-row');
        row.append(el('span', 'sps-ico', (ing && ing.icon) || '📦'));
        row.append(el('span', 'sps-name', `${(ing && ing.name) || k} ×${basket[k]}`));
        row.append(el('span', 'sps-price', money(price * basket[k])));
        basketList.append(row);
      }
    }

    const total = basketTotal();
    const count = basketCount();
    totalVal.textContent = money(total);

    const capacity = typeof state.invCapacity === 'function' ? state.invCapacity() : 0;
    const carried = typeof state.invCount === 'function' ? state.invCount() : 0;
    const room = capacity - carried;
    const afford = state.canAfford ? state.canAfford(total) : state.coins >= total;

    let note = `Basket ${carried}/${capacity} · you have ${money(state.coins)}`;
    let warn = false;
    if (count === 0) { /* neutral */ }
    else if (!afford) { note = `Not enough coins — you have ${money(state.coins)}`; warn = true; }
    else if (count > room) { note = `Basket only has room for ${Math.max(0, room)} more`; warn = true; }
    noteRow.textContent = note;
    noteRow.classList.toggle('sps-warn', warn);

    buyBtn.disabled = count === 0 || !afford || count > room;
    buyBtn.textContent = count ? `🧾 Buy ${count} · ${money(total)}` : '🧾 Buy';
  }

  // ----------------------------------------------------------- tier panel
  function renderTier() {
    tierBox.textContent = '';
    if (!sup) return;
    const rel = relLevel();
    const cur = tierFor(sup, rel);
    const tiers = sup.tiers || [];
    const next = tiers.find((t) => t.at > cur.at) || null;
    const n = sup.npc ? npcById(sup.npc) : null;

    const idx = Math.max(0, tiers.indexOf(cur));
    const head = el('div', null, `${'●'.repeat(idx + 1)}${'○'.repeat(Math.max(0, tiers.length - idx - 1))}  ${n ? n.name : sup.name}`);
    tierBox.append(head);
    tierBox.append(el('div', null,
      `Friendship ${Math.round(rel)}${cur.discount ? ` · ${Math.round(cur.discount * 100)}% off` : ''}${cur.extraStock ? ` · +${cur.extraStock} stock` : ''}`));

    if (next) {
      const unlocks = (next.unlock || []).map((iid) => {
        const ing = ingredient(iid);
        return ing ? `${ing.icon} ${ing.name}` : iid;
      });
      const line = el('div', null, `Next at ${next.at}: ${Math.round(next.discount * 100)}% off, +${next.extraStock} stock`);
      tierBox.append(line);
      if (unlocks.length) tierBox.append(el('div', null, `Unlocks ${unlocks.join(', ')}`));
    } else {
      tierBox.append(el('div', null, 'Best terms in the city. They trust you.'));
    }
  }

  // ------------------------------------------------------------------ buy
  function doBuy() {
    if (!sup || buyBtn.disabled) return;
    const rel = relLevel();
    const lines = Object.keys(basket).map((k) => ({ id: k, qty: basket[k], price: priceFor(sup, k, rel) || 0 }));
    const total = lines.reduce((s, l) => s + l.price * l.qty, 0);
    if (!lines.length) return;
    if (!state.spendCoins(total, `supplier:${sup.id}`)) {
      game.bus.emit(EV.TOAST, { text: 'Not enough coins', icon: '🪙', tone: 'bad' });
      return;
    }

    const sold = soldMap();
    let got = 0;
    for (const l of lines) {
      const ing = ingredient(l.id);
      const quality = Math.min(1, (ing ? ing.quality : 0.7) + rel / 500);
      const taken = state.addItem(l.id, l.qty, { quality, freshness: 1 });
      got += taken;
      sold[l.id] = (sold[l.id] || 0) + taken;
      if (taken > 0) {
        game.bus.emit(EV.INTERACT, { kind: 'purchase', id: l.id, qty: taken, supplierId: sup.id });
      }
    }

    if (sup.npc && typeof state.addRelationship === 'function') {
      state.addRelationship(sup.npc, Math.min(3, 0.5 + total / 200));
    }

    game.bus.emit(EV.TOAST, { text: `Bought ${got} item${got === 1 ? '' : 's'}`, icon: '🧺', tone: 'good' });
    basket = Object.create(null);
    renderShelf(); renderBasket(); renderTier();
  }

  buyBtn.addEventListener('click', doBuy);
  clearBtn.addEventListener('click', () => { basket = Object.create(null); renderShelf(); renderBasket(); });

  offs.push(game.bus.on(EV.COINS, () => { if (open) renderBasket(); }));
  offs.push(game.bus.on(EV.INVENTORY, () => { if (open) renderBasket(); }));

  // ----------------------------------------------------------------- api
  const api = {
    id,
    open(payload) {
      const wanted = payload && (payload.supplierId || payload.id);
      const s = supplier(wanted);
      if (!s) {
        game.bus.emit(EV.TOAST, { text: 'That stall is closed', icon: '🏮', tone: 'bad' });
        return;
      }
      sup = s;
      basket = Object.create(null);

      const hour = (game.clock && game.clock.hour) || (state.clock && state.clock.hour) || 0;
      const openNow = isOpenAt(sup, hour);
      p.setTitle(sup.name, openNow ? sup.blurb || '' : 'Closed right now — the shutters are down.');

      renderTier(); renderShelf(); renderBasket();
      if (!openNow) buyBtn.disabled = true;

      if (!open) { open = true; p.show(); }
    },
    close() {
      if (!open) return;
      open = false;
      basket = Object.create(null);
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
