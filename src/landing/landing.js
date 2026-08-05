// CATOSHI landing page — story-scroll flow + wallet gate + subpages.
// Vanilla JS + GSAP (project is not React/shadcn; this mirrors story-scroll.tsx).

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { GAME } from '../config.js';
import { writeSession } from '../ui/walletStatus.js';

gsap.registerPlugin(ScrollTrigger);

const PUMP = GAME.pumpfunUrl || 'https://pump.fun';
const TWITTER = GAME.twitterUrl || 'https://x.com/catoshi';
const CA = GAME.ca || '';

function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

function setupFlowArt(container) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !container) return () => {};

  const sections = Array.from(container.querySelectorAll('[data-flow-section]'));
  if (!sections.length) return () => {};
  const triggers = [];

  sections.forEach((section, i) => {
    gsap.set(section, { zIndex: i + 1 });
    const inner = section.querySelector('.flow-art-container');
    if (!inner) return;
    if (i > 0) {
      gsap.set(inner, { rotation: 30, transformOrigin: 'bottom left' });
      const tween = gsap.to(inner, {
        rotation: 0,
        ease: 'none',
        scrollTrigger: {
          trigger: section,
          start: 'top bottom',
          end: 'top 25%',
          scrub: true,
        },
      });
      if (tween.scrollTrigger) triggers.push(tween.scrollTrigger);
    }
    if (i < sections.length - 1) {
      triggers.push(
        ScrollTrigger.create({
          trigger: section,
          start: 'bottom bottom',
          end: 'bottom top',
          pin: true,
          pinSpacing: false,
        }),
      );
    }
  });
  ScrollTrigger.refresh();
  return () => triggers.forEach((t) => t.kill());
}

function dynamicOnlineCount(el) {
  if (!el) return;
  // Base ~796, drifts gently so it feels live.
  let n = 796 + Math.floor(Math.random() * 40) - 20;
  const paint = () => {
    n += Math.floor(Math.random() * 7) - 3;
    n = Math.max(740, Math.min(920, n));
    el.textContent = `${n.toLocaleString()} players online`;
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
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      window.open(PUMP, '_blank', 'noopener,noreferrer');
    });
  });
}

function wireCopyCa(root) {
  root.querySelectorAll('[data-copy-ca]').forEach((btn) => {
    const act = btn.querySelector('.ca-act');
    const addr = btn.querySelector('.ca-addr');
    if (addr) {
      const short = CA.length > 16 ? `${CA.slice(0, 6)}…${CA.slice(-4)}` : CA || 'Coming soon';
      addr.textContent = short;
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
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let s = provider === 'demo' ? 'Demo' : '';
  while (s.length < 44) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s.slice(0, 44);
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
  const onlineEl = root.querySelector('[data-online-count]');
  const onlineTimer = dynamicOnlineCount(onlineEl);
  const flowRoot = root.querySelector('.flow-main');
  let killFlow = setupFlowArt(flowRoot);

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
    killFlow = setupFlowArt(flowRoot);
    window.scrollTo(0, 0);
  }

  function showPage(name) {
    if (mainView) mainView.style.display = 'none';
    Object.entries(pages).forEach(([k, el]) => {
      if (!el) return;
      el.classList.toggle('show', k === name);
    });
    window.scrollTo(0, 0);
  }

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
    setTimeout(() => root.classList.add('hidden-display'), 480);
    document.body.style.overflow = 'hidden';
  }

  function show() {
    root.classList.remove('gone', 'hidden-display');
    document.body.style.overflow = '';
    showMain();
    ScrollTrigger.refresh();
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
      if (killFlow) killFlow();
    },
  };
}

export default createLanding;
