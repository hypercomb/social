import { describe, expect, it } from 'vitest'
import { questionFence } from '@hypercomb/core'
import {
  beeDirections,
  guideAsk,
  guideTileAsk,
  boardBox,
  hoverLine,
  ideaTask,
  kindOf,
  nearestPoint,
  optionsFromAnswer,
  payloadDetail,
  placeFromElement,
  ringCells,
  ringsFor,
  tileIdeas,
  tileReading,
  type GuideBehavior,
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

  it('opens the ideas for a tile, its own first, what the hive could add last', () => {
    const tile: GuideTile = {
      x: 4, y: 8, route: '/press-kit', label: 'press-kit', name: 'Press kit', behaviors: ['website'],
    }
    const offered: GuideBehavior[] = [
      { word: 'website', icon: 'web', about: '' },
      { word: 'slides', icon: 'slideshow', about: '' },
    ]
    const ideas = tileIdeas(tile, offered)
    expect(ideas[0]).toEqual({ id: 'own:website', icon: 'web', word: 'website', label: 'Change the page' })
    expect(ideas.map(idea => idea.label)).toContain('Say what this tile is for')
    expect(ideas.at(-1)).toEqual({ id: 'add:slides', icon: 'slideshow', word: 'slides', label: 'Add slides' })
    expect(ideas.map(idea => idea.label)).not.toContain('Add website')
    expect(new Set(ideas.map(idea => idea.id)).size).toBe(ideas.length)

    const many = Array.from({ length: 60 }, (_, index) => ({ word: `view ${index}`, icon: 'web', about: '' }))
    expect(tileIdeas(tile, many)).toHaveLength(36)

    const task = ideaTask(tile, ideas[0]!)
    expect(task).toContain('Task: Change the page.')
    expect(task).toContain('Press kit, at /press-kit')
    expect(task).toContain('Beehaviors: website.')

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
    const labels = tileIdeas(tile, []).map(idea => idea.label)
    expect(labels[0]).toBe('Use square tile view here')
    expect(labels).toContain('Change the page')
    expect(labels).toContain('See website on revolucionstyle.com')
  })

  it('fills rings outward from the tile, every cell distinct and none on the tile', () => {
    expect(ringsFor(0)).toBe(0)
    expect(ringsFor(1)).toBe(1)
    expect(ringsFor(6)).toBe(1)
    expect(ringsFor(7)).toBe(2)
    expect(ringsFor(18)).toBe(2)
    expect(ringsFor(19)).toBe(3)
    expect(ringsFor(36)).toBe(3)

    const cells = ringCells(18)
    expect(cells).toHaveLength(18)
    expect(new Set(cells.map(cell => `${cell.q},${cell.r}`)).size).toBe(18)
    const distance = (cell: { q: number; r: number }): number =>
      (Math.abs(cell.q) + Math.abs(cell.r) + Math.abs(cell.q + cell.r)) / 2
    expect(cells.slice(0, 6).every(cell => distance(cell) === 1)).toBe(true)
    expect(cells.slice(6).every(cell => distance(cell) === 2)).toBe(true)
  })

  it('finds the tile under the pointer, and none outside its reach', () => {
    const points = [{ x: 100, y: 100 }, { x: 200, y: 100 }]
    expect(nearestPoint(points, 110, 100, 50)).toBe(0)
    expect(nearestPoint(points, 170, 100, 50)).toBe(1)
    expect(nearestPoint(points, 150, 300, 50)).toBe(-1)
  })

  it('stands the board beside the middle, on the side with room', () => {
    const free = { left: 20, top: 72, right: 1420, bottom: 836 }
    const middle = { x: 720, y: 450 }
    const beside = boardBox(free, middle, 300, 'tiles')
    expect(beside.left).toBe(1048)
    expect(beside.width).toBe(320)
    expect(beside.middle).toBe(450)
    expect(beside.height).toBeUndefined()

    const list = boardBox(free, middle, 60, 'list')
    expect(list.left).toBe(808)
    expect(list.width).toBe(560)
    expect(list.top).toBe(72)
    expect(list.height).toBe(764)

    const crowded = boardBox({ ...free, right: 900 }, middle, 300, 'tiles')
    expect(crowded.left + crowded.width).toBeLessThanOrEqual(392)

    expect(beside.left).toBeGreaterThan(middle.x + 300)
  })
})
