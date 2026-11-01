// meeting/meeting.queen.ts

import { QueenBee, EffectBus, hypercomb } from '@hypercomb/core'
import { readTilePropertiesAt, writeTilePropertiesAt } from '../editor/tile-properties.js'

/**
 * /meeting — tag the selected tile with `cascade` to create a meeting room,
 * or join/leave an existing meeting.
 *
 * Syntax:
 *   /meeting              — tag the selected tile `cascade` if untagged, then open the lobby to join
 *   /meeting join         — the same
 *   /meeting leave        — leave the active meeting
 *   /meeting cascade      — use the default Hypercomb template (1+6)
 *   /meeting cascade:19   — use a 2-ring template (1+6+12)
 */
export class MeetingQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'meeting'
  readonly command = 'meeting'
  override description = 'Start or join a video meeting on the selected tile'
  override descriptionKey = 'slash.meeting'
  override options = ['join', 'leave', 'cascade', 'cascade:19']
  override examples = [
    { input: '/meeting', result: 'Tags selected tile and joins its meeting' },
    { input: '/meeting leave', result: 'Leaves the meeting on selected tiles' },
  ]

  protected async execute(args: string): Promise<void> {
    const trimmed = args.trim().toLowerCase()

    // get selected tiles
    const selection = get('@diamondcoreprocessor.com/SelectionService') as
      { selected: ReadonlySet<string> } | undefined
    const selectedLabels = selection ? Array.from(selection.selected) : []

    if (trimmed === 'leave') {
      // You are in one meeting at a time, so leaving needs no tile.
      EffectBus.emitTransient('meeting:leave', {})
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
      { explorerSegments?: () => readonly string[] } | undefined
    const parentSegments = lineage?.explorerSegments?.() ?? []

    for (const label of selectedLabels) {
      // Read current tags from the tile's layer (canonical) — no OPFS
      // dir consulted or minted.
      const props = await readTilePropertiesAt(parentSegments, label)
      const tags: string[] = Array.isArray(props['tags']) ? [...props['tags'] as string[]] : []

      // check if already has a meeting tag
      const existing = tags.find(t => t === template || t.startsWith(template + ':'))

      if (!existing) {
        tags.push(template)
        await writeTilePropertiesAt(parentSegments, label, { tags })
      }
      // Said either way: the room's subscription is made when a tag is HEARD,
      // and a tile tagged in an earlier session is not heard again by itself.
      // Hearing it twice is a no-op.
      EffectBus.emit('tags:changed', { updates: [{ cell: label, tag: existing ?? template }] })
    }

    // pulse processor to pick up changes
    void new hypercomb().act()

    // Joining is the lobby's: it opens the camera, lets you check it, and hands
    // it to the meeting. One lobby, for the first tile when several are selected.
    EffectBus.emitTransient('meeting:lobby-open', { cell: selectedLabels[0] })
  }
}

// ── registration ────────────────────────────────────────────

const _meeting = new MeetingQueenBee()
window.ioc.register('@diamondcoreprocessor.com/MeetingQueenBee', _meeting)
