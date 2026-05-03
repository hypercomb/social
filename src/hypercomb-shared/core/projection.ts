// hypercomb-shared/core/projection.ts
//
// Memoized producer pattern. Whatever the client produces gets stored
// content-addressed; subsequent calls with the same (producerId, inputs)
// shortcut to the existing sig without rerunning the producer.
//
// The framework is shape-agnostic. The client knows what they produce and
// what they JSON.parse back. There is no type registration, no kind
// enum, no schema check — bytes go in, bytes come out at a sig.
//
//   const sig = await project('names', parent.children, computeNames)
//
//   // later: read by sig (use Store.getResource + JSON.parse directly)
//   const blob = await store.getResource(sig)
//   const result = JSON.parse(await blob.text())
//
// Memoization key: (producerId, inputs). Result address: sha256(bytes).
// Producer must be deterministic for the shortcut to be sound; if its
// behaviour changes, bump the producerId (e.g. 'names@v1' → 'names@v2').

import { Store } from './store'

const TABLE_KEY = 'hc:projection-table'
type Table = Map<string, string>  // requestKey -> resultSig

let table: Table | null = null

const loadTable = (): Table => {
  if (table) return table
  try {
    const raw = localStorage.getItem(TABLE_KEY)
    if (raw) {
      table = new Map(JSON.parse(raw) as [string, string][])
      return table
    }
  } catch { /* fall through */ }
  table = new Map()
  return table
}

const persist = (t: Table): void => {
  try { localStorage.setItem(TABLE_KEY, JSON.stringify([...t])) } catch { /* full or unavailable */ }
}

const requestKey = (producerId: string, inputs: readonly string[]): string =>
  producerId + ' ' + inputs.join('|')

/**
 * Run the producer once for these inputs (or shortcut if previously run),
 * store the result content-addressed, and return the result's signature.
 *
 * The client knows what the bytes mean. No type checking; whatever the
 * producer returns is JSON.stringified and stored. To read: load the
 * blob at this sig, JSON.parse, use.
 */
export const project = async (
  producerId: string,
  inputs: readonly string[],
  produce: (inputs: readonly string[]) => Promise<unknown>,
): Promise<string> => {
  const store = (window as any).ioc?.get?.('@hypercomb.social/Store') as Store | undefined
  if (!store) throw new Error('[projection] Store not registered')

  const t = loadTable()
  const key = requestKey(producerId, inputs)

  // shortcut: if we've previously memoized this (producerId, inputs)
  // and the resource bytes are still present, return that sig without
  // running the producer.
  const cachedSig = t.get(key)
  if (cachedSig) {
    const existing = await store.getResource(cachedSig)
    if (existing) return cachedSig
    t.delete(key)  // resource gone; recompute
  }

  // delegate: run the producer once
  const result = await produce(inputs)
  const json = JSON.stringify(result)
  const blob = new Blob([json], { type: 'application/json' })
  const resultSig = await store.putResource(blob)

  // remember the shortcut so the next call skips the producer
  t.set(key, resultSig)
  persist(t)

  return resultSig
}

/**
 * Drop the shortcut for (producerId, inputs). Forces the next call to
 * re-run the producer. The underlying resource bytes stay in OPFS
 * (content-addressed; if the producer regenerates identical bytes, it
 * lands at the same sig and finds itself already there).
 */
export const invalidate = (producerId: string, inputs: readonly string[]): void => {
  const t = loadTable()
  const key = requestKey(producerId, inputs)
  if (t.delete(key)) persist(t)
}
