// Make /revolucion/lounge ATOMIC: the tile carries the room, and opens as it.
//
// Writes the two records the essentials behaviour reads, naming the SAME
// bundle + art signatures the website page already loads — so the tile's room
// and the page's room are provably one piece, not two copies.
// Throwaway: the same two writes now live in intel-build-revolucion-site.ts
// (steps 2b/2c) and land on every site rebuild.
const WebSocket = require('ws')

const SEG = ['revolucion', 'lounge']
const BUNDLE = '77c4237f1b7bdd8e8685caa6c4c641c145178642a2440abc0a412eb2f41ffff5'
const ART = {
  lounge: 'f571ab5dd5e5325feb13d472ac9718dcdefdfc2a2a3ecc9fb9508f92ae2f7553',
  cigars: 'cb84f9626a7c78b9fef5cad1e1442ce5a2fe976dca46064d118011e091fa5a98',
  journal: '175da42ce30603e317bd5878c4c135527708911be831d468412ba16dbbdb94f9',
  'flavor-wheel': '1da3c404e9a9db6db0c6fc2fc36716f7ae284b68c4225b7a7609b2468f965c89',
  humidor: 'c129fc67f65db532fec43d95b42cfb9d10c70f2ec8666e8777222a3edfdd7365',
  community: '4593e4cc13cab2e0be8aee8b0d11231f1f6146b8ac42506e04ea8757b9f5373c',
}

let n = 0
const send = req => new Promise((resolve, reject) => {
  const ws = new WebSocket('ws://localhost:2401')
  const t = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, 40000)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id: `atomize-${Date.now()}-${++n}` })))
  ws.on('message', raw => { clearTimeout(t); try { resolve(JSON.parse(String(raw))) } catch { reject(new Error('bad response')) } ws.close() })
  ws.on('error', e => { clearTimeout(t); reject(e) })
})

;(async () => {
  const room = await send({
    op: 'decoration-add', segments: SEG, kind: 'visual:lounge:room', appliesTo: SEG,
    payload: { version: 1, bundleSig: BUNDLE, art: ART, label: 'The Cigar Lounge', icon: 'chair' },
    mark: 'persistent', replaceKind: true,
  })
  console.log('room  :', room.ok ? String(room.data.sig).slice(0, 12) + '…' + (room.data.unchanged ? ' (unchanged)' : '') : 'FAIL ' + room.error)
  if (!room.ok) process.exit(1)

  const face = await send({
    op: 'decoration-add', segments: SEG, kind: 'view:default', appliesTo: SEG,
    payload: { view: 'lounge' }, mark: 'persistent', replaceKind: true,
  })
  console.log('opensAs:', face.ok ? String(face.data.sig).slice(0, 12) + '…' + (face.data.unchanged ? ' (unchanged)' : '') : 'FAIL ' + face.error)
  if (!face.ok) process.exit(1)

  // Read-back — a log line is not proof a bridge write landed.
  const layer = await send({ op: 'layer-at', segments: SEG })
  let roomOk = false, faceOk = false, websiteFace = false
  for (const sig of (layer.data && layer.data.decorations) || []) {
    const res = await send({ op: 'get-resource', sig })
    if (!res.ok) continue
    try {
      const rec = JSON.parse(res.data.text)
      if (rec.kind === 'visual:lounge:room' && rec.payload.bundleSig === BUNDLE) roomOk = true
      if (rec.kind === 'view:default') { if (rec.payload.view === 'lounge') faceOk = true; if (rec.payload.view === 'website') websiteFace = true }
    } catch { /* not JSON */ }
  }
  console.log(`verify: room=${roomOk} opensAsLounge=${faceOk} staleWebsiteFace=${websiteFace}`)
  process.exit(roomOk && faceOk && !websiteFace ? 0 : 1)
})().catch(e => { console.error(e.message); process.exit(1) })
