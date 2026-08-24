// El Mercado — the store catalogue, and the Embers ledger that pays for it.
//
// ONE list, three consumers:
//   - the store page (/revolucion/store) — the shop window
//   - the lounge Decorate list — owned items toggle, unowned show their price
//   - lounge-3d.ts — imports SLOT so the room's slot ids and the catalogue's
//     ids can never drift apart (a typo would silently sell a slot that no
//     renderer knows)
//
// Embers are EARNED, never bought. There is no payment rail here and there is
// not meant to be one: the ledger is an append-only list in localStorage, the
// balance is its sum, and ownership is a `buy:<id>` entry in it. Same shape as
// the hive's own history — the entries are the truth, the balance and the
// inventory are derived.

import { EARNING_CALLS, QUIRKS, SIDE_BET_FACTOR, TALLY_STEP } from './darts-house.js'

/** Slot ids for the purchasable props, shared with the 3D room. */
export const SLOT = {
  cart: 'slot-cart',
  victrola: 'slot-victrola',
  bands: 'slot-bands',
  globe: 'slot-globe',
  chess: 'slot-chess',
} as const

export type StoreItem = {
  /** the slot id — addresses a group in the 3D room AND in the SVG fallback */
  id: string
  label: string
  /** 0 = came with the room; it is yours, it just switches on and off */
  price: number
  group: string
  blurb: string
}

/** The room you already have — free, listed so Decorate and the store read
 *  from one catalogue instead of two lists that drift. */
export const HOUSE_ITEMS: StoreItem[] = [
  { id: 'slot-fire', label: 'A fire going', price: 0, group: 'the room', blurb: 'The hearth, lit.' },
  { id: 'slot-lamp', label: 'Reading lamp', price: 0, group: 'the room', blurb: 'Brass, warm, angled at the chair.' },
  { id: 'slot-window', label: 'Night window', price: 0, group: 'the room', blurb: 'The street outside, late.' },
  { id: 'slot-rug', label: 'Rug', price: 0, group: 'the room', blurb: 'Worn in the good places.' },
  { id: 'slot-chairs', label: 'The wingbacks', price: 0, group: 'the room', blurb: 'Leather, brass tacks, two of them.' },
  { id: 'slot-tables', label: 'Tables', price: 0, group: 'the room', blurb: 'Low table, side tables.' },
  { id: 'slot-cat', label: 'The lounge cat', price: 0, group: 'the room', blurb: 'Asleep. Stays asleep.' },
  { id: 'slot-whiskey', label: 'Whiskey, neat-ish', price: 0, group: 'the room', blurb: 'Decanter and two tumblers.' },
  { id: 'slot-smoke', label: 'A cigar going', price: 0, group: 'the room', blurb: 'An ember and its smoke.' },
  { id: 'slot-accessories', label: 'Cutter, lighter, ashtray', price: 0, group: 'the room', blurb: 'The working tools.' },
  { id: 'slot-humidor', label: 'Humidor cabinet', price: 0, group: 'the room', blurb: 'Glass-fronted, kept at 69%.' },
  { id: 'slot-frames', label: 'Wall art', price: 0, group: 'the room', blurb: 'Your hive art, hung.' },
  { id: 'slot-darts', label: 'Dartboard', price: 0, group: 'the room', blurb: 'The Colonel is waiting.' },
  { id: 'slot-mirrors', label: 'The looking glasses', price: 0, group: 'the room', blurb: 'The corridor that deepens.' },
  { id: 'slot-miniature', label: 'The miniature lounge', price: 0, group: 'the room', blurb: 'The room, inside the room.' },
  { id: 'slot-shelf', label: 'Shelves & keepsakes', price: 0, group: 'the room', blurb: 'Books, trophies, the clock.' },
  { id: 'slot-plant', label: 'Plant', price: 0, group: 'the room', blurb: 'Alive, against the odds.' },
  { id: 'slot-records', label: 'Record console', price: 0, group: 'the room', blurb: 'Something on, quietly.' },
]

/** For sale. Each one is a real prop in the room, dark until you own it. */
export const SALE_ITEMS: StoreItem[] = [
  {
    id: SLOT.cart, label: 'The drinks cart', price: 180, group: 'furnishings',
    blurb: 'Brass trolley, three bottles and a bucket. It wheels the whiskey ' +
      'out of the corner and into the conversation.',
  },
  {
    id: SLOT.chess, label: 'The chess table', price: 160, group: 'furnishings',
    blurb: 'Inlaid board, two stools, a game abandoned mid-attack. Nobody ' +
      'remembers whose move it is.',
  },
  {
    id: SLOT.globe, label: 'The globe bar', price: 200, group: 'furnishings',
    blurb: 'A meridian-mounted sphere that opens at the equator. Inside: ' +
      'exactly what you would hope.',
  },
  {
    id: SLOT.victrola, label: 'The victrola', price: 240, group: 'the good stuff',
    blurb: 'Brass horn, wound by hand. The record console plays; this one ' +
      'performs.',
  },
  {
    id: SLOT.bands, label: 'The band wall', price: 140, group: 'the wall',
    blurb: 'Every band you kept, pinned in rows behind glass. A wall that ' +
      'reads as a diary if you know how to read it.',
  },
]

export const STORE_ITEMS: StoreItem[] = [...HOUSE_ITEMS, ...SALE_ITEMS]

export type EarnRule = { key: string; embers: number; label: string; note: string }

/** What the house pays for in the room, other than the darts. */
const ROOM_RULES: EarnRule[] = [
  { key: 'welcome', embers: 120, label: 'Walking in', note: 'The house stakes you on your first visit to the lounge. Once.' },
  { key: 'moment', embers: 40, label: 'A moment, journaled', note: 'Tell the concierge about a cigar you smoked and why it mattered.' },
  { key: 'tasting', embers: 25, label: 'A tasting logged', note: 'Stack three or more flavors on the wheel plate in the room.' },
  { key: 'reserve', embers: 20, label: 'A reservation', note: 'Reserve something out of the humidor through the concierge.' },
]

/** What the BOARD pays for, straight out of the house's own table — the store
 *  cannot quote a bonus the oche does not hand out, because it is reading the
 *  same object the board pays from. Every one of these is multiplied by how
 *  full the room is when it lands. */
const OCHE_RULES: EarnRule[] = EARNING_CALLS.map(c => ({
  key: 'call:' + c.id,
  embers: c.embers,
  label: c.label ?? c.shout,
  note: c.note ?? '',
}))

/** The dozen small numeric bets, as one line. They are meant to be found at
 *  the board rather than studied in a shop, so the shelves list the names and
 *  leave the arithmetic to the chalk. */
const SIDE_BET_RULE: EarnRule = {
  key: 'sidebets',
  embers: Math.min(...Object.values(QUIRKS).map(q => q.embers)),
  label: 'The side bets',
  note: 'Small money for the SHAPE of a turn rather than the size of it — ' +
    // derived, so a bet that exists is a bet that is quoted; the tail is
    // counted rather than listed, because the fun of the small ones is finding
    // them chalked up at the board
    Object.values(QUIRKS).slice(0, 7).map(q => q.shout.toLowerCase()).join(', ') +
    `, and ${Object.keys(QUIRKS).length - 7} more like them. One is drawn each leg and ` +
    `chalked on the board; hit that one and it pays ${SIDE_BET_FACTOR}×.`,
}

/** What the crowd and the alternate score do, in one sentence — the store page
 *  prints this under the table, so the multiplier is explained where the prices
 *  are and nowhere else. */
export const OCHE_NOTE =
  'Everything the board pays is multiplied by how full the room is: every third ' +
  'regular standing at the oche doubles it, up to four times over. They come across ' +
  'for trebles, tons and legs — and for THE TALLY, the board\'s alternate score, ' +
  'which counts UP by rings where 501 counts down by numbers (a single 1, a double 4, ' +
  'a treble 9, the inner bull 16) and brings one more of them over every ' +
  TALLY_STEP + '. The tally is kept between visits. The crowd is not: that is earned ' +
  'again every evening.'

/**
 * How Embers are earned. `key` prefixes the ledger claim so a thing can only
 * ever pay once — the darts add the moment to theirs, because a ton eighty is
 * an occasion and there is no reason to have only one of them.
 */
export const EARN_RULES: EarnRule[] = [...ROOM_RULES, SIDE_BET_RULE, ...OCHE_RULES]

export const EARN_OF = (key: string): number =>
  EARN_RULES.find(r => r.key === key)?.embers ?? 0

/** The ledger runtime, shared by every page (the nav chip needs it too).
 *  Deliberately ES5-flavoured and dependency-free: these pages render offline
 *  from a signature, so nothing may be fetched at run time. */
export const EMBERS_JS = /* html */ `<script>
(function(){
  var KEY = 'rev:embers:ledger';
  var log = [];
  try { log = JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch(e){ log = []; }
  if (!Array.isArray(log)) log = [];
  function save(){
    try { localStorage.setItem(KEY, JSON.stringify(log)); } catch(e){}
    window.dispatchEvent(new CustomEvent('embers:change'));
    paint();
  }
  function balance(){
    var n = 0;
    for (var i = 0; i < log.length; i++) n += (+log[i].d || 0);
    return n;
  }
  function has(k){
    for (var i = 0; i < log.length; i++) if (log[i].k === k) return true;
    return false;
  }
  // Earning. A claim key can only ever pay once — re-running it is a no-op,
  // which is what lets the page re-scan the concierge's stored moments on
  // every load without paying twice for the same evening.
  function claim(k, amount, why){
    if (!k || has(k) || !(amount > 0)) return false;
    log.push({ k: k, d: amount, w: why || k, t: Date.now() });
    save();
    return true;
  }
  function owned(id){ return has('buy:' + id); }
  function buy(id, price, label){
    if (owned(id)) return 'owned';
    if (balance() < price) return 'short';
    log.push({ k: 'buy:' + id, d: -price, w: label || id, t: Date.now() });
    save();
    return 'bought';
  }
  function paint(){
    var b = balance();
    var nodes = document.querySelectorAll('[data-embers-balance]');
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = String(b);
  }
  window.RevEmbers = {
    balance: balance, claim: claim, owned: owned, buy: buy, has: has,
    entries: function(){ return log.slice(); },
    paint: paint
  };
  // another tab spent or earned — this one is looking at the same purse
  window.addEventListener('storage', function(e){
    if (e.key !== KEY) return;
    try { log = JSON.parse(e.newValue || '[]') || []; } catch(err){ log = []; }
    if (!Array.isArray(log)) log = [];
    window.dispatchEvent(new CustomEvent('embers:change'));
    paint();
  });
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', paint, { once: true });
  else paint();
})();
</script>`
