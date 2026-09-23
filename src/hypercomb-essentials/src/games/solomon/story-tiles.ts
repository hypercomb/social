// The story tiles as the game and the word both read them: every bundle in
// the `stories` layer, minus the ones put away. HIDE FIRST, DELETE SECOND:
// unplugging an add-on conceals it in the hive's one hidden pool, by the
// signature of its bytes; plugging it again reveals it. Nothing is deleted,
// and nothing here may be — a story add-on is put away and taken back, only.
import { SignatureService } from '@hypercomb/core'
import { conceal, listConcealed, reveal } from '../../concealment/concealment.js'
import { readStoryBundle } from './story-addons.js'
import type { SolomonTileSurface, StorySeedTile } from './tile-surface.js'

/** The concealment scope — the word's own name for the kind of thing. */
export const STORY_SCOPE = 'solomon-story'

/** The signature of an add-on's bytes, as the game holds them. */
export async function storySig(raw: unknown): Promise<string> {
  return SignatureService.sign(new TextEncoder().encode(JSON.stringify(raw)).buffer as ArrayBuffer)
}

export interface StoryTile {
  readonly raw: unknown
  readonly sig: string
  /** Put away: the tile stands, the story is not seated. */
  readonly unplugged: boolean
}

async function putAway(): Promise<Set<string>> {
  return new Set((await listConcealed()).filter(item => item.scope === STORY_SCOPE).map(item => item.sig))
}

/** Every story tile's bundle, with its signature and whether it is put away;
 *  null before the layer exists. */
export async function readStoryTiles(surface: Pick<SolomonTileSurface, 'readStories'>): Promise<StoryTile[] | null> {
  const raws = await surface.readStories()
  if (!raws) return null
  const hidden = await putAway()
  return Promise.all(raws.map(async raw => { const sig = await storySig(raw); return { raw, sig, unplugged: hidden.has(sig) } }))
}

/** The bundles the game seats: the layer's (seeded once), minus the ones put away. */
export async function pluggedStories(surface: Pick<SolomonTileSurface, 'ensureStories'>, seeds: readonly StorySeedTile[]): Promise<unknown[]> {
  const raws = await surface.ensureStories(seeds)
  const hidden = await putAway()
  const plugged: unknown[] = []
  for (const raw of raws) if (!hidden.has(await storySig(raw))) plugged.push(raw)
  return plugged
}

/** The tile whose bundle carries this id, if any. */
export async function storyTileNamed(surface: Pick<SolomonTileSurface, 'readStories'>, id: string): Promise<StoryTile | null> {
  const tiles = await readStoryTiles(surface)
  return tiles?.find(tile => readStoryBundle(tile.raw)?.id === id) ?? null
}

/** Puts one add-on away by its bundle's id. Never deletable: it can only be
 *  taken back. */
export async function unplugStory(surface: Pick<SolomonTileSurface, 'readStories'>, id: string): Promise<{ readonly ok: boolean; readonly name: string } | null> {
  const tile = await storyTileNamed(surface, id)
  const bundle = tile ? readStoryBundle(tile.raw) : null
  if (!tile || !bundle) return null
  const ok = await conceal({ sig: tile.sig, scope: STORY_SCOPE, label: bundle.name, from: `stories/${id}`, deletable: false })
  return { ok, name: bundle.name }
}

/** Takes an add-on back out of hiding, by the signature of its bytes. */
export const replugStory = (sig: string): Promise<boolean> => reveal(sig)
