// diamondcoreprocessor.com/meeting/meeting.queen.ts

import { QueenBee, EffectBus, hypercomb } from '@hypercomb/core'

/**
 * /meeting — tag the selected tile with `cascade` to create a meeting room,
 * or join/leave an existing meeting.
 *
 * Syntax:
 *   /meeting              — toggle meeting on selected tile (tags `cascade` if untagged, joins if tagged)
 *   /meeting join         — explicitly join the meeting on the selected tile
 *   /meeting leave        — leave the active meeting
 *   /meeting cascade      — use the default Hypercomb template (1+6)
 *   /meeting cascade:19   — use a 2-ring template (1+6+12)
 */
export class MeetingQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'meeting'
  readonly command = 'meeting'
  override readonly aliases = []
  override description = 'Start or join a video meeting on the selected tile'

  protected async execute(args: string): Promise<void> {
    const trimmed = args.trim().toLowerCase()

    // get selected tiles
    const selection = get('@diamondcoreprocessor.com/SelectionService') as
      { selected: ReadonlySet<string> } | undefined
    const selectedLabels = selection ? Array.from(selection.selected) : []

    if (trimmed === 'leave') {
      // leave meeting on all selected tiles
      for (const label of selectedLabels) {
        EffectBus.emit('tile:action', { action: 'meeting', label, q: 0, r: 0, index: 0 })
      }
      return
    }

    // determine template keyword
    const template = trimmed === 'join' || !trimmed ? 'cascade' : trimmed

    if (selectedLabels.length === 0) {
      console.warn('[/meeting] No tiles selected. Select a tile first.')
      return
    }

    // for each selected tile: tag it with the meeting keyword, then trigger join
    const lineage = get('@hypercomb.social/Lineage') as
      { explorerDir: () => Promise<FileSystemDirectoryHandle | null> } | undefined
    const dir = lineage ? await lineage.explorerDir() : null

    for (const label of selectedLabels) {
      if (dir) {
        // read current tags
        const cellDir = await dir.getDirectoryHandle(label, { create: true })
        const props = await readProps(cellDir)
        const tags: string[] = Array.isArray(props['tags']) ? props['tags'] : []

        // check if already has a meeting tag
        const hasMeetingTag = tags.some(t => t === template || t.startsWith(template + ':'))

        if (!hasMeetingTag) {
          // add the meeting keyword tag
          tags.push(template)
          await writeProps(cellDir, { tags })
          EffectBus.emit('tags:changed', { updates: [{ cell: label, tag: template }] })
        }
      }

      // trigger the meeting action (join/toggle)
      EffectBus.emit('tile:action', { action: 'meeting', label, q: 0, r: 0, index: 0 })
    }

    // pulse processor to pick up changes
    void new hypercomb().act()
  }
}

// ── OPFS 0000 props helpers ─────────────────────────────────

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

// ── registration ────────────────────────────────────────────

const _meeting = new MeetingQueenBee()
window.ioc.register('@diamondcoreprocessor.com/MeetingQueenBee', _meeting)
