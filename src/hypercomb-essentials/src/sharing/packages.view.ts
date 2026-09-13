// sharing/packages.view.ts
//
// <hc-packages> — PACKAGES: one searchable list, yours first.
//
// A package is a named layer of the served tree (core install.types.ts; the
// walk is runtime's, reached through the install port). Every row is a name:
// ON rows load, SHADED rows are held but off. Turn one on and its content is
// there; turn one off and it stops loading. An update mark sits on a row the
// publisher you follow has moved; taking it repoints the head when the bytes
// are already here and fetches only what is missing when they are not.
//
// Looking into a domain is the SAME list scoped to what that domain serves,
// with the search box searching there. Nothing is managed on a domain — you
// find things to turn on. The origin is a domain like any other: nothing is
// pinned first and nothing is called "yours" but the list itself.
//
// A framework-free custom element contributed through the ShellSurfaceRegistry
// (`element:` shape) — never an Angular class, never a tag in app.html. Docks
// on the right through core's docked-panel primitive like every tool window.
// The update notice and `/upgrade` open it (`packages:open`).

import {
  ATTESTATION_IOC_KEY,
  EffectBus,
  I18N_IOC_KEY,
  INSTALL_IOC_KEY,
  attachDockedPanel,
  type DockedPanel,
  type I18nProvider,
  type InstallProvider,
  type InstallUnit,
  type PackageAttestation,
  type WindowSession,
} from '@hypercomb/core'

export const PACKAGES_SURFACE = 'hc-packages'
const OWNER = '@diamondcoreprocessor.com/PackagesView'
const WINDOW_ID = 'packages'
const STYLE_ID = 'hc-packages-style'
const SIG_RE = /^[a-f0-9]{64}$/

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

/** A caption, or its plain-English stand-in — `t()` echoes an unknown key. */
const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const fill = (text: string): string =>
    params ? text.replace(/\{(\w+)\}/g, (whole, name) => String(params[name] ?? whole)) : text
  try {
    const text = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    return text && text !== key ? text : fill(fallback)
  } catch { return fill(fallback) }
}

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

const zoneOf = (raw: unknown): string =>
  String(raw ?? '').trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/\/.*$/, '')

/** Which units a newer root changes, by name — a moved layer, or a new one. */
export const changedUnits = (installed: readonly InstallUnit[], next: readonly InstallUnit[]): Set<string> => {
  const before = new Map(installed.map(unit => [unit.name, unit.layerSig]))
  return new Set(next.filter(unit => before.get(unit.name) !== unit.layerSig).map(unit => unit.name))
}

export interface PackageRow {
  name: string
  description: string
  on: boolean
  held: boolean
  update: boolean
  offered: boolean
}

type Tree = { root: string; units: InstallUnit[] }

/** The rows one scope shows. Pure, so the list can be reasoned about apart
 *  from the DOM: `mine` is the installed tree, `next` the one the followed
 *  publisher names, `tree` the scope on screen (mine, or a domain's head). */
export const packageRows = (input: {
  scope: string
  mine: Tree | null
  next: Tree | null
  tree: Tree | null
  off: ReadonlySet<string>
  query: string
}): PackageRow[] => {
  const { scope, mine, next, tree, off } = input
  if (!tree) return []
  const moved = next && mine ? changedUnits(mine.units, next.units) : new Set<string>()
  const held = new Set(mine?.units.map(u => u.name) ?? [])
  const names = new Map<string, InstallUnit>()
  for (const unit of tree.units) names.set(unit.name, unit)
  if (!scope && next) for (const unit of next.units) if (!names.has(unit.name)) names.set(unit.name, unit)
  const q = input.query.trim().toLowerCase()
  return [...names.values()]
    .filter(unit => !q || unit.name.toLowerCase().includes(q) || unit.description.toLowerCase().includes(q))
    .map(unit => ({
      name: unit.name,
      description: unit.description,
      on: held.has(unit.name) && !off.has(unit.name) && (!scope || tree.root === mine?.root),
      held: held.has(unit.name),
      update: moved.has(unit.name) && (!scope || tree.root === next?.root),
      offered: !!scope && tree.root !== mine?.root,
    }))
    .sort((a, b) => Number(b.on) - Number(a.on) || a.name.localeCompare(b.name))
}

export class PackagesElement extends HTMLElement {

  #panel: HTMLElement | null = null
  #dock: DockedPanel | null = null
  #cleanup: (() => void)[] = []
  #refs = new Map<string, HTMLElement>()

  #scope = ''
  #zones: string[] = []
  #query = ''
  #reading = false
  #busy = ''
  #error = ''
  #restarting = false
  #announced = ''

  #mine: Tree | null = null
  #next: Tree | null = null
  #served = new Map<string, Tree | null>()
  #trees = new Map<string, Promise<Tree | null>>()

  readonly #session: WindowSession = {
    park: () => this.#close(),
    unpark: () => { /* reopened on the next ask */ },
    dismiss: () => false,
    close: () => this.#close(),
  }

  connectedCallback(): void {
    installPackagesStyles()
    facade.current = this
    this.#cleanup.push(
      EffectBus.on<{ zone?: unknown }>('packages:open', (p) => {
        this.#scope = zoneOf(p?.zone)
        this.#error = ''
        this.#open()
        void this.#read()
      }),
      EffectBus.on<{ zones?: unknown }>('hosts:render', (p) => {
        this.#zones = Array.isArray(p?.zones) ? p.zones.map(zoneOf).filter(Boolean) : []
        this.#render()
      }),
      // The followed channel's scout replays its last announcement, so the
      // update marks are right the first time the window opens.
      EffectBus.on<{ available?: boolean; packageSig?: unknown; source?: unknown }>('update:available', (p) => {
        const sig = String(p?.packageSig ?? '').toLowerCase()
        const install = ioc<InstallProvider>(INSTALL_IOC_KEY)
        if (p?.available && p.source === 'channel' && SIG_RE.test(sig) && sig !== install?.installedSig()) this.#announced = sig
        if (this.#panel) void this.#read()
      }),
    )
  }

  disconnectedCallback(): void {
    for (const off of this.#cleanup.splice(0)) off()
    this.#close()
    if (facade.current === this) facade.current = null
  }

  get open(): boolean { return this.#panel !== null }

  // ── the window ───────────────────────────────────────────────────────────

  #open(): void {
    if (this.#panel) { this.#render(); this.#panel.focus({ preventScroll: true }); return }
    const panel = make('aside', 'pk-panel')
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', t('packages.title', 'Packages'))
    panel.setAttribute('data-consumes-wheel', '')
    panel.tabIndex = -1

    const head = make('header', 'pk-head')
    head.append(make('span', 'pk-title', t('packages.title', 'Packages')))
    const close = make('button', 'pk-close', '×')
    close.type = 'button'
    close.setAttribute('aria-label', t('panel.close', 'close'))
    close.addEventListener('click', () => this.#close())
    head.append(close)

    const scopes = make('div', 'pk-scopes')
    scopes.setAttribute('role', 'tablist')
    const search = make('div', 'pk-search')
    const input = make('input', 'pk-input')
    input.type = 'search'
    input.addEventListener('input', () => { this.#query = input.value; this.#renderList() })
    search.append(input)
    const body = make('div', 'pk-body')
    body.setAttribute('data-role', 'packages-body')

    panel.append(head, scopes, search, body)
    this.#refs.set('scopes', scopes).set('input', input).set('body', body)
    this.appendChild(panel)
    this.#panel = panel

    this.#dock = attachDockedPanel(panel, {
      id: WINDOW_ID,
      dockSide: 'right',
      defaultWidth: 340,
      minWidth: 280,
      maxWidth: 560,
      hcSession: this.#session,
      onClose: () => this.#close(),
    })
    this.#render()
    requestAnimationFrame(() => panel.focus({ preventScroll: true }))
  }

  #close(): void {
    this.#dock?.dispose()
    this.#dock = null
    this.#panel?.remove()
    this.#panel = null
    this.#refs.clear()
  }

  // ── what is on screen ────────────────────────────────────────────────────

  #rows(): PackageRow[] {
    const install = ioc<InstallProvider>(INSTALL_IOC_KEY)
    return packageRows({
      scope: this.#scope,
      mine: this.#mine,
      next: this.#next,
      tree: this.#scope ? this.#served.get(this.#scope) ?? null : this.#mine,
      off: install?.offUnits() ?? new Set(),
      query: this.#query,
    })
  }

  #render(): void {
    if (!this.#panel) return
    const scopes = this.#refs.get('scopes')!
    scopes.replaceChildren()
    const chip = (zone: string, label: string): void => {
      const btn = make('button', 'pk-scope', label)
      btn.type = 'button'
      btn.setAttribute('role', 'tab')
      btn.setAttribute('aria-selected', String(this.#scope === zone))
      if (this.#scope === zone) btn.classList.add('selected')
      btn.addEventListener('click', () => { this.#scope = zone; this.#error = ''; this.#render(); void this.#read() })
      scopes.append(btn)
    }
    chip('', t('packages.mine', 'this hive'))
    for (const zone of this.#zones) chip(zone, zone)

    const input = this.#refs.get('input') as HTMLInputElement
    const placeholder = this.#scope
      ? t('packages.search-in', 'Search packages on {host}', { host: this.#scope })
      : t('packages.search', 'Search packages')
    input.placeholder = placeholder
    input.setAttribute('aria-label', placeholder)
    if (input.value !== this.#query) input.value = this.#query

    this.#renderList()
  }

  #renderList(): void {
    const body = this.#refs.get('body')
    if (!body) return
    body.replaceChildren()
    const rows = this.#rows()
    const updates = this.#scope ? 0 : rows.filter(row => row.update && row.on).length

    if (updates) {
      const bar = make('div', 'pk-updates')
      bar.setAttribute('role', 'status')
      bar.append(make('span', '', updates === 1
        ? t('packages.updates.one', '{count} package has an update', { count: updates })
        : t('packages.updates.other', '{count} packages have an update', { count: updates })))
      const take = make('button', 'pk-primary', t('packages.update', 'Update'))
      take.type = 'button'
      take.disabled = !!this.#busy
      take.addEventListener('click', () => { void this.#takeUpdate() })
      bar.append(take)
      body.append(bar)
    }
    if (this.#error) {
      const err = make('p', 'pk-error', this.#error)
      err.setAttribute('role', 'alert')
      body.append(err)
    }
    if (!rows.length) {
      body.append(make('p', 'pk-note', this.#reading
        ? t('packages.reading', 'Reading what is served…')
        : t('packages.empty', 'Nothing listed here yet.')))
      return
    }

    const list = make('ul', 'pk-list')
    for (const row of rows) {
      const li = make('li', 'pk-row')
      if (!row.on) li.classList.add('off')
      if (this.#busy === row.name) li.classList.add('busy')

      const bulb = make('button', 'pk-bulb')
      bulb.type = 'button'
      bulb.setAttribute('role', 'switch')
      bulb.setAttribute('aria-checked', String(row.on))
      const label = row.on
        ? t('packages.turn-off', 'Turn off {name}', { name: row.name })
        : t('packages.turn-on', 'Turn on {name}', { name: row.name })
      bulb.setAttribute('aria-label', label)
      bulb.title = label
      bulb.disabled = !!this.#busy
      const glyph = make('span', 'mat-sym', row.on ? 'lightbulb' : 'lightbulb_outline')
      glyph.setAttribute('aria-hidden', 'true')
      bulb.append(glyph)
      bulb.addEventListener('click', () => { void this.#toggle(row) })

      li.append(bulb, make('span', 'pk-name', row.name))
      if (row.update) li.append(make('span', 'pk-mark', t('packages.update-mark', 'update')))
      if (row.offered && !row.held) li.append(make('span', 'pk-mark quiet', t('packages.new', 'not here yet')))
      if (row.description) li.append(make('span', 'pk-desc', row.description))
      list.append(li)
    }
    body.append(list)
  }

  // ── the acts ─────────────────────────────────────────────────────────────

  /** Turn a package on or off. Held bytes make this a repoint and a restart;
   *  a package only a domain offers is taken from there first, through the
   *  same gate every install passes. */
  async #toggle(row: PackageRow): Promise<void> {
    const install = ioc<InstallProvider>(INSTALL_IOC_KEY)
    if (!install || this.#busy) return
    this.#busy = row.name
    this.#error = ''
    this.#renderList()
    try {
      const off = new Set(install.offUnits())
      if (row.on) off.add(row.name); else off.delete(row.name)
      install.setOffUnits(off)
      if (!row.held) {
        const tree = this.#scope ? this.#served.get(this.#scope) : this.#next
        const root = tree?.root ?? ''
        const outcome = root ? await install.acquire(root, this.#sources()) : { ok: false, error: 'nothing to take' }
        if (!outcome.ok) {
          off.add(row.name)
          install.setOffUnits(off)
          this.#error = outcome.error ?? 'package incomplete'
          return
        }
      } else if (!(await install.applyUnits())) {
        this.#error = 'held tree did not resolve'
        return
      }
      this.#restart()
    } catch (error) {
      this.#error = error instanceof Error ? error.message : 'package could not be applied'
    } finally {
      if (!this.#restarting) { this.#busy = ''; this.#renderList() }
    }
  }

  /** Take the tree the followed publisher names now. Every unit it moved
   *  moves together — one signed root — so this is one act for all marks. */
  async #takeUpdate(): Promise<void> {
    const install = ioc<InstallProvider>(INSTALL_IOC_KEY)
    const next = this.#next
    if (!install || !next || this.#busy) return
    this.#busy = '*'
    this.#error = ''
    this.#renderList()
    try {
      const outcome = await install.acquire(next.root, this.#sources())
      if (!outcome.ok) { this.#error = outcome.error ?? 'package incomplete'; return }
      this.#restart()
    } catch (error) {
      this.#error = error instanceof Error ? error.message : 'update could not be applied'
    } finally {
      if (!this.#restarting) { this.#busy = ''; this.#renderList() }
    }
  }

  #sources(): string[] {
    return [...new Set([this.#scope, ...this.#zones].filter(Boolean))]
  }

  #restart(): void {
    this.#restarting = true
    EffectBus.emit('activity:log', { message: t('packages.restarting', 'packages changed; restarting') })
    setTimeout(() => location.reload(), 400)
  }

  // ── what is served ───────────────────────────────────────────────────────

  async #read(): Promise<void> {
    const install = ioc<InstallProvider>(INSTALL_IOC_KEY)
    if (!install) return
    this.#reading = true
    this.#renderList()
    try {
      const installedSig = install.installedSig()
      if (installedSig && this.#mine?.root !== installedSig) this.#mine = await this.#tree(installedSig, [])
      const namedSig = await this.#namedRoot(installedSig)
      if (namedSig && namedSig !== installedSig) {
        if (this.#next?.root !== namedSig) this.#next = await this.#tree(namedSig, this.#zones)
      } else this.#next = null
      const scope = this.#scope
      if (scope && !this.#served.has(scope)) {
        const head = await install.headOf(scope).catch(() => null)
        this.#served.set(scope, head ? await this.#tree(head, [scope]) : null)
      }
    } finally {
      this.#reading = false
      this.#renderList()
    }
  }

  /** What the followed publisher names: the scout's announcement when there
   *  is one, else the attester's own answer about the installed build. */
  async #namedRoot(installedSig: string | null): Promise<string> {
    if (this.#announced) return this.#announced
    if (!installedSig) return ''
    const attester = ioc<PackageAttestation>(ATTESTATION_IOC_KEY)
    if (typeof attester?.attest !== 'function') return ''
    const verdict = await attester.attest(installedSig, this.#zones).catch(() => null)
    return verdict && !verdict.ok && verdict.reason === 'not-named' && verdict.named ? verdict.named : ''
  }

  #tree(root: string, zones: readonly string[]): Promise<Tree | null> {
    const key = `${root}|${zones.join(',')}`
    let pending = this.#trees.get(key)
    if (!pending) {
      pending = (async () => {
        const install = ioc<InstallProvider>(INSTALL_IOC_KEY)
        const units = install ? await install.unitsOf(root, zones) : []
        return units.length ? { root, units } : null
      })().catch(() => null)
      this.#trees.set(key, pending)
    }
    return pending
  }
}

// ── material ─────────────────────────────────────────────────────────────────
// Restated by ROLE, never by colour (documentation/tool-window-colour-roles.md).
// Shape stays on the ladder: control 2 / card 3, through the shared tokens.

export function installPackagesStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  const S = PACKAGES_SURFACE
  style.textContent = `
${S}{position:fixed;inset:0;z-index:100002;pointer-events:none;display:block;}
${S} .pk-panel{
  --acc:126,182,214;
  --hc-window-accent:rgb(var(--acc));
  --hc-window-on-accent:rgb(var(--hc-panel-pane,253,254,255));
  --pk-ink:var(--hc-window-ink-loud,currentColor);
  --pk-ink-quiet:var(--hc-window-ink-quiet,currentColor);
  --pk-rule:var(--hc-window-line,rgba(128,128,128,0.18));
  --pk-ground:color-mix(in srgb, var(--md-surface,#0d151e) 90%, transparent);
  pointer-events:auto;position:absolute;top:var(--hc-header-anchor,0px);right:0;bottom:0;
  width:340px;min-width:280px;max-width:calc(100vw - 1.5rem);
  display:flex;flex-direction:column;
  font-family:var(--hc-mono,system-ui);font-size:calc(1rem * var(--hc-panel-scale,1));
  color:var(--pk-ink);background:var(--pk-ground);backdrop-filter:blur(10px);
  border-left:1px solid rgba(var(--acc),0.28);outline:none;
}
${S} .pk-head{display:flex;align-items:center;gap:.4em;padding:.55em .7em;border-bottom:1px solid var(--pk-rule);}
${S} .pk-title{flex:1;font-size:.9em;letter-spacing:.05em;color:var(--hc-window-accent);}
${S} .pk-close{background:none;border:none;padding:0 .2em;font:inherit;font-size:1.1em;line-height:1;color:var(--pk-ink-quiet);cursor:pointer;}
${S} .pk-close:hover{color:var(--pk-ink);}
${S} .pk-scopes{display:flex;flex-wrap:wrap;gap:.25em;padding:.5em .7em 0;}
${S} .pk-scope{padding:.25em .5em;font:inherit;font-size:.7em;letter-spacing:.04em;color:var(--pk-ink-quiet);background:none;border:1px solid transparent;border-radius:var(--hc-radius-control,2px);cursor:pointer;}
${S} .pk-scope:hover{color:var(--pk-ink);background:rgba(var(--acc),0.07);}
${S} .pk-scope.selected{color:var(--pk-ink);border-color:rgba(var(--acc),0.45);background:rgba(var(--acc),0.09);}
${S} .pk-search{padding:.45em .7em .2em;}
${S} .pk-input{width:100%;box-sizing:border-box;padding:.3em .45em;font:inherit;font-size:.8em;color:var(--pk-ink);background:rgba(var(--acc),0.06);border:1px solid rgba(var(--acc),0.22);border-radius:var(--hc-radius-control,2px);}
${S} .pk-body{flex:1 1 auto;overflow-y:auto;padding:.3em .7em .8em;}
${S} .pk-updates{display:flex;align-items:center;justify-content:space-between;gap:.5em;margin:.2em 0 .5em;padding:.45em .6em;font-size:.76em;background:rgba(var(--acc),0.1);border:1px solid rgba(var(--acc),0.42);border-radius:var(--hc-radius-card,3px);}
${S} .pk-primary{padding:.38em .8em;font:inherit;font-size:.95em;font-weight:600;color:var(--hc-window-on-accent);background:var(--hc-window-accent);border:1px solid var(--hc-window-accent);border-radius:var(--hc-radius-control,2px);cursor:pointer;}
${S} .pk-primary:disabled{cursor:default;opacity:.55;}
${S} .pk-error{margin:.1em 0 .4em;font-size:.72em;line-height:1.35;color:rgb(217,160,135);}
${S} .pk-note{margin:.5em 0 0;font-size:.74em;line-height:1.45;color:var(--pk-ink-quiet);}
${S} .pk-list{list-style:none;margin:0;padding:0;}
${S} .pk-row{display:grid;grid-template-columns:auto 1fr auto;column-gap:.45em;align-items:center;padding:.32em .2em;border-bottom:1px solid rgba(var(--acc),0.08);}
${S} .pk-row:hover{background:rgba(var(--acc),0.04);}
${S} .pk-row.busy{cursor:progress;}
${S} .pk-bulb{grid-row:1 / span 2;background:none;border:none;padding:.1em;font-size:1em;line-height:1;color:rgb(255,205,100);cursor:pointer;}
${S} .pk-row.off .pk-bulb{color:var(--pk-ink-quiet);}
${S} .pk-bulb:disabled{cursor:default;opacity:.55;}
${S} .pk-name{font-size:.8em;color:var(--pk-ink);}
${S} .pk-row.off .pk-name{color:var(--pk-ink-quiet);}
${S} .pk-mark{justify-self:end;padding:.05em .4em;font-size:.62em;letter-spacing:.06em;text-transform:uppercase;color:rgb(255,205,100);border:1px solid rgba(var(--acc),0.35);border-radius:var(--hc-radius-control,2px);}
${S} .pk-mark.quiet{color:var(--pk-ink-quiet);}
${S} .pk-desc{grid-column:2 / span 2;font-size:.68em;line-height:1.35;color:var(--pk-ink-quiet);}
`
  document.head.appendChild(style)
}

/** The view's IoC face — the element is created by the shell's surface host,
 *  so the registered object forwards to whichever element is mounted. */
const facade = {
  current: null as PackagesElement | null,
  get open(): boolean { return facade.current?.open ?? false },
}

type IocShape = {
  register?: (k: string, v: unknown) => void
  whenReady?: (k: string, cb: (v: { add(s: unknown): void }) => void) => void
}
const hostIoc = (): IocShape | undefined =>
  typeof window === 'undefined' ? undefined : (window as { ioc?: IocShape }).ioc

hostIoc()?.register?.(OWNER, facade)

// Contribute the surface the doctrine way: define the element, then add it to
// the registry — never a tag in either app.html, never an Angular class.
hostIoc()?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', registry => {
    if (!customElements.get(PACKAGES_SURFACE)) customElements.define(PACKAGES_SURFACE, PackagesElement)
    try {
      registry.add({ name: PACKAGES_SURFACE, owner: OWNER, element: PACKAGES_SURFACE, order: 143 })
    } catch {
      // duplicate add (hot reload) — the mounted surface is already live
    }
  })
