// sharing/host-directory.view.ts
//
// <hc-host-directory> — THE HOST DIRECTORY, AND THE SWITCHBOARD IN IT.
//
// One window, opening COLLAPSED on a vertical list of domains: this origin and
// every host you carry, each saying how many packages it carries and whether an
// update is waiting there — the rows with one first, the rest still listed. A
// domain opens into its packages, on or shaded. This origin is every package
// all of your hosts carry; a host is the same list filtered to what it carries,
// with a count beside each row of how many of your hosts carry that SAME
// signature. Nothing switches: on and off are by name path, and a package
// turned off is shaded everywhere it appears.
//
// PACKAGES ARE BRANCHES, AND BRANCHES ARE RECURSIVE. A row with parts inside
// it is walked into — the list becomes its children, with the way back above
// it — so a change deep in the tree is reached by walking down to it and taken
// there, without moving anything beside it.
//
// REVISIONS ARE A DRILL-DOWN. Each row's revisions icon replaces the list with
// that package's revisions, newest first, gathered by signature across every
// host you carry — decoupled from where you looked. Choose one and you are
// back at the list. An older revision that would replace newer parts inside it
// says so first, and sends you to configure those parts one by one; taken
// anyway, the newer parts are hidden, not deleted, until the package is back on
// its latest revision.
//
// A framework-free custom element contributed through the ShellSurfaceRegistry
// (`element:` shape) — never an Angular class, never a tag in app.html. The
// hosts drone owns whether it is open (`hosts:render`) and the host pool
// (`hosts:add`, `hosts:remove`); the install port owns what runs; the static
// peers drone owns the creations a host serves. This file owns none of them.

import {
  ATTESTATION_IOC_KEY,
  EffectBus,
  I18N_IOC_KEY,
  INSTALL_IOC_KEY,
  attachDockedPanel,
  type DockedPanel,
  type I18nProvider,
  type InstallNode,
  type InstallProvider,
  type InstallRevision,
  type InstallSelection,
  type PackageAttestation,
  type WindowSession,
} from '@hypercomb/core'
import { hostZone } from './community-hosts.js'

export const HOST_DIRECTORY_SURFACE = 'hc-host-directory'
const OWNER = '@diamondcoreprocessor.com/HostDirectoryView'
/** The window id the hosts drone asks `isWindowShowing` about. */
export const HOST_DIRECTORY_WINDOW = 'hosts-panel'
const STYLE_ID = 'hc-host-directory-style'
/** Where the directory was when a change restarted the app — read once. */
const REOPEN_KEY = 'hc:hosts:reopen'
const SIG_RE = /^[a-f0-9]{64}$/

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

/** A caption, or its plain-English stand-in — `t()` echoes an unknown key. */
const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const fill = (text: string): string =>
    params ? text.replace(/\{(\w+)\}/g, (whole, name) => String(params[name] ?? whole)) : text
  try {
    const text = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    return text && text !== key && !text.startsWith(`${key}.`) ? text : fill(fallback)
  } catch { return fill(fallback) }
}

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

const button = (className: string, text: string, label = ''): HTMLButtonElement => {
  const node = make('button', className, text)
  node.type = 'button'
  if (label) { node.setAttribute('aria-label', label); node.title = label }
  return node
}

const zoneOf = (raw: unknown): string => hostZone(raw)

// ── the pure part ────────────────────────────────────────────────────────────

const parentOf = (path: string): string =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''

const within = (path: string, ancestor: string): boolean =>
  ancestor === '' || path === ancestor || path.startsWith(`${ancestor}/`)

/** The nearest branch ABOVE a path that is off, or `''`. */
export const offAbove = (path: string, off: ReadonlySet<string>): string => {
  for (let at = parentOf(path); at; at = parentOf(at)) if (off.has(at)) return at
  return ''
}

export type ServedTree = { root: string; nodes: InstallNode[] }

export interface DirectoryRow {
  path: string
  name: string
  description: string
  /** The signature this row shows: what runs here, or what the host carries. */
  layerSig: string
  /** Turned on, and running here. */
  on: boolean
  /** Part of what runs here. */
  held: boolean
  /** The branch above that is off, which has to come on first. */
  blockedBy: string
  /** The publisher you follow has moved it — or something inside it. */
  update: boolean
  /** A revision you picked shapes it. */
  picked: boolean
  /** Newer parts inside it that an older revision is hiding. */
  hidden: number
  /** How many of your hosts carry this same signature at this path. */
  count: number
  children: number
}

/**
 * THE LIST, as data. `scope` is `''` for this origin — the union of what runs
 * here, what the followed publisher names, and every host's head — or a host,
 * for what that host carries. `at` is the branch walked into. A search reaches
 * every depth beneath `at`; without one, the list is `at`'s own children.
 */
export const directoryRows = (input: {
  scope: string
  at: string
  query: string
  running: readonly InstallNode[]
  picks: Readonly<Record<string, { hides: boolean }>>
  eclipsed: readonly string[]
  next: ServedTree | null
  carried: ReadonlyMap<string, ServedTree | null>
  off: ReadonlySet<string>
  moved: ReadonlySet<string> | null
}): DirectoryRow[] => {
  const here = new Map(input.running.map(node => [node.path, node]))
  const nodes = new Map<string, InstallNode>()
  const take = (list: readonly InstallNode[] | undefined): void => {
    for (const node of list ?? []) if (!nodes.has(node.path)) nodes.set(node.path, node)
  }
  if (input.scope) take(input.carried.get(input.scope)?.nodes)
  else { take(input.running); take(input.next?.nodes); for (const tree of input.carried.values()) take(tree?.nodes) }

  const nextAt = new Map((input.next?.nodes ?? []).map(node => [node.path, node.layerSig]))
  const q = input.query.trim().toLowerCase()
  return [...nodes.values()]
    .filter(node => q
      ? node.path !== input.at && within(node.path, input.at)
        && (node.path.toLowerCase().includes(q) || node.description.toLowerCase().includes(q))
      : parentOf(node.path) === input.at)
    .map(node => {
      const held = here.has(node.path)
      const blockedBy = offAbove(node.path, input.off)
      let count = 0
      for (const tree of input.carried.values()) {
        if (tree?.nodes.some(other => other.path === node.path && other.layerSig === node.layerSig)) count++
      }
      const moved = input.moved
        ? input.moved.has(node.path)
        : nextAt.has(node.path) && nextAt.get(node.path) !== here.get(node.path)?.layerSig
      return {
        path: node.path,
        name: node.name,
        description: node.description,
        layerSig: node.layerSig,
        on: held && !input.off.has(node.path) && !blockedBy,
        held,
        blockedBy,
        update: !input.scope && moved,
        picked: !!input.picks[node.path],
        hidden: input.picks[node.path]?.hides
          ? input.eclipsed.filter(path => path !== node.path && within(path, node.path)).length
          : 0,
        count,
        children: node.children.length,
      }
    })
    .sort((a, b) => Number(b.on) - Number(a.on) || a.path.localeCompare(b.path))
}

export interface DomainRow {
  /** `''` for this origin, else the host. */
  zone: string
  label: string
  /** Top-level packages the domain lists. */
  count: number
  /** The build the followed publisher names now is waiting there. */
  update: boolean
}

/**
 * THE DOMAINS, as data — the directory's first screen. This origin carries an
 * update when the followed publisher names a build this hive does not run; a
 * host carries one when that named build is the head it serves. Every domain is
 * listed: a host with nothing new is still a host you carry, and hiding it would
 * read as removed. The ones with an update come first, in their own order.
 */
export const domainRows = (input: {
  homeLabel: string
  zones: readonly string[]
  trunk: string | null
  next: ServedTree | null
  served: ReadonlyMap<string, ServedTree | null>
  count: (zone: string) => number
}): DomainRow[] => {
  const named = input.trunk && input.next && input.next.root !== input.trunk ? input.next.root : ''
  const rows: DomainRow[] = [
    { zone: '', label: input.homeLabel, count: input.count(''), update: !!named },
    ...input.zones.map(zone => ({
      zone,
      label: zone,
      count: input.count(zone),
      update: !!named && input.served.get(zone)?.root === named,
    })),
  ]
  return rows
    .map((row, order) => ({ row, order }))
    .sort((a, b) => Number(b.row.update) - Number(a.row.update) || a.order - b.order)
    .map(({ row }) => row)
}

/** The parts inside a path that one of its revisions would replace: every
 *  descendant running here whose signature that revision does not carry. */
export const replacedBeneath = (path: string, running: readonly InstallNode[], revision: readonly InstallNode[]): string[] => {
  const then = new Map(revision.filter(node => node.path !== path && within(node.path, path)).map(node => [node.path, node.layerSig]))
  return running
    .filter(node => node.path !== path && within(node.path, path) && then.get(node.path) !== node.layerSig)
    .map(node => node.path)
    .sort()
}

/** Is a revision older than the one running? Only when both are listed —
 *  a revision is never called older than something the list cannot place. */
export const isOlder = (revisions: readonly InstallRevision[], chosen: string, running: string): boolean => {
  const at = revisions.findIndex(revision => revision.layer === running)
  const pick = revisions.findIndex(revision => revision.layer === chosen)
  return at >= 0 && pick > at
}

/** The roots to take a revision from, the trunk first when it carries it —
 *  the trunk needs no gate, and taking its own layer is no pick at all. */
export const rootsFor = (revision: InstallRevision, trunk: string | null): string[] => {
  const roots = [...new Set(revision.sources.map(source => source.root))]
  return trunk && roots.includes(trunk) ? [trunk, ...roots.filter(root => root !== trunk)] : roots
}

// ── the element ──────────────────────────────────────────────────────────────

/** Mirrors HostCreationRow (static-peers.drone.ts). `offer` is sent back
 *  exactly as it arrived — only the drone knows how a plate becomes one. */
interface CreationRow {
  name: string
  title: string
  lineage: string
  host: string
  url: string
  publisherLabel: string
  offered: boolean
  offer: unknown | null
}

interface MineRow {
  name: string
  host: string
}

type View = 'domains' | 'list' | 'revisions' | 'creations' | 'mine'

type Warning = { revision: InstallRevision; replaced: string[]; picksBeneath: string[] }

/** The install port, or an older shell's port read as a tree one level deep. */
type Port = {
  install: InstallProvider
  /** Picks, revisions and paths — a shell whose runtime predates them lists
   *  top-level packages and turns them on and off, nothing more. */
  recursive: boolean
}

const port = (): Port | null => {
  const install = ioc<InstallProvider>(INSTALL_IOC_KEY)
  if (!install) return null
  return { install, recursive: typeof install.selection === 'function' && typeof install.pick === 'function' }
}

export class HostDirectoryElement extends HTMLElement {

  #panel: HTMLElement | null = null
  #dock: DockedPanel | null = null
  #cleanup: (() => void)[] = []
  #refs = new Map<string, HTMLElement>()

  /** The hosts drone's word: should the directory be showing? */
  #wanted = false
  #zones: string[] = []
  #loaded = false

  #scope = ''
  #at = ''
  #query = ''
  /** The one row open at a time. */
  #opened = ''
  /** Every fresh open starts collapsed, on the domains. */
  #view: View = 'domains'
  /** The next open continues where an act left off (a restart, a notice)
   *  instead of collapsing. */
  #resume = false

  #selection: InstallSelection | null = null
  #next: ServedTree | null = null
  #announced = ''
  #moved: Set<string> | null = null
  #served = new Map<string, ServedTree | null>()
  #trees = new Map<string, Promise<ServedTree | null>>()
  #reading = false

  #revPath = ''
  #revisions: InstallRevision[] | null = null
  #warning: Warning | null = null

  #creations = new Map<string, { rows: CreationRow[]; answered: boolean }>()
  #mine: MineRow[] = []

  #busy = ''
  #error = ''
  #restarting = false

  /** The domain this app runs on: never offered a Visit — a second tab on
   *  your own hive is a second writer on one store. */
  readonly #home = hostZone(location.host)

  readonly #session: WindowSession = {
    park: () => this.#unmount(),
    unpark: () => { if (this.#wanted) this.#mount() },
    dismiss: () => this.#back(),
    close: () => EffectBus.emit('hosts:close', {}),
  }

  connectedCallback(): void {
    installHostDirectoryStyles()
    facade.current = this
    this.#cleanup.push(
      EffectBus.on<{ open?: boolean; zones?: unknown; loaded?: boolean }>('hosts:render', (p) => {
        this.#zones = Array.isArray(p?.zones) ? p.zones.map(zoneOf).filter(Boolean) : []
        this.#loaded = !!p?.loaded
        if (this.#scope && !this.#zones.includes(this.#scope)) this.#toDomains()
        const wanted = !!p?.open
        if (wanted !== this.#wanted) {
          this.#wanted = wanted
          if (wanted) {
            if (!this.#resume) this.#toDomains()
            this.#resume = false
            this.#mount()
            void this.#read()
          } else this.#unmount()
        } else if (this.#panel) {
          this.#render()
          void this.#read()
        }
      }),
      // The notice, /upgrade and every "packages on this host" door land here.
      EffectBus.on<{ zone?: unknown }>('packages:open', (p) => {
        const zone = zoneOf(p?.zone)
        this.#toList(zone && zone !== this.#home ? zone : '', '')
        this.#resume = true
        if (this.#panel) this.#render()
        EffectBus.emit('hosts:open', {})
      }),
      EffectBus.on<{ available?: boolean; packageSig?: unknown; source?: unknown }>('update:available', (p) => {
        const sig = String(p?.packageSig ?? '').toLowerCase()
        if (p?.available && p.source === 'channel' && SIG_RE.test(sig) && sig !== port()?.install.installedSig()) this.#announced = sig
        if (this.#panel) void this.#read()
      }),
      EffectBus.on<{ zone?: unknown; rows?: CreationRow[]; answered?: boolean }>('hosts:creations:render', (p) => {
        const zone = zoneOf(p?.zone)
        if (!zone) return
        this.#creations.set(zone, { rows: Array.isArray(p?.rows) ? p.rows : [], answered: !!p?.answered })
        if (this.#view === 'creations') this.#renderBody()
      }),
      EffectBus.on<{ offers?: MineRow[] }>('community:offers-render', (p) => {
        this.#mine = Array.isArray(p?.offers) ? p.offers : []
        if (this.#panel) this.#render()
      }),
    )

    // Back where a change restarted the app from: the list it was chosen in.
    try {
      const raw = sessionStorage.getItem(REOPEN_KEY)
      if (raw) {
        sessionStorage.removeItem(REOPEN_KEY)
        const where = JSON.parse(raw) as { scope?: unknown; at?: unknown }
        this.#toList(zoneOf(where.scope), typeof where.at === 'string' ? where.at : '')
        this.#resume = true
        queueMicrotask(() => EffectBus.emit('hosts:open', {}))
      }
    } catch { /* storage unavailable — opens fresh */ }
  }

  disconnectedCallback(): void {
    for (const off of this.#cleanup.splice(0)) off()
    this.#unmount()
    if (facade.current === this) facade.current = null
  }

  get open(): boolean { return this.#panel !== null }

  // ── the window ───────────────────────────────────────────────────────────

  #mount(): void {
    if (this.#panel) { this.#render(); return }
    const panel = make('aside', 'hd-panel')
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', t('hosts.title', 'Host directory'))
    panel.setAttribute('data-consumes-wheel', '')
    panel.tabIndex = -1

    const head = make('header', 'hd-head')
    head.append(make('span', 'hd-title', t('hosts.title', 'Host directory')))
    const close = button('hd-close', '×', t('panel.close', 'close'))
    close.addEventListener('click', () => EffectBus.emit('hosts:close', {}))
    head.append(close)

    const search = make('div', 'hd-search')
    const input = make('input', 'hd-input')
    input.type = 'search'
    input.addEventListener('input', () => { this.#query = input.value; if (this.#view === 'list') this.#renderBody() })
    search.append(input)
    const body = make('div', 'hd-body')

    panel.append(head, search, body)
    this.#refs.set('search', search).set('input', input).set('body', body)
    this.appendChild(panel)
    this.#panel = panel

    this.#dock = attachDockedPanel(panel, {
      id: HOST_DIRECTORY_WINDOW,
      dockSide: 'right',
      defaultWidth: 340,
      minWidth: 280,
      maxWidth: 560,
      launcherControlId: 'hosts',
      hcSession: this.#session,
      onClose: () => EffectBus.emit('hosts:close', {}),
    })
    this.#render()
    requestAnimationFrame(() => panel.focus({ preventScroll: true }))
  }

  #unmount(): void {
    this.#dock?.dispose()
    this.#dock = null
    this.#panel?.remove()
    this.#panel = null
    this.#refs.clear()
  }

  #toDomains(): void {
    this.#scope = ''
    this.#at = ''
    this.#query = ''
    this.#view = 'domains'
    this.#warning = null
    this.#opened = ''
    this.#error = ''
  }

  #toList(scope: string, at: string): void {
    this.#scope = scope
    this.#at = at
    this.#view = 'list'
    this.#warning = null
    this.#opened = ''
    this.#error = ''
  }

  /** Escape unwinds one level: the warning, the drill, the walk, then back to
   *  the domains. On the domains there is nothing left to unwind. */
  #back(): boolean {
    if (this.#warning) { this.#warning = null; this.#renderBody(); return true }
    if (this.#view === 'domains') return false
    if (this.#view !== 'list') { this.#view = 'list'; this.#render(); return true }
    if (this.#at) { this.#at = parentOf(this.#at); this.#opened = ''; this.#renderBody(); return true }
    this.#toDomains()
    this.#render()
    return true
  }

  // ── what is on screen ────────────────────────────────────────────────────

  #rows(scope = this.#scope, at = this.#at, query = this.#query): DirectoryRow[] {
    const selection = this.#selection
    return directoryRows({
      scope,
      at,
      query,
      running: selection?.nodes ?? [],
      picks: selection?.picks ?? {},
      eclipsed: selection?.eclipsed ?? [],
      next: this.#next,
      carried: this.#served,
      off: port()?.install.offUnits() ?? new Set(),
      moved: this.#moved,
    })
  }

  #render(): void {
    if (!this.#panel) return
    const input = this.#refs.get('input') as HTMLInputElement
    const placeholder = this.#scope
      ? t('packages.search-in', 'Search packages on {host}', { host: this.#scope })
      : t('packages.search', 'Search packages')
    input.placeholder = placeholder
    input.setAttribute('aria-label', placeholder)
    if (input.value !== this.#query) input.value = this.#query
    this.#refs.get('search')!.hidden = this.#view !== 'list'
    this.#renderBody()
  }

  #renderDomainList(body: HTMLElement): void {
    const rows = domainRows({
      homeLabel: this.#home || t('packages.mine', 'this hive'),
      zones: this.#zones.filter(zone => zone !== this.#home),
      trunk: this.#selection?.trunk ?? null,
      next: this.#next,
      served: this.#served,
      count: zone => zone ? (this.#served.get(zone) ? this.#rows(zone, '', '').length : 0) : this.#rows('', '', '').length,
    })
    const list = make('ul', 'hd-list')
    for (const row of rows) {
      const li = make('li', `hd-domain-row${row.update ? ' has-update' : ''}`)
      const open = button('hd-domain', '', t('hosts.open-domain', 'Open {host}', { host: row.label }))
      open.append(make('span', 'hd-domain-name', row.label))
      if (row.update) open.append(make('span', 'hd-mark', t('packages.update-mark', 'update')))
      const count = make('span', 'hd-count', row.count ? String(row.count) : '')
      if (row.count) count.title = t('hosts.package-count', '{count} packages', { count: row.count })
      open.append(count, make('span', 'hd-chevron', '›'))
      open.addEventListener('click', () => { this.#toList(row.zone, ''); this.#render() })
      li.append(open)
      list.append(li)
    }
    body.append(list)
    if (this.#reading && rows.every(row => !row.count)) body.append(make('p', 'hd-note', t('packages.reading', 'Reading what is served…')))

    // A domain is added at the end of the list it joins — the hosts drone owns
    // the pool, and the new row arrives on its next render.
    const add = make('form', 'hd-add')
    const field = make('input', 'hd-add-input')
    field.type = 'text'
    field.autocomplete = 'off'
    field.spellcheck = false
    field.placeholder = t('packages.add-placeholder', 'add a domain')
    field.setAttribute('aria-label', t('packages.add', 'Add a domain'))
    const go = make('button', 'hd-quiet', t('packages.add-go', 'Add'))
    go.type = 'submit'
    add.append(field, go)
    add.addEventListener('submit', (event) => {
      event.preventDefault()
      const zone = zoneOf(field.value)
      if (!zone) { field.setAttribute('aria-invalid', 'true'); field.focus(); return }
      field.removeAttribute('aria-invalid')
      EffectBus.emit('hosts:add', { zone })
      field.value = ''
    })
    body.append(add)
  }

  #renderBody(): void {
    const body = this.#refs.get('body')
    if (!body) return
    body.replaceChildren()
    if (this.#view === 'domains') this.#renderDomainList(body)
    else if (this.#view === 'revisions') this.#renderRevisions(body)
    else if (this.#view === 'creations') this.#renderCreations(body)
    else if (this.#view === 'mine') this.#renderMine(body)
    else this.#renderList(body)
  }

  #renderList(body: HTMLElement): void {
    const reach = port()
    const trunk = this.#selection?.trunk ?? null

    // THE WAY BACK: up one level, or to the domains from a domain's top. The
    // domain names the path's first step, so where you are always reads whole.
    const crumbs = make('nav', 'hd-crumbs')
    crumbs.setAttribute('aria-label', t('hosts.path', 'Where you are'))
    const up = button('hd-back', '‹', this.#at ? t('hosts.up', 'Up one level') : t('hosts.domains', 'All domains'))
    up.addEventListener('click', () => {
      if (this.#at) { this.#at = parentOf(this.#at); this.#opened = ''; this.#renderBody() }
      else { this.#toDomains(); this.#render() }
    })
    const domain = button(`hd-crumb${this.#at ? '' : ' here'}`, this.#scope || this.#home || t('packages.mine', 'this hive'))
    domain.addEventListener('click', () => { this.#at = ''; this.#opened = ''; this.#renderBody() })
    crumbs.append(up, domain)
    if (this.#at) {
      const segments = this.#at.split('/')
      segments.forEach((segment, index) => {
        const path = segments.slice(0, index + 1).join('/')
        crumbs.append(make('span', 'hd-sep', '/'))
        const crumb = button(`hd-crumb${path === this.#at ? ' here' : ''}`, segment)
        crumb.addEventListener('click', () => { this.#at = path; this.#opened = ''; this.#renderBody() })
        crumbs.append(crumb)
      })
    }
    body.append(crumbs)

    // THE HOST ITSELF: what else it serves, its own door, and letting it go.
    if (this.#scope) {
      const bar = make('div', 'hd-hostbar')
      const creations = button('hd-link', t('hosts.creations.title', 'Creations on {host}', { host: this.#scope }))
      creations.addEventListener('click', () => {
        this.#view = 'creations'
        this.#render()
        EffectBus.emit('hosts:creations', { zone: this.#scope })
      })
      bar.append(creations)
      if (hostZone(this.#scope) !== this.#home) {
        const visit = make('a', 'hd-link', t('hosts.visit', 'Visit'))
        visit.href = `https://${this.#scope}/`
        visit.target = '_blank'
        visit.rel = 'noopener'
        visit.title = t('hosts.visit-tip', 'Open {host} in a new tab', { host: this.#scope })
        bar.append(visit)
      }
      const remove = button('hd-link hd-remove', '✕', t('hosts.remove', 'Remove {host} from your host directory', { host: this.#scope }))
      remove.addEventListener('click', () => {
        const zone = this.#scope
        this.#toDomains()
        EffectBus.emit('hosts:remove', { zone })
        this.#render()
      })
      bar.append(remove)
      body.append(bar)
    } else if (this.#mine.length) {
      const mine = button('hd-link', t('hosts.mine.open', 'In your hive ({count})', { count: this.#mine.length }))
      mine.addEventListener('click', () => { this.#view = 'mine'; this.#render() })
      const bar = make('div', 'hd-hostbar')
      bar.append(mine)
      body.append(bar)
    }

    // EVERYTHING THE FOLLOWED PUBLISHER MOVED, in one act — at the top only.
    if (!this.#scope && !this.#at && trunk && this.#next && this.#next.root !== trunk) {
      const bar = make('div', 'hd-updates')
      bar.setAttribute('role', 'status')
      bar.append(make('span', '', t('packages.updates.shared', 'An update is ready')))
      const take = button('hd-primary', t('hosts.update-all', 'Update all'))
      take.disabled = !!this.#busy
      take.addEventListener('click', () => { void this.#updateAll() })
      bar.append(take)
      body.append(bar)
    }
    if (reach && !trunk) {
      body.append(make('p', 'hd-note', t('hosts.from-source', 'This shell loads its packages from source, so turning them on or off and picking revisions happens on a hive.')))
    }
    if (this.#error) {
      const err = make('p', 'hd-error', this.#error)
      err.setAttribute('role', 'alert')
      body.append(err)
    }

    const rows = this.#rows()
    if (!rows.length) {
      body.append(make('p', 'hd-note', this.#reading || !this.#loaded
        ? t('packages.reading', 'Reading what is served…')
        : t('packages.empty', 'Nothing listed here yet.')))
      return
    }

    const acts = !!reach && !!trunk
    const recursive = !!reach?.recursive
    const list = make('ul', 'hd-list')
    for (const row of rows) {
      const li = make('li', 'hd-row')
      if (!row.on) li.classList.add('off')
      if (this.#busy === row.path) li.classList.add('busy')

      const bulb = button('hd-bulb', '')
      bulb.setAttribute('role', 'switch')
      bulb.setAttribute('aria-checked', String(row.on))
      const label = row.blockedBy
        ? t('hosts.blocked', 'Turn on {name} first', { name: row.blockedBy })
        : row.on
          ? t('packages.turn-off', 'Turn off {name}', { name: row.path })
          : t('packages.turn-on', 'Turn on {name}', { name: row.path })
      bulb.setAttribute('aria-label', label)
      bulb.title = label
      bulb.disabled = !acts || !!this.#busy || !!row.blockedBy || (!row.held && !recursive)
      const glyph = make('span', 'mat-sym', row.on ? 'lightbulb' : 'lightbulb_outline')
      glyph.setAttribute('aria-hidden', 'true')
      bulb.append(glyph)
      bulb.addEventListener('click', () => { void this.#toggle(row) })

      // THE ACCORDION: a row is a heading, and one opens at a time.
      const opened = this.#opened === row.path
      const name = button('hd-name', this.#query ? row.path : row.name)
      name.setAttribute('aria-expanded', String(opened))
      name.addEventListener('click', () => { this.#opened = opened ? '' : row.path; this.#renderBody() })

      const marks = make('span', 'hd-marks')
      if (row.update) {
        const update = button('hd-mark', t('packages.update-mark', 'update'), t('hosts.update-one', 'Take the update to {name}', { name: row.path }))
        update.disabled = !acts || !recursive || !!this.#busy
        update.addEventListener('click', () => { void this.#takeUpdate(row) })
        marks.append(update)
      }
      if (row.picked) marks.append(make('span', 'hd-mark quiet', t('hosts.picked', 'picked')))
      if (row.hidden) marks.append(make('span', 'hd-mark quiet', t('hosts.hidden-beneath', '{count} newer hidden', { count: row.hidden })))
      if (!row.held) marks.append(make('span', 'hd-mark quiet', t('packages.new', 'not here yet')))

      const count = make('span', 'hd-count', row.count ? String(row.count) : '')
      if (row.count) count.title = t('hosts.carried-by', '{count} of your hosts carry this signature', { count: row.count })

      const revisions = button('hd-icon', '↺', t('hosts.revisions.open', 'Revisions of {name}', { name: row.path }))
      revisions.disabled = !recursive
      revisions.addEventListener('click', () => { void this.#openRevisions(row.path) })

      li.append(bulb, name, marks, count, revisions)
      if (row.children) {
        const walk = button('hd-icon', '›', t('hosts.walk-in', 'Open {name}', { name: row.path }))
        walk.addEventListener('click', () => { this.#at = row.path; this.#opened = ''; this.#query = ''; this.#render() })
        li.append(walk)
      } else li.append(make('span', 'hd-icon-slot'))

      if (opened) {
        li.classList.add('open')
        const detail = make('div', 'hd-detail')
        if (row.description) detail.append(make('p', 'hd-desc', row.description))
        const mine = this.#selection?.nodes.find(node => node.path === row.path)?.layerSig ?? ''
        for (const [zone, tree] of this.#served) {
          const node = tree?.nodes.find(candidate => candidate.path === row.path)
          if (!node) continue
          const same = node.layerSig === mine
          detail.append(make('p', 'hd-where', `${zone} · ${node.layerSig.slice(0, 8)}${same ? ` · ${t('packages.same', 'same as here')}` : ''}`))
        }
        li.append(detail)
      }
      list.append(li)
    }
    body.append(list)
  }

  #renderRevisions(body: HTMLElement): void {
    const path = this.#revPath
    const head = make('div', 'hd-crumbs')
    const back = button('hd-back', '‹', t('hosts.revisions.back', 'Back to the list'))
    back.addEventListener('click', () => { this.#view = 'list'; this.#warning = null; this.#render() })
    head.append(back, make('span', 'hd-drill-title', t('hosts.revisions.title', 'Revisions of {name}', { name: path })))
    body.append(head)
    if (this.#error) {
      const err = make('p', 'hd-error', this.#error)
      err.setAttribute('role', 'alert')
      body.append(err)
    }

    const warning = this.#warning
    if (warning) {
      const box = make('div', 'hd-warning')
      box.setAttribute('role', 'alertdialog')
      box.append(make('p', 'hd-warning-title', t('hosts.downgrade.title', 'An older {name} replaces newer parts inside it', { name: path })))
      const parts = [...new Set([...warning.replaced, ...warning.picksBeneath])].sort()
      const shown = parts.slice(0, 8)
      const list = make('ul', 'hd-warning-list')
      for (const part of shown) list.append(make('li', '', part))
      if (parts.length > shown.length) list.append(make('li', 'quiet', t('hosts.downgrade.more', 'and {count} more', { count: parts.length - shown.length })))
      box.append(list)
      const configure = button('hd-primary', t('hosts.downgrade.configure', 'Configure them one by one'))
      configure.addEventListener('click', () => { this.#toList(this.#scope, path); this.#render() })
      const anyway = button('hd-quiet', t('hosts.downgrade.anyway', 'Take it anyway'))
      anyway.disabled = !!this.#busy
      anyway.addEventListener('click', () => { void this.#pick(path, warning.revision, true) })
      const acts = make('div', 'hd-warning-acts')
      acts.append(configure, anyway)
      box.append(acts, make('p', 'hd-note', t('hosts.downgrade.note', 'Taken anyway, the newer parts are hidden, not deleted, until {name} is on its latest revision again.', { name: path })))
      body.append(box)
    }

    const revisions = this.#revisions
    if (!revisions) { body.append(make('p', 'hd-note', t('hosts.revisions.reading', 'Reading revisions from your hosts…'))); return }
    if (!revisions.length) { body.append(make('p', 'hd-note', t('hosts.revisions.none', 'None of your hosts carries a revision of this.'))); return }

    const trunk = this.#selection?.trunk ?? null
    const running = this.#selection?.nodes.find(node => node.path === path)?.layerSig ?? ''
    const list = make('ul', 'hd-list')
    revisions.forEach((revision, index) => {
      const li = make('li', 'hd-rev')
      const choose = button('hd-rev-choose', '')
      const isRunning = revision.layer === running
      choose.disabled = !trunk || isRunning || !!this.#busy
      if (this.#busy === revision.layer) li.classList.add('busy')
      choose.append(make('span', 'hd-rev-sig', revision.layer.slice(0, 8)))
      if (revision.at) choose.append(make('span', 'hd-rev-at', revision.at.slice(0, 10)))
      const zones = new Set(revision.sources.map(source => source.zone).filter(Boolean))
      choose.append(make('span', 'hd-rev-hosts', zones.size
        ? t('hosts.revisions.hosts', 'on {count} of your hosts', { count: zones.size })
        : t('hosts.revisions.held', 'held here')))
      if (index === 0) choose.append(make('span', 'hd-mark quiet', t('hosts.revisions.latest', 'latest')))
      if (isRunning) choose.append(make('span', 'hd-mark', t('hosts.revisions.running', 'running')))
      choose.setAttribute('aria-label', t('hosts.revisions.take', 'Take revision {sig} of {name}', { sig: revision.layer.slice(0, 8), name: path }))
      choose.addEventListener('click', () => { void this.#chooseRevision(revision) })
      li.append(choose)
      list.append(li)
      if (!trunk) choose.title = t('hosts.from-source', 'This shell loads its packages from source, so turning them on or off and picking revisions happens on a hive.')
    })
    body.append(list)
  }

  #renderCreations(body: HTMLElement): void {
    const zone = this.#scope
    const head = make('div', 'hd-crumbs')
    const back = button('hd-back', '‹', t('hosts.revisions.back', 'Back to the list'))
    back.addEventListener('click', () => { this.#view = 'list'; this.#render() })
    head.append(back, make('span', 'hd-drill-title', t('hosts.creations.title', 'Creations on {host}', { host: zone })))
    body.append(head, make('p', 'hd-note', t('hosts.creations.note', 'What people made on this domain. Showing one puts it in your hive, shaded, until you walk into it.')))

    const known = this.#creations.get(zone)
    if (!known) { body.append(make('p', 'hd-note', t('hosts.probing', 'asking…'))); return }
    if (!known.rows.length) {
      body.append(make('p', 'hd-note', known.answered
        ? t('hosts.creations.none', 'publishes no creations here')
        : t('hosts.creations.silent', 'no ledger at this domain, or it is down')))
      return
    }
    const list = make('ul', 'hd-list')
    for (const row of known.rows) {
      const li = make('li', `hd-creation${row.offered ? ' held' : ''}`)
      const link = make('a', 'hd-creation-name', row.title)
      link.href = row.url
      link.target = '_blank'
      link.rel = 'noopener'
      link.title = t('hosts.creations.visit', 'Open on {host}', { host: row.host })
      li.append(link, make('span', 'hd-creation-by', row.publisherLabel))
      if (row.offer || row.offered) {
        const take = button(`hd-mark${row.offered ? '' : ' quiet'}`,
          row.offered ? t('hosts.creations.shown', 'shown') : t('hosts.creations.show', 'show'),
          row.offered
            ? t('hosts.creations.shown-title', 'Shown in your hive — press to stop showing it', { name: row.title })
            : t('hosts.creations.show-title', 'Show {name} in your hive — it stands shaded until you walk into it', { name: row.title }))
        take.addEventListener('click', () => {
          if (row.offered) EffectBus.emit('community:withdraw', { name: row.name })
          else if (row.offer) EffectBus.emit('community:offer', row.offer)
        })
        li.append(take)
      } else li.append(make('span', 'hd-mark quiet', t('hosts.creations.unheld', 'no verified head')))
      list.append(li)
    }
    body.append(list)
  }

  #renderMine(body: HTMLElement): void {
    const head = make('div', 'hd-crumbs')
    const back = button('hd-back', '‹', t('hosts.revisions.back', 'Back to the list'))
    back.addEventListener('click', () => { this.#view = 'list'; this.#render() })
    head.append(back, make('span', 'hd-drill-title', t('hosts.mine.open', 'In your hive ({count})', { count: this.#mine.length })))
    body.append(head)
    const list = make('ul', 'hd-list')
    for (const row of this.#mine) {
      const li = make('li', 'hd-creation held')
      li.append(make('span', 'hd-creation-name', row.name), make('span', 'hd-creation-by', row.host))
      const shown = button('hd-mark', t('hosts.creations.shown', 'shown'), t('hosts.creations.shown-title', 'Shown in your hive — press to stop showing it', { name: row.name }))
      shown.addEventListener('click', () => EffectBus.emit('community:withdraw', { name: row.name }))
      li.append(shown)
      list.append(li)
    }
    body.append(list, make('p', 'hd-note', t('hosts.mine.note', 'Shown creations stand in your hive, shaded. Walking into one is what takes it.')))
  }

  // ── the acts ─────────────────────────────────────────────────────────────

  /** Turn a package on or off, by path. Held bytes make this a repoint and a
   *  restart; a package only a host carries is picked in from that host first,
   *  through the same gate every install passes. */
  async #toggle(row: DirectoryRow): Promise<void> {
    const reach = port()
    if (!reach || this.#busy || row.blockedBy) return
    const { install } = reach
    this.#busy = row.path
    this.#error = ''
    this.#renderBody()
    const before = new Set(install.offUnits())
    try {
      const off = new Set(before)
      if (row.on) off.add(row.path); else off.delete(row.path)
      install.setOffUnits(off)
      if (!row.held) {
        const tree = this.#carrying(row.path)
        const node = tree?.nodes.find(candidate => candidate.path === row.path)
        const roots = [...this.#served.values()]
          .filter((other): other is ServedTree => !!other && other.nodes.some(n => n.path === row.path && n.layerSig === node?.layerSig))
          .map(other => other.root)
        const outcome = tree && node
          ? await install.pick(row.path, { layer: node.layerSig, root: tree.root, roots }, this.#sources())
          : { ok: false, error: t('hosts.nothing-to-take', 'none of your hosts carries it') }
        if (!outcome.ok) { install.setOffUnits(before); this.#error = outcome.error ?? 'package incomplete'; return }
      } else if (!(await install.applyUnits())) {
        install.setOffUnits(before)
        this.#error = t('hosts.not-held', 'what runs here could not be read back, so nothing changed')
        return
      }
      this.#restart()
    } catch (error) {
      install.setOffUnits(before)
      this.#error = error instanceof Error ? error.message : 'package could not be applied'
    } finally {
      if (!this.#restarting) { this.#busy = ''; this.#renderBody() }
    }
  }

  /** Take the followed publisher's revision of ONE package — nothing beside it moves. */
  async #takeUpdate(row: DirectoryRow): Promise<void> {
    const next = this.#next
    const node = next?.nodes.find(candidate => candidate.path === row.path)
    if (!next || !node) return
    await this.#pick(row.path, { layer: node.layerSig, at: '', sources: [{ root: next.root, zone: '', at: '' }] }, false)
  }

  /** Move the trunk to what the followed publisher names now. Picks stay picked. */
  async #updateAll(): Promise<void> {
    const reach = port()
    const next = this.#next
    if (!reach || !next || this.#busy) return
    this.#busy = '*'
    this.#error = ''
    this.#renderBody()
    try {
      const outcome = await reach.install.acquire(next.root, this.#sources())
      if (!outcome.ok) { this.#error = outcome.error ?? 'package incomplete'; return }
      this.#restart()
    } catch (error) {
      this.#error = error instanceof Error ? error.message : 'update could not be applied'
    } finally {
      if (!this.#restarting) { this.#busy = ''; this.#renderBody() }
    }
  }

  async #openRevisions(path: string): Promise<void> {
    const reach = port()
    if (!reach?.recursive) return
    this.#view = 'revisions'
    this.#revPath = path
    this.#revisions = null
    this.#warning = null
    this.#error = ''
    this.#render()
    const roots = [this.#next?.root ?? '', ...[...this.#served.values()].map(tree => tree?.root ?? '')].filter(root => SIG_RE.test(root))
    const found = await reach.install.revisionsOf(path, this.#sources(), roots).catch(() => [])
    if (this.#view !== 'revisions' || this.#revPath !== path) return
    this.#revisions = found
    this.#renderBody()
  }

  /** A newer revision is taken at once. An older one that would replace newer
   *  parts inside it — or picks made there — asks first. */
  async #chooseRevision(revision: InstallRevision): Promise<void> {
    const reach = port()
    const selection = this.#selection
    const path = this.#revPath
    if (!reach?.recursive || !selection?.trunk || this.#busy) return
    const running = selection.nodes.find(node => node.path === path)?.layerSig ?? ''
    if (revision.layer === running) return
    if (running && isOlder(this.#revisions ?? [], revision.layer, running)) {
      this.#busy = revision.layer
      this.#renderBody()
      const root = rootsFor(revision, selection.trunk)[0] ?? ''
      const nodes = root ? await reach.install.revisionNodes(path, root, this.#sources()).catch(() => []) : []
      this.#busy = ''
      const replaced = replacedBeneath(path, selection.nodes, nodes)
      const picksBeneath = Object.keys(selection.picks).filter(other => other !== path && within(other, path))
      if (replaced.length || picksBeneath.length) {
        this.#warning = { revision, replaced, picksBeneath }
        this.#renderBody()
        return
      }
    }
    await this.#pick(path, revision, false)
  }

  async #pick(path: string, revision: InstallRevision, hides: boolean): Promise<void> {
    const reach = port()
    const trunk = this.#selection?.trunk ?? null
    if (!reach?.recursive || !trunk) return
    const roots = rootsFor(revision, trunk)
    this.#busy = revision.layer
    this.#error = ''
    this.#renderBody()
    try {
      const outcome = await reach.install.pick(path, { layer: revision.layer, root: roots[0] ?? '', roots }, this.#sources(), { hides })
      if (!outcome.ok) { this.#error = outcome.error ?? 'revision could not be taken'; return }
      this.#view = 'list'
      this.#at = parentOf(path)
      this.#warning = null
      this.#restart()
    } catch (error) {
      this.#error = error instanceof Error ? error.message : 'revision could not be taken'
    } finally {
      if (!this.#restarting) { this.#busy = ''; this.#renderBody() }
    }
  }

  /** The tree to take a package from when it does not run here: the host in
   *  view first, then the followed publisher, then any host carrying it. */
  #carrying(path: string): ServedTree | null {
    const has = (tree: ServedTree | null | undefined): tree is ServedTree => !!tree && tree.nodes.some(node => node.path === path)
    if (this.#scope && has(this.#served.get(this.#scope))) return this.#served.get(this.#scope)!
    if (has(this.#next)) return this.#next
    for (const tree of this.#served.values()) if (has(tree)) return tree
    return null
  }

  #sources(): string[] {
    return [...new Set([this.#scope, ...this.#zones].filter(Boolean))]
  }

  #restart(): void {
    this.#restarting = true
    try { sessionStorage.setItem(REOPEN_KEY, JSON.stringify({ scope: this.#scope, at: this.#at })) } catch { /* opens fresh */ }
    EffectBus.emit('activity:log', { message: t('packages.restarting', 'packages changed; restarting') })
    setTimeout(() => location.reload(), 400)
  }

  // ── what is served ───────────────────────────────────────────────────────

  async #read(): Promise<void> {
    const reach = port()
    if (!reach) { this.#render(); return }
    const { install } = reach
    this.#reading = true
    this.#renderBody()
    try {
      this.#selection = await this.#selectionOf(reach)
      const trunk = this.#selection?.trunk ?? null
      const named = await this.#namedRoot(trunk)
      if (named && named !== trunk) {
        if (this.#next?.root !== named) this.#next = await this.#tree(named, this.#zones)
        this.#moved = reach.recursive
          ? new Set(await install.movedPaths(named, this.#zones).catch(() => []))
          : trunk ? new Set(await install.movedUnits(trunk, named, this.#zones).catch(() => [])) : null
      } else { this.#next = null; this.#moved = null }
      this.#render()
      // EVERY host's head, because the list is the union of them — each read
      // once per open and shown as it arrives.
      await Promise.all(this.#zones.map(async zone => {
        if (this.#served.has(zone)) return
        const head = await install.headOf(zone).catch(() => null)
        this.#served.set(zone, head ? await this.#tree(head, [zone]) : null)
        this.#render()
      }))
    } finally {
      this.#reading = false
      this.#render()
    }
  }

  async #selectionOf(reach: Port): Promise<InstallSelection | null> {
    if (reach.recursive) return reach.install.selection().catch(() => null)
    const trunk = reach.install.installedSig()
    const tree = trunk ? await this.#tree(trunk, []) : null
    return { trunk, picks: {}, applied: [], eclipsed: [], nodes: tree?.nodes ?? [] }
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

  #tree(root: string, zones: readonly string[]): Promise<ServedTree | null> {
    const key = `${root}|${zones.join(',')}`
    let pending = this.#trees.get(key)
    if (!pending) {
      pending = (async () => {
        const reach = port()
        if (!reach) return null
        const nodes: InstallNode[] = reach.recursive
          ? await reach.install.nodesOf(root, zones)
          : (await reach.install.unitsOf(root, zones)).map(unit => ({ path: unit.name, name: unit.name, layerSig: unit.layerSig, bees: unit.bees, children: [], description: unit.description, base: unit.layerSig }))
        return nodes.length ? { root, nodes } : null
      })().catch(() => null)
      this.#trees.set(key, pending)
    }
    return pending
  }
}

// ── material ─────────────────────────────────────────────────────────────────
// Restated by ROLE, never by colour (documentation/tool-window-colour-roles.md).
// Shape stays on the ladder: control 2 / card 3, through the shared tokens.

export function installHostDirectoryStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  const S = HOST_DIRECTORY_SURFACE
  style.textContent = `
${S}{position:fixed;inset:0;z-index:100002;pointer-events:none;display:block;}
${S} .hd-panel{
  --acc:126,182,214;
  --hc-window-accent:rgb(var(--acc));
  --hc-window-on-accent:rgb(var(--hc-panel-pane,253,254,255));
  --hd-ink:var(--hc-window-ink-loud,currentColor);
  --hd-ink-quiet:var(--hc-window-ink-quiet,currentColor);
  --hd-rule:var(--hc-window-line,rgba(128,128,128,0.18));
  --hd-ground:color-mix(in srgb, var(--md-surface,#0d151e) 90%, transparent);
  pointer-events:auto;position:absolute;top:var(--hc-header-anchor,0px);right:0;bottom:0;
  width:340px;min-width:280px;max-width:calc(100vw - 1.5rem);
  display:flex;flex-direction:column;
  font-family:var(--hc-mono,system-ui);font-size:calc(1rem * var(--hc-panel-scale,1));
  color:var(--hd-ink);background:var(--hd-ground);backdrop-filter:blur(10px);
  border-left:1px solid rgba(var(--acc),0.28);outline:none;
}
${S} .hd-head{display:flex;align-items:center;gap:.4em;padding:.55em .7em;border-bottom:1px solid var(--hd-rule);}
${S} .hd-title{flex:1;font-size:.9em;letter-spacing:.05em;color:var(--hc-window-accent);}
${S} .hd-close{background:none;border:none;padding:0 .2em;font:inherit;font-size:1.1em;line-height:1;color:var(--hd-ink-quiet);cursor:pointer;}
${S} .hd-close:hover{color:var(--hd-ink);}
${S} .hd-domain-row{border-bottom:1px solid rgba(var(--acc),0.08);}
${S} .hd-domain{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;align-items:center;column-gap:.5em;width:100%;padding:.55em .2em;font:inherit;font-size:.82em;color:var(--hd-ink);background:none;border:none;text-align:left;cursor:pointer;}
${S} .hd-domain:hover{background:rgba(var(--acc),0.05);}
${S} .hd-domain-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
${S} .hd-chevron{color:var(--hd-ink-quiet);}
${S} .hd-add{display:flex;align-items:center;gap:.25em;margin:.7em 0 0;}
${S} .hd-add-input{flex:1 1 auto;min-width:0;padding:.2em .4em;font:inherit;font-size:.7em;color:var(--hd-ink);background:rgba(var(--acc),0.06);border:1px solid rgba(var(--acc),0.22);border-radius:var(--hc-radius-control,2px);}
${S} .hd-add-input[aria-invalid="true"]{border-color:rgba(217,160,135,0.72);}
${S} .hd-quiet{padding:.2em .45em;font:inherit;font-size:.7em;color:var(--hd-ink-quiet);background:none;border:1px solid transparent;border-radius:var(--hc-radius-control,2px);cursor:pointer;}
${S} .hd-quiet:hover{color:var(--hd-ink);background:rgba(var(--acc),0.07);}
${S} .hd-quiet:disabled{cursor:default;opacity:.55;}
${S} .hd-search{padding:.45em .7em .2em;}
${S} .hd-input{width:100%;box-sizing:border-box;padding:.3em .45em;font:inherit;font-size:.8em;color:var(--hd-ink);background:rgba(var(--acc),0.06);border:1px solid rgba(var(--acc),0.22);border-radius:var(--hc-radius-control,2px);}
${S} .hd-body{flex:1 1 auto;overflow-y:auto;padding:.3em .7em .8em;}
${S} .hd-hostbar{display:flex;align-items:center;gap:.7em;margin:.15em 0 .35em;font-size:.72em;}
${S} .hd-link{padding:0;font:inherit;color:var(--hd-ink-quiet);background:none;border:none;text-decoration:none;cursor:pointer;}
${S} .hd-link:hover{color:var(--hd-ink);text-decoration:underline;}
${S} .hd-remove{margin-left:auto;}
${S} .hd-crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:.25em;margin:.15em 0 .4em;font-size:.74em;}
${S} .hd-back{padding:0 .35em;font:inherit;font-size:1.2em;line-height:1;color:var(--hd-ink-quiet);background:none;border:none;cursor:pointer;}
${S} .hd-back:hover,${S} .hd-crumb:hover{color:var(--hd-ink);}
${S} .hd-crumb{padding:0;font:inherit;color:var(--hd-ink-quiet);background:none;border:none;cursor:pointer;}
${S} .hd-crumb.here{color:var(--hd-ink);}
${S} .hd-sep{color:var(--hd-ink-quiet);opacity:.6;}
${S} .hd-drill-title{color:var(--hd-ink);}
${S} .hd-updates{display:flex;align-items:center;justify-content:space-between;gap:.5em;margin:.2em 0 .5em;padding:.45em .6em;font-size:.76em;background:rgba(var(--acc),0.1);border:1px solid rgba(var(--acc),0.42);border-radius:var(--hc-radius-card,3px);}
${S} .hd-primary{padding:.38em .8em;font:inherit;font-size:.95em;font-weight:600;color:var(--hc-window-on-accent);background:var(--hc-window-accent);border:1px solid var(--hc-window-accent);border-radius:var(--hc-radius-control,2px);cursor:pointer;}
${S} .hd-primary:disabled{cursor:default;opacity:.55;}
${S} .hd-error{margin:.1em 0 .4em;font-size:.72em;line-height:1.35;color:rgb(217,160,135);}
${S} .hd-note{margin:.5em 0 0;font-size:.72em;line-height:1.45;color:var(--hd-ink-quiet);}
${S} .hd-list{list-style:none;margin:0;padding:0;}
${S} .hd-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto auto auto;column-gap:.4em;align-items:center;padding:.3em .2em;border-bottom:1px solid rgba(var(--acc),0.08);}
${S} .hd-row:hover{background:rgba(var(--acc),0.04);}
${S} .hd-row.busy{cursor:progress;}
${S} .hd-bulb{background:none;border:none;padding:.1em;font-size:1em;line-height:1;color:rgb(255,205,100);cursor:pointer;}
${S} .hd-row.off .hd-bulb{color:var(--hd-ink-quiet);}
${S} .hd-bulb:disabled{cursor:default;opacity:.55;}
${S} .hd-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.8em;color:var(--hd-ink);background:none;border:none;padding:0;font-family:inherit;text-align:left;cursor:pointer;}
${S} .hd-name:hover{text-decoration:underline;}
${S} .hd-row.off .hd-name{color:var(--hd-ink-quiet);}
${S} .hd-marks{display:inline-flex;gap:.25em;}
${S} .hd-mark{padding:.05em .4em;font:inherit;font-size:.62em;letter-spacing:.06em;text-transform:uppercase;color:rgb(255,205,100);background:none;border:1px solid rgba(var(--acc),0.35);border-radius:var(--hc-radius-control,2px);}
${S} button.hd-mark{cursor:pointer;}
${S} button.hd-mark:disabled{cursor:default;opacity:.55;}
${S} .hd-mark.quiet{color:var(--hd-ink-quiet);}
${S} .hd-count{min-width:1.2em;font-size:.62em;text-align:center;color:var(--hd-ink-quiet);}
${S} .hd-icon{padding:0 .25em;font:inherit;font-size:.9em;line-height:1;color:var(--hd-ink-quiet);background:none;border:none;cursor:pointer;}
${S} .hd-icon:hover{color:var(--hd-ink);}
${S} .hd-icon:disabled{cursor:default;opacity:.35;}
${S} .hd-icon-slot{width:.9em;}
${S} .hd-detail{grid-column:2 / -1;padding:.15em 0 .3em;}
${S} .hd-desc{margin:0 0 .2em;font-size:.68em;line-height:1.35;color:var(--hd-ink-quiet);}
${S} .hd-where{margin:.1em 0;font-size:.66em;line-height:1.35;color:var(--hd-ink-quiet);}
${S} .hd-rev{border-bottom:1px solid rgba(var(--acc),0.08);}
${S} .hd-rev.busy{cursor:progress;}
${S} .hd-rev-choose{display:flex;align-items:center;gap:.6em;width:100%;padding:.4em .2em;font:inherit;font-size:.74em;color:var(--hd-ink);background:none;border:none;text-align:left;cursor:pointer;}
${S} .hd-rev-choose:hover:not(:disabled){background:rgba(var(--acc),0.06);}
${S} .hd-rev-choose:disabled{cursor:default;}
${S} .hd-rev-sig{font-variant-numeric:tabular-nums;}
${S} .hd-rev-at,${S} .hd-rev-hosts{color:var(--hd-ink-quiet);}
${S} .hd-rev-hosts{margin-right:auto;}
${S} .hd-warning{margin:.2em 0 .6em;padding:.5em .6em;font-size:.76em;border:1px solid rgba(217,160,135,0.55);border-radius:var(--hc-radius-card,3px);}
${S} .hd-warning-title{margin:0 0 .3em;color:var(--hd-ink);}
${S} .hd-warning-list{margin:0 0 .5em;padding-left:1.1em;color:var(--hd-ink-quiet);}
${S} .hd-warning-list .quiet{list-style:none;}
${S} .hd-warning-acts{display:flex;align-items:center;gap:.5em;}
${S} .hd-creation{display:grid;grid-template-columns:minmax(0,1fr) auto auto;column-gap:.5em;align-items:center;padding:.3em .2em;border-bottom:1px solid rgba(var(--acc),0.08);font-size:.78em;}
${S} .hd-creation-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--hd-ink);text-decoration:none;}
${S} a.hd-creation-name:hover{text-decoration:underline;}
${S} .hd-creation-by{font-size:.85em;color:var(--hd-ink-quiet);}
`
  document.head.appendChild(style)
}

/** The view's IoC face — the element is created by the shell's surface host,
 *  so the registered object forwards to whichever element is mounted. */
const facade = {
  current: null as HostDirectoryElement | null,
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
  if (!customElements.get(HOST_DIRECTORY_SURFACE)) customElements.define(HOST_DIRECTORY_SURFACE, HostDirectoryElement)
  try {
    registry.add({ name: HOST_DIRECTORY_SURFACE, owner: OWNER, element: HOST_DIRECTORY_SURFACE, order: 144 })
  } catch {
    // duplicate add (hot reload) — the mounted surface is already live
  }
})
