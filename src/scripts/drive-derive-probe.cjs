// scripts/drive-derive-probe.cjs
//
// Probe both browsers for the EXACT inputs feeding channelIdFor:
//   - SecretStore.value
//   - RoomStore.value
//   - HistoryService.sign(lineage) — the bag sig
// Then re-derive channelId locally in node from those inputs and
// compare to what the drone reports. Goal: find which input diverges.

const { chromium } = require('playwright')
const crypto = require('crypto')

const URL_A = 'http://localhost:4250/'
const URL_B = 'http://localhost:4260/'
const ROOM = 'sync-test-room'
const SECRET = 'sync-test-secret'

async function configure(page) {
  await page.evaluate(({ room, secret }) => {
    localStorage.setItem('hc:room', room)
    localStorage.setItem('hc:secret', secret)
    localStorage.setItem('hc:mesh-public', 'true')
    localStorage.setItem('hc:nostrmesh:network', '1')
    localStorage.removeItem('hc:secret-cleared')
  }, { room: ROOM, secret: SECRET })
}

async function probe(page) {
  return page.evaluate(async () => {
    const ioc = window.ioc
    const room = ioc.get('@hypercomb.social/RoomStore')?.value
    const secret = ioc.get('@hypercomb.social/SecretStore')?.value
    const lineage = ioc.get('@hypercomb.social/Lineage')
    const history = ioc.get('@diamondcoreprocessor.com/HistoryService')
    const segments = lineage?.explorerSegments?.() ?? null
    const domain = lineage?.domain?.() ?? null
    let lineageSig = null
    try { lineageSig = await history?.sign?.(lineage) } catch (e) { lineageSig = 'ERR:' + String(e) }
    const drone = ioc.get('@diamondcoreprocessor.com/PairedChannelDrone')
    const channels = drone?.joinedChannels?.() ?? []
    return {
      room, secret, segments, domain, lineageSig,
      droneChannel: channels[0] ?? null,
      historyRegistered: !!history,
    }
  })
}

function nodeDeriveChannel(lineageSig, secret) {
  // Mirror channelIdFor: sha256(`${lineageSig.length}:${lineageSig}|${secret.length}:${secret}`)
  const sig = String(lineageSig ?? '').trim().toLowerCase()
  const sec = String(secret ?? '').trim()
  const input = `${sig.length}:${sig}|${sec.length}:${sec}`
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex')
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const A = await ctxA.newPage()
  const B = await ctxB.newPage()

  await A.goto(URL_A, { waitUntil: 'domcontentloaded' })
  await B.goto(URL_B, { waitUntil: 'domcontentloaded' })
  await new Promise(r => setTimeout(r, 1500))

  await configure(A)
  await configure(B)
  await A.reload({ waitUntil: 'domcontentloaded' })
  await B.reload({ waitUntil: 'domcontentloaded' })
  await new Promise(r => setTimeout(r, 4000))

  const pa = await probe(A)
  const pb = await probe(B)

  console.log('=== A (4250 hypercomb-dev) ===')
  console.log(JSON.stringify(pa, null, 2))
  console.log('=== B (4260 hypercomb-web) ===')
  console.log(JSON.stringify(pb, null, 2))

  console.log('\n=== node-side re-derivation ===')
  const aChan = nodeDeriveChannel(pa.lineageSig, pa.secret)
  const bChan = nodeDeriveChannel(pb.lineageSig, pb.secret)
  console.log('A node-derived channel:', aChan)
  console.log('A drone channel       :', pa.droneChannel)
  console.log('A match?', aChan === pa.droneChannel)
  console.log('B node-derived channel:', bChan)
  console.log('B drone channel       :', pb.droneChannel)
  console.log('B match?', bChan === pb.droneChannel)

  console.log('\n=== divergence analysis ===')
  console.log('secret same? ', pa.secret === pb.secret, ` (A="${pa.secret}" B="${pb.secret}")`)
  console.log('room same?   ', pa.room === pb.room, ` (A="${pa.room}" B="${pb.room}")`)
  console.log('segments same?', JSON.stringify(pa.segments) === JSON.stringify(pb.segments), ` (A=${JSON.stringify(pa.segments)} B=${JSON.stringify(pb.segments)})`)
  console.log('domain same? ', pa.domain === pb.domain, ` (A="${pa.domain}" B="${pb.domain}")`)
  console.log('lineageSig same?', pa.lineageSig === pb.lineageSig, ` (A=${pa.lineageSig?.slice(0,12)} B=${pb.lineageSig?.slice(0,12)})`)
  console.log('channel same?', pa.droneChannel === pb.droneChannel)

  await browser.close()
}

main().catch(err => { console.error(err); process.exit(1) })
