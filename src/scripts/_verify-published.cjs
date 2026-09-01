// Walk the PUBLISHED head straight off the host — no browser, no bridge.
// Answers: are all layers, resources, bees and dependencies actually served?
const https = require('https')
const HOST = process.argv[2] || 'revolucion.pluginthematrix.com'
const IP = '104.21.25.138'
function get(sig, method = 'GET') {
  return new Promise(resolve => {
    const req = https.request({ host: IP, servername: HOST, headers: { Host: HOST }, path: '/' + sig, method, timeout: 20000 }, res => {
      const chunks = []
      res.on('data', d => chunks.push(d))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }))
    })
    req.on('error', () => resolve({ status: 0, body: Buffer.alloc(0) }))
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: Buffer.alloc(0) }) })
    req.end()
  })
}
const SIGRE = /^[0-9a-f]{64}$/
const CHILD = new Set(['cells', 'layers', 'children'])
;(async () => {
  const site = await new Promise(resolve => {
    const req = https.request({ host: IP, servername: HOST, headers: { Host: HOST }, path: '/site.json', timeout: 20000 }, res => {
      const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve(JSON.parse(Buffer.concat(c).toString())))
    }); req.on('error', () => resolve(null)); req.end()
  })
  console.log('head', site && site.head)
  const visited = new Set(), missing = [], kinds = { layer: 0, resource: 0, bee: 0, dependency: 0 }
  const queue = [[site.head, 'layer', 'root']]
  while (queue.length) {
    const [sig, kind, via] = queue.shift()
    if (visited.has(sig)) continue
    visited.add(sig)
    const r = await get(sig)
    if (r.status !== 200) { missing.push({ sig, kind, via, status: r.status }); continue }
    kinds[kind] = (kinds[kind] || 0) + 1
    if (kind === 'bee' || kind === 'dependency') continue
    let obj = null
    try { obj = JSON.parse(r.body.toString()) } catch { continue }
    if (!obj || typeof obj !== 'object') continue
    if (typeof obj.kind === 'string' && (obj.kind === 'group' || obj.kind === 'creation')) continue
    for (const [slot, value] of Object.entries(obj)) {
      if (!Array.isArray(value)) continue
      const refKind = CHILD.has(slot) ? 'layer' : slot === 'bees' ? 'bee' : slot === 'dependencies' ? 'dependency' : 'resource'
      for (const raw of value) {
        const ref = String(raw ?? '').toLowerCase()
        if (SIGRE.test(ref) && !visited.has(ref)) queue.push([ref, refKind, `${via}>${slot}`])
      }
    }
    if (kind === 'resource' && !obj.kind) {
      const hex = new Set((r.body.toString().match(/\b[0-9a-f]{64}\b/g) || []))
      for (const ref of hex) if (!visited.has(ref)) queue.push([ref, 'resource', `${via}>nested`])
    }
    if (visited.size % 250 === 0) console.error(`...${visited.size} walked, ${missing.length} missing`)
  }
  console.log('walked', visited.size, JSON.stringify(kinds))
  console.log('MISSING', missing.length)
  console.log(JSON.stringify(missing.slice(0, 40), null, 1))
})()
