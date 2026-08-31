// hypercomb-shim/host/deploy-cloudflare.mjs
//
// ONE COMMAND, ONE HOST. Deploys the shim to Cloudflare Pages and verifies the
// result against the host contract.
//
//   npm run host:deploy -- --project my-hive
//   npm run host:deploy -- --project my-hive --domain hive.example.com
//
// PAGES, NOT A WORKER — and that is the whole simplification. A Hypercomb host
// serves static files: the shim never bare-URL-imports an extension-less file
// (core and pixi have real .js paths, dependencies are typed by the service
// worker, the bootstrap is blob-imported after verification, and content atoms
// are fetched-and-hashed, never imported). So there is nothing for a Worker to
// negotiate, and putting one in front costs an invocation per asset against a
// daily quota — the exact shape of an outage that takes every site down at
// once. `public/_headers` and `public/_redirects` are read natively by Pages
// and carry the entire contract.
//
// CREDENTIALS. This script never asks for, prints, or stores a token. It shells
// out to `wrangler`, which reads CLOUDFLARE_API_TOKEN from your environment or
// uses your existing `wrangler login` session. To set someone else up on THEIR
// account, they run this with their own token — nobody hands a credential to
// anybody, which is the only version of this that should exist.
//
//   Token scopes needed:  Account · Cloudflare Pages · Edit
//   (add Zone · DNS · Edit only if you pass --domain)

import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const shim = resolve(here, '..')
const dist = resolve(shim, 'dist')

const arg = (name, fallback = '') => {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? (process.argv[index + 1] ?? '') : fallback
}

const project = arg('project')
const domain = arg('domain')
const branch = arg('branch', 'main')

if (!project) {
  console.error(`
Deploy the shim to Cloudflare Pages.

  npm run host:deploy -- --project <name> [--domain <hostname>] [--branch <branch>]

  --project   Pages project name (created on first deploy)
  --domain    optional custom hostname to attach, e.g. hive.example.com
  --branch    deployment branch (default: main — Pages treats this as production)

Authentication comes from your environment: either CLOUDFLARE_API_TOKEN, or an
existing \`npx wrangler login\` session. This script never handles it.
`)
  process.exitCode = 2
}

const run = (command, args, options = {}) => new Promise((done, fail) => {
  const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options })
  child.on('error', fail)
  child.on('close', code => code === 0 ? done() : fail(new Error(`${command} ${args[0]} exited ${code}`)))
})

if (project) {
  try {
    await access(dist)
  } catch {
    console.error(`[deploy] ${dist} does not exist — run \`npm run build\` first`)
    process.exit(1)
  }

  // A build that never minted a pin is not a host: the bootstrap is what makes
  // acquisition reachable, so shipping without it produces an origin that
  // serves a shell and can never install anything.
  try {
    await access(resolve(dist, 'pin'))
  } catch {
    console.error('[deploy] dist/pin is missing — the build did not mint a bootstrap. Run `npm run build`.')
    process.exit(1)
  }

  console.log(`[deploy] uploading ${dist} to Pages project "${project}" (branch ${branch})`)
  await run('npx', ['-y', 'wrangler', 'pages', 'deploy', dist,
    '--project-name', project, '--branch', branch, '--commit-dirty=true'])

  if (domain) {
    console.log(`[deploy] attaching ${domain}`)
    // Adding the domain is idempotent; Cloudflare mints the DNS record and the
    // certificate when the zone is in the same account. If the zone lives
    // elsewhere it prints the CNAME to create, which is the honest outcome —
    // there is nothing this script could do about someone else's DNS.
    try {
      await run('npx', ['-y', 'wrangler', 'pages', 'domain', 'add', domain, '--project-name', project])
    } catch (error) {
      console.warn(`[deploy] could not attach ${domain} automatically: ${error.message}`)
      console.warn(`[deploy] point it manually:  CNAME ${domain} -> ${project}.pages.dev`)
    }
  }

  const target = domain ? `https://${domain}` : `https://${project}.pages.dev`
  console.log(`\n[deploy] deployed. Verifying the host contract at ${target}\n`)
  // Verification is part of the deploy, not an afterthought: an origin that
  // serves files but breaks one rule fails in a way that reads as "this host
  // publishes nothing", and finding that out from a user is far too late.
  // DNS and certificates can lag a minute, so a fresh custom domain may need
  // one re-run.
  try {
    await run('node', [resolve(here, 'check-host.mjs'), target])
  } catch {
    console.warn('\n[deploy] the host did not pass yet. A new custom domain often needs a minute for DNS')
    console.warn(`[deploy] and its certificate — re-run:  npm run host:check -- ${target}`)
    process.exitCode = 1
  }
}
