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
// Modified for Hypercomb, 2026-09-10 onward: living-round hydration and a
// progressively reconstructed DOS scheduler, actor, bubble, and score model.
// Upstream identifies Julian Rijken as author; it has no author/year
// copyright notice beyond the GPL license text. See COPYING and UPSTREAM.md.

import { BUILTIN_LEVELS } from './levels.js'
import { createDosOrdinaryFruit, stepDosOrdinaryFruit, type DosOrdinaryFruit } from './dos-fruit-mechanics.js'
import {
  advanceFixedValue,
  buildDosCollisionCells,
  buildDosCollisionMasks,
  DOS_DETERMINISTIC_SEED,
  DOS_ENEMY_HIGH_JUMP,
  DOS_ENEMY_HOP,
  DOS_PLAYER_BUBBLE_BOUNCE,
  DOS_PLAYER_JUMP,
  DOS_TICK_RATE,
  DOS_TICK_SECONDS,
  DosRandom,
  dosBlocksDirection,
  dosCollisionWord,
  snapDosCoordinate,
  wrapDosY,
} from './dos-mechanics.js'
import { CAVE_COLUMNS, CAVE_LEFT, CAVE_ROWS, CAVE_WIDTH, HEIGHT, TILE, WIDTH } from './dos-geometry.js'
export { CAVE_COLUMNS, CAVE_LEFT, CAVE_ROWS, CAVE_WIDTH, HEIGHT, TILE, WIDTH } from './dos-geometry.js'

export type EnemyKind = 'zenchan' | 'hidegons' | 'banebou' | 'pulpul'
  | 'monsta' | 'drunk' | 'mighta' | 'invader'
export interface EnemySpawn {
  x: number
  y: number
  kind: EnemyKind
  /** Native descriptor fields retained while their handlers are ported. */
  spawnDelay?: number
  activationDelayTicks?: number
  headingCode?: number
  variant?: number
}
export interface LevelDef {
  name: string
  tiles: readonly string[]
  /** Final DOS cell bytes after AIRFLOW/AIRBLOCK patches. Bit 0 is terrain;
   * bits 1-2 encode the native airflow direction. */
  nativeCells?: readonly (readonly number[])[]
  airflowSettings?: readonly [number, number, number]
  enemies: readonly EnemySpawn[]
  spawn: { x: number; y: number }
}
export interface Input { left: boolean; right: boolean; jump: boolean; blow: boolean }
export type GameState = 'ready' | 'playing' | 'clear' | 'gameover' | 'won'
interface Body { x: number; y: number; w: number; h: number; vx: number; vy: number; grounded: boolean }
export interface Player extends Body { facing: -1 | 1; invulnerable: number; dead: boolean }
export interface Enemy extends Body {
  id: number
  kind: EnemyKind
  state: 'entering' | 'waiting' | 'walking' | 'trapped' | 'defeated'
  facing: -1 | 1
  angry: boolean
  spawnDelay?: number
  activationDelayTicks?: number
  headingCode?: number
  variant?: number
}
export interface Bubble {
  x: number
  y: number
  r: number
  vx: number
  vy: number
  age: number
  trappedId: number | null
  phase: 'projectile' | 'floating'
  ticksRemaining: number
  travelRemaining: number
}
export interface Fruit {
  x: number; y: number; kind: number; points: number; age: number
  /** Native BE21 score display; custom-level fruit keeps the legacy item view. */
  phase?: 'item' | 'score'
}
export interface Shot {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  ownerId?: number
  kind?: 'rock' | 'fire' | 'bottle' | 'invader'
}
interface EnemyClock {
  face: number
  jump: number
  jumpWindup: number
  hopActive: boolean
  shot: number
  airborne: boolean
  defeat: number
  defeatDeadline: number | null
  bounces: number
  targetY: number
  activationTick: number | null
  zenChanInitPending: boolean
  dropKind: number
  dropPoints: number
}

const DOS_CHAIN_ITEMS = [0x12, 0x10, 0x11, 0x14, 0x46, 0x47, 0x50, 0x50] as const
const DOS_CHAIN_POINTS = [500, 1_000, 2_000, 4_000, 8_000, 16_000, 6_000, 6_000] as const
const DOS_MAX_FLOATING_BUBBLES = 0x12

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

/** Deterministic 60 Hz DOS-mechanics reconstruction. Actors use top-left
 * coordinates; circular entities use centers. */
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
  /** Read-only view of the installed campaign. Living hive rounds replace
   * their bundled seed in this private array before the engine enters them. */
  get levels(): readonly LevelDef[] { return this.levelSet }

  private readonly random: () => number
  private readonly nativeRandom: DosRandom
  private readonly nativeBranching: boolean
  private readonly levelSet: LevelDef[]
  private readonly installedLevels = new Set<number>()
  private livingLevels = false
  private readonly clocks = new Map<number, EnemyClock>()
  private readonly removals = new Set<Bubble>()
  private phaseTime = 0
  private shotCooldown = 0
  private shotCooldownTicks = 0
  private jumpHeld = false
  private jumpOrigin = 0
  private manualAirControl = false
  private deathTime = 0
  private accumulator = 0
  private pendingJump = false
  private nativeTick = 0
  /** Fixed-60 adapter for native DS:001C, intentionally separate from 011E. */
  private workTick = 0
  /** Ordinary DOS DS:0018: remaining eligible control-actor passes, not time. */
  private nativeClearPassesRemaining = 0
  /** Ordinary DOS DS:4D64: tracked enemies, including entering/trapped actors. */
  private readonly nativeTrackedEnemies = new Set<number>()
  private nativeIntro = false
  private nativeEnemyEntranceOpen = false
  private collisionMasks: Uint8Array | null = null
  private collisionCells: Uint8Array | null = null
  private nativeFruitStates = new WeakMap<Fruit, DosOrdinaryFruit>()
  private readyTicks = 0
  private popChain = 0
  private lastPopTick: number | null = null
  private ridingBubble: Bubble | null = null

  constructor(levels: readonly LevelDef[] = BUILTIN_LEVELS, random?: () => number) {
    if (!levels.length) throw new Error('Bubble Bobble needs at least one level')
    if (levels.some(level => level.tiles.length !== CAVE_ROWS || level.tiles.some(row => row.length !== CAVE_COLUMNS))) {
      throw new Error('Bubble Bobble levels must contain 25 rows of 32 tiles')
    }
    this.levelSet = [...levels]
    for (let index = 0; index < levels.length; index++) this.installedLevels.add(index)
    this.nativeRandom = new DosRandom(DOS_DETERMINISTIC_SEED)
    this.nativeBranching = random === undefined
    this.random = random ?? (() => this.nativeRandom.nextUnit())
    this.level = this.levelSet[0]
    this.player = emptyPlayer(this.level.spawn)
    this.loadLevel()
  }

  restart(): void {
    if (this.livingLevels && !this.installedLevels.has(0)) {
      throw new Error('Bubble Bobble ROUND 01 has not loaded from the hive')
    }
    this.time = 0
    this.accumulator = 0
    this.pendingJump = false
    this.nativeTick = 0
    this.workTick = 0
    this.nativeRandom.state = DOS_DETERMINISTIC_SEED
    this.levelIndex = 0
    this.score = 0
    this.lives = 3
    // Event counters stay monotonic so a renderer cannot replay stale sounds.
    this.loadLevel()
  }

  /** Switches campaign ownership to native hive layers. The bundled current
   * level remains only a non-running preview until round zero is installed. */
  useLivingLevels(): void {
    this.livingLevels = true
    this.installedLevels.clear()
  }

  /** Installs one validated hive-hydrated round. Simulation remains local and
   * never authors its per-frame state into the shared tile history. */
  installLevel(index: number, level: LevelDef): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.levelSet.length) {
      throw new Error('Bubble Bobble level index is outside the campaign')
    }
    if (level.tiles.length !== CAVE_ROWS || level.tiles.some(row => row.length !== CAVE_COLUMNS)) {
      throw new Error('Bubble Bobble levels must contain 25 rows of 32 tiles')
    }
    this.levelSet[index] = level
    this.installedLevels.add(index)
    if (this.livingLevels && index === this.levelIndex && this.time === 0 && this.state === 'ready') {
      this.loadLevel()
    }
  }

  update(dt: number, input: Input): void {
    if (!Number.isFinite(dt) || dt <= 0) return
    this.pendingJump ||= input.jump && !this.jumpHeld
    this.jumpHeld = input.jump
    if (this.state === 'gameover' || this.state === 'won') return
    // The DOS scheduler advances gameplay on its 60 Hz interrupt. Rendering
    // may call update at any cadence, but actors only observe whole DOS ticks.
    this.accumulator = Math.min(this.accumulator + Math.min(dt, 0.25), 0.25)
    while (this.accumulator + Number.EPSILON >= DOS_TICK_SECONDS) {
      this.step(DOS_TICK_SECONDS, input, this.pendingJump)
      this.pendingJump = false
      this.accumulator -= DOS_TICK_SECONDS
    }
  }

  private loadLevel(): void {
    this.level = this.levelSet[this.levelIndex]
    this.player = emptyPlayer(this.level.spawn)
    this.nativeIntro = this.level.nativeCells !== undefined
    if (this.nativeIntro) {
      // CS:0403 resets both native clock domains on each new round.
      this.nativeTick = 0
      this.workTick = 0
    }
    this.nativeEnemyEntranceOpen = false
    this.collisionMasks = this.level.nativeCells ? buildDosCollisionMasks(this.level.nativeCells) : null
    this.collisionCells = this.level.nativeCells ? buildDosCollisionCells(this.level.nativeCells) : null
    this.nativeFruitStates = new WeakMap()
    if (this.nativeIntro) this.player.y = 0
    this.enemies = this.level.enemies.map((spawn, id) => ({
      ...spawn,
      y: spawn.activationDelayTicks === undefined ? spawn.y : -1,
      id, w: 16, h: 16, vx: 0, vy: 0, grounded: false,
      facing: spawn.headingCode === undefined ? (this.random() < 0.5 ? -1 : 1) : (spawn.headingCode & 1 ? 1 : -1),
      state: spawn.activationDelayTicks === undefined ? 'walking' : 'entering', angry: false,
    }))
    this.nativeClearPassesRemaining = this.nativeIntro ? 0x258 : 0
    this.nativeTrackedEnemies.clear()
    if (this.nativeIntro) for (const enemy of this.enemies) this.nativeTrackedEnemies.add(enemy.id)
    this.clocks.clear()
    for (const enemy of this.enemies) this.clocks.set(enemy.id, {
      face: this.nativeIntro ? 0 : 2 + this.random() * 1.5,
      jump: this.nativeIntro ? 0 : 1 + this.random() * 0.5,
      jumpWindup: 0, hopActive: false, shot: 0, airborne: false, defeat: 0, defeatDeadline: null, bounces: 0,
      targetY: this.level.enemies[enemy.id].y, activationTick: null, zenChanInitPending: false,
      dropKind: DOS_CHAIN_ITEMS[0], dropPoints: DOS_CHAIN_POINTS[0],
    })
    this.bubbles = []
    this.fruit = []
    this.shots = []
    this.state = 'ready'
    this.phaseTime = 0
    this.shotCooldown = 0
    this.shotCooldownTicks = 0
    this.deathTime = 0
    this.jumpHeld = false
    this.jumpOrigin = this.player.y
    this.manualAirControl = false
    this.pendingJump = false
    this.readyTicks = 0
    this.popChain = 0
    this.lastPopTick = null
    this.ridingBubble = null
  }

  private step(dt: number, input: Input, jumpPressed: boolean): void {
    if (this.state === 'gameover' || this.state === 'won') return
    this.time += dt
    this.phaseTime += dt
    this.nativeTick = (this.nativeTick + 1) & 0xffff
    // One work increment per browser pass is a fixed-60 adaptation, not the
    // DOS display-interrupt batch scheduler. Keep deadlines in their own domain.
    this.workTick = (this.workTick + 1) & 0xffff
    if (this.state === 'ready') {
      // A917 observes the player-entry guard before moving an enemy. 896A
      // clears it only after a player invocation starts at y >= 0x20; keep the
      // engine latch open after that point even if later player state moves up.
      if (this.nativeIntro && this.player.y >= 0x20) this.nativeEnemyEntranceOpen = true
      for (const enemy of this.enemies) this.advanceEnemyEntrance(enemy)
      if (this.nativeIntro) {
        if (this.player.y !== this.level.spawn.y) {
          this.player.y += Math.min(2, this.level.spawn.y - this.player.y)
        } else if (++this.readyTicks >= 0x3c) {
          this.state = 'playing'
          this.phaseTime = 0
        }
      } else if (this.phaseTime + Number.EPSILON >= 1) {
        this.state = 'playing'
        this.phaseTime = 0
      }
      return
    }
    if (this.collisionMasks) this.shotCooldownTicks = Math.max(0, this.shotCooldownTicks - 1)
    else this.shotCooldown = Math.max(0, this.shotCooldown - dt)
    this.movePlayer(dt, input, jumpPressed)
    for (const enemy of this.enemies) this.moveEnemy(enemy, dt)
    this.moveBubbles(dt, input)
    this.moveShots(dt)
    this.moveFruit(dt)

    if (this.state === 'playing') {
      if (this.nativeIntro) {
        // CS:96B6..96CA decrements DS:0018 once per reached 9675 actor pass
        // only while tracked DS:4D64 is zero. This fixed-60 browser pass is
        // an explicit adapter, not a claim about original display timing.
        if (this.nativeTrackedEnemies.size === 0 && this.nativeClearPassesRemaining > 0) {
          this.nativeClearPassesRemaining--
          if (this.nativeClearPassesRemaining === 0) {
            this.state = 'clear'
            this.phaseTime = 0
            this.fx.clear++
            this.shots = []
          }
        }
      } else if (!this.player.dead && !this.enemies.some(enemy => enemy.state !== 'defeated')) {
        this.state = 'clear'
        this.phaseTime = 0
        this.fx.clear++
        this.shots = []
      }
    }
    if (this.state === 'clear' && (this.nativeIntro || this.phaseTime >= 3)) {
      // Native record-100 `won` remains a browser terminal adaptation, not
      // parity with DOS ED6A's unresolved ending presentation/lifecycle.
      if (this.levelIndex + 1 >= this.levelSet.length) this.state = 'won'
      else if (!this.livingLevels || this.installedLevels.has(this.levelIndex + 1)) {
        this.levelIndex++
        this.loadLevel()
      }
    }
  }

  private movePlayer(dt: number, input: Input, jumpPressed: boolean): void {
    const p = this.player
    if (p.dead) {
      this.deathTime += dt
      // CS:92CB schedules the death/respawn state 0xb4 (180) ticks ahead.
      if (this.deathTime + Number.EPSILON >= 0xb4 / DOS_TICK_RATE) {
        if (this.lives <= 0) this.state = 'gameover'
        else { this.player = emptyPlayer(this.level.spawn); this.jumpOrigin = this.player.y; this.manualAirControl = false }
      }
      return
    }
    p.invulnerable = Math.max(0, p.invulnerable - dt)
    if (this.collisionMasks && this.moveNativeRidingPlayer(input, jumpPressed)) return
    const direction = Number(input.right) - Number(input.left)
    const requestedFacing = direction < 0 ? -1 : direction > 0 ? 1 : 0
    const turning = requestedFacing !== 0 && requestedFacing !== p.facing
    if (requestedFacing) p.facing = requestedFacing
    if (p.grounded) {
      // CS:8E8A/8EBE reverses the stored velocity and facing first; movement
      // begins only if the same direction is still held on the following tick.
      p.vx = this.collisionMasks && turning ? 0 : direction * 60
      this.manualAirControl = false
      if (jumpPressed) {
        p.vy = DOS_PLAYER_JUMP.impulse * DOS_TICK_RATE / 0x100
        p.grounded = false
        this.jumpOrigin = p.y
        this.fx.jump++
        if (this.collisionMasks) {
          // CS:8C6F installs jump state 8D48 and returns. That state's first
          // acceleration/movement pass happens on the next general tick.
          p.vx = 0
          return
        }
      }
    } else if (this.collisionMasks) {
      p.vx = turning ? 0 : direction * 60
    } else {
      // Preserve takeoff momentum until the player reverses, as in PlayerState.cpp.
      if (p.vx === 0 || direction * p.vx < 0) this.manualAirControl = true
      if (this.manualAirControl || p.vy >= 0) p.vx = direction * 60
    }
    // The active 55-64 Hz native tuning pair is -720/+24 in 8.8 units.
    if (!p.grounded || !this.collisionMasks) {
      p.vy += DOS_PLAYER_JUMP.acceleration * DOS_TICK_RATE / 0x100
    }
    const wasGrounded = p.grounded
    this.moveBody(p, dt)
    if (wasGrounded && !p.grounded && !jumpPressed) this.jumpOrigin = p.y
    if (p.grounded) this.jumpOrigin = p.y
    const mayBlow = this.collisionMasks ? this.shotCooldownTicks === 0 : this.shotCooldown <= 0
    const hasBubbleSlot = this.collisionMasks ? true : this.bubbles.length < 24
    if (input.blow && mayBlow && hasBubbleSlot) {
      const r = 6
      const x = p.x + p.w / 2 + p.facing * (p.w / 2 + r + 1)
      const y = p.y + p.h / 2
      // A wall immediately in front produces a floating bubble at the muzzle.
      const blocked = this.tileAt(x, y) === '#'
      this.bubbles.push({
        x: blocked ? p.x + p.w / 2 : x, y, r,
        vx: blocked ? 0 : p.facing * 180, vy: 0, age: 0, trappedId: null,
        phase: blocked ? 'floating' : 'projectile',
        ticksRemaining: 0x1fe, travelRemaining: blocked ? 0 : 0x50,
      })
      // CS:8FFB seeds the player's input-state counter with 0x1f; the table at
      // DS:4C6A decrements it once per general tick before another shot.
      if (this.collisionMasks) this.shotCooldownTicks = 0x1f
      else this.shotCooldown = 0.4
      this.fx.blow++
    }
  }

  /** CS:8BD6..8C68: an untrapped bubble is a moving support state rather than
   * an immediate generic bounce. Jump installs the ordinary jump state and
   * movement begins on the following scheduler tick. */
  private moveNativeRidingPlayer(input: Input, jumpPressed: boolean): boolean {
    const bubble = this.ridingBubble
    if (!bubble || !this.bubbles.includes(bubble) || bubble.trappedId !== null) {
      this.ridingBubble = null
      return false
    }
    const p = this.player
    if (jumpPressed) {
      this.ridingBubble = null
      p.vx = 0
      p.vy = DOS_PLAYER_JUMP.impulse * DOS_TICK_RATE / 0x100
      p.grounded = false
      this.jumpOrigin = p.y
      this.fx.jump++
      return true
    }
    // Native left/right handling reverses the bubble and nudges its actor
    // coordinate three pixels before the player copies the support position.
    if (input.left && bubble.vx > 0) { bubble.vx = -bubble.vx; bubble.x -= 3 }
    else if (input.right && bubble.vx < 0) { bubble.vx = -bubble.vx; bubble.x += 3 }
    if (p.y >= 0xd8) {
      this.ridingBubble = null
      return false
    }
    p.x = bubble.x - 4
    p.y = bubble.y - 8
    p.vx = 0
    p.vy = 0
    p.grounded = false
    return true
  }

  private moveEnemy(enemy: Enemy, dt: number): void {
    const clock = this.clocks.get(enemy.id)!
    if (enemy.state === 'entering' || enemy.state === 'waiting') {
      this.advanceEnemyEntrance(enemy)
      return
    }
    if (clock.zenChanInitPending && enemy.state !== 'walking') clock.zenChanInitPending = false
    if (clock.zenChanInitPending) {
      // CS:D1C5 only installs Zen-Chan's walking state, velocity, and sprite;
      // D204 does not receive its first movement invocation until next tick.
      clock.zenChanInitPending = false
      enemy.vx = enemy.facing * 60
      return
    }
    if (enemy.state === 'trapped') return
    if (enemy.state === 'defeated') {
      if (this.collisionMasks) {
        // BBB4 schedules BBE5 for now + 0x3c. At that unsigned deadline BBE5
        // negates y velocity and schedules now + 0x41; normal player-pop y
        // starts negative, so BC26 reaches BC41 only at the second deadline.
        enemy.y = wrapDosY(advanceFixedValue(enemy.y,
          Math.round(enemy.vy * 0x100 / DOS_TICK_RATE)))
        enemy.x = advanceFixedValue(enemy.x,
          Math.round(enemy.vx * 0x100 / DOS_TICK_RATE))
        if (enemy.x < 0x38) { enemy.x = 0x38; enemy.vx = Math.abs(enemy.vx) }
        else if (enemy.x >= 0x108) { enemy.x = 0x108; enemy.vx = -Math.abs(enemy.vx) }
        if (clock.defeatDeadline === null) clock.defeatDeadline = (this.nativeTick + 0x3c) & 0xffff
        if (this.nativeTick >= clock.defeatDeadline) {
          clock.defeatDeadline = (this.nativeTick + 0x41) & 0xffff
          enemy.vy = -enemy.vy
          if (enemy.vy < 0) this.convertDefeatedEnemy(enemy, clock)
        }
        return
      }
      clock.defeat += dt
      enemy.vy += 200 * dt
      const vx = enemy.vx, vy = enemy.vy
      const hit = this.moveBody(enemy, dt)
      if (hit.x) { enemy.vx = -vx * 0.8; clock.bounces++ }
      if (hit.y) { enemy.vy = -Math.abs(vy) * 0.65; clock.bounces++ }
      // DeadEnemy turns its bouncing sprite into a pickup. Bound the wait so
      // an airborne final kill still leaves collection time before stage change.
      if (clock.bounces >= 3 || clock.defeat >= 1.5) {
        this.convertDefeatedEnemy(enemy, clock)
      }
      return
    }
    clock.face -= dt
    clock.jump -= dt
    clock.shot -= dt
    if (enemy.kind === 'monsta' || enemy.kind === 'pulpul') {
      this.moveFlyingEnemy(enemy, dt)
      if (this.state === 'playing' && overlaps(enemy, this.player)) this.hurt()
      return
    }
    if (enemy.kind === 'banebou') {
      this.moveBanebou(enemy, clock, dt)
      if (this.state === 'playing' && overlaps(enemy, this.player)) this.hurt()
      return
    }
    if (enemy.kind === 'invader') {
      this.moveInvader(enemy, clock, dt)
      if (this.state === 'playing' && overlaps(enemy, this.player)) this.hurt()
      return
    }
    if (this.collisionMasks && clock.jumpWindup > 0) {
      this.advanceEnemyJumpWindup(enemy, clock)
      if (this.state === 'playing' && overlaps(enemy, this.player)) this.hurt()
      return
    }
    if (this.collisionMasks && clock.hopActive) {
      enemy.vx = enemy.facing * 60 * (enemy.angry ? 2 : 1)
      if (this.moveBody(enemy, dt).x) enemy.facing = enemy.facing === 1 ? -1 : 1
      if (enemy.grounded) clock.hopActive = false
      else enemy.vy += DOS_ENEMY_HOP.acceleration * DOS_TICK_RATE / 0x100
      if (this.state === 'playing' && overlaps(enemy, this.player)) this.hurt()
      return
    }
    const dx = this.player.x - enemy.x
    if (!this.collisionMasks && clock.face <= 0 && !this.player.dead) {
      if (Math.abs(dx) > 8) enemy.facing = dx < 0 ? -1 : 1
      clock.face = 2 + this.random() * 1.5
    }
    const speed = 60 * (enemy.angry ? 2 : 1)
    let launched = false
    if (enemy.grounded) {
      clock.airborne = false
      enemy.vx = enemy.facing * speed
      enemy.vy = 0
      const nativeJump = this.collisionMasks ? this.tryNativeEnemyHighJump(enemy) : false
      const nativeHop = this.collisionMasks && !nativeJump ? this.tryNativeEnemyLowHop(enemy) : false
      const transitionalJump = !this.collisionMasks && clock.jump <= 0
        && this.player.y + 8 < enemy.y && dx * enemy.facing >= 0 && this.platformAbove(enemy)
      if (nativeJump) {
        // CS:A99F installs AA4A with a four-tick animation counter. The
        // impulse is loaded when that counter expires, and movement starts on
        // the next tick in AA89.
        clock.jumpWindup = 4
        enemy.vx = 0
        enemy.vy = 0
        if (this.state === 'playing' && overlaps(enemy, this.player)) this.hurt()
        return
      }
      if (nativeHop) {
        // CS:AAF6 installs AB7A and its small-hop impulse, then returns. AB7A
        // performs the first horizontal/vertical fixed-point pass next tick.
        enemy.vy = DOS_ENEMY_HOP.impulse * DOS_TICK_RATE / 0x100
        enemy.grounded = false
        clock.hopActive = true
        if (this.state === 'playing' && overlaps(enemy, this.player)) this.hurt()
        return
      }
      if (transitionalJump) {
        // Two pixels/second of clearance compensates for fixed substeps at
        // ZenChan's exact five-cell jump height (Box2D used a smaller collider).
        enemy.vy = DOS_ENEMY_HIGH_JUMP.impulse * DOS_TICK_RATE / 0x100
        enemy.vx *= 0.5
        clock.airborne = true
        launched = true
        if (!this.collisionMasks) clock.jump = 1 + this.random() * 0.5
      }
    } else if (!clock.airborne) {
      enemy.vx = 0
      enemy.vy = 60 * (enemy.angry ? 2 : 1)
    }
    // CS:AA89 applies the full impulse once before its first acceleration.
    const nativeRising = Boolean(this.collisionMasks && clock.airborne && enemy.vy < 0)
    if (!launched && !nativeRising && (!enemy.grounded || !this.collisionMasks)) {
      enemy.vy += DOS_ENEMY_HIGH_JUMP.acceleration * DOS_TICK_RATE / 0x100
    }
    if (this.moveBody(enemy, dt).x) enemy.facing = enemy.facing === 1 ? -1 : 1
    if (nativeRising) enemy.vy += DOS_ENEMY_HIGH_JUMP.acceleration * DOS_TICK_RATE / 0x100
    this.maybeFireHorizontal(enemy, clock)
    if (this.state === 'playing' && overlaps(enemy, this.player)) this.hurt()
  }

  /** CS:AA64 flips facing before AA6F decrements the four-tick counter.
   * AA75..AA84 installs ascent and its impulse without moving until next tick. */
  private advanceEnemyJumpWindup(enemy: Enemy, clock: EnemyClock): void {
    enemy.vx = 0
    enemy.vy = 0
    enemy.facing = enemy.facing === 1 ? -1 : 1
    clock.jumpWindup--
    if (clock.jumpWindup === 0) {
      enemy.vy = DOS_ENEMY_HIGH_JUMP.impulse * DOS_TICK_RATE / 0x100
      enemy.grounded = false
      clock.airborne = true
    }
  }

  /** MONSTA (0x10/0x10) and PULPUL (0x10/0x08) fly in descriptor directions. */
  private moveFlyingEnemy(enemy: Enemy, dt: number): void {
    if (enemy.vx === 0 && enemy.vy === 0) {
      const heading = enemy.headingCode ?? (enemy.facing > 0 ? 0x14 : 0x0a)
      const horizontal = heading & 0x04 ? 1 : heading & 0x02 ? -1 : enemy.facing
      const vertical = heading & 0x10 ? 1 : heading & 0x08 ? -1 : 1
      enemy.vx = horizontal * 60 * (enemy.angry ? 2 : 1)
      enemy.vy = vertical * (enemy.kind === 'pulpul' ? 30 : 60) * (enemy.angry ? 2 : 1)
      enemy.facing = horizontal < 0 ? -1 : 1
    }
    if (this.collisionMasks) {
      // DB25/DBF1 move vertically first, snap/reflect that component, then do
      // the same for x. Isolating each component preserves that native order
      // while reusing the exact actor mask predicates.
      const horizontal = enemy.vx
      const vertical = enemy.vy
      enemy.vx = 0
      const yHit = this.moveBody(enemy, dt).y
      enemy.vx = horizontal
      if (yHit) enemy.vy = -vertical

      const reflectedVertical = enemy.vy
      enemy.vy = 0
      const xHit = this.moveBody(enemy, dt).x
      enemy.vy = reflectedVertical
      if (xHit) {
        enemy.vx = -horizontal
        enemy.facing = enemy.vx < 0 ? -1 : 1
      }
      return
    }
    const oldX = enemy.x
    enemy.x += enemy.vx * dt
    if (enemy.x < CAVE_LEFT || enemy.x + enemy.w > CAVE_LEFT + CAVE_WIDTH || this.bodyTouchesTerrain(enemy, true)) {
      enemy.x = oldX
      enemy.vx = -enemy.vx
      enemy.facing = enemy.vx < 0 ? -1 : 1
    }
    const oldY = enemy.y
    enemy.y += enemy.vy * dt
    if (enemy.y < 0 || enemy.y + enemy.h > HEIGHT || this.bodyTouchesTerrain(enemy, true)) {
      enemy.y = oldY
      enemy.vy = -enemy.vy
    }
  }

  /** D882/D9E4: BANEBou alternates its small native hop with the shared high
   * jump. Both state installs return before their first movement pass. */
  private moveBanebou(enemy: Enemy, clock: EnemyClock, dt: number): void {
    if (this.collisionMasks) {
      if (clock.jumpWindup > 0) {
        this.advanceEnemyJumpWindup(enemy, clock)
        return
      }
      if (clock.airborne) {
        const rising = enemy.vy < 0
        if (!rising) enemy.vy += DOS_ENEMY_HIGH_JUMP.acceleration * DOS_TICK_RATE / 0x100
        this.moveBody(enemy, dt)
        if (rising) enemy.vy += DOS_ENEMY_HIGH_JUMP.acceleration * DOS_TICK_RATE / 0x100
        if (enemy.grounded) clock.airborne = false
        return
      }
      if (enemy.grounded) {
        if (this.tryNativeEnemyHighJump(enemy)) {
          clock.jumpWindup = 4
          enemy.vx = 0
          enemy.vy = 0
          return
        }
        enemy.vx = enemy.facing * 60 * (enemy.angry ? 2 : 1)
        enemy.vy = DOS_ENEMY_HOP.impulse * DOS_TICK_RATE / 0x100
        enemy.grounded = false
        clock.hopActive = true
        return
      }
      if (!clock.hopActive) {
        enemy.vx = enemy.facing * 60 * (enemy.angry ? 2 : 1)
        enemy.vy = DOS_ENEMY_HOP.impulse * DOS_TICK_RATE / 0x100
        clock.hopActive = true
        return
      }
      enemy.vx = enemy.facing * 60 * (enemy.angry ? 2 : 1)
      if (this.moveBody(enemy, dt).x) enemy.facing = enemy.facing === 1 ? -1 : 1
      if (enemy.grounded) clock.hopActive = false
      else enemy.vy += DOS_ENEMY_HOP.acceleration * DOS_TICK_RATE / 0x100
      return
    }

    let launched = false
    if (enemy.grounded) {
      enemy.vx = enemy.facing * 60 * (enemy.angry ? 2 : 1)
      enemy.vy = DOS_ENEMY_HOP.impulse * DOS_TICK_RATE / 0x100
      enemy.grounded = false
      launched = true
    }
    if (!launched) enemy.vy += DOS_ENEMY_HOP.acceleration * DOS_TICK_RATE / 0x100
    if (this.moveBody(enemy, dt).x) enemy.facing = enemy.facing === 1 ? -1 : 1
  }

  /** INVADER moves at speed code 0x20 and drops a code-0x40 projectile. */
  private moveInvader(enemy: Enemy, clock: EnemyClock, dt: number): void {
    enemy.vx = enemy.facing * 120 * (enemy.angry ? 2 : 1)
    enemy.vy = 0
    const hitWall = this.collisionMasks
      ? this.moveBody(enemy, dt).x
      : (() => {
          const oldX = enemy.x
          enemy.x += enemy.vx * dt
          if (enemy.x >= CAVE_LEFT && enemy.x + enemy.w <= CAVE_LEFT + CAVE_WIDTH
            && !this.bodyTouchesTerrain(enemy, true)) return false
          enemy.x = oldX
          return true
        })()
    if (hitWall) {
      enemy.facing = enemy.facing === 1 ? -1 : 1
    }
    const hasShot = this.shots.some(shot => shot.ownerId === enemy.id)
    if (!hasShot && clock.shot <= 0 && this.player.y >= enemy.y && this.chance(4)) {
      this.shots.push({ x: enemy.x + (this.chance(1) ? 8 : 0), y: enemy.y + 8,
        vx: 0, vy: 240, age: 0, ownerId: enemy.id, kind: 'invader' })
      clock.shot = 0
    }
  }

  /** Shared firing gate in the Mighta/Hidegonsu/Drunk native handlers. */
  private maybeFireHorizontal(enemy: Enemy, clock: EnemyClock): void {
    // D3A0/D588/D769 load byte offsets 40h/48h/50h from the signed 8.8
    // speed table: codes 20h/24h/28h are 120/135/150 px/s at the fixed-60
    // adaptation baseline. Keep legacy custom-level projectile tuning intact.
    const speed = this.nativeIntro
      ? enemy.kind === 'mighta' ? 120 : enemy.kind === 'hidegons' ? 135 : enemy.kind === 'drunk' ? 150 : 0
      : enemy.kind === 'mighta' ? 240 : enemy.kind === 'hidegons' ? 270 : enemy.kind === 'drunk' ? 300 : 0
    if (!speed || this.state !== 'playing' || this.shots.length >= 12) return
    if (this.shots.some(shot => shot.ownerId === enemy.id) || clock.shot > 0 || (enemy.x & 7) !== 0) return
    if (Math.abs(enemy.y - this.player.y) >= 8 || (this.player.x - enemy.x) * enemy.facing < 24) return
    if (!this.chance(4)) return
    const kind = enemy.kind === 'mighta' ? 'rock' : enemy.kind === 'hidegons' ? 'fire' : 'bottle'
    this.shots.push({ x: enemy.x + 8, y: enemy.y + 8, vx: speed * enemy.facing,
      vy: 0, age: 0, ownerId: enemy.id, kind })
    clock.shot = 0
  }

  private chance(power: number): boolean {
    return this.nativeBranching ? this.nativeRandom.nextPowerOfTwo(power) : this.random() < 1 / (2 ** power)
  }

  private moduloChance(divisor: number): boolean {
    return this.nativeBranching
      ? this.nativeRandom.nextModulo(divisor) === 0
      : this.random() < 1 / divisor
  }

  /** CS:A99F..AA30: aligned walking enemies probabilistically take the high
   * jump when the four cells above their leading edge contain a platform. */
  private tryNativeEnemyHighJump(enemy: Enemy): boolean {
    const alignmentExempt = enemy.kind === 'banebou' // sprite codes 0x67..0x6e at A9AD
    if (!this.level.nativeCells || this.player.dead || enemy.y <= 40
      || ((enemy.x & 7) !== 0 && !alignmentExempt)) return false
    const vertical = enemy.y - this.player.y
    const divisor = vertical >= 0 ? 8 : vertical >= -24 ? 16 : 64
    if (!this.moduloChance(divisor)) return false
    const column = Math.floor((enemy.x - CAVE_LEFT) / TILE)
    const row = Math.floor(enemy.y / TILE)
    for (let offset = 0; offset < 4; offset++) {
      if ((this.level.nativeCells[row - offset]?.[column] ?? 0) & 1) return true
      if ((this.level.nativeCells[row - offset]?.[column + 1] ?? 0) & 1) return true
    }
    // If all four rows are empty, CS:AA2B takes one final 1-in-4 branch.
    return this.chance(2)
  }

  /** CS:AAF6..AB78: aligned walkers occasionally enter the small-hop state
   * when the two columns ahead are an open vertical gap. */
  private tryNativeEnemyLowHop(enemy: Enemy): boolean {
    if (!this.level.nativeCells || enemy.y < 40 || (enemy.x & 7) !== 0) return false
    if (!this.moduloChance(enemy.y < this.player.y ? 6 : 2)) return false
    const row = Math.floor(enemy.y / TILE)
    const column = Math.floor((enemy.x - CAVE_LEFT) / TILE) + (enemy.vx < 0 ? -2 : 2)
    const occupied = (y: number, x: number): boolean => Boolean((this.level.nativeCells?.[y]?.[x] ?? 0) & 1)
    if (occupied(row + 2, column) || occupied(row + 2, column + 1)) return false
    return !occupied(row, column) && !occupied(row, column + 1)
      && !occupied(row + 1, column) && !occupied(row + 1, column + 1)
  }

  private platformAbove(enemy: Enemy): boolean {
    for (let y = enemy.y - TILE; y >= enemy.y - 5 * TILE; y -= TILE) {
      const tile = this.tileAt(enemy.x + 8, y)
      if (tile === '=' || tile === '#') return true
    }
    return false
  }

  /** CS:A91F, A950 and A974: rise from y=-1, then wait descriptor*5/2 ticks. */
  private advanceEnemyEntrance(enemy: Enemy): void {
    const clock = this.clocks.get(enemy.id)!
    if (enemy.state === 'entering') {
      if (this.nativeIntro && !this.nativeEnemyEntranceOpen) return
      if (enemy.y !== clock.targetY) {
        enemy.y += Math.min(1, clock.targetY - enemy.y)
        return
      }
      enemy.state = 'waiting'
    }
    if (enemy.state !== 'waiting' || this.state !== 'playing') return
    if (clock.activationTick === null) {
      clock.activationTick = (this.nativeTick + (enemy.activationDelayTicks ?? 0)) & 0xffff
      return
    }
    // A974 is a raw unsigned `cmp now, deadline`; native wrap consequently
    // activates immediately when a near-FFFF deadline addition wraps low.
    const activationDue = this.nativeIntro
      ? this.nativeTick >= clock.activationTick
      : ((this.nativeTick - clock.activationTick) << 16 >> 16) >= 0
    if (activationDue) {
      enemy.state = 'walking'
      clock.zenChanInitPending = this.nativeIntro && enemy.kind === 'zenchan'
    }
  }

  private moveBubbles(dt: number, input: Input): void {
    const remove = this.removals
    remove.clear()
    for (const b of this.bubbles) {
      b.age += dt
      if (b.phase === 'projectile') {
        let blocked = false
        if (this.collisionMasks) {
          const body: Body = {
            x: b.x - 8, y: b.y - 8, w: 16, h: 16,
            vx: b.vx, vy: 0, grounded: false,
          }
          blocked = this.moveBody(body, dt).x
          b.x = body.x + 8
        } else {
          const oldX = b.x
          b.x += b.vx * dt
          blocked = b.x - b.r < CAVE_LEFT || b.x + b.r > CAVE_LEFT + CAVE_WIDTH
            || this.bodyTouchesTerrain({ x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 }, true)
          if (blocked) b.x = oldX
        }
        b.travelRemaining -= Math.abs(b.vx) / DOS_TICK_RATE
        const enemy = this.enemies.find(e => e.state === 'walking' && circleTouches(b.x, b.y, b.r, e))
        if (enemy) {
          b.trappedId = enemy.id
          enemy.state = 'trapped'
          enemy.vx = 0; enemy.vy = 0
          const clock = this.clocks.get(enemy.id)!
          clock.zenChanInitPending = false
          clock.airborne = false
          clock.jumpWindup = 0
          clock.hopActive = false
          this.setBubbleFloating(b, 0x23f)
          this.fx.trap++
        } else if (blocked || b.travelRemaining <= 0) {
          this.setBubbleFloating(b, 0x1fe)
        }
      } else {
        b.ticksRemaining--
        if (b.ticksRemaining <= 0) {
          this.releaseBubbleEnemy(b)
          remove.add(b)
          continue
        }
        this.moveFloatingBubble(b, dt)
      }
      const trapped = this.enemies.find(e => e.id === b.trappedId)
      if (trapped) { trapped.x = b.x - 8; trapped.y = b.y - 8 }
      const mayContactBubble = this.collisionMasks || b.age >= 1
      if (b.phase === 'floating' && mayContactBubble && !this.player.dead && circleTouches(b.x, b.y, b.r + 1, this.player)) {
        const p = this.player
        if (this.collisionMasks && b.trappedId !== null) {
          // 9BC7 calls AC10 every tick; AC21 invokes the captured archetype's
          // +9 defeat callback immediately on an active-player overlap.
          this.popBubble(b)
          remove.add(b)
          continue
        }
        if (this.collisionMasks && b.trappedId === null) {
          if (input.jump && p.vy > 0 && p.y + p.h <= b.y + b.r) {
            p.y = b.y - b.r - p.h
            p.vy = DOS_PLAYER_BUBBLE_BOUNCE.impulse * DOS_TICK_RATE / 0x100
            p.grounded = false
            this.jumpOrigin = p.y
            this.fx.jump++
          } else if (!input.jump && p.vy >= 0) {
            // A2B8 is reached by standing/falling states (8B14/8B8B), not by
            // the rising jump state at 8D48.
            this.ridingBubble = b
            p.x = b.x - 4
            p.y = b.y - 8
            p.vx = 0
            p.vy = 0
            p.grounded = false
          }
          continue
        }
        const strength = Math.hypot(p.vx - b.vx, p.vy - b.vy) / TILE + b.age
        if (strength >= 15) {
          this.popBubble(b)
          remove.add(b)
        } else if (input.jump && p.vy > 0 && p.y + p.h <= b.y + b.r) {
          p.y = b.y - b.r - p.h
          p.vy = DOS_PLAYER_BUBBLE_BOUNCE.impulse * DOS_TICK_RATE / 0x100
          this.jumpOrigin = p.y
          this.fx.jump++
        }
      }
    }
    this.bubbles = this.bubbles.filter(b => !remove.has(b))
    if (this.ridingBubble && remove.has(this.ridingBubble)) this.ridingBubble = null
  }

  private setBubbleFloating(bubble: Bubble, ticks: number): void {
    bubble.phase = 'floating'
    bubble.ticksRemaining = ticks
    bubble.travelRemaining = 0
    bubble.vx = 0
    bubble.vy = 0
    if (this.collisionMasks && bubble.trappedId === null) {
      const emptyFloating = this.bubbles.filter(candidate =>
        candidate.phase === 'floating' && candidate.trappedId === null)
      if (emptyFloating.length >= DOS_MAX_FLOATING_BUBBLES) {
        const oldest = emptyFloating.find(candidate => candidate !== bubble)
        if (oldest) oldest.ticksRemaining = 1
      }
    }
  }

  /** CS:9D59..9F1E: the patched native cell bits steer floating bubbles. */
  private moveFloatingBubble(bubble: Bubble, dt: number): void {
    const column = Math.floor((bubble.x - CAVE_LEFT) / TILE)
    const row = Math.floor(bubble.y / TILE)
    const airflow = (this.level.nativeCells?.[row]?.[column] ?? 0) & 0x06
    if (airflow === 0) { bubble.vx = 0; bubble.vy = -30 }
    else if (airflow === 2) { bubble.vx = 30; bubble.vy = 0 }
    else if (airflow === 4) { bubble.vx = 0; bubble.vy = 30 }
    else { bubble.vx = -30; bubble.vy = 0 }

    const oldX = bubble.x, oldY = bubble.y
    bubble.x += bubble.vx * dt
    bubble.y += bubble.vy * dt
    const blocked = bubble.x - bubble.r < CAVE_LEFT || bubble.x + bubble.r > CAVE_LEFT + CAVE_WIDTH
      || bubble.y - bubble.r < 0 || bubble.y + bubble.r > HEIGHT
      || this.bodyTouchesTerrain({ x: bubble.x - bubble.r, y: bubble.y - bubble.r,
        w: bubble.r * 2, h: bubble.r * 2 }, true)
    if (blocked) {
      bubble.x = oldX
      bubble.y = oldY
      bubble.vx = 0
      bubble.vy = -30
    }
  }

  private releaseBubbleEnemy(bubble: Bubble): void {
    const enemy = this.enemies.find(e => e.id === bubble.trappedId)
    if (enemy) {
      enemy.state = 'walking'
      enemy.angry = true
      enemy.vx = 0; enemy.vy = 0; enemy.grounded = false
      const clock = this.clocks.get(enemy.id)!
      clock.zenChanInitPending = false
      clock.airborne = false
      clock.jumpWindup = 0
      clock.hopActive = false
    }
  }

  private popBubble(b: Bubble): void {
    this.fx.pop++
    const enemy = this.enemies.find(e => e.id === b.trappedId)
    if (!enemy) return
    if (this.lastPopTick === null || (((this.nativeTick - this.lastPopTick) & 0xffff) >= 10)) this.popChain = 0
    else this.popChain = Math.min(this.popChain + 1, DOS_CHAIN_ITEMS.length - 1)
    this.lastPopTick = this.nativeTick
    const clock = this.clocks.get(enemy.id)!
    clock.zenChanInitPending = false
    clock.dropKind = DOS_CHAIN_ITEMS[this.popChain]
    clock.dropPoints = DOS_CHAIN_POINTS[this.popChain]
    enemy.state = 'defeated'
    if (this.nativeIntro) this.nativeTrackedEnemies.delete(enemy.id)
    enemy.vx = enemy.facing * 120
    enemy.vy = -120
    enemy.grounded = false
    clock.defeat = 0
    clock.defeatDeadline = this.collisionMasks ? (this.nativeTick + 0x3c) & 0xffff : null
  }

  private convertDefeatedEnemy(enemy: Enemy, clock: EnemyClock): void {
    if (this.collisionMasks) {
      const native = createDosOrdinaryFruit(enemy.x, enemy.y + 16, clock.dropKind)
      const item: Fruit = { x: native.x + 8, y: native.y - 8,
        kind: native.kind, points: native.points, age: 0, phase: 'item' }
      this.nativeFruitStates.set(item, native)
      this.fruit.push(item)
    } else {
      this.fruit.push({ x: enemy.x + 8, y: enemy.y + 8,
        kind: clock.dropKind, points: clock.dropPoints, age: 0 })
    }
    this.enemies = this.enemies.filter(other => other !== enemy)
    this.clocks.delete(enemy.id)
  }

  private moveShots(dt: number): void {
    const keep: Shot[] = []
    for (const shot of this.shots) {
      shot.age += dt
      if (shot.kind) {
        let nativeTerrainHit = false
        if (this.collisionMasks && shot.kind !== 'invader') {
          const body: Body = {
            x: shot.x - 8, y: shot.y - 8, w: 16, h: 16,
            vx: shot.vx, vy: shot.vy, grounded: false,
          }
          const hit = this.moveBody(body, dt)
          shot.x = body.x + 8
          shot.y = body.y + 8
          nativeTerrainHit = hit.x || hit.y
        } else {
          shot.x += shot.vx * dt
          shot.y += shot.vy * dt
        }
        const projectile = { x: shot.x - 4, y: shot.y - 4, w: 8, h: 8 }
        const bottom = this.collisionMasks && shot.kind === 'invader' ? 0xd8 : 0xe8
        const outside = shot.x < CAVE_LEFT || shot.x > CAVE_LEFT + CAVE_WIDTH || shot.y < 0 || shot.y >= bottom
        // INVADER drops pass through the cave. The three horizontal native
        // projectiles terminate when their leading edge reaches terrain.
        const terrain = shot.kind !== 'invader'
          && (this.collisionMasks ? nativeTerrainHit : this.bodyTouchesTerrain(projectile, true))
        if (!outside && !terrain && !this.player.dead && circleTouches(shot.x, shot.y, 4, this.player)) {
          this.hurt()
          continue
        }
        if (!outside && !terrain && shot.age < 3) keep.push(shot)
        continue
      }
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
      const native = this.nativeFruitStates.get(item)
      if (native) {
        const result = stepDosOrdinaryFruit(native,
          { generalTick: this.nativeTick, workTick: this.workTick },
          { cells: this.collisionCells!, masks: this.collisionMasks!,
            player: this.player.dead ? null : this.player,
            pickupEnabled: true })
        item.x = native.x + 8
        item.y = native.y - 8
        item.phase = native.phase === 'score' ? 'score' : 'item'
        if (result.collected) { this.score += result.collected; this.fx.fruit++ }
        if (!result.removed) keep.push(item)
        continue
      }
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
    this.ridingBubble = null
    this.player.vx = 0; this.player.vy = 0
    this.deathTime = 0
    this.lives--
    this.fx.hurt++
  }

  private tileAt(x: number, y: number): string {
    return this.level.tiles[Math.floor(y / TILE)]?.[Math.floor((x - CAVE_LEFT) / TILE)] ?? '.'
  }

  private bodyTouchesTerrain(body: { x: number; y: number; w: number; h: number }, includePlatforms: boolean): boolean {
    const left = Math.floor((body.x + 0.001 - CAVE_LEFT) / TILE)
    const right = Math.floor((body.x + body.w - 0.001 - CAVE_LEFT) / TILE)
    const top = Math.floor((body.y + 0.001) / TILE)
    const bottom = Math.floor((body.y + body.h - 0.001) / TILE)
    for (let row = top; row <= bottom; row++) for (let column = left; column <= right; column++) {
      const tile = this.level.tiles[row]?.[column]
      if (tile === '#' || includePlatforms && tile === '=') return true
    }
    return false
  }

  private moveBody(body: Body, dt: number): { x: boolean; y: boolean } {
    if (this.collisionMasks && Math.abs(dt - DOS_TICK_SECONDS) < Number.EPSILON * 4) {
      return this.moveNativeBody(body)
    }
    const hit = { x: false, y: false }
    const startY = body.y
    const fixedStep = Math.abs(dt - DOS_TICK_SECONDS) < Number.EPSILON * 4
    const advance = (position: number, velocity: number): number => fixedStep
      ? advanceFixedValue(position, Math.round(velocity * 0x100 / DOS_TICK_RATE))
      : position + velocity * dt
    body.x = advance(body.x, body.vx)
    const x0 = Math.floor((body.x - CAVE_LEFT) / TILE)
    const x1 = Math.floor((body.x + body.w - 0.001 - CAVE_LEFT) / TILE)
    const y0 = Math.floor(body.y / TILE), y1 = Math.floor((body.y + body.h - 0.001) / TILE)
    for (let row = y0; row <= y1; row++) for (let col = x0; col <= x1; col++) {
      if (this.level.tiles[row]?.[col] !== '#') continue
      if (body.vx > 0) body.x = Math.min(body.x, CAVE_LEFT + col * TILE - body.w)
      else if (body.vx < 0) body.x = Math.max(body.x, CAVE_LEFT + (col + 1) * TILE)
      if (body.vx) hit.x = true
    }
    if (body.x < CAVE_LEFT) { body.x = CAVE_LEFT; hit.x = true }
    if (body.x + body.w > CAVE_LEFT + CAVE_WIDTH) { body.x = CAVE_LEFT + CAVE_WIDTH - body.w; hit.x = true }
    if (hit.x) body.vx = 0
    body.y = advance(body.y, body.vy)
    body.grounded = false
    const left = Math.floor((body.x + 0.001 - CAVE_LEFT) / TILE)
    const right = Math.floor((body.x + body.w - 0.001 - CAVE_LEFT) / TILE)
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
    if (body.y < 0) { body.y = 0; body.vy = Math.max(0, body.vy) }
    // Empty bottom cells support vertical screen wrap in custom level data.
    if (body.y >= HEIGHT) { body.y = 0; body.grounded = false }
    return hit
  }

  /** CS:1C52/1C87 plus the directional predicates at CS:1FA4..2023. The DOS
   * collision origin has two guard rows above the visible 25-row cave, hence
   * the +16 conversion from renderer coordinates. */
  private moveNativeBody(body: Body): { x: boolean; y: boolean } {
    const hit = { x: false, y: false }
    const masks = this.collisionMasks!
    const raw = (velocity: number): number => Math.round(velocity * 0x100 / DOS_TICK_RATE)

    if (body.vx) {
      body.x = advanceFixedValue(body.x, raw(body.vx))
      const direction = body.vx < 0 ? 'left' : 'right'
      if (dosBlocksDirection(dosCollisionWord(masks, Math.floor(body.y + 16), Math.floor(body.x)), direction)) {
        body.x = snapDosCoordinate(body.x, body.vx)
        body.vx = 0
        hit.x = true
      }
    }
    if (body.x < CAVE_LEFT) { body.x = CAVE_LEFT; body.vx = 0; hit.x = true }
    if (body.x + body.w > CAVE_LEFT + CAVE_WIDTH) {
      body.x = CAVE_LEFT + CAVE_WIDTH - body.w; body.vx = 0; hit.x = true
    }

    body.grounded = false
    let nativeY = body.y + 16
    if (body.vy) {
      nativeY = wrapDosY(advanceFixedValue(nativeY, raw(body.vy)))
      body.y = nativeY - 16
      const direction = body.vy < 0 ? 'up' : 'down'
      if (dosBlocksDirection(dosCollisionWord(masks, Math.floor(nativeY), Math.floor(body.x)), direction)) {
        nativeY = snapDosCoordinate(nativeY, body.vy)
        body.y = nativeY - 16
        body.grounded = direction === 'down'
        body.vy = 0
        hit.y = true
      }
    } else {
      // Walking states do not apply gravity while supported. The native code
      // probes one integer pixel below before switching to a fall state.
      body.grounded = dosBlocksDirection(
        dosCollisionWord(masks, Math.floor(nativeY) + 1, Math.floor(body.x)), 'down')
    }
    return hit
  }
}

export { Engine as BubbleEngine }
