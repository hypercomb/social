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

// ─── has the code moved? ────────────────────────────────────────────────
//
// The tick may say "every file this break blames changed after it last
// happened". That is evidence, never a verdict: it writes ONE note, holds the
// issue out of the list that SUMMONS a conversation, and nothing else. Only a
// person retires. These pin the parts that make a wrong reading cheap.

const HOLD = 14 * 24 * 60 * 60_000
const local = (over: Record<string, unknown> = {}) =>
  issue({ files: ['a/b.ts'], origins: ['http://localhost:4250'], lastAt: NOW - HOLD, ...over })
const movedAt = (fp: string, at: number, file = 'a/b.ts') => new Map([[fp, { at, file, files: 1 }]])
const noteText = (plan: { notes: { payload: { note: string } }[] }) => plan.notes.map(w => w.payload.note)

describe('the tick reading git', () => {
  it('notes and holds a dev-server break whose files all moved since it last broke', () => {
    const i = local()
    const plan = breaks.planMoved([i], movedAt(i.fingerprint, NOW), NOW, HOLD, [])
    expect([...plan.held]).toEqual([i.fingerprint])
    expect(plan.notes).toHaveLength(1)
    expect(plan.notes[0].payload.onlyIfStatus).toBe('open')
    expect(noteText(plan)[0].startsWith(breaks.MOVED)).toBe(true)
    // It names the competing explanation — it must never read as a verdict.
    expect(noteText(plan)[0]).toContain('not proof the bug is gone')
  })

  it('notes a chosen issue but never holds it — a person put it there by hand', () => {
    const i = local({ status: 'chosen' })
    const plan = breaks.planMoved([i], movedAt(i.fingerprint, NOW), NOW, HOLD, [])
    expect(plan.notes).toHaveLength(1)
    expect([...plan.held]).toEqual([])
  })

  it('says nothing when the code moved before the break last happened', () => {
    const i = local({ lastAt: NOW })
    const plan = breaks.planMoved([i], movedAt(i.fingerprint, NOW - 1), NOW, HOLD, [])
    expect(plan.notes).toEqual([])
    expect([...plan.held]).toEqual([])
  })

  it('never reads a break a real reader hit, or a warning, or one with no named file', () => {
    const deployed = local({ origins: ['http://localhost:4250', 'https://hypercomb.io'] })
    const warned = local({ type: 'warning' })
    const vague = local({ files: [] })
    for (const i of [deployed, warned, vague]) {
      expect(breaks.notable(i)).toBe(false)
      expect(breaks.planMoved([i], movedAt(i.fingerprint, NOW), NOW, HOLD, []).notes).toEqual([])
    }
  })

  it('writes one note ever, and a note a person wrote stops the hold', () => {
    const already = local({ notes: [{ at: NOW - 1, text: `${breaks.MOVED} said once` }] })
    const second = breaks.planMoved([already], movedAt(already.fingerprint, NOW), NOW, HOLD, [])
    expect(second.notes).toEqual([])
    expect([...second.held]).toEqual([already.fingerprint])

    const worked = local({ notes: [{ at: NOW - 1, text: `${breaks.MOVED} said once` }, { at: NOW, text: 'I looked, it is real' }] })
    const after = breaks.planMoved([worked], movedAt(worked.fingerprint, NOW), NOW, HOLD, [])
    expect(after.notes).toEqual([])
    expect([...after.held]).toEqual([])
  })

  it('releases the hold for good once it breaks again, and once the hold has run out', () => {
    const broke = local({ notes: [{ at: NOW - 1_000, text: `${breaks.MOVED} said once` }], lastAt: NOW })
    expect([...breaks.planMoved([broke], new Map(), NOW, HOLD, []).held]).toEqual([])

    const old = local({ notes: [{ at: NOW - HOLD - 1, text: `${breaks.MOVED} said once` }], lastAt: NOW - HOLD - 2 })
    expect([...breaks.planMoved([old], new Map(), NOW, HOLD, []).held]).toEqual([])
  })

  it('never reads an issue this very tick reopened', () => {
    const back = local()
    const plan = breaks.planMoved([back], movedAt(back.fingerprint, NOW), NOW, HOLD, [back.fingerprint])
    expect(plan.notes).toEqual([])
    expect([...plan.held]).toEqual([])
  })

  it('takes the OLDEST blamed file, so a vaguer review can never make a stronger claim', () => {
    // One file moved after the break, one before. Naming MORE files must make
    // the claim harder to earn, never easier.
    const i = local({ files: ['a/b.ts', 'c/d.ts'], lastAt: NOW - 1_000 })
    const at = (f: string) => (f === 'a/b.ts' ? NOW : NOW - 2_000)
    const moved = breaks.probeMoved([i], at)
    expect(moved.get(i.fingerprint)).toMatchObject({ at: NOW - 2_000, file: 'c/d.ts' })
    expect(breaks.planMoved([i], moved, NOW, HOLD, []).notes).toEqual([])

    // The same issue blaming only the file that DID move earns the note.
    const narrow = local({ files: ['a/b.ts'], lastAt: NOW - 1_000 })
    expect(breaks.planMoved([narrow], breaks.probeMoved([narrow], at), NOW, HOLD, []).notes).toHaveLength(1)
  })

  it('makes no claim at all when one blamed file cannot be read', () => {
    const i = local({ files: ['a/b.ts', 'gone.ts'] })
    const at = (f: string) => (f === 'a/b.ts' ? NOW : 0)
    expect(breaks.probeMoved([i], at).size).toBe(0)
  })
})

describe('a hold, and a retirement that can be proved wrong', () => {
  it('drops a held break from the conversation it would open, and nothing else', () => {
    const held = issue({ status: 'open' })
    const other = issue({ status: 'open' })
    const plan = breaks.planOffer([held, other], NOW, GAP, new Set([held.fingerprint]))
    expect(plan.due).toEqual([other])
  })

  it('never holds a chosen issue back from its conversation', () => {
    const chosen = issue({ status: 'chosen', offeredAt: NOW - GAP - 1 })
    const plan = breaks.planOffer([chosen], NOW, GAP, new Set([chosen.fingerprint]))
    expect(plan.due).toEqual([chosen])
  })

  it('un-retires anything that broke after it was retired, and reports wrong fixes too', () => {
    const wrong = issue({ status: 'retired', fixedAt: 1_000, lastAt: 2_000 })
    const holding = issue({ status: 'retired', fixedAt: 2_000, lastAt: 1_000 })
    const badFix = issue({ status: 'fixed', fixedAt: 1_000, lastAt: 2_000 })
    const plan = breaks.planUnretire([wrong, holding, badFix])
    expect(plan.map((w: { issue: { fingerprint: string } }) => w.issue)).toEqual([wrong])
    expect(plan[0].payload).toMatchObject({ status: 'open', onlyIfStatus: 'retired', offered: false })
    expect(plan[0].payload.note.startsWith('broke again')).toBe(true)
    expect(breaks.stillBreaking([wrong, holding, badFix]).map((r: { id: string }) => r.id))
      .toEqual([wrong, badFix].map(i => i.fingerprint.slice(0, 8)))
  })

  it('retires from a triage, and the checklist offers Retire where Dismiss was', () => {
    const i = issue({ status: 'open' })
    const { patches } = breaks.planChoose([i], { retire: i.fingerprint.slice(0, 8) })
    expect(patches).toEqual([{ issue: i, payload: { status: 'retired' } }])

    const html = breaks.triageHtml([issue({ status: 'open', notes: [{ at: NOW, text: `${breaks.MOVED} it moved` }] })])
    expect(html).toContain('<option value="retire">Retire</option>')
    expect(html).not.toContain('Dismiss')
    expect(html).toContain('code moved')
    expect(html).toContain("'--retire '")
  })
})

describe('a word the running hive has not learned', () => {
  it('says so instead of letting a Retire click look like it worked', () => {
    // The hive keeps a CLOSED status set and ignores a word it does not know,
    // so `retired` before an essentials rebuild would be a silent no-op.
    const i = issue({ status: 'chosen' })
    expect(() => breaks.took({ issue: { ...i, status: 'chosen' } }, { status: 'retired' }, i))
      .toThrow(/build:essentials/)
    expect(breaks.took({ issue: { ...i, status: 'retired' } }, { status: 'retired' }, i)).toBeTruthy()
    // A payload that says nothing about status is never second-guessed.
    expect(breaks.took({ issue: i }, { offered: true }, i)).toBeTruthy()
  })
})
