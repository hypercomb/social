// chat-window.i18n.spec.ts — the drift check the catalog split owes.
//
// The 14 shell catalogs drifted silently against en.json for years; a
// module-carried catalog must not inherit that. This pins the exact key set
// and its presence in every locale.
//
// ONE `agent.` KEY OF FIFTY-SEVEN. Sweeping that prefix would have taken the
// whole agent rail's vocabulary; `agent.rail-hive` is shared with
// agent-tiles-rail.ts and is carried here AND left in the shell, as is
// `chat.title` with the command line.
//
// `chat.context` is NOT a key — only `chat.context.one` and
// `chat.context.title.one/.other` exist. A base derived from a plural suffix
// is a phantom, not a missing entry.

import { describe, expect, it } from 'vitest'
import { CHAT_WINDOW_TRANSLATIONS } from './chat-window.i18n.js'

/** Exactly what this surface renders. */
const EXPECTED = [
  'agent.rail-hive',
  'chat.act.copy',
  'chat.act.edit',
  'chat.act.note',
  'chat.act.retry',
  'chat.answering',
  'chat.archive.put',
  'chat.archive.restore',
  'chat.archive.section',
  'chat.clipboard.empty',
  'chat.clipboard.paste',
  'chat.clipboard.show',
  'chat.clipboard.title',
  'chat.close',
  'chat.context.one',
  'chat.context.title.one',
  'chat.context.title.other',
  'chat.delete',
  'chat.delete.confirm',
  'chat.empty',
  'chat.goal.archive',
  'chat.goal.close',
  'chat.goal.open',
  'chat.goal.title',
  'chat.link.host',
  'chat.link.pending',
  'chat.link.pending.any',
  'chat.link.ready',
  'chat.link.ready.any',
  'chat.link.up',
  'chat.link.waiting',
  'chat.list.draft',
  'chat.list.empty',
  'chat.list.toggle',
  'chat.model',
  'chat.new',
  'chat.payload',
  'chat.peek.off',
  'chat.peek.on',
  'chat.placeholder',
  'chat.providers.hide',
  'chat.providers.show',
  'chat.queued',
  'chat.queued.wait',
  'chat.rail',
  'chat.rail.resize',
  'chat.reference.done',
  'chat.reference.empty',
  'chat.reference.look',
  'chat.reference.next',
  'chat.reference.off',
  'chat.reference.picture',
  'chat.reference.previous',
  'chat.scrollDown',
  'chat.selected.one',
  'chat.selected.other',
  'chat.send',
  'chat.setup.body',
  'chat.setup.complete.body',
  'chat.setup.complete.start',
  'chat.setup.complete.title',
  'chat.setup.copied',
  'chat.setup.copy',
  'chat.setup.host.connect',
  'chat.setup.host.placeholder',
  'chat.setup.host.title',
  'chat.setup.note',
  'chat.setup.skip',
  'chat.setup.starter',
  'chat.setup.step.broker.body',
  'chat.setup.step.broker.title',
  'chat.setup.step.broker.watching',
  'chat.setup.step.enable.action',
  'chat.setup.step.enable.body',
  'chat.setup.step.enable.loopback',
  'chat.setup.step.enable.title',
  'chat.setup.step.listen.body',
  'chat.setup.step.listen.title',
  'chat.setup.step.listen.try',
  'chat.setup.step.listen.waitingReply',
  'chat.setup.step.tools.body',
  'chat.setup.step.tools.done',
  'chat.setup.step.tools.title',
  'chat.setup.title',
  'chat.stop',
  'chat.subject.none',
  'chat.thinking',
  'chat.title',
  'chat.turns.one',
  'chat.turns.other',
  'chat.unattended',
  'chat.unattended.hint',
  'chat.unattended.hint.wait',
  'chat.untitled',
  'chat.withdraw',
].sort()

describe('chat-window catalog', () => {

  it('carries en — the fallback every other locale leans on', () => {
    expect(Object.keys(CHAT_WINDOW_TRANSLATIONS)).toContain('en')
  })

  it('carries exactly the surface’s key set', () => {
    expect(Object.keys(CHAT_WINDOW_TRANSLATIONS['en']).sort()).toEqual(EXPECTED)
  })

  it('every locale carries exactly the en key set — no silent drift', () => {
    for (const [locale, catalog] of Object.entries(CHAT_WINDOW_TRANSLATIONS)) {
      expect(Object.keys(catalog).sort(), `locale ${locale}`).toEqual(EXPECTED)
    }
  })

  it('every key belongs to this surface', () => {
    const prefixes = ["chat.", "agent."]
    for (const catalog of Object.values(CHAT_WINDOW_TRANSLATIONS)) {
      for (const key of Object.keys(catalog)) {
        expect(prefixes.some(prefix => key.startsWith(prefix)), key).toBe(true)
      }
    }
  })
})
