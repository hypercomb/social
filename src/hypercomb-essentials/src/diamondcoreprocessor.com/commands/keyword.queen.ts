// diamondcoreprocessor.com/commands/keyword.queen.ts

import { QueenBee, EffectBus, hypercomb } from '@hypercomb/core'

/**
 * /keyword — add or remove keywords (tags) on selected tiles.
 *
 * Syntax:
 *   /keyword tagName              — add tag (to selected tiles if any, else global registry only)
 *   /keyword tagName(#ff0000)     — add tag with color
 *   /keyword ~tagName             — remove tag from selected tiles
 *   /keyword [tag1, ~tag2, tag3]  — batch add/remove
 *   /select[a,b]/keyword tagName  — chained: select then tag
 */
export class KeywordQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'keyword'
  override readonly aliases = ['kw', 'tag']
  override description = 'Add or remove keywords (tags) on selected tiles'

  protected async execute(args: string): Promise<void> {
    const parsed = parseKeywordArgs(args)
    if (parsed.length === 0) return

    const selection = get('@diamondcoreprocessor.com/SelectionService') as
      { selected: ReadonlySet<string> } | undefined
    const lineage = get('@hypercomb.social/Lineage') as
      { explorerDir: () => Promise<FileSystemDirectoryHandle | null> } | undefined
    const registry = get('@hypercomb.social/TagRegistry') as
      { add: (n: string, c?: string) => Promise<void>; ensureLoaded: () => Promise<void> } | undefined

    const selectedLabels = selection ? Array.from(selection.selected) : []

    if (selectedLabels.length > 0 && lineage) {
      // Apply to all selected tiles
      const dir = await lineage.explorerDir()
      if (dir) {
        const updates: { cell: string; tag: string; color?: string }[] = []

        for (const label of selectedLabels) {
          for (const op of parsed) {
            try {
              const cellDir = await dir.getDirectoryHandle(label, { create: true })
              const props = await readProps(cellDir)
              const tags: string[] = Array.isArray(props['tags']) ? props['tags'] : []

              if (op.remove) {
                const idx = tags.indexOf(op.tag)
                if (idx >= 0) {
                  tags.splice(idx, 1)
                  await writeProps(cellDir, { tags })
                }
              } else {
                if (!tags.includes(op.tag)) {
                  tags.push(op.tag)
                  await writeProps(cellDir, { tags })
                }
              }
              updates.push({ cell: label, tag: op.tag, color: op.color })
            } catch { /* skip inaccessible tiles */ }
          }
        }

        if (updates.length > 0) {
          EffectBus.emit('tags:changed', { updates })
        }
      }
    }

    // Always update global registry for non-remove ops
    if (registry) {
      await registry.ensureLoaded()
      for (const op of parsed) {
        if (!op.remove) {
          await registry.add(op.tag, op.color)
        }
      }
    }

    // Trigger processor to sync visual state
    void new hypercomb().act()
  }
}

// ── arg parsing ──────────────────────────────────────────

function parseKeywordArgs(args: string): { tag: string; color?: string; remove: boolean }[] {
  const trimmed = args.trim()
  if (!trimmed) return []

  // Bracket batch: [tag1, ~tag2, tag3(#color)]
  const bracketMatch = trimmed.match(/^\[(.+)\]$/)
  if (bracketMatch) {
    const ops: { tag: string; color?: string; remove: boolean }[] = []
    for (const raw of bracketMatch[1].split(',')) {
      const item = raw.trim()
      if (!item) continue
      if (item.startsWith('~')) {
        const tag = item.slice(1).trim()
        if (tag) ops.push({ tag, remove: true })
      } else {
        const m = item.match(/^([^(]+)(?:\(([^)]+)\))?$/)
        if (m) {
          const tag = m[1].trim()
          const color = m[2]?.trim()
          if (tag) ops.push({ tag, color, remove: false })
        }
      }
    }
    return ops
  }

  // Single: ~tagName or tagName or tagName(#color)
  if (trimmed.startsWith('~')) {
    const tag = trimmed.slice(1).trim()
    return tag ? [{ tag, remove: true }] : []
  }

  const m = trimmed.match(/^([^(]+)(?:\(([^)]+)\))?$/)
  if (m) {
    const tag = m[1].trim()
    const color = m[2]?.trim()
    return tag ? [{ tag, color, remove: false }] : []
  }

  return []
}

// ── OPFS 0000 props helpers (self-contained, no shared import) ──

const PROPS_FILE = '0000'

async function readProps(cellDir: FileSystemDirectoryHandle): Promise<Record<string, unknown>> {
  try {
    const fh = await cellDir.getFileHandle(PROPS_FILE)
    const file = await fh.getFile()
    return JSON.parse(await file.text())
  } catch {
    return {}
  }
}

async function writeProps(cellDir: FileSystemDirectoryHandle, updates: Record<string, unknown>): Promise<void> {
  const existing = await readProps(cellDir)
  const merged = { ...existing, ...updates }
  const fh = await cellDir.getFileHandle(PROPS_FILE, { create: true })
  const writable = await fh.createWritable()
  await writable.write(JSON.stringify(merged))
  await writable.close()
}

// ── registration ────────────────────────────────────────

const _keyword = new KeywordQueenBee()
window.ioc.register('@diamondcoreprocessor.com/KeywordQueenBee', _keyword)
