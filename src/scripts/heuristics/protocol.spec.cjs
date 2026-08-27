const assert = require('node:assert/strict')
const test = require('node:test')
const { canonical, sign, algorithmArtifact, algorithmSignature, heuristicKey } = require('./protocol.cjs')

test('canonical composition ignores object insertion order', () => {
  assert.equal(canonical({ b: 2, a: 1 }), canonical({ a: 1, b: 2 }))
})

test('heuristic key changes with either algorithm or content', () => {
  const a = sign(Buffer.from('algorithm-a'))
  const b = sign(Buffer.from('algorithm-b'))
  const content = sign(Buffer.from('content'))
  assert.notEqual(heuristicKey(a, content), heuristicKey(b, content))
  assert.notEqual(heuristicKey(a, content), heuristicKey(a, sign(Buffer.from('other'))))
})

test('canonical output is valid JSON when optional fields are absent', () => {
  const encoded = canonical({ status: 'unsupported', matched: undefined, value: { reason: 'not-text' } })
  assert.deepEqual(JSON.parse(encoded), { status: 'unsupported', value: { reason: 'not-text' } })
})

test('contentless heuristics have a stable key distinct from content-bound runs', () => {
  const algorithm = sign(Buffer.from('contentless-algorithm'))
  assert.equal(heuristicKey(algorithm), heuristicKey(algorithm))
  assert.notEqual(heuristicKey(algorithm), heuristicKey(algorithm, sign(Buffer.alloc(0))))
})

test('operand order is part of computation identity', () => {
  const algorithm = sign(Buffer.from('ordered-operation'))
  const left = sign(Buffer.from('left'))
  const right = sign(Buffer.from('right'))
  assert.notEqual(heuristicKey(algorithm, [left, right]), heuristicKey(algorithm, [right, left]))
})

test('algorithm artifact bytes are named by the advertised signature', () => {
  const definition = { id: 'test/finding', version: 1, run() { return { matched: true, value: 1 } } }
  assert.equal(sign(algorithmArtifact(definition)), algorithmSignature(definition))
})
