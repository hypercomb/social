import { actions } from '../src/index.js'
import { readFileSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import {
  PayloadCanonical,
  SignatureService,
  type ActionPayloadV1,
  type Action
} from '@hypercomb/core'

// -----------------------------------------
// config
// -----------------------------------------
const MODULE_NAME = '@hypercomb/essentials'
const USE_TS_SOURCE = true

// -----------------------------------------
// helpers
// -----------------------------------------
const toKebab = (value: string): string =>
  value
    .replace(/Action$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()

const resolveSourcePath = (fileBase: string): string =>
  USE_TS_SOURCE
    ? resolve(`./src/${fileBase}.action.ts`)
    : resolve(`./dist/${fileBase}.action.js`)

const toBase64 = (text: string): string =>
  Buffer.from(text, 'utf8').toString('base64')

// normalize Uint8Array → real ArrayBuffer (never SharedArrayBuffer)
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(bytes)
  return out
}


// -----------------------------------------
// main
// -----------------------------------------
const main = async (): Promise<void> => {
  const distDir = resolve('./dist')
  rmSync(distDir, { recursive: true, force: true })
  mkdirSync(distDir, { recursive: true })

  const builtActions: { signature: string; payload: ActionPayloadV1 }[] = []

  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error('no actions exported from src/index.ts')
  }

  // ✅ IMPORTANT FIX: use Action, not a structural type
  for (const ActionCtor of actions as Array<new () => Action>) {
    const instance = new ActionCtor()

    const fileBase = toKebab(instance.constructor.name)
    const entry = USE_TS_SOURCE
      ? `${fileBase}.action.ts`
      : `${fileBase}.action.js`

    const sourceText = readFileSync(resolveSourcePath(fileBase), 'utf8')
    const draft = PayloadCanonical.createEmpty()

    // -----------------------------------------
    // signed meaning (action)
    // -----------------------------------------
    draft.action.name = instance.name
    draft.action.description = instance.description ?? ''
    draft.action.grammar = instance.grammar ?? []
    draft.action.links = instance.links ?? []
    ;(draft.action as any).effects = instance.effects ?? []

    // -----------------------------------------
    // source (unsigned)
    // -----------------------------------------
    draft.source.entry = entry
    draft.source.files = { [entry]: toBase64(sourceText) }

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
  const moduleSignature = await SignatureService.sign(
    toArrayBuffer(moduleBytes)
  )

  writeFileSync(resolve(distDir, moduleSignature), moduleJson, 'utf8')

  console.log('module built')
  console.log(`dist/${moduleSignature}`)
  console.log(`actions packaged: ${builtActions.length}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
