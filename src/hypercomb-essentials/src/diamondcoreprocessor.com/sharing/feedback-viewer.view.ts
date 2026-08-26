// feedback-viewer.view.ts — THE FEEDBACK WINDOW, as a framework-free custom
// element (everything-is-a-beehavior Phase 2: Angular panels leave the shell
// and ship as signed modules).
//
// A straight port of shared/ui/feedback-viewer: same surface name
// (hc-feedback-viewer), same order band (200), same panel id
// ('feedback-viewer' — so the participant's saved width, text size and group
// membership come across), same effects in and out. It lands beside
// `feedback-swarm.drone.ts`, which owns the remote half of everything this
// panel does, and beside `feedback-retirement.ts`, which moved with it.
//
// ── WHAT IT IS FOR ─────────────────────────────────────────────────────────
//
// THE inbox for everything that arrives from someone else, opened from the
// command-line header's feedback toggle (EffectBus `feedback:toggle`; state
// mirrored back on `feedback:panel-state` so the header icon lights). The
// dashboard is gone (2026-07-26): its one real job — showing open questions and
// taking an answer — lives here now, so there is ONE place to look instead of a
// hidden hex bag nobody found.
//
// The list is a union of two record kinds from the sign('optimization') pool,
// newest-first:
//   • `feedback` — what a participant shared (mine, or another participant's,
//     arriving over the swarm handshake or the durable feedback channel).
//     Per-item Resolve adds a local `kind:'hidden'` marker. The feedback bytes
//     stay put, so a relay replay cannot resurrect the row and the panel's
//     explicit "show hidden" lens can still visit / restore feedback history.
//   • `qa` — an open QUESTION addressed to me: minted by the feedback-loop
//     routine, by a workflow `ask` step, or by the responder answering a
//     hive-wide `/opus`-style ask. Answering inline writes a `qa-answer`
//     record (the raw answer is decoration, never canonical content — the
//     next codegen pass interprets it into a note) and removes the open `qa`,
//     which is exactly what the retired QaModalView did.
// A third kind, `reply`, is the host's answer to feedback I sent, delivered
// back over my pubkey-derived reply channel.
//
// WHO SENT IT: every record carries the participant's identity — `by` (their
// chosen name) and `from` (their nostr pubkey). The compose form REQUIRES a
// name before it will send, and each row shows it, so feedback arriving from
// the community is never anonymous noise.
//
// PAGE-ADDRESSED ITEMS are reach-scoped like the pheromone filter: one toggle
// walks local (this page) / children (this page and below) / global (the whole
// hive), matched against each record's `route`. The current location re-reads
// on the immediate browser `navigate` event and after `navigation:guard-end`,
// so navigating with the panel open re-filters live. Non-sticky — the reach is
// never persisted; it lives in a field for the life of the session.
// Return-channel replies have no route and remain visible until resolved.
//
// ── LIFECYCLE NOTE ─────────────────────────────────────────────────────────
//
// The Angular version wrapped its whole `<section>` in `@if (visible())`, so the
// panel's DOM existed only while it was open — INCLUDING the composer, whose
// half-typed text survived a park only because `text` / `name` / `answer` /
// `reply` were component FIELDS that ngModel wrote back on re-create. This port
// keeps that exact contract: every editable value lives in a field, and the DOM
// is rebuilt from the fields. A registry-fed element is mounted ONCE at boot and
// stays, so DOM presence and ENGAGEMENT are split the way DockedPanelElement
// splits them: `activate()` builds + claims the lane + joins the session,
// `deactivate()` tears all of that down and clears the children. `#show()` /
// `#hide()` are those two calls plus the `.open` class, and the host starts
// hidden — a panel that flashed on boot would be claiming an edge lane nobody
// asked for.
//
// Because the host IS the panel (DockedPanelElement sizes, positions, grips and
// measures `this`), the Angular `:host { inset: 0; pointer-events: none }`
// full-bleed wrapper is gone and the `.feedback-viewer-panel` rules land on the
// tag — the sequence-viewer / context-window precedent. The class name is kept
// ON the tag so `document.querySelector('.feedback-viewer-panel')` still answers
// exactly when the `@if` used to. The inset reporting the old `hcDockInset`
// directive did is folded into the same base.
//
// ── WHAT REBUILDS AND WHAT DOES NOT ────────────────────────────────────────
//
// Rebuild-on-change is the house pattern, but a panel with a composer owes the
// participant their caret. So the split is:
//
//   • CHROME (header, reach row, the whole compose footer) is built ONCE per
//     activation and MUTATED in place — `#relabel()` re-resolves its strings,
//     `#syncReach()` / `#syncControls()` update pressed states, disabled flags
//     and the one detachable node (`.fv-permission-hint`, which the template
//     wrapped in `@if`, so it genuinely leaves the DOM). Typing therefore never
//     races a re-render, and an ingest landing mid-sentence cannot take the
//     composer out from under a thumb.
//   • THE LIST is rebuilt wholesale on every change, with an explicit
//     focus + caret + scroll snapshot across the swap (the sanctioned answer in
//     the plan doc — `focusSnapshot`/`restoreFocus` in spirit, keyed on
//     `data-fv-focus` because these are textareas and buttons, not the settings
//     editor's text rows). Angular's `@for … track trackBySig` preserved the
//     row NODE; the snapshot preserves what a participant can actually notice
//     about it — where they were, what was selected, how far down the list.
//
// Neither is a reconciler: nothing is diffed, nothing is keyed to a cached
// element, and every value on screen is read from a field.
//
// Its strings ship WITH it (feedback-viewer.i18n.ts, extracted from all 14
// shell catalogs) and register under the 'app' namespace, so every key resolves
// exactly as before — the Phase 2 catalog split, another slice.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { DockedPanelElement } from '../panels/docked-panel.element.js'
import { FEEDBACK_VIEWER_TRANSLATIONS } from './feedback-viewer.i18n.js'
import {
  feedbackMatchesReach,
  indexFeedbackRetirements,
  questionWasAnswered,
  visibleFeedbackItems,
} from './feedback-retirement.js'

const SURFACE_NAME = 'hc-feedback-viewer'

const HEX64 = /^[0-9a-f]{64}$/
/** The participant's chosen display name. The SAME key the mesh modal writes
 *  and the swarm handshake reads — one identity across every surface. */
const LABEL_KEY = 'hc:user-label'

type FeedbackCategory = 'idea' | 'issue'
type Scope = 'local' | 'children' | 'global'

interface FeedbackItem {
  sig: string
  /** `feedback` = something shared; `qa` = an open question awaiting my
   *  answer; `reply` = the host's response to feedback I sent, delivered
   *  back over my pubkey-derived reply channel. */
  kind: 'feedback' | 'qa' | 'reply'
  category: string
  text: string
  route: string
  at: number
  /** The record's own stable id (fb-… / qId) — what a reply references. */
  id: string
  /** Who it came from — their chosen name ('' when a legacy record carries none). */
  by: string
  /** Their nostr pubkey, when known. The ADDRESS a reply is sent to. */
  from: string
  /** `qa` only — the question's stable id, carried into the answer record. */
  qId: string
  /** `qa` only — the lineage the question is about (its `appliesTo`). */
  qPath: readonly string[]
  /** `qa` only: an AI request that needs a decision instead of prose. */
  approval: boolean
  /** `qa` only: plain-language provenance for why the question needs the
   *  participant. Questions without this were indistinguishable from rows
   *  mysteriously returning after they had already been handled. */
  why: string
  /** `reply` only — a short quote of the original feedback it answers. */
  re: string
  /** Resolve is a visibility lens, never deletion. This is the signature of
   *  the local `kind:'hidden'` marker targeting this item, when one exists. */
  hiddenRecordSig: string
  /** The feedback loop's durable processed ledger. A replayed feedback record
   *  remains retired when its stable id has already been marked seen. */
  seenRecordSig: string
}

type StoreLike = {
  listOptimizations?: () => Promise<string[]>
  getOptimization?: (sig: string) => Promise<Blob | null>
  removeOptimization?: (sig: string) => Promise<boolean>
  putOptimization?: (blob: Blob) => Promise<string>
}
type NavigationLike = {
  segmentsRaw?: () => readonly string[]
  goRaw?: (segments: readonly string[]) => void
}
type SwarmLike = { subscribedTo?: () => string | null }
type FeedbackSwarmLike = { isGrantedBy?: (host: string) => boolean }
type SignerLike = { getPublicKeyHex?: () => Promise<string | null> }
type ReplyDroneLike = { sendReply?: (r: Record<string, unknown>) => Promise<boolean> }

const STORE_KEY = '@hypercomb.social/Store'
const NAVIGATION_KEY = '@hypercomb.social/Navigation'
const SWARM_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const FEEDBACK_SWARM_KEY = '@diamondcoreprocessor.com/FeedbackSwarmDrone'
const FEEDBACK_REPLY_KEY = '@diamondcoreprocessor.com/FeedbackReplyDrone'
const SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'

const get = <T,>(key: string): T | undefined => window.ioc?.get?.<T>(key)

// Same contract as the shell pipe: params drive both pluralization and
// `{token}` interpolation. The fallback is the English catalog text, and it
// interpolates the same tokens so a bare host with no i18n reads identically.
const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const i18n = get<I18nProvider>(I18N_IOC_KEY)
  const value = i18n?.t(key, params)
  if (value && value !== key) return value
  if (!params) return fallback
  return fallback.replace(/\{(\w+)\}/g, (whole, token: string) =>
    token in params ? String(params[token]) : whole)
}

// The panel's strings travel with it — registered as soon as the i18n service
// is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(FEEDBACK_VIEWER_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ─────────────
//
// No shadow DOM (the tutorial-overlay + sequence-viewer precedent), so
// Angular's `:host` becomes the tag name and every other selector is prefixed
// with it. `$steel: rgb(126, 182, 214)` is inlined at every `rgba($steel, …)`
// call site; `tw.$radius-control` → 2px and `tw.$radius-card` → 3px (the shape
// ladder, _shape.scss); the `var(--md-*)` / `var(--hc-*)` tokens are left alone.
//
// THREE EXPANSIONS WORTH NAMING:
//
//  • `@include tw.panel($steel, right)` was the LAST line of
//    `.feedback-viewer-panel`, so its declarations won the cascade over the ones
//    written above it. The effective values are written here once — background
//    rgba(13,15,21,.975) (which means THE TWO RADIAL ACCENT GRADIENTS ABOVE IT
//    NEVER PAINTED, and are not carried), backdrop-filter blur(14px)
//    saturate(1.04) (not blur(18px)), the -14px/44px/.46 shadow (not
//    -10px/40px/.5) and colour #eef2f5 (not #eef3f8) — rather than emitting both
//    and leaving eight dead declarations in a document-level sheet. The one
//    declaration written AFTER the include, `border-left-color`, still wins, so
//    the edge keeps its `--fv-accent` 46% colour.
//
//  • `.fv-close`'s own rules sit LATER in the sheet than the `tw.header`
//    close-button rules, but `…fv-header>button[class*='close']` outranks
//    `…fv-close` on specificity, so width / min-width / padding / font-size /
//    colour / transition come from the header band and only flex-shrink /
//    background / border / cursor come from `.fv-close`. That ordering is
//    reproduced verbatim below so the close button lands where it always did.
//
//  • `:host { position: fixed; inset: 0; pointer-events: none }` is GONE with
//    the wrapper: the tag IS the panel now, so it takes the panel's own
//    position/top/right/bottom/width and `pointer-events: auto`, and nothing
//    full-bleed sits over the hive any more.
//
// Angular's build autoprefixed; `-webkit-backdrop-filter` is written by hand.
// There are no @keyframes in this sheet, so nothing needs tag-scoping.
const S = SURFACE_NAME
const CSS = `
${S}{--fv-accent:var(--md-primary,rgb(126,182,214));--fv-warm:var(--md-secondary,#d3a47a);
  --hc-window-accent:rgb(126,182,214);--hc-window-radius-control:2px;--hc-window-radius-card:3px;--hc-window-radius-floating:4px;
  pointer-events:auto;position:fixed;z-index:100002;
  top:max(calc(2.3rem * var(--hc-header-zoom,1.0)),var(--hc-header-anchor));
  right:var(--hc-controls-right,0);bottom:0;
  width:360px;min-width:280px;max-width:calc(100vw - 1.5rem);
  display:none;flex-direction:column;
  background:rgba(13,15,21,.975);
  backdrop-filter:blur(14px) saturate(1.04);-webkit-backdrop-filter:blur(14px) saturate(1.04);
  border-radius:0;border-right:0;border-left:1px solid color-mix(in srgb,var(--fv-accent) 46%,transparent);
  box-shadow:-14px 0 44px rgba(0,0,0,.46),inset 1px 0 rgba(255,255,255,.025);
  font-family:var(--hc-mono,system-ui);font-size:calc(1rem * var(--hc-panel-scale,1));
  color:#eef2f5;outline:none}
${S}.open{display:flex}
${S} .fv-region{display:contents}
${S} .fv-header{flex:0 0 auto;box-sizing:border-box;display:flex;align-items:center;gap:.5rem;height:2.875rem;min-height:2.875rem;padding:0 .75rem;line-height:1;border-bottom:1px solid color-mix(in srgb,var(--fv-accent) 30%,transparent);background:linear-gradient(90deg,color-mix(in srgb,var(--fv-accent) 10%,transparent),transparent 62%)}
${S} .fv-header>button,${S} .fv-header>[class*='actions']>button{box-sizing:border-box;display:inline-grid;place-items:center;min-width:1.75rem;height:1.75rem;padding:0 .25rem;border-radius:2px;line-height:1;transition:color 120ms ease,background-color 120ms ease,border-color 120ms ease}
${S} .fv-header>button:hover,${S} .fv-header>[class*='actions']>button:hover{background-color:rgba(255,255,255,.055)}
${S} .fv-header>button:focus-visible,${S} .fv-header>[class*='actions']>button:focus-visible{outline:1px solid color-mix(in srgb,var(--hc-window-accent) 72%,white);outline-offset:1px}
${S} .fv-header>button[class*='close'],${S} .fv-header>button.close,${S} .fv-header>[class*='actions']>button[class*='close']{width:1.75rem;min-width:1.75rem;padding:0;font-size:1.125rem;color:rgba(238,244,248,.62)}
${S} .fv-header>button[class*='close']:hover,${S} .fv-header>button.close:hover,${S} .fv-header>[class*='actions']>button[class*='close']:hover{color:#fff;background-color:rgba(255,255,255,.075)}
${S} .fv-header-icon{display:inline-grid;place-items:center;width:1.7rem;height:1.5rem;flex:0 0 auto;font-family:'Material Symbols Outlined';font-size:1rem;line-height:1;color:color-mix(in srgb,var(--fv-accent) 88%,white);background:color-mix(in srgb,var(--fv-accent) 14%,transparent);clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)}
${S} .fv-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.9rem;font-weight:600;letter-spacing:.04em;color:color-mix(in srgb,var(--fv-accent) 34%,#f3f5f7)}
${S} .fv-reach{flex:0 0 auto;display:flex;align-items:center;gap:.6rem;padding:.4rem .9rem .45rem;border-bottom:1px solid rgba(255,255,255,.06);background:color-mix(in srgb,var(--fv-accent) 3%,transparent)}
${S} .fv-subtitle{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.68rem;color:rgba(206,224,240,.5)}
${S} .fv-scope{flex-shrink:0;display:flex;gap:.2rem;margin-left:auto;padding:.15rem;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:2px}
${S} .fv-hidden-mode,${S} .fv-hidden-label{display:inline-flex;align-items:center;gap:.25rem;color:color-mix(in srgb,var(--fv-warm) 78%,#f1f3f5);font-size:.6rem;letter-spacing:.035em;white-space:nowrap}
${S} .fv-hidden-mode .mat-sym,${S} .fv-hidden-label .mat-sym{font-family:'Material Symbols Outlined';font-size:.82rem;line-height:1}
${S} .fv-hidden-mode{appearance:none;flex:0 0 1.55rem;justify-content:center;width:1.55rem;height:1.55rem;padding:0;border:1px solid color-mix(in srgb,var(--fv-warm) 30%,transparent);border-radius:2px;background:transparent;cursor:pointer}
${S} .fv-hidden-mode .mat-sym{font-size:.9rem}
${S} .fv-hidden-mode:hover,${S} .fv-hidden-mode.active{color:color-mix(in srgb,var(--fv-warm) 92%,white);border-color:color-mix(in srgb,var(--fv-warm) 56%,transparent);background:color-mix(in srgb,var(--fv-warm) 10%,transparent)}
${S} .fv-scope-btn{display:inline-flex;align-items:center;justify-content:center;padding:.24rem .4rem;background:transparent;border:1px solid transparent;border-radius:2px;color:rgba(226,235,244,.55);cursor:pointer;transition:color 150ms ease,background 150ms ease,border-color 150ms ease}
${S} .fv-scope-btn .mat-sym{font-family:'Material Symbols Outlined';font-size:1rem;line-height:1}
${S} .fv-scope-btn:hover{color:rgba(238,243,248,.9)}
${S} .fv-scope-btn.active{color:#fff;background:color-mix(in srgb,var(--fv-accent) 18%,transparent);border-color:color-mix(in srgb,var(--fv-accent) 50%,transparent)}
${S} .fv-close{flex-shrink:0;background:transparent;border:none;color:rgba(226,235,244,.6);font-size:1.4rem;line-height:1;cursor:pointer;padding:0 .2rem;transition:color 150ms ease}
${S} .fv-close:hover{color:#fff}
${S} .fv-empty{margin:0;padding:1.5rem 1rem;font-size:.82rem;color:rgba(226,235,244,.45);flex:1}
${S} .fv-inbox{flex:1;min-height:0;display:flex;flex-direction:column}
${S} .fv-list{list-style:none;margin:0;padding:.55rem .65rem .7rem;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:.42rem}
${S} .fv-pinned{flex:0 0 auto;max-height:42%;overflow-y:auto;overscroll-behavior:contain;border-bottom:1px solid rgba(126,182,214,.35);background:rgba(126,182,214,.075)}
${S} .fv-pinned-label{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:.35rem;padding:.35rem 1rem;color:rgba(206,224,240,.78);background:rgba(20,27,36,.98);border-bottom:1px solid rgba(126,182,214,.2);font-size:.64rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
${S} .fv-pinned-label .mat-sym{font-family:'Material Symbols Outlined';font-size:.85rem}
${S} .fv-pinned-list{list-style:none;margin:0;padding:.42rem .65rem}
${S} .fv-row{display:flex;align-items:flex-start;gap:.6rem;padding:.62rem .7rem;border:1px solid color-mix(in srgb,var(--fv-accent) 12%,rgba(255,255,255,.05));border-radius:3px;background:rgba(255,255,255,.018);box-shadow:inset 0 1px rgba(255,255,255,.018);transition:background 120ms ease,border-color 120ms ease,opacity 120ms ease}
${S} .fv-row:hover{background:color-mix(in srgb,var(--fv-accent) 7%,rgba(255,255,255,.018));border-color:color-mix(in srgb,var(--fv-accent) 30%,transparent)}
${S} .fv-icon{flex:0 0 auto;margin-top:.1rem;font-family:'Material Symbols Outlined';font-size:1.1rem;line-height:1;color:rgba(126,182,214,.8)}
${S} .fv-row.issue .fv-icon{color:rgba(240,176,92,.9)}
${S} .fv-row.question .fv-icon{color:rgba(126,182,214,1)}
${S} .fv-row.question{border-left:2px solid color-mix(in srgb,var(--fv-accent) 72%,transparent);background:color-mix(in srgb,var(--fv-accent) 6%,transparent)}
${S} .fv-row.approval{background:rgba(126,182,214,.08)}
${S} .fv-why{display:flex;align-items:flex-start;gap:.3rem;margin:.32rem 0 0;color:color-mix(in srgb,var(--fv-accent) 62%,#dce2e8);font-size:.66rem;line-height:1.35}
${S} .fv-why .mat-sym{flex:0 0 auto;margin-top:.04rem;font-family:'Material Symbols Outlined';font-size:.78rem;line-height:1}
${S} .fv-decision-actions{flex:0 0 auto;align-self:center;display:flex;flex-direction:column;gap:.3rem}
${S} .fv-decision{min-width:4.5rem;padding:.3rem .55rem;border-radius:2px;font:inherit;font-size:.66rem;letter-spacing:.03em;cursor:pointer;transition:background 150ms ease,color 150ms ease,border-color 150ms ease}
${S} .fv-decision.approve{color:#e9fff4;background:rgba(76,176,126,.18);border:1px solid rgba(96,210,151,.55)}
${S} .fv-decision.approve:hover:not(:disabled){background:rgba(76,176,126,.32);border-color:rgba(116,230,171,.9)}
${S} .fv-decision.discard{color:rgba(238,243,248,.68);background:transparent;border:1px solid rgba(255,255,255,.16)}
${S} .fv-decision.discard:hover:not(:disabled){color:#fff;background:rgba(255,255,255,.08)}
${S} .fv-decision:disabled{opacity:.4;cursor:not-allowed}
${S} .fv-row.reply{border-left:2px solid color-mix(in srgb,var(--fv-accent) 48%,transparent);background:color-mix(in srgb,var(--fv-accent) 4%,transparent)}
${S} .fv-row.reply .fv-icon{color:rgba(126,182,214,.9)}
${S} .fv-row.hidden{opacity:.58;border-style:dashed;border-color:color-mix(in srgb,var(--fv-warm) 36%,transparent);background:color-mix(in srgb,var(--fv-warm) 4%,transparent)}
${S} .fv-row.hidden:hover{opacity:.82}
${S} .fv-quote{margin:0 0 .15rem;padding:.2rem .5rem;font-size:.7rem;line-height:1.35;color:rgba(206,224,240,.5);border-left:2px solid rgba(255,255,255,.14);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${S} .fv-row-actions{flex:0 0 auto;align-self:center;display:flex;flex-direction:column;gap:.3rem}
${S} .fv-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:.25rem}
${S} .fv-text{margin:0;font-size:.82rem;line-height:1.4;color:#eef3f8;white-space:pre-wrap;word-break:break-word}
${S} .fv-meta{display:flex;align-items:center;gap:.5rem;font-size:.64rem;font-family:var(--hc-mono,monospace);color:rgba(226,235,244,.4)}
${S} .fv-author{display:inline-flex;align-items:center;gap:.2rem;max-width:10rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(206,224,240,.72)}
${S} .fv-author .mat-sym{font-family:'Material Symbols Outlined';font-size:.8rem;line-height:1}
${S} .fv-author.anon{font-style:italic;color:rgba(226,235,244,.32)}
${S} .fv-hidden-label{margin-left:auto;color:color-mix(in srgb,var(--fv-warm) 70%,#e8ebee)}
${S} .fv-route{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:12rem;color:rgba(126,182,214,.7);font-family:inherit;font-size:inherit;background:transparent;border:none;padding:0;cursor:pointer;transition:color 150ms ease}
${S} .fv-route:hover{color:rgba(126,182,214,1);text-decoration:underline}
${S} .fv-answer-text{margin-top:.35rem;font-family:inherit;font-size:.82rem;line-height:1.5;color:#eef3f8;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.12);border-radius:3px;padding:.5rem .6rem;resize:vertical;min-height:3.2rem;outline:none;transition:border-color 150ms ease,background 150ms ease}
${S} .fv-answer-text::placeholder{color:rgba(226,235,244,.35)}
${S} .fv-answer-text:focus{border-color:rgba(126,182,214,.6);background:rgba(126,182,214,.06)}
${S} .fv-answer-actions{display:flex;justify-content:flex-end;margin-top:.35rem}
${S} .fv-resolve{flex:0 0 auto;align-self:center;font-family:inherit;font-size:.66rem;letter-spacing:.04em;cursor:pointer;padding:.28rem .55rem;border-radius:2px;background:transparent;border:1px solid rgba(255,255,255,.16);color:rgba(226,235,244,.65);transition:background 150ms ease,color 150ms ease,border-color 150ms ease}
${S} .fv-resolve:hover{color:#fff;background:rgba(126,182,214,.16);border-color:rgba(126,182,214,.55)}
${S} .fv-resolve.restore{color:color-mix(in srgb,var(--fv-warm) 82%,white);border-color:color-mix(in srgb,var(--fv-warm) 44%,transparent);background:color-mix(in srgb,var(--fv-warm) 8%,transparent)}
${S} .fv-resolve.restore:hover{background:color-mix(in srgb,var(--fv-warm) 18%,transparent);border-color:color-mix(in srgb,var(--fv-warm) 72%,transparent)}
${S} .fv-compose{flex-shrink:0;display:flex;flex-direction:column;gap:.6rem;padding:.75rem 1rem .85rem;border-top:1px solid color-mix(in srgb,var(--fv-warm) 26%,transparent);background:linear-gradient(135deg,color-mix(in srgb,var(--fv-warm) 6%,transparent),transparent 44%),rgba(255,255,255,.018)}
${S} .fv-permission-hint{margin:0;padding:.55rem .7rem;font-size:.78rem;line-height:1.45;color:rgba(206,224,240,.85);background:rgba(126,182,214,.1);border:1px solid rgba(126,182,214,.28);border-radius:3px}
${S} .fv-name{display:flex;align-items:center;gap:.5rem}
${S} .fv-name-label{flex:0 0 auto;font-size:.68rem;letter-spacing:.03em;color:rgba(206,224,240,.55)}
${S} .fv-name-input{flex:1;min-width:0;font-family:inherit;font-size:.8rem;color:#eef3f8;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:2px;padding:.35rem .55rem;outline:none;transition:border-color 150ms ease,background 150ms ease}
${S} .fv-name-input::placeholder{color:rgba(226,235,244,.35)}
${S} .fv-name-input:focus{border-color:rgba(126,182,214,.6);background:rgba(126,182,214,.05)}
${S} .fv-name-input.missing{border-color:rgba(240,140,140,.75)}
${S} .fv-segmented{display:flex;gap:.35rem;padding:.2rem;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:3px}
${S} .fv-seg-btn{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:.35rem;padding:.4rem .5rem;background:transparent;border:1px solid transparent;border-radius:2px;color:rgba(226,235,244,.6);font-family:inherit;font-size:.76rem;letter-spacing:.02em;cursor:pointer;transition:color 150ms ease,background 150ms ease,border-color 150ms ease}
${S} .fv-seg-btn .mat-sym{font-family:'Material Symbols Outlined';font-size:1rem;line-height:1}
${S} .fv-seg-btn:hover{color:rgba(238,243,248,.85)}
${S} .fv-seg-btn.active{color:#fff;background:color-mix(in srgb,var(--fv-warm) 14%,transparent);border-color:color-mix(in srgb,var(--fv-warm) 48%,transparent)}
${S} .fv-compose-text{font-family:inherit;font-size:.85rem;line-height:1.5;color:#eef3f8;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:3px;padding:.55rem .65rem;resize:vertical;min-height:3.4rem;outline:none;transition:border-color 150ms ease,background 150ms ease}
${S} .fv-compose-text::placeholder{color:rgba(226,235,244,.35)}
${S} .fv-compose-text:focus{border-color:rgba(126,182,214,.6);background:rgba(126,182,214,.05)}
${S} .fv-actions{display:flex;justify-content:flex-end;align-items:center;gap:.5rem}
${S} .fv-btn{font-family:inherit;font-size:.78rem;letter-spacing:.03em;cursor:pointer;border-radius:2px;padding:.42rem .95rem;transition:background 150ms ease,color 150ms ease,border-color 150ms ease}
${S} .fv-btn.primary{background:color-mix(in srgb,var(--fv-warm) 14%,transparent);border:1px solid color-mix(in srgb,var(--fv-warm) 52%,transparent);color:color-mix(in srgb,var(--fv-warm) 25%,white)}
${S} .fv-btn.primary:hover:not(:disabled){background:color-mix(in srgb,var(--fv-warm) 24%,transparent);color:#fff;border-color:color-mix(in srgb,var(--fv-warm) 86%,transparent)}
${S} .fv-btn.primary:disabled{opacity:.4;cursor:not-allowed}
@media (pointer:coarse){${S}{top:max(calc(3.65rem * var(--hc-header-zoom,1.0)),calc(var(--hc-header-anchor) + 1.02rem))}}
@media (max-width:599px){${S}{top:0}}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-feedback-viewer', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

/** Where focus (and its caret) was, across a list rebuild. Keyed on
 *  `data-fv-focus` rather than on the element, because the element is gone by
 *  the time we put it back. */
type FocusSnap = { key: string; start: number | null; end: number | null }

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** The `<span class="mat-sym">glyph</span>` the template writes everywhere. */
const glyph = (name: string, hidden = false): HTMLSpanElement => {
  const span = el('span', 'mat-sym', name)
  if (hidden) span.setAttribute('aria-hidden', 'true')
  return span
}

// ── fallback wording ──────────────────────────────────────────────────────
// Declared ABOVE the class on purpose: `customElements.define` at the bottom of
// this module upgrades any matching tag already in the document (DCP mounts
// these directly), which runs the constructor and connectedCallback
// SYNCHRONOUSLY — a `const` below the class would still be in its temporal dead
// zone at that moment.

/** The three reach tooltips, by their runtime-built key. */
const SCOPE_FALLBACK: Record<Scope, string> = {
  local: 'Filtering this page only — click to widen to children, then the whole hive',
  children: 'Filtering this page and its children — click to widen to the whole hive',
  global: 'Filtering the whole hive — click to narrow back to this page',
}

/** The component's own toast fallbacks, carried verbatim — including
 *  'Could not send', which is what the component said with no catalog even
 *  though en.json spells it "Couldn't send". The catalog wins when there is
 *  one; this is only the bare-host reading. */
const TOAST_FALLBACK: Record<string, string> = {
  'feedback.sent.title': 'Thank you',
  'feedback.sent.message': 'Your feedback is on its way.',
  'feedback.error.title': 'Could not send',
  'feedback.error.message': 'Please try again in a moment.',
  'feedback.request.title': 'Request sent',
  'feedback.request.message': 'Waiting for the host to allow you to share feedback.',
  'feedback.granted.title': "You're in",
  'feedback.granted.message': 'The host approved you — share away.',
  'feedback.identity.title': 'Who is this from?',
  'feedback.identity.message': 'Add your name so the host knows who sent it.',
  'feedback.answered.title': 'Answer recorded',
  'feedback.answered.message': 'Thanks — the question is closed.',
  'feedback.replied.title': 'Reply sent',
  'feedback.replied.message': "It will arrive in the sender's feedback window, and this item is closed.",
  'feedback.reply.error.title': "Couldn't send the reply",
  'feedback.reply.error.message': 'The mesh may be down — try again in a moment.',
  'feedback.resolve.error.title': "Couldn't close this item",
  'feedback.resolve.error.message': 'It is still in the inbox. Please try Resolve again.',
}

const REASON_FALLBACK: Record<string, string> = {
  'feedback.reason.feedback-loop': 'The feedback loop needs your input before it can continue.',
  'feedback.reason.meaning-loop': 'The meaning loop needs your decision before it can continue.',
  'feedback.reason.approval': 'AI work is paused until you approve or discard this request.',
  'feedback.reason.answer': 'Work is paused until you answer this question.',
}

export class FeedbackViewerElement extends DockedPanelElement {

  #offs: Array<() => void> = []

  /** True only for the synchronous window inside `EffectBus.on` — the
   *  camera-capture precedent. `feedback:toggle` and `feedback:viewer-close`
   *  are GESTURES, and EffectBus replays its last value at subscribe time. The
   *  Angular component subscribed once at boot, before anything had emitted, so
   *  its replay was always empty; an element re-subscribes whenever the
   *  shell-surfaces host MOVES it (a DOM move fires disconnected+connected),
   *  which after one press would replay the toggle and re-open a panel the
   *  participant had closed. Dropping the subscribe-time call is not catch-up
   *  logic — it is reproducing Angular's boot exactly. */
  #subscribing = false

  /** THE visibility flag. `openPanel`, `close`, the toggle and the session's
   *  park/unpark all read and write THIS field. */
  #visible = false

  // ── the inbox ────────────────────────────────────────────────────────
  #items: FeedbackItem[] = []
  /** Bookkeeping only — the Angular template never rendered a loading state,
   *  and neither does this. Kept because `reload()` is the one place a future
   *  spinner would hang off, and dropping a flag is a silent change. */
  #loading = false
  /** Feedback history is an explicit panel-local lens. Tile hiding can
   *  auto-enable the application's global `hc:show-hidden` state, so sharing
   *  that state leaked retired feedback into the normal inbox. */
  #showHidden = false

  // ── reach scope (mirrors the pheromone panel's three reaches) ─────────
  /** Non-sticky: never persisted, and never reset on open either — the field
   *  is minted once at 'local' and walks with the session, exactly as the
   *  Angular signal did in a component that was constructed once at boot. */
  #scope: Scope = 'local'
  /** The three reaches in cycle order — the toggle's walk, and each stage's
   *  glyph. Same ids and glyphs as everywhere else. */
  readonly #scopeOptions: readonly { id: Scope; icon: string }[] = [
    { id: 'local', icon: 'blur_on' },
    { id: 'children', icon: 'account_tree' },
    { id: 'global', icon: 'public' },
  ]
  /** Current location as a route string — re-read immediately on every
   *  committed browser navigation and again after the renderer settles. */
  #route = ''

  // ── compose form ─────────────────────────────────────────────────────
  #sending = false
  #category: FeedbackCategory = 'idea'
  /** The composer's text. THE FIELD IS THE TRUTH: park destroys the DOM (the
   *  `@if` did too), and a reload-free return must not throw away a
   *  half-written message. */
  #text = ''

  // ── identity ─────────────────────────────────────────────────────────
  /** The participant's display name, mirrored from the compose form's name
   *  field. Persisted to `hc:user-label` on send — the same identity the mesh
   *  modal and the swarm feedback handshake use. */
  #name = ''
  /** True once a name exists. Nothing renders it (the Angular template did not
   *  either) — carried because `#commitName` sets it and a dropped field is a
   *  silent change to what a future collapse-the-field state would read. */
  #named = false
  /** Set when a send was refused for want of a name, to light the field. */
  #nameMissing = false
  /** My own pubkey, resolved once — stamped on everything I write so the
   *  receiving host can tell two people with the same name apart. */
  #myPubkey: string | null = null

  // ── inline question answering (what the QA modal used to do) ─────────
  /** sig of the `qa` row whose answer box is open, or null. */
  #answering: string | null = null
  #answer = ''

  // ── inline replying (host → the item's sender, over their pubkey channel) ──
  /** sig of the row whose reply box is open, or null. */
  #replyingTo: string | null = null
  #reply = ''

  // ── swarm context (remote feedback) ──────────────────────────────────
  /** When viewing someone else's hive over the swarm, the host's pubkey;
   *  null on your own hive (where feedback is written locally). */
  #host: string | null = null
  /** The host has approved this participant to post feedback. */
  #granted = false
  /** A permission request has been sent and is awaiting the host's decision. */
  #requested = false

  // ── chrome, built once per activation ────────────────────────────────
  // The header must survive a re-render because DockedPanelElement plants the
  // settings gear inside it (and nudges the close button over to make room)
  // AFTER renderPanel() returns — rebuilding the header would throw the gear
  // away. The compose footer must survive because it holds the caret.
  #titleEl: HTMLElement | null = null
  #closeEl: HTMLElement | null = null
  #subtitleEl: HTMLElement | null = null
  #hiddenBtn: HTMLButtonElement | null = null
  #hiddenGlyph: HTMLElement | null = null
  #scopeBtn: HTMLButtonElement | null = null
  #scopeGlyph: HTMLElement | null = null
  #region: HTMLElement | null = null
  #compose: HTMLElement | null = null
  #permissionHint: HTMLElement | null = null
  #nameLabel: HTMLElement | null = null
  #nameInput: HTMLInputElement | null = null
  #segmented: HTMLElement | null = null
  #ideaBtn: HTMLButtonElement | null = null
  #ideaText: Text | null = null
  #issueBtn: HTMLButtonElement | null = null
  #issueText: Text | null = null
  #composeText: HTMLTextAreaElement | null = null
  #sendBtn: HTMLButtonElement | null = null

  /** Navigation updates the URL before dispatching this event. Reading here
   *  makes "This page" swap immediately for go/goRaw/replace/back/forward,
   *  including views that do not run the tile renderer's guard lifecycle. */
  readonly #onNavigate = (): void => {
    if (this.#visible) this.#refreshRoute()
  }

  constructor() {
    super()
    // Same panel id the Angular `hcDockedPanel="feedback-viewer"` carried, so
    // the saved width (`hc:docked-width:feedback-viewer`), text size, code font
    // and group membership all come across with the participant.
    this.panelId = 'feedback-viewer'
    this.dockSide = 'right'
    this.minWidth = 280
    this.maxWidth = 680
    this.defaultWidth = 360
    // Registry-fed: mounted once at boot, engaged only when something opens it.
    this.autoActivate = false
    // The Angular original built this with `signalSession(visible, announce,
    // { close })`. Reproduced literally: park/unpark flip visibility and
    // announce and NOTHING ELSE — no reload, no identity re-read, and above all
    // no clearing, so anything half-typed in the composer is still there when
    // the hive comes back. `close` is what the Escape cascade calls (the base
    // registers it through holdToolWindow/holdWindow); this panel never bound a
    // panel-level keydown listener, in either implementation.
    this.session = {
      park: () => { this.#hide(); EffectBus.emit('feedback:panel-state', { open: false }) },
      unpark: () => { this.#show(); EffectBus.emit('feedback:panel-state', { open: true }) },
      close: () => this.close(),
    }
  }

  // ── derived readings (the component's computed signals, as getters) ───

  get #shownItems(): FeedbackItem[] {
    return visibleFeedbackItems(this.#items, this.#showHidden, item => this.#isRetired(item))
  }

  /** The inbox, narrowed to the picked reach around the current location.
   *
   *  Every page-addressed row follows the reach. Replies are the sole
   *  exception: their return-channel record has no route, so they remain
   *  visible until resolved. */
  get #scoped(): FeedbackItem[] {
    const scope = this.#scope
    const here = this.#route
    return this.#shownItems.filter(item => feedbackMatchesReach(item, scope, here))
  }

  /** AI work must not disappear into the scrolling inbox while it waits for
   *  authorization. Producers mark these explicitly; wording is never parsed.
   *
   *  POLARITY IS LOAD-BEARING, and these two are NOT complements: `pinned`
   *  demands `kind === 'qa'` where `unpinned` only refuses `approval`. A
   *  hypothetical non-question record carrying `approval` would appear in
   *  neither band — copied exactly as the component wrote it rather than
   *  re-derived into a partition that would quietly start rendering it. */
  get #pinned(): FeedbackItem[] {
    return this.#scoped.filter(i => i.kind === 'qa' && i.approval)
  }

  get #unpinned(): FeedbackItem[] {
    return this.#scoped.filter(i => !i.approval)
  }

  /** Visitor on another hive who hasn't been granted yet → the form asks
   *  for permission instead of posting. */
  get #needsPermission(): boolean {
    return this.#host !== null && !this.#granted
  }

  get #canAnswer(): boolean {
    return this.#answer.trim().length > 0 && !this.#sending
  }

  get #canSendReply(): boolean {
    return this.#reply.trim().length > 0 && !this.#sending
  }

  /** A name AND a message — feedback that reaches a host must say who it is
   *  from, so the name is part of "can this be sent" rather than an optional
   *  extra the sender skips. */
  get #canSend(): boolean {
    return this.#text.trim().length > 0 && this.#name.trim().length > 0 && !this.#sending
  }

  /** Drives the primary button's enabled state across both modes. */
  get #canSubmit(): boolean {
    if (this.#needsPermission) return !this.#requested && this.#name.trim().length > 0 && !this.#sending
    return this.#canSend
  }

  /** The glyph for the reach currently in force — the toggle's readout. */
  get #scopeIcon(): string {
    return this.#scopeOptions.find(o => o.id === this.#scope)!.icon
  }

  // ── lifecycle ────────────────────────────────────────────────────────
  override connectedCallback(): void {
    super.connectedCallback()   // autoActivate is false — this engages nothing
    installCss()
    // `<section aria-label>`'s implicit role, kept by hand: an aria-label on a
    // role-less custom element is ignored by most assistive tech, so dropping it
    // would silently un-name the panel the original took care to name.
    this.setAttribute('role', 'region')
    this.setAttribute('data-consumes-wheel', '')
    this.tabIndex = 0

    window.addEventListener('navigate', this.#onNavigate)

    // Toggle from the command-line header's feedback icon. Subscribe-time
    // replay dropped — see #subscribing.
    this.#subscribing = true
    const offToggle = EffectBus.on('feedback:toggle', () => {
      if (this.#subscribing) return
      if (this.#visible) this.close()
      else void this.openPanel()
    })
    // Explicit close (e.g. global escape cascade). Same replay treatment: a
    // re-subscribe must not announce a close nobody asked for.
    const offClose = EffectBus.on('feedback:viewer-close', () => {
      if (this.#subscribing) return
      this.close()
    })
    this.#subscribing = false

    // Live-refresh while open on every inbound path. `feedback:submitted`
    // covers local submits and live swarm posts; `feedback:channel-ingested`
    // covers feedback that arrives over the durable feedback channel from
    // another OPFS / device / cloud (FeedbackChannelDrone writes with
    // emit:false, so this is its only signal to the open panel); a host's reply
    // lands on MY pubkey-derived channel as `feedback:reply-ingested`
    // (FeedbackReplyDrone ingests with emit:false, same story).
    //
    // ALL THREE ARE STATE ASSERTIONS, NOT LEDGER APPENDS. The handler re-reads
    // the WHOLE sign('optimization') pool and REPLACES `#items`, so the same
    // ingest payload arriving twice produces the same list twice — the repeat is
    // absorbed for free, which is why neither implementation de-duplicates by
    // payload. (The `sig` each one carries is never even read here.) Nothing in
    // this panel accumulates: the only append-shaped things it owns are records
    // written to the store by an explicit press.
    const liveRefresh = (): void => { if (this.#visible) void this.reload() }

    this.#offs.push(
      offToggle,
      offClose,
      EffectBus.on('feedback:submitted', liveRefresh),
      EffectBus.on('feedback:channel-ingested', liveRefresh),
      EffectBus.on('feedback:reply-ingested', liveRefresh),

      // Re-read after rendering too. This is an idempotent safety check for any
      // navigation path that repairs or redirects the route while loading.
      EffectBus.on('navigation:guard-end', () => {
        if (this.#visible) this.#refreshRoute()
      }),

      // Activate the compose form the moment the host approves us. A replay is
      // harmless: `#host` is null until the panel is opened on someone else's
      // hive, so the identity test fails and nothing happens.
      EffectBus.on<{ host?: string }>('feedback:access-granted', (p) => {
        const h = String(p?.host ?? '').trim().toLowerCase()
        if (h && h === this.#host) {
          this.#granted = true
          this.#requested = false
          this.#syncControls()
          this.#toast('success', 'feedback.granted.title', 'feedback.granted.message')
        }
      }),

      // THE PIPE WAS IMPURE. Angular's `t` pipe is declared `pure: false`, so
      // every change-detection tick re-resolved every string and `/language ja`
      // re-labelled an OPEN panel on the spot. An element renders when it
      // decides to, so the locale switch has to be a reason to render — else an
      // open window keeps its old-locale title, reach tooltips, empty state, row
      // buttons and the whole compose form (including the only send button)
      // until it is closed and reopened. Rebuilding the list is safe: the rows
      // live in `#items`, never in the DOM. The chrome is relabelled in place,
      // because that is where the caret is.
      EffectBus.on('locale:changed', () => {
        if (!this.#visible) return
        this.#relabel()
        this.#render()
      }),
    )
  }

  override disconnectedCallback(): void {
    for (const off of this.#offs) { try { off() } catch { /* noop */ } }
    this.#offs = []
    window.removeEventListener('navigate', this.#onNavigate)
    super.disconnectedCallback()   // → deactivate(): lane, session, grip, gear, children
    this.#visible = false
    this.classList.remove('open', 'feedback-viewer-panel')
    this.removeAttribute('aria-label')
    this.#forgetChrome()
  }

  // ── the open / close verbs ───────────────────────────────────────────

  async openPanel(): Promise<void> {
    // Opening the inbox always means active work. Retired history appears only
    // after the participant explicitly asks for it in this panel.
    this.#showHidden = false
    // All three run BEFORE the DOM is built, exactly as the component ran them
    // before flipping `visible` — the name field must be born holding the
    // stored name, not get it written in afterwards.
    this.#refreshRoute()
    this.#refreshContext()
    this.#refreshIdentity()
    this.#show()
    // Broadcast open-state (last-value replayed) so the header toggle lights.
    EffectBus.emit('feedback:panel-state', { open: true })
    // Focus the panel so Escape lands without an extra click. `this` IS
    // `.feedback-viewer-panel` now, so the original's querySelector is a
    // needless round trip.
    queueMicrotask(() => { if (this.#visible) this.focus() })
    await this.reload()
  }

  /** Exactly one `feedback:panel-state {open:false}` leaves per exit — the ×,
   *  the toggle, `feedback:viewer-close`, the Escape cascade's `close` and the
   *  lane's eviction fallback all land here, and `#hide()` is idempotent. The
   *  announce is unconditional, as the component wrote it: the header light is
   *  a state assertion, and asserting "closed" twice costs nothing. */
  close(): void {
    this.#hide()
    EffectBus.emit('feedback:panel-state', { open: false })
  }

  /** DockedPanelElement's close verb — the lane's eviction fallback lands here
   *  when there is no session to park into. */
  protected override closePanel(): void { this.close() }

  #show(): void {
    if (this.#visible) return
    this.#visible = true
    // `.open` drives the CSS; `.feedback-viewer-panel` is the class the Angular
    // `<section>` carried, and it goes on and off WITH the open state so that
    // `document.querySelector('.feedback-viewer-panel')` answers exactly when
    // the `@if` used to — a DOM contract the panel's own open path used and an
    // acceptance driver may assert on. (The stylesheet keys on the tag, so the
    // class costs nothing to toggle.)
    this.classList.add('open', 'feedback-viewer-panel')
    this.setAttribute('aria-label', t('feedback.viewer.title', 'Feedback'))
    this.activate()   // renderPanel + lane + session + grip + gear + inset
  }

  #hide(): void {
    if (!this.#visible) return
    this.#visible = false
    this.classList.remove('open', 'feedback-viewer-panel')
    this.removeAttribute('aria-label')
    this.deactivate()   // clears the children — rebuild-on-open, like the `@if`
    this.#forgetChrome()
  }

  #forgetChrome(): void {
    this.#titleEl = null
    this.#closeEl = null
    this.#subtitleEl = null
    this.#hiddenBtn = null
    this.#hiddenGlyph = null
    this.#scopeBtn = null
    this.#scopeGlyph = null
    this.#region = null
    this.#compose = null
    this.#permissionHint = null
    this.#nameLabel = null
    this.#nameInput = null
    this.#segmented = null
    this.#ideaBtn = null
    this.#ideaText = null
    this.#issueBtn = null
    this.#issueText = null
    this.#composeText = null
    this.#sendBtn = null
  }

  // ── chrome (built once per activation) ───────────────────────────────
  protected override renderPanel(): void {
    this.append(
      this.#buildHeader(),
      this.#buildReach(),
      this.#buildRegion(),
      this.#buildCompose(),
    )
    this.#syncReach()
    this.#syncControls()
    this.#render()
  }

  /** Title band — one line, icon-then-title-then-close, the same shape every
   *  other tool window's header carries. */
  #buildHeader(): HTMLElement {
    const header = el('header', 'fv-header')
    const icon = glyph('forum', true)
    icon.className = 'fv-header-icon mat-sym'
    const title = el('span', 'fv-title', t('feedback.viewer.title', 'Feedback'))
    const close = el('button', 'fv-close', '×')
    close.type = 'button'
    close.setAttribute('aria-label', t('feedback.viewer.close', 'Close'))
    close.addEventListener('click', () => this.close())
    header.append(icon, title, close)
    this.#titleEl = title
    this.#closeEl = close
    return header
  }

  /** Reach row — sits under the header, just before the items it narrows. The
   *  same three reaches the pheromone filter uses, as ONE stepping toggle. */
  #buildReach(): HTMLElement {
    const row = el('div', 'fv-reach')

    const subtitle = el('span', 'fv-subtitle', t('feedback.viewer.subtitle', 'What people have shared'))

    const hidden = el('button', 'fv-hidden-mode')
    hidden.type = 'button'
    const hiddenGlyph = glyph('visibility_off', true)
    hidden.appendChild(hiddenGlyph)
    hidden.addEventListener('click', () => this.#toggleHidden())

    const scopeWrap = el('div', 'fv-scope')
    const scopeBtn = el('button', 'fv-scope-btn active')
    scopeBtn.type = 'button'
    const scopeGlyph = glyph(this.#scopeIcon)
    scopeBtn.appendChild(scopeGlyph)
    scopeBtn.addEventListener('click', () => this.#cycleScope())
    scopeWrap.appendChild(scopeBtn)

    row.append(subtitle, hidden, scopeWrap)
    this.#subtitleEl = subtitle
    this.#hiddenBtn = hidden
    this.#hiddenGlyph = hiddenGlyph
    this.#scopeBtn = scopeBtn
    this.#scopeGlyph = scopeGlyph
    return row
  }

  /** `display: contents` — the empty line and the inbox stay flex items of the
   *  PANEL (their `flex: 1` is what pins the compose footer to the floor),
   *  while one node still holds everything a list rebuild replaces. Without it,
   *  a rebuild that reached for the panel's own children would take the base's
   *  resize grip and settings gear with it. */
  #buildRegion(): HTMLElement {
    const region = el('div', 'fv-region')
    this.#region = region
    return region
  }

  /** Compose — the old share-feedback panel, docked at the bottom. Built once
   *  and never rebuilt: this is where the caret lives. */
  #buildCompose(): HTMLElement {
    const footer = el('footer', 'fv-compose')

    // `@if (needsPermission)` — genuinely detached when it does not apply, so
    // `querySelector('.fv-permission-hint')` answers the same question it did.
    const hint = el('p', 'fv-permission-hint', t(
      'feedback.permission.hint',
      "You're on another host's hive — sharing feedback needs their permission."))

    // Identity — who this is from. Required: an item that reaches a host
    // without a name is exactly what the list can't show.
    const nameWrap = el('label', 'fv-name')
    const nameLabel = el('span', 'fv-name-label', t('feedback.identity.label', 'Your name'))
    const nameInput = el('input', 'fv-name-input')
    nameInput.type = 'text'
    nameInput.maxLength = 64
    nameInput.placeholder = t('feedback.identity.placeholder', 'How should we call you?')
    nameInput.value = this.#name
    nameInput.addEventListener('input', () => {
      this.#name = nameInput.value
      // `(input)="onNameInput()"` — clear the "name required" flag as soon as
      // the participant types one.
      if (this.#nameMissing && this.#name.trim()) this.#nameMissing = false
      this.#syncControls()
    })
    nameWrap.append(nameLabel, nameInput)

    const segmented = el('div', 'fv-segmented')
    segmented.setAttribute('role', 'tablist')
    segmented.setAttribute('aria-label', t('feedback.category.label', 'Type of feedback'))
    const idea = el('button', 'fv-seg-btn')
    idea.type = 'button'
    idea.setAttribute('role', 'tab')
    const ideaText = document.createTextNode(t('feedback.category.idea', 'Idea'))
    idea.append(glyph('lightbulb'), ideaText)
    idea.addEventListener('click', () => this.#setCategory('idea'))
    const issue = el('button', 'fv-seg-btn')
    issue.type = 'button'
    issue.setAttribute('role', 'tab')
    const issueText = document.createTextNode(t('feedback.category.issue', 'Issue'))
    issue.append(glyph('bug_report'), issueText)
    issue.addEventListener('click', () => this.#setCategory('issue'))
    segmented.append(idea, issue)

    const composeText = el('textarea', 'fv-compose-text')
    composeText.rows = 3
    composeText.placeholder = t('feedback.placeholder', "What's on your mind?")
    composeText.value = this.#text
    composeText.addEventListener('input', () => {
      this.#text = composeText.value
      this.#syncControls()
    })

    const actions = el('div', 'fv-actions')
    const send = el('button', 'fv-btn primary')
    send.type = 'button'
    send.addEventListener('click', () => void this.submit())
    actions.appendChild(send)

    footer.append(nameWrap, segmented, composeText, actions)

    this.#compose = footer
    this.#permissionHint = hint
    this.#nameLabel = nameLabel
    this.#nameInput = nameInput
    this.#segmented = segmented
    this.#ideaBtn = idea
    this.#ideaText = ideaText
    this.#issueBtn = issue
    this.#issueText = issueText
    this.#composeText = composeText
    this.#sendBtn = send
    return footer
  }

  /** Re-resolve every string written ONCE per activation — the ones a list
   *  rebuild never touches. The list's own strings come back through
   *  `#render`. */
  #relabel(): void {
    this.setAttribute('aria-label', t('feedback.viewer.title', 'Feedback'))
    if (this.#titleEl) this.#titleEl.textContent = t('feedback.viewer.title', 'Feedback')
    this.#closeEl?.setAttribute('aria-label', t('feedback.viewer.close', 'Close'))
    if (this.#subtitleEl) {
      this.#subtitleEl.textContent = t('feedback.viewer.subtitle', 'What people have shared')
    }
    if (this.#permissionHint) {
      this.#permissionHint.textContent = t(
        'feedback.permission.hint',
        "You're on another host's hive — sharing feedback needs their permission.")
    }
    if (this.#nameLabel) this.#nameLabel.textContent = t('feedback.identity.label', 'Your name')
    if (this.#nameInput) {
      this.#nameInput.placeholder = t('feedback.identity.placeholder', 'How should we call you?')
    }
    this.#segmented?.setAttribute('aria-label', t('feedback.category.label', 'Type of feedback'))
    if (this.#ideaText) this.#ideaText.data = t('feedback.category.idea', 'Idea')
    if (this.#issueText) this.#issueText.data = t('feedback.category.issue', 'Issue')
    if (this.#composeText) {
      this.#composeText.placeholder = t('feedback.placeholder', "What's on your mind?")
    }
    this.#syncReach()
    this.#syncControls()
  }

  // ── in-place chrome updates (no rebuild — the caret lives here) ───────

  /** The reach row's two toggles: pressed state, glyph and the labels that
   *  swap with them. */
  #syncReach(): void {
    const showing = this.#showHidden
    if (this.#hiddenBtn) {
      // `[class.active]` / `[attr.aria-pressed]`, and ONE label used for both
      // title and aria-label — chosen at RUNTIME, so both keys are rendered by
      // this surface and both must be in its catalog.
      const label = showing
        ? t('feedback.viewer.hide-retired', 'Hide retired')
        : t('controls.show-hidden', 'show hidden')
      this.#hiddenBtn.classList.toggle('active', showing)
      this.#hiddenBtn.setAttribute('aria-pressed', String(showing))
      this.#hiddenBtn.setAttribute('aria-label', label)
      this.#hiddenBtn.title = label
    }
    if (this.#hiddenGlyph) this.#hiddenGlyph.textContent = showing ? 'visibility' : 'visibility_off'
    if (this.#scopeGlyph) this.#scopeGlyph.textContent = this.#scopeIcon
    if (this.#scopeBtn) {
      // `'tags.scope-' + scope() | t` — a key BUILT AT RUNTIME. Its three
      // expansions (tags.scope-local / -children / -global) are invisible to a
      // regex harvest and are carried in this surface's catalog by hand.
      const label = t(`tags.scope-${this.#scope}`, SCOPE_FALLBACK[this.#scope])
      this.#scopeBtn.title = label
      this.#scopeBtn.setAttribute('aria-label', label)
    }
  }

  /** Everything on the compose footer (and the list's disabled gates) that
   *  follows state rather than text: the permission hint's presence, the
   *  category tabs, the name field's refusal light, and every `[disabled]`
   *  binding the template carried. Mutating existing nodes, never a rebuild —
   *  a rebuild here would drop the caret. */
  #syncControls(): void {
    const footer = this.#compose
    const hint = this.#permissionHint
    const needs = this.#needsPermission
    if (footer && hint) {
      if (needs && hint.parentNode !== footer) footer.insertBefore(hint, footer.firstChild)
      else if (!needs && hint.parentNode === footer) hint.remove()
    }
    if (this.#ideaBtn) {
      const on = this.#category === 'idea'
      this.#ideaBtn.classList.toggle('active', on)
      this.#ideaBtn.setAttribute('aria-selected', String(on))
    }
    if (this.#issueBtn) {
      const on = this.#category === 'issue'
      this.#issueBtn.classList.toggle('active', on)
      this.#issueBtn.setAttribute('aria-selected', String(on))
    }
    this.#nameInput?.classList.toggle('missing', this.#nameMissing)
    if (this.#sendBtn) {
      this.#sendBtn.textContent = needs
        ? t('feedback.request.send', 'Request permission')
        : t('feedback.send', 'Send')
      this.#sendBtn.disabled = !this.#canSubmit
    }
    // The three `[disabled]` bindings inside the rebuilt list. Angular
    // re-evaluated them on every tick, so typing one character enabled the send
    // button; here the row that owns the caret asks for this directly.
    for (const btn of this.querySelectorAll<HTMLButtonElement>('[data-fv-gate]')) {
      switch (btn.dataset['fvGate']) {
        case 'answer': btn.disabled = !this.#canAnswer; break
        case 'reply': btn.disabled = !this.#canSendReply; break
        case 'decision': btn.disabled = this.#sending; break
      }
    }
  }

  #setSending(value: boolean): void {
    this.#sending = value
    this.#syncControls()
  }

  // ── reach + lens verbs ───────────────────────────────────────────────

  #setScope(id: Scope): void {
    this.#scope = id
    this.#syncReach()
    this.#render()
  }

  /** Step to the next reach and wrap — local → children → global → local. */
  #cycleScope(): void {
    const at = this.#scopeOptions.findIndex(o => o.id === this.#scope)
    this.#setScope(this.#scopeOptions[(at + 1) % this.#scopeOptions.length].id)
  }

  #toggleHidden(): void {
    this.#showHidden = !this.#showHidden
    this.#syncReach()
    this.#render()
  }

  #setCategory(c: FeedbackCategory): void {
    this.#category = c
    this.#syncControls()
  }

  // ── context, route and identity ──────────────────────────────────────

  #refreshRoute(): void {
    const nav = get<NavigationLike>(NAVIGATION_KEY)
    const next = (nav?.segmentsRaw?.() ?? []).map(String).join('/')
    if (next === this.#route) return
    this.#route = next
    this.#render()
  }

  /** Load the stored name into the field and resolve my pubkey in the
   *  background (the signer is another module, so it may not be up yet — a
   *  missing pubkey never blocks sending, the NAME is what identifies a
   *  person). */
  #refreshIdentity(): void {
    let stored = ''
    try { stored = String(localStorage.getItem(LABEL_KEY) ?? '').trim().slice(0, 64) } catch { /* private mode */ }
    if (stored && !this.#name.trim()) {
      this.#name = stored
      if (this.#nameInput) this.#nameInput.value = stored
    }
    this.#named = !!this.#name.trim()
    if (this.#myPubkey) return
    const signer = get<SignerLike>(SIGNER_KEY)
    void signer?.getPublicKeyHex?.().then(pk => {
      const p = String(pk ?? '').trim().toLowerCase()
      if (HEX64.test(p)) this.#myPubkey = p
    }).catch(() => { /* no identity yet — the name still stands */ })
  }

  /** Persist the typed name as THE participant identity (same key the mesh
   *  modal writes), and return it. Empty when the participant hasn't named
   *  themselves — callers refuse to send on that. */
  #commitName(): string {
    const clean = this.#name.trim().slice(0, 64)
    if (!clean) return ''
    try { localStorage.setItem(LABEL_KEY, clean) } catch { /* private mode — in-session only */ }
    this.#named = true
    this.#nameMissing = false
    this.#syncControls()
    return clean
  }

  /** The identity stamped on every record this participant writes. */
  #identity(): { by: string; from: string } {
    return { by: this.#commitName(), from: this.#myPubkey ?? '' }
  }

  /** Resolve whether we're a visitor (and on whose hive) + our grant state.
   *  Both swarm drones are resolved at runtime via window.ioc. */
  #refreshContext(): void {
    const swarm = get<SwarmLike>(SWARM_KEY)
    const h = String(swarm?.subscribedTo?.() ?? '').trim().toLowerCase()
    const host = HEX64.test(h) ? h : null
    this.#host = host
    if (host) {
      const fs = get<FeedbackSwarmLike>(FEEDBACK_SWARM_KEY)
      this.#granted = !!fs?.isGrantedBy?.(host)
    } else {
      this.#granted = false
    }
    this.#syncControls()
  }

  // ── data ─────────────────────────────────────────────────────────────

  /** Re-read the whole sign('optimization') pool and project the inbox out of
   *  it. A SET, not an append: every delivery of every ingest effect lands on
   *  the same list, so a repeated payload changes nothing. */
  async reload(): Promise<void> {
    const store = get<StoreLike>(STORE_KEY)
    if (!store?.listOptimizations || !store.getOptimization) {
      this.#items = []
      this.#render()
      return
    }
    this.#loading = true
    try {
      const sigs = await store.listOptimizations()
      const records: Array<{ sig: string; value: any }> = []
      // Read once, then project. Hidden markers may sort before or after their
      // target, and answers may sort before or after their question, so all
      // retirement ledgers are deliberately collected in a separate pass.
      for (const sig of sigs) {
        const blob = await store.getOptimization(sig)
        if (!blob) continue
        try {
          const value = JSON.parse(await blob.text())
          records.push({ sig, value })
        } catch { /* skip non-JSON */ }
      }
      const retirement = indexFeedbackRetirements(records)
      const out: FeedbackItem[] = []
      for (const { sig, value: o } of records) {
        try {
          const p = o?.payload ?? {}
          const by = String(p.by ?? p.label ?? '')
          const from = String(p.from ?? '')
          if (o?.kind === 'feedback') {
            out.push({
              sig,
              kind: 'feedback',
              category: String(p.category ?? 'idea'),
              text: String(p.text ?? ''),
              route: String(p.route ?? ''),
              at: Number(p.at ?? 0),
              id: String(p.id ?? ''),
              by, from,
              qId: '',
              qPath: [],
              approval: false,
              why: '',
              re: '',
              hiddenRecordSig: retirement.hiddenByTarget.get(sig.toLowerCase()) ?? '',
              seenRecordSig: retirement.seenByKey.get(String(p.id ?? '').trim()) ?? '',
            })
          } else if (o?.kind === 'feedback-reply') {
            // The host's answer to feedback I sent — arrived over my own
            // pubkey-derived reply channel (FeedbackReplyDrone).
            const text = String(p.text ?? '').trim()
            if (!text) continue
            out.push({
              sig,
              kind: 'reply',
              category: 'reply',
              text,
              route: '',
              at: Number(p.at ?? 0),
              id: String(p.reId ?? ''),
              by, from,
              qId: '',
              qPath: [],
              approval: false,
              why: '',
              re: String(p.re ?? ''),
              hiddenRecordSig: retirement.hiddenByTarget.get(sig.toLowerCase()) ?? '',
              seenRecordSig: '',
            })
          } else if (o?.kind === 'qa') {
            // An OPEN question — the record the dashboard used to render as a
            // hex tile. `appliesTo` is the lineage it concerns, which doubles
            // as its route so the reach filter narrows questions exactly like
            // feedback.
            const question = String(p.question ?? '').trim()
            if (!question) continue
            const path = Array.isArray(o.appliesTo) ? (o.appliesTo as unknown[]).map(String) : []
            const qId = String(p.qId ?? sig.slice(0, 16))
            // A qa-answer is the durable tombstone for its open question.
            // The channel is add-only and may replay the qa after local
            // removal; never ask the participant for the same answer twice.
            if (questionWasAnswered(retirement, sig, qId)) continue
            const approval = p.responseKind === 'approval' || p.requiresApproval === true
            out.push({
              sig,
              kind: 'qa',
              category: 'question',
              text: question,
              route: path.join('/'),
              at: Number(p.askedAt ?? p.at ?? 0),
              id: qId,
              by, from,
              qId,
              qPath: path,
              approval,
              why: this.#questionReason(p, approval),
              re: '',
              hiddenRecordSig: '',
              seenRecordSig: '',
            })
          }
        } catch { /* skip non-JSON */ }
      }
      // Bands: questions first (waiting on the participant), then replies
      // (news for the participant), then feedback — newest-first within each.
      const band = (k: FeedbackItem['kind']): number => k === 'qa' ? 0 : k === 'reply' ? 1 : 2
      out.sort((a, b) => (band(a.kind) - band(b.kind)) || (b.at - a.at))
      this.#items = out
    } finally {
      this.#loading = false
    }
    this.#render()
  }

  // ── row actions ──────────────────────────────────────────────────────

  /** Retire an item: a local `kind:'hidden'` marker targeting its signature,
   *  mirrored into the feedback loop's `feedback-seen` ledger. The feedback
   *  bytes are never touched, so a relay replay cannot resurrect the row and
   *  "show hidden" can still visit it. */
  async resolve(item: FeedbackItem): Promise<boolean> {
    const store = get<StoreLike>(STORE_KEY)
    if (!store?.putOptimization || this.#isRetired(item)) return false
    const appliesTo = item.route.split('/').map(s => s.trim()).filter(Boolean)
    const record = {
      kind: 'hidden',
      appliesTo,
      payload: {
        targetKind: 'feedback-item',
        targetSig: item.sig,
        itemKind: item.kind,
      },
      mark: 'persistent',
    }
    try {
      const hiddenRecordSig = await store.putOptimization(
        new Blob([new TextEncoder().encode(JSON.stringify(record)) as BlobPart]),
      )
      // The scheduled feedback loop already treats `feedback-seen` as its
      // local retirement ledger. Mirror Resolve into that ledger so a relay
      // replay cannot re-queue or re-display the item under the same id.
      let seenRecordSig = item.seenRecordSig
      if (item.kind === 'feedback' && item.id) {
        const seen = { kind: 'feedback-seen', payload: { key: item.id, at: Date.now() } }
        try {
          seenRecordSig = await store.putOptimization(
            new Blob([new TextEncoder().encode(JSON.stringify(seen)) as BlobPart]),
          )
        } catch (err) {
          // The sig-targeted hidden marker is already durable, so the row is
          // closed. Failure here only affects the routine's id-level dedupe.
          console.warn('[feedback] could not mirror resolve into feedback-seen', err)
        }
      }
      this.#items = this.#items.map(i => i.sig === item.sig
        ? { ...i, hiddenRecordSig, seenRecordSig }
        : i)
      if (this.#answering === item.sig) this.#answering = null
      if (this.#replyingTo === item.sig) this.#replyingTo = null
      this.#render()
      return true
    } catch (err) {
      console.warn('[feedback] could not resolve item', err)
      this.#toast('error', 'feedback.resolve.error.title', 'feedback.resolve.error.message')
      return false
    }
  }

  /** Remove every local retirement marker for an explicitly restored item.
   *  This intentionally makes it eligible for the feedback loop again. */
  async restore(item: FeedbackItem): Promise<void> {
    const markers = [...new Set([item.hiddenRecordSig, item.seenRecordSig].filter(Boolean))]
    if (!markers.length) return
    const store = get<StoreLike>(STORE_KEY)
    if (!store?.removeOptimization) return
    for (const sig of markers) await store.removeOptimization(sig)
    this.#items = this.#items.map(i => i.sig === item.sig
      ? { ...i, hiddenRecordSig: '', seenRecordSig: '' }
      : i)
    this.#render()
  }

  // ── answering an open question (the retired QA modal, inline) ─────────

  /** Open / close the answer box on a question row. One at a time. */
  #toggleAnswer(item: FeedbackItem): void {
    if (this.#answering === item.sig) {
      this.#answering = null
      this.#answer = ''
    } else {
      this.#answering = item.sig
      this.#answer = ''
    }
    this.#render()
  }

  /** Go to the tile the question is about, without losing the panel. A
   *  feedback row's route button shares this handler and carries no `qPath`,
   *  so it does nothing — as it always did. */
  #goToQuestion(item: FeedbackItem): void {
    if (!item.qPath.length) return
    get<NavigationLike>(NAVIGATION_KEY)?.goRaw?.([...item.qPath])
  }

  /** Mint a `qa-answer` pairing the question with the participant's raw answer,
   *  then retire the open `qa`. The raw text is DECORATION, not canonical
   *  content: it rests in the sign('optimization') pool until the next codegen
   *  pass interprets it into a note. Identical to what QaModalView committed —
   *  plus the identity, so the routine knows whose answer it is. */
  async submitAnswer(item: FeedbackItem): Promise<void> {
    if (!this.#canAnswer) return
    await this.#commitAnswer(item, this.#answer.trim())
  }

  /** Approval questions deliberately have no editable text box: the decision
   *  is the answer. `decision` is machine-readable while `answer` preserves
   *  compatibility with existing feedback-loop consumers. */
  async submitDecision(item: FeedbackItem, decision: 'approved' | 'declined'): Promise<void> {
    if (item.kind !== 'qa' || !item.approval || this.#sending) return
    await this.#commitAnswer(item, decision, decision)
  }

  async #commitAnswer(
    item: FeedbackItem,
    text: string,
    decision?: 'approved' | 'declined',
  ): Promise<void> {
    const store = get<StoreLike>(STORE_KEY)
    if (!store?.putOptimization) {
      this.#toast('error', 'feedback.error.title', 'feedback.error.message')
      return
    }
    this.#setSending(true)
    try {
      const { by, from } = this.#identity()
      const record = {
        kind: 'qa-answer',
        appliesTo: [...item.qPath],
        payload: {
          qId: item.qId,
          qSig: item.sig,
          question: item.text,
          answer: text,
          ...(decision ? { decision } : {}),
          answeredAt: Date.now(),
          ...(by ? { by } : {}),
          ...(from ? { from } : {}),
        },
        mark: 'persistent',
      }
      await store.putOptimization(new Blob([new TextEncoder().encode(JSON.stringify(record)) as BlobPart]))
      // The routine consumes and removes qa-answer after acting on it. Keep a
      // tiny local tombstone so an add-only channel replay cannot resurrect
      // the question after that response record has been drained.
      const answered = {
        kind: 'qa-answered',
        appliesTo: [...item.qPath],
        payload: { qId: item.qId, qSig: item.sig, at: Date.now() },
        mark: 'persistent',
      }
      try {
        await store.putOptimization(
          new Blob([new TextEncoder().encode(JSON.stringify(answered)) as BlobPart]),
        )
      } catch (err) {
        // The qa-answer itself still closes the row for now and must remain
        // available to the routine. Report the durability failure without
        // pretending the participant's response was lost.
        console.warn('[feedback] could not persist qa-answered tombstone', err)
      }
      // The open question is answered — retire it so it stops asking.
      try { await store.removeOptimization?.(item.sig) } catch { /* tolerate */ }
      this.#items = this.#items.filter(i => i.sig !== item.sig)
      this.#answering = null
      this.#answer = ''
      this.#render()
      this.#toast('success', 'feedback.answered.title', 'feedback.answered.message')
    } catch (err) {
      console.warn('[feedback] answer failed', err)
      this.#toast('error', 'feedback.error.title', 'feedback.error.message')
    } finally {
      this.#setSending(false)
    }
  }

  /** The template bound plain `(keydown)`, NOT Angular's `keydown.escape`, so
   *  there is no modifier composition to reproduce: a raw `event.key` test is
   *  exactly what this always was, and adding a modifier guard here would
   *  itself be the regression. */
  #onAnswerKey(event: KeyboardEvent, item: FeedbackItem): void {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); this.#toggleAnswer(item)
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault(); void this.submitAnswer(item)
    }
  }

  // ── replying to a sender (the return channel) ────────────────────────

  /** A row can be replied to when it carries an ADDRESS — the sender's
   *  pubkey — and that address isn't me. The pubkey is the "code" each
   *  instance provides automatically; the name is display-only on top. */
  #canReply(item: FeedbackItem): boolean {
    return item.kind === 'feedback' && HEX64.test(item.from) && item.from !== this.#myPubkey
  }

  /** Open / close the reply box on a row. One at a time. */
  #toggleReply(item: FeedbackItem): void {
    if (this.#replyingTo === item.sig) {
      this.#replyingTo = null
      this.#reply = ''
    } else {
      this.#replyingTo = item.sig
      this.#reply = ''
    }
    this.#render()
  }

  /** Send the reply back to the item's sender over their pubkey-derived
   *  channel (FeedbackReplyDrone). It lands in THEIR feedback window as a
   *  `reply` row quoting this item. Requires a name — a reply from nobody is
   *  the same failure as feedback from nobody. */
  async submitReply(item: FeedbackItem): Promise<void> {
    if (!this.#canSendReply || !this.#canReply(item)) return
    if (!this.#name.trim()) {
      this.#nameMissing = true
      this.#syncControls()
      this.#toast('error', 'feedback.identity.title', 'feedback.identity.message')
      return
    }
    const drone = get<ReplyDroneLike>(FEEDBACK_REPLY_KEY)
    if (!drone?.sendReply) {
      this.#toast('error', 'feedback.reply.error.title', 'feedback.reply.error.message')
      return
    }
    this.#setSending(true)
    try {
      const { by, from } = this.#identity()
      const ok = await drone.sendReply({
        to: item.from,
        text: this.#reply.trim(),
        reId: item.id,
        re: item.text.slice(0, 280),
        by, from,
      })
      if (!ok) {
        this.#toast('error', 'feedback.reply.error.title', 'feedback.reply.error.message')
        return
      }
      this.#replyingTo = null
      this.#reply = ''
      // A response completes the inbox task. Keep the source bytes for the
      // history lens, but retire the row before confirming success.
      await this.resolve(item)
      this.#toast('success', 'feedback.replied.title', 'feedback.replied.message')
    } finally {
      this.#setSending(false)
    }
  }

  #onReplyKey(event: KeyboardEvent, item: FeedbackItem): void {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); this.#toggleReply(item)
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault(); void this.submitReply(item)
    }
  }

  // ── compose ──────────────────────────────────────────────────────────

  async submit(): Promise<void> {
    // No name = no send. The host has to be able to tell who an item is from,
    // and a name typed once is remembered for every surface (mesh, swarm).
    if (!this.#name.trim()) {
      this.#nameMissing = true
      this.#syncControls()
      this.#toast('error', 'feedback.identity.title', 'feedback.identity.message')
      queueMicrotask(() => this.#nameInput?.focus())
      return
    }
    // Ungranted visitor → ask the host's permission instead of posting.
    if (this.#needsPermission) { this.requestAccess(); return }
    if (!this.#canSend) return
    this.#setSending(true)
    try {
      const nav = get<NavigationLike>(NAVIGATION_KEY)
      const segments = (nav?.segmentsRaw?.() ?? []).map(String)
      const { by, from } = this.#identity()
      // Same payload the loop reads (id/category/text/route/at), plus the
      // identity so every item in the list can say who it came from.
      const payload = {
        id: `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        category: this.#category,
        text: this.#text.trim(),
        route: segments.join('/'),
        at: Date.now(),
        by,
        ...(from ? { from } : {}),
      }
      const host = this.#host
      if (host && this.#granted) {
        // Granted visitor → post over the swarm to the host's inbox; the
        // FeedbackSwarmDrone publishes it and the host ingests it.
        EffectBus.emit('feedback:remote-post', { host, payload: { ...payload, appliesTo: segments } })
      } else {
        // Own hive → write straight to the local optimization inbox, the
        // exact same record shape the Q&A modal mints. `feedback:submitted`
        // triggers our own live refresh, so the new item appears in the list.
        const store = get<StoreLike>(STORE_KEY)
        if (!store?.putOptimization) {
          this.#toast('error', 'feedback.error.title', 'feedback.error.message')
          return
        }
        const record = { kind: 'feedback', appliesTo: segments, payload, mark: 'persistent' }
        await store.putOptimization(new Blob([new TextEncoder().encode(JSON.stringify(record)) as BlobPart]))
        EffectBus.emit('feedback:submitted', {})
      }
      this.#toast('success', 'feedback.sent.title', 'feedback.sent.message')
      this.#text = ''
      if (this.#composeText) this.#composeText.value = ''
      this.#category = 'idea'
    } catch (err) {
      console.warn('[feedback] submit failed', err)
      this.#toast('error', 'feedback.error.title', 'feedback.error.message')
    } finally {
      this.#setSending(false)
    }
  }

  /** Visitor: ask the host for permission to share feedback. The
   *  FeedbackSwarmDrone publishes the request over the swarm; the host sees a
   *  consent toast and, on approval, our `feedback:access-granted` fires. The
   *  name rides along so the host's consent toast names a person, not a
   *  pubkey prefix. */
  requestAccess(): void {
    const host = this.#host
    if (!host || this.#requested) return
    EffectBus.emit('feedback:request-access', { host, label: this.#commitName() })
    this.#requested = true
    this.#syncControls()
    this.#toast('success', 'feedback.request.title', 'feedback.request.message')
  }

  // ── row helpers ──────────────────────────────────────────────────────

  #icon(item: FeedbackItem): string {
    if (item.kind === 'qa') return item.approval ? 'approval' : 'help'
    if (item.kind === 'reply') return 'reply'
    return item.category === 'issue' ? 'bug_report' : 'lightbulb'
  }

  #isRetired(item: FeedbackItem): boolean {
    return !!(item.hiddenRecordSig || item.seenRecordSig)
  }

  /** Who the row is from, resolved for display: the name if they gave one,
   *  else a short pubkey, else nothing (the row simply shows no author). */
  #author(item: FeedbackItem): string {
    const by = item.by.trim()
    if (by) return by
    return item.from ? `${item.from.slice(0, 8)}…` : ''
  }

  /** Untranslated in the original — these five words never went through the
   *  pipe, and translating them here would be a change of behaviour dressed as
   *  a port. No timer either: the reading is taken when the list is built,
   *  exactly as Angular took it on whatever tick happened to run. */
  #relativeTime(at: number): string {
    if (!at) return ''
    const diff = Date.now() - at
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  }

  // ── rendering the list (rebuild on change, with the caret carried) ────

  #render(): void {
    const region = this.#region
    if (!region) return

    // WHERE THE PARTICIPANT WAS. Angular's `@for … track trackBySig` kept the
    // row NODE for any sig that survived, so a `feedback:channel-ingested`
    // landing while you scrolled — or typed an answer — was invisible. This
    // render mints fresh nodes, which start at scrollTop 0 with nothing
    // focused. Measured before the teardown, applied after the new nodes are in
    // the document (scrollTop on a detached node does not stick).
    const oldList = region.querySelector('.fv-list')
    const oldPinned = region.querySelector('.fv-pinned')
    const listTop = oldList?.scrollTop ?? 0
    const pinnedTop = oldPinned?.scrollTop ?? 0
    const snap = this.#snapshotFocus()

    const scoped = this.#scoped
    const parts: HTMLElement[] = []

    if (scoped.length === 0) {
      // Two different silences: nothing has ever arrived, or the reach is too
      // narrow to see what has. The empty line says which — and the SECOND key
      // is chosen at RUNTIME, so both live in this surface's catalog.
      const empty = el('p', 'fv-empty', this.#shownItems.length === 0
        ? t('feedback.viewer.empty', 'No feedback yet.')
        : t('feedback.viewer.empty-scope', 'No feedback in this reach yet — widen it above.'))
      parts.push(empty)
    } else {
      const inbox = el('div', 'fv-inbox')
      const pinned = this.#pinned
      if (pinned.length) inbox.appendChild(this.#buildPinnedBand(pinned))
      const unpinned = this.#unpinned
      if (unpinned.length) {
        const list = el('ul', 'fv-list')
        for (const item of unpinned) list.appendChild(this.#buildRow(item))
        inbox.appendChild(list)
      }
      parts.push(inbox)
    }

    region.replaceChildren(...parts)

    const newList = region.querySelector('.fv-list')
    if (newList && listTop > 0) newList.scrollTop = listTop
    const newPinned = region.querySelector('.fv-pinned')
    if (newPinned && pinnedTop > 0) newPinned.scrollTop = pinnedTop
    this.#restoreFocus(snap)
    // The `[disabled]` gates inside the rows the rebuild just minted.
    this.#syncControls()
  }

  /** AI work waiting on authorization is a pinned band, separate from the
   *  scrolling inbox. Its own bound keeps several requests from taking the
   *  panel. */
  #buildPinnedBand(items: readonly FeedbackItem[]): HTMLElement {
    const section = el('section', 'fv-pinned')
    section.setAttribute('aria-label', t('feedback.approval.title', 'AI requests'))

    const label = el('div', 'fv-pinned-label')
    label.append(glyph('push_pin', true), document.createTextNode(
      t('feedback.approval.title', 'AI requests')))

    const list = el('ul', 'fv-pinned-list')
    for (const item of items) list.appendChild(this.#buildPinnedRow(item))

    section.append(label, list)
    return section
  }

  #buildPinnedRow(item: FeedbackItem): HTMLElement {
    const row = el('li', 'fv-row question approval')
    row.appendChild(el('span', 'fv-icon mat-sym', this.#icon(item)))

    const body = el('div', 'fv-body')
    body.appendChild(el('p', 'fv-text', item.text))
    body.appendChild(this.#buildWhy(item))

    const meta = el('div', 'fv-meta')
    if (item.route) meta.appendChild(this.#buildRouteButton(item))
    meta.appendChild(el('span', 'fv-time', this.#relativeTime(item.at)))
    body.appendChild(meta)

    const actions = el('div', 'fv-decision-actions')
    const approve = el('button', 'fv-decision approve', t('feedback.approval.approve', 'Approve'))
    approve.type = 'button'
    approve.dataset['fvGate'] = 'decision'
    approve.dataset['fvFocus'] = `approve:${item.sig}`
    approve.addEventListener('click', () => void this.submitDecision(item, 'approved'))
    const discard = el('button', 'fv-decision discard', t('feedback.approval.discard', 'Discard'))
    discard.type = 'button'
    discard.dataset['fvGate'] = 'decision'
    discard.dataset['fvFocus'] = `discard:${item.sig}`
    discard.addEventListener('click', () => void this.submitDecision(item, 'declined'))
    actions.append(approve, discard)

    row.append(body, actions)
    return row
  }

  #buildRow(item: FeedbackItem): HTMLElement {
    const row = el('li', 'fv-row')
    if (item.category === 'issue') row.classList.add('issue')
    if (item.kind === 'qa') row.classList.add('question')
    if (item.kind === 'reply') row.classList.add('reply')
    const retired = this.#isRetired(item)
    if (retired) row.classList.add('hidden')

    row.appendChild(el('span', 'fv-icon mat-sym', this.#icon(item)))

    const body = el('div', 'fv-body')

    // A reply quotes the feedback it answers, so the sender knows which of
    // their items this is about.
    if (item.kind === 'reply' && item.re) {
      const quote = el('p', 'fv-quote', item.re)
      quote.title = item.re
      body.appendChild(quote)
    }

    body.appendChild(el('p', 'fv-text', item.text))
    if (item.kind === 'qa') body.appendChild(this.#buildWhy(item))

    const meta = el('div', 'fv-meta')
    // Who it came from. Always first: an item with no author is the thing this
    // panel exists to stop happening.
    const author = this.#author(item)
    if (author) {
      const who = el('span', 'fv-author')
      who.append(glyph('person'), document.createTextNode(author))
      meta.appendChild(who)
    } else {
      meta.appendChild(el('span', 'fv-author anon', t('feedback.viewer.anonymous', 'unnamed')))
    }
    if (item.route) meta.appendChild(this.#buildRouteButton(item))
    meta.appendChild(el('span', 'fv-time', this.#relativeTime(item.at)))
    if (retired) {
      const flag = el('span', 'fv-hidden-label')
      flag.append(glyph('visibility_off', true), document.createTextNode(
        t('controls.show-hidden', 'show hidden')))
      meta.appendChild(flag)
    }
    body.appendChild(meta)

    // A question takes an answer right here — this is what the retired
    // dashboard modal did, without leaving the panel.
    if (item.kind === 'qa' && this.#answering === item.sig) {
      body.append(...this.#buildComposeBox(
        item, 'answer',
        t('feedback.answer.placeholder', 'type your answer…'),
        t('feedback.answer.send', 'Done')))
    }

    // The return channel: reply to the sender over their pubkey-derived
    // channel; it lands in THEIR feedback window.
    if (this.#canReply(item) && this.#replyingTo === item.sig) {
      body.append(...this.#buildComposeBox(
        item, 'reply',
        t('feedback.reply.placeholder', 'Write a reply…'),
        t('feedback.reply.send', 'Send reply')))
    }

    row.appendChild(body)

    if (item.kind === 'qa') {
      const toggle = el('button', 'fv-resolve', this.#answering === item.sig
        ? t('feedback.viewer.close', 'Close')
        : t('feedback.viewer.answer', 'Answer'))
      toggle.type = 'button'
      toggle.dataset['fvFocus'] = `answer-toggle:${item.sig}`
      toggle.addEventListener('click', () => this.#toggleAnswer(item))
      row.appendChild(toggle)
    } else {
      const actions = el('div', 'fv-row-actions')
      if (retired) {
        const back = el('button', 'fv-resolve restore', t('action.break-apart', 'restore'))
        back.type = 'button'
        back.dataset['fvFocus'] = `restore:${item.sig}`
        back.addEventListener('click', () => void this.restore(item))
        actions.appendChild(back)
      } else {
        if (this.#canReply(item)) {
          const toggle = el('button', 'fv-resolve', this.#replyingTo === item.sig
            ? t('feedback.viewer.close', 'Close')
            : t('feedback.viewer.reply', 'Reply'))
          toggle.type = 'button'
          toggle.dataset['fvFocus'] = `reply-toggle:${item.sig}`
          toggle.addEventListener('click', () => this.#toggleReply(item))
          actions.appendChild(toggle)
        }
        const label = t('feedback.viewer.resolve', 'Resolve')
        const done = el('button', 'fv-resolve', label)
        done.type = 'button'
        done.setAttribute('aria-label', label)
        done.dataset['fvFocus'] = `resolve:${item.sig}`
        done.addEventListener('click', () => void this.resolve(item))
        actions.appendChild(done)
      }
      row.appendChild(actions)
    }

    return row
  }

  /** Explain-yourself line under a question's text. */
  #buildWhy(item: FeedbackItem): HTMLElement {
    const why = el('p', 'fv-why')
    why.append(glyph('info', true), document.createTextNode(item.why))
    return why
  }

  /** The route doubles as a jump to the tile the item is about. */
  #buildRouteButton(item: FeedbackItem): HTMLElement {
    const route = el('button', 'fv-route', item.route)
    route.type = 'button'
    route.title = item.route
    route.dataset['fvFocus'] = `route:${item.sig}`
    route.addEventListener('click', () => this.#goToQuestion(item))
    return route
  }

  /** The inline answer / reply pair — one textarea and one send button. Both
   *  read their text from a FIELD, so the box survives a rebuild with its
   *  content intact; the focus snapshot carries the caret. */
  #buildComposeBox(
    item: FeedbackItem,
    kind: 'answer' | 'reply',
    placeholder: string,
    sendLabel: string,
  ): HTMLElement[] {
    const box = el('textarea', 'fv-answer-text')
    box.rows = 3
    box.placeholder = placeholder
    box.value = kind === 'answer' ? this.#answer : this.#reply
    box.dataset['fvFocus'] = `${kind}:${item.sig}`
    box.addEventListener('input', () => {
      if (kind === 'answer') this.#answer = box.value
      else this.#reply = box.value
      this.#syncControls()
    })
    box.addEventListener('keydown', (event) => {
      if (kind === 'answer') this.#onAnswerKey(event, item)
      else this.#onReplyKey(event, item)
    })

    const actions = el('div', 'fv-answer-actions')
    const send = el('button', 'fv-btn primary', sendLabel)
    send.type = 'button'
    send.dataset['fvGate'] = kind
    send.dataset['fvFocus'] = `${kind}-send:${item.sig}`
    send.addEventListener('click', () => {
      if (kind === 'answer') void this.submitAnswer(item)
      else void this.submitReply(item)
    })
    actions.appendChild(send)

    return [box, actions]
  }

  // ── focus across a rebuild ───────────────────────────────────────────

  #snapshotFocus(): FocusSnap | null {
    const region = this.#region
    const active = document.activeElement
    if (!region || !(active instanceof HTMLElement) || !region.contains(active)) return null
    const key = active.dataset['fvFocus']
    if (!key) return null
    if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
      return { key, start: active.selectionStart, end: active.selectionEnd }
    }
    return { key, start: null, end: null }
  }

  #restoreFocus(snap: FocusSnap | null): void {
    const region = this.#region
    if (!snap || !region) return
    // `globalThis.CSS`, spelled out, because this module already has a
    // module-scope `const CSS` holding its stylesheet — the house name every
    // converted view uses — and it shadows the global. A bare `CSS.escape`
    // resolves to the string and does not compile.
    const next = region.querySelector(
      `[data-fv-focus="${globalThis.CSS.escape(snap.key)}"]`)
    // If the row went away (resolved, answered, filtered out by a reach change)
    // there is simply nothing to focus, and we leave it alone rather than moving
    // focus somewhere the participant did not put it.
    if (!(next instanceof HTMLElement)) return
    next.focus()
    if (snap.start === null) return
    if (next instanceof HTMLTextAreaElement || next instanceof HTMLInputElement) {
      try { next.setSelectionRange(snap.start, snap.end ?? snap.start) } catch { /* not a text field any more */ }
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────

  /** Toasts take resolved strings (not keys), so localize here with an English
   *  fallback before emitting on the shared bus. */
  #toast(type: 'success' | 'error', titleKey: string, messageKey: string): void {
    EffectBus.emit('toast:show', {
      type,
      title: t(titleKey, TOAST_FALLBACK[titleKey] ?? ''),
      message: t(messageKey, TOAST_FALLBACK[messageKey] ?? ''),
    })
  }

  /** Explain why a machine-authored question is asking for attention. New
   *  producers carry explicit provenance; legacy records still get an honest
   *  state-based explanation instead of appearing as unexplained noise.
   *
   *  THE KEY IS CHOSEN AT RUNTIME — four expansions, none of them spelled
   *  beside a `t()` call, all four carried in this surface's catalog. */
  #questionReason(payload: any, approval: boolean): string {
    const explicit = String(payload?.reason ?? payload?.why ?? '').trim().slice(0, 500)
    if (explicit) return explicit
    const origin = String(payload?.origin ?? payload?.source ?? '').trim().toLowerCase()
    const key = origin === 'feedback-loop'
      ? 'feedback.reason.feedback-loop'
      : origin === 'meaning-loop'
        ? 'feedback.reason.meaning-loop'
        : approval
          ? 'feedback.reason.approval'
          : 'feedback.reason.answer'
    return t(key, REASON_FALLBACK[key])
  }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md).
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host with no
// ShellSurfaceRegistry (diamond-core-processor mounts these tags directly in its
// own template) still needs the tag to be a real element rather than an inert
// unknown one — so the define cannot wait on the registry. Only the ADD does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, FeedbackViewerElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/FeedbackViewerElement',
    element: SURFACE_NAME,
    order: 200,
  })
})
