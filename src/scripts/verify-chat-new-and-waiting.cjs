// Chat naming verification — the two things a person actually sees.
//
//   node scripts/verify-chat-new-and-waiting.cjs [--url http://localhost:4250]
//
// A FRESH Playwright profile, never the browser Jaime has the hive open in:
// the packed store admits one writer, and whoever loads second loses.
//
//   1. THE ROOT CHAT WITH NOTHING IN IT still offers the way in — exactly one
//      "+ New conversation", and no conversation row wearing those words.
//   2. A QUESTION JUST SENT is a row, and it says "waiting for reply…" rather
//      than being named after the thing you did not know when you typed it.
const { chromium } = require('playwright')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const HIVE = arg('--url', 'http://localhost:4250')
// Generated output goes to the OS temp dir, never into the repo — see AGENTS.md.
const SHOT = arg('--shot', require('path').join(require('os').tmpdir(), 'chat-waiting.png'))
const sleep = ms => new Promise(r => setTimeout(r, ms))

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  const out = []
  const say = line => { out.push(line); console.log(line) }

  // A hive with no AI host at all shows the SETUP CHECKLIST instead of the
  // chat, and the checklist has no rail and no composer. Naming a host is
  // what a participant does before there is any chat to name — this profile
  // is a fresh, empty one, so it is stated up front.
  await page.goto(HIVE, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.setItem('hc:ai-host', 'http://127.0.0.1:9/never-answers'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.ioc?.get?.('@hypercomb.social/Store'), { timeout: 60_000 })
  await sleep(3_000)

  // The window opens on the bus — the same door every surface uses.
  await page.evaluate(() => globalThis.__hypercombEffectBus.emit('chat:open', {}))
  await sleep(1_500)
  await page.waitForSelector('.hc-rail-chats', { timeout: 15_000 })

  const read = async () => page.evaluate(() => ({
    links: [...document.querySelectorAll('.hc-rail-chat-new')].map(n => n.textContent.trim()),
    rows: [...document.querySelectorAll('.hc-rail-chat-body .hc-rail-chat-name')].map(n => n.textContent.trim()),
    awaiting: document.querySelectorAll('.hc-rail-chat.awaiting').length,
  }))

  say(`EMPTY FOLD  ${JSON.stringify(await read())}`)

  const box = page.locator('.chat-compose textarea, hc-chat-window textarea').first()
  if (await box.count()) {
    await box.click()
    await box.type('what names a conversation here')
    await page.keyboard.press('Enter')
    await sleep(2_500)
  } else say('NO COMPOSER FOUND — the send half could not be driven')

  say(`AFTER SEND  ${JSON.stringify(await read())}`)
  await page.locator('.chat-rail').screenshot({ path: SHOT })
  say(`shot: ${SHOT}`)
  if (errors.length) say(`page errors: ${errors.slice(0, 3).join(' | ')}`)

  await browser.close()
})().catch(err => { console.error(err); process.exit(1) })
