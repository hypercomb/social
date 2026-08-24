#!/usr/bin/env node
// publish-pool — turn a folder of records into a POOL A DOMAIN CAN OFFER.
//
//   node scripts/publish-pool.cjs --meaning llm:providers --in <dir> [--out <dir>]
//   node scripts/publish-pool.cjs --meaning llm:providers --in <dir> --dry
//
// A participant's pool of meaning is an OPFS directory of sig-named members.
// A domain cannot serve a directory — static hosts have no listing — so it
// publishes the same pool as ONE FILE AT THE POOL'S OWN ADDRESS holding the
// member list, beside the members themselves:
//
//     <site root>/<sign(meaning)>     the index: { meaning, members: [sig…] }
//     <site root>/<sig>               each member, byte-for-byte
//
// Both addresses are derived, so a client needs no configuration to find
// them: it computes sign('llm:providers'), asks once, and verifies every
// member against the sig the index gave it. Nothing is trusted because of
// where it was served from.
//
// Upload the output directory to the root of the domain (the same flat heap
// layers and resources already live in). The host must allow cross-origin
// GETs — a hive fetching your models runs on its own origin, and a domain
// with no CORS header publishes into a void.
//
// The records themselves are just JSON files: for `llm:providers`, one
// `llm-provider@1` spec per file (see provider-spec.ts). This script does not
// validate them beyond "is it JSON" — the CLIENT validates, always, because
// the client is the one taking the risk.

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}

const sign = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')

function main() {
  const meaning = String(arg('meaning', '') || '')
  const inDir = String(arg('in', '') || '')
  const dry = process.argv.includes('--dry')
  const outDir = String(arg('out', '') || path.join('dist', 'published-pool'))

  if (!meaning || !inDir) {
    console.error('usage: publish-pool.cjs --meaning <pool:meaning> --in <dir> [--out <dir>] [--dry]')
    process.exit(1)
  }
  if (!meaning.includes(':')) {
    // Same rule the client enforces: a bare word hashes to the same address
    // as a same-named lineage bag, so it could never be a safe pool.
    console.error(`refusing "${meaning}" — a pool meaning must carry a colon`)
    process.exit(1)
  }
  if (!fs.existsSync(inDir)) {
    console.error(`no such directory: ${inDir}`)
    process.exit(1)
  }

  const files = fs.readdirSync(inDir).filter(f => f.toLowerCase().endsWith('.json')).sort()
  if (!files.length) {
    console.error(`no .json records in ${inDir}`)
    process.exit(1)
  }

  const poolSig = sign(Buffer.from(meaning, 'utf8'))
  const members = []
  const writes = []

  for (const file of files) {
    const raw = fs.readFileSync(path.join(inDir, file), 'utf8')
    let parsed
    try { parsed = JSON.parse(raw) } catch (err) {
      console.error(`  skipped ${file}: not JSON (${err.message})`)
      continue
    }
    // Canonicalise: the bytes served must be the bytes signed, and two
    // domains publishing the same record should land on the same signature
    // so an adopter dedupes them for free.
    const bytes = Buffer.from(JSON.stringify(parsed, null, 2), 'utf8')
    const sig = sign(bytes)
    members.push(sig)
    writes.push({ sig, bytes, file })
  }

  if (!members.length) { console.error('nothing publishable'); process.exit(1) }

  const index = Buffer.from(JSON.stringify({ meaning, members }, null, 2), 'utf8')

  console.log(`\n  ${meaning}`)
  console.log(`  index  ${poolSig}`)
  for (const w of writes) console.log(`  member ${w.sig}  ${w.file}`)

  if (dry) {
    console.log('\n  --dry: nothing written\n')
    return
  }

  fs.mkdirSync(outDir, { recursive: true })
  for (const w of writes) fs.writeFileSync(path.join(outDir, w.sig), w.bytes)
  fs.writeFileSync(path.join(outDir, poolSig), index)

  console.log(`\n  wrote ${writes.length + 1} files to ${outDir}`)
  console.log('  upload them to the ROOT of the domain, with cross-origin GETs allowed\n')
}

main()
