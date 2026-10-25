// core/key-list.spec.ts
//
// The acceptance matrix for the key list and its invites, driven by a STUB
// verifier — core has no crypto, so the spec injects the primitive the same way
// head-claim.spec.ts does. The stub is a registry: an event verifies iff it was
// minted, byte for byte, by `sign`. That is enough to prove every rule here,
// because who may sign each step is decided by WHICH key the list before holds,
// not by which curve checks the signature.

import { describe, expect, it } from 'vitest'

import {
  INVITE_MAX_SECONDS,
  KEY_LIST_KIND,
  KEY_LIST_MAX_CHAIN,
  acceptKeyListChain,
  extendsKeyListChain,
  firstKeyList,
  isListedKey,
  keyListContent,
  keyListTemplate,
  nextKeyList,
  readKeyList,
  verifyKeyListChain,
  type KeyList,
  type KeyListChange,
  type SignedKeyList,
} from './key-list.js'

const hex = (seed: string): string => {
  // A deterministic 64-hex stand-in for a key or an event id. Not a hash — a
  // fixture. Every character of `seed` reaches the mix.
  let h = 2166136261 >>> 0
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0
  let out = ''
  while (out.length < 64) {
    h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0
    out += h.toString(16).padStart(8, '0')
  }
  return out.slice(0, 64)
}

const ANCHOR = hex('anchor-key')
const DESKTOP = hex('desktop-key')
const PHONE = hex('phone-key')
const STRANGER = hex('stranger-key')
const INVITE = hex('invite-key')
const INVITE2 = hex('second-invite-key')

const T0 = 1_790_000_000
const UNTIL = T0 + 600

/** A registry that mints events and recognises exactly what it minted. */
const ring = () => {
  const minted = new Map<string, string>()
  const print = (e: SignedKeyList): string => JSON.stringify([e.pubkey, e.created_at, e.kind, e.tags, e.content])
  let n = 0
  const mint = (pubkey: string, content: string, createdAt: number, anchor: string): SignedKeyList => {
    const id = hex(`event-${n++}`)
    const event: SignedKeyList = {
      id, pubkey, created_at: createdAt, kind: KEY_LIST_KIND, tags: [['d', anchor]], content, sig: hex(`sig-${id}`),
    }
    minted.set(id, print(event))
    return event
  }
  return {
    /** Signs a list in its one spelling. */
    sign: (pubkey: string, list: KeyList, createdAt: number): SignedKeyList =>
      mint(pubkey, keyListContent(list), createdAt, list.anchor),
    /** Signs whatever content it is handed — for lists no builder would make. */
    signRaw: (pubkey: string, content: unknown, createdAt: number): SignedKeyList =>
      mint(pubkey, JSON.stringify(content), createdAt, ANCHOR),
    verify: (e: SignedKeyList): boolean => minted.get(e.id) === print(e),
  }
}

type Ring = ReturnType<typeof ring>

const headOf = (chain: readonly SignedKeyList[]): KeyList => readKeyList(chain[chain.length - 1]) as KeyList

/** The chain with one more list, made by the builder and signed by `signer`. */
const extend = (r: Ring, chain: readonly SignedKeyList[], signer: string, change: KeyListChange,
  createdAt: number, now?: number): SignedKeyList[] => {
  const next = nextKeyList(headOf(chain), chain[chain.length - 1].id, change, now)
  if (!next) throw new Error(`builder refused ${change.op}`)
  return [...chain, r.sign(signer, next, createdAt)]
}

/** List 0 (the anchor alone), signed by the anchor. */
const begin = (): { r: Ring; chain: SignedKeyList[] } => {
  const r = ring()
  return { r, chain: [r.sign(ANCHOR, firstKeyList(ANCHOR, 'laptop'), T0)] }
}

/** List 0, then list 1 inviting INVITE until UNTIL. */
const invited = (): { r: Ring; chain: SignedKeyList[] } => {
  const { r, chain } = begin()
  return { r, chain: extend(r, chain, ANCHOR, { op: 'invite', pubkey: INVITE, until: UNTIL }, T0 + 10) }
}

/** The list a step would carry, hand-made from the head — for shapes the builder refuses. */
const after = (chain: readonly SignedKeyList[], shape: Partial<KeyList>): KeyList => {
  const head = headOf(chain)
  return { ...head, seq: head.seq + 1, prev: chain[chain.length - 1].id, ...shape }
}

const refusal = (verdict: ReturnType<typeof verifyKeyListChain>) => verdict.ok ? null : { reason: verdict.reason, at: verdict.at }

describe('list 0', () => {
  it('is the anchor alone, signed by the anchor', () => {
    const { r, chain } = begin()
    const verdict = verifyKeyListChain(ANCHOR, chain, r.verify)
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.keys).toEqual([ANCHOR])
    expect(verdict.head.seq).toBe(0)
    expect(verdict.headId).toBe(chain[0].id)
  })

  it('refuses a list 0 signed by any other key', () => {
    const r = ring()
    const chain = [r.sign(STRANGER, firstKeyList(ANCHOR), T0)]
    expect(refusal(verifyKeyListChain(ANCHOR, chain, r.verify))).toEqual({ reason: 'anchor', at: 0 })
  })

  it('refuses a list 0 that does not list the anchor', () => {
    const r = ring()
    const list: KeyList = { ...firstKeyList(ANCHOR), keys: [{ pubkey: DESKTOP }] }
    expect(refusal(verifyKeyListChain(ANCHOR, [r.sign(ANCHOR, list, T0)], r.verify))).toEqual({ reason: 'anchor', at: 0 })
  })

  it('refuses a chain that does not start at seq 0', () => {
    const r = ring()
    const list: KeyList = { ...firstKeyList(ANCHOR), seq: 1, prev: hex('nothing-before') }
    expect(refusal(verifyKeyListChain(ANCHOR, [r.sign(ANCHOR, list, T0)], r.verify))).toEqual({ reason: 'sequence', at: 0 })
  })

  it('refuses an empty chain', () => {
    expect(refusal(verifyKeyListChain(ANCHOR, [], ring().verify))).toEqual({ reason: 'empty', at: 0 })
  })
})

describe('changes by a listed key', () => {
  it('any listed key may add or remove any key, the anchor included', () => {
    const { r, chain: c0 } = begin()
    let chain = extend(r, c0, ANCHOR, { op: 'add', pubkey: DESKTOP, label: 'desktop' }, T0 + 1)
    chain = extend(r, chain, DESKTOP, { op: 'add', pubkey: PHONE }, T0 + 2)
    chain = extend(r, chain, PHONE, { op: 'remove', pubkey: ANCHOR }, T0 + 3)
    const verdict = verifyKeyListChain(ANCHOR, chain, r.verify)
    expect(verdict.ok && verdict.keys).toEqual([DESKTOP, PHONE])
    expect(verdict.ok && isListedKey(verdict.head, ANCHOR)).toBe(false)
  })

  it('a removed key signs nothing more', () => {
    const { r, chain: c0 } = begin()
    let chain = extend(r, c0, ANCHOR, { op: 'add', pubkey: DESKTOP }, T0 + 1)
    chain = extend(r, chain, DESKTOP, { op: 'remove', pubkey: ANCHOR }, T0 + 2)
    chain = extend(r, chain, ANCHOR, { op: 'add', pubkey: PHONE }, T0 + 3)
    expect(refusal(verifyKeyListChain(ANCHOR, chain, r.verify))).toEqual({ reason: 'signer', at: 3 })
  })

  it('refuses a step signed by a key the list before does not hold', () => {
    const { r, chain } = begin()
    const signed = extend(r, chain, STRANGER, { op: 'add', pubkey: PHONE }, T0 + 1)
    expect(refusal(verifyKeyListChain(ANCHOR, signed, r.verify))).toEqual({ reason: 'signer', at: 1 })
  })
})

describe('the chain', () => {
  it('refuses a step that does not name the list before it', () => {
    const { r, chain } = begin()
    const list = after(chain, { prev: hex('some-other-list'), keys: [...headOf(chain).keys, { pubkey: DESKTOP }] })
    expect(refusal(verifyKeyListChain(ANCHOR, [...chain, r.sign(ANCHOR, list, T0 + 1)], r.verify)))
      .toEqual({ reason: 'prev', at: 1 })
  })

  it('refuses a gap in seq', () => {
    const { r, chain } = begin()
    const list = after(chain, { seq: 2, keys: [...headOf(chain).keys, { pubkey: DESKTOP }] })
    expect(refusal(verifyKeyListChain(ANCHOR, [...chain, r.sign(ANCHOR, list, T0 + 1)], r.verify)))
      .toEqual({ reason: 'sequence', at: 1 })
  })

  it('refuses created_at going backwards', () => {
    const { r, chain } = begin()
    const signed = extend(r, chain, ANCHOR, { op: 'add', pubkey: DESKTOP }, T0 - 1)
    expect(refusal(verifyKeyListChain(ANCHOR, signed, r.verify))).toEqual({ reason: 'sequence', at: 1 })
  })

  it('refuses an event the verifier does not recognise', () => {
    const { r, chain } = begin()
    const signed = extend(r, chain, ANCHOR, { op: 'add', pubkey: DESKTOP }, T0 + 1)
    const tampered = { ...signed[1], content: keyListContent({ ...headOf(signed), keys: [...headOf(signed).keys, { pubkey: PHONE }] }) }
    expect(refusal(verifyKeyListChain(ANCHOR, [signed[0], tampered], r.verify))).toEqual({ reason: 'signature', at: 1 })
  })

  it('refuses when the verifier throws', () => {
    const { chain } = begin()
    const throwing = (): boolean => { throw new Error('bad curve') }
    expect(refusal(verifyKeyListChain(ANCHOR, chain, throwing))).toEqual({ reason: 'signature', at: 0 })
  })

  it("refuses another anchor's chain, and a step that names another anchor", () => {
    const { r, chain } = begin()
    expect(refusal(verifyKeyListChain(DESKTOP, chain, r.verify))).toEqual({ reason: 'anchor', at: 0 })
    const list = after(chain, { anchor: DESKTOP, keys: [...headOf(chain).keys, { pubkey: DESKTOP }] })
    expect(refusal(verifyKeyListChain(ANCHOR, [...chain, r.sign(ANCHOR, list, T0 + 1)], r.verify)))
      .toEqual({ reason: 'anchor', at: 1 })
  })

  it('refuses a chain longer than the cap, and takes one exactly at it', () => {
    const { r, chain: c0 } = begin()
    let chain = c0
    for (let n = 1; n < KEY_LIST_MAX_CHAIN; n++) {
      const change: KeyListChange = n % 2 ? { op: 'add', pubkey: PHONE } : { op: 'remove', pubkey: PHONE }
      chain = extend(r, chain, ANCHOR, change, T0 + n)
    }
    expect(chain).toHaveLength(KEY_LIST_MAX_CHAIN)
    expect(verifyKeyListChain(ANCHOR, chain, r.verify).ok).toBe(true)
    const longer = extend(r, chain, ANCHOR, { op: 'add', pubkey: DESKTOP }, T0 + KEY_LIST_MAX_CHAIN)
    expect(refusal(verifyKeyListChain(ANCHOR, longer, r.verify))).toEqual({ reason: 'too-long', at: KEY_LIST_MAX_CHAIN })
  })
})

describe('invites', () => {
  it('an invite spends itself on exactly one new key', () => {
    const { r, chain: c1 } = invited()
    const chain = extend(r, c1, INVITE, { op: 'accept', invite: INVITE, pubkey: DESKTOP, label: 'jwize.com' }, T0 + 100)
    const verdict = verifyKeyListChain(ANCHOR, chain, r.verify)
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.keys).toEqual([ANCHOR, DESKTOP])
    expect(verdict.head.invites).toEqual([])
    expect(verdict.head.keys[1]).toEqual({ pubkey: DESKTOP, label: 'jwize.com' })
  })

  it('an invite is never a key: it cannot be the key it adds, and is not listed', () => {
    const { r, chain } = invited()
    expect(isListedKey(headOf(chain), INVITE)).toBe(false)
    const list = after(chain, { keys: [...headOf(chain).keys, { pubkey: INVITE }], invites: [] })
    expect(refusal(verifyKeyListChain(ANCHOR, [...chain, r.sign(INVITE, list, T0 + 100)], r.verify)))
      .toEqual({ reason: 'invite', at: 2 })
  })

  it('refuses an invite that adds two keys', () => {
    const { r, chain } = invited()
    const list = after(chain, { keys: [...headOf(chain).keys, { pubkey: DESKTOP }, { pubkey: PHONE }], invites: [] })
    expect(refusal(verifyKeyListChain(ANCHOR, [...chain, r.sign(INVITE, list, T0 + 100)], r.verify)))
      .toEqual({ reason: 'invite', at: 2 })
  })

  it('refuses an invite that removes a key', () => {
    const { r, chain: c1 } = invited()
    const chain = extend(r, c1, ANCHOR, { op: 'add', pubkey: PHONE }, T0 + 20)
    const list = after(chain, { keys: [{ pubkey: PHONE }, { pubkey: DESKTOP }], invites: [] })
    expect(refusal(verifyKeyListChain(ANCHOR, [...chain, r.sign(INVITE, list, T0 + 100)], r.verify)))
      .toEqual({ reason: 'invite', at: 3 })
  })

  it('refuses an invite that renames a key', () => {
    const { r, chain } = invited()
    const list = after(chain, { keys: [{ pubkey: ANCHOR, label: 'renamed' }, { pubkey: DESKTOP }], invites: [] })
    expect(refusal(verifyKeyListChain(ANCHOR, [...chain, r.sign(INVITE, list, T0 + 100)], r.verify)))
      .toEqual({ reason: 'invite', at: 2 })
  })

  it('refuses an invite that touches another invite', () => {
    const { r, chain: c1 } = invited()
    const chain = extend(r, c1, ANCHOR, { op: 'invite', pubkey: INVITE2, until: T0 + 900 }, T0 + 20)
    const list = after(chain, { keys: [...headOf(chain).keys, { pubkey: DESKTOP }], invites: [] })
    expect(refusal(verifyKeyListChain(ANCHOR, [...chain, r.sign(INVITE, list, T0 + 100)], r.verify)))
      .toEqual({ reason: 'invite', at: 3 })
    const lengthened = after(chain, {
      keys: [...headOf(chain).keys, { pubkey: DESKTOP }], invites: [{ pubkey: INVITE2, until: T0 + 1200 }],
    })
    expect(refusal(verifyKeyListChain(ANCHOR, [...chain, r.sign(INVITE, lengthened, T0 + 100)], r.verify)))
      .toEqual({ reason: 'invite', at: 3 })
  })

  it('refuses an acceptance dated after the invite ends', () => {
    const { r, chain: c1 } = invited()
    const chain = extend(r, c1, INVITE, { op: 'accept', invite: INVITE, pubkey: DESKTOP }, UNTIL + 1)
    expect(refusal(verifyKeyListChain(ANCHOR, chain, r.verify))).toEqual({ reason: 'invite', at: 2 })
    const onTime = extend(r, c1, INVITE, { op: 'accept', invite: INVITE, pubkey: DESKTOP }, UNTIL)
    expect(verifyKeyListChain(ANCHOR, onTime, r.verify).ok).toBe(true)
  })

  it('a spent invite signs nothing more', () => {
    const { r, chain: c1 } = invited()
    const chain = extend(r, c1, INVITE, { op: 'accept', invite: INVITE, pubkey: DESKTOP }, T0 + 100)
    const list = after(chain, { keys: [...headOf(chain).keys, { pubkey: PHONE }] })
    expect(refusal(verifyKeyListChain(ANCHOR, [...chain, r.sign(INVITE, list, T0 + 200)], r.verify)))
      .toEqual({ reason: 'signer', at: 3 })
  })

  it('a new invite must end after its list and within the cap', () => {
    const { r, chain } = begin()
    const at = T0 + 10
    const ending = (until: number) => verifyKeyListChain(ANCHOR,
      extend(r, chain, ANCHOR, { op: 'invite', pubkey: INVITE, until }, at), r.verify)
    expect(refusal(ending(at))).toEqual({ reason: 'invite', at: 1 })
    expect(refusal(ending(at + INVITE_MAX_SECONDS + 1))).toEqual({ reason: 'invite', at: 1 })
    expect(ending(at + 1).ok).toBe(true)
    expect(ending(at + INVITE_MAX_SECONDS).ok).toBe(true)
  })

  it('the window holds on list 0 too', () => {
    const r = ring()
    const list: KeyList = { ...firstKeyList(ANCHOR), invites: [{ pubkey: INVITE, until: T0 + INVITE_MAX_SECONDS + 1 }] }
    expect(refusal(verifyKeyListChain(ANCHOR, [r.sign(ANCHOR, list, T0)], r.verify))).toEqual({ reason: 'invite', at: 0 })
  })

  it('carrying an old invite forward unchanged is not writing a new one', () => {
    const { r, chain: c1 } = invited()
    const chain = extend(r, c1, ANCHOR, { op: 'add', pubkey: PHONE }, UNTIL + 5000)
    expect(headOf(chain).invites).toEqual([{ pubkey: INVITE, until: UNTIL }])
    expect(verifyKeyListChain(ANCHOR, chain, r.verify).ok).toBe(true)
  })
})

describe('a host accepting a chain', () => {
  const acceptance = () => {
    const { r, chain: held } = invited()
    const offered = extend(r, held, INVITE, { op: 'accept', invite: INVITE, pubkey: DESKTOP }, T0 + 100)
    return { r, held, offered }
  }

  it('refuses an acceptance built on its head once the invite has ended by its own clock', () => {
    const { r, held, offered } = acceptance()
    expect(refusal(acceptKeyListChain(ANCHOR, held, offered, r.verify, UNTIL + 1))).toEqual({ reason: 'invite', at: 2 })
  })

  it('takes it while the invite is still open', () => {
    const { r, held, offered } = acceptance()
    const verdict = acceptKeyListChain(ANCHOR, held, offered, r.verify, T0 + 200)
    expect(verdict.ok && verdict.keys).toEqual([ANCHOR, DESKTOP])
  })

  it('does not judge steps it missed while behind by today\'s clock', () => {
    const { r, offered } = acceptance()
    const longer = extend(r, offered, DESKTOP, { op: 'add', pubkey: PHONE }, T0 + 300)
    expect(acceptKeyListChain(ANCHOR, [longer[0]], longer, r.verify, UNTIL + 86_400).ok).toBe(true)
    expect(acceptKeyListChain(ANCHOR, longer.slice(0, 2), offered, r.verify, UNTIL + 86_400).ok).toBe(false)
  })

  it('does not judge anything by its clock when it holds nothing yet', () => {
    const { r, offered } = acceptance()
    expect(acceptKeyListChain(ANCHOR, [], offered, r.verify, UNTIL + 86_400).ok).toBe(true)
  })

  it('still checks every step it is offered', () => {
    const { r, held, offered } = acceptance()
    const tampered = [...offered.slice(0, 2), { ...offered[2], pubkey: STRANGER }]
    expect(refusal(acceptKeyListChain(ANCHOR, held, tampered, r.verify, T0 + 200))).toEqual({ reason: 'signature', at: 2 })
  })

  it('refuses a fork, and a chain shorter than the one it holds', () => {
    const { r, chain } = begin()
    const mine = extend(r, chain, ANCHOR, { op: 'add', pubkey: DESKTOP }, T0 + 1)
    const theirs = extend(r, chain, ANCHOR, { op: 'add', pubkey: PHONE }, T0 + 1)
    expect(refusal(acceptKeyListChain(ANCHOR, mine, theirs, r.verify, T0 + 2))).toEqual({ reason: 'fork', at: 1 })
    expect(refusal(acceptKeyListChain(ANCHOR, mine, chain, r.verify, T0 + 2))).toEqual({ reason: 'fork', at: 1 })
    expect(extendsKeyListChain(chain, mine)).toBe(true)
    expect(extendsKeyListChain(mine, theirs)).toBe(false)
  })

  it('takes the chain it already holds again', () => {
    const { r, held } = acceptance()
    expect(acceptKeyListChain(ANCHOR, held, held, r.verify, UNTIL + 1).ok).toBe(true)
  })
})

describe('readKeyList', () => {
  const event = (content: unknown, kind = KEY_LIST_KIND) => ({ kind, content: JSON.stringify(content) })
  const good = { v: 1, anchor: ANCHOR, seq: 0, prev: null, keys: [{ pubkey: ANCHOR }], invites: [] }

  it('reads a well-formed list', () => {
    expect(readKeyList(event(good))).toEqual(good)
  })

  it('refuses uppercase hex', () => {
    expect(readKeyList(event({ ...good, anchor: ANCHOR.toUpperCase() }))).toBeNull()
    expect(readKeyList(event({ ...good, keys: [{ pubkey: ANCHOR.toUpperCase() }] }))).toBeNull()
  })

  it('refuses a key listed twice, and a key that is also an invite', () => {
    expect(readKeyList(event({ ...good, keys: [{ pubkey: ANCHOR }, { pubkey: ANCHOR }] }))).toBeNull()
    expect(readKeyList(event({ ...good, invites: [{ pubkey: ANCHOR, until: T0 }] }))).toBeNull()
    expect(readKeyList(event({ ...good, invites: [{ pubkey: INVITE, until: T0 }, { pubkey: INVITE, until: T0 }] }))).toBeNull()
  })

  it('refuses a list with no keys', () => {
    expect(readKeyList(event({ ...good, keys: [] }))).toBeNull()
  })

  it('refuses a label over 64 characters or not a string, and trims the rest', () => {
    expect(readKeyList(event({ ...good, keys: [{ pubkey: ANCHOR, label: 'x'.repeat(65) }] }))).toBeNull()
    expect(readKeyList(event({ ...good, keys: [{ pubkey: ANCHOR, label: 7 }] }))).toBeNull()
    expect(readKeyList(event({ ...good, keys: [{ pubkey: ANCHOR, label: 'x'.repeat(64) }] }))?.keys[0].label).toBe('x'.repeat(64))
    expect(readKeyList(event({ ...good, keys: [{ pubkey: ANCHOR, label: '  desk  ' }] }))?.keys[0]).toEqual({ pubkey: ANCHOR, label: 'desk' })
    expect(readKeyList(event({ ...good, keys: [{ pubkey: ANCHOR, label: '   ' }] }))?.keys[0]).toEqual({ pubkey: ANCHOR })
  })

  it('refuses the wrong kind, bad JSON, another version, and a prev that does not fit the seq', () => {
    expect(readKeyList(event(good, 30564))).toBeNull()
    expect(readKeyList({ kind: KEY_LIST_KIND, content: '{not json' })).toBeNull()
    expect(readKeyList(event({ ...good, v: 2 }))).toBeNull()
    expect(readKeyList(event({ ...good, prev: hex('list-before') }))).toBeNull()
    expect(readKeyList(event({ ...good, seq: 1 }))).toBeNull()
    expect(readKeyList(event({ ...good, seq: 1.5, prev: hex('list-before') }))).toBeNull()
    expect(readKeyList(event({ ...good, invites: [{ pubkey: INVITE, until: T0 + 0.5 }] }))).toBeNull()
    expect(readKeyList(null)).toBeNull()
  })
})

describe('nextKeyList', () => {
  const twoInvites = () => {
    const { r, chain: c1 } = invited()
    return { r, chain: extend(r, c1, ANCHOR, { op: 'invite', pubkey: INVITE2, until: T0 + 3000 }, T0 + 20) }
  }

  it('refuses removing the last key', () => {
    const { chain } = begin()
    expect(nextKeyList(headOf(chain), chain[0].id, { op: 'remove', pubkey: ANCHOR })).toBeNull()
  })

  it('refuses a key or invite it already holds, and names it does not hold', () => {
    const { chain } = invited()
    const head = headOf(chain)
    const id = chain[1].id
    expect(nextKeyList(head, id, { op: 'add', pubkey: ANCHOR })).toBeNull()
    expect(nextKeyList(head, id, { op: 'add', pubkey: INVITE })).toBeNull()
    expect(nextKeyList(head, id, { op: 'invite', pubkey: ANCHOR, until: UNTIL })).toBeNull()
    expect(nextKeyList(head, id, { op: 'remove', pubkey: STRANGER })).toBeNull()
    expect(nextKeyList(head, id, { op: 'accept', invite: INVITE2, pubkey: DESKTOP })).toBeNull()
    expect(nextKeyList(head, id, { op: 'accept', invite: INVITE, pubkey: ANCHOR })).toBeNull()
    expect(nextKeyList(head, id, { op: 'accept', invite: INVITE, pubkey: INVITE })).toBeNull()
    expect(nextKeyList(head, id, { op: 'add', pubkey: 'not-a-key' })).toBeNull()
  })

  it('drops expired invites when given the time', () => {
    const { chain } = twoInvites()
    const next = nextKeyList(headOf(chain), chain[2].id, { op: 'add', pubkey: PHONE }, UNTIL + 1)
    expect(next?.invites).toEqual([{ pubkey: INVITE2, until: T0 + 3000 }])
  })

  it('never drops anything from an acceptance', () => {
    const { chain } = twoInvites()
    const next = nextKeyList(headOf(chain), chain[2].id, { op: 'accept', invite: INVITE2, pubkey: DESKTOP }, UNTIL + 1)
    expect(next?.invites).toEqual([{ pubkey: INVITE, until: UNTIL }])
  })

  it('remove takes back an invite', () => {
    const { chain } = invited()
    expect(nextKeyList(headOf(chain), chain[1].id, { op: 'remove', pubkey: INVITE })?.invites).toEqual([])
  })

  it('caps a label at 64 characters, and the list reads back', () => {
    const { chain } = begin()
    const next = nextKeyList(headOf(chain), chain[0].id, { op: 'add', pubkey: PHONE, label: ` ${'y'.repeat(80)} ` }) as KeyList
    expect(next.keys[1].label).toBe('y'.repeat(64))
    expect(readKeyList(keyListTemplate(next, T0))).toEqual(next)
  })

  it('every builder output verifies, end to end', () => {
    const { r, chain: c0 } = begin()
    let chain = extend(r, c0, ANCHOR, { op: 'add', pubkey: PHONE, label: 'phone' }, T0 + 1)
    chain = extend(r, chain, PHONE, { op: 'invite', pubkey: INVITE, until: T0 + 600 }, T0 + 2)
    chain = extend(r, chain, INVITE, { op: 'accept', invite: INVITE, pubkey: DESKTOP, label: 'jwize.com' }, T0 + 3)
    chain = extend(r, chain, DESKTOP, { op: 'invite', pubkey: INVITE2, until: T0 + 900 }, T0 + 4)
    chain = extend(r, chain, DESKTOP, { op: 'remove', pubkey: INVITE2 }, T0 + 5)
    chain = extend(r, chain, DESKTOP, { op: 'remove', pubkey: PHONE }, T0 + 6)
    const verdict = verifyKeyListChain(ANCHOR, chain, r.verify)
    expect(verdict.ok && verdict.keys).toEqual([ANCHOR, DESKTOP])
    expect(verdict.ok && verdict.head.invites).toEqual([])
    for (const event of chain) expect(keyListContent(readKeyList(event) as KeyList)).toBe(event.content)
  })
})

describe('keyListTemplate', () => {
  it('is a key-list event tagged with its anchor', () => {
    const template = keyListTemplate(firstKeyList(ANCHOR), T0)
    expect(template.kind).toBe(KEY_LIST_KIND)
    expect(template.created_at).toBe(T0)
    expect(template.tags).toEqual([['d', ANCHOR]])
    expect(readKeyList(template)).toEqual(firstKeyList(ANCHOR))
  })
})
