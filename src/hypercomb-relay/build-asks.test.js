// build-asks.test.js — the rules every grant-keeping host notes and lists
// asks and their answers by (build-asks.js): what is an ask or an answer to
// note, whose zone it is, and what falls off.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ANSWERS_PER_AUTHOR, ANSWERS_PER_BUILDER, ANSWER_TTL_DAYS, ASKS_MAX, ASKS_PER_AUTHOR, ASK_TTL_DAYS, MAX_BUILT, MAX_WHY,
  answerPreimage, askPreimage, buildersOf, isDraft, noteable, noteableAnswer, originOf, sweep, sweepAnswers, zoneOf,
} from './build-asks.js'

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

const K = 'c'.repeat(64)
const answerBytes = ({ pubkey = B, at = NOW, h = 'https://content.example.org', kind = 30569, d = K, p = A, state = 'built',
  built = state === 'built' ? [[D, 'host-drafts', '2026.10.12.1']] : [], signatures = state === 'built' ? [K] : [],
  why = state === 'built' ? undefined : 'the draft starts from an old revision', content, extra = [], noWhy = false } = {}) =>
  new TextEncoder().encode(JSON.stringify({ kind, pubkey, created_at: at,
    tags: [['d', d], ['p', p], ['h', h], ['s', state], ...(why === undefined || noWhy ? [] : [['why', why]]), ...built.map((b) => ['b', ...b]), ...signatures.map((g) => ['g', g]), ...extra],
    content: content ?? answerPreimage(d, state), id: 'x', sig: 'y' }))

test('an answer is noted only from its own builder, for this host, recently, when it verifies', async () => {
  const base = { uploader: B, origin: 'https://content.example.org', now: NOW, verify: verifies }
  assert.deepEqual(await noteableAnswer(answerBytes(), base),
    { ok: true, record: { builder: B, ask: K, author: A, state: 'built', at: NOW, origin: 'https://content.example.org' } })
  assert.equal((await noteableAnswer(answerBytes(), { ...base, uploader: A })).reason, 'an answer is uploaded by its own builder')
  assert.equal((await noteableAnswer(answerBytes({ h: 'https://elsewhere.example' }), base)).reason, 'the answer names another host')
  assert.equal((await noteableAnswer(answerBytes({ at: NOW - ANSWER_TTL_DAYS * 86_400 }), base)).reason, 'the answer is not recent')
  assert.equal((await noteableAnswer(answerBytes({ at: NOW + 601 }), base)).reason, 'the answer is not recent')
  assert.equal((await noteableAnswer(answerBytes({ at: NOW + 600 }), base)).ok, true)
  assert.equal((await noteableAnswer(answerBytes(), { ...base, verify: async () => false })).reason, 'the answer does not verify')
  for (const state of ['refused', 'failed']) {
    assert.equal((await noteableAnswer(answerBytes({ state, why: 'the draft starts from an old revision' }), base)).record.state, state)
  }
})

test('an answer is shaped as one: its ask, a known state, its author, revisions only when built, a short why', async () => {
  const base = { uploader: B, origin: 'https://content.example.org', now: NOW, verify: verifies }
  const notAnswers = [
    answerBytes({ kind: 30568 }),
    answerBytes({ state: 'maybe' }),
    answerBytes({ content: answerPreimage(K, 'failed') }),
    answerBytes({ d: 'short' }),
    answerBytes({ p: 'nobody' }),
    answerBytes({ state: 'built', built: [] }),
    answerBytes({ state: 'refused', built: [[D, 'host-drafts', '1']] }),
    answerBytes({ built: [['not a sig', 'host-drafts', '1']] }),
    answerBytes({ built: Array.from({ length: MAX_BUILT + 1 }, () => [D, 'host-drafts', '1']) }),
    answerBytes({ state: 'failed', why: 'x'.repeat(MAX_WHY + 1) }),
    answerBytes({ state: 'failed', why: 5 }),
    answerBytes({ state: 'failed', why: 'two\nlines' }),
    answerBytes({ state: 'failed', noWhy: true }),
    answerBytes({ state: 'refused', why: '' }),
    answerBytes({ state: 'built', why: 'built, and says why' }),
    answerBytes({ built: [[D]] }),
    answerBytes({ built: [[D, 'host-drafts', 'x'.repeat(65)]] }),
    answerBytes({ built: [[D, '', '1']] }),
    answerBytes({ built: [[D, 'x'.repeat(65), '1']] }),
    answerBytes({ signatures: Array.from({ length: MAX_BUILT * 2 + 1 }, () => K) }),
    answerBytes({ state: 'refused', signatures: [K] }),
    answerBytes({ signatures: ['not a sig'] }),
    answerBytes({ pubkey: 'nobody' }),
    answerBytes({ d: K.toUpperCase(), content: answerPreimage(K, 'built') }),
    answerBytes({ extra: [['pad', 'x'.repeat(4200)]] }),
    new TextEncoder().encode('not json'),
    new Uint8Array(5000).fill(0x20),
  ]
  for (const bad of notAnswers) assert.equal((await noteableAnswer(bad, { ...base, uploader: 'nobody' })).reason, 'not an answer')
  // At the limits it is one: a why of MAX_WHY, MAX_BUILT revisions, twice as many signatures.
  assert.equal((await noteableAnswer(answerBytes({ state: 'failed', why: 'x'.repeat(MAX_WHY) }), base)).ok, true)
  assert.equal((await noteableAnswer(answerBytes({ built: Array.from({ length: MAX_BUILT }, () => [D, 'host-drafts', '1']), signatures: Array.from({ length: MAX_BUILT * 2 }, () => K) }), base)).ok, true)
})

test('answers fall off builder by builder: a builder\'s newest word per ask, a few per author, its own flood evicting only its own', () => {
  const m = (name, { builder = B, ask = K, author = A, noted = 1, zone = 'example.org', at = NOW } = {}) => ({ name, builder, ask, author, noted, zone, at })
  const hexOf = (i, fill = '0') => i.toString(16).padStart(64, fill)
  // A builder's newer answer to the same ask replaces its older one; another builder's stands.
  assert.deepEqual(sweepAnswers([m('failed', { noted: 1 }), m('built', { noted: 2 }), m('other', { builder: D, noted: 1 })], NOW), ['failed'])
  // Expired by the answer's own time; a record missing any field goes.
  assert.deepEqual(sweepAnswers([m('old', { at: NOW - ANSWER_TTL_DAYS * 86_400 }), m('blank', { builder: '' })], NOW).sort(), ['blank', 'old'])
  for (const missing of ['builder', 'ask', 'author', 'zone']) assert.deepEqual(sweepAnswers([m('x', { [missing]: '' })], NOW), ['x'], missing)
  assert.deepEqual(sweepAnswers([m('x', { noted: 0 })], NOW), ['x'])
  // Per builder and author, newest by receipt.
  const many = Array.from({ length: ANSWERS_PER_AUTHOR + 2 }, (_, i) => m(`a${i}`, { ask: hexOf(i), noted: i + 1 }))
  assert.deepEqual(sweepAnswers(many, NOW).sort(), ['a0', 'a1'])
  // A builder answering a flood of asks (fresh authors, minted for it) evicts
  // only its own answers: another builder's answer to the same author stands.
  const flood = Array.from({ length: ANSWERS_PER_BUILDER + 3 }, (_, i) => m(`f${i}`, { builder: D, ask: hexOf(i), author: hexOf(i, '1'), noted: 10 + i }))
  const dropped = sweepAnswers([...flood, m('mine', { noted: 1 })], NOW)
  assert.deepEqual(dropped.sort(), ['f0', 'f1', 'f2'])
  // And one zone's answers never evict another's.
  assert.deepEqual(sweepAnswers([...flood.map((f) => ({ ...f, zone: 'busy.example' })), m('q', { builder: D, zone: 'quiet.example' })], NOW).includes('q'), false)
})
