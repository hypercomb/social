#!/usr/bin/env node
// Stand-in byte store. Not the address to open.
//
// The page opens on the hive's own port: http://try-<name>.localhost:4250/
// when the hive is on localhost:4250. The dev server (hypercomb-dev/proxy.conf.cjs,
// try-page-door.cjs) returns the stored HTML there. This process keeps a
// private copy in memory and is not that door.

import http from 'node:http'

const port = Number(process.argv[2] || 4292)
const MAX_BYTES = 400_000
const LABEL = /^try-[a-z0-9](?:[a-z0-9-]{0,55}[a-z0-9])?$/
const pages = new Map()

const policy = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ')

const hostLabel = (host) => {
  const name = String(host || '').toLowerCase().replace(/:\d+$/, '')
  if (!name.endsWith('.localhost')) return ''
  const label = name.slice(0, -'.localhost'.length)
  return LABEL.test(label) ? label : ''
}

const readBody = (request) => new Promise((resolve, reject) => {
  const chunks = []
  let size = 0
  request.on('data', (chunk) => {
    size += chunk.length
    if (size > MAX_BYTES) {
      reject(new Error('too large'))
      request.destroy()
      return
    }
    chunks.push(chunk)
  })
  request.on('end', () => resolve(Buffer.concat(chunks)))
  request.on('error', reject)
})

const send = (response, status, body, type) => {
  response.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  response.end(body)
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://127.0.0.1:${port}`)
  if (request.method === 'GET' && url.pathname === '/healthz') {
    send(response, 200, 'ok', 'text/plain; charset=utf-8')
    return
  }
  if (request.method === 'POST' && url.pathname === '/') {
    const label = String(request.headers['x-hc-trial'] || '')
    if (!LABEL.test(label)) {
      send(response, 400, 'the trial name is not a try- label', 'text/plain; charset=utf-8')
      return
    }
    let body
    try { body = await readBody(request) } catch {
      send(response, 413, 'the page is too large', 'text/plain; charset=utf-8')
      return
    }
    if (!body.length) {
      send(response, 400, 'the page would be empty', 'text/plain; charset=utf-8')
      return
    }
    pages.set(label, body)
    send(response, 204, '', 'text/plain; charset=utf-8')
    return
  }
  const label = hostLabel(request.headers.host)
  if ((request.method === 'GET' || request.method === 'HEAD') && label && pages.has(label)) {
    const html = pages.get(label)
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': html.length,
      'content-security-policy': policy,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    })
    response.end(request.method === 'HEAD' ? undefined : html)
    return
  }
  send(response, 404, 'nothing here', 'text/plain; charset=utf-8')
})

server.listen(port, '127.0.0.1', () => {
  console.log(`try-page-host http://127.0.0.1:${port}/  doors at http://try-<name>.localhost:${port}/`)
})
