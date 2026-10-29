// derivation.spec.ts — the `minify` dialect's transform, in core so every
// party runs the same code: walked from a readable root alone, a whole Merkle
// tree of its own, traceable back, and the same every time.

import { describe, expect, it } from 'vitest'
import { SignatureService } from './signature.service.js'
import { isPoolAddress, registerPoolMeaning } from './pool-registry.js'
import { deriveMinifiedLayer, deriveMinifiedTree, derivedMeaning, remapMinifiedRoot, splitHead, walkPackage } from './derivation.js'
import { minifyModuleBody, ownedMinifyTool } from './minify-transpiler.js'

const enc = (text: string): Uint8Array => new TextEncoder().encode(text)
const dec = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
const sigOf = (bytes: Uint8Array): Promise<string> =>
  SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)

const minify = async (body: string): Promise<string> => {
  if (body.includes('THROW')) throw new Error('cannot')
  return body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim()
}
const TOOL = { name: 'test-minify@1', options: { whitespace: true } }

async function toyPackage() {
  const files = new Map<string, Uint8Array>()
  const put = async (text: string): Promise<string> => { const bytes = enc(text); const sig = await sigOf(bytes); files.set(sig, bytes); return sig }
  const dep = await put('// @scope/a\n// lazy\n/* the a module */\nexport const a = 1\n\n\nexport class Helper {   }\n')
  const stubborn = await put('// @scope/b\n/* THROW */\nexport const b = 2\n')
  const bee = await put('// src/x.drone.ts\nimport { a } from "@scope/a"\n/* a bee */\nexport class XDrone {   deps = { a: "@scope/A" }   }\n')
  const boot = await put('// src/boot.drone.ts\n/* boots first */\nexport class BootDrone {   }\n')
  const child = await put(JSON.stringify({ name: 'x', cells: [], bees: [`${bee}.js`], dependencies: [], docs: { bees: { [bee]: { className: 'XDrone' } } } }))
  const root = await put(JSON.stringify({ name: 'root', cells: [child], bees: [], dependencies: [`${dep}.js`, `${stubborn}.js`], criticalBees: [bee], bootBees: [boot] }))
  return { files, root, child, dep, stubborn, bee, boot, read: async (sig: string) => files.get(sig) ?? null }
}

describe('splitHead', () => {
  it('keeps every leading comment line, byte for byte', () => {
    expect(splitHead('// @s/a\n// lazy\ncode\n// later\n')).toEqual({ head: '// @s/a\n// lazy\n', body: 'code\n// later\n' })
    expect(splitHead('code')).toEqual({ head: '', body: 'code' })
    expect(splitHead('// only a head')).toEqual({ head: '// only a head', body: '' })
  })
})

describe('walkPackage', () => {
  it('finds every layer and module from the root signature alone', async () => {
    const pkg = await toyPackage()
    const walked = await walkPackage(pkg.root, pkg.read)
    expect(walked.layers).toEqual([pkg.root, pkg.child])
    expect(new Set(walked.bees)).toEqual(new Set([pkg.bee, pkg.boot]))
    expect(walked.dependencies).toEqual([pkg.dep, pkg.stubborn])
  })

  it('says which layer it cannot reach', async () => {
    const pkg = await toyPackage()
    pkg.files.delete(pkg.child)
    await expect(walkPackage(pkg.root, pkg.read)).rejects.toThrow(/not reachable/)
  })
})

describe('deriveMinifiedTree', () => {
  it('names every file by the hash of its own bytes', async () => {
    const pkg = await toyPackage()
    const tree = await deriveMinifiedTree(pkg.root, pkg.read, minify, TOOL)
    for (const [sig, bytes] of tree.files) expect(await sigOf(bytes)).toBe(sig)
    expect(tree.files.has(tree.root)).toBe(true)
    expect(tree.files.has(tree.derivation.sig)).toBe(true)
  })

  it('keeps module heads and rewrites every layer bottom-up', async () => {
    const pkg = await toyPackage()
    const tree = await deriveMinifiedTree(pkg.root, pkg.read, minify, TOOL)
    const newBee = tree.modules.get(pkg.bee)!, newDep = tree.modules.get(pkg.dep)!, newBoot = tree.modules.get(pkg.boot)!
    expect(dec(tree.files.get(newDep)!).startsWith('// @scope/a\n// lazy\n')).toBe(true)
    const root = JSON.parse(dec(tree.files.get(tree.root)!))
    expect(root.cells).toEqual([tree.layers.get(pkg.child)])
    expect(root.dependencies).toEqual([`${newDep}.js`, `${pkg.stubborn}.js`])
    expect(root.criticalBees).toEqual([newBee])
    expect(root.bootBees).toEqual([newBoot])
    expect(root.derivedFrom).toBe(pkg.root)
    expect(root.derivation).toBe(tree.derivation.sig)
    const child = JSON.parse(dec(tree.files.get(root.cells[0])!))
    expect(child.bees).toEqual([`${newBee}.js`])
    expect(Object.keys(child.docs.bees)).toEqual([newBee])
  })

  it('traces back to the readable root, never naming the derived one', async () => {
    const pkg = await toyPackage()
    const tree = await deriveMinifiedTree(pkg.root, pkg.read, minify, TOOL)
    const record = JSON.parse(dec(tree.derivation.bytes))
    expect(record).toMatchObject({ v: 1, kind: 'minify', from: pkg.root, tool: 'test-minify@1', options: { whitespace: true } })
    expect(Object.keys(record.modules).sort()).toEqual([pkg.bee, pkg.boot, pkg.dep].sort())
    expect(dec(tree.derivation.bytes)).not.toContain(tree.root)
  })

  it('a module the transform cannot handle keeps its readable bytes and signature', async () => {
    const pkg = await toyPackage()
    const tree = await deriveMinifiedTree(pkg.root, pkg.read, minify, TOOL)
    expect(tree.modules.has(pkg.stubborn)).toBe(false)
  })

  it('is the same every time — what makes it verifiable', async () => {
    const pkg = await toyPackage()
    const a = await deriveMinifiedTree(pkg.root, pkg.read, minify, TOOL)
    const b = await deriveMinifiedTree(pkg.root, pkg.read, minify, TOOL)
    expect(a.root).toBe(b.root)
    expect(a.derivation.sig).toBe(b.derivation.sig)
  })

  it('walks a child named by { sig } the same way it walks a string', async () => {
    const pkg = await toyPackage()
    const wrapped = JSON.stringify({ name: 'root', cells: [{ sig: pkg.child }] })
    const bytes = enc(wrapped)
    const root = await sigOf(bytes)
    pkg.files.set(root, bytes)
    const walked = await walkPackage(root, pkg.read)
    expect(walked.layers).toContain(pkg.child)
  })

  it('a different tool or option is a different record', async () => {
    const pkg = await toyPackage()
    const a = await deriveMinifiedTree(pkg.root, pkg.read, minify, TOOL)
    const b = await deriveMinifiedTree(pkg.root, pkg.read, minify, { name: 'test-minify@2', options: TOOL.options })
    expect(a.derivation.sig).not.toBe(b.derivation.sig)
    expect(a.root).not.toBe(b.root)
  })
})

describe('a layer, derived on its own', () => {
  it('writes the record as the member of derived:<that layer> and leaves the parent', async () => {
    const pkg = await toyPackage()
    const tool = await ownedMinifyTool()
    const tree = await deriveMinifiedLayer(pkg.child, pkg.read, async body => minifyModuleBody(body), tool)
    expect(derivedMeaning(pkg.child)).toBe(`derived:${pkg.child}`)
    expect(tree.membership.pool).toBe(`derived:${pkg.child}`)
    expect(tree.membership.member).toBe(tree.derivation.sig)
    expect(tree.membership.dialects).toBe('derivation:dialects')
    expect(tree.files.has(pkg.root)).toBe(false)
    expect(tree.root).not.toBe(pkg.child)
    const record = JSON.parse(dec(tree.derivation.bytes))
    expect(record).toMatchObject({ v: 1, kind: 'minify', from: pkg.child, tool: tool.name })
    expect(record.tool).toMatch(/^[a-f0-9]{64}$/)
    expect(dec(tree.derivation.bytes)).not.toContain(tree.root)
    const dialect = JSON.parse(dec(tree.membership.dialectBytes))
    expect(dialect).toEqual({ v: 1, kind: 'minify', tool: tool.name, mode: 'reproduce' })
    expect(await remapMinifiedRoot(pkg.child, pkg.read, tree.modules, tree.derivation.sig)).toBe(tree.root)
    expect(await isPoolAddress(await registerPoolMeaning(tree.membership.pool))).toBe(true)
    expect(await isPoolAddress(await registerPoolMeaning(tree.membership.dialects))).toBe(true)
  })
})
