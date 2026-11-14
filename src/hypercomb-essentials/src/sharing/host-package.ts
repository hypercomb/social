// sharing/host-package.ts
//
// A PACKAGE MADE ON THE HOSTS DESK, AND MADE A HOST'S ROOT (jwize, 2026-11-13:
// "You should be able to create any variety of package here and then use it as
// a host root").
//
// What runs here is the trunk with some paths turned off and some picks laid
// over it — local records, with no signature, so nobody else can be handed
// them (documentation/package-components.md, "The gap this closes"). Two acts
// close the gap, and they stay two:
//
//   SAVE   what runs here becomes a package of its own: the runtime re-mints
//          the trunk with every path that is off left out and every pick
//          folded in (core ModuleDraftsProvider.commit), appends the new root
//          to this hive's `host:packages` pool under the name given, and makes
//          it the trunk here. Nothing leaves this hive.
//   SERVE  the saved package becomes a host's root: every file of it is sent
//          to the host (what it already holds is skipped), and only then is
//          the participant's signed pointer `install:<name>` moved to the new
//          root — so nobody is ever pointed at a root the host cannot serve.
//          It is the same order `module commit` and `publish:revision` keep.
//
// Serving is outward: it is only ever the participant's own press. Nothing
// goes live that the participant has not accepted (jwize, 2026-10-26: "there
// is no bot accepting going live in the hive") — a root that still carries
// code waiting in the brood is refused before a byte is sent.
//
// A dependency (atomic-modules-plan.md): it registers nothing.

import type { ModuleCommitOutcome } from '@hypercomb/core'
import { installChannelKey } from './hive-link.js'

/** A package's name is its install channel: one lowercase word, as
 *  `publish:revision -- <name>` takes it. */
const NAME_RE = /^[a-z][a-z0-9-]{0,39}$/

/** The name as it will be kept — folded to one lowercase word — or '' when
 *  nothing usable was typed. Spaces and underscores become dashes. */
export const packageName = (raw: unknown): string => {
  const name = String(raw ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '')
  return NAME_RE.test(name) ? name : ''
}

/** A package saved from the desk: what Save made, and what Serve sends. */
export type SavedPackage = {
  readonly name: string
  /** The new package root — what runs here now. */
  readonly root: string
  /** Its place in this hive's `host:packages` pool. */
  readonly index: number
  /** Every file the package holds: layers, modules, namespace bundles. */
  readonly files: readonly string[]
  /** The paths left out of it — turned off here when it was saved. */
  readonly off: readonly string[]
  /** Picks folded in at their path, and the drafts among them. */
  readonly folded: readonly string[]
  /** Picks NOT folded: their code still waits in the brood. */
  readonly held: readonly string[]
}

export type SaveOutcome = { readonly ok: true; readonly saved: SavedPackage } | { readonly ok: false; readonly error: string }

/** SAVE. `commit` is the runtime's (core ModuleDraftsProvider.commit). */
export const savePackage = async (
  raw: unknown,
  commit: ((label: string) => Promise<ModuleCommitOutcome>) | undefined,
): Promise<SaveOutcome> => {
  const name = packageName(raw)
  if (!name) return { ok: false, error: 'name' }
  if (!commit) return { ok: false, error: 'unavailable' }
  let outcome: ModuleCommitOutcome
  try { outcome = await commit(name) } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'the package could not be saved' }
  }
  if (!outcome.ok) return { ok: false, error: outcome.error }
  return {
    ok: true,
    saved: {
      name,
      root: outcome.rootSig,
      index: outcome.index,
      files: [...outcome.files],
      off: [...outcome.off],
      folded: [...new Set([...outcome.drafts, ...(outcome.taken ?? []).map(pick => pick.path)])].sort(),
      held: [...(outcome.held ?? [])],
    },
  }
}

/** What Serve reaches for, each handed in: the host service's upload, the
 *  bytes of a signature, the signed pointer's stamp, and the brood's answer. */
export type ServeDeps = {
  readonly publishAtoms?: (host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>) =>
    Promise<{ ok: true; sent: number; held: number } | { ok: false; error: string }>
  readonly bytesOf?: (sig: string) => Promise<Uint8Array | null>
  readonly stamp: (host: string, key: string, root: string) => Promise<{ ok: boolean; reason?: string }>
  /** The modules of `root` this hive has not accepted; null when it cannot say. */
  readonly unaccepted: (root: string) => Promise<readonly string[] | null>
}

export type ServeOutcome =
  | { readonly ok: true; readonly host: string; readonly channel: string; readonly sent: number; readonly held: number }
  /** `stage` says how far it got: nothing was sent (`check`), the files did
   *  not all arrive and no pointer moved (`files`), or the host holds every
   *  file and the pointer did not move (`pointer`). */
  | { readonly ok: false; readonly stage: 'check' | 'files' | 'pointer'; readonly error: string; readonly waiting?: number }

/** SERVE. Files first, all of them; the signed pointer only after. */
export const servePackage = async (host: string, saved: Pick<SavedPackage, 'name' | 'root' | 'files'>, deps: ServeDeps): Promise<ServeOutcome> => {
  const zone = String(host ?? '').trim()
  const name = packageName(saved.name)
  if (!zone) return { ok: false, stage: 'check', error: 'no-host' }
  if (!name) return { ok: false, stage: 'check', error: 'name' }
  if (!deps.publishAtoms || !deps.bytesOf) return { ok: false, stage: 'check', error: 'unavailable' }

  const waiting = await deps.unaccepted(saved.root).catch(() => null)
  if (waiting === null) return { ok: false, stage: 'check', error: 'unread' }
  if (waiting.length) return { ok: false, stage: 'check', error: 'held', waiting: waiting.length }

  let published: Awaited<ReturnType<NonNullable<ServeDeps['publishAtoms']>>>
  try { published = await deps.publishAtoms(zone, saved.files, deps.bytesOf) } catch (error) {
    return { ok: false, stage: 'files', error: error instanceof Error ? error.message : 'the files could not be sent' }
  }
  if (!published.ok) return { ok: false, stage: 'files', error: published.error }

  const channel = installChannelKey(name)
  let stamped: { ok: boolean; reason?: string }
  try { stamped = await deps.stamp(zone, channel, saved.root) } catch (error) {
    stamped = { ok: false, reason: error instanceof Error ? error.message : 'refused' }
  }
  if (!stamped.ok) return { ok: false, stage: 'pointer', error: stamped.reason ?? 'refused' }
  return { ok: true, host: zone, channel, sent: published.sent, held: published.held }
}
