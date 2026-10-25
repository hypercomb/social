// scripts/drive-permit.cjs
//
// PERMISSION GROUPS, IN THE RUNNING HIVE (documentation/permission-groups.md).
// What runs on arrival is said per conversation, provider or model, by the
// word `permit`, and the Execution queue judges every row by the groups its
// facts pick. Proves, in a fresh browser profile with its own OPFS (never the
// participant's hive):
//
//   - `permit` is a registered behaviour in the spoken census
//   - said as typed (the remote door), `permit` lists everyone and held
//   - a provider put in a group is judged by that group, and the row says so
//   - loosening the group releases its waiting row
//   - dropping holds the provider; only `permit held drop` releases it
//   - the groups are one document in a pool: they survive a reload
//   - everyone is the Execution window's own policy
//   - the old device keys (hc:execution:mode / :auto) are never written
//
//   node scripts/drive-permit.cjs [--url http://localhost:4250/] [--headed]

const H = require('./drive-swarm-connectivity.cjs')

const PROVIDER = `permit-probe-${Date.now().toString(36)}`

async function boot(browser) {
  const ctx = await browser.newContext()
  // The dev server's live-reload client must not reload the page mid-scenario
  // (the source tree is shared with other live sessions).
  await ctx.route('**/@vite/client*', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'export const injectQuery = (url) => url; export const createHotContext = () => ({ accept() {}, dispose() {}, prune() {}, on() {}, send() {}, invalidate() {} }); export function updateStyle() {}; export function removeStyle() {}' }))
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  await page.goto(H.URL_, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(page); await H.installIfNeeded(page, 'P')
  if (!(await H.waitForReady(page))) throw new Error('not ready')
  await H.settle(page)
  return { ctx, page, errors }
}

/** Listen for what the hive says, before saying anything. */
const listen = (page) => H.evalSafe(() => page.evaluate(() => {
  const bus = globalThis.__hypercombEffectBus
  globalThis.__permitHeard = []
  bus.on('activity:log', payload => { if (payload?.message?.startsWith('Permit')) globalThis.__permitHeard.push(payload.message) })
  return !!bus
}))

/** Say a line on the command line the way a session does: the remote door. */
const say = async (page, text) => {
  await H.evalSafe(() => page.evaluate((text) => {
    globalThis.__permitHeard = []
    globalThis.__hypercombEffectBus.emit('command-line:remote-submit', { text })
  }, text))
  const heard = await H.waitFor(() => page.evaluate(() => globalThis.__permitHeard), lines => lines.length > 0, 10000, 250)
  return heard.value ?? []
}

const groups = (page) => H.evalSafe(() => page.evaluate(() => {
  const permit = window.ioc.get('@hypercomb.social/PermitGroups')
  return { reading: permit?.reading, groups: permit?.groups?.() ?? [] }
}))

const ask = (page, kind) => H.evalSafe(() => page.evaluate(({ kind, provider }) => {
  const queue = window.ioc.get('@hypercomb.social/ExecutionQueue')
  const { id } = queue.request({ convoId: 'permit-probe', providerId: provider, model: 'probe-model', kind, lines: ['/probe'], needsGrant: false })
  return id
}, { kind, provider: PROVIDER }))

const row = (page, id) => H.evalSafe(() => page.evaluate((id) => {
  const r = window.ioc.get('@hypercomb.social/ExecutionQueue').requests().find(entry => entry.id === id)
  return r ? { state: r.state, group: r.group, auto: r.auto } : null
}, id))

/** A probe row must never linger as a pending press: skip it, then settle it. */
const clear = (page, id) => H.evalSafe(() => page.evaluate((id) => {
  const queue = window.ioc.get('@hypercomb.social/ExecutionQueue')
  queue.decide(id, 'skip')
  queue.settle(id, 'skipped', 'harness probe')
}, id))

const legacyKeys = (page) => H.evalSafe(() => page.evaluate(() => ({
  mode: localStorage.getItem('hc:execution:mode'), auto: localStorage.getItem('hc:execution:auto'),
})))

;(async () => {
  const la = H.launcherFor('chromium')
  const browser = await la.type.launch({ headless: !H.HEADED, ...la.opts })
  const { page, errors } = await boot(browser)

  const registered = await H.evalSafe(() => page.evaluate(() => ({
    queen: !!window.ioc.get('@diamondcoreprocessor.com/PermitQueenBee'),
    store: !!window.ioc.get('@hypercomb.social/PermitGroups'),
    census: (window.ioc.get('@diamondcoreprocessor.com/SlashBehaviourDrone')?.entries?.() ?? []).some(e => e.name === 'permit'),
  })))
  H.check('permit is registered, with its store, in the spoken census', registered.queen && registered.store && registered.census, JSON.stringify(registered))

  const read = await H.waitFor(() => groups(page), g => g.reading === false, 15000, 250)
  H.check('the groups have been read from the pool', read.ok, JSON.stringify(read.value))

  const before = await legacyKeys(page)
  await listen(page)

  const listed = await say(page, 'permit')
  H.check('said as typed, permit lists everyone first and held', /^Permit — everyone: /.test(listed[0] ?? '') && listed.some(l => l.startsWith('Permit — held: nothing runs by itself')), JSON.stringify(listed))

  const added = await say(page, `permit hermes add provider ${PROVIDER}`)
  H.check('a provider joins a new group, which starts manual', (added[0] ?? '').startsWith(`Permit — hermes: nothing runs by itself · provider ${PROVIDER}`), JSON.stringify(added))

  const waiting = await ask(page, 'additive')
  const w = await row(page, waiting)
  H.check('its change waits, judged by hermes', w?.state === 'waiting' && w?.group === 'hermes', JSON.stringify(w))

  await say(page, 'permit hermes read additive')
  const released = await H.waitFor(() => row(page, waiting), r => r?.state === 'running', 5000, 200)
  H.check('loosening the group releases its waiting row', released.ok, JSON.stringify(released.value))
  await clear(page, waiting)

  const other = await H.evalSafe(() => page.evaluate(() => {
    const queue = window.ioc.get('@hypercomb.social/ExecutionQueue')
    const { id } = queue.request({ convoId: 'permit-probe', providerId: 'some-other-provider', model: 'x', kind: 'additive', lines: ['/probe'], needsGrant: false })
    return { id, mode: queue.mode(), row: queue.requests().find(entry => entry.id === id) }
  }))
  H.check('anyone else is still judged by everyone', other.row?.group === 'everyone', JSON.stringify({ group: other.row?.group, state: other.row?.state, mode: other.mode }))
  if (other.row?.state === 'waiting') await clear(page, other.id)

  const held = await say(page, `permit hermes drop ${PROVIDER}`)
  const h = await ask(page, 'read')
  const hr = await row(page, h)
  H.check('a dropped provider is held: even its read waits', /is held/.test(held[0] ?? '') && hr?.state === 'waiting' && hr?.group === 'held', JSON.stringify({ held, hr }))
  await clear(page, h)

  const refused = await say(page, `permit other add provider ${PROVIDER}`)
  H.check('adding it elsewhere does not release it', /is held; permit held drop/.test(refused[0] ?? ''), JSON.stringify(refused))

  await say(page, `permit hermes add model probe-model`)
  await say(page, 'permit hermes read')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await H.waitForShell(page)
  if (!(await H.waitForReady(page))) throw new Error('not ready after reload')
  const after = await H.waitFor(() => groups(page), g => g.reading === false, 15000, 250)
  const hermes = after.value?.groups?.find(g => g.name === 'hermes')
  const heldGroup = after.value?.groups?.find(g => g.name === 'held')
  H.check('the groups survive a reload, as one document in a pool',
    hermes?.mode === 'auto' && JSON.stringify(hermes?.auto) === '["read"]'
      && hermes?.members?.some(m => m.facet === 'model' && m.label === 'probe-model')
      && heldGroup?.members?.some(m => m.facet === 'provider' && m.label === PROVIDER),
    JSON.stringify({ hermes, held: heldGroup }))

  await listen(page)
  const released2 = await say(page, `permit held drop ${PROVIDER}`)
  H.check('only permit held drop releases it', /released; it runs as everyone again/.test(released2[0] ?? ''), JSON.stringify(released2))
  await say(page, 'permit hermes dissolve')
  await say(page, `permit held drop probe-model`)

  const policy = await H.evalSafe(() => page.evaluate(() => {
    const queue = window.ioc.get('@hypercomb.social/ExecutionQueue')
    const permit = window.ioc.get('@hypercomb.social/PermitGroups')
    const everyone = permit.group('everyone')
    return { mode: queue.mode(), auto: queue.autoKinds(), everyone: { mode: everyone.mode, auto: everyone.auto } }
  }))
  H.check('everyone is the Execution window\'s own policy', policy.mode === policy.everyone.mode && JSON.stringify(policy.auto) === JSON.stringify(policy.everyone.auto), JSON.stringify(policy))

  const afterKeys = await legacyKeys(page)
  H.check('the old device keys were never written', JSON.stringify(before) === JSON.stringify(afterKeys), JSON.stringify({ before, after: afterKeys }))

  H.check('no page errors', errors.length === 0, JSON.stringify(errors))

  console.log('\n========== permission groups ==========')
  for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
  if (!H.KEEP) await browser.close()
  process.exit(H.results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
