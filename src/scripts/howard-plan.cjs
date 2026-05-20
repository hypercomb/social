// Build the "howard" support hub via the Hypercomb bridge.
// - Adds tiles non-destructively (uses `add`, not `update`, so existing root cells survive).
// - Attaches descriptive notes to each tile via `note-add`.
//
// Prereqs: bridge server running on :2401 AND dev shell at :4250 with ?claudeBridge=1.
const WebSocket = require('ws')

const BRIDGE = 'ws://localhost:2401'
const TIMEOUT_MS = 10_000

let counter = 0
function nextId() { return `plan-${Date.now()}-${++counter}` }

function send(req) {
  return new Promise((resolve, reject) => {
    const id = nextId()
    const msg = { ...req, id }
    const ws = new WebSocket(BRIDGE)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, TIMEOUT_MS)
    ws.on('open', () => ws.send(JSON.stringify(msg)))
    ws.on('message', (raw) => {
      clearTimeout(timer)
      try { resolve(JSON.parse(String(raw))) } catch { reject(new Error('bad response')) }
      ws.close()
    })
    ws.on('error', (err) => { clearTimeout(timer); reject(err) })
  })
}

async function add(segments, cells) {
  const res = await send({ op: 'add', segments, cells })
  if (!res.ok) throw new Error(`add ${segments.join('/')||'/'} ${cells.join(',')}: ${res.error}`)
  console.log(`  + ${segments.join('/')||'/'} ← ${cells.join(', ')}`)
}

async function note(segments, cell, text) {
  const res = await send({ op: 'note-add', segments, cell, text })
  if (!res.ok) console.warn(`  ! note ${segments.join('/')}/${cell}: ${res.error}`)
}

async function main() {
  console.log('howard support hub — building via bridge')

  // root: just add 'howard' (preserves any other root tiles you already have)
  await add([], ['howard'])
  await note([], 'howard',
    'Recovery hub for Howard. In rehab after fall + COVID. Some progress; weakness, ' +
    'exhaustion, and communication difficulties. Shared room is hurting sleep. Limited ' +
    'tech — needs help keeping phone charged and accessible.')

  // top-level sections
  await add(['howard'], ['status', 'team', 'action-items', 'logistics', 'resources', 'ideas'])

  // status
  await note(['howard'], 'status',
    'Current condition + timeline. Update here after each visit or call so the team ' +
    'has a single source of truth instead of relaying through texts.')

  // team
  await add(['howard', 'team'], [
    'marv', 'rebecca', 'mike', 'amanda', 'ilana', 'jesse', 'jerry', 'susan', 'jaime',
  ])
  await note(['howard'], 'team', 'The support circle. Each tile = one person + their role.')
  await note(['howard', 'team'], 'marv',
    'Close friend in NY. Visiting regularly, advocating with staff. De facto patient advocate today.')
  await note(['howard', 'team'], 'rebecca',
    'Rebecca Van Kessel. Experienced with hospital systems — may help research options + navigate.')
  await note(['howard', 'team'], 'mike',
    'Has house access. Writing checks, visiting every other day.')
  await note(['howard', 'team'], 'amanda',
    'Arranged dog care. Dog is now in PA and appears happy.')
  await note(['howard', 'team'], 'ilana', 'Marv\'s cousin.')
  await note(['howard', 'team'], 'jesse',
    'Will have the conversation with Howard about Power of Attorney + health proxy. ' +
    'Frame: supporting his wishes; he stays in control.')
  await note(['howard', 'team'], 'jerry',
    'Willing to handle financial POA jointly with Susan, if Howard agrees.')
  await note(['howard', 'team'], 'susan',
    'Willing to handle financial POA jointly with Jerry. May visit if Howard improves — ' +
    'will need logistical support, possibly Airbnb.')
  await note(['howard', 'team'], 'jaime',
    'Setting up this Hypercomb hub. Contact info, updates, team coordination.')

  // action items
  await add(['howard', 'action-items'], [
    'power-of-attorney', 'health-proxy', 'financial-poa', 'bills-email', 'documentation-hub',
  ])
  await note(['howard'], 'action-items', 'What needs doing, who owns it, what\'s blocking.')
  await note(['howard', 'action-items'], 'power-of-attorney',
    'Owner: Jesse. Frame as supporting Howard\'s wishes; he keeps control. Pair with health proxy.')
  await note(['howard', 'action-items'], 'health-proxy',
    'Discuss in the same conversation as POA. Identifies who can speak for medical decisions if needed.')
  await note(['howard', 'action-items'], 'financial-poa',
    'Jerry + Susan jointly, pending Howard\'s OK. Unblocks bill-paying without one person carrying it.')
  await note(['howard', 'action-items'], 'bills-email',
    'Howard is stressed about unpaid bills + email access. Triage recurring bills, set up auto-pay, ' +
    'and recover email access (see ideas/email-recovery).')
  await note(['howard', 'action-items'], 'documentation-hub',
    'This site. Owner: Jaime. Keep contact info, updates, action status here.')

  // logistics
  await add(['howard', 'logistics'], [
    'phone-charging', 'room-comfort', 'visit-schedule', 'loretta', 'dog',
  ])
  await note(['howard'], 'logistics', 'Day-to-day support: phone, sleep, visits, dependents.')
  await note(['howard', 'logistics'], 'phone-charging',
    'Limited tech skills. Needs a long charging cable + small bedside organizer so the phone ' +
    'is reachable and charged without him having to fiddle. Marv or Mike can drop off.')
  await note(['howard', 'logistics'], 'room-comfort',
    'Shared room hurting sleep. Eye mask + foam earplugs + a small clip-on fan can help a lot. ' +
    'Worth asking nursing staff what\'s allowed.')
  await note(['howard', 'logistics'], 'visit-schedule',
    'Coordinate so coverage is steady and doesn\'t pile up. Shared calendar (see ideas) keeps Marv, ' +
    'Mike, and any visiting family aligned.')
  await note(['howard', 'logistics'], 'loretta',
    'Care arrangements to be confirmed. Identify her primary contact and verify she\'s stable.')
  await note(['howard', 'logistics'], 'dog',
    'Now in Pennsylvania, appears happy. Amanda arranged. Send Howard a photo update — morale boost.')

  // resources
  await add(['howard', 'resources'], ['board-of-education', 'hospital-research'])
  await note(['howard'], 'resources', 'External support / specialist help.')
  await note(['howard', 'resources'], 'board-of-education',
    'BoE has a retiree support contact. REQUIRES Howard\'s permission before sharing his ' +
    'personal details. Ask first, then connect.')
  await note(['howard', 'resources'], 'hospital-research',
    'Rebecca knows hospital systems. Use her for: navigating discharge planning, understanding ' +
    'rehab options, decoding billing.')

  // ideas
  await add(['howard', 'ideas'], [
    'shared-calendar', 'comfort-kit', 'communication-aid', 'bills-auto-pay',
    'email-recovery', 'weekly-check-in', 'get-well-letters', 'patient-advocate',
  ])
  await note(['howard'], 'ideas', 'Simple ways the team can help. Pick one and run with it.')
  await note(['howard', 'ideas'], 'shared-calendar',
    'Create a Google Calendar shared with Marv, Mike, Susan, Jesse. Each person blocks their visit/call slot. ' +
    'No more "wait, did anyone go yesterday?"')
  await note(['howard', 'ideas'], 'comfort-kit',
    'Drop off: eye mask, foam earplugs, small clip-on fan, lip balm, extra phone cable, charger brick. ' +
    'Total cost ~$30. Marv or Mike on next visit.')
  await note(['howard', 'ideas'], 'communication-aid',
    'When speech is hard: pocket whiteboard + marker, or a text-to-speech app on his phone. ' +
    'Pre-loaded common phrases ("water", "cold", "call my brother") cuts the effort cost.')
  await note(['howard', 'ideas'], 'bills-auto-pay',
    'List recurring bills (utilities, mortgage/rent, insurance, subscriptions). Enable auto-pay or ' +
    'set Mike up to write checks for everything monthly until financial POA is in place.')
  await note(['howard', 'ideas'], 'email-recovery',
    'If email access is the blocker: try password manager export, then recovery-email reset. ' +
    'If Gmail-based, the account recovery flow needs phone access — coordinate with someone in the room.')
  await note(['howard', 'ideas'], 'weekly-check-in',
    '30-min Sunday call, rotating lead. One person summarizes the week, everyone aligns on next ' +
    'priorities. Keeps updates fresh without burning Marv out as the only relay.')
  await note(['howard', 'ideas'], 'get-well-letters',
    'Ask BoE retirees + close friends to send short notes/cards. Familiar names lift morale ' +
    'on hard days, especially when communication is tiring.')
  await note(['howard', 'ideas'], 'patient-advocate',
    'Marv is doing this informally. Formalize: one named advocate per shift/week, with a handoff ' +
    'note (current meds, doctor questions pending, family updates). Avoids dropped context.')

  console.log('done')
}

main().catch(err => { console.error(err); process.exit(1) })
