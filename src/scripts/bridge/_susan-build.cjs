// Build Susan's "Family Support" website from a content spec produced by
// the susan-family-support-site workflow. Reads scripts/bridge/_susan_spec.json,
// seeds the susan tree (keeping the existing `family-support` cell), mints a
// warm chrome stylesheet + an elaborate library of gentle SVG illustrations
// as content-addressed image resources, renders one page per cell, and stamps
// each as a `visual:website:page` decoration. Then seeds Q&A personalization
// items.
//
//   node scripts/bridge/_susan-build.cjs
//
// Requires: bridge on ws://localhost:2401 + connected renderer.

const WebSocket = require('ws')
const fs = require('fs')
const BRIDGE = 'ws://localhost:2401'
const ROOT = 'susan'
const SPEC_PATH = 'scripts/bridge/_susan_spec.json'
// existing photographic tile image on susan/family-support (a jungle waterfall)
const WATERFALL_SIG = '88213258636128cfec7acd797c3ced55288be1841d469022293419fd3654bebd'

// ─── bridge plumbing ────────────────────────────────────────────────
let counter = 0
const nextId = () => `sb-${Date.now()}-${++counter}`
function send(req) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE)
    const id = nextId()
    const t = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, 20_000)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
    ws.on('message', raw => { clearTimeout(t); try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) } ws.close() })
    ws.on('error', e => { clearTimeout(t); reject(e) })
  })
}
async function withRenderer(req, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try { const r = await send(req); if (r.ok || r.error !== 'no renderer connected') return r }
    catch (e) { if (i === attempts - 1) throw e }
    await new Promise(r => setTimeout(r, 1200))
  }
  return { ok: false, error: 'renderer never connected' }
}

// ─── text helpers ───────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const titleCase = (s) => String(s).split(/[-_\s]/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ')

// ─── inline icons (stroke, currentColor, theme-adaptive) ─────────────
const ICONS = {
  home:    '<path d="M4 11.5 12 5l8 6.5M6 10.5V20h12v-9.5"/><path d="M10 20v-4.5a2 2 0 0 1 4 0V20"/>',
  heart:   '<path d="M12 20s-7-4.3-7-9.3A3.7 3.7 0 0 1 12 8a3.7 3.7 0 0 1 7 2.7c0 5-7 9.3-7 9.3z"/>',
  hands:   '<path d="M12 21c-3-1.5-7-4.5-7-9a3 3 0 0 1 5-2 3 3 0 0 1 5 0 3 3 0 0 1 4 2.4"/><path d="M14 13l3-2.6a1.6 1.6 0 0 1 2.2 2.3L15 18"/>',
  leaf:    '<path d="M5 19c0-8 6-13 14-14 1 8-4 15-12 14-1-3 0-6 3-8"/>',
  sun:     '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  path:    '<path d="M7 21c0-4 3-5 5-6s4-2 4-5"/><circle cx="16" cy="5" r="2"/><circle cx="7" cy="21" r="1.4"/>',
  people:  '<circle cx="8.5" cy="9" r="2.6"/><circle cx="16" cy="10" r="2.2"/><path d="M3 18c.8-3 3-4.5 5.5-4.5S13 15 13.8 18M14 18c.4-2 1.8-3 3.6-3s2.6 1 3 3"/>',
  book:    '<path d="M5 5.5A2 2 0 0 1 7 4h5v15H7a2 2 0 0 0-2 1.4z"/><path d="M19 5.5A2 2 0 0 0 17 4h-5v15h5a2 2 0 0 1 2 1.4z"/>',
  cup:     '<path d="M5 8h11v5a5 5 0 0 1-10 0z"/><path d="M16 9h2a2.5 2.5 0 0 1 0 5h-2"/><path d="M7 4.5q1-1 0-2M11 4.5q1-1 0-2"/>',
  candle:  '<path d="M9 21h6v-9H9z"/><path d="M12 12c-2-2-3-4 0-7 3 3 2 5 0 7z"/>',
  pin:     '<path d="M12 21s6-5.3 6-10a6 6 0 1 0-12 0c0 4.7 6 10 6 10z"/><circle cx="12" cy="11" r="2.2"/>',
  arrow:   '<path d="M9 6l6 6-6 6"/>',
  section: '<path d="M4 7h13M4 12h16M4 17h10"/>',
}
const iconSvg = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] ?? ICONS.heart}</svg>`

// pick an icon + art for a section by motif keyword
function motifKey(text) {
  const t = String(text || '').toLowerCase()
  if (/hand|hold|cradle|cup/.test(t)) return 'hands'
  if (/candle|flame|light|lantern/.test(t)) return 'candle'
  if (/tree|root|grow|shelter|garden|leaf/.test(t)) return 'tree'
  if (/sun|dawn|hill|hope|horizon|morning/.test(t)) return 'sunrise'
  if (/path|journey|walk|road|step/.test(t)) return 'path'
  if (/circle|people|togeth|gather|community|family/.test(t)) return 'circle'
  if (/book|note|word|read|letter|story|guide/.test(t)) return 'lantern'
  if (/tea|cup|rest|small|comfort|quiet/.test(t)) return 'tea'
  if (/heart|love|care/.test(t)) return 'heart'
  return 'home'
}
const ICON_FOR = { hands: 'hands', candle: 'candle', tree: 'leaf', sunrise: 'sun', path: 'path', circle: 'people', lantern: 'book', tea: 'cup', heart: 'heart', home: 'home' }

// ─── elaborate framed SVG artwork (self-contained image resources) ───
const W = 900, H = 520
const C = { ink:'#43362b', clay:'#c07a5c', clayD:'#9c5b3e', rose:'#d59182', sage:'#7e9a78', sageD:'#5d7a59', cream:'#f7ecd9', warm:'#eab97f', gold:'#cf9a55', sky:'#e9d3bf' }
function frame(id, g1, g2, inner, extraDefs = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">
<defs>
<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${g1}"/><stop offset="1" stop-color="${g2}"/></linearGradient>
<radialGradient id="${id}g" cx="0.5" cy="0.42" r="0.6"><stop offset="0" stop-color="#fff2d6" stop-opacity="0.95"/><stop offset="1" stop-color="#fff2d6" stop-opacity="0"/></radialGradient>
${extraDefs}
</defs>
<rect width="${W}" height="${H}" rx="28" fill="url(#${id})"/>
${inner}
</svg>`
}
const ART = {
  // home — a warm home with a glowing, heart-lit window, framed by a tree
  home: () => frame('home', '#f4e2c8', '#e7c49d', `
    <circle cx="450" cy="250" r="220" fill="url(#homeg)"/>
    <path d="M0 380 Q230 330 450 372 T900 360 V520 H0Z" fill="${C.sageD}" opacity="0.5"/>
    <g>
      <path d="M300 250 L450 150 L600 250 Z" fill="${C.clayD}"/>
      <rect x="330" y="250" width="240" height="160" rx="12" fill="${C.clay}"/>
      <rect x="410" y="310" width="80" height="100" rx="8" fill="${C.warm}"/>
      <path d="M450 332 c-16 -18 -42 -2 -2 28 c40 -30 16 -46 2 -28z" fill="${C.clayD}"/>
      <rect x="352" y="280" width="46" height="42" rx="7" fill="${C.cream}" opacity="0.9"/>
      <rect x="502" y="280" width="46" height="42" rx="7" fill="${C.cream}" opacity="0.9"/>
    </g>
    <g stroke="${C.sageD}" stroke-width="9" stroke-linecap="round" fill="none">
      <path d="M690 410 C690 330 690 300 700 250"/>
    </g>
    <g fill="${C.sage}"><circle cx="700" cy="240" r="46"/><circle cx="662" cy="270" r="34"/><circle cx="738" cy="272" r="34"/></g>`),

  // hands cupping a small flame
  hands: () => frame('hands', '#f3ddc9', '#e3bd9c', `
    <circle cx="450" cy="250" r="150" fill="url(#handsg)"/>
    <g transform="translate(450 250)">
      <path d="M0 -16 c-16 -22 -24 -44 0 -70 c24 26 16 48 0 70z" fill="${C.warm}"/>
      <path d="M0 -34 c-8 -12 -12 -24 0 -38 c12 14 8 26 0 38z" fill="#fff3cf"/>
    </g>
    <g fill="${C.rose}">
      <path d="M250 250 q60 120 200 120 q140 0 200 -120 q-40 70 -200 70 q-160 0 -200 -70z"/>
      <path d="M250 250 q-30 -40 -56 -30 q26 -2 40 24z"/>
      <path d="M650 250 q30 -40 56 -30 q-26 -2 -40 24z"/>
    </g>`),

  // sheltering tree with two small figures beneath
  tree: () => frame('tree', '#eee0c4', '#d8c099', `
    <path d="M0 400 Q250 360 470 396 T900 384 V520 H0Z" fill="${C.sageD}" opacity="0.6"/>
    <g stroke="${C.clayD}" stroke-width="16" stroke-linecap="round" fill="none"><path d="M450 410 C450 320 450 280 450 220"/><path d="M450 300 C420 270 380 268 350 250M450 290 C490 264 540 264 575 244"/></g>
    <g fill="${C.sage}"><circle cx="450" cy="190" r="92"/><circle cx="360" cy="232" r="60"/><circle cx="545" cy="232" r="60"/><circle cx="430" cy="250" r="56"/></g>
    <g fill="${C.sageD}" opacity="0.5"><circle cx="500" cy="200" r="40"/><circle cx="400" cy="210" r="34"/></g>
    <g transform="translate(420 400)" fill="${C.clay}"><circle cx="0" cy="-26" r="14"/><path d="M-16 14c2-18 8-24 16-24s14 6 16 24z"/></g>
    <g transform="translate(478 402)" fill="${C.rose}"><circle cx="0" cy="-22" r="12"/><path d="M-14 12c2-15 7-20 14-20s12 5 14 20z"/></g>`),

  // sunrise over rolling hills
  sunrise: () => frame('sunrise', '#f6d9bf', '#ecc095', `
    <circle cx="450" cy="300" r="240" fill="url(#sunriseg)"/>
    <circle cx="450" cy="260" r="80" fill="${C.warm}"/>
    <g stroke="${C.gold}" stroke-width="4" stroke-linecap="round" opacity="0.6"><path d="M450 150v-26M338 178l-14-22M562 178l14-22M300 300H272M600 300h28"/></g>
    <path d="M0 330 Q220 286 450 326 T900 318 V520 H0Z" fill="${C.sage}" opacity="0.88"/>
    <path d="M0 386 Q270 338 540 378 T900 372 V520 H0Z" fill="${C.sageD}"/>`),

  // a winding path toward light
  path: () => frame('path', '#efe2c6', '#d9c39c', `
    <circle cx="640" cy="200" r="120" fill="url(#pathg)"/><circle cx="640" cy="200" r="46" fill="${C.warm}"/>
    <path d="M0 500 C200 470 240 380 360 360 S520 320 560 240" fill="none" stroke="${C.cream}" stroke-width="34" stroke-linecap="round"/>
    <path d="M0 500 C200 470 240 380 360 360 S520 320 560 240" fill="none" stroke="${C.gold}" stroke-width="3" stroke-dasharray="2 22" stroke-linecap="round" opacity="0.7"/>
    <g fill="${C.sageD}" opacity="0.7"><ellipse cx="150" cy="470" rx="70" ry="22"/><ellipse cx="720" cy="380" rx="60" ry="18"/></g>`),

  // a gentle circle of linked figures
  circle: () => {
    const cx = 450, cy = 250, R = 160, n = 8
    let g = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${C.cream}" stroke-opacity="0.7" stroke-width="4" stroke-dasharray="2 16" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="60" fill="${C.warm}" opacity="0.4"/>`
    const cols = [C.rose, C.cream, C.sage, C.cream, C.clay, C.cream, C.sage, C.cream]
    for (let i = 0; i < n; i++) {
      const a = (-Math.PI / 2) + i * (2 * Math.PI / n)
      const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a)
      g += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><circle cx="0" cy="-12" r="15" fill="${cols[i]}"/><path d="M-19 26c2-17 9-24 19-24s17 7 19 24z" fill="${cols[i]}"/></g>`
    }
    return frame('circle', '#ecdec3', '#d6bf97', g)
  },

  // an open book / lantern giving warm light
  lantern: () => frame('lantern', '#efe1c4', '#dac49b', `
    <circle cx="450" cy="250" r="210" fill="url(#lanterng)"/>
    <g transform="translate(450 280)">
      <path d="M-200 0 Q-100 -44 0 -18 Q100 -44 200 0 L200 78 Q100 34 0 60 Q-100 34 -200 78Z" fill="${C.cream}"/>
      <path d="M0 -18V60" stroke="${C.clayD}" stroke-width="4"/>
      <g stroke="${C.sageD}" stroke-width="3" opacity="0.5"><path d="M-168 8Q-90 -24 -18 -4"/><path d="M-168 28Q-90 -4 -18 16"/><path d="M168 8Q90 -24 18 -4"/><path d="M168 28Q90 -4 18 16"/></g>
    </g>`),

  // a cup with rising steam — small comforts / rest
  tea: () => frame('tea', '#f0e2c6', '#dcc59d', `
    <circle cx="450" cy="250" r="150" fill="url(#teag)"/>
    <g transform="translate(450 300)">
      <path d="M-90 -30 H90 V20 a90 90 0 0 1 -180 0Z" fill="${C.clay}"/>
      <path d="M90 -16 h22 a40 40 0 0 1 0 80 h-22" fill="none" stroke="${C.clay}" stroke-width="14"/>
      <ellipse cx="0" cy="-30" rx="90" ry="18" fill="${C.clayD}"/>
      <g stroke="${C.cream}" stroke-width="7" stroke-linecap="round" opacity="0.85"><path d="M-34 -54 q14 -18 0 -38 q-14 -18 0 -36"/><path d="M0 -58 q14 -18 0 -38 q-14 -18 0 -36"/><path d="M34 -54 q14 -18 0 -38 q-14 -18 0 -36"/></g>
    </g>`),

  // a heart cradled in two hands
  heart: () => frame('heart', '#f2dccb', '#e0b89c', `
    <circle cx="450" cy="240" r="150" fill="url(#heartg)"/>
    <path d="M450 300 s-86 -50 -86 -108 a44 44 0 0 1 86 -16 a44 44 0 0 1 86 16 c0 58 -86 108 -86 108z" fill="${C.rose}"/>
    <g fill="${C.warm}"><path d="M250 300 q60 120 200 120 q140 0 200 -120 q-40 76 -200 76 q-160 0 -200 -76z"/></g>`),
}

// ─── warm chrome stylesheet (inlined per page → robust first paint) ──
const CHROME_CSS = `
:root{
  --paper:#f8f1e7; --paper-deep:#f0e6d6; --surface:#fffdf8; --surface-2:#f4ecdd; --surface-3:#ece1cf;
  --ink:#322a22; --ink-strong:#211a12; --muted:#75695b; --faint:#a0917e;
  --line:rgba(70,54,38,.16); --line-soft:rgba(70,54,38,.09);
  --accent:#b06a52; --accent-ink:#7c4631; --accent-soft:rgba(176,106,82,.13);
  --sage:#6f8c69; --sage-soft:rgba(111,140,105,.14); --gold:#c2924e;
  --shadow:0 18px 46px rgba(80,52,28,.13); --shadow-sm:0 5px 16px rgba(80,52,28,.08);
  --r-s:11px; --r-m:18px; --r-l:26px; --r-pill:999px;
  --serif:"Fraunces","Source Serif 4","Iowan Old Style",Georgia,serif;
  --sans:Inter,"Segoe UI",ui-sans-serif,system-ui,sans-serif;
  --ease:cubic-bezier(.2,.7,.2,1);
}
[data-theme="dark"]{
  --paper:#1d1812; --paper-deep:#15110b; --surface:#262019; --surface-2:#2e271e; --surface-3:#372f24;
  --ink:#efe5d7; --ink-strong:#faf2e4; --muted:#b6ab97; --faint:#867a68;
  --line:rgba(239,229,215,.15); --line-soft:rgba(239,229,215,.08);
  --accent:#d98e74; --accent-ink:#f0c3b0; --accent-soft:rgba(217,142,116,.16);
  --sage:#9bb795; --sage-soft:rgba(155,183,149,.16); --gold:#d6a866;
  --shadow:0 18px 52px rgba(0,0,0,.36); --shadow-sm:0 5px 18px rgba(0,0,0,.3);
}
@media(prefers-color-scheme:dark){:root:not([data-theme]){
  --paper:#1d1812; --paper-deep:#15110b; --surface:#262019; --surface-2:#2e271e; --surface-3:#372f24;
  --ink:#efe5d7; --ink-strong:#faf2e4; --muted:#b6ab97; --faint:#867a68;
  --line:rgba(239,229,215,.15); --line-soft:rgba(239,229,215,.08);
  --accent:#d98e74; --accent-ink:#f0c3b0; --accent-soft:rgba(217,142,116,.16);
  --sage:#9bb795; --sage-soft:rgba(155,183,149,.16); --gold:#d6a866;
  --shadow:0 18px 52px rgba(0,0,0,.36); --shadow-sm:0 5px 18px rgba(0,0,0,.3);
}}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{background:var(--paper);color:var(--ink);font-family:var(--serif);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;transition:background-color .3s var(--ease),color .3s var(--ease)}
body{min-height:100vh;min-height:100dvh}
.s-bg{position:fixed;inset:0;z-index:-1;pointer-events:none;background:radial-gradient(60vmax 52vmax at 6% -10%,var(--accent-soft),transparent 60%),radial-gradient(54vmax 50vmax at 110% 8%,var(--sage-soft),transparent 60%),linear-gradient(180deg,var(--paper-deep),var(--paper))}
main{width:min(76rem,100%);margin:0 auto;padding:clamp(1.1rem,3vw,2.4rem) clamp(1rem,3.5vw,2.4rem) 3.5rem;display:grid;gap:clamp(1rem,2vw,1.7rem);grid-template-columns:1fr;grid-template-areas:"bar" "hero" "content" "rail" "foot";align-content:start}
@media(min-width:940px){main{grid-template-columns:13.5rem minmax(0,1fr) 16.5rem;grid-template-areas:"bar bar bar" "hero hero hero" "left content right" "foot foot foot";column-gap:clamp(1rem,2.2vw,1.9rem)}}
.s-bar{grid-area:bar;display:flex;align-items:center;justify-content:space-between;gap:1rem}
.s-crumb{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap;font-family:var(--sans);font-size:.76rem;letter-spacing:.04em;color:var(--muted)}
.s-crumb a{color:inherit;text-decoration:none;padding:.25rem .5rem;border-radius:var(--r-pill);transition:.15s var(--ease)}
.s-crumb a:hover{background:var(--accent-soft);color:var(--ink-strong)}
.s-crumb b{color:var(--ink-strong);font-family:var(--serif);font-weight:600;font-size:.95rem;padding:.1rem .2rem}
.s-crumb .sep{opacity:.4}
.s-toggle{display:inline-grid;place-items:center;width:2.3rem;height:2.3rem;border:1px solid var(--line);border-radius:var(--r-pill);background:var(--surface);color:var(--muted);cursor:pointer;transition:.18s var(--ease)}
.s-toggle:hover{color:var(--ink-strong);border-color:var(--accent);background:var(--accent-soft)}
.s-toggle svg{width:1.05rem;height:1.05rem;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.s-toggle .sun{display:none}.s-toggle .moon{display:block}
[data-theme="dark"] .s-toggle .sun{display:block}[data-theme="dark"] .s-toggle .moon{display:none}
.s-hero{grid-area:hero;display:grid;gap:1.2rem;grid-template-columns:1fr;align-items:center}
@media(min-width:800px){.s-hero.art{grid-template-columns:1.05fr .95fr}}
.s-hero-art{order:-1;border-radius:var(--r-l);overflow:hidden;box-shadow:var(--shadow);border:1px solid var(--line-soft);background:var(--surface-2)}
@media(min-width:800px){.s-hero-art{order:1}}
.s-hero-art img{display:block;width:100%;height:100%;object-fit:cover;aspect-ratio:900/520}
.s-eyebrow{display:inline-flex;align-items:center;gap:.5em;font-family:var(--sans);font-size:.72rem;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--accent-ink)}
.s-eyebrow .dot{width:.5rem;height:.5rem;border-radius:50%;background:var(--accent)}
.s-title{font-family:var(--serif);font-weight:600;font-size:clamp(1.8rem,4.6vw,3.1rem);line-height:1.05;letter-spacing:-.015em;color:var(--ink-strong);margin:.55rem 0}
.s-title .ico{display:inline-grid;place-items:center;width:1em;height:1em;color:var(--accent);vertical-align:-.08em;margin-right:.32em}
.s-title .ico svg{width:.84em;height:.84em;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.s-lede{font-size:clamp(1.04rem,1.5vw,1.22rem);line-height:1.6;color:var(--muted);max-width:38rem}
.s-content{grid-area:content;display:grid;gap:1.15rem;align-content:start;min-width:0}
.s-prose{display:grid;gap:.9rem;font-size:1.05rem;line-height:1.7;color:var(--ink)}
.s-prose p:first-letter{}
.s-card-note{padding:1.1rem 1.3rem;background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:var(--r-m);box-shadow:var(--shadow-sm);font-size:1.05rem;line-height:1.68}
.s-divider{height:1px;background:var(--line-soft);border:0;margin:.2rem 0}
.s-grid{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,14.5rem),1fr));list-style:none}
.s-card{position:relative;border-radius:var(--r-m);background:var(--surface);border:1px solid var(--line);box-shadow:var(--shadow-sm);transition:transform .2s var(--ease),box-shadow .2s var(--ease),border-color .2s var(--ease)}
.s-card:hover{transform:translateY(-3px);box-shadow:var(--shadow);border-color:var(--accent)}
.s-card a{display:grid;gap:.45rem;padding:1rem 1.1rem 1.1rem;color:inherit;text-decoration:none;height:100%}
.s-card .top{display:flex;align-items:center;gap:.6rem}
.s-card .ico{display:inline-grid;place-items:center;width:2rem;height:2rem;border-radius:var(--r-s);background:var(--accent-soft);color:var(--accent);flex:0 0 auto}
.s-card .ico svg{width:1.1rem;height:1.1rem;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.s-card .name{font-family:var(--serif);font-weight:600;font-size:1.08rem;color:var(--ink-strong);line-height:1.2}
.s-card .blurb{font-size:.92rem;line-height:1.55;color:var(--muted)}
.s-card .go{display:flex;align-items:center;gap:.3em;margin-top:auto;padding-top:.45rem;font-family:var(--sans);font-size:.72rem;letter-spacing:.07em;text-transform:uppercase;color:var(--faint)}
.s-card .go svg{width:1rem;height:1rem;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;transition:transform .2s var(--ease)}
.s-card:hover .go{color:var(--accent)}.s-card:hover .go svg{transform:translateX(3px)}
.s-aside-left{grid-area:left;display:none}.s-aside-right{grid-area:right;display:grid;gap:.85rem;align-content:start;min-width:0}
@media(min-width:940px){.s-aside-left{display:grid;gap:.85rem;align-content:start}}
.s-rail{display:grid;gap:.25rem;padding:.9rem .95rem;background:var(--surface);border:1px solid var(--line-soft);border-radius:var(--r-m)}
.s-rail-h{font-family:var(--sans);font-size:.68rem;letter-spacing:.11em;text-transform:uppercase;color:var(--faint);margin-bottom:.25rem}
.s-rail a{display:block;padding:.36rem .56rem;border-radius:var(--r-s);color:var(--ink);text-decoration:none;font-size:.93rem;line-height:1.3;transition:.15s var(--ease)}
.s-rail a:hover{background:var(--accent-soft);color:var(--ink-strong)}
.s-rail a.cur{background:var(--accent-soft);color:var(--accent-ink);font-weight:600}
.s-qa{padding:1.15rem 1.3rem;background:var(--sage-soft);border:1px solid var(--line);border-radius:var(--r-m)}
.s-qa-h{display:flex;align-items:center;gap:.5em;font-family:var(--sans);font-size:.72rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--sage);margin-bottom:.5rem}
.s-qa p{font-family:var(--serif);font-size:1.05rem;line-height:1.55;color:var(--ink-strong);display:flex;gap:.6rem}
.s-qa p::before{content:'';flex:0 0 .5rem;height:.5rem;margin-top:.55rem;border-radius:50%;background:var(--sage)}
.s-qa .foot{font-family:var(--sans);font-size:.72rem;letter-spacing:.05em;color:var(--faint);margin-top:.5rem;padding-left:1.1rem}
.s-foot{grid-area:foot;margin-top:1.2rem;padding-top:1.1rem;border-top:1px solid var(--line-soft);font-family:var(--sans);font-size:.72rem;letter-spacing:.06em;color:var(--faint);display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}
.s-foot .care{display:inline-flex;align-items:center;gap:.4em}
.s-foot .care svg{width:.95rem;height:.95rem;fill:none;stroke:var(--accent);stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
@media(prefers-reduced-motion:reduce){*{transition-duration:.01ms!important}.s-card:hover{transform:none}}
`.trim()

const PAINT = `(function(){try{var t=localStorage.getItem('hc:susan:theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`
const TOGGLE = `(function(){var b=document.getElementById('sTheme');if(!b)return;function cur(){var t=document.documentElement.getAttribute('data-theme');if(t==='light'||t==='dark')return t;return matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}b.addEventListener('click',function(){var n=cur()==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',n);try{localStorage.setItem('hc:susan:theme',n);}catch(e){}});})();`

// ─── shell ──────────────────────────────────────────────────────────
function crumb(segments) {
  const parts = []
  for (let i = 0; i < segments.length; i++) {
    const last = i === segments.length - 1
    const label = i === 0 ? 'Family Support' : titleCase(segments[i])
    if (last) { parts.push(`<b>${esc(label)}</b>`); break }
    const up = '../'.repeat(segments.length - i - 1) || './'
    parts.push(`<a href="${up}">${esc(label)}</a>`)
  }
  return parts.map((p, i) => i ? `<span class="sep">·</span>${p}` : p).join(' ')
}
function rail(heading, items, cur) {
  if (!items.length) return ''
  const li = items.map(it => `<a href="${esc(it.href)}"${it.name === cur ? ' class="cur" aria-current="page"' : ''}>${esc(it.name)}</a>`).join('')
  return `<nav class="s-rail" aria-label="${esc(heading)}"><div class="s-rail-h">${esc(heading)}</div>${li}</nav>`
}
function card(c) {
  return `<li class="s-card"><a href="${esc(c.href)}"><div class="top"><span class="ico">${iconSvg(c.icon || 'heart')}</span><span class="name">${esc(c.name)}</span></div>${c.blurb ? `<div class="blurb">${esc(c.blurb)}</div>` : ''}<div class="go">Open <svg viewBox="0 0 24 24">${ICONS.arrow}</svg></div></a></li>`
}
function qaBlock(q) {
  if (!q) return ''
  return `<aside class="s-qa"><div class="s-qa-h">${iconSvg('heart')} A note from this space</div><p>${esc(q)}</p><div class="foot">Open this tile in the hive to answer in your own words.</div></aside>`
}
function shell({ segments, eyebrow, title, titleIcon, lede, artImg, bodyHtml, cards, cardsHeading, leftRail, rightRails = [], qa }) {
  const cardsHtml = cards && cards.length ? `${cardsHeading ? `<h2 class="s-eyebrow" style="margin:.5rem 0 .1rem"><span class="dot"></span>${esc(cardsHeading)}</h2>` : ''}<ul class="s-grid" role="list">${cards.map(card).join('')}</ul>` : ''
  const rightHtml = rightRails.map(r => rail(r.heading, r.items, r.cur)).join('') + qaBlock(qa)
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Family Support</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap">
<script>${PAINT}</script><style>${CHROME_CSS}</style></head>
<body><div class="s-bg" aria-hidden="true"></div>
<main>
  <header class="s-bar"><nav class="s-crumb">${crumb(segments)}</nav>
    <button id="sTheme" type="button" class="s-toggle" aria-label="toggle light/dark">
      <svg class="moon" viewBox="0 0 24 24"><path d="M20.5 14.5a8 8 0 0 1-11-11 8 8 0 1 0 11 11z"/></svg>
      <svg class="sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.6"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>
    </button>
  </header>
  <section class="s-hero${artImg ? ' art' : ''}">
    <div class="s-hero-text">${eyebrow ? `<span class="s-eyebrow"><span class="dot"></span>${esc(eyebrow)}</span>` : ''}
      <h1 class="s-title"><span class="ico">${iconSvg(titleIcon)}</span>${esc(title)}</h1>
      ${lede ? `<p class="s-lede">${esc(lede)}</p>` : ''}</div>
    ${artImg ? `<figure class="s-hero-art"><img src="${artImg}" alt="" loading="lazy"></figure>` : ''}
  </section>
  <aside class="s-aside-left">${leftRail ? rail(leftRail.heading, leftRail.items, leftRail.cur) : ''}</aside>
  <section class="s-content">${bodyHtml || ''}${cardsHtml}</section>
  <aside class="s-aside-right">${rightHtml}</aside>
  <footer class="s-foot"><span class="care">${iconSvg('heart')} a space for showing up for the people we love</span><span>right-click to step back</span></footer>
</main><script>${TOGGLE}</script></body></html>`
}
const proseHtml = (paras) => paras && paras.length ? `<div class="s-prose">${paras.map((p, i) => i === 0 ? `<p class="s-card-note">${esc(p)}</p>` : `<p>${esc(p)}</p>`).join('')}</div>` : ''

// ─── main ───────────────────────────────────────────────────────────
;(async () => {
  if (!fs.existsSync(SPEC_PATH)) { console.error(`spec not found at ${SPEC_PATH} — write the workflow output there first`); process.exit(1) }
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'))
  const sections = spec.sections
  console.log(`spec: "${spec.siteTitle}" — ${sections.length} sections, ${sections.reduce((a, s) => a + s.pages.length, 0)} pages\n`)

  // 1. seed structure (keep existing family-support). susan.children = section names.
  console.log('1) seeding structure...')
  await withRenderer({ op: 'update', segments: [ROOT], layer: { name: ROOT, children: sections.map(s => s.name) } })
  for (const s of sections) {
    await withRenderer({ op: 'update', segments: [ROOT, s.name], layer: { name: s.name, children: s.pages.map(p => p.name) } })
    for (const p of s.pages) await withRenderer({ op: 'update', segments: [ROOT, s.name, p.name], layer: { name: p.name, children: [] } })
  }
  console.log('   structure seeded')

  // 2. mint art (dedupe by key)
  const artSig = {}
  async function mintArt(key) {
    if (artSig[key]) return artSig[key]
    const svg = (ART[key] || ART.home)()
    const r = await withRenderer({ op: 'put-resource', text: svg })
    if (r.ok) artSig[key] = r.data.sig
    return artSig[key]
  }
  const artUrl = (sig, name) => sig ? `resource:${sig}/${name || 'art'}.svg` : ''

  // 3. stamp helper
  let ok = 0, fail = 0
  async function stamp(segments, html) {
    const put = await withRenderer({ op: 'put-resource', text: html })
    if (!put.ok) { console.log(`  FAIL mint /${segments.join('/')}: ${put.error}`); fail++; return }
    const dec = await withRenderer({ op: 'decoration-add', segments, kind: 'visual:website:page', appliesTo: segments, payload: { htmlSig: put.data.sig, order: 0, createdAt: Date.now(), icon: 'volunteer_activism' }, mark: 'persistent', replaceKind: true })
    if (!dec.ok) { console.log(`  FAIL stamp /${segments.join('/')}: ${dec.error}`); fail++; return }
    console.log(`  /${segments.join('/')} → ${put.data.sig.slice(0, 10)} (${html.length}B)`); ok++
  }

  // section art — explicit distinct assignment so every section hero differs
  const SECTION_ART_OVERRIDE = {
    'family-support': 'candle', 'the-practical-work': 'lantern', 'what-recovery-is': 'path',
    'its-allowed-heavy': 'heart', 'keeping-standing': 'tea', 'finding-help': 'circle',
  }
  const secArt = {}
  for (const s of sections) secArt[s.name] = SECTION_ART_OVERRIDE[s.name] || motifKey(s.artMotif + ' ' + s.title)
  // leaf heroes cycle through the library (excl. home) so adjacent pages vary
  const LEAF_CYCLE = ['hands', 'tree', 'sunrise', 'path', 'circle', 'lantern', 'tea', 'heart', 'candle']

  // 4. home
  console.log('2) stamping home...')
  await mintArt('home')
  {
    const cards = sections.map(s => ({ name: s.title, href: `${s.name}/`, blurb: s.lede, icon: ICON_FOR[secArt[s.name]] || 'heart' }))
    const body = `<div class="s-prose"><p class="s-card-note">${esc(spec.siteLede)}</p></div>`
    const leftRail = { heading: 'In this space', items: sections.map(s => ({ name: s.title, href: `${s.name}/` })) }
    await stamp([ROOT], shell({ segments: [ROOT], eyebrow: 'Family Support', title: spec.siteTitle, titleIcon: 'home', lede: spec.siteLede, artImg: artUrl(artSig.home, 'home'), bodyHtml: body, cards, cardsHeading: 'Find your way in', leftRail }))
  }

  // 5. sections
  console.log('3) stamping sections...')
  for (const s of sections) {
    const segs = [ROOT, s.name]
    const akey = secArt[s.name]
    await mintArt(akey)
    // family-support section reuses the existing waterfall photo as a second touch
    const artImg = s.name === 'family-support' ? `resource:${WATERFALL_SIG}/grove.webp` : artUrl(artSig[akey], akey)
    const cards = s.pages.map(p => ({ name: p.title, href: `${p.name}/`, blurb: (p.paragraphs && p.paragraphs[0] || '').slice(0, 96), icon: ICON_FOR[akey] || 'heart' }))
    const leftRail = { heading: 'In this space', items: sections.map(x => ({ name: x.title, href: x.name === s.name ? './' : `../${x.name}/` })), cur: s.title }
    const qaItem = (spec.qa || []).find(q => q.sectionName === s.name)
    await stamp(segs, shell({ segments: segs, eyebrow: 'Family Support', title: s.title, titleIcon: ICON_FOR[akey] || 'heart', lede: s.lede, artImg, bodyHtml: proseHtml(s.body), cards, cardsHeading: 'In this section', leftRail, qa: qaItem && qaItem.question }))
  }

  // 6. pages — each leaf gets a hero illustration from the cycle
  console.log('4) stamping pages...')
  let leafN = 0
  for (const s of sections) {
    const akey = secArt[s.name]
    for (const p of s.pages) {
      const segs = [ROOT, s.name, p.name]
      const lkey = LEAF_CYCLE[leafN % LEAF_CYCLE.length]; leafN++
      await mintArt(lkey)
      const sibs = s.pages.map(x => ({ name: x.title, href: x.name === p.name ? './' : `../${x.name}/` }))
      const leftRail = { heading: s.title, items: sibs, cur: p.title }
      const others = sections.filter(x => x.name !== s.name).slice(0, 6).map(x => ({ name: x.title, href: `../../${x.name}/` }))
      await stamp(segs, shell({ segments: segs, eyebrow: s.title, title: p.title, titleIcon: ICON_FOR[akey] || 'heart', lede: '', artImg: artUrl(artSig[lkey], lkey), bodyHtml: proseHtml(p.paragraphs), cards: [], leftRail, rightRails: [{ heading: 'Elsewhere', items: others }] }))
    }
  }

  // 7. Q&A notes onto the cells (so they show in the hive's notes too)
  console.log('5) seeding Q&A personalization notes...')
  for (const q of (spec.qa || [])) {
    const r = await withRenderer({ op: 'note-add', segments: [ROOT], cell: q.sectionName, text: `[Q] ${q.question}` })
    if (r.ok) console.log(`   Q on ${q.sectionName}`)
  }

  console.log(`\nDone. ${ok} pages stamped, ${fail} failed. art=${Object.keys(artSig).length}.`)
  console.log('Renderer → navigate to susan, /website on (or toggle web) to view.')
})().catch(e => { console.error('FATAL', e); process.exit(1) })
