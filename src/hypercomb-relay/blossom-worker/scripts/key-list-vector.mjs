// scripts/key-list-vector.mjs — writes ../key-list.vector.json
//
//   node scripts/key-list-vector.mjs
//
// Really signed key-list chains (documentation/becoming-a-host.md, "Letting
// another place publish for you") and the verdict each must get. The chains
// are built with core's own builders and signed with secp256k1; each test key's
// secret is sha256 of its seed, and every signature is made with zero aux
// randomness, so the file is the same on every run. Each expected verdict is
// written here by hand and checked against core before the file is written, so
// the file can only ever say what core says. Read by key-lists.spec.js (this
// host) and hypercomb-essentials sharing/key-list.vector.spec.ts (the client's
// nostr-tools verifier). Changing it is a protocol change.

import { writeFileSync } from 'node:fs'
import { schnorr } from '@noble/curves/secp256k1.js'
import {
  acceptKeyListChain, firstKeyList, keyListContent, keyListTemplate, nextKeyList, readKeyList, verifyKeyListChain,
} from '../../../hypercomb-core/src/core/key-list.ts'

const utf8 = new TextEncoder()
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
const bytesOf = (text) => Uint8Array.from(text.match(/../g), (pair) => parseInt(pair, 16))
const sha256 = async (text) => new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(text)))

const SEEDS = {
  anchor: 'key-list vector: anchor',
  desktop: 'key-list vector: desktop',
  phone: 'key-list vector: phone',
  stranger: 'key-list vector: stranger',
  invite: 'key-list vector: invite',
}
const secret = {}
const keys = {}
for (const [name, seed] of Object.entries(SEEDS)) {
  secret[name] = await sha256(seed)
  keys[name] = { seed, pubkey: hex(schnorr.getPublicKey(secret[name])) }
}
const pk = (name) => keys[name].pubkey

const T0 = 1_790_000_000
const UNTIL = T0 + 600

async function signEvent(name, template) {
  const event = { pubkey: pk(name), created_at: template.created_at, kind: template.kind, tags: template.tags, content: template.content }
  event.id = hex(await sha256(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])))
  event.sig = hex(schnorr.sign(bytesOf(event.id), secret[name], new Uint8Array(32)))
  return event
}

const sign = (name, list, at) => signEvent(name, keyListTemplate(list, at))
const headOf = (chain) => readKeyList(chain[chain.length - 1])
async function extend(chain, name, change, at) {
  return [...chain, await sign(name, nextKeyList(headOf(chain), chain[chain.length - 1].id, change), at)]
}
/** A list no builder makes, from the head: for the shapes the rules refuse. */
const after = (chain, shape) => {
  const head = headOf(chain)
  return { ...head, seq: head.seq + 1, prev: chain[chain.length - 1].id, ...shape }
}

const anchorAlone = [await sign('anchor', firstKeyList(pk('anchor'), 'laptop'), T0)]
const withDesktop = await extend(anchorAlone, 'anchor', { op: 'add', pubkey: pk('desktop'), label: 'desktop' }, T0 + 1)
const invited = await extend(anchorAlone, 'anchor', { op: 'invite', pubkey: pk('invite'), until: UNTIL }, T0 + 10)
const accepted = await extend(invited, 'invite', { op: 'accept', invite: pk('invite'), pubkey: pk('desktop'), label: 'jwize.com' }, T0 + 100)
const anchorRemoved = await extend(withDesktop, 'desktop', { op: 'remove', pubkey: pk('anchor') }, T0 + 2)
const strangerSigned = [...anchorAlone, await sign('stranger', after(anchorAlone, { keys: [...headOf(anchorAlone).keys, { pubkey: pk('stranger') }] }), T0 + 1)]
const twoKeys = [...invited, await sign('invite', after(invited, {
  keys: [...headOf(invited).keys, { pubkey: pk('desktop') }, { pubkey: pk('phone') }], invites: [],
}), T0 + 100)]
const late = await extend(invited, 'invite', { op: 'accept', invite: pk('invite'), pubkey: pk('desktop') }, UNTIL + 1)
const tampered = [anchorAlone[0], {
  ...withDesktop[1],
  content: keyListContent({ ...headOf(withDesktop), keys: [...headOf(withDesktop).keys, { pubkey: pk('stranger') }] }),
}]
const withPhone = await extend(anchorAlone, 'anchor', { op: 'add', pubkey: pk('phone') }, T0 + 1)

const chains = [
  { name: 'the anchor alone', chain: anchorAlone, expect: { ok: true, keys: [pk('anchor')] } },
  { name: 'the anchor adds a desktop', chain: withDesktop, expect: { ok: true, keys: [pk('anchor'), pk('desktop')] } },
  { name: 'an invite spent on one key', chain: accepted, expect: { ok: true, keys: [pk('anchor'), pk('desktop')] } },
  { name: 'the desktop takes the anchor off', chain: anchorRemoved, expect: { ok: true, keys: [pk('desktop')] } },
  { name: 'a stranger signs a step', chain: strangerSigned, expect: { ok: false, reason: 'signer', at: 1 } },
  { name: 'an invite adds two keys', chain: twoKeys, expect: { ok: false, reason: 'invite', at: 2 } },
  { name: 'an acceptance dated after its invite ends', chain: late, expect: { ok: false, reason: 'invite', at: 2 } },
  { name: 'a step whose content changed after signing', chain: tampered, expect: { ok: false, reason: 'signature', at: 1 } },
]

const accepts = [
  { name: 'a host refuses a late spend built on its head', held: invited, offered: accepted, now: UNTIL + 1,
    expect: { ok: false, reason: 'invite', at: 2 } },
  { name: 'a host takes a spend while the invite is open', held: invited, offered: accepted, now: T0 + 200,
    expect: { ok: true, keys: [pk('anchor'), pk('desktop')] } },
  { name: 'a host that was behind takes an old spend', held: anchorAlone, offered: accepted, now: UNTIL + 86_400,
    expect: { ok: true, keys: [pk('anchor'), pk('desktop')] } },
  { name: 'a host refuses a fork', held: withDesktop, offered: withPhone, now: T0 + 5,
    expect: { ok: false, reason: 'fork', at: 1 } },
]

// The nostr verifier, as a client and this host answer it: the id and the sig.
const verified = new Set()
for (const event of [...anchorAlone, ...withDesktop, ...accepted, ...anchorRemoved, ...strangerSigned, ...twoKeys, ...late, ...tampered, ...withPhone]) {
  const id = hex(await sha256(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])))
  if (id === event.id && schnorr.verify(bytesOf(event.sig), bytesOf(id), bytesOf(event.pubkey))) verified.add(event)
}
const verify = (event) => verified.has(event)
const said = (verdict) => verdict.ok ? { ok: true, keys: verdict.keys } : { ok: false, reason: verdict.reason, at: verdict.at }
const anchor = pk('anchor')
for (const c of chains) {
  const got = said(verifyKeyListChain(anchor, c.chain, verify))
  if (JSON.stringify(got) !== JSON.stringify(c.expect)) throw new Error(`${c.name}: core says ${JSON.stringify(got)}`)
}
for (const a of accepts) {
  const got = said(acceptKeyListChain(anchor, a.held, a.offered, verify, a.now))
  if (JSON.stringify(got) !== JSON.stringify(a.expect)) throw new Error(`${a.name}: core says ${JSON.stringify(got)}`)
}

const vector = {
  $comment: 'Key-list conformance vector — documentation/becoming-a-host.md, "Letting another place publish for you". Really signed chains (secp256k1, zero aux randomness; each test key\'s secret is sha256 of its seed — test keys only) and the verdict core gives each. Written by scripts/key-list-vector.mjs, which checks every verdict against core first. Read by key-lists.spec.js (this host) and hypercomb-essentials sharing/key-list.vector.spec.ts (the client). Changing it is a protocol change.',
  meaning: 'keys:lists',
  poolAddress: hex(await sha256('keys:lists')),
  anchor,
  keys,
  chains,
  accepts,
}
writeFileSync(new URL('../key-list.vector.json', import.meta.url), JSON.stringify(vector, null, 2) + '\n')
console.log(`key-list.vector.json: ${chains.length} chains, ${accepts.length} host checks`)
