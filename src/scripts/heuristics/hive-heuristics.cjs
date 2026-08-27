function asBranch(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) value = JSON.parse(Buffer.from(value).toString('utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('operand is not a branch payload')
  return value
}

function signatures(values) {
  if (!Array.isArray(values)) return []
  return values.flatMap(value => {
    if (typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)) return [value]
    if (value && typeof value === 'object') {
      const sig = value.$sig || value.$cycle
      return typeof sig === 'string' && /^[0-9a-f]{64}$/.test(sig) ? [sig] : []
    }
    return []
  })
}

const SLOT_NAMES = ['children', 'notes', 'decorations', 'properties', 'builds']

const definitions = [
  {
    id: 'hive/branch-header', version: 1, operands: ['branch'],
    run(inputs) {
      const branch = asBranch(inputs[0])
      const slots = {}
      for (const name of SLOT_NAMES) slots[name] = Array.isArray(branch[name]) ? branch[name].length : 0
      return { matched: true, value: { name: branch.name || null, slots } }
    },
  },
  {
    id: 'hive/child-index', version: 1, operands: ['branch'],
    run(inputs) {
      const branch = asBranch(inputs[0])
      const children = signatures(branch.children)
      return { matched: children.length > 0, value: { children } }
    },
  },
  {
    id: 'hive/direct-references', version: 1, operands: ['branch'],
    run(inputs) {
      const branch = asBranch(inputs[0])
      const slots = {}
      for (const name of SLOT_NAMES) slots[name] = signatures(branch[name])
      const total = Object.values(slots).reduce((sum, values) => sum + values.length, 0)
      return { matched: total > 0, value: { slots, total } }
    },
  },
  {
    id: 'hive/history-diff', version: 1, operands: ['older-branch', 'newer-branch'],
    run(inputs) {
      const older = asBranch(inputs[0])
      const newer = asBranch(inputs[1])
      const slots = {}
      let changes = 0
      for (const name of SLOT_NAMES) {
        const before = signatures(older[name])
        const after = signatures(newer[name])
        const beforeSet = new Set(before)
        const afterSet = new Set(after)
        const added = after.filter(sig => !beforeSet.has(sig))
        const removed = before.filter(sig => !afterSet.has(sig))
        changes += added.length + removed.length
        slots[name] = { added, removed, retained: after.filter(sig => beforeSet.has(sig)) }
      }
      const nameChanged = older.name !== newer.name
      return { matched: changes > 0 || nameChanged, value: { olderName: older.name || null, newerName: newer.name || null, nameChanged, slots } }
    },
  },
]

module.exports = { definitions, signatures }
