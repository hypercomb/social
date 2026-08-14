// Revolución — THE TRADE ARM.
// Models Revolución's future aspiration as an INDEPENDENT North American
// wholesaler (multi-brand, unowned — explicitly NOT a house/factory arm)
// as a branch under /revolucion.
//
// Idempotent: ensureChild appends by NAME (never sigs — see the bag-set
// husk-tile incident), notes dedupe by FIRST LINE, marks dedupe against the
// tile's existing tag decorations.
//
// Usage:
//   node scripts/bridge/_rev-wholesale-build.cjs --dry
//   node scripts/bridge/_rev-wholesale-build.cjs
const WebSocket = require('ws')

const BRIDGE = 'ws://localhost:2401'
const DRY = process.argv.includes('--dry')
const ROOT = 'revolucion'
const BRANCH = 'wholesale'
const COLLECTION_MARK = 'wholesale'
const PART_MARK = 'part'

let n = 0
function call(req, timeout = 40000) {
  return new Promise((resolve, reject) => {
    const id = `trade-${Date.now()}-${++n}`
    const ws = new WebSocket(BRIDGE)
    const t = setTimeout(() => { ws.close(); reject(new Error('timeout ' + req.op)) }, timeout)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
    ws.on('message', (raw) => { clearTimeout(t); try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) }; ws.close() })
    ws.on('error', (e) => { clearTimeout(t); reject(e) })
  })
}

async function ask(req, attempts = 4) {
  let wait = 1200
  for (let i = 0; i < attempts; i++) {
    try { const r = await call(req); if (r.ok || r.error !== 'no renderer connected') return r }
    catch (e) { if (i === attempts - 1) return { ok: false, error: e.message } }
    await new Promise(r => setTimeout(r, wait)); wait = Math.min(wait * 1.7, 20000)
  }
  return { ok: false, error: 'renderer never came back' }
}

// ── guard: never write into the wrong hive ────────────────────────────
async function assertRightHive() {
  const root = await ask({ op: 'layer-at', segments: [] })
  if (!root.ok) throw new Error('cannot read hive root: ' + root.error)
  const names = []
  for (const sig of (root.data?.children || []).map(String)) {
    const r = await ask({ op: 'get-resource', sig })
    if (r.ok) { try { const nm = JSON.parse(r.data.text).name; if (nm) names.push(nm) } catch {} }
  }
  if (!names.includes(ROOT)) {
    throw new Error('WRONG HIVE — no /' + ROOT + ' at root.\n  root: ' + names.join(', '))
  }
}

async function childNames(segments) {
  const layer = await ask({ op: 'layer-at', segments })
  if (!layer.ok) return null
  const names = []
  for (const sig of (layer.data?.children || []).map(String)) {
    const r = await ask({ op: 'get-resource', sig })
    if (r.ok) { try { const nm = JSON.parse(r.data.text).name; if (nm) names.push(nm) } catch {} }
  }
  return names
}

async function ensureChild(segments) {
  const parent = segments.slice(0, -1), name = segments[segments.length - 1]
  const have = await childNames(parent)
  if (have === null) {
    // In a dry run the parent legitimately does not exist yet — report the
    // whole plan rather than stopping at the first unbuilt level.
    if (DRY) return 'would-create'
    throw new Error('no parent layer at /' + parent.join('/'))
  }
  if (have.includes(name)) return 'present'
  if (DRY) return 'would-create'
  const u = await ask({
    op: 'update', segments: parent,
    layer: { name: parent[parent.length - 1] || ROOT, children: [...have, name] },
  })
  return u.ok ? 'created' : 'ERR ' + u.error
}

async function noted(segments, text) {
  const first = text.split('\n')[0].trim()
  const r = await ask({ op: 'note-list', segments })
  const d = r.ok ? r.data : []
  const items = Array.isArray(d) ? d : (Array.isArray(d?.notes) ? d.notes : [])
  if (items.some(x => String(x?.text || '').split('\n')[0].trim() === first)) return 'present'
  if (DRY) return 'would-note'
  const a = await ask({
    op: 'note-add', segments: segments.slice(0, -1),
    cell: segments[segments.length - 1], text,
  })
  return a.ok ? 'noted' : 'ERR ' + a.error
}

async function mark(segments, name) {
  const layer = await ask({ op: 'layer-at', segments })
  if (layer.ok) {
    for (const sig of (layer.data?.decorations || []).map(String)) {
      const r = await ask({ op: 'get-resource', sig })
      if (!r.ok || r.data?.encoding !== 'text') continue
      try {
        const j = JSON.parse(r.data.text)
        if (j.kind === 'tag' && String(j.payload?.name ?? j.name) === name) return 'present'
      } catch {}
    }
  }
  if (DRY) return 'would-mark'
  const r = await ask({ op: 'decoration-add', segments, kind: 'tag', appliesTo: [], payload: { name } })
  return r.ok ? 'marked' : 'ERR ' + r.error
}

// ══════════════════════════════════════════════════════════════════════
// THE MODEL
// ══════════════════════════════════════════════════════════════════════

const ROOT_NOTE_SHORT =
`The trade arm — Revolución as an INDEPENDENT North American wholesaler. Independent means multi-brand and unowned: we carry other makers' lines and answer to no factory. A house arm moves what its factory made; we move what the moment asks for. The journal is the buying desk.`

const ROOT_NOTE_FORK =
`THE FORK — decide this before anything below is costed.

The manifesto's first line is "we do not sell cigars — the cigar is the medium, the moment is the product." A wholesaler sells cigars. Both hold only if the sentence is read exactly: we do not sell cigars TO SMOKERS. The trade arm sells to the TRADE — tobacconists, lounges, clubs — and what it sells them is not inventory, it is placement: the right boxes on the right shelf, because the journal already knows what that shelf's people live.

Three shapes this aspiration can take, and they are not the same company:

  (a) REVOLUCIÓN IS THE WHOLESALER. It holds the import permit, the humidified warehouse, the accounts and the working capital. The journal is an advantage no other distributor has. Capital-heavy, slow, defensible, and the only version where the shelf is actually ours.

  (b) REVOLUCIÓN SERVES THE WHOLESALERS. It stays a platform, sells nobody a box, and licenses the demand signal to the distributors who already own the trucks. Capital-light, faster, and dependent on incumbents who may build a worse version themselves rather than pay for a better one.

  (c) BOTH, STAGED — (b) funds (a). The signal earns its first revenue from people who already have the logistics; the logistics get bought once the signal is proven and the maker relationships exist.

Every tile in this branch is written so it holds under (a). Under (b), compliance, logistics and working-capital fall away entirely and the allocation branch becomes the whole business. This one answer decides whether this is a capital company or a software company — nothing below is worth costing until it is settled.`

// Each entry: [name, note, [ [childName, childNote], … ] ]
const MODEL = [
  ['the-independent-case',
`Why independent is the thesis, not a detail of the cap table. A distributor owned by a factory has exactly one job — move that factory's production — so its portfolio is an accident of ownership and its recommendation is never disinterested. Every retailer knows this and discounts the pitch accordingly. An independent buys from many and owes none, which makes its shelf an OPINION; an opinion can be trusted, argued with, and followed. Revolución's opinion is not a buyer's palate. It is what people actually lived, aggregated — the only kind of opinion that scales without turning into a marketing deck.`,
    [
      ['what-a-house-arm-cannot-do',
`It cannot say "not this one." A factory-owned distributor can never tell a retailer that this year's release is weaker than last year's, that the box is priced above what that shelf will carry, or that the store already has three cigars sitting in exactly that seat. Those four sentences are most of the value a good rep brings, and ownership forbids all of them.`],
      ['curation-is-the-product',
`A tobacconist's scarcest asset is not cash, it is FACING — the linear feet of humidor a customer's eye actually crosses. Every box we place spends someone else's shelf. So the thing we sell is not the box, it is the judgement that this box deserves that foot. Charged for honestly, that judgement is worth more than the margin on the goods.`],
      ['the-journal-is-the-buying-desk',
`Every distributor in the trade buys on sell-through — what moved last quarter, in units, with no idea why. Sell-through is a rear-view mirror and it cannot tell a cigar people loved from a cigar people settled for. The journal records the occasion, the company, the mood and the flavour that was actually met, so buying from it is buying from the demand rather than from its shadow. This is the one asset an incumbent cannot copy without first spending a decade earning the trust that produces it.`],
      ['who-we-compete-with',
`Four kinds of incumbent, each with a structural weakness: the FACTORY ARMS (deep pockets, one portfolio, no credibility when they praise it), the BROADLINERS (everything in the catalogue, therefore an opinion about nothing, competing on terms alone), the REGIONAL INDEPENDENTS (real relationships, thin data, and a succession problem), and the MAKERS SELLING DIRECT (best margin, worst service, and they train retailers to distrust the whole channel). We will not be cheaper than any of them. We are the only one who can say WHY and be believed. VERIFY before this tile informs a decision: name the actual players, their territories and their lines.`],
    ]],

  ['portfolio',
`The lines we carry, and the discipline of the list. A portfolio is defined as much by what it refuses as by what it holds — a distributor who carries everything has told the retailer nothing. Working rule: every line on the list must be defensible in one sentence to a buyer who is short on money and shorter on shelf.`,
    [
      ['how-a-line-earns-a-slot',
`Four gates, in order. (1) Is there a moment it serves that nothing already on the list serves — the journal answers this, not the buyer's palate. (2) Can the maker supply it consistently for two years. (3) Does the price leave the retailer real margin at a defensible MSRP. (4) Would we hand it to a newcomer without a warning. A line that fails gate one is a duplicate no matter how good it tastes.`],
      ['boutique-first',
`Small makers need distribution more than large ones and have fewer places to go, which is precisely where an independent's leverage is: better terms, real loyalty, and first call on the interesting production. The large houses come later and on worse terms — that is the correct order, not a consolation prize.`],
      ['regional-exclusives',
`A maker granting one distributor a territory is the oldest instrument in the trade and the only real moat a wholesaler has. Exclusivity is worth carrying inventory risk for. Exclusivity we cannot SERVICE — a territory with no rep in it — is a liability that invites the maker to take it back and tells every retailer in that territory that we over-promise.`],
      ['the-shelf-we-refuse',
`Written down before there is money on the table, because afterwards it is only a preference. We do not carry: a line whose maker sells direct below our own accounts' MSRP; anything we would have to warn a newcomer about and then sell to them anyway; a line we cannot keep in depth. Infused and flavoured cigars are a stated preference, not a virtue — say so plainly rather than dressing a taste up as a principle. See covenants.`],
      ['depth-over-breadth',
`Twenty lines carried properly beat eighty carried nominally. Depth means every vitola in stock, the rep knows the blend, and the reorder ships the same week. A line we cannot keep deep belongs on special order, not on the listing — a hole in the middle of a display costs the retailer more trust than the line ever earned us.`],
    ]],

  ['supply',
`The makers' side of the desk. A wholesaler is a promise made in two directions at once: to the retailer that the box will be there, and to the maker that the production will be taken. This branch is about keeping the second promise, which is the only reason the first one is possible. Distinct from /revolucion/collaborations/makers, which is the insight relationship — this is the commercial one.`,
    [
      ['factory-relationships',
`The relationship that matters is with the floor, not the sales office: who actually rolls the line, what the capacity is, what else they roll and for whom, and how they behave when a crop comes in badly. VERIFY per partner rather than assuming — the origins that carry premium production (Estelí and Danlí, Santiago and the Cibao, San Andrés for wrapper leaf) matter only as far as our own lines actually come from them.`],
      ['territory-exclusivity',
`What to get in writing: the territory, the term, the minimum we commit to, what happens on a missed minimum, and whether the maker may sell direct to consumers inside our territory. That last clause is the one that kills distributors and it is usually the one nobody reads. Ask for right of first refusal on limited production in-territory.`],
      ['allocation-from-the-maker',
`Scarce lines are allocated to distributors long before they are allocated to retailers, and the allocation follows relationship, order history and payment behaviour — in that order. Paying early, every time, buys more allocation than any marketing spend of the same size. Treat early payment as a line item in the marketing budget, because that is what it is.`],
      ['small-batch-partners',
`Makers too small to support a national rollout, carried deliberately at a size that cannot scale. They are how the list stays interesting and how the journal finds moments nobody has named yet. Budget them as marketing rather than as margin and the decisions become easy — including the decision to keep one that will never pay for itself.`],
    ]],

  ['accounts',
`Who we sell to. Every account is a shelf with a personality, and the journal is the only instrument in the trade that can describe that personality before the rep walks through the door. The account list is not a CRM — it is a map of rooms and of the people who sit in them.`,
    [
      ['tobacconists',
`The brick-and-mortar shop is the foundation of the premium trade and its most fragile part: rent, a slow-turning humidor, and an owner who is also the buyer, the rep and the closer. What they need from a distributor is not more choice, it is fewer and better decisions. A rep who removes a line from their shelf and is right about it earns more than one who adds three.`],
      ['lounges-and-clubs',
`A lounge sells the hour, not the cigar — which makes it the account most aligned with Revolución's whole premise. They buy differently: fewer boxes, faster turn, heavier weighting toward what suits sitting for two hours with company. The journal's occasion and company data maps onto this account type more directly than onto any other.`],
      ['online-accounts',
`Highest volume, thinnest relationship, and the account type most able to damage every other one through price. Carry them under enforceable terms or not at all — see minimum-advertised-price. An online account that discounts a limited release into the ground has spent the goodwill of every brick-and-mortar shop we sell.`],
      ['account-tiers',
`Tiers exist to make allocation and terms explainable, not to reward size alone. Suggested axes: volume, payment behaviour, depth of the lines carried, and whether the shop actually sells the story or just stocks the box. A small shop that hand-sells a boutique line deserves better allocation than a large one that buries it — and the tier structure has to be able to say so out loud.`],
      ['opening-an-account',
`What is required before the first box ships: licence and resale documentation verified, age-gating confirmed at the point of sale, terms agreed in writing, MAP acknowledged, and an opening order that is deep enough to actually appear on the shelf. A first order too small to be seen sets the line up to fail and then blames the line.`],
    ]],

  ['territories',
`North America is three regulatory countries, not one market. Nothing about a line's viability transfers across the borders — packaging, promotion, tax and even what may be said out loud all change. Territory planning is therefore compliance planning wearing a map.`,
    [
      ['united-states',
`The core market and the most fragmented one: federal import and excise on one axis, fifty state licensing and other-tobacco-products tax regimes on the other, plus local flavour bans and indoor-use rules that decide whether lounges can exist at all. Plan state by state, never nationally. VERIFY the current federal position on premium cigars specifically before costing anything — it has moved through litigation in recent years and any number written from memory is a liability.`],
      ['canada',
`A different business wearing the same product. Federal law restricts promotion severely and standardised/plain packaging requirements apply to tobacco products; provinces add display bans, and provincial tobacco taxes are heavy and vary widely. The practical consequence: brand-building as practised in the US is largely unavailable, so the shelf and the staff carry all of it — which is an argument FOR a distributor whose whole value is what the staff can be taught. VERIFY current federal and provincial requirements before committing.`],
      ['mexico',
`Supply-side before demand-side: San Andrés wrapper matters to what we carry far more than the Mexican retail market matters to what we sell. Treat it as an origin relationship first, and revisit it as a territory only if a specific account base appears.`],
      ['coverage-and-reps',
`A territory without a rep in it is not a territory, it is a claim. Coverage is the constraint that decides how fast the map can grow: exclusivity we cannot service invites the maker to take it back, and accounts that see a rep twice a year buy like accounts that have no rep at all. Grow the map at the speed of people, not at the speed of ambition.`],
    ]],

  ['compliance',
`The gate everything else waits behind. In this trade compliance is not overhead attached to the business — it IS the business's shape: it decides what may be imported, what may be said, who may be sold to, and what the landed cost actually is. This branch is deliberately written as questions to be verified rather than answers to be trusted, because tobacco regulation moves and a confidently stale number is worse here than an admitted gap.`,
    [
      ['import-permit-and-excise',
`An importer of tobacco products into the US operates under federal permit and pays federal excise on import; large cigars are taxed on a percentage-of-price basis with a per-cigar cap. That cap and rate are the single biggest input to landed cost and therefore to every price in this branch. VERIFY the current permit requirements and the current rate and cap with the federal authority directly — do not carry a number here from memory or from a trade article.`],
      ['state-licensing',
`Most states require a distributor or wholesaler licence, collect their own other-tobacco-products tax, and differ on who remits it and on what base. This is the largest hidden fixed cost of a national footprint and the most common reason a plan that pencils at the federal level fails at the state level. Build the state matrix once, properly, and treat it as the real map of where we can sell.`],
      ['age-verification',
`Age-restricted at every step, and the obligation does not stop at our own door: we are also relying on the account to gate its own sales. Verify it at onboarding, restate it in the terms, and understand which shipping and reporting rules attach to which product categories before assuming any of them do or do not apply to premium cigars. The hive already marks /revolucion with the eighteen-plus pheromone; this is the operational side of that mark.`],
      ['packaging-and-warnings',
`Health warnings, packaging format and what may appear on a box or in a promotion vary by country and, in Canada, are prescriptive down to the appearance of the pack. A line that cannot be packaged legally for a territory cannot be sold there regardless of demand — so packaging feasibility belongs at gate two of how-a-line-earns-a-slot, not at the end of the process.`],
      ['what-must-be-verified',
`The standing list, kept here so no tile in this branch has to pretend to be current: federal permit requirements and excise rate/cap; the current federal regulatory position on premium cigars specifically; the state licensing and tax matrix; shipping and reporting rules by product category; Canadian federal packaging and promotion rules plus provincial display and tax rules; local flavour and indoor-use ordinances in target metros. Each of these should become its own dated answer on this tile — the model is only as good as the day these were last checked.`],
    ]],

  ['logistics',
`Cigars are agricultural, hygroscopic and alive with things that eat them. Logistics in this trade is climate control with paperwork attached, and it is where an inattentive distributor destroys inventory it has already paid for. Everything here is a cost of goods that never appears on the invoice.`,
    [
      ['customs-and-clearance',
`Clearance is a timing problem more than a cost problem: product sitting in an uncontrolled environment while paperwork resolves is product degrading. Broker relationships, complete documentation up front, and a warehouse ready to receive on the day are what turn a two-week exposure into a two-day one.`],
      ['the-humidified-warehouse',
`The building is the product's second factory. Stable humidity and temperature across the whole floor — not just an average across it — plus rotation so nothing sits in a corner unmonitored. Cigars held well appreciate in quality; cigars held badly become a write-off that still occupies the shelf it was bought for.`],
      ['beetle-protocol',
`Tobacco beetle is the risk that can cost an entire warehouse, and it arrives inside product that looked fine. Controlled freezing of incoming stock, quarantine of new receipts, monitoring, and a written response for a confirmed find — including notifying accounts that received from the same lot. The notification is the part that gets skipped and the part that decides whether the relationship survives.`],
      ['freight-and-season',
`Summer heat and winter cold both damage product in transit, so the shipping calendar is part of the buying calendar. Seasonal holds, insulated packing and a stated policy on when we will NOT ship are cheaper than replacing what arrives ruined — and a distributor who refuses to ship into a heatwave is trusted more, not less.`],
      ['fulfillment-and-returns',
`Pick accuracy and reorder speed are what an account actually experiences of us between rep visits — for most accounts, most of the time, we ARE the fulfilment. Returns policy should be generous on our failures and firm on buyer's remorse, and the difference has to be legible to the account before they need it.`],
    ]],

  ['pricing',
`Price in this trade is a structure, not a number: what the maker charges, what we charge, what the retailer must be able to make, and what the smoker will pay all have to hold simultaneously. Break any one of them and the line dies at whichever step was squeezed.`,
    [
      ['wholesale-tiers',
`The structure to model, per line: maker cost, landed cost including duty, excise and freight, our price to the account, and the MSRP the account can defend. VERIFY the customary distributor and retail margins in the premium segment against real invoices rather than assuming a convention — the conventional split is quoted often and matched rarely.`],
      ['minimum-advertised-price',
`MAP is what protects the brick-and-mortar shop from being used as a showroom for an online account, and it is the single policy that decides whether serious retailers will carry us. It must be written, uniform, and enforced against a large account the first time it is broken, publicly enough that the second account never tries. An unenforced MAP is worse than none, because it teaches every account exactly what our word is worth.`],
      ['terms-and-credit',
`Terms are a credit product we are issuing whether or not we think of it that way. Set opening terms conservatively, extend them on behaviour rather than on volume, and hold the line on a slow payer early — a distributor's cash is trapped in inventory and receivables at the same moment, which is how businesses with good margins still fail.`],
      ['programs-and-deals',
`Deals should buy something specific: a display, an event, a staff training, a first order deep enough to be visible. A discount that buys nothing but volume trains the account to wait for the next discount and devalues the line for every account that paid full price. Never let a program become the reason a shop stocks something the journal says its people do not want.`],
    ]],

  ['allocation',
`Where the journal stops being a story and becomes an operating advantage. Allocation is the decision of which boxes go to which shelf — the decision every distributor makes weekly, on almost no information, and the one place where knowing what people actually lived is worth immediate money.`,
    [
      ['the-demand-signal',
`What the journal knows that sell-through cannot: the occasion, the company, the mood, the weather, the drink and the flavour that was actually met — for real evenings, in aggregate, by region. That converts into a buying position ("this metro lives long reflective evenings with dark spirits and there is nothing on its shelves built for that") which is a specific box in a specific shop. Consent-first and aggregated, exactly as the manifesto's fourth article requires: insight flows back, never sideways, and no individual journal is ever sold, to anyone, including to ourselves as a buying department.`],
      ['placing-a-limited-release',
`Scarcity is the sharpest tool a distributor holds and the easiest one to spend badly. Placement should follow the shelf's people rather than the account's size — a hundred boxes into the shops whose customers actually live that cigar produces sell-through, stories and reorders; the same hundred spread evenly produces dusty boxes and a maker who blames us for a soft launch.`],
      ['no-forced-bundles',
`The trade's standard move for clearing a slow line is to attach it to an allocated one. It works, once, and it is a tax the account pays for a mistake we made in buying. We eat our own buying errors — that policy is worth more in credibility than the write-off costs, and it is the single most quotable difference between us and a broadliner.`],
    ]],

  ['trade-programs',
`What the account gets that is not boxes. In a category where advertising is restricted almost everywhere, the staff behind the counter IS the marketing — so equipping that person is not a nice-to-have, it is the only distribution channel for meaning that the law leaves open.`,
    [
      ['staff-education',
`The flavour wheel already built at /revolucion/flavor-wheel is a training instrument as much as a consumer toy: a shared vocabulary a shop's staff can use to move a customer from "something medium" to the cigar that actually fits the evening they described. A distributor who teaches a counter to ask about the occasion instead of the strength changes what that shop can sell — and does it with an asset we already own.`],
      ['events-and-samplings',
`An evening in the shop is where the journal and the trade arm meet in the same room: people live a moment, the shop sells the hour, and the entries that come out of it are the demand signal for the next buy. Run them for the account's benefit and the data follows; run them for the data and both fail.`],
      ['point-of-sale',
`Whatever may legally be placed in the shop has to earn its facing exactly as a box does. Prefer things that help the staff have the conversation — a wheel card, an occasion prompt, a shelf-talker that says what the cigar is FOR — over anything that just says a brand name louder.`],
      ['the-trade-show',
`The industry's annual gathering is where lines are picked up, territories are argued over and relationships are made or lost in four days. Go with a specific list of makers to sign and accounts to see, and treat the badge as the smallest cost of the trip. VERIFY current dates, venue and the terms of exhibiting before budgeting it.`],
    ]],

  ['economics',
`Whether this works as a business, in the terms a wholesaler is actually judged by. A distributor lives or dies on turns and on the discipline of its buying, not on gross margin — and margins in the premium trade look far healthier than the cash position they produce.`,
    [
      ['unit-economics',
`Model per box, not per cigar, and land every real cost in it: maker price, duty, federal excise, state tax, freight in, warehousing, freight out, the rep's time, and the cost of the money that sat in it while it waited. VERIFY every rate against a live source. The output is a single number worth knowing by heart — the contribution per box — because it is what every buying and allocation decision is really being weighed against.`],
      ['inventory-turns',
`The metric that decides everything. Premium inventory turns slowly, and slow turns plus generous terms is the exact shape of a business that is profitable on paper and insolvent in the bank. Track turns by line and cut the tail without sentiment — a line that will not turn is occupying our shelf as surely as it occupies the retailer's.`],
      ['working-capital',
`Cash is trapped in two places at once: boxes in the warehouse and invoices out with accounts. Growth makes both larger before it makes either liquid, so growth is the thing most likely to kill this business. Know the peak funding requirement before signing the first exclusive, because an exclusive with a minimum is a commitment to hold inventory whether or not it sells.`],
      ['what-good-looks-like',
`The targets, set deliberately rather than absorbed from the trade: turns per line per year, contribution per box, accounts per rep, the share of the list that is exclusive, the share of revenue from the top five accounts, and days sales outstanding. Fill these with real numbers once the fork on the root tile is decided — under shape (b) most of them do not apply at all.`],
    ]],

  ['covenants',
`What the trade arm will never do, written now while it costs nothing, so it can be pointed at later when it costs something. The manifesto has a list like this and it is the reason the rest of it is believed; a distributor needs one more than a platform does, because a distributor is trusted with someone else's shelf.`,
    [
      ['no-house-brand',
`We do not launch our own line. Every distributor eventually can — the factory relationships exist, the margin is better, and the shelf is already ours — and it is the exact moment the portfolio stops being an opinion and becomes an interest. The whole thesis of the-independent-case is that our recommendation is disinterested; a house brand ends that permanently and no disclosure repairs it.`],
      ['no-forced-inventory',
`We never attach a slow line to an allocated one, and we never ship an account something it did not order. Our buying mistakes are ours to eat.`],
      ['the-retailer-is-not-the-product',
`We do not sell account data, sell-through reports or shelf intelligence about our retailers to makers or to anyone else. What flows back to makers is aggregated consumer insight under the manifesto's fourth article — never a picture of a particular shop's business, which is theirs.`],
      ['no-individual-journal-ever',
`Unchanged from the manifesto and restated here because the trade arm is where the pressure to break it will actually arrive: a maker or an account will eventually offer real money for names. The answer is no, in every shape it is asked, including aggregates thin enough to identify a person.`],
    ]],
]

// ══════════════════════════════════════════════════════════════════════

async function main() {
  console.log(DRY ? '── DRY RUN ──' : '── BUILDING ──')
  await assertRightHive()
  console.log('hive: ok (/' + ROOT + ' present)')

  const base = [ROOT, BRANCH]
  console.log(`\n/${base.join('/')}  ${await ensureChild(base)}`)
  console.log(`  note(short)  ${await noted(base, ROOT_NOTE_SHORT)}`)
  console.log(`  note(fork)   ${await noted(base, ROOT_NOTE_FORK)}`)
  console.log(`  mark         ${await mark(base, COLLECTION_MARK)}`)
  console.log(`  mark         ${await mark(base, 'cigars')}`)

  let tiles = 1, notes = 2
  for (const [branch, branchNote, children] of MODEL) {
    const bSeg = [...base, branch]
    const c = await ensureChild(bSeg); tiles++
    const nres = await noted(bSeg, branchNote); notes++
    const m1 = await mark(bSeg, COLLECTION_MARK)
    const m2 = await mark(bSeg, PART_MARK)
    console.log(`\n/${branch}  ${c} · ${nres} · ${m1}/${m2}`)
    for (const [leaf, leafNote] of children) {
      const lSeg = [...bSeg, leaf]
      const lc = await ensureChild(lSeg); tiles++
      const ln = await noted(lSeg, leafNote); notes++
      const lm = await mark(lSeg, PART_MARK)
      console.log(`   ${leaf.padEnd(30)} ${lc} · ${ln} · ${lm}`)
    }
  }
  console.log(`\n── ${tiles} tiles · ${notes} notes ──`)
}

main().catch(e => { console.error('FAILED', e.message); process.exit(1) })
