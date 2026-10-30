import { describe, expect, it } from 'vitest'
import { sealChange, unsealChange } from './change-seal.js'

const SECRET = 'a long random secret shared by my own devices'
const CHANNEL = 'c'.repeat(64)
const RECORD = { kind: 'change', channel: CHANNEL, id: 'x', task: 'plant', status: 'requested', sentences: ['/go /'] }

describe('change seal', () => {
  it('opens what it sealed', async () => {
    const sealed = await sealChange(SECRET, CHANNEL, RECORD)
    expect(sealed.startsWith('v1.')).toBe(true)
    expect(sealed).not.toContain('plant')
    expect(await unsealChange(SECRET, CHANNEL, sealed)).toEqual(RECORD)
  })

  it('seals the same record differently each time', async () => {
    expect(await sealChange(SECRET, CHANNEL, RECORD)).not.toBe(await sealChange(SECRET, CHANNEL, RECORD))
  })

  it('does not open with another secret', async () => {
    const sealed = await sealChange(SECRET, CHANNEL, RECORD)
    expect(await unsealChange('another secret', CHANNEL, sealed)).toBeNull()
  })

  it('does not open on another channel', async () => {
    const sealed = await sealChange(SECRET, CHANNEL, RECORD)
    expect(await unsealChange(SECRET, 'd'.repeat(64), sealed)).toBeNull()
  })

  it('does not open once altered', async () => {
    const sealed = await sealChange(SECRET, CHANNEL, RECORD)
    const [v, iv, body] = sealed.split('.')
    const flipped = body!.slice(0, 10) + (body![10] === 'A' ? 'B' : 'A') + body!.slice(11)
    expect(await unsealChange(SECRET, CHANNEL, `${v}.${iv}.${flipped}`)).toBeNull()
  })

  it('refuses text that is not a seal', async () => {
    expect(await unsealChange(SECRET, CHANNEL, 'plain text')).toBeNull()
    expect(await unsealChange(SECRET, CHANNEL, 'v2.a.b')).toBeNull()
    expect(await unsealChange(SECRET, CHANNEL, '')).toBeNull()
  })
})
