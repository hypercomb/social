// One-command sync: theme any behaviors-mirror cell that lacks its card.
// walk (fresh census over the bridge) → gen (render every card) → push
// (idempotent: cells already wearing their exact card are skipped).
//
// Prereqs: broker running (scripts/bridge/run-bridge.cjs), ONE renderer tab
// on localhost:4250 with ?claudeBridge=1 in the REAL profile (Edge Default).
//
//   node scripts/behaviors-theme/sweep.cjs
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const here = __dirname
const run = (script) => {
  console.log(`\n── ${script} ──`)
  execFileSync(process.execPath, [path.join(here, script)], { stdio: 'inherit', cwd: here })
}

run('walk.cjs')               // → census.json (fresh, path-addressed)
run('gen-behavior-tiles.mjs') // → tiles/*.png + tiles/manifest.json
run('push-tiles.cjs')         // → hive (skips cells already themed)
