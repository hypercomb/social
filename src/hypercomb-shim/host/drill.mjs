#!/usr/bin/env node
// host/drill.mjs — THE REPLICATION DRILL. The minimal host's code lives only
// through replication: no forge holds it, so a follower must be able to stand
// in for the origin entirely. This is that claim, tested end to end the way it
// would happen: an origin authors and promotes, a follower receives, the
// origin is WIPED, and a fresh device brings everything back from the follower
// alone.
//
//   node host/drill.mjs            # after the package is built (npm run build:module)
//   node host/drill.mjs --keep     # leave the drill's folders for inspection
//
// Every role runs the real tools as its own process with its own pools, like
// separate machines: builds.mjs for the version pools, copy-content.ts for the
// package as a host serves it, build.mjs --pure for the minimal host itself.
// Nothing here is a second implementation of replication — it only drives the
// tools and compares what arrived. Exits non-zero until every requirement
// holds; a requirement that fails today is the work still owed, stated as a
// check rather than as a note.

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SHIM = resolve(HERE, '..')
const ESSENTIALS = resolve(SHIM, '..', 'hypercomb-essentials')
const KEEP = process.argv.includes('--keep')
const SIG = /^[0-9a-f]{64}$/
const sign = bytes => createHash('sha256').update(bytes).digest('hex')
const poolOf = meaning => createHash('sha256').update(meaning, 'utf8').digest('hex')

// ── running the tools as separate machines ───────────────────────────────────
const run = (label, args, env, cwd = SHIM) => {
  const r = spawnSync(process.execPath, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 << 20 })
  if (r.status !== 0) throw new Error(`${label} failed:\n${(r.stderr || r.stdout).trim().split('\n').slice(-6).join('\n')}`)
  return r.stdout
}
const builds = (pools, ...args) => run(`builds.mjs ${args[0]}`, [resolve(HERE, 'builds.mjs'), ...args], { HYPERCOMB_POOLS_DIR: pools })
const tsx = resolve(SHIM, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs')

/** Every file under `dir`, path → sha256, so two hosts can be compared exactly. */
const inventory = async dir => {
  const out = new Map()
  const walk = async d => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else out.set(relative(dir, p).split('\\').join('/'), sign(await readFile(p)))
    }
  }
  await walk(dir)
  return out
}

/** Serve a directory the way a static host does, on a free port. */
const serve = async dir => {
  const port = 20000 + Math.floor(Math.random() * 20000)
  const child = spawn(process.execPath, [resolve(HERE, 'serve.mjs'), dir, String(port)], { stdio: 'ignore' })
  for (let i = 0; i < 50; i++) {
    const ok = await fetch(`http://localhost:${port}/`).then(r => r.status < 500, () => false)
    if (ok) return { url: `http://localhost:${port}`, stop: () => child.kill() }
    await new Promise(r => setTimeout(r, 100))
  }
  child.kill()
  throw new Error(`could not serve ${dir}`)
}

// ── the checklist ────────────────────────────────────────────────────────────
const results = []
const check = async (name, fn) => {
  try {
    const detail = await fn()
    results.push({ name, ok: true, detail })
  } catch (e) {
    results.push({ name, ok: false, detail: e.message })
  }
}
const must = (cond, message) => { if (!cond) throw new Error(message) }

const root = await mkdtemp(resolve(tmpdir(), 'hc-drill-'))
const at = (...p) => resolve(root, ...p)
const stops = []
try {
  // An author key, as a participant's hive holds one.
  const { generateSecretKey } = await import('nostr-tools/pure')
  const KEY = Buffer.from(generateSecretKey()).toString('hex')
  const origin = { pools: at('origin', 'pools'), out: at('origin', 'out'), host: at('origin', 'host') }

  // ── 1. THE ORIGIN AUTHORS ─────────────────────────────────────────────────
  // The package as a host serves it: copy-content into the origin's content
  // directory (the relay's, additive) — the same step every build ships with.
  run('copy-content', [tsx, resolve(ESSENTIALS, 'scripts', 'copy-content.ts')], {
    HYPERCOMB_WEB_CONTENT_DIR: at('origin', 'web-feed'), HYPERCOMB_RELAY_CONTENT_DIR: origin.host,
  }, ESSENTIALS)
  // The minimal host, built pure; it stages itself and the package.
  run('build.mjs --pure', [resolve(SHIM, 'build.mjs'), '--pure'], { HYPERCOMB_POOLS_DIR: origin.pools, HYPERCOMB_HOST_OUT_DIR: origin.out })
  const follower = at('follower')
  await mkdir(follower, { recursive: true })
  builds(origin.pools, 'subscribe', follower)
  const signed = { HYPERCOMB_POOLS_DIR: origin.pools, HYPERCOMB_SIGNER_KEY: KEY }
  const promoteHost = run('promote host', [resolve(HERE, 'builds.mjs'), 'promote', 'host'], signed)
  const promotePkg = run('promote package', [resolve(HERE, 'builds.mjs'), 'promote', 'hypercomb-essentials'], signed)
  const version = text => /\b(\d{4}\.\d+\.\d+\.\d+)\b/.exec(text)?.[1]
  const hostVersion = version(promoteHost)
  const pkgVersion = version(promotePkg)
  must(hostVersion && pkgVersion, 'promotion did not report its versions')
  // The origin domain serves its host revision and the version pools too, as
  // `builds.mjs publish` ships them.
  builds(origin.pools, 'out', hostVersion, at('origin', 'origin-out'))
  run('carry pools', ['-e', `import(${JSON.stringify(resolve(HERE, 'builds.mjs'))}).then(b => b.carryPools(${JSON.stringify(origin.host)}, { atoms: true }))`], { HYPERCOMB_POOLS_DIR: origin.pools })
  for (const [path] of await inventory(at('origin', 'origin-out'))) {
    const to = resolve(origin.host, path)
    await mkdir(dirname(to), { recursive: true })
    await readFile(to).catch(async () => (await import('node:fs/promises')).copyFile(at('origin', 'origin-out', path), to))
  }
  // What the origin knew, before it is lost: the source it recorded.
  builds(origin.pools, 'source', hostVersion, at('expected', 'host-src'))
  builds(origin.pools, 'source', pkgVersion, at('expected', 'pkg-src'))
  const originServes = await inventory(origin.host)

  // ── 2. THE ORIGIN IS LOST ─────────────────────────────────────────────────
  await rm(at('origin'), { recursive: true, force: true })

  // ── 3. A FRESH DEVICE, FROM THE FOLLOWER ALONE ────────────────────────────
  const live = await serve(follower)
  stops.push(live.stop)
  const device = at('device', 'pools')
  const pulled = builds(device, 'pull', live.url)

  await check('the follower holds everything the origin served, byte for byte', async () => {
    const has = await inventory(follower)
    const missing = [...originServes].filter(([p]) => !has.has(p))
    const differ = [...originServes].filter(([p, h]) => has.has(p) && has.get(p) !== h)
    const top = list => [...new Set(list.map(([p]) => p.split('/')[0].slice(0, 12) + (p.includes('/') ? '/…' : '')))].slice(0, 8).join(', ')
    must(!differ.length, `${differ.length} file(s) differ: ${top(differ)}`)
    must(!missing.length, `${missing.length} of ${originServes.size} served file(s) never reached it — ${top(missing)}`)
    return `${originServes.size} files`
  })

  await check('a fresh device pulls the whole history from the follower, every file verified', async () => {
    must(/\d+ new file\(s\)/.test(pulled) && !/refused/.test(pulled), pulled.trim())
    const listing = builds(device)
    must(listing.includes(hostVersion) && listing.includes(pkgVersion), `the device does not list ${hostVersion} and ${pkgVersion}`)
    return pulled.trim().replace(/\s+/g, ' ')
  })

  await check('the minimal host restores from the device alone and passes check-pure', async () => {
    builds(device, 'out', hostVersion, at('device', 'origin'))
    run('check-pure', [resolve(HERE, 'check-pure.mjs')], { HYPERCOMB_HOST_OUT_DIR: at('device', 'origin') })
    return hostVersion
  })

  for (const [label, ver, expected] of [['host', hostVersion, 'host-src'], ['package', pkgVersion, 'pkg-src']]) {
    await check(`the ${label}'s source restores byte-identical to what the origin recorded`, async () => {
      builds(device, 'source', ver, at('device', expected))
      const want = await inventory(at('expected', expected))
      const got = await inventory(at('device', expected))
      const bad = [...want].filter(([p, h]) => got.get(p) !== h).map(([p]) => p)
      must(want.size > 0, 'the origin recorded no source')
      must(!bad.length && got.size === want.size, `${bad.length} file(s) missing or different, ${got.size - want.size} extra: ${bad.slice(0, 5).join(', ')}`)
      return `${want.size} files`
    })
  }

  await check('every promoted revision reaches the follower signed by its author, and the signature verifies', async () => {
    for (const ver of [hostVersion, pkgVersion]) {
      const shown = builds(device, 'show', ver)
      must(!/^\s*FORGED/m.test(shown), `${ver} carries a signature that does not verify`)
      must(/^\s*signed\s+author\s/m.test(shown), `${ver} reached the device with no verifying author signature`)
    }
    return 'author signatures verify on the device'
  })

  await check('an unsigned promotion never reaches a follower as history', async () => {
    const pools = at('unsigned', 'pools')
    const to = at('unsigned', 'follower')
    await mkdir(to, { recursive: true })
    run('copy-content', [tsx, resolve(ESSENTIALS, 'scripts', 'copy-content.ts')], {
      HYPERCOMB_WEB_CONTENT_DIR: at('unsigned', 'web'), HYPERCOMB_RELAY_CONTENT_DIR: at('unsigned', 'relay'),
    }, ESSENTIALS)
    builds(pools, 'package')
    builds(pools, 'subscribe', to)
    const r = spawnSync(process.execPath, [resolve(HERE, 'builds.mjs'), 'promote', 'hypercomb-essentials'], {
      cwd: SHIM, env: { ...process.env, HYPERCOMB_POOLS_DIR: pools, HYPERCOMB_SIGNER_KEY: '', HYPERCOMB_SIGNER_KEY_FILE: '' }, encoding: 'utf8',
    })
    const builds_ = (await readdir(resolve(to, poolOf('host:builds'))).catch(() => [])).filter(n => SIG.test(n))
    must(!builds_.length, `promotion without a key carried ${builds_.length} unsigned file(s) to the follower (exit ${r.status})`)
    return 'refused'
  })

  await check('a cold visitor to the follower discovers the package (host:packages names it)', async () => {
    const listing = await fetch(`${live.url}/${poolOf('host:packages')}/`).then(r => r.ok ? r.text() : '')
    must(listing.trim(), `the follower serves no ${poolOf('host:packages').slice(0, 12)}… (host:packages) pool — its front door would offer nothing`)
    return 'host:packages served'
  })

  await check('a device can author from its restored copy: change, build and promote a revision chained to the one it pulled', async () => {
    throw new Error('not yet possible — no path builds a package or host from a restored source tree alone')
  })
} catch (e) {
  results.push({ name: 'the drill ran to the end', ok: false, detail: e.message })
} finally {
  for (const stop of stops) stop()
  if (KEEP) console.log(`drill folders kept: ${root}`)
  else await rm(root, { recursive: true, force: true })
}

for (const { name, ok, detail } of results) console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `\n    ${detail.split('\n').join('\n    ')}` : ''}`)
const failed = results.filter(r => !r.ok).length
console.log(failed ? `\n${failed} of ${results.length} requirement(s) not met — replication is not yet seamless` : `\nall ${results.length} requirements met`)
process.exitCode = failed ? 1 : 0
