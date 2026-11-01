// keyboard-desk/desk/keyboard-desk.styles.ts
//
// THE DESK'S MATERIAL. The tile editor's desk restated for this surface: the same
// box, header, list and labelled drawing, coloured by ROLE and never by colour
// (documentation/tool-window-colour-roles.md). Lit things change only ink, ground
// and edge, in 150ms. Radii stay on the 2/3/4px ladder.

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
  --kb-rule:var(--hc-window-line,rgba(128,128,128,0.18));
  --kb-ink:var(--hc-window-ink-loud,currentColor);
  --kb-ink-plain:var(--hc-window-ink-plain,currentColor);
  --kb-ink-quiet:var(--hc-window-ink-quiet,currentColor);
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
${S} .kb-head{flex:0 0 auto;position:relative;display:flex;align-items:center;gap:0.5em;
  height:2.75em;box-sizing:border-box;padding:0 0.5em 0 0.9em;box-shadow:inset 0 -1px 0 var(--kb-rule);}
${S} .kb-reading{font-family:var(--kb-read);font-size:1.02em;font-weight:500;color:var(--kb-ink);white-space:nowrap;}
${S} .kb-address{flex:0 1 auto;min-width:0;font-size:0.72em;color:var(--kb-ink-quiet);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
${S} .kb-grow{flex:1 1 auto;}
${S} .kb-btn{appearance:none;border:0;margin:0;font:inherit;font-size:0.82em;height:2.2em;padding:0 1.05em;
  display:inline-flex;align-items:center;justify-content:center;gap:0.4em;white-space:nowrap;
  border-radius:var(--hc-radius-control,2px);cursor:pointer;background:transparent;color:var(--kb-ink-plain);
  transition:background-color 150ms ease, color 150ms ease;}
${S} .kb-btn:hover:not(:disabled){background:var(--kb-raise-strong);color:var(--kb-ink);}
${S} .kb-btn-primary{background:rgb(var(--acc));color:var(--hc-window-on-accent);font-weight:600;min-width:5.5em;}
${S} .kb-btn-primary:hover:not(:disabled){background:color-mix(in srgb, rgb(var(--acc)) 86%, var(--hc-panel-text,#000));color:var(--hc-window-on-accent);}
${S} .kb-icon-btn{appearance:none;border:0;margin:0;background:transparent;color:var(--kb-ink-quiet);
  display:inline-grid;place-items:center;flex:0 0 auto;width:1.9em;height:1.9em;padding:0;font:inherit;
  border-radius:var(--hc-radius-control,2px);cursor:pointer;transition:color 150ms ease, background-color 150ms ease;}
${S} .kb-icon-btn:hover{color:var(--kb-ink);background:var(--kb-raise-strong);}
${S} .kb-icon-btn .mat-sym{font-size:1.15em;}

/* ── BODY ──────────────────────────────────────────────────────────────── */
${S} .kb-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:row;position:relative;}
${S} .kb-vp{flex:1 1 auto;min-width:0;min-height:0;position:relative;display:flex;flex-direction:column;gap:0.6em;
  box-sizing:border-box;padding:0.6em 1.4em 0.8em;overflow:hidden;}
${S} .kb-tag{flex:0 0 auto;font-size:0.68em;letter-spacing:0.03em;color:var(--kb-ink-quiet);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
${S} .kb-tag b{font-weight:400;color:var(--kb-ink-plain);}

/* ── THE LIST ──────────────────────────────────────────────────────────── */
${S} .kb-list{flex:0 0 auto;width:14.5em;display:flex;flex-direction:column;min-height:0;overflow:hidden;box-sizing:border-box;
  box-shadow:inset -1px 0 0 var(--kb-rule);}
${S} .kb-list-head{flex:0 0 auto;display:flex;align-items:center;gap:0.4em;height:2.6em;padding:0 0.9em;box-sizing:border-box;}
${S} .kb-list-title{font-size:0.72em;letter-spacing:0.12em;text-transform:uppercase;color:var(--kb-ink-plain);font-weight:600;}
${S} .kb-back{appearance:none;border:0;background:transparent;color:var(--kb-ink-quiet);font:inherit;font-size:1.2em;cursor:pointer;padding:0 0.3em;}
${S} .kb-back:hover{color:var(--kb-ink);}
${S} .kb-find{flex:0 0 auto;margin:0 0.6em 0.4em;height:2em;box-sizing:border-box;padding:0 0.6em;border:0;
  outline:1px solid var(--kb-rule);border-radius:var(--hc-radius-control,2px);background:transparent;color:var(--kb-ink);font:inherit;font-size:0.8em;}
${S} .kb-find:focus{outline-color:var(--hc-window-edge-firm);}
${S} .kb-rows{flex:1 1 auto;min-height:0;overflow-y:auto;padding:0 0.4em 0.6em;display:flex;flex-direction:column;gap:0.1em;}
${S} .kb-row{appearance:none;border:0;margin:0;background:transparent;font:inherit;color:var(--kb-ink-plain);cursor:pointer;text-align:left;
  display:flex;align-items:center;gap:0.6em;width:100%;min-height:2.5em;padding:0.2em 0.45em;box-sizing:border-box;
  border-radius:var(--hc-radius-control,2px);outline:1px solid transparent;outline-offset:-1px;transition:background-color 150ms ease, outline-color 150ms ease;}
${S} .kb-row:hover:not(:disabled){background:var(--kb-raise);}
${S} .kb-row[data-chosen]{background:var(--hc-window-wash);outline-color:var(--hc-window-edge-firm);}
${S} .kb-row:disabled{cursor:default;}
${S} .kb-row-face{flex:0 0 auto;display:grid;place-items:center;width:2em;height:2em;font-size:0.8em;font-weight:600;
  color:var(--hc-window-accent);background:var(--kb-raise-strong);border-radius:var(--hc-radius-control,2px);}
${S} .kb-row-name{flex:1 1 auto;min-width:0;font-size:0.8em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
${S} .kb-row-end{flex:0 0 auto;max-width:6em;font-size:0.66em;color:var(--kb-ink-quiet);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

/* ── THE DRAWING: callouts over the board ──────────────────────────────── */
${S} .kb-drawing{flex:0 0 auto;position:relative;width:100%;max-width:calc((100dvh - 19em) * 2.92);align-self:center;display:flex;flex-direction:column;gap:1.1em;}
${S} .kb-leaders{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;}
${S} .kb-leader{fill:none;stroke:var(--hc-window-edge-firm);stroke-width:1px;vector-effect:non-scaling-stroke;}
${S} .kb-dot{fill:var(--hc-window-accent);}
${S} .kb-callouts{position:relative;display:flex;flex-wrap:wrap;justify-content:center;gap:0.5em;min-height:2.2em;}
${S} .kb-callout{display:flex;align-items:center;gap:0.5em;height:2.2em;padding:0 0.4em 0 0.6em;box-sizing:border-box;max-width:24em;
  background:var(--kb-ground);outline:1px solid var(--hc-window-edge);border-radius:var(--hc-radius-card,3px);font-size:0.76em;transition:outline-color 150ms ease;}
${S} .kb-callout:hover{outline-color:var(--hc-window-edge-firm);}
${S} .kb-callout[data-mine]{outline-color:var(--hc-window-accent);}
${S} .kb-callout-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--kb-ink-plain);font-family:var(--kb-read);}
${S} .kb-keys{flex:0 0 auto;display:inline-flex;align-items:center;gap:0.2em;}
${S} .kb-keys i{font-style:normal;font-size:0.85em;color:var(--kb-ink-quiet);padding:0 0.2em;}
${S} .kb-keys kbd{font:inherit;font-weight:600;color:var(--kb-ink);padding:0.05em 0.35em;background:var(--kb-raise-strong);border-radius:var(--hc-radius-control,2px);}
${S} .kb-off{appearance:none;border:0;background:transparent;color:var(--kb-ink-quiet);font:inherit;font-size:1.1em;line-height:1;cursor:pointer;padding:0.1em 0.3em;border-radius:var(--hc-radius-control,2px);}
${S} .kb-off:hover{color:var(--kb-ink);background:var(--kb-raise-strong);}

/* ── THE BOARD ─────────────────────────────────────────────────────────── */
${S} .kb-board{position:relative;width:100%;container-type:inline-size;}
${S} .kb-cap{appearance:none;position:absolute;border:0;margin:0;padding:0.16cqw;background:transparent;box-sizing:border-box;cursor:pointer;color:inherit;font:inherit;}
${S} .kb-face{display:flex;flex-direction:column;justify-content:space-between;gap:0.1em;width:100%;height:100%;box-sizing:border-box;overflow:hidden;
  padding:0.32cqw 0.4cqw;text-align:left;background:var(--kb-raise);outline:1px solid var(--kb-rule);outline-offset:-1px;
  border-radius:var(--hc-radius-card,3px);transition:background-color 150ms ease, outline-color 150ms ease;}
${S} .kb-label{font-size:calc(0.92cqw * var(--hc-panel-scale,1));line-height:1.1;color:var(--kb-ink-quiet);}
${S} .kb-legend{font-family:var(--kb-read);font-size:calc(0.84cqw * var(--hc-panel-scale,1));line-height:1.12;color:var(--kb-ink);
  overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere;}
${S} .kb-cap:hover .kb-face{outline-color:var(--hc-window-edge-firm);}
${S} .kb-cap[data-bound="exact"] .kb-face{background:var(--hc-window-wash);outline-color:var(--hc-window-edge);}
${S} .kb-cap[data-bound="exact"] .kb-label{color:var(--kb-ink-plain);}
${S} .kb-cap[data-bound="loose"] .kb-legend{color:var(--kb-ink-quiet);}
${S} .kb-cap[data-bound="mine"] .kb-face{background:var(--hc-window-wash-strong);outline-color:var(--hc-window-accent);}
${S} .kb-cap[data-bound="mine"] .kb-label{color:var(--kb-ink);}
${S} .kb-cap[data-lit] .kb-face{outline:2px solid var(--hc-window-accent);outline-offset:-2px;}
${S} .kb-cap[data-selected] .kb-face{background:var(--hc-window-accent);outline-color:var(--hc-window-accent);}
${S} .kb-cap[data-selected] :is(.kb-label,.kb-legend){color:var(--hc-window-on-accent);}
${S} .kb-cap[data-modifier] .kb-face{background:transparent;}
${S} .kb-cap[data-modifier][data-down] .kb-face{background:var(--hc-window-accent);outline-color:var(--hc-window-accent);}
${S} .kb-cap[data-modifier][data-down] .kb-label{color:var(--hc-window-on-accent);}

/* ── THE LINEUP ────────────────────────────────────────────────────────── */
${S} .kb-strip{flex:1 1 auto;min-height:0;overflow-y:auto;box-shadow:0 -1px 0 var(--kb-rule);padding-top:0.7em;display:flex;flex-direction:column;gap:0.6em;}
${S} .kb-strip-head{flex:0 0 auto;font-size:0.72em;letter-spacing:0.12em;text-transform:uppercase;color:var(--kb-ink-plain);font-weight:600;}
${S} .kb-strip-head i{font-style:normal;font-weight:400;letter-spacing:0;text-transform:none;color:var(--kb-ink-quiet);margin-left:0.6em;}
${S} .kb-steps{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;row-gap:0.5em;column-gap:1.3em;margin:0;padding:0;list-style:none;}
${S} .kb-steps:empty{display:none;}
${S} .kb-step{position:relative;display:inline-flex;align-items:center;gap:0.35em;min-height:2.2em;box-sizing:border-box;padding:0 0.25em 0 0.55em;max-width:26em;
  background:var(--kb-raise);outline:1px solid var(--hc-window-edge);outline-offset:-1px;border-radius:var(--hc-radius-card,3px);font-size:0.8em;transition:outline-color 150ms ease;}
${S} .kb-step:hover,${S} .kb-step:focus-within{outline-color:var(--hc-window-edge-firm);}
${S} .kb-step + .kb-step::before{content:'›';position:absolute;left:-1em;color:var(--kb-ink-quiet);}
${S} .kb-step-at{flex:0 0 auto;font-size:0.8em;color:var(--hc-window-accent);font-weight:600;}
${S} .kb-step-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--kb-ink);}
${S} .kb-step-move{appearance:none;flex:0 0 auto;border:0;background:transparent;color:var(--kb-ink-quiet);font:inherit;line-height:1;cursor:pointer;padding:0.15em 0.3em;border-radius:var(--hc-radius-control,2px);}
${S} .kb-step-move:hover:not(:disabled){color:var(--kb-ink);background:var(--kb-raise-strong);}
${S} .kb-step-move:disabled{visibility:hidden;}
${S} .kb-script{flex:0 0 auto;height:2.1em;box-sizing:border-box;padding:0 0.6em;border:0;width:min(36em,100%);
  outline:1px solid var(--kb-rule);border-radius:var(--hc-radius-control,2px);background:transparent;color:var(--kb-ink);font:inherit;font-size:0.8em;}
${S} .kb-script:focus{outline-color:var(--hc-window-edge-firm);}

${S} .kb-live{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}

@media (max-width:720px){
  ${S} .kb-list{display:none;}
  ${S} .kb-vp{padding-inline:16px;}
}
@media (pointer:coarse){
  ${S} .kb-panel .kb-icon-btn{min-width:44px;min-height:44px;}
  ${S} .kb-panel .kb-btn{min-height:48px;}
}
@media (forced-colors:active){
  ${S} .kb-btn-primary{background:Highlight;color:HighlightText;forced-color-adjust:none;}
  ${S} .kb-cap[data-selected] .kb-face,${S} .kb-cap[data-modifier][data-down] .kb-face{outline:2px solid Highlight;}
}
@media (prefers-reduced-motion:reduce){
  ${S} .kb-panel,${S} .kb-panel *{transition:none!important;}
}
`
  document.head.appendChild(style)
}
