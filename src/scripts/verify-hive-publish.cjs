#!/usr/bin/env node
// verify-hive-publish — MANAGE HYPERCOMB FROM INSIDE THE HIVE, end to end,
// under the sandbox paradigm (documentation/module-sandbox.md):
//
//   1. a model writes a module through the chat; Jev judges the write
//   2. `module commit` publishes the whole package and opens a SANDBOX:
//      install:try-<change>, never the live channel; the change (each drafted
//      file before and after) is published beside it, and the host's AI reads
//      it — review:try-<change>; Jev reads its diff against every doctrine
//      section — jev:try-<change> — and both readings are public
//   3. a tester opens try-<change>.<zone>: a full hive whose door names that
//      package, and runs the model's code — while followers are NOT told; the
//      door tells the tester's hive what it runs, and is SAFE for them: its
//      own policy (https/wss only, never framed), no dial to the local bridge,
//      no write at the host, no key kept, no extension signer, the shell's door
//      bar, and the writing words refusing there; a reader signs a public
//      assessment from their OWN hive, and the publisher reads the tally;
//      the zone lists every open trial, and anyone finds this one there;
//      `module changes` opens what it changes, file by file, with the host
//      AI's reading and the tester's signed note, read by signature; the
//      follower AUDITS it from its own hive — its own model reads what the
//      trial brings, by signature, against what it runs, checked against the
//      change record, kept at home, nothing written to the bees pool; the
//      follower TAKES the trial at its path by hand — held in the brood, inert
//      across a reload, and running only once accepted there with both warnings;
//      then the follower COMMITS ITS OWN BUILD, and what it took is folded in —
//      part of its package, no longer a pick, named in its published change;
//      then Jev WEIGHS every open trial on the zone — readings, assessments,
//      adoption — and publishes where each stands and where to focus first
//   4. `module promote <change>` puts the trial live on its own site
//      (install:<change>, its pack beside it); `module promote <change>
//      essentials` moves the live channel to the same root: the follower is
//      told, replicates it from the host, and runs it
//   5. a unit turned off and committed + promoted is unreachable for the
//      follower, and every earlier file is still on the host
//   6. `module withdraw` closes the door and takes it off the zone's list;
//      the files stay
//
//   node scripts/local-content-host.mjs 4291 http://localhost:4260 --ai-stub   (the content host's own worker)
//   node scripts/verify-hive-publish.cjs [web=http://localhost:4260] [host=localhost:4291]
//   (HIVE_SHOT=<file.png> also saves the publisher's what-changed panel)
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

/** What the door the page is on says about itself, read by signature only. */
const readDoor = (page) => page.evaluate(async () => {
  const sign = async (text) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map(b => b.toString(16).padStart(2, '0')).join('')
  const names = async (path) => { const r = await fetch(path, { cache: 'no-store' }); return r.ok ? (await r.text()).split('\n').filter(Boolean) : [] }
  const json = async (path) => { const r = await fetch(path, { cache: 'no-store' }); return r.ok ? r.json() : null }
  const bag = await sign(location.hostname.toLowerCase())
  const newest = (await names(`/${bag}/`)).filter(n => /^\d{8}$/.test(n)).sort().at(-1)
  const door = newest ? await json(`/${bag}/${newest}`) : null
  if (!door) return null
  const jev = door.jev ? await json(`/content/${door.jev}`) : null
  const pool = await sign(`assess:${door.layer}`)
  const assessments = []
  for (const key of await names(`/${pool}/`)) { const a = await json(`/${pool}/${key}`); if (a) assessments.push(a) }
  return { ...door, package: door.layer, jevVerdict: jev?.verdict, assessments }
})

const hostState = async () => (await fetch(`http://${HOST}/__state`)).json()
// The zone's own listing of its trials (the local binding makes the zone an apex site).
// Named routes are retired: a host answers these at signatures only.
const TRIALS = require('crypto').createHash('sha256').update('host:trials').digest('hex')
const INDEXES = require('crypto').createHash('sha256').update('hive:indexes').digest('hex')
const trialsOnZone = async () => (await (await fetch(`http://${HOST}/${TRIALS}`, { cache: 'no-store' })).json()).trials ?? []
const channelOf = (state, pubkey, key) => state.hives[pubkey] ? JSON.parse(state.hives[pubkey].content).roots[key] ?? null : null
const selectionHas = (page, path) => page.evaluate(async p => (await window.ioc.get('@hypercomb.social/Install').selection()).nodes.some(n => n.path === p), path)
const proofOf = page => H.waitFor(() => page.evaluate(() => globalThis.__hivePublishProof ?? null), 90_000, 800)
/** The what-changed panel, once its reading is drawn. */
const panelOf = page => H.waitFor(() => page.evaluate(() => {
  const panel = document.querySelector('.hc-trial')
  if (!panel || !panel.querySelector('.hc-trial-row')) return null
  const all = selector => [...panel.querySelectorAll(selector)].map(node => node.textContent ?? '')
  return {
    title: panel.querySelector('.hc-trial-title')?.textContent ?? '', files: all('.hc-trial-file-name'),
    added: all('.hc-trial-row.is-add'), verdicts: all('.hc-trial-verdict'), people: all('.hc-trial-person'),
    jev: all('.hc-trial-quiet').filter(text => text.includes('closest to breaking')),
  }
}), 60_000, 800)
const closePanel = page => page.evaluate(() => document.querySelector('.hc-trial')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
/** What the brood holds from one root, unruled. */
const heldFrom = (page, root) => page.evaluate(async r => {
  const core = await import('@hypercomb/core')
  return (await core.broodRoster()).filter(record => record.source.packageSig === r && !record.ruling).map(record => record.sig)
}, root)
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
  check('Jev judged the write against the Life Primitive — its shape and its rules', !!judged && ['### The Life Primitive', '### The Life Primitive — its rules'].every(rule => judged.rules.includes(rule)), JSON.stringify(judged?.rules))
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
  // A hop the trail publishes is a meta envelope: open it to the text it names (a raw signature opens to itself).
  const hopOf = async sig => { try { return JSON.parse(await fromHost(sig)) } catch { return null } }
  const openHop = async sig => { const hop = await hopOf(sig); return hop?.meta === 1 && hop.resource ? fromHost(hop.resource) : fromHost(sig) }
  const changeRecord = changeSig ? JSON.parse(await fromHost(changeSig)) : null
  const drafted = changeRecord?.changes?.[0]
  const [beforeText, afterText] = drafted ? await Promise.all([openHop(drafted.before), openHop(drafted.after)]) : ['', '']
  check('the change is published beside the sandbox, file by file', !!changeSig && drafted?.section === target.section && afterText.includes(MARKER) && !beforeText.includes(MARKER))
  const reviewRecord = reviewSig ? JSON.parse(await fromHost(reviewSig)) : null
  const findings = reviewRecord ? await openHop(reviewRecord.findings) : ''
  check('the host AI read the change, and its reading is published beside it', reviewRecord?.verdict === 'accept' && reviewRecord?.change === changeSig, reviewRecord ? `${reviewRecord.verdict} by ${reviewRecord.model}` : 'no review')
  check('the host AI was shown the changed code itself, from its own heap', /__hivePublishProof: yes/.test(findings) && /Context files shown: 2/.test(findings), findings.split('\n').slice(1, 3).join(' '))
  const [beforeHop, findingsHop] = drafted && reviewRecord ? await Promise.all([hopOf(drafted.before), hopOf(reviewRecord.findings)]) : [null, null]
  const oneHop = hop => !!hop && hop.meta === 1 && ['layer', 'resource', 'dependency', 'bee'].filter(k => hop[k] !== undefined).length === 1 && /^[0-9a-f]{64}$/.test(hop.resource ?? '')
  check('the trail wears the Life Primitive: every hop a reader opens is a meta envelope — one typed payload, its relation named', oneHop(beforeHop) && beforeHop.relation === 'before' && oneHop(findingsHop) && findingsHop.relation === 'findings', JSON.stringify(beforeHop))

  // ── 2c. JEV READS THE DIFF, RULE BY RULE, AND ITS READING IS PUBLIC ─────
  const jevToasts = await H.toastsUntil(page, /^Jev read |Jev did not read/, 60_000)
  const jevSig = await H.waitFor(async () => channelOf(await hostState(), pubkey, `jev:${SANDBOX}`), 30_000, 1000)
  const jevRecord = jevSig ? JSON.parse(await fromHost(jevSig)) : null
  check('Jev read the change\'s diff against every doctrine section, and its reading is published beside the trial', jevRecord?.kind === 'jev-reading' && jevRecord.change === changeSig && jevRecord.verdict === 'follows' && jevRecord.files?.[0]?.section === target.section && jevRecord.files[0].rules.length >= 8, JSON.stringify(jevToasts))
  check('the reading names the rule each file comes closest to breaking, the Life Primitive among those judged', !!jevRecord && jevRecord.files.every(file => typeof file.worst?.rule === 'string' && typeof file.worst?.breaks === 'number') && jevRecord.files[0].rules.some(rule => rule.rule === 'The Life Primitive — its rules'))

  // ── 3. A TESTER OPENS THE DOOR ──────────────────────────────────────────
  // The door is read from the tester's browser: Chrome resolves *.localhost
  // to loopback, Node on Windows does not.
  const testerContext = await H.freshContext(browser)
  const tester = await testerContext.newPage()
  H.logPage(tester, 'tester')
  const doorResponse = await tester.goto(DOOR, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  const site = await readDoor(tester).catch(() => null)
  check('the door describes itself as the sandbox of that package', site?.sandbox === true && site?.package === sandboxRoot && site?.pubkey === pubkey)
  check('the door names the change and the review, for anyone to read', site?.change === changeSig && site?.review === reviewSig)
  check('the door names Jev\'s reading and where the change stands', site?.jev === jevSig && site?.jevVerdict === 'follows')
  const testerRuns = await H.waitFor(() => H.installedOf(tester), 180_000, 1000)
  check('the tester\'s hive at the door installed exactly the sandbox package', testerRuns === sandboxRoot, String(testerRuns).slice(0, 12))
  check('the tester runs the code the model wrote', await proofOf(tester) === MARKER)
  // The tester's words run through the module word's bee: a word said before
  // that bee loads is read as a tile's name, so wait for it.
  await H.waitFor(() => tester.evaluate(() => (!!window.ioc?.get('@diamondcoreprocessor.com/ModuleQueenBee')
    && !!window.ioc?.get('@diamondcoreprocessor.com/HostSyncService')?.publishAtoms) || null), 60_000, 500)

  const told = await H.waitFor(() => tester.evaluate(() => {
    let got = null
    const off = globalThis.__hypercombEffectBus.on('module:door', s => { got = s })
    if (typeof off === 'function') off()
    return got
  }), 60_000, 800)
  check('the door tells the hive at it what it runs and how the host AI read it', told?.package === sandboxRoot && told?.reviewVerdict === 'accept')

  // ── 3a. THE DOOR IS SAFE FOR WHOEVER TRIES IT ───────────────────────────
  // The publisher's code runs here with full page power; nothing of the
  // visitor's may be within its reach, and it may write nothing anywhere.
  const csp = doorResponse?.headers()['content-security-policy'] ?? ''
  check('the door page carries its own policy: https and wss only, never framed', /connect-src 'self' https: wss:/.test(csp) && /frame-ancestors 'none'/.test(csp) && !/\bws:|\bhttp:(?!\/\/)/.test(csp), csp)
  const bridgeDial = await tester.evaluate(() => new Promise(resolve => {
    document.addEventListener('securitypolicyviolation', e => resolve(`violation:${e.effectiveDirective}`), { once: true })
    try { new WebSocket('ws://localhost:2401') } catch (error) { resolve(`threw:${error?.name}`) }
    setTimeout(() => resolve('allowed'), 3000)
  }))
  check('the door cannot dial the visitor\'s own machine (the local bridge)', bridgeDial !== 'allowed', bridgeDial)
  const doorKey = await tester.evaluate(() => window.ioc.get('@diamondcoreprocessor.com/NostrSigner').getPublicKeyHex())
  const doorWrite = await tester.evaluate(([host, key, indexes]) => fetch(`http://${host}/${indexes}/${key}`, { method: 'PUT', body: '{}' })
    .then(r => `status:${r.status}`, error => `refused:${error?.name}`), [WRITE, doorKey, INDEXES])
  check('the door writes nothing at the host', doorWrite === 'status:403' || doorWrite.startsWith('refused:'), doorWrite)
  const doorShell = await tester.evaluate(async () => {
    const core = await import('@hypercomb/core')
    core.llmKeyStore.set('openrouter', 'sk-door-test')
    const nostr = Object.getOwnPropertyDescriptor(window, 'nostr')
    return {
      keyKept: !!core.llmKeyStore.get('openrouter'),
      nostrPinned: window.nostr === undefined && !!nostr && nostr.configurable === false,
      bar: document.querySelector('[data-door-bar]')?.textContent ?? '',
    }
  })
  check('a key typed at the door is kept nowhere', doorShell.keyKept === false)
  check('the door has no signer from an extension (window.nostr pinned away)', doorShell.nostrPinned === true)
  check('the shell says whose code this is, at the door', /Sandbox/.test(doorShell.bar) && /keys/.test(doorShell.bar), doorShell.bar)
  await H.watchToasts(tester)
  await H.say(tester, `module assess ${CHANGE} refuse at the door @${WRITE}`)
  const refusedAtDoor = await H.toastsUntil(tester, /writes nothing/, 20_000).catch(() => null)
  check('the words that write say so at the door, and point home', !!refusedAtDoor, JSON.stringify(refusedAtDoor))

  // ── 3b. ANYONE ASSESSES IT, FROM THEIR OWN HIVE ─────────────────────────
  // A door writes nothing, so an assessment is signed at home — here the
  // follower's hive, a stranger to the publisher, under its own key.
  const testerKey = await fol.page.evaluate(() => window.ioc.get('@diamondcoreprocessor.com/NostrSigner').getPublicKeyHex())
  await H.watchToasts(fol.page)
  await H.say(fol.page, `module assess ${CHANGE} refuse raises zoom without asking @${WRITE}`)
  console.log('   assessor toasts:', JSON.stringify(await H.toastsUntil(fol.page, /assessment/)))
  const listed = await readDoor(tester)
  const mine = (listed.assessments ?? []).find(a => a.pubkey === testerKey)
  const assessment = mine ? JSON.parse(await fromHost(mine.record)) : null
  const note = assessment ? await openHop(assessment.note) : ''
  const noteHop = assessment ? await hopOf(assessment.note) : null
  check('anyone signs an assessment from their own hive, and the door lists it under their key', mine?.verdict === 'refuse' && testerKey !== pubkey, JSON.stringify(listed.assessments))
  check('the assessment names the change it read, and its note is public', assessment?.root === sandboxRoot && assessment?.change === changeSig && note === 'raises zoom without asking')
  check('the assessor\'s note is one typed hop too, under the assessor\'s own key', oneHop(noteHop) && noteHop.relation === 'note', JSON.stringify(noteHop))
  await H.watchToasts(page)
  await H.say(page, `module assess ${CHANGE} @${WRITE}`)
  const tally = await H.toastsUntil(page, /people who count/)
  // WHOSE WORD COUNTS: the follower is a stranger to the publisher, so its
  // refusal is listed, never counted; the host AI's reading is the publisher's word.
  check('the publisher reads how people assessed it, from its own hive — a stranger listed, not counted', (tally ?? []).some(m => /host's AI read accept/.test(m) && /0 refuse/.test(m) && /1 others/.test(m)), JSON.stringify(tally))

  // ── 3c. THE ZONE LISTS ITS TRIALS — anyone finds this one there ─────────
  const trial = (await trialsOnZone()).find(t => t.name === SANDBOX)
  check('the zone lists the trial: whose, its door, its package', trial?.pubkey === pubkey && trial?.door === DOOR && trial?.package === sandboxRoot, JSON.stringify(trial))
  check('the listing says what the trial changes, when, and how the host AI read it', !!trial && trial.sections.includes(target.section) && Number.isFinite(trial.at) && trial.reviewVerdict === 'accept' && trial.change === changeSig)
  await H.watchToasts(tester)
  await H.say(tester, `module trials @${WRITE}`)
  const found = await H.toastsUntil(tester, /AI read|No trials|did not list/)
  check('anyone finds the trials with a word — from inside another trial, too', (found ?? []).some(m => m.startsWith(`${SANDBOX} by publisher`) && m.includes(target.section) && m.includes(DOOR)), JSON.stringify(found))

  // ── 3d. ONE DIFFERENCE AT A TIME — what the trial changes ───────────────
  await H.say(page, `module changes ${CHANGE} @${WRITE}`)
  const panel = await panelOf(page)
  check('the publisher opens what the trial changes, file by file, read from the door', panel?.title === SANDBOX && panel.files.includes(target.section) && panel.added.some(row => row.includes(MARKER)), JSON.stringify(panel?.files))
  check('the panel carries the host AI reading and the tester\'s signed note', !!panel && panel.verdicts.some(v => v.startsWith('accept')) && panel.people.some(row => row.includes('refuse') && row.includes('raises zoom without asking')), JSON.stringify(panel?.people))
  check('the panel carries Jev\'s reading: the standing, and each file\'s rule closest to breaking', !!panel && panel.verdicts.some(v => v.startsWith('follows')) && panel.jev.some(row => row.startsWith(target.section) && row.includes('closest to breaking')), JSON.stringify(panel?.jev))
  if (process.env.HIVE_SHOT) await page.screenshot({ path: process.env.HIVE_SHOT })
  await closePanel(page)
  await H.say(tester, `module changes ${CHANGE}`)
  const atDoor = await panelOf(tester)
  check('at the door the same word opens the same change, with no host named', atDoor?.title === SANDBOX && atDoor.added.some(row => row.includes(MARKER)))
  await closePanel(tester)
  await fol.page.reload({ waitUntil: 'domcontentloaded' })
  await H.sleep(8000)
  check('the follower is not told of a sandbox', (await announcedOn(fol.page)) !== sandboxRoot)

  // ── 3d'. AUDIT IT FROM YOUR OWN HIVE — your model, by signature ─────────
  // The follower's own model reads what the trial brings that it does not
  // run: fetched by signature, held in memory, set against what runs here.
  const newBee = drafted?.to
  const readings = await H.scriptReader(fol.page, content => /__hivePublishProof/.test(content)
    ? 'It adds one line that sets globalThis.__hivePublishProof to a string. It reads no keys or storage and sends nothing.\nRECOMMENDS: accept'
    : 'Nothing of the kind.\nRECOMMENDS: accept')
  await H.watchToasts(fol.page)
  await H.say(fol.page, `module audit ${CHANGE} @${WRITE}`)
  const audited = await H.toastsUntil(fol.page, /^Your model says |The audit did not run|runs only code you already run|No model is set up/, 180_000)
  console.log('   audit toasts:', JSON.stringify(audited))
  check('the follower audits the trial from its own hive: its model read what the trial brings', (audited ?? []).some(m => m.startsWith(`Your model says accept of ${sandboxRoot.slice(0, 12)}`) && m.includes('(1 of 1 sections read)')), JSON.stringify(audited))
  check('its model was shown the drafted section against what runs here, fenced as data', readings.length === 1 && readings[0].includes(`section="${target.section}"`)
    && /<code-after[^>]*>[\s\S]*__hivePublishProof[\s\S]*<\/code-after>/.test(readings[0]) && /<code-before[^>]*signature="[0-9a-f]{64}"/.test(readings[0]), `${readings.length} readings`)
  const kept = await fol.page.evaluate(async ([sandbox, bee]) => {
    const audited = JSON.parse(localStorage.getItem('hc:module-audited') ?? '{}')[sandbox] ?? null
    const store = window.ioc.get('@hypercomb.social/Store')
    const blob = audited?.record ? await (store.getResourceLocal ?? store.getResource).call(store, audited.record) : null
    const record = blob ? JSON.parse(await blob.text()) : null
    // The bees pool and its legacy drain, read locally (Store.getBeeBytes never fetches).
    const pooled = !!(await store.getBeeBytes(bee))
    return {
      audited, pooled,
      record: record && { kind: record.kind, root: record.root, verdict: record.verdict, sigs: record.modules?.map(m => m.sig), declared: record.modules?.map(m => m.declared), drift: record.drift?.length, undeclared: record.undeclared?.length },
    }
  }, [SANDBOX, newBee])
  check('the audit is kept in the follower\'s own hive, and binds what a take may take', kept.audited?.root === sandboxRoot && kept.record?.kind === 'module-audit' && kept.record.root === sandboxRoot && kept.record.verdict === 'accept', JSON.stringify(kept.record))
  check('the change record declares what the trial brings, and its text is the code\'s', JSON.stringify(kept.record?.sigs) === JSON.stringify([newBee]) && kept.record?.declared?.[0] === true && kept.record.drift === 0 && kept.record.undeclared === 0, JSON.stringify(kept.record))
  check('nothing it read was written into the bees pool, and nothing of it runs', kept.pooled === false && await H.installedOf(fol.page) === LOCAL_ROOT && await fol.page.evaluate(() => globalThis.__hivePublishProof ?? null) === null)

  // ── 3e. YOUR OWN BUILD — anyone takes a trial at one path, held ─────────
  await H.watchToasts(fol.page)
  await H.say(fol.page, `module take ${CHANGE} @${WRITE}`)
  const took = await H.toastsUntil(fol.page, /^Took |was not taken/)
  const pickTaken = await fol.page.evaluate(async path => (await window.ioc.get('@hypercomb.social/Install').selection()).picks[path] ?? null, target.path)
  check('the follower takes the trial at the path its change touched, by hand', pickTaken?.root === sandboxRoot && pickTaken?.byHand === true && (took ?? []).some(m => m.startsWith(`Took ${target.path} from ${SANDBOX}`)), JSON.stringify(took))
  const heldHere = await heldFrom(fol.page, sandboxRoot)
  check('what it brought waits in the brood as a stranger\'s code — only what is new', heldHere.length >= 1 && heldHere.length < 10, `${heldHere.length} held`)
  const worn = await fol.page.evaluate(async sigs => {
    const core = await import('@hypercomb/core')
    return Promise.all(sigs.map(async sig => (await core.broodRecord(sig))?.audits?.map(audit => audit.summary) ?? []))
  }, heldHere)
  check('what the take holds wears the audit said before it — the brood does not call it unread', worn.some(list => list.some(summary => summary.startsWith(`module audit of ${SANDBOX}: accept`))), JSON.stringify(worn))
  await fol.page.reload({ waitUntil: 'domcontentloaded' })
  await H.waitFor(() => fol.page.evaluate(() => !!window.ioc?.get('@diamondcoreprocessor.com/ModuleQueenBee')), 120_000, 1000)
  await H.sleep(6000)
  check('held code does not run: after a reload the follower still does not run the trial', await fol.page.evaluate(() => globalThis.__hivePublishProof ?? null) === null)
  // The participant accepts it with the brood's word: both warnings shown
  // and dismissed (brood-accept.ts), for each thing the take left held.
  await H.watchToasts(fol.page)
  await fol.page.evaluate(() => {
    const bus = globalThis.__hypercombEffectBus
    let live = false
    bus.on('confirm:request', request => { if (live && request?.id) queueMicrotask(() => bus.emit('confirm:response', { id: request.id, confirmed: true })) })
    live = true
  })
  for (const sig of heldHere) await H.say(fol.page, `brood accept ${sig.slice(0, 12)}`)
  const accepted = await H.toastsUntil(fol.page, /^Accepted/, 60_000)
  check('accepting in the brood composes the take in', (accepted ?? []).some(m => m.startsWith('Accepted: what you took')), JSON.stringify(accepted))
  check('nothing it brought is still held', (await heldFrom(fol.page, sandboxRoot)).length === 0)
  await fol.page.reload({ waitUntil: 'domcontentloaded' })
  check('once accepted by hand, the follower runs the trial it took', await proofOf(fol.page) === MARKER)

  // ── 3f. A BUILD FOR EVERYBODY — the follower commits what it took ───────
  // A word said before its bee has loaded is read as a tile's name: wait for it.
  await H.waitFor(() => fol.page.evaluate(() => !!window.ioc?.get('@diamondcoreprocessor.com/ModuleQueenBee') || null), 60_000, 500)
  // Its build is its own: the trial it took, plus a unit of its own turned off.
  // (Folding the trial alone would rebuild the trial's root byte for byte —
  // the same composition is the same signature, wherever it is made.)
  const folOff = await fol.page.evaluate(async skip => {
    const sel = await window.ioc.get('@hypercomb.social/Install').selection()
    const leaf = sel.nodes.filter(node => !node.children.length && node.bees.length && !skip.some(path => node.path === path || node.path.startsWith(`${path}/`)))
    return leaf.sort((a, b) => a.path.localeCompare(b.path))[0]?.path ?? null
  }, [target.path, 'assistant', 'sharing', 'commands', 'keyboard'])
  await fol.page.evaluate(path => { const install = window.ioc.get('@hypercomb.social/Install'); install.setOffUnits([...install.offUnits(), path]) }, folOff)
  // The zone approves the follower as a publisher too (the operator's binding), so its door opens and the zone lists its trial.
  const folKey = await fol.page.evaluate(() => window.ioc.get('@diamondcoreprocessor.com/NostrSigner').getPublicKeyHex())
  await fetch(`http://${HOST}/__bind`, { method: 'POST', body: JSON.stringify({ zone: HOST.split(':')[0], pubkey: folKey, label: 'follower' }) })
  await H.watchToasts(fol.page)
  await H.say(fol.page, `module commit ${CHANGE}-mine @${WRITE}`)
  const folded = await H.toastsUntil(fol.page, /^Sandbox |not stamped|not published|nothing to commit/)
  const folSel = await fol.page.evaluate(async path => {
    const sel = await window.ioc.get('@hypercomb.social/Install').selection()
    return { trunk: sel.trunk, picked: !!sel.picks[path], layer: sel.nodes.find(node => node.path === path)?.layerSig ?? null }
  }, target.path)
  check('the follower commits its own build, and what it took is folded in — part of its package, no longer a pick', !!folSel.trunk && folSel.trunk !== sandboxRoot && !folSel.picked && folSel.layer === pickTaken.layer && !(await selectionHas(fol.page, folOff)), `${folOff}: ${JSON.stringify(folded)}`)
  const folChangeSig = await H.waitFor(async () => channelOf(await hostState(), folKey, `change:${SANDBOX}-mine`), 60_000, 1000)
  const folRecord = folChangeSig ? JSON.parse(await fromHost(folChangeSig)) : null
  check('its published change says whose change it carries', (folRecord?.taken ?? []).some(entry => entry.path === target.path && entry.root === sandboxRoot), JSON.stringify(folRecord?.taken))

  // ── 3g. JEV WEIGHS THE ZONE — where each trial stands, where to focus ────
  await H.watchToasts(page)
  await H.say(page, `module focus @${WRITE}`)
  const weighed = await H.toastsUntil(page, /^Jev weighed |Jev did not weigh|No trials|did not list/, 90_000)
  const passSig = await H.waitFor(async () => channelOf(await hostState(), pubkey, `pass:${HOST}`), 30_000, 1000)
  const pass = passSig ? JSON.parse(await fromHost(passSig)) : null
  const standingOf = name => pass?.trials?.find(t => t.name === name) ?? null
  check('Jev weighs every open trial on the zone — the readings and people\'s assessments — and the pass is published under the publisher\'s key', pass?.kind === 'jev-pass' && pass.zone === HOST && standingOf(SANDBOX)?.standing === 'take' && standingOf(`${SANDBOX}-mine`)?.standing === 'take', JSON.stringify(weighed))
  check('the pass names adoption: whose package another trial took, from the signed change records', standingOf(SANDBOX)?.takenBy?.includes(`${SANDBOX}-mine`) === true && standingOf(`${SANDBOX}-mine`)?.takenBy?.length === 0, JSON.stringify(pass?.trials?.map(t => [t.name, t.takenBy])))
  check('the pass says where to focus first, and the words say where each trial stands', pass?.focus === `${SANDBOX}-mine` && (weighed ?? []).some(m => m.includes(`Focus first on ${SANDBOX}-mine`)) && (weighed ?? []).some(m => m.startsWith(`${SANDBOX}: take`) && m.includes('none of them refused')) && (weighed ?? []).some(m => m.startsWith(`${SANDBOX}-mine: take`) && m.includes('none of them refused')), JSON.stringify(weighed))

  // ── 4. PROMOTE: its own site first, then the live channel ─────────────────
  // jwize 2026-09-24: "try.yoursub.domain.com then when deployed will be on
  // yoursub.domain.com" — with no channel named, the site the trial is named for.
  await H.watchToasts(page)
  await H.say(page, `module promote ${CHANGE} @${WRITE}`)
  const siteToasts = await H.toastsUntil(page, /^Promoted |not stamped|no sandbox/)
  const promotedState = await hostState()
  check('promote with no channel puts the trial on its own site: install:<change> names the sandbox root, its pack beside it, and the live channel does not move', channelOf(promotedState, pubkey, `install:${CHANGE}`) === sandboxRoot && channelOf(promotedState, pubkey, `pack:${CHANGE}`) === channelOf(promotedState, pubkey, `pack:${SANDBOX}`) && channelOf(promotedState, pubkey, 'install:essentials') !== sandboxRoot, JSON.stringify(siteToasts))
  await H.watchToasts(page)
  await H.say(page, `module promote ${CHANGE} essentials @${WRITE}`)
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
  await H.say(page, `module promote ${CHANGE}-off essentials @${WRITE}`)
  await H.toastsUntil(page, /^Promoted |not stamped|no sandbox/)
  const offRoot = await pub.installed()
  const state2 = await hostState()
  check('a unit turned off, committed and promoted is the live root', channelOf(state2, pubkey, 'install:essentials') === offRoot && offRoot !== sandboxRoot, `${offPath}: ${offRoot?.slice(0, 12)}`)
  check('the new root does not reach the unit that was turned off', !(await selectionHas(page, offPath)))
  check('the host still holds every earlier file — unreachable, not deleted', state1.content.every(sig => state2.content.includes(sig)))
  const offTrial = (await trialsOnZone()).find(t => t.name === `${SANDBOX}-off`)
  check('the listing says what a trial turned off', !!offTrial && offTrial.off.includes(offPath), JSON.stringify(offTrial?.off))
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
  check('the zone no longer lists the withdrawn trial', !(await trialsOnZone()).some(t => t.name === SANDBOX))

  await browser.close()
  process.exit(finish() ? 0 : 1)
})().catch(error => { console.error(error); process.exit(1) })
