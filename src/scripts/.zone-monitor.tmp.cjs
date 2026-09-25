const H = require('./drive-swarm-connectivity.cjs'); const { chromium } = require('playwright')
const zone = { room: 'downtown', secret: 'downtown', relay: 'wss://jwize.com', seed: {} }
;(async () => { const b = await chromium.launch({ headless: true }); const c = await H.newClient(b, 'M', zone); const page = c.page
  await page.goto('https://hypercomb.io/', { waitUntil: 'domcontentloaded' }); await H.waitForShell(page); await H.installIfNeeded(page, 'M'); await H.waitForReady(page); await H.settle(page)
  await H.joinSwarm(page); console.log(new Date().toISOString(), 'monitor joined')
  let last = ''
  for (let i = 0; i < 240; i++) {
    const v = await H.evalSafe(() => page.evaluate(() => { const s = window.ioc.get('@diamondcoreprocessor.com/SwarmDrone'); const peers = s.participantsAtCurrentSig(); return { sig: (s.debug().currentSig || '').slice(0, 8), peers: peers.map(p => (s.labelFor?.(p) || '?') + ':' + p.slice(0, 6)), tiles: s.peerTilesAtCurrentSig().length } }))
    const line = JSON.stringify(v); if (line !== last) { console.log(new Date().toISOString(), line); last = line }
    await H.sleep(5000)
  }
  await b.close() })().catch(e => { console.error(e); process.exit(1) })
