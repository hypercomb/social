// Generate the Howard recovery-hub website over the live `howard` tree.
//
// Reads structure from `inflate howard`, notes from `note-list` per cell,
// mints a small library of gentle self-contained SVG illustrations as
// content-addressed image resources (`put-resource` → /@resource/<sig>),
// renders one warm/private/dignified page per cell, and stamps each as a
// `visual:website:page` decoration (replaceKind → idempotent re-runs).
//
//   node scripts/bridge/_howard-pages.cjs
//
// Requires: bridge on ws://localhost:2401 + connected renderer (the dev
// shell with the bridge flag). Design tone: calm coordination hub for
// family + close circle. No marketing gloss, no flashy effects.

const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'
const ROOT = 'howard'

// ─── bridge plumbing ────────────────────────────────────────────────
let counter = 0
const nextId = () => `hp-${Date.now()}-${++counter}`
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
async function withRenderer(req, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    try { const r = await send(req); if (r.ok || r.error !== 'no renderer connected') return r }
    catch (e) { if (i === attempts - 1) throw e }
    await new Promise(r => setTimeout(r, 1200))
  }
  return { ok: false, error: 'renderer never connected' }
}

// ─── note reading (inflate omits notes for this tree → use note-list) ─
function noteText(n) {
  if (typeof n === 'string') return n
  if (n && typeof n === 'object') {
    if (typeof n.text === 'string') return n.text
    if (Array.isArray(n.body) && n.body[0]) return String(n.body[0].text || '')
  }
  return ''
}
async function notesAt(segments) {
  const r = await withRenderer({ op: 'note-list', segments })
  if (!r.ok || !Array.isArray(r.data)) return []
  const seen = new Set(); const out = []
  for (const n of r.data) { const t = noteText(n).trim(); if (t && !seen.has(t)) { seen.add(t); out.push(t) } }
  return out
}

// ─── small text helpers ─────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
function titleCase(s) {
  return String(s).split(/[-_\s]/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
}
// People tiles are first-names → keep capitalised single word.
function personLabel(s) { return s ? s[0].toUpperCase() + s.slice(1) : s }

// ─── inline icons (stroke, currentColor, theme-adaptive) ─────────────
const ICONS = {
  home:        '<path d="M4 11.5 12 5l8 6.5"/><path d="M6 10.5V20h12v-9.5"/><path d="M10.5 20v-4.2c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5V20"/>',
  status:      '<path d="M3 12h4l2-5 3 11 2.5-6H21"/>',
  team:        '<circle cx="8.5" cy="9" r="2.6"/><circle cx="16" cy="10" r="2.2"/><path d="M3 18c.8-3 3-4.5 5.5-4.5S13 15 13.8 18M14 18c.4-2 1.8-3 3.6-3s2.6 1 3 3"/>',
  'action-items':'<path d="M5 6h14M5 12h14M5 18h9"/><path d="M3.5 6 4.4 7 6 5M3.5 12l.9 1L6 11"/>',
  logistics:   '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9h16M9 3v4M15 3v4"/><circle cx="12" cy="14" r="2.2"/>',
  resources:   '<path d="M5 5.5A2 2 0 0 1 7 4h5v15H7a2 2 0 0 0-2 1.4z"/><path d="M19 5.5A2 2 0 0 0 17 4h-5v15h5a2 2 0 0 1 2 1.4z"/>',
  ideas:       '<path d="M9 17.5h6"/><path d="M10 20.5h4"/><path d="M12 3.5a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3.5z"/>',
  person:      '<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/>',
  heart:       '<path d="M12 20s-7-4.3-7-9.3A3.7 3.7 0 0 1 12 8a3.7 3.7 0 0 1 7 2.7c0 5-7 9.3-7 9.3z"/>',
  arrow:       '<path d="M9 6l6 6-6 6"/>',
  back:        '<path d="M15 6l-6 6 6 6"/>',
  section:     '<path d="M4 7h13M4 12h16M4 17h10"/>',
  pin:         '<path d="M12 21s6-5.3 6-10a6 6 0 1 0-12 0c0 4.7 6 10 6 10z"/><circle cx="12" cy="11" r="2.2"/>',
}
function iconSvg(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ICONS.heart}</svg>`
}

// ─── gentle framed SVG artwork (self-contained image resources) ──────
// Each returns a complete <svg> string with its own soft warm gradient
// panel so it reads as framed art on either light or dark pages. Warm,
// calm, non-clinical. Minted once via put-resource, referenced by <img>.
const W = 880, H = 460
function frame(inner, id, g1, g2) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">
  <defs>
    <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${g1}"/><stop offset="1" stop-color="${g2}"/>
    </linearGradient>
    <radialGradient id="${id}-sun" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffe9c2" stop-opacity="0.95"/><stop offset="1" stop-color="#ffe9c2" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" rx="26" fill="url(#${id})"/>
  ${inner}
</svg>`
}
// soft palette tones used inside the art
const C = { ink: '#3a3026', clay: '#c08a5e', clayD: '#9c6b41', sage: '#6f9079', sageD: '#52715d', cream: '#f6ecda', warm: '#e8b87f', petal: '#d99b86' }

const ART = {
  // home — a hearth: house with a warm glowing window + heart, low hills
  hearth: () => frame(`
    <ellipse cx="440" cy="430" rx="520" ry="90" fill="${C.sageD}" opacity="0.25"/>
    <path d="M0 360 Q220 300 440 350 T880 340 V460 H0 Z" fill="${C.sageD}" opacity="0.5"/>
    <circle cx="440" cy="250" r="170" fill="url(#hearth-sun)"/>
    <g>
      <path d="M300 250 L440 150 L580 250 Z" fill="${C.clayD}"/>
      <rect x="330" y="250" width="220" height="150" rx="10" fill="${C.clay}"/>
      <rect x="400" y="300" width="80" height="100" rx="8" fill="${C.warm}"/>
      <path d="M440 320 c-14 -16 -38 -2 -2 26 c38 -28 14 -42 2 -26 z" fill="${C.clayD}"/>
      <rect x="350" y="278" width="44" height="40" rx="6" fill="${C.cream}" opacity="0.85"/>
      <rect x="492" y="278" width="44" height="40" rx="6" fill="${C.cream}" opacity="0.85"/>
    </g>`, 'hearth', '#f3e3c6', '#e7c9a0'),

  // status — calm dawn over rolling hills, a quiet new day
  dawn: () => frame(`
    <circle cx="440" cy="300" r="220" fill="url(#dawn-sun)"/>
    <circle cx="440" cy="250" r="78" fill="${C.warm}"/>
    <path d="M0 320 Q200 270 440 310 T880 300 V460 H0 Z" fill="${C.sage}" opacity="0.85"/>
    <path d="M0 370 Q260 320 520 360 T880 360 V460 H0 Z" fill="${C.sageD}"/>
    <g stroke="${C.cream}" stroke-opacity="0.5" stroke-width="3" fill="none">
      <path d="M120 250 q20 -16 40 0"/><path d="M700 235 q20 -16 40 0"/>
    </g>`, 'dawn', '#f7dcc0', '#eac49a'),

  // team — a ring of simple figures linked by a soft line
  circle: () => {
    const cx = 440, cy = 230, R = 150, n = 7
    let figs = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${C.cream}" stroke-opacity="0.6" stroke-width="4" stroke-dasharray="2 16" stroke-linecap="round"/>`
    for (let i = 0; i < n; i++) {
      const a = (-Math.PI / 2) + i * (2 * Math.PI / n)
      const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a)
      const hi = i === 0
      figs += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
        <circle cx="0" cy="-10" r="14" fill="${hi ? C.warm : C.cream}"/>
        <path d="M-18 24 c2 -16 8 -22 18 -22 s16 6 18 22 z" fill="${hi ? C.warm : C.cream}"/>
      </g>`
    }
    return frame(`<circle cx="${cx}" cy="${cy}" r="64" fill="${C.clay}" opacity="0.35"/>${figs}`, 'circle', '#e9ddc6', '#d8c39d')
  },

  // action-items — stepping stones across calm water toward a soft horizon
  path: () => frame(`
    <path d="M0 250 H880 V460 H0 Z" fill="${C.sage}" opacity="0.6"/>
    <circle cx="700" cy="200" r="56" fill="${C.warm}"/>
    <g fill="${C.cream}">
      <ellipse cx="160" cy="400" rx="58" ry="22"/>
      <ellipse cx="320" cy="360" rx="50" ry="19"/>
      <ellipse cx="470" cy="330" rx="44" ry="17"/>
      <ellipse cx="610" cy="300" rx="38" ry="15"/>
    </g>
    <g stroke="${C.cream}" stroke-opacity="0.45" stroke-width="3" fill="none">
      <path d="M120 430 H760"/>
    </g>`, 'path', '#e6dcc8', '#cdbf9c'),

  // logistics — a calendar with a warm cup (daily steadiness)
  rhythm: () => frame(`
    <g transform="translate(250 110)">
      <rect x="0" y="0" width="240" height="200" rx="18" fill="${C.cream}"/>
      <rect x="0" y="0" width="240" height="46" rx="18" fill="${C.clay}"/>
      <rect x="0" y="30" width="240" height="16" fill="${C.clay}"/>
      <circle cx="60" cy="-6" r="8" fill="${C.clayD}"/><circle cx="180" cy="-6" r="8" fill="${C.clayD}"/>
      <g fill="${C.sageD}" opacity="0.55">
        <rect x="24" y="74" width="34" height="26" rx="5"/><rect x="74" y="74" width="34" height="26" rx="5"/><rect x="124" y="74" width="34" height="26" rx="5"/><rect x="174" y="74" width="34" height="26" rx="5"/>
        <rect x="24" y="112" width="34" height="26" rx="5"/><rect x="74" y="112" width="34" height="26" rx="5" fill="${C.warm}" opacity="1"/><rect x="124" y="112" width="34" height="26" rx="5"/><rect x="174" y="112" width="34" height="26" rx="5"/>
        <rect x="24" y="150" width="34" height="26" rx="5"/><rect x="74" y="150" width="34" height="26" rx="5"/><rect x="124" y="150" width="34" height="26" rx="5"/>
      </g>
    </g>
    <g transform="translate(560 230)">
      <path d="M0 0 h70 v34 a35 35 0 0 1 -35 35 h0 a35 35 0 0 1 -35 -35 z" fill="${C.clay}"/>
      <path d="M70 8 h14 a14 14 0 0 1 0 28 h-14" fill="none" stroke="${C.clay}" stroke-width="8"/>
      <g stroke="${C.cream}" stroke-width="5" stroke-linecap="round" opacity="0.8"><path d="M18 -18 q8 -10 0 -22"/><path d="M36 -18 q8 -10 0 -22"/></g>
    </g>`, 'rhythm', '#eadfca', '#d6c6a1'),

  // resources — an open book giving warm light
  lantern: () => frame(`
    <circle cx="440" cy="250" r="190" fill="url(#lantern-sun)"/>
    <g transform="translate(440 270)">
      <path d="M-180 0 Q-90 -40 0 -16 Q90 -40 180 0 L180 70 Q90 30 0 54 Q-90 30 -180 70 Z" fill="${C.cream}"/>
      <path d="M0 -16 V54" stroke="${C.clayD}" stroke-width="4"/>
      <g stroke="${C.sageD}" stroke-width="3" opacity="0.5">
        <path d="M-150 6 Q-80 -22 -16 -4"/><path d="M-150 24 Q-80 -4 -16 14"/>
        <path d="M150 6 Q80 -22 16 -4"/><path d="M150 24 Q80 -4 16 14"/>
      </g>
    </g>`, 'lantern', '#f0e2c6', '#dcc59a'),

  // ideas — a small sprout in cupped hands (gentle hope, growth)
  sprout: () => frame(`
    <circle cx="440" cy="220" r="150" fill="url(#sprout-sun)"/>
    <g transform="translate(440 250)">
      <path d="M0 30 C0 0 0 -30 0 -60" stroke="${C.sageD}" stroke-width="8" fill="none"/>
      <path d="M0 -30 C-44 -40 -56 -86 -10 -78 C2 -50 0 -38 0 -30Z" fill="${C.sage}"/>
      <path d="M0 -46 C44 -56 56 -102 10 -94 C-2 -66 0 -54 0 -46Z" fill="${C.sageD}"/>
      <path d="M-90 40 Q-60 100 0 100 Q60 100 90 40 Q60 70 0 70 Q-60 70 -90 40Z" fill="${C.clay}"/>
    </g>`, 'sprout', '#e9e0cb', '#d4c8a2'),

  // generic leaf — a single soft candle (used for any cell w/o a mapping)
  candle: () => frame(`
    <g transform="translate(440 250)">
      <circle cx="0" cy="-70" r="44" fill="url(#candle-sun)"/>
      <path d="M0 -66 c-12 -14 -22 -30 0 -50 c22 20 12 36 0 50z" fill="${C.warm}"/>
      <rect x="-34" y="-40" width="68" height="120" rx="14" fill="${C.cream}"/>
      <rect x="-34" y="-40" width="68" height="16" rx="8" fill="${C.clay}" opacity="0.5"/>
    </g>`, 'candle', '#e7ddc8', '#d3c5a0'),
}
const SECTION_ART = {
  status: 'dawn', team: 'circle', 'action-items': 'path', logistics: 'rhythm', resources: 'lantern', ideas: 'sprout',
}

// ─── chrome stylesheet (inlined per page → robust first paint) ───────
const CHROME_CSS = `
:root{
  --paper:#f6f1e8; --paper-deep:#efe7d9; --surface:#fffdf8; --surface-2:#f2ebdd; --surface-3:#ebe2d0;
  --ink:#2d2720; --ink-strong:#1c160f; --muted:#6d6557; --faint:#9a8e7c;
  --line:rgba(58,48,33,.16); --line-soft:rgba(58,48,33,.09);
  --accent:#5f7d6a; --accent-soft:rgba(95,125,106,.14); --accent-ink:#33493c;
  --clay:#b07a55; --clay-soft:rgba(176,122,85,.14);
  --shadow:0 14px 40px rgba(60,45,25,.10); --shadow-sm:0 4px 14px rgba(60,45,25,.07);
  --r-s:10px; --r-m:16px; --r-l:22px; --r-pill:999px;
  --serif:"Source Serif 4","Iowan Old Style",Georgia,"Times New Roman",serif;
  --sans:Inter,"Segoe UI",ui-sans-serif,system-ui,-apple-system,sans-serif;
  --ease:cubic-bezier(.2,.7,.2,1);
}
[data-theme="dark"]{
  --paper:#1b1813; --paper-deep:#13110b; --surface:#24201a; --surface-2:#2b261e; --surface-3:#332d24;
  --ink:#ece4d6; --ink-strong:#f8f1e3; --muted:#b3a994; --faint:#837a68;
  --line:rgba(236,228,214,.15); --line-soft:rgba(236,228,214,.08);
  --accent:#8fb29c; --accent-soft:rgba(143,178,156,.16); --accent-ink:#cfe2d5;
  --clay:#cd9a73; --clay-soft:rgba(205,154,115,.16);
  --shadow:0 16px 48px rgba(0,0,0,.34); --shadow-sm:0 4px 16px rgba(0,0,0,.28);
}
@media (prefers-color-scheme:dark){:root:not([data-theme]){
  --paper:#1b1813; --paper-deep:#13110b; --surface:#24201a; --surface-2:#2b261e; --surface-3:#332d24;
  --ink:#ece4d6; --ink-strong:#f8f1e3; --muted:#b3a994; --faint:#837a68;
  --line:rgba(236,228,214,.15); --line-soft:rgba(236,228,214,.08);
  --accent:#8fb29c; --accent-soft:rgba(143,178,156,.16); --accent-ink:#cfe2d5;
  --clay:#cd9a73; --clay-soft:rgba(205,154,115,.16);
  --shadow:0 16px 48px rgba(0,0,0,.34); --shadow-sm:0 4px 16px rgba(0,0,0,.28);
}}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{background:var(--paper);color:var(--ink);font-family:var(--serif);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
  transition:background-color .3s var(--ease),color .3s var(--ease)}
body{min-height:100vh;min-height:100dvh}
.hb-backdrop{position:fixed;inset:0;z-index:-1;pointer-events:none;
  background:radial-gradient(60vmax 50vmax at 8% -8%,var(--clay-soft),transparent 60%),radial-gradient(54vmax 50vmax at 108% 12%,var(--accent-soft),transparent 60%),linear-gradient(180deg,var(--paper-deep),var(--paper))}
main{width:min(74rem,100%);margin:0 auto;padding:clamp(1.1rem,3vw,2.2rem) clamp(1rem,3.5vw,2.2rem) 3rem;
  display:grid;gap:clamp(1rem,2vw,1.6rem);grid-template-columns:1fr;
  grid-template-areas:"bar" "hero" "content" "rail" "foot";align-content:start}
@media(min-width:920px){main{grid-template-columns:13.5rem minmax(0,1fr) 16rem;
  grid-template-areas:"bar bar bar" "hero hero hero" "left content right" "foot foot foot";column-gap:clamp(1rem,2.2vw,1.8rem)}}
.hb-bar{grid-area:bar;display:flex;align-items:center;justify-content:space-between;gap:1rem}
.hb-crumb{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap;font-family:var(--sans);font-size:.76rem;letter-spacing:.04em;color:var(--muted)}
.hb-crumb a{color:inherit;text-decoration:none;padding:.25rem .5rem;border-radius:var(--r-pill);transition:background .15s var(--ease),color .15s var(--ease)}
.hb-crumb a:hover{background:var(--accent-soft);color:var(--ink-strong)}
.hb-crumb b{color:var(--ink-strong);font-family:var(--serif);font-weight:600;font-size:.92rem;padding:.1rem .2rem}
.hb-crumb .sep{opacity:.4}
.hb-toggle{display:inline-grid;place-items:center;width:2.3rem;height:2.3rem;border:1px solid var(--line);border-radius:var(--r-pill);
  background:var(--surface);color:var(--muted);cursor:pointer;transition:.18s var(--ease)}
.hb-toggle:hover{color:var(--ink-strong);border-color:var(--accent);background:var(--accent-soft)}
.hb-toggle svg{width:1.05rem;height:1.05rem;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.hb-toggle .sun{display:none}.hb-toggle .moon{display:block}
[data-theme="dark"] .hb-toggle .sun{display:block}[data-theme="dark"] .hb-toggle .moon{display:none}
.hb-hero{grid-area:hero;display:grid;gap:1.1rem;grid-template-columns:1fr;align-items:center}
@media(min-width:780px){.hb-hero.has-art{grid-template-columns:1.15fr .85fr}}
.hb-hero-art{order:-1;border-radius:var(--r-l);overflow:hidden;box-shadow:var(--shadow);border:1px solid var(--line-soft);background:var(--surface-2)}
@media(min-width:780px){.hb-hero-art{order:1}}
.hb-hero-art img{display:block;width:100%;height:100%;object-fit:cover;aspect-ratio:880/460}
.hb-eyebrow{display:inline-flex;align-items:center;gap:.5em;font-family:var(--sans);font-size:.72rem;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--accent-ink)}
.hb-eyebrow .dot{width:.5rem;height:.5rem;border-radius:50%;background:var(--accent)}
.hb-title{font-family:var(--serif);font-weight:600;font-size:clamp(1.7rem,4.4vw,2.9rem);line-height:1.08;letter-spacing:-.012em;color:var(--ink-strong);margin:.5rem 0}
.hb-title .ico{display:inline-grid;place-items:center;width:1em;height:1em;color:var(--accent);vertical-align:-.06em;margin-right:.3em}
.hb-title .ico svg{width:.86em;height:.86em;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.hb-lede{font-size:clamp(1rem,1.5vw,1.16rem);line-height:1.6;color:var(--muted);max-width:36rem}
.hb-content{grid-area:content;display:grid;gap:1.1rem;align-content:start;min-width:0}
.hb-prose{display:grid;gap:.85rem;font-size:1.02rem;line-height:1.65;color:var(--ink)}
.hb-prose p strong,.hb-prose b{color:var(--ink-strong)}
.hb-note{padding:1.05rem 1.2rem;background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:var(--r-m);box-shadow:var(--shadow-sm)}
.hb-note h3{display:flex;align-items:center;gap:.5em;font-family:var(--serif);font-weight:600;font-size:1.06rem;color:var(--ink-strong);margin-bottom:.35rem}
.hb-note h3 .ico{width:1.05em;height:1.05em;color:var(--accent)}
.hb-note h3 .ico svg{width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.hb-note p{color:var(--ink);font-size:1rem;line-height:1.62}
.hb-chips{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.2rem}
.hb-chip{display:inline-flex;align-items:center;gap:.4em;font-family:var(--sans);font-size:.74rem;font-weight:600;letter-spacing:.02em;
  padding:.28rem .65rem;border-radius:var(--r-pill);background:var(--clay-soft);color:var(--clay);border:1px solid transparent}
.hb-chip.accent{background:var(--accent-soft);color:var(--accent-ink)}
.hb-divider{height:1px;background:var(--line-soft);border:0}
.hb-grid{display:grid;gap:.7rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr));list-style:none}
.hb-card{position:relative;border-radius:var(--r-m);background:var(--surface);border:1px solid var(--line);box-shadow:var(--shadow-sm);
  transition:transform .2s var(--ease),box-shadow .2s var(--ease),border-color .2s var(--ease)}
.hb-card:hover{transform:translateY(-2px);box-shadow:var(--shadow);border-color:var(--accent)}
.hb-card a{display:grid;gap:.4rem;padding:.95rem 1.05rem 1.05rem;color:inherit;text-decoration:none;height:100%}
.hb-card .top{display:flex;align-items:center;gap:.55rem}
.hb-card .ico{display:inline-grid;place-items:center;width:1.9rem;height:1.9rem;border-radius:var(--r-s);background:var(--accent-soft);color:var(--accent);flex:0 0 auto}
.hb-card .ico svg{width:1.05rem;height:1.05rem;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.hb-card .name{font-family:var(--serif);font-weight:600;font-size:1.05rem;color:var(--ink-strong);line-height:1.2}
.hb-card .blurb{font-size:.9rem;line-height:1.5;color:var(--muted)}
.hb-card .go{display:flex;align-items:center;gap:.3em;margin-top:auto;padding-top:.4rem;font-family:var(--sans);font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
.hb-card .go svg{width:1rem;height:1rem;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;transition:transform .2s var(--ease)}
.hb-card:hover .go{color:var(--accent)}.hb-card:hover .go svg{transform:translateX(3px)}
.hb-aside-left{grid-area:left;display:none}
.hb-aside-right{grid-area:right;display:grid;gap:.8rem;align-content:start;min-width:0}
@media(min-width:920px){.hb-aside-left{display:grid;gap:.8rem;align-content:start}}
.hb-rail{display:grid;gap:.25rem;padding:.85rem .9rem;background:var(--surface);border:1px solid var(--line-soft);border-radius:var(--r-m)}
.hb-rail-h{font-family:var(--sans);font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);margin-bottom:.25rem}
.hb-rail a{display:block;padding:.35rem .55rem;border-radius:var(--r-s);color:var(--ink);text-decoration:none;font-size:.92rem;line-height:1.3;transition:.15s var(--ease)}
.hb-rail a:hover{background:var(--accent-soft);color:var(--ink-strong)}
.hb-rail a.cur{background:var(--accent-soft);color:var(--accent-ink);font-weight:600}
.hb-foot{grid-area:foot;margin-top:1rem;padding-top:1rem;border-top:1px solid var(--line-soft);
  font-family:var(--sans);font-size:.72rem;letter-spacing:.06em;color:var(--faint);display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}
.hb-foot .care{display:inline-flex;align-items:center;gap:.4em}
.hb-foot .care svg{width:.95rem;height:.95rem;fill:none;stroke:var(--clay);stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
@media(prefers-reduced-motion:reduce){*{transition-duration:.01ms!important}.hb-card:hover{transform:none}}
`.trim()

const PAINT = `(function(){try{var t=localStorage.getItem('hc:howard:theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`
const TOGGLE = `(function(){var b=document.getElementById('hbTheme');if(!b)return;function cur(){var t=document.documentElement.getAttribute('data-theme');if(t==='light'||t==='dark')return t;return matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}b.addEventListener('click',function(){var n=cur()==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',n);try{localStorage.setItem('hc:howard:theme',n);}catch(e){}});})();`

// ─── shell ──────────────────────────────────────────────────────────
function crumb(segments) {
  const parts = []
  for (let i = 0; i < segments.length; i++) {
    const last = i === segments.length - 1
    const label = i === 0 ? 'Howard' : titleCase(segments[i])
    if (last) { parts.push(`<b>${esc(label)}</b>`); break }
    const up = '../'.repeat(segments.length - i - 1) || './'
    parts.push(`<a href="${up}">${esc(label)}</a>`)
  }
  return parts.map((p, i) => i ? `<span class="sep">·</span>${p}` : p).join(' ')
}
function railHtml(heading, items, curName) {
  if (!items.length) return ''
  const li = items.map(it => `<a href="${esc(it.href)}"${it.name === curName ? ' class="cur" aria-current="page"' : ''}>${esc(it.name)}</a>`).join('')
  return `<nav class="hb-rail" aria-label="${esc(heading)}"><div class="hb-rail-h">${esc(heading)}</div>${li}</nav>`
}
function cardHtml(c) {
  return `<li class="hb-card"><a href="${esc(c.href)}">
    <div class="top"><span class="ico">${iconSvg(c.icon || 'heart')}</span><span class="name">${esc(c.name)}</span></div>
    ${c.blurb ? `<div class="blurb">${esc(c.blurb)}</div>` : ''}
    <div class="go">${c.cta || 'Open'} <svg viewBox="0 0 24 24">${ICONS.arrow}</svg></div>
  </a></li>`
}
function shell({ segments, eyebrow, title, titleIcon, lede, artImg, body, cards, cardsHeading, leftRail, rightRails = [] }) {
  const cardsHtml = cards && cards.length
    ? `${cardsHeading ? `<h2 class="hb-eyebrow" style="margin:.4rem 0 .2rem"><span class="dot"></span>${esc(cardsHeading)}</h2>` : ''}<ul class="hb-grid" role="list">${cards.map(cardHtml).join('')}</ul>`
    : ''
  const rightHtml = (cards && cards.length ? '' : '') + rightRails.map(r => railHtml(r.heading, r.items, r.cur)).join('')
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Howard</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600;8..60,700&family=Inter:wght@400;500;600&display=swap">
<script>${PAINT}</script>
<style>${CHROME_CSS}</style>
</head><body>
<div class="hb-backdrop" aria-hidden="true"></div>
<main>
  <header class="hb-bar">
    <nav class="hb-crumb">${crumb(segments)}</nav>
    <button id="hbTheme" type="button" class="hb-toggle" aria-label="toggle light/dark">
      <svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.5a8 8 0 0 1-11-11 8 8 0 1 0 11 11z"/></svg>
      <svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.6"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>
    </button>
  </header>
  <section class="hb-hero${artImg ? ' has-art' : ''}">
    <div class="hb-hero-text">
      ${eyebrow ? `<span class="hb-eyebrow"><span class="dot"></span>${esc(eyebrow)}</span>` : ''}
      <h1 class="hb-title"><span class="ico">${iconSvg(titleIcon)}</span>${esc(title)}</h1>
      ${lede ? `<p class="hb-lede">${esc(lede)}</p>` : ''}
    </div>
    ${artImg ? `<figure class="hb-hero-art"><img src="${artImg}" alt="" loading="lazy"></figure>` : ''}
  </section>
  <aside class="hb-aside-left">${leftRail ? railHtml(leftRail.heading, leftRail.items, leftRail.cur) : ''}</aside>
  <section class="hb-content">${body || ''}${cardsHtml}</section>
  <aside class="hb-aside-right">${rightHtml}</aside>
  <footer class="hb-foot">
    <span class="care"><svg viewBox="0 0 24 24">${ICONS.heart}</svg> a private hub for Howard's circle</span>
    <span>right-click to step back</span>
  </footer>
</main>
<script>${TOGGLE}</script>
</body></html>`
}

// note → prose / promoted note-cards. Splits "Label: text" leading
// fragments into a labelled note card; renders the rest as prose.
function bodyFromNotes(notes, icon) {
  if (!notes.length) return `<div class="hb-prose"><p>This area is ready for updates — add a note in the hub and it appears here.</p></div>`
  const blocks = notes.map(n => {
    const m = /^([A-Z][A-Za-z .'/-]{1,28}):\s+(.+)$/s.exec(n)
    if (m) {
      return `<div class="hb-note"><h3><span class="ico">${iconSvg(icon)}</span>${esc(m[1].trim())}</h3><p>${esc(m[2].trim())}</p></div>`
    }
    return `<div class="hb-prose"><p>${esc(n)}</p></div>`
  })
  return blocks.join('')
}
// pull a leading "Owner: X" / "Frame: …" style chip out of a note set
function chipsFromNotes(notes) {
  const chips = []
  for (const n of notes) {
    const own = /Owner:\s*([A-Za-z][A-Za-z ,&+]*?)(?:\.|\s—|$)/.exec(n)
    if (own) chips.push({ t: 'Owner · ' + own[1].trim(), accent: true })
  }
  return chips
}

// ─── main ───────────────────────────────────────────────────────────
;(async () => {
  console.log('Howard hub — generating website\n')

  // 1. read the tree
  const inf = await withRenderer({ op: 'inflate', segments: [ROOT] })
  if (!inf.ok) { console.error('inflate failed:', inf.error); process.exit(1) }
  const tree = inf.data
  const sections = (tree.children || []).map(c => ({ name: c.name, children: (c.children || []).map(g => g.name) }))
  console.log(`tree: ${sections.length} sections, ${sections.reduce((a, s) => a + s.children.length, 0)} leaves`)

  // 2. mint artwork once (dedupe by key)
  const artSig = {}
  async function mintArt(key) {
    if (artSig[key]) return artSig[key]
    const svg = (ART[key] || ART.candle)()
    const r = await withRenderer({ op: 'put-resource', text: svg })
    if (!r.ok) { console.warn('art mint failed', key, r.error); return null }
    artSig[key] = r.data.sig
    return r.data.sig
  }
  const artUrl = (sig) => sig ? `resource:${sig}/art.svg` : ''

  // 3. stamp helper
  let ok = 0, fail = 0
  async function stamp(segments, html) {
    const put = await withRenderer({ op: 'put-resource', text: html })
    if (!put.ok) { console.log(`  FAIL mint /${segments.join('/')}: ${put.error}`); fail++; return }
    const dec = await withRenderer({
      op: 'decoration-add', segments, kind: 'visual:website:page', appliesTo: segments,
      payload: { htmlSig: put.data.sig, order: 0, createdAt: Date.now() }, mark: 'persistent', replaceKind: true,
    })
    if (!dec.ok) { console.log(`  FAIL stamp /${segments.join('/')}: ${dec.error}`); fail++; return }
    console.log(`  /${segments.join('/')} → ${put.data.sig.slice(0, 10)} (${html.length}B)`)
    ok++
  }

  // section copy (warm, calm). lede shown under the title.
  const SECTION_META = {
    status:         { title: 'Status', eyebrow: 'How Howard is doing', lede: 'A single, current picture — updated after each visit or call so nobody has to relay it through scattered texts.' },
    team:           { title: 'The circle', eyebrow: 'Who is helping', lede: 'The people around Howard, and the part each one is holding. Tap a name to see their role.' },
    'action-items': { title: 'Action items', eyebrow: 'What needs doing', lede: 'The handful of things that move Howard forward — who owns each, and what it unblocks.' },
    logistics:      { title: 'Logistics', eyebrow: 'Day-to-day support', lede: 'The small practical things that make his days easier — phone, sleep, visits, and those who depend on him.' },
    resources:      { title: 'Resources', eyebrow: 'Outside help', lede: 'People and services beyond the circle who can lend specialist support when we ask.' },
    ideas:          { title: 'Ideas', eyebrow: 'Simple ways to help', lede: 'Concrete, low-effort ways to pitch in. Pick one and run with it.' },
  }
  const SECTION_ICON = { status: 'status', team: 'team', 'action-items': 'action-items', logistics: 'logistics', resources: 'resources', ideas: 'ideas' }

  // 4. HOME (howard root)
  const rootNotes = await notesAt([ROOT])
  await mintArt('hearth')
  {
    const sectionCards = sections.map(s => ({
      name: SECTION_META[s.name]?.title || titleCase(s.name),
      href: `${s.name}/`,
      blurb: SECTION_META[s.name]?.lede || '',
      icon: SECTION_ICON[s.name] || 'heart',
      cta: 'Open',
    }))
    const lede = rootNotes[0] || 'A calm, private place for Howard’s circle to stay coordinated.'
    const body = `
      <div class="hb-note"><h3><span class="ico">${iconSvg('pin')}</span>Where things stand</h3>
        <p>${esc(rootNotes[0] || '')}</p></div>
      <div class="hb-prose"><p>This hub keeps everyone aligned without a group-text pile-up. Each area below is one part of supporting Howard — <strong>status</strong> for how he’s doing, <strong>the circle</strong> for who’s helping, <strong>action items</strong> for what needs doing, <strong>logistics</strong> for daily care, <strong>resources</strong> for outside help, and <strong>ideas</strong> for quick ways to pitch in.</p></div>`
    const leftRail = { heading: 'Areas', items: sections.map(s => ({ name: SECTION_META[s.name]?.title || titleCase(s.name), href: `${s.name}/` })) }
    await stamp([ROOT], shell({
      segments: [ROOT], eyebrow: 'Recovery hub', title: 'Supporting Howard, together', titleIcon: 'home',
      lede, artImg: artUrl(artSig.hearth), body, cards: sectionCards, cardsHeading: 'The six areas', leftRail,
    }))
  }

  // 5. SECTIONS
  for (const s of sections) {
    const segs = [ROOT, s.name]
    const meta = SECTION_META[s.name] || { title: titleCase(s.name), eyebrow: '', lede: '' }
    const secNotes = await notesAt(segs)
    const artKey = SECTION_ART[s.name] || 'candle'
    await mintArt(artKey)
    // child cards w/ first-note blurb
    const childCards = []
    for (const child of s.children) {
      const cn = await notesAt([...segs, child])
      let blurb = cn[0] || ''
      if (blurb.length > 96) blurb = blurb.slice(0, 93) + '…'
      childCards.push({ name: s.name === 'team' ? personLabel(child) : titleCase(child), href: `${child}/`, blurb, icon: s.name === 'team' ? 'person' : (SECTION_ICON[s.name] || 'heart'), cta: s.name === 'team' ? 'Their role' : 'Open' })
    }
    const leftRail = { heading: 'Areas', items: sections.map(x => ({ name: SECTION_META[x.name]?.title || titleCase(x.name), href: x.name === s.name ? './' : `../${x.name}/` })), cur: meta.title }
    const body = secNotes.length > 1 ? bodyFromNotes(secNotes.slice(1), SECTION_ICON[s.name]) : ''
    await stamp(segs, shell({
      segments: segs, eyebrow: meta.eyebrow, title: meta.title, titleIcon: SECTION_ICON[s.name] || 'heart',
      lede: meta.lede || secNotes[0] || '', artImg: artUrl(artSig[artKey]), body,
      cards: childCards, cardsHeading: s.name === 'team' ? 'The people' : 'In this area', leftRail,
    }))
  }

  // 6. LEAVES
  for (const s of sections) {
    const isTeam = s.name === 'team'
    for (const child of s.children) {
      const segs = [ROOT, s.name, child]
      const notes = await notesAt(segs)
      const title = isTeam ? personLabel(child) : titleCase(child)
      const icon = isTeam ? 'person' : (SECTION_ICON[s.name] || 'heart')
      const chips = chipsFromNotes(notes)
      const chipsHtml = chips.length ? `<div class="hb-chips">${chips.map(c => `<span class="hb-chip${c.accent ? ' accent' : ''}">${esc(c.t)}</span>`).join('')}</div>` : ''
      const body = chipsHtml + bodyFromNotes(notes, icon)
      // sibling rail
      const sibs = s.children.map(x => ({ name: isTeam ? personLabel(x) : titleCase(x), href: x === child ? './' : `../${x}/` }))
      const leftRail = { heading: SECTION_META[s.name]?.title || titleCase(s.name), items: sibs, cur: title }
      // right rail: jump to other areas
      const others = sections.filter(x => x.name !== s.name).slice(0, 6).map(x => ({ name: SECTION_META[x.name]?.title || titleCase(x.name), href: `../../${x.name}/` }))
      await stamp(segs, shell({
        segments: segs, eyebrow: isTeam ? 'Support circle' : (SECTION_META[s.name]?.title || titleCase(s.name)),
        title, titleIcon: icon,
        lede: isTeam ? `Part of Howard’s circle.` : '',
        artImg: '', body, cards: [], leftRail, rightRails: [{ heading: 'Other areas', items: others }],
      }))
    }
  }

  console.log(`\nDone. ${ok} pages stamped, ${fail} failed. art=${Object.keys(artSig).length} illustrations.`)
  console.log('Navigate the renderer to howard and run /website on (or toggle the web icon) to view.')
})().catch(e => { console.error('FATAL', e); process.exit(1) })
