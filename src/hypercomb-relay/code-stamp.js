// code-stamp.js
//
// WHICH CODE IS THIS PROCESS RUNNING? (jwize 2026-11-09: "this needs to be
// enforced somehow so that we never reach this state in the first place.")
//
// A relay is a long-lived process: it runs the relay.js it STARTED from, not
// the one on disk. On 2026-11-09 a fix to how it answers a miss was written,
// tested and committed — and the relay behind jwize.com, started an hour
// earlier, went on answering the old way for the rest of the day. Nothing
// said so; the only symptom was a console full of errors in every hive that
// followed it.
//
// The stamp is the signature of the code a process is made of: sha256 over
// the entry file and every local file it imports, each named. The relay takes
// it once at start and says it in its NIP-11 document (`code`), and says
// `stale: true` once the same walk over the disk gives another answer.
// `check-running.mjs` asks a relay and compares — it runs after every build.
//
// Only relative imports are followed (`./x.js`, `./x.json`): a dependency
// under node_modules changes with an install, which restarts nothing here.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g

/** The entry file and every local file it reaches by a relative import,
 *  as absolute paths, sorted. A file that cannot be read is left out. */
export function codeFiles(entry) {
  const seen = new Set()
  const walk = (file) => {
    if (seen.has(file)) return
    let text
    try { text = readFileSync(file, 'utf8') } catch { return }
    seen.add(file)
    if (!/\.[cm]?js$/i.test(file)) return
    for (const match of text.matchAll(IMPORT)) walk(resolve(dirname(file), match[1]))
  }
  walk(resolve(entry))
  return [...seen].sort()
}

/** sha256 over each file's name (relative to the entry's directory, forward
 *  slashes) and its bytes — line endings folded, so a checkout that rewrites
 *  them is the same code. */
export function codeStamp(entry) {
  const root = dirname(resolve(entry))
  const hash = createHash('sha256')
  for (const file of codeFiles(entry)) {
    hash.update(relative(root, file).replace(/\\/g, '/'))
    hash.update('\0')
    hash.update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))
    hash.update('\0')
  }
  return hash.digest('hex')
}
