// Simulated MMO social layer (chat + leaderboard) — ported from ENGINE CITY.
// Markup lives in index.html (#social). Nothing here is networked.

import { isTypingInUI } from '../engine/inputGuard.js';

const CHATTER = [
  'best salmon in Catoshi rn', 'anyone at the market?', 'CATOSHI to the moon 🍣',
  'gg', 'master kuro is goated', 'who just meowed at me',
  'first time here, city is huge', 'buy $CATOSHI on pumpfun', 'lost downtown again',
  'that neon street tho 🔥', 'meet at the harbor?', 'cooking a perfect roll',
  'press E at the stall', 'ty!', 'the lanterns at night slap',
  'sprinting everywhere is the only way', 'my fps is finally stable',
  'found a rooftop with a great view', 'nice headband', 'blue cat supremacy',
  'is it raining for everyone', 'race to the sushi cart?', 'im in',
  'wait you can upgrade the shop?', 'yeah the sign by the door', 'city looks unreal at dusk',
  'anybody fishing?', 'omw', 'new high score lets go', 'grats',
  'journal is Q btw', 'been walking for 20 mins straight',
  'the purple sky hits different', 'ok who is on the leaderboard',
];

const JOIN_LINES = ['joined Catoshi', 'connected', 'is exploring the alleys'];

function nameColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 72% 72%)`;
}

export function createSocialUI(opts = {}) {
  const { myName = 'You' } = opts;
  let names = opts.names || [];

  const root = document.getElementById('social');
  const feed = document.getElementById('chat-feed');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const lbList = document.getElementById('lb-list');
  const lbCount = document.getElementById('lb-count');
  if (!root || !feed || !form || !input || !lbList) {
    console.warn('[socialUI] overlay markup missing');
    return { show() {}, hide() {}, update() {}, addScore() {}, post() {}, setNames() {} };
  }

  const MAX_LINES = 70;

  function post(who, text, kind) {
    const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 24;
    const line = document.createElement('div');
    line.className = 'chat-line' + (kind ? ` ${kind}` : '');
    if (kind === 'sys') {
      line.textContent = `${who} ${text}`;
    } else {
      const w = document.createElement('span');
      w.className = 'who';
      w.style.color = kind === 'me' ? '#ffd88a' : nameColor(who);
      w.textContent = who;
      line.append(w, document.createTextNode(' ' + text));
    }
    feed.appendChild(line);
    while (feed.childElementCount > MAX_LINES) feed.removeChild(feed.firstChild);
    if (atBottom) feed.scrollTop = feed.scrollHeight;
  }

  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
  let nextChat = 1.5;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim().slice(0, 140);
    if (!text) return;
    post(myName, text, 'me');
    input.value = '';
    input.blur();
    addScore(2);
    if (names.length && Math.random() < 0.55) {
      setTimeout(() => post(rand(names), rand(CHATTER), null), 900 + Math.random() * 2600);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' && !isTypingInUI() && root.classList.contains('show')) {
      e.preventDefault();
      input.focus();
    } else if (e.code === 'Escape' && document.activeElement === input) {
      e.preventDefault();
      input.blur();
    }
  });

  const meEntry = { name: myName, score: 0, rate: 0, me: true };
  const board = [meEntry];

  const addPlayers = (list) => {
    for (const name of list) {
      if (board.some((e) => e.name === name)) continue;
      board.push({
        name,
        score: 40 + Math.floor(Math.random() * 900),
        rate: 0.6 + Math.random() * 3.4,
        me: false,
      });
    }
  };
  addPlayers(names);

  function setNames(list) {
    names = list || [];
    addPlayers(names);
    if (root.classList.contains('show')) renderBoard();
  }

  let lbTimer = 0;
  const rowEls = [];

  function renderBoard() {
    board.sort((a, b) => b.score - a.score);
    const myRank = board.indexOf(meEntry) + 1;
    const shown = board.slice(0, 8);
    if (myRank > shown.length) shown[shown.length - 1] = meEntry;

    for (let i = 0; i < shown.length; i++) {
      let row = rowEls[i];
      if (!row) {
        row = document.createElement('div');
        row.className = 'lb-row';
        row.innerHTML = '<span class="lb-rank"></span><span class="lb-name"></span><span class="lb-score"></span>';
        lbList.appendChild(row);
        rowEls.push(row);
      }
      const e = shown[i];
      const rank = e === meEntry ? myRank : i + 1;
      row.classList.toggle('me', !!e.me);
      row.children[0].textContent = rank;
      row.children[1].textContent = e.name;
      row.children[1].style.color = e.me ? '#ffd88a' : nameColor(e.name);
      row.children[2].textContent = Math.floor(e.score).toLocaleString();
    }
    if (lbCount) lbCount.textContent = `${board.length} online`;
  }

  function addScore(n) {
    meEntry.score += n;
  }

  let lastX = null, lastZ = null;

  function update(dt, playerPos) {
    if (!root.classList.contains('show')) return;
    for (let i = 0; i < board.length; i++) {
      const e = board[i];
      if (e.me) continue;
      e.score += e.rate * dt;
      if (Math.random() < dt * 0.06) e.score += 20 + Math.random() * 120;
    }
    if (playerPos) {
      if (lastX !== null) {
        const dx = playerPos.x - lastX, dz = playerPos.z - lastZ;
        meEntry.score += Math.sqrt(dx * dx + dz * dz) * 0.12;
      }
      lastX = playerPos.x;
      lastZ = playerPos.z;
    }
    lbTimer -= dt;
    if (lbTimer <= 0) { lbTimer = 0.5; renderBoard(); }

    nextChat -= dt;
    if (nextChat <= 0 && names.length) {
      nextChat = 3 + Math.random() * 7;
      if (Math.random() < 0.08) post(rand(names), rand(JOIN_LINES), 'sys');
      else post(rand(names), rand(CHATTER), null);
    }
  }

  function show() {
    root.classList.add('show');
    renderBoard();
    post('Server', 'Welcome to Catoshi. Press Enter to chat.', 'sys');
  }
  function hide() { root.classList.remove('show'); root.classList.remove('chat-open'); }

  /**
   * Phones dock the chat off-screen (see the `.chat-open` rules in landing.css)
   * because the bottom-right corner belongs to the action buttons. The touch
   * menu slides it back in with this.
   */
  function toggleChat(v) {
    const open = v == null ? !root.classList.contains('chat-open') : !!v;
    root.classList.toggle('chat-open', open);
    if (open) input.focus();
    else input.blur();
    return open;
  }

  const closeBtn = document.getElementById('chat-close');
  if (closeBtn) closeBtn.addEventListener('click', () => toggleChat(false));

  return { show, hide, update, addScore, post, setNames, toggleChat };
}
