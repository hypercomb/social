// host-listing.test.js
//
// The floor moved out of code into `host-listing.floor.json`, the one copy the
// relay, the blossom worker and the native host (crates/serve, include_str!)
// all read. These pin that the move changed nothing a consumer can see:
// relay.js, replicate.js and the worker import exactly what they imported.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as listing from './host-listing.js'

const floorFile = JSON.parse(readFileSync(new URL('./host-listing.floor.json', import.meta.url), 'utf8'))

test('the module exports exactly what it exported before the floor file', () => {
  assert.deepEqual(Object.keys(listing).sort(), ['HOST_LISTING_FLOOR', 'MAX_LISTED', 'hostListing', 'listedMeanings'])
  assert.equal(listing.MAX_LISTED, 32)
})

test('HOST_LISTING_FLOOR is the same frozen array, in the same order', () => {
  assert.deepEqual(listing.HOST_LISTING_FLOOR, ['host:packages', 'host:offerings', 'community:hosts', 'community:offers'])
  assert.ok(Array.isArray(listing.HOST_LISTING_FLOOR))
  assert.ok(Object.isFrozen(listing.HOST_LISTING_FLOOR))
})

test('the floor is the floor file, key for key, and every policy is one the hosts know', () => {
  assert.deepEqual(listing.HOST_LISTING_FLOOR, Object.keys(floorFile))
  for (const [meaning, policy] of Object.entries(floorFile)) {
    assert.ok(policy === 'set' || policy === 'document', `${meaning}: ${policy}`)
    assert.ok(meaning.includes(':'), `${meaning} must be a colon meaning — it can never address a bag`)
  }
})

test('hostListing is the floor plus declared meanings, floor first', () => {
  assert.deepEqual(listing.hostListing([]), [...listing.HOST_LISTING_FLOOR])
  assert.deepEqual(
    listing.hostListing([{ listed: ['hypercomb:windows', 'host:packages'] }, { listed: ['themes:text'] }]),
    [...listing.HOST_LISTING_FLOOR, 'hypercomb:windows', 'themes:text'],
  )
})

test('listedMeanings keeps colon meanings only, leniently, capped', () => {
  assert.deepEqual(listing.listedMeanings(undefined), [])
  assert.deepEqual(listing.listedMeanings({ listed: 'nope' }), [])
  assert.deepEqual(
    listing.listedMeanings({ listed: ['bare', ' a:b ', 'a:b', 'has space:x', 7, 'x'.repeat(161) + ':y', 'c:d'] }),
    ['a:b', 'c:d'],
  )
  const many = Array.from({ length: 40 }, (_, i) => `m:${i}`)
  assert.equal(listing.listedMeanings({ listed: many }).length, listing.MAX_LISTED)
})
