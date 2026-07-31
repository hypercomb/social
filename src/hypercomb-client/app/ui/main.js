// The whole point of this page: prove the native store is reachable from the
// renderer, that signatures round-trip, and that the canonicalization rules
// hold across the IPC boundary — not just inside Rust's own test suite.

import { nativeRoot } from './native-filesystem.js'

const { invoke } = window.__TAURI__.core
const root = document.getElementById('root')

let passed = 0
let failed = 0

const line = (state, name, detail) => {
  const row = document.createElement('div')
  row.className = 'row'
  row.innerHTML =
    `<span class="${state === 'ok' ? 'ok' : state === 'fail' ? 'fail' : 'note'}">` +
    `${state === 'ok' ? '✓' : state === 'fail' ? '✗' : '·'}</span>` +
    `<span>${name}</span><span class="note">${state === 'note' ? '' : state}</span>`
  root.append(row)
  if (detail) {
    const d = document.createElement('div')
    d.className = 'detail'
    d.textContent = detail
    root.append(d)
  }
}

const check = async (name, fn) => {
  try {
    const detail = await fn()
    passed++
    line('ok', name, detail)
  } catch (error) {
    failed++
    line('fail', name, String(error?.message ?? error))
  }
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const bytes = text => Array.from(new TextEncoder().encode(text))
const text = array => new TextDecoder().decode(new Uint8Array(array))

await check('hive opens on a real filesystem', async () => {
  const path = await invoke('hive_root')
  assert(path.length > 0, 'no hive root')
  return path
})

await check('content round-trips by signature', async () => {
  const sig = await invoke('content_put', { bytes: bytes('hello from the renderer') })
  assert(sig.length === 64, `expected a 64-hex signature, got ${sig.length} chars`)
  const back = await invoke('content_get', { sig })
  assert(text(back) === 'hello from the renderer', 'content did not round-trip')
  return sig
})

await check('identical content dedups to one signature', async () => {
  const a = await invoke('content_put', { bytes: bytes('same bytes') })
  const b = await invoke('content_put', { bytes: bytes('same bytes') })
  assert(a === b, 'identical content produced different signatures')
  return a
})

await check('the empty signature is the well-known root hash', async () => {
  const sig = await invoke('content_put', { bytes: [] })
  const expected = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  assert(sig === expected, `got ${sig}`)
  return sig
})

await check('absent content reads as null, not an error', async () => {
  const missing = await invoke('content_get', { sig: 'a'.repeat(64) })
  assert(missing === null, `expected null, got ${JSON.stringify(missing)?.slice(0, 40)}`)
  return 'null'
})

await check('a malformed signature is rejected, not silently absent', async () => {
  try {
    await invoke('content_get', { sig: 'nonsense' })
  } catch {
    return 'rejected'
  }
  throw new Error('a malformed signature was accepted')
})

await check('the host canonicalizes segments — one place, one bag', async () => {
  const spaced = await invoke('bag_address', { segments: ['Chapter 1'] })
  const hyphened = await invoke('bag_address', { segments: ['Chapter-1'] })
  assert(spaced === hyphened, 'equivalent names produced different bags')
  return spaced
})

await check('a symbol-only name does not collapse into the root', async () => {
  const bee = await invoke('bag_address', { segments: ['🐝'] })
  const rootBag = await invoke('bag_address', { segments: [] })
  assert(bee !== rootBag, 'the symbol-only guard is not holding across IPC')
  return bee
})

await check('append then head — the maximum marker is the head', async () => {
  const segments = ['host-check', 'place']
  const layer = await invoke('content_put', { bytes: bytes('{"name":"place"}') })
  const index = await invoke('bag_append', { segments, layer })
  const head = await invoke('bag_head', { segments })
  assert(head.layer === layer, 'head points at the wrong layer')
  assert(head.index === index, `head index ${head.index} != appended ${index}`)
  assert(head.legacy === false, 'a fresh append must be a pointer record')
  return `index ${head.index} → ${head.layer.slice(0, 16)}…`
})

await check('pools are addressed by meaning, not by a raw address', async () => {
  await invoke('pool_put', { meaning: 'clipboard', key: 'entry', bytes: bytes('clip') })
  const back = await invoke('pool_get', { meaning: 'clipboard', key: 'entry' })
  assert(text(back) === 'clip', 'pool member did not round-trip')
  const members = await invoke('pool_list', { meaning: 'clipboard' })
  assert(members.includes('entry'), 'pool listing is missing the member')
  return members.join(', ')
})

await check('an unregistered meaning registers on first use', async () => {
  const address = await invoke('pool_address', { meaning: 'renderer:invented' })
  assert(address.length === 64, 'no address minted')
  return address
})

await check('a colliding pool and bag stay separate through the boundary', async () => {
  // `bees` the pool and a tile named "bees" are ONE address. The renderer
  // cannot conflate them because it addresses them in different vocabularies.
  const pool = await invoke('pool_address', { meaning: 'bees' })
  const bag = await invoke('bag_address', { segments: ['bees'] })
  assert(pool === bag, 'precondition failed: these are supposed to collide')

  await invoke('pool_put', { meaning: 'bees', key: 'drone', bytes: bytes('bee bytes') })
  const layer = await invoke('content_put', { bytes: bytes('{"name":"bees"}') })
  await invoke('bag_append', { segments: ['bees'], layer })

  const member = await invoke('pool_get', { meaning: 'bees', key: 'drone' })
  const head = await invoke('bag_head', { segments: ['bees'] })
  assert(text(member) === 'bee bytes', 'pool member lost')
  assert(head.layer === layer, 'bag head lost')
  return `${pool.slice(0, 16)}… holds both`
})

await check('cold reads are fast enough to be on the render path', async () => {
  const segments = ['host-check', 'place']
  const started = performance.now()
  for (let i = 0; i < 500; i++) await invoke('bag_head', { segments })
  const each = (performance.now() - started) / 500
  assert(each < 5, `${each.toFixed(2)} ms per head lookup is too slow`)
  return `${each.toFixed(3)} ms per head lookup (500 round trips)`
})

// ---------------------------------------------------------------------------
// the handle shim — driven through the File System API surface itself, which
// is what the 44 unmodified shell files will actually call
// ---------------------------------------------------------------------------

const hive = nativeRoot()

await check('the shim presents a hive root', async () => {
  assert(hive !== null, 'no native root — is the bridge missing?')
  assert(hive.kind === 'directory', `kind was ${hive.kind}`)
  return 'root handle'
})

await check('getFileHandle + getFile reads content by signature', async () => {
  const sig = await invoke('content_put', { bytes: bytes('via the shim') })
  const handle = await hive.getFileHandle(sig)
  const file = await handle.getFile()
  const read = new TextDecoder().decode(await file.arrayBuffer())
  assert(read === 'via the shim', `got ${JSON.stringify(read)}`)
  assert(file.name === sig, 'the file should carry its signature as its name')
  return `${sig.slice(0, 16)}… (${file.size} bytes)`
})

await check('createWritable + close writes content', async () => {
  const payload = 'written through a writable stream'
  const expected = await invoke('content_put', { bytes: bytes(payload) })

  const handle = await hive.getFileHandle(expected, { create: true })
  const writable = await handle.createWritable()
  await writable.write(payload)
  await writable.close()

  const back = await invoke('content_get', { sig: expected })
  assert(text(back) === payload, 'content did not survive the writable')
  return expected.slice(0, 16) + '…'
})

await check('writing bytes that sign differently is REFUSED', async () => {
  // Content addressing means the name is determined by the bytes. Honouring a
  // mismatched name would silently corrupt the store.
  const handle = await hive.getFileHandle('b'.repeat(64), { create: true })
  const writable = await handle.createWritable()
  await writable.write('these bytes do not sign as bbbb…')
  try {
    await writable.close()
  } catch (error) {
    return String(error.message).slice(0, 60) + '…'
  }
  throw new Error('a mismatched signature name was accepted')
})

await check('a missing file throws NotFoundError, as OPFS does', async () => {
  try {
    await hive.getFileHandle('c'.repeat(64))
  } catch (error) {
    assert(error.name === 'NotFoundError', `threw ${error.name}, not NotFoundError`)
    return error.name
  }
  throw new Error('a missing file did not throw')
})

await check('a legacy typed folder reports absent, making drains no-ops', async () => {
  for (const legacy of ['__hive__', '__layers__', '__history__']) {
    try {
      await hive.getDirectoryHandle(legacy)
      throw new Error(`${legacy} unexpectedly exists`)
    } catch (error) {
      assert(error.name === 'NotFoundError', `${legacy} threw ${error.name}`)
    }
  }
  return 'all absent'
})

await check('a bag directory lists its markers as 8-digit names', async () => {
  const segments = ['shim-check', 'place']
  const layer = await invoke('content_put', { bytes: bytes('{"name":"place"}') })
  await invoke('bag_append', { segments, layer })

  const address = await invoke('bag_address', { segments })
  const dir = await hive.getDirectoryHandle(address)

  const names = []
  for await (const name of dir.keys()) names.push(name)
  assert(names.includes('00000000'), `markers were ${JSON.stringify(names)}`)

  const handle = await dir.getFileHandle('00000000')
  const record = JSON.parse(new TextDecoder().decode(await (await handle.getFile()).arrayBuffer()))
  assert(record.layer === layer, 'the marker points at the wrong layer')
  return names.join(', ')
})

await check('a pool directory lists its members by name', async () => {
  await invoke('pool_put', { meaning: 'clipboard', key: 'entry', bytes: bytes('clip') })
  const address = await invoke('pool_address', { meaning: 'clipboard' })
  const dir = await hive.getDirectoryHandle(address)

  const found = []
  for await (const [name] of dir.entries()) found.push(name)
  assert(found.includes('entry'), `members were ${JSON.stringify(found)}`)

  const handle = await dir.getFileHandle('entry')
  const read = new TextDecoder().decode(await (await handle.getFile()).arrayBuffer())
  assert(read === 'clip', `read ${JSON.stringify(read)}`)
  return found.join(', ')
})

await check('a colliding address lists markers AND pool members together', async () => {
  // `bees` the pool and a tile named "bees" are ONE directory. The shim never
  // classifies the directory — only each entry — so both show up.
  const layer = await invoke('content_put', { bytes: bytes('{"name":"bees"}') })
  await invoke('bag_append', { segments: ['bees'], layer })
  await invoke('pool_put', { meaning: 'bees', key: 'drone', bytes: bytes('bee bytes') })

  const address = await invoke('pool_address', { meaning: 'bees' })
  const dir = await hive.getDirectoryHandle(address)

  const names = []
  for await (const name of dir.keys()) names.push(name)
  assert(names.some(n => /^\d{8}$/.test(n)), `no marker in ${JSON.stringify(names)}`)
  assert(names.includes('drone'), `no pool member in ${JSON.stringify(names)}`)
  return names.join(', ')
})

await check('removeEntry on a pool member is a REAL delete', async () => {
  await invoke('pool_put', { meaning: 'clipboard', key: 'doomed', bytes: bytes('x') })
  const address = await invoke('pool_address', { meaning: 'clipboard' })
  const dir = await hive.getDirectoryHandle(address)

  await dir.removeEntry('doomed')
  const gone = await invoke('pool_get', { meaning: 'clipboard', key: 'doomed' })
  assert(gone === null, 'the pool member survived removal')
  return 'deleted'
})

await check('removeEntry on CONTENT is a no-op — history is never deleted', async () => {
  const sig = await invoke('content_put', { bytes: bytes('this must survive removal') })
  await hive.removeEntry(sig)
  const still = await invoke('content_get', { sig })
  assert(still !== null, 'content was deleted — the history graph is not safe')
  return 'content retained, as designed'
})

await check('the root enumerates content and sig-named directories', async () => {
  let files = 0
  let dirs = 0
  for await (const [, handle] of hive.entries()) {
    if (handle.kind === 'directory') dirs++
    else files++
  }
  assert(files > 0 && dirs > 0, `saw ${files} files, ${dirs} dirs`)
  return `${files} content entries, ${dirs} directories`
})

await check('a directory walk through the shim is fast enough', async () => {
  // OPFS code assumes near-free handle calls; each one here is an IPC round
  // trip. This is the number that decides whether batching is needed.
  const started = performance.now()
  let seen = 0
  for await (const _ of hive.keys()) seen++
  const elapsed = performance.now() - started
  assert(elapsed < 500, `${elapsed.toFixed(0)} ms to walk ${seen} entries`)
  return `${seen} entries in ${elapsed.toFixed(1)} ms`
})

await check('collection reclaims an orphan but keeps committed layers', async () => {
  const orphan = await invoke('content_put', { bytes: bytes('never committed ' + Math.random()) })
  const collected = await invoke('collect')
  assert(collected.swept >= 1, `swept ${collected.swept}`)
  assert(await invoke('content_get', { sig: orphan }) === null, 'the orphan survived')

  // And the committed layer from the bag check above is still there.
  const head = await invoke('bag_head', { segments: ['shim-check', 'place'] })
  assert(head !== null, 'a committed head was collected')
  assert(await invoke('content_has', { sig: head.layer }), 'a committed layer was collected')
  return `swept ${collected.swept}, kept ${collected.reachable} reachable`
})

const verdict = failed === 0
  ? `PASS ${passed} checks. The renderer is talking to a native hive.`
  : `FAIL ${passed} passed, ${failed} failed.`

const summary = document.getElementById('summary')
summary.textContent = verdict
summary.className = failed === 0 ? 'ok' : 'fail'

// Record the verdict IN the hive, so it can be read back from outside the
// window. A check nobody can see from the outside isn't a check — and the
// window's own pixels aren't reachable from a terminal.
try {
  await invoke('pool_put', {
    meaning: 'hostcheck:results',
    key: 'verdict',
    bytes: bytes(verdict),
  })
} catch (error) {
  summary.textContent = `${verdict}  (could not record verdict: ${error})`
  summary.className = 'fail'
}
