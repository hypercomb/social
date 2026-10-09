import test from 'node:test'
import assert from 'node:assert/strict'
import { nip05Name, nostrJson, PRIMARY } from './nip05-names.js'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)

test('a name is trimmed and lowercased, then taken only as it stands', () => {
  assert.equal(nip05Name('Jaime'), 'jaime')
  assert.equal(nip05Name('  leanne.c_b-1  '), 'leanne.c_b-1')
  assert.equal(nip05Name('x'.repeat(64)), 'x'.repeat(64))
  // Never folded into something it was not: a space, an accent, an @, too long.
  for (const raw of ['Jaime Wize', 'José', 'jwize@jwize.com', 'x'.repeat(65), '', '   ', 'a/b', 'a+b']) {
    assert.equal(nip05Name(raw), null, raw)
  }
  // `_` is the primary's alone, however it is spelled.
  assert.equal(PRIMARY, '_')
  assert.equal(nip05Name('_'), null)
  assert.equal(nip05Name(' _ '), null)
  // Only a string is a name — nothing is invented from a missing one.
  for (const raw of [undefined, null, 42, true, {}, ['jaime']]) assert.equal(nip05Name(raw), null, String(raw))
})

test('a name is ASCII as written: Unicode case mapping and Unicode spaces never fold one into a name', () => {
  // U+212A KELVIN SIGN lowercases to ASCII `k`, U+0130 to `i` + a combining dot.
  for (const raw of ['Kate', 'Jaimİ', 'K']) assert.equal(nip05Name(raw), null, JSON.stringify(raw))
  // Unicode spaces String#trim would strip: a BOM, an ideographic space, NBSP, a line separator.
  for (const space of ['﻿', '　', ' ', ' ']) {
    assert.equal(nip05Name(`${space}jaime`), null, JSON.stringify(space))
    assert.equal(nip05Name(`jaime${space}`), null, JSON.stringify(space))
  }
  // ASCII whitespace is trimmed, inside or out of a long run, and nothing else is.
  assert.equal(nip05Name('\t\n\v\f\r Jaime \r\f\v\n\t'), 'jaime')
  assert.equal(nip05Name(`${' '.repeat(100_000)}jaime${' '.repeat(100_000)}`), 'jaime')
  assert.equal(nip05Name(`${' '.repeat(100_000)}x y`), null)
})

test('?name= in a lookalike spelling answers nothing, never the real name', () => {
  const entries = [{ pubkey: A, primary: true, names: ['kate'] }, { pubkey: B, names: ['jaime'] }]
  assert.deepEqual(nostrJson(entries, 'Kate'), { names: { Kate: A } })
  assert.deepEqual(nostrJson(entries, 'Kate'), { names: {} })
  assert.deepEqual(nostrJson(entries, 'JAIMİ'), { names: {} })
  assert.deepEqual(nostrJson(entries, '﻿jaime'), { names: {} })
  assert.deepEqual(nostrJson(entries, 'x'.repeat(65)), { names: {} })
  // And a profile written in one is never vouched under the ASCII name.
  assert.deepEqual(nostrJson([{ pubkey: C, names: ['Kate'] }], 'kate'), { names: {} })
})

test('the primary answers as _ and under its own name; every other key under its names', () => {
  assert.deepEqual(nostrJson([
    { pubkey: A, primary: true, names: ['Jaime'] },
    { pubkey: B, names: ['Leanne'] },
    { pubkey: C, names: [undefined] },
  ]), { names: { _: A, jaime: A, leanne: B } })
  // A key with no name is still the domain's own when it is the primary.
  assert.deepEqual(nostrJson([{ pubkey: A, primary: true, names: [undefined] }]), { names: { _: A } })
  // The first key marked primary is the one; a second mark changes nothing.
  assert.deepEqual(nostrJson([{ pubkey: B, primary: true, names: [] }, { pubkey: A, primary: true, names: [] }]), { names: { _: B } })
  // Nobody marked: nobody is the domain.
  assert.deepEqual(nostrJson([{ pubkey: A, names: ['jaime'] }]), { names: { jaime: A } })
})

test('a name two keys claim on one host goes to neither; one key may hold several', () => {
  assert.deepEqual(nostrJson([
    { pubkey: A, primary: true, names: ['Jaime', 'jwize'] },
    { pubkey: B, names: ['jaime'] },
    { pubkey: C, names: ['JAIME', 'cafe'] },
  ]), { names: { _: A, jwize: A, cafe: C } })
  // The SAME key naming itself twice is no contest.
  assert.deepEqual(nostrJson([{ pubkey: A, names: ['jaime'] }, { pubkey: A, names: ['Jaime'] }]), { names: { jaime: A } })
})

test('a key is 64 hex, answered lowercase; anything else is no key at all', () => {
  assert.deepEqual(nostrJson([
    { pubkey: 'A'.repeat(64), primary: true, names: ['upper'] },
    { pubkey: 'npub1xyz', names: ['bech'] },
    { pubkey: B.slice(1), names: ['short'] },
    { names: ['nobody'] },
    null,
  ]), { names: { _: A, upper: A } })
  assert.deepEqual(nostrJson(undefined), { names: {} })
  assert.deepEqual(nostrJson([{ pubkey: A, names: 'jaime' }]), { names: {} })
})

test('?name= answers one entry keyed exactly as asked, or none', () => {
  const entries = [{ pubkey: A, primary: true, names: ['Jaime'] }, { pubkey: B, names: ['leanne'] }]
  assert.deepEqual(nostrJson(entries, 'jaime'), { names: { jaime: A } })
  assert.deepEqual(nostrJson(entries, 'Jaime'), { names: { Jaime: A } })
  assert.deepEqual(nostrJson(entries, 'LEANNE'), { names: { LEANNE: B } })
  assert.deepEqual(nostrJson(entries, '_'), { names: { _: A } })
  assert.deepEqual(nostrJson(entries, 'nobody'), { names: {} })
  assert.deepEqual(nostrJson(entries, ' jaime'), { names: {} })
  // Empty or absent: every name.
  for (const query of ['', null, undefined]) assert.deepEqual(nostrJson(entries, query), { names: { _: A, jaime: A, leanne: B } })
})

test('a name that is also an Object key is held as an own property', () => {
  const doc = nostrJson([{ pubkey: A, names: ['__proto__', 'constructor'] }])
  assert.equal(JSON.stringify(doc), JSON.stringify({ names: Object.fromEntries([['__proto__', A], ['constructor', A]]) }))
  assert.equal(Object.getPrototypeOf(doc.names), Object.prototype)
  assert.equal(JSON.stringify(nostrJson([{ pubkey: A, names: ['__proto__'] }], '__PROTO__')), `{"names":{"__PROTO__":"${A}"}}`)
  assert.deepEqual(nostrJson([{ pubkey: A, names: ['jaime'] }], 'constructor'), { names: {} })
})
