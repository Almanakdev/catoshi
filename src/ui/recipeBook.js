// The recipe book: master list on the left, full sheet on the right.
//
// Locked recipes stay visible but greyed with the hint that unlocks them —
// seeing what is coming is half the motivation.

import { EV } from '../game/bus.js';
import { injectStyles, el, panel, button, item, money } from './kit.js';
import { RECIPES, STEPS, recipeTime } from '../data/recipes.js';
import { ingredient } from '../data/ingredients.js';
import { QUEST_INDEX } from '../data/quests.js';
import { npc as npcById } from '../data/npcs.js';

const STYLE_ID = 'sp-recipe-style';

const CSS = `
.spr-body{ flex:1; min-height:0; display:grid; grid-template-columns:230px 1fr; gap:12px; }
.spr-list{ min-height:0; overflow:auto; display:flex; flex-direction:column; gap:5px; padding-right:4px; }
.spr-list::-webkit-scrollbar{ width:8px; }
.spr-list::-webkit-scrollbar-thumb{ background:rgba(59,47,38,.2); border-radius:8px; }
.spr-list .sp-item.spr-locked{ opacity:.5; filter:grayscale(.6); }

.spr-detail{
  min-height:0; overflow:auto; background:rgba(255,255,255,.55);
  border:1.5px solid rgba(59,47,38,.1); border-radius:14px; padding:12px 14px;
  display:flex; flex-direction:column; gap:9px;
}
.spr-detail::-webkit-scrollbar{ width:8px; }
.spr-detail::-webkit-scrollbar-thumb{ background:rgba(59,47,38,.2); border-radius:8px; }
.spr-hero{ display:flex; align-items:center; gap:10px; }
.spr-hero .spr-ico{ font-size:38px; line-height:1; }
.spr-hero h3{ font-size:17px; margin:0; }
.spr-desc{ font-size:12px; font-weight:700; color:var(--sp-ink-soft); line-height:1.45; }
.spr-h{ font-size:11px; letter-spacing:.05em; text-transform:uppercase; color:var(--sp-red); }
.spr-need{ display:flex; align-items:center; gap:7px; font-size:12.5px; }
.spr-need .spr-cnt{ margin-left:auto; font-weight:900; font-variant-numeric:tabular-nums; }
.spr-ok{ color:var(--sp-green); }
.spr-no{ color:var(--sp-red); }
.spr-pills{ display:flex; flex-wrap:wrap; gap:6px; }
.spr-pill{
  display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:800;
  background:rgba(255,255,255,.8); border:1.5px solid rgba(59,47,38,.12);
  border-radius:999px; padding:3px 9px;
}
.spr-pill .spr-arrow{ color:var(--sp-ink-soft); }
.spr-stats{ display:flex; flex-wrap:wrap; gap:6px; }
.spr-foot{ margin-top:auto; padding-top:8px; display:flex; align-items:center; gap:8px; }
.spr-hint{ font-size:11.5px; font-weight:700; color:var(--sp-ink-soft); }
.spr-lockbox{
  background:rgba(200,80,63,.08); border:1.5px dashed rgba(200,80,63,.35);
  border-radius:12px; padding:8px 10px; font-size:12px; color:var(--sp-ink-soft);
}
@media (max-width:820px){ .spr-body{ grid-template-columns:180px 1fr; } }
`;

function styleOnce() {
  injectStyles();
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function diffStars(n) {
  const d = Math.max(0, Math.min(5, Math.round(n || 0)));
  return '★'.repeat(d) + '☆'.repeat(5 - d);
}

/** Human sentence for whatever gate is holding a recipe back. */
function unlockHint(u) {
  if (!u || u.free) return 'Known from the start';
  if (u.reputation != null) return `Reach ${u.reputation} reputation`;
  if (u.quest) {
    const q = QUEST_INDEX[u.quest];
    return `Finish “${q ? q.title : u.quest}”`;
  }
  if (u.relationship) {
    const n = npcById(u.relationship.npc);
    return `Befriend ${n ? n.name : u.relationship.npc} (${u.relationship.level})`;
  }
  if (u.discover) return 'Find the page somewhere in the city';
  return 'Locked';
}

function shortHint(u) {
  if (!u || u.free) return '';
  if (u.reputation != null) return `⭐ ${u.reputation}`;
  if (u.quest) return '📜 quest';
  if (u.relationship) return '💛 friend';
  if (u.discover) return '🔍 hidden';
  return '🔒';
}

export function createRecipeBook(game) {
  styleOnce();

  const id = 'recipes';
  const state = game.state;
  const offs = [];

  const p = panel({
    id: 'sp-panel-recipes',
    title: 'Recipe Book',
    sub: '',
    pos: {
      left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
      width: 'min(840px, 94vw)', height: 'min(580px, 86vh)',
    },
    onClose: () => game.panels.close(id),
  });
  p.root.setAttribute('role', 'dialog');
  p.root.setAttribute('aria-label', 'Recipe book');

  const body = el('div', 'spr-body');
  const list = el('div', 'spr-list');
  list.setAttribute('role', 'listbox');
  const detail = el('div', 'spr-detail');
  body.append(list, detail);
  p.body.append(body);

  let open = false;
  let selected = RECIPES.length ? RECIPES[0].id : null;

  // ---------------------------------------------------------------- list
  function renderList() {
    list.textContent = '';
    for (const r of RECIPES) {
      const known = state.knowsRecipe(r.id);
      const cookable = known && state.hasItems(r.ingredients);
      const row = item({
        icon: known ? r.icon : '🔒',
        name: known ? r.name : '???',
        meta: known ? (cookable ? '✔' : `${money(r.basePrice)}`) : shortHint(r.unlock),
        onClick: () => { selected = r.id; renderList(); renderDetail(); },
      });
      if (!known) row.classList.add('spr-locked');
      if (r.id === selected) row.classList.add('sp-sel');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', r.id === selected ? 'true' : 'false');
      if (cookable) row.querySelector('.sp-meta').classList.add('spr-ok');
      list.append(row);
    }
  }

  // -------------------------------------------------------------- detail
  function renderDetail() {
    detail.textContent = '';
    const r = RECIPES.find((x) => x.id === selected);
    if (!r) { detail.append(el('div', 'spr-desc', 'Pick a recipe from the list.')); return; }

    const known = state.knowsRecipe(r.id);

    const hero = el('div', 'spr-hero');
    hero.append(el('span', 'spr-ico', known ? r.icon : '🔒'));
    const heroTxt = el('div', 'sp-col');
    heroTxt.append(el('h3', null, known ? r.name : 'Unknown Recipe'));
    heroTxt.append(el('div', 'spr-hint', `${diffStars(r.difficulty)}  ·  ~${recipeTime(r)}s`));
    hero.append(heroTxt);
    detail.append(hero);

    detail.append(el('div', 'spr-desc', known ? r.desc : 'You have not learned this one yet.'));

    if (!known) {
      detail.append(el('div', 'spr-lockbox', `🔒 ${unlockHint(r.unlock)}`));
    }

    // Ingredients checklist
    detail.append(el('div', 'spr-h', 'Ingredients'));
    const needs = el('div', 'sp-col');
    let allHave = true;
    for (const need of r.ingredients) {
      const ing = ingredient(need.id);
      const have = state.countItem(need.id);
      const want = need.qty || 1;
      const ok = have >= want;
      if (!ok) allHave = false;
      const row = el('div', 'spr-need');
      row.append(el('span', null, (ing && ing.icon) || '📦'));
      row.append(el('span', null, (ing && ing.name) || need.id));
      const cnt = el('span', `spr-cnt ${ok ? 'spr-ok' : 'spr-no'}`, `${have}/${want}`);
      row.append(cnt);
      needs.append(row);
    }
    detail.append(needs);

    // Step chain
    detail.append(el('div', 'spr-h', 'Steps'));
    const pills = el('div', 'spr-pills');
    r.steps.forEach((sid, i) => {
      const st = STEPS[sid];
      if (i) pills.append(el('span', 'spr-arrow', '→'));
      const pill = el('span', 'spr-pill');
      pill.append(el('span', null, (st && st.icon) || '•'));
      pill.append(el('span', null, (st && st.label) || sid));
      pills.append(pill);
    });
    detail.append(pills);

    // Payoff
    detail.append(el('div', 'spr-h', 'Payoff'));
    const stats = el('div', 'spr-stats');
    stats.append(el('span', 'sp-badge', `💰 ${money(r.basePrice)}`));
    stats.append(el('span', 'sp-badge', `⭐ +${r.rep}`));
    stats.append(el('span', 'sp-badge', `🍣 ${r.xp} xp`));
    detail.append(stats);

    // Action
    const foot = el('div', 'spr-foot');
    const cookable = known && allHave;
    const btn = button('Cook this', {
      cls: 'sp-primary',
      icon: '🔪',
      onClick: () => {
        if (!cookable) return;
        const cooking = game.cooking;
        game.panels.close(id);
        if (cooking && typeof cooking.start === 'function') {
          try { cooking.start(r.id); } catch (err) { console.error('[recipeBook] cooking.start threw', err); }
        } else {
          game.bus.emit(EV.TOAST, { text: 'The kitchen is not ready yet', icon: '🍳', tone: 'bad' });
        }
      },
    });
    btn.disabled = !cookable;
    foot.append(btn);
    foot.append(el('span', 'spr-hint', !known
      ? unlockHint(r.unlock)
      : (allHave ? 'Everything is in the basket.' : 'Missing ingredients.')));
    detail.append(foot);
  }

  function refresh() { if (!open) return; renderList(); renderDetail(); }

  offs.push(game.bus.on(EV.INVENTORY, refresh));
  offs.push(game.bus.on(EV.RECIPE_UNLOCKED, refresh));
  offs.push(game.bus.on(EV.REPUTATION, refresh));

  // ----------------------------------------------------------------- api
  const api = {
    id,
    open(payload) {
      if (payload && payload.recipeId && RECIPES.some((r) => r.id === payload.recipeId)) {
        selected = payload.recipeId;
      }
      if (open) { refresh(); return; }
      open = true;
      const known = RECIPES.filter((r) => state.knowsRecipe(r.id)).length;
      p.setTitle('Recipe Book', `${known}/${RECIPES.length} learned`);
      renderList(); renderDetail();
      p.show();
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
