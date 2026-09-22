// assistant/anatomy/anatomy.service.ts
//
// THE ANATOMY AT RUNTIME. The shell asks for it over IoC (the shell may never
// import a module). Its signature is derived here — never written down
// anywhere — and is what a conversation turn records as "the anatomy I was
// sent".
//
// The anatomy is COMPOSED: the build's mechanics, then the doctrine this hive
// runs (doctrine.ts). The doctrine is a hive artifact — sections as resources,
// a record naming them, the `system:doctrine` bag's head naming the record —
// so a rule changes by a hive write, not by a rebuild. Until the store is open
// the anatomy is the build's seed, byte for byte.
//
// Design: documentation/anatomy-context-need.md §2, §2a, §6, §7.

import { SignatureService } from '@hypercomb/core'
import { publishService } from '../llm-provider-registry.js'
import { ANATOMY_MECHANICS, ANATOMY_SECTIONS, ANATOMY_SOURCES } from './anatomy.generated.js'
import {
  DOCTRINE_BAG_MEANING, commitDoctrine, composeAnatomy, headingOf, isHeading, loadDoctrine, previousDoctrine, sourceOf, writeSection,
  type DoctrineBag, type DoctrineIo, type DoctrineOutcome, type DoctrineState,
} from './doctrine.js'

export const ANATOMY_IOC_KEY = '@hypercomb.social/Anatomy'

export type DoctrineSectionInfo = { readonly index: number; readonly heading: string; readonly source: string }

export type DoctrineLike = {
  /** Resolves once the hive's own doctrine is loaded (or the seed stands). */
  readonly ready: Promise<void>
  /** The sections the anatomy carries now, 1-based. */
  sections(): readonly DoctrineSectionInfo[]
  /** The build carries doctrine this hive has never taken. */
  seedPending(): boolean
  /** Replace the section with this heading, or add it. The participant's act. */
  write(heading: string, body: string): Promise<DoctrineOutcome>
  /** Commit the doctrine without section `index` (1-based). */
  drop(index: number): Promise<DoctrineOutcome>
  /** Commit the doctrine the head replaced, again. */
  back(): Promise<DoctrineOutcome>
  /** Commit the build's doctrine as the head. */
  seed(): Promise<DoctrineOutcome>
}

export type AnatomyLike = {
  /** The anatomy now: the system prompt every provider receives first. */
  readonly text: string
  /** sign(text) for the anatomy now. */
  readonly signature: () => Promise<string>
  /** Resolves to that sig once the bytes are a root resource on disk — a
   *  turn record waits on this so it never names a sig that cannot be read. */
  readonly written: Promise<string>
  /** The marker name in the `system:anatomy` bag that names the settled
   *  anatomy, or undefined when the store could not be asked. */
  readonly marker: Promise<string | undefined>
  /** Which documents and sections the SEED doctrine was lifted from. */
  readonly sources: readonly { readonly doc: string; readonly heading: string }[]
  readonly doctrine: DoctrineLike
}

type StoreLike = {
  putResource?: (blob: Blob, options?: { emit?: boolean }) => Promise<string>
  getResource?: (sig: string) => Promise<Blob | null>
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
}
const STORE_KEY = '@hypercomb.social/Store'
const POLL_MS = 250
const POLL_LIMIT = 240 // a minute; past that the store is not coming this boot

// ── the store, once it is really there ─────────────────────────────────────
//
// POLLED, NOT `whenReady`. This module registers early, and `window.ioc` is
// REPLACED after the first barrel modules load (llm-provider-registry.ts) — a
// `whenReady` parked on the early map never fires. And a store whose method
// EXISTS is not yet READY: the instance is registered before its OPFS root is
// open, and a write in that window rejects. So a rejection means "not yet";
// only the limit ends the poll, and then the seed still travels from memory.
const seedText = composeAnatomy(ANATOMY_MECHANICS, ANATOMY_SECTIONS)
const store: Promise<StoreLike | undefined> = new Promise(resolve => {
  let polls = 0
  const later = (): void => { if (++polls < POLL_LIMIT) setTimeout(tick, POLL_MS); else resolve(undefined) }
  const tick = (): void => {
    const found = window.ioc?.get?.(STORE_KEY) as StoreLike | undefined
    if (!found?.putResource) return later()
    let attempt: Promise<string>
    try { attempt = found.putResource(new Blob([seedText], { type: 'text/markdown' }), { emit: false }) } catch { return later() }
    attempt.then(() => resolve(found), later)
  }
  tick()
})

const dirBag = (dir: FileSystemDirectoryHandle): DoctrineBag => ({
  names: async () => {
    const names: string[] = []
    for await (const [name, handle] of (dir as unknown as AsyncIterable<[string, FileSystemHandle]>)) if (handle.kind === 'file') names.push(name)
    return names
  },
  read: async name => { try { return await (await (await dir.getFileHandle(name)).getFile()).text() } catch { return null } },
  write: async (name, text) => {
    const writable = await (await dir.getFileHandle(name, { create: true })).createWritable()
    try { await writable.write(new Blob([text])) } finally { await writable.close() }
  },
})

const ioFor = (found: StoreLike): DoctrineIo => ({
  put: (text, type) => found.putResource!(new Blob([text], { type }), { emit: false }),
  get: async sig => (await found.getResource?.(sig))?.text() ?? null,
  bag: async () => {
    const dir = await found.getPool?.(DOCTRINE_BAG_MEANING)
    return dir ? dirBag(dir) : null
  },
  now: Date.now,
})

// ── the anatomy's own lineage bag ──────────────────────────────────────────
//
// `sign('system:anatomy')`, markers 00000000, 00000001, … each a
// `{ layerSig, at }` record naming one anatomy version, the highest being the
// live one (anatomy-context-need §2, §6). Advanced only when the head names a
// different sig, and only for the SETTLED anatomy — the seed that runs while
// the store opens is written as a resource, never recorded, so a hive whose
// doctrine differs from the seed does not add two markers every boot.
const MARKER = /^\d{8}$/
const recordAnatomy = async (found: StoreLike, sig: string): Promise<string | undefined> => {
  try {
    const bag = await found.getPool?.('system:anatomy')
    if (!bag) return undefined
    let max = -1
    for await (const [name, handle] of (bag as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
      if (handle.kind === 'file' && MARKER.test(name)) max = Math.max(max, Number(name))
    }
    if (max >= 0) {
      const head = await (await bag.getFileHandle(String(max).padStart(8, '0'))).getFile()
      try {
        const record = JSON.parse(await head.text()) as { layerSig?: string }
        if (record.layerSig === sig) return String(max).padStart(8, '0')
      } catch { /* an unreadable head is not this sig; advance past it */ }
    }
    const next = String(max + 1).padStart(8, '0')
    const writable = await (await bag.getFileHandle(next, { create: true })).createWritable()
    try { await writable.write(new Blob([JSON.stringify({ layerSig: sig, at: Date.now() })])) } finally { await writable.close() }
    return next
  } catch {
    return undefined
  }
}

// ── the state ──────────────────────────────────────────────────────────────

let state: DoctrineState = { sections: ANATOMY_SECTIONS, recordSig: '', marker: '', by: 'seed', seedPending: false }
let text = seedText
const signatures = new Map<string, Promise<string>>()
const signOf = (value: string): Promise<string> => {
  let pending = signatures.get(value)
  if (!pending) { pending = SignatureService.sign(new TextEncoder().encode(value).buffer as ArrayBuffer); signatures.set(value, pending) }
  return pending
}
const writes = new Map<string, Promise<string>>()
const writeText = (value: string): Promise<string> => {
  let pending = writes.get(value)
  if (!pending) {
    pending = store.then(found => found?.putResource
      ? found.putResource(new Blob([value], { type: 'text/markdown' }), { emit: false })
      : Promise.reject(new Error('no store')))
    writes.set(value, pending)
  }
  return pending
}
let marker: Promise<string | undefined> = Promise.resolve(undefined)

/** The doctrine settled: compose the anatomy, write it, record it. */
const settle = (next: DoctrineState): void => {
  state = next
  text = composeAnatomy(ANATOMY_MECHANICS, next.sections)
  const settled = text
  marker = Promise.all([store, writeText(settled)])
    .then(([found, sig]) => found ? recordAnatomy(found, sig) : undefined)
    .catch(() => undefined)
}

const ready: Promise<void> = store.then(async found => {
  if (!found) { settle(state); return }
  try { settle(await loadDoctrine(ioFor(found), ANATOMY_SECTIONS)) } catch { settle(state) }
})

/** Every act waits for the load, commits through doctrine.ts, and settles. */
const act = async (sections: readonly string[] | { error: string }): Promise<DoctrineOutcome> => {
  if ('error' in sections) return { ok: false, error: sections.error }
  const found = await store
  if (!found) return { ok: false, error: 'the doctrine cannot be written here: no store is open' }
  const outcome = await commitDoctrine(ioFor(found), sections, 'hive', ANATOMY_SECTIONS)
  if (outcome.ok) settle(outcome.state)
  return outcome
}

const doctrine: DoctrineLike = {
  ready,
  sections: () => state.sections.map((section, i) => ({ index: i + 1, heading: headingOf(section), source: sourceOf(section) })),
  seedPending: () => state.seedPending,
  write: async (heading, body) => {
    await ready
    if (!isHeading(heading)) return { ok: false, error: 'a doctrine heading is one line of at most 80 characters, without backticks or #' }
    if (!body.trim()) return { ok: false, error: 'the section has no text: a doctrine section is dropped with the doctrine word, never emptied' }
    return act(writeSection(state.sections, heading, body))
  },
  drop: async index => {
    await ready
    if (!Number.isInteger(index) || index < 1 || index > state.sections.length) return { ok: false, error: `there is no section ${index}; the doctrine has ${state.sections.length}` }
    return act(state.sections.filter((_, i) => i !== index - 1))
  },
  back: async () => {
    await ready
    const found = await store
    const previous = found ? await previousDoctrine(ioFor(found)) : { error: 'no store is open' }
    return act('error' in previous ? previous : previous.sections)
  },
  seed: async () => {
    await ready
    const found = await store
    if (!found) return { ok: false, error: 'the doctrine cannot be written here: no store is open' }
    const outcome = await commitDoctrine(ioFor(found), ANATOMY_SECTIONS, 'seed', ANATOMY_SECTIONS)
    if (outcome.ok) settle(outcome.state)
    return outcome
  },
}

export const anatomy: AnatomyLike = {
  get text() { return text },
  signature: () => signOf(text),
  get written() { const now = text; return writeText(now).then(() => signOf(now)) },
  get marker() { return ready.then(() => marker) },
  sources: ANATOMY_SOURCES,
  doctrine,
}

// Both lines are needed. The first is what `prepare` looks for to classify
// this file as a side-effect module and load it at all; the second survives
// the early `window.ioc` map being replaced (see llm-provider-registry.ts).
window.ioc?.register(ANATOMY_IOC_KEY, anatomy)
publishService(ANATOMY_IOC_KEY, anatomy)
