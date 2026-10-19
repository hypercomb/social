// minified-package.spec.ts — the visitor's minified package is a whole Merkle
// tree of its own, traceable to the readable package it was derived from.

import { describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { deriveMinifiedPackage, splitHead, type PackageRecord } from './minified-package'
import { bagSignature, beeEntries, dependencyEntries } from './bags'

const enc = (text: string): Uint8Array => new TextEncoder().encode(text)
const dec = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
const sigOf = (bytes: Uint8Array): Promise<string> =>
  SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)

// A stand-in minifier: drops block comments and collapses whitespace. A body
// holding THROW makes it fail, as a real transform may.
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
  const child = await put(JSON.stringify({ name: 'x', cells: [], bees: [`${bee}.js`], dependencies: [], docs: { bees: { [bee]: { className: 'XDrone' } } } }))
  const root = await put(JSON.stringify({ name: 'root', cells: [child], bees: [], dependencies: [`${dep}.js`, `${stubborn}.js`], criticalBees: [bee], bootBees: [] }))
  const record: PackageRecord = { layers: [root, child], bees: [bee], dependencies: [dep, stubborn], beeDeps: { [bee]: [dep] }, label: 'development', previous: null }
  return { files, root, child, dep, stubborn, bee, record, read: async (sig: string) => files.get(sig) ?? null }
}

describe('splitHead', () => {
  it('keeps every leading comment line, byte for byte', () => {
    expect(splitHead('// @s/a\n// lazy\ncode\n// later\n')).toEqual({ head: '// @s/a\n// lazy\n', body: 'code\n// later\n' })
    expect(splitHead('code')).toEqual({ head: '', body: 'code' })
  })
})

describe('the minified package', () => {
  it('names every file it adds by the hash of its own bytes', async () => {
    const pkg = await toyPackage()
    const out = await deriveMinifiedPackage(pkg.root, pkg.record, pkg.read, minify, TOOL)
    for (const [sig, bytes] of out.files) expect(await sigOf(bytes)).toBe(sig)
    expect(out.files.has(out.root)).toBe(true)
  })

  it('keeps each module head (alias, lazy marker, source path) and shrinks the body', async () => {
    const pkg = await toyPackage()
    const out = await deriveMinifiedPackage(pkg.root, pkg.record, pkg.read, minify, TOOL)
    const dep = dec(out.files.get(out.modules.get(pkg.dep)!)!)
    expect(dep.startsWith('// @scope/a\n// lazy\n')).toBe(true)
    expect(dep).not.toContain('the a module')
    expect(dec(out.files.get(out.modules.get(pkg.bee)!)!).startsWith('// src/x.drone.ts\n')).toBe(true)
  })

  it('rewrites the layers bottom-up, so the root names only derived signatures and its origin', async () => {
    const pkg = await toyPackage()
    const out = await deriveMinifiedPackage(pkg.root, pkg.record, pkg.read, minify, TOOL)
    const root = JSON.parse(dec(out.files.get(out.root)!))
    const newBee = out.modules.get(pkg.bee)!, newDep = out.modules.get(pkg.dep)!
    expect(root.cells).toHaveLength(1)
    expect(root.cells[0]).not.toBe(pkg.child)
    expect(root.dependencies).toEqual([`${newDep}.js`, `${pkg.stubborn}.js`])
    expect(root.criticalBees).toEqual([newBee])
    expect(root.derivedFrom).toBe(pkg.root)
    expect(root.derivation).toBe(out.derivation.sig)
    const child = JSON.parse(dec(out.files.get(root.cells[0])!))
    expect(child.bees).toEqual([`${newBee}.js`])
    expect(Object.keys(child.docs.bees)).toEqual([newBee])
  })

  it('traces back: the record names the readable root, the tool, and every pair — never the derived root', async () => {
    const pkg = await toyPackage()
    const out = await deriveMinifiedPackage(pkg.root, pkg.record, pkg.read, minify, TOOL)
    const record = JSON.parse(dec(out.derivation.bytes))
    expect(record).toMatchObject({ v: 1, kind: 'minify', from: pkg.root, tool: 'test-minify@1', options: { whitespace: true } })
    expect(record.modules).toEqual({ [pkg.bee]: out.modules.get(pkg.bee), [pkg.dep]: out.modules.get(pkg.dep) })
    expect(dec(out.derivation.bytes)).not.toContain(out.root)
  })

  it('a module the transform cannot handle keeps its readable bytes and signature', async () => {
    const pkg = await toyPackage()
    const out = await deriveMinifiedPackage(pkg.root, pkg.record, pkg.read, minify, TOOL)
    expect(out.modules.has(pkg.stubborn)).toBe(false)
    expect(out.record.dependencies).toContain(pkg.stubborn)
  })

  it('carries the record over in derived signatures, with bags rebuilt from it', async () => {
    const pkg = await toyPackage()
    const out = await deriveMinifiedPackage(pkg.root, pkg.record, pkg.read, minify, TOOL)
    const newBee = out.modules.get(pkg.bee)!, newDep = out.modules.get(pkg.dep)!
    expect(out.record.bees).toEqual([newBee])
    expect(out.record.dependencies).toEqual([newDep, pkg.stubborn])
    expect(out.record.beeDeps).toEqual({ [newBee]: [newDep] })
    expect(out.record.layers).toEqual([out.root, JSON.parse(dec(out.files.get(out.root)!)).cells[0]])
    expect(out.record.label).toBe('development')
    const aliases: Record<string, string> = { [newDep]: '@scope/a', [pkg.stubborn]: '@scope/b' }
    expect(out.record.dependenciesBag).toBe(await bagSignature(dependencyEntries([newDep, pkg.stubborn], sig => aliases[sig] ?? '')))
    expect(out.record.beesBag).toBe(await bagSignature(beeEntries([newBee])))
  })

  it('is deterministic: the same readable package and tool give the same root', async () => {
    const pkg = await toyPackage()
    const a = await deriveMinifiedPackage(pkg.root, pkg.record, pkg.read, minify, TOOL)
    const b = await deriveMinifiedPackage(pkg.root, pkg.record, pkg.read, minify, TOOL)
    expect(a.root).toBe(b.root)
    expect(a.derivation.sig).toBe(b.derivation.sig)
  })
})
