// scripts/entry-pool-vector.mjs — writes ../entry-pool.vector.json
//
//   node scripts/entry-pool-vector.mjs
//
// The names of an open entry pool and one really signed member
// (documentation/open-entry-pools.md, "The names, exactly" and "The member"),
// with the spellings of that same event a host and a reader must refuse. Each
// test key's secret is sha256 of its seed and the signature is made with zero
// aux randomness, so the file is the same on every run. Read by worker.spec.js
// (this host) and hypercomb-essentials pools/open-entries.spec.ts (the hive and
// the page). Changing it is a protocol change.

import { writeFileSync } from 'node:fs'
import { schnorr } from '@noble/curves/secp256k1.js'

const utf8 = new TextEncoder()
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
const bytesOf = (text) => Uint8Array.from(text.match(/../g), (pair) => parseInt(pair, 16))
const digest = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
const sha256 = async (text) => hex(await digest(utf8.encode(text)))
const NUL = '\0'

const SEEDS = { leader: 'entry-pool vector: leader', poster: 'entry-pool vector: poster' }
const secret = {}
const keys = {}
for (const [name, seed] of Object.entries(SEEDS)) {
  secret[name] = await digest(utf8.encode(seed))
  keys[name] = { seed, pubkey: hex(schnorr.getPublicKey(secret[name])) }
}

const KIND = 30573
const UNTIL = 1_795_737_600
const CREATED_AT = UNTIL - 3_600

// THE NAMES. Every hash is sha256 of UTF-8 text, 64 lowercase hex.
const P = keys.leader.pubkey
const template = await sha256('entry-pool vector: template')
const record = JSON.stringify({ 'entries:open': 1, meaning: 'recipe:entry', title: 'Tuesday class', template, by: P, until: UNTIL })
const O = await sha256(record)
const nonce = (await sha256('entry-pool vector: nonce')).slice(0, 32)
const A = await sha256(`entries${NUL}${O}${NUL}${nonce}`)
const H = await sha256(`entries:pool${NUL}${A}${NUL}${P}${NUL}${UNTIL}`)

// THE MEMBER. The body is JSON.stringify of the seven keys in this order.
const page = await sha256('entry-pool vector: page')
const tags = [['pool', H], ['page', page], ['name', 'Ana'], ['title', 'Sunday soup']]
const content = JSON.stringify({ recipe: 1, values: { story: 'half/half, as my aunt made it' } })
const pubkey = keys.poster.pubkey
const id = await sha256(JSON.stringify([0, pubkey, CREATED_AT, KIND, tags, content]))
const sig = hex(schnorr.sign(bytesOf(id), secret.poster, new Uint8Array(32)))
const event = { id, pubkey, created_at: CREATED_AT, kind: KIND, tags, content, sig }
const body = JSON.stringify(event)
const named = async (text) => ({ body: text, name: await sha256(text) })

// THE SAME EVENT, SPELLED ANOTHER WAY. Each parses to a validly signed event
// and each hashes to its own name, so only the fixed spelling refuses it.
const flipFirstLetter = (text) => text.replace(/[a-f]/, (letter) => letter.toUpperCase())
const refused = []
const refuse = async (why, text) => { if (text === body) throw new Error(`not a different spelling: ${why}`); refused.push({ why, ...(await named(text)) }) }
await refuse('a capital letter in sig', body.replace(`"sig":"${sig}"`, `"sig":"${flipFirstLetter(sig)}"`))
await refuse('a capital letter in id', body.replace(`"id":"${id}"`, `"id":"${flipFirstLetter(id)}"`))
await refuse('id as an array of one string', body.replace(`"id":"${id}"`, `"id":["${id}"]`))
await refuse('a space after the opening brace', body.replace('{', '{ '))
await refuse('a trailing newline', body + '\n')
await refuse('a byte order mark first', '﻿' + body)
await refuse('an eighth field', body.replace(/}$/, ',"note":"hello"}'))
await refuse('the signing library\'s key order', JSON.stringify({ created_at: CREATED_AT, kind: KIND, tags, content, pubkey, id, sig }))
await refuse('created_at in exponent form', body.replace(`"created_at":${CREATED_AT}`, `"created_at":${String(CREATED_AT / 1e9)}e9`))
await refuse('created_at with a fraction', body.replace(`"created_at":${CREATED_AT}`, `"created_at":${CREATED_AT}.0`))
await refuse('an escaped slash in content', body.replace('half/half', 'half\\/half'))
await refuse('a unicode escape in a tag', body.replace('"Ana"', '"\\u0041na"'))
await refuse('kind given twice', body.replace(`"kind":${KIND}`, `"kind":1,"kind":${KIND}`))

// Each refused spelling must still parse to the signed event, or it proves nothing.
for (const entry of refused) {
  const parsed = JSON.parse(entry.body.replace(/^﻿/, ''))
  const same = JSON.stringify([0, parsed.pubkey, Number(parsed.created_at), parsed.kind, parsed.tags, parsed.content]) === JSON.stringify([0, pubkey, CREATED_AT, KIND, tags, content])
  if (!same) throw new Error(`not the same event: ${entry.why}`)
}
if (!schnorr.verify(bytesOf(sig), bytesOf(id), bytesOf(pubkey))) throw new Error('the member does not verify')

const vector = {
  note: 'Written by scripts/entry-pool-vector.mjs. Do not edit by hand: changing it is a protocol change.',
  kind: KIND,
  keys,
  names: { P, O, nonce, until: UNTIL, A, H },
  record,
  code: `#post=${O}~${nonce}`,
  member: { event, ...(await named(body)) },
  refused,
}
writeFileSync(new URL('../entry-pool.vector.json', import.meta.url), JSON.stringify(vector, null, 2) + '\n')
console.log(`entry-pool.vector.json: A ${A.slice(0, 8)}, H ${H.slice(0, 8)}, member ${vector.member.name.slice(0, 8)} (${utf8.encode(body).length} bytes), ${refused.length} refused spellings`)
