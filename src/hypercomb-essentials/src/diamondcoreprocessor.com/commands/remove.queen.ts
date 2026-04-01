// diamondcoreprocessor.com/commands/remove.queen.ts

import { QueenBee, EffectBus, hypercomb } from '@hypercomb/core'

/**
 * /remove — remove tiles from the current directory.
 *
 * Removes tiles from the visible hierarchy. The underlying data
 * persists in OPFS and can be navigated to again later.
 *
 * Syntax:
 *   /remove                         — remove currently selected tiles
 *   /remove tileName                — remove a single tile
 *   /remove [tile1, tile2, tile3]   — remove multiple tiles
 *   /select[a,b]/remove             — chained: select then remove
 */
export class RemoveQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'remove'
  override readonly aliases = ['rm']
  override description = 'Remove tiles from the current directory'

  protected async execute(args: string): Promise<void> {
    const targets = parseRemoveArgs(args)

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

    const groupId = targets.length > 1
      ? `remove:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
      : undefined

    const lineage = get('@hypercomb.social/Lineage') as
      { explorerDir: () => Promise<FileSystemDirectoryHandle | null> } | undefined
    if (!lineage) return

    const dir = await lineage.explorerDir()
    if (!dir) return

    for (const name of targets) {
      try {
        await dir.removeEntry(name, { recursive: true })
        EffectBus.emit('seed:removed', { seed: name, groupId })
      } catch { /* entry doesn't exist or can't be removed — skip */ }
    }

    void new hypercomb().act()
  }
}

// ── arg parsing ──────────────────────────────────────────

function parseRemoveArgs(args: string): string[] {
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

const _remove = new RemoveQueenBee()
window.ioc.register('@diamondcoreprocessor.com/RemoveQueenBee', _remove)

// Listen for controls-bar / context-menu "remove" action
EffectBus.on<{ action: string }>('controls:action', (payload) => {
  if (payload?.action === 'remove') void _remove.invoke('')
})

// Listen for keyboard shortcut (Delete / Backspace)
EffectBus.on<{ cmd: string }>('keymap:invoke', (payload) => {
  if (payload?.cmd === 'selection.remove') void _remove.invoke('')
})
