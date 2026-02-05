// scripts/build-dependencies.ts
// freezes third-party ESM dependencies into signed, deterministic payloads

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

const OUT_DIR = resolve('./dist/__dependencies__')
const TARGET = 'es2022'

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
  if (existsSync(OUT_DIR)) {
    rmSync(OUT_DIR, { recursive: true, force: true })
  }

  mkdirSync(OUT_DIR, { recursive: true })

  for (const dep of HostedDependencies) {
    console.log(`bundling dependency: ${dep.name}`)

    const bytes = await bundleDependency(dep)
    const signature = await SignatureService.sign(toArrayBuffer(bytes))

    writeFileSync(join(OUT_DIR, signature), bytes)

    console.log(`  alias: ${dep.alias}`)
    console.log(`  sig:   ${signature}`)
    console.log(`  bytes: ${bytes.byteLength}`)
  }

  console.log('dependencies built')

  // -----------------------------------------
  // deploy (shared dependencies)
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
