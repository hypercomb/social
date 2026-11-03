// A BLOCK: one tile's page, whole (documentation/living-presentation.md, "The
// tree as planted"; website-artifact-paradigm.md rules 1, 2 and 10).
//
// THE STANDARD IS THE TOUR (scripts/presentation): its ink and honey, its two
// faces, its figures, its voice. A page is the tour's stage, laid in a column
// that scrolls: an eyebrow, the headline, the figure, the narration under one
// hairline, and the transport that plays it. A tile one of the tour's scenes
// explains shows that scene and nothing of its own in its place (tour.cjs); a
// tile no scene explains is drawn in the same language and plays its beats
// the same way.
//
// Every page stands alone: its look, its script and its pictures are inside
// it or named by signature (`resource:<sig>` — the faces, the voice, the
// clips, the captured pictures), and it asks no other host for anything
// (doctrine T7). It names no other block: a link names a WORD (`./word` steps
// one level down; an ancestor is its route, `/presentation/simple`), and the
// tile that fills the word answers it.
//
// Its natural parts are marked by the word each would fill (`data-part`:
// crumbs, stage, live, try, ways, code). Extruding a block later is a layout
// of those words and a component for each (the layout word).
//
// IN THE HIVE a page is mounted inline (site-view.drone.ts): its CSS is scoped
// to the host, `:root` becomes the host, and `resource:<sig>` becomes
// `/@resource/<sig>`. Its script finds its own elements from its own root and
// lets go of the keyboard, its timers, its voice and its clips the moment it
// is unmounted.
//
// render(parts) -> the page's HTML. Every part is prepared by build.cjs:
//   route    ['presentation', 'simple']
//   title    the document title
//   stages   [{ label, minutes, frames: [{ eyebrow, headline, figure, sub, link }],
//               steps: [{ frame, say, voice, lit, name }] }]
//   live     [{ src, width, height, title, caption, alt }] — pictures taken in a running hive
//   tryPart  'word' | 'signature' | null
//   ways     { children: [{ name, note, page }], parent, parentRoute }
//   code     [{ path, text }]
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

/* one column; every size reads from its width (cqi), so the page is the same
   page standing alone or mounted inside the hive */
.page{container-type:inline-size;width:min(1040px,100%);margin:0 auto;padding:20px 16px 72px;--measure:760px}
.mono-label{font-family:var(--mono);font-size:12px;line-height:1.3;letter-spacing:var(--track-label);text-transform:uppercase}

/* ---------- where you are ---------- */
.crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:.25em .6em;color:var(--faint-text)}
.crumbs .g{color:var(--honey);font-size:14px}
.crumbs a{text-decoration:none;color:var(--dim)}
.crumbs a:hover{color:var(--honey)}
.crumbs .sep{color:var(--line-strong)}
.crumbs [aria-current]{color:var(--ink)}

/* ---------- the stage ---------- */
.stage{margin-top:clamp(28px,5cqi,56px);text-align:center}
.stage-label{color:var(--faint-text);margin:0 0 clamp(18px,3cqi,32px)}
.frame{display:none;justify-items:center}
.frame.on{display:grid;grid-template-columns:minmax(0,1fr)}
.frame>*{opacity:0;transform:translateY(14px);transition:opacity .7s var(--ease),transform .7s var(--ease)}
.frame.in>*{opacity:1;transform:none}
.frame.in>:nth-child(2){transition-delay:.1s}
.frame.in>:nth-child(3){transition-delay:.22s}
.frame.in>:nth-child(4){transition-delay:.34s}
.frame.in>:nth-child(5){transition-delay:.46s}
.eyebrow{font-family:var(--mono);font-size:clamp(11px,1.2cqi,13px);line-height:1.3;letter-spacing:var(--track-eyebrow);
  padding-inline-start:var(--track-eyebrow);text-transform:uppercase;color:var(--honey-deep);margin:0 0 .9em}
.frame h1{font-weight:300;font-size:clamp(30px,5.6cqi,66px);line-height:1.06;letter-spacing:var(--track-display);
  margin:0 0 clamp(18px,3cqi,30px);max-width:22ch;text-wrap:balance;color:var(--ink)}
.frame h1 b{font-weight:500;color:var(--honey-text)}
.frame .sub{color:var(--dim);font-size:clamp(16px,1.9cqi,20px);line-height:1.4;max-width:56ch;margin:clamp(16px,2.6cqi,26px) 0 0;text-wrap:balance}
.frame .sub b{font-weight:500;color:var(--ink)}
.fz{width:100%;display:grid;grid-template-columns:minmax(0,1fr);justify-items:center}

/* the tour's figures */
.figbox{display:grid;grid-template-columns:minmax(0,1fr);row-gap:6px;width:100%;justify-items:start}
.fig.film,.fig.plate,.fig.shot{width:100%;aspect-ratio:var(--ratio);border:1px solid var(--line-strong);border-radius:var(--r-card);
  overflow:hidden;background:var(--panel);box-shadow:var(--shadow)}
.fig.film video,.fig.shot img{display:block;width:100%;height:100%;object-fit:cover;background:#111419}
.fig.plate svg{display:block;width:100%;height:100%}
.figcap{width:100%;min-width:0;display:flex;align-items:center;gap:.7em;font-family:var(--mono);font-size:12px;line-height:1.3;
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
.frame.in .flow{stroke-dashoffset:0}

/* a drawn figure that plays its beats: each part lights as it is said */
.plate.beats [data-id]{opacity:.38;transition:opacity .5s var(--ease)}
.plate.beats [data-id].lit{opacity:1}

.fig.hexrow{display:flex;flex-wrap:wrap;justify-content:center;gap:clamp(14px,2.4cqi,26px);margin:clamp(8px,2cqi,20px) 0}
.hexb{width:clamp(96px,13cqi,132px);display:flex;flex-direction:column;align-items:center;gap:.6em}
.hexb .hx{position:relative;width:100%;aspect-ratio:.866/1}
.hexb .hx svg.h{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.hexb .hx .o{fill:var(--panel);stroke:var(--line-strong);stroke-width:1;vector-effect:non-scaling-stroke}
.hexb .hx .in{fill:none;stroke:var(--honey-deep);stroke-width:1;vector-effect:non-scaling-stroke;opacity:.6}
.hexb .hx svg.g{position:absolute;left:50%;top:50%;width:34%;height:34%;transform:translate(-50%,-50%);color:var(--honey);stroke-width:1.4}
.hexb .t{font-family:var(--mono);font-size:12px;line-height:1.4;letter-spacing:var(--track-label);padding-inline-start:var(--track-label);
  text-transform:uppercase;color:var(--dim);white-space:nowrap}

.fig.stack,.fig.list{display:flex;flex-direction:column;width:min(640px,100%);border:1px solid var(--line);border-radius:var(--r-card);
  background:var(--panel);overflow:hidden;text-align:left}
.fig.stack{flex-direction:column-reverse}
.lay{display:grid;grid-template-columns:max-content 1fr;column-gap:24px;align-items:baseline;padding:11px 18px;
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

.fig.road{position:relative;width:fit-content;max-width:100%;display:grid;row-gap:clamp(12px,1.8cqi,18px);text-align:left;padding-left:2px}
.fig.road::before{content:"";position:absolute;left:8px;top:.6em;bottom:.6em;width:1px;background:var(--line)}
.mile{display:grid;grid-template-columns:14px 1fr;column-gap:18px;align-items:start;position:relative}
.mile svg.mk{width:14px;height:16px;margin-top:4px;fill:var(--bg);stroke:var(--faint);stroke-width:1.5;overflow:visible}
.mile.landed svg.mk{fill:var(--honey-fill);stroke:var(--honey-fill)}
.mile.next svg.mk{fill:var(--bg);stroke:var(--honey-deep)}
.mile .mt{font-weight:500;font-size:clamp(16px,1.9cqi,19px);line-height:1.25;color:var(--ink)}
.mile .md{color:var(--dim);font-size:clamp(14px,1.55cqi,16px);line-height:1.4;max-width:58ch;margin-top:.15em}

.cta{display:inline-flex;align-items:center;gap:.6em;font-weight:500;font-size:14px;line-height:1;color:var(--honey);text-decoration:none;
  border:1px solid var(--honey-deep);border-radius:var(--r-ctl);padding:11px 18px;margin-top:clamp(16px,2.6cqi,26px);transition:background .15s,border-color .15s}
.cta:hover{background:var(--honey-tint);border-color:var(--honey)}

/* the narration: a strip under one hairline, the tour's caption */
.caption{position:relative;width:100%;max-width:var(--measure);margin:clamp(22px,3.4cqi,34px) auto 0;padding:14px 0 0;text-align:left;
  font-size:clamp(16px,1.9cqi,19px);line-height:1.55;color:var(--ink);min-height:calc(1.55em * 2 + 14px);text-wrap:pretty}
.caption::before{content:"";position:absolute;left:0;right:0;top:0;height:1px;background:var(--line)}
.caption p{margin:0}
.caption p.rise{animation:rise .5s var(--ease)}
@keyframes rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}

/* the transport: the tour's bar, in the column */
.transport{display:flex;align-items:center;gap:6px;width:100%;max-width:var(--measure);margin:14px auto 0}
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
.ticks{flex:1;display:flex;gap:3px;height:24px;align-items:center;min-width:60px;margin:0 6px}
.tick{flex:1;height:24px;background:none;border:0;padding:0;cursor:pointer;position:relative}
.tick::after{content:"";position:absolute;left:0;right:0;top:11px;height:2px;background:var(--line);transition:background .3s,transform .3s}
.tick.done::after{background:var(--honey-deep)}
.tick.now::after{background:var(--honey-fill);transform:scaleY(2)}
.tick:hover::after{background:var(--dim)}
.count{font-family:var(--mono);font-size:12px;font-variant-numeric:tabular-nums;letter-spacing:var(--track-data);color:var(--dim);white-space:nowrap;padding:0 4px}
.voice .i-muted,.voice[aria-pressed="false"] .i-speaker{display:none}
.voice[aria-pressed="false"] .i-muted{display:block}

/* ---------- sections under the stage ---------- */
.part-head{display:flex;align-items:baseline;gap:.8em;margin:0 0 16px}
.part-head h2{margin:0;font-family:var(--mono);font-weight:400;font-size:12px;letter-spacing:var(--track-label);text-transform:uppercase;color:var(--honey-deep)}
.part-head::after{content:"";flex:1;height:1px;background:var(--line);align-self:center}
.live,.try,.ways,.code{margin-top:clamp(52px,8cqi,88px)}
.live .grid{display:grid;gap:clamp(22px,3.4cqi,34px)}
.live .grid.two{grid-template-columns:1fr 1fr}
.live figure{margin:0}
.live figure p{margin:10px 0 0;color:var(--dim);font-size:15px;line-height:1.5;max-width:70ch}

.try .box{border:1px solid var(--line);border-radius:var(--r-card);background:var(--panel);padding:18px}
.try label{display:block;color:var(--dim);font-size:14px;margin-bottom:8px}
.try input{width:100%;font:15px var(--mono);padding:10px 12px;border:1px solid var(--line);border-radius:var(--r-ctl);background:var(--bg);color:var(--ink)}
.try input:focus{outline:none;border-color:var(--honey-deep)}
.try output{display:grid;gap:4px;margin-top:12px}
.try .k{font-family:var(--mono);font-size:11px;letter-spacing:var(--track-label);text-transform:uppercase;color:var(--faint-text);margin-top:6px}
.try code{font:14px var(--mono);word-break:break-all;color:var(--ink)}
.try code.sig{color:var(--honey)}

.ways ul{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:var(--r-card);background:var(--panel);overflow:hidden}
.ways li{border-top:1px solid var(--line)}
.ways li:first-child{border-top:0}
.ways .row{display:grid;grid-template-columns:minmax(9em,max-content) 1fr auto;column-gap:24px;align-items:baseline;padding:13px 18px;text-decoration:none}
.ways .w{font-family:var(--mono);font-size:14px;letter-spacing:var(--track-data);color:var(--ink)}
.ways .n{color:var(--dim);font-size:15px;line-height:1.45}
.ways .go{color:var(--faint-text);align-self:center}
.ways a.row{transition:background .15s,box-shadow .15s}
.ways a.row:hover{background:var(--honey-tint);box-shadow:inset 2px 0 0 var(--honey-deep)}
.ways a.row:hover .w,.ways a.row:hover .go{color:var(--honey)}
.ways .later .w{color:var(--faint-text)}
.ways .later .go{font-family:var(--mono);font-size:11px;letter-spacing:var(--track-label);text-transform:uppercase}
.ways .up{display:inline-flex;align-items:center;gap:.5em;margin-top:16px;color:var(--faint-text);text-decoration:none;font-size:14px}
.ways .up:hover{color:var(--honey)}
.stage+.ways{margin-bottom:clamp(8px,2cqi,24px)}
.ways+.stage{margin-top:clamp(56px,9cqi,104px);padding-top:clamp(28px,5cqi,56px);border-top:1px solid var(--line)}

.code figure{margin:0 0 18px;border:1px solid var(--line);border-radius:var(--r-card);background:var(--panel);overflow:hidden}
.code figcaption{font-family:var(--mono);font-size:12px;letter-spacing:var(--track-data);color:var(--dim);padding:9px 14px;border-bottom:1px solid var(--line);background:var(--bg2)}
.code pre{margin:0;padding:14px;overflow-x:auto;font:13px/1.55 var(--mono);color:var(--ink);tab-size:2}

@container (max-width:620px){
  .live .grid.two{grid-template-columns:1fr}
  .lay{grid-template-columns:1fr;row-gap:2px;font-size:12px}
  .lay>span:last-child{text-align:left}
  .ways .row{grid-template-columns:1fr auto;row-gap:4px}
  .ways .n{grid-column:1/-1;grid-row:2}
  .figcap .sig{display:none}
  .hexb{width:clamp(84px,27cqi,112px)}
  .hexb .t{font-size:11px}
  .count{display:none}
}
@media (prefers-reduced-motion:reduce){
  .frame>*,.caption p.rise,.plate.beats [data-id],.flow,.tick::after{transition:none!important;animation:none!important;transform:none!important}
  .frame.on>*{opacity:1}
  .flow{stroke-dashoffset:0!important}
}`

/* The player. One script for every stage on the page: a stage is frames (what
   is on screen) and steps (what is said, and what lights). A step with a voice
   plays it; a silent step holds for its words' reading time. One voice on the
   page at a time. A voiced stage waits to be asked (a browser plays sound only
   after a press); a silent one plays itself once it is in view. */
const SCRIPT = `
(() => {
  const root = (document.currentScript && document.currentScript.parentElement) || document
  const page = root.querySelector('.page')
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches
  const gone = () => !page.isConnected
  const all = []
  let active = null
  const readTime = (say) => Math.max(3.4, say.split(/\\s+/).length / 2.6) * 1000 + 600
  for (const el of root.querySelectorAll('.stage')) {
    const steps = JSON.parse(el.querySelector('script[type="application/json"]').textContent)
    const frames = [...el.querySelectorAll('.frame')]
    const ticks = [...el.querySelectorAll('.tick')]
    const pp = el.querySelector('.pp')
    const count = el.querySelector('.count')
    const voiceBtn = el.querySelector('.voice')
    let line = el.querySelector('.caption p')
    const voiced = steps.some(s => s.voice)
    let at = -1, frameAt = -1, playing = false, timer = null, audio = null, voiceOn = true, started = false
    const videos = (i) => frames[i] ? [...frames[i].querySelectorAll('video')] : []
    const idle = () => { if (still || playing || gone()) return; for (const v of videos(frameAt)) { v.loop = true; v.play().catch(() => {}) } }
    const quiet = () => { clearTimeout(timer); timer = null; if (audio) { audio.onended = audio.onerror = null; audio.pause(); audio = null } }
    const showFrame = (i) => {
      if (i === frameAt) return
      if (frameAt >= 0) { frames[frameAt].classList.remove('on', 'in'); for (const v of videos(frameAt)) v.pause() }
      frameAt = i
      const f = frames[i]
      f.classList.add('on'); void f.offsetWidth; f.classList.add('in')
    }
    const show = (i) => {
      at = Math.max(0, Math.min(steps.length - 1, i))
      const s = steps[at]
      showFrame(s.frame)
      const lit = new Set(s.lit)
      for (const n of frames[s.frame].querySelectorAll('.plate.beats [data-id]')) n.classList.toggle('lit', lit.has(n.dataset.id))
      const p = document.createElement('p'); p.textContent = s.say; if (!still) p.className = 'rise'; line.replaceWith(p); line = p
      ticks.forEach((t, k) => { t.classList.toggle('done', k < at); t.classList.toggle('now', k === at); if (k === at) t.setAttribute('aria-current', 'step'); else t.removeAttribute('aria-current') })
      if (count) count.textContent = String(at + 1).padStart(2, '0') + ' / ' + String(steps.length).padStart(2, '0')
    }
    const paint = () => { pp.classList.toggle('playing', playing); pp.setAttribute('aria-label', playing ? 'Pause' : 'Play'); if (started) pp.classList.remove('lead') }
    const halt = () => { playing = false; quiet(); for (const v of el.querySelectorAll('video')) v.pause() }
    const next = () => { if (gone()) return halt(); if (at < steps.length - 1) { show(at + 1); speak() } else { playing = false; paint(); idle() } }
    const speak = () => {
      quiet()
      if (!playing) return
      const s = steps[at]
      for (const v of videos(s.frame)) { v.loop = false; try { v.currentTime = 0 } catch {} v.play().catch(() => {}) }
      const hold = () => { timer = setTimeout(next, readTime(s.say)) }
      if (voiceOn && s.voice) {
        const a = new Audio(s.voice); audio = a
        a.onended = () => { if (audio === a) timer = setTimeout(next, 800) }
        a.onerror = () => { if (audio === a) hold() }
        a.play().catch(() => { if (audio === a) hold() })
      } else hold()
    }
    const stage = {
      playing: () => playing,
      at: () => at,
      play(on) {
        if (on) { for (const o of all) if (o !== stage && o.playing()) o.play(false); active = stage; started = true }
        playing = on; paint()
        if (on) { if (at === steps.length - 1 && !timer && !audio) show(0); speak() }
        else { quiet(); for (const v of videos(frameAt)) v.pause() }
      },
      go(i) { const was = playing; quiet(); show(i); active = stage; if (was) speak(); else idle() },
    }
    all.push(stage)
    pp.onclick = () => stage.play(!playing)
    const back = el.querySelector('[data-act=back]'), fwd = el.querySelector('[data-act=next]')
    if (back) back.onclick = () => stage.go(at - 1)
    if (fwd) fwd.onclick = () => stage.go(at + 1)
    ticks.forEach((t, k) => { t.onclick = () => stage.go(k) })
    if (voiceBtn) voiceBtn.onclick = () => { voiceOn = !voiceOn; voiceBtn.setAttribute('aria-pressed', String(voiceOn)); voiceBtn.setAttribute('aria-label', voiceOn ? 'Mute the voice' : 'Unmute the voice'); if (playing) speak() }
    show(0)
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((seen) => {
        if (gone()) { io.disconnect(); halt(); return }
        for (const e of seen) {
          if (e.isIntersecting && e.intersectionRatio >= .35) { if (!active) active = stage; if (!voiced && !started && !still) stage.play(true); else idle() }
          else if (!e.isIntersecting) { if (!voiced && playing) stage.play(false); if (!playing) for (const v of el.querySelectorAll('video')) v.pause() }
        }
      }, { threshold: [0, .35] })
      io.observe(el)
    } else idle()
  }
  // The arrows and space step the stage last played while the page is on
  // screen; once the page is gone, the listener removes itself.
  const keys = (e) => {
    if (gone()) { removeEventListener('keydown', keys); for (const s of all) s.play(false); return }
    const t = e.target
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t && t.isContentEditable)) return
    const s = active || all[0]
    if (!s) return
    if (e.key === 'ArrowRight') s.go(s.at() + 1)
    else if (e.key === 'ArrowLeft') s.go(s.at() - 1)
    else if (e.key === ' ' && !(t instanceof HTMLButtonElement) && !(t instanceof HTMLAnchorElement)) { e.preventDefault(); s.play(!s.playing()) }
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

const crumbsHtml = (route) => `
  <nav class="crumbs mono-label" data-part="crumbs" aria-label="Where you are">${icon('hex')}${route.map((w, i) => i === route.length - 1
    ? `<span aria-current="page">${esc(w)}</span>`
    : `<a href="/${route.slice(0, i + 1).map(esc).join('/')}">${esc(w)}</a><span class="sep" aria-hidden="true">/</span>`).join('')}</nav>`

const stageHtml = (st) => {
  const voiced = st.steps.some(s => s.voice)
  const frames = st.frames.map(f => `
    <div class="frame">
      <div class="eyebrow">${f.eyebrow}</div>
      <h1>${f.headline}</h1>
      <div class="fz">${f.figure}</div>${f.sub ? `
      <p class="sub">${f.sub}</p>` : ''}${f.link ? `
      <a class="cta" href="${esc(f.link.href)}" target="_blank" rel="noopener">${esc(f.link.label)}${icon('external')}</a>` : ''}
    </div>`).join('')
  const steps = st.steps.map(s => ({ frame: s.frame, say: s.say, voice: s.voice || null, lit: s.lit || [] }))
  return `
  <section class="stage" data-part="stage" aria-label="${esc(st.label || 'The presentation')}">${st.label ? `
    <p class="stage-label mono-label">${esc(st.label)}</p>` : ''}${frames}
    <div class="caption" aria-live="polite"><p></p></div>
    <nav class="transport" aria-label="Play">
      <button type="button" class="ib pp${voiced ? ' lead' : ''}" aria-label="Play">${icon('play', 'i-play')}${icon('pause', 'i-pause')}<span class="lead-text">Listen${st.minutes ? ` · ${esc(st.minutes)}` : ''}</span></button>
${st.steps.length > 1 ? `
      <button type="button" class="ib" data-act="back" aria-label="Back">${icon('left')}</button>
      <button type="button" class="ib" data-act="next" aria-label="Next">${icon('right')}</button>
      <span class="ticks">${st.steps.map((s, k) => `<button type="button" class="tick" aria-label="${esc(`${k + 1}: ${s.name || s.say.slice(0, 60)}`)}"></button>`).join('')}</span>
      <span class="count">01 / ${String(st.steps.length).padStart(2, '0')}</span>` : `
      <span class="ticks" aria-hidden="true"></span>`}${voiced ? `
      <button type="button" class="ib voice" aria-pressed="true" aria-label="Mute the voice">${icon('speaker', 'i-speaker')}${icon('muted', 'i-muted')}</button>` : ''}
    </nav>
    <script type="application/json">${JSON.stringify(steps).replace(/</g, '\\u003c')}</script>
  </section>`
}

const liveHtml = (live) => !live.length ? '' : `
  <section class="live" data-part="live" aria-label="In a running hive">
    <div class="part-head"><h2>In the hive</h2></div>
    <div class="grid${live.length === 2 ? ' two' : ''}">${live.map(l => `
      <figure>
        <div class="figbox">
          <div class="fig shot" style="--ratio:${l.width}/${l.height}"><img src="${esc(l.src)}" width="${l.width}" height="${l.height}" alt="${esc(l.alt)}" loading="lazy" decoding="async"></div>
          <div class="figcap live">${icon('hex')}<span>live · ${esc(l.title)}</span></div>
        </div>${l.caption ? `
        <p>${esc(l.caption)}</p>` : ''}
      </figure>`).join('')}
    </div>
  </section>`

const tryHtml = (t) => !t ? '' : `
  <section class="try" data-part="try" aria-label="Try it">
    <div class="part-head"><h2>Try it</h2></div>
    <div class="box">
      <label for="try-in">${esc(t.label)}</label>
      <input id="try-in" value="${esc(t.value)}" autocomplete="off" spellcheck="false">
      <output id="try-out" for="try-in"></output>
    </div>
  </section>`

const waysHtml = (ways) => !ways || (!ways.children.length && !ways.parent) ? '' : `
  <nav class="ways" data-part="ways" aria-label="Where to go from here">${ways.children.length ? `
    <div class="part-head"><h2>Step in</h2></div>
    <ul>${ways.children.map(c => c.page
      ? `<li><a class="row" href="./${esc(c.name)}"><span class="w">${esc(c.name)}</span><span class="n">${esc(c.note)}</span><span class="go">${icon('right')}</span></a></li>`
      : `<li><div class="row later"><span class="w">${esc(c.name)}</span><span class="n">${esc(c.note)}</span><span class="go">soon</span></div></li>`).join('')}</ul>` : ''}${ways.parent ? `
    <a class="up" href="/${ways.parentRoute.map(esc).join('/')}">${icon('left')}Back to ${esc(ways.parent)}</a>` : ''}
  </nav>`

const codeHtml = (code) => !code.length ? '' : `
  <section class="code" data-part="code" aria-label="The source">
    <div class="part-head"><h2>The source</h2></div>${code.map(c => `
    <figure><figcaption>${esc(c.path)}</figcaption><pre><code>${esc(c.text)}</code></pre></figure>`).join('')}
  </section>`

/** One block's page. */
const render = (parts) => {
  const { route, title, stages = [], live = [], tryPart = null, ways = null, code = [], faces = '', sprite = '' } = parts
  const tryDef = tryPart ? TRY[tryPart] : null
  if (tryPart && !tryDef) throw new Error(`no try part named ${tryPart}`)
  // The top tile's two stages bracket its ways: the opening, the values, the close.
  const [first, ...rest] = stages
  const body = route.length === 1 && rest.length
    ? `${stageHtml(first)}${waysHtml(ways)}${rest.map(stageHtml).join('')}${liveHtml(live)}${tryHtml(tryDef)}${codeHtml(code)}`
    : `${stages.map(stageHtml).join('')}${liveHtml(live)}${tryHtml(tryDef)}${waysHtml(ways)}${codeHtml(code)}`
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
<main class="page">${crumbsHtml(route)}${body}
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

module.exports = { render, esc, icon }
