// A line carrying a meeting point's access code is run and never recalled:
// recall keeps every line in origin-wide localStorage.
import { describe, expect, it } from 'vitest'
import { isSensitiveLine } from './command-history'

describe('lines the command line never remembers', () => {
  it('an access code typed after `invite code`, with or without the slash', () => {
    expect(isSensitiveLine('invite code k3y.Recycled-2')).toBe(true)
    expect(isSensitiveLine('/invite code k3y.Recycled-2')).toBe(true)
    expect(isSensitiveLine('  Invite   CODE   abc ')).toBe(true)
  })

  it('a pasted meeting link that carries a code', () => {
    expect(isSensitiveLine('https://hypercomb.io/#meet=r/s&relay=wss%3A%2F%2Fpluginthematrix.com&code=Abc_123-xyz')).toBe(true)
  })

  it('everything else is remembered as before', () => {
    for (const line of ['invite', 'invite code', '/invite wss://pluginthematrix.com', 'https://hypercomb.io/#meet=r/s', 'a tile named code=1', 'decode things']) {
      expect(isSensitiveLine(line), line).toBe(false)
    }
  })
})
