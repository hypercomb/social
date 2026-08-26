// tile-editor.view.ts — the tile content editor, as a framework-free custom
// element (everything-is-a-beehavior Phase 2: Angular panels leave the shell
// and ship as signed modules).
//
// A straight port of shared/ui/tile-editor: same surface name
// (hc-tile-editor), same order band (220), the same one effect out
// (`note:commit`, the Q&A answer) and the same one effect in
// (`notes:changed`, which keeps that Q&A list honest). The participant sees
// the same modal, delivered as a module instead of compiled into the shell.
//
// WHAT IT IS FOR. It is the one place a tile's CONTENT is authored: the
// picture (framed against the hexagon it will become), the link, the two
// colours, whether the label draws over the image, and how the tile reads in
// the participant's own language. It also carries the Q&A side-channel — a
// bridge answer arrives as a `[Q]` note on the cell and the reply lands as an
// `[A:<qId>]` sibling.
//
// ── IT IS SERVICE-DRIVEN, NOT EFFECT-DRIVEN ──────────────────────────────
// The Angular component bridged SEVEN `fromRuntime()` subscriptions into
// signals — six over TileEditorService (`mode`, `cell`, `link`, `borderColor`,
// `backgroundColor`, `hideText`) and one over ImageEditorService (`hasImage`)
// — and derived `open = mode === 'editing'` from the first. Both services are
// plain `EventTarget`s that dispatch a bare `'change'`, so seven signals were
// seven listeners on two targets. An element has no signals: this one adds
// exactly TWO listeners, one per target, and renders from the services'
// public getters — which are the state. Both come off on disconnect with the
// same function reference (`fromRuntime` never removed any of its seven,
// which was fine for a component that outlived the app and is not fine for a
// node the surface host can move).
//
// ── FOCUS AND CARET ARE THE PARTICIPANT'S WORK ───────────────────────────
// This is a TEXT EDITOR. A rebuild that drops the caret mid-sentence is the
// worst thing this port could do, so the render strategy is decided around
// that first:
//
//   • The whole panel is BUILT ONCE in `#build()` and kept. `#render()` never
//     re-creates a node — it mutates the nodes it already has, and it writes
//     an input's `value` ONLY when it differs from what is in the field
//     (`if (input.value !== next)`). That is exactly Angular's `[ngModel]`
//     semantics: a one-way binding pushing an unchanged value is a no-op, and
//     the caret never moves. Every field here is written that way.
//   • The Q&A list is the one place rows come and go, and it is also the one
//     place a participant may be typing into a row while an unrelated
//     `notes:changed` arrives. So it gets the sanctioned per-panel
//     `Map<qId, row>`: a row whose answered-state has not changed is NOT
//     touched at all, and rows are put back in data order with `appendChild`,
//     which MOVES a live node rather than re-creating it. That is the
//     platform being the reconciler, not a reconciler.
//   • The in-flight answer text lives in `#qaAnswerDraft`, a field on the
//     element — never read back out of the DOM.
//
// ── `@if` MEANS DETACH ───────────────────────────────────────────────────
// The Angular template was one big `@if (open())`, so the backdrop, the panel
// and the camera overlay only EXISTED while the editor was open. A
// registry-fed element is mounted once at boot and stays, so all three are
// built detached and attached only while their condition holds. This is a
// real DOM contract, not a nicety: image-drop.drone.ts asks
// `target.closest('.editor-panel, .image-canvas, hc-tile-editor')` to decide
// whether a dropped image belongs to the editor or to the hive, and
// `display:none` would answer yes with the editor shut. Same for `@if
// (renaming())` (the heading swaps for a field), `@if (!hasImage())`, `@if
// (!hideText())`, `@if (qaItems.length > 0)` and `@if (cameraActive)`.
//
// Its strings ship WITH it (tile-editor.i18n.ts, extracted from all 14 shell
// catalogs) and register under the 'app' namespace, so every key resolves
// exactly as before — the Phase 2 catalog split, another slice.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { TILE_EDITOR_TRANSLATIONS } from './tile-editor.i18n.js'
import type { TileEditorService } from './tile-editor.service.js'
import type { ImageEditorService } from './image-editor.service.js'

const SURFACE_NAME = 'hc-tile-editor'

// The IoC keys the component reached for, verbatim.
const TILE_EDITOR_SERVICE = '@diamondcoreprocessor.com/TileEditorService'
const IMAGE_EDITOR_SERVICE = '@diamondcoreprocessor.com/ImageEditorService'
const TILE_EDITOR_DRONE = '@diamondcoreprocessor.com/TileEditorDrone'
const LINK_SAFETY_SERVICE = '@diamondcoreprocessor.com/LinkSafetyService'
const DECORATION_SERVICE = '@diamondcoreprocessor.com/DecorationService'
const NOTES_SERVICE = '@diamondcoreprocessor.com/NotesService'
const SETTINGS = '@diamondcoreprocessor.com/Settings'
const LINEAGE = '@hypercomb.social/Lineage'

/** Q&A item view-model — pairs a `[Q]`-prefixed note with the matching
 *  `[A:<qId>]` answer note when one exists. The qId is the question note's
 *  `id`, used as the join key in the `[A:<qId>]` answer-note text format. */
type QaViewItem = {
  readonly qId: string
  readonly question: string
  readonly answer: string | null
}

// Match `[Q]`, `[Q v2]`, `[Q something]` at the start of a note —
// captures the rest of the line as the question text.
const Q_NOTE_RE = /^\[Q(?:\s+[^\]]*)?\]\s*([\s\S]+)$/
// Match `[A:<qId>] <answer>` — captures the qId and the answer text.
const A_NOTE_RE = /^\[A:([a-zA-Z0-9_-]+)\]\s*([\s\S]+)$/

type EditorDrone = {
  saveAndComplete?: () => void | Promise<void>
  cancelEditing?: () => void
}
type SafetyVerdictLike = { decision: 'allow' | 'deny' | 'warn'; reason: string }
type LinkSafetyLike = { check: (url: string) => Promise<SafetyVerdictLike> }
type DecorationsLike = {
  titleOf?: (segments: readonly string[], locale?: string) => Promise<string>
  setTitle?: (segments: readonly string[], text: string, locale?: string) => Promise<string>
}
type LineageLike = { explorerSegments?: () => readonly string[] }
type NoteLike = { id: string; text: string }
type NotesLike = { notesFor: (cellLabel: string) => NoteLike[] }
type SettingsLike = { editorSize?: number }

/** One live Q&A row and the two shapes it can be in. `answered` is what
 *  decides whether the row must be rebuilt or merely left alone. */
type QaRow = {
  root: HTMLDivElement
  answered: boolean
  question: HTMLParagraphElement
  answer: HTMLParagraphElement | null
  textarea: HTMLTextAreaElement | null
  submit: HTMLButtonElement | null
}

// Same contract as the shell pipe: the live provider resolves the key, and the
// fallback is the English catalog text so a bare host with no i18n reads
// identically. None of this surface's keys take params.
const t = (key: string, fallback: string): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key)
  return value && value !== key ? value : fallback
}

// The editor's strings travel with it — registered as soon as the i18n
// service is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(TILE_EDITOR_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay + sequence-viewer precedent), so
// Angular's `:host` becomes the tag name and every other selector is prefixed
// with it — nothing can leak out of the editor. SCSS nesting is flattened by
// hand; `@use '../breakpoints' as *` is expanded to the literal queries it
// emits (`touch` → `(pointer: coarse)`, `tablet-only` → `(min-width:600px)
// and (max-width:1023px)`, `phone-only` → `(max-width:599px)`, `phone-land` →
// `(max-width:599px) and (orientation:landscape)`); `var(--md-*)` and
// `var(--hc-*)` are left alone. There are no @keyframes to namespace.
//
// SOURCE ORDER IS LOAD-BEARING TWICE, so the blocks stay in the SCSS's order:
//   - `.camera-btn{display:none}` comes AFTER the shared
//     `.upload-btn,.camera-btn,.orientation-btn{display:flex}` rule and has
//     the same specificity, so it only wins by being later. The `touch` query
//     then puts it back.
//   - `.editor-footer button` (a class + a type) outranks `.tool-btn` (a bare
//     class), which is why `.tool-btn` needs `padding:0 !important`. Adding
//     ONE type selector to the front of every rule shifts both by the same
//     amount, so the ordering survives the prefixing.
//
// `-webkit-user-select` is written by hand (Angular's build autoprefixed it);
// the mask properties already carried their `-webkit-` twins in the source.
//
// Two rules are inert against this template and are kept verbatim rather than
// silently dropped: `.hci` (the icon font) — every icon in the markup uses the
// GLOBAL `.mat-sym` class instead — and `.image-canvas canvas`, which under
// Angular's emulated encapsulation could never match the Pixi canvas
// (image-editor.service.ts creates it with no `_ngcontent` attribute). Here it
// does match, and it agrees exactly with the inline styles that service
// already sets, so the painted result is unchanged.
const POINT_MASK = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'%3E%3Crect width='400' height='400' fill='white'/%3E%3Cpolygon points='200,0 373,100 373,300 200,400 27,300 27,100' fill='black'/%3E%3C/svg%3E")`
const FLAT_MASK = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'%3E%3Crect width='400' height='400' fill='white'/%3E%3Cpolygon points='400,200 300,373 100,373 0,200 100,27 300,27' fill='black'/%3E%3C/svg%3E")`

const CSS = `
${SURFACE_NAME}{display:contents}
${SURFACE_NAME} .hci{font-family:'hypercomb-icons';font-style:normal;font-weight:normal;line-height:1;-webkit-user-select:none;user-select:none}
${SURFACE_NAME} .editor-backdrop{position:fixed;inset:0;background:color-mix(in srgb,var(--md-surface-c-lowest) 82%,transparent);z-index:100000}
${SURFACE_NAME} .editor-panel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100001;width:min(90vw,28em);max-height:90vh;display:flex;flex-direction:column;background:var(--md-surface-c-low);color:var(--md-on-surface);border:1px solid var(--md-outline);border-radius:var(--hc-radius-floating);box-shadow:var(--md-elev-4);font-family:var(--hc-font)}
${SURFACE_NAME} .editor-header{display:flex;align-items:center;gap:.5em;padding:.6em .8em;border-bottom:1px solid var(--md-outline-variant)}
${SURFACE_NAME} .editor-header h3{margin:0;flex:1;font-size:.95em;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--md-on-surface-strong);cursor:text}
${SURFACE_NAME} .header-rename{margin:0;flex:1;min-width:0;font:inherit;font-size:.95em;font-weight:500;color:var(--md-on-surface-strong);background:transparent;border:none;border-bottom:1px solid var(--md-outline-variant);padding:0;outline:none}
${SURFACE_NAME} .header-rename:focus{border-bottom-color:var(--md-secondary)}
${SURFACE_NAME} .header-rename::placeholder{color:var(--md-on-surface-faint)}
${SURFACE_NAME} .header-rename.rename-denied,${SURFACE_NAME} .header-rename.rename-denied:focus{border-bottom-color:#e05050;color:#e05050}
${SURFACE_NAME} .header-icon{font-size:1.1em;color:var(--md-secondary);cursor:pointer}
${SURFACE_NAME} .editor-close{background:none;border:none;color:var(--md-on-surface-faint);font-size:1em;cursor:pointer;line-height:1;padding:.2em;border-radius:4px;transition:color .15s,background .15s}
${SURFACE_NAME} .editor-close:hover{color:#ff6666;background:rgba(255,100,100,.1)}
${SURFACE_NAME} .editor-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:.75em 1em;display:flex;flex-direction:column;gap:.75em}
${SURFACE_NAME} .image-section{display:flex;flex-direction:column;align-items:center;gap:.5em}
${SURFACE_NAME} .image-canvas{position:relative;height:min(40vh,400px);aspect-ratio:1;max-width:100%;background:#d0d0d4;border:1px solid #2a2a2e;border-radius:var(--hc-radius-card);overflow:hidden}
${SURFACE_NAME} .image-canvas canvas{display:block;width:100% !important;height:100% !important}
${SURFACE_NAME} .image-placeholder{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.4em;pointer-events:none}
${SURFACE_NAME} .image-placeholder span{color:#888;font-size:.8em}
${SURFACE_NAME} .placeholder-icon{font-size:2.5em !important;color:#999 !important}
${SURFACE_NAME} .editor-label{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:2;color:#fff;font-family:var(--hc-font);font-size:.95em;letter-spacing:.04em;padding:.25em .7em;border-radius:999px;background:rgba(0,0,0,.55);white-space:nowrap;max-width:80%;overflow:hidden;text-overflow:ellipsis}
${SURFACE_NAME} .hex-frame{position:absolute;inset:0;pointer-events:none;z-index:1;background:rgba(26,26,30,.55);-webkit-mask-image:${POINT_MASK};mask-image:${POINT_MASK};-webkit-mask-size:100% 100%;mask-size:100% 100%}
${SURFACE_NAME} .flat-top .hex-frame{-webkit-mask-image:${FLAT_MASK};mask-image:${FLAT_MASK}}
${SURFACE_NAME} .image-controls{display:flex;gap:.5em}
${SURFACE_NAME} .upload-btn,${SURFACE_NAME} .camera-btn,${SURFACE_NAME} .orientation-btn{display:flex;align-items:center;gap:.4em;background:#252528;border:1px solid #3a3a3e;border-radius:var(--hc-radius-floating);color:#ccc;cursor:pointer;font-size:.64em;padding:.45em 1em;transition:background .15s,border-color .15s}
${SURFACE_NAME} .upload-btn .hci,${SURFACE_NAME} .camera-btn .hci,${SURFACE_NAME} .orientation-btn .hci{font-size:1.1em;color:#c8975a}
${SURFACE_NAME} .upload-btn:hover,${SURFACE_NAME} .camera-btn:hover,${SURFACE_NAME} .orientation-btn:hover{background:#333336;border-color:#555}
${SURFACE_NAME} .link-btn{display:flex;align-items:center;justify-content:center;background:none;border:none;color:#666;cursor:pointer;padding:.2em;transition:color .15s}
${SURFACE_NAME} .link-btn:hover{color:#999}
${SURFACE_NAME} .link-btn.linked{color:#c8975a}
${SURFACE_NAME} .link-btn.linked:hover{color:#d4a76a}
${SURFACE_NAME} .link-icon{display:inline-block;width:14px;height:14px;position:relative}
${SURFACE_NAME} .link-icon::before,${SURFACE_NAME} .link-icon::after{content:'';position:absolute;width:8px;height:6px;border:2px solid currentColor;border-radius:3px}
${SURFACE_NAME} .link-icon::before{top:0;left:0;transform:rotate(-45deg)}
${SURFACE_NAME} .link-icon::after{bottom:0;right:0;transform:rotate(-45deg)}
${SURFACE_NAME} .link-icon.broken::before{border-color:#666}
${SURFACE_NAME} .link-icon.broken::after{border-color:#666}
${SURFACE_NAME} .camera-btn{display:none}
@media (pointer:coarse){${SURFACE_NAME} .camera-btn{display:flex}}
${SURFACE_NAME} .camera-overlay{position:fixed;inset:0;z-index:100002;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center}
${SURFACE_NAME} .camera-overlay video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
${SURFACE_NAME} .camera-hex-frame{position:absolute;inset:0;pointer-events:none;z-index:1;background:rgba(0,0,0,.6);-webkit-mask-image:${POINT_MASK};mask-image:${POINT_MASK};-webkit-mask-size:contain;mask-size:contain;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center}
${SURFACE_NAME} .camera-hex-frame.flat-top{-webkit-mask-image:${FLAT_MASK};mask-image:${FLAT_MASK}}
${SURFACE_NAME} .camera-controls{position:absolute;bottom:0;left:0;right:0;z-index:2;display:flex;justify-content:space-around;align-items:center;padding:1.5em;padding-bottom:calc(1.5em + var(--hc-safe-bottom, 0px))}
${SURFACE_NAME} .camera-shutter{width:4em;height:4em;border-radius:50%;border:4px solid #fff;background:transparent;cursor:pointer;position:relative}
${SURFACE_NAME} .camera-shutter::after{content:'';position:absolute;inset:4px;border-radius:50%;background:#fff}
${SURFACE_NAME} .camera-shutter:active::after{background:#c8975a}
${SURFACE_NAME} .camera-control-btn{width:3em;height:3em;border-radius:50%;border:none;background:rgba(255,255,255,.15);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center}
${SURFACE_NAME} .camera-control-btn .hci{font-size:1.2em}
${SURFACE_NAME} .fields{display:grid;grid-template-columns:auto 1fr 1fr auto auto 1fr 1fr auto;gap:.5em}
${SURFACE_NAME} .field-row{grid-column:1 / -1;display:grid;grid-template-columns:subgrid;align-items:center}
${SURFACE_NAME} .field-label{grid-column:1;white-space:nowrap;font-size:.8em;color:#888;display:flex;align-items:center;gap:.3em;padding-right:.4em;justify-self:start}
${SURFACE_NAME} .field-label .hci{font-size:1.1em;color:#c8975a}
${SURFACE_NAME} .link-input{grid-column:2 / -1}
${SURFACE_NAME} .link-input.link-denied{border-color:#e05050;color:#e05050}
${SURFACE_NAME} .link-input.link-warned{border-color:#d4a843;color:#d4a843}
${SURFACE_NAME} .field-input{background:#1e1e22;border:1px solid #333;border-radius:var(--hc-radius-floating);color:#e0e0e0;padding:.35em .5em;font-size:.8em;transition:border-color .15s;min-width:0}
${SURFACE_NAME} .field-input:focus{outline:none;border-color:#c8975a}
${SURFACE_NAME} .color-row{grid-column:1 / -1;display:grid;grid-template-columns:subgrid;gap:.5em}
${SURFACE_NAME} .color-control{grid-column:span 4;display:grid;grid-template-columns:subgrid;align-items:center}
${SURFACE_NAME} .color-btn{display:flex;align-items:center;gap:.25em;padding:.2em .4em .2em 0;color:#ccc;font-size:.8em;white-space:nowrap;cursor:default;justify-self:start}
${SURFACE_NAME} .color-btn .hci{font-size:1.1em;color:#c8975a}
${SURFACE_NAME} .color-text{grid-column:span 2;min-width:0}
${SURFACE_NAME} .color-picker{width:2em;height:2em;padding:0;border:1px solid #333;border-radius:var(--hc-radius-floating);background:none;cursor:pointer}
${SURFACE_NAME} .color-picker::-webkit-color-swatch-wrapper{padding:2px}
${SURFACE_NAME} .color-picker::-webkit-color-swatch{border:none;border-radius:3px}
${SURFACE_NAME} .editor-footer{display:flex;justify-content:space-between;align-items:center;padding:.6em .8em;border-top:1px solid #2a2a2e}
${SURFACE_NAME} .editor-footer button{padding:.4em 1.2em;border-radius:var(--hc-radius-floating);border:1px solid #3a3a3e;background:#252528;color:#ccc;cursor:pointer;font-size:.8em;transition:background .15s,border-color .15s}
${SURFACE_NAME} .editor-footer button:hover{background:#333336;border-color:#555}
${SURFACE_NAME} .editor-footer button.primary{background:#c8975a;border-color:#c8975a;color:#1a1a1e;font-weight:600}
${SURFACE_NAME} .editor-footer button.primary:hover{background:#d4a76a}
${SURFACE_NAME} .footer-tools{display:flex;gap:.4em}
${SURFACE_NAME} .tool-btn{display:flex;align-items:center;justify-content:center;width:2em;height:2em;padding:0 !important;border-radius:var(--hc-radius-floating);border:1px solid #3a3a3e;background:#252528;color:#888;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
${SURFACE_NAME} .tool-btn:hover{background:#333336;border-color:#555;color:#c8975a}
${SURFACE_NAME} .footer-actions{display:flex;gap:.5em}
@media (min-width:600px) and (max-width:1023px){
${SURFACE_NAME} .editor-panel{width:min(90vw,32em);max-height:85vh}
${SURFACE_NAME} .upload-btn,${SURFACE_NAME} .camera-btn,${SURFACE_NAME} .orientation-btn{padding:.6em 1.1em;font-size:.72em}
${SURFACE_NAME} .link-btn{padding:.4em}
${SURFACE_NAME} .editor-footer{padding:.6em}
${SURFACE_NAME} .editor-footer button{padding:.55em 1.4em;font-size:.85em}
${SURFACE_NAME} .tool-btn{width:2.5em;height:2.5em}
${SURFACE_NAME} .color-picker{width:2.5em;height:2.5em}
${SURFACE_NAME} .field-input{padding:.45em .55em;font-size:16px}
${SURFACE_NAME} .editor-close{padding:.4em;font-size:1.1em}
}
@media (max-width:599px){
${SURFACE_NAME} .editor-panel{width:100vw;height:100dvh;max-height:100dvh;top:0;left:0;transform:none;border-radius:0;border:none;padding-top:var(--hc-safe-top, 0px)}
${SURFACE_NAME} .editor-body{padding:.75em}
${SURFACE_NAME} .upload-btn,${SURFACE_NAME} .camera-btn,${SURFACE_NAME} .orientation-btn{padding:.65em 1.2em;font-size:.76em}
${SURFACE_NAME} .link-btn{padding:.5em}
${SURFACE_NAME} .editor-footer{padding:.6em;padding-bottom:calc(.6em + var(--hc-safe-bottom, 0px))}
${SURFACE_NAME} .editor-footer button{padding:.6em 1.6em;font-size:.9em}
${SURFACE_NAME} .tool-btn{width:2.75em;height:2.75em}
${SURFACE_NAME} .color-picker{width:2.75em;height:2.75em}
${SURFACE_NAME} .field-input{padding:.5em .6em;font-size:16px}
${SURFACE_NAME} .fields{grid-template-columns:auto 1fr auto}
${SURFACE_NAME} .color-row{grid-template-columns:1fr}
${SURFACE_NAME} .color-control{grid-column:1 / -1;grid-template-columns:auto 1fr 1fr auto}
${SURFACE_NAME} .editor-close{padding:.5em;font-size:1.2em}
}
@media (max-width:599px) and (orientation:landscape){
${SURFACE_NAME} .image-canvas{height:min(35vh,280px)}
}
${SURFACE_NAME} .qa-section{margin-top:1rem;padding:.75rem .9rem .9rem;background:rgba(255,225,74,.04);border:1px solid rgba(255,225,74,.18);border-radius:var(--hc-radius-card);display:flex;flex-direction:column;gap:.6rem}
${SURFACE_NAME} .qa-header{display:flex;align-items:center;gap:.45rem;color:#ffe14a}
${SURFACE_NAME} .qa-header h4{margin:0;font-size:.78rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,225,74,.78)}
${SURFACE_NAME} .qa-header .qa-icon{font-size:.85rem;color:rgba(255,225,74,.78)}
${SURFACE_NAME} .qa-item{display:flex;flex-direction:column;gap:.5rem;padding:.65rem 0 .2rem;border-top:1px solid rgba(255,225,74,.10)}
${SURFACE_NAME} .qa-item:first-of-type{border-top:0;padding-top:0}
${SURFACE_NAME} .qa-item.qa-answered{opacity:.78}
${SURFACE_NAME} .qa-question{margin:0;padding:.55rem .7rem;font-size:.92rem;line-height:1.45;color:#f7eecf;background:rgba(255,225,74,.13);border:1px solid rgba(255,225,74,.32);border-left-width:3px;border-radius:4px var(--hc-radius-card) var(--hc-radius-card) 4px}
${SURFACE_NAME} .qa-answer{margin:0;padding:.5rem .7rem;font-size:.88rem;line-height:1.45;color:rgba(232,232,232,.85);background:rgba(110,180,255,.08);border:1px solid rgba(110,180,255,.22);border-left-width:3px;border-radius:4px var(--hc-radius-card) var(--hc-radius-card) 4px}
${SURFACE_NAME} .qa-answer-row{display:flex;align-items:stretch;gap:.4rem;padding:.45rem .55rem;background:rgba(110,180,255,.05);border:1px solid rgba(110,180,255,.20);border-left-width:3px;border-radius:4px var(--hc-radius-card) var(--hc-radius-card) 4px}
${SURFACE_NAME} .qa-answer-input{flex:1;min-width:0;resize:vertical;min-height:2.2rem;font-family:inherit;font-size:.88rem;line-height:1.45;padding:.4rem .55rem}
${SURFACE_NAME} .qa-submit{flex-shrink:0;align-self:flex-end;padding:.35rem .95rem;background:rgba(110,180,255,.18);border:1px solid rgba(110,180,255,.45);border-radius:var(--hc-radius-control);color:#b6d4ff;font-size:.84rem;font-weight:600;letter-spacing:.02em;cursor:pointer;transition:background .15s ease,border-color .15s ease,color .15s ease}
${SURFACE_NAME} .qa-submit:hover{background:rgba(110,180,255,.28);border-color:rgba(110,180,255,.65);color:#d4e6ff}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-tile-editor', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

export class TileEditorElement extends HTMLElement {

  // ── subscriptions and timers (rule: tear down what you wire) ───────────
  #offs: Array<() => void> = []
  /** Every pending `setTimeout` id, so a real teardown leaves nothing armed.
   *  The component leaked four of these (canvas init, rename focus, the Q&A
   *  refresh, the camera bind); a component that outlives the app can afford
   *  that and a node the surface host can remove cannot. */
  #timers = new Set<number>()

  // ── state (the component's fields and signals, as plain fields) ────────
  /** Tracks the previous open state so the open/close TRANSITIONS run once. */
  #wasOpen = false
  /** The Link field's text. A field, not the DOM: the link can change from
   *  OUTSIDE the editor while it is open (dropping a link onto an open editor
   *  calls `setLink` on the service), and `save()` commits THIS value — a
   *  stale one does not merely hide the drop, it erases it. */
  #linkValue = ''
  /** The tile's reading in the CURRENT locale — empty means it has none and
   *  draws under its raw address. Editing this never moves the tile. */
  #titleValue = ''
  #titleLoadedFor = ''
  /** True while the heading is a field. */
  #renaming = false
  /** Set when a commit was refused because a sibling already reads that way.
   *  Cleared as soon as the participant edits again — the warning describes
   *  the text that was rejected, not the field's current contents. */
  #renameDenied = false
  #linkDenied = false
  #linkWarned = false
  #linkSafetyReason = ''
  #borderColorValue = ''
  #backgroundColorValue = ''
  #isFlat = false
  #isLinked = true
  #cameraActive = false
  #cameraFlat = false
  #stream: MediaStream | null = null

  // ── Q&A panel state ───────────────────────────────────────────────────
  // `#qaItems` is the derived list of (question, answer) pairs for the current
  // cell, refreshed on open and after each answer submission. `#qaAnswerDraft`
  // holds the in-flight typed text per question id — it is the model behind
  // the textareas and is never read back out of the DOM.
  #qaItems: QaViewItem[] = []
  #qaAnswerDraft: Record<string, string> = {}
  /** The live rows, keyed by question id. See the focus note in the header:
   *  a row whose answered-state has not changed is never touched. */
  #qaRows = new Map<string, QaRow>()

  // ── chrome, built once and kept ───────────────────────────────────────
  #backdrop: HTMLDivElement | null = null
  #panel: HTMLDivElement | null = null
  #header: HTMLElement | null = null
  #headerIcon: HTMLSpanElement | null = null
  #heading: HTMLHeadingElement | null = null
  #renameInput: HTMLInputElement | null = null
  #closeButton: HTMLButtonElement | null = null
  #canvasHost: HTMLDivElement | null = null
  #placeholder: HTMLDivElement | null = null
  #placeholderText: HTMLSpanElement | null = null
  #hexFrame: HTMLDivElement | null = null
  #label: HTMLDivElement | null = null
  #linkButton: HTMLButtonElement | null = null
  #linkIcon: HTMLSpanElement | null = null
  #uploadText: Text | null = null
  #cameraText: Text | null = null
  #orientationButton: HTMLButtonElement | null = null
  #orientationText: Text | null = null
  #linkFieldText: Text | null = null
  #linkInput: HTMLInputElement | null = null
  #backgroundText: Text | null = null
  #backgroundTextInput: HTMLInputElement | null = null
  #backgroundPicker: HTMLInputElement | null = null
  #borderText: Text | null = null
  #borderTextInput: HTMLInputElement | null = null
  #borderPicker: HTMLInputElement | null = null
  #body: HTMLDivElement | null = null
  #qaSection: HTMLDivElement | null = null
  /** The Q&A section's header. Held so the row walk knows where the rows
   *  START — the anchor has to begin AFTER the header, or the first row would
   *  be inserted before it on every render. */
  #qaHeader: HTMLElement | null = null
  #qaTitle: HTMLHeadingElement | null = null
  #searchButton: HTMLButtonElement | null = null
  #hideTextButton: HTMLButtonElement | null = null
  #hideTextIcon: HTMLSpanElement | null = null
  #footerCancel: HTMLButtonElement | null = null
  #footerSave: HTMLButtonElement | null = null
  #cameraOverlay: HTMLDivElement | null = null
  #video: HTMLVideoElement | null = null
  #cameraHexFrame: HTMLDivElement | null = null

  // ── service access (the getters ARE the state) ────────────────────────

  #editor(): TileEditorService | undefined {
    return window.ioc?.get?.(TILE_EDITOR_SERVICE) as TileEditorService | undefined
  }

  #imageEditor(): ImageEditorService | undefined {
    return window.ioc?.get?.(IMAGE_EDITOR_SERVICE) as ImageEditorService | undefined
  }

  #drone(): EditorDrone | undefined {
    return window.ioc?.get?.(TILE_EDITOR_DRONE) as EditorDrone | undefined
  }

  /** `open = mode === 'editing'` — the component's one derived signal. */
  #isOpen(): boolean {
    return this.#editor()?.mode === 'editing'
  }

  #cell(): string {
    return this.#editor()?.cell ?? ''
  }

  // ── lifecycle ─────────────────────────────────────────────────────────

  connectedCallback(): void {
    installCss()
    this.#build()

    // TWO EventTarget listeners where the component had SEVEN fromRuntime
    // subscriptions over the same two targets. Both come off on disconnect
    // with these exact function references.
    this.#editor()?.addEventListener('change', this.#onServiceChange)
    this.#imageEditor()?.addEventListener('change', this.#onImageChange)

    this.#offs.push(
      // The effect half. Keeps the Q&A panel in sync with notes changes —
      // covers async hydration on first open (the warm cache wasn't ready
      // yet) and reflects newly-submitted answers without polling.
      //
      // IDEMPOTENT BY CONSTRUCTION: the handler RE-DERIVES the whole list
      // from the cell's notes, so the same `notes:changed` arriving twice
      // (the gesture's emit, then the commit's post-commit reconcile) lands
      // on the same list. Nothing here appends or counts.
      //
      // The subscribe-time REPLAY is harmless for the same reason the
      // component's was: `#wasOpen` is false at mount, so the replay finds
      // the guard shut and re-opens nothing.
      EffectBus.on('notes:changed', this.#onNotesChanged),
      // THE PIPE WAS IMPURE. The Angular template resolved twenty-odd strings
      // through the `t` pipe, declared `pure: false`, so every
      // change-detection tick re-read them and `/language ja` re-labelled an
      // OPEN editor on the spot — including both footer buttons, which are
      // two of its three exits. An element renders when it decides to, so the
      // locale switch has to be a reason to re-resolve.
      EffectBus.on('locale:changed', () => this.#render()),
    )

    // Enter saves. RAW listener, exactly as the component had it
    // (`document.addEventListener('keydown', …)`, NOT an Angular
    // `keydown.enter` HostListener) — so there is deliberately no modifier
    // guard on this one: the original fired on Ctrl/Alt/Shift/Meta-Enter too,
    // and adding a guard would itself be the regression.
    //
    // ONE DELIBERATE DIFFERENCE: the component added this listener on the
    // OPEN transition and removed it on close. A node the surface host can
    // MOVE (insertBefore fires disconnected+connected) would silently lose
    // Enter-to-save on a re-order, because the open transition has already
    // happened. So it is bound for the element's whole connected life and
    // `#onKeyDown` early-returns whenever the editor is not open — which is
    // exactly when the component's listener was absent.
    document.addEventListener('keydown', this.#onKeyDown)

    this.#render()
  }

  disconnectedCallback(): void {
    // Cheap, re-established on connect: safe to drop immediately, and they
    // MUST be dropped or a move would double-subscribe.
    this.#offs.forEach(off => off())
    this.#offs = []
    this.#editor()?.removeEventListener('change', this.#onServiceChange)
    this.#imageEditor()?.removeEventListener('change', this.#onImageChange)
    document.removeEventListener('keydown', this.#onKeyDown)

    // A MOVE IS NOT A TEARDOWN. `insertBefore` on an attached node fires
    // disconnected then connected, and the shell surface host reorders its
    // survivors exactly that way whenever the registry re-syncs. The Angular
    // component was a view, not a node — a reorder never destroyed it — so
    // running ngOnDestroy's destructive half here unconditionally would kill
    // a LIVE Pixi editor and switch off a RUNNING camera because some
    // unrelated surface happened to register. Defer one microtask and let the
    // re-attach cancel it; a genuine removal never comes back.
    queueMicrotask(() => {
      if (this.isConnected) return
      this.#clearTimers()
      this.#closeCamera()
      this.#imageEditor()?.destroy()
    })
  }

  // ── timers ────────────────────────────────────────────────────────────

  #later(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => { this.#timers.delete(id); fn() }, ms)
    this.#timers.add(id)
  }

  #clearTimers(): void {
    this.#timers.forEach(id => window.clearTimeout(id))
    this.#timers.clear()
  }

  // ── the service listeners ─────────────────────────────────────────────

  /** TileEditorService `change` — six of the component's seven signals plus
   *  its open/close side effects. `#onEditorChange` first (it was a raw
   *  listener that ran synchronously), then the paint. */
  #onServiceChange = (): void => {
    this.#onEditorChange()
    this.#render()
  }

  /** ImageEditorService `change` — the seventh signal (`hasImage`), which
   *  only gates the drop placeholder. */
  #onImageChange = (): void => { this.#render() }

  #onNotesChanged = (): void => {
    if (this.#wasOpen) this.#refreshQaItems()
    this.#render()
  }

  // ── open/close side effects ───────────────────────────────────────────

  #onEditorChange = (): void => {
    const service = this.#editor()
    const isOpen = service?.mode === 'editing'
    if (isOpen && !this.#wasOpen) {
      // HOISTED, and this is the one behavioural fix in the port. The two
      // `set…Color` calls below dispatch `change` SYNCHRONOUSLY, which
      // re-enters this handler — and with `#wasOpen` still false the whole
      // open branch ran again, up to THREE times for a tile with no stored
      // colours. Each pass scheduled its own `#initCanvas`, and
      // `ImageEditorService.initialize` only sets `#initialized` after its
      // `await`, so three concurrent calls all passed the guard and appended
      // three Pixi Applications to one div. Claiming the transition FIRST
      // sends the re-entrant calls down the already-open branch (a no-op:
      // the field it syncs was just written from the same service), so every
      // side effect below happens exactly once. Nothing else changes — the
      // defaults are still persisted, in the same order.
      this.#wasOpen = true

      this.#linkValue = service?.link ?? ''
      this.#borderColorValue = service?.borderColor || '#c8975a'
      this.#backgroundColorValue = service?.backgroundColor || '#1e1e1e'
      // ensure defaults are persisted in properties
      if (!service?.borderColor) service?.setBorderColor(this.#borderColorValue)
      if (!service?.backgroundColor) service?.setBackgroundColor(this.#backgroundColorValue)

      this.#later(() => { void this.#initCanvas() }, 0)

      // Refresh Q&A list for the opened cell. Notes are read synchronously
      // from NotesService — if the cache hasn't warmed yet (first selection
      // after page load), the list will be empty and fill in after the next
      // `notes:changed`.
      this.#refreshQaItems()
      this.#loadTitle()
    }
    // Already open, and the link changed from OUTSIDE the field — a link
    // dropped onto the open editor. The field has to follow: it is what
    // `save` commits, so a stale one does not merely hide the drop, it
    // erases it. Never while the participant is typing in that very input.
    //
    // Because of the hoist above this now also runs on the opening pass
    // itself, where it is a guaranteed no-op: `#linkValue` was set from
    // `service.link` four lines ago, so `live !== this.#linkValue` is false.
    if (isOpen && this.#wasOpen) {
      const live = service?.link ?? ''
      const typingHere = document.activeElement instanceof HTMLElement
        && document.activeElement.classList.contains('link-input')
      if (!typingHere && live !== this.#linkValue) this.#linkValue = live
    }

    if (!isOpen && this.#wasOpen) {
      if (this.#cameraActive) this.#closeCamera()
      this.#linkValue = ''
      this.#titleValue = ''
      this.#titleLoadedFor = ''
      this.#renaming = false
      this.#renameDenied = false
      this.#borderColorValue = ''
      this.#backgroundColorValue = ''
      this.#qaItems = []
      this.#qaAnswerDraft = {}
    }
    this.#wasOpen = isOpen
  }

  // ── the tile's reading (rename) ───────────────────────────────────────

  /** Segments of the cell being edited: where we are, plus its name. */
  #cellSegments(): string[] {
    const target = this.#editor()?.targetSegments ?? []
    if (target.length > 0) return [...target]
    const lineage = window.ioc?.get?.(LINEAGE) as LineageLike | undefined
    const cell = this.#cell()
    if (!cell) return []
    const here = (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    return [...here, cell]
  }

  /** Read the current locale's title when the panel opens. Async, so a slow
   *  read can land after the participant has started typing or after they've
   *  moved to another tile — `#titleLoadedFor` makes sure a stale answer never
   *  overwrites either. */
  #loadTitle(): void {
    const decorations = window.ioc?.get?.(DECORATION_SERVICE) as DecorationsLike | undefined
    const segments = this.#cellSegments()
    const token = segments.join('/')
    this.#titleValue = ''
    this.#titleLoadedFor = ''
    if (!decorations?.titleOf || segments.length === 0) { this.#render(); return }
    void decorations.titleOf(segments).then(title => {
      if (this.#titleLoadedFor !== '' || this.#cellSegments().join('/') !== token) return
      this.#titleValue = title
      this.#titleLoadedFor = token
      // The signal write that used to schedule change detection — here, the
      // explicit repaint. Without it the heading and the canvas label stay
      // visibly empty until something else happens to render.
      this.#render()
    }).catch(() => { /* no title is a normal state, not an error */ })
  }

  /** Typing clears a refusal — the warning described the rejected text. */
  #onTitleInput(value: string): void {
    this.#titleValue = value
    if (this.#renameDenied) this.#renameDenied = false
    // The canvas label draws `titleValue || cell`, so it follows the field
    // live. `#render` writes an input's value only when it differs, so the
    // caret in the field it came from never moves.
    this.#render()
  }

  /** Turn the heading into a field and put the caret in it. Pre-selected so
   *  typing replaces — the common case is renaming outright, not appending. */
  #startRenaming(): void {
    if (this.#renaming) return
    this.#renaming = true
    this.#render()
    // Deferred exactly as the component deferred it. `#render` has already
    // attached the field, so this is no longer waiting for change detection —
    // it is staying out of the way of the click that opened it, whose default
    // handling would otherwise land after us and drop the selection.
    this.#later(() => {
      const el = this.#renameInput
      el?.focus()
      el?.select()
    }, 0)
  }

  /** Commit the typed reading for the active locale. Empty clears it.
   *
   *  Reached from blur, and from the panel-wide Enter that saves the editor —
   *  that handler lives on `document`, so this element handler runs first and
   *  the rename lands before the panel closes. The `#renaming` guard makes the
   *  second arrival a no-op; `setTitle` also reports 'noop' when nothing
   *  moved, so an unchanged heading costs no commit and no repaint. */
  #commitRename(): void {
    if (!this.#renaming) return
    this.#renaming = false
    this.#render()
    const decorations = window.ioc?.get?.(DECORATION_SERVICE) as DecorationsLike | undefined
    const segments = this.#cellSegments()
    if (!decorations?.setTitle || segments.length === 0) return
    void decorations.setTitle(segments, this.#titleValue.trim())
      .then(outcome => {
        if (outcome !== 'duplicate') return
        // Refused: hand the field back with the rejected text still in it, so
        // the participant can adjust rather than retype from nothing.
        this.#renameDenied = true
        this.#startRenaming()
      })
      .catch((err: unknown) => console.warn('[tile-editor] title failed', err))
  }

  /** Abandon the edit and restore what is stored — the typed text is never
   *  committed.
   *
   *  VERIFIED BEHAVIOUR: Escape also closes the whole editor. The app-wide
   *  escape cascade listens in the capture phase, so it runs before this
   *  handler and `stopPropagation` cannot hold it back; the call below is kept
   *  because it is correct the moment the cascade moves to bubble. Backing out
   *  of the rename ALONE would mean registering it with the mode stack so the
   *  cascade pops this first — the sanctioned route, not a rival capture-phase
   *  listener. Either way no unwanted text is stored, which is what matters. */
  #cancelRename(event?: Event): void {
    event?.stopPropagation()
    this.#renaming = false
    this.#renameDenied = false
    this.#loadTitle()
    this.#render()
  }

  // ── Q&A panel logic ───────────────────────────────────────────────────

  /** Re-derive `#qaItems` from the cell's current notes. Pairs each
   *  `[Q ...]`-prefixed note with the matching `[A:<qId>] ...` answer note
   *  (when present). Called on editor open, on `notes:changed`, and after
   *  every answer submission. A full re-derive, which is what makes a
   *  repeated `notes:changed` free. */
  #refreshQaItems(): void {
    const notesService = window.ioc?.get?.(NOTES_SERVICE) as NotesLike | undefined
    const cell = this.#cell()
    if (!notesService || !cell) { this.#qaItems = []; return }

    const notes = notesService.notesFor(cell)
    const questions = new Map<string, string>()   // q-note id → question text
    const answers = new Map<string, string>()     // q-note id → answer text

    for (const note of notes) {
      const text = (note.text ?? '').trim()
      const q = Q_NOTE_RE.exec(text)
      if (q) {
        questions.set(note.id, q[1].trim())
        continue
      }
      const a = A_NOTE_RE.exec(text)
      if (a) {
        answers.set(a[1], a[2].trim())
      }
    }

    const items: QaViewItem[] = []
    for (const [qId, question] of questions) {
      items.push({ qId, question, answer: answers.get(qId) ?? null })
    }
    this.#qaItems = items
  }

  /** Submit an inline answer for a Q&A item. Posts a note of the form
   *  `[A:<qId>] <text>` on the same cell — `notes:changed` will fire shortly
   *  after; we also refresh on a short delay so the panel reflects the new
   *  answer without a manual reload. */
  #submitAnswer(qId: string): void {
    const text = (this.#qaAnswerDraft[qId] ?? '').trim()
    if (!text) return
    const cell = this.#cell()
    if (!cell) return
    EffectBus.emit('note:commit', { cellLabel: cell, text: `[A:${qId}] ${text}` })
    this.#qaAnswerDraft[qId] = ''
    // The two-way `[(ngModel)]` used to push the cleared draft back into the
    // textarea; `#render` does it, and only because the values now differ.
    this.#render()
    // Notes commit is async (resource put + layer cascade). Refresh on a
    // short delay so the new [A:…] note shows up in the panel.
    this.#later(() => { this.#refreshQaItems(); this.#render() }, 300)
  }

  // ── keyboard ──────────────────────────────────────────────────────────

  #onKeyDown = (e: KeyboardEvent): void => {
    // The gate that stands in for the component's add-on-open /
    // remove-on-close: whenever this returns, the component had no listener.
    if (!this.#isOpen()) return
    if (e.key !== 'Enter') return
    // allow Enter inside text inputs for normal behavior — only save on bare
    // Enter. (Verbatim: the original exempts TEXTAREA only, so Enter in the
    // link or colour fields does save.)
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'TEXTAREA') return
    e.preventDefault()
    this.#save()
  }

  // ── canvas initialization ─────────────────────────────────────────────

  async #initCanvas(): Promise<void> {
    const el = this.#canvasHost
    // The component retried up to five times at 50ms because Angular's `@if`
    // had not created the host div yet when the open pass ran. Here the div
    // is built once in `#build()` and always exists, so there is nothing to
    // wait for — the retry loop was scaffolding for a lifecycle this element
    // does not have.
    if (!el) return

    const settings = window.ioc?.get?.(SETTINGS) as SettingsLike | undefined
    const size = settings?.editorSize ?? 400

    const imageEditor = this.#imageEditor()
    if (!imageEditor) return
    await imageEditor.initialize(el, size)

    // set initial colors
    imageEditor.setBorderColor(this.#borderColorValue)
    imageEditor.setBackgroundColor(this.#backgroundColorValue)

    // if there's a large blob, load it
    const service = this.#editor()
    if (service?.largeBlob) {
      const transform = (service.properties as Record<string, any>)['large']
      await imageEditor.loadImage(
        service.largeBlob,
        transform ? { x: transform.x ?? 0, y: transform.y ?? 0, scale: transform.scale ?? 1 } : undefined,
      )
    }
  }

  // ── image upload ──────────────────────────────────────────────────────

  #onImageDrop = (event: DragEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    const file = event.dataTransfer?.files?.[0]
    if (file && file.type.startsWith('image/')) {
      void this.#loadImageFile(file)
    }
  }

  #onDragOver = (event: DragEvent): void => {
    event.preventDefault()
  }

  #onFileSelect = (event: Event): void => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (file) {
      void this.#loadImageFile(file)
      input.value = '' // reset so same file can be re-selected
    }
  }

  async #loadImageFile(file: File): Promise<void> {
    const blob = new Blob([await file.arrayBuffer()], { type: file.type })
    this.#editor()?.setLargeBlob(blob)
    await this.#imageEditor()?.loadImage(blob)
  }

  // ── property changes ──────────────────────────────────────────────────

  /** Safety-checked link update — runs on blur so we don't call an LLM on
   *  every keystroke. */
  #onLinkBlur = (): void => {
    const value = this.#linkValue.trim()

    // reset safety state
    this.#linkDenied = false
    this.#linkWarned = false
    this.#linkSafetyReason = ''

    // empty link — clear it immediately
    if (!value) {
      this.#editor()?.setLink('')
      this.#render()
      return
    }

    // run safety check (same service used by LinkDropWorker)
    const safety = window.ioc?.get?.(LINK_SAFETY_SERVICE) as LinkSafetyLike | undefined
    if (!safety) {
      // no safety service loaded — allow directly
      this.#editor()?.setLink(value)
      return
    }

    this.#render()
    void safety.check(value).then(verdict => {
      if (verdict.decision === 'deny') {
        this.#linkDenied = true
        this.#linkSafetyReason = verdict.reason
        this.#editor()?.setLink('')
        this.#render()
        return
      }
      if (verdict.decision === 'warn') {
        this.#linkWarned = true
        this.#linkSafetyReason = verdict.reason
      }
      this.#editor()?.setLink(value)
      this.#render()
    })
  }

  #onBorderColorChange = (value: string): void => {
    this.#editor()?.setBorderColor(value)
    this.#imageEditor()?.setBorderColor(value)
  }

  #onBackgroundColorChange = (value: string): void => {
    this.#editor()?.setBackgroundColor(value)
    this.#imageEditor()?.setBackgroundColor(value)
  }

  // ── link toggle ───────────────────────────────────────────────────────

  #toggleLink = (): void => {
    this.#isLinked = !this.#isLinked
    const imageEditor = this.#imageEditor()
    if (imageEditor) imageEditor.linked = this.#isLinked
    // when re-linking, sync current transform to both orientations immediately
    if (this.#isLinked && imageEditor) {
      const transform = imageEditor.getTransform()
      const service = this.#editor()
      service?.updateTransform(transform.x, transform.y, transform.scale, 'point-top')
      service?.updateTransform(transform.x, transform.y, transform.scale, 'flat-top')
    }
    this.#render()
  }

  // ── orientation toggle ────────────────────────────────────────────────

  #toggleOrientation = (): void => {
    const imageEditor = this.#imageEditor()
    const service = this.#editor()
    if (!imageEditor) return

    // save current transform before switching
    const currentOrientation = imageEditor.orientation ?? 'point-top'
    const currentTransform = imageEditor.getTransform()
    service?.updateTransform(
      currentTransform.x, currentTransform.y, currentTransform.scale, currentOrientation
    )

    // switch to the other orientation (canvas stays same size)
    const nextOrientation = currentOrientation === 'point-top' ? 'flat-top' as const : 'point-top' as const

    // when linked, keep same position; when unlinked, load saved transform
    let transform: { x: number; y: number; scale: number } | undefined
    if (!this.#isLinked) {
      const props = service?.properties as Record<string, any> | undefined
      const savedTransform = nextOrientation === 'flat-top'
        ? props?.['flat']?.large
        : props?.['large']
      transform = savedTransform
        ? { x: savedTransform.x ?? 0, y: savedTransform.y ?? 0, scale: savedTransform.scale ?? 1 }
        : undefined
    }

    this.#isFlat = nextOrientation === 'flat-top'
    this.#render()
    void imageEditor.setOrientation(nextOrientation, transform)
  }

  // ── camera ────────────────────────────────────────────────────────────

  #openCamera = async (): Promise<void> => {
    try {
      this.#stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      this.#cameraActive = true
      this.#cameraFlat = this.#isFlat
      // The component needed `setTimeout(…, 0)` because `@if` had not created
      // the <video> yet. Here `#render` attaches a node that already exists,
      // so the assignment is direct — and a deferred assignment would be a
      // window in which a close could land between the two.
      this.#render()
      if (this.#video) this.#video.srcObject = this.#stream
    } catch {
      // permission denied or no camera
    }
  }

  #capturePhoto = async (): Promise<void> => {
    const video = this.#video
    if (!video || !video.videoWidth) return

    const size = Math.min(video.videoWidth, video.videoHeight)
    const sx = (video.videoWidth - size) / 2
    const sy = (video.videoHeight - size) / 2

    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size)

    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/webp', 0.9),
    )

    this.#closeCamera()
    this.#editor()?.setLargeBlob(blob)
    await this.#imageEditor()?.loadImage(blob)
  }

  /** Every camera exit funnels here: the × button, the shutter, the editor
   *  closing, and a real teardown. Stops every track on whatever stream we
   *  hold. */
  #closeCamera = (): void => {
    this.#stream?.getTracks().forEach(track => track.stop())
    this.#stream = null
    // Angular's `@if` destroyed the <video> along with the overlay, which took
    // the srcObject with it. Ours survives, so the reference has to be dropped
    // by hand — otherwise the element keeps a stopped stream alive and the
    // last frame stays frozen on screen for the next open.
    if (this.#video) this.#video.srcObject = null
    this.#cameraActive = false
    this.#render()
  }

  #toggleCameraOrientation = (): void => {
    this.#cameraFlat = !this.#cameraFlat
    this.#render()
  }

  // ── search ────────────────────────────────────────────────────────────

  /** Google Images for whatever this tile is called. URL and encoding are
   *  verbatim from the component — `tbm=isch` is the image tab, and the query
   *  is the RAW cell address, `encodeURIComponent`-escaped. */
  #searchGoogle = (): void => {
    const q = this.#cell()
    if (q) window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`, '_blank')
  }

  #toggleHideText = (): void => {
    const service = this.#editor()
    if (!service) return
    service.setHideText(!service.hideText)
  }

  // ── save / cancel ─────────────────────────────────────────────────────

  #save = (): void => {
    // Commit the current link input value in case blur hasn't fired yet
    // (e.g. user pastes a URL and clicks save directly)
    this.#editor()?.setLink(this.#linkValue.trim())
    void this.#drone()?.saveAndComplete?.()
  }

  #cancel = (): void => {
    this.#drone()?.cancelEditing?.()
  }

  // ── chrome (built once, detached) ─────────────────────────────────────

  #build(): void {
    if (this.#panel) return

    // ── backdrop ──
    // Clicking the field SAVES — it does not cancel. That is the component's
    // binding, and it is the surprising one, so it is worth naming: the
    // editor treats "click away" as "done", not "throw it away".
    const backdrop = document.createElement('div')
    backdrop.className = 'editor-backdrop'
    backdrop.addEventListener('click', () => { this.#save() })

    // ── panel ──
    const panel = document.createElement('div')
    panel.className = 'editor-panel'
    panel.setAttribute('role', 'dialog')

    // header — the heading IS the rename control
    const header = document.createElement('header')
    header.className = 'editor-header'

    const headerIcon = document.createElement('span')
    headerIcon.className = 'mat-sym header-icon'
    headerIcon.setAttribute('role', 'button')
    headerIcon.tabIndex = 0
    headerIcon.textContent = 'edit'
    headerIcon.addEventListener('click', () => { this.#startRenaming() })
    // `(keydown.enter)` — Angular's KeyEventsPlugin composes the binding name
    // from the held modifiers, so this matched ONLY an unmodified Enter
    // (Ctrl-Enter produced `control.enter` and fell through). The guard keeps
    // those chords with whoever owns them.
    headerIcon.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return
      if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return
      this.#startRenaming()
    })

    const heading = document.createElement('h3')
    heading.addEventListener('click', () => { this.#startRenaming() })

    const renameInput = document.createElement('input')
    renameInput.className = 'header-rename'
    renameInput.type = 'text'
    renameInput.name = 'tile-name'
    renameInput.addEventListener('input', () => { this.#onTitleInput(renameInput.value) })
    renameInput.addEventListener('blur', () => { this.#commitRename() })
    // `(keydown.escape)` — same KeyEventsPlugin spelling as above, same guard.
    renameInput.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return
      this.#cancelRename(event)
    })

    const closeButton = document.createElement('button')
    closeButton.className = 'editor-close'
    closeButton.type = 'button'
    closeButton.addEventListener('click', () => { this.#cancel() })
    const closeIcon = document.createElement('span')
    closeIcon.className = 'mat-sym'
    closeIcon.textContent = 'arrow_back'
    closeButton.appendChild(closeIcon)

    header.append(headerIcon, heading, closeButton)

    // ── body ──
    const body = document.createElement('div')
    body.className = 'editor-body'

    // image section
    const imageSection = document.createElement('div')
    imageSection.className = 'image-section'

    const canvasHost = document.createElement('div')
    canvasHost.className = 'image-canvas'
    canvasHost.addEventListener('dragover', this.#onDragOver)
    canvasHost.addEventListener('drop', this.#onImageDrop)

    const placeholder = document.createElement('div')
    placeholder.className = 'image-placeholder'
    const placeholderIcon = document.createElement('span')
    placeholderIcon.className = 'mat-sym placeholder-icon'
    placeholderIcon.textContent = 'image'
    const placeholderText = document.createElement('span')
    placeholder.append(placeholderIcon, placeholderText)

    const hexFrame = document.createElement('div')
    hexFrame.className = 'hex-frame'

    const label = document.createElement('div')
    label.className = 'editor-label'

    // Template order inside the host: placeholder, hex frame, label. Pixi's
    // canvas is appended after all three by ImageEditorService.
    canvasHost.append(placeholder, hexFrame, label)

    const imageControls = document.createElement('div')
    imageControls.className = 'image-controls'

    const linkButton = document.createElement('button')
    linkButton.type = 'button'
    linkButton.className = 'link-btn'
    linkButton.addEventListener('click', () => { this.#toggleLink() })
    const linkIcon = document.createElement('span')
    linkIcon.className = 'link-icon'
    linkButton.appendChild(linkIcon)

    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.name = 'tile-image'
    fileInput.accept = 'image/*'
    fileInput.hidden = true
    fileInput.addEventListener('change', this.#onFileSelect)

    const uploadButton = document.createElement('button')
    uploadButton.type = 'button'
    uploadButton.className = 'upload-btn'
    uploadButton.addEventListener('click', () => { fileInput.click() })
    const uploadIcon = document.createElement('span')
    uploadIcon.className = 'mat-sym'
    uploadIcon.textContent = 'upload'
    const uploadText = document.createTextNode('')
    uploadButton.append(uploadIcon, uploadText)

    const cameraButton = document.createElement('button')
    cameraButton.type = 'button'
    cameraButton.className = 'camera-btn'
    cameraButton.addEventListener('click', () => { void this.#openCamera() })
    const cameraIcon = document.createElement('span')
    cameraIcon.className = 'mat-sym'
    cameraIcon.textContent = 'photo_camera'
    const cameraText = document.createTextNode('')
    cameraButton.append(cameraIcon, cameraText)

    const orientationButton = document.createElement('button')
    orientationButton.type = 'button'
    orientationButton.className = 'orientation-btn'
    orientationButton.addEventListener('click', () => { this.#toggleOrientation() })
    const orientationIcon = document.createElement('span')
    orientationIcon.className = 'mat-sym'
    orientationIcon.textContent = 'crop_rotate'
    const orientationText = document.createTextNode('')
    orientationButton.append(orientationIcon, orientationText)

    imageControls.append(linkButton, uploadButton, cameraButton, orientationButton, fileInput)
    imageSection.append(canvasHost, imageControls)

    // property fields
    const fields = document.createElement('div')
    fields.className = 'fields'

    const linkRow = document.createElement('label')
    linkRow.className = 'field-row'
    const linkFieldLabel = document.createElement('span')
    linkFieldLabel.className = 'field-label'
    const linkFieldIcon = document.createElement('span')
    linkFieldIcon.className = 'mat-sym'
    linkFieldIcon.textContent = 'link'
    const linkFieldText = document.createTextNode('')
    linkFieldLabel.append(linkFieldIcon, linkFieldText)
    const linkInput = document.createElement('input')
    linkInput.className = 'field-input link-input'
    linkInput.type = 'text'
    linkInput.name = 'tile-link'
    // A literal in the template, not a catalog key — `editor.link-placeholder`
    // exists in the shell catalogs but nothing ever rendered it.
    linkInput.placeholder = 'https://...'
    linkInput.addEventListener('input', () => { this.#linkValue = linkInput.value })
    linkInput.addEventListener('blur', this.#onLinkBlur)
    linkRow.append(linkFieldLabel, linkInput)

    const colorRow = document.createElement('div')
    colorRow.className = 'color-row'

    const background = this.#buildColorControl('palette', '#1E1E1E', 'tile-background-color', (value) => {
      this.#backgroundColorValue = value
      this.#onBackgroundColorChange(value)
    })
    const border = this.#buildColorControl('border_color', '#000000', 'tile-border-color', (value) => {
      this.#borderColorValue = value
      this.#onBorderColorChange(value)
    })
    colorRow.append(background.control, border.control)

    fields.append(linkRow, colorRow)

    // Q&A panel
    const qaSection = document.createElement('div')
    qaSection.className = 'qa-section'
    const qaHeader = document.createElement('header')
    qaHeader.className = 'qa-header'
    const qaIcon = document.createElement('span')
    qaIcon.className = 'mat-sym qa-icon'
    qaIcon.textContent = 'quiz'
    const qaTitle = document.createElement('h4')
    qaHeader.append(qaIcon, qaTitle)
    qaSection.appendChild(qaHeader)

    body.append(imageSection, fields)

    // ── footer ──
    const footer = document.createElement('footer')
    footer.className = 'editor-footer'

    const footerTools = document.createElement('div')
    footerTools.className = 'footer-tools'

    const searchButton = document.createElement('button')
    searchButton.type = 'button'
    searchButton.className = 'tool-btn'
    searchButton.addEventListener('click', () => { this.#searchGoogle() })
    const searchIcon = document.createElement('span')
    searchIcon.className = 'mat-sym'
    searchIcon.textContent = 'search'
    searchButton.appendChild(searchIcon)

    const hideTextButton = document.createElement('button')
    hideTextButton.type = 'button'
    hideTextButton.className = 'tool-btn'
    hideTextButton.addEventListener('click', () => { this.#toggleHideText() })
    const hideTextIcon = document.createElement('span')
    hideTextIcon.className = 'mat-sym'
    hideTextButton.appendChild(hideTextIcon)

    footerTools.append(searchButton, hideTextButton)

    const footerActions = document.createElement('div')
    footerActions.className = 'footer-actions'
    const footerCancel = document.createElement('button')
    footerCancel.type = 'button'
    footerCancel.addEventListener('click', () => { this.#cancel() })
    const footerSave = document.createElement('button')
    footerSave.type = 'button'
    footerSave.className = 'primary'
    footerSave.addEventListener('click', () => { this.#save() })
    footerActions.append(footerCancel, footerSave)

    footer.append(footerTools, footerActions)

    panel.append(header, body, footer)

    // ── camera overlay (a sibling of the panel, not a child) ──
    const cameraOverlay = document.createElement('div')
    cameraOverlay.className = 'camera-overlay'
    const video = document.createElement('video')
    // The template's `autoplay playsinline`. Set as properties AND attributes:
    // a dynamically created <video> honours the properties, and iOS reads the
    // playsinline ATTRIBUTE. `muted` is deliberately absent — the component
    // never set it, and the stream is video-only.
    video.autoplay = true
    video.playsInline = true
    video.setAttribute('autoplay', '')
    video.setAttribute('playsinline', '')
    const cameraHexFrame = document.createElement('div')
    cameraHexFrame.className = 'camera-hex-frame'
    const cameraControls = document.createElement('div')
    cameraControls.className = 'camera-controls'
    const cameraClose = document.createElement('button')
    cameraClose.type = 'button'
    cameraClose.className = 'camera-control-btn'
    cameraClose.addEventListener('click', () => { this.#closeCamera() })
    const cameraCloseIcon = document.createElement('span')
    cameraCloseIcon.className = 'mat-sym'
    cameraCloseIcon.textContent = 'close'
    cameraClose.appendChild(cameraCloseIcon)
    const shutter = document.createElement('button')
    shutter.type = 'button'
    shutter.className = 'camera-shutter'
    shutter.addEventListener('click', () => { void this.#capturePhoto() })
    const cameraFlip = document.createElement('button')
    cameraFlip.type = 'button'
    cameraFlip.className = 'camera-control-btn'
    cameraFlip.addEventListener('click', () => { this.#toggleCameraOrientation() })
    const cameraFlipIcon = document.createElement('span')
    cameraFlipIcon.className = 'mat-sym'
    cameraFlipIcon.textContent = 'crop_rotate'
    cameraFlip.appendChild(cameraFlipIcon)
    cameraControls.append(cameraClose, shutter, cameraFlip)
    cameraOverlay.append(video, cameraHexFrame, cameraControls)

    this.#backdrop = backdrop
    this.#panel = panel
    this.#header = header
    this.#headerIcon = headerIcon
    this.#heading = heading
    this.#renameInput = renameInput
    this.#closeButton = closeButton
    this.#body = body
    this.#canvasHost = canvasHost
    this.#placeholder = placeholder
    this.#placeholderText = placeholderText
    this.#hexFrame = hexFrame
    this.#label = label
    this.#linkButton = linkButton
    this.#linkIcon = linkIcon
    this.#uploadText = uploadText
    this.#cameraText = cameraText
    this.#orientationButton = orientationButton
    this.#orientationText = orientationText
    this.#linkFieldText = linkFieldText
    this.#linkInput = linkInput
    this.#backgroundText = background.text
    this.#backgroundTextInput = background.textInput
    this.#backgroundPicker = background.picker
    this.#borderText = border.text
    this.#borderTextInput = border.textInput
    this.#borderPicker = border.picker
    this.#qaSection = qaSection
    this.#qaHeader = qaHeader
    this.#qaTitle = qaTitle
    this.#searchButton = searchButton
    this.#hideTextButton = hideTextButton
    this.#hideTextIcon = hideTextIcon
    this.#footerCancel = footerCancel
    this.#footerSave = footerSave
    this.#cameraOverlay = cameraOverlay
    this.#video = video
    this.#cameraHexFrame = cameraHexFrame
    // Built DETACHED — `#render` attaches the backdrop and panel only while
    // the editor is open, so there is no transient modal flash through mount.
  }

  /** The background and border controls are the same three widgets — a label,
   *  a hex text field, and a native swatch — differing only in icon, default
   *  and name. Both text and picker write through the SAME handler, exactly as
   *  the two `(ngModelChange)` bindings did. */
  #buildColorControl(
    icon: string,
    fallback: string,
    name: string,
    onChange: (value: string) => void,
  ): {
    control: HTMLLabelElement
    text: Text
    textInput: HTMLInputElement
    picker: HTMLInputElement
  } {
    const control = document.createElement('label')
    control.className = 'color-control'

    const button = document.createElement('span')
    button.className = 'color-btn'
    const buttonIcon = document.createElement('span')
    buttonIcon.className = 'mat-sym'
    buttonIcon.textContent = icon
    const text = document.createTextNode('')
    button.append(buttonIcon, text)

    const textInput = document.createElement('input')
    textInput.className = 'field-input color-text'
    textInput.type = 'text'
    textInput.name = `${name}-text`
    // A literal in the template — `editor.bg-placeholder` /
    // `editor.border-placeholder` exist in the shell catalogs but nothing
    // rendered them.
    textInput.placeholder = fallback
    textInput.addEventListener('input', () => { onChange(textInput.value) })

    const picker = document.createElement('input')
    picker.className = 'color-picker'
    picker.type = 'color'
    picker.name = name
    picker.addEventListener('input', () => { onChange(picker.value) })

    control.append(button, textInput, picker)
    return { control, text, textInput, picker }
  }

  // ── labels (re-resolved on every render and on locale:changed) ─────────

  #relabel(): void {
    this.#panel?.setAttribute('aria-label', t('editor.title', 'tile editor'))

    const nameHint = t('editor.name-hint',
      'How this tile reads in your language. The tile itself never moves — leave empty to show its own name.')
    this.#headerIcon?.setAttribute('aria-label', t('editor.name', 'name'))
    this.#headerIcon?.setAttribute('title', nameHint)
    this.#heading?.setAttribute('title', nameHint)
    this.#renameInput?.setAttribute('aria-label', t('editor.name', 'name'))
    this.#renameInput?.setAttribute('title', this.#renameDenied
      ? t('editor.name-taken',
        'Another tile here already reads that way — pick something else to tell them apart.')
      : nameHint)

    const cancelLabel = t('editor.cancel', 'cancel')
    this.#closeButton?.setAttribute('aria-label', cancelLabel)
    if (this.#footerCancel) this.#footerCancel.textContent = cancelLabel
    if (this.#footerSave) this.#footerSave.textContent = t('editor.save', 'save')

    if (this.#placeholderText) this.#placeholderText.textContent = t('editor.drop-image', 'drop image here')

    this.#linkButton?.setAttribute('title', this.#isLinked
      ? t('editor.unlink-transforms', 'unlink transforms')
      : t('editor.link-transforms', 'link transforms'))

    if (this.#uploadText) this.#uploadText.data = ` ${t('editor.upload', 'upload')}`
    if (this.#cameraText) this.#cameraText.data = ` ${t('editor.camera', 'camera')}`
    this.#orientationButton?.setAttribute('title', this.#isFlat
      ? t('editor.switch-to-point', 'switch to point-top')
      : t('editor.switch-to-flat', 'switch to flat-top'))
    if (this.#orientationText) {
      this.#orientationText.data = ` ${this.#isFlat
        ? t('editor.flat-top', 'flat-top')
        : t('editor.point-top', 'point-top')}`
    }

    if (this.#linkFieldText) this.#linkFieldText.data = ` ${t('editor.link', 'link')}`
    if (this.#backgroundText) this.#backgroundText.data = ` ${t('editor.bg', 'bg')}`
    if (this.#borderText) this.#borderText.data = ` ${t('editor.border', 'border')}`

    if (this.#qaTitle) this.#qaTitle.textContent = t('editor.qa.title', 'questions')
    const answerPlaceholder = t('editor.qa.answer-placeholder', 'type your answer…')
    const done = t('editor.qa.done', 'done')
    for (const row of this.#qaRows.values()) {
      if (row.textarea) row.textarea.placeholder = answerPlaceholder
      if (row.submit) row.submit.textContent = done
    }

    this.#searchButton?.setAttribute('title', t('editor.search-google', 'Search Google Images'))
    const hideText = this.#editor()?.hideText ?? false
    this.#hideTextButton?.setAttribute('title', hideText
      ? t('editor.show-text', 'Show label over image')
      : t('editor.hide-text', 'Hide label when image is shown'))
  }

  // ── rendering ─────────────────────────────────────────────────────────
  // Rebuild-on-change with ONE sanctioned exception (the Q&A row map, see the
  // header). Everything else is a mutation of a node that already exists —
  // because this is a text editor and a re-created input is a lost caret.

  #render(): void {
    const panel = this.#panel
    const backdrop = this.#backdrop
    if (!panel || !backdrop) return

    const service = this.#editor()
    // `@if (open())` — a truthiness test on `mode === 'editing'`, so the
    // complement is exact. Closed means GONE, not `display:none`: the template
    // removed the whole block, and `closest('.editor-panel, .image-canvas')`
    // is a DOM contract image-drop.drone.ts reads to decide whose drop it is.
    if (service?.mode !== 'editing') {
      backdrop.remove()
      panel.remove()
      this.#cameraOverlay?.remove()
      // Angular's `@if` destroyed the canvas host too, so the next open always
      // began with an empty div. Ours survives; sweep any Pixi canvas the
      // image editor did not take with it, or a second open would stack a
      // second canvas on top of the first.
      this.#canvasHost?.querySelectorAll('canvas').forEach(node => node.remove())
      return
    }

    // ── header: the heading IS the rename control ──
    const cell = this.#cell()
    const reading = this.#titleValue || cell
    const header = this.#header
    const heading = this.#heading
    const renameInput = this.#renameInput
    const closeButton = this.#closeButton
    if (header && heading && renameInput && closeButton) {
      if (this.#renaming) {
        heading.remove()
        if (renameInput.parentNode !== header) header.insertBefore(renameInput, closeButton)
        renameInput.classList.toggle('rename-denied', this.#renameDenied)
        renameInput.placeholder = cell
        // GUARDED WRITE — this is the field the participant is typing in.
        if (renameInput.value !== this.#titleValue) renameInput.value = this.#titleValue
      } else {
        renameInput.remove()
        if (heading.parentNode !== header) header.insertBefore(heading, closeButton)
        heading.textContent = reading
      }
    }

    // ── image ──
    const canvasHost = this.#canvasHost
    const placeholder = this.#placeholder
    const hexFrame = this.#hexFrame
    const label = this.#label
    if (canvasHost && placeholder && hexFrame && label) {
      canvasHost.classList.toggle('flat-top', this.#isFlat)
      // `@if (!hasImage())`
      if (this.#imageEditor()?.hasImage ?? false) {
        placeholder.remove()
      } else if (placeholder.parentNode !== canvasHost) {
        canvasHost.insertBefore(placeholder, hexFrame)
      }
      // `@if (!hideText())`
      if (service.hideText) {
        label.remove()
      } else {
        if (label.parentNode !== canvasHost) canvasHost.insertBefore(label, hexFrame.nextSibling)
        label.textContent = reading
      }
    }

    this.#linkButton?.classList.toggle('linked', this.#isLinked)
    this.#linkIcon?.classList.toggle('broken', !this.#isLinked)

    // ── fields ──
    const linkInput = this.#linkInput
    if (linkInput) {
      linkInput.classList.toggle('link-denied', this.#linkDenied)
      linkInput.classList.toggle('link-warned', this.#linkWarned)
      linkInput.title = this.#linkSafetyReason
      // GUARDED WRITE — the caret lives here whenever a link is being typed.
      if (linkInput.value !== this.#linkValue) linkInput.value = this.#linkValue
    }
    this.#syncColor(this.#backgroundTextInput, this.#backgroundPicker, this.#backgroundColorValue, '#1E1E1E')
    this.#syncColor(this.#borderTextInput, this.#borderPicker, this.#borderColorValue, '#000000')

    // ── Q&A ──
    this.#renderQa()

    // ── footer ──
    const hideText = service.hideText
    this.#hideTextButton?.classList.toggle('active', !hideText)
    if (this.#hideTextIcon) {
      this.#hideTextIcon.classList.toggle('filled', !hideText)
      this.#hideTextIcon.textContent = hideText ? 'visibility_off' : 'text_fields'
    }

    this.#relabel()

    // Back in, if they were out. Moving live nodes, never re-creating them —
    // re-inserting a subtree blurs whatever inside it had focus, so this only
    // ever runs on the closed→open edge.
    if (backdrop.parentNode !== this) this.appendChild(backdrop)
    if (panel.parentNode !== this) this.appendChild(panel)

    // `@if (cameraActive)` — a sibling of the panel, appended last.
    const overlay = this.#cameraOverlay
    if (overlay) {
      if (!this.#cameraActive) {
        overlay.remove()
      } else {
        this.#cameraHexFrame?.classList.toggle('flat-top', this.#cameraFlat)
        if (overlay.parentNode !== this) this.appendChild(overlay)
      }
    }
  }

  /** The text field and the swatch are two views of one value. The text field
   *  is a CARET field, so it gets the plain guarded write; the swatch
   *  normalises to lower case, so it is compared case-insensitively or every
   *  render would rewrite it. */
  #syncColor(
    textInput: HTMLInputElement | null,
    picker: HTMLInputElement | null,
    value: string,
    fallback: string,
  ): void {
    if (textInput && textInput.value !== value) textInput.value = value
    const next = value || fallback
    if (picker && picker.value.toLowerCase() !== next.toLowerCase()) picker.value = next
  }

  // ── the Q&A list — the one keyed map in this surface ──────────────────
  // A row is rebuilt ONLY when it changes shape (composer → posted answer).
  // A row that has not changed is not touched at all, so a half-typed answer
  // keeps its caret through any number of `notes:changed`. Order is restored
  // with `appendChild`, which MOVES a live node.

  #renderQa(): void {
    const section = this.#qaSection
    const body = this.#body
    if (!section || !body) return

    // `@if (qaItems.length > 0)` — copied, not negated.
    if (!(this.#qaItems.length > 0)) {
      section.remove()
      // Rows outlive the section only as garbage; drop them so a later open
      // does not resurrect a stale composer.
      for (const row of this.#qaRows.values()) row.root.remove()
      this.#qaRows.clear()
      return
    }

    // DEPARTED ROWS LEAVE FIRST — the activity-log precedent. The placement
    // walk below compares against the section's live children, so a row on its
    // way out must not still be sitting in the sequence when the walk reaches
    // its position; otherwise every survivor after it looks misplaced and gets
    // moved for nothing.
    const seen = new Set<string>(this.#qaItems.map(i => i.qId))
    for (const [qId, row] of [...this.#qaRows]) {
      if (seen.has(qId)) continue
      row.root.remove()
      this.#qaRows.delete(qId)
    }

    // ANCHOR WALK, never appendChild. `appendChild` on a node that ALREADY has
    // a parent is a remove followed by an insert — and removing a subtree that
    // contains the focused element drops focus to <body>. This section holds
    // the answer composer, so that is not a lost highlight: with focus on the
    // body the next Enter no longer hits the TEXTAREA exemption in #onKeyDown,
    // reaches `preventDefault(); #save()`, and closes the editor, discarding
    // the half-typed answer. Angular's `@for … track item.qId` only moved rows
    // whose index actually changed, so a stable list never touched a live
    // composer. A row already sitting where it belongs is SKIPPED here.
    let anchor: ChildNode | null = this.#qaHeader?.nextSibling ?? section.firstChild
    for (const item of this.#qaItems) {
      const answered = Boolean(item.answer)
      let row = this.#qaRows.get(item.qId)
      if (row && row.answered !== answered) {
        row.root.remove()
        this.#qaRows.delete(item.qId)
        row = undefined
      }
      if (!row) {
        row = this.#buildQaRow(item, answered)
        this.#qaRows.set(item.qId, row)
      }
      // The question text is stable for a given qId (the id IS the note's
      // layer signature, so editing the note mints a new one), but the ANSWER
      // can be re-posted; keep both honest without touching anything else.
      if (row.question.textContent !== item.question) row.question.textContent = item.question
      if (row.answer && row.answer.textContent !== item.answer) row.answer.textContent = item.answer
      if (row.textarea) {
        const draft = this.#qaAnswerDraft[item.qId] ?? ''
        // GUARDED WRITE — this is the composer the participant may be in.
        if (row.textarea.value !== draft) row.textarea.value = draft
      }
      // Already where it belongs? Do not touch it at all — this is the line
      // that keeps a live composer's caret.
      if (anchor === row.root) { anchor = row.root.nextSibling; continue }
      section.insertBefore(row.root, anchor)
    }

    // The section sits between the property fields and the footer, exactly
    // where the template put it (last child of the body).
    if (section.parentNode !== body) body.appendChild(section)
  }

  #buildQaRow(item: QaViewItem, answered: boolean): QaRow {
    const root = document.createElement('div')
    root.className = 'qa-item'
    root.classList.toggle('qa-answered', answered)

    const question = document.createElement('p')
    question.className = 'qa-question'
    question.textContent = item.question
    root.appendChild(question)

    let answer: HTMLParagraphElement | null = null
    let textarea: HTMLTextAreaElement | null = null
    let submit: HTMLButtonElement | null = null

    if (answered) {
      answer = document.createElement('p')
      answer.className = 'qa-answer'
      answer.textContent = item.answer
      root.appendChild(answer)
    } else {
      const answerRow = document.createElement('div')
      answerRow.className = 'qa-answer-row'
      textarea = document.createElement('textarea')
      textarea.className = 'field-input qa-answer-input'
      textarea.name = `qa-answer-${item.qId}`
      textarea.rows = 2
      // `[(ngModel)]` — the typed text lives in `#qaAnswerDraft`, never in
      // the DOM; the guarded write in `#renderQa` pushes it back. (The local
      // alias is what the closure captures: the outer binding is nullable and
      // would not narrow inside a listener.)
      const composer = textarea
      composer.addEventListener('input', () => { this.#qaAnswerDraft[item.qId] = composer.value })
      submit = document.createElement('button')
      submit.type = 'button'
      submit.className = 'qa-submit'
      submit.addEventListener('click', () => { this.#submitAnswer(item.qId) })
      answerRow.append(textarea, submit)
      root.appendChild(answerRow)
    }

    return { root, answered, question, answer, textarea, submit }
  }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md). 220 sits just under the
// camera capture's 225, which is the surface that opens INTO this one.
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host with no
// ShellSurfaceRegistry (diamond-core-processor mounts tags directly in its own
// template) still needs the tag to be a real element rather than an inert
// unknown one — so the define cannot wait on the registry. Only the ADD does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, TileEditorElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/TileEditorElement',
    element: SURFACE_NAME,
    order: 220,
  })
})
