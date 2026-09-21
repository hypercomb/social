// assistant/file.queen.ts
//
// `file <text>` — put a note on the tile on this page it belongs to (Jev
// chooses, jev-file.ts), or here when Jev is not sure. The words are kept
// exactly; only the place is chosen. Needs Jev switched on and OpenRouter
// allowed to read the hive, because the page's tile names travel to Jev.

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { jevDecision } from './jev-decision.service.js'
import { HIVE_TREE_READER_IOC_KEY } from './hive-tree-reader.js'

type LineageLike = { explorerSegments?: () => readonly string[] }
type TreeReaderLike = {
  readNode?(segments: readonly string[], options: { maxBytes: number; withContent: boolean }): Promise<
    { ok: true; children: readonly { name: string }[] } | { ok: false }
  >
}
type NotesLike = { addAtSegments?: (parent: readonly string[], cell: string, text: string) => Promise<void> }

export class FileQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'file'
  override description = 'File a note on the tile it belongs to on this page'
  override descriptionKey = 'slash.file'
  override examples = [
    { input: '/file call the printer company about toner', result: 'Puts the note on the tile it belongs to, or here' },
  ]
  override machine = {
    forms: '<text>',
    example: '/file call the printer company about toner',
    reach: 'additive' as const,
    scope: 'page' as const,
  }

  protected async execute(args: string): Promise<void> {
    const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
    const t = (key: string, fallback: string): string => {
      const value = i18n?.t?.(key)
      return value && value !== key ? value : fallback
    }
    const toast = (message: string, type = 'info'): void => { EffectBus.emit('toast:show', { type, message }) }
    const note = String(args ?? '').trim()
    if (!note) { toast(t('file.empty', 'Say what to file.'), 'warning'); return }
    const page = [...((window.ioc?.get?.('@hypercomb.social/Lineage') as LineageLike | undefined)?.explorerSegments?.() ?? [])].map(String).filter(Boolean)
    const notes = window.ioc?.get?.('@diamondcoreprocessor.com/NotesService') as NotesLike | undefined
    if (!notes?.addAtSegments) { toast(t('file.unavailable', 'Notes are not available here.'), 'warning'); return }

    // The page's tiles, names only; Jev chooses among them. The single-tile
    // read tolerates a child this device cannot see.
    let tiles: string[] = []
    const reader = window.ioc?.get?.(HIVE_TREE_READER_IOC_KEY) as TreeReaderLike | undefined
    try {
      const listed = await reader?.readNode?.(page, { maxBytes: 8_000, withContent: false })
      if (listed?.ok) tiles = listed.children.map(child => child.name).filter(Boolean).slice(0, 48)
    } catch { /* no tiles: the note stays here */ }

    let tile: string | undefined
    let receiptNote = ''
    if (tiles.length && jevDecision.readyForHive()) {
      try {
        const placed = await jevDecision.place({ note, tiles })
        tile = placed.tile
        receiptNote = placed.reason
        EffectBus.emit('jev:outcome', { plan: 'file', outcome: tile ? 'ran' : 'passed', at: Date.now(), reach: 'additive' })
      } catch (error) {
        console.warn('[file] Jev could not place the note:', error)
      }
    }

    if (tile) {
      await notes.addAtSegments(page, tile, note)
      toast(`${t('file.under', 'Filed under')} ${tile}${receiptNote ? ` (Jev ${receiptNote.split(' ').pop()})` : ''}`, 'success')
      return
    }
    // Here: the tile the participant is standing in. At the root there is no
    // tile to hold a note, so say so rather than guess.
    if (!page.length) { toast(t('file.unsure', 'Not sure where this goes. Open a tile and say it there.'), 'warning'); return }
    await notes.addAtSegments(page.slice(0, -1), page[page.length - 1], note)
    toast(t('file.here', 'Filed here.'), 'success')
  }
}

const _file = new FileQueenBee()
window.ioc.register('@diamondcoreprocessor.com/FileQueenBee', _file)
