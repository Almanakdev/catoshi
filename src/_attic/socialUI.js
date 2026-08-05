import { isTypingInUI } from './inputGuard.js';

// Two lightweight HTML/CSS overlays that make the city feel like a populated
// server (nothing here is networked — it's all simulated locally):
//
//  · Chat (bottom right)   a scrolling feed of chatter from the same usernames
//                          that are walking around outside, plus an input so you
//                          can post into the feed yourself.
//  · Leaderboard (top left) you + every simulated player, ranked by score, with
//                          the others' scores creeping up over time.
//
// Markup + styling live in index.html; this module only drives them. Every
// global keybind in the game routes through isTypingInUI(), so typing "swords"
// in the chat box doesn't walk the character into a wall.

const CHATTER = [
  'anyone know where the ramen place is', 'this view from the tower is unreal',
  'gg', 'who just jumped off the pier lol', 'brb food', 'the monorail is so relaxing',
  'first time here, city is huge', 'anyone selling?', 'i keep getting lost downtown',
  'that sunset tho 🔥', 'meet at the park?', 'lag spike, one sec',
  'how do you get up to the platform', 'press E at the door', 'ty!',
  'the lighthouse actually works at night', 'sprinting everywhere is the only way',
  'my fps is finally stable', 'anyone else exploring the docks',
  'found a rooftop with a great view', 'nice outfit', 'thanks lol took me ages',
  'is it raining for everyone or just me', 'crouch walking is so goofy',
  'race to the bridge?', 'im in', 'go go go', 'wrong way haha',
  'the ferris wheel is spinning again', 'wait you can go inside the shops?',
  'yeah the ones with the glowing markers', 'city looks unreal at golden hour',
  'anybody at the station', 'omw', 'new high score lets go', 'grats',
  'i main the tall avatar', 'jump is way floatier than i expected',
  'someone punched me', 'lmao sorry wrong key', 'been walking for 20 mins straight',
  'the park grass moves in the wind, nice touch', 'ok who is on top of the tower',
  'that was me', 'how did you even get up there', 'stairs at the station',
];

const JOIN_LINES = ['joined the city', 'connected', 'is exploring downtown'];

// Stable per-name colour so a username always reads the same in chat + board.
function nameColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 72% 68%)`;
}

export function createSocialUI(opts = {}) {
  const { myName = 'You' } = opts;
  // The crowd's usernames arrive asynchronously (the five VRMs have to load
  // before the population exists), so the feed starts quiet and fills in.
  let names = opts.names || [];

  const root = document.getElementById('social');
  const feed = document.getElementById('chat-feed');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const lbList = document.getElementById('lb-list');
  const lbCount = document.getElementById('lb-count');
  if (!root || !feed || !form || !input || !lbList) {
    console.warn('socialUI: overlay markup missing');
    return { show() {}, update() {}, addScore() {}, post() {}, setNames() {} };
  }

  // ---- Chat -----------------------------------------------------------------
  const MAX_LINES = 70; // trimmed from the top so the DOM never grows unbounded

  function post(who, text, kind) {
    // Only auto-scroll if the player is already at the bottom — otherwise a new
    // message would yank them out of whatever they scrolled back to read.
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
      line.append(w, document.createTextNode(text));
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
    input.blur();          // hand the keyboard straight back to the character
    addScore(2);           // being social pays
    // A plausible reply lands a beat later, so your message doesn't sit alone.
    if (names.length && Math.random() < 0.55) {
      setTimeout(() => post(rand(names), rand(CHATTER), null), 900 + Math.random() * 2600);
    }
  });

  // Enter focuses the chat (the standard MMO reflex); Esc gives the game back.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' && !isTypingInUI() && root.classList.contains('show')) {
      e.preventDefault();
      input.focus();
    } else if (e.code === 'Escape' && document.activeElement === input) {
      e.preventDefault();
      input.blur();
    }
  });

  // ---- Leaderboard ----------------------------------------------------------
  // Everyone starts somewhere plausible so the board isn't all zeroes on load.
  const meEntry = { name: myName, score: 0, rate: 0, me: true };
  const board = [meEntry];

  const addPlayers = (list) => {
    for (const name of list) {
      if (board.some((e) => e.name === name)) continue;
      board.push({
        name,
        score: 40 + Math.floor(Math.random() * 900),
        rate: 0.6 + Math.random() * 3.4, // points per second, on average
        me: false,
      });
    }
  };
  addPlayers(names);

  // Called when the crowd finishes spawning and its usernames are known.
  function setNames(list) {
    names = list;
    addPlayers(list);
    if (root.classList.contains('show')) renderBoard();
  }

  let lbTimer = 0;
  const rowEls = [];

  function renderBoard() {
    board.sort((a, b) => b.score - a.score);
    const myRank = board.indexOf(meEntry) + 1;
    const shown = board.slice(0, 8);
    // Always show your own row: if you're outside the top 8, it replaces the
    // last slot rather than disappearing.
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

  // Your score comes from actually going places — distance covered, in points.
  let lastX = null, lastZ = null;

  function update(dt, playerPos) {
    if (!root.classList.contains('show')) return;

    // Simulated players earn at their own pace, with the odd burst so ranks
    // actually swap around instead of drifting in lockstep.
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
    post('Server', 'Welcome to the city. Press Enter to chat.', 'sys');
  }

  return { show, update, addScore, post, setNames };
}
