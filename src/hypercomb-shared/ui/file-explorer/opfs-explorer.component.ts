// hypercomb-shared/ui/file-explorer/opfs-explorer.component.ts

import { CommonModule } from '@angular/common'
import { Component, signal, type OnDestroy } from '@angular/core'
import { FormsModule } from '@angular/forms'
import type { Lineage } from '../../core/lineage'
import { Store } from '../../core/store'
import { hypercomb, requestConfirm, poolMeanings } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import type { ScriptPreloader } from '../../core/script-preloader'
import { LocationParser } from '../../core/initializers/location-parser'
import { RuntimeMediator } from '../runtime-mediator'


interface ExplorerEntry {
  name: string
  label: string
  kind: 'file' | 'directory'
  /** domain key that owns this branch (set at root level) */
  domainKey?: string
  /** root grammar name resolved from the branch */
  rootGrammar?: string
}

interface DomainGroup {
  domain: string
  branches: ExplorerEntry[]
}

@Component({
  selector: 'hc-opfs-explorer',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './opfs-explorer.component.html',
  styleUrls: ['./opfs-explorer.component.scss']
})
export class OpfsExplorerComponent extends hypercomb {

  // -------------------------------------------------
  // constants
  // -------------------------------------------------

  private static readonly SHOW_ALL_KEY = 'opfs-explorer.show-all'
  private static readonly SHOW_ALL_USER_SET_KEY = 'opfs-explorer.show-all.user-set'
  private static readonly LEGACY_SHOW_ALL_KEY = 'opfs-explorer.show-raw'
  private static readonly SHOW_ALL_BOOTSTRAP_V2_KEY = 'opfs-explorer.show-all.bootstrap-v2'
  private static readonly COPY_MAX_BYTES = 250_000
  private static readonly INSTALL_SUFFIX = '-install'
  /** 64-hex signature — names content files, lineage sigbags and pools. */
  private static readonly SIG_RE = /^[0-9a-f]{64}$/
  /** Legacy `__x__` dirs — drain sources only, never live locations. */
  private static readonly LEGACY_DRAIN_RE = /^__.+__$/
  // Pools of meaning are labelled from the core POOL REGISTRY (see
  // #loadPoolMeanings) — seeded with every known meaning and self-extending
  // as modules address new pools. A local list here went stale and showed
  // real pools as unlabelled sig dirs, indistinguishable from lineage bags.
  /** The explorer browses the true OPFS root (`hypercombRoot === opfsRoot`).
   *  The old `'hypercomb.io'` label here named what is now a legacy drain
   *  dir — the path bar shows the root itself, no domain prefix. */
  public domain: string = ''

  // -------------------------------------------------
  // dependencies
  // -------------------------------------------------

  private get lineage(): Lineage { return get('@hypercomb.social/Lineage') as Lineage }
  private get preloader(): ScriptPreloader { return get('@hypercomb.social/ScriptPreloader') as ScriptPreloader }
  private get store(): Store { return get('@hypercomb.social/Store') as Store }

  // note: runtime mediator stays as angular service
  private readonly runtime = new RuntimeMediator()

  // -------------------------------------------------
  // state
  // -------------------------------------------------

  public readonly entries = signal<readonly ExplorerEntry[]>([])
  public readonly domainGroups = signal<readonly DomainGroup[]>([])
  public newName = ''

  /** sign(meaning) → meaning, derived once so pool dirs at the root can
   *  be recognized and labeled by what they hold. */
  readonly #poolMeaningBySig = new Map<string, string>()
  /** Bee labels are sig-addressed (immutable) — cached so the
   *  per-synchronize refresh never re-probes the same root sig files. */
  readonly #labelCache = new Map<string, string | null>()

  public readonly showAll = signal(this.readInitialShowAll())
  public readonly isAtRoot = (): boolean => this.directory() === '/'

  public readonly directory = (): string => this.lineage.explorerLabel()

  private readonly runProcessor = async (): Promise<void> => {
    await this.act()
  }

  private refreshing = false
  private refreshQueued = false

  private readonly requestRefresh = (): void => {
    if (this.refreshing) {
      this.refreshQueued = true
      return
    }

    this.refreshing = true

    void (async () => {
      try {
        do {
          this.refreshQueued = false
          await this.refresh()
        } while (this.refreshQueued)
      } finally {
        this.refreshing = false
      }
    })()
  }

  private readonly onSynchronize = (): void => {
    this.requestRefresh()
  }

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------

  public constructor() {
    super()

    window.addEventListener('synchronize', this.onSynchronize)

    // derive the known pool addresses, then re-label
    void this.#loadPoolMeanings()

    // initial load
    this.requestRefresh()
  }

  #loadPoolMeanings = async (): Promise<void> => {
    for (const [sig, meaning] of await poolMeanings()) {
      this.#poolMeaningBySig.set(sig, meaning)
    }
    this.requestRefresh()  // pool dirs are recognizable now
  }

  /** Legacy `__x__` dirs are drain sources — read-fallback only. */
  #isLegacyDrain = (name: string): boolean =>
    OpfsExplorerComponent.LEGACY_DRAIN_RE.test(name)

  public ngOnDestroy(): void {
    window.removeEventListener('synchronize', this.onSynchronize)
  }

  // -------------------------------------------------
  // template helpers
  // -------------------------------------------------

  public trackByName = (_: number, e: ExplorerEntry): string => e.name

  public icon = (e: ExplorerEntry): string => {
    if (e.kind === 'directory') {
      if (e.name === '..') return '↩'
      // system dirs: sign(meaning) pools and legacy drains
      if (this.#poolMeaningBySig.has(e.name) || this.#isLegacyDrain(e.name)) return '📦'
      return '📁'
    }
    return '📄'
  }

  public toggleShowAll = (): void => {
    const next = !this.showAll()
    this.showAll.set(next)
    localStorage.setItem(OpfsExplorerComponent.SHOW_ALL_USER_SET_KEY, '1')
    localStorage.setItem(OpfsExplorerComponent.SHOW_ALL_KEY, String(next))
    this.requestRefresh()
  }

  // -------------------------------------------------
  // navigation
  // -------------------------------------------------

  public explore = (name: string): void => {
    if (name === '..') {
      this.lineage.explorerUp()
      void this.runProcessorForLocation()
      return
    }

    const row = this.entries().find(e => e.name === name)
    if (!row || row.kind !== 'directory') return

    this.lineage.explorerEnter(name)
    void this.runProcessorForLocation()
  }

  private readonly runProcessorForLocation = async (): Promise<void> => {
    const grammar = this.directory()
    await this.act(grammar)
  }

  // -------------------------------------------------
  // actions
  // -------------------------------------------------

  public run = async (e: ExplorerEntry, ev: MouseEvent): Promise<void> => {
    ev.stopPropagation()

    // wire this back in when ready
    // if (e.kind !== 'file') return
    // const bee = this.preloader.get(e.name)
    // bee?.pulse(e.name)
  }

  public copyDetails = async (e: ExplorerEntry, ev: MouseEvent): Promise<void> => {
    ev.stopPropagation()
    if (e.kind !== 'file') return

    const dir = await this.lineage.explorerDir()
    if (!dir) return

    try {
      const handle = await dir.getFileHandle(e.name, { create: false })
      const file = await handle.getFile()

      if (file.size > OpfsExplorerComponent.COPY_MAX_BYTES) {
        const msg = [
          `file too large to copy (${file.size.toLocaleString()} bytes)`,
          `name: ${e.name}`,
          `label: ${e.label}`,
          `last modified: ${new Date(file.lastModified).toISOString()}`
        ].join('\n')

        await this.writeClipboard(msg)
        return
      }

      const text = await file.text()
      await this.writeClipboard(text)
    } catch (err) {
      console.error('[opfs explorer] copy failed', e.name, err)
    }
  }

  public exploreBranch = (domainKey: string, branchName: string): void => {
    this.lineage.explorerEnter(domainKey)
    this.lineage.explorerEnter(branchName)
    void this.runProcessorForLocation()
  }

  public copyBranch = async (entry: ExplorerEntry, ev: MouseEvent): Promise<void> => {
    ev.stopPropagation()
    await this.copyDetails(entry, ev)
  }

  public remove = async (e: ExplorerEntry, ev: MouseEvent): Promise<void> => {
    ev.stopPropagation()

    // Root-inventory protection: sig-named dirs (lineage sigbags, pools
    // of meaning) and legacy drain dirs are never deletable from the
    // explorer — a recursive removeEntry on one of these is user history
    // or an undrained migration source. Drains disappear on their own
    // once the self-cleaning passes finish.
    if (e.kind === 'directory' && (
      OpfsExplorerComponent.SIG_RE.test(e.name) ||
      this.#isLegacyDrain(e.name) ||
      (this.isAtRoot() && e.name === Store.LEGACY_HYPERCOMB_IO_DIRECTORY)
    )) {
      console.warn('[opfs explorer] refusing to remove protected entry', e.name)
      return
    }

    const confirmed = await requestConfirm({
      title: 'confirm.delete-title',
      message: 'confirm.delete-message',
      messageParams: { name: e.label || e.name },
      danger: true,
    })
    if (!confirmed) return

    const dir = await this.lineage.explorerDir()
    if (!dir) return

    await dir.removeEntry(e.name, { recursive: true })
    void this.runProcessor()
  }

  // -------------------------------------------------
  // refresh
  // -------------------------------------------------

  private readonly refresh = async (): Promise<void> => {
    const pathAtStart = this.lineage.explorerLabel()
    const isStale = (): boolean => this.lineage.explorerLabel() !== pathAtStart

    const dir = await this.lineage.explorerDir()
    if (isStale()) {
      this.refreshQueued = true
      return
    }

    if (!dir) {
      this.entries.set([])
      return
    }

    const out: ExplorerEntry[] = []
    const atRoot = this.directory() === '/'

    if (!atRoot) {
      out.push({ name: '..', label: '..', kind: 'directory' })
    }

    for await (const [name, handle] of dir.entries()) {
      if (this.isHiddenEntry(name, atRoot)) continue

      let label = name

      if (handle.kind === 'directory') {
        // Root inventory under the pools model: sign(meaning) dirs are
        // pools (labeled by their meaning), other sig dirs are lineage
        // sigbags, `__x__` / root-level `hypercomb.io` are legacy drains.
        const meaning = this.#poolMeaningBySig.get(name)
        if (meaning) {
          label = `${meaning} (pool)`
        } else if (OpfsExplorerComponent.SIG_RE.test(name)) {
          label = `${name.slice(0, 16)}… (lineage)`
        } else if (this.#isLegacyDrain(name) ||
                   (atRoot && name === Store.LEGACY_HYPERCOMB_IO_DIRECTORY)) {
          label = `${name} (legacy drain)`
        }
      } else {
        const resourceLabel = await this.resolveResourceLabel(name)
        if (resourceLabel) {
          label = `${name.slice(0, 16)} - ${resourceLabel}`
        } else {
          const resolved = this.preloader.getActionName(name)
          if (resolved) label = resolved
        }
      }

      out.push({ name, label, kind: handle.kind })
    }

    if (isStale()) {
      this.refreshQueued = true
      return
    }

    out.sort((a, b) => {
      if (a.name === '..') return -1
      if (b.name === '..') return 1
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      return a.label.localeCompare(b.label)
    })

    this.entries.set(out)

    // Curated root view (show-all off) groups the domain trees; the raw
    // view (show-all on) lists the true root flat — pools, sigbags and
    // drains labeled — since the grouped template hides flat entries.
    if (atRoot && !this.showAll()) {
      await this.buildDomainGroups(dir, out)
    } else {
      this.domainGroups.set([])
    }
  }

  private readonly buildDomainGroups = async (
    rootDir: FileSystemDirectoryHandle,
    flatEntries: readonly ExplorerEntry[]
  ): Promise<void> => {
    const groups = new Map<string, ExplorerEntry[]>()

    for (const entry of flatEntries) {
      if (entry.name === '..' || entry.kind !== 'directory') continue

      // Never present system dirs as domains: sig dirs (pools of meaning,
      // lineage sigbags), legacy drains, or the legacy i18n dirs.
      if (OpfsExplorerComponent.SIG_RE.test(entry.name)) continue
      if (this.#isLegacyDrain(entry.name)) continue
      if (entry.name === Store.LEGACY_HYPERCOMB_IO_DIRECTORY) continue
      if (entry.name === Store.LEGACY_OVERRIDES_DIRECTORY ||
          entry.name === Store.LEGACY_TRANSLATIONS_DIRECTORY) continue

      let domainDir: FileSystemDirectoryHandle
      try {
        domainDir = await rootDir.getDirectoryHandle(entry.name, { create: false })
      } catch { continue }

      const domainKey = entry.name
      if (!groups.has(domainKey)) groups.set(domainKey, [])
      const branches = groups.get(domainKey)!

      for await (const [childName, childHandle] of domainDir.entries()) {
        if (this.isHiddenEntry(childName, false)) continue

        let rootGrammar = childName
        if (childHandle.kind === 'file') {
          const resolved = this.preloader.getActionName(childName)
          if (resolved) rootGrammar = resolved
        }

        branches.push({
          name: childName,
          label: rootGrammar,
          kind: childHandle.kind,
          domainKey,
          rootGrammar,
        })
      }

      branches.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
        return a.label.localeCompare(b.label)
      })
    }

    this.domainGroups.set(
      Array.from(groups.entries()).map(([domain, branches]) => ({ domain, branches }))
    )
  }

  // -------------------------------------------------
  // create
  // -------------------------------------------------

  public createFolder = async (): Promise<void> => {
    const raw = this.newName.trim()
    if (!raw) return

    // domain root create -> sync pipeline
    if (this.directory() === '/') {
      try {
        await this.runtime.sync(LocationParser.parse(raw))
      } catch (e) {
        console.error(e)
        return
      }

      this.newName = ''
      void this.runProcessor()
      return
    }

    // note: implement non-root folder create when you decide the naming rules
    this.newName = ''
    void this.runProcessor()
  }

  public createFile = async (): Promise<void> => {
    const raw = this.newName.trim()
    if (!raw) return

    const dir = await this.lineage.explorerDir()
    if (!dir) return

    const installName = raw.endsWith(OpfsExplorerComponent.INSTALL_SUFFIX) ? raw : `${raw}${OpfsExplorerComponent.INSTALL_SUFFIX}`
    const handle = await dir.getFileHandle(installName, { create: true })
    const writable = await handle.createWritable()

    try {
      await writable.write('')
    } finally {
      await writable.close()
    }

    this.newName = ''
    void this.runProcessor()
  }

  public addDependency = async (): Promise<void> => {
    const sig = this.newName.trim()
    if (!sig) return

    const bridge = (globalThis as any).__sentinelBridge
    let bytes: ArrayBuffer | null = null

    if (bridge?.fetchContent) {
      try {
        bytes = await bridge.fetchContent(sig, 'dependency', '')
      } catch {
        console.error('[opfs-explorer] sentinel fetch failed for dependency', sig)
      }
    }

    // Fallback to direct fetch only in dev (no sentinel available):
    // flat sig URL first (new delivery layout), then the legacy
    // `__dependencies__/` URL shape while live Azure content is
    // old-layout (until the next deploy).
    if (!bytes && !bridge) {
      const base = 'https://storagehypercomb.blob.core.windows.net/dcp/'
      for (const url of [`${base}${sig}`, `${base}__dependencies__/${sig}`]) {
        try {
          const res = await fetch(url)
          if (res.ok) { bytes = await res.arrayBuffer(); break }
        } catch { /* try the next URL shape */ }
      }
    }

    if (!bytes) {
      console.error('failed to fetch dependency', sig)
      return
    }

    // Write into the sign('dependencies') pool — store.dependencies
    // already points at it. Never the legacy `__dependencies__` dir.
    const depsDir = this.store.dependencies
    if (!depsDir) {
      console.error('[opfs-explorer] dependencies pool unavailable — dependency not stored', sig)
      return
    }

    const fileHandle = await depsDir.getFileHandle(sig, { create: true })
    const writable = await fileHandle.createWritable()

    try {
      await writable.write(bytes)
    } finally {
      await writable.close()
    }

    this.newName = ''
    void this.runProcessor()
  }

  // -------------------------------------------------
  // helpers
  // -------------------------------------------------

  private readonly writeClipboard = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      ta.style.top = '0'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      try {
        document.execCommand('copy')
      } finally {
        document.body.removeChild(ta)
      }
    }
  }

  private readonly isHiddenEntry = (name: string, atRoot: boolean): boolean => {
    if (this.showAll()) return false
    // Legacy `__x__` drains (covers the old name-list: __location__,
    // __bees__, __layers__, __dependencies__, and every other drain).
    if (this.#isLegacyDrain(name)) return true
    if (atRoot && name === Store.LEGACY_HYPERCOMB_IO_DIRECTORY) return true
    // System entries at the unified root: sign(meaning) pools, lineage
    // sigbags and flat content sig files — the curated view shows the
    // domain trees only. Below the root, sig-named entries stay visible.
    if (this.#poolMeaningBySig.has(name)) return true
    if (atRoot && OpfsExplorerComponent.SIG_RE.test(name)) return true
    if (atRoot && (name === Store.LEGACY_OVERRIDES_DIRECTORY ||
                   name === Store.LEGACY_TRANSLATIONS_DIRECTORY)) return true
    if (name.startsWith('install-')) return true
    if (name.endsWith(OpfsExplorerComponent.INSTALL_SUFFIX)) return true
    return false
  }

  private readInitialShowAll(): boolean {
    const userSet = localStorage.getItem(OpfsExplorerComponent.SHOW_ALL_USER_SET_KEY)
    if (userSet !== '1') {
      localStorage.setItem(OpfsExplorerComponent.SHOW_ALL_KEY, 'true')
      return true
    }

    const bootstrapped = localStorage.getItem(OpfsExplorerComponent.SHOW_ALL_BOOTSTRAP_V2_KEY)
    if (bootstrapped !== '1') {
      localStorage.setItem(OpfsExplorerComponent.SHOW_ALL_BOOTSTRAP_V2_KEY, '1')
      localStorage.setItem(OpfsExplorerComponent.SHOW_ALL_KEY, 'true')
      return true
    }

    const current = localStorage.getItem(OpfsExplorerComponent.SHOW_ALL_KEY)
    if (current === 'true') return true
    if (current === 'false') return false

    const legacy = localStorage.getItem(OpfsExplorerComponent.LEGACY_SHOW_ALL_KEY)
    if (legacy === 'true') return true
    if (legacy === 'false') return false

    return true
  }

  private readonly resolveResourceLabel = async (name: string): Promise<string | null> => {
    // Bee bundles are sig-named — skip the probe for anything else.
    if (!OpfsExplorerComponent.SIG_RE.test(name.replace(/\.js$/i, ''))) return null
    const cached = this.#labelCache.get(name)
    if (cached !== undefined) return cached

    let label: string | null = null
    try {
      const file = await this.#readBeeFile(name)
      if (file && file.size > 0) {
        const slice = await file.slice(0, 256).text()
        const firstLine = slice.split('\n')[0]?.trim()
        if (firstLine?.startsWith('// @hypercomb ')) {
          const meta = JSON.parse(firstLine.slice('// @hypercomb '.length))
          if (typeof meta.label === 'string' && meta.label.trim()) {
            label = `${meta.label} – ${new Date(file.lastModified).toLocaleTimeString()}`
          }
        }
      }
    } catch {
      // ignore
    }

    this.#labelCache.set(name, label)
    return label
  }

  /** Sniff a bee bundle by sig: the sign('bees') pool first, then the
   *  legacy `__bees__` drain while it still exists (union read during
   *  the drain window — see the migration brief). */
  #readBeeFile = async (name: string): Promise<File | null> => {
    for (const source of [this.store.bees, this.store.legacyBees]) {
      if (!source) continue
      try {
        const handle = await source.getFileHandle(name, { create: false })
        return await handle.getFile()
      } catch { /* not in this source — keep falling back */ }
    }
    return null
  }
}