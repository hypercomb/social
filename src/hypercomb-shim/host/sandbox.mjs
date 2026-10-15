// hypercomb-shim/host/sandbox.mjs
//
// A DRAFT'S BUILD RUNS IN A BOX. Building a draft runs its author's code on
// this machine — its lockfile, its scripts, its configs, its tests — and a
// builder trusts an author only to send honest drafts, not to read the disk.
// Every step of a build therefore runs inside a sandbox that shows it:
//
//   - its own tree (`work`) and the pools the build stages into (`pools`),
//     writable; the builder's npm cache (`cache`), writable only for the one
//     step in which npm alone runs (the fetch with scripts held back), read-
//     only for every step that runs the draft's code — and nothing else of
//     this machine's: not the builder's home, not its pools, not its key,
//     not any other build's directories. The system's programs and libraries
//     are read-only; `/tmp` and the build's home are fresh and vanish with it;
//   - an environment of its own (`buildEnv`), never this process's;
//   - the network only while the install fetches from the registry. The
//     scripts a draft's dependencies run, and the draft's own build scripts,
//     run with no network at all, so nothing read in the box can leave it.
//
// Two boxes do that: a CONTAINER (Docker or Podman, any platform) and
// BUBBLEWRAP (Linux user namespaces, no daemon, no root). The builder picks
// whichever is there and proves it can run a box before taking anything;
// with neither it REFUSES to build: a draft's code runs unboxed only when the
// operator says so (`--sandbox none`), for authors they would let run code on
// the machine. What runs inside is the same `npm` the builder would run;
// only where it runs changes, so the revision it makes is the one an unboxed
// build would make.
//
// The box is the operator's tool's: its own flags are what keep the promise,
// and this module composes them from one description of a step. It never
// runs the step itself (host/builder.mjs buildStep does, as a process group
// it can end); a container that outlives its command is ended by name.

import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { homedir, platform, tmpdir } from 'node:os'
import { basename, dirname, posix, relative, resolve, sep } from 'node:path'

/** The boxes, by the name `--sandbox` and HYPERCOMB_BUILDER_SANDBOX take. */
export const SANDBOXES = ['container', 'bubblewrap', 'none']
/** The container image a build runs in: the node this repository builds with. */
export const DEFAULT_IMAGE = 'node:22'
/** Processes one container may hold: a build forks hundreds, never thousands. */
const PIDS_LIMIT = 4096
/** Environment names that point at files a build must still find: the
 *  certificate bundle a proxy or a corporate network makes npm trust. */
const FILES_NAMED_IN_ENV = ['NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE']
/** Environment names that point at a proxy, which in a container is reached
 *  by the host's name rather than its loopback. */
const PROXIES_IN_ENV = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']
/** What of `/etc` a build needs: names, trust, locale — never the rest. */
const ETC_SHOWN = ['ssl', 'ca-certificates', 'resolv.conf', 'hosts', 'nsswitch.conf', 'passwd', 'group', 'localtime',
  'ld.so.cache', 'ld.so.conf', 'ld.so.conf.d', 'alternatives']
/** Where a container sees the three directories: fixed, so a host path of
 *  any shape (a Windows drive) maps to one the image's node can use. */
const IN_CONTAINER = { work: '/work', pools: '/pools', cache: '/cache', certs: '/certs' }
/** THE BOX SAYS WHEN IT HAS OPENED, before the step's own command runs: a
 *  step that failed without this line failed in the box, not in the draft
 *  (host/builder.mjs stepTrouble). A draft can print the line itself, which
 *  only makes a box's failure read as its own — never the other way. */
export const BOX_OPENED = '[box] opened'
/** Where a step whose cache is read-only keeps npm's own scribbling: a
 *  SHADOW of the cache in the box's fresh tmp — its index copied in (npm
 *  rewrites an index bucket on every lookup it makes by name, and refuses a
 *  package it cannot do that for), its content linked, read-only. Nothing
 *  written there outlives the step. */
const CACHE_SHADOW = '/tmp/npm-cache'
const OPENING = [
  'm="$0"; r="$1"; s="$2"; shift 2',
  'if [ -n "$s" ]; then mkdir -p "$s/_cacache" && { cp -r "$r/_cacache/index-v5" "$s/_cacache/" 2>/dev/null; ln -s "$r/_cacache/content-v2" "$s/_cacache/content-v2" 2>/dev/null; }; fi',
  'printf \'%s\\n\' "$m" >&2',
  'exec "$@"',
].join('; ')
/** The step's command, after the box has said it opened — and, for a step
 *  whose cache is read-only, after the shadow is laid. */
const opening = (command, args, { cache, shadow }) => ['/bin/sh', '-c', OPENING, BOX_OPENED, cache, shadow ?? '', command, ...args]
/** The environment a box never carries over: the builder's places. */
const NOT_CARRIED = ['HOME', 'TMPDIR', 'TEMP', 'TMP', 'npm_config_cache', 'NPM_CONFIG_CACHE', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']

/**
 * A step as the box sees it: `command` and `args` to run in `cwd` with `env`
 * (host/builder.mjs buildEnv), `network` only when the registry is needed,
 * `cacheWritable` only for the step in which npm alone runs, and the three
 * directories: `work`, `pools`, `cache`.
 */

/** Does `command` answer at all? The box must be there, not merely named.
 *  An engine whose daemon is away is given a few seconds, not a wait. */
const answers = (command, args, { timeout = 5_000, cwd, env, tell } = {}) => {
  try {
    const r = spawnSync(command, args, { stdio: ['ignore', 'ignore', tell ? 'pipe' : 'ignore'], timeout, cwd, env, encoding: 'utf8' })
    // What it said last, for the operator: the box's own line is not news.
    if (tell) tell(String(r.stderr ?? '').split('\n').map(line => line.trim()).filter(line => line && line !== BOX_OPENED).at(-1) ?? r.error?.message ?? '')
    return r.status === 0
  } catch { return false }
}
/** What `<engine> info` says of itself. */
const infoOf = engine => {
  try { return String(spawnSync(engine, ['info', '--format', '{{.SecurityOptions}}'], { encoding: 'utf8', timeout: 20_000 }).stdout ?? '') } catch { return '' }
}

const under = (path, root) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)
/** This machine's loopback, by name or address — whole, not a name that
 *  merely starts so (the URL parser has normalized `127.1` and `[0:0::1]`). */
const isLoopback = host => /^(localhost|localhost6|ip6-localhost|localhost\.localdomain|[^/]+\.localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)$/i.test(host)

/** The env the step gets inside any box: its own home and tmp, the
 *  builder's cache, never the builder's places. */
const boxedEnv = (env, { home, tmp, cache }) => {
  const out = {}
  for (const [name, value] of Object.entries(env ?? {})) {
    if (NOT_CARRIED.includes(name) || value === undefined) continue
    out[name] = String(value)
  }
  // npm's logs and its global config in the box's tmp, never in the cache
  // (every later build reads it) nor the builder's prefix; no update check.
  return { ...out, HOME: home, TMPDIR: tmp, npm_config_cache: cache, npm_config_logs_dir: `${tmp}/npm-logs`, npm_config_globalconfig: `${tmp}/npmrc-global`, npm_config_update_notifier: 'false' }
}

/** THE ONE EMPTY BUILD that proves a box: `npm --version` in the exact box
 *  a step gets, over empty directories. */
const emptyBuild = (box, { work, pools, cache }, env = {}) => box.wrap({ command: 'npm', args: ['--version'], cwd: work, env, network: false, cacheWritable: false, work, pools, cache })

/**
 * BUBBLEWRAP: a user, mount, pid, ipc and uts namespace of its own, the
 * network's only when asked. The root is built from read-only binds of the
 * system — `/usr`, the libraries, the few files of `/etc` a build reads, the
 * node this builder runs — then `/tmp` fresh, the home fresh inside it, and
 * the three directories bound at their own paths, so every path the
 * environment names holds inside. The parent's death ends the box.
 */
export const bubblewrapSandbox = ({ execPath = process.execPath, hostPath, home = homedir(), keepOut = [], exists = existsSync } = {}) => {
  // The node this builder runs, wherever it lives: its programs, npm and
  // its headers are shown, read-only — never the whole prefix, which may be
  // this user's home (a node copied into ~/bin) or hold the builder's pools.
  const binDir = dirname(execPath)
  const prefix = dirname(binDir)
  // A program of this node that is a link out of its bin (Homebrew keeps npm
  // under libexec) is shown where it really is: the package it runs from. A
  // plain file beside node is shown with node already.
  const realDir = path => { try { return dirname(realpathSync(path)) } catch { return null } }
  const realBin = realDir(execPath) ?? binDir
  const packageOf = name => { const dir = realDir(resolve(binDir, name)); return !dir || dir === binDir || dir === realBin ? null : basename(dir) === 'bin' ? dirname(dir) : dir }
  const nodeShown = [...new Set([binDir, realDir(execPath), resolve(prefix, 'lib', 'node_modules', 'npm'), resolve(prefix, 'lib', 'node_modules', 'corepack'), resolve(prefix, 'include'), packageOf('npm'), packageOf('corepack')].filter(Boolean))]
  // Neither the prefix nor any directory shown may be the root, the home or
  // over it, or over the builder's pools (a node under the home's own corner,
  // nvm's, is shown alone).
  const over = path => path === '/' || path === home || under(home, path) || keepOut.some(kept => under(kept, path))
  if (over(prefix) || nodeShown.some(over)) {
    throw new Error(`the node this builder runs, ${execPath}, has a prefix (${prefix}) that holds this user's home or the builder's pools, and a build must not see either: run the builder with a node installed on its own (nvm, /opt, /usr/local)`)
  }
  const box = {
    name: 'bubblewrap',
    describe: () => 'bubblewrap (Linux user namespaces): the draft\'s code sees its tree, its own pools and the npm cache, nothing else of this machine; the registry only while installing',
    probe: (dirs, env = {}) => emptyBuild(box, dirs, env),
    wrap({ command, args, cwd, env, network = false, cacheWritable = false, work, pools, cache }) {
      // The programs the step finds: this node's own first (its npm, not a
      // version manager's shim outside the box), then the build's PATH.
      const path = [binDir, ...(hostPath ?? env?.PATH ?? process.env.PATH ?? '').split(':').filter(Boolean).filter(p => p !== binDir)].join(':')
      const bound = new Set()
      const flags = ['--unshare-all', ...(network ? ['--share-net'] : []), '--die-with-parent', '--new-session']
      const ro = (path, dest = path) => { flags.push('--ro-bind-try', path, dest); bound.add(dest) }
      for (const path of ['/usr', '/lib', '/lib64', '/bin', '/sbin']) ro(path)
      for (const name of ETC_SHOWN) ro(`/etc/${name}`)
      for (const path of nodeShown) if (![...bound].some(root => under(path, root))) ro(path)
      // npm's global config, <prefix>/etc/npmrc — where `npm config set
      // --location=global` keeps a registry token — lies inside a system bind
      // when the prefix is /usr or /usr/local: that directory is shown empty.
      const globalEtc = resolve(prefix, 'etc')
      if ([...bound].some(root => under(globalEtc, root)) && exists(globalEtc)) flags.push('--tmpfs', globalEtc)
      flags.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--dir', '/tmp/home')
      // Writable, at their own paths — after /tmp, so a directory under it
      // lands over the fresh tmpfs instead of vanishing beneath it. The cache
      // only while npm alone runs. The files the environment names (a
      // certificate bundle), read-only, wherever they lie — after /tmp too.
      for (const path of [work, pools]) flags.push('--bind', path, path)
      flags.push(cacheWritable ? '--bind' : '--ro-bind', cache, cache)
      for (const name of FILES_NAMED_IN_ENV) if (env?.[name]) ro(resolve(String(env[name])))
      flags.push('--chdir', cwd, '--clearenv')
      const shadow = cacheWritable ? null : CACHE_SHADOW
      for (const [name, value] of Object.entries(boxedEnv({ ...env, PATH: path }, { home: '/tmp/home', tmp: '/tmp', cache: shadow ?? cache }))) flags.push('--setenv', name, value)
      return { command: 'bwrap', args: [...flags, '--', ...opening(command, args, { cache, shadow })], cwd, env: { PATH: path } }
    },
  }
  return box
}

/**
 * A CONTAINER: the image's node, no capabilities, no new privileges, a
 * read-only root with `/tmp` and the home fresh, the three directories at
 * fixed paths (`/work`, `/pools`, `/cache`; every path the environment names
 * is rewritten to them), the network only when asked. It runs as this user,
 * so what it writes is the builder's to read — except under a rootless
 * engine, whose root already is this user. A proxy on this machine's
 * loopback is reached by the host's name. Ended by name when its command is,
 * in case the engine outlives the client.
 */
export const containerSandbox = (engine, {
  image = process.env.HYPERCOMB_BUILDER_IMAGE || DEFAULT_IMAGE, uid = process.getuid?.(), gid = process.getgid?.(), hostEnv = process.env,
  rootless = () => /rootless/i.test(infoOf(engine)),
} = {}) => {
  const box = {
  name: 'container',
  describe: () => `a ${engine} container (${image}): the draft's code sees its tree, its own pools and the npm cache, nothing else of this machine; the registry only while installing`,
  probe: (dirs, env = {}) => emptyBuild(box, dirs, env),
  wrap({ command, args, cwd, env, network = false, cacheWritable = false, work, pools, cache }) {
    const name = `hc-build-${randomBytes(6).toString('hex')}`
    const mounts = [[work, IN_CONTAINER.work], [pools, IN_CONTAINER.pools], [cache, IN_CONTAINER.cache]]
    /** A host path as the container sees it, when it lies in a mounted directory. */
    const inside = path => {
      for (const [host, box] of mounts) {
        if (path === host) return box
        if (under(path, host)) return posix.join(box, relative(host, path).split(sep).join('/'))
      }
      return path
    }
    const hostName = engine === 'podman' ? 'host.containers.internal' : 'host.docker.internal'
    const flags = ['run', '--rm', '--init', '--name', name, '--network', network ? 'bridge' : 'none',
      '--read-only', '--tmpfs', '/tmp:rw,exec', '--tmpfs', '/home/build:rw',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', String(PIDS_LIMIT)]
    if (uid !== undefined && gid !== undefined && !rootless()) flags.push('--user', `${uid}:${gid}`)
    if (engine === 'podman') flags.push('--userns=keep-id')
    if (engine === 'docker' && network) flags.push('--add-host', `${hostName}:host-gateway`)
    for (const [host, box] of mounts) flags.push('-v', `${host}:${box}${box === IN_CONTAINER.cache && !cacheWritable ? ':ro' : ''}`)
    flags.push('-w', inside(cwd))
    // The image's own PATH finds its node; the host's would not. Every other
    // value that names a mounted directory is rewritten to where it is.
    const { PATH: _hostPath, ...rest } = env ?? {}
    const shadow = cacheWritable ? null : CACHE_SHADOW
    const boxed = {}
    for (const [key, value] of Object.entries(boxedEnv(rest, { home: '/home/build', tmp: '/tmp', cache: shadow ?? IN_CONTAINER.cache }))) {
      if (FILES_NAMED_IN_ENV.includes(key)) {
        const file = resolve(value)
        const shown = posix.join(IN_CONTAINER.certs, basename(file))
        flags.push('-v', `${file}:${shown}:ro`)
        boxed[key] = shown
      } else if (PROXIES_IN_ENV.includes(key)) {
        try { const url = new URL(value); if (isLoopback(url.hostname)) url.hostname = hostName; boxed[key] = url.toString() } catch { boxed[key] = value }
      } else boxed[key] = inside(value)
    }
    for (const [key, value] of Object.entries(boxed)) flags.push('-e', `${key}=${value}`)
    return {
      command: engine, args: [...flags, image, ...opening(command, args, { cache: IN_CONTAINER.cache, shadow })], cwd, env: hostEnv,
      end: () => {
        try { const kill = spawn(engine, ['kill', name], { stdio: 'ignore', detached: true }); kill.on('error', () => undefined); kill.unref() } catch { /* already gone */ }
      },
    }
  },
  }
  return box
}

/** NO BOX: the step as it is, on this machine, as this user. Chosen by the
 *  operator alone. */
export const noSandbox = () => ({
  name: 'none',
  describe: () => 'NO SANDBOX: the draft\'s code runs on this machine as this user, with this builder\'s home and files in reach — only for authors you would let run code here',
  probe: null,
  wrap({ command, args, cwd, env }) { return { command, args, cwd, env } },
})

/** Does one empty build run in the box? Over directories of its own, gone
 *  after, with the environment a step gets (`stepEnv`), so what a step would
 *  carry in — NODE_OPTIONS, a certificate bundle, a proxy — is tried now.
 *  The box's last word goes to `tell`. */
const emptyBuildRuns = async (box, run, stepEnv, tell) => {
  const dir = await mkdtemp(resolve(tmpdir(), 'hc-box-probe-'))
  try {
    const dirs = { work: resolve(dir, 'work'), pools: resolve(dir, 'pools'), cache: resolve(dir, 'cache') }
    for (const path of Object.values(dirs)) await mkdir(path, { recursive: true })
    const step = box.probe(dirs, stepEnv(dirs))
    return run(step.command, step.args, { timeout: 600_000, cwd: step.cwd, env: step.env, tell })
  } finally { await rm(dir, { recursive: true, force: true }) }
}

/** How to get a box where there is none, by platform. */
export const noSandboxHere = (os = platform()) => [
  'no sandbox to build in — a draft\'s code runs only in a box.',
  os === 'linux'
    ? 'Install bubblewrap (apt install bubblewrap; dnf install bubblewrap) or Docker/Podman,'
    : 'Install Docker Desktop or Podman and start it,',
  'or, for authors you would let run code on this machine, --sandbox none (HYPERCOMB_BUILDER_SANDBOX=none).',
].join(' ')

/**
 * THE BOX THIS BUILDER BUILDS IN. `prefer` names one (`--sandbox`,
 * HYPERCOMB_BUILDER_SANDBOX): it is used or the choice fails. Unnamed, a
 * container engine that answers comes first, then bubblewrap on Linux; with
 * neither the choice fails and says what to install. `none` is never picked
 * by itself. A box is proved before it is chosen — one empty build must run:
 * `npm --version` in the exact box, over empty directories — so a kernel
 * that will not make a namespace, an engine that cannot run its image, or a
 * node that needs files the box does not show, is this builder's trouble
 * now, never a draft's later.
 */
export const chooseSandbox = async ({ prefer = process.env.HYPERCOMB_BUILDER_SANDBOX, os = platform(), run = answers, log = console.log, keepOut = [], env = process.env, stepEnv = () => ({}) } = {}) => {
  const want = String(prefer ?? '').trim().toLowerCase()
  if (want && !SANDBOXES.includes(want)) throw new Error(`--sandbox (or HYPERCOMB_BUILDER_SANDBOX) wants one of ${SANDBOXES.join(', ')}, not "${want}"`)
  const engine = () => ['docker', 'podman'].find(name => run(name, ['info'])) ?? null
  // A proxy on this machine's loopback is the host's own network: a container
  // reaches it only if it listens past loopback, bubblewrap always.
  const loopbackProxy = PROXIES_IN_ENV.map(name => env[name]).filter(Boolean).some(value => { try { return isLoopback(new URL(value).hostname) } catch { return false } })
  let box = null
  if (want === 'none') box = noSandbox()
  else if (want === 'container') {
    const found = engine()
    if (!found) throw new Error('--sandbox container: neither docker nor podman answers here (is the engine installed and running?)')
    box = containerSandbox(found)
  } else if (want === 'bubblewrap') {
    if (os !== 'linux' || !run('bwrap', ['--version'])) throw new Error(`--sandbox bubblewrap: bwrap is not here${os === 'linux' ? ' (apt install bubblewrap; dnf install bubblewrap)' : ', and bubblewrap is Linux only'}`)
    box = bubblewrapSandbox({ keepOut })
  } else {
    const found = engine()
    const bwrapHere = os === 'linux' && run('bwrap', ['--version'])
    if (found && !(loopbackProxy && bwrapHere)) box = containerSandbox(found)
    else if (bwrapHere) box = bubblewrapSandbox({ keepOut })
    else throw new Error(noSandboxHere(os))
  }
  if (box.name === 'container' && loopbackProxy) log('[builder] the proxy the environment names listens on this machine\'s loopback: in a container it is reached as the host\'s name, so it must listen past loopback for the install to fetch')
  // An image is pulled on the first probe: give it time.
  let said = ''
  if (box.probe && !await emptyBuildRuns(box, run, stepEnv, line => { said = line })) {
    throw new Error((box.name === 'bubblewrap'
      ? `bubblewrap is here but cannot make a box that runs this builder's node: either this kernel refuses an unprivileged user namespace (sysctl kernel.unprivileged_userns_clone, user.max_user_namespaces, or a seccomp policy) — allow it, or use Docker/Podman — or the node at ${process.execPath} needs files the box does not show (Homebrew's does): run the builder with a node installed on its own (nodejs.org's build under /opt or /usr/local, or nvm)`
      : `${engine() ?? 'the engine'} is here but cannot run npm in ${process.env.HYPERCOMB_BUILDER_IMAGE || DEFAULT_IMAGE}: pull the image (docker/podman pull …), or name another with HYPERCOMB_BUILDER_IMAGE`)
      + (said ? ` — the box said: ${said}` : ''))
  }
  log(`[builder] builds run in ${box.describe()}`)
  return box
}
