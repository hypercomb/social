// hypercomb-runtime/src/chat-window/ui/chat-window/chat-archive-and-rail-walk.spec.ts
//
// Two asks of jwize's, 2026-11-12, pinned where they live:
//
//  • THE ARCHIVE ASKS ONCE. The masthead's archive icon arms, and becomes
//    ONE confirm button with the icon to the left inside it; the confirm
//    files the thread and opens a fresh conversation on the same tile —
//    never "the next live thread".
//
//  • THE RAIL'S WALK IS THE ADDRESS BAR. Each level the left bar steps to is
//    a real history entry (Navigation.goRaw), the rail follows the address
//    back (showLevel), and leaving the chat returns the hive to where the
//    chat was started from.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The chat window runs without Angular (hypercomb-runtime/src/chat-window.ts):
// its template, its class and its compiled sheet are read where they live now.
import { CHAT_WINDOW_CSS as routeStyles } from '../../chat-window.styles'
const template = readFileSync(join(__dirname, '../../chat-window.template.ts'), 'utf8')
const source = readFileSync(join(__dirname, 'chat-window.ts'), 'utf8').replace(/\r\n/g, '\n')

/** The body of a class member, from its signature to the next member. */
const member = (signature: string): string => {
  const at = source.indexOf(signature)
  expect(at, signature).toBeGreaterThan(0)
  const next = source.indexOf('\n  /** ', at + signature.length)
  return source.slice(at, next > 0 ? next : undefined)
}

/** A top-level rule's body, as compiled and scoped. */
const rule = (selector: string): string => {
  const at = routeStyles.indexOf(`${selector}[_ngcontent-hc-chat] {`)
  expect(at, selector).toBeGreaterThan(0)
  return routeStyles.slice(at, routeStyles.indexOf('\n}', at))
}

describe('the masthead archive', () => {
  it('shows its confirm only while armed, in place of the icon, never for one already put away', () => {
    const confirm = template.indexOf('class: "chat-put-confirm"')
    expect(confirm).toBeGreaterThan(0)
    const gate = template.lastIndexOf('when([', confirm)
    expect(template.slice(gate, confirm)).toContain('[() => (c.archiveArmed() && !c.activeArchived()), () => [')
    const icon = template.indexOf('class: "chat-tool chat-put"', confirm)
    expect(icon).toBeGreaterThan(confirm)
    expect(template.slice(confirm, icon)).toContain('], () => [')
  })

  it('is ONE button: the icon to the left inside it, then its words', () => {
    const confirm = template.indexOf('class: "chat-put-confirm"')
    const button = template.slice(confirm, template.indexOf(']],', confirm))
    expect(button).toContain('on("click", (event: any) => c.confirmArchive())')
    const glyph = button.indexOf('text("archive")')
    const words = button.indexOf('txt(() => str(t("chat.archive.confirm")))')
    expect(glyph).toBeGreaterThan(0)
    expect(words).toBeGreaterThan(glyph)
    const body = rule('.chat-put-confirm')
    expect(body).toContain('display: inline-flex;')
    expect(body).not.toContain('position: absolute;')
  })

  it('arms on the first press and only un-filing acts at once', () => {
    const press = member('async archiveCurrent(): Promise<void> {')
    expect(press).toContain('this.archiveArmed.set(true)')
    expect(press).toContain('await this.archive(convoId, false)')
    expect(press).not.toContain('await this.archive(convoId, true)')
  })

  it('the confirm files it and opens a FRESH conversation on the same tile', () => {
    const confirm = member('async confirmArchive(): Promise<void> {')
    expect(confirm).toContain('await this.archive(convoId, true)')
    expect(confirm).toContain('newChatOnSubject')
    expect(confirm).toContain('this.#startAt(tile)')
    expect(confirm).not.toContain('!convo.archived && convo.convoId !== convoId')
  })
})

describe('the rail walk is the address bar', () => {
  it('a level the rail steps to is pushed as a real history entry', () => {
    expect(source).toContain('this.#rail.onLevelChanged = segments => { this.#walkTo(segments) }')
    expect(member('#walkTo(segments: readonly string[]): void {')).toContain('navigation.goRaw(next)')
  })

  it('going up onto the entry underneath is browser BACK, not a new push', () => {
    const walk = member('#walkTo(segments: readonly string[]): void {')
    expect(walk).toContain('state.hcBelow === parentAddress')
    expect(walk.indexOf('window.history.back()')).toBeLessThan(walk.indexOf('navigation.goRaw(next)'))
  })

  it('BACK / FORWARD move the rail to the address', () => {
    expect(member('#followHiveLocation(nextPath: string): void {')).toContain('rail.showLevel(next)')
  })

  it('leaving the chat unwinds the walk to where the chat was started from', () => {
    const wayBack = source.slice(source.indexOf('readonly #wayBack = effect('))
    expect(wayBack.slice(0, wayBack.indexOf('})\n'))).toContain('this.#returnToOrigin()')
    const unwind = member('#returnToOrigin(): void {')
    expect(unwind).toContain('window.history.go(-(depth + 1))')
    expect(unwind).toContain('navigation?.goRaw?.(origin)')
  })
})
