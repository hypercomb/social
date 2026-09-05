import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { blockedSourceReason, blockedSourcesReason, classifyBlockedAddress, guardedLookup } from './address-guard.js'

test('every address family that reaches the operator is refused', () => {
  const refused = {
    '127.0.0.1': 'loopback',
    '127.99.1.2': 'loopback',
    '169.254.169.254': 'link-local',
    '10.0.0.5': 'private',
    '172.16.4.4': 'private',
    '172.31.255.255': 'private',
    '192.168.1.1': 'private',
    '100.64.0.1': 'carrier-grade NAT',
    '100.127.255.254': 'carrier-grade NAT',
    '0.0.0.0': 'unspecified',
    '192.0.0.1': 'IETF protocol',
    '198.19.0.1': 'benchmarking',
    '224.0.0.1': 'multicast',
    '255.255.255.255': 'reserved',
    '::1': 'loopback',
    '::': 'unspecified',
    'fe80::1': 'link-local',
    'febf::1': 'link-local',
    'fc00::1': 'unique-local',
    'fd12:3456::1': 'unique-local',
    'ff02::1': 'multicast',
    // the same destinations wearing an IPv6 spelling
    '::ffff:127.0.0.1': 'loopback',
    '::ffff:169.254.169.254': 'link-local',
    '::ffff:10.1.2.3': 'private',
    '64:ff9b::127.0.0.1': 'loopback',
    '::127.0.0.1': 'loopback',
  }
  for (const [address, fragment] of Object.entries(refused)) {
    const reason = classifyBlockedAddress(address)
    assert.ok(reason, `${address} must be refused`)
    assert.match(reason, new RegExp(fragment), `${address} refused for the wrong reason: ${reason}`)
  }
})

test('ordinary public addresses pass', () => {
  for (const address of ['1.1.1.1', '8.8.8.8', '172.15.0.1', '172.32.0.1', '100.63.255.255', '100.128.0.1', '198.17.255.255', '2606:4700::1111', '2001:db8::1']) {
    assert.equal(classifyBlockedAddress(address), null, `${address} must pass`)
  }
})

test('anything that is not a resolved address is refused, never waved through', () => {
  for (const value of ['', null, undefined, 'example.com', '10.0.0', '999.1.1.1', 'not an address', '::ffff:999.1.1.1']) {
    assert.ok(classifyBlockedAddress(value), `${String(value)} must not be treated as a public address`)
  }
})

test('a source whose HOSTNAME resolves into private space is refused', async () => {
  // `localhost` is the one hostname guaranteed to resolve into loopback with no
  // network and no DNS control — a name, not a literal, so this exercises the
  // resolving path rather than the literal screen.
  assert.match(await blockedSourceReason('http://localhost:9/content'), /resolves to 127\.0\.0\.1|resolves to ::1/)
  assert.match(await blockedSourceReason('http://127.0.0.1:9'), /is a loopback address/)
  assert.match(await blockedSourceReason('http://[::1]:9'), /is a loopback address/)
  assert.match(await blockedSourceReason('http://169.254.169.254/latest/meta-data/'), /is a link-local address/)
})

test('the dev escape hatch clears every source, and an unresolvable host is left to connect time', async () => {
  assert.equal(await blockedSourceReason('http://127.0.0.1:9', true), null)
  // An unknown name is not a refusal: the screen has no answer, and the socket
  // lookup will screen it again. Refusing here would make a DNS blip fatal.
  assert.equal(await blockedSourceReason('http://this-host-does-not-exist.invalid/', false), null)
})

test('the socket lookup refuses a private address, so a rebinding answer never connects', async () => {
  const lookup = guardedLookup(false)
  const blocked = await new Promise(resolve => lookup('localhost', { all: false }, (error, address) => resolve({ error, address })))
  assert.equal(blocked.address, undefined)
  assert.equal(blocked.error?.name, 'BlockedAddressError')
  assert.match(blocked.error.message, /loopback/)

  const permitted = await new Promise(resolve => guardedLookup(true)('localhost', { all: false }, (error, address) => resolve({ error, address })))
  assert.equal(permitted.error, null)
  assert.ok(permitted.address)
})

test('a request carrying the guarded lookup never opens the socket', async () => {
  const server = createServer((req, res) => { res.writeHead(200); res.end('reached') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    const { request } = await import('node:http')
    const error = await new Promise(resolve => {
      const call = request(`http://localhost:${port}/`, { lookup: guardedLookup(false) }, response => { response.resume(); resolve(null) })
      call.on('error', resolve)
      call.end()
    })
    assert.equal(error?.name, 'BlockedAddressError')
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('the list screen skips operator-allowed origins and still catches the rest', async () => {
  const allowed = new Set(['http://127.0.0.1:9'])
  assert.equal(await blockedSourcesReason(['http://127.0.0.1:9/atoms'], false, allowed), null)
  assert.match(await blockedSourcesReason(['http://127.0.0.1:9', 'http://10.0.0.5'], false, allowed), /10\.0\.0\.5/)
  assert.match(await blockedSourcesReason(['http://localhost:9'], false, allowed), /resolves to/)
})
