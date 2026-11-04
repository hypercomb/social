import { describe, expect, it } from 'vitest'
import { dragOutlivesLocation, primaryStillDown } from './press-liveness.js'

describe('primaryStillDown', () => {
  it('reads the primary button from the event', () => {
    expect(primaryStillDown(1)).toBe(true)
    expect(primaryStillDown(3)).toBe(true)
    // the release was swallowed before the move input heard it
    expect(primaryStillDown(0)).toBe(false)
    // right button alone is not a drag
    expect(primaryStillDown(2)).toBe(false)
  })

  it('takes a synthetic event with no buttons as held', () => {
    expect(primaryStillDown(undefined)).toBe(true)
  })
})

describe('dragOutlivesLocation', () => {
  it('ends a drag when a render is for another page', () => {
    expect(dragOutlivesLocation('/', '/misc')).toBe(true)
    expect(dragOutlivesLocation('/misc', '/')).toBe(true)
  })

  it('keeps a drag through repaints of its own page', () => {
    expect(dragOutlivesLocation('/misc', '/misc')).toBe(false)
  })

  it('has no opinion when either side is unknown', () => {
    expect(dragOutlivesLocation(null, '/misc')).toBe(false)
    expect(dragOutlivesLocation('/misc', undefined)).toBe(false)
  })
})
