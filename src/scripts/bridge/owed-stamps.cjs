// scripts/bridge/owed-stamps.cjs — install-channel stamps a build could not make, paid when a hive attaches.

const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const SIG = /^[a-f0-9]{64}$/
const SRC = path.resolve(__dirname, '..', '..')

const OWED_FILE = process.env.HYPERCOMB_STAMP_OWED_FILE
  || path.join(SRC, 'hypercomb-essentials', '.stamp-owed.json')
const PUBLISHER_FILE = process.env.HYPERCOMB_INSTALL_PUBLISHER_FILE
  || path.join(SRC, 'hypercomb-essentials', 'src', 'sharing', 'install-publisher.json')
const RELAY_CONTENT = process.env.HYPERCOMB_RELAY_CONTENT_DIR
  || path.join(SRC, 'hypercomb-relay', 'content')

const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

const readOwed = (file = OWED_FILE) => {
  const owed = {}
  for (const [channel, entry] of Object.entries(readJson(file) ?? {})) {
    const sig = String(entry?.sig ?? '').toLowerCase()
    if (!SIG.test(sig)) continue
    owed[channel] = { sig, at: String(entry.at ?? ''), ...(entry.host ? { host: String(entry.host) } : {}) }
  }
  return owed
}

const writeOwed = (owed, file) => {
  if (Object.keys(owed).length) fs.writeFileSync(file, JSON.stringify(owed, null, 2) + '\n')
  else fs.rmSync(file, { force: true })
}

// One debt per channel: the channel names a single root, so a newer build supersedes an older debt.
const recordOwed = (channel, sig, host, file = OWED_FILE) => {
  const clean = String(sig ?? '').toLowerCase()
  if (!SIG.test(clean)) return false
  const owed = readOwed(file)
  owed[channel] = { sig: clean, at: new Date().toISOString(), ...(host ? { host } : {}) }
  writeOwed(owed, file)
  return true
}

const settleOwed = (channel, sig, file = OWED_FILE) => {
  const owed = readOwed(file)
  if (!owed[channel] || owed[channel].sig !== String(sig ?? '').toLowerCase()) return false
  delete owed[channel]
  writeOwed(owed, file)
  return true
}

const followedPubkey = (file = PUBLISHER_FILE) => {
  const pubkey = String(readJson(file)?.pubkey ?? '').toLowerCase()
  return SIG.test(pubkey) ? pubkey : null
}

// Only a build this machine's relay actually serves may be signed on its behalf.
const servedByRelay = (sig, dir = RELAY_CONTENT) => {
  const pool = path.join(dir, createHash('sha256').update('host:packages', 'utf8').digest('hex'))
  let names
  try { names = fs.readdirSync(pool) } catch { return false }
  return names.some(name => {
    if (!/^[0-9]{8}$/.test(name)) return false
    try { return fs.readFileSync(path.join(pool, name), 'utf8').split('\n')[0].trim().toLowerCase() === sig } catch { return false }
  })
}

module.exports = { OWED_FILE, readOwed, recordOwed, settleOwed, followedPubkey, servedByRelay }
