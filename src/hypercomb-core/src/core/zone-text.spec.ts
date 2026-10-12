// core/zone-text.spec.ts — one text, one zone (ZI-5).

import { describe, expect, it } from 'vitest'
import { canonicalZoneText } from './zone-text.js'

describe('canonicalZoneText', () => {
  it('folds what looks the same to one text', () => {
    const cases: Array<[string, string]> = [
      ['downtown​', 'downtown'],
      ['﻿down­town⁠', 'downtown'],
      ['‎downtown‏', 'downtown'],
      ['Café', 'Café'],
      ['ガーデン'.normalize('NFD'), 'ガーデン'],
      ['ｄｏｗｎｔｏｗｎ', 'downtown'],
      ['ＤＯＷＮ　ＴＯＷＮ', 'DOWN TOWN'],
      ['joe’s', "joe's"],
      ['‘a‛', "'a'"],
      ['“rose”', '"rose"'],
      ['north—side', 'north--side'],
      ['north–side', 'north-side'],
      ['a‑b−c', 'a-b-c'],
      ['garden rose', 'garden rose'],
      ['garden  rose', 'garden rose'],
      [' garden\t\nrose ', 'garden rose'],
      ['a ​ b', 'a b'],
      ['a\u0000b', 'ab'],
    ]
    for (const [typed, canonical] of cases) expect([typed, canonicalZoneText(typed)]).toEqual([typed, canonical])
  })

  it('leaves printable ASCII with single spaces exactly as it is', () => {
    let ascii = ''
    for (let c = 0x21; c < 0x7F; c++) ascii += String.fromCharCode(c)
    for (const s of ['downtown', 'hive', 'Garden Rose', "joe's", 'north--side', ascii, `a ${ascii} b`]) {
      expect(canonicalZoneText(s)).toBe(s)
    }
  })

  it('keeps case and every script', () => {
    expect(canonicalZoneText('Garden')).toBe('Garden')
    expect(canonicalZoneText('ガーデン ローズ')).toBe('ガーデン ローズ')
    expect(canonicalZoneText('Đà Nẵng')).toBe('Đà Nẵng'.normalize('NFKC'))
  })

  it('is idempotent', () => {
    for (const s of ['north—side', 'ｄｏｗｎ  ｔｏｗｎ​', 'joe’s', 'Café ']) {
      const once = canonicalZoneText(s)
      expect(canonicalZoneText(once)).toBe(once)
    }
  })

  it('reads anything that is not a string as empty', () => {
    expect(canonicalZoneText(undefined)).toBe('')
    expect(canonicalZoneText(null)).toBe('')
    expect(canonicalZoneText(5)).toBe('')
    expect(canonicalZoneText('   ')).toBe('')
  })
})
