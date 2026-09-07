import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  appendHostPackage,
  contentDirectoryIO,
  HOST_PACKAGES_POOL,
  parseReplicationRequest,
  publishReplicatedPackage,
  resolvePackageClosure,
  resolveSignatureClosure,
  resolveSignatureInventory,
} from './replicate.js'

const sig = bytes => createHash('sha256').update(bytes).digest('hex')

test('replicates and verifies an atomic closure, then becomes a delta no-op', async () => {
  const leaf = Buffer.from('image bytes')
  const leafSig = sig(leaf)
  const root = Buffer.from(JSON.stringify({ imageSig: leafSig }))
  const rootSig = sig(root)
  const source = new Map([[rootSig, root], [leafSig, leaf]])
  const destination = new Map()
  const io = {
    fetch: async signature => source.get(signature) ?? null,
    read: async signature => destination.get(signature) ?? null,
    write: async (signature, bytes) => { destination.set(signature, bytes) },
  }

  const first = await resolveSignatureClosure(rootSig, io)
  assert.equal(first.fetched, 2)
  assert.deepEqual(first.holes, [])
  assert.deepEqual(first.refused, [])

  const second = await resolveSignatureClosure(rootSig, io)
  assert.equal(second.present, 2)
  assert.equal(second.fetched, 0)
})

test('package replication walks declared structure and ignores unrelated signature-looking text', async () => {
  const missingButUnrelated = 'f'.repeat(64)
  const bee = Buffer.from(JSON.stringify({ cells: [missingButUnrelated] }))
  const beeSig = sig(bee)
  const dependency = Buffer.from('dependency bytes')
  const dependencySig = sig(dependency)
  const child = Buffer.from(JSON.stringify({ name: 'child', cells: [], bees: [], dependencies: [] }))
  const childSig = sig(child)
  const root = Buffer.from(JSON.stringify({
    name: 'root',
    cells: [childSig],
    bees: [`${beeSig}.js`],
    dependencies: [`${dependencySig}.js`],
    docs: { example: missingButUnrelated },
  }))
  const rootSig = sig(root)
  const source = new Map([[rootSig, root], [childSig, child], [beeSig, bee], [dependencySig, dependency]])
  const destination = new Map()
  const result = await resolvePackageClosure(rootSig, {
    fetch: async signature => source.get(signature) ?? null,
    read: async signature => destination.get(signature) ?? null,
    write: async (signature, bytes) => { destination.set(signature, bytes) },
  })

  assert.deepEqual(new Set(result.held), new Set([rootSig, childSig, beeSig, dependencySig]))
  assert.deepEqual(result.holes, [])
  assert.deepEqual(result.refused, [])
  assert.equal(destination.has(missingButUnrelated), false)
})

test('package replication refuses an opaque or malformed root as a package', async () => {
  for (const bytes of [
    Buffer.from('not a layer'),
    Buffer.from(JSON.stringify({ name: 'root', cells: [], bees: [] })),
  ]) {
    const root = sig(bytes)
    const result = await resolvePackageClosure(root, {
      fetch: async signature => signature === root ? bytes : null,
      read: async () => null,
      write: async () => {},
    })
    assert.deepEqual(result.refused, [root])
  }
})

test('refuses bytes that do not match their requested signature', async () => {
  const claimed = 'a'.repeat(64)
  const result = await resolveSignatureClosure(claimed, {
    fetch: async () => Buffer.from('wrong'),
    read: async () => null,
    write: async () => assert.fail('unverified bytes must never be written'),
  })
  assert.deepEqual(result.refused, [claimed])
})

test('flat destination writes atoms under their signature', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-replicator-'))
  try {
    const bytes = Buffer.from('one atom')
    const signature = sig(bytes)
    const io = contentDirectoryIO(dir, [])
    await io.write(signature, bytes)
    assert.deepEqual(readFileSync(join(dir, signature)), bytes)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('flat replication cannot occupy the reserved host-packages pool address', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-replicator-reserved-'))
  try {
    const io = contentDirectoryIO(dir, [])
    await assert.rejects(
      () => io.write(HOST_PACKAGES_POOL, Buffer.from('host:packages')),
      /reserved host:packages pool/,
    )
    assert.equal(existsSync(join(dir, HOST_PACKAGES_POOL)), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('flat destination repairs a corrupt existing atom', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-replicator-'))
  try {
    const bytes = Buffer.from('correct atom')
    const signature = sig(bytes)
    const io = contentDirectoryIO(dir, [])
    await io.write(signature, Buffer.from('corrupt'))
    await io.write(signature, bytes)
    assert.deepEqual(readFileSync(join(dir, signature)), bytes)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('normalizes the signature-only request contract', () => {
  const request = parseReplicationRequest({
    signature: 'A'.repeat(64),
    sources: ['https://content.example/', 'https://content.example'],
  })
  assert.equal(request.signature, 'a'.repeat(64))
  assert.deepEqual(request.sources, ['https://content.example'])
  assert.equal(request.package, null)
})

test('normalizes explicit package metadata and rejects ambiguous labels or inventory walks', () => {
  const request = parseReplicationRequest({
    signature: 'A'.repeat(64),
    sources: ['https://content.example'],
    package: { label: '  development  ' },
  })
  assert.deepEqual(request.package, { label: 'development' })
  assert.throws(() => parseReplicationRequest({
    signature: 'a'.repeat(64), sources: ['https://content.example'], package: { label: 'line one\nline two' },
  }), /one line/)
  assert.throws(() => parseReplicationRequest({
    signature: 'a'.repeat(64), sources: ['https://content.example'], package: { label: 'development' }, inventory: true,
  }), /cannot use inventory mode/)
})

test('publishes only a verified complete package closure and remains idempotent by signature', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-package-publish-'))
  try {
    const root = 'a'.repeat(64)
    const child = 'b'.repeat(64)
    const request = { signature: root, package: { label: 'development' } }
    const incomplete = {
      root, total: 2, held: [root], holes: [child], refused: [], limited: false,
    }
    assert.equal(publishReplicatedPackage(dir, request, incomplete), null)
    assert.equal(existsSync(join(dir, HOST_PACKAGES_POOL)), false)

    const complete = {
      root, total: 2, held: [root, child], holes: [], refused: [], limited: false,
    }
    assert.deepEqual(
      publishReplicatedPackage(dir, request, complete),
      { appended: true, index: 0, name: '00000000' },
    )
    const entry = join(dir, HOST_PACKAGES_POOL, '00000000')
    assert.equal(readFileSync(entry, 'utf8'), `${root}\ndevelopment`)

    assert.deepEqual(
      publishReplicatedPackage(dir, { signature: root, package: { label: 'renamed' } }, complete),
      { appended: false, index: 0, name: '00000000' },
    )
    assert.equal(readFileSync(entry, 'utf8'), `${root}\ndevelopment`)
    assert.equal(publishReplicatedPackage(dir, { signature: root, package: null }, complete), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const appendInProcess = (dir, signature, label) => new Promise((resolve, reject) => {
  const moduleUrl = pathToFileURL(join(import.meta.dirname, 'replicate.js')).href
  const source = `import { appendHostPackage } from ${JSON.stringify(moduleUrl)}; appendHostPackage(${JSON.stringify(dir)}, ${JSON.stringify(signature)}, ${JSON.stringify(label)});`
  const child = spawn(process.execPath, ['--input-type=module', '--eval', source], { stdio: ['ignore', 'ignore', 'pipe'] })
  let error = ''
  child.stderr.on('data', chunk => { error += chunk })
  child.on('error', reject)
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(error || `append process exited ${code}`)))
})

test('concurrent relay processes append gaplessly without duplicating or overwriting packages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-package-race-'))
  try {
    const a = 'a'.repeat(64)
    const b = 'b'.repeat(64)
    await Promise.all([
      appendInProcess(dir, a, 'alpha'),
      appendInProcess(dir, b, 'beta'),
      appendInProcess(dir, a, 'alpha-racer'),
      appendInProcess(dir, b, 'beta-racer'),
    ])
    const poolDir = join(dir, HOST_PACKAGES_POOL)
    const names = readdirSync(poolDir).filter(name => /^[0-9]{8}$/.test(name)).sort()
    assert.deepEqual(names, ['00000000', '00000001'])
    const signatures = names.map(name => readFileSync(join(poolDir, name), 'utf8').split('\n')[0])
    assert.deepEqual(new Set(signatures), new Set([a, b]))
    assert.equal(readdirSync(poolDir).some(name => name.startsWith('.part-package-')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rejects credential-bearing source URLs', () => {
  assert.throws(() => parseReplicationRequest({
    signature: 'a'.repeat(64),
    sources: ['https://secret@example.test'],
  }), /credentials/)
})

test('active inventory fetches exact atoms without walking stale child references', async () => {
  const current = Buffer.from('current')
  const currentSig = sig(current)
  const stale = Buffer.from('stale')
  const staleSig = sig(stale)
  const layer = Buffer.from(JSON.stringify({ child: staleSig }))
  const layerSig = sig(layer)
  const record = Buffer.from(JSON.stringify({ heads: [{ layer: layerSig }], objects: [{ sig: currentSig }] }))
  const root = sig(record)
  const source = new Map([[root, record], [layerSig, layer], [currentSig, current], [staleSig, stale]])
  const held = new Map()
  const result = await resolveSignatureInventory(root, {
    fetch: async signature => source.get(signature) ?? null,
    read: async signature => held.get(signature) ?? null,
    write: async (signature, bytes) => held.set(signature, bytes),
  })
  assert.deepEqual(new Set(result.held), new Set([root, layerSig, currentSig]))
  assert.equal(held.has(staleSig), false)
})

test('flat destination refuses to write an atom over a DIRECTORY at that address', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hypercomb-replicator-'))
  try {
    const bytes = Buffer.from('an atom whose address is taken by a pool')
    const signature = sig(bytes)
    // a pool of meaning or a lineage bag: a sig-named DIRECTORY with members
    mkdirSync(join(dir, signature))
    writeFileSync(join(dir, signature, 'b'.repeat(64)), 'a member')
    const io = contentDirectoryIO(dir, [])
    await assert.rejects(() => io.write(signature, bytes), /over a directory/)
    // the directory and its member are exactly as they were
    assert.deepEqual(readFileSync(join(dir, signature, 'b'.repeat(64)), 'utf8'), 'a member')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a destination that refuses one atom records it as refused and the rest of the closure still lands', async () => {
  const leaf = Buffer.from('a leaf that lands')
  const leafSig = sig(leaf)
  const blocked = Buffer.from('a leaf whose address is a directory')
  const blockedSig = sig(blocked)
  const root = Buffer.from(JSON.stringify({ a: leafSig, b: blockedSig }))
  const rootSig = sig(root)
  const source = new Map([[rootSig, root], [leafSig, leaf], [blockedSig, blocked]])
  const destination = new Map()
  const io = {
    fetch: async signature => source.get(signature) ?? null,
    read: async signature => destination.get(signature) ?? null,
    write: async (signature, bytes) => {
      if (signature === blockedSig) throw new Error('refusing to write atom over a directory')
      destination.set(signature, bytes)
    },
  }

  const result = await resolveSignatureClosure(rootSig, io)

  assert.deepEqual(result.refused, [blockedSig])
  assert.deepEqual(result.holes, [])
  assert.ok(result.held.includes(leafSig))
  assert.ok(destination.has(leafSig))
  assert.ok(!destination.has(blockedSig))
})

test('a literal private, loopback or link-local source is refused at parse time', () => {
  const parse = source => () => parseReplicationRequest({ signature: 'a'.repeat(64), sources: [source] })
  assert.throws(parse('http://127.0.0.1:8080'), /loopback/)
  assert.throws(parse('http://169.254.169.254/'), /link-local/)
  assert.throws(parse('http://10.1.2.3/content'), /private/)
  assert.throws(parse('http://[::1]:8080'), /loopback/)
  assert.throws(parse('http://[::ffff:10.0.0.1]/'), /private/)
  // a public literal and an ordinary name still pass
  assert.deepEqual(parse('https://93.184.216.34/')().sources, ['https://93.184.216.34'])
  assert.deepEqual(parse('https://content.example/')().sources, ['https://content.example'])
})

test('the dev escape hatch is the only way a private source parses', () => {
  const request = parseReplicationRequest(
    { signature: 'a'.repeat(64), sources: ['http://127.0.0.1:8080'] },
    { allowPrivate: true },
  )
  assert.deepEqual(request.sources, ['http://127.0.0.1:8080'])
})

test('an operator origin allowlist admits only the origins it names', () => {
  const allowedOrigins = new Set(['https://content.example'])
  const request = parseReplicationRequest(
    { signature: 'a'.repeat(64), sources: ['https://content.example/atoms'] },
    { allowedOrigins },
  )
  assert.deepEqual(request.sources, ['https://content.example/atoms'])
  assert.throws(() => parseReplicationRequest(
    { signature: 'a'.repeat(64), sources: ['https://other.example'] },
    { allowedOrigins },
  ), /not an allowed replication origin/)
})

test('a job is bounded by wall clock and fetched bytes, not by atom count alone', async () => {
  const leaf = Buffer.from('a leaf')
  const leafSig = sig(leaf)
  const root = Buffer.from(JSON.stringify({ leafSig }))
  const rootSig = sig(root)
  const source = new Map([[rootSig, root], [leafSig, leaf]])
  const io = {
    fetch: async signature => source.get(signature) ?? null,
    read: async () => null,
    write: async () => {},
  }
  const byByte = await resolveSignatureClosure(rootSig, io, { byteLimit: 1 })
  assert.equal(byByte.fetched, 1)
  assert.equal(byByte.limited, true)
  assert.equal(byByte.fetchedBytes, root.byteLength)

  const byClock = await resolveSignatureClosure(rootSig, io, { deadlineMs: -1 })
  assert.equal(byClock.fetched, 0)
  assert.equal(byClock.limited, true)
})

test('an origin the OPERATOR named is exempt from the address screen', () => {
  // The screen exists because the CALLER chooses the destination. When the
  // operator names an internal mirror, that reason is gone — so an allowlisted
  // origin reaches private space without opening the screen for anything else.
  const allowedOrigins = new Set(['http://10.0.0.7:8080'])
  const request = parseReplicationRequest(
    { signature: 'a'.repeat(64), sources: ['http://10.0.0.7:8080/atoms'] },
    { allowedOrigins },
  )
  assert.deepEqual(request.sources, ['http://10.0.0.7:8080/atoms'])
  // and an unlisted private origin is still refused, by the allowlist itself
  assert.throws(() => parseReplicationRequest(
    { signature: 'a'.repeat(64), sources: ['http://10.0.0.8:8080'] },
    { allowedOrigins },
  ), /not an allowed replication origin/)
})
