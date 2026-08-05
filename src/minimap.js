// An interactive top-down minimap drawn on a 2D canvas overlay, rebuilt each
// frame from the REAL world geometry (road rects, footprints, park, shops).
// It shows the CITY ONLY — no ocean, island or bridge. The map is oriented so
// the player's forward view runs up the canvas (world +z maps DOWNWARD), which
// keeps the player arrow pointing where they move and makes a right turn rotate
// the arrow clockwise.
//
// Interaction (threejs-interaction — screen↔world mapping):
//  • defaults to a small corner minimap; click empty map → open the large
//    full-screen map, click again (or ✕ Close / the backdrop) → shrink back
//  • click a POI dot   → set it as the destination (works in either size)
//  • destination draws a route that follows the road grid (Dijkstra over road
//    intersections, direct-line fallback) and shows the distance; it persists
//    across expand/shrink and keeps updating as the player moves.
//
// world → map:  mx(x)=offX+(x-minX)*scale ,  my(z)=offY+(z-minZ)*scale

export function createMinimap(cfg) {
  const wrap = document.getElementById('minimap-wrap');
  const canvas = document.getElementById('minimap');
  const backdrop = document.getElementById('mm-backdrop');
  const infoEl = document.getElementById('mm-info');
  const clearBtn = document.getElementById('mm-clear');
  const closeBtn = document.getElementById('mm-close');
  const ctx = canvas.getContext('2d');

  const { roads, footprints, pois, park, roadLines } = cfg;

  // Fit region: the CITY ONLY — the extent of its roads + building footprints.
  // Offshore land (the second island, the bridge, the outer beach) and any POIs
  // beyond the city are intentionally left off the map; they still exist in 3D.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const r of roads) {
    minX = Math.min(minX, r.cx - r.w / 2); maxX = Math.max(maxX, r.cx + r.w / 2);
    minZ = Math.min(minZ, r.cz - r.d / 2); maxZ = Math.max(maxZ, r.cz + r.d / 2);
  }
  for (const f of footprints) {
    minX = Math.min(minX, f.x0); maxX = Math.max(maxX, f.x1);
    minZ = Math.min(minZ, f.z0); maxZ = Math.max(maxZ, f.z1);
  }
  const PAD = 10;
  minX -= PAD; maxX += PAD; minZ -= PAD; maxZ += PAD;

  // Only POIs inside the city area are shown / selectable.
  const inCity = (x, z) => x >= minX && x <= maxX && z >= minZ && z <= maxZ;
  const cityPois = pois.filter((p) => inCity(p.x, p.z));

  // ---- Sizing / transform (recomputed whenever the canvas is resized) -------
  // The small corner map matches the CITY's aspect ratio, so the map fills the
  // panel edge-to-edge with an even border (no letterboxed / lopsided bands).
  const cityAspect = (maxX - minX) / (maxZ - minZ);
  const SMALL_H = 200;
  const SMALL_W = Math.round(Math.max(150, Math.min(300, SMALL_H * cityAspect)));
  let CSS_W = SMALL_W;
  let CSS_H = SMALL_H;
  let scale = 1;
  let offX = 0;
  let offY = 0;
  let expanded = false;

  function layout() {
    const pad = 6;
    scale = Math.min((CSS_W - pad * 2) / (maxX - minX), (CSS_H - pad * 2) / (maxZ - minZ));
    offX = (CSS_W - (maxX - minX) * scale) / 2;
    offY = (CSS_H - (maxZ - minZ) * scale) / 2;
  }
  function setSize(w, h) {
    CSS_W = w;
    CSS_H = h;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout();
  }
  const mx = (x) => offX + (x - minX) * scale;
  // World +z runs DOWNWARD on the canvas. This aligns the map with the player's
  // default forward view and makes a right turn rotate the player arrow
  // clockwise (see the arrow math in update()), while the arrow still points
  // exactly where the player is moving.
  const my = (z) => offY + (z - minZ) * scale;
  const S = (v) => v * scale;
  // Orientation-agnostic rect: top-left is the smaller mapped corner on each axis.
  const box = (x0, z0, x1, z1) =>
    ctx.fillRect(mx(x0), Math.min(my(z0), my(z1)), S(x1 - x0), S(z1 - z0));

  function expandedSize() {
    const m = 48;
    const availW = window.innerWidth - m * 2;
    const availH = window.innerHeight - m * 2;
    const aspect = (maxX - minX) / (maxZ - minZ);
    let h = availH;
    let w = h * aspect;
    if (w > availW) {
      w = availW;
      h = w / aspect;
    }
    return { w: Math.round(w), h: Math.round(h) };
  }
  function expand() {
    expanded = true;
    const s = expandedSize();
    setSize(s.w, s.h);
    wrap.classList.add('expanded');
    backdrop.classList.add('show');
  }
  function shrink() {
    expanded = false;
    setSize(SMALL_W, SMALL_H);
    wrap.classList.remove('expanded');
    backdrop.classList.remove('show');
  }

  setSize(SMALL_W, SMALL_H);

  // ---- Road-grid graph (built once) for routing -----------------------------
  const xs = roadLines.xs; // grid is square: same lines on both axes
  const zs = roadLines.xs;
  const cX = roadLines.centralX;
  const nx = xs.length;
  const nz = zs.length;
  const inParkPt = (x, z) => x >= park.minX && x <= park.maxX && z >= park.minZ && z <= park.maxZ;
  const nodes = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      nodes.push({ x: xs[i], z: zs[j], blocked: inParkPt(xs[i], zs[j]) });
    }
  }
  const id = (i, j) => i * nz + j;
  const adj = nodes.map(() => []);
  const overlap = (a, b, c, d) => a < d && c < b;
  const nd = (a, b) => Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z);
  function link(a, b) {
    if (nodes[a].blocked || nodes[b].blocked) return;
    const w = nd(a, b);
    adj[a].push({ to: b, w });
    adj[b].push({ to: a, w });
  }
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      if (i + 1 < nx) {
        // horizontal edge along z=zs[j]; blocked if it crosses the park on the central road
        if (!(zs[j] === cX && overlap(xs[i], xs[i + 1], park.minX, park.maxX))) link(id(i, j), id(i + 1, j));
      }
      if (j + 1 < nz) {
        // vertical edge along x=xs[i]
        if (!(xs[i] === cX && overlap(zs[j], zs[j + 1], park.minZ, park.maxZ))) link(id(i, j), id(i, j + 1));
      }
    }
  }
  // Nearest non-blocked intersection on the road line closest to (x,z).
  function entryNode(x, z) {
    // nearest vertical + horizontal line
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < nx; i++) {
      const d = Math.abs(x - xs[i]);
      if (d < bd) { bd = d; bi = i; }
    }
    let bj = 0;
    let bjd = Infinity;
    for (let j = 0; j < nz; j++) {
      const d = Math.abs(z - zs[j]);
      if (d < bjd) { bjd = d; bj = j; }
    }
    // road point (perpendicular snap to the closer line) and its nearest node.
    let rp;
    let node;
    if (bd <= bjd) {
      // on vertical line xs[bi]; nearest node by z
      let nj = 0;
      let ndz = Infinity;
      for (let j = 0; j < nz; j++) {
        if (nodes[id(bi, j)].blocked) continue;
        const d = Math.abs(z - zs[j]);
        if (d < ndz) { ndz = d; nj = j; }
      }
      rp = { x: xs[bi], z };
      node = id(bi, nj);
    } else {
      let ni = 0;
      let ndx = Infinity;
      for (let i = 0; i < nx; i++) {
        if (nodes[id(i, bj)].blocked) continue;
        const d = Math.abs(x - xs[i]);
        if (d < ndx) { ndx = d; ni = i; }
      }
      rp = { x, z: zs[bj] };
      node = id(ni, bj);
    }
    return { rp, node };
  }
  function dijkstra(src, dst) {
    const dist = new Float64Array(nodes.length).fill(Infinity);
    const prev = new Int32Array(nodes.length).fill(-1);
    const done = new Uint8Array(nodes.length);
    dist[src] = 0;
    for (;;) {
      let u = -1;
      let best = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      }
      if (u === -1 || u === dst) break;
      done[u] = 1;
      for (const e of adj[u]) {
        if (dist[u] + e.w < dist[e.to]) {
          dist[e.to] = dist[u] + e.w;
          prev[e.to] = u;
        }
      }
    }
    if (dist[dst] === Infinity) return null;
    const path = [];
    for (let n = dst; n !== -1; n = prev[n]) path.push(n);
    path.reverse();
    return path;
  }
  // Route polyline from player (px,pz) to (dx,dz), following roads where it can.
  function computeRoute(px, pz, dx, dz) {
    const a = entryNode(px, pz);
    const b = entryNode(dx, dz);
    const path = dijkstra(a.node, b.node);
    let poly;
    if (path) {
      poly = [{ x: px, z: pz }, a.rp];
      for (const n of path) poly.push({ x: nodes[n].x, z: nodes[n].z });
      poly.push(b.rp, { x: dx, z: dz });
    } else {
      poly = [{ x: px, z: pz }, { x: dx, z: dz }]; // fallback: straight line
    }
    // Drop zero-length / backtracking duplicates and measure length.
    const clean = [poly[0]];
    let dist = 0;
    for (let i = 1; i < poly.length; i++) {
      const d = Math.hypot(poly[i].x - clean[clean.length - 1].x, poly[i].z - clean[clean.length - 1].z);
      if (d < 0.5) continue;
      clean.push(poly[i]);
      dist += d;
    }
    return { poly: clean, dist };
  }

  // ---- State: selected destination + its route ------------------------------
  let destination = null; // a POI object
  let route = null; // { poly, dist }

  function setDestination(poi) {
    destination = poi;
    wrap.classList.add('has-dest');
  }
  function clearDestination() {
    destination = null;
    route = null;
    wrap.classList.remove('has-dest');
    infoEl.textContent = '';
  }

  // ---- Pointer interaction --------------------------------------------------
  function poiAt(cx, cy) {
    const hit = expanded ? 12 : 7;
    let best = hit;
    let found = null;
    for (const p of cityPois) {
      const d = Math.hypot(mx(p.x) - cx, my(p.z) - cy);
      if (d < best) { best = d; found = p; }
    }
    return found;
  }
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (CSS_W / rect.width);
    const cy = (e.clientY - rect.top) * (CSS_H / rect.height);
    const poi = poiAt(cx, cy);
    if (poi) {
      setDestination(poi);
      if (!expanded) return; // stay in the corner; route shows there too
    } else {
      expanded ? shrink() : expand();
    }
  });
  backdrop.addEventListener('click', shrink);
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); shrink(); });
  clearBtn.addEventListener('click', (e) => { e.stopPropagation(); clearDestination(); });
  window.addEventListener('resize', () => { if (expanded) expand(); });

  // ---- Draw -----------------------------------------------------------------
  function drawRoute() {
    if (!route || route.poly.length < 2) return;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // dark casing
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = expanded ? 6 : 4;
    strokePoly();
    // bright core
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = expanded ? 3 : 2;
    strokePoly();
  }
  function strokePoly() {
    ctx.beginPath();
    ctx.moveTo(mx(route.poly[0].x), my(route.poly[0].z));
    for (let i = 1; i < route.poly.length; i++) ctx.lineTo(mx(route.poly[i].x), my(route.poly[i].z));
    ctx.stroke();
  }

  function update(px, pz, yaw) {
    if (destination) {
      route = computeRoute(px, pz, destination.x, destination.z);
      infoEl.textContent = `➤ ${destination.label} · ${Math.round(route.dist)} m`;
    }

    ctx.clearRect(0, 0, CSS_W, CSS_H);
    // City-only map: a plain land backdrop (no ocean, island or bridge).
    ctx.fillStyle = '#cdbf9c';
    ctx.fillRect(0, 0, CSS_W, CSS_H);

    // Park.
    ctx.fillStyle = '#8fc25a';
    box(park.minX, park.minZ, park.maxX, park.maxZ);
    ctx.strokeStyle = '#cbb994';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(mx(park.cx), my(park.cz), S(park.ringR), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#4aa6c8';
    ctx.beginPath();
    ctx.arc(mx(park.cx), my(park.cz), S(park.fountainR), 0, Math.PI * 2);
    ctx.fill();

    // Roads.
    ctx.fillStyle = '#b3a074';
    for (let i = 0; i < roads.length; i++) {
      const r = roads[i];
      box(r.cx - r.w / 2, r.cz - r.d / 2, r.cx + r.w / 2, r.cz + r.d / 2);
    }

    // Buildings.
    ctx.fillStyle = '#9a8c72';
    ctx.strokeStyle = 'rgba(60,50,40,0.35)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < footprints.length; i++) {
      const f = footprints[i];
      const w = S(f.x1 - f.x0);
      const h = S(f.z1 - f.z0);
      const ty = Math.min(my(f.z0), my(f.z1));
      ctx.fillRect(mx(f.x0), ty, w, h);
      if (w > 2 && h > 2) ctx.strokeRect(mx(f.x0), ty, w, h);
    }

    // Route (under the markers).
    drawRoute();

    // POI markers.
    const dotR = expanded ? 4 : 2.6;
    ctx.textBaseline = 'middle';
    ctx.font = (expanded ? 10 : 7) + 'px system-ui, sans-serif';
    for (let i = 0; i < cityPois.length; i++) {
      const p = cityPois[i];
      const X = mx(p.x);
      const Y = my(p.z);
      if (p === destination) {
        ctx.beginPath();
        ctx.arc(X, Y, dotR + 3, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffd23f';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(X, Y, dotR, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.stroke();
      ctx.lineWidth = expanded ? 3 : 2.4;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(expanded ? p.label : p.short, X + dotR + 2, Y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(expanded ? p.label : p.short, X + dotR + 2, Y);
    }

    // Mission waypoint. Mission targets aren't POIs (a delivery address, a
    // timed checkpoint, a scatter of pickups), so they get their own marker
    // rather than the ring drawn around a POI dot above.
    if (destination && !cityPois.includes(destination)) {
      const X = mx(destination.x), Y = my(destination.z);
      const r = expanded ? 7 : 5;
      ctx.save();
      ctx.translate(X, Y);
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.rect(-r * 0.62, -r * 0.62, r * 1.24, r * 1.24); // diamond
      ctx.fillStyle = '#ffd23f';
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.stroke();
      ctx.restore();
      if (destination.label) {
        ctx.font = (expanded ? 10 : 7) + 'px system-ui, sans-serif';
        ctx.lineWidth = expanded ? 3 : 2.4;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.strokeText(destination.label, X + r + 2, Y);
        ctx.fillStyle = '#ffd23f';
        ctx.fillText(destination.label, X + r + 2, Y);
      }
    }

    // Player arrow.
    const X = mx(px);
    const Y = my(pz);
    const a = expanded ? 1.5 : 1;
    ctx.save();
    ctx.translate(X, Y);
    // The player's world forward is (sin yaw, cos yaw). On this map (world +z
    // downward on the canvas) the tip aligns with true forward when we rotate by
    // (π − yaw): pointing exactly where the player moves, and a right turn (yaw
    // decreasing) rotates the arrow clockwise. Tested both turn directions.
    ctx.rotate(Math.PI - yaw);
    ctx.beginPath();
    ctx.moveTo(0, -8 * a);
    ctx.lineTo(5 * a, 5.5 * a);
    ctx.lineTo(0, 2.5 * a);
    ctx.lineTo(-5 * a, 5.5 * a);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#16283a';
    ctx.stroke();
    ctx.restore();
  }

  // setDestination/clearDestination are also the mission system's waypoint API:
  // any { x, z, label } works, POI or not.
  return { update, setDestination, clearDestination };
}
