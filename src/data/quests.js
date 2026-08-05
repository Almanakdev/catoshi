// Quest catalogue.
//
// Pure data + tiny pure helpers. No THREE, no DOM, no imports from game code —
// the quest runner (src/game/quests.js) reads this table and drives objectives
// from bus events, so adding content never means touching gameplay code.
//
// Ids referenced here are cross-checked against:
//   districts.js   old_market | fish_harbor | downtown | residential | neon_street
//   ingredients.js rice, salmon, shrimp, cucumber, avocado, yuzu, golden_koi, ...
//   recipes.js     salmon_nigiri, cucumber_maki, shrimp_nigiri, chefs_roll, ...
//   npcs.js        master_kuro, mikan, yuki, ryu, hana, mikan, suzu, pom,
//                  ume, taro, beni, rin, pip, pip, master_kuro, kiba
//   suppliers.js   yuki_stall, market_pantry, mikan_catch, harbor_auction,
//                  konbini, neon_exotics

/**
 * The reusable objective vocabulary. Every objective in every quest is one of
 * these, which is what lets the runner stay small: it only listens for a dozen
 * event shapes, never for a specific quest.
 *
 * `label` is a template — {target} and {count} are filled by objectiveText().
 */
export const OBJECTIVE_TYPES = {
  talk:        { label: 'Talk to {target}' },
  visit:       { label: 'Go to {target}' },
  collect:     { label: 'Collect {count}x {target}' },   // any source
  purchase:    { label: 'Buy {count}x {target}' },
  cook:        { label: 'Prepare {count}x {target}' },
  serve:       { label: 'Serve {count} customer(s)' },
  deliver:     { label: 'Deliver to {target}' },
  fish:        { label: 'Catch {count}x {target}' },
  reputation:  { label: 'Reach {count} reputation' },
  upgrade:     { label: 'Upgrade the {target}' },
  minigame:    { label: 'Complete {target}' },
  compete:     { label: 'Win {target}' },
  earn:        { label: 'Earn {count} coins' },
};

/**
 * Quest shape:
 * {
 *   id, kind: 'main' | 'business' | 'side',
 *   title, giver: npcId, district,
 *   desc,                      // the giver's own words
 *   requires: { quest?, reputation?, shopTier?, level?, relationship? } | null,
 *   objectives: [{ type, target, count, hint, where? }],
 *   rewards: { coins?, reputation?, xp?, recipe?, items?, relationship?,
 *              unlockDistrict?, flag? },
 *   turnIn: npcId | null,      // null = completes the moment the last objective ticks
 *   next: questId | null,
 *   repeatable: false,
 *   onCompleteLines: [...],
 * }
 */
export const QUESTS = [
  // ---------------------------------------------------------------- q01 -----
  {
    id: 'q01_first_order',
    kind: 'main',
    title: 'Your First Order',
    giver: 'master_kuro',
    district: 'old_market',
    desc: "So you want the apron. Fine. Rice and salmon, two nigiri, one customer who leaves smiling. Do that and we'll talk about the rest.",
    requires: null,
    objectives: [
      { type: 'purchase', target: 'rice',   count: 2, hint: "Yuki's stall keeps the good short-grain.", where: { x: -64, z: 8 } },
      { type: 'purchase', target: 'salmon', count: 2, hint: 'The market pantry keeps a little fish on ice.', where: { x: -58, z: -2 } },
      { type: 'cook',     target: 'salmon_nigiri', count: 2, hint: 'Prep at your cart on the plaza.', where: { x: -28, z: 16 } },
      { type: 'serve',    target: null, count: 1, hint: 'Open the cart and wait for someone hungry.', where: { x: -28, z: 22.5 } },
    ],
    rewards: {
      coins: 80, reputation: 4, xp: 20,
      relationship: { npc: 'master_kuro', amount: 8 },
      flag: 'apron_earned',
    },
    turnIn: 'master_kuro',
    next: 'q02_first_catch_intro',
    repeatable: false,
    onCompleteLines: [
      'Hm. The rice was a little loose.',
      'But the customer came back for a second piece. That is the only review that counts.',
      'Go and meet Mikan at the harbour. Tell her Kuro sent you.',
    ],
  },

  // ---------------------------------------------------------------- q02 -----
  {
    id: 'q02_first_catch_intro',
    kind: 'main',
    title: 'Salt on the Wind',
    giver: 'mikan',
    district: 'fish_harbor',
    desc: "Kuro's new apprentice, huh? Come down to the quay before the ice melts. If you're going to sell fish you should meet one that's still arguing.",
    requires: { quest: 'q01_first_order' },
    objectives: [
      { type: 'visit', target: 'fish_harbor', count: 1, hint: 'Follow Harbour Avenue north until it smells like salt.', where: { x: -4, z: -78 } },
      { type: 'talk',  target: 'mikan',       count: 1, hint: 'She works the end of the quay.', where: { x: -18, z: -120 } },
    ],
    rewards: {
      coins: 90, reputation: 6, xp: 24,
      relationship: { npc: 'mikan', amount: 10 },
      unlockDistrict: 'fish_harbor',
      items: [{ id: 'mackerel', qty: 2 }],
      flag: 'harbor_introduced',
    },
    turnIn: 'mikan',
    next: 'q03_serve_three',
    repeatable: false,
    onCompleteLines: [
      "Two mackerel. On the house — don't get used to it.",
      'The auction runs at six. Sleep less, eat better.',
    ],
  },

  // ---------------------------------------------------------------- q03 -----
  {
    id: 'q03_serve_three',
    kind: 'business',
    title: 'Three in a Row',
    giver: 'master_kuro',
    district: 'old_market',
    desc: 'One customer is luck. Three in one day is a shop. Open your cart and give me three.',
    requires: { quest: 'q02_first_catch_intro' },
    objectives: [
      { type: 'serve', target: null, count: 3, hint: 'Any recipe counts — keep the queue moving.', where: { x: -28, z: 22.5 } },
    ],
    rewards: {
      coins: 140, reputation: 8, xp: 30,
      relationship: { npc: 'master_kuro', amount: 6 },
    },
    turnIn: 'master_kuro',
    next: 'q04_market_errand',
    repeatable: false,
    onCompleteLines: [
      'Three. Nobody left hungry, nobody left waiting.',
      'That is a shop. A very small one, but a shop.',
    ],
  },

  // ---------------------------------------------------------------- q04 -----
  {
    id: 'q04_market_errand',
    kind: 'business',
    title: "Yuki's Errand",
    giver: 'yuki',
    district: 'old_market',
    desc: "I'm minding the stall alone today and I promised shrimp to four people. Fetch me some and I'll teach you what my grandmother did with them.",
    requires: { quest: 'q03_serve_three' },
    objectives: [
      { type: 'purchase', target: 'shrimp', count: 4, hint: 'The harbour sells them cheapest at the morning auction.', where: { x: -10, z: -118 } },
      { type: 'deliver',  target: 'yuki',   count: 1, hint: 'Back to the stall in the Old Market.', where: { x: -64, z: 8 } },
    ],
    rewards: {
      coins: 110, reputation: 6, xp: 26,
      recipe: 'shrimp_nigiri',
      relationship: { npc: 'yuki', amount: 12 },
    },
    turnIn: 'yuki',
    next: 'q05_elder_delivery',
    repeatable: false,
    onCompleteLines: [
      'Butterfly them, then blanch until they curl — not a heartbeat longer.',
      'There. Now you know it too. Do not embarrass me with it.',
    ],
  },

  // ---------------------------------------------------------------- q05 -----
  {
    id: 'q05_elder_delivery',
    kind: 'main',
    title: 'A Plate for Ume',
    giver: 'ume',
    district: 'residential',
    desc: "My knees don't do the market anymore, dear. Bring me something soft and a little sweet, and stay for tea if you're not too busy.",
    requires: { quest: 'q04_market_errand', reputation: 18 },
    objectives: [
      { type: 'cook',    target: 'tamago_nigiri', count: 2, hint: 'Sweet tamago — gentle on old teeth.', where: { x: -28, z: 16 } },
      { type: 'visit',   target: 'residential',   count: 1, hint: 'South down Harbour Avenue to Home Lane.', where: { x: 2, z: 66 } },
      { type: 'deliver', target: 'ume',    count: 1, hint: 'The blue house with the plum tree.', where: { x: -12, z: 108 } },
    ],
    rewards: {
      coins: 170, reputation: 12, xp: 38,
      relationship: { npc: 'ume', amount: 18 },
      items: [{ id: 'ginger', qty: 3 }],
      flag: 'knows_residential',
    },
    turnIn: 'ume',
    next: 'q06_lost_crate',
    repeatable: false,
    onCompleteLines: [
      'Still warm. You ran, didn\'t you.',
      'Take the ginger jar — I pickle far more than one old cat can eat.',
      'Come back on quiet days. The street likes a familiar face.',
    ],
  },

  // ---------------------------------------------------------------- q06 -----
  {
    id: 'q06_lost_crate',
    kind: 'side',
    title: 'The Lost Crate',
    giver: 'goro',
    district: 'fish_harbor',
    desc: "A crate walked off the quay this morning. Gulls, kids, tide — pick your suspect. Find it before the ice gives up.",
    requires: { quest: 'q05_elder_delivery' },
    objectives: [
      { type: 'visit',    target: 'fish_harbor',   count: 1, hint: 'Start where the boats tie up.', where: { x: -4, z: -78 } },
      { type: 'minigame', target: 'crate_search',  count: 1, hint: 'Check behind the net piles and under the pier.', where: { x: -46, z: -126 } },
      { type: 'deliver',  target: 'mikan',         count: 1, hint: 'Haul it back to her stand.', where: { x: -18, z: -120 } },
    ],
    rewards: {
      coins: 130, reputation: 7, xp: 30,
      relationship: { npc: 'mikan', amount: 14 },
      items: [{ id: 'salmon', qty: 2 }, { id: 'shrimp', qty: 2 }],
    },
    turnIn: 'goro',
    next: 'q07_rare_fish',
    repeatable: false,
    onCompleteLines: [
      'Under the pier. Of course it was under the pier.',
      'Half of it is still good. Take the top layer — you earned it.',
      'Kaito has been asking about you, by the way. Brace yourself.',
    ],
  },

  // ---------------------------------------------------------------- q07 -----
  {
    id: 'q07_rare_fish',
    kind: 'main',
    title: 'The Golden Koi',
    giver: 'mikan',
    district: 'fish_harbor',
    desc: "Everyone here has a story about the golden koi. Nobody has a photo. Sit on the far pier at dawn and stop being a tourist about it.",
    requires: { quest: 'q06_lost_crate', level: 4 },
    objectives: [
      { type: 'talk', target: 'mikan',      count: 1, hint: 'He runs the auction floor.', where: { x: -10, z: -118 } },
      { type: 'fish', target: 'mackerel',   count: 5, hint: 'Kaito will not talk technique until you can fill a bucket.', where: { x: -40, z: -138 } },
      { type: 'fish', target: 'golden_koi', count: 1, hint: 'The far pier, first light, no talking.', where: { x: -66, z: -142 } },
    ],
    // Catching it is what unlocks it: ingredients.js gates `golden_koi` behind
    // this quest id, so the reward is the ingredient becoming purchasable/
    // catchable from here on.
    rewards: {
      coins: 320, reputation: 16, xp: 70,
      relationship: { npc: 'mikan', amount: 16 },
      items: [{ id: 'golden_koi', qty: 1 }],
      flag: 'golden_koi_seen',
    },
    turnIn: 'mikan',
    next: 'q08_rival_duel',
    repeatable: false,
    onCompleteLines: [
      'Well. There it is.',
      "Don't sell it. Not yet. A fish like that is a question, and you don't have the answer.",
    ],
  },

  // ---------------------------------------------------------------- q08 -----
  {
    id: 'q08_rival_duel',
    kind: 'main',
    title: 'Ryu Wants a Word',
    giver: 'ryu',
    district: 'downtown',
    desc: "I hear the market has a new prodigy. Twelve minutes, one counter, one judge. Bring whatever you think will save you.",
    requires: { quest: 'q07_rare_fish', reputation: 45 },
    objectives: [
      { type: 'talk',    target: 'ryu',        count: 1, hint: 'He waits under Tower Row.', where: { x: 90, z: 14 } },
      { type: 'cook',    target: 'tuna_nigiri', count: 3, hint: 'Warm up before the clock starts.', where: { x: -28, z: 16 } },
      { type: 'compete', target: 'ryu_duel',   count: 1, hint: 'Timed challenge — accuracy beats speed.', where: { x: 88, z: 22 } },
    ],
    rewards: {
      coins: 550, reputation: 22, xp: 110,
      recipe: 'chefs_roll',
      relationship: { npc: 'ryu', amount: 10 },
      flag: 'beat_ryu_once',
    },
    turnIn: 'ryu',
    next: 'q09_lost_page',
    repeatable: false,
    onCompleteLines: [
      'Twelve minutes and you plated first. Irritating.',
      "Here — my roll. Eel, avocado, roe, sesame. Make it better than I do, if you can.",
      'Championship is in this district. I will see you there.',
    ],
  },

  // ---------------------------------------------------------------- q09 -----
  {
    id: 'q09_lost_page',
    kind: 'main',
    title: 'The Torn Page',
    giver: 'master_kuro',
    district: 'old_market',
    desc: "My grandfather's book is missing one page — the good one. It went out of this tea shop in somebody's pocket forty years ago. Find it and I'll pour you something worth the walk.",
    requires: { quest: 'q08_rival_duel', reputation: 70 },
    objectives: [
      { type: 'talk',     target: 'master_kuro',           count: 1, hint: 'The tea shop at the quiet end of the lane.', where: { x: -88, z: 18 } },
      { type: 'minigame', target: 'page_hunt',      count: 1, hint: 'Old Market storerooms, then the shrine notice board.', where: { x: -96, z: -6 } },
      { type: 'collect',  target: 'yuzu',           count: 2, hint: 'The page calls for yuzu, and it will not compromise.', where: { x: -64, z: 8 } },
      { type: 'deliver',  target: 'master_kuro',           count: 1, hint: 'Bring the page back to her counter.', where: { x: -88, z: 18 } },
    ],
    rewards: {
      coins: 700, reputation: 28, xp: 150,
      recipe: 'secret_city_roll',
      relationship: { npc: 'master_kuro', amount: 20 },
      flag: 'found_secret_page',
    },
    turnIn: 'master_kuro',
    next: 'q10_night_festival',
    repeatable: false,
    onCompleteLines: [
      'Forty years behind a rice-paper screen. Forty years.',
      'The handwriting is his. So is the argument in the margin.',
      'Cook it once for me, then cook it for the city.',
    ],
  },

  // ---------------------------------------------------------------- q10 -----
  {
    id: 'q10_night_festival',
    kind: 'business',
    title: 'Lanterns and Long Queues',
    giver: 'rin',
    district: 'neon_street',
    desc: "The festival takes the whole street every fifth night. I have a pitch free next to mine. Open, stay open, and do not run out of rice at nine.",
    requires: { quest: 'q09_lost_page', reputation: 130, shopTier: 3 },
    objectives: [
      { type: 'visit', target: 'neon_street', count: 1, hint: 'Neon Lane, after dark.', where: { x: 94, z: -66 } },
      { type: 'serve', target: null,          count: 14, hint: 'Serve during the festival window (19:00–24:00).', where: { x: 96, z: -104 } },
      { type: 'earn',  target: null,          count: 900, hint: 'Festival crowds pay well — keep quality up.', where: { x: 96, z: -104 } },
    ],
    rewards: {
      coins: 1100, reputation: 34, xp: 220,
      relationship: { npc: 'rin', amount: 18 },
      items: [{ id: 'gold_leaf', qty: 1 }],
      flag: 'festival_regular',
    },
    turnIn: 'rin',
    next: 'q11_hire_hana',
    repeatable: false,
    onCompleteLines: [
      'You did not run out. I am genuinely surprised.',
      'The pitch is yours every festival now. Bring more rice.',
    ],
  },

  // ---------------------------------------------------------------- q11 -----
  {
    id: 'q11_hire_hana',
    kind: 'business',
    title: 'Four Paws Are Better',
    giver: 'hana',
    district: 'residential',
    desc: "I've been watching your queue from the bus stop. You're losing tables at the second rush. Prove you can hold a busy room and I'll come work the counter.",
    requires: { quest: 'q10_night_festival', reputation: 160 },
    objectives: [
      { type: 'serve', target: null,    count: 20, hint: 'Keep grades at Great or better — she is counting.', where: { x: -28, z: 22.5 } },
      { type: 'talk',  target: 'hana',  count: 1,  hint: 'She waits by the Home Lane bus stop.', where: { x: 22, z: 100 } },
      { type: 'deliver', target: 'hana', count: 1, hint: 'Hand her an apron and mean it.', where: { x: 22, z: 100 } },
    ],
    rewards: {
      coins: 400, reputation: 26, xp: 260,
      relationship: { npc: 'hana', amount: 25 },
      flag: 'hana_hired',
    },
    turnIn: 'hana',
    next: 'q12_championship',
    repeatable: false,
    onCompleteLines: [
      'Twenty covers and nobody got a warm plate of nothing. Good.',
      "I take the counter, you take the knife. Don't argue, it's the right split.",
      'Now go and win something.',
    ],
  },

  // ---------------------------------------------------------------- q12 -----
  {
    id: 'q12_championship',
    kind: 'main',
    title: 'The City Championship',
    giver: 'ryu',
    district: 'downtown',
    desc: "Registration closes at noon. Kage is entering too, and Kage does not lose gracefully. Neither do I. Come anyway.",
    requires: { quest: 'q11_hire_hana', reputation: 200, shopTier: 4, level: 12 },
    objectives: [
      { type: 'talk',    target: 'ryu',                    count: 1, hint: 'Register with him at the hall steps.', where: { x: 90, z: 14 } },
      { type: 'cook',    target: 'secret_city_roll',       count: 1, hint: 'The torn-page roll is your final round dish.', where: { x: -28, z: 16 } },
      { type: 'compete', target: 'city_sushi_championship', count: 1, hint: 'Three rounds. Kage takes the second one seriously.', where: { x: 88, z: 22 } },
    ],
    rewards: {
      coins: 8000, reputation: 140, xp: 900,
      relationship: { npc: 'ryu', amount: 20 },
      items: [{ id: 'gold_leaf', qty: 3 }, { id: 'toro', qty: 2 }],
      flag: 'city_champion',
    },
    turnIn: 'ryu',
    next: null,
    repeatable: false,
    onCompleteLines: [
      'Kage walked out before the scores were read. That is how you know.',
      'A street cat with a cart. Two seasons ago.',
      'Same counter next year. I intend to win it back.',
    ],
  },

  // ================================ SIDE ====================================
  {
    id: 's01_yuki_flowers',
    kind: 'side',
    title: 'Petals for the Stall',
    giver: 'yuki',
    district: 'old_market',
    desc: 'The stall looks tired. Bring me sakura petals from the shrine trees and I will make it look like spring for a week.',
    requires: { quest: 'q03_serve_three' },
    objectives: [
      { type: 'collect', target: 'sakura', count: 3, hint: 'The shrine trees at the west end drop them in spring.', where: { x: -104, z: 14 } },
      { type: 'deliver', target: 'yuki',   count: 1, hint: 'Back to the stall.', where: { x: -64, z: 8 } },
    ],
    rewards: {
      coins: 90, reputation: 5, xp: 22,
      relationship: { npc: 'yuki', amount: 10 },
      items: [{ id: 'rice', qty: 4 }],
    },
    turnIn: 'yuki',
    next: null,
    repeatable: false,
    onCompleteLines: [
      'Oh, these are perfect. Look at the colour.',
      'Take some rice. And do not tell the pantry what I charge you.',
    ],
  },
  {
    id: 's02_kid_lunch',
    kind: 'side',
    title: "Pip's Lunchbox",
    giver: 'chibi',
    district: 'residential',
    desc: "I'm not allowed fish. I'm ALLOWED cucumber. Can you make the round green ones? Please? I have eleven coins.",
    requires: { quest: 'q05_elder_delivery' },
    objectives: [
      { type: 'cook',    target: 'cucumber_maki', count: 2, hint: 'Roll them tight — they go in a lunchbox.', where: { x: -28, z: 16 } },
      { type: 'deliver', target: 'pip',           count: 1, hint: 'The park corner on Home Lane.', where: { x: 30, z: 96 } },
    ],
    rewards: {
      coins: 70, reputation: 6, xp: 20,
      relationship: { npc: 'pip', amount: 15 },
    },
    turnIn: 'chibi',
    next: null,
    repeatable: false,
    onCompleteLines: [
      'THEY ARE ROUND.',
      'You can keep the eleven coins. I have more under the step.',
    ],
  },
  {
    id: 's03_tourist_tour',
    kind: 'side',
    title: 'Momo Is Lost',
    giver: 'pom',
    district: 'downtown',
    desc: "My guidebook has four photos and none of them are of anywhere real. Walk me round the good bits? I'll pay in coins and enthusiasm.",
    requires: { quest: 'q08_rival_duel' },
    objectives: [
      { type: 'talk',  target: 'pom',        count: 1, hint: 'She is circling the train station.', where: { x: 96, z: 40 } },
      { type: 'visit', target: 'old_market',  count: 1, hint: 'Lanterns and banners first.', where: { x: -30, z: 6 } },
      { type: 'visit', target: 'fish_harbor', count: 1, hint: 'She wants to see a boat.', where: { x: -4, z: -78 } },
      { type: 'visit', target: 'residential', count: 1, hint: 'The quiet streets surprise her most.', where: { x: 2, z: 66 } },
      { type: 'serve', target: null,          count: 1, hint: 'Finish the tour at your own counter.', where: { x: -28, z: 22.5 } },
    ],
    rewards: {
      coins: 240, reputation: 14, xp: 45,
      relationship: { npc: 'pom', amount: 14 },
    },
    turnIn: 'pom',
    next: null,
    repeatable: false,
    onCompleteLines: [
      'I took two hundred photos and the best one is of a gull stealing a bun.',
      "I'm telling everyone at home about your counter. Everyone.",
    ],
  },
  {
    id: 's04_konbini_restock',
    kind: 'side',
    title: 'The Midnight Restock',
    giver: 'beni',
    district: 'downtown',
    desc: "Delivery van broke down on the bridge. If the cold shelf is empty at seven the manager writes me up. Fill it and Bolt will run it over for me.",
    requires: { quest: 'q08_rival_duel' },
    objectives: [
      { type: 'visit',    target: 'konbini',      count: 1, hint: 'The bright one under Tower Row.', where: { x: 92, z: 44 } },
      { type: 'purchase', target: 'rice',         count: 6, hint: 'Bulk rice — cheapest at the weekend market.', where: { x: -64, z: 8 } },
      { type: 'cook',     target: 'cucumber_maki', count: 4, hint: 'Cheap, cold, sells itself at 3am.', where: { x: -28, z: 16 } },
      { type: 'deliver',  target: 'pip',          count: 1, hint: 'Bolt takes the last leg on his bicycle.', where: { x: 84, z: 34 } },
    ],
    rewards: {
      coins: 260, reputation: 10, xp: 48,
      relationship: { npc: 'beni', amount: 12 },
      items: [{ id: 'soy_sauce', qty: 3 }, { id: 'sesame', qty: 3 }],
    },
    turnIn: 'beni',
    next: null,
    repeatable: false,
    onCompleteLines: [
      'Shelf full at six fifty. I owe you one.',
      'Take the soy and the sesame — stock room says they never existed.',
    ],
  },
  {
    id: 's05_tea_delivery',
    kind: 'side',
    title: 'Tea for Taro',
    giver: 'chacha',
    district: 'old_market',
    desc: "Taro orders the same roasted blend every week and has not collected it in three. Take it to him, and take him something to eat while you're there.",
    requires: { quest: 'q05_elder_delivery' },
    objectives: [
      { type: 'talk',    target: 'master_kuro',           count: 1, hint: 'Collect the parcel from the tea shop.', where: { x: -88, z: 18 } },
      { type: 'cook',    target: 'salmon_nigiri',  count: 2, hint: 'He works through lunch. Every day.', where: { x: -28, z: 16 } },
      { type: 'deliver', target: 'taro',           count: 1, hint: 'Third floor, the office with the plants.', where: { x: 78, z: 30 } },
    ],
    rewards: {
      coins: 180, reputation: 9, xp: 34,
      relationship: { npc: 'taro', amount: 14 },
      items: [{ id: 'yuzu', qty: 1 }],
    },
    turnIn: 'chacha',
    next: null,
    repeatable: false,
    onCompleteLines: [
      'He paid, apologised twice and ordered again. Predictable man.',
      'Here — a yuzu from my own tree. Do something clever with it.',
    ],
  },
];

/** id -> quest */
export const QUEST_INDEX = Object.create(null);
for (const q of QUESTS) QUEST_INDEX[q.id] = q;

export function quest(id) { return QUEST_INDEX[id] || null; }

/** Every quest a given NPC hands out, in table order. */
export function questsByGiver(npcId) {
  return QUESTS.filter((q) => q.giver === npcId);
}

/**
 * Render an objective's one-line label.
 * `resolveName` turns an id into something a player can read (npc name,
 * ingredient name, district name…). Defaults to the raw id so callers that do
 * not care about prettiness still get sane output.
 */
export function objectiveText(obj, resolveName = (id) => id) {
  if (!obj) return '';
  const def = OBJECTIVE_TYPES[obj.type];
  const count = obj.count == null ? 1 : obj.count;
  const target = obj.target == null ? '' : String(resolveName(obj.target) ?? obj.target);
  if (!def) return target ? `${obj.type}: ${target}` : String(obj.type || '');
  return def.label
    .replace(/\{target\}/g, target)
    .replace(/\{count\}/g, String(count))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Can the player take this quest right now?
 * Defensive on purpose: a partially-built state (tests, editor previews) must
 * never make this throw.
 */
export function questAvailable(q, state) {
  if (!q) return false;
  const req = q.requires;
  if (!req) return true;
  if (!state) return false;

  if (req.quest) {
    const done = typeof state.questDone === 'function' ? state.questDone(req.quest) : false;
    if (!done) return false;
  }
  if (req.reputation != null) {
    if ((state.reputation || 0) < req.reputation) return false;
  }
  if (req.shopTier != null) {
    const tier = (state.shop && state.shop.tier) || 0;
    if (tier < req.shopTier) return false;
  }
  if (req.level != null) {
    if ((state.level || 0) < req.level) return false;
  }
  if (req.relationship && req.relationship.npc) {
    const lvl = typeof state.relationship === 'function' ? (state.relationship(req.relationship.npc) || 0) : 0;
    if (lvl < (req.relationship.level || 0)) return false;
  }
  return true;
}

/** Quests that are offerable now: requirements met and not already finished. */
export function availableQuests(state) {
  return QUESTS.filter((q) => {
    if (state && typeof state.questDone === 'function' && state.questDone(q.id) && !q.repeatable) return false;
    if (state && typeof state.questActive === 'function' && state.questActive(q.id)) return false;
    return questAvailable(q, state);
  });
}

/** The ordered main/business spine, for the journal's "story" tab. */
export function mainChain() {
  const out = [];
  let cur = QUEST_INDEX.q01_first_order;
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    cur = cur.next ? QUEST_INDEX[cur.next] : null;
  }
  return out;
}
