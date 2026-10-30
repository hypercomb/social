// change-send.cjs — ask a hive for a change over the change channel, and hear
// its answer. See documentation/change-channel.md.
//
//   HC_CHANGE_SECRET=<secret> node scripts/change-send.cjs --task "<what>" --file <sentences.txt>
//                                                          [--relay wss://hypercomb.com] [--wait <seconds>]
//   node scripts/change-send.cjs --new-secret
//
// The sentences are one per line, as the hive's command line takes them
// (blank lines are skipped). The change is sealed with the shared secret,
// sent to the channel the secret derives, and filed in the hive as asked
// for; nothing runs until the participant accepts it there with
// `changes accept <id>`. This script then listens for the answer, applied or
// declined, until --wait runs out (120 seconds by default).
//
// The secret comes from the environment, never from the command line, so it
// does not land in shell history. Set the same value in the hive:
//   localStorage.setItem('hc:change-channel:secret', '<secret>')
//
// The seal matches hypercomb-essentials/src/assistant/change-seal.ts exactly:
// HKDF-SHA-256 over the secret (salt "hc:change-channel:salt", info
// "hc:change-channel:key") to AES-256-GCM, the channel id as additional data,
// "v1." + base64(iv) + "." + base64(ciphertext). Signing uses a fresh key per
// run; the seal, not the signer, is what the hive trusts.

const fs = require('fs')
const crypto = require('crypto')

const KIND = 30219
const TTL_SEC = 7 * 24 * 60 * 60
const DOMAIN = 'hc:change-channel\0'

const subtle = crypto.webcrypto.subtle
const enc = new TextEncoder()
const sha256Hex = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex')

const changeKey = async secret => {
  const base = await subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey'])
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('hc:change-channel:salt'), info: enc.encode('hc:change-channel:key') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

const channelOf = secret => sha256Hex(DOMAIN + secret)

const seal = async (secret, channel, record) => {
  const iv = crypto.randomBytes(12)
  const sealed = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(channel) }, await changeKey(secret), enc.encode(JSON.stringify(record)))
  return `v1.${iv.toString('base64')}.${Buffer.from(sealed).toString('base64')}`
}

const unseal = async (secret, channel, sealed) => {
  const [version, ivText, bodyText, ...extra] = String(sealed ?? '').split('.')
  if (version !== 'v1' || !ivText || !bodyText || extra.length) return null
  try {
    const plain = await subtle.decrypt(
      { name: 'AES-GCM', iv: Buffer.from(ivText, 'base64'), additionalData: enc.encode(channel) },
      await changeKey(secret), Buffer.from(bodyText, 'base64'))
    return JSON.parse(Buffer.from(plain).toString('utf8'))
  } catch { return null }
}

// Behind a proxy (HTTPS_PROXY), the built-in WebSocket would ignore it, so
// the ws package dials through the proxy instead.
const openSocket = url => {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy
  if (proxy) {
    const Socket = require('ws')
    const { HttpsProxyAgent } = require('https-proxy-agent')
    return new Socket(url, { agent: new HttpsProxyAgent(proxy) })
  }
  const Socket = globalThis.WebSocket ?? require('ws')
  return new Socket(url)
}

module.exports = { channelOf, seal, unseal }

const main = async () => {
  const args = process.argv.slice(2)
  const valueOf = (flag, fallback) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? args[i + 1] : fallback }

  if (args.includes('--new-secret')) {
    console.log(crypto.randomBytes(32).toString('hex'))
    return
  }

  const secret = String(process.env.HC_CHANGE_SECRET ?? '').trim()
  const task = valueOf('--task', '')
  const file = valueOf('--file', '')
  const relay = valueOf('--relay', 'wss://hypercomb.com')
  const waitSec = Number(valueOf('--wait', '120'))
  if (!secret) { console.error('Set HC_CHANGE_SECRET to the secret your hive has as hc:change-channel:secret.'); process.exit(2) }
  if (!task || !file) { console.error('usage: change-send.cjs --task "<what>" --file <sentences.txt> [--relay <wss url>] [--wait <seconds>]'); process.exit(2) }

  const sentences = fs.readFileSync(file, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (!sentences.length) { console.error(`${file} holds no sentences.`); process.exit(2) }

  const { finalizeEvent, generateSecretKey } = await import('nostr-tools/pure')
  const channel = channelOf(secret)
  const at = Date.now()
  const id = sha256Hex(`change\0${task}\0${at}\0${crypto.randomBytes(16).toString('hex')}`)
  const record = { kind: 'change', channel, id, task, scope: [], at, status: 'requested', touched: [], sentences, from: 'remote' }
  const sealed = await seal(secret, channel, record)
  const now = Math.floor(Date.now() / 1000)
  const event = finalizeEvent({
    kind: KIND,
    created_at: now,
    tags: [['x', channel], ['d', `c:${sha256Hex(sealed)}`], ['expiration', String(now + TTL_SEC)]],
    content: JSON.stringify({ v: 1, sealed }),
  }, generateSecretKey())

  const socket = openSocket(relay)
  const send = message => socket.send(JSON.stringify(message))
  const done = code => { try { socket.close() } catch { /* closed */ } process.exit(code) }
  const timer = setTimeout(() => { console.log(`No answer within ${waitSec}s. The change stays asked for; the hive can still answer it.`); done(0) }, waitSec * 1000)

  socket.onopen = () => {
    send(['EVENT', event])
    send(['REQ', 'answers', { kinds: [KIND], '#x': [channel], since: now - 60 }])
  }
  socket.onerror = error => { clearTimeout(timer); console.error(`Could not reach ${relay}: ${error?.message ?? error}`); done(1) }
  socket.onmessage = async message => {
    let data; try { data = JSON.parse(String(message.data)) } catch { return }
    if (data[0] === 'OK' && data[1] === event.id) {
      if (!data[2]) { clearTimeout(timer); console.error(`${relay} refused the change: ${data[3]}`); done(1) }
      console.log(`Asked for "${task}" (${sentences.length} sentences) on ${relay}.`)
      console.log(`In the hive: changes, then changes show ${id.slice(0, 12)} and changes accept ${id.slice(0, 12)}.`)
      console.log(`Listening for the answer for up to ${waitSec}s…`)
      return
    }
    if (data[0] !== 'EVENT' || data[1] !== 'answers') return
    let content; try { content = JSON.parse(String(data[2]?.content ?? '')) } catch { return }
    const answer = await unseal(secret, channel, content?.sealed)
    if (!answer || answer.id !== id || answer.status === 'requested') return
    clearTimeout(timer)
    console.log(`The hive answered: ${answer.status}${answer.note ? ` (${answer.note})` : ''}.`)
    done(answer.status === 'applied' ? 0 : 3)
  }
}

if (require.main === module) main().catch(error => { console.error(error?.message ?? error); process.exit(1) })
