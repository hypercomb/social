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

// ── THE ROOM IS HOST + ROOM + SECRET (jwize, 2026-10-11/12) ────────────────
describe("the room's preimage always names its host", () => {
  it('hypercomb.com however it is written is one host — offered, never a default', () => {
    expect(SHIPPED_MEETING_POINT).toBe('wss://hypercomb.com')
    for (const p of ['hypercomb.com', 'wss://hypercomb.com', 'wss://HyperComb.com/', 'WSS://HYPERCOMB.COM', 'wss://hypercomb.com:443', 'https://hypercomb.com/', SHIPPED_MEETING_POINT]) {
      expect([p, meetingPointKey(p)]).toEqual([p, 'hypercomb.com'])
    }
  })

  it('NO HOST, NO ROOM: an empty field, or one that is no address, names no host — never a default', () => {
    for (const p of ['', '   ', undefined, null, 42, 'wss://', 'not a host at all']) {
      expect([p, meetingPointKey(p)]).toEqual([p, ''])
      expect([p, roomPreimage('downtown', 'rose', p)]).toEqual([p, ''])
      expect([p, lifecyclePreimage('downtown', 'rose', p)]).toEqual([p, ''])
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

  it('room, secret and host — the host always included', () => {
    expect(roomPreimage('downtown', 'rose', 'hypercomb.com')).toBe('downtown\u0000rose\u0000hypercomb.com')
    expect(roomPreimage('downtown', 'rose', 'wss://jwize.com')).toBe('downtown\u0000rose\u0000jwize.com')
    expect(lifecyclePreimage('downtown', 'rose', 'wss://hypercomb.com')).toBe('lifecycle\u0000downtown\u0000rose\u0000hypercomb.com')
    // the preimage from before the host was part of it is no room any more
    expect(lifecyclePreimage('downtown', 'rose', 'wss://hypercomb.com')).not.toBe('lifecycle\u0000downtown\u0000rose')
  })

  it('same host + room + secret is one preimage; another host is another room', () => {
    const H = 'wss://hypercomb.com'
    expect(roomPreimage('a', 'b', 'wss://HyperComb.com/')).toBe(roomPreimage('a', 'b', H))
    expect(roomPreimage('a', 'b', 'wss://pluginthematrix.com')).not.toBe(roomPreimage('a', 'b', H))
    // case is the room's, never the host's
    expect(roomPreimage('A', 'b', H)).not.toBe(roomPreimage('a', 'b', H))
  })

  it('two names for one physical relay are two rooms, on purpose (2026-10-11: localhost:7777 and jwize.com on one PC)', () => {
    expect(lifecyclePreimage('a', 'b', 'ws://localhost:7777')).not.toBe(lifecyclePreimage('a', 'b', 'wss://jwize.com'))
    expect(lifecyclePreimage('a', 'b', 'ws://localhost:7777')).not.toBe(lifecyclePreimage('a', 'b', 'ws://127.0.0.1:7777'))
  })
})
