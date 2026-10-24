/* plans.js -- the PLAN CARD's one behaviour, shared by signature, never copied.

   A page whose plan card shows a live price links it once, at the end of its
   body:
     <script src="resource:<sig>/plans.js"></script>
   A page without such a slot does not link it and asks nothing (generate.cjs
   links it only where it wrote a slot).

   Prices are the host's, never typed, and read the way every client reads a
   host: by signature. The plans a host offers are the pool sign('host:plans')
   on its own origin -- GET /<sha256('host:plans')>/ lists the members, one
   plan signature per line, and each plan's bytes answer at /<sig>:
   {name, bytes, sites, rooms, people, price?: {amount, currency, period}},
   amount a whole number of the currency's minor units (900 usd = $9). A plan
   is believed only when its bytes hash to its name. The pool answers on every
   door of the host once its operator lists it (`hosts list host:plans`); no
   named route is asked, so no site's own /plans page is ever taken.

   Slots (see chrome.css):
     data-hp-plans="from" -- the lowest price ("From $9 a month"; no "From"
       when there is one priced plan). Inside a plan card it is read only when
       the card leads somewhere, so a card whose page is not open never shows
       a figure; outside a card (a page's cost line) it is read whenever the
       page links this script. Said only when every priced plan shares one
       currency and period; free plans are left out of it.
     data-hp-plans="list" on an .hp-plans list that holds ONE plan card in a
       <template> -- that card, cloned once per plan, with its name, its
       "what it allows" sentence and its amount written in. The markup is the
       page's own, so a card drawn here and a card written on the page are
       one shape.

   Anything short of the whole plan list (no script, no network, no
   crypto.subtle, a host that does not list the pool, any plan that cannot be
   read, more listed than can be read, a redirect, a slow host) leaves the
   words already written in the slot -- never a partial list, whose "From"
   would be higher than the host's. A plan that IS read but is not what its
   name says, or not exactly a plan's terms, is dropped and the rest stand.
   Operator data is only
   ever written with textContent. */
(function () {
  'use strict';
  if (typeof fetch !== 'function' || !/^https?:$/.test(location.protocol)) return;
  var subtle = typeof crypto === 'object' && crypto && crypto.subtle;
  if (!subtle || typeof TextEncoder !== 'function') return;

  var MAX_PLANS = 12;
  /* how many listed plans are read before the cheapest MAX_PLANS are kept */
  var MAX_READ = 32;
  var MAX_PLAN_BYTES = 4096;
  /* a plan is exactly these terms -- the worker's readPlan, mirrored */
  var PLAN_KEYS = ['name', 'bytes', 'sites', 'rooms', 'people', 'price'];
  var PRICE_KEYS = ['amount', 'currency', 'period'];
  var SIG = /^[0-9a-f]{64}$/;
  var MAX_NAME = 64;
  var WAIT_MS = 6000;
  var PERIOD = { month: 'a month', year: 'a year' };
  var own = Object.prototype.hasOwnProperty;

  function templateOf(slot) {
    for (var i = 0; i < slot.children.length; i++) {
      var child = slot.children[i];
      if (child.tagName === 'TEMPLATE' && child.content && child.content.firstElementChild) return child;
    }
    return null;
  }

  function wanted(slot) {
    var mode = slot.getAttribute('data-hp-plans');
    if (mode === 'list') return !!templateOf(slot);
    if (mode !== 'from') return false;
    var card = slot.closest('.hp-plan');
    return !card || !!card.querySelector('.hp-plan__name a[href]');
  }

  var slots = Array.prototype.filter.call(
    document.querySelectorAll('.hp [data-hp-plans]:not([data-hp-plans-read])'),
    wanted);
  if (!slots.length) return;
  slots.forEach(function (slot) { slot.setAttribute('data-hp-plans-read', ''); });

  function whole(n) {
    return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= 0;
  }

  function money(amount, currency) {
    try {
      var digits = new Intl.NumberFormat('en', { style: 'currency', currency: currency })
        .resolvedOptions().maximumFractionDigits;
      var major = amount / Math.pow(10, digits);
      var round = Math.floor(major) === major;
      return new Intl.NumberFormat('en', {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: round ? 0 : digits,
        maximumFractionDigits: digits
      }).format(major);
    } catch (e) {
      return '';
    }
  }

  /* null = malformed (the plan is dropped, never shown as free) */
  function readPrice(price) {
    if (price === undefined || price === null) return { free: true };
    if (typeof price !== 'object' || !whole(price.amount)) return null;
    var currency = String(price.currency || '');
    var period = String(price.period || '');
    if (!/^[a-z]{3}$/i.test(currency) || !own.call(PERIOD, period)) return null;
    if (price.amount === 0) return { free: true };
    currency = currency.toUpperCase();
    var text = money(price.amount, currency);
    if (!text) return null;
    return { amount: price.amount, key: currency + '/' + period, text: text + ' ' + PERIOD[period] };
  }

  function count(n, one, many) {
    return whole(n) && n > 0 ? n + ' ' + (n === 1 ? one : many) : '';
  }

  function size(bytes) {
    if (!whole(bytes) || bytes === 0) return '';
    var units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
    var i = 0;
    while (bytes >= 1000 && i < units.length - 1) { bytes /= 1000; i++; }
    var shown = bytes >= 10 || i === 0 ? Math.round(bytes) : Math.round(bytes * 10) / 10;
    return shown + ' ' + units[i];
  }

  /* "3 sites, 2 rooms and 10 people" */
  function together(list) {
    return list.length < 2 ? list.join('') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  }

  /* what a plan allows, said as one sentence, never a list of features:
     "Room for 3 sites, 2 rooms and 10 people, with 2 GB of storage." */
  function allows(plan) {
    var room = [
      count(plan.sites, 'site', 'sites'),
      count(plan.rooms, 'room', 'rooms'),
      count(plan.people, 'person', 'people')
    ].filter(Boolean);
    var storage = size(plan.bytes);
    if (room.length) return 'Room for ' + together(room) + (storage ? ', with ' + storage + ' of storage' : '') + '.';
    return storage ? storage + ' of storage.' : '';
  }

  function only(object, keys) {
    for (var key in object) if (own.call(object, key) && keys.indexOf(key) < 0) return false;
    return true;
  }

  /* Bytes that hash to their name are only unchanged, not the operator's:
     anything that is not exactly a plan's terms (a signed event set out in
     the pool, say) is not a plan. */
  function isPlan(plan) {
    if (!plan || typeof plan !== 'object' || Array.isArray(plan) || !only(plan, PLAN_KEYS)) return false;
    if (!whole(plan.bytes) || !whole(plan.sites) || !whole(plan.rooms) || !whole(plan.people)) return false;
    var price = plan.price;
    return price === undefined || (!!price && typeof price === 'object' && !Array.isArray(price) && only(price, PRICE_KEYS));
  }

  function readPlans(raw) {
    var plans = [];
    for (var i = 0; i < raw.length; i++) {
      var plan = raw[i];
      if (!isPlan(plan)) continue;
      var name = typeof plan.name === 'string' ? plan.name.trim() : '';
      if (!name || name.length > MAX_NAME) continue;
      var price = readPrice(plan.price);
      if (!price) continue;
      plans.push({ name: name, price: price, allows: allows(plan) });
    }
    /* the host's order: free first, then the lowest price, then the name */
    plans.sort(function (a, b) {
      var x = a.price.free ? -1 : a.price.amount;
      var y = b.price.free ? -1 : b.price.amount;
      return x - y || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    });
    return plans.slice(0, MAX_PLANS);
  }

  function hex(buffer) {
    var bytes = new Uint8Array(buffer);
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return out;
  }

  function sign(text) {
    return subtle.digest('SHA-256', new TextEncoder().encode(text)).then(hex);
  }

  function fromText(plans) {
    var priced = plans.filter(function (plan) { return !plan.price.free; });
    if (!priced.length) return '';
    for (var i = 1; i < priced.length; i++) {
      if (priced[i].price.key !== priced[0].price.key) return '';
    }
    priced.sort(function (a, b) { return a.price.amount - b.price.amount; });
    return (priced.length > 1 ? 'From ' : '') + priced[0].price.text;
  }

  function write(card, selector, text) {
    var node = card.querySelector(selector);
    if (!node) return;
    if (text) node.textContent = text;
    else node.parentNode.removeChild(node);
  }

  /* the page's own card, once per plan */
  function card(template, plan) {
    var node = document.importNode(template.content.firstElementChild, true);
    write(node, '.hp-plan__name', plan.name);
    write(node, '.hp-plan__what', plan.allows);
    write(node, '.hp-plan__amount', plan.price.free ? 'Free' : plan.price.text);
    return node;
  }

  function render(plans) {
    slots.forEach(function (slot) {
      try {
        if (slot.getAttribute('data-hp-plans') === 'from') {
          var text = fromText(plans);
          if (text) slot.textContent = text;
          return;
        }
        var template = templateOf(slot);
        var cards = plans.map(function (plan) { return card(template, plan); });
        Array.prototype.slice.call(slot.children).forEach(function (child) {
          if (child.tagName === 'LI') slot.removeChild(child);
        });
        cards.forEach(function (node) { slot.appendChild(node); });
      } catch (e) {
        /* this slot keeps its written words */
      }
    });
  }

  var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, WAIT_MS) : 0;
  function ask(path) {
    return fetch(path, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) { return res.ok ? res : null; });
  }

  /* One plan, believed only when its bytes are what its name says. A plan
     that cannot be READ fails the whole list (throws): a partial list would
     show a higher "From" than the host offers. A plan that is read and is
     not what its name says is dropped (null). */
  function plan(sig) {
    return ask('/' + sig).then(function (res) {
      if (!res) throw new Error('unread');
      return res.arrayBuffer();
    }).then(function (buffer) {
      if (buffer.byteLength > MAX_PLAN_BYTES) return null;
      return subtle.digest('SHA-256', buffer).then(function (digest) {
        if (hex(digest) !== sig) return null;
        try { return JSON.parse(new TextDecoder().decode(buffer)); } catch (e) { return null; }
      });
    });
  }

  sign('host:plans').then(function (pool) {
    return ask('/' + pool + '/');
  }).then(function (res) {
    return res ? res.text() : '';
  }).then(function (listing) {
    var names = listing.split('\n').map(function (line) { return line.trim(); })
      .filter(function (line) { return SIG.test(line); });
    /* more than can be read is a listing this card cannot order: say nothing */
    if (names.length > MAX_READ) throw new Error('too many');
    return Promise.all(names.map(plan));
  }).then(function (held) {
    if (ctrl && ctrl.signal.aborted) return;
    var plans = readPlans(held.filter(Boolean));
    if (plans.length) render(plans);
  }).catch(function () {
    /* the written words stand */
  }).then(function () {
    if (timer) clearTimeout(timer);
  });
})();
