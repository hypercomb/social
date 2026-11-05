// The host desk is four panes — hosts, packages, files, code — drawn always, and full
// the moment it opens. (jwize, 2026-11-04: "split the screen in to four panes and show
// a nice default view" — and, much earlier, "I guess four columns".)

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultTrail } from './host-directory.view'
import { PANE_LIMITS } from './host-directory.drill'

const here = dirname(fileURLToPath(import.meta.url))
const VIEW = readFileSync(join(here, 'host-directory.view.ts'), 'utf8')

type Row = { path: string; children: number }
/** A tree as `listed(parent)` answers it: the lines under a path, in the order shown. */
const treeOf = (tree: Record<string, Row[]>) => (parent: string): readonly Row[] => tree[parent] ?? []

describe('the default view: where the four panes look before anyone picks', () => {
  const tree = treeOf({
    '': [{ path: 'assistant', children: 2 }, { path: 'games', children: 1 }, { path: 'notes', children: 0 }],
    assistant: [{ path: 'assistant/anatomy', children: 0 }, { path: 'assistant/provider', children: 0 }],
    games: [{ path: 'games/arkanoid', children: 1 }],
    'games/arkanoid': [{ path: 'games/arkanoid/themes', children: 0 }],
  })

  it('takes the first package, in the order the first column lists them, that declares code and has nothing under it', () => {
    // So the four panes are four: a package with sub-packages opens a column of its own.
    expect(defaultTrail(tree, path => path === 'assistant' || path === 'notes')).toEqual(['notes'])
    expect(defaultTrail(tree, path => path === 'games' || path === 'notes')).toEqual(['notes'])
    expect(defaultTrail(treeOf({ '': [{ path: 'a', children: 0 }, { path: 'b', children: 0 }] }), () => true)).toEqual(['a'])
  })

  it('takes the first that declares code at all when every one that does has sub-packages', () => {
    expect(defaultTrail(tree, path => path === 'assistant' || path === 'games')).toEqual(['assistant'])
    expect(defaultTrail(tree, path => path === 'games')).toEqual(['games'])
    expect(defaultTrail(tree, path => path === 'assistant')).toEqual(['assistant'])
  })

  it('goes down the branches, in the order they are listed, when no top-level package declares code', () => {
    expect(defaultTrail(tree, path => path === 'games/arkanoid/themes'))
      .toEqual(['games', 'games/arkanoid', 'games/arkanoid/themes'])
    // The first found in listed order — `assistant/anatomy` is met before anything under `games`.
    expect(defaultTrail(tree, path => path === 'assistant/provider' || path === 'games/arkanoid/themes'))
      .toEqual(['assistant', 'assistant/provider'])
    // One path per column, each the whole path to that level (what the columns' picks are).
    for (const trail of [defaultTrail(tree, path => path === 'games/arkanoid')]) {
      expect(trail.every((path, level) => path.split('/').length === level + 1)).toBe(true)
    }
  })

  it('is empty — and says nothing is there yet — while nothing listed declares code', () => {
    expect(defaultTrail(tree, () => false)).toEqual([])
    expect(defaultTrail(treeOf({}), () => true)).toEqual([])
  })

  it('does not follow a tree that never ends', () => {
    const endless = (parent: string): readonly Row[] => [{ path: `${parent}/x`.replace(/^\//, ''), children: 1 }]
    expect(defaultTrail(endless, () => false)).toEqual([])
    // Past the depth guard a match is not looked for either — a desk opens, it does not wander.
    expect(defaultTrail(endless, path => path.split('/').length > 20)).toEqual([])
  })
})

describe('the desk wears it', () => {
  it('picks the default at the top of the columns, before the model is read', () => {
    expect(VIEW).toMatch(/strip\.addEventListener\('keydown', event => this\.#colKeys\(event\)\)\s*this\.#niceView\(\)\s*const model = this\.#columnModel\(\)/)
    const niceView = VIEW.slice(VIEW.indexOf('  #niceView(): void {'), VIEW.indexOf('  /** Arrow keys walk a column'))
    // A desk somebody already picked in is left alone, and so is one with nothing to show yet.
    expect(niceView).toMatch(/if \(this\.#cols\.some\(column => column\.keys\.length\) \|\| this\.#files\.keys\.length\) \{ this\.#stopNice\(\); return \}/)
    expect(niceView).toMatch(/defaultTrail\(parent => this\.#childRows\(\[parent\]\), path => filesPicked\(nodes, \[path\]\)\.length > 0\)/)
    // An empty list is one still being read (a followed host's tree lands seconds after the desk
    // opens), so it is waited for; the default is given up only for a list with nothing in it to pick.
    expect(niceView).toMatch(/if \(!this\.#reading && this\.#childRows\(\[''\]\)\.length\) this\.#stopNice\(\)/)
    expect(niceView).not.toMatch(/this\.#loaded/)
    expect(niceView).toMatch(/this\.#cols = trail\.map\(key => \(\{ keys: \[key\], anchor: key \}\)\)/)
    expect(niceView).toMatch(/this\.#niceCols = false\s*this\.#niceFile = true/)
  })

  it('waits for the files\' names before choosing the first, so the first is the one the column shows first', () => {
    expect(VIEW).toMatch(/if \(this\.#niceFile && files\.length && !this\.#files\.keys\.length && files\.every\(file => this\.#docs\.has\(file\.layer\)\)\) \{\s*this\.#niceFile = false\s*this\.#files = pickKey\(NOTHING_PICKED, files\[0\]!\.sig, 'only', files\.map\(file => file\.sig\)\)/)
  })

  it('ends the default for good at any pick of the participant\'s own, or any letting go', () => {
    expect(VIEW).toMatch(/this\.#focusKey = path\s*this\.#stopNice\(\)\s*this\.#renderBody\(\)/)
    expect(VIEW).toMatch(/this\.#focusKey = sig\s*this\.#stopNice\(\)\s*this\.#renderBody\(\)/)
    expect(VIEW).toMatch(/this\.#stopNice\(\)\s*if \(files\) \{ this\.#files = pickAll/)
    expect(VIEW).toMatch(/this\.#files = NOTHING_PICKED\s*this\.#stopNice\(\)\s*this\.#focusKey = match\.path/)
    expect(VIEW).toMatch(/if \(this\.#files\.keys\.length\) \{ this\.#files = NOTHING_PICKED; this\.#stopNice\(\)/)
    expect(VIEW).toMatch(/this\.#cols = this\.#cols\.slice\(0, deepest\); this\.#stopNice\(\)/)
    expect(VIEW).toMatch(/#stopNice\(\): void \{\s*this\.#niceCols = false\s*this\.#niceFile = false\s*\}/)
  })

  it('gives every opening, every start again and every new stack of hosts a default view of its own', () => {
    expect(VIEW).toMatch(/#niceCols = true\s*#niceFile = false/)
    const unmount = VIEW.slice(VIEW.indexOf('  #unmount(): void {'), VIEW.indexOf('  #unmount(): void {') + 1800)
    expect(unmount).toMatch(/this\.#niceCols = true\s*this\.#niceFile = false/)
    const toDomains = VIEW.slice(VIEW.indexOf('  #toDomains(): void {'), VIEW.indexOf('  /** One host, its columns open down'))
    expect(toDomains).toMatch(/this\.#niceCols = true\s*this\.#niceFile = false/)
    const pickHost = VIEW.slice(VIEW.indexOf('  #pickHost('), VIEW.indexOf('  /** The rail\'s own entry'))
    expect(pickHost).toMatch(/this\.#niceCols = true; this\.#niceFile = false/)
  })

  it('draws the files and the code panes always, the first of the two before there is a file to put in it', () => {
    const columns = VIEW.slice(VIEW.indexOf('  #renderColumns(): HTMLElement {'), VIEW.indexOf('  /** A pick in a package column'))
    // The files pane is followed by its own edge, which is dragged to set its width.
    expect(columns).toMatch(/strip\.append\(this\.#fileColumn\(files, paths\), this\.#splitter\('files'\)\)\s*if \(files\.length\) \{\s*this\.#wantCode\(files\)\s*this\.#wantWords\(files\)\s*\}\s*strip\.append\(this\.#codeMatrix\(files\)\)/)
    // The empty files pane says what it waits for — a package to pick, or a package with no code.
    const fileColumn = VIEW.slice(VIEW.indexOf('  #fileColumn('), VIEW.indexOf('    const list = make(\'ul\', \'hd-col hd-files\')'))
    expect(fileColumn).toMatch(/t\('hosts\.files', 'Files'\)/)
    expect(fileColumn).toMatch(/t\('hosts\.files\.none', 'This package declares no code of its own\.'\)/)
    expect(fileColumn).toMatch(/t\('hosts\.files\.pick', 'Pick a package to see the code it declares\.'\)/)
    // The code pane is captioned like the others and holds the matrix or the note.
    const codePane = VIEW.slice(VIEW.indexOf('  #codeMatrix(files: readonly FileLabel[])'), VIEW.indexOf('  #codeGrid('))
    expect(codePane).toMatch(/pane\.append\(this\.#colHead\(caption, 'codeIcon'\)\)/)
    expect(codePane).toMatch(/if \(this\.#files\.keys\.length\) pane\.append\(this\.#codeGrid\(files\)\)/)
    expect(codePane).toMatch(/t\('hosts\.code\.pick', 'Pick a file to read its code here\.'\)/)
  })

  it('names the first pane as the other three are named, and retitles it with the language', () => {
    expect(VIEW).toMatch(/const railHead = make\('div', 'hd-colhead hd-rail-head', t\('hosts\.pane\.hosts', 'Hosts'\)\)/)
    expect(VIEW).toMatch(/side\.append\(search, railHead, hosts, this\.#addForm\(\)\)/)
    expect(VIEW).toMatch(/if \(railHead\) railHead\.textContent = t\('hosts\.pane\.hosts', 'Hosts'\)/)
  })

  it('fits all four panes in a 1280px desk with no sideways scroll, the columns giving before the strip scrolls', () => {
    const rem = (pattern: RegExp): number => Number(pattern.exec(VIEW)?.[1])
    // The widths are the participant's to drag (custom properties on the desk); what is
    // written here is the default each falls back to — and it is what must fit.
    const rail = rem(/\.hd-frame\{[^}]*grid-template-columns:var\(--hd-rail-w,(\d+)rem\) minmax\(0,1fr\)/)
    const column = rem(/\.hd-colbox\{flex:0 1 var\(--hd-pkg-w,(\d+)rem\);width:var\(--hd-pkg-w,\d+rem\);min-width:11rem/)
    const code = rem(/\.hd-codepane\{flex:1 0 (\d+)rem;min-width:\d+rem/)
    expect([rail, column, code]).toEqual([18, 16, 24])
    expect(PANE_LIMITS.rail.start).toBe(rail)
    expect(PANE_LIMITS.packages.start).toBe(column)
    expect(PANE_LIMITS.files.start).toBe(column)
    // Rail, one package column, the files, the code — at their widest.
    expect((rail + column + column + code) * 16).toBeLessThanOrEqual(1280)
    // The matrix no longer holds a width of its own: the pane around it does.
    expect(VIEW).toMatch(/\.hd-matrix\{flex:1 1 auto;min-height:0;overflow:auto;display:grid;/)
  })
})
