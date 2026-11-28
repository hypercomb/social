const { createHash } = require('node:crypto')
const { createServer } = require('node:http')
const { mkdtempSync, readdirSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const disk = require('./disk.cjs')

const scratch = []
const servers = []

test.afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const workspace = () => {
  const dir = mkdtempSync(join(tmpdir(), 'intelligence-'))
  scratch.push(dir)
  return dir
}

const host = (bodies) => new Promise((resolve) => {
  const seen = []
  const server = createServer((request, response) => {
    seen.push(request.url ?? '')
    const hash = (request.url ?? '').replace(/^\//, '')
    const body = bodies[hash]
    if (!body) {
      response.writeHead(404)
      response.end()
      return
    }
    response.writeHead(200)
    response.end(body)
  })
  servers.push(server)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    resolve({ base: `http://127.0.0.1:${address.port}`, seen })
  })
})

test('writes the same group document the granted folder writes', () => {
  const root = workspace()
  disk.addGroup(root, 'lineage-of-science', 'The public proofs the community stamps')
  assert.equal(
    readFileSync(join(root, 'lineage-of-science', 'group.json'), 'utf8'),
    '{\n  "kind": "intelligence-group",\n  "name": "lineage-of-science",\n  "problem": "The public proofs the community stamps"\n}\n',
  )
  assert.equal(readdirSync(join(root, 'lineage-of-science')).includes('refs.jsonl'), false)
})

test('hashes the canonical arguments and stores the domain as the pool member label', () => {
  const root = workspace()
  disk.addGroup(root, 'Axial navigation', 'which step to offer')
  const ref = disk.rememberArguments(root, 'axial-navigation', 'jwize.com', {
    op: 'scroll', pose: { step: { q: 1, r: 0 } }, delta: 1,
  })

  assert.equal(ref.hash, disk.hashArguments({ delta: 1, pose: { step: { r: 0, q: 1 } }, op: 'scroll' }))
  assert.equal(disk.poolMeaning('Axial navigation'), 'intelligence:axial-navigation')
  assert.deepEqual(disk.refs(root, 'axial-navigation'), [{ domain: 'jwize.com', hash: ref.hash, answer: ref.hash }])
  const member = join(root, disk.poolAddress('axial-navigation'), ref.hash)
  assert.equal(readFileSync(member, 'utf8'), `jwize.com\n${ref.hash}\n`)
  assert.equal(readFileSync(member, 'utf8').includes('"op"'), false)
})

test('keeps each problem in its own group and does not repeat a ref', () => {
  const root = workspace()
  disk.addGroup(root, 'proofs', 'the public proofs')
  disk.addGroup(root, 'navigation', 'the offered step')
  const hash = 'a'.repeat(64)
  disk.remember(root, 'proofs', 'jwize.com', hash)
  disk.remember(root, 'proofs', 'jwize.com', hash)

  assert.deepEqual(disk.listGroups(root).map((group) => group.name).sort(), ['navigation', 'proofs'])
  assert.equal(disk.refs(root, 'proofs').length, 1)
  assert.equal(disk.refs(root, 'navigation').length, 0)
})

test('get reads the pool member and does not call a host when the member is absent', async () => {
  const root = workspace()
  disk.addGroup(root, 'lineage-of-science', 'The public proofs the community stamps')
  const args = { name: 'synthesia' }
  const hash = disk.hashArguments(args)
  const bytes = Buffer.from(disk.canonical(args))
  const { base, seen } = await host({ [hash]: bytes })

  await assert.rejects(() => disk.get(root, 'lineage-of-science', args, { base }), /no member in intelligence:lineage-of-science/)
  assert.equal(seen.length, 0)

  disk.rememberArguments(root, 'lineage-of-science', 'jwize.com', { name: 'synthesia' })
  assert.deepEqual(await disk.get(root, 'lineage of science', args, { base }), bytes)
  assert.deepEqual(seen, [`/${hash}`])
})

test('get fetches the answer signature, not the arguments hash', async () => {
  const root = workspace()
  disk.addGroup(root, 'lineage-of-science', 'The public proofs the community stamps')
  const args = { name: 'synthesia' }
  const answer = Buffer.from('the public proof\n')
  const answerHash = createHash('sha256').update(answer).digest('hex')
  const { base, seen } = await host({ [answerHash]: answer })
  disk.rememberArguments(root, 'lineage-of-science', 'example.com', args, answerHash)
  assert.notEqual(answerHash, disk.hashArguments(args))
  assert.deepEqual(await disk.get(root, 'lineage-of-science', args, { base }), answer)
  assert.deepEqual(seen, [`/${answerHash}`])
})

test('checks a pool member by recomputing s from the host', async () => {
  const root = workspace()
  disk.addGroup(root, 'lineage-of-science', 'The public proofs the community stamps')
  const args = { q: 1, r: 0, s: -1 }
  const body = Buffer.from(disk.canonical(args))
  const hash = createHash('sha256').update(body).digest('hex')
  disk.remember(root, 'lineage-of-science', 'example.com', hash)
  const { base } = await host({ [hash]: body })
  assert.equal(disk.hashArguments(args), hash)
  assert.deepEqual(await disk.check(root, 'lineage-of-science', args, { base }), { q: 1, r: 0, s: -1 })
})

test('keeps a cube record when s recomputes and refuses a difference that does not', async () => {
  const good = Buffer.from(disk.canonical({ q: 1, r: 0, s: -1 }))
  const bad = Buffer.from(disk.canonical({ q: 1, r: 0, s: 5 }))
  const name = Buffer.from(disk.canonical({ name: 'synthesia' }))
  const goodHash = createHash('sha256').update(good).digest('hex')
  const badHash = createHash('sha256').update(bad).digest('hex')
  const nameHash = createHash('sha256').update(name).digest('hex')
  const { base } = await host({ [goodHash]: good, [badHash]: bad, [nameHash]: name })

  assert.equal(disk.cubeS(1, 0), -1)
  assert.deepEqual(await disk.checkCube('example.com', goodHash, { base }), { q: 1, r: 0, s: -1 })
  await assert.rejects(() => disk.checkCube('example.com', badHash, { base }), /does not recompute/)
  await assert.rejects(() => disk.checkCube('example.com', nameHash, { base }), /finite q, r, and s/)
})

test('retrieves the resource from the host and refuses bytes that do not hash to the name', async () => {
  const bytes = Buffer.from('{"kind":"resource"}\n')
  const hash = createHash('sha256').update(bytes).digest('hex')
  const { base } = await host({ [hash]: bytes, [`${'b'.repeat(64)}`]: Buffer.from('other') })

  assert.equal(disk.resourceUrl('example.com', hash), `https://example.com/${hash}`)
  assert.deepEqual(await disk.retrieve('example.com', hash, { base }), bytes)
  await assert.rejects(() => disk.retrieve('example.com', 'b'.repeat(64), { base }), /do not hash/)
  await assert.rejects(() => disk.retrieve('example.com', 'c'.repeat(64), { base }), /answered 404/)
})

test('start sets the folder up, and a disconnected folder asks for a reset', () => {
  const parent = workspace()
  const root = join(parent, 'intelligence')
  const first = disk.start(root)
  assert.equal(first.kind, 'started')
  assert.equal(disk.start(root).already, true)

  rmSync(root, { recursive: true, force: true })
  const gone = disk.start(root)
  assert.equal(gone.kind, 'reset')
  assert.equal(gone.reason, 'disconnected')
  assert.equal(disk.notice(gone).includes('Reset the folder'), true)
  assert.equal(require('node:fs').existsSync(root), false)

  const deny = () => { const error = new Error('denied'); error.code = 'EACCES'; throw error }
  require('node:fs').mkdirSync(root)
  const refused = disk.start(root, { probe: deny })
  assert.equal(refused.reason, 'rights')
  assert.equal(disk.notice(refused).includes('did not give up its rights'), true)
  assert.throws(() => disk.reset(root, { probe: deny }), /will not delete it/)
})

test('a shifted copy and a rotated copy share one canon', () => {
  assert.deepEqual(disk.canonCoords([{ q: 7, r: -2 }]), [{ q: 0, r: 0 }])
  const horizontal = disk.canonCoords([{ q: 0, r: 0 }, { q: 1, r: 0 }])
  const shifted = disk.canonCoords([{ q: 5, r: 3 }, { q: 6, r: 3 }])
  const vertical = disk.canonCoords([{ q: 0, r: 0 }, { q: 0, r: 1 }])
  assert.deepEqual(shifted, horizontal)
  assert.deepEqual(vertical, horizontal)
  assert.equal(disk.canonical(horizontal), '[{"q":0,"r":0},{"q":0,"r":1}]')
  assert.equal(
    disk.canonical({
      coords: disk.canonCoords([{ q: 9, r: -4 }]),
      kind: 'pattern',
      step: { q: 1, r: 0 },
    }),
    '{"coords":[{"q":0,"r":0}],"kind":"pattern","step":{"q":1,"r":0}}',
  )
})

test('graph names the scroll edge and skips a name and a cube', async () => {
  const root = workspace()
  disk.addGroup(root, 'lineage-of-science', 'The public proofs the community stamps')
  const pattern = {
    coords: disk.canonCoords([{ q: 3, r: 1 }]),
    kind: 'pattern',
    step: { q: 1, r: 0 },
  }
  const on = disk.hashArguments(pattern)
  const attribute = {
    kind: 'use',
    op: 'scroll',
    pose: { step: { q: 1, r: 0 } },
    param: 'offset',
    delta: 1,
    on,
  }
  const text = disk.canonical(attribute)
  assert.equal(text.includes('author'), false)
  assert.equal(text.includes('clock'), false)
  assert.equal(Object.hasOwn(JSON.parse(text), 'out'), false)
  const name = { name: 'synthesia' }
  const cube = { q: 1, r: 0, s: -1 }
  const bodies = {}
  for (const value of [pattern, attribute, name, cube]) {
    const body = disk.canonical(value)
    bodies[disk.hashArguments(value)] = Buffer.from(body)
  }
  disk.rememberArguments(root, 'lineage-of-science', 'example.com', name)
  disk.rememberArguments(root, 'lineage-of-science', 'example.com', cube)
  disk.rememberArguments(root, 'lineage-of-science', 'example.com', attribute)
  const { base } = await host(bodies)
  assert.equal((await disk.retrieve('example.com', on, { base })).toString('utf8'), disk.canonical(pattern))
  assert.deepEqual(await disk.graph(root, 'lineage-of-science', { base }), [{
    on,
    op: 'scroll',
    pose: { step: { q: 1, r: 0 } },
    param: 'offset',
    delta: 1,
  }])
  await assert.rejects(
    () => disk.checkCube('example.com', disk.hashArguments(attribute), { base }),
    /finite q, r, and s/,
  )
  assert.equal(disk.attributeEdge(name), null)
  assert.equal(disk.attributeEdge(cube), null)
  assert.throws(() => disk.attributeEdge({ ...attribute, author: 'ada' }), /author/)
})

test('passivates groups under the Windows intelligence directory', () => {
  assert.equal(
    disk.intelligenceRoot({ LOCALAPPDATA: 'C:\\Users\\Ada\\AppData\\Local' }),
    'C:\\Users\\Ada\\AppData\\Local\\hypercomb\\intelligence',
  )
  assert.throws(() => disk.intelligenceRoot({}), /LOCALAPPDATA/)
  assert.equal(disk.canonical({ b: 1, a: [true, 'x'] }), '{"a":[true,"x"],"b":1}')
})
