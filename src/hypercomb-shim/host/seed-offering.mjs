#!/usr/bin/env node
// Stage one real, signed subdomain offering in a built host's meaning pool.
// This local proof tool writes only to the output directory passed explicitly.
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { verifyEvent } from 'nostr-tools/pure'

const [outArg, routeArg] = process.argv.slice(2)
if (!outArg || !routeArg) throw new Error('usage: seed-offering.mjs <built-host-dir> <https://subdomain/>')
const out = resolve(outArg)
await readFile(resolve(out, 'pin')) // require a built host, never a source path
const route = new URL(routeArg)
if (route.protocol !== 'https:' || route.pathname !== '/' || route.search || route.hash) {
  throw new Error('offering route must be an HTTPS subdomain root')
}

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
// The door describes itself in its own bag, sign(<hostname>): newest marker.
const bag = sha(route.hostname.toLowerCase())
const listing = await fetch(new URL(`/${bag}/`, route), { cache: 'no-store' })
if (!listing.ok) throw new Error(`door bag: HTTP ${listing.status}`)
const newest = (await listing.text()).split('\n').filter(name => /^[0-9]{8}$/.test(name)).sort().at(-1)
if (!newest) throw new Error('door bag holds no marker')
const marker = await fetch(new URL(`/${bag}/${newest}`, route))
if (!marker.ok) throw new Error(`door marker: HTTP ${marker.status}`)
const { pubkey, lineage, layer: head } = await marker.json()
if (![pubkey, head].every(value => /^[a-f0-9]{64}$/.test(String(value))) || !lineage) {
  throw new Error('the door record has no signed root coordinates')
}
const indexResponse = await fetch(new URL(`/hive/${pubkey}`, route), { cache: 'no-store' })
if (!indexResponse.ok) throw new Error(`publisher index: HTTP ${indexResponse.status}`)
const index = await indexResponse.json()
if (index.kind !== 30564 || index.pubkey !== pubkey || !verifyEvent(index)) {
  throw new Error('publisher index signature did not verify')
}
const content = JSON.parse(index.content)
if (content.roots?.[lineage] !== head) throw new Error('site root does not match signed index')
const doors = content.doors?.[lineage]
if (!Array.isArray(doors) || !doors.some(zone => route.hostname === zone || route.hostname.endsWith(`.${zone}`))) {
  throw new Error('signed index does not open this domain')
}
const rootResponse = await fetch(new URL(`/${head}`, route))
if (!rootResponse.ok || sha(Buffer.from(await rootResponse.arrayBuffer())) !== head) {
  throw new Error('published root bytes did not verify')
}

// This is a location entry. Advancing the site's signed head does not rename
// the pool member; its hashed hostname remains the address of its history.
const record = { kind: 'host:offering', title: String(site.title || lineage), route: route.href,
  lineage, pubkey, location: sha(Buffer.from(route.hostname)) }
const bytes = Buffer.from(JSON.stringify(record))
const member = sha(bytes)
const pool = sha(Buffer.from('host:offerings'))
const dir = resolve(out, pool)
await mkdir(dir, { recursive: true })
const listingPath = resolve(dir, 'index.html')
let previous = ''
try { previous = await readFile(listingPath, 'utf8') } catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const active = []
for (const name of previous.split(/\r?\n/).filter(value => /^[a-f0-9]{64}$/.test(value))) {
  const held = await readFile(resolve(dir, name))
  if (sha(held) !== name) throw new Error(`invalid existing offering ${name}`)
  const old = JSON.parse(held.toString('utf8'))
  if (old.pubkey !== pubkey || old.lineage !== lineage || old.route !== route.href) active.push(name)
}
// The offered hostname is a stable location. A static host exposes the same
// numbered marker wire as a live worker; older heads remain in the bag.
const locationDir = resolve(out, 'content', record.location)
await mkdir(locationDir, { recursive: true })
const markers = (await readdir(locationDir)).filter(name => /^\d{8}$/.test(name)).sort()
const latest = markers.at(-1)
const held = latest ? JSON.parse(await readFile(resolve(locationDir, latest), 'utf8')) : null
if (held && !/^[a-f0-9]{64}$/.test(String(held.layer))) throw new Error('invalid existing location marker')
if (held?.layer !== head) {
  const next = latest ? Number(latest) + 1 : 0
  if (!Number.isSafeInteger(next) || next > 99_999_999) throw new Error('location marker sequence exhausted')
  const name = String(next).padStart(8, '0')
  await writeFile(resolve(locationDir, name), JSON.stringify({ layer: head }), { flag: 'wx' })
  markers.push(name)
}
await writeFile(resolve(locationDir, 'index.html'), `${markers.join('\n')}\n`)
await writeFile(resolve(dir, member), bytes)
await writeFile(listingPath, `${[...new Set([...active, member])].sort().join('\n')}\n`)
console.log(`[host] ${record.title} at ${route.host} → ${head.slice(0, 12)}… in host:offerings`)
