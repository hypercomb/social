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
const shim = path.join(sourceRoot, 'hypercomb-shim')
const tour = path.join(root, 'dist', 'hypercomb-presentation.html')
const tourOg = path.join(root, 'og.png')
// The welcome page — desktop release status, the two browser utilities with
// their checksums and install steps, and its own copy of the door directory.
// It lives in documentation/ and was served nowhere; the apex is its home.
const downloads = path.join(sourceRoot, 'documentation', 'hypercomb.com')

if (!fs.existsSync(tour)) throw new Error('run build.cjs first — dist/hypercomb-presentation.html is missing')
if (!fs.existsSync(tourOg)) throw new Error('the presentation social image is missing — expected og.png')
if (!fs.existsSync(path.join(downloads, 'index.html'))) {
  throw new Error('the downloads page is missing — expected documentation/hypercomb.com/index.html')
}

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
build(shim, 'build:vendor')
// The shell only — no heap from this machine's module build. The packages the
// apex offers are the PUBLISHED ones: the publisher's signed install root,
// replicated in (every atom verified against its name) and listed in the
// host's packages pool. A root minted here would be one nobody signed, and a
// client following the publisher refuses it.
execFileSync(npm.program, [...npm.prefix, 'run', 'build', '--', '--no-content'], { cwd: shim, stdio: 'inherit' })
execFileSync(process.execPath, [
  path.join(root, 'stage-signed-package.mjs'), path.join(shim, 'dist'),
  // The host that holds published revisions today.
  '--from', 'https://jwize.com',
], { cwd: sourceRoot, stdio: 'inherit' })

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
  '--page', `downloads=${downloads}`,
]
if (process.argv.includes('--check-only')) deploy.push('--check-only')
execFileSync(process.execPath, deploy, { cwd: sourceRoot, stdio: 'inherit' })
