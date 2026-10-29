// editor/tile-editor.styles.ts
//
// THE DESK'S MATERIAL — one stylesheet, installed once, scoped to the surface's
// tag. A module cannot `@use` the shared SCSS, so the shell's vocabulary is
// restated here by ROLE, never by colour (documentation/tool-window-colour-roles.md):
//
//   ink      --hc-window-ink-loud | -plain | -quiet   (on :root)
//   ground   --hc-window-tint | -strong, --hc-window-line
//   identity --acc → the window roles, taken DEEP under a bright look
//
// This sheet owns the ROOT: the roles, the desk box, the header, the notices,
// the list host, the leave prompt, and the art under the participant's hands
// (the stage, the look overlay, the empty state, the camera). The drawing's own
// furniture — tabs, cards, leaders, the lit layer — is diagram/diagram.styles.ts.
//
// THE DESK is the Notes and Chat box: one opaque surface, no border, no shadow,
// no blur — nothing is behind it. The shell's rail (and the tools row) stay
// OUTSIDE the box, by the same variables the chat desk reads. Shape stays on the
// ladder (control 2 / card 3 / floating 4); only genuinely round things (the
// camera shutter) are round.

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
${S}{display:block;}
${S} .te-panel [hidden]{display:none!important;}

/* ── THE DESK ──────────────────────────────────────────────────────────── */
${S} .te-panel{
  --acc:${EDITOR_ACCENT};
  --hc-window-accent:rgb(var(--acc));
  --hc-window-accent-quiet:rgb(var(--acc));
  --hc-window-wash:rgba(var(--acc),0.10);
  --hc-window-wash-strong:rgba(var(--acc),0.20);
  --hc-window-edge:rgba(var(--acc),0.28);
  --hc-window-edge-firm:rgba(var(--acc),0.62);
  --hc-window-on-accent:rgb(var(--hc-panel-pane,253,254,255));
  --te-ground:var(--md-surface,#0d151e);
  --te-raise:var(--hc-window-tint,rgba(128,128,128,0.06));
  --te-raise-strong:var(--hc-window-tint-strong,rgba(128,128,128,0.12));
  --te-rule:var(--hc-window-line,rgba(128,128,128,0.18));
  --te-ink:var(--hc-window-ink-loud,currentColor);
  --te-ink-plain:var(--hc-window-ink-plain,currentColor);
  --te-ink-quiet:var(--hc-window-ink-quiet,currentColor);
  --te-focus:color-mix(in srgb, rgb(var(--acc)) 72%, white);
  --te-read:var(--hc-read,var(--hc-font,system-ui,sans-serif));
  position:fixed;
  top:var(--hc-safe-top,0px);
  left:var(--hc-controls-left,0px)!important;
  right:max(var(--hc-inset-right,0px), var(--hc-controls-right,0px))!important;
  bottom:calc(max(var(--hc-controls-bottom,0px), var(--hc-safe-bottom,0px)) + var(--hc-mobile-row-lift,0px));
  width:auto!important;max-width:none!important;transform:none!important;
  z-index:60001;pointer-events:auto;box-sizing:border-box;
  display:flex;flex-direction:column;min-height:0;
  background:var(--md-surface,#0d151e);
  color:var(--hc-panel-text,currentColor);
  font-family:var(--hc-mono,system-ui);
  font-size:calc(1rem * var(--hc-panel-scale,1));
  outline:none;
}
:is([data-theme="light"],[data-theme="honey"],[data-theme="bloom"],[data-theme="sherbet"],[data-theme="beehive"]) ${S} .te-panel{--acc:${EDITOR_ACCENT_DEEP};}
/* The shared list draws its home mark in its own amber, which is a dark-pane colour: on a bright ground it is 1.6:1. The editor reads it in its quiet ink. */
${S} .hc-rail-back.root{color:var(--hc-window-ink-quiet);}
@media (prefers-color-scheme: light){:root:not([data-theme]) ${S} .te-panel{--acc:${EDITOR_ACCENT_DEEP};}}

/* ── HEADER ────────────────────────────────────────────────────────────── */
${S} .te-head{flex:0 0 auto;position:relative;display:flex;align-items:center;gap:0.5em;
  height:2.75em;box-sizing:border-box;padding:0 0.5em 0 0.9em;
  box-shadow:inset 0 -1px 0 var(--te-rule);}
${S} .te-reading{flex:0 1 auto;min-width:0;font-family:var(--te-read);font-size:1.02em;font-weight:500;color:var(--te-ink);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
${S} .te-address{flex:0 1 auto;min-width:0;font-size:0.72em;color:var(--te-ink-quiet);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
${S} .te-portal{flex:0 0 auto;display:inline-flex;align-items:center;gap:0.3em;font-size:0.7em;letter-spacing:0.04em;
  color:var(--hc-window-accent);white-space:nowrap;}
${S} .te-portal .mat-sym{font-size:1.2em;}
${S} .te-grow{flex:1 1 auto;}
${S} .te-state{flex:0 0 auto;display:inline-flex;align-items:center;gap:0.4em;font-size:0.72em;color:var(--te-ink-quiet);}
${S} .te-state .te-dot{width:0.55em;height:0.55em;box-sizing:border-box;border-radius:50%;background:transparent;box-shadow:inset 0 0 0 1px currentColor;}
${S} .te-state[data-state="dirty"] .te-dot{background:rgb(var(--acc));box-shadow:none;}
${S} .te-state[data-state="clean"] .te-dot{display:none;}

${S} .te-icon-btn{appearance:none;border:0;margin:0;background:transparent;color:var(--te-ink-quiet);
  display:inline-grid;place-items:center;flex:0 0 auto;width:1.9em;height:1.9em;padding:0;font:inherit;
  border-radius:var(--hc-radius-control,2px);cursor:pointer;transition:color 150ms ease, background-color 150ms ease;}
${S} .te-icon-btn:hover:not(:disabled){color:var(--te-ink);background:var(--te-raise-strong);}
${S} .te-icon-btn:disabled{cursor:default;color:var(--te-ink-quiet);}
${S} .te-icon-btn .mat-sym{font-size:1.15em;}
${S} .te-drawer-toggle{display:none;}

${S} .te-btn{appearance:none;border:0;margin:0;font:inherit;font-size:0.82em;height:2.2em;padding:0 1.05em;
  display:inline-flex;align-items:center;justify-content:center;gap:0.4em;white-space:nowrap;
  border-radius:var(--hc-radius-control,2px);cursor:pointer;background:transparent;color:var(--te-ink-plain);
  transition:background-color 150ms ease, color 150ms ease;}
${S} .te-btn:hover:not(:disabled){background:var(--te-raise-strong);color:var(--te-ink);}
${S} .te-btn-primary{background:rgb(var(--acc));color:var(--hc-window-on-accent);font-weight:600;min-width:5.5em;}
${S} .te-btn-primary:hover:not(:disabled){background:color-mix(in srgb, rgb(var(--acc)) 86%, var(--hc-panel-text,#000));color:var(--hc-window-on-accent);}
${S} .te-btn:disabled{cursor:default;}

/* Another tile was chosen while this one has unsaved changes. The header asks in
   place of Cancel and Save, as an overlay under it — never in flow. */
${S} .te-leave{position:absolute;top:100%;right:0.5em;z-index:7;box-sizing:border-box;width:min(26em, calc(100% - 1em));
  display:flex;flex-direction:column;gap:0.6em;padding:0.8em 0.9em;background:var(--md-surface,#0d151e);
  outline:1px solid var(--hc-window-edge-firm);border-radius:var(--hc-radius-floating,4px);}
${S} .te-leave-question{margin:0;font-family:var(--te-read);font-size:0.82em;line-height:1.45;color:var(--te-ink);overflow-wrap:anywhere;}
${S} .te-leave-choices{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:0.45em;}

/* ── BODY: the list, and the viewport the drawing lives in ──────────────── */
${S} .te-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:row;position:relative;}
${S} .te-list{flex:0 0 auto;display:flex;flex-direction:column;min-height:0;min-width:0;overflow:hidden;box-sizing:border-box;
  background:var(--md-surface,#0d151e);box-shadow:inset -1px 0 0 var(--te-rule);}
${S} .te-panel[data-list="full"] .te-list{width:14.5em;}
${S} .te-panel[data-list="mid"] .te-list{width:11.5em;}
${S} .te-panel[data-list="faces"] .te-list{width:3.7em;}
${S} .te-panel[data-list="faces"] .te-list .hc-rail-head,${S} .te-panel[data-list="faces"] .te-list .hc-rail-name{display:none;}
${S} .te-scrim{display:none;}
${S} .te-vp{flex:1 1 auto;min-width:0;min-height:0;position:relative;overflow:hidden;background:var(--md-surface,#0d151e);}
${S} .te-figure{position:absolute;left:0;top:0;}
/* A viewport-sized box is the vp itself: the home adds none of its own. */
${S} .te-toolbar-home{display:contents;}

/* Notices: an overlay at the top of the viewport, never in flow, so the tile
   never resizes when one appears. */
${S} .te-notices{position:absolute;top:0.5em;left:50%;transform:translateX(-50%);z-index:6;width:calc(100% - 1em);max-width:36em;
  display:flex;flex-direction:column;gap:0.4em;pointer-events:none;}
${S} .te-note{pointer-events:auto;display:flex;align-items:center;gap:0.5em;padding:0.45em 0.35em 0.45em 0.65em;
  background:var(--md-surface,#0d151e);outline:1px solid var(--hc-window-edge);border-radius:var(--hc-radius-control,2px);
  font-family:var(--te-read);font-size:0.78em;line-height:1.4;color:var(--te-ink-plain);}
${S} .te-note > span{flex:1 1 auto;min-width:0;}
${S} .te-note[data-tone="alert"]{outline-color:var(--hc-status-alert,#d9534f);color:var(--te-ink);}
${S} .te-chip{appearance:none;border:0;margin:0;background:transparent;color:var(--te-ink-quiet);font:inherit;font-size:0.92em;
  height:1.8em;padding:0 0.55em;border-radius:var(--hc-radius-control,2px);cursor:pointer;white-space:nowrap;
  transition:color 150ms ease, background-color 150ms ease;}
${S} .te-chip:hover{color:var(--te-ink);background:var(--te-raise);}

/* Reachable by keyboard, seen only when it has focus. */
${S} .te-skip{position:absolute;left:0.5em;top:0.3em;z-index:9;transform:translateY(-300%);appearance:none;border:0;font:inherit;font-size:0.8em;
  padding:0.4em 0.8em;color:var(--hc-window-on-accent);background:rgb(var(--acc));border-radius:var(--hc-radius-control,2px);}
${S} .te-skip:focus{transform:none;}
${S} .te-live{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}

/* ── THE ART UNDER THE HANDS ───────────────────────────────────────────── */
${S} .te-stage{position:absolute;inset:0;box-sizing:border-box;width:100%;height:100%;overflow:visible;
  touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;
  cursor:grab;outline:none;contain:layout paint;}
${S} .te-stage[data-state="empty"],${S} .te-stage[data-state="loading"]{cursor:default;}
${S} .te-stage[data-gesture="pan"],${S} .te-stage[data-gesture="pinch"]{cursor:grabbing;}
${S} .te-stage:focus-visible{outline:2px solid var(--te-focus);outline-offset:1px;}
${S} .te-stage[data-drop="true"]{outline:2px dashed rgb(var(--acc));outline-offset:-2px;}
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
/* The name is the in-place input (a group's band label is the diagram's own
   element), so the overlay's own text stays out of the way. */
${S} .te-look-name{visibility:hidden;}

/* The one in-place name input; the diagram places it and gives it its affordance. */
:where(${S} .te-figure > .te-title){margin:0;padding:0;border:0;outline:0;background:transparent;box-sizing:border-box;
  text-align:center;text-overflow:ellipsis;font-family:var(--hc-tile-name-font,ui-monospace,"SF Mono",Menlo,Consolas,monospace);
  color:var(--hc-window-on-scrim,rgba(255,255,255,0.96));letter-spacing:0.04em;}

/* Empty: the tile's own ground, and a way to give it a picture. */
${S} .te-empty{position:absolute;inset:0;display:grid;grid-template-rows:1fr 2.6em 1fr;justify-items:center;
  pointer-events:none;color:var(--hc-window-on-scrim,rgba(255,255,255,0.96));text-align:center;}
${S} .te-empty-mark{align-self:end;margin-bottom:0.2em;font-size:1.9em;opacity:0.78;}
${S} .te-empty-tools{align-self:start;display:flex;flex-direction:column;align-items:center;gap:0.45em;margin-top:0.3em;max-width:68%;}
${S} .te-empty-tools p{margin:0;font-family:var(--te-read);font-size:0.74em;color:var(--hc-window-on-scrim-quiet,rgba(255,255,255,0.82));}
${S} .te-empty-tools div{display:flex;gap:0.35em;pointer-events:auto;}
${S} .te-empty-btn{appearance:none;border:0;display:inline-flex;align-items:center;gap:0.35em;height:1.95em;padding:0 0.8em;
  font:inherit;font-size:0.76em;color:var(--hc-window-on-scrim,rgba(255,255,255,0.96));
  background:rgba(255,255,255,0.14);border-radius:var(--hc-radius-control,2px);cursor:pointer;transition:background-color 150ms ease;}
${S} .te-empty-btn:hover{background:rgba(255,255,255,0.24);}
${S} .te-empty-btn .mat-sym{font-size:1.2em;}
${S} .te-stage[data-state="loading"] .te-empty-tools{visibility:hidden;}

/* Camera viewfinder, inside the stage; the view clips it to the model's mask. */
${S} .te-camera{position:absolute;inset:0;z-index:2;background:#000;display:flex;align-items:flex-end;justify-content:center;}
${S} .te-camera video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
${S} .te-camera-bar{position:relative;display:flex;align-items:center;gap:1.1em;padding:0.7em;}
${S} .te-camera .te-icon-btn{color:var(--hc-window-on-scrim,#fff);background:rgba(0,0,0,0.38);}
${S} .te-shutter{appearance:none;width:3.5em;height:3.5em;border-radius:50%;border:3px solid #fff;
  background:rgba(255,255,255,0.22);cursor:pointer;padding:0;}
${S} .te-shutter:active{background:rgb(var(--acc));}

${S} .te-panel button:focus-visible{outline:2px solid var(--te-focus);outline-offset:1px;}

/* ── NARROW: the same DOM, rearranged ──────────────────────────────────── */
${S} .te-panel[data-layout="narrow"] .te-drawer-toggle{display:inline-grid;}
${S} .te-panel[data-layout="narrow"] .te-address,${S} .te-panel[data-layout="narrow"] .te-portal{display:none;}
${S} .te-panel[data-layout="narrow"] .te-list{display:none;position:absolute;left:0;top:0;bottom:0;z-index:5;width:min(18em, 86%);}
${S} .te-panel[data-layout="narrow"][data-drawer] .te-list{display:flex;}
${S} .te-panel[data-layout="narrow"][data-drawer] .te-scrim{display:block;position:absolute;inset:0;z-index:4;background:rgba(0,0,0,0.45);}
${S} .te-panel[data-layout="narrow"] .te-vp{overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;
  padding:0 max(16px, env(safe-area-inset-right,0px)) var(--te-kb,0px) max(16px, env(safe-area-inset-left,0px));scroll-padding-bottom:var(--te-kb,0px);}
${S} .te-panel[data-layout="narrow"] .te-figure{position:sticky;top:0;left:auto;margin:0 auto;z-index:3;background:var(--md-surface,#0d151e);}

/* ── TOUCH: thumb-sized targets, and fields that never trip iOS zoom ──── */
@media (pointer: coarse){
  ${S} .te-panel .te-icon-btn,${S} .te-panel .te-chip{min-width:44px;min-height:44px;}
  ${S} .te-panel .te-btn,${S} .te-panel .te-empty-btn{min-height:48px;}
  ${S} .te-panel .te-title{font-size:max(16px, 1em);min-height:44px;}
}
${S} .te-panel[data-layout="narrow"] .te-icon-btn,${S} .te-panel[data-layout="narrow"] .te-chip{min-width:44px;min-height:44px;}
${S} .te-panel[data-layout="narrow"] .te-btn{min-height:48px;}
${S} .te-panel[data-layout="narrow"] .te-title{font-size:max(16px, 1em);}

@media (forced-colors: active){
  ${S} .te-btn-primary{background:Highlight;color:HighlightText;forced-color-adjust:none;}
  ${S} .te-leave,${S} .te-note{outline-color:CanvasText;}
}
@media (prefers-reduced-motion: reduce){
  ${S} .te-panel,${S} .te-panel *{transition:none!important;animation:none!important;}
}
`
  document.head.appendChild(style)
}
