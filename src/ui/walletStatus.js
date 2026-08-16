// Reads the session the landing page wrote and shows who is playing.

import { GAME } from '../config.js';

const PROVIDER_LABEL = {
  metamask: 'MetaMask',
  trust: 'Trust Wallet',
  demo: 'Demo Wallet',
};

function shortenAddress(address, lead = 4, tail = 4) {
  if (typeof address !== 'string' || address.length <= lead + tail + 1) return address || '';
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

export function readSession() {
  try {
    const raw = window.sessionStorage.getItem(GAME.sessionKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.username !== 'string' || !parsed.username) return null;
    if (!parsed.wallet || typeof parsed.wallet.provider !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSession(session) {
  try {
    window.sessionStorage.setItem(GAME.sessionKey, JSON.stringify(session));
  } catch { /* private mode */ }
}

export function clearSession() {
  try { window.sessionStorage.removeItem(GAME.sessionKey); } catch { /* ignore */ }
}

export function createWalletStatus() {
  const el = document.getElementById('wallet');
  const nameEl = document.getElementById('wallet-name');
  const addrEl = document.getElementById('wallet-addr');
  const providerEl = document.getElementById('wallet-provider');
  if (!el) return { show() {}, hide() {}, session: null };

  const session = readSession();
  if (!session) {
    el.classList.remove('show');
    return { show() {}, hide() {}, session: null };
  }

  if (nameEl) nameEl.textContent = session.username;
  if (addrEl) {
    const addr = session.wallet.address || '';
    addrEl.textContent = shortenAddress(addr);
    addrEl.title = addr;
  }
  if (providerEl) {
    providerEl.textContent = PROVIDER_LABEL[session.wallet.provider] || 'Wallet';
  }

  return {
    show: () => el.classList.add('show'),
    hide: () => el.classList.remove('show'),
    session,
  };
}
