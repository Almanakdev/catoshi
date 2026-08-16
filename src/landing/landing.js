// CATOSHI landing page — story-scroll flow + wallet gate + subpages.
// Vanilla JS + GSAP (project is not React/shadcn; this mirrors story-scroll.tsx).

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { GAME } from '../config.js';
import { writeSession } from '../ui/walletStatus.js';
import { IS_TOUCH } from '../engine/device.js';

gsap.registerPlugin(ScrollTrigger);

/**
 * The pin-and-rotate stack is a desktop effect. On a phone each panel is pinned
 * against a viewport whose height changes every time the URL bar slides, which
 * makes ScrollTrigger recalculate mid-scroll and the whole stack judder; the
 * rotated panels also overflow a narrow screen. Below this width the sections
 * become ordinary stacked blocks (see the `max-width: 820px` rules in
 * landing.css) and only the fade-up reveals survive.
 */
const PIN_MIN_WIDTH = 821;
const canPin = () => typeof window !== 'undefined' && window.innerWidth >= PIN_MIN_WIDTH;

const BUY = GAME.robinhoodUrl || 'https://www.sushi.com/robinhood/launchpad/token/0x4af955ec23941363FAcD33A9562C611f2cBAC68b';
const TWITTER = GAME.twitterUrl || 'https://x.com/catoshi';
const CA = GAME.ca || '';

function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

/**
 * Story-scroll stack (mirrors story-scroll.tsx / 21st.dev-style flow):
 * each section pins while the next one rotates in from ~30° (bottom-left origin).
 * Scroll lives on `#landing` (position:fixed + overflow:auto), so every
 * ScrollTrigger must use that element as `scroller` — window never moves.
 */
function setupFlowArt(container, scroller) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !container) return () => {};

  const sections = Array.from(container.querySelectorAll('[data-flow-section]'));
  if (!sections.length) return () => {};

  const pin = canPin();
  const scrollRoot = scroller || container.closest('#landing') || window;
  const ctx = gsap.context(() => {
    sections.forEach((section, i) => {
      gsap.set(section, { zIndex: i + 1, force3D: true });
      const inner = section.querySelector('.flow-art-container');
      if (!inner) return;

      // Soft content rise as each panel settles into view.
      // (Hero plays on load so it never stays stuck at autoAlpha:0.)
      const bits = inner.querySelectorAll(
        '.flow-kicker, .flow-title, .flow-lead, .flow-grid, .flow-more, .lp-hero-actions, .lp-cta-panel, .lp-btn, .lp-big-sushi',
      );
      if (bits.length) {
        gsap.set(bits, { autoAlpha: 0, y: 28 });
        if (i === 0) {
          gsap.to(bits, {
            autoAlpha: 1,
            y: 0,
            duration: 0.75,
            stagger: 0.07,
            ease: 'power2.out',
            delay: 0.08,
          });
        } else {
          gsap.to(bits, {
            autoAlpha: 1,
            y: 0,
            duration: 0.7,
            stagger: 0.06,
            ease: 'power2.out',
            scrollTrigger: {
              scroller: scrollRoot,
              trigger: section,
              start: 'top 65%',
              toggleActions: 'play none none reverse',
            },
          });
        }
      }

      if (!pin) return;   // phones keep the reveals, drop the stack

      if (i > 0) {
        gsap.set(inner, {
          rotation: 30,
          transformOrigin: 'bottom left',
          force3D: true,
        });
        gsap.to(inner, {
          rotation: 0,
          ease: 'none',
          scrollTrigger: {
            scroller: scrollRoot,
            trigger: section,
            start: 'top bottom',
            end: 'top 20%',
            scrub: true,
            invalidateOnRefresh: true,
          },
        });
      } else {
        gsap.set(inner, { transformOrigin: 'bottom left' });
      }

      // Pin every panel except the last so the next can rotate over it.
      if (i < sections.length - 1) {
        ScrollTrigger.create({
          scroller: scrollRoot,
          trigger: section,
          start: 'bottom bottom',
          end: 'bottom top',
          pin: true,
          pinSpacing: false,
          anticipatePin: 1,
          invalidateOnRefresh: true,
        });
      }
    });
  }, container);

  // Layout can shift once hero art loads.
  const imgs = container.querySelectorAll('img');
  const onImg = () => ScrollTrigger.refresh();
  imgs.forEach((img) => {
    if (!img.complete) img.addEventListener('load', onImg, { once: true });
  });
  requestAnimationFrame(() => ScrollTrigger.refresh());

  return () => {
    imgs.forEach((img) => img.removeEventListener('load', onImg));
    ctx.revert();
  };
}

/** @param {NodeListOf<Element>|Element[]} nodes every place the count is shown. */
function dynamicOnlineCount(nodes) {
  const list = Array.from(nodes || []);
  if (!list.length) return;
  // Base ~796, drifts gently so it feels live.
  let n = 796 + Math.floor(Math.random() * 40) - 20;
  const paint = () => {
    n += Math.floor(Math.random() * 7) - 3;
    n = Math.max(740, Math.min(920, n));
    const text = `${n.toLocaleString()} players online`;
    for (const el of list) el.textContent = text;
  };
  paint();
  return setInterval(paint, 3500 + Math.random() * 2500);
}

function wireReadMore(root) {
  root.querySelectorAll('[data-read-more]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-read-more');
      const full = root.querySelector(`[data-full="${id}"]`);
      if (!full) return;
      const open = full.classList.toggle('open');
      btn.textContent = open ? 'Show less' : 'Read more';
    });
  });
}

function wireBuyButtons(root) {
  root.querySelectorAll('[data-buy-coin]').forEach((btn) => {
    // Anchors keep a real Robinhood href; buttons open the same URL.
    if (btn.tagName === 'A') {
      btn.setAttribute('href', BUY);
      btn.setAttribute('target', '_blank');
      btn.setAttribute('rel', 'noopener noreferrer');
    }
    btn.addEventListener('click', (e) => {
      if (btn.tagName === 'A') return; // native navigation
      e.preventDefault();
      window.open(BUY, '_blank', 'noopener,noreferrer');
    });
  });
}

/**
 * Cursor-reactive sushi: tilts / shifts toward the pointer, squashes on press.
 * Transforms apply to the inner float node so GSAP can still fade the outer shell.
 */
function wireInteractiveSushi(root) {
  const sushi = root.querySelector('.lp-big-sushi');
  const track = sushi && sushi.querySelector('.lp-big-sushi-float');
  const hero = root.querySelector('.lp-hero') || root;
  if (!sushi || !track) return () => {};

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return () => {};
  // On a phone the sushi is a background watermark sitting in the middle of the
  // scroll path (landing.css turns off its pointer events). Tracking a "cursor"
  // there would only mean stealing swipes meant for the page.
  if (IS_TOUCH || !canPin()) return () => {};

  // JS owns motion on the track (idle bob + cursor) — pause CSS keyframes.
  sushi.classList.add('is-live');

  let targetX = 0;
  let targetY = 0;
  let curX = 0;
  let curY = 0;
  let scale = 1;
  let targetScale = 1;
  let hot = false;
  let dragging = false;
  let raf = 0;
  let bounceT = 0;
  let t0 = performance.now();

  const MAX_TILT = 16;
  const MAX_SHIFT = 28;

  const apply = (idleY, idleR) => {
    const rx = (-curY * MAX_TILT).toFixed(2);
    const ry = (curX * MAX_TILT).toFixed(2);
    const tx = (curX * MAX_SHIFT).toFixed(2);
    const ty = (curY * MAX_SHIFT + idleY).toFixed(2);
    track.style.transform =
      `translate3d(${tx}px, ${ty}px, 0) rotateX(${rx}deg) rotateY(${ry}deg) rotate(${idleR.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
  };

  const tick = (now) => {
    curX += (targetX - curX) * 0.14;
    curY += (targetY - curY) * 0.14;
    scale += (targetScale - scale) * 0.18;
    if (bounceT > 0) {
      bounceT -= 1;
      if (bounceT <= 0) targetScale = hot ? 1.08 : 1;
    }
    const t = (now - t0) / 1000;
    // Gentle idle bob when the pointer is far away
    const idleAmp = hot || dragging ? 2 : 8;
    const idleY = Math.sin(t * 1.15) * idleAmp;
    const idleR = Math.sin(t * 0.9) * (hot ? 1 : 2);
    apply(idleY, idleR);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const setFromEvent = (e) => {
    const rect = sushi.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    const nx = (e.clientX - cx) / Math.max(rect.width * 0.5, 1);
    const ny = (e.clientY - cy) / Math.max(rect.height * 0.5, 1);
    targetX = Math.max(-1, Math.min(1, nx));
    targetY = Math.max(-1, Math.min(1, ny));
  };

  const onHeroMove = (e) => {
    setFromEvent(e);
    const rect = sushi.getBoundingClientRect();
    const pad = 56;
    const near =
      e.clientX >= rect.left - pad &&
      e.clientX <= rect.right + pad &&
      e.clientY >= rect.top - pad &&
      e.clientY <= rect.bottom + pad;
    if (near !== hot) {
      hot = near;
      sushi.classList.toggle('is-hot', hot);
      if (!dragging && bounceT <= 0) targetScale = hot ? 1.08 : 1;
    }
  };

  const onLeaveHero = () => {
    if (dragging) return;
    hot = false;
    sushi.classList.remove('is-hot');
    targetX = 0;
    targetY = 0;
    targetScale = 1;
  };

  const onDown = (e) => {
    dragging = true;
    targetScale = 0.94;
    sushi.classList.add('is-hot');
    hot = true;
    sushi.setPointerCapture?.(e.pointerId);
    setFromEvent(e);
    e.preventDefault();
  };

  const onUp = (e) => {
    if (!dragging) return;
    dragging = false;
    try { sushi.releasePointerCapture?.(e.pointerId); } catch { /* already released */ }
    targetScale = 1.14;
    bounceT = 14;
  };

  hero.addEventListener('pointermove', onHeroMove);
  hero.addEventListener('pointerleave', onLeaveHero);
  sushi.addEventListener('pointerdown', onDown);
  sushi.addEventListener('pointerup', onUp);
  sushi.addEventListener('pointercancel', onUp);
  window.addEventListener('pointerup', onUp);

  return () => {
    cancelAnimationFrame(raf);
    hero.removeEventListener('pointermove', onHeroMove);
    hero.removeEventListener('pointerleave', onLeaveHero);
    sushi.removeEventListener('pointerdown', onDown);
    sushi.removeEventListener('pointerup', onUp);
    sushi.removeEventListener('pointercancel', onUp);
    window.removeEventListener('pointerup', onUp);
    track.style.transform = '';
    sushi.classList.remove('is-hot', 'is-live');
  };
}

function wireCopyCa(root) {
  root.querySelectorAll('[data-copy-ca]').forEach((btn) => {
    const act = btn.querySelector('.ca-act');
    const addr = btn.querySelector('.ca-addr');
    const isBar = btn.classList.contains('lp-ca-bar');
    if (addr) {
      // Full CA on the main bar when space allows; short form on compact chips.
      if (!CA) {
        addr.textContent = 'Coming soon';
      } else if (isBar) {
        addr.textContent = CA;
        addr.title = CA;
      } else {
        addr.textContent = CA.length > 16 ? `${CA.slice(0, 6)}…${CA.slice(-4)}` : CA;
      }
    }
    if (!CA) {
      btn.disabled = true;
      if (act) act.textContent = 'Soon';
      return;
    }
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(CA);
        if (act) {
          const prev = act.textContent;
          act.textContent = 'Copied!';
          setTimeout(() => { act.textContent = prev || 'Copy'; }, 1400);
        }
      } catch {
        if (act) act.textContent = 'Select & copy';
      }
    });
  });
}

function fakeWalletAddress(provider) {
  const hex = '0123456789abcdef';
  let s = provider === 'demo' ? '0xde10' : '0x';
  while (s.length < 42) s += hex[Math.floor(Math.random() * hex.length)];
  return s.slice(0, 42);
}

/**
 * @param {{ onPlay: (session: object) => void, audio?: { unlock?:()=>void, play?:(n:string)=>void } }} opts
 */
export function createLanding(opts = {}) {
  const root = document.getElementById('landing');
  if (!root) {
    console.warn('[landing] #landing missing');
    return { show() {}, hide() {}, destroy() {} };
  }

  const mainView = root.querySelector('#lp-main');
  const pages = {
    whitepaper: root.querySelector('#page-whitepaper'),
    lore: root.querySelector('#page-lore'),
    earn: root.querySelector('#page-earn'),
    tokenomics: root.querySelector('#page-tokenomics'),
  };
  const gate = document.getElementById('wallet-gate');
  const onlineTimer = dynamicOnlineCount(root.querySelectorAll('[data-online-count]'));
  const flowRoot = root.querySelector('.flow-main');
  // Landing owns the scroll; lock the document so window ScrollTriggers never drift.
  document.body.style.overflow = 'hidden';
  // #landing is the scroll container (fixed overlay) — pass it explicitly.
  let killFlow = setupFlowArt(flowRoot, root);
  let killSushi = wireInteractiveSushi(root);

  wireReadMore(root);
  wireBuyButtons(root);
  wireCopyCa(root);

  // Twitter
  root.querySelectorAll('[data-twitter]').forEach((a) => {
    a.setAttribute('href', TWITTER);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });

  function showMain() {
    Object.values(pages).forEach((p) => p && p.classList.remove('show'));
    if (mainView) mainView.style.display = '';
    // rebuild flow after layout change
    if (killFlow) killFlow();
    if (killSushi) killSushi();
    root.scrollTop = 0;
    killFlow = setupFlowArt(flowRoot, root);
    killSushi = wireInteractiveSushi(root);
    requestAnimationFrame(() => ScrollTrigger.refresh());
  }

  function showPage(name) {
    if (killFlow) {
      killFlow();
      killFlow = null;
    }
    if (killSushi) {
      killSushi();
      killSushi = null;
    }
    if (mainView) mainView.style.display = 'none';
    Object.entries(pages).forEach(([k, el]) => {
      if (!el) return;
      el.classList.toggle('show', k === name);
    });
    root.scrollTop = 0;
  }

  // ---------------------------------------------------------- mobile drawer
  const navToggle = root.querySelector('[data-nav-toggle]');
  function setDrawer(open) {
    root.classList.toggle('nav-open', !!open);
    if (navToggle) navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if (navToggle) {
    navToggle.addEventListener('click', (e) => {
      e.preventDefault();
      setDrawer(!root.classList.contains('nav-open'));
      if (opts.audio && opts.audio.play) opts.audio.play('click');
    });
  }
  // Anything that navigates or launches closes the drawer behind it.
  root.querySelectorAll('[data-page], [data-play-now], [data-buy-coin], [data-back-main]')
    .forEach((b) => b.addEventListener('click', () => setDrawer(false)));

  root.querySelectorAll('[data-page]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const name = btn.getAttribute('data-page');
      if (name === 'home') showMain();
      else showPage(name);
      if (opts.audio && opts.audio.play) opts.audio.play('click');
    });
  });
  root.querySelectorAll('[data-back-main]').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.preventDefault(); showMain(); });
  });

  // ------------------------------------------------------------ orientation
  // Crossing the pin breakpoint (a rotation, or a desktop window drag) changes
  // which animation set is correct, so the flow is rebuilt — but only on a real
  // crossing, never on the constant height nudges a scrolling URL bar produces.
  let wasPinning = canPin();
  let resizeT = 0;
  function onResize() {
    const now = canPin();
    if (now === wasPinning) { ScrollTrigger.refresh(); return; }
    wasPinning = now;
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      if (root.classList.contains('hidden-display')) return;
      const onMain = !mainView || mainView.style.display !== 'none';
      if (onMain) showMain();
    }, 180);
  }
  window.addEventListener('resize', onResize, { passive: true });

  // Play Now → wallet
  function openGate() {
    if (!gate) {
      // fallback: demo session
      enterWithSession({
        username: 'Chef',
        wallet: { provider: 'demo', address: fakeWalletAddress('demo') },
      });
      return;
    }
    gate.classList.add('show');
    const input = gate.querySelector('#wg-username');
    if (input) input.focus();
    if (opts.audio && opts.audio.play) opts.audio.play('ui_open');
  }
  function closeGate() {
    if (gate) gate.classList.remove('show');
  }

  root.querySelectorAll('[data-play-now]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openGate();
    });
  });

  let selectedWallet = 'demo';
  if (gate) {
    gate.querySelectorAll('[data-wallet]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedWallet = btn.getAttribute('data-wallet') || 'demo';
        gate.querySelectorAll('[data-wallet]').forEach((b) => {
          b.classList.toggle('selected', b === btn);
        });
      });
    });
    const cancel = gate.querySelector('[data-wg-cancel]');
    if (cancel) cancel.addEventListener('click', closeGate);
    const connect = gate.querySelector('[data-wg-connect]');
    if (connect) {
      connect.addEventListener('click', () => {
        const input = gate.querySelector('#wg-username');
        const err = gate.querySelector('.wg-err');
        const name = (input && input.value || '').trim().slice(0, 20);
        if (!name || name.length < 2) {
          if (err) err.textContent = 'Pick a username (2–20 characters).';
          return;
        }
        if (err) err.textContent = '';
        // Demo / soft-connect: we store a session; real wallet extension hooks can replace this later.
        const session = {
          username: name,
          wallet: {
            provider: selectedWallet,
            address: fakeWalletAddress(selectedWallet),
          },
          at: Date.now(),
        };
        enterWithSession(session);
      });
    }
    gate.addEventListener('click', (e) => {
      if (e.target === gate) closeGate();
    });
  }

  function enterWithSession(session) {
    writeSession(session);
    closeGate();
    hide();
    if (opts.audio && opts.audio.unlock) opts.audio.unlock();
    if (opts.audio && opts.audio.play) opts.audio.play('good');
    if (typeof opts.onPlay === 'function') opts.onPlay(session);
  }

  function hide() {
    root.classList.add('gone');
    setDrawer(false);
    if (killFlow) {
      killFlow();
      killFlow = null;
    }
    if (killSushi) {
      killSushi();
      killSushi = null;
    }
    setTimeout(() => root.classList.add('hidden-display'), 480);
    document.body.style.overflow = 'hidden';
  }

  function show() {
    root.classList.remove('gone', 'hidden-display');
    setDrawer(false);
    document.body.style.overflow = 'hidden';
    showMain();
    requestAnimationFrame(() => ScrollTrigger.refresh());
  }

  // Landing backsound loop (subtle): unlocked on first gesture
  let landAudio = null;
  function unlockLandingAudio() {
    if (landAudio || !opts.audio) return;
    if (opts.audio.unlock) opts.audio.unlock();
    if (opts.audio.setMusicTrack) opts.audio.setMusicTrack('neon');
    if (opts.audio.setAmbience) opts.audio.setAmbience('festival');
    landAudio = true;
  }
  root.addEventListener('pointerdown', unlockLandingAudio, { once: true });

  // Hash routes for shareable pages
  const hash = (location.hash || '').replace('#', '');
  if (hash && pages[hash]) showPage(hash);

  return {
    show,
    hide,
    openGate,
    enterWithSession,
    destroy() {
      if (onlineTimer) clearInterval(onlineTimer);
      clearTimeout(resizeT);
      window.removeEventListener('resize', onResize);
      if (killFlow) killFlow();
      if (killSushi) killSushi();
    },
  };
}

export default createLanding;
