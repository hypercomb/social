// keyboard-desk/desk/keyboard-desk.styles.ts
//
// THE DESK'S MATERIAL. The tile editor's desk, restated for a keyboard: the same
// box, header, list and labelled drawing, coloured by ROLE and never by colour
// (documentation/tool-window-colour-roles.md). The plate is the window tint and
// each cap is the pane, so a key reads as itself on every look. A binding is the
// diagram's underline — a 2px tick, not a wash across the board.
//
// Lighting changes fill, edge and ink, in 150ms. A press moves the cap 1px.
// Nothing pulses, and a label at rest is quiet ink, never a faded loud one.
// Radii stay on the 2/3/4px ladder.

import { EDITOR_ACCENT, EDITOR_ACCENT_DEEP } from '../../editor/tile-editor.styles.js'

export const KEYBOARD_DESK_SURFACE = 'hc-keyboard-desk'
const STYLE_ID = 'hc-keyboard-desk-style'

export function installKeyboardDeskStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  const S = KEYBOARD_DESK_SURFACE
  style.textContent = `
${S}{display:block;}
${S} .kb-panel [hidden]{display:none!important;}

/* ── THE DESK ──────────────────────────────────────────────────────────── */
${S} .kb-panel{
  --acc:${EDITOR_ACCENT};
  --hc-window-accent:rgb(var(--acc));
  --hc-window-wash:rgba(var(--acc),0.10);
  --hc-window-wash-strong:rgba(var(--acc),0.20);
  --hc-window-edge:rgba(var(--acc),0.28);
  --hc-window-edge-firm:rgba(var(--acc),0.62);
  --hc-window-on-accent:rgb(var(--hc-panel-pane,253,254,255));
  --kb-ground:var(--md-surface,#0d151e);
  --kb-raise:var(--hc-window-tint,rgba(128,128,128,0.06));
  --kb-raise-strong:var(--hc-window-tint-strong,rgba(128,128,128,0.12));
  --kb-ink-rgb:var(--hc-panel-ink,128,128,128);
  --kb-plate:color-mix(in srgb, var(--kb-ground) 93%, rgb(var(--kb-ink-rgb)));
  --kb-cap:color-mix(in srgb, var(--kb-ground) 84%, rgb(var(--kb-ink-rgb)));
  --kb-cap-hover:color-mix(in srgb, rgb(var(--acc)) 16%, var(--kb-ground));
  --kb-rule:var(--hc-window-line,rgba(128,128,128,0.18));
  --kb-rule-firm:var(--hc-window-line-firm,rgba(128,128,128,0.28));
  --kb-ink:var(--hc-window-ink-loud,currentColor);
  --kb-ink-plain:var(--hc-window-ink-plain,currentColor);
  --kb-ink-quiet:var(--hc-window-ink-quiet,currentColor);
  --kb-ink-faint:var(--hc-window-ink-faint,currentColor);
  --kb-focus:color-mix(in srgb, rgb(var(--acc)) 72%, white);
  --kb-read:var(--hc-read,var(--hc-font,system-ui,sans-serif));
  position:fixed;
  top:var(--hc-safe-top,0px);
  left:var(--hc-controls-left,0px)!important;
  right:max(var(--hc-inset-right,0px), var(--hc-controls-right,0px))!important;
  bottom:calc(max(var(--hc-controls-bottom,0px), var(--hc-safe-bottom,0px)) + var(--hc-mobile-row-lift,0px));
  width:auto!important;max-width:none!important;transform:none!important;
  z-index:60001;pointer-events:auto;box-sizing:border-box;
  display:flex;flex-direction:column;min-height:0;
  background:var(--kb-ground);
  color:var(--hc-panel-text,currentColor);
  font-family:var(--hc-mono,system-ui);
  font-size:calc(1rem * var(--hc-panel-scale,1));
  outline:none;
}
:is([data-theme="light"],[data-theme="honey"],[data-theme="bloom"],[data-theme="sherbet"],[data-theme="beehive"]) ${S} .kb-panel{--acc:${EDITOR_ACCENT_DEEP};}
@media (prefers-color-scheme: light){:root:not([data-theme]) ${S} .kb-panel{--acc:${EDITOR_ACCENT_DEEP};}}
${S} .kb-panel button:focus-visible{outline:2px solid var(--kb-focus);outline-offset:1px;}

/* ── HEADER ────────────────────────────────────────────────────────────── */
${S} .kb-head{flex:0 0 auto;position:relative;display:flex;align-items:center;gap:0.55em;
  height:2.75em;box-sizing:border-box;padding:0 0.5em 0 0.9em;box-shadow:inset 0 -1px 0 var(--kb-rule);}
${S} .kb-reading{font-family:var(--kb-read);font-size:1.02em;font-weight:500;color:var(--kb-ink);white-space:nowrap;}
${S} .kb-address{flex:0 1 auto;min-width:0;display:inline-flex;align-items:center;gap:0.28em;overflow:hidden;
  font-size:0.72em;color:var(--kb-ink-quiet);}
${S} .kb-address kbd{flex:0 0 auto;font:inherit;font-weight:600;color:var(--kb-ink);line-height:1.6;
  padding:0 0.42em;background:var(--kb-raise-strong);border-radius:var(--hc-radius-control,2px);}
${S} .kb-address-then{flex:0 0 auto;font-style:normal;color:var(--kb-ink-quiet);padding:0 0.08em;}
${S} .kb-grow{flex:1 1 auto;}
${S} .kb-btn{appearance:none;border:0;margin:0;font:inherit;font-size:0.82em;height:2.2em;padding:0 1.05em;
  display:inline-flex;align-items:center;justify-content:center;gap:0.4em;white-space:nowrap;
  border-radius:var(--hc-radius-control,2px);cursor:pointer;background:transparent;color:var(--kb-ink-plain);
  transition:background-color 150ms ease, color 150ms ease;}
${S} .kb-btn:hover:not(:disabled){background:var(--kb-raise-strong);color:var(--kb-ink);}
${S} .kb-btn[aria-pressed="true"]{background:var(--hc-window-wash-strong);color:var(--hc-window-accent);}
${S} .kb-btn-primary{background:rgb(var(--acc));color:var(--hc-window-on-accent);font-weight:600;min-width:5.5em;}
${S} .kb-btn-primary:hover:not(:disabled){background:color-mix(in srgb, rgb(var(--acc)) 86%, var(--hc-panel-text,#000));color:var(--hc-window-on-accent);}
${S} .kb-icon-btn{appearance:none;border:0;margin:0;background:transparent;color:var(--kb-ink-quiet);
  display:inline-grid;place-items:center;flex:0 0 auto;width:1.9em;height:1.9em;padding:0;font:inherit;
  border-radius:var(--hc-radius-control,2px);cursor:pointer;transition:color 150ms ease, background-color 150ms ease;}
${S} .kb-icon-btn:hover{color:var(--kb-ink);background:var(--kb-raise-strong);}
${S} .kb-icon-btn .mat-sym{font-size:1.15em;}

/* ── BODY ──────────────────────────────────────────────────────────────── */
${S} .kb-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:row;position:relative;}
${S} .kb-vp{flex:1 1 auto;min-width:0;min-height:0;position:relative;display:flex;flex-direction:column;justify-content:safe center;gap:0.9em;
  box-sizing:border-box;padding:0.75em 1.5em 1em;overflow:hidden;}
${S} .kb-tag{flex:0 0 auto;display:flex;align-items:center;gap:0.85em;min-height:1.7em;min-width:0;
  font-size:0.72em;letter-spacing:0.03em;color:var(--kb-ink-quiet);}
${S} .kb-meta{flex:0 1 auto;min-width:0;display:inline-flex;align-items:baseline;gap:0.4em;white-space:nowrap;overflow:hidden;}
${S} .kb-meta b{font-weight:500;color:var(--kb-ink-plain);}
${S} .kb-layers{flex:0 0 auto;display:inline-flex;align-items:center;gap:0.22em;}
${S} .kb-layer{appearance:none;border:0;margin:0;height:1.85em;padding:0 0.5em;font:inherit;font-size:0.92em;letter-spacing:0.04em;
  color:var(--kb-ink-quiet);background:transparent;outline:1px solid var(--kb-rule);outline-offset:-1px;
  border-radius:var(--hc-radius-control,2px);cursor:pointer;
  transition:background-color 150ms ease, color 150ms ease, outline-color 150ms ease;}
${S} .kb-layer:hover{color:var(--kb-ink);background:var(--kb-raise-strong);outline-color:var(--hc-window-edge);}
${S} .kb-layer[data-on]{background:rgb(var(--acc));color:var(--hc-window-on-accent);outline-color:transparent;}
${S} .kb-hint{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-family:var(--kb-read);letter-spacing:0;color:var(--kb-ink-quiet);text-align:right;}
${S} .kb-panel[data-adding] .kb-hint{color:var(--hc-window-accent);}
${S} .kb-hint[data-note="said"]{color:var(--hc-window-accent);}
${S} .kb-hint[data-note="alert"]{color:var(--hc-status-alert);}

/* ── THE LIST ──────────────────────────────────────────────────────────── */
${S} .kb-list{flex:0 0 auto;width:14.5em;display:flex;flex-direction:column;min-height:0;overflow:hidden;box-sizing:border-box;
  box-shadow:inset -1px 0 0 var(--kb-rule);}
${S} .kb-list-head{flex:0 0 auto;display:flex;align-items:center;gap:0.35em;height:2.6em;padding:0 0.7em 0 0.55em;box-sizing:border-box;}
${S} .kb-list-title{font-size:0.72em;letter-spacing:0.12em;text-transform:uppercase;color:var(--kb-ink-plain);font-weight:600;}
${S} .kb-back{appearance:none;border:0;background:transparent;color:var(--kb-ink-quiet);font:inherit;font-size:1.15em;line-height:1;
  width:1.7em;height:1.7em;display:inline-grid;place-items:center;padding:0;cursor:pointer;
  border-radius:var(--hc-radius-control,2px);transition:color 150ms ease, background-color 150ms ease;}
${S} .kb-back:hover{color:var(--kb-ink);background:var(--kb-raise-strong);}
${S} .kb-find,${S} .kb-script{flex:0 0 auto;box-sizing:border-box;height:2.05em;padding:0 0.65em;border:0;border-bottom:1px solid transparent;
  border-radius:var(--hc-radius-control,2px);background:var(--kb-raise);color:var(--kb-ink);font:inherit;font-size:0.8em;outline:none;
  transition:background-color 150ms ease, border-color 150ms ease;}
${S} .kb-find{margin:0 0.55em 0.45em;}
${S} .kb-find::placeholder,${S} .kb-script::placeholder{color:var(--kb-ink-quiet);}
${S} .kb-find:hover,${S} .kb-script:hover{background:var(--kb-raise-strong);}
${S} .kb-find:focus,${S} .kb-script:focus{background:var(--kb-raise-strong);border-bottom-color:rgb(var(--acc));}
${S} .kb-rows{flex:1 1 auto;min-height:0;overflow-y:auto;padding:0 0.4em 0.7em;display:flex;flex-direction:column;gap:0.08em;}
${S} .kb-row{appearance:none;border:0;margin:0;background:transparent;font:inherit;color:var(--kb-ink-plain);cursor:pointer;text-align:left;
  position:relative;display:flex;align-items:center;gap:0.6em;width:100%;min-height:2.45em;padding:0.2em 0.45em;box-sizing:border-box;
  border-radius:var(--hc-radius-control,2px);transition:background-color 150ms ease, color 150ms ease, box-shadow 150ms ease;}
${S} .kb-row:hover:not(:disabled){background:var(--kb-raise);}
${S} .kb-row:active:not(:disabled){background:var(--hc-window-wash);}
${S} .kb-row[data-chosen]{background:var(--hc-window-wash);box-shadow:inset 2px 0 0 var(--hc-window-accent);}
${S} .kb-row[data-chosen]:hover:not(:disabled){background:var(--hc-window-wash-strong);}
${S} .kb-row:disabled{cursor:default;color:var(--kb-ink-quiet);}
${S} .kb-row-face{flex:0 0 auto;display:grid;place-items:center;width:1.85em;height:1.85em;font-size:0.74em;font-weight:600;
  color:var(--kb-ink-quiet);background:var(--kb-raise);border-radius:var(--hc-radius-control,2px);
  transition:background-color 150ms ease, color 150ms ease;}
${S} .kb-row:hover:not(:disabled) .kb-row-face{color:var(--kb-ink-plain);background:var(--kb-raise-strong);}
${S} .kb-row[data-chosen] .kb-row-face{color:var(--hc-window-accent);background:var(--hc-window-wash-strong);}
${S} .kb-row-name{flex:1 1 auto;min-width:0;font-family:var(--kb-read);font-size:0.8em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
${S} .kb-row-end{flex:0 0 auto;max-width:6.5em;font-size:0.66em;font-variant-numeric:tabular-nums;color:var(--kb-ink-quiet);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

/* ── THE DRAWING: callouts over the board ──────────────────────────────── */
${S} .kb-drawing{flex:0 0 auto;position:relative;width:100%;max-width:calc((100dvh - 19em) * 2.92);align-self:center;
  display:flex;flex-direction:column;gap:1.15em;}
${S} .kb-leaders{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;}
${S} .kb-leader{fill:none;stroke:var(--kb-ink-quiet);stroke-width:1px;vector-effect:non-scaling-stroke;transition:stroke 150ms ease;}
${S} .kb-dot{fill:var(--kb-ground);stroke:var(--hc-window-accent);stroke-width:1.25px;vector-effect:non-scaling-stroke;}
${S} .kb-callouts{position:relative;display:flex;flex-wrap:wrap;justify-content:center;align-content:center;gap:0.45em;min-height:2.2em;}
${S} .kb-callout{position:relative;display:flex;align-items:center;gap:0.5em;height:2.2em;padding:0 0.35em 0 0.55em;box-sizing:border-box;max-width:24em;
  background:var(--kb-ground);outline:1px solid var(--kb-rule);border-radius:var(--hc-radius-floating,4px);font-size:0.76em;
  transition:outline-color 150ms ease, background-color 150ms ease;}
${S} .kb-callout:hover{outline-color:var(--hc-window-edge-firm);background:var(--hc-window-wash);}
${S} .kb-callout[data-mine]{outline-color:var(--hc-window-edge);background:var(--hc-window-wash);}
${S} .kb-callout[data-mine]::after{content:"";position:absolute;left:0.5em;right:0.5em;bottom:0;height:2px;background:var(--hc-window-accent);}
${S} .kb-callout-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--kb-ink);font-family:var(--kb-read);}
${S} .kb-keys{flex:0 0 auto;display:inline-flex;align-items:center;gap:0.18em;}
${S} .kb-keys i{font-style:normal;font-size:0.85em;color:var(--kb-ink-quiet);padding:0 0.15em;}
${S} .kb-keys kbd{font:inherit;font-weight:600;color:var(--kb-ink);line-height:1.5;padding:0 0.38em;background:var(--kb-raise-strong);border-radius:var(--hc-radius-control,2px);}
${S} .kb-off{appearance:none;border:0;background:transparent;color:var(--kb-ink-faint);font:inherit;font-size:1.05em;line-height:1;cursor:pointer;
  padding:0.15em 0.32em;border-radius:var(--hc-radius-control,2px);transition:color 150ms ease, background-color 150ms ease;}
${S} .kb-callout:hover .kb-off,${S} .kb-callout:focus-within .kb-off{color:var(--kb-ink-quiet);}
${S} .kb-off:hover{color:var(--kb-ink);background:var(--kb-raise-strong);}

/* ── THE BOARD ─────────────────────────────────────────────────────────── */
${S} .kb-board{position:relative;width:100%;container-type:inline-size;user-select:none;-webkit-user-select:none;}
${S} .kb-board::before{content:"";position:absolute;z-index:0;inset:-0.62em -0.42em;pointer-events:none;
  background:var(--kb-plate);border-radius:var(--hc-radius-floating,4px);outline:1px solid var(--kb-rule);outline-offset:-1px;
  transition:outline-color 150ms ease, background-color 150ms ease;}
${S} .kb-panel[data-adding] .kb-board::before{outline-color:var(--hc-window-edge-firm);background:var(--hc-window-wash);}
${S} .kb-cap{appearance:none;position:absolute;z-index:1;border:0;margin:0;padding:0.42cqw;background:transparent;box-sizing:border-box;
  cursor:pointer;color:inherit;font:inherit;}
${S} .kb-panel .kb-cap:focus-visible{outline:none;}
${S} .kb-face{position:relative;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:0.12em;width:100%;height:100%;
  box-sizing:border-box;overflow:hidden;padding:0.4cqw 0.42cqw;text-align:center;
  background:var(--kb-cap);outline:1px solid var(--kb-rule);outline-offset:-1px;
  box-shadow:inset 0 -1px 0 var(--kb-rule-firm);border-radius:var(--hc-radius-card,3px);
  transition:background-color 150ms ease, outline-color 150ms ease, box-shadow 150ms ease, transform 150ms ease;}
${S} .kb-face:has(.kb-legend:not(:empty)){justify-content:space-between;align-items:stretch;text-align:left;}
${S} .kb-label{font-size:calc(0.95cqw * var(--hc-panel-scale,1));line-height:1.05;color:var(--kb-ink-plain);
  transition:color 150ms ease;}
${S} .kb-legend:empty{display:none;}
${S} .kb-face:has(.kb-legend:not(:empty)) .kb-label{color:var(--kb-ink-quiet);}
${S} .kb-legend{font-family:var(--kb-read);font-size:calc(0.9cqw * var(--hc-panel-scale,1));font-weight:500;line-height:1.15;color:var(--kb-ink);
  overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere;
  transition:color 150ms ease;}
${S} .kb-cap:hover .kb-face{background:var(--kb-cap-hover);outline-color:var(--hc-window-edge-firm);}
${S} .kb-cap:hover .kb-label{color:var(--kb-ink);}
${S} .kb-cap:active .kb-face{transform:translateY(1px);box-shadow:none;}
${S} .kb-cap[data-bound="exact"] .kb-face{box-shadow:inset 0 -2px 0 var(--hc-window-edge-firm);}
${S} .kb-cap[data-bound="exact"] .kb-label,${S} .kb-cap[data-bound="mine"] .kb-label{color:var(--kb-ink-plain);}
${S} .kb-cap[data-bound="exact"]:hover .kb-label,${S} .kb-cap[data-bound="mine"]:hover .kb-label{color:var(--kb-ink);}
${S} .kb-cap[data-bound="loose"] .kb-legend{color:var(--kb-ink-quiet);}
${S} .kb-cap[data-bound="mine"] .kb-face{background:var(--kb-cap-hover);box-shadow:inset 0 -2px 0 var(--hc-window-accent);}
${S} .kb-cap[data-bound="mine"]:hover .kb-face{background:color-mix(in srgb, rgb(var(--acc)) 24%, var(--kb-ground));}
${S} .kb-cap[data-lit] .kb-face{outline:2px solid var(--hc-window-accent);outline-offset:-2px;background:var(--kb-cap-hover);}
${S} .kb-cap[data-selected] .kb-face,${S} .kb-cap[data-modifier][data-down] .kb-face{
  background:rgb(var(--acc));outline-color:rgb(var(--acc));box-shadow:none;}
${S} .kb-cap[data-selected] :is(.kb-label,.kb-legend),${S} .kb-cap[data-modifier][data-down] .kb-label{color:var(--hc-window-on-accent);}
${S} .kb-cap:focus-visible .kb-face{outline:2px solid var(--kb-focus);outline-offset:-2px;}

/* ── THE LINEUP ────────────────────────────────────────────────────────── */
${S} .kb-strip{flex:0 1 auto;min-height:0;max-height:34%;overflow-y:auto;box-shadow:inset 0 1px 0 var(--kb-rule);padding-top:0.85em;
  display:flex;flex-direction:column;gap:0.55em;}
${S} .kb-strip-head{flex:0 0 auto;font-size:0.72em;letter-spacing:0.12em;text-transform:uppercase;color:var(--kb-ink-plain);font-weight:600;}
${S} .kb-strip-head i{font-family:var(--kb-read);font-style:normal;font-weight:400;letter-spacing:0;text-transform:none;color:var(--kb-ink-quiet);margin-left:0.7em;}
${S} .kb-steps{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;row-gap:0.5em;column-gap:1.35em;margin:0;padding:0.1em 0;list-style:none;}
${S} .kb-steps:empty{display:none;}
${S} .kb-step{position:relative;display:inline-flex;align-items:center;gap:0.35em;min-height:2.15em;box-sizing:border-box;padding:0 0.2em 0 0.5em;max-width:26em;
  background:var(--kb-ground);outline:1px solid var(--hc-window-edge);outline-offset:-1px;border-radius:var(--hc-radius-card,3px);font-size:0.8em;
  transition:outline-color 150ms ease, background-color 150ms ease;}
${S} .kb-step:hover,${S} .kb-step:focus-within{outline-color:var(--hc-window-edge-firm);background:var(--hc-window-wash);}
${S} .kb-step + .kb-step::before{content:"";position:absolute;left:-1em;top:50%;width:0.62em;height:1px;background:var(--kb-rule-firm);}
${S} .kb-step-at{flex:0 0 auto;min-width:1.15em;font-size:0.75em;font-variant-numeric:tabular-nums;text-align:center;color:var(--hc-window-accent);font-weight:600;}
${S} .kb-step-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--kb-read);color:var(--kb-ink);}
${S} .kb-step-move{appearance:none;flex:0 0 auto;border:0;background:transparent;color:var(--kb-ink-faint);font:inherit;line-height:1;cursor:pointer;
  padding:0.2em 0.28em;border-radius:var(--hc-radius-control,2px);transition:color 150ms ease, background-color 150ms ease;}
${S} .kb-step:hover .kb-step-move,${S} .kb-step:focus-within .kb-step-move{color:var(--kb-ink-quiet);}
${S} .kb-step-move:hover:not(:disabled){color:var(--kb-ink);background:var(--kb-raise-strong);}
${S} .kb-step-move:disabled{visibility:hidden;}
${S} .kb-script{width:min(36em,100%);}

${S} .kb-live{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}

@media (max-width:720px){
  ${S} .kb-list{display:none;}
  ${S} .kb-vp{padding-inline:16px;}
  ${S} .kb-meta{display:none;}
}
@media (pointer:coarse){
  ${S} .kb-panel .kb-icon-btn{min-width:44px;min-height:44px;}
  ${S} .kb-panel .kb-btn{min-height:48px;}
  ${S} .kb-layer{min-height:44px;padding-inline:0.7em;}
}
@media (forced-colors:active){
  ${S} .kb-btn-primary,${S} .kb-layer[data-on],${S} .kb-cap[data-selected] .kb-face,${S} .kb-cap[data-modifier][data-down] .kb-face{
    background:Highlight;color:HighlightText;forced-color-adjust:none;}
  ${S} .kb-cap[data-selected] .kb-face,${S} .kb-cap[data-modifier][data-down] .kb-face,${S} .kb-cap[data-lit] .kb-face,
  ${S} .kb-cap[data-bound="exact"] .kb-face,${S} .kb-cap[data-bound="mine"] .kb-face{outline:2px solid Highlight;}
}
@media (prefers-reduced-motion:reduce){
  ${S} .kb-panel,${S} .kb-panel *{transition:none!important;}
  ${S} .kb-cap:active .kb-face{transform:none!important;}
}
`
  document.head.appendChild(style)
}
