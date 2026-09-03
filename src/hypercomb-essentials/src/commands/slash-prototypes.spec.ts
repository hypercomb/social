// slash-prototypes.spec.ts — THE WORKSHOP SHELF.
//
// A prototype behaviour is IN THE GLOBAL — registered, invokable — but the
// palette conceals it until the participant opens the filter. The drone's
// #present seam is the one place that rule lives: concealed prototypes
// present as `hidden` (so every listing surface agrees), revealed ones ride
// through carrying `prototype: true` for the dimmed bottom-group rendering.

import { beforeEach, describe, expect, it } from 'vitest'

const registrations = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => registrations.set(key, value),
  get: (key: string) => registrations.get(key),
  whenReady: () => void 0,
  // The drone's module scope scans already-registered queens and subscribes
  // to future ones; these worlds add providers directly, so both are inert.
  list: () => [],
  onRegister: () => void 0,
}

const { SlashBehaviourDrone, PROTOTYPES_SHOWN_KEY } = await import('./slash-behaviour.drone.js')
type Drone = InstanceType<typeof SlashBehaviourDrone>

let ran: string[]

const freshDrone = (): Drone => {
  const drone = new SlashBehaviourDrone()
  drone.addProvider({
    name: 'test-provider',
    priority: 50,
    behaviours: [
      { name: 'settled', description: 'a finished behaviour' },
      { name: 'workbench', description: 'still being played into shape', prototype: true },
    ],
    execute: (behaviourName: string) => { ran.push(behaviourName) },
  })
  return drone
}

beforeEach(() => {
  localStorage.clear()
  ran = []
})

describe('the workshop shelf', () => {
  it('conceals a prototype from the palette while the shelf is closed', () => {
    const names = freshDrone().match('').map(m => m.behaviour.name)
    expect(names).toContain('settled')
    expect(names).not.toContain('workbench')
  })

  it('presents a concealed prototype as hidden, so every listing surface agrees', () => {
    const entry = freshDrone().entries().find(b => b.name === 'workbench')
    expect(entry?.hidden).toBe(true)
  })

  it('keeps a concealed prototype invokable — it is in the global either way', () => {
    freshDrone().execute('workbench', '')
    expect(ran).toEqual(['workbench'])
  })

  it('lists a revealed prototype, carrying the stage for the dimmed rendering', () => {
    localStorage.setItem(PROTOTYPES_SHOWN_KEY, 'on')
    const match = freshDrone().match('').find(m => m.behaviour.name === 'workbench')
    expect(match).toBeDefined()
    expect(match?.behaviour.prototype).toBe(true)
    expect(match?.behaviour.hidden).not.toBe(true)
  })

  it('takes effect on the very next read — no event plumbing between the toggle and the palette', () => {
    const drone = freshDrone()
    expect(drone.match('work')).toHaveLength(0)
    localStorage.setItem(PROTOTYPES_SHOWN_KEY, 'on')
    expect(drone.match('work')).toHaveLength(1)
    localStorage.setItem(PROTOTYPES_SHOWN_KEY, 'off')
    expect(drone.match('work')).toHaveLength(0)
  })

  it('executes a public canonical name without following aliases or hidden collisions', () => {
    const drone = new SlashBehaviourDrone()
    drone.addProvider({
      name: 'public-create',
      priority: 10,
      behaviours: [{ name: 'create', description: 'the public create behaviour' }],
      execute: (name: string) => { ran.push(`public:${name}`) },
    })
    drone.addProvider({
      name: 'collision',
      priority: 100,
      behaviours: [
        { name: 'trap', aliases: ['create'], description: 'an alias collision' },
        { name: 'create', description: 'a hidden primary collision', hidden: true },
      ],
      execute: (name: string) => { ran.push(`collision:${name}`) },
    })

    drone.executePublicCanonical('create', 'roadmap')
    expect(ran).toEqual(['public:create'])
  })
})
