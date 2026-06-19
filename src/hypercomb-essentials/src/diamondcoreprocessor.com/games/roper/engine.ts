// diamondcoreprocessor.com/games/roper/engine.ts
//
// Pure game state + physics for "Roper" — a turn-based Worms-style artillery
// game built around the ninja rope. No DOM, no canvas: the overlay owns those
// and calls update(dt) each frame, then the renderer draws this state. Same
// pure-sim split as the arkanoid / bubble / solomon engines.
//
// The world is a single visible arena (no scrolling camera). Its size is passed
// in by the overlay so the playfield fills the screen — height is fixed at H and
// width is chosen to match the stage aspect ratio, so the border always fits the
// screen height "at least". The terrain is a destructible 1-bit bitmap mask
// (`terrain`): explosions carve circular craters out of it (and push the cut
// into `craterQueue` so the renderer can punch matching holes in its visual).
//
// Turn loop (hotseat, two teams):
//   • The active worm has an allotted turn time. During it you can rope around
//     the arena freely (unlimited ropes — release and re-fire mid-air), walk,
//     and jump.
//   • Aim with the cursor; hold to charge power; release to throw a Grenade
//     (timed fuse, bounces) or a Bomb (bigger blast, detonates on impact).
//   • After you throw, a short retreat window runs, then the turn passes to the
//     other team's next worm. Time also passes the turn if you never fire.
//   • A team with no worms left loses.

export type WeaponKind = 'grenade' | 'bomb'
export type TurnState = 'aim' | 'fired' | 'over'

export interface WeaponMeta {
  key: WeaponKind
  name: string
  letter: string
  color: string
  desc: string
}

// Ordered so the toolbar / number keys are stable (1 = grenade, 2 = bomb).
export const WEAPON_ORDER: WeaponKind[] = ['grenade', 'bomb']
export const WEAPON_META: Record<WeaponKind, WeaponMeta> = {
  grenade: {
    key: 'grenade', name: 'Grenade', letter: '1', color: '#7ed957',
    desc: 'Timed fuse, bounces off the terrain. Lob it so it lands by the target as the fuse runs out.',
  },
  bomb: {
    key: 'bomb', name: 'Bomb', letter: '2', color: '#ff7043',
    desc: 'Heavier charge — detonates on the first thing it hits with a bigger blast and a deeper crater.',
  },
}

export interface Worm {
  x: number; y: number          // centre
  vx: number; vy: number
  hp: number
  alive: boolean
  team: number                  // 0 or 1
  index: number                 // stable id for naming (e.g. "B2")
  facing: 1 | -1
  onGround: boolean
}

export interface Projectile {
  kind: WeaponKind
  x: number; y: number
  vx: number; vy: number
  fuse: number                  // grenade: seconds left until it blows
  r: number
  owner: number                 // worm index that threw it (no self-arming)
  armed: boolean                // bomb ignores its launcher until it has cleared it
}

/** A finished blast — kept briefly so the renderer can animate the flash. */
export interface Blast { x: number; y: number; r: number; t: number; life: number }

/** Debris fleck thrown up by an explosion (pure cosmetic, simulated here so the
 *  renderer stays stateless). */
export interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string }

/** The rope is a little state machine: the hook flies out along the aim
 *  ('extending'); on a terrain hit it locks ('attached') and the worm swings;
 *  on a miss it pulls back ('retracting') — so firing always shoots the rope out
 *  far enough to gauge the distance even when it doesn't grab. */
export type RopePhase = 'extending' | 'attached' | 'retracting'
export interface Rope {
  phase: RopePhase
  ox: number; oy: number        // origin the hook flies out from (worm pos at fire)
  dx: number; dy: number        // unit aim direction the hook travels
  reach: number                 // how far the hook has flown (extend/retract)
  hx: number; hy: number        // current hook tip
  ax: number; ay: number        // anchor (once attached)
  length: number                // rope length once attached
}

export interface InputState {
  left: boolean; right: boolean; up: boolean; down: boolean
}

// ── World geometry & tuning (world units) ──────────────────────────
export const H = 720                  // fixed world height; width is per-arena
export const MIN_W = 900
export const MAX_W = 1680

const WORM_R = 9                       // collision/visual radius
const WORM_HP = 100
const GRAVITY = 1100                   // units/s²
const WALK_SPEED = 150
const JUMP_VX = 150
const JUMP_VY = 430
const AIR_DRAG = 0.16                  // per-second velocity bleed in the air
const GROUND_FRICTION = 7.5            // per-second horizontal damping on the ground

// Terrain bounce (Hedgewars/WA model: reflect velocity, scale the normal
// component by restitution and the tangential by friction). WA is famous for
// "you gain momentum off walls", so the roped restitution is high (near
// elastic); a loose worm thudding to the floor settles instead of pinging.
const ROPE_RESTITUTION = 0.86          // bounce energy kept when swinging into terrain
const ROPE_BOUNCE_FRICTION = 0.94      // tangential slide kept on a rope bounce
const AIR_RESTITUTION = 0.45           // a flung/loose worm is much less bouncy
const SETTLE_SPEED = 42                // below this, a grounded worm stops bouncing and rests

// Rope
const ROPE_MAX = 600                   // longest cast / longest rope
const ROPE_MIN_LEN = 24
const ROPE_FIRE_SPEED = 1700           // how fast the hook flies out (units/s)
const ROPE_RETRACT_SPEED = 2600        // faster pull-back on a miss
const REEL_SPEED = 200                 // reel in/out units/s
const SWING_ACCEL = 1500               // horizontal push from left/right while roped
const ROPE_AIR_DRAG = 0.08             // barely any drag — momentum is the point of a rope
const ROPE_MAX_SPEED = 1300            // cap on total roped speed (keeps swings controllable)
const ROPE_MIN_UP = 0.16              // min upward component — the rope only fires above horizontal (Team17)

// Weapons
const CHARGE_MIN = 260                 // throw speed at a tap
const CHARGE_MAX = 1020                // throw speed at full power
const GRENADE_FUSE = 3.0
const GRENADE_BOUNCE = 0.52
const GRENADE_R = 6
const BOMB_R = 8
const WIND_MAX = 220                   // horizontal accel on projectiles
const PROJ_GRAVITY = 1000

// Explosions
const GRENADE_BLAST = 62
const BOMB_BLAST = 92
const BLAST_DAMAGE = 58                // at the centre; falls off to 0 at the rim
const KNOCKBACK = 560

// Turn flow
const TURN_TIME = 30
const RETREAT_TIME = 4.5

export interface RoperOptions {
  width: number
  wormsPerTeam?: number
  seed?: number
}

export class RoperEngine {
  readonly width: number
  readonly height = H

  // 1 = solid ground, 0 = open. Row-major, width*height. The visual copy lives
  // in the renderer; this is the collision truth.
  readonly terrain: Uint8Array

  // Craters carved since the renderer last drained the queue. The renderer
  // punches each one out of its terrain canvas, then clears the array.
  readonly craterQueue: { x: number; y: number; r: number }[] = []

  worms: Worm[] = []
  projectiles: Projectile[] = []
  blasts: Blast[] = []
  particles: Particle[] = []
  rope: Rope | null = null

  input: InputState = { left: false, right: false, up: false, down: false }

  state: TurnState = 'aim'
  activeIndex = 0                       // index into `worms`
  weapon: WeaponKind = 'grenade'
  turnTime = TURN_TIME
  retreatTime = RETREAT_TIME
  wind = 0                              // signed, |wind| <= WIND_MAX
  winner: number | null = null

  // Aim + charge are owned by the overlay (input) but live here so the renderer
  // and physics share one source of truth.
  aimAngle = -Math.PI / 4              // radians; -PI/2 is straight up
  charging = false
  power = 0                            // 0..1 while charging

  // Horizontal side of the last rope fired this turn (0 none, ±1). The next rope
  // can't come out the same way — it flips to the opposite side (W2 feel).
  #lastRopeSign: 0 | 1 | -1 = 0

  #rng: () => number

  constructor(opts: RoperOptions) {
    this.width = Math.max(MIN_W, Math.min(MAX_W, Math.round(opts.width)))
    this.terrain = new Uint8Array(this.width * this.height)
    this.#rng = mulberry32(opts.seed ?? (Math.random() * 2 ** 32) >>> 0)
    this.#generateTerrain()
    this.#spawnWorms(opts.wormsPerTeam ?? 3)
    this.activeIndex = this.worms.findIndex(w => w.team === 0)
    this.wind = this.#rollWind()
    this.facingFromAim()
  }

  // ── public reads ─────────────────────────────────────────
  get active(): Worm | null { return this.worms[this.activeIndex] ?? null }
  get busy(): boolean { return this.projectiles.length > 0 || this.blasts.length > 0 }
  get roping(): boolean { return !!this.rope }
  get attached(): boolean { return this.rope?.phase === 'attached' }
  teamAlive(team: number): boolean { return this.worms.some(w => w.team === team && w.alive) }
  teamHp(team: number): number {
    return this.worms.reduce((s, w) => s + (w.team === team && w.alive ? Math.max(0, w.hp) : 0), 0)
  }

  solidAt(x: number, y: number): boolean {
    const xi = x | 0, yi = y | 0
    // The arena is a sealed rock box: anything outside the world rectangle is
    // SOLID. The border is impenetrable — worms, projectiles and the rope all
    // stop dead at the ceiling, walls and floor; nothing escapes.
    if (xi < 0 || xi >= this.width || yi < 0 || yi >= this.height) return true
    return this.terrain[yi * this.width + xi] === 1
  }

  // ── main step ────────────────────────────────────────────
  update(dt: number): void {
    if (this.state === 'over') { this.#stepCosmetics(dt); return }
    dt = Math.min(dt, 1 / 30)

    // Turn / retreat clocks only tick while nothing is mid-flight.
    if (!this.busy) {
      if (this.state === 'aim') {
        this.turnTime -= dt
        if (this.turnTime <= 0) { this.#endTurn(); return }
      } else if (this.state === 'fired') {
        this.retreatTime -= dt
        if (this.retreatTime <= 0) { this.#endTurn(); return }
      }
    }

    for (const w of this.worms) if (w.alive) this.#stepWorm(w, dt, w === this.active)
    this.#stepProjectiles(dt)
    this.#stepCosmetics(dt)
  }

  // ── input-driven actions (called by the overlay) ─────────
  /** Point the active worm to match the current aim (used after a turn switch). */
  facingFromAim(): void {
    const w = this.active
    if (w) w.facing = Math.cos(this.aimAngle) >= 0 ? 1 : -1
  }

  selectWeapon(kind: WeaponKind): void {
    if (this.state === 'aim') this.weapon = kind
  }
  cycleWeapon(): void {
    const i = WEAPON_ORDER.indexOf(this.weapon)
    this.selectWeapon(WEAPON_ORDER[(i + 1) % WEAPON_ORDER.length])
  }

  /** The direction the rope will ACTUALLY launch from the current aim, applying
   *  the two Team17 rules: (1) it only fires in the upper hemisphere — you can't
   *  rope below horizontal; (2) it can't come out the same horizontal side as the
   *  last rope this turn, so a right cast is followed by a left one (you re-aim
   *  the steepness in the air, the side flips). Shared by fireRope and the aim
   *  preview so what you see is what fires. */
  ropeLaunchDir(): { dx: number; dy: number; sign: 1 | -1 } {
    let dx = Math.cos(this.aimAngle)
    let dy = -Math.abs(Math.sin(this.aimAngle))     // upper hemisphere only
    if (dy > -ROPE_MIN_UP) dy = -ROPE_MIN_UP
    let sign: 1 | -1 = dx >= 0 ? 1 : -1
    if (this.#lastRopeSign !== 0 && sign === this.#lastRopeSign) sign = sign === 1 ? -1 : 1
    dx = sign * Math.abs(dx)
    const m = Math.hypot(dx, dy) || 1
    return { dx: dx / m, dy: dy / m, sign }
  }

  /** Fire the rope: the hook shoots OUT along the launch direction. It locks onto
   *  the first terrain it crosses; if it reaches full length without grabbing it
   *  pulls back — so the rope always flies out far enough to gauge your aim even
   *  on a miss. The worm stays in free flight until the hook actually grabs. */
  fireRope(): void {
    const w = this.active
    if (!w || !w.alive || this.state === 'over') return
    const { dx, dy, sign } = this.ropeLaunchDir()
    this.#lastRopeSign = sign
    this.rope = {
      phase: 'extending',
      ox: w.x, oy: w.y, dx, dy,
      reach: WORM_R + 2,
      hx: w.x + dx * (WORM_R + 2), hy: w.y + dy * (WORM_R + 2),
      ax: 0, ay: 0, length: 0,
    }
  }

  releaseRope(): void { this.rope = null }
  /** Space / right-click: detach when swinging, otherwise (re)fire — so you can
   *  pop the rope out again and again to range a swing before committing. */
  toggleRope(): void {
    if (this.rope?.phase === 'attached') this.releaseRope()
    else this.fireRope()
  }

  /** Throw the selected weapon along the aim at the given power (0..1). One
   *  throw per turn: it flips the turn into its retreat window. */
  throwWeapon(power: number): void {
    const w = this.active
    if (!w || !w.alive || this.state !== 'aim') return
    this.releaseRope()
    const speed = CHARGE_MIN + (CHARGE_MAX - CHARGE_MIN) * Math.max(0, Math.min(1, power))
    const dx = Math.cos(this.aimAngle), dy = Math.sin(this.aimAngle)
    const isBomb = this.weapon === 'bomb'
    this.projectiles.push({
      kind: this.weapon,
      x: w.x + dx * (WORM_R + 4),
      y: w.y + dy * (WORM_R + 4),
      vx: dx * speed + w.vx * 0.4,
      vy: dy * speed + w.vy * 0.4,
      fuse: isBomb ? Infinity : GRENADE_FUSE,
      r: isBomb ? BOMB_R : GRENADE_R,
      owner: w.index,
      armed: false,
    })
    this.charging = false
    this.power = 0
    this.state = 'fired'
    this.retreatTime = RETREAT_TIME
  }

  jump(): void {
    const w = this.active
    if (!w || !w.alive || this.rope || !w.onGround || this.state === 'over') return
    w.vy = -JUMP_VY
    w.vx = w.facing * JUMP_VX
    w.onGround = false
  }

  // ── worm physics ─────────────────────────────────────────
  #stepWorm(w: Worm, dt: number, isActive: boolean): void {
    if (isActive && this.rope) {
      if (this.rope.phase !== 'attached') this.#stepRopeFlight(dt)
      // flight may have just grabbed (→ swing this very frame) or cleared the rope
      if (this.rope && this.rope.phase === 'attached') this.#stepRoped(w, dt)
      else this.#stepAirborne(w, dt, true)
      return
    }
    this.#stepAirborne(w, dt, isActive)
  }

  /** Advance the flying hook while extending or pulling back; grab on contact.
   *  The hook MARCHES in small steps so it locks onto the first solid it crosses
   *  and can never tunnel through a thin wall, platform or the sealed border. */
  #stepRopeFlight(dt: number): void {
    const r = this.rope!
    const w = this.active!
    if (r.phase === 'extending') {
      const target = Math.min(ROPE_MAX, r.reach + ROPE_FIRE_SPEED * dt)
      const STEP = 3
      for (let d = r.reach + STEP; d <= target; d += STEP) {
        const hx = r.ox + r.dx * d, hy = r.oy + r.dy * d
        if (this.solidAt(hx, hy)) {
          r.reach = d; r.hx = hx; r.hy = hy
          r.ax = hx; r.ay = hy
          r.length = Math.max(ROPE_MIN_LEN, Math.hypot(w.x - r.ax, w.y - r.ay))
          r.phase = 'attached'
          return
        }
      }
      r.reach = target
      r.hx = r.ox + r.dx * r.reach
      r.hy = r.oy + r.dy * r.reach
      if (r.reach >= ROPE_MAX) r.phase = 'retracting'
    } else { // retracting
      r.reach -= ROPE_RETRACT_SPEED * dt
      if (r.reach <= WORM_R) { this.rope = null; return }
      r.hx = r.ox + r.dx * r.reach
      r.hy = r.oy + r.dy * r.reach
    }
  }

  /** Free-flight worm physics: gravity, walking on the ground, and a real bounce
   *  off terrain — a flung or rope-released worm pings off ceilings on the way up
   *  and off walls, instead of dead-stopping. */
  #stepAirborne(w: Worm, dt: number, isActive: boolean): void {
    const canWalk = isActive && w.onGround && this.state !== 'over' && !this.busy
    if (canWalk && (this.input.left || this.input.right)) {
      w.vx = (this.input.right ? 1 : -1) * WALK_SPEED
      w.facing = this.input.right ? 1 : -1
    }

    w.vy += GRAVITY * dt
    if (!w.onGround) w.vx *= Math.exp(-AIR_DRAG * dt)
    else if (!(canWalk && (this.input.left || this.input.right))) {
      w.vx *= Math.exp(-GROUND_FRICTION * dt)
      if (Math.abs(w.vx) < 4) w.vx = 0
    }

    w.x += w.vx * dt
    w.y += w.vy * dt

    if (this.#wormSolid(w)) this.#bounceWorm(w, AIR_RESTITUTION, true)
    else w.onGround = this.solidAt(w.x, w.y + WORM_R + 2)
    this.#clampToBox(w)
  }

  /** Swing on a taut, inextensible, pull-only rope. Left/right pump the swing;
   *  up/down reel the line, and reeling CONSERVES ANGULAR MOMENTUM — shorten to
   *  speed up, lengthen to slow down (v_tangential ∝ 1/length). Swinging into
   *  terrain bounces off it. This is the roper's whole toolkit. */
  #stepRoped(w: Worm, dt: number): void {
    const r = this.rope!

    // Reel + angular-momentum transfer: pulling in at speed whips you faster.
    if (this.input.up || this.input.down) {
      const oldLen = r.length
      const newLen = this.input.up
        ? Math.max(ROPE_MIN_LEN, r.length - REEL_SPEED * dt)
        : Math.min(ROPE_MAX, r.length + REEL_SPEED * dt)
      if (newLen !== oldLen) {
        const dxr = w.x - r.ax, dyr = w.y - r.ay
        const dd = Math.hypot(dxr, dyr) || 1
        const nx = dxr / dd, ny = dyr / dd, tx = -ny, ty = nx
        let vt = w.vx * tx + w.vy * ty            // tangential speed
        const vr = w.vx * nx + w.vy * ny          // radial speed
        vt *= oldLen / newLen                      // conserve L = length·v_tangential
        vt = Math.max(-ROPE_MAX_SPEED, Math.min(ROPE_MAX_SPEED, vt))
        w.vx = tx * vt + nx * vr
        w.vy = ty * vt + ny * vr
        r.length = newLen
      }
    }

    // Gravity + light drag
    w.vy += GRAVITY * dt
    const drag = Math.exp(-ROPE_AIR_DRAG * dt)
    w.vx *= drag; w.vy *= drag

    // Swing input is a HORIZONTAL push (the Hedgewars model): right always nudges
    // you rightward, left leftward, and the rope + gravity turn that into a swing
    // that always reads right. A tangent-based push reverses on the far side of
    // the arc and fights you — it "holds you out there" instead of letting gravity
    // drop you into the swing, which is the thing that felt wrong.
    if (this.input.right) { w.vx += SWING_ACCEL * dt; w.facing = 1 }
    if (this.input.left) { w.vx -= SWING_ACCEL * dt; w.facing = -1 }

    // Integrate
    w.x += w.vx * dt; w.y += w.vy * dt

    // Inextensible, pull-only constraint: clamp to the circle, kill outward speed.
    let dx = w.x - r.ax, dy = w.y - r.ay, d = Math.hypot(dx, dy) || 1
    if (d > r.length) {
      const nx = dx / d, ny = dy / d
      w.x = r.ax + nx * r.length
      w.y = r.ay + ny * r.length
      const vr = w.vx * nx + w.vy * ny
      if (vr > 0) { w.vx -= vr * nx; w.vy -= vr * ny }
    }

    // Keep the swing controllable (and stable) without bleeding the momentum that
    // makes roping fun: cap total speed rather than damping it every frame.
    const sp = Math.hypot(w.vx, w.vy)
    if (sp > ROPE_MAX_SPEED) { const k = ROPE_MAX_SPEED / sp; w.vx *= k; w.vy *= k }

    // Swing into terrain → bounce off it (off ceilings going up, off walls).
    if (this.#wormSolid(w)) this.#bounceWorm(w, ROPE_RESTITUTION, false)
    this.#clampToBox(w)
  }

  /** Hard backstop: a worm can never leave the sealed arena, whatever the
   *  knockback. The rock border + bounce already handle it; this guarantees it. */
  #clampToBox(w: Worm): void {
    if (w.x < WORM_R) { w.x = WORM_R; if (w.vx < 0) w.vx = -w.vx * 0.4 }
    else if (w.x > this.width - WORM_R) { w.x = this.width - WORM_R; if (w.vx > 0) w.vx = -w.vx * 0.4 }
    if (w.y < WORM_R) { w.y = WORM_R; if (w.vy < 0) w.vy = -w.vy * 0.4 }
    else if (w.y > this.height - WORM_R) { w.y = this.height - WORM_R; if (w.vy > 0) w.vy = -w.vy * 0.4; w.onGround = true }
  }

  /** Reflect the worm's velocity off the terrain it's overlapping and push it
   *  back out along the surface normal (Hedgewars/WA model: flip the normal
   *  component, scaled by restitution; keep the tangential, scaled by friction).
   *  `settle` lets a slow worm rest on a floor instead of pinging forever. */
  #bounceWorm(w: Worm, restitution: number, settle: boolean): void {
    const n = this.#surfaceNormal(w.x, w.y, WORM_R)
    let pushed = 0
    while (pushed < WORM_R * 3 && this.#wormSolid(w)) { w.x += n.x; w.y += n.y; pushed++ }

    const vn = w.vx * n.x + w.vy * n.y           // velocity into the surface (<0)
    const floor = n.y < -0.5                      // normal points up ⇒ it's a floor
    if (settle && floor && Math.hypot(w.vx, w.vy) < SETTLE_SPEED) {
      w.vx *= Math.exp(-GROUND_FRICTION * 0.5); w.vy = 0; w.onGround = true
      return
    }
    if (vn < 0) {
      const tvx = w.vx - vn * n.x, tvy = w.vy - vn * n.y   // tangential part
      w.vx = tvx * ROPE_BOUNCE_FRICTION - vn * n.x * restitution
      w.vy = tvy * ROPE_BOUNCE_FRICTION - vn * n.y * restitution
    }
    w.onGround = settle && floor && Math.hypot(w.vx, w.vy) < SETTLE_SPEED
  }

  /** Solid test around the worm — feet, head, both sides and centre — so it
   *  registers floors, ceilings (bounce on the way up) and walls alike. */
  #wormSolid(w: Worm): boolean {
    return this.solidAt(w.x, w.y + WORM_R) ||      // feet
      this.solidAt(w.x, w.y - WORM_R) ||           // head (ceilings)
      this.solidAt(w.x - WORM_R, w.y) ||           // left wall
      this.solidAt(w.x + WORM_R, w.y) ||           // right wall
      this.solidAt(w.x, w.y)                        // centre
  }

  // ── projectiles ──────────────────────────────────────────
  #stepProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]
      p.vy += PROJ_GRAVITY * dt
      p.vx += this.wind * dt
      const nx = p.x + p.vx * dt
      const ny = p.y + p.vy * dt

      // The arena is sealed — the border reads as solid, so a projectile that
      // reaches a wall/ceiling/floor is caught below (grenade bounces, bomb
      // detonates). Nothing flies off the edges.
      const hitTerrain = this.solidAt(nx, ny + p.r) || this.solidAt(nx, ny) ||
        this.solidAt(nx - p.r, ny) || this.solidAt(nx + p.r, ny)

      // Bomb arms once it has cleared its launcher, then blows on first contact.
      if (!p.armed && Math.hypot(nx - (this.worms[p.owner]?.x ?? nx), ny - (this.worms[p.owner]?.y ?? ny)) > WORM_R * 2.4) p.armed = true
      const hitWorm = p.armed ? this.#wormHitBy(p, nx, ny) : null

      if (p.kind === 'bomb' && (hitTerrain || hitWorm)) {
        this.#explode(nx, ny, BOMB_BLAST); this.projectiles.splice(i, 1); continue
      }

      if (p.kind === 'grenade') {
        p.fuse -= dt
        if (p.fuse <= 0) { this.#explode(p.x, p.y, GRENADE_BLAST); this.projectiles.splice(i, 1); continue }
        if (hitTerrain) { this.#bounce(p, nx, ny); continue }
      }

      p.x = nx; p.y = ny
    }
  }

  /** Reflect a grenade off the terrain surface using a sampled normal. */
  #bounce(p: Projectile, nx: number, ny: number): void {
    const n = this.#surfaceNormal(nx, ny)
    const vdotn = p.vx * n.x + p.vy * n.y
    p.vx = (p.vx - 2 * vdotn * n.x) * GRENADE_BOUNCE
    p.vy = (p.vy - 2 * vdotn * n.y) * GRENADE_BOUNCE
    // Step the grenade back out of the surface along the normal so it can't stick.
    p.x = nx + n.x * (p.r + 1)
    p.y = ny + n.y * (p.r + 1)
    if (Math.hypot(p.vx, p.vy) < 22) { p.vx = 0; p.vy = 0 }   // come to rest
  }

  /** Approximate the outward terrain normal by sampling solidity around a point. */
  #surfaceNormal(x: number, y: number, sampleR = 5): { x: number; y: number } {
    let gx = 0, gy = 0
    // Two rings so a body-sized probe still notices a thin surface up close —
    // important for the worm, whose contact can be a full radius from its centre.
    for (const S of [sampleR, sampleR * 0.55]) {
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2
        const sx = x + Math.cos(ang) * S, sy = y + Math.sin(ang) * S
        if (this.solidAt(sx, sy)) { gx -= Math.cos(ang); gy -= Math.sin(ang) }
      }
    }
    const len = Math.hypot(gx, gy)
    return len > 0.001 ? { x: gx / len, y: gy / len } : { x: 0, y: -1 }
  }

  #wormHitBy(p: Projectile, nx: number, ny: number): Worm | null {
    for (const w of this.worms) {
      if (!w.alive) continue
      if (p.owner === w.index && !p.armed) continue
      if (Math.hypot(w.x - nx, w.y - ny) <= WORM_R + p.r) return w
    }
    return null
  }

  // ── explosions ───────────────────────────────────────────
  #explode(x: number, y: number, radius: number): void {
    this.#carve(x, y, radius)
    this.craterQueue.push({ x, y, r: radius })
    this.blasts.push({ x, y, r: radius, t: 0, life: 0.42 })
    this.#spawnDebris(x, y, radius)

    for (const w of this.worms) {
      if (!w.alive) continue
      const dist = Math.hypot(w.x - x, w.y - y)
      const reach = radius + WORM_R
      if (dist > reach) continue
      const f = 1 - dist / reach
      w.hp -= BLAST_DAMAGE * f
      const dx = (w.x - x) || (this.#rng() - 0.5)
      const dy = (w.y - y) || -1
      const dl = Math.hypot(dx, dy) || 1
      w.vx += (dx / dl) * KNOCKBACK * f
      w.vy += (dy / dl) * KNOCKBACK * f - 90 * f      // a little lift so worms pop up
      w.onGround = false
      if (w === this.active && this.rope) this.releaseRope()
      if (w.hp <= 0) this.#killWorm(w)
    }
  }

  /** Set a solid disc of terrain to empty. */
  #carve(cx: number, cy: number, radius: number): void {
    const r2 = radius * radius
    const x0 = Math.max(0, Math.floor(cx - radius))
    const x1 = Math.min(this.width - 1, Math.ceil(cx + radius))
    const y0 = Math.max(0, Math.floor(cy - radius))
    const y1 = Math.min(this.height - 1, Math.ceil(cy + radius))
    for (let y = y0; y <= y1; y++) {
      const row = y * this.width
      const dy = y - cy
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx
        if (dx * dx + dy * dy <= r2) this.terrain[row + x] = 0
      }
    }
  }

  // ── cosmetics (blasts + debris) ──────────────────────────
  #stepCosmetics(dt: number): void {
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i]; b.t += dt
      if (b.t >= b.life) this.blasts.splice(i, 1)
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.vy += GRAVITY * 0.8 * dt
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt
      if (p.life <= 0 || p.y > this.height + 40) this.particles.splice(i, 1)
    }
  }

  #spawnDebris(x: number, y: number, radius: number): void {
    const n = Math.round(radius / 4)
    for (let i = 0; i < n; i++) {
      const a = this.#rng() * Math.PI * 2
      const s = 80 + this.#rng() * 260
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120,
        life: 0.5 + this.#rng() * 0.6, max: 1,
        color: this.#rng() < 0.5 ? '#8a5a3c' : '#caa46a',
      })
    }
  }

  // ── deaths & turn flow ───────────────────────────────────
  #killWorm(w: Worm): void {
    if (!w.alive) return
    w.alive = false
    w.hp = 0
    this.#spawnDebris(w.x, w.y, 30)
    if (w === this.active && this.rope) this.releaseRope()
    if (!this.teamAlive(0) || !this.teamAlive(1)) {
      this.winner = this.teamAlive(0) ? 0 : this.teamAlive(1) ? 1 : -1   // -1 = mutual wipe
      this.state = 'over'
    }
  }

  #endTurn(): void {
    if (this.state === 'over') return
    this.releaseRope()
    this.input.left = this.input.right = this.input.up = this.input.down = false
    if (this.winner !== null) { this.state = 'over'; return }

    const prevTeam = this.active?.team ?? 0
    const nextTeam = prevTeam === 0 ? 1 : 0
    if (!this.teamAlive(nextTeam)) {
      // Opponent already wiped — game's over (defensive; usually caught at kill).
      this.winner = this.teamAlive(prevTeam) ? prevTeam : -1
      this.state = 'over'
      return
    }
    this.activeIndex = this.#nextWormOfTeam(nextTeam)
    this.state = 'aim'
    this.turnTime = TURN_TIME
    this.retreatTime = RETREAT_TIME
    this.weapon = 'grenade'
    this.wind = this.#rollWind()
    this.charging = false
    this.power = 0
    this.#lastRopeSign = 0          // each worm's first rope can go either way
    this.facingFromAim()
  }

  /** Round-robin the next living worm of a team, continuing past the last one
   *  that played so a team cycles through all of its worms. */
  #nextWormOfTeam(team: number): number {
    const members = this.worms.filter(w => w.team === team && w.alive)
    if (members.length === 0) return this.activeIndex
    // start the search just after whoever of this team last played
    const lastPlayed = this.worms[this.activeIndex]
    const startIdx = lastPlayed && lastPlayed.team === team ? this.activeIndex : -1
    for (let off = 1; off <= this.worms.length; off++) {
      const i = ((startIdx >= 0 ? startIdx : 0) + off) % this.worms.length
      const w = this.worms[i]
      if (w.team === team && w.alive) return i
    }
    return this.worms.indexOf(members[0])
  }

  #rollWind(): number {
    return Math.round((this.#rng() * 2 - 1) * WIND_MAX)
  }

  // ── terrain & worm generation ────────────────────────────
  #generateTerrain(): void {
    const W = this.width, Hgt = this.height, t = this.terrain
    // Rolling hills: layered sines give a believable surface; the body below is
    // filled solid. Phases/amplitudes are jittered per-arena via the seeded rng.
    const base = Hgt * (0.60 + this.#rng() * 0.06)
    const a1 = 50 + this.#rng() * 30, f1 = 0.0045 + this.#rng() * 0.0025, p1 = this.#rng() * 6.28
    const a2 = 22 + this.#rng() * 16, f2 = 0.013 + this.#rng() * 0.01, p2 = this.#rng() * 6.28
    const a3 = 10 + this.#rng() * 8, f3 = 0.035 + this.#rng() * 0.02, p3 = this.#rng() * 6.28
    const surface = new Float32Array(W)
    for (let x = 0; x < W; x++) {
      let s = base + Math.sin(x * f1 + p1) * a1 + Math.sin(x * f2 + p2) * a2 + Math.sin(x * f3 + p3) * a3
      // Lift the rim a touch so worms don't spawn jammed in the corner walls.
      const edge = Math.min(x, W - 1 - x)
      if (edge < 60) s -= (60 - edge) * 0.4
      s = Math.max(Hgt * 0.34, Math.min(Hgt - 40, s))
      surface[x] = s
      const sy = s | 0
      for (let y = sy; y < Hgt; y++) t[y * W + x] = 1
    }
    this.#surface = surface
    this.#carveFloatingIslands()
    this.#carveEnclosure()
  }

  // Surface heights from generation, reused for worm placement.
  #surface: Float32Array = new Float32Array(0)

  /** Enclose the arena: a rocky CEILING with an uneven, grapple-able underside
   *  and rocky SIDE WALLS. Now the rope can hook the ceiling and swing across
   *  (classic Roper), and nothing flies out the top or sides. The bottom stays
   *  open water (the drown zone). */
  #carveEnclosure(): void {
    const W = this.width, Hgt = this.height, t = this.terrain
    // Ceiling: layered sines + occasional hanging rock nubs you can grab.
    const cBase = Hgt * (0.12 + this.#rng() * 0.03)
    const ca1 = 16 + this.#rng() * 8, cf1 = 0.006 + this.#rng() * 0.003, cp1 = this.#rng() * 6.28
    const ca2 = 7 + this.#rng() * 5, cf2 = 0.021 + this.#rng() * 0.012, cp2 = this.#rng() * 6.28
    for (let x = 0; x < W; x++) {
      let cy = cBase + Math.sin(x * cf1 + cp1) * ca1 + Math.sin(x * cf2 + cp2) * ca2
      cy += Math.pow(Math.max(0, Math.sin(x * 0.05 + cp1)), 6) * 26   // hanging nubs
      cy = Math.max(20, cy)
      const cyi = cy | 0
      for (let y = 0; y <= cyi; y++) t[y * W + x] = 1
    }
    // Side walls with a slightly uneven inner edge.
    const wBase = 20 + this.#rng() * 8
    for (let y = 0; y < Hgt; y++) {
      const left = Math.max(2, (wBase + Math.sin(y * 0.02 + 1.3) * 4 + Math.sin(y * 0.061) * 2) | 0)
      const right = W - 1 - Math.max(2, (wBase + Math.sin(y * 0.018 + 4.1) * 4 + Math.sin(y * 0.055) * 2) | 0)
      for (let x = 0; x <= left; x++) t[y * W + x] = 1
      for (let x = right; x < W; x++) t[y * W + x] = 1
    }
  }

  /** A couple of floating platforms make roping worthwhile (somewhere to swing
   *  up to). Drawn as filled ellipses above the main surface. */
  #carveFloatingIslands(): void {
    const W = this.width, t = this.terrain
    const islands = 1 + Math.floor(this.#rng() * 2)
    for (let i = 0; i < islands; i++) {
      const cx = W * (0.25 + this.#rng() * 0.5)
      const cy = this.height * (0.22 + this.#rng() * 0.16)
      const rx = 70 + this.#rng() * 90, ry = 16 + this.#rng() * 12
      const x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(W - 1, Math.ceil(cx + rx))
      const y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(this.height - 1, Math.ceil(cy + ry))
      for (let y = y0; y <= y1; y++) {
        const dy = (y - cy) / ry
        for (let x = x0; x <= x1; x++) {
          const dx = (x - cx) / rx
          if (dx * dx + dy * dy <= 1) t[y * W + x] = 1
        }
      }
    }
  }

  #spawnWorms(perTeam: number): void {
    const total = perTeam * 2
    const W = this.width
    // Evenly spread x positions with jitter, alternate teams so they interleave.
    const margin = 90
    const span = W - margin * 2
    const slots: number[] = []
    for (let i = 0; i < total; i++) {
      const base = margin + (span * (i + 0.5)) / total
      slots.push(base + (this.#rng() * 2 - 1) * (span / total) * 0.3)
    }
    // shuffle team assignment a little but keep balanced
    const teams: number[] = []
    for (let i = 0; i < total; i++) teams.push(i % 2)
    this.#shuffle(teams)
    for (let i = 0; i < total; i++) {
      const x = Math.max(margin, Math.min(W - margin, slots[i]))
      const xi = Math.max(0, Math.min(W - 1, x | 0))
      const top = this.#surface[xi] ?? (this.height * 0.6)   // GROUND surface (not the ceiling)
      this.worms.push({
        x, y: top - WORM_R - 1, vx: 0, vy: 0,
        hp: WORM_HP, alive: true, team: teams[i], index: i,
        facing: x < W / 2 ? 1 : -1, onGround: true,
      })
    }
  }

  #shuffle<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.#rng() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
  }
}

/** Small, fast, seedable PRNG (mulberry32) so each arena is reproducible from
 *  its seed and the sim never depends on Math.random mid-frame. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Re-exported geometry the renderer/overlay share.
export const WORM_RADIUS = WORM_R
