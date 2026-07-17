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
@media(max-width:700px){.nav .links{display:none}.hero{padding:11vh 0 8vh}}
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
          <p>Ten families, sixty-three flavors — one shared tasting language. Spin it.</p></a>
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
  <main class="wrap">
    <section class="hero">
      <p class="kicker">the journal · the entry point</p>
      <h1>Tell it like it <i>was</i>.</h1>
      <p class="lede">Not a form. A moment, captured as experience tiles — the cigar, what you
      tasted, what you drank, where you were, who you were with, and how it felt.</p>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">speak your moment</p></div>
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
        <div class="card"><h3>Cigar</h3><p>Brand, line, name, vitola, wrapper, origin, strength.</p></div>
        <div class="card"><h3>Flavors</h3><p>Tap what you tasted on the <a href="/revolucion/flavor-wheel">wheel</a>; slide the intensity.</p></div>
        <div class="card"><h3>Ratings</h3><p>Draw, burn, construction, flavor, overall.</p></div>
        <div class="card"><h3>Pairings</h3><p>Coffee, whiskey, rum, wine, beer, tea, food — what stood beside it.</p></div>
        <div class="card"><h3>Occasion</h3><p>The celebration, the quiet evening, the milestone.</p></div>
        <div class="card"><h3>Photos</h3><p>The band, the ash, the view.</p></div>
      </div>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">what it becomes</p></div>
      <div class="cards">
        <div class="card"><h3>My Moments</h3><p>Your timeline of experiences — every entry a scene you can revisit.</p></div>
        <div class="card"><h3>Favorites</h3><p>The moments and cigars you keep coming back to.</p></div>
        <div class="card"><h3>Stats</h3><p>Your patterns: most-tasted flavors, favorite pairings, when and where you smoke best.</p></div>
      </div>
      <p class="muted">And quietly, with your consent, every entry teaches
      <a href="/revolucion/discovery">discovery</a> what you love and shows
      <a href="/revolucion/insights">the makers</a> who they serve.</p>
    </section>
  </main>`)

  const experience = P('/revolucion/experience', 'The Experience', `
  <main class="wrap">
    <section class="hero">
      <p class="kicker">the experience · a spoken grammar</p>
      <h1>Say it, and it <i>appears</i>.</h1>
      <p class="lede">Forty-one keywords make up the language of moments. Each one is a tile
      with a predefined look and behavior — a crafted world, not an automated one.</p>
    </section>

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
      <p class="kicker">the catalog · written by smoking</p>
      <h1>The community writes<br>the <i>catalog</i>.</h1>
      <p class="lede">Every cigar logged in a journal joins it — brand, line, vitola, wrapper,
      origin, strength. No committee, no gatekeeping. If it was smoked and it mattered, it's here.</p>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">the dimensions</p></div>
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
    .stbox{padding:.85rem .95rem;background:var(--night);min-height:6rem}
    #stFlv{cursor:pointer}
    #stFlv:hover{background:#201927}
    .stkick{font-size:.6rem;letter-spacing:.3em;text-transform:uppercase;opacity:.75}
    .stname{font-size:1.12rem;margin-top:.35rem;line-height:1.15}
    .stname.big{font-size:1.55rem;color:var(--cream)}
    .stact{margin-top:.55rem;font-size:.74rem;letter-spacing:.1em;color:var(--faint);text-transform:uppercase}
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
    var R_RAISE = 22; // how far the notch flavor lifts above the rim
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
        '<div class="stact' + (on ? ' on' : '') + '">' + (on ? '\\u25a0 selected \\u2014 tap to remove' : '\\u25a1 tap to select') + '</div>';
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
          var rIn = atNotch ? R_FLV - 8 : R_FLV;
          var rOut = atNotch ? R_OUT + R_RAISE : R_OUT;
          var op = atNotch ? 1 : (sel ? 1 : (focused ? .8 : .5));
          // ink + outline that read ON THIS family's fill — cream ink on the
          // light families (Sweet, Cream & Bread, Fruit…) is unreadable, so
          // dark:true families always mark selection with dark ink/stroke
          var ink = fm.dark ? '#241c14' : '#f0e6d6';
          var fp = el('path', { d: arcPath(rIn, rOut, atNotch ? f0 - .4 : f0, atNotch ? f1 + .4 : f1), fill: fm.color, opacity: op, 'class': 'flv' }, rot);
          if (atNotch) { fp.setAttribute('stroke', ink); fp.setAttribute('stroke-width', '3'); }
          else if (sel) { fp.setAttribute('stroke', ink); fp.setAttribute('stroke-width', '2.5'); }
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
        svg.classList.add('dragging');
        try { svg.setPointerCapture(ev.pointerId); } catch(e){}
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
        <div class="card"><span class="num">01</span><h3>For You</h3>
          <p>Flavor-profile similarity against your own entries — cigars whose tasted flavors
          overlap what you already love.</p></div>
        <div class="card"><span class="num">02</span><h3>By Experience</h3>
          <p>"I'm in the mood for a reflection experience." Ask for the evening you want;
          we find the leaf that fits it.</p></div>
        <div class="card"><span class="num">03</span><h3>Kindred Smokers</h3>
          <p>People whose palates and moments rhyme with yours — connection, not just products.</p></div>
        <div class="card"><span class="num">04</span><h3>The Knowledge Graph</h3>
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
        <div class="card"><h3>Shared Moments</h3>
          <p>Journal entries members choose to share — scenes, not reviews. The patio, the
          golden hour, the conversation that would not stop.</p></div>
        <div class="card"><h3>The Vocabulary</h3>
          <p>Experience terms that emerge organically from real journals. Because they grow from
          lived data they feel authentic — and people start speaking them to each other.</p></div>
        <div class="card"><h3>Circles</h3>
          <p>Herf nights, lounge meetups, tasting circles — where the vocabulary is spoken
          out loud and new friendships get lit.</p></div>
      </div>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">first light — for newcomers</p></div>
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
        <div class="card"><h3>Occasion Trends</h3>
          <p>"This blend is most often chosen for quiet evening reflection." Now you know what
          its marketing should sound like — and what its band should feel like.</p></div>
        <div class="card"><h3>Pairing Performance</h3>
          <p>"Often exceeds expectations with coffee, but underperforms with whisky pairings."
          A tasting-room fix no focus group would ever surface.</p></div>
        <div class="card"><h3>Newcomer Experience</h3>
          <p>"New smokers feel intimidated — the pepper is a surprise." Feedback that refines a
          blend's introduction, not its soul.</p></div>
        <div class="card"><h3>Blend Feedback</h3>
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
      <p class="kicker">the humidor · patience, kept</p>
      <h1>What rests in the dark<br>gets <i>better</i>.</h1>
      <p class="lede">Your collection, kept and aging — with the journal one tap away when a
      stick finally comes off the shelf.</p>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">three shelves</p></div>
      <div class="cards">
        <div class="card"><h3>My Collection</h3>
          <p>What you hold now — counts, dates acquired, and the entries each cigar has already earned.</p></div>
        <div class="card"><h3>Wishlist</h3>
          <p>What <a href="/revolucion/discovery">discovery</a> has convinced you to try next.</p></div>
        <div class="card"><h3>Aging</h3>
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
  </style>
  <main class="wrap" style="max-width:1220px">
    <section class="hero" style="padding:9vh 0 2vh">
      <p class="kicker">the cigar lounge &middot; your corner of the ecosystem</p>
      <h1>Pull up a <i>chair</i>.</h1>
      <p class="lede">This room is built to take your things — art on the walls, bottles on the shelf,
      trophies where they belong. The add-ons below are just the start; the scene is made of slots.</p>
    </section>
    <section class="lounge">
      <div class="scene"><svg viewBox="0 0 1200 620" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="lglow" cx="50%" cy="35%" r="65%">
            <stop offset="0%" stop-color="rgba(224,181,120,.34)"/><stop offset="100%" stop-color="rgba(224,181,120,0)"/>
          </radialGradient>
          <linearGradient id="lwall" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#221a29"/><stop offset="100%" stop-color="#170f1c"/>
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="1200" height="440" fill="url(#lwall)"/>
        <rect x="0" y="440" width="1200" height="180" fill="#140d12"/>
        <line x1="0" y1="440" x2="1200" y2="440" stroke="rgba(200,151,90,.3)"/>
        <line x1="0" y1="392" x2="1200" y2="392" stroke="rgba(200,151,90,.12)"/>
        <g id="slot-window">
          <rect x="86" y="86" width="220" height="240" fill="#0c1220" stroke="#c8975a" stroke-width="2"/>
          <line x1="196" y1="86" x2="196" y2="326" stroke="#c8975a"/><line x1="86" y1="206" x2="306" y2="206" stroke="#c8975a"/>
          <circle cx="252" cy="140" r="24" fill="#e0b578" opacity=".9"/>
          <circle cx="128" cy="120" r="2.5" fill="#f0e6d6"/><circle cx="160" cy="168" r="2" fill="#f0e6d6"/><circle cx="118" y="0" cy="250" r="2" fill="#f0e6d6"/>
        </g>
        <g id="slot-shelf">
          <rect x="360" y="120" width="230" height="8" fill="#3a2417" stroke="#c8975a" stroke-width="1"/>
          <rect x="376" y="76" width="14" height="44" fill="#5C3D2E"/><rect x="394" y="82" width="12" height="38" fill="#8B6914"/>
          <rect x="410" y="72" width="15" height="48" fill="#4E2E1E"/><rect x="429" y="84" width="12" height="36" fill="#2C3E50"/>
          <rect x="470" y="90" width="86" height="30" fill="#3a2417" stroke="#c8975a"/>
          <circle cx="513" cy="105" r="5" fill="#e0b578"/>
        </g>
        <g id="slot-frames">
          <rect x="950" y="110" width="110" height="110" fill="#171017" stroke="#c8975a" stroke-width="2"/>
          <g transform="translate(1005 165)">
            <circle r="36" fill="none" stroke="#5C3D2E" stroke-width="13"/>
            <circle r="36" fill="none" stroke="#C0392B" stroke-width="13" stroke-dasharray="34 193"/>
            <circle r="36" fill="none" stroke="#D4A017" stroke-width="13" stroke-dasharray="30 197" stroke-dashoffset="-40"/>
            <circle r="36" fill="none" stroke="#27AE60" stroke-width="13" stroke-dasharray="26 201" stroke-dashoffset="-78"/>
            <circle r="14" fill="#171017"/>
          </g>
          <rect x="1080" y="150" width="70" height="90" fill="#171017" stroke="#c8975a" stroke-width="2"/>
          <rect x="1100" y="180" width="30" height="30" fill="#c8975a" transform="rotate(45 1115 195)"/>
        </g>
        <g id="slot-lamp">
          <ellipse cx="470" cy="230" rx="150" ry="170" fill="url(#lglow)"/>
          <path d="M436,150 L504,150 L488,196 L452,196 Z" fill="#c8975a" opacity=".9"/>
          <line x1="470" y1="196" x2="470" y2="452" stroke="#8d7f6f" stroke-width="5"/>
          <ellipse cx="470" cy="456" rx="34" ry="8" fill="#3a2417" stroke="#8d7f6f"/>
        </g>
        <g id="slot-rug">
          <ellipse cx="700" cy="530" rx="290" ry="52" fill="#241318" stroke="#c8975a" stroke-width="2"/>
          <ellipse cx="700" cy="530" rx="220" ry="36" fill="none" stroke="rgba(200,151,90,.4)"/>
        </g>
        <g id="base-chair">
          <path d="M570,420 L570,250 Q570,215 610,215 L760,215 Q800,215 800,250 L800,420 Z" fill="#3a2417" stroke="#c8975a" stroke-width="2"/>
          <path d="M560,330 Q535,330 535,362 L535,430 Q535,452 560,452 L575,452 L575,330 Z" fill="#2c1a10" stroke="#c8975a"/>
          <path d="M810,330 Q835,330 835,362 L835,430 Q835,452 810,452 L795,452 L795,330 Z" fill="#2c1a10" stroke="#c8975a"/>
          <rect x="575" y="360" width="220" height="70" fill="#2c1a10" stroke="#c8975a"/>
          <rect x="575" y="430" width="220" height="24" fill="#241309" stroke="#c8975a"/>
          <line x1="596" y1="454" x2="596" y2="482" stroke="#c8975a" stroke-width="4"/>
          <line x1="774" y1="454" x2="774" y2="482" stroke="#c8975a" stroke-width="4"/>
        </g>
        <g id="base-table">
          <ellipse cx="905" cy="392" rx="58" ry="12" fill="#3a2417" stroke="#c8975a"/>
          <line x1="905" y1="404" x2="905" y2="490" stroke="#8d7f6f" stroke-width="5"/>
          <ellipse cx="905" cy="492" rx="26" ry="6" fill="#3a2417" stroke="#8d7f6f"/>
          <ellipse cx="884" cy="382" rx="17" ry="5" fill="#171017" stroke="#8d7f6f"/>
          <rect x="884" y="368" width="34" height="7" rx="0" fill="#3a2417" stroke="#e0b578" stroke-width="1" transform="rotate(-14 884 372)"/>
          <circle cx="882" cy="366" r="3.4" fill="#ff9b52"/>
        </g>
        <g id="slot-smoke">
          <path d="M881,358 C868,330 900,312 886,284 C874,258 902,244 894,220" fill="none" stroke="rgba(224,181,120,.55)" stroke-width="3" stroke-linecap="round"/>
          <path d="M893,352 C906,326 882,306 897,282" fill="none" stroke="rgba(224,181,120,.32)" stroke-width="2.5" stroke-linecap="round"/>
        </g>
        <g id="slot-whiskey">
          <rect x="922" y="356" width="26" height="26" fill="none" stroke="#f0e6d6" stroke-width="2"/>
          <rect x="923" y="368" width="24" height="13" fill="#b3542f" opacity=".85"/>
          <rect x="928" y="360" width="9" height="9" fill="none" stroke="rgba(240,230,214,.7)"/>
        </g>
        <g id="slot-plant">
          <path d="M1108,468 L1152,468 L1144,516 L1116,516 Z" fill="#3a2417" stroke="#c8975a"/>
          <path d="M1130,468 C1130,430 1112,420 1104,398 M1130,468 C1130,424 1148,418 1158,394 M1130,468 C1130,436 1130,414 1130,396" stroke="#27AE60" stroke-width="4" fill="none" stroke-linecap="round"/>
        </g>
        <g id="slot-records">
          <rect x="96" y="430" width="180" height="60" fill="#3a2417" stroke="#c8975a"/>
          <line x1="96" y1="452" x2="276" y2="452" stroke="rgba(200,151,90,.5)"/>
          <circle cx="146" cy="420" r="26" fill="#171017" stroke="#c8975a"/>
          <circle cx="146" cy="420" r="8" fill="#c8975a"/>
          <line x1="196" y1="404" x2="216" y2="424" stroke="#e0b578" stroke-width="3"/>
          <line x1="108" y1="490" x2="108" y2="510" stroke="#8d7f6f" stroke-width="4"/>
          <line x1="264" y1="490" x2="264" y2="510" stroke="#8d7f6f" stroke-width="4"/>
        </g>
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
  </main>
  <script>
  (function(){
    var SLOTS = [
      { id: 'slot-lamp',    label: 'Reading lamp' },
      { id: 'slot-window',  label: 'Night window' },
      { id: 'slot-rug',     label: 'Rug' },
      { id: 'slot-whiskey', label: 'Whiskey, neat-ish' },
      { id: 'slot-smoke',   label: 'A cigar going' },
      { id: 'slot-frames',  label: 'Wall art' },
      { id: 'slot-shelf',   label: 'Shelf + humidor' },
      { id: 'slot-plant',   label: 'Plant' },
      { id: 'slot-records', label: 'Record console' }
    ];
    var KEY = 'rev:lounge:decor';
    var on = {};
    try { on = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch(e){ on = {}; }
    SLOTS.forEach(function(s){ if (!(s.id in on)) on[s.id] = true; });
    function apply(){
      SLOTS.forEach(function(s){
        var g = document.getElementById(s.id);
        if (g) g.style.display = on[s.id] ? '' : 'none';
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

  // 0b. Tile-art sigs for the home thumbnails — the site reuses the hive's
  // own sig-addressed imagery (resource:<sig> refs, closure-carried).
  const ART_CELLS = ['journal', 'experience', 'cigars', 'flavor-wheel', 'discovery', 'community', 'insights', 'collaborations', 'humidor', 'lounge']
  const art: Record<string, string | undefined> = {}
  for (const c of ART_CELLS) {
    const ins = await send({ op: 'inspect', segments: ['revolucion', c] })
    const sig = ins?.ok ? (ins.data as { small?: { image?: string } })?.small?.image : undefined
    if (typeof sig === 'string' && /^[0-9a-f]{64}$/.test(sig)) art[c] = sig
  }
  console.log(`[site] art thumbnails resolved: ${Object.values(art).filter(Boolean).length}/${ART_CELLS.length}`)

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
