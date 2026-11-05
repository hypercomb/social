// The simple drill, the panes' widths and the order finished work is listed in
// (host-directory.drill.ts) — the part of the desk that needs no DOM.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PANE_LIMITS, clampPane, crumbTrail, deskRecord, deskRecordText, drillPage, drillRows, finishedLast, isFileKey,
} from './host-directory.drill'

const col = (paths: string[], picked: string[] = []) => ({ rows: paths.map(path => ({ path })), picked: { keys: picked } })

describe('which page the drill is on', () => {
  it('is the hosts until one is opened, then its packages, then the code being read', () => {
    expect(drillPage({ atHosts: true, reading: false, filesPicked: 0 })).toBe('hosts')
    expect(drillPage({ atHosts: true, reading: true, filesPicked: 2 })).toBe('hosts')
    expect(drillPage({ atHosts: false, reading: false, filesPicked: 0 })).toBe('packages')
    expect(drillPage({ atHosts: false, reading: false, filesPicked: 3 })).toBe('packages')
    expect(drillPage({ atHosts: false, reading: true, filesPicked: 1 })).toBe('code')
    // Reading needs something to read: with nothing picked it is still the packages.
    expect(drillPage({ atHosts: false, reading: true, filesPicked: 0 })).toBe('packages')
  })
})

describe('the list a packages page shows', () => {
  it('is the top of the host before anything is picked, with no files', () => {
    const page = drillRows([col(['assistant', 'games', 'notes'])])
    expect(page.level).toBe(0)
    expect(page.rows.map(row => row.path)).toEqual(['assistant', 'games', 'notes'])
    expect(page.paths).toEqual([])
  })

  it('is what is inside the package picked, and that package\'s files', () => {
    const page = drillRows([col(['assistant', 'games'], ['assistant']), col(['assistant/anatomy', 'assistant/provider'])])
    expect(page.level).toBe(1)
    expect(page.rows.map(row => row.path)).toEqual(['assistant/anatomy', 'assistant/provider'])
    expect(page.paths).toEqual(['assistant'])
  })

  it('goes down a level for each pick, and lists only files when nothing is inside', () => {
    const page = drillRows([
      col(['assistant', 'games'], ['assistant']),
      col(['assistant/anatomy', 'assistant/provider'], ['assistant/anatomy']),
    ])
    expect(page.level).toBe(2)
    expect(page.rows).toEqual([])
    expect(page.paths).toEqual(['assistant/anatomy'])
  })

  it('opens several at once: the files of all of them', () => {
    const page = drillRows([col(['a', 'b', 'c'], ['a', 'c']), col(['a/x'])])
    expect(page.level).toBe(1)
    expect(page.paths).toEqual(['a', 'c'])
  })

  it('has no list and no files when nothing is listed', () => {
    expect(drillRows([])).toEqual({ level: 0, rows: [], paths: [] })
  })
})

describe('the trail above a page', () => {
  it('is only the hosts at the hosts', () => {
    expect(crumbTrail({ atHosts: true, hosts: ['x.com'], picks: [], reading: 0 })).toEqual([{ kind: 'hosts', one: '', count: 0 }])
  })

  it('names the host, each level of packages by its last part, and the files read', () => {
    expect(crumbTrail({ atHosts: false, hosts: ['try.localhost'], picks: [['assistant'], ['assistant/anatomy']], reading: 2 })).toEqual([
      { kind: 'hosts', one: '', count: 0 },
      { kind: 'host', one: 'try.localhost', count: 1 },
      { kind: 'package', one: 'assistant', count: 1 },
      { kind: 'package', one: 'anatomy', count: 1 },
      { kind: 'file', one: '', count: 2 },
    ])
  })

  it('counts when there are several, and stops at the first level nothing is picked in', () => {
    const trail = crumbTrail({ atHosts: false, hosts: ['a.com', 'b.com'], picks: [['x', 'y'], [], ['z']], reading: 0 })
    expect(trail.map(crumb => `${crumb.kind}:${crumb.one}:${crumb.count}`)).toEqual(['hosts::0', 'host::2', 'package::2'])
  })

  it('knows a file from a package by what it is called', () => {
    expect(isFileKey('a'.repeat(64))).toBe(true)
    expect(isFileKey('assistant/anatomy')).toBe(false)
    expect(isFileKey('a'.repeat(63))).toBe(false)
  })
})

describe('what the desk keeps', () => {
  it('is the simple view unless advanced was chosen, and only widths that are numbers', () => {
    expect(deskRecord(null)).toEqual({ mode: 'simple', panes: {} })
    expect(deskRecord('x')).toEqual({ mode: 'simple', panes: {} })
    expect(deskRecord([])).toEqual({ mode: 'simple', panes: {} })
    expect(deskRecord({ mode: 'advanced', panes: { rail: 20, files: 'wide', packages: null } })).toEqual({ mode: 'advanced', panes: { rail: 20 } })
    expect(deskRecord({ mode: 'four', panes: {} }).mode).toBe('simple')
  })

  it('holds every width inside what a pane can be, to a tenth of a rem', () => {
    expect(clampPane('rail', 3)).toBe(PANE_LIMITS.rail.min)
    expect(clampPane('rail', 400)).toBe(PANE_LIMITS.rail.max)
    expect(clampPane('files', 17.26)).toBe(17.3)
    expect(clampPane('packages', 'wide')).toBe(PANE_LIMITS.packages.start)
    expect(clampPane('packages', NaN)).toBe(PANE_LIMITS.packages.start)
    expect(deskRecord({ panes: { rail: 999 } }).panes.rail).toBe(PANE_LIMITS.rail.max)
  })

  it('writes the same choices as the same bytes, and reads back what it wrote', () => {
    const text = deskRecordText({ mode: 'advanced', panes: { files: 19.5, rail: 21 } })
    expect(text).toBe('{"mode":"advanced","panes":{"rail":21,"files":19.5}}')
    expect(deskRecord(JSON.parse(text))).toEqual({ mode: 'advanced', panes: { rail: 21, files: 19.5 } })
    expect(deskRecordText({ mode: 'simple', panes: {} })).toBe('{"mode":"simple","panes":{}}')
  })
})

describe('finished work goes last', () => {
  it('keeps the order of each group and puts the finished after what is still moving', () => {
    const rows = [
      { name: 'a', done: true }, { name: 'b', done: false }, { name: 'c', done: true },
      { name: 'd', done: false }, { name: 'e', done: true },
    ]
    expect(finishedLast(rows, row => row.done).map(row => row.name)).toEqual(['b', 'd', 'a', 'c', 'e'])
  })

  it('changes nothing when nothing, or everything, is finished — and never changes the list it was given', () => {
    const rows = [{ n: 1 }, { n: 2 }]
    expect(finishedLast(rows, () => false)).toEqual(rows)
    expect(finishedLast(rows, () => true)).toEqual(rows)
    finishedLast(rows, row => row.n === 1)
    expect(rows).toEqual([{ n: 1 }, { n: 2 }])
    expect(finishedLast([], () => true)).toEqual([])
  })

  it('imports nothing: a module reaches no other tier', () => {
    const source = readFileSync(join(__dirname, 'host-directory.drill.ts'), 'utf8')
    expect([...source.matchAll(/^import .*$/gm)]).toEqual([])
  })
})
