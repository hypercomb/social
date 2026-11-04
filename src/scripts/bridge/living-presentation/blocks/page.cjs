// A BLOCK: one tile's page, whole (documentation/living-presentation.md, "The
// tree as planted"; website-artifact-paradigm.md rules 1, 2 and 10).
//
// ONE TILE, ONE SCENE. The hierarchy is the presentation: every tile is one
// scene, and a reader walks them in any order — in by a word, back up by the
// crumbs. A page is that one scene as one slide, the size of the screen:
//
//   crumbs   where you are; every ancestor is a way back
//   scene    the eyebrow, the headline, the figure, and the narration under
//            one hairline with its transport — the tour's stage, exactly
//   ways     a strip of the words to step into, and the way up
//
// THE STANDARD IS THE TOUR (scripts/presentation): its ink and honey, its two
// faces, its figures, its voice. A tile one of the tour's scenes explains
// shows that scene (tour.cjs); a tile no scene explains shows a plate in the
// tour's plate language whose parts light as its beats are said. A picture
// from a running hive, or a part to try, stands beside the figure in the
// same slide, and the narration turns to it as its last beat.
//
// Every page stands alone: its look, its script and its pictures are inside
// it or named by signature (`resource:<sig>` — the faces, the voice, the
// clips, the captured pictures), and it asks no other host for anything
// (doctrine T7). It names no other block: a link names a WORD (`./word` steps
// one level down; an ancestor is its route, `/presentation/simple`), and the
// tile that fills the word answers it. The source a tile explains rides on
// the tile as included files, not on the slide.
//
// Its natural parts are marked by the word each would fill (`data-part`:
// crumbs, scene, ways). Extruding a block later is a layout of those words
// and a component for each (the layout word).
//
// IN THE HIVE a page is mounted inline (site-view.drone.ts) in a host pinned
// over the viewport: its CSS is scoped to the host, `:root` becomes the host,
// and `resource:<sig>` becomes `/@resource/<sig>`. Its script finds its own
// elements from its own root and lets go of the keyboard, its timers, its
// voice and its clips the moment it is unmounted.
//
// render(parts) -> the page's HTML. Every part is prepared by build.cjs:
//   route    ['presentation', 'simple']
//   title    the document title
//   scene    { eyebrow, headline, figure, beside, sub, link, minutes,
//              steps: [{ say, voice, lit, name }] }
//            `beside` is the second panel's HTML (a capture or a try part), or ''
//   tryPart  'word' | 'signature' | null (its script)
//   ways     { children: [{ name, note, page }], parent, parentRoute }
//   faces    the @font-face rules (by signature)
//   sprite   the tour's icon sprite

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const icon = (name, cls = '') => `<svg class="g${cls ? ` ${cls}` : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`

/** The tour's tokens, dark as the tour is. A hive or viewer that says light
 *  explicitly (`data-theme="light"`) gets the same design on paper. */
const TOKENS = `
:root{
  color-scheme:dark;
  --bg:#15181c; --bg2:#191d22; --panel:#1c2027;
  --line:rgba(255,255,255,.12); --line-strong:rgba(255,255,255,.2);
  --ink:#eef1f4; --dim:#b4bcc6; --faint:#8b94a1; --faint-text:#8b94a1; --steel:#7f8da0;
  --honey:#f0c050; --honey-deep:#c08a1a; --honey-fill:#e0a520; --honey-text:#d19a22; --honey-tint:rgba(224,165,32,.12);
  --danger:#d9605a; --on-honey:#15181c;
  --sans:"Inter",system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:"JetBrains Mono",ui-monospace,"Cascadia Code",Consolas,monospace;
  --track-eyebrow:.24em; --track-label:.12em; --track-data:.03em; --track-display:-.015em;
  --r-ctl:2px; --r-card:3px;
  --ease:cubic-bezier(.2,.6,.2,1);
  --shadow:0 1px 0 rgba(0,0,0,.25), 0 10px 28px -18px rgba(0,0,0,.6);
}
:root[data-theme="light"]{
  color-scheme:light;
  --bg:#f6f4ef; --bg2:#efece5; --panel:#ffffff;
  --line:rgba(20,24,28,.13); --line-strong:rgba(20,24,28,.24);
  --ink:#16191d; --dim:#47505a; --faint:#69727d; --faint-text:#636c77; --steel:#5b6a7d;
  --honey:#b47a12; --honey-deep:#94600a; --honey-fill:#e0a520; --honey-text:#9c650b; --honey-tint:rgba(224,165,32,.15);
  --shadow:0 1px 0 rgba(0,0,0,.04), 0 10px 28px -20px rgba(0,0,0,.25);
}`

const STYLE = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--ink);font-family:var(--sans);
  font-synthesis:none;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:inherit}
button{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--honey);outline-offset:2px}
[hidden]{display:none!important}
svg.g{width:1em;height:1em;display:inline-block;vertical-align:-.15em;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;flex:none}

/* ONE SLIDE: the screen's height (less the hive's exit corner), three rows —
   crumbs, the scene, the ways. Sizes read from the slide's own width (cqi)
   and the screen's height (vh), so it is the same slide standing alone or
   mounted in the hive. */
.page{container-type:inline-size;width:min(1180px,100%);margin:0 auto;padding:14px 16px 0;
  height:calc(100vh - var(--hc-site-chrome-bottom,0px));height:calc(100dvh - var(--hc-site-chrome-bottom,0px));min-height:520px;
  display:grid;grid-template-rows:auto minmax(0,1fr) auto;--measure:780px}
.mono-label{font-family:var(--mono);font-size:12px;line-height:1.3;letter-spacing:var(--track-label);text-transform:uppercase}

/* ---------- where you are ---------- */
.crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:.25em .6em;color:var(--faint-text);min-height:20px}
.crumbs .g{color:var(--honey);font-size:14px}
.crumbs a{text-decoration:none;color:var(--dim)}
.crumbs a:hover{color:var(--honey)}
.crumbs .sep{color:var(--line-strong)}
.crumbs [aria-current]{color:var(--ink)}
/* A PART is one slide on its own: no crumbs, no ways. The website icon opens
   the website — rooted at the top tile — on this same page. */
.top{display:flex;align-items:center;gap:12px;min-height:20px}
.top .crumbs{flex:1}
.to-site{display:none;align-items:center;gap:.45em;margin-left:auto;font-family:var(--mono);font-size:12px;letter-spacing:var(--track-label);
  text-transform:uppercase;color:var(--dim);background:none;border:1px solid var(--line);border-radius:var(--r-ctl);padding:5px 10px;cursor:pointer}
.to-site:hover{color:var(--honey);border-color:var(--honey-deep);background:var(--honey-tint)}
.to-site .g{color:var(--honey);font-size:13px}
.page.part .crumbs,.page.part .ways{visibility:hidden}
.page.part .to-site{display:inline-flex}

/* ---------- the scene ---------- */
.scene{display:grid;grid-template-rows:auto auto minmax(0,1fr) auto auto;justify-items:center;align-content:stretch;
  text-align:center;min-height:0;padding-top:clamp(10px,3.4vh,40px)}
.scene>*{opacity:0;transform:translateY(14px);transition:opacity .7s var(--ease),transform .7s var(--ease)}
.scene.in>*{opacity:1;transform:none}
.scene.in>:nth-child(2){transition-delay:.1s}
.scene.in>:nth-child(3){transition-delay:.22s}
.scene.in>:nth-child(4){transition-delay:.34s}
.scene.in>:nth-child(5){transition-delay:.46s}
.eyebrow{font-family:var(--mono);font-size:clamp(11px,1.1cqi,13px);line-height:1.3;letter-spacing:var(--track-eyebrow);
  padding-inline-start:var(--track-eyebrow);text-transform:uppercase;color:var(--honey-deep);margin:0 0 .8em}
.scene h1{font-weight:300;font-size:clamp(28px,min(5.2cqi,6.4vh),64px);line-height:1.06;letter-spacing:var(--track-display);
  margin:0 0 clamp(12px,2.6vh,28px);max-width:24ch;text-wrap:balance;color:var(--ink)}
.scene h1 b{font-weight:500;color:var(--honey-text)}
.scene .sub{color:var(--dim);font-size:clamp(15px,1.7cqi,19px);line-height:1.4;max-width:56ch;margin:clamp(8px,1.6vh,18px) 0 0;text-wrap:balance}
.scene .sub b{font-weight:500;color:var(--ink)}

/* the figure zone never yields: a frame is sized from the zone's own height,
   the tour's rule; a second panel shares the zone beside it */
.fz{min-height:0;width:100%;display:grid;grid-template-columns:minmax(0,1fr);gap:clamp(14px,2.4cqi,28px);align-items:start;justify-items:center}
.fz.duo{grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);align-items:center}
.fz.duo .pane{align-items:center}
.pane{min-height:0;height:100%;width:100%;container-type:size;display:grid;align-items:start;justify-items:center}
.pane>.hexrow{align-self:center}
.figbox{display:grid;grid-template-rows:minmax(0,1fr) auto;row-gap:6px;max-height:100%;justify-items:start}
.fig.film,.fig.plate,.fig.shot{width:min(100cqw, calc((100cqh - 26px) * var(--ratio)));aspect-ratio:var(--ratio);
  border:1px solid var(--line-strong);border-radius:var(--r-card);overflow:hidden;background:var(--panel);box-shadow:var(--shadow)}
.fig.film video,.fig.shot img{display:block;width:100%;height:100%;object-fit:cover;background:#111419}
.fig.shot img{object-fit:contain}
.fig.plate svg{display:block;width:100%;height:100%}
.figcap{width:100%;min-width:0;display:flex;align-items:center;gap:.7em;font-family:var(--mono);font-size:12px;line-height:1.3;height:20px;
  letter-spacing:var(--track-label);text-transform:uppercase;color:var(--faint-text);white-space:nowrap;text-align:left}
.figcap>span{overflow:hidden;text-overflow:ellipsis}
.figcap .g{color:var(--honey);font-size:1.05em}
.figcap.live .g{fill:var(--honey-fill);stroke:var(--honey-fill)}
.figcap .sig{margin-left:auto;letter-spacing:var(--track-data);text-transform:none;color:var(--dim)}
.figcap .sig b{font-weight:400;color:var(--honey)}
.plate text{font-family:var(--sans);fill:var(--ink)}
.plate text.m{font-family:var(--mono)}
.plate text.k{font-weight:500}
.plate .d{fill:var(--dim)} .plate .f{fill:var(--faint-text)} .plate .hy{fill:var(--honey)} .plate .st{fill:var(--steel)} .plate .dg{fill:var(--danger)}
.flow{stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset .9s var(--ease) .5s}
.scene.in .flow{stroke-dashoffset:0}

/* the beats: each part lights as it is said; a panel beside dims until its beat */
.plate.beats [data-id],.fz.lights [data-id]{opacity:.38;transition:opacity .5s var(--ease)}
.plate.beats [data-id].lit,.fz.lights [data-id].lit{opacity:1}
.fz.duo .pane{transition:opacity .5s var(--ease)}
.fz.duo.aside .pane:first-child,.fz.duo.main .pane:last-child{opacity:.45}

.fig.hexrow{display:flex;flex-wrap:wrap;justify-content:center;gap:clamp(14px,2.4cqi,26px)}
.hexb{width:clamp(88px,12cqi,128px);display:flex;flex-direction:column;align-items:center;gap:.6em}
.hexb .hx{position:relative;width:100%;aspect-ratio:.866/1}
.hexb .hx svg.h{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.hexb .hx .o{fill:var(--panel);stroke:var(--line-strong);stroke-width:1;vector-effect:non-scaling-stroke}
.hexb .hx .in{fill:none;stroke:var(--honey-deep);stroke-width:1;vector-effect:non-scaling-stroke;opacity:.6}
.hexb .hx svg.g{position:absolute;left:50%;top:50%;width:34%;height:34%;transform:translate(-50%,-50%);color:var(--honey);stroke-width:1.4}
.hexb .t{font-family:var(--mono);font-size:12px;line-height:1.4;letter-spacing:var(--track-label);padding-inline-start:var(--track-label);
  text-transform:uppercase;color:var(--dim);white-space:nowrap}

.fig.stack,.fig.list{display:flex;flex-direction:column;width:min(620px,100cqw);border:1px solid var(--line);border-radius:var(--r-card);
  background:var(--panel);overflow:hidden;text-align:left}
.fig.stack{flex-direction:column-reverse}
.lay{display:grid;grid-template-columns:max-content 1fr;column-gap:24px;align-items:baseline;padding:10px 18px;
  font-family:var(--mono);font-size:13px;line-height:1.45;letter-spacing:var(--track-data);color:var(--dim);border-top:1px solid var(--line)}
.fig.list .lay:first-child{border-top:0}
.fig.stack .lay:last-child{border-top:0}
.lay>span:first-child{white-space:nowrap;color:var(--ink)}
.lay>span:last-child{text-align:right}
.lay.one{grid-template-columns:1fr}
.lay.one>span{text-align:left}
.lay.head{box-shadow:inset 2px 0 0 var(--honey-deep);background:var(--honey-tint)}
.lay.head>span:first-child{color:var(--honey)}
.lay.head>span:last-child{color:var(--ink)}

.fig.road{position:relative;width:fit-content;max-width:100cqw;display:grid;row-gap:clamp(8px,1.6vh,16px);text-align:left;padding-left:2px}
.fig.road::before{content:"";position:absolute;left:8px;top:.6em;bottom:.6em;width:1px;background:var(--line)}
.mile{display:grid;grid-template-columns:14px 1fr;column-gap:18px;align-items:start;position:relative}
.mile svg.mk{width:14px;height:16px;margin-top:4px;fill:var(--bg);stroke:var(--faint);stroke-width:1.5;overflow:visible}
.mile.landed svg.mk{fill:var(--honey-fill);stroke:var(--honey-fill)}
.mile.next svg.mk{fill:var(--bg);stroke:var(--honey-deep)}
.mile .mt{font-weight:500;font-size:clamp(15px,1.8cqi,19px);line-height:1.25;color:var(--ink)}
.mile .md{color:var(--dim);font-size:clamp(13px,1.45cqi,16px);line-height:1.4;max-width:58ch;margin-top:.15em}

.cta{display:inline-flex;align-items:center;gap:.6em;font-weight:500;font-size:14px;line-height:1;color:var(--honey);text-decoration:none;
  border:1px solid var(--honey-deep);border-radius:var(--r-ctl);padding:10px 18px;margin-top:clamp(8px,1.6vh,18px);transition:background .15s,border-color .15s}
.cta:hover{background:var(--honey-tint);border-color:var(--honey)}

/* a part to try, beside the figure */
.try{width:min(520px,100cqw);text-align:left;border:1px solid var(--line);border-radius:var(--r-card);background:var(--panel);padding:16px}
.try label{display:block;color:var(--dim);font-size:14px;margin-bottom:8px}
.try input{width:100%;font:15px var(--mono);padding:10px 12px;border:1px solid var(--line);border-radius:var(--r-ctl);background:var(--bg);color:var(--ink)}
.try input:focus{outline:none;border-color:var(--honey-deep)}
.try output{display:grid;gap:4px;margin-top:10px}
.try .k{font-family:var(--mono);font-size:11px;letter-spacing:var(--track-label);text-transform:uppercase;color:var(--faint-text);margin-top:6px}
.try code{font:13px var(--mono);word-break:break-all;color:var(--ink)}
.try code.sig{color:var(--honey)}

/* the narration: a strip under one hairline, the tour's caption, and its transport */
.dock{width:100%;max-width:var(--measure);margin:0 auto}
.caption{position:relative;margin:clamp(10px,2vh,22px) 0 0;padding:12px 0 0;text-align:left;min-height:calc(2 * 1.5em + 12px);
  font-size:clamp(16px,1.95cqi,21px);line-height:1.5;color:var(--ink);text-wrap:pretty;max-height:26vh;overflow:auto;overscroll-behavior:contain}
.caption.more{-webkit-mask-image:linear-gradient(#000 calc(100% - 2.2em),transparent);mask-image:linear-gradient(#000 calc(100% - 2.2em),transparent)}
.caption::before{content:"";position:sticky;display:block;top:-12px;left:0;right:0;height:1px;margin:-12px 0 11px;background:var(--line)}
.caption.long{font-size:clamp(14px,1.5cqi,16px);line-height:1.5}
.caption p{margin:0}
.caption p.rise{animation:rise .5s var(--ease)}
@keyframes rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.transport{display:flex;align-items:center;gap:6px;margin:10px 0 0}
.ib{width:34px;height:34px;display:inline-grid;place-items:center;background:none;border:1px solid transparent;border-radius:var(--r-ctl);
  color:var(--dim);cursor:pointer;padding:0;transition:border-color .15s,background .15s,color .15s;flex:none}
.ib svg.g{width:16px;height:16px}
.ib:hover{border-color:var(--line);background:var(--honey-tint);color:var(--ink)}
.pp{color:var(--ink)}
.pp .i-pause,.pp.playing .i-play{display:none}
.pp.playing .i-pause{display:block}
.pp.lead{width:auto;gap:.55em;padding:0 16px 0 13px;height:36px;display:inline-flex;align-items:center;background:var(--honey-fill);border-color:var(--honey-fill);
  color:var(--on-honey);font-weight:500;font-size:14px}
.pp.lead svg.g{stroke-width:2}
.pp.lead:hover{background:var(--honey);border-color:var(--honey);color:var(--on-honey)}
.pp:not(.lead) .lead-text{display:none}
.ticks{flex:1;display:flex;gap:3px;height:24px;align-items:center;min-width:40px;margin:0 6px}
.tick{flex:1;height:24px;background:none;border:0;padding:0;cursor:pointer;position:relative}
.tick::after{content:"";position:absolute;left:0;right:0;top:11px;height:2px;background:var(--line);transition:background .3s,transform .3s}
.tick.done::after{background:var(--honey-deep)}
.tick.now::after{background:var(--honey-fill);transform:scaleY(2)}
.tick:hover::after{background:var(--dim)}
.count{font-family:var(--mono);font-size:12px;font-variant-numeric:tabular-nums;letter-spacing:var(--track-data);color:var(--dim);white-space:nowrap;padding:0 4px}
.voice .i-muted,.voice[aria-pressed="false"] .i-speaker{display:none}
.voice[aria-pressed="false"] .i-muted{display:block}

/* ---------- the ways: walk the hierarchy ---------- */
.ways{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:12px 0 14px;margin-top:clamp(10px,2vh,20px);border-top:1px solid var(--line)}
.ways .lbl{color:var(--honey-deep);margin-right:6px}
.ways a.w,.ways span.w{display:inline-flex;align-items:center;gap:.45em;font-family:var(--mono);font-size:13px;letter-spacing:var(--track-data);
  text-decoration:none;color:var(--ink);border:1px solid var(--line);border-radius:var(--r-ctl);padding:6px 10px;transition:border-color .15s,background .15s,color .15s}
.ways a.w .g{color:var(--honey);font-size:12px}
.ways a.w:hover{border-color:var(--honey-deep);background:var(--honey-tint);color:var(--honey)}
.ways span.w{color:var(--faint-text);border-style:dashed}
.ways .up{margin-left:auto;display:inline-flex;align-items:center;gap:.4em;color:var(--faint-text);text-decoration:none;font-size:13px;white-space:nowrap}
.ways .up:hover{color:var(--honey)}

@container (max-width:700px){
  .fz.duo{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1.3fr) minmax(0,1fr)}
  .lay{grid-template-columns:1fr;row-gap:2px;font-size:12px}
  .lay>span:last-child{text-align:left}
  .figcap .sig{display:none}
  .hexb{width:clamp(76px,24cqi,104px)}
  .hexb .t{font-size:11px}
  .count{display:none}
  .ways .up{margin-left:0}
  .caption{max-height:36vh}
}
@media (prefers-reduced-motion:reduce){
  .scene>*,.caption p.rise,.plate.beats [data-id],.fz.lights [data-id],.fz.duo .pane,.flow,.tick::after{transition:none!important;animation:none!important;transform:none!important}
  .scene>*{opacity:1}
  .flow{stroke-dashoffset:0!important}
}`

/* The player: a scene is its steps — what is said, and what lights. A step
   with a voice plays it; a silent step holds for its words' reading time. A
   voiced scene waits to be asked (a browser plays sound only after a press);
   a silent one plays itself. A step marked `beside` turns the narration to
   the second panel. */
const SCRIPT = `
(() => {
  const root = (document.currentScript && document.currentScript.parentElement) || document
  const page = root.querySelector('.page')
  const el = page.querySelector('.scene')
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches
  const gone = () => !page.isConnected
  const steps = JSON.parse(el.querySelector('script[type="application/json"]').textContent)
  const fz = el.querySelector('.fz')
  const ticks = [...el.querySelectorAll('.tick')]
  const pp = el.querySelector('.pp')
  const count = el.querySelector('.count')
  const voiceBtn = el.querySelector('.voice')
  const cap = el.querySelector('.caption')
  let line = cap.querySelector('p')
  const voiced = steps.some(s => s.voice)
  const videos = [...el.querySelectorAll('video')]
  let at = -1, playing = false, timer = null, audio = null, voiceOn = true, started = false
  // BACK RESUMES, FORWARD STARTS OVER: the hive's website view marks a page
  // the back gesture returned to (data-hc-returning on its host), and only
  // then does the scene pick up at the beat the reader left it on.
  // PART OR WEBSITE: the hive's website view says where the site was entered
  // (data-hc-site-entry). Entered at a top tile, this page is part of the
  // website and shows its ways; entered anywhere deeper, it is just this part.
  // Standing alone (no hive), it is the website.
  const host = root instanceof Element && root.hasAttribute('data-hc-site-entry') ? root : null
  const mode = () => { const e = host ? host.getAttribute('data-hc-site-entry') || '/' : '/'; page.classList.toggle('part', e.split('/').filter(Boolean).length > 1) }
  mode()
  if (host) new MutationObserver(() => { if (gone()) return; mode() }).observe(host, { attributes: true, attributeFilter: ['data-hc-site-entry'] })
  const toSite = page.querySelector('.to-site')
  if (toSite) toSite.onclick = () => page.dispatchEvent(new CustomEvent('hc-site-widen', { bubbles: true }))
  const KEY = 'hc-scene:' + location.pathname
  const returning = root instanceof Element && root.hasAttribute('data-hc-returning')
  let resumeAt = 0
  if (returning) { try { const n = Number(sessionStorage.getItem(KEY)); if (Number.isInteger(n) && n >= 0) resumeAt = n } catch {} }
  const readTime = (say) => Math.max(3.4, say.split(/\\s+/).length / 2.6) * 1000 + 600
  const idle = () => { if (still || playing || gone()) return; for (const v of videos) { v.loop = true; v.play().catch(() => {}) } }
  let watch = 0
  const stopWatch = () => { cancelAnimationFrame(watch); watch = 0 }
  const quiet = () => { clearTimeout(timer); timer = null; stopWatch(); if (audio) { audio.onended = audio.onerror = null; audio.pause(); audio = null } }
  const show = (i) => {
    at = Math.max(0, Math.min(steps.length - 1, i))
    const s = steps[at]
    const lit = new Set(s.lit || ['*'])
    for (const n of el.querySelectorAll('.plate.beats [data-id], .fz.lights [data-id]')) n.classList.toggle('lit', lit.has('*') || lit.has(n.dataset.id))
    if (fz.classList.contains('duo')) { fz.classList.toggle('aside', !!s.beside); fz.classList.toggle('main', !s.beside && steps.some(x => x.beside)) }
    const p = document.createElement('p'); p.textContent = s.say; if (!still) p.className = 'rise'; line.replaceWith(p); line = p
    cap.classList.toggle('long', s.say.split(/\\s+/).length > 70); cap.scrollTop = 0
    requestAnimationFrame(() => cap.classList.toggle('more', cap.scrollHeight - cap.clientHeight > 4))
    ticks.forEach((t, k) => { t.classList.toggle('done', k < at); t.classList.toggle('now', k === at); if (k === at) t.setAttribute('aria-current', 'step'); else t.removeAttribute('aria-current') })
    if (count) count.textContent = String(at + 1).padStart(2, '0') + ' / ' + String(steps.length).padStart(2, '0')
    try { sessionStorage.setItem(KEY, String(at)) } catch {}
  }
  const paint = () => { pp.classList.toggle('playing', playing); pp.setAttribute('aria-label', playing ? 'Pause' : 'Play'); if (started) pp.classList.remove('lead') }
  const halt = () => { playing = false; quiet(); for (const v of videos) v.pause() }
  const next = () => { if (gone()) return halt(); if (at < steps.length - 1) { show(at + 1); speak() } else { playing = false; paint(); idle() } }
  // ONE SENTENCE ON SCREEN AT A TIME, like a film's subtitles. A scene's
  // sentences share its one voice: each plays its own stretch of it (from →
  // to), and the voice runs straight on from one sentence to the next while
  // the line under the figure changes with it. Jumping (a tick, back, next)
  // seeks; a drawn clip, timed to the same voice, follows the jump.
  const speak = () => {
    clearTimeout(timer); timer = null; stopWatch()
    if (!playing) return
    const s = steps[at]
    for (const v of videos) {
      v.loop = false
      if (at === 0 && s.from == null) { try { v.currentTime = 0 } catch {} }
      else if (v.dataset.drawn && s.from != null) { try { v.currentTime = s.from } catch {} }
      if (v.paused) v.play().catch(() => {})
    }
    const hold = () => { timer = setTimeout(next, readTime(s.say)) }
    if (!(voiceOn && s.voice)) { if (audio) { audio.onended = audio.onerror = null; audio.pause(); audio = null } hold(); return }
    let a = audio
    if (!a || a.dataset.src !== s.voice) {
      if (a) { a.onended = a.onerror = null; a.pause() }
      a = new Audio(s.voice); a.dataset.src = s.voice; audio = a
    }
    a.onended = () => { if (audio === a) { audio = null; timer = setTimeout(next, 800) } }
    a.onerror = () => { if (audio === a) { audio = null; hold() } }
    const from = s.from ?? 0
    const seek = () => { if (Math.abs(a.currentTime - from) > 0.35) { try { a.currentTime = from } catch {} } }
    if (a.readyState >= 1) seek(); else a.addEventListener('loadedmetadata', seek, { once: true })
    if (a.paused) a.play().catch(() => { if (audio === a) { audio = null; hold() } })
    if (s.to != null) {
      const follow = () => {
        if (audio !== a || !playing || gone()) return
        if (a.currentTime >= s.to - 0.03) { if (at < steps.length - 1) { show(at + 1); speak() } else { a.pause(); playing = false; paint(); idle() } return }
        watch = requestAnimationFrame(follow)
      }
      watch = requestAnimationFrame(follow)
    }
  }
  const play = (on) => {
    if (on) started = true
    playing = on; paint()
    if (on) { if (at === steps.length - 1 && !timer && !audio) show(0); speak() }
    else { quiet(); for (const v of videos) v.pause() }
  }
  const go = (i) => { const was = playing; quiet(); show(i); if (was) speak(); else idle() }
  pp.onclick = () => play(!playing)
  const back = el.querySelector('[data-act=back]'), fwd = el.querySelector('[data-act=next]')
  if (back) back.onclick = () => go(at - 1)
  if (fwd) fwd.onclick = () => go(at + 1)
  ticks.forEach((t, k) => { t.onclick = () => go(k) })
  if (voiceBtn) voiceBtn.onclick = () => { voiceOn = !voiceOn; voiceBtn.setAttribute('aria-pressed', String(voiceOn)); voiceBtn.setAttribute('aria-label', voiceOn ? 'Mute the voice' : 'Unmute the voice'); if (playing) speak() }
  // typing in a part to try holds the scene where it is
  cap.addEventListener('scroll', () => cap.classList.toggle('more', cap.scrollHeight - cap.scrollTop - cap.clientHeight > 4), { passive: true })
  el.addEventListener('focusin', (e) => { if (e.target instanceof HTMLInputElement && playing) play(false) })
  show(returning ? resumeAt : 0)
  el.classList.add('in')
  if (!voiced && !still && !returning) setTimeout(() => { if (!gone() && !started) play(true) }, 900)
  else idle()
  // The arrows and space step the scene while the page is on screen; once
  // the page is gone, the listener removes itself.
  const keys = (e) => {
    if (gone()) { removeEventListener('keydown', keys); halt(); return }
    const t = e.target
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t && t.isContentEditable)) return
    if (e.key === 'ArrowRight') go(at + 1)
    else if (e.key === 'ArrowLeft') go(at - 1)
    else if (e.key === ' ' && !(t instanceof HTMLButtonElement) && !(t instanceof HTMLAnchorElement)) { e.preventDefault(); play(!playing) }
  }
  addEventListener('keydown', keys)
})()`

const TRY = {
  // The word's address, exactly as hypercomb-core molecule-address.ts makes
  // it: sign(fold(canon(name) || trim(name))).
  word: {
    label: 'Type a word, your own way',
    value: 'My Tile',
    script: `const canon = (s) => s.normalize('NFC').replace(/[^\\p{L}\\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
const key = (s) => (canon(s) || s.trim()).toLowerCase()
const hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('')
async function show(v) {
  const k = key(v)
  out.innerHTML = k ? '<span class="k">the word, folded</span><code>' + esc(k) + '</code><span class="k">its address</span><code class="sig">' + await hex(k) + '</code>' : '<span class="k">an empty word has no address: it would be the root</span>'
}`,
  },
  // A signature, exactly as SignatureService.sign makes it: SHA-256 of the bytes.
  signature: {
    label: 'Type anything, then change one letter',
    value: 'hello',
    script: `const hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('')
let last = ''
async function show(v) {
  const sig = await hex(v)
  const changed = last ? [...sig].filter((c, i) => c !== last[i]).length : 0
  out.innerHTML = '<span class="k">its signature</span><code class="sig">' + sig + '</code>' + (last ? '<span class="k">' + changed + ' of 64 characters changed</span>' : '')
  last = sig
}`,
  },
}

/** The second panel: a part to try. */
const tryPanel = (name) => {
  const t = TRY[name]
  if (!t) throw new Error(`no try part named ${name}`)
  return `<div class="try"><label for="try-in">${esc(t.label)}</label><input id="try-in" value="${esc(t.value)}" autocomplete="off" spellcheck="false"><output id="try-out" for="try-in"></output></div>`
}

/** The second panel: a picture taken in a running hive. */
const livePanel = (l) => `<div class="figbox"><div class="fig shot" style="--ratio:${l.width}/${l.height}"><img src="${esc(l.src)}" width="${l.width}" height="${l.height}" alt="${esc(l.alt)}" decoding="async"></div>` +
  `<div class="figcap live">${icon('hex')}<span>live · ${esc(l.title)}</span></div></div>`

const crumbsHtml = (route) => `
  <nav class="crumbs mono-label" data-part="crumbs" aria-label="Where you are">${icon('hex')}${route.map((w, i) => i === route.length - 1
    ? `<span aria-current="page">${esc(w)}</span>`
    : `<a href="/${route.slice(0, i + 1).map(esc).join('/')}">${esc(w)}</a><span class="sep" aria-hidden="true">/</span>`).join('')}</nav>`

const sceneHtml = (sc) => {
  const voiced = sc.steps.some(s => s.voice)
  const steps = sc.steps.map(s => ({ say: s.say, voice: s.voice || null, from: s.from ?? null, to: s.to ?? null, lit: s.lit ?? null, beside: !!s.beside }))
  return `
  <section class="scene" data-part="scene" aria-label="${esc(sc.name || 'The scene')}">
    <div class="eyebrow">${sc.eyebrow}</div>
    <h1>${sc.headline}</h1>
    <div class="fz${sc.beside ? ' duo' : ''}${sc.lights ? ' lights' : ''}"><div class="pane">${sc.figure}</div>${sc.beside ? `<div class="pane">${sc.beside}</div>` : ''}</div>${sc.sub ? `
    <p class="sub">${sc.sub}</p>` : '<span></span>'}
    <div class="dock">${sc.link ? `
      <a class="cta" href="${esc(sc.link.href)}" target="_blank" rel="noopener">${esc(sc.link.label)}${icon('external')}</a>` : ''}
      <div class="caption" aria-live="polite"><p></p></div>
      <nav class="transport" aria-label="Play">
        <button type="button" class="ib pp${voiced ? ' lead' : ''}" aria-label="Play">${icon('play', 'i-play')}${icon('pause', 'i-pause')}<span class="lead-text">Listen${sc.minutes ? ` · ${esc(sc.minutes)}` : ''}</span></button>${sc.steps.length > 1 ? `
        <button type="button" class="ib" data-act="back" aria-label="Back">${icon('left')}</button>
        <button type="button" class="ib" data-act="next" aria-label="Next">${icon('right')}</button>
        <span class="ticks">${sc.steps.map((s, k) => `<button type="button" class="tick" aria-label="${esc(`${k + 1}: ${s.say.slice(0, 60)}`)}"></button>`).join('')}</span>
        <span class="count">01 / ${String(sc.steps.length).padStart(2, '0')}</span>` : `
        <span class="ticks" aria-hidden="true"></span>`}${voiced ? `
        <button type="button" class="ib voice" aria-pressed="true" aria-label="Mute the voice">${icon('speaker', 'i-speaker')}${icon('muted', 'i-muted')}</button>` : ''}
      </nav>
    </div>
    <script type="application/json">${JSON.stringify(steps).replace(/</g, '\\u003c')}</script>
  </section>`
}

const waysHtml = (ways) => !ways || (!ways.children.length && !ways.parent && !(ways.also || []).length) ? '' : `
  <nav class="ways" data-part="ways" aria-label="Where to go from here">${ways.children.length ? `
    <span class="lbl mono-label">Step in</span>${ways.children.map(c => c.page
      ? `<a class="w" href="./${esc(c.name)}" title="${esc(c.note)}">${icon('hex')}${esc(c.name)}</a>`
      : `<span class="w" title="${esc(`${c.note} (its page is coming)`)}">${esc(c.name)}</span>`).join('')}` : ''}${(ways.also || []).map(a => `
    <a class="up" href="/${esc(a.name)}" title="${esc(a.note)}">${esc(a.name)}${icon('right')}</a>`).join('')}${ways.parent ? `
    <a class="up" href="/${ways.parentRoute.map(esc).join('/')}">${icon('left')}${esc(ways.parent)}</a>` : ''}
  </nav>`

/** One tile's page: its one scene. */
const render = (parts) => {
  const { route, title, scene, tryPart = null, ways = null, faces = '', sprite = '' } = parts
  const tryDef = tryPart ? TRY[tryPart] : null
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
${faces}
${TOKENS}
${STYLE}
</style>
</head>
<body>
${sprite}
<main class="page"><div class="top">${crumbsHtml(route)}<button type="button" class="to-site" aria-label="Open the website at this page">${icon('hex')}website</button></div>${sceneHtml(scene)}${waysHtml(ways)}
</main>
<script>${SCRIPT}${tryDef ? `
;(() => {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const root = (document.currentScript && document.currentScript.parentElement) || document
  const input = root.querySelector('#try-in')
  const out = root.querySelector('#try-out')
  ${tryDef.script}
  input.addEventListener('input', () => show(input.value))
  show(input.value)
})()` : ''}
</script>
</body>
</html>
`
}

module.exports = { render, esc, icon, tryPanel, livePanel, TRY }
