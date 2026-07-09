// diamondcoreprocessor.com/move/layout.queen.ts

import { QueenBee, EffectBus, hypercomb } from '@hypercomb/core'
import { childNamesOfStrict, resolveCurrentLayer, type PlacementHistory } from '../history/layer-placement.js'
import { writeTilePropertiesAt } from '../editor/tile-properties.js'
import type { LayoutService } from './layout.service.js'

/**
 * /layout — save, apply, list, or remove layout templates.
 *
 * A layout template is a stored array of `[label]/move(index)` commands —
 * the grammar is the same whether a human types it or a drone replays it.
 *
 * Syntax:
 *   /layout save my-grid       — save current tile positions as "my-grid"
 *   /layout apply my-grid      — apply saved layout "my-grid"
 *   /layout my-grid            — shorthand for apply
 *   /layout list               — list available layouts
 *   /layout remove my-grid     — remove a saved layout
 */

// LEGACY per-level sidecar dir of saved layout templates. Opened create:false
// only (read / enumerate / remove) — a drain-source fallback, never created.
// New saves are pending the optimization-substrate rewire (see #save).
const LAYOUTS_DIR = '__layouts__'

export type LayoutTemplate = {
  readonly name: string
  readonly order: string[]
  readonly commands: string[]
}

export class LayoutQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'movement'
  readonly command = 'layout'
  override readonly aliases = []
  override description = 'Save, apply, list, or remove layout templates'
  override descriptionKey = 'slash.layout'
  override options = ['save <name>', 'apply <name>', '<name>', 'list', 'remove <name>']
  override examples = [
    { input: '/layout my-grid', result: 'Applies the saved layout "my-grid"' },
    { input: '/layout list', result: 'Lists available layouts' },
  ]

  override slashComplete(args: string): readonly string[] {
    const subcommands = ['save', 'apply', 'list', 'remove']
    const q = args.toLowerCase().trim()
    if (!q) return subcommands
    return subcommands.filter(s => s.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const parsed = parseLayoutArgs(args)

    switch (parsed.action) {
      case 'save': return this.#save(parsed.name)
      case 'apply': return this.#apply(parsed.name)
      case 'list': return this.#list()
      case 'remove': return this.#remove(parsed.name)
    }
  }

  // ── save ────────────────────────────────────────────────

  async #save(name: string): Promise<void> {
    if (!name) return

    const dir = await this.#explorerDir()
    if (!dir) return

    const layout = get('@diamondcoreprocessor.com/LayoutService') as LayoutService | undefined
    if (!layout) return

    // read current tile order
    const order = await layout.read(dir)
    if (!order || order.length === 0) return

    // express as command template — the grammar IS the storage format
    const commands = order.map((label, i) => `[${label}]/move(${i})`)

    const template: LayoutTemplate = { name, order, commands }

    // Layouts are decorations — they belong in the optimization substrate
    // (the sign('optimization') pool), not as per-level `__layouts__/`
    // sidecar folders. The legacy save site minted a sidecar dir at the
    // current explorer depth; under the layer-primitive doctrine that's a
    // parallel store. PENDING re-wire: write through the optimization
    // substrate keyed by the current lineage sig.
    void template
    console.warn('[layout] save: optimization-substrate write path pending; layout not persisted')
    EffectBus.emit('layout:saved', { name, count: order.length })
  }

  // ── apply ───────────────────────────────────────────────

  async #apply(name: string): Promise<void> {
    if (!name) return

    const dir = await this.#explorerDir()
    if (!dir) return

    const layout = get('@diamondcoreprocessor.com/LayoutService') as LayoutService | undefined
    if (!layout) return

    let template: LayoutTemplate
    try {
      const layoutsDir = await dir.getDirectoryHandle(LAYOUTS_DIR, { create: false })
      const handle = await layoutsDir.getFileHandle(`${name}.json`, { create: false })
      const file = await handle.getFile()
      template = JSON.parse(await file.text())
      if (!Array.isArray(template.order)) return
    } catch { return }

    // Current cells come from the LAYER (children names, strict) — the
    // single source of truth. Merge handles label drift gracefully:
    // keeps saved order for tiles that still exist, appends new ones.
    const current = await this.#currentCells()
    if (!current) {
      console.warn('[layout] apply refused — current layer/children unresolved or cold')
      return
    }
    const merged = layout.merge(template.order, current)

    // Position is NOT layer state: order lives in each tile's own
    // `properties` slot as `index` (the same canonical write MoveDrone's
    // pinned-index path uses — content-addressed, FIFO-committed,
    // undoable). The legacy `__layout__` sidecar write is gone.
    const lineage = get('@hypercomb.social/Lineage') as
      { explorerSegments?: () => readonly string[] } | undefined
    const segments = lineage?.explorerSegments?.() ?? []
    for (let i = 0; i < merged.length; i++) {
      try {
        await writeTilePropertiesAt(segments, merged[i], { index: i })
      } catch (err) {
        console.warn('[layout] failed to persist index for', merged[i], err)
      }
    }

    const projection = get('@diamondcoreprocessor.com/OrderProjection') as
      { reorder?: (cells: string[]) => Promise<string[]> } | undefined
    await projection?.reorder?.(merged)

    EffectBus.emit('cell:reorder', { labels: merged })
    EffectBus.emit('layout:applied', { name, count: merged.length })

    void new hypercomb().act()
  }

  // ── list ────────────────────────────────────────────────

  async #list(): Promise<void> {
    const dir = await this.#explorerDir()
    if (!dir) return

    const names: string[] = []
    try {
      const layoutsDir = await dir.getDirectoryHandle(LAYOUTS_DIR, { create: false })
      for await (const [key, handle] of (layoutsDir as any).entries()) {
        if (handle.kind === 'file' && key.endsWith('.json')) {
          names.push(key.replace(/\.json$/, ''))
        }
      }
    } catch { /* no layouts dir yet */ }

    EffectBus.emit('layout:list', { layouts: names })
  }

  // ── remove ──────────────────────────────────────────────

  async #remove(name: string): Promise<void> {
    if (!name) return

    const dir = await this.#explorerDir()
    if (!dir) return

    try {
      const layoutsDir = await dir.getDirectoryHandle(LAYOUTS_DIR, { create: false })
      await layoutsDir.removeEntry(`${name}.json`)
      EffectBus.emit('layout:removed', { name })
    } catch { /* doesn't exist */ }
  }

  // ── helpers ─────────────────────────────────────────────

  async #explorerDir(): Promise<FileSystemDirectoryHandle | null> {
    const lineage = get('@hypercomb.social/Lineage') as
      { explorerDir: () => Promise<FileSystemDirectoryHandle | null> } | undefined
    return lineage ? await lineage.explorerDir() : null
  }

  /** Current cell names from the LAYER, strict — null when the layer (or any
   *  child sig) can't be fully resolved, so apply refuses rather than write
   *  index props against a set it couldn't see. */
  async #currentCells(): Promise<string[] | null> {
    const history = get('@diamondcoreprocessor.com/HistoryService') as PlacementHistory | undefined
    const lineage = get('@hypercomb.social/Lineage') as
      { explorerSegments?: () => readonly string[]; domain?: unknown } | undefined
    if (!history || !lineage) return null
    const segments = lineage.explorerSegments?.() ?? []
    const layer = await resolveCurrentLayer(history, lineage.domain, segments, null)
    if (!layer) return null
    const { names, coldMiss } = await childNamesOfStrict(history, layer)
    return coldMiss ? null : names
  }
}

// ── arg parsing ──────────────────────────────────────────

type ParsedArgs =
  | { action: 'save'; name: string }
  | { action: 'apply'; name: string }
  | { action: 'list'; name: '' }
  | { action: 'remove'; name: string }

function parseLayoutArgs(args: string): ParsedArgs {
  const trimmed = args.trim()
  if (!trimmed || trimmed === 'list') return { action: 'list', name: '' }

  const parts = trimmed.split(/\s+/)
  const verb = parts[0].toLowerCase()
  const name = normalizeName(parts.slice(1).join(' '))

  if (verb === 'save' && name) return { action: 'save', name }
  if (verb === 'remove' || verb === 'rm') return { action: 'remove', name }
  if (verb === 'apply' && name) return { action: 'apply', name }
  if (verb === 'list') return { action: 'list', name: '' }

  // bare name → apply
  return { action: 'apply', name: normalizeName(trimmed) }
}

function normalizeName(s: string): string {
  return s
    .trim()
    .toLocaleLowerCase()
    .replace(/[._\s]+/g, '-')
    .replace(/[^\p{L}\p{N}\-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/, '')
}

// ── registration ────────────────────────────────────────

const _layout = new LayoutQueenBee()
window.ioc.register('@diamondcoreprocessor.com/LayoutQueenBee', _layout)
