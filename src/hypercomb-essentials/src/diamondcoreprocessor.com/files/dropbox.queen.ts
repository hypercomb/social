// diamondcoreprocessor.com/files/dropbox.queen.ts
//
// /dropbox — turn the current location (and its whole subtree) into a
// typed file dropbox. This is the "parent decorates the lineage from the
// top down" worker: it writes a `files:dropbox` decoration at the current
// container; DropboxService resolves it by walking the lineage upward, so
// every descendant tile becomes droppable (cascading).
//
//   /dropbox                — accept documents (pdf, doc, svg, …)
//   /dropbox images         — accept images
//   /dropbox any            — accept any file
//   /dropbox pdf,csv        — accept only those extensions
//   /dropbox off            — remove the dropbox declared here
//
// Files dropped on a tile in the subtree are saved as resources and listed
// behind the tile's file icon — see files/file-drop.drone.ts.

import { QueenBee, EffectBus } from '@hypercomb/core'
import { parseAccept } from './file-types.js'
import { writeDropbox, removeDropbox, listDropboxHere } from './files-attachment.js'

const get = (key: string): any => (window as any).ioc?.get?.(key)

type LineageLike = { explorerSegments?: () => readonly string[] }
type DropboxServiceLike = { sigsAt(segments: readonly string[]): string[] }

export class DropboxQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'dropbox'
  override readonly aliases = ['dropzone']
  override description = 'Make this location a typed file dropbox (cascades to its subtree)'
  override descriptionKey = 'slash.dropbox'
  override options = ['documents', 'images', 'any', '<ext,ext>', 'off']
  override examples = [
    { input: '/dropbox images', result: 'Tiles in this subtree accept image drops' },
    { input: '/dropbox pdf,csv', result: 'Accepts only pdf and csv files' },
  ]

  override slashComplete(args: string): readonly string[] {
    const options = ['documents', 'images', 'any', 'off']
    const q = args.toLowerCase().trim()
    return q ? options.filter(o => o.startsWith(q)) : options
  }

  protected async execute(args: string): Promise<void> {
    const lineage = get('@hypercomb.social/Lineage') as LineageLike | undefined
    const segments = (lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)

    const here = segments.length ? segments[segments.length - 1] : 'this hive'
    const token = args.trim().toLowerCase()
    const dropbox = get('@diamondcoreprocessor.com/DropboxService') as DropboxServiceLike | undefined

    // /dropbox off — remove the dropbox declared at this location. Use the
    // service's known sigs (sync, no layer read) so we never hang on a cold
    // remote decoration fetch.
    if (token === 'off' || token === 'none') {
      const sigs = dropbox?.sigsAt(segments) ?? []
      if (sigs.length === 0) { this.#log(`no dropbox on "${here}"`, '○'); return }
      for (const sig of sigs) removeDropbox(sig, segments)
      this.#log(`dropbox off — "${here}"`, '○')
      return
    }

    // Mark (or re-type) the current location as a dropbox. Write first so the
    // gate goes active immediately (DropboxService updates from this event,
    // commit-independent); then dedupe older dropbox decorations in the
    // background so a cold remote read can't block the command.
    const accept = parseAccept(args)
    const newSig = await writeDropbox(segments, accept)
    const label = accept.includes('any') ? 'any file' : accept.join(', ')
    this.#log(`dropbox on "${here}" — accepts ${label}`, '●')

    void (async () => {
      try {
        const existing = await listDropboxHere(segments)
        for (const { sig } of existing) if (sig !== newSig) removeDropbox(sig, segments)
      } catch { /* best-effort cleanup */ }
    })()
  }

  #log(message: string, icon = '◈'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _dropbox = new DropboxQueenBee()
window.ioc.register('@diamondcoreprocessor.com/DropboxQueenBee', _dropbox)
