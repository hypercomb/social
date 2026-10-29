// editor/diagram/diagram.styles.ts
//
// THE DIAGRAM'S MATERIAL: tabs, cards, leaders, the lit layer, the narrow rows.
// One stylesheet, installed once. Colour is by ROLE only (the window ink, tint,
// wash and edge roles, the accent, the focus ring) — the one raw colour that is
// ever painted is the person's own rim and fill, which are data and are set
// inline elsewhere.
//
// LIGHTING IS ONE ATTRIBUTE. `data-lit = soft | strong` (and `data-tone = alert`)
// is set by the lighting machine on every element that carries a part id; the
// rules below read nothing else. Only stroke, stroke-width, fill, fill-opacity,
// color, background-color and border-color ever change, in 150ms. Nothing smears,
// nothing pulses, nothing is dimmed with opacity: a label at rest is the quiet
// ink, never a faded loud one.
//
// Everything inside the desk is in em, so the text-size gear scales it. Radii
// stay on the 2/3/4px ladder. A wide desk draws leaders; the narrow arrangement
// (`[data-layout=narrow]`) turns the same nodes into full-width rows.

const STYLE_ID = 'hc-tile-diagram-style'

export function installDiagramStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

const ROLES = ':is(.te-dg,.te-dg-lit,.te-dg-bandlabel,.te-dg-name,.te-dg-toolbar)'

const CSS = `
${ROLES}{
  --dg-il:var(--hc-window-ink-loud,currentColor);
  --dg-ip:var(--hc-window-ink-plain,currentColor);
  --dg-iq:var(--hc-window-ink-quiet,currentColor);
  --dg-if:var(--hc-window-ink-faint,currentColor);
  --dg-line:var(--hc-window-line,currentColor);
  --dg-edge:var(--hc-window-edge,currentColor);
  --dg-edgef:var(--hc-window-edge-firm,currentColor);
  --dg-wash:var(--hc-window-wash,transparent);
  --dg-washs:var(--hc-window-wash-strong,transparent);
  --dg-tint:var(--hc-window-tint,transparent);
  --dg-tints:var(--hc-window-tint-strong,transparent);
  --dg-accent:rgb(var(--acc,200,151,90));
  --dg-on-accent:var(--hc-window-on-accent,Canvas);
  --dg-on-scrim:var(--hc-window-on-scrim,#fff);
  --dg-ground:var(--md-surface,Canvas);
  --dg-halo:var(--te-halo,color-mix(in srgb,var(--md-surface,Canvas) 85%,transparent));
  --dg-alert:var(--hc-status-alert,currentColor);
  --dg-warn:var(--hc-status-warn,currentColor);
  --dg-focus:var(--te-focus,var(--dg-accent));
  --dg-read:var(--hc-read,system-ui,sans-serif);
  --dg-mono:var(--hc-mono,ui-monospace,monospace);
}
.te-dg [hidden],.te-dg-bandlabel[hidden],.te-dg-capture[hidden]{display:none!important;}

/* ── the layers in the viewport ───────────────────────────────────────── */
.te-dg{position:absolute;inset:0;pointer-events:none;color:var(--dg-ip);font-family:var(--dg-mono);}
.te-dg-leaders{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;}
.te-dg-lead path{fill:none;vector-effect:non-scaling-stroke;}
.te-dg-lead .te-dg-halo{stroke:var(--dg-halo);stroke-width:4px;}
.te-dg-lead .te-dg-ln{stroke:var(--dg-if);stroke-width:1px;transition:stroke 150ms ease,stroke-width 150ms ease;}
.te-dg-lead .te-dg-dot{fill:var(--dg-ground);stroke:var(--dg-iq);stroke-width:1.25px;vector-effect:non-scaling-stroke;transition:stroke 150ms ease,fill 150ms ease;}
.te-dg-lead[data-lit="soft"] .te-dg-ln{stroke:var(--dg-edgef);stroke-width:1.5px;}
.te-dg-lead[data-lit="soft"] .te-dg-dot{stroke:var(--dg-accent);fill:var(--dg-wash);}
.te-dg-lead[data-lit="strong"] .te-dg-ln{stroke:var(--dg-accent);stroke-width:1.5px;}
.te-dg-lead[data-lit="strong"] .te-dg-dot{stroke:var(--dg-accent);fill:var(--dg-accent);}
.te-dg-lead[data-covered] .te-dg-ln,.te-dg-lead[data-covered] .te-dg-halo{stroke:transparent;}
.te-dg-lead[data-tone="alert"] .te-dg-ln{stroke:var(--dg-alert);}
.te-dg-lead[data-tone="alert"] .te-dg-dot{stroke:var(--dg-alert);fill:var(--dg-alert);}
.te-dg[data-gesture="pan"] .te-dg-lead .te-dg-ln{stroke:var(--dg-line);}

.te-dg-callouts{position:absolute;inset:0;pointer-events:none;}
.te-dg-tag{position:absolute;left:.9em;top:.7em;z-index:2;font-size:.68em;letter-spacing:.03em;color:var(--dg-iq);white-space:nowrap;pointer-events:none;}
.te-dg-tag b{font-weight:400;color:var(--dg-ip);}
.te-dg-notices{position:absolute;left:50%;transform:translateX(-50%);top:.5em;width:min(36em,calc(100% - 2em));z-index:12;pointer-events:none;}
.te-dg-notices:empty{display:none;}
.te-dg-probe{position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;font-family:var(--dg-mono);letter-spacing:.04em;pointer-events:none;}
.te-dg-dim{position:absolute;z-index:2;pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:2px;font-size:.72em;color:var(--dg-iq);}
.te-dg-dim::after{content:"";width:100%;height:7px;border:1px solid var(--dg-iq);border-bottom:0;order:2;}
.te-dg-dim span{background:var(--dg-ground);padding:0 .45em;order:1;}

/* ── the hive-scale chip ──────────────────────────────────────────────── */
.te-dg-chip{position:absolute;left:14px;bottom:10px;z-index:3;display:flex;flex-direction:column;align-items:flex-start;gap:2px;pointer-events:none;}
.te-dg-cap{font-size:.72em;color:var(--dg-iq);margin-left:2px;}
.te-dg-chipbox{position:relative;}
.te-dg-chip-svg{display:block;overflow:visible;}
.te-dg-nb{fill:var(--dg-tint);stroke:var(--dg-if);stroke-width:1;}
.te-dg-me{fill:var(--dg-tints);}
.te-dg-chip-band{fill:#000;fill-opacity:.85;}
.te-dg-chipname{position:absolute;display:block;text-align:center;font-family:var(--dg-mono);color:var(--dg-on-scrim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.02em;}

/* ── the lit layer: a sibling above the stage, inside the figure ───────── */
.te-dg-lit{position:absolute;left:0;top:0;overflow:visible;pointer-events:none;}
.te-dg-l{fill:none;stroke:none;transition:stroke 150ms ease,fill 150ms ease,fill-opacity 150ms ease,stroke-width 150ms ease;}
.te-dg-litg[data-lit] .te-dg-halo{stroke:var(--dg-halo);}
.te-dg-litg[data-lit="soft"] .te-dg-edge{stroke:var(--dg-edgef);}
.te-dg-litg[data-lit="strong"] .te-dg-edge{stroke:var(--dg-accent);stroke-width:calc(var(--w,1.5px) + .5px);}
.te-dg-litg[data-lit="soft"] .te-dg-fill{fill:var(--dg-wash);}
.te-dg-litg[data-lit="strong"] .te-dg-fill{fill:var(--dg-washs);}
.te-dg-litg[data-lit="soft"] .te-dg-fill[data-faint]{fill:color-mix(in srgb,var(--dg-accent) 5%,transparent);}
.te-dg-litg[data-lit="strong"] .te-dg-fill[data-faint]{fill:color-mix(in srgb,var(--dg-accent) 8%,transparent);}
.te-dg-litg[data-lit="soft"] .te-dg-band{stroke:var(--dg-wash);}
.te-dg-litg[data-lit="strong"] .te-dg-band{stroke:var(--dg-washs);}
.te-dg-litg[data-lit] .te-dg-hatch{fill:var(--hatch);}
.te-dg-litg[data-lit="soft"] .te-dg-hatch{fill-opacity:.7;}
.te-dg-litg[data-lit="strong"] .te-dg-hatch{fill-opacity:1;}
.te-dg-litg[data-tone="alert"] .te-dg-edge{stroke:var(--dg-alert);}
.te-dg-litg[data-tone="alert"] .te-dg-fill{fill:color-mix(in srgb,var(--dg-alert) 16%,transparent);}
.te-dg-hatch-line{stroke:var(--dg-accent);stroke-opacity:.8;}
.te-dg-capture-line{stroke:var(--dg-edgef);}
.te-dg-capture[data-lit="strong"] .te-dg-capture-line{stroke:var(--dg-accent);}
.te-dg-cross{display:none;}
.te-dg-cross[data-on]{display:inline;}
.te-dg-cross-line{stroke:var(--dg-on-scrim);}
/* the picture looked at, or moved: what will be cut off shows through */
[data-lift="true"] .te-look-outside,[data-lift="true"] .te-look[data-dragging="true"] .te-look-outside{fill-opacity:.4;}
[data-cursor="pointer"]{cursor:pointer;}
[data-cursor="text"]{cursor:text;}

/* ── the name, in place on the band ───────────────────────────────────── */
.te-dg-name{position:absolute;margin:0;padding:0 .15em;border:0;border-bottom:2px dotted color-mix(in srgb,var(--dg-on-scrim) 50%,transparent);
  background:transparent;text-align:center;text-overflow:ellipsis;font-family:var(--dg-mono);font-weight:400;letter-spacing:.04em;
  color:var(--dg-on-scrim);caret-color:var(--dg-accent);outline:none;pointer-events:none;border-radius:0;
  transition:background-color 150ms ease,color 150ms ease,border-color 150ms ease;}
.te-dg-name:focus{pointer-events:auto;background:var(--dg-tints);border-bottom:2px solid var(--dg-accent);}
.te-dg-name[data-ghost="true"]{color:color-mix(in srgb,var(--dg-on-scrim) 62%,transparent);border-bottom-style:dashed;}
.te-dg-name[aria-invalid="true"],.te-dg-name[aria-invalid="true"]:focus{border-bottom:2px solid var(--dg-alert);}
.te-dg-name::placeholder{color:color-mix(in srgb,var(--dg-on-scrim) 62%,transparent);}
.te-dg-bandlabel{position:absolute;display:grid;place-items:center;pointer-events:none;font-family:var(--dg-mono);letter-spacing:.04em;color:var(--dg-on-scrim);}

/* ── a callout: the tab is the control, the drawn part its visual twin ── */
.te-dg-callout{position:absolute;pointer-events:auto;z-index:3;border-radius:4px;outline:1px solid transparent;outline-offset:0;}
.te-dg-callout[data-open]{z-index:6;background:var(--dg-ground);outline-color:var(--dg-edgef);}
.te-dg-callout[data-grow="up"]{display:flex;flex-direction:column-reverse;}
.te-dg-callout[data-covered]{visibility:hidden;}
.te-dg-head{display:flex;align-items:center;min-height:2em;}
.te-dg-callout[data-side="left"] .te-dg-head{flex-direction:row-reverse;}
.te-dg-tab{position:relative;flex:1;min-width:0;display:flex;align-items:center;gap:.65em;height:2em;padding:0 .55em;color:var(--dg-iq);text-align:left;
  border-radius:2px;cursor:pointer;transition:color 150ms ease,background-color 150ms ease;}
.te-dg-callout[data-side="left"] .te-dg-tab{flex-direction:row-reverse;text-align:right;}
.te-dg-lab{appearance:none;border:0;background:transparent;padding:0;margin:0;font:inherit;font-size:.86em;font-weight:500;letter-spacing:.01em;white-space:nowrap;color:inherit;cursor:pointer;}
.te-dg-lab::first-letter{text-transform:uppercase;}
.te-dg-lab::after{content:"";position:absolute;inset:0;}
.te-dg-val{display:inline-flex;align-items:center;gap:.45em;min-width:0;font-size:.76em;}
.te-dg-callout[data-side="left"] .te-dg-val{flex-direction:row-reverse;}
.te-dg-val>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.te-dg-swc{position:relative;flex:none;width:1.1em;height:1.1em;border-radius:2px;background:var(--sw,transparent);border:1px solid var(--dg-iq);cursor:pointer;forced-color-adjust:none;}
.te-dg-swc[data-unset="true"]{background:repeating-linear-gradient(135deg,transparent 0 3px,var(--dg-iq) 3px 4px);}
.te-dg-swc input{position:absolute;inset:-6px;width:calc(100% + 12px);height:calc(100% + 12px);opacity:0;border:0;padding:0;margin:0;cursor:pointer;}
.te-dg-swc:hover{border-color:var(--dg-il);}
.te-dg-swc:focus-within{outline:2px solid var(--dg-focus);outline-offset:1px;}
.te-dg-tab::after{content:"";position:absolute;left:.55em;right:.55em;bottom:1px;height:1px;background:transparent;transition:background-color 150ms ease;}
.te-dg-callout[data-lit="soft"] .te-dg-tab{color:var(--dg-il);background:var(--dg-wash);}
.te-dg-callout[data-lit="soft"] .te-dg-tab::after{background:var(--dg-edgef);}
.te-dg-callout[data-lit="strong"] .te-dg-tab{color:var(--dg-il);background:var(--dg-washs);}
.te-dg-callout[data-lit="strong"] .te-dg-tab::after{background:var(--dg-accent);height:2px;bottom:0;}
.te-dg-callout[data-tone="alert"]{outline-color:var(--dg-alert);}
.te-dg-callout[data-tone="alert"] .te-dg-tab{background:color-mix(in srgb,var(--dg-alert) 14%,transparent);}
.te-dg-callout[data-tone="alert"] .te-dg-tab::after{background:var(--dg-alert);}
.te-dg-callout:not([data-open]) .te-dg-layer{display:none;}
.te-dg-callout[data-open] .te-dg-val{display:none;}
.te-dg[data-compact="true"] .te-dg-callout:not([data-open]) .te-dg-val>span{display:none;}
.te-dg-lab:focus-visible,.te-dg-word:focus-visible,.te-dg-ib:focus-visible,.te-dg-chipl:focus-visible,.te-dg-switch:focus-visible,.te-dg-twin:focus-visible,
.te-dg-input:focus-visible,.te-dg-history button:focus-visible,.te-dg-seg button:focus-visible,.te-dg-lmenu button:focus-visible,.te-dg-q textarea:focus-visible{
  outline:2px solid var(--dg-focus);outline-offset:1px;}

/* ── the card ─────────────────────────────────────────────────────────── */
.te-dg-body{display:flex;flex-direction:column;gap:.6em;padding:.2em .65em .75em;position:relative;}
.te-dg-fld{display:flex;flex-direction:column;gap:.5em;min-width:0;}
.te-dg-col{gap:.4em;}
.te-dg-sub{font-size:.72em;color:var(--dg-iq);}
.te-dg-rowf{display:flex;align-items:center;gap:.4em;min-width:0;}
.te-dg-between{justify-content:space-between;}
.te-dg-end{justify-content:flex-end;}
.te-dg-grow{flex:1;}
.te-dg-input{flex:1 1 auto;min-width:0;height:2em;margin:0;padding:0 .6em;border:0;border-bottom:1px solid transparent;border-radius:2px;background:var(--dg-tint);color:var(--dg-il);font:inherit;font-size:.82em;outline:none;
  transition:background-color 150ms ease,border-color 150ms ease;}
.te-dg-input::placeholder{color:var(--dg-iq);}
.te-dg-input:hover{background:var(--dg-tints);}
.te-dg-input:focus{background:var(--dg-tints);border-bottom-color:var(--dg-accent);}
.te-dg-input[aria-invalid="true"]{border-bottom-color:var(--dg-alert);}
.te-dg-hex{flex:0 1 6.8em;font-family:var(--dg-mono);}
.te-dg-url{font-family:var(--dg-read);}
.te-dg-swatch{position:relative;flex:none;width:2em;height:2em;border-radius:2px;background:var(--sw,transparent);border:1px solid var(--dg-line);overflow:hidden;cursor:pointer;forced-color-adjust:none;}
.te-dg-swatch[data-unset="true"]{background:repeating-linear-gradient(135deg,transparent 0 5px,var(--dg-line) 5px 6px);}
.te-dg-swatch input{position:absolute;inset:-4px;width:calc(100% + 8px);height:calc(100% + 8px);opacity:0;border:0;padding:0;margin:0;cursor:pointer;}
.te-dg-swatch:focus-within{outline:2px solid var(--dg-focus);outline-offset:1px;}
.te-dg-switch{appearance:none;border:0;margin:0;background:transparent;padding:0;display:inline-flex;align-items:center;gap:.6em;font:inherit;font-size:.8em;color:var(--dg-ip);text-align:left;min-height:2em;cursor:pointer;}
.te-dg-switch:disabled{color:var(--dg-iq);cursor:default;}
.te-dg-track{position:relative;flex:none;width:2.1em;height:1.2em;border-radius:999px;background:var(--dg-tints);transition:background-color 150ms ease;}
.te-dg-knob{position:absolute;top:.15em;left:.15em;width:.9em;height:.9em;border-radius:50%;background:var(--dg-iq);transition:background-color 150ms ease;}
.te-dg-switch[aria-checked="true"] .te-dg-track{background:var(--dg-washs);}
.te-dg-switch[aria-checked="true"] .te-dg-knob{left:1.05em;background:var(--dg-accent);}
.te-dg-switch[aria-checked="mixed"] .te-dg-knob{left:.6em;}
.te-dg-status{display:flex;align-items:flex-start;gap:.45em;min-height:1.4em;font-family:var(--dg-read);font-size:.78em;color:var(--dg-iq);line-height:1.35;}
.te-dg-status[data-tone="alert"]{color:var(--dg-alert);}
.te-dg-status[data-tone="warn"]{color:var(--dg-warn);}
.te-dg-status[data-tone="ok"]{color:var(--dg-ip);}
.te-dg-status .mat-sym{flex:none;font-size:1.2em;margin-top:.05em;}
.te-dg-word{appearance:none;border:0;margin:0;background:transparent;color:var(--dg-iq);font:inherit;font-size:.72em;height:1.8em;padding:0 .55em;border-radius:2px;white-space:nowrap;cursor:pointer;
  transition:color 150ms ease,background-color 150ms ease;}
.te-dg-word:hover{color:var(--dg-il);background:var(--dg-tints);}
.te-dg-ib{appearance:none;border:0;margin:0;padding:0;display:inline-grid;place-items:center;flex:none;width:1.95em;height:1.95em;background:transparent;color:var(--dg-iq);border-radius:2px;cursor:pointer;
  transition:color 150ms ease,background-color 150ms ease;}
.te-dg-ib:hover:not(:disabled){color:var(--dg-il);background:var(--dg-tints);}
.te-dg-ib:disabled{color:var(--dg-if);cursor:default;}
.te-dg-ib[aria-pressed="true"]{color:var(--dg-accent);}
.te-dg-ib .mat-sym,.te-dg-seg .mat-sym{font-size:1.15em;}
.te-dg-localechip{display:inline-flex;align-items:center;height:1.5em;padding:0 .5em;border:1px dashed var(--dg-edge);border-radius:2px;color:var(--dg-ip);font-size:.72em;cursor:help;}
.te-dg-addr{display:flex;align-items:baseline;gap:.5em;font-size:.72em;color:var(--dg-iq);}
.te-dg-addr code{font-family:var(--dg-mono);color:var(--dg-ip);}
.te-dg-twins{display:flex;align-items:flex-end;justify-content:center;gap:.2em;}
.te-dg-twin{appearance:none;border:0;background:transparent;padding:.25em .3em;display:inline-flex;flex-direction:column;align-items:center;gap:.3em;color:var(--dg-iq);font:inherit;font-size:.72em;border-radius:2px;cursor:pointer;
  transition:color 150ms ease,background-color 150ms ease;}
.te-dg-twin:hover{background:var(--dg-tint);color:var(--dg-ip);}
.te-dg-twin[aria-pressed="true"]{color:var(--dg-il);}
.te-dg-twin>span{position:relative;padding-bottom:3px;}
.te-dg-twin[aria-pressed="true"]>span::after{content:"";position:absolute;left:20%;right:20%;bottom:0;height:2px;background:var(--dg-accent);}
.te-dg-twface{width:46px;height:46px;object-fit:contain;forced-color-adjust:none;}
.te-dg-q{display:flex;flex-direction:column;gap:.4em;padding-top:.2em;}
.te-dg-q+.te-dg-q{border-top:1px solid var(--dg-line);padding-top:.7em;}
.te-dg-q p{margin:0;font-family:var(--dg-read);font-size:.84em;line-height:1.4;color:var(--dg-il);}
.te-dg-q p.te-dg-a{color:var(--dg-ip);}
.te-dg-q textarea{min-height:3.4em;resize:vertical;border:0;border-bottom:1px solid transparent;border-radius:2px;background:var(--dg-tint);padding:.5em .6em;font-family:var(--dg-read);font-size:.82em;color:var(--dg-il);outline:none;}
.te-dg-q textarea:focus{background:var(--dg-tints);border-bottom-color:var(--dg-accent);}
.te-dg-history{display:flex;flex-wrap:wrap;gap:6px;}
.te-dg-history button{appearance:none;width:46px;height:46px;padding:0;border:1px solid var(--dg-edge);border-radius:2px;background:var(--dg-tint);overflow:hidden;cursor:pointer;}
.te-dg-history button:hover{border-color:var(--dg-edgef);}
.te-dg-history button[data-here="true"]{border-color:var(--dg-accent);}
.te-dg-history img{width:100%;height:100%;object-fit:cover;display:block;}

/* ── the layer chip: a disclosure with arrow keys ─────────────────────── */
.te-dg-layer{position:relative;margin:0 .4em;}
.te-dg-chipl{appearance:none;display:inline-flex;align-items:center;gap:.2em;border:1px solid var(--dg-edge);border-radius:2px;background:transparent;color:var(--dg-iq);font:inherit;font-size:.72em;line-height:1.5;padding:0 .45em;height:1.5em;white-space:nowrap;cursor:pointer;
  transition:color 150ms ease,background-color 150ms ease,border-color 150ms ease;}
.te-dg-chipl:hover:not(:disabled){background:var(--dg-tints);color:var(--dg-il);}
.te-dg-chipl[data-layer="here"]{color:var(--dg-il);border-color:var(--dg-edgef);}
.te-dg-chipl[data-layer="hidden"]{text-decoration:line-through;}
.te-dg-chipl[data-pending="true"]{border-style:dashed;}
.te-dg-chipl .mat-sym{font-size:1.2em;}
.te-dg-lmenu{position:absolute;top:calc(100% + 2px);right:0;z-index:9;display:flex;flex-direction:column;min-width:9.5em;padding:2px;background:var(--dg-ground);border:1px solid var(--dg-edgef);border-radius:4px;}
.te-dg-callout[data-side="left"] .te-dg-lmenu{right:auto;left:0;}
.te-dg-lmenu button{appearance:none;border:0;background:transparent;text-align:left;font:inherit;font-size:.78em;padding:.35em .55em;border-radius:2px;color:var(--dg-ip);cursor:pointer;}
.te-dg-lmenu button:hover,.te-dg-lmenu button[aria-checked="true"]{background:var(--dg-wash);color:var(--dg-il);}

/* ── the picture toolbar, hugging the lower edge of the tile ──────────── */
.te-dg-toolbar{position:absolute;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:.15em .1em;z-index:3;pointer-events:auto;color:var(--dg-ip);font-family:var(--dg-mono);}
.te-dg-toolbar[hidden]{display:none!important;}
.te-dg-toolbar .te-dg-ib{width:1.75em;height:1.75em;}
.te-dg-grp{display:inline-flex;align-items:center;gap:.05em;}
.te-dg-sep{width:1px;height:1.1em;background:var(--dg-line);margin:0 .3em;}
.te-dg-seg{display:inline-flex;padding:2px;gap:2px;background:var(--dg-tint);border-radius:2px;}
.te-dg-seg button{appearance:none;border:0;background:transparent;height:1.75em;min-width:1.75em;padding:0 .4em;font:inherit;font-size:.76em;color:var(--dg-ip);border-radius:2px;cursor:pointer;transition:background-color 150ms ease,color 150ms ease;}
.te-dg-seg button[aria-checked="true"]{background:var(--dg-washs);color:var(--dg-il);}
.te-dg-seg button:disabled{color:var(--dg-iq);cursor:default;}
.te-dg-zoom{display:inline-flex;align-items:center;gap:.05em;}
.te-dg-zoom input[type=range]{width:4.6em;height:1.8em;margin:0 .1em;background:transparent;accent-color:var(--dg-accent);cursor:pointer;}
.te-dg-readout{min-width:2.9em;text-align:right;font-size:.72em;font-variant-numeric:tabular-nums;color:var(--dg-iq);}

/* ── NARROW: the same nodes, rearranged as full-width rows ────────────── */
.te-dg[data-layout="narrow"]{position:static;pointer-events:auto;}
.te-dg[data-layout="narrow"] .te-dg-leaders,.te-dg[data-layout="narrow"] .te-dg-chip,.te-dg[data-layout="narrow"] .te-dg-tag,.te-dg[data-layout="narrow"] .te-dg-dim{display:none;}
.te-dg[data-layout="narrow"] .te-dg-callouts{position:static;display:flex;flex-direction:column;gap:.35em;padding:.4em 1em 1.2em;pointer-events:auto;max-width:36em;margin:0 auto;}
.te-dg[data-layout="narrow"] .te-dg-callout{position:relative;width:auto;border:1px solid var(--dg-line);outline:0;}
.te-dg[data-layout="narrow"] .te-dg-callout[data-open]{border-color:var(--dg-edgef);}
.te-dg[data-layout="narrow"] .te-dg-callout[data-grow="up"]{display:block;}
.te-dg[data-layout="narrow"] .te-dg-callout[data-covered]{visibility:visible;}
.te-dg[data-layout="narrow"] .te-dg-head{min-height:3em;}
.te-dg[data-layout="narrow"] .te-dg-callout[data-side="left"] .te-dg-head{flex-direction:row;}
.te-dg[data-layout="narrow"] .te-dg-tab,.te-dg[data-layout="narrow"] .te-dg-callout[data-side="left"] .te-dg-tab{flex-direction:row;text-align:left;height:3em;gap:.8em;padding:0 .75em;}
.te-dg[data-layout="narrow"] .te-dg-val,.te-dg[data-layout="narrow"] .te-dg-callout[data-side="left"] .te-dg-val{flex-direction:row;margin-left:auto;font-size:.8em;}
.te-dg[data-layout="narrow"] .te-dg-lab{font-size:.9em;}
.te-dg[data-layout="narrow"] .te-dg-tab::after{left:.75em;right:.75em;bottom:4px;}
.te-dg[data-layout="narrow"] .te-dg-callout[data-side="left"] .te-dg-lmenu{left:auto;right:0;}
.te-dg[data-layout="narrow"] .te-dg-swc{width:1.5em;height:1.5em;}
.te-dg-body .te-dg-toolbar{position:static;margin:0 0 .2em;max-width:100%;justify-content:flex-start;}
.te-dg[data-layout="narrow"] :is(.te-dg-ib,.te-dg-word,.te-dg-seg button,.te-dg-twin,.te-dg-chipl,.te-dg-switch){min-width:44px;min-height:44px;}
.te-dg[data-layout="narrow"] .te-dg-swc input{inset:-11px;width:calc(100% + 22px);height:calc(100% + 22px);}
.te-dg[data-layout="narrow"] :is(.te-dg-input,.te-dg-q textarea){font-size:max(16px,1em);}
.te-dg[data-layout="narrow"] .te-dg-swatch{width:44px;height:44px;}

@media (pointer:coarse){
  :is(.te-dg,.te-dg-toolbar) :is(.te-dg-ib,.te-dg-word,.te-dg-seg button,.te-dg-twin,.te-dg-chipl,.te-dg-switch){min-width:44px;min-height:44px;}
  .te-dg-swc{width:1.6em;height:1.6em;}
  .te-dg-swc input{inset:-11px;width:calc(100% + 22px);height:calc(100% + 22px);}
  .te-dg-input,.te-dg-q textarea,.te-dg-name{font-size:max(16px,1em);}
  .te-dg-swatch{width:44px;height:44px;}
  .te-dg-zoom input[type=range]{height:44px;}
  .te-dg-history button{width:44px;height:44px;}
}

@media (prefers-reduced-motion:reduce){
  .te-dg *,.te-dg *::before,.te-dg *::after,.te-dg-lit *,.te-dg-name,.te-dg-toolbar *{transition:none!important;animation:none!important;}
}

@media (prefers-contrast:more){
  .te-dg-lead .te-dg-halo{stroke-width:5px;}
  .te-dg-lead .te-dg-ln{stroke:var(--dg-iq);}
  .te-dg-tab{color:var(--dg-ip);}
}

@media (forced-colors:active){
  .te-dg-swc,.te-dg-swatch,.te-dg-twface{forced-color-adjust:none;}
  .te-dg-lead .te-dg-ln,.te-dg-lead .te-dg-dot{stroke:CanvasText;}
  .te-dg-litg[data-lit] .te-dg-edge{stroke:Highlight;}
  .te-dg-callout[data-lit]{outline:2px solid Highlight;}
  .te-dg-tab,.te-dg-ib,.te-dg-word,.te-dg-chipl{color:ButtonText;}
}
`
