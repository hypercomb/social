// build-asks.test.js — the rules every grant-keeping host notes and lists
// asks by (build-asks.js): what is an ask to note, whose zone it is, and
// what falls off.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ASKS_MAX, ASKS_PER_AUTHOR, ASK_TTL_DAYS, askPreimage, buildersOf, isDraft, noteable, originOf, sweep, zoneOf } from './build-asks.js'

const A = 'a'.repeat(64), B = 'b'.repeat(64), D = 'd'.repeat(64)
const NOW = 1_800_000_000
const askBytes = ({ pubkey = A, at = NOW, h = 'https://content.example.org', kind = 30568, d = D, content } = {}) =>
  new TextEncoder().encode(JSON.stringify({ kind, pubkey, created_at: at, tags: [['d', d], ['h', h]], content: content ?? askPreimage(d), id: 'x', sig: 'y' }))
const verifies = async () => true

test('an ask is noted only from its own author, for this host, recently, when it verifies', async () => {
  const base = { uploader: A, origin: 'https://content.example.org', now: NOW, verify: verifies }
  assert.deepEqual(await noteable(askBytes(), base), { ok: true, record: { author: A, draft: D, at: NOW, origin: 'https://content.example.org' } })
  assert.equal((await noteable(askBytes(), { ...base, uploader: B })).reason, 'an ask is uploaded by its own author')
  assert.equal((await noteable(askBytes({ h: 'https://elsewhere.example' }), base)).reason, 'the ask names another host')
  assert.equal((await noteable(askBytes({ at: NOW - ASK_TTL_DAYS * 86_400 }), base)).reason, 'the ask is not recent')
  assert.equal((await noteable(askBytes({ at: NOW + 601 }), base)).reason, 'the ask is not recent')
  assert.equal((await noteable(askBytes({ at: NOW + 600 }), base)).ok, true)
  assert.equal((await noteable(askBytes(), { ...base, verify: async () => false })).reason, 'the ask does not verify')
  for (const bad of [askBytes({ kind: 1 }), askBytes({ content: 'hc:ask:v1\nother' }), askBytes({ d: 'short' }), new TextEncoder().encode('not json'), new Uint8Array(5000)]) {
    assert.equal((await noteable(bad, base)).reason, 'not an ask')
  }
})

test('origins compare normalized, the way the builder compares them', () => {
  assert.equal(originOf('Content.Example.org'), 'https://content.example.org')
  assert.equal(originOf('https://content.example.org:443/'), 'https://content.example.org')
  assert.equal(originOf('localhost:4291'), 'http://localhost:4291')
  assert.equal(originOf('try-x.localhost:4291'), 'http://try-x.localhost:4291')
  assert.equal(originOf(''), '')
})

test('an ask belongs to the most specific zone its host falls in', () => {
  const zones = ['example.org', 'team.example.org']
  assert.equal(zoneOf('content.example.org', zones), 'example.org')
  assert.equal(zoneOf('a.team.example.org', zones), 'team.example.org')
  assert.equal(zoneOf('example.org', zones), 'example.org')
  assert.equal(zoneOf('notexample.org', zones), null)
})

test('builders are read leniently, and a curated few', () => {
  assert.deepEqual(buildersOf({ builders: [A, A.toUpperCase(), 'nope', 7, B] }), [A, B])
  assert.deepEqual(buildersOf({ builders: 'x' }), [])
  assert.equal(buildersOf({ builders: Array.from({ length: 40 }, (_, i) => i.toString(16).padStart(64, '0')) }).length, 16)
})

test('history falls off zone by zone, newest by receipt, never by the author\'s clock', () => {
  const m = (name, author, noted, zone = 'example.org', at = NOW) => ({ name, author, noted, zone, at })
  // An author's newest four by receipt stay; a future-dated `at` earns nothing.
  const mine = [1, 2, 3, 4, 5].map((i) => m(`a${i}`, A, i * 1000, 'example.org', i === 1 ? NOW + 500 : NOW))
  assert.deepEqual(sweep(mine, NOW), ['a1'])
  // Expired by the ask's own time; unreadable records go.
  assert.deepEqual(sweep([m('old', A, 9, 'example.org', NOW - ASK_TTL_DAYS * 86_400), m('blank', '', 0, '')], NOW).sort(), ['blank', 'old'])
  // One zone's flood never evicts another zone's asks.
  const flood = Array.from({ length: ASKS_MAX + 5 }, (_, i) => m(`f${i}`, i.toString(16).padStart(64, '0'), 10_000 + i, 'busy.example'))
  const quiet = [m('q', B, 1, 'quiet.example')]
  const dropped = sweep([...flood, ...quiet], NOW)
  assert.equal(dropped.length, 5)
  assert.ok(!dropped.includes('q'))
  assert.ok(['f0', 'f1', 'f2', 'f3', 'f4'].every((name) => dropped.includes(name)))
  assert.equal(ASKS_PER_AUTHOR, 4)
})

test('a member missing any one of author, zone or receipt is forgotten', () => {
  const ok = { author: A, zone: 'example.org', noted: 5, at: NOW }
  assert.deepEqual(sweep([{ name: 'whole', ...ok }, { name: 'no-author', ...ok, author: '' }], NOW), ['no-author'])
  assert.deepEqual(sweep([{ name: 'whole', ...ok }, { name: 'no-zone', ...ok, zone: '' }], NOW), ['no-zone'])
  assert.deepEqual(sweep([{ name: 'whole', ...ok }, { name: 'no-receipt', ...ok, noted: 0 }], NOW), ['no-receipt'])
})

test('a draft is a draft record, small, naming its base and files by signature', () => {
  const enc = (v) => new TextEncoder().encode(JSON.stringify(v))
  assert.equal(isDraft(enc({ name: 'draft', base: A, files: B })), true)
  assert.equal(isDraft(enc({ name: 'note', base: A, files: B })), false)
  assert.equal(isDraft(enc({ name: 'draft', base: 'x', files: B })), false)
  assert.equal(isDraft(new Uint8Array(20_000)), false)
})
