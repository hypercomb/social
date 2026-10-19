// sharing/derive-verify.ts
//
// RE-DERIVE A RECORD, HERE (documentation/derivations.md, mode `reproduce`).
// The `minify` dialect's transform is core's deriveMinifiedTree — the same code
// the build ran — driven by esbuild compiled to WebAssembly, which reproduces
// the build's native esbuild byte for byte (measured 2026-10-18: 921 modules,
// the live record and root exactly, 5.6 s).
//
// WHERE THE TRANSFORM COMES FROM is the security question: esbuild's
// WebAssembly is compiled Go, and Go's WebAssembly can call into the page. So
// it is never fetched from what a record names — a hostile record would run
// code in this hive. It comes only from THIS shell's own origin, pinned by its
// version folder (`/esbuild-wasm/<version>/`, copied in by the shell's build:
// hypercomb-web/scripts/copy-esbuild-wasm.mjs), trusted exactly as the shell
// is. A shell that does not carry the version a record names cannot verify
// it here, and says so.

import { deriveMinifiedTree, registerPoolMeaning } from '@hypercomb/core'
import { hostBase, readBySig } from './derivation-attestation.js'

const SIG_RE = /^[a-f0-9]{64}$/
const ESBUILD_TOOL_RE = /^esbuild@(\d+\.\d+\.\d+)$/

type Esbuild = {
  readonly version: string
  initialize(options: { wasmURL: string; worker?: boolean }): Promise<void>
  transform(code: string, options: Record<string, unknown>): Promise<{ code: string }>
}

const loaded = new Map<string, Promise<Esbuild | null>>()

/** esbuild-wasm of exactly `version`, from this shell's own origin — or null. */
export const shellEsbuild = (version: string): Promise<Esbuild | null> => {
  const held = loaded.get(version)
  if (held) return held
  const loading = (async (): Promise<Esbuild | null> => {
    try {
      const url = `/esbuild-wasm/${version}/browser.min.js`
      const mod = await import(/* @vite-ignore */ url) as Esbuild & { default?: Esbuild }
      const esbuild = (typeof mod.transform === 'function' ? mod : mod.default) as Esbuild | undefined
      if (!esbuild || esbuild.version !== version) return null
      await esbuild.initialize({ wasmURL: `/esbuild-wasm/${version}/esbuild.wasm`, worker: true })
      return esbuild
    } catch { return null }
  })()
  loaded.set(version, loading)
  return loading
}

export type DerivationRecord = {
  readonly v: number
  readonly kind: string
  readonly from: string
  readonly tool: string
  readonly options: Readonly<Record<string, unknown>>
  readonly modules?: Readonly<Record<string, string>>
}

/** A derivation record from a host, believed only when it hashes to its name. */
export const readDerivationRecord = async (host: string, sig: string): Promise<DerivationRecord | null> => {
  const bytes = await readBySig(host, sig)
  if (!bytes) return null
  try {
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as DerivationRecord
    return typeof raw.kind === 'string' && SIG_RE.test(String(raw.from)) && typeof raw.tool === 'string' ? raw : null
  } catch { return null }
}

/** The derivation record of the package a host's sites run, if it is derived. */
export const servedDerivation = async (host: string): Promise<{ root: string; record: string } | null> => {
  try {
    const pool = await registerPoolMeaning('host:packages')
    const res = await fetch(`${hostBase(host)}/content/${pool}/00000000`, { cache: 'no-store' })
    if (!res.ok) return null
    const root = (await res.text()).split('\n')[0]!.trim().toLowerCase()
    const bytes = SIG_RE.test(root) ? await readBySig(host, root) : null
    const layer = bytes ? JSON.parse(new TextDecoder().decode(bytes)) as { derivation?: unknown } : null
    const record = String(layer?.derivation ?? '').toLowerCase()
    return SIG_RE.test(record) ? { root, record } : null
  } catch { return null }
}

export type VerifyResult =
  | { ok: true; outcome: 'reproduced' | 'differs'; got: string; ran: string; modules: number }
  | { ok: false; reason: string }

/** Re-derive `recordSig` from the inputs its host serves, with this shell's
 *  esbuild, and say whether the same record came out. */
export const verifyDerivation = async (host: string, recordSig: string): Promise<VerifyResult> => {
  const record = await readDerivationRecord(host, recordSig)
  if (!record) return { ok: false, reason: 'that host does not serve this record' }
  if (record.kind !== 'minify') return { ok: false, reason: `a "${record.kind}" derivation cannot be re-run here yet` }
  const version = ESBUILD_TOOL_RE.exec(record.tool)?.[1]
  if (!version) return { ok: false, reason: `this hive re-runs esbuild, and the record was made by ${record.tool}` }
  const esbuild = await shellEsbuild(version)
  if (!esbuild) {
    return { ok: false, reason: `this hive's shell does not carry esbuild-wasm ${version} — verify from a terminal (verify-minified-package.mjs --host) and say "derive attest"` }
  }
  const held = new Map<string, Uint8Array | null>()
  const read = async (sig: string): Promise<Uint8Array | null> => {
    if (!held.has(sig)) held.set(sig, await readBySig(host, sig))
    return held.get(sig) ?? null
  }
  try {
    const tree = await deriveMinifiedTree(record.from, read,
      async body => (await esbuild.transform(body, { ...record.options })).code,
      { name: record.tool, options: record.options })
    return {
      ok: true,
      outcome: tree.derivation.sig === recordSig ? 'reproduced' : 'differs',
      got: tree.derivation.sig,
      ran: `esbuild-wasm@${esbuild.version}`,
      modules: tree.modules.size,
    }
  } catch (err) {
    return { ok: false, reason: `the inputs could not be re-derived: ${(err as Error)?.message ?? err}` }
  }
}
