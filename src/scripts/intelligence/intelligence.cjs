// Manage intelligence groups on this Windows disk.
//
// The resource stays on the host. A group file remembers the problem. A
// result is a member of the pool intelligence:<group>: the file name is the
// hash of the arguments. The file holds the domain and the answer signature.
//
//   node scripts/intelligence/intelligence.cjs start
//   node scripts/intelligence/intelligence.cjs reset
//   node scripts/intelligence/intelligence.cjs root
//   node scripts/intelligence/intelligence.cjs group add --name <name> --problem <text>
//   node scripts/intelligence/intelligence.cjs group list
//   node scripts/intelligence/intelligence.cjs ref add --group <name> --domain <host> --arguments <file> [--answer <file>]
//   node scripts/intelligence/intelligence.cjs ref list --group <name>
//   node scripts/intelligence/intelligence.cjs get --group <name> --arguments <file>
//   node scripts/intelligence/intelligence.cjs check --group <name> --arguments <file>
//   node scripts/intelligence/intelligence.cjs graph --group <name>

const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const disk = require('./disk.cjs')

const arg = (flag) => {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const root = () => process.env.HYPERCOMB_INTELLIGENCE || disk.intelligenceRoot()

const command = process.argv[2]
const action = process.argv[3]

const main = async () => {
  if (command === 'start') {
    const result = disk.start(root())
    const out = disk.notice(result)
    if (result.kind === 'reset') {
      process.stderr.write(`${out}\n`)
      process.exitCode = 2
      return
    }
    process.stdout.write(`${out}\n`)
    return
  }
  if (command === 'reset') {
    const result = disk.reset(root())
    process.stdout.write(`${disk.notice(result)}\n`)
    return
  }
  if (command === 'root') {
    process.stdout.write(`${root()}\n`)
    return
  }
  if (command === 'group' && action === 'add') {
    const added = disk.addGroup(root(), arg('--name'), arg('--problem'))
    process.stdout.write(`${added.dir}\n`)
    return
  }
  if (command === 'group' && action === 'list') {
    for (const group of disk.listGroups(root())) process.stdout.write(`${group.name}\t${group.problem}\n`)
    return
  }
  if (command === 'ref' && action === 'add') {
    const args = JSON.parse(readFileSync(arg('--arguments'), 'utf8'))
    const answerFile = arg('--answer')
    const answer = answerFile ? createHash('sha256').update(readFileSync(answerFile)).digest('hex') : undefined
    const ref = disk.rememberArguments(root(), arg('--group'), arg('--domain'), args, answer)
    process.stdout.write(`${ref.domain}/${ref.hash} ${ref.answer}\n`)
    return
  }
  if (command === 'ref' && action === 'list') {
    for (const ref of disk.refs(root(), arg('--group'))) process.stdout.write(`${ref.domain}/${ref.hash}\n`)
    return
  }
  if (command === 'get') {
    const args = JSON.parse(readFileSync(arg('--arguments'), 'utf8'))
    const bytes = await disk.get(root(), arg('--group'), args)
    process.stdout.write(bytes)
    return
  }
  if (command === 'check') {
    const args = JSON.parse(readFileSync(arg('--arguments'), 'utf8'))
    const cube = await disk.check(root(), arg('--group'), args)
    process.stdout.write(`${cube.q} ${cube.r} ${cube.s}\n`)
    return
  }
  if (command === 'graph') {
    const edges = await disk.graph(root(), arg('--group'))
    for (const edge of edges) process.stdout.write(`${disk.canonical(edge)}\n`)
    return
  }
  throw new Error('usage: intelligence start | reset | root | group add | group list | ref add | ref list | get | check | graph')
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
