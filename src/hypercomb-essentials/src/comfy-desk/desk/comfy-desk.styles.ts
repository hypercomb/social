// comfy-desk/desk/comfy-desk.styles.ts
//
// THE DESK'S MATERIAL. The tile editor's box restated for this surface, coloured
// by ROLE and never by colour (documentation/tool-window-colour-roles.md). The
// tabs, cards, leaders and lit layer are not here: they are the editor's own
// (editor/diagram/diagram.styles.ts). Lit things change only ink, ground and
// edge, in 150ms. Radii stay on the 2/3/4px ladder.

import { EDITOR_ACCENT, EDITOR_ACCENT_DEEP } from '../../editor/tile-editor.styles.js'

export const COMFY_DESK_SURFACE = 'hc-comfy-desk'
const STYLE_ID = 'hc-comfy-desk-style'

export function installComfyDeskStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  const S = COMFY_DESK_SURFACE
  style.textContent = `
${S}{display:block;}
${S} .cd-panel [hidden]{display:none!important;}

/* ── THE DESK ──────────────────────────────────────────────────────────── */
${S} .cd-panel{
  --acc:${EDITOR_ACCENT};
  --hc-window-accent:rgb(var(--acc));
  --hc-window-wash:rgba(var(--acc),0.10);
  --hc-window-wash-strong:rgba(var(--acc),0.20);
  --hc-window-edge:rgba(var(--acc),0.28);
  --hc-window-edge-firm:rgba(var(--acc),0.62);
  --hc-window-on-accent:rgb(var(--hc-panel-pane,253,254,255));
  --cd-ground:var(--md-surface,#0d151e);
  --cd-raise:var(--hc-window-tint,rgba(128,128,128,0.06));
  --cd-raise-strong:var(--hc-window-tint-strong,rgba(128,128,128,0.12));
  --cd-rule:var(--hc-window-line,rgba(128,128,128,0.18));
  --cd-ink:var(--hc-window-ink-loud,currentColor);
  --cd-ink-plain:var(--hc-window-ink-plain,currentColor);
  --cd-ink-quiet:var(--hc-window-ink-quiet,currentColor);
  --cd-read:var(--hc-read,var(--hc-font,system-ui,sans-serif));
  --te-focus:color-mix(in srgb, rgb(var(--acc)) 72%, white);
  position:fixed;
  top:var(--hc-safe-top,0px);
  left:var(--hc-controls-left,0px)!important;
  right:max(var(--hc-inset-right,0px), var(--hc-controls-right,0px))!important;
  bottom:calc(max(var(--hc-controls-bottom,0px), var(--hc-safe-bottom,0px)) + var(--hc-mobile-row-lift,0px));
  width:auto!important;max-width:none!important;transform:none!important;
  z-index:60001;pointer-events:auto;box-sizing:border-box;
  display:flex;flex-direction:column;min-height:0;
  background:var(--cd-ground);
  color:var(--hc-panel-text,currentColor);
  font-family:var(--hc-mono,system-ui);
  font-size:calc(1rem * var(--hc-panel-scale,1));
  outline:none;
}
:is([data-theme="light"],[data-theme="honey"],[data-theme="bloom"],[data-theme="sherbet"],[data-theme="beehive"]) ${S} .cd-panel{--acc:${EDITOR_ACCENT_DEEP};}
@media (prefers-color-scheme: light){:root:not([data-theme]) ${S} .cd-panel{--acc:${EDITOR_ACCENT_DEEP};}}
${S} .cd-panel button:focus-visible{outline:2px solid var(--te-focus);outline-offset:1px;}

/* ── HEADER ────────────────────────────────────────────────────────────── */
${S} .cd-head{flex:0 0 auto;position:relative;display:flex;align-items:center;gap:0.5em;
  height:2.75em;box-sizing:border-box;padding:0 0.5em 0 0.9em;box-shadow:inset 0 -1px 0 var(--cd-rule);}
${S} .cd-reading{flex:0 0 auto;font-family:var(--cd-read);font-size:1.02em;font-weight:500;color:var(--cd-ink);white-space:nowrap;}
${S} .cd-address{flex:0 1 auto;min-width:0;font-size:0.72em;color:var(--cd-ink-quiet);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
${S} .cd-grow{flex:1 1 auto;}
${S} .cd-state{flex:0 1 auto;min-width:0;font-size:0.72em;color:var(--cd-ink-quiet);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
${S} .cd-btn{appearance:none;border:0;margin:0;font:inherit;font-size:0.82em;height:2.2em;padding:0 1.05em;
  display:inline-flex;align-items:center;justify-content:center;gap:0.4em;white-space:nowrap;
  border-radius:var(--hc-radius-control,2px);cursor:pointer;background:transparent;color:var(--cd-ink-plain);
  transition:background-color 150ms ease, color 150ms ease;}
${S} .cd-btn:hover:not(:disabled){background:var(--cd-raise-strong);color:var(--cd-ink);}
${S} .cd-btn-primary{background:rgb(var(--acc));color:var(--hc-window-on-accent);font-weight:600;min-width:6.5em;}
${S} .cd-btn-primary:hover:not(:disabled){background:color-mix(in srgb, rgb(var(--acc)) 86%, var(--hc-panel-text,#000));color:var(--hc-window-on-accent);}
${S} .cd-icon-btn{appearance:none;border:0;margin:0;background:transparent;color:var(--cd-ink-quiet);
  display:inline-grid;place-items:center;flex:0 0 auto;width:1.9em;height:1.9em;padding:0;font:inherit;
  border-radius:var(--hc-radius-control,2px);cursor:pointer;transition:color 150ms ease, background-color 150ms ease;}
${S} .cd-icon-btn:hover{color:var(--cd-ink);background:var(--cd-raise-strong);}
${S} .cd-icon-btn .mat-sym{font-size:1.15em;}

/* ── BODY ──────────────────────────────────────────────────────────────── */
${S} .cd-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:row;position:relative;}
${S} .cd-vp{flex:1 1 auto;min-width:0;min-height:0;position:relative;overflow:hidden;background:var(--cd-ground);}
${S} .cd-tag{position:absolute;left:0.9em;top:0.7em;right:0.9em;z-index:2;font-size:0.68em;letter-spacing:0.03em;color:var(--cd-ink-quiet);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;}
${S} .cd-notices{position:absolute;top:2em;left:50%;transform:translateX(-50%);z-index:7;width:calc(100% - 2em);max-width:36em;pointer-events:none;}
${S} .cd-note-bar{pointer-events:auto;padding:0.45em 0.65em;background:var(--cd-ground);outline:1px solid var(--hc-status-alert,#d9534f);
  border-radius:var(--hc-radius-control,2px);font-family:var(--cd-read);font-size:0.78em;line-height:1.4;color:var(--cd-ink);}

/* ── THE LIST ──────────────────────────────────────────────────────────── */
${S} .cd-list{flex:0 0 auto;width:14.5em;display:flex;flex-direction:column;min-height:0;overflow:hidden;box-sizing:border-box;
  background:var(--cd-ground);box-shadow:inset -1px 0 0 var(--cd-rule);}
${S} .cd-shelf{flex:1 1 auto;display:flex;flex-direction:column;min-height:0;}
${S} .cd-rail{flex:1 1 auto;display:none;flex-direction:column;min-height:0;}
${S} .cd-panel[data-choosing] .cd-shelf{display:none;}
${S} .cd-panel[data-choosing] .cd-rail{display:flex;}
${S} .hc-rail-back.root{color:var(--hc-window-ink-quiet);}
${S} .cd-list-head{flex:0 0 auto;display:flex;align-items:center;height:2.6em;padding:0 0.9em;box-sizing:border-box;}
${S} .cd-list-title{font-size:0.72em;letter-spacing:0.12em;text-transform:uppercase;color:var(--cd-ink-plain);font-weight:600;}
${S} .cd-find{flex:0 0 auto;margin:0 0.6em 0.4em;height:2em;box-sizing:border-box;padding:0 0.6em;border:0;
  outline:1px solid var(--cd-rule);border-radius:var(--hc-radius-control,2px);background:transparent;color:var(--cd-ink);font:inherit;font-size:0.8em;}
${S} .cd-find:focus{outline-color:var(--hc-window-edge-firm);}
/* A contact sheet: two faces across, the name under each. */
${S} .cd-rows{flex:1 1 auto;min-height:0;overflow-y:auto;padding:0.2em 0.6em 0.8em;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0.6em 0.5em;align-content:start;}
${S} .cd-cell-wrap{position:relative;min-width:0;}
${S} .cd-cell{appearance:none;border:0;margin:0;padding:0;background:transparent;font:inherit;color:var(--cd-ink-quiet);cursor:pointer;text-align:left;
  display:flex;flex-direction:column;gap:0.3em;width:100%;min-width:0;border-radius:var(--hc-radius-control,2px);}
${S} .cd-face{display:grid;place-items:center;width:100%;aspect-ratio:1;object-fit:cover;box-sizing:border-box;
  background:var(--cd-raise);outline:1px solid var(--cd-rule);outline-offset:-1px;border-radius:var(--hc-radius-card,3px);
  transition:outline-color 150ms ease, background-color 150ms ease;}
${S} .cd-face-fresh{color:var(--cd-ink-quiet);font-size:1.4em;outline-style:dashed;}
${S} .cd-cell:hover .cd-face{outline-color:var(--hc-window-edge-firm);}
${S} .cd-cell:hover{color:var(--cd-ink-plain);}
${S} .cd-cell[data-chosen] .cd-face{outline:2px solid var(--hc-window-accent);outline-offset:-2px;}
${S} .cd-cell[data-chosen]{color:var(--cd-ink);}
${S} .cd-cell-fresh[data-chosen] .cd-face{background:var(--hc-window-wash);color:var(--hc-window-accent);}
${S} .cd-cell-name{display:block;width:100%;min-width:0;padding:0 0.1em;font-size:0.72em;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
${S} .cd-row-hide{position:absolute;right:0.25em;top:0.25em;visibility:hidden;background:var(--cd-ground);color:var(--cd-ink-plain);}
${S} .cd-cell-wrap:hover .cd-row-hide,${S} .cd-row-hide:focus-visible{visibility:visible;}
${S} .cd-folder-strip{flex:0 0 auto;max-height:30%;overflow-y:auto;display:grid;grid-template-columns:repeat(4,1fr);gap:0.2em;padding:0 0.5em;}
${S} .cd-folder-strip:empty{display:none;}
${S} .cd-thumb{appearance:none;aspect-ratio:1;padding:0;overflow:hidden;background:var(--cd-raise);border:1px solid var(--hc-window-edge);
  border-radius:var(--hc-radius-control,2px);cursor:pointer;}
${S} .cd-thumb:hover{border-color:var(--hc-window-edge-firm);}
${S} .cd-thumb img{display:block;width:100%;height:100%;object-fit:cover;}
${S} .cd-hidden{flex:0 0 auto;max-height:30%;overflow-y:auto;padding:0.4em 0.9em;box-shadow:inset 0 1px 0 var(--cd-rule);font-size:0.72em;color:var(--cd-ink-quiet);}
${S} .cd-hidden summary{cursor:pointer;}
${S} .cd-hidden-row{display:flex;align-items:center;gap:0.4em;}

/* ── THE DRAWING: the picture, in its own shape ────────────────────────── */
/* The editor's dimension mark reads its roles from the drawing it sits in; this figure supplies them. */
${S} .cd-figure{position:absolute;left:0;top:0;z-index:1;--dg-iq:var(--cd-ink-quiet);--dg-ip:var(--cd-ink-plain);--dg-ground:var(--cd-ground);}
${S} .cd-picture{position:absolute;inset:0;box-sizing:border-box;overflow:hidden;background:var(--cd-raise);container-type:inline-size;
  outline:1px solid var(--cd-rule);outline-offset:-1px;border-radius:var(--hc-radius-card,3px);transition:outline-color 150ms ease, background-color 150ms ease;}
${S} .cd-picture[data-empty]{cursor:text;}
${S} .cd-picture[data-empty]:hover{background:var(--cd-raise-strong);}
${S} .cd-picture[data-lit="soft"]{outline-color:var(--hc-window-edge-firm);}
${S} .cd-picture[data-lit="strong"]{outline:2px solid var(--hc-window-accent);outline-offset:-2px;}
${S} .cd-image{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;user-select:none;-webkit-user-drag:none;}
/* The words in hand, read where the picture will be. */
${S} .cd-words-preview{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(78%, 30em);max-height:80%;overflow:hidden;margin:0;
  text-align:center;font-family:var(--cd-read);font-size:clamp(0.95em, 2.4cqw, 1.3em);line-height:1.5;color:var(--cd-ink-plain);pointer-events:none;overflow-wrap:anywhere;}
${S} .cd-words-preview[data-ghost]{color:var(--cd-ink-quiet);}
${S} .cd-picture[data-busy] .cd-words-preview{color:var(--cd-ink-quiet);}
${S} .cd-look-btn{position:absolute;right:0.4em;top:0.4em;z-index:2;background:color-mix(in srgb, var(--cd-ground) 82%, transparent);}
${S} .cd-picture .te-dg-lit{inset:0;pointer-events:none;}
${S} .cd-progress{position:absolute;left:0;right:0;bottom:0;height:3px;overflow:hidden;background:var(--cd-raise-strong);}
${S} .cd-fill{height:100%;background:var(--hc-window-accent);transition:width 150ms linear;}
${S} .cd-progress[data-unknown] .cd-fill{width:100%;opacity:0.45;}
/* The bracket opens toward the picture it measures, and the size reads under it. */
${S} .cd-dim{left:0;width:100%;top:calc(100% + 0.5em);}
${S} .cd-dim::after{order:1;border-top:0;border-bottom:1px solid var(--dg-iq);}
${S} .cd-dim span{order:2;background:transparent;padding-top:0.2em;}

/* ── THE CARDS' OWN FIELDS ─────────────────────────────────────────────── */
${S} .cd-words{width:100%;box-sizing:border-box;resize:vertical;min-height:3.4em;border:0;border-bottom:1px solid transparent;border-radius:var(--hc-radius-control,2px);
  background:var(--cd-raise);padding:0.5em 0.6em;font-family:var(--cd-read);font-size:0.86em;line-height:1.45;color:var(--cd-ink);outline:none;
  transition:background-color 150ms ease, border-color 150ms ease;}
${S} .cd-words:focus{background:var(--cd-raise-strong);border-bottom-color:rgb(var(--acc));}
${S} .te-dg-fld > .te-dg-word{align-self:flex-start;}
${S} .cd-note{margin:0;line-height:1.4;font-family:var(--cd-read);}
${S} .cd-check{display:inline-flex;align-items:center;gap:0.4em;font-size:0.72em;color:var(--cd-ink-plain);}
${S} .cd-check input[type=checkbox]{accent-color:rgb(var(--acc));margin:0;}
${S} .cd-short{flex:0 0 3.4em;}
${S} .cd-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:0.4em;}
${S} .cd-number{display:flex;flex-direction:column;gap:0.15em;min-width:0;}
${S} .cd-number .te-dg-input{width:100%;box-sizing:border-box;}
${S} .cd-dot{flex:0 0 auto;width:7px;height:7px;border-radius:50%;background:var(--cd-raise-strong);}
${S} .cd-dot[data-on]{background:var(--hc-status-ok,#70d59a);}
${S} .cd-folder{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
${S} .cd-weights{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:0.2em;max-height:9em;overflow-y:auto;}
${S} .cd-weight{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:0.5em;font-size:0.72em;color:var(--cd-ink-quiet);}
${S} .cd-weight[data-on]{color:var(--cd-ink);}
${S} .cd-weight[data-loading] .cd-weight-time{color:var(--hc-window-accent);}
${S} .cd-weight-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
${S} .cd-weight-time{font-variant-numeric:tabular-nums;white-space:nowrap;}
${S} .cd-prompts{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:0.1em;max-height:12em;overflow-y:auto;}
${S} .cd-prompt-row{appearance:none;display:block;width:100%;box-sizing:border-box;padding:0.3em 0.4em;border:0;text-align:left;background:transparent;
  font-family:var(--cd-read);font-size:0.78em;color:var(--cd-ink-plain);border-radius:var(--hc-radius-control,2px);cursor:pointer;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background-color 150ms ease;}
${S} .cd-prompt-row:hover{background:var(--hc-window-wash);}
${S} .cd-prompt-row[data-on]{background:var(--hc-window-wash-strong);color:var(--cd-ink);}
${S} .cd-prompt-detail{display:flex;flex-direction:column;align-items:flex-start;gap:0.15em;}
${S} .cd-prompt-detail p{margin:0;font-size:0.72em;line-height:1.4;color:var(--cd-ink-quiet);overflow-wrap:anywhere;}

/* The editor's dimension mark ignores the pointer; this one is held to be typed in. */
${S} .cd-size-mark{pointer-events:auto;cursor:text;user-select:none;-webkit-user-select:none;touch-action:none;}
${S} .cd-size-field{pointer-events:auto;}
${S} .cd-size-field{order:2;margin-top:0.2em;width:7.5em;box-sizing:border-box;text-align:center;font:inherit;font-size:1em;color:var(--cd-ink);
  background:var(--cd-raise-strong);border:0;border-bottom:1px solid rgb(var(--acc));border-radius:var(--hc-radius-control,2px);outline:none;padding:0.1em 0.3em;}

/* ── SUGGESTING: the prompt in pieces, and the ideas as tiles ──────────── */
${S} .cd-chunks{position:absolute;left:1em;right:1em;top:2.3em;z-index:3;display:flex;flex-wrap:wrap;align-items:center;gap:0.35em;
  padding:0.4em 0.5em;box-sizing:border-box;background:var(--cd-ground);outline:1px solid var(--cd-rule);border-radius:var(--hc-radius-card,3px);}
${S} .cd-chunks[data-busy]{outline-color:var(--hc-window-edge);}
${S} .cd-chunk{display:inline-flex;align-items:center;gap:0.2em;max-width:100%;padding:0.15em 0.2em 0.15em 0.55em;
  font-family:var(--cd-read);font-size:0.86em;line-height:1.35;color:var(--cd-ink);background:var(--hc-window-wash);
  outline:1px solid var(--hc-window-edge);border-radius:var(--hc-radius-control,2px);}
${S} .cd-chunk-words{min-width:0;overflow-wrap:anywhere;}
${S} .cd-chunk-out{appearance:none;border:0;margin:0;padding:0 0.35em;background:transparent;font:inherit;font-size:1.1em;line-height:1;color:var(--cd-ink-quiet);cursor:pointer;border-radius:var(--hc-radius-control,2px);}
${S} .cd-chunk-out:hover{color:var(--cd-ink);background:var(--cd-raise-strong);}
${S} .cd-chunk-empty{font-size:0.78em;color:var(--cd-ink-quiet);font-family:var(--cd-read);}
${S} .cd-ideas{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.9em;padding:6em 1em 2em;box-sizing:border-box;}
${S} .cd-comb{position:relative;flex:0 0 auto;max-width:100%;}
${S} .cd-comb[data-busy]{opacity:0.55;}
${S} .cd-hex{appearance:none;position:absolute;border:0;margin:0;padding:0 0.7em;background:transparent;cursor:pointer;color:var(--cd-ink-plain);font:inherit;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.15em;text-align:center;box-sizing:border-box;}
${S} .cd-hex svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;}
${S} .cd-hex polygon{fill:var(--cd-raise);stroke:var(--hc-window-edge);stroke-width:1px;vector-effect:non-scaling-stroke;transition:fill 150ms ease, stroke 150ms ease;}
${S} .cd-hex:hover:not(:disabled) polygon,${S} .cd-hex:focus-visible polygon{fill:var(--hc-window-wash);stroke:var(--hc-window-edge-firm);}
${S} .cd-hex:focus-visible{outline:none!important;}
${S} .cd-hex:focus-visible polygon{stroke:var(--te-focus);stroke-width:2px;}
${S} .cd-hex[data-kind="subject"]{cursor:default;}
${S} .cd-hex[data-kind="subject"] polygon{fill:var(--hc-window-wash-strong);stroke:var(--hc-window-accent);}
${S} .cd-comb[data-flower] .cd-hex[data-kind="idea"] polygon{fill:var(--hc-window-wash-strong);stroke:var(--hc-window-accent);stroke-width:2px;}
${S} .cd-hex[data-kind="seat"] polygon{fill:var(--cd-ground);stroke:var(--hc-window-edge-firm);}
${S} .cd-hex[data-kind="seat"]:hover polygon{fill:var(--hc-window-wash);stroke:var(--hc-window-accent);}
${S} .cd-hex-name{position:relative;font-size:0.72em;line-height:1.15;max-width:100%;overflow-wrap:anywhere;color:var(--cd-ink);
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
${S} .cd-hex[data-kind="seat"] .cd-hex-name{font-size:0.62em;color:var(--cd-ink-plain);}
${S} .cd-hex-icon{position:relative;font-size:1.3em;color:var(--hc-window-accent);}
${S} .cd-idea-reading{margin:0;max-width:36em;min-height:2.8em;text-align:center;font-family:var(--cd-read);font-size:0.92em;line-height:1.45;color:var(--cd-ink-plain);}
${S} .cd-idea-source{margin:0;font-size:0.72em;color:var(--cd-ink-quiet);}
${S} .cd-idea-source:empty{display:none;}
${S} .cd-panel[data-layout="narrow"] .cd-chunks{position:static;margin:0 0 1em;}
${S} .cd-panel[data-layout="narrow"] .cd-ideas{position:static;padding:0 0 1em;}

/* ── UP CLOSE ──────────────────────────────────────────────────────────── */
${S} .cd-look{position:absolute;inset:0;z-index:8;display:grid;place-items:center;padding:1em;box-sizing:border-box;background:var(--cd-ground);cursor:zoom-out;}
${S} .cd-look img{display:block;max-width:100%;max-height:100%;object-fit:contain;}

${S} .cd-live{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}

/* ── NARROW: the same nodes, rearranged ────────────────────────────────── */
${S} .cd-panel[data-layout="narrow"] .cd-body{flex-direction:column;}
${S} .cd-panel[data-layout="narrow"] .cd-list{width:auto;max-height:none;box-shadow:inset 0 -1px 0 var(--cd-rule);}
${S} .cd-panel[data-layout="narrow"] .cd-vp{overflow-y:auto;padding:2em 16px 1em;}
${S} .cd-panel[data-layout="narrow"] .cd-figure{position:relative;margin:0 auto 2.4em;}
/* Narrow: the sheet becomes one strip of faces that scrolls sideways. */
${S} .cd-panel[data-layout="narrow"] .cd-rows{display:flex;overflow-x:auto;overflow-y:hidden;gap:0.5em;padding:0.2em 0.6em 0.6em;}
${S} .cd-panel[data-layout="narrow"] .cd-rows > :is(.cd-cell-wrap,.cd-cell-fresh){flex:0 0 5.5em;width:5.5em;}
${S} .cd-panel[data-layout="narrow"] .cd-list-head{height:2.2em;}

@media (pointer:coarse){
  ${S} .cd-panel .cd-icon-btn{min-width:44px;min-height:44px;}
  ${S} .cd-panel .cd-btn{min-height:48px;}
  ${S} .cd-row-hide{visibility:visible;}
}
@media (forced-colors:active){
  ${S} .cd-btn-primary{background:Highlight;color:HighlightText;forced-color-adjust:none;}
  ${S} .cd-note-bar{outline-color:CanvasText;}
}
@media (prefers-reduced-motion:reduce){
  ${S} .cd-panel,${S} .cd-panel *{transition:none!important;}
}
`
  document.head.appendChild(style)
}
