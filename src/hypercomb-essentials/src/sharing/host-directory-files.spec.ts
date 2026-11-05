// The files of a package on the host desk, by what they ARE — the logical name and
// kind the layer's own docs give them, the words a participant gave instead, and the
// code theme the source is read in. (jwize, 2026-11-04: "this should have the logical
// locations right not just the signatures?" · "include that in the meta layers so we
// can describe them and they can be overridden" · "full code theme styling like we had
// in the dcp installer website.")

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { InstallNode } from '@hypercomb/core'
import { fileWhere, filesPicked, labelFiles } from './host-directory.view'
import type { BeeDoc, BeeMeta } from './bee-meta'

const here = dirname(fileURLToPath(import.meta.url))
const VIEW = readFileSync(join(here, 'host-directory.view.ts'), 'utf8')
const sig = (n: number): string => String(n).repeat(64).slice(0, 64)
const doc = (className: string, kind = 'drone', description = ''): BeeDoc =>
  ({ className, kind, description, listens: [], emits: [], command: '', aliases: [] })

const layerNode = (path: string, layerSig: string, bees: string[]): InstallNode =>
  ({ path, name: path, layerSig, bees: bees.map(bee => `${bee}.js`), children: [], description: '', base: layerSig })

const lookup = (docs: Record<string, Record<string, BeeDoc>>, meta: Record<string, BeeMeta> = {}, source: Record<string, string> = {}) => ({
  docs: (layer: string) => docs[layer] ? new Map(Object.entries(docs[layer]!)) : undefined,
  meta: (key: string) => meta[key],
  source: (key: string) => source[key] ?? '',
})

describe('a package\'s files, by what they are', () => {
  it('knows which layer declares each file — that is where the build wrote down what it is', () => {
    const files = filesPicked([layerNode('assistant', 'L1', [sig(1), sig(2)]), layerNode('notes', 'L2', [sig(3)])], ['assistant', 'notes'])
    expect(files.map(file => `${file.path}:${file.layer}`)).toEqual(['assistant:L1', 'assistant:L1', 'notes:L2'])
  })

  it('names a file by its class and kind, and sorts the column by that name, not by hash', () => {
    const files = filesPicked([layerNode('assistant', 'L1', [sig(1), sig(2), sig(3)])], ['assistant'])
    const labelled = labelFiles(files, lookup({ L1: {
      [sig(1)]: doc('ZetaDrone', 'drone', 'last in the alphabet'),
      [sig(2)]: doc('AlphaQueen', 'queen'),
      [sig(3)]: doc('midService', 'service'),
    } }))
    expect(labelled.map(file => file.name)).toEqual(['AlphaQueen', 'midService', 'ZetaDrone'])
    expect(labelled.map(file => file.kind)).toEqual(['queen', 'service', 'drone'])
    expect(labelled[2]!.description).toBe('last in the alphabet')
    expect(labelled.every(file => !file.yoursName && !file.yoursDescription)).toBe(true)
    // The signature is the last thing the line says, never the first.
    expect(fileWhere(labelled[0]!)).toBe(`queen · assistant · ${sig(2).slice(0, 8)}`)
  })

  it('falls back to where the first line says the file came from, then to the start of its signature', () => {
    const files = filesPicked([layerNode('old', 'L0', [sig(1), sig(2)])], ['old'])
    const labelled = labelFiles(files, lookup({}, {}, { [sig(1)]: '@hypercomb/essentials/games/solomon' }))
    expect(labelled.map(file => file.name).sort()).toEqual(['solomon', sig(2).slice(0, 12)].sort())
    // No docs and no source: still a row, still pickable, with no empty kind in its line.
    expect(fileWhere({ kind: '', path: 'old', sig: sig(2) })).toBe(`old · ${sig(2).slice(0, 8)}`)
  })

  it('lets the participant\'s words win, each on its own, and says so', () => {
    const files = filesPicked([layerNode('assistant', 'L1', [sig(1), sig(2)])], ['assistant'])
    const labelled = labelFiles(files, lookup(
      { L1: { [sig(1)]: doc('OrganizeDrone', 'drone', 'sorts a layer'), [sig(2)]: doc('BetaDrone') } },
      { [sig(1)]: { name: 'Sorter' }, [sig(2)]: { description: 'mine' } },
    ))
    const sorter = labelled.find(file => file.sig === sig(1))!
    expect([sorter.name, sorter.description, sorter.yoursName, sorter.yoursDescription]).toEqual(['Sorter', 'sorts a layer', true, false])
    const beta = labelled.find(file => file.sig === sig(2))!
    expect([beta.name, beta.description, beta.yoursName, beta.yoursDescription]).toEqual(['BetaDrone', 'mine', false, true])
  })

  it('draws the same package from two hosts once, and keeps a file\'s signature to itself', () => {
    const files = filesPicked([layerNode('a', 'L1', [sig(1)]), layerNode('a', 'L9', [sig(1)])], ['a'])
    expect(labelFiles(files, lookup({})).map(file => file.sig)).toEqual([sig(1)])
  })
})

describe('the desk wears them', () => {
  it('reads each layer\'s docs and each file\'s words as the files come in, never minting a pool to read', () => {
    expect(VIEW).toMatch(/this\.#wantCode\(files\)\s*this\.#wantWords\(files\)/)
    expect(VIEW).toMatch(/const blob = \(await store\?\.getResourceLocal\?\.\(layer\)\) \?\? \(await store\?\.getResource\?\.\(layer\)\)/)
    expect(VIEW).toMatch(/this\.#docs\.set\(layer, blob \? beeDocsOf\(await blob\.text\(\)\) : new Map\(\)\)/)
    expect(VIEW).toMatch(/void readBeeMeta\(sig\)/)
    // A save made while a read was out is newer than it.
    expect(VIEW).toMatch(/if \(!this\.#meta\.has\(sig\)\) this\.#meta\.set\(sig, meta\)/)
    // A layer nobody could give is asked again the next time the desk opens.
    expect(VIEW).toMatch(/if \(!docs\.size\) this\.#docs\.delete\(layer\)/)
  })

  it('names the column and the panels with the labels, the signature last', () => {
    const column = VIEW.slice(VIEW.indexOf('#fileColumn(files: readonly FileLabel[]'), VIEW.indexOf('  #codeMatrix('))
    expect(column).toMatch(/make\('span', 'hd-file-name', file\.name\), make\('span', 'hd-file-where', fileWhere\(file\)\)/)
    expect(column).toMatch(/if \(yours\) li\.classList\.add\('mine'\)/)
    const matrix = VIEW.slice(VIEW.indexOf('  #codeMatrix('), VIEW.indexOf('  #wantCode(files: readonly FileRow[])'))
    expect(matrix).toMatch(/\[file\?\.kind, file\?\.source, file\?\.path, sig\.slice\(0, 8\)/)
    expect(matrix).toMatch(/file\.yoursDescription \? 'hd-codedesc mine' : 'hd-codedesc'/)
  })

  it('describes a file in an editor that keeps every version and can hand the published words back', () => {
    const editor = VIEW.slice(VIEW.indexOf('  #editor(file: FileLabel)'), VIEW.indexOf('  /** Keep the participant\'s words'))
    // The published words are what an empty field shows — visibly "as published".
    expect(editor).toMatch(/published\.name, 80/)
    expect(editor).toMatch(/published\.description, 600/)
    // Enter saves, as it does in every other field of the hive; Shift-Enter does not.
    expect(editor).toMatch(/event\.key === 'Enter' && !event\.shiftKey && !event\.isComposing/)
    // Handing the words back is a save too: an empty version, the history kept.
    expect(editor).toMatch(/this\.#saveWords\(file\.sig, \{\}\)/)
    expect(VIEW).toMatch(/const saved = await writeBeeMeta\(sig, words\)/)
    // A failed save changes nothing and says so.
    expect(VIEW).toMatch(/draft\.failed = true; this\.#renderBody\(\)/)
    expect(VIEW).toMatch(/this\.#meta\.set\(sig, normalizeMeta\(words\)\)/)
  })

  it('keeps what is typed through a repaint, and gives Escape a rung of its own', () => {
    expect(VIEW).toMatch(/active\.dataset\['field'\]\s*\? \{ field: active\.dataset\['field'\], from: active\.selectionStart, to: active\.selectionEnd \}/)
    expect(VIEW).toMatch(/again\.setSelectionRange\(typed\.from, typed\.to\)/)
    // The editor is the innermost thing: it goes before the menu, the search, the pick.
    expect(VIEW).toMatch(/#back\(\): boolean \{\s*if \(this\.#describing\) \{ this\.#describing = null; this\.#renderBody\(\); return true \}\s*if \(this\.#menu !== null\)/)
    // A file no longer picked has no editor open.
    expect(VIEW).toMatch(/if \(this\.#describing && !this\.#files\.keys\.includes\(this\.#describing\.sig\)\) this\.#describing = null/)
  })

  it('reads source through the code theme and styles it from the one palette', () => {
    expect(VIEW).toMatch(/import \{ codeClass, codeLanguage, codeThemeCss, tokenizeCode,/)
    expect(VIEW).toMatch(/language: codeLanguage\(text\)/)
    // Text nodes and classed spans — source is never parsed as markup.
    expect(VIEW).toMatch(/row\.append\(document\.createTextNode\(token\.text\)\)/)
    expect(VIEW).toMatch(/else row\.append\(make\('span', codeClass\(token\.kind\), token\.text\)\)/)
    expect(VIEW).not.toMatch(/innerHTML/)
    expect(VIEW).toMatch(/\$\{codeThemeCss\(S\)\}/)
    // The gutter, the active line and the head wear the palette, not the window's ink.
    expect(VIEW).toMatch(/\.hd-code \.cl::before\{[^}]*color:var\(--code-gutter\)/)
    expect(VIEW).toMatch(/\.hd-code \.cl:hover\{background:var\(--code-line\);\}/)
    expect(VIEW).toMatch(/\.hd-codename\{[^}]*color:var\(--code-plain\)/)
    // The tokens are read once for as many lines as are drawn, not at every repaint.
    expect(VIEW).toMatch(/const key = `\$\{sig\}:\$\{lines\.length\}`/)
  })
})
