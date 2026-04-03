// hypercomb-shared/ui/docs-overlay/docs-overlay.component.ts
//
// Full-viewport documentation browser. Fetches markdown from /documentation/,
// renders to HTML with a lightweight parser, and displays in a clean overlay.
// Activated via `/docs` slash behaviour (listens to EffectBus 'docs:open').

import { Component, signal, computed, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'

interface DocEntry {
  title: string
  file: string
  category: string
}

const DOC_INDEX: DocEntry[] = [
  // Architecture & Core Design
  { category: 'Architecture & Core Design', title: 'Architecture Overview', file: 'architecture-overview.md' },
  { category: 'Architecture & Core Design', title: 'Architecture Critique', file: 'architecture-critique.md' },
  { category: 'Architecture & Core Design', title: 'Core Processor Architecture', file: 'core-processor-architecture.md' },
  { category: 'Architecture & Core Design', title: 'Hive', file: 'hive.md' },
  { category: 'Architecture & Core Design', title: 'Runtime', file: 'runtime.md' },
  { category: 'Architecture & Core Design', title: 'Recommendations', file: 'recommendations.md' },

  // Cryptographic & Content Addressing
  { category: 'Cryptographic & Content Addressing', title: 'Core Primitive', file: 'core-primitive.md' },
  { category: 'Cryptographic & Content Addressing', title: 'Signature Algebra', file: 'signature-algebra.md' },
  { category: 'Cryptographic & Content Addressing', title: 'Signature Expansion Doctrine', file: 'signature-expansion-doctrine.md' },
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
  { category: 'Concepts & Domain Model', title: 'Layer Primitives', file: 'layer-primitives.md' },
  { category: 'Concepts & Domain Model', title: 'LLM Primitive', file: 'llm-primitive.md' },
  { category: 'Concepts & Domain Model', title: 'Emergence', file: 'emergence.md' },

  // UI & Rendering
  { category: 'UI & Rendering', title: 'Cell Rendering', file: 'cell-rendering.md' },
  { category: 'UI & Rendering', title: 'Tile Overlay Architecture', file: 'tile-overlay-architecture.md' },

  // Developer Guides
  { category: 'Developer Guides', title: 'Contributing', file: 'contributing.md' },
  { category: 'Developer Guides', title: 'Command Line Reference', file: 'command-line-reference.md' },
  { category: 'Developer Guides', title: 'Command Line Operations', file: 'command-line-operations.md' },
  { category: 'Developer Guides', title: 'Simple Naming Initiative', file: 'simple-naming-initiative.md' },

  // Infrastructure
  { category: 'Infrastructure', title: 'Dependency Resolution', file: 'dependency-resolution.md' },
  { category: 'Infrastructure', title: 'Infrastructure', file: 'infrastructure.md' },
  { category: 'Infrastructure', title: 'Decentralized Angular Hosting', file: 'decentralized-angular-hosting.md' },
  { category: 'Infrastructure', title: 'Meadowverse Pipeline', file: 'lets-discover-meadowverse-pipeline.md' },

  // Security & Governance
  { category: 'Security & Governance', title: 'Security', file: 'security.md' },
  { category: 'Security & Governance', title: 'Social Governance', file: 'social-governance.md' },
  { category: 'Security & Governance', title: 'Code of Conduct', file: 'code-of-conduct.md' },

  // Legal & Licensing
  { category: 'Legal & Licensing', title: 'License (Source)', file: 'license.md' },
  { category: 'Legal & Licensing', title: 'License (Docs)', file: 'license-docs.md' },
  { category: 'Legal & Licensing', title: 'Trademarks', file: 'trademarks.md' },
  { category: 'Legal & Licensing', title: 'Developer Certificate', file: 'developer-certificate.md' },
  { category: 'Legal & Licensing', title: 'Certificate of Origin', file: 'certificate-of-origin.md' },

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

@Component({
  selector: 'hc-docs-overlay',
  standalone: true,
  templateUrl: './docs-overlay.component.html',
  styleUrls: ['./docs-overlay.component.scss'],
})
export class DocsOverlayComponent implements OnDestroy {

  readonly visible = signal(false)
  readonly sidebarOpen = signal(true)
  readonly activePage = signal<string | null>(null)
  readonly renderedHtml = signal('')
  readonly loading = signal(false)
  readonly filterText = signal('')

  readonly categories = computed(() => {
    const filter = this.filterText().toLowerCase()
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
  })

  #cleanupOpen: (() => void) | undefined
  #cleanupClose: (() => void) | undefined

  constructor() {
    this.#cleanupOpen = EffectBus.on('docs:open', (payload: { page?: string }) => {
      this.visible.set(true)
      if (payload?.page) {
        const match = DOC_INDEX.find(e =>
          e.file === payload.page ||
          e.file === payload.page + '.md' ||
          e.title.toLowerCase() === payload.page!.toLowerCase()
        )
        if (match) this.loadPage(match.file)
      }
    })

    this.#cleanupClose = EffectBus.on('docs:close', () => {
      this.visible.set(false)
    })
  }

  ngOnDestroy(): void {
    this.#cleanupOpen?.()
    this.#cleanupClose?.()
  }

  close(): void {
    this.visible.set(false)
    this.activePage.set(null)
    this.renderedHtml.set('')
  }

  toggleSidebar(): void {
    this.sidebarOpen.update(v => !v)
  }

  onFilter(event: Event): void {
    this.filterText.set((event.target as HTMLInputElement).value)
  }

  async loadPage(file: string): Promise<void> {
    this.activePage.set(file)
    this.loading.set(true)

    // on mobile, auto-close sidebar when a doc is selected
    if (window.innerWidth <= 600) {
      this.sidebarOpen.set(false)
    }

    try {
      const response = await fetch(`/documentation/${file}`)
      if (!response.ok) {
        this.renderedHtml.set(`<p class="doc-error">Failed to load: ${file}</p>`)
        return
      }
      const markdown = await response.text()
      this.renderedHtml.set(renderMarkdown(markdown))
    } catch {
      this.renderedHtml.set(`<p class="doc-error">Failed to load: ${file}</p>`)
    } finally {
      this.loading.set(false)
    }
  }

  backToIndex(): void {
    this.activePage.set(null)
    this.renderedHtml.set('')
    this.sidebarOpen.set(true)
  }
}

// ── lightweight markdown → HTML ──────────────────────────

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
