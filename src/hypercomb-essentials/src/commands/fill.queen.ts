// commands/fill.queen.ts
//
// `fill` — choose what fills a seam (documentation/seams.md).
//
//   fill portrait                       keep what fills it now (the child, or the one tile in this hive)
//   fill portrait /people/jwize/face    fill it with that tile, as it is now
//   fill portrait <signature>           fill it with that signature
//   fill ~ portrait                     forget the choice; the seam resolves again
//
// The tile is the one you stand in, and it must have the seam. The choice is a `seam:fill`
// decoration holding the filler's head signature: the head you took, not a route that may move.
// It is the only state seams keep, and an ordinary commit, so it undoes like any other.
//
// No aliases: a behaviour declares none (aliases are the participant's own).
import { QueenBee } from '@hypercomb/core'
import { removeDecorationAndWait, writeDecoration } from './decoration-manifest.js'
import { SEAM_FILL_KIND, isSig, parseFillArgs, sameWord, seamWords, type SeamFill } from './seam.js'
import { headAt, resolveSeamsAt, say, seamFillsAt, seamPointsAt, standing } from './seam-read.js'
import { routeFrom } from './card-wear.js'

export class FillQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'fill'
  override description = 'Choose what fills one of this tile\'s seams'
  override descriptionKey = 'slash.fill'
  override options = ['<seam>', '<seam> <tile>', '~ <seam>']
  override examples = [
    { input: '/fill portrait', result: 'Keeps what fills the portrait seam now' },
    { input: '/fill portrait /people/jwize/portrait', result: 'Fills it with that tile' },
    { input: '/fill ~ portrait', result: 'Forgets the choice' },
  ]

  // a route may contain a behaviour word — the whole line is this word's
  override rawArgs = true

  protected async execute(args: string): Promise<void> {
    const parsed = parseFillArgs(args)
    if ('error' in parsed) { say('fill: say "fill <seam>", "fill <seam> <tile>", or "fill ~ <seam>"', 'error'); return }

    const here = standing()
    if (here.length === 0) { say('fill: stand in a tile that has seams', 'error'); return }
    const name = here[here.length - 1]

    const words = seamWords((await seamPointsAt(here)).map(p => p.record.payload))
    const word = words.find(w => sameWord(w, parsed.word))
    if (!word) { say(`fill: "${name}" has no seam called ${parsed.word} — seam ${parsed.word} opens one`, 'error'); return }

    const prior = (await seamFillsAt(here)).filter(f => sameWord(f.record.payload?.word, word))

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
      const now = (await resolveSeamsAt(here)).find(r => sameWord(r.word, word))
      if (!now || now.rung === 'miss') { say(`fill: nothing fills ${word} yet — make a tile called ${word}, or name one`, 'error'); return }
      if (now.rung === 'choose') { say(`fill: ${now.candidates.length} tiles offer ${word} — fill ${word} <tile> to choose`, 'error'); return }
      if (now.rung === 'fill') { say(`${word} on "${name}" is already chosen`); return }
      sig = now.sig
      from = `/${now.route.join('/')}`
    }

    if (prior.length === 1 && prior[0].record.payload?.sig === sig) { say(`${word} on "${name}" is already ${from}`); return }
    for (const f of prior) await removeDecorationAndWait({ sig: f.sig, segments: here })
    await writeDecoration<SeamFill>({ kind: SEAM_FILL_KIND, appliesTo: here, segments: here, payload: { word, sig }, mark: 'persistent' })
    say(`${word} on "${name}" is filled by ${from}`)
  }
}

const _fill = new FillQueenBee()
window.ioc.register('@diamondcoreprocessor.com/FillQueenBee', _fill)
