import * as THREE from 'three';

// Lightweight two-state weather (clear ⇄ rain). Everything is ZERO cost when
// clear: the world-rain mesh is hidden (not drawn), the lens pass is disabled,
// and the sky/light modulation is skipped once the wet factor eases back to 0.
//
// When raining:
//  • World rain — one Instanced-style LineSegments cloud of streaks whose fall +
//    camera-follow is done entirely in the vertex shader, so it always surrounds
//    the player and never runs out (it wraps within a box centred on the camera).
//  • Lens droplets — a screen-space ShaderPass that clings droplets to the
//    "lens", slides them down, refracts what's behind them and fades them out.
//  • Overcast — the already day/night-lit sky, sun, fog and grade are nudged
//    greyer / dimmer / foggier by the wet factor (re-applied every frame, so it
//    self-restores to the normal look as the rain clears).

// --------- Screen-space rain-on-lens droplets (added to the composer) ---------
export const LensRainShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uIntensity: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uIntensity;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash21(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }

    // One grid layer of droplets. Returns (refractOffset.xy, coverage mask).
    vec3 layer(vec2 uv, float t, float grid){
      vec2 aspect = vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
      vec2 g = uv * grid * aspect;
      vec2 id = floor(g);
      float n = hash21(id);
      float n2 = hash21(id + 5.1);
      if (n < 0.35) return vec3(0.0);                 // ~65% of cells carry a drop (sparse/capped)
      float speed = 0.25 + n * 0.55;
      float life = fract(n * 13.0 + t * speed * 0.35);
      vec2 center = vec2(0.5 + (n2 - 0.5) * 0.5, 1.0 - life * 1.3); // drop drifts down its cell
      vec2 f = fract(g);
      vec2 d = (f - center) / aspect;
      float r = 0.10 + 0.14 * fract(n * 7.0);
      float mask = smoothstep(r, r * 0.45, length(d));
      mask *= smoothstep(0.0, 0.12, life) * smoothstep(1.0, 0.75, life); // fade in/out over life
      return vec3((f - center) * mask, mask);
    }

    void main(){
      if (uIntensity < 0.01) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec3 a = layer(vUv, uTime, 7.0);
      vec3 b = layer(vUv * 1.3 + 11.0, uTime * 1.25, 12.0);
      float mask = max(a.z, b.z);
      vec2 off = (a.xy + b.xy) * 0.045 * uIntensity;      // lens refraction shift
      vec3 col = texture2D(tDiffuse, vUv - off).rgb;
      col += mask * uIntensity * 0.05;                    // subtle bright drop rim
      col *= (1.0 - 0.03 * uIntensity);                   // faint overall condensation
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

// ------------------------------- World rain ---------------------------------
function buildRain() {
  const N = 1400;                 // capped streak count
  const R = 26, H = 34, STREAK = 1.7;
  const pos = new Float32Array(N * 2 * 3);
  const aEnd = new Float32Array(N * 2);
  const aSpeed = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const bx = (Math.random() * 2 - 1) * R;
    const bz = (Math.random() * 2 - 1) * R;
    const by = Math.random() * H;
    const sp = 26 + Math.random() * 30;
    for (let e = 0; e < 2; e++) {
      const k = (i * 2 + e) * 3;
      pos[k] = bx; pos[k + 1] = by; pos[k + 2] = bz;
      aEnd[i * 2 + e] = e;          // 0 = bottom, 1 = top of the streak
      aSpeed[i * 2 + e] = sp;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(aEnd, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(aSpeed, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true,
    uniforms: {
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uBoxR: { value: R },
      uBoxH: { value: H },
      uStreak: { value: STREAK },
      uWind: { value: new THREE.Vector2(1.1, 0.4) },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(0xcfe0ee) },
    },
    vertexShader: /* glsl */`
      uniform float uTime, uBoxR, uBoxH, uStreak, uOpacity;
      uniform vec3 uCamPos;
      uniform vec2 uWind;
      attribute float aEnd;
      attribute float aSpeed;
      varying float vFade;
      void main(){
        vec3 base = position;                              // random base within the box
        float y = mod(base.y - uTime * aSpeed, uBoxH);     // fall + wrap → never runs out
        vec3 local = vec3(base.x, y, base.z);
        local += aEnd * vec3(uWind.x, uStreak, uWind.y);   // raise + slant the top end
        vec3 world = uCamPos + vec3(local.x, local.y - uBoxH * 0.35, local.z); // box follows camera
        float edge = length(local.xz) / uBoxR;
        vFade = (1.0 - smoothstep(0.6, 1.0, edge)) * uOpacity;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      varying float vFade;
      void main(){
        if (vFade <= 0.002) discard;
        gl_FragColor = vec4(uColor, vFade);
      }
    `,
  });

  const mesh = new THREE.LineSegments(geo, mat);
  mesh.frustumCulled = false;    // it follows the camera — always potentially visible
  mesh.renderOrder = 5;
  return mesh;
}

// Nudge a colour toward a darkened, cool desaturated version of itself by `w`.
const _grey = new THREE.Color();
function overcast(c, w) {
  const l = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  _grey.setRGB(l * 0.82, l * 0.85, l * 0.9);   // cool grey (slightly blue)
  c.lerp(_grey, 0.75 * w);
}

export function createWeather(deps) {
  const {
    scene, camera, renderer, sunLight, hemi, ambient, skyMat, fog,
    gradePass, godrayPass, lensPass,
  } = deps;

  const group = new THREE.Group();
  const rain = buildRain();
  group.add(rain);
  scene.add(group);

  // Base grade values we ease away from and back to.
  const baseExposure = gradePass.uniforms.exposure.value;
  const baseSat = gradePass.uniforms.saturation.value;
  const baseContrast = gradePass.uniforms.contrast.value;
  const baseFogNear = fog.near, baseFogFar = fog.far;
  const GREY_SUN = new THREE.Color(0x9fa6ae);

  // Small on-screen weather indicator (fades after each change).
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;left:14px;bottom:52px;z-index:30;padding:5px 11px;border-radius:8px;' +
    'font:600 13px/1 system-ui,sans-serif;color:#eaf2f7;background:rgba(20,28,38,.55);' +
    'backdrop-filter:blur(3px);pointer-events:none;transition:opacity .5s;opacity:0';
  document.body.appendChild(el);
  let labelT = 0;

  let raining = false;
  let wet = 0;                    // eased 0→1
  let auto = true;
  let autoTimer = 60 + Math.random() * 50;
  const _cam = new THREE.Vector3();
  const _size = new THREE.Vector2();
  let lensT = 0;

  function flash(txt) {
    el.textContent = txt;
    el.style.opacity = '1';
    labelT = 2.4;
  }
  function setRaining(v, fromAuto) {
    if (v === raining) return;
    raining = v;
    if (!fromAuto) autoTimer = 60 + Math.random() * 50; // manual change: hold off auto for a while
    flash(raining ? '🌧  Rain' : '☀  Clear');
  }
  function toggle() { setRaining(!raining, false); }

  function update(dt, night, indoor) {
    // Occasional self-change.
    if (auto) {
      autoTimer -= dt;
      if (autoTimer <= 0) { setRaining(!raining, true); autoTimer = 60 + Math.random() * 55; }
    }
    // Ease the wet factor (~2s in / out).
    wet += ((raining ? 1 : 0) - wet) * Math.min(1, dt * 0.6);
    if (wet < 0.001 && !raining) wet = 0;

    if (labelT > 0) { labelT -= dt; if (labelT <= 0) el.style.opacity = '0'; }

    // Indoors the world is hidden and the camera sits in an interior room, so
    // suppress all rain and keep the interior at its normal (non-overcast) look.
    if (indoor) {
      rain.visible = false;
      lensPass.enabled = false;
      gradePass.uniforms.exposure.value = baseExposure;
      gradePass.uniforms.saturation.value = baseSat;
      gradePass.uniforms.contrast.value = baseContrast;
      fog.near = baseFogNear; fog.far = baseFogFar;
      return;
    }

    const on = wet > 0.01;

    // ---- World rain (drawn only while wet) ----
    rain.visible = on;
    if (on) {
      const u = rain.material.uniforms;
      u.uTime.value += dt;
      camera.getWorldPosition(_cam);
      u.uCamPos.value.copy(_cam);
      u.uOpacity.value = 0.42 * wet;
    }

    // ---- Lens droplets (disabled entirely when clear) ----
    lensPass.enabled = on;
    if (on) {
      lensT += dt;
      lensPass.uniforms.uTime.value = lensT;
      lensPass.uniforms.uIntensity.value = wet;
      renderer.getSize(_size);
      lensPass.uniforms.uResolution.value.copy(_size);
    }

    // ---- Overcast modulation (self-restoring; skipped at wet 0) ----
    if (wet > 0) {
      const w = wet;
      sunLight.intensity *= (1 - 0.6 * w);        // weak, soft sun
      sunLight.color.lerp(GREY_SUN, 0.5 * w);
      hemi.intensity *= (1 - 0.12 * w);
      ambient.intensity *= (1 + 0.05 * w);        // flat overcast fill

      overcast(skyMat.uniforms.topColor.value, w);
      overcast(skyMat.uniforms.horizonColor.value, w);
      overcast(skyMat.uniforms.bottomColor.value, w);
      overcast(skyMat.uniforms.cloudColor.value, w);
      overcast(skyMat.uniforms.cloudShadow.value, w);

      fog.color.copy(skyMat.uniforms.horizonColor.value); // already greyed
      fog.near = baseFogNear + (baseFogNear * 0.5 - baseFogNear) * w;
      fog.far = baseFogFar + (baseFogFar * 0.45 - baseFogFar) * w;

      gradePass.uniforms.exposure.value = baseExposure * (1 - 0.08 * w);
      gradePass.uniforms.saturation.value = baseSat * (1 - 0.18 * w);
      gradePass.uniforms.contrast.value = baseContrast * (1 + 0.05 * w);
      if (godrayPass) godrayPass.uniforms.strength.value *= (1 - 0.75 * w); // no sun shafts in rain
    } else {
      // Fully restore the grade/fog once clear.
      gradePass.uniforms.exposure.value = baseExposure;
      gradePass.uniforms.saturation.value = baseSat;
      gradePass.uniforms.contrast.value = baseContrast;
      fog.near = baseFogNear; fog.far = baseFogFar;
    }
  }

  return { group, update, toggle, setRaining, get raining() { return raining; }, get wet() { return wet; } };
}
