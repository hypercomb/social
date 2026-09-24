// The word for plugging a story into Solomon's Key. A participant's add-on
// arrives as a JSON resource — a bundle of places and seats (see
// documentation/solomon-story-addons.md); `story plug <sig>` reads it,
// refuses it whole with the reason when anything is wrong, and otherwise
// writes it as a tile under the game's `stories` layer, where the game finds
// it the next time it opens. `story unplug <id>` puts one away — hidden,
// never deleted — and `story plug <id>` takes it back. `story list` says
// what the game holds.
import { QueenBee, EffectBus } from '@hypercomb/core'
import { seatAt, splitEntranceKey } from './solomon/place.js'

// SOLOMON'S CODE ARRIVES WITH THE WORD, not at boot (atomic-modules-plan.md,
// "adopt the proper load"): the story's places, levels, add-ons and tiles are
// needed only when the word runs, so they load then, once — and a tile whose
// face is the game warms them before that (the tile walk). Only the entrance
// key stays static: `refuse` answers synchronously.
type Solomon = typeof import('./solomon/levels.js') & typeof import('./solomon/places.js') & typeof import('./solomon/story.js')
  & typeof import('./solomon/story-addons.js') & typeof import('./solomon/story-tiles.js') & typeof import('./solomon/tile-surface.js')
let solomon: Promise<Solomon> | null = null
const loadSolomon = (): Promise<Solomon> => solomon ??= Promise.all([
  import('./solomon/levels.js'), import('./solomon/places.js'), import('./solomon/story.js'),
  import('./solomon/story-addons.js'), import('./solomon/story-tiles.js'), import('./solomon/tile-surface.js'),
]).then(parts => Object.assign({}, ...parts) as Solomon).catch(error => { solomon = null; throw error })

/** Solomon's code for a word, or a line the participant sees when it cannot
 *  load — every other failure of this word already speaks through `say`. */
const solomonOrSay = async (): Promise<Solomon | null> => {
  try { return await loadSolomon() } catch (error) {
    say(`Could not load Solomon’s Key: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

const ICON = 'auto_stories'
const SIGNATURE = /^[0-9a-f]{64}$/i
const ID = /^[a-z0-9-]{1,64}$/
/** A Designer creation's id, or enough of its start to name one. */
const CREATION = /^[0-9a-f]{8,64}$/i
/** The first word, and everything after it. */
const verbAndRest = (args: string): [string, string] => {
  const trimmed = args.trim()
  const space = trimmed.search(/\s/)
  return space < 0 ? [trimmed, ''] : [trimmed.slice(0, space), trimmed.slice(space).trim()]
}

type StoreShape = { getResource(sig: string): Promise<Blob | null> }
const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)
const say = (message: string): void => { EffectBus.emit('activity:log', { message, icon: ICON }) }

export class StoryQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'story'
  override description = 'A story add-on for Solomon’s Key — a participant’s places and seats, plugged into the story'
  override options = ['plug <sig>', 'plug <id>', 'unplug <id>', 'room <creation> <entrance>', 'list']
  override examples = [
    { input: '/story plug 3f2a…', result: 'Reads the bundle at that signature and seats it into the story' },
    { input: '/story room 9c1e4b02 mossback/old-mine', result: 'Seats a room saved in the Designer behind that entrance, as a labyrinth of its own' },
    { input: '/story unplug mossback', result: 'Puts that add-on away — hidden, not deleted' },
    { input: '/story plug mossback', result: 'Takes a put-away add-on back' },
    { input: '/story list', result: 'Lists the story add-ons the game holds' },
  ]
  override machine = {
    forms: 'plug <sig> | plug <id> | unplug <id> | room <creation> <entrance> | list',
    example: '/story list',
    reach: 'editing' as const,
    scope: 'hive' as const,
    refuse: (args: string): string | undefined => {
      const [verb, rest] = verbAndRest(args)
      if (verb === 'list') return undefined
      if (verb === 'plug') return SIGNATURE.test(rest) || ID.test(rest) ? undefined : 'plug takes the 64-hex signature of a JSON bundle, or the id of a put-away add-on'
      if (verb === 'unplug') return ID.test(rest) ? undefined : 'unplug takes the id of an add-on the game holds'
      if (verb === 'room') {
        const [creation = '', entrance = ''] = rest.split(/\s+/, 2)
        return CREATION.test(creation) && splitEntranceKey(entrance) ? undefined : 'room takes a saved room’s id (its first eight characters or more) and an entrance, <place>/<thing>'
      }
      return 'say plug <sig>, unplug <id>, room <creation> <entrance> or list'
    },
  }

  override slashComplete(args: string): readonly string[] {
    const [verb = ''] = args.trim().toLowerCase().split(/\s+/, 1)
    return ['plug', 'unplug', 'room', 'list'].filter(option => option.startsWith(verb))
  }

  protected async execute(args: string): Promise<void> {
    const [verb, rest] = verbAndRest(args)
    if (verb === 'list') { await this.#list(); return }
    if (verb === 'plug') { await this.#plug(rest.trim()); return }
    if (verb === 'unplug') { await this.#unplug(rest.trim()); return }
    if (verb === 'room') { const [creation = '', entrance = ''] = rest.trim().split(/\s+/, 2); await this.#room(creation, entrance); return }
    say('A story add-on is plugged in by its signature: story plug <sig>. story room <creation> <entrance> seats a room from the Designer; story unplug <id> puts one away; story list says what the game holds.')
  }

  /** Seats every plugged story tile the game holds, as its opening would;
   *  an add-on already seated this session keeps its first reading. */
  async #seatKnown(): Promise<void> {
    const code = await solomonOrSay()
    if (!code) return
    const { installStory, readStoryBundle, STORY_SEEDS, pluggedStories, createSolomonTileSurface } = code
    let raws: unknown[]
    try { raws = await pluggedStories(createSolomonTileSurface(), STORY_SEEDS) } catch { return }
    for (const raw of raws) {
      const bundle = readStoryBundle(raw)
      if (bundle) installStory(bundle)
    }
  }

  /** `story room <creation> <entrance>`: a room saved in the Designer becomes
   *  a labyrinth of its own, seated behind the entrance — one act, no JSON. */
  async #room(creation: string, entrance: string): Promise<void> {
    if (!CREATION.test(creation)) { say('story room takes a saved room’s id from the Designer (its first eight characters or more) and the entrance to seat it behind, like mossback/old-mine.'); return }
    const code = await solomonOrSay()
    if (!code) return
    const { loadCreations, PLACES, STORY, readStoryBundle, STORY_SEEDS, replugStory, storySig, createSolomonTileSurface } = code
    const found = loadCreations().filter(candidate => candidate.id.startsWith(creation.toLowerCase()))
    if (!found.length) { say(`No saved room starts with ${creation} — the Designer’s saved rooms are what this seats.`); return }
    if (found.length > 1) { say(`${found.length} saved rooms start with ${creation}; give more of the id.`); return }
    const split = splitEntranceKey(entrance)
    if (!split) { say('The entrance is <place>/<thing>, like mossback/old-mine.'); return }
    // An add-on's own place stands only once its tile is seated — the game
    // does that at opening; the word does it now, so the Mossback's things
    // are entrances before the game has been opened this session.
    if (!PLACES.has(split.place)) await this.#seatKnown()
    const host = PLACES.get(split.place)
    if (!host) { say(`"${split.place}" is not a place.`); return }
    if (!host.entrances.includes(split.entrance)) { say(`"${split.place}" has nothing called "${split.entrance}".`); return }
    if (seatAt(STORY, entrance)) { say(`"${entrance}" already has a place seated behind it.`); return }
    const [saved] = found
    const name = saved!.level.name.trim() || 'A room', stem = saved!.id.slice(0, 8), labyrinthId = `room-${stem}`
    const raw = {
      version: 1, id: labyrinthId, name,
      labyrinths: [{ id: labyrinthId, name, rooms: [{ id: 'room', level: saved!.level }] }],
      seats: [{ entrance, place: labyrinthId }],
    }
    const bundle = readStoryBundle(raw)
    if (!bundle) { say(`The room ${stem}… cannot be seated as it is — it has to run as a level, with Dana’s start inside its walls.`); return }
    try {
      await createSolomonTileSurface().plugStory(bundle.id, raw, STORY_SEEDS)
      await replugStory(await storySig(raw))
    } catch (error) {
      say(`Could not write the story tile: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    say(`“${name}” is seated behind ${entrance} as a labyrinth of its own. It stands the next time Solomon’s Key opens; walk in, and come back out with Escape.`)
  }

  /** `story unplug <id>`: put away, never deleted. The tile stands; the
   *  story is not seated until it is plugged again. */
  async #unplug(id: string): Promise<void> {
    if (!ID.test(id)) { say('story unplug takes the id of an add-on — story list names them.'); return }
    const code = await solomonOrSay()
    if (!code) return
    const { unplugStory, createSolomonTileSurface } = code
    let result: Awaited<ReturnType<typeof unplugStory>>
    try { result = await unplugStory(createSolomonTileSurface(), id) } catch (error) {
      say(`Could not read the story tiles: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    if (!result) { say(`No story add-on called “${id}” — story list names them.`); return }
    if (!result.ok) { say(`Could not put “${result.name}” away.`); return }
    say(`“${result.name}” is unplugged — put away, not deleted. story plug ${id} takes it back; either way it counts the next time Solomon’s Key opens.`)
  }

  /** `story plug <sig>`: the bundle is read whole or refused whole, then
   *  becomes the tile the game reads. `story plug <id>` takes a put-away
   *  add-on back. */
  async #plug(sig: string): Promise<void> {
    if (!SIGNATURE.test(sig) && !ID.test(sig)) { say('story plug takes the signature of a JSON bundle — 64 hex characters — or the id of a put-away add-on.'); return }
    const code = await solomonOrSay()
    if (!code) return
    const { readStoryBundle, STORY_BUNDLE_BYTES, STORY_SEEDS, replugStory, storySig, storyTileNamed, createSolomonTileSurface } = code
    if (!SIGNATURE.test(sig)) {
      let tile: Awaited<ReturnType<typeof storyTileNamed>>
      try { tile = await storyTileNamed(createSolomonTileSurface(), sig) } catch (error) {
        say(`Could not read the story tiles: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      if (!tile) { say(`No story add-on called “${sig}” — to plug a new one in, give its signature.`); return }
      if (!tile.unplugged) { say(`“${sig}” is plugged in already.`); return }
      say(await replugStory(tile.sig) ? `“${sig}” is plugged in again. It stands the next time Solomon’s Key opens.` : `Could not take “${sig}” back.`)
      return
    }
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
      await replugStory(await storySig(raw)) // an add-on plugged again is no longer put away
    } catch (error) {
      say(`Could not write the story tile: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const places = [...bundle.worlds, ...bundle.chambers, ...bundle.caverns].map(place => place.id), labyrinths = bundle.labyrinths.map(labyrinth => labyrinth.definition.id)
    const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
    say(`“${bundle.name}” is plugged in — ${count(places.length, 'place')}${places.length ? ` (${places.join(', ')})` : ''}, ${count(labyrinths.length, 'labyrinth')}${labyrinths.length ? ` (${labyrinths.join(', ')})` : ''}, ${count(bundle.seats.length, 'seat')}. It stands the next time Solomon’s Key opens.`)
  }

  async #list(): Promise<void> {
    const code = await solomonOrSay()
    if (!code) return
    const { readStoryBundle, readStoryTiles, createSolomonTileSurface } = code
    let tiles: Awaited<ReturnType<typeof readStoryTiles>>
    try { tiles = await readStoryTiles(createSolomonTileSurface()) } catch (error) {
      say(`Could not read the story tiles: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    if (!tiles) { say('No story add-ons yet: the game seeds its worked example the first time it opens.'); return }
    const lines = tiles.map(tile => {
      const bundle = readStoryBundle(tile.raw)
      if (!bundle) return 'an add-on the game cannot read'
      const places = [...bundle.worlds, ...bundle.chambers, ...bundle.caverns].map(place => place.id), labyrinths = bundle.labyrinths.map(labyrinth => labyrinth.definition.id)
      return `${bundle.name} (${bundle.id}${tile.unplugged ? ', unplugged' : ''}): ${[...places, ...labyrinths].join(', ') || 'no places'}; ${bundle.seats.map(seat => `${seat.entrance} → ${seat.arrive ? `${seat.place} (${seat.arrive})` : seat.place}`).join(', ') || 'no seats'}`
    })
    say(lines.length ? `Story add-ons: ${lines.join(' · ')}` : 'The stories layer is there, with nothing in it yet.')
  }
}
