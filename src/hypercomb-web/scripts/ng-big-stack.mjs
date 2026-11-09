// Run the Angular CLI with a larger V8 stack.
//
// `ng build` hands every file under `public/` to ONE call that spreads them as
// arguments (@angular/build bundler-execution-result.js, `assetFiles.push(
// ...assets)`). `public/content` is the content heap the essentials build
// copies in and never prunes, so on a machine that has built for a while it
// holds well over a hundred thousand files, and the spread overflows V8's
// default stack: "Maximum call stack size exceeded", with no frame of ours in
// it (160,066 files on the owner's machine, 2026-11-09).
//
// The fix is room, not recursion: a bigger stack takes the same call. Used by
// `build:visitor`; any `ng` argument passes straight through.
//
//   node scripts/ng-big-stack.mjs build --configuration visitor

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const STACK_KB = 16000
const ng = createRequire(import.meta.url).resolve('@angular/cli/bin/ng.js')
const run = spawnSync(process.execPath, [`--stack-size=${STACK_KB}`, ng, ...process.argv.slice(2)], { stdio: 'inherit' })
process.exit(run.status ?? 1)
