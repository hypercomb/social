#!/usr/bin/env node
// One-click installer for hypercomb-relay
// Usage: node setup.js [-- relay args]
// Example: node setup.js -- --port 8888 --memory

import { execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const MIN_NODE_MAJOR = 20

// ── preflight ───────────────────────────────────────────────────────────────

function checkNode() {
  const major = parseInt(process.versions.node.split('.')[0], 10)
  if (major < MIN_NODE_MAJOR) {
    console.error(`\n  Node.js ${MIN_NODE_MAJOR}+ required (found ${process.versions.node})`)
    console.error('  Download: https://nodejs.org\n')
    process.exit(1)
  }
}

// ── install ─────────────────────────────────────────────────────────────────

function installDependencies() {
  const nodeModules = join(__dirname, 'node_modules')
  if (existsSync(nodeModules)) {
    console.log('  dependencies already installed')
    return
  }
  console.log('  installing dependencies...')
  try {
    execSync('npm install --no-fund --no-audit', { cwd: __dirname, stdio: 'inherit' })
    console.log('  dependencies installed')
  } catch {
    console.error('\n  npm install failed — check the output above')
    process.exit(1)
  }
}

// ── start relay ─────────────────────────────────────────────────────────────

function startRelay(extraArgs) {
  const relayPath = join(__dirname, 'relay.js')
  console.log('\n  starting hypercomb-relay...\n')
  const child = spawn(process.execPath, [relayPath, ...extraArgs], {
    cwd: __dirname,
    stdio: 'inherit'
  })
  child.on('exit', (code) => process.exit(code ?? 0))
  process.on('SIGINT', () => child.kill('SIGINT'))
  process.on('SIGTERM', () => child.kill('SIGTERM'))
}

// ── main ────────────────────────────────────────────────────────────────────

console.log('\n  hypercomb-relay setup')
console.log('  --------------------')

checkNode()
installDependencies()

// everything after `--` is forwarded to relay.js
const sep = process.argv.indexOf('--')
const relayArgs = sep !== -1 ? process.argv.slice(sep + 1) : []

startRelay(relayArgs)
