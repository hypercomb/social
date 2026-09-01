import { describe, expect, it, vi } from 'vitest'
import {
  googleDocUrl,
  listGoogleDocs,
  parseGoogleDocId,
  pushGoogleDoc,
  readGoogleDoc,
  type GoogleDocsBridge,
} from './google-docs.js'

const BRIDGE: GoogleDocsBridge = {
  endpoint: 'https://script.google.com/macros/s/AKfycb-example/exec',
  token: 'secret-token',
}

const ID = '1v-VlEBvSuE2NigpDwa4tRxkSl79xWO39YzzuHog0pEU'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status })

describe('Google Doc links', () => {
  it('recognises the shapes a participant actually pastes', () => {
    expect(parseGoogleDocId(`https://docs.google.com/document/d/${ID}/edit`)).toBe(ID)
    expect(parseGoogleDocId(`https://docs.google.com/document/u/0/d/${ID}/edit?usp=sharing`)).toBe(ID)
    expect(parseGoogleDocId(`https://drive.google.com/open?id=${ID}`)).toBe(ID)
    expect(parseGoogleDocId(`https://drive.google.com/file/d/${ID}/view`)).toBe(ID)
  })

  it('declines links that are not Google documents, so generic handling still runs', () => {
    expect(parseGoogleDocId('https://example.com/document/d/whatever/edit')).toBeNull()
    expect(parseGoogleDocId('https://docs.google.com/spreadsheets/u/0/')).toBeNull()
    expect(parseGoogleDocId('https://docs.google.com/document/d/tooshort/edit')).toBeNull()
    expect(parseGoogleDocId('not a url at all')).toBeNull()
  })

  it('round-trips an id back to the link a tile opens', () => {
    expect(parseGoogleDocId(googleDocUrl(ID))).toBe(ID)
  })
})

describe('Apps Script bridge envelope', () => {
  // Apps Script cannot set status codes: every failure is HTTP 200 with
  // {ok:false}. Trusting response.ok would read each one as a success.
  it('treats an ok:false body as a failure despite the HTTP 200', async () => {
    const fetcher = vi.fn(async () => json({ ok: false, error: 'unauthorized' })) as typeof fetch

    await expect(readGoogleDoc(BRIDGE, ID, fetcher)).rejects.toThrow('unauthorized')
  })

  it('reports an unreachable bridge rather than parsing the error page', async () => {
    const fetcher = vi.fn(async () => new Response('<html>Sign in</html>', { status: 401 })) as typeof fetch

    await expect(readGoogleDoc(BRIDGE, ID, fetcher)).rejects.toThrow('bridge unreachable (401)')
  })

  it('carries the token and the requested action on reads', async () => {
    const fetcher = vi.fn(async () => json({
      ok: true, id: ID, name: 'Notes', content: '# Notes', version: '7', modified: '2026-08-12T00:00:00.000Z',
    })) as unknown as ReturnType<typeof vi.fn>

    const body = await readGoogleDoc(BRIDGE, ID, fetcher as unknown as typeof fetch)

    const requested = new URL(fetcher.mock.calls[0]![0] as string)
    expect(requested.searchParams.get('action')).toBe('get')
    expect(requested.searchParams.get('id')).toBe(ID)
    expect(requested.searchParams.get('token')).toBe('secret-token')
    expect(body).toEqual({
      id: ID, name: 'Notes', content: '# Notes', version: '7', modified: '2026-08-12T00:00:00.000Z',
    })
  })
})

describe('listing the account', () => {
  it('follows continuation tokens to the end of a large Drive', async () => {
    const page = (names: string[], nextPageToken: string | null) => json({
      ok: true,
      nextPageToken,
      docs: names.map(name => ({
        id: name, name, url: googleDocUrl(name), modified: '2026-01-01T00:00:00.000Z',
        owner: 'someone@example.com', parents: [],
      })),
    })

    const fetcher = vi.fn()
      .mockResolvedValueOnce(page(['a', 'b'], 'token-2'))
      .mockResolvedValueOnce(page(['c'], null)) as unknown as typeof fetch

    const docs = await listGoogleDocs(BRIDGE, fetcher)

    expect(docs.map(doc => doc.name)).toEqual(['a', 'b', 'c'])
  })

  it('returns the partial inventory rather than throwing when paging runs away', async () => {
    const endless = vi.fn(async () => json({
      ok: true,
      nextPageToken: 'always-more',
      docs: [{ id: 'x', name: 'x', url: '', modified: '', owner: null, parents: [] }],
    })) as typeof fetch

    expect(await listGoogleDocs(BRIDGE, endless, undefined, 3)).toHaveLength(3)
  })
})

describe('pushing the hive body back', () => {
  it('posts as text/plain so the request is not killed by a CORS preflight', async () => {
    const fetcher = vi.fn(async () => json({ ok: true, version: '9' })) as unknown as ReturnType<typeof vi.fn>

    await pushGoogleDoc(
      BRIDGE,
      { id: ID, markdown: '# Rewritten', baseVersion: '8' },
      fetcher as unknown as typeof fetch,
    )

    const init = fetcher.mock.calls[0]![1] as RequestInit
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('text/plain;charset=utf-8')
    expect(JSON.parse(init.body as string)).toEqual({
      action: 'update', id: ID, markdown: '# Rewritten', baseVersion: '8', token: 'secret-token',
    })
  })

  // The case that must never read as a generic error: someone edited in Google
  // after the hive pulled, and retrying harder would destroy their work.
  it('surfaces a refused stale write as its own outcome, not a failure', async () => {
    const fetcher = vi.fn(async () => json({ ok: false, error: 'stale', current: '12' })) as typeof fetch

    expect(await pushGoogleDoc(BRIDGE, { id: ID, markdown: 'x', baseVersion: '8' }, fetcher))
      .toEqual({ status: 'stale', current: '12' })
  })

  it('reports a real failure distinctly from a stale refusal', async () => {
    const fetcher = vi.fn(async () => json({ ok: false, error: 'update failed: quota' })) as typeof fetch

    expect(await pushGoogleDoc(BRIDGE, { id: ID, markdown: 'x', baseVersion: null }, fetcher))
      .toEqual({ status: 'failed', error: 'update failed: quota' })
  })

  it('confirms the new version on a landed push', async () => {
    const fetcher = vi.fn(async () => json({ ok: true, version: '9' })) as typeof fetch

    expect(await pushGoogleDoc(BRIDGE, { id: ID, markdown: '# New', baseVersion: '8' }, fetcher))
      .toEqual({ status: 'ok', version: '9' })
  })
})
