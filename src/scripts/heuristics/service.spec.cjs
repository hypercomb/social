const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { HeuristicService, PACK_CATALOG_RECORD_BYTES } = require('./service.cjs')
const { sign } = require('./protocol.cjs')

test('stores findings and leaves false outcomes behind', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-heuristics-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.writeFile(path.join(root, 'a.ts'), 'export const answer = 42\n')
  await fs.writeFile(path.join(root, 'plain.txt'), 'nothing exported\n')

  const first = await new HeuristicService(root).open()
  const firstStats = await first.audit()
  assert.equal(firstStats.filesScanned, 2)
  assert.ok(firstStats.heuristicRuns > 0)

  const second = await new HeuristicService(root).open()
  const secondStats = await second.audit()
  assert.equal(secondStats.filesScanned, 0)
  assert.equal(secondStats.filesSkipped, 2)

  const symbols = await second.aggregate('repo/symbol-inventory')
  assert.equal(symbols.length, 1)
  assert.deepEqual(symbols.find(record => record.file === 'a.ts').value.symbols, ['answer'])
  assert.equal(symbols.some(record => record.file === 'plain.txt'), false)
})

test('content changes invalidate only the changed file', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-heuristics-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const target = path.join(root, 'a.ts')
  await fs.writeFile(target, 'export const before = 1\n')
  await (await new HeuristicService(root).open()).audit()
  await new Promise(resolve => setTimeout(resolve, 10))
  await fs.writeFile(target, 'export const after = 2\n')
  const next = await new HeuristicService(root).open()
  const stats = await next.audit()
  assert.equal(stats.filesScanned, 1)
  assert.ok(stats.heuristicRuns > 0)
  const symbols = await next.aggregate('repo/symbol-inventory')
  assert.deepEqual(symbols[0].value.symbols, ['after'])
})

test('compute stores answer bytes by signature and reads through on the next call', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-compute-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const service = await new HeuristicService(root).open()
  const algorithmSig = 'a'.repeat(64)
  const params = ['b'.repeat(64), 'c'.repeat(64)]
  let runs = 0
  const first = await service.compute(algorithmSig, params, async () => { runs++; return { answer: 42 } })
  const second = await service.compute(algorithmSig, params, async () => { runs++; return { answer: 99 } })
  assert.equal(first.source, 'computed')
  assert.equal(second.source, 'saved')
  assert.equal(first.answerSig, second.answerSig)
  assert.equal(runs, 1)
  assert.deepEqual(JSON.parse(second.bytes.toString('utf8')), { answer: 42 })
  assert.equal(await fs.readFile(path.join(root, '.hypercomb', 'heuristics', 'resources', first.answerSig), 'utf8'), '{"answer":42}')
})

test('compute leaves no mapping when no answer is found', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-compute-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const service = await new HeuristicService(root).open()
  const result = await service.compute('d'.repeat(64), [], async () => null)
  assert.equal(result.source, 'none')
  assert.equal(result.answerSig, null)
  assert.equal(Object.keys(service.index.results).length, 0)
})

test('export materializes every known answer as an operand vector', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-vector-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const service = await new HeuristicService(root).open()
  const algorithmSig = 'e'.repeat(64)
  const operandSig = 'f'.repeat(64)
  const computed = await service.compute(algorithmSig, [operandSig], async () => ({ documented: true }))
  const computedToo = await service.compute('1'.repeat(64), [operandSig], async () => ({ documented: 'also' }))
  const output = path.join(root, 'dump')
  const receipt = await service.exportDump(output)
  assert.equal(receipt.vectors, 1)
  assert.equal(receipt.protocol, 'hypercomb-heuristic-export/v4')
  assert.equal(receipt.packedAnswers, 2)
  const vectorPool = sign(Buffer.from('heuristics:vectors'))
  const heapPool = sign(Buffer.from('heuristics:heap'))
  const vectorSig = await fs.readFile(path.join(output, vectorPool, operandSig), 'utf8')
  const vector = JSON.parse(await fs.readFile(path.join(output, heapPool, vectorSig), 'utf8'))
  assert.equal(vector.operandSig, operandSig)
  const fact = vector.facts.find(item => item.answerSig === computed.answerSig)
  assert.equal(fact.algorithmSig, algorithmSig)
  const packPool = sign(Buffer.from('heuristics:packs'))
  const catalogSig = await fs.readFile(path.join(output, packPool, 'current'), 'utf8')
  const catalog = await fs.readFile(path.join(output, heapPool, catalogSig))
  assert.equal(catalog.length, 2 * PACK_CATALOG_RECORD_BYTES)
  const locations = {}
  for (let cursor = 0; cursor < catalog.length; cursor += PACK_CATALOG_RECORD_BYTES) {
    locations[catalog.subarray(cursor, cursor + 32).toString('hex')] = {
      packSig: catalog.subarray(cursor + 32, cursor + 64).toString('hex'),
      offset: catalog.readUInt32BE(cursor + 64),
      length: catalog.readUInt32BE(cursor + 68),
    }
  }
  const location = locations[computed.answerSig]
  const secondLocation = locations[computedToo.answerSig]
  assert.equal(location.packSig, secondLocation.packSig)
  assert.notEqual(location.packSig, computed.answerSig)
  const pack = await fs.readFile(path.join(output, heapPool, location.packSig))
  const restored = pack.subarray(location.offset, location.offset + location.length)
  assert.equal(sign(restored), computed.answerSig)
  const repeated = await service.exportDump(output)
  assert.equal(repeated.skipped, true)
})

test('keeps a lean strategy-linked history and omits no-op audits', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-history-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.writeFile(path.join(root, 'a.ts'), 'export const answer = 42\n')
  const first = await new HeuristicService(root, { historyLimit: 2 }).open()
  await first.audit()
  await first.exportDump(path.join(root, 'dump'))
  const initial = await first.history()
  assert.equal(initial.length, 2)
  assert.equal(initial[1].previousSig, initial[0].entrySig)
  assert.equal(initial[0].strategySig, first.strategySig)
  assert.equal('file' in initial[0], false)
  assert.equal('answer' in initial[0], false)
  assert.ok(first.strategy.compositions.some(item => item.id === 'change-impact'))

  const second = await new HeuristicService(root, { historyLimit: 2 }).open()
  await second.audit()
  assert.equal((await second.history()).length, 2)
})
