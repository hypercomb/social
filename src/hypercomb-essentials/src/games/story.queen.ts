// The word for plugging a story into Solomon's Key. A participant's add-on
// arrives as a JSON resource — a bundle of places and seats (see
// documentation/solomon-story-addons.md); `story plug <sig>` reads it,
// refuses it whole with the reason when anything is wrong, and otherwise
// writes it as a tile under the game's `stories` layer, where the game finds
// it the next time it opens. `story list` says what the game holds.
import { QueenBee, EffectBus } from '@hypercomb/core'
import { readStoryBundle, STORY_BUNDLE_BYTES, STORY_SEEDS } from './solomon/story-addons.js'
import { createSolomonTileSurface } from './solomon/tile-surface.js'

const ICON = 'auto_stories'
const SIGNATURE = /^[0-9a-f]{64}$/i

type StoreShape = { getResource(sig: string): Promise<Blob | null> }
const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)
const say = (message: string): void => { EffectBus.emit('activity:log', { message, icon: ICON }) }

export class StoryQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'story'
  override description = 'A story add-on for Solomon’s Key — a participant’s places and seats, plugged into the story'
  override options = ['plug <sig>', 'list']
  override examples = [
    { input: '/story plug 3f2a…', result: 'Reads the bundle at that signature and seats it into the story' },
    { input: '/story list', result: 'Lists the story add-ons the game holds' },
  ]
  override machine = {
    forms: 'plug <sig> | list',
    example: '/story list',
    reach: 'additive' as const,
    scope: 'hive' as const,
    refuse: (args: string): string | undefined => {
      const [verb = '', rest = ''] = args.trim().split(/\s+/, 2)
      if (verb === 'list') return undefined
      if (verb === 'plug') return SIGNATURE.test(rest) ? undefined : 'plug takes the 64-hex signature of a JSON bundle'
      return 'say plug <sig> or list'
    },
  }

  override slashComplete(args: string): readonly string[] {
    const [verb = ''] = args.trim().toLowerCase().split(/\s+/, 1)
    return ['plug', 'list'].filter(option => option.startsWith(verb))
  }

  protected async execute(args: string): Promise<void> {
    const [verb = '', rest = ''] = args.trim().split(/\s+/, 2)
    if (verb === 'list') { await this.#list(); return }
    if (verb === 'plug') { await this.#plug(rest.trim()); return }
    say('A story add-on is plugged in by its signature: story plug <sig>. story list says what the game holds.')
  }

  /** `story plug <sig>`: the bundle is read whole or refused whole, then
   *  becomes the tile the game reads. */
  async #plug(sig: string): Promise<void> {
    if (!SIGNATURE.test(sig)) { say('story plug takes the signature of a JSON bundle — 64 hex characters.'); return }
    const store = get<StoreShape>('@hypercomb.social/Store')
    if (!store?.getResource) { say('The hive’s store is not here to read the bundle from.'); return }
    const blob = await store.getResource(sig.toLowerCase())
    if (!blob) { say(`Nothing is stored under ${sig.slice(0, 8)}…`); return }
    if (blob.size > STORY_BUNDLE_BYTES) { say(`That is ${Math.ceil(blob.size / 1024)} KB — a story add-on may weigh ${STORY_BUNDLE_BYTES / 1024} KB at most.`); return }
    let raw: unknown
    try { raw = JSON.parse(await blob.text()) } catch { say(`${sig.slice(0, 8)}… is not JSON.`); return }
    const bundle = readStoryBundle(raw)
    if (!bundle) { say(`${sig.slice(0, 8)}… is not a story add-on the game can read — see documentation/solomon-story-addons.md for the shape.`); return }
    try {
      await createSolomonTileSurface().plugStory(bundle.id, raw, STORY_SEEDS)
    } catch (error) {
      say(`Could not write the story tile: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const places = [...bundle.worlds, ...bundle.chambers, ...bundle.caverns].map(place => place.id)
    say(`“${bundle.name}” is plugged in — ${places.length} place${places.length === 1 ? '' : 's'} (${places.join(', ')}), ${bundle.seats.length} seat${bundle.seats.length === 1 ? '' : 's'}. It stands the next time Solomon’s Key opens.`)
  }

  async #list(): Promise<void> {
    let raws: unknown[] | null
    try { raws = await createSolomonTileSurface().readStories() } catch (error) {
      say(`Could not read the story tiles: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    if (!raws) { say('No story add-ons yet: the game seeds its worked example the first time it opens.'); return }
    const lines = raws.map(raw => {
      const bundle = readStoryBundle(raw)
      if (!bundle) return 'an add-on the game cannot read'
      const places = [...bundle.worlds, ...bundle.chambers, ...bundle.caverns].map(place => place.id)
      return `${bundle.name} (${bundle.id}): ${places.join(', ') || 'no places'}; ${bundle.seats.map(seat => `${seat.entrance} → ${seat.place}`).join(', ') || 'no seats'}`
    })
    say(lines.length ? `Story add-ons: ${lines.join(' · ')}` : 'The stories layer is there, with nothing in it yet.')
  }
}
