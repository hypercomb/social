// scripts/prebuild.ts
// Smart prebuild: detects source changes via mtime, only rebuilds what's needed.
// Usage: tsx scripts/prebuild.ts --target web|dev

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { execSync, spawn } from 'child_process'
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
  srcMtime?: number
  builtAt?: number
}

type BuildState = Record<string, StepState>

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

function maxMtime(dir: string): number {
  const files = walkFiles(dir, ['.ts', '.js', '.json'])
  let max = 0
  for (const f of files) {
    const mt = statSync(f).mtimeMs
    if (mt > max) max = mt
  }
  return max
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

function run(cmd: string, cwd: string, allowFailure = false): void {
  console.log(`${TAG} > ${cmd}`)
  try {
    execSync(cmd, { cwd, stdio: 'inherit' })
  } catch (e) {
    if (!allowFailure) throw e
    console.warn(`${TAG} ⚠ command exited with error (non-fatal)`)
  }
}

function needsBuild(state: BuildState, key: string, srcDir: string, outputMarker?: string): boolean {
  if (outputMarker && !existsSync(outputMarker)) return true
  const prev = state[key]
  if (!prev?.srcMtime) return true
  const current = maxMtime(srcDir)
  return current > prev.srcMtime
}

function recordBuild(state: BuildState, key: string, srcDir: string): void {
  state[key] = { srcMtime: maxMtime(srcDir), builtAt: Date.now() }
}

/** Check if dist/ contains a 64-hex-char signature directory */
function hasModuleOutput(): boolean {
  const distRoot = join(ROOT, 'hypercomb-essentials', 'dist')
  if (!existsSync(distRoot)) return false
  return readdirSync(distRoot).some(name => /^[a-f0-9]{64}$/i.test(name))
}

// --- main ---

async function main() {
  console.log(`${TAG} target=${target}`)
  const state = loadState()
  let coreDirty = false

  // Step 1: Core
  const coreSrc = join(ROOT, 'hypercomb-core', 'src')
  const coreMarker = join(ROOT, 'hypercomb-core', 'dist', 'index.js')
  if (needsBuild(state, 'core', coreSrc, coreMarker)) {
    console.log(`${TAG} building core...`)
    run('npm run build', join(ROOT, 'hypercomb-core'))
    recordBuild(state, 'core', coreSrc)
    coreDirty = true
  } else {
    console.log(`${TAG} core — up to date`)
  }

  const essentialsSrc = join(ROOT, 'hypercomb-essentials', 'src')
  const essentialsDir = join(ROOT, 'hypercomb-essentials')

  if (target === 'dev') {
    // Dev: needs tsup build (dist/index.js) for direct imports via file: link
    const essentialsMarker = join(ROOT, 'hypercomb-essentials', 'dist', 'index.js')
    if (coreDirty || needsBuild(state, 'essentials', essentialsSrc, essentialsMarker)) {
      console.log(`${TAG} building essentials (prepare + tsup)...`)
      run('npm run prepare', essentialsDir)
      run('npm run build', essentialsDir, true) // DTS may fail on pixi.js types; ESM/CJS still succeed
      // Only record if the output actually exists
      if (existsSync(join(essentialsDir, 'dist', 'index.js'))) {
        recordBuild(state, 'essentials', essentialsSrc)
      }
    } else {
      console.log(`${TAG} essentials — up to date`)
    }
  }

  if (target === 'web') {
    // Web: needs module build (signature-addressed bundles). build-module.ts wipes dist/,
    // so tsup output doesn't survive — and web doesn't need it (loads from OPFS at runtime).
    const moduleUpToDate = !coreDirty
      && hasModuleOutput()
      && !needsBuild(state, 'essentials:module', essentialsSrc)

    if (!moduleUpToDate) {
      console.log(`${TAG} building essentials modules...`)
      run('npm run prepare', essentialsDir)
      run('tsx ./scripts/build-module.ts --local', essentialsDir)
      recordBuild(state, 'essentials:module', essentialsSrc)

      console.log(`${TAG} copying modules to web...`)
      run('tsx ./scripts/copy-to-web.ts', essentialsDir)
    } else {
      console.log(`${TAG} essentials modules — up to date`)
    }

    // Core vendor copy
    const coreVendorMarker = join(ROOT, 'hypercomb-web', 'public', 'core', 'dist', 'index.js')
    if (coreDirty || !existsSync(coreVendorMarker)) {
      console.log(`${TAG} copying core to web public...`)
      run('node ./scripts/build-core-vendor.cjs', join(ROOT, 'hypercomb-web'))
      state['web:core-vendor'] = { builtAt: Date.now() }
    } else {
      console.log(`${TAG} core vendor — up to date`)
    }

    // Pixi vendor (one-time)
    const pixiMarker = join(ROOT, 'hypercomb-web', 'public', 'vendor', 'pixi.runtime.js')
    if (!existsSync(pixiMarker)) {
      console.log(`${TAG} bundling pixi.js vendor...`)
      run('npx tsx ./scripts/build-pixi-vendor.ts', join(ROOT, 'hypercomb-web'))
      state['web:pixi-vendor'] = { builtAt: Date.now() }
    } else {
      console.log(`${TAG} pixi vendor — up to date`)
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
  const child = spawn('npx', ['tsx', join(__dirname, 'local-relay.ts')], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    shell: true,
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
