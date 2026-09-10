/*! @license
 * Bubble Bobble adaptation of Julian Rijken's BubbleBobble.
 * GPL-3.0-or-later; see COPYING and UPSTREAM.md for source and license.
 * https://github.com/JulianRijken/BubbleBobble/tree/6a59ee99e621f4061cab50802155b9c28c51c4f9
 */
// SPDX-License-Identifier: GPL-3.0-or-later
// Adapted from Julian Rijken's BubbleBobble, revision
// 6a59ee99e621f4061cab50802155b9c28c51c4f9 (GPL-3.0-or-later):
// src/Components/{CaptureBubble,OneWayPlatform,DeadEnemy,Pickup}.cpp,
// src/Components/Character/{Player/PlayerState,Enemys/ZenChan,
// Enemys/ZenChanBehaviour,Enemys/Maita,Enemys/MaitaBehaviour}.cpp,
// src/{Game,Prefabs}.cpp and their headers.
// https://github.com/JulianRijken/BubbleBobble/tree/6a59ee99e621f4061cab50802155b9c28c51c4f9
// Modified for Hypercomb, 2026-09-10: deterministic pixel-space physics,
// browser input, bounded entities, and single-player stage lifecycle.
// Upstream identifies Julian Rijken as author; it has no author/year
// copyright notice beyond the GPL license text. See COPYING and UPSTREAM.md.

import { BUILTIN_LEVELS } from './levels.js'

export const WIDTH = 256
export const HEIGHT = 224
export const TILE = 8
export type EnemyKind = 'zenchan' | 'mighta'
export interface LevelDef {
  name: string
  tiles: readonly string[]
  enemies: readonly { x: number; y: number; kind: EnemyKind }[]
  spawn: { x: number; y: number }
}
export interface Input { left: boolean; right: boolean; jump: boolean; blow: boolean }
export type GameState = 'ready' | 'playing' | 'clear' | 'gameover' | 'won'
interface Body { x: number; y: number; w: number; h: number; vx: number; vy: number; grounded: boolean }
export interface Player extends Body { facing: -1 | 1; invulnerable: number; dead: boolean }
export interface Enemy extends Body {
  id: number
  kind: EnemyKind
  state: 'walking' | 'trapped' | 'defeated'
  facing: -1 | 1
  angry: boolean
}
export interface Bubble { x: number; y: number; r: number; vx: number; vy: number; age: number; trappedId: number | null }
export interface Fruit { x: number; y: number; kind: number; points: number; age: number }
export interface Shot { x: number; y: number; vx: number; vy: number; age: number }
interface EnemyClock { face: number; jump: number; shot: number; airborne: boolean; defeat: number; bounces: number }

const overlaps = (a: {x: number; y: number; w: number; h: number}, b: {x: number; y: number; w: number; h: number}): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
const circleTouches = (x: number, y: number, r: number, body: Body): boolean => {
  const dx = x - Math.max(body.x, Math.min(x, body.x + body.w))
  const dy = y - Math.max(body.y, Math.min(y, body.y + body.h))
  return dx * dx + dy * dy < r * r
}
const emptyPlayer = (spawn: LevelDef['spawn']): Player => ({
  ...spawn, w: 16, h: 16, vx: 0, vy: 0, facing: 1, grounded: false, invulnerable: 3, dead: false,
})

/** Pure, fixed-substep port. Actors use top-left coordinates; circular entities use centers. */
export class Engine {
  state: GameState = 'ready'
  time = 0
  levelIndex = 0
  level: LevelDef
  score = 0
  lives = 3
  player: Player
  enemies: Enemy[] = []
  bubbles: Bubble[] = []
  fruit: Fruit[] = []
  shots: Shot[] = []
  readonly fx = { jump: 0, blow: 0, trap: 0, pop: 0, fruit: 0, hurt: 0, clear: 0 }

  private readonly levels: readonly LevelDef[]
  private readonly random: () => number
  private readonly clocks = new Map<number, EnemyClock>()
  private phaseTime = 0
  private shotCooldown = 0
  private jumpHeld = false
  private jumpOrigin = 0
  private manualAirControl = false
  private deathTime = 0

  constructor(levels: readonly LevelDef[] = BUILTIN_LEVELS, random: () => number = Math.random) {
    if (!levels.length) throw new Error('Bubble Bobble needs at least one level')
    if (levels.some(level => level.tiles.length !== HEIGHT / TILE || level.tiles.some(row => row.length !== WIDTH / TILE))) {
      throw new Error('Bubble Bobble levels must contain 28 rows of 32 tiles')
    }
    this.levels = levels
    this.random = random
    this.level = levels[0]
    this.player = emptyPlayer(this.level.spawn)
    this.loadLevel()
  }

  restart(): void {
    this.time = 0
    this.levelIndex = 0
    this.score = 0
    this.lives = 3
    // Event counters stay monotonic so a renderer cannot replay stale sounds.
    this.loadLevel()
  }

  update(dt: number, input: Input): void {
    if (!Number.isFinite(dt) || dt <= 0) return
    let jumpPressed = input.jump && !this.jumpHeld
    this.jumpHeld = input.jump
    if (this.state === 'gameover' || this.state === 'won') return
    // Large background-tab delays never become a single tunneling physics step.
    let remaining = Math.min(dt, 0.25)
    while (remaining > 0.000001) {
      const step = Math.min(remaining, 1 / 120)
      this.step(step, input, jumpPressed)
      jumpPressed = false
      remaining -= step
    }
  }

  private loadLevel(): void {
    this.level = this.levels[this.levelIndex]
    this.player = emptyPlayer(this.level.spawn)
    this.enemies = this.level.enemies.map((spawn, id) => ({
      ...spawn, id, w: 16, h: 16, vx: 0, vy: 0, grounded: false,
      facing: this.random() < 0.5 ? -1 : 1, state: 'walking', angry: false,
    }))
    this.clocks.clear()
    for (const enemy of this.enemies) this.clocks.set(enemy.id, {
      face: 2 + this.random() * 1.5, jump: 1 + this.random() * 0.5,
      shot: 5, airborne: false, defeat: 0, bounces: 0,
    })
    this.bubbles = []
    this.fruit = []
    this.shots = []
    this.state = 'ready'
    this.phaseTime = 0
    this.shotCooldown = 0
    this.deathTime = 0
    this.jumpHeld = false
    this.jumpOrigin = this.player.y
    this.manualAirControl = false
  }

  private step(dt: number, input: Input, jumpPressed: boolean): void {
    if (this.state === 'gameover' || this.state === 'won') return
    this.time += dt
    this.phaseTime += dt
    if (this.state === 'ready') {
      if (this.phaseTime >= 1) { this.state = 'playing'; this.phaseTime = 0 }
      return
    }
    this.shotCooldown = Math.max(0, this.shotCooldown - dt)
    this.movePlayer(dt, input, jumpPressed)
    for (const enemy of this.enemies) this.moveEnemy(enemy, dt)
    this.moveBubbles(dt, input)
    this.moveShots(dt)
    this.moveFruit(dt)

    if (this.state === 'playing' && !this.player.dead && !this.enemies.some(enemy => enemy.state !== 'defeated')) {
      this.state = 'clear'
      this.phaseTime = 0
      this.fx.clear++
      this.shots = []
    }
    if (this.state === 'clear' && this.phaseTime >= 3) {
      if (this.levelIndex + 1 >= this.levels.length) this.state = 'won'
      else { this.levelIndex++; this.loadLevel() }
    }
  }

  private movePlayer(dt: number, input: Input, jumpPressed: boolean): void {
    const p = this.player
    if (p.dead) {
      this.deathTime += dt
      if (this.deathTime >= 0.9) {
        if (this.lives <= 0) this.state = 'gameover'
        else { this.player = emptyPlayer(this.level.spawn); this.jumpOrigin = this.player.y; this.manualAirControl = false }
      }
      return
    }
    p.invulnerable = Math.max(0, p.invulnerable - dt)
    const direction = Number(input.right) - Number(input.left)
    if (direction) p.facing = direction < 0 ? -1 : 1
    if (p.grounded) {
      p.vx = direction * 64 // PlayerWalkingState::MOVE_SPEED, 8 pixels/unit.
      this.manualAirControl = false
      if (jumpPressed) {
        p.vy = -144 // PlayerJumpingState::JUMP_FORCE 18.
        p.grounded = false
        this.jumpOrigin = p.y
        this.fx.jump++
      }
    } else {
      // Preserve takeoff momentum until the player reverses, as in PlayerState.cpp.
      if (p.vx === 0 || direction * p.vx < 0) this.manualAirControl = true
      if (this.manualAirControl || p.vy >= 0) p.vx = direction * 32
    }
    p.vy += 240 * dt
    if (p.vy > 0 && p.y >= this.jumpOrigin) p.vy = 48
    const wasGrounded = p.grounded
    this.moveBody(p, dt)
    if (wasGrounded && !p.grounded && !jumpPressed) this.jumpOrigin = p.y
    if (p.grounded) this.jumpOrigin = p.y
    if (input.blow && this.shotCooldown <= 0 && this.bubbles.length < 24) {
      const r = 6
      const x = p.x + p.w / 2 + p.facing * (p.w / 2 + r + 1)
      const y = p.y + p.h / 2
      // A wall immediately in front produces a floating bubble at the muzzle.
      const blocked = this.tileAt(x, y) === '#'
      this.bubbles.push({
        x: blocked ? p.x + p.w / 2 : x, y, r,
        vx: blocked ? 0 : p.facing * 160, vy: 0, age: 0, trappedId: null,
      })
      this.shotCooldown = 0.4
      this.fx.blow++
    }
  }

  private moveEnemy(enemy: Enemy, dt: number): void {
    const clock = this.clocks.get(enemy.id)!
    if (enemy.state === 'trapped') return
    if (enemy.state === 'defeated') {
      clock.defeat += dt
      enemy.vy += 200 * dt
      const vx = enemy.vx, vy = enemy.vy
      const hit = this.moveBody(enemy, dt)
      if (hit.x) { enemy.vx = -vx * 0.8; clock.bounces++ }
      if (hit.y) { enemy.vy = -Math.abs(vy) * 0.65; clock.bounces++ }
      // DeadEnemy turns its bouncing sprite into a pickup. Bound the wait so
      // an airborne final kill still leaves collection time before stage change.
      if (clock.bounces >= 3 || clock.defeat >= 1.5) {
        this.fruit.push({ x: enemy.x + 8, y: enemy.y + 8, kind: enemy.kind === 'mighta' ? 0 : 1,
          points: enemy.kind === 'mighta' ? 200 : 100, age: 0 })
        this.enemies = this.enemies.filter(other => other !== enemy)
        this.clocks.delete(enemy.id)
      }
      return
    }
    clock.face -= dt
    clock.jump -= dt
    clock.shot -= dt
    const dx = this.player.x - enemy.x
    if (clock.face <= 0 && !this.player.dead) {
      if (Math.abs(dx) > 8) enemy.facing = dx < 0 ? -1 : 1
      clock.face = 2 + this.random() * 1.5
    }
    const speed = (enemy.kind === 'zenchan' ? 64 : 48) * (enemy.angry ? 1.8 : 1)
    if (enemy.grounded) {
      clock.airborne = false
      enemy.vx = enemy.facing * speed
      enemy.vy = 0
      if (clock.jump <= 0 && this.player.y + 8 < enemy.y && dx * enemy.facing >= 0 && this.platformAbove(enemy)) {
        // Two pixels/second of clearance compensates for fixed substeps at
        // ZenChan's exact five-cell jump height (Box2D used a smaller collider).
        enemy.vy = enemy.kind === 'zenchan' ? -82 : -98
        enemy.vx *= enemy.kind === 'zenchan' ? 0.2 : 0.5
        clock.airborne = true
        clock.jump = 1 + this.random() * 0.5
      }
    } else if (!clock.airborne) {
      enemy.vx = 0
      enemy.vy = (enemy.kind === 'zenchan' ? 40 : 64) * (enemy.angry ? 1.8 : 1)
    }
    enemy.vy += 80 * dt
    if (this.moveBody(enemy, dt).x) enemy.facing = enemy.facing === 1 ? -1 : 1
    if (enemy.kind === 'mighta' && clock.shot <= 0 && this.shots.length < 12 && this.state === 'playing') {
      const angle = (this.random() - 0.5)
      this.shots.push({ x: enemy.x + 8, y: enemy.y + 8, vx: Math.cos(angle) * 120 * enemy.facing,
        vy: Math.sin(angle) * 120, age: 0 })
      clock.shot = 5
    }
    if (this.state === 'playing' && overlaps(enemy, this.player)) this.hurt()
  }

  private platformAbove(enemy: Enemy): boolean {
    for (let y = enemy.y - TILE; y >= enemy.y - 5 * TILE; y -= TILE) {
      const tile = this.tileAt(enemy.x + 8, y)
      if (tile === '=' || tile === '#') return true
    }
    return false
  }

  private moveBubbles(dt: number, input: Input): void {
    const count = this.bubbles.length
    const center = count ? this.bubbles.reduce((sum, b) => ({ x: sum.x + b.x / count, y: sum.y + b.y / count }), { x: 0, y: 0 }) : { x: 128, y: 48 }
    const remove = new Set<Bubble>()
    for (const b of this.bubbles) {
      b.age += dt
      if (b.age >= 8) {
        const enemy = this.enemies.find(e => e.id === b.trappedId)
        if (enemy) {
          enemy.state = 'walking'
          enemy.angry = enemy.kind === 'zenchan' // ZenChan::OnRelease; Maita has no charge state.
          enemy.vx = 0; enemy.vy = 0; enemy.grounded = false
          this.clocks.get(enemy.id)!.airborne = false
        }
        remove.add(b)
        continue
      }
      // CaptureBubble::FixedUpdate: drag, random force, upward force after
      // one second, then attraction toward the other bubbles' center.
      b.vx += ((this.random() - 0.5) * 32 - b.vx) * dt
      b.vy += ((this.random() - 0.5) * 32 - b.vy) * dt
      if (b.age > 1) {
        if (b.y > 48) b.vy -= 24 * dt
        b.vx += (center.x - b.x) * 0.3 * dt
        b.vy += (center.y - b.y) * 0.3 * dt
      }
      b.x += b.vx * dt
      b.y += b.vy * dt
      // Bubbles ignore one-way ledges, bounce off full walls and gather under
      // the decorative roof; the fixed roof limit keeps them reachable.
      const left = this.tileAt(b.x - b.r, b.y) === '#'
      const right = this.tileAt(b.x + b.r, b.y) === '#'
      if (left && b.vx < 0) { b.x = (Math.floor((b.x - b.r) / TILE) + 1) * TILE + b.r; b.vx *= -0.8 }
      if (right && b.vx > 0) { b.x = Math.floor((b.x + b.r) / TILE) * TILE - b.r; b.vx *= -0.8 }
      b.x = Math.max(16 + b.r, Math.min(WIDTH - 16 - b.r, b.x))
      if (b.y < 24 + b.r) { b.y = 24 + b.r; b.vy = Math.max(0, -b.vy * 0.2) }
      const floor = this.bubbleFloor(b)
      if (b.y > floor - b.r) { b.y = floor - b.r; b.vy = -Math.abs(b.vy) }
      if (b.trappedId === null) {
        const enemy = this.enemies.find(e => e.state === 'walking' && circleTouches(b.x, b.y, b.r, e))
        if (enemy) {
          b.trappedId = enemy.id
          enemy.state = 'trapped'
          enemy.vx = 0; enemy.vy = 0
          this.fx.trap++
        }
      }
      const trapped = this.enemies.find(e => e.id === b.trappedId)
      if (trapped) { trapped.x = b.x - 8; trapped.y = b.y - 8 }
      if (b.age >= 1 && !this.player.dead && circleTouches(b.x, b.y, b.r + 1, this.player)) {
        const p = this.player
        const strength = Math.hypot(p.vx - b.vx, p.vy - b.vy) / TILE + b.age
        if (strength >= 15) {
          this.popBubble(b)
          remove.add(b)
        } else if (input.jump && p.vy > 0 && p.y + p.h <= b.y + b.r) {
          p.y = b.y - b.r - p.h
          p.vy = -144
          this.jumpOrigin = p.y
          this.fx.jump++
        }
      }
    }
    this.bubbles = this.bubbles.filter(b => !remove.has(b))
  }

  private popBubble(b: Bubble): void {
    this.fx.pop++
    const enemy = this.enemies.find(e => e.id === b.trappedId)
    if (!enemy) return
    enemy.state = 'defeated'
    enemy.vx = (this.random() < 0.5 ? -1 : 1) * (48 + this.random() * 24)
    enemy.vy = -120
    enemy.grounded = false
    this.clocks.get(enemy.id)!.defeat = 0
    this.score += 100
  }

  private moveShots(dt: number): void {
    const keep: Shot[] = []
    for (const shot of this.shots) {
      shot.age += dt
      const body: Body = { x: shot.x - 4, y: shot.y - 4, w: 8, h: 8, vx: shot.vx, vy: shot.vy + 80 * dt, grounded: false }
      const vx = body.vx, vy = body.vy
      const hit = this.moveBody(body, dt)
      shot.x = body.x + 4; shot.y = body.y + 4
      shot.vx = hit.x ? -vx * 0.9 : body.vx
      shot.vy = hit.y ? -Math.abs(vy) * 0.9 : body.vy
      if (!this.player.dead && circleTouches(shot.x, shot.y, 4, this.player)) { this.hurt(); continue }
      if (shot.age < 3) keep.push(shot)
    }
    this.shots = keep
  }

  private moveFruit(dt: number): void {
    const keep: Fruit[] = []
    for (const item of this.fruit) {
      item.age += dt
      const body: Body = { x: item.x - 6, y: item.y - 6, w: 12, h: 12, vx: 0, vy: 72, grounded: false }
      this.moveBody(body, dt)
      item.x = body.x + 6; item.y = body.y + 6
      if (!this.player.dead && circleTouches(item.x, item.y, 8, this.player)) { this.score += item.points; this.fx.fruit++ }
      else if (item.age < 10) keep.push(item)
    }
    this.fruit = keep
  }

  private hurt(): void {
    if (this.player.dead || this.player.invulnerable > 0 || this.state !== 'playing') return
    this.player.dead = true
    this.player.vx = 0; this.player.vy = 0
    this.deathTime = 0
    this.lives--
    this.fx.hurt++
  }

  private tileAt(x: number, y: number): string {
    return this.level.tiles[Math.floor(y / TILE)]?.[Math.floor(x / TILE)] ?? '.'
  }

  private bubbleFloor(bubble: Bubble): number {
    const left = Math.floor((bubble.x - bubble.r + 0.001) / TILE)
    const right = Math.floor((bubble.x + bubble.r - 0.001) / TILE)
    for (let row = Math.max(0, Math.floor(bubble.y / TILE)); row < this.level.tiles.length; row++) {
      for (let col = left; col <= right; col++) {
        if (this.level.tiles[row][col] === '#') return row * TILE
      }
    }
    return HEIGHT
  }

  private moveBody(body: Body, dt: number): { x: boolean; y: boolean } {
    const hit = { x: false, y: false }
    const startY = body.y
    body.x += body.vx * dt
    const x0 = Math.floor(body.x / TILE), x1 = Math.floor((body.x + body.w - 0.001) / TILE)
    const y0 = Math.floor(body.y / TILE), y1 = Math.floor((body.y + body.h - 0.001) / TILE)
    for (let row = y0; row <= y1; row++) for (let col = x0; col <= x1; col++) {
      if (this.level.tiles[row]?.[col] !== '#') continue
      if (body.vx > 0) body.x = Math.min(body.x, col * TILE - body.w)
      else if (body.vx < 0) body.x = Math.max(body.x, (col + 1) * TILE)
      if (body.vx) hit.x = true
    }
    if (body.x < 0) { body.x = 0; hit.x = true }
    if (body.x + body.w > WIDTH) { body.x = WIDTH - body.w; hit.x = true }
    if (hit.x) body.vx = 0
    body.y += body.vy * dt
    body.grounded = false
    const left = Math.floor((body.x + 0.001) / TILE), right = Math.floor((body.x + body.w - 0.001) / TILE)
    const top = Math.floor(body.y / TILE), bottom = Math.floor((body.y + body.h - 0.001) / TILE)
    for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) {
      const tile = this.level.tiles[row]?.[col]
      const landing = body.vy >= 0 && startY + body.h <= row * TILE + 0.01
      if (tile !== '#' && !(tile === '=' && landing)) continue
      if (body.vy >= 0 && landing) {
        body.y = Math.min(body.y, row * TILE - body.h)
        body.grounded = true; hit.y = true
      } else if (body.vy < 0 && tile === '#') {
        body.y = Math.max(body.y, (row + 1) * TILE)
        hit.y = true
      }
    }
    if (hit.y) body.vy = 0
    if (body.y < 24) { body.y = 24; body.vy = Math.max(0, body.vy) }
    // Empty bottom cells support vertical screen wrap in custom level data.
    if (body.y >= HEIGHT) { body.y = 24; body.grounded = false }
    return hit
  }
}

export { Engine as BubbleEngine }
