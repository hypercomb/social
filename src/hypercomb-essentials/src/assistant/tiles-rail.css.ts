// assistant/tiles-rail.css.ts
//
// THE TILE LIST'S ONE STYLESHEET. The hive has one list of tiles (agent-tiles-rail.ts),
// and every place that shows it reads the same sheet from here: the chat window, the
// agent panel, the notes desk, the left sidebar, and a presentation page opened on its
// own, which the page build inlines from this very module. One sheet, so the list
// cannot look different anywhere. Pure text: no DOM, no imports, and no
// TypeScript-only syntax — the page build evaluates this file as plain JavaScript.

export const RAIL_STYLE_ID = 'hc-tiles-rail-styles'
export const STEEL = '126, 182, 214'
/** Amber says THE HIVE: work in flight, or something waiting for you. It is
 *  never used for your own unsent words — those wear the name's white. */
export const AMBER = '226, 196, 140'
/** A conversation's standing, in the colours the chat window uses for it. */
const CONVO_WAIT = '201, 139, 224'
const CONVO_OPEN = '232, 176, 74'
const CONVO_DONE = '112, 213, 154'

/** The rail's own stylesheet — installed on first mount so the rail reads
 *  identically inside the agent panel and the chat window. Host geometry
 *  (where the rail sits, how wide) stays with whichever surface mounts it. */
export const RAIL_CSS = `
/* BORDER-BOX, EVERYWHERE IN HERE. This sheet is installed into whatever
   surface mounts the rail, so it cannot inherit a host's reset — and half
   these rows are \`width:100%\` WITH horizontal padding, which under the
   default content-box is a box wider than the column that holds it. That is
   what put the lit background of the open conversation out past the fold's
   right edge. One line, and the whole class of it cannot come back. */
.hc-rail-list,.hc-rail-list *,.hc-rail-list *::before,.hc-rail-list *::after{
  box-sizing:border-box;}
/* ONE BAND, the window header's height, so the rail and the window share
   one divider line: [home or back] [where you are] [search]. Searching puts
   the field in the title's place. */
.hc-rail-head{display:flex;align-items:center;gap:0.25rem;flex:0 0 auto;
  box-sizing:border-box;height:2.875rem;padding:0 0.5rem;
  border-bottom:1px solid var(--hc-window-edge, rgba(${STEEL},0.28));}
.hc-rail-back,.hc-rail-find-toggle,.hc-rail-convos-toggle{display:inline-grid;place-items:center;flex:0 0 auto;
  width:1.75rem;height:1.75rem;padding:0;border:0;background:none;cursor:pointer;
  color:var(--hc-window-ink-quiet);border-radius:var(--hc-radius-control, 2px);
  transition:color 0.12s ease,background-color 0.12s ease;}
.hc-rail-back:hover:not(:disabled),.hc-rail-find-toggle:hover,.hc-rail-convos-toggle:hover{
  color:var(--hc-window-ink-loud);background:var(--hc-window-tint, rgba(${STEEL},0.06));}
.hc-rail-find-toggle[aria-pressed='true'],.hc-rail-convos-toggle[aria-pressed='true']{color:var(--hc-window-accent, rgb(${STEEL}));
  background:var(--hc-window-wash, rgba(${STEEL},0.1));}
.hc-rail-back.root{cursor:default;color:rgb(${AMBER});}
/* THE CONVERSATIONS ARE A TAB behind this icon, never stacked over the tiles.
   It wears the count of conversations waiting on you, in their own colour. */
.hc-rail-convos-toggle{position:relative;}
.hc-rail-convos-toggle.waiting{color:color-mix(in srgb, rgba(${CONVO_WAIT},0.95), rgb(var(--hc-panel-ink, 43, 30, 6)) var(--hc-deepen, 0%));}
.hc-rail-convos-badge{position:absolute;top:0.05rem;right:0;min-width:0.85rem;height:0.85rem;
  padding:0 0.2rem;border-radius:999px;display:grid;place-items:center;
  font-family:var(--hc-mono,monospace);font-size:0.55rem;font-weight:700;line-height:1;
  color:rgb(var(--hc-panel-ink, 20, 14, 24));background:rgba(${CONVO_WAIT},0.95);pointer-events:none;}
.hc-rail-convos-badge[hidden]{display:none;}
.hc-rail-back[hidden]{display:none;}
.hc-rail-head .mat-sym,.hc-rail-list .mat-sym{font-size:1.0625rem;line-height:1;}
.hc-rail-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-family:var(--hc-mono,monospace);font-size:0.72rem;font-weight:600;letter-spacing:0.12em;
  text-transform:uppercase;color:var(--hc-window-accent, rgb(${STEEL}));}
.hc-rail-title.hive{color:color-mix(in srgb, rgba(${AMBER},0.92), rgb(var(--hc-panel-ink, 43, 30, 6)) var(--hc-deepen, 0%));}
.hc-rail-find{display:none;flex:1 1 auto;min-width:0;}
.hc-rail-head.finding .hc-rail-title{display:none;}
.hc-rail-head.finding .hc-rail-find{display:block;}
.hc-rail-find input{width:100%;box-sizing:border-box;padding:0.25rem 0.125rem;border:0;border-radius:0;
  border-bottom:1px solid var(--hc-window-edge-firm, rgba(${STEEL},0.4));background:none;
  color:var(--hc-window-ink-loud);font:inherit;font-size:0.8rem;}
.hc-rail-find input::placeholder{color:var(--hc-window-ink-quiet);}
.hc-rail-find input:focus{outline:none;border-bottom-color:var(--hc-window-accent, rgb(${STEEL}));}
.hc-rail-find input::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none;}
/* UP AND DOWN ONLY. A sideways scrollbar under a list of names is never
   the answer to anything — the names ellipsise and the rows fit, so a bar
   there means something is overflowing and the participant is being asked
   to go and find it. An overflow-y of auto alone could not say this: naming
   ONE axis makes the other compute to auto as well, so the bar arrived
   the moment anything (a fold row a hair too wide, the 0.6rem slide a
   level change rides in on) reached past the edge. Both axes are named.
   The cause is still fixed at the cause — this is the floor under it. */
.hc-rail-list{flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto;
  display:flex;flex-direction:column;
  gap:2px;padding:0.15rem 0.5rem 0.7rem;scrollbar-width:thin;
  scrollbar-color:var(--hc-window-accent-quiet, rgb(${STEEL})) transparent;}
@keyframes hcRailIn{from{opacity:0;transform:translateX(0.6rem);}to{opacity:1;transform:none;}}
@keyframes hcRailOut{from{opacity:0;transform:translateX(-0.6rem);}to{opacity:1;transform:none;}}
/* THE HIVE'S BLOCK. It is not a tile and must never be mistaken for one, so
   nothing about it is a tile's: a GOLD COMB CELL where a picture would be,
   the name in the hive's own uppercase letterforms, and a rule under it that
   says everything below is this page while this is the whole thing. */
.hc-rail-hive{margin-bottom:0.35rem;padding-bottom:0.3rem;
  border-bottom:1px solid rgba(${STEEL},0.18);}
.hc-rail-hive .hc-rail-name{font-family:var(--hc-mono,monospace);font-size:0.78rem;
  font-weight:600;letter-spacing:0.14em;text-transform:uppercase;
  color:color-mix(in srgb, rgba(${AMBER},0.92), rgb(var(--hc-panel-ink, 43, 30, 6)) var(--hc-deepen, 0%));}
.hc-rail-hive .hc-rail-main{padding-top:0.5rem;padding-bottom:0.5rem;}
.hc-rail-hive .hc-rail-row:hover{background:rgba(${AMBER},0.08);}
/* The hive carries NO current rule of its own. It used to — an amber ring at
   0.42 — and it never once drew: .hc-rail-hive.current and
   .hc-rail-group.current are both (0,2,0), and the group rule is written
   later, so it won every time. The gold ring below is now the whole of what
   "you are here" says, hive and tile alike, which is the sentence that rule
   was reaching for anyway. */
.hc-rail-hive .hc-rail-chat.current{background:rgba(${AMBER},0.14);
  box-shadow:inset 2px 0 0 rgba(${AMBER},0.9);}
.hc-rail-hive .hc-rail-chat-new{color:color-mix(in srgb, rgba(${AMBER},0.85), rgb(var(--hc-panel-ink, 43, 30, 6)) var(--hc-deepen, 0%));}
/* Its gutter tick is the hive's colour too — the same sentence, said in the
   one place the eye is already reading state. */
.hc-rail-hive .hc-rail-row.spoken::before{background:rgba(${AMBER},0.7);}

/* A TILE'S BLOCK — its row, and under it whatever the row has unfolded. The
   lit edge goes here so an open tile is one object, never a box with a list
   loose beneath it. */
.hc-rail-group{display:flex;flex-direction:column;
  border-radius:var(--hc-radius-control, 2px);}
/* WHERE YOU ARE, IN GOLD. Steel at 0.4 was quieter than the plain white
   hover sitting on top of it, so the list answered "which one is under your
   mouse" and never "which one am I in" — you had to sweep the rows to find
   out where you already were. Gold, at full strength, because gold in this
   window is the hive's own colour and this is the one row that IS where you
   are. It is an INSET ring: it lands inside the block's own 1px, so nothing
   moves when it arrives (see the blurb note further down — choosing is not a
   layout event). Hover stays white and stays weaker; the two never argue. */
.hc-rail-group.current{background:rgba(${AMBER},0.08);
  box-shadow:inset 0 0 0 1px rgba(${AMBER},0.9);}
/* And the name comes up with it. A tile you have never spoken to draws its
   name quiet, so without this the row you are IN could sit inside a gold ring
   wearing dormant ink. Colour only — no weight, no stroke, no metrics.
   Kept OFF the hive, whose name is gold uppercase and must stay its own
   thing; a bare .hc-rail-row.current .hc-rail-name would outrank it. */
.hc-rail-group:not(.hc-rail-hive) .hc-rail-row.current .hc-rail-name{
  color:var(--hc-window-ink-loud);}
.hc-rail-row{display:flex;align-items:center;border-radius:var(--hc-radius-control, 2px);}
.hc-rail-row:hover{background:rgba(255,255,255,0.05);}
.hc-rail-main{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:0.6rem;
  padding:0.35rem 0.2rem 0.35rem 0.45rem;border:0;background:none;text-align:left;font:inherit;
  cursor:pointer;border-radius:var(--hc-radius-control, 2px);color:inherit;}
.hc-rail-main:focus-visible{outline:1px solid rgba(${STEEL},0.6);outline-offset:-1px;}
.hc-rail-icon{width:2.15rem;height:2.15rem;flex:0 0 auto;border-radius:var(--hc-radius-card, 3px);overflow:hidden;
  display:grid;place-items:center;background:rgba(${STEEL},0.08);
  border:1px solid rgba(${STEEL},0.14);color:var(--hc-window-accent-quiet, rgb(${STEEL}));
  font-size:0.95rem;font-weight:600;}
.hc-rail-icon img{width:100%;height:100%;object-fit:cover;display:block;}
.hc-rail-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:0.86rem;color:var(--hc-window-ink-loud);}
.hc-rail-threads{flex:0 0 auto;font-family:var(--hc-mono,monospace);
  font-size:0.64rem;line-height:1;color:var(--hc-window-accent-quiet, rgb(${STEEL}));}
.hc-rail-threads[hidden]{display:none;}
.hc-rail-row.unread .hc-rail-threads{color:color-mix(in srgb, rgba(${AMBER},0.9), rgb(var(--hc-panel-ink, 43, 30, 6)) var(--hc-deepen, 0%));}
.hc-rail-bees{flex:0 0 auto;min-width:1.15rem;text-align:center;padding:0.06rem 0.3rem;
  border-radius:999px;border:1px solid rgba(226,196,140,0.5);color:var(--hc-window-ink-loud);
  font-size:0.66rem;line-height:1.2;}
.hc-rail-bees[hidden]{display:none;}
.hc-rail-walk{flex:0 0 auto;color:var(--hc-window-ink-quiet);font-size:1.05rem;line-height:1;
  padding-right:0.1rem;}
.hc-rail-walk[hidden]{display:none;}
.hc-rail-draft{flex:0 0 auto;width:0.42rem;height:0.42rem;margin-right:0.55rem;
  border-radius:999px;background:rgba(226,196,140,0.9);}
.hc-rail-draft[hidden]{display:none;}
.hc-rail-skel{height:2.5rem;border-radius:var(--hc-radius-control, 2px);background:rgba(255,255,255,0.045);
  animation:hcRailPulse 1.1s ease-in-out infinite;}
@keyframes hcRailPulse{0%,100%{opacity:0.5;}50%{opacity:1;}}
.hc-rail-empty{padding:0.9rem 0.45rem;font-size:0.78rem;color:var(--hc-window-ink-quiet);}

/* ── WHAT A ROW HAS TO SAY ─────────────────────────────────────────────
   Three places, each meaning exactly one thing, so states co-occur without
   negotiating a slot:

     LEFT GUTTER  steel, vertical    the conversation — its depth, then unread
     ICON EDGE    white, horizontal  YOUR unsent sentence
     RIGHT DIGIT  amber, a numeral   work in flight; nothing to do but wait

   A dormant tile draws NOTHING. Forty quiet rows in fifty cost no ink, which
   is what makes the marks that are there worth looking at. Every mark is
   absolutely positioned or metric-neutral, so a state arriving can never
   re-ellipsize a name — the old inline draft dot did exactly that. */

.hc-rail-row{position:relative;}
.hc-rail-main{padding-left:0.85rem;}

/* THE GUTTER. One slot, centred whatever the mark's size, so growing the
   mark never moves it. */
.hc-rail-row::before{content:'';position:absolute;left:0.4rem;top:50%;
  transform:translate(-50%,-50%);width:2px;height:0;border-radius:1px;
  background:rgba(${STEEL},0.62);pointer-events:none;}

/* HISTORY — the tick is as tall as the conversation is deep: 6px at one
   turn, 14px from a dozen on. Height is pre-attentive, so a level reads as a
   ragged margin you scan for the deep ones without reading a word. */
.hc-rail-row.spoken::before{height:calc(6px + var(--hc-rail-depth, 0) * 8px);}

/* ACTIVE — something is happening in this conversation RIGHT NOW: a question
   of yours is still out, or an agent is working on the tile. It is the one
   state in this list that is about the present tense, so it is the one mark
   that MOVES: amber (which in this list already means the hive is doing
   something), breathing on the same slow cycle as the count at the other end
   of the row, so the two read as one fact said twice.

   Drawn even when the tile has never been spoken to — .spoken sets the
   height and a brand-new conversation has none, yet a question just sent is
   exactly when you most need to see WHICH line it went to. Sits before
   .unread on purpose: an unread reply has landed and is no longer in
   progress, so at equal specificity source order lets it win. */
.hc-rail-row.live::before{min-height:7px;background:rgba(${AMBER},0.85);
  animation:hcRailBreath 2.6s ease-in-out infinite;}

/* The hive's own tick is amber at rest (it is the hive), so live has to be
   told apart from it by more than colour: full strength, and the breath. */
.hc-rail-hive .hc-rail-row.live::before{background:rgba(${AMBER},0.95);}

/* UNREAD — the tick becomes a SEALED COMB CELL: the house pointy-top
   hexagon, the only one in the list, the only amber in the gutter. Shape
   carries it and colour only agrees. Must stay after .spoken — equal
   specificity, source order decides. */
.hc-rail-row.unread::before{width:0.58rem;height:0.66rem;border-radius:0;
  background:rgba(${AMBER},0.95);
  clip-path:polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);}

/* The name is the cheapest mark of all: dormant sits back, anything spoken
   to steps forward, unread thickens with text-stroke — which has no glyph
   advance, so the ellipsis point never moves. */
.hc-rail-name{color:var(--hc-window-ink-quiet);}
.hc-rail-row.spoken .hc-rail-name,
.hc-rail-row.draft .hc-rail-name{color:var(--hc-window-ink-loud);}
.hc-rail-row.unread .hc-rail-name{color:var(--hc-window-ink-loud);
  -webkit-text-stroke:0.35px currentColor;}

/* DRAFT — your unsent thinking, laid under the thing it is about: a white
   rule inside the picture's bottom edge over a dark hairline, so it holds on
   a bright photograph. ::after, never an inset shadow — the <img> paints
   over those. */
.hc-rail-icon{position:relative;}
.hc-rail-row.draft .hc-rail-icon::after{content:'';position:absolute;
  left:0;right:0;bottom:0;height:3px;pointer-events:none;
  background:linear-gradient(rgba(8,12,18,0.85) 0 1px,rgba(238,244,250,0.85) 1px 3px);}

/* A SET ACTIVE TOGETHER. The bracket is one line down the right edge of the
   run, capped where the run starts and ends — the typographic brace, which is
   the oldest way of saying "these, together". It sits opposite the gutter so
   it can never be read as a conversation state. */
.hc-rail-row.grouped{box-shadow:inset -2px 0 0 rgba(${STEEL},0.55);}
.hc-rail-row.grouped::after{content:'';position:absolute;right:0;width:0.5rem;
  height:2px;background:rgba(${STEEL},0.55);pointer-events:none;opacity:0;}
.hc-rail-row.grouped-first::after{opacity:1;top:2px;}
.hc-rail-row.grouped-last::after{opacity:1;bottom:2px;top:auto;}
.hc-rail-row.grouped-first.grouped-last::after{opacity:1;top:50%;}

/* CHOSEN — gathered as context for the next request. A ring on the picture
   and a tick in its corner: it belongs to the tile as an OBJECT, which is
   what a signature in a payload is, and it stays clear of all three state
   places so a chosen row can still be deep, unread and drafting at once. */
.hc-rail-row.chosen .hc-rail-icon{box-shadow:0 0 0 2px rgba(${STEEL},0.95);}
.hc-rail-row.chosen .hc-rail-icon::before{content:'';position:absolute;z-index:1;
  left:2px;top:2px;width:0.62rem;height:0.62rem;border-radius:50%;
  background:rgba(${STEEL},0.95);
  clip-path:polygon(50% 0,100% 0,100% 100%,0 100%,0 0);
  box-shadow:inset 0 0 0 2px #0c1118;}
.hc-rail-row.chosen{background:rgba(${STEEL},0.07);}
/* SIBLING — the tile a refused name collided with. Outlined in the alert
   role, quietly, with the words "same name" beside it. */
.hc-rail-row.sibling{box-shadow:inset 0 0 0 1px var(--hc-status-alert, #e0707a);}
.hc-rail-same{flex:0 0 auto;font-size:0.72rem;color:var(--hc-status-alert, #e0707a);}

/* LIVE — the count, no ring. A digit is information a colour cannot be, and
   it is its own reduced-motion fallback: the breath is affect, the numeral
   is the fact. The slot is held open always, so a bee arriving never
   reflows the name. */
.hc-rail-bees{flex:0 0 auto;width:1.05rem;min-width:0;overflow:hidden;
  padding:0;border:0;border-radius:0;background:none;text-align:center;
  font-family:var(--hc-mono,monospace);font-size:0.68rem;font-weight:600;
  line-height:1;font-variant-numeric:tabular-nums;color:color-mix(in srgb, rgba(${AMBER},0.95), rgb(var(--hc-panel-ink, 43, 30, 6)) var(--hc-deepen, 0%));}
.hc-rail-bees[hidden]{display:block;visibility:hidden;}
@keyframes hcRailBreath{0%,100%{opacity:0.5;}50%{opacity:1;}}
.hc-rail-bees:not([hidden]){animation:hcRailBreath 2.6s ease-in-out infinite;}

/* THE WAY INSIDE A TILE. The row talks, so the control at its right edge
   walks. It fills the row top-to-bottom and derives width from height: a
   stable square Go target, never the old narrow floating glyph. */
.hc-rail-walk{flex:0 0 auto;align-self:stretch;aspect-ratio:1;
  width:auto;height:auto;box-sizing:border-box;padding:0;margin:0;
  display:grid;place-items:center;overflow:hidden;
  border:0;background:none;cursor:pointer;
  font-family:'Material Symbols Outlined','Material Symbols Rounded';
  font-weight:400;font-style:normal;letter-spacing:normal;text-transform:none;
  white-space:nowrap;direction:ltr;-webkit-font-feature-settings:'liga';
  font-feature-settings:'liga';-webkit-font-smoothing:antialiased;
  color:var(--hc-window-ink-quiet);font-size:1.05rem;line-height:1;
  border-radius:var(--hc-radius-control, 2px);
  transition:color 0.14s ease,background 0.14s ease;}
.hc-rail-walk:hover{color:var(--hc-window-ink-loud);background:rgba(255,255,255,0.06);}
.hc-rail-walk:focus-visible{outline:1px solid rgba(${STEEL},0.6);outline-offset:-1px;}

/* THE TILE'S CONVERSATIONS, unfolded under its row. A SHORT step in, no rule
   down the side: the fold already says what they belong to, and a line plus a
   picture's worth of indent turned a list of two chats into a diagram. */
.hc-rail-chats{display:flex;flex-direction:column;gap:1px;
  margin:1px 0 4px 0.9rem;padding-left:0;
  /* CAPPED. The fold is one-open-at-a-time, but a tile with many threads
     (and its archive opened) could still push every row under it off the
     screen. The window is full-screen, so 40vh is 40% of the tool window:
     the fold grows to that and then scrolls within it, and the tile rows
     below stay reachable (documentation/chat-route.md §5). */
  max-height:40vh;overflow-y:auto;}
/* ONE LINE, AND NO WRAP TO GIVE. The row used to carry flex-wrap because the
   points list under an open conversation asked for a whole line
   (\`flex:1 0 100%\`) and would otherwise take that basis on the SAME line,
   squeezing the name to one word per line. The points list is gone — a row
   that grows when you press it is a row that moves the list under your hand —
   so the row has exactly one child again and nothing left to wrap. Put the
   wrap back the day something asks for a second line, and not before. */
.hc-rail-chat{display:flex;align-items:baseline;gap:0.5rem;
  width:100%;
  padding:0.28rem 0.45rem;border:0;background:none;cursor:pointer;
  text-align:left;font:inherit;font-size:0.8rem;
  color:var(--hc-window-ink-plain);border-radius:var(--hc-radius-control, 2px);}
.hc-rail-chat:hover{background:rgba(255,255,255,0.05);color:var(--hc-window-ink-loud);}
.hc-rail-chat:focus-visible{outline:1px solid rgba(${STEEL},0.6);outline-offset:-1px;}
.hc-rail-chat.current{background:rgba(${STEEL},0.12);color:var(--hc-window-ink-loud);
  box-shadow:inset 2px 0 0 rgba(${STEEL},0.9);}
.hc-rail-chat.unread{color:var(--hc-window-ink-loud);}
.hc-rail-chat.unread .hc-rail-chat-name::after{content:'';display:inline-block;
  width:0.42rem;height:0.48rem;margin-left:0.35rem;vertical-align:baseline;
  background:rgba(${AMBER},0.95);
  clip-path:polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);}
.hc-rail-chat-name{flex:1 1 auto;min-width:0;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;}
.hc-rail-chat-meta{flex:0 0 auto;font-family:var(--hc-mono,monospace);
  font-size:0.68rem;color:var(--hc-window-ink-quiet);}
.hc-rail-chat-new{color:var(--hc-window-accent, rgb(${STEEL}));}

/* A CHAT ROW IS TWO CONTROLS, not one: the name opens it, the mark at the end
   puts it away. So the row is the box and the name is a button inside it —
   otherwise archiving would be a button inside a button, which is not a thing
   the DOM allows and not a thing a screen reader can read out. The "+ New"
   row and the archive disclosure are still plain buttons wearing the same
   row styling, which is why the padding lives on the ROW and never on the
   body. */
/* THE ROW IS A COLUMN NOW, because a thread is named by TWO things: the first
   thing you said (the title, which is what you did not know yet) and what it
   turned out to be about (the blurb). The head keeps the old baseline row —
   name on the left, turn count on the right — and the blurb hangs under it.
   A row with no blurb draws exactly what it drew before. */
.hc-rail-chat-body{flex:1 1 auto;display:flex;flex-direction:column;
  align-items:stretch;gap:0.1rem;
  min-width:0;padding:0;border:0;background:none;cursor:pointer;
  text-align:left;font:inherit;color:inherit;}
.hc-rail-chat-head{display:flex;align-items:baseline;gap:0.5rem;min-width:0;}
/* ONE LINE, IN EVERY STATE. Selecting a row must not resize it: the blurb
   used to unwrap to white-space:normal on the open conversation, and the
   SAME sentence re-flowed to two lines made the chosen row 14px taller and
   shunted every row under it down by that much — you pressed a name and the
   list moved under your hand. Choosing is not a layout event. The row keeps
   its one ellipsised line and the ink lifts; nothing else about the box may
   change with .current. The full text still has a home — the title attribute
   on the line, and the conversation you just opened in the pane. */
.hc-rail-chat-blurb{font-size:0.72rem;line-height:1.25;
  color:var(--hc-window-ink-quiet);overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;}
.hc-rail-chat.current .hc-rail-chat-blurb{color:var(--hc-window-ink-plain);}
.hc-rail-chat-body:focus-visible{outline:1px solid rgba(${STEEL},0.6);outline-offset:1px;}
/* PUT AWAY, and it reads that way: dimmer than a live thread, so the section
   under the disclosure is visibly a different shelf. */
.hc-rail-chat.filed{color:var(--hc-window-ink-quiet);}
/* THE QUESTION IS STILL OUT. The row is a real row — enterable, current-able,
   the same box as every other — it simply has nothing to be called yet. Said
   in the ink rather than in a second shape: quiet and italic, so it reads as
   a state rather than as a thread somebody named "waiting for reply". It
   stops being either the moment the answer lands. */
.hc-rail-chat.awaiting .hc-rail-chat-name{color:var(--hc-window-ink-quiet);
  font-style:italic;}
.hc-rail-archived{color:var(--hc-window-ink-quiet);font-size:0.72rem;
  font-family:var(--hc-mono,monospace);letter-spacing:0.04em;}
.hc-rail-archived.on{color:var(--hc-window-accent, rgb(${STEEL}));}

/* THE CONVERSATIONS on this layer, the list's other tab. Grouped by who each
   one waits on; a row is its name, where it stands and how long since it moved,
   one line each, so the list scans and never grows under your hand. The list
   itself scrolls — the tab is the whole list. */
.hc-rail-convos{display:flex;flex-direction:column;gap:1px;}
/* THE HEAD IS A BAR, one line that never wraps: the title takes what is left
   and gives way first (ellipsis), the count is a small chip, and the way to
   begin is a bordered button that keeps its own width. It used to be three
   loose words on a space-between row, so a narrow rail broke each of them
   onto a second line. */
.hc-rail-convos-head{display:flex;align-items:center;gap:0.5rem;white-space:nowrap;
  margin-bottom:0.25rem;padding:0.5rem 0.55rem;background:rgba(255,255,255,0.03);
  border-bottom:1px solid rgba(${STEEL},0.22);font-family:var(--hc-mono,monospace);
  font-size:0.7rem;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;
  color:var(--hc-window-ink-plain);}
.hc-rail-convos-head > span:first-child{flex:1 1 auto;min-width:0;overflow:hidden;
  text-overflow:ellipsis;}
.hc-rail-convos-count{flex:none;padding:0.12rem 0.45rem;letter-spacing:0.04em;
  text-transform:none;font-weight:500;background:rgba(${STEEL},0.14);
  border-radius:var(--hc-radius-control, 2px);color:var(--hc-window-ink-plain);}
.hc-rail-convos-count:empty{display:none;}
/* THE WAY TO BEGIN sits in the head as a real control: a bordered button in
   the accent ink, so it reads as pressable at a glance. */
.hc-rail-convos-new{flex:none;padding:0.3rem 0.65rem;border:1px solid rgba(${STEEL},0.5);
  border-radius:var(--hc-radius-control, 2px);background:rgba(${STEEL},0.1);font:inherit;
  font-weight:600;letter-spacing:0.04em;text-transform:none;cursor:pointer;
  color:var(--hc-window-accent, rgb(${STEEL}));}
.hc-rail-convos-new:hover,.hc-rail-convos-new:focus-visible{background:rgba(${STEEL},0.22);
  border-color:rgba(${STEEL},0.8);outline:none;}
.hc-rail-convos-group{padding:0.45rem 0.45rem 0.15rem;font-family:var(--hc-mono,monospace);
  font-size:0.66rem;color:var(--hc-window-ink-quiet);}
.hc-rail-convo{display:grid;grid-template-columns:1.3rem minmax(0,1fr) auto;gap:0.45rem;
  align-items:start;width:100%;padding:0.4rem 0.45rem;border:0;background:none;cursor:pointer;
  text-align:left;font:inherit;color:var(--hc-window-ink-plain);
  border-radius:var(--hc-radius-control, 2px);}
.hc-rail-convo:hover{background:rgba(255,255,255,0.05);color:var(--hc-window-ink-loud);}
.hc-rail-convo:focus-visible{outline:1px solid rgba(${STEEL},0.6);outline-offset:-1px;}
.hc-rail-convo.current{background:rgba(${STEEL},0.12);color:var(--hc-window-ink-loud);
  box-shadow:inset 2px 0 0 rgba(${STEEL},0.9);}
.hc-rail-convo.filed{color:var(--hc-window-ink-quiet);}
.hc-rail-convo-icon{font-family:'Material Symbols Outlined','Material Symbols Rounded';
  font-weight:400;font-style:normal;letter-spacing:normal;text-transform:none;
  white-space:nowrap;direction:ltr;-webkit-font-feature-settings:'liga';
  font-feature-settings:'liga';-webkit-font-smoothing:antialiased;
  font-size:1.05rem;line-height:1.15;color:var(--hc-window-ink-quiet);}
.hc-rail-convo[data-group="waiting"] .hc-rail-convo-icon{color:color-mix(in srgb, rgba(${CONVO_WAIT},0.95), rgb(var(--hc-panel-ink, 43, 30, 6)) var(--hc-deepen, 0%));}
.hc-rail-convo[data-group="open"] .hc-rail-convo-icon{color:color-mix(in srgb, rgba(${CONVO_OPEN},0.95), rgb(var(--hc-panel-ink, 43, 30, 6)) var(--hc-deepen, 0%));}
.hc-rail-convo[data-group="done"] .hc-rail-convo-icon{color:color-mix(in srgb, rgba(${CONVO_DONE},0.95), rgb(var(--hc-panel-ink, 43, 30, 6)) var(--hc-deepen, 0%));}
.hc-rail-convo-text{display:flex;flex-direction:column;gap:0.1rem;min-width:0;}
.hc-rail-convo-name{font-size:0.8rem;line-height:1.3;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;}
.hc-rail-convo.unread .hc-rail-convo-name{color:var(--hc-window-ink-loud);font-weight:600;}
.hc-rail-convo-line{font-size:0.72rem;line-height:1.3;color:var(--hc-window-ink-quiet);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-rail-convo-age{font-family:var(--hc-mono,monospace);font-size:0.64rem;line-height:1.7;
  color:var(--hc-window-ink-quiet);}
.hc-rail-convos-archived{margin-top:0.2rem;padding:0.3rem 0.45rem;border:0;background:none;
  cursor:pointer;text-align:left;font-family:var(--hc-mono,monospace);font-size:0.72rem;
  letter-spacing:0.04em;color:var(--hc-window-ink-quiet);}
.hc-rail-convos-archived.on{color:var(--hc-window-accent, rgb(${STEEL}));}

/* Same defect, same pass: placeholder text needs 4.5:1, not 2.76:1. */
.hc-rail-find input::placeholder{color:var(--hc-window-ink-quiet);}

@media (prefers-reduced-motion:reduce){
  .hc-rail-bees:not([hidden]){animation:none;opacity:1;}
  /* The mark stays; only the breath goes. Amber in the gutter is still the
     whole of what "in progress" says. */
  .hc-rail-row.live::before{animation:none;}
  .hc-rail-list{animation:none !important;}
}
`
