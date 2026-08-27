const assert = require('node:assert/strict')
const test = require('node:test')
const { definitions } = require('./hive-heuristics.cjs')

const run = (id, inputs) => definitions.find(definition => definition.id === id).run(inputs)
const a = 'a'.repeat(64)
const b = 'b'.repeat(64)
const c = 'c'.repeat(64)

test('branch header counts structural slots', () => {
  const result = run('hive/branch-header', [{ name: 'assistant', children: [a, b], notes: [c] }])
  assert.deepEqual(result.value, { name: 'assistant', slots: { children: 2, notes: 1, decorations: 0, properties: 0, builds: 0 } })
})

test('child index reads string and cycle references', () => {
  assert.deepEqual(run('hive/child-index', [{ children: [a, { $cycle: b }, { name: 'inline' }] }]).value.children, [a, b])
})

test('history diff preserves operand direction', () => {
  const result = run('hive/history-diff', [{ name: 'x', children: [a, b] }, { name: 'x', children: [b, c] }])
  assert.deepEqual(result.value.slots.children.added, [c])
  assert.deepEqual(result.value.slots.children.removed, [a])
  assert.deepEqual(result.value.slots.children.retained, [b])
})
