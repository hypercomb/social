// commands/trait.queen.ts
//
// `trait` — the extension points a tile leaves open (documentation/traits.md).
//
//   trait                        this tile's traits, and how each is filled
//   trait portrait tagline       give it two traits: a tile is made to fill each
//   trait own name portrait      give it traits it already fills itself: no tiles, offers can replace them
//   trait ~ tagline              forget a trait given here (its tile stays)
//
// The tile is the one you stand in. A trait is a requirement some tiles have, an interface; a tile
// named the word fills it. Giving a trait keeps a `trait:want` record and makes the tile that fills
// it, so the requirement outlives the tile: hide the tile and its silhouette returns. Every write is
// an ordinary commit, so it undoes like any other. Choosing another filler is `fill`
// (fill.queen.ts); the rules are core's (core/trait.ts).
//
// No aliases: a behaviour declares none (aliases are the participant's own).
import { EffectBus, QueenBee, TRAITS_IOC_KEY, TRAIT_WANT_KIND, isReservedPoolWord, sameTraitWord, traitWords, type TraitWant } from '@hypercomb/core'
import { removeDecorationAndWait, writeDecoration } from './decoration-manifest.js'
import { describeResolution, parseTraitArgs } from './trait.js'
import { TraitService, childNamesAt, createTile, resolveTraitsAt, say, traitWantsAt, standing } from './trait-read.js'
import { savedRoots } from '../history/saved-roots.js'

export class TraitQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'trait'
  override description = 'The traits this tile leaves open for a filler'
  override descriptionKey = 'slash.trait'
  override options = ['<word>', 'own <word>', '~ <word>']
  override examples = [
    { input: '/trait', result: 'Lists this tile\'s traits and what fills each' },
    { input: '/trait portrait tagline', result: 'Gives this tile two traits and makes a tile to fill each' },
    { input: '/trait own name portrait', result: 'Says this creation fills name and portrait itself; others can be picked with fill' },
    { input: '/trait ~ tagline', result: 'Forgets the tagline trait; its tile stays' },
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
      const all = await resolveTraitsAt(here, { offers: true })
      if (all.length === 0) { say(`"${name}" has no traits — trait <word> opens one`); return }
      say(all.map(describeResolution).join('\n'))
      return
    }

    const points = await traitWantsAt(here)

    if (parsed.verb === 'close') {
      let closed = 0
      for (const word of parsed.words) {
        for (const p of points.filter(p => sameTraitWord(p.record.payload?.word, word))) {
          await removeDecorationAndWait({ sig: p.sig, segments: here }); closed++
        }
      }
      // Only a trait opened here can be closed; one the view declares belongs to the view.
      say(closed ? `"${name}" forgot ${parsed.words.join(', ')}` : `"${name}" was not given ${parsed.words.join(', ')} here — a trait its view declares stays`)
      return
    }

    const reserved = parsed.words.filter(w => isReservedPoolWord(w))
    if (reserved.length) { say(`trait: ${reserved.join(', ')} is a word the hive keeps for itself`, 'error'); return }
    const saved = parsed.words.filter(w => savedRoots().isSaved(w))
    if (saved.length) { say(`trait: ${saved.join(', ')} is a saved root — use ${saved[0]} turns it on`, 'error'); return }

    const own = parsed.verb === 'own'
    const have = traitWords(points.map(p => p.record.payload))
    const opened: string[] = []
    for (const word of parsed.words) {
      if (have.some(w => sameTraitWord(w, word)) || opened.some(w => sameTraitWord(w, word))) continue
      // `own` is core's TraitWant field; spelled as a plain record so this compiles against an older core build too.
      const payload = (own ? { word, own: true } : { word }) as TraitWant
      await writeDecoration<TraitWant>({ kind: TRAIT_WANT_KIND, appliesTo: here, segments: here, payload, mark: 'persistent' })
      opened.push(word)
    }

    // A trait the creation fills itself needs no tile: it already works (jwize, 2026-10-13).
    if (own) {
      say(opened.length ? `"${name}" fills ${opened.join(', ')} itself — fill <trait> <tile> picks another version` : `"${name}" already has ${parsed.words.join(', ')}`)
      return
    }

    // Giving a trait makes its tile (jwize, 2026-10-13: "as soon as you give a trait it should become
    // a tile"): the tile is the intent, before any behaviour fills it. The silhouette drone hears
    // `trait:given` first and plays the arrival; each tile lands where its silhouette stood.
    const children = await childNamesAt(here)
    const toMake = traitWords(parsed.words).filter(w => !children.some(c => sameTraitWord(c, w)))
    if (toMake.length) EffectBus.emitTransient('trait:given', { segments: [...here], words: toMake })
    const made: string[] = []
    for (const word of toMake) if (await createTile(word)) made.push(word)

    if (!opened.length && !made.length) { say(`"${name}" already has ${parsed.words.join(', ')}`); return }
    say(`"${name}" has ${traitWords([...opened, ...made]).join(', ')}`)
  }
}

const _trait = new TraitQueenBee()
window.ioc.register('@diamondcoreprocessor.com/TraitQueenBee', _trait)

// Traits are first-class: every behaviour and view asks this provider (core/trait.ts, TRAITS_IOC_KEY).
window.ioc.register(TRAITS_IOC_KEY, new TraitService())
