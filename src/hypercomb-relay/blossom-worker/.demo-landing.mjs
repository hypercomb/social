// Demo: run the REAL, unmodified worker.js fetch() handler against the REAL
// index.visitor.html, with a real schnorr-signed hive index naming a landing
// — the actual picture captured earlier from revolucion.pluginthematrix.com
// — and serve the result so it can be opened in a browser.
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { schnorr } from '@noble/curves/secp256k1'
import worker from './worker.js'

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
const sk = Uint8Array.from({ length: 32 }, (_, i) => i === 31 ? 1 : 0)
const pubkey = hex(schnorr.getPublicKey(sk))
const head = 'a'.repeat(64)
const dir = 'C:/Users/Jaime/AppData/Local/Temp/claude/C--Projects-hypercomb-social-src/4bde05e7-3623-4dac-8a68-822e94af0cd0/scratchpad/'
const picture = readFileSync(dir + 'landing-probe.webp')
const landingSig = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', picture)))
const landing = `${landingSig}/landing.webp`

const signedIndex = async (roots, landingMap) => {
  const event = { pubkey, created_at: 1_800_000_000, kind: 30564, tags: [], content: JSON.stringify({ roots, landing: landingMap }) }
  const serial = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
  event.id = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serial))))
  event.sig = hex(schnorr.sign(event.id, sk))
  return event
}

const indexEvent = await signedIndex({ revolucion: head }, { revolucion: landing })
const realIndexHtml = readFileSync(new URL('../../hypercomb-web/src/index.visitor.html', import.meta.url))

const env = {
  SITE_BINDINGS: JSON.stringify({
    'revolucion.pluginthematrix.com': { title: 'Revolución', lineage: 'revolucion', publishers: [{ pubkey, label: 'Curator', primary: true }] },
  }),
  HIVES: { get: async (key) => key === pubkey ? JSON.stringify(indexEvent) : null },
  ASSETS: { fetch: async () => new Response(realIndexHtml, { headers: { 'content-type': 'text/html' } }) },
}

const request = new Request('https://revolucion.pluginthematrix.com/', { headers: { 'sec-fetch-dest': 'document', accept: 'text/html,*/*' } })
const response = await worker.fetch(request, env)
const paintedHtml = await response.text()
console.log('worker.fetch status:', response.status)
console.log('landing sig used:', landingSig.slice(0, 16) + '…')
console.log('painted HTML contains background-image:', paintedHtml.includes('background-image:url(/' + landing + ')'))

const server = http.createServer((req, res) => {
  if (req.url === `/${landing}`) { res.writeHead(200, { 'content-type': 'image/webp' }); res.end(picture); return }
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(paintedHtml)
})
server.listen(4711, () => console.log('demo running: http://localhost:4711/  (real worker.js output, real captured picture)'))
