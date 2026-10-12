#!/usr/bin/env node
// Recycle the meeting point's access code — a new code in, the old one out.
//
//   node scripts/recycle-code.mjs [--url <https://host/.well-known/hc-meet/code>] [--close]
//                                 [--link-template '<…{relay}…{code}…>']
//
// 1. A strong code is made HERE (24 random bytes, base64url). It never leaves
//    this machine except in the meeting links you hand out.
// 2. You give an operator key (nsec1… or 64-hex) at run time: typed at a
//    hidden prompt, or piped on stdin. It is used to sign once and is never
//    written anywhere — not to disk, not to an env var, not to the output.
// 3. Only sha256(code) is POSTed, NIP-98 signed (method, URL and the body's
//    hash bound). The meeting point stores that hash, and from that moment
//    every socket that came in on the old code is closed (4401) and the old
//    code opens nothing. No restart, no redeploy.
//
// --close destroys the code without a successor: the meeting point refuses
// everyone until the next recycle.
//
// Exit 0 with the code printed; anything else prints the meeting point's
// reason and exits 1.

import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

export const DEFAULT_URL = 'https://pluginthematrix.com/.well-known/hc-meet/code'
// The meeting link a guest opens. The fragment never reaches a server; the
// shell reads the meeting point and the code from it. Kept in step with the
// `#meet=` encoding in hypercomb-essentials meeting-invite.ts (meetFragment):
// {relay} is the FULL wss:// URL, percent-encoded, so a package older than the
// meeting point reads the link as malformed instead of folding `&relay=…&code=…`
// into the secret and joining the wrong place with the code in a page name.
export const DEFAULT_LINK_TEMPLATE = 'https://hypercomb.io/#meet=<room>/<secret>/<page>&relay={relay}&code={code}'

/** The meeting link for a relay and code, from a template. */
export const meetingLink = (template, relay, code) =>
  template.replaceAll('{relay}', encodeURIComponent(relay)).replaceAll('{code}', encodeURIComponent(code))

const sha256Hex = (text) => bytesToHex(sha256(utf8ToBytes(text)))

/** A fresh access code: 192 random bits, base64url — a valid WebSocket
 *  subprotocol token as `hc-access.<code>`. */
export const newCode = () => randomBytes(24).toString('base64url')

// ── keys ─────────────────────────────────────────────────────────────────────

const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'

/** nsec1… (NIP-19) or 64-hex → 32 secret-key bytes. Throws on anything else. */
export function secretKeyBytes(raw) {
  const text = String(raw || '').trim()
  if (/^[0-9a-fA-F]{64}$/.test(text)) return hexToBytes(text.toLowerCase())
  const lower = text.toLowerCase()
  if (!lower.startsWith('nsec1')) throw new Error('give an nsec1… key or 64 hex characters')
  const words = [...lower.slice(5)].map((c) => BECH32.indexOf(c))
  if (words.some((w) => w < 0) || words.length < 7) throw new Error('that nsec is not valid bech32')
  // Checksum (BIP-173): polymod over hrp-expanded 'nsec' and the data must be 1.
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let chk = 1
  for (const v of [...[...'nsec'].map((c) => c.charCodeAt(0) >> 5), 0, ...[...'nsec'].map((c) => c.charCodeAt(0) & 31), ...words]) {
    const top = chk >> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i]
  }
  if (chk !== 1) throw new Error('that nsec has a bad checksum')
  let acc = 0, bits = 0
  const out = []
  for (const w of words.slice(0, -6)) {
    acc = (acc << 5) | w
    bits += 5
    while (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff) }
  }
  if (out.length !== 32) throw new Error('that nsec does not hold a 32-byte key')
  return Uint8Array.from(out)
}

/** The NIP-98 Authorization header for one POST of `body` to `url`. */
export function nip98(url, body, secretKey, nowSec = Math.floor(Date.now() / 1000)) {
  const evt = {
    pubkey: bytesToHex(schnorr.getPublicKey(secretKey)),
    created_at: nowSec,
    kind: 27235,
    tags: [['u', url], ['method', 'POST'], ['payload', sha256Hex(body)]],
    content: '',
  }
  evt.id = sha256Hex(JSON.stringify([0, evt.pubkey, evt.created_at, evt.kind, evt.tags, evt.content]))
  evt.sig = bytesToHex(schnorr.sign(evt.id, secretKey))
  return 'Nostr ' + Buffer.from(JSON.stringify(evt), 'utf8').toString('base64')
}

/** The install publisher's public keys, from the shells' own copies of the
 *  publisher record when this checkout has them (empty otherwise). */
export function publisherKeys(root = fileURLToPath(new URL('../../../', import.meta.url))) {
  const keys = new Set()
  for (const file of ['hypercomb-web/src/setup/install-publisher.json', 'hypercomb-essentials/src/sharing/install-publisher.json']) {
    try {
      const pubkey = String(JSON.parse(readFileSync(join(root, file), 'utf8'))?.pubkey ?? '').toLowerCase()
      if (/^[0-9a-f]{64}$/.test(pubkey)) keys.add(pubkey)
    } catch { /* not in this checkout */ }
  }
  return keys
}

/** The operator key, read once: a hidden prompt on a terminal, else stdin. */
async function readKey() {
  const stdin = process.stdin
  if (!stdin.isTTY) {
    let raw = ''
    for await (const chunk of stdin) raw += chunk
    return raw.trim()
  }
  process.stderr.write('operator key (nsec1… or hex, not shown): ')
  stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding('utf8')
  return await new Promise((resolve, reject) => {
    let typed = ''
    const done = (value, error) => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener('data', onData)
      process.stderr.write('\n')
      error ? reject(error) : resolve(value)
    }
    const onData = (chars) => {
      for (const ch of chars) {
        if (ch === '\r' || ch === '\n') return done(typed.trim())
        if (ch === '\u0003') return done('', new Error('cancelled'))
        if (ch === '\u007f' || ch === '\b') typed = typed.slice(0, -1)
        else typed += ch
      }
    }
    stdin.on('data', onData)
  })
}

function parseArgs(argv) {
  const args = { url: DEFAULT_URL, close: false, linkTemplate: DEFAULT_LINK_TEMPLATE }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--url' && argv[i + 1]) args.url = argv[++i]
    else if (a === '--close') args.close = true
    else if (a === '--link-template' && argv[i + 1]) args.linkTemplate = argv[++i]
    else if (a === '--help' || a === '-h') args.help = true
    else throw new Error(`unknown argument ${a}`)
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write('node scripts/recycle-code.mjs [--url <code endpoint>] [--close] [--link-template <template>]\n')
    return 0
  }
  const url = new URL(args.url)
  const relay = `${url.protocol === 'http:' ? 'ws' : 'wss'}://${url.host}`
  const code = args.close ? null : newCode()
  const body = JSON.stringify(code ? { hash: sha256Hex(code) } : { close: true })

  // The key lives only as long as this call: signed, posted, zeroed.
  const key = secretKeyBytes(await readKey())
  // Never the publisher's key: it signs install:essentials (what every fresh
  // install runs), and a key fed to this routine chore lands in shell history.
  const signer = bytesToHex(schnorr.getPublicKey(key))
  if (publisherKeys().has(signer)) {
    key.fill(0)
    process.stderr.write('refused: that is the install publisher key. Recycle with a key made for this alone (wrangler.meet.toml OPERATOR_KEYS).\n')
    return 1
  }
  let res
  let said
  try {
    const post = async () => {
      res = await fetch(url.href, { method: 'POST', headers: { authorization: nip98(url.href, body, key), 'content-type': 'application/json' }, body })
      said = (await res.text()).trim()
    }
    await post()
    // A recycle must be newer than the one in force, to the second: one made
    // in the same second as the last waits for the next and is signed again.
    if (res.status === 409 && said.startsWith('stale')) {
      await new Promise((resolve) => setTimeout(resolve, 1050 - (Date.now() % 1000)))
      await post()
    }
  } finally { key.fill(0) }
  if (!res.ok) {
    process.stderr.write(`the meeting point refused: ${res.status} ${said}\n`)
    return 1
  }
  let answer = {}
  try { answer = JSON.parse(said) } catch {}
  const closed = Number(answer.closed) || 0
  process.stdout.write(`meeting point  ${relay}\n`)
  if (!code) {
    process.stdout.write(`access code    destroyed — nobody joins until the next recycle\n`)
    process.stdout.write(`closed         ${closed} socket(s)\n`)
    return 0
  }
  process.stdout.write(`access code    ${code}\n`)
  process.stdout.write(`closed         ${closed} socket(s) on the old code\n`)
  process.stdout.write(`meeting link   ${meetingLink(args.linkTemplate, relay, code)}\n`)
  process.stdout.write('               (the code is in force now; hand it out only inside meeting links)\n')
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code), (error) => { process.stderr.write(`${error.message}\n`); process.exit(1) })
}
