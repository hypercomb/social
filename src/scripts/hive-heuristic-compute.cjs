#!/usr/bin/env node
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { HeuristicService } = require('./heuristics/service.cjs')
const { definitions } = require('./heuristics/hive-heuristics.cjs')
const { algorithmSignature } = require('./heuristics/protocol.cjs')

const execFileAsync = promisify(execFile)
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)

async function bridgeResource(sig) {
  const request = JSON.stringify({ op: 'get-resource', sig })
  const { stdout } = await execFileAsync(process.execPath, ['scripts/bridge/_bop.cjs', request], { cwd: __dirname + '/..', maxBuffer: 16 * 1024 * 1024 })
  const response = JSON.parse(stdout)
  if (!response.ok) throw new Error(response.error || `could not resolve ${sig}`)
  return Buffer.from(response.data.text)
}

async function main() {
  const id = option('algorithm')
  const params = process.argv.filter(value => value.startsWith('--param=')).map(value => value.slice(8))
  const definition = definitions.find(item => item.id === id)
  if (!definition) throw new Error(`unknown hive algorithm: ${id || '(missing)'}`)
  if (params.length !== definition.operands.length) throw new Error(`${id} expects ${definition.operands.length} parameter signature(s)`)
  for (const sig of params) if (!/^[0-9a-f]{64}$/.test(sig)) throw new Error(`invalid parameter signature: ${sig}`)
  const root = path.resolve(option('root') || process.cwd())
  const service = await new HeuristicService(root, { definitions, managePaths: false }).open()
  const algorithmSig = algorithmSignature(definition)
  const result = await service.compute(algorithmSig, params, async () => {
    const inputs = await Promise.all(params.map(bridgeResource))
    const outcome = definition.run(inputs)
    return outcome.matched ? outcome.value : null
  })
  console.log(JSON.stringify({ algorithm: id, algorithmSig, params, computationSig: result.computationSig, answerSig: result.answerSig, source: result.source, answer: result.bytes ? JSON.parse(result.bytes.toString('utf8')) : null }, null, 2))
}

main().catch(error => { console.error(error.message); process.exit(1) })
