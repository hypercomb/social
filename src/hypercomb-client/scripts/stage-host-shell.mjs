// hypercomb-client/scripts/stage-host-shell.mjs
//
// Stage the shim build into the client as `host-shell`, the shell the app
// serves from Hive ▸ Serve This Hive.
//
// WHY THE SHIM AND NOT THE APP'S OWN FRONTEND: they are different artifacts
// for different readers. `app/frontend` is the Angular shell this window shows,
// baked for WebView2 with a static import map and no `/pin` — it is the app.
// `host-shell` is what a STRANGER'S BROWSER boots when it opens this machine's
// address, and the host contract is written against the shim: index.html +
// main.js at the root, `/pin` naming a bootstrap bundle whose bytes hash to it,
// a service worker that gives modules their type, and the packages a
// first-time visitor installs from. Only the shim build mints that set.
//
//   npm run build:shim          (from src/ — builds hypercomb-shim/dist)
//   node hypercomb-client/scripts/stage-host-shell.mjs
//
// Then `npm run tauri build` bundles it as a resource. Verify a running host
// with the same checker every other host is held to:
//
//   node hypercomb-shim/host/check-host.mjs http://<address>

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, '../../hypercomb-shim/dist')
const out = join(here, '../app/host-shell')

// A directory that is missing is a build that was not run; a directory without
// a pin is a build that half-ran. Both are the same failure to the operator —
// "serve" says the shell is missing — so both stop here, where the fix is
// obvious.
for (const required of ['index.html', 'pin', 'main.js']) {
  if (!existsSync(join(dist, required))) {
    console.error(`[stage-host-shell] ${dist} is not a shim build — missing ${required}`)
    console.error('[stage-host-shell] build one first:  npm run build:shim   (from src/)')
    process.exit(1)
  }
}

// Mirror, not merge. The staged shell is a build artifact with no user content
// in it, and a stale file from an older shim — an orphaned chunk, a retired
// worker — would be served forever otherwise. The one thing kept is the README
// that holds the directory in git, so the bundler's resource glob always
// matches something.
if (existsSync(out)) {
  for (const name of readdirSync(out)) {
    if (name === 'README.md') continue
    rmSync(join(out, name), { recursive: true, force: true })
  }
} else {
  mkdirSync(out, { recursive: true })
}

for (const name of readdirSync(dist)) {
  cpSync(join(dist, name), join(out, name), { recursive: true })
}

const count = (dir) =>
  readdirSync(dir).reduce(
    (total, name) =>
      total + (statSync(join(dir, name)).isDirectory() ? count(join(dir, name)) : 1),
    0,
  )

writeFileSync(
  join(out, 'README.md'),
  `# host-shell

Staged by \`scripts/stage-host-shell.mjs\` from \`hypercomb-shim/dist\`. Every
file here except this one is a build artifact and is gitignored.

It is the shell a visitor's browser boots when this app serves its hive
(Hive ▸ Serve This Hive). The contract it has to satisfy is
\`hypercomb-shim/host/README.md\`, and \`check-host.mjs\` tests it.
`,
)

console.log(`[stage-host-shell] staged ${count(out)} files -> ${out}`)

// ── THE VISITOR SHELL ──────────────────────────────────────────────────────
// A hostname switched on as a DOOR (`serve at <domain>`, a host:activation in
// its bag) is answered with hypercomb-web's visitor build, its page carrying
// the door — the same artifact and the same record the Cloudflare worker
// serves (crates/serve resolve_for). Optional: with no visitor build the app
// still serves, and a door domain gets the host shell instead.
//
//   npm --prefix hypercomb-web run build:visitor     (from src/)
const visitorDist = join(here, '../../hypercomb-web/dist/hypercomb-web/visitor')
const visitorOut = join(here, '../app/visitor-shell')
const VISITOR_README = `# visitor-shell

Staged by \`scripts/stage-host-shell.mjs\` from hypercomb-web's visitor build
(\`npm --prefix hypercomb-web run build:visitor\`). Every file here except this
one is a build artifact and is gitignored.

It is the page a visitor's browser opens at a domain this app serves as a
DOOR — a hostname whose bag holds an enabled \`host:activation\`. The server
injects the door record (\`#hc-door\`) the way the Cloudflare worker does.
`
if (existsSync(visitorOut)) {
  for (const name of readdirSync(visitorOut)) {
    if (name === 'README.md') continue
    rmSync(join(visitorOut, name), { recursive: true, force: true })
  }
} else {
  mkdirSync(visitorOut, { recursive: true })
}
if (existsSync(join(visitorDist, 'index.html'))) {
  for (const name of readdirSync(visitorDist)) {
    cpSync(join(visitorDist, name), join(visitorOut, name), { recursive: true })
  }
  console.log(`[stage-host-shell] staged ${count(visitorOut)} visitor files -> ${visitorOut}`)
} else {
  console.warn(`[stage-host-shell] no visitor build at ${visitorDist} — door domains will get the host shell`)
}
writeFileSync(join(visitorOut, 'README.md'), VISITOR_README)
