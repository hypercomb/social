// website/parts.queen.ts
//
// `parts` — THIS TILE'S PAGE, READ AS TRAITS AND FILLED WITH TILES.
//
// A page made elsewhere arrives as one file on one tile (`website page <sig>`
// dresses a tile with it). `parts` reads where that page already divides (its
// header, its navigation, each section of its main content, its footer) and
// says each division the way the hive says every extension point: as a TRAIT
// (documentation/traits.md).
//
//   the trait   the placeholder. A word (`header`, `bread`, `footer`) naming a
//               kind of part. It says what belongs there and nothing about
//               which tile supplies it.
//   the tile    an implementation. A child named the word fills the trait; it
//               wears its own page and opens alone.
//
// So for the page at <tile> it does three things:
//
//   1. the page states each trait on the element that is its own version of it
//      (one attribute; the page draws exactly as it did);
//   2. <tile> is given each trait, as one it already fills itself;
//   3. a child tile named each word is made and dressed with that part.
//
// WHAT THIS BUYS. The word is an address: `sign(header)` is the same pool on
// every host, so every header anyone made is an offer for this page's header,
// and `fill` picks one. Swapping a part is filling one trait. And because the
// page keeps its own version in place, hiding or removing a filler leaves a
// finished page, never a hole.
//
// NO PARENT, NO POSITIONS. Nothing here files parts on a shelf or numbers
// them. A part is where it is because the page states that trait there.
//
// SAYING IT AGAIN CHANGES NOTHING. Every byte is named by its content, a trait
// already given is not given twice, a tile already wearing a page is left
// alone. A trait the page already states keeps its word even if its heading
// was reworded since.
//
// First of the html helpers (jwize 2026-11-15: "beehaviors that can be
// recommended for construction of an html single file into a well organized
// piece"; "traits are placeholders and named type is the part so that you can
// fill in the traits with implementation blocks (tiles)").

import {
  QueenBee, EffectBus, hypercomb, isReservedPoolWord, sameTraitWord, TRAIT_WANT_KIND,
  type MachineGrammar, type TraitWant,
} from '@hypercomb/core'
import { writeDecoration } from '../commands/decoration-manifest.js'
import { traitWantsAt } from '../commands/trait-read.js'
import { commitPageSigFrom } from '../files/page-commit.js'
import { writeTilePropertiesAt } from '../editor/tile-properties.js'
import { mintCreationId, stampCreation } from '../assistant/creation.js'
import { cutPage, partDocument } from './page-cut.js'
import { pageHtmlAt, pageSigAt, putText, routeWords, service, shareStyle, standingAt } from './page-hive.js'

const PARTS_TASK = 'page-parts'

type HistoryLike = {
  sign(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<Record<string, unknown> | null>
}
type CommitterLike = { settled?: () => Promise<void> }

const exists = async (segments: readonly string[]): Promise<boolean> => {
  const history = service<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
  if (!history) return false
  const layer = await history.currentLayerAt(await history.sign({ explorerSegments: () => segments })).catch(() => null)
  return layer !== null
}

/** Add tiles by name under a parent and wait until they have landed. `cell:added`
 *  is the append to the parent's children; it never replaces what is there. */
async function addTiles(parent: readonly string[], names: readonly string[]): Promise<void> {
  if (names.length === 0) return
  for (const name of names) EffectBus.emit('cell:added', { cell: name, segments: [...parent] })
  await new hypercomb().act()
  await service<CommitterLike>('@diamondcoreprocessor.com/LayerCommitter')?.settled?.()
}

export class PartsQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'parts'
  override description = 'Read this tile\'s page as traits (header, each section, footer) and make a tile that fills each'
  override examples = [
    { input: '/parts', result: 'Gives this tile a trait for each part of its page and makes a child tile, named the trait, that fills it with that part' },
  ]

  // OFFERED TO A MODEL. ADDITIVE: traits and tiles that were not there arrive;
  // the page gains one attribute per part and draws as it did. PAGE: which
  // tiles this tile holds changes. Nothing leaves the device.
  override machine: MachineGrammar = {
    forms: '',
    example: 'parts',
    bare: true,
    reach: 'additive',
    scope: 'page',
    consequence: 'Reads the page worn by the tile the participant stands on as traits: its header, its navigation, each section of its main content and its footer, each named by what it calls itself. The page then states each trait where its own version of it is, and draws as it did. The tile is given each trait as one it already fills itself, and under it a child tile named each trait is made, wearing that part as its own page; that child fills the trait. The page\'s CSS is put once as shared sheets every part links by signature. A page with fewer than two parts is refused. Saying it again writes nothing that is already there. Another tile is chosen for a trait with fill.',
  }

  protected async execute(): Promise<void> {
    const at = standingAt()
    const where = routeWords(at)
    if (at.length === 0) throw new Error('parts reads the page a tile wears; walk into the tile first. Nothing was made')

    const html = await pageHtmlAt(at)
    // The page the parts are cut from: they are this hive's own only when it is.
    const source = await pageSigAt(at)
    if (!html) throw new Error(`${where} wears no page; dress it with website page <signature> first. Nothing was made`)
    // A word the hive keeps for itself cannot be a trait; that part is named by its kind.
    const cut = cutPage(html, word => isReservedPoolWord(word))
    if (!cut) throw new Error(`the page at ${where} does not divide into parts (it needs at least two of: a header, sections, a footer). Nothing was made`)
    const words = cut.parts.map(part => part.name)

    // The look, put once. Every part links it; none copies it.
    const style = await shareStyle(cut.css, cut.links)

    // 1. The page states its traits.
    let wrote = 0
    if (cut.unmarked > 0) {
      const result = await commitPageSigFrom(at, await putText(cut.marked), source)
      if (!result.ok) throw new Error(`the page could not be written: ${result.error}. Nothing was made`)
      wrote++
    }

    // 2. The tile has them. Its page holds a working version of each, so each
    //    is given as its own: a filler replaces it, and nothing is owed.
    const given = (await traitWantsAt(at)).map(want => want.record.payload?.word)
    for (const word of words) {
      if (given.some(have => sameTraitWord(have, word))) continue
      await writeDecoration<TraitWant>({
        kind: TRAIT_WANT_KIND, appliesTo: at, segments: at, payload: { word, own: true } as TraitWant, mark: 'persistent',
      })
      wrote++
    }

    // 3. A tile named the word fills each.
    const fresh: string[] = []
    for (const word of words) if (!await exists([...at, word])) fresh.push(word)
    await addTiles(at, fresh)

    const creationId = await mintCreationId(PARTS_TASK, at, Date.now())
    for (let index = 0; index < cut.parts.length; index++) {
      const part = cut.parts[index]
      const segments = [...at, words[index]]
      const made = fresh.includes(words[index])
      // A tile that was already there is somebody's implementation of the
      // trait. It is dressed only if it wears no page at all; what it wears is
      // never replaced by the page's own version.
      if (made || !await pageSigAt(segments)) {
        const result = await commitPageSigFrom(segments, await putText(partDocument(cut, part, style)), source)
        if (!result.ok) throw new Error(`the tile ${words[index]} could not be dressed: ${result.error}. The parts before it are in place`)
        wrote++
      }
      if (made) {
        await stampCreation(segments, creationId, PARTS_TASK, 'part')
        // On the hexagons a part shows the picture it is about, when the hive
        // already holds one. A part that shows none keeps the tile's own face.
        if (part.picture) {
          await writeTilePropertiesAt(at, words[index], { small: { image: part.picture } }).catch(() => { /* the part is made; its face is not load-bearing */ })
        }
      }
    }

    const count = words.length
    const message = wrote === 0
      ? `${where} already has its ${count} traits and a tile filling each; nothing was written`
      : `${where} has ${count} traits, each filled by a tile of its name: ${words.join(', ')}`
    EffectBus.emit('toast:show', { type: wrote === 0 ? 'info' : 'success', message })
    EffectBus.emit('activity:log', { message, icon: '●' })
  }
}

const _parts = new PartsQueenBee()
window.ioc.register('@diamondcoreprocessor.com/PartsQueenBee', _parts)
