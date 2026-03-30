// diamond-core-processor/src/app/home/home.component.ts

import { Component, computed, effect, inject, signal } from '@angular/core'
import { TreeResolverService } from '../core/tree-resolver.service'
import { ToggleStateService } from '../core/toggle-state.service'
import { PatchStore, type PatchRecord } from '../core/patch-store'
import { PackageExportService } from '../core/package-export.service'
import { TreeViewComponent } from '../tree-view/tree-view.component'
import { AuditorSettingsComponent } from '../settings/auditor-settings.component'
import { BeeInspectorComponent } from '../tree-view/bee-inspector.component'
import { DiamondIconComponent } from '../tree-view/diamond-icon.component'
import { PatchListComponent } from '../patch-list/patch-list.component'
import { DcpCommandLineComponent } from '../command-line/dcp-command-line.component'
import type { PatchResult } from '../core/merkle-patch.service'
import type { BeeDocEntry, TreeNode, TreeNodeKind } from '../core/tree-node'

const DOMAINS_KEY = 'dcp.domains'

export interface DomainSection {
  domain: string
  domainName: string
  rootSig: string
  originalRootSig: string
  items: TreeNode[]
  loading: boolean
  error: string | null
  installStatus: string | null
  patches: PatchRecord[]
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [TreeViewComponent, AuditorSettingsComponent, BeeInspectorComponent, DiamondIconComponent, PatchListComponent, DcpCommandLineComponent],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent {

  readonly #resolver = inject(TreeResolverService)
  readonly #toggleState = inject(ToggleStateService)
  readonly #patchStore = inject(PatchStore)
  readonly #exporter = inject(PackageExportService)

  // state
  readonly domains = signal<string[]>(this.#loadDomains())
  readonly domainInput = signal('')
  readonly searchTerm = signal('')
  readonly sections = signal<DomainSection[]>([])
  readonly inspectBee = signal<string | null>(null)
  readonly inspectKind = signal<TreeNodeKind>('bee')
  readonly kindFilters = signal<Set<string>>(new Set())
  readonly layersCollapsed = signal(false)
  readonly #savedExpandStates = new Map<string, boolean>()
  readonly filterKinds: { key: string, diamond: TreeNodeKind }[] = [
    { key: 'bee', diamond: 'bee' },
    { key: 'worker', diamond: 'worker' },
    { key: 'dependency', diamond: 'dependency' }
  ]
  readonly inspectSection = signal<DomainSection | null>(null)
  readonly inspectDoc = signal<BeeDocEntry | undefined>(undefined)
  readonly inspectLineage = signal('')
  readonly inspectMode = signal<'code' | 'detail'>('code')
  readonly selectedNodeNames = signal<string[]>([])

  // flat list of all nodes for command line suggestions
  readonly allNodes = computed(() => {
    const result: TreeNode[] = []
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        result.push(n)
        walk(n.children)
      }
    }
    for (const s of this.sections()) walk(s.items)
    return result
  })

  // all nodes flattened for toggle lookups
  readonly toggleMap = computed(() => {
    const map = new Map<string, boolean>()
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        map.set(n.id, this.#toggleState.isEnabled(n.id))
        walk(n.children)
      }
    }
    for (const s of this.sections()) walk(s.items)
    return map
  })

  readonly nodeMap = computed(() => {
    const map = new Map<string, TreeNode>()
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        map.set(n.id, n)
        walk(n.children)
      }
    }
    for (const s of this.sections()) walk(s.items)
    return map
  })

  readonly filteredSections = computed(() => {
    const term = this.searchTerm().toLowerCase().trim()
    const active = this.kindFilters()
    let sections = this.sections()

    if (term) {
      sections = sections
        .map(s => ({ ...s, items: this.#filterTree(s.items, term) }))
        .filter(s => s.items.length > 0)
    }

    if (active.size > 0) {
      const kindSet = new Set<TreeNodeKind>()
      if (active.has('bee')) { kindSet.add('bee'); kindSet.add('drone') }
      if (active.has('worker')) kindSet.add('worker')
      if (active.has('dependency')) kindSet.add('dependency')
      sections = sections
        .map(s => ({ ...s, items: this.#flattenByKind(s.items, kindSet) }))
        .filter(s => s.items.length > 0)
    }

    return sections
  })

  constructor() {
    // auto-load on init
    effect(() => {
      const doms = this.domains()
      if (doms.length) this.#loadAllDomains(doms)
    })
  }

  // kind filter toggles
  toggleKindFilter(key: string): void {
    const next = new Set(this.kindFilters())
    if (next.has(key)) next.delete(key)
    else next.add(key)
    this.kindFilters.set(next)
  }

  isKindActive(key: string): boolean {
    return this.kindFilters().has(key)
  }

  isFiltering(): boolean {
    return this.kindFilters().size > 0
  }

  // command line bridge
  onFilterTerm(term: string): void {
    this.searchTerm.set(term)
  }

  onKindFilter(kinds: Set<string>): void {
    this.kindFilters.set(kinds)
  }

  onSelectedNames(names: string[]): void {
    this.selectedNodeNames.set(names)
  }

  toggleCollapseAllLayers(): void {
    const sections = this.sections()
    if (!this.layersCollapsed()) {
      this.#savedExpandStates.clear()
      for (const s of sections) for (const top of s.items) this.#walkLayers(top.children, (node) => {
        this.#savedExpandStates.set(node.id, node.expanded)
        node.expanded = false
      })
      this.layersCollapsed.set(true)
    } else {
      for (const s of sections) for (const top of s.items) this.#walkLayers(top.children, (node) => {
        const saved = this.#savedExpandStates.get(node.id)
        if (saved !== undefined) node.expanded = saved
      })
      this.#savedExpandStates.clear()
      this.layersCollapsed.set(false)
    }
    this.#refreshSections()
  }

  // domain management
  addDomain(): void {
    const raw = this.domainInput().trim()
    if (!raw) return

    try {
      const url = new URL(raw)
      const scope = url.pathname && url.pathname !== '/'
        ? `${url.origin}${url.pathname.replace(/\/+$/, '')}`
        : url.origin

      if (this.domains().includes(scope)) {
        this.domainInput.set('')
        return
      }

      const next = [...this.domains(), scope]
      this.domains.set(next)
      localStorage.setItem(DOMAINS_KEY, JSON.stringify(next))
      this.domainInput.set('')
    } catch {
      // ignore invalid urls
    }
  }

  removeDomain(domain: string): void {
    const next = this.domains().filter(d => d !== domain)
    this.domains.set(next)
    localStorage.setItem(DOMAINS_KEY, JSON.stringify(next))
    const remaining = this.sections().filter(s => s.domain !== domain)
    this.sections.set(remaining)

    // clear search/filter state if no sections remain
    if (remaining.length === 0) {
      this.searchTerm.set('')
      this.kindFilters.set(new Set())
      this.layersCollapsed.set(false)
    }
  }

  // tree interactions
  async onExpandToggle(node: TreeNode): Promise<void> {
    if (node.expanded) {
      node.expanded = false
      this.#refreshSections()
      return
    }

    if (!node.loaded) {
      const section = this.sections().find(s =>
        this.#containsNode(s.items, node.id)
      )
      if (section) {
        await this.#resolver.expandNode(node, section.domain, section.rootSig, section.domainName)
      }
    }

    node.expanded = true
    if (node.kind === 'layer' && this.layersCollapsed()) {
      this.layersCollapsed.set(false)
      this.#savedExpandStates.clear()
    }
    this.#refreshSections()
  }

  onToggle(node: TreeNode): void {
    this.#toggleState.toggle(node.id)
    this.#refreshSections()
  }

  onOpen(node: TreeNode): void {
    if ((node.kind === 'bee' || node.kind === 'worker' || node.kind === 'drone' || node.kind === 'dependency') && node.signature) {
      this.#openInspector(node, 'code')
    } else {
      this.onExpandToggle(node)
    }
  }

  onOpenDetail(node: TreeNode): void {
    if ((node.kind === 'bee' || node.kind === 'worker' || node.kind === 'drone' || node.kind === 'dependency') && node.signature) {
      this.#openInspector(node, 'detail')
    }
  }

  // patch handling
  async onPatchApplied(result: PatchResult): Promise<void> {
    const section = this.inspectSection()
    if (!section) return

    // record the patch
    await this.#patchStore.record(section.domainName, {
      originalFileSig: result.originalSig,
      newFileSig: result.newFileSig,
      originalRootSig: section.rootSig,
      newRootSig: result.newRootSig,
      kind: result.kind,
      lineage: result.lineage,
      timestamp: Date.now(),
      cascadedLayers: result.cascadedLayers
    })

    // reload patches for this domain
    section.patches = await this.#patchStore.list(section.domainName)

    // switch to new root
    await this.#switchSectionRoot(section, result.newRootSig)

    // close inspector
    this.onCloseInspector()
  }

  async onSwitchRoot(section: DomainSection, rootSig: string): Promise<void> {
    await this.#patchStore.setActiveRoot(section.domainName, rootSig)
    await this.#switchSectionRoot(section, rootSig)
  }

  async downloadPackage(section: DomainSection): Promise<void> {
    await this.#exporter.exportPackage(section.rootSig, section.domainName)
  }

  /**
   * Promote a branch (layer) to its own package root within the same domain.
   * Creates a new DomainSection using the branch signature as root.
   */
  async promoteBranchToPackage(node: TreeNode, sourceSection: DomainSection): Promise<void> {
    if (!node.signature || node.kind !== 'layer') return

    const branchSig = node.signature

    // check if already promoted
    if (this.sections().some(s => s.rootSig === branchSig)) return

    // resolve the subtree from local OPFS using the branch as root
    const root = await this.#resolver.resolveFromLocal(branchSig, sourceSection.domainName)
    if (!root) return

    const section: DomainSection = {
      domain: sourceSection.domain,
      domainName: sourceSection.domainName,
      rootSig: branchSig,
      originalRootSig: branchSig,
      items: root.children,
      loading: false,
      error: null,
      installStatus: null,
      patches: []
    }

    this.sections.set([...this.sections(), section])
  }

  #openInspector(node: TreeNode, mode: 'code' | 'detail'): void {
    const section = this.sections().find(s => this.#containsNode(s.items, node.id))
    this.inspectBee.set(node.signature!)
    this.inspectKind.set(node.kind)
    this.inspectSection.set(section ?? null)
    this.inspectDoc.set(node.doc)
    this.inspectLineage.set(node.lineage)
    this.inspectMode.set(mode)
  }

  onCloseInspector(): void {
    this.inspectBee.set(null)
    this.inspectKind.set('bee')
    this.inspectSection.set(null)
    this.inspectDoc.set(undefined)
    this.inspectLineage.set('')
  }

  onNavigateSig(sig: string): void {
    // find a node with this signature in any section
    for (const section of this.sections()) {
      const node = this.#findNodeBySig(section.items, sig)
      if (node) {
        this.onOpen(node)
        return
      }
    }
  }

  onNavigateDep(iocKey: string): void {
    // extract class name from IoC key (e.g. "@domain.com/ClassName" → "ClassName")
    const className = iocKey.includes('/') ? iocKey.slice(iocKey.lastIndexOf('/') + 1) : iocKey
    // humanize: PascalCase → "lower case words" to match tree node names
    const humanized = className
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .toLowerCase()
    for (const section of this.sections()) {
      const node = this.#findNodeByClassName(section.items, className, humanized)
      if (node) {
        this.#openInspector(node, 'detail')
        return
      }
    }
  }

  async #switchSectionRoot(section: DomainSection, rootSig: string): Promise<void> {
    section.loading = true
    section.rootSig = rootSig
    this.#refreshSections()

    try {
      const root = await this.#resolver.resolveFromLocal(rootSig, section.domainName)
      if (root) {
        section.items = root.children
        section.rootSig = root.signature ?? rootSig
      } else {
        section.error = 'Failed to resolve patched tree'
      }
    } catch (e: unknown) {
      section.error = e instanceof Error ? e.message : 'Failed to load patched tree'
    } finally {
      section.loading = false
    }

    this.#refreshSections()
  }

  #findNodeBySig(nodes: TreeNode[], sig: string): TreeNode | null {
    for (const n of nodes) {
      if (n.signature === sig) return n
      const found = this.#findNodeBySig(n.children, sig)
      if (found) return found
    }
    return null
  }

  #findNodeByClassName(nodes: TreeNode[], className: string, humanized: string): TreeNode | null {
    for (const n of nodes) {
      if (n.doc?.className === className || n.name === className || n.name === humanized) return n
      const found = this.#findNodeByClassName(n.children, className, humanized)
      if (found) return found
    }
    return null
  }

  // auto-load all domains — each root signature in the manifest becomes its own section
  async #loadAllDomains(doms: string[]): Promise<void> {
    const results: DomainSection[] = []

    for (const domain of doms) {
      const domainName = new URL(domain).hostname

      // fetch all root signatures from the manifest
      const rootSigs = await this.#resolver.fetchAllRootSignatures(domain)

      if (rootSigs.length === 0) {
        // no packages found — show placeholder with error
        results.push({
          domain, domainName, rootSig: '', originalRootSig: '', items: [],
          loading: false, error: 'No packages found in manifest', installStatus: null, patches: []
        })
        continue
      }

      // create a section per root signature
      for (const rootSig of rootSigs) {
        results.push({
          domain, domainName, rootSig, originalRootSig: rootSig, items: [],
          loading: true, error: null, installStatus: null, patches: []
        })
      }
    }

    this.sections.set([...results])

    // load each section in parallel
    for (const section of results) {
      if (!section.rootSig) continue

      try {
        const root = await this.#resolver.resolveRoot(section.domain, section.rootSig, section.domainName, (p) => {
          section.installStatus = `Installing ${p.phase} ${p.current}/${p.total}`
          this.sections.set([...results])
        })
        if (root) {
          section.rootSig = root.signature ?? section.rootSig
          section.originalRootSig = root.signature ?? section.originalRootSig
          section.items = root.children

          // load patches and check for active patched root
          section.patches = await this.#patchStore.list(section.domainName)
          const activeRoot = await this.#patchStore.activeRoot(section.domainName)
          if (activeRoot && activeRoot !== section.rootSig) {
            // hot-swap to the active patched root
            const patched = await this.#resolver.resolveFromLocal(activeRoot, section.domainName)
            if (patched) {
              section.rootSig = patched.signature ?? activeRoot
              section.items = patched.children
            }
          }
        } else {
          section.error = 'No content found'
        }
      } catch (e: unknown) {
        section.error = e instanceof Error ? e.message : 'Failed to load'
      } finally {
        section.loading = false
        section.installStatus = null
      }
      this.sections.set([...results])
    }
  }

  #containsNode(nodes: TreeNode[], id: string): boolean {
    for (const n of nodes) {
      if (n.id === id) return true
      if (this.#containsNode(n.children, id)) return true
    }
    return false
  }

  #walkLayers(nodes: TreeNode[], fn: (node: TreeNode) => void): void {
    for (const node of nodes) {
      if (node.kind === 'layer') fn(node)
      this.#walkLayers(node.children, fn)
    }
  }

  #refreshSections(): void {
    this.sections.set([...this.sections()])
  }

  #filterTree(nodes: TreeNode[], term: string): TreeNode[] {
    const result: TreeNode[] = []
    for (const node of nodes) {
      const nameMatch = node.name.toLowerCase().includes(term)
      const filteredChildren = this.#filterTree(node.children, term)

      if (nameMatch || filteredChildren.length > 0) {
        result.push({
          ...node,
          children: nameMatch ? node.children : filteredChildren,
          expanded: filteredChildren.length > 0 ? true : node.expanded
        })
      }
    }
    return result
  }

  #filterByKind(nodes: TreeNode[], active: Set<TreeNodeKind>): TreeNode[] {
    const result: TreeNode[] = []
    for (const node of nodes) {
      const filteredChildren = this.#filterByKind(node.children, active)
      if (active.has(node.kind) || filteredChildren.length > 0) {
        result.push({ ...node, children: filteredChildren.length ? filteredChildren : node.children })
      }
    }
    return result
  }

  #flattenByKind(nodes: TreeNode[], kinds: Set<TreeNodeKind>): TreeNode[] {
    const result: TreeNode[] = []
    const walk = (items: TreeNode[]) => {
      for (const node of items) {
        if (kinds.has(node.kind)) {
          result.push({ ...node, depth: 0, children: [], expanded: false })
        }
        walk(node.children)
      }
    }
    walk(nodes)
    return result
  }

  #loadDomains(): string[] {
    try {
      return JSON.parse(localStorage.getItem(DOMAINS_KEY) ?? '[]')
    } catch {
      return []
    }
  }
}
