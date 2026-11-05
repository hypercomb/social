// The host desk's two ways to look — the SIMPLE drill (the default) and the ADVANCED four
// panes — the draggable, remembered pane widths, and the finished updates dropping to
// the bottom. The rules that need no DOM are in host-directory.drill.spec.ts; this pins
// the shape the view has to keep. (jwize, 2026-11-05: "the other should just be the hosts
// list large in the middle with a drill down to the code … maybe the items can be toggled
// as a multiselect" · "no I think we need both" · "this four pane view is beautiful" ·
// "the panes need to be draggable to set your preference (sticky)" · "the completed items
// when they get finished drop to the bottom of the list with a completed style".)

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..', '..')
const VIEW = readFileSync(join(here, 'host-directory.view.ts'), 'utf8')
const REGISTRY = readFileSync(join(root, 'hypercomb-core', 'src', 'core', 'pool-registry.ts'), 'utf8')
const EN = JSON.parse(readFileSync(join(root, 'hypercomb-shared', 'i18n', 'en.json'), 'utf8')) as Record<string, string>

const between = (from: string, to: string): string => VIEW.slice(VIEW.indexOf(from), VIEW.indexOf(to, VIEW.indexOf(from) + 1))

describe('the simple drill', () => {
  it('is the way the desk opens, and the four panes are one switch away', () => {
    expect(VIEW).toMatch(/#mode: DeskMode = 'simple'/)
    expect(VIEW).toMatch(/modeButton\.addEventListener\('click', \(\) => this\.#setMode\(this\.#mode === 'simple' \? 'advanced' : 'simple'\)\)/)
    // The switch names the OTHER way to look.
    expect(VIEW).toMatch(/this\.#mode === 'simple' \? t\('hosts\.mode\.advanced', 'Advanced'\) : t\('hosts\.mode\.simple', 'Simple view'\)/)
  })

  it('draws the simple page or the four panes — and the four panes are drawn exactly as they were', () => {
    const body = between('    const under: View = drawer', '    this.#renderDrawer(drawer)')
    expect(body).toMatch(/body\.classList\.toggle\('with-columns', !simple && under === 'domains' && !this\.#query\.trim\(\)\)/)
    expect(body).toMatch(/if \(under === 'domains'\) \{ if \(simple\) this\.#renderSimple\(body\); else this\.#renderPane\(body\) \}/)
    // Without the rail there is no way back from your host, the creations or your hive but a back row.
    expect(body).toMatch(/if \(simple\) body\.append\(this\.#backRow\(\)\)/)
  })

  it('goes hosts, then packages with their files, then the code — one page at a time', () => {
    const render = between('  #renderSimple(body: HTMLElement): void {', '  /** Back, the trail of where you are')
    expect(render).toMatch(/drillPage\(\{ atHosts: this\.#atHosts, reading: this\.#readCode, filesPicked: this\.#files\.keys\.length \}\)/)
    expect(render).toMatch(/if \(page === 'hosts'\) this\.#hostsPage\(wrap\)/)
    expect(render).toMatch(/else if \(page === 'packages'\) this\.#packagesPage\(wrap, model, files, paths\)/)
    expect(render).toMatch(/else this\.#codePage\(wrap, files\)/)
    // The code page is wide, the others are one comfortable column.
    expect(render).toMatch(/`hd-simple\$\{page === 'code' \? ' wide' : ''\}`/)
  })

  it('takes a step in on a click — and has no select: that is for the four panes', () => {
    const choose = between('  #chooseRow(', '  /** Go into these hosts')
    expect(choose).toMatch(/if \(kind === 'host'\) \{ this\.#openHosts\(\[key\]\); return \}/)
    expect(choose).toMatch(/this\.#cols = \[\.\.\.this\.#cols\.slice\(0, k\), \{ keys: \[key\], anchor: key \}\]/)
    expect(choose).toMatch(/this\.#files = \{ keys: \[key\], anchor: key \}\s*this\.#readCode = true/)
    expect(choose).not.toMatch(/#multi|#chosen/)
    // The rows are the ones the four panes use: the light, the update mark, the manage menu all come with them.
    expect(VIEW).toMatch(/if \(simple\) this\.#chooseRow\(row\.path, 'package', k\)/)
    expect(VIEW).toMatch(/if \(simple\) this\.#chooseRow\(file\.sig, 'file', -1\)/)
    // Nothing of the old drill select is left: no check boxes on its pages, no bar, no checked set.
    const drill = between('  // ── the simple drill', '  // ── the way to look')
    expect(drill).not.toMatch(/#selectBar|#endSelect|#chosen|hd-selectbar|hosts\.select\.(count|open|read|clear)/)
    expect(VIEW).not.toMatch(/#chosen/)
    expect(between('  #hostsPage(', '  /** PAGE TWO')).not.toMatch(/#checkBox|#multi/)
  })

  it('selects several in the four panes — Ctrl/Cmd-click as the Finder does, or the Select toggle', () => {
    // A plain click toggles while Select is on; Ctrl/Cmd and Shift keep their Finder meaning either way.
    const modeOf = between('  #modeOf(', '  /** SELECT, in the four panes')
    expect(modeOf).toMatch(/const mode = pickMode\(event\)/)
    expect(modeOf).toMatch(/return this\.#multi && mode === 'only' \? 'toggle' : mode/)
    // Every four-pane click goes through it: the rail's hosts, the packages and the files.
    expect(VIEW).toMatch(/this\.#pickHost\(domain\.zone, this\.#modeOf\(event\), order\)/)
    expect(VIEW).toMatch(/else this\.#pickPackage\(k, row\.path, this\.#modeOf\(event\), order\)/)
    expect(VIEW).toMatch(/else this\.#pickFile\(file\.sig, this\.#modeOf\(event\), order\)/)
    expect(VIEW).not.toMatch(/pickMode\(event\), order\)/)
    // The toggle sits in the desk's head, only in the four panes, and says whether it is on.
    expect(VIEW).toMatch(/selectButton\.addEventListener\('click', \(\) => this\.#setMulti\(!this\.#multi\)\)/)
    expect(VIEW).toMatch(/select\.hidden = this\.#mode === 'simple'/)
    expect(VIEW).toMatch(/select\.setAttribute\('aria-pressed', String\(this\.#multi\)\)/)
    // Check boxes appear on the four panes' package and file rows while it is on — and never in the drill.
    expect(VIEW).toMatch(/if \(!simple && this\.#multi\) \{\s*li\.classList\.add\('hd-checking'\)/)
    expect(VIEW).toMatch(/if \(!simple && this\.#multi\) li\.prepend\(this\.#checkBox\(/)
    // It is the four panes' own: switching ways to look puts it off, and Escape lets go of it first.
    expect(between('  #setMode(', '  /** A pane\'s edge')).toMatch(/this\.#multi = false/)
    expect(between('  #back(): boolean {', '  // ── what is on screen')).toMatch(/if \(this\.#multi\) \{ this\.#setMulti\(false\); return true \}/)
  })

  it('opens several hosts only through the four panes: stacked in the rail', () => {
    // The drill goes into ONE host; stacking several is the rail's, by Ctrl/Cmd-click or Select.
    expect(between('  #hostsPage(', '  /** PAGE TWO')).toMatch(/this\.#chooseRow\(domain\.zone, 'host', -1\)/)
    expect(VIEW).toMatch(/this\.#stack = \{ keys, anchor: keys\[0\]! \}/)
  })

  it('gives Escape the drill\'s steps, innermost first, and the list of hosts last', () => {
    const back = between('  #back(): boolean {', '  // ── what is on screen')
    const order = ['this.#describing', 'this.#menu !== null', 'this.#multi', 'this.#query', 'this.#codeGate', 'this.#warning', "this.#view !== 'domains'", 'this.#readCode', 'this.#files.keys.length', 'const deepest', "this.#mode === 'simple' && !this.#atHosts"]
    const at = order.map(needle => back.indexOf(needle))
    expect(at.every(index => index >= 0), at.join()).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
  })

  it('starts at the hosts each opening, and keeps no Select on from one to the next', () => {
    const unmount = VIEW.slice(VIEW.indexOf('  #unmount(): void {'), VIEW.indexOf('  #unmount(): void {') + 1800)
    expect(unmount).toMatch(/this\.#atHosts = true\s*this\.#readCode = false\s*this\.#multi = false/)
    // Back where a restart left it: inside the host.
    expect(between('  #toList(', '  /** The picks that lead down a path')).toMatch(/this\.#atHosts = false/)
  })

  it('arrows move along a list, and going in is Enter or a click', () => {
    const keys = between('  #simpleKeys(', '  // ── the way to look')
    expect(keys).toMatch(/event\.key === 'ArrowDown'\) move\(1\)/)
    expect(keys).toMatch(/\(event\.key === 'Enter' \|\| event\.key === ' '\) && target === line/)
    expect(keys).not.toMatch(/#pickPackage|#pickFile/)
  })

  it('has no rail in it: the hosts are the first page', () => {
    expect(VIEW).toMatch(/\.hd-panel\.simple \.hd-side\{display:none;\}/)
    expect(VIEW).toMatch(/\.hd-panel\.simple \.hd-frame,[\s\S]{0,40}\.hd-panel\.simple \.hd-frame\.with-drawer\{grid-template-columns:minmax\(0,1fr\);\}/)
    // The revisions drawer lies over the page, as it does on a narrow screen.
    expect(VIEW).toMatch(/\.hd-panel\.simple \.hd-drawer\{position:absolute;inset:0;/)
  })
})

describe('the panes are dragged, and the width is kept', () => {
  it('sets the width live as a custom property on the desk, and keeps it when it is let go', () => {
    const split = between('  #splitter(pane: PaneName)', '  #paneWidth(pane: PaneName)')
    expect(split).toMatch(/bar\.setPointerCapture\(down\.pointerId\)/)
    expect(split).toMatch(/this\.#setPane\(pane, start \+ \(event\.clientX - from\) \/ rem\(\), false\)/)
    expect(split).toMatch(/bar\.removeEventListener\('pointerup', end\)[\s\S]*void this\.#keepRecord\(\)/)
    // Keyboard and double-click: nudge a rem, or give it back.
    expect(split).toMatch(/event\.key === 'ArrowLeft' \? -1 : event\.key === 'ArrowRight' \? 1 : 0/)
    expect(split).toMatch(/bar\.addEventListener\('dblclick', \(\) => this\.#resetPane\(pane\)\)/)
    expect(split).toMatch(/bar\.setAttribute\('role', 'separator'\)/)
    expect(VIEW).toMatch(/names: Record<PaneName, string> = \{ rail: '--hd-rail-w', packages: '--hd-pkg-w', files: '--hd-files-w' \}/)
  })

  it('has an edge after each of the three panes that have a width of their own', () => {
    expect(VIEW).toMatch(/frame\.append\(side, main, drawer, this\.#splitter\('rail'\)\)/)
    expect(VIEW).toMatch(/strip\.append\(this\.#splitter\('packages'\)\)/)
    expect(VIEW).toMatch(/strip\.append\(this\.#fileColumn\(files, paths\), this\.#splitter\('files'\)\)/)
    // The simple page has no panes to drag, and a narrow desk has no room for them.
    expect(VIEW).toMatch(/\.hd-panel\.simple \.hd-split\{display:none;\}/)
  })

  it('keeps one current record in its own pool, written only by a press or a drag', () => {
    expect(VIEW).toMatch(/const DESK_POOL = 'hosts:desk'/)
    expect(REGISTRY).toMatch(/'hosts:desk',/)
    const keep = between('  async #keepRecord()', '  /** What the participant left')
    expect(keep).toMatch(/store\.putPoolDoc\(pool, bytes, undefined, \{ keep: 'current' \}\)/)
    expect(keep).toMatch(/deskRecordText\(\{ mode: this\.#mode, panes: this\.#panes \}\)/)
    // Never from the desk's own initiative: only #setMode and the three ways a pane is set.
    const writers = [...VIEW.matchAll(/void this\.#keepRecord\(\)/g)].length
    expect(writers).toBe(4)
  })

  it('reads it without minting the pool, and a press made first wins', () => {
    const recall = between('  async #recallRecord(', '  /** The files of what is picked')
    expect(recall).toMatch(/store\?\.openPool\?\.\(DESK_POOL\)/)
    expect(recall).not.toMatch(/getPool\?\./)
    expect(recall).toMatch(/this\.#panel !== panel \|\| this\.#touched/)
    expect(VIEW).toMatch(/void this\.#recallRecord\(panel\)/)
  })

  it('reads the widths from the stylesheet\'s fallbacks until one is dragged', () => {
    expect(VIEW).toMatch(/grid-template-columns:var\(--hd-rail-w,18rem\) minmax\(0,1fr\)/)
    expect(VIEW).toMatch(/\.hd-colbox\.hd-filesbox\{flex-basis:var\(--hd-files-w,16rem\);width:var\(--hd-files-w,16rem\);\}/)
    expect(VIEW).toMatch(/\.hd-split-rail\{position:absolute;top:0;bottom:0;left:var\(--hd-rail-w,18rem\);\}/)
  })
})

describe('finished updates go last', () => {
  it('drops a package whose update has landed to the bottom, and dresses it as completed', () => {
    const column = between('  #packageColumn(', '    for (const row of shown) {')
    expect(column).toMatch(/const landed = \(row: StackRow\): boolean => \{/)
    expect(column).toMatch(/return !!measured\.total && measured\.done >= measured\.total/)
    expect(column).toMatch(/const shown = finishedLast\(changing\.length \? changing : rows, landed\)/)
    expect(VIEW).toMatch(/if \(done\) li\.classList\.add\('completed'\)/)
    expect(VIEW).toMatch(/\.hd-row\.completed\{opacity:\.62;\}/)
    expect(VIEW).toMatch(/\.hd-row\.completed \.hd-name::before\{content:'✓ ';/)
  })
})

describe('the strings', () => {
  it('has every new label in English', () => {
    for (const key of ['hosts.mode.advanced', 'hosts.mode.simple', 'hosts.back', 'hosts.trail', 'hosts.select', 'hosts.select-tip', 'hosts.split']) {
      expect(EN[key], key).toBeTruthy()
    }
    expect(EN['hosts.trail.files.one']).toBe('One file')
  })
})
