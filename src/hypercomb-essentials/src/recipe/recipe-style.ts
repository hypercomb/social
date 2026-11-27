// recipe/recipe-style.ts
//
// THE LOOK OF THE RECIPE DESK AND ITS TEMPLATE PICKER, and the small things
// both are built with: an element maker, the drawn marks, the plate, the
// light bulb, and the guard on the words a caller's `say` answers. One
// stylesheet, injected once per document, in the light DOM under the
// `hc-recipe` prefix.
//
// THE DESK IS THE TILE EDITOR'S MATERIAL (documentation/tile-editor.md): one
// opaque ground, mono type for labels and a reading face for what a cook
// wrote, quiet rectangular tabs joined to the plate by thin leaders, a card
// that opens over the drawing. Colour is by role: the shell's inks, lines and
// tints with a dark fallback, and one identity (the editor's gold, taken deep
// under a bright look) for marks, washes and the one filled button. The plate
// alone is a colour of its own: a plate is white on any ground.
//
// Everything inside the desk is sized in em of its own text, so larger text
// turns the narrow arrangement sooner. The narrow arrangement is the same
// nodes rearranged (`[data-layout=narrow]`): the list a drawer, the plate a
// band at the top, the tabs full-width rows that open in place. Corners stay
// on the shape ladder: control 2px, card 3px, floating 4px.
//
// Nothing here loads anything: no font, no picture, no sheet from another
// host (T7). Marks are drawn as inline paths, because the shell's symbol font
// is a fixed subset. Every node is made with createElement and filled through
// textContent, so no string a person, a file or a host wrote is ever parsed as
// markup.
//
// Pure: it exports and never registers. The recipe drone mounts what these build.

export const RECIPE_STYLE_ID = 'hc-recipe-style'

/** The caller's localisation: a key, the English words, and what fills their `{tokens}`. */
export type RecipeSay = (key: string, fallback: string, params?: Record<string, string | number>) => string

const DESKS = ':is(.hc-recipe,.hc-recipe-picker)'
const NARROW = '.hc-recipe[data-layout="narrow"]'

const RECIPE_STYLE = `
.hc-recipe,.hc-recipe-picker{
  --rp-ink:var(--hc-panel-ink,227,237,245);
  --rp-pane:var(--hc-panel-pane,12,19,27);
  --rp-ground:var(--md-surface,rgb(var(--rp-pane)));
  --rp-loud:var(--hc-window-ink-loud,rgba(var(--rp-ink),0.96));
  --rp-plain:var(--hc-window-ink-plain,rgba(var(--rp-ink),0.86));
  --rp-quiet:var(--hc-window-ink-quiet,rgba(var(--rp-ink),0.66));
  --rp-faint:var(--hc-window-ink-faint,rgba(var(--rp-ink),0.4));
  --rp-line:var(--hc-window-line,rgba(var(--rp-ink),0.14));
  --rp-line-firm:var(--hc-window-line-firm,rgba(var(--rp-ink),0.28));
  --rp-tint:var(--hc-window-tint,rgba(var(--rp-ink),0.045));
  --rp-tint-strong:var(--hc-window-tint-strong,rgba(var(--rp-ink),0.09));
  --rp-deepen:var(--hc-deepen,0%);
  --rp-accent:color-mix(in srgb,rgb(200,151,90),rgb(var(--rp-ink)) var(--rp-deepen));
  --rp-on-accent:rgb(var(--rp-pane));
  --rp-wash:color-mix(in srgb,var(--rp-accent) 10%,transparent);
  --rp-wash-strong:color-mix(in srgb,var(--rp-accent) 20%,transparent);
  --rp-edge:color-mix(in srgb,var(--rp-accent) 28%,transparent);
  --rp-edge-firm:color-mix(in srgb,var(--rp-accent) 62%,transparent);
  --rp-focus:color-mix(in srgb,var(--rp-accent) 72%,white);
  --rp-halo:color-mix(in srgb,var(--rp-ground) 85%,transparent);
  --rp-good:var(--hc-status-ok,color-mix(in srgb,rgb(var(--rp-lit)) 45%,rgb(var(--rp-ink))));
  --rp-warn:var(--hc-status-warn,#f0b05c);
  --rp-lit:111,211,154;
  --rp-plate:255,255,255;
  --rp-on-plate:62,46,22;
  --rp-control:var(--hc-radius-control,2px);
  --rp-card:var(--hc-radius-card,3px);
  --rp-floating:var(--hc-radius-floating,4px);
  --rp-shadow:var(--hc-panel-shadow,0,0,0);
  --rp-read:var(--hc-read,var(--hc-font,system-ui,-apple-system,'Segoe UI',sans-serif));
  --rp-mono:var(--hc-mono,ui-monospace,'SF Mono',Menlo,Consolas,monospace);
  box-sizing:border-box;
  font-size:calc(1rem * var(--hc-panel-scale,1));line-height:1.4;
  color:var(--rp-plain);-webkit-text-size-adjust:100%;text-size-adjust:100%;
}
/* With no shell tokens at all, a light machine still gets a light desk: its own ink, pane, deepen and caution, never brown on dark. */
@media (prefers-color-scheme:light){:root:not([data-theme]) ${DESKS}{--rp-ink:var(--hc-panel-ink,26,33,48);--rp-pane:var(--hc-panel-pane,253,254,255);
  --rp-deepen:var(--hc-deepen,46%);--rp-warn:var(--hc-status-warn,#7f4b04);}}
.hc-recipe *,.hc-recipe *::before,.hc-recipe *::after,
.hc-recipe-picker *,.hc-recipe-picker *::before,.hc-recipe-picker *::after{box-sizing:border-box;}
.hc-recipe [hidden],.hc-recipe-picker [hidden]{display:none !important;}
.hc-recipe-mark{display:block;flex:none;width:1.15em;height:1.15em;fill:currentColor;}
.hc-recipe :focus-visible,.hc-recipe-picker :focus-visible{outline:2px solid var(--rp-focus);outline-offset:1px;}

.hc-recipe{position:absolute;inset:0;z-index:var(--hc-recipe-z,60020);display:flex;flex-direction:column;min-height:0;overflow:hidden;
  background:var(--rp-ground);font-family:var(--rp-mono);}

/* ── the header ────────────────────────────────────────────────────────── */
/* One line on a wide desk: its words shrink to an ellipsis and nothing wraps, so the room under it never depends on what it says. Only the narrow header wraps. */
.hc-recipe-head{flex:none;position:relative;z-index:9;display:flex;align-items:center;gap:0.25em 0.5em;min-height:2.75em;
  padding:0.25em 0.5em 0.25em 0.9em;box-shadow:inset 0 -1px 0 var(--rp-line);}
.hc-recipe-title{flex:0 1 auto;min-width:2.5em;margin:0;font-family:var(--rp-read);font-size:1.02em;font-weight:500;line-height:1.3;color:var(--rp-loud);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-recipe-address{flex:0 2 auto;min-width:0;font-size:0.72em;color:var(--rp-quiet);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-recipe-status{flex:0 1 auto;min-width:0;max-width:26em;margin:0;font-family:var(--rp-read);font-size:0.78em;color:var(--rp-quiet);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-recipe-status:empty{display:none;}
.hc-recipe-head-end{flex:1 1 auto;min-width:0;display:flex;align-items:center;justify-content:flex-end;gap:0.25em 0.5em;}
.hc-recipe-head-end:has(.hc-recipe-shared:not([hidden])){flex-basis:20em;}
.hc-recipe-status.is-good{color:var(--rp-good);}
.hc-recipe-status.is-bad{color:var(--rp-warn);white-space:normal;overflow:visible;text-overflow:clip;}
.hc-recipe-sep{flex:none;align-self:center;width:1px;height:1.6em;margin:0 0.15em;background:var(--rp-line-firm);}
.hc-recipe-head .hc-recipe-field{flex:0 1 14em;width:auto;}

.hc-recipe-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:0.4em;height:2.2em;max-width:100%;margin:0;
  padding:0 0.85em;border:0;border-radius:var(--rp-control,2px);background:transparent;color:var(--rp-plain);
  font:inherit;font-size:0.82em;line-height:1.3;white-space:nowrap;cursor:pointer;transition:background-color 150ms ease,color 150ms ease;}
.hc-recipe-btn:hover:not(:disabled){background:var(--rp-tint-strong);color:var(--rp-loud);}
.hc-recipe-btn:disabled{color:var(--rp-quiet);cursor:default;}
.hc-recipe-btn.is-solid{min-width:5.5em;background:var(--rp-accent);color:var(--rp-on-accent,Canvas);font-weight:600;}
.hc-recipe-btn.is-solid:hover:not(:disabled){background:color-mix(in srgb,var(--rp-accent) 86%,rgb(var(--rp-ink)));color:var(--rp-on-accent,Canvas);}
/* A filled press that cannot be pressed (Next on the last page) must not look pressable: it loses its fill, keeps its place. */
.hc-recipe-btn.is-solid:disabled{background:transparent;color:var(--rp-quiet);outline:1px solid var(--rp-line);outline-offset:-1px;}
.hc-recipe-btn-words{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-recipe-template{flex:0 1 auto;min-width:4.5em;max-width:15em;padding-right:0.45em;box-shadow:inset 0 0 0 1px var(--rp-line);}
.hc-recipe-tool{appearance:none;flex:none;display:inline-grid;place-items:center;width:1.9em;height:1.9em;margin:0;padding:0;border:0;
  border-radius:var(--rp-control,2px);background:transparent;color:var(--rp-quiet);font:inherit;cursor:pointer;
  transition:background-color 150ms ease,color 150ms ease;}
.hc-recipe-tool:hover:not(:disabled){background:var(--rp-tint-strong);color:var(--rp-loud);}
.hc-recipe-tool:disabled{opacity:0.35;cursor:default;}
.hc-recipe-tool.hc-recipe-drawer-toggle,.hc-recipe-more.is-narrow-only{display:none;}

.hc-recipe-switch{flex:none;display:inline-flex;gap:2px;padding:2px;border-radius:var(--rp-control);background:var(--rp-tint);}
.hc-recipe-switch button{appearance:none;height:1.9em;margin:0;padding:0 0.75em;border:0;border-radius:var(--rp-control);background:transparent;
  color:var(--rp-plain);font:inherit;font-size:0.78em;white-space:nowrap;cursor:pointer;transition:background-color 150ms ease,color 150ms ease;}
.hc-recipe-switch button:hover{color:var(--rp-loud);}
.hc-recipe-switch button[aria-pressed="true"]{background:var(--rp-wash-strong);color:var(--rp-loud);box-shadow:inset 0 -2px 0 var(--rp-accent);}

.hc-recipe-shared{flex:0 8 auto;display:inline-flex;align-items:center;gap:0.2em;min-width:1.9em;}
.hc-recipe-bulb svg{width:1.3em;height:1.3em;overflow:visible;}
.hc-recipe-bulb .is-glass{fill:none;stroke:currentColor;stroke-width:1.5;stroke-linejoin:round;}
.hc-recipe-bulb .is-base{fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;}
.hc-recipe-bulb .is-rays{fill:none;stroke:rgb(var(--rp-lit));stroke-width:1.5;stroke-linecap:round;opacity:0;}
.hc-recipe-bulb[aria-pressed="true"]{color:var(--rp-loud);}
.hc-recipe-bulb[aria-pressed="true"] .is-glass{fill:rgb(var(--rp-lit));}
.hc-recipe-bulb[aria-pressed="true"] .is-rays{opacity:1;}
.hc-recipe-shared-words{min-width:0;max-width:30em;font-size:0.72em;color:var(--rp-quiet);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-recipe-shared-words[data-tone="good"]{color:var(--rp-good);}
.hc-recipe-shared-words[data-tone="warn"]{color:var(--rp-warn);}

.hc-recipe-more{position:relative;flex:none;}
.hc-recipe-menu{position:absolute;top:calc(100% + 0.25em);right:0;z-index:2;display:flex;flex-direction:column;min-width:13em;padding:2px;
  background:var(--rp-ground);border:1px solid var(--rp-edge-firm);border-radius:var(--rp-floating);
  box-shadow:0 0.6em 1.8em rgba(var(--rp-shadow),0.18);}
.hc-recipe-menu .hc-recipe-btn{justify-content:flex-start;width:100%;}
.hc-recipe-menu .hc-recipe-btn[aria-pressed="true"]{background:var(--rp-wash);box-shadow:inset 2px 0 0 var(--rp-accent);}
.hc-recipe-menu .is-narrow-only{display:none;}

.hc-recipe-progress{flex:none;height:2px;background:var(--rp-tint-strong);}
.hc-recipe-progress-fill{height:100%;width:0;background:var(--rp-accent);transition:width 160ms ease;}

/* ── the body: the list, and the stage the drawing lives on ────────────── */
.hc-recipe-body{flex:1 1 auto;min-height:0;display:flex;position:relative;}
.hc-recipe-list{flex:none;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;background:var(--rp-ground);
  box-shadow:inset -1px 0 0 var(--rp-line);}
.hc-recipe[data-list="full"] .hc-recipe-list{width:14.5em;}
.hc-recipe[data-list="mid"] .hc-recipe-list{width:11.5em;}
.hc-recipe[data-list="faces"] .hc-recipe-list{width:3.7em;}
.hc-recipe-list-head{flex:none;display:flex;align-items:center;height:2.6em;padding:0 0.95em;font-size:0.72em;font-weight:600;
  letter-spacing:0.12em;text-transform:uppercase;color:var(--rp-accent);white-space:nowrap;overflow:hidden;}
.hc-recipe-list-rows{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:2px;margin:0;padding:0.1em 0.5em 0.7em;
  overflow-x:hidden;overflow-y:auto;scrollbar-width:thin;}
.hc-recipe-list-row{appearance:none;flex:none;display:flex;align-items:center;gap:0.6em;width:100%;margin:0;padding:0.3em 0.3em 0.3em 0.4em;border:0;
  border-radius:var(--rp-control);background:transparent;color:var(--rp-quiet);font:inherit;text-align:left;cursor:pointer;
  transition:background-color 150ms ease,color 150ms ease;}
.hc-recipe-list-row:hover{background:var(--rp-tint);color:var(--rp-loud);}
.hc-recipe-list-row[aria-current="true"]{background:var(--rp-wash);box-shadow:inset 0 0 0 1px var(--rp-edge-firm);color:var(--rp-loud);cursor:default;}
.hc-recipe-list-plate{flex:none;display:grid;place-items:center;width:2.15em;height:2.15em;border:1px solid var(--rp-line);
  border-radius:var(--rp-card);background:var(--rp-tint);color:var(--rp-quiet);font-size:0.95em;font-weight:600;text-transform:uppercase;}
.hc-recipe-list-name{flex:1 1 auto;min-width:0;font-family:var(--rp-read);font-size:0.9em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-recipe-list-mark{flex:none;width:0.95em;height:0.95em;fill:none;stroke:var(--rp-accent);stroke-width:1.4;}
.hc-recipe[data-list="faces"] .hc-recipe-list-head,.hc-recipe[data-list="faces"] .hc-recipe-list-name{display:none;}
.hc-recipe[data-list="faces"] .hc-recipe-list-row{position:relative;padding:0.3em;justify-content:center;}
.hc-recipe[data-list="faces"] .hc-recipe-list-mark{position:absolute;right:0.05em;top:0.05em;width:0.7em;height:0.7em;}
.hc-recipe-scrim{display:none;}

.hc-recipe-stage{flex:1 1 auto;min-width:0;min-height:0;position:relative;overflow:hidden;display:grid;
  grid-template-columns:minmax(0,1fr) var(--hc-recipe-plate,22em) minmax(0,1fr);grid-auto-rows:1.2em;align-content:center;column-gap:3.5em;
  padding:1em 1em 4.5em;}
.hc-recipe-parts,.hc-recipe-part{display:contents;}

/* ── the plate ─────────────────────────────────────────────────────────── */
.hc-recipe-figure{grid-column:2;grid-row:1 / span var(--hc-recipe-rows,2);align-self:center;justify-self:center;position:relative;z-index:1;
  width:var(--hc-recipe-plate,22em);height:var(--hc-recipe-plate,22em);}
.hc-recipe-plate{position:absolute;inset:0;width:100%;height:100%;overflow:visible;}
.hc-recipe-dish{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;background:rgb(var(--rp-plate));cursor:pointer;
  border-radius:var(--rp-floating);box-shadow:0 0 0 1px rgba(var(--rp-ink),0.1),0 0.7em 1.8em rgba(var(--rp-shadow),0.1);}
.hc-recipe-dish img{display:block;width:100%;height:100%;padding:4%;object-fit:contain;}
/* A picture that did not arrive: the picture mark and its words on the plate's white, never a blank card. */
.hc-recipe-missing{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.35em;width:100%;min-width:0;min-height:4em;
  aspect-ratio:4 / 3;padding:0.5em;border-radius:var(--rp-control);background:rgb(var(--rp-plate));color:rgba(var(--rp-on-plate),0.74);
  font-family:var(--rp-read);font-size:0.8em;line-height:1.3;text-align:center;overflow:hidden;}
.hc-recipe-missing .hc-recipe-mark{width:1.7em;height:1.7em;opacity:0.5;}
.hc-recipe-missing-words{max-width:100%;overflow-wrap:anywhere;}
.hc-recipe-dish .hc-recipe-missing{position:absolute;inset:0;aspect-ratio:auto;border-radius:0;font-size:0.9em;padding:12%;}
.hc-recipe-strip-thumb .hc-recipe-missing{min-height:0;height:100%;aspect-ratio:auto;padding:0;border-radius:0;}
.hc-recipe-strip-thumb .hc-recipe-missing .hc-recipe-mark{width:1.2em;height:1.2em;}
.hc-recipe-strip-thumb .hc-recipe-missing-words{display:none;}
.hc-recipe-picture .hc-recipe-missing{font-size:0.6em;}
.hc-recipe-invite{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:46%;display:flex;flex-direction:column;align-items:center;
  gap:0.55em;text-align:center;color:rgba(var(--rp-on-plate),0.74);}
.hc-recipe-invite .hc-recipe-mark{width:1.7em;height:1.7em;opacity:0.5;}
.hc-recipe-invite p{margin:0;font-family:var(--rp-read);font-size:0.8em;line-height:1.35;text-wrap:balance;}
.hc-recipe-invite-btn{appearance:none;display:inline-flex;align-items:center;gap:0.35em;height:1.95em;margin:0;padding:0 0.8em;border:0;
  border-radius:var(--rp-control);background:rgba(var(--rp-on-plate),0.09);color:rgb(var(--rp-on-plate));font:inherit;font-size:0.76em;
  cursor:pointer;transition:background-color 150ms ease;}
.hc-recipe-invite-btn:hover{background:rgba(var(--rp-on-plate),0.16);}
.hc-recipe-invite-btn .hc-recipe-mark{width:1.2em;height:1.2em;opacity:1;}
.hc-recipe-figure-note{position:absolute;left:50%;bottom:8%;transform:translateX(-50%);padding:0.2em 0.6em;border-radius:var(--rp-control);
  background:rgb(var(--rp-plate));color:rgba(var(--rp-on-plate),0.8);font-size:0.72em;white-space:nowrap;}
.hc-recipe.is-dropping .hc-recipe-figure{outline:2px dashed var(--rp-accent);outline-offset:0.5em;border-radius:var(--rp-floating);}

/* ── a table set: a photographed table where the plate was ─────────────── */
/* One canvas in the picture's own px, scaled to the figure: the table, each plate, the place cards, the utensils, the press targets. */
.hc-recipe[data-set] .hc-recipe-stage{grid-template-columns:minmax(0,1fr) var(--hc-recipe-figure-w,36em) minmax(0,1fr);}
.hc-recipe[data-set] .hc-recipe-figure{width:var(--hc-recipe-figure-w,36em);height:var(--hc-recipe-figure-h,24em);}
.hc-recipe[data-set] .hc-recipe-tools{max-width:var(--hc-recipe-figure-w,36em);}
.hc-recipe-set{position:absolute;inset:0;overflow:hidden;border-radius:var(--rp-floating);background:var(--rp-tint-strong);
  box-shadow:0 0 0 1px rgba(var(--rp-ink),0.1),0 0.9em 2.4em rgba(var(--rp-shadow),0.24);}
.hc-recipe-set-canvas{position:absolute;left:0;top:0;transform-origin:0 0;}
.hc-recipe-set-layer{position:absolute;left:0;top:0;display:block;width:100%;height:100%;pointer-events:none;user-select:none;}
.hc-recipe-set-cards{position:absolute;inset:0;pointer-events:none;}
/* A place card: a slip of washi laid flat on the glaze, the plate's colour a little through it, in the desk's own type. */
.hc-recipe-placecard{position:absolute;left:0;top:0;transform-origin:0 0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:0.14em;padding:0 0.7em;overflow:hidden;background:rgba(244,238,226,0.84);color:rgb(58,46,36);border-radius:var(--rp-control);
  box-shadow:0 0 0 0.04em rgba(70,52,36,0.22),0 0.06em 0.22em rgba(0,0,0,0.32);font-family:var(--rp-mono);line-height:1.08;text-align:center;
  transition:opacity 150ms ease,box-shadow 150ms ease;}
.hc-recipe-placecard-label{max-width:100%;font-size:1em;font-weight:600;letter-spacing:0.03em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-recipe-placecard-said{max-width:100%;font-family:var(--rp-read);font-size:0.7em;color:rgba(58,46,36,0.7);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-recipe-placecard[data-lit]{background:rgba(250,246,238,0.95);box-shadow:0 0 0 0.12em var(--rp-accent),0 0.08em 0.25em rgba(0,0,0,0.28);}
.hc-recipe-set-hits{position:absolute;left:0;top:0;overflow:visible;}
.hc-recipe-set-plate{fill:transparent;stroke:transparent;pointer-events:all;cursor:pointer;vector-effect:non-scaling-stroke;stroke-width:1.5px;
  stroke-linejoin:round;transition:fill 150ms ease,stroke 150ms ease;}
.hc-recipe-set-plate[data-lit]{fill:var(--rp-wash);stroke:color-mix(in srgb,var(--rp-accent) 75%,transparent);}
.hc-recipe-set-plate[data-lit="strong"]{stroke:var(--rp-accent);}
.hc-recipe-lead.is-set circle{fill:rgb(var(--rp-plate));stroke:rgba(var(--rp-on-plate),0.72);}
.hc-recipe-lead.is-set[data-lit] circle{fill:var(--rp-accent);stroke:rgb(var(--rp-plate));}

/* The Table control: beside the template button, its list under it. */
.hc-recipe-table-wrap{position:relative;flex:none;}
.hc-recipe-table{padding-right:0.45em;box-shadow:inset 0 0 0 1px var(--rp-line);}
.hc-recipe-table[aria-expanded="true"]{box-shadow:inset 0 0 0 1px var(--rp-edge-firm);}
.hc-recipe-table-menu{position:absolute;top:calc(100% + 0.25em);left:0;z-index:2;display:flex;flex-direction:column;min-width:16em;max-width:min(24em,86vw);
  max-height:60vh;overflow-y:auto;padding:2px;background:var(--rp-ground);border:1px solid var(--rp-edge-firm);border-radius:var(--rp-floating);
  box-shadow:0 0.6em 1.8em rgba(var(--rp-shadow),0.18);}
.hc-recipe-table-item{justify-content:flex-start;width:100%;}
.hc-recipe-table-item[aria-pressed="true"]{background:var(--rp-wash);box-shadow:inset 2px 0 0 var(--rp-accent);}
.hc-recipe-table-aside{margin-left:auto;padding-left:0.8em;font-size:0.86em;color:var(--rp-quiet);overflow:hidden;text-overflow:ellipsis;}
.hc-recipe-table-head{margin:0;padding:0.6em 0.75em 0.25em;font-size:0.64em;font-weight:500;letter-spacing:0.12em;text-transform:uppercase;color:var(--rp-quiet);}
.hc-recipe-table-note{margin:0;padding:0.3em 0.75em;font-family:var(--rp-read);font-size:0.76em;color:var(--rp-quiet);}
.hc-recipe-table-rule{display:block;height:1px;margin:2px 0.4em;background:var(--rp-line);}
/* A kept set and its remove press, side by side: the set takes the row, the press its own small square. */
.hc-recipe-table-kept{display:flex;align-items:center;gap:2px;}
.hc-recipe-table-kept > .hc-recipe-table-item{flex:1 1 auto;min-width:0;}
.hc-recipe-table-forget{color:var(--rp-quiet);}
/* A chosen set whose pictures did not arrive: the control is marked, the words say why. */
.hc-recipe-table[data-broken]{box-shadow:inset 0 0 0 1px var(--rp-warn);}

.hc-recipe-tools{grid-column:2;grid-row:1 / span var(--hc-recipe-rows,2);align-self:center;justify-self:center;position:relative;z-index:1;
  transform:translateY(calc(var(--hc-recipe-plate,22em) / 2 + 50% + 1em));display:flex;align-items:center;justify-content:center;gap:0.2em;
  width:max-content;max-width:calc(var(--hc-recipe-plate,22em) + 5em);}
.hc-recipe-tools-note{margin:0;max-width:30em;font-family:var(--rp-read);font-size:0.78em;line-height:1.4;color:var(--rp-quiet);text-align:center;white-space:normal;}
.hc-recipe-strip{display:flex;align-items:center;gap:0.45em;min-width:0;margin-left:0.4em;padding:0.4em 0.4em 0.1em 0.7em;overflow-x:auto;
  scrollbar-width:thin;box-shadow:inset 1px 0 0 var(--rp-line);}
.hc-recipe-strip-item{position:relative;flex:none;display:flex;}
.hc-recipe-strip-thumb{appearance:none;display:block;width:2.2em;height:2.2em;margin:0;padding:0;border:1px solid var(--rp-line-firm);
  border-radius:var(--rp-control);background:rgb(var(--rp-plate));overflow:hidden;cursor:pointer;}
.hc-recipe-strip-thumb[aria-pressed="true"]{border-color:var(--rp-accent);box-shadow:0 0 0 1px var(--rp-accent);cursor:default;}
.hc-recipe-strip-thumb img{display:block;width:100%;height:100%;object-fit:cover;}
.hc-recipe-strip-remove{position:absolute;top:-0.4em;right:-0.4em;width:1.15em;height:1.15em;border-radius:50%;background:var(--rp-ground);
  box-shadow:0 0 0 1px var(--rp-line-firm);color:var(--rp-plain);}
.hc-recipe-strip-remove .hc-recipe-mark{width:0.8em;height:0.8em;}
.hc-recipe-strip-remove:hover:not(:disabled){background:var(--rp-ground);box-shadow:0 0 0 1px var(--rp-accent);}

/* ── tabs, labels and their leaders ────────────────────────────────────── */
.hc-recipe-leaders{position:absolute;inset:0;z-index:3;width:100%;height:100%;overflow:visible;pointer-events:none;}
.hc-recipe-lead path{fill:none;}
.hc-recipe-lead .is-halo{stroke:var(--rp-halo);stroke-width:3px;}
.hc-recipe-lead .is-line{stroke:var(--rp-faint);stroke-width:1px;transition:stroke 150ms ease,stroke-width 150ms ease;}
.hc-recipe-lead circle{fill:var(--rp-ground);stroke:var(--rp-quiet);stroke-width:1.25px;transition:stroke 150ms ease,fill 150ms ease;}
.hc-recipe-lead .is-inside.is-halo{stroke:rgba(var(--rp-plate),0.9);}
.hc-recipe-lead .is-inside.is-line{stroke:rgba(var(--rp-on-plate),0.5);}
.hc-recipe-lead.is-face circle{fill:rgb(var(--rp-plate));stroke:rgba(var(--rp-on-plate),0.72);}
.hc-recipe-lead[data-lit="soft"] .is-line{stroke:var(--rp-edge-firm);stroke-width:1.5px;}
.hc-recipe-lead[data-lit="soft"] circle{stroke:var(--rp-accent);}
.hc-recipe-lead.is-face[data-lit] .is-inside.is-line{stroke:rgb(var(--rp-on-plate));}
.hc-recipe-lead.is-face[data-lit] circle{stroke:rgb(var(--rp-on-plate));fill:rgb(var(--rp-on-plate));}
.hc-recipe-lead[data-lit="strong"] .is-line{stroke:var(--rp-accent);stroke-width:1.5px;}
.hc-recipe-lead[data-lit="strong"] circle{stroke:var(--rp-accent);fill:var(--rp-accent);}
.hc-recipe-veil{position:absolute;inset:0;z-index:2;background:color-mix(in srgb,var(--rp-ground) 48%,transparent);}

.hc-recipe-tab{appearance:none;position:relative;z-index:4;align-self:center;display:flex;align-items:center;gap:0.65em;
  width:min(100%,17em);height:2em;margin:0;padding:0 0.6em;border:0;border-radius:var(--rp-control);outline:1px solid var(--rp-line);outline-offset:0;
  background:var(--rp-ground);color:var(--rp-quiet);font:inherit;text-align:left;cursor:pointer;
  transition:color 150ms ease,background-color 150ms ease,outline-color 150ms ease,opacity 150ms ease;}
.hc-recipe-tab::after{content:"";position:absolute;left:0.6em;right:0.6em;bottom:1px;height:1px;background:transparent;transition:background-color 150ms ease;}
.hc-recipe-tab-label{flex:0 1 auto;min-width:0;max-width:100%;font-size:0.86em;font-weight:600;letter-spacing:0.01em;color:var(--rp-plain);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:color 150ms ease;}
.hc-recipe-tab-value{flex:1 1 0;min-width:0;font-size:0.76em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-recipe-tab:focus-visible{outline:2px solid var(--rp-focus);outline-offset:1px;}
[data-side="left"] > .hc-recipe-tab{grid-column:1;justify-self:end;flex-direction:row-reverse;text-align:right;}
[data-side="right"] > .hc-recipe-tab{grid-column:3;justify-self:start;}
.hc-recipe-tab[data-lit="soft"]{background:color-mix(in srgb,var(--rp-accent) 10%,var(--rp-ground));outline-color:var(--rp-edge);color:var(--rp-loud);}
.hc-recipe-tab[data-lit="soft"]::after{background:var(--rp-edge-firm);}
.hc-recipe-tab[data-lit="strong"]{background:color-mix(in srgb,var(--rp-accent) 20%,var(--rp-ground));outline-color:var(--rp-edge-firm);color:var(--rp-loud);}
.hc-recipe-tab[data-lit="strong"]::after{bottom:0;height:2px;background:var(--rp-accent);}
.hc-recipe-tab[data-lit] .hc-recipe-tab-label{color:var(--rp-loud);}
.hc-recipe[data-compact] .hc-recipe-tab-value{display:none;}

.hc-recipe-callout{appearance:none;position:relative;z-index:4;align-self:center;display:inline-flex;align-items:baseline;gap:0.55em;
  max-width:min(100%,19em);height:1.9em;margin:0;padding:0 0.5em;border:0;border-radius:var(--rp-control);background:transparent;
  color:var(--rp-loud);font:inherit;line-height:1.9em;text-align:left;cursor:pointer;
  transition:background-color 150ms ease,opacity 150ms ease;}
.hc-recipe-callout::after{content:"";position:absolute;left:0.5em;right:0.5em;bottom:0.2em;height:1px;background:transparent;transition:background-color 150ms ease;}
[data-side="left"] > .hc-recipe-callout{grid-column:1;justify-self:end;flex-direction:row-reverse;}
[data-side="right"] > .hc-recipe-callout{grid-column:3;justify-self:start;}
.hc-recipe-callout-amount{flex:none;font-size:0.74em;color:var(--rp-quiet);white-space:nowrap;}
.hc-recipe-callout-item{flex:0 1 auto;min-width:0;font-family:var(--rp-read);font-size:0.98em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-recipe-callout.is-more .hc-recipe-callout-item{font-family:inherit;font-size:0.76em;color:var(--rp-quiet);}
.hc-recipe-callout[data-lit]{background:color-mix(in srgb,var(--rp-accent) 10%,var(--rp-ground));}
.hc-recipe-callout[data-lit]::after{background:var(--rp-edge-firm);}

.hc-recipe-also{align-self:end;width:min(100%,17em);margin:0;padding-top:0.35em;border-top:1px solid var(--rp-line);
  font-size:0.64em;font-weight:500;line-height:1.5;letter-spacing:0.12em;text-transform:uppercase;color:var(--rp-quiet);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-recipe-also[data-side="left"]{grid-column:1;justify-self:end;text-align:right;}
.hc-recipe-also[data-side="right"]{grid-column:3;justify-self:start;}

.hc-recipe[data-open] .hc-recipe-part:not([data-open]) > :is(.hc-recipe-tab,.hc-recipe-callout):not([data-lit]),
.hc-recipe[data-open] .hc-recipe-part:not([data-open]) > :is(.hc-recipe-tab,.hc-recipe-callout):not([data-lit]) :is(.hc-recipe-tab-label,.hc-recipe-callout-item),
.hc-recipe[data-open] .hc-recipe-also{color:var(--rp-quiet);}
.hc-recipe[data-open] .hc-recipe-lead:not([data-lit]):not([data-own]){opacity:0.35;}

/* ── the card: one part, opened down the middle ────────────────────────── */
.hc-recipe-card{position:absolute;z-index:6;left:50%;top:max(1em,calc(50% - var(--hc-recipe-plate,22em) / 2 - 2.75em));transform:translateX(-50%);
  display:flex;flex-direction:column;width:min(calc(var(--hc-recipe-plate,22em) + 5em),calc(100% - 2em));
  max-height:calc(100% - max(1em,calc(50% - var(--hc-recipe-plate,22em) / 2 - 2.75em)) - 1em);min-width:0;
  background:var(--rp-ground);outline:1px solid var(--rp-edge-firm);border-radius:var(--rp-floating);
  box-shadow:0 1em 2.6em rgba(var(--rp-shadow),0.16);}
.hc-recipe-card-head{flex:none;display:flex;flex-direction:column;gap:0.2em;padding:0.8em 0.95em 0.5em;}
.hc-recipe-label{margin:0;font-size:0.95em;font-weight:600;line-height:1.3;letter-spacing:0.01em;color:var(--rp-loud);overflow-wrap:anywhere;}
.hc-recipe-hint{margin:0;font-family:var(--rp-read);font-size:0.8em;line-height:1.4;color:var(--rp-quiet);}
.hc-recipe-editor{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;align-items:stretch;gap:0.6em;padding:0.3em 0.95em 0.7em;
  overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;}
.hc-recipe-editor > .hc-recipe-btn{align-self:flex-start;margin-left:-0.4em;}
.hc-recipe-card-foot{flex:none;display:flex;justify-content:flex-end;padding:0.5em 0.95em 0.7em;box-shadow:inset 0 1px 0 var(--rp-line);}

.hc-recipe-field{width:100%;min-width:0;height:2.2em;margin:0;padding:0 0.6em;border:0;border-bottom:1px solid transparent;
  border-radius:var(--rp-control,2px);background:var(--rp-tint);color:var(--rp-loud);font-family:var(--rp-read,inherit);font-size:0.96em;line-height:1.4;
  outline:none;transition:background-color 150ms ease,border-color 150ms ease;}
.hc-recipe-field::placeholder{color:var(--rp-quiet);opacity:1;}
.hc-recipe-field:hover{background:var(--rp-tint-strong);}
.hc-recipe-field:focus,.hc-recipe-field:focus-visible{outline:none;background:var(--rp-tint-strong);border-bottom-color:var(--rp-accent);}
textarea.hc-recipe-field{display:block;height:auto;min-height:2.2em;padding:0.45em 0.6em;resize:none;overflow:hidden;line-height:1.55;}
.hc-recipe-card[data-kind="text"] textarea.hc-recipe-field{min-height:7.5em;font-size:1em;}
select.hc-recipe-field{appearance:auto;padding:0 0.3em;font-family:inherit;font-size:0.78em;}
select.hc-recipe-field option{background:rgb(var(--rp-pane));color:rgb(var(--rp-ink));}

.hc-recipe-rows{display:flex;flex-direction:column;gap:0.3em;width:100%;}
.hc-recipe-row{display:grid;gap:0.3em;align-items:stretch;min-width:0;}
.hc-recipe-row > .hc-recipe-field{height:auto;min-height:2.2em;}
.hc-recipe-row > .hc-recipe-tool{align-self:center;}
.hc-recipe-ingredient{grid-template-columns:minmax(3.4em,5.6em) minmax(0,1.5fr) minmax(0,1fr) 1.9em;}
.hc-recipe-ingredient > [data-at$=":amount"]{font-family:var(--rp-mono);font-size:0.82em;}
.hc-recipe-fact{grid-template-columns:minmax(4em,9em) minmax(0,1fr) 1.9em;}
.hc-recipe-link{grid-template-columns:minmax(0,1.5fr) minmax(0,1fr) 1.9em;}
.hc-recipe-marks{grid-column:1 / -1;display:flex;flex-wrap:wrap;align-items:center;gap:0.5em;}
.hc-recipe-tag{display:inline-flex;align-items:center;padding:0 0.45em;border:1px solid var(--rp-line-firm);border-radius:var(--rp-control,2px);
  font-family:var(--rp-mono,ui-monospace,monospace);font-size:0.64em;line-height:1.6;letter-spacing:0.08em;text-transform:uppercase;
  color:var(--rp-plain);white-space:nowrap;}
.hc-recipe-note{margin:0;font-family:var(--rp-read);font-size:0.8em;line-height:1.4;color:var(--rp-warn);}

.hc-recipe-step{display:grid;grid-template-columns:1.5em minmax(0,1fr);gap:0.3em 0.6em;padding:0.65em 0;border-top:1px solid var(--rp-line);}
.hc-recipe-step:first-child{padding-top:0;border-top:0;}
.hc-recipe-step-n{padding-top:0.5em;font-size:0.95em;font-weight:600;color:var(--rp-quiet);font-variant-numeric:tabular-nums;text-align:right;}
.hc-recipe-step-main{display:flex;flex-direction:column;gap:0.3em;min-width:0;}
.hc-recipe-step-tools{display:flex;flex-wrap:wrap;align-items:center;gap:0.1em;}
.hc-recipe-minutes{display:inline-flex;align-items:center;gap:0.4em;margin-right:auto;font-size:0.78em;color:var(--rp-quiet);}
.hc-recipe-minutes .hc-recipe-field{width:3.8em;height:2em;text-align:right;font-family:var(--rp-mono);}

.hc-recipe-thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(7em,1fr));gap:0.5em;width:100%;}
.hc-recipe-thumb{position:relative;display:flex;flex-direction:column;min-width:0;margin:0;border:1px solid var(--rp-line);
  border-radius:var(--rp-control);background:var(--rp-tint);overflow:hidden;}
.hc-recipe-thumb img{display:block;width:100%;aspect-ratio:4 / 3;object-fit:contain;background:rgb(var(--rp-plate));}
.hc-recipe-thumb .hc-recipe-tag{position:absolute;top:0.3em;left:0.3em;background:var(--rp-ground);}
.hc-recipe-thumb-tools{display:flex;justify-content:space-between;}
.hc-recipe-thumb.is-storing{display:grid;place-items:center;aspect-ratio:4 / 3;padding:0.5em;border-style:dashed;
  font-family:var(--rp-read);font-size:0.8em;color:var(--rp-quiet);text-align:center;}
.hc-recipe-step-picture{width:11em;max-width:100%;}
.hc-recipe-add{display:flex;flex-wrap:wrap;align-items:center;gap:0.3em 0.5em;width:100%;padding:0.5em;
  border:1px dashed var(--rp-line-firm);border-radius:var(--rp-control);}
.hc-recipe-add-hint{font-family:var(--rp-read);font-size:0.8em;color:var(--rp-quiet);}

/* ── arrange: the layout itself, in the same drawing ───────────────────── */
.hc-recipe-arrange-row,[data-side="left"] > .hc-recipe-arrange-row{flex-direction:row;cursor:default;gap:0.15em;width:min(100%,19em);padding:0 0.15em 0 0.25em;text-align:left;}
.hc-recipe-arrange-row .hc-recipe-field{flex:1 1 4em;height:1.7em;padding:0 0.45em;background:transparent;font-size:0.86em;text-align:inherit;}
.hc-recipe-arrange-row .hc-recipe-field:hover,.hc-recipe-arrange-row .hc-recipe-field:focus{background:var(--rp-tint-strong);}
.hc-recipe-arrange-row select.hc-recipe-field{flex:0 0 7.2em;font-size:0.74em;}
.hc-recipe-arrange-row .hc-recipe-tool{width:1.7em;height:1.7em;}
.hc-recipe-arrange-row .hc-recipe-tag{flex:none;border:0;padding:0 0.2em;color:var(--rp-quiet);}
.hc-recipe-arrange-row .hc-recipe-btn{flex:none;height:1.7em;padding:0 0.5em;font-size:0.74em;}
.hc-recipe-arrange-add{outline-style:dashed;outline-color:var(--rp-line-firm);}
.hc-recipe-kept-name{flex:1 1 auto;min-width:0;padding:0 0.4em;font-size:0.84em;color:var(--rp-plain);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hc-recipe[data-compact] .hc-recipe-arrange-row .hc-recipe-tag{display:none;}

/* ── read along: one page at a time, in the same material ──────────────── */
.hc-recipe-reader{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;}
.hc-recipe-scroll{flex:1 1 auto;min-width:0;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-width:thin;}
.hc-recipe-column{display:flex;flex-direction:column;gap:2em;max-width:42em;margin:0 auto;
  padding:2em max(1em,env(safe-area-inset-right,0px)) 4em max(1em,env(safe-area-inset-left,0px));}
.hc-recipe-page{display:flex;flex-direction:column;gap:1.1em;min-width:0;font-family:var(--rp-read);
  font-size:clamp(1.15em,0.95em + 1vw,1.45em);line-height:1.6;color:var(--rp-loud);}
.hc-recipe-page > .hc-recipe-btn{align-self:flex-start;margin-left:-0.85em;font-family:var(--rp-mono);font-size:calc(0.82rem * var(--hc-panel-scale,1));}
.hc-recipe-page-label{margin:0;font-family:var(--rp-mono);font-size:0.56em;font-weight:600;line-height:1.5;
  letter-spacing:0.12em;text-transform:uppercase;color:var(--rp-accent);}
.hc-recipe-cover-title{margin:0;font-size:clamp(1.7em,1.2em + 2.4vw,2.6em);font-weight:400;line-height:1.1;overflow-wrap:anywhere;}
.hc-recipe-picture{margin:0;padding:0.6em;background:rgb(var(--rp-plate));border-radius:var(--rp-card);
  box-shadow:0 0 0 1px rgba(var(--rp-ink),0.1),0 0.5em 1.4em rgba(var(--rp-shadow),0.08);}
.hc-recipe-picture img{display:block;max-width:100%;max-height:56vh;margin:0 auto;border-radius:var(--rp-control);}
.hc-recipe-facts{display:flex;flex-wrap:wrap;gap:0.6em 2em;margin:0;}
.hc-recipe-facts div{display:flex;flex-direction:column;min-width:0;}
.hc-recipe-facts dt{font-family:var(--rp-mono);font-size:0.5em;letter-spacing:0.12em;text-transform:uppercase;color:var(--rp-quiet);}
.hc-recipe-facts dd{margin:0;overflow-wrap:anywhere;}
.hc-recipe-prose{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;}
.hc-recipe-step-words{font-size:1em;line-height:1.45;}
/* Why a recipe did not open: plain words under the sentence that says so. */
.hc-recipe-unreadable-why{font-family:var(--rp-read);font-size:0.72em;line-height:1.5;overflow-wrap:anywhere;}
.hc-recipe-aside{margin:0;font-family:var(--rp-mono);font-size:0.56em;color:var(--rp-quiet);}
.hc-recipe-check{display:flex;flex-direction:column;margin:0;padding:0;list-style:none;}
.hc-recipe-check label{display:grid;grid-template-columns:1.4em minmax(0,1fr);gap:0.6em;align-items:start;min-height:2.4em;
  padding:0.45em 0;border-bottom:1px solid var(--rp-line);cursor:pointer;}
.hc-recipe-check input{width:1.1em;height:1.1em;margin:0.28em 0 0;accent-color:var(--rp-accent);}
.hc-recipe-check input:checked + span{color:var(--rp-quiet);text-decoration:line-through;}
.hc-recipe-amount{margin-right:0.5em;font-family:var(--rp-mono);font-size:0.72em;color:var(--rp-quiet);}
.hc-recipe-item-note{margin-left:0.4em;color:var(--rp-quiet);}
.hc-recipe-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(11em,1fr));gap:0.6em;}
.hc-recipe-gallery img{display:block;width:100%;border-radius:var(--rp-control);background:rgb(var(--rp-plate));}
.hc-recipe-links{display:flex;flex-direction:column;margin:0;padding:0;list-style:none;}
.hc-recipe-links li{display:flex;flex-wrap:wrap;align-items:center;gap:0.25em 0.75em;min-height:2.4em;padding:0.4em 0;border-bottom:1px solid var(--rp-line);}
.hc-recipe-links a{color:var(--rp-loud);text-decoration:underline;text-decoration-color:var(--rp-accent);text-underline-offset:0.2em;overflow-wrap:anywhere;}
.hc-recipe-nav{flex:none;display:flex;align-items:center;justify-content:space-between;gap:0.75em;box-shadow:inset 0 1px 0 var(--rp-line);
  padding:0.5em max(1em,env(safe-area-inset-right,0px)) calc(0.5em + env(safe-area-inset-bottom,0px)) max(1em,env(safe-area-inset-left,0px));}
.hc-recipe-nav .hc-recipe-btn{min-width:7.5em;height:2.6em;font-size:0.9em;}
.hc-recipe-position{font-size:0.78em;color:var(--rp-quiet);font-variant-numeric:tabular-nums;white-space:nowrap;}

/* ── the template picker: a panel over the desk ────────────────────────── */
.hc-recipe-picker{position:fixed;inset:0;z-index:calc(var(--hc-recipe-z,60020) + 1);display:flex;align-items:flex-start;justify-content:center;
  padding:max(1em,env(safe-area-inset-top,0px)) 1em max(1em,env(safe-area-inset-bottom,0px));
  background:color-mix(in srgb,var(--rp-ground) 55%,rgba(var(--rp-shadow),0.5));font-family:var(--rp-read);}
.hc-recipe-picker-panel{display:flex;flex-direction:column;width:min(38em,100%);max-height:100%;background:var(--rp-ground);
  outline:1px solid var(--rp-edge-firm);border-radius:var(--rp-floating);box-shadow:0 1em 3em rgba(var(--rp-shadow),0.24);overflow:hidden;}
.hc-recipe-picker-head{flex:none;display:flex;align-items:center;gap:0.5em;padding:0.5em 0.5em 0.5em 0.95em;}
.hc-recipe-picker-title{flex:1 1 auto;min-width:0;margin:0;font-size:1.08em;font-weight:500;color:var(--rp-loud);}
.hc-recipe-picker-search{flex:none;padding:0 0.95em 0.7em;}
.hc-recipe-picker-list{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:1.1em;padding:0.25em 0.95em 1em;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;}
.hc-recipe-picker-group{display:flex;flex-direction:column;gap:0.45em;min-width:0;}
.hc-recipe-picker-group h3{margin:0;font-family:var(--rp-mono);font-size:0.68em;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:var(--rp-accent);overflow-wrap:anywhere;}
.hc-recipe-picker-quiet{margin:0;font-size:0.86em;color:var(--rp-quiet);}
.hc-recipe-picker-entries{display:flex;flex-direction:column;gap:0.4em;margin:0;padding:0;list-style:none;}
.hc-recipe-picker-entries li{display:flex;flex-direction:column;align-items:flex-end;gap:0.15em;min-width:0;}
.hc-recipe-picker-entry{appearance:none;display:flex;flex-direction:column;align-items:flex-start;gap:0.2em;width:100%;min-height:3.2em;margin:0;
  padding:0.6em 0.8em;border:0;border-radius:var(--rp-control);outline:1px solid var(--rp-line);background:transparent;color:var(--rp-plain);
  font:inherit;text-align:left;cursor:pointer;transition:background-color 150ms ease,outline-color 150ms ease;}
.hc-recipe-picker-entry:hover{outline-color:var(--rp-edge-firm);background:var(--rp-wash);}
.hc-recipe-picker-entry[aria-current="true"]{outline-color:var(--rp-accent);box-shadow:inset 3px 0 0 var(--rp-accent);}
.hc-recipe-picker-name{display:flex;flex-wrap:wrap;align-items:center;gap:0.25em 0.5em;font-size:1em;font-weight:500;color:var(--rp-loud);overflow-wrap:anywhere;}
.hc-recipe-picker-about{font-size:0.86em;overflow-wrap:anywhere;}
.hc-recipe-chips{display:block;font-family:var(--rp-mono);font-size:0.68em;line-height:1.6;color:var(--rp-quiet);}
.hc-recipe-chips span:not(:last-child)::after{content:'·';margin:0 0.5em;}
.hc-recipe-picker-forget{height:1.9em;padding:0 0.6em;font-family:var(--rp-mono);font-size:0.72em;}

/* ── NARROW: the same nodes, rearranged ────────────────────────────────── */
${NARROW} .hc-recipe-head{flex-wrap:wrap;gap:0.25em;padding:0.25em 0.5em;}
${NARROW} .hc-recipe-tool.hc-recipe-drawer-toggle{display:inline-grid;}
${NARROW} .hc-recipe-more.is-narrow-only{display:block;}
${NARROW} .hc-recipe-title{flex:1 1 5em;}
${NARROW} .hc-recipe-address,${NARROW} .hc-recipe-sep,${NARROW} .hc-recipe-browse{display:none;}
${NARROW} .hc-recipe-head-end,${NARROW} .hc-recipe-shared{display:contents;}
${NARROW} .hc-recipe-status{order:9;flex:1 1 100%;}
${NARROW} .hc-recipe-shared-words{order:10;flex:1 1 100%;max-width:none;padding:0 0 0.2em 0.15em;white-space:normal;overflow:visible;text-overflow:clip;}
${NARROW} .hc-recipe-switch{margin-right:auto;}
${NARROW} .hc-recipe-btn.is-solid{min-width:0;}
${NARROW} .hc-recipe-menu .is-narrow-only{display:inline-flex;}
${NARROW} .hc-recipe-list{display:none;position:absolute;left:0;top:0;bottom:0;z-index:8;width:min(18em,86%);}
${NARROW}[data-drawer] .hc-recipe-list{display:flex;}
${NARROW}[data-drawer] .hc-recipe-scrim{display:block;position:absolute;inset:0;z-index:7;background:rgba(0,0,0,0.45);}
${NARROW} .hc-recipe-list-head,${NARROW} .hc-recipe-list-name{display:flex;}
${NARROW} .hc-recipe-list-name{display:block;}
${NARROW} .hc-recipe-list-row{position:static;justify-content:flex-start;min-height:44px;padding:0.3em 0.3em 0.3em 0.4em;}
${NARROW} .hc-recipe-list-mark{position:static;width:0.95em;height:0.95em;}
${NARROW} .hc-recipe-stage{display:flex;flex-direction:column;align-items:stretch;gap:0.4em;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;
  scroll-padding-top:calc(var(--hc-recipe-plate,13em) + 2em);  padding:0 max(16px,env(safe-area-inset-right,0px)) 1.4em max(16px,env(safe-area-inset-left,0px));}
${NARROW} .hc-recipe-leaders,${NARROW} .hc-recipe-veil,${NARROW} .hc-recipe-callout{display:none;}
${NARROW} .hc-recipe-figure{flex:none;align-self:center;position:sticky;top:0;z-index:5;margin:0.6em 0 0.3em;
  box-shadow:0 0 0 100vmax var(--rp-ground);clip-path:inset(-0.6em -100vmax -0.3em);}
${NARROW} .hc-recipe-tools{flex:none;align-self:center;transform:none;flex-wrap:wrap;max-width:100%;margin-bottom:0.3em;}
${NARROW} .hc-recipe-part{display:block;flex:none;width:100%;max-width:36em;margin:0 auto;border:1px solid var(--rp-line);
  border-radius:var(--rp-card);background:var(--rp-ground);}
${NARROW} .hc-recipe-part[data-open]{border-color:var(--rp-edge-firm);}
${NARROW} .hc-recipe-tab{width:100%;height:auto;min-height:max(3em,44px);outline:0;gap:0.8em;padding:0 0.75em;flex-direction:row;text-align:left;}
${NARROW} .hc-recipe-tab:focus-visible{outline:2px solid var(--rp-focus);outline-offset:-2px;}
${NARROW} .hc-recipe-tab::after{left:0.75em;right:0.75em;bottom:4px;}
${NARROW} .hc-recipe-tab-label{font-size:0.9em;}
${NARROW} .hc-recipe-tab-value{flex:1 1 auto;display:block;font-size:0.8em;text-align:right;}
${NARROW} .hc-recipe-also{flex:none;align-self:center;width:100%;max-width:36em;margin-top:0.8em;text-align:left;}
${NARROW}[data-open] .hc-recipe-part:not([data-open]) > .hc-recipe-tab:not([data-lit]) .hc-recipe-tab-label{color:var(--rp-plain);}
${NARROW} .hc-recipe-card{position:static;transform:none;width:auto;max-height:none;outline:0;border-radius:0;box-shadow:none;background:transparent;}
${NARROW} .hc-recipe-card-head{padding-top:0.3em;}
${NARROW} .hc-recipe-card-head .hc-recipe-label{display:none;}
${NARROW} .hc-recipe-editor{overflow:visible;}
${NARROW} .hc-recipe-arrange-row{flex-wrap:wrap;padding:0.2em 0.3em;}
${NARROW} :is(.hc-recipe-tool,.hc-recipe-invite-btn,.hc-recipe-switch button){min-width:44px;min-height:44px;}
${NARROW} .hc-recipe-btn{min-height:44px;}
${NARROW} .hc-recipe-field{min-height:44px;font-size:max(16px,1em);}
${NARROW} .hc-recipe-row > .hc-recipe-tool{align-self:start;}
${NARROW} .hc-recipe-ingredient{grid-template-columns:5.5em minmax(0,1fr) 44px;}
${NARROW} .hc-recipe-ingredient > [data-at$=":note"]{grid-column:1 / span 2;grid-row:2;}
${NARROW} .hc-recipe-link{grid-template-columns:minmax(0,1fr) 44px;}
${NARROW} .hc-recipe-link > [data-at$=":label"]{grid-column:1;grid-row:2;}
${NARROW} .hc-recipe-link > .hc-recipe-marks{grid-row:3;}
${NARROW} .hc-recipe-fact{grid-template-columns:minmax(4.5em,2fr) minmax(0,3fr) 44px;}
${NARROW} .hc-recipe-strip-thumb{width:44px;height:44px;}
${NARROW} .hc-recipe-strip .hc-recipe-strip-remove{width:1.7em;height:1.7em;min-width:0;min-height:0;}
${NARROW} .hc-recipe-strip-remove::before{content:"";position:absolute;left:50%;top:50%;width:44px;height:44px;transform:translate(-50%,-50%);}
${NARROW} .hc-recipe-nav .hc-recipe-btn{min-width:0;flex:1 1 0;}

@media (pointer:coarse){
  :is(.hc-recipe,.hc-recipe-picker) :is(.hc-recipe-tool,.hc-recipe-invite-btn,.hc-recipe-switch button){min-width:44px;min-height:44px;}
  :is(.hc-recipe,.hc-recipe-picker) .hc-recipe-btn{min-height:44px;}
  :is(.hc-recipe,.hc-recipe-picker) .hc-recipe-field{min-height:44px;font-size:max(16px,1em);}
  .hc-recipe .hc-recipe-strip .hc-recipe-strip-remove{width:1.7em;height:1.7em;min-width:0;min-height:0;}
  .hc-recipe .hc-recipe-strip-remove::before{content:"";position:absolute;left:50%;top:50%;width:44px;height:44px;transform:translate(-50%,-50%);}
  .hc-recipe .hc-recipe-strip-thumb{width:44px;height:44px;}
}
@media (max-width:35em){
  .hc-recipe-picker{padding:0;}
  .hc-recipe-picker-panel{width:100%;height:100%;outline:0;border-radius:0;}
}
@media (prefers-reduced-motion:reduce){
  .hc-recipe *,.hc-recipe-picker *{transition:none !important;animation:none !important;}
}
@media (forced-colors:active){
  .hc-recipe-btn.is-solid{background:Highlight;color:HighlightText;forced-color-adjust:none;}
  .hc-recipe-btn.is-solid:disabled{background:Canvas;color:GrayText;}
  .hc-recipe-lead .is-line,.hc-recipe-lead circle{stroke:CanvasText;}
  .hc-recipe-tab[data-lit],.hc-recipe-card{outline:2px solid Highlight;}
}
`

/** Inject the one stylesheet into a document, once. */
export function ensureRecipeStyles(doc: Document): void {
  if (doc.getElementById(RECIPE_STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = RECIPE_STYLE_ID
  style.textContent = RECIPE_STYLE
  ;(doc.head ?? doc.documentElement).appendChild(style)
}

/** An element with a class and, when given, words. The words are text, never markup. */
export function recipeEl<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, words?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (words !== undefined) node.textContent = words
  return node
}

const SVG_SPACE = 'http://www.w3.org/2000/svg'

/** A drawn node: an SVG element with its attributes set. Nothing a person wrote is ever one of them. */
export function recipeSvg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Readonly<Record<string, string | number>> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_SPACE, tag)
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value))
  return node
}

const RECIPE_MARKS = {
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  down: 'M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z',
  up: 'M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z',
  left: 'M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z',
  right: 'M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
  more: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  picture: 'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z',
  list: 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
  upload: 'M5 20h14v-2H5v2zm0-10h4v6h6v-6h4l-7-7-7 7z',
  paste: 'M19 2h-4.18C14.4.84 13.3 0 12 0S9.6.84 9.18 2H5c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm7 18H5V4h2v3h10V4h2v16z',
} as const

export type RecipeMarkName = keyof typeof RECIPE_MARKS

/** A drawn mark: one inline path that takes the ink of whatever holds it. Hidden from a reader; the control names itself. */
export function recipeMark(name: RecipeMarkName): SVGSVGElement {
  const svg = recipeSvg('svg', { viewBox: '0 0 24 24', class: 'hc-recipe-mark', 'aria-hidden': 'true', focusable: 'false' })
  svg.appendChild(recipeSvg('path', { d: RECIPE_MARKS[name] }))
  return svg
}

/**
 * The light bulb of the shared switch: glass, base and three rays. The
 * stylesheet fills the glass and shows the rays when its button is pressed.
 */
export function recipeBulb(): SVGSVGElement {
  const svg = recipeSvg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' })
  svg.append(
    recipeSvg('path', { class: 'is-rays', d: 'M12 1.2v1.9M4.4 4.6l1.3 1.3M19.6 4.6l-1.3 1.3' }),
    recipeSvg('path', { class: 'is-glass', d: 'M12 5a6 6 0 0 0-3.6 10.8c.5.4.8 1 .8 1.6V18h5.6v-.6c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 5z' }),
    recipeSvg('path', { class: 'is-base', d: 'M9.8 20.4h4.4M10.8 22.6h2.4' }),
  )
  return svg
}

/** The small ring a list row wears when its tile holds a recipe: a plate seen from above. */
export function recipePlateMark(): SVGSVGElement {
  const svg = recipeSvg('svg', { viewBox: '0 0 16 16', class: 'hc-recipe-list-mark', 'aria-hidden': 'true', focusable: 'false' })
  svg.append(recipeSvg('circle', { cx: 8, cy: 8, r: 6.4 }), recipeSvg('circle', { cx: 8, cy: 8, r: 3.2 }))
  return svg
}

/**
 * The plate, drawn: a soft shadow on the ground, a white rim, and the well
 * inside it. `id` keeps its gradients its own when two desks share a document.
 * The rim's edge sits at 0.48 of the square and the well at 0.35, the same
 * shares the leaders are laid by (recipe-desk.ts).
 */
export function recipePlate(id: string): SVGSVGElement {
  // A JAPANESE SQUARE PLATE (jwize, 2026-11-24: the round one, with its rim and
  // well, read as a bowl). Flat, with a thin raised lip and softly turned
  // corners, in a matte ivory glaze: a square of light for the dish to sit on.
  // The corner radii are SVG geometry, not CSS: the plate is a drawing.
  const svg = recipeSvg('svg', { viewBox: '0 0 200 200', class: 'hc-recipe-plate', 'aria-hidden': 'true', focusable: 'false' })
  const linear = (name: string, stops: readonly (readonly [number, string, number])[]): SVGLinearGradientElement => {
    const node = recipeSvg('linearGradient', { id: `${id}-${name}`, x1: 0, y1: 0, x2: 1, y2: 1 })
    for (const [offset, colour, opacity] of stops) node.appendChild(recipeSvg('stop', { offset, 'stop-color': colour, 'stop-opacity': opacity }))
    return node
  }
  const defs = recipeSvg('defs')
  defs.append(
    // The glaze: light falls from the upper left, so the body warms a little toward the lower right.
    linear('body', [[0, 'rgb(255,254,251)', 1], [0.55, 'rgb(250,247,241)', 1], [1, 'rgb(240,235,225)', 1]]),
    // The flat face inside the lip, lit the other way: the lip's own shadow falls on its upper left.
    linear('face', [[0, 'rgb(244,240,232)', 1], [0.16, 'rgb(252,250,246)', 1], [1, 'rgb(255,255,254)', 1]]),
  )
  svg.append(
    defs,
    // Two soft shadows under the plate, the wider one fainter: it sits on the desk, a little lifted.
    recipeSvg('rect', { x: 5, y: 9, width: 194, height: 194, rx: 10, fill: 'rgb(46,32,8)', 'fill-opacity': 0.05 }),
    recipeSvg('rect', { x: 7, y: 8, width: 189, height: 191, rx: 9, fill: 'rgb(46,32,8)', 'fill-opacity': 0.08 }),
    // The plate.
    recipeSvg('rect', { x: 4, y: 4, width: 192, height: 192, rx: 7, fill: `url(#${id}-body)`, stroke: 'rgb(60,45,20)', 'stroke-opacity': 0.16, 'stroke-width': 0.6 }),
    // The face, inside the lip.
    recipeSvg('rect', { x: 13, y: 13, width: 174, height: 174, rx: 3.5, fill: `url(#${id}-face)`, stroke: 'rgb(60,45,20)', 'stroke-opacity': 0.09, 'stroke-width': 0.6 }),
    // The lip catches the light along its lower right.
    recipeSvg('path', { d: 'M187 16.5 V183.5 Q187 187 183.5 187 H16.5', fill: 'none', stroke: 'rgb(255,255,255)', 'stroke-opacity': 0.95, 'stroke-width': 0.9, 'stroke-linecap': 'round' }),
  )
  return svg
}

/**
 * The words for a key. A catalogue that does not know the key may echo it back
 * or answer nothing: then the English is used, and its `{tokens}` are filled
 * either way.
 */
export function recipeWords(say: RecipeSay, key: string, fallback: string, params?: Record<string, string | number>): string {
  let answer = ''
  try { answer = say(key, fallback, params) } catch { answer = '' }
  const words = answer && answer !== key ? answer : fallback
  return words.replace(/\{(\w+)\}/g, (whole, name: string) => (params && name in params ? String(params[name]) : whole))
}
