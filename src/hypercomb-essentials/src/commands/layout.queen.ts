// commands/layout.queen.ts
//
// `layout` — which of a layer's children it shows (layout.ts;
// documentation/living-presentation.md, "The layout behaviour").
//
//   layout                    is this layer's layout on, its words, and which children it leaves out
//   layout on                 show only the children this tile's trait markers name, in their order
//   layout off                show every child again
//   layout from /<tile>       take that tile's layout here: the same word list, by signature
//
// The tile is the one you stand in. A layout is a list of trait words kept as
// a record on the tile; every switch is a new version of the layer, so it
// undoes like any other change and every layout the tile has had stays in its
// history. A child left out is still there, untouched: it is only not drawn.
// The words come from the markers (`trait <words>` places them, in order), so
// placing a marker and saying `layout on` again allows one more child.

import { EffectBus, QueenBee, TRAIT_WANT_KIND, traitWords, type TraitWant } from '@hypercomb/core'
import { listDecorations, removeDecorationAndWait, writeDecoration } from './decoration-manifest.js'
import { LAYOUT_KIND, layoutNames, leftOut, parseLayoutArgs, type LayoutRecord } from './layout.js'
import { layoutAt, namesOf, store } from './layout-read.js'
import { childNamesAt, say, standing } from './trait-read.js'

export class LayoutQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'layout'
  override description = 'Which of this layer\'s children it shows: only the ones its trait words name, or all'
  override descriptionKey = 'slash.layout'
  override options = ['on', 'off', 'from /<tile>']
  override examples = [
    { input: '/layout', result: 'Says whether this layer\'s layout is on, its words, and which children it leaves out' },
    { input: '/layout on', result: 'Shows only the children this tile\'s trait markers name, in their order' },
    { input: '/layout off', result: 'Shows every child again' },
    { input: '/layout from /presentation/simple', result: 'Takes that tile\'s layout here' },
  ]

  // The whole line is this word's: `from` is a behaviour word of its own, and
  // without this `layout from /x` would run it too.
  override rawArgs = true

  protected async execute(args: string): Promise<void> {
    const parsed = parseLayoutArgs(args)
    if ('error' in parsed) { say(`layout: ${parsed.error}`, 'error'); return }

    const here = standing()
    if (here.length === 0) { say('layout: stand in a tile to give its layer a layout', 'error'); return }
    const name = here[here.length - 1]
    const { records, layout } = await layoutAt(here)

    if (parsed.verb === 'show') {
      const children = await childNamesAt(here)
      if (!layout?.on) {
        const markers = traitWords((await listDecorations<TraitWant>({ kind: TRAIT_WANT_KIND, segments: here })).map(w => w.record.payload))
        say(`"${name}": layout off — every child shows${markers.length ? `. Its markers: ${markers.join(', ')} (layout on shows only these)` : ''}`)
        return
      }
      const names = await namesOf(layout)
      const out = leftOut(children, names)
      say(`"${name}": layout on — ${names.join(', ') || 'no words'}${out.length ? `. Left out: ${out.join(', ')}` : ''}`)
      return
    }

    let next: LayoutRecord
    if (parsed.verb === 'off') {
      if (!layout?.on) { say(`"${name}": layout is already off`); return }
      next = { on: false }
    } else if (parsed.verb === 'on') {
      const markers = traitWords((await listDecorations<TraitWant>({ kind: TRAIT_WANT_KIND, segments: here })).map(w => w.record.payload))
      if (markers.length === 0) { say(`layout: "${name}" has no trait markers yet — trait <words> places them`, 'error'); return }
      const sig = await this.#keep(layoutNames(markers))
      if (!sig) { say('layout: the store is not available', 'error'); return }
      next = { on: true, names: sig }
    } else {
      const from = await layoutAt(parsed.route)
      if (!from.layout?.on || !from.layout.names) { say(`layout: /${parsed.route.join('/')} has no layout on to take`, 'error'); return }
      next = { on: true, names: from.layout.names }
    }

    if (layout && layout.on === next.on && layout.names === next.names) { say(`"${name}": layout unchanged`); return }

    // The new record first, then the old ones retired: the layer is never
    // without its layout for a moment, and the newest record is the one read.
    await writeDecoration<LayoutRecord>({
      kind: LAYOUT_KIND, appliesTo: here, segments: here, payload: next, mark: 'persistent',
      ...(next.names ? { refs: [next.names] } : {}),
    })
    for (const old of records) await removeDecorationAndWait({ sig: old.sig, segments: here })
    EffectBus.emit('layout:changed', { segments: here })

    if (!next.on) { say(`"${name}": layout off — every child shows`); return }
    const names = await namesOf(next)
    const out = leftOut(await childNamesAt(here), names)
    say(`"${name}": layout on — ${names.join(', ')}${out.length ? `. Left out: ${out.join(', ')}` : ''}`)
  }

  /** Keep a word list as a resource; its signature names the layout. */
  async #keep(names: readonly string[]): Promise<string> {
    const s = store()
    if (!s?.putResource) return ''
    return s.putResource(new Blob([JSON.stringify(names)], { type: 'application/json' }))
  }
}

const _layout = new LayoutQueenBee()
window.ioc.register('@diamondcoreprocessor.com/LayoutQueenBee', _layout)
