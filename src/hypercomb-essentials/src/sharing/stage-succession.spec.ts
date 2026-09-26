// stage-succession.spec.ts — THE STAGE LISTS (documentation/deployment-stages.md).
//
// An author's stage list is ONE succession in the stage word's molecule:
// advancing a creation lists its head (and drops its previous head, so one
// creation is one member), the same list writes nothing, and leaving is the
// next list without it — an unlink, never a forget. Signed with a real key so
// the read side's verifier is the one a stranger would run.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { SignatureService, mintMetaEnvelope, moleculeAddress } from '@hypercomb/core'
import type { FacetStore } from '../molecule/facet-succession.js'

const SECRET = new Uint8Array(32).fill(7)
const PUBKEY = getPublicKey(SECRET)
const H1 = 'c'.repeat(64)
const H2 = 'd'.repeat(64)
const H3 = 'e'.repeat(64)

/** jsdom's Blob has no text(); FileReader is the one door both have. */
const readBlobText = (blob: Blob): Promise<string> =>
  typeof (blob as { text?: unknown }).text === 'function'
    ? blob.text()
    : new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsText(blob) })

const registry = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry.set(key, value) },
  get: (key: string) => registry.get(key),
  whenReady: () => undefined,
}

/** Content-addressed resources; one pool per stage word with author buckets;
 *  the per-device minted document. Enough store for a list to be written,
 *  read back and chained. */
const fake = () => {
  const resources = new Map<string, string>()
  const pools = new Map<string, Map<string, Map<string, string>>>()   // meaning → pubkey → claimSig → json
  const docs = new Map<string, ArrayBuffer>()
  const bucketDir = (files: Map<string, string>, name: string): FileSystemDirectoryHandle => ({
    name, kind: 'directory',
    async *entries() { for (const n of files.keys()) yield [n, { kind: 'file', getFile: async () => ({ text: async () => files.get(n) }) }] },
    getFileHandle: async (n: string) => ({
      createWritable: async () => ({ write: async (b: Uint8Array) => { files.set(n, new TextDecoder().decode(b)) }, close: async () => {} }),
    }),
  } as unknown as FileSystemDirectoryHandle)
  const poolDir = (meaning: string): FileSystemDirectoryHandle => {
    if (!pools.has(meaning)) pools.set(meaning, new Map())
    const buckets = pools.get(meaning)!
    return {
      name: meaning, kind: 'directory',
      getDirectoryHandle: async (pubkey: string) => {
        if (!buckets.has(pubkey)) buckets.set(pubkey, new Map())
        return bucketDir(buckets.get(pubkey)!, pubkey)
      },
      async *entries() { for (const [pubkey, files] of buckets) yield [pubkey, bucketDir(files, pubkey)] },
    } as unknown as FileSystemDirectoryHandle
  }
  const store: FacetStore & { openPool: (m: string) => Promise<FileSystemDirectoryHandle | null>; resources: Map<string, string> } = {
    resources,
    getPool: async (meaning) => poolDir(meaning),
    openPool: async (meaning) => (pools.has(meaning) ? poolDir(meaning) : null),
    putPoolDoc: async (_p, bytes, subKey) => { docs.set(String(subKey), bytes); return 'f'.repeat(64) },
    getPoolDoc: async (_p, subKey) => docs.get(String(subKey)) ?? null,
    putResource: async (blob) => {
      const text = await readBlobText(blob)
      const sig = await SignatureService.sign(new TextEncoder().encode(text).buffer as ArrayBuffer)
      resources.set(sig, text)
      return sig
    },
    // The REAL Store.getResource resolves a meta envelope to its payload (a
    // `layer` hop reads as null); the raw bytes are getResourceLocal. The
    // fake does the same, so a reader that forgets the raw door fails here.
    getResource: async (sig) => {
      const t = resources.get(sig)
      if (t === undefined) return null
      try {
        const record = JSON.parse(t) as Record<string, unknown>
        if (record['meta'] === 1) {
          if (typeof record['layer'] === 'string') return null
          if (typeof record['resource'] === 'string') return store.getResourceLocal!(String(record['resource']))
        }
      } catch { /* raw bytes */ }
      return { text: async () => t } as unknown as Blob
    },
    getResourceLocal: async (sig) => { const t = resources.get(sig); return t === undefined ? null : ({ text: async () => t } as unknown as Blob) },
    putArtifactMeta: async (kind, sig, incidence) => {
      const record = mintMetaEnvelope({ [kind]: sig, ...incidence })
      return store.putResource(new Blob([JSON.stringify(record)]))
    },
  }
  return store
}

type Stage = typeof import('./stage-succession.js')
let stage: Stage
let store: ReturnType<typeof fake>

beforeAll(async () => {
  registry.set('@diamondcoreprocessor.com/NostrSigner', {
    getPublicKeyHex: async () => PUBKEY,
    signEvent: async (event: { kind: number; created_at: number; tags: string[][]; content: string }) => finalizeEvent(event, SECRET),
  })
  const signer = await import('./head-claim-signer.js')
  await signer.readerPubkey()
  stage = await import('./stage-succession.js')
})

beforeEach(async () => {
  store = fake()
  registry.set('@hypercomb.social/Store', store)
  const facet = await import('../molecule/facet-succession.js')
  facet._resetMintedFacetClaims()
})

const io = () => ({ store, now: () => 1 })

describe('the stage lists', () => {
  it('advancing lists the head as an envelope of the stage word, in the author\'s own succession', async () => {
    const r = await stage.advanceStage('shared', { add: [H1] }, io())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.changed).toBe(true)
    expect(r.facet).toBe(await moleculeAddress('shared'))
    expect(await stage.readStageHeads('shared', io())).toEqual([H1])
    const envelope = JSON.parse(store.resources.get(r.envelopes[0]!)!)
    expect(envelope).toMatchObject({ meta: 1, layer: H1, relation: 'shared', root: 'shared', slot: 0 })
    const atom = JSON.parse(store.resources.get(r.head)!)
    expect(atom).toMatchObject({ succession: 1, signer: PUBKEY, prev: null, members: r.envelopes })
    // The signed claim is also a root resource under its own sig — what an
    // index pointer names — and its preimage names this head for sign('shared').
    const claim = JSON.parse(store.resources.get(r.claim)!)
    const [tag, molecule, key, head] = String(claim.content).split('\n')
    expect([tag, molecule, key, head]).toEqual(['hc:molecule-head:v1', r.facet, PUBKEY, r.head])
  })

  it('the same list writes nothing, and a second creation joins the list rather than replacing it', async () => {
    const first = await stage.advanceStage('published', { add: [H1] }, io())
    const again = await stage.advanceStage('published', { add: [H1] }, io())
    expect(again.ok && !again.changed && first.ok && again.head === first.head).toBe(true)
    const second = await stage.advanceStage('published', { add: [H2] }, io())
    expect(second.ok && second.changed).toBe(true)
    expect(await stage.readStageHeads('published', io())).toEqual([H1, H2])
    if (!second.ok || !first.ok) return
    const atom = JSON.parse(store.resources.get(second.head)!)
    expect(atom.prev).toBe(first.head)
  })

  it('a republished creation replaces its previous head — one creation is one member', async () => {
    await stage.advanceStage('published', { add: [H1] }, io())
    await stage.advanceStage('published', { add: [H2] }, io())
    const r = await stage.advanceStage('published', { add: [H3], remove: [H1] }, io())
    expect(r.ok && r.changed).toBe(true)
    expect(await stage.readStageHeads('published', io())).toEqual([H2, H3])
  })

  it('withdrawing is the next list without the head; a head never listed changes nothing', async () => {
    const listed = await stage.advanceStage('shared', { add: [H1, H2] }, io())
    const gone = await stage.withdrawStage('shared', [H1], io())
    expect(gone.ok && gone.changed).toBe(true)
    expect(await stage.readStageHeads('shared', io())).toEqual([H2])
    if (!gone.ok || !listed.ok) return
    // Unlink, never forget: the prior list is one prev back, byte for byte.
    expect(JSON.parse(store.resources.get(gone.head)!).prev).toBe(listed.head)
    expect(store.resources.has(listed.head)).toBe(true)
    const noop = await stage.withdrawStage('shared', [H3], io())
    expect(noop.ok && !noop.changed).toBe(true)
  })

  it('writes nothing without an identity', async () => {
    const r = await stage.advanceStage('live', { add: [H1] }, { store, pubkey: null })
    expect(r).toEqual({ ok: false, reason: 'no identity' })
    expect(await stage.readStageHeads('live', { store, pubkey: null })).toEqual([])
  })

  it('names the reserved pointer key for a word, and nothing else is a stage key', () => {
    expect(stage.stageRootKey('shared')).toBe('stage:shared')
    expect(stage.isStageRootKey('stage:published')).toBe(true)
    expect(stage.isStageRootKey('site/blog')).toBe(false)
  })
})
