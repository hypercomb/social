#!/usr/bin/env node
const path = require('node:path')
const { HeuristicService } = require('./heuristics/service.cjs')

function option(name) {
  const prefix = `--${name}=`
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
}

async function main() {
  const command = process.argv[2] || 'once'
  const root = path.resolve(option('root') || process.cwd())
  const store = option('store')
  const service = await new HeuristicService(root, { store }).open()

  if (command === 'once') {
    console.log(JSON.stringify({ root, store: service.store, ...(await service.audit()) }, null, 2))
    return
  }
  if (command === 'list') {
    console.log(JSON.stringify(service.index.algorithms, null, 2))
    return
  }
  if (command === 'summary') {
    console.log(JSON.stringify(await service.summary(), null, 2))
    return
  }
  if (command === 'history') {
    console.log(JSON.stringify({ strategySig: service.strategySig, admission: service.strategy.admission, strategies: service.strategy.strategies, compositions: service.strategy.compositions, scoutTargets: service.strategy.scoutTargets, entries: await service.history(Number(option('limit') || 20)) }, null, 2))
    return
  }
  if (command === 'export') {
    const output = option('out') || path.join(service.store, 'export')
    console.log(JSON.stringify(await service.exportDump(output), null, 2))
    return
  }
  if (command === 'query') {
    const heuristic = option('heuristic')
    if (!heuristic) throw new Error('query requires --heuristic=<id>')
    const records = await service.aggregate(heuristic)
    console.log(JSON.stringify(records, null, 2))
    return
  }
  if (command === 'watch') {
    const initial = await service.audit()
    console.log(JSON.stringify({ event: 'ready', root, store: service.store, ...initial }))
    const watcher = service.watch((error, file, stats) => {
      console.log(JSON.stringify(error ? { event: 'error', file, error: error.message } : { event: 'audited', file, ...stats }))
    })
    const stop = () => { watcher.close(); process.exit(0) }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    return
  }
  throw new Error(`unknown command: ${command}`)
}

main().catch(error => { console.error(error.message); process.exit(1) })
