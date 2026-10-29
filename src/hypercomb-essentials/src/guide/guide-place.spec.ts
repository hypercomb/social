import { describe, expect, it } from 'vitest'
import { questionFence } from '@hypercomb/core'
import {
  beeDirections,
  guideAsk,
  guideTileAsk,
  choiceAt,
  hoverLine,
  kindOf,
  optionsFromAnswer,
  payloadDetail,
  placeFromElement,
  tileReading,
  tileSuggestions,
  type GuideTile,
} from './guide-place.js'

describe('guide place', () => {
  it('reads a heading, a control, a picture, and a paragraph as different kinds', () => {
    const heading = document.createElement('h1')
    heading.textContent = 'Press kit'
    expect(kindOf(heading)).toBe('heading')

    const button = document.createElement('button')
    button.textContent = 'Open'
    expect(kindOf(button)).toBe('control')

    const image = document.createElement('img')
    image.alt = 'Bench'
    expect(kindOf(image)).toBe('media')

    const copy = document.createElement('p')
    copy.textContent = 'A sentence long enough to be the copy of a section rather than a label.'
    expect(kindOf(copy)).toBe('text')
  })

  it('names the element the participant pointed at', () => {
    const section = document.createElement('section')
    const heading = document.createElement('h2')
    heading.textContent = 'The bench'
    const copy = document.createElement('p')
    copy.textContent = 'A tidy bench for the work that is already in hand.'
    section.append(heading, copy)

    const place = placeFromElement(copy, { x: 12, y: 40 }, '/press-kit')
    expect(place.route).toBe('/press-kit')
    expect(place.kind).toBe('text')
    expect(place.heading).toBe('The bench')
    expect(place.name).toContain('tidy bench')
    expect(place.x).toBe(12)
  })

  it('offers four bee directions for a heading', () => {
    const heading = document.createElement('h1')
    heading.textContent = 'Press kit'
    const place = placeFromElement(heading, { x: 0, y: 0 }, '/')
    const directions = beeDirections(place)
    expect(directions.prompt).toBe('Which way should “Press kit” change?')
    expect(directions.options).toHaveLength(4)
    expect(new Set(directions.options).size).toBe(4)
    for (const option of directions.options) expect(option.length).toBeLessThanOrEqual(80)
  })

  it('reads an agent question fence', () => {
    const text = `Two ways.\n\n${questionFence('Which way should the heading change?', ['Make it shorter', 'Say who it is for'])}`
    expect(optionsFromAnswer(text)).toEqual({
      prompt: 'Which way should the heading change?',
      options: ['Make it shorter', 'Say who it is for'],
    })
  })

  it('reads a short list when the reply has no fence', () => {
    const text = ['Which way should the picture change?', '', '- Replace it', '- Add a caption', '- Remove it'].join('\n')
    expect(optionsFromAnswer(text)?.options).toEqual(['Replace it', 'Add a caption', 'Remove it'])
  })

  it('refuses a reply that is not a list of directions', () => {
    expect(optionsFromAnswer('I would rewrite the whole page in a single long paragraph that is not a choice.')).toBeNull()
    expect(optionsFromAnswer('- Only one')).toBeNull()
  })

  it('asks the agent for directions and refuses a write', () => {
    const heading = document.createElement('h1')
    heading.textContent = 'Press kit'
    const ask = guideAsk(placeFromElement(heading, { x: 1, y: 2 }, '/press-kit'))
    expect(ask).toContain('hypercomb-question')
    expect(ask).toContain('Do not write a page')
    expect(ask).toContain('Route: /press-kit')
    expect(ask).toContain('Name: Press kit')
  })

  it('names a tile beehaviors while the bee is over it', () => {
    const tile: GuideTile = {
      x: 0, y: 0, route: '/press-kit', label: 'press-kit', name: 'Press kit', behaviors: ['website', 'files'],
    }
    const line = hoverLine(tile)
    expect(line).toContain('Press kit')
    expect(line).toContain('website · files')
    expect(line).toContain('The page could say one thing more clearly.')
    expect(line).toContain('Stay a moment.')
    expect(hoverLine({ ...tile, behaviors: [] })).toContain('It could take one beehavior.')
  })

  it('offers suggestions after the bee dances and asks without writing', () => {
    const tile: GuideTile = {
      x: 4, y: 8, route: '/press-kit', label: 'press-kit', name: 'Press kit', behaviors: ['website'],
    }
    const suggestions = tileSuggestions(tile)
    expect(suggestions.prompt).toBe('Some choices')
    expect(suggestions.options[0]).toBe('Change the page')
    expect(suggestions.options.at(-1)).toBe('Leave it as it is')
    expect(suggestions.options.length).toBeGreaterThanOrEqual(2)
    expect(suggestions.options.length).toBeLessThanOrEqual(4)
    const ask = guideTileAsk(tile)
    expect(ask).toContain('hypercomb-question')
    expect(ask).toContain('Do not write a page')
    expect(ask).toContain('Beehaviors: website')
  })

  it('reads the data attached to a tile and where the same beehavior shows', () => {
    expect(payloadDetail({ htmlSig: 'a'.repeat(64), label: 'The bench' })).toBe('The bench')
    expect(payloadDetail({ htmlSig: 'a'.repeat(64) })).toBe('')
    expect(payloadDetail(['nope'])).toBe('')
    expect(payloadDetail({ text: 'x'.repeat(81) })).toBe('')

    const tile: GuideTile = {
      x: 4,
      y: 8,
      route: '/revolucion',
      label: 'revolucion',
      name: 'revolucion',
      behaviors: ['square tile view', 'website'],
      attached: [
        { name: 'square tile view', kind: 'visual:revolucion:welcome', detail: '' },
        { name: 'website', kind: 'visual:website:page', detail: 'The bench' },
      ],
      kin: [
        { name: 'website', where: '/about', domain: '' },
        { name: 'website', where: 'revolucion', domain: 'revolucionstyle.com' },
      ],
    }
    const line = hoverLine(tile)
    expect(line).toContain('The bench')
    expect(line).toContain('Also on revolucionstyle.com.')
    expect(tileReading(tile)).toBe(
      'Carries square tile view, website: The bench. website also sits at /about. website also shows on revolucionstyle.com.',
    )
    expect(tileReading({
      ...tile,
      attached: [
        { name: 'square tile view', kind: 'a', detail: 'Revolución' },
        { name: 'website', kind: 'b', detail: 'Revolución' },
      ],
      kin: [{ name: 'square tile view', where: '/susan', domain: '' }],
    })).toBe('Carries square tile view, website: Revolución. square tile view also sits at /susan.')
    const suggestions = tileSuggestions(tile)
    expect(suggestions.prompt).toContain('Carries square tile view, website: The bench.')
    expect(suggestions.prompt).toContain('also shows on revolucionstyle.com.')
    expect(suggestions.options[0]).toBe('Use square tile view here')
    expect(suggestions.options).toContain('See website on revolucionstyle.com')
    expect(suggestions.options).toContain('Change the page')
    expect(suggestions.options.at(-1)).toBe('Leave it as it is')
    expect(suggestions.options.length).toBeLessThanOrEqual(4)
  })

  it('picks a choice by the direction of a drag, and nothing inside the dead zone', () => {
    expect(choiceAt(0, 0, 4)).toBe(-1)
    expect(choiceAt(20, 0, 4)).toBe(-1)
    expect(choiceAt(120, 0, 4)).toBe(0)
    expect(choiceAt(0, 120, 4)).toBe(1)
    expect(choiceAt(-120, 0, 4)).toBe(2)
    expect(choiceAt(0, -120, 4)).toBe(3)
  })
})
