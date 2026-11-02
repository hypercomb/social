#!/usr/bin/env node
// Turn the meeting's video on: Cloudflare Realtime SFU, both meeting points.
//
//   npm run video:setup            (in hypercomb-relay/meet-worker)
//
// 1. Create the app first: Cloudflare dashboard → Realtime → SFU → Create.
// 2. This asks for its App ID and App token (the token is not shown), hands
//    each to `wrangler secret put` on stdin for BOTH scripts
//    (wrangler.meet.toml, wrangler.meet-open.toml), then deploys both.
//    Nothing is written to disk, an env var or the output.
//
// --no-deploy sets the secrets only. Exit 0 when every step succeeded;
// otherwise the failing step's wrangler output stands and it exits 1.
// See documentation/meeting-lobby.md, "Video".

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIGS = ['wrangler.meet.toml', 'wrangler.meet-open.toml']

let pending = ''

/** One line from the terminal (hidden when asked), or the next piped line. */
function ask(question, hidden) {
  const stdin = process.stdin
  process.stderr.write(question)
  return new Promise((resolve, reject) => {
    let typed = ''
    const done = (value, error) => {
      if (stdin.isTTY) stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener('data', onData)
      stdin.removeListener('end', onEnd)
      if (hidden || !stdin.isTTY) process.stderr.write('\n')
      error ? reject(error) : resolve(value)
    }
    const onData = (chars) => {
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i]
        if (ch === '\r' || ch === '\n') {
          pending = chars.slice(i + 1).replace(/^\n/, '')
          return done(typed.trim())
        }
        if (ch === '\u0003') return done('', new Error('cancelled'))
        if (ch === '\u007f' || ch === '\b') typed = typed.slice(0, -1)
        else typed += ch
      }
    }
    const onEnd = () => done(typed.trim())
    if (stdin.isTTY) stdin.setRawMode(hidden)
    stdin.setEncoding('utf8')
    stdin.on('data', onData)
    stdin.on('end', onEnd)
    const carried = pending
    pending = ''
    if (carried) onData(carried)
    if (stdin.listenerCount('data')) stdin.resume()
  })
}

/** Run wrangler with `input` on stdin; resolves on exit 0. */
function wrangler(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['wrangler', ...args], {
      cwd: HERE,
      shell: process.platform === 'win32',
      stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'],
    })
    if (input !== undefined) child.stdin.end(input)
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`wrangler ${args.join(' ')} exited ${code}`)))
  })
}

async function main() {
  const deploy = !process.argv.includes('--no-deploy')
  const appId = await ask('SFU App ID: ', false)
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(appId)) throw new Error('that does not look like an App ID')
  const token = await ask('SFU App token (not shown): ', true)
  if (token.length < 16 || /\s/.test(token)) throw new Error('that does not look like an App token')

  for (const config of CONFIGS) {
    await wrangler(['secret', 'put', 'SFU_APP_ID', '--config', config], appId)
    await wrangler(['secret', 'put', 'SFU_APP_TOKEN', '--config', config], token)
  }
  if (deploy) for (const config of CONFIGS) await wrangler(['deploy', '--config', config])
  process.stderr.write(`video is on: both meeting points have the SFU app${deploy ? ' and are deployed' : ' (not deployed: --no-deploy)'}\n`)
}

main().catch((error) => {
  process.stderr.write(`video setup: ${error.message}\n`)
  process.exit(1)
})
