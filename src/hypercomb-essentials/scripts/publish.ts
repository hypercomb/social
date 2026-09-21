// publish — the ONE act that makes a revision.
//
//   npm run publish:revision                  → a new revision under the default name ("essentials")
//   npm run publish:revision -- <name>        → a new revision under <name>; a name that has
//                                      not been used yet starts a new named head
//   npm run publish:revision -- <name> --no-build   ship what dist already holds
//
// A build is not a revision. `build:module` copies bytes for local work and
// stamps nothing; a revision exists only because this ran. It builds (the cache
// makes an unchanged tree free), appends the package to the host's
// `host:packages` pool under the name — the member's label is the name, its
// file date is the revision's date — and stamps the signed `install:<name>`
// root through the authoring browser, so followers of that name are told.
// The stamp is REQUIRED: a publish nobody was offered exits non-zero.
//
// Unnamed always means the default name, never "whatever was published last" —
// so the same command means the same thing every time it is run.

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_NAME = 'essentials'
const MAX_NAME = 48

const args = process.argv.slice(2)
const skipBuild = args.includes('--no-build')
const asked = args.find(arg => !arg.startsWith('--')) ?? ''

// A name is also an install channel (`install:<name>`), so it must be one:
// lowercase, digits and hyphens, starting with a letter.
const name = asked
  ? asked.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_NAME).replace(/-+$/, '')
  : DEFAULT_NAME

if (!/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error(`[publish] "${asked}" is not a usable name — use letters, digits and hyphens, starting with a letter`)
  process.exit(1)
}

const run = (label: string, script: string, scriptArgs: string[] = []): void => {
  console.log(`\n[publish] ${label}`)
  const result = spawnSync('npx', ['tsx', `./scripts/${script}`, ...scriptArgs], { cwd: ROOT, stdio: 'inherit', shell: true })
  if (result.status !== 0) {
    console.error(`\n[publish] STOPPED at "${label}" — nothing was announced`)
    process.exit(result.status ?? 1)
  }
}

console.log(`[publish] revision under "${name}"${name === DEFAULT_NAME ? ' (the default name)' : asked !== name ? ` (from "${asked}")` : ''}`)

if (!skipBuild) run('build', 'build-module.ts')
run('ship', 'copy-content.ts', ['--publish', '--name', name])
run('announce', 'stamp-install-channel.ts', [name, '--require'])

console.log(`\n[publish] PUBLISHED under "${name}" — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`)
