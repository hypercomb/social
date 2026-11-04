// Pictures taken in a running hive, for the pages' "In the hive" part
// (content.cjs `live`). Each is the real hive, doing the thing its page
// explains, saved as blocks/captures/<shot>.webp at twice the pixels.
//
//   node scripts/bridge/living-presentation/blocks/captures.cjs [<shot>...] [--hive <url>] [--list]
//
// It opens Edge on the dev hive (http://localhost:4250 unless --hive names
// another) in a profile of its own, made in the OS temp directory and removed
// afterwards, so it never shares a store with a hive you have open (one writer
// per store) and never takes the bridge. It starts that hive empty, plants the
// presentation the way plant.cjs says it (every sentence through the door
// Enter uses), and then takes each shot in order: say its sentences, let the
// hive settle, take the picture, say what puts things back. With no shot
// named, it takes them all.
//
// These are the shots a sentence can stage in an empty hive. The pictures of a
// lived-in hive (picture tiles, a website, the editor, chat, a long history)
// are taken by hand in the author's own hive instead; content.cjs names them.
//
// Edge runs with a window, since a page without a GPU cannot draw the hive.
// The pictures are encoded to WebP by the browser itself, so nothing new is
// installed. Run it from src/ with the repo's node_modules (playwright).

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { chromium } = require('playwright')

const OUT = path.join(__dirname, 'captures')
const PLANT = path.join(__dirname, '..', 'plant.cjs')
const VIEW = { width: 1280, height: 800 }

/** The shots, in the order they are taken. `say` runs before the picture,
 *  `after` puts the hive back for the shots that follow. */
const SHOTS = [
  { shot: 'layout-on', say: ['go /protocol/organized', 'create notes', 'layout on'] },
  { shot: 'layout-off', say: ['go /protocol/organized', 'layout off'], after: ['layout on'] },
  { shot: 'trait-silhouette', say: ['go /protocol/organized/trait', 'trait portrait tagline contact', 'hide contact'] },
  // help, in Japanese, filtered to the words for tiles
  { shot: 'hive-in-japanese', say: ['go /protocol', 'language ja', 'help'], filter: 'タイル', after: ['language en'] },
  {
    shot: 'sentence-before-it-runs',
    say: ['go /protocol/intelligent'],
    // An outside caller's lines wait on the command line until the
    // participant answers; the picture is taken while they wait, and Escape
    // declines them, so nothing runs.
    ask: { from: 'an agent', lines: ['trait example', 'layout on', 'builds example'] },
  },
]

const args = process.argv.slice(2)
const valueOf = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }
const HIVE = valueOf('--hive') || 'http://localhost:4250/'
if (args.includes('--list')) { for (const s of SHOTS) console.log(s.shot); process.exit(0) }
const named = args.filter(a => !a.startsWith('--') && a !== HIVE)
const unknown = named.filter(n => !SHOTS.some(s => s.shot === n))
if (unknown.length) { console.error(`no shot ${unknown.join(', ')} (--list names them)`); process.exit(2) }

const pause = (ms) => new Promise(r => setTimeout(r, ms))

/** Say one line the way Enter says it, and give the hive time to answer. */
const say = async (page, line) => {
  const text = line.startsWith('/') ? line : `/${line}`
  await page.evaluate((t) => globalThis.__hypercombEffectBus.emit('command:submit', { text: t }), text)
  await pause(text.startsWith('/go ') ? 1600 : 1100)
}

/** The picture as WebP, encoded by the page's own canvas. */
const webp = async (page, png) => page.evaluate(async (b64) => {
  const img = new Image()
  img.src = `data:image/png;base64,${b64}`
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.naturalWidth; c.height = img.naturalHeight
  c.getContext('2d').drawImage(img, 0, 0)
  return c.toDataURL('image/webp', 0.86).split(',')[1]
}, png.toString('base64'))

const main = async () => {
  const lines = spawnSync(process.execPath, [PLANT, '--all', '--sentences', '--no-retire'], { encoding: 'utf8' })
  if (lines.status !== 0) throw new Error(`plant.cjs --sentences failed: ${lines.stderr}`)
  const planting = lines.stdout.split('\n').map(l => l.trim()).filter(Boolean)
  const wanted = named.length ? SHOTS.filter(s => named.includes(s.shot)) : SHOTS
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-captures-'))
  const ctx = await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: false, viewport: VIEW, deviceScaleFactor: 2 })
  try {
    // The dev server reloads every page it serves when any file changes; a
    // capture run must not be reloaded halfway, so its HMR socket is refused.
    await ctx.addInitScript(() => {
      const Native = window.WebSocket
      const asksHmr = (p) => String(p).includes('vite-hmr')
      window.WebSocket = function (url, protocols) {
        if (asksHmr(protocols)) return { close() {}, send() {}, addEventListener() {}, removeEventListener() {} }
        return protocols === undefined ? new Native(url) : new Native(url, protocols)
      }
      window.WebSocket.prototype = Native.prototype
      Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })
    })
    const page = ctx.pages()[0] || await ctx.newPage()
    await page.goto(HIVE, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => globalThis.__hypercombEffectBus && document.querySelector('input.command-input'), null, { timeout: 60000 })
    // A new hive opens on its first-boot offer; this one starts empty.
    const empty = page.getByText('Start empty', { exact: true })
    await empty.waitFor({ timeout: 30000 }).then(() => empty.click()).catch(() => {})
    await pause(1500)
    // The dev hive's update notice is about the dev server, not the hive.
    await page.evaluate(() => {
      const label = [...document.querySelectorAll('body *')].find(e => e.childElementCount === 0 && e.textContent.trim() === 'Update available')
      for (let box = label?.parentElement, i = 0; box && i < 4; box = box.parentElement, i++) {
        const close = [...box.querySelectorAll('button')].find(b => !b.contains(label))
        if (close) { close.click(); return }
      }
    })
    console.log(`planting the presentation: ${planting.length} sentences`)
    for (const line of planting) await say(page, line)
    await pause(2500)
    fs.mkdirSync(OUT, { recursive: true })
    for (const s of wanted) {
      for (const line of s.say) await say(page, line)
      if (s.filter) await page.locator('input[placeholder*="フィルタ"], input[placeholder*="ilter"]').first().fill(s.filter)
      if (s.ask) {
        await page.evaluate((ask) => globalThis.__hypercombEffectBus.emitTransient('external:call', { ...ask, accept: () => {}, complete: () => {} }), s.ask)
      }
      // The pointer rests on empty canvas, so no tile shows its hover; the
      // activity toasts are given time to fade.
      await page.mouse.move(VIEW.width - 120, VIEW.height - 200)
      await pause(7000)
      const png = await page.screenshot()
      const file = path.join(OUT, `${s.shot}.webp`)
      fs.writeFileSync(file, Buffer.from(await webp(page, png), 'base64'))
      console.log(`${s.shot} → ${path.relative(process.cwd(), file)} (${Math.round(fs.statSync(file).size / 1024)} KB)`)
      if (s.filter) await page.locator('input[placeholder*="フィルタ"], input[placeholder*="ilter"]').first().fill(s.filter)
      if (s.ask || s.filter) { await page.keyboard.press('Escape'); await pause(1200) }
      for (const line of s.after || []) await say(page, line)
    }
  } finally {
    await ctx.close()
    fs.rmSync(profile, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error.message); process.exit(1) })
