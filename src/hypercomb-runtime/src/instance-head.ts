// hypercomb-runtime/src/instance-head.ts
//
// THE INSTANCE HEAD. One mutable file in the shared bin. Every subdomain
// reads it and boots the package it names: the latest minified build.
//
// Everything else in the bin is named by the hash of its bytes. A new
// version is a new file, so an update never collides with the one it
// replaces, and an older file keeps working until nothing points at it.
// Moving this file is the whole update.
//
// What that instance loads is the branch's arrival — the bees that view
// needs — not the rest of the package. The arrival is decided per name.
// This file only says which build those bees come from.

export const INSTANCE_HEAD_KEY = 'head'
export const INSTANCE_HEAD_PATH = '/head'

const SIG_RE = /^[a-f0-9]{64}$/

export type InstanceHead = {
  /** The package root an instance installs. */
  readonly package: string
  /** The derivation record, when this package is a minified derivation. */
  readonly derivation: string | null
}

/** The head file. One signature, the package. A second line, when present,
 *  is the derivation record. Nothing else is a head. */
export const formatInstanceHead = (packageSig: string, derivationSig?: string | null): string => {
  const pkg = String(packageSig ?? '').trim().toLowerCase()
  if (!SIG_RE.test(pkg)) throw new Error('instance head: the package is not a signature')
  const derived = String(derivationSig ?? '').trim().toLowerCase()
  if (derived && !SIG_RE.test(derived)) throw new Error('instance head: the derivation is not a signature')
  return derived ? `${pkg}\n${derived}\n` : `${pkg}\n`
}

/** Read a head file back. A page, an empty file, or a third line is no head. */
export const parseInstanceHead = (text: string | null | undefined): InstanceHead | null => {
  const lines = String(text ?? '').split(/\r?\n/).map(line => line.trim().toLowerCase()).filter(Boolean)
  if (lines.length < 1 || lines.length > 2 || !SIG_RE.test(lines[0])) return null
  if (lines[1] && !SIG_RE.test(lines[1])) return null
  return { package: lines[0], derivation: lines[1] ?? null }
}
