#!/usr/bin/env node
// verify-community-translations — THE LANGUAGE IS THE COMMUNITY'S, end to end
// (documentation/community-translations.md):
//
//   1. a TRANSLATOR writes a Japanese line of their own for a key the shipped
//      ja catalog lacks (`i18n-override`), and `language offer ja` makes it
//      a signed catalog on the host, named in their index as i18n:ja
//   2. the host lists it at /i18n/ja.json and at sign('i18n:ja'), verified
//   3. a SUBSCRIBER in Japanese sees the English fallback, says
//      `language sync ja`, and the line HEALS — only the missing key, never a
//      shipped string — and stays healed after a reload (the translations pool)
//   4. `language missing ja` publishes what the subscriber's locale still
//      lacks under its own key, and the host lists who is missing what
//
//   node scripts/local-content-host.mjs 4291 http://localhost:4260 --ai-stub
//   node scripts/verify-community-translations.cjs [web=http://localhost:4260] [host=localhost:4291]
const { chromium } = require('playwright')
const H = require('./hive-harness.cjs')

const WEB = process.argv[2] || 'http://localhost:4260'
const HOST = process.argv[3] || 'localhost:4291'
const WRITE = `content.${HOST}`
const KEY = 'module.jevfollows'                       // English only in the shipped catalogs
const SHIPPED_KEY = 'editor.save'                      // shipped in ja: must never be replaced
const JA = `すべての規則に従う ${Date.now().toString(36)}`
const hostState = async () => (await fetch(`http://${HOST}/__state`)).json()
const channelOf = (state, pubkey, key) => state.hives[pubkey] ? JSON.parse(state.hives[pubkey].content).roots[key] ?? null : null
const fromHost = async sig => (await fetch(`http://${HOST}/${sig}`)).text()
const sha256 = async text => [...new Uint8Array(await require('crypto').webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('')
const tOf = (page, key) => page.evaluate(k => window.ioc.get('@hypercomb.social/I18n').t(k), key)
const localeOf = page => page.evaluate(() => window.ioc.get('@hypercomb.social/I18n').locale)
const waitWord = page => H.waitFor(() => page.evaluate(() => !!window.ioc?.get('@diamondcoreprocessor.com/LanguageQueenBee') || null), 120_000, 500)

;(async () => {
  if (!(await hostState().catch(() => null))) throw new Error(`the content host is not answering on ${HOST} — start scripts/local-content-host.mjs first`)
  const { check, finish } = H.checker()
  const browser = await chromium.launch({ headless: true })

  // ── 1. THE TRANSLATOR publishes a line of their own ─────────────────────
  const tr = await H.openHive(browser, 'translator', WEB)
  await waitWord(tr.page)
  const translator = await tr.page.evaluate(() => window.ioc.get('@diamondcoreprocessor.com/NostrSigner').getPublicKeyHex())
  await H.watchToasts(tr.page)
  await H.say(tr.page, `i18n-override ja ${KEY} ${JA}`)
  await H.sleep(1500)
  await H.say(tr.page, `language offer ja @${WRITE}`)
  const published = await H.toastsUntil(tr.page, /^Published |not published|Nothing to publish/, 60_000)
  const catalogSig = await H.waitFor(async () => channelOf(await hostState(), translator, 'i18n:ja'), 30_000, 1000)
  const catalog = catalogSig ? JSON.parse(await fromHost(catalogSig)) : null
  check('the translator\'s own line becomes a signed catalog on the host, named in their index as i18n:ja', catalog?.kind === 'i18n-catalog' && catalog.locale === 'ja' && catalog.keys?.[KEY] === JA, JSON.stringify(published))

  // ── 2. THE HOST LISTS IT, by convention ─────────────────────────────────
  const listed = await (await fetch(`http://${HOST}/i18n/ja.json`)).json()
  check('the host lists the locale: the verified catalog, and who translated it', listed?.members?.includes(catalogSig) && listed.translators?.some(t => t.pubkey === translator && t.catalog === catalogSig), JSON.stringify(listed?.translators))
  const atAddress = await (await fetch(`http://${HOST}/${await sha256('i18n:ja')}`)).json().catch(() => null)
  check('the same index answers at the pool\'s own derived address — what a published-pool probe fetches', atAddress?.meaning === 'i18n:ja' && atAddress.members?.includes(catalogSig))

  // ── 3. THE SUBSCRIBER heals ─────────────────────────────────────────────
  const sub = await H.openHive(browser, 'subscriber', WEB)
  await waitWord(sub.page)
  await H.watchToasts(sub.page)
  await H.say(sub.page, 'language ja')
  await H.sleep(1000)
  const before = await tOf(sub.page, KEY)
  const shipped = await tOf(sub.page, SHIPPED_KEY)
  check('in Japanese the subscriber sees the English fallback for a key the shipped catalog lacks', (await localeOf(sub.page)) === 'ja' && before !== JA && before !== KEY, before)
  await H.say(sub.page, `language sync ja @${WRITE}`)
  const synced = await H.toastsUntil(sub.page, /^Synced |No ja translations/, 60_000)
  check('language sync heals the missing line from the translator\'s catalog', (await tOf(sub.page, KEY)) === JA && (synced ?? []).some(m => /^Synced ja: 1 missing/.test(m)), JSON.stringify(synced))
  check('a shipped string is never replaced by a catalog', (await tOf(sub.page, SHIPPED_KEY)) === shipped, shipped)
  await sub.page.reload({ waitUntil: 'domcontentloaded' })
  await waitWord(sub.page)
  await H.waitFor(() => sub.page.evaluate(k => window.ioc.get('@hypercomb.social/I18n').t(k), KEY).then(v => v === JA || null), 30_000, 500).catch(() => null)
  check('what was placed heals again after a reload, from the hive\'s own translations pool', (await tOf(sub.page, KEY)) === JA)

  // ── 4. WHAT IS STILL MISSING is said under the subscriber's key ─────────
  await H.watchToasts(sub.page)
  await sub.page.evaluate(() => { const i = window.ioc.get('@hypercomb.social/I18n'); i.t('module.jevread'); i.t('module.focuson') })
  await H.say(sub.page, `language missing ja @${WRITE}`)
  const told = await H.toastsUntil(sub.page, /^Told |not published|Nothing is missing/, 60_000)
  const subscriber = await sub.page.evaluate(() => window.ioc.get('@diamondcoreprocessor.com/NostrSigner').getPublicKeyHex())
  const missingSig = await H.waitFor(async () => channelOf(await hostState(), subscriber, 'i18n-missing:ja'), 30_000, 1000)
  const missing = missingSig ? JSON.parse(await fromHost(missingSig)) : null
  const listedAgain = await (await fetch(`http://${HOST}/i18n/ja.json`)).json()
  check('the subscriber publishes what its locale lacks, under its own key, and the host lists who is missing what', missing?.kind === 'i18n-missing' && missing.keys.includes('module.jevread') && !missing.keys.includes(KEY) && listedAgain.missing?.some(m => m.pubkey === subscriber && m.keys.includes('module.jevread')), JSON.stringify(told))

  await browser.close()
  finish()
})().catch(err => { console.error(err); process.exit(1) })
