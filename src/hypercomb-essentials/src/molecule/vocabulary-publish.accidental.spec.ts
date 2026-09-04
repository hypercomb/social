// molecule/vocabulary-publish.accidental.spec.ts
//
// ADVERSARIAL LENS: ACCIDENTAL PUBLISH.
//
// `vocabulary-publish.spec.ts` proves that no WRITE happens before the
// confirmation. That is a real guarantee and it holds. This file attacks the
// gap it leaves: the spy log in that file instruments ONLY the write half of
// the deps (`putResource`, `markPublic`, `sign`, `setRoot`, `writeRecord`), so
// `expect(r.order).toEqual(['confirm'])` on a declined publish reads as
// "nothing happened" when in fact the READ half already ran — and two members
// of the read half are not reads at all in the sense that matters:
//
//   * `publicKey` is wired to `readerPubkey()`, which falls through to
//     `NostrSigner.resolveSecretKeyHex()` and MINTS AND PERSISTS a fresh
//     secp256k1 secret into `localStorage` on a miss. `nostr-signer.ts` names
//     this hazard itself: "a user who explicitly clicked 'reject' would walk
//     away with a persistent signing identity in plaintext localStorage that
//     they declined". A declined vocabulary publish does exactly that.
//
//   * `readHeld` is wired to `fetchHiveIndex()` + a second `fetch()`, i.e. TWO
//     HTTPS requests to the standing public content endpoint carrying the
//     participant's public key — sent before the participant has been asked.
//
// Neither ships the word list, so neither is the vocabulary itself leaving.
// Both are irreversible/off-machine effects of an act the participant may be
// about to decline, and the existing spec cannot see either.

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { nestedResourceSigs } from '../sharing/decoration-closure.js'
import { publishVocabulary, withdrawVocabulary, type VocabularyPublishDeps } from './vocabulary-publish.js'

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')
const hex = (n: number): string => n.toString(16).padStart(64, '0')

const PUBKEY = sha('alice')
const SURFACE = sha('vocabulary:hive')
const COFFEE = sha('coffee')

/** Every dep instrumented — the READ half too, which is the whole point. */
const spied = (): { deps: VocabularyPublishDeps; order: string[] } => {
  const order: string[] = []
  const step = <T>(name: string, value: T): T => { order.push(name); return value }
  const deps: VocabularyPublishDeps = {
    surface: async () => step('surface', SURFACE),
    publicKey: async () => step('publicKey', PUBKEY),
    host: async () => step('host', 'content.example'),
    publicBranches: () => step('publicBranches', ['/work']),
    publishedKeys: async () => step('publishedKeys', new Set(['work'])),
    lineageKeyOf: (segments) => segments.join('-'),
    headOf: async () => step('headOf', hex(0xaa)),
    readRecord: async () => step('readRecord', { words: [{ a: COFFEE }] }),
    hash: async (text) => step('hash', sha(text)),
    readHeld: async () => step('readHeld', null),
    readMinted: async () => step('readMinted', null),
    confirm: async () => step('confirm', false),
    sign: async () => step('sign', { ok: false, reason: 'no signer' } as never),
    putResource: async (text) => step('putResource', sha(text)),
    markPublic: async () => { step('markPublic', undefined) },
    available: async () => step('available', true),
    setRoot: async () => step('setRoot', { ok: true }),
    writeRecord: async () => step('writeRecord', true),
    now: () => 1_700_000_000_000,
    wait: async () => { /* no clock */ },
  }
  return { deps, order }
}

describe('ACCIDENTAL PUBLISH — what runs before the participant is asked', () => {

  // ── FINDING 1 ────────────────────────────────────────────────────────────
  it('a DECLINED publish must not resolve the signing key — readerPubkey MINTS one', async () => {
    const { deps, order } = spied()
    const result = await publishVocabulary({ confirmed: true }, deps)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.failure).toBe('declined')
    // `publicKey` is `readerPubkey`, which persists a fresh secret key on a
    // miss. A participant who opens the dialog and says NO must not be left
    // holding a signing identity they never agreed to become.
    expect(
      order.slice(0, order.indexOf('confirm')),
      'these deps ran before the participant was asked',
    ).not.toContain('publicKey')
  })

  // ── FINDING 2 ────────────────────────────────────────────────────────────
  it('a DECLINED publish must not have contacted a host — readHeld is two fetches', async () => {
    const { deps, order } = spied()
    await publishVocabulary({ confirmed: true }, deps)
    expect(
      order.slice(0, order.indexOf('confirm')),
      'readHeld = fetchHiveIndex + fetch(contentUrl) — the pubkey left the machine to render a summary line',
    ).not.toContain('readHeld')
  })

  it('the same holds for the withdrawal verb', async () => {
    const { deps, order } = spied()
    await withdrawVocabulary({ confirmed: true }, deps)
    const before = order.slice(0, order.indexOf('confirm'))
    expect(before).not.toContain('publicKey')
    expect(before).not.toContain('readHeld')
  })

  // ── HARDENING (passes today; keeps it that way) ──────────────────────────
  it('NO source file anywhere in essentials or shared imports the publish door', () => {
    const ROOT = process.cwd()
    const hits: string[] = []
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name.startsWith('dist')) continue
          walk(full)
          continue
        }
        if (!e.name.endsWith('.ts') || e.name.endsWith('.spec.ts')) continue
        if (e.name === 'vocabulary-publish.ts' || e.name === 'vocabulary-publish.deps.ts') continue
        if (e.name === 'index.ts' && statSync(full).size < 200_000) {
          // barrels re-export; a barrel is not a caller
        }
        const src = readFileSync(full, 'utf8')
        if (/vocabulary-publish\.js/.test(src) && !/^\/\//m.test('') && e.name !== 'index.ts') {
          hits.push(full.slice(ROOT.length + 1).replace(/\\/g, '/'))
        }
      }
    }
    // The existing scan covers `molecule/` only; a caller one directory over
    // — a queen, a drone, a shell component — would not trip it.
    walk(join(ROOT, 'hypercomb-essentials', 'src'))
    walk(join(ROOT, 'hypercomb-shared'))
    expect(hits).toEqual([])
  })

  // ── FINDING 4 ────────────────────────────────────────────────────────────
  it('marking the CLAIM ATOM public must not fan out onto the pool address', () => {
    // `markPublic(claimSig, 'resource', false)` descends via
    // `nestedResourceSigs`, which bails only when the record's top-level
    // `kind` is a STRING. A nostr event's `kind` is a NUMBER, so the claim
    // atom slips the guard and every 64-hex RUN in it is treated as a nested
    // resource sig — including the SURFACE (`sign('vocabulary:hive')`, a POOL
    // ADDRESS), the event id, the participant's pubkey and both 64-char
    // halves of the schnorr signature. Each gets a `{sig}.public` marker
    // written into the push pool. No bytes stand behind any of them today, so
    // nothing leaks now — but a `.public` marker is a standing "publish this
    // on sight" rule, and writing one against a pool address is exactly the
    // category error `directory-safety.ts` exists to prevent.
    const evt = {
      kind: 30566,
      created_at: 1,
      pubkey: hex(0xa1),
      id: hex(0xb2),
      sig: hex(0xc3) + hex(0xd4),
      tags: [['d', SURFACE]],
      content: [hex(0xa1), SURFACE, hex(0xf6), '-', '3', '2', '1'].join('\n'),
    }
    const found = nestedResourceSigs(new TextEncoder().encode(JSON.stringify(evt)))
    expect(found, 'the claim event fans out into sig-shaped strings').toEqual([])
  })

  // ── FINDING 3 ────────────────────────────────────────────────────────────
  it('the SCOPE INPUT must not be remotely writable — the bridge sets hc:public-branches', () => {
    const worker = readFileSync(
      join(process.cwd(), 'hypercomb-essentials', 'src', 'assistant', 'claude-bridge.worker.ts'),
      'utf8',
    )
    // `hive-root-set` was closed against `vocabulary:hive`. `branch-public`
    // was not: it calls `setBranchPublic()` with no participant gesture, and
    // `hc:public-branches` is the ONLY thing that decides which words a later
    // (confirmed) publish declares. An agent can therefore choose the scope
    // of a publish the participant confirms.
    expect(
      /case 'branch-public'/.test(worker) && /setBranchPublic\(/.test(worker),
      'branch-public writes the vocabulary scope input over the bridge with no gesture',
    ).toBe(false)
  })
})
