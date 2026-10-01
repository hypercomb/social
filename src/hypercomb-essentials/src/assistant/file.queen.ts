// assistant/file.queen.ts
//
// `file <text>` — put a note on the tile on this page it belongs to (Jev
// chooses, jev-file.ts), or here when Jev is not sure. The words are kept
// exactly; only the place is chosen. Needs Jev switched on and OpenRouter
// allowed to read the hive, because the page's tile names travel to Jev.
//
// `file on <tile>: <text>` — the place is said, so nobody is asked: the note
// goes on that tile of this page and holds the text alone. `file on
// /<route>: <text>` says a tile anywhere; a route that names no tile is
// refused. A note that could not be filed THROWS, so a machine's receipt
// never says "ran" for nothing.

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
    forms: '<text> | on <tile>: <text> | on /<route>: <text>',
    example: '/file on printers: call the company about toner',
    reach: 'additive' as const,
    // A note is written on its tile AND on the tile's word (the notes facet,
    // notes/notes-facet.ts), and a route reaches any page: the wider ring.
    scope: 'hive' as const,
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
    if (!notes?.addAtSegments) {
      toast(t('file.unavailable', 'Notes are not available here.'), 'warning')
      throw new Error('notes are not available here; nothing was filed')
    }

    // The page's tiles, names only; Jev chooses among them. The single-tile
    // read tolerates a child this device cannot see.
    let tiles: string[] = []
    let everyTile: string[] = []
    const reader = window.ioc?.get?.(HIVE_TREE_READER_IOC_KEY) as TreeReaderLike | undefined
    try {
      const listed = await reader?.readNode?.(page, { maxBytes: 8_000, withContent: false })
      if (listed?.ok) {
        everyTile = listed.children.map(child => child.name).filter(Boolean)
        tiles = everyTile.slice(0, 48)
      }
    } catch { /* no tiles: the note stays here */ }

    // THE PLACE, SAID. Asked to put a note on a tile, a model writes
    // `file on <tile>: <text>` — it steers the placing by naming the tile
    // (jwize's drive session, 2026-09-30), and with the words "kept exactly"
    // the steering ended up in the note. A tile of this page named that way
    // IS the place: the note goes there without asking Jev, and it holds the
    // text alone. A name no tile here wears is not a place, so the whole line
    // is filed as it always was.
    const said = /^on\s+([^\s:]+)\s*:\s+([\s\S]+)$/i.exec(note)
    if (said) {
      const text = said[2].trim()
      // A ROUTE IS A PLACE ANYWHERE: `file on /a/b: <text>` reaches a tile
      // off this page. A route is not a guess, so one that names no tile is
      // refused aloud — never filed somewhere else with the route in it.
      if (said[1].startsWith('/')) {
        const route = said[1].split('/').map(part => part.trim()).filter(Boolean)
        const tile = route[route.length - 1]
        const parent = route.slice(0, -1)
        let found: string | undefined
        try {
          const listed = tile ? await reader?.readNode?.(parent, { maxBytes: 8_000, withContent: false }) : undefined
          if (listed?.ok) found = listed.children.map(child => child.name).find(name => name.toLowerCase() === tile.toLowerCase())
        } catch { /* unreadable: no place */ }
        if (!found || !text) {
          toast(`${t('file.noplace', 'No tile at')} ${said[1]}`, 'warning')
          throw new Error(`there is no tile at ${said[1]}; nothing was filed`)
        }
        await notes.addAtSegments(parent, found, text)
        toast(`${t('file.under', 'Filed under')} ${said[1]}`, 'success')
        return
      }
      const wanted = said[1].toLowerCase()
      const named = everyTile.find(name => name.toLowerCase() === wanted)
      if (named && text) {
        await notes.addAtSegments(page, named, text)
        toast(`${t('file.under', 'Filed under')} ${named}`, 'success')
        return
      }
    }

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
    // Said aloud AND thrown: a clean return earns a machine a "ran" receipt
    // for a note that was never filed.
    if (!page.length) {
      toast(t('file.unsure', 'Not sure where this goes. Open a tile and say it there.'), 'warning')
      throw new Error('there is no tile here to hold the note; name one: file on <tile>: <text>, or file on /<route>: <text>')
    }
    await notes.addAtSegments(page.slice(0, -1), page[page.length - 1], note)
    toast(t('file.here', 'Filed here.'), 'success')
  }
}

const _file = new FileQueenBee()
window.ioc.register('@diamondcoreprocessor.com/FileQueenBee', _file)
