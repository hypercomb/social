#!/usr/bin/env node
// hypercomb-shim/host/cli.mjs
//
// `@hypercomb/host` — the whole command surface for running a Hypercomb node.
//
//   npx @hypercomb/host serve                 run it locally
//   npx @hypercomb/host deploy --project x    put it on Cloudflare Pages
//   npx @hypercomb/host check <url>           verify any origin against the contract
//
// WHAT THIS PACKAGE SHIPS is a built `dist/` — a complete, servable origin: the
// shell, the service worker, and the pinned bootstrap bundle. It carries no
// application package or locale catalog. There is deliberately no `build`
// command in the installed package: it serves bytes built for the platform.
//
// CREDENTIALS ARE NEVER HANDLED HERE. `deploy` shells out to wrangler, which
// reads CLOUDFLARE_API_TOKEN from the environment or an existing login. Setting
// someone up on their account means they run this with their own token.

import { spawn } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')
const dist = resolve(pkgRoot, 'dist')

const [command, ...rest] = process.argv.slice(2)

const usage = `
@hypercomb/host — run a Hypercomb node.

  hypercomb-host serve [port]              serve the bundled dist (default 4270)
  hypercomb-host deploy --project <name>   deploy to Cloudflare Pages
                        [--domain <host>] [--branch <branch>]
  hypercomb-host check <url>               verify an origin against the host contract

A cold host serves the pure shell. Creations and revisions arrive through
signed content and meaning pools; they are not bundled into this package.

Deploy authenticates through wrangler: \`npx wrangler login\`, or set
CLOUDFLARE_API_TOKEN. This tool never asks for, prints, or stores a token.
`

// NO SHELL for a real executable. On Windows `process.execPath` lives under
// "Program Files", and `shell: true` concatenates arguments unescaped — the
// space splits the command and cmd.exe reports that it cannot find a program
// called "C:\Program". A shell is only needed to resolve PATH-based launchers
// like npx, so it is opt-in per call rather than a platform default.
const run = (cmd, args, { shell = false } = {}) => new Promise((done, fail) => {
  const child = spawn(cmd, args, { stdio: 'inherit', shell })
  child.on('error', fail)
  child.on('close', code => code === 0 ? done() : fail(Object.assign(new Error(`exited ${code}`), { code })))
})

const requireDist = async () => {
  try {
    await access(resolve(dist, 'index.html'))
    // A host with no pin can serve a shell but can never acquire anything —
    // fail here rather than after someone has pointed a domain at it.
    await access(resolve(dist, 'pin'))
  } catch {
    console.error(`[host] no built origin at ${dist}`)
    console.error('[host] a published @hypercomb/host ships one; in the monorepo run `npm run build:shim:pure`.')
    process.exit(1)
  }
}

try {
  switch (command) {
    case 'serve': {
      await requireDist()
      await run(process.execPath, [resolve(here, 'serve.mjs'), dist, rest[0] ?? '4270'])
      break
    }
    case 'deploy': {
      await requireDist()
      await run(process.execPath, [resolve(here, 'deploy-cloudflare.mjs'), ...rest])
      break
    }
    case 'check': {
      if (!rest[0]) { console.error('usage: hypercomb-host check <url>'); process.exit(2) }
      await run(process.execPath, [resolve(here, 'check-host.mjs'), rest[0]])
      break
    }
    case 'version':
    case '--version':
    case '-v': {
      // readFile, not a JSON import: an import specifier must be a URL, and a
      // bare Windows path silently resolves to nothing.
      const pkg = JSON.parse(await readFile(resolve(pkgRoot, 'package.json'), 'utf8'))
      console.log(`${pkg.name} ${pkg.version}`)
      break
    }
    default:
      console.log(usage)
      process.exitCode = command ? 2 : 0
  }
} catch (error) {
  // The sub-command already printed whatever it had to say; surface its exit
  // code rather than a stack trace over the top of a readable report.
  process.exitCode = typeof error.code === 'number' ? error.code : 1
}
