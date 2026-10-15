// commands/fill.queen.ts
//
// `fill` — choose what fills a trait (documentation/traits.md).
//
//   fill portrait                       keep what fills it now (the child, or the one tile in this hive)
//   fill portrait /people/jwize/face    fill it with that tile, as it is now
//   fill portrait <signature>           fill it with that signature
//   fill ~ portrait                     forget the choice; the trait resolves again
//
// The tile is the one you stand in, and it must have the trait. The choice is a `trait:fill`
// decoration holding the filler's head signature: the head you took, not a route that may move.
// It is the only state traits keep, and an ordinary commit, so it undoes like any other.
//
// No aliases: a behaviour declares none (aliases are the participant's own).
import { QueenBee } from '@hypercomb/core'
import { removeDecorationAndWait, writeDecoration } from './decoration-manifest.js'
import { TRAIT_FILL_KIND, sameTraitWord, type TraitFill } from '@hypercomb/core'
import { parseFillArgs } from './trait.js'
import { headAt, isSig, resolveTraitsAt, say, standing, traitFillsAt, traitsAt } from './trait-read.js'
import { routeFrom } from './card-wear.js'

export class FillQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'fill'
  override description = 'Choose what fills one of this tile\'s traits'
  override descriptionKey = 'slash.fill'
  override options = ['<trait>', '<trait> <tile>', '~ <trait>']
  override examples = [
    { input: '/fill portrait', result: 'Keeps what fills the portrait trait now' },
    { input: '/fill portrait /people/jwize/portrait', result: 'Fills it with that tile' },
    { input: '/fill ~ portrait', result: 'Forgets the choice' },
  ]

  // a route may contain a behaviour word — the whole line is this word's
  override rawArgs = true

  protected async execute(args: string): Promise<void> {
    const parsed = parseFillArgs(args)
    if ('error' in parsed) { say('fill: say "fill <trait>", "fill <trait> <tile>", or "fill ~ <trait>"', 'error'); return }

    const here = standing()
    if (here.length === 0) { say('fill: stand in a tile that has traits', 'error'); return }
    const name = here[here.length - 1]

    const word = (await traitsAt(here)).map(t => t.word).find(w => sameTraitWord(w, parsed.word))
    if (!word) { say(`fill: "${name}" has no trait called ${parsed.word} — trait ${parsed.word} opens one`, 'error'); return }

    const prior = (await traitFillsAt(here)).filter(f => sameTraitWord(f.record.payload?.word, word))

    if (parsed.verb === 'clear') {
      for (const f of prior) await removeDecorationAndWait({ sig: f.sig, segments: here })
      say(prior.length ? `${word} on "${name}" resolves again` : `${word} on "${name}" had no choice to forget`)
      return
    }

    let sig = ''
    let from = ''
    if (parsed.verb === 'with') {
      if (isSig(parsed.source.toLowerCase())) { sig = parsed.source.toLowerCase(); from = 'that signature' }
      else {
        const route = routeFrom(here, parsed.source)
        sig = await headAt(route)
        from = `/${route.join('/')}`
        if (!sig) { say(`fill: nothing at ${from}`, 'error'); return }
      }
    } else {
      const now = (await resolveTraitsAt(here)).find(r => sameTraitWord(r.word, word))
      if (!now || now.rung === 'miss') { say(`fill: nothing fills ${word} yet — make a tile called ${word}, or name one`, 'error'); return }
      if (now.rung === 'choose') { say(`fill: ${now.candidates.length} tiles offer ${word} — fill ${word} <tile> to choose`, 'error'); return }
      if (now.rung === 'fill') { say(`${word} on "${name}" is already chosen`); return }
      if (now.rung === 'own') { say(`${word} on "${name}" uses its own version — fill ${word} <tile> to replace it`); return }
      sig = now.sig
      from = `/${now.route.join('/')}`
    }

    if (prior.length === 1 && prior[0].record.payload?.sig === sig) { say(`${word} on "${name}" is already ${from}`); return }
    for (const f of prior) await removeDecorationAndWait({ sig: f.sig, segments: here })
    await writeDecoration<TraitFill>({ kind: TRAIT_FILL_KIND, appliesTo: here, segments: here, payload: { word, sig }, mark: 'persistent' })
    say(`${word} on "${name}" is filled by ${from}`)
  }
}

const _fill = new FillQueenBee()
window.ioc.register('@diamondcoreprocessor.com/FillQueenBee', _fill)
