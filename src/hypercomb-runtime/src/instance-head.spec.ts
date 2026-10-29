import { describe, expect, it } from 'vitest'
import { formatInstanceHead, parseInstanceHead } from './instance-head'

const pkg = 'ab'.repeat(32)
const derived = 'cd'.repeat(32)

describe('instance head', () => {
  it('is the package signature, and the derivation when the build has one', () => {
    expect(formatInstanceHead(pkg)).toBe(`${pkg}\n`)
    expect(formatInstanceHead(pkg.toUpperCase(), derived)).toBe(`${pkg}\n${derived}\n`)
    expect(parseInstanceHead(`${pkg}\n${derived}\n`)).toEqual({ package: pkg, derivation: derived })
    expect(parseInstanceHead(`${pkg}\n`)).toEqual({ package: pkg, derivation: null })
  })

  it('refuses a page, a blank file, and anything that is not a signature', () => {
    expect(parseInstanceHead('<!doctype html><title>Hive</title>')).toBeNull()
    expect(parseInstanceHead('')).toBeNull()
    expect(parseInstanceHead(`${pkg}\nnot-a-sig\n`)).toBeNull()
    expect(parseInstanceHead(`${pkg}\n${derived}\nextra\n`)).toBeNull()
    expect(() => formatInstanceHead('nope')).toThrow(/package/)
    expect(() => formatInstanceHead(pkg, 'nope')).toThrow(/derivation/)
  })
})
