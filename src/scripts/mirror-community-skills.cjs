// Mirror pass for the COMMUNITY SKILLS top-100 — behaviors/assistant/skills/community-skills.
// Extends mirror-claude-skills.cjs (which built the skills census); never re-runs it.
//
// Curated 2026-07-31 from the ecosystem's own rankings: ComposioHQ/awesome-claude-skills,
// travisvn/awesome-claude-skills, MCP Market skills leaderboard, Agensi install counts,
// claudeskills.info. Ten domain collections, ~100 tiles, each a lazy-load POINTER
// (name + what + why notable + source) — the instructions stay in their repos until chosen.

const WebSocket = require('ws')
const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'

let counter = 0
function send(req) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE)
    const t = setTimeout(() => { try { ws.close() } catch {} ; reject(new Error('bridge timeout')) }, 180_000)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id: `mirror-community-${Date.now()}-${++counter}` })))
    ws.on('message', raw => {
      clearTimeout(t)
      try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) }
      ws.close()
    })
    ws.on('error', e => { clearTimeout(t); reject(e) })
  })
}

const must = async (req, what) => {
  const r = await send(req)
  if (!r.ok) throw new Error(`${what}: ${r.error}`)
  return r
}

const SKILLS = ['behaviors', 'assistant', 'skills']
const COMMUNITY = [...SKILLS, 'community-skills']

// [cell, note] — note = what it does + why it made the top 100 + source.
const DOMAINS = [

  ['engineering-method', 'How to WORK — methodology skills that change how a session approaches every task. The heaviest hitters in the whole ecosystem live here.', [
    ['superpowers', 'The most popular skill library in existence (~94K GitHub stars, accepted into the official Anthropic marketplace): 20+ battle-tested skills enforcing TDD, brainstorming, planning and disciplined execution as one methodology.\n\nsource: github.com/obra/superpowers'],
    ['karpathy-guard', 'The fastest-growing skill of 2026 (~144K stars in weeks): targets the three failure patterns Karpathy called out — silent wrong assumptions, over-engineering 50 lines into 500, and touching code you were never asked to touch.\n\nsource: Karpathy behavioural skill (see awesome-claude-skills)'],
    ['test-driven-development', 'Write the failing test before the implementation, always — the discipline skill invoked when implementing features or bugfixes.\n\nsource: obra/superpowers (TDD)'],
    ['subagent-driven-development', 'Dispatches subagents for individual tasks with code-review checkpoints between them — scale without losing review discipline.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['get-shit-done', 'Lightweight meta-prompting and spec-driven development system — spec first, then build to the spec.\n\nsource: travisvn/awesome-claude-skills'],
    ['brainstorming', 'Transforms rough ideas into fully-formed designs through structured questioning before any code is written.\n\nsource: obra/superpowers'],
    ['software-architecture', 'Clean Architecture, SOLID and design-pattern enforcement for structural decisions.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['root-cause-tracing', 'Traces errors deep into execution to find the ORIGINAL trigger instead of patching the symptom.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['using-git-worktrees', 'Isolated git worktrees with smart directory selection — parallel work without collisions.\n\nsource: obra/superpowers'],
    ['finishing-a-development-branch', 'Guides the END of work: merge/PR/cleanup options presented clearly instead of a dangling branch.\n\nsource: obra/superpowers'],
    ['review-implementing', 'Evaluates an implementation plan against its specification before code gets written.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['test-fixing', 'Detects failing tests and proposes minimal patches — repair without rewrites.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['kaizen', 'Continuous-improvement methodology applied to code and process — small analytical passes, compounding.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['truth-first', 'Anti-sycophancy: report what IS, not what the user hopes — top-12 by installs on the Agensi marketplace.\n\nsource: Agensi marketplace'],
    ['codex-grade-coding', 'Raises generated-code quality bar to reviewed-production standard — top-12 by installs.\n\nsource: Agensi marketplace'],
    ['overkill', 'Surfaces advanced alternatives with complexity rankings and learning links — know what the harder road buys you.\n\nsource: ComposioHQ/awesome-claude-skills'],
  ]],

  ['code-workflow', 'The daily loop — review, commits, PRs, changelogs, docs. The most-INSTALLED individual skills anywhere.', [
    ['code-reviewer', 'The #1 most-installed skill on the Agensi marketplace — structured review of diffs with severity-ranked findings.\n\nsource: Agensi marketplace'],
    ['git-commit-writer', '#2 by installs — conventional, scoped commit messages generated from the actual diff.\n\nsource: Agensi marketplace'],
    ['pr-description-writer', 'PR descriptions from the branch diff — what changed, why, how to test.\n\nsource: Agensi marketplace'],
    ['changelog-generator', 'User-facing changelogs distilled from git commits — release notes without archaeology.\n\nsource: Agensi marketplace'],
    ['readme-generator', 'Project READMEs generated from the codebase itself — top-5 by installs.\n\nsource: Agensi marketplace'],
    ['env-doctor', 'Diagnoses broken dev environments — missing vars, version drift, dependency conflicts.\n\nsource: Agensi marketplace'],
    ['git-pushing', 'Automates git operations and repository interactions end to end.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['prompt-engineer', 'Prompt-engineering techniques and Anthropic best practices applied to the prompts you are writing.\n\nsource: Agensi marketplace / ComposioHQ list'],
  ]],

  ['design-frontend', 'Making things look RIGHT — the most-used design skills, led by frontend-design at 277K+ installs.', [
    ['frontend-design', 'The most-used design skill in the ecosystem (277K+ installs, official Anthropic): commits to a bold conceptual direction before writing a line, to escape generic AI-slop aesthetics.\n\nsource: anthropics/skills (frontend-design)'],
    ['web-artifacts-builder', 'Complex multi-component HTML artifacts with React, Tailwind and shadcn/ui — official Anthropic.\n\nsource: anthropics/skills (artifacts-builder)'],
    ['ui-ux-pro-max', 'AI-powered design-system generation — one of the top recommended starter skills of 2026.\n\nsource: claudeskills.info / MoClaw rankings'],
    ['anydesign', 'Analyzes images, URLs or Figma files and extracts a structured design system from them.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['shadcn-ui', 'Component context and pattern enforcement for shadcn/ui — the library Claude most often builds with.\n\nsource: travisvn/awesome-claude-skills'],
    ['canvas-design', 'Visual art in PNG/PDF using real design principles — official Anthropic.\n\nsource: anthropics/skills (canvas-design)'],
    ['theme-factory', 'Professional font and colour themes applied across artifacts and documents.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['web-asset-generator', 'Favicons, app icons and social-media images generated to spec.\n\nsource: travisvn/awesome-claude-skills'],
    ['d3js-visualization', 'Interactive D3.js charts and data visualizations — beyond static plots.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['frontend-slides', 'Animation-rich HTML presentations; converts PowerPoint into living slides.\n\nsource: travisvn/awesome-claude-skills'],
    ['swiftui-design', 'SwiftUI frontend design with direction-setting and review passes.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['brand-guidelines', 'Applies a brand\'s official colours and typography to everything generated — official Anthropic pattern.\n\nsource: anthropics/skills (brand-guidelines)'],
  ]],

  ['testing-automation', 'Proving it works — browser, mobile and test-case automation.', [
    ['playwright-automation', 'Model-invoked Playwright browser automation — THE standard for testing web apps from a session.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['webapp-testing', 'Tests local web applications with Playwright for UI verification — official Anthropic.\n\nsource: anthropics/skills (webapp-testing)'],
    ['ios-simulator', 'Drives the iOS Simulator — build, navigate and test iOS apps through automation.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['expo-skills', 'Official skills by the Expo team for developing Expo/React Native applications.\n\nsource: travisvn/awesome-claude-skills'],
    ['chrome-relay', 'Drives the user\'s REAL Chrome session — cookies, SSO, localhost — where a clean browser can\'t follow.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['full-page-screenshot', 'Full-page captures via Chrome DevTools Protocol — proof, not description.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['pypict-test-cases', 'Comprehensive test-case design using Microsoft\'s PICT pairwise methodology.\n\nsource: ComposioHQ/awesome-claude-skills'],
  ]],

  ['security', 'Offense-informed defense — the professional-grade security skills.', [
    ['trail-of-bits-security', 'Trail of Bits\' own skill set: static analysis, variant analysis and vulnerability detection — the most credible security skills in the ecosystem.\n\nsource: Trail of Bits (see travisvn/awesome-claude-skills)'],
    ['ffuf-web-fuzzing', 'Expert ffuf web-fuzzing guidance for authorized penetration testing.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['threat-hunting-sigma', 'Hunts threats with Sigma detection rules across log sources.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['computer-forensics', 'Digital forensics analysis and investigation techniques.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['metadata-extraction', 'Extracts and analyzes file metadata for forensic purposes.\n\nsource: ComposioHQ/awesome-claude-skills'],
  ]],

  ['research-data', 'Finding out — deep research, data analysis, knowledge networks.', [
    ['deep-research', 'Autonomous multi-step research runs with planning, source gathering and synthesis.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['recursive-research', 'Research to PhD depth: recursive descent with source tiering and checkpointing.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['scientific-skills', 'Ready-to-use scientific computing skills with specialized libraries.\n\nsource: travisvn/awesome-claude-skills'],
    ['csv-summarizer', 'CSV analysis with generated insights and visualizations.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['postgres-readonly', 'Safe read-only SQL against PostgreSQL — query without fear.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['tapestry', 'Interlinks and summarizes related documents into knowledge networks — the closest thing out there to what the hive already is.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['notebooklm-integration', 'Source-grounded answers from a NotebookLM corpus.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['langsmith-fetch', 'Debugs LangChain agents by pulling execution traces from LangSmith.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['article-extractor', 'Full article text + metadata from web pages — clean input for everything downstream.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['youtube-transcript', 'Fetches YouTube transcripts and prepares summaries.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['reddit-fetch', 'Fetches Reddit content when normal web fetching is blocked.\n\nsource: ComposioHQ/awesome-claude-skills'],
  ]],

  ['content-seo', 'Being read — writing, SEO and audience skills.', [
    ['claude-seo', 'Full-stack SEO audits with live data — a top-3 recommended install of 2026.\n\nsource: MoClaw / claudeskills.info rankings'],
    ['humanize-writing', '#3 by installs on Agensi — strips the AI cadence out of prose.\n\nsource: Agensi marketplace'],
    ['seo-optimizer', 'On-page SEO optimization of existing content — top-12 by installs.\n\nsource: Agensi marketplace'],
    ['content-research-writer', 'High-quality long-form content with research and citations built in.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['building-blog', 'Adds an SEO-first blog to Next.js + Sanity sites via structured intake.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['twitter-optimizer', 'Analyzes and optimizes posts for reach and engagement.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['internal-comms', 'Status reports, newsletters and FAQs in a house voice — official Anthropic.\n\nsource: anthropics/skills (internal-comms)'],
    ['markdown-to-epub', 'Markdown documents into professional EPUB ebooks.\n\nsource: ComposioHQ/awesome-claude-skills'],
  ]],

  ['business-ops', 'Running the shop — sales, brand, admin and personal ops.', [
    ['lead-research-assistant', 'Identifies and qualifies high-quality leads with outreach strategies.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['competitive-ads-extractor', 'Extracts and analyzes competitors\' ads from ad libraries.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['brand-build-library', 'A 59-skill library covering the whole website lifecycle: brand, design, content, SEO.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['domain-brainstormer', 'Creative domain names with availability checks.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['tailored-resume', 'Analyzes a job description and generates a targeted resume.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['invoice-organizer', 'Organizes invoices automatically for tax preparation.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['meeting-insights', 'Mines meeting transcripts for behavioural patterns and leadership signals.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['file-organizer', 'Organizes files by context and finds duplicates.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['solo-skills', 'Seven bilingual skills for solo founders — launch tweets to postmortems.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['master-legal', 'Legal-team skill pack: NDA triage and citation verification.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['ship-learn-next', 'Iterates what to build next from real feedback loops.\n\nsource: ComposioHQ/awesome-claude-skills'],
  ]],

  ['media-creative', 'Making media — images, video, audio artifacts.', [
    ['imagen-generation', 'Image generation through Google Gemini\'s image API.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['image-enhancer', 'Improves resolution, sharpness and clarity of existing images.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['pixelbin-media', 'Generates and edits images and videos through an 85+ API portfolio.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['video-downloader', 'Downloads video from YouTube and other platforms for local processing.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['slack-gif-creator', 'Animated GIFs optimized to Slack\'s size constraints — official Anthropic.\n\nsource: anthropics/skills (slack-gif-creator)'],
  ]],

  ['integration-orchestration', 'Reaching everything else — app connectors, workflow engines, multi-agent packs.', [
    ['composio-connect', 'One skill, 1000+ apps: real actions across SaaS services (CRM, PM, email, calendar, e-commerce, analytics) with auth handled — the umbrella over ~80 per-app automation skills.\n\nsource: ComposioHQ (Connect / app automations)'],
    ['mcp-builder', 'Guides creation of high-quality MCP servers for any API — official Anthropic.\n\nsource: anthropics/skills (mcp-builder)'],
    ['skill-seekers', 'Converts ANY documentation website into a Claude skill — the skill that mints skills from docs.\n\nsource: travisvn/awesome-claude-skills'],
    ['n8n-skills', 'Understands and operates n8n workflow automations.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['google-workspace', 'Google Workspace suite integration with OAuth — Docs, Sheets, Drive, Calendar, Gmail.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['openweb', 'Agent-native website access through their APIs with auth auto-resolved.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['jules-delegation', 'Delegates coding tasks to Google\'s Jules agent for async bug fixes — cross-vendor orchestration.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['outline-wiki', 'Search, read, create and manage documents in Outline wikis.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['loki-mode', 'Multi-agent startup system orchestrating 37 agents across swarms — the most ambitious orchestration skill published.\n\nsource: travisvn/awesome-claude-skills'],
    ['great-cto', 'Seven specialized subagents covering the full SDLC pipeline.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['septim-agents', 'Ten named subagents: planning, architecture, marketing, finance, design, legal, customer, research, coordination.\n\nsource: ComposioHQ/awesome-claude-skills'],
    ['lean-ctx', 'Session caching and AST-aware context compression — more codebase per context window.\n\nsource: ComposioHQ/awesome-claude-skills'],
  ]],
]

const COMMUNITY_NOTE =
  'Community skills — the top 100 of the wider ecosystem, curated 2026-07-31.\n\n'
  + 'There are thousands of published Claude skills now; these are the ones the ecosystem itself ranks highest — by GitHub stars (superpowers ~94K, karpathy-guard ~144K), by installs (frontend-design 277K+, code-reviewer #1 on Agensi), by author credibility (Trail of Bits, Expo, Anthropic official), and by singular capability (skill-seekers, loki-mode, tapestry).\n\n'
  + 'Ten domains, each a collection: engineering-method, code-workflow, design-frontend, testing-automation, security, research-data, content-seo, business-ops, media-creative, integration-orchestration.\n\n'
  + 'Same lazy-load contract as the census above: every tile is a POINTER — name, what, why it ranks, where it lives. Nothing is installed or preloaded. When the bridge routes work that matches one, the session fetches THAT skill from its source repo at that moment, imports it, uses it in the workflow, and drops it.\n\n'
  + 'source: src/documentation/claude-skills.md (community section) — curated from ComposioHQ/awesome-claude-skills, travisvn/awesome-claude-skills, MCP Market leaderboard, Agensi installs, claudeskills.info'

async function main() {
  const before = await must({ op: 'layer-at', segments: SKILLS }, 'layer-at skills')
  const existing = await must({ op: 'inflate', segments: SKILLS }, 'inflate skills')
  const names = (existing.data?.children ?? []).map(c => c.name)
  if (!names.includes('hive-skills')) throw new Error('skills census missing — run mirror-claude-skills.cjs first')
  console.log('[mirror] existing skills groups:', names.join(', '))

  // 1. Union community-skills into the census collection.
  const children = [...names]
  if (!children.includes('community-skills')) children.push('community-skills')
  await must({ op: 'update', segments: SKILLS, layer: { children } }, 'update skills')

  // 2. Domains, then each domain's skills.
  await must({ op: 'update', segments: COMMUNITY, layer: { children: DOMAINS.map(d => d[0]) } }, 'update community children')
  for (const [domain, , parts] of DOMAINS) {
    await must({ op: 'update', segments: [...COMMUNITY, domain], layer: { children: parts.map(p => p[0]) } }, `update ${domain}`)
  }

  // 3. Pheromones on the collections.
  for (const segments of [COMMUNITY, ...DOMAINS.map(d => [...COMMUNITY, d[0]])]) {
    for (const name of ['assistant', 'skill']) {
      await must({ op: 'decoration-add', segments, kind: 'tag', appliesTo: [], payload: { name } }, `tag ${name}`)
    }
  }

  // 4. Notes — guarded; note-add is not idempotent.
  const noteIfEmpty = async (parentSegments, cell, text, label) => {
    const has = await send({ op: 'note-list', segments: [...parentSegments, cell] })
    const count = Array.isArray(has.data) ? has.data.length : (has.data?.notes?.length ?? 0)
    if (count) { console.log(`[mirror] ${label} already noted`); return }
    await must({ op: 'note-add', segments: parentSegments, cell, text }, `note ${label}`)
  }

  await noteIfEmpty(SKILLS, 'community-skills', COMMUNITY_NOTE, 'community-skills')
  for (const [domain, domainNote, parts] of DOMAINS) {
    await noteIfEmpty(COMMUNITY, domain, domainNote + '\n\nsource: src/documentation/claude-skills.md', domain)
    for (const [cell, note] of parts) {
      await noteIfEmpty([...COMMUNITY, domain], cell, note, `${domain}/${cell}`)
    }
  }

  // 5. Verify with fresh path-addressed reads.
  let total = 0
  for (const [domain, , parts] of DOMAINS) {
    const check = await must({ op: 'layer-at', segments: [...COMMUNITY, domain] }, `verify ${domain}`)
    const n = (check.data?.children ?? []).length
    total += n
    console.log(`[mirror] ${domain}: ${n} children`)
    for (const [cell] of parts) {
      const notes = await send({ op: 'note-list', segments: [...COMMUNITY, domain, cell] })
      const c = Array.isArray(notes.data) ? notes.data.length : (notes.data?.notes?.length ?? 0)
      if (!c) console.log(`[mirror] MISSING NOTE: ${domain}/${cell}`)
    }
  }
  console.log(`[mirror] done — ${total} skill tiles across ${DOMAINS.length} domains. before-head:`, JSON.stringify(before.data).slice(0, 100))
}

main().catch(err => { console.error('[mirror] FAILED:', err.message); process.exit(1) })
