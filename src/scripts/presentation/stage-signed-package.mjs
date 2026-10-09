// Stage the PUBLISHED package into a built host, by replication.
//
// hypercomb.com used to mint its own package from whatever source tree ran the
// deploy, so its host:packages pool offered a root nobody had signed and a
// client following the publisher refused it. A host carries what the
// publisher signed, not what the deploying machine happened to build: read the
// publisher's signed index, take its install:<channel> root, replicate that
// root's closure (every atom sha256-verified before it is written) and list it
// in the host's packages pool.
//
//   node scripts/presentation/stage-signed-package.mjs <built-host-dir> --from <origin> [--from <origin>]
//
// The publisher (key and channel) is the one the package names:
// hypercomb-essentials/src/sharing/install-publisher.json.

import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { verifyEvent } from 'nostr-tools/pure'
import {
  HOST_PACKAGES_POOL, contentDirectoryIO, publishReplicatedPackage, resolvePackageClosure,
} from '../../hypercomb-relay/replicate.js'

const SIG = /^[a-f0-9]{64}$/
const INDEX_KIND = 30564
const here = resolve(import.meta.dirname)
const hostDir = resolve(process.argv[2] ?? '')
const sources = process.argv.flatMap((value, i) => value === '--from' ? [process.argv[i + 1]] : [])
  .filter(Boolean).map(origin => new URL(origin).origin)
if (!process.argv[2] || !sources.length) {
  throw new Error('usage: stage-signed-package.mjs <built-host-dir> --from <origin> [--from <origin>]')
}
await readFile(resolve(hostDir, 'pin')) // a built host, never a source path

const publisher = JSON.parse(await readFile(
  resolve(here, '..', '..', 'hypercomb-essentials', 'src', 'sharing', 'install-publisher.json'), 'utf8'))
const pubkey = String(publisher.pubkey ?? '').toLowerCase()
const channel = String(publisher.channel ?? 'essentials')
if (!SIG.test(pubkey)) throw new Error('install-publisher.json names no publisher key')

// The signed index, from every host that serves it; the first that verifies
// against the pinned key answers. A forged copy is fatal, never skipped.
// The zone root answers the index (hypercomb.com's apex is a static site, so
// pluginthematrix.com leads); the content.<zone> faces stay as read fallbacks
// for what older publishes left there.
const indexHosts = [...new Set(['pluginthematrix.com', ...(publisher.hosts ?? []), 'content.hypercomb.com'])]
let root = null
for (const host of indexHosts) {
  let event
  try {
    const response = await fetch(`https://${host}/hive/${pubkey}`, { cache: 'no-store' })
    if (!response.ok) continue
    event = await response.json()
  } catch { continue }
  if (event?.kind !== INDEX_KIND || event?.pubkey !== pubkey || !verifyEvent(event)) {
    throw new Error(`${host} serves an index that is not ${pubkey.slice(0, 12)}…'s — refusing to stage`)
  }
  const named = String(JSON.parse(event.content)?.roots?.[`install:${channel}`] ?? '').toLowerCase()
  if (SIG.test(named)) { root = named; console.log(`[stage] ${host} — the signed install:${channel} is ${named.slice(0, 12)}…`); break }
}
if (!root) throw new Error(`no host served a verified index naming install:${channel}`)

const content = resolve(hostDir, 'content')
const result = await resolvePackageClosure(root, contentDirectoryIO(content, sources))
console.log(`[stage] closure: ${result.held.length} held (${result.fetched} fetched, ${result.present} present), ` +
  `${result.holes.length} holes, ${result.refused.length} refused`)
const listed = publishReplicatedPackage(content, { signature: root, package: { label: channel } }, result)
if (!listed) throw new Error('the closure is incomplete — the package is not listed')

// A static host answers the pool directory with its own listing file: one
// entry name per line (host-packages-pool.md, "The directory branch"). Azure
// reads the same bytes as listing.txt.
const poolDir = resolve(content, HOST_PACKAGES_POOL)
const names = (await readdir(poolDir)).filter(name => /^[0-9]{8}$/.test(name)).sort()
const listing = `${names.join('\n')}\n`
await writeFile(resolve(poolDir, 'index.html'), listing)
await writeFile(resolve(poolDir, 'listing.txt'), listing)
console.log(`[stage] ${root.slice(0, 12)}… listed as ${listed.name} (${channel})`)
