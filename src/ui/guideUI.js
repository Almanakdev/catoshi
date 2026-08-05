// The visible half of the guidance layer.
//
// Four pieces, all fed from one source of truth (src/game/guide.js):
//
//   a) the NEXT banner   — top centre, tucked under the clock
//   b) a ground arrow trail — six flat chevrons on the road in front of the cat
//   c) NPC head markers  — ! quest to give, ? quest to hand in, 💬 your target
//   d) a destination pin — a bobbing diamond on a slim beam over the target
//
// Budget: one InstancedMesh for the whole trail, one pooled sprite per visible
// marker (hard cap 12), two meshes for the pin. Nothing is allocated per frame.
//
// NOTE on the post stack: main.js renders a depth prepass for the ink outline.
// Sprites and Points must not be in it, so the marker group is exposed as `fx`
// and main.js hides it for that pass. Everything else here follows the world
// module's own rule for overlay geometry — MeshBasicMaterial, depthWrite off,
// toneMapped off, negative polygon offset so it sits on top of the road.

import { EV } from '../game/bus.js';
import { injectStyles, el, THEME } from './kit.js';

const STYLE_ID = 'sp-guide-style';

const CSS = `
/* The banner is centred by LAYOUT, not by a transform: the wrapper reserves the
   space the HUD's own top-left stats card and top-right compass occupy (both of
   which grow with --sp-scale from their outer corners), and the banner is a flex
   child clamped to whatever is left. That way no width or UI scale can ever slide
   it under a card, and the pop animation is free to own "transform" outright. */
.spgd-wrap{
  position:fixed; left:0; right:0; top:58px; z-index:13;
  display:flex; justify-content:center;
  /* 12px card margin + 196px card + 14px breathing room, all scaled. */
  padding:0 calc(26px + 196px * var(--sp-scale,1));
  box-sizing:border-box;
  pointer-events:none;
}
.spgd-banner{
  position:relative;
  transform:scale(var(--sp-scale,1)); transform-origin:top center;
  display:flex; align-items:center; gap:11px;
  /* 100% is the layout width of the free space; the banner is drawn "scale"
     times bigger than it lays out, so divide before clamping. */
  min-width:0; max-width:min(520px, calc(100% / var(--sp-scale,1)));
  padding:9px 14px;
  font-family:"Hiragino Maru Gothic ProN","Quicksand",ui-rounded,"Nunito",system-ui,sans-serif;
  font-weight:800; color:var(--sp-ink);
  background:linear-gradient(180deg,rgba(251,243,226,.96),rgba(242,228,200,.96));
  border:2px solid rgba(59,47,38,.16); border-radius:16px;
  box-shadow:0 6px 18px var(--sp-shadow), inset 0 1px 0 rgba(255,255,255,.6);
  pointer-events:none;
  transition:opacity .2s ease, padding .18s ease, gap .18s ease;
}
.spgd-banner.spgd-off{ opacity:0; }
/* Deliberately NOT kit's sp-pop: that one lands on transform:none, which with
   fill-mode "both" would wipe out the scale (and, before the wrapper existed,
   the centring) for good. */
.spgd-banner.spgd-pop{ animation:spgd-pop .32s cubic-bezier(.2,1.5,.5,1) both; }
@keyframes spgd-pop{
  from{ transform:translateY(9px) scale(calc(var(--sp-scale,1) * .92)); opacity:0; }
  to{ transform:translateY(0) scale(var(--sp-scale,1)); opacity:1; }
}

.spgd-ico{ font-size:22px; width:26px; text-align:center; flex:0 0 26px; line-height:1; }
.spgd-mid{ flex:1; min-width:0; }
.spgd-kicker{
  display:flex; align-items:center; gap:8px;
  font-size:10.5px; letter-spacing:.14em; text-transform:uppercase; color:var(--sp-red);
}
.spgd-step{ color:var(--sp-ink-soft); letter-spacing:.06em; }
.spgd-skip{
  pointer-events:auto; cursor:pointer; font:inherit; font-size:10px; letter-spacing:.06em;
  border:0; background:none; padding:0; color:var(--sp-ink-soft); text-decoration:underline;
  text-transform:none;
}
.spgd-skip:hover{ color:var(--sp-red); }
.spgd-skip.spgd-gone{ display:none; }
.spgd-title{
  font-size:17px; line-height:1.2; margin-top:1px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.spgd-hint{
  font-size:11.5px; font-weight:700; color:var(--sp-ink-soft); line-height:1.3; margin-top:2px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.spgd-nav{ display:flex; flex-direction:column; align-items:center; gap:1px; flex:0 0 auto; min-width:44px; }
.spgd-arrow{ font-size:17px; line-height:1; color:var(--sp-red); transition:transform .1s linear; }
.spgd-dist{ font-size:11px; color:var(--sp-ink-soft); font-variant-numeric:tabular-nums; }

/* Arrived: stop shouting and shrink to a slim pill. */
.spgd-banner.spgd-near{ padding:5px 12px; gap:8px; border-radius:999px; }
.spgd-banner.spgd-near .spgd-hint,
.spgd-banner.spgd-near .spgd-kicker,
.spgd-banner.spgd-near .spgd-arrow{ display:none; }
.spgd-banner.spgd-near .spgd-title{ font-size:13px; }
.spgd-banner.spgd-near .spgd-ico{ font-size:16px; width:18px; flex:0 0 18px; }

.spgd-check{
  position:absolute; left:50%; top:50%; transform:translate(-50%,-50%) scale(.6);
  font-size:34px; opacity:0; pointer-events:none; color:var(--sp-green);
  text-shadow:0 2px 6px rgba(59,47,38,.35);
}
.spgd-check.spgd-on{ animation:spgd-tick .9s ease-out both; }
@keyframes spgd-tick{
  0%{ opacity:0; transform:translate(-50%,-50%) scale(.5); }
  25%{ opacity:1; transform:translate(-50%,-50%) scale(1.15); }
  70%{ opacity:1; transform:translate(-50%,-70%) scale(1); }
  100%{ opacity:0; transform:translate(-50%,-110%) scale(1); }
}

@media (max-width:960px){
  /* The HUD narrows its cards to 172px at this breakpoint, so give the space back. */
  .spgd-wrap{ padding:0 calc(26px + 172px * var(--sp-scale,1)); }
  /* Small window AND a large UI scale is the one combination where the free
     space genuinely cannot hold a 40-character hint on one line. Let it wrap
     rather than swallow the end of the sentence; at the default scale every
     hint still fits on one line, so nothing moves. */
  .spgd-hint,
  .spgd-title{ white-space:normal; overflow:visible; }
}
@media (max-width:820px){
  .spgd-wrap{ top:52px; }
  .spgd-title{ font-size:15px; }
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

/** Step icon + pin colour, per objective kind. */
const KIND_LOOK = {
  tutorial: { icon: '🎓', color: 0xf0b93f },
  talk:     { icon: '💬', color: 0x5f97b8 },
  turnin:   { icon: '🏅', color: 0xf0b93f },
  visit:    { icon: '🚩', color: 0x7ea36a },
  purchase: { icon: '🧺', color: 0xe08a5a },
  collect:  { icon: '🌿', color: 0x7ea36a },
  cook:     { icon: '🔪', color: 0xc8503f },
  serve:    { icon: '🍣', color: 0xc8503f },
  fish:     { icon: '🎣', color: 0x4e8fa8 },
  deliver:  { icon: '📦', color: 0xa3764c },
  shop:     { icon: '🏮', color: 0xc8503f },
  sleep:    { icon: '🛏️', color: 0x6a7ac8 },
  earn:     { icon: '🪙', color: 0xf0b93f },
};

const MARKER_POOL = 12;
const MARKER_DIST = 40;
const TRAIL_COUNT = 6;
const TRAIL_HIDE_DIST = 4;
/**
 * Chevrons are pitched up out of the ground plane toward the player instead of
 * lying dead flat. The chase camera sits about 1.5 units up and 9 back, so a
 * flat decal projects to a couple of pixels of streak; leaning it back presents
 * the face to the viewer while the bottom edge still reads as touching the road.
 */
const TRAIL_PITCH = -0.92;
const TRAIL_LIFT = 0.3;
const NEAR_DIST = 6;

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------- textures
function glyphTexture(T, glyph, fill, ring) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.beginPath(); g.arc(64, 64, 50, 0, Math.PI * 2);
  g.fillStyle = 'rgba(251,243,226,.94)'; g.fill();
  g.lineWidth = 8; g.strokeStyle = ring; g.stroke();
  g.font = '900 74px "Hiragino Maru Gothic ProN", Quicksand, system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = fill;
  g.fillText(glyph, 64, 70);
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace || tex.colorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** The little speech bubble that says "this one, right here". */
function bubbleTexture(T) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  const r = 22, x = 14, y = 22, w = 100, h = 60;
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  g.fillStyle = 'rgba(251,243,226,.95)'; g.fill();
  g.lineWidth = 6; g.strokeStyle = THEME.red; g.stroke();
  g.beginPath();
  g.moveTo(56, y + h - 2); g.lineTo(64, y + h + 18); g.lineTo(74, y + h - 2);
  g.closePath(); g.fillStyle = 'rgba(251,243,226,.95)'; g.fill();
  g.font = '900 40px "Hiragino Maru Gothic ProN", Quicksand, system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = THEME.red;
  g.fillText('•••', 64, y + h / 2 + 2);
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace || tex.colorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** One flat chevron, lying in the XZ plane and pointing along +Z. */
function chevronGeometry(T) {
  const s = new T.Shape();
  s.moveTo(0, 0.46);
  s.lineTo(0.52, -0.16);
  s.lineTo(0.52, -0.50);
  s.lineTo(0, 0.12);
  s.lineTo(-0.52, -0.50);
  s.lineTo(-0.52, -0.16);
  s.closePath();
  const g = new T.ShapeGeometry(s, 2);
  g.rotateX(-Math.PI / 2);   // lie flat; local +Y becomes -Z
  g.rotateY(Math.PI);        // …so spin it round to point along +Z
  return g;
}

// ---------------------------------------------------------------------------
export function createGuideUI(game, guide) {
  styleOnce();
  const T = (game && game.THREE) || null;
  const bus = game && game.bus;

  const offs = [];
  let disposed = false;
  let panelsOpen = 0;
  let clock = 0;
  let markerAcc = 0;
  let bannerAcc = 0;
  let lastId = null;

  // ==========================================================================
  // a) THE BANNER
  // ==========================================================================
  const wrap = el('div', 'spgd-wrap');
  const root = el('div', 'spgd-banner spgd-off');
  root.setAttribute('aria-live', 'polite');
  const bIcon = el('div', 'spgd-ico', '🎯');
  const mid = el('div', 'spgd-mid');
  const kicker = el('div', 'spgd-kicker');
  const kickerLabel = el('span', null, 'Next');
  const kickerStep = el('span', 'spgd-step', '');
  const skipBtn = el('button', 'spgd-skip spgd-gone', 'Skip tutorial');
  skipBtn.type = 'button';
  skipBtn.addEventListener('click', () => {
    try { if (game.tutorial && typeof game.tutorial.skip === 'function') game.tutorial.skip(); }
    catch (err) { console.warn('[guideUI] skip failed', err); }
    paint();
  });
  kicker.append(kickerLabel, kickerStep, skipBtn);
  const bTitle = el('div', 'spgd-title', '');
  const bHint = el('div', 'spgd-hint', '');
  mid.append(kicker, bTitle, bHint);
  const nav = el('div', 'spgd-nav');
  const bArrow = el('div', 'spgd-arrow', '➤');
  const bDist = el('div', 'spgd-dist', '');
  nav.append(bArrow, bDist);
  const check = el('div', 'spgd-check', '✓');
  root.append(bIcon, mid, nav, check);
  wrap.append(root);
  document.body.append(wrap);

  function flashDone() {
    check.classList.remove('spgd-on');
    // Force a reflow so the animation restarts even on back-to-back objectives.
    void check.offsetWidth;
    check.classList.add('spgd-on');
  }

  function hiddenMode() {
    const m = game.mode;
    return m === 'cutscene' || m === 'cooking' || m === 'fishing' || m === 'dialogue' || m === 'boot';
  }

  function paint() {
    const cur = guide && guide.current;
    if (!cur || hiddenMode() || panelsOpen > 0) {
      root.classList.add('spgd-off');
      return;
    }
    root.classList.remove('spgd-off');

    const look = KIND_LOOK[cur.kind] || KIND_LOOK.visit;
    bIcon.textContent = look.icon;
    bTitle.textContent = cur.title || '';
    bHint.textContent = cur.hint || '';

    // Tutorial steps carry a "3/9" counter and the skip link.
    let tut = null;
    try { tut = game.tutorial && game.tutorial.active ? game.tutorial.guideStep() : null; }
    catch { tut = null; }
    if (tut) {
      kickerStep.textContent = `· ${tut.index + 1}/${tut.count}`;
      skipBtn.classList.remove('spgd-gone');
    } else {
      kickerStep.textContent = '';
      skipBtn.classList.add('spgd-gone');
    }

    const d = num(cur.distance, Infinity);
    const near = cur.target && d < NEAR_DIST;
    root.classList.toggle('spgd-near', !!near);
    bDist.textContent = cur.target && Number.isFinite(d) ? `${Math.round(d)} m` : '';

    if (cur.target) {
      const p = game.player && game.player.position;
      const yaw = num(game.player && game.player.yaw, 0);
      if (p) {
        const rel = Math.atan2(cur.target.x - num(p.x), cur.target.z - num(p.z)) - yaw;
        bArrow.style.transform = `rotate(${rel}rad)`;
      }
    }
  }

  // ==========================================================================
  // 3D: the trail, the markers and the pin
  // ==========================================================================
  const group = T ? new T.Group() : null;      // depth-safe geometry
  const fx = T ? new T.Group() : null;         // sprites — hidden in the depth prepass
  const disposables = [];

  let trail = null;
  let trailHalo = null;
  let pin = null;
  let pinDiamond = null;
  let pinBeam = null;
  const markers = [];
  let markerTex = null;

  const _dummy = T ? new T.Object3D() : null;
  const _color = T ? new T.Color() : null;
  const _color2 = T ? new T.Color() : null;

  if (T && game.scene) {
    group.name = 'guide';
    fx.name = 'guide:fx';
    game.scene.add(group);
    game.scene.add(fx);

    // ---- b) the ground arrow trail ---------------------------------------
    // Two instanced passes, not one: a dark ink halo underneath and the bright
    // coloured chevron on top. Gold alone vanishes on the pale plaza paving and
    // ink alone vanishes on asphalt — the pair reads on both.
    try {
      const geo = chevronGeometry(T);
      const baseMat = () => new T.MeshBasicMaterial({
        color: 0xffffff,
        toneMapped: false,
        depthWrite: false,
        transparent: true,
        side: T.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -6,
        polygonOffsetUnits: -12,
      });

      const haloMat = baseMat();
      haloMat.opacity = 0.5;
      trailHalo = new T.InstancedMesh(geo, haloMat, TRAIL_COUNT);
      trailHalo.name = 'guide:trail:halo';
      trailHalo.frustumCulled = false;
      trailHalo.castShadow = false;
      trailHalo.receiveShadow = false;
      trailHalo.renderOrder = 3;
      trailHalo.visible = false;

      const mat = baseMat();
      mat.opacity = 0.95;
      trail = new T.InstancedMesh(geo, mat, TRAIL_COUNT);
      trail.name = 'guide:trail';
      trail.frustumCulled = false;
      trail.castShadow = false;
      trail.receiveShadow = false;
      trail.renderOrder = 4;
      trail.visible = false;

      for (let i = 0; i < TRAIL_COUNT; i++) {
        trail.setColorAt(i, _color.setHex(0xffcf6a));
        trailHalo.setColorAt(i, _color.setHex(0x2a211a));
      }
      group.add(trailHalo, trail);
      disposables.push(geo, mat, haloMat);
    } catch (err) {
      console.warn('[guideUI] could not build the arrow trail', err);
      trail = null;
      trailHalo = null;
    }

    // ---- d) the destination pin ------------------------------------------
    try {
      pin = new T.Group();
      pin.name = 'guide:pin';
      pin.visible = false;

      const beamGeo = new T.CylinderGeometry(0.07, 0.11, 4.4, 8, 1, true);
      beamGeo.translate(0, 2.2, 0);
      const beamMat = new T.MeshBasicMaterial({
        color: 0xffd98a, transparent: true, opacity: 0.34, depthWrite: false,
        side: T.DoubleSide, toneMapped: false,
      });
      pinBeam = new T.Mesh(beamGeo, beamMat);
      pinBeam.frustumCulled = false;
      pin.add(pinBeam);

      const diaGeo = new T.OctahedronGeometry(0.44, 0);
      const diaMat = new T.MeshBasicMaterial({
        color: 0xffd98a, toneMapped: false, transparent: true, opacity: 0.95,
        depthWrite: false, depthTest: false,
      });
      pinDiamond = new T.Mesh(diaGeo, diaMat);
      pinDiamond.position.y = 5.0;
      pinDiamond.renderOrder = 8;
      pinDiamond.frustumCulled = false;
      pin.add(pinDiamond);

      group.add(pin);
      disposables.push(beamGeo, beamMat, diaGeo, diaMat);
    } catch (err) {
      console.warn('[guideUI] could not build the destination pin', err);
      pin = null;
    }

    // ---- c) NPC head markers ---------------------------------------------
    try {
      markerTex = {
        '!': glyphTexture(T, '!', THEME.gold, THEME.gold),
        '?': glyphTexture(T, '?', THEME.gold, THEME.gold),
        chat: bubbleTexture(T),
      };
      for (let i = 0; i < MARKER_POOL; i++) {
        // depthTest off on purpose: a quest marker is guidance, so it should
        // read whole from across the district rather than be sliced in half by
        // the building the cat is standing behind. (Name labels are ambience
        // and do the opposite — npcRuntime hides those when they are occluded.)
        const mat = new T.SpriteMaterial({
          map: markerTex['!'], transparent: true, opacity: 0,
          depthWrite: false, depthTest: false, toneMapped: false,
        });
        const spr = new T.Sprite(mat);
        spr.scale.set(0.78, 0.78, 1);
        spr.visible = false;
        spr.renderOrder = 7;
        spr.frustumCulled = false;
        fx.add(spr);
        markers.push({ sprite: spr, mat, kind: null, npcId: null, phase: i * 0.7 });
        disposables.push(mat);
      }
      for (const k in markerTex) disposables.push(markerTex[k]);

      // npcRuntime pools its own ! / ? sprites. Ours are the richer set (they
      // add the objective bubble and a hard visible cap), so switch its pair
      // off rather than draw two markers over every head.
      if (game.npcs && typeof game.npcs.setMarkersEnabled === 'function') {
        game.npcs.setMarkersEnabled(false);
      }
    } catch (err) {
      console.warn('[guideUI] could not build the NPC markers', err);
    }
  }

  function groundY(x, z) {
    try {
      if (game.world && typeof game.world.groundHeightAt === 'function') {
        const y = game.world.groundHeightAt(x, z);
        if (Number.isFinite(y)) return y;
      }
    } catch { /* ignore */ }
    return 0;
  }

  // ---------------------------------------------------------------- trail
  function updateTrail(cur, dt) {
    if (!trail) return;
    const p = game.player && game.player.position;
    const show = !!(cur && cur.target && p && game.mode === 'explore'
      && num(cur.distance, 0) >= TRAIL_HIDE_DIST);
    if (!show) {
      trail.visible = false;
      if (trailHalo) trailHalo.visible = false;
      return;
    }
    trail.visible = true;
    if (trailHalo) trailHalo.visible = true;

    const dx = cur.target.x - num(p.x);
    const dz = cur.target.z - num(p.z);
    const len = Math.hypot(dx, dz) || 1;
    const nx = dx / len, nz = dz / len;
    const yaw = Math.atan2(nx, nz);
    const look = KIND_LOOK[cur.kind] || KIND_LOOK.visit;

    let colorDirty = false;
    for (let i = 0; i < TRAIL_COUNT; i++) {
      // Spaced far enough apart to read as separate arrows: the chase camera
      // sees flat ground decals almost edge-on, and a tighter run smears into
      // one continuous streak.
      const along = 2.2 + i * 2.0;
      const t = i / (TRAIL_COUNT - 1);
      // Never overshoot the target — the last chevrons pile up short of it.
      const reach = Math.min(along, Math.max(0, len - 1.6));
      const x = num(p.x) + nx * reach;
      const z = num(p.z) + nz * reach;
      const bob = Math.sin(clock * 3.2 - i * 0.8) * 0.035;
      // Distance fade, floored well short of zero: a chevron you cannot see is
      // worse than one that is merely quiet.
      const fade = 1 - t * 0.6;
      const y = groundY(x, z) + bob;
      const scale = 0.95 + fade * 0.5;

      // 'YXZ': pitch about the chevron's own lateral axis, then yaw it downrange.
      _dummy.position.set(x, y + TRAIL_LIFT * scale, z);
      _dummy.rotation.set(TRAIL_PITCH, yaw, 0, 'YXZ');
      _dummy.scale.setScalar(scale);
      _dummy.updateMatrix();
      trail.setMatrixAt(i, _dummy.matrix);
      _color.setHex(look.color).multiplyScalar(0.85 + fade * 0.15);
      trail.setColorAt(i, _color);

      if (trailHalo) {
        // Same pose, 18% fatter and a hair further from the camera, so it reads
        // as a rim around the bright chevron rather than a second arrow.
        _dummy.position.set(x, y + TRAIL_LIFT * scale - 0.012, z);
        _dummy.scale.setScalar(scale * 1.18);
        _dummy.updateMatrix();
        trailHalo.setMatrixAt(i, _dummy.matrix);
        // Fading a fixed-opacity instance means losing contrast, not going
        // darker — so the far halo lerps toward a neutral mid instead.
        _color.setHex(0x2a211a).lerp(_color2.setHex(0x8a8078), 1 - fade);
        trailHalo.setColorAt(i, _color);
      }
      colorDirty = true;
    }
    trail.instanceMatrix.needsUpdate = true;
    if (colorDirty && trail.instanceColor) trail.instanceColor.needsUpdate = true;
    if (trailHalo) {
      trailHalo.instanceMatrix.needsUpdate = true;
      if (colorDirty && trailHalo.instanceColor) trailHalo.instanceColor.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------------ pin
  function updatePin(cur) {
    if (!pin) return;
    const show = !!(cur && cur.target && game.mode !== 'cutscene');
    pin.visible = show;
    if (!show) return;
    const x = cur.target.x, z = cur.target.z;
    pin.position.set(x, groundY(x, z), z);
    const look = KIND_LOOK[cur.kind] || KIND_LOOK.visit;
    if (pinDiamond) {
      pinDiamond.material.color.setHex(look.color);
      pinDiamond.position.y = 5.0 + Math.sin(clock * 2.2) * 0.32;
      pinDiamond.rotation.y = clock * 1.2;
      pinDiamond.rotation.x = Math.sin(clock * 0.8) * 0.25;
    }
    if (pinBeam) pinBeam.material.color.setHex(look.color);
  }

  // -------------------------------------------------------------- markers
  function rebuildMarkers(cur) {
    if (!markers.length) return;
    const quests = game.quests;
    const objectiveNpc = cur && cur.npcId ? cur.npcId : null;
    const p = game.player && game.player.position;
    if (!p) return;

    let records = [];
    try { records = (game.npcs && game.npcs.npcs) || []; } catch { records = []; }

    const wanted = [];
    for (const rec of records) {
      if (!rec || !rec.pos) continue;
      const d = Math.hypot(rec.pos.x - num(p.x), rec.pos.z - num(p.z));
      if (d > MARKER_DIST) continue;
      let kind = null;
      if (rec.id === objectiveNpc) kind = 'chat';
      else if (quests && typeof quests.markerFor === 'function') {
        try { kind = quests.markerFor(rec.id); } catch { kind = null; }
      }
      if (!kind) continue;
      wanted.push({ rec, kind, d });
    }
    // The objective's own NPC first, then whoever is nearest.
    wanted.sort((a, b) => (a.kind === 'chat' ? -1 : b.kind === 'chat' ? 1 : a.d - b.d));
    wanted.length = Math.min(wanted.length, MARKER_POOL);

    for (let i = 0; i < markers.length; i++) {
      const slot = markers[i];
      const want = wanted[i];
      if (!want) {
        slot.sprite.visible = false;
        slot.npcId = null;
        slot.kind = null;
        continue;
      }
      if (slot.kind !== want.kind) {
        slot.kind = want.kind;
        const tex = markerTex && (markerTex[want.kind] || markerTex['!']);
        if (tex) { slot.mat.map = tex; slot.mat.needsUpdate = true; }
      }
      slot.npcId = want.rec.id;
      slot.sprite.visible = true;
    }
  }

  function updateMarkers() {
    if (!markers.length) return;
    const p = game.player && game.player.position;
    const cast = game.npcs && typeof game.npcs.find === 'function' ? game.npcs : null;
    const hide = !p || !cast || game.mode === 'cutscene';
    for (const slot of markers) {
      if (!slot.sprite.visible) continue;
      if (hide) { slot.sprite.visible = false; continue; }
      const rec = slot.npcId ? cast.find(slot.npcId) : null;
      if (!rec || !rec.pos) { slot.sprite.visible = false; continue; }
      const size = num(rec.def && rec.def.size, 1);
      const d = Math.hypot(rec.pos.x - num(p.x), rec.pos.z - num(p.z));
      const bob = Math.sin(clock * 2.3 + slot.phase) * 0.09;
      slot.sprite.position.set(
        rec.pos.x,
        rec.pos.y + 1.62 * size + (slot.kind === 'chat' ? 0.86 : 0.66) + bob,
        rec.pos.z,
      );
      const pulse = slot.kind === 'chat' ? 1.1 + Math.sin(clock * 3.4) * 0.08 : 1;
      slot.sprite.scale.set(0.78 * pulse, 0.78 * pulse, 1);
      slot.mat.opacity = clamp01((MARKER_DIST - d) / 8);
      if (slot.mat.opacity <= 0.02) slot.sprite.visible = false;
    }
  }

  // ============================================================== the frame
  function update(dt) {
    if (disposed) return;
    const d = Math.max(0, Math.min(0.25, Number(dt) || 0));
    clock += d;

    const cur = guide ? guide.current : null;

    // The banner only needs redrawing a few times a second, except for the
    // heading arrow, which follows the camera.
    bannerAcc += d;
    if (bannerAcc >= 1 / 15) { bannerAcc = 0; paint(); }

    markerAcc += d;
    if (markerAcc >= 0.25) { markerAcc = 0; rebuildMarkers(cur); }

    try {
      updateTrail(cur, d);
      updatePin(cur);
      updateMarkers();
    } catch (err) {
      console.warn('[guideUI] 3D update failed', err);
    }
  }

  // ---------------------------------------------------------------- wiring
  if (bus) {
    const sub = (evt, cb) => offs.push(bus.on(evt, cb));
    sub(EV.PANEL_OPEN, () => { panelsOpen++; paint(); });
    sub(EV.PANEL_CLOSE, () => { panelsOpen = Math.max(0, panelsOpen - 1); paint(); });
    sub(EV.QUEST_PROGRESS, (p) => { if (p && p.done) flashDone(); });
    sub(EV.QUEST_DONE, () => flashDone());
  }

  if (guide && typeof guide.on === 'function') {
    offs.push(guide.on((next) => {
      const id = next ? next.id : null;
      if (id !== lastId) {
        lastId = id;
        if (next) {
          root.classList.remove('spgd-pop');
          void root.offsetWidth;
          root.classList.add('spgd-pop');
        }
      }
      paint();
    }));
  }

  paint();

  // --------------------------------------------------------------- destroy
  function destroy() {
    if (disposed) return;
    disposed = true;
    while (offs.length) { const off = offs.pop(); try { off(); } catch { /* ignore */ } }
    wrap.remove();
    if (group && group.parent) group.parent.remove(group);
    if (fx && fx.parent) fx.parent.remove(fx);
    for (const d of disposables) { try { if (d && d.dispose) d.dispose(); } catch { /* ignore */ } }
    disposables.length = 0;
    markers.length = 0;
    if (game.npcs && typeof game.npcs.setMarkersEnabled === 'function') {
      try { game.npcs.setMarkersEnabled(true); } catch { /* ignore */ }
    }
  }

  return {
    root,
    group,
    /** Sprites — main.js hides this group during the outline depth prepass. */
    fx,
    update,
    refresh: paint,
    flashDone,
    destroy,
  };
}

export default createGuideUI;
