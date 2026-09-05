// hypercomb-runtime/src/core-surface.ts
//
// CAN THIS SHELL RUN THAT PACKAGE? — worked out from the bytes, not declared.
//
// Bees and namespace dependencies are built with `@hypercomb/core` EXTERNAL:
// the import map resolves it to the runtime the SHELL ships
// (`/hypercomb-core.runtime.js`, one of the five location-addressed files —
// documentation/late-stage-separation). So a package built against a newer
// core can be replicated, verified and activated on a shell whose core lacks
// an export it names, and every module that names it dies at evaluation:
//
//   SyntaxError: The requested module '@hypercomb/core' does not provide an
//   export named 'declarePoolKind'
//
// Observed live 2026-09-04: nine dependencies failed to load after a package
// upgrade, because the live shell had not been shipped since the core grew.
//
// THE GATE IS A DERIVATION. Nothing here is a field a publisher writes down —
// "nothing a publisher writes down decides what a client installs". The
// requirement is read out of the admitted bytes (`import { a, b } from
// "@hypercomb/core"`) and the answer out of the live core module itself. That
// makes it directional in the right way: a shell whose core exports MORE than
// a package needs passes (an older package still installs on a newer shell,
// which is what a restore point is), and only a shell that is actually short
// refuses — naming exactly which exports it lacks.
//
// It runs at ADMISSION, after the closure resolved and before activation, in
// both acquisition paths (acquire.ts, ensure-install.ts). Bytes that landed
// stay in the heap: a refused package is a delta repair once the shell ships,
// never a refetch.
//
// IT IS A DERIVATION OVER BUNDLER OUTPUT. esbuild emits one import statement
// per external specifier; namespace imports (`import * as core`) name nothing
// this can check and are skipped. A bundle that emits a different shape
// yields fewer names and a gate that lets more through — the failure mode of
// a hint, never a wrong refusal.

import { SignatureService } from '@hypercomb/core'

/** Where every shell's import map points `@hypercomb/core`. The same URL is
 *  imported here, so the module inspected IS the one the bees will get. */
export const CORE_RUNTIME_URL = '/hypercomb-core.runtime.js'

const CORE_SPECIFIER = '@hypercomb/core'

/** `import { a, b as c } from "@hypercomb/core"` and the `export { … } from`
 *  form. Captures the brace body; the specifier may use either quote. */
const NAMED_FROM_CORE_RE = /(?:import|export)\s*\{([^}]*)\}\s*from\s*["']@hypercomb\/core["']/g
/** `import Default from "@hypercomb/core"` — names the `default` export. */
const DEFAULT_FROM_CORE_RE = /import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*["']@hypercomb\/core["']/g

const text = (bytes: Uint8Array): string | null => {
  const decoded = new TextDecoder().decode(bytes)
  return decoded.includes('�') ? null : decoded
}

/** The export names one module requires of `@hypercomb/core`. The name on the
 *  CORE side is what matters — `EffectBus as EffectBus2` requires `EffectBus`. */
export const coreImportsOf = (source: string): string[] => {
  if (!source.includes(CORE_SPECIFIER)) return []
  const names = new Set<string>()
  for (const match of source.matchAll(NAMED_FROM_CORE_RE)) {
    for (const part of (match[1] ?? '').split(',')) {
      const exported = part.trim().split(/\s+as\s+/)[0]?.trim()
      // `type X` never survives to a bundle, but cost nothing to skip.
      if (exported && !exported.startsWith('type ')) names.add(exported)
    }
  }
  for (const match of source.matchAll(DEFAULT_FROM_CORE_RE)) {
    if (match[1] && match[1] !== 'type') names.add('default')
  }
  return [...names].sort()
}

/**
 * The union of core exports a set of atoms requires, read from their bytes.
 * An atom `read` cannot answer for contributes nothing — the closure gate has
 * already said whether the package is complete; this only asks what it needs.
 */
export const requiredCoreExports = async (
  atoms: readonly string[],
  read: (signature: string) => Promise<Uint8Array | null>,
): Promise<string[]> => {
  const names = new Set<string>()
  for (const sig of atoms) {
    const bytes = await read(sig)
    const source = bytes && text(bytes)
    if (!source) continue
    for (const name of coreImportsOf(source)) names.add(name)
  }
  return [...names].sort()
}

/** A signature over the export surface, for logs and comparisons: the sorted
 *  names, one per line. Two cores with the same surface share it whatever
 *  their bytes. */
export const exportSurfaceSignature = async (names: readonly string[]): Promise<string> =>
  SignatureService.sign(new TextEncoder().encode([...names].sort().join('\n')).buffer as ArrayBuffer)

/**
 * The export names of the core THIS shell serves to modules — the module at
 * {@link CORE_RUNTIME_URL}, imported through the same URL the import map maps
 * `@hypercomb/core` to, so the browser hands back the one instance the bees
 * will see. Null when it cannot be loaded at all (a shell with no runtime
 * core, such as the dev shell that imports modules directly): the gate then
 * has no evidence and stands aside rather than refusing on a guess.
 */
export const liveCoreExports = async (): Promise<Set<string> | null> => {
  try {
    const url = new URL(CORE_RUNTIME_URL, location.origin).href
    const mod = await import(/* @vite-ignore */ url) as Record<string, unknown>
    return new Set(Object.keys(mod))
  } catch {
    return null
  }
}

export type CoreCompatibility = {
  /** True when every required export is present, or when there was no live
   *  core to ask (see {@link liveCoreExports}). */
  ok: boolean
  /** Exports the package names that the live core does not provide. */
  missing: string[]
  /** How many distinct core exports the package requires. */
  required: number
  /** False when the live core could not be inspected and the verdict is a
   *  stand-aside rather than a pass. */
  inspected: boolean
}

/** The pure verdict. */
export const coreCompatibility = (required: readonly string[], live: ReadonlySet<string> | null): CoreCompatibility => {
  if (!live) return { ok: true, missing: [], required: required.length, inspected: false }
  const missing = required.filter(name => !live.has(name))
  return { ok: missing.length === 0, missing, required: required.length, inspected: true }
}

/**
 * The whole question for one resolved package: read what its bees and
 * dependencies import from core, ask the live core what it exports, compare.
 */
export const checkCoreCompatibility = async (
  atoms: readonly string[],
  read: (signature: string) => Promise<Uint8Array | null>,
): Promise<CoreCompatibility> => {
  const [required, live] = await Promise.all([requiredCoreExports(atoms, read), liveCoreExports()])
  return coreCompatibility(required, live)
}

/** Thrown by an install path that must unwind past a wipe; carries the names
 *  so the surface can say what the shell lacks. */
export class CoreMismatchError extends Error {
  readonly missing: string[]
  constructor(missing: string[]) {
    super(`this shell's core lacks ${missing.length} export(s) the package needs: ${missing.join(', ')}`)
    this.name = 'CoreMismatchError'
    this.missing = missing
  }
}

export const describeCoreMismatch = (missing: readonly string[]): string =>
  `needs a newer shell — its core does not export ${missing.slice(0, 4).join(', ')}` +
  (missing.length > 4 ? ` and ${missing.length - 4} more` : '')
