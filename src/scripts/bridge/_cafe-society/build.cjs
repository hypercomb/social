// Café Society, step 2 of 3 — cut the mockup into atoms, parts and page frames.
//
//   node scripts/bridge/_cafe-society/build.cjs
//       → <work>/out/site.json  (+ <work>/out/preview/ for a local look)
//
// <work> is src/.tmp/cafe-society (or CAFE_WORK), filled by mine.cjs.
// Pure and offline: reads raw/, img/, fonts/ and writes out/. Nothing here
// talks to a hive. Pictures and stylesheets are referenced by NAME as
// {{img:<file>}} / {{css:<atom>}}; plant.cjs swaps each for its signature.
//
// The shape (documentation/atomic-chain.md, website-artifact-paradigm.md):
//   style atoms   type (faces) · theme (variables) · sheet (rules), linked by signature
//   parts         one standalone page per section, header and footer included
//   frames        one page per route: holes only; parts seat by their enrolment order
const fs = require('fs'), path = require('path')

const WORK = process.env.CAFE_WORK || path.resolve(__dirname, '../../../.tmp/cafe-society')
const RAW = path.join(WORK, 'raw'), OUT = path.join(WORK, 'out')
const SITE = 'cafe-society'
const SCOPE = '.cafe-society'
// The mockup is pretty-printed with the closing bracket on its own line
// (a closing tag split across two lines); fold that so it is always `</a>`.
const read = f => fs.readFileSync(path.join(RAW, f), 'utf8').replace(/<\/([a-zA-Z][\w-]*)\s+>/g, '</$1>')

// ── routes ───────────────────────────────────────────────────────────────
// file → route under the site root, and the part names of its sections in order.
const RITUALS = ['coffee', 'tea', 'kava', 'shisha', 'cigar', 'alcohol']
const PAGES = [
  { file: 'index.html', route: [], parts: ['welcome', 'six-rituals', 'house-manner', 'the-feeling', 'merchant-houses', 'your-corner', 'member-voice', 'saved-chair', 'member-stories', 'come-sit-with-us'] },
  { file: 'culture.html', route: ['culture'], parts: ['rituals-opening', 'ritual-notes'] },
  ...RITUALS.map(r => ({
    file: `culture_${r}.html`, route: ['culture', r],
    parts: [`${r}-opening`, `${r}-notes`, `other-rituals-beside-${r}`, 'merchants-at-the-table', 'upcoming-gatherings'],
  })),
  { file: 'vendors.html', route: ['vendors'], parts: ['merchants-opening', 'who-belongs', 'merchants-on-the-platform', 'apply-to-be-listed'] },
  { file: 'community.html', route: ['community'], parts: ['community-opening', 'post-to-the-room'] },
  { file: 'members.html', route: ['members'], parts: ['members-opening', 'seat-card'] },
  { file: 'gatherings.html', route: ['gatherings'], parts: ['gatherings-opening', 'host-a-gathering'] },
  { file: 'journal.html', route: ['journal'], parts: ['journal-opening', 'journal-sign-in'] },
  { file: 'recipes.html', route: ['recipes'], parts: ['recipes-opening', 'recipes-empty'] },
  { file: 'contact.html', route: ['contact'], parts: ['contact-opening', 'send-a-note', 'find-a-table'] },
  { file: 'account.html', route: ['account'], parts: ['portal-door'] },
]

// ── markup clean-up shared by every part ─────────────────────────────────
const SIGN_IN = /sign in|member portal/i
function clean(html) {
  let s = html
  // THE ENTRANCES. The mockup's script wrote each animated element's starting
  // state inline (opacity 0, moved or scaled) and then ran it. That script
  // does not travel, so each element says WHICH entrance it has instead, and
  // the stylesheet plays it (ENTRANCE_CSS), with the mockup's own numbers:
  //   scale(…)            the opening picture settling from 108% over 2.2s
  //   translateY(28px)    a block rising as it comes on screen (in-view-reveal)
  //   translateY(other)   the opening lines, caught mid-flight by the
  //                       prerender: rising in turn, 0.35s then every 0.16s
  let line = 0
  s = s.replace(/\sstyle="opacity:\s*([\d.]+);\s*transform:\s*([^"]*)"/g, (_m, _opacity, transform) => {
    if (/^scale\(/.test(transform)) return ' data-enter="settle"'
    if (/^translateY\(28px\)/.test(transform)) return ' data-reveal'
    if (/^translateY\(/.test(transform)) {
      const at = line++
      return ` data-enter="rise" style="--enter-delay:${(0.35 + at * 0.16).toFixed(2)}s;--enter-time:${at === 1 ? '.9s' : '.8s'}"`
    }
    return ''   // already at rest
  })
  if (/style="opacity:/.test(s)) throw new Error('an animated element is written in a way this cut does not expect')
  s = s.replace(/\sdata-discover="true"/g, '')
  // Pictures by name; plant swaps the name for the signature.
  s = s.replace(/src="https:\/\/images\.[a-z.]+\/[^"]*\/([^"\/]+)"/g, (_m, name) => `src="resource:{{img:${name}}}"`)
  // Routes: the wire form is the full path from the hive root.
  s = s.replace(/href="\/([^"]*)"/g, (_m, rest) => `href="/${SITE}${rest ? '/' + rest : ''}"`)
  // A sign-in button did its work in the mockup's script. Here it is a link
  // to the portal page, wearing the same classes.
  s = s.replace(/<button(\s[^>]*)?>([\s\S]*?)<\/button>/g, (m, attrs = '', inner) => {
    if (/type="submit"/.test(attrs) || !SIGN_IN.test(inner)) return m
    return `<a href="/${SITE}/account"${attrs.replace(/\stype="[^"]*"/, '')}>${inner}</a>`
  })
  // A form posts by mail until the hive carries the behaviour.
  s = s.replace(/<form([^>]*)novalidate=""/g, '<form$1action="mailto:social@cafesociety.app" method="post" enctype="text/plain"')
  // Nothing may ask another host. The map was a Google embed — a request on
  // every load; a link asks only when the reader presses it.
  s = s.replace(/<iframe[^>]*src="https:\/\/www\.google\.com\/maps\?q=([^"&]*)[^"]*"[^>]*><\/iframe>/g, (_m, q) =>
    `<a class="block px-block-sm py-block-xs font-sans text-xs uppercase tracking-kicker text-secondary" href="https://www.google.com/maps?q=${q}" rel="noopener">Open the map</a>`)
  if (/<iframe|<script|<link|<object|<embed/.test(s)) throw new Error('a part still carries an embed, a script or a link')
  // The builder's own bookkeeping, and a namespace HTML never needs.
  s = s.replace(/\sdata-image-id="[^"]*"/g, '').replace(/\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '')
  // Every picture but the one marked urgent waits until it is near the screen.
  s = s.replace(/<img\b([^>]*)>/g, (m, attrs) => /\sloading=|fetchpriority="high"/.test(attrs) ? m : `<img loading="lazy" decoding="async"${attrs}>`)
  return s
}

const MENU_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16"></path><path d="M4 12h16"></path><path d="M4 18h16"></path></svg>'
const MENU_LINKS = [['Rituals', 'culture'], ['Merchants', 'vendors'], ['Community', 'community'], ['Members', 'members'], ['Gatherings', 'gatherings'], ['Journal', 'journal'], ['Recipes', 'recipes'], ['Contact', 'contact'], ['Member portal', 'account']]

function headerPart(html) {
  let s = clean(html)
  // The small-screen menu was opened by script; <details> opens without one.
  const menu = `<details class="cafe-menu"><summary aria-label="Menu">${MENU_ICON}</summary><nav aria-label="Menu">`
    + MENU_LINKS.map(([label, route]) => `<a href="/${SITE}/${route}">${label}</a>`).join('') + '</nav></details>'
  const at = s.lastIndexOf('<button')
  if (at < 0) throw new Error('header: no menu button found')
  const end = s.indexOf('</button>', at) + '</button>'.length
  return s.slice(0, at) + menu + s.slice(end)
}

// ── the live directory ───────────────────────────────────────────────────
// "Merchants on the platform" was a filter over nothing. It is now bound to
// the community: every domain that opens a door named for a ritual
// (`coffee.<domain>`, `tea.<domain>` …) and has it live is listed, with
// whatever it publishes beneath that door (wholesale, roasters) as its
// connection points. Nobody is added by hand. The behaviour is the
// `community-doors` module (community-doors.js); everything it draws is
// cloned from the templates written here, so the look stays the page's own.
// With no script, or no door live yet, the mockup's "directory is opening"
// card is what shows — a finished state.
const RITUAL_WORDS = ['coffee', 'tea', 'kava', 'shisha', 'cigar', 'spirits']
const KICKER = 'font-sans text-[0.65rem] uppercase tracking-kicker text-secondary'
const PILL = 'rounded-pill border px-block py-block-xs font-sans text-xs uppercase tracking-kicker transition-colors duration-smooth border-border bg-transparent text-foreground hover:border-accent'
const DOOR_ROW = `<template data-door><li class="rounded-sm border border-border bg-card p-block-lg">`
  + `<p data-door-word class="${KICKER}"></p>`
  + `<h3 data-door-title class="mt-block-sm font-heading text-3xl tracking-display text-card-foreground"></h3>`
  + `<a data-door-link class="mt-block inline-flex items-center border-b border-secondary pb-block-xs font-sans text-xs uppercase tracking-kicker text-secondary transition-colors duration-smooth hover:border-foreground hover:text-foreground"><span data-door-host></span></a>`
  + `<div data-door-points class="mt-block flex flex-wrap gap-block-xs"></div>`
  + `</li></template>`
  + `<template data-door-point><a data-point-link class="${PILL}"><span data-point-title></span></a></template>`

function liveDirectory(html) {
  const start = html.indexOf('<div class="mt-block-lg flex flex-wrap')
  const end = html.lastIndexOf('</div>', html.lastIndexOf('</section>'))
  const card = '<div class="rounded-sm border border-border bg-card p-block-lg">'
  if (start < 0 || end < 0 || !html.includes(card)) throw new Error('the merchants directory no longer has the shape this cut expects')
  let inner = html.slice(start, end)
  // Each pill says which word it filters to; "All rituals" filters to none.
  let pills = 0
  inner = inner.replace(/<button\s+type="button"\s+aria-pressed="(true|false)"([^>]*)>\s*([^<]*?)\s*<\/button>/g, (_m, pressed, attrs, label) => {
    pills++
    const word = /^all\b/i.test(label) ? '' : label.toLowerCase()
    if (word && !RITUAL_WORDS.includes(word)) throw new Error('a filter names a ritual the directory does not ask for: ' + label)
    return `<button type="button" aria-pressed="${pressed}" data-word="${word}"${attrs}>${label}</button>`
  })
  if (pills !== RITUAL_WORDS.length + 1) throw new Error(`the directory has ${pills} filters, expected ${RITUAL_WORDS.length + 1}`)
  inner = inner.replace(card, `<p data-doors-status aria-live="polite" class="${KICKER}"></p>`
    + `<ul data-doors hidden class="mt-block space-y-block"></ul>${DOOR_ROW}`
    + card.replace('<div class="', '<div data-doors-empty class="mt-block '))
  return html.slice(0, start)
    + `<community-doors words="${RITUAL_WORDS.join(' ')}">${inner}</community-doors>`
    + html.slice(end)
    + '\n<script type="module" src="resource:{{js:community-doors}}/community-doors.js"></script>'
}

// ── cut ──────────────────────────────────────────────────────────────────
const parts = new Map()   // name → { name, title, html (body markup), picture }
const frames = []         // { route, title, description, holes: [partName] }

const firstPicture = html => (html.match(/resource:\{\{img:([^}]+)\}\}/) || [])[1] || null
const headingOf = html => ((html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/) || [])[1] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

function addPart(name, html, title) {
  const existing = parts.get(name)
  if (existing) {
    if (existing.html !== html) throw new Error(`part "${name}" is cut from two pages with different markup`)
    return
  }
  parts.set(name, { name, title: title || headingOf(html) || name, html, picture: firstPicture(html) })
}

let headerHtml = null, footerHtml = null
for (const page of PAGES) {
  const text = read(page.file)
  const root = text.slice(text.indexOf('<div id="root">'))
  const header = root.match(/<header[\s\S]*?<\/header>/)[0]
  const footer = root.match(/<footer[\s\S]*<\/footer>/)[0]
  const main = root.match(/<main[\s\S]*<\/main>/)[0]
  // One header for every page: the home page's, which marks no item current.
  // Which page is current is a fact about a place, never about the header.
  if (page.route.length === 0) headerHtml = headerPart(header)
  footerHtml = footerHtml ?? clean(footer)

  let sections = [...main.matchAll(/<section[\s\S]*?<\/section>/g)].map(m => clean(m[0]))
  if (sections.length === 0) {
    // The portal page is one block drawn on <main> itself.
    sections = [clean(main.replace(/^<main/, '<section').replace(/<\/main>$/, '</section>'))]
  }
  if (sections.length !== page.parts.length) throw new Error(`${page.file}: ${sections.length} sections, ${page.parts.length} names`)
  sections.forEach((html, i) => addPart(page.parts[i], page.parts[i] === 'merchants-on-the-platform' ? liveDirectory(html) : html))

  const title = (text.match(/<title>([^<]*)<\/title>/) || [])[1] || 'Café Society'
  const description = (text.match(/name="description"\s+content="([^"]*)"/) || [])[1] || ''
  frames.push({ route: page.route, title, description, holes: ['header', ...page.parts, 'footer'] })
}
addPart('header', headerHtml, 'Header')
// "Back to the top" was a script; an anchor to the page top needs none.
addPart('footer', footerHtml.replace(/<button([^>]*)>([\s\S]*?Back to the top[\s\S]*?)<\/button>/, '<a href="#"$1>$2</a>'), 'Footer')

// ── style atoms ──────────────────────────────────────────────────────────
// Every rule is confined to SCOPE, so a sheet reached by signature can be
// hoisted into the hive's own document without touching the hive, and works
// unchanged inside a seated part's shadow root.
function scopeSelector(sel) {
  const s = sel.trim()
  if (!s) return s
  if (s === ':root' || s === 'html' || s === ':host' || s === 'body') return SCOPE
  if (s === '*') return `${SCOPE},${SCOPE} *`
  if (/^::?(before|after)$/.test(s)) return `${SCOPE}${s},${SCOPE} ${s}`
  if (s.startsWith('html ') || s.startsWith('body ')) return `${SCOPE} ${s.slice(5)}`
  return `${SCOPE} ${s}`
}
function splitTop(text, sep) {
  const out = []; let depth = 0, start = 0, quote = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue }
    if (c === '"' || c === "'") quote = c
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === sep && depth === 0) { out.push(text.slice(start, i)); start = i + 1 }
  }
  out.push(text.slice(start))
  return out
}
function scopeCss(css) {
  let out = '', i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open < 0) { out += css.slice(i); break }
    const prelude = css.slice(i, open)
    let depth = 1, j = open + 1, quote = null
    for (; j < css.length && depth > 0; j++) {
      const c = css[j]
      if (quote) { if (c === '\\') j++; else if (c === quote) quote = null; continue }
      if (c === '"' || c === "'") quote = c
      else if (c === '{') depth++
      else if (c === '}') depth--
    }
    const body = css.slice(open + 1, j - 1)
    const head = prelude.trim()
    if (/^@(media|supports|container|layer)\b/.test(head)) out += `${head}{${scopeCss(body)}}`
    else if (head.startsWith('@')) out += `${head}{${body}}`
    else out += `${splitTop(head, ',').map(scopeSelector).join(',')}{${body}}`
    i = j
  }
  return out
}

const rawCss = read('site.css')
const themeBlock = rawCss.match(/:root\{(--color-background:[^}]*)\}/)
if (!themeBlock) throw new Error('theme variables not found in the mockup stylesheet')
const THEME = `/* style:cafe-society-theme — the variables every Café Society rule reads. Swap this atom to restyle the site. */\n${SCOPE}{${themeBlock[1]}}\n`
const MENU_CSS = [
  `${SCOPE} .cafe-menu{position:relative}`,
  `${SCOPE} .cafe-menu>summary{list-style:none;cursor:pointer;display:inline-flex;padding:.5rem;color:var(--color-foreground)}`,
  `${SCOPE} .cafe-menu>summary::-webkit-details-marker{display:none}`,
  `${SCOPE} .cafe-menu>nav{position:absolute;right:0;top:100%;min-width:14rem;display:flex;flex-direction:column;gap:var(--spacing-block-sm);padding:var(--spacing-block);background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);box-shadow:0 12px 32px rgb(12 22 18/.18)}`,
  `${SCOPE} .cafe-menu>nav a{font-family:var(--font-sans);font-size:.75rem;text-transform:uppercase;letter-spacing:.18em;color:var(--color-foreground)}`,
  `@media (min-width:768px){${SCOPE} .cafe-menu{display:none}}`,
].join('\n')
// The entrances, with the mockup's numbers (its script: 0.75s rise of 28px on
// the curve below when a quarter of a block is on screen; the opening picture
// from 108% over 2.2s; the opening lines rising 32px in turn).
//
// EVERY ENTRANCE PLAYS ON ITS OWN. `both` holds an element at its starting
// state from the first paint, so nothing flashes, and the animation needs no
// script to finish — a page whose script never runs is still whole. The
// in-view-reveal module only adds `data-wait` to blocks not on screen yet;
// taking it off again is what starts their entrance.
const CURVE = 'cubic-bezier(.22,1,.36,1)'
const ENTRANCE_CSS = [
  '@keyframes cafe-rise{from{opacity:0;transform:translateY(var(--rise,28px))}to{opacity:1;transform:none}}',
  '@keyframes cafe-settle{from{opacity:0;transform:scale(1.08)}to{opacity:1;transform:none}}',
  `${SCOPE} [data-enter="settle"]{animation:cafe-settle 2.2s ${CURVE} both}`,
  `${SCOPE} [data-enter="rise"]{--rise:32px;animation:cafe-rise var(--enter-time,.8s) ${CURVE} var(--enter-delay,0s) both}`,
  `${SCOPE} [data-reveal]{animation:cafe-rise .75s ${CURVE} var(--reveal-delay,0s) both}`,
  `${SCOPE} [data-reveal][data-wait]{animation:none;opacity:0;transform:translateY(28px)}`,
  `${SCOPE} in-view-reveal{display:contents}`,
  `@media (prefers-reduced-motion:reduce){${SCOPE} [data-enter],${SCOPE} [data-reveal]{animation:none!important;opacity:1!important;transform:none!important}}`,
].join('\n')
const SHEET = `/* style:cafe-society — the rules, every one confined to ${SCOPE}. Reads the theme atom's variables only. */\n`
  + scopeCss(rawCss.replace(themeBlock[0], '')) + '\n' + MENU_CSS + '\n' + ENTRANCE_CSS + '\n'

const face = (file, family, style) => {
  const b64 = fs.readFileSync(path.join(WORK, 'fonts', file)).toString('base64')
  return `@font-face{font-family:'${family}';font-style:${style};font-weight:300 700;font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2')}`
}
const TYPE = `/* style:cafe-society-type — the two faces, carried in the atom: no request leaves the hive. */\n`
  + [face('cormorant-garamond.woff2', 'Cormorant Garamond', 'normal'),
     face('cormorant-garamond-italic.woff2', 'Cormorant Garamond', 'italic'),
     face('jost.woff2', 'Jost', 'normal')].join('\n') + '\n'

// ── documents ────────────────────────────────────────────────────────────
const LINKS = ['type', 'theme', 'sheet'].map(a => `<link rel="stylesheet" href="resource:{{css:${a}}}/cafe-society${a === 'sheet' ? '' : '-' + a}.css">`).join('\n')
const REVEAL_SCRIPT = '<script type="module" src="resource:{{js:in-view-reveal}}/in-view-reveal.js"></script>'
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

// A part: complete alone. It links the shared atoms and wraps itself in the
// scope, so it looks like itself wherever it is seated or opened.
const partDoc = part => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(part.title)} · Café Society</title>
${LINKS}
</head>
<body>
<div class="cafe-society antialiased"><in-view-reveal>
${part.html}
</in-view-reveal></div>
${REVEAL_SCRIPT}
</body>
</html>
`

// A page: plain HTML, already assembled from its parts in order. It asks the
// hive for nothing but its three style atoms and its pictures.
//
// WHY NOT HOLES FILLED AT RENDER. The hive can seat parts into a page's holes
// when it draws it (presentation/tiles/division-render.ts), and the first cut
// did that. But the renderer finds a page's parts by walking EVERY tile in the
// hive and reading every mark on it, once per page — on a hive of thousands
// of tiles a cold page took more than a minute, and each part came with its
// own shadow root and its own stylesheet requests (39 for the home page).
// So the seating is done here instead: the same parts, in the same order,
// written into the page once. The parts stay standalone tiles and still wear
// their enrolment marks, so the relation is still stated in the hive and the
// pages can go back to holes the day the renderer stops walking.
const frameDoc = frame => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(frame.title)}</title>
${frame.description ? `<meta name="description" content="${esc(frame.description)}">\n` : ''}${LINKS}
</head>
<body>
<div class="cafe-society antialiased" style="min-height:100vh"><in-view-reveal>
${parts.get('header').html}
<main class="flex flex-col">
${frame.holes.slice(1, -1).map(name => parts.get(name).html).join('\n')}
</main>
${parts.get('footer').html}
</in-view-reveal></div>
${REVEAL_SCRIPT}
</body>
</html>
`

const eagerFirst = (html, count) => {
  let seen = 0
  return html.replace(/<img loading="lazy" decoding="async"/g, m => (seen++ < count ? '<img' : m))
}

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(path.join(OUT, 'preview'), { recursive: true })
const site = {
  site: SITE,
  atoms: { type: TYPE, theme: THEME, sheet: SHEET },
  // One behaviour per module, put once and run by signature.
  scripts: Object.fromEntries(['community-doors', 'in-view-reveal'].map(name =>
    [name, fs.readFileSync(path.join(__dirname, `${name}.js`), 'utf8')])),
  parts: [...parts.values()].map(p => ({ name: p.name, title: p.title, picture: p.picture, html: partDoc(p) })),
  // The logo and the opening picture are on screen at once, so they do not wait.
  frames: frames.map(f => ({ route: f.route, title: f.title, holes: f.holes, picture: parts.get(f.holes[1])?.picture ?? null, html: eagerFirst(frameDoc(f), 2) })),
}
fs.writeFileSync(path.join(OUT, 'site.json'), JSON.stringify(site))

// ── pictures: sized for a screen, not for print ─────────────────────────
// The mockup ships 2560-wide pictures for boxes a few hundred pixels across.
// Each is scaled to at most 1280 wide and written again as webp; the logo
// (shown 70 wide) to 200. Bytes change, so signatures do — once.
const { execFileSync } = require('child_process')
const WEB = path.join(WORK, 'web-1280')   // named for the size: change the size, change the name
fs.mkdirSync(WEB, { recursive: true })
let before = 0, after = 0
for (const name of fs.readdirSync(path.join(WORK, 'img'))) {
  const src = path.join(WORK, 'img', name), dst = path.join(WEB, name)
  const png = fs.readFileSync(src).subarray(1, 4).toString() === 'PNG'
  if (!fs.existsSync(dst) || fs.statSync(dst).mtimeMs < fs.statSync(src).mtimeMs) {
    const tmp = dst + (png ? '.png' : '.webp')
    execFileSync('ffmpeg', png
      ? ['-y', '-loglevel', 'error', '-i', src, '-vf', 'scale=200:-2', tmp]
      : ['-y', '-loglevel', 'error', '-i', src, '-vf', "scale='min(1280,iw)':-2", '-c:v', 'libwebp', '-quality', '60', tmp])
    fs.renameSync(tmp, dst)
  }
  before += fs.statSync(src).size; after += fs.statSync(dst).size
}

// ── preview: the pages as static files, for a local look ────────────────
const local = s => s
  .replace(/resource:\{\{js:([\w-]+)\}\}\/[\w-]+\.js/g, (_m, n) => `${n}.js`)
  .replace(/resource:\{\{css:(\w+)\}\}\/[\w-]+\.css/g, (_m, a) => `${a}.css`)
  .replace(/resource:\{\{img:([^}]+)\}\}/g, (_m, n) => `../../web-1280/${n}`)
  .replace(new RegExp(`href="/${SITE}([^"]*)"`, 'g'), (_m, rest) => `href="${(rest.replace(/^\//, '').replace(/\//g, '_') || 'index')}.html"`)
for (const [name, css] of Object.entries(site.atoms)) fs.writeFileSync(path.join(OUT, 'preview', `${name}.css`), css)
for (const [name, js] of Object.entries(site.scripts)) fs.writeFileSync(path.join(OUT, 'preview', `${name}.js`), js)
const byName = new Map(site.parts.map(p => [p.name, p]))
for (const frame of site.frames) fs.writeFileSync(path.join(OUT, 'preview', `${frame.route.join('_') || 'index'}.html`), local(frame.html))
for (const part of site.parts) fs.writeFileSync(path.join(OUT, 'preview', `part-${part.name}.html`), local(part.html))

const kb = s => (Buffer.byteLength(s) / 1024).toFixed(1) + ' KB'
console.log(`atoms   type ${kb(TYPE)} · theme ${kb(THEME)} · sheet ${kb(SHEET)}`)
console.log(`parts   ${site.parts.length}`)
console.log(`pages   ${site.frames.length}`)
console.log(`pictures ${(before / 1024 | 0)} KB → ${(after / 1024 | 0)} KB`)
const uses = new Map()
for (const f of site.frames) for (const n of f.holes) uses.set(n, (uses.get(n) || 0) + 1)
console.log('shared  ' + [...uses].filter(([, c]) => c > 1).map(([n, c]) => `${n}×${c}`).join(' · '))
const sizes = site.frames.map(f => Buffer.byteLength(f.html))
console.log(`page    ${(Math.min(...sizes) / 1024).toFixed(0)}–${(Math.max(...sizes) / 1024).toFixed(0)} KB of markup each, 3 stylesheet requests`)
