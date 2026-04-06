// diamondcoreprocessor.com/assistant/wiki.drone.ts
// Core wiki decomposition drone. Listens for wiki:ingest events,
// sends content to an LLM for decomposition, and creates interconnected
// wiki cells with tags, summaries, and relationships.

import { Drone, EffectBus, normalizeCell, hypercomb } from '@hypercomb/core'
import {
  MODELS, API_KEY_STORAGE, getApiKey, callAnthropic,
  GEMINI_API_KEY_STORAGE, getGeminiApiKey, callGemini,
} from './llm-api.js'

const PROPS_FILE = '0000'

const WIKI_BORDER_COLOR = '0.3,0.6,0.9'
const INDEX_BORDER_COLOR = '1.0,0.85,0.0'

const SYSTEM_PROMPT = `You are a knowledge decomposition engine for Hypercomb, a spatial knowledge graph with depth.

Given raw content (articles, notes, documents), extract key concepts and organize them into a HIERARCHICAL tree of wiki nodes. Top-level nodes are broad categories; child nodes are specific details nested inside them.

Return a JSON object:
{
  "nodes": [
    {
      "name": "short 1-4 word label",
      "summary": "10-30 word description",
      "tags": ["category1", "category2"],
      "parent": null,
      "relationships": [
        { "target": "other-node-name", "type": "related|parent|child|see-also" }
      ]
    },
    {
      "name": "specific detail node",
      "summary": "10-30 word description",
      "tags": ["subtopic"],
      "parent": "short 1-4 word label",
      "relationships": [
        { "target": "other-node-name", "type": "related|see-also" }
      ]
    }
  ],
  "enrichments": [
    {
      "name": "existing-node-name",
      "mergedSummary": "enriched 15-40 word description incorporating both the existing summary and new context",
      "newTags": ["additional-tag"],
      "relationships": [
        { "target": "other-node-name", "type": "related|parent|child|see-also" }
      ]
    }
  ],
  "indexSummary": "1-2 sentence summary of the ingested content"
}

Rules:
1. Extract 5-15 new nodes depending on content complexity.
2. Organize nodes into a DEEP HIERARCHY with as many levels as the content warrants. A node's parent can itself be a child of another node. Aim for 3+ levels of depth when the content supports it. For example: "Machine Learning" → "Neural Networks" → "Transformer Architecture" → "Self-Attention Mechanism".
3. Every node must have at least one relationship to another node.
4. Names must be concrete and specific, not vague categories.
5. The "parent" field references the name of another node in this response (at any depth). Top-level nodes have parent: null. A child can be a parent of deeper children.
6. If existing wiki nodes are listed with their summaries, DO NOT recreate them as new nodes. Instead, if the new content adds meaningful context to an existing node, include it in "enrichments" with a mergedSummary that integrates both the old and new understanding.
7. For enrichments, the mergedSummary should be a coherent single description — not a concatenation. Preserve the core meaning of the existing summary while weaving in new perspective.
8. Only enrich nodes where the new content genuinely adds new information. If an existing node is merely mentioned in passing, reference it in relationships instead.
9. Output ONLY the JSON object. No markdown, no wrapping text.`

type WikiIngestPayload = {
  content: string
  source: string
  fileName?: string
}

type WikiNode = {
  name: string
  summary: string
  tags: string[]
  parent?: string | null
  relationships: { target: string; type: string }[]
}

type WikiEnrichment = {
  name: string
  mergedSummary: string
  newTags?: string[]
  relationships: { target: string; type: string }[]
}

type WikiSource = {
  fileName?: string
  sig: string
  addedAt: number
}

type WikiResponse = {
  nodes: WikiNode[]
  enrichments?: WikiEnrichment[]
  indexSummary: string
}

type WikiCellInfo = {
  props: Record<string, unknown>
  parentDir: FileSystemDirectoryHandle
}

export class WikiDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  override description = 'Decomposes dropped documents into interconnected wiki cells via LLM'

  protected override deps = {
    store: '@hypercomb.social/Store',
    lineage: '@hypercomb.social/Lineage',
  }

  protected override listens = ['wiki:ingest']
  protected override emits = [
    'cell:added', 'wiki:indexed',
    'llm:request-start', 'llm:request-done', 'llm:error', 'llm:api-key-required',
  ]

  #effectsRegistered = false
  #busy = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect<WikiIngestPayload>('wiki:ingest', (payload) => {
      void this.#ingest(payload)
    })
  }

  async #ingest(payload: WikiIngestPayload): Promise<void> {
    if (this.#busy) return
    this.#busy = true

    try {
      // ── resolve API key (Gemini first, Anthropic fallback) ──
      const geminiKey = getGeminiApiKey()
      const anthropicKey = getApiKey()
      const useGemini = !!geminiKey

      if (!geminiKey && !anthropicKey) {
        console.warn(
          `[wiki] No API key. Set via:\n` +
          `  localStorage.setItem('${GEMINI_API_KEY_STORAGE}', 'AIza...')  (free)\n` +
          `  localStorage.setItem('${API_KEY_STORAGE}', 'sk-ant-...')`
        )
        EffectBus.emit('llm:api-key-required', {})
        return
      }

      const store = this.resolve<{
        putResource: (blob: Blob) => Promise<string>
      }>('store')
      const lineage = this.resolve<{
        explorerDir: () => Promise<FileSystemDirectoryHandle | null>
      }>('lineage')

      if (!store || !lineage) {
        console.warn('[wiki] Store or Lineage not available')
        return
      }

      const explorerDir = await lineage.explorerDir()
      if (!explorerDir) return

      // ── store raw source ────────────────────────────────
      const sourceBlob = new Blob([payload.content], { type: 'text/plain' })
      const sourceSig = await store.putResource(sourceBlob)

      // ── find existing wiki cells for dedup ──────────────
      const existingWiki = await this.#findWikiCells(explorerDir)
      const existingNames = Array.from(existingWiki.keys())

      // ── build prompt ────────────────────────────────────
      const truncated = payload.content.slice(0, 12_000)
      let userMessage: string

      if (existingNames.length > 0) {
        const existingContext = Array.from(existingWiki.entries())
          .map(([name, info]) => {
            const wiki = (info.props['wiki'] ?? {}) as Record<string, unknown>
            const summary = (wiki['summary'] as string) ?? ''
            const sources = (wiki['sources'] ?? []) as unknown[]
            const count = sources.length || 1
            return `- ${name}: "${summary}" (${count} source${count === 1 ? '' : 's'})`
          })
          .join('\n')

        userMessage = `Decompose this content into wiki nodes. The following wiki entries already exist with their current summaries — integrate with them where relevant. If the new content enriches an existing node's understanding, include it in the "enrichments" array with a merged summary. Do not recreate existing nodes as new nodes.\n\nExisting nodes:\n${existingContext}\n\n---\n${truncated}\n---`
      } else {
        userMessage = `Decompose this content into wiki nodes:\n\n---\n${truncated}\n---`
      }

      // ── call LLM ────────────────────────────────────────
      const model = useGemini ? MODELS['gemini'] : MODELS['sonnet']
      EffectBus.emit('llm:request-start', { model })

      let responseText: string
      if (useGemini) {
        responseText = await callGemini(model, SYSTEM_PROMPT, userMessage, geminiKey!, 8192)
      } else {
        responseText = await callAnthropic(model, SYSTEM_PROMPT, userMessage, anthropicKey!, 8192)
      }

      // ── parse response ──────────────────────────────────
      console.log('[wiki] Raw LLM response:', responseText.slice(0, 500))
      const parsed = this.#extractJson(responseText)
      if (!parsed || !parsed.nodes || parsed.nodes.length === 0) {
        console.warn('[wiki] No nodes extracted from LLM response')
        console.warn('[wiki] Full response:', responseText)
        EffectBus.emit('llm:request-done', { model, success: false })
        return
      }

      // ── create new wiki cells with arbitrary depth ────────
      const createdNodes: WikiNode[] = []

      // Sort nodes so parents are created before children (topological order)
      const sorted = this.#topoSort(parsed.nodes)

      // Track created directory handles by normalized name
      const dirHandles = new Map<string, FileSystemDirectoryHandle>()

      for (const node of sorted) {
        const cellName = normalizeCell(node.name)
        if (!cellName) continue

        if (existingWiki.has(cellName)) {
          const info = existingWiki.get(cellName)!
          await this.#appendRelationships(info.parentDir, cellName, node.relationships)
          // Cache handle for potential children
          try {
            dirHandles.set(cellName, await info.parentDir.getDirectoryHandle(cellName))
          } catch { /* skip */ }
          continue
        }

        // Resolve containing directory: parent's handle if nested, else explorerDir
        let containerDir = explorerDir
        if (node.parent) {
          const parentName = normalizeCell(node.parent)
          if (parentName && dirHandles.has(parentName)) {
            containerDir = dirHandles.get(parentName)!
          } else if (parentName) {
            // Parent might be an existing cell not yet in dirHandles
            try {
              containerDir = await explorerDir.getDirectoryHandle(parentName, { create: true })
              dirHandles.set(parentName, containerDir)
            } catch { /* fall back to explorerDir */ }
          }
        }

        try {
          const cellDir = await containerDir.getDirectoryHandle(cellName, { create: true })
          dirHandles.set(cellName, cellDir)

          const tags = ['wiki', ...(node.tags ?? []).map(t => t.toLowerCase())]
          await this.#writeProps(cellDir, {
            tags,
            'border.color': WIKI_BORDER_COLOR,
            wiki: {
              summary: node.summary,
              relationships: (node.relationships ?? []).map(r => ({
                target: normalizeCell(r.target) || r.target,
                type: r.type,
              })),
              sources: [{
                fileName: payload.fileName,
                sig: sourceSig,
                addedAt: Date.now(),
              }],
              createdAt: Date.now(),
            },
          })

          // Mark container as having children if this is a nested node
          if (node.parent) {
            await this.#writeProps(containerDir, { hasBranch: true })
          }

          EffectBus.emit('cell:added', { cell: cellName })
          createdNodes.push(node)
        } catch (err) {
          console.warn(`[wiki] Failed to create cell "${cellName}":`, err)
        }
      }

      // ── enrich existing wiki cells ────────────────────────
      let enrichedCount = 0
      if (parsed.enrichments && parsed.enrichments.length > 0) {
        for (const enrichment of parsed.enrichments) {
          const cellName = normalizeCell(enrichment.name)
          if (!cellName || !existingWiki.has(cellName)) continue

          const info = existingWiki.get(cellName)!
          await this.#enrichCell(info.parentDir, cellName, enrichment, payload, sourceSig)
          enrichedCount++
        }
      }

      // ── update index ────────────────────────────────────
      await this.#updateIndex(explorerDir, parsed.indexSummary)

      EffectBus.emit('llm:request-done', { model, success: true })
      console.log(`[wiki] Created ${createdNodes.length}, enriched ${enrichedCount} cells from ${payload.fileName ?? 'paste'}`)

      await new hypercomb().act()
    } catch (err: any) {
      EffectBus.emit('llm:error', { message: err?.message ?? 'Unknown error' })
      EffectBus.emit('llm:request-done', { model: '', success: false })
      console.warn('[wiki] Ingestion failed:', err)
    } finally {
      this.#busy = false
    }
  }

  // ── scan existing wiki cells ──────────────────────────────

  async #findWikiCells(dir: FileSystemDirectoryHandle, maxDepth = 4): Promise<Map<string, WikiCellInfo>> {
    const result = new Map<string, WikiCellInfo>()
    await this.#scanWikiCells(dir, result, 0, maxDepth)
    return result
  }

  async #scanWikiCells(
    dir: FileSystemDirectoryHandle,
    result: Map<string, WikiCellInfo>,
    depth: number,
    maxDepth: number,
  ): Promise<void> {
    if (depth > maxDepth) return

    for await (const [name, handle] of (dir as any).entries()) {
      if (handle.kind !== 'directory') continue
      if (name.startsWith('__')) continue
      try {
        const cellDir = handle as FileSystemDirectoryHandle
        const props = await this.#readProps(cellDir)
        const tags = props['tags'] as string[] | undefined
        if (tags?.includes('wiki')) {
          result.set(name, { props, parentDir: dir })
        }

        // Recurse into subdirectories
        await this.#scanWikiCells(cellDir, result, depth + 1, maxDepth)
      } catch { /* skip */ }
    }
  }

  // ── topological sort: parents before children ─────────────

  #topoSort(nodes: WikiNode[]): WikiNode[] {
    const byName = new Map<string, WikiNode>()
    for (const n of nodes) byName.set(normalizeCell(n.name), n)

    const sorted: WikiNode[] = []
    const visited = new Set<string>()

    const visit = (node: WikiNode): void => {
      const name = normalizeCell(node.name)
      if (visited.has(name)) return
      visited.add(name)

      // Visit parent first if it's in this batch
      if (node.parent) {
        const parentName = normalizeCell(node.parent)
        const parentNode = byName.get(parentName)
        if (parentNode) visit(parentNode)
      }

      sorted.push(node)
    }

    for (const node of nodes) visit(node)
    return sorted
  }

  // ── append relationships to existing cell ─────────────────

  async #appendRelationships(
    parentDir: FileSystemDirectoryHandle,
    cellName: string,
    newRels: { target: string; type: string }[],
  ): Promise<void> {
    if (!newRels || newRels.length === 0) return

    try {
      const cellDir = await parentDir.getDirectoryHandle(cellName)
      const props = await this.#readProps(cellDir)
      const wiki = (props['wiki'] ?? {}) as Record<string, unknown>
      const existing = (wiki['relationships'] ?? []) as { target: string; type: string }[]

      const existingTargets = new Set(existing.map(r => r.target))
      const toAdd = newRels
        .map(r => ({ target: normalizeCell(r.target) || r.target, type: r.type }))
        .filter(r => !existingTargets.has(r.target))

      if (toAdd.length === 0) return

      wiki['relationships'] = [...existing, ...toAdd]
      await this.#writeProps(cellDir, { wiki })
    } catch { /* cell might not exist yet */ }
  }

  // ── enrich existing cell with new context ──────────────────

  async #enrichCell(
    parentDir: FileSystemDirectoryHandle,
    cellName: string,
    enrichment: WikiEnrichment,
    payload: WikiIngestPayload,
    sourceSig: string,
  ): Promise<void> {
    try {
      const cellDir = await parentDir.getDirectoryHandle(cellName)
      const props = await this.#readProps(cellDir)
      const wiki = (props['wiki'] ?? {}) as Record<string, unknown>

      // ── merge summary ──
      if (enrichment.mergedSummary) {
        wiki['summary'] = enrichment.mergedSummary
      }

      // ── merge relationships ──
      const existing = (wiki['relationships'] ?? []) as { target: string; type: string }[]
      const existingTargets = new Set(existing.map(r => r.target))
      const newRels = (enrichment.relationships ?? [])
        .map(r => ({ target: normalizeCell(r.target) || r.target, type: r.type }))
        .filter(r => !existingTargets.has(r.target))
      wiki['relationships'] = [...existing, ...newRels]

      // ── multi-source provenance ──
      const sources = (wiki['sources'] ?? []) as WikiSource[]
      const alreadyHasSig = sources.some(s => s.sig === sourceSig)
      if (!alreadyHasSig) {
        sources.push({
          fileName: payload.fileName,
          sig: sourceSig,
          addedAt: Date.now(),
        })
      }
      wiki['sources'] = sources

      // ── migrate legacy singular fields ──
      delete wiki['source']
      delete wiki['fileName']
      delete wiki['sourceSig']

      // ── merge tags ──
      const existingTags = (props['tags'] ?? []) as string[]
      const newTags = (enrichment.newTags ?? []).map(t => t.toLowerCase())
      const mergedTags = [...new Set([...existingTags, ...newTags])]

      // ── knowledge density signal ──
      if (sources.length >= 3 && !mergedTags.includes('hub')) {
        mergedTags.push('hub')
      }

      await this.#writeProps(cellDir, {
        tags: mergedTags,
        wiki,
      })
    } catch (err) {
      console.warn(`[wiki] Failed to enrich cell "${cellName}":`, err)
    }
  }

  // ── update wiki-index cell ────────────────────────────────

  async #updateIndex(dir: FileSystemDirectoryHandle, indexSummary?: string): Promise<void> {
    const allWiki = await this.#findWikiCells(dir)
    const indexName = 'wiki-index'

    const entries: Record<string, { summary: string; connections: number; sourceCount: number }> = {}
    for (const [name, info] of allWiki) {
      if (name === indexName) continue
      const wiki = (info.props['wiki'] ?? {}) as Record<string, unknown>
      const rels = (wiki['relationships'] ?? []) as unknown[]
      const sources = (wiki['sources'] ?? []) as unknown[]
      entries[name] = {
        summary: (wiki['summary'] as string) ?? '',
        connections: rels.length,
        sourceCount: sources.length || 1,
      }
    }

    const entryCount = Object.keys(entries).length
    if (entryCount === 0) return

    const hubCount = Object.values(entries).filter(e => e.sourceCount >= 3).length
    const indexDir = await dir.getDirectoryHandle(indexName, { create: true })
    let summary = indexSummary ?? `Wiki index — ${entryCount} entries`
    if (hubCount > 0) {
      summary += ` (${hubCount} hub${hubCount > 1 ? 's' : ''})`
    }

    await this.#writeProps(indexDir, {
      tags: ['wiki', 'index'],
      'border.color': INDEX_BORDER_COLOR,
      wiki: {
        summary,
        entries,
        lastUpdated: Date.now(),
      },
    })

    EffectBus.emit('cell:added', { cell: indexName })
    EffectBus.emit('wiki:indexed', { indexCell: indexName, nodeCount: entryCount })
  }

  // ── JSON extraction ───────────────────────────────────────

  #extractJson(text: string): WikiResponse | null {
    // Strip markdown code fences
    let cleaned = text.replace(/^```(?:json)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '').trim()

    // Try direct parse
    try {
      const p = JSON.parse(cleaned)
      if (p && Array.isArray(p.nodes)) return p as WikiResponse
    } catch {}

    // Try extracting JSON object from surrounding text
    const objectMatches = cleaned.match(/\{[\s\S]*\}/g) || []
    for (const chunk of objectMatches.sort((a, b) => b.length - a.length)) {
      try {
        const obj = JSON.parse(chunk)
        if (obj && Array.isArray(obj.nodes)) return obj as WikiResponse
      } catch {}
    }

    // Last resort: try fixing common Gemini JSON issues (trailing commas)
    try {
      const fixed = cleaned
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']')
      const match = fixed.match(/\{[\s\S]*\}/)
      if (match) {
        const obj = JSON.parse(match[0])
        if (obj && Array.isArray(obj.nodes)) return obj as WikiResponse
      }
    } catch {}

    return null
  }

  // ── props I/O (same pattern as ConversationDrone) ─────────

  async #readProps(cellDir: FileSystemDirectoryHandle): Promise<Record<string, unknown>> {
    try {
      const fh = await cellDir.getFileHandle(PROPS_FILE)
      const file = await fh.getFile()
      return JSON.parse(await file.text())
    } catch {
      return {}
    }
  }

  async #writeProps(cellDir: FileSystemDirectoryHandle, updates: Record<string, unknown>): Promise<void> {
    const existing = await this.#readProps(cellDir)
    const merged = { ...existing, ...updates }
    const fh = await cellDir.getFileHandle(PROPS_FILE, { create: true })
    const writable = await fh.createWritable()
    try {
      await writable.write(JSON.stringify(merged))
    } finally {
      await writable.close()
    }
  }
}

const _wiki = new WikiDrone()
window.ioc.register('@diamondcoreprocessor.com/WikiDrone', _wiki)
console.log('[WikiDrone] Loaded')
