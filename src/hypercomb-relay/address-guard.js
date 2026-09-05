// Destination screening for host-initiated fetches.
//
// `POST /replicate` hands the host a list of caller-named origins and asks it
// to GET them. Authorization proves WHO is asking; it says nothing about WHERE
// they pointed the host. Without a destination filter an authorized writer can
// aim the relay at the operator's own network — a cloud metadata endpoint
// (169.254.169.254), an admin service on loopback, a database on 10/8 — and
// read the reply through the replication result. The signature check does not
// help: it decides whether bytes are KEPT, not whether the request was MADE.
//
// So the address, not the hostname string, is the thing screened. A hostname
// is a rented pointer; `internal.example` resolving to 10.0.0.5 is the same
// attack as writing 10.0.0.5. `guardedLookup` therefore screens inside the
// socket's own name resolution, which closes the DNS-rebinding window that a
// resolve-then-connect check leaves open: the address the guard clears is
// exactly the address the socket connects to.

import { lookup as dnsLookup } from 'node:dns'
import { isIP } from 'node:net'

/** A destination the host refused to connect to. Carries the resolved address
 * so an operator reading a log can see WHY a source was refused. */
export class BlockedAddressError extends Error {
  constructor(hostname, address, reason) {
    super(`refused ${hostname} — ${address} is ${reason}`)
    this.name = 'BlockedAddressError'
    this.hostname = hostname
    this.address = address
    this.reason = reason
  }
}

const ipv4Number = (text) => {
  const parts = String(text).split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^[0-9]{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = (value * 256) + octet
  }
  return value >>> 0
}

// A network is `base/prefix`; an address belongs when the leading `prefix`
// bits match. Every prefix here is <= 24, so the shift is always well defined.
const IPV4_NETWORKS = [
  ['0.0.0.0', 8, 'an unspecified address'],
  ['10.0.0.0', 8, 'a private address'],
  ['100.64.0.0', 10, 'a carrier-grade NAT address'],
  ['127.0.0.0', 8, 'a loopback address'],
  ['169.254.0.0', 16, 'a link-local address'],
  ['172.16.0.0', 12, 'a private address'],
  ['192.0.0.0', 24, 'an IETF protocol assignment'],
  ['192.168.0.0', 16, 'a private address'],
  ['198.18.0.0', 15, 'a benchmarking address'],
  ['224.0.0.0', 4, 'a multicast address'],
  ['240.0.0.0', 4, 'a reserved address'],
].map(([base, prefix, reason]) => [ipv4Number(base), prefix, reason])

function classifyIPv4Number(value) {
  for (const [base, prefix, reason] of IPV4_NETWORKS) {
    if ((value >>> (32 - prefix)) === (base >>> (32 - prefix))) return reason
  }
  return null
}

/** Expand one half of an IPv6 literal into 16-bit groups, treating a trailing
 * dotted quad (`::ffff:10.0.0.1`) as the two groups it stands for. */
function hextets(part) {
  if (!part) return []
  const groups = []
  for (const item of part.split(':')) {
    if (item.includes('.')) {
      const quad = ipv4Number(item)
      if (quad === null) return null
      groups.push((quad >>> 16) & 0xffff, quad & 0xffff)
    } else {
      if (!/^[0-9a-fA-F]{1,4}$/.test(item)) return null
      groups.push(parseInt(item, 16))
    }
  }
  return groups
}

function ipv6Groups(text) {
  const value = String(text).split('%')[0]
  const halves = value.split('::')
  if (halves.length > 2) return null
  const head = hextets(halves[0])
  const tail = halves.length === 2 ? hextets(halves[1]) : []
  if (!head || !tail) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const fill = 8 - head.length - tail.length
  if (fill < 1) return null
  return [...head, ...Array(fill).fill(0), ...tail]
}

const embeddedIPv4 = (groups) => (((groups[6] << 16) | groups[7]) >>> 0)

/** The reason this address must not be connected to, or null when it is an
 * ordinary public destination. Unparseable input is refused, not waved
 * through — a screen that cannot read its input has not cleared anything. */
export function classifyBlockedAddress(address) {
  const text = String(address ?? '').trim()
  const version = isIP(text)
  if (version === 4) return classifyIPv4Number(ipv4Number(text))
  if (version !== 6) return 'not a resolved IP address'

  const groups = ipv6Groups(text)
  if (!groups) return 'an unreadable address'

  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::/96) are IPv4 destinations
  // wearing an IPv6 spelling; screen the address they actually reach.
  const zeroTo5 = groups.slice(0, 6).every(group => group === 0)
  if (zeroTo5 || (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff)) {
    const value = embeddedIPv4(groups)
    if (zeroTo5 && value === 0) return 'an unspecified address'
    if (zeroTo5 && value === 1) return 'a loopback address'
    // ::a.b.c.d is the deprecated IPv4-compatible form; no public host needs it.
    return classifyIPv4Number(value) ?? (zeroTo5 ? 'a deprecated IPv4-compatible address' : null)
  }
  if (groups[0] === 0x64 && groups[1] === 0xff9b) return classifyIPv4Number(embeddedIPv4(groups))

  const first = groups[0]
  if ((first & 0xfe00) === 0xfc00) return 'a unique-local address'
  if ((first & 0xffc0) === 0xfe80) return 'a link-local address'
  if ((first & 0xff00) === 0xff00) return 'a multicast address'
  return null
}

/** A `dns.lookup` replacement for `net`/`tls` connect options. Screening HERE
 * rather than before the request is what makes the guard rebinding-proof: the
 * socket connects to the very address this callback cleared. */
export function guardedLookup(allowPrivate = false) {
  return (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback
    const settings = typeof options === 'function' ? {} : (options || {})
    dnsLookup(hostname, { ...settings, all: true }, (error, resolved) => {
      if (error) return done(error)
      const addresses = Array.isArray(resolved) ? resolved : [resolved]
      if (!addresses.length) return done(new Error(`no address for ${hostname}`))
      if (!allowPrivate) {
        for (const entry of addresses) {
          const reason = classifyBlockedAddress(entry.address)
          if (reason) return done(new BlockedAddressError(hostname, entry.address, reason))
        }
      }
      if (settings.all) return done(null, addresses)
      done(null, addresses[0].address, addresses[0].family)
    })
  }
}

/** Pre-flight screen for a source URL, so a caller learns at request time that
 * a destination is refused instead of reading an empty job later.
 *
 * A host that does not resolve is NOT refused here: the answer is unknown, and
 * `guardedLookup` screens it again at connect time anyway. Refusing on a DNS
 * blip would turn a transient outage into a rejected job for no security gain.
 * Returns the reason the source is refused, or null. */
export async function blockedSourceReason(source, allowPrivate = false) {
  if (allowPrivate) return null
  let hostname
  try { hostname = new URL(source).hostname } catch { return 'source is not a URL' }
  // A URL keeps IPv6 literals in brackets; the screen wants the address.
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  if (isIP(bare)) {
    const reason = classifyBlockedAddress(bare)
    return reason ? `${source} is refused — ${bare} is ${reason}` : null
  }
  const addresses = await new Promise(resolve => {
    dnsLookup(bare, { all: true }, (error, resolved) => resolve(error ? [] : resolved))
  })
  for (const entry of addresses) {
    const reason = classifyBlockedAddress(entry.address)
    if (reason) return `${source} is refused — it resolves to ${entry.address}, ${reason}`
  }
  return null
}

/** Screen a whole source list, reporting the first refusal. An origin the
 * operator explicitly allowed is exempt: they chose that destination, so it is
 * not the caller-chosen-destination threat the screen exists for. */
export async function blockedSourcesReason(sources, allowPrivate = false, allowedOrigins = new Set()) {
  for (const source of sources) {
    let origin = null
    try { origin = new URL(source).origin } catch { /* the screen will say so */ }
    if (origin && allowedOrigins.has(origin)) continue
    const reason = await blockedSourceReason(source, allowPrivate)
    if (reason) return reason
  }
  return null
}
