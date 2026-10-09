// commands/opens.queen.ts
//
// `opens` — how a tile opens: as one of its views, or as hexagons.
//
//   opens                          how this layer opens
//   opens jaime-weise              how that child tile opens
//   opens jaime-weise as website   it opens as its website from now on
//   opens jaime-weise as hexagons  it opens as hexagons again
//   opens as slides                this layer opens as slides
//
// The word for the ctrl+click on a tile's view icon (and the header rail's
// ctrl+click): every act has a word, and a phone has no ctrl. It writes the
// same record — the place's own `view:default` mark — through the same intent
// (`features:default`), so the default, its undo and what a visitor sees after
// a publish are one fact however it was set. The one-shot counterpart is the
// `h` key: hexagons for one visit, without changing the default.
//
// No aliases: a behaviour declares none (aliases are the participant's own).
import { QueenBee, EffectBus } from '@hypercomb/core'
import { HEXAGONS_SURFACE } from './decoration-kind-index.js'
import { defaultViewAt, defaultViewWithinAt } from './view-default.js'

type LineageLike = { explorerSegments?: () => readonly string[] }

export class OpensQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'opens'
  override description = 'Set how a tile opens: as one of its views, or as hexagons'
  override descriptionKey = 'slash.opens'
  override options = ['<tile>', '<tile> as <view>', '<tile> as hexagons', 'as <view>']
  override examples = [
    { input: '/opens jaime-weise as website', result: 'Walking into jaime-weise opens its website' },
    { input: '/opens jaime-weise as hexagons', result: 'jaime-weise opens as hexagons again' },
    { input: '/opens jaime-weise', result: 'Says how jaime-weise opens' },
  ]

  // `website` is itself a behaviour word — the whole line is this word's.
  override rawArgs = true

  protected async execute(args: string): Promise<void> {
    const m = args.trim().match(/^(.*?)\s*(?:\bas\s+(\S+))?\s*$/i)
    const tile = (m?.[1] ?? '').trim().replace(/^\/+|\/+$/g, '')
    const view = (m?.[2] ?? '').trim().toLowerCase()
    const here = (window.ioc.get<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    const segments = tile ? [...here, ...tile.split('/').map(s => s.trim()).filter(Boolean)] : here
    // The hive root has no last segment to name it — '/' (the rail's label).
    const name = segments[segments.length - 1] ?? '/'

    // Read from the layers themselves, not the warm index: a place this
    // session has not walked (or the hive root) is still answered truly.
    const own = await defaultViewAt(segments)
    const opens = await defaultViewWithinAt(segments)

    if (!view) {
      const message = !opens || opens === HEXAGONS_SURFACE
        ? `"${name}" opens as hexagons`
        : own ? `"${name}" opens as ${opens}` : `"${name}" opens as ${opens} (from the branch above it)`
      EffectBus.emit('activity:log', { message, icon: '▶' })
      EffectBus.emit('toast:show', { type: 'info', message })
      return
    }

    if (view === HEXAGONS_SURFACE) {
      if (own === HEXAGONS_SURFACE) {
        EffectBus.emit('toast:show', { type: 'info', message: `"${name}" already opens as hexagons` })
        return
      }
      // At the hive root there is nothing above to opt out of: clearing is off.
      if (segments.length === 0) {
        EffectBus.emit('features:default', { cell: name, segments, view: own || HEXAGONS_SURFACE, clear: true, silent: true })
        return
      }
      // Off is explicit: the place says "hexagons" in its own mark, so a
      // childless page stays hexagons for visitors too (it would otherwise
      // open as its page) and an ancestor's default stops here.
      EffectBus.emit('features:default', { cell: name, segments, view: HEXAGONS_SURFACE, silent: true })
      return
    }

    // show-features checks the view is a real render view and reports if not.
    EffectBus.emit('features:default', { cell: name, segments, view, silent: true })
  }
}

const _opens = new OpensQueenBee()
window.ioc.register('@diamondcoreprocessor.com/OpensQueenBee', _opens)
