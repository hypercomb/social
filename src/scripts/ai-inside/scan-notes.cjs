// Scan every AI-Inside cell's notes and report duplication ground truth.
const fs = require('fs'); const path = require('path'); const WebSocket = require('ws')
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '_merged.json'), 'utf8'))
const SECTIONS = ['strategy', 'differentiation', 'roadmap', 'rationale', 'references']
const ws = new WebSocket('ws://localhost:2401')
let n = 0; const pend = new Map()
function rpc(req){return new Promise(res=>{const id='sc-'+(++n); const t=setTimeout(()=>{pend.delete(id);res({ok:false,error:'timeout'})},9000); pend.set(id,m=>{clearTimeout(t);res(m)}); ws.send(JSON.stringify({...req,id}))})}
ws.on('message',raw=>{let m;try{m=JSON.parse(String(raw))}catch{return} const cb=pend.get(m.id); if(cb){pend.delete(m.id);cb(m)}})
ws.on('open', async () => {
  const paths = [['ai-inside']]
  for (const c of data) { paths.push(['ai-inside', c.slug]); for (const s of SECTIONS) paths.push(['ai-inside', c.slug, s]) }
  let totalEntries = 0, dupeCells = 0, extra = 0
  const allIds = new Set()
  const dupeList = []
  for (const p of paths) {
    const r = await rpc({ op: 'note-list', segments: p })
    if (!r.ok || !Array.isArray(r.data)) { dupeList.push(p.join('/') + ' ERR ' + (r.error||'')); continue }
    const ids = r.data.map(x => x && x.id).filter(Boolean)
    totalEntries += ids.length
    ids.forEach(i => allIds.add(i))
    if (ids.length > 1) {
      dupeCells++
      extra += ids.length - new Set(ids).size  // extra = repeated-id surplus
      const uniqueInCell = new Set(ids).size
      dupeList.push(`${p.join('/')}  count=${ids.length} uniqueIds=${uniqueInCell}`)
    }
  }
  console.log('paths scanned:', paths.length)
  console.log('total note entries (sum of counts):', totalEntries)
  console.log('unique ids across tree:', allIds.size)
  console.log('cells with >1 note:', dupeCells)
  console.log('surplus from repeated ids within a cell:', extra)
  console.log('\n--- cells with >1 note (first 60) ---')
  console.log(dupeList.slice(0, 60).join('\n'))
  console.log(dupeList.length > 60 ? `... +${dupeList.length-60} more` : '')
  ws.close(); process.exit(0)
})
ws.on('error', e => { console.log('ERR', e.message); process.exit(1) })
