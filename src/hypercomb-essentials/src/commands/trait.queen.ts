// commands/trait.queen.ts
//
// `trait` — the extension points a tile leaves open (documentation/traits.md).
//
//   trait                        what traits this tile has, and how each is filled
//   trait portrait tagline       open two traits on this tile
//   trait ~ tagline              close one
//
// The tile is the one you stand in. A trait is a `trait:point` decoration naming one word; opening and
// closing are ordinary decoration commits, so they undo like any other. Choosing a filler is `fill`
// (fill.queen.ts). Resolution is trait.ts: the tile's fill mark, then a child named the word, then
// tiles in this hive named the word. Nothing is minted for an empty trait.
//
// No aliases: a behaviour declares none (aliases are the participant's own).
import { QueenBee, isReservedPoolWord } from '@hypercomb/core'
import { removeDecorationAndWait, writeDecoration } from './decoration-manifest.js'
import { TRAIT_WANT_KIND, describeResolution, parseTraitArgs, sameWord, traitWords, type TraitWant } from './trait.js'
import { resolveTraitsAt, say, traitWantsAt, standing } from './trait-read.js'

export class TraitQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'trait'
  override description = 'The extension points this tile leaves open'
  override descriptionKey = 'slash.trait'
  override options = ['<word>', '~ <word>']
  override examples = [
    { input: '/trait', result: 'Lists this tile\'s traits and what fills each' },
    { input: '/trait portrait tagline', result: 'Opens two traits on this tile' },
    { input: '/trait ~ tagline', result: 'Closes the tagline trait' },
  ]

  // a trait word may be a behaviour word (`card`, `template`) — the whole line is this word's
  override rawArgs = true

  protected async execute(args: string): Promise<void> {
    const parsed = parseTraitArgs(args)
    if ('error' in parsed) { say('trait: say "trait", "trait <word>", or "trait ~ <word>"', 'error'); return }

    const here = standing()
    if (here.length === 0) { say('trait: stand in a tile to give it traits', 'error'); return }
    const name = here[here.length - 1]

    if (parsed.verb === 'list') {
      const all = await resolveTraitsAt(here)
      if (all.length === 0) { say(`"${name}" has no traits — trait <word> opens one`); return }
      say(all.map(describeResolution).join('\n'))
      return
    }

    const points = await traitWantsAt(here)

    if (parsed.verb === 'close') {
      let closed = 0
      for (const word of parsed.words) {
        for (const p of points.filter(p => sameWord(p.record.payload?.word, word))) {
          await removeDecorationAndWait({ sig: p.sig, segments: here }); closed++
        }
      }
      say(closed ? `"${name}" closed ${parsed.words.join(', ')}` : `"${name}" has no trait called ${parsed.words.join(', ')}`)
      return
    }

    const reserved = parsed.words.filter(w => isReservedPoolWord(w))
    if (reserved.length) { say(`trait: ${reserved.join(', ')} is a word the hive keeps for itself`, 'error'); return }

    const have = traitWords(points.map(p => p.record.payload))
    const opened: string[] = []
    for (const word of parsed.words) {
      if (have.some(w => sameWord(w, word)) || opened.some(w => sameWord(w, word))) continue
      await writeDecoration<TraitWant>({ kind: TRAIT_WANT_KIND, appliesTo: here, segments: here, payload: { word }, mark: 'persistent' })
      opened.push(word)
    }
    say(opened.length ? `"${name}" now leaves ${opened.join(', ')} open` : `"${name}" already has ${parsed.words.join(', ')}`)
  }
}

const _trait = new TraitQueenBee()
window.ioc.register('@diamondcoreprocessor.com/TraitQueenBee', _trait)
