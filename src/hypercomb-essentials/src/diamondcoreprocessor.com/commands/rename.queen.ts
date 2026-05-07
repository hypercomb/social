// diamondcoreprocessor.com/commands/rename.queen.ts

import { QueenBee, EffectBus, hypercomb } from '@hypercomb/core'

/**
 * /rename — rename a tile (cell directory) at the current location.
 *
 * Syntax:
 *   /rename newName                     — rename currently selected tile
 *   /select[old-name]/rename newName    — chained: select then rename
 *
 * The rename operation:
 * 1. Reads all content from the old directory
 * 2. Writes it to a new directory with the new name
 * 3. Removes the old directory
 * 4. Emits cell:removed + cell:added so LayerCommitter rewrites the
 *    parent's `children` slot (oldName sig → newName sig) and cascades
 *    to root. The rename is captured in the layer marker chain itself.
 * 5. Emits `cell:renamed` for reactive UI consumers.
 */
export class RenameQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'rename'
  override readonly aliases = []
  override description = 'Rename a tile'

  protected async execute(args: string): Promise<void> {
    const newName = normalizeName(args.trim())
    if (!newName) return

    // Get the selected tile (exactly one required)
    const selection = get('@diamondcoreprocessor.com/SelectionService') as
      { selected: ReadonlySet<string>; clear: () => void } | undefined
    if (!selection || selection.selected.size !== 1) return

    const oldName = [...selection.selected][0]
    if (oldName === newName) return

    const lineage = get('@hypercomb.social/Lineage') as
      { explorerDir: () => Promise<FileSystemDirectoryHandle | null> } | undefined
    if (!lineage) return

    const dir = await lineage.explorerDir()
    if (!dir) return

    try {
      // Check old directory exists
      const oldDir = await dir.getDirectoryHandle(oldName, { create: false })

      // Check new name isn't taken
      try {
        await dir.getDirectoryHandle(newName, { create: false })
        return  // name already exists
      } catch { /* good — name is available */ }

      // Create new directory and copy all contents
      const newDir = await dir.getDirectoryHandle(newName, { create: true })
      await copyDirectory(oldDir, newDir)

      // Remove old directory
      await dir.removeEntry(oldName, { recursive: true })

      // The cell:removed + cell:added pair below routes through
      // LayerCommitter's #queueChildName, which rewrites the parent's
      // children slot (oldName sig → newName sig) and cascades to root.
      // The rename is captured in the layer marker chain — no parallel
      // history-op log is needed (and the legacy historyService.record
      // path is dead; see history-recorder.drone.ts).
      const groupId = `rename:${Date.now().toString(36)}`
      EffectBus.emit('cell:removed', { cell: oldName, groupId })
      EffectBus.emit('cell:added', { cell: newName, groupId })
      EffectBus.emit('cell:renamed', { oldName, newName })

      selection.clear()
      void new hypercomb().act()
    } catch { /* old directory doesn't exist or can't be renamed */ }
  }
}

// ── OPFS directory copy ────────────────────────────────

async function copyDirectory(
  src: FileSystemDirectoryHandle,
  dest: FileSystemDirectoryHandle
): Promise<void> {
  for await (const [name, handle] of src.entries()) {
    if (handle.kind === 'file') {
      const srcFile = await (handle as FileSystemFileHandle).getFile()
      const destFile = await dest.getFileHandle(name, { create: true })
      const writable = await destFile.createWritable()
      await writable.write(await srcFile.arrayBuffer())
      await writable.close()
    } else if (handle.kind === 'directory') {
      const srcDir = handle as FileSystemDirectoryHandle
      const destDir = await dest.getDirectoryHandle(name, { create: true })
      await copyDirectory(srcDir, destDir)
    }
  }
}

// ── name normalization ──────────────────────────────────

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

const _rename = new RenameQueenBee()
window.ioc.register('@diamondcoreprocessor.com/RenameQueenBee', _rename)
