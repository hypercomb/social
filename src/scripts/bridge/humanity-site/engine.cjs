// Humanity Centres — site render engine.
//
// One template, many pages. Authored once in pages.cjs, emitted in two
// modes:
//   • 'app'      → image refs as `resource:<sig>` (rewritten to
//                  /@resource/<sig> by site-view.drone) and links as
//                  absolute cell-nav hrefs (`/humanity-centres/...`).
//   • 'preview'  → image refs as local `assets/<shortsig>.webp` and
//                  links as flat `<slug>.html` files, for standalone
//                  visual review in a browser before stamping.
//
// The chrome stylesheet is shared: in app mode it is minted ONCE as a
// resource and linked via `resource:<sig>/chrome.css`; in preview mode
// it is written to `chrome.css` next to the pages. Same source string.

const fs = require('fs')
const path = require('path')

// ─── image manifest (tree path → full sig) ──────────────────────────
const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '_humanity_assets', '_manifest.json'), 'utf8'),
)
// Accept either a tree path ('programs/me' or 'humanity-centres') or a raw
// 64-hex sig. Manifest keys are full tree paths ('humanity-centres/...').
function sigFor(ref) {
  if (!ref) return null
  if (/^[0-9a-f]{64}$/.test(ref)) return ref
  return MANIFEST[ref] || MANIFEST[`humanity-centres/${ref}`] || null
}

// ─── slug / href helpers ────────────────────────────────────────────
const ROOT = 'humanity-centres'
function slugOf(segments) {
  // segments include the leading 'humanity-centres'
  if (segments.length === 1) return 'index'
  return segments.slice(1).join('__')
}

// ─── HTML escape ────────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
// Allow a small set of inline tags in body copy (em/strong/br/a handled upstream)
function rich(s) {
  return String(s == null ? '' : s)
}

// ─── icon library (inline SVG path data, currentColor stroke) ───────
const ICONS = {
  hex: '<path d="M12 2.6 20.4 7v10L12 21.4 3.6 17V7z"/>',
  spark: '<path d="M12 3v6M12 15v6M3 12h6M15 12h6"/><circle cx="12" cy="12" r="2.4"/>',
  heart: '<path d="M12 20s-7-4.6-9.2-9.1C1.3 7.8 3 5 6 5c2 0 3.2 1.2 4 2.4C10.8 6.2 12 5 14 5c3 0 4.7 2.8 3.2 5.9C19 15.4 12 20 12 20z"/>',
  people: '<circle cx="9" cy="9" r="3.2"/><circle cx="17" cy="11" r="2.4"/><path d="M2.5 19c1-3.2 4-5 6.5-5s5.5 1.8 6.5 5M15 19c.6-2.2 2.4-3.2 4.2-3.2s2.9 1 3.3 3.2"/>',
  self: '<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20c.7-3.6 3.4-5.6 6.5-5.6S17.8 16.4 18.5 20"/>',
  two: '<circle cx="8.5" cy="8.5" r="3"/><circle cx="15.5" cy="8.5" r="3"/><path d="M3.5 19c.8-3 3-4.6 5-4.6M20.5 19c-.8-3-3-4.6-5-4.6"/>',
  circle: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="3.4"/>',
  purse: '<path d="M5 9h14l1.4 10.5a1.4 1.4 0 0 1-1.4 1.5H5a1.4 1.4 0 0 1-1.4-1.5z"/><path d="M8.5 9c0-3 1.6-5 3.5-5s3.5 2 3.5 5"/>',
  gift: '<rect x="4" y="9" width="16" height="11" rx="1.4"/><path d="M4 13h16M12 9v11M12 9c-2.5 0-4-1-4-2.6S9.5 4 12 9c2.5-5 4-3.6 4-2.6S14.5 9 12 9z"/>',
  flow: '<path d="M4 7h9a4 4 0 0 1 0 8H8"/><path d="M11 12l-3-3M11 12l-3 3M20 17h-7"/>',
  share: '<circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M8.1 11 16 6.6M8.1 13 16 17.4"/>',
  pin: '<path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
  globe: '<circle cx="12" cy="12" r="8.4"/><path d="M3.6 12h16.8M12 3.6c2.4 2.3 3.6 5.3 3.6 8.4S14.4 18 12 20.4C9.6 18 8.4 15.1 8.4 12S9.6 5.9 12 3.6z"/>',
  home: '<path d="M4 11 12 4l8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-6h4v6"/>',
  leaf: '<path d="M5 19c0-8 6-13 14-13 0 8-5 14-13 14 0-4 2-7 6-9"/>',
  store: '<path d="M4 9 5.5 4h13L20 9"/><path d="M4 9h16v11H4z"/><path d="M9 20v-6h6v6"/><path d="M4 9a2.4 2.4 0 0 0 4 0 2.4 2.4 0 0 0 4 0 2.4 2.4 0 0 0 4 0 2.4 2.4 0 0 0 4 0"/>',
  bed: '<path d="M3 17v-5a2 2 0 0 1 2-2h11a3 3 0 0 1 3 3v4M3 13h18M3 17v2M21 17v2M7 10V8a1.6 1.6 0 0 1 1.6-1.6h4A1.6 1.6 0 0 1 14 8v2"/>',
  hands: '<path d="M12 13c2-3 4-4 6-3 1.6.8 1.4 3-1 4.6L12 19l-5-4.4C4.6 13 4.4 10.8 6 10c2-1 4 0 6 3z"/>',
  star: '<path d="M12 3.6 14.2 9l5.8.5-4.4 3.8 1.4 5.7L12 16l-5 3 1.4-5.7L4 9.5 9.8 9z"/>',
  compass: '<circle cx="12" cy="12" r="8.4"/><path d="M15.5 8.5 13 13l-4.5 2.5L11 11z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.6V5M12 19v2.4M2.6 12H5M19 12h2.4M5.3 5.3 7 7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7"/>',
  moon: '<path d="M20.5 14.3A8.4 8.4 0 0 1 9.7 3.5a8.4 8.4 0 1 0 10.8 10.8z"/>',
  arrow: '<path d="M5 12h13M12 6l6 6-6 6"/>',
  seed: '<path d="M12 21c-4-1-7-4-7-9 0 0 4 .5 6 3 .3-3-1-6-1-9 2 2 5 5 5 9 2-2.5 5-3 5-3 0 5-4 8-8 9z"/>',
}
function icon(key, cls = 'ic') {
  const d = ICONS[key] || ICONS.spark
  return `<span class="${cls}" aria-hidden="true"><svg viewBox="0 0 24 24">${d}</svg></span>`
}

// ════════════════════════════════════════════════════════════════════
// CHROME STYLESHEET  (warm "dawn" default · "dusk" dark theme)
// ════════════════════════════════════════════════════════════════════
const CSS = `
:root{
  --dawn:#fbf6ef; --dawn-2:#f4ead9; --parchment:#fffdf9;
  --ink:#2a211b; --ink-soft:#5a4d42; --ink-faint:#8a7b6c;
  --line:rgba(78,58,40,.14); --line-soft:rgba(78,58,40,.08); --line-strong:rgba(78,58,40,.30);
  --surface:#fffdf9; --surface-2:#faf3e8; --surface-hover:#fdf0db;
  --honey:#d98a2b; --honey-deep:#b46a16; --honey-soft:rgba(217,138,43,.14);
  --sage:#3f8f72; --sage-soft:rgba(63,143,114,.14);
  --rose:#c2526a; --rose-soft:rgba(194,82,106,.12);
  /* text-only accents that clear WCAG AA (4.5:1) on light surfaces */
  --honey-ink:#9a5910; --sage-ink:#2f6f57;
  --hero-ink:#fdf6ec; --hero-ink-soft:rgba(253,246,236,.84);
  --shadow:0 18px 50px rgba(60,40,20,.10); --shadow-lg:0 30px 80px rgba(50,32,14,.16);
  --radius:1.25rem; --radius-lg:1.8rem; --radius-pill:999px;
  --serif:"Fraunces","Spectral",Georgia,"Iowan Old Style","Palatino Linotype",serif;
  --sans:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --ease:cubic-bezier(.22,.7,.2,1);
  --maxw:74rem;
  color-scheme:light;
}
[data-theme="dark"]{
  --dawn:#171210; --dawn-2:#100b09; --parchment:#1d1714;
  --ink:#f3e9dc; --ink-soft:#cdbca9; --ink-faint:#9a8775;
  --line:rgba(240,220,195,.14); --line-soft:rgba(240,220,195,.07); --line-strong:rgba(240,220,195,.30);
  --surface:#211a16; --surface-2:#1a1410; --surface-hover:#2a201a;
  --honey:#f0a847; --honey-deep:#d98a2b; --honey-soft:rgba(240,168,71,.16);
  --sage:#5fb592; --sage-soft:rgba(95,181,146,.16);
  --rose:#dd7a90; --rose-soft:rgba(221,122,144,.14);
  /* dark surfaces already pass; brighter ink for text accents */
  --honey-ink:#f0a847; --sage-ink:#7fcaa6;
  --shadow:0 18px 50px rgba(0,0,0,.45); --shadow-lg:0 30px 80px rgba(0,0,0,.55);
  color-scheme:dark;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{margin:0;padding:0}
html{ font-size:clamp(15px,.4vw + 14px,17px); scroll-behavior:smooth }
/* All site styling lives under .hc-site so nothing leaks into the host shell. */
.hc-site{
  background:var(--dawn); color:var(--ink); font-family:var(--sans);
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
  min-height:100vh; line-height:1.6; overflow-x:hidden; position:relative;
  transition:background-color .35s var(--ease), color .35s var(--ease);
}
.hc-bg{position:fixed; inset:0; z-index:-1; pointer-events:none;
  background:
    radial-gradient(40vmax 40vmax at 88% -8%, var(--honey-soft), transparent 60%),
    radial-gradient(46vmax 46vmax at -6% 8%, var(--sage-soft), transparent 60%),
    linear-gradient(180deg,var(--dawn),var(--dawn-2));
}
.hc-bg::after{content:""; position:absolute; inset:0; opacity:.5;
  background-image:radial-gradient(currentColor .8px, transparent .9px);
  color:var(--line-soft); background-size:34px 34px; mask-image:linear-gradient(180deg,#000,transparent 70%);}
a{color:inherit}
img{display:block; max-width:100%}
::selection{background:var(--honey-soft); color:var(--ink)}
:focus-visible{outline:2.5px solid var(--ink); outline-offset:2px; border-radius:6px; box-shadow:0 0 0 5px var(--honey-soft)}

/* top bar */
.hc-top{position:sticky; top:0; z-index:50; display:flex; align-items:center; gap:1rem;
  padding:.7rem clamp(1rem,4vw,2.4rem); backdrop-filter:blur(14px) saturate(1.2);
  background:color-mix(in srgb,var(--dawn) 78%, transparent); border-bottom:1px solid var(--line-soft);}
.hc-brand{display:flex; align-items:center; gap:.6rem; font-family:var(--serif); font-weight:600;
  font-size:1.06rem; letter-spacing:-.01em; color:var(--ink); text-decoration:none; white-space:nowrap;}
.hc-brand .mark{display:grid; place-items:center; width:1.85rem; height:1.85rem; color:var(--honey);}
.hc-brand .mark svg{width:100%; height:100%; fill:none; stroke:currentColor; stroke-width:1.4}
.hc-brand b{font-weight:600}
.hc-brand .sub{color:var(--ink-faint); font-weight:500; font-family:var(--sans); font-size:.72rem;
  letter-spacing:.16em; text-transform:uppercase; padding-left:.7rem; margin-left:.2rem; border-left:1px solid var(--line);}
.hc-top .spacer{flex:1}
.hc-nav{display:flex; align-items:center; gap:.3rem}
.hc-nav a{font-size:.86rem; color:var(--ink-soft); text-decoration:none; padding:.4rem .7rem; border-radius:var(--radius-pill);
  transition:color .15s var(--ease), background .15s var(--ease)}
.hc-nav a:hover{color:var(--ink); background:var(--surface-hover)}
.hc-give{display:inline-flex; align-items:center; gap:.4rem; font-size:.86rem; font-weight:600; text-decoration:none;
  padding:.46rem .95rem; border-radius:var(--radius-pill); color:#fff; background:linear-gradient(135deg,#a35f12,#7c4910);
  box-shadow:0 6px 18px rgba(180,106,22,.28); transition:transform .15s var(--ease), box-shadow .15s var(--ease)}
.hc-give:hover{transform:translateY(-1px); box-shadow:0 10px 24px rgba(180,106,22,.36)}
.hc-give .ic svg{width:1em;height:1em;fill:none;stroke:currentColor;stroke-width:1.8}
.theme-toggle{display:inline-grid; place-items:center; width:2.2rem; height:2.2rem; border:1px solid var(--line);
  border-radius:var(--radius-pill); background:var(--surface); color:var(--ink-soft); cursor:pointer;
  transition:color .15s var(--ease), border-color .15s var(--ease), background .15s var(--ease)}
.theme-toggle:hover{color:var(--ink); border-color:var(--line-strong); background:var(--surface-hover)}
.theme-toggle svg{width:1.1rem; height:1.1rem; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round}
.theme-toggle .sun{display:none} .theme-toggle .moon{display:block}
[data-theme="dark"] .theme-toggle .sun{display:block} [data-theme="dark"] .theme-toggle .moon{display:none}

/* generic icon styling */
.ic svg,.ic-lg svg{fill:none; stroke:currentColor; stroke-linecap:round; stroke-linejoin:round}
.ic{display:inline-grid; place-items:center; width:1em; height:1em}
.ic svg{width:100%; height:100%; stroke-width:1.6}

/* hero */
.hc-hero{position:relative; isolation:isolate; min-height:clamp(26rem,62vh,40rem); display:flex; align-items:flex-end;
  padding:clamp(1.4rem,4vw,3rem); overflow:hidden}
.hc-hero .photo{position:absolute; inset:0; z-index:-2; background-size:cover; background-position:center;
  transform:scale(1.05); animation:heroDrift 32s var(--ease) infinite alternate}
@keyframes heroDrift{from{transform:scale(1.05)} to{transform:scale(1.12)}}
.hc-hero::after{content:""; position:absolute; inset:0; z-index:-1;
  background:linear-gradient(180deg, rgba(20,12,6,.10) 0%, rgba(20,12,6,.42) 52%, rgba(18,10,4,.82) 100%),
             radial-gradient(80% 60% at 18% 110%, rgba(180,106,22,.42), transparent 60%);}
.hc-hero .inner{position:relative; width:min(var(--maxw),100%); margin:0 auto; color:var(--hero-ink)}
.hc-crumbs{display:flex; flex-wrap:wrap; align-items:center; gap:.35rem; font-size:.78rem; letter-spacing:.04em;
  color:var(--hero-ink); margin-bottom:1.1rem; text-shadow:0 1px 8px rgba(0,0,0,.6)}
.hc-crumbs a{color:inherit; text-decoration:none; opacity:.92} .hc-crumbs a:hover{opacity:1; text-decoration:underline}
.hc-crumbs .sep{opacity:.6}
.hc-kicker{display:inline-flex; align-items:center; gap:.5rem; font-size:.8rem; font-weight:600; letter-spacing:.14em;
  text-transform:uppercase; color:var(--hero-ink); background:rgba(20,12,6,.5); border:1px solid rgba(255,255,255,.28);
  padding:.36rem .8rem; border-radius:var(--radius-pill); backdrop-filter:blur(6px); margin-bottom:1rem; text-shadow:0 1px 6px rgba(0,0,0,.5)}
.hc-kicker .ic{color:#ffd9a3}
.hc-hero h1{font-family:var(--serif); font-weight:560; font-size:clamp(2.1rem,5.6vw,4rem); line-height:1.02;
  letter-spacing:-.018em; max-width:18ch; text-wrap:balance; text-shadow:0 2px 30px rgba(0,0,0,.35)}
.hc-hero .lede{margin-top:1.1rem; max-width:46rem; font-size:clamp(1.05rem,1.5vw,1.3rem); line-height:1.55;
  color:var(--hero-ink); text-shadow:0 1px 14px rgba(0,0,0,.4)}
.hc-ctas{display:flex; flex-wrap:wrap; gap:.7rem; margin-top:1.6rem}
.btn{display:inline-flex; align-items:center; gap:.5rem; font-weight:600; font-size:.95rem; text-decoration:none;
  padding:.7rem 1.25rem; border-radius:var(--radius-pill); transition:transform .15s var(--ease), box-shadow .15s var(--ease), background .15s var(--ease), color .15s var(--ease)}
.btn .ic svg{width:1.05em; height:1.05em; stroke-width:1.8}
.btn-primary{color:#fff; background:linear-gradient(135deg,#a35f12,#7c4910); box-shadow:0 10px 26px rgba(180,106,22,.4)}
.btn-primary:hover{transform:translateY(-2px); box-shadow:0 16px 34px rgba(180,106,22,.5)}
.btn-ghost{color:var(--hero-ink); background:rgba(255,255,255,.10); border:1px solid rgba(255,255,255,.34); backdrop-filter:blur(6px)}
.btn-ghost:hover{background:rgba(255,255,255,.20); transform:translateY(-2px)}

/* body / sections */
main{display:block}
.wrap{width:min(var(--maxw),100%); margin:0 auto; padding:0 clamp(1rem,4vw,2.4rem)}
section.band{padding:clamp(2.6rem,6vw,5rem) 0}
section.band.tight{padding:clamp(1.8rem,4vw,3rem) 0}
.sec-head{max-width:46rem; margin-bottom:1.8rem}
.sec-eyebrow{display:inline-flex; align-items:center; gap:.5rem; font-size:.78rem; font-weight:600; letter-spacing:.14em;
  text-transform:uppercase; color:var(--honey-ink); margin-bottom:.7rem}
.sec-eyebrow .ic{color:var(--honey)}
.sec-head h2{font-family:var(--serif); font-weight:540; font-size:clamp(1.6rem,3.4vw,2.5rem); line-height:1.1;
  letter-spacing:-.015em; color:var(--ink); text-wrap:balance}
/* an eyebrow promoted to a heading keeps the small uppercase eyebrow look */
.sec-head h2.sec-eyebrow{font-family:var(--sans); font-weight:600; font-size:.78rem; line-height:1.4;
  letter-spacing:.14em; text-transform:uppercase; color:var(--honey-ink); margin-bottom:.7rem}
.sec-head p{margin-top:.85rem; color:var(--ink-soft); font-size:1.08rem; line-height:1.6}
.prose p{color:var(--ink-soft); font-size:1.1rem; line-height:1.7; max-width:42rem; margin-top:1rem}
.prose p:first-child{margin-top:0}
.prose strong{color:var(--ink); font-weight:650}
.lead{font-size:1.22rem!important; color:var(--ink)!important; line-height:1.6}

/* cards grid */
.grid{display:grid; gap:1.1rem; grid-template-columns:repeat(auto-fit,minmax(16.5rem,1fr))}
.grid.two{grid-template-columns:repeat(auto-fit,minmax(20rem,1fr))}
.card{display:flex; flex-direction:column; background:var(--surface); border:1px solid var(--line);
  border-radius:var(--radius); overflow:hidden; box-shadow:var(--shadow); text-decoration:none; color:inherit;
  transition:transform .2s var(--ease), border-color .2s var(--ease), box-shadow .2s var(--ease)}
a.card:hover{transform:translateY(-4px); border-color:var(--line-strong); box-shadow:var(--shadow-lg)}
.card .thumb{aspect-ratio:16/10; background-size:cover; background-position:center; position:relative}
.card .thumb::after{content:""; position:absolute; inset:0; background:linear-gradient(180deg,transparent 50%,rgba(20,12,6,.28))}
.card .body{padding:1.15rem 1.25rem 1.3rem; display:flex; flex-direction:column; gap:.5rem; flex:1}
.card .tag{align-self:flex-start; font-size:.72rem; font-weight:600; letter-spacing:.08em; text-transform:uppercase;
  color:var(--sage-ink); background:var(--sage-soft); padding:.2rem .6rem; border-radius:var(--radius-pill)}
.card h3{display:flex; align-items:center; gap:.55rem; font-family:var(--serif); font-weight:580; font-size:1.22rem;
  letter-spacing:-.01em; color:var(--ink)}
.card h3 .ic{color:var(--honey); flex:none; font-size:1.05em}
.card p{color:var(--ink-soft); font-size:.96rem; line-height:1.55}
.card .more{margin-top:auto; padding-top:.6rem; display:inline-flex; align-items:center; gap:.4rem;
  font-size:.85rem; font-weight:600; color:var(--honey-ink)}
.card .more .ic svg{width:1em;height:1em;stroke-width:2}
a.card:hover .more .ic{transform:translateX(3px); transition:transform .2s var(--ease)}

/* feature rows */
.feature{display:grid; grid-template-columns:1fr 1fr; gap:clamp(1.4rem,4vw,3.4rem); align-items:center; margin-top:2.4rem}
.feature:first-child{margin-top:0}
.feature.reverse .media{order:2}
.feature .media{border-radius:var(--radius-lg); overflow:hidden; box-shadow:var(--shadow-lg); aspect-ratio:5/4;
  background-size:cover; background-position:center}
.feature .text h3,.feature .text h2{font-family:var(--serif); font-weight:560; font-size:clamp(1.4rem,2.6vw,2rem); line-height:1.12;
  letter-spacing:-.01em; color:var(--ink)}
.feature .text p{margin-top:.9rem; color:var(--ink-soft); font-size:1.06rem; line-height:1.65}
.feature .text .more{margin-top:1rem; display:inline-flex; align-items:center; gap:.45rem; font-weight:600; color:var(--honey-ink); text-decoration:none}
.feature .text .more:hover{gap:.7rem}
.feature .text .more .ic svg{width:1em;height:1em;stroke-width:2}

/* steps (the purse flow) */
.steps{display:grid; gap:1rem; grid-template-columns:repeat(auto-fit,minmax(15rem,1fr)); counter-reset:step}
.step{position:relative; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius);
  padding:1.4rem 1.3rem; box-shadow:var(--shadow)}
.step .n{display:grid; place-items:center; width:2.3rem; height:2.3rem; border-radius:var(--radius-pill);
  font-family:var(--serif); font-weight:600; color:#fff; background:linear-gradient(135deg,var(--sage),#2f7d61); margin-bottom:.8rem}
.step h3{font-family:var(--serif); font-weight:560; font-size:1.18rem; color:var(--ink); margin-bottom:.4rem}
.step p{color:var(--ink-soft); font-size:.97rem; line-height:1.55}

/* stats */
.stats{display:grid; gap:1rem; grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))}
.stat{background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); padding:1.4rem 1.3rem; box-shadow:var(--shadow)}
.stat .v{font-family:var(--serif); font-weight:600; font-size:clamp(1.8rem,4vw,2.6rem); line-height:1; color:var(--honey-deep)}
.stat .l{margin-top:.5rem; color:var(--ink-soft); font-size:.95rem; line-height:1.4}

/* chips */
.chips{display:flex; flex-wrap:wrap; gap:.55rem}
.chip{display:inline-flex; align-items:center; gap:.45rem; font-size:.9rem; font-weight:550; text-decoration:none;
  color:var(--ink-soft); background:var(--surface); border:1px solid var(--line); padding:.45rem .9rem; border-radius:var(--radius-pill);
  transition:border-color .15s var(--ease), color .15s var(--ease), background .15s var(--ease)}
a.chip:hover{color:var(--ink); border-color:var(--line-strong); background:var(--surface-hover)}
.chip .ic{color:var(--honey)} .chip .ic svg{width:1em;height:1em}

/* pull quote */
.quote{max-width:50rem; margin-inline:auto; text-align:center}
.quote blockquote{font-family:var(--serif); font-weight:480; font-style:italic; font-size:clamp(1.4rem,3.2vw,2.1rem);
  line-height:1.32; letter-spacing:-.01em; color:var(--ink); text-wrap:balance}
.quote blockquote::before{content:"\\201C"; color:var(--honey); font-size:1.2em; line-height:0; vertical-align:-.3em; margin-right:.05em}
.quote .cite{margin-top:1.1rem; color:var(--ink-faint); font-size:.92rem; letter-spacing:.04em}

/* callout band */
.callout{position:relative; overflow:hidden; border-radius:var(--radius-lg); padding:clamp(1.8rem,4vw,3rem);
  background:linear-gradient(135deg, color-mix(in srgb,var(--honey) 16%, var(--surface)), color-mix(in srgb,var(--sage) 12%, var(--surface)));
  border:1px solid var(--line); box-shadow:var(--shadow-lg)}
.callout h2{font-family:var(--serif); font-weight:560; font-size:clamp(1.5rem,3.2vw,2.3rem); color:var(--ink); max-width:24ch; text-wrap:balance}
.callout p{margin-top:.8rem; color:var(--ink-soft); font-size:1.08rem; max-width:42rem; line-height:1.6}
.callout .hc-ctas{margin-top:1.5rem}
.callout .btn-ghost{color:var(--ink); background:var(--surface); border-color:var(--line-strong)}
.callout .btn-ghost:hover{background:var(--surface-hover)}

/* divider */
.rule{height:1px; background:var(--line-soft); border:0}

/* footer */
.hc-foot{border-top:1px solid var(--line-soft); margin-top:1rem; padding:clamp(2rem,5vw,3.4rem) 0 3rem}
.hc-foot .cols{display:grid; gap:1.6rem; grid-template-columns:1.4fr 1fr 1fr}
.hc-foot .brand-col p{color:var(--ink-soft); font-size:.95rem; line-height:1.6; margin-top:.7rem; max-width:30rem}
.hc-foot h4{font-size:.78rem; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-faint); margin-bottom:.8rem}
.hc-foot ul{list-style:none; display:flex; flex-direction:column; gap:.5rem}
.hc-foot a{color:var(--ink-soft); text-decoration:none; font-size:.95rem} .hc-foot a:hover{color:var(--ink)}
.hc-foot .land{margin-top:2rem; padding-top:1.4rem; border-top:1px solid var(--line-soft); color:var(--ink-faint);
  font-size:.86rem; line-height:1.6; max-width:54rem}
.hc-foot .legal{margin-top:1.2rem; color:var(--ink-faint); font-size:.8rem; display:flex; flex-wrap:wrap; gap:.4rem 1rem; align-items:center}

@media (max-width:820px){
  .feature{grid-template-columns:1fr} .feature.reverse .media{order:0}
  .hc-foot .cols{grid-template-columns:1fr 1fr} .hc-foot .brand-col{grid-column:1/-1}
  /* nav drops to a full-width second row rather than disappearing */
  .hc-top{flex-wrap:wrap; row-gap:.2rem}
  .hc-brand .sub{display:none}
  .hc-give span{display:none} .hc-give{padding:.5rem}
  .hc-nav{order:5; flex-basis:100%; justify-content:center; flex-wrap:wrap; gap:.1rem;
    padding-top:.45rem; margin-top:.1rem; border-top:1px solid var(--line-soft)}
}
@media (max-width:520px){ .hc-foot .cols{grid-template-columns:1fr} }
@media (prefers-reduced-motion:reduce){ *{animation:none!important; transition:none!important; scroll-behavior:auto!important} }
`

// ─── theme scripts ──────────────────────────────────────────────────
const PAINT = `(function(){try{var t=localStorage.getItem('hc:humanity:theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`
const TOGGLE = `(function(){var b=document.getElementById('themeToggle');if(!b)return;function cur(){var t=document.documentElement.getAttribute('data-theme');if(t==='light'||t==='dark')return t;return matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}b.addEventListener('click',function(){var n=cur()==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',n);try{localStorage.setItem('hc:humanity:theme',n);}catch(e){}});})();`

// ════════════════════════════════════════════════════════════════════
// RENDER
// ════════════════════════════════════════════════════════════════════
function makeRefs(mode) {
  const imgUrl = (ref) => {
    const sig = sigFor(ref)
    if (!sig) return ''
    return mode === 'app' ? `resource:${sig}` : `assets/${sig.slice(0, 16)}.webp`
  }
  // target: array of segments (incl 'humanity-centres') OR an external/mailto string OR null
  const linkUrl = (target) => {
    if (target == null) return null
    if (typeof target === 'string') return target // external / mailto / #anchor
    if (mode === 'app') return '/' + target.join('/')
    return slugOf(target) + '.html'
  }
  return { imgUrl, linkUrl, mode }
}

function bg(ref, refs) {
  const u = refs.imgUrl(ref)
  return u ? `style="background-image:url('${u}')"` : ''
}

function renderCrumbs(segments, refs, labels) {
  // segments includes 'humanity-centres' at [0]; build trail of ancestors + self (self not linked)
  const parts = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments.slice(0, i + 1)
    const label = labels[seg.join('/')] || titleCase(segments[i])
    if (i === segments.length - 1) {
      parts.push(`<span aria-current="page">${esc(label)}</span>`)
    } else {
      parts.push(`<a href="${refs.linkUrl(seg)}">${esc(label)}</a>`)
      parts.push(`<span class="sep">›</span>`)
    }
  }
  return `<nav class="hc-crumbs" aria-label="Breadcrumb">${parts.join('')}</nav>`
}

function titleCase(s) {
  return String(s).split(/[-_\s]/).map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ')
}

function renderCtas(ctas, refs, ghostClass = 'btn-ghost') {
  if (!ctas || !ctas.length) return ''
  return `<div class="hc-ctas">${ctas.map(c => {
    const href = refs.linkUrl(c.href) ?? '#'
    const external = typeof c.href === 'string' && /^(https?:|mailto:)/i.test(c.href)
    const cls = c.kind === 'primary' ? 'btn btn-primary' : `btn ${ghostClass}`
    const ic = c.icon ? icon(c.icon) : ''
    const attr = external ? ' target="_blank" rel="noopener"' : ''
    return `<a class="${cls}" href="${href}"${attr}>${ic}<span>${esc(c.label)}</span></a>`
  }).join('')}</div>`
}

// Build a section head. When a block has an eyebrow but NO heading, the
// eyebrow is promoted to a real <h2> so the document never jumps h1→h3
// (the .sec-head h2.sec-eyebrow rule keeps it visually small/uppercase).
function secHead(b, defaultIcon) {
  const parts = []
  if (b.eyebrow) {
    const tag = b.heading ? 'div' : 'h2'
    parts.push(`<${tag} class="sec-eyebrow">${icon(b.icon || defaultIcon)}${esc(b.eyebrow)}</${tag}>`)
  }
  if (b.heading) parts.push(`<h2>${esc(b.heading)}</h2>`)
  if (b.intro) parts.push(`<p>${rich(b.intro)}</p>`)
  return parts.length ? `<div class="sec-head">${parts.join('')}</div>` : ''
}

function renderBlock(b, refs) {
  switch (b.type) {
    case 'prose': {
      const head = secHead(b, 'spark')
      const paras = (b.paras || []).map((p, i) => `<p${i === 0 && b.lead ? ' class="lead"' : ''}>${rich(p)}</p>`).join('')
      return `<section class="band${b.tight ? ' tight' : ''}"><div class="wrap">${head}<div class="prose">${paras}</div></div></section>`
    }
    case 'cards': {
      const head = secHead(b, 'spark')
      const cards = (b.cards || []).map(c => {
        const href = c.href != null ? refs.linkUrl(c.href) : null
        const external = typeof c.href === 'string' && /^(https?:|mailto:)/i.test(c.href)
        const attr = external ? ' target="_blank" rel="noopener"' : ''
        const thumb = c.img ? `<div class="thumb" ${bg(c.img, refs)}></div>` : ''
        const tag = c.tag ? `<span class="tag">${esc(c.tag)}</span>` : ''
        const ic = c.icon ? icon(c.icon) : ''
        // Linked cards get the "more" affordance and hover-lift; informational
        // cards render as a static <div> (no dead anchors, better a11y).
        const more = (href && c.more !== false) ? `<span class="more">${esc(c.moreLabel || 'Explore')} ${icon('arrow')}</span>` : ''
        const inner = `${thumb}<div class="body">${tag}<h3>${ic}<span>${esc(c.title)}</span></h3><p>${rich(c.blurb)}</p>${more}</div>`
        return href
          ? `<a class="card" href="${href}"${attr}>${inner}</a>`
          : `<div class="card static">${inner}</div>`
      }).join('')
      return `<section class="band${b.tight ? ' tight' : ''}"><div class="wrap">${head}<div class="grid${b.two ? ' two' : ''}">${cards}</div></div></section>`
    }
    case 'features': {
      const head = secHead(b, 'spark')
      // Headingless feature block: its row titles ARE the section headings (h2);
      // under a block heading they're h3.
      const rowTag = b.heading ? 'h3' : 'h2'
      const rows = (b.items || []).map((it, i) => {
        const reverse = it.reverse ?? (i % 2 === 1)
        const more = it.href ? `<a class="more" href="${refs.linkUrl(it.href)}"${typeof it.href === 'string' && /^https?:/i.test(it.href) ? ' target="_blank" rel="noopener"' : ''}>${esc(it.moreLabel || 'Read more')} ${icon('arrow')}</a>` : ''
        return `<div class="feature${reverse ? ' reverse' : ''}"><div class="media" ${bg(it.img, refs)}></div><div class="text"><${rowTag}>${esc(it.title)}</${rowTag}>${rich(it.body) ? `<p>${rich(it.body)}</p>` : ''}${more}</div></div>`
      }).join('')
      return `<section class="band"><div class="wrap">${head}${rows}</div></section>`
    }
    case 'steps': {
      const head = secHead(b, 'flow')
      const steps = (b.steps || []).map((s, i) => `<div class="step"><div class="n">${i + 1}</div><h3>${esc(s.title)}</h3><p>${rich(s.body)}</p></div>`).join('')
      return `<section class="band"><div class="wrap">${head}<div class="steps">${steps}</div></div></section>`
    }
    case 'stats': {
      const head = secHead(b, 'spark')
      const stats = (b.stats || []).map(s => `<div class="stat"><div class="v">${esc(s.value)}</div><div class="l">${rich(s.label)}</div></div>`).join('')
      return `<section class="band tight"><div class="wrap">${head}<div class="stats">${stats}</div></div></section>`
    }
    case 'chips': {
      const head = secHead(b, 'pin')
      const chips = (b.chips || []).map(c => {
        const href = c.href ? refs.linkUrl(c.href) : null
        const ic = c.icon ? icon(c.icon) : icon('pin')
        return href ? `<a class="chip" href="${href}">${ic}${esc(c.label)}</a>` : `<span class="chip">${ic}${esc(c.label)}</span>`
      }).join('')
      return `<section class="band tight"><div class="wrap">${head}<div class="chips">${chips}</div></div></section>`
    }
    case 'quote': {
      return `<section class="band"><div class="wrap"><div class="quote"><blockquote>${rich(b.text)}</blockquote>${b.cite ? `<div class="cite">${esc(b.cite)}</div>` : ''}</div></div></section>`
    }
    case 'callout': {
      return `<section class="band"><div class="wrap"><div class="callout"><h2>${esc(b.heading)}</h2>${b.body ? `<p>${rich(b.body)}</p>` : ''}${renderCtas(b.ctas, refs)}</div></div></section>`
    }
    case 'rule':
      return `<div class="wrap"><hr class="rule"></div>`
    default:
      return ''
  }
}

function renderFooter(refs, labels) {
  const link = (target, label) => `<a href="${refs.linkUrl(target)}">${esc(label)}</a>`
  return `<footer class="hc-foot"><div class="wrap"><div class="cols">
    <div class="brand-col">
      <a class="hc-brand" href="${refs.linkUrl(['humanity-centres'])}"><span class="mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor">${ICONS.hex}${ICONS.circle}</svg></span><span><b>Humanity Centres</b></span></a>
      <p>Places to practise being human, together — retreat centres, neighbourhood houses, and storefronts where relating well is something we learn side by side.</p>
    </div>
    <div><h4>Explore</h4><ul>
      <li>${link(['humanity-centres','programs'],'Programs')}</li>
      <li>${link(['humanity-centres','places'],'Places')}</li>
      <li>${link(['humanity-centres','participants'],'Who comes')}</li>
      <li>${link(['humanity-centres','practitioners'],'Practitioners')}</li>
    </ul></div>
    <div><h4>Take part</h4><ul>
      <li>${link(['humanity-centres','purse'],'The Purse')}</li>
      <li><a href="mailto:hello@humanitycentres.org?subject=Giving%20to%20Humanity%20Centres">Give</a></li>
      <li>${link(['humanity-centres','places','types'],'Host a centre')}</li>
      <li><a href="mailto:hello@humanitycentres.org">Contact</a></li>
    </ul></div>
  </div>
  <p class="land">Humanity Centres in British Columbia gather on the traditional, ancestral, and unceded territories of the Coast Salish peoples — including the Snuneymuxw (Nanaimo); the Semiahmoo, Katzie, and Kwantlen (Surrey); and the Musqueam, Squamish, and Tsleil-Waututh (Vancouver / South False Creek) — who have cared for these lands since time immemorial. We hold these relationships with gratitude and responsibility, as the first relationship we tend.</p>
  <div class="legal"><span>© Humanity Centres — a not-for-profit in formation.</span><span>·</span><span>Kindred to the field of Relational Intelligence.</span></div>
  </div></footer>`
}

function renderPage(page, mode, labels) {
  const refs = makeRefs(mode)
  const headLink = mode === 'app'
    ? `<link rel="stylesheet" href="${CHROME_REF}">`
    : `<link rel="stylesheet" href="chrome.css">`
  // Request the variable axes so the intermediate weights (540/560/580) resolve.
  const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..600&family=Inter:wght@400..600&display=swap">`
  const crumbs = page.segments.length > 1 ? renderCrumbs(page.segments, refs, labels) : ''
  const kicker = page.kicker ? `<div class="hc-kicker">${icon(page.kickerIcon || 'leaf')}${esc(page.kicker)}</div>` : ''
  const body = (page.sections || []).map(b => renderBlock(b, refs)).join('\n')
  const give = `<a class="hc-give" href="${refs.linkUrl(['humanity-centres','purse'])}" aria-label="Support — the Purse">${icon('heart')}<span>Support</span></a>`
  // Word-boundary meta description (no mid-word truncation).
  const descRaw = String(page.lede || '').replace(/<[^>]+>/g, '').trim()
  const desc = descRaw.length <= 160 ? descRaw : (() => { const c = descRaw.slice(0, 157); const sp = c.lastIndexOf(' '); return (sp > 120 ? c.slice(0, sp) : c) + '…' })()
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(page.title)} — Humanity Centres</title>
<meta name="description" content="${esc(desc)}">
<script>${PAINT}</script>
${fonts}
${headLink}
</head>
<body>
<div class="hc-site">
<div class="hc-bg" aria-hidden="true"></div>
<header class="hc-top">
  <a class="hc-brand" href="${refs.linkUrl(['humanity-centres'])}">
    <span class="mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor">${ICONS.hex}${ICONS.circle}</svg></span>
    <span><b>Humanity Centres</b></span><span class="sub">be human, together</span>
  </a>
  <span class="spacer"></span>
  <nav class="hc-nav" aria-label="Primary">
    <a href="${refs.linkUrl(['humanity-centres','programs'])}">Programs</a>
    <a href="${refs.linkUrl(['humanity-centres','places'])}">Places</a>
    <a href="${refs.linkUrl(['humanity-centres','participants'])}">Who comes</a>
    <a href="${refs.linkUrl(['humanity-centres','practitioners'])}">Practitioners</a>
  </nav>
  ${give}
  <button type="button" class="theme-toggle" id="themeToggle" aria-label="Toggle light or dark theme">
    <svg class="moon" viewBox="0 0 24 24">${ICONS.moon}</svg>
    <svg class="sun" viewBox="0 0 24 24">${ICONS.sun}</svg>
  </button>
</header>
<main>
  <section class="hc-hero">
    <div class="photo" ${bg(page.hero, refs)}></div>
    <div class="inner">
      ${crumbs}
      ${kicker}
      <h1>${esc(page.title)}</h1>
      ${page.lede ? `<p class="lede">${rich(page.lede)}</p>` : ''}
      ${renderCtas(page.ctas, refs)}
    </div>
  </section>
  ${body}
</main>
${renderFooter(refs, labels)}
</div>
<script>${TOGGLE}</script>
</body>
</html>`
}

// CHROME_REF is injected by the stamper after it mints chrome.css as a
// resource (app mode). Placeholder for preview mode.
let CHROME_REF = 'chrome.css'
function setChromeRef(ref) { CHROME_REF = ref }

// ════════════════════════════════════════════════════════════════════
// CSS SCOPING
// The page is mounted INLINE in the host app document (no iframe/shadow),
// and the chrome stylesheet is hoisted into the live <head>. To stop any
// rule leaking into the Hypercomb shell, every selector is prefixed with
// `.hc-site` (the wrapper renderPage emits) — except the rem anchor
// (`html`/`body`) and the CSS-variable carriers (`:root`/`[data-theme]`),
// and except at-rule preludes / @keyframes / @font-face bodies.
// ════════════════════════════════════════════════════════════════════
function scopeCss(css, scope) {
  let out = ''
  let i = 0
  const n = css.length
  const readBlock = () => { // css[i] === '{' → return inner, advance past matching '}'
    let depth = 0
    const start = i
    for (; i < n; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') { depth--; if (depth === 0) { i++; return css.slice(start + 1, i - 1) } }
    }
    return css.slice(start + 1)
  }
  while (i < n) {
    let j = i
    while (j < n && css[j] !== '{' && css[j] !== '}') j++
    if (j >= n) { out += css.slice(i); break }
    if (css[j] === '}') { out += css.slice(i, j + 1); i = j + 1; continue }
    const prelude = css.slice(i, j).trim()
    i = j
    const inner = readBlock()
    if (prelude.startsWith('@')) {
      const at = prelude.split(/[\s(]/)[0].toLowerCase()
      if (at === '@media' || at === '@supports') out += prelude + '{' + scopeCss(inner, scope) + '}'
      else out += prelude + '{' + inner + '}' // @keyframes/@font-face/@page — leave inner
    } else {
      const sels = prelude.split(',').map(s => scopeSelector(s.trim(), scope)).filter(Boolean).join(',')
      out += sels + '{' + inner + '}'
    }
  }
  return out
}
function scopeSelector(sel, scope) {
  if (!sel) return ''
  if (/^(html\b|body\b|:root\b|\[data-theme)/.test(sel)) return sel // rem anchor + var carriers
  if (sel === scope || sel.startsWith(scope + ' ') || sel.startsWith(scope + '.') || sel.startsWith(scope + ':')) return sel
  return scope + ' ' + sel
}

const SCOPED_CSS = scopeCss(CSS, '.hc-site')

module.exports = { CSS: SCOPED_CSS, renderPage, setChromeRef, sigFor, slugOf, titleCase, MANIFEST }
