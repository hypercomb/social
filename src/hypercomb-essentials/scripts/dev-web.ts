// hypercomb-essentials/scripts/dev-web.ts
import { spawn } from 'child_process'
import { existsSync, mkdirSync, statSync } from 'fs'
import { watchFile } from 'fs'
import { join, resolve } from 'path'

type Child = ReturnType<typeof spawn> | null

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const ESSENTIALS_ROOT = resolve(process.cwd())
const DIST_STAMP = join(ESSENTIALS_ROOT, 'dist', '.hc-build-stamp')

// defaults:
// - starts essentials build watch
// - starts hypercomb-web dev server
//
// overrides:
// - HC_WEB_DIR: path to web project (default ../hypercomb-web)
// - HC_WEB_SCRIPT: npm script name (default start)
// - HC_WEB_ARGS: extra args passed after "--" (space-delimited)
const WEB_DIR = resolve(ESSENTIALS_ROOT, process.env['HC_WEB_DIR'] ?? '../hypercomb-web')
const WEB_SCRIPT = process.env['HC_WEB_SCRIPT'] ?? 'start'
const WEB_ARGS = (process.env['HC_WEB_ARGS'] ?? '').trim().split(/\s+/).filter(Boolean)

let buildProc: Child = null
let webProc: Child = null

let lastStampMtime = 0
let restartTimer: NodeJS.Timeout | null = null
let restarting = false

const ensureDist = (): void => {
  const distDir = join(ESSENTIALS_ROOT, 'dist')
  if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true })
}

const readStampMtime = (): number => {
  try {
    return statSync(DIST_STAMP).mtimeMs
  } catch {
    return 0
  }
}

const spawnBuildWatch = (): Child => {
  return spawn(npmBin, ['run', 'build:watch'], {
    cwd: ESSENTIALS_ROOT,
    stdio: 'inherit',
    env: process.env
  })
}

const spawnWeb = (): Child => {
  const args = ['--prefix', WEB_DIR, 'run', WEB_SCRIPT]
  if (WEB_ARGS.length) args.push('--', ...WEB_ARGS)

  return spawn(npmBin, args, {
    cwd: ESSENTIALS_ROOT,
    stdio: 'inherit',
    env: process.env
  })
}

const killTree = async (pid: number): Promise<void> => {
  if (!pid || pid <= 0) return

  if (process.platform === 'win32') {
    await new Promise<void>((resolvePromise) => {
      const p = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
      p.on('exit', () => resolvePromise())
      p.on('error', () => resolvePromise())
    })
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // ignore
  }
}

const restartWeb = async (): Promise<void> => {
  if (!webProc?.pid) return
  if (restarting) return
  restarting = true

  const oldPid = webProc.pid

  // kill current web
  await killTree(oldPid)

  // start new web
  webProc = spawnWeb()

  restarting = false
}

const scheduleRestart = (): void => {
  if (restartTimer) clearTimeout(restartTimer)

  // debounce: multiple file writes during one build
  restartTimer = setTimeout(() => {
    void restartWeb()
  }, 350)
}

const start = (): void => {
  ensureDist()

  // start build watch + web server
  buildProc = spawnBuildWatch()
  webProc = spawnWeb()

  // baseline stamp state (avoid immediate restart on startup if stamp already exists)
  lastStampMtime = readStampMtime()

  // watch the single stamp file (written by build-module.ts at the end of each successful build)
  watchFile(DIST_STAMP, { interval: 200 }, () => {
    const mtime = readStampMtime()
    if (!mtime || mtime === lastStampMtime) return
    lastStampMtime = mtime
    scheduleRestart()
  })

  const shutdown = async (): Promise<void> => {
    try {
      if (buildProc?.pid) await killTree(buildProc.pid)
    } catch {
      // ignore
    }

    try {
      if (webProc?.pid) await killTree(webProc.pid)
    } catch {
      // ignore
    }

    process.exit(0)
  }

  process.on('SIGINT', () => { void shutdown() })
  process.on('SIGTERM', () => { void shutdown() })

  buildProc?.on('exit', (code) => {
    // if build watch dies, kill web too so the dev session ends cleanly
    void (async () => {
      if (webProc?.pid) await killTree(webProc.pid)
      process.exit(code ?? 0)
    })()
  })
}

start()
