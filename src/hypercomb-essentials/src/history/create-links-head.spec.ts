// history/create-links-head.spec.ts
//
// A CREATE LINKS THE HEAD. The commit path may never publish a less-detailed
// head over a live one; a remove only unlinks, and adding the name back is
// the reveal. The committer is a live drone with a cascade behind it, so this
// is a mechanical guard on the two sites that used to reset.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(process.cwd(), 'hypercomb-essentials', 'src')
const committer = readFileSync(join(ROOT, 'history', 'layer-committer.drone.ts'), 'utf8')
const code = committer.split(/\r?\n/).filter(l => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*')).join('\n')

describe('the committer', () => {
  it('never hydrates a machine EMPTY over a live head — the "fresh" reset is gone', () => {
    expect(code.includes('fromLayer(fresh ? null : prevLayer')).toBe(false)
    expect(code.includes('const fresh =')).toBe(false)
  })

  it('never commits a bare {name} over the location head on a name add', () => {
    const start = code.indexOf("d.kind === 'name'")
    const end = code.indexOf("d.kind === 'layer'", start)
    const branch = code.slice(start, end)
    expect(branch.includes('commitLayer(cellLocSig, { name: d.cell })')).toBe(false)
    expect(branch.includes('latestMarkerSigFor(cellLocSig, d.cell)')).toBe(true)
  })

  it('has no reset to announce — cell:fresh is emitted nowhere and heard nowhere', () => {
    expect(code.includes("'cell:fresh'")).toBe(false)
    const props = readFileSync(join(ROOT, 'editor', 'tile-properties.ts'), 'utf8')
      .split(/\r?\n/).filter(l => !l.trimStart().startsWith('//')).join('\n')
    expect(props.includes("'cell:fresh'")).toBe(false)
  })
})
