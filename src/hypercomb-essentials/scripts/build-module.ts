// scripts/build-module.ts
import { HostedActions } from '../src/index.js'
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'fs'
import { resolve, join } from 'path'
import { build } from 'esbuild'
import { PayloadCanonical, SignatureService, type ActionPayloadV1, type Action } from '@hypercomb/core'

// -----------------------------------------
// config
// -----------------------------------------
const MODULE_NAME = '@hypercomb/essentials'
const USE_TS_SOURCE = true

type HostedEntry = new () => Action

// -----------------------------------------
// helpers
// -----------------------------------------
const toKebab = (value: string): string =>
  value
    .replace(/Action$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()

const toBase64 = (text: string): string =>
  Buffer.from(text, 'utf8').toString('base64')

// normalize Uint8Array → real ArrayBuffer
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(bytes)
  return out
}

const walkFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  const out: string[] = []

  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walkFiles(full))
    else out.push(full)
  }

  return out
}

const buildActionSourceIndex = (): Map<string, string> => {
  const index = new Map<string, string>()
  const srcRoot = resolve('./src')
  const all = walkFiles(srcRoot)

  for (const file of all) {
    if (!file.endsWith('.action.ts') && !file.endsWith('.action.js')) continue
    const base = file.replace(/^.*[\\\/]/, '').replace(/\.action\.(ts|js)$/, '')
    if (!index.has(base)) index.set(base, file)
  }

  return index
}

const resolveActionEntry = (fileBase: string, index: Map<string, string>): string => {
  const candidate = index.get(fileBase)
  if (!candidate) {
    throw new Error(`action source not found for "${fileBase}"`)
  }
  return candidate
}

// -----------------------------------------
// bundler
// -----------------------------------------
const bundleAction = async (entryFile: string): Promise<string> => {
  const result = await build({
    entryPoints: [resolve(entryFile)],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    target: 'es2022',

    tsconfig: resolve('./tsconfig.json'),
    absWorkingDir: process.cwd(),

    external: ['@hypercomb/core'],
    metafile: true
  })

  // DEBUG: prove what's included
  console.log(
    '[bundle inputs]',
    Object.keys(result.metafile!.inputs)
  )

  return result.outputFiles[0].text
}


// -----------------------------------------
// main
// -----------------------------------------
const main = async (): Promise<void> => {
  const distDir = resolve('./dist')
  rmSync(distDir, { recursive: true, force: true })
  mkdirSync(distDir, { recursive: true })

  const builtActions: { signature: string; payload: ActionPayloadV1 }[] = []

  if (!Array.isArray(HostedActions) || HostedActions.length === 0) {
    throw new Error('no actions exported from src/index.ts')
  }

  const index = buildActionSourceIndex()

  for (const ActionCtor of HostedActions as HostedEntry[]) {
    const instance = new ActionCtor()
    const fileBase = toKebab(instance.constructor.name)
    const entryPath = resolveActionEntry(fileBase, index)

    // -----------------------------------------
    // bundle full dependency closure
    // -----------------------------------------
    const bundledSource = await bundleAction(entryPath)

    const draft = PayloadCanonical.createEmpty()

    // -----------------------------------------
    // signed meaning (action)
    // -----------------------------------------
    draft.action.name = instance.name
    draft.action.description = instance.description ?? ''
    draft.action.grammar = instance.grammar ?? []
    draft.action.links = instance.links ?? []
    ;(draft.action as any).effects = (instance as any).effects ?? []

    // -----------------------------------------
    // source (unsigned, bundled)
    // -----------------------------------------
    draft.source.entry = 'bundle.js'
    draft.source.files = {
      'bundle.js': toBase64(bundledSource)
    }

    const { signature } = await PayloadCanonical.compute(draft)
    builtActions.push({ signature, payload: draft })
  }

  // -----------------------------------------
  // assemble module
  // -----------------------------------------
  const moduleFile = {
    version: 1,
    module: { name: MODULE_NAME },
    actions: builtActions
  }

  const moduleJson = JSON.stringify(moduleFile)
  const moduleBytes = new TextEncoder().encode(moduleJson)
  const moduleSignature = await SignatureService.sign(toArrayBuffer(moduleBytes))

  writeFileSync(resolve(distDir, moduleSignature), moduleJson, 'utf8')

  console.log('module built')
  console.log(`dist/${moduleSignature}`)
  console.log(`actions packaged: ${builtActions.length}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
