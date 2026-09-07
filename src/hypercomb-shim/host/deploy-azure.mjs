// Deploy one complete Hypercomb host to an existing Azure Static Web App, then
// verify the public origin against the host contract.
//
//   npm run host:deploy:azure -- --app my-host --group my-group
//   npm run host:deploy:azure -- --app my-host --group my-group --domain hive.example.com
//
// `--tour` optionally keeps an existing standalone page at /tour/. It is an
// overlay in a temporary deployment directory; the host dist remains generic.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer as createTcpServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const shim = resolve(here, '..')
const dist = resolve(shim, 'dist')
const SIG_RE = /^[a-f0-9]{64}$/
const PACKAGES_POOL = createHash('sha256').update('host:packages', 'utf8').digest('hex')

const arg = (name, fallback = '') => {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? (process.argv[index + 1] ?? '') : fallback
}

const app = arg('app')
const group = arg('group')
const domain = arg('domain')
const tour = arg('tour')
const tourOg = arg('tour-og')
const checkOnly = process.argv.includes('--check-only')

if (!app || !group) {
  console.error(`
Deploy the shim to an existing Azure Static Web App.

  npm run host:deploy:azure -- --app <name> --group <resource-group> [--domain <hostname>] [--tour <html> --tour-og <image>] [--check-only]

Authentication comes from the active Azure CLI session. The deployment token
is read only for this process and is never printed or written to disk.
`)
  process.exit(2)
}
if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(app)) throw new Error(`invalid Static Web App name: ${app}`)
if (!/^[A-Za-z0-9][A-Za-z0-9_.()-]*$/.test(group)) throw new Error(`invalid Azure resource group: ${group}`)
if (domain && !/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(domain)) {
  throw new Error(`invalid hostname: ${domain}`)
}
if (tour && !tourOg) throw new Error('--tour requires --tour-og so the staged presentation remains shareable')
if (tourOg && !tour) throw new Error('--tour-og requires --tour')

const run = (program, args, options = {}) => new Promise((done, fail) => {
  const child = spawn(program, args, { stdio: 'inherit', ...options })
  child.on('error', fail)
  child.on('close', code => code === 0 ? done() : fail(new Error(`${basename(program)} ${args[0]} exited ${code}`)))
})

const capture = (program, args) => new Promise((done, fail) => {
  const child = spawn(program, args, { stdio: ['ignore', 'pipe', 'inherit'] })
  let output = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => { output += chunk })
  child.on('error', fail)
  child.on('close', code => code === 0 ? done(output.trim()) : fail(new Error(`${basename(program)} ${args[0]} exited ${code}`)))
})

const availablePort = () => new Promise((done, fail) => {
  const reservation = createTcpServer()
  reservation.once('error', fail)
  reservation.listen(0, '127.0.0.1', () => {
    const address = reservation.address()
    if (!address || typeof address === 'string') {
      reservation.close()
      return fail(new Error('could not reserve a local preflight port'))
    }
    reservation.close(error => error ? fail(error) : done(address.port))
  })
})

const stop = async (child) => {
  if (child.exitCode !== null) return
  const closed = new Promise(done => child.once('close', done))
  child.kill()
  await Promise.race([
    closed,
    delay(2_000).then(() => { if (child.exitCode === null) child.kill('SIGKILL') }),
  ])
}

// The SWA CLI is a thin launcher around Microsoft's StaticSitesClient. Keep a
// direct, token-in-environment fallback for the launcher failure we have seen
// on Windows after it already downloaded and verified that client. The cache
// metadata is owned by the SWA CLI itself; the containment check prevents a
// corrupt metadata file from turning this deployer into an arbitrary runner.
const deployWithCachedAzureClient = async (root, token) => {
  const cacheRoot = resolve(homedir(), '.swa', 'deploy')
  const metadata = JSON.parse(await readFile(resolve(cacheRoot, 'StaticSitesClient.json'), 'utf8'))
  const binary = resolve(String(metadata?.binary ?? ''))
  const fromCache = relative(cacheRoot, binary)
  if (!binary || fromCache.startsWith('..') || isAbsolute(fromCache)) {
    throw new Error('the cached Azure deployment client path is outside ~/.swa/deploy')
  }
  await access(binary)
  await run(binary, [], {
    cwd: root,
    env: {
      ...process.env,
      DEPLOYMENT_ACTION: 'upload',
      DEPLOYMENT_PROVIDER: 'SwaCli',
      REPOSITORY_BASE: root,
      SKIP_APP_BUILD: 'true',
      SKIP_API_BUILD: 'true',
      DEPLOYMENT_TOKEN: token,
      APP_LOCATION: root,
      CONFIG_FILE_LOCATION: root,
      VERBOSE: 'true',
      FUNCTION_LANGUAGE: 'node',
      FUNCTION_LANGUAGE_VERSION: '22',
    },
  })
}

const validateAzureConfig = async (root) => {
  const path = resolve(root, 'staticwebapp.config.json')
  const config = JSON.parse(await readFile(path, 'utf8'))
  if (config.globalHeaders?.['access-control-allow-origin'] !== '*') {
    throw new Error('staticwebapp.config.json must allow public cross-origin reads')
  }
  if (!config.navigationFallback?.exclude?.includes('/content/*')) {
    throw new Error('staticwebapp.config.json must exclude /content/* from the SPA fallback')
  }

  const routes = config.routes ?? []
  const genericContent = routes.findIndex(route => route.route === '/content/*')
  const poolRoute = `/content/${PACKAGES_POOL}/`
  const poolRewrite = `${poolRoute}listing.txt`
  const pool = routes.findIndex(route => route.route === poolRoute && route.rewrite === poolRewrite)
  if (genericContent < 0 || pool < 0 || pool > genericContent) {
    throw new Error('the mutable package-pool route must precede the immutable /content/* route')
  }
  const poolCache = String(routes[pool]?.headers?.['cache-control'] ?? '').toLowerCase()
  if (!poolCache.includes('no-store')) throw new Error('the mutable package-pool listing must not be cached')

  const poolDirectory = resolve(root, 'content', PACKAGES_POOL)
  const [index, listing] = await Promise.all([
    readFile(resolve(poolDirectory, 'index.html')),
    readFile(resolve(poolDirectory, 'listing.txt')),
  ])
  if (!index.equals(listing)) throw new Error('the Azure package-pool listing differs from its canonical index')
}

const validatePackageClosure = async (root) => {
  const content = resolve(root, 'content')
  const manifest = JSON.parse(await readFile(resolve(content, 'manifest.json'), 'utf8'))
  const packages = Object.entries(manifest.packages ?? {})
  if (packages.length === 0) throw new Error('the staged host does not publish any packages')

  const referenced = new Set()
  for (const [packageSig, record] of packages) {
    referenced.add(packageSig)
    for (const field of ['layers', 'bees', 'dependencies']) {
      for (const sig of record?.[field] ?? []) referenced.add(sig)
    }
    for (const field of ['dependenciesBag', 'beesBag']) {
      const bag = record?.[field]
      if (!SIG_RE.test(String(bag ?? ''))) throw new Error(`package ${packageSig} has an invalid ${field}`)
      await access(resolve(content, bag))
    }
  }

  for (const sig of referenced) {
    if (!SIG_RE.test(sig)) throw new Error(`manifest contains an invalid signature: ${sig}`)
    const bytes = await readFile(resolve(content, sig))
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== sig) throw new Error(`staged content ${sig} is missing or does not hash to its name`)
  }
  console.log(`[deploy] verified the complete package closure (${referenced.size} content-addressed files)`)
}

const verifyStage = async (root) => {
  await validateAzureConfig(root)
  await validatePackageClosure(root)
  const port = await availablePort()
  const server = spawn(process.execPath, [resolve(here, 'serve.mjs'), root, String(port)], {
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  let startupError = null
  server.once('error', error => { startupError = error })

  try {
    const origin = `http://127.0.0.1:${port}`
    let ready = false
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (startupError) throw startupError
      if (server.exitCode !== null) throw new Error(`local preflight host exited ${server.exitCode}`)
      try {
        const response = await fetch(origin)
        if (response.ok) {
          await response.arrayBuffer()
          ready = true
          break
        }
      } catch { /* the listener is still starting */ }
      await delay(100)
    }
    if (!ready) throw new Error('local preflight host did not start within 5 seconds')

    if (tour) {
      const tourResponse = await fetch(`${origin}/tour/`)
      const tourType = (tourResponse.headers.get('content-type') ?? '').toLowerCase()
      if (!tourResponse.ok || !tourType.includes('text/html')) throw new Error('the staged /tour/ page is not HTML')
      await tourResponse.arrayBuffer()

      const imageResponse = await fetch(`${origin}/og.png`)
      const imageType = (imageResponse.headers.get('content-type') ?? '').toLowerCase()
      if (!imageResponse.ok || !imageType.startsWith('image/')) throw new Error('the staged /og.png is not an image')
      await imageResponse.arrayBuffer()
    }

    console.log(`[deploy] preflighting the complete staged host at ${origin}`)
    await run(process.execPath, [resolve(here, 'check-host.mjs'), origin])
  } finally {
    await stop(server)
  }
}

await access(resolve(dist, 'pin'))

let stage = dist
let temporary = ''

try {
  if (tour) {
    const tourPath = resolve(process.cwd(), tour)
    await access(tourPath)
    temporary = await mkdtemp(resolve(tmpdir(), 'hypercomb-azure-'))
    stage = resolve(temporary, 'site')
    await cp(dist, stage, { recursive: true })
    await mkdir(resolve(stage, 'tour'), { recursive: true })
    await cp(tourPath, resolve(stage, 'tour', 'index.html'))
    if (tourOg) {
      const tourOgPath = resolve(process.cwd(), tourOg)
      await access(tourOgPath)
      await cp(tourOgPath, resolve(stage, 'og.png'))
    }
    await access(resolve(stage, 'tour', 'index.html'))
    if (tourOg) await access(resolve(stage, 'og.png'))
  }

  // Upload is the irreversible boundary. Verify the exact staged bytes first,
  // while a failure can still leave production untouched.
  await verifyStage(stage)

  if (checkOnly) {
    console.log('[deploy] staged host passed preflight; --check-only skipped the Azure upload')
  } else {

    // Windows installs `az` as a .cmd wrapper. Invoking that through a shell
    // would concatenate arguments (and makes paths with spaces fragile), so run
    // the wrapper's Python entrypoint directly. Unix installations expose a real
    // executable and need no adaptation.
    let azure = { program: 'az', prefix: [] }
    if (process.platform === 'win32') {
      const azWrapper = (await capture('where.exe', ['az.cmd'])).split(/\r?\n/).find(Boolean)
      if (!azWrapper) throw new Error('Azure CLI was not found on PATH')
      const python = resolve(dirname(azWrapper), '..', 'python.exe')
      await access(python)
      azure = { program: python, prefix: ['-IBm', 'azure.cli'] }
    }

    const token = await capture(azure.program, [...azure.prefix,
      'staticwebapp', 'secrets', 'list', '-n', app, '-g', group,
      '--query', 'properties.apiKey', '-o', 'tsv',
    ])
    if (!token) throw new Error('Azure returned an empty Static Web App deployment token')

    const defaultHostname = await capture(azure.program, [...azure.prefix,
      'staticwebapp', 'show', '-n', app, '-g', group,
      '--query', 'defaultHostname', '-o', 'tsv',
    ])

    console.log(`[deploy] uploading the complete host to Azure Static Web App "${app}"`)
    // Run npx through Node on Windows for the same reason: npx.cmd needs a shell,
    // while npx-cli.js preserves every argument exactly and keeps the deployment
    // token out of both argv and disk.
    const npx = process.platform === 'win32'
      ? {
          program: process.execPath,
          prefix: [resolve(dirname(process.env.npm_execpath || process.execPath),
            process.env.npm_execpath ? 'npx-cli.js' : 'node_modules/npm/bin/npx-cli.js')],
        }
      : { program: 'npx', prefix: [] }
    if (process.platform === 'win32') await access(npx.prefix[0])
    const deployArgs = [...npx.prefix,
      '--yes', '@azure/static-web-apps-cli@2.0.10', '--', '--verbose', 'info', 'deploy', '.',
      '--swa-config-location', '.', '--env', 'production',
    ]
    let deployed = false
    let launcherError = null
    for (let attempt = 1; attempt <= 2 && !deployed; attempt += 1) {
      try {
        await run(npx.program, deployArgs,
          { cwd: stage, env: { ...process.env, SWA_CLI_DEPLOYMENT_TOKEN: token } })
        deployed = true
      } catch (error) {
        launcherError = error
        if (attempt < 2) {
          console.warn('[deploy] Azure launcher exited before confirming the atomic upload; retrying once')
          await delay(3_000)
        }
      }
    }
    if (!deployed) {
      console.warn('[deploy] Azure launcher failed twice; using its verified cached deployment client directly')
      try {
        await deployWithCachedAzureClient(stage, token)
        deployed = true
      } catch (directError) {
        throw new AggregateError([launcherError, directError].filter(Boolean),
          'both Azure deployment paths failed')
      }
    }

    const target = `https://${domain || defaultHostname}`
    console.log(`\n[deploy] deployed. Verifying the host contract at ${target}\n`)
    await run(process.execPath, [resolve(here, 'check-host.mjs'), target])
  }
} finally {
  if (temporary) await rm(temporary, { recursive: true, force: true })
}
