// core/zone-text.spec.ts — one text, one zone (ZI-5).

import { describe, expect, it } from 'vitest'
import { SHIPPED_MEETING_POINT, canonicalZoneText, lifecyclePreimage, meetingPointKey, roomPreimage } from './zone-text.js'

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

// ── THE ROOM IS MEETING POINT + ROOM + SECRET (jwize, 2026-10-12) ──────────
describe("the room's preimage always names its meeting point", () => {
  it('an empty field, hypercomb.com and wss://HyperComb.com/ are one point — the shipped default', () => {
    expect(SHIPPED_MEETING_POINT).toBe('wss://hypercomb.com')
    for (const p of ['', '   ', undefined, null, 'hypercomb.com', 'wss://hypercomb.com', 'wss://HyperComb.com/', 'WSS://HYPERCOMB.COM', 'wss://hypercomb.com:443', 'https://hypercomb.com/']) {
      expect([p, meetingPointKey(p)]).toEqual([p, 'hypercomb.com'])
    }
  })

  it('a point is its lowercase host[:port], however it is written', () => {
    expect(meetingPointKey('wss://Point.Example/relay')).toBe('point.example')
    expect(meetingPointKey('point.example')).toBe('point.example')
    expect(meetingPointKey('ws://localhost:7777')).toBe('localhost:7777')
    expect(meetingPointKey('localhost:7777')).toBe('localhost:7777')
    expect(meetingPointKey('ws://127.0.0.1:7801')).toBe('127.0.0.1:7801')
    expect(meetingPointKey('ws://localhost:7801')).not.toBe(meetingPointKey('ws://localhost:7802'))
  })

  it('the default is never left out: room, secret and point, the point included', () => {
    expect(roomPreimage('downtown', 'rose', '')).toBe('downtown\u0000rose\u0000hypercomb.com')
    expect(roomPreimage('downtown', 'rose', 'wss://jwize.com')).toBe('downtown\u0000rose\u0000jwize.com')
    expect(lifecyclePreimage('downtown', 'rose', '')).toBe('lifecycle\u0000downtown\u0000rose\u0000hypercomb.com')
    // the preimage from before the point was part of it is no room any more
    expect(lifecyclePreimage('downtown', 'rose', '')).not.toBe('lifecycle\u0000downtown\u0000rose')
  })

  it('same point + room + secret is one preimage; another point is another room', () => {
    expect(roomPreimage('a', 'b', 'wss://HyperComb.com/')).toBe(roomPreimage('a', 'b', ''))
    expect(roomPreimage('a', 'b', 'wss://pluginthematrix.com')).not.toBe(roomPreimage('a', 'b', ''))
    // case is the room's, never the point's
    expect(roomPreimage('A', 'b', '')).not.toBe(roomPreimage('a', 'b', ''))
  })
})
