// commands/seam.queen.ts
//
// `seam` — the extension points a tile leaves open (documentation/seams.md).
//
//   seam                        what seams this tile has, and how each is filled
//   seam portrait tagline       open two seams on this tile
//   seam ~ tagline              close one
//
// The tile is the one you stand in. A seam is a `seam:point` decoration naming one word; opening and
// closing are ordinary decoration commits, so they undo like any other. Choosing a filler is `fill`
// (fill.queen.ts). Resolution is seam.ts: the tile's fill mark, then a child named the word, then
// tiles in this hive named the word. Nothing is minted for an empty seam.
//
// No aliases: a behaviour declares none (aliases are the participant's own).
import { QueenBee, isReservedPoolWord } from '@hypercomb/core'
import { removeDecorationAndWait, writeDecoration } from './decoration-manifest.js'
import { SEAM_KIND, describeResolution, parseSeamArgs, sameWord, seamWords, type SeamPoint } from './seam.js'
import { resolveSeamsAt, say, seamPointsAt, standing } from './seam-read.js'

export class SeamQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'seam'
  override description = 'The extension points this tile leaves open'
  override descriptionKey = 'slash.seam'
  override options = ['<word>', '~ <word>']
  override examples = [
    { input: '/seam', result: 'Lists this tile\'s seams and what fills each' },
    { input: '/seam portrait tagline', result: 'Opens two seams on this tile' },
    { input: '/seam ~ tagline', result: 'Closes the tagline seam' },
  ]

  // a seam word may be a behaviour word (`card`, `template`) — the whole line is this word's
  override rawArgs = true

  protected async execute(args: string): Promise<void> {
    const parsed = parseSeamArgs(args)
    if ('error' in parsed) { say('seam: say "seam", "seam <word>", or "seam ~ <word>"', 'error'); return }

    const here = standing()
    if (here.length === 0) { say('seam: stand in a tile to give it seams', 'error'); return }
    const name = here[here.length - 1]

    if (parsed.verb === 'list') {
      const all = await resolveSeamsAt(here)
      if (all.length === 0) { say(`"${name}" has no seams — seam <word> opens one`); return }
      say(all.map(describeResolution).join('\n'))
      return
    }

    const points = await seamPointsAt(here)

    if (parsed.verb === 'close') {
      let closed = 0
      for (const word of parsed.words) {
        for (const p of points.filter(p => sameWord(p.record.payload?.word, word))) {
          await removeDecorationAndWait({ sig: p.sig, segments: here }); closed++
        }
      }
      say(closed ? `"${name}" closed ${parsed.words.join(', ')}` : `"${name}" has no seam called ${parsed.words.join(', ')}`)
      return
    }

    const reserved = parsed.words.filter(w => isReservedPoolWord(w))
    if (reserved.length) { say(`seam: ${reserved.join(', ')} is a word the hive keeps for itself`, 'error'); return }

    const have = seamWords(points.map(p => p.record.payload))
    const opened: string[] = []
    for (const word of parsed.words) {
      if (have.some(w => sameWord(w, word)) || opened.some(w => sameWord(w, word))) continue
      await writeDecoration<SeamPoint>({ kind: SEAM_KIND, appliesTo: here, segments: here, payload: { word }, mark: 'persistent' })
      opened.push(word)
    }
    say(opened.length ? `"${name}" now leaves ${opened.join(', ')} open` : `"${name}" already has ${parsed.words.join(', ')}`)
  }
}

const _seam = new SeamQueenBee()
window.ioc.register('@diamondcoreprocessor.com/SeamQueenBee', _seam)
