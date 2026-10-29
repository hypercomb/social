// files/tile-files.drone.ts
//
// A TILE'S FILES, READ AND WRITTEN AS TEXT — the door a model's
// `hypercomb-write` block uses to make a file (hypercomb-work-fence.ts). Two
// kinds of file live on a tile:
//
//   page — the tile's website page. The bytes are a resource. A page written
//          here is a trial: it opens at try-<name>.<this host> and the site
//          view does not mount it in this hive.
//   file — an attachment by name: a `files:attachment` decoration whose
//          payload points at the bytes (files-attachment.ts).
//
// Text only, on a tile that exists. A write never deletes: the bytes it
// replaces stay at the content root and the tile's history still reaches
// them, so a write is one undo away. The caller owns approval and edits —
// this door is handed the finished text.

import { Drone } from '@hypercomb/core'
import { listDecorations, removeDecorationAndWait, writeDecoration } from '../commands/decoration-manifest.js'
import { ensureWebsiteBoundAt } from '../commands/website-binding.js'
import { FILES_ATTACHMENT_KIND, listAttachments, writeAttachment, type AttachmentPayload } from './files-attachment.js'
import { extOf } from './file-types.js'
import { rememberTrial, stageTrial, trialLabel, trialOrigin } from './try-page.js'

export const TILE_FILES_IOC_KEY = '@diamondcoreprocessor.com/TileFilesDrone'

const PAGE_KIND = 'visual:website:page'
const WEBSITE_SLOT = 'website'
/** Generous for a page or a document; a model cannot usefully write more in one block. */
export const MAX_TILE_FILE_CHARS = 400_000

/** Extensions a written file may have, and the type each is stored as. */
const TEXT_TYPES: Readonly<Record<string, string>> = {
  txt: 'text/plain', md: 'text/markdown', html: 'text/html', htm: 'text/html', css: 'text/css',
  csv: 'text/csv', json: 'application/json', xml: 'application/xml', svg: 'image/svg+xml',
  yml: 'text/yaml', yaml: 'text/yaml', toml: 'text/plain', js: 'text/javascript', mjs: 'text/javascript',
  ts: 'text/plain', ics: 'text/calendar', log: 'text/plain',
}

export type TileFileTarget = {
  readonly route: readonly string[]
  readonly kind: 'page' | 'file'
  /** The attachment's file name — required for `file`, unused for `page`. */
  readonly name?: string
}

export type TileFileRead =
  | { readonly ok: true; readonly tile: readonly string[]; readonly text: string | null; readonly sig?: string }
  | { readonly ok: false; readonly error: string }

export type TileFileWrite =
  | { readonly ok: true; readonly tile: readonly string[]; readonly sig: string; readonly created: boolean; readonly unchanged: boolean; readonly trial?: string; readonly vector?: string }
  | { readonly ok: false; readonly error: string }

type StoreLike = {
  putResource(blob: Blob): Promise<string>
  getResource(sig: string): Promise<Blob | null>
}
type TreeReaderLike = {
  readNode?(segments: readonly string[], options: { maxBytes?: number; withContent?: boolean }): Promise<
    { ok: true; children: readonly { name: string }[] } | { ok: false; code?: string }
  >
}
type HistoryLike = {
  sign(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<Record<string, unknown> | null>
}
type CommitterLike = { commitSlotSet?(segments: readonly string[], slot: string, sigs: readonly string[]): Promise<void> }
type SiteViewLike = { resolvePageSig?(segments: readonly string[]): Promise<string | null> }

const isSig = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

export class TileFilesDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'files'
  override description = 'reads and writes a tile\'s page and its text files for a model\'s write block'

  protected override deps = {
    store: '@hypercomb.social/Store',
    history: '@diamondcoreprocessor.com/HistoryService',
    committer: '@diamondcoreprocessor.com/LayerCommitter',
    reader: '@diamondcoreprocessor.com/HypercombHiveTreeReader',
    siteView: '@diamondcoreprocessor.com/SiteViewDrone',
  }

  /** Writes one at a time: two blocks writing the same tile would otherwise
   *  read the same prior and both replace it. */
  #chain: Promise<unknown> = Promise.resolve()

  /** The type a file of this name is stored as, or undefined when it is not text. */
  typeOf(name: string): string | undefined {
    return TEXT_TYPES[extOf(name)]
  }

  /** The file as it is now. `text: null` when the tile has none yet. */
  async read(target: TileFileTarget): Promise<TileFileRead> {
    const tile = await this.#tile(target.route)
    if ('error' in tile) return tile
    const store = this.resolve<StoreLike>('store')
    if (!store?.getResource) return { ok: false, error: 'the store is not available' }
    const sig = target.kind === 'page'
      ? await this.resolve<SiteViewLike>('siteView')?.resolvePageSig?.(tile.segments) ?? null
      : (await this.#attachment(tile.segments, target.name ?? ''))?.payload.sig ?? null
    if (!sig) return { ok: true, tile: tile.segments, text: null }
    const blob = await store.getResource(sig).catch(() => null)
    if (!blob) return { ok: false, error: `the ${target.kind === 'page' ? 'page' : `file ${target.name}`} is named but its bytes are not on this device` }
    return { ok: true, tile: tile.segments, text: await blob.text(), sig }
  }

  /** Make or replace the file with `text`. */
  write(target: TileFileTarget, text: string): Promise<TileFileWrite> {
    const run = this.#chain.then(() => this.#write(target, text))
    this.#chain = run.catch(() => undefined)
    return run
  }

  async #write(target: TileFileTarget, text: string): Promise<TileFileWrite> {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'the file would be empty' }
    if (text.length > MAX_TILE_FILE_CHARS) return { ok: false, error: `the file is over ${MAX_TILE_FILE_CHARS} characters` }
    const name = String(target.name ?? '').trim()
    const type = target.kind === 'page' ? 'text/html' : this.typeOf(name)
    if (target.kind === 'file' && !name) return { ok: false, error: 'a file needs a name' }
    if (!type) return { ok: false, error: `${name} is not a text file; write one of: ${Object.keys(TEXT_TYPES).map(e => `.${e}`).join(' ')}` }
    const tile = await this.#tile(target.route)
    if ('error' in tile) return tile
    const store = this.resolve<StoreLike>('store')
    if (!store?.putResource) return { ok: false, error: 'the store is not available' }
    const blob = new Blob([text], { type })
    const sig = await store.putResource(blob)
    return target.kind === 'page'
      ? this.#writePage(tile.segments, sig, text)
      : this.#writeFile(tile.segments, { name, mime: type, size: blob.size, sig })
  }

  async #writePage(segments: readonly string[], htmlSig: string, html: string): Promise<TileFileWrite> {
    const current = await this.resolve<SiteViewLike>('siteView')?.resolvePageSig?.(segments) ?? null
    if (current === htmlSig) return { ok: true, tile: segments, sig: htmlSig, created: false, unchanged: true, ...this.#trial(segments) }
    // A page kept in the `website` slot wins over a decoration, so it is
    // written where the renderer will find it.
    const history = this.resolve<HistoryLike>('history')
    const layer = history ? await history.currentLayerAt(await history.sign({ explorerSegments: () => segments })).catch(() => null) : null
    const slot = Array.isArray(layer?.[WEBSITE_SLOT]) ? (layer![WEBSITE_SLOT] as unknown[]).filter(isSig) : []
    if (slot.length) {
      const committer = this.resolve<CommitterLike>('committer')
      if (!committer?.commitSlotSet) return { ok: false, error: 'the layer committer is not available' }
      await committer.commitSlotSet(segments, WEBSITE_SLOT, [...slot.filter(s => s !== htmlSig), htmlSig])
      await this.#bind(segments)
      return { ok: true, tile: segments, sig: htmlSig, created: false, unchanged: false, ...await this.#stage(segments, htmlSig, html) }
    }
    // The page decoration keeps what the prior one said about itself (its
    // label, its icon) and changes only the bytes it points at.
    const priors = await listDecorations<Record<string, unknown>>({ kind: PAGE_KIND, segments })
    for (const prior of priors) await removeDecorationAndWait({ sig: prior.sig, segments })
    const kept = priors[priors.length - 1]?.record.payload ?? {}
    await writeDecoration({
      kind: PAGE_KIND,
      appliesTo: segments,
      payload: { order: 0, ...kept, htmlSig, createdAt: Date.now() },
      segments,
      mark: 'persistent',
    })
    await this.#bind(segments)
    return { ok: true, tile: segments, sig: htmlSig, created: !current, unchanged: false, ...await this.#stage(segments, htmlSig, html) }
  }

  /** The page is already a resource. Mark it as a trial and hand the same
   *  bytes to the sandbox host. A host that is down does not fail the write. */
  async #stage(segments: readonly string[], htmlSig: string, html: string): Promise<{ trial: string; vector?: string } | Record<string, never>> {
    const label = trialLabel(segments)
    if (!label) return {}
    rememberTrial(htmlSig, label)
    const staged = await stageTrial(label, html)
    return { trial: `${trialOrigin(label)}/`, ...(staged.vector ? { vector: staged.vector } : {}) }
  }

  #trial(segments: readonly string[]): { trial: string } | Record<string, never> {
    const label = trialLabel(segments)
    return label ? { trial: `${trialOrigin(label)}/` } : {}
  }

  /** A PAGE IS ONLY SEEN WHERE ITS BEHAVIOUR IS AWAKE. A hive that binds the website
   *  behaviour to the tiles that hold sites reads every other tile as dormant, and the
   *  view quietly falls back to hexagons: a page a model wrote existed and could not
   *  be reached (jwize's hive, 2026-10-25). The `/website page` word binds the tile it
   *  dresses; so does a write. Never load-bearing: a failure here leaves the page
   *  written. */
  async #bind(segments: readonly string[]): Promise<void> {
    try { await ensureWebsiteBoundAt(segments) } catch { /* the page is written; binding is re-derived by the session sweep */ }
  }

  async #writeFile(segments: readonly string[], payload: AttachmentPayload): Promise<TileFileWrite> {
    const all = await listDecorations<AttachmentPayload>({ kind: FILES_ATTACHMENT_KIND, segments })
    const same = all.filter(({ record }) => record.payload?.name?.toLowerCase() === payload.name.toLowerCase())
    if (same.length === 1 && same[0].record.payload.sig === payload.sig) {
      return { ok: true, tile: segments, sig: payload.sig, created: false, unchanged: true }
    }
    for (const prior of same) await removeDecorationAndWait({ sig: prior.sig, segments })
    await writeAttachment(segments, payload)
    return { ok: true, tile: segments, sig: payload.sig, created: !same.length, unchanged: false }
  }

  async #attachment(segments: readonly string[], name: string): Promise<{ payload: AttachmentPayload } | undefined> {
    const wanted = name.trim().toLowerCase()
    if (!wanted) return undefined
    const found = await listAttachments(segments)
    return found.reverse().find(file => file.payload?.name?.toLowerCase() === wanted)
  }

  /** The tile a route names, spelled as the hive spells it — or why there is none. */
  async #tile(route: readonly string[]): Promise<{ segments: readonly string[] } | { ok: false; error: string }> {
    const parts = route.map(part => String(part ?? '').trim()).filter(Boolean)
    if (!parts.length) return { ok: false, error: 'the hive root holds no file; name a tile, for example /notes' }
    const reader = this.resolve<TreeReaderLike>('reader')
    if (!reader?.readNode) return { ok: false, error: 'the hive cannot be read here' }
    const segments: string[] = []
    for (const part of parts) {
      const listed = await reader.readNode(segments, { maxBytes: 8_000, withContent: false }).catch(() => null)
      const found = listed?.ok ? listed.children.map(child => child.name).find(child => child.toLowerCase() === part.toLowerCase()) : undefined
      if (!found) return { ok: false, error: `there is no tile at /${[...segments, part].join('/')}; create it first` }
      segments.push(found)
    }
    return { segments }
  }
}

const _tileFiles = new TileFilesDrone()
window.ioc.register(TILE_FILES_IOC_KEY, _tileFiles)
