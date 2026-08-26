#!/usr/bin/env node
// shrink-progress — how far through the everything-is-a-beehavior shrink are we?
//
//   node scripts/shrink-progress.cjs
//
// Measured, never remembered. Two numbers, because they disagree and the
// disagreement is the honest part:
//
//   BY PANEL   — how many of the registry-fed surfaces have converted.
//   BY VOLUME  — how much of the code has actually moved.
//
// They diverge because the campaign converted the small, cold panels first.
// Quoting the panel count alone would flatter the progress; quoting volume
// alone would hide that most of the RECIPE work is done and what remains is a
// few large panels. Both, always.
//
// Volume converted is measured as the lines this branch DELETED from
// hypercomb-shared/ui against development — the real thing the campaign is
// shrinking. Remaining is the live line count of the panel directories that
// still register a shell surface.

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '..', '..')
const UI = path.join(REPO, 'src', 'hypercomb-shared', 'ui')

// Phase 3 and 4 line estimates come from the plan's own inventory sweep; they
// are approximate and labelled as such wherever they are printed.
const PHASE_3_EST = 9300
const PHASE_4_EST = 5900

const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (err) {
    return String(err.stdout ?? '')
  }
}

const COUNTABLE = /\.(ts|html|scss)$/
const isSpec = f => f.endsWith('.spec.ts')

function linesIn(dir) {
  let total = 0
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) { total += linesIn(p); continue }
    if (!COUNTABLE.test(name) || isSpec(name)) continue
    total += fs.readFileSync(p, 'utf8').split('\n').length
  }
  return total
}

// ── converted: what this branch removed from shared/ui ────────────────────
const stat = git('diff', 'development...HEAD', '--shortstat', '--', 'src/hypercomb-shared/ui/')
const deleted = Number((stat.match(/(\d+) deletions?/) ?? [0, 0])[1])

// ── remaining: panel dirs that still register a surface ───────────────────
const remaining = []
for (const name of fs.readdirSync(UI)) {
  const dir = path.join(UI, name)
  if (!fs.statSync(dir).isDirectory()) continue
  if (name === 'shell-surfaces') continue          // the host, not a panel
  const registers = fs.readdirSync(dir).some(f =>
    f.endsWith('.ts') && !isSpec(f) &&
    fs.readFileSync(path.join(dir, f), 'utf8').includes('registerShellSurface'))
  if (registers) remaining.push({ name, lines: linesIn(dir) })
}
remaining.sort((a, b) => b.lines - a.lines)

const remainingLines = remaining.reduce((s, p) => s + p.lines, 0)
const phase2Total = deleted + remainingLines

// Panels converted = directories this branch deleted that used to register.
const deletedDirs = new Set(
  git('log', '--diff-filter=D', '--name-only', '--format=', 'development..HEAD',
      '--', 'src/hypercomb-shared/ui/')
    .split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => l.split('/')[3]).filter(Boolean))

const convertedPanels = deletedDirs.size
const totalPanels = convertedPanels + remaining.length

const pct = (a, b) => b ? ((a / b) * 100).toFixed(1) : '0.0'

console.log('everything-is-a-beehavior — shrink progress\n')
console.log(`  PHASE 2 by panel : ${convertedPanels}/${totalPanels}  (${pct(convertedPanels, totalPanels)}%)`)
console.log(`  PHASE 2 by volume: ${deleted.toLocaleString()}/${phase2Total.toLocaleString()} lines  (${pct(deleted, phase2Total)}%)`)

const campaignTotal = phase2Total + PHASE_3_EST + PHASE_4_EST
console.log(`  WHOLE CAMPAIGN   : ${pct(deleted, campaignTotal)}%  (phases 3-4 estimated at ${(PHASE_3_EST + PHASE_4_EST).toLocaleString()} lines)`)

console.log(`\n  ${remaining.length} panels left, heaviest first:`)
for (const p of remaining.slice(0, 8)) {
  console.log(`    ${String(p.lines).padStart(6)}  ${p.name}`)
}
if (remaining.length > 8) {
  const rest = remaining.slice(8)
  console.log(`    ${String(rest.reduce((s, p) => s + p.lines, 0)).padStart(6)}  … and ${rest.length} more`)
}

// The gap between the two percentages IS the remaining risk, so say it out loud.
const byPanel = Number(pct(convertedPanels, totalPanels))
const byVolume = Number(pct(deleted, phase2Total))
if (byPanel - byVolume > 10) {
  console.log(`\n  NOTE: ${(byPanel - byVolume).toFixed(0)} points ahead by panel count than by volume —`)
  console.log('  the small, cold panels went first. What remains is heavier per panel.')
}
