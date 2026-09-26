#!/usr/bin/env node
// THE VERSION POOL. Every pure build is a signed record kept in the
// sign('host:builds') pool, chained to the build before it, so a release's
// history is held the hypercomb way: by signature, on any device that keeps
// the pool, with no forge in the middle.
//
//   { name: 'build', version, parent, install, host, library, hostPackage, source }
//
// `install` and `source` are layers ({ name, files: { path: sig } }) of the
// origin's own files and of every source file the build read; each file, each
// layer and each record is written to the pool under its signature. A version
// is year.month.day.n (UTC): n counts the builds of that day. A build that
// changes nothing mints no version, so every version is a group of changes.
//
// The pool's `head` names the newest record. A participant who vouches for a
// build signs its signature; the record never carries its own signatures.
//
//   node host/builds.mjs            the chain from head, with what each changed
//   node host/builds.mjs <version>  one build's changed files
//
// HYPERCOMB_BUILDS_DIR overrides the pool (default ~/.hypercomb/<sign(meaning)>).
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUILDS_MEANING = 'host:builds'
const sign = bytes => createHash('sha256').update(bytes).digest('hex')
export const buildsPool = () =>
  resolve(process.env.HYPERCOMB_BUILDS_DIR || resolve(homedir(), '.hypercomb', sign(BUILDS_MEANING)))

const keep = async (pool, bytes) => {
  const sig = sign(bytes)
  await writeFile(resolve(pool, sig), bytes, { flag: 'wx' }).catch(e => { if (e.code !== 'EEXIST') throw e })
  return sig
}
const read = async (pool, sig) => sig ? JSON.parse(await readFile(resolve(pool, sig), 'utf8')) : null
const head = async pool => (await readFile(resolve(pool, 'head'), 'utf8').catch(() => '')).trim() || null

/** A layer of files: each file kept under its signature, the layer names them by path. */
const layer = async (pool, name, files) => {
  const named = {}
  for (const [path, bytes] of [...files].sort(([a], [b]) => a < b ? -1 : 1)) named[path] = await keep(pool, bytes)
  return keep(pool, Buffer.from(JSON.stringify({ name, files: named })))
}

const versionAfter = (parent, now) => {
  const day = `${now.getUTCFullYear()}.${now.getUTCMonth() + 1}.${now.getUTCDate()}`
  const n = parent?.version?.startsWith(day + '.') ? Number(parent.version.slice(day.length + 1)) + 1 : 1
  return `${day}.${n}`
}

/**
 * Record a build. `install` and `source` map path → bytes; `signed` holds the
 * origin's signature-named atoms. Returns the record's signature and bytes,
 * and whether a new version was minted.
 */
export const recordBuild = async ({ install, source, signed, host, library, hostPackage, now = new Date() }) => {
  const pool = buildsPool()
  await mkdir(pool, { recursive: true })
  for (const bytes of signed) await keep(pool, bytes)
  const parentSig = await head(pool)
  const parent = await read(pool, parentSig)
  const parts = {
    install: await layer(pool, 'install', install),
    host, library, hostPackage,
    source: await layer(pool, 'source', source),
  }
  if (parent && Object.entries(parts).every(([k, v]) => parent[k] === v)) {
    return { sig: parentSig, record: parent, bytes: await readFile(resolve(pool, parentSig)), minted: false, pool }
  }
  const record = { name: 'build', version: versionAfter(parent, now), parent: parentSig, ...parts }
  const bytes = Buffer.from(JSON.stringify(record))
  const sig = await keep(pool, bytes)
  await writeFile(resolve(pool, 'head'), sig + '\n', 'utf8')
  return { sig, record, bytes, minted: true, pool }
}

/** What a build changed against its parent: parts, and files by path. */
export const changesOf = async (pool, record) => {
  const parent = await read(pool, record.parent)
  const parts = ['install', 'host', 'library', 'hostPackage', 'source'].filter(k => record[k] !== parent?.[k])
  const files = {}
  for (const k of ['install', 'source']) {
    if (!parts.includes(k)) continue
    const now = (await read(pool, record[k])).files
    const was = parent ? (await read(pool, parent[k])).files : {}
    files[k] = [...new Set([...Object.keys(now), ...Object.keys(was)])].sort()
      .filter(p => now[p] !== was[p])
      .map(p => (!was[p] ? '+ ' : !now[p] ? '- ' : '~ ') + p)
  }
  return { parts, files }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = buildsPool()
  const want = process.argv[2]
  let sig = await head(pool)
  if (!sig) { console.log(`no builds in ${pool}`); process.exit(0) }
  while (sig) {
    const record = await read(pool, sig)
    const { parts, files } = await changesOf(pool, record)
    if (!want) {
      const count = Object.values(files).reduce((n, f) => n + f.length, 0)
      console.log(`${record.version.padEnd(14)} ${sig.slice(0, 12)}  ${parts.join(' ')}${count ? ` · ${count} files` : ''}`)
    } else if (record.version === want || sig.startsWith(want)) {
      console.log(`${record.version} ${sig}\n  parent ${record.parent ?? '(none)'}\n  changed ${parts.join(' ')}`)
      for (const [k, list] of Object.entries(files)) for (const line of list) console.log(`  ${k.padEnd(7)} ${line}`)
      break
    }
    sig = record.parent
  }
}
