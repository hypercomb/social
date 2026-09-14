const { get } = require('node:http')

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
  },
  '/claude-bridge-health': {
    target: 'http://localhost:2401',
    bypass: bridgeHealth(2401),
  },
  '/claude-bridge-health-2411': {
    target: 'http://localhost:2411',
    bypass: bridgeHealth(2411),
  },
}
