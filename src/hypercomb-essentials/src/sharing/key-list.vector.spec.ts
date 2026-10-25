// sharing/key-list.vector.spec.ts — the client's side of the key-list vector
// (documentation/becoming-a-host.md, "Letting another place publish for you").
//
// hypercomb-relay/blossom-worker/key-list.vector.json holds really signed
// chains and the verdict each must get. The host answers them with its own
// secp256k1 check (blossom-worker key-lists.spec.js); this answers them with
// nostr-tools' `verifyEvent`, the verifier the client signs and reads with. The
// two can only agree because both hand core's one set of rules a signature
// check — and this proves the client's check says the same as the host's.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { verifyEvent } from 'nostr-tools/pure'
import {
  acceptKeyListChain, registerPoolMeaning, verifyKeyListChain, KEY_LIST_MEANING,
  type KeyListVerdict, type SignedKeyList,
} from '@hypercomb/core'

type Expect = { ok: true; keys: string[] } | { ok: false; reason: string; at: number }
const VECTOR_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'hypercomb-relay', 'blossom-worker', 'key-list.vector.json')
const VECTOR = JSON.parse(readFileSync(VECTOR_FILE, 'utf8')) as {
  meaning: string
  poolAddress: string
  anchor: string
  chains: { name: string; chain: SignedKeyList[]; expect: Expect }[]
  accepts: { name: string; held: SignedKeyList[]; offered: SignedKeyList[]; now: number; expect: Expect }[]
}

const verify = (event: SignedKeyList): boolean => verifyEvent(structuredClone(event) as never)
const said = (verdict: KeyListVerdict): Expect =>
  verdict.ok ? { ok: true, keys: verdict.keys } : { ok: false, reason: verdict.reason, at: verdict.at }

describe('the key-list vector, read by the client', () => {
  it('names the pool the client derives', async () => {
    expect(VECTOR.meaning).toBe(KEY_LIST_MEANING)
    expect(await registerPoolMeaning(KEY_LIST_MEANING)).toBe(VECTOR.poolAddress)
  })

  for (const c of VECTOR.chains) {
    it(`a chain: ${c.name}`, () => {
      expect(said(verifyKeyListChain(VECTOR.anchor, c.chain, verify))).toEqual(c.expect)
    })
  }

  for (const a of VECTOR.accepts) {
    it(`a host check: ${a.name}`, () => {
      expect(said(acceptKeyListChain(VECTOR.anchor, a.held, a.offered, verify, a.now))).toEqual(a.expect)
    })
  }
})
