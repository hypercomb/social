// website/style.queen.ts
//
// `style` — THIS TILE'S PAGE REACHES ITS LOOK BY SIGNATURE.
//
// A page made elsewhere carries its CSS inside itself. `style` lifts that CSS
// out into three atoms and leaves the page linking them (page-style.ts):
//
//   type    the faces
//   theme   the variables every rule reads
//   sheet   the rules
//
// WHY. What is inside a page belongs to that page alone. What is put once and
// named by its signature can be shared: every part of the page, and every
// other page cut from the same design, links the same three atoms, and the
// same atoms are minted from the same CSS whoever lifts it. A second page
// restyles by linking another theme atom; the rules do not change.
//
// The page looks the same before and after. Its rules are confined to a class
// derived from the CSS, and the page wraps itself in that class, so a lifted
// sheet cannot touch the hive around it.
//
// `parts` puts the same atoms for the parts it makes, so the two words agree
// by construction and either may be said first.

import { QueenBee, EffectBus, type MachineGrammar } from '@hypercomb/core'
import { commitPageSig } from '../files/page-commit.js'
import { inlineCssOf, withSharedStyle } from './page-cut.js'
import { ATOM_ORDER } from './page-style.js'
import { pageHtmlAt, putText, routeWords, shareStyle, standingAt } from './page-hive.js'

export class StyleQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'style'
  override description = 'Lift this tile\'s page style into shared sheets (faces, variables, rules) the page links by signature'
  override examples = [
    { input: '/style', result: 'Puts the page\'s CSS once as shared sheets and leaves the page linking them; it looks the same' },
  ]

  // OFFERED TO A MODEL. EDITING: the page this tile wears is replaced by the
  // same page linking its look; the page it replaces stays in the tile's
  // history. TILE: only this tile's own page changes.
  override machine: MachineGrammar = {
    forms: '',
    example: 'style',
    bare: true,
    reach: 'editing',
    scope: 'tile',
    consequence: 'Lifts the CSS written inside the page worn by the tile the participant stands on into up to three shared sheets, each put once and named by its signature: the faces, the variables on the root, and the rules. The page is replaced by the same page linking those sheets, and looks the same. A page with no CSS of its own is left alone. The page it replaces stays in the tile\'s history. The signatures are said in the activity log.',
  }

  protected async execute(): Promise<void> {
    const at = standingAt()
    const where = routeWords(at)
    if (at.length === 0) throw new Error('style lifts the look of the page a tile wears; walk into the tile first. Nothing was changed')

    const html = await pageHtmlAt(at)
    if (!html) throw new Error(`${where} wears no page. Nothing was changed`)
    const css = inlineCssOf(html)
    if (!css.trim()) {
      const message = `the page at ${where} carries no style of its own; nothing to lift`
      EffectBus.emit('toast:show', { type: 'info', message })
      return
    }

    const shared = await shareStyle(css, [])
    if (!shared.scope) throw new Error(`the style of ${where} could not be lifted. Nothing was changed`)
    const result = await commitPageSig(at, await putText(withSharedStyle(html, shared.head, shared.scope)))
    if (!result.ok) throw new Error(`the page could not be written: ${result.error}. Nothing was changed`)

    const lifted = ATOM_ORDER.filter(atom => shared.atoms[atom])
    const message = `lifted the style of ${where} into ${lifted.length} shared ${lifted.length === 1 ? 'sheet' : 'sheets'} (${lifted.join(', ')})`
    EffectBus.emit('toast:show', { type: 'success', message })
    EffectBus.emit('activity:log', {
      message: `${message}: ${lifted.map(atom => `${atom} ${shared.atoms[atom]}`).join(' · ')}`,
      icon: '●',
    })
  }
}

const _style = new StyleQueenBee()
window.ioc.register('@diamondcoreprocessor.com/StyleQueenBee', _style)
