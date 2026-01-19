// scripts/build-module.ts
import { HostedActions } from '../src/index.js'
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'fs'
import { resolve, join } from 'path'
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

// normalize Uint8Array → real ArrayBuffer (never SharedArrayBuffer)
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

    if (st.isDirectory()) {
      out.push(...walkFiles(full))
      continue
    }

    out.push(full)
  }

  return out
}

const buildActionSourceIndex = (): Map<string, string> => {
  // key = fileBase like "show-cell"
  // value = full absolute path to the actual file in src/** (nested ok)
  const index = new Map<string, string>()

  const srcRoot = resolve('./src')
  const all = walkFiles(srcRoot)

  for (const file of all) {
    if (!file.endsWith('.action.ts') && !file.endsWith('.action.js')) continue

    const base = file.replace(/^.*[\\\/]/, '').replace(/\.action\.(ts|js)$/, '')
    // only map first match (keeps behavior stable if duplicates exist)
    if (!index.has(base)) index.set(base, file)
  }

  return index
}

const resolveActionText = (fileBase: string, index: Map<string, string>): { entry: string; text: string } => {
  // preferred resolution:
  // - for metadata we want ts text if present (authoring)
  // - fallback to js if present
  //
  // note:
  // index keys are fileBase, values are absolute file paths
  const tsPath = index.get(fileBase)?.endsWith('.action.ts') ? index.get(fileBase)! : null
  const jsPath = index.get(fileBase)?.endsWith('.action.js') ? index.get(fileBase)! : null

  // if the first hit was js but ts exists elsewhere, search explicitly
  if (!tsPath) {
    const srcRoot = resolve('./src')
    const explicitTs = walkFiles(srcRoot).find(f => f.endsWith(`${fileBase}.action.ts`))
    if (explicitTs) {
      const text = readFileSync(explicitTs, 'utf8')
      return { entry: `${fileBase}.action.ts`, text }
    }
  }

  if (USE_TS_SOURCE && tsPath) {
    const text = readFileSync(tsPath, 'utf8')
    return { entry: `${fileBase}.action.ts`, text }
  }

  // fallback js search (src/**)
  if (jsPath) {
    const text = readFileSync(jsPath, 'utf8')
    return { entry: `${fileBase}.action.js`, text }
  }

  // last fallback: dist/src/** (if you ever want to sign compiled outputs)
  const distCandidate = resolve(`./dist/src/${fileBase}.action.js`)
  if (existsSync(distCandidate)) {
    const text = readFileSync(distCandidate, 'utf8')
    return { entry: `${fileBase}.action.js`, text }
  }

  // error message mirrors what you're seeing, but now it includes nested intent
  const tried = [
    resolve(`./src/${fileBase}.action.ts`),
    resolve(`./src/${fileBase}.action.js`),
    resolve(`./dist/src/${fileBase}.action.js`),
    resolve(`./src/**/${fileBase}.action.ts`),
    resolve(`./src/**/${fileBase}.action.js`)
  ]

  throw new Error(`action source not found for "${fileBase}". tried: ${tried.join(', ')}`)
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

    const { entry, text: sourceText } = resolveActionText(fileBase, index)

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
    // source (unsigned)
    // -----------------------------------------
    draft.source.entry = entry
    draft.source.files = { [entry]: toBase64(sourceText) }

    const { signature } = await PayloadCanonical.compute(draft)
    builtActions.push({ signature, payload: draft })
  }

  // -----------------------------------------
  // assemble module (single dist artifact)
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
