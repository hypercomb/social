// Moose on the Loose — first pass.
//
//   node scripts/bridge/_moose-build.cjs [--dry]
//
// Mirrors the Miro board "Public Moose on the Loose" (12 DIRECT CONFLICT
// sections on Mark Carney) into the hive, alongside the register of companies
// the board names and the raw board captures used as evidence.
//
// Everything is idempotent: structure via `update` (children merged, never
// replaced), notes gated on their own first line, pheromones are `tag`
// decorations whose payload IS their identity (append-or-noop by sig).
//
// Shape:
//   moose-on-the-loose
//     people/mark-carney/conflicts-of-interest/<12>
//     companies/<24>
//     miro-board/<5 captures>

const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const PICTURES = 'C:\\Users\\Jaime\\Pictures\\MooseOnTheLoose'
const ROOT = 'moose-on-the-loose'
const DRY = process.argv.includes('--dry')

let counter = 0
function send(req) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE, { maxPayload: 64 * 1024 * 1024 })
    const t = setTimeout(() => { try { ws.close() } catch {} ; reject(new Error('bridge timeout')) }, 40_000)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id: `moose-${Date.now()}-${++counter}` })))
    ws.on('message', raw => {
      clearTimeout(t)
      try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) }
      try { ws.close() } catch {}
    })
    ws.on('error', e => { clearTimeout(t); reject(e) })
  })
}

async function ask(req, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await send(req)
      if (r.ok || r.error !== 'no renderer connected') return r
    } catch (e) { if (i === attempts - 1) throw e }
    await new Promise(r => setTimeout(r, 1500))
  }
  return { ok: false, error: 'renderer never connected' }
}

// ── read helpers ──────────────────────────────────────────────────────

// Child reads and child creation come from ONE implementation, shared with
// every other bridge script: scripts/lib/hive-children.mjs. It carries the
// trap this file fell into (a child sig is a LAYER sig, not a resource) and
// the two rules that retire it. Bound to this file's own `ask` client, which
// already retries past a renderer that has not attached yet.
let childNamesOf, cellExists, ensureChildren
async function bindHiveHelpers() {
  const { hiveChildren } = await import('../lib/hive-children.mjs')
  ;({ childNamesOf, cellExists, ensureChildren } = hiveChildren(ask))
}

async function noteFirstLines(segments) {
  const res = await ask({ op: 'note-list', segments })
  const data = res.ok ? res.data : []
  const items = Array.isArray(data) ? data : (Array.isArray(data && data.notes) ? data.notes : [])
  return items.map(n => String((n && n.text) || '').split('\n')[0].trim())
}

async function currentProps(segments) {
  const layer = await ask({ op: 'layer-at', segments })
  const sig = (layer.ok && Array.isArray(layer.data.properties)) ? String(layer.data.properties[0] || '') : ''
  if (!/^[a-f0-9]{64}$/.test(sig)) return {}
  const res = await ask({ op: 'get-resource', sig })
  if (!res.ok) return {}
  try {
    const parsed = JSON.parse(res.data.text)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}

// ── write helpers ─────────────────────────────────────────────────────

/** Append-only child creation (shared module) + this script's logging. */
async function ensureCells(parent, wanted) {
  const r = await ensureChildren(parent, wanted, { dry: DRY })
  const path = `/${parent.join('/') || '(root)'}`
  if (!r.missing.length) { log(`  = ${path} (all ${wanted.length} present)`); return }
  if (DRY) { log(`  + ${path} would add ${r.missing.join(', ')}`); return }
  const shown = r.missing.slice(0, 4).join(', ') + (r.missing.length > 4 ? '\u2026' : '')
  log(`  ${r.ok ? '+' : '!'} ${path} <- ${r.added} new (${shown})${r.ok ? '' : ' ' + r.error}`)
  if (!r.ok) process.exit(1)
}

/** Add a note unless one with the same first line already sits on the cell. */
async function ensureNote(parentSegments, cell, text) {
  const segments = [...parentSegments, cell]
  const first = text.split('\n')[0].trim()
  const have = await noteFirstLines(segments)
  if (have.includes(first)) return 'present'
  if (DRY) return 'would-add'
  const r = await ask({ op: 'note-add', segments: parentSegments, cell, text })
  return r.ok ? 'added' : 'ERR ' + r.error
}

/** Pheromone. `appliesTo: []` so the payload is the identity — same keyword,
 *  same sig, on every tile. Never `replaceKind`: kind is `tag` for all of them. */
async function paint(segments, names) {
  if (DRY) return
  for (const name of names) {
    const r = await ask({ op: 'decoration-add', segments, kind: 'tag', appliesTo: [], payload: { name } })
    if (!r.ok) log(`  ! tag ${name} on /${segments.join('/')}: ${r.error}`)
  }
}

/** Put a local image on a tile's face (small + flat + large), idempotent by sig. */
async function ensureFace(segments, file) {
  const bytes = fs.readFileSync(path.join(PICTURES, file))
  if (DRY) { log(`  ~ face /${segments.join('/')} ← ${file} (${Math.round(bytes.length / 1024)}kb)`); return }
  const put = await ask({ op: 'put-resource', base64: bytes.toString('base64') })
  if (!put.ok) { log(`  ! put-resource ${file}: ${put.error}`); return }
  const imgSig = String(put.data.sig)
  const props = await currentProps(segments)
  if (props.small && props.small.image === imgSig) { log(`  = face /${segments.join('/')} already ${imgSig.slice(0, 12)}`); return }
  const merged = {
    ...props,
    small: { ...(props.small || {}), image: imgSig },
    flat: { ...(props.flat || {}), small: { image: imgSig }, large: { x: 0, y: 0, scale: 1 } },
    large: { ...(props.large || {}), image: imgSig, x: 0, y: 0, scale: 1 },
  }
  const putProps = await ask({ op: 'put-resource', text: JSON.stringify(merged) })
  if (!putProps.ok) { log(`  ! props ${file}: ${putProps.error}`); return }
  const r = await ask({ op: 'bag-set', segments, slot: 'properties', cells: [String(putProps.data.sig)] })
  log(`  ${r.ok ? '+' : '!'} face /${segments.join('/')} ← ${imgSig.slice(0, 12)}${r.ok ? '' : ' ' + r.error}`)
}

const log = (...a) => console.log(...a)

// ── the board ─────────────────────────────────────────────────────────

const CONFLICTS = [
  {
    name: 'red-chris-mine-expansion',
    instruction: 'Carney holds Newmont; Newmont leads the $2B Red Chris block-cave expansion it operates 70/30 with Imperial Metals.',
    tags: ['conflict-of-interest', 'mining', 'canada', 'carney-invested'],
    companies: ['newmont', 'imperial-metals'],
    note: [
      'DIRECT CONFLICT: Mining Expansion | Red Chris Mine Expansion — Mark Carney is invested in Newmont (majority owner)',
      '',
      "The Red Chris copper-gold mine in British Columbia's Golden Triangle is undergoing a major block-cave underground expansion to access deeper, higher-grade ore and extend its life, with an estimated cost of around USD $2 billion.",
      '',
      'The project is operated by Newmont (70%) and Imperial Metals (30%), with Newmont leading development following its acquisition of Newcrest.',
      '',
      'Notably, Prime Minister Mark Carney personally holds shares in Newmont Corp., raising conflict-of-interest concerns as the company benefits from regulatory fast-tracking and major investment in the expansion.',
      '',
      'Board sources: "Red Chris - Canada | Newmont Corporation".',
    ].join('\n'),
  },
  {
    name: 'darlington-smr',
    instruction: 'Carney holds both GE Vernova and BWXT, the designer and the component supplier of Canada\u2019s first SMR at Darlington.',
    tags: ['conflict-of-interest', 'nuclear', 'canada', 'usa', 'carney-invested'],
    companies: ['ge-vernova', 'bwx-technologies'],
    note: [
      'DIRECT CONFLICT: Nuclear Energy | Darlington Small Modular Nuclear Reactor — Mark Carney is invested in GE Vernova & BWX Technologies',
      '',
      'The Darlington New Nuclear Project in Ontario is building a GE Vernova BWRX-300 small modular reactor at the existing OPG site, the first SMR of its kind in Canada.',
      '',
      'GE Vernova is the reactor designer and technology supplier, while BWX Technologies is providing nuclear components and manufacturing services, including reactor pressure vessels and fuel handling systems.',
      '',
      'Notably, Prime Minister Mark Carney personally holds shares in both GE Vernova and BWX Technologies, raising conflict-of-interest concerns as both firms directly profit from this government-backed nuclear expansion.',
      '',
      'Board sources: "GE Hitachi awards contract for BWRX-300"; "BWRX-300 Reactor in Darlington, Ontario"; "Major contracts awarded for OPG SMR".',
    ].join('\n'),
  },
  {
    name: 'ksi-lisims-lng',
    instruction: 'Carney holds Blackstone (behind Western LNG) and Canadian Natural Resources — both gain if Ksi Lisims clears federal approval.',
    tags: ['conflict-of-interest', 'lng', 'oil-and-gas', 'canada', 'usa', 'carney-invested'],
    companies: ['blackstone', 'western-lng', 'canadian-natural-resources'],
    note: [
      'DIRECT CONFLICT: Ksi Lisims LNG | Blackstone (Western LNG) — Mark Carney is invested in Blackstone Inc. & CNR',
      '',
      'The Ksi Lisims LNG project in British Columbia is a multi-billion dollar export facility led by Western LNG, which is financially supported by Blackstone Inc, one of the largest private equity firms in the world.',
      '',
      "Blackstone plays a major role in Western LNG's development, financing, and long term project strategy. Prime Minister Mark Carney holds personal investments in Blackstone, creating a significant conflict of interest because Blackstone benefits directly if Ksi Lisims LNG receives federal approvals, regulatory fast tracking, emissions exemptions, or financial incentives.",
      '',
      'Canadian Natural Resources is also invested in this project, and Carney holds a personal stake in that company as well.',
      '',
      'Board sources: "Wison awarded contract by Western LNG"; "Western LNG".',
    ].join('\n'),
  },
  {
    name: 'catl-chc-battery-jv',
    instruction: 'Carney is tied through Brookfield \u2192 Oaktree \u2192 Hartree to a JV with CATL, a company the US DoD listed as a Chinese military company.',
    tags: ['conflict-of-interest', 'batteries', 'china', 'usa', 'carney-invested', 'sanctioned-entity'],
    companies: ['catl', 'hartree-partners', 'oaktree-capital', 'brookfield'],
    note: [
      'DIRECT CONFLICT: Chinese Batteries | CATL & CHC Global Joint Venture (Hartree Partners) — Mark Carney is invested in Brookfield',
      '',
      'CHC Co. Limited (CHC Global) is a major joint venture established to develop Battery Energy Storage Systems (BESS). The project is a partnership between the Chinese battery giant CATL and Hartree Partners — a commodities firm where Oaktree Capital (a Brookfield subsidiary) holds a massive $1 billion investment.',
      '',
      'While CATL controls over 38% of the global battery market, the partnership poses serious security questions. On January 2, 2025, the U.S. Department of Defense officially blacklisted CATL, placing it on the Section 1260H list of "Chinese Military Companies."',
      '',
      "Notably, Mark Carney is deeply tied to this chain through his leadership and investment in Brookfield. This raises significant conflict-of-interest concerns, as Carney's firm is doing business with a US-sanctioned military company, a relationship highlighted by his personal meetings with Chinese stakeholders.",
      '',
      'The ownership chain to follow: CATL \u2194 Hartree Partners \u2190 Oaktree Capital \u2190 Brookfield \u2190 Carney.',
    ].join('\n'),
  },
  {
    name: 'cae-aviation-defence',
    instruction: 'Calin Rovinescu sits as Senior Advisor to Brookfield and Executive Director at CAE — the board overlap, not a holding, is the conflict here.',
    tags: ['conflict-of-interest', 'aviation', 'defence', 'canada', 'china', 'board-overlap'],
    companies: ['cae', 'brookfield'],
    note: [
      'DIRECT CONFLICT: Aviation & Defense | CAE Inc. — Mark Carney is invested in Brookfield and sat on the board with Calin Rovinescu',
      '',
      'CAE Inc. is a global leader in aviation simulation and defense training. The company maintains extensive business operations in China, operating joint ventures with state-owned giants like China Southern Airlines and China Eastern Airlines, and supplying flight simulators for COMAC\u2019s C919 program.',
      '',
      'The key link is Calin Rovinescu, who serves as a Senior Advisor to Brookfield Asset Management (alongside former Chair Mark Carney) while simultaneously holding the position of Executive Director at CAE. This close tie was put on public display when Carney chose CAE headquarters as the backdrop for his major defense spending press conference on February 17, 2026.',
      '',
      'This overlap raises significant conflict-of-interest concerns as Prime Minister Mark Carney officially designated China as a "strategic partner" in January 2026. Carney\u2019s diplomatic opening of the Chinese market directly benefits the companies guided by his own private equity advisors, specifically in sensitive sectors like aviation and defense training.',
      '',
      'Board sources: "Canada\u2019s CAE forms joint venture with Guangdong…"; "Calin Rovinescu" (Scotiabank); "C\u0103lin Rovinescu" (Wikipedia); "Brookfield Asset Management Appoints Calin Rovinescu as Senior Advisor".',
    ].join('\n'),
  },
  {
    name: 'pathways-alliance-carbon-capture',
    instruction: 'Carney holds all three of ExxonMobil, ConocoPhillips and Canadian Natural Resources — every one of them gains from the Pathways CCS line.',
    tags: ['conflict-of-interest', 'carbon-capture', 'oil-and-gas', 'canada', 'carney-invested'],
    companies: ['exxonmobil', 'conocophillips', 'canadian-natural-resources'],
    note: [
      'DIRECT CONFLICT: Carbon Capture | Pathways Alliance Project — Mark Carney is invested in 3 companies involved',
      '',
      'The Pathways Alliance project is a proposed carbon capture and storage (CCS) network and pipeline in Alberta designed to collect CO2 emissions from oilsands operations and transport them through a ~400-kilometre line to an underground storage hub near Cold Lake.',
      '',
      "The Alliance is made up of Canada's biggest oil sands producers, including Canadian Natural Resources and ConocoPhillips, which would directly use and benefit from the infrastructure.",
      '',
      'Prime Minister Mark Carney personally holds shares in ExxonMobil, ConocoPhillips, and Canadian Natural Resources, raising conflict-of-interest concerns as all three stand to gain from the Pathways project.',
      '',
      'Board sources: "Pathways Carbon Capture Project Is Not Viable…"; "Who we are" (Pathways Alliance).',
    ].join('\n'),
  },
  {
    name: 'himars-precision-strike',
    instruction: 'Carney holds Lockheed Martin, principal contractor on the US$1.75B HIMARS foreign military sale to Canada — still in negotiation.',
    tags: ['conflict-of-interest', 'defence', 'usa', 'canada', 'carney-invested', 'in-negotiation'],
    companies: ['lockheed-martin'],
    note: [
      'DIRECT CONFLICT: Missile Precision Strike System | Lockheed Martin — Mark Carney is invested in Lockheed Martin — In Negotiation',
      '',
      'The U.S. State Department has approved a Foreign Military Sale to Canada of 26 M142 High Mobility Artillery Rocket Systems (HIMARS), plus a large stock of munitions and support equipment. The total estimated value of the deal is US $1.75 billion ($2.44 billion CAD).',
      '',
      'Lockheed Martin will serve as the principal contractor for the program.',
      '',
      'Conflict of Interest Concern: Prime Minister Mark Carney holds personal investments in Lockheed Martin, the principal contractor for this multi-billion-dollar deal.',
      '',
      'Board sources: "U.S. State Department greenlights potential sale…" (CBC via Yahoo News); "Canada - M142 High Mobility Artillery Rocket Systems" (Defense Security Cooperation Agency).',
    ].join('\n'),
  },
  {
    name: 'f-35-lightning-ii',
    instruction: 'Carney holds Lockheed Martin, prime contractor on the 88-aircraft F-35 program valued at over $19B CAD — still in negotiation.',
    tags: ['conflict-of-interest', 'defence', 'aviation', 'usa', 'canada', 'carney-invested', 'in-negotiation'],
    companies: ['lockheed-martin'],
    note: [
      'DIRECT CONFLICT: F-35 Lightning II Fighter Jets | Lockheed Martin — Mark Carney is invested in Lockheed Martin — In Negotiation',
      '',
      'The Canadian government has approved the purchase of F-35 Lightning II fighter jets as part of a major defense modernization program. The Lockheed Martin-led project involves the acquisition of 88 F-35 aircraft, including sustainment, training systems, and advanced weapons packages. The total value of the program is estimated at over $19 billion CAD.',
      '',
      'Lockheed Martin serves as the prime contractor and manufacturer of the F-35, with key subcontractors supplying engines, avionics, and radar systems.',
      '',
      'Conflict of Interest Concern: Prime Minister Mark Carney holds personal investments in Lockheed Martin, the principal contractor for this multi-billion-dollar fighter jet deal — raising questions about potential conflicts of interest between his private holdings and federal procurement decisions.',
      '',
      'Board sources: "Lockheed Martin F-35 Lightning II Canadian procurement" (Wikipedia); "Future Fighter Capability Project" (Canada).',
    ].join('\n'),
  },
  {
    name: 'canadian-nuclear-labs',
    instruction: 'Carney holds BWXT while his government let an American company take over management of the federal nuclear-lab programs BWXT serves.',
    tags: ['conflict-of-interest', 'nuclear', 'canada', 'usa', 'carney-invested'],
    companies: ['bwx-technologies'],
    note: [
      'DIRECT CONFLICT: Canadian Nuclear Labs | BWX Technologies — Mark Carney is invested in BWX Technologies',
      '',
      'BWX Technologies (BWXT) supplies reactor components, nuclear fuel, and produces key isotopes used in cancer care and medical imaging — including Mo-99, Tc-99m, and Cobalt-60. Through its work with Canadian Nuclear Laboratories (CNL), BWXT is deeply involved in federal projects supporting isotope production, reactor upgrades, and national nuclear-lab operations. These programs are part of a multi-billion-dollar modernization effort that expands Canada\u2019s role as a global supplier of medical isotopes.',
      '',
      'Prime Minister Mark Carney personally owns investments in BWX Technologies, and his government approved allowing an American company to gain control over the management of these nuclear-lab programs. This means he directly profits from federal decisions that increase isotope production capacity, fund CNL projects, or award new nuclear-sector contracts.',
      '',
      "Because Ottawa controls CNL and approves these programs, Carney's financial stake in BWXT creates a direct conflict of interest: government actions could raise the value of a company he personally owns.",
      '',
      'Board sources: "Critics are sounding the alarm on U…" (National Post); "AECL announcing the selection of Nuclear…"; "BWXT-Led Team Awarded Canadian Nuclear…".',
    ].join('\n'),
  },
  {
    name: 'ukraine-industrial-reconstruction',
    instruction: 'Of the nine publicly traded firms named in the Ukraine rebuild, Carney is invested in seven — every one of them is paid out of the reconstruction.',
    tags: ['conflict-of-interest', 'infrastructure', 'finance', 'ukraine', 'carney-invested'],
    companies: ['blackrock', 'jpmorgan', 'brookfield', 'citigroup', 'arcelormittal', 'aon', 'vestas', 'honeywell', 'ge-vernova', 'westinghouse'],
    note: [
      'DIRECT CONFLICT: Industrial Reconstruction | Rebuilding Ukraine — Mark Carney is invested in 7 of the 9 companies involved',
      '',
      'The Ukraine Rebuild Initiative is a large-scale effort to attract international investment for infrastructure, energy, and industrial reconstruction projects following the war.',
      '',
      'Leading the financial and strategic coordination are BlackRock and JPMorgan, which are co-managing the Ukraine Development Fund to structure and deploy global capital. Other key companies involved include Brookfield (via Westinghouse, supplying nuclear reactors and fuel), Citigroup (providing banking and investment services), Aon (offering war risk insurance programs), Vestas (developing wind projects), Honeywell (advancing grid modernization), and GE Vernova (supporting long-term energy infrastructure).',
      '',
      'Notably, Prime Minister Mark Carney personally holds shares in nearly all of these firms — raising conflict-of-interest concerns as these companies directly profit from contracts and financing tied to the Ukraine reconstruction effort.',
      '',
      'THE 9 PUBLICLY TRADED FIRMS, AS MARKED ON THE BOARD:',
      '  BlackRock Inc. (NYSE: BLK) — invested — co-leading the Ukraine Development Fund',
      '  JPMorgan Chase & Co. (NYSE: JPM) — invested — capital flow planning and financial structuring',
      '  Brookfield Corp. (NYSE: BN) — invested — owner of Westinghouse, supplying nuclear reactors and fuel',
      '  Citigroup Inc. (NYSE: C) — invested — banking and investment services in-country',
      '  ArcelorMittal (NYSE: MT) — NOT invested — steel infrastructure via its Ukrainian subsidiary',
      '  Aon plc (NYSE: AON) — invested — war risk insurance programs to unlock private investment',
      '  Vestas Wind Systems A/S (OTC: VWDRY) — NOT invested — wind energy projects in southern Ukraine',
      '  Honeywell International Inc. (NASDAQ: HON) — invested — grid modernization and clean energy',
      '  General Electric Company (NYSE: GE) — invested — long-term energy infrastructure via GE Vernova',
      '',
      'DISCREPANCY TO RESOLVE: the board\u2019s prose lists Vestas among the firms Carney holds, while the board\u2019s own green/red chip on the same section marks Vestas as NOT invested. The chips give 7 of 9, which is what the section heading claims, so the chips are treated as the record here and the prose as the error.',
      '',
      'Board source: "The U.S.-Ukraine Reconstruction…" (BTG Wealth Mgmt).',
    ].join('\n'),
  },
  {
    name: 'westinghouse-ukraine-funding',
    instruction: 'Board section is a heading only — Westinghouse / Ukraine war funding has no body text yet, and needs its own research pass.',
    tags: ['conflict-of-interest', 'nuclear', 'ukraine', 'carney-invested', 'header-only'],
    companies: ['westinghouse', 'brookfield'],
    note: [
      'DIRECT CONFLICT: Westinghouse | Ukraine War Funding — Mark Carney is invested',
      '',
      'On the Miro board this section exists as a heading with no body beneath it. Nothing is claimed here beyond the heading itself, and nothing has been filled in from another source.',
      '',
      'What the heading asserts: Carney holds a position that benefits from Westinghouse\u2019s role in Ukraine war funding. Westinghouse is owned by Brookfield, which is the same chain used in the Ukraine reconstruction section.',
      '',
      'OPEN — this tile is a placeholder for the research that section still needs.',
    ].join('\n'),
  },
  {
    name: 'tata-investment-corp',
    instruction: 'Board section is a heading only — Tata (Nexus Malls, social infrastructure, renewable power, Rajasthan Solar) has no body text yet.',
    tags: ['conflict-of-interest', 'infrastructure', 'renewables', 'real-estate', 'india', 'carney-invested', 'header-only'],
    companies: ['tata-investment-corp'],
    note: [
      'DIRECT CONFLICT: Tata Investment Corp | Nexus Malls / Social Infrastructure / Renewable Power / Rajasthan Solar — Mark Carney is invested',
      '',
      'On the Miro board this section exists as a heading with no body beneath it.',
      '',
      'What the heading asserts: Carney holds a position in Tata Investment Corp, which is named against four lines of business — Nexus Malls (retail real estate), social infrastructure, renewable power, and the Rajasthan Solar project.',
      '',
      'OPEN — this tile is a placeholder for the research that section still needs.',
    ].join('\n'),
  },
]

const COMPANIES = [
  ['newmont', 'invested', ['mining', 'canada'], 'Operator (70%) of the Red Chris expansion after acquiring Newcrest. Carney holds shares.'],
  ['imperial-metals', null, ['mining', 'canada'], 'Holds the remaining 30% of Red Chris alongside Newmont.'],
  ['ge-vernova', 'invested', ['nuclear', 'renewables', 'usa'], 'Designer and technology supplier of the BWRX-300 SMR at Darlington; also named in the Ukraine rebuild. Carney holds shares.'],
  ['bwx-technologies', 'invested', ['nuclear', 'usa'], 'Nuclear components, fuel and medical isotopes; supplies Darlington and works with Canadian Nuclear Laboratories. Carney holds shares.'],
  ['blackstone', 'invested', ['finance', 'lng', 'usa'], "Private equity backer of Western LNG's Ksi Lisims project. Carney holds shares."],
  ['western-lng', null, ['lng', 'canada'], 'Lead developer of the Ksi Lisims LNG export facility in British Columbia; financed by Blackstone.'],
  ['canadian-natural-resources', 'invested', ['oil-and-gas', 'carbon-capture', 'canada'], 'Oil sands producer; invested in Ksi Lisims LNG and a member of the Pathways Alliance. Carney holds shares.'],
  ['brookfield', 'invested', ['finance', 'canada'], 'Carney was Chair. Parent of Oaktree Capital and owner of Westinghouse — the hub every other chain on this board runs through.'],
  ['oaktree-capital', null, ['finance', 'usa'], 'Brookfield subsidiary holding roughly $1 billion in Hartree Partners.'],
  ['hartree-partners', null, ['batteries', 'usa'], 'Commodities firm; the CHC Global battery-storage joint venture partner with CATL.'],
  ['catl', null, ['batteries', 'china', 'sanctioned-entity'], 'Chinese battery giant, over 38% of the global market. Placed on the US DoD Section 1260H list of Chinese Military Companies, 2 January 2025.'],
  ['cae', null, ['aviation', 'defence', 'canada'], 'Aviation simulation and defense training. Joint ventures with Chinese state airlines and simulators for COMAC C919; Calin Rovinescu is Executive Director.'],
  ['exxonmobil', 'invested', ['oil-and-gas', 'usa'], 'Named among the Pathways Alliance beneficiaries. Carney holds shares.'],
  ['conocophillips', 'invested', ['oil-and-gas', 'carbon-capture', 'usa'], 'Oil sands producer in the Pathways Alliance. Carney holds shares.'],
  ['lockheed-martin', 'invested', ['defence', 'aviation', 'usa'], 'Principal contractor on both the HIMARS sale and the 88-aircraft F-35 program. Carney holds shares.'],
  ['blackrock', 'invested', ['finance', 'usa'], 'Co-manager of the Ukraine Development Fund. Carney holds shares.'],
  ['jpmorgan', 'invested', ['finance', 'usa'], 'Co-manager of the Ukraine Development Fund; capital flow planning and financial structuring. Carney holds shares.'],
  ['citigroup', 'invested', ['finance', 'ukraine'], 'Banking and investment services in-country throughout the war and into recovery. Carney holds shares.'],
  ['arcelormittal', 'not-invested', ['mining', 'ukraine'], 'Steel infrastructure through its Ukrainian subsidiary. Marked on the board as NOT held by Carney.'],
  ['aon', 'invested', ['finance', 'ukraine'], 'War risk insurance programs to unlock private investment. Carney holds shares.'],
  ['vestas', 'not-invested', ['renewables', 'ukraine'], 'Wind energy projects in southern Ukraine. The board\u2019s chip marks Vestas NOT held, though its prose says otherwise — see the Ukraine reconstruction tile.'],
  ['honeywell', 'invested', ['infrastructure', 'ukraine'], 'Grid modernization and clean energy solutions. Carney holds shares.'],
  ['westinghouse', null, ['nuclear', 'ukraine'], 'Nuclear reactors and fuel for Ukraine; owned by Brookfield. Has its own board section, still a heading only.'],
  ['tata-investment-corp', 'invested', ['infrastructure', 'renewables', 'real-estate', 'india'], 'Nexus Malls, social infrastructure, renewable power and Rajasthan Solar. Section is still a heading only.'],
]

const CAPTURES = [
  ['capture-mining-nuclear-lng', 'Screenshot 2026-08-04 151108.png', 'Red Chris / Newmont, Darlington SMR / GE Vernova + BWXT, and Ksi Lisims LNG / Blackstone.'],
  ['capture-batteries-aviation', 'Screenshot 2026-08-04 151151.png', 'CATL & CHC Global / Brookfield, CAE Inc. / Rovinescu, and the top of Pathways Alliance. Shows the board title bar: "Public Moose on the Loose".'],
  ['capture-carbon-himars', 'Screenshot 2026-08-04 151239.png', 'Pathways Alliance carbon capture, the HIMARS precision strike sale, and the top of the F-35 section.'],
  ['capture-f35-nuclear-labs', 'Screenshot 2026-08-04 151308.png', 'F-35 Lightning II / Lockheed Martin and Canadian Nuclear Labs / BWXT.'],
  ['capture-ukraine-tata', 'Screenshot 2026-08-04 151337.png', 'Ukraine industrial reconstruction with the 9-company invested/not-invested chips, plus the Westinghouse and Tata headings.'],
]

const VOCABULARY = [
  'Pheromone vocabulary for Moose on the Loose',
  '',
  'These are the marks painted across this subtree. Keep to them when new material arrives rather than minting a synonym — the marks are what will let a later pass fold matching material together.',
  '',
  'WHAT A TILE IS: person · company · conflict-of-interest · evidence',
  'MONEY: carney-invested · carney-not-invested',
  'SECTOR: mining · nuclear · lng · oil-and-gas · carbon-capture · batteries · aviation · defence · renewables · finance · infrastructure · real-estate',
  'JURISDICTION: canada · usa · china · ukraine · india',
  'STATE OF THE CLAIM: in-negotiation · header-only',
  'FLAGS: sanctioned-entity · board-overlap',
  '',
  'A conflict tile carries: conflict-of-interest + its sectors + its jurisdictions + the money mark, and nothing about which companies are in it — that edge is the company tiles carrying the same sector and money marks. Two tiles that share marks are the candidates for integration, never an assertion that they are the same thing.',
].join('\n')

const ROOT_NOTE = [
  'Moose on the Loose',
  '',
  'A public-interest map of who profits from decisions taken by the Canadian government under Prime Minister Mark Carney. The first pass mirrors the Miro board "Public Moose on the Loose", which lays out twelve sections each headed DIRECT CONFLICT: a sector, a project or procurement, and the company Carney is said to hold a personal position in.',
  '',
  'HOW THIS IS ORGANISED',
  '  people/       the individuals. Each conflict hangs off the person it belongs to.',
  '  companies/    the register of firms the board names, each with what it does and whether the board marks Carney as invested. This is the layer that later material folds into — a new board naming Newmont lands on the same tile.',
  '  miro-board/   the raw captures the first pass was built from, kept as evidence.',
  '',
  'WHAT IS ON EACH CONFLICT TILE',
  '  a single-line instruction — the claim in one sentence',
  '  a long-form note — the board section transcribed, with its sources listed',
  '  pheromones — sector, jurisdiction, whether Carney is marked invested, and the state of the claim',
  '',
  'STANDING OF THE MATERIAL: every claim here is a transcription of what the board asserts, not an independent verification. Where the board contradicts itself the contradiction is written down rather than resolved silently — see the Ukraine reconstruction tile. Two sections (Westinghouse, Tata) are headings with no body and are marked header-only.',
].join('\n')

const CARNEY_NOTE = [
  'Mark Carney',
  '',
  'Prime Minister of Canada. Formerly Governor of the Bank of Canada, Governor of the Bank of England, and Chair of Brookfield Asset Management.',
  '',
  'The board\u2019s thesis is a single shape repeated twelve times: a federal decision — an approval, a procurement, a fast-track, a diplomatic opening — moves money toward a company in which Carney is said to hold a personal position. Brookfield is the recurring hub; Lockheed Martin, BWX Technologies, GE Vernova and Canadian Natural Resources each appear in more than one section.',
  '',
  'The conflicts are children of this tile. The companies they run through are in the companies register alongside, so a firm named by two different sections is one tile, not two.',
].join('\n')

// ── build ─────────────────────────────────────────────────────────────

async function main() {
  log(DRY ? '— DRY RUN —' : '— building Moose on the Loose —')
  await bindHiveHelpers()

  // 0. sanity: are we in the hive we think we are?
  const rootKids = await childNamesOf([])
  if (rootKids === null) { log('ABORT: no layer at the root - renderer not ready'); process.exit(2) }
  log('hive root:', rootKids.join(', ') || '(empty)')
  if (!rootKids.length) { log('ABORT: root has no children — wrong OPFS or renderer not ready'); process.exit(2) }

  // 1. spine
  log('\n[structure]')
  await ensureCells([], [ROOT])
  await ensureCells([ROOT], ['people', 'companies', 'miro-board'])
  await ensureCells([ROOT, 'people'], ['mark-carney'])
  await ensureCells([ROOT, 'people', 'mark-carney'], ['conflicts-of-interest'])
  const coiPath = [ROOT, 'people', 'mark-carney', 'conflicts-of-interest']
  await ensureCells(coiPath, CONFLICTS.map(c => c.name))
  await ensureCells([ROOT, 'companies'], COMPANIES.map(c => c[0]))
  await ensureCells([ROOT, 'miro-board'], CAPTURES.map(c => c[0]))

  // 2. the root, the person, the two collections
  log('\n[root + person]')
  log('  root note:', await ensureNote([], ROOT, ROOT_NOTE))
  log('  vocabulary:', await ensureNote([], ROOT, VOCABULARY))
  await paint([ROOT], ['conflict-of-interest', 'canada'])

  log('  carney note:', await ensureNote([ROOT, 'people'], 'mark-carney', CARNEY_NOTE))
  log('  carney line:', await ensureNote([ROOT, 'people'], 'mark-carney',
    'Prime Minister of Canada; former Chair of Brookfield Asset Management — the hub twelve sections run through.'))
  await paint([ROOT, 'people', 'mark-carney'], ['person', 'canada', 'conflict-of-interest'])
  await ensureFace([ROOT, 'people', 'mark-carney'], 'mark-carney.png')

  log('  companies note:', await ensureNote([ROOT], 'companies',
    ['The register of firms named on the board.',
      '',
      'One tile per company, however many sections name it. Each carries what the firm does in this story and whether the board marks Carney as holding a position in it — carney-invested, carney-not-invested, or neither where the board does not say.',
      '',
      'This is the integration layer: material arriving later about a firm already here belongs on its existing tile.'].join('\n')))
  log('  captures note:', await ensureNote([ROOT], 'miro-board',
    ['The board captures this hive was built from.',
      '',
      'Five screenshots of the Miro board "Public Moose on the Loose", taken 4 August 2026, plus the portrait used on the Mark Carney tile. Kept as evidence so any transcription here can be checked against what the board actually said.'].join('\n')))
  await paint([ROOT, 'companies'], ['company'])
  await paint([ROOT, 'miro-board'], ['evidence'])
  log('  coi note:', await ensureNote([ROOT, 'people', 'mark-carney'], 'conflicts-of-interest',
    ['Twelve DIRECT CONFLICT sections, one tile each.',
      '',
      'Every one has the same shape: a federal decision moves money toward a company the board says Carney holds. Ten carry a transcribed body; two (Westinghouse, Tata) are headings the board never filled in and are marked header-only.'].join('\n')))
  await paint(coiPath, ['conflict-of-interest'])

  // 3. conflicts
  log('\n[conflicts]')
  for (const c of CONFLICTS) {
    const seg = [...coiPath, c.name]
    const n1 = await ensureNote(coiPath, c.name, c.instruction)
    const n2 = await ensureNote(coiPath, c.name, c.note)
    await paint(seg, c.tags)
    log(`  ${c.name}: line=${n1} note=${n2} marks=${c.tags.length}`)
  }

  // 4. companies
  log('\n[companies]')
  for (const [name, money, sectors, line] of COMPANIES) {
    const seg = [ROOT, 'companies', name]
    const marks = ['company', ...sectors]
    if (money === 'invested') marks.push('carney-invested')
    if (money === 'not-invested') marks.push('carney-not-invested')
    const inSections = CONFLICTS.filter(c => c.companies.includes(name)).map(c => c.name)
    const body = [line, '', inSections.length
      ? `Named in ${inSections.length} board section${inSections.length > 1 ? 's' : ''}: ${inSections.join(', ')}.`
      : 'Not named directly in a section body.'].join('\n')
    const r = await ensureNote([ROOT, 'companies'], name, body)
    await paint(seg, marks)
    log(`  ${name}: note=${r} marks=${marks.join('+')}`)
  }

  // 5. captures
  log('\n[captures]')
  for (const [name, file, desc] of CAPTURES) {
    const seg = [ROOT, 'miro-board', name]
    const r = await ensureNote([ROOT, 'miro-board'], name, desc)
    await paint(seg, ['evidence'])
    await ensureFace(seg, file)
    log(`  ${name}: note=${r}`)
  }

  // 6. one build record over the whole pass
  if (!DRY) {
    log('\n[build record]')
    const br = await ask({ op: 'build-record', segments: [ROOT], label: 'Moose on the Loose — Miro board first pass' })
    log('  ', br.ok ? JSON.stringify(br.data).slice(0, 200) : br.error)
  }

  log('\nDone.')
}

main().catch(e => { console.error(e); process.exit(2) })
