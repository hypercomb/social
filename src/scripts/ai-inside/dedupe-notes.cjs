// Dedupe AI-Inside notes: drive every cell to EXACTLY one note with the
// correct text. Self-correcting — works whether note-delete removes a single
// occurrence or all occurrences of a sig (re-adds the text if it nukes both).
const fs = require('fs'); const path = require('path'); const WebSocket = require('ws')
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '_merged.json'), 'utf8'))
const SECTIONS = ['strategy', 'differentiation', 'roadmap', 'rationale', 'references']
const INTRO = 'AI Inside — a map of the companies building artificial intelligence. Each company opens into five deep-dives: its strategy, what sets it apart, its roadmap, the rationale behind its approach, and references. Built to actually understand WHY each player is doing it the way they are.'

// expected text per full path
const expected = new Map()
expected.set(JSON.stringify(['ai-inside']), INTRO)
for (const c of data) {
  expected.set(JSON.stringify(['ai-inside', c.slug]), `${c.name} — ${c.overview}`)
  for (const s of SECTIONS) expected.set(JSON.stringify(['ai-inside', c.slug, s]), c[s] || '')
}

const ws = new WebSocket('ws://localhost:2401')
let n = 0; const pend = new Map()
function rpc(req){return new Promise(res=>{const id='dd-'+(++n); const t=setTimeout(()=>{pend.delete(id);res({ok:false,error:'timeout'})},12000); pend.set(id,m=>{clearTimeout(t);res(m)}); ws.send(JSON.stringify({...req,id}))})}
ws.on('message',raw=>{let m;try{m=JSON.parse(String(raw))}catch{return} const cb=pend.get(m.id); if(cb){pend.delete(m.id);cb(m)}})
const listCount = async p => { const r = await rpc({op:'note-list', segments:p}); return r.ok && Array.isArray(r.data) ? r.data : null }

ws.on('open', async () => {
  const paths = [['ai-inside']]
  for (const c of data) { paths.push(['ai-inside', c.slug]); for (const s of SECTIONS) paths.push(['ai-inside', c.slug, s]) }

  let fixed = 0, readded = 0, fail = 0
  for (const p of paths) {
    let items = await listCount(p)
    if (!items || items.length <= 1) continue
    const cell = p[p.length - 1]
    const parent = p.slice(0, -1)
    let guard = 0
    while (items && items.length > 1 && guard++ < 6) {
      const id = items[0].id
      await rpc({ op: 'note-delete', segments: parent, cell, sig: id })
      items = await listCount(p)
    }
    if (items && items.length === 0) {
      // delete removed all occurrences — restore the single correct note
      const text = expected.get(JSON.stringify(p))
      if (text) { await rpc({ op: 'note-add', segments: parent, cell, text }); readded++ }
      items = await listCount(p)
    }
    if (items && items.length === 1) { fixed++; process.stdout.write(`\r[fixed ${fixed}] ${p.join('/').padEnd(46)} `) }
    else { fail++; console.log(`\nFAIL ${p.join('/')} → count=${items ? items.length : '?'}`) }
  }
  console.log(`\n\ndedupe done: ${fixed} cells normalized (${readded} re-added), ${fail} fail`)
  ws.close(); process.exit(0)
})
ws.on('error', e => { console.log('ERR', e.message); process.exit(1) })
