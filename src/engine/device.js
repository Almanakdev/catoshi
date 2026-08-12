// One place that answers "what kind of device is this?".
//
// Three facts drive every mobile decision in the game: whether the primary
// pointer is a finger, whether the viewport is phone-sized, and how tall the
// *visible* viewport is right now — mobile browsers shrink it as the URL bar
// slides in and out, which is why `100vh` overflows on a phone.
//
// The answers are written onto <html> as classes and CSS custom properties so
// stylesheets can react without importing anything:
//   .is-touch / .is-phone / .is-landscape   and   --app-vh, --app-vw
//
// `?touch=1` forces the touch layout on a desktop (handy for testing);
// `?touch=0` forces it off on a phone.

const hasWindow = typeof window !== 'undefined';

function mq(query) {
  if (!hasWindow || !window.matchMedia) return null;
  try { return window.matchMedia(query); } catch { return null; }
}

function override() {
  if (!hasWindow) return null;
  try {
    const v = new URLSearchParams(window.location.search).get('touch');
    if (v === '1') return true;
    if (v === '0') return false;
  } catch { /* opaque origin */ }
  return null;
}

const FORCED = override();
const coarse = mq('(pointer: coarse)');
const noHover = mq('(hover: none)');

/**
 * True when fingers are the primary input. A touchscreen laptop reports
 * `maxTouchPoints > 0` but still has a fine, hovering pointer, so it stays
 * false there — those users want the desktop layout.
 */
export const IS_TOUCH = FORCED != null
  ? FORCED
  : !!((coarse && coarse.matches) || (noHover && noHover.matches));

/** Phone-sized viewport (either orientation). Tablets fall outside this. */
export function isPhone() {
  if (!hasWindow) return false;
  const w = window.innerWidth || 0;
  const h = window.innerHeight || 0;
  return Math.min(w, h) <= 520 || w <= 820;
}

/** A short viewport — landscape phones, where vertical space is the scarce one. */
export function isShort() {
  return hasWindow ? (window.innerHeight || 0) <= 560 : false;
}

/**
 * Viewport height that accounts for the on-screen keyboard and the collapsing
 * URL bar. Falls back to innerHeight where visualViewport is missing.
 */
export function viewportHeight() {
  if (!hasWindow) return 0;
  const vv = window.visualViewport;
  return Math.round((vv && vv.height) || window.innerHeight || 0);
}

const listeners = new Set();

function paint() {
  if (!hasWindow || !document.documentElement) return;
  const root = document.documentElement;
  const phone = isPhone();
  root.classList.toggle('is-touch', IS_TOUCH);
  root.classList.toggle('is-phone', phone);
  root.classList.toggle('is-landscape', (window.innerWidth || 0) > (window.innerHeight || 0));
  root.classList.toggle('is-short', isShort());
  // 1% of the *visible* height — `calc(var(--app-vh) * 100)` is a `100vh` that
  // does not slide under the browser chrome.
  root.style.setProperty('--app-vh', `${viewportHeight() / 100}px`);
  root.style.setProperty('--app-vw', `${(window.innerWidth || 0) / 100}px`);
  for (const cb of listeners) {
    try { cb(); } catch (err) { console.error('[device] listener threw', err); }
  }
}

let wired = false;

/** Start writing the classes and vars. Safe to call more than once. */
export function initDevice() {
  if (!hasWindow || wired) { paint(); return; }
  wired = true;
  paint();
  window.addEventListener('resize', paint, { passive: true });
  window.addEventListener('orientationchange', () => {
    // iOS reports the old size for a frame or two after the rotation lands.
    paint();
    setTimeout(paint, 120);
    setTimeout(paint, 420);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', paint, { passive: true });
  }
}

/** Run `cb` whenever the viewport changes shape. Returns an unsubscribe. */
export function onViewportChange(cb) {
  if (typeof cb !== 'function') return () => {};
  listeners.add(cb);
  return () => listeners.delete(cb);
}
