#!/usr/bin/env node
// check-conversion-drift — did development change a panel AFTER we converted it?
//
//   node scripts/check-conversion-drift.cjs [--base development]
//
// THE FAILURE THIS EXISTS TO CATCH, which is silent by construction.
//
// The everything-is-a-beehavior campaign converts an Angular panel to a
// framework-free element and DELETES the Angular sources. Meanwhile
// development keeps working on the shell. If development edits a panel we
// have already retired, git reports a modify/delete conflict — and the
// obvious resolution ("we deleted it, take the deletion") throws their fix
// away without a trace. Nothing fails, no test goes red, and the bug they
// fixed quietly comes back in our port.
//
// Worse is the case with no conflict at all: development edits the panel on
// a commit we merged BEFORE converting, we port from stale bytes, and the
// merge is clean because the file is gone by then.
//
// So this walks it mechanically. For each converted panel it finds the commit
// that retired the Angular directory, then asks whether the base branch has
// any commit touching that directory which is NOT an ancestor of the
// retirement. Any hit is a change that either never reached the port or was
// resolved away.
//
// Run it BEFORE each conversion batch and after every merge from development.
// A clean run means every port was made from current bytes.

const { execFileSync } = require('child_process')
const path = require('path')

const REPO = path.resolve(__dirname, '..', '..')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : fallback
}

const BASE = String(arg('base', 'development'))
const UI = 'src/hypercomb-shared/ui'

const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (err) {
    return String(err.stdout ?? '')
  }
}

// Every Angular panel directory that once existed under ui/ and is gone now.
// Taken from history rather than a hand-kept list: a list would drift, and a
// panel missing from it is exactly the one that would slip through.
const everSeen = new Set(
  git('log', '--all', '--name-only', '--format=', '--', UI)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith(`${UI}/`))
    .map(line => line.slice(UI.length + 1).split('/')[0])
    .filter(Boolean))

const stillHere = new Set(
  git('ls-tree', '--name-only', 'HEAD', `${UI}/`)
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => l.slice(UI.length + 1)))

const retired = [...everSeen].filter(p => !stillHere.has(p)).sort()

if (!retired.length) {
  console.log('no retired panel directories found — nothing to check')
  process.exit(0)
}

console.log(`checking ${retired.length} retired panel directories against ${BASE}\n`)

const problems = []
let checked = 0

for (const panel of retired) {
  const dir = `${UI}/${panel}/`

  // The commit on OUR branch that removed the directory.
  const retiredAt = git('log', '-1', '--format=%H', '--diff-filter=D', 'HEAD', '--', dir).trim()
  if (!retiredAt) continue   // never actually deleted on this branch
  checked++

  // Base commits touching that directory which the retirement does NOT contain.
  const stray = git('log', '--format=%h %ci %s', `${retiredAt}..${BASE}`, '--', dir)
    .split('\n').map(l => l.trim()).filter(Boolean)

  if (stray.length) {
    problems.push({ panel, retiredAt: retiredAt.slice(0, 9), stray })
  }
}

console.log(`${checked} panels retired on this branch\n`)

if (!problems.length) {
  console.log(`CLEAN — ${BASE} has no change to any retired panel that the`)
  console.log('conversion did not already contain. Every port was made from')
  console.log('current bytes.')
  process.exit(0)
}

console.log(`DRIFT — ${problems.length} panel(s) changed on ${BASE} after being retired here.`)
console.log('Each of these is a change that must be ported forward BY HAND into the')
console.log('converted element, or deliberately declined. Resolving the merge toward')
console.log('the deletion loses it silently.\n')

for (const p of problems) {
  console.log(`  ${p.panel}   (retired here in ${p.retiredAt})`)
  for (const s of p.stray) console.log(`      ${s}`)
  console.log()
}

process.exit(1)
