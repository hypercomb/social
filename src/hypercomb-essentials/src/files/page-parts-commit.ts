// files/page-parts-commit.ts
//
// A PAGE IN PARTS, ON ITS TILES (files/page-parts.ts holds the text rules).
//
//   /card                      wears the page (one document, as served)
//                              holds page.shell.html: the page with each
//                              moved-out block emptied and referenced
//   /card/animation            holds animation.js: the block's text
//
// Two acts:
//
//   breakBlockOut  — one block leaves the page for a file on a child tile.
//                    The page's bytes do not change: the shell is proven to
//                    assemble back to exactly the page before anything is
//                    written.
//   planPartRebuild — a part's file, or the shell, is about to change. The
//                    shell is moved to the new signature (a forward commit,
//                    atomic-chain.md) and the page is assembled again and
//                    committed, so the page that is served follows its parts.
//
// The page stays the truth of what is served. A page written whole after it
// was broken apart wins: the next break starts again from the page as it is.
//
// A PART IS A TRAIT OF THE PAGE (documentation/traits.md, jwize 2026-11-15:
// "use traits where interface needs to land, those are your component's
// extension point"). The name a block is moved out under is a trait word: the
// page's tile wears `trait:want` for it, and the child tile of that name is
// what fills it — the child rung. The page had a working version of its own,
// so the trait is one the creation fills itself (`own`). That is what lets a
// part be swapped for another filler, offered across hosts, and refined by
// traits of its own: a part's tile is a tile like any other.

import { TRAIT_WANT_KIND, get, isReservedPoolWord, sameTraitWord, traitWords, type TraitWant } from '@hypercomb/core'
import { listDecorations, removeDecorationAndWait, writeDecoration } from '../commands/decoration-manifest.js'
import { FILES_ATTACHMENT_KIND, listAttachments, writeAttachment, type AttachmentPayload } from './files-attachment.js'
import { commitPageSig } from './page-commit.js'
import { isAuthored } from '../sharing/authored-sigs.js'
import {
  SHELL_FILE, assemblePage, blockIdOf, moveBlockOut, partExtension, partTextRefusal, repinPart, shellParts,
} from './page-parts.js'

const SIG = /^[0-9a-f]{64}$/
const TILE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/
const NO_SIG = '0'.repeat(64)

const MIME: Readonly<Record<string, string>> = {
  css: 'text/css', js: 'text/javascript', json: 'application/json', txt: 'text/plain', html: 'text/html',
}

type StoreLike = {
  putResource(blob: Blob): Promise<string>
  getResource(sig: string): Promise<Blob | null>
}
type SiteViewLike = { resolvePageSig?(segments: readonly string[]): Promise<string | null> }
type ReaderLike = {
  readNode?(segments: readonly string[], options: { maxBytes?: number; withContent?: boolean }): Promise<
    { ok: true; children: readonly { name: string }[] } | { ok: false; code?: string }
  >
}
type CommitterLike = {
  importTree?(updates: { segments: readonly string[]; layer: { name: string } }[]): Promise<void>
}

const store = (): StoreLike | undefined => get<StoreLike>('@hypercomb.social/Store')
const textOfSig = async (sig: string): Promise<string | undefined> => {
  const blob = await store()?.getResource(sig).catch(() => null)
  return blob ? await blob.text() : undefined
}

/** The tile's shell file: its text and the resource it is, or null. */
export async function shellAt(segments: readonly string[]): Promise<{ text: string; sig: string } | null> {
  const files = await listAttachments(segments).catch(() => [])
  const shell = files.reverse().find(file => file.payload?.name === SHELL_FILE)
  if (!shell || !SIG.test(shell.payload.sig)) return null
  const text = await textOfSig(shell.payload.sig)
  return text === undefined ? null : { text, sig: shell.payload.sig }
}

/** File `text` on the tile under `name`, in place of any file of that name. */
async function fileOn(segments: readonly string[], name: string, sig: string, size: number): Promise<void> {
  const all = await listDecorations<AttachmentPayload>({ kind: FILES_ATTACHMENT_KIND, segments })
  const same = all.filter(({ record }) => record.payload?.name === name)
  if (same.length === 1 && same[0].record.payload.sig === sig) return
  for (const prior of same) await removeDecorationAndWait({ sig: prior.sig, segments })
  const extension = name.slice(name.lastIndexOf('.') + 1)
  await writeAttachment(segments, { name, mime: MIME[extension] ?? 'text/plain', size, sig })
}

const put = async (text: string, extension: string): Promise<{ sig: string; size: number }> => {
  const blob = new Blob([text], { type: MIME[extension] ?? 'text/plain' })
  return { sig: await store()!.putResource(blob), size: blob.size }
}

/** The shell with every part's text in hand, assembled. */
async function assembled(shell: string): Promise<{ ok: true; html: string } | { ok: false; error: string }> {
  const texts = new Map<string, string>()
  for (const part of shellParts(shell)) {
    if (texts.has(part.sig)) continue
    const text = await textOfSig(part.sig)
    if (text !== undefined) texts.set(part.sig, text)
  }
  return assemblePage(shell, sig => texts.get(sig))
}

export type BlockOut =
  | {
    readonly ok: true
    readonly tile: readonly string[]
    readonly file: string
    readonly sig: string
    readonly characters: number
    /** The page started again from its own text: an older shell no longer matched it. */
    readonly restarted: boolean
  }
  | { readonly ok: false; readonly error: string }

/** Move one block of the page on `segments` into `<name>.<ext>` on the child
 *  tile `name`. The page's own bytes are left exactly as they are. */
export async function breakBlockOut(segments: readonly string[], blockSaid: string, nameSaid: string): Promise<BlockOut> {
  const name = String(nameSaid ?? '').trim().toLowerCase()
  if (!TILE_NAME.test(name)) return { ok: false, error: `"${nameSaid}" is not a tile name: use lower-case letters, digits and hyphens` }
  if (isReservedPoolWord(name)) return { ok: false, error: `"${name}" is a reserved word; choose another name` }
  if (!store()?.putResource) return { ok: false, error: 'the store is not available' }
  const route = `/${segments.join('/')}`
  const pageSig = await get<SiteViewLike>('@diamondcoreprocessor.com/SiteViewDrone')?.resolvePageSig?.(segments) ?? null
  if (!pageSig) return { ok: false, error: `${route} wears no page` }
  const page = await textOfSig(pageSig)
  if (page === undefined) return { ok: false, error: `the page on ${route} is named but its bytes are not on this device` }

  // The shell the page has, when it still stands for the page; the page itself otherwise.
  const held = await shellAt(segments)
  const stands = held ? await assembled(held.text) : null
  const current = held && stands?.ok && stands.html === page
  const shell = current ? held!.text : page

  const blockId = blockIdOf(blockSaid)
  const probe = moveBlockOut(shell, blockId, () => ({ sig: NO_SIG, name: 'part' }))
  if (!probe.ok) return probe
  const refused = partTextRefusal(probe.block.kind, probe.text)
  if (refused) return { ok: false, error: `${blockId}: ${refused}` }
  const extension = partExtension(probe.block)
  const file = `${name}.${extension}`
  const part = await put(probe.text, extension)
  const moved = moveBlockOut(shell, blockId, () => ({ sig: part.sig, name: file }))
  if (!moved.ok) return moved

  // PROVEN BEFORE ANYTHING IS FILED: the new shell assembles to the page as it is.
  const proof = await assembled(moved.shell)
  if (!proof.ok) return proof
  if (proof.html !== page) return { ok: false, error: `${blockId} cannot be moved out cleanly: the page would not come back byte for byte. Nothing was changed` }

  const child = [...segments, name]
  const reader = get<ReaderLike>('@diamondcoreprocessor.com/HypercombHiveTreeReader')
  const listed = await reader?.readNode?.(segments, { maxBytes: 8_000, withContent: false }).catch(() => null)
  if (!listed?.ok) return { ok: false, error: `${route} cannot be read here` }
  if (!listed.children.some(tile => tile.name.toLowerCase() === name)) {
    const committer = get<CommitterLike>('@diamondcoreprocessor.com/LayerCommitter')
    if (!committer?.importTree) return { ok: false, error: 'the layer committer is not available' }
    await committer.importTree([{ segments: child, layer: { name } }])
  }
  await fileOn(child, file, part.sig, part.size)
  const kept = await put(moved.shell, 'html')
  await fileOn(segments, SHELL_FILE, kept.sig, kept.size)
  await wearTrait(segments, name)
  return { ok: true, tile: child, file, sig: part.sig, characters: probe.text.length, restarted: !!held && !current }
}

/** The page's tile wears the part's name as a trait it fills itself: the
 *  extension point the child tile stands in. Once per word. */
async function wearTrait(segments: readonly string[], word: string): Promise<void> {
  const wants = await listDecorations<TraitWant>({ kind: TRAIT_WANT_KIND, segments }).catch(() => [])
  if (traitWords(wants.map(want => want.record.payload)).some(have => sameTraitWord(have, word))) return
  const payload = { word, own: true } as TraitWant
  await writeDecoration<TraitWant>({ kind: TRAIT_WANT_KIND, appliesTo: segments, segments, payload, mark: 'persistent' })
}

/** The page rebuilt: its signature and text, and whether it is the hive's own
 *  words (the page it replaced was, or none stood). Nothing here marks it. */
export type PartRebuilt =
  | { readonly ok: true; readonly sig: string; readonly html: string; readonly own: boolean }
  | { readonly ok: false; readonly error: string }

export type PartRebuild =
  | { readonly ok: true; readonly page: readonly string[]; apply(): Promise<PartRebuilt> }
  | { readonly ok: false; readonly error: string }

/** A file named `name` on `segments` is about to go from `prior` to `next`.
 *  When a page stands on it — the file is a shell, or a shell on this tile or
 *  above names the prior signature — this is the rebuild: refused here when
 *  the page could not be assembled, applied by the caller once the file is
 *  written. Null when no page depends on the file. */
export async function planPartRebuild(
  segments: readonly string[], name: string, prior: string | undefined, next: string,
): Promise<PartRebuild | null> {
  if (name === SHELL_FILE) {
    const text = await textOfSig(next)
    if (text === undefined) return { ok: false, error: 'the shell is not on this device' }
    const built = await assembled(text)
    if (!built.ok) return built
    return { ok: true, page: segments, apply: () => commit(segments, built.html) }
  }
  if (!prior || prior === next) return null
  for (let depth = segments.length; depth >= 1; depth--) {
    const tile = segments.slice(0, depth)
    const held = await shellAt(tile)
    const shell = held ? repinPart(held.text, prior, next) : undefined
    if (shell === undefined) continue
    const built = await assembled(shell)
    if (!built.ok) return built
    return {
      ok: true, page: tile,
      apply: async () => {
        const kept = await put(shell, 'html')
        await fileOn(tile, SHELL_FILE, kept.sig, kept.size)
        return commit(tile, built.html)
      },
    }
  }
  return null
}

async function commit(segments: readonly string[], html: string): Promise<PartRebuilt> {
  const page = await put(html, 'html')
  // Rebuilt from its files, the page is as much this hive's own as the page it
  // replaces. It is not marked authored here: the part came through a model's
  // write, so the page is a trial until a person brings it home, and is marked
  // then (tile-files.drone.ts #stage, try-page.ts releaseTrial; 2026-11-27).
  const before = await get<SiteViewLike>('@diamondcoreprocessor.com/SiteViewDrone')?.resolvePageSig?.(segments).catch(() => null) ?? null
  const committed = await commitPageSig(segments, page.sig)
  return committed.ok ? { ok: true, sig: page.sig, html, own: !before || isAuthored(before) } : committed
}

/** The files the page `pageSig` on this tile is made of, when its shell still
 *  stands for it; null for a page that is whole, or one written whole since. */
export async function partFilesOf(segments: readonly string[], pageSig: string): Promise<string[] | null> {
  const held = await shellAt(segments)
  if (!held) return null
  const [page, built] = await Promise.all([textOfSig(pageSig), assembled(held.text)])
  if (page === undefined || !built.ok || built.html !== page) return null
  return [SHELL_FILE, ...shellParts(held.text).map(part => part.name)]
}
