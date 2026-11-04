// @vitest-environment node
//
// atomic-copy.spec.ts — a torn copy is healed, never trusted by its name.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PARTIAL_SUFFIX, copyFileAtomic, entryComplete, healEntry, sweepPartials, writeFileAtomic } from './atomic-copy.js'

const SIG = 'a'.repeat(64)
let root: string
let src: string
let tgt: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'atomic-copy-'))
  src = join(root, 'src')
  tgt = join(root, 'tgt')
  mkdirSync(src)
  mkdirSync(tgt)
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('a file entry', () => {
  it('is copied whole when the target lacks it', () => {
    writeFileSync(join(src, SIG), 'the whole content')
    expect(healEntry(join(src, SIG), join(tgt, SIG))).toBe(1)
    expect(readFileSync(join(tgt, SIG), 'utf8')).toBe('the whole content')
    expect(readdirSync(tgt)).toEqual([SIG])
  })

  it('is left alone when the target is the same size — the completeness proof', () => {
    writeFileSync(join(src, SIG), 'the whole content')
    writeFileSync(join(tgt, SIG), 'the whole content')
    expect(entryComplete(join(src, SIG), join(tgt, SIG))).toBe(true)
    expect(healEntry(join(src, SIG), join(tgt, SIG))).toBe(0)
  })

  it('is replaced when a torn copy left it short under the right name', () => {
    writeFileSync(join(src, SIG), 'the whole content')
    writeFileSync(join(tgt, SIG), 'the who')
    expect(entryComplete(join(src, SIG), join(tgt, SIG))).toBe(false)
    expect(healEntry(join(src, SIG), join(tgt, SIG))).toBe(1)
    expect(readFileSync(join(tgt, SIG), 'utf8')).toBe('the whole content')
  })

  it('leaves the target untouched, and no partial behind, when the copy fails', () => {
    writeFileSync(join(tgt, SIG), 'old bytes')
    expect(() => copyFileAtomic(join(src, 'missing'), join(tgt, SIG))).toThrow()
    expect(readFileSync(join(tgt, SIG), 'utf8')).toBe('old bytes')
    expect(readdirSync(tgt)).toEqual([SIG])
  })
})

describe('a bag directory entry', () => {
  const seed = (): void => {
    mkdirSync(join(src, SIG))
    writeFileSync(join(src, SIG, '0000'), 'first')
    writeFileSync(join(src, SIG, '0001'), 'second marker')
  }

  it('is complete only when every member is complete — extra target members are fine', () => {
    seed()
    mkdirSync(join(tgt, SIG))
    writeFileSync(join(tgt, SIG, '0000'), 'first')
    expect(entryComplete(join(src, SIG), join(tgt, SIG))).toBe(false)
    writeFileSync(join(tgt, SIG, '0001'), 'second marker')
    writeFileSync(join(tgt, SIG, '0002'), 'grown since')
    expect(entryComplete(join(src, SIG), join(tgt, SIG))).toBe(true)
  })

  it('heals a bag whose last member is missing or short, writing only what it must', () => {
    seed()
    mkdirSync(join(tgt, SIG))
    writeFileSync(join(tgt, SIG, '0000'), 'first')
    writeFileSync(join(tgt, SIG, '0001'), 'seco')
    expect(healEntry(join(src, SIG), join(tgt, SIG))).toBe(1)
    expect(readFileSync(join(tgt, SIG, '0001'), 'utf8')).toBe('second marker')
    expect(healEntry(join(src, SIG), join(tgt, SIG))).toBe(0)
  })

  it('clears the partials a crashed copy left inside the bag', () => {
    seed()
    mkdirSync(join(tgt, SIG))
    writeFileSync(join(tgt, SIG, `0001${PARTIAL_SUFFIX}`), 'half')
    healEntry(join(src, SIG), join(tgt, SIG))
    expect(readdirSync(join(tgt, SIG)).sort()).toEqual(['0000', '0001'])
  })
})

describe('sweeping and atomic writes', () => {
  it('sweepPartials removes only .partial leftovers', () => {
    writeFileSync(join(tgt, SIG), 'content')
    writeFileSync(join(tgt, `${SIG}${PARTIAL_SUFFIX}`), 'half')
    expect(sweepPartials(tgt)).toBe(1)
    expect(readdirSync(tgt)).toEqual([SIG])
    expect(sweepPartials(join(root, 'nowhere'))).toBe(0)
  })

  it('writeFileAtomic replaces in one step and leaves no partial', () => {
    const path = join(tgt, '00000000')
    writeFileAtomic(path, 'one')
    writeFileAtomic(path, 'two')
    expect(readFileSync(path, 'utf8')).toBe('two')
    expect(existsSync(`${path}${PARTIAL_SUFFIX}`)).toBe(false)
  })
})
