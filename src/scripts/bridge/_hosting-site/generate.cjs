// generate.cjs -- the hosting pages (documentation/hosting-pages.md), made
// from the hive's own notes and said back into the hive by its own words.
//
//   node scripts/bridge/_hosting-site/generate.cjs --dry                 reads only; prints every page and every sentence it would say; writes nothing
//   node scripts/bridge/_hosting-site/generate.cjs --build-only          writes the page files to <out>/pages, says nothing to the hive
//   node scripts/bridge/_hosting-site/generate.cjs                       writes the page files, then says every page that changed into the hive
//   ... --out <dir>                                                      where the page files go (default <os temp>/<site>-site); pages land in <dir>/pages
//   ... --root <route>                                                   the creation to build (default /hosting). A root with no children is ONE page:
//                                                                        it needs no plan card (e.g. --root /didyouknow, scripts/bridge/_didyouknow-site)
//   ... --notes <file.json>                                              renders an amendment before it is filed ({"/hosting": ["note", ...], ...}); --dry or --build-only only
//
// Run from the monorepo root (src/), where scripts/bridge/say.cjs lives. The
// hive's tab must be on the bridge (?claudeBridge=1); nothing here opens one.
//
// THE SOURCE IS THE HIVE. The five tiles (/hosting and every tile one level
// under it, as list-at names them) are read with note-list, read only. Each
// note is one part of its page, in the order the notes stand; nothing here
// holds page text. To change a page, change its note in the hive and run this
// again. A page built from --notes is for reading and is never said.
//
// THE NOTE GRAMMAR (what a note says -> the part it becomes)
//   the first note: <Title>. <promise>      h1 (its first sentence) and the promise
//   For: <line>. <line>.                    "Who this is for", one line per sentence
//   You need: <line>. <line>.               "You need", one line per sentence
//   Step N -- <do>. <happens> Done when <how you know>.
//                                           STEP; "Step N (optional) --" tags it Optional;
//                                           {plans} in <happens> puts the live plan list there
//   Callout: <sentence>, or any unlabelled note on a path page
//                                           CALLOUT: beside the steps when it stands next to
//                                           them (before the first, after the last), else alone
//   Part: <label>                           a steps part with its own label (default "The steps")
//   <Label>: <sentences>                    a part of its own under that label ("Your own server:")
//   What it costs: <line>                   "What it costs"
//   When you are done: <sentences>          "When you are done" -- the page's last part
//   Not open yet: <sentences>               a path that cannot be followed yet: no steps, no cost
//   on /hosting: <Page title> -- <sentence>. <price> . <time>
//                                           a PLAN CARD for that page, where the note stands
//   on a path page: Card: <sentence>. <price> . <time>
//                                           that page's PLAN CARD on /hosting, quickest first
//   the last unlabelled note on /hosting    the main page's last line
//   Mesh <n> -- <label>                     this page's cell in the MESH: 1-6 the
//                                           ring, clockwise from the top left; the
//                                           main page is the centre, under its own
//                                           name. It stands in no part
// A card's price of "Read" is a page to read: no price and no live slot.
// Inline: `x` a command, as typed; **x** a control; x in curly double quotes, what the app says; <x> the
// part that changes; [text](/hosting/x) a link; {from:words} the live lowest
// price, the words shown until the host answers.
//
// THE MESH. Every page ends in the same seven cells, drawn from the Mesh notes
// and met only after the page is read, so it is the one thing that may point
// anywhere: the rule below keeps the reading straight, and the mesh is the foot.
//
// LINKS, ONLY IN THE LAST LINE. Nothing on a path page points sideways except
// its last part (brief: "Nothing on a path page points sideways except its
// last line"), so links are drawn only in "When you are done", "Not open yet"
// and the main page's last line: a page's title said there links to that page,
// and a sentence that opens with a tile's name ("Try it first." -- try-it)
// links whole. The tile name is the grammar; no route is typed here. An
// explicit [text](/route) anywhere else, or to a page not built in this pass,
// refuses the page.
//
// PRICES ARE NEVER TYPED. A card's price that is not "Free" is a live slot:
// plans.js reads this host's GET /plans and writes the lowest price over the
// note's words; until the host answers with a plan list, the words stay. A
// page with a live slot links plans.js; no other page does.
//
// THE SHARED BYTES. chrome.css (the one look) and plans.js (the plan card's
// one behaviour) sit beside this file. Each page names them by signature,
// resource:<sha256>/<name>, filled here from the bytes; nobody types a sig.
// They ride with every page sentence and the hive stores each ONCE, by its
// signature (the same bytes are the same resource), so every page shares one
// copy and none carries its own.
//
// THE PASS (said only for a tile that does not already wear this build's page;
// children first, /hosting last):
//   go <route>                         then ui-state must show the hive standing there
//   website page {<file>.html}         --file <file>.html --file chrome.css [--file plans.js]
//                                      then layer-at must show the tile wearing that sig
//   go /hosting, opens as website      only when /hosting does not open as website yet
//   builds hosting-pages-<sig>         one restorable step for the pass, only when anything changed;
//                                      never `builds record <name>`: `record` is a behaviour word of
//                                      its own (meeting recording), so the line runs it too and the
//                                      builds word hears no name (found on the first pass, 2026-10-23)
//   go <where the hive stood>          always, when anything moved it
// Every write is a sentence through scripts/bridge/say.cjs, the words a person
// types; every check is a read. A sentence is never repeated for the caller
// (it may have landed): a miss stops the pass and says where it stood.

'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const ARGV = process.argv.slice(2)
const ROOT_AT = ARGV.indexOf('--root')
const ROOT_ROUTE = ROOT_AT >= 0 && /^\/[a-z0-9][a-z0-9-]*$/.test(ARGV[ROOT_AT + 1] ?? '') ? ARGV[ROOT_AT + 1] : '/hosting'
/** The creation's own name: names the output folder and the build revision. */
const SITE = ROOT_ROUTE.slice(1)
const HERE = __dirname
const SHARED = { chrome: path.join(HERE, 'chrome.css'), plans: path.join(HERE, 'plans.js') }
const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const TOKEN = String(process.env.HYPERCOMB_BRIDGE_TOKEN || '').trim()

const args = ARGV
const flag = (name) => args.includes(name)
const option = (name, fallback) => {
  const at = args.indexOf(name)
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback
}
const DRY = flag('--dry')
const BUILD_ONLY = flag('--build-only')
const NOTES_FILE = option('--notes', '')
const OUT = path.resolve(option('--out', path.join(os.tmpdir(), `${SITE}-site`)))
const PAGES = path.join(OUT, 'pages')
const SAY = [path.join(HERE, '..', 'say.cjs'), path.resolve('scripts', 'bridge', 'say.cjs')].find((p) => fs.existsSync(p))

const USAGE = 'usage: generate.cjs [--dry | --build-only] [--root </route>] [--out <dir>] [--notes <file.json>]'

class Refusal extends Error {}
const refuse = (route, why) => { throw new Refusal(`${route}: ${why}`) }

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const segmentsOf = (route) => route.split('/').filter(Boolean)
const routeOf = (segments) => '/' + segments.join('/')

// -- the bridge: reads only ------------------------------------------------

let socket = null
const pending = new Map()
let seq = 0
function connect() {
  if (socket) return socket
  const WebSocket = require(require.resolve('ws', { paths: [HERE, process.cwd()] }))
  socket = new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE, { maxPayload: 128 * 1024 * 1024, ...(TOKEN ? { headers: { Authorization: `Bearer ${TOKEN}` } } : {}) })
    ws.on('open', () => resolve(ws))
    ws.on('error', (e) => reject(new Error(`cannot reach the bridge at ${BRIDGE}: ${e.code || e.message || 'refused'} (start it with node scripts/bridge/run-bridge.cjs)`)))
    ws.on('close', () => { socket = null; for (const [, p] of pending) p.reject(new Error('the bridge closed')); pending.clear() })
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(String(raw)) } catch { return }
      const p = pending.get(m.id)
      if (p) { pending.delete(m.id); clearTimeout(p.timer); p.resolve(m) }
    })
  })
  return socket
}
async function call(request, timeoutMs = 60_000) {
  const ws = await connect()
  const id = `hosting-gen-${Date.now()}-${++seq}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`the bridge did not answer ${request.op}`)) }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ ...request, id }))
  })
}
/** One read, ridden through a reload of the hive's tab. */
async function read(request) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const answer = await call(request)
    if (answer.ok || !/no renderer connected/.test(String(answer.error))) return answer
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error('no renderer connected: open the hive with ?claudeBridge=1 (one tab)')
}
/** A Mesh note, or null: it names a cell and is no part of the page. */
const meshNote = (note) => {
  const m = /^Mesh\s+(\d+)\s*[\u2014\u2013-]+\s*(\S.*)$/i.exec(String(note).trim())
  return m ? { n: Number(m[1]), label: m[2].trim() } : null
}
const noteText = (n) => typeof n === 'string' ? n : String(n?.text ?? '')

async function notesFromHive() {
  const listed = await read({ op: 'list-at', segments: segmentsOf(ROOT_ROUTE) })
  if (!listed.ok || !Array.isArray(listed.data)) throw new Error(`list-at ${ROOT_ROUTE}: ${listed.error}`)
  const routes = [ROOT_ROUTE, ...listed.data.map((name) => `${ROOT_ROUTE}/${name}`)]
  const notes = {}
  for (const route of routes) {
    const r = await read({ op: 'note-list', segments: segmentsOf(route) })
    if (!r.ok || !Array.isArray(r.data)) throw new Error(`note-list ${route}: ${r.error}`)
    const seen = new Set()
    notes[route] = r.data.map((n) => noteText(n).trim()).filter((t) => t && !seen.has(t) && seen.add(t))
  }
  return notes
}

/** Where the hive stands now (the tile a word acts on). */
async function standing() {
  const r = await read({ op: 'ui-state' })
  if (!r.ok || !Array.isArray(r.data?.segments)) throw new Error(`ui-state: ${r.error}`)
  return r.data.segments.map(String)
}

/** What a tile wears: the page sigs of its visual:website:page records, its
 *  website slot (which outranks them), and its own view:default. */
async function wears(route) {
  const layer = await read({ op: 'layer-at', segments: segmentsOf(route) })
  if (!layer.ok) throw new Error(`layer-at ${route}: ${layer.error}`)
  const records = Array.isArray(layer.data?.decorations) ? layer.data.decorations : []
  const slot = Array.isArray(layer.data?.website) ? layer.data.website : []
  const pages = []
  let view = ''
  for (const sig of records) {
    const r = await read({ op: 'get-resource', sig })
    if (!r.ok) continue
    let record; try { record = JSON.parse(r.data.text) } catch { continue }
    if (record?.kind === 'visual:website:page') pages.push(String(record.payload?.htmlSig ?? ''))
    if (record?.kind === 'view:default' && !view) view = String(record.payload?.view ?? '')
  }
  return { pages, slot: slot.length ? String(slot[slot.length - 1]) : '', view }
}

// -- the hive's own words: every write is a sentence -----------------------

function say(sentence, files = []) {
  const argv = [SAY, sentence, ...files.flatMap((f) => ['--file', f])]
  const r = spawnSync(process.execPath, argv, { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } })
  const out = `${r.stdout || ''}${r.stderr || ''}`.trimEnd()
  console.log(`  > say "${sentence}"${files.map((f) => ` --file ${path.basename(f)}`).join('')}`)
  for (const line of out.split('\n')) if (line.trim()) console.log(`    ${line}`)
  if (r.status !== 0) throw new Error(`the hive did not take "${sentence}" (say.cjs exit ${r.status}); nothing more is said`)
  return out
}

async function goTo(route) {
  const want = segmentsOf(route).join('/')
  if ((await standing()).join('/') === want) return
  say(`go ${route}`)
  const now = await standing()
  if (now.join('/') !== want) {
    throw new Refusal(`${route}: said "go ${route}" but the hive stands on ${routeOf(now)} (another hand moved it, or go did not land); nothing more is said`)
  }
}

/** A write is read back, never assumed: the tile must show it. */
async function confirm(route, test, what) {
  for (let i = 0; i < 16; i++) {
    const worn = await wears(route)
    if (test(worn)) return worn
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Refusal(`${route}: the sentence ran but the tile does not show ${what}; nothing more is said`)
}

// -- text ------------------------------------------------------------------

const NAMED = { '\u2014': '&mdash;', '\u2013': '&ndash;', '\u00b7': '&middot;', '\u2019': '&rsquo;', '\u2018': '&lsquo;', '\u201c': '&ldquo;', '\u201d': '&rdquo;', '\u2026': '&hellip;', '\u2190': '&larr;', '\u2191': '&uarr;', '\u00a0': '&nbsp;' }
/** Escaped and pure ASCII: a page read raw, with no charset, cannot show mojibake. */
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/[^\x00-\x7e]/gu, (c) => NAMED[c] ?? `&#x${c.codePointAt(0).toString(16)};`)

const capital = (s) => s.replace(/^([^A-Za-z0-9]*)([a-z])/, (_, lead, first) => lead + first.toUpperCase())
const bare = (s) => s.trim().replace(/[.]$/, '')
const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase()
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Sentences, never cut inside the curly quotes of what the app says, or a [link](...). */
function sentences(text) {
  const out = []
  let start = 0
  let quoted = false
  let bracket = 0
  let ticked = false
  const s = String(text)
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    const next = s[i + 1]
    const ends = next === undefined || /\s/.test(next)
    if (c === '`') { ticked = !ticked; continue }
    if (ticked) continue
    if (c === '\u201c') quoted = true
    else if (c === '\u201d') {
      quoted = false
      if (ends && /[.?!]/.test(s[i - 1] ?? '')) { out.push(s.slice(start, i + 1)); start = i + 1 }
    } else if (c === '[' || c === '(') bracket++
    else if (c === ']' || c === ')') bracket = Math.max(0, bracket - 1)
    else if (!quoted && !bracket && /[.?!]/.test(c) && ends) { out.push(s.slice(start, i + 1)); start = i + 1 }
  }
  if (s.slice(start).trim()) out.push(s.slice(start))
  return out.map((x) => x.trim()).filter(Boolean)
}

/** Where `words` stand in `text` as whole words, or -1. */
function wordsAt(text, words) {
  const m = new RegExp(`(^|[^A-Za-z0-9])(${escapeRe(words)})(?![A-Za-z0-9])`, 'i').exec(text)
  return m ? m.index + m[1].length : -1
}

/** Plain text, with every page title said in it linked when links are drawn. */
function plain(text, ctx) {
  if (!ctx.allowLinks || ctx.inAnchor) return esc(text)
  let html = ''
  let rest = text
  for (;;) {
    let best = null
    for (const page of ctx.others) {
      const at = wordsAt(rest, page.name)
      if (at >= 0 && (!best || at < best.at || (at === best.at && page.name.length > best.page.name.length))) best = { at, page }
    }
    if (!best) return html + esc(rest)
    const end = best.at + best.page.name.length
    html += esc(rest.slice(0, best.at)) + ctx.link(best.page.route, esc(rest.slice(best.at, end)))
    rest = rest.slice(end)
  }
}

/** The inline marks of a note, rendered. */
function inline(text, ctx) {
  const marks = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\u201c([^\u201d]*)\u201d|<([a-z][a-z .-]*)>|\{from:([^}]*)\}|`([^`]+)`/gi
  let html = ''
  let at = 0
  for (const m of String(text).matchAll(marks)) {
    html += plain(text.slice(at, m.index), ctx)
    at = m.index + m[0].length
    if (m[1] !== undefined) html += ctx.link(m[2], esc(m[1]))
    else if (m[3] !== undefined) html += `<strong>${esc(m[3])}</strong>`
    else if (m[4] !== undefined) html += `<samp>${m[4].split(/(<[a-z][a-z .-]*>)/i).map((part) => /^<[a-z][a-z .-]*>$/i.test(part) ? `<var>${esc(part)}</var>` : esc(part)).join('')}</samp>`
    else if (m[5] !== undefined) html += `<var>${esc(`<${m[5]}>`)}</var>`
    else if (m[7] !== undefined) html += `<code>${esc(m[7])}</code>`
    else {
      ctx.live = true
      html += `<span data-hp-plans="from">${esc(m[6])}</span>`
    }
  }
  return html + plain(text.slice(at), ctx)
}

/** The page a sentence of the last line opens with, by its tile name. */
function opener(sentence, ctx) {
  if (!ctx.allowLinks || /\]\(/.test(sentence)) return null
  return ctx.others.find((page) => new RegExp(`^${escapeRe(page.words)}(?![A-Za-z0-9])`, 'i').test(sentence)) ?? null
}
const linksIn = (sentence, ctx) => /\[[^\]]+\]\(/.test(sentence) ||
  (ctx.allowLinks && (!!opener(sentence, ctx) || ctx.others.some((page) => wordsAt(sentence, page.name) >= 0)))
function linkSentence(sentence, ctx) {
  const page = opener(sentence, ctx)
  if (!page) return ctx.text(sentence)
  const [, body, stop] = /^([\s\S]*?)([.?!]*)$/.exec(sentence)
  ctx.inAnchor = true
  const inner = ctx.text(body)
  ctx.inAnchor = false
  return ctx.link(page.route, inner) + esc(stop)
}

// -- the note grammar ------------------------------------------------------

const LABELS = { 'for': 'for', 'you need': 'need', 'not open yet': 'closed', 'callout': 'callout', 'part': 'part', 'what it costs': 'cost', 'when you are done': 'done', 'card': 'card' }
const RANK = { title: 0, for: 1, need: 2, closed: 3, callout: 4, part: 4, step: 4, section: 4, cost: 5, done: 6, line: 6 }

function classify(note, index, { isRoot, last, pass }) {
  if (index === 0) return { kind: 'title', text: note }
  const step = /^Step\s+(\d+)\s*(\(optional\))?\s*[\u2014\u2013-]+\s*([\s\S]+)$/i.exec(note)
  if (step) return { kind: 'step', n: Number(step[1]), optional: !!step[2], text: step[3].trim() }
  const known = /^(For|You need|Not open yet|Callout|Part|What it costs|When you are done|Card):\s*([\s\S]*)$/i.exec(note)
  if (known) return { kind: LABELS[known[1].toLowerCase()], text: known[2].trim() }
  if (isRoot && pass) {
    const card = /^(.+?)\s+[\u2014\u2013]\s+([\s\S]+)$/.exec(note)
    const page = card && [...pass.pages.values()].find((p) => p.route !== ROOT_ROUTE && same(p.name, bare(card[1])))
    if (page) return { kind: 'listed', route: page.route, name: page.name, text: card[2].trim() }
  }
  const section = /^([A-Z][^:.?!\u2014\u2013\n]{0,48}):\s+(\S[\s\S]*)$/.exec(note)
  if (section) return { kind: 'section', label: section[1].trim(), text: section[2].trim() }
  if (isRoot && last) return { kind: 'line', text: note }
  return { kind: 'callout', text: note }
}

function readCard(route, text) {
  const said = sentences(text)
  const priceLine = bare(said.pop() ?? '')
  const [amount, ...rest] = priceLine.split(/\s*\u00b7\s*/)
  if (!said.length || !amount) refuse(route, 'a card is "<sentence>. <price> \u00b7 <time>"')
  const time = rest.join(' \u00b7 ')
  const minutes = Number((/(\d+)\s*minute/i.exec(time) ?? [])[1] ?? Infinity)
  return { what: said.join(' '), amount, time, minutes }
}

/** A price is never typed: anything but "Free" is the host's lowest price,
 *  read live, the note's words shown until the host answers. */
function price(amount, ctx) {
  const from = /^\{from:([^}]*)\}$/.exec(amount)
  if (from) { ctx.live = true; return { amount: esc(from[1]), live: true } }
  if (/^(free|read|paid)\b/i.test(amount)) return { amount: ctx.text(amount), live: false }
  ctx.live = true
  return { amount: esc(amount), live: true }
}

// -- the three components (the only markup for them anywhere) ------------

function step(item, ctx) {
  const done = item.text.search(/\bDone when\b/)
  if (done < 0) ctx.refuse(`step ${item.n} says no "Done when"`)
  const before = sentences(item.text.slice(0, done))
  const doLine = before.shift()
  if (!doLine) ctx.refuse(`step ${item.n} says nothing to do`)
  let happens = before.join(' ')
  const plans = /\{plans\}/.test(happens)
  happens = happens.replace(/\s*\{plans\}\s*/g, ' ').trim()
  if (!happens) ctx.refuse(`step ${item.n} does not say what happens`)
  const tag = item.optional ? '<span class="hp-step__tag">Optional</span> ' : ''
  const happensHtml = plans
    ? `<div class="hp-step__happens">\n          <p>${ctx.text(happens)}</p>\n          ${planList()}\n        </div>`
    : `<p class="hp-step__happens">${ctx.text(happens)}</p>`
  if (plans) ctx.live = true
  return `      <li class="hp-step">
        <p class="hp-step__do">${tag}${ctx.text(capital(doLine))}</p>
        ${happensHtml}
        <label class="hp-step__done"><input class="hp-check" type="checkbox"> <span>${ctx.text(item.text.slice(done).trim())}</span></label>
      </li>`
}

function callout(text, ctx, indent) {
  return `${indent}<div class="hp-callout" role="note"><p>${ctx.text(capital(text))}</p></div>`
}

/** One PLAN CARD. A card with no href leads nowhere: no <a>, no arrow, and
 *  the reader never writes a figure into it. */
function planCard({ name, href, what, amount, live, time, level = 'h2' }, indent = '    ') {
  const nameHtml = href ? `<a href="${esc(href)}">${name}</a>` : name
  const amountAttr = live ? ' data-hp-plans="from"' : ''
  return `${indent}<li class="hp-plan">
${indent}  <${level} class="hp-plan__name">${nameHtml}</${level}>
${indent}  <p class="hp-plan__what">${what}</p>
${indent}  <p class="hp-plan__price"><span class="hp-plan__amount"${amountAttr}>${amount}</span>${time ? ` &middot; ${time}` : ''}</p>
${indent}</li>`
}

/** The plan list: ONE empty card in a template, which plans.js clones. */
function planList() {
  const card = planCard({ name: '', what: '', amount: '', level: 'h3' }, '').replace(/\n\s*/g, '')
  return `<ol class="hp-plans" role="list" data-hp-plans="list"><template>${card}</template></ol>`
}
/** The MESH: every open page, one cell each, the page you are on marked. */
function mesh(cells, route, name) {
  const items = cells.map((p) => `      <li class="hp-cell"><a href="${esc(p.route)}"${p.route === route ? ' aria-current="page"' : ''}><span>${esc(p.mesh.label)}</span></a></li>`)
  return `  <nav class="hp-mesh" aria-label="${esc(name)}">\n    <ol class="hp-mesh__cells" role="list">\n${items.join('\n')}\n    </ol>\n  </nav>`
}
const planCards = (html) => `  <ol class="hp-plans" role="list">\n${html.join('\n')}\n  </ol>`

// -- a page ----------------------------------------------------------------

function render(route, notes, pass) {
  if (!notes || !notes.length) refuse(route, `no notes: every tile under ${ROOT_ROUTE} needs a page, or a website default on ${ROOT_ROUTE} strands it`)
  const isRoot = route === ROOT_ROUTE
  const items = notes.map((note, i) => classify(note, i, { isRoot, last: i === notes.length - 1, pass }))
  const links = []
  const ctx = {
    live: false,
    allowLinks: false,
    inAnchor: false,
    others: [...pass.pages.values()]
      .filter((p) => p.route !== ROOT_ROUTE && p.route !== route && !p.closed)
      .map((p) => ({ route: p.route, name: p.name, words: path.posix.basename(p.route).replace(/-/g, ' ') }))
      .sort((a, b) => b.name.length - a.name.length),
    refuse: (why) => refuse(route, why),
    text(s) { return inline(s, ctx) },
    link(href, html) {
      if (!ctx.allowLinks) refuse(route, `a link to ${href} outside the page's last part ("nothing points sideways except its last line")`)
      const target = pass.pages.get(href)
      if (!target) refuse(route, `links ${href}, which this pass does not build`)
      if (target.closed) refuse(route, `links ${href}, which is not open yet`)
      links.push(href)
      return `<a href="${esc(href)}">${html}</a>`
    },
  }

  // one shape: the parts in the brief's order
  let last = -1
  for (const item of items) {
    if (item.kind === 'card' || item.kind === 'listed') continue
    const rank = RANK[item.kind]
    if (rank < last) refuse(route, `"${(item.label ?? item.text).slice(0, 40)}" stands out of the brief's order`)
    last = rank
  }
  const closed = items.some((i) => i.kind === 'closed')
  if (closed && pass.pages.get(route).mesh) refuse(route, 'is not open yet but holds a cell in the mesh')
  if (closed && items.some((i) => ['step', 'part', 'cost', 'card'].includes(i.kind))) {
    refuse(route, 'is not open yet but still carries steps, a cost or a card: move those notes off this tile before it is published')
  }
  if (!isRoot && items.some((i) => i.kind === 'line' || i.kind === 'listed')) refuse(route, 'carries a main-page note')

  const title = sentences(items[0].text)
  const h1 = capital(title.shift() ?? '')
  const promise = title.join(' ')
  if (!h1 || !promise) refuse(route, 'the first note is "<Title>. <promise>"')

  const blocks = []
  const part = (label, body) => `  <section class="hp-part">\n    <h2 class="hp-label">${esc(label)}</h2>\n${body}\n  </section>`
  const lines = (text) => `    <ul class="hp-lines" role="list">\n${sentences(text).map((s) => `      <li>${ctx.text(capital(s))}</li>`).join('\n')}\n    </ul>`
  const prose = (text) => {
    const out = []
    let run = []
    for (const s of sentences(text)) {
      if (linksIn(s, ctx)) {
        if (run.length) out.push(`      <p>${ctx.text(capital(run.join(' ')))}</p>`), run = []
        out.push(`      <p class="hp-next">${linkSentence(capital(s), ctx)}</p>`)
      } else run.push(s)
    }
    if (run.length) out.push(`      <p>${ctx.text(capital(run.join(' ')))}</p>`)
    return `    <div class="hp-body">\n${out.join('\n')}\n    </div>`
  }

  let steps = null
  const closeSteps = () => {
    if (!steps) return
    if (!steps.list.length) refuse(route, `the part "${steps.label}" holds no steps`)
    steps.list.forEach((s, i) => { if (s.n !== i + 1) refuse(route, `step ${s.n} in "${steps.label}" should be step ${i + 1}`) })
    const body = [
      ...steps.before.map((t) => callout(t, ctx, '    ')),
      `    <ol class="hp-steps" role="list">\n${steps.list.map((s) => step(s, ctx)).join('\n')}\n    </ol>`,
      ...steps.after.map((t) => callout(t, ctx, '    ')),
    ].join('\n')
    blocks.push(part(steps.label, body))
    steps = null
  }

  let listed = null
  items.forEach((item, i) => {
    const prev = items[i - 1]?.kind
    const next = items[i + 1]?.kind
    if (item.kind === 'title' || item.kind === 'card') return
    if (item.kind === 'listed') {
      if (!listed) { closeSteps(); listed = []; blocks.push(listed) }
      const card = readCard(route, item.text)
      listed.push(planCard({
        name: esc(item.name),
        href: item.route,
        what: ctx.text(capital(card.what)),
        ...price(card.amount, ctx),
        time: ctx.text(card.time),
      }))
      return
    }
    if (item.kind === 'part') { closeSteps(); steps = { label: capital(bare(item.text)), before: [], list: [], after: [] }; return }
    if (item.kind === 'step') {
      if (!steps) steps = { label: 'The steps', before: [], list: [], after: [] }
      if (steps.after.length) refuse(route, 'a callout stands between two steps')
      steps.list.push(item)
      return
    }
    if (item.kind === 'callout') {
      if (next === 'step' && !steps?.list.length) {
        if (!steps) steps = { label: 'The steps', before: [], list: [], after: [] }
        steps.before.push(item.text)
      } else if (prev === 'step' || (prev === 'callout' && steps?.after.length)) steps.after.push(item.text)
      else { closeSteps(); blocks.push(callout(item.text, ctx, '  ')) }
      return
    }
    closeSteps()
    if (item.kind === 'for') blocks.push(part('Who this is for', lines(item.text)))
    else if (item.kind === 'need') blocks.push(part('You need', lines(item.text)))
    else if (item.kind === 'section') blocks.push(part(item.label, prose(item.text)))
    else if (item.kind === 'cost') blocks.push(part('What it costs', `    <p class="hp-cost">${ctx.text(capital(item.text))}</p>`))
    else if (item.kind === 'closed' || item.kind === 'done') {
      ctx.allowLinks = true
      blocks.push(part(item.kind === 'closed' ? 'Not open yet' : 'When you are done', prose(item.text)))
      ctx.allowLinks = false
    } else if (item.kind === 'line') {
      ctx.allowLinks = true
      blocks.push(`  <p class="hp-next">${sentences(item.text).map((s, n) => linkSentence(n ? s : capital(s), ctx)).join(' ')}</p>`)
      ctx.allowLinks = false
    }
  })
  closeSteps()

  if (isRoot) {
    // cards filed on the path pages themselves: quickest first, order is a
    // field of each member, never a list held here
    const own = [...pass.pages.values()].filter((p) => p.card && !p.closed).sort((a, b) => a.card.minutes - b.card.minutes)
    if (own.length && listed) refuse(route, 'cards are said in two places (on /hosting and on its pages); say them in one')
    if (own.length) {
      blocks.unshift(own.map((p) => planCard({
        name: esc(p.name),
        href: p.route,
        what: ctx.text(capital(p.card.what)),
        ...price(p.card.amount, ctx),
        time: ctx.text(p.card.time),
      })))
    }
    if (!own.length && !listed && pass.pages.size > 1) refuse(route, 'carries no plan card')
  }

  const rootPage = pass.pages.get(ROOT_ROUTE)
  const cells = [...pass.pages.values()].filter((p) => p.mesh).sort((a, b) => a.mesh.n - b.mesh.n)
  const up = cells.length ? `\n\n${mesh(cells, route, rootPage.name)}`
    : isRoot ? '' : `\n\n  <p class="hp-up"><a href="${ROOT_ROUTE}"><span aria-hidden="true">&uarr;</span> ${esc(rootPage.name)}</a></p>`
  const tab = isRoot ? esc(bare(h1)) : `${esc(bare(h1))} &middot; ${esc(rootPage.name)}`
  const body = blocks.map((b) => Array.isArray(b) ? planCards(b) : b).join('\n\n')
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${tab}</title>
<meta name="description" content="${esc(promise)}">
<link rel="stylesheet" href="resource:{chrome.css}/chrome.css">
</head>
<body class="hp-root">
<main class="hp" lang="en">
  <header class="hp-head">
    <h1 class="hp-title">${ctx.text(h1)}</h1>
    <p class="hp-promise">${ctx.text(capital(promise))}</p>
  </header>

${body}${up}
</main>${ctx.live ? '\n<script src="resource:{plans.js}/plans.js"></script>' : ''}
</body>
</html>
`
  return { html, links, live: ctx.live }
}

/** Every page of the pass, rendered before any is written: one refused page
 *  refuses the pass, and every refusal is said at once. */
function buildPages(notes) {
  if (!notes[ROOT_ROUTE]) throw new Refusal(`${ROOT_ROUTE}: no notes`)
  const pass = { pages: new Map() }
  for (const [route, list] of Object.entries(notes)) {
    if (route !== ROOT_ROUTE && path.posix.dirname(route) !== ROOT_ROUTE) continue
    const isRoot = route === ROOT_ROUTE
    const meshes = (list ?? []).map(meshNote).filter(Boolean)
    if (meshes.length > 1) refuse(route, 'more than one Mesh note')
    const own = (list ?? []).filter((note) => !meshNote(note))
    const items = own.map((note, i) => classify(note, i, { isRoot, last: i === own.length - 1, pass: null }))
    const cards = items.filter((i) => i.kind === 'card')
    if (cards.length > 1) refuse(route, 'more than one Card note')
    pass.pages.set(route, {
      route,
      name: capital(bare(sentences(items[0]?.text ?? '')[0] ?? '')),
      file: isRoot ? `${path.posix.basename(ROOT_ROUTE)}.html` : `${path.posix.basename(route)}.html`,
      closed: items.some((i) => i.kind === 'closed'),
      card: cards.length ? readCard(route, cards[0].text) : null,
      mesh: meshes[0] ?? null,
    })
  }
  const cells = [...pass.pages.values()].filter((p) => p.mesh)
  // the centre is the main page, under its own name: it needs no note
  if (cells.length) { const root = pass.pages.get(ROOT_ROUTE); root.mesh = { n: 0, label: root.name }; cells.push(root) }
  if (cells.length && (cells.some((p) => p.mesh.n > 6) || new Set(cells.map((p) => p.mesh.n)).size !== cells.length)) {
    throw new Refusal(`${ROOT_ROUTE}: the mesh is at most seven cells, each with its own number from 0 to 6`)
  }
  const chromeSig = sha256(fs.readFileSync(SHARED.chrome))
  const plansSig = sha256(fs.readFileSync(SHARED.plans))
  const made = []
  const refusals = []
  for (const page of pass.pages.values()) {
    try {
      const out = render(page.route, notes[page.route].filter((note) => !meshNote(note)), pass)
      const html = out.html
        .replace(/resource:\{chrome\.css\}/g, `resource:${chromeSig}`)
        .replace(/resource:\{plans\.js\}/g, `resource:${plansSig}`)
      if (/[^\x00-\x7e\n]/.test(html)) refuse(page.route, 'the page is not pure ASCII')
      made.push({ ...page, html, sig: sha256(html), links: out.links, live: out.live })
    } catch (e) { if (e instanceof Refusal) refusals.push(e.message); else throw e }
  }
  if (refusals.length) throw new Refusal(`${refusals.length} page(s) refused; nothing was written or said\n  ${refusals.join('\n  ')}`)
  // children first, /hosting last: no child is without its page when /hosting opens as website
  const ordered = [...made.filter((p) => p.route !== ROOT_ROUTE), made.find((p) => p.route === ROOT_ROUTE)]
  const passSig = sha256([chromeSig, ...ordered.map((p) => p.sig)].join('\n'))
  return { ordered, chromeSig, plansSig, passSig }
}

const filesOf = (page) => [path.join(PAGES, page.file), SHARED.chrome, ...(page.live ? [SHARED.plans] : [])]

// -- the run ---------------------------------------------------------------

async function main() {
  const known = new Set(['--dry', '--build-only', '--notes', '--out', '--root'])
  for (let i = 0; i < args.length; i++) {
    if (!known.has(args[i])) { console.error(USAGE); return 2 }
    if (args[i] === '--notes' || args[i] === '--out' || args[i] === '--root') i++
  }
  if (ROOT_AT >= 0 && ROOT_ROUTE !== ARGV[ROOT_AT + 1]) { console.error(`${USAGE}\n--root names one top-level tile, like /didyouknow`); return 2 }
  if (DRY && BUILD_ONLY) { console.error(`${USAGE}\n--dry writes nothing; --build-only writes the page files: pick one`); return 2 }
  if (NOTES_FILE && !DRY && !BUILD_ONLY) {
    throw new Refusal(`--notes: a page said into the hive is made from the hive's own notes; file the amendment first (file on /<route>: ...), or add --dry / --build-only to read it`)
  }
  if (!DRY && !BUILD_ONLY && !SAY) throw new Error('scripts/bridge/say.cjs not found: run from the monorepo root (src/)')

  const notes = NOTES_FILE ? JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8')) : await notesFromHive()
  const { ordered, chromeSig, plansSig, passSig } = buildPages(notes)

  console.log(`source      ${NOTES_FILE ? `${path.resolve(NOTES_FILE)} (a file: never said into the hive)` : `the hive at ${BRIDGE} (list-at, note-list; read only)`}`)
  console.log(`chrome.css  ${chromeSig}  (one resource; every page links resource:${chromeSig.slice(0, 12)}.../chrome.css)`)
  console.log(`plans.js    ${ordered.some((p) => p.live) ? plansSig : '(linked by no page this pass)'}`)
  for (const p of ordered) {
    console.log(`page        ${p.route.padEnd(18)} ${p.file.padEnd(14)} ${p.sig}  ${Buffer.byteLength(p.html)} bytes${p.live ? '  live price' : ''}${p.closed ? '  closed' : ''}  links: ${p.links.join(' ') || '-'}`)
  }

  if (DRY) {
    if (NOTES_FILE) {
      console.log('\ndry: built from a file, so nothing would be said; nothing was written')
      return 0
    }
    const stood = await standing()
    let at = routeOf(stood)
    const walk = (route) => { if (at !== route) console.log(`would say   go ${route}`); at = route }
    let changes = 0
    for (const page of ordered) {
      const worn = await wears(page.route)
      if (worn.slot) console.log(`would stop  ${page.route}: its website slot holds ${worn.slot.slice(0, 12)}..., which outranks a worn page`)
      else if (worn.pages.length === 1 && worn.pages[0] === page.sig) console.log(`kept        ${page.route} already wears ${page.sig.slice(0, 12)}...`)
      else {
        changes++
        walk(page.route)
        console.log(`would say   website page {${page.file}}${filesOf(page).map((f) => ` --file ${path.basename(f)}`).join('')}    (it wears ${worn.pages.length ? worn.pages.map((s) => s.slice(0, 12) + '...').join(', ') : 'no page'} now)`)
      }
    }
    const root = await wears(ROOT_ROUTE)
    if (root.view !== 'website') { changes++; walk(ROOT_ROUTE); console.log(`would say   opens as website    (it opens as ${root.view || 'hexagons'} now)`) }
    if (changes) { walk(ROOT_ROUTE); console.log(`would say   builds ${SITE}-pages-${passSig.slice(0, 12)}`) }
    if (changes) console.log(`would say   go ${routeOf(stood)}    (where the hive stands now)`)
    console.log(`\ndry: ${changes ? `${changes} change(s) would be said` : 'every tile already wears this build'}; nothing was written`)
    return 0
  }

  fs.mkdirSync(PAGES, { recursive: true })
  for (const page of ordered) {
    const file = path.join(PAGES, page.file)
    const kept = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === page.html
    if (!kept) fs.writeFileSync(file, page.html)
    console.log(`${kept ? 'kept' : 'wrote'}       ${file}`)
  }
  if (BUILD_ONLY) { console.log('\nbuild only: nothing was said to the hive'); return 0 }

  const stood = await standing()
  console.log(`\nthe hive stands on ${routeOf(stood)}; it is returned there at the end`)
  let moved = false
  let changed = 0
  try {
    for (const page of ordered) {
      const worn = await wears(page.route)
      if (worn.slot) throw new Refusal(`${page.route}: its website slot holds ${worn.slot.slice(0, 12)}..., which outranks any page a word dresses it with; no word clears that slot, so nothing more is said`)
      if (worn.pages.length === 1 && worn.pages[0] === page.sig) { console.log(`kept   ${page.route} already wears ${page.sig}`); continue }
      moved = true
      await goTo(page.route)
      say(`website page {${page.file}}`, filesOf(page))
      await confirm(page.route, (w) => w.pages.length === 1 && w.pages[0] === page.sig, `page ${page.sig}`)
      console.log(`wrote  ${page.route} now wears ${page.sig}`)
      changed++
    }
    const root = await wears(ROOT_ROUTE)
    if (root.view !== 'website') {
      moved = true
      await goTo(ROOT_ROUTE)
      say('opens as website')
      await confirm(ROOT_ROUTE, (w) => w.view === 'website', 'view:default website')
      console.log(`wrote  ${ROOT_ROUTE} opens as website (its pages open as theirs)`)
      changed++
    }
    if (changed) {
      moved = true
      await goTo(ROOT_ROUTE)
      const heard = say(`builds ${SITE}-pages-${passSig.slice(0, 12)}`)
      if (!/builds\.(saved|unchanged)|Recorded "|Nothing changed since/.test(heard)) {
        throw new Refusal(`${ROOT_ROUTE}: the builds word did not record the pass (heard: ${heard.split('\n').pop()})`)
      }
      console.log(`wrote  ${ROOT_ROUTE} build revision ${SITE}-pages-${passSig.slice(0, 12)}`)
    }
    console.log(`\n${changed ? `${changed} change(s) said` : 'nothing to say: every tile already wears this build'}`)
  } finally {
    if (moved) {
      try {
        say(`go ${routeOf(stood)}`)
        const now = await standing()
        console.log(now.join('/') === stood.join('/') ? `returned to ${routeOf(stood)}` : `MISS the hive stands on ${routeOf(now)}, not ${routeOf(stood)}`)
      } catch (e) { console.error(`MISS could not return the hive to ${routeOf(stood)}: ${e.message}`) }
    }
  }
  return 0
}

main().then((code) => { process.exitCode = code }, (e) => {
  console.error(e instanceof Refusal ? `REFUSED ${e.message}` : e.stack || e.message)
  process.exitCode = e instanceof Refusal ? 2 : 1
}).finally(() => { if (socket) socket.then((ws) => ws.close(), () => {}) })
