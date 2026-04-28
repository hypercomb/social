// diamondcoreprocessor.com/move/layout.queen.ts

import { QueenBee, EffectBus, hypercomb } from '@hypercomb/core'
import type { LayoutService } from './layout.service.js'

/**
 * /layout — save, apply, list, or remove layout templates.
 *
 * A layout template is a stored array of `/select[label]/move(index)` commands —
 * the grammar is the same whether a human types it or a drone replays it.
 *
 * Syntax:
 *   /layout save my-grid       — save current tile positions as "my-grid"
 *   /layout apply my-grid      — apply saved layout "my-grid"
 *   /layout my-grid            — shorthand for apply
 *   /layout list               — list available layouts
 *   /layout remove my-grid     — remove a saved layout
 */

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
    const commands = order.map((label, i) => `/select[${label}]/move(${i})`)

    const template: LayoutTemplate = { name, order, commands }

    const layoutsDir = await dir.getDirectoryHandle(LAYOUTS_DIR, { create: true })
    const handle = await layoutsDir.getFileHandle(`${name}.json`, { create: true })
    const writable = await handle.createWritable()
    await writable.write(JSON.stringify(template))
    await writable.close()

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

    // current filesystem cells — merge handles label drift gracefully:
    // keeps saved order for tiles that still exist, appends new ones
    const currentCells = await this.#currentCells(dir)
    const merged = layout.merge(template.order, currentCells)

    await layout.write(dir, merged)
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

  async #currentCells(dir: FileSystemDirectoryHandle): Promise<string[]> {
    const cells: string[] = []
    for await (const [key, handle] of (dir as any).entries()) {
      if (handle.kind === 'directory' && !key.startsWith('__')) {
        cells.push(key)
      }
    }
    return cells
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
