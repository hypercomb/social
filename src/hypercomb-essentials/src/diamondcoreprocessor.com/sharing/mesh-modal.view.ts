// mesh-modal.view.ts — WHERE THE SWARM ZONE IS SET, as a framework-free
// custom element (everything-is-a-beehavior Phase 2: Angular panels leave the
// shell and arrive as signed modules).
//
// A straight port of shared/ui/mesh-modal: same surface name (hc-mesh-modal),
// same order band (260), same effects in (`mesh:open-modal`,
// `mesh:close-modal`, `keymap:invoke`, `mesh:saved-locations-changed`) and the
// same effects out (`mesh:modal-open`, `mesh:secret-draft`, `mesh:room`,
// `mesh:secret`, `mesh:host`, `mesh:join`, `mesh:privacy-step-back`,
// `features:roster-open`). The participant sees the same centred dialog —
// bottom sheet on a phone — delivered as a module instead of compiled into the
// shell.
//
// WHAT IT IS FOR. A swarm channel is (location, secret): the content broker
// composes the subscription signature from BOTH, so half a zone subscribes to
// nothing. This dialog is the one place those two are set, together, with the
// participant's display name and the host they are connected through beside
// them. It opens two ways:
//
//   • plain (`mesh:open-modal` with no `join`) — editing the zone you are in.
//     Clearing it is legitimate: that is how you go quiet.
//   • JOIN mode (`{ join: true }`, from the mesh-header's solo→public walk,
//     the controls-bar and the runtime initializer) — the primary button reads
//     "start" and confirming ALSO emits `mesh:join`, which is what flips solo
//     to swarm. Here a half-set zone is refused: `missingField` marks the
//     empty box and the dialog STAYS OPEN, because a join that could never
//     have worked used to close silently and leave a hive that looked joined
//     and saw nobody.
//
// THE SECRET IS THE PARTICIPANT'S. It is masked by default (`type=password`
// until the eye is pressed), it is never logged — the one console.warn in here
// prints the clipboard error and nothing else — and the share link puts it in
// the URL's HASH FRAGMENT, which browsers never send to a server. All three
// are reproduced exactly; none of them is incidental.
//
// LIFECYCLE NOTE. The Angular version wrapped backdrop and panel in
// `@if (open())`, so neither node EXISTED while the dialog was closed. A
// registry-fed element is mounted ONCE at boot and stays, so the chrome is
// built once and genuinely detached (`replaceChildren()`) while closed — a
// modal that is merely `display:none` still answers querySelector, and a
// full-screen backdrop that is merely transparent would eat every click on the
// hive. It starts hidden and only opens when `mesh:open-modal` says so.
//
// REPLAY IS NOT A GESTURE. `mesh:open-modal` and `mesh:close-modal` are
// emitted with `EffectBus.emit`, so the bus keeps them as last values and
// REPLAYS them to any late subscriber — including this element re-subscribing
// after the shell-surfaces host MOVES it (a move is a disconnect + connect).
// Without a guard, a move would silently re-open a dialog the participant had
// closed, with their secret back on screen. See #seenOpen / #seenClose.
//
// Its strings ship WITH it (mesh-modal.i18n.ts, extracted from all 14 shell
// catalogs) and register under the 'app' namespace, so every key resolves
// exactly as before — the Phase 2 catalog split, another slice.

import {
  attachWidgetZoom,
  EffectBus,
  I18N_IOC_KEY,
  ROOM_STORE_KEY,
  SAVED_LOCATIONS_CHANGED,
  SAVED_LOCATIONS_KEY,
  SECRET_STORE_KEY,
  SECRET_STRENGTH_KEY,
  type I18nProvider,
  type SavedLocationsChange,
  type SavedLocationsProvider,
  type SecretStrengthProvider,
  type WidgetAnchor,
  type ZoneValueStore,
} from '@hypercomb/core'
import { MESH_MODAL_TRANSLATIONS } from './mesh-modal.i18n.js'

const SURFACE_NAME = 'hc-mesh-modal'

/** hcWidget="mesh-modal" anchor="center" — the participant-local zoom the
 *  Angular directive stamped on the panel. Same id, so the persisted scale
 *  carries across the conversion untouched. */
const WIDGET_ID = 'mesh-modal'
const WIDGET_ANCHOR: WidgetAnchor = 'center'

/** The cmd the escape cascade publishes on `keymap:invoke`. */
const ESCAPE_CMD = 'global.escape'

const SELF_DOMAIN_KEY = 'hc:nostrmesh:self-domain'
const SKIP_REVIEW_KEY = 'hc:skip-privacy-review'
const USER_LABEL_KEY = 'hc:user-label'
const SWARM_KEY = '@diamondcoreprocessor.com/SwarmDrone'

/** Read the persisted swarm label / write it back — the SwarmDrone owns both
 *  when it is loaded (it clears the publish memo and re-syncs so a new label
 *  propagates immediately); localStorage is the fallback so this dialog can
 *  surface and save without a hard swarm dependency. */
interface SwarmLabelApi {
  myLabel?: () => string
  setMyLabel?: (s: string) => void
}

/** Normalize a host string the same way the rest of the codebase does:
 *  strip protocol prefix, trailing slashes, lowercase. Keeps localStorage
 *  in the canonical bare-host form. */
function normalizeHost(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/^wss?:\/\//i, '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

/** Strip leading/trailing slashes from a location path. */
function normalizeLocation(raw: string): string {
  return String(raw ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * Encode the four draft fields as a share-link URL — carried over verbatim
 * from `hypercomb-shared/core/address-record.ts` (`encodeAddress`), because
 * a module may not import from shared and the parse half of that file has no
 * consumer here. If a second module ever needs it, the pair belongs in core
 * beside link-utilities, not duplicated a third time.
 *
 * The shape is `https://<host>/<location>#alias=<a>&secret=<s>`, and the
 * placement is the point: **the secret lives only in the hash fragment**,
 * which is never sent to a server, so handing someone a link does not put the
 * shared key in anybody's access log. Host and alias are routing/presentation
 * only — they never enter the subscription signature, so two participants with
 * the same (location, secret) land on the same channel whichever host they
 * came through.
 *
 * Throws when host is empty; the caller catches (every address must reach a
 * host, and there is nothing to copy without one).
 */
function encodeAddress(record: {
  alias?: string
  host: string
  location?: string
  secret?: string
}): string {
  const host = normalizeHost(record.host)
  if (!host) throw new Error('address: host is required')
  const location = normalizeLocation(record.location ?? '')

  // Loopback hosts use http; real domains use https. Matches the broker's
  // URL-building convention.
  const scheme = /^(localhost|127(?:\.\d+){3}|\[?::1\]?)(?::\d+)?$/i.test(host) ? 'http' : 'https'
  const pathSegment = location ? '/' + encodeURI(location) : '/'
  let url = `${scheme}://${host}${pathSegment}`

  const hashParams: string[] = []
  const alias = String(record.alias ?? '').trim()
  if (alias) hashParams.push('alias=' + encodeURIComponent(alias))
  const secret = String(record.secret ?? '').trim()
  if (secret) hashParams.push('secret=' + encodeURIComponent(secret))
  if (hashParams.length) url += '#' + hashParams.join('&')

  return url
}

/** {token} interpolation for the FALLBACK text — the live provider does its
 *  own; this only runs when i18n is absent or the key is unresolved. */
const fill = (template: string, params?: Record<string, string | number>): string =>
  params
    ? template.replace(/\{(\w+)\}/g, (whole, token: string) => {
      const value = params[token]
      return value !== undefined ? String(value) : whole
    })
    : template

// Same contract as the shell pipe: params drive both pluralization
// (`key.one` / `key.other`, chosen on params.count by the i18n service) and
// `{token}` interpolation. The fallback is the English catalog text, and it
// interpolates the same tokens so a bare host with no i18n reads identically.
const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key, params)
  return value && value !== key ? value : fill(fallback, params)
}

// The dialog's strings travel with it — registered as soon as the i18n service
// is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(MESH_MODAL_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay / trust-prompt / landing-badge
// precedent), so Angular's `:host` becomes the tag name and every other
// selector is prefixed with it — nothing leaks out of the dialog.
//
// `@use '../breakpoints' as *` is expanded by hand: `tablet-only` is
// `(min-width: 600px) and (max-width: 1023px)`. The phone block is NOT a
// mixin in the original — it is a hand-written two-axis query, because a
// landscape phone is wide and short and `phone-only` (width alone) would drop
// it back to the centred desktop modal with sub-16px inputs, which makes iOS
// zoom the page on focus. Carried across verbatim.
//
// Angular's build autoprefixed; here the -webkit- pairs are written out:
// `backdrop-filter` (both the backdrop's blur and the panel's) and
// `user-select` on the skip label.
//
// All three @keyframes are renamed with the surface prefix — a document-level
// sheet shares ONE global animation namespace, and `mesh-modal-panel-enter` is
// a name the mesh header could plausibly want too.
//
// THE REDUCED-MOTION BLOCK IS LOAD-BEARING, and its reasoning is the SCSS's
// own: both enter animations park their `from` frame transparent / off-screen
// and rely on `forwards` to land the panel, so in any environment where the
// animation does not run that from-frame would hold FOREVER and the join
// dialog would be invisible and unusable. With animations off the resting
// styles already describe the correct final state, so the dialog just appears.
const CSS = `
${SURFACE_NAME}{display:contents}
${SURFACE_NAME} .mesh-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.72);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);z-index:100000;animation:hc-mesh-modal-backdrop-enter 200ms ease forwards}
${SURFACE_NAME} .mesh-modal-panel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100001;width:min(92vw,26rem);display:flex;flex-direction:column;background:rgba(14,18,24,.92);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.08);border-radius:var(--hc-radius-floating);box-shadow:0 12px 48px rgba(0,0,0,.7);color:rgba(245,245,245,.85);font-family:var(--hc-mono);animation:hc-mesh-modal-panel-enter 300ms cubic-bezier(.16,1,.3,1) forwards}
${SURFACE_NAME} .mesh-modal-header{display:flex;align-items:center;justify-content:space-between;padding:.75rem 1rem .5rem;border-bottom:1px solid rgba(255,255,255,.06)}
${SURFACE_NAME} .mesh-modal-header h3{font-size:.68rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#c8975a;margin:0}
${SURFACE_NAME} .mesh-modal-close{display:flex;align-items:center;justify-content:center;width:1.5rem;height:1.5rem;background:none;border:none;border-radius:3px;color:rgba(245,245,245,.3);font-size:1rem;cursor:pointer;transition:color 150ms ease,background 150ms ease}
${SURFACE_NAME} .mesh-modal-close:hover{color:whitesmoke;background:rgba(255,255,255,.08)}
${SURFACE_NAME} .mesh-modal-body{padding:.85rem 1rem;display:flex;flex-direction:column;gap:1rem}
${SURFACE_NAME} .mesh-modal-section{display:flex;flex-direction:column;gap:.4rem}
${SURFACE_NAME} .mesh-modal-label{font-size:.6rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:rgba(245,245,245,.45)}
${SURFACE_NAME} .mesh-modal-label-row{display:flex;align-items:center;justify-content:space-between;gap:.5rem}
${SURFACE_NAME} .mesh-modal-shield{font-size:1rem;line-height:1;transition:color 200ms ease}
${SURFACE_NAME} .mesh-modal-input{width:100%;box-sizing:border-box;padding:.55rem .7rem;border:1px solid rgba(255,255,255,.1);border-radius:4px;background:rgba(255,255,255,.04);color:whitesmoke;font-family:var(--hc-mono);font-size:.78rem;letter-spacing:.04em;outline:none;transition:border-color 150ms ease,background 150ms ease}
${SURFACE_NAME} .mesh-modal-input::placeholder{color:rgba(245,245,245,.28)}
${SURFACE_NAME} .mesh-modal-input:focus{border-color:rgba(77,166,255,.55);background:rgba(255,255,255,.06)}
${SURFACE_NAME} .mesh-modal-input-missing{border-color:rgba(255,138,128,.7)}
${SURFACE_NAME} .mesh-modal-missing{margin:.35rem 0 0;color:rgba(255,138,128,.9);font-family:var(--hc-mono);font-size:.68rem;letter-spacing:.03em}
${SURFACE_NAME} .mesh-modal-secret-row{display:flex;gap:.4rem;align-items:stretch}
${SURFACE_NAME} .mesh-modal-secret{flex:1;min-width:0}
${SURFACE_NAME} .mesh-modal-eye{display:flex;align-items:center;justify-content:center;width:2.2rem;border:1px solid rgba(255,255,255,.1);border-radius:4px;background:rgba(255,255,255,.04);color:rgba(245,245,245,.5);cursor:pointer;transition:color 150ms ease,background 150ms ease,border-color 150ms ease}
${SURFACE_NAME} .mesh-modal-eye .material-symbols-outlined{font-size:1.05rem}
${SURFACE_NAME} .mesh-modal-eye:hover{color:whitesmoke;background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.2)}
${SURFACE_NAME} .mesh-modal-chips{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.25rem}
${SURFACE_NAME} .mesh-modal-chip{display:inline-flex;align-items:center;gap:.35rem;padding:.3rem .45rem .3rem .65rem;border:1px solid rgba(255,255,255,.1);border-radius:999px;background:rgba(255,255,255,.04);color:rgba(245,245,245,.75);font-family:var(--hc-mono);font-size:.7rem;cursor:pointer;transition:background 150ms ease,color 150ms ease,border-color 150ms ease}
${SURFACE_NAME} .mesh-modal-chip:hover{background:rgba(77,166,255,.1);border-color:rgba(77,166,255,.35);color:whitesmoke}
${SURFACE_NAME} .mesh-modal-chip-text{white-space:nowrap}
${SURFACE_NAME} .mesh-modal-chip-remove{display:inline-flex;align-items:center;justify-content:center;width:1.1rem;height:1.1rem;border-radius:50%;color:rgba(245,245,245,.4);font-size:.9rem;line-height:1;cursor:pointer;transition:color 150ms ease,background 150ms ease}
${SURFACE_NAME} .mesh-modal-chip-remove:hover{color:#ff5a5a;background:rgba(255,90,90,.12)}
${SURFACE_NAME} .mesh-modal-skip{display:flex;align-items:center;gap:.45rem;padding:0 1rem .6rem;color:rgba(245,245,245,.45);font-size:.68rem;cursor:pointer;-webkit-user-select:none;user-select:none}
${SURFACE_NAME} .mesh-modal-skip input{margin:0;accent-color:rgba(126,182,214,.9);cursor:pointer}
${SURFACE_NAME} .mesh-modal-skip:hover{color:rgba(245,245,245,.7)}
${SURFACE_NAME} .mesh-modal-behaviors{display:flex;align-items:center;gap:.45rem;margin:0 1rem .6rem;padding:.3rem .55rem;background:none;border:1px solid rgba(255,255,255,.1);border-radius:var(--hc-radius-control);color:rgba(245,245,245,.55);font-size:.68rem;cursor:pointer}
${SURFACE_NAME} .mesh-modal-behaviors .material-symbols-outlined{font-size:.9rem}
${SURFACE_NAME} .mesh-modal-behaviors:hover{color:rgba(245,245,245,.85);border-color:rgba(255,255,255,.2)}
${SURFACE_NAME} .mesh-modal-actions{display:flex;justify-content:flex-end;gap:.5rem;padding:.5rem 1rem .75rem;border-top:1px solid rgba(255,255,255,.06)}
${SURFACE_NAME} .mesh-modal-btn{font-family:var(--hc-mono);font-size:.68rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;padding:.45rem 1rem;border-radius:4px;border:1px solid rgba(255,255,255,.1);cursor:pointer;transition:background 150ms ease,color 150ms ease,border-color 150ms ease}
${SURFACE_NAME} .mesh-modal-btn.cancel{background:rgba(255,255,255,.04);color:rgba(245,245,245,.5)}
${SURFACE_NAME} .mesh-modal-btn.cancel:hover{background:rgba(255,255,255,.08);color:rgba(245,245,245,.85)}
${SURFACE_NAME} .mesh-modal-btn.primary{background:rgba(77,166,255,.18);color:#9cc6ff;border-color:rgba(77,166,255,.32)}
${SURFACE_NAME} .mesh-modal-btn.primary:hover{background:rgba(77,166,255,.3);color:whitesmoke}
${SURFACE_NAME} .mesh-modal-btn.primary:active{transform:scale(.97)}
@keyframes hc-mesh-modal-backdrop-enter{from{opacity:0}to{opacity:1}}
@keyframes hc-mesh-modal-panel-enter{from{opacity:0;transform:translate(-50%,-50%) scale(.96)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
@keyframes hc-mesh-modal-panel-enter-phone{from{opacity:0;transform:translateY(100%)}to{opacity:1;transform:translateY(0)}}
@media (min-width:600px) and (max-width:1023px){${SURFACE_NAME} .mesh-modal-panel{width:min(85vw,28rem)}${SURFACE_NAME} .mesh-modal-close{width:2.2rem;height:2.2rem}${SURFACE_NAME} .mesh-modal-input{font-size:.85rem;padding:.6rem .75rem}${SURFACE_NAME} .mesh-modal-btn{padding:.55rem 1.1rem;font-size:.72rem}}
@media (max-width:599px),(max-height:449px){${SURFACE_NAME} .mesh-modal-panel{top:auto;bottom:0;left:0;right:0;max-height:min(92dvh,34rem);transform:none;width:100%;border-radius:var(--hc-radius-floating) var(--hc-radius-floating) 0 0;padding-bottom:var(--hc-safe-bottom,0px);animation:hc-mesh-modal-panel-enter-phone 250ms cubic-bezier(.16,1,.3,1) forwards}${SURFACE_NAME} .mesh-modal-body{overflow-y:auto;-webkit-overflow-scrolling:touch}${SURFACE_NAME} .mesh-modal-header{padding:.85rem 1rem .6rem}${SURFACE_NAME} .mesh-modal-header h3{font-size:.72rem}${SURFACE_NAME} .mesh-modal-close{width:2.5rem;height:2.5rem;font-size:1.1rem}${SURFACE_NAME} .mesh-modal-input{font-size:16px;padding:.65rem .8rem}${SURFACE_NAME} .mesh-modal-eye{width:2.6rem}${SURFACE_NAME} .mesh-modal-btn{padding:.6rem 1.2rem;font-size:.74rem;min-height:2.5rem}}
@media (prefers-reduced-motion:reduce){${SURFACE_NAME} .mesh-modal-backdrop,${SURFACE_NAME} .mesh-modal-panel{animation:none}}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-mesh-modal', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

/** Everything built once and kept. Rebuilding these on a payload would empty
 *  the boxes the participant is typing in and drop focus mid-keystroke, so the
 *  skeleton is stable and only its STRINGS, VALUES and ATTACHMENT change —
 *  which is also exactly what the locale switch needs. The two `@if` fragments
 *  (the missing-credential lines, the join-mode pair) and the chip row are
 *  moved in and out with insertBefore/remove, never re-created. */
type Chrome = {
  backdrop: HTMLDivElement
  panel: HTMLDivElement
  title: HTMLHeadingElement
  closeButton: HTMLButtonElement
  labelLabel: HTMLLabelElement
  labelInput: HTMLInputElement
  hostLabel: HTMLLabelElement
  hostInput: HTMLInputElement
  roomSection: HTMLElement
  roomLabel: HTMLLabelElement
  roomInput: HTMLInputElement
  roomMissing: HTMLParagraphElement
  chips: HTMLDivElement
  secretSection: HTMLElement
  secretLabel: HTMLLabelElement
  shield: HTMLSpanElement
  secretInput: HTMLInputElement
  eyeButton: HTMLButtonElement
  eyeIcon: HTMLSpanElement
  secretMissing: HTMLParagraphElement
  skipLabel: HTMLLabelElement
  skipCheckbox: HTMLInputElement
  skipText: HTMLSpanElement
  behaviorsButton: HTMLButtonElement
  behaviorsText: Text
  actions: HTMLElement
  cancelButton: HTMLButtonElement
  shareButton: HTMLButtonElement
  primaryButton: HTMLButtonElement
}

export class MeshModalElement extends HTMLElement {

  /** Everything connectedCallback wired, torn down in one sweep. */
  #offs: Array<() => void> = []

  /** attachWidgetZoom's teardown — its own handle, because the panel it scales
   *  outlives any single open/close cycle. */
  #zoomOff: (() => void) | null = null

  /** The raw window keydown listener (Enter → save). Held as ONE stable
   *  reference so removeEventListener can actually find it. */
  #onWindowKeyDown: ((e: KeyboardEvent) => void) | null = null

  /** The copied-flash timer. Cleared on disconnect, or it fires into a
   *  detached element and leaves the button reading "copied!" forever. */
  #copiedTimer: ReturnType<typeof setTimeout> | null = null

  #chrome: Chrome | null = null

  // ── the state the Angular signals held (state lives here, never in DOM) ──
  #open = false
  /** JOIN mode: opened from the solo→public flip. The primary button reads
   *  "start" and confirming also joins the swarm (emits 'mesh:join'). */
  #joinMode = false
  #roomDraft = ''
  #secretDraft = ''
  #labelDraft = ''
  #hostDraft = ''
  #secretVisible = false
  /** JOIN mode only: which credential blocked the start ('room' | 'secret'),
   *  so the field can say so instead of the dialog closing on a join that
   *  could never have worked. Cleared on every open and on a good start. */
  #missingField: 'room' | 'secret' | null = null
  /** JOIN mode only: persisted opt-out so a future join skips the pre-join
   *  privacy-review step (mesh-header reads `hc:skip-privacy-review`). */
  #skipReview = false
  #copiedFlash = false
  // Instance-free: the store (essentials, sharing module — saved-locations-
  // store.ts, right beside this file) announces its value on EffectBus at
  // construction and on every change, so there is no ordering to arrange.
  #savedLocations: ReadonlyArray<string> = []

  /** Open/close payloads this element has already ACTED ON. `mesh:open-modal`
   *  and `mesh:close-modal` both replay their last value to a late subscriber,
   *  and every disconnect+reconnect (the shell-surfaces host keeping DOM order
   *  equal to registry order) re-subscribes. Identity, not contents: every
   *  emitter mints a fresh object literal, so a replay is exactly the same
   *  object coming back and a genuine second gesture is a different one. The
   *  FIRST delivery always passes, which keeps the legitimate catch-up — a
   *  module that loads after the request was raised still opens. */
  #seenOpen = new WeakSet<object>()
  #seenClose = new WeakSet<object>()

  // ── IoC seams (looked up lazily; the sharing module may load after the
  //    shell mounts this surface) ─────────────────────────────────────────
  get #roomStore(): ZoneValueStore | undefined {
    return window.ioc?.get?.(ROOM_STORE_KEY) as ZoneValueStore | undefined
  }
  get #secretStore(): ZoneValueStore | undefined {
    return window.ioc?.get?.(SECRET_STORE_KEY) as ZoneValueStore | undefined
  }
  get #savedStore(): SavedLocationsProvider | undefined {
    return window.ioc?.get?.(SAVED_LOCATIONS_KEY) as SavedLocationsProvider | undefined
  }

  #readHost = (): string => {
    try { return normalizeHost(localStorage.getItem(SELF_DOMAIN_KEY) ?? '') }
    catch { return '' }
  }

  #writeHost = (v: string): void => {
    try {
      const clean = normalizeHost(v)
      if (clean) localStorage.setItem(SELF_DOMAIN_KEY, clean)
      else localStorage.removeItem(SELF_DOMAIN_KEY)
    } catch { /* ignore */ }
  }

  /** Read the persisted swarm label, preferring the SwarmDrone's canonical
   *  accessor when present so any future-tightened sanitization (length cap,
   *  control-char filter) applies. Falls back to localStorage when the drone
   *  hasn't loaded yet — the modal can still surface and save without a hard
   *  swarm dependency. */
  #readMyLabel = (): string => {
    const swarm = window.ioc?.get?.(SWARM_KEY) as SwarmLabelApi | undefined
    if (swarm?.myLabel) return swarm.myLabel()
    try { return String(localStorage.getItem(USER_LABEL_KEY) ?? '').trim().slice(0, 64) }
    catch { return '' }
  }

  /** The Angular `shieldColor` computed, unchanged: a pluggable provider
   *  scores the secret 0..1 and the hue rides that score red→green. No
   *  provider (the sharing module still loading) means a neutral 0.5, never
   *  a false "strong". */
  get #shieldColor(): string {
    const secret = this.#secretDraft.trim()
    if (!secret) return 'rgba(245, 245, 245, 0.45)'
    const provider = window.ioc?.get?.(SECRET_STRENGTH_KEY) as SecretStrengthProvider | undefined
    const score = provider?.evaluate(secret) ?? 0.5
    const hue = Math.round(score * 130)
    return `hsl(${hue}, 70%, 50%)`
  }

  connectedCallback(): void {
    installCss()
    this.#build()

    // Angular's `@if` destroyed the panel on every close; here the node
    // survives, so ONE attachment covers every opening and the persisted
    // scale is applied before the dialog is ever shown.
    const chrome = this.#chrome
    if (chrome) this.#zoomOff = attachWidgetZoom(chrome.panel, WIDGET_ID, WIDGET_ANCHOR)

    this.#offs.push(
      // ESCAPE, exactly as the Angular version had it: NOT a
      // `@HostListener('document:keydown.escape')` and NOT a keydown listener
      // of its own, but the escape cascade's `keymap:invoke` effect — so this
      // dialog takes its turn in the one cascade tool-windows.ts owns instead
      // of racing it. Because the original never went through Angular's
      // KeyEventsPlugin, it never had that plugin's unmodified-press-only
      // semantics, and adding a `ctrlKey || altKey || shiftKey || metaKey`
      // guard here would ITSELF be the regression. The keymap decides what
      // counts as Escape; this surface only answers.
      //
      // SUBSCRIBED FIRST, deliberately (the confirm-dialog ordering). Every
      // one of these effects replays its last value. Taking Escape first
      // means its replay lands while `#open` is still false and does nothing,
      // which is what a replayed keystroke should do.
      EffectBus.on<{ cmd: string }>('keymap:invoke', (payload) => {
        if (payload?.cmd === ESCAPE_CMD && this.#open) this.#dismiss()
      }),

      // The share toggle wrapping HOST → PRIVATE closes the selector with it.
      // Guarded on the replay (see #seenClose) — a reconnect must not close a
      // dialog the participant has open, and `mesh:close-modal` is a plain
      // emit whose last value sits on the bus indefinitely.
      EffectBus.on<unknown>('mesh:close-modal', (payload) => {
        if (payload !== null && typeof payload === 'object') {
          if (this.#seenClose.has(payload)) return
          this.#seenClose.add(payload)
        }
        if (this.#open) this.#close()
      }),

      // A SET, not an append — the same payload arriving twice (the store
      // announces at construction AND on every change) lands on the same
      // list. Rebuilding the chip row from it is therefore idempotent.
      EffectBus.on<SavedLocationsChange>(SAVED_LOCATIONS_CHANGED, ({ value }) => {
        this.#savedLocations = value ?? []
        this.#render()
      }),

      // THE OPENING. Guarded against replay: a disconnect+reconnect (a MOVE by
      // the shell-surfaces host) re-delivers the last open payload, and acting
      // on it would re-open a dialog the participant closed — with their
      // secret back on screen, and a second `mesh:modal-open` telling the
      // controls-bar to light the trigger again. First delivery always passes,
      // so a late-loading module still catches up on a live request.
      EffectBus.on<{ join?: boolean } | undefined>('mesh:open-modal', (payload) => {
        if (payload !== null && typeof payload === 'object') {
          if (this.#seenOpen.has(payload)) return
          this.#seenOpen.add(payload)
        }
        this.#openWith(payload)
      }),

      // THE PIPE WAS IMPURE. The Angular template resolved every string through
      // `| t`, declared `pure: false`, so every change-detection tick re-read
      // them and `/language ja` re-labelled an OPEN dialog on the spot. An
      // element renders when it decides to, so the locale switch has to be a
      // reason to render — otherwise a dialog already up keeps its old-locale
      // labels, placeholders and BUTTONS (including the only two exits) until
      // something else happens to change.
      EffectBus.on('locale:changed', () => this.#render()),
    )

    // ENTER SAVES. A raw window listener in the original too — deliberately
    // NOT the keymap, because it is a form-submit convention rather than a
    // shortcut, and it must not consume Enter when a BUTTON inside the panel
    // has focus (that button's own activation is what the participant meant).
    // The original bound it with no modifier guard, so Ctrl-Enter saves as
    // well; carried over unchanged.
    this.#onWindowKeyDown = (e: KeyboardEvent): void => {
      if (!this.#open || e.key !== 'Enter') return
      const active = document.activeElement as HTMLElement | null
      if (active?.tagName === 'BUTTON' && active.closest('.mesh-modal-panel')) return
      e.preventDefault()
      this.#save()
    }
    window.addEventListener('keydown', this.#onWindowKeyDown)

    // Hidden until something asks for it — a modal that flashes on boot is a
    // regression, and this one carries a secret field.
    this.#render()
  }

  disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    this.#zoomOff?.()
    this.#zoomOff = null
    if (this.#onWindowKeyDown) {
      window.removeEventListener('keydown', this.#onWindowKeyDown)
      this.#onWindowKeyDown = null
    }
    if (this.#copiedTimer !== null) {
      clearTimeout(this.#copiedTimer)
      this.#copiedTimer = null
      // The flash cannot expire while nothing is listening, so retire it here
      // rather than reconnecting into a permanent "copied!".
      this.#copiedFlash = false
    }
    // THE DRAFTS DELIBERATELY SURVIVE. Disconnection here is almost always the
    // shell-surfaces host MOVING this node to keep DOM order equal to registry
    // order, and the Angular component's instance survived that move whole —
    // clearing the room, secret, name and host a participant had half-typed
    // would be a data loss that looks like a glitch. The chrome is kept too,
    // so reconnecting rebuilds nothing and re-renders the same dialog.
  }

  // ── chrome (built once, detached) ────────────────────────────────────────
  #build(): void {
    if (this.#chrome) return

    // (click)="dismiss()" — the backdrop is a real exit, and it answers with
    // the SAME cancelled shape the ✕ and CANCEL send, so the mesh header
    // returns the icon from HOST to PRIVATE instead of leaving a stale filled
    // hub behind.
    const backdrop = document.createElement('div')
    backdrop.className = 'mesh-modal-backdrop'
    backdrop.addEventListener('click', () => { this.#dismiss() })

    const panel = document.createElement('div')
    panel.className = 'mesh-modal-panel'
    panel.setAttribute('role', 'dialog')

    // ── header ───────────────────────────────────────────────────────────
    const header = document.createElement('header')
    header.className = 'mesh-modal-header'
    const title = document.createElement('h3')
    const closeButton = document.createElement('button')
    closeButton.type = 'button'
    closeButton.className = 'mesh-modal-close'
    closeButton.textContent = '×'
    closeButton.addEventListener('click', () => { this.#dismiss() })
    header.append(title, closeButton)

    // ── body ─────────────────────────────────────────────────────────────
    const body = document.createElement('div')
    body.className = 'mesh-modal-body'

    // 1. Alias (display name / "label")
    const labelSection = document.createElement('section')
    labelSection.className = 'mesh-modal-section'
    const labelLabel = document.createElement('label')
    labelLabel.className = 'mesh-modal-label'
    labelLabel.htmlFor = 'mesh-modal-label-input'
    const labelInput = document.createElement('input')
    labelInput.id = 'mesh-modal-label-input'
    labelInput.className = 'mesh-modal-input mesh-modal-label-field'
    labelInput.type = 'text'
    labelInput.maxLength = 64
    labelInput.autocomplete = 'off'
    labelInput.spellcheck = false
    labelInput.addEventListener('input', () => {
      this.#labelDraft = labelInput.value
    })
    labelSection.append(labelLabel, labelInput)

    // 2. Host (which domain you're connected through — every participant
    //    has one)
    const hostSection = document.createElement('section')
    hostSection.className = 'mesh-modal-section'
    const hostLabel = document.createElement('label')
    hostLabel.className = 'mesh-modal-label'
    hostLabel.htmlFor = 'mesh-modal-host-input'
    const hostInput = document.createElement('input')
    hostInput.id = 'mesh-modal-host-input'
    hostInput.className = 'mesh-modal-input mesh-modal-host'
    hostInput.type = 'text'
    hostInput.autocomplete = 'off'
    hostInput.spellcheck = false
    hostInput.addEventListener('input', () => {
      this.#hostDraft = hostInput.value
    })
    hostSection.append(hostLabel, hostInput)

    // 3. Location (room — folds into the subscription sig)
    const roomSection = document.createElement('section')
    roomSection.className = 'mesh-modal-section'
    const roomLabel = document.createElement('label')
    roomLabel.className = 'mesh-modal-label'
    roomLabel.htmlFor = 'mesh-modal-room-input'
    const roomInput = document.createElement('input')
    roomInput.id = 'mesh-modal-room-input'
    roomInput.className = 'mesh-modal-input mesh-modal-room'
    roomInput.type = 'text'
    // NOTE: the location box deliberately keeps the platform defaults for
    // autocomplete/spellcheck — the original only turned them off on the
    // name, host and secret.
    roomInput.addEventListener('input', () => {
      this.#roomDraft = roomInput.value
    })
    const roomMissing = document.createElement('p')
    roomMissing.className = 'mesh-modal-missing'
    roomMissing.setAttribute('role', 'alert')
    const chips = document.createElement('div')
    chips.className = 'mesh-modal-chips'
    // `roomMissing` and `chips` are left OUT: the template's inner `@if`s put
    // them in the DOM only when they had something to say. #renderRoomSection
    // moves them in and back out.
    roomSection.append(roomLabel, roomInput)

    // 4. Secret (folds into the subscription sig)
    const secretSection = document.createElement('section')
    secretSection.className = 'mesh-modal-section'
    const labelRow = document.createElement('div')
    labelRow.className = 'mesh-modal-label-row'
    const secretLabel = document.createElement('label')
    secretLabel.className = 'mesh-modal-label'
    secretLabel.htmlFor = 'mesh-modal-secret-input'
    const shield = document.createElement('span')
    shield.className = 'mesh-modal-shield material-symbols-outlined'
    shield.setAttribute('aria-hidden', 'true')
    shield.textContent = 'shield'
    labelRow.append(secretLabel, shield)

    const secretRow = document.createElement('div')
    secretRow.className = 'mesh-modal-secret-row'
    const secretInput = document.createElement('input')
    secretInput.id = 'mesh-modal-secret-input'
    secretInput.className = 'mesh-modal-input mesh-modal-secret'
    // MASKED BY DEFAULT — `type` follows #secretVisible, which every open
    // resets to false. The eye is the only thing that reveals it.
    secretInput.type = 'password'
    secretInput.autocomplete = 'off'
    secretInput.spellcheck = false
    secretInput.addEventListener('input', () => {
      const value = secretInput.value
      this.#secretDraft = value
      // The mesh header shows the same strength shield beside the hub icon;
      // it follows the DRAFT so the two agree keystroke by keystroke.
      EffectBus.emit('mesh:secret-draft', { secret: value })
      // Mutating one existing node on a stream update — no rebuild, so the
      // caret and selection in the box being typed in are untouched.
      this.#paintShield()
    })
    const eyeButton = document.createElement('button')
    eyeButton.type = 'button'
    eyeButton.className = 'mesh-modal-eye'
    const eyeIcon = document.createElement('span')
    eyeIcon.className = 'material-symbols-outlined'
    eyeButton.appendChild(eyeIcon)
    eyeButton.addEventListener('click', () => {
      this.#secretVisible = !this.#secretVisible
      this.#render()
    })
    secretRow.append(secretInput, eyeButton)

    const secretMissing = document.createElement('p')
    secretMissing.className = 'mesh-modal-missing'
    secretMissing.setAttribute('role', 'alert')
    secretSection.append(labelRow, secretRow)

    body.append(labelSection, hostSection, roomSection, secretSection)

    // ── join-mode pair (between the body and the actions) ─────────────────
    const skipLabel = document.createElement('label')
    skipLabel.className = 'mesh-modal-skip'
    const skipCheckbox = document.createElement('input')
    skipCheckbox.type = 'checkbox'
    skipCheckbox.addEventListener('change', () => { this.#toggleSkipReview() })
    const skipText = document.createElement('span')
    skipLabel.append(skipCheckbox, skipText)

    // The behavior axis of the pre-join review: opens the Beehaviors roster
    // (global switches — off = dormant everywhere AND withheld from the
    // swarm). The modal stays open; the panel docks beside it.
    const behaviorsButton = document.createElement('button')
    behaviorsButton.type = 'button'
    behaviorsButton.className = 'mesh-modal-behaviors'
    const behaviorsIcon = document.createElement('span')
    behaviorsIcon.className = 'material-symbols-outlined'
    behaviorsIcon.setAttribute('aria-hidden', 'true')
    behaviorsIcon.textContent = 'tune'
    // A bare text node, as the template compiled it — an anonymous flex item,
    // so the button's `gap` spaces it from the icon exactly as before.
    const behaviorsText = document.createTextNode('')
    behaviorsButton.append(behaviorsIcon, behaviorsText)
    behaviorsButton.addEventListener('click', () => {
      EffectBus.emit('features:roster-open', {})
    })

    // ── actions ──────────────────────────────────────────────────────────
    const actions = document.createElement('footer')
    actions.className = 'mesh-modal-actions'
    const cancelButton = document.createElement('button')
    cancelButton.type = 'button'
    cancelButton.className = 'mesh-modal-btn cancel'
    cancelButton.addEventListener('click', () => { this.#dismiss() })
    const shareButton = document.createElement('button')
    shareButton.type = 'button'
    shareButton.className = 'mesh-modal-btn share'
    shareButton.addEventListener('click', () => { void this.#copyShareLink() })
    const primaryButton = document.createElement('button')
    primaryButton.type = 'button'
    primaryButton.className = 'mesh-modal-btn primary'
    primaryButton.addEventListener('click', () => { this.#save() })
    actions.append(cancelButton, shareButton, primaryButton)

    panel.append(header, body, actions)

    this.#chrome = {
      backdrop, panel, title, closeButton,
      labelLabel, labelInput,
      hostLabel, hostInput,
      roomSection, roomLabel, roomInput, roomMissing, chips,
      secretSection, secretLabel, shield, secretInput, eyeButton, eyeIcon, secretMissing,
      skipLabel, skipCheckbox, skipText, behaviorsButton, behaviorsText,
      actions, cancelButton, shareButton, primaryButton,
    }
  }

  // ── opening ──────────────────────────────────────────────────────────────
  #openWith(payload: { join?: boolean } | undefined): void {
    this.#joinMode = !!payload?.join
    const initialSecret = this.#secretStore?.value ?? ''
    this.#roomDraft = this.#roomStore?.value ?? ''
    this.#secretDraft = initialSecret
    this.#labelDraft = this.#readMyLabel()
    this.#hostDraft = this.#readHost()
    // Every open re-masks the secret. A dialog that reopened revealed would
    // put the shared key on a screen somebody else may now be looking at.
    this.#secretVisible = false
    this.#missingField = null
    try { this.#skipReview = localStorage.getItem(SKIP_REVIEW_KEY) === '1' }
    catch { this.#skipReview = false }
    this.#open = true
    EffectBus.emit('mesh:modal-open', { open: true })
    EffectBus.emit('mesh:secret-draft', { secret: initialSecret })
    this.#render()
    // The location box is where the answer usually goes, so the keyboard
    // lands there. (The Angular version reached for it with
    // `document.querySelector('.mesh-modal-room')` because it had no handle
    // on the node it had just asked change-detection to create; here the node
    // is the same one and we hold it.)
    queueMicrotask(() => { this.#chrome?.roomInput.focus() })
  }

  // ── the exits ────────────────────────────────────────────────────────────
  #dismiss = (): void => {
    this.#close(true)
  }

  /** The ONE place the dialog leaves the screen, and therefore the one place
   *  `mesh:modal-open` is answered. Every exit — backdrop, ✕, CANCEL, the
   *  escape cascade, SAVE/START, `mesh:close-modal`, and un-checking the
   *  privacy-review opt-out — funnels through here, so each one answers
   *  exactly once, with the original's shape:
   *
   *    cancelled TRUE   the participant backed out (mesh-header returns the
   *                     hub icon from HOST to PRIVATE)
   *    cancelled FALSE  an intentional transition (a save joined; opting back
   *                     into the review steps back to WORLD on its own)
   *
   *  `mesh:secret-draft` is cleared to null on the way out — the header stops
   *  shadowing a draft that no longer exists, and the secret leaves the bus. */
  #close = (cancelled = false): void => {
    this.#open = false
    EffectBus.emit('mesh:modal-open', { open: false, cancelled })
    EffectBus.emit('mesh:secret-draft', { secret: null })
    this.#render()
  }

  #save = (): void => {
    const room = this.#roomDraft.trim()
    const secret = this.#secretDraft.trim()
    const label = this.#labelDraft.trim().slice(0, 64)
    const host = this.#hostDraft.trim()

    // START with a half-set zone used to join anyway, and the swarm then
    // refused to subscribe or publish (it composes its sig from BOTH
    // credentials) — a hive that looked joined and saw nobody, with nothing
    // said. Joining needs both; stay open and point at what is missing.
    // Non-join saves are unaffected: clearing the zone from the editor is a
    // legitimate way to go quiet.
    if (this.#joinMode && (!room || !secret)) {
      this.#missingField = !room ? 'room' : 'secret'
      this.#render()
      return
    }
    this.#missingField = null
    this.#roomStore?.set(room)
    this.#secretStore?.set(secret)
    // Host writes directly to localStorage — single canonical key, no
    // wrapper. Empty save doesn't unset it (the runtime bootstrap default
    // of window.location.origin stays), so we only write on non-empty.
    if (host) this.#writeHost(host)
    EffectBus.emit('mesh:room', { room })
    EffectBus.emit('mesh:secret', { secret })
    EffectBus.emit('mesh:host', { host: this.#readHost() })
    if (room) this.#savedStore?.add(room)

    // Label routes through swarm.setMyLabel when available — it clears the
    // publish memo + triggers re-sync so the new label propagates
    // immediately. localStorage fallback covers the case where the swarm bee
    // hasn't loaded yet.
    const swarm = window.ioc?.get?.(SWARM_KEY) as SwarmLabelApi | undefined
    if (swarm?.setMyLabel) {
      swarm.setMyLabel(label)
    } else {
      try { localStorage.setItem(USER_LABEL_KEY, label) } catch { /* ignore */ }
    }

    // JOIN mode: confirming the location IS the act of going public — the
    // controls-bar listens for 'mesh:join' and flips solo → swarm.
    if (this.#joinMode) EffectBus.emit('mesh:join', {})

    this.#close()
  }

  #toggleSkipReview = (): void => {
    const next = !this.#skipReview
    this.#skipReview = next
    try { localStorage.setItem(SKIP_REVIEW_KEY, next ? '1' : '0') }
    catch { /* ignore */ }
    // Unchecking it means "I DO want the review" — so step BACK to that stage
    // (the header returns to WORLD) and close. Checking it is a no-op for
    // navigation: you're already past the review, standing in the selector.
    if (!next) {
      EffectBus.emit('mesh:privacy-step-back', {})
      this.#close()
      return
    }
    this.#render()
  }

  #pickLocation = (name: string): void => {
    this.#roomDraft = name
    this.#render()
  }

  #removeSaved = (event: Event, name: string): void => {
    // Without this the click reaches the chip BUTTON behind the ✕ and picks
    // the very location being removed.
    event.stopPropagation()
    this.#savedStore?.remove(name)
    // No local list write: the store announces SAVED_LOCATIONS_CHANGED and
    // the subscription above re-renders from it. One source of truth.
  }

  /** Compose the four draft fields into a share-link URL and copy it to the
   *  clipboard. Uses the navigator clipboard API; falls back silently if
   *  unavailable. The URL never contains the secret in the path or query —
   *  the secret lives only in the hash fragment, which isn't sent to the
   *  server. The warn prints the ERROR only: never the URL, never the
   *  fields. */
  #copyShareLink = async (): Promise<void> => {
    try {
      const url = encodeAddress({
        alias: this.#labelDraft.trim() || undefined,
        host: this.#hostDraft.trim(),
        location: this.#roomDraft.trim() || undefined,
        secret: this.#secretDraft.trim() || undefined,
      })
      await navigator.clipboard.writeText(url)
      this.#copiedFlash = true
      this.#render()
      if (this.#copiedTimer !== null) clearTimeout(this.#copiedTimer)
      this.#copiedTimer = setTimeout(() => {
        this.#copiedTimer = null
        this.#copiedFlash = false
        this.#render()
      }, 1500)
    } catch (e) {
      console.warn('[mesh-modal] copyShareLink failed:', e)
    }
  }

  // ── rendering (rebuild on change — the house pattern, no reconciler) ─────
  // The skeleton is stable and only its strings, values and attachment move.
  // Rebuilding the panel would empty a half-typed secret and drop focus
  // mid-keystroke; the ONE thing rebuilt is the chip row, which holds no
  // input state and no running animation.
  #render(): void {
    const c = this.#chrome
    if (!c) return

    // Original: `@if (open())`. A real boolean set by open/close — not a
    // derived comparison — so branching on its negation carries the same
    // polarity. Closed means the nodes genuinely LEAVE THE DOM, as `@if`
    // left them: a backdrop that is only transparent covers the whole hive
    // and eats every click, and a panel that is only display:none still
    // answers querySelector.
    if (!this.#open) {
      this.replaceChildren()
      return
    }
    if (c.backdrop.parentNode !== this || c.panel.parentNode !== this) {
      this.replaceChildren(c.backdrop, c.panel)
    }

    this.#relabel()
    this.#syncValues()
    this.#renderRoomSection()
    this.#renderSecretSection()
    this.#renderJoinMode()
    this.#paintShield()
  }

  /** Every translated string, re-resolved. Called on each render, which is
   *  what makes `locale:changed` re-label an OPEN dialog the way the impure
   *  pipe used to. */
  #relabel(): void {
    const c = this.#chrome
    if (!c) return

    const titleText = t('mesh-modal.title', 'location')
    c.title.textContent = titleText
    // [attr.aria-label]="'mesh-modal.title' | t" — same key, same string.
    c.panel.setAttribute('aria-label', titleText)
    c.closeButton.setAttribute('aria-label', t('mesh-modal.close', 'close'))

    c.labelLabel.textContent = t('mesh-modal.label-label', 'your name')
    c.labelInput.placeholder = t('mesh-modal.label-placeholder', 'how others see you in the swarm')

    c.hostLabel.textContent = t('mesh-modal.host-label', 'host')
    c.hostInput.placeholder = t('mesh-modal.host-placeholder', "the domain you're connected through")

    c.roomLabel.textContent = t('mesh-modal.location-label', 'location')
    c.roomInput.placeholder = t('mesh-modal.location-placeholder', 'type a location name')
    c.roomMissing.textContent = t('mesh-modal.needs-location', 'a location is needed to join')

    c.secretLabel.textContent = t('mesh-modal.secret-label', 'secret')
    c.secretInput.placeholder = t('mesh-modal.secret-placeholder', 'shared key')
    c.secretMissing.textContent = t('mesh-modal.needs-secret', 'a secret is needed to join')
    // A KEY CHOSEN AT RUNTIME — both spellings ship in this surface's catalog.
    c.eyeButton.setAttribute('aria-label', this.#secretVisible
      ? t('mesh-modal.hide-secret', 'hide secret')
      : t('mesh-modal.show-secret', 'show secret'))

    c.skipText.textContent = t('mesh-modal.skip-review', 'skip the privacy review next time')
    c.behaviorsText.data = t('mesh-modal.shared-behaviors', 'choose shared beehaviors…')

    c.cancelButton.textContent = t('mesh-modal.cancel', 'cancel')
    // Two more runtime-chosen keys: the share button flashes its confirmation
    // in place, and the primary button says what confirming will DO.
    c.shareButton.textContent = this.#copiedFlash
      ? t('mesh-modal.share-copied', 'copied!')
      : t('mesh-modal.share', 'copy share link')
    c.primaryButton.textContent = this.#joinMode
      ? t('mesh-modal.start', 'start')
      : t('mesh-modal.save', 'save')
  }

  /** The `[value]` / `[type]` / `[class.…]` bindings. Values are written only
   *  when they actually differ: re-assigning the identical string to a focused
   *  input resets its selection in some browsers, and these boxes are focused
   *  precisely while they are being typed in. */
  #syncValues(): void {
    const c = this.#chrome
    if (!c) return
    if (c.labelInput.value !== this.#labelDraft) c.labelInput.value = this.#labelDraft
    if (c.hostInput.value !== this.#hostDraft) c.hostInput.value = this.#hostDraft
    if (c.roomInput.value !== this.#roomDraft) c.roomInput.value = this.#roomDraft
    if (c.secretInput.value !== this.#secretDraft) c.secretInput.value = this.#secretDraft

    const type = this.#secretVisible ? 'text' : 'password'
    if (c.secretInput.type !== type) c.secretInput.type = type
    c.eyeIcon.textContent = this.#secretVisible ? 'visibility_off' : 'visibility'

    // The credential that blocked START. Marks the field rather than throwing
    // a dialog: the answer is one keystroke away, in the box already on screen.
    c.roomInput.classList.toggle('mesh-modal-input-missing', this.#missingField === 'room')
    c.secretInput.classList.toggle('mesh-modal-input-missing', this.#missingField === 'secret')
    c.shareButton.classList.toggle('copied', this.#copiedFlash)
  }

  /** `@if (missingField() === 'room')` and `@if (savedLocations().length > 0)`
   *  — both kept in the ORIGINAL direction. The length test especially: a
   *  payload whose `value` is not an array makes `.length` undefined, and
   *  `undefined > 0` is false, so the row stays out. The negated form
   *  (`<= 0`) is ALSO false there and would fall through to render it. */
  #renderRoomSection(): void {
    const c = this.#chrome
    if (!c) return

    if (this.#missingField === 'room') {
      if (c.roomMissing.parentNode !== c.roomSection) {
        // Before the chips when they are up, so the order stays
        // label → input → alert → chips exactly as the template had it.
        c.roomSection.insertBefore(
          c.roomMissing,
          c.chips.parentNode === c.roomSection ? c.chips : null,
        )
      }
    } else {
      c.roomMissing.remove()
    }

    const locations = this.#savedLocations
    if (locations.length > 0) {
      // The one rebuild in this surface: chips hold no typed state and no
      // running animation, and their count changes only when the store says
      // so. Everything else is mutated in place.
      const parts: HTMLElement[] = []
      for (const loc of locations) {
        const chip = document.createElement('button')
        chip.type = 'button'
        chip.className = 'mesh-modal-chip'
        chip.addEventListener('click', () => { this.#pickLocation(loc) })

        const text = document.createElement('span')
        text.className = 'mesh-modal-chip-text'
        text.textContent = loc

        const remove = document.createElement('span')
        remove.className = 'mesh-modal-chip-remove'
        remove.setAttribute('role', 'button')
        remove.setAttribute('aria-label', t('mesh-modal.remove-saved', 'remove saved location'))
        remove.textContent = '×'
        remove.addEventListener('click', (event) => { this.#removeSaved(event, loc) })

        chip.append(text, remove)
        parts.push(chip)
      }
      c.chips.replaceChildren(...parts)
      // appendChild MOVES an existing node — and the chip row is always last
      // in the section, so appending is the whole placement.
      if (c.chips.parentNode !== c.roomSection) c.roomSection.appendChild(c.chips)
    } else {
      c.chips.remove()
      c.chips.replaceChildren()
    }
  }

  #renderSecretSection(): void {
    const c = this.#chrome
    if (!c) return
    if (this.#missingField === 'secret') {
      if (c.secretMissing.parentNode !== c.secretSection) {
        c.secretSection.appendChild(c.secretMissing)
      }
    } else {
      c.secretMissing.remove()
    }
  }

  /** `@if (joinMode())` — the opt-out and the behaviors button exist only on
   *  the pre-join path, and they sit between the body and the action row. */
  #renderJoinMode(): void {
    const c = this.#chrome
    if (!c) return
    if (this.#joinMode) {
      if (c.skipLabel.parentNode !== c.panel) c.panel.insertBefore(c.skipLabel, c.actions)
      if (c.behaviorsButton.parentNode !== c.panel) c.panel.insertBefore(c.behaviorsButton, c.actions)
      c.skipCheckbox.checked = this.#skipReview
    } else {
      c.skipLabel.remove()
      c.behaviorsButton.remove()
    }
  }

  #paintShield(): void {
    const c = this.#chrome
    if (!c) return
    c.shield.style.color = this.#shieldColor
  }
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
  customElements.define(SURFACE_NAME, MeshModalElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/MeshModalElement',
    element: SURFACE_NAME,
    order: 260,
  })
})
