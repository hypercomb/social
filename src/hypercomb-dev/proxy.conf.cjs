const { get } = require('node:http')
const { handleTrial } = require('./try-page-door.cjs')

// A website trial is one stored HTML document. Answer it here, before the
// dev server would send the hive. A try- name with no page falls through,
// which is how a module door still boots.
const trialFirst = (next) => async (request, response, options) => {
  try {
    if (await handleTrial(request, response)) return '/trial-done'
  } catch {
    if (!response.writableEnded) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      response.end('the trial page could not be served')
    }
    return '/trial-done'
  }
  return next ? next(request, response, options) : undefined
}

const brokerHealthy = (port) => new Promise((resolve) => {
  let settled = false
  const done = (healthy) => {
    if (settled) return
    settled = true
    resolve(healthy)
  }
  const request = get({ host: '127.0.0.1', port, path: '/healthz', timeout: 1_000 }, (response) => {
    let body = ''
    response.setEncoding('utf8')
    response.on('data', chunk => { body += chunk })
    response.on('end', () => {
      try { done(response.statusCode === 200 && JSON.parse(body).ok === true) }
      catch { done(false) }
    })
  })
  request.on('timeout', () => request.destroy())
  request.on('error', () => done(false))
})

// The browser cannot probe an absent WebSocket without Chromium logging an
// ERR_CONNECTION_REFUSED. The development server owns that probe instead and
// always answers 200: the renderer opens its WebSocket only for `{ ok: true }`.
const bridgeHealth = (port) => async (_request, response) => {
  const ok = await brokerHealthy(port)
  if (!response.writableEnded) {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(JSON.stringify({ ok }))
  }
  // Vite recognizes the rewritten path but returns immediately because the
  // response above is already complete; no request reaches a failed proxy.
  return '/claude-bridge-health-complete'
}

module.exports = {
  '/anthropic': {
    target: 'https://api.anthropic.com',
    secure: true,
    changeOrigin: true,
    rewrite: path => path.replace(/^\/anthropic/, ''),
    bypass: trialFirst(),
  },
  '/claude-bridge-health': {
    target: 'http://localhost:2401',
    bypass: trialFirst(bridgeHealth(2401)),
  },
  '/claude-bridge-health-2411': {
    target: 'http://localhost:2411',
    bypass: trialFirst(bridgeHealth(2411)),
  },
  // Last, so the paths above still match first. Every other request on a
  // try- name that has a page is the page. Everything else is the hive.
  '^/': {
    target: 'http://127.0.0.1:9',
    bypass: trialFirst((_request) => _request.url),
  },
}
