// sandbox.spec.ts — A DRAFT'S BUILD RUNS IN A BOX. The box shows a step its
// own tree, its pools and the npm cache, writable, and nothing else of the
// machine; a fresh home and tmp; an environment of its own; the network only
// when the step may fetch. With bubblewrap here, the promise is tried for
// real: a probe inside the box reads what it can, and a box is ended whole.
// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { relative, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// @ts-ignore — plain ESM tooling, no declarations
import { bubblewrapSandbox, chooseSandbox, containerSandbox, noSandbox, noSandboxHere } from './sandbox.mjs'
// @ts-ignore — plain ESM tooling, no declarations
import { buildEnv, buildStep } from './builder.mjs'

/** Processes whose command line holds `marker`, read from /proc: no pgrep needed. */
const running = (marker: string): number => {
  let n = 0
  for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
    try { if (readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(marker)) n++ } catch { /* gone */ }
  }
  return n
}
const hasBwrap = process.platform === 'linux' && spawnSync('bwrap', ['--version'], { stdio: 'ignore' }).status === 0
  && spawnSync('bwrap', ['--unshare-all', '--ro-bind', '/usr', '/usr', '--ro-bind-try', '/lib', '/lib', '--ro-bind-try', '/lib64', '/lib64', '--ro-bind-try', '/bin', '/bin', '--', '/bin/true'], { stdio: 'ignore' }).status === 0

let root = ''
let step: { work: string; pools: string; cache: string; cwd: string; env: Record<string, string> }
beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), 'hc-sandbox-spec-'))
  const work = resolve(root, 'work'), pools = resolve(root, 'pools'), cache = resolve(root, 'cache')
  for (const dir of [work, resolve(work, 'src'), pools, cache]) spawnSync('mkdir', ['-p', dir])
  step = { work, pools, cache, cwd: resolve(work, 'src'), env: buildEnv(work, { PATH: process.env.PATH ?? '', HOME: homedir(), HYPERCOMB_SIGNER_KEY: 'deadbeef', NODE_EXTRA_CA_CERTS: resolve(root, 'ca.pem') }, { pools }) }
  await writeFile(resolve(root, 'ca.pem'), '')
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

const after = (list: string[], flag: string): string[] => list.flatMap((item, i) => item === flag ? [list[i + 1]!] : [])
const pairsAfter = (list: string[], flag: string): [string, string][] => list.flatMap((item, i) => item === flag ? [[list[i + 1]!, list[i + 2]!] as [string, string]] : [])

describe('bubblewrap composes the box', () => {
  it('writes only the tree, the pools and the cache; a fresh tmp and home; the system read-only; an environment of its own', () => {
    const { command, args, env } = bubblewrapSandbox({ execPath: '/opt/node22/bin/node', hostPath: '/opt/node22/bin:/usr/bin' }).wrap({ command: 'npm', args: ['ci'], network: false, ...step })
    expect(command).toBe('bwrap')
    expect(args).toContain('--unshare-all')
    expect(args).not.toContain('--share-net')
    // The box lays the cache's shadow, says it opened, then hands over to the command untouched.
    expect(args.slice(args.indexOf('--'))).toEqual(['--', '/bin/sh', '-c', expect.stringContaining('exec "$@"'), '[box] opened', step.cache, '/tmp/npm-cache', 'npm', 'ci'])
    // Writable: the tree and the pools, each at its own path, after the fresh /tmp.
    expect(pairsAfter(args, '--bind')).toEqual([[step.work, step.work], [step.pools, step.pools]])
    expect(args.indexOf('--tmpfs')).toBeLessThan(args.indexOf('--bind'))
    expect(after(args, '--tmpfs')).toEqual(['/tmp'])
    // Read-only: the system, the node's own programs and npm (never its whole prefix), the certificate the env names — never the home.
    const ro = pairsAfter(args, '--ro-bind-try').map(([from]) => from)
    expect(ro).toEqual(expect.arrayContaining(['/usr', '/lib', '/etc/resolv.conf', '/etc/ssl', '/opt/node22/bin', '/opt/node22/lib/node_modules/npm', resolve(root, 'ca.pem')]))
    expect(ro).not.toContain('/opt/node22')
    expect(ro).not.toContain(homedir())
    expect(args.some(a => a === homedir())).toBe(false)
    // The cache is read-only unless the step says: this one does not.
    expect(pairsAfter(args, '--ro-bind')).toEqual([[step.cache, step.cache]])
    expect(args).toContain('--clearenv')
    const set = Object.fromEntries(pairsAfter(args, '--setenv'))
    expect(set).toMatchObject({ HOME: '/tmp/home', TMPDIR: '/tmp', npm_config_cache: '/tmp/npm-cache', PATH: '/opt/node22/bin:/usr/bin', HYPERCOMB_POOLS_DIR: step.pools })
    expect(set['HYPERCOMB_SIGNER_KEY']).toBeUndefined()
    expect(after(args, '--chdir')).toEqual([step.cwd])
    expect(args).toContain('--die-with-parent')
    expect(env).toEqual({ PATH: '/opt/node22/bin:/usr/bin' })
  })

  it('shares the network, and writes the cache, only for the step that fetches; a node under /usr is bound once; its own bin comes first on PATH', () => {
    const fetching = bubblewrapSandbox({ execPath: '/usr/local/bin/node', hostPath: '/home/op/.volta/bin:/usr/bin', exists: (path: string) => path === '/usr/local/etc' }).wrap({ command: 'npm', args: ['ci'], network: true, cacheWritable: true, ...step })
    expect(fetching.args).toContain('--share-net')
    expect(pairsAfter(fetching.args, '--bind')).toEqual([[step.work, step.work], [step.pools, step.pools], [step.cache, step.cache]])
    expect(pairsAfter(fetching.args, '--ro-bind')).toEqual([])
    expect(pairsAfter(fetching.args, '--ro-bind-try').map(([from]) => from)).not.toContain('/usr/local')
    // npm's global config under a system bind (/usr/local/etc/npmrc, a registry token's place) is shown empty; npm is told to read it from the box's tmp, and to log there.
    expect(pairsAfter(fetching.args, '--tmpfs').map(([at]) => at)).toEqual(['/usr/local/etc', '/tmp'])
    expect(pairsAfter(bubblewrapSandbox({ execPath: '/usr/local/bin/node', exists: () => false }).wrap({ command: 'npm', args: ['ci'], ...step }).args, '--tmpfs').map(([at]) => at)).toEqual(['/tmp'])
    expect(pairsAfter(bubblewrapSandbox({ execPath: '/opt/node22/bin/node', exists: () => true }).wrap({ command: 'npm', args: ['ci'], ...step }).args, '--tmpfs').map(([at]) => at)).toEqual(['/tmp'])
    // The certificate bundle the environment names is bound after /tmp, so one kept under it is there.
    const tmpAt = fetching.args.findIndex((flag, i) => flag === '--tmpfs' && fetching.args[i + 1] === '/tmp')
    expect(fetching.args.indexOf(resolve(root, 'ca.pem'))).toBeGreaterThan(tmpAt)
    const set = Object.fromEntries(pairsAfter(fetching.args, '--setenv'))
    expect(set['PATH']).toBe('/usr/local/bin:/home/op/.volta/bin:/usr/bin')
    expect(set).toMatchObject({ npm_config_logs_dir: '/tmp/npm-logs', npm_config_globalconfig: '/tmp/npmrc-global', npm_config_update_notifier: 'false' })
    // The fetch writes the cache itself: no shadow.
    expect(set['npm_config_cache']).toBe(step.cache)
    expect(fetching.args.slice(fetching.args.indexOf('--'))).toEqual(['--', '/bin/sh', '-c', expect.anything(), '[box] opened', step.cache, '', 'npm', 'ci'])
  })

  it('refuses a node whose prefix is the home, over the home, the root, or over the builder\'s pools; one in the home\'s own corner is shown alone', () => {
    const home = '/home/op'
    for (const execPath of [`${home}/bin/node`, '/bin/node', '/home/bin/node']) expect(() => bubblewrapSandbox({ execPath, home })).toThrow(/a build must not see either/)
    expect(() => bubblewrapSandbox({ execPath: '/srv/builder/bin/node', home, keepOut: ['/srv/builder/pools'] })).toThrow(/a build must not see either/)
    const nvm = bubblewrapSandbox({ execPath: `${home}/.nvm/versions/node/v22.0.0/bin/node`, home }).wrap({ command: 'npm', args: ['ci'], network: false, ...step })
    const ro = pairsAfter(nvm.args, '--ro-bind-try').map(([from]) => from)
    expect(ro).toContain(`${home}/.nvm/versions/node/v22.0.0/bin`)
    expect(ro.some(from => from === home || from === `${home}/.nvm`)).toBe(false)
  })
})

describe('a container composes the box', () => {
  it('runs read-only as this user with no capabilities, the three directories mounted, no network unless the step may fetch', () => {
    const docker = containerSandbox('docker', { image: 'node:22', uid: 1000, gid: 1000, hostEnv: { DOCKER_HOST: 'x' }, rootless: () => false })
    const { command, args, end } = docker.wrap({ command: 'npm', args: ['run', 'build:core'], network: false, ...step, env: { ...step.env, HTTPS_PROXY: 'http://127.0.0.1:3128/', NO_PROXY: 'x' } })
    expect(command).toBe('docker')
    expect(args.slice(0, 2)).toEqual(['run', '--rm'])
    expect(after(args, '--network')).toEqual(['none'])
    expect(args).toEqual(expect.arrayContaining(['--read-only', '--init', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges']))
    expect(after(args, '--user')).toEqual(['1000:1000'])
    // The three directories at fixed paths, the cache read-only for a step that is not the fetch; the certificate the env names beside them.
    expect(after(args, '-v')).toEqual([`${step.work}:/work`, `${step.pools}:/pools`, `${step.cache}:/cache:ro`, `${resolve(root, 'ca.pem')}:/certs/ca.pem:ro`])
    expect(after(args, '-w')).toEqual(['/work/src'])
    const env = after(args, '-e')
    expect(env).toEqual(expect.arrayContaining(['HOME=/home/build', 'TMPDIR=/tmp', 'npm_config_cache=/tmp/npm-cache', 'HYPERCOMB_POOLS_DIR=/pools', 'HYPERCOMB_HOST_OUT_DIR=/work/out', 'NODE_EXTRA_CA_CERTS=/certs/ca.pem', 'HTTPS_PROXY=http://host.docker.internal:3128/', 'NO_PROXY=x']))
    expect(env.some(e => e.startsWith('PATH=') || e.startsWith('HYPERCOMB_SIGNER_KEY='))).toBe(false)
    expect(args.slice(-9)).toEqual(['node:22', '/bin/sh', '-c', expect.stringContaining('exec "$@"'), '[box] opened', '/cache', '/tmp/npm-cache', 'npm', 'run', 'build:core'].slice(-9))
    expect(typeof end).toBe('function')
    const fetching = docker.wrap({ command: 'npm', args: ['ci'], network: true, cacheWritable: true, ...step }).args
    expect(after(fetching, '--network')).toEqual(['bridge'])
    expect(after(fetching, '-v')).toContain(`${step.cache}:/cache`)
    expect(after(fetching, '-e')).toContain('npm_config_cache=/cache')
    expect(after(fetching, '--add-host')).toEqual(['host.docker.internal:host-gateway'])
    expect(containerSandbox('podman', { rootless: () => false }).wrap({ command: 'npm', args: ['ci'], network: true, ...step }).args).toContain('--userns=keep-id')
    // A rootless engine's root is already this user: no --user.
    expect(containerSandbox('docker', { uid: 1000, gid: 1000, rootless: () => true }).wrap({ command: 'npm', args: ['ci'], ...step }).args).not.toContain('--user')
    // The probe is one empty build in the exact box: npm --version, the cache read-only, no network.
    const empty = docker.probe({ work: '/p/work', pools: '/p/pools', cache: '/p/cache' })
    expect(empty.command).toBe('docker')
    expect(empty.args).toEqual(expect.arrayContaining(['--network', 'none', '-v', '/p/cache:/cache:ro', '-w', '/work', 'node:22']))
    expect(empty.args.slice(-2)).toEqual(['npm', '--version'])
  })
})

describe('the box is chosen before anything runs', () => {
  const quiet = () => undefined
  it('a container engine that answers comes first, then bubblewrap on Linux; with neither the choice fails and says what to install', async () => {
    const have = (set: string[]) => (command: string) => set.includes(command)
    expect((await chooseSandbox({ run: have(['docker', 'bwrap']), os: 'linux', log: quiet, env: {} })).name).toBe('container')
    expect((await chooseSandbox({ run: have(['bwrap']), os: 'linux', log: quiet, env: {} })).name).toBe('bubblewrap')
    await expect(chooseSandbox({ run: have([]), os: 'linux', log: quiet, env: {} })).rejects.toThrow(/Install bubblewrap .*or Docker\/Podman.*--sandbox none/)
    await expect(chooseSandbox({ run: have(['bwrap']), os: 'darwin', log: quiet, env: {} })).rejects.toThrow(/Install Docker Desktop or Podman/)
    expect(noSandboxHere('win32')).toMatch(/Docker Desktop/)
  })

  it('proves the box it chose can open — one empty build, npm --version in the exact box, with the step\'s environment, must run — before any ask is taken; what the box said is told', async () => {
    const probed: string[][] = []
    const seen: { cwd?: string; env?: Record<string, string>; tell?: (line: string) => void }[] = []
    const runs = (ok: boolean, said = '') => (command: string, args: string[], options?: { cwd?: string; env?: Record<string, string>; tell?: (line: string) => void }) => {
      if (args.includes('--') || args[0] === 'run') { probed.push([command, ...args]); seen.push(options ?? {}); if (!ok && said) options?.tell?.(said) }
      return args.includes('--') || args[0] === 'run' ? ok : ['docker', 'bwrap'].includes(command)
    }
    await expect(chooseSandbox({ run: runs(false, 'exec: npm: not found'), os: 'linux', prefer: 'bubblewrap', log: quiet, env: {}, stepEnv: () => ({ NODE_OPTIONS: '--max-old-space-size=64' }) })).rejects.toThrow(/cannot make a box.*user namespace.*Homebrew.*the box said: exec: npm: not found/)
    expect(probed.at(-1)![0]).toBe('bwrap')
    expect(probed.at(-1)).toEqual(expect.arrayContaining(['--unshare-all', '--tmpfs', '/tmp', '--ro-bind', '--', 'npm', '--version']))
    // The step's environment, as a step gets it.
    expect(pairsAfter(probed.at(-1)!, '--setenv')).toEqual(expect.arrayContaining([['NODE_OPTIONS', '--max-old-space-size=64']]))
    expect(probed.at(-1)).not.toContain('--share-net')
    expect(probed.at(-1)!.slice(-2)).toEqual(['npm', '--version'])
    // Over directories of its own, under the temporary directory, gone after.
    const work = probed.at(-1)![probed.at(-1)!.indexOf('--chdir') + 1]!
    expect(work.startsWith(tmpdir())).toBe(true)
    expect(seen.at(-1)!.cwd).toBe(work)
    expect(existsSync(work)).toBe(false)
    await expect(chooseSandbox({ run: runs(false), os: 'linux', prefer: 'container', log: quiet, env: {} })).rejects.toThrow(/cannot run npm in node:22/)
    expect(probed.at(-1)).toEqual(expect.arrayContaining(['docker', 'run', '--rm', '--network', 'none', 'node:22', 'npm', '--version']))
    expect(probed.at(-1)!.slice(-2)).toEqual(['npm', '--version'])
    expect((await chooseSandbox({ run: runs(true), os: 'linux', log: quiet, env: {} })).name).toBe('container')
    // None needs no proof.
    expect((await chooseSandbox({ run: runs(false), os: 'linux', prefer: 'none', log: quiet, env: {} })).name).toBe('none')
  })

  it('behind a proxy on this machine\'s loopback bubblewrap comes first, since it has the host\'s network; a container is told', async () => {
    const have = (set: string[]) => (command: string) => set.includes(command)
    const loopback = { HTTPS_PROXY: 'http://127.0.0.1:3128/' }
    expect((await chooseSandbox({ run: have(['docker', 'bwrap']), os: 'linux', log: quiet, env: loopback })).name).toBe('bubblewrap')
    expect((await chooseSandbox({ run: have(['docker', 'bwrap']), os: 'linux', log: quiet, env: { https_proxy: 'http://[::1]:3128' } })).name).toBe('bubblewrap')
    // A proxy elsewhere is reached from either box: the usual order — and a name that merely starts with localhost is elsewhere.
    expect((await chooseSandbox({ run: have(['docker', 'bwrap']), os: 'linux', log: quiet, env: { HTTPS_PROXY: 'http://proxy.corp:3128/' } })).name).toBe('container')
    expect((await chooseSandbox({ run: have(['docker', 'bwrap']), os: 'linux', log: quiet, env: { HTTPS_PROXY: 'http://localhost.corp.example:3128/' } })).name).toBe('container')
    expect((await chooseSandbox({ run: have(['docker', 'bwrap']), os: 'linux', log: quiet, env: { HTTPS_PROXY: 'http://127.1:3128/' } })).name).toBe('bubblewrap')
    // Only a container here: it is used, and the operator told the proxy must listen past loopback.
    const said: string[] = []
    expect((await chooseSandbox({ run: have(['docker']), os: 'linux', log: (line: string) => { said.push(line) }, env: loopback })).name).toBe('container')
    expect(said.some(line => /loopback.*listen past loopback/.test(line))).toBe(true)
    // Named, the container is used regardless, and still told.
    said.length = 0
    expect((await chooseSandbox({ prefer: 'container', run: have(['docker', 'bwrap']), os: 'linux', log: (line: string) => { said.push(line) }, env: loopback })).name).toBe('container')
    expect(said.some(line => /listen past loopback/.test(line))).toBe(true)
  })

  it('shows npm where it really is — the package a link out of bin runs from — and never the whole prefix for a plain file', async () => {
    const dir = await mkdtemp(resolve(tmpdir(), 'hc-node-layout-'))
    try {
      const bin = resolve(dir, 'node', 'bin')
      const npmPackage = resolve(dir, 'node', 'libexec', 'lib', 'node_modules', 'npm')
      await mkdir(resolve(npmPackage, 'bin'), { recursive: true })
      await mkdir(bin, { recursive: true })
      await writeFile(resolve(bin, 'node'), '')
      await writeFile(resolve(npmPackage, 'bin', 'npm-cli.js'), '')
      await symlink('../libexec/lib/node_modules/npm/bin/npm-cli.js', resolve(bin, 'npm'))
      const shown = (box: ReturnType<typeof bubblewrapSandbox>) => pairsAfter(box.wrap({ command: 'npm', args: ['ci'], ...step }).args, '--ro-bind-try').map(([from]) => from)
      const brew = shown(bubblewrapSandbox({ execPath: resolve(bin, 'node') }))
      expect(brew).toContain(npmPackage)
      expect(brew).toContain(bin)
      expect(brew).not.toContain(resolve(dir, 'node'))
      await rm(resolve(bin, 'npm'))
      await writeFile(resolve(bin, 'npm'), '')
      const plain = shown(bubblewrapSandbox({ execPath: resolve(bin, 'node') }))
      expect(plain).toContain(bin)
      expect(plain).not.toContain(resolve(dir, 'node'))
      expect(plain).not.toContain(dir)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('a named box is used or the choice fails; none is never picked by itself', async () => {
    const have = (set: string[]) => (command: string) => set.includes(command)
    expect((await chooseSandbox({ prefer: 'none', run: have(['docker']), os: 'linux', log: quiet, env: {} })).name).toBe('none')
    expect((await chooseSandbox({ prefer: 'bubblewrap', run: have(['docker', 'bwrap']), os: 'linux', log: quiet, env: {} })).name).toBe('bubblewrap')
    await expect(chooseSandbox({ prefer: 'container', run: have(['bwrap']), os: 'linux', log: quiet, env: {} })).rejects.toThrow(/neither docker nor podman answers/)
    await expect(chooseSandbox({ prefer: 'bubblewrap', run: have(['bwrap']), os: 'darwin', log: quiet, env: {} })).rejects.toThrow(/Linux only/)
    await expect(chooseSandbox({ prefer: 'chroot', run: have([]), os: 'linux', log: quiet, env: {} })).rejects.toThrow(/--sandbox \(or HYPERCOMB_BUILDER_SANDBOX\) wants one of container, bubblewrap, none/)
    const said: string[] = []
    await chooseSandbox({ prefer: 'none', run: have([]), os: 'linux', log: (line: string) => { said.push(line) }, env: {} })
    expect(said[0]).toMatch(/NO SANDBOX/)
    expect(noSandbox().wrap({ command: 'npm', args: ['ci'], cwd: '/x', env: { A: '1' } })).toEqual({ command: 'npm', args: ['ci'], cwd: '/x', env: { A: '1' } })
  })
})

describe.skipIf(!hasBwrap)('inside bubblewrap, for real', () => {
  const probe = `
    const { readdirSync, readFileSync, writeFileSync } = require('node:fs')
    const tryIt = f => { try { return f() } catch (e) { return 'ERR ' + e.code } }
    const out = {
      home: tryIt(() => readdirSync(process.env.HOME)),
      outsideHome: tryIt(() => readdirSync(process.env.OUTSIDE_HOME)),
      outsidePools: tryIt(() => readFileSync(process.env.OUTSIDE_POOLS + '/secret', 'utf8')),
      key: process.env.HYPERCOMB_SIGNER_KEY ?? null,
      writeWork: tryIt(() => { writeFileSync('written', 'x'); return 'ok' }),
      writeUsr: tryIt(() => { writeFileSync('/usr/hc-sandbox-spec', 'x'); return 'WROTE' }),
      tmp: readdirSync('/tmp').filter(n => !n.startsWith('hc-sandbox-spec-')),
      procs: readdirSync('/proc').filter(n => /^[0-9]+$/.test(n)).length,
    }
    fetch(process.env.PROBE_URL, { signal: AbortSignal.timeout(3000) }).then(r => 'reached ' + r.status, e => 'ERR ' + (e.cause?.code ?? e.name))
      .then(net => { out.net = net; console.log(JSON.stringify(out)) })
  `
  let server: ReturnType<typeof createServer>
  let url = ''
  beforeEach(async () => {
    server = createServer((_req, res) => { res.end('hi') })
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  })
  afterEach(async () => { await new Promise(done => server.close(done)) })

  const inBox = async (network: boolean) => {
    await writeFile(resolve(step.pools, '..', 'secret'), 'the builder\'s')
    const env = { ...step.env, OUTSIDE_HOME: homedir(), OUTSIDE_POOLS: resolve(step.pools, '..'), PROBE_URL: url }
    const boxed = bubblewrapSandbox().wrap({ command: process.execPath, args: ['-e', probe], network, ...step, env })
    const r = await buildStep(boxed.command, boxed.args, { cwd: boxed.cwd, env: boxed.env, minutes: 1 })
    const line = r.said.split('\n').filter((l: string) => l.startsWith('{')).at(-1)
    if (!line) throw new Error(`no probe line: ${r.said}`)
    return { ...JSON.parse(line), said: r.said }
  }

  it('sees an empty home, nothing outside its directories, no key, a read-only system, its own processes, and no network — and says it opened first', async () => {
    const seen = await inBox(false)
    expect(seen.said).toContain('[box] opened')
    expect(seen).toMatchObject({ home: [], outsidePools: 'ERR ENOENT', key: null, writeWork: 'ok', writeUsr: 'ERR EROFS', net: expect.stringMatching(/^ERR /) })
    // The home is not there — or holds only the empty path to a node
    // installed under it (nvm), or to this spec's directories when the
    // temporary directory is (bwrap makes the path to what it binds).
    const skeleton = (root: string) => [step.work, step.pools, step.cache].map(path => relative(root, path)).filter(rel => rel && !rel.startsWith('..')).map(rel => rel.split('/')[0]!)
    const corner = process.execPath.startsWith(homedir() + '/') ? process.execPath.slice(homedir().length + 1).split('/')[0] : null
    const allowedInHome = [corner, ...skeleton(homedir())].filter(Boolean)
    expect(seen.outsideHome === 'ERR ENOENT' || (Array.isArray(seen.outsideHome) && seen.outsideHome.every((name: string) => allowedInHome.includes(name)))).toBe(true)
    expect(seen.procs).toBeLessThan(10)
    // Fresh: the home, and the cache's shadow the opening laid.
    expect(seen.tmp.filter((name: string) => !skeleton('/tmp').includes(name)).sort()).toEqual(['home', 'npm-cache'])
    expect(await readFile(resolve(step.cwd, 'written'), 'utf8')).toBe('x')
  })

  it('reaches the network only when the step may fetch', async () => {
    expect((await inBox(true)).net).toBe('reached 200')
  })

  it('one empty build runs in it: the probe the chooser proves a box with, and the chooser itself', async () => {
    const empty = bubblewrapSandbox().probe({ work: step.work, pools: step.pools, cache: step.cache })
    const r = spawnSync(empty.command, empty.args, { cwd: empty.cwd, env: empty.env, encoding: 'utf8', timeout: 60_000 })
    expect(r.stderr).toContain('[box] opened')
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
    expect((await chooseSandbox({ prefer: 'bubblewrap', log: () => undefined, env: {}, stepEnv: ({ work, pools }) => buildEnv(work, process.env, { pools }) })).name).toBe('bubblewrap')
  })

  it('is ended whole when the builder stops: nothing it started survives', async () => {
    const marker = `hc-sandbox-spec-${Date.now().toString(36)}`
    const forever = `process.title = '${marker}'; require('node:child_process').spawn(process.execPath, ['-e', 'process.title="${marker}-child"; setInterval(() => {}, 1000)'], { stdio: 'ignore' }); setInterval(() => {}, 1000)`
    const boxed = bubblewrapSandbox().wrap({ command: process.execPath, args: ['-e', forever], network: false, ...step })
    const stop = new AbortController()
    const boxedRun = buildStep(boxed.command, boxed.args, { cwd: boxed.cwd, env: boxed.env, signal: stop.signal })
    await new Promise(done => setTimeout(done, 1500))
    expect(running(marker)).toBeGreaterThanOrEqual(2)
    stop.abort()
    const r = await boxedRun
    expect(r.stopped).toBe(true)
    await new Promise(done => setTimeout(done, 500))
    expect(running(marker)).toBe(0)
  })
})
