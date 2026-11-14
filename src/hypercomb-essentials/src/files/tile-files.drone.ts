// files/tile-files.drone.ts
//
// A TILE'S FILES, READ AND WRITTEN AS TEXT — the door a model's
// `hypercomb-write` block uses to make a file (hypercomb-work-fence.ts). Three
// kinds of file live on a tile:
//
//   page — the tile's website page. The bytes are a resource. A page written
//          here is a trial: it opens at try-<name>.<this host> and the site
//          view does not mount it in this hive.
//   file — an attachment by name: a `files:attachment` decoration whose
//          payload points at the bytes (files-attachment.ts).
//   card — the tile's business card: its details or its theme, each a JSON
//          object its `card:data` record names (card-commit.ts).
//
// ON A MANAGED SITE DOOR (the page carries <script id="hc-manage">) the hive
// holds a replica of its owner's card and a change is made where it is: a
// page written there is no trial — it is not staged anywhere, and the receipt
// names no try- address, because none exists. The card frame shows it at once.
//
// Text only, on a tile that exists. A write never deletes: the bytes it
// replaces stay at the content root and the tile's history still reaches
// them, so a write is one undo away. The caller owns approval and edits —
// this door is handed the finished text.

import { Drone } from '@hypercomb/core'
import { managedRecordText } from '../sharing/managed-record.js'
import { listDecorations, removeDecorationAndWait } from '../commands/decoration-manifest.js'
import { FILES_ATTACHMENT_KIND, listAttachments, writeAttachment, type AttachmentPayload } from './files-attachment.js'
import { extOf } from './file-types.js'
import { commitPageSig } from './page-commit.js'
import { CARD_FIELD, cardJsonRefusal, cardRecordAt, commitCardSig, type CardPart } from './card-commit.js'
import { rememberTrial, stageTrial, trialLabel, trialOrigin } from './try-page.js'

export const TILE_FILES_IOC_KEY = '@diamondcoreprocessor.com/TileFilesDrone'

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
  readonly kind: 'page' | 'file' | 'card'
  /** The attachment's file name — required for `file`, unused otherwise. */
  readonly name?: string
  /** Which of the card's JSON — for `card` only; its details when unsaid. */
  readonly part?: CardPart
}

/** True on a managed site door's page: the worker put a record naming the
 *  site it manages in it. MIRRORED from sharing/site-manage.view.ts
 *  siteManageRecord, which this door does not import (that module is the
 *  card's view, loaded only on such a page). */
export function onManagedSiteDoor(doc: Document | undefined = globalThis.document): boolean {
  try {
    // Only the worker's record counts (sharing/managed-record.ts).
    const raw = managedRecordText(doc)
    if (!raw) return false
    const value = JSON.parse(raw) as Record<string, unknown>
    return !!value && typeof value['lineage'] === 'string' && value['lineage'].trim().length > 0
  } catch {
    return false
  }
}

const partOf = (target: TileFileTarget): CardPart => target.part === 'theme' ? 'theme' : 'details'
const whatOf = (target: TileFileTarget): string =>
  target.kind === 'page' ? 'page' : target.kind === 'card' ? `card's ${partOf(target)}` : `file ${target.name}`

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
type SiteViewLike = { resolvePageSig?(segments: readonly string[]): Promise<string | null> }

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
      : target.kind === 'card'
        ? await this.#cardSig(tile.segments, partOf(target))
        : (await this.#attachment(tile.segments, target.name ?? ''))?.payload.sig ?? null
    if (!sig) return { ok: true, tile: tile.segments, text: null }
    const blob = await store.getResource(sig).catch(() => null)
    if (!blob) return { ok: false, error: `the ${whatOf(target)} is named but its bytes are not on this device` }
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
    const type = target.kind === 'page' ? 'text/html' : target.kind === 'card' ? 'application/json' : this.typeOf(name)
    if (target.kind === 'file' && !name) return { ok: false, error: 'a file needs a name' }
    if (!type) return { ok: false, error: `${name} is not a text file; write one of: ${Object.keys(TEXT_TYPES).map(e => `.${e}`).join(' ')}` }
    if (target.kind === 'card') {
      const refused = cardJsonRefusal(text)
      if (refused) return { ok: false, error: refused }
    }
    const tile = await this.#tile(target.route)
    if ('error' in tile) return tile
    const store = this.resolve<StoreLike>('store')
    if (!store?.putResource) return { ok: false, error: 'the store is not available' }
    const blob = new Blob([text], { type })
    const sig = await store.putResource(blob)
    return target.kind === 'page'
      ? this.#writePage(tile.segments, sig, text)
      : target.kind === 'card'
        ? this.#writeCard(tile.segments, partOf(target), sig)
        : this.#writeFile(tile.segments, { name, mime: type, size: blob.size, sig })
  }

  /** The card's details or theme, by the signature its record names. */
  async #cardSig(segments: readonly string[], part: CardPart): Promise<string | null> {
    const value = (await cardRecordAt(segments))?.payload[CARD_FIELD[part]]
    return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : null
  }

  async #writeCard(segments: readonly string[], part: CardPart, sig: string): Promise<TileFileWrite> {
    const current = await this.#cardSig(segments, part)
    if (current === sig) return { ok: true, tile: segments, sig, created: false, unchanged: true }
    const committed = await commitCardSig(segments, part, sig)
    if (!committed.ok) return committed
    return { ok: true, tile: segments, sig, created: !current, unchanged: false }
  }

  async #writePage(segments: readonly string[], htmlSig: string, html: string): Promise<TileFileWrite> {
    const current = await this.resolve<SiteViewLike>('siteView')?.resolvePageSig?.(segments) ?? null
    if (current === htmlSig) return { ok: true, tile: segments, sig: htmlSig, created: false, unchanged: true, ...this.#trial(segments) }
    const committed = await commitPageSig(segments, htmlSig)
    if (!committed.ok) return committed
    return { ok: true, tile: segments, sig: htmlSig, created: !current, unchanged: false, ...await this.#stage(segments, htmlSig, html) }
  }

  /** The page is already a resource. Mark it as a trial and hand the same
   *  bytes to the sandbox host. A host that is down does not fail the write. */
  async #stage(segments: readonly string[], htmlSig: string, html: string): Promise<{ trial: string; vector?: string } | Record<string, never>> {
    if (onManagedSiteDoor()) return {}
    const label = trialLabel(segments)
    if (!label) return {}
    rememberTrial(htmlSig, label)
    const staged = await stageTrial(label, html)
    return { trial: `${trialOrigin(label)}/`, ...(staged.vector ? { vector: staged.vector } : {}) }
  }

  #trial(segments: readonly string[]): { trial: string } | Record<string, never> {
    if (onManagedSiteDoor()) return {}
    const label = trialLabel(segments)
    return label ? { trial: `${trialOrigin(label)}/` } : {}
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
