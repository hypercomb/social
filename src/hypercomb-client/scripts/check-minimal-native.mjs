// Check the pure shim's live native host after a participant turns a creation
// on or off. The hostname is a hashed location; its highest marker is the
// switch. This reads the same HTTP contract another host would replicate.
import { createHash } from 'node:crypto'
import { get } from 'node:http'

const [baseText, hostnameText, expected] = process.argv.slice(2)
const hostname = String(hostnameText || '').trim().toLowerCase()
if (!baseText || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(hostname)
    || !['on', 'off'].includes(expected)) {
  console.error('usage: node scripts/check-minimal-native.mjs http://127.0.0.1:4270 garden.localhost on|off')
  process.exit(2)
}

const base = new URL(baseText)
if (base.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(base.hostname)
    || !base.port || base.pathname !== '/' || base.search || base.hash) {
  throw new Error('the check must address a loopback HTTP host root')
}

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const sig = value => /^[a-f0-9]{64}$/.test(value)
const request = path => new Promise((resolve, reject) => {
  const url = new URL(path, base)
  const host = `${hostname}:${url.port}`
  const req = get(url, { headers: { Host: host }, timeout: 5000 }, res => {
    const chunks = []
    let size = 0
    res.on('data', chunk => {
      size += chunk.length
      if (size > 4_194_304) { req.destroy(new Error('response too large')); return }
      chunks.push(chunk)
    })
    res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }))
    res.on('error', reject)
  })
  req.on('timeout', () => req.destroy(new Error('host timed out')))
  req.on('error', reject)
})

const json = response => JSON.parse(response.body.toString('utf8'))
const bag = sha(hostname)
const listing = await request(`/content/${bag}/`)
if (listing.status !== 200) throw new Error(`location bag ${bag} returned ${listing.status}`)
const markers = listing.body.toString('utf8').split(/\r?\n/).filter(name => /^\d{8}$/.test(name)).sort()
const markerName = markers.at(-1)
if (!markerName) throw new Error('location bag has no marker')

const markerReply = await request(`/content/${bag}/${markerName}`)
if (markerReply.status !== 200) throw new Error(`marker ${markerName} returned ${markerReply.status}`)
const layerSig = String(json(markerReply).layer || '')
if (!sig(layerSig)) throw new Error('latest marker does not name a layer signature')

const layerReply = await request(`/${layerSig}`)
if (layerReply.status !== 200 || sha(layerReply.body) !== layerSig) {
  throw new Error('activation layer bytes are absent or do not hash to their name')
}
const layer = json(layerReply)
if (layer.name !== 'host:activation' || layer.localRoute !== hostname
    || layer.enabled !== (expected === 'on') || !sig(layer.head)) {
  throw new Error('latest layer is not the expected on/off state at this location')
}

const root = await request(`/${layer.head}`)
if (root.status !== 200 || sha(root.body) !== layer.head) {
  throw new Error('selected root bytes are absent or do not hash to their name')
}

// No named route describes the door: the bag, its marker and the layer it
// names — every read above a signature — are the whole answer.
console.log(`${hostname} ${expected}: marker ${markerName}, layer ${layerSig}, root ${layer.head}`)
