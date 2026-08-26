// docs-overlay.view.ts — the documentation browser, as a framework-free custom
// element (everything-is-a-beehavior Phase 2: Angular panels leave the shell
// and ship as signed modules).
//
// A straight port of shared/ui/docs-overlay: same surface name
// (hc-docs-overlay), same order band (290), same two effects in
// (`docs:open` / `docs:close`), same InputGate owner token
// (`docs-overlay`), same document index, same markdown renderer, same exits.
// The participant sees the same overlay, delivered as a module instead of
// compiled into the shell. It lands in `commands/` beside
// slash-behaviour.drone.ts — the drone whose `/docs` behaviour emits the
// payload that opens it.
//
// WHAT IT IS FOR. `/docs` (optionally `/docs glossary`) puts the project's
// markdown documentation IN the hive rather than throwing the participant out
// to a repository. The sidebar is the index, filterable; the content area is a
// single scroll context; the article is rendered by the small markdown parser
// at the bottom of this file, which is carried verbatim from the original.
//
// ── THE TAKEOVER, AND EXACTLY WHAT IT TOUCHES ────────────────────────────
// This is a full-viewport overlay, but it is NOT a body-class takeover, and
// the port must not quietly make it one. The original suppresses the hive in
// three ways and only three:
//
//   1. Z-INDEX. The backdrop sits at 100000 and the panel at 100001 — above
//      every piece of shell chrome (header 60000, controls bars 59999,
//      edit-actions 59995, #pixi-host 59989). Nothing is hidden; everything
//      is simply covered. There is no `viewer-open`/`viewer-active` body
//      class here, no `suppress-canvas-under` rule, no chrome fade. Adding
//      one would be a new behaviour, and a half-restored one is precisely the
//      "hive looks broken" failure this campaign keeps paying for.
//   2. THE INPUT GATE, owner-scoped to `docs-overlay` so it composes with
//      locks held by the editor and other overlays. While the browser is up,
//      pan / pinch / wheel-zoom / drag-select cannot bleed through to the
//      canvas under it.
//   3. `[data-consumes-wheel]` on the panel, so scrolling the sidebar or the
//      article is scrolling — not a zoom gesture aimed at the hive.
//
// So "restore everything on exit" here means exactly one thing: RELEASE THE
// LOCK. Every path does — the close button, the backdrop, a `docs:close`
// emit, and disconnect (which is what `ngOnDestroy` did, for the same reason:
// an overlay torn down while open would leave the hexes frozen forever).
// `#applyGate()` runs on every render and lock/unlock are idempotent per
// owner, so the gate can never drift out of step with visibility.
//
// ── ESCAPE DOES NOT CLOSE THIS PANEL, AND MUST NOT START ─────────────────
// Checked before writing a line: the Angular component has NO keyboard
// binding at all — no `@HostListener('document:keydown.escape')`, no raw
// `document.addEventListener('keydown', …)`. The modifier guard that
// `keydown.escape` would demand is therefore not applicable, and ADDING an
// Escape close would be the regression, not the fix (the youtube-viewer rule,
// read in the other direction). What Escape actually does today: the cascade
// falls through to priority 5, sees the gate is active, and force-clears ALL
// locks — so a press un-freezes the canvas UNDERNEATH the still-open browser.
// That is the original's behaviour, quirk and all; changing it belongs to
// whoever owns the cascade, not to a port.
//
// ── LIFECYCLE ────────────────────────────────────────────────────────────
// The Angular template wrapped BOTH the backdrop and the panel in
// `@if (visible())`, so neither node existed while the browser was closed. A
// registry-fed element is mounted ONCE at boot and stays, so the chrome is
// built once, kept DETACHED, and attached only while visible — `display:none`
// would still answer `querySelector` on an overlay sitting at z-index 100001,
// which is the worst possible thing for this surface to lie about. The two
// conditional header buttons (`@if (!sidebarOpen())` on the menu button,
// `@if (activePage())` on the index button) detach the same way.
//
// THE REPLAY IS NOT A GESTURE. `EffectBus.on` replays the last value at
// subscribe time, and `docs:open` is a COMMAND. Angular subscribed once at
// boot, before anything had ever emitted, so its replay was always empty. An
// element re-subscribes whenever the shell-surfaces host MOVES it (a DOM move
// fires disconnected+connected), which after one `/docs` would replay the open
// and put the documentation back over a participant who had closed it. The
// subscribe-time `docs:open` is dropped — reproducing Angular's boot exactly
// while refusing to re-open on a re-order. `docs:close` needs no such guard:
// its handler SETS state, so a replayed close of an already-closed browser is
// a no-op by construction (the idempotent-subscriber convention).
//
// Its strings ship WITH it (docs-overlay.i18n.ts, extracted from all 14 shell
// catalogs) and register under the 'app' namespace, so every key resolves
// exactly as before — the Phase 2 catalog split, another slice.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { DOCS_OVERLAY_TRANSLATIONS } from './docs-overlay.i18n.js'

const SURFACE_NAME = 'hc-docs-overlay'

// Owner token for the InputGate lock held while the docs browser is open.
// Owner-scoped so it composes with locks held by the editor / other overlays.
// Carried UNCHANGED from the Angular component: the token is the identity of
// the lock, and renaming it would strand a lock taken under the old spelling
// if both versions were ever loaded in one document during the transition.
const DOCS_OVERLAY_LOCK_OWNER = 'docs-overlay'

/** Structural type for the InputGate — the shared tile-input lock. Resolved
 *  at runtime via window.ioc; undefined until its bee registers. (The original
 *  resolved it this way because shared may never import from modules. This
 *  file IS a module and could import the class — but the lazy lookup is also
 *  what keeps the surface usable in a host where no InputGate exists at all,
 *  so the seam stays.) */
type InputGateLike = {
  lock(owner?: string): void
  unlock(owner?: string): void
}

interface DocEntry {
  title: string
  file: string
  category: string
}

// The index, carried across verbatim. Order IS the grouping: `#groups()` walks
// it once and starts a new category whenever the category string changes, so
// re-sorting this array would silently re-shape the sidebar.
const DOC_INDEX: DocEntry[] = [
  // Architecture & Core Design
  { category: 'Architecture & Core Design', title: 'Architecture Fundamentals', file: 'architecture-fundamentals.md' },
  { category: 'Architecture & Core Design', title: 'Core Processor Architecture', file: 'core-processor-architecture.md' },
  { category: 'Architecture & Core Design', title: 'Universal History Plan', file: 'universal-history-plan.md' },

  // Cryptographic & Content Addressing
  { category: 'Cryptographic & Content Addressing', title: 'Signature System', file: 'signature-system.md' },
  { category: 'Cryptographic & Content Addressing', title: 'Signature Algebra', file: 'signature-algebra.md' },
  { category: 'Cryptographic & Content Addressing', title: 'Signature Node Pattern', file: 'signature-node-pattern.md' },
  { category: 'Cryptographic & Content Addressing', title: 'Collapsed Compute', file: 'collapsed-compute.md' },
  { category: 'Cryptographic & Content Addressing', title: 'Deterministic Computation', file: 'deterministic-computation.md' },
  { category: 'Cryptographic & Content Addressing', title: 'Data Primitive', file: 'data-primitive.md' },
  { category: 'Cryptographic & Content Addressing', title: 'Revision Mode', file: 'revision-mode.md' },

  // Protocol & Wire Format
  { category: 'Protocol & Wire Format', title: 'Byte Protocol', file: 'byte-protocol.md' },
  { category: 'Protocol & Wire Format', title: 'Protocol Spec', file: 'protocol-spec.md' },
  { category: 'Protocol & Wire Format', title: 'Dependency Signing', file: 'dependency-signing.md' },

  // Concepts & Domain Model
  { category: 'Concepts & Domain Model', title: 'Glossary', file: 'glossary.md' },
  { category: 'Concepts & Domain Model', title: 'DNA', file: 'dna.md' },
  { category: 'Concepts & Domain Model', title: 'Trail Capsule', file: 'trail-capsule.md' },
  { category: 'Concepts & Domain Model', title: 'Layer Primitives', file: 'layer-primitives.md' },
  { category: 'Concepts & Domain Model', title: 'LLM Primitive', file: 'llm-primitive.md' },
  { category: 'Concepts & Domain Model', title: 'Emergence', file: 'emergence.md' },

  // UI & Rendering
  { category: 'UI & Rendering', title: 'Cell Rendering', file: 'cell-rendering.md' },
  { category: 'UI & Rendering', title: 'Tile Overlay Architecture', file: 'tile-overlay-architecture.md' },

  // Developer Guides
  { category: 'Developer Guides', title: 'Getting Started', file: 'getting-started.md' },
  { category: 'Developer Guides', title: 'Contributing', file: 'contributing.md' },
  { category: 'Developer Guides', title: 'Command Line Reference', file: 'command-line-reference.md' },
  { category: 'Developer Guides', title: 'Slash Behaviour Reference', file: 'slash-behaviour-reference.md' },
  { category: 'Developer Guides', title: 'Slash Command Authoring', file: 'slash-command-authoring.md' },
  { category: 'Developer Guides', title: 'Simple Naming Initiative', file: 'simple-naming-initiative.md' },

  // Infrastructure
  { category: 'Infrastructure', title: 'Dependency Resolution', file: 'dependency-resolution.md' },
  { category: 'Infrastructure', title: 'Infrastructure', file: 'infrastructure.md' },
  { category: 'Infrastructure', title: 'Decentralized Angular Hosting', file: 'decentralized-angular-hosting.md' },
  { category: 'Infrastructure', title: 'Meadowverse Pipeline', file: 'lets-discover-meadowverse-pipeline.md' },

  // Security & Governance
  { category: 'Security & Governance', title: 'Security', file: 'security.md' },
  { category: 'Security & Governance', title: 'Social Governance', file: 'social-governance.md' },
  { category: 'Security & Governance', title: 'Meetings and Quorum', file: 'meetings-and-quorum.md' },
  { category: 'Security & Governance', title: 'Code of Conduct', file: 'code-of-conduct.md' },

  // Legal & Licensing
  { category: 'Legal & Licensing', title: 'Licensing', file: 'licensing.md' },
  { category: 'Legal & Licensing', title: 'Contributor Agreement', file: 'contributor-agreement.md' },
  { category: 'Legal & Licensing', title: 'Trademarks', file: 'trademarks.md' },

  // Bee Story
  { category: 'Bee Story', title: 'The Bee', file: 'bee-story/the-bee.md' },
  { category: 'Bee Story', title: 'The Colony', file: 'bee-story/the-colony.md' },
  { category: 'Bee Story', title: 'The Dance', file: 'bee-story/the-dance.md' },
  { category: 'Bee Story', title: 'The Economy', file: 'bee-story/the-economy.md' },
  { category: 'Bee Story', title: 'The Hive', file: 'bee-story/the-hive.md' },
  { category: 'Bee Story', title: 'The Memory', file: 'bee-story/the-memory.md' },
  { category: 'Bee Story', title: 'The Scent', file: 'bee-story/the-scent.md' },
  { category: 'Bee Story', title: 'The Seal', file: 'bee-story/the-seal.md' },
  { category: 'Bee Story', title: 'The Swarm', file: 'bee-story/the-swarm.md' },
]

// Same contract as the shell pipe. None of this surface's nine keys takes
// parameters (they are whole labels), so there is no interpolation to do —
// the fallback is the English catalog text, and a bare host with no i18n
// reads identically.
const t = (key: string, fallback: string): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key)
  if (value && value !== key) return value
  return fallback
}

// The browser's strings travel with it — registered as soon as the i18n
// service is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(DOCS_OVERLAY_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay + landing-badge + youtube-viewer
// precedent), so Angular's `:host` becomes the tag name and every other
// selector is prefixed with it — nothing can leak out of the browser.
// `display:contents` is kept from the original: both children are
// position:fixed, so the host is a pure bookkeeping node and must never
// introduce a box of its own.
//
// Three deliberate departures from a mechanical translation, all narrow:
//   - `-webkit-backdrop-filter` is written by hand. Angular's build
//     autoprefixed the backdrop blur; a module bundle does not.
//   - the two @keyframes are RENAMED (`docs-fade-in` → `hc-docs-overlay-
//     fade-in`). A document-level sheet shares one global animation
//     namespace, and `docs-*` is exactly the kind of name a second surface
//     would pick.
//   - `::ng-deep .doc-error` compiled to an UNSCOPED global rule. Here it is
//     scoped to the tag (`hc-docs-overlay .doc-error`), which covers its only
//     real use — the error paragraph this file injects into the article — and
//     stops the browser from styling `.doc-error` anywhere else in the shell.
// Everything else (colours, the 12px inset, the 280/220px sidebar ladder, the
// thin scrollbars, both media queries) is the same declaration in the same
// order. `var(--hc-radius-*)` is left exactly as written.
const CSS = `
${SURFACE_NAME}{display:contents}
${SURFACE_NAME} .docs-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.72);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:100000;animation:hc-docs-overlay-fade-in 200ms ease forwards}
${SURFACE_NAME} .docs-overlay{position:fixed;inset:12px;z-index:100001;display:flex;background:rgba(14,18,24,.96);border:1px solid rgba(255,255,255,.08);border-radius:var(--hc-radius-floating);box-shadow:0 16px 64px rgba(0,0,0,.7);overflow:hidden;animation:hc-docs-overlay-scale-in 250ms cubic-bezier(.16,1,.3,1) forwards}
${SURFACE_NAME} .docs-sidebar{width:280px;min-width:280px;display:flex;flex-direction:column;background:rgba(10,13,18,.9);border-right:1px solid rgba(255,255,255,.06);overflow:hidden;transition:width 200ms ease,min-width 200ms ease,opacity 200ms ease}
${SURFACE_NAME} .docs-sidebar:not(.open){width:0;min-width:0;opacity:0;border-right:none}
${SURFACE_NAME} .sidebar-header{display:flex;align-items:center;justify-content:space-between;padding:16px 16px 12px;border-bottom:1px solid rgba(255,255,255,.06);flex-shrink:0}
${SURFACE_NAME} .sidebar-header h2{margin:0;font-size:14px;font-weight:600;letter-spacing:.3px;color:rgba(245,245,245,.9)}
${SURFACE_NAME} .sidebar-toggle{background:none;border:none;color:rgba(245,245,245,.4);font-size:18px;cursor:pointer;padding:4px 8px;border-radius:4px;transition:background 100ms ease,color 100ms ease}
${SURFACE_NAME} .sidebar-toggle:hover{background:rgba(255,255,255,.06);color:rgba(245,245,245,.8)}
${SURFACE_NAME} .sidebar-filter{padding:8px 12px;flex-shrink:0}
${SURFACE_NAME} .sidebar-filter input{width:100%;padding:6px 10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:var(--hc-radius-control);color:rgba(245,245,245,.85);font-size:12px;font-family:inherit;outline:none;transition:border-color 150ms ease;box-sizing:border-box}
${SURFACE_NAME} .sidebar-filter input::placeholder{color:rgba(245,245,245,.3)}
${SURFACE_NAME} .sidebar-filter input:focus{border-color:rgba(200,151,90,.4)}
${SURFACE_NAME} .sidebar-nav{flex:1;overflow-y:auto;overflow-x:hidden;padding:4px 0 16px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.08) transparent}
${SURFACE_NAME} .sidebar-nav::-webkit-scrollbar{width:3px}
${SURFACE_NAME} .sidebar-nav::-webkit-scrollbar-track{background:transparent}
${SURFACE_NAME} .sidebar-nav::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:2px}
${SURFACE_NAME} .nav-group{padding:2px 0}
${SURFACE_NAME} .nav-category{margin:0;padding:8px 16px 4px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.8px;color:rgba(200,151,90,.6)}
${SURFACE_NAME} .nav-item{display:block;width:100%;padding:5px 16px 5px 20px;background:none;border:none;text-align:left;font-size:12px;font-family:inherit;color:rgba(245,245,245,.7);cursor:pointer;transition:background 80ms ease,color 80ms ease;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${SURFACE_NAME} .nav-item:hover{background:rgba(255,255,255,.04);color:rgba(245,245,245,.95)}
${SURFACE_NAME} .nav-item.active{background:rgba(200,151,90,.1);color:rgba(200,151,90,.95)}
${SURFACE_NAME} .docs-content{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}
${SURFACE_NAME} .content-header{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid rgba(255,255,255,.06);flex-shrink:0}
${SURFACE_NAME} .menu-btn{background:none;border:none;padding:4px 8px;cursor:pointer;display:flex;align-items:center}
${SURFACE_NAME} .menu-icon{display:block;width:16px;height:2px;background:rgba(245,245,245,.5);position:relative}
${SURFACE_NAME} .menu-icon::before,${SURFACE_NAME} .menu-icon::after{content:'';position:absolute;left:0;width:100%;height:2px;background:rgba(245,245,245,.5)}
${SURFACE_NAME} .menu-icon::before{top:-5px}
${SURFACE_NAME} .menu-icon::after{top:5px}
${SURFACE_NAME} .back-btn{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:4px;color:rgba(245,245,245,.7);font-size:11px;font-family:inherit;padding:3px 10px;cursor:pointer;transition:background 100ms ease}
${SURFACE_NAME} .back-btn:hover{background:rgba(255,255,255,.08)}
${SURFACE_NAME} .close-btn{margin-left:auto;background:none;border:none;color:rgba(245,245,245,.4);font-size:20px;cursor:pointer;padding:2px 8px;border-radius:4px;transition:background 100ms ease,color 100ms ease}
${SURFACE_NAME} .close-btn:hover{background:rgba(255,255,255,.06);color:rgba(245,245,245,.8)}
${SURFACE_NAME} .docs-article{flex:1;overflow-y:auto;overflow-x:hidden;padding:24px 32px 48px;color:rgba(245,245,245,.85);font-size:14px;line-height:1.7;-webkit-overflow-scrolling:touch;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.1) transparent}
${SURFACE_NAME} .docs-article::-webkit-scrollbar{width:4px}
${SURFACE_NAME} .docs-article::-webkit-scrollbar-track{background:transparent}
${SURFACE_NAME} .docs-article::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:2px}
${SURFACE_NAME} .docs-article h1{font-size:24px;font-weight:700;margin:0 0 16px;color:rgba(245,245,245,.95)}
${SURFACE_NAME} .docs-article h2{font-size:20px;font-weight:600;margin:32px 0 12px;color:rgba(245,245,245,.92);border-bottom:1px solid rgba(255,255,255,.06);padding-bottom:8px}
${SURFACE_NAME} .docs-article h3{font-size:16px;font-weight:600;margin:24px 0 8px;color:rgba(200,151,90,.9)}
${SURFACE_NAME} .docs-article h4{font-size:14px;font-weight:600;margin:20px 0 6px;color:rgba(200,151,90,.7)}
${SURFACE_NAME} .docs-article h5,${SURFACE_NAME} .docs-article h6{font-size:13px;font-weight:600;margin:16px 0 4px;color:rgba(245,245,245,.7)}
${SURFACE_NAME} .docs-article p{margin:0 0 12px}
${SURFACE_NAME} .docs-article a{color:rgb(235,195,135);text-decoration:underline;text-decoration-color:rgba(235,195,135,.4);text-underline-offset:2px;transition:color 100ms ease,text-decoration-color 100ms ease}
${SURFACE_NAME} .docs-article a:hover{color:rgb(245,215,165);text-decoration-color:rgba(245,215,165,.9)}
${SURFACE_NAME} .docs-article strong{color:rgba(245,245,245,.95)}
${SURFACE_NAME} .docs-article code{padding:2px 6px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:4px;font-size:12px;font-family:'SF Mono','Fira Code','Cascadia Code',monospace;color:rgba(200,151,90,.85)}
${SURFACE_NAME} .docs-article pre{margin:12px 0 16px;padding:16px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.06);border-radius:var(--hc-radius-card);overflow-x:auto;-webkit-overflow-scrolling:touch}
${SURFACE_NAME} .docs-article pre::-webkit-scrollbar{height:3px}
${SURFACE_NAME} .docs-article pre::-webkit-scrollbar-track{background:transparent}
${SURFACE_NAME} .docs-article pre::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:2px}
${SURFACE_NAME} .docs-article pre code{padding:0;background:none;border:none;border-radius:0;font-size:12px;color:rgba(245,245,245,.8);white-space:pre;display:block}
${SURFACE_NAME} .docs-article blockquote{margin:12px 0;padding:8px 16px;border-left:3px solid rgba(200,151,90,.4);background:rgba(200,151,90,.04);color:rgba(245,245,245,.7);font-style:italic}
${SURFACE_NAME} .docs-article ul,${SURFACE_NAME} .docs-article ol{margin:8px 0 12px;padding-left:24px}
${SURFACE_NAME} .docs-article li{margin:4px 0}
${SURFACE_NAME} .docs-article hr{border:none;border-top:1px solid rgba(255,255,255,.06);margin:24px 0}
${SURFACE_NAME} .docs-article table{width:100%;border-collapse:collapse;margin:12px 0 16px;font-size:13px}
${SURFACE_NAME} .docs-article th{text-align:left;padding:8px 12px;background:rgba(255,255,255,.04);border-bottom:1px solid rgba(255,255,255,.1);color:rgba(245,245,245,.9);font-weight:600;font-size:12px;white-space:nowrap}
${SURFACE_NAME} .docs-article td{padding:6px 12px;border-bottom:1px solid rgba(255,255,255,.04);color:rgba(245,245,245,.75);vertical-align:top}
${SURFACE_NAME} .docs-article tr:hover td{background:rgba(255,255,255,.02)}
${SURFACE_NAME} .docs-article del{color:rgba(245,245,245,.4)}
${SURFACE_NAME} .docs-loading{flex:1;display:flex;align-items:center;justify-content:center;color:rgba(245,245,245,.4);font-size:13px}
${SURFACE_NAME} .docs-welcome{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px;text-align:center;color:rgba(245,245,245,.5)}
${SURFACE_NAME} .docs-welcome h1{font-size:20px;font-weight:600;color:rgba(245,245,245,.8);margin:0 0 12px}
${SURFACE_NAME} .docs-welcome p{font-size:13px;margin:0}
${SURFACE_NAME} .docs-welcome code{padding:2px 6px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:4px;font-size:12px;font-family:'SF Mono','Fira Code','Cascadia Code',monospace;color:rgba(200,151,90,.85)}
${SURFACE_NAME} .doc-error{color:rgba(255,100,100,.8);text-align:center;padding:32px}
@keyframes hc-docs-overlay-fade-in{from{opacity:0}to{opacity:1}}
@keyframes hc-docs-overlay-scale-in{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}
@media (max-width:600px){
${SURFACE_NAME} .docs-overlay{inset:0;border-radius:0;flex-direction:column}
${SURFACE_NAME} .docs-sidebar{position:absolute;inset:0;width:100%;min-width:100%;z-index:2;background:rgba(10,13,18,.98);border-right:none;transition:transform 200ms ease,opacity 200ms ease}
${SURFACE_NAME} .docs-sidebar:not(.open){width:100%;min-width:100%;opacity:0;transform:translateX(-100%);pointer-events:none}
${SURFACE_NAME} .docs-content{flex:1}
${SURFACE_NAME} .docs-article{padding:16px 16px 40px}
${SURFACE_NAME} .content-header{padding:8px 12px}
${SURFACE_NAME} .docs-article table{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}
${SURFACE_NAME} .docs-article table::-webkit-scrollbar{height:3px}
${SURFACE_NAME} .docs-article table::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:2px}
}
@media (min-width:601px) and (max-width:900px){
${SURFACE_NAME} .docs-sidebar{width:220px;min-width:220px}
}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-docs-overlay', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

/** The chrome, built once. Held as ONE object so `#render` can prove all of it
 *  exists with a single guard instead of eighteen non-null assertions. */
type Chrome = {
  backdrop: HTMLDivElement
  overlay: HTMLDivElement
  sidebar: HTMLElement
  title: HTMLHeadingElement
  sidebarToggle: HTMLButtonElement
  filterInput: HTMLInputElement
  nav: HTMLElement
  content: HTMLElement
  header: HTMLDivElement
  menuButton: HTMLButtonElement
  backButton: HTMLButtonElement
  closeButton: HTMLButtonElement
  loadingNode: HTMLDivElement
  welcomeNode: HTMLDivElement
  welcomeTitle: HTMLHeadingElement
  welcomeText: HTMLParagraphElement
  articleNode: HTMLElement
}

export class DocsOverlayElement extends HTMLElement {

  /** Everything connectedCallback wired, torn down in one sweep. */
  #offs: Array<() => void> = []

  // ── state (the six signals, as plain fields) ──────────────────────────
  #visible = false
  #sidebarOpen = true
  #activePage: string | null = null
  #renderedHtml = ''
  #loading = false
  #filterText = ''

  /** True only for the synchronous window inside `EffectBus.on` — see the
   *  replay note in the file header. */
  #subscribing = false

  #chrome: Chrome | null = null

  /** The nav buttons by file, so a page change can toggle ONE class instead
   *  of rebuilding the list under the participant's finger (which would drop
   *  focus from the button they just pressed, and drop the sidebar's scroll
   *  position). This is a lookup index, not a reconciler: it is rebuilt whole
   *  whenever the filter changes and never diffed. */
  #navItems = new Map<string, HTMLButtonElement>()
  /** The lowercased filter the nav was last built for — the ONLY input that
   *  changes which buttons exist. `null` means "never built". */
  #navBuiltFor: string | null = null

  /** Which of the three body branches is currently attached, and the html the
   *  article node is currently showing. */
  #bodyNode: HTMLElement | null = null
  #articleHtml: string | null = null

  connectedCallback(): void {
    installCss()
    this.#build()

    // The command. Its subscribe-time replay is dropped (header note): a
    // re-order of the shell surfaces must never re-open documentation the
    // participant closed.
    this.#subscribing = true
    const offOpen = EffectBus.on<{ page?: string }>('docs:open', (payload) => {
      if (this.#subscribing) return
      this.#onOpen(payload)
    })
    // The state assertion. No replay guard: the handler SETS visibility, so a
    // replayed close of an already-closed browser changes nothing — the
    // idempotent-subscriber convention, not an oversight.
    //
    // NOTE the shape difference, kept from the original: `docs:close` hides
    // ONLY. It does not clear the active page or the rendered article the way
    // the close BUTTON does, so re-opening lands back on the page you were
    // reading. Two exits, two deliberately different shapes.
    const offClose = EffectBus.on('docs:close', () => this.#hide())

    this.#subscribing = false

    this.#offs.push(
      offOpen,
      offClose,
      // THE PIPE WAS IMPURE. The Angular template resolved all nine strings
      // through the `t` pipe, declared `pure: false`, so every change-detection
      // tick re-read them and `/language ja` re-labelled an OPEN browser on the
      // spot — the sidebar heading, the filter placeholder, both aria-labels on
      // the toggles, the index button, the loading line and the whole welcome
      // panel. An element renders when it decides to, so the locale switch has
      // to be a reason to re-resolve, or an open browser freezes in the previous
      // language until it is closed and re-opened.
      EffectBus.on('locale:changed', () => this.#render()),
    )

    // Deliberately NO keyboard listener: the Angular component had none (see
    // the header). Escape reaches the cascade, not this surface.

    this.#render()
  }

  disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    // `ngOnDestroy` released the lock explicitly, and for the reason it gave:
    // the visibility effect will not run a final unlock once destroyed, so an
    // overlay torn down while open would leave the hexes locked with nothing
    // left to unlock them.
    this.#gate()?.unlock(DOCS_OVERLAY_LOCK_OWNER)

    // A MOVE IS NOT A TEARDOWN. `insertBefore` on an attached node fires
    // disconnected then connected, and the shell-surfaces host reorders its
    // survivors exactly that way. The chrome is deliberately NOT dropped here:
    // the Angular component was a view, not a node — a reorder never destroyed
    // it — so keeping the built DOM means a re-order re-attaches the SAME
    // article, with its scroll position and the participant's filter text
    // intact. `#render()` on the way back in re-takes the lock (idempotent per
    // owner), and a genuine removal takes the element and its children with it.
  }

  // ── the InputGate ─────────────────────────────────────────────────────
  /** Resolved at runtime; undefined until its bee registers. */
  #gate(): InputGateLike | undefined {
    return window.ioc?.get?.('@diamondcoreprocessor.com/InputGate') as InputGateLike | undefined
  }

  /** The Angular `effect()`, spelled out: freeze tile navigation while the
   *  browser is open. It ran on every change of `visible()` and re-resolved
   *  the gate each time (the gate's bee may register later than this surface).
   *  Here it runs on EVERY render — `lock`/`unlock` are idempotent per owner,
   *  so running it more often is free and the lock can never drift out of
   *  step with what is on screen. */
  #applyGate(): void {
    const gate = this.#gate()
    if (!gate) return
    if (this.#visible) gate.lock(DOCS_OVERLAY_LOCK_OWNER)
    else gate.unlock(DOCS_OVERLAY_LOCK_OWNER)
  }

  // ── chrome (built once, detached) ─────────────────────────────────────
  #build(): void {
    if (this.#chrome) return

    // Clicking the backdrop closes — the template's `(click)="close()"`.
    const backdrop = document.createElement('div')
    backdrop.className = 'docs-backdrop'
    backdrop.addEventListener('click', () => this.#close())

    const overlay = document.createElement('div')
    overlay.className = 'docs-overlay'
    // LOAD-BEARING: without it a wheel over the sidebar or the article is read
    // as a zoom gesture aimed at the hive underneath (mousewheel-zoom.input.ts
    // walks `.closest('[data-consumes-wheel]')`).
    overlay.setAttribute('data-consumes-wheel', '')

    // ── sidebar ──
    const sidebar = document.createElement('aside')
    sidebar.className = 'docs-sidebar'

    const sidebarHeader = document.createElement('div')
    sidebarHeader.className = 'sidebar-header'
    const title = document.createElement('h2')
    const sidebarToggle = document.createElement('button')
    sidebarToggle.className = 'sidebar-toggle'
    sidebarToggle.textContent = '×'
    sidebarToggle.addEventListener('click', () => this.#toggleSidebar())
    sidebarHeader.append(title, sidebarToggle)

    const filterWrap = document.createElement('div')
    filterWrap.className = 'sidebar-filter'
    const filterInput = document.createElement('input')
    filterInput.type = 'text'
    filterInput.autocomplete = 'off'
    filterInput.spellcheck = false
    filterInput.addEventListener('input', () => this.#onFilter(filterInput))
    filterWrap.appendChild(filterInput)

    const nav = document.createElement('nav')
    nav.className = 'sidebar-nav'

    sidebar.append(sidebarHeader, filterWrap, nav)

    // ── content ──
    const content = document.createElement('main')
    content.className = 'docs-content'

    const header = document.createElement('div')
    header.className = 'content-header'

    // Both of these are `@if`-gated in the template, so they are built here
    // and attached/detached by `#renderHeader` — never merely hidden.
    const menuButton = document.createElement('button')
    menuButton.className = 'menu-btn'
    menuButton.addEventListener('click', () => this.#toggleSidebar())
    const menuIcon = document.createElement('span')
    menuIcon.className = 'menu-icon'
    menuButton.appendChild(menuIcon)

    const backButton = document.createElement('button')
    backButton.className = 'back-btn'
    backButton.addEventListener('click', () => this.#backToIndex())

    const closeButton = document.createElement('button')
    closeButton.className = 'close-btn'
    closeButton.textContent = '×'
    closeButton.addEventListener('click', () => this.#close())

    header.appendChild(closeButton)
    content.appendChild(header)

    // The three body branches, built once and swapped. Keeping the article
    // node alive is what lets a sidebar toggle (or a locale switch) re-render
    // without throwing away where the participant had scrolled to; a NEW
    // document still starts at the top, because `#renderBody` resets
    // scrollTop exactly when Angular would have created a fresh node.
    const loadingNode = document.createElement('div')
    loadingNode.className = 'docs-loading'

    const welcomeNode = document.createElement('div')
    welcomeNode.className = 'docs-welcome'
    const welcomeTitle = document.createElement('h1')
    const welcomeText = document.createElement('p')
    welcomeNode.append(welcomeTitle, welcomeText)

    const articleNode = document.createElement('article')
    articleNode.className = 'docs-article'

    overlay.append(sidebar, content)

    this.#chrome = {
      backdrop, overlay, sidebar, title, sidebarToggle, filterInput, nav,
      content, header, menuButton, backButton, closeButton,
      loadingNode, welcomeNode, welcomeTitle, welcomeText, articleNode,
    }
  }

  // ── the effects in ────────────────────────────────────────────────────
  #onOpen(payload: { page?: string } | undefined): void {
    this.#visible = true
    // POLARITY KEPT: the original tested `if (payload?.page)`, so an EMPTY
    // page (`/docs` with no argument emits `page: ''`) opens the browser on
    // the welcome panel and loads nothing. A negated "if there is no match,
    // …" would have to decide what an empty string means; this does not.
    const page = payload?.page
    if (page) {
      const match = DOC_INDEX.find(entry =>
        entry.file === page ||
        entry.file === page + '.md' ||
        entry.title.toLowerCase() === page.toLowerCase()
      )
      // An unrecognised page name opens the browser and selects nothing —
      // the participant lands on the index rather than on an error.
      if (match) void this.#loadPage(match.file)
    }
    this.#render()
  }

  // ── the exits ─────────────────────────────────────────────────────────
  /** `docs:close` — hide, and hide only. */
  #hide(): void {
    this.#visible = false
    this.#render()
  }

  /** The close button and the backdrop — hide AND forget the page, so the
   *  next `/docs` opens on the index. (The original's `close()`.) */
  #close(): void {
    this.#visible = false
    this.#activePage = null
    this.#renderedHtml = ''
    this.#render()
  }

  #toggleSidebar(): void {
    this.#sidebarOpen = !this.#sidebarOpen
    this.#render()
  }

  #onFilter(input: HTMLInputElement): void {
    this.#filterText = input.value
    this.#render()
  }

  #backToIndex(): void {
    this.#activePage = null
    this.#renderedHtml = ''
    this.#sidebarOpen = true
    this.#render()
  }

  /** Fetch and render one document. Kept as-is, including the race the
   *  original has: two fast clicks start two fetches and the LATER-resolving
   *  one wins the article, whichever was asked for first. `activePage` is set
   *  synchronously so the sidebar highlight always tracks the last click.
   *  The failure text is an English literal in the original — no catalog in
   *  any of the 14 locales carries it, and minting a key here would ship a
   *  translation the shell never had. */
  async #loadPage(file: string): Promise<void> {
    this.#activePage = file
    this.#loading = true

    // on mobile, auto-close sidebar when a doc is selected
    if (window.innerWidth <= 600) {
      this.#sidebarOpen = false
    }
    this.#render()

    try {
      const response = await fetch(`/documentation/${file}`)
      if (!response.ok) {
        this.#renderedHtml = `<p class="doc-error">Failed to load: ${file}</p>`
        return
      }
      const markdown = await response.text()
      this.#renderedHtml = renderMarkdown(markdown)
    } catch {
      this.#renderedHtml = `<p class="doc-error">Failed to load: ${file}</p>`
    } finally {
      this.#loading = false
      this.#render()
    }
  }

  // ── rendering (rebuild on change — the house pattern, no reconciler) ──
  #render(): void {
    this.#applyGate()

    const chrome = this.#chrome
    if (!chrome) return

    // `@if (visible())` wrapped BOTH nodes. Detach, do not hide: an overlay at
    // z-index 100001 that merely claims to be invisible still answers
    // querySelector and still covers the hive if one rule ever loses.
    if (!this.#visible) {
      chrome.backdrop.remove()
      chrome.overlay.remove()
      return
    }

    this.#relabel()

    // The template's `[value]="filterText()"`. Written only when it differs,
    // so typing never rewrites the field under the caret.
    if (chrome.filterInput.value !== this.#filterText) {
      chrome.filterInput.value = this.#filterText
    }

    // `[class.sidebar-collapsed]` is carried even though no rule reads it —
    // it is a DOM contract, and a driver may assert on it.
    chrome.overlay.classList.toggle('sidebar-collapsed', !this.#sidebarOpen)
    chrome.sidebar.classList.toggle('open', this.#sidebarOpen)

    this.#renderNav(chrome)
    this.#renderHeader(chrome)
    this.#renderBody(chrome)

    // Back in, if it was out. Moving live nodes, never re-creating them —
    // backdrop first, panel second, exactly the template's order.
    if (chrome.backdrop.parentNode !== this) {
      this.append(chrome.backdrop, chrome.overlay)
    }
  }

  /** Re-resolve every string from the catalog. Called on every render, which
   *  includes `locale:changed` — the impure-pipe rule. */
  #relabel(): void {
    const chrome = this.#chrome
    if (!chrome) return
    chrome.title.textContent = t('docs.title', 'Documentation')
    chrome.sidebarToggle.setAttribute('aria-label', t('docs.close-sidebar', 'close sidebar'))
    chrome.filterInput.placeholder = t('docs.filter-placeholder', 'filter docs...')
    chrome.menuButton.setAttribute('aria-label', t('docs.open-sidebar', 'open sidebar'))
    chrome.backButton.textContent = t('docs.index', 'Index')
    chrome.closeButton.setAttribute('aria-label', t('docs.close', 'close documentation'))
    chrome.loadingNode.textContent = t('docs.loading', 'Loading...')
    chrome.welcomeTitle.textContent = t('docs.main-title', 'Hypercomb Documentation')
    chrome.welcomeText.textContent = t('docs.welcome-text',
      'Select a document from the sidebar or use /docs glossary to jump directly to a page.')
  }

  /** The `categories()` computed, unchanged: one walk of the index, a new
   *  group whenever the category string changes, entries dropped when neither
   *  their title nor their category contains the filter. */
  #groups(filter: string): { category: string; entries: DocEntry[] }[] {
    const groups: { category: string; entries: DocEntry[] }[] = []
    let current: { category: string; entries: DocEntry[] } | null = null
    for (const entry of DOC_INDEX) {
      if (filter && !entry.title.toLowerCase().includes(filter) && !entry.category.toLowerCase().includes(filter)) continue
      if (!current || current.category !== entry.category) {
        current = { category: entry.category, entries: [] }
        groups.push(current)
      }
      current.entries.push(entry)
    }
    return groups
  }

  #renderNav(chrome: Chrome): void {
    const filter = this.#filterText.toLowerCase()

    // The filter is the only thing that changes WHICH buttons exist. Rebuild
    // the list when it moves; otherwise leave the DOM alone and just move the
    // highlight — a page click must not destroy the button that was clicked.
    if (this.#navBuiltFor !== filter) {
      this.#navBuiltFor = filter
      this.#navItems.clear()
      const groups: HTMLElement[] = []
      for (const group of this.#groups(filter)) {
        const wrap = document.createElement('div')
        wrap.className = 'nav-group'
        const category = document.createElement('h3')
        category.className = 'nav-category'
        category.textContent = group.category
        wrap.appendChild(category)
        for (const doc of group.entries) {
          const button = document.createElement('button')
          button.className = 'nav-item'
          button.textContent = doc.title
          button.addEventListener('click', () => { void this.#loadPage(doc.file) })
          this.#navItems.set(doc.file, button)
          wrap.appendChild(button)
        }
        groups.push(wrap)
      }
      chrome.nav.replaceChildren(...groups)
    }

    // `[class.active]="activePage() === doc.file"` — a class flip on nodes
    // that already exist. Mutating an existing node is not a reconciler.
    for (const [file, button] of this.#navItems) {
      button.classList.toggle('active', this.#activePage === file)
    }
  }

  /** The two `@if`-gated header buttons. Order is menu, index, close — the
   *  close button is always present and always last (`margin-left:auto`). */
  #renderHeader(chrome: Chrome): void {
    if (!this.#sidebarOpen) {
      if (chrome.menuButton.parentNode !== chrome.header) {
        chrome.header.insertBefore(chrome.menuButton, chrome.header.firstChild)
      }
    } else {
      chrome.menuButton.remove()
    }

    if (this.#activePage) {
      if (chrome.backButton.parentNode !== chrome.header) {
        chrome.header.insertBefore(chrome.backButton, chrome.closeButton)
      }
    } else {
      chrome.backButton.remove()
    }
  }

  /** `@if (loading()) … @else if (renderedHtml()) … @else …`. POLARITY KEPT:
   *  loading wins, then a NON-EMPTY article, then the welcome panel — the
   *  empty string is what selects the welcome, so it is tested as truthiness
   *  and not negated into a length check. */
  #renderBody(chrome: Chrome): void {
    const next = this.#loading
      ? chrome.loadingNode
      : (this.#renderedHtml ? chrome.articleNode : chrome.welcomeNode)

    const branchChanged = this.#bodyNode !== next
    if (branchChanged) {
      this.#bodyNode?.remove()
      this.#bodyNode = next
    }

    if (next === chrome.articleNode) {
      if (this.#articleHtml !== this.#renderedHtml) {
        this.#articleHtml = this.#renderedHtml
        // The template's `[innerHTML]`. The markdown comes from the app's own
        // same-origin /documentation/ tree and is rendered by the parser
        // below, exactly as before.
        chrome.articleNode.innerHTML = this.#renderedHtml
      }
      // Angular destroyed and re-created the article every time the branch was
      // entered, which is what put a freshly-opened document at the top.
      // Reproduce that on branch entry (and on new content), and only there —
      // so toggling the sidebar or switching locale mid-read does NOT throw
      // away where the participant had scrolled to.
      if (branchChanged) chrome.articleNode.scrollTop = 0
    }

    if (next.parentNode !== chrome.content) chrome.content.appendChild(next)
  }
}

// ── lightweight markdown → HTML ──────────────────────────
// Carried across verbatim from the Angular component — same parser, same
// output, same quirks (line-per-paragraph, `id` slugs on headings, the
// separator row skipped inside tables).

function renderMarkdown(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let inCodeBlock = false
  let codeLang = ''
  let codeLines: string[] = []
  let inList = false
  let listType: 'ul' | 'ol' = 'ul'
  let inTable = false
  let tableRows: string[] = []

  const flush = () => {
    if (inList) { out.push(`</${listType}>`); inList = false }
    if (inTable) { out.push('</tbody></table>'); inTable = false; tableRows = [] }
  }

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const inline = (s: string): string => {
    // code spans first (protect from further processing)
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
    // bold + italic
    s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    // bold
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // italic
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>')
    // strikethrough
    s = s.replace(/~~(.+?)~~/g, '<del>$1</del>')
    // links
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    return s
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // fenced code blocks
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        flush()
        inCodeBlock = true
        codeLang = line.slice(3).trim()
        codeLines = []
      } else {
        const langAttr = codeLang ? ` class="language-${esc(codeLang)}"` : ''
        out.push(`<pre><code${langAttr}>${codeLines.map(esc).join('\n')}</code></pre>`)
        inCodeBlock = false
        codeLang = ''
      }
      continue
    }

    if (inCodeBlock) {
      codeLines.push(line)
      continue
    }

    // blank line
    if (line.trim() === '') {
      flush()
      continue
    }

    // horizontal rule
    if (/^(---|\*\*\*|___)$/.test(line.trim())) {
      flush()
      out.push('<hr>')
      continue
    }

    // headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      flush()
      const level = headingMatch[1].length
      const id = headingMatch[2].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      out.push(`<h${level} id="${id}">${inline(headingMatch[2])}</h${level}>`)
      continue
    }

    // table rows
    if (line.includes('|') && line.trim().startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim())

      // separator row (|---|---|)
      if (cells.every(c => /^:?-+:?$/.test(c))) continue

      if (!inTable) {
        flush()
        inTable = true
        tableRows = []
        out.push('<table><thead><tr>')
        for (const cell of cells) {
          out.push(`<th>${inline(cell)}</th>`)
        }
        out.push('</tr></thead><tbody>')
      } else {
        out.push('<tr>')
        for (const cell of cells) {
          out.push(`<td>${inline(cell)}</td>`)
        }
        out.push('</tr>')
      }
      continue
    }

    // unordered list
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/)
    if (ulMatch) {
      if (inTable) { out.push('</tbody></table>'); inTable = false }
      if (!inList) { inList = true; listType = 'ul'; out.push('<ul>') }
      out.push(`<li>${inline(ulMatch[2])}</li>`)
      continue
    }

    // ordered list
    const olMatch = line.match(/^(\s*)\d+[.)]\s+(.+)$/)
    if (olMatch) {
      if (inTable) { out.push('</tbody></table>'); inTable = false }
      if (!inList || listType !== 'ol') {
        if (inList) out.push(`</${listType}>`)
        inList = true; listType = 'ol'; out.push('<ol>')
      }
      out.push(`<li>${inline(olMatch[2])}</li>`)
      continue
    }

    // blockquote
    if (line.startsWith('>')) {
      flush()
      out.push(`<blockquote>${inline(line.slice(1).trim())}</blockquote>`)
      continue
    }

    // paragraph
    flush()
    out.push(`<p>${inline(line)}</p>`)
  }

  flush()
  if (inCodeBlock) {
    out.push(`<pre><code>${codeLines.map(esc).join('\n')}</code></pre>`)
  }

  return out.join('\n')
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md).
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host
// with no ShellSurfaceRegistry (diamond-core-processor mounts tags directly
// in its own template) still needs the tag to be a real element rather than
// an inert unknown one — so the define cannot wait on the registry. Only the
// ADD does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, DocsOverlayElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/DocsOverlayElement',
    element: SURFACE_NAME,
    order: 290,
  })
})
