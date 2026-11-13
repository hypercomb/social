// hypercomb-work-fence.managed.spec.ts — what the model is told, and what a
// write block may name, on a managed site door (jwize, 2026-11-13: "The whole
// idea is we are upgrading something that we replicated").
//
// The trial lesson assumed the try- debugger: "stage a trial", "do not
// publish", an address at try-<tile>.<this host> that no longer exists. On a
// managed page the hive holds a replica of the owner's card, a change shows on
// that card at once, and the owner's Publish sends it home. And the model can
// change the card itself — its details and its theme — not only the page.

import { afterEach, describe, expect, it } from 'vitest'
import {
  fileRanMessage, managedRule, pageChangeUnready, parseWriteBlock, sandboxRule, tileFileLabel, workInstruction,
} from './hypercomb-work-fence'

const mark = (): void => {
  const script = document.createElement('script')
  script.id = 'hc-manage'
  script.type = 'application/json'
  script.textContent = JSON.stringify({ lineage: 'business-card', title: 'Business card' })
  document.head.appendChild(script)
}

afterEach(() => { document.getElementById('hc-manage')?.remove() })

const base = { canRead: true, readsRunFreely: true, readsPerBlock: 2, canChange: true, vocabulary: '/x', canWriteFiles: true }
const site = { lineage: 'business-card', title: 'Business card' }

describe('the lesson on a managed site door', () => {
  const lesson = workInstruction({ ...base, managed: site })

  it('teaches the page and the card, and never the trial', () => {
    expect(lesson).toContain('WRITING FILES')
    expect(lesson).toContain('page /<route>')
    expect(lesson).toContain('the card this page holds is /business-card')
    expect(lesson).toContain('A change shows on the card at once')
    for (const trial of ['try-<tile>', 'trial card', 'Do not publish it', 'code trialOrigin', 'SANDBOX line', 'stage']) {
      expect(lesson).not.toContain(trial)
    }
  })

  it('teaches the card target and its shape: details and theme, each one JSON object, read first', () => {
    expect(lesson).toContain('WRITING THE CARD')
    expect(lesson).toContain('`card /<route>`')
    expect(lesson).toContain('`card /<route> theme`')
    expect(lesson).toContain('`card /business-card`')
    expect(lesson).toContain('card:data, whose dataSig is the card\'s details and whose themeSig')
    expect(lesson).toContain('Read it first: read /business-card lists the card:data record by signature')
    expect(lesson).toContain('read <dataSig> or read <themeSig> opens the JSON as it is now')
  })

  it('is taught only where files can be written', () => {
    expect(workInstruction({ ...base, canWriteFiles: false, managed: site })).not.toContain('WRITING THE CARD')
  })

  it('says where the work stands in place of the SANDBOX line: a replica, nothing fenced, the owner publishes', () => {
    const rule = managedRule(site)
    expect(rule).toContain('It holds a replica of /business-card ("Business card"), the site its owner published')
    expect(rule).toContain('change anything it takes to make it better — the page, the card\'s details and theme, its code')
    expect(rule).toContain('Nothing on this page is fenced')
    expect(rule).toContain('A change shows on the card at once')
    expect(rule).toContain('There is no trial and no try- address')
    expect(rule).toContain('The owner\'s Publish sends the upgrade home to /business-card')
    expect(managedRule({ lineage: 'business-card', title: 'business-card' })).not.toContain('("business-card")')
  })

  it('asks only that the page be read before it changes — there is no trial code to look up', () => {
    expect(pageChangeUnready(['business-card'], [], { managed: true })).toContain('read /business-card')
    expect(pageChangeUnready(['business-card'], [], { managed: true })).not.toContain('trialOrigin')
    expect(pageChangeUnready(['business-card'], ['read /business-card'], { managed: true })).toBeNull()
  })

  it('says a written file shows on the card, and names no trial even if one is handed in', () => {
    const told = fileRanMessage({ label: 'card /business-card', sig: 'a'.repeat(64), created: false, unchanged: false, trial: 'https://try-x.example/', managed: true }, 'make my title bolder')
    expect(told).toContain('It shows on the card on this page now. The owner\'s Publish sends it home.')
    expect(told).not.toContain('SANDBOX')
    expect(told).not.toContain('trial card')
  })
})

describe('every other page, unchanged', () => {
  it('teaches the trial lesson and no card', () => {
    const lesson = workInstruction(base)
    expect(lesson).toContain('try-<tile>.<this host>')
    expect(lesson).toContain('code trialOrigin')
    expect(lesson).not.toContain('WRITING THE CARD')
    expect(lesson).toBe(workInstruction({ ...base, managed: undefined }))
    expect(sandboxRule('https://hypercomb.io/', '/press-kit')).toContain('https://try-press-kit.hypercomb.io/')
    expect(pageChangeUnready(['press-kit'], ['read /press-kit'])).toContain('code trialOrigin')
  })

  it('reads no card target in a write block', () => {
    expect(parseWriteBlock(['card /business-card', '{"name":"Jaime"}'])).toEqual({
      error: 'a hypercomb-write block starts with <module signature> <src/path.ts>, page /<tile>, file /<tile> <name.ext>, or doctrine <heading>, on its first line; the body follows',
    })
  })
})

describe('the card target in a write block', () => {
  it('is read on a managed site door: the details, or the theme', () => {
    mark()
    expect(parseWriteBlock(['card /business-card', '{"name":"Jaime"}'])).toEqual({
      target: 'card', route: ['business-card'], part: 'details', body: '{"name":"Jaime"}',
    })
    expect(parseWriteBlock(['`write card /business-card theme`', '{"accent":"#f5a623"}'])).toEqual({
      target: 'card', route: ['business-card'], part: 'theme', body: '{"accent":"#f5a623"}',
    })
    expect(parseWriteBlock(['card /business-card details', '{}'])).toMatchObject({ part: 'details' })
  })

  it('takes SEARCH/REPLACE edits like any file', () => {
    mark()
    expect(parseWriteBlock(['card /business-card', '<<<<<<< SEARCH', '"name": "J"', '=======', '"name": "Jaime"', '>>>>>>> REPLACE']))
      .toMatchObject({ target: 'card', edits: [{ find: '"name": "J"', replace: '"name": "Jaime"' }] })
  })

  it('refuses the hive root and an empty card, and names itself in the usage', () => {
    mark()
    expect(parseWriteBlock(['card /', '{}'])).toEqual({ error: 'name the tile the card is on: a route such as /business-card, not the hive root' })
    expect(parseWriteBlock(['card /business-card', '  '])).toEqual({ error: 'the write block has no body: the card would be empty' })
    expect(parseWriteBlock(['nonsense'])).toMatchObject({ error: expect.stringContaining('card /<tile> [theme]') })
  })

  it('leaves the page and file targets exactly as they were', () => {
    mark()
    expect(parseWriteBlock(['page /business-card', '<h1>Hi</h1>'])).toEqual({ target: 'page', route: ['business-card'], body: '<h1>Hi</h1>' })
    expect(parseWriteBlock(['file /business-card notes.md', '# n'])).toEqual({ target: 'file', route: ['business-card'], name: 'notes.md', body: '# n' })
  })

  it('is named in receipts as card /<tile> and card /<tile> theme', () => {
    expect(tileFileLabel({ target: 'card', route: ['business-card'], part: 'details' })).toBe('card /business-card')
    expect(tileFileLabel({ target: 'card', route: ['business-card'], part: 'theme' })).toBe('card /business-card theme')
    expect(tileFileLabel({ target: 'page', route: ['a', 'b'] })).toBe('page /a/b')
    expect(tileFileLabel({ target: 'file', route: ['a'], name: 'x.md' })).toBe('/a/x.md')
  })
})
