// The room is ONE logical piece. These are the questions every frame asks it
// before putting it on screen — asked here so no frame has to answer them
// twice, and so a frame that gets a broken record falls through instead of
// mounting an empty box.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOUNGE_VIEWS, artUrls, isRoomRecord, loungeViews, resourceUrl,
  type LoungeRoomPayload,
} from './lounge-room.js'

const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)

const room = (over: Partial<LoungeRoomPayload> = {}): LoungeRoomPayload =>
  ({ version: 1, bundleSig: SIG_A, ...over })

describe('isRoomRecord', () => {

  it('a record naming its bundle is a room', () => {
    expect(isRoomRecord(room())).toBe(true)
  })

  it('a record with NO bundle is not a room — there would be nothing to mount', () => {
    expect(isRoomRecord({ version: 1 })).toBe(false)
  })

  it('a name where a signature belongs is not a room', () => {
    // The whole point of addressing the bundle by signature is that a room
    // cannot be pointed at something mutable. A path-shaped value is exactly
    // the mistake worth failing on.
    expect(isRoomRecord({ version: 1, bundleSig: 'lounge-3d.js' })).toBe(false)
  })

  it('nothing at all is not a room', () => {
    expect(isRoomRecord(null)).toBe(false)
    expect(isRoomRecord(undefined)).toBe(false)
  })
})

describe('resourceUrl', () => {

  it('keeps the file tail — the service worker types the response from it', () => {
    // Without the `.js` tail the bundle comes back as an opaque blob and the
    // browser refuses to execute it. This is the whole reason for the tail.
    expect(resourceUrl(SIG_A, 'lounge-3d.js')).toBe(`/@resource/${SIG_A}/lounge-3d.js`)
  })
})

describe('artUrls', () => {

  it('resolves each frame’s picture from its signature', () => {
    const urls = artUrls(room({ art: { lounge: SIG_A, humidor: SIG_B } }))
    expect(urls).toEqual({
      lounge: `/@resource/${SIG_A}/art.png`,
      humidor: `/@resource/${SIG_B}/art.png`,
    })
  })

  it('drops anything that is not a signature — a frame hangs what it has', () => {
    expect(artUrls(room({ art: { lounge: SIG_A, broken: 'art.png' } })))
      .toEqual({ lounge: `/@resource/${SIG_A}/art.png` })
  })

  it('a room with no art hangs the prints the bundle paints itself', () => {
    expect(artUrls(room())).toEqual({})
  })
})

describe('loungeViews', () => {

  it('offers the record’s own tour when it names one', () => {
    expect(loungeViews(room({ views: ['fire', 'chair'] }))).toEqual(['fire', 'chair'])
  })

  it('falls back to the default tour when the record names none', () => {
    expect(loungeViews(room())).toEqual([...DEFAULT_LOUNGE_VIEWS])
  })

  it('an empty list is not a tour — the default stands', () => {
    expect(loungeViews(room({ views: [] }))).toEqual([...DEFAULT_LOUNGE_VIEWS])
  })

  it('blank entries never become blank chips', () => {
    expect(loungeViews(room({ views: ['fire', '  ', 'darts'] }))).toEqual(['fire', 'darts'])
  })
})
