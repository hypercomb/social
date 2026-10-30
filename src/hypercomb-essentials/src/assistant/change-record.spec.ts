import { describe, expect, it } from 'vitest'
import { normalizeChangeRecord } from './change-record.js'

const CHANNEL = 'a'.repeat(64)
const request = {
  kind: 'change', channel: CHANNEL, id: 'abc123', task: 'plant the presentation', scope: [],
  at: 1, status: 'requested', touched: [], sentences: ['/go /', '/create presentation'],
}

describe('change record', () => {
  it('files a request as having come from elsewhere', () => {
    expect(normalizeChangeRecord(request, CHANNEL)).toEqual({ ...request, from: 'remote' })
  })

  it('builds the same bytes for an answer each time it is heard', () => {
    const answer = { kind: 'change', channel: CHANNEL, id: 'abc123', task: 't', scope: [], at: 2, status: 'applied', touched: [], note: 'said' }
    const once = normalizeChangeRecord(answer, CHANNEL)
    expect(JSON.stringify(normalizeChangeRecord(once, CHANNEL))).toBe(JSON.stringify(once))
    expect(once).toEqual(answer)
  })

  it('refuses a record for another channel', () => {
    expect(normalizeChangeRecord(request, 'b'.repeat(64))).toBeNull()
  })

  it('refuses what is not a change', () => {
    expect(normalizeChangeRecord(null, CHANNEL)).toBeNull()
    expect(normalizeChangeRecord('text', CHANNEL)).toBeNull()
    expect(normalizeChangeRecord({ ...request, kind: 'feedback' }, CHANNEL)).toBeNull()
    expect(normalizeChangeRecord({ ...request, status: 'done' }, CHANNEL)).toBeNull()
    expect(normalizeChangeRecord({ ...request, id: 7 }, CHANNEL)).toBeNull()
  })

  it('refuses sentences that are not plain lines, or too many of them', () => {
    expect(normalizeChangeRecord({ ...request, sentences: [{ run: 'x' }] }, CHANNEL)).toBeNull()
    expect(normalizeChangeRecord({ ...request, sentences: Array(501).fill('/go /') }, CHANNEL)).toBeNull()
    expect(normalizeChangeRecord({ ...request, sentences: ['x'.repeat(4001)] }, CHANNEL)).toBeNull()
  })

  it('drops fields it does not know', () => {
    const filed = normalizeChangeRecord({ ...request, run: 'eval(1)' }, CHANNEL)
    expect(filed && 'run' in filed).toBe(false)
  })
})
