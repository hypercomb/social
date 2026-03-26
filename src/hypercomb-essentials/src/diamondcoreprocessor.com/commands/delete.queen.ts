// diamondcoreprocessor.com/commands/delete.queen.ts

import { QueenBee, EffectBus, hypercomb } from '@hypercomb/core'

/**
 * /delete — remove tiles from the current directory.
 *
 * Syntax:
 *   /delete                         — delete currently selected tiles
 *   /delete tileName                — delete a single tile
 *   /delete [tile1, tile2, tile3]   — delete multiple tiles
 *   /select[a,b]/delete             — chained: select then delete
 */
export class DeleteQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'delete'
  override readonly aliases = ['del', 'rm']
  override description = 'Delete tiles from the current directory'

  protected async execute(args: string): Promise<void> {
    const targets = parseDeleteArgs(args)

    // No args → operate on current selection
    if (targets.length === 0) {
      const selection = get('@diamondcoreprocessor.com/SelectionService') as
        { selected: ReadonlySet<string>; clear: () => void } | undefined
      if (selection && selection.selected.size > 0) {
        targets.push(...Array.from(selection.selected))
        selection.clear()
      }
    }

    if (targets.length === 0) return

    const lineage = get('@hypercomb.social/Lineage') as
      { explorerDir: () => Promise<FileSystemDirectoryHandle | null> } | undefined
    if (!lineage) return

    const dir = await lineage.explorerDir()
    if (!dir) return

    for (const name of targets) {
      try {
        await dir.removeEntry(name, { recursive: true })
        EffectBus.emit('seed:removed', { seed: name })
      } catch { /* entry doesn't exist or can't be removed — skip */ }
    }

    void new hypercomb().act()
  }
}

// ── arg parsing ──────────────────────────────────────────

function parseDeleteArgs(args: string): string[] {
  const trimmed = args.trim()
  if (!trimmed) return []

  // Bracket batch: [tile1, tile2, tile3]
  const bracketMatch = trimmed.match(/^\[(.+)\]$/)
  if (bracketMatch) {
    return bracketMatch[1]
      .split(',')
      .map(s => normalizeName(s.trim()))
      .filter(Boolean)
  }

  // Single name
  const name = normalizeName(trimmed)
  return name ? [name] : []
}

/** Minimal normalization — lowercase, collapse whitespace to hyphens, strip non-alphanumeric. */
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

const _delete = new DeleteQueenBee()
window.ioc.register('@diamondcoreprocessor.com/DeleteQueenBee', _delete)
