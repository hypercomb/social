// editor/tile-editor.styles.ts
//
// THE TILE EDITOR'S MATERIAL — one stylesheet, installed once, scoped to the
// surface's tag. A module cannot `@use` the shared SCSS, so the shell's
// vocabulary is restated here by ROLE, never by colour
// (documentation/tool-window-colour-roles.md):
//
//   ink      --hc-window-ink-loud | -plain | -quiet   (on :root)
//   ground   --hc-window-tint | -strong, --hc-window-line
//   identity --acc → the seven window roles, taken DEEP under a bright look
//
// SEAMLESS. The editor has no border, no shadow and no frame of its own. Its
// ground is the page's own ground (`--md-surface`), laid translucent over a
// soft blur, so docked beside the hive it reads as more of the same surface —
// and over a drawn backdrop the backdrop carries straight through. Regions are
// told apart by TONE (a tint step), never by a line. Outside the tile's
// hexagon the picture fades into that same ground.
//
// Shape stays on the ladder (control 2 / card 3); only genuinely round things
// (a switch knob, the camera shutter) are round.

export const TILE_EDITOR_SURFACE = 'hc-tile-editor'
const STYLE_ID = 'hc-tile-editor-style'

/** The editor's identity: the gold its tiles' rims default to. */
export const EDITOR_ACCENT = '200, 151, 90'
/** The same gold taken deep for a bright look — `identity.deepen()`
 *  (lightness × 0.9 until WCAG luminance ≤ 0.12), restated because a module
 *  cannot import the SCSS function. */
export const EDITOR_ACCENT_DEEP = '116, 81, 39'

export function installTileEditorStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  const S = TILE_EDITOR_SURFACE
  style.textContent = `
${S}{position:fixed;inset:0;z-index:100002;pointer-events:none;display:block;}
${S} .te-panel [hidden]{display:none!important;}
${S} .te-notes,${S} .te-col{display:contents;}
${S} .te-notes > *{order:-1;}

/* ── THE PANE ──────────────────────────────────────────────────────────── */
${S} .te-panel{
  --acc:${EDITOR_ACCENT};
  --hc-window-accent:rgb(var(--acc));
  --hc-window-accent-quiet:rgb(var(--acc));
  --hc-window-wash:rgba(var(--acc),0.10);
  --hc-window-wash-strong:rgba(var(--acc),0.20);
  --hc-window-edge:rgba(var(--acc),0.28);
  --hc-window-edge-firm:rgba(var(--acc),0.62);
  --hc-window-on-accent:rgb(var(--hc-panel-pane,253,254,255));
  --te-ground:color-mix(in srgb, var(--md-surface,#0d151e) 90%, transparent);
  --te-outside:color-mix(in srgb, var(--md-surface,#0d151e) 84%, transparent);
  --te-raise:var(--hc-window-tint,rgba(128,128,128,0.06));
  --te-raise-strong:var(--hc-window-tint-strong,rgba(128,128,128,0.12));
  --te-rule:var(--hc-window-line,rgba(128,128,128,0.18));
  --te-ink:var(--hc-window-ink-loud,currentColor);
  --te-ink-plain:var(--hc-window-ink-plain,currentColor);
  --te-ink-quiet:var(--hc-window-ink-quiet,currentColor);
  --te-focus:color-mix(in srgb, rgb(var(--acc)) 72%, white);
  --te-read:var(--hc-read,var(--hc-font,system-ui,sans-serif));
  position:absolute;pointer-events:auto;box-sizing:border-box;
  display:flex;flex-direction:column;min-height:0;
  background:var(--te-ground);
  -webkit-backdrop-filter:blur(22px) saturate(1.05);backdrop-filter:blur(22px) saturate(1.05);
  color:var(--hc-panel-text,currentColor);
  font-family:var(--hc-mono,system-ui);
  font-size:calc(1rem * var(--hc-panel-scale,1));
  outline:none;
}
:is([data-theme="light"],[data-theme="honey"],[data-theme="bloom"],[data-theme="sherbet"]) ${S} .te-panel{--acc:${EDITOR_ACCENT_DEEP};}
@media (prefers-color-scheme: light){:root:not([data-theme]) ${S} .te-panel{--acc:${EDITOR_ACCENT_DEEP};}}

/* Docked beside the hive. The docked-panel primitive writes the width and the
   edge offset inline; this only fills the column below the header. */
${S} .te-panel[data-surface="dock"]{top:var(--hc-header-anchor,0px);bottom:0;right:0;width:400px;max-width:calc(100vw - 1rem);
  animation:te-fade 200ms var(--md-easing-standard,ease) both;}

/* A page on a phone: the whole height above the control bar, opaque, since
   there is no hive beside it to continue. */
${S} .te-panel[data-surface="page"]{--te-ground:var(--md-surface,#0d151e);
  left:var(--hc-controls-left,0px);right:0;top:0;
  bottom:max(calc(max(var(--hc-controls-bottom,0px), var(--hc-safe-bottom,0px)) + var(--hc-mobile-row-lift,0px)), var(--te-kb,0px));
  padding-top:var(--hc-safe-top,env(safe-area-inset-top,0px));
  padding-left:env(safe-area-inset-left,0px);
  padding-right:env(safe-area-inset-right,0px);
  -webkit-backdrop-filter:none;backdrop-filter:none;
  animation:te-rise 250ms cubic-bezier(.16,1,.3,1) both;}

/* The resize grip the docked-panel primitive puts on the inner edge. The
   editor has no border, so the grip carries its own quiet handle — there at
   rest so the edge can be found, firmer under the pointer — instead of a line
   down the whole side. */
${S} .te-panel > [data-hc-grip]::before{content:"";position:absolute;top:50%;left:3px;width:4px;height:2.75rem;
  transform:translateY(-50%);border-radius:999px;background:var(--te-ink-quiet);opacity:0.3;
  transition:opacity 150ms ease, height 150ms ease;}
${S} .te-panel > [data-hc-grip]:hover::before{opacity:0.75;height:3.5rem;}

@keyframes te-fade{from{opacity:0}to{opacity:1}}
@keyframes te-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}

/* ── HEADER ────────────────────────────────────────────────────────────── */
${S} .te-head{flex:0 0 auto;position:relative;display:flex;align-items:center;gap:0.25rem;
  min-height:2.875rem;box-sizing:border-box;padding:0.35rem 0.5rem 0.1rem 0.9rem;}
${S} .te-title{flex:1 1 auto;min-width:0;box-sizing:border-box;margin:0 0 0 -0.4em;padding:0.3em 0.4em;
  font:inherit;font-family:var(--te-read);font-size:1.02em;font-weight:500;letter-spacing:0.005em;
  color:var(--te-ink);background:transparent;border:0;border-radius:var(--hc-radius-control,2px);
  outline:none;text-overflow:ellipsis;transition:background-color 150ms ease, box-shadow 150ms ease;}
${S} .te-title::placeholder{color:var(--te-ink);opacity:1;}
${S} .te-title:hover{background:var(--te-raise);}
${S} .te-title:focus{background:var(--te-raise);box-shadow:inset 0 -1px 0 rgb(var(--acc));}
${S} .te-title[aria-invalid="true"]{box-shadow:inset 0 -1px 0 var(--hc-status-alert,#d9534f);}
${S} .te-portal{flex:0 0 auto;display:inline-flex;align-items:center;gap:0.25em;font-size:0.68em;letter-spacing:0.04em;
  color:var(--hc-window-accent);padding:0 0.4em;white-space:nowrap;}
${S} .te-portal .mat-sym{font-size:1.2em;}

${S} .te-icon-btn{appearance:none;border:0;margin:0;background:transparent;color:var(--te-ink-quiet);
  display:inline-grid;place-items:center;flex:0 0 auto;width:1.9rem;height:1.9rem;padding:0;font:inherit;
  border-radius:var(--hc-radius-control,2px);cursor:pointer;transition:color 150ms ease, background-color 150ms ease;}
${S} .te-icon-btn:hover:not(:disabled){color:var(--te-ink);background:var(--te-raise-strong);}
${S} .te-icon-btn:disabled{opacity:0.4;cursor:default;}
${S} .te-icon-btn[aria-pressed="true"]{color:var(--hc-window-accent);}
${S} .te-icon-btn .mat-sym{font-size:1.15rem;}

/* ── BODY ──────────────────────────────────────────────────────────────── */
${S} .te-body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;
  display:flex;flex-direction:column;gap:1.15rem;padding:0.2rem 0.9rem 1.1rem;
  scrollbar-width:thin;scrollbar-color:var(--te-rule) transparent;scroll-padding-bottom:var(--te-kb,0px);}

${S} .te-note{display:flex;align-items:center;gap:0.5rem;padding:0.45rem 0.35rem 0.45rem 0.65rem;
  background:var(--hc-window-wash);border-radius:var(--hc-radius-control,2px);
  font-family:var(--te-read);font-size:0.78em;line-height:1.4;color:var(--te-ink-plain);}
${S} .te-note > span{flex:1 1 auto;min-width:0;}
${S} .te-note[data-tone="alert"]{background:color-mix(in srgb, var(--hc-status-alert,#d9534f) 12%, transparent);color:var(--te-ink);}

/* ── THE PICTURE ───────────────────────────────────────────────────────── */
${S} .te-picture{display:flex;flex-direction:column;}
${S} .te-picture-tools{display:flex;flex-direction:column;gap:0.55rem;margin-top:-0.6rem;}
${S} .te-stage{position:relative;box-sizing:border-box;width:100%;max-width:min(100%, 54vh);aspect-ratio:1;margin:0 auto;
  overflow:hidden;border-radius:var(--hc-radius-card,3px);background:transparent;
  touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;
  cursor:grab;outline:none;contain:layout paint;}
${S} .te-stage[data-state="empty"],${S} .te-stage[data-state="loading"]{cursor:default;}
${S} .te-stage[data-gesture="pan"],${S} .te-stage[data-gesture="pinch"]{cursor:grabbing;}
${S} .te-stage:focus-visible{box-shadow:inset 0 0 0 1px var(--te-focus);}
${S} .te-stage[data-drop="true"]{box-shadow:inset 0 0 0 2px rgb(var(--acc));}
${S} .te-stage-picture{position:absolute;left:0;top:0;transform-origin:0 0;max-width:none;max-height:none;
  pointer-events:none;will-change:transform;-webkit-user-drag:none;}
${S} .te-look{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;}
${S} .te-look-outside{transition:fill-opacity 150ms ease;}
${S} .te-look[data-dragging="true"] .te-look-outside{fill-opacity:0.6;}
${S} .te-look-vignette,${S} .te-look-band,${S} .te-look-glow,${S} .te-look-bevel{transition:opacity 150ms ease;}
${S} .te-look-name{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2;
  color:var(--hc-window-on-scrim,rgba(255,255,255,0.96));
  font-family:var(--hc-tile-name-font,ui-monospace,"SF Mono",Menlo,Consolas,monospace);
  font-weight:var(--hc-tile-name-weight,400);letter-spacing:0.04em;transition:opacity 150ms ease;}

/* Empty: the tile's own ground, and a way to give it a picture. */
${S} .te-empty{position:absolute;inset:0;display:grid;grid-template-rows:1fr 2.6em 1fr;justify-items:center;
  pointer-events:none;color:var(--hc-window-on-scrim,rgba(255,255,255,0.96));text-align:center;}
${S} .te-empty-mark{align-self:end;margin-bottom:0.2em;font-size:1.9em;opacity:0.78;}
${S} .te-empty-tools{align-self:start;display:flex;flex-direction:column;align-items:center;gap:0.45em;margin-top:0.3em;}
${S} .te-empty-tools p{margin:0;font-family:var(--te-read);font-size:0.74em;color:var(--hc-window-on-scrim-quiet,rgba(255,255,255,0.82));}
${S} .te-empty-tools div{display:flex;gap:0.35em;pointer-events:auto;}
${S} .te-empty-btn{appearance:none;border:0;display:inline-flex;align-items:center;gap:0.35em;height:1.95rem;padding:0 0.8em;
  font:inherit;font-size:0.76em;color:var(--hc-window-on-scrim,rgba(255,255,255,0.96));
  background:rgba(255,255,255,0.14);border-radius:var(--hc-radius-control,2px);cursor:pointer;transition:background-color 150ms ease;}
${S} .te-empty-btn:hover{background:rgba(255,255,255,0.24);}
${S} .te-empty-btn .mat-sym{font-size:1.2em;}
${S} .te-stage[data-state="loading"] .te-empty-tools{visibility:hidden;}

/* Camera viewfinder, inside the stage, under the same hexagon. */
${S} .te-camera{position:absolute;inset:0;z-index:2;background:#000;display:flex;align-items:flex-end;justify-content:center;}
${S} .te-camera video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
${S} .te-camera-bar{position:relative;display:flex;align-items:center;gap:1.1rem;padding:0.7rem;}
${S} .te-camera .te-icon-btn{color:var(--hc-window-on-scrim,#fff);background:rgba(0,0,0,0.38);}
${S} .te-shutter{appearance:none;width:3.5rem;height:3.5rem;border-radius:50%;border:3px solid #fff;
  background:rgba(255,255,255,0.22);cursor:pointer;padding:0;}
${S} .te-shutter:active{background:rgb(var(--acc));}

/* ── STAGE TOOLS ───────────────────────────────────────────────────────── */
${S} .te-toolbar{display:flex;align-items:center;gap:0.5rem;min-height:2.2rem;}
${S} .te-segment{display:inline-flex;flex:0 0 auto;padding:2px;gap:2px;background:var(--te-raise);border-radius:var(--hc-radius-control,2px);}
${S} .te-segment button{appearance:none;border:0;margin:0;background:transparent;color:var(--te-ink-plain);font:inherit;
  font-size:0.76em;letter-spacing:0.02em;display:inline-flex;align-items:center;gap:0.3em;height:1.8rem;padding:0 0.6em;
  border-radius:var(--hc-radius-control,2px);cursor:pointer;transition:background-color 150ms ease, color 150ms ease;}
${S} .te-segment button .mat-sym{font-size:1.15em;}
${S} .te-segment button[aria-checked="true"]{background:var(--hc-window-wash-strong);color:var(--te-ink);}
${S} .te-segment button:disabled{opacity:0.45;cursor:default;}
${S} .te-zoom{flex:1 1 auto;display:flex;align-items:center;gap:0.1rem;min-width:0;}
${S} .te-zoom input[type="range"]{flex:1 1 auto;min-width:3rem;margin:0 0.2rem;height:1.8rem;background:transparent;accent-color:rgb(var(--acc));cursor:pointer;}
${S} .te-zoom input[type="range"]:disabled{opacity:0.45;cursor:default;}
${S} .te-readout{flex:0 0 auto;min-width:3.1em;text-align:right;font-size:0.72em;font-variant-numeric:tabular-nums;color:var(--te-ink-quiet);}

${S} .te-row{display:flex;align-items:center;gap:0.4rem;}
${S} .te-shapes{display:inline-flex;align-items:center;gap:0.1rem;}
${S} .te-twin{appearance:none;border:0;margin:0;background:transparent;padding:0.2rem 0.3rem;font:inherit;
  display:inline-flex;flex-direction:column;align-items:center;gap:0.25rem;cursor:pointer;
  color:var(--te-ink-quiet);font-size:0.62em;letter-spacing:0.05em;border-radius:var(--hc-radius-control,2px);
  transition:color 150ms ease, background-color 150ms ease;}
${S} .te-twin:hover{background:var(--te-raise);color:var(--te-ink-plain);}
${S} .te-twin-hex{display:block;background:var(--te-raise-strong) center/cover no-repeat;transition:opacity 150ms ease;}
${S} .te-twin[data-orientation="point-top"] .te-twin-hex{width:1.75rem;height:2.02rem;clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);}
${S} .te-twin[data-orientation="flat-top"] .te-twin-hex{width:2.02rem;height:1.75rem;clip-path:polygon(100% 50%,75% 100%,25% 100%,0% 50%,25% 0%,75% 0%);}
${S} .te-twin > span:last-child{position:relative;padding-bottom:3px;}
${S} .te-twin[aria-pressed="true"]{color:var(--te-ink);}
${S} .te-twin[aria-pressed="true"] > span:last-child::after{content:"";position:absolute;left:25%;right:25%;bottom:0;height:2px;background:rgb(var(--acc));}
${S} .te-sources{margin-left:auto;display:inline-flex;gap:0.05rem;}

/* ── FIELDS ────────────────────────────────────────────────────────────── */
${S} .te-section{display:flex;flex-direction:column;gap:0.45rem;}
${S} .te-section-head{margin:0 0 0.1rem;font-size:0.66rem;font-weight:500;letter-spacing:0.09em;text-transform:uppercase;color:var(--te-ink-quiet);}
${S} .te-field{display:grid;grid-template-columns:minmax(6.2rem,auto) minmax(0,1fr);align-items:center;column-gap:0.6rem;min-height:2.2rem;}
${S} .te-label{display:inline-flex;align-items:center;gap:0.45em;font-size:0.8em;color:var(--te-ink-plain);}
${S} .te-label .mat-sym{font-size:1.15em;color:var(--te-ink-quiet);}
${S} .te-control{display:flex;align-items:center;gap:0.35rem;min-width:0;}
${S} .te-input{flex:1 1 auto;min-width:0;box-sizing:border-box;height:2rem;margin:0;padding:0 0.6em;
  font:inherit;font-size:0.82em;color:var(--te-ink);background:var(--te-raise);border:0;
  border-radius:var(--hc-radius-control,2px);outline:none;box-shadow:inset 0 -1px 0 transparent;
  transition:background-color 150ms ease, box-shadow 150ms ease;}
${S} .te-input::placeholder{color:var(--te-ink-quiet);opacity:1;}
${S} .te-input:hover{background:var(--te-raise-strong);}
${S} .te-input:focus{background:var(--te-raise-strong);box-shadow:inset 0 -1px 0 rgb(var(--acc));}
${S} .te-input.te-hex{flex:0 1 6.6em;font-family:var(--hc-mono,ui-monospace,monospace);}
${S} .te-input[aria-invalid="true"]{box-shadow:inset 0 -1px 0 var(--hc-status-alert,#d9534f);}
${S} .te-link{font-family:var(--te-read);}
${S} .te-textarea{height:auto;min-height:3.6em;padding:0.5em 0.6em;line-height:1.45;resize:vertical;font-family:var(--te-read);}
${S} .te-swatch{position:relative;flex:0 0 auto;width:2rem;height:2rem;box-sizing:border-box;border-radius:var(--hc-radius-control,2px);
  background:var(--te-swatch,transparent);box-shadow:inset 0 0 0 1px var(--te-rule);overflow:hidden;cursor:pointer;}
${S} .te-swatch input{position:absolute;inset:-4px;width:calc(100% + 8px);height:calc(100% + 8px);opacity:0;cursor:pointer;border:0;padding:0;margin:0;}
${S} .te-chip{appearance:none;border:0;margin:0;background:transparent;color:var(--te-ink-quiet);font:inherit;font-size:0.72em;
  height:1.8rem;padding:0 0.55em;border-radius:var(--hc-radius-control,2px);cursor:pointer;white-space:nowrap;
  transition:color 150ms ease, background-color 150ms ease;}
${S} .te-chip:hover{color:var(--te-ink);background:var(--te-raise);}
${S} .te-swatch[data-unset="true"]{opacity:0.55;}
${S} .te-switch{appearance:none;border:0;margin:0;background:transparent;padding:0;display:inline-flex;align-items:center;gap:0.55rem;
  cursor:pointer;font:inherit;font-size:0.8em;color:var(--te-ink-plain);text-align:left;line-height:1.3;}
${S} .te-switch-track{position:relative;flex:0 0 auto;width:2.1rem;height:1.2rem;border-radius:999px;background:var(--te-raise-strong);transition:background-color 150ms ease;}
${S} .te-switch-knob{position:absolute;top:0.15rem;left:0.15rem;width:0.9rem;height:0.9rem;border-radius:50%;background:var(--te-ink-quiet);
  transition:transform 150ms ease, background-color 150ms ease;}
${S} .te-switch[aria-checked="true"] .te-switch-track{background:var(--hc-window-wash-strong);}
${S} .te-switch[aria-checked="true"] .te-switch-knob{transform:translateX(0.9rem);background:rgb(var(--acc));}
${S} .te-switch:disabled{opacity:0.5;cursor:default;}
${S} .te-hint{margin:0;font-family:var(--te-read);font-size:0.74em;line-height:1.45;color:var(--te-ink-quiet);}
${S} .te-hint[data-tone="warn"]{color:var(--hc-status-warn,#c98a1b);}
${S} .te-hint[data-tone="alert"]{color:var(--hc-status-alert,#d9534f);}

${S} .te-question{display:flex;flex-direction:column;gap:0.45rem;padding:0.5rem 0 0.15rem;}
${S} .te-question + .te-question{box-shadow:inset 0 1px 0 var(--te-rule);padding-top:0.75rem;}
${S} .te-question p{margin:0;font-family:var(--te-read);font-size:0.86em;line-height:1.45;color:var(--te-ink);}
${S} .te-question p.te-answer{color:var(--te-ink-plain);}
${S} .te-question .te-row{justify-content:flex-end;}

/* ── ACTIONS ───────────────────────────────────────────────────────────── */
${S} .te-actions{flex:0 0 auto;display:flex;align-items:center;justify-content:flex-end;gap:0.45rem;
  padding:0.55rem 0.9rem calc(0.6rem + var(--hc-safe-bottom,0px));}
${S} .te-btn{appearance:none;border:0;margin:0;font:inherit;font-size:0.82em;height:2.2rem;padding:0 1.05em;
  display:inline-flex;align-items:center;justify-content:center;gap:0.4em;white-space:nowrap;
  border-radius:var(--hc-radius-control,2px);cursor:pointer;background:transparent;color:var(--te-ink-plain);
  transition:background-color 150ms ease, color 150ms ease;}
${S} .te-btn:hover:not(:disabled){background:var(--te-raise-strong);color:var(--te-ink);}
${S} .te-btn-primary{background:rgb(var(--acc));color:var(--hc-window-on-accent);font-weight:600;min-width:5.5em;}
${S} .te-btn-primary:hover:not(:disabled){background:color-mix(in srgb, rgb(var(--acc)) 86%, var(--hc-panel-text,#000));color:var(--hc-window-on-accent);}
${S} .te-btn:disabled{opacity:0.6;cursor:default;}

${S} .te-panel button:focus-visible,${S} .te-swatch:focus-within,${S} .te-zoom input:focus-visible{outline:1px solid var(--te-focus);outline-offset:1px;}

/* ── PAGE (phone) ──────────────────────────────────────────────────────── */
${S} .te-panel[data-surface="page"] .te-head{min-height:3.5rem;padding:0.25rem 0.35rem;gap:0.1rem;}
${S} .te-panel[data-surface="page"] .te-title{margin-left:0;}
${S} .te-panel[data-surface="page"] .te-stage{max-width:min(100%, 44svh);}
${S} .te-panel[data-surface="page"][data-keyboard="true"] .te-stage{max-width:min(100%, 20svh);}
${S} .te-panel[data-surface="page"] .te-row{flex-wrap:wrap;}
${S} .te-panel[data-surface="page"] .te-sources{margin-left:0;}

@media (max-height: 449px) and (orientation: landscape){
  ${S} .te-panel[data-surface="page"] .te-body{flex-direction:row;align-items:flex-start;gap:1rem;}
  ${S} .te-panel[data-surface="page"] .te-col{display:flex;flex-direction:column;gap:1.15rem;min-width:0;}
  ${S} .te-panel[data-surface="page"] .te-col-stage{flex:0 0 auto;width:min(44%, calc(100svh - 5rem));position:sticky;top:0;}
  ${S} .te-panel[data-surface="page"] .te-col-fields{flex:1 1 auto;}
  ${S} .te-panel[data-surface="page"] .te-picture-tools{margin-top:0;}
  ${S} .te-panel[data-surface="page"] .te-stage{max-width:100%;}
}

/* ── TOUCH: thumb-sized targets, and fields that never trip iOS zoom ──── */
@media (pointer: coarse){
  ${S} .te-panel .te-icon-btn,${S} .te-panel .te-chip,${S} .te-panel .te-segment button,${S} .te-panel .te-twin{min-width:44px;min-height:44px;}
  ${S} .te-panel .te-btn,${S} .te-panel .te-empty-btn{min-height:48px;}
  ${S} .te-panel .te-input,${S} .te-panel .te-title{font-size:max(16px, 1em);min-height:44px;}
  ${S} .te-panel .te-swatch{width:44px;height:44px;}
  ${S} .te-panel .te-zoom input[type="range"]{height:44px;}
  ${S} .te-panel .te-switch{min-height:44px;}
}
${S} .te-panel[data-surface="page"] .te-icon-btn,${S} .te-panel[data-surface="page"] .te-chip,${S} .te-panel[data-surface="page"] .te-segment button,${S} .te-panel[data-surface="page"] .te-twin{min-width:44px;min-height:44px;}
${S} .te-panel[data-surface="page"] .te-input,${S} .te-panel[data-surface="page"] .te-title{font-size:max(16px, 1em);min-height:44px;}
${S} .te-panel[data-surface="page"] .te-btn{min-height:48px;}

@media (prefers-reduced-motion: reduce){
  ${S} .te-panel,${S} .te-panel *{transition:none!important;animation:none!important;}
}
`
  document.head.appendChild(style)
}
