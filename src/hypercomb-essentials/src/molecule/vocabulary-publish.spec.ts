// molecule/vocabulary-publish.spec.ts
//
// THE CONSTRAINT UNDER TEST IS THE ONE THE WHOLE FEATURE TURNS ON:
//
//   "A publish is something the participant DOES. It is never automatic, never
//    a side effect of the optimize phase, never triggered by a commit."
//
// Three layers of proof, because prose is not a gate:
//
//   1. THE API GUARD — `confirmed: true` is a required argument with no
//      default, so a caller cannot omit consent by forgetting a parameter.
//   2. THE MINT ORDER — `HostSyncService` auto-enqueues every `content:wrote`
//      sig and drains on a timer, so MINTING IS UPLOADING. Nothing may reach
//      `putResource` or `markPublic` before the confirmation resolves. Spied,
//      in order, so the obvious "precompute the claim to show its size"
//      optimisation fails here rather than shipping a silent upload.
//   3. A SOURCE SCAN — nothing under `molecule/` may import the publish
//      module, and the module itself may not contain an effect subscription,
//      an optimize hook, or a call to anything that widens scope. This is the
//      repo's own anti-drift mechanism pointed at the constraint.

import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { moleculeAddress, parseVocabularyBody } from '@hypercomb/core'
import { BRIDGE_FORBIDDEN_ROOT_KEYS, VOCABULARY_ROOT_KEY } from '../sharing/hive-link.js'
import {
  buildVocabularyBody,
  publishVocabulary,
  withdrawVocabulary,
  type VocabularyPublishDeps,
} from './vocabulary-publish.js'
import { signVocabularyClaim } from './vocabulary-signer.js'

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')
const hex = (n: number): string => n.toString(16).padStart(64, '0')

const PUBKEY = sha('alice')
const SURFACE = sha('vocabulary:hive')
const COFFEE = sha('coffee')
const TEA = sha('tea')
/** THE BRANCH'S OWN NAME. A record is the fold over a layer's CHILDREN
 *  manifest, so it never holds the branch tile's own name — and a visitor who
 *  can fetch `/work` can plainly read "work". Omitting it from a claim signed
 *  `complete: true` is a WRONG NO for the single most likely search term. */
const WORK = await moleculeAddress('work')

interface Rig {
  deps: VocabularyPublishDeps
  order: string[]
  stored: Map<string, string>
  root: { key: string; sig: string } | null
  records: { claim: string; seq: number; count: number; complete: boolean }[]
  agree: boolean
  summaries: { words: number; branches: string[]; complete: boolean; seq: number | null; withdrawal: boolean }[]
}

const rig = (over: Partial<VocabularyPublishDeps> & {
  branches?: string[]
  published?: string[]
  heads?: Record<string, string>
  records?: Record<string, { words: { a: string }[]; truncated?: boolean } | null>
  held?: { body: string; seq: number } | null
  minted?: { body: string; seq: number } | null
  agree?: boolean
} = {}): Rig => {
  const order: string[] = []
  const stored = new Map<string, string>()
  const state: Rig = {
    order, stored, root: null, records: [],
    agree: over.agree !== false,
    summaries: [],
    deps: null as never,
  }
  const branches = over.branches ?? ['/work']
  const published = new Set(over.published ?? ['work'])
  const heads = over.heads ?? { work: hex(0xaa) }
  const records = over.records ?? { [hex(0xaa)]: { words: [{ a: COFFEE }, { a: TEA }] } }

  state.deps = {
    surface: async () => SURFACE,
    publicKey: async () => PUBKEY,
    host: async () => 'content.example',

    publicBranches: () => branches,
    publishedKeys: async () => published,
    lineageKeyOf: (segments) => segments.join('-'),
    headOf: async (segments) => heads[segments.join('-')] ?? null,
    readRecord: async (layerSig) => records[layerSig] ?? null,

    hash: async (text) => sha(text),
    readHeld: async () => over.held ?? null,
    readMinted: async () => over.minted ?? null,

    confirm: async (summary) => {
      order.push('confirm')
      state.summaries.push({
        words: summary.words,
        branches: [...summary.branches],
        complete: summary.complete,
        seq: summary.seq,
        withdrawal: summary.withdrawal,
      })
      return state.agree
    },

    sign: async (surface, body, prev, seq, count, complete) => {
      order.push('sign')
      const content = [surface, body, prev ?? '-', seq, count, complete ? 1 : 0].join('|')
      return { ok: true, pubkey: PUBKEY, claim: { body, prev, seq, count, complete, sig: 'ab' }, event: {}, json: JSON.stringify({ content }) }
    },
    putResource: async (text) => {
      order.push('putResource')
      const sig = sha(text)
      stored.set(sig, text)
      return sig
    },
    markPublic: async () => { order.push('markPublic') },
    available: async () => true,
    setRoot: async (host, key, sig) => {
      order.push('setRoot')
      state.root = { key, sig }
      return { ok: true }
    },
    writeRecord: async (claim, record) => {
      order.push('writeRecord')
      state.records.push({ claim, seq: record.seq, count: record.count, complete: record.complete })
      return true
    },
    now: () => 1_700_000_000_000,
    wait: async () => { /* no clock in a spec */ },
    ...over,
  }
  return state
}

/** The write half of the deps — the calls that put bytes on a drain queue. */
const WRITES = ['putResource', 'markPublic', 'sign', 'setRoot', 'writeRecord']

describe('publishing is an act', () => {

  it('REFUSES without an explicit confirmed:true, and mints nothing', async () => {
    const r = rig()
    const result = await publishVocabulary({}, r.deps)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.failure).toBe('not-confirmed')
    expect(r.order).toEqual([])
    expect(r.root).toBeNull()
  })

  it('REFUSES on confirmed:false, and on a truthy non-true value', async () => {
    for (const confirmed of [false, undefined, 1 as unknown as boolean, 'yes' as unknown as boolean]) {
      const r = rig()
      const result = await publishVocabulary({ confirmed }, r.deps)
      expect(result.ok === false && result.failure).toBe('not-confirmed')
      expect(r.order).toEqual([])
    }
  })

  it('REFUSES when the participant declines, after asking and before minting', async () => {
    const r = rig({ agree: false })
    const result = await publishVocabulary({ confirmed: true }, r.deps)
    expect(result.ok === false && result.failure).toBe('declined')
    expect(r.order).toEqual(['confirm'])
    expect(r.root).toBeNull()
  })

  it('NOTHING REACHES A WRITE BEFORE THE CONFIRMATION RESOLVES', async () => {
    const r = rig()
    const result = await publishVocabulary({ confirmed: true }, r.deps)
    expect(result.ok).toBe(true)
    const firstWrite = r.order.findIndex((step) => WRITES.includes(step))
    expect(firstWrite).toBeGreaterThan(-1)
    expect(r.order.indexOf('confirm')).toBeLessThan(firstWrite)
    // and the confirmation is asked exactly once
    expect(r.order.filter((s) => s === 'confirm')).toHaveLength(1)
  })

  it('advances exactly one root key, and it is the reserved vocabulary key', async () => {
    const r = rig()
    const result = await publishVocabulary({ confirmed: true }, r.deps)
    expect(result.ok).toBe(true)
    expect(r.root?.key).toBe(VOCABULARY_ROOT_KEY)
    expect(result.ok && r.root?.sig).toBe(result.ok && result.claim)
  })

  it('records the act in the ledger BEFORE reporting success', async () => {
    const r = rig()
    await publishVocabulary({ confirmed: true }, r.deps)
    expect(r.order.indexOf('writeRecord')).toBeGreaterThan(r.order.indexOf('setRoot'))
    expect(r.records).toHaveLength(1)
    expect(r.records[0]?.seq).toBe(0)
  })

  it('refuses nothing-published rather than signing an accidental empty claim', async () => {
    const r = rig({ branches: [], published: [] })
    const result = await publishVocabulary({ confirmed: true }, r.deps)
    expect(result.ok === false && result.failure).toBe('nothing-published')
    expect(r.order).toEqual([])
  })

  it('refuses when the availability gate never opens — never a pointer to unserved bytes', async () => {
    let ticks = 0
    const r = rig({
      available: async () => false,
      now: () => 1_700_000_000_000 + (ticks++ * 5_000),
    })
    const result = await publishVocabulary({ confirmed: true }, r.deps)
    expect(result.ok === false && result.failure).toBe('not-available')
    expect(r.root).toBeNull()
  })
})

describe('the scope model', () => {

  it('declares only words under a branch that is BOTH marked public and in the ledger', async () => {
    const r = rig({
      branches: ['/work', '/private'],
      published: ['work'],
      heads: { work: hex(0xaa), private: hex(0xbb) },
      records: {
        [hex(0xaa)]: { words: [{ a: COFFEE }] },
        [hex(0xbb)]: { words: [{ a: TEA }] },
      },
    })
    const built = await buildVocabularyBody(r.deps)
    expect(built.addresses).toEqual([COFFEE, WORK].sort())
    expect(built.branches).toEqual(['/work'])
    // AND IT SAYS SO. `/private` was dropped by the intersection, which is a
    // NARROWER PICTURE — and the ledger is "a floor, never a ceiling" that
    // cannot see another device's publishes, so a drop may well be a branch
    // whose bytes really are served. `complete: false` is exactly the field
    // that exists to say that out loud; signing `true` here would license a
    // reader to mint `absent` for a word this hive serves.
    expect(built.complete).toBe(false)
  })

  it('a branch nobody marked public contributes nothing — private is the DEFAULT', async () => {
    const r = rig({ branches: [], published: ['work'] })
    const built = await buildVocabularyBody(r.deps)
    expect(built.addresses).toEqual([])
    expect(built.branches).toEqual([])
  })

  it('a MISSING record makes the whole claim admit it is incomplete', async () => {
    const r = rig({ records: {} })
    const built = await buildVocabularyBody(r.deps)
    expect(built.complete).toBe(false)
  })

  it('a TRUNCATED record makes the whole claim admit it is incomplete', async () => {
    const r = rig({ records: { [hex(0xaa)]: { words: [{ a: COFFEE }], truncated: true } } })
    const built = await buildVocabularyBody(r.deps)
    expect(built.complete).toBe(false)
    expect(built.addresses).toEqual([COFFEE, WORK].sort())
  })

  it('a missing HEAD makes the claim incomplete rather than silently narrower', async () => {
    const r = rig({ heads: {} })
    const built = await buildVocabularyBody(r.deps)
    expect(built.complete).toBe(false)
  })

  it('the incompleteness reaches the participant AND the signed claim', async () => {
    const r = rig({ records: { [hex(0xaa)]: { words: [{ a: COFFEE }], truncated: true } } })
    const result = await publishVocabulary({ confirmed: true }, r.deps)
    expect(r.summaries[0]?.complete).toBe(false)
    expect(result.ok && result.complete).toBe(false)
    expect(r.records[0]?.complete).toBe(false)
  })

  it('the body it mints is canonical, hex-only, and holds exactly the declared words', async () => {
    const r = rig()
    const result = await publishVocabulary({ confirmed: true }, r.deps)
    expect(result.ok).toBe(true)
    const text = result.ok ? r.stored.get(result.body) : undefined
    expect(text).toBeTruthy()
    const parsed = parseVocabularyBody(text as string)
    expect(parsed?.words).toEqual([COFFEE, TEA, WORK].sort())
    expect(parsed?.pubkey).toBe(PUBKEY)
    // No display spellings, no counts — nothing a stranger wrote as TEXT.
    expect(Object.keys(JSON.parse(text as string)).sort()).toEqual(['kind', 'pubkey', 'v', 'words'])
  })
})

describe('withdrawal is a second, distinct verb', () => {

  it('signs an EMPTY, COMPLETE claim at seq+1 — the only way to say "I hold nothing"', async () => {
    const r = rig({ minted: { body: hex(0xcc), seq: 4 } })
    const result = await withdrawVocabulary({ confirmed: true }, r.deps)
    expect(result.ok).toBe(true)
    expect(result.ok && result.count).toBe(0)
    expect(result.ok && result.complete).toBe(true)
    expect(result.ok && result.seq).toBe(5)
    expect(r.summaries[0]?.withdrawal).toBe(true)
  })

  it('still refuses without an explicit act', async () => {
    const r = rig()
    const result = await withdrawVocabulary({}, r.deps)
    expect(result.ok === false && result.failure).toBe('not-confirmed')
    expect(r.order).toEqual([])
  })

  it('publishVocabulary can never become a withdrawal by accident', async () => {
    const r = rig({ branches: [], published: [] })
    expect((await publishVocabulary({ confirmed: true }, r.deps)).ok).toBe(false)
  })
})

describe('anti-rollback', () => {

  it('takes the STRONGER of the host-held and the locally minted counter', async () => {
    const behind = rig({ held: { body: hex(0x11), seq: 0 }, minted: { body: hex(0x22), seq: 2 } })
    expect((await publishVocabulary({ confirmed: true }, behind.deps) as { seq: number }).seq).toBe(3)

    const ahead = rig({ held: { body: hex(0x11), seq: 9 }, minted: { body: hex(0x22), seq: 2 } })
    expect((await publishVocabulary({ confirmed: true }, ahead.deps) as { seq: number }).seq).toBe(10)
  })
})

describe('the signer is never a weaker gate than the reader', () => {

  it('refuses a malformed shape BEFORE a signing prompt is ever spent', async () => {
    const signEvent = vi.fn(async () => ({ pubkey: PUBKEY, sig: 'ab' }))
    const result = await signVocabularyClaim(
      'not-a-surface', sha('body'), null, 0, 1, true,
      { signer: () => ({ signEvent }), publicKey: async () => PUBKEY },
    )
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('malformed')
    expect(signEvent).not.toHaveBeenCalled()
  })

  it('refuses when there is no identity, without throwing', async () => {
    const result = await signVocabularyClaim(
      SURFACE, sha('body'), null, 0, 1, true,
      { signer: () => undefined, publicKey: async () => null },
    )
    expect(result.ok === false && result.reason).toBe('no signer')
  })

  it('refuses when the signer hands back a different key', async () => {
    const signEvent = vi.fn(async () => ({ pubkey: sha('someone-else'), sig: 'ab', content: '' }))
    const result = await signVocabularyClaim(
      SURFACE, sha('body'), null, 0, 1, true,
      { signer: () => ({ signEvent }), publicKey: async () => PUBKEY },
    )
    expect(result.ok === false && result.reason).toBe('signer key changed')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// THE SOURCE SCAN — the mechanical half
// ═══════════════════════════════════════════════════════════════════════════

const ROOT = process.cwd()
const MOLECULE_DIR = join(ROOT, 'hypercomb-essentials', 'src', 'molecule')

const sourcesIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts'))
    .map((e) => e.name)

describe('nothing publishes automatically', () => {

  it('no module under molecule/ imports the publish door except its own live wiring', () => {
    const importers = sourcesIn(MOLECULE_DIR).filter((name) => {
      if (name === 'vocabulary-publish.ts') return false
      if (name === 'vocabulary-publish.deps.ts') return false
      if (name === 'index.ts') return false        // the auto-generated barrel
      return /from\s+'\.\/vocabulary-publish\.js'/.test(readFileSync(join(MOLECULE_DIR, name), 'utf8'))
    })
    // Empty, and it stays empty. A publish reached from a drone, a service or
    // the index minter is a publish nobody asked for.
    expect(importers).toEqual([])
  })

  it('the publish module subscribes to nothing and hooks no phase', () => {
    const src = readFileSync(join(MOLECULE_DIR, 'vocabulary-publish.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    for (const forbidden of [
      'onEffect', 'EffectBus', 'addEventListener', 'requestIdleCallback',
      'setInterval', 'optimize', 'content:wrote', 'publishBranch',
      'setBranchPublic', 'enablePublicHost',
    ]) {
      expect(src.includes(forbidden), `${forbidden} must not appear in vocabulary-publish.ts`).toBe(false)
    }
    // Every effect on the world arrives through the injected deps, so there is
    // no service, no key and no socket the routine can reach on its own.
    expect(/\bget\s*[<(]/.test(src), 'the routine must not resolve services itself').toBe(false)
    expect(src.includes('fetch('), 'the routine must not open a socket itself').toBe(false)
    for (const write of ['putResource', 'markPublic', 'setRoot', 'writeRecord', 'sign(']) {
      // ...and every one of them is spelled `deps.<write>` at the call site.
      const bare = new RegExp(`(?<!deps\\.)(?<!readonly )\\b${write.replace('(', '\\(')}`, 'g')
      const hits = [...src.matchAll(bare)].map((m) => m[0])
      expect(hits.length === 0 || src.includes(`deps.${write}`), `${write} must be reached through deps`).toBe(true)
    }
  })

  it('the index minter knows nothing about publishing', () => {
    const drone = readFileSync(join(MOLECULE_DIR, 'molecule-index.drone.ts'), 'utf8')
    expect(drone.includes('publishVocabulary')).toBe(false)
    expect(drone.includes('vocabulary-publish')).toBe(false)
    // and its early return — a pass with nothing committed still costs nothing
    expect(drone.includes('#pending.size === 0')).toBe(true)
  })

  it('the bridge cannot advance the vocabulary root key', () => {
    expect(BRIDGE_FORBIDDEN_ROOT_KEYS).toContain(VOCABULARY_ROOT_KEY)
    const worker = readFileSync(
      join(ROOT, 'hypercomb-essentials', 'src', 'assistant', 'claude-bridge.worker.ts'), 'utf8',
    )
    // The colon test alone is NOT the guard — `vocabulary:hive` passes it.
    // The guard is the ALLOW-list: only an install stamp is settable.
    expect(worker.includes('bridgeMaySetRootKey(key)')).toBe(true)
    expect(worker.includes('BRIDGE_FORBIDDEN_ROOT_KEYS')).toBe(false)
    // and the vocabulary act is deliberately not a remote intent
    expect(worker.includes("'vocabulary:publish'")).toBe(false)
  })
})
