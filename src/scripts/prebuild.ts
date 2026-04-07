// scripts/prebuild.ts
// Smart prebuild: detects source changes via signature gates, only rebuilds what's needed.
// Usage: tsx scripts/prebuild.ts --target web|dev

import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { basename, dirname, extname, join, relative, resolve } from 'path'
import { spawn, spawnSync } from 'child_process'
import { createConnection } from 'net'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '..')
const STATE_FILE = join(__dirname, '.build-state.json')

const TAG = '[prebuild]'

// --- args ---

const args = process.argv.slice(2)
const targetIdx = args.indexOf('--target')
const target = targetIdx >= 0 ? args[targetIdx + 1] : 'web'

if (target !== 'web' && target !== 'dev') {
  console.error(`${TAG} unknown target "${target}" — use --target web or --target dev`)
  process.exit(1)
}

// --- types ---

interface StepState {
  inputSignature?: string
  builtAt?: number
}

type BuildState = Record<string, StepState>

interface CommandSpec {
  label: string
  file: string
  args: string[]
}

// --- utilities ---

function walkFiles(dir: string, exts: string[]): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      out.push(...walkFiles(full, exts))
    } else if (exts.some(ext => name.endsWith(ext))) {
      out.push(full)
    }
  }
  return out
}

/** Signature gate: hash all source file paths + mtimes in a directory tree.
 *  Mtime changes trigger a signature change, but the signature itself is
 *  the stable identity — immune to clock skew across machines. */
function treeSignature(dir: string): string {
  const files = walkFiles(dir, ['.ts', '.js', '.json']).sort()
  const parts = files.map(f => {
    const mt = statSync(f).mtimeMs
    return `${f}:${mt}`
  })
  return createHash('sha256').update(parts.join('\n')).digest('hex')
}

function loadState(): BuildState {
  if (!existsSync(STATE_FILE)) return {}
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveState(state: BuildState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
}

const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npmCli = process.env.npm_execpath

// use cli.mjs if present, fall back to .bin/tsx
const tsxCliMjs = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const tsxCli = existsSync(tsxCliMjs)
  ? tsxCliMjs
  : join(ROOT, 'node_modules', '.bin', 'tsx')
const tsupCli = join(ROOT, 'node_modules', 'tsup', 'dist', 'cli-default.js')

function run(command: CommandSpec, cwd: string, allowFailure = false): void {
  console.log(`${TAG} > ${command.label}`)
  const result = spawnSync(command.file, command.args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
    shell: false,
  })

  if (result.status === 0) {
    return
  }

  if (!allowFailure) {
    throw new Error(`command failed: ${command.label}`)
  }

  console.warn(`${TAG} ⚠ command exited with error (non-fatal)`)
}

function npmRun(script: string): CommandSpec {
  if (npmCli) {
    return {
      label: `npm run ${script}`,
      file: process.execPath,
      args: [npmCli, 'run', script],
    }
  }

  return {
    label: `npm run ${script}`,
    file: npmExecutable,
    args: ['run', script],
  }
}

function tsxRun(scriptPath: string, args: string[] = []): CommandSpec {
  return {
    label: `tsx ${scriptPath}${args.length ? ` ${args.join(' ')}` : ''}`,
    file: process.execPath,
    args: [tsxCli, scriptPath, ...args],
  }
}

function nodeRun(scriptPath: string, args: string[] = []): CommandSpec {
  return {
    label: `node ${scriptPath}${args.length ? ` ${args.join(' ')}` : ''}`,
    file: process.execPath,
    args: [scriptPath, ...args],
  }
}

function tsupRun(args: string[] = []): CommandSpec {
  return {
    label: `tsup${args.length ? ` ${args.join(' ')}` : ''}`,
    file: process.execPath,
    args: [tsupCli, ...args],
  }
}

function needsBuild(state: BuildState, key: string, srcDir: string, outputMarker?: string): boolean {
  if (outputMarker && !existsSync(outputMarker)) return true
  const prev = state[key]
  if (!prev?.inputSignature) return true
  const current = treeSignature(srcDir)
  return current !== prev.inputSignature
}

function recordBuild(state: BuildState, key: string, srcDir: string): void {
  state[key] = { inputSignature: treeSignature(srcDir), builtAt: Date.now() }
}

/** Check if dist/ contains a 64-hex-char signature directory */
function hasModuleOutput(): boolean {
  const distRoot = join(ROOT, 'hypercomb-essentials', 'dist')
  if (!existsSync(distRoot)) return false
  return readdirSync(distRoot).some(name => /^[a-f0-9]{64}$/i.test(name))
}

// --- Angular cache hygiene ---
// Purges stale .angular/cache directories whose version folder doesn't match
// the installed @angular/build version.  This prevents NG0203 injection errors
// caused by serving pre-compiled component factories from a mismatched Angular.

function purgeStaleAngularCache(projectDir: string): void {
  const cacheRoot = join(projectDir, '.angular', 'cache')
  if (!existsSync(cacheRoot)) return

  // Installed @angular/build version is the one Angular CLI uses for caching
  let installedVersion: string | undefined
  try {
    const pkg = JSON.parse(readFileSync(join(projectDir, 'node_modules', '@angular', 'build', 'package.json'), 'utf8'))
    installedVersion = pkg.version
  } catch {
    // If we can't read the version, nuke everything to be safe
    console.log(`${TAG} cannot determine @angular/build version — clearing entire cache`)
    for (const entry of readdirSync(cacheRoot)) {
      const full = join(cacheRoot, entry)
      if (statSync(full).isDirectory()) {
        rmSync(full, { recursive: true, force: true })
        console.log(`${TAG} removed stale Angular cache: ${entry}`)
      }
    }
    return
  }

  for (const entry of readdirSync(cacheRoot)) {
    if (entry === installedVersion) continue
    const full = join(cacheRoot, entry)
    if (statSync(full).isDirectory()) {
      rmSync(full, { recursive: true, force: true })
      console.log(`${TAG} removed stale Angular cache: ${entry} (installed: ${installedVersion})`)
    }
  }
}

// --- env.js generation ---
// Seeds localStorage with ANTHROPIC_API_KEY from the OS environment so browser
// code can call getApiKey() without manual setup.

function generateEnvJs(): void {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? ''
  const content = apiKey
    ? [
        '// Generated by prebuild \u2014 do not commit',
        `if (!localStorage.getItem('hc:anthropic-api-key')) {`,
        `  localStorage.setItem('hc:anthropic-api-key', ${JSON.stringify(apiKey)})`,
        `}`,
        '',
      ].join('\n')
    : '// No ANTHROPIC_API_KEY environment variable set\n'

  for (const app of ['hypercomb-web', 'hypercomb-dev', 'diamond-core-processor']) {
    const pubDir = join(ROOT, app, 'public')
    if (existsSync(pubDir)) {
      writeFileSync(join(pubDir, 'env.js'), content, 'utf8')
      console.log(`${TAG} wrote ${app}/public/env.js${apiKey ? ' (key present)' : ' (no key)'}`)
    }
  }
}

// Scans public/substrate/ in each app and writes a manifest.json listing
// every image file found. Runs every prebuild so users can just drop images
// into the folder without touching any code.
function generateSubstrateManifests(): void {
  const imageExts = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif', '.avif', '.bmp'])
  for (const app of ['hypercomb-web', 'hypercomb-dev', 'diamond-core-processor']) {
    const substrateDir = join(ROOT, app, 'public', 'substrate')
    if (!existsSync(substrateDir)) continue
    const images = readdirSync(substrateDir)
      .filter(name => {
        const dot = name.lastIndexOf('.')
        if (dot < 0) return false
        return imageExts.has(name.slice(dot).toLowerCase())
      })
      .sort()
    writeFileSync(
      join(substrateDir, 'manifest.json'),
      JSON.stringify({ images }, null, 2),
      'utf8',
    )
    console.log(`${TAG} wrote ${app}/public/substrate/manifest.json (${images.length} images)`)
  }
}

interface TrackManifestEntry {
  file: string
  title: string
  src: string
}

function formatTrackTitle(filePath: string): string {
  return basename(filePath, extname(filePath))
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase())
}

function generateTrackManifest(): void {
  const audioExts = new Set(['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.aac'])
  const publicDir = join(ROOT, 'hypercomb-web', 'public')
  const tracksDir = join(publicDir, 'tracks')

  mkdirSync(tracksDir, { recursive: true })

  const rootTracks = readdirSync(publicDir)
    .filter(name => {
      const full = join(publicDir, name)
      if (!statSync(full).isFile()) return false
      return audioExts.has(extname(name).toLowerCase())
    })
    .map(name => ({
      file: name,
      title: formatTrackTitle(name),
      src: `/${name}`,
    }))

  const nestedTracks = walkFiles(tracksDir, Array.from(audioExts))
    .map(fullPath => {
      const relativePath = relative(tracksDir, fullPath).replace(/\\/g, '/')
      return {
        file: relativePath,
        title: formatTrackTitle(relativePath),
        src: `/tracks/${relativePath}`,
      }
    })

  const tracks = [...rootTracks, ...nestedTracks]
    .sort((left, right) => left.title.localeCompare(right.title))

  writeFileSync(
    join(tracksDir, 'manifest.json'),
    JSON.stringify({ tracks }, null, 2),
    'utf8',
  )

  console.log(`${TAG} wrote hypercomb-web/public/tracks/manifest.json (${tracks.length} tracks)`)
}

// --- main ---

async function main() {
  console.log(`${TAG} target=${target}`)

  // Generate env.js before anything else so the key is available at first serve
  generateEnvJs()

  // Scan public/substrate/ and write manifest.json in each app
  generateSubstrateManifests()

  // Scan public audio assets and write a manifest for the front-page music player
  generateTrackManifest()

  const state = loadState()
  let coreDirty = false

  // Purge stale Angular caches before anything else
  purgeStaleAngularCache(join(ROOT, 'hypercomb-web'))
  purgeStaleAngularCache(join(ROOT, 'hypercomb-dev'))

  // Step 1: Core
  const coreSrc = join(ROOT, 'hypercomb-core', 'src')
  const coreMarker = join(ROOT, 'hypercomb-core', 'dist', 'index.js')
  if (needsBuild(state, 'core', coreSrc, coreMarker)) {
    console.log(`${TAG} building core...`)
    run(tsupRun(), join(ROOT, 'hypercomb-core'))
    recordBuild(state, 'core', coreSrc)
    coreDirty = true
  } else {
    console.log(`${TAG} core — up to date`)
  }

  const essentialsSrc = join(ROOT, 'hypercomb-essentials', 'src')
  const essentialsDir = join(ROOT, 'hypercomb-essentials')

  // Module build (signature-addressed bundles) + web vendor staging.
  // Runs for both targets so web's public/content/ is always pre-staged.
  // Must run BEFORE the dev tsup build because build-module.ts wipes dist/.
  {
    const moduleUpToDate = !coreDirty
      && hasModuleOutput()
      && !needsBuild(state, 'essentials:module', essentialsSrc)

    if (!moduleUpToDate) {
      console.log(`${TAG} building essentials modules...`)
      run(nodeRun('./scripts/run-prepare.cjs'), essentialsDir)
      run(tsxRun('./scripts/build-module.ts', ['--local']), essentialsDir)
      recordBuild(state, 'essentials:module', essentialsSrc)

      console.log(`${TAG} copying modules to dcp...`)
      run(tsxRun('./scripts/copy-to-dcp.ts'), essentialsDir)
    } else {
      console.log(`${TAG} essentials modules — up to date`)
    }

    // Core vendor copy
    const coreVendorMarker = join(ROOT, 'hypercomb-web', 'public', 'core', 'dist', 'index.js')
    if (coreDirty || !existsSync(coreVendorMarker)) {
      console.log(`${TAG} copying core to web public...`)
      run(nodeRun('./scripts/build-core-vendor.cjs'), join(ROOT, 'hypercomb-web'))
      state['web:core-vendor'] = { builtAt: Date.now() }
    } else {
      console.log(`${TAG} core vendor — up to date`)
    }

    // Pixi vendor (one-time)
    const pixiMarker = join(ROOT, 'hypercomb-web', 'public', 'vendor', 'pixi.runtime.js')
    if (!existsSync(pixiMarker)) {
      console.log(`${TAG} bundling pixi.js vendor...`)
      run(tsxRun('./scripts/build-pixi-vendor.ts'), join(ROOT, 'hypercomb-web'))
      state['web:pixi-vendor'] = { builtAt: Date.now() }
    } else {
      console.log(`${TAG} pixi vendor — up to date`)
    }
  }

  if (target === 'dev') {
    // Dev: needs tsup build (dist/index.js) for direct imports via file: link.
    // Runs after module build — tsup overwrites dist/ but modules are already copied to web.
    const essentialsMarker = join(ROOT, 'hypercomb-essentials', 'dist', 'index.js')
    if (coreDirty || needsBuild(state, 'essentials', essentialsSrc, essentialsMarker)) {
      console.log(`${TAG} building essentials (prebuild + tsup)...`)
      run(nodeRun('./scripts/run-prepare.cjs'), essentialsDir)
      run(tsupRun(), essentialsDir, true) // DTS may fail on pixi.js types; ESM/CJS still succeed
      // Only record if the output actually exists
      if (existsSync(join(essentialsDir, 'dist', 'index.js'))) {
        recordBuild(state, 'essentials', essentialsSrc)
      }
    } else {
      console.log(`${TAG} essentials — up to date`)
    }
  }

  saveState(state)

  // Start local nostr relay for dev if not already running
  if (target === 'dev') {
    await ensureLocalRelay()
  }

  console.log(`${TAG} done`)
}

const RELAY_PORT = 7777

function isRelayRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ port: RELAY_PORT, host: '127.0.0.1' }, () => {
      sock.destroy()
      resolve(true)
    })
    sock.on('error', () => resolve(false))
    sock.setTimeout(500, () => { sock.destroy(); resolve(false) })
  })
}

async function ensureLocalRelay(): Promise<void> {
  if (await isRelayRunning()) {
    console.log(`${TAG} local nostr relay — already running on port ${RELAY_PORT}`)
    return
  }
  console.log(`${TAG} starting local nostr relay on port ${RELAY_PORT}...`)
  const child = spawn(process.execPath, [tsxCli, join(__dirname, 'local-relay.ts')], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  // Wait for the relay to bind (tsx startup can be slow on first run)
  await new Promise(r => setTimeout(r, 4000))
  if (await isRelayRunning()) {
    console.log(`${TAG} local nostr relay — started (pid ${child.pid})`)
  } else {
    console.warn(`${TAG} ⚠ local nostr relay may not have started — check port ${RELAY_PORT}`)
  }
}

main()