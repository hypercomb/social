// meeting/lobby/meeting-lobby.styles.ts
//
// THE LOBBY'S MATERIAL. The tile editor's desk restated for this surface: the
// same box, header and buttons, coloured by ROLE and never by colour
// (documentation/tool-window-colour-roles.md). What is drawn is the participant
// themselves — one hexagon, cut exactly as the hive will cut their face — and a
// small 1+6 circle that fills as the others arrive. Lit things change only ink,
// ground and edge, in 150ms. Radii stay on the 2/3/4px ladder.

import { EDITOR_ACCENT, EDITOR_ACCENT_DEEP } from '../../editor/tile-editor.styles.js'

export const MEETING_LOBBY_SURFACE = 'hc-meeting-lobby'
const STYLE_ID = 'hc-meeting-lobby-style'

export function installMeetingLobbyStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  const S = MEETING_LOBBY_SURFACE
  style.textContent = `
${S}{display:block;}
${S} .ml-panel [hidden]{display:none!important;}

/* ── THE DESK ──────────────────────────────────────────────────────────── */
${S} .ml-panel{
  --acc:${EDITOR_ACCENT};
  --hc-window-accent:rgb(var(--acc));
  --hc-window-wash:rgba(var(--acc),0.10);
  --hc-window-wash-strong:rgba(var(--acc),0.20);
  --hc-window-edge:rgba(var(--acc),0.28);
  --hc-window-edge-firm:rgba(var(--acc),0.62);
  --hc-window-on-accent:rgb(var(--hc-panel-pane,253,254,255));
  --ml-ground:var(--md-surface,#0d151e);
  --ml-raise:var(--hc-window-tint,rgba(128,128,128,0.06));
  --ml-raise-strong:var(--hc-window-tint-strong,rgba(128,128,128,0.12));
  --ml-rule:var(--hc-window-line,rgba(128,128,128,0.18));
  --ml-ink:var(--hc-window-ink-loud,currentColor);
  --ml-ink-plain:var(--hc-window-ink-plain,currentColor);
  --ml-ink-quiet:var(--hc-window-ink-quiet,currentColor);
  --ml-focus:color-mix(in srgb, rgb(var(--acc)) 72%, white);
  --ml-read:var(--hc-read,var(--hc-font,system-ui,sans-serif));
  position:fixed;
  top:var(--hc-safe-top,0px);
  left:var(--hc-controls-left,0px)!important;
  right:max(var(--hc-inset-right,0px), var(--hc-controls-right,0px))!important;
  bottom:calc(max(var(--hc-controls-bottom,0px), var(--hc-safe-bottom,0px)) + var(--hc-mobile-row-lift,0px));
  width:auto!important;max-width:none!important;transform:none!important;
  z-index:60001;pointer-events:auto;box-sizing:border-box;
  display:flex;flex-direction:column;min-height:0;
  background:var(--ml-ground);
  color:var(--hc-panel-text,currentColor);
  font-family:var(--hc-mono,system-ui);
  font-size:calc(1rem * var(--hc-panel-scale,1));
  outline:none;
}
:is([data-theme="light"],[data-theme="honey"],[data-theme="bloom"],[data-theme="sherbet"],[data-theme="beehive"]) ${S} .ml-panel{--acc:${EDITOR_ACCENT_DEEP};}
@media (prefers-color-scheme: light){:root:not([data-theme]) ${S} .ml-panel{--acc:${EDITOR_ACCENT_DEEP};}}
${S} .ml-panel button:focus-visible,${S} .ml-panel select:focus-visible{outline:2px solid var(--ml-focus);outline-offset:1px;}

/* ── HEADER ────────────────────────────────────────────────────────────── */
${S} .ml-head{flex:0 0 auto;position:relative;display:flex;align-items:center;gap:0.5em;
  height:2.75em;box-sizing:border-box;padding:0 0.5em 0 0.9em;box-shadow:inset 0 -1px 0 var(--ml-rule);}
${S} .ml-reading{flex:0 1 auto;min-width:0;font-family:var(--ml-read);font-size:1.02em;font-weight:500;color:var(--ml-ink);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
${S} .ml-address{flex:0 1 auto;min-width:0;font-size:0.72em;color:var(--ml-ink-quiet);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
${S} .ml-grow{flex:1 1 auto;}
${S} .ml-icon-btn{appearance:none;border:0;margin:0;background:transparent;color:var(--ml-ink-quiet);
  display:inline-grid;place-items:center;flex:0 0 auto;width:1.9em;height:1.9em;padding:0;font:inherit;
  border-radius:var(--hc-radius-control,2px);cursor:pointer;transition:color 150ms ease, background-color 150ms ease;}
${S} .ml-icon-btn:hover:not(:disabled){color:var(--ml-ink);background:var(--ml-raise-strong);}
${S} .ml-icon-btn .mat-sym{font-size:1.15em;}

${S} .ml-btn{appearance:none;border:0;margin:0;font:inherit;font-size:0.82em;height:2.2em;padding:0 1.05em;
  display:inline-flex;align-items:center;justify-content:center;gap:0.4em;white-space:nowrap;
  border-radius:var(--hc-radius-control,2px);cursor:pointer;background:transparent;color:var(--ml-ink-plain);
  transition:background-color 150ms ease, color 150ms ease;}
${S} .ml-btn:hover:not(:disabled){background:var(--ml-raise-strong);color:var(--ml-ink);}
${S} .ml-btn-primary{background:rgb(var(--acc));color:var(--hc-window-on-accent);font-weight:600;min-width:6.5em;}
${S} .ml-btn-primary:hover:not(:disabled){background:color-mix(in srgb, rgb(var(--acc)) 86%, var(--hc-panel-text,#000));color:var(--hc-window-on-accent);}
${S} .ml-btn:disabled{cursor:default;opacity:0.5;}

/* ── BODY: the picture, and what shapes it ─────────────────────────────── */
${S} .ml-body{flex:1 1 auto;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(18em,26em);}
${S} .ml-stage{position:relative;min-width:0;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:1em;padding:1.2em;box-sizing:border-box;overflow:hidden;}
${S} .ml-side{min-width:0;min-height:0;overflow-y:auto;overscroll-behavior:contain;box-sizing:border-box;
  display:flex;flex-direction:column;gap:1.3em;padding:1.2em 1.1em;box-shadow:inset 1px 0 0 var(--ml-rule);}

/* The face, cut as the hive cuts it: a pointy-top hexagon. The ring is the same
   hexagon one step larger, behind it, so the edge is drawn by the shape and not
   by a border a clip-path would cut away. */
${S} .ml-hex-ring{--ml-cut:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);
  position:relative;flex:0 1 auto;height:min(100%,34em);max-height:100%;aspect-ratio:0.866;max-width:100%;box-sizing:border-box;
  padding:2px;background:var(--hc-window-edge-firm);clip-path:var(--ml-cut);transition:background-color 150ms ease;}
${S} .ml-hex-ring[data-state="live"]{background:rgb(var(--acc));}
${S} .ml-hex{position:relative;width:100%;height:100%;clip-path:var(--ml-cut);background:var(--ml-raise-strong);overflow:hidden;}
${S} .ml-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000;opacity:0;transition:opacity 250ms ease;}
${S} .ml-hex-ring[data-state="live"] .ml-video{opacity:1;}

/* What the hexagon says when it has no picture to show. */
${S} .ml-say{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.7em;
  padding:18% 14%;box-sizing:border-box;text-align:center;color:var(--ml-ink-plain);}
${S} .ml-say-mark{font-size:2.2em;color:var(--ml-ink-quiet);}
${S} .ml-say-text{margin:0;font-family:var(--ml-read);font-size:0.86em;line-height:1.45;overflow-wrap:anywhere;}
${S} .ml-hex-ring[data-state="asking"] .ml-say-mark{animation:ml-breathe 1.6s ease-in-out infinite;}
@keyframes ml-breathe{0%,100%{opacity:0.35;}50%{opacity:1;}}

${S} .ml-caption{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:0.2em;text-align:center;max-width:100%;}
${S} .ml-title{margin:0;font-family:var(--ml-read);font-size:1.15em;font-weight:500;color:var(--ml-ink);}
${S} .ml-sub{margin:0;font-size:0.74em;color:var(--ml-ink-quiet);}

/* ── SETTINGS ──────────────────────────────────────────────────────────── */
${S} .ml-field{display:flex;flex-direction:column;gap:0.45em;min-width:0;}
${S} .ml-label{font-size:0.7em;letter-spacing:0.08em;text-transform:uppercase;color:var(--ml-ink-quiet);}
${S} .ml-select{appearance:none;width:100%;box-sizing:border-box;height:2.4em;padding:0 2em 0 0.8em;font:inherit;font-size:0.82em;
  color:var(--ml-ink);background:var(--ml-raise) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23888' stroke-width='1.5'/%3E%3C/svg%3E") no-repeat right 0.8em center;
  border:0;border-radius:var(--hc-radius-control,2px);cursor:pointer;text-overflow:ellipsis;transition:background-color 150ms ease;}
${S} .ml-select:hover:not(:disabled){background-color:var(--ml-raise-strong);}
${S} .ml-select:disabled{cursor:default;opacity:0.5;}

${S} .ml-meter{position:relative;height:0.4em;border-radius:var(--hc-radius-control,2px);background:var(--ml-raise-strong);overflow:hidden;}
${S} .ml-meter-fill{position:absolute;inset:0;transform-origin:left center;transform:scaleX(0);background:rgb(var(--acc));}

/* Three choices in one row: the lit one is the accent, the rest are quiet. */
${S} .ml-choices{display:grid;grid-template-columns:repeat(3,1fr);gap:2px;padding:2px;background:var(--ml-raise);border-radius:var(--hc-radius-card,3px);}
${S} .ml-choice{appearance:none;border:0;margin:0;font:inherit;font-size:0.8em;height:2.3em;padding:0 0.4em;cursor:pointer;
  color:var(--ml-ink-plain);background:transparent;border-radius:var(--hc-radius-control,2px);
  transition:background-color 150ms ease, color 150ms ease;}
${S} .ml-choice:hover{background:var(--ml-raise-strong);color:var(--ml-ink);}
${S} .ml-choice[aria-checked="true"]{background:rgb(var(--acc));color:var(--hc-window-on-accent);font-weight:600;}
${S} .ml-hint{margin:0;font-size:0.72em;line-height:1.45;color:var(--ml-ink-quiet);}

/* ── FOOT: who is here, and the way in ─────────────────────────────────── */
${S} .ml-foot{flex:0 0 auto;display:flex;align-items:center;gap:0.9em;min-height:3.4em;box-sizing:border-box;padding:0.5em 0.7em 0.5em 1em;
  box-shadow:inset 0 1px 0 var(--ml-rule);}
${S} .ml-circle{flex:0 0 auto;width:3em;height:3em;overflow:visible;}
${S} .ml-circle .ml-seat{fill:none;stroke:var(--ml-ink-quiet);stroke-width:1;transition:fill 150ms ease, stroke 150ms ease;}
${S} .ml-circle .ml-seat[data-filled="true"]{fill:rgb(var(--acc));stroke:rgb(var(--acc));}
${S} .ml-here{display:flex;flex-direction:column;gap:0.15em;min-width:0;}
${S} .ml-here-count{font-family:var(--ml-read);font-size:0.9em;color:var(--ml-ink);}
${S} .ml-here-note{font-size:0.72em;color:var(--ml-ink-quiet);}

${S} .ml-live{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}

/* ── NARROW: the same DOM, one column ──────────────────────────────────── */
${S} .ml-panel[data-layout="narrow"] .ml-body{display:flex;flex-direction:column;overflow-y:auto;overscroll-behavior:contain;}
${S} .ml-panel[data-layout="narrow"] .ml-stage{flex:0 0 auto;padding:1em 1em 0.4em;}
${S} .ml-panel[data-layout="narrow"] .ml-hex-ring{height:min(46vh,22em);}
${S} .ml-panel[data-layout="narrow"] .ml-side{overflow:visible;box-shadow:none;padding:0.8em 1em 1.2em;}
${S} .ml-panel[data-layout="narrow"] .ml-address{display:none;}

/* ── TOUCH: thumb-sized targets, and fields that never trip iOS zoom ──── */
@media (pointer: coarse){
  ${S} .ml-panel .ml-icon-btn{min-width:44px;min-height:44px;}
  ${S} .ml-panel .ml-btn,${S} .ml-panel .ml-choice{min-height:48px;}
  ${S} .ml-panel .ml-select{font-size:max(16px, 1em);min-height:44px;}
}
${S} .ml-panel[data-layout="narrow"] .ml-icon-btn{min-width:44px;min-height:44px;}
${S} .ml-panel[data-layout="narrow"] .ml-btn,${S} .ml-panel[data-layout="narrow"] .ml-choice{min-height:48px;}
${S} .ml-panel[data-layout="narrow"] .ml-select{font-size:max(16px, 1em);min-height:44px;}

@media (forced-colors: active){
  ${S} .ml-btn-primary,${S} .ml-choice[aria-checked="true"]{background:Highlight;color:HighlightText;forced-color-adjust:none;}
  ${S} .ml-hex-ring{background:CanvasText;}
}
@media (prefers-reduced-motion: reduce){
  ${S} .ml-panel,${S} .ml-panel *{transition:none!important;animation:none!important;}
}
`
  document.head.appendChild(style)
}
