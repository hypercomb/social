// The funding hive — /funding
//
//   node scripts/bridge/_funding-hive.cjs <out dir>          write the pages
//   node scripts/bridge/_funding-hive.cjs <out dir> --say    write them, then say them into the hive
//
// Maps every BC and federal loan and grant in "BC & Canada Startup Funding:
// Loans and Grants Comparison" (as of 2026-11-01; jwize's PDF) into tiles a
// participant can walk and add to: one tile per program, each dressed with a
// page of its facts, a chart and a plan, grouped as loans, grants, streams
// (combinations that run side by side), stages, a calendar and sources.
// The figures are the PDF's estimates, never lender quotes — every page says so.
//
// Speaks, never bridges (documentation/speak-dont-bridge.md): `create`, `go`,
// `website page {file}` with the page riding the sentence, and `file on` for
// notes. Each page is standalone HTML with inline SVG — no third-party request.

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const OUT = process.argv[2]
const SAY = process.argv.includes('--say')
if (!OUT) { console.error('usage: _funding-hive.cjs <out dir> [--say]'); process.exit(2) }
fs.mkdirSync(OUT, { recursive: true })

const ROOT = 'funding'
const AS_OF = 'November 1, 2026'
const DISCLAIMER = 'Estimates from the comparison sheet, not lender quotes. Not financial advice: confirm current rates and intake dates with each program.'

// ── the data, as the sheet gives it ───────────────────────────────────
// Each loan program is one tile; a program the sheet shows twice (two sizes)
// carries both rows. Amounts in thousands of dollars.
const LOANS = [
  { name: 'pacifican-bsp', title: 'PacifiCan BSP', rate: '0%', who: 'High-growth, incorporated BC company', newStartup: 'no', established: 'yes, with about 20% or more yearly growth',
    note: 'Intake is closed; the last window was April 27 to May 27, 2026. Modelled as a 1-year project, then a 1-year grace period.',
    rows: [{ label: '$5M, up to 50% of the project, repaid over 5 years', interestOnly: 'Project + 1-year grace', interest: [0, 0, 0, 0, 0, 0, 0], repaid: [0, 0, 1000, 1000, 1000, 1000, 1000], total: 0 }],
    plan: ['Show about 20% yearly growth for two years running.', 'Scope a project and fund at least half of it yourself.', 'Prepare the application before the next window; the last one was late April to late May.', 'Draw during the project, then repay over five years after the grace year.'] },
  { name: 'vancity-startup-growth', title: 'Vancity Startup & Growth', rate: '7.7% (prime + 3%)', who: 'Businesses in Metro Vancouver, the Fraser Valley, Victoria or Sea-to-Sky', newStartup: 'yes ($50K)', established: 'yes ($75K, to year 3)',
    note: 'Blended monthly payments, no interest-only period.',
    rows: [
      { label: '$50K over 5 years (new startup)', interestOnly: 'None', interest: [3.6, 2.9, 2.1, 1.3, 0.5], repaid: [12.1, 12.1, 12.1, 12.1, 12.1], total: 10399 },
      { label: '$75K over 5 years (in business, to year 3)', interestOnly: 'None', interest: [5.3, 4.3, 3.2, 2.0, 0.7], repaid: [18.1, 18.1, 18.1, 18.1, 18.1], total: 15599 }],
    plan: ['Confirm the business is in a Vancity region.', 'Open a business account and meet a Vancity business advisor.', 'Bring a business plan and cash-flow forecast.', 'Take $50K as a new startup, or $75K once trading.'] },
  { name: 'bdc-small-business', title: 'BDC Small Business Loan', rate: '9.5% (assumed)', who: 'Revenue and profit; credit score 600 or more', newStartup: 'no', established: 'yes',
    note: 'BDC prices each loan as its floating base rate plus a risk margin and publishes neither; 9.5% is assumed. Equal monthly principal after the interest-only period.',
    rows: [
      { label: '$100K over 5 years (revenue of $100K or more, profitable)', interestOnly: '6 months', interest: [9.3, 7.5, 5.4, 3.3, 1.1], repaid: [20.4, 29.7, 27.6, 25.5, 23.4], total: 26521 },
      { label: '$350K over 8 years (revenue of $250K or more, profitable)', interestOnly: '12 months', interest: [33.3, 31.1, 26.3, 21.6, 16.8, 12.1, 7.3, 2.6], repaid: [33.3, 81.1, 76.3, 71.6, 66.8, 62.1, 57.3, 52.6], total: 151010 }],
    plan: ['Reach $100K revenue and a profitable year.', 'Check the credit score is 600 or more.', 'Apply online for up to $100K; at $250K revenue the $350K size opens.', 'Use the interest-only months to put the money to work first.'] },
  { name: 'csbfp', title: 'Canada Small Business Financing Program', rate: '7.7% + 2% fee', who: 'Revenue of $10M or less; not for R&D', newStartup: 'yes', established: 'yes',
    note: 'Through a bank or credit union, guaranteed by ISED. The 2% registration fee is not in the interest total.',
    rows: [{ label: '$150K over 5 years', interestOnly: 'None', interest: [10.7, 8.6, 6.4, 4.0, 1.5], repaid: [36.2, 36.2, 36.2, 36.2, 36.2], total: 31198 }],
    plan: ['Ask your own bank or credit union for a CSBFP loan.', 'Use it for equipment, leaseholds or property, not R&D.', 'Budget the 2% registration fee on top of interest.'] },
  { name: 'bdc-startup-financing', title: 'BDC Start-up Financing', rate: '9.5% (assumed)', who: '12 months or more of revenue', newStartup: 'no', established: 'yes',
    note: '12-month interest-only period, then equal monthly principal.',
    rows: [{ label: '$150K over 5 years', interestOnly: '12 months', interest: [14.3, 12.6, 9.1, 5.5, 1.9], repaid: [14.3, 50.1, 46.6, 43.0, 39.4], total: 43344 }],
    plan: ['Trade for 12 months and keep clean books.', 'Prepare a plan for the first interest-only year.', 'Apply to BDC with 12 months of statements.'] },
  { name: 'bdc-tech-equipment', title: 'BDC Technology Equipment Loan', rate: '9.5% (assumed)', who: '12 months or more of revenue', newStartup: 'no', established: 'yes',
    note: 'No published maximum; shown at an illustrative $250K.',
    rows: [{ label: '$250K (illustrative) over 4 years', interestOnly: '6 months', interest: [23.0, 17.2, 10.5, 3.7], repaid: [58.8, 88.7, 81.9, 75.1], total: 54427 }],
    plan: ['List the hardware and software to finance.', 'Get vendor quotes.', 'Apply to BDC after 12 months of revenue.'] },
  { name: 'bdc-tech-companies', title: 'BDC Loan for Tech Companies', rate: '9.5% (assumed)', who: 'Revenue and good credit', newStartup: 'no', established: 'yes',
    note: 'No published maximum; shown at an illustrative $250K.',
    rows: [{ label: '$250K (illustrative) over 5 years', interestOnly: '12 months', interest: [23.8, 21.0, 15.1, 9.2, 3.2], repaid: [23.8, 83.5, 77.6, 71.7, 65.7], total: 72240 }],
    plan: ['Show recurring revenue and good credit.', 'Tie the loan to a growth plan: hires, sales, product.', 'Apply to BDC\'s technology team.'] },
  { name: 'bdc-working-capital', title: 'BDC Working Capital Loan', rate: '9.5% (assumed)', who: '12 months or more of revenue', newStartup: 'no', established: 'yes',
    note: 'No published maximum; shown at an illustrative $250K. The longest interest-only period, 24 months.',
    rows: [{ label: '$250K (illustrative) over 8 years', interestOnly: '24 months', interest: [23.8, 23.8, 21.9, 18.0, 14.0, 10.1, 6.1, 2.1], repaid: [23.8, 23.8, 63.6, 59.6, 55.7, 51.7, 47.8, 43.8], total: 119740 }],
    plan: ['Use it to bridge grant reimbursements and receivables.', 'Plan the two interest-only years against expected cash.', 'Apply to BDC after 12 months of revenue.'] },
]

// maxK: the largest single award in thousands, for the chart; unit says per what.
const GRANTS = [
  { name: 'nrc-irap', title: 'NRC IRAP', pays: 'Monthly reimbursement', share: 'Up to 80% of R&D wages, 50% of contractors', max: 'About $50K for small projects; larger case by case (median about $75K)', maxK: 75, unit: 'per project (median)', who: 'Incorporated, 500 staff or fewer, a technical R&D project', newStartup: 'yes, once incorporated (confirm the small-project stream)', established: 'yes', status: 'Open, continuous', stream: 'rd',
    plan: ['Incorporate.', 'Contact an IRAP Industrial Technology Advisor.', 'Scope a small technical R&D project with milestones.', 'Pay wages, then claim the monthly reimbursement.'] },
  { name: 'sred', title: 'SR&ED tax credit', pays: 'Yearly, after the tax filing', share: '35% refundable on eligible R&D (CCPC)', max: 'Enhanced rate on the first $6M of R&D', maxK: null, unit: '35% of eligible R&D', who: 'Canadian-controlled private corporation', newStartup: 'yes', established: 'yes', status: 'Ongoing', stream: 'rd',
    plan: ['Incorporate as a CCPC.', 'Track R&D hours and uncertainty as you go.', 'Claim with the corporate tax return each year.', 'Stack with IRAP on the same work, within combined limits.'] },
  { name: 'innovate-bc-ignite', title: 'Innovate BC Ignite', pays: 'Yearly instalments, after reports', share: '50%', max: '$300K', maxK: 300, unit: 'per project', who: 'A BC post-secondary partner is required; applied-science focus', newStartup: 'yes', established: 'yes', status: 'Check the current intake', stream: 'rd',
    note: 'Ignite targets natural resources, engineering and applied science, so a pure software project may not fit.',
    plan: ['Find a BC post-secondary research partner.', 'Frame the project as applied science.', 'Match 50% of the budget.', 'Watch for the next intake.'] },
  { name: 'early-stage-demonstration', title: 'Innovate BC Early-Stage Demonstration', pays: 'At each milestone', share: '40%', max: '$500K', maxK: 500, unit: 'per project', who: 'BC-incorporated; technology at TRL 6 or higher', newStartup: 'yes', established: 'yes', status: 'Closed Oct 30, 2026; watch for the next call', stream: 'rd',
    plan: ['Bring the technology to TRL 6, a working prototype in a real setting.', 'Line up a demonstration site.', 'Prepare for the next call.'] },
  { name: 'innovator-skills-initiative', title: 'Innovator Skills Initiative', pays: 'Per hire, after wages are paid', share: 'About 4 months\' salary', max: '$10K per new tech hire', maxK: 10, unit: 'per hire', who: 'Hiring someone from an under-represented group', newStartup: 'yes', established: 'yes', status: 'Check status', stream: 'people',
    plan: ['Plan a new tech role.', 'Recruit from under-represented groups.', 'Pay the wages, then claim per hire.'] },
  { name: 'mitacs-accelerate', title: 'Mitacs Accelerate', pays: 'No cash; you pay $7,500 upfront', share: '50% (you pay $7,500, Mitacs matches)', max: '$15K per 4–6 month intern unit', maxK: 15, unit: 'per intern unit', who: 'Incorporated; R&D with a graduate student', newStartup: 'yes, once incorporated', established: 'yes', status: 'Ongoing', stream: 'rd',
    plan: ['Find a graduate student and supervising professor.', 'Agree a 4–6 month research project.', 'Pay $7,500; Mitacs matches it.'] },
  { name: 'student-work-placement', title: 'Student Work Placement Program', pays: 'After each co-op term', share: '50–75% of student wages', max: 'About $5K–$7K per co-op term', maxK: 7, unit: 'per co-op term', who: 'Hiring a post-secondary co-op student', newStartup: 'yes', established: 'yes', status: 'Ongoing', stream: 'people',
    plan: ['Post a co-op role with a school\'s co-op office.', 'Hire for a term.', 'Claim after the term ends.'] },
  { name: 'canada-summer-jobs', title: 'Canada Summer Jobs', pays: 'Up to 75% in advance; the rest after', share: '50% of minimum wage (private sector)', max: 'Per youth hire', maxK: null, unit: 'per youth hire', who: 'Youth aged 15–30; 50 staff or fewer', newStartup: 'yes', established: 'yes', status: 'Next intake expected around Nov 2026', stream: 'people',
    plan: ['Write the summer role now.', 'Apply in the intake expected this month.', 'Hire for the summer and take the advance.'] },
  { name: 'bc-employer-training', title: 'BC Employer Training Grant', pays: 'Once, after training', share: '80%', max: '$10K per employee; $300K a year', maxK: 10, unit: 'per employee', who: 'Operating 1 year or more in BC', newStartup: 'no', established: 'yes', status: 'Open for 2026/27', stream: 'people',
    plan: ['Pick third-party training for staff.', 'Apply before the training starts.', 'Claim 80% after it ends.'] },
  { name: 'canexport-smes', title: 'CanExport SMEs', pays: 'Reimbursed after costs are paid', share: '50%', max: '$10K–$50K per project', maxK: 50, unit: 'per project', who: 'Revenue of $300K or more and 3 full-time staff', newStartup: 'no', established: 'yes, with $300K revenue', status: '2026–27 closed Aug 31; next around Feb 2027', stream: 'growth',
    plan: ['Reach $300K revenue and 3 full-time staff.', 'Pick a new export market.', 'Apply when the next intake opens, around Feb 2027.'] },
  { name: 'canexport-innovation', title: 'CanExport Innovation', pays: 'Reimbursed after costs are paid', share: '75%', max: '$37,500 per project', maxK: 37.5, unit: 'per project', who: 'An international R&D partnership; no revenue minimum', newStartup: 'yes', established: 'yes', status: 'Between intakes', stream: 'growth',
    plan: ['Find a foreign R&D partner.', 'Agree a joint project.', 'Apply at the next intake.'] },
]

// The streams: money that can run at the same time, side by side.
const STREAMS = [
  { name: 'rd-stack', title: 'R&D stack', line: 'The core non-repayable money for a software company: IRAP and SR&ED, both open once incorporated, stackable on the same work.',
    members: ['nrc-irap', 'sred', 'mitacs-accelerate', 'innovate-bc-ignite', 'early-stage-demonstration'],
    plan: ['Incorporate as a CCPC.', 'Open an IRAP project and track R&D time from day one.', 'Add a Mitacs intern for research depth.', 'Claim SR&ED on the year\'s R&D at tax time.', 'Grow toward Ignite or Early-Stage Demonstration when a partner or prototype is ready.'] },
  { name: 'people', title: 'Hiring stream', line: 'Wage support for each person you bring on: co-op students, summer youth, new tech hires, training.',
    members: ['student-work-placement', 'canada-summer-jobs', 'innovator-skills-initiative', 'mitacs-accelerate', 'bc-employer-training'],
    plan: ['Apply to Canada Summer Jobs this intake.', 'Hire a co-op student each term.', 'Use Innovator Skills for the first permanent tech hire.', 'After a year in BC, train staff with the Employer Training Grant.'] },
  { name: 'debt-ladder', title: 'Debt ladder', line: 'Borrow in order of cost: Vancity and CSBFP while new, BDC once there is revenue, PacifiCan BSP at scale.',
    members: ['vancity-startup-growth', 'csbfp', 'bdc-startup-financing', 'bdc-small-business', 'bdc-working-capital', 'pacifican-bsp'],
    plan: ['Start with Vancity $50K, the lowest-interest loan a new startup can get.', 'Add CSBFP for equipment.', 'After 12 months of revenue, BDC working capital bridges grant reimbursements.', 'At 20% yearly growth, apply for PacifiCan BSP at 0%.'] },
  { name: 'growth-export', title: 'Growth and export', line: 'Money for new markets and international partners.',
    members: ['canexport-innovation', 'canexport-smes', 'pacifican-bsp'],
    plan: ['Use CanExport Innovation for an international R&D partner now.', 'At $300K revenue, CanExport SMEs pays half of entering a market.', 'Scale with PacifiCan BSP.'] },
]

const STAGES = [
  { name: 'starting-out', title: 'New startup', line: 'Pre-revenue, not yet incorporated. Incorporating is the first move: it opens IRAP, SR&ED and Mitacs.', key: 'newStartup' },
  { name: 'two-years-in', title: 'Two years in business', line: 'Two or more years trading, with some revenue: every BDC loan opens, and so do the revenue-gated grants.', key: 'established' },
]

// The intake calendar, as the sheet states it on Nov 1, 2026. `when` only
// places the point on the line; `shown` is what the sheet actually says.
const CALENDAR = [
  { when: '2026-10-30', shown: 'Oct 30, 2026', what: 'Early-Stage Demonstration call closed', tile: 'early-stage-demonstration', state: 'closed' },
  { when: '2026-11-15', shown: 'Nov 2026 (expected)', what: 'Canada Summer Jobs intake expected (around November)', tile: 'canada-summer-jobs', state: 'soon' },
  { when: '2026-11-01', shown: 'All year', what: 'IRAP and SR&ED: open all year', tile: 'nrc-irap', state: 'open' },
  { when: '2026-11-01', shown: '2026/27', what: 'BC Employer Training Grant: open for 2026/27', tile: 'bc-employer-training', state: 'open' },
  { when: '2027-02-15', shown: 'Feb 2027 (expected)', what: 'CanExport SMEs next intake (around February)', tile: 'canexport-smes', state: 'soon' },
  { when: '2027-04-27', shown: 'Not announced', what: 'PacifiCan BSP: the last window was Apr 27 to May 27, 2026; watch for the next', tile: 'pacifican-bsp', state: 'watch' },
]

const SOURCES = [
  'National Bank: prime rate increase, Oct 2026 (prime 4.70%, effective Oct 29, 2026)',
  'BDC: floating-rate loan glossary; Start-up Financing; Small Business Loans; Working Capital Loan; Loan for Tech Companies; Technology Equipment Loan',
  'Futurpreneur: Core Startup Program (left out: founders must be under 40)',
  'Vancity: Startup and Growth Loan',
  'ISED: Canada Small Business Financing Program',
  'PacifiCan: Business Scale-up and Productivity funding overview',
  'Leyton: NRC IRAP overview; GrantCompass: IRAP figures',
  'GrantCompass: BC digital grants (SR&ED, Ignite); Early-Stage Demonstration call; Mitacs Accelerate; youth and student hiring programs; CanExport guide',
  'Innovate BC: Innovator Skills Initiative',
  'BC Gov: Employer Training Grant',
  'Trade Commissioner: CanExport 2026–27 changes',
]

// ── the page ──────────────────────────────────────────────────────────
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const money = k => k >= 1000 ? `$${(k / 1000).toFixed(k % 1000 ? 1 : 0)}M` : `$${k % 1 ? k.toFixed(1) : k}K`
const dollars = n => '$' + n.toLocaleString('en-US')
const yes = v => /^yes/i.test(v)

function page(title, kicker, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#f7f6f2;--card:#fff;--text:#1d1f23;--muted:#5d6470;--line:#e2dfd6;--accent:#c9861a;--loan:#3a6ea5;--grant:#2f8f5b;--warn:#b5503c;--soft:#efece4}
@media (prefers-color-scheme:dark){:root{--bg:#15171b;--card:#1d2026;--text:#eceae4;--muted:#a3a9b3;--line:#30343c;--accent:#e3a33a;--loan:#6fa3dc;--grant:#5cc48a;--warn:#e07a63;--soft:#252830}}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px 16px 40px}
main{max-width:860px;margin:0 auto;display:grid;gap:18px}
.kicker{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
h1{font-size:28px;line-height:1.15;margin-top:4px}
h2{font-size:16px;margin-bottom:10px}
.lede{color:var(--muted);margin-top:6px}
section{background:var(--card);border:1px solid var(--line);padding:16px}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
.facts div{background:var(--soft);padding:10px}
.facts b{display:block;font-size:12px;color:var(--muted);font-weight:600;margin-bottom:2px}
.yes{color:var(--grant);font-weight:700}.no{color:var(--warn);font-weight:700}
ol.plan{padding-left:22px;display:grid;gap:6px}
ol.plan li::marker{color:var(--accent);font-weight:700}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;color:var(--muted)}
svg{display:block;width:100%;height:auto}
svg text{fill:var(--text);font:12px system-ui,sans-serif}
svg .m{fill:var(--muted)}
.legend{display:flex;gap:14px;font-size:12px;color:var(--muted);margin-top:6px;flex-wrap:wrap}
.legend i{display:inline-block;width:10px;height:10px;margin-right:5px;vertical-align:-1px}
.note{font-size:13px;color:var(--muted)}
.fine{font-size:12px;color:var(--muted);text-align:center}
.pill{display:inline-block;font-size:12px;font-weight:600;padding:2px 8px;border:1px solid var(--line);background:var(--soft)}
</style></head><body><main>
<header><span class="kicker">${esc(kicker)}</span><h1>${esc(title)}</h1></header>
${body}
<p class="fine">${esc(DISCLAIMER)} Figures as of ${AS_OF}.</p>
</main></body></html>
`
}

// Horizontal bars: [{label, value, color, text}].
function hbars(items, width = 820) {
  const rowH = 30, labelW = 250, max = Math.max(1, ...items.map(i => i.value))
  const h = items.length * rowH + 10
  const bars = items.map((it, i) => {
    const y = i * rowH + 5, w = Math.max(2, (width - labelW - 150) * it.value / max)
    return `<text x="0" y="${y + 18}">${esc(it.label)}</text>
<rect x="${labelW}" y="${y + 5}" width="${w.toFixed(1)}" height="18" fill="${it.color}"/>
<text x="${(labelW + w + 6).toFixed(1)}" y="${y + 18}" class="m">${esc(it.text)}</text>`
  }).join('\n')
  return `<svg viewBox="0 0 ${width} ${h}" role="img">${bars}</svg>`
}

// Vertical bars by year, one or more series side by side.
function yearBars(series, width = 820, height = 220) {
  const years = Math.max(...series.map(s => s.values.length))
  const max = Math.max(1, ...series.flatMap(s => s.values))
  const left = 50, bottom = 28, top = 14, plotW = width - left - 10, plotH = height - bottom - top
  const groupW = plotW / years, barW = Math.min(36, (groupW - 10) / series.length)
  let out = ''
  for (let t = 0; t <= 4; t++) {
    const v = max * t / 4, y = top + plotH - plotH * t / 4
    out += `<line x1="${left}" x2="${width - 10}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--line)"/><text x="${left - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="m">${money(Math.round(v * 10) / 10)}</text>`
  }
  for (let yr = 0; yr < years; yr++) {
    const gx = left + yr * groupW + (groupW - barW * series.length) / 2
    series.forEach((s, si) => {
      const v = s.values[yr]; if (v === undefined) return
      const bh = plotH * v / max, x = gx + si * barW
      out += `<rect x="${x.toFixed(1)}" y="${(top + plotH - bh).toFixed(1)}" width="${(barW - 3).toFixed(1)}" height="${Math.max(bh, v ? 1 : 0).toFixed(1)}" fill="${s.color}"><title>${esc(s.name)} Y${yr + 1}: ${money(v)}</title></rect>`
    })
    out += `<text x="${(left + yr * groupW + groupW / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle" class="m">Y${yr + 1}</text>`
  }
  const legend = series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')
  return `<svg viewBox="0 0 ${width} ${height}" role="img">${out}</svg><div class="legend">${legend}</div>`
}

const SHADES = ['var(--loan)', 'var(--accent)']
const facts = pairs => `<div class="facts">${pairs.map(([k, v]) => `<div><b>${esc(k)}</b>${v}</div>`).join('')}</div>`
const fit = v => `<span class="${yes(v) ? 'yes' : 'no'}">${esc(v)}</span>`
const planOf = (steps, heading = 'The plan') => `<section><h2>${esc(heading)}</h2><ol class="plan">${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol></section>`

function loanPage(l) {
  const rows = l.rows.map(r => `<tr><td>${esc(r.label)}</td><td>${esc(r.interestOnly)}</td><td>${dollars(r.total)}</td></tr>`).join('')
  const charts = l.rows.map((r, i) => {
    const series = [{ name: 'Interest paid', values: r.interest, color: 'var(--warn)' }, { name: 'Total repaid', values: r.repaid, color: SHADES[i % 2] }]
    return `<section><h2>By year: ${esc(r.label)}</h2>${yearBars(series)}</section>`
  }).join('')
  return page(l.title, 'Loan', `
<p class="lede">${esc(l.note)}</p>
<section>${facts([['Rate', esc(l.rate)], ['Who qualifies', esc(l.who)], ['New startup', fit(l.newStartup)], ['2+ years in business', fit(l.established)]])}</section>
<section><h2>Sizes</h2><table><tr><th>Amount and term</th><th>Interest-only</th><th>Total interest</th></tr>${rows}</table></section>
${charts}
${planOf(l.plan)}`)
}

function grantPage(g) {
  return page(g.title, 'Grant · never repaid', `
<p class="lede">${esc(g.share)}. ${esc(g.status)}.</p>
<section>${facts([['Pays how', esc(g.pays)], ['Funding share', esc(g.share)], ['Most it pays', esc(g.max)], ['Who qualifies', esc(g.who)], ['New startup', fit(g.newStartup)], ['2+ years in business', fit(g.established)], ['2026 status', `<span class="pill">${esc(g.status)}</span>`]])}
${g.note ? `<p class="note" style="margin-top:10px">${esc(g.note)}</p>` : ''}</section>
${planOf(g.plan)}
<p class="note">Nearly every grant pays by reimbursement: the costs are yours to cover first.</p>`)
}

const byName = Object.fromEntries([...LOANS.map(l => [l.name, { ...l, kind: 'loan' }]), ...GRANTS.map(g => [g.name, { ...g, kind: 'grant' }])])
const routeOf = p => `/${ROOT}/${p.kind === 'loan' ? 'loans' : 'grants'}/${p.name}`

function streamPage(s) {
  const rows = s.members.map(n => {
    const p = byName[n]
    const what = p.kind === 'loan' ? `${esc(p.rate)}; ${esc(p.rows[0].label)}` : `${esc(p.share)}; ${esc(p.max)}`
    return `<tr><td><b>${esc(p.title)}</b><br><span class="note">${esc(routeOf(p))}</span></td><td>${p.kind}</td><td>${what}</td><td>${fit(p.newStartup)}</td><td>${fit(p.established)}</td></tr>`
  }).join('')
  return page(s.title, 'Stream', `
<p class="lede">${esc(s.line)}</p>
<section><h2>What runs in this stream</h2><table><tr><th>Program</th><th>Kind</th><th>What it gives</th><th>New startup</th><th>2+ years</th></tr>${rows}</table></section>
${planOf(s.plan, 'The sequence')}`)
}

function stagePage(st) {
  const all = [...LOANS.map(l => ({ ...l, kind: 'loan' })), ...GRANTS.map(g => ({ ...g, kind: 'grant' }))]
  const open = all.filter(p => yes(p[st.key])), shut = all.filter(p => !yes(p[st.key]))
  const list = (ps, why) => ps.map(p => `<tr><td><b>${esc(p.title)}</b></td><td>${p.kind}</td><td>${esc(why ? p.who : p[st.key])}</td></tr>`).join('')
  const loanBars = hbars(LOANS.filter(l => yes(l[st.key])).map(l => {
    const r = l.rows.length > 1 && st.key === 'established' ? l.rows[l.rows.length - 1] : l.rows[0]
    return { label: l.title, value: r.total || 0.001, color: 'var(--loan)', text: dollars(r.total) + ' interest' }
  }))
  return page(st.title, 'Stage', `
<p class="lede">${esc(st.line)}</p>
<section><h2>Open to you: ${open.length} of ${all.length}</h2><table><tr><th>Program</th><th>Kind</th><th>Fit</th></tr>${list(open)}</table></section>
<section><h2>Loans you can take, by total interest</h2>${loanBars}</section>
<section><h2>Not yet</h2><table><tr><th>Program</th><th>Kind</th><th>Needs</th></tr>${list(shut, true)}</table></section>`)
}

function calendarPage() {
  const start = Date.parse('2026-10-15'), end = Date.parse('2027-06-01'), width = 820, left = 10, plotW = width - 20
  const x = d => left + plotW * (Date.parse(d) - start) / (end - start)
  const colour = { closed: 'var(--warn)', soon: 'var(--accent)', open: 'var(--grant)', watch: 'var(--loan)' }
  const sorted = CALENDAR.slice().sort((a, b) => a.when < b.when ? -1 : 1)
  let svg = `<line x1="${left}" x2="${width - 10}" y1="30" y2="30" stroke="var(--line)" stroke-width="2"/>`
  for (const m of ['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01', '2027-04-01', '2027-05-01']) {
    svg += `<line x1="${x(m).toFixed(1)}" x2="${x(m).toFixed(1)}" y1="24" y2="36" stroke="var(--muted)"/><text x="${x(m).toFixed(1)}" y="16" text-anchor="middle" class="m">${new Date(m).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })}</text>`
  }
  sorted.forEach((c, i) => {
    const cx = x(c.when), y = 60 + i * 26
    svg += `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="30" y2="${y - 6}" stroke="${colour[c.state]}" stroke-dasharray="2 3"/><circle cx="${cx.toFixed(1)}" cy="30" r="5" fill="${colour[c.state]}"/><text x="${(cx + 8).toFixed(1)}" y="${y}" ${cx > width * 0.6 ? `text-anchor="end" dx="-16"` : ''}>${esc(c.what)}</text>`
  })
  const h = 60 + sorted.length * 26
  const legend = Object.entries(colour).map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join('')
  const rows = sorted.map(c => `<tr><td>${esc(c.shown)}</td><td>${esc(c.what)}</td><td><span class="pill">${c.state}</span></td></tr>`).join('')
  return page('Intake calendar', 'When to apply', `
<p class="lede">What is open, what is coming, and what to watch, from the sheet as of ${AS_OF}. Dates marked "around" are the sheet's expectation, not a published date.</p>
<section><svg viewBox="0 0 ${width} ${h}" role="img">${svg}</svg><div class="legend">${legend}</div></section>
<section><table><tr><th>Date</th><th>What</th><th>State</th></tr>${rows}</table></section>`)
}

function overviewPage() {
  const loanBars = hbars(LOANS.flatMap(l => l.rows.map(r => ({ label: `${l.title}${l.rows.length > 1 ? ' · ' + r.label.split(' over')[0] : ''}`, value: r.total || 0.001, color: 'var(--loan)', text: dollars(r.total) })))
    .sort((a, b) => a.value - b.value))
  const grantBars = hbars(GRANTS.filter(g => g.maxK).sort((a, b) => b.maxK - a.maxK).map(g => ({ label: g.title, value: g.maxK, color: 'var(--grant)', text: `${money(g.maxK)} ${g.unit}` })))
  const all = [...LOANS.map(l => ({ ...l, kind: 'loan' })), ...GRANTS.map(g => ({ ...g, kind: 'grant' }))]
  const matrix = all.map(p => `<tr><td><b>${esc(p.title)}</b></td><td>${p.kind}</td><td>${fit(p.newStartup)}</td><td>${fit(p.established)}</td></tr>`).join('')
  const streams = STREAMS.map(s => `<tr><td><b>${esc(s.title)}</b><br><span class="note">/${ROOT}/streams/${s.name}</span></td><td>${esc(s.line)}</td></tr>`).join('')
  return page('Funding: loans and grants', 'BC and Canada · no equity', `
<p class="lede">Every loan and grant open to a BC tech company with founders over 40, mapped as streams that can run at the same time. The cheapest loans are PacifiCan BSP (0%, established high-growth firms only), then Vancity and CSBFP at about 21 cents of interest per dollar borrowed. NRC IRAP and SR&ED are the core non-repayable money, both open once incorporated.</p>
<section>${facts([['Programs mapped', `${LOANS.length} loans · ${GRANTS.length} grants`], ['Prime rate', '4.70% (Oct 29, 2026)'], ['Vancity and CSBFP', 'prime + 3% = 7.7%'], ['BDC', '9.5% assumed (unpublished)']])}</section>
<section><h2>The streams</h2><table>${streams}</table></section>
<section><h2>Loans by total interest paid</h2>${loanBars}<p class="note" style="margin-top:6px">PacifiCan BSP at 0% is shown at $5M; BDC Tech Equipment, Tech Companies and Working Capital at an illustrative $250K.</p></section>
<section><h2>Grants: the most one award pays</h2>${grantBars}<p class="note" style="margin-top:6px">SR&ED (35% of eligible R&D) and Canada Summer Jobs (per youth hire) have no single cap to chart.</p></section>
<section><h2>Who can use what</h2><table><tr><th>Program</th><th>Kind</th><th>New startup</th><th>2+ years in business</th></tr>${matrix}</table></section>`)
}

function sourcesPage() {
  return page('Sources', 'Where the figures come from', `
<p class="lede">The comparison sheet "BC & Canada Startup Funding: Loans and Grants Comparison", as of ${AS_OF}, drew on these.</p>
<section><ol class="plan">${SOURCES.map(s => `<li>${esc(s)}</li>`).join('')}</ol></section>
<section><h2>Assumptions</h2><ol class="plan">
<li>BC-based tech company; founders 40+; loans or grants only, no equity.</li>
<li>Prime 4.70% held flat for each loan's life.</li>
<li>BDC rate 9.5% assumed: BDC publishes neither its base rate nor its margin.</li>
<li>BDC repayment: equal monthly principal after the longest interest-only period allowed.</li>
<li>CSBFP's 2% fee is not in the interest totals.</li></ol></section>`)
}

// ── the tiles, in the order they are said ─────────────────────────────
const tiles = [
  { route: ROOT, file: 'overview.html', html: overviewPage() },
  { route: `${ROOT}/loans`, file: 'loans.html', html: page('Loans', 'Repaid, with interest', `<p class="lede">A new startup can use Vancity or CSBFP; every BDC loan needs revenue first. Sorted by total interest paid, lowest first.</p><section>${hbars(LOANS.map(l => ({ label: l.title, value: l.rows[0].total || 0.001, color: 'var(--loan)', text: dollars(l.rows[0].total) + ' · ' + l.rows[0].label.split(' (')[0] })).sort((a, b) => a.value - b.value))}</section>`) },
  ...LOANS.map(l => ({ route: `${ROOT}/loans/${l.name}`, file: `loan-${l.name}.html`, html: loanPage(l) })),
  { route: `${ROOT}/grants`, file: 'grants.html', html: page('Grants', 'Never repaid', `<p class="lede">NRC IRAP and SR&ED are the core non-repayable funding for a software company. Nearly all grants pay by reimbursement, so costs must be covered first.</p><section>${hbars(GRANTS.filter(g => g.maxK).sort((a, b) => b.maxK - a.maxK).map(g => ({ label: g.title, value: g.maxK, color: 'var(--grant)', text: `${money(g.maxK)} ${g.unit}` })))}</section>`) },
  ...GRANTS.map(g => ({ route: `${ROOT}/grants/${g.name}`, file: `grant-${g.name}.html`, html: grantPage(g) })),
  { route: `${ROOT}/streams`, file: 'streams.html', html: page('Streams', 'Multiple streams at once', `<p class="lede">Grants, loans and credits that can run side by side. Each stream has its own sequence.</p><section><table>${STREAMS.map(s => `<tr><td><b>${esc(s.title)}</b></td><td>${esc(s.line)}</td><td>${s.members.length} programs</td></tr>`).join('')}</table></section>`) },
  ...STREAMS.map(s => ({ route: `${ROOT}/streams/${s.name}`, file: `stream-${s.name}.html`, html: streamPage(s) })),
  { route: `${ROOT}/stages`, file: 'stages.html', html: page('Stages', 'Where you are decides what opens', `<p class="lede">The sheet compares two stages.</p><section><table>${STAGES.map(st => `<tr><td><b>${esc(st.title)}</b></td><td>${esc(st.line)}</td></tr>`).join('')}</table></section>`) },
  ...STAGES.map(st => ({ route: `${ROOT}/stages/${st.name}`, file: `stage-${st.name}.html`, html: stagePage(st) })),
  { route: `${ROOT}/calendar`, file: 'calendar.html', html: calendarPage() },
  { route: `${ROOT}/sources`, file: 'sources.html', html: sourcesPage() },
]

for (const t of tiles) fs.writeFileSync(path.join(OUT, t.file), t.html)
console.log(`${tiles.length} pages written to ${OUT}`)
if (!SAY) process.exit(0)

// ── say it into the hive ──────────────────────────────────────────────
const SAY_CJS = path.join(__dirname, 'say.cjs')
const say = (sentence, files = []) => {
  const args = [SAY_CJS, sentence, ...files.flatMap(f => ['--file', f]), '--listen', '2500']
  try {
    const out = execFileSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1', HIVE_CALLER: 'funding-hive' }, timeout: 180_000 })
    console.log(out.trim())
    return true
  } catch (e) {
    console.error(`FAILED: ${sentence}\n${String(e.stdout || '')}${String(e.stderr || e.message)}`)
    return false
  }
}
// --from <route> resumes a run the hive dropped partway through
const FROM = process.argv.includes('--from') ? process.argv[process.argv.indexOf('--from') + 1] : undefined
const start = FROM ? tiles.findIndex(t => t.route === FROM) : 0
if (start < 0) { console.error(`--from: no tile ${FROM}`); process.exit(2) }
for (const t of tiles.slice(start)) {
  if (!say(`go /`)) process.exit(1)
  if (!say(`create ${t.route}`)) process.exit(1)
  if (!say(`go /${t.route}`)) process.exit(1)
  if (!say(`website page {${t.file}}`, [path.join(OUT, t.file)])) process.exit(1)
}
say(`go /${ROOT}`)
