// breaks.spec.ts — the tick's promises, the triage's writes and the review's
// lock, pinned.
//
// Nothing else in the tree checks these. A warning must never open a
// conversation on its own. A triage must record what it showed and never
// rewrite a choice already made. The headless review may say only the
// read-and-interpret half of breaks.cjs — never `choose`, `resolve` or `note`,
// which are the participant's — and it runs without an API key unless asked.

import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const breaks = require_('./breaks.cjs')
const roster = require_('./agent-roster.cjs')

const GAP = 4 * 60 * 60_000
const NOW = 100 * GAP

let n = 0
const issue = (over: Record<string, unknown> = {}) => {
  n++
  return {
    fingerprint: `${'ab'.repeat(28)}${n.toString(16).padStart(8, '0')}`,
    type: 'error', status: 'open', rank: n, count: 1, sessions: 1,
    firstAt: 0, lastAt: 0, message: `break ${n}`, notes: [],
    ...over,
  }
}

describe('what a tick starts', () => {
  it('reviews new breaks, and never for new warnings alone', () => {
    const warning = issue({ type: 'warning', status: 'new' })
    expect(breaks.reviewable([warning])).toEqual([])
    const broke = issue({ status: 'new' })
    expect(breaks.reviewable([warning, broke])).toEqual([broke])
  })

  it('never opens a conversation for warnings alone', () => {
    const plan = breaks.planOffer([issue({ type: 'warning' }), issue({ type: 'warning', status: 'new' })], NOW, GAP)
    expect(plan.due).toEqual([])
    expect(plan.alsoShown).toEqual([])
  })

  it('opens one for a break nobody was shown, and shows the waiting warnings with it', () => {
    const broke = issue()
    const warning = issue({ type: 'warning' })
    const shownLongAgo = issue({ offeredAt: NOW - 2 * GAP })
    const plan = breaks.planOffer([broke, warning, shownLongAgo], NOW, GAP)
    expect(plan.due).toEqual([broke])
    expect(plan.alsoShown).toEqual([warning])
    expect(plan.waitMin).toBe(0)
  })

  it('opens nothing inside the gap of the last conversation', () => {
    const plan = breaks.planOffer([issue(), issue({ offeredAt: NOW - 60_000 })], NOW, GAP)
    expect(plan.due).toHaveLength(1)
    expect(plan.waitMin).toBeGreaterThan(0)
  })

  it('offers a chosen issue again once it sat unfinished past the gap — a warning too, since a person chose it', () => {
    const stranded = issue({ type: 'warning', status: 'chosen', offeredAt: NOW - GAP - 1 })
    const working = issue({ status: 'chosen', offeredAt: NOW - 60_000 })
    expect(breaks.planOffer([stranded, working], NOW, GAP).due).toEqual([stranded])
  })
})

describe('what a triage writes', () => {
  it('records every shown issue, tackles with the chosen mode, and moves the rest', () => {
    const a = issue()
    const b = issue()
    const c = issue()
    const { mode, patches } = breaks.planChoose([a, b, c], {
      mode: 'investigate',
      tackle: a.fingerprint,
      bottom: b.fingerprint,
      shown: [a, b, c].map(i => i.fingerprint).join(','),
    })
    const payloadOf = (i: { fingerprint: string }) => patches.find((p: { issue: unknown }) => p.issue === i).payload
    expect(mode).toBe('investigate')
    expect(payloadOf(a)).toMatchObject({ status: 'chosen', mode: 'investigate', offered: true })
    expect(payloadOf(b)).toMatchObject({ offered: true, rank: c.rank + 1 })
    expect(payloadOf(c)).toEqual({ offered: true })
  })

  it('resolves every id before anything is written', () => {
    const a = issue()
    expect(() => breaks.planChoose([a], { tackle: a.fingerprint, dismiss: 'ffffffff' })).toThrow(/no issue/)
  })

  it('refuses a decision that decides nothing', () => {
    expect(() => breaks.planChoose([issue()], { mode: 'fix' })).toThrow(/choose needs/)
  })
})

describe('the triage checklist', () => {
  it('lists breaks before warnings, under a line of their own', () => {
    const html: string = breaks.triageHtml([issue({ type: 'warning', title: 'warned first by rank' }), issue({ title: 'broke second by rank' })])
    const divider = html.indexOf('Warnings wait here')
    expect(html.indexOf('broke second by rank')).toBeLessThan(divider)
    expect(divider).toBeLessThan(html.indexOf('warned first by rank'))
  })

  it('tackles only newly checked rows, and records every row it showed', () => {
    const html: string = breaks.triageHtml([issue(), issue({ status: 'chosen', mode: 'investigate' })])
    expect(html).toContain("input[data-id]:checked:not([data-chosen])")
    expect(html).toContain("'--shown '")
  })

  it('escapes what a page threw', () => {
    expect(breaks.triageHtml([issue({ message: '<img src=x onerror=alert(1)>' })])).not.toContain('<img src=x')
  })
})

describe('the review lock', () => {
  const VERBS = ['status', 'compact', 'list', 'show', 'interpret']

  it("lets the review say only breaks.cjs's read-and-interpret verbs", () => {
    for (const rule of breaks.REVIEW_ALLOW as string[]) {
      const m = /^Bash\(node scripts\/bridge\/breaks\.cjs ([a-z]+)[^)]*\)$/.exec(rule)
      expect(m, rule).not.toBeNull()
      expect(VERBS, rule).toContain(m![1])
    }
  })

  it('spawns the shipped Claude Code bridge restricted, with no writing tools and nothing else approved', () => {
    const claude = roster.declared().find((a: { id: string }) => a.id === 'claude-bridge')
    const plan = breaks.reviewInvocation({ ...claude, bin: 'node' }, breaks.reviewPrompt(2))
    expect(plan.refused).toBe('')
    const args: string[] = plan.args
    expect(args).toContain('--restricted')
    expect(args).toContain('--strict-mcp-config')
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('dontAsk')
    const tools = args[args.indexOf('--tools') + 1].split(',')
    for (const writer of ['Edit', 'Write', 'NotebookEdit', 'WebFetch']) expect(tools).not.toContain(writer)
    for (const rule of breaks.REVIEW_ALLOW) expect(args).toContain(rule)
    for (const loose of ['acceptEdits', 'bypassPermissions', '--dangerously-skip-permissions']) expect(args).not.toContain(loose)
  })

  it('refuses to review through a bridge that cannot be locked', () => {
    const plan = breaks.reviewInvocation({ id: 'loose-bridge', bin: 'node', argv: ['-p', '{prompt}'], models: [] }, 'review')
    expect(plan.bin).toBe('')
    expect(plan.refused).toBeTruthy()
  })
})

describe('the environment a review gets', () => {
  it("drops an API key unless asked, and a host session's own variables", () => {
    const hosted = {
      PATH: 'p', ANTHROPIC_API_KEY: 'k', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'x',
      CLAUDE_CODE_GIT_BASH_PATH: 'g', ANTHROPIC_BASE_URL: 'http://host',
    }
    expect(breaks.childEnv(hosted, false)).toEqual({ PATH: 'p', CLAUDE_CODE_GIT_BASH_PATH: 'g' })
    expect(breaks.childEnv(hosted, true)).toEqual({ PATH: 'p', ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_GIT_BASH_PATH: 'g' })
  })

  it("keeps a machine's own settings when no host session is involved", () => {
    const plain = { PATH: 'p', ANTHROPIC_BASE_URL: 'http://gateway', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '9', ANTHROPIC_API_KEY: 'k' }
    expect(breaks.childEnv(plain, false)).toEqual({ PATH: 'p', ANTHROPIC_BASE_URL: 'http://gateway', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '9' })
  })
})

describe('taking back the marks a failed conversation left behind', () => {
  const issuesOf = (plan: Array<{ issue: unknown }>) => plan.map(p => p.issue)

  it('takes back only the exact mark the tick stamped', () => {
    const ours = issue({ offeredAt: 1_000 })
    const renewed = issue({ offeredAt: 5_000 })
    const plan = breaks.planRollback([
      { fingerprint: ours.fingerprint, offeredAt: 1_000, since: 900, until: 1_100 },
      { fingerprint: renewed.fingerprint, offeredAt: 1_000, since: 900, until: 1_100 },
    ], [ours, renewed])
    expect(issuesOf(plan)).toEqual([ours])
  })

  it('without the stamp, takes back a mark made inside the failed tick and nothing later', () => {
    const inside = issue({ offeredAt: 1_050 })
    const later = issue({ offeredAt: 9_000 })
    const plan = breaks.planRollback([
      { fingerprint: inside.fingerprint, since: 1_000, until: 1_100 },
      { fingerprint: later.fingerprint, since: 1_000, until: 1_100 },
    ], [inside, later])
    expect(issuesOf(plan)).toEqual([inside])
  })

  it('leaves an issue a person has chosen since, and forgets one that is gone', () => {
    const chosen = issue({ status: 'chosen', offeredAt: 1_000 })
    expect(breaks.planRollback([
      { fingerprint: chosen.fingerprint, offeredAt: 1_000, since: 900, until: 1_100 },
      { fingerprint: 'f'.repeat(64), offeredAt: 1_000, since: 900, until: 1_100 },
    ], [chosen])).toEqual([])
  })
})
