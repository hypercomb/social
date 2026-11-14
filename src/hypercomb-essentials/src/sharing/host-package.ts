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
// SERVING OPTIMIZES BY ITSELF (jwize, 2026-11-13: "there is no minify or
// optimizations choices when you deploy these things are done automatically";
// "the application that runs in the consumers root domain is optimized but they
// have access to the code files"). Save already derives the minified copy of the
// new root (runtime module-drafts.ts, `minified`). Serve sends it beside the
// readable package and names it `minified:<name>`; the host runs it for the
// visitors of that name, and only while its root says it was derived from the
// root `install:<name>` names (blossom-worker sitePackage). `install:<name>`
// stays the READABLE root: a hive that follows the name drafts modules by their
// source sections, which minifying strips, and the code files stay on the host.
// A copy that cannot be read back is left out and the readable package is
// served as before — never a question, never a refusal.
//
// Serving is outward: it is only ever the participant's own press. Nothing
// goes live that the participant has not accepted (jwize, 2026-10-26: "there
// is no bot accepting going live in the hive") — a root that still carries
// code waiting in the brood is refused before a byte is sent.
//
// A dependency (atomic-modules-plan.md): it registers nothing.

import { walkPackage, type ModuleCommitOutcome } from '@hypercomb/core'
import { installChannelKey } from './hive-link.js'

const SIG_RE = /^[a-f0-9]{64}$/

/** The signed-index key the minified copy of `install:<name>` is named under. */
export const minifiedChannelKey = (name: string): string => `minified:${name}`

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
  /** The minified derivation of `root` Save made, when it could. */
  readonly minified?: string
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
      ...(outcome.minified && SIG_RE.test(outcome.minified) ? { minified: outcome.minified } : {}),
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
  /** `minified`: the host also names the minified copy, and runs it for this name's visitors. */
  | { readonly ok: true; readonly host: string; readonly channel: string; readonly sent: number; readonly held: number; readonly minified: boolean }
  /** `stage` says how far it got: nothing was sent (`check`), the files did
   *  not all arrive and no pointer moved (`files`), or the host holds every
   *  file and the pointer did not move (`pointer`). */
  | { readonly ok: false; readonly stage: 'check' | 'files' | 'pointer'; readonly error: string; readonly waiting?: number }

/** Every file of the minified copy of `readable`: its layers, its modules, and
 *  its derivation record. Null unless its root names `readable` as what it was
 *  derived from and every layer of it reads back here. */
export const minifiedFiles = async (
  minified: string, readable: string, bytesOf: (sig: string) => Promise<Uint8Array | null>,
): Promise<string[] | null> => {
  if (!SIG_RE.test(minified) || minified === readable) return null
  try {
    const bytes = await bytesOf(minified)
    if (!bytes) return null
    const root = JSON.parse(new TextDecoder().decode(bytes)) as { derivedFrom?: unknown; derivation?: unknown }
    const derivation = String(root?.derivation ?? '')
    if (root?.derivedFrom !== readable || !SIG_RE.test(derivation)) return null
    const walked = await walkPackage(minified, bytesOf)
    return [...new Set([...walked.layers, ...walked.bees, ...walked.dependencies, derivation])]
  } catch { return null }
}

/** SERVE. Files first, all of them; the signed pointer only after. */
export const servePackage = async (host: string, saved: Pick<SavedPackage, 'name' | 'root' | 'files' | 'minified'>, deps: ServeDeps): Promise<ServeOutcome> => {
  const zone = String(host ?? '').trim()
  const name = packageName(saved.name)
  if (!zone) return { ok: false, stage: 'check', error: 'no-host' }
  if (!name) return { ok: false, stage: 'check', error: 'name' }
  if (!deps.publishAtoms || !deps.bytesOf) return { ok: false, stage: 'check', error: 'unavailable' }

  const waiting = await deps.unaccepted(saved.root).catch(() => null)
  if (waiting === null) return { ok: false, stage: 'check', error: 'unread' }
  if (waiting.length) return { ok: false, stage: 'check', error: 'held', waiting: waiting.length }

  // The minified copy rides with the readable files: one upload, and nothing named until all of it is there.
  const optimized = saved.minified ? await minifiedFiles(saved.minified, saved.root, deps.bytesOf) : null
  const files = [...new Set([...saved.files, ...(optimized ?? [])])]
  let published: Awaited<ReturnType<NonNullable<ServeDeps['publishAtoms']>>>
  try { published = await deps.publishAtoms(zone, files, deps.bytesOf) } catch (error) {
    return { ok: false, stage: 'files', error: error instanceof Error ? error.message : 'the files could not be sent' }
  }
  if (!published.ok) return { ok: false, stage: 'files', error: published.error }

  const channel = installChannelKey(name)
  let stamped: { ok: boolean; reason?: string }
  try { stamped = await deps.stamp(zone, channel, saved.root) } catch (error) {
    stamped = { ok: false, reason: error instanceof Error ? error.message : 'refused' }
  }
  if (!stamped.ok) return { ok: false, stage: 'pointer', error: stamped.reason ?? 'refused' }
  // The readable root is served now. Naming the minified copy is the optimization; if it is refused, visitors run the readable one.
  let minified = false
  if (optimized && saved.minified) {
    minified = await deps.stamp(zone, minifiedChannelKey(name), saved.minified).then(done => done.ok, () => false)
  }
  return { ok: true, host: zone, channel, sent: published.sent, held: published.held, minified }
}
