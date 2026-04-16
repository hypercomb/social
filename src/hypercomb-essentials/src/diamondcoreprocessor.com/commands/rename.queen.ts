// diamondcoreprocessor.com/commands/rename.queen.ts

import { QueenBee, EffectBus, SignatureService, hypercomb } from '@hypercomb/core'
import type { HistoryService } from '../history/history.service.js'

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
 * 4. Records a `rename` history op with signature-addressed payload
 * 5. Emits `cell:renamed` effect for reactive UI
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

      // Record rename in history (signature-addressed payload)
      await this.#recordRenameOp(oldName, newName)

      // Emit effects: remove old, add new
      const groupId = `rename:${Date.now().toString(36)}`
      EffectBus.emit('cell:removed', { cell: oldName, groupId })
      EffectBus.emit('cell:added', { cell: newName, groupId })
      EffectBus.emit('cell:renamed', { oldName, newName })

      selection.clear()
      void new hypercomb().act()
    } catch { /* old directory doesn't exist or can't be renamed */ }
  }

  async #recordRenameOp(oldName: string, newName: string): Promise<void> {
    const lineage = get<any>('@hypercomb.social/Lineage')
    const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    const store = get<any>('@hypercomb.social/Store')
    if (!lineage || !historyService || !store) return

    const locationSig = await historyService.sign(lineage)

    // Capture: signature-addressed rename payload
    const snapshot = {
      version: 1 as const,
      oldName,
      newName,
      at: Date.now(),
    }
    const json = JSON.stringify(snapshot, Object.keys(snapshot).sort(), 0)
    const blob = new Blob([json], { type: 'application/json' })

    const bytes = await blob.arrayBuffer()
    const resourceSig = await SignatureService.sign(bytes)
    await store.putResource(blob)

    await historyService.record(locationSig, {
      op: 'rename',
      cell: resourceSig,
      at: snapshot.at,
    })
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
