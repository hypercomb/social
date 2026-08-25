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
import { EARN_OF, EARN_RULES, EMBERS_JS, HOUSE_ITEMS, OCHE_NOTE, SALE_ITEMS, STORE_ITEMS } from './lounge3d/store-items.js'

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
  --foil:linear-gradient(105deg,#9a6f3c 0%,#e0b578 32%,#f4dfae 50%,#c8975a 68%,#8a5c33 100%);
  --serif:Georgia,'Palatino Linotype',Palatino,'Times New Roman',serif;
}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{background:var(--night);color:var(--cream);font-family:var(--serif);
  font-size:17px;line-height:1.75;-webkit-font-smoothing:antialiased;
  background-image:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='.05'/%3E%3C/svg%3E"),
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='138' height='120'%3E%3Cpolygon points='69,14 103,33 103,71 69,90 35,71 35,33' fill='none' stroke='rgba(200,151,90,.055)' stroke-width='1'/%3E%3C/svg%3E"),
    radial-gradient(1200px 700px at 85% -10%,rgba(200,151,90,.10),transparent 60%),
    radial-gradient(900px 600px at -10% 110%,rgba(179,84,47,.08),transparent 55%),
    radial-gradient(1400px 900px at 50% 120%,rgba(36,28,43,.9),transparent 70%)}
main{position:relative;z-index:1}
/* the room's air — two slow ember glows drifting behind everything */
.atmo{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.atmo::before,.atmo::after{content:'';position:absolute;border-radius:50%;filter:blur(60px)}
.atmo::before{width:44vw;height:44vw;left:-14vw;bottom:-18vw;
  background:radial-gradient(circle,rgba(179,84,47,.10),transparent 65%)}
.atmo::after{width:38vw;height:38vw;right:-10vw;top:-12vw;
  background:radial-gradient(circle,rgba(200,151,90,.09),transparent 65%)}
@media (prefers-reduced-motion: no-preference){
  .atmo::before{animation:embers 46s ease-in-out infinite alternate}
  .atmo::after{animation:embers 38s ease-in-out infinite alternate-reverse}
  @keyframes embers{0%{transform:translate(0,0) scale(1)}100%{transform:translate(6vw,-5vh) scale(1.14)}}
}
a{color:var(--gold-bright);text-decoration:none;transition:color .18s ease}
a:hover{color:var(--cream)}
::selection{background:var(--gold);color:var(--night)}

/* ── chrome ── */
.nav{position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:1.6rem;
  padding:.95rem 5vw;background:rgba(20,16,23,.9);backdrop-filter:blur(10px)}
.nav::after{content:'';position:absolute;left:0;right:0;bottom:0;height:1px;
  background:linear-gradient(90deg,transparent,rgba(200,151,90,.5) 18%,rgba(200,151,90,.5) 82%,transparent)}
.nav .wordmark{display:flex;align-items:center;gap:.7rem;font-size:1.05rem;letter-spacing:.34em;
  color:var(--gold);white-space:nowrap}
.nav .wordmark em{font-style:normal;color:var(--cream-dim)}
.nav .wordmark::before{content:'';width:.85rem;height:.95rem;flex:none;
  background:var(--foil);clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)}
.nav .links{margin-left:auto;display:flex;flex-wrap:wrap;gap:1.3rem;font-size:.78rem;
  letter-spacing:.16em;text-transform:uppercase}
.nav .links a{color:var(--cream-dim);padding-bottom:.2rem;
  background:linear-gradient(var(--gold-bright),var(--gold-bright)) no-repeat left bottom/0 1px;
  transition:background-size .25s ease,color .18s ease}
.nav .links a:hover,.nav .links a.here{color:var(--gold-bright);background-size:100% 1px}
.footer{position:relative;z-index:1;margin-top:6rem;padding:3.4rem 5vw 3.6rem;
  display:flex;flex-wrap:wrap;gap:2.5rem;justify-content:space-between;align-items:flex-start;
  background:linear-gradient(180deg,transparent,rgba(27,21,32,.75))}
.footer::before{content:'';position:absolute;left:0;right:0;top:0;height:1px;
  background:linear-gradient(90deg,transparent,rgba(200,151,90,.5) 18%,rgba(200,151,90,.5) 82%,transparent)}
.footer .mark{display:flex;align-items:center;gap:.7rem;letter-spacing:.34em;color:var(--gold);font-size:.9rem}
.footer .mark::before{content:'';width:.8rem;height:.9rem;flex:none;
  background:var(--foil);clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)}
.footer .creed{max-width:34rem;color:var(--faint);font-style:italic;font-size:.95rem;margin-top:.7rem}
.footer nav{display:grid;grid-template-columns:repeat(2,minmax(9rem,1fr));gap:.35rem 2rem;
  font-size:.78rem;letter-spacing:.14em;text-transform:uppercase}
.footer nav a{color:var(--cream-dim)}
.footer nav a:hover{color:var(--gold-bright)}
.footorn{position:absolute;top:-1px;left:50%;transform:translate(-50%,-50%);
  background:var(--night);padding:0 1.1rem;display:flex;gap:.55rem;align-items:center}
.footorn i{width:.6rem;height:.68rem;background:rgba(200,151,90,.55);
  clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)}
.footorn i:nth-child(2){width:.85rem;height:.95rem;background:var(--foil)}

/* ── type & layout ── */
.wrap{max-width:1060px;margin:0 auto;padding:0 5vw}
.kicker{font-size:.74rem;letter-spacing:.42em;text-transform:uppercase;color:var(--gold)}
.kicker::before{content:'';display:inline-block;width:1.6rem;height:1px;margin-right:.8rem;
  vertical-align:middle;background:linear-gradient(90deg,transparent,var(--gold))}
h1{font-size:clamp(2.5rem,6vw,4.4rem);line-height:1.08;font-weight:400;margin:.9rem 0 1.3rem;
  text-shadow:0 2px 24px rgba(0,0,0,.45)}
h1 i{font-style:italic;color:var(--gold-bright);
  background:var(--foil);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
h2{font-size:clamp(1.6rem,3.4vw,2.3rem);font-weight:400;line-height:1.2;margin-bottom:.9rem}
h2 i,.manifesto b,h1 b{font-weight:400}
h3{font-size:1.12rem;font-weight:400;color:var(--gold-bright);margin-bottom:.45rem}
.lede{font-size:clamp(1.05rem,2vw,1.28rem);color:var(--cream-dim);max-width:42rem}
.hero{padding:15vh 0 10vh;position:relative}
.hero::before{content:'';position:absolute;left:-8vw;top:6vh;width:min(46vw,540px);aspect-ratio:1;
  pointer-events:none;opacity:.5;
  background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'%3E%3Cpath d='M60,380 C30,320 76,290 52,236 C30,186 78,158 62,108 C50,66 84,40 78,4' fill='none' stroke='rgba(200,151,90,.16)' stroke-width='3' stroke-linecap='round'/%3E%3Cpath d='M110,380 C140,314 96,282 124,224 C146,178 106,148 128,96' fill='none' stroke='rgba(200,151,90,.10)' stroke-width='2.4' stroke-linecap='round'/%3E%3Cpath d='M170,380 C150,330 186,300 172,252' fill='none' stroke='rgba(200,151,90,.07)' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat center/contain}
.section{padding:4.6rem 0 1rem}
.section .rule{display:flex;align-items:center;gap:1rem;margin-bottom:2.4rem}
.section .rule::before{content:'';width:.55rem;height:.62rem;flex:none;
  background:var(--foil);clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)}
.section .rule::after{content:'';flex:1;height:1px;
  background:linear-gradient(90deg,rgba(200,151,90,.4),var(--hairline) 55%,transparent)}
.muted{color:var(--faint)}
.center{text-align:center}

/* ── components ── */
.rule .kicker::before{display:none}
.sheet .hero::before{display:none}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1.1rem;margin:1.8rem 0}
.card{background:linear-gradient(160deg,var(--coal),var(--smoke));border:1px solid var(--hairline);
  border-radius:2px;padding:1.5rem 1.4rem;position:relative;
  box-shadow:inset 0 0 0 1px rgba(20,16,23,.6),0 10px 26px rgba(0,0,0,.28);
  transition:transform .22s ease,border-color .22s ease,box-shadow .22s ease}
/* cigar-box corner ticks */
.card::before,.card::after{content:'';position:absolute;width:.85rem;height:.85rem;
  pointer-events:none;opacity:.75;transition:opacity .22s ease}
.card::before{top:.45rem;left:.45rem;border-top:1px solid var(--gold);border-left:1px solid var(--gold)}
.card::after{bottom:.45rem;right:.45rem;border-bottom:1px solid var(--gold);border-right:1px solid var(--gold)}
.card p{font-size:.95rem;color:var(--cream-dim)}
.card .thumb{width:58px;height:58px;float:right;margin:-.15rem 0 .5rem .85rem;border:1px solid var(--hairline);
  outline:1px solid rgba(200,151,90,.14);outline-offset:3px}
.card .num{position:absolute;top:1.1rem;right:1.2rem;font-size:.72rem;letter-spacing:.2em;color:var(--faint)}
.card.link:hover{border-color:var(--gold);transform:translateY(-3px);
  box-shadow:inset 0 0 0 1px rgba(20,16,23,.6),0 16px 34px rgba(0,0,0,.42),0 0 0 1px rgba(200,151,90,.12)}
.card.link:hover::before,.card.link:hover::after{opacity:1}
a.card{display:block;color:inherit}
.chips{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.8rem}
.chip{border:1px solid var(--hairline);border-radius:999px;padding:.22rem .85rem;
  font-size:.82rem;letter-spacing:.06em;color:var(--cream-dim);background:rgba(200,151,90,.05);
  transition:border-color .18s ease,color .18s ease,background .18s ease}
.chip.lit{border-color:var(--gold);color:var(--gold-bright);background:rgba(200,151,90,.14);
  box-shadow:0 0 12px rgba(200,151,90,.14)}
.btns{display:flex;flex-wrap:wrap;gap:1rem;margin-top:2.2rem}
.btn{display:inline-block;position:relative;overflow:hidden;padding:.78rem 1.9rem;
  border:1px solid var(--gold);color:var(--gold-bright);
  letter-spacing:.18em;text-transform:uppercase;font-size:.78rem;border-radius:2px;
  transition:background .2s ease,color .2s ease,box-shadow .2s ease}
.btn::after{content:'';position:absolute;top:0;bottom:0;left:-70%;width:45%;
  background:linear-gradient(105deg,transparent,rgba(244,223,174,.28),transparent);
  transform:skewX(-18deg);transition:left .5s ease}
.btn:hover{background:var(--gold);color:var(--night);box-shadow:0 4px 22px rgba(200,151,90,.28)}
.btn:hover::after{left:130%}
.btn.ghost{border-color:var(--hairline);color:var(--cream-dim)}
.btn.ghost:hover{background:transparent;border-color:var(--gold);color:var(--gold-bright);box-shadow:none}
blockquote{position:relative;border-left:2px solid var(--gold);padding:.4rem 0 .4rem 1.9rem;margin:2.2rem 0;
  font-size:clamp(1.15rem,2.4vw,1.5rem);font-style:italic;color:var(--cream)}
blockquote::before{content:'\\201C';position:absolute;left:-.55em;top:-.42em;font-size:4.6em;
  line-height:1;color:rgba(200,151,90,.2);font-style:normal;pointer-events:none}
blockquote cite{display:block;margin-top:.7rem;font-style:normal;font-size:.78rem;
  letter-spacing:.22em;text-transform:uppercase;color:var(--faint)}
.spoken{background:var(--coal);border:1px solid var(--hairline);border-radius:2px;
  padding:1.8rem 2rem;font-size:1.18rem;font-style:italic;line-height:2.1;position:relative;
  box-shadow:inset 0 0 40px rgba(0,0,0,.3)}
.spoken b{font-style:normal;font-weight:400;color:var(--gold-bright);
  border-bottom:1px dotted var(--gold);padding-bottom:1px}
.flow{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;margin:2rem 0;font-size:.9rem}
.flow span{border:1px solid var(--hairline);border-radius:2px;padding:.5rem 1rem;
  background:linear-gradient(160deg,var(--coal),var(--smoke));letter-spacing:.05em;
  box-shadow:0 4px 12px rgba(0,0,0,.25)}
.flow i{color:var(--gold);font-style:normal}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;
  background:var(--hairline);border:1px solid var(--hairline);margin:2rem 0;
  box-shadow:0 12px 30px rgba(0,0,0,.3)}
.facts div{background:var(--night);padding:1.4rem 1.2rem;text-align:center;position:relative}
.facts div::before{content:'';position:absolute;left:20%;right:20%;top:0;height:1px;
  background:linear-gradient(90deg,transparent,rgba(200,151,90,.35),transparent)}
.facts .n{display:block;font-size:2.1rem;line-height:1.15;
  background:var(--foil);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.facts .t{font-size:.72rem;letter-spacing:.22em;text-transform:uppercase;color:var(--faint)}
.manifesto p{font-size:clamp(1.3rem,3vw,1.9rem);line-height:1.5;margin:2.6rem 0;color:var(--cream)}
.manifesto p b{font-weight:400;background:var(--foil);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.privacy{position:relative;border:1px solid var(--gold);border-radius:2px;padding:1.7rem 1.9rem;margin:2.6rem 0;
  background:rgba(200,151,90,.06);box-shadow:inset 0 0 0 4px var(--night),inset 0 0 0 5px rgba(200,151,90,.35)}
.wheel-wrap{display:flex;justify-content:center;margin:2.4rem 0}
.wheel-wrap svg{width:min(640px,92vw);height:auto}
.dot{display:inline-block;width:.62rem;height:.62rem;border-radius:50%;margin-right:.5rem;
  vertical-align:baseline}

/* ── detail components ── */
.pips{display:inline-flex;gap:.3rem;vertical-align:middle}
.pips i{width:.52rem;height:.88rem;background:var(--gold);opacity:.2;
  clip-path:polygon(50% 0,100% 38%,78% 100%,22% 100%,0 38%)}
.pips i.on{opacity:1}
.meter{height:5px;background:rgba(200,151,90,.14);margin:.3rem 0 .85rem}
.meter i{display:block;height:100%;background:var(--gold)}
.meterrow{display:flex;align-items:baseline;gap:.8rem;font-size:.8rem;color:var(--cream-dim)}
.meterrow .lbl{flex:0 0 7.5rem;letter-spacing:.1em;text-transform:uppercase;font-size:.68rem;color:var(--faint)}
.meterrow .meter{flex:1;margin:0}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:1.1rem;margin:2rem 0}
.step{border:1px solid var(--hairline);background:linear-gradient(160deg,var(--coal),var(--smoke));
  padding:1.2rem 1.25rem;box-shadow:0 8px 20px rgba(0,0,0,.24)}
.step .n{display:block;font-size:.68rem;letter-spacing:.28em;color:var(--gold);margin-bottom:.55rem}
.step .n::after{content:'';display:block;width:2.2rem;height:1px;margin-top:.4rem;
  background:linear-gradient(90deg,var(--gold),transparent)}
.step p{font-size:.92rem;color:var(--cream-dim)}
.moment{border:1px solid var(--hairline);border-top:2px solid var(--gold);
  background:linear-gradient(160deg,var(--coal),var(--smoke));
  padding:1.5rem 1.6rem;box-shadow:0 10px 26px rgba(0,0,0,.28)}
.moment .who{font-size:.68rem;letter-spacing:.26em;text-transform:uppercase;color:var(--gold);margin-bottom:.6rem}
.moment .tale{font-style:italic;color:var(--cream);line-height:1.85;font-size:.98rem}
.moment .tale b{font-style:normal;font-weight:400;color:var(--gold-bright);border-bottom:1px dotted var(--gold);padding-bottom:1px}
.moment .after{margin-top:.85rem;font-size:.76rem;color:var(--faint);letter-spacing:.06em}
.swatches{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:1px;
  background:var(--hairline);border:1px solid var(--hairline);margin:1.8rem 0}
.swatches div{background:var(--night);padding:.9rem .6rem .8rem;text-align:center}
.swatches .sw{display:block;height:2.6rem;margin-bottom:.55rem;border:1px solid rgba(0,0,0,.35)}
.swatches .t{font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;color:var(--cream-dim)}
.swatches .s{display:block;font-size:.64rem;color:var(--faint);margin-top:.15rem}
.chart{border:1px solid var(--hairline);background:var(--coal);padding:1.2rem 1.2rem .9rem;margin:1.6rem 0;
  box-shadow:inset 0 0 46px rgba(0,0,0,.3),0 10px 26px rgba(0,0,0,.25)}
/* scroll reveal — sections breathe in; motion-safe, cleared after arrival */
@media (prefers-reduced-motion: no-preference){
  .rv{opacity:0;transform:translateY(18px)}
  .rv.in{opacity:1;transform:none;transition:opacity .7s ease,transform .7s ease}
}
.chart figcaption{font-size:.68rem;letter-spacing:.24em;text-transform:uppercase;color:var(--faint);
  padding-top:.7rem;text-align:center}
.chart svg{display:block;width:100%;height:auto}

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
/* ── embers: the purse, the shelves, the ledger ── */
.purse{display:flex;align-items:center;gap:.45rem;margin-left:1.4rem;padding:.3rem .8rem .3rem .6rem;
  border:1px solid var(--hairline);border-radius:999px;background:rgba(179,84,47,.1);
  font-size:.8rem;letter-spacing:.1em;color:var(--gold-bright);white-space:nowrap;
  transition:border-color .2s ease,background .2s ease}
.purse:hover{border-color:var(--gold);background:rgba(200,151,90,.16)}
.purse i{width:.6rem;height:.68rem;flex:none;background:var(--ember);
  clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);
  box-shadow:0 0 9px rgba(179,84,47,.75)}
@media (prefers-reduced-motion: no-preference){
  .purse i{animation:pulse 3.4s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:.75}50%{opacity:1}}
}
.purse.paid{animation:paid .9s ease}
@keyframes paid{0%{box-shadow:0 0 0 0 rgba(200,151,90,.5)}100%{box-shadow:0 0 0 14px rgba(200,151,90,0)}}
.purseline{display:flex;flex-wrap:wrap;align-items:baseline;gap:1.4rem;margin:2.2rem 0 1rem;
  border:1px solid var(--hairline);border-top:2px solid var(--gold);
  background:linear-gradient(160deg,var(--coal),var(--smoke));padding:1.6rem 1.8rem;
  box-shadow:0 12px 30px rgba(0,0,0,.3)}
.purseline .big{font-size:clamp(2.4rem,6vw,3.6rem);line-height:1;
  background:var(--foil);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.purseline .t{font-size:.7rem;letter-spacing:.26em;text-transform:uppercase;color:var(--faint)}
.purseline p{flex:1 1 16rem;font-size:.92rem;color:var(--cream-dim);min-width:14rem}
.shelf{display:grid;grid-template-columns:repeat(auto-fit,minmax(268px,1fr));gap:1.1rem;margin:1.6rem 0 2.6rem}
.good{position:relative;display:flex;flex-direction:column;
  border:1px solid var(--hairline);background:linear-gradient(160deg,var(--coal),var(--smoke));
  padding:1.5rem 1.4rem 1.3rem;box-shadow:0 10px 26px rgba(0,0,0,.28);
  transition:border-color .22s ease,transform .22s ease}
.good:hover{border-color:var(--gold);transform:translateY(-3px)}
.good .price{position:absolute;top:1.15rem;right:1.2rem;display:flex;align-items:center;gap:.35rem;
  font-size:.82rem;letter-spacing:.08em;color:var(--gold-bright)}
.good .price i{width:.5rem;height:.58rem;background:var(--ember);
  clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)}
.good h3{padding-right:4.5rem}
.good p{font-size:.92rem;color:var(--cream-dim);flex:1}
.good .take{margin-top:1.1rem;align-self:flex-start;padding:.5rem 1.3rem;border:1px solid var(--gold);
  color:var(--gold-bright);letter-spacing:.18em;text-transform:uppercase;font-size:.7rem;
  background:transparent;font-family:var(--serif);cursor:pointer;border-radius:2px;
  transition:background .2s ease,color .2s ease}
.good .take:hover{background:var(--gold);color:var(--night)}
.good .take[disabled]{cursor:default;border-color:var(--hairline);color:var(--faint);background:transparent}
.good.mine{border-color:var(--gold)}
.good.mine::after{content:'YOURS';position:absolute;bottom:1.35rem;right:1.3rem;
  font-size:.62rem;letter-spacing:.26em;color:var(--gold)}
.good.short .price{color:var(--faint)}
.earn{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:1px;
  background:var(--hairline);border:1px solid var(--hairline);margin:1.8rem 0}
.earn div{background:var(--night);padding:1.2rem 1.2rem 1.1rem}
.earn .n{display:block;font-size:1.5rem;line-height:1.2;
  background:var(--foil);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.earn .t{display:block;font-size:.72rem;letter-spacing:.2em;text-transform:uppercase;color:var(--gold);margin:.3rem 0 .5rem}
.earn p{font-size:.86rem;color:var(--faint);line-height:1.6}
.ledger{border:1px solid var(--hairline);background:var(--coal);margin:1.6rem 0;
  box-shadow:inset 0 0 40px rgba(0,0,0,.3)}
.ledger .row{display:flex;align-items:baseline;gap:1rem;padding:.7rem 1.3rem;
  border-top:1px solid rgba(200,151,90,.12);font-size:.9rem}
.ledger .row:first-child{border-top:0}
.ledger .row .w{flex:1;color:var(--cream-dim)}
.ledger .row .d{letter-spacing:.06em;color:var(--gold-bright)}
.ledger .row .d.out{color:var(--ember)}
.ledger .empty{padding:1.4rem 1.3rem;color:var(--faint);font-style:italic;font-size:.92rem}
@media(max-width:700px){.nav .links{display:none}.hero{padding:11vh 0 8vh}
  .nav .purse{margin-left:auto}
  .heroart{float:none;width:100%;max-width:340px;margin:0 auto 1.6rem}}
`

// ─── shared page scaffold ────────────────────────────────────────────

const NAV_LINKS: Array<[string, string]> = [
  ['/revolucion/journal', 'Journal'],
  ['/revolucion/experience', 'Experience'],
  ['/revolucion/flavor-wheel', 'Flavor Wheel'],
  ['/revolucion/lounge', 'Lounge'],
  ['/revolucion/store', 'El Mercado'],
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
  ['/revolucion/store', 'El Mercado'],
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
  <div class="atmo" aria-hidden="true"></div>
  <header class="nav">
    <a class="wordmark" href="/revolucion">REVOLUCIÓN<em> · STYLE</em></a>
    <nav class="links">
      ${nav}
    </nav>
    <a class="purse" href="/revolucion/store" title="Embers — earned in the lounge, spent in El Mercado">
      <i aria-hidden="true"></i><b data-embers-balance>0</b>
    </a>
  </header>
  ${/* the purse comes up BEFORE the body: the lounge's decorate list reads
        window.RevEmbers while it parses, so the ledger cannot be a tail script */
    EMBERS_JS}
${body}
  <footer class="footer">
    <div class="footorn" aria-hidden="true"><i></i><i></i><i></i></div>
    <div>
      <div class="mark">REVOLUCIÓN</div>
      <p class="creed">We do not sell cigars. We curate meaningful experiences —
      and the journal is the foundation that grows the mission.</p>
    </div>
    <nav>
        ${foot}
    </nav>
  </footer>
  <script>
  (function(){
    // Scroll-reveal via rect sweep, NOT IntersectionObserver — IO (like rAF)
    // starves in occluded/uncomposited tabs and the sections would stay
    // invisible forever. A sweep + failsafe can never strand content.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var pending = [];
    var all = document.querySelectorAll('main .section');
    for (var i = 0; i < all.length; i++){
      // never animate a section that hosts a fixed-position room (the lounge)
      if (all[i].querySelector('.lfull')) continue;
      all[i].classList.add('rv');
      pending.push(all[i]);
    }
    function sweep(){
      if (!pending.length) return;
      var vh = window.innerHeight || 800;
      pending = pending.filter(function(el){
        if (el.getBoundingClientRect().top < vh * 0.94){ el.classList.add('in'); return false; }
        return true;
      });
      if (!pending.length){
        window.removeEventListener('scroll', sweep);
        window.removeEventListener('resize', sweep);
      }
    }
    window.addEventListener('scroll', sweep, { passive: true });
    window.addEventListener('resize', sweep);
    sweep();
    setTimeout(function(){ pending.forEach(function(el){ el.classList.add('in'); }); pending = []; }, 4000);
  })();
  </script>
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

// ─── the starter catalog (INVENTED — no real brands) ─────────────────
// Shared by the flavor wheel's matcher and the lounge concierge, so the two
// pages can never disagree about what is in the humidor.

type Cigar = { n: string; v: string; w: string; o: string; s: number; m: string; f: string[] }
const CIGARS: Cigar[] = [
  { n: 'Reflexión Nº 1', v: 'Toro', w: 'Maduro', o: 'Nicaragua', s: 3, m: 'reflection', f: ['Dark Chocolate', 'Cedar', 'Molasses', 'Leather'] },
  { n: 'Sobremesa', v: 'Corona', w: 'Habano', o: 'Nicaragua', s: 3, m: 'conversation', f: ['Cedar', 'Black Pepper', 'Caramel', 'Toast'] },
  { n: 'Primera Luz', v: 'Petit Corona', w: 'Connecticut', o: 'Ecuador', s: 1, m: 'first light', f: ['Cream', 'Butter', 'Honey', 'Hay'] },
  { n: 'Fogata', v: 'Robusto', w: 'Oscuro', o: 'Nicaragua', s: 5, m: 'fireside', f: ['Campfire', 'Charred Wood', 'Black Pepper', 'Espresso'] },
  { n: 'Biblioteca', v: 'Lancero', w: 'Colorado', o: 'Dominican Republic', s: 2, m: 'focus', f: ['Sandalwood', 'Tea', 'Honey', 'Toast'] },
  { n: 'Celebración', v: 'Torpedo', w: 'Colorado Maduro', o: 'Honduras', s: 4, m: 'celebration', f: ['Red Pepper', 'Brown Sugar', 'Cocoa', 'Oak'] },
  { n: 'Cacao Real', v: 'Gordo', w: 'Maduro', o: 'Brazil', s: 4, m: 'unwind', f: ['Dark Chocolate', 'Espresso', 'Raisin', 'Molasses'] },
  { n: 'La Cosecha', v: 'Churchill', w: 'Sumatra', o: 'Ecuador', s: 3, m: 'gratitude', f: ['Fig', 'Cedar', 'Hay', 'Almond'] },
  { n: 'Patio Dorado', v: 'Robusto', w: 'Natural', o: 'Honduras', s: 2, m: 'golden hour', f: ['Caramel', 'Peanut', 'Grass', 'Citrus'] },
  { n: 'Niebla', v: 'Belicoso', w: 'Claro', o: 'Mexico', s: 2, m: 'morning', f: ['Mineral', 'Cream', 'Jasmine', 'White Pepper'] },
  { n: 'Medianoche', v: 'Perfecto', w: 'Oscuro', o: 'Nicaragua', s: 5, m: 'late night', f: ['Charcoal', 'Dark Chocolate', 'Peat', 'Clove'] },
  { n: 'Compañero', v: 'Lonsdale', w: 'Habano', o: 'Cuba', s: 3, m: 'close friends', f: ['Leather', 'Nutmeg', 'Mocha', 'Dried Fruit'] },
  { n: 'Brisa', v: 'Panatela', w: 'Connecticut', o: 'Dominican Republic', s: 1, m: 'a breeze outside', f: ['Grass', 'Citrus', 'Cream', 'Mint'] },
  { n: 'El Faro', v: 'Toro', w: 'Colorado', o: 'Cameroon', s: 4, m: 'milestone', f: ['Hickory', 'Anise', 'Burnt Caramel', 'Walnut'] },
]

// ─── the lounge concierge ────────────────────────────────────────────
// Walk-in (full-screen room + Chat | Decorate sidebar) and the deterministic
// concierge behind the Chat tab. It answers from the site's own catalog and
// taxonomy, drives the room (slots + camera), takes cigar requests, and takes
// journal moments. NO network: every answer is computed in the page, and
// requests/moments are kept in localStorage until the journal claims them.

const CONCIERGE_JS = /* html */ `<script>
(function(){
  var CIGARS = ${JSON.stringify(CIGARS)};
  var FAM = ${JSON.stringify(FAMILIES)};
  var STR = ['mild','mild-medium','medium','medium-full','full'];
  var PAIR = {'Earth':'espresso or an aged rum','Wood':'a peaty scotch','Spice':'rum, or a rye',
    'Sweet':'coffee, or a tawny port','Coffee & Chocolate':'espresso, or a stout',
    'Cream & Bread':'coffee with cream, or a light tea','Nut':'an aged rum',
    'Fruit':'a red wine, or a fruit tea','Herbal & Floral':'green tea','Smoke & Char':'an Islay whisky'};
  var famOf = {}; FAM.forEach(function(f){ f.flavors.forEach(function(x){ famOf[x] = f.label; }); });

  var log = document.getElementById('chatlog');
  var form = document.getElementById('chatform');
  var input = document.getElementById('chatinput');
  var full = document.getElementById('loungeFull');
  var stageHome = null;

  function fold(s){ return String(s || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, ''); }
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function store(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
  function load(k, d){ try { return JSON.parse(localStorage.getItem(k)) || d; } catch(e){ return d; } }

  var RESERVED = load('rev:lounge:reserved', []);
  var MOMENTS = load('rev:lounge:moments', []);

  // ── walk in / leave ──────────────────────────────────────────────────
  function openFull(){
    if (!full || !full.hidden) return;
    var wrap = document.querySelector('.stagewrap');
    var slot = document.getElementById('lfStage');
    if (wrap && slot) { stageHome = wrap.parentNode; slot.appendChild(wrap); }
    full.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    if (!log.childNodes.length) greet();
    if (input) input.focus();
  }
  function closeFull(){
    if (!full || full.hidden) return;
    var wrap = document.querySelector('.stagewrap');
    if (wrap && stageHome) stageHome.insertBefore(wrap, stageHome.firstChild);
    full.hidden = true;
    document.documentElement.style.overflow = '';
  }
  var openBtn = document.getElementById('lfOpen');
  if (openBtn) openBtn.addEventListener('click', openFull);
  var closeBtn = document.getElementById('lfClose');
  if (closeBtn) closeBtn.addEventListener('click', closeFull);

  // click the room to walk in — but never mistake a drag-to-look for a click
  var stage = document.getElementById('lounge3d');
  if (stage) {
    var down = null;
    stage.addEventListener('pointerdown', function(e){ down = { x: e.clientX, y: e.clientY, t: Date.now() }; }, true);
    stage.addEventListener('pointerup', function(e){
      if (!down || !full.hidden) { down = null; return; }
      var moved = Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y);
      var quick = Date.now() - down.t < 400;
      down = null;
      if (moved < 6 && quick) openFull();
    }, true);
  }

  // ── tabs ─────────────────────────────────────────────────────────────
  var tabs = document.querySelectorAll('.lf-tabs button');
  for (var t = 0; t < tabs.length; t++) {
    tabs[t].addEventListener('click', function(e){
      var name = e.currentTarget.getAttribute('data-tab');
      for (var j = 0; j < tabs.length; j++) tabs[j].classList.toggle('on', tabs[j] === e.currentTarget);
      document.getElementById('paneChat').hidden = name !== 'chat';
      document.getElementById('paneDecorate').hidden = name !== 'decorate';
      if (name === 'chat' && input) input.focus();
    });
  }
  function showTab(name){
    for (var j = 0; j < tabs.length; j++)
      if (tabs[j].getAttribute('data-tab') === name) tabs[j].click();
  }

  // ── the log ──────────────────────────────────────────────────────────
  function say(who, html){
    var d = document.createElement('div');
    d.className = 'msg' + (who === 'you' ? ' you' : '');
    d.innerHTML = '<span class="who">' + (who === 'you' ? 'you' : 'Revoluci\\u00f3n') + '</span>' +
      '<span class="body">' + html + '</span>';
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }
  function greet(){
    say('rev', 'Evening. Pull up a chair \\u2014 the fire is going.<br><br>' +
      'Ask me about a cigar, a pairing, or the flavor wheel. I can also ' +
      '<b>reserve</b> something for you (\\u201creserve another Reflexi\\u00f3n\\u201d), ' +
      '<b>journal</b> the moment (\\u201cjournal: rain on the window, Fogata\\u201d), ' +
      'or change the room (\\u201cshow me the humidor\\u201d, \\u201cturn off the lamp\\u201d).');
  }

  // ── knowledge ────────────────────────────────────────────────────────
  function findCigar(q){
    var f = fold(q);
    for (var i = 0; i < CIGARS.length; i++) {
      var name = fold(CIGARS[i].n);
      if (f.indexOf(name) >= 0) return CIGARS[i];
      var first = name.split(' ')[0];
      if (first.length > 4 && f.indexOf(first) >= 0) return CIGARS[i];
    }
    return null;
  }
  function famsOf(c){
    var seen = [], out = [];
    c.f.forEach(function(fl){ var fm = famOf[fl]; if (fm && seen.indexOf(fm) < 0) { seen.push(fm); out.push(fm); } });
    return out;
  }
  function card(c){
    var fams = famsOf(c);
    return '<b>' + esc(c.n) + '</b> \\u2014 ' + esc(c.v) + ', ' + esc(c.w) + ' wrapper, ' + esc(c.o) +
      '<br>' + STR[c.s - 1] + ' \\u00b7 for ' + esc(c.m) +
      '<br>Notes: ' + c.f.map(esc).join(', ') +
      '<br>Pour ' + (PAIR[fams[0]] || 'something you already love') + '.';
  }
  function pick(pred){
    var hits = CIGARS.filter(pred);
    return hits.length ? hits[Math.floor(Math.random() * hits.length)] : null;
  }
  // longest phrases first: "a box" must beat the bare "a" in "a box of Fogata"
  var WORD_N = [['a box', 25], ['box', 25], ['dozen', 12], ['couple', 2], ['pair', 2],
    ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5], ['six', 6],
    ['seven', 7], ['eight', 8], ['nine', 9], ['ten', 10], ['a', 1], ['an', 1]];
  function countIn(q){
    var digits = q.match(/\\b(\\d{1,2})\\b/);
    if (digits) return parseInt(digits[1], 10);
    for (var i = 0; i < WORD_N.length; i++)
      if (new RegExp('\\\\b' + WORD_N[i][0] + '\\\\b').test(q)) return WORD_N[i][1];
    return 1;
  }
  var lastCigar = null;

  var TOPICS = [
    { k: ['flavor wheel','wheel','flavour'], a: 'Sixty-three flavors in ten families \\u2014 Earth, Wood, Spice, Sweet, ' +
      'Coffee &amp; Chocolate, Cream &amp; Bread, Nut, Fruit, Herbal &amp; Floral, Smoke &amp; Char. ' +
      'Spin it, put a flavor in the notch, and it scores the catalog against what you picked: ' +
      '<a href="/revolucion/flavor-wheel">open the wheel</a>.' },
    { k: ['humidor','store','storage','humidity','dry out'], a: 'Keep them at <b>69&ndash;70% RH</b> and around 18&ndash;21&#176;C. ' +
      'Season a new humidor before you fill it, never soak the cigars, and rotate the box every few weeks. ' +
      'A dried-out cigar can be brought back slowly \\u2014 days, not hours. ' +
      'Yours lives in <a href="/revolucion/humidor">the humidor</a>.' },
    { k: ['cut','cutter','punch','guillotine'], a: 'Cut just above the cap line \\u2014 a couple of millimetres. ' +
      'A straight cut for most, a punch for a tighter draw, a V for something in between. ' +
      'The cutter is on the low table; go too deep and the cap unravels.' },
    { k: ['light','lighter','toast','match'], a: 'Toast the foot first, flame just off the leaf, turning until the edge glows. ' +
      'Then draw gently while you finish the light. Never rush it, and never use anything that smells of fuel.' },
    { k: ['ash','relight','burn'], a: 'Let the ash build \\u2014 an inch is fine, it insulates the burn. ' +
      'If it goes out, tap the ash off, toast the foot again, relight. A relit cigar is not a ruined cigar; ' +
      'it just gets bolder from there.' },
    { k: ['pair','pairing','drink','whiskey','whisky','rum','coffee','scotch'], a: 'Match weight to weight. ' +
      'Maduro and dark chocolate notes want espresso or an aged rum; a Connecticut morning cigar wants coffee with cream; ' +
      'anything charred wants an Islay. Tell me the cigar and I will pour for it.' },
    { k: ['origin','where','country','nicaragua','cuba','dominican'], a: 'Nicaragua for pepper and earth, ' +
      'the Dominican Republic for balance, Honduras for sweetness with a bite, Ecuador for wrappers grown under cloud, ' +
      'Cameroon and Sumatra for spice. The map above the bar shows where the leaf comes from.' },
    { k: ['vitola','size','shape','ring gauge','robusto','toro'], a: 'Size sets the time and the temperature. ' +
      'A Petit Corona is half an hour; a Toro or Churchill is a whole evening. Thinner rings burn hotter and read spicier; ' +
      'thicker rings pull cooler and sweeter.' },
    { k: ['reward','trophy','trophies','earn','unlock','furniture'], a: 'The room is earned. Post moments in the journal and ' +
      'you unlock trophies, furniture and upgrades \\u2014 the shelves fill, the lighting gets richer. ' +
      'Nothing here is bought: <a href="/revolucion/journal">start with one moment</a>.' },
    { k: ['journal code','code','account','login','sign in','privacy'], a: 'No account, no login. With your first entry we hand ' +
      'you a code; leave it on any future entry and the journal knows it is you. What you write is yours \\u2014 ' +
      'makers only ever see anonymized, aggregated patterns.' },
    { k: ['who are you','revolucion','about','mission','company'], a: 'We do not sell cigars \\u2014 we curate meaningful ' +
      'experiences, and the journal is the foundation that grows the mission. ' +
      'Read <a href="/revolucion/mission">the manifesto</a>.' },
    { k: ['room','lounge','this place','3d'], a: 'Your corner of the ecosystem, rendered in three dimensions. ' +
      'Drag to look around, use the view buttons to move, and open <b>Decorate</b> to turn any piece on or off. ' +
      'Everything you see is a slot \\u2014 your own art and bottles land here as you earn them.' }
  ];

  var IDEAS = 'A few things worth trying:<br>' +
    '\\u2022 \\u201cwhat should I smoke tonight?\\u201d \\u2014 or name a mood: reflection, celebration, late night<br>' +
    '\\u2022 \\u201cwhat pairs with Fogata?\\u201d<br>' +
    '\\u2022 \\u201creserve two more Reflexi\\u00f3n\\u201d \\u2014 I keep the request until the journal claims it<br>' +
    '\\u2022 \\u201cjournal: first cold night, Medianoche, nobody talking\\u201d<br>' +
    '\\u2022 \\u201cshow me the wall\\u201d / \\u201ctake me to my chair\\u201d<br>' +
    '\\u2022 \\u201cturn off the lamp\\u201d, \\u201cno cat\\u201d, \\u201chide the records\\u201d';

  var VIEWS = [
    { k: ['the wall','gallery','art','frames','paintings'], v: 'gallery', s: 'The gallery wall.' },
    { k: ['humidor','cabinet','cigars behind'], v: 'humidor', s: 'The humidor cabinet.' },
    { k: ['fire','hearth','fireplace','flames'], v: 'fire', s: 'The hearth.' },
    { k: ['my chair','your chair','chair','sit','seat'], v: 'chair', s: 'Sit down. The fire is right there.' },
    { k: ['the room','whole room','back','wide','everything'], v: 'room', s: 'The whole room.' }
  ];

  // ── the reply ────────────────────────────────────────────────────────
  function respond(raw){
    var q = fold(raw);
    if (!q) return 'Say anything \\u2014 or ask what I can do.';

    if (/^(hi|hey|hello|good evening|evening|yo)\\b/.test(q))
      return 'Evening. Something in particular, or shall I pour you a recommendation?';
    if (/(thank|cheers|appreciate)/.test(q)) return 'Any time. The chair is yours as long as you want it.';
    if (/(what can you do|what can i do|help|ideas|suggest something|options)/.test(q)) return IDEAS;

    if (/(wheel|taxonomy|flavou?rs)/.test(q) && /(open|show|bring|let me see|pull up|use|tap)/.test(q)) {
      openWheel();
      return 'On the gallery wall \\u2014 opened. Tap a family, then the flavors you are tasting; ' +
        'the humidor sorts itself against them.';
    }

    // ── move the room ──
    for (var v = 0; v < VIEWS.length; v++) {
      for (var vk = 0; vk < VIEWS[v].k.length; vk++) {
        if (q.indexOf(VIEWS[v].k[vk]) >= 0 && /(show|take|look|go|see|walk|turn to|face)/.test(q)) {
          if (window.__loungeView) window.__loungeView(VIEWS[v].v);
          return VIEWS[v].s;
        }
      }
    }

    // ── flip a slot ──
    var wantOff = /(turn off|switch off|hide|kill|no more|lose the|put out|without|remove)/.test(q);
    var wantOn = /(turn on|switch on|show|light|bring back|put on|add)/.test(q);
    if (wantOff || wantOn) {
      var slots = window.__loungeSlots || [];
      for (var s = 0; s < slots.length; s++) {
        var words = fold(slots[s].label.replace(/&amp;/g, ' ')).split(/[^a-z]+/).filter(function(w){ return w.length > 3; });
        for (var w = 0; w < words.length; w++) {
          if (q.indexOf(words[w]) >= 0) {
            if (window.__loungeSetSlot) window.__loungeSetSlot(slots[s].id, !wantOff);
            return (wantOff ? 'Done \\u2014 ' : 'Back on \\u2014 ') + slots[s].label.toLowerCase() +
              '. Everything in here is a switch; the full list is under <b>Decorate</b>.';
          }
        }
      }
    }

    // ── reserve ── (the LIST question is checked first, or "what have I
    // reserved" would book another one)
    if (/(what have i reserved|my list|my requests|reservations|on hold|what did i reserve)/.test(q)) {
      if (!RESERVED.length) return 'Nothing on your list yet. Say \\u201creserve another Sobremesa\\u201d when something lands.';
      return 'On your list:<br>' + RESERVED.map(function(r){
        return '\\u2022 ' + (r.q > 1 ? r.q + ' \\u00d7 ' : '') + esc(r.n);
      }).join('<br>');
    }
    if (/(reserve|order|another|more of|get me|set aside|hold me|box of|put aside)/.test(q)) {
      var c = findCigar(q) || lastCigar;
      if (!c) return 'Happy to \\u2014 which one? Try \\u201creserve two Reflexi\\u00f3n\\u201d, or ask me to ' +
        'recommend one first.';
      lastCigar = c;
      var qty = countIn(q);
      RESERVED.push({ n: c.n, q: qty, at: Date.now() });
      store('rev:lounge:reserved', RESERVED);
      var total = 0; RESERVED.forEach(function(r){ total += r.q; });
      return 'Set aside: <b>' + (qty > 1 ? qty + ' \\u00d7 ' : '') + esc(c.n) + '</b>. ' +
        'That is ' + total + ' on your list now \\u2014 it stays here until you take it to ' +
        '<a href="/revolucion/humidor">the humidor</a>. Nothing is charged and nothing is sent; ' +
        'a request is just a request.';
    }

    // ── journal ──
    if (/^(journal|log|record|note)\\b/.test(q) || /(journal this|log this|record this|write this down)/.test(q)) {
      var text = raw.replace(/^\\s*(journal|log|record|note)\\s*[:,-]?\\s*/i, '')
                    .replace(/^(this|it)\\s*[:,-]?\\s*/i, '').trim();
      if (!text) return 'Tell me the moment and I will hold it \\u2014 \\u201cjournal: rain on the window, Fogata, ' +
        'nobody talking\\u201d. It waits here until you open <a href="/revolucion/journal">the journal</a>.';
      MOMENTS.push({ t: text, at: Date.now() });
      store('rev:lounge:moments', MOMENTS);
      var cg = findCigar(text);
      if (cg) lastCigar = cg;
      return 'Held: \\u201c' + esc(text) + '\\u201d' + (cg ? ' \\u2014 with ' + esc(cg.n) : '') +
        '.<br>That is ' + MOMENTS.length + ' moment' + (MOMENTS.length === 1 ? '' : 's') +
        ' waiting. Take them to <a href="/revolucion/journal">the journal</a> when you are ready.';
    }
    if (/(my moments|what have i written|my journal)/.test(q)) {
      if (!MOMENTS.length) return 'No moments yet. The first one is the one that hands you your journal code.';
      return 'Waiting to be journaled:<br>' + MOMENTS.slice(-6).map(function(m){
        return '\\u2022 ' + esc(m.t);
      }).join('<br>');
    }

    // ── a named cigar ──
    var named = findCigar(q);
    if (named) {
      lastCigar = named;
      if (/(pair|drink|pour|with what|goes with)/.test(q)) {
        var f0 = famsOf(named)[0];
        return 'With <b>' + esc(named.n) + '</b> \\u2014 ' + named.f.slice(0, 2).join(' and ').toLowerCase() +
          ' up front \\u2014 pour ' + (PAIR[f0] || 'something you already love') + '.';
      }
      return card(named);
    }

    // ── recommend ──
    if (/(recommend|what should i|suggest|pick|choose|smoke tonight|smoke now|start with)/.test(q) ||
        /(mild|full|strong|light|gentle|bold)/.test(q) ||
        /(reflection|celebration|late night|conversation|focus|gratitude|unwind|morning|milestone|first light|golden hour|fireside)/.test(q)) {
      var want = null;
      if (/(mild|light|gentle|easy|beginner|first cigar|new to)/.test(q)) want = function(c){ return c.s <= 2; };
      else if (/(full|strong|bold|heavy|powerful)/.test(q)) want = function(c){ return c.s >= 4; };
      var moods = ['reflection','celebration','late night','conversation','focus','gratitude','unwind','morning','milestone','first light','golden hour','fireside','close friends'];
      for (var m = 0; m < moods.length; m++) {
        if (q.indexOf(moods[m]) >= 0) { var mood = moods[m]; want = function(c){ return c.m === mood; }; break; }
      }
      for (var fi = 0; fi < FAM.length; fi++) {
        var fl = FAM[fi].flavors;
        for (var fj = 0; fj < fl.length; fj++) {
          if (q.indexOf(fold(fl[fj])) >= 0) { var flav = fl[fj]; want = function(c){ return c.f.indexOf(flav) >= 0; }; break; }
        }
      }
      var rec = pick(want || function(){ return true; }) || pick(function(){ return true; });
      lastCigar = rec;
      return 'Then <b>' + esc(rec.n) + '</b>.<br>' + card(rec) +
        '<br><br>Say \\u201creserve it\\u201d and I will set one aside.';
    }

    // ── topics ──
    for (var i = 0; i < TOPICS.length; i++) {
      for (var k = 0; k < TOPICS[i].k.length; k++) {
        if (q.indexOf(TOPICS[i].k[k]) >= 0) return TOPICS[i].a;
      }
    }

    return 'I did not catch that one. ' + IDEAS;
  }

  if (form) {
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var text = (input.value || '').trim();
      if (!text) return;
      input.value = '';
      say('you', esc(text));
      var answer = respond(text);
      setTimeout(function(){ say('rev', answer); }, 160);
    });
  }

  // ── the wheel plate ──────────────────────────────────────────────────
  // A tidy, in-room instance of the taxonomy: one ring, drill into a family,
  // tap flavors, watch the humidor sort itself. Deliberately NOT the full
  // page — that one spins, has the selector station, and owns the deep tool.
  var plate = document.getElementById('wheelPlate');
  var wsvg = document.getElementById('wheelSvg');
  var wchips = document.getElementById('wheelChips');
  var wmatch = document.getElementById('wheelMatches');
  var wtitle = document.getElementById('wheelTitle');
  var wback = document.getElementById('wheelBack');
  var openFam = null;
  var picked = [];

  function ringSvg(items, colorOf, labelOf, isOn){
    var C = 160, R = 148, r = 62, n = items.length, seg = 360 / n, out = [];
    function polar(rad, deg){ var a = (deg - 90) * Math.PI / 180;
      return [ (C + rad * Math.cos(a)).toFixed(1), (C + rad * Math.sin(a)).toFixed(1) ]; }
    for (var i = 0; i < n; i++) {
      var a0 = i * seg + 0.9, a1 = (i + 1) * seg - 0.9;
      var p0 = polar(R, a0), p1 = polar(R, a1), p2 = polar(r, a1), p3 = polar(r, a0);
      var big = (a1 - a0) > 180 ? 1 : 0;
      var on = isOn ? isOn(items[i]) : false;
      out.push('<path class="seg" data-i="' + i + '" d="M' + p0 + 'A' + R + ',' + R + ' 0 ' + big + ' 1 ' + p1 +
        'L' + p2 + 'A' + r + ',' + r + ' 0 ' + big + ' 0 ' + p3 + 'Z" fill="' + colorOf(items[i]) +
        '" fill-opacity="' + (isOn ? (on ? '1' : '.42') : '1') +
        '" stroke="' + (on ? '#e0b578' : '#1b1520') + '" stroke-width="' + (on ? 3 : 2) + '"></path>');
      var mid = (a0 + a1) / 2, tp = polar((R + r) / 2, mid);
      var rot = mid > 180 ? mid + 90 : mid - 90;
      out.push('<text class="seg" data-i="' + i + '" x="' + tp[0] + '" y="' + tp[1] +
        '" text-anchor="middle" dominant-baseline="middle" transform="rotate(' + rot.toFixed(1) +
        ' ' + tp[0] + ' ' + tp[1] + ')" font-size="9.5" font-family="Georgia,serif" ' +
        'fill="' + (isLight(colorOf(items[i])) ? '#171017' : '#f0e6d6') + '" style="pointer-events:none">' +
        esc(labelOf(items[i])) + '</text>');
    }
    out.push('<circle cx="160" cy="160" r="' + (r - 6) + '" fill="#141017" stroke="#c8975a" stroke-width="2"/>');
    out.push('<text x="160" y="156" text-anchor="middle" font-size="17" font-family="Georgia,serif" fill="#c8975a">' +
      (openFam ? picked.length : '63') + '</text>');
    out.push('<text x="160" y="174" text-anchor="middle" font-size="8" letter-spacing="2" ' +
      'font-family="Georgia,serif" fill="#8d7f6f">' + (openFam ? 'PICKED' : 'FLAVORS') + '</text>');
    return '<svg viewBox="0 0 320 320" xmlns="http://www.w3.org/2000/svg" role="img" ' +
      'aria-label="Flavor wheel">' + out.join('') + '</svg>';
  }
  function isLight(hex){
    var c = hex.replace('#',''); if (c.length !== 6) return false;
    var v = (parseInt(c.slice(0,2),16) * 299 + parseInt(c.slice(2,4),16) * 587 + parseInt(c.slice(4,6),16) * 114) / 1000;
    return v > 150;
  }
  function drawWheel(){
    if (openFam) {
      wsvg.innerHTML = ringSvg(openFam.flavors, function(){ return openFam.color; }, function(x){ return x; },
        function(x){ return picked.indexOf(x) >= 0; });
      wtitle.textContent = openFam.label;
      wback.hidden = false;
    } else {
      wsvg.innerHTML = ringSvg(FAM, function(f){ return f.color; }, function(f){ return f.label; },
        picked.length ? function(f){
          return f.flavors.some(function(x){ return picked.indexOf(x) >= 0; });
        } : null);
      wtitle.textContent = 'The Flavor Wheel';
      wback.hidden = true;
    }
    var segs = wsvg.querySelectorAll('.seg');
    for (var i = 0; i < segs.length; i++) {
      segs[i].addEventListener('click', function(e){
        var idx = parseInt(e.currentTarget.getAttribute('data-i'), 10);
        if (!openFam) { openFam = FAM[idx]; drawWheel(); return; }
        var fl = openFam.flavors[idx];
        var at = picked.indexOf(fl);
        if (at >= 0) picked.splice(at, 1); else picked.push(fl);
        drawWheel(); drawPicked();
      });
    }
  }
  function drawPicked(){
    if (!picked.length) {
      wchips.innerHTML = '<p class="wempty">Tap a family, then the flavors you are tasting. ' +
        'They stack up here.</p>';
      wmatch.innerHTML = '<p class="wempty">Pick a flavor and the catalog sorts itself against it.</p>';
      return;
    }
    // three flavors stacked is a tasting — the house pays for it, once per
    // distinct set (the claim key IS the set, so re-picking it pays nothing)
    if (picked.length >= 3 && window.RevEmbers) {
      window.RevEmbers.claim('tasting:' + picked.slice().sort().join('|'), ${EARN_OF('tasting')},
        'a tasting logged: ' + picked.slice(0, 3).join(', '));
    }
    wchips.innerHTML = picked.map(function(f){
      return '<span class="chip" data-f="' + esc(f) + '">' + esc(f) + '<span class="x">\\u00d7</span></span>';
    }).join('');
    var chips = wchips.querySelectorAll('.chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function(e){
        var f = e.currentTarget.getAttribute('data-f');
        var at = picked.indexOf(f); if (at >= 0) picked.splice(at, 1);
        drawWheel(); drawPicked();
      });
    }
    var scored = CIGARS.map(function(c){
      var hits = c.f.filter(function(f){ return picked.indexOf(f) >= 0; });
      var union = c.f.length + picked.length - hits.length;
      return { c: c, hits: hits, score: union ? hits.length / union : 0 };
    }).filter(function(s){ return s.hits.length; })
      .sort(function(a, b){ return b.score - a.score; }).slice(0, 3);
    if (!scored.length) {
      wmatch.innerHTML = '<p class="wempty">Nothing in the starter catalog carries that ' +
        'combination yet \\u2014 which is its own kind of answer.</p>';
      return;
    }
    wmatch.innerHTML = scored.map(function(s){
      var fam = famOf[s.hits[0]];
      return '<div class="match"><b>' + esc(s.c.n) + '</b>' +
        '<span class="meta">' + esc(s.c.v) + ' \\u00b7 ' + STR[s.c.s - 1] + ' \\u00b7 for ' + esc(s.c.m) + '</span>' +
        '<span class="hits">' + s.hits.map(esc).join(' \\u00b7 ') + '</span>' +
        '<span class="meta">Pour ' + (PAIR[fam] || 'what you already love') + '.</span></div>';
    }).join('');
  }
  function openWheel(){
    if (!plate) return;
    plate.hidden = false;
    drawWheel(); drawPicked();
  }
  function closeWheel(){ if (plate) plate.hidden = true; }
  var wc = document.getElementById('wheelClose');
  if (wc) wc.addEventListener('click', closeWheel);
  if (wback) wback.addEventListener('click', function(){ openFam = null; drawWheel(); });
  if (plate) plate.addEventListener('click', function(e){ if (e.target === plate) closeWheel(); });
  document.addEventListener('keydown', function(e){
    if (e.key !== 'Escape') return;
    if (plate && !plate.hidden) { closeWheel(); return; }
    closeFull();
  }, true);

  // the room says which print was clicked; the page decides what opens
  document.addEventListener('lounge3d:pick', function(e){
    var id = e.detail && e.detail.id;
    if (id !== 'flavor-wheel') return;
    openFull();
    openWheel();
  });

  // the concierge can pull the room open from anywhere on the page
  window.__loungeWalkIn = openFull;
  window.__loungeShowTab = showTab;
  window.__loungeWheel = openWheel;

  // Mounted as the cell's OWN view (the threshold's room sets
  // window.__hcRoomView before our scripts run): no website interface —
  // walk straight into the lounge. setTimeout so every wire above is live.
  if (window.__hcRoomView) setTimeout(openFull, 0);
})();
</script>`

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

// ─── vitola silhouettes (drawn to scale from real dimensions) ────────

function vitolaSvg(): string {
  type V = { n: string; len: number; rg: number; shape: 'parejo' | 'torpedo' | 'belicoso' | 'perfecto'; note: string }
  const VITOLAS: V[] = [
    { n: 'Petit Corona', len: 4.5, rg: 42, shape: 'parejo', note: 'the lunch-hour classic' },
    { n: 'Robusto', len: 5, rg: 50, shape: 'parejo', note: 'the modern standard' },
    { n: 'Perfecto', len: 5, rg: 48, shape: 'perfecto', note: 'tapered both ends' },
    { n: 'Corona', len: 5.5, rg: 42, shape: 'parejo', note: 'the old measuring stick' },
    { n: 'Belicoso', len: 5.5, rg: 52, shape: 'belicoso', note: 'the blunt point' },
    { n: 'Panatela', len: 6, rg: 38, shape: 'parejo', note: 'slender and quick' },
    { n: 'Toro', len: 6, rg: 50, shape: 'parejo', note: 'the even hour' },
    { n: 'Torpedo', len: 6, rg: 52, shape: 'torpedo', note: 'drawn to a point' },
    { n: 'Gordo', len: 6, rg: 60, shape: 'parejo', note: 'the wide seat' },
    { n: 'Lonsdale', len: 6.5, rg: 42, shape: 'parejo', note: 'elegant, unhurried' },
    { n: 'Churchill', len: 7, rg: 48, shape: 'parejo', note: 'named for a long evening' },
    { n: 'Lancero', len: 7.5, rg: 38, shape: 'parejo', note: 'the wrapper on display' },
  ]
  const S = 52            // px per inch of length
  const X0 = 196          // silhouette left edge (label gutter)
  const ROW = 62
  const rows: string[] = []
  VITOLAS.forEach((v, i) => {
    const yc = i * ROW + ROW / 2 + 8
    const h = (v.rg / 64) * S
    const yt = yc - h / 2, yb = yc + h / 2
    const x1 = X0 + v.len * S
    const r = h / 2
    let d = ''
    if (v.shape === 'parejo')
      d = `M${X0},${yt} L${x1 - r},${yt} A${r},${r} 0 0 1 ${x1 - r},${yb} L${X0},${yb} Z`
    else if (v.shape === 'torpedo')
      d = `M${X0},${yt} L${x1 - h * 1.5},${yt} Q${x1 - h * 0.3},${yt + h * 0.12} ${x1},${yc} Q${x1 - h * 0.3},${yb - h * 0.12} ${x1 - h * 1.5},${yb} L${X0},${yb} Z`
    else if (v.shape === 'belicoso')
      d = `M${X0},${yt} L${x1 - h * 0.9},${yt} Q${x1},${yt + h * 0.22} ${x1},${yc} Q${x1},${yb - h * 0.22} ${x1 - h * 0.9},${yb} L${X0},${yb} Z`
    else // perfecto: narrow foot, gentle belly, tapered cap
      d = `M${X0},${yc - h * 0.22} Q${X0 + h * 1.2},${yt} ${X0 + (x1 - X0) / 2},${yt} Q${x1 - h * 0.5},${yt} ${x1},${yc} Q${x1 - h * 0.5},${yb} ${X0 + (x1 - X0) / 2},${yb} Q${X0 + h * 1.2},${yb} ${X0},${yc + h * 0.22} Z`
    rows.push(`<path d="${d}" fill="url(#vleaf)" stroke="rgba(200,151,90,.4)" stroke-width="1"/>`)
    // the band, worn just shy of the cap
    const bx = X0 + (x1 - X0) * 0.72
    rows.push(`<rect x="${bx.toFixed(1)}" y="${(yt + 1.5).toFixed(1)}" width="9" height="${(h - 3).toFixed(1)}" fill="#c8975a" opacity=".85"/>`)
    rows.push(`<text x="${X0 - 16}" y="${yc + 5}" text-anchor="end" font-size="16" fill="#f0e6d6" font-family="Georgia,serif">${v.n}</text>`)
    rows.push(`<text x="${x1 + 16}" y="${yc - 3}" font-size="12" fill="#c9bba6" font-family="Georgia,serif">${v.len}&#8243; &#215; ${v.rg}</text>`)
    rows.push(`<text x="${x1 + 16}" y="${yc + 13}" font-size="11.5" font-style="italic" fill="#8d7f6f" font-family="Georgia,serif">${v.note}</text>`)
  })
  const H = VITOLAS.length * ROW + 20
  const RULER = X0 + 7.5 * S
  const ticks: string[] = []
  for (let inch = 0; inch <= 7; inch++) {
    const x = X0 + inch * S
    ticks.push(`<line x1="${x}" y1="${H - 12}" x2="${x}" y2="${H - 4}" stroke="rgba(200,151,90,.4)"/>`)
    ticks.push(`<text x="${x}" y="${H + 12}" text-anchor="middle" font-size="10" fill="#8d7f6f" font-family="Georgia,serif">${inch}&#8243;</text>`)
  }
  return `<svg viewBox="0 0 ${RULER + 190} ${H + 20}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Twelve vitolas drawn to scale — length and ring gauge">
  <defs><linearGradient id="vleaf" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#7c5433"/><stop offset="45%" stop-color="#5C3D2E"/><stop offset="100%" stop-color="#3a2417"/>
  </linearGradient></defs>
  <line x1="${X0}" y1="${H - 8}" x2="${RULER}" y2="${H - 8}" stroke="rgba(200,151,90,.4)"/>
  ${ticks.join('\n  ')}
  ${rows.join('\n  ')}
</svg>`
}

// The nine wrapper shades, light to dark — swatch strip for the catalog page.
const WRAPPERS: Array<[string, string, string]> = [
  ['Claro', '#d9b380', 'shade-grown, silky'],
  ['Connecticut', '#d2a86e', 'the gentle classic'],
  ['Natural', '#b98a52', 'sun, but not too much'],
  ['Sumatra', '#a4703c', 'sweet-spiced island leaf'],
  ['Habano', '#96603a', 'Cuban-seed intensity'],
  ['Colorado', '#8a4f2f', 'the reddish middle path'],
  ['Colorado Maduro', '#6e3a22', 'deeper, richer'],
  ['Maduro', '#4a2617', 'long-fermented, sweet-dark'],
  ['Oscuro', '#2b1710', 'as dark as it goes'],
]
const wrapperSwatches = WRAPPERS.map(([n, c, s]) => `
        <div><span class="sw" style="background:${c}"></span><span class="t">${n}</span><span class="s">${s}</span></div>`).join('')

const STRENGTHS: Array<[string, number, string]> = [
  ['Mild', 1, 'a first light — cream, hay, gentleness'],
  ['Mild-Medium', 2, 'flavor arrives, the nicotine stays polite'],
  ['Medium', 3, 'the broad middle of most evenings'],
  ['Medium-Full', 4, 'leans in — after dinner, not before'],
  ['Full', 5, 'demands a chair, a drink, and your attention'],
]
const strengthRows = STRENGTHS.map(([n, k, s]) => `
        <div class="row" style="border-top:1px solid rgba(200,151,90,.1);display:flex;align-items:baseline;gap:.9rem;padding:.55rem .1rem">
          <span style="flex:0 0 7.6rem;color:var(--cream)">${n}</span>
          <span class="pips">${[1, 2, 3, 4, 5].map(p => `<i${p <= (k as number) ? ' class="on"' : ''}></i>`).join('')}</span>
          <span class="muted" style="font-size:.85rem;font-style:italic">${s}</span>
        </div>`).join('')

// The starter humidor, showcased from the same CIGARS array the flavor
// wheel matches against and the lounge concierge answers from.
const starterCards = CIGARS.map(c => `
        <div class="card">
          <h3>${c.n}</h3>
          <p style="font-size:.76rem;letter-spacing:.08em;color:var(--faint);margin-bottom:.5rem">${c.v} · ${c.w} · ${c.o}</p>
          <p class="pips" style="margin-bottom:.6rem">${[1, 2, 3, 4, 5].map(p => `<i${p <= c.s ? ' class="on"' : ''}></i>`).join('')}</p>
          <p style="font-size:.88rem">${c.f.join(' · ')}</p>
          <p style="margin-top:.55rem;font-size:.82rem;font-style:italic;color:var(--gold-bright)">for ${c.m}</p>
        </div>`).join('')

// ─── pages ───────────────────────────────────────────────────────────

function buildPages(
  chromeSig: string,
  art: Record<string, string | undefined> = {},
  loungeScript = '',
): Array<{ segments: string[]; label: string; html: string }> {
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
      <div class="rule"><p class="kicker">by the numbers</p></div>
      <div class="facts">
        <div><span class="n">41</span><span class="t">spoken keywords</span></div>
        <div><span class="n">63</span><span class="t">flavors on the wheel</span></div>
        <div><span class="n">10</span><span class="t">flavor families</span></div>
        <div><span class="n">6</span><span class="t">facets per entry</span></div>
        <div><span class="n">14</span><span class="t">starter blends</span></div>
        <div><span class="n">1</span><span class="t">circle, closed</span></div>
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
      <figure class="chart" style="max-width:640px;margin-left:auto;margin-right:auto">
        <svg viewBox="0 0 560 560" role="img" aria-label="The Revolución loop — six stations on one circle: journal, vocabulary, discovery, insight, blends, moments">
          <circle cx="280" cy="280" r="182" fill="none" stroke="rgba(200,151,90,.3)" stroke-width="1.5" stroke-dasharray="3 9"/>
          <g fill="none" stroke="#c8975a" stroke-width="1.5">
            <path d="M370,124 l14,-4 -6,13" /><path d="M436,370 l4,14 -13,-6"/><path d="M124,436 l-14,4 6,-13"/>
          </g>
          <g font-family="Georgia,serif" text-anchor="middle">
            <g transform="translate(280 98)"><polygon points="0,-46 40,-23 40,23 0,46 -40,23 -40,-23" fill="#1b1520" stroke="#c8975a" stroke-width="1.6"/><text y="-4" font-size="15" fill="#f0e6d6">a moment,</text><text y="15" font-size="15" fill="#f0e6d6">journaled</text></g>
            <g transform="translate(438 189)"><polygon points="0,-46 40,-23 40,23 0,46 -40,23 -40,-23" fill="#1b1520" stroke="#c8975a" stroke-width="1.6"/><text y="-4" font-size="15" fill="#f0e6d6">a shared</text><text y="15" font-size="15" fill="#f0e6d6">vocabulary</text></g>
            <g transform="translate(438 371)"><polygon points="0,-46 40,-23 40,23 0,46 -40,23 -40,-23" fill="#1b1520" stroke="#c8975a" stroke-width="1.6"/><text y="-4" font-size="15" fill="#f0e6d6">discovery &amp;</text><text y="15" font-size="15" fill="#f0e6d6">community</text></g>
            <g transform="translate(280 462)"><polygon points="0,-46 40,-23 40,23 0,46 -40,23 -40,-23" fill="#1b1520" stroke="#c8975a" stroke-width="1.6"/><text y="-4" font-size="15" fill="#f0e6d6">insight for</text><text y="15" font-size="15" fill="#f0e6d6">the makers</text></g>
            <g transform="translate(122 371)"><polygon points="0,-46 40,-23 40,23 0,46 -40,23 -40,-23" fill="#1b1520" stroke="#c8975a" stroke-width="1.6"/><text y="-4" font-size="15" fill="#f0e6d6">blends named</text><text y="15" font-size="15" fill="#f0e6d6">for moments</text></g>
            <g transform="translate(122 189)"><polygon points="0,-46 40,-23 40,23 0,46 -40,23 -40,-23" fill="#1b1520" stroke="#c8975a" stroke-width="1.6"/><text y="-4" font-size="15" fill="#f0e6d6">richer</text><text y="15" font-size="15" fill="#f0e6d6">evenings</text></g>
            <text x="280" y="268" font-size="13" letter-spacing="5" fill="#c8975a">REVOLUCIÓN</text>
            <text x="280" y="296" font-size="19" font-style="italic" fill="#f0e6d6">the loop</text>
          </g>
        </svg>
        <figcaption>six stations · one circle · nothing leaks out sideways</figcaption>
      </figure>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">one evening, end to end</p></div>
      <h2>Follow a single moment through the whole ecosystem.</h2>
      <div class="steps">
        <div class="step"><span class="n">I · the patio</span><p>Golden hour, crisp air, close friends,
          a maduro and a glass of scotch. You press <b>speak</b> and tell it like it was — nine
          keywords become nine tiles before the ash gets long.</p></div>
        <div class="step"><span class="n">II · the journal</span><p>The entry keeps the whole scene:
          cigar, flavors off the wheel, ratings, the scotch, the occasion, a photo of the band.
          Not a review — a moment you can revisit.</p></div>
        <div class="step"><span class="n">III · the vocabulary</span><p>Yours wasn't the only
          <i>conversation</i> evening this month. The word starts to mean something across the
          circle — spoken, not marketed.</p></div>
        <div class="step"><span class="n">IV · discovery</span><p>Next October, when the crisp air
          returns, discovery already knows what belongs in your hand — and who else's evenings
          rhyme with yours.</p></div>
        <div class="step"><span class="n">V · the makers</span><p>Aggregated and anonymized, a
          thousand evenings like yours tell a blender the truth no focus group can:
          what their cigar is <i>for</i>.</p></div>
        <div class="step"><span class="n">VI · the blend</span><p>A year on, a cigar called
          <i>Sobremesa — the conversation blend</i> arrives. It was named by evenings like the
          one you journaled. The circle closes.</p></div>
      </div>
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

    <section class="section">
      <div class="rule"><p class="kicker">three voices</p></div>
      <div class="cards">
        <div class="moment"><span class="who">a newcomer</span>
          <p class="tale">"I expected a test. I got a <b>welcome</b> — something mild, honest
          about the pepper, and a journal that made my first evening feel worth keeping."</p>
          <p class="after">first light · petit corona · coffee</p></div>
        <div class="moment"><span class="who">a regular</span>
          <p class="tale">"I used to say <b>medium-bodied Nicaraguan</b>. Now I say I want a
          <b>reflection</b> evening — and the difference is the whole point."</p>
          <p class="after">reflection · maduro · one chair, long view</p></div>
        <div class="moment"><span class="who">a maker</span>
          <p class="tale">"For twenty years I guessed what my cigars were for. Now a thousand
          journaled evenings <b>tell me</b> — and nobody tells me what to make."</p>
          <p class="after">insight · anonymized · consent-first</p></div>
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
    .sheet .rule::before{background:#8c3a1c}
    .sheet .kicker::before{background:linear-gradient(90deg,transparent,#8c3a1c)}
    .sheet .card::before{border-color:#7a4720}
    .sheet .card::after{border-color:#7a4720}
    .sheet .card{box-shadow:0 1px 3px rgba(59,42,24,.18)}
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
  <style>
    .composer{border:1px solid var(--gold);background:linear-gradient(160deg,var(--coal),var(--smoke));
      padding:1.8rem 2rem;margin:2.2rem 0 0}
    .composer .say{font-size:1.18rem;font-style:italic;line-height:2;min-height:4.2rem;color:var(--cream)}
    .composer .say b{font-style:normal;font-weight:400;color:var(--gold-bright);
      border-bottom:1px dotted var(--gold);padding-bottom:1px}
    .composer .tally{margin-top:.9rem;font-size:.72rem;letter-spacing:.24em;text-transform:uppercase;color:var(--faint)}
    .composer .tally i{font-style:normal;color:var(--gold-bright)}
    .pickzone .chip{cursor:pointer;user-select:none}
    .pickzone .chip:hover{border-color:var(--gold)}
    .catline{display:flex;align-items:baseline;gap:1rem;flex-wrap:wrap}
    .catline .count{font-size:.7rem;letter-spacing:.22em;color:var(--faint);text-transform:uppercase}
  </style>
  <main class="wrap">
    <section class="hero">
      <p class="kicker">the experience · a spoken grammar</p>
      <h1>Say it, and it <i>appears</i>.</h1>
      <p class="lede">Forty-one keywords make up the language of moments. Each one is a tile
      with a predefined look and behavior — a crafted world, not an automated one. A
      deterministic script listens for the words and sets the scene; no AI stands between
      what you said and what appears.</p>
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
      <div class="rule"><p class="kicker">how a word becomes a tile</p></div>
      <div class="flow">
        <span>you speak</span><i>→</i>
        <span>the grammar hears a keyword</span><i>→</i>
        <span>its tile arrives in the scene</span><i>→</i>
        <span>you nudge it until it's true</span><i>→</i>
        <span>the entry is the scene</span>
      </div>
      <p class="muted">Say "cloudy" and the clouds drift in. Say "scotch" and the glass
      arrives. The vague and the poetic can wait for help later — the scene itself stays
      deterministic, crafted, and yours.</p>
    </section>

    <section class="section pickzone" id="pickzone">
      <div class="rule"><p class="kicker">try the grammar — tap the words of your evening</p></div>

      <div class="composer">
        <p class="say" id="sayLine"></p>
        <p class="tally" id="sayTally"></p>
      </div>

      <div class="section" style="padding-top:2.6rem">
        <div class="catline"><h3>Weather</h3><span class="count">6 words · the sky obeys</span></div>
        <p class="muted">The first thing the scene sets — light, cloud, and air.</p>
        <div class="chips" data-cat="weather"><span class="chip">sunny</span><span class="chip">cloudy</span><span class="chip">rain</span><span class="chip">breeze</span><span class="chip lit">crisp air</span><span class="chip">warm night</span></div>
      </div>
      <div class="section">
        <div class="catline"><h3>Time</h3><span class="count">5 words · the light angle</span></div>
        <p class="muted">Morning coffee smoke and midnight smoke are different countries.</p>
        <div class="chips" data-cat="time"><span class="chip">morning</span><span class="chip">afternoon</span><span class="chip lit">golden hour</span><span class="chip">evening</span><span class="chip">late night</span></div>
      </div>
      <div class="section">
        <div class="catline"><h3>Setting</h3><span class="count">8 words · where the chair sits</span></div>
        <div class="chips" data-cat="setting"><span class="chip lit">patio</span><span class="chip">lounge</span><span class="chip">garden</span><span class="chip">beach</span><span class="chip">fireside</span><span class="chip">cabin</span><span class="chip">golf course</span><span class="chip">rooftop</span></div>
      </div>
      <div class="section">
        <div class="catline"><h3>Company</h3><span class="count">5 words · who shared the hour</span></div>
        <div class="chips" data-cat="company"><span class="chip">solo</span><span class="chip lit">close friends</span><span class="chip">family</span><span class="chip">new faces</span><span class="chip">celebration crowd</span></div>
      </div>
      <div class="section">
        <div class="catline"><h3>Mood</h3><span class="count">7 words · the heart of the vocabulary</span></div>
        <p class="muted">These are the words that become the names people ask for —
        <a href="/revolucion/collaborations">the named experiences</a> grow from here.</p>
        <div class="chips" data-cat="mood"><span class="chip">reflection</span><span class="chip lit">conversation</span><span class="chip">celebration</span><span class="chip">focus</span><span class="chip">unwind</span><span class="chip">gratitude</span><span class="chip">milestone</span></div>
      </div>
      <div class="section">
        <div class="catline"><h3>Drinks</h3><span class="count">10 words · what stood beside it</span></div>
        <div class="chips" data-cat="drinks"><span class="chip">coffee</span><span class="chip">espresso</span><span class="chip">whiskey</span><span class="chip lit">scotch</span><span class="chip">rum</span><span class="chip">wine</span><span class="chip">beer</span><span class="chip">tea</span><span class="chip">hot chocolate</span><span class="chip">water</span></div>
      </div>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">why it matters</p></div>
      <h2>From taste to knowledge.</h2>
      <p class="lede" style="max-width:46rem">Over time the tiles build a knowledge graph. Not
      <span class="muted">"this person likes maduro"</span> — but "they like it on cool evenings,
      outdoors, with close friends and coffee." That is a richer truth than any star rating,
      and it belongs to the person who lived it.</p>
      <div class="btns"><a class="btn" href="/revolucion/discovery">See what it unlocks</a>
      <a class="btn ghost" href="/revolucion/journal">Speak a real one</a></div>
    </section>
  </main>
  <script>
  (function(){
    var zone = document.getElementById('pickzone');
    var line = document.getElementById('sayLine');
    var tally = document.getElementById('sayTally');
    if (!zone || !line || !tally) return;
    function picked(cat){
      var out = [];
      var box = zone.querySelector('.chips[data-cat="' + cat + '"]');
      if (!box) return out;
      var lit = box.querySelectorAll('.chip.lit');
      for (var i = 0; i < lit.length; i++) out.push('<b>' + lit[i].textContent + '</b>');
      return out;
    }
    function join(ws){
      if (ws.length <= 1) return ws.join('');
      return ws.slice(0, -1).join(', ') + ' and ' + ws[ws.length - 1];
    }
    function render(){
      var w = picked('weather'), t = picked('time'), s = picked('setting'),
          c = picked('company'), m = picked('mood'), d = picked('drinks');
      var n = w.length + t.length + s.length + c.length + m.length + d.length;
      if (!n){
        line.innerHTML = '&ldquo;&hellip;&rdquo; &mdash; tap the words below and the entry writes itself.';
        tally.innerHTML = '<i>0</i> tiles in the scene';
        return;
      }
      var parts = [];
      if (t.length || s.length){
        var open = join(t.length ? t : []);
        if (s.length) open += (open ? ' on the ' : 'On the ') + join(s);
        if (open) parts.push(open.charAt(0).toUpperCase() === open.charAt(0) ? open : open);
      }
      if (w.length) parts.push(join(w) + ' coming in');
      var sent = parts.join(', ');
      var tail = [];
      function cap(str){ return str.replace(/^((?:<[^>]+>)*)(.)/, function(_, tags, ch){ return tags + ch.toUpperCase(); }); }
      if (c.length) tail.push(join(c));
      if (d.length) tail.push(join(d) + ' beside it');
      if (tail.length) sent += (sent ? '. ' : '') + cap(tail.join(', '));
      if (m.length) sent += (sent ? ' &mdash; ' : '') + 'a ' + join(m) + ' evening';
      sent = cap(sent || join(w.concat(t, s, c, m, d)));
      line.innerHTML = '&ldquo;' + sent + '.&rdquo;';
      tally.innerHTML = '<i>' + n + '</i> tile' + (n === 1 ? '' : 's') + ' in the scene &mdash; before the ash gets long';
    }
    zone.addEventListener('click', function(ev){
      var chip = ev.target.closest ? ev.target.closest('.chip') : null;
      if (!chip || !zone.contains(chip)) return;
      chip.classList.toggle('lit');
      render();
    });
    render();
  })();
  </script>`)

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
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">vitolas — drawn to scale</p></div>
      <h2>The shape decides the hour.</h2>
      <p class="muted" style="max-width:44rem">Length sets how long the evening runs; ring gauge sets
      how much air moves through it. A lancero is a wrapper tasting; a gordo is a wide, cool seat.
      Every silhouette below is drawn from its true dimensions.</p>
      <figure class="chart"><div style="overflow-x:auto">${vitolaSvg()}</div>
        <figcaption>twelve vitolas · true length &amp; ring gauge · the band sits shy of the cap</figcaption></figure>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">wrappers — light to dark</p></div>
      <h2>The leaf you see is half the taste.</h2>
      <p class="muted" style="max-width:44rem">The wrapper is a single leaf, and it can carry more than
      half a cigar's flavor. Read the strip like a horizon at dusk — pale morning cream on the left,
      long-fermented midnight on the right.</p>
      <div class="swatches">${wrapperSwatches}
      </div>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">strength — five honest steps</p></div>
      <p class="muted" style="max-width:44rem">Strength is nicotine, not flavor — a full cigar can be
      subtle and a mild one loud. We mark it in leaf pips so nobody gets ambushed.</p>
      <div style="border:1px solid var(--hairline);background:var(--coal);padding:.6rem 1.1rem;margin:1.6rem 0;max-width:44rem">${strengthRows}
      </div>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">origins — nine terroirs</p></div>
      <div class="cards">
        <div class="card"><h3>Cuba</h3><p>The old country of the leaf — twang, cedar, and myth in equal measure.</p></div>
        <div class="card"><h3>Nicaragua</h3><p>Volcanic soil, bold pepper-and-earth blends — the modern powerhouse.</p></div>
        <div class="card"><h3>Dominican Republic</h3><p>Refinement and balance; the long, polite conversation of tobaccos.</p></div>
        <div class="card"><h3>Honduras</h3><p>Rustic and hearty — leather, wood, and no apologies.</p></div>
        <div class="card"><h3>Ecuador</h3><p>Cloud-grown wrapper country; the permanent shade makes silk.</p></div>
        <div class="card"><h3>Mexico</h3><p>San Andrés maduro leaf — dark, mineral, quietly sweet.</p></div>
        <div class="card"><h3>Brazil</h3><p>Mata Fina and Arapiraca — cocoa-dark leaves with a soft center.</p></div>
        <div class="card"><h3>Cameroon</h3><p>The toothy African wrapper — spice and sweetness in a grainy coat.</p></div>
        <div class="card"><h3>United States</h3><p>Connecticut shade and broadleaf — the river valley that wrapped a century.</p></div>
      </div>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">the starter humidor</p></div>
      <h2>Fourteen blends, named for moments.</h2>
      <p class="muted" style="max-width:46rem">An invented starter catalog — no real brands — shared by
      <a href="/revolucion/flavor-wheel">the flavor wheel</a>'s matcher and
      <a href="/revolucion/lounge">the lounge</a> concierge, so no two pages ever disagree about
      what's resting in the humidor. Every one carries its flavors and the moment it was blended for.</p>
      <div class="cards">${starterCards}
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
      <p class="lede">Drag or scroll to spin the wheel. Tap a family and it turns into the scope notch on the
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
    var CIGARS = ${JSON.stringify(CIGARS)};
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
    var lastNotch = null;   // flavor label last rendered at the notch
    var wheelAcc = 0, lastWheelT = 0; // trackpad scroll accumulator

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
        liveTick();
        if (k < 1) requestAnimationFrame(step); else fin();
      }
      requestAnimationFrame(step);
      setTimeout(fin, dur + 200);
    }
    // one scroll tick = the adjacent flavor dead-center in the notch — the
    // whole selection presentation (station, scope list, raised slice)
    // updates on THIS tick, never deferred to the end of the gesture
    function stepNotch(dir){
      var t = notchAt(); if (!t) return;
      var mids = [];
      SEGS.forEach(function(sg){
        var n = sg.fm.flavors.length, fw = (sg.a1 - sg.a0) / n;
        sg.fm.flavors.forEach(function(lb, j){ mids.push(sg.a0 + (j + .5) * fw); });
      });
      var idx = 0, bd = 1e9;
      mids.forEach(function(m, i){ var dd = Math.abs(m - t.mid); if (dd < bd){ bd = dd; idx = i; } });
      // dir +1 spins clockwise: the slice above the notch drops into it
      var next = mids[((idx - dir) % mids.length + mids.length) % mids.length];
      var delta = ((SCOPE_AT - next - state.rot) % 360 + 540) % 360 - 180;
      state.rot += delta;
      animId++; // cancel any in-flight snap/spin animation
      drawRot(); updateStation(); updateScope();
    }
    // live tracking during a spin: station always; wheel visuals + scope list
    // whenever a new flavor crosses the notch
    function liveTick(){
      var t = notchAt();
      if ((t ? t.lb : null) !== lastNotch){ drawRot(); updateScope(); }
      updateStation();
    }

    // ---- wheel ------------------------------------------------------------
    // rebuild ONLY the spinning group, in place — the <svg> (with its pointer
    // capture and listeners) survives, so this is safe mid-drag and mid-scroll
    function drawRot(){
      var rot = host.querySelector('#rot');
      if (!rot) return;
      while (rot.firstChild) rot.removeChild(rot.firstChild);
      rot.setAttribute('transform', 'rotate(' + state.rot + ' ' + C + ' ' + C + ')');
      var active = notchAt(); // the family + flavor sitting at the notch
      lastNotch = active ? active.lb : null;

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
    }

    function drawWheel(){
      host.innerHTML = '';
      var svg = el('svg', { viewBox: '0 0 780 780' }, host);
      el('circle', { cx: C, cy: C, r: R_OUT + R_RAISE + 5, fill: 'none', stroke: 'rgba(200,151,90,.28)', 'stroke-width': 1 }, svg);
      el('g', { id: 'rot' }, svg);
      drawRot();

      // fixed hub (does not spin)
      el('circle', { cx: C, cy: C, r: R_HUB, fill: '#14101a', stroke: 'rgba(200,151,90,.4)', 'stroke-width': 1, 'class': 'hub' }, svg);
      [{ t: 'REVOLUCI\\u00d3N', y: C - 22, s: 13, c: '#c8975a', ls: 5 },
       { t: 'drag or scroll to spin', y: C + 6, s: 16, c: '#f0e6d6' },
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
        liveTick(); // station + scope list + raised slice track EVERY crossing
      });
      function endDrag(){
        if (!dragging) return;
        dragging = false; svg.classList.remove('dragging');
        if (dragMoved) snapToNotch(); // land the nearest flavor in the notch, then re-orient labels
        setTimeout(function(){ dragMoved = false; }, 0);
      }
      svg.addEventListener('pointerup', endDrag);
      svg.addEventListener('pointercancel', endDrag);

      // ---- scroll to spin: one flavor per wheel tick, selection lands NOW --
      svg.addEventListener('wheel', function(ev){
        ev.preventDefault(); // the wheel eats the scroll — the page stays put
        var d = ev.deltaY;
        if (ev.deltaMode === 1) d *= 33; else if (ev.deltaMode === 2) d *= 100;
        if (ev.timeStamp - lastWheelT > 250) wheelAcc = 0;
        lastWheelT = ev.timeStamp;
        // a discrete mouse notch steps exactly one flavor per tick;
        // trackpads accumulate their small deltas up to the same step
        if (Math.abs(d) >= 90){ stepNotch(d > 0 ? 1 : -1); wheelAcc = 0; return; }
        wheelAcc += d;
        if (Math.abs(wheelAcc) >= 90){ stepNotch(wheelAcc > 0 ? 1 : -1); wheelAcc = 0; }
      }, { passive: false });
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
        liveTick();
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
    // the scope section FOLLOWS the notch — whatever family is dialed in
    // is the active section, no separate click-state to manage
    function updateScope(){
      var act = notchAt();
      var ftitle = document.getElementById('focusTitle');
      var flist = document.getElementById('focusList');
      if (!ftitle || !flist) return;
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
    }
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

      updateScope();

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
      <div class="rule"><p class="kicker">the knowledge graph</p></div>
      <h2>What a rating can't hold.</h2>
      <p class="muted" style="max-width:44rem">A star collapses an evening into one digit. The graph
      keeps the evening: the cigar sits at the center, and every facet of the moment — flavor,
      weather, company, drink, mood — stays connected to it. Recommendations walk these edges.</p>
      <figure class="chart" style="max-width:720px">
        <svg viewBox="0 0 720 420" role="img" aria-label="A knowledge-graph constellation: one cigar linked to flavor, weather, company, pairing and mood nodes">
          <g stroke="rgba(200,151,90,.35)" stroke-width="1.2">
            <line x1="360" y1="210" x2="150" y2="90"/><line x1="360" y1="210" x2="565" y2="80"/>
            <line x1="360" y1="210" x2="640" y2="235"/><line x1="360" y1="210" x2="545" y2="345"/>
            <line x1="360" y1="210" x2="180" y2="330"/><line x1="360" y1="210" x2="90" y2="210"/>
            <line x1="150" y1="90" x2="90" y2="210" stroke-dasharray="2 6"/>
            <line x1="565" y1="80" x2="640" y2="235" stroke-dasharray="2 6"/>
            <line x1="180" y1="330" x2="545" y2="345" stroke-dasharray="2 6"/>
          </g>
          <g font-family="Georgia,serif" text-anchor="middle">
            <g transform="translate(360 210)"><polygon points="0,-52 45,-26 45,26 0,52 -45,26 -45,-26" fill="#1b1520" stroke="#c8975a" stroke-width="2"/>
              <text y="-8" font-size="15" fill="#e0b578">the maduro</text><text y="12" font-size="12" font-style="italic" fill="#c9bba6">one cigar, kept whole</text></g>
            <g transform="translate(150 90)"><polygon points="0,-34 29,-17 29,17 0,34 -29,17 -29,-17" fill="#241c2b" stroke="#5C3D2E" stroke-width="1.5"/>
              <text y="-2" font-size="12" fill="#f0e6d6">dark</text><text y="12" font-size="12" fill="#f0e6d6">chocolate</text></g>
            <g transform="translate(565 80)"><polygon points="0,-34 29,-17 29,17 0,34 -29,17 -29,-17" fill="#241c2b" stroke="#2C3E50" stroke-width="1.5"/>
              <text y="-2" font-size="12" fill="#f0e6d6">crisp</text><text y="12" font-size="12" fill="#f0e6d6">air</text></g>
            <g transform="translate(640 235)"><polygon points="0,-34 29,-17 29,17 0,34 -29,17 -29,-17" fill="#241c2b" stroke="#c8975a" stroke-width="1.5"/>
              <text y="-2" font-size="12" fill="#f0e6d6">golden</text><text y="12" font-size="12" fill="#f0e6d6">hour</text></g>
            <g transform="translate(545 345)"><polygon points="0,-34 29,-17 29,17 0,34 -29,17 -29,-17" fill="#241c2b" stroke="#b3542f" stroke-width="1.5"/>
              <text y="-2" font-size="12" fill="#f0e6d6">close</text><text y="12" font-size="12" fill="#f0e6d6">friends</text></g>
            <g transform="translate(180 330)"><polygon points="0,-34 29,-17 29,17 0,34 -29,17 -29,-17" fill="#241c2b" stroke="#8B6914" stroke-width="1.5"/>
              <text y="4" font-size="12" fill="#f0e6d6">coffee</text></g>
            <g transform="translate(90 210)"><polygon points="0,-34 29,-17 29,17 0,34 -29,17 -29,-17" fill="#241c2b" stroke="#e0b578" stroke-width="1.5"/>
              <text y="4" font-size="12" fill="#f0e6d6">reflection</text></g>
          </g>
        </svg>
        <figcaption>solid edges: this evening · dotted edges: patterns across many evenings</figcaption>
      </figure>
    </section>

    <section class="section" id="kindred">
      <div class="rule"><p class="kicker">try it — teach it three flavors</p></div>
      <h2>A small taste of the matcher.</h2>
      <p class="muted" style="max-width:44rem">Tap the flavors you love and watch the starter humidor
      answer — the same Jaccard-scored matching the real discovery engine grows from, computed right
      here on the page. Nothing leaves it.</p>
      <div class="chips" id="kinChips" style="margin:1.6rem 0"></div>
      <div id="kinOut" style="max-width:44rem"></div>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">an honest example</p></div>
      <blockquote>You like maduros. But more truly: you like them on cool evenings, outdoors,
      with close friends and coffee. So when the crisp air comes back in October —
      we'll know exactly what to put in your hand.
        <cite>— what discovery actually knows</cite></blockquote>
      <div class="btns"><a class="btn" href="/revolucion/journal">Teach it your taste</a>
      <a class="btn ghost" href="/revolucion/flavor-wheel">Open the full wheel</a></div>
    </section>
  </main>
  <script>
  (function(){
    var CIGARS = ${JSON.stringify(CIGARS)};
    var POOL = ['Dark Chocolate','Cedar','Leather','Caramel','Black Pepper','Cream','Espresso','Campfire','Honey','Citrus','Fig','Toast','Grass','Molasses','Dried Fruit','Charcoal'];
    var chips = document.getElementById('kinChips');
    var out = document.getElementById('kinOut');
    if (!chips || !out) return;
    POOL.forEach(function(f){
      var el = document.createElement('span');
      el.className = 'chip'; el.textContent = f; el.style.cursor = 'pointer';
      el.addEventListener('click', function(){ el.classList.toggle('lit'); render(); });
      chips.appendChild(el);
    });
    function render(){
      var sel = [];
      var lit = chips.querySelectorAll('.chip.lit');
      for (var i = 0; i < lit.length; i++) sel.push(lit[i].textContent);
      if (!sel.length){
        out.innerHTML = '<p class="muted" style="font-style:italic">The humidor is listening.</p>';
        return;
      }
      var scored = CIGARS.map(function(c){
        var hit = c.f.filter(function(f){ return sel.indexOf(f) >= 0; });
        var union = {}; c.f.concat(sel).forEach(function(f){ union[f] = 1; });
        return { c: c, hit: hit, score: hit.length / Object.keys(union).length };
      }).filter(function(s){ return s.hit.length; })
        .sort(function(a, b){ return b.score - a.score; }).slice(0, 3);
      if (!scored.length){
        out.innerHTML = '<p class="muted" style="font-style:italic">Nothing in the starter humidor carries those yet — the community catalog would.</p>';
        return;
      }
      out.innerHTML = scored.map(function(s){
        var fl = s.c.f.map(function(f){
          return s.hit.indexOf(f) >= 0 ? '<b style="font-weight:400;color:var(--gold-bright)">' + f + '</b>' : f;
        }).join(' · ');
        return '<div style="border-left:2px solid var(--gold);padding:.6rem .9rem;margin:.6rem 0;background:rgba(27,21,32,.6)">'
          + '<div style="color:var(--gold-bright)">' + s.c.n + '</div>'
          + '<div style="font-size:.75rem;color:var(--faint);letter-spacing:.04em">' + s.c.v + ' · ' + s.c.w + ' · ' + s.c.o + ' — for ' + s.c.m + '</div>'
          + '<div style="font-size:.86rem;color:var(--cream-dim);margin-top:.25rem">' + fl + '</div>'
          + '<div class="meter" style="margin:.5rem 0 0"><i style="width:' + Math.round(s.score * 100) + '%"></i></div>'
          + '</div>';
      }).join('');
    }
    render();
  })();
  </script>`)

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
      <div class="rule"><p class="kicker">shared moments — scenes, not reviews</p></div>
      <div class="cards">
        <div class="moment"><span class="who">rooftop · golden hour · new faces</span>
          <p class="tale">"Four strangers and a box of <b>coronas</b> at a wedding we almost skipped.
          By the second third we were telling stories nobody at the tables downstairs would hear.
          <b>Celebration crowd</b> undersells it."</p>
          <p class="after">celebración nº 2 · habano · prosecco, then rum</p></div>
        <div class="moment"><span class="who">cabin · rain · solo</span>
          <p class="tale">"The rain kept everyone else inside, which was the point. One
          <b>perfecto</b>, one pot of <b>coffee</b>, one problem I'd been carrying for a month —
          and somewhere in the second hour it quietly solved itself."</p>
          <p class="after">reflexión nº 1 · maduro · black coffee</p></div>
        <div class="moment"><span class="who">patio · crisp air · close friends</span>
          <p class="tale">"Nobody checked a phone. That's the whole review. <b>Crisp air</b>,
          an open bottle of <b>scotch</b>, and a conversation that refused to end even after
          the cigars did."</p>
          <p class="after">sobremesa · habano · scotch, neat</p></div>
      </div>
      <p class="muted">Every shared moment is a journal entry its author chose to open. Nothing
      is shared by default — the hive keeps your evenings private until you say otherwise.</p>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">the vocabulary, emerging</p></div>
      <h2>Words weigh what they're lived.</h2>
      <p class="muted" style="max-width:44rem">No committee writes this list. A word grows when
      evenings keep reaching for it — the size below is how often the circle has spoken each one.</p>
      <p style="line-height:2.6;max-width:46rem;margin:1.8rem 0">
        <span class="chip lit" style="font-size:1.25rem">conversation</span>
        <span class="chip lit" style="font-size:1.1rem">reflection</span>
        <span class="chip" style="font-size:1.05rem">golden hour</span>
        <span class="chip lit" style="font-size:.98rem">celebration</span>
        <span class="chip" style="font-size:.95rem">crisp air</span>
        <span class="chip" style="font-size:.9rem">unwind</span>
        <span class="chip" style="font-size:.88rem">fireside</span>
        <span class="chip" style="font-size:.85rem">gratitude</span>
        <span class="chip" style="font-size:.82rem">first light</span>
        <span class="chip" style="font-size:.8rem">sobremesa</span>
        <span class="chip" style="font-size:.78rem">milestone</span>
        <span class="chip" style="font-size:.76rem">late night</span>
        <span class="chip" style="font-size:.74rem">a breeze outside</span>
      </p>
      <p class="muted" style="font-style:italic">When a word earns enough evenings, it can become a
      <a href="/revolucion/collaborations">named experience</a> — a blend that arrives already meaning something.</p>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">circles — where it's spoken aloud</p></div>
      <div class="cards">
        <div class="card"><span class="num">monthly</span><h3>Herf Nights</h3>
          <p>The open table. Bring what you're smoking, leave with three things you've never heard of
          and one story you'll retell badly.</p></div>
        <div class="card"><span class="num">seasonal</span><h3>Tasting Circles</h3>
          <p>One blend, eight palates, the wheel open on the table. The fastest way to learn what
          "cedar" actually tastes like is to hear someone else find it first.</p></div>
        <div class="card"><span class="num">whenever</span><h3>Lounge Meetups</h3>
          <p>The unscheduled kind. A <a href="/revolucion/lounge">lounge</a>, a few chairs, and whoever
          shows up — the vocabulary's native habitat.</p></div>
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
      <div class="steps">
        <div class="step"><span class="n">I · begin mild</span><p>A petit corona in a Connecticut
          wrapper — cream, hay, forty gentle minutes. Strength is a later chapter.</p></div>
        <div class="step"><span class="n">II · hear the truth first</span><p>Before the first draw,
          someone tells you exactly what to expect — including the pepper, if it's coming.</p></div>
        <div class="step"><span class="n">III · no ceremony test</span><p>Cut it however works.
          Relight without shame. The ritual is for pleasure, not gatekeeping.</p></div>
        <div class="step"><span class="n">IV · journal the first one</span><p>Even three words.
          Your first entry is the seed everything else — discovery, kindred, the wheel — grows from.</p></div>
      </div>
      <div class="btns"><a class="btn" href="/revolucion/discovery">Find a gentle start</a>
      <a class="btn ghost" href="/revolucion/journal">Journal the first one</a></div>
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
      <div class="rule"><p class="kicker">what the dashboard shows</p></div>
      <h2>Evenings, in aggregate.</h2>
      <div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
        <figure class="chart" style="margin:0">
          <svg viewBox="0 0 340 210" role="img" aria-label="Occasions this blend is chosen for — reflection leads">
            <text x="12" y="20" font-size="11" letter-spacing="3" fill="#c8975a" font-family="Georgia,serif">OCCASIONS · ONE BLEND</text>
            <g font-family="Georgia,serif" font-size="12" fill="#c9bba6">
              <text x="12" y="52">reflection</text><rect x="110" y="40" width="196" height="15" fill="#c8975a"/>
              <text x="12" y="82">unwind</text><rect x="110" y="70" width="122" height="15" fill="rgba(200,151,90,.55)"/>
              <text x="12" y="112">conversation</text><rect x="110" y="100" width="84" height="15" fill="rgba(200,151,90,.4)"/>
              <text x="12" y="142">focus</text><rect x="110" y="130" width="58" height="15" fill="rgba(200,151,90,.3)"/>
              <text x="12" y="172">celebration</text><rect x="110" y="160" width="22" height="15" fill="rgba(200,151,90,.22)"/>
            </g>
            <text x="12" y="198" font-size="11" font-style="italic" fill="#8d7f6f" font-family="Georgia,serif">chosen for quiet evenings — market it that way</text>
          </svg>
        </figure>
        <figure class="chart" style="margin:0">
          <svg viewBox="0 0 340 210" role="img" aria-label="Pairing performance — exceeds expectations with coffee, underperforms with whisky">
            <text x="12" y="20" font-size="11" letter-spacing="3" fill="#c8975a" font-family="Georgia,serif">PAIRING PERFORMANCE</text>
            <line x1="170" y1="34" x2="170" y2="178" stroke="rgba(200,151,90,.35)"/>
            <g font-family="Georgia,serif" font-size="12" fill="#c9bba6">
              <rect x="170" y="44" width="118" height="15" fill="#c8975a"/><text x="164" y="56" text-anchor="end">coffee</text>
              <rect x="170" y="74" width="66" height="15" fill="rgba(200,151,90,.55)"/><text x="164" y="86" text-anchor="end">rum</text>
              <rect x="146" y="104" width="24" height="15" fill="rgba(179,84,47,.6)"/><text x="140" y="116" text-anchor="end">wine</text>
              <rect x="96" y="134" width="74" height="15" fill="#b3542f"/><text x="90" y="146" text-anchor="end">whisky</text>
            </g>
            <text x="176" y="172" font-size="10" fill="#8d7f6f" font-family="Georgia,serif">exceeds →</text>
            <text x="164" y="172" font-size="10" fill="#8d7f6f" text-anchor="end" font-family="Georgia,serif">← underperforms</text>
            <text x="12" y="198" font-size="11" font-style="italic" fill="#8d7f6f" font-family="Georgia,serif">a tasting-room fix no focus group would surface</text>
          </svg>
        </figure>
        <figure class="chart" style="margin:0">
          <svg viewBox="0 0 340 210" role="img" aria-label="Seasonal strength drift — the circle reaches fuller as the year cools">
            <text x="12" y="20" font-size="11" letter-spacing="3" fill="#c8975a" font-family="Georgia,serif">STRENGTH ACROSS THE YEAR</text>
            <g stroke="rgba(200,151,90,.16)"><line x1="30" y1="60" x2="320" y2="60"/><line x1="30" y1="100" x2="320" y2="100"/><line x1="30" y1="140" x2="320" y2="140"/></g>
            <g font-family="Georgia,serif" font-size="10" fill="#8d7f6f">
              <text x="24" y="63" text-anchor="end">full</text><text x="24" y="103" text-anchor="end">med</text><text x="24" y="143" text-anchor="end">mild</text>
              <text x="30" y="172">jan</text><text x="100" y="172">apr</text><text x="175" y="172">jul</text><text x="250" y="172">oct</text><text x="310" y="172">dec</text>
            </g>
            <path d="M30,84 C70,96 100,124 140,132 C185,140 215,120 250,92 C280,70 300,64 320,60" fill="none" stroke="#c8975a" stroke-width="2.5"/>
            <circle cx="250" cy="92" r="4" fill="#e0b578"/>
            <text x="12" y="198" font-size="11" font-style="italic" fill="#8d7f6f" font-family="Georgia,serif">when the crisp air returns, the circle reaches fuller</text>
          </svg>
        </figure>
      </div>
      <p class="muted" style="font-style:italic">Illustrative shapes — the real dashboard draws from
      live journals, and only once an aggregate is wide enough that no single evening shows through.</p>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">how an insight is made</p></div>
      <div class="flow">
        <span>journals, with consent</span><i>→</i>
        <span>identities stripped</span><i>→</i>
        <span>aggregated across the circle</span><i>→</i>
        <span>held until the crowd is wide enough</span><i>→</i>
        <span>one honest insight</span>
      </div>
      <p class="muted" style="max-width:46rem">The threshold matters: an aggregate too small is a
      disguise, not an anonymization. If only three people smoked a blend in October, the makers
      wait until more evenings arrive — the insight is late, or it is safe, and we choose safe.</p>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">the position</p></div>
      <blockquote>Retailers move boxes. Revolución is the fulcrum where the people who smoke
      and the people who make meet — and both leave better off.
        <cite>— why makers pick up the phone</cite></blockquote>
      <div class="privacy">
        <h3>The privacy covenant</h3>
        <p class="muted"><b style="font-weight:400;color:var(--gold-bright)">Anonymized, always.</b>
        No individual journal ever leaves the hive without its author's consent — not for makers,
        not for partners, not for us.</p>
        <p class="muted" style="margin-top:.7rem"><b style="font-weight:400;color:var(--gold-bright)">Aggregated, always.</b>
        Insights are crowds, never people. Below the threshold, the insight simply waits.</p>
        <p class="muted" style="margin-top:.7rem"><b style="font-weight:400;color:var(--gold-bright)">Consent-first, always.</b>
        Sharing is a door you open per entry, and it swings both ways — close it and the entry
        comes home. The trust is the product; we do not spend it.</p>
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
      <div class="rule"><p class="kicker">how a name is born</p></div>
      <div class="steps">
        <div class="step"><span class="n">I · the word is lived</span><p>Hundreds of journals reach
          for the same word to hold the same kind of evening. Nobody planned it.</p></div>
        <div class="step"><span class="n">II · the word is heard</span><p><a href="/revolucion/insights">The
          insights</a> surface it — anonymized, aggregated: "this is what your smokers keep asking
          their evenings to be."</p></div>
        <div class="step"><span class="n">III · the blend is built</span><p>A maker blends <i>to the
          word</i> — body, sweetness, and burn chosen for the moment, not the spec sheet.</p></div>
        <div class="step"><span class="n">IV · the name comes true</span><p>The band says what the
          evening already meant. It arrives pre-understood — no campaign required.</p></div>
      </div>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">the first three — dossiers</p></div>
      <div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(290px,1fr))">
        <div class="card"><span class="num">Nº 1</span><h3>Conversation</h3>
          <p style="font-style:italic;color:var(--cream);margin-bottom:.9rem">"For the table that
          will not stop talking."</p>
          <div class="meterrow"><span class="lbl">body</span><div class="meter"><i style="width:55%"></i></div></div>
          <div class="meterrow"><span class="lbl">sweetness</span><div class="meter"><i style="width:45%"></i></div></div>
          <div class="meterrow"><span class="lbl">spice</span><div class="meter"><i style="width:38%"></i></div></div>
          <div class="meterrow"><span class="lbl">burn patience</span><div class="meter"><i style="width:90%"></i></div></div>
          <p style="margin-top:.9rem">Medium body, long finish, and a forgiving burn that waits for
          you between stories. A corona that expects to be set down.</p>
          <div class="chips"><span class="chip">Cedar</span><span class="chip">Caramel</span><span class="chip">Toast</span><span class="chip">Black Pepper</span></div>
          <p style="margin-top:.7rem;font-size:.82rem;font-style:italic;color:var(--gold-bright)">pairs with: scotch, then whatever the table's drinking</p></div>
        <div class="card"><span class="num">Nº 2</span><h3>Reflection</h3>
          <p style="font-style:italic;color:var(--cream);margin-bottom:.9rem">"For the quiet evening
          that asks nothing of you."</p>
          <div class="meterrow"><span class="lbl">body</span><div class="meter"><i style="width:60%"></i></div></div>
          <div class="meterrow"><span class="lbl">sweetness</span><div class="meter"><i style="width:70%"></i></div></div>
          <div class="meterrow"><span class="lbl">spice</span><div class="meter"><i style="width:18%"></i></div></div>
          <div class="meterrow"><span class="lbl">burn patience</span><div class="meter"><i style="width:75%"></i></div></div>
          <p style="margin-top:.9rem">Cool-weather sweetness in a maduro coat, coffee-friendly, built
          for one chair and a long view. It ends when you're finished, not before.</p>
          <div class="chips"><span class="chip">Dark Chocolate</span><span class="chip">Molasses</span><span class="chip">Cedar</span><span class="chip">Leather</span></div>
          <p style="margin-top:.7rem;font-size:.82rem;font-style:italic;color:var(--gold-bright)">pairs with: black coffee, silence</p></div>
        <div class="card"><span class="num">Nº 3</span><h3>Celebration</h3>
          <p style="font-style:italic;color:var(--cream);margin-bottom:.9rem">"For the milestone that
          deserves smoke rings."</p>
          <div class="meterrow"><span class="lbl">body</span><div class="meter"><i style="width:78%"></i></div></div>
          <div class="meterrow"><span class="lbl">sweetness</span><div class="meter"><i style="width:52%"></i></div></div>
          <div class="meterrow"><span class="lbl">spice</span><div class="meter"><i style="width:68%"></i></div></div>
          <div class="meterrow"><span class="lbl">burn patience</span><div class="meter"><i style="width:50%"></i></div></div>
          <p style="margin-top:.9rem">Bright, confident, a touch of red pepper over brown sugar —
          a torpedo made to be handed out by the fistful.</p>
          <div class="chips"><span class="chip">Red Pepper</span><span class="chip">Brown Sugar</span><span class="chip">Cocoa</span><span class="chip">Oak</span></div>
          <p style="margin-top:.7rem;font-size:.82rem;font-style:italic;color:var(--gold-bright)">pairs with: whatever's being toasted</p></div>
      </div>
      <p class="muted">The labels are not invented in a boardroom — they emerge from community
      data, so they arrive already meaning something. People asked for reflection evenings long
      before a band said the word.</p>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">beyond the leaf</p></div>
      <h2>A reflection evening, assembled end to end.</h2>
      <p class="lede" style="max-width:46rem">The vocabulary outgrows the cigar. When the word is
      the product, anything true to the word can carry it — so one shelf, one evening, one name.</p>
      <div class="cards">
        <div class="card"><h3>The Chocolate</h3><p>A 72% single-origin bar blended dark and quiet —
          made to sit beside <i>Reflection Nº 2</i>, not compete with it.</p></div>
        <div class="card"><h3>The Coffee</h3><p>A roast profiled against the same wheel families —
          cocoa and molasses forward, bright acids held back for the evening.</p></div>
        <div class="card"><h3>The Spirit</h3><p>A cask picked for conversation: soft entry, long
          patient finish, low proof enough to keep the stories straight.</p></div>
        <div class="card"><h3>The Tea</h3><p>For the first-light shelf — a welcome that asks even
          less than coffee does.</p></div>
      </div>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">with the makers</p></div>
      <h2>Partners, not vendors.</h2>
      <p class="lede" style="max-width:46rem">Manufacturers and distributors who build to the
      vocabulary, guided by <a href="/revolucion/insights">the insights</a>. They keep their craft
      and their soul; we bring the word and the people who already live it.</p>
      <div class="btns"><a class="btn ghost" href="/revolucion/insights">For the makers</a>
      <a class="btn" href="/revolucion/community">Meet the circle</a></div>
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
      <div class="rule"><p class="kicker">the box, kept honest</p></div>
      <figure class="chart" style="max-width:760px">
        <svg viewBox="0 0 720 340" role="img" aria-label="A humidor in cross-section: cedar shelves, resting cigars, hygrometer at 68 percent">
          <defs><linearGradient id="hcedar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#8a5c33"/><stop offset="100%" stop-color="#5a3a1e"/>
          </linearGradient></defs>
          <rect x="60" y="40" width="600" height="260" rx="8" fill="#1b1520" stroke="#c8975a" stroke-width="2"/>
          <rect x="74" y="54" width="572" height="232" fill="url(#hcedar)" opacity=".24"/>
          <g stroke="#c8975a" stroke-width="1.4"><line x1="74" y1="132" x2="646" y2="132"/><line x1="74" y1="212" x2="646" y2="212"/></g>
          <g fill="#6b4a2b" stroke="rgba(200,151,90,.5)">
            <rect x="100" y="88" width="180" height="18" rx="9"/><rect x="100" y="64" width="180" height="18" rx="9"/>
            <rect x="300" y="76" width="150" height="18" rx="9"/>
            <rect x="100" y="166" width="210" height="18" rx="9"/><rect x="100" y="142" width="210" height="18" rx="9"/>
            <rect x="330" y="154" width="130" height="18" rx="9"/>
            <rect x="100" y="246" width="160" height="18" rx="9"/><rect x="100" y="222" width="160" height="18" rx="9"/>
          </g>
          <g fill="#c8975a" opacity=".85">
            <rect x="236" y="66" width="7" height="14"/><rect x="236" y="90" width="7" height="14"/><rect x="412" y="78" width="7" height="14"/>
            <rect x="258" y="144" width="7" height="14"/><rect x="258" y="168" width="7" height="14"/><rect x="428" y="156" width="7" height="14"/>
            <rect x="220" y="224" width="7" height="14"/><rect x="220" y="248" width="7" height="14"/>
          </g>
          <g font-family="Georgia,serif" font-size="12" fill="#c9bba6">
            <text x="480" y="98">this year's rotation</text>
            <text x="490" y="176">resting · 8 months</text>
            <text x="300" y="256" font-style="italic">the do-not-touch shelf</text>
          </g>
          <g transform="translate(576 236)">
            <circle r="30" fill="#141017" stroke="#c8975a" stroke-width="1.6"/>
            <path d="M0,0 L14,-16" stroke="#e0b578" stroke-width="2"/>
            <text y="20" text-anchor="middle" font-size="11" fill="#e0b578" font-family="Georgia,serif">68%</text>
          </g>
          <rect x="290" y="30" width="140" height="10" rx="5" fill="#c8975a"/>
          <text x="360" y="326" text-anchor="middle" font-size="12" font-style="italic" fill="#8d7f6f" font-family="Georgia,serif">spanish cedar · a well-seasoned quiet</text>
        </svg>
        <figcaption>65–70% humidity · 65–70&#176;F · rotate the shelves, not your patience</figcaption>
      </figure>
      <div class="facts" style="max-width:760px">
        <div><span class="n">65–70%</span><span class="t">relative humidity</span></div>
        <div><span class="n">65–70&#176;</span><span class="t">fahrenheit, steady</span></div>
        <div><span class="n">2×</span><span class="t">seasonal rotations</span></div>
        <div><span class="n">0</span><span class="t">peeks required</span></div>
      </div>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">three shelves</p></div>
      <div class="cards">
        <div class="card">${thumb('humidor/my-collection')}<h3>My Collection</h3>
          <p>What you hold now — counts, dates acquired, and the entries each cigar has already
          earned. Tap a stick and its whole journal history unfolds beneath it.</p></div>
        <div class="card">${thumb('humidor/wishlist')}<h3>Wishlist</h3>
          <p>What <a href="/revolucion/discovery">discovery</a> has convinced you to try next —
          each with the reason it earned the spot: "because your crisp-air evenings keep asking
          for it."</p></div>
        <div class="card">${thumb('humidor/aging')}<h3>Aging</h3>
          <p>What rests, and how long it has rested. The humidor remembers so you can forget
          on purpose — and taps you on the shoulder when a rest comes due.</p></div>
      </div>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">what time does in the dark</p></div>
      <div class="steps">
        <div class="step"><span class="n">3 months</span><p>The marriage. The wrapper, binder, and
          filler stop being three tobaccos and start being one cigar. The ammonia of youth fades.</p></div>
        <div class="step"><span class="n">1 year</span><p>The edges round. Pepper mellows into
          warmth; the sweetness that was hiding steps forward. Most cigars peak somewhere here.</p></div>
        <div class="step"><span class="n">3 years</span><p>The transformation. What survives is
          subtler and stranger — leather where there was spice, honey where there was heat.
          Not better, exactly. Older. Worth journaling against your own entry from year one.</p></div>
      </div>
      <p class="muted" style="max-width:46rem">The aging shelf pairs with
      <a href="/revolucion/journal">the journal</a> deliberately: smoke one now, rest its twin,
      and let your own two entries — a year apart — teach you what time actually did.</p>
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
    </section>

    <section class="section" style="max-width:46rem">
      <div class="rule"><p class="kicker">the articles</p></div>
      <div class="steps" style="grid-template-columns:1fr">
        <div class="step"><span class="n">I · the moment is the product</span><p>A cigar is an hour
          of one life. Everything we build must honor the hour, or it doesn't get built.</p></div>
        <div class="step"><span class="n">II · the journal is the foundation</span><p>Not the store,
          not the feed, not the algorithm. The lived entry comes first, and everything else is
          grown from it or it is decoration.</p></div>
        <div class="step"><span class="n">III · the vocabulary belongs to the circle</span><p>Words
          earn their place by being lived. We may notice a word; we may never mint one.</p></div>
        <div class="step"><span class="n">IV · insight flows back, never sideways</span><p>Makers
          learn who they serve — anonymized, aggregated, consent-first. Nobody learns who you are.</p></div>
        <div class="step"><span class="n">V · newcomers are met with honesty</span><p>If the pepper
          surprises, we say so first. A welcome, never a test.</p></div>
        <div class="step"><span class="n">VI · the trust is the treasury</span><p>Every decision is
          weighed against the trust it spends or earns. We do not run a deficit.</p></div>
      </div>
    </section>

    <section class="section" style="max-width:46rem">
      <div class="rule"><p class="kicker">what we will never do</p></div>
      <div class="privacy">
        <p class="muted">Sell an individual journal, ever, to anyone.</p>
        <p class="muted" style="margin-top:.6rem">Tell a maker what to make — we show them who they
        serve and stop there.</p>
        <p class="muted" style="margin-top:.6rem">Let a marketing deck name an experience the
        community hasn't lived.</p>
        <p class="muted" style="margin-top:.6rem">Score a person. We keep moments, not grades.</p>
        <p class="muted" style="margin-top:.6rem">Rush an evening. Nothing here has a timer on it.</p>
      </div>
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
    .stagewrap{display:flex;flex-direction:column;gap:0}
    .scene.stage{aspect-ratio:16/10;width:100%;position:relative;overflow:hidden;
      background:radial-gradient(ellipse at 50% 62%,#241a2a 0%,#0d0912 74%)}
    .scene.stage::after{content:'lighting the room…';position:absolute;inset:auto 0 46% 0;text-align:center;
      color:var(--faint);font-size:.8rem;letter-spacing:.28em;text-transform:uppercase}
    .scene.stage[data-ready]::after{display:none}
    .scene.stage canvas{position:relative;z-index:1}
    .stagebar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.6rem;
      border:1px solid var(--hairline);border-top:none;background:var(--coal);padding:.5rem .6rem}
    .views{display:flex;flex-wrap:wrap;gap:0}
    .vbtn{font:inherit;font-size:.76rem;letter-spacing:.2em;text-transform:uppercase;color:var(--cream-dim);
      background:transparent;border:1px solid var(--hairline);border-right-width:0;padding:.42rem .8rem;cursor:pointer}
    .vbtn:last-child{border-right-width:1px}
    .vbtn:hover{background:rgba(200,151,90,.1);color:var(--cream)}
    .vbtn.on{background:var(--gold);border-color:var(--gold);color:#171017}
    .stagebar .hint{color:var(--faint);font-size:.8rem;font-style:italic;padding-right:.35rem}
    .vbtn.open{color:var(--gold-bright);border-color:var(--gold)}

    /* full-screen room: stage left, tabbed sidebar right */
    /* above the site's own sticky header — walking in means the room, only */
    .lfull{position:fixed;inset:0;z-index:9999;background:var(--night);display:flex}
    .lfull[hidden]{display:none}
    .lf-stage{flex:1 1 auto;min-width:0;display:flex;flex-direction:column}
    .lf-stage .stagewrap{flex:1 1 auto;display:flex;flex-direction:column;min-height:0}
    .lf-stage .scene.stage{flex:1 1 auto;aspect-ratio:auto;height:auto;min-height:0}
    .lf-side{flex:0 0 340px;display:flex;flex-direction:column;border-left:1px solid var(--hairline);
      background:var(--coal);min-height:0}
    @media(max-width:820px){.lfull{flex-direction:column}.lf-side{flex:0 0 46%;border-left:none;border-top:1px solid var(--hairline)}}
    .lf-tabs{display:flex;border-bottom:1px solid var(--hairline);flex:0 0 auto}
    .lf-tabs button{flex:1;font:inherit;font-size:.76rem;letter-spacing:.24em;text-transform:uppercase;
      color:var(--cream-dim);background:transparent;border:none;border-right:1px solid var(--hairline);
      padding:.85rem .5rem;cursor:pointer}
    .lf-tabs button:last-child{border-right:none}
    .lf-tabs button:hover{background:rgba(200,151,90,.08);color:var(--cream)}
    .lf-tabs button.on{background:var(--gold);color:#171017}
    .lf-pane{flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column}
    .lf-pane[hidden]{display:none}
    .lf-pane .dpanel{border:none;background:transparent}
    .lf-close{position:absolute;top:.6rem;right:calc(340px + .6rem);z-index:2;font:inherit;font-size:.72rem;
      letter-spacing:.24em;text-transform:uppercase;color:var(--cream-dim);background:rgba(20,16,23,.8);
      border:1px solid var(--hairline);padding:.4rem .8rem;cursor:pointer}
    .lf-close:hover{color:var(--cream);background:rgba(200,151,90,.16)}
    @media(max-width:820px){.lf-close{right:.6rem}}
    /* chat */
    .chatlog{flex:1 1 auto;overflow:auto;padding:1rem 1.05rem;display:flex;flex-direction:column;gap:.8rem}
    .msg{max-width:92%;font-size:.94rem;line-height:1.62}
    .msg .who{display:block;font-size:.64rem;letter-spacing:.28em;text-transform:uppercase;
      color:var(--gold);margin-bottom:.25rem}
    .msg.you{align-self:flex-end;text-align:right}
    .msg.you .who{color:var(--faint)}
    .msg .body{border:1px solid var(--hairline);padding:.55rem .7rem;background:rgba(200,151,90,.05);
      color:var(--cream);display:inline-block;text-align:left}
    .msg.you .body{background:rgba(240,230,214,.05)}
    .msg .body a{color:var(--gold-bright)}
    .chatform{flex:0 0 auto;display:flex;border-top:1px solid var(--hairline)}
    .chatform input{flex:1;font:inherit;font-size:.94rem;color:var(--cream);background:transparent;
      border:none;padding:.85rem .9rem}
    .chatform input:focus{outline:none;background:rgba(200,151,90,.06)}
    .chatform button{font:inherit;font-size:.72rem;letter-spacing:.24em;text-transform:uppercase;
      color:#171017;background:var(--gold);border:none;padding:.7rem 1.1rem;cursor:pointer}
    .chatform button:hover{background:var(--gold-bright)}

    /* the wheel plate — what the framed wheel opens into, in-room and tidy */
    .plate{position:fixed;inset:0;z-index:10000;background:rgba(10,7,14,.78);
      display:flex;align-items:center;justify-content:center;padding:2vh 2vw}
    .plate[hidden]{display:none}
    .plate-card{width:min(880px,96vw);max-height:96vh;overflow:auto;background:var(--coal);
      border:1px solid var(--gold);box-shadow:0 0 0 1px rgba(0,0,0,.5),0 24px 60px rgba(0,0,0,.6)}
    .plate-head{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;
      padding:.9rem 1.1rem;border-bottom:1px solid var(--hairline)}
    .plate-head h3{margin:0;font-size:.74rem;letter-spacing:.34em;text-transform:uppercase;
      color:var(--gold);font-weight:400}
    .plate-head button{font:inherit;font-size:.72rem;letter-spacing:.22em;text-transform:uppercase;
      color:var(--cream-dim);background:transparent;border:1px solid var(--hairline);
      padding:.34rem .7rem;cursor:pointer}
    .plate-head button:hover{color:var(--cream);background:rgba(200,151,90,.14)}
    .plate-body{display:grid;grid-template-columns:minmax(260px,1fr) minmax(230px,.85fr);gap:1.2rem;
      padding:1.1rem}
    @media(max-width:700px){.plate-body{grid-template-columns:1fr}}
    .plate-body svg{display:block;width:100%;height:auto;touch-action:manipulation}
    .plate-body svg .seg{cursor:pointer}
    .plate-body svg .seg:hover{opacity:.86}
    .wsub h4{margin:0 0 .5rem;font-size:.68rem;letter-spacing:.28em;text-transform:uppercase;
      color:var(--gold);font-weight:400}
    .wsub{margin-bottom:1.1rem}
    .chips{display:flex;flex-wrap:wrap;gap:.3rem}
    .chip{font-size:.8rem;border:1px solid var(--hairline);padding:.22rem .5rem;color:var(--cream);
      cursor:pointer;background:rgba(200,151,90,.06)}
    .chip:hover{border-color:var(--gold)}
    .chip .x{color:var(--faint);margin-left:.35rem}
    .wempty{color:var(--faint);font-size:.86rem;font-style:italic;line-height:1.6}
    .match{border-left:2px solid var(--gold);padding:.4rem 0 .4rem .6rem;margin-bottom:.7rem}
    .match b{color:var(--cream)}
    .match .meta{display:block;color:var(--faint);font-size:.82rem}
    .match .hits{display:block;color:var(--gold-bright);font-size:.82rem}
    .plate-foot{border-top:1px solid var(--hairline);padding:.75rem 1.1rem;font-size:.86rem;
      color:var(--faint)}
    .plate-foot a{color:var(--gold-bright)}
    .dpanel{border:1px solid var(--hairline);background:var(--coal)}
    .dpanel section{padding:1.05rem 1.15rem;border-bottom:1px solid var(--hairline)}
    .dpanel section:last-child{border-bottom:none}
    .dpanel h3{font-size:.7rem;letter-spacing:.32em;text-transform:uppercase;color:var(--gold);margin:0 0 .55rem;font-weight:400}
    .drow{display:flex;align-items:center;gap:.6rem;padding:.42rem .1rem;border-top:1px solid rgba(200,151,90,.10);font-size:.95rem;cursor:pointer;color:var(--cream)}
    .drow:first-of-type{border-top:none}
    .drow:hover{background:rgba(200,151,90,.08)}
    .drow .mark{width:.9rem;color:var(--gold-bright)}
    .drow.off{color:var(--faint)}
    .drow.locked{color:var(--faint)}
    .drow.locked .mark{color:var(--ember)}
    .drow .cost{margin-left:auto;display:flex;align-items:center;gap:.3rem;
      font-size:.78rem;letter-spacing:.06em;color:var(--gold-bright)}
    .drow .cost i{width:.45rem;height:.52rem;background:var(--ember);
      clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)}
    .drow.locked.short .cost{color:var(--faint)}
    .drow.locked.short:hover .cost::after{content:' · el mercado';color:var(--faint)}
    .dpurse{display:flex;align-items:center;justify-content:space-between;gap:.6rem;
      margin:.2rem 0 .8rem;padding:.5rem .7rem;border:1px solid rgba(200,151,90,.22);
      background:rgba(179,84,47,.1);font-size:.82rem;letter-spacing:.06em;color:var(--gold-bright)}
    .dpurse a{font-size:.7rem;letter-spacing:.16em;text-transform:uppercase;color:var(--cream-dim)}
    .dpurse a:hover{color:var(--gold-bright)}
    .dnote{margin:.7rem 0 0;font-size:.78rem;color:var(--faint);line-height:1.55}
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
      <p class="lede">The fire is lit and the good seat is yours — and now you can walk around it.
      Drag the room to look: framed art on the gallery wall, the humidor cabinet lit behind glass,
      a cigar going in the ashtray, cutter and lighter within reach. Every piece is a slot, and
      the room fills up as your journal does.</p>
      <p class="lede">Step to the board on the left wall and the lounge comes with you: the
      lights go down, the regulars come over from the bar, and how many of them are standing
      at the oche is the multiplier on everything the house pays. It is still 501, still
      double out, still the Colonel — but a ton eighty in a full room is worth four of one
      thrown to nobody, the board keeps a second score of its own, a side bet is chalked up
      each leg, and now and then somebody blows a smoke ring across the twenty.</p>
    </section>
    <section class="lounge">
      <div class="stagewrap">
        <div class="scene stage" id="lounge3d" role="img"
             aria-label="A three-dimensional cigar lounge: a fire in the hearth, leather wingbacks, framed art on the walls, a humidor cabinet, and a cigar going in the ashtray"></div>
        <div class="stagebar">
          <span class="views">
            <button type="button" class="vbtn on" data-view="room">the room</button>
            <button type="button" class="vbtn" data-view="fire">the fire</button>
            <button type="button" class="vbtn" data-view="gallery">the wall</button>
            <button type="button" class="vbtn" data-view="humidor">the humidor</button>
            <button type="button" class="vbtn" data-view="darts">the darts</button>
            <button type="button" class="vbtn" data-view="miniature">the miniature</button>
            <button type="button" class="vbtn" data-view="chair">your chair</button>
            <button type="button" class="vbtn open" id="lfOpen">walk in</button>
          </span>
          <span class="hint" id="stageHint">drag to look around &middot; pick a view (or click the room) to walk in</span>
        </div>
        <div class="scene fallback" id="loungeFallback" hidden><svg viewBox="0 0 1200 640" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A warm cigar lounge: a fire going, a wingback chair with a throw, whiskey poured, and a cat asleep on the rug">
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
      </div>
      <aside class="dpanel">
        <section>
          <h3>Decorate</h3>
          <div data-decor-list></div>
        </section>
        <section>
          <h3>On the walls</h3>
          <p class="dnote">The frames hang your hive's own art — the tiles you already have,
          resolved by signature, lit by their own picture lights. The rest are prints painted
          in code: the band, the leaf, the wheel, the map of where the leaf comes from.</p>
        </section>
        <section>
          <h3>Bring your own</h3>
          <p class="dnote">Every piece in this room is a slot. Soon you will hang your own art,
          shelve your own bottles, and pin the bands of cigars you have loved — straight from
          your <a href="/revolucion/journal">journal</a> and <a href="/revolucion/humidor">humidor</a>.
          Post a moment, earn the room: see <a href="/revolucion/journal">rewards</a>.</p>
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

  <!-- walk-in: the room fills the screen, the sidebar carries Chat | Decorate -->
  <div class="lfull" id="loungeFull" hidden>
    <div class="lf-stage" id="lfStage"></div>
    <button type="button" class="lf-close" id="lfClose">leave the room</button>
    <aside class="lf-side">
      <div class="lf-tabs">
        <button type="button" data-tab="chat" class="on">Chat</button>
        <button type="button" data-tab="decorate">Decorate</button>
      </div>
      <div class="lf-pane" id="paneChat">
        <div class="chatlog" id="chatlog"></div>
        <form class="chatform" id="chatform" autocomplete="off">
          <input id="chatinput" type="text" placeholder="Ask Revolución&hellip;" aria-label="Ask Revolución">
          <button type="submit">Send</button>
        </form>
      </div>
      <div class="lf-pane" id="paneDecorate" hidden>
        <div class="dpanel">
          <section>
            <h3>Decorate</h3>
            <div data-decor-list></div>
          </section>
          <section>
            <h3>On the walls</h3>
            <p class="dnote">The frames hang your hive's own art, lit by their own picture
            lights. The rest are prints painted in code — the band, the leaf, the wheel,
            and the map of where the leaf comes from.</p>
          </section>
        </div>
      </div>
    </aside>
  </div>

  <!-- the framed wheel on the gallery wall opens into this, not the full page -->
  <div class="plate" id="wheelPlate" hidden>
    <div class="plate-card">
      <div class="plate-head">
        <h3 id="wheelTitle">The Flavor Wheel</h3>
        <button type="button" id="wheelBack" hidden>&larr; families</button>
        <button type="button" id="wheelClose">close</button>
      </div>
      <div class="plate-body">
        <div id="wheelSvg"></div>
        <div>
          <div class="wsub">
            <h4>In your glass</h4>
            <div id="wheelChips"><p class="wempty">Tap a family, then the flavors you are
            tasting. They stack up here.</p></div>
          </div>
          <div class="wsub">
            <h4>From the humidor</h4>
            <div id="wheelMatches"><p class="wempty">Pick a flavor and the catalog sorts
            itself against it.</p></div>
          </div>
        </div>
      </div>
      <div class="plate-foot">The whole taxonomy &mdash; 63 flavors, spinnable, with the
      selector station &mdash; lives on <a href="/revolucion/flavor-wheel">the flavor wheel page</a>.</div>
    </div>
  </div>
  <script>
  window.REV_LOUNGE = {
    mount: '#lounge3d',
    fallback: '#loungeFallback',
    controls: '.stagebar',
    // the hive's own sig-addressed tile art, hung in the room's frames
    art: ${JSON.stringify(
      Object.fromEntries(
        (['lounge', 'cigars', 'journal', 'flavor-wheel', 'humidor', 'community'] as const)
          .filter(k => art[k])
          .map(k => [k, `resource:${art[k]}/art.png`]),
      ),
    )}
  };
  </script>
  ${loungeScript}
  <script>
  (function(){
    // One decorate list, two renderers: the ids address groups in the SVG
    // fallback AND slots in the 3D room, so whichever came up obeys the same
    // switches. Ids the running renderer doesn't know are simply ignored.
    // The catalogue is the decorate list. Everything the house gave you costs
    // 0 and toggles; everything from El Mercado stays dark until the ledger
    // says it is yours, and unlocks from this list if you can afford it.
    var SLOTS = ${JSON.stringify(STORE_ITEMS.map(i => ({ id: i.id, label: i.label, price: i.price })))};
    var KEY = 'rev:lounge:decor';
    var E = window.RevEmbers;
    var on = {};
    try { on = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch(e){ on = {}; }
    function mine(s){ return s.price === 0 || (E && E.owned(s.id)); }
    function seed(){
      SLOTS.forEach(function(s){
        // house things default on; a bought thing arrives switched on the
        // first time we see it owned, and obeys the switch thereafter
        if (!(s.id in on)) on[s.id] = s.price === 0 || mine(s);
      });
    }
    seed();
    function lit(s){ return mine(s) && !!on[s.id]; }
    function paintScene(){
      SLOTS.forEach(function(s){
        // a slot may have overlay pieces outside its group (data-slot),
        // e.g. the hearth glow painted above the rug — hide both together
        var nodes = document.querySelectorAll('#' + s.id + ', [data-slot="' + s.id + '"]');
        for (var i = 0; i < nodes.length; i++) nodes[i].style.display = lit(s) ? '' : 'none';
        if (window.RevLounge3D) window.RevLounge3D.setSlot(s.id, lit(s));
      });
    }
    function apply(){
      seed();
      paintScene();
      try { localStorage.setItem(KEY, JSON.stringify(on)); } catch(e){}
      var bal = E ? E.balance() : 0;
      var lists = document.querySelectorAll('[data-decor-list]');
      for (var li = 0; li < lists.length; li++) {
        var list = lists[li];
        list.innerHTML = '';
        var purse = document.createElement('div');
        purse.className = 'dpurse';
        purse.innerHTML = '<span>' + bal + ' embers</span>' +
          '<a href="/revolucion/store">el mercado</a>';
        list.appendChild(purse);
        SLOTS.forEach(function(s){
          var owned = mine(s);
          var afford = bal >= s.price;
          var d = document.createElement('div');
          d.className = 'drow' + (owned ? (on[s.id] ? '' : ' off') : (' locked' + (afford ? '' : ' short')));
          d.innerHTML = '<span class="mark">' +
            (owned ? (on[s.id] ? '\\u25a0' : '\\u25a1') : '\\u2726') + '</span>' + s.label +
            (owned ? '' : '<span class="cost"><i></i>' + s.price + '</span>');
          // switching a bought thing on also LOOKS at it — a purchase that
          // lands somewhere off-camera may as well not have happened
          function show(){
            if (s.price === 0) return;
            if (window.__loungeWalkIn) window.__loungeWalkIn();
            if (window.__loungeView) window.__loungeView(s.id.replace('slot-', ''));
            else if (window.RevLounge3D) window.RevLounge3D.view(s.id.replace('slot-', ''));
          }
          d.addEventListener('click', function(){
            if (mine(s)) { on[s.id] = !on[s.id]; apply(); if (on[s.id]) show(); return; }
            if (!E || E.balance() < s.price) { window.location.href = '/revolucion/store'; return; }
            if (E.buy(s.id, s.price, s.label) === 'bought') { on[s.id] = true; apply(); show(); }
          });
          list.appendChild(d);
        });
        var note = document.createElement('p');
        note.className = 'dnote';
        note.textContent = 'Embers are earned in this room — a moment journaled, a leg off ' +
          'the Colonel, a ton at the oche with the room watching. Spend them here ' +
          'or in El Mercado.';
        list.appendChild(note);
      }
    }
    apply();
    // bought in another tab, or earned while this list was open
    window.addEventListener('embers:change', apply);
    // the concierge flips switches too — one code path, one saved state
    window.__loungeSetSlot = function(id, val){
      if (!(id in on)) return false;
      on[id] = !!val; apply(); return true;
    };
    window.__loungeSlots = SLOTS;
    // the room boots on idle — re-apply the saved switches once it is up
    document.addEventListener('lounge3d:ready', paintScene);

    // Belt and braces: if the room never reports ready (no WebGL, or the
    // bundle resource didn't resolve at all), show the drawn lounge instead
    // of an empty stage.
    setTimeout(function(){
      var stage = document.getElementById('lounge3d');
      if (!stage || stage.dataset.ready) return;
      stage.hidden = true;
      var bar = document.querySelector('.stagebar');
      if (bar) bar.hidden = true;
      var fb = document.getElementById('loungeFallback');
      if (fb) fb.hidden = false;
    }, 4000);

    var views = document.querySelectorAll('.vbtn[data-view]');
    for (var i = 0; i < views.length; i++) {
      views[i].addEventListener('click', function(e){
        var btn = e.currentTarget;
        for (var j = 0; j < views.length; j++) views[j].classList.remove('on');
        btn.classList.add('on');
        // every view is a way INTO the room — walk in first, then move
        if (window.__loungeWalkIn) window.__loungeWalkIn();
        if (window.RevLounge3D) window.RevLounge3D.view(btn.getAttribute('data-view'));
      });
    }
    window.__loungeView = function(name){
      for (var j = 0; j < views.length; j++)
        views[j].classList.toggle('on', views[j].getAttribute('data-view') === name);
      if (window.RevLounge3D) window.RevLounge3D.view(name);
    };
  })();
  </script>
  <script>
  (function(){
    // ── earning ────────────────────────────────────────────────────────
    // Everything the house pays for happens in THIS room, so the claims live
    // here. Each claim key names its occasion — a moment's timestamp, a leg
    // number — and the ledger refuses a key it has already paid, which is why
    // re-scanning the concierge's stored lists on every load is safe.
    var E = window.RevEmbers;
    if (!E) return;
    function flash(){
      var purse = document.querySelector('.purse');
      if (!purse) return;
      purse.classList.remove('paid'); void purse.offsetWidth; purse.classList.add('paid');
    }
    function load(k){ try { return JSON.parse(localStorage.getItem(k)) || []; } catch(e){ return []; } }

    // the house stakes you the first time you walk in
    function welcome(){
      if (E.claim('welcome', ${EARN_OF('welcome')}, 'the house stakes you')) flash();
    }
    document.addEventListener('lounge3d:ready', welcome);
    setTimeout(welcome, 4200); // no WebGL: the drawn room counts as walking in

    // the concierge's own lists, swept for anything not yet paid
    function sweep(){
      var paid = false;
      load('rev:lounge:moments').forEach(function(m){
        paid = E.claim('moment:' + m.at, ${EARN_OF('moment')},
          'a moment journaled: ' + String(m.t || '').slice(0, 40)) || paid;
      });
      load('rev:lounge:reserved').forEach(function(r){
        paid = E.claim('reserve:' + r.at, ${EARN_OF('reserve')},
          'reserved ' + (r.q > 1 ? r.q + ' \\u00d7 ' : '') + r.n) || paid;
      });
      if (paid) flash();
    }
    sweep();
    setInterval(sweep, 2500);

    // THE OCHE. Everything the board pays — the leg, the tons, the straights,
    // the side bets, a dart through a smoke ring, the match — arrives as one
    // event with the amount ALREADY multiplied by how full the room was. The
    // claim key carries the moment, so every occasion pays and none of them is
    // ever the same occasion twice.
    window.addEventListener('lounge3d:call', function(e){
      var d = e.detail || {};
      if (!d || !(d.embers > 0)) return;
      var why = (d.label || d.shout || d.id || 'the oche').toString().toLowerCase() +
        (d.doubled ? ' \u00b7 tonight\u2019s bet, doubled'
          : d.mult > 1 ? ' \u00b7 ' + d.base + ' \u00d7 ' + d.mult + ' the house' : '');
      if (E.claim('call:' + d.id + ':' + d.at, d.embers, why)) flash();
    });
  })();
  </script>
  ${CONCIERGE_JS}`)

  // ── El Mercado — the storefront ──────────────────────────────────────
  // The shelves are rendered from STORE_ITEMS at build time and hydrated
  // against the ledger at read time: owned, affordable, or short. Buying is
  // a ledger entry, nothing more — there is no cart, no checkout, no rail.

  const shelfOf = (group: string): string => SALE_ITEMS.filter(i => i.group === group).map(i => `
        <article class="good" data-good="${i.id}" data-price="${i.price}">
          <div class="price"><i aria-hidden="true"></i>${i.price}</div>
          <h3>${i.label}</h3>
          <p>${i.blurb}</p>
          <button type="button" class="take">Take it</button>
        </article>`).join('')

  const store = P('/revolucion/store', 'El Mercado', `
  <main class="wrap">
    <section class="hero">
      <p class="kicker">el mercado · the store</p>
      <h1>Earned first.<br>Then <i>spent</i>.</h1>
      <p class="lede">Embers are the house currency. You cannot buy them — there is no
      till here and there never will be. You earn them in the lounge: an evening
      journaled, a leg taken off the Colonel, a tasting logged on the wheel. Then you
      spend them on the room.</p>
      ${heroArt('lounge', 'the room you are furnishing')}
      <div class="purseline">
        <div>
          <span class="big" data-embers-balance>0</span>
          <span class="t">embers in the purse</span>
        </div>
        <p>Kept in this browser, on this device, like everything else here. Nobody is
        counting them but you.</p>
      </div>
      <div class="btns">
        <a class="btn" href="/revolucion/lounge">Go and earn some</a>
        <a class="btn ghost" href="#shelves">See the shelves</a>
      </div>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">how you earn</p></div>
      <h2>The room is <i>earned</i>, not bought.</h2>
      <div class="earn">
        ${EARN_RULES.map(r => `<div data-earn="${r.key}">
          <span class="n">+${r.embers}</span>
          <span class="t">${r.label}</span>
          <p>${r.note}</p>
        </div>`).join('\n        ')}
      </div>
      <p class="muted">Each of these pays once per occasion — a claim is written into the
      ledger the moment it happens, and a claim already in the ledger never pays twice.</p>
      <p class="muted">${OCHE_NOTE}</p>
    </section>

    <section class="section" id="shelves">
      <div class="rule"><p class="kicker">furnishings</p></div>
      <h2>Things that take up <i>floor</i>.</h2>
      <div class="shelf">${shelfOf('furnishings')}
      </div>

      <div class="rule"><p class="kicker">the good stuff</p></div>
      <div class="shelf">${shelfOf('the good stuff')}
      </div>

      <div class="rule"><p class="kicker">the wall</p></div>
      <div class="shelf">${shelfOf('the wall')}
      </div>
      <p class="muted">Everything you buy appears in the lounge's Decorate list, switched
      on. Switch it off any time — it stays yours.</p>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">already yours</p></div>
      <h2>The house furnishings cost <i>nothing</i>.</h2>
      <p>The room came with ${HOUSE_ITEMS.length} things in it, and they are yours from the
      first visit. El Mercado only sells what the room does not already have.</p>
      <div class="chips">
        ${HOUSE_ITEMS.map(i => `<span class="chip">${i.label}</span>`).join('\n        ')}
      </div>
    </section>

    <section class="section">
      <div class="rule"><p class="kicker">the ledger</p></div>
      <h2>Every ember, <i>accounted</i>.</h2>
      <p>The balance is not stored anywhere. It is the sum of this list — the entries are
      the truth, the number in the corner is just their total. The same way the hive
      keeps history.</p>
      <div class="ledger" data-ledger>
        <div class="empty">Nothing yet. Walk into the lounge and the house will stake you.</div>
      </div>
      <div class="btns">
        <a class="btn" href="/revolucion/lounge">Into the lounge</a>
        <a class="btn ghost" href="/revolucion/journal">Journal a moment</a>
      </div>
    </section>
  </main>
  <script>
  (function(){
    var E = window.RevEmbers;
    if (!E) return;
    var goods = document.querySelectorAll('[data-good]');
    var ledger = document.querySelector('[data-ledger]');

    function paintGoods(){
      var bal = E.balance();
      for (var i = 0; i < goods.length; i++){
        (function(el){
          var id = el.getAttribute('data-good');
          var price = +el.getAttribute('data-price');
          var btn = el.querySelector('.take');
          var mine = E.owned(id);
          el.classList.toggle('mine', mine);
          el.classList.toggle('short', !mine && bal < price);
          btn.disabled = mine || bal < price;
          btn.textContent = mine ? 'In the room'
            : bal < price ? (price - bal) + ' more to go'
            : 'Take it';
        })(goods[i]);
      }
    }
    function paintEarned(){
      var rows = document.querySelectorAll('[data-earn]');
      for (var i = 0; i < rows.length; i++){
        var key = rows[i].getAttribute('data-earn');
        // 'welcome' is a bare key; the rest are prefixes on a per-occasion key
        var done = E.has(key);
        if (!done){
          var all = E.entries();
          for (var j = 0; j < all.length; j++)
            if (String(all[j].k).indexOf(key + ':') === 0) { done = true; break; }
        }
        rows[i].style.opacity = done ? '1' : '.78';
      }
    }
    function paintLedger(){
      var all = E.entries().slice().reverse();
      if (!all.length) return;
      var html = '';
      for (var i = 0; i < all.length && i < 24; i++){
        var e = all[i];
        var d = new Date(e.t || Date.now());
        var when = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        html += '<div class="row"><span class="w">' + String(e.w || e.k) + '</span>' +
          '<span class="muted">' + when + '</span>' +
          '<span class="d' + (e.d < 0 ? ' out' : '') + '">' + (e.d > 0 ? '+' : '') + e.d + '</span></div>';
      }
      ledger.innerHTML = html;
    }
    function paintAll(){ paintGoods(); paintEarned(); paintLedger(); }

    for (var i = 0; i < goods.length; i++){
      (function(el){
        el.querySelector('.take').addEventListener('click', function(){
          var id = el.getAttribute('data-good');
          var price = +el.getAttribute('data-price');
          var label = el.querySelector('h3').textContent;
          if (E.buy(id, price, label) !== 'bought') return;
          var purse = document.querySelector('.purse');
          if (purse){ purse.classList.remove('paid'); void purse.offsetWidth; purse.classList.add('paid'); }
        });
      })(goods[i]);
    }
    window.addEventListener('embers:change', paintAll);
    paintAll();
  })();
  </script>`)

  return [
    { segments: ['revolucion'], label: 'Revolución', html: home },
    { segments: ['revolucion', 'store'], label: 'El Mercado', html: store },
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

// ─── the 3D lounge bundle ────────────────────────────────────────────
// scripts/lounge3d/lounge-3d.ts (three.js) → one minified IIFE. Stored as its
// OWN sig-addressed resource and referenced from the page with
// `resource:<sig>/lounge-3d.js` — the `.js` tail is what makes the service
// worker serve it as application/javascript. Keeping it out of the page HTML
// means page-copy edits don't re-upload half a megabyte, and the bundle
// dedupes by signature across every rebuild.

async function bundleLounge(): Promise<string> {
  const esbuild = await import('esbuild')
  const { existsSync } = await import('node:fs')
  const path = await import('node:path')
  // Run from the monorepo root (`tsx scripts/…`) or from scripts/ — resolve
  // both without depending on import.meta (this file runs as CJS under tsx).
  const entry = ['scripts/lounge3d/lounge-3d.ts', 'lounge3d/lounge-3d.ts']
    .map(p => path.resolve(process.cwd(), p))
    .find(existsSync)
  if (!entry) throw new Error('lounge-3d.ts not found — run from the monorepo root (src/)')
  const out = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    minify: true,
    target: 'es2020',
    platform: 'browser',
    write: false,
    legalComments: 'none',
  })
  const text = out.outputFiles?.[0]?.text
  if (!text) throw new Error('lounge bundle produced no output')
  return text
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
    // Preview has no OPFS to resolve `resource:` from, so the 3D bundle is
    // inlined here instead of referenced by signature.
    const loungeScript = `<script>${await bundleLounge()}</script>`
    for (const p of buildPages('PREVIEW', fakeArt, loungeScript)) {
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
  const REQUIRED: Array<{ name: string; note: string }> = [
    { name: 'lounge', note: 'The cigar lounge — a decorated room of slots you dress yourself. Your own add-ons hang here: art, bottles, bands of cigars you have loved.' },
    { name: 'store', note: 'El Mercado — the storefront. Embers are earned in the lounge (a moment journaled, a leg off the Colonel, a tasting logged) and spent on furnishings that appear in the room. No payment rail: the ledger is the truth and the balance is its sum.' },
  ]
  const missing = REQUIRED.filter(r => !childNames.includes(r.name))
  if (missing.length) {
    console.log(`[site] adding cells ${missing.map(m => m.name).join(', ')} (current children: ${childNames.join(', ')})`)
    const up = await send({
      op: 'update',
      segments: ['revolucion'],
      layer: { name: rootLayer?.name ?? 'revolucion', children: [...childNames, ...missing.map(m => m.name)] },
    })
    if (!up.ok) { console.error(`[site] cell FAIL: ${up.error}`); process.exit(1) }
    for (const m of missing) {
      await send({ op: 'update', segments: ['revolucion', m.name], layer: { name: m.name } })
      await send({ op: 'note-add', segments: ['revolucion'], cell: m.name, text: m.note })
      childNames.push(m.name)
    }
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
  // childNames now includes anything REQUIRED just created
  const tops = childNames
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

  // 1b. The 3D lounge bundle — its own resource, referenced by signature.
  const bundle = await bundleLounge()
  const loungePut = await send({ op: 'put-resource', text: bundle })
  if (!loungePut.ok) { console.error(`[site] lounge-3d.js FAIL: ${loungePut.error}`); process.exit(1) }
  const loungeSig = loungePut.data.sig as string
  console.log(`[site] lounge-3d.js → ${loungeSig.slice(0, 12)}… (${loungePut.data.bytes} bytes)`)
  const loungeScript = `<script src="resource:${loungeSig}/lounge-3d.js"></script>`

  // 2. Pages: put-resource + decoration-add per cell.
  const pages = buildPages(chromeSig, art, loungeScript)
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
      // NO createdAt. A wall-clock stamp makes every rebuild mint a NEW
      // decoration record even when the HTML is byte-identical — which moves
      // the branch head, invalidates the sig every consumer was handed, and
      // obliges another round of syncing for a no-op. Nothing reads it.
      // Identical content must produce an identical record.
      payload: { htmlSig, icon: 'local_fire_department', label: p.label, order: 0 },
      mark: 'persistent',
      replaceKind: true,
    })
    if (!deco.ok) { console.error(`[site] ${route} decoration FAIL: ${deco.error}`); process.exit(1) }
    written.push({ path: route, htmlSig, decoSig: deco.data.sig })
    console.log(`[site] ${route} → html ${htmlSig.slice(0, 12)}… deco ${String(deco.data.sig).slice(0, 12)}…${deco.data.unchanged ? ' (unchanged)' : ''}`)
  }

  // 2b. THE ROOM AS A TILE — what makes the lounge ATOMIC.
  //
  // Until now the room existed only as HTML inside this site, so the only
  // door was the site itself: walking to the lounge meant walking the
  // WEBSITE to a page about the lounge. The same bundle we just minted is
  // now also carried by the LOUNGE CELL, as a `visual:lounge:room` record
  // naming that signature and the art to hang. The tile IS the room.
  //
  // The page keeps its own frame — the concierge, El Mercado, the wheel
  // plate, the walk-in overlay — because a room in a reading column beside
  // a concierge is a different purpose than the room by itself. Both mount
  // the SAME bundle sig, because both are handed it from right here: one
  // logical piece, two frames, no divergence possible.
  const loungeSegments = ['revolucion', 'lounge']
  const roomArt: Record<string, string> = {}
  for (const key of ['lounge', 'cigars', 'journal', 'flavor-wheel', 'humidor', 'community']) {
    const sig = art[key]
    if (sig) roomArt[key] = sig
  }
  const room = await send({
    op: 'decoration-add',
    segments: loungeSegments,
    kind: 'visual:lounge:room',
    appliesTo: loungeSegments,
    // NO createdAt, for the same reason the pages carry none: identical
    // content must mint an identical record, or every rebuild moves the
    // branch head for a no-op.
    payload: {
      version: 1,
      bundleSig: loungeSig,
      ...(Object.keys(roomArt).length ? { art: roomArt } : {}),
      label: 'The Cigar Lounge',
      icon: 'chair',
    },
    mark: 'persistent',
    replaceKind: true,
  })
  if (!room.ok) { console.error(`[site] lounge room record FAIL: ${room.error}`); process.exit(1) }
  console.log(`[site] /revolucion/lounge room → bundle ${loungeSig.slice(0, 12)}…, ${Object.keys(roomArt).length} frames hung${room.data.unchanged ? ' (unchanged)' : ''}`)

  // 2c. THE ARRIVAL FACE — the lounge cell OPENS AS the room.
  //
  // The record above only makes the room AVAILABLE at the tile. This is what
  // makes walking in BE walking in: `view:default` is a fact about the place,
  // so it is undoable, it rides the layer commit, and a peer who adopts the
  // tile arrives in the room the way we arranged it.
  const face = await send({
    op: 'decoration-add',
    segments: loungeSegments,
    kind: 'view:default',
    appliesTo: loungeSegments,
    payload: { view: 'lounge' },
    mark: 'persistent',
    replaceKind: true,
  })
  if (!face.ok) { console.error(`[site] lounge arrival face FAIL: ${face.error}`); process.exit(1) }
  console.log(`[site] /revolucion/lounge opens as → lounge${face.data.unchanged ? ' (unchanged)' : ''}`)

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

  // 3b. Verify the ROOM by read-back too — a build log line is not proof a
  //     bridge write landed (the lesson of the pass that "deployed" three
  //     months of work into a preview server and nowhere else). Read the
  //     lounge cell's decorations and confirm both records are actually
  //     there, naming the bundle we just minted.
  {
    const layer = await send({ op: 'layer-at', segments: loungeSegments })
    const decoSigs: string[] = Array.isArray(layer?.data?.decorations) ? layer.data.decorations : []
    let roomOk = false, faceOk = false
    for (const sig of decoSigs) {
      const res = await send({ op: 'get-resource', sig })
      if (!res.ok) continue
      try {
        const rec = JSON.parse(res.data.text)
        if (rec.kind === 'visual:lounge:room' && rec.payload?.bundleSig === loungeSig) roomOk = true
        if (rec.kind === 'view:default' && rec.payload?.view === 'lounge') faceOk = true
      } catch { /* not JSON */ }
    }
    console.log(roomOk && faceOk
      ? '[site] verify: the lounge tile IS the room, and opens as it'
      : `[site] verify FAIL — room:${roomOk} opensAs:${faceOk}`)
    if (!(roomOk && faceOk)) fail++
  }

  // One build revision for the whole pass (documentation/build-revisions.md)
  const rev = await send({ op: 'build-record', segments: ['revolucion'], label: 'revolucion site build' })
  console.log(rev.ok
    ? `[site] build revision: ${(rev.data as any).label} seal=${String((rev.data as any).seal).slice(0, 12)}${(rev.data as any).unchanged ? ' (unchanged)' : ''}`
    : `[site] build revision FAILED: ${rev.error}`)
  console.log(`[site] DONE — toggle the global /website view mode on /revolucion to see it mount.`)
}

main().catch(err => { console.error(err); process.exit(1) })
