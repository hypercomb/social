#!/usr/bin/env node
// verify-hive-publish — MANAGE HYPERCOMB FROM INSIDE THE HIVE, end to end,
// under the sandbox paradigm (documentation/module-sandbox.md):
//
//   1. a model writes a module through the chat; Jev judges the write
//   2. `module commit` publishes the whole package and opens a SANDBOX:
//      install:try-<change>, never the live channel; the change (each drafted
//      file before and after) is published beside it, and the host's AI reads
//      it — review:try-<change>
//   3. a tester opens try-<change>.<zone>: a full hive whose door names that
//      package, and runs the model's code — while followers are NOT told
//   4. `module promote` moves the live channel to the same root: the follower
//      is told, replicates it from the host, and runs it
//   5. a unit turned off and committed + promoted is unreachable for the
//      follower, and every earlier file is still on the host
//   6. `module withdraw` closes the door; the files stay
//
//   node scripts/local-content-host.mjs 4291 http://localhost:4260 --ai-stub   (the content host's own worker)
//   node scripts/verify-hive-publish.cjs [web=http://localhost:4260] [host=localhost:4291]
//
// Fresh Playwright profiles on the WEB shell; the door is served on
// try-<change>.localhost:<port> (any *.localhost is loopback). Only
// openrouter.ai is scripted (scripts/hive-harness.cjs); everything after the
// draft is real: signed NIP-98 uploads with read-back, the signed index, the
// worker's door, the shell's cold boot from the door, the update scout,
// attestation against the followed key, replication, reload.
const { chromium } = require('playwright')
const H = require('./hive-harness.cjs')

const WEB = process.argv[2] || 'http://localhost:4260'
const HOST = process.argv[3] || 'localhost:4291'
const MARKER = `published-from-the-hive-${Date.now()}`
const CHANGE = `proof-${Date.now().toString(36)}`
const SANDBOX = `try-${CHANGE}`
const DOOR = `http://${SANDBOX}.${HOST}`
// Writes go to the zone's content face, as in production (content.<zone> is
// the relay, never a site); the door opens on the zone itself.
const WRITE = `content.${HOST}`
const hostState = async () => (await fetch(`http://${HOST}/__state`)).json()
const channelOf = (state, pubkey, key) => state.hives[pubkey] ? JSON.parse(state.hives[pubkey].content).roots[key] ?? null : null
const selectionHas = (page, path) => page.evaluate(async p => (await window.ioc.get('@hypercomb.social/Install').selection()).nodes.some(n => n.path === p), path)
const proofOf = page => H.waitFor(() => page.evaluate(() => globalThis.__hivePublishProof ?? null), 90_000, 800)
const announcedOn = page => page.evaluate(() => {
  let got = null
  const off = globalThis.__hypercombEffectBus.on('update:available', p => { if (p?.source === 'channel') got = p.packageSig })
  if (typeof off === 'function') off()
  return got
})

;(async () => {
  if (!(await hostState().catch(() => null))) throw new Error(`the content host is not answering on ${HOST} — start scripts/local-content-host.mjs first`)
  const { check, finish } = H.checker()
  const browser = await chromium.launch({ headless: true })
  const LOCAL_ROOT = H.LOCAL_ROOT()

  // ── THE PUBLISHER, and a follower of its live channel ──────────────────
  const pub = await H.openHive(browser, 'publisher', WEB)
  const page = pub.page
  check('the publisher runs this machine\'s build', await pub.installed() === LOCAL_ROOT, LOCAL_ROOT.slice(0, 12))
  const pubkey = await page.evaluate(() => window.ioc.get('@diamondcoreprocessor.com/NostrSigner').getPublicKeyHex())
  // The operator's binding: this publisher may open doors on the zone.
  await fetch(`http://${HOST}/__bind`, { method: 'POST', body: JSON.stringify({ zone: HOST.split(':')[0], pubkey }) })

  const fol = await H.openHive(browser, 'follower', WEB)
  await fol.page.evaluate(([pk, host]) => localStorage.setItem('hc:install-follow', JSON.stringify({ pubkey: pk, hosts: [host], channel: 'essentials' })), [pubkey, WRITE])

  // ── 1. A MODEL WRITES THE MODULE ────────────────────────────────────────
  const target = await H.smallestModule(page)
  check('a module with a source section is held', !!target, target ? `${target.path} ${target.section}` : '')
  const newBody = `${target.body}\nglobalThis.__hivePublishProof = ${JSON.stringify(MARKER)};`
  const run = await H.draftThroughChat(page, target, newBody)
  const judged = run.jevCalls.find(c => c.rows.some(r => r.startsWith('write:')))
  check('Jev judged the write as a write row, with the header as the model wrote it', !!judged && judged.rows.some(r => r.includes(`${target.bee} ${target.section}`)))
  check('Jev was asked toward, beyond, grounded and every doctrine section', !!judged && ['write_toward', 'write_beyond', 'write_grounded'].every(k => judged.questions.includes(k)) && judged.questions.filter(k => /^write_rule\d+$/.test(k)).length >= 3)
  check('the write ran through Execution as an edit', run.decided.some(d => d.kind === 'editing' && /^write /.test(d.lines[0])), JSON.stringify(run.decided))
  check('the draft is picked at the module\'s path', !!run.drafted && run.drafted[0].path === target.path)

  // ── 2. COMMIT OPENS A SANDBOX — the live channel does not move ──────────
  await H.watchToasts(page)
  const said = await H.say(page, `module commit ${CHANGE} @${WRITE}`)
  const shown = await H.toastsUntil(page, /^Sandbox |not stamped|not published/)
  console.log('   toasts:', JSON.stringify(shown))
  const sandboxRoot = await pub.installed()
  const state1 = await hostState()
  check('module commit was accepted', said.accepted && said.outcome?.kind === 'ran', JSON.stringify(said.outcome))
  check('the committed root runs here as the trunk', !!sandboxRoot && sandboxRoot !== LOCAL_ROOT, sandboxRoot?.slice(0, 12))
  check('the sandbox channel names the committed root', channelOf(state1, pubkey, `install:${SANDBOX}`) === sandboxRoot)
  check('the live channel was NOT moved', channelOf(state1, pubkey, 'install:essentials') === null)
  check('the host holds the whole package, so the door can serve it alone', state1.content.length >= 200 && state1.content.includes(sandboxRoot), `${state1.content.length} files`)
  check('the publisher is told where the door is', (shown ?? []).some(m => m.includes(DOOR)), DOOR)

  // ── 2b. THE CHANGE IS PUBLIC, AND THE HOST'S AI READS IT ────────────────
  const reviewed = await H.toastsUntil(page, /AI read |review cannot run/, 120_000)
  console.log('   review:', JSON.stringify((reviewed ?? []).filter(m => / AI |review/.test(m))))
  const stateR = await hostState()
  const changeSig = channelOf(stateR, pubkey, `change:${SANDBOX}`)
  const reviewSig = channelOf(stateR, pubkey, `review:${SANDBOX}`)
  const fromHost = async sig => (await fetch(`http://${HOST}/${sig}`)).text()
  const changeRecord = changeSig ? JSON.parse(await fromHost(changeSig)) : null
  const drafted = changeRecord?.changes?.[0]
  const [beforeText, afterText] = drafted ? await Promise.all([fromHost(drafted.before), fromHost(drafted.after)]) : ['', '']
  check('the change is published beside the sandbox, file by file', !!changeSig && drafted?.section === target.section && afterText.includes(MARKER) && !beforeText.includes(MARKER))
  const reviewRecord = reviewSig ? JSON.parse(await fromHost(reviewSig)) : null
  const findings = reviewRecord ? await fromHost(reviewRecord.findings) : ''
  check('the host AI read the change, and its reading is published beside it', reviewRecord?.verdict === 'accept' && reviewRecord?.change === changeSig, reviewRecord ? `${reviewRecord.verdict} by ${reviewRecord.model}` : 'no review')
  check('the host AI was shown the changed code itself, from its own heap', /__hivePublishProof: yes/.test(findings) && /Context files shown: 2/.test(findings), findings.split('\n').slice(1, 3).join(' '))

  // ── 3. A TESTER OPENS THE DOOR ──────────────────────────────────────────
  // The door is read from the tester's browser: Chrome resolves *.localhost
  // to loopback, Node on Windows does not.
  const testerContext = await H.freshContext(browser)
  const tester = await testerContext.newPage()
  H.logPage(tester, 'tester')
  await tester.goto(DOOR, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  const site = await tester.evaluate(() => fetch('/site.json', { cache: 'no-store' }).then(r => r.json())).catch(() => null)
  check('the door describes itself as the sandbox of that package', site?.sandbox === true && site?.package === sandboxRoot && site?.pubkey === pubkey)
  check('the door names the change and the review, for anyone to read', site?.change === changeSig && site?.review === reviewSig)
  const testerRuns = await H.waitFor(() => H.installedOf(tester), 180_000, 1000)
  check('the tester\'s hive at the door installed exactly the sandbox package', testerRuns === sandboxRoot, String(testerRuns).slice(0, 12))
  check('the tester runs the code the model wrote', await proofOf(tester) === MARKER)
  await fol.page.reload({ waitUntil: 'domcontentloaded' })
  await H.sleep(8000)
  check('the follower is not told of a sandbox', (await announcedOn(fol.page)) !== sandboxRoot)

  // ── 4. PROMOTE: the live channel moves to the same root ─────────────────
  await H.watchToasts(page)
  await H.say(page, `module promote ${CHANGE} @${WRITE}`)
  console.log('   toasts:', JSON.stringify(await H.toastsUntil(page, /^Promoted |not stamped|no sandbox/)))
  check('promote moved install:essentials to the sandbox root, uploading nothing', channelOf(await hostState(), pubkey, 'install:essentials') === sandboxRoot)
  await fol.page.reload({ waitUntil: 'domcontentloaded' })
  const announced = await H.waitFor(() => announcedOn(fol.page), 120_000, 1000)
  check('now the follower\'s update scout announces it', announced === sandboxRoot, String(announced).slice(0, 12))
  const taken = await fol.page.evaluate(([root, host]) => window.ioc.get('@hypercomb.social/Install').acquire(root, [host]), [sandboxRoot, WRITE])
  check('the follower replicates it from the host, attested by the followed key', taken.ok, JSON.stringify(taken))
  await fol.page.reload({ waitUntil: 'domcontentloaded' })
  check('after a reload the follower runs the code the model wrote', await proofOf(fol.page) === MARKER)

  // ── 5. TURNED OFF IS NOT REACHABLE — and nothing is deleted ─────────────
  const offPath = await page.evaluate(async skip => {
    const sel = await window.ioc.get('@hypercomb.social/Install').selection()
    const leaf = sel.nodes.filter(n => !n.children.length && n.bees.length && n.path !== skip && !n.path.startsWith('assistant') && !n.path.startsWith('sharing'))
    return leaf.sort((a, b) => a.path.localeCompare(b.path)).pop()?.path ?? null
  }, target.path)
  await page.evaluate(p => { const install = window.ioc.get('@hypercomb.social/Install'); install.setOffUnits([...install.offUnits(), p]) }, offPath)
  await H.watchToasts(page)
  await H.say(page, `module commit ${CHANGE}-off @${WRITE}`)
  await H.toastsUntil(page, /^Sandbox |not stamped|not published/)
  await H.watchToasts(page)
  await H.say(page, `module promote ${CHANGE}-off @${WRITE}`)
  await H.toastsUntil(page, /^Promoted |not stamped|no sandbox/)
  const offRoot = await pub.installed()
  const state2 = await hostState()
  check('a unit turned off, committed and promoted is the live root', channelOf(state2, pubkey, 'install:essentials') === offRoot && offRoot !== sandboxRoot, `${offPath}: ${offRoot?.slice(0, 12)}`)
  check('the new root does not reach the unit that was turned off', !(await selectionHas(page, offPath)))
  check('the host still holds every earlier file — unreachable, not deleted', state1.content.every(sig => state2.content.includes(sig)))
  const taken2 = await fol.page.evaluate(([root, host]) => window.ioc.get('@hypercomb.social/Install').acquire(root, [host]), [offRoot, WRITE])
  check('the follower takes it, and the unit is gone from its package', taken2.ok && !(await selectionHas(fol.page, offPath)), JSON.stringify(taken2))

  // ── 6. WITHDRAW: the door closes, the files stay ────────────────────────
  await H.watchToasts(page)
  await H.say(page, `module withdraw ${CHANGE} @${WRITE}`)
  console.log('   toasts:', JSON.stringify(await H.toastsUntil(page, /^Withdrew |not stamped/)))
  const closed = { status: await tester.evaluate(() => fetch('/', { cache: 'no-store' }).then(r => r.status)) }
  const state3 = await hostState()
  check('the withdrawn door answers nothing here', closed.status === 404, String(closed.status))
  check('its package is still on the host', state3.content.includes(sandboxRoot))

  await browser.close()
  process.exit(finish() ? 0 : 1)
})().catch(error => { console.error(error); process.exit(1) })
