import { describe, expect, it } from 'vitest'
import { NOTICE_FRESH_SEC, REMEMBERED_ROOMS_MAX, ROOM_NOTICE_KIND, noticeAddress, noticeTemplate, parseRememberedRooms, readNotice, withRoom, type RememberedRoom } from './room-notice.js'

const room = (n: number, at = n): RememberedRoom => ({ room: `room${n}`, secret: 's', relay: 'wss://hypercomb.com/meet', segments: ['a'], label: `Room ${n}`, at })
const ADDR = 'a'.repeat(64)
const NOW = 1_800_000_000
const notice = (over: Record<string, unknown> = {}) => ({
  id: 'e1', kind: ROOM_NOTICE_KIND, pubkey: 'B'.repeat(64), created_at: NOW - 60,
  tags: [['x', ADDR], ['d', ADDR]], content: JSON.stringify({ label: 'Lecture', segments: ['swarm-room'] }), sig: 'x',
  ...over,
})

describe('remembered rooms', () => {
  it('a room joined again moves to the front, never twice', () => {
    const list = withRoom(withRoom(withRoom([], room(1)), room(2)), room(1, 9))
    expect(list.map(r => [r.room, r.at])).toEqual([['room1', 9], ['room2', 2]])
  })

  it('keeps a bounded list and drops what is malformed', () => {
    let list: RememberedRoom[] = []
    for (let i = 0; i < REMEMBERED_ROOMS_MAX + 3; i++) list = withRoom(list, room(i))
    expect(list).toHaveLength(REMEMBERED_ROOMS_MAX)
    expect(parseRememberedRooms(JSON.stringify([...list, { room: 'x', secret: 's', relay: 'http://no' }, 7]))).toHaveLength(REMEMBERED_ROOMS_MAX)
    expect(parseRememberedRooms('not json')).toEqual([])
  })
})

describe('the notice', () => {
  it('has one address per room at its meeting point, none without a host', async () => {
    const a = await noticeAddress('Lecture', 'rose', 'wss://hypercomb.com/meet')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await noticeAddress('lecture', 'rose', 'wss://hypercomb.com/other')).toBe(a)
    expect(await noticeAddress('lecture', 'tulip', 'wss://hypercomb.com/meet')).not.toBe(a)
    expect(await noticeAddress('lecture', 'rose', '')).toBe('')
  })

  it('reads a fresh signed notice at its address', () => {
    expect(readNotice(notice(), ADDR, NOW, () => true)).toEqual({ id: 'e1', signer: 'b'.repeat(64), label: 'Lecture', segments: ['swarm-room'], at: NOW - 60 })
  })

  it('refuses another address, another kind, a stale one, a bad signature', () => {
    expect(readNotice(notice({ tags: [['x', 'c'.repeat(64)]] }), ADDR, NOW, () => true)).toBeNull()
    expect(readNotice(notice({ kind: 30568 }), ADDR, NOW, () => true)).toBeNull()
    expect(readNotice(notice({ created_at: NOW - NOTICE_FRESH_SEC - 1 }), ADDR, NOW, () => true)).toBeNull()
    expect(readNotice(notice(), ADDR, NOW, () => false)).toBeNull()
  })

  it('is addressable by its room and expires when it stops being news', () => {
    const t = noticeTemplate(ADDR, 'Lecture', ['swarm-room'], NOW)
    expect(t.tags).toEqual([['d', ADDR], ['expiration', String(NOW + NOTICE_FRESH_SEC)]])
    expect(t.content).toEqual({ label: 'Lecture', segments: ['swarm-room'] })
  })
})
