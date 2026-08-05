// Cat cast. Pure data — no THREE, no DOM.
//
// Every NPC is drawn by the same procedural cat model, so `fur`, `accent`,
// `size` and `hat` are the only visual knobs. Positions use the district
// coordinate convention from districts.js (+X east, +Z south, 1 unit ~= 1m)
// and every `home` / schedule `at` sits inside that NPC's district bounds.
//
// Schedules are authored gapless over 0..24 so the router never has to guess.

import { districtById } from './districts.js';

export const NPC_ROLES = {
  // `chef` is the mentor role — teaches, never sells.
  chef:     { name: 'Chef',     color: '#c8503f', icon: '👨‍🍳' },
  customer: { name: 'Customer', color: '#79b7e0', icon: '🍽️' },
  supplier: { name: 'Supplier', color: '#c8a24a', icon: '🧺' },
  fisher:   { name: 'Fisher',   color: '#4e8fa8', icon: '🎣' },
  staff:    { name: 'Staff',    color: '#7ec96a', icon: '🧑‍🍳' },
  rival:    { name: 'Rival',    color: '#e0508f', icon: '⚔️' },
  client:   { name: 'Client',   color: '#a888d8', icon: '📋' },
  resident: { name: 'Resident', color: '#c8a97a', icon: '🏡' },
  tourist:  { name: 'Tourist',  color: '#f6c445', icon: '📸' },
};

export const NPCS = [
  // ===== Old Market =========================================================
  {
    id: 'master_kuro',
    name: 'Master Kuro',
    role: 'chef',
    district: 'old_market',
    fur: '#23212a', accent: '#c8503f', size: 1.05,
    hat: 'chef',
    home: { x: -88, z: 24 },
    schedule: [
      { from: 0,  to: 6,  at: { x: -88, z: 24 }, what: 'sleep' },
      { from: 6,  to: 8,  at: { x: -78, z: 16 }, what: 'walk' },
      { from: 8,  to: 12, at: { x: -86, z: 22 }, what: 'cook' },
      { from: 12, to: 13, at: { x: -60, z: 4 },  what: 'walk' },
      { from: 13, to: 19, at: { x: -86, z: 22 }, what: 'cook' },
      { from: 19, to: 22, at: { x: -88, z: 24 }, what: 'home' },
      { from: 22, to: 24, at: { x: -88, z: 24 }, what: 'sleep' },
    ],
    favorite: 'salmon_nigiri',
    greeting: [
      'Hands warm. Rice cold. That is the whole secret.',
      'You are early. Good.',
      'Do not rush the knife. The knife knows.',
      'Sit. Watch. Then try.',
    ],
    dialogue: {
      stranger: [
        'Another cat with a cart. We shall see.',
        'Cook one thing well before you cook ten things badly.',
        'I do not give advice twice. Listen the first time.',
      ],
      friend: [
        'Your rice has stopped arguing with you. Progress.',
        'I watched you serve today. You did not panic. That is technique too.',
        'Come by tomorrow. I will show you the wrist, not the blade.',
      ],
      close: [
        'My old master said the same to me. Now it is yours to keep.',
        'You have surpassed my patience. Soon, my hands.',
        'When they call you master, remember who fed you on the first bad day.',
      ],
    },
    gift: { item: 'vinegar', likes: ['rice', 'vinegar', 'wasabi'] },
    reward: { kind: 'recipe', recipe: 'tamago_nigiri' },
    quests: ['q01_first_order', 'q03_serve_three', 'q09_lost_page'],
    bio: 'An old black cat who ran the finest counter in the market and now teaches whoever is stubborn enough to stay.',
  },
  {
    id: 'yuki',
    name: 'Yuki',
    role: 'supplier',
    district: 'old_market',
    fur: '#f4f1ea', accent: '#a8c4d8', size: 0.95,
    hat: 'bandana',
    home: { x: -96, z: 30 },
    schedule: [
      { from: 0,  to: 5,  at: { x: -96, z: 30 }, what: 'sleep' },
      { from: 5,  to: 7,  at: { x: -58, z: 14 }, what: 'walk' },
      { from: 7,  to: 18, at: { x: -58, z: 14 }, what: 'stall' },
      { from: 18, to: 20, at: { x: -70, z: 8 },  what: 'walk' },
      { from: 20, to: 24, at: { x: -96, z: 30 }, what: 'home' },
    ],
    favorite: 'cucumber_maki',
    greeting: [
      'Oh — hello. The rice is, um, very good today.',
      'I sorted the cucumbers by size. Sorry. Habit.',
      'Take the third bag. I packed that one properly.',
      'Please do not tell Taro I said his nori is damp.',
    ],
    dialogue: {
      stranger: [
        'Six coins for the rice. It is honest rice.',
        'I keep the good vinegar behind the crate. For regulars.',
        'You do not have to buy anything. You can just look.',
      ],
      friend: [
        'I set some shiso aside. Do not argue, it was going to wilt.',
        'You use the daikon properly. Most cats just shave it and hope.',
        'I like the mornings before anyone comes. Except you. You are fine.',
      ],
      close: [
        'Grandmother grew this stall from one basket. I would like it to matter.',
        'If you ever need seed money, ask me before you ask the bank cats.',
        'I practised saying this — I am glad you opened your shop here.',
      ],
    },
    gift: { item: 'rice', likes: ['sakura', 'shiso', 'cucumber'] },
    reward: { kind: 'discount', supplier: 'yuki_stall', amount: 0.15 },
    quests: ['q04_market_errand', 's01_yuki_flowers'],
    bio: 'A quiet white cat who runs the family rice and vegetable stall with unreasonable precision.',
  },
  {
    id: 'taro',
    name: 'Taro',
    role: 'supplier',
    district: 'old_market',
    fur: '#b98a52', accent: '#3f5a4a', size: 1.1,
    hat: 'cap',
    home: { x: -104, z: -20 },
    schedule: [
      { from: 0,  to: 6,  at: { x: -104, z: -20 }, what: 'sleep' },
      { from: 6,  to: 8,  at: { x: -46, z: -6 },   what: 'walk' },
      { from: 8,  to: 19, at: { x: -46, z: -6 },   what: 'shop' },
      { from: 19, to: 21, at: { x: -92, z: -18 },  what: 'walk' },
      { from: 21, to: 24, at: { x: -104, z: -20 }, what: 'home' },
    ],
    favorite: 'tamago_nigiri',
    greeting: [
      'Nori, egg, tofu, sauce. If I have not got it, nobody has.',
      'Mind the step. Everyone forgets the step.',
      'Cash, coin, or a very convincing story.',
      'Fresh soy in this morning. Smell it, do not just nod.',
    ],
    dialogue: {
      stranger: [
        'New cart, eh? Half the new carts are gone by autumn.',
        'Prices are on the board. The board does not negotiate.',
        'Buy the good nori. The cheap nori will embarrass you.',
      ],
      friend: [
        'Put it on the tab. You are good for it now.',
        'I saved you the top-shelf tofu. Do not make me regret being nice.',
        'Yuki says hello. Yuki has never said hello in her life, but still.',
      ],
      close: [
        'Twenty years behind this counter. You are the best of the new lot.',
        'Anything in the back room is yours. Within reason. Reasonable reason.',
        'When I retire I want to eat at your place. Keep it open that long.',
      ],
    },
    gift: { item: 'nori', likes: ['egg', 'tofu', 'soy_sauce'] },
    reward: { kind: 'discount', supplier: 'market_pantry', amount: 0.12 },
    quests: [],
    bio: 'A broad tabby who keeps the market pantry stocked and every price memorised.',
  },
  {
    id: 'chacha',
    name: 'Chacha',
    role: 'client',
    district: 'old_market',
    fur: '#c9b79a', accent: '#6f8f5a', size: 0.98,
    hat: 'flower',
    home: { x: -92, z: -18 },
    schedule: [
      { from: 0,  to: 6,  at: { x: -92, z: -18 }, what: 'sleep' },
      { from: 6,  to: 10, at: { x: -92, z: -18 }, what: 'cook' },
      { from: 10, to: 17, at: { x: -90, z: -14 }, what: 'shop' },
      { from: 17, to: 19, at: { x: -60, z: 2 },   what: 'walk' },
      { from: 19, to: 24, at: { x: -92, z: -18 }, what: 'home' },
    ],
    favorite: 'mixed_plate',
    greeting: [
      'Tea first. Everything else is negotiable.',
      'The afternoon crowd want something to go with hojicha.',
      'Sit anywhere that is not the wobbly stool.',
      'I have opinions about ginger. Ask me later.',
    ],
    dialogue: {
      stranger: [
        'A tea house needs food it does not have to apologise for.',
        'I buy from whoever is reliable. Be reliable.',
        'Do you deliver? Everyone says yes then says no.',
      ],
      friend: [
        'Your plates go with the roasted tea. That is a real compliment.',
        'Two sets by four o\'clock, same as always?',
        'The old ladies asked for you by name. They never do that.',
      ],
      close: [
        'I have put your shop on my board. Free advertising, cheeky of me.',
        'Come sit on the good side of the counter for once. On the house.',
        'Half my regulars come for your sushi now. I am not even annoyed.',
      ],
    },
    gift: { item: 'ginger', likes: ['yuzu', 'shiso', 'ginger'] },
    reward: { kind: 'ingredient', item: 'yuzu', qty: 3 },
    quests: ['s05_tea_delivery'],
    bio: 'Runs the corner tea house and orders standing platters for her afternoon regulars.',
  },

  // ===== Fish Harbour =======================================================
  {
    id: 'mikan',
    name: 'Mikan',
    role: 'fisher',
    district: 'fish_harbor',
    fur: '#f0913f', accent: '#3f7fa8', size: 1.0,
    hat: 'bandana',
    home: { x: -40, z: -96 },
    schedule: [
      { from: 0,  to: 4,  at: { x: -40, z: -96 },  what: 'sleep' },
      { from: 4,  to: 9,  at: { x: -30, z: -146 }, what: 'dock' },
      { from: 9,  to: 16, at: { x: -16, z: -120 }, what: 'stall' },
      { from: 16, to: 19, at: { x: -30, z: -146 }, what: 'dock' },
      { from: 19, to: 21, at: { x: -8, z: -100 },  what: 'walk' },
      { from: 21, to: 24, at: { x: -40, z: -96 },  what: 'home' },
    ],
    favorite: 'salmon_maki',
    greeting: [
      'HEY! Look at this one! LOOK at it!',
      'Tide is perfect. Perfect! Get a rod!',
      'I caught six. SIX. Before breakfast!',
      'You smell like rice. I like you already.',
      'Gull got my lunch again. Worth it.',
    ],
    dialogue: {
      stranger: [
        'You want fish? Everybody wants fish! Line up!',
        'Never bought at the dock before? It shows. Come on, I will teach you.',
        'Sixteen coins for salmon and I am robbing myself.',
      ],
      friend: [
        'Saved you the belly cut. Do not tell the auction cats.',
        'Come out on the boat one morning! You will hate it! You will love it!',
        'Best salmon on this quay and I only say that on days it is true.',
      ],
      close: [
        'There is a fish out past the point. Gold. I have seen it twice.',
        'You are harbour family now. That means you carry crates. Sorry.',
        'Take the toro. No, take it. Cook something that makes me cry.',
      ],
    },
    gift: { item: 'mackerel', likes: ['salmon', 'mackerel', 'sesame'] },
    reward: { kind: 'ingredient', item: 'toro', qty: 1 },
    quests: ['q02_first_catch_intro', 'q07_rare_fish'],
    bio: 'A loud orange cat who is out on the water before dawn and still the loudest thing on the quay at noon.',
  },
  {
    id: 'goro',
    name: 'Old Goro',
    role: 'supplier',
    district: 'fish_harbor',
    fur: '#5c6672', accent: '#c8a24a', size: 1.15,
    hat: 'cap',
    home: { x: 30, z: -100 },
    schedule: [
      { from: 0,  to: 3,  at: { x: 30, z: -100 }, what: 'sleep' },
      { from: 3,  to: 11, at: { x: 18, z: -126 }, what: 'stall' },
      { from: 11, to: 14, at: { x: 24, z: -118 }, what: 'walk' },
      { from: 14, to: 18, at: { x: 18, z: -126 }, what: 'stall' },
      { from: 18, to: 22, at: { x: 30, z: -100 }, what: 'home' },
      { from: 22, to: 24, at: { x: 30, z: -100 }, what: 'sleep' },
    ],
    favorite: 'tuna_nigiri',
    greeting: [
      'Bidding opens at three. Be awake or be sorry.',
      'That tuna came in at dawn. It will not wait for you.',
      'Nod once for a bid. Sneeze and you have bought a crate.',
      'Ice is money, kid. Respect the ice.',
    ],
    dialogue: {
      stranger: [
        'Auction floor is for buyers, not sightseers.',
        'I have sold fish to four generations of cooks. You are number five.',
        'Grade first, price second. Learn the grades.',
      ],
      friend: [
        'I will hold a lot back for you. One lot. Do not get greedy.',
        'You look at the eyes now instead of the price tag. Good.',
        'Bad haul this week. Buy the scallop, skip the bream.',
      ],
      close: [
        'The uni goes to you before it goes to the Neon crowd. That is final.',
        'My knees are done. Somebody has to keep this floor honest after me.',
        'Bring me one plate of your best and we will call the tab settled.',
      ],
    },
    gift: { item: 'scallop', likes: ['tuna', 'scallop', 'soy_sauce'] },
    reward: { kind: 'discount', supplier: 'harbor_auction', amount: 0.1 },
    quests: ['q06_lost_crate'],
    bio: 'The grizzled fishmonger who calls the morning auction and remembers every bad bid ever made.',
  },
  {
    id: 'pom',
    name: 'Pom',
    role: 'tourist',
    district: 'fish_harbor',
    fur: '#e8d8b0', accent: '#e0508f', size: 0.9,
    hat: 'straw',
    home: { x: 44, z: -118 },
    schedule: [
      { from: 0,  to: 8,  at: { x: 44, z: -118 }, what: 'sleep' },
      { from: 8,  to: 12, at: { x: 0, z: -124 },  what: 'walk' },
      { from: 12, to: 15, at: { x: -20, z: -112 }, what: 'walk' },
      { from: 15, to: 19, at: { x: 20, z: -110 }, what: 'walk' },
      { from: 19, to: 22, at: { x: 44, z: -118 }, what: 'home' },
      { from: 22, to: 24, at: { x: 44, z: -118 }, what: 'sleep' },
    ],
    favorite: 'mixed_plate',
    greeting: [
      'Is this the famous quay? It is smaller than the guidebook said!',
      'One more photo. Okay, two more.',
      'I have eaten sushi in nine cities. Nine!',
      'Which way to the neon street? Everyone points differently.',
    ],
    dialogue: {
      stranger: [
        'Excuse me — do you live here? You look like you live here.',
        'My guidebook has three pages on this city and two are wrong.',
        'What should a visitor absolutely not miss?',
      ],
      friend: [
        'I told everyone at the guesthouse about your shop. Everyone.',
        'You should charge tourists more. I say that as a tourist.',
        'Show me the places the book does not have. Please?',
      ],
      close: [
        'I have extended my stay twice now. Mostly because of your counter.',
        'Brought you petals from the hill road. They keep, apparently.',
        'When I finally go home I am going to be unbearable about this city.',
      ],
    },
    gift: { item: 'sesame', likes: ['sakura', 'gold_leaf', 'yuzu'] },
    reward: { kind: 'ingredient', item: 'sakura', qty: 2 },
    quests: ['s03_tourist_tour'],
    bio: 'A wide-eyed traveller cat working through a guidebook that is mostly out of date.',
  },

  // ===== Downtown ===========================================================
  {
    id: 'suzu',
    name: 'Suzu',
    role: 'customer',
    district: 'downtown',
    fur: '#6b6f78', accent: '#3f7fa8', size: 1.0,
    hat: null,
    home: { x: 110, z: 58 },
    schedule: [
      { from: 0,  to: 6,  at: { x: 110, z: 58 }, what: 'sleep' },
      { from: 6,  to: 8,  at: { x: 100, z: 44 }, what: 'walk' },
      { from: 8,  to: 12, at: { x: 94, z: 30 },  what: 'shop' },
      { from: 12, to: 13, at: { x: 60, z: 10 },  what: 'walk' },
      { from: 13, to: 19, at: { x: 94, z: 30 },  what: 'shop' },
      { from: 19, to: 22, at: { x: 88, z: 12 },  what: 'walk' },
      { from: 22, to: 24, at: { x: 110, z: 58 }, what: 'home' },
    ],
    favorite: 'tuna_nigiri',
    greeting: [
      'Twenty minutes for lunch. Make them count.',
      'If it is not wrapped I cannot eat it at my desk.',
      'Same as yesterday. Yesterday was fine.',
      'Do not tell me the specials. I will want them.',
    ],
    dialogue: {
      stranger: [
        'Is there a queue? There is always a queue.',
        'I eat lunch standing up. It is not a lifestyle, it is a schedule.',
        'Fast, warm, and not depressing. That is the whole brief.',
      ],
      friend: [
        'I skipped a meeting for this. Do not make it weird.',
        'Six of us upstairs now. Six lunches. Think about it.',
        'You are the only reason I leave the building.',
      ],
      close: [
        'The whole floor orders from you. I take full credit.',
        'There is a competition slot open. I put your name down. Sorry-not-sorry.',
        'When I quit and open a bookshop, you are catering the launch.',
      ],
    },
    gift: { item: 'soy_sauce', likes: ['tuna', 'wasabi', 'egg'] },
    reward: { kind: 'discount', supplier: 'konbini', amount: 0.08 },
    quests: [],
    bio: 'An office cat on the fourteenth floor who measures her life in lunch breaks.',
  },
  {
    id: 'beni',
    name: 'Beni',
    role: 'supplier',
    district: 'downtown',
    fur: '#d96a52', accent: '#f6c445', size: 0.97,
    hat: 'cap',
    home: { x: 118, z: 40 },
    schedule: [
      { from: 0,  to: 7,  at: { x: 118, z: 40 }, what: 'sleep' },
      { from: 7,  to: 9,  at: { x: 100, z: 26 }, what: 'walk' },
      { from: 9,  to: 20, at: { x: 60, z: 10 },  what: 'shop' },
      { from: 20, to: 22, at: { x: 76, z: 18 },  what: 'walk' },
      { from: 22, to: 24, at: { x: 118, z: 40 }, what: 'home' },
    ],
    favorite: 'cucumber_maki',
    greeting: [
      'Welcome! Hot drinks on the left, everything else on the right.',
      'We are open. We are always open. That is the whole idea.',
      'Point at what you want, I will find it. Probably.',
      'The two-for-one ends tonight. It has ended every night this month.',
    ],
    dialogue: {
      stranger: [
        'Yes, we mark things up. We are also here at four in the morning.',
        'Bag? Chopsticks? Receipt? Wonderful.',
        'If the shelf is empty the truck is late. The truck is always late.',
      ],
      friend: [
        'Back room stock, regular price. Do not shout about it.',
        'You buy rice at 2am like a real professional.',
        'I keep a list of what you always run out of. It is a long list.',
      ],
      close: [
        'You get the delivery before it hits the shelf. That is the deal.',
        'Head office wants my numbers. You are most of my numbers.',
        'Some nights it is just me, the hum of the fridge, and your order.',
      ],
    },
    gift: { item: 'egg', likes: ['rice', 'egg', 'sesame'] },
    reward: { kind: 'discount', supplier: 'konbini', amount: 0.18 },
    quests: ['s04_konbini_restock'],
    bio: 'The relentlessly cheerful konbini clerk who has not seen daylight since spring.',
  },
  {
    id: 'pip',
    name: 'Pip',
    role: 'staff',
    district: 'downtown',
    fur: '#a89478', accent: '#e0508f', size: 0.92,
    hat: 'headband',
    home: { x: 120, z: 66 },
    schedule: [
      { from: 0,  to: 6,  at: { x: 120, z: 66 }, what: 'sleep' },
      { from: 6,  to: 11, at: { x: 74, z: -14 }, what: 'walk' },
      { from: 11, to: 14, at: { x: 92, z: 20 },  what: 'walk' },
      { from: 14, to: 20, at: { x: 74, z: -14 }, what: 'walk' },
      { from: 20, to: 23, at: { x: 108, z: 50 }, what: 'home' },
      { from: 23, to: 24, at: { x: 120, z: 66 }, what: 'sleep' },
    ],
    favorite: 'shrimp_nigiri',
    greeting: [
      'Four drops left, no time, talk fast!',
      'Anything under three kilos, I am your cat.',
      'Brakes are a suggestion. A good suggestion. Mostly.',
      'I know every alley in this city. Every one.',
    ],
    dialogue: {
      stranger: [
        'Delivery? Address? Great, done, gone.',
        'I do not do stairs above the fourth floor. Union rules. My union. Me.',
        'If it fits in the crate it gets there warm.',
      ],
      friend: [
        'Your stuff goes at the top of the bag. Always has.',
        'I could run your deliveries, you know. If you ever wanted.',
        'Beat my own record today. Nobody noticed. You noticed.',
      ],
      close: [
        'Say the word and I hang up the courier bag for your apron.',
        'Nobody has ever asked me to stay anywhere before.',
        'I will do the harbour run at dawn. You do the rice. Deal?',
      ],
    },
    gift: { item: 'cucumber', likes: ['shrimp', 'avocado', 'ginger'] },
    reward: { kind: 'staff', role: 'delivery', wage: 38 },
    quests: [],
    bio: 'A wiry bicycle courier who knows every shortcut downtown and would rather be cooking.',
  },

  // ===== Residential ========================================================
  {
    id: 'hana',
    name: 'Hana',
    role: 'staff',
    district: 'residential',
    fur: '#f2e4d0', accent: '#d97b6c', size: 1.0,
    hat: 'bandana',
    home: { x: -14, z: 100 },
    schedule: [
      { from: 0,  to: 6,  at: { x: -14, z: 100 }, what: 'sleep' },
      { from: 6,  to: 9,  at: { x: -14, z: 100 }, what: 'home' },
      { from: 9,  to: 13, at: { x: 4, z: 104 },   what: 'walk' },
      { from: 13, to: 17, at: { x: -22, z: 92 },  what: 'walk' },
      { from: 17, to: 21, at: { x: -14, z: 100 }, what: 'cook' },
      { from: 21, to: 24, at: { x: -14, z: 100 }, what: 'sleep' },
    ],
    favorite: 'salmon_nigiri',
    greeting: [
      'Oh good, someone to talk to! Sit, sit.',
      'I have been up since five and I have already reorganised the shed.',
      'You look tired. Have you eaten? Be honest.',
      'The neighbours told me everything. I told them nothing. Mostly.',
    ],
    dialogue: {
      stranger: [
        'You are the one with the cart! I have heard so much.',
        'I cook for six on Sundays. It is not a skill, it is a survival tactic.',
        'If you ever need hands, this street is full of them. Mine included.',
      ],
      friend: [
        'I practised the rice at home. Do not laugh. Okay, laugh a bit.',
        'Busy day? I could come by. I am fast and I never drop things.',
        'You do not have to do all of it alone, you know.',
      ],
      close: [
        'Give me the apron and go take an actual afternoon off.',
        'I have not been this excited about a morning in years.',
        'We are a proper kitchen now. Say it out loud, it sounds nice.',
      ],
    },
    gift: { item: 'avocado', likes: ['salmon', 'avocado', 'sakura'] },
    reward: { kind: 'staff', role: 'counter', wage: 32 },
    quests: ['q11_hire_hana'],
    bio: 'A warm calico with more energy than her street can absorb, waiting for the right kitchen to join.',
  },
  {
    id: 'ume',
    name: 'Granny Ume',
    role: 'resident',
    district: 'residential',
    fur: '#cfc7bb', accent: '#7ea36a', size: 0.93,
    hat: 'flower',
    home: { x: 26, z: 118 },
    schedule: [
      { from: 0,  to: 5,  at: { x: 26, z: 118 }, what: 'sleep' },
      { from: 5,  to: 8,  at: { x: 30, z: 112 }, what: 'walk' },
      { from: 8,  to: 12, at: { x: 26, z: 118 }, what: 'home' },
      { from: 12, to: 16, at: { x: 12, z: 108 }, what: 'walk' },
      { from: 16, to: 20, at: { x: 26, z: 118 }, what: 'cook' },
      { from: 20, to: 24, at: { x: 26, z: 118 }, what: 'sleep' },
    ],
    favorite: 'tamago_nigiri',
    greeting: [
      'Come in, come in. Mind the cat. The other cat.',
      'I have not been to the market since my hip decided things.',
      'Sit down. You are making the room feel busy.',
      'I remember when this whole street was rice fields. Truly.',
    ],
    dialogue: {
      stranger: [
        'You are new. Everyone is new after eighty.',
        'A young cat carrying crates. What a lovely and useless sight.',
        'If you are delivering, knock loudly. I am not deaf, I am slow.',
      ],
      friend: [
        'You bring the food and you stay to talk. That is the rare part.',
        'My husband made tamago exactly like that. Exactly.',
        'Take the sweets on the shelf. They are not getting younger either.',
      ],
      close: [
        'There is a recipe in the drawer. My mother\'s. It should be used.',
        'You have made the last few months very good ones, you know.',
        'Do not fuss. Just come again on Thursday.',
      ],
    },
    gift: { item: 'ginger', likes: ['tofu', 'daikon', 'egg'] },
    reward: { kind: 'recipe', recipe: 'mixed_plate' },
    quests: ['q05_elder_delivery'],
    bio: 'The oldest cat on Home Lane, who remembers the city before the towers and cooks better than she admits.',
  },
  {
    id: 'chibi',
    name: 'Chibi',
    role: 'resident',
    district: 'residential',
    fur: '#3a3f4a', accent: '#f6c445', size: 0.9,
    hat: 'cap',
    home: { x: -30, z: 112 },
    schedule: [
      { from: 0,  to: 7,  at: { x: -30, z: 112 }, what: 'sleep' },
      { from: 7,  to: 8,  at: { x: -30, z: 112 }, what: 'home' },
      { from: 8,  to: 15, at: { x: -18, z: 120 }, what: 'walk' },
      { from: 15, to: 19, at: { x: 4, z: 128 },   what: 'walk' },
      { from: 19, to: 21, at: { x: -30, z: 112 }, what: 'home' },
      { from: 21, to: 24, at: { x: -30, z: 112 }, what: 'sleep' },
    ],
    favorite: 'cucumber_maki',
    greeting: [
      'Are you the sushi cat? You ARE the sushi cat!',
      'I can hold my breath for forty seconds. Watch.',
      'Do you have any with no fish in? Asking for me.',
      'My lunch box is the blue one. The blue one is important.',
      'Wasabi is a trick grown-ups play on each other.',
    ],
    dialogue: {
      stranger: [
        'You are not allowed on this street unless you are cool.',
        'Okay you can be on this street.',
        'Do you have a knife? A real one? Can I see it? No?',
      ],
      friend: [
        'I told everyone at school about your shop. EVERYONE.',
        'Cut the cucumber into stars next time. Stars are better.',
        'I found this leaf. It is the best leaf. You can have it.',
      ],
      close: [
        'When I am big I am going to work at your counter. That is decided.',
        'Mum says I talk about you too much. I do not think that is possible.',
        'Teach me the rice bit. I will be really, really careful.',
      ],
    },
    gift: { item: 'shiso', likes: ['egg', 'cucumber', 'sesame'] },
    reward: { kind: 'ingredient', item: 'shiso', qty: 4 },
    quests: ['s02_kid_lunch'],
    bio: 'A small black kitten with enormous opinions and a blue lunch box he defends with his life.',
  },
  {
    id: 'kenji',
    name: 'Kenji',
    role: 'client',
    district: 'residential',
    fur: '#7a5c42', accent: '#3f7fa8', size: 1.08,
    hat: null,
    home: { x: 48, z: 92 },
    schedule: [
      { from: 0,  to: 6,  at: { x: 48, z: 92 }, what: 'sleep' },
      { from: 6,  to: 9,  at: { x: 48, z: 92 }, what: 'home' },
      { from: 9,  to: 17, at: { x: 40, z: 100 }, what: 'shop' },
      { from: 17, to: 20, at: { x: 24, z: 104 }, what: 'walk' },
      { from: 20, to: 23, at: { x: 48, z: 92 }, what: 'home' },
      { from: 23, to: 24, at: { x: 48, z: 92 }, what: 'sleep' },
    ],
    favorite: 'mixed_plate',
    greeting: [
      'I need eight sets by seven. Can you do eight sets by seven?',
      'My family has opinions. Loud, contradictory opinions.',
      'Write it down. If it is not written down it did not happen.',
      'Same order, later time. No — earlier time. Sorry.',
    ],
    dialogue: {
      stranger: [
        'I order a lot. I also complain a lot. Both are business.',
        'Can you handle volume? Be honest, it saves us both an evening.',
        'Deposit up front, balance on delivery. That is how I work.',
      ],
      friend: [
        'You have never been late. Do you know how rare that is?',
        'Standing order for Fridays. Do not let me forget I said that.',
        'My mother asked who made the platter. She never asks.',
      ],
      close: [
        'I sponsor a slot at the city championship. I would like it to be yours.',
        'You are not a supplier any more. You are the family caterer.',
        'Name your price next time. I have stopped pretending to haggle.',
      ],
    },
    gift: { item: 'soy_sauce', likes: ['tuna', 'salmon', 'ginger'] },
    reward: { kind: 'quest', quest: 'q12_championship' },
    quests: [],
    bio: 'A busy family cat who orders large platters for every gathering and pays on time.',
  },

  // ===== Neon Food Street ===================================================
  {
    id: 'ryu',
    name: 'Ryu',
    role: 'rival',
    district: 'neon_street',
    fur: '#2f3340', accent: '#e0508f', size: 1.08,
    hat: 'headband',
    home: { x: 104, z: -110 },
    schedule: [
      { from: 0,  to: 3,  at: { x: 96, z: -100 },  what: 'cook' },
      { from: 3,  to: 5,  at: { x: 104, z: -110 }, what: 'home' },
      { from: 5,  to: 13, at: { x: 104, z: -110 }, what: 'sleep' },
      { from: 13, to: 16, at: { x: 100, z: -96 },  what: 'walk' },
      { from: 16, to: 19, at: { x: 96, z: -100 },  what: 'cook' },
      { from: 19, to: 24, at: { x: 96, z: -100 },  what: 'cook' },
    ],
    favorite: 'chefs_roll',
    greeting: [
      'You came to the neon street. Brave. Or lost.',
      'My counter is full every night. Ask why.',
      'Skill first. Everything else is decoration.',
      'Do not apologise for wanting to win.',
    ],
    dialogue: {
      stranger: [
        'A market cook. Cute. The market forgives mistakes. I do not.',
        'Bring something worth tasting or bring nothing.',
        'I have beaten better cats than you. I remember all of them fondly.',
      ],
      friend: [
        'Your knife work has changed. Someone finally taught you properly.',
        'I watched your service last night. Twice. Do not read into it.',
        'Rivalry is just respect with a scoreboard.',
      ],
      close: [
        'When you beat me, beat me properly. No luck, no excuses.',
        'Here — my roll, written out. Improve it or I will be insulted.',
        'This street was cold before you started showing up. Thank you.',
      ],
    },
    gift: { item: 'wasabi', likes: ['tuna', 'toro', 'wasabi'] },
    reward: { kind: 'recipe', recipe: 'chefs_roll' },
    quests: ['q08_rival_duel', 'q12_championship'],
    bio: 'The sharpest young chef on Neon Food Street, fiercely competitive and quietly generous with anyone who earns it.',
  },
  {
    id: 'kiba',
    name: 'Kiba',
    role: 'rival',
    district: 'neon_street',
    fur: '#b9bcc4', accent: '#f6c445', size: 1.12,
    hat: 'chef',
    home: { x: 78, z: -124 },
    schedule: [
      { from: 0,  to: 4,  at: { x: 82, z: -116 }, what: 'cook' },
      { from: 4,  to: 12, at: { x: 78, z: -124 }, what: 'sleep' },
      { from: 12, to: 15, at: { x: 78, z: -124 }, what: 'home' },
      { from: 15, to: 18, at: { x: 88, z: -108 }, what: 'walk' },
      { from: 18, to: 24, at: { x: 82, z: -116 }, what: 'cook' },
    ],
    favorite: 'sashimi_deluxe',
    greeting: [
      'Presentation is not decoration. Presentation is the argument.',
      'Ryu cooks with his hands. I cook with a plan.',
      'Nobody remembers a good plate. They remember a strange one.',
      'Taste this. Do not ask what is in it first.',
    ],
    dialogue: {
      stranger: [
        'Another traditionalist. The street is thick with them.',
        'I do not compete with carts. Come back when you have a counter.',
        'Your menu is safe. Safe is a choice, and it is the wrong one.',
      ],
      friend: [
        'You surprised me on the plating. I do not say that lightly.',
        'Try the gold leaf. Once. Then decide if it is vulgar.',
        'Ryu and I disagree about you. That means you are interesting.',
      ],
      close: [
        'There is a championship bracket. You belong in it. I said so.',
        'Steal from my menu. I will steal back and we will both improve.',
        'I have never enjoyed losing before. Do not make a habit of it.',
      ],
    },
    gift: { item: 'sesame', likes: ['uni', 'eel', 'gold_leaf'] },
    reward: { kind: 'ingredient', item: 'gold_leaf', qty: 1 },
    quests: [],
    bio: 'A silver experimentalist chef who treats every plate as a provocation.',
  },
  {
    id: 'rin',
    name: 'Rin',
    role: 'supplier',
    district: 'neon_street',
    fur: '#d8c0d8', accent: '#e0508f', size: 0.96,
    hat: 'flower',
    home: { x: 112, z: -92 },
    schedule: [
      { from: 0,  to: 3,  at: { x: 112, z: -92 }, what: 'stall' },
      { from: 3,  to: 6,  at: { x: 112, z: -92 }, what: 'home' },
      { from: 6,  to: 14, at: { x: 112, z: -92 }, what: 'sleep' },
      { from: 14, to: 17, at: { x: 118, z: -84 }, what: 'walk' },
      { from: 17, to: 24, at: { x: 112, z: -92 }, what: 'stall' },
    ],
    favorite: 'secret_city_roll',
    greeting: [
      'Only the strange things. The ordinary shops close at six.',
      'Yuzu came in from the hill farms an hour ago. Still cold.',
      'Lanterns go up tonight. You should be here.',
      'Gold leaf? Of course. Money first, then wonder.',
    ],
    dialogue: {
      stranger: [
        'Everything on this table is rare, expensive, or both.',
        'Daylight suppliers will not carry what I carry.',
        'Browse. Touch nothing gold.',
      ],
      friend: [
        'I set the sakura aside before the rival chefs sniffed around.',
        'You buy strange things and then you actually use them. Refreshing.',
        'Festival stall spot going spare. Interested?',
      ],
      close: [
        'Take the gold leaf at cost. You are the only one who earns it.',
        'When the lanterns are lit and your counter is full — that is the city.',
        'Whatever comes in on the night boat, you see it first.',
      ],
    },
    gift: { item: 'sakura', likes: ['yuzu', 'sakura', 'gold_leaf'] },
    reward: { kind: 'discount', supplier: 'neon_exotics', amount: 0.2 },
    quests: ['q10_night_festival'],
    bio: 'Runs the festival stall of impossible ingredients and only trades after dark.',
  },
];

const NPC_INDEX = Object.create(null);
for (const n of NPCS) NPC_INDEX[n.id] = n;

export { NPC_INDEX };

export function npc(id) { return NPC_INDEX[id] || null; }

export function npcsInDistrict(districtId) {
  return NPCS.filter((n) => n.district === districtId);
}

/** The district record an NPC belongs to (null if the id ever drifts). */
export function npcDistrict(n) {
  const rec = typeof n === 'string' ? NPC_INDEX[n] : n;
  return rec ? districtById(rec.district) : null;
}

/**
 * Schedule entry active at `hour`. Hours wrap, and entries may wrap too
 * (from 22 to 2). Falls back to the first entry so callers never see undefined.
 */
export function scheduledSpot(n, hour) {
  const rec = typeof n === 'string' ? NPC_INDEX[n] : n;
  if (!rec || !rec.schedule || rec.schedule.length === 0) return null;
  const h = ((Number(hour) || 0) % 24 + 24) % 24;
  for (const s of rec.schedule) {
    const wraps = s.from > s.to;
    if (wraps ? (h >= s.from || h < s.to) : (h >= s.from && h < s.to)) return s;
  }
  return rec.schedule[0];
}

/** Where an NPC physically is at `hour` — the schedule spot, else their home. */
export function npcPositionAt(n, hour) {
  const rec = typeof n === 'string' ? NPC_INDEX[n] : n;
  if (!rec) return null;
  const slot = scheduledSpot(rec, hour);
  return (slot && slot.at) || rec.home;
}

export function dialogueTier(relationshipLevel) {
  const lvl = Number(relationshipLevel) || 0;
  if (lvl >= 60) return 'close';
  if (lvl >= 20) return 'friend';
  return 'stranger';
}

/**
 * Deterministic line pick. Degrades down the tiers (and finally to greetings)
 * so a half-authored NPC still says something instead of throwing.
 */
export function lineFor(n, relationshipLevel, index) {
  const rec = typeof n === 'string' ? NPC_INDEX[n] : n;
  if (!rec) return '';
  const d = rec.dialogue || {};
  const tier = dialogueTier(relationshipLevel);
  const order = tier === 'close' ? ['close', 'friend', 'stranger']
    : tier === 'friend' ? ['friend', 'stranger', 'close']
    : ['stranger', 'friend', 'close'];
  let lines = null;
  for (const key of order) {
    if (Array.isArray(d[key]) && d[key].length) { lines = d[key]; break; }
  }
  if (!lines) lines = Array.isArray(rec.greeting) ? rec.greeting : null;
  if (!lines || !lines.length) return '';
  const i = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0;
  return lines[i % lines.length];
}

/** Rotating idle barks, same deterministic indexing as lineFor. */
export function greetingFor(n, index) {
  const rec = typeof n === 'string' ? NPC_INDEX[n] : n;
  if (!rec || !Array.isArray(rec.greeting) || !rec.greeting.length) return '';
  const i = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0;
  return rec.greeting[i % rec.greeting.length];
}

/** Everyone who can hand out this quest id. */
export function questGivers(questId) {
  return NPCS.filter((n) => n.quests.includes(questId));
}
