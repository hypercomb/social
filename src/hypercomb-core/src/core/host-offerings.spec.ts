import { afterEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure'
import { SignatureService } from './signature.service.js'
import { readHostCreations, readHostOfferings } from './host-offerings.js'

// A publisher's signed index is the member of sign('hive:indexes') named by
// their key — the only address a host answers it at.
const INDEXES = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('hive:indexes')))]
  .map(byte => byte.toString(16).padStart(2, '0')).join('')


const sha = (value: string): Promise<string> =>
  SignatureService.sign(new TextEncoder().encode(value).buffer as ArrayBuffer)

const source = 'mirror.example.net'
const route = 'https://garden.example.com/'
const head = 'a'.repeat(64)
const other = 'b'.repeat(64)

const offered = async (sourceHead: string | null, routeHead: string | null,
  servingHost = source) => {
  const index = finalizeEvent({ kind: 30564, created_at: 1, tags: [],
    content: JSON.stringify({ roots: { garden: head }, doors: { garden: ['example.com'] } }),
  }, new Uint8Array(32).fill(7))
  const location = await sha('garden.example.com')
  const bytes = JSON.stringify({ kind: 'host:offering', title: 'Garden', route,
    lineage: 'garden', pubkey: index.pubkey, location })
  const member = await sha(bytes)
  const pool = await sha('host:offerings')
  const seen: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = String(input)
    seen.push(url)
    if (url === `https://${servingHost}/content/${pool}/`) return new Response(`${member}\n`)
    if (url === `https://${servingHost}/content/${pool}/${member}`) return new Response(bytes)
    if (url === `https://garden.example.com/${INDEXES}/${index.pubkey}`) return Response.json(index)
    for (const [base, current] of [[`https://${servingHost}`, sourceHead],
      ['https://garden.example.com', routeHead]] as const) {
      if (current && url === `${base}/content/${location}/`) return new Response('00000000\n')
      if (current && url === `${base}/content/${location}/00000000`) {
        return Response.json({ layer: current })
      }
    }
    return new Response(null, { status: 404 })
  }))
  const rows = await readHostOfferings(servingHost, value => verifyEvent(value as never))
  return { rows, seen, location }
}

afterEach(() => vi.unstubAllGlobals())

describe('mirrored public offering locations', () => {
  it('takes the serving host location marker over the implementation route', async () => {
    const { rows, seen, location } = await offered(head, other)
    expect(rows).toMatchObject([{ route, head, location }])
    expect(seen).toContain(`https://${source}/content/${location}/00000000`)
    expect(seen).not.toContain(`https://garden.example.com/content/${location}/`)
  })

  it('rejects an out-of-date source bag even when the implementation bag matches', async () => {
    const { rows, seen, location } = await offered(other, head)
    expect(rows).toEqual([])
    expect(seen).not.toContain(`https://garden.example.com/content/${location}/`)
  })

  it('does not treat a cross-domain route bag as a missing mirror bag', async () => {
    const { rows, seen, location } = await offered(null, head)
    expect(rows).toEqual([])
    expect(seen).not.toContain(`https://garden.example.com/content/${location}/`)
  })

  it('reads the route bag when a portal only projects the public member', async () => {
    const { rows, seen, location } = await offered(null, head, 'example.com')
    expect(rows).toMatchObject([{ route, head, location }])
    expect(seen).toContain(`https://garden.example.com/content/${location}/00000000`)
  })
})

it('reads a signed creation from the static harness pool address', async () => {
  const host = 'localhost:4852'
  const base = `http://${host}`
  const meaning = 'themes:text'
  const key = 'editorial'
  const title = 'Editorial'
  const location = await sha(`${meaning}:${key}`)
  const layer = JSON.stringify({ name: 'text-theme', label: title, read: 'serif', code: 'plex' })
  const payload = await sha(layer)
  const meta = JSON.stringify({ meta: 1, layer: payload, relation: meaning })
  const head = await sha(meta)
  const index = finalizeEvent({ kind: 30564, created_at: 1, tags: [], content: JSON.stringify({
    offerings: { [location]: { meaning, key, title, host, head } },
  }) }, new Uint8Array(32).fill(9))
  const bytes = JSON.stringify({ kind: 'host:creation', meaning, key, title, host,
    location, pubkey: index.pubkey })
  const member = await sha(bytes)
  const pool = await sha('host:offerings')
  const seen: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = String(input)
    seen.push(url)
    if (url === `${base}/${pool}/`) return new Response(`${member}\n`)
    if (url === `${base}/${pool}/${member}`) return new Response(bytes)
    if (url === `${base}/${INDEXES}/${index.pubkey}`) return Response.json(index)
    if (url === `${base}/content/${location}/`) return new Response('00000000\n')
    if (url === `${base}/content/${location}/00000000`) return Response.json({ layer: head })
    if (url === `${base}/${head}`) return new Response(meta)
    if (url === `${base}/${payload}`) return new Response(layer)
    return new Response(null, { status: 404 })
  }))
  const rows = await readHostCreations(host, value => verifyEvent(value as never))
  expect(rows).toMatchObject([{ meaning, key, title, host, location, head, payload }])
  expect(seen).toContain(`${base}/content/${pool}/`)
  expect(seen).toContain(`${base}/${pool}/`)
})
