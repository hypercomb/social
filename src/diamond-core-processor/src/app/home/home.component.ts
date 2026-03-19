// src/app/home/home.component.ts
import { Component, computed, effect, inject, signal } from '@angular/core'
import { Router } from '@angular/router'
import { TreeResolverService } from '../core/tree-resolver.service'
import { ToggleStateService } from '../core/toggle-state.service'
import { TreeViewComponent } from '../tree-view/tree-view.component'
import { DetailViewComponent } from '../detail/detail-view.component'
import { AuditorSettingsComponent } from '../settings/auditor-settings.component'
import { BeeInspectorComponent } from '../tree-view/bee-inspector.component'
import type { TreeNode } from '../core/tree-node'

const DOMAINS_KEY = 'dcp.domains'

export interface DomainSection {
  domain: string
  domainName: string
  rootSig: string
  items: TreeNode[]
  loading: boolean
  error: string | null
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [TreeViewComponent, DetailViewComponent, AuditorSettingsComponent, BeeInspectorComponent],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent {

  readonly #router = inject(Router)
  readonly #resolver = inject(TreeResolverService)
  readonly #toggleState = inject(ToggleStateService)

  // state
  readonly view = signal<'tree' | 'detail'>('tree')
  readonly domains = signal<string[]>(this.#loadDomains())
  readonly domainInput = signal('')
  readonly searchTerm = signal('')
  readonly sections = signal<DomainSection[]>([])
  readonly activeNode = signal<TreeNode | null>(null)
  readonly inspectBee = signal<string | null>(null)
  readonly inspectSection = signal<DomainSection | null>(null)

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
    if (!term) return this.sections()
    return this.sections()
      .map(s => ({ ...s, items: this.#filterTree(s.items, term) }))
      .filter(s => s.items.length > 0)
  })

  constructor() {
    // auto-load on init
    effect(() => {
      const doms = this.domains()
      if (doms.length) this.#loadAllDomains(doms)
    })
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
    this.sections.set(this.sections().filter(s => s.domain !== domain))
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
    this.#refreshSections()
  }

  onToggle(node: TreeNode): void {
    this.#toggleState.toggle(node.id)
    this.#refreshSections()
  }

  onOpen(node: TreeNode): void {
    if (node.kind === 'bee' && node.signature) {
      const section = this.sections().find(s => this.#containsNode(s.items, node.id))
      this.inspectBee.set(node.signature)
      this.inspectSection.set(section ?? null)
    } else {
      this.activeNode.set(node)
      this.view.set('detail')
    }
  }

  onCloseInspector(): void {
    this.inspectBee.set(null)
    this.inspectSection.set(null)
  }

  onBack(): void {
    this.view.set('tree')
    this.activeNode.set(null)
  }

  // auto-load all domains
  async #loadAllDomains(doms: string[]): Promise<void> {
    const results: DomainSection[] = []

    for (const domain of doms) {
      const domainName = new URL(domain).hostname
      const section: DomainSection = {
        domain, domainName, rootSig: '', items: [], loading: true, error: null
      }
      results.push(section)
    }

    this.sections.set([...results])

    for (const section of results) {
      try {
        const root = await this.#resolver.resolveRoot(section.domain, section.domainName)
        if (root) {
          section.rootSig = root.signature ?? ''
          // use root's children as the section items (skip the root node itself)
          section.items = root.children
        } else {
          section.error = 'No content found'
        }
      } catch (e: unknown) {
        section.error = e instanceof Error ? e.message : 'Failed to load'
      } finally {
        section.loading = false
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

  #loadDomains(): string[] {
    try {
      return JSON.parse(localStorage.getItem(DOMAINS_KEY) ?? '[]')
    } catch {
      return []
    }
  }
}
