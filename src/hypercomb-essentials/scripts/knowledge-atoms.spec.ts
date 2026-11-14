// knowledge-atoms.spec.ts — the platform's own source rides the package as
// readable, never-run atoms: read by the section rule every module is read
// by, valid JavaScript whatever the source inside says, and the same bytes
// from the same sources.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { sectionIndex, sectionOf, minifyModuleBody } from '@hypercomb/core'
import { knowledgeAtomText, knowledgeAtoms, quoteSource } from './knowledge-atoms'

const LAZY = '// lazy — an atom: it loads through the import map when something imports it'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

describe('one atom', () => {
  const text = knowledgeAtomText('@hypercomb/source/sample', LAZY, 'a sample', [
    { path: 'src/sample/a.ts', text: '/** A doc. */\r\nexport type A = { n: number }\r\nexport const a = (x: A): number => x.n /* inline */\r\n' },
    { path: 'src/sample/b.ts', text: '// src/not/a/header.ts\nconst s = `tick ${1}`\n' },
  ])

  it('is named on line 1 and lazy on line 2, so the loader never imports it', () => {
    const lines = text.split('\n')
    expect(lines[0]).toBe('// @hypercomb/source/sample')
    expect(lines[1]!.startsWith('// lazy')).toBe(true)
    expect(() => knowledgeAtomText('@x/y', '// eager', 'no', [])).toThrow(/lazy marker/)
  })

  it('is read by the section rule every module is read by, types and comments kept', () => {
    expect(sectionIndex(text).map(section => section.path)).toEqual(['src/sample/a.ts', 'src/sample/b.ts'])
    const a = sectionOf(text, 'src/sample/a.ts')!
    const body = text.slice(a.from, a.to)
    expect(body).toContain('export type A = { n: number }')
    expect(body).toContain('/** A doc. *\\/')
    expect(body).not.toContain('\r')
    // A line that would read as a header of its own is set off, never a third section.
    expect(text).toContain('\n // src/not/a/header.ts\n')
  })

  it('is valid JavaScript that does nothing: a comment and an empty export', async () => {
    expect(quoteSource('a */ b')).toBe('a *\\/ b\n')
    const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\/\/.*$/gm, '').trim()
    expect(stripped).toBe('export {}')
    // The package's minified derivation must take it without throwing.
    const minified = await minifyModuleBody(text)
    expect(minified.replace(/\s+/g, '')).toMatch(/^(export\{\};?)?$/)
  })

  it('refuses a path the section rule could not carry, and two sources at one path', () => {
    expect(() => knowledgeAtomText('@x/y', LAZY, 'no', [{ path: 'src/has space.ts', text: '' }])).toThrow(/not a section path/)
    expect(() => knowledgeAtomText('@x/y', LAZY, 'no', [{ path: 'src/a.ts', text: '' }, { path: 'src/a.ts', text: '' }])).toThrow(/two sources/)
  })
})

describe('the atoms of this checkout', () => {
  const atoms = knowledgeAtoms(ROOT, LAZY)
  const sections = (alias: string): string[] => sectionIndex(atoms.find(atom => atom.alias === alias)!.text).map(section => section.path)

  it('carry the core, the shell, the host and the doctrine’s documents', () => {
    expect(atoms.map(atom => atom.alias)).toEqual(['@hypercomb/source/core', '@hypercomb/source/runtime', '@hypercomb/source/shim', '@hypercomb/source/documentation'])
    expect(sections('@hypercomb/source/core')).toEqual(expect.arrayContaining(['src/hypercomb-core/core/module-sections.ts', 'src/hypercomb-core/core/work-instruction.ts']))
    expect(sections('@hypercomb/source/runtime')).toEqual(expect.arrayContaining(['src/hypercomb-runtime/store.ts', 'src/hypercomb-runtime/navigation.ts', 'src/hypercomb-runtime/module-drafts.ts']))
    expect(sections('@hypercomb/source/shim')).toEqual(expect.arrayContaining(['src/hypercomb-shim/main.ts']))
    expect(sections('@hypercomb/source/documentation')).toEqual(expect.arrayContaining(['src/documentation/doctrine.codex', 'src/documentation/glossary.md', 'src/documentation/signature-system.md']))
  })

  it('hold every file as its own section and no spec', () => {
    for (const atom of atoms) {
      const paths = sectionIndex(atom.text).map(section => section.path)
      expect(paths).toHaveLength(atom.files)
      expect(paths.some(path => path.endsWith('.spec.ts'))).toBe(false)
    }
  })

  it('carry the builders’ tiers the taught doctrine leaves out', () => {
    const text = atoms.find(atom => atom.alias === '@hypercomb/source/documentation')!.text
    const codex = sectionOf(text, 'src/documentation/doctrine.codex')!
    expect(text.slice(codex.from, codex.to)).toMatch(/^@\d+ Build \[code\]/m)
  })

  it('are the same bytes from the same sources', () => {
    expect(knowledgeAtoms(ROOT, LAZY).map(atom => atom.text)).toEqual(atoms.map(atom => atom.text))
  })
})
