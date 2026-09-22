#!/usr/bin/env node
// jev-golden — decide every stored Jev decision again under candidate
// thresholds, offline, and print what would change (jev-creative-plan.md §3).
//
//   node scripts/jev-golden.cjs [candidates.json]
//
// Needs the broker (ws://localhost:2401) with the authoring hive attached.
// It emits the read-only `jev:replay` intent and reads `jev:replay-result`:
// no Jev call is made and nothing in the hive is written. Change JEV_GATES
// only by hand, from this table, and record the run in jev-decisions.md §9.
//
// candidates.json (optional): [{ "name": "reads-.5", "gates": { "readNeeded": 0.5 } },
//                             { "name": "adds-.6", "choice": { "additive": 0.6 } }]
const fs = require('fs')
const WebSocket = require('ws')

const DEFAULT = [
  { name: 'reads .50', gates: { readNeeded: 0.5 } },
  { name: 'toward .85', gates: { toward: 0.85 } },
  { name: 'adds at .60', choice: { additive: 0.6 } },
  { name: 'edits at .75', choice: { editing: 0.75 } },
  { name: 'grounded .80', gates: { grounded: 0.8 } },
  { name: 'all looser', gates: { readNeeded: 0.5, toward: 0.85, grounded: 0.8 }, choice: { additive: 0.6, editing: 0.75 } },
]
const candidates = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : DEFAULT

let counter = 0
const ask = req => new Promise((resolve, reject) => {
  const ws = new WebSocket('ws://localhost:2401')
  const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, 10_000)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id: `golden-${Date.now()}-${++counter}` })))
  ws.on('message', raw => { clearTimeout(timer); ws.close(); resolve(JSON.parse(String(raw))) })
  ws.on('error', error => { clearTimeout(timer); reject(error) })
})
const sleep = ms => new Promise(r => setTimeout(r, ms))

;(async () => {
  const started = Date.now()
  const sent = await ask({ op: 'effect-emit', cell: 'jev:replay', payload: { candidates } })
  if (!sent.ok) throw new Error(sent.error || 'the hive refused the replay')
  let result
  for (let i = 0; i < 60 && !result; i++) {
    await sleep(500)
    const last = await ask({ op: 'effect-last', cell: 'jev:replay-result' })
    if (last.ok && last.data?.last?.at >= started) result = last.data.last
  }
  if (!result) throw new Error('no replay result within 30 seconds — is the hive attached and on this build?')
  const pad = (v, n) => String(v).padEnd(n)
  console.log(`\n${pad('candidate', 16)}${pad('decisions', 11)}${pad('same', 6)}${pad('newly on its own: ran/skipped/other', 38)}newly held: ran/skipped/other`)
  for (const r of result.reports) {
    const a = r.newlyAutomatic, h = r.newlyHeld
    console.log(`${pad(r.name, 16)}${pad(r.decisions, 11)}${pad(r.same, 6)}${pad(`${a.ran}/${a.skipped}/${a.other}`, 38)}${h.ran}/${h.skipped}/${h.other}`)
  }
  const skipped = Object.entries(result.skipped ?? {})
  if (skipped.length) console.log(`\nnot replayed: ${skipped.map(([why, n]) => `${n} ${why}`).join(', ')}`)
  // WHAT JEV HAS DONE HERE (older hives answer without these fields).
  const plans = Object.entries(result.plans ?? {}).sort((a, b) => b[1] - a[1])
  if (plans.length) console.log(`\noutcomes by plan: ${plans.map(([key, n]) => `${key} ${n}`).join(' · ')}`)
  const speeds = Object.entries(result.speeds ?? {})
  if (result.turns !== undefined) console.log(`turns timed: ${result.turns}${speeds.length ? ` · median ${speeds.map(([path, s]) => `${path} ${s.ms}ms over ${s.turns}${s.firstMs ? ` (first text ${s.firstMs}ms)` : ''}`).join(' · ')}` : ''}`)
  console.log('\nA skipped change a candidate would run on its own is a gate set too low.')
})().catch(error => { console.error(error.message); process.exit(1) })
