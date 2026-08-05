// The district map.
//
// One 2D canvas, redrawn from the authored city data (ROADS + DISTRICTS) plus
// whatever the live world hands us (player transform, POIs). Locked districts
// are drawn flat grey with the thing that opens them printed underneath.
//
// Clicking a POI sets it as the waypoint, which is what the HUD compass reads.

import { EV } from '../game/bus.js';
import { injectStyles, el, panel, button, THEME } from './kit.js';
import { DISTRICTS, ROADS, HOME } from '../data/districts.js';
import { SUPPLIERS } from '../data/suppliers.js';
import { QUEST_INDEX } from '../data/quests.js';
import { SHOP_TIERS } from '../data/progression.js';

const STYLE_ID = 'sp-map-style';

const CSS = `
.spm-body{ flex:1; min-height:0; display:flex; flex-direction:column; gap:8px; }
.spm-canvaswrap{
  flex:1; min-height:0; position:relative; border-radius:14px; overflow:hidden;
  border:1.5px solid rgba(59,47,38,.14); background:#f0e3c6;
}
.spm-canvaswrap canvas{ display:block; width:100%; height:100%; cursor:crosshair; }
.spm-foot{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.spm-wp{ flex:1; min-width:0; font-size:12px; font-weight:800; color:var(--sp-ink-soft);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.spm-legend{ display:flex; gap:8px; flex-wrap:wrap; font-size:11px; font-weight:700; color:var(--sp-ink-soft); }
.spm-key{ display:inline-flex; align-items:center; gap:4px; }
.spm-swatch{ width:10px; height:10px; border-radius:3px; display:inline-block; }
`;

function styleOnce() {
  injectStyles();
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

/** Readable sentence for a district's unlock gate. */
function unlockText(d) {
  const u = d.unlock || {};
  if (u.free) return '';
  const bits = [];
  if (u.reputation) bits.push(`⭐ ${u.reputation}`);
  if (u.quest) { const q = QUEST_INDEX[u.quest]; bits.push(`“${q ? q.title : u.quest}”`); }
  if (u.shopTier) {
    const t = SHOP_TIERS.find((x) => x.tier === u.shopTier);
    bits.push(t ? t.name : `Tier ${u.shopTier}`);
  }
  return bits.join(' · ');
}

/** Fallback POI set so the map is useful before world.js exists. */
function fallbackPois() {
  const out = [
    { id: 'home_shop', x: HOME.shop.x, z: HOME.shop.z, label: 'Your Shop', icon: '🏮', district: 'old_market' },
  ];
  for (const s of SUPPLIERS) {
    out.push({ id: s.id, x: s.x, z: s.z, label: s.name, icon: s.icon, district: s.district });
  }
  for (const d of DISTRICTS) {
    if (d.gate) out.push({ id: `gate_${d.id}`, x: d.gate.x, z: d.gate.z, label: `${d.name} gate`, icon: '🚩', district: d.id });
  }
  return out;
}

export function createMapUI(game) {
  styleOnce();

  const id = 'map';
  const state = game.state;
  const offs = [];

  const p = panel({
    id: 'sp-panel-map',
    title: 'City Map',
    sub: '',
    pos: {
      left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
      width: 'min(880px, 94vw)', height: 'min(620px, 90vh)',
    },
    onClose: () => game.panels.close(id),
  });
  p.root.setAttribute('role', 'dialog');
  p.root.setAttribute('aria-label', 'City map');

  const body = el('div', 'spm-body');
  const wrap = el('div', 'spm-canvaswrap');
  const cvs = el('canvas');
  cvs.tabIndex = 0;
  cvs.setAttribute('role', 'img');
  cvs.setAttribute('aria-label', 'Map of the city. Click a point of interest to set a waypoint.');
  wrap.append(cvs);

  const foot = el('div', 'spm-foot');
  const wpText = el('div', 'spm-wp', 'No waypoint set — click a marker.');
  const clearBtn = button('Clear waypoint', { cls: 'sp-ghost', icon: '✖' });
  clearBtn.addEventListener('click', () => {
    if (game.world && typeof game.world.setWaypoint === 'function') game.world.setWaypoint(null);
    paintFoot();
    draw();
  });
  const legend = el('div', 'spm-legend');
  for (const [c, label] of [[THEME.green, 'Open'], ['#9a9186', 'Locked'], [THEME.red, 'You'], [THEME.gold, 'Waypoint']]) {
    const k = el('span', 'spm-key');
    const sw = el('span', 'spm-swatch'); sw.style.background = c;
    k.append(sw, el('span', null, label));
    legend.append(k);
  }
  foot.append(wpText, legend, clearBtn);

  body.append(wrap, foot);
  p.body.append(body);

  const ctx = cvs.getContext('2d');
  let open = false;
  let acc = 0;

  // ------------------------------------------------------------- geometry
  const bounds = (() => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const d of DISTRICTS) {
      minX = Math.min(minX, d.center.x - d.half.x); maxX = Math.max(maxX, d.center.x + d.half.x);
      minZ = Math.min(minZ, d.center.z - d.half.z); maxZ = Math.max(maxZ, d.center.z + d.half.z);
    }
    for (const r of ROADS) {
      minX = Math.min(minX, r.x - r.w / 2); maxX = Math.max(maxX, r.x + r.w / 2);
      minZ = Math.min(minZ, r.z - r.d / 2); maxZ = Math.max(maxZ, r.z + r.d / 2);
    }
    const pad = 16;
    return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
  })();

  let view = { scale: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };

  /** [{poi, px, py, unlocked}] in canvas pixels, rebuilt on every draw. */
  const hit = [];

  function fit() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.max(80, wrap.clientWidth);
    const ch = Math.max(80, wrap.clientHeight);
    cvs.width = Math.round(cw * dpr);
    cvs.height = Math.round(ch * dpr);
    const worldW = bounds.maxX - bounds.minX;
    const worldH = bounds.maxZ - bounds.minZ;
    const scale = Math.min(cvs.width / worldW, cvs.height / worldH);
    view = {
      scale,
      ox: (cvs.width - worldW * scale) / 2 - bounds.minX * scale,
      oy: (cvs.height - worldH * scale) / 2 - bounds.minZ * scale,
      w: cvs.width, h: cvs.height, dpr,
    };
  }

  const mx = (x) => x * view.scale + view.ox;
  const my = (z) => z * view.scale + view.oy;

  function pois() {
    const list = game.world && Array.isArray(game.world.pois) ? game.world.pois : null;
    return (list && list.length) ? list : fallbackPois();
  }

  // ---------------------------------------------------------------- draw
  function draw() {
    if (!ctx) return;
    fit();
    const s = view.scale;
    ctx.clearRect(0, 0, view.w, view.h);

    // paper
    ctx.fillStyle = '#f3e7cb';
    ctx.fillRect(0, 0, view.w, view.h);

    // districts
    for (const d of DISTRICTS) {
      const unlocked = state.districtUnlocked(d.id);
      const x0 = mx(d.center.x - d.half.x), y0 = my(d.center.z - d.half.z);
      const w = d.half.x * 2 * s, h = d.half.z * 2 * s;
      ctx.save();
      roundRect(ctx, x0, y0, w, h, 10 * view.dpr);
      ctx.fillStyle = unlocked ? d.ground : '#cdc6ba';
      ctx.globalAlpha = unlocked ? 1 : 0.75;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2 * view.dpr;
      ctx.strokeStyle = unlocked ? d.accent : 'rgba(80,72,64,.35)';
      ctx.stroke();
      ctx.restore();

      // label
      const cxp = mx(d.center.x), cyp = my(d.center.z - d.half.z) + 18 * view.dpr;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = unlocked ? 'rgba(59,47,38,.86)' : 'rgba(59,47,38,.5)';
      ctx.font = `800 ${13 * view.dpr}px "Quicksand", system-ui, sans-serif`;
      ctx.fillText(`${d.icon} ${d.name}`, cxp, cyp);
      if (!unlocked) {
        const req = unlockText(d);
        ctx.font = `700 ${11 * view.dpr}px "Quicksand", system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(59,47,38,.55)';
        ctx.fillText(`🔒 ${req || 'Locked'}`, cxp, cyp + 16 * view.dpr);
      }
    }

    // roads
    ctx.fillStyle = 'rgba(120,108,94,.34)';
    for (const r of ROADS) {
      ctx.fillRect(mx(r.x - r.w / 2), my(r.z - r.d / 2), r.w * s, r.d * s);
    }

    // waypoint marker
    const wp = game.world && game.world.waypoint;
    if (wp && typeof wp.x === 'number') {
      const wx = mx(wp.x), wy = my(wp.z);
      ctx.beginPath();
      ctx.arc(wx, wy, 9 * view.dpr, 0, Math.PI * 2);
      ctx.fillStyle = THEME.gold;
      ctx.fill();
      ctx.lineWidth = 2 * view.dpr;
      ctx.strokeStyle = 'rgba(59,47,38,.55)';
      ctx.stroke();
    }

    // POIs
    hit.length = 0;
    for (const poi of pois()) {
      if (typeof poi.x !== 'number') continue;
      const unlocked = !poi.district || state.districtUnlocked(poi.district);
      const px = mx(poi.x), py = my(poi.z);
      hit.push({ poi, px, py, unlocked });
      ctx.beginPath();
      ctx.arc(px, py, 6 * view.dpr, 0, Math.PI * 2);
      ctx.fillStyle = unlocked ? '#fff8ec' : 'rgba(255,248,236,.5)';
      ctx.fill();
      ctx.lineWidth = 2 * view.dpr;
      ctx.strokeStyle = unlocked ? THEME.red : 'rgba(90,82,74,.5)';
      ctx.stroke();
      if (poi.icon) {
        ctx.font = `${11 * view.dpr}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.globalAlpha = unlocked ? 1 : 0.45;
        ctx.fillText(poi.icon, px, py + 0.5 * view.dpr);
        ctx.globalAlpha = 1;
      }
    }

    // player
    const pos = game.player && game.player.position;
    if (pos) {
      const yaw = (game.player && typeof game.player.yaw === 'number') ? game.player.yaw : 0;
      const px = mx(pos.x), py = my(pos.z);
      ctx.save();
      ctx.translate(px, py);
      // world forward at yaw 0 is +Z, which is DOWN on this map
      ctx.rotate(Math.PI - yaw);
      ctx.beginPath();
      ctx.moveTo(0, -10 * view.dpr);
      ctx.lineTo(7 * view.dpr, 8 * view.dpr);
      ctx.lineTo(0, 3.5 * view.dpr);
      ctx.lineTo(-7 * view.dpr, 8 * view.dpr);
      ctx.closePath();
      ctx.fillStyle = THEME.red;
      ctx.fill();
      ctx.lineWidth = 2 * view.dpr;
      ctx.strokeStyle = '#fff8ec';
      ctx.stroke();
      ctx.restore();
    }
  }

  function roundRect(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  // --------------------------------------------------------------- input
  function onClick(ev) {
    const rect = cvs.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const cx = (ev.clientX - rect.left) * (cvs.width / rect.width);
    const cy = (ev.clientY - rect.top) * (cvs.height / rect.height);

    let best = null, bestD = Infinity;
    const reach = 16 * (view.dpr || 1);
    for (const h of hit) {
      const d = Math.hypot(h.px - cx, h.py - cy);
      if (d < bestD && d <= reach) { bestD = d; best = h; }
    }
    if (!best) return;
    if (!best.unlocked) {
      game.bus.emit(EV.TOAST, { text: 'That part of the city is still closed', icon: '🔒', tone: 'bad' });
      return;
    }
    const poi = best.poi;
    if (game.world && typeof game.world.setWaypoint === 'function') {
      game.world.setWaypoint({ x: poi.x, z: poi.z, label: poi.label || poi.id, id: poi.id });
    }
    game.bus.emit(EV.TOAST, { text: `Waypoint: ${poi.label || poi.id}`, icon: '📍' });
    paintFoot();
    draw();
  }
  cvs.addEventListener('click', onClick);

  function onResize() { if (open) draw(); }
  window.addEventListener('resize', onResize);

  function paintFoot() {
    const wp = game.world && game.world.waypoint;
    wpText.textContent = wp && wp.label
      ? `📍 Heading for ${wp.label}`
      : (wp ? '📍 Waypoint set' : 'No waypoint set — click a marker.');
    clearBtn.disabled = !wp;
  }

  offs.push(game.bus.on(EV.DISTRICT_UNLOCK, () => { if (open) draw(); }));

  // ----------------------------------------------------------------- api
  const api = {
    id,
    open() {
      if (open) return;
      open = true;
      const unlocked = DISTRICTS.filter((d) => state.districtUnlocked(d.id)).length;
      p.setTitle('City Map', `${unlocked}/${DISTRICTS.length} districts open`);
      p.show();
      paintFoot();
      // The panel must be visible before the canvas has a size to fit into.
      requestAnimationFrame(draw);
    },
    close() {
      if (!open) return;
      open = false;
      p.hide();
    },
    get isOpen() { return open; },
    update(dt) {
      if (!open) return;
      acc += Number(dt) || 0;
      if (acc < 1 / 12) return;
      acc = 0;
      draw();
    },
    destroy() {
      for (const un of offs) { try { un(); } catch { /* ignore */ } }
      offs.length = 0;
      cvs.removeEventListener('click', onClick);
      window.removeEventListener('resize', onResize);
      p.destroy();
    },
  };

  game.panels.register(id, api);
  return api;
}
