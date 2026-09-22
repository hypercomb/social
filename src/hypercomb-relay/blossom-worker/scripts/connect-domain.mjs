// hypercomb-relay/blossom-worker/scripts/connect-domain.mjs
//
// CONNECT A DOMAIN — the one act that takes a Cloudflare zone to "every
// published branch can be switched on here". Either every step lands and the
// domain answers, or it stops at the first missing piece and says exactly
// what that piece is. Re-runnable: every step checks before it writes.
//
//   npm run connect -- <domain> [--no-deploy]
//
// The steps, in order:
//   1. the zone exists in the account and reads ACTIVE (else: the nameservers
//      to set at the registrar — a route on a pending zone fails the WHOLE
//      deploy, every other host with it);
//   2. a proxied `* CNAME <domain>` wildcard record (proxying is what lets it
//      work with no apex record: the worker route claims the request first);
//   3. the `*.<domain>/*` route and the zone-anchor binding in
//      wrangler.pluginthematrix.toml (anchor lineage = the domain itself, a
//      key no hive path can ever mint — see the toml's anchor note);
//   4. tests, then deploy;
//   5. prove it: the relay face answers the index, and an unpublished name
//      answers the honest "nothing published" 404 FROM THE WORKER.
//
// Then the domain is a switch in every layer's Publish panel once it is in
// your Hosts. The token: CLOUDFLARE_API_TOKEN with Zone:Read + DNS:Edit
// (wrangler's own login cannot write DNS). Without it, steps that only read
// still run and the DNS step says what to add by hand.

import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const workerDir = join(here, '..')
const TOML = join(workerDir, 'wrangler.pluginthematrix.toml')
const API = 'https://api.cloudflare.com/client/v4'

const args = process.argv.slice(2)
const deploy = !args.includes('--no-deploy')
const domain = String(args.find(a => !a.startsWith('--')) ?? '')
  .trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, '')
if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) {
  console.error('usage: npm run connect -- <domain> [--no-deploy]')
  process.exit(2)
}

const ok = (m) => console.log(`  ✔ ${m}`)
const stop = (m) => { console.error(`  ✖ ${m}`); process.exit(1) }

// A scoped token first; wrangler's OAuth login reads zones but cannot write DNS.
function token() {
  if (process.env.CLOUDFLARE_API_TOKEN) return { value: process.env.CLOUDFLARE_API_TOKEN, scoped: true }
  const candidates = [
    join(process.env.APPDATA ?? '', 'xdg.config', '.wrangler', 'config', 'default.toml'),
    join(homedir(), '.config', '.wrangler', 'config', 'default.toml'),
    join(homedir(), '.wrangler', 'config', 'default.toml'),
  ]
  for (const file of candidates) {
    try {
      const m = readFileSync(file, 'utf8').match(/^oauth_token\s*=\s*"([^"]+)"/m)
      if (m) return { value: m[1], scoped: false }
    } catch { /* next */ }
  }
  return null
}

async function cf(tok, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${tok.value}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok && body.success !== false, body }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

console.log(`connect ${domain}`)

// ── 1. the zone ───────────────────────────────────────────────────────────
const tok = token()
if (!tok) stop('no Cloudflare credentials — set CLOUDFLARE_API_TOKEN (Zone:Read + DNS:Edit) or run `npx wrangler login`')
const zones = await cf(tok, `/zones?name=${domain}`)
const zone = zones.body?.result?.[0]
if (!zone) stop(`${domain} is not a zone in this Cloudflare account — add it in the dashboard (Add a site), then run this again`)
if (zone.status !== 'active') {
  stop(`${domain} is ${zone.status} — set its nameservers at the registrar to ${(zone.name_servers ?? []).join(' + ')}, wait for Active, then run this again`)
}
ok(`zone active (${zone.name_servers?.join(', ')})`)

// ── 2. the wildcard record ────────────────────────────────────────────────
const wildcard = `*.${domain}`
const records = await cf(tok, `/zones/${zone.id}/dns_records?name=${encodeURIComponent(wildcard)}`)
const existing = records.body?.result?.[0]
// Without DNS scope the listing is refused, not empty. Ask public DNS instead:
// a random label that resolves means a wildcard is already answering.
const resolves = !records.ok && await (async () => {
  try {
    const q = await fetch(`https://cloudflare-dns.com/dns-query?name=hc-probe-${Date.now().toString(36)}.${domain}&type=A`, { headers: { accept: 'application/dns-json' } })
    return ((await q.json()).Answer ?? []).length > 0
  } catch { return false }
})()
if (resolves) {
  ok(`${wildcard} answers in public DNS`)
} else if (existing) {
  if (!existing.proxied) stop(`${wildcard} exists but is DNS-only — turn its proxy (orange cloud) on`)
  ok(`${wildcard} ${existing.type} → ${existing.content} (proxied)`)
} else {
  const made = await cf(tok, `/zones/${zone.id}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({ type: 'CNAME', name: '*', content: domain, proxied: true, comment: 'hypercomb: every published branch has a door here' }),
  })
  if (!made.ok) {
    stop(`could not add ${wildcard}${tok.scoped ? '' : ' (wrangler\'s login cannot write DNS)'} — add it by hand: CNAME, name *, target ${domain}, proxied; or set CLOUDFLARE_API_TOKEN with DNS:Edit and run this again`)
  }
  ok(`${wildcard} CNAME → ${domain} (proxied) added`)
}

// ── 3. route + zone anchor in the worker config ───────────────────────────
let toml = readFileSync(TOML, 'utf8')
const route = `{ pattern = "*.${domain}/*", zone_name = "${domain}" }`
const routeLine = new RegExp(`^\\s*(#\\s*)?\\{\\s*pattern\\s*=\\s*"\\*\\.${domain.replace(/\./g, '\\.')}/\\*"`, 'm')
const found = toml.match(routeLine)
if (found && !found[1]) {
  ok('route already in the worker config')
} else if (found) {
  toml = toml.replace(routeLine, (line) => line.replace(/#\s*/, ''))
  ok('route re-enabled in the worker config')
} else {
  const routes = toml.match(/^routes = \[[\s\S]*?^\]/m)
  if (!routes) stop('could not find the routes list in wrangler.pluginthematrix.toml')
  const body = routes[0].replace(/\s*\]$/, '')
  const sep = body.trimEnd().endsWith(',') || body.trimEnd().endsWith('[') ? '' : ','
  toml = toml.replace(routes[0], `${body.trimEnd()}${sep}\n  # connected ${new Date().toISOString().slice(0, 10)} by scripts/connect-domain.mjs — wildcard only\n  ${route}\n]`)
  ok('route added to the worker config')
}

const bindingsMatch = toml.match(/^SITE_BINDINGS = '(.*)'$/m)
if (!bindingsMatch) stop('could not find SITE_BINDINGS in wrangler.pluginthematrix.toml')
const bindings = JSON.parse(bindingsMatch[1])
const anchor = bindings[domain]
if (anchor && anchor.wildcard !== false) {
  ok('zone anchor already bound')
} else {
  const publishers = anchor?.publishers ?? Object.values(bindings).find(b => Array.isArray(b.publishers))?.publishers
  if (!publishers?.length) stop('no publisher list to copy into the new zone anchor')
  // The anchor lineage is the domain itself: it contains a dot, and lineageKey
  // folds dots to '-', so no hive path can ever claim it.
  bindings[domain] = { title: anchor?.title ?? domain, lineage: domain, publishers, routed: false }
  toml = toml.replace(bindingsMatch[0], () => `SITE_BINDINGS = '${JSON.stringify(bindings)}'`)
  ok('zone anchor bound')
}
writeFileSync(TOML, toml)

// ── 4. test + deploy ──────────────────────────────────────────────────────
const run = (cmd) => execSync(cmd, { cwd: workerDir, stdio: 'inherit' })
try { run('node --test worker.spec.js') } catch { stop('worker tests failed — nothing deployed') }
ok('worker tests pass')
if (!deploy) {
  console.log('  • --no-deploy: config written, not shipped')
  process.exit(0)
}
try { run('npm run deploy:pluginthematrix') } catch { stop('deploy failed') }
ok('deployed')

// ── 5. prove it ───────────────────────────────────────────────────────────
const publisher = bindings[domain].publishers[0].pubkey
const probe = `hc-connect-${Date.now().toString(36)}`
let served = false, routed = false
for (let i = 0; i < 12 && !(served && routed); i++) {
  if (i) await sleep(5000)
  try {
    const index = await fetch(`https://content.${domain}/hive/${publisher}`, { cache: 'no-store' })
    served = index.status === 200 || index.status === 404
  } catch { /* not yet */ }
  try {
    const door = await fetch(`https://${probe}.${domain}/`, { headers: { 'sec-fetch-dest': 'document' } })
    routed = door.status === 404 && /nothing published/.test(await door.text())
  } catch { /* not yet */ }
}
if (!served) stop(`content.${domain} does not answer the index yet — DNS may still be propagating; run this again in a minute`)
ok(`content.${domain} answers the index`)
if (!routed) stop(`${probe}.${domain} is not reaching the worker — check the wildcard record and the route`)
ok(`${domain} doors reach the worker`)
console.log(`\n${domain} is connected. Add it in Hosts and it is a switch on every layer's Publish panel.`)
