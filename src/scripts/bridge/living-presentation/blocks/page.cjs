// A BLOCK: one tile's page, whole (documentation/living-presentation.md, "The
// tree as planted"; website-artifact-paradigm.md rules 1, 2 and 10).
//
// ONE TILE, ONE SCENE. The hierarchy is the presentation: every tile is one
// scene, and a reader walks them in any order — in by a word, back up by the
// crumbs. A page is that one scene as one slide, the size of the screen:
//
//   crumbs   where you are; every ancestor is a way back (the one way up)
//   beside   the tiles under the same parent: previous and next, and where
//            this one stands among them, with the parent one press up
//   ways     the tile's children, as a row: each opens the next level down
//   scene    the eyebrow, the headline, the figure, and the narration under
//            one hairline with its transport — the tour's stage, exactly
//
// The three menus sit ABOVE the video (jwize 2026-11-07: "put the simple and
// other video menus as the top of the video"). jwize 2026-11-06: every node is
// a video, some have children; a parent is a category you choose into, so no
// tab row mixes levels.
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
// one level down; an ancestor is its route, `/protocol/simple`), and the
// tile that fills the word answers it. The source a tile explains rides on
// the tile as included files, not on the slide.
//
// Its natural parts are marked by the word each would fill (`data-part`:
// crumbs, scene, ways, beside). Extruding a block later is a layout of those words
// and a component for each (the layout word).
//
// IN THE HIVE a page is mounted inline (site-view.drone.ts) in a host pinned
// over the viewport: its CSS is scoped to the host, `:root` becomes the host,
// and `resource:<sig>` becomes `/@resource/<sig>`. Its script finds its own
// elements from its own root and lets go of the keyboard, its timers, its
// voice and its clips the moment it is unmounted.
//
// render(parts) -> the page's HTML. Every part is prepared by build.cjs:
//   route    ['protocol', 'simple']
//   title    the document title
//   scene    { eyebrow, headline, figure, beside, sub, link, minutes,
//              steps: [{ say, voice, lit, name }] }
//            `beside` is the second panel's HTML (a capture or a try part), or ''
//   tryPart  'word' | 'signature' | null (its script)
//   ways     { children: [{ name, note, route, page }],
//              section: [{ name, note, route, page, current }],
//              beside: { at, of, parent: { name, route, page } | null, prev, next } }
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

// THE TILE LIST'S ONE STYLESHEET (jwize 2026-11-10: "the ai chat list and keeping
// them all in sync"). Read from the module the hive's own list uses
// (assistant/tiles-rail.css.ts) when the page is built, so a page's sidebar
// cannot look different from the chat window's list.
const RAIL_CSS = (() => {
  const fs = require('fs'), path = require('path')
  const file = path.join(__dirname, '..', '..', '..', '..', 'hypercomb-essentials', 'src', 'assistant', 'tiles-rail.css.ts')
  // The module is constants and one template string (it promises so in its header),
  // so it is evaluated as plain JavaScript: no compiler in the page build.
  const code = fs.readFileSync(file, 'utf8').replace(/^export const /gm, 'const ') + '\nreturn RAIL_CSS'
  const css = new Function(code)()
  if (typeof css !== 'string' || !css.includes('.hc-rail-row')) throw new Error('page.cjs: the tile list stylesheet did not load from ' + file)
  return css
})()

const STYLE = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--ink);font-family:var(--sans);
  font-synthesis:none;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:inherit}
button{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--honey);outline-offset:2px}
[hidden]{display:none!important}
svg.g{width:1em;height:1em;display:inline-block;vertical-align:-.15em;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;flex:none}

/* ONE SLIDE: the screen's height (less the hive's exit corner), one column:
   the stage, with the crumbs, the sibling menu, then the video (jwize
   2026-11-10: "the sibling menu ... supposed to be above the video"). The tree
   menu is a drawer behind the menu button at every width (jwize 2026-11-10:
   "the menu should be hidden but expandable").
   The STAGE is the container, so sizes read from the video's own width (cqi),
   the same slide standing alone or mounted in the hive. */
.page{width:min(1280px,100%);margin:0 auto;padding:14px 16px 0;position:relative;
  height:calc(100vh - var(--hc-site-chrome-bottom,0px));height:calc(100dvh - var(--hc-site-chrome-bottom,0px));min-height:520px;
  display:grid;grid-template-columns:minmax(0,1fr);--measure:780px}
.stage{container-type:inline-size;display:grid;grid-template-rows:auto auto minmax(0,1fr);min-height:0;min-width:0}
.stage>.top{grid-row:1}.stage>.row{grid-row:2}.stage>.scene{grid-row:3}
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
.top .ib2{display:inline-flex;align-items:center;justify-content:center;width:30px;height:28px;color:var(--dim);background:none;
  border:1px solid var(--line);border-radius:var(--r-ctl);cursor:pointer;padding:0}
.top .ib2:hover{color:var(--honey);border-color:var(--honey-deep);background:var(--honey-tint)}
.top .ib2 svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.to-site{display:none;align-items:center;gap:.45em;margin-left:auto;font-family:var(--mono);font-size:12px;letter-spacing:var(--track-label);
  text-transform:uppercase;color:var(--dim);background:none;border:1px solid var(--line);border-radius:var(--r-ctl);padding:5px 10px;cursor:pointer}
.to-site:hover{color:var(--honey);border-color:var(--honey-deep);background:var(--honey-tint)}
.to-site .g{color:var(--honey);font-size:13px}
.page.part .crumbs,.page.part .tree,.page.part .row{visibility:hidden}
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

/* real tiles, taken out of a running hive (hive-figure.cjs): each its own
   picture, edged in its own border colour, in the hive's staggered rows */
.figbox.hivebox{width:min(100%,var(--cap),calc((100cqh - 26px) / var(--tall-n, .8)));margin-inline:auto;justify-self:center}
.fig.hive{position:relative;width:100%;height:0;padding-bottom:var(--tall)}
.fig.hive .hx{position:absolute;box-sizing:border-box;padding:0.45%;transform:scale(.965);background:var(--edge,var(--line-strong));
  clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)}
.fig.hive .hx img{display:block;width:100%;height:100%;object-fit:cover;background:var(--panel);
  clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)}

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

/* ---------- inside: the children, each the next level down ---------- */
/* THE TILE LIST on the left: the hive's own list (assistant/agent-tiles-rail.ts),
   one level at a time. Its stylesheet is the shared one; these lines only give it
   the page's colours and a column to stand in. */
.tree{grid-column:1;min-height:0;display:flex;flex-direction:column;border-right:1px solid var(--line);padding-right:10px;
  --hc-window-ink-quiet:var(--faint-text);--hc-window-ink-loud:var(--ink);--hc-window-ink-plain:var(--dim);--hc-panel-ink:var(--dim);
  --hc-mono:var(--mono);--hc-radius-control:var(--r-ctl);--hc-radius-card:var(--r-card);
  --hc-window-accent:var(--honey);--hc-window-accent-quiet:var(--honey-deep);--hc-window-wash:var(--honey-tint);--hc-window-tint:var(--honey-tint);
  --hc-window-edge:var(--line);--hc-window-edge-firm:var(--line-strong);--hc-deepen:rgba(0,0,0,.18);--hc-status-alert:var(--danger)}
.tree [data-rail]{display:flex;flex-direction:column;min-height:0;flex:1}
.tree .hc-rail-list{flex:1;min-height:0;overflow-y:auto;scrollbar-width:thin}
.tree .mat-sym svg{width:1em;height:1em;display:block}
.tree a.hc-rail-main{text-decoration:none;color:inherit}
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:var(--track-data);transition:color .15s,background .15s}
.tree a:hover{color:var(--honey);background:var(--honey-tint)}
.tree [aria-current]{color:var(--ink);background:var(--honey-tint);box-shadow:inset 2px 0 0 var(--honey)}
.tree .soon{color:var(--faint-text);font-style:italic}
/* THE SIBLING MENU, balanced and centred above the video (jwize 2026-11-08:
   "no step in any more just the balanced centered sibling menu"): the tiles
   under the same parent, this one lit; the parent's name stands in brackets. */
.row{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:center;gap:6px 8px;padding:10px 0 12px;margin-bottom:10px;border-bottom:1px solid var(--line)}
.sibs{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 8px;min-width:0}
/* EXPLORE MORE is the one button to the right of the row (jwize 2026-11-10:
   "put the explore more as the button to the right of the playlist for the
   current layer this way it is simple"): the way down, into the first child. */
.row a.more{display:inline-flex;align-items:center;gap:.5em;margin-left:10px;text-decoration:none;color:var(--honey);white-space:nowrap;
  border:1px solid var(--honey-deep);border-radius:var(--r-card);padding:6px 14px;font:500 13px/1.3 var(--mono);letter-spacing:var(--track-data);transition:border-color .15s,background .15s}
.row a.more svg{width:13px;height:13px;flex:none;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;transition:transform .15s}
.row a.more:hover,.row a.more:focus-visible{border-color:var(--honey);background:var(--honey-tint)}
.row a.more:hover svg,.row a.more:focus-visible svg{transform:translateX(3px)}
.sibs .lbl{flex-basis:100%;text-align:center;color:var(--faint-text)}
.sibs a.sib,.sibs span.sib{display:inline-flex;align-items:center;gap:.5em;text-decoration:none;color:var(--ink);
  border:1px solid var(--line);border-radius:var(--r-card);padding:6px 14px;font:500 13px/1.3 var(--mono);letter-spacing:var(--track-data);transition:border-color .15s,background .15s,color .15s}
.sibs .sib .g{color:var(--honey);font-size:12px}
.sibs a.sib:hover{border-color:var(--honey-deep);background:var(--honey-tint);color:var(--honey)}
.sibs [aria-current]{border-color:var(--honey-deep);background:var(--honey-tint);color:var(--honey)}
.sibs span.soon{color:var(--faint-text);border-style:dashed}
/* the video alone, fullscreen */
.scene:fullscreen{background:var(--bg);padding:3vh 4vw;overflow:auto}

/* THE TREE IS A DRAWER behind the menu button, at every width. */
.tree{display:none}
.page.menu-open .tree{display:flex;position:absolute;z-index:6;top:0;bottom:0;left:0;width:min(290px,84%);padding:48px 14px 16px 14px;
  background:var(--panel);border-right:1px solid var(--line-strong);box-shadow:var(--shadow)}
.page.menu-open .top .menu-btn{position:relative;z-index:7}
@media (max-width:760px){
  .page{padding:12px 12px 0}
}

@container (max-width:700px){
  .fz.duo{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1.3fr) minmax(0,1fr)}
  .lay{grid-template-columns:1fr;row-gap:2px;font-size:12px}
  .lay>span:last-child{text-align:left}
  .figcap .sig{display:none}
  .hexb{width:clamp(76px,24cqi,104px)}
  .hexb .t{font-size:11px}
  .count{display:none}
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
  // The hive's tile list, drawn without the hive: the same rows and head as
  // assistant/agent-tiles-rail.ts, in its own stylesheet, from the page's tree.
  // It opens where you stand, lists what is inside, and climbs with back.
  const GLYPHS = {
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>',
    forward: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>',
    hive: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M7.5 3.5h9l4.5 8.5-4.5 8.5h-9L3 12z"/></svg>',
  }
  const drawTileList = (host, data) => {
    const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n }
    const glyph = (name) => { const g = el('span', 'mat-sym'); g.setAttribute('aria-hidden', 'true'); g.innerHTML = GLYPHS[name]; return g }
    const here = (data.here || []).map(String)
    const kidsAt = (path) => {
      let level = data.menu || []
      for (const seg of path) { const n = level.find(x => x.name === seg); if (!n) return []; level = n.children || [] }
      return level
    }
    const trail = [[]]
    for (let i = 1; i <= here.length; i++) trail.push(here.slice(0, i))
    let query = ''
    host.textContent = ''
    const head = el('div', 'hc-rail-head')
    const back = el('button', 'hc-rail-back'); back.type = 'button'
    const title = el('span', 'hc-rail-title')
    const find = el('div', 'hc-rail-find')
    const input = document.createElement('input')
    input.type = 'search'; input.autocomplete = 'off'; input.spellcheck = false
    input.placeholder = 'Search this level'; input.setAttribute('aria-label', 'Search this level')
    find.appendChild(input)
    const toggle = el('button', 'hc-rail-find-toggle'); toggle.type = 'button'
    toggle.title = 'Search this level'; toggle.setAttribute('aria-label', 'Search this level'); toggle.appendChild(glyph('search'))
    head.append(back, title, find, toggle)
    const list = el('div', 'hc-rail-list'); list.setAttribute('role', 'list')
    host.append(head, list)
    const setFinding = (on) => {
      const open = on || !!query
      head.classList.toggle('finding', open); toggle.setAttribute('aria-pressed', String(open))
      if (on) input.focus()
    }
    const clear = () => { query = ''; input.value = '' }
    const paint = () => {
      const path = trail[trail.length - 1]
      const atRoot = trail.length <= 1
      title.textContent = path[path.length - 1] || 'hive'
      title.title = '/' + path.join(' / ')
      back.disabled = atRoot; back.classList.toggle('root', atRoot)
      back.replaceChildren(glyph(atRoot ? 'hive' : 'back'))
      const parent = trail[trail.length - 2]
      const label = atRoot ? '' : 'Back to ' + ((parent && parent[parent.length - 1]) || 'hive')
      back.title = label
      if (label) back.setAttribute('aria-label', label); else back.removeAttribute('aria-label')
      list.textContent = ''
      const rows = kidsAt(path).filter(n => !query || n.name.toLowerCase().includes(query))
      if (!rows.length) {
        const empty = el('div', 'hc-rail-empty')
        empty.textContent = query ? 'No tile here by that name.' : 'Nothing inside this tile yet.'
        list.appendChild(empty); return
      }
      const group = el('div', 'hc-rail-group')
      for (const n of rows) {
        const at = path.concat([n.name])
        const isHere = at.join('/') === here.join('/')
        const wrap = el('div', 'hc-rail-row'); wrap.setAttribute('role', 'listitem')
        wrap.classList.toggle('current', isHere)
        const main = el(n.href ? 'a' : 'span', 'hc-rail-main')
        if (n.href) { main.href = n.href; main.title = 'Open ' + n.name }
        else { main.title = n.name + ' (its page is coming)'; main.setAttribute('aria-disabled', 'true'); main.style.opacity = '.55' }
        if (isHere) main.setAttribute('aria-current', 'true')
        const icon = el('span', 'hc-rail-icon'); icon.textContent = (n.name.trim().charAt(0) || '·').toUpperCase()
        const name = el('span', 'hc-rail-name'); name.textContent = n.name
        main.append(icon, name); wrap.appendChild(main)
        if (n.children && n.children.length) {
          const walk = el('button', 'hc-rail-walk'); walk.type = 'button'
          walk.appendChild(glyph('forward'))
          walk.title = 'Go inside ' + n.name; walk.setAttribute('aria-label', 'Go inside ' + n.name)
          walk.onclick = (e) => { e.stopPropagation(); e.preventDefault(); trail.push(at); clear(); paint() }
          wrap.appendChild(walk)
        }
        group.appendChild(wrap)
      }
      list.appendChild(group)
    }
    back.onclick = () => { if (trail.length > 1) { trail.pop(); clear(); paint() } }
    toggle.onclick = () => setFinding(!head.classList.contains('finding') || !!query)
    input.oninput = () => { query = input.value.trim().toLowerCase(); paint() }
    input.onkeydown = (e) => {
      if (e.key !== 'Escape') return
      e.preventDefault(); e.stopPropagation()
      if (query || input.value) { clear(); paint() } else setFinding(false)
    }
    input.onblur = () => { if (!input.value.trim()) setFinding(false) }
    paint()
  }
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
  // FULL SCREEN: the video alone. It leaves with Escape, and the button says so.
  const fs = page.querySelector('.fs')
  if (fs) {
    if (!document.fullscreenEnabled || !el.requestFullscreen) fs.hidden = true
    else {
      const mark = () => { if (gone()) { document.removeEventListener('fullscreenchange', mark); return } fs.setAttribute('aria-pressed', String(document.fullscreenElement === el)) }
      document.addEventListener('fullscreenchange', mark)
      fs.onclick = () => { if (document.fullscreenElement === el) document.exitFullscreen(); else el.requestFullscreen().catch(() => {}) }
    }
  }
  // THE TREE is a drawer: the menu button opens it; choosing a video, or a press beside it, closes it.
  const menuBtn = page.querySelector('.menu-btn'), treeNav = page.querySelector('.tree')
  if (menuBtn && treeNav) {
    const drawer = (open) => { page.classList.toggle('menu-open', open); menuBtn.setAttribute('aria-expanded', String(open)) }
    menuBtn.onclick = () => drawer(!page.classList.contains('menu-open'))
    treeNav.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('a')) drawer(false) })
    page.addEventListener('click', (e) => { if (page.classList.contains('menu-open') && !(e.target.closest && e.target.closest('.tree,.menu-btn'))) drawer(false) })
  } else if (menuBtn) menuBtn.hidden = true
  // THE TILE LIST. Inside the hive (and on the published site) the hive's own list is
  // mounted here, the one the AI chat shows, and a press on a tile opens that tile's page.
  // A page opened on its own has no hive, so it draws the same list from its own tree:
  // the same markup, the same stylesheet, one level at a time.
  const railHost = page.querySelector('[data-rail]')
  if (railHost) {
    let railData = null
    try { railData = JSON.parse(page.querySelector('script[data-rail-tree]').textContent) } catch (e) {}
    const goTo = (segs) => {
      const a = document.createElement('a')
      a.href = '/' + segs.map(encodeURIComponent).join('/')
      a.hidden = true
      railHost.appendChild(a); a.click(); a.remove()
    }
    let hiveRail = null
    const hiveIoc = window.ioc
    if (hiveIoc && typeof hiveIoc.whenReady === 'function') {
      hiveIoc.whenReady('@diamondcoreprocessor.com/AgentTilesRailFactory', (factory) => {
        if (hiveRail || gone() || !factory || typeof factory.create !== 'function') return
        try {
          const rail = factory.create({ walk: true, chats: false, choose: false, badge: () => 0 })
          rail.onSubjectChanged = (pick) => { if (pick) goTo(pick.path.concat([pick.name])) }
          rail.mount(railHost)
          hiveRail = rail
          const watch = setInterval(() => { if (gone()) { clearInterval(watch); try { rail.dispose() } catch (e) {} } }, 2000)
        } catch (e) {}
      })
    }
    if (!hiveRail && railData) drawTileList(railHost, railData)
  }
  const toSite = page.querySelector('.to-site')
  if (toSite) toSite.onclick = () => page.dispatchEvent(new CustomEvent('hc-site-widen', { bubbles: true }))
  const KEY = 'hc-scene:' + location.pathname
  const returning = root instanceof Element && root.hasAttribute('data-hc-returning')
  let resumeAt = 0
  if (returning) { try { const n = Number(sessionStorage.getItem(KEY)); if (Number.isInteger(n) && n >= 0) resumeAt = n } catch {} }
  const readTime = (say) => Math.max(3.4, say.split(/\\s+/).length / 2.6) * 1000 + 600
  // A VOICE IS ASKED FOR BEFORE IT IS NEEDED, AND STARTS ON ITS HEAD (jwize
  // 2026-11-05: "stream the audio so it doesn't have to full load"). Every
  // byte this page plays is verified against its signature first, so one file
  // cannot stream: it would be held until its last byte. A voice comes in
  // parts instead (blocks/media.cjs): a two-second head, then about eight
  // seconds at a time, each verified on its own, fed in order into one stream.
  // A page that may not play a stream it builds (no media-src blob:, or no
  // MediaSource for MP3) plays the whole voice, as before. Either way the
  // scene's first voice is asked for once the page is on screen and quiet, and
  // the next voice while this one plays, so pressing Listen starts at once.
  const keyOf = (s) => s && s.voice ? s.voice : ''
  const MS = window.MediaSource
  let streams = false
  if (MS && MS.isTypeSupported && MS.isTypeSupported('audio/mpeg') && steps.some(s => s.parts)) {
    try {
      const probe = new Audio(), ms = new MS(), url = URL.createObjectURL(ms)
      ms.addEventListener('sourceopen', () => { streams = true; URL.revokeObjectURL(url); probe.removeAttribute('src') }, { once: true })
      probe.addEventListener('error', () => URL.revokeObjectURL(url), { once: true })
      probe.src = url
    } catch {}
  }
  const part = (u) => fetch(u).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer() })
  const streamOf = (a, parts) => {
    const ms = new MS(), url = URL.createObjectURL(ms)
    let over = false
    a.addEventListener('emptied', () => { over = true }, { once: true })
    ms.addEventListener('sourceopen', async () => {
      URL.revokeObjectURL(url)
      try {
        const sb = ms.addSourceBuffer('audio/mpeg')
        sb.mode = 'sequence'
        // the head alone first, so it is not slowed by the parts behind it
        const head = part(parts[0])
        await head
        const rest = parts.slice(1).map(part)
        for (const bytes of [head, ...rest]) {
          const b = await bytes
          if (over || ms.readyState !== 'open') return
          await new Promise((done, fail) => { sb.addEventListener('updateend', done, { once: true }); sb.addEventListener('error', fail, { once: true }); sb.appendBuffer(b) })
        }
        if (!over && ms.readyState === 'open') ms.endOfStream()
      } catch { if (!over && ms.readyState === 'open') { try { ms.endOfStream('network') } catch {} } }
    }, { once: true })
    a.src = url
  }
  const make = (s) => {
    const a = new Audio()
    a.preload = 'auto'
    a.dataset.src = keyOf(s)
    if (streams && s.parts) streamOf(a, s.parts); else a.src = s.voice
    return a
  }
  const drop = (a) => { a.onended = a.onerror = null; a.pause(); a.removeAttribute('src'); try { a.load() } catch {} }
  const warm = new Map()
  const saving = !!(navigator.connection && navigator.connection.saveData)
  const ready = (s) => {
    const k = keyOf(s)
    if (!k || !voiceOn || gone() || (audio && audio.dataset.src === k) || warm.has(k)) return
    while (warm.size >= 2) { const [old, a] = warm.entries().next().value; warm.delete(old); drop(a) }
    warm.set(k, make(s))
  }
  const take = (s) => { const k = keyOf(s), a = warm.get(k); if (a) { warm.delete(k); return a } return make(s) }
  const after = (i) => { const k = keyOf(steps[i]); for (let j = i + 1; j < steps.length; j++) if (steps[j].voice && keyOf(steps[j]) !== k) return steps[j]; return null }
  const idle = () => { if (still || playing || gone()) return; for (const v of videos) { v.loop = true; v.play().catch(() => {}) } }
  let watch = 0
  const stopWatch = () => { cancelAnimationFrame(watch); watch = 0 }
  // A paused voice is kept, so playing on picks it up where it is.
  const quiet = () => {
    clearTimeout(timer); timer = null; stopWatch()
    if (!audio) return
    const a = audio; audio = null
    a.onended = a.onerror = null; a.pause()
    if (gone()) drop(a); else warm.set(a.dataset.src, a)
  }
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
  const halt = () => {
    playing = false; quiet(); for (const v of videos) v.pause()
    if (gone()) { for (const a of warm.values()) drop(a); warm.clear() }
  }
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
    if (!(voiceOn && s.voice)) { if (audio) { drop(audio); audio = null } hold(); return }
    let a = audio
    if (!a || a.dataset.src !== keyOf(s)) {
      if (a) drop(a)
      a = take(s); audio = a
    }
    const coming = after(at)
    if (coming) ready(coming)
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
  // The first voice, once the scene is on screen and the page is quiet.
  if (voiced && !saving && 'IntersectionObserver' in window) {
    const seen = new IntersectionObserver((es) => {
      if (!es.some(e => e.isIntersecting)) return
      seen.disconnect()
      const idleThen = window.requestIdleCallback || ((f) => setTimeout(f, 300))
      idleThen(() => { if (gone() || started) return; const s = steps[at].voice ? steps[at] : after(at); if (s) ready(s) }, { timeout: 1500 })
    })
    seen.observe(el)
  }
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
  const steps = sc.steps.map(s => ({ say: s.say, voice: s.voice || null, ...(s.parts ? { parts: s.parts } : {}), from: s.from ?? null, to: s.to ?? null, lit: s.lit ?? null, beside: !!s.beside }))
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

/** THE TILE LIST, on the left (jwize 2026-11-10: "the ai chat list ... it is a
 *  flat drilldown tree"). The same list the AI chat shows: one level at a time,
 *  an arrow to go inside a tile, back to climb. Inside the hive and on the
 *  published site the page mounts the hive's own list; a page opened on its own
 *  draws the same list, in the same markup and stylesheet, from the tree below. */
const treeHtml = (ways, route) => {
  const menu = ways && ways.menu
  if (!menu || !menu.length) return ''
  const node = (n) => ({ name: n.name, href: n.page ? '/' + n.route.join('/') : null, children: n.children.map(node) })
  const data = { here: route, menu: menu.map(node) }
  return `
  <nav class="tree" data-part="tree" aria-label="The tiles"><div data-rail></div><script type="application/json" data-rail-tree>${JSON.stringify(data).replace(/</g, '\\u003c')}</script></nav>`
}

/** EXPLORE MORE, the one button to the right of the sibling row: the way in, to
 *  the first child's presentation. Nothing when no page lies below. */
const exploreHtml = (ways) => {
  const e = ways && ways.explore
  if (!e) return ''
  const about = `Explore more about ${e.topic}`
  return `<a class="more" data-part="explore" href="/${e.to.map(esc).join('/')}" title="${esc(about)}" aria-label="${esc(about)}">Explore more<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg></a>`
}

/** THE ROW above the video: the siblings, then Explore more at their right. */
const rowHtml = (ways, route) => {
  const inner = sibsHtml(ways, route) + exploreHtml(ways)
  return inner ? `
  <div class="row" data-part="row">${inner}</div>` : ''
}

/** THE SIBLING MENU, balanced and centred above the video: the tiles under the
 *  same parent, this one lit. The parent's name stands over them in brackets.
 *  Nothing when a tile is the only one there. */
const sibsHtml = (ways, route) => {
  const section = (ways && ways.section) || []
  if (section.length < 2) return ''
  const parent = String((ways && ways.sectionOf) || '')
  return `
  <nav class="sibs" data-part="siblings" aria-label="${esc(parent ? `More in ${parent}` : 'Beside this')}">${parent ? `<span class="lbl mono-label">(${esc(parent)})</span>` : ''}${section.map(t => t.current
    ? `<span class="sib" aria-current="page">${icon('play')}${esc(t.name)}</span>`
    : t.page
      ? `<a class="sib" href="/${t.route.map(esc).join('/')}" title="${esc(t.note)}">${icon('play')}${esc(t.name)}</a>`
      : `<span class="sib soon" title="${esc(`${t.note} (its page is coming)`)}">${esc(t.name)}</span>`).join('')}
  </nav>`
}

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
${RAIL_CSS}
</style>
</head>
<body>
${sprite}
<main class="page">${treeHtml(ways, route)}<div class="stage"><div class="top"><button type="button" class="ib2 menu-btn" aria-label="Show the tree" aria-expanded="false"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/></svg></button>${crumbsHtml(route)}<button type="button" class="ib2 fs" aria-label="Full screen" aria-pressed="false"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/></svg></button><button type="button" class="to-site" aria-label="Open the website at this page">${icon('hex')}website</button></div>${rowHtml(ways, route)}${sceneHtml(scene)}</div>
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
