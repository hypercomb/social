// Build the Revolución ecosystem WEBSITE — one standalone HTML page per major
// cell of the /revolucion tree (built by intel-build-revolucion.ts), attached
// as `visual:website:page` decorations via the Claude bridge.
//
// Per website-build skill:
//   - chrome.css minted ONCE (put-resource), threaded into every page as
//     <link rel="stylesheet" href="resource:<sig>/chrome.css">
//   - one page = put-resource (htmlSig) + decoration-add (replaceKind:true,
//     mark:'persistent', payload { htmlSig, icon, label, order, createdAt })
//   - segments passed VERBATIM (all lowercase-hyphen — created normalized)
//   - verify by read-back: layer-at → decorations → get-resource → kind+htmlSig
//   - in-app links are ABSOLUTE segment paths (/revolucion/journal)
//
// Self-contained aesthetics: system serif stack, inline SVG (flavor wheel is
// computed below from the real flavor-data.ts taxonomy), CSS only — no
// external fonts, images, or scripts, so pages render offline and mesh-share.
//
// Idempotent: decoration-add with replaceKind replaces prior pages; identical
// content returns unchanged:true. Safe to re-run after editing page copy.

import WebSocket from 'ws'

const BRIDGE_PORT = 2401
const TIMEOUT = 60_000
let counter = 0
type BridgeRes = { id: string; ok: boolean; data?: any; error?: string }

function sendOnce(request: Record<string, unknown>): Promise<BridgeRes> {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `site-${Date.now()}-${++counter}` }
    const ws = new WebSocket(`ws://localhost:${BRIDGE_PORT}`)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, TIMEOUT)
    ws.on('open', () => ws.send(JSON.stringify(msg)))
    ws.on('message', (raw: unknown) => {
      clearTimeout(timer)
      try { resolve(JSON.parse(String(raw)) as BridgeRes) } catch { reject(new Error('invalid response')) }
      ws.close()
    })
    ws.on('error', (err: Error) => { clearTimeout(timer); reject(new Error(`bridge connection failed: ${err.message}`)) })
  })
}
async function send(request: Record<string, unknown>): Promise<BridgeRes> {
  const res = await sendOnce(request)
  if (!res.ok && res.error === 'no renderer connected') {
    await new Promise(r => setTimeout(r, 4000))
    return sendOnce(request)
  }
  return res
}

// ─── palette ─────────────────────────────────────────────────────────
// Cigar lounge at dusk: espresso blacks, warm cream, and the existing tile's
// gold (#c8975a) as the brand accent.

const CHROME_CSS = /* css */ `
:root{
  --night:#141017; --coal:#1b1520; --smoke:#241c2b;
  --cream:#f0e6d6; --cream-dim:#c9bba6; --faint:#8d7f6f;
  --gold:#c8975a; --gold-bright:#e0b578; --ember:#b3542f;
  --hairline:rgba(200,151,90,.22);
  --serif:Georgia,'Palatino Linotype',Palatino,'Times New Roman',serif;
}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{background:var(--night);color:var(--cream);font-family:var(--serif);
  font-size:17px;line-height:1.75;-webkit-font-smoothing:antialiased;
  background-image:radial-gradient(1200px 700px at 85% -10%,rgba(200,151,90,.07),transparent 60%),
                   radial-gradient(900px 600px at -10% 110%,rgba(179,84,47,.05),transparent 55%)}
a{color:var(--gold-bright);text-decoration:none}
a:hover{color:var(--cream)}
::selection{background:var(--gold);color:var(--night)}

/* ── chrome ── */
.nav{position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:1.6rem;
  padding:.9rem 5vw;background:rgba(20,16,23,.92);backdrop-filter:blur(8px);
  border-bottom:1px solid var(--hairline)}
.nav .wordmark{font-size:1.05rem;letter-spacing:.34em;color:var(--gold);white-space:nowrap}
.nav .wordmark em{font-style:normal;color:var(--cream-dim)}
.nav .links{margin-left:auto;display:flex;flex-wrap:wrap;gap:1.15rem;font-size:.78rem;
  letter-spacing:.16em;text-transform:uppercase}
.nav .links a{color:var(--cream-dim)}
.nav .links a:hover,.nav .links a.here{color:var(--gold-bright)}
.footer{margin-top:6rem;padding:3rem 5vw 3.4rem;border-top:1px solid var(--hairline);
  display:flex;flex-wrap:wrap;gap:2.5rem;justify-content:space-between;align-items:flex-start}
.footer .mark{letter-spacing:.34em;color:var(--gold);font-size:.9rem}
.footer .creed{max-width:34rem;color:var(--faint);font-style:italic;font-size:.95rem}
.footer nav{display:grid;grid-template-columns:repeat(2,minmax(9rem,1fr));gap:.35rem 2rem;
  font-size:.78rem;letter-spacing:.14em;text-transform:uppercase}
.footer nav a{color:var(--cream-dim)}

/* ── type & layout ── */
.wrap{max-width:1060px;margin:0 auto;padding:0 5vw}
.kicker{font-size:.74rem;letter-spacing:.42em;text-transform:uppercase;color:var(--gold)}
h1{font-size:clamp(2.5rem,6vw,4.4rem);line-height:1.08;font-weight:400;margin:.9rem 0 1.3rem}
h1 i{font-style:italic;color:var(--gold-bright)}
h2{font-size:clamp(1.6rem,3.4vw,2.3rem);font-weight:400;line-height:1.2;margin-bottom:.9rem}
h3{font-size:1.12rem;font-weight:400;color:var(--gold-bright);margin-bottom:.45rem}
.lede{font-size:clamp(1.05rem,2vw,1.28rem);color:var(--cream-dim);max-width:42rem}
.hero{padding:16vh 0 11vh;position:relative;overflow:hidden}
.section{padding:4.6rem 0 1rem}
.section .rule{display:flex;align-items:center;gap:1rem;margin-bottom:2.4rem}
.section .rule::after{content:'';flex:1;height:1px;background:var(--hairline)}
.muted{color:var(--faint)}
.center{text-align:center}

/* ── components ── */
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1.1rem;margin:1.8rem 0}
.card{background:linear-gradient(160deg,var(--coal),var(--smoke));border:1px solid var(--hairline);
  border-radius:4px;padding:1.5rem 1.4rem;position:relative}
.card p{font-size:.95rem;color:var(--cream-dim)}
.card .thumb{width:58px;height:58px;float:right;margin:-.15rem 0 .5rem .85rem;border:1px solid var(--hairline)}
.card .num{position:absolute;top:1.1rem;right:1.2rem;font-size:.72rem;letter-spacing:.2em;color:var(--faint)}
.card.link:hover{border-color:var(--gold)}
a.card{display:block;color:inherit}
.chips{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.8rem}
.chip{border:1px solid var(--hairline);border-radius:999px;padding:.22rem .85rem;
  font-size:.82rem;letter-spacing:.06em;color:var(--cream-dim);background:rgba(200,151,90,.05)}
.chip.lit{border-color:var(--gold);color:var(--gold-bright);background:rgba(200,151,90,.12)}
.btns{display:flex;flex-wrap:wrap;gap:1rem;margin-top:2.2rem}
.btn{display:inline-block;padding:.78rem 1.9rem;border:1px solid var(--gold);color:var(--gold-bright);
  letter-spacing:.18em;text-transform:uppercase;font-size:.78rem;border-radius:2px}
.btn:hover{background:var(--gold);color:var(--night)}
.btn.ghost{border-color:var(--hairline);color:var(--cream-dim)}
.btn.ghost:hover{background:transparent;border-color:var(--gold);color:var(--gold-bright)}
blockquote{border-left:2px solid var(--gold);padding:.4rem 0 .4rem 1.6rem;margin:2.2rem 0;
  font-size:clamp(1.15rem,2.4vw,1.5rem);font-style:italic;color:var(--cream)}
blockquote cite{display:block;margin-top:.7rem;font-style:normal;font-size:.78rem;
  letter-spacing:.22em;text-transform:uppercase;color:var(--faint)}
.spoken{background:var(--coal);border:1px solid var(--hairline);border-radius:6px;
  padding:1.8rem 2rem;font-size:1.18rem;font-style:italic;line-height:2.1}
.spoken b{font-style:normal;font-weight:400;color:var(--gold-bright);
  border-bottom:1px dotted var(--gold);padding-bottom:1px}
.flow{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;margin:2rem 0;font-size:.9rem}
.flow span{border:1px solid var(--hairline);border-radius:3px;padding:.5rem 1rem;
  background:var(--coal);letter-spacing:.05em}
.flow i{color:var(--gold);font-style:normal}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;
  background:var(--hairline);border:1px solid var(--hairline);margin:2rem 0}
.facts div{background:var(--night);padding:1.4rem 1.2rem;text-align:center}
.facts .n{display:block;font-size:2.1rem;color:var(--gold-bright);line-height:1.15}
.facts .t{font-size:.72rem;letter-spacing:.22em;text-transform:uppercase;color:var(--faint)}
.manifesto p{font-size:clamp(1.3rem,3vw,1.9rem);line-height:1.5;margin:2.6rem 0;color:var(--cream)}
.manifesto p b{font-weight:400;color:var(--gold-bright)}
.privacy{border:1px solid var(--gold);border-radius:4px;padding:1.6rem 1.8rem;margin:2.6rem 0;
  background:rgba(200,151,90,.06)}
.wheel-wrap{display:flex;justify-content:center;margin:2.4rem 0}
.wheel-wrap svg{width:min(640px,92vw);height:auto}
.dot{display:inline-block;width:.62rem;height:.62rem;border-radius:50%;margin-right:.5rem;
  vertical-align:baseline}

/* ── artwork (sig-addressed hive art) ── */
.heroart{float:right;width:min(300px,36vw);margin:.3rem 0 1.2rem 2rem}
.heroart img{display:block;width:100%;aspect-ratio:1;object-fit:cover;border:1px solid var(--gold);
  outline:1px solid var(--hairline);outline-offset:7px;background:var(--coal)}
.heroart figcaption{margin-top:.85rem;font-size:.68rem;letter-spacing:.26em;text-transform:uppercase;
  color:var(--faint);text-align:center}
.artstrip{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:1.1rem;margin:2.4rem 0}
.artstrip figure{margin:0;border:1px solid var(--hairline);background:var(--coal);padding:.55rem}
.artstrip img{display:block;width:100%;aspect-ratio:1;object-fit:cover;border:1px solid var(--hairline)}
.artstrip figcaption{padding:.6rem .2rem .15rem;font-size:.68rem;letter-spacing:.24em;
  text-transform:uppercase;color:var(--cream-dim);text-align:center}
.hexgallery{display:flex;flex-wrap:wrap;gap:1.3rem 1.6rem;justify-content:center;margin:2.4rem 0}
.hexgallery a,.hexgallery .cell{display:block;text-align:center;color:var(--cream-dim);font-size:.8rem;
  letter-spacing:.14em;text-transform:uppercase}
.hexgallery .hexwrap{display:block;width:168px;clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);
  background:linear-gradient(160deg,var(--gold-bright),#6e4d28);padding:2px;margin:0 auto .7rem}
.hexgallery img{display:block;width:100%;aspect-ratio:.866;object-fit:cover;
  clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)}
.hexgallery a:hover img{filter:brightness(1.14)}
.hexgallery a:hover{color:var(--gold-bright)}
@media(max-width:700px){.nav .links{display:none}.hero{padding:11vh 0 8vh}
  .heroart{float:none;width:100%;max-width:340px;margin:0 auto 1.6rem}}
`

// ─── shared page scaffold ────────────────────────────────────────────

const NAV_LINKS: Array<[string, string]> = [
  ['/revolucion/journal', 'Journal'],
  ['/revolucion/experience', 'Experience'],
  ['/revolucion/flavor-wheel', 'Flavor Wheel'],
  ['/revolucion/lounge', 'Lounge'],
  ['/revolucion/discovery', 'Discovery'],
  ['/revolucion/community', 'Community'],
  ['/revolucion/insights', 'Makers'],
  ['/revolucion/mission', 'Manifesto'],
]
const FOOT_LINKS: Array<[string, string]> = [
  ['/revolucion', 'Home'],
  ['/revolucion/journal', 'The Journal'],
  ['/revolucion/experience', 'The Experience'],
  ['/revolucion/cigars', 'The Catalog'],
  ['/revolucion/flavor-wheel', 'The Flavor Wheel'],
  ['/revolucion/discovery', 'Discovery'],
  ['/revolucion/community', 'The Circle'],
  ['/revolucion/insights', 'For the Makers'],
  ['/revolucion/collaborations', 'Named Experiences'],
  ['/revolucion/humidor', 'The Humidor'],
  ['/revolucion/lounge', 'The Cigar Lounge'],
  ['/revolucion/mission', 'The Manifesto'],
]

function page(chromeSig: string, route: string, title: string, body: string): string {
  const nav = NAV_LINKS.map(([href, label]) =>
    `<a href="${href}"${href === route ? ' class="here"' : ''}>${label}</a>`).join('\n      ')
  const foot = FOOT_LINKS.map(([href, label]) => `<a href="${href}">${label}</a>`).join('\n        ')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Revolución</title>
<link rel="stylesheet" href="resource:${chromeSig}/chrome.css">
</head>
<body>
  <header class="nav">
    <a class="wordmark" href="/revolucion">REVOLUCIÓN<em> · STYLE</em></a>
    <nav class="links">
      ${nav}
    </nav>
  </header>
${body}
  <footer class="footer">
    <div>
      <div class="mark">REVOLUCIÓN</div>
      <p class="creed">We do not sell cigars. We curate meaningful experiences —
      and the journal is the foundation that grows the mission.</p>
    </div>
    <nav>
        ${foot}
    </nav>
  </footer>
</body>
</html>`
}

// ─── flavor wheel SVG (computed from the real taxonomy) ──────────────

type Fam = { label: string; color: string; dark?: boolean; flavors: string[] }
const FAMILIES: Fam[] = [
  { label: 'Earth', color: '#5C3D2E', flavors: ['Soil', 'Leather', 'Mineral', 'Moss', 'Mushroom', 'Peat'] },
  { label: 'Wood', color: '#8B6914', flavors: ['Cedar', 'Oak', 'Hickory', 'Mesquite', 'Charred Wood', 'Sandalwood'] },
  { label: 'Spice', color: '#C0392B', flavors: ['Black Pepper', 'White Pepper', 'Red Pepper', 'Cinnamon', 'Clove', 'Nutmeg', 'Anise'] },
  { label: 'Sweet', color: '#D4A017', dark: true, flavors: ['Caramel', 'Honey', 'Vanilla', 'Molasses', 'Maple', 'Brown Sugar'] },
  { label: 'Coffee & Chocolate', color: '#4E2E1E', flavors: ['Espresso', 'Black Coffee', 'Dark Chocolate', 'Cocoa', 'Mocha', 'Roasted Bean'] },
  { label: 'Cream & Bread', color: '#F5DEB3', dark: true, flavors: ['Butter', 'Cream', 'Toast', 'Biscuit', 'Brioche', 'Malt'] },
  { label: 'Nut', color: '#8B7355', flavors: ['Almond', 'Walnut', 'Cashew', 'Chestnut', 'Hazelnut', 'Peanut', 'Pistachio'] },
  { label: 'Fruit', color: '#E67E22', dark: true, flavors: ['Citrus', 'Dried Fruit', 'Berry', 'Fig', 'Stone Fruit', 'Raisin', 'Prune'] },
  { label: 'Herbal & Floral', color: '#27AE60', dark: true, flavors: ['Grass', 'Hay', 'Tea', 'Lavender', 'Jasmine', 'Mint'] },
  { label: 'Smoke & Char', color: '#2C3E50', flavors: ['Campfire', 'Tobacco', 'Ash', 'Burnt Caramel', 'Charcoal', 'Incense'] },
]

function wheelSvg(): string {
  const C = 360, R = 330, r = 196
  const polar = (radius: number, deg: number): [number, number] => {
    const a = (deg - 90) * Math.PI / 180
    return [C + radius * Math.cos(a), C + radius * Math.sin(a)]
  }
  const seg = 360 / FAMILIES.length
  const parts: string[] = []
  FAMILIES.forEach((f, i) => {
    const a0 = i * seg + 1.2, a1 = (i + 1) * seg - 1.2
    const [x0, y0] = polar(R, a0), [x1, y1] = polar(R, a1)
    const [x2, y2] = polar(r, a1), [x3, y3] = polar(r, a0)
    parts.push(`<path d="M${x0.toFixed(1)},${y0.toFixed(1)} A${R},${R} 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)} A${r},${r} 0 0 0 ${x3.toFixed(1)},${y3.toFixed(1)} Z" fill="${f.color}" opacity="0.92"/>`)
    // label along the slice midline, split on two lines when long
    const mid = (a0 + a1) / 2
    const [lx, ly] = polar((R + r) / 2, mid)
    const fill = f.dark ? '#1b1520' : '#f0e6d6'
    const words = f.label.split(' & ')
    if (words.length === 2) {
      parts.push(`<text x="${lx.toFixed(1)}" y="${(ly - 8).toFixed(1)}" text-anchor="middle" font-size="19" fill="${fill}" font-family="Georgia,serif">${words[0]} &amp;</text>`)
      parts.push(`<text x="${lx.toFixed(1)}" y="${(ly + 14).toFixed(1)}" text-anchor="middle" font-size="19" fill="${fill}" font-family="Georgia,serif">${words[1]}</text>`)
    } else {
      parts.push(`<text x="${lx.toFixed(1)}" y="${(ly + 6).toFixed(1)}" text-anchor="middle" font-size="20" fill="${fill}" font-family="Georgia,serif">${f.label}</text>`)
    }
  })
  const total = FAMILIES.reduce((n, f) => n + f.flavors.length, 0)
  return `<svg viewBox="0 0 720 720" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Revolución flavor wheel — ten families, ${total} flavors">
  <circle cx="${C}" cy="${C}" r="${R + 14}" fill="none" stroke="rgba(200,151,90,.25)" stroke-width="1"/>
  ${parts.join('\n  ')}
  <circle cx="${C}" cy="${C}" r="${r - 22}" fill="none" stroke="rgba(200,151,90,.35)" stroke-width="1"/>
  <text x="${C}" y="${C - 26}" text-anchor="middle" font-size="15" letter-spacing="6" fill="#c8975a" font-family="Georgia,serif">REVOLUCIÓN</text>
  <text x="${C}" y="${C + 14}" text-anchor="middle" font-size="30" font-style="italic" fill="#f0e6d6" font-family="Georgia,serif">the flavor wheel</text>
  <text x="${C}" y="${C + 48}" text-anchor="middle" font-size="14" fill="#8d7f6f" font-family="Georgia,serif">ten families · ${total} flavors</text>
</svg>`
}

const familyCards = FAMILIES.map(f => `
    <div class="card">
      <h3><span class="dot" style="background:${f.color}"></span>${f.label}</h3>
      <p>${f.flavors.join(' · ')}</p>
    </div>`).join('')

// ─── pages ───────────────────────────────────────────────────────────

function buildPages(chromeSig: string, art: Record<string, string | undefined> = {}): Array<{ segments: string[]; label: string; html: string }> {
  const P = (route: string, title: string, body: string) => page(chromeSig, route, title, body)
  // sig-addressed tile art from the hive itself — SiteViewDrone rewrites
  // resource:<sig> to /@resource/<sig>, and the decoration closure carries it
  const thumb = (key: string) => art[key] ? `<img class="thumb" src="resource:${art[key]}/art.png" alt="">` : ''
  const heroArt = (key: string, caption: string) => art[key]
    ? `<figure class="heroart"><img src="resource:${art[key]}/art.png" alt=""><figcaption>${caption}</figcaption></figure>` : ''
  const stripArt = (key: string, caption: string) => art[key]
    ? `<figure><img src="resource:${art[key]}/art.png" alt=""><figcaption>${caption}</figcaption></figure>` : ''
  const hexCell = (key: string, label: string, href?: string) => art[key]
    ? (href
      ? `<a href="${href}"><span class="hexwrap"><img src="resource:${art[key]}/art.png" alt=""></span>${label}</a>`
      : `<span class="cell"><span class="hexwrap"><img src="resource:${art[key]}/art.png" alt=""></span>${label}</span>`)
    : ''

  const home = P('/revolucion', 'The moment is the product', `
  <main class="wrap">
    <section class="hero">
      <p class="kicker">revolución style · an experience ecosystem</p>
      <h1>The moment is<br>the <i>product</i>.</h1>
      <p class="lede">A cigar is an hour of your one life. We built an ecosystem that honors
      it — a journal that listens, a shared vocabulary that connects people, and insight
      that flows back to the hands that roll the leaf.</p>
      <div class="btns">
        <a class="btn" href="/revolucion/journal">Open the journal</a>
        <a class="btn ghost" href="/revolucion/mission">Read the manifesto</a>
      </div>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">inside the hive</p></div>
      <div class="artstrip">
        ${stripArt('lounge', 'the lounge')}
        ${stripArt('cigars', 'the catalog')}
        ${stripArt('journal', 'the journal')}
        ${stripArt('humidor', 'the humidor')}
      </div>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">the loop</p></div>
      <h2>Everything feeds everything.</h2>
      <div class="flow">
        <span>journal a moment</span><i>→</i>
        <span>a vocabulary emerges</span><i>→</i>
        <span>discovery &amp; community</span><i>→</i>
        <span>anonymized insight for makers</span><i>→</i>
        <span>experience-named blends</span><i>→</i>
        <span>richer moments to journal</span>
      </div>
      <p class="muted">One circle, no exit ramps to anywhere shallow. Every entry makes the
      recommendations truer, the vocabulary richer, and the next blend better.</p>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">the ecosystem</p></div>
      <div class="cards">
        <a class="card link" href="/revolucion/journal"><span class="num">01</span>${thumb('journal')}<h3>The Journal</h3>
          <p>The entry point. Press speak, tell it like it was, and watch the moment assemble itself.</p></a>
        <a class="card link" href="/revolucion/experience"><span class="num">02</span>${thumb('experience')}<h3>The Experience</h3>
          <p>Forty-one spoken keywords — weather, time, setting, company, mood, drink — each one a tile.</p></a>
        <a class="card link" href="/revolucion/cigars"><span class="num">03</span>${thumb('cigars')}<h3>The Catalog</h3>
          <p>Brands, vitolas, wrappers, origins, strength. The community writes it by smoking.</p></a>
        <a class="card link" href="/revolucion/flavor-wheel"><span class="num">04</span>${thumb('flavor-wheel')}<h3>The Flavor Wheel</h3>
          <p>Ten families, sixty-three flavors — one shared tasting language. Tap it.</p></a>
        <a class="card link" href="/revolucion/lounge"><span class="num">05</span>${thumb('lounge')}<h3>The Cigar Lounge</h3>
          <p>Your corner of the ecosystem. Dress the room; hang your own things soon.</p></a>
        <a class="card link" href="/revolucion/discovery"><span class="num">06</span>${thumb('discovery')}<h3>Discovery</h3>
          <p>Ask for a moment, not a medium-bodied Nicaraguan. Recommendations grown from journals.</p></a>
        <a class="card link" href="/revolucion/community"><span class="num">07</span>${thumb('community')}<h3>The Circle</h3>
          <p>Shared moments, spoken vocabulary, herf nights — and a gentle first light for newcomers.</p></a>
        <a class="card link" href="/revolucion/insights"><span class="num">08</span>${thumb('insights')}<h3>For the Makers</h3>
          <p>Anonymized, aggregated truth for the people who blend, roll, and ship the leaf.</p></a>
        <a class="card link" href="/revolucion/collaborations"><span class="num">09</span>${thumb('collaborations')}<h3>Named Experiences</h3>
          <p>Conversation. Reflection. Celebration. Blends named for what they create.</p></a>
        <a class="card link" href="/revolucion/humidor"><span class="num">10</span>${thumb('humidor')}<h3>The Humidor</h3>
          <p>What you hold, what you hunt, and what rests in the dark getting better.</p></a>
      </div>
    </section>

    <section class="section center">
      <blockquote>"I'm in the mood for a <i>reflection</i> experience."
        <cite>— how people will ask, once the vocabulary is theirs</cite></blockquote>
    </section>
  </main>`)

  const journal = P('/revolucion/journal', 'The Journal', `
  <style>
    /* ── the parchment scroll ── the journal page IS a journal: an unrolled
       scroll on the lounge table. Ink replaces gold; the scene hangs as a
       tipped-in plate; a wax seal closes the entry. */
    .scrollpage{padding-top:2.6rem;padding-bottom:1.2rem}
    .curl{position:relative;z-index:2;height:40px;border-radius:20px;
      width:calc(100% + 32px);margin-left:-16px;
      background:linear-gradient(180deg,#8a6a3e,#e9d6a8 26%,#f4e6c2 40%,#cfae76 72%,#6e4f2a);
      box-shadow:0 10px 18px rgba(0,0,0,.55)}
    .curl::before,.curl::after{content:'';position:absolute;top:50%;transform:translateY(-50%);
      width:40px;height:40px;border-radius:50%;
      background:radial-gradient(circle,#4a3218 0 3px,#c9a76a 3px 7px,#7a5a30 7px 10px,#e9d6a8 10px 14px,#6e4f2a 14px 17px,#3a2814 17px)}
    .curl::before{left:0}.curl::after{right:0}
    .sheet{position:relative;margin:-20px 0;padding:4.2rem clamp(1.5rem,5.5vw,5rem) 4.6rem;
      color:#3b2a18;
      background:
        radial-gradient(1100px 520px at 18% 6%,rgba(122,84,40,.10),transparent 60%),
        radial-gradient(860px 480px at 84% 34%,rgba(122,84,40,.08),transparent 55%),
        radial-gradient(940px 640px at 46% 96%,rgba(100,66,30,.13),transparent 60%),
        linear-gradient(180deg,#efe2bf,#e8d6ac 42%,#e1cc9c);
      box-shadow:inset 0 0 110px rgba(94,60,24,.30),inset 0 0 16px rgba(94,60,24,.22),0 22px 44px rgba(0,0,0,.5)}
    /* ink overrides — everything on the sheet reads as pen on paper */
    .sheet .kicker{color:#8c3a1c}
    .sheet h1,.sheet h2{color:#2c1e0f}
    .sheet h1 i{color:#8c3a1c}
    .sheet h3{color:#7a4720}
    .sheet .lede{color:#52402a}
    .sheet .lede::first-letter{float:left;font-size:3.1em;line-height:.85;padding:.04em .09em 0 0;
      font-style:italic;color:#8c3a1c}
    .sheet .muted{color:#6d5738}
    .sheet a{color:#8c3a1c;border-bottom:1px solid rgba(140,58,28,.35)}
    .sheet a:hover{color:#5e2712;border-bottom-color:#5e2712}
    .sheet .rule::after{background:rgba(59,42,24,.28)}
    .sheet ::selection{background:#8c3a1c;color:#efe2bf}
    .sheet .card{background:rgba(255,249,232,.5);border:1px solid rgba(92,61,46,.32);
      box-shadow:0 1px 3px rgba(59,42,24,.18)}
    .sheet .card p{color:#52402a}
    .sheet .card .thumb{border-color:rgba(92,61,46,.4)}
    .sheet .spoken{background:rgba(255,250,236,.55);border:1px solid rgba(92,61,46,.3);color:#3b2a18}
    .sheet .spoken b{color:#8c3a1c;border-bottom:1px dotted rgba(140,58,28,.7)}
    .sheet .heroart img{border-color:#5c3d2e;outline-color:rgba(92,61,46,.35);background:#f2e7cc}
    .sheet .heroart figcaption{color:#6d5738}
    /* the golden-hour scene, mounted like a plate in an old journal */
    .scenewrap{border:12px solid #f6eed9;outline:1px solid rgba(92,61,46,.45);background:#150d15;
      box-shadow:0 6px 18px rgba(59,42,24,.4);margin:.6rem 0 0}
    .scenewrap svg{display:block;width:100%;height:auto}
    .scenecap{font-size:.74rem;letter-spacing:.22em;text-transform:uppercase;color:#6d5738;
      padding:.85rem 1.1rem .1rem;display:flex;flex-wrap:wrap;gap:.4rem 1.4rem;justify-content:center}
    .scenecap i{font-style:normal;color:#8c3a1c}
    .fic{width:54px;height:54px;float:right;margin:-.2rem 0 .55rem .9rem}
    .beam{margin:.6rem 0 1.4rem}
    .beam svg{display:block;width:100%;height:auto}
    .sealrow{display:flex;flex-direction:column;align-items:center;gap:.9rem;margin:4rem 0 .5rem;text-align:center}
    .sealrow svg{width:112px;height:auto;filter:drop-shadow(0 3px 5px rgba(59,42,24,.4))}
    .sealrow p{font-size:.72rem;letter-spacing:.34em;text-transform:uppercase;color:#6d5738}
    @media (prefers-reduced-motion: no-preference){
      .j-smoke{animation:jdrift 8s ease-in-out infinite}
      .j-hex{animation:jbob 7s ease-in-out infinite}
      .j-hex.h2{animation-delay:-2.4s}
      .j-hex.h3{animation-delay:-4.6s}
      .j-fly{animation:jfly 5.2s ease-in-out infinite}
      .j-fly.f2{animation-delay:-1.8s}
      .j-fly.f3{animation-delay:-3.4s}
      .j-bulb{animation:jglow 6s ease-in-out infinite}
      .j-bulb.b2{animation-delay:-3s}
    }
    @keyframes jdrift{0%,100%{transform:translateY(0);opacity:.55}50%{transform:translateY(-7px);opacity:.85}}
    @keyframes jbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}
    @keyframes jfly{0%,100%{opacity:.12}50%{opacity:.95}}
    @keyframes jglow{0%,100%{opacity:.55}50%{opacity:1}}
  </style>
  <main class="wrap scrollpage" style="max-width:1220px">
    <div class="curl" aria-hidden="true"></div>
    <div class="sheet">
    <section class="hero" style="padding:1.6rem 0 1.2rem">
      <p class="kicker">the journal · the entry point</p>
      <h1>Tell it like it <i>was</i>.</h1>
      <p class="lede">Not a form. A moment, captured as experience tiles — the cigar, what you
      tasted, what you drank, where you were, who you were with, and how it felt.</p>
    </section>

    <div class="scenewrap"><svg viewBox="0 0 1200 560" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A golden-hour patio: an open journal on the table, a cigar resting, and the words of the moment rising as tiles">
      <defs>
        <linearGradient id="jsky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#231a2b"/><stop offset="42%" stop-color="#46283a"/>
          <stop offset="74%" stop-color="#8a4630"/><stop offset="100%" stop-color="#c67a3e"/>
        </linearGradient>
        <radialGradient id="jsun" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="rgba(245,200,122,.95)"/><stop offset="45%" stop-color="rgba(230,150,80,.4)"/>
          <stop offset="100%" stop-color="rgba(230,150,80,0)"/>
        </radialGradient>
        <radialGradient id="jlamp" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="rgba(242,196,126,.5)"/><stop offset="100%" stop-color="rgba(242,196,126,0)"/>
        </radialGradient>
        <linearGradient id="jdeck" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2c1b13"/><stop offset="100%" stop-color="#150c0a"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="400" fill="url(#jsky)"/>
      <circle cx="300" cy="330" r="175" fill="url(#jsun)"/>
      <circle cx="300" cy="330" r="40" fill="#f2c47e"/>
      <ellipse cx="430" cy="296" rx="180" ry="9" fill="rgba(240,196,140,.14)"/>
      <ellipse cx="220" cy="256" rx="130" ry="7" fill="rgba(240,196,140,.10)"/>
      <ellipse cx="700" cy="220" rx="150" ry="8" fill="rgba(240,196,140,.07)"/>
      <path d="M905,150 q7,-8 14,0 M925,158 q6,-7 12,0 M885,166 q6,-7 12,0" stroke="#2a1b28" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path d="M0,336 Q200,308 420,330 T820,326 T1200,338 L1200,400 L0,400 Z" fill="#2c1a28"/>
      <path d="M0,362 Q260,338 520,356 T1040,352 L1200,360 L1200,400 L0,400 Z" fill="#221224"/>
      <path d="M0,34 Q300,108 620,66 T1200,54" fill="none" stroke="rgba(200,151,90,.45)" stroke-width="2"/>
      <path d="M420,0 Q700,92 1010,28" fill="none" stroke="rgba(200,151,90,.3)" stroke-width="1.6"/>
      <g class="j-bulb">
        <circle cx="110" cy="58" r="7" fill="rgba(242,196,126,.22)"/><circle cx="110" cy="58" r="3" fill="#f2c47e"/>
        <circle cx="420" cy="84" r="7" fill="rgba(242,196,126,.22)"/><circle cx="420" cy="84" r="3" fill="#f2c47e"/>
        <circle cx="760" cy="58" r="7" fill="rgba(242,196,126,.22)"/><circle cx="760" cy="58" r="3" fill="#f2c47e"/>
        <circle cx="1110" cy="56" r="7" fill="rgba(242,196,126,.22)"/><circle cx="1110" cy="56" r="3" fill="#f2c47e"/>
      </g>
      <g class="j-bulb b2">
        <circle cx="260" cy="88" r="7" fill="rgba(242,196,126,.22)"/><circle cx="260" cy="88" r="3" fill="#f2c47e"/>
        <circle cx="580" cy="68" r="7" fill="rgba(242,196,126,.22)"/><circle cx="580" cy="68" r="3" fill="#f2c47e"/>
        <circle cx="940" cy="60" r="7" fill="rgba(242,196,126,.22)"/><circle cx="940" cy="60" r="3" fill="#f2c47e"/>
        <circle cx="620" cy="56" r="6" fill="rgba(242,196,126,.2)"/><circle cx="620" cy="56" r="2.6" fill="#f2c47e"/>
        <circle cx="850" cy="66" r="6" fill="rgba(242,196,126,.2)"/><circle cx="850" cy="66" r="2.6" fill="#f2c47e"/>
      </g>
      <g fill="#190f16">
        <rect y="340" width="1200" height="8"/>
        <rect y="368" width="1200" height="5"/>
        <rect y="392" width="1200" height="6"/>
        <rect x="16" y="340" width="10" height="58"/><rect x="96" y="340" width="10" height="58"/>
        <rect x="176" y="340" width="10" height="58"/><rect x="256" y="340" width="10" height="58"/>
        <rect x="336" y="340" width="10" height="58"/><rect x="416" y="340" width="10" height="58"/>
        <rect x="496" y="340" width="10" height="58"/><rect x="576" y="340" width="10" height="58"/>
        <rect x="656" y="340" width="10" height="58"/><rect x="736" y="340" width="10" height="58"/>
        <rect x="816" y="340" width="10" height="58"/><rect x="896" y="340" width="10" height="58"/>
        <rect x="976" y="340" width="10" height="58"/><rect x="1056" y="340" width="10" height="58"/>
        <rect x="1136" y="340" width="10" height="58"/>
      </g>
      <rect y="398" width="1200" height="162" fill="url(#jdeck)"/>
      <g stroke="#0f0806" stroke-width="2">
        <line y1="428" x2="1200" y2="428"/><line y1="458" x2="1200" y2="458"/>
        <line y1="490" x2="1200" y2="490"/><line y1="524" x2="1200" y2="524"/>
        <line x1="180" y1="428" x2="180" y2="458"/><line x1="560" y1="458" x2="560" y2="490"/>
        <line x1="920" y1="428" x2="920" y2="458"/><line x1="360" y1="490" x2="360" y2="524"/>
        <line x1="1060" y1="490" x2="1060" y2="524"/>
      </g>
      <ellipse cx="470" cy="500" rx="120" ry="26" fill="rgba(242,196,126,.07)"/>
      <ellipse cx="470" cy="472" rx="95" ry="70" fill="url(#jlamp)"/>
      <g>
        <rect x="448" y="446" width="44" height="60" fill="#191019" stroke="#c8975a" stroke-width="2"/>
        <path d="M448,446 L470,432 L492,446" fill="none" stroke="#c8975a" stroke-width="2"/>
        <circle cx="470" cy="428" r="4" fill="none" stroke="#c8975a" stroke-width="2"/>
        <path d="M470,492 C464,482 466,474 470,466 C474,474 476,482 470,492 Z" fill="#f2c47e" class="j-bulb"/>
        <line x1="448" y1="476" x2="492" y2="476" stroke="rgba(200,151,90,.5)"/>
      </g>
      <g>
        <path d="M96,468 L164,468 L152,540 L108,540 Z" fill="#2c1a10" stroke="#c8975a"/>
        <line x1="100" y1="482" x2="160" y2="482" stroke="rgba(200,151,90,.45)"/>
        <g stroke="#3f7a4f" stroke-width="4" fill="none" stroke-linecap="round">
          <path d="M130,468 C128,430 112,412 96,394"/>
          <path d="M130,468 C134,424 152,410 168,390"/>
          <path d="M130,468 C130,432 130,410 128,392"/>
        </g>
        <ellipse cx="94" cy="392" rx="7" ry="14" fill="#3f7a4f" transform="rotate(-34 94 392)"/>
        <ellipse cx="170" cy="388" rx="7" ry="14" fill="#3f7a4f" transform="rotate(30 170 388)"/>
        <ellipse cx="127" cy="388" rx="7" ry="15" fill="#3f7a4f"/>
      </g>
      <g>
        <ellipse cx="780" cy="524" rx="64" ry="12" fill="#170d0a"/>
        <rect x="768" y="446" width="24" height="76" fill="#241309"/>
        <ellipse cx="780" cy="430" rx="205" ry="38" fill="#2c1a10" stroke="#c8975a" stroke-width="2"/>
        <ellipse cx="780" cy="422" rx="205" ry="38" fill="#3a2417" stroke="#c8975a" stroke-width="2"/>
      </g>
      <g transform="translate(688 402)">
        <path d="M0,10 C-20,-2 -66,-6 -92,3 L-92,44 C-66,35 -20,39 0,48 C20,39 66,35 92,44 L92,3 C66,-6 20,-2 0,10 Z" fill="#241309" stroke="#c8975a"/>
        <path d="M0,8 C-18,-2 -60,-6 -84,2 L-84,38 C-60,30 -18,34 0,42 Z" fill="#f0e6d6"/>
        <path d="M0,8 C18,-2 60,-6 84,2 L84,38 C60,30 18,34 0,42 Z" fill="#e4d6bd"/>
        <path d="M0,8 L0,42" stroke="#b9a98e"/>
        <g stroke="#b9a98e" stroke-width="1.4" fill="none" opacity=".8">
          <path d="M-72,10 C-52,6 -26,8 -10,12"/>
          <path d="M-72,18 C-52,14 -26,16 -10,20"/>
          <path d="M-72,26 C-56,22 -34,24 -10,28"/>
        </g>
        <g stroke="#8d7f6f" stroke-width="1.4" fill="none" opacity=".8">
          <path d="M12,12 C30,8 56,6 74,10"/>
          <path d="M12,20 C30,16 50,14 66,17"/>
        </g>
        <polygon points="30,26 38,21 46,26 46,35 38,40 30,35" fill="none" stroke="#c8975a" stroke-width="1.6"/>
        <rect x="46" y="34" width="52" height="6" rx="3" fill="#171017" stroke="#c8975a" stroke-width="1" transform="rotate(-8 46 34)"/>
      </g>
      <g>
        <rect x="856" y="382" width="34" height="36" fill="rgba(20,12,16,.4)" stroke="rgba(240,230,214,.8)" stroke-width="1.8"/>
        <rect x="858" y="399" width="30" height="17" fill="#b3542f" opacity=".9"/>
        <rect x="862" y="393" width="11" height="11" fill="none" stroke="rgba(240,230,214,.55)"/>
        <line x1="861" y1="386" x2="861" y2="414" stroke="rgba(240,230,214,.3)" stroke-width="2"/>
      </g>
      <g>
        <ellipse cx="930" cy="412" rx="28" ry="9" fill="#171017" stroke="#8d7f6f"/>
        <rect x="916" y="396" width="46" height="8" rx="4" fill="#5C3D2E" stroke="#3a2417" transform="rotate(-11 916 400)"/>
        <rect x="936" y="395" width="8" height="8" fill="#c8975a" transform="rotate(-11 936 399)"/>
        <circle cx="960" cy="392" r="3.6" fill="#ff9b52"/>
      </g>
      <g transform="translate(962 388)"><g class="j-smoke">
        <path d="M0,0 C-12,-26 10,-44 -4,-70 C-16,-92 6,-108 -2,-130" fill="none" stroke="rgba(224,181,120,.5)" stroke-width="3" stroke-linecap="round"/>
        <path d="M8,-6 C20,-30 -2,-50 12,-76" fill="none" stroke="rgba(224,181,120,.28)" stroke-width="2.5" stroke-linecap="round"/>
      </g></g>
      <g stroke="#9a7a58" stroke-width="3" fill="none" stroke-linecap="round">
        <path d="M1046,290 Q1044,352 1050,398"/>
        <path d="M1046,290 Q1082,282 1108,296"/>
        <path d="M1108,296 L1104,398"/>
        <path d="M1040,398 L1116,398"/>
        <path d="M1044,398 L1038,468"/><path d="M1112,398 L1120,468"/>
        <path d="M1050,344 L1106,344"/>
      </g>
      <rect x="1040" y="390" width="78" height="12" rx="5" fill="#7a3b2a" stroke="#9a7a58"/>
      <path d="M700,380 C640,330 560,300 520,240 C480,180 520,130 600,120" fill="none" stroke="rgba(200,151,90,.3)" stroke-width="1.6" stroke-dasharray="2 8"/>
      <g transform="translate(612 306)"><g class="j-hex">
        <polygon points="0,-30 26,-15 26,15 0,30 -26,15 -26,-15" fill="rgba(21,13,21,.88)" stroke="#c8975a" stroke-width="1.5"/>
        <text y="5" text-anchor="middle" font-size="13" fill="#f0e6d6" font-family="Georgia,serif">patio</text>
      </g></g>
      <g transform="translate(508 232)"><g class="j-hex h2">
        <polygon points="0,-36 31,-18 31,18 0,36 -31,18 -31,-18" fill="rgba(21,13,21,.88)" stroke="#c8975a" stroke-width="1.5"/>
        <text y="-2" text-anchor="middle" font-size="13" fill="#f0e6d6" font-family="Georgia,serif">golden</text>
        <text y="14" text-anchor="middle" font-size="13" fill="#f0e6d6" font-family="Georgia,serif">hour</text>
      </g></g>
      <g transform="translate(426 148)"><g class="j-hex h3">
        <polygon points="0,-30 26,-15 26,15 0,30 -26,15 -26,-15" fill="rgba(21,13,21,.88)" stroke="#c8975a" stroke-width="1.5"/>
        <text y="5" text-anchor="middle" font-size="13" fill="#f0e6d6" font-family="Georgia,serif">scotch</text>
      </g></g>
      <g transform="translate(566 110)"><g class="j-hex h2">
        <polygon points="0,-26 22.5,-13 22.5,13 0,26 -22.5,13 -22.5,-13" fill="rgba(21,13,21,.88)" stroke="#c8975a" stroke-width="1.5"/>
        <text y="5" text-anchor="middle" font-size="12" fill="#f0e6d6" font-family="Georgia,serif">cedar</text>
      </g></g>
      <g transform="translate(688 182)"><g class="j-hex h3">
        <polygon points="0,-36 31,-18 31,18 0,36 -31,18 -31,-18" fill="rgba(21,13,21,.88)" stroke="#c8975a" stroke-width="1.5"/>
        <text y="-2" text-anchor="middle" font-size="13" fill="#f0e6d6" font-family="Georgia,serif">close</text>
        <text y="14" text-anchor="middle" font-size="13" fill="#f0e6d6" font-family="Georgia,serif">friends</text>
      </g></g>
      <g transform="translate(782 96)"><g class="j-hex">
        <polygon points="0,-30 26,-15 26,15 0,30 -26,15 -26,-15" fill="rgba(21,13,21,.88)" stroke="#c8975a" stroke-width="1.5"/>
        <text y="-2" text-anchor="middle" font-size="12" fill="#f0e6d6" font-family="Georgia,serif">crisp</text>
        <text y="13" text-anchor="middle" font-size="12" fill="#f0e6d6" font-family="Georgia,serif">air</text>
      </g></g>
      <g transform="translate(876 170)"><g class="j-hex h2">
        <polygon points="0,-38 33,-19 33,19 0,38 -33,19 -33,-19" fill="rgba(21,13,21,.88)" stroke="#c8975a" stroke-width="1.5"/>
        <text y="-2" text-anchor="middle" font-size="13" fill="#f0e6d6" font-family="Georgia,serif">dark</text>
        <text y="14" text-anchor="middle" font-size="13" fill="#f0e6d6" font-family="Georgia,serif">chocolate</text>
      </g></g>
      <circle cx="220" cy="452" r="2" fill="#f2c47e" class="j-fly"/>
      <circle cx="356" cy="486" r="1.8" fill="#f2c47e" class="j-fly f2"/>
      <circle cx="1058" cy="446" r="2" fill="#f2c47e" class="j-fly f3"/>
      <circle cx="608" cy="520" r="1.8" fill="#f2c47e" class="j-fly f2"/>
      <circle cx="150" cy="380" r="1.6" fill="#f2c47e" class="j-fly f3"/>
    </svg></div>
    <p class="scenecap"><i>golden hour</i> · <i>patio</i> · <i>crisp air</i> · <i>close friends</i> · <i>scotch</i> — say it, and the scene assembles itself</p>

    <section class="section">
      <div class="rule"><p class="kicker">speak your moment</p></div>
      ${heroArt('journal/speak-your-moment', 'speak your moment — hive art')}
      <h2>Press speak. The scene builds itself.</h2>
      <p class="muted">A deterministic script — not AI — listens for grammar keywords and brings
      each element into the scene. Say "cloudy" and the clouds drift in. Say "scotch" and the
      glass arrives. Then adjust the tiles until it matches the evening you actually had.</p>
      <div class="spoken" style="margin-top:2rem">
        "<b>Golden hour</b> on the <b>patio</b>, <b>crisp air</b> coming in off the yard.
        <b>Close friends</b>, an open bottle of <b>scotch</b>, a maduro that tasted like
        <b>dark chocolate</b> and <b>cedar</b>. Nobody checked a phone. Pure
        <b>conversation</b>."
      </div>
      <p class="muted" style="margin-top:1.4rem">Nine keywords, nine tiles, one journal entry —
      before the ash got long. AI can help interpret the vague and the poetic later; the scene
      itself stays deterministic, crafted, and yours.</p>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">one entry, six facets</p></div>
      <div class="cards">
        <div class="card"><svg class="fic" viewBox="0 0 54 54"><rect x="5" y="24" width="36" height="10" rx="5" fill="#5C3D2E" stroke="#3a2814"/><rect x="24" y="24" width="7" height="10" fill="#c8975a"/><circle cx="45" cy="29" r="3.4" fill="#ff9b52"/><path d="M47,20 C43,15 49,11 45,5" fill="none" stroke="rgba(122,84,40,.55)" stroke-width="2" stroke-linecap="round"/></svg><h3>Cigar</h3><p>Brand, line, name, vitola, wrapper, origin, strength.</p></div>
        <div class="card"><svg class="fic" viewBox="0 0 54 54"><g transform="translate(27 27)"><circle r="18" fill="none" stroke="#5C3D2E" stroke-width="9"/><circle r="18" fill="none" stroke="#C0392B" stroke-width="9" stroke-dasharray="20 93"/><circle r="18" fill="none" stroke="#D4A017" stroke-width="9" stroke-dasharray="17 96" stroke-dashoffset="-26"/><circle r="18" fill="none" stroke="#27AE60" stroke-width="9" stroke-dasharray="15 98" stroke-dashoffset="-50"/><circle r="7" fill="#f6eed9" stroke="#5c3d2e"/></g></svg><h3>Flavors</h3><p>Tap what you tasted on the <a href="/revolucion/flavor-wheel">wheel</a>; slide the intensity.</p></div>
        <div class="card"><svg class="fic" viewBox="0 0 54 54"><path d="M27,10 l4.6,9.6 10.6,1.4 -7.8,7.4 2,10.6 -9.4,-5.2 -9.4,5.2 2,-10.6 -7.8,-7.4 10.6,-1.4 Z" fill="#b07a26"/><path d="M9,36 l2,4 4.4,.6 -3.2,3 .8,4.4 -4,-2.2 -4,2.2 .8,-4.4 -3.2,-3 4.4,-.6 Z" fill="none" stroke="#8c3a1c"/><path d="M45,36 l2,4 4.4,.6 -3.2,3 .8,4.4 -4,-2.2 -4,2.2 .8,-4.4 -3.2,-3 4.4,-.6 Z" fill="none" stroke="#8c3a1c"/></svg><h3>Ratings</h3><p>Draw, burn, construction, flavor, overall.</p></div>
        <div class="card"><svg class="fic" viewBox="0 0 54 54"><rect x="6" y="22" width="20" height="22" fill="none" stroke="#5c3d2e" stroke-width="2"/><rect x="7.5" y="33" width="17" height="9.5" fill="#b3542f"/><path d="M34,26 h14 v10 a7,7 0 0 1 -7,7 a7,7 0 0 1 -7,-7 Z" fill="none" stroke="#7a4720" stroke-width="2"/><path d="M48,28 h2 a3.5,3.5 0 0 1 0,7 h-2" fill="none" stroke="#7a4720" stroke-width="2"/><path d="M38,20 c-2,-3 2,-5 0,-8 M43,20 c-2,-3 2,-5 0,-8" stroke="rgba(122,84,40,.55)" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg><h3>Pairings</h3><p>Coffee, whiskey, rum, wine, beer, tea, food — what stood beside it.</p></div>
        <div class="card"><svg class="fic" viewBox="0 0 54 54"><path d="M4,14 Q27,30 50,14" fill="none" stroke="#7a4720" stroke-width="2"/><polygon points="10,18 20,20 12,30" fill="#C0392B"/><polygon points="22,22 32,22 27,33" fill="#D4A017"/><polygon points="34,20 44,18 42,29" fill="#27AE60"/><circle cx="27" cy="44" r="2" fill="#b07a26"/><circle cx="14" cy="40" r="1.6" fill="#b07a26"/><circle cx="40" cy="40" r="1.6" fill="#b07a26"/></svg><h3>Occasion</h3><p>The celebration, the quiet evening, the milestone.</p></div>
        <div class="card"><svg class="fic" viewBox="0 0 54 54"><rect x="6" y="16" width="42" height="28" rx="4" fill="none" stroke="#5c3d2e" stroke-width="2"/><path d="M18,16 L21,10 L33,10 L36,16" fill="none" stroke="#5c3d2e" stroke-width="2"/><circle cx="27" cy="30" r="9" fill="none" stroke="#5c3d2e" stroke-width="2"/><circle cx="27" cy="30" r="3.5" fill="#5c3d2e"/><circle cx="42" cy="22" r="1.8" fill="#8c3a1c"/></svg><h3>Photos</h3><p>The band, the ash, the view.</p></div>
      </div>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">what it becomes</p></div>
      <div class="beam"><svg viewBox="0 0 1200 120" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A timeline of journaled moments">
        <line x1="30" y1="58" x2="1170" y2="58" stroke="rgba(59,42,24,.35)" stroke-width="2"/>
        <circle cx="245" cy="58" r="2.5" fill="rgba(59,42,24,.45)"/>
        <circle cx="480" cy="58" r="2.5" fill="rgba(59,42,24,.45)"/>
        <circle cx="720" cy="58" r="2.5" fill="rgba(59,42,24,.45)"/>
        <circle cx="955" cy="58" r="2.5" fill="rgba(59,42,24,.45)"/>
        <g transform="translate(130 58)"><polygon points="0,-34 29.5,-17 29.5,17 0,34 -29.5,17 -29.5,-17" fill="#f6eed9" stroke="#5c3d2e" stroke-width="1.5"/><text y="4" text-anchor="middle" font-size="12" fill="#4a3721" font-family="Georgia,serif">reflection</text></g>
        <g transform="translate(360 58)"><polygon points="0,-34 29.5,-17 29.5,17 0,34 -29.5,17 -29.5,-17" fill="#f6eed9" stroke="#5c3d2e" stroke-width="1.5"/><text y="4" text-anchor="middle" font-size="11" fill="#4a3721" font-family="Georgia,serif">celebration</text></g>
        <g transform="translate(600 58)"><polygon points="0,-34 29.5,-17 29.5,17 0,34 -29.5,17 -29.5,-17" fill="#f6eed9" stroke="#8c3a1c" stroke-width="2"/><text y="4" text-anchor="middle" font-size="10.5" fill="#2c1e0f" font-family="Georgia,serif">conversation</text></g>
        <g transform="translate(840 58)"><polygon points="0,-34 29.5,-17 29.5,17 0,34 -29.5,17 -29.5,-17" fill="#f6eed9" stroke="#5c3d2e" stroke-width="1.5"/><text y="4" text-anchor="middle" font-size="12" fill="#4a3721" font-family="Georgia,serif">gratitude</text></g>
        <g transform="translate(1070 58)"><polygon points="0,-34 29.5,-17 29.5,17 0,34 -29.5,17 -29.5,-17" fill="#f6eed9" stroke="#5c3d2e" stroke-width="1.5"/><text y="4" text-anchor="middle" font-size="12" fill="#4a3721" font-family="Georgia,serif">focus</text></g>
        <text x="600" y="112" text-anchor="middle" font-size="13" fill="#6d5738" font-family="Georgia,serif" font-style="italic">your timeline of moments — every entry a scene you can revisit</text>
      </svg></div>
      <div class="cards">
        <div class="card">${thumb('journal/my-moments')}<h3>My Moments</h3><p>Your timeline of experiences — every entry a scene you can revisit.</p></div>
        <div class="card">${thumb('journal/favorites')}<h3>Favorites</h3><p>The moments and cigars you keep coming back to.</p></div>
        <div class="card">${thumb('journal/stats')}<h3>Stats</h3><p>Your patterns: most-tasted flavors, favorite pairings, when and where you smoke best.</p></div>
      </div>
      <p class="muted">And quietly, with your consent, every entry teaches
      <a href="/revolucion/discovery">discovery</a> what you love and shows
      <a href="/revolucion/insights">the makers</a> who they serve.</p>
    </section>

    <div class="sealrow">
      <svg viewBox="0 0 120 120" role="img" aria-label="A wax seal pressed with the Revolución hexagon">
        <path d="M60,8 C82,6 102,20 108,40 C114,60 112,84 96,98 C80,112 44,114 28,102 C12,90 6,66 12,44 C18,22 38,10 60,8 Z" fill="#7e2114"/>
        <path d="M60,14 C79,12 96,24 102,42 C107,59 105,80 92,92 C77,105 46,107 32,96 C18,85 13,64 18,46 C23,27 41,16 60,14 Z" fill="#93301c"/>
        <polygon points="60,30 84,44 84,72 60,86 36,72 36,44" fill="none" stroke="#c86a4a" stroke-width="2.5"/>
        <polygon points="60,40 75,49 75,67 60,76 45,67 45,49" fill="none" stroke="rgba(200,106,74,.55)" stroke-width="1.5"/>
        <text x="60" y="64" text-anchor="middle" font-size="17" font-style="italic" fill="#d8825e" font-family="Georgia,serif">R</text>
        <ellipse cx="46" cy="26" rx="14" ry="5" fill="rgba(255,255,255,.14)" transform="rotate(-18 46 26)"/>
      </svg>
      <p>journaled · sealed · yours</p>
    </div>
    </div>
    <div class="curl" aria-hidden="true"></div>
  </main>`)

  const experience = P('/revolucion/experience', 'The Experience', `
  <main class="wrap">
    <section class="hero">
      <p class="kicker">the experience · a spoken grammar</p>
      <h1>Say it, and it <i>appears</i>.</h1>
      <p class="lede">Forty-one keywords make up the language of moments. Each one is a tile
      with a predefined look and behavior — a crafted world, not an automated one.</p>
    </section>

    <div class="hexgallery">
      ${hexCell('experience/weather', 'weather')}
      ${hexCell('experience/time', 'time')}
      ${hexCell('experience/setting', 'setting')}
      ${hexCell('experience/company', 'company')}
      ${hexCell('experience/mood', 'mood')}
      ${hexCell('experience/drinks', 'drinks')}
    </div>

    <section class="section">
      <div class="rule"><p class="kicker">weather</p></div>
      <p class="muted">Say it and the sky changes.</p>
      <div class="chips"><span class="chip">sunny</span><span class="chip lit">cloudy</span><span class="chip">rain</span><span class="chip">breeze</span><span class="chip">crisp air</span><span class="chip">warm night</span></div>
    </section>
    <section class="section">
      <div class="rule"><p class="kicker">time</p></div>
      <div class="chips"><span class="chip">morning</span><span class="chip">afternoon</span><span class="chip lit">golden hour</span><span class="chip">evening</span><span class="chip">late night</span></div>
    </section>
    <section class="section">
      <div class="rule"><p class="kicker">setting</p></div>
      <div class="chips"><span class="chip lit">patio</span><span class="chip">lounge</span><span class="chip">garden</span><span class="chip">beach</span><span class="chip">fireside</span><span class="chip">cabin</span><span class="chip">golf course</span><span class="chip">rooftop</span></div>
    </section>
    <section class="section">
      <div class="rule"><p class="kicker">company</p></div>
      <div class="chips"><span class="chip">solo</span><span class="chip lit">close friends</span><span class="chip">family</span><span class="chip">new faces</span><span class="chip">celebration crowd</span></div>
    </section>
    <section class="section">
      <div class="rule"><p class="kicker">mood — the heart of the vocabulary</p></div>
      <p class="muted">These words become the names people ask for.</p>
      <div class="chips"><span class="chip lit">reflection</span><span class="chip lit">conversation</span><span class="chip lit">celebration</span><span class="chip">focus</span><span class="chip">unwind</span><span class="chip">gratitude</span><span class="chip">milestone</span></div>
    </section>
    <section class="section">
      <div class="rule"><p class="kicker">drinks</p></div>
      <p class="muted">Say "scotch" and the glass arrives in the scene.</p>
      <div class="chips"><span class="chip">coffee</span><span class="chip">espresso</span><span class="chip">whiskey</span><span class="chip lit">scotch</span><span class="chip">rum</span><span class="chip">wine</span><span class="chip">beer</span><span class="chip">tea</span><span class="chip">hot chocolate</span><span class="chip">water</span></div>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">why it matters</p></div>
      <h2>From taste to knowledge.</h2>
      <p class="lede" style="max-width:46rem">Over time the tiles build a knowledge graph. Not
      <span class="muted">"this person likes maduro"</span> — but "they like it on cool evenings,
      outdoors, with close friends and coffee." That is a richer truth than any star rating,
      and it belongs to the person who lived it.</p>
      <div class="btns"><a class="btn" href="/revolucion/discovery">See what it unlocks</a></div>
    </section>
  </main>`)

  const cigars = P('/revolucion/cigars', 'The Catalog', `
  <main class="wrap">
    <section class="hero">
      ${heroArt('cigars', 'the catalog — hive art')}
      <p class="kicker">the catalog · written by smoking</p>
      <h1>The community writes<br>the <i>catalog</i>.</h1>
      <p class="lede">Every cigar logged in a journal joins it — brand, line, vitola, wrapper,
      origin, strength. No committee, no gatekeeping. If it was smoked and it mattered, it's here.</p>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">the dimensions</p></div>
      <div class="hexgallery">
        ${hexCell('cigars/brands', 'brands')}
        ${hexCell('cigars/vitolas', 'vitolas')}
        ${hexCell('cigars/wrappers', 'wrappers')}
        ${hexCell('cigars/origins', 'origins')}
        ${hexCell('cigars/strength', 'strength')}
      </div>
      <div class="facts">
        <div><span class="n">12</span><span class="t">vitolas</span></div>
        <div><span class="n">9</span><span class="t">wrappers</span></div>
        <div><span class="n">9</span><span class="t">origins</span></div>
        <div><span class="n">5</span><span class="t">strengths</span></div>
        <div><span class="n">∞</span><span class="t">brands to come</span></div>
      </div>
      <div class="cards">
        <div class="card"><h3>Vitolas</h3><p>Robusto · Toro · Corona · Churchill · Lancero · Gordo ·
          Belicoso · Torpedo · Perfecto · Petit Corona · Lonsdale · Panatela</p></div>
        <div class="card"><h3>Wrappers</h3><p>Natural · Maduro · Oscuro · Claro · Colorado ·
          Colorado Maduro · Connecticut · Habano · Sumatra</p></div>
        <div class="card"><h3>Origins</h3><p>Cuba · Nicaragua · Dominican Republic · Honduras ·
          Mexico · Ecuador · Brazil · Cameroon · United States</p></div>
        <div class="card"><h3>Strength</h3><p>Mild · Mild-Medium · Medium · Medium-Full · Full</p></div>
      </div>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">but here is the difference</p></div>
      <h2>A catalog of experiences, not specs.</h2>
      <p class="lede" style="max-width:46rem">Anywhere else, a cigar page is ring gauge and country.
      Here, every cigar carries the moments it made: the evenings it presided over, the drinks
      that flattered it, the moods it matched. Specs tell you what a cigar is.
      Journals tell you what it's <i>for</i>.</p>
      <div class="btns"><a class="btn" href="/revolucion/journal">Add the first entry</a>
      <a class="btn ghost" href="/revolucion/flavor-wheel">Learn the language</a></div>
    </section>
  </main>`)

  const wheel = P('/revolucion/flavor-wheel', 'The Flavor Wheel', `
  <style>
    /* squared + functional — no border radius anywhere on this page */
    .tool{display:grid;grid-template-columns:minmax(400px,1.35fr) minmax(330px,1fr);gap:2.2rem;align-items:start;margin:2rem 0 3rem}
    @media(max-width:960px){.tool{grid-template-columns:1fr}}
    #wheelHost{position:relative;user-select:none;-webkit-user-select:none;touch-action:none}
    #wheelHost svg{width:100%;height:auto;display:block;cursor:grab}
    #wheelHost svg.dragging{cursor:grabbing}
    /* hover = brightness ONLY (transient) — never a lift or a gold mark, so it
       can't be mistaken for selected (gold cap) or at-notch (lifted + arrow) */
    #wheelHost path.flv{transition:filter .1s ease}
    #wheelHost path.flv:hover{filter:brightness(1.22)}
    .panel{border:1px solid var(--hairline);background:var(--coal)}
    .panel section{padding:1.05rem 1.15rem;border-bottom:1px solid var(--hairline)}
    .panel section:last-child{border-bottom:none}
    .panel h3{font-size:.7rem;letter-spacing:.32em;text-transform:uppercase;color:var(--gold);margin:0 0 .55rem;font-weight:400}
    .row{display:flex;align-items:center;gap:.6rem;padding:.4rem .1rem;border-top:1px solid rgba(200,151,90,.10);font-size:.95rem;color:var(--cream)}
    .row:first-of-type{border-top:none}
    .row .sw{width:.8rem;height:.8rem;flex:none}
    .row .fam{margin-left:auto;color:var(--faint);font-size:.7rem;letter-spacing:.1em;text-transform:uppercase}
    .row .x{background:none;border:none;color:var(--faint);font-family:var(--serif);font-size:1.05rem;cursor:pointer;padding:0 .15rem;line-height:1}
    .row .x:hover{color:var(--cream)}
    .row.pick{cursor:pointer}
    .row.pick:hover{background:rgba(200,151,90,.08)}
    .row.pick.on{color:var(--gold-bright)}
    .row.pick .mark{width:.9rem;color:var(--gold-bright);flex:none}
    .empty{color:var(--faint);font-style:italic;font-size:.88rem}
    .seg{display:flex;flex-wrap:wrap}
    .seg button{background:none;border:1px solid var(--hairline);border-left:none;color:var(--cream-dim);font-family:var(--serif);font-size:.72rem;letter-spacing:.05em;padding:.34rem .62rem;cursor:pointer}
    .seg button:first-child{border-left:1px solid var(--hairline)}
    .seg button.on{background:var(--gold);color:var(--night)}
    .clearline{margin-top:.65rem}
    .clearline button{background:none;border:1px solid var(--hairline);color:var(--cream-dim);font-family:var(--serif);font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;padding:.32rem .85rem;cursor:pointer}
    .clearline button:hover{border-color:var(--gold);color:var(--gold-bright)}
    .cig{border-left:2px solid var(--gold);padding:.6rem .85rem;margin:.6rem 0;background:rgba(20,16,23,.55)}
    .cig .nm{color:var(--gold-bright);font-size:1rem}
    .cig .meta{font-size:.75rem;color:var(--faint);letter-spacing:.04em;margin:.12rem 0 .3rem}
    .cig .fl{font-size:.84rem;color:var(--cream-dim);line-height:1.65}
    .cig .fl b{font-weight:400;color:var(--gold-bright)}
    .mbar{height:4px;background:rgba(200,151,90,.15);margin-top:.5rem}
    .mbar i{display:block;height:100%;background:var(--gold)}
    .kv{font-size:.9rem;color:var(--cream-dim);margin:.3rem 0;line-height:1.6}
    .kv i{color:var(--gold-bright)}
    .kv a{border-bottom:1px solid var(--hairline)}
    .hint{color:var(--faint);font-size:.8rem;font-style:italic;margin-top:.6rem}
    /* the selector station — a zoomed view of whatever sits at the notch */
    .station{display:grid;grid-template-columns:1fr 1.7fr;gap:1px;background:var(--hairline);border:1px solid var(--hairline)}
    /* FIXED height — the box must NOT grow/shrink with family/flavor name
       length or the selected-hint text, or the whole panel below it shifts.
       kick pins to top, name in the middle, action hint pins to the bottom. */
    .stbox{padding:.8rem .9rem;background:var(--night);height:7.5rem;overflow:hidden;display:flex;flex-direction:column}
    #stFlv{cursor:pointer}
    #stFlv:hover{background:#201927}
    .stkick{font-size:.6rem;letter-spacing:.3em;text-transform:uppercase;opacity:.75}
    .stname{font-size:1.05rem;margin-top:.3rem;line-height:1.14}
    .stname.big{font-size:1.4rem;color:var(--cream)}
    .stact{margin-top:auto;font-size:.7rem;letter-spacing:.08em;color:var(--faint);text-transform:uppercase}
    .stact.on{color:var(--gold-bright)}
    /* big active-section label above the picker */
    /* fixed height + nowrap: the title may truncate but NEVER wraps or
       pushes the wheel down — the wheel's position is layout-stable */
    .biglabel{margin:0 0 1.1rem;border-bottom:3px solid var(--hairline);padding:0 0 .5rem;height:4.4rem;overflow:hidden}
    .biglabel .k{font-size:.62rem;letter-spacing:.34em;text-transform:uppercase;color:var(--faint)}
    .biglabel .n{font-size:clamp(1.2rem,2.1vw,1.75rem);line-height:1.3;color:var(--cream);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .biglabel .n i{font-style:normal;color:var(--gold-bright)}
    .tog{background:none;border:1px solid var(--hairline);color:var(--faint);font-family:var(--serif);
      font-size:.66rem;letter-spacing:.18em;padding:.18rem .6rem;cursor:pointer}
    .tog.on{background:var(--gold);color:var(--night);border-color:var(--gold)}
  </style>
  <main class="wrap" style="max-width:1220px">
    <section class="hero" style="padding:9vh 0 2vh">
      <p class="kicker">the flavor wheel &middot; an interactive tasting instrument</p>
      <h1>Spin. Tap. <i>Taste.</i></h1>
      <p class="lede">Drag to spin the wheel. Tap a family and it turns into the scope notch on the
      right; tap the flavors you taste and the panel answers with cigars, pairings, and moods.</p>
    </section>
    <section class="tool">
      <div>
        <div id="bigLabel" class="biglabel"></div>
        <div id="wheelHost"></div>
      </div>
      <aside class="panel">
        <section>
          <h3>The selector</h3>
          <div class="station">
            <div class="stbox" id="stFam"></div>
            <div class="stbox" id="stFlv"></div>
          </div>
          <p class="hint">Spin the wheel past the notch &mdash; whatever lands here is up next. Tap the big box to take it.</p>
        </section>
        <section>
          <h3 id="focusTitle">In the scope</h3>
          <div id="focusList"></div>
        </section>
        <section>
          <h3>Selected flavors</h3>
          <div id="selList"></div>
          <div class="clearline"><button id="clear" hidden>Clear all</button></div>
        </section>
        <section>
          <h3>Strength</h3>
          <div class="seg" id="seg"></div>
        </section>
        <section>
          <h3 style="display:flex;align-items:center;justify-content:space-between">Cigar matches
            <button id="cigTog" class="tog on">ON</button></h3>
          <div id="matches"></div>
        </section>
        <section>
          <h3>Possibilities</h3>
          <div id="poss"></div>
        </section>
      </aside>
    </section>
  </main>
  <script>
  (function(){
    var FAM = ${JSON.stringify(FAMILIES)};
    var STR = ['Mild','Mild-Medium','Medium','Medium-Full','Full'];
    var CIGARS = [
      {n:'Reflexi\\u00f3n N\\u00ba 1',v:'Toro',w:'Maduro',o:'Nicaragua',s:3,m:'reflection',f:['Dark Chocolate','Cedar','Molasses','Leather']},
      {n:'Sobremesa',v:'Corona',w:'Habano',o:'Nicaragua',s:3,m:'conversation',f:['Cedar','Black Pepper','Caramel','Toast']},
      {n:'Primera Luz',v:'Petit Corona',w:'Connecticut',o:'Ecuador',s:1,m:'first light',f:['Cream','Butter','Honey','Hay']},
      {n:'Fogata',v:'Robusto',w:'Oscuro',o:'Nicaragua',s:5,m:'fireside',f:['Campfire','Charred Wood','Black Pepper','Espresso']},
      {n:'Biblioteca',v:'Lancero',w:'Colorado',o:'Dominican Republic',s:2,m:'focus',f:['Sandalwood','Tea','Honey','Toast']},
      {n:'Celebraci\\u00f3n',v:'Torpedo',w:'Colorado Maduro',o:'Honduras',s:4,m:'celebration',f:['Red Pepper','Brown Sugar','Cocoa','Oak']},
      {n:'Cacao Real',v:'Gordo',w:'Maduro',o:'Brazil',s:4,m:'unwind',f:['Dark Chocolate','Espresso','Raisin','Molasses']},
      {n:'La Cosecha',v:'Churchill',w:'Sumatra',o:'Ecuador',s:3,m:'gratitude',f:['Fig','Cedar','Hay','Almond']},
      {n:'Patio Dorado',v:'Robusto',w:'Natural',o:'Honduras',s:2,m:'golden hour',f:['Caramel','Peanut','Grass','Citrus']},
      {n:'Niebla',v:'Belicoso',w:'Claro',o:'Mexico',s:2,m:'morning',f:['Mineral','Cream','Jasmine','White Pepper']},
      {n:'Medianoche',v:'Perfecto',w:'Oscuro',o:'Nicaragua',s:5,m:'late night',f:['Charcoal','Dark Chocolate','Peat','Clove']},
      {n:'Compa\\u00f1ero',v:'Lonsdale',w:'Habano',o:'Cuba',s:3,m:'close friends',f:['Leather','Nutmeg','Mocha','Dried Fruit']},
      {n:'Brisa',v:'Panatela',w:'Connecticut',o:'Dominican Republic',s:1,m:'a breeze outside',f:['Grass','Citrus','Cream','Mint']},
      {n:'El Faro',v:'Toro',w:'Colorado',o:'Cameroon',s:4,m:'milestone',f:['Hickory','Anise','Burnt Caramel','Walnut']}
    ];
    var PAIR = {'Earth':['espresso','rum'],'Wood':['scotch','whiskey'],'Spice':['rum','scotch'],'Sweet':['coffee','hot chocolate'],'Coffee & Chocolate':['espresso','beer'],'Cream & Bread':['coffee','tea'],'Nut':['rum','beer'],'Fruit':['wine','tea'],'Herbal & Floral':['tea','wine'],'Smoke & Char':['whiskey','scotch']};
    var MOOD = {'Earth':'reflection','Wood':'focus','Spice':'celebration','Sweet':'gratitude','Coffee & Chocolate':'unwind','Cream & Bread':'a gentle first light','Nut':'conversation','Fruit':'a golden hour','Herbal & Floral':'a clear morning','Smoke & Char':'a fireside evening'};
    var famOf = {}; FAM.forEach(function(fm){ fm.flavors.forEach(function(lb){ famOf[lb] = fm; }); });

    // ---- geometry: family width proportional to flavor count -------------
    var TOTAL = FAM.reduce(function(n, f){ return n + f.flavors.length; }, 0);
    var GAP = 1.4, usable = 360 - GAP * FAM.length, SEGS = [], acc = 0;
    FAM.forEach(function(fm){
      var w = usable * fm.flavors.length / TOTAL;
      SEGS.push({ fm: fm, a0: acc, a1: acc + w });
      acc += w + GAP;
    });
    var C = 390, R_OUT = 368, R_FLV = 236, R_FAM = 158, R_HUB = 148;
    var R_RAISE = 12; // how far the notch flavor lifts above the rim — kept
    // short so the lifted outer edge + its gold cap never clip the 780 viewBox
    var SCOPE_AT = 90; // the fixed notch: 3 o'clock, pointing at the panel

    var state = { rot: 0, sel: [], str: 0, cigOn: true };

    var host = document.getElementById('wheelHost');
    var NS = 'http://www.w3.org/2000/svg';
    function el(tag, attrs, parent){ var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, String(attrs[k])); if (parent) parent.appendChild(e); return e; }
    function polar(r, deg){ var a = (deg - 90) * Math.PI / 180; return [C + r * Math.cos(a), C + r * Math.sin(a)]; }
    function arcPath(r0, r1, a0, a1){
      var p0 = polar(r1, a0), p1 = polar(r1, a1), p2 = polar(r0, a1), p3 = polar(r0, a0);
      var big = (a1 - a0) > 180 ? 1 : 0;
      return 'M' + p0[0].toFixed(1) + ',' + p0[1].toFixed(1) +
        ' A' + r1 + ',' + r1 + ' 0 ' + big + ' 1 ' + p1[0].toFixed(1) + ',' + p1[1].toFixed(1) +
        ' L' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1) +
        ' A' + r0 + ',' + r0 + ' 0 ' + big + ' 0 ' + p3[0].toFixed(1) + ',' + p3[1].toFixed(1) + ' Z';
    }
    function absOf(localDeg){ return ((localDeg + state.rot) % 360 + 360) % 360; }
    function isSel(lb){ return state.sel.indexOf(lb) >= 0; }
    var dragMoved = false;

    // ---- the selector station: what sits at the notch right now ----------
    function notchAt(){
      var local = ((SCOPE_AT - state.rot) % 360 + 360) % 360;
      var best = null, bestD = 1e9;
      SEGS.forEach(function(sg){
        var n = sg.fm.flavors.length, fw = (sg.a1 - sg.a0) / n;
        sg.fm.flavors.forEach(function(lb, j){
          var mid = sg.a0 + (j + .5) * fw;
          var d = Math.abs(((local - mid) % 360 + 540) % 360 - 180);
          if (d < bestD){ bestD = d; best = { fm: sg.fm, lb: lb, mid: mid }; }
        });
      });
      return best;
    }
    function updateStation(){
      var famBox = document.getElementById('stFam'), flvBox = document.getElementById('stFlv');
      if (!famBox || !flvBox) return;
      var t = notchAt(); if (!t) return;
      // the big label over the picker tracks the active section live
      var big = document.getElementById('bigLabel');
      if (big) {
        big.innerHTML = '<div class="k">active family</div>' +
          '<div class="n">' + t.fm.label + ' \\u2014 <i>' + t.lb + '</i></div>';
        big.style.borderBottomColor = t.fm.color;
      }
      famBox.style.background = t.fm.color;
      famBox.style.color = t.fm.dark ? '#1b1520' : '#f0e6d6';
      famBox.innerHTML = '<div class="stkick">family</div><div class="stname">' + t.fm.label + '</div>' +
        '<div class="stact" style="color:inherit;opacity:.8">' + t.fm.flavors.length + ' flavors</div>';
      var on = isSel(t.lb);
      flvBox.style.borderLeft = '5px solid ' + t.fm.color;
      flvBox.innerHTML = '<div class="stkick">at the notch</div><div class="stname big">' + t.lb + '</div>' +
        '<div class="stact' + (on ? ' on' : '') + '">' + (on ? '\\u25a0 tap to remove' : '\\u25a1 tap to select') + '</div>';
      flvBox.onclick = function(){ toggle(t.lb); };
    }
    // ease the nearest flavor's center into the notch after a spin
    function snapToNotch(){
      var t = notchAt();
      if (!t) { render(); return; }
      var target = SCOPE_AT - t.mid;
      var delta = ((target - state.rot) % 360 + 540) % 360 - 180;
      if (Math.abs(delta) < .4){ render(); return; }
      var from = state.rot, dur = 170, t0 = performance.now(), my = ++animId, finished = false;
      function fin(){ if (finished || my !== animId) return; finished = true; state.rot = from + delta; render(); }
      function step(now){
        if (finished || my !== animId) return;
        var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 2);
        state.rot = from + delta * e;
        var g = host.querySelector('#rot');
        if (g) g.setAttribute('transform', 'rotate(' + state.rot + ' ' + C + ' ' + C + ')');
        updateStation();
        if (k < 1) requestAnimationFrame(step); else fin();
      }
      requestAnimationFrame(step);
      setTimeout(fin, dur + 200);
    }

    // ---- wheel ------------------------------------------------------------
    function drawWheel(){
      host.innerHTML = '';
      var svg = el('svg', { viewBox: '0 0 780 780' }, host);
      el('circle', { cx: C, cy: C, r: R_OUT + R_RAISE + 5, fill: 'none', stroke: 'rgba(200,151,90,.28)', 'stroke-width': 1 }, svg);
      var rot = el('g', { id: 'rot', transform: 'rotate(' + state.rot + ' ' + C + ' ' + C + ')' }, svg);
      var active = notchAt(); // the family + flavor sitting at the notch

      SEGS.forEach(function(sg, si){
        var fm = sg.fm, focused = !!active && active.fm.label === fm.label;
        // family arc — the ACTIVE (at-the-notch) family carries the outline
        var fa = el('path', { d: arcPath(R_FAM, R_FLV - 3, sg.a0, sg.a1), fill: fm.color, opacity: focused ? 1 : .88, 'class': 'fam' }, rot);
        if (focused) { fa.setAttribute('stroke', '#f0e6d6'); fa.setAttribute('stroke-width', '2'); }
        fa.style.cursor = 'pointer';
        fa.addEventListener('click', function(){ if (dragMoved) return; focusFamily(fm, sg); });
        el('title', {}, fa).textContent = fm.label + ' \\u2014 bring into the scope';

        // family label: curved along the arc, flipped on the bottom half
        var mid = (sg.a0 + sg.a1) / 2, abs = absOf(mid);
        var bottom = abs > 90 && abs < 270;
        var rTxt = (R_FAM + R_FLV) / 2 + (bottom ? -7 : 7);
        var pA = polar(rTxt, bottom ? sg.a1 - 1 : sg.a0 + 1), pB = polar(rTxt, bottom ? sg.a0 + 1 : sg.a1 - 1);
        var arcId = 'famarc' + si;
        el('path', { id: arcId, d: 'M' + pA[0].toFixed(1) + ',' + pA[1].toFixed(1) + ' A' + rTxt + ',' + rTxt + ' 0 0 ' + (bottom ? 0 : 1) + ' ' + pB[0].toFixed(1) + ',' + pB[1].toFixed(1), fill: 'none' }, rot);
        // fit the name to its arc: long names on narrow families shrink
        // instead of clipping ("Cream & Bread" on a 6-flavor segment)
        var arcLen = rTxt * (sg.a1 - sg.a0 - 2) * Math.PI / 180;
        var famFs = Math.max(12.5, Math.min(19, arcLen / (fm.label.length * 0.62)));
        var ft = el('text', { 'font-size': famFs.toFixed(1), fill: fm.dark ? '#1b1520' : '#f0e6d6', 'letter-spacing': famFs > 17 ? '1' : '0' }, rot);
        ft.setAttribute('font-family', 'Georgia,serif'); ft.style.pointerEvents = 'none';
        var tp = el('textPath', { startOffset: '50%', 'text-anchor': 'middle' }, ft);
        tp.setAttribute('href', '#' + arcId); tp.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#' + arcId);
        tp.textContent = fm.label;

        // flavor slices + RADIAL labels (always on the wheel, always legible).
        // The slice AT THE NOTCH is raised and enlarged — the "in focus" cut.
        var n = fm.flavors.length, fw = (sg.a1 - sg.a0) / n;
        fm.flavors.forEach(function(lb, j){
          var f0 = sg.a0 + j * fw + .5, f1 = sg.a0 + (j + 1) * fw - .5, fmid = (f0 + f1) / 2;
          var sel = isSel(lb);
          var atNotch = !!active && active.fm.label === fm.label && active.lb === lb;
          // selection LIFTS the slice out of the rim — the position change IS
          // the select cue (a thin border alone read as "nothing happened").
          // The at-notch slice lifts most; a selected slice lifts a bit less.
          var lift = atNotch ? R_RAISE : (sel ? 8 : 0);
          var rIn = R_FLV - (lift ? 8 : 0);
          var rOut = R_OUT + lift;
          var op = atNotch ? 1 : (sel ? 1 : (focused ? .8 : .5));
          // ink + outline that read ON THIS family's fill — cream ink on the
          // light families (Sweet, Cream & Bread, Fruit…) is unreadable, so
          // dark:true families always mark selection with dark ink/stroke
          var ink = fm.dark ? '#241c14' : '#f0e6d6';
          var fp = el('path', { d: arcPath(rIn, rOut, lift ? f0 - .4 : f0, lift ? f1 + .4 : f1), fill: fm.color, opacity: op, 'class': 'flv' }, rot);
          // AT-NOTCH: a light ink outline + the biggest lift + the notch arrow
          // mark it "in the scope". SELECTED: a bright-gold cap hugging the
          // outer edge (dark halo behind it so it reads on ANY family colour) —
          // a categorical "chosen" mark that hover (brightness) and the notch
          // (position) never wear, so the three states never blur together.
          if (atNotch) { fp.setAttribute('stroke', ink); fp.setAttribute('stroke-width', '1.5'); }
          if (sel) {
            var cr = rOut + 2, c0 = polar(cr, f0 - .4), c1 = polar(cr, f1 + .4);
            var capD = 'M' + c0[0].toFixed(1) + ',' + c0[1].toFixed(1) + ' A' + cr + ',' + cr + ' 0 0 1 ' + c1[0].toFixed(1) + ',' + c1[1].toFixed(1);
            el('path', { d: capD, fill: 'none', stroke: '#14101a', 'stroke-width': 7, 'stroke-linecap': 'round' }, rot);
            el('path', { d: capD, fill: 'none', stroke: '#e0b578', 'stroke-width': 4, 'stroke-linecap': 'round' }, rot);
          }
          fp.style.cursor = 'pointer';
          fp.addEventListener('click', function(){ if (dragMoved) return; toggle(lb); });
          el('title', {}, fp).textContent = lb;
          // radial label: right half reads inner→outer, left half flips
          var fabs = absOf(fmid), flip = fabs > 180;
          var ang = fmid - 90 + (flip ? 180 : 0);
          var p = polar(flip ? rOut - 10 : rIn + 10, fmid);
          var labelFill = (sel || atNotch) ? ink : (fm.dark ? '#241c14' : 'rgba(240,230,214,.92)');
          var t = el('text', { x: p[0].toFixed(1), y: p[1].toFixed(1), 'font-size': atNotch ? 17.5 : 15.5, fill: labelFill,
            transform: 'rotate(' + ang.toFixed(1) + ' ' + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ')' }, rot);
          t.setAttribute('font-family', 'Georgia,serif');
          t.setAttribute('text-anchor', 'start');
          t.setAttribute('dominant-baseline', 'middle');
          t.style.pointerEvents = 'none';
          if (sel || atNotch) t.setAttribute('font-weight', 'bold');
          t.textContent = lb;
        });
      });

      // fixed hub (does not spin)
      el('circle', { cx: C, cy: C, r: R_HUB, fill: '#14101a', stroke: 'rgba(200,151,90,.4)', 'stroke-width': 1, 'class': 'hub' }, svg);
      [{ t: 'REVOLUCI\\u00d3N', y: C - 22, s: 13, c: '#c8975a', ls: 5 },
       { t: 'drag to spin', y: C + 6, s: 16, c: '#f0e6d6' },
       { t: 'the notch picks the flavor', y: C + 30, s: 13, c: '#8d7f6f' }].forEach(function(ln){
        var t = el('text', { x: C, y: ln.y, 'text-anchor': 'middle', 'font-size': ln.s, fill: ln.c, 'letter-spacing': ln.ls || 0 }, svg);
        t.setAttribute('font-family', 'Georgia,serif'); t.style.pointerEvents = 'none'; t.textContent = ln.t;
      });

      // fixed scope notch at 3 o'clock, pointing into the wheel — sits just
      // beyond the RAISED slice so the arrow tip touches the in-focus cut
      var ny = C, nx = C + R_OUT + R_RAISE + 4;
      el('path', { d: 'M' + (nx + 14) + ',' + (ny - 12) + ' L' + nx + ',' + ny + ' L' + (nx + 14) + ',' + (ny + 12) + ' Z', fill: '#e0b578' }, svg);

      // ---- drag to spin ---------------------------------------------------
      var dragging = false, startAngle = 0, startRot = 0, downX = 0, downY = 0;
      function angleAt(ev){
        var r = svg.getBoundingClientRect();
        var x = ev.clientX - (r.left + r.width / 2), y = ev.clientY - (r.top + r.height / 2);
        return Math.atan2(y, x) * 180 / Math.PI;
      }
      svg.addEventListener('pointerdown', function(ev){
        dragging = true; dragMoved = false;
        downX = ev.clientX; downY = ev.clientY;
        startAngle = angleAt(ev); startRot = state.rot;
        // NOTE: do NOT setPointerCapture here — a pure tap would then capture
        // the pointer and the browser retargets the click to the <svg>, so the
        // slice's own click listener never fires (you can't select by tapping).
        // Capture is deferred to the drag threshold below.
      });
      svg.addEventListener('pointermove', function(ev){
        if (!dragging) return;
        // PIXEL threshold, not angle: an angle test amplifies near the hub
        // and swallowed slice clicks — tapping the picture must toggle the
        // flavor, exactly like ticking it in the list. Under 6px is a click:
        // the wheel does not move and the tap lands on the slice.
        if (!dragMoved) {
          var dx = ev.clientX - downX, dy = ev.clientY - downY;
          if (dx * dx + dy * dy < 36) return;
          dragMoved = true;
          startAngle = angleAt(ev); // re-baseline so the wheel doesn't jump
          // a real drag has begun — NOW capture the pointer for smooth spinning
          svg.classList.add('dragging');
          try { svg.setPointerCapture(ev.pointerId); } catch(e){}
        }
        var d = angleAt(ev) - startAngle;
        state.rot = startRot + d;
        var g = svg.querySelector('#rot');
        if (g) g.setAttribute('transform', 'rotate(' + state.rot + ' ' + C + ' ' + C + ')');
        updateStation(); // the station tunes live as flavors pass the notch
      });
      function endDrag(){
        if (!dragging) return;
        dragging = false; svg.classList.remove('dragging');
        if (dragMoved) snapToNotch(); // land the nearest flavor in the notch, then re-orient labels
        setTimeout(function(){ dragMoved = false; }, 0);
      }
      svg.addEventListener('pointerup', endDrag);
      svg.addEventListener('pointercancel', endDrag);
    }

    // spin the tapped family into the fixed scope notch
    var animId = 0;
    function focusFamily(fm, sg){
      // spin the family's MIDDLE FLAVOR'S CENTER into the notch — every rest
      // state leaves the arrow dead-center on a slice, never between two
      var n = fm.flavors.length, fw = (sg.a1 - sg.a0) / n;
      var mid = sg.a0 + (Math.floor((n - 1) / 2) + .5) * fw;
      var target = SCOPE_AT - mid;
      var delta = ((target - state.rot) % 360 + 540) % 360 - 180; // shortest path
      var from = state.rot, dur = 450, t0 = performance.now(), my = ++animId;
      var finished = false;
      function finish(){
        if (finished || my !== animId) return;
        finished = true;
        state.rot = from + delta;
        render();
      }
      function step(now){
        if (finished || my !== animId) return;
        var k = Math.min(1, (now - t0) / dur);
        var e = 1 - Math.pow(1 - k, 3);
        state.rot = from + delta * e;
        var g = host.querySelector('#rot');
        if (g) g.setAttribute('transform', 'rotate(' + state.rot + ' ' + C + ' ' + C + ')');
        updateStation();
        if (k < 1) requestAnimationFrame(step); else finish();
      }
      requestAnimationFrame(step);
      // rAF starves in occluded/background windows — land the spin anyway.
      setTimeout(finish, dur + 250);
    }
    function toggle(lb){
      var i = state.sel.indexOf(lb);
      if (i >= 0) state.sel.splice(i, 1); else state.sel.push(lb);
      render();
    }

    // ---- panel ------------------------------------------------------------
    function jaccard(sel, prof){
      var inter = 0, u = {};
      sel.forEach(function(s){ u[s] = 1; });
      prof.forEach(function(p){ if (u[p]) inter++; u[p] = 1; });
      var uni = Object.keys(u).length;
      return uni ? inter / uni : 0;
    }
    function row(html, cls){ var d = document.createElement('div'); d.className = 'row' + (cls ? ' ' + cls : ''); d.innerHTML = html; return d; }
    function render(){
      drawWheel();
      updateStation();

      var selList = document.getElementById('selList');
      selList.innerHTML = '';
      if (!state.sel.length) selList.innerHTML = '<p class="empty">Nothing yet \\u2014 tap flavors on the rim.</p>';
      else state.sel.forEach(function(lb){
        var fm = famOf[lb];
        var r = row('<span class="sw" style="background:' + fm.color + '"></span>' + lb +
          '<span class="fam">' + fm.label + '</span><button class="x" title="remove">\\u00d7</button>');
        r.querySelector('.x').addEventListener('click', function(){ toggle(lb); });
        selList.appendChild(r);
      });
      document.getElementById('clear').hidden = !state.sel.length;

      // the scope section FOLLOWS the notch — whatever family is dialed in
      // is the active section, no separate click-state to manage
      var act = notchAt();
      var ftitle = document.getElementById('focusTitle');
      var flist = document.getElementById('focusList');
      flist.innerHTML = '';
      if (!act) {
        ftitle.textContent = 'In the scope';
        flist.innerHTML = '<p class="empty">Spin a family into the notch.</p>';
      } else {
        ftitle.textContent = 'In the scope \\u2014 ' + act.fm.label;
        act.fm.flavors.forEach(function(lb){
          var on = isSel(lb);
          var r = row('<span class="mark">' + (on ? '\\u25a0' : '\\u25a1') + '</span>' + lb, 'pick' + (on ? ' on' : ''));
          r.addEventListener('click', function(){ toggle(lb); });
          flist.appendChild(r);
        });
      }

      var seg = document.getElementById('seg');
      seg.innerHTML = '';
      ['Any'].concat(STR).forEach(function(lbl, i){
        var b = document.createElement('button');
        b.textContent = lbl; if (state.str === i) b.className = 'on';
        b.addEventListener('click', function(){ state.str = i; render(); });
        seg.appendChild(b);
      });

      var tog = document.getElementById('cigTog');
      tog.textContent = state.cigOn ? 'ON' : 'OFF';
      tog.className = state.cigOn ? 'tog on' : 'tog';
      var out = document.getElementById('matches');
      out.innerHTML = '';
      var pool = CIGARS.filter(function(c){ return !state.str || c.s === state.str; });
      if (!state.cigOn) {
        out.innerHTML = '<p class="empty">Cigar filtering is off.</p>';
      } else if (!state.sel.length) {
        out.innerHTML = '<p class="empty">Select flavors and the catalog answers.</p>';
      } else {
        var ranked = pool.map(function(c){ return { c: c, sc: jaccard(state.sel, c.f) }; })
          .filter(function(r){ return r.sc > 0; })
          .sort(function(a, b){ return b.sc - a.sc; })
          .slice(0, 5);
        if (!ranked.length) out.innerHTML = '<p class="empty">No match in the starter catalog \\u2014 journal one and it learns.</p>';
        ranked.forEach(function(r){
          var c = r.c, d = document.createElement('div');
          d.className = 'cig';
          var fl = c.f.map(function(f){ return state.sel.indexOf(f) >= 0 ? '<b>' + f + '</b>' : f; }).join(' \\u00b7 ');
          d.innerHTML = '<div class="nm">' + c.n + '</div>' +
            '<div class="meta">' + c.v + ' \\u00b7 ' + c.w + ' \\u00b7 ' + c.o + ' \\u00b7 ' + STR[c.s - 1] + '</div>' +
            '<div class="fl">' + fl + '</div>' +
            '<div class="mbar"><i style="width:' + Math.round(r.sc * 100) + '%"></i></div>';
          out.appendChild(d);
        });
      }

      var poss = document.getElementById('poss');
      var famCount = {};
      state.sel.forEach(function(s){ var f = famOf[s].label; famCount[f] = (famCount[f] || 0) + 1; });
      var top = Object.keys(famCount).sort(function(a, b){ return famCount[b] - famCount[a]; });
      if (!top.length) poss.innerHTML = '<p class="empty">Pairings and moods appear with a selection.</p>';
      else {
        var drinks = {}; top.slice(0, 2).forEach(function(f){ (PAIR[f] || []).forEach(function(dk){ drinks[dk] = 1; }); });
        poss.innerHTML = '<div class="kv">Pairs well with <i>' + Object.keys(drinks).join('</i>, <i>') + '</i>.</div>' +
          '<div class="kv">Sounds like <i>' + MOOD[top[0]] + '</i>.</div>' +
          '<div class="kv"><a href="/revolucion/journal">Journal this moment</a> \\u00b7 <a href="/revolucion/discovery">Open discovery</a></div>';
      }
    }
    document.getElementById('clear').addEventListener('click', function(){ state.sel = []; render(); });
    document.getElementById('cigTog').addEventListener('click', function(){ state.cigOn = !state.cigOn; render(); });
    render();
  })();
  </script>`)

  const discovery = P('/revolucion/discovery', 'Discovery', `
  <main class="wrap">
    <section class="hero">
      <p class="kicker">discovery · grown from journals</p>
      <h1>Ask for a moment,<br>not a <i>spec sheet</i>.</h1>
      <p class="lede">Recommendations built from lived experiences — yours and your kindred's —
      instead of star ratings from strangers.</p>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">four doors in</p></div>
      <div class="cards">
        <div class="card"><span class="num">01</span>${thumb('discovery/for-you')}<h3>For You</h3>
          <p>Flavor-profile similarity against your own entries — cigars whose tasted flavors
          overlap what you already love.</p></div>
        <div class="card"><span class="num">02</span>${thumb('discovery/by-experience')}<h3>By Experience</h3>
          <p>"I'm in the mood for a reflection experience." Ask for the evening you want;
          we find the leaf that fits it.</p></div>
        <div class="card"><span class="num">03</span>${thumb('discovery/kindred-smokers')}<h3>Kindred Smokers</h3>
          <p>People whose palates and moments rhyme with yours — connection, not just products.</p></div>
        <div class="card"><span class="num">04</span>${thumb('discovery/knowledge-graph')}<h3>The Knowledge Graph</h3>
          <p>Cigar × flavor × pairing × weather × company × mood. The deep record the journal
          builds, richer than any rating.</p></div>
      </div>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">an honest example</p></div>
      <blockquote>You like maduros. But more truly: you like them on cool evenings, outdoors,
      with close friends and coffee. So when the crisp air comes back in October —
      we'll know exactly what to put in your hand.
        <cite>— what discovery actually knows</cite></blockquote>
      <div class="btns"><a class="btn" href="/revolucion/journal">Teach it your taste</a></div>
    </section>
  </main>`)

  const community = P('/revolucion/community', 'The Circle', `
  <main class="wrap">
    <section class="hero">
      <p class="kicker">the circle · people, not just products</p>
      <h1>Smoke is better<br><i>shared</i>.</h1>
      <p class="lede">The deeper sense of connection: a vocabulary people speak to each other,
      moments they choose to share, and rooms where both come alive.</p>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">how it gathers</p></div>
      <div class="cards">
        <div class="card">${thumb('community/shared-moments')}<h3>Shared Moments</h3>
          <p>Journal entries members choose to share — scenes, not reviews. The patio, the
          golden hour, the conversation that would not stop.</p></div>
        <div class="card">${thumb('community/vocabulary')}<h3>The Vocabulary</h3>
          <p>Experience terms that emerge organically from real journals. Because they grow from
          lived data they feel authentic — and people start speaking them to each other.</p></div>
        <div class="card">${thumb('community/circles')}<h3>Circles</h3>
          <p>Herf nights, lounge meetups, tasting circles — where the vocabulary is spoken
          out loud and new friendships get lit.</p></div>
      </div>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">first light — for newcomers</p></div>
      ${heroArt('community/first-light', 'first light — hive art')}
      <h2>Nobody should be intimidated by a leaf.</h2>
      <p class="lede" style="max-width:46rem">A gentle path for new smokers: honest introductions,
      mild starts, and expectations set before the first draw. If the pepper surprises —
      we say so <i>before</i> it intimidates. Your first cigar should feel like a welcome,
      not a test.</p>
      <div class="btns"><a class="btn" href="/revolucion/discovery">Find a gentle start</a></div>
    </section>
  </main>`)

  const insights = P('/revolucion/insights', 'For the Makers', `
  <main class="wrap">
    <section class="hero">
      <p class="kicker">for the makers · the trusted fulcrum</p>
      <h1>We don't tell you what to make.<br>We show you <i>who you serve</i>.</h1>
      <p class="lede">Anonymized, aggregated experience trends for manufacturers and
      distributors — the kind of truth a star rating cannot hold.</p>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">what an insight looks like</p></div>
      <div class="cards">
        <div class="card">${thumb('insights/occasion-trends')}<h3>Occasion Trends</h3>
          <p>"This blend is most often chosen for quiet evening reflection." Now you know what
          its marketing should sound like — and what its band should feel like.</p></div>
        <div class="card">${thumb('insights/pairing-performance')}<h3>Pairing Performance</h3>
          <p>"Often exceeds expectations with coffee, but underperforms with whisky pairings."
          A tasting-room fix no focus group would ever surface.</p></div>
        <div class="card">${thumb('insights/newcomer-experience')}<h3>Newcomer Experience</h3>
          <p>"New smokers feel intimidated — the pepper is a surprise." Feedback that refines a
          blend's introduction, not its soul.</p></div>
        <div class="card">${thumb('insights/blend-feedback')}<h3>Blend Feedback</h3>
          <p>Aggregate flavor profiles, vitola preferences, strength drift over seasons — insight
          that helps you refine blends, vitolas, and marketing.</p></div>
      </div>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">the position</p></div>
      <blockquote>Retailers move boxes. Revolución is the fulcrum where the people who smoke
      and the people who make meet — and both leave better off.
        <cite>— why makers pick up the phone</cite></blockquote>
      <div class="privacy">
        <h3>The privacy covenant</h3>
        <p class="muted">Anonymized and aggregated, always. No individual journal ever leaves the
        hive without its author's consent. The trust is the product — we do not spend it.</p>
      </div>
      <div class="btns"><a class="btn" href="/revolucion/collaborations">See what we build together</a></div>
    </section>
  </main>`)

  const collaborations = P('/revolucion/collaborations', 'Named Experiences', `
  <main class="wrap">
    <section class="hero">
      ${heroArt('collaborations/named-experiences', 'named experiences — hive art')}
      <p class="kicker">collaborations · named experiences</p>
      <h1>Blends named for what<br>they <i>create</i>.</h1>
      <p class="lede">Names shift from wrapper and origin to experience. When a person smokes it,
      they speak it, they feel it — a more intimate relationship than any band can print.</p>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">the first three</p></div>
      <div class="cards">
        <div class="card"><span class="num">Nº 1</span><h3>Conversation</h3>
          <p>For the table that will not stop talking. Medium body, long finish, forgiving burn —
          a cigar that waits for you between stories.</p></div>
        <div class="card"><span class="num">Nº 2</span><h3>Reflection</h3>
          <p>For the quiet evening that asks nothing of you. Cool-weather sweetness, coffee-friendly,
          built for one chair and a long view.</p></div>
        <div class="card"><span class="num">Nº 3</span><h3>Celebration</h3>
          <p>For the milestone that deserves smoke rings. Bright, confident, a touch of spice —
          made to be handed out.</p></div>
      </div>
      <p class="muted">The labels are not invented in a boardroom — they emerge from community
      data, so they arrive already meaning something. People asked for reflection evenings long
      before a band said the word.</p>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">with the makers</p></div>
      <h2>Partners, not vendors.</h2>
      <p class="lede" style="max-width:46rem">Manufacturers and distributors who build to the
      vocabulary, guided by <a href="/revolucion/insights">the insights</a>. And the vocabulary
      outgrows the leaf: chocolates, coffees, spirits — named to the same experiences, so a
      <i>reflection</i> evening can be assembled end to end.</p>
      <div class="btns"><a class="btn ghost" href="/revolucion/insights">For the makers</a></div>
    </section>
  </main>`)

  const humidor = P('/revolucion/humidor', 'The Humidor', `
  <main class="wrap">
    <section class="hero">
      ${heroArt('humidor', 'the humidor — hive art')}
      <p class="kicker">the humidor · patience, kept</p>
      <h1>What rests in the dark<br>gets <i>better</i>.</h1>
      <p class="lede">Your collection, kept and aging — with the journal one tap away when a
      stick finally comes off the shelf.</p>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">three shelves</p></div>
      <div class="cards">
        <div class="card">${thumb('humidor/my-collection')}<h3>My Collection</h3>
          <p>What you hold now — counts, dates acquired, and the entries each cigar has already earned.</p></div>
        <div class="card">${thumb('humidor/wishlist')}<h3>Wishlist</h3>
          <p>What <a href="/revolucion/discovery">discovery</a> has convinced you to try next.</p></div>
        <div class="card">${thumb('humidor/aging')}<h3>Aging</h3>
          <p>What rests, and how long it has rested. The humidor remembers so you can forget on purpose.</p></div>
      </div>
      <div class="btns"><a class="btn" href="/revolucion/journal">Journal the next one</a></div>
    </section>
  </main>`)

  const mission = P('/revolucion/mission', 'The Manifesto', `
  <main class="wrap">
    <section class="hero" style="padding-bottom:2vh">
      <p class="kicker">the manifesto</p>
      <h1>What we <i>believe</i>.</h1>
    </section>
    <section class="section manifesto" style="max-width:46rem">
      <p>We do not sell cigars. We curate <b>meaningful experiences</b> —
      the cigar is the medium, the moment is the product.</p>
      <p>The <b>journal</b> is the foundation. People share their experiences, get truer
      recommendations, and find a deeper sense of connection. Everything else grows from it.</p>
      <p>The vocabulary belongs to the <b>community</b>. Names emerge from lived moments,
      not marketing decks — that is why they feel authentic, and why people speak them.</p>
      <p>Insight flows back to the <b>makers</b> — anonymized, aggregated, consent-first.
      We help them understand the people they serve. We never tell them what to make.</p>
      <p>Newcomers are met with <b>honesty</b>, not initiation. If the pepper surprises,
      we say so first.</p>
      <p>And the loop closes: better blends make richer moments, richer moments make
      truer journals, truer journals make everything <b>better</b>.</p>
      <div class="btns" style="margin-top:3.4rem">
        <a class="btn" href="/revolucion/journal">Begin with one moment</a>
        <a class="btn ghost" href="/revolucion">Back to the ecosystem</a>
      </div>
    </section>
  </main>`)

  // The lounge hangs REAL hive art in its wall frames when the cells carry
  // imagery — vector etchings remain as the cold-start fallback.
  const mantelInner = art['lounge']
    ? `<image href="resource:${art['lounge']}/art.png" x="632" y="136" width="96" height="126" preserveAspectRatio="xMidYMid slice"/>
          <rect x="632" y="136" width="96" height="126" fill="none" stroke="rgba(200,151,90,.35)"/>`
    : `<rect x="632" y="136" width="96" height="126" fill="none" stroke="rgba(200,151,90,.35)"/>
          <polygon points="680,152 692,159 692,173 680,180 668,173 668,159" fill="none" stroke="rgba(224,181,120,.6)" stroke-width="1.5"/>
          <text x="680" y="234" text-anchor="middle" font-size="58" font-style="italic" fill="#c8975a" font-family="Georgia,serif">R</text>`
  const bigFrameInner = art['cigars']
    ? `<image href="resource:${art['cigars']}/art.png" x="960" y="126" width="96" height="96" preserveAspectRatio="xMidYMid slice"/>`
    : `<g transform="translate(1008 174)">
            <circle r="36" fill="none" stroke="#5C3D2E" stroke-width="13"/>
            <circle r="36" fill="none" stroke="#C0392B" stroke-width="13" stroke-dasharray="34 193"/>
            <circle r="36" fill="none" stroke="#D4A017" stroke-width="13" stroke-dasharray="30 197" stroke-dashoffset="-40"/>
            <circle r="36" fill="none" stroke="#27AE60" stroke-width="13" stroke-dasharray="26 201" stroke-dashoffset="-78"/>
            <circle r="14" fill="#171017"/>
          </g>`
  const smallFrameInner = art['journal']
    ? `<image href="resource:${art['journal']}/art.png" x="1093" y="159" width="58" height="78" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect x="1107" y="183" width="30" height="30" fill="#c8975a" transform="rotate(45 1122 198)"/>`

  const lounge = P('/revolucion/lounge', 'The Cigar Lounge', `
  <style>
    .lounge{display:grid;grid-template-columns:minmax(420px,1.6fr) minmax(280px,.7fr);gap:2.2rem;align-items:start;margin:2rem 0 3rem}
    @media(max-width:960px){.lounge{grid-template-columns:1fr}}
    .scene{border:1px solid var(--hairline);background:#120d16}
    .scene svg{display:block;width:100%;height:auto}
    .dpanel{border:1px solid var(--hairline);background:var(--coal)}
    .dpanel section{padding:1.05rem 1.15rem;border-bottom:1px solid var(--hairline)}
    .dpanel section:last-child{border-bottom:none}
    .dpanel h3{font-size:.7rem;letter-spacing:.32em;text-transform:uppercase;color:var(--gold);margin:0 0 .55rem;font-weight:400}
    .drow{display:flex;align-items:center;gap:.6rem;padding:.42rem .1rem;border-top:1px solid rgba(200,151,90,.10);font-size:.95rem;cursor:pointer;color:var(--cream)}
    .drow:first-of-type{border-top:none}
    .drow:hover{background:rgba(200,151,90,.08)}
    .drow .mark{width:.9rem;color:var(--gold-bright)}
    .drow.off{color:var(--faint)}
    .dnote{color:var(--faint);font-size:.86rem;font-style:italic;line-height:1.6}
    @media (prefers-reduced-motion: no-preference){
      .l-flame{transform-box:fill-box;transform-origin:50% 100%;animation:lflick 2.8s ease-in-out infinite}
      .l-flame.f2{animation-delay:-.9s;animation-duration:2.2s}
      .l-flame.f3{animation-delay:-1.6s;animation-duration:1.8s}
      .l-glow{animation:lpulse 3.6s ease-in-out infinite}
      .l-smoke{animation:ldrift 9s ease-in-out infinite}
      .l-star{animation:ltwink 4.6s ease-in-out infinite}
      .l-star.s2{animation-delay:-1.5s}
      .l-star.s3{animation-delay:-3s}
      .l-fly{animation:ltwink 6.5s ease-in-out infinite}
      .l-fly.s2{animation-delay:-2.2s}
      .l-fly.s3{animation-delay:-4.4s}
    }
    @keyframes lflick{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.85) scaleX(1.05)}}
    @keyframes lpulse{0%,100%{opacity:.7}50%{opacity:1}}
    @keyframes ldrift{0%,100%{transform:translateY(0);opacity:.5}50%{transform:translateY(-9px);opacity:.85}}
    @keyframes ltwink{0%,100%{opacity:.2}50%{opacity:1}}
  </style>
  <main class="wrap" style="max-width:1220px">
    <section class="hero" style="padding:9vh 0 2vh">
      <p class="kicker">the cigar lounge &middot; your corner of the ecosystem</p>
      <h1>Pull up a <i>chair</i>.</h1>
      <p class="lede">The fire is lit and the good seat is yours. This room is built to take your
      things — art on the walls, bottles on the shelf, trophies where they belong. The add-ons
      below are just the start; the scene is made of slots.</p>
    </section>
    <section class="lounge">
      <div class="scene"><svg viewBox="0 0 1200 640" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A warm cigar lounge: a fire going, a wingback chair with a throw, whiskey poured, and a cat asleep on the rug">
        <defs>
          <linearGradient id="lwall" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#241b2c"/><stop offset="100%" stop-color="#181020"/>
          </linearGradient>
          <radialGradient id="lglow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="rgba(224,181,120,.32)"/><stop offset="100%" stop-color="rgba(224,181,120,0)"/>
          </radialGradient>
          <radialGradient id="lfire" cx="50%" cy="60%" r="55%">
            <stop offset="0%" stop-color="rgba(245,190,110,.85)"/><stop offset="55%" stop-color="rgba(224,120,60,.4)"/>
            <stop offset="100%" stop-color="rgba(224,120,60,0)"/>
          </radialGradient>
          <radialGradient id="lhearth" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="rgba(230,140,70,.22)"/><stop offset="100%" stop-color="rgba(230,140,70,0)"/>
          </radialGradient>
        </defs>
        <rect width="1200" height="470" fill="url(#lwall)"/>
        <rect y="52" width="1200" height="6" fill="#2c2135"/>
        <line y1="60" x2="1200" y2="60" stroke="rgba(200,151,90,.18)"/>
        <rect y="336" width="1200" height="6" fill="#342639"/>
        <rect y="342" width="1200" height="120" fill="#1e1524"/>
        <g fill="none" stroke="rgba(200,151,90,.13)">
          <rect x="24" y="356" width="96" height="92"/><rect x="140" y="356" width="96" height="92"/>
          <rect x="256" y="356" width="96" height="92"/><rect x="372" y="356" width="96" height="92"/>
          <rect x="488" y="356" width="96" height="92"/><rect x="616" y="356" width="96" height="92"/>
          <rect x="732" y="356" width="96" height="92"/><rect x="848" y="356" width="96" height="92"/>
          <rect x="964" y="356" width="96" height="92"/><rect x="1080" y="356" width="96" height="92"/>
        </g>
        <rect y="462" width="1200" height="10" fill="#241a22"/>
        <rect y="472" width="1200" height="168" fill="#150d12"/>
        <g stroke="#0e0810" stroke-width="2">
          <line y1="502" x2="1200" y2="502"/><line y1="534" x2="1200" y2="534"/>
          <line y1="568" x2="1200" y2="568"/><line y1="604" x2="1200" y2="604"/>
        </g>
        <g id="slot-window">
          <line x1="70" y1="82" x2="352" y2="82" stroke="#3a2417" stroke-width="5"/>
          <circle cx="66" cy="82" r="5" fill="#c8975a"/><circle cx="356" cy="82" r="5" fill="#c8975a"/>
          <rect x="108" y="96" width="204" height="248" fill="#0b1120" stroke="#c8975a" stroke-width="2"/>
          <circle cx="262" cy="152" r="30" fill="rgba(232,220,200,.1)"/>
          <circle cx="262" cy="152" r="21" fill="#e8dcc8"/>
          <circle cx="255" cy="146" r="4" fill="rgba(20,16,26,.15)"/><circle cx="268" cy="158" r="3" fill="rgba(20,16,26,.12)"/>
          <circle cx="138" cy="128" r="2.2" fill="#f0e6d6" class="l-star"/>
          <circle cx="176" cy="180" r="1.8" fill="#f0e6d6" class="l-star s2"/>
          <circle cx="150" cy="240" r="2" fill="#f0e6d6" class="l-star s3"/>
          <circle cx="230" cy="110" r="1.7" fill="#f0e6d6" class="l-star s2"/>
          <circle cx="290" cy="220" r="1.8" fill="#f0e6d6" class="l-star"/>
          <path d="M108,318 L150,296 L192,310 L246,290 L312,306 L312,344 L108,344 Z" fill="#131a2b"/>
          <circle cx="164" cy="312" r="1.6" fill="#e0b578"/><circle cx="258" cy="308" r="1.6" fill="#e0b578"/><circle cx="286" cy="318" r="1.4" fill="#e0b578"/>
          <line x1="210" y1="96" x2="210" y2="344" stroke="#c8975a" stroke-width="2"/>
          <line x1="108" y1="180" x2="312" y2="180" stroke="#c8975a" stroke-width="2"/>
          <line x1="108" y1="264" x2="312" y2="264" stroke="#c8975a" stroke-width="2"/>
          <rect x="98" y="344" width="224" height="10" fill="#3a2417" stroke="#c8975a"/>
          <path d="M84,88 C104,170 92,260 98,354 L126,354 C112,262 122,168 116,88 Z" fill="#331721" stroke="rgba(200,151,90,.3)"/>
          <path d="M336,88 C316,170 328,260 322,354 L294,354 C308,262 298,168 304,88 Z" fill="#331721" stroke="rgba(200,151,90,.3)"/>
          <path d="M92,210 q18,10 26,0 M328,210 q-18,10 -26,0" stroke="#c8975a" stroke-width="3" fill="none"/>
        </g>
        <g id="slot-records">
          <rect x="90" y="476" width="204" height="82" fill="#2c1a10" stroke="#c8975a"/>
          <rect x="86" y="470" width="212" height="8" fill="#3a2417" stroke="#c8975a"/>
          <line x1="192" y1="484" x2="192" y2="550" stroke="rgba(200,151,90,.4)"/>
          <circle cx="176" cy="516" r="3" fill="#c8975a"/><circle cx="208" cy="516" r="3" fill="#c8975a"/>
          <line x1="104" y1="558" x2="104" y2="576" stroke="#8d7f6f" stroke-width="4"/>
          <line x1="280" y1="558" x2="280" y2="576" stroke="#8d7f6f" stroke-width="4"/>
          <ellipse cx="150" cy="466" rx="36" ry="9" fill="#171017" stroke="#c8975a"/>
          <circle cx="150" cy="466" r="4" fill="#c8975a"/>
          <line x1="196" y1="456" x2="176" y2="466" stroke="#e0b578" stroke-width="2.5"/>
          <circle cx="198" cy="455" r="3" fill="#e0b578"/>
          <rect x="226" y="428" width="44" height="42" fill="#171017" stroke="#c8975a" transform="rotate(-7 248 470)"/>
          <circle cx="246" cy="447" r="12" fill="none" stroke="rgba(200,151,90,.5)" transform="rotate(-7 248 470)"/>
        </g>
        <g id="slot-frames">
          <rect x="952" y="118" width="112" height="112" fill="#171017" stroke="#c8975a" stroke-width="2"/>
          ${bigFrameInner}
          <rect x="1086" y="152" width="72" height="92" fill="#171017" stroke="#c8975a" stroke-width="2"/>
          ${smallFrameInner}
        </g>
        <g>
          <rect x="560" y="100" width="240" height="362" fill="#221724" stroke="rgba(200,151,90,.2)"/>
          <line x1="560" y1="100" x2="800" y2="100" stroke="rgba(200,151,90,.3)"/>
          <rect x="584" y="324" width="24" height="138" fill="#2c1f2b" stroke="rgba(200,151,90,.25)"/>
          <rect x="752" y="324" width="24" height="138" fill="#2c1f2b" stroke="rgba(200,151,90,.25)"/>
          <rect x="584" y="306" width="192" height="18" fill="#2c1f2b" stroke="rgba(200,151,90,.25)"/>
          <rect x="566" y="292" width="228" height="14" fill="#3a2417" stroke="#c8975a"/>
          <path d="M612,462 L612,364 Q680,320 748,364 L748,462 Z" fill="#0b0710"/>
          <path d="M612,388 Q680,346 748,388" fill="none" stroke="rgba(179,84,47,.35)" stroke-width="3"/>
          <rect x="588" y="462" width="184" height="12" fill="#2a2026" stroke="rgba(200,151,90,.25)"/>
        </g>
        <g data-slot="slot-frames">
          <rect x="622" y="126" width="116" height="146" fill="#171017" stroke="#c8975a" stroke-width="2"/>
          ${mantelInner}
        </g>
        <g id="slot-fire">
          <ellipse cx="680" cy="436" rx="62" ry="42" fill="url(#lfire)" class="l-glow"/>
          <rect x="634" y="440" width="92" height="10" rx="5" fill="#3a2417" transform="rotate(6 680 445)"/>
          <rect x="636" y="446" width="90" height="10" rx="5" fill="#2c1a10" transform="rotate(-7 680 451)"/>
          <path d="M680,446 C658,420 664,392 680,364 C696,392 702,420 680,446 Z" fill="#b3542f" opacity=".92" class="l-flame"/>
          <path d="M680,444 C668,426 672,406 680,388 C688,406 692,426 680,444 Z" fill="#e0b578" class="l-flame f2"/>
          <path d="M680,442 C675,432 676,420 680,410 C684,420 685,432 680,442 Z" fill="#f5e2b0" class="l-flame f3"/>
          <path d="M650,446 C642,432 644,420 652,408 C658,420 658,434 650,446 Z" fill="#b3542f" opacity=".8" class="l-flame f3"/>
          <path d="M710,446 C702,434 704,420 712,410 C718,422 718,436 710,446 Z" fill="#b3542f" opacity=".8" class="l-flame f2"/>
          <circle cx="664" cy="380" r="2" fill="#f2c47e" class="l-fly"/>
          <circle cx="694" cy="366" r="1.8" fill="#f2c47e" class="l-fly s2"/>
          <circle cx="680" cy="350" r="1.5" fill="#f2c47e" class="l-fly s3"/>
        </g>
        <g id="slot-shelf">
          <rect x="596" y="260" width="62" height="32" fill="#3a2417" stroke="#c8975a"/>
          <line x1="596" y1="270" x2="658" y2="270" stroke="rgba(200,151,90,.5)"/>
          <circle cx="627" cy="281" r="4.5" fill="none" stroke="#e0b578" stroke-width="1.5"/>
          <circle cx="700" cy="272" r="19" fill="#171017" stroke="#c8975a" stroke-width="2"/>
          <line x1="700" y1="272" x2="700" y2="260" stroke="#e0b578" stroke-width="2"/>
          <line x1="700" y1="272" x2="709" y2="277" stroke="#e0b578" stroke-width="2"/>
          <rect x="694" y="290" width="12" height="4" fill="#3a2417"/>
          <rect x="734" y="252" width="11" height="40" fill="#5C3D2E"/>
          <rect x="747" y="258" width="10" height="34" fill="#2C3E50"/>
          <rect x="759" y="254" width="9" height="38" fill="#8B6914" transform="rotate(7 763 292)"/>
        </g>
        <g id="slot-plant">
          <path d="M332,486 L398,486 L386,556 L344,556 Z" fill="#3a2417" stroke="#c8975a"/>
          <line x1="338" y1="500" x2="392" y2="500" stroke="rgba(200,151,90,.45)"/>
          <g stroke="#3f7a4f" stroke-width="4" fill="none" stroke-linecap="round">
            <path d="M365,486 C361,440 341,420 325,398"/>
            <path d="M365,486 C371,438 389,420 403,396"/>
            <path d="M365,486 C365,444 363,418 361,398"/>
            <path d="M365,486 C357,452 345,438 333,428"/>
          </g>
          <ellipse cx="323" cy="396" rx="8" ry="15" fill="#3f7a4f" transform="rotate(-32 323 396)"/>
          <ellipse cx="405" cy="394" rx="8" ry="15" fill="#3f7a4f" transform="rotate(28 405 394)"/>
          <ellipse cx="360" cy="392" rx="8" ry="16" fill="#3f7a4f"/>
          <ellipse cx="331" cy="426" rx="7" ry="13" fill="#3f7a4f" transform="rotate(-40 331 426)"/>
        </g>
        <g id="slot-lamp">
          <ellipse cx="450" cy="300" rx="120" ry="150" fill="url(#lglow)" class="l-glow"/>
          <path d="M418,212 L482,212 L468,258 L432,258 Z" fill="#c8975a" opacity=".95"/>
          <line x1="450" y1="258" x2="450" y2="508" stroke="#8d7f6f" stroke-width="5"/>
          <ellipse cx="450" cy="510" rx="32" ry="8" fill="#3a2417" stroke="#8d7f6f"/>
          <ellipse cx="450" cy="530" rx="105" ry="20" fill="rgba(224,181,120,.07)"/>
          <rect x="484" y="496" width="44" height="9" fill="#5C3D2E" stroke="rgba(200,151,90,.3)"/>
          <rect x="488" y="487" width="38" height="9" fill="#7a3b2a" stroke="rgba(200,151,90,.3)"/>
          <rect x="492" y="478" width="30" height="9" fill="#2C3E50" stroke="rgba(200,151,90,.3)"/>
        </g>
        <g id="slot-rug">
          <ellipse cx="880" cy="566" rx="310" ry="50" fill="#2a1518" stroke="#c8975a" stroke-width="2"/>
          <ellipse cx="880" cy="566" rx="248" ry="36" fill="none" stroke="rgba(200,151,90,.4)" stroke-dasharray="12 7"/>
          <rect x="742" y="556" width="18" height="18" fill="none" stroke="rgba(200,151,90,.4)" transform="rotate(45 751 565)"/>
          <rect x="1002" y="556" width="18" height="18" fill="none" stroke="rgba(200,151,90,.4)" transform="rotate(45 1011 565)"/>
          <rect x="872" y="588" width="16" height="16" fill="none" stroke="rgba(200,151,90,.35)" transform="rotate(45 880 596)"/>
        </g>
        <g id="slot-cat" transform="translate(772 546)">
          <path d="M30,6 C50,2 52,-16 38,-20" fill="none" stroke="#241c2b" stroke-width="7" stroke-linecap="round"/>
          <ellipse cx="0" cy="0" rx="34" ry="17" fill="#241c2b" stroke="rgba(200,151,90,.35)"/>
          <circle cx="-30" cy="-9" r="13" fill="#241c2b" stroke="rgba(200,151,90,.35)"/>
          <polygon points="-40,-18 -36,-28 -31,-19" fill="#241c2b"/>
          <polygon points="-27,-20 -22,-29 -18,-19" fill="#241c2b"/>
          <path d="M-37,-7 q3,3 6,0 M-28,-7 q3,3 6,0" stroke="#c9bba6" stroke-width="1.4" fill="none" stroke-linecap="round"/>
          <ellipse cx="-18" cy="4" rx="8" ry="5" fill="rgba(240,230,214,.18)"/>
        </g>
        <g>
          <path d="M856,436 L856,296 Q856,238 890,226 Q928,212 966,226 Q1000,238 1000,296 L1000,436 Z" fill="#4a2418" stroke="#c8975a" stroke-width="2"/>
          <g fill="rgba(224,181,120,.5)">
            <circle cx="892" cy="272" r="2"/><circle cx="928" cy="266" r="2"/><circle cx="964" cy="272" r="2"/>
            <circle cx="892" cy="312" r="2"/><circle cx="928" cy="308" r="2"/><circle cx="964" cy="312" r="2"/>
            <circle cx="892" cy="352" r="2"/><circle cx="928" cy="350" r="2"/><circle cx="964" cy="352" r="2"/>
          </g>
          <path d="M856,300 Q826,296 822,332 L822,396 Q822,416 844,420 L856,420 Z" fill="#3c1d13" stroke="#c8975a"/>
          <path d="M1000,300 Q1030,296 1034,332 L1034,396 Q1034,416 1012,420 L1000,420 Z" fill="#3c1d13" stroke="#c8975a"/>
          <rect x="818" y="396" width="48" height="52" rx="16" fill="#3c1d13" stroke="#c8975a"/>
          <rect x="990" y="396" width="48" height="52" rx="16" fill="#3c1d13" stroke="#c8975a"/>
          <rect x="858" y="414" width="140" height="42" rx="9" fill="#58301c" stroke="#c8975a"/>
          <rect x="852" y="452" width="152" height="22" fill="#331a10" stroke="#c8975a"/>
          <line x1="866" y1="474" x2="866" y2="498" stroke="#c8975a" stroke-width="4"/>
          <line x1="990" y1="474" x2="990" y2="498" stroke="#c8975a" stroke-width="4"/>
          <rect x="880" y="382" width="44" height="44" rx="4" fill="#7a3b2a" stroke="rgba(240,230,214,.3)" transform="rotate(-9 902 404)"/>
          <path d="M818,396 C820,376 846,370 862,384 L862,420 C842,424 826,416 820,406 Z" fill="#8a4630" stroke="rgba(240,230,214,.25)"/>
          <g stroke="rgba(240,230,214,.35)" stroke-width="1.4" fill="none">
            <path d="M824,388 C836,380 852,380 860,388"/>
            <path d="M822,400 C834,392 852,392 861,399"/>
          </g>
          <g stroke="#8a4630" stroke-width="2">
            <line x1="824" y1="418" x2="824" y2="426"/><line x1="832" y1="421" x2="832" y2="429"/>
            <line x1="840" y1="423" x2="840" y2="431"/><line x1="848" y1="424" x2="848" y2="432"/>
          </g>
        </g>
        <g>
          <rect x="872" y="502" width="118" height="34" rx="10" fill="#4a2418" stroke="#c8975a"/>
          <line x1="878" y1="519" x2="984" y2="519" stroke="rgba(200,151,90,.35)"/>
          <line x1="884" y1="536" x2="884" y2="552" stroke="#c8975a" stroke-width="3"/>
          <line x1="978" y1="536" x2="978" y2="552" stroke="#c8975a" stroke-width="3"/>
        </g>
        <g>
          <ellipse cx="1096" cy="408" rx="48" ry="11" fill="#3a2417" stroke="#c8975a"/>
          <line x1="1096" y1="419" x2="1096" y2="500" stroke="#8d7f6f" stroke-width="5"/>
          <ellipse cx="1096" cy="502" rx="24" ry="6" fill="#3a2417" stroke="#8d7f6f"/>
        </g>
        <g id="slot-whiskey">
          <rect x="1052" y="376" width="26" height="26" fill="rgba(20,12,16,.4)" stroke="#f0e6d6" stroke-width="2"/>
          <rect x="1053" y="388" width="24" height="13" fill="#b3542f" opacity=".9"/>
          <rect x="1058" y="380" width="9" height="9" fill="none" stroke="rgba(240,230,214,.7)"/>
          <path d="M1088,402 L1088,374 Q1088,368 1094,368 L1094,360 L1104,360 L1104,368 Q1110,368 1110,374 L1110,402 Z" fill="rgba(179,84,47,.45)" stroke="#f0e6d6" stroke-width="1.6"/>
          <rect x="1095" y="352" width="8" height="8" fill="#c8975a"/>
        </g>
        <g id="slot-smoke">
          <ellipse cx="1122" cy="404" rx="17" ry="5.5" fill="#171017" stroke="#8d7f6f"/>
          <rect x="1104" y="390" width="38" height="7" rx="3.5" fill="#5C3D2E" transform="rotate(-12 1104 394)"/>
          <rect x="1120" y="388" width="7" height="7" fill="#c8975a" transform="rotate(-12 1123 391)"/>
          <circle cx="1141" cy="385" r="3.2" fill="#ff9b52"/>
          <g transform="translate(1142 380)"><g class="l-smoke">
            <path d="M0,0 C-12,-28 10,-46 -4,-74 C-14,-92 4,-106 -2,-120" fill="none" stroke="rgba(224,181,120,.5)" stroke-width="3" stroke-linecap="round"/>
            <path d="M8,-8 C20,-32 -2,-52 12,-78" fill="none" stroke="rgba(224,181,120,.28)" stroke-width="2.5" stroke-linecap="round"/>
          </g></g>
        </g>
        <ellipse data-slot="slot-fire" cx="680" cy="524" rx="230" ry="46" fill="url(#lhearth)" class="l-glow"/>
        <circle cx="520" cy="330" r="1.6" fill="#f2c47e" class="l-fly"/>
        <circle cx="475" cy="380" r="1.4" fill="#f2c47e" class="l-fly s2"/>
        <circle cx="840" cy="300" r="1.5" fill="#f2c47e" class="l-fly s3"/>
      </svg></div>
      <aside class="dpanel">
        <section>
          <h3>Decorate</h3>
          <div id="decorList"></div>
        </section>
        <section>
          <h3>Bring your own</h3>
          <p class="dnote">Every piece in this room is a slot. Soon you will hang your own art,
          shelve your own bottles, and pin the bands of cigars you have loved — straight from
          your <a href="/revolucion/journal">journal</a> and <a href="/revolucion/humidor">humidor</a>.</p>
        </section>
      </aside>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">through the door</p></div>
      <div class="hexgallery">
        ${hexCell('journal', 'the journal', '/revolucion/journal')}
        ${hexCell('cigars', 'the catalog', '/revolucion/cigars')}
        ${hexCell('humidor', 'the humidor', '/revolucion/humidor')}
        ${hexCell('community', 'the circle', '/revolucion/community')}
      </div>
    </section>
  </main>
  <script>
  (function(){
    var SLOTS = [
      { id: 'slot-fire',    label: 'A fire going' },
      { id: 'slot-lamp',    label: 'Reading lamp' },
      { id: 'slot-window',  label: 'Night window' },
      { id: 'slot-rug',     label: 'Rug' },
      { id: 'slot-cat',     label: 'The lounge cat' },
      { id: 'slot-whiskey', label: 'Whiskey, neat-ish' },
      { id: 'slot-smoke',   label: 'A cigar going' },
      { id: 'slot-frames',  label: 'Wall art' },
      { id: 'slot-shelf',   label: 'Mantel keepsakes' },
      { id: 'slot-plant',   label: 'Plant' },
      { id: 'slot-records', label: 'Record console' }
    ];
    var KEY = 'rev:lounge:decor';
    var on = {};
    try { on = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch(e){ on = {}; }
    SLOTS.forEach(function(s){ if (!(s.id in on)) on[s.id] = true; });
    function apply(){
      SLOTS.forEach(function(s){
        // a slot may have overlay pieces outside its group (data-slot),
        // e.g. the hearth glow painted above the rug — hide both together
        var nodes = document.querySelectorAll('#' + s.id + ', [data-slot="' + s.id + '"]');
        for (var i = 0; i < nodes.length; i++) nodes[i].style.display = on[s.id] ? '' : 'none';
      });
      try { localStorage.setItem(KEY, JSON.stringify(on)); } catch(e){}
      var list = document.getElementById('decorList');
      list.innerHTML = '';
      SLOTS.forEach(function(s){
        var d = document.createElement('div');
        d.className = 'drow' + (on[s.id] ? '' : ' off');
        d.innerHTML = '<span class="mark">' + (on[s.id] ? '\\u25a0' : '\\u25a1') + '</span>' + s.label;
        d.addEventListener('click', function(){ on[s.id] = !on[s.id]; apply(); });
        list.appendChild(d);
      });
    }
    apply();
  })();
  </script>`)

  return [
    { segments: ['revolucion'], label: 'Revolución', html: home },
    { segments: ['revolucion', 'lounge'], label: 'The Cigar Lounge', html: lounge },
    { segments: ['revolucion', 'journal'], label: 'The Journal', html: journal },
    { segments: ['revolucion', 'experience'], label: 'The Experience', html: experience },
    { segments: ['revolucion', 'cigars'], label: 'The Catalog', html: cigars },
    { segments: ['revolucion', 'flavor-wheel'], label: 'The Flavor Wheel', html: wheel },
    { segments: ['revolucion', 'discovery'], label: 'Discovery', html: discovery },
    { segments: ['revolucion', 'community'], label: 'The Circle', html: community },
    { segments: ['revolucion', 'insights'], label: 'For the Makers', html: insights },
    { segments: ['revolucion', 'collaborations'], label: 'Named Experiences', html: collaborations },
    { segments: ['revolucion', 'humidor'], label: 'The Humidor', html: humidor },
    { segments: ['revolucion', 'mission'], label: 'The Manifesto', html: mission },
  ]
}

// ─── main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // --preview [dir]: write the pages as standalone HTML (chrome.css inlined)
  // for local eyeballing — no bridge, no host writes.
  const pv = process.argv.indexOf('--preview')
  if (pv >= 0) {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const dir = process.argv[pv + 1] ?? 'site-preview'
    mkdirSync(dir, { recursive: true })
    // Synthetic art: every key resolves so image layout is previewable
    // offline; refs are then swapped for an inline placeholder graphic.
    const fakeSig = 'ab'.repeat(32)
    const fakeArt = new Proxy({}, { get: () => fakeSig }) as Record<string, string | undefined>
    const placeholder = 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#2a1c26"/><polygon points="100,38 154,69 154,131 100,162 46,131 46,69" fill="none" stroke="#c8975a" stroke-width="3"/><circle cx="100" cy="100" r="14" fill="#b3542f"/></svg>')
    for (const p of buildPages('PREVIEW', fakeArt)) {
      let html = p.html.replace('<link rel="stylesheet" href="resource:PREVIEW/chrome.css">', `<style>${CHROME_CSS}</style>`)
      html = html.split(`resource:${fakeSig}/art.png`).join(placeholder)
      writeFileSync(`${dir}/${p.segments.join('-')}.html`, html)
      console.log(`[site] preview → ${dir}/${p.segments.join('-')}.html`)
    }
    return
  }

  // Preflight — cheap op, confirms relay + renderer.
  const pre = await send({ op: 'layer-at', segments: ['revolucion'] })
  if (!pre.ok) {
    console.error(`[site] ABORT: bridge not ready (${pre.error}). Open localhost:4250/?claudeBridge=1 and re-run.`)
    process.exit(1)
  }

  // 0a. Tiles first: make sure the 'lounge' cell exists before its page.
  const rootLayer = pre.data as { name?: string; children?: unknown }
  const childSigs = Array.isArray(rootLayer?.children) ? rootLayer.children.map(String) : []
  const childNames: string[] = []
  for (const sig of childSigs) {
    const inf = await send({ op: 'inflate', cell: sig })
    const nm = typeof (inf?.data as { name?: string })?.name === 'string' ? (inf.data as { name: string }).name.trim() : ''
    if (nm) childNames.push(nm)
  }
  if (!childNames.includes('lounge')) {
    console.log(`[site] adding lounge cell (current children: ${childNames.join(', ')})`)
    const up = await send({ op: 'update', segments: ['revolucion'], layer: { name: rootLayer?.name ?? 'revolucion', children: [...childNames, 'lounge'] } })
    if (!up.ok) { console.error(`[site] lounge cell FAIL: ${up.error}`); process.exit(1) }
    await send({ op: 'update', segments: ['revolucion', 'lounge'], layer: { name: 'lounge' } })
    await send({ op: 'note-add', segments: ['revolucion'], cell: 'lounge', text: 'The cigar lounge — a decorated room of slots you dress yourself. Your own add-ons hang here: art, bottles, bands of cigars you have loved.' })
  }

  // 0b. Tile-art sigs — the site reuses the hive's own sig-addressed imagery
  // (resource:<sig> refs, closure-carried). Harvested TWO levels deep so pages
  // can hang child art too: wall frames, hex galleries, card thumbnails.
  const namesAt = async (segments: string[]): Promise<string[]> => {
    const layer = await send({ op: 'layer-at', segments })
    const sigs: string[] = layer.ok && Array.isArray(layer.data?.children) ? layer.data.children.map(String) : []
    const names: string[] = []
    for (const sig of sigs) {
      const inf = await send({ op: 'inflate', cell: sig })
      const nm = typeof (inf?.data as { name?: string })?.name === 'string' ? (inf.data as { name: string }).name.trim() : ''
      if (nm) names.push(nm)
    }
    return names
  }
  const artOf = async (segments: string[]): Promise<string | undefined> => {
    const ins = await send({ op: 'inspect', segments })
    const sig = ins?.ok ? (ins.data as { small?: { image?: string } })?.small?.image : undefined
    return typeof sig === 'string' && /^[0-9a-f]{64}$/.test(sig) ? sig : undefined
  }
  const art: Record<string, string | undefined> = {}
  const tops = childNames.includes('lounge') ? childNames : [...childNames, 'lounge']
  for (const c of tops) {
    art[c] = await artOf(['revolucion', c])
    for (const k of await namesAt(['revolucion', c])) {
      art[`${c}/${k}`] = await artOf(['revolucion', c, k])
    }
  }
  console.log(`[site] art resolved: ${Object.values(art).filter(Boolean).length}/${Object.keys(art).length} cells`)

  // 1. Chrome stylesheet — minted once, dedupes by signature.
  const chrome = await send({ op: 'put-resource', text: CHROME_CSS })
  if (!chrome.ok) { console.error(`[site] chrome.css FAIL: ${chrome.error}`); process.exit(1) }
  const chromeSig = chrome.data.sig as string
  console.log(`[site] chrome.css → ${chromeSig.slice(0, 12)}… (${chrome.data.bytes} bytes)`)

  // 2. Pages: put-resource + decoration-add per cell.
  const pages = buildPages(chromeSig, art)
  const written: Array<{ path: string; htmlSig: string; decoSig: string }> = []
  for (const p of pages) {
    const route = '/' + p.segments.join('/')
    const put = await send({ op: 'put-resource', text: p.html })
    if (!put.ok) { console.error(`[site] ${route} put FAIL: ${put.error}`); process.exit(1) }
    const htmlSig = put.data.sig as string
    const deco = await send({
      op: 'decoration-add',
      segments: p.segments,
      kind: 'visual:website:page',
      appliesTo: p.segments,
      payload: { htmlSig, icon: 'local_fire_department', label: p.label, order: 0, createdAt: Date.now() },
      mark: 'persistent',
      replaceKind: true,
    })
    if (!deco.ok) { console.error(`[site] ${route} decoration FAIL: ${deco.error}`); process.exit(1) }
    written.push({ path: route, htmlSig, decoSig: deco.data.sig })
    console.log(`[site] ${route} → html ${htmlSig.slice(0, 12)}… deco ${String(deco.data.sig).slice(0, 12)}…${deco.data.unchanged ? ' (unchanged)' : ''}`)
  }

  // 3. Verify by read-back: decorations slot holds a visual:website:page
  //    record with our htmlSig, and the HTML bytes round-trip.
  let pass = 0, fail = 0
  for (const w of written) {
    const segments = w.path.slice(1).split('/')
    const layer = await send({ op: 'layer-at', segments })
    const decoSigs: string[] = Array.isArray(layer?.data?.decorations) ? layer.data.decorations : []
    let found = false
    for (const sig of decoSigs) {
      const res = await send({ op: 'get-resource', sig })
      if (!res.ok) continue
      try {
        const rec = JSON.parse(res.data.text)
        if (rec.kind === 'visual:website:page' && rec.payload?.htmlSig === w.htmlSig) { found = true; break }
      } catch { /* not JSON */ }
    }
    const html = await send({ op: 'get-resource', sig: w.htmlSig })
    const roundTrip = html.ok && typeof html.data.text === 'string' && html.data.text.includes('REVOLUCIÓN')
    if (found && roundTrip) pass++
    else { fail++; console.error(`[verify] FAIL ${w.path} — decoration:${found} html:${roundTrip}`) }
  }
  console.log(`[site] verify: ${pass}/${written.length} pages confirmed, ${fail} failed`)
  console.log(`[site] DONE — toggle the global /website view mode on /revolucion to see it mount.`)
}

main().catch(err => { console.error(err); process.exit(1) })
