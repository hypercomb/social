// host-panel.view.ts — the Host panel: the executable makes anybody a host,
// as a framework-free custom element (everything-is-a-beehavior Phase 2:
// Angular panels leave the shell and ship as signed modules).
//
// A straight port of shared/ui/host-panel: same surface name (`host-panel` —
// no `hc-` prefix, byte-for-byte what the Angular registration used), same
// order band (460), same seven `hosting_*` IPC commands, same 5-second poll,
// and the SAME NATIVE GATE — the registry.add is wrapped in the Tauri check,
// so on the web shell this file loads and the surface simply never appears.
// Absence of registration IS the feature.
//
// Point and click: pick the published folder (native dialog — the renderer
// never supplies a path), the app serves it on a loopback port, cloudflared
// puts the owner's domain on it. The visitor chain is
// domain → Cloudflare edge → tunnel → this app; the tunnel is a dumb pipe,
// so whatever the app serves IS the domain. Full doctrine:
// documentation/read-only-deployment.md.
//
// ALL STATE IS RUST-SIDE. This panel owns nothing but the open/closed flag,
// the busy latch, the last message and the domain draft — everything it
// DISPLAYS comes back from `hosting_status`, re-read every 5 seconds while
// the card is open and again after every action. The app CSP forbids
// fetching localhost, so status never probes the served port directly; the
// IPC answer is the only truth there is.
//
// NOTHING HERE IS LOGGED. The domain and the tunnel are the two things this
// surface knows that nobody else should read out of a console; the Angular
// original printed neither, and neither does this.
//
// Its strings ship WITH it (host-panel.i18n.ts, extracted from all 14 shell
// catalogs) and register under the 'app' namespace, so every key resolves
// exactly as before — the Phase 2 catalog split, another slice.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { HOST_PANEL_TRANSLATIONS } from './host-panel.i18n.js'

/** The registry key AND the tag. The Angular component's selector was
 *  `hc-host-panel`, but the SURFACE it registered was named plain
 *  `host-panel` — that name is what the shell mounts, so it is carried
 *  across unchanged. (`host-panel` has a hyphen, so it is a legal custom
 *  element name; nothing else about the port needs to change.) */
const SURFACE_NAME = 'host-panel'

/** Rust's shape, snake_case included — this is the `hosting_status` reply
 *  verbatim, never remapped, so a field added on the Rust side shows up here
 *  by its own name. */
interface HostingStatus {
  folder: string | null
  serving: boolean
  port: number | null
  domain: string | null
  tunnel_running: boolean
  cloudflared: boolean
}

/** The whole IPC surface: `window.__TAURI__.core.invoke`, resolved per call
 *  so a bridge that arrives late still works. No bridge → a rejected promise,
 *  which every caller here already funnels into the message line. */
const invoke = (command: string, args?: Record<string, unknown>): Promise<unknown> => {
  const tauri = (window as { __TAURI__?: { core?: { invoke?: (c: string, a?: unknown) => Promise<unknown> } } }).__TAURI__
  const call = tauri?.core?.invoke
  return call ? call(command, args) : Promise.reject(new Error('no native bridge'))
}

/** THE GATE. Registration — not rendering, not a feature flag — is what
 *  keeps this off the web shell. */
const nativeAvailable = (): boolean =>
  typeof window !== 'undefined' && '__TAURI__' in window

const CLOUDFLARED_DOWNLOADS =
  'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'

/** The status poll, unchanged from the Angular original: started when the
 *  card opens, cleared when it closes AND on disconnect. A polling timer
 *  that outlives its element hammers IPC forever. */
const POLL_MS = 5000

/** {token} interpolation for the FALLBACK text — the live provider does its
 *  own; this only runs when i18n is absent or the key is unresolved. */
const fill = (template: string, params?: Record<string, string | number>): string =>
  params
    ? template.replace(/\{(\w+)\}/g, (whole, token: string) => {
      const value = params[token]
      return value !== undefined ? String(value) : whole
    })
    : template

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key, params)
  return value && value !== key ? value : fill(fallback, params)
}

// The panel's strings travel with it — registered as soon as the i18n service
// is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(HOST_PANEL_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the landing-badge + preview-banner precedent), so Angular's
// `:host` became the tag name and every other selector is prefixed with it —
// nothing leaks out of the panel and nothing outside reaches in.
//
// Cold chrome, card radius, no effects. Bottom-LEFT corner: the feedback
// button owns bottom-right. Two deliberate non-changes from the SCSS:
//   - z-index 5600, exactly as written. It is the panel's historical layer
//     and raising it is not part of this port.
//   - the buttons carry NO `font: inherit` (only the domain input does), so
//     they keep the UA control font the Angular build gave them.
// There are no @keyframes here, so nothing needed renaming for the global
// animation namespace, and nothing relied on an autoprefixed property.
const CSS = `
${SURFACE_NAME}{position:fixed;left:12px;bottom:12px;z-index:5600;display:block;font-size:12px}
${SURFACE_NAME} .host-pill{border:1px solid var(--hc-border,#3a3a3f);border-radius:2px;background:var(--hc-surface,#1c1c20);color:var(--hc-text-dim,#9a9aa2);padding:4px 10px;cursor:pointer}
${SURFACE_NAME} .host-pill:hover{color:var(--hc-text,#e4e4e8)}
${SURFACE_NAME} .host-card{position:absolute;left:0;bottom:32px;width:340px;border:1px solid var(--hc-border,#3a3a3f);border-radius:3px;background:var(--hc-surface,#1c1c20);color:var(--hc-text,#e4e4e8);padding:10px 12px;display:grid;gap:8px}
${SURFACE_NAME} .host-card__title{color:var(--hc-text-dim,#9a9aa2);letter-spacing:0.08em;text-transform:uppercase;font-size:10px}
${SURFACE_NAME} .host-row{display:flex;align-items:center;gap:8px;min-width:0}
${SURFACE_NAME} .host-row__label{color:var(--hc-text-dim,#9a9aa2);flex:0 0 52px}
${SURFACE_NAME} .host-row__value{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .host-row--actions{justify-content:flex-end;flex-wrap:wrap}
${SURFACE_NAME} .host-row--hint .host-row__value{white-space:normal}
${SURFACE_NAME} .host-row input{flex:1 1 auto;min-width:0;background:var(--hc-surface-deep,#121215);border:1px solid var(--hc-border,#3a3a3f);border-radius:2px;color:inherit;padding:4px 6px;font:inherit}
${SURFACE_NAME} .host-row button{border:1px solid var(--hc-border,#3a3a3f);border-radius:2px;background:transparent;color:inherit;padding:3px 8px;cursor:pointer}
${SURFACE_NAME} .host-row button:disabled{opacity:0.4;cursor:default}
${SURFACE_NAME} .host-row button:not(:disabled):hover{border-color:var(--hc-text-dim,#9a9aa2)}
${SURFACE_NAME} .host-dot{width:8px;height:8px;border-radius:50%;background:var(--hc-text-dim,#55555c);flex:0 0 auto}
${SURFACE_NAME} .host-dot--on{background:#4caf7d}
${SURFACE_NAME} .host-primary{border-color:#4caf7d !important}
${SURFACE_NAME} .host-live{border-color:#4caf7d !important;color:#4caf7d !important}
${SURFACE_NAME} .host-message{color:var(--hc-text-dim,#9a9aa2);word-break:break-word}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-host-panel', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

/** Every node this panel can show. Built ONCE and kept: the card is opened
 *  and closed, rows appear and vanish with the Rust state, and the poll
 *  repaints every five seconds — re-creating a node on any of those would
 *  drop focus (and the caret) out of the domain input mid-typing. Nothing in
 *  here is ever rebuilt; the render only sets text, toggles `disabled`, and
 *  moves kept nodes into place. */
interface Chrome {
  pill: HTMLButtonElement
  card: HTMLElement
  title: HTMLElement
  reading: HTMLElement
  folderRow: HTMLElement
  folderLabel: HTMLElement
  folderValue: HTMLElement
  choose: HTMLButtonElement
  servingRow: HTMLElement
  servingLabel: HTMLElement
  dot: HTMLElement
  servingValue: HTMLElement
  start: HTMLButtonElement
  stop: HTMLButtonElement
  hintRow: HTMLElement
  hintValue: HTMLElement
  getCloudflared: HTMLButtonElement
  domainRow: HTMLElement
  domainLabel: HTMLElement
  domainInput: HTMLInputElement
  actionsRow: HTMLElement
  login: HTMLButtonElement
  goOffline: HTMLButtonElement
  live: HTMLButtonElement
  goLive: HTMLButtonElement
  message: HTMLElement
}

/** Put exactly `children` inside `parent`, in exactly this order, MOVING the
 *  nodes that are already live instead of re-creating them.
 *
 *  Departed nodes are swept BEFORE the walk, never during it. The walk keeps
 *  an anchor and SKIPS anything already in position, because `insertBefore`
 *  on an already-parented node is a remove followed by an insert — and
 *  removing a subtree that holds the focused element drops focus to <body>.
 *  Skipping the in-place ones means the domain input is never touched while
 *  somebody is typing in it. (toast.view.ts / activity-log.view.ts pattern.) */
const place = (parent: HTMLElement, children: readonly HTMLElement[]): void => {
  const wanted = new Set<Node>(children)
  for (const node of Array.from(parent.childNodes)) {
    if (!wanted.has(node)) parent.removeChild(node)
  }
  let anchor: ChildNode | null = parent.firstChild
  for (const child of children) {
    if (anchor === child) { anchor = child.nextSibling; continue }
    parent.insertBefore(child, anchor)
  }
}

export class HostPanelElement extends HTMLElement {

  #offs: Array<() => void> = []
  #chrome: Chrome | null = null

  /** The Angular `@if (open())`. The card is DETACHED while closed, not
   *  hidden — a `display:none` card still answers querySelector, and the
   *  original genuinely removed it. */
  #open = false
  #status: HostingStatus | null = null
  #busy = false
  #message = ''
  #domainDraft = ''

  #poll: ReturnType<typeof setInterval> | null = null

  connectedCallback(): void {
    installCss()
    this.#build()
    // THE PIPE WAS IMPURE. The Angular original resolved every string through
    // the `t` pipe, declared `pure: false`, so change detection re-read them
    // on every tick and `/language ja` re-labelled an OPEN panel on the spot.
    // An element renders when it decides to, so the locale switch has to be a
    // reason to render — otherwise an open card (and the always-visible pill)
    // keeps its old-locale text until the next poll happens to land.
    this.#offs.push(EffectBus.on('locale:changed', () => this.#render()))
    this.#render()
  }

  disconnectedCallback(): void {
    // Angular DESTROYED the component here — poll cleared in ngOnDestroy and
    // every signal gone with the instance. Same shape: nothing survives a
    // detach, so a re-mount starts closed and cold rather than resuming a
    // poll nobody asked for.
    if (this.#poll) { clearInterval(this.#poll); this.#poll = null }
    this.#offs.forEach(off => off())
    this.#offs = []
    this.replaceChildren()
    this.#chrome = null
    this.#open = false
    this.#status = null
    this.#busy = false
    this.#message = ''
    this.#domainDraft = ''
  }

  // ── chrome (built once, never rebuilt) ───────────────────────────────
  #build(): void {
    if (this.#chrome) return

    const row = (modifier?: string): HTMLElement => {
      const el = document.createElement('div')
      el.className = modifier ? `host-row ${modifier}` : 'host-row'
      return el
    }
    const span = (className: string): HTMLElement => {
      const el = document.createElement('span')
      el.className = className
      return el
    }
    const button = (className?: string): HTMLButtonElement => {
      const el = document.createElement('button')
      el.type = 'button'
      if (className) el.className = className
      return el
    }

    // The pill is the whole footprint until opened — cold chrome, and the
    // only node that is always in the DOM.
    const pill = button('host-pill')
    pill.addEventListener('click', () => { this.#toggle() })

    const card = document.createElement('section')
    card.className = 'host-card'
    card.setAttribute('role', 'dialog')

    const title = document.createElement('header')
    title.className = 'host-card__title'

    const reading = document.createElement('div')
    reading.className = 'host-message'

    const folderRow = row()
    const folderLabel = span('host-row__label')
    const folderValue = span('host-row__value')
    const choose = button()
    choose.addEventListener('click', () => { void this.#pickFolder() })

    const servingRow = row()
    const servingLabel = span('host-row__label')
    const dot = span('host-dot')
    const servingValue = span('host-row__value')
    const start = button()
    start.addEventListener('click', () => { void this.#startServing() })
    const stop = button()
    stop.addEventListener('click', () => { void this.#stopServing() })

    const hintRow = row('host-row--hint')
    const hintValue = span('host-row__value')
    const getCloudflared = button()
    getCloudflared.addEventListener('click', () => { this.#getCloudflared() })

    const domainRow = row()
    const domainLabel = span('host-row__label')
    const domainInput = document.createElement('input')
    domainInput.type = 'text'
    domainInput.spellcheck = false
    // Angular ran change detection on every keystroke, which is what kept
    // "Go live" enabled/disabled in step with the draft. Re-render on input
    // does the same; the render never writes `value` back unless it actually
    // differs, so the caret stays where the participant put it.
    domainInput.addEventListener('input', () => {
      this.#domainDraft = domainInput.value
      this.#render()
    })

    const actionsRow = row('host-row--actions')
    const login = button()
    login.addEventListener('click', () => { void this.#login() })
    const goOffline = button()
    goOffline.addEventListener('click', () => { void this.#goOffline() })
    const live = button('host-live')
    live.addEventListener('click', () => { this.#openLive() })
    const goLive = button('host-primary')
    goLive.addEventListener('click', () => { void this.#goLive() })

    const message = document.createElement('div')
    message.className = 'host-message'

    // The fixed skeletons — the parts of each row that never come and go.
    place(folderRow, [folderLabel, folderValue, choose])
    place(hintRow, [hintValue, getCloudflared])
    place(domainRow, [domainLabel, domainInput])

    this.#chrome = {
      pill, card, title, reading,
      folderRow, folderLabel, folderValue, choose,
      servingRow, servingLabel, dot, servingValue, start, stop,
      hintRow, hintValue, getCloudflared,
      domainRow, domainLabel, domainInput,
      actionsRow, login, goOffline, live, goLive,
      message,
    }

    // Only the pill mounts now. The card arrives when it is opened.
    this.replaceChildren(pill)
  }

  // ── the gesture ──────────────────────────────────────────────────────
  #toggle(): void {
    this.#open = !this.#open
    if (this.#open) {
      void this.#refresh()
      this.#poll = setInterval(() => { void this.#refresh() }, POLL_MS)
    } else if (this.#poll) {
      clearInterval(this.#poll)
      this.#poll = null
    }
    this.#render()
  }

  /** Re-read the truth from Rust. A failed read leaves the LAST status
   *  standing — a bridge that blinked should not blank the card. */
  async #refresh(): Promise<void> {
    try {
      const status = await invoke('hosting_status') as HostingStatus
      this.#status = status
      if (!this.#domainDraft && status.domain) this.#domainDraft = status.domain
    } catch { /* native bridge gone — leave the last status standing */ }
    this.#render()
  }

  async #pickFolder(): Promise<void> {
    // The folder is chosen in a NATIVE dialog. The renderer never supplies a
    // path and there is no fallback that types one — Rust answers with the
    // folder it accepted, on the very next status read.
    await this.#run(async () => {
      await invoke('hosting_pick_folder')
      return ''
    })
  }

  async #startServing(): Promise<void> {
    await this.#run(async () => {
      const port = await invoke('hosting_serve_start') as number
      return `:${port}`
    })
  }

  async #stopServing(): Promise<void> {
    await this.#run(async () => { await invoke('hosting_serve_stop'); return '' })
  }

  async #login(): Promise<void> {
    await this.#run(async () => { await invoke('hosting_tunnel_login'); return '' })
  }

  async #goLive(): Promise<void> {
    // Read at click time, exactly as the original did — the draft the
    // participant is looking at is the one that goes live.
    const domain = this.#domainDraft.trim()
    await this.#run(async () => await invoke('hosting_go_live', { domain }) as string)
  }

  async #goOffline(): Promise<void> {
    await this.#run(async () => { await invoke('hosting_go_offline'); return '' })
  }

  #openLive(): void {
    const domain = this.#status?.domain
    if (domain) void invoke('open_external', { url: `https://${domain}` })
  }

  #getCloudflared(): void {
    void invoke('open_external', { url: CLOUDFLARED_DOWNLOADS })
  }

  /** Run one action; surface its outcome; re-read the truth from Rust.
   *  The busy latch is the whole concurrency story: a second click while an
   *  IPC call is in flight is dropped, not queued. */
  async #run(action: () => Promise<string>): Promise<void> {
    if (this.#busy) return
    this.#busy = true
    this.#message = ''
    this.#render()
    try {
      this.#message = await action()
    } catch (error) {
      this.#message = String(error)
    } finally {
      this.#busy = false
      this.#render()
      await this.#refresh()
    }
  }

  // ── rendering (mutate the kept nodes — no reconciler, no rebuild) ─────
  #render(): void {
    const c = this.#chrome
    if (!c) return

    // The pill re-resolves its strings on every pass — that is the impure
    // pipe's behaviour, and it is what makes `/language ja` land on chrome
    // that was written once at mount.
    c.pill.textContent = `⬡ ${t('hosting.pill', 'Host')}`
    c.pill.setAttribute('aria-label', t('hosting.title', 'Host this machine'))

    if (!this.#open) {
      // `@if (open())` REMOVED the section. So does this — the card leaves
      // the DOM entirely, keeping its node (and every listener on it) alive
      // for the next open.
      c.card.remove()
      return
    }
    if (c.card.parentNode !== this) this.appendChild(c.card)

    c.card.setAttribute('aria-label', t('hosting.title', 'Host this machine'))
    c.title.textContent = t('hosting.title', 'Host this machine')

    const s = this.#status
    if (!s) {
      // `@if (status(); as s) { … } @else { reading }` — the else arm is the
      // ONLY thing in the card until the first status lands (the action
      // message line lives inside the status arm and is not shown here).
      c.reading.textContent = t('hosting.reading', 'reading hosting state…')
      place(c.card, [c.title, c.reading])
      return
    }

    const rows: HTMLElement[] = [c.title]

    // ── the published folder ──
    c.folderLabel.textContent = t('hosting.folder', 'Folder')
    c.folderValue.textContent = s.folder ?? t('hosting.no-folder', 'no published folder picked yet')
    // `[title]="s.folder ?? ''"` — the full path on hover, never truncated
    // by the ellipsis the value span applies.
    c.folderValue.title = s.folder ?? ''
    c.choose.textContent = t('hosting.choose', 'Choose…')
    c.choose.disabled = this.#busy
    rows.push(c.folderRow)

    // ── the loopback server ──
    c.servingLabel.textContent = t('hosting.serving', 'Serving')
    c.dot.classList.toggle('host-dot--on', s.serving)
    c.servingValue.textContent = s.serving
      ? t('hosting.on-port', 'on port {port}', { port: s.port ?? '' })
      : t('hosting.off', 'off')
    const servingParts: HTMLElement[] = [c.servingLabel, c.dot, c.servingValue]
    if (s.serving) {
      c.stop.textContent = t('hosting.stop', 'Stop')
      c.stop.disabled = this.#busy
      servingParts.push(c.stop)
    } else {
      c.start.textContent = t('hosting.start', 'Start')
      // `busy() || !s.folder` — nothing to serve until a folder is picked.
      c.start.disabled = this.#busy || !s.folder
      servingParts.push(c.start)
    }
    place(c.servingRow, servingParts)
    rows.push(c.servingRow)

    // ── the tunnel ──
    if (!s.cloudflared) {
      // No cloudflared: the domain half of the panel does not exist yet, so
      // the hint REPLACES it rather than sitting beside a dead input.
      c.hintValue.textContent = t('hosting.no-cloudflared',
        'cloudflared is not installed — it connects your domain to this machine.')
      c.getCloudflared.textContent = t('hosting.get-cloudflared', 'Get cloudflared')
      rows.push(c.hintRow)
    } else {
      c.domainLabel.textContent = t('hosting.domain', 'Domain')
      c.domainInput.placeholder = t('hosting.domain-placeholder', 'site.example.com')
      // Angular's `[value]` binding only wrote when the bound value changed;
      // writing an identical string here would still jump the caret to the
      // end, so the guard is load-bearing, not an optimisation.
      if (c.domainInput.value !== this.#domainDraft) c.domainInput.value = this.#domainDraft
      rows.push(c.domainRow)

      c.login.textContent = t('hosting.login', 'Connect Cloudflare…')
      c.login.disabled = this.#busy
      const actions: HTMLElement[] = [c.login]
      if (s.tunnel_running) {
        c.goOffline.textContent = t('hosting.go-offline', 'Go offline')
        c.goOffline.disabled = this.#busy
        // The domain rides in the LABEL only — it is never logged, and the
        // click hands it straight to `open_external`.
        c.live.textContent = t('hosting.live', 'live — {domain}', { domain: s.domain ?? '' })
        actions.push(c.goOffline, c.live)
      } else {
        c.goLive.textContent = t('hosting.go-live', 'Go live')
        c.goLive.disabled = this.#busy || !this.#domainDraft.trim()
        actions.push(c.goLive)
      }
      place(c.actionsRow, actions)
      rows.push(c.actionsRow)
    }

    // ── the outcome line ──
    // `@if (message())` — truthy on a non-empty string. Copied in that
    // direction, never re-derived as a negation.
    if (this.#message) {
      c.message.textContent = this.#message
      rows.push(c.message)
    }

    place(c.card, rows)
  }
}

// ── shell surface registration — the externalization path ────────────────
// DEFINED AT MODULE SCOPE, registered only where the gate opens. A host with
// no ShellSurfaceRegistry (diamond-core-processor mounts tags directly in its
// own template) still needs the tag to be a real element rather than an inert
// unknown one, so the define cannot wait on anything. A defined-but-never-
// registered element is harmless: nothing mounts it.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, HostPanelElement)
}

// THE GATE IS THE FEATURE. The Angular original wrapped registerShellSurface
// in `nativeAvailable()`: on the web shell the file loads and the surface
// simply never appears — there is no `@if`, no feature flag, no hidden panel
// to find. Reproduced exactly, with the same surface name and the same order.
if (nativeAvailable()) {
  window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
    const registry = value as { add(surface: Record<string, unknown>): void }
    registry.add({
      name: SURFACE_NAME,
      owner: '@diamondcoreprocessor.com/HostPanelElement',
      element: SURFACE_NAME,
      order: 460,
    })
  })
}
