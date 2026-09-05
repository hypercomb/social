#!/usr/bin/env node
// scripts/wordless-verbs.cjs
//
// THE AUDIT BEHIND `documentation/every-act-has-a-word.md`.
//
// Prints three numbers and two lists:
//   • the live behaviour census (every word the command line answers)
//   • which of those declared a `machine` grammar (what a speaking model may say)
//   • every UI action name the app dispatches that has NO behaviour word at all
//
// The last list is the point. A capability with no word does not exist to a
// participant who is speaking, and does not exist at all to a model with no
// pointer and no bridge — so this script is how we find out what is still
// unsayable, mechanically, rather than by remembering.
//
//   node scripts/wordless-verbs.cjs

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const ESSENTIALS = path.join(ROOT, 'hypercomb-essentials', 'src')
const SHARED = path.join(ROOT, 'hypercomb-shared')

const SKIP = new Set(['node_modules', 'dist', '.angular'])

function* sources(dir) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* sources(full)
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) yield full
  }
}

const census = new Set()
const declared = new Set()

for (const file of sources(ESSENTIALS)) {
  const code = fs.readFileSync(file, 'utf8')
  const commands = [...code.matchAll(/(?:readonly )?command = '([a-z][a-z0-9-]*)'/g)].map(m => m[1])
  const names = [...code.matchAll(/\{ name: '([a-z][a-z0-9-]*)',\s*\n?\s*description:/g)].map(m => m[1])
  for (const word of [...commands, ...names]) census.add(word)

  // A queen declares `override machine = {`; a manual provider carries
  // `machine: {` inside its behaviour literal.
  if (/override machine = \{/.test(code)) for (const word of commands) declared.add(word)
  for (const block of code.matchAll(/\{ name: '([a-z][a-z0-9-]*)',[\s\S]{0,1500}?machine: \{/g)) {
    declared.add(block[1])
  }
}

const actions = new Set()
for (const base of [ESSENTIALS, SHARED]) {
  for (const file of sources(base)) {
    const code = fs.readFileSync(file, 'utf8')
    for (const m of code.matchAll(/action: '([a-z][a-z0-9-]*)'/g)) actions.add(m[1])
  }
}

const wordless = [...actions].filter(name => !census.has(name)).sort()

console.log(`behaviours in the census:        ${census.size}`)
console.log(`declaring a machine grammar:     ${declared.size}  ${[...declared].sort().join(' ')}`)
console.log(`words with no machine grammar:   ${census.size - declared.size}  (default-deny — this is the policy)`)
console.log()
console.log(`UI verbs with NO behaviour word: ${wordless.length}`)
for (const name of wordless) console.log(`  ${name}`)
