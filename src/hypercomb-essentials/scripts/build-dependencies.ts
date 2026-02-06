// scripts/build-dependencies.ts
// freezes third-party ESM dependencies into signed, deterministic payloads
// and emits a dev import-map derived from alias headers

import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, resolve, join } from 'path'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { build } from 'esbuild'
import { SignatureService } from '@hypercomb/core'
import { HostedDependencies, type HostedDependency } from './dependencies.js'

// -----------------------------------------
// esm globals
// -----------------------------------------

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// -----------------------------------------
// config
// -----------------------------------------

const TARGET = 'es2022'

// canonical build output
const DIST_DEPS_DIR = resolve('./dist/__dependencies__')

// dev public output (web project)
const DEV_PUBLIC_DEPS_DIR = resolve(
  __dirname,
  '../../hypercomb-web/public/dev/essentials/'
)

const DEV_IMPORT_MAP_FILE = resolve(
  __dirname,
  '../../hypercomb-web/public/dev/essentials/dependencies.runtime-map.json'
)

// -----------------------------------------
// helpers
// -----------------------------------------

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(bytes)
  return out
}

const assertClosedBundle = (code: string): void => {
  if (/\bimport\s*\(/.test(code)) {
    throw new Error('dynamic import detected; dependency bundles must be closed')
  }
}

// prepend alias prologue BEFORE signing
const withPrologue = (alias: string, bytes: Uint8Array): Uint8Array => {
  const header = new TextEncoder().encode(`// ${alias}\n`)
  const out = new Uint8Array(header.byteLength + bytes.byteLength)
  out.set(header, 0)
  out.set(bytes, header.byteLength)
  return out
}

// -----------------------------------------
// bundler
// -----------------------------------------

const bundleDependency = async (dep: HostedDependency): Promise<Uint8Array> => {
  const result = await build({
    entryPoints: [resolve(dep.entry)],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    splitting: false,
    write: false,
    target: TARGET,
    treeShaking: true,
    legalComments: 'none',
    logLevel: 'silent',
    external: [] // must be fully closed
  })

  if (!result.outputFiles || result.outputFiles.length !== 1) {
    throw new Error(`dependency "${dep.name}" did not bundle to a single file`)
  }

  const file = result.outputFiles[0]
  assertClosedBundle(file.text)

  return file.contents
}

// -----------------------------------------
// main
// -----------------------------------------

const main = async (): Promise<void> => {
  // clean outputs
  for (const dir of [DIST_DEPS_DIR, DEV_PUBLIC_DEPS_DIR]) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
    }
    mkdirSync(dir, { recursive: true })
  }

  const importMap: Record<string, string> = {}

  for (const dep of HostedDependencies) {
    console.log(`bundling dependency: ${dep.name}`)

    const bundled = await bundleDependency(dep)

    // alias becomes part of the signed payload
    const bytes = withPrologue(dep.alias, bundled)

    const signature = await SignatureService.sign(toArrayBuffer(bytes))

    // write canonical dist output
    writeFileSync(join(DIST_DEPS_DIR, signature), bytes)

    // write dev public output
    writeFileSync(join(DEV_PUBLIC_DEPS_DIR, signature), bytes)

    // record alias → signature mapping
    importMap[dep.alias] = `/dev/essentials/${signature}`

    console.log(`  alias: ${dep.alias}`)
    console.log(`  sig:   ${signature}`)
    console.log(`  bytes: ${bytes.byteLength}`)
  }

  // emit dev import map (alias → signature)
  writeFileSync(
    DEV_IMPORT_MAP_FILE,
    JSON.stringify({ imports: importMap }, null, 2)
  )

  console.log('dependency import map written:')
  console.log(`  ${DEV_IMPORT_MAP_FILE}`)

  // -----------------------------------------
  // deploy (shared dependencies, prod path)
  // -----------------------------------------

  const ps1 = resolve(__dirname, 'deploy-dependencies.ps1')

  if (!existsSync(ps1)) {
    throw new Error(`deploy script not found: ${ps1}`)
  }

  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', ps1
    ],
    { stdio: 'inherit' }
  )

  if (result.status !== 0) {
    throw new Error('dependency deployment failed')
  }

  console.log('dependencies deployed')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
