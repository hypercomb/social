// Compatibility entrypoint for deploying hypercomb.com.
//
// The framework-free host shell owns the apex. The assembled presentation is
// retained at /tour/ instead of replacing /pin, the heap, and the host console,
// and welcome.cjs stages the links back onto the shell's own card, so taking
// the apex for the host did not cost the site its front door.
// Requires `az login` and network access.
//
//   node scripts/presentation/build.cjs
//   node scripts/presentation/deploy-azure.cjs

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const welcome = require('./welcome.cjs')

const root = __dirname
const sourceRoot = path.join(root, '..', '..')
const core = path.join(sourceRoot, 'hypercomb-core')
const runtime = path.join(sourceRoot, 'hypercomb-runtime')
const essentials = path.join(sourceRoot, 'hypercomb-essentials')
const shim = path.join(sourceRoot, 'hypercomb-shim')
const tour = path.join(root, 'dist', 'hypercomb-presentation.html')
const tourOg = path.join(root, 'og.png')

if (!fs.existsSync(tour)) throw new Error('run build.cjs first — dist/hypercomb-presentation.html is missing')
if (!fs.existsSync(tourOg)) throw new Error('the presentation social image is missing — expected og.png')

let npm = { program: 'npm', prefix: [] }
if (process.platform === 'win32') {
  const inherited = process.env.npm_execpath
  const bundled = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  const cli = inherited && fs.existsSync(inherited) ? inherited : bundled
  if (!fs.existsSync(cli)) throw new Error('npm-cli.js was not found beside Node or in npm_execpath')
  npm = { program: process.execPath, prefix: [cli] }
}
const build = (cwd, script) => execFileSync(npm.program, [...npm.prefix, 'run', script], { cwd, stdio: 'inherit' })

// None of these generated directories are committed. Build the entire input
// chain so a clean checkout cannot deploy stale content from somebody's last
// local run (or fail only after production deployment has started).
build(core, 'build')
build(runtime, 'build')
build(essentials, 'build:module')
build(shim, 'build:vendor')
build(shim, 'build')

// Written after the builds, from the directory the last presentation build
// proved — the same doors the splash bakes in.
const frontDoor = welcome.write()

const deploy = [
  path.join(shim, 'host', 'deploy-azure.mjs'),
  '--app', 'pbs-hypercomb-com',
  '--group', 'swa-hypercomb-prod-west-001',
  '--domain', 'hypercomb.com',
  '--tour', tour,
  '--tour-og', tourOg,
  '--welcome', frontDoor,
]
if (process.argv.includes('--check-only')) deploy.push('--check-only')
execFileSync(process.execPath, deploy, { cwd: sourceRoot, stdio: 'inherit' })
