(() => {
  // hypercomb-essentials/src/games/arkanoid/engine.ts
  var DIFFICULTY = [
    { name: "Rookie", tagline: "Fresh off the block \u2014 the streets are still smiling at you.", lives: 3, ballSpeedMul: 1, enemyCapBonus: 0, enemyFireMul: 1, enemyRefillMul: 1, turretDmgMul: 1, hazardCooldownMul: 1, oscAggroMul: 1, supportMul: 1, mayhemMul: 1 },
    { name: "Hustler", tagline: "You've got a corner now \u2014 and the corner's got eyes on you.", lives: 3, ballSpeedMul: 1.08, enemyCapBonus: 0, enemyFireMul: 0.9, enemyRefillMul: 0.85, turretDmgMul: 1.15, hazardCooldownMul: 0.88, oscAggroMul: 1.15, supportMul: 1.3, mayhemMul: 1.2 },
    { name: "Made", tagline: "You got your button \u2014 respect's real now, and so are the targets on your back.", lives: 3, ballSpeedMul: 1.16, enemyCapBonus: 1, enemyFireMul: 0.8, enemyRefillMul: 0.72, turretDmgMul: 1.3, hazardCooldownMul: 0.78, oscAggroMul: 1.3, supportMul: 1.7, mayhemMul: 1.4 },
    { name: "Kingpin", tagline: "Half the city runs on your say-so \u2014 the other half wants you in the river.", lives: 2, ballSpeedMul: 1.24, enemyCapBonus: 2, enemyFireMul: 0.68, enemyRefillMul: 0.6, turretDmgMul: 1.45, hazardCooldownMul: 0.68, oscAggroMul: 1.5, supportMul: 2.2, mayhemMul: 1.7 },
    { name: "Gangster", tagline: "No rank above you, no mercy below \u2014 everybody's gunning for the throne.", lives: 1, ballSpeedMul: 1.32, enemyCapBonus: 2, enemyFireMul: 0.58, enemyRefillMul: 0.5, turretDmgMul: 1.6, hazardCooldownMul: 0.6, oscAggroMul: 1.8, supportMul: 3.2, mayhemMul: 2.2 }
  ];
  var DISPENSER_KINDS = ["frog", "bee", "crab", "ghost", "chick"];
  var POWER_META = {
    oscillate: { letter: "O", color: "#5fe0c0", name: "oscillate", desc: "Green mushroom \u2014 THE AMP. Every other power-up you grab hits harder: one O doubles them, two triples, three quadruples. Balls also weave side to side and score more. Permanent for the round." },
    break: { letter: "B", color: "#ff9f43", name: "break apart", desc: "Splits every ball into three of its own kind \u2014 white into white, colour into colour." },
    laser: { letter: "L", color: "#ff5b5b", name: "laser", desc: "Hold SPACE to charge a fireball at the bat \u2014 release to launch. Longer hold = bigger Hadouken. 4 shots, no timer; grab more to power up." },
    expand: { letter: "E", color: "#5fe08a", name: "expand", desc: "Widens your paddle. Timed." },
    gun: { letter: "G", color: "#b07bff", name: "gun", desc: "6-shot magazine. Space fires coloured ammo in a 120\xB0 fan. Grab more to stack: +diagonals, then double." },
    magnet: { letter: "M", color: "#ff5b8a", name: "magnet", desc: "Pulls the ball toward the paddle, but only while it is in the top half \u2014 releases below the halfway line. Timed." },
    rocket: { letter: "\u2191", color: "#ff7043", name: "rocket", desc: "Right-click to launch your one missile. It explodes on the first thing it hits, blasting bricks in range." },
    multiplier: { letter: "\xD7", color: "#ffd24a", name: "multiplier", desc: "2\xD7 or 3\xD7 score for everything while it lasts." },
    burst: { letter: "\u2217", color: "#3dd7ff", name: "burst", desc: "For 8 seconds every brick dies in one hit \u2014 tough ones included." },
    pinball: { letter: "P", color: "#8c9eff", name: "pinball", desc: "The board becomes a PINBALL MACHINE \u2014 fixed flippers on the mouse buttons, bumpers and table props. No timer: you play it out. It ends when you clear the level or lose a ball, then play carries on as normal. The white ball doubles in size but does only a quarter of the damage." },
    beam: { letter: "I", color: "#9d5cff", name: "beam", desc: "A purple magic mushroom. 4 shots, no timer: charges ~1.2\u20131.5s then fires a laser up the middle, damaging that whole column. Grab more to power up \u2014 level 3 clears the line." },
    clock: { letter: "T", color: "#7ee0ff", name: "time clock", desc: "Caught from the alien with at least one colour ball in play: freezes your white ball(s) and every hazard for a few seconds while colour balls keep clearing." },
    ballchain: { letter: "&", color: "#cfd3da", name: "ball & chain", desc: "A spiked wrecking ball swings from the white ball \u2014 kills the hunter and smashes falling pills. Smash 5 pills before it ends and a gold paper crane flutters down \u2014 catch it for the 100,000 jackpot." },
    extralife: { letter: "1UP", color: "#5fe08a", name: "extra life", desc: "A 1-UP! Catch this pill to gain a life. Spat out by the hopping dispenser, or by shooting the rare winged-heart carrier on its single pass. Amped by the oscillator: a 2-UP, 3-UP or 4-UP, and the life ceiling rises with it (5 \u2192 20)." },
    crane: { letter: "\u2606", color: "#ffd24a", name: "paper crane", desc: "The gold paper-crane prize from a ball & chain run. Catch it for a 100,000 jackpot." },
    pierce: { letter: "\xBB", color: "#d8e6ff", name: "pierce", desc: "The white ball phases THROUGH tiles \u2014 one damage each as it passes, no bounce \u2014 carving a tunnel. Colour balls do not pierce. Timed." },
    scramble: { letter: "?", color: "#ff3df0", name: "scramble", desc: "Scrambles EVERY ball \u2014 including your white one \u2014 into random, ever-shifting colours, so you can no longer tell yours apart by colour and must FOLLOW it by eye. Snaps back to normal (yours back to white) when it ends. Grab more to hold it longer (1 \u2192 3 \u2192 5s)." },
    heal: { letter: "\u2665", color: "#5fe08a", name: "repair", desc: "Repairs the paddle \u2014 restores a chunk of bat health." },
    shield: { letter: "\u26E8", color: "#5b9bff", name: "shield", desc: "A force shield over the bat: it takes no damage and DEFLECTS enemy fire back up. No timer \u2014 it lasts until enemy fire chips its strength away and BUSTS it. Amped shields hold a deeper pool, so they soak more hits." },
    regen: { letter: "\u271A", color: "#3fe0a8", name: "healing shield", desc: "A shield that also REGENERATES bat health \u2014 defend and heal at once. Like the plain shield it has no timer: it heals for as long as it survives, and stops when it busts." }
  };
  var POWER_ORDER = ["oscillate", "break", "laser", "expand", "gun", "magnet", "rocket", "multiplier", "burst", "pinball", "beam", "clock", "ballchain", "pierce", "scramble", "heal", "shield", "regen"];
  var W = 554.4;
  var H = 600;
  var COLS = 11;
  var BRICK_W = W / COLS;
  var BRICK_H = 16;
  var BRICK_X0 = 0;
  var BRICK_TOP = 56;
  var PADDLE_W = 84;
  var PADDLE_EXPAND_W = 134;
  var PADDLE_H = 13;
  var AIM_RANGE = PADDLE_W * 0.25;
  var AIM_ANCHOR = W / 2;
  var PADDLE_Y = H - 34;
  var PADDLE_SPEED = 620;
  var BALL_R = 7;
  var BALL_SPEED = 450;
  var BALL_SPEED_MIN = BALL_SPEED / 2;
  var LAUNCH_MAX_ANGLE = 0.7;
  var BALL_SPEEDUP = 1.03;
  var BALL_SPEED_MAX = 640;
  var MIN_VY_RATIO = 0.3;
  var START_LIVES = 3;
  var MAX_BALLS = 9;
  var CAPSULE_W = 30;
  var CAPSULE_H = 15;
  var CAPSULE_SPEED = 135;
  var INVADER_MARCH = 150;
  var INVADER_STEP = 18;
  var INVADER_FALL = 55;
  var DROP_CHANCE = 0;
  var MAX_CAPSULES = 5;
  var PILL_STAGGER = 0.25;
  var ALIEN_Y = 24;
  var ALIEN_W = 30;
  var ALIEN_H = 20;
  var ALIEN_SPEED = 80;
  var FROG_HOP_PERIOD = 0.62;
  var FROG_HOP_HEIGHT = 16;
  var FROG_AIR_FRAC = 0.78;
  var BEE_WIGGLE_HZ = 6;
  var BEE_BOB = 10;
  var BEE_SPEED_MUL = 1.15;
  var SCUTTLE_PERIOD = 0.42;
  var SCUTTLE_BOB = 8;
  var SCUTTLE_SKITTER = 0.55;
  var GHOST_BOB_PERIOD = 1.7;
  var GHOST_BOB_AMP = 14;
  var CHICK_BOB_PERIOD = 0.34;
  var CHICK_BOB_AMP = 9;
  var CHICK_GLIDE_PERIOD = 1.9;
  var CHICK_GLIDE_DIP = 7;
  var SHIP_RESPAWN = 6;
  var EXTRALIFE_CHANCE = 0.12;
  var EXTRALIFE_PILL_CHANCE = 0.18;
  var EXTRALIFE_SPEED = 50;
  var EXTRALIFE_R = 14;
  var EXTRALIFE_Y = H * 0.2;
  var MAX_LIVES = 5;
  var COMBO_MIN = 2;
  var COMBO_MILESTONE = 5;
  var COMBO_POP_DUR = 0.9;
  var PICKUP_DUR = 0.5;
  var POWER_WEIGHTS = {
    oscillate: 10,
    expand: 10,
    magnet: 8,
    laser: 7,
    break: 6,
    gun: 6,
    multiplier: 6,
    rocket: 3,
    burst: 3,
    beam: 3,
    pinball: 3,
    clock: 4,
    ballchain: 2,
    pierce: 3,
    scramble: 4,
    heal: 5,
    shield: 5,
    regen: 3,
    // defensive drops — more common when the bat is hurt (see #randomPower)
    extralife: 0,
    // never an ambient drop — only the carrier alien gives it
    crane: 0
    // never an ambient drop — only earned from a ball & chain run
  };
  var DEFENSIVE = /* @__PURE__ */ new Set(["heal", "shield", "regen"]);
  var LASER_LOADER = 4;
  var LASER_MAX_LEVEL = 3;
  var LASER_CHARGE_FULL = 1.4;
  var LASER_TIER2_AT = 0.45;
  var LASER_TIER3_AT = 0.95;
  var LASER_FIRE_CD = 0.12;
  var LASER_MUZZLE_FLASH = 0.22;
  var FIREBALL_SPEED = 560;
  var FIREBALL_DMG = [2, 4, 99];
  var FIREBALL_PIERCE = [2, 4, 8];
  var FIREBALL_AOE = [14, 22, 34];
  var FIREBALL_R = [6, 9, 13];
  var FIREBALL_TAIL = [22, 34, 50];
  var GUN_LOADER = 6;
  var GUN_COOLDOWN = 0.17;
  var GUN_SENS = 0.05;
  var GUN_AIM_CENTER = -Math.PI / 2;
  var GUN_AIM_SPAN = 2 * Math.PI / 3;
  var GUN_AIM_MIN = GUN_AIM_CENTER - GUN_AIM_SPAN / 2;
  var GUN_AIM_MAX = GUN_AIM_CENTER + GUN_AIM_SPAN / 2;
  var GUN_DIAG_SPREAD = 0.42;
  var GUN_DOUBLE_JITTER = 0.1;
  var GUN_MAX_LEVEL = 3;
  var MAGNET_DURATION = 11;
  var MAGNET_G = 460;
  var BALL_WHITE = "#ffffff";
  var BALL_COLORS = ["#ff5b5b", "#ffb14e", "#ffe24e", "#5fe08a", "#5fd0e0", "#5a9bff", "#b07bff", "#ff7bd5"];
  var EXPAND_DURATION = 13;
  var WOBBLE_BASE_AMP = 18;
  var WOBBLE_AMP_MAX = 36;
  var WOBBLE_FREQ = 8;
  var OSC_SPEEDUP = 1.08;
  var AMP_MAX = 4;
  var OSC_SCORE_PER_AMP = 0.6;
  var BREAK_FAN = 0.7;
  var ROCKET_SPEED = 460;
  var ROCKET_RADIUS = 58;
  var ROCKET_LOADER = 1;
  var ROCKET_MAX = 1;
  var EXPLOSION_DUR = 0.45;
  var GOLD_WINDOW = 12;
  var GOLD_BONUS_CAP = 2;
  var POINTS_CAP = 6;
  var PILLS_CAP = 3;
  var TOTAL_CAP = 18;
  var BURST_DURATION = 8;
  var PIERCE_DURATION = 9;
  var SCRAMBLE_DURS = [1, 3, 5];
  var ENEMY_SPAWN_DELAY = 22;
  var ENEMY_REFILL_GAP = 6;
  var ENEMY_SPEED = 105;
  var ENEMY_KINDS = ["hunter", "bomber", "splitter", "leech", "mirror", "orbit", "dart", "blink", "polarity", "queen"];
  var ENEMY_HP_BY_KIND = { hunter: 3, bomber: 2, splitter: 2, leech: 2, mirror: 2, orbit: 3, dart: 2, blink: 1, polarity: 3, queen: 5 };
  var ENEMY_R = 15;
  var MEGA_COLS = 3;
  var MEGA_ROWS = 2;
  var MEGA_HP = 5;
  var FINALE_HOLD = 1.3;
  var FINALE_FLASH = 0.7;
  var FINALE_JACKPOT = 1e4;
  var PINBALL_DAMAGE = 0.25;
  var BUMPER_R = 20;
  var BUMPER_Y = H * 0.6;
  var PINBALL_PROPS_MIN = 1;
  var PINBALL_PROPS_MAX = 2;
  var PINBALL_SHAPE = {
    jet: "disc",
    pop: "disc",
    mushroom: "disc",
    tunnel: "disc",
    jackpot: "disc",
    teleport: "disc",
    multiplier: "disc",
    extraball: "disc",
    orbit: "disc",
    drop: "target",
    standup: "target",
    bank: "target",
    slingL: "sling",
    slingR: "sling",
    magnet: "field",
    fan: "field",
    kicker: "field",
    spinner: "bar",
    rollover: "bar",
    gate: "bar"
  };
  var FLIP_LEN = 64;
  var FLIP_THICK = 5;
  var FLIP_PIVOT_DX = 82;
  var FLIP_Y_OFF = 2;
  var FLIP_REST = 0.38;
  var FLIP_UP = -0.56;
  var FLIP_RAISE_SPEED = 12;
  var PINBALL_LAUNCH = 480;
  var TURRET_FIRE_INTERVAL = 1.1;
  var TURRET_SHOT_SPEED = 210;
  var TURRET_SHOT_R = 4;
  var PADDLE_HIT_FLASH = 0.3;
  var PADDLE_MAX_HP = 100;
  var TURRET_DMG = 24;
  var HEAL_AMOUNT = 45;
  var SHIELD_MAX_HP = 100;
  var SHIELD_HIT_DMG = TURRET_DMG;
  var REGEN_RATE = 14;
  var TNT_LIFETIME = 30;
  var TNT_FUSE = 1.6;
  var TNT_RADIUS = 150;
  var TNT_R = 15;
  var TNT_FIRST = 14;
  var TNT_DMG_MAX = 3;
  var TNT_PER_LEVEL = 0.2;
  var MULT_TILE_5X_CHANCE = 0.2;
  var PILL_QUIET = 9;
  var PILL_WAVE = 5;
  var PILLS_PER_WAVE = 3;
  var HAZARD_COOLDOWN = 8;
  var PAC_R = 14;
  var PACMAN_SPEED = 130;
  var PACMAN_HP = 3;
  var PAC_EAT_CD = 0.8;
  var PAC_EAT_CAP = 4;
  var PAC_COLOR_MIN = 2;
  var PAC_SUMMON_HOLD = 1.5;
  var CLOCK_DURATION = 6;
  var BALLCHAIN_DURATION = 16;
  var CHAIN_LEN = 48;
  var WRECK_R = 9;
  var CHAIN_K = 13;
  var CHAIN_DAMP = 0.6;
  var CHAIN_DRIVE = 0.018;
  var CHAIN_BONUS_PILLS = 5;
  var CHAIN_BONUS = 1e5;
  var BEAM_LOADER = 4;
  var BEAM_MAX_LEVEL = 3;
  var BEAM_CHARGE_MIN = 1.2;
  var BEAM_CHARGE_MAX = 1.5;
  var BEAM_FLASH = 0.16;
  var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  var Engine = class {
    width = W;
    height = H;
    state = "playing";
    score = 0;
    lives = START_LIVES;
    bricks = [];
    paddle = { x: W / 2, y: PADDLE_Y, w: PADDLE_W, h: PADDLE_H };
    aiming = true;
    // one-time launch-point aim (first start of a game); see aimClick()
    balls = [];
    capsules = [];
    fireballs = [];
    // in-flight charge-cannon fireballs
    rockets = [];
    explosions = [];
    enemies = [];
    // the enemy swarm — its size cap grows with the level
    levelIndex = 0;
    // difficulty slot (set by the overlay) — more enemies on harder levels
    bumpers = [];
    // pinball-mode field bumpers (empty otherwise)
    pinballProps = [];
    // a random handful of pinball props (pinball mode only)
    flipLeftRaise = 0;
    // 0 = resting, 1 = fully flipped (left flipper, pinball mode)
    flipRightRaise = 0;
    // 0 = resting, 1 = fully flipped (right flipper)
    turretShots = [];
    // shots fired at the player by lit turret tiles
    paddleHitFlash = 0;
    // seconds left of the red flash after a turret shot lands
    paddleHp = PADDLE_MAX_HP;
    // bat health — enemy fire chips it; 0 → lose a life
    shieldHp = 0;
    // ⛨ shield strength remaining — projectiles chip it; 0 → it breaks. NO timer: this pool IS the lifetime
    regenShield = false;
    // ✚ this shield also regenerates bat HP (until it busts)
    shieldFlash = 0;
    // brief flash when the shield deflects a shot
    tnt = null;
    // the centre dynamite crate (null = none on screen)
    alien = null;
    // the top ship dispenser (respawns when shot)
    extraLife = null;
    // the winged-heart 1-UP carrier (null = none)
    pacman = null;
    // the colour-ball-eating rival (null = none)
    combo = 0;
    // bricks killed since the last paddle bounce
    comboPops = [];
    // floating combo counters (transient, for the renderer)
    pickups = [];
    // caught-bonus flashes (transient, for the renderer)
    // Fireball cannon (the reworked laser): a 4-loader you charge + release by hand.
    laserShots = 0;
    // shots left in the loader (0 = no cannon)
    laserLevel = 0;
    // power level 1..3 (re-grab before empty to raise)
    laserCharging = false;
    // true while the fire input is HELD
    laserCharge = 0;
    // seconds the current hold has accumulated
    laserMuzzleFlash = 0;
    // seconds left of the launch kick-flash at the bat
    // The active difficulty mode (Rookie = current). The overlay sets this on a fresh run.
    difficulty = DIFFICULTY[0];
    invaderPills = false;
    // SPACE-INVADER pill march (set by the overlay on invader levels)
    // Timed power state (seconds remaining; 0 = inactive).
    expandTimer = 0;
    magnetTimer = 0;
    burstTimer = 0;
    pinball = false;
    // pinball MACHINE mode — no clock; ends only on a level clear or a death
    pierceTimer = 0;
    // white ball phases through tiles while > 0
    // Scramble (?): while > 0, EVERY ball renders in random, ever-shifting colours
    // (the hero loses its white too) so you must follow yours by eye; reverts to
    // normal when it ends. Purely a render concern — the engine just owns the clock.
    scrambleTimer = 0;
    scrambleLevel = 0;
    // 0..2 → index into SCRAMBLE_DURS (steps up on re-grab)
    // Beam (purple mushroom): ammo-based (no timer) with a power level 1-3.
    beamShots = 0;
    // shots left in the loader (0 = no beam)
    beamLevel = 0;
    // 1 = chip, 2 = ×2 damage, 3 = clears the whole line
    beamCharge = 0;
    // seconds into the current charge (fires at beamTarget)
    beamTarget = BEAM_CHARGE_MIN;
    // this cycle's charge duration (random 1.2–1.5s)
    beamFlash = 0;
    // seconds left of the release-flash visual
    beamX = W / 2;
    // x of the last released beam
    // Oscillate is permanent for the round and stacks (0 = off). Each pickup
    // widens the weave (doubling) and bumps ball speed.
    oscillateStacks = 0;
    // POINTS axis — the unified gold bonus (0..GOLD_BONUS_CAP) fed by the gold pill,
    // the ×N tiles AND the pinball multiplier disc, holding for one GOLD_WINDOW.
    goldBonus = 0;
    goldTimer = 0;
    // PILLS axis — every caught pill adds +0.1 (capped at PILLS_CAP); halves on death.
    pillMul = 1;
    // Milestone celebration (combo ×5/×10/…): a transient eruption + a score flash.
    milestoneFx = null;
    scoreFlash = 0;
    // Clock freeze: while > 0, white ball(s) + every hazard are frozen.
    freezeTimer = 0;
    // Ball & chain: a swinging spiked wrecking ball hanging off the white ball.
    ballchainTimer = 0;
    chainBall = null;
    // the wrecking ball (render + hits)
    ballchainKills = 0;
    // pills smashed this window (10 → jackpot)
    // Rocket charges available to fire (a rocket in flight lives in `rockets`).
    rocketAmmo = 0;
    // The gun is ammo-based, not timed: shots left in the loader (0 = no gun).
    gunAmmo = 0;
    // Gun stacking level (1 = single, 2 = +diagonals, 3 = double shots). Raised by
    // grabbing another gun before the loader runs dry.
    gunLevel = 0;
    /** Gun aim, radians (0 = +x, -PI/2 = straight up). Steered by paddle motion,
     *  clamped to the 120° fan [GUN_AIM_MIN, GUN_AIM_MAX]. */
    aimAngle = -Math.PI / 2;
    /** Set by the overlay from keyboard. */
    input = { left: false, right: false };
    #pointerX = null;
    #laserCd = 0;
    #gunCd = 0;
    #prevPaddleX = W / 2;
    #launchOffset = 0;
    // the ball's position ON the paddle (offset from centre) — reused all game
    #colorIdx = 0;
    // cycles BALL_COLORS so each ammo ball differs
    #levelClock = 0;
    // seconds on this screen — drives the enemy spawn
    #levelRows = 0;
    // rows in the current level (mega footprint clamp)
    #paddleBaseW = PADDLE_W;
    // permanent bat width (grown 25% by each oscillate); expand widens on top
    // Loader sizes / pools SNAPSHOTTED at pickup, because the AMP scales them. The HUD
    // pip rows and strength bars divide by these, so they must track the grant that
    // actually happened — reading the base constant would overflow an amped bar, and
    // reading `amp` live would rescale a bar the moment a later O landed.
    #gunLoader = GUN_LOADER;
    #beamLoader = BEAM_LOADER;
    #laserLoader = LASER_LOADER;
    #rocketMax = ROCKET_MAX;
    #shieldMax = SHIELD_MAX_HP;
    // Same reason, for the timed powers whose HUD bar is EXACT today (they assign
    // rather than stack, so a clamped denominator would visibly lie once amped).
    // expand/magnet/burst/pierce/shield/regen already pin at full when stacked, so
    // they keep reading their base constant.
    #scrambleDur = SCRAMBLE_DURS[0];
    #clockDur = CLOCK_DURATION;
    #ballchainDur = BALLCHAIN_DURATION;
    #turretFireCd = 0;
    // countdown to the active turret's next shot
    #tntTimer = TNT_FIRST;
    // seconds until the next dynamite crate appears
    #chainAngle = 0;
    // wrecking-ball pendulum angle (0 = straight down)
    #chainAngVel = 0;
    // pendulum angular velocity
    #chainBonusPaid = false;
    // the 100k jackpot pays once per window
    #flipLDown = false;
    // left mouse held (left flipper up)
    #flipRDown = false;
    // right mouse held (right flipper up)
    #flipLVel = 0;
    // left flipper raise delta this frame (>0 = rising → kick)
    #flipRVel = 0;
    // right flipper raise delta this frame
    // Encounter director: one major hazard at a time + a calm between them.
    #activeHazard = "none";
    #hazardCooldown = 0;
    // seconds of guaranteed calm before the next major hazard
    // Pill waves (the only ambient pill source).
    #pillPhase = "quiet";
    #pillClock = 0;
    #waveBudget = 0;
    // pills the alien still has loaded this wave (released on hit)
    #colorBallTimer = 0;
    // how long ≥ PAC_COLOR_MIN colour balls have been up (summons Pac-Man)
    #tntArmedThisLevel = false;
    // rolled once per level: is there a crate this board?
    finaleTimer = 0;
    // > 0 = the board is clear and the finale fireworks are playing; the win is declared when it runs out
    rushFlash = 0;
    // seconds left of the finale's gold flash burst
    #finaleFired = false;
    // the finale plays once per level
    #shipRespawn = 0;
    // seconds until the next alien ship flies in (when destroyed)
    #dispenserSeq = Math.floor(Math.random() * DISPENSER_KINDS.length);
    // rotates the critter cast (random start)
    constructor(level) {
      this.#build(level);
      this.#resetForLife();
    }
    // ── setup ────────────────────────────────────────────────
    #build(level) {
      this.bricks = [];
      this.#levelRows = level.length;
      for (let r = 0; r < level.length; r++) {
        const row = level[r] ?? "";
        for (let c = 0; c < COLS; c++) {
          const ch = row[c] ?? ".";
          if (ch === "." || ch === " ") continue;
          const hp = ch === "*" ? 4 : Math.max(1, parseInt(ch, 10) || 1);
          this.bricks.push({ x: BRICK_X0 + c * BRICK_W, y: BRICK_TOP + r * BRICK_H, w: BRICK_W, h: BRICK_H, hp, max: hp, alive: true, col: c, row: r });
        }
      }
      this.#placeMultTiles();
      this.#tntArmedThisLevel = Math.random() < TNT_PER_LEVEL;
      this.#spawnShip(false);
    }
    /** A major hazard may begin only when the slot is free AND the calm has elapsed. */
    #hazardFree() {
      return this.#activeHazard === "none" && this.#hazardCooldown <= 0;
    }
    /** A major hazard resolved — start the guaranteed calm before the next one. */
    #endHazard() {
      this.#activeHazard = "none";
      this.#hazardCooldown = HAZARD_COOLDOWN * this.difficulty.hazardCooldownMul;
    }
    /** Tag three random tiles as ×1/×2/×3 score-multiplier tiles, and ~every fifth
     *  board hide a rare ×5 inside an ordinary-looking brick (revealed only when broken). */
    #placeMultTiles() {
      const pool = this.bricks.filter((b) => b.alive && !b.mega && !b.seed);
      const pick = () => {
        if (!pool.length) return null;
        return pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      };
      for (const m of [1, 2, 3]) {
        const b = pick();
        if (b) b.mult = m;
      }
      if (Math.random() < MULT_TILE_5X_CHANCE) {
        const b = pick();
        if (b) {
          b.mult = 5;
          b.hidden = true;
        }
      }
    }
    #spawnShip(allowCarrier = true) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const kind = DISPENSER_KINDS[this.#dispenserSeq % DISPENSER_KINDS.length];
      this.#dispenserSeq++;
      this.alien = { x: dir > 0 ? ALIEN_W / 2 : W - ALIEN_W / 2, y: ALIEN_Y, vx: ALIEN_SPEED * dir, frame: 0, kind };
      if (allowCarrier && !this.extraLife && this.lives < this.maxLives && this.#hazardFree() && Math.random() < EXTRALIFE_CHANCE) {
        this.#spawnExtraLife();
      }
    }
    /** Release the winged-heart 1-UP carrier from one edge, heading across. */
    #spawnExtraLife() {
      const fromLeft = Math.random() < 0.5;
      this.extraLife = { x: fromLeft ? EXTRALIFE_R : W - EXTRALIFE_R, y: EXTRALIFE_Y, vx: (fromLeft ? 1 : -1) * EXTRALIFE_SPEED, t: 0, bounced: false };
      this.#activeHazard = "carrier";
    }
    /** Move the active dispenser critter across the top (one of a rotating cast). Each
     *  kind sets a.y + its x-advance off the a.frame phase clock; every hit/bounce/spit
     *  site reads a.x/a.y live, so a critter dispenses from wherever its motion puts it. */
    #stepAlien(dt) {
      if (this.freezeTimer > 0) return;
      const a = this.alien;
      if (!a) {
        this.#shipRespawn -= dt;
        if (this.#shipRespawn <= 0) this.#spawnShip();
        return;
      }
      a.frame += dt;
      let dx = a.vx * dt;
      switch (a.kind) {
        case "frog": {
          const ph = a.frame % FROG_HOP_PERIOD / FROG_HOP_PERIOD;
          let lift = 0, glide = 0;
          if (ph < FROG_AIR_FRAC) {
            const u = ph / FROG_AIR_FRAC;
            lift = Math.sin(u * Math.PI);
            glide = Math.sin(u * Math.PI);
          }
          a.y = ALIEN_Y - FROG_HOP_HEIGHT * lift;
          dx = a.vx * (1 / (2 / Math.PI * FROG_AIR_FRAC)) * glide * dt;
          break;
        }
        case "bee": {
          const w2 = a.frame * BEE_WIGGLE_HZ * Math.PI * 2;
          a.y = ALIEN_Y + BEE_BOB * (0.82 * Math.sin(w2) + 0.18 * Math.sin(w2 * 2.7));
          dx = a.vx * BEE_SPEED_MUL * dt;
          break;
        }
        case "crab": {
          const ph = a.frame % SCUTTLE_PERIOD / SCUTTLE_PERIOD;
          a.y = ALIEN_Y - SCUTTLE_BOB * Math.abs(Math.sin(ph * Math.PI * 2));
          dx = a.vx * (1 + SCUTTLE_SKITTER * Math.cos(ph * Math.PI * 2)) * dt;
          break;
        }
        case "ghost": {
          const t = a.frame / GHOST_BOB_PERIOD * Math.PI * 2;
          a.y = ALIEN_Y + GHOST_BOB_AMP * Math.sin(t);
          dx = a.vx * (1 + 0.18 * Math.sin(t + Math.PI / 2)) * dt;
          break;
        }
        case "chick": {
          const beat = a.frame % CHICK_BOB_PERIOD / CHICK_BOB_PERIOD;
          const bob = CHICK_BOB_AMP * (-Math.cos(beat * Math.PI * 2) * 0.5 + 0.5);
          const glidePh = a.frame % CHICK_GLIDE_PERIOD / CHICK_GLIDE_PERIOD;
          const dip = CHICK_GLIDE_DIP * Math.max(0, -Math.sin(glidePh * Math.PI * 2));
          a.y = ALIEN_Y + (CHICK_BOB_AMP * 0.5 - bob) + dip;
          break;
        }
        default:
          a.y = ALIEN_Y;
      }
      a.x += dx;
      if (a.x < ALIEN_W / 2) {
        a.x = ALIEN_W / 2;
        a.vx = Math.abs(a.vx);
      } else if (a.x > W - ALIEN_W / 2) {
        a.x = W - ALIEN_W / 2;
        a.vx = -Math.abs(a.vx);
      }
    }
    /** Sweep the carrier to the FAR side, bounce once, return, and leave on the near
     *  side if it was never shot (travel to one side and back before leaving). */
    #stepExtraLife(dt) {
      if (this.freezeTimer > 0) return;
      const c = this.extraLife;
      if (!c) return;
      c.t += dt;
      c.x += c.vx * dt;
      if (!c.bounced) {
        if (c.x <= EXTRALIFE_R || c.x >= W - EXTRALIFE_R) {
          c.vx = -c.vx;
          c.bounced = true;
          c.x = clamp(c.x, EXTRALIFE_R, W - EXTRALIFE_R);
        }
      } else if (c.x < -EXTRALIFE_R * 2 || c.x > W + EXTRALIFE_R * 2) {
        this.extraLife = null;
        this.#endHazard();
      }
    }
    /** Shoot the carrier → drop a 1-UP. */
    #hitExtraLife() {
      const c = this.extraLife;
      if (!c) return;
      this.explosions.push({ x: c.x, y: c.y, t: 0 });
      this.#dropPill(c.x, c.y + EXTRALIFE_R, "extralife");
      this.#addScore(150);
      this.extraLife = null;
      this.#endHazard();
    }
    /** A ball touching the carrier pops it (and bounces down). */
    #extraLifeBounce(b) {
      const c = this.extraLife;
      if (!c) return;
      const dx = b.x - c.x, dy = b.y - c.y;
      if (dx * dx + dy * dy > (EXTRALIFE_R + b.r) * (EXTRALIFE_R + b.r)) return;
      b.vy = Math.abs(b.vy);
      b.y = c.y + EXTRALIFE_R + b.r + 1;
      this.#hitExtraLife();
    }
    /** Shoot the ship down: explode, feed the combo, score, and DROP A PILL when hit
     *  (the alien is the dispenser) — but only while the wave budget has one loaded. */
    #destroyShip() {
      const a = this.alien;
      if (!a) return;
      this.explosions.push({ x: a.x, y: a.y, t: 0 });
      if (this.#waveBudget > 0 && this.#dropPill(a.x, a.y + ALIEN_H / 2, this.#dispensePower())) {
        this.#waveBudget--;
      }
      this.#bumpCombo(a.x, a.y);
      this.#addScore(100);
      this.alien = null;
      this.#shipRespawn = SHIP_RESPAWN;
    }
    /** True if (x,y) is inside the ship — used by laser/beam hits. */
    #shipHitAt(x, y) {
      const a = this.alien;
      return !!a && x >= a.x - ALIEN_W / 2 && x <= a.x + ALIEN_W / 2 && y >= a.y - ALIEN_H / 2 && y <= a.y + ALIEN_H / 2;
    }
    /** Ball reaches the ship: bounce it down and shoot the ship out of the sky. */
    #alienBounce(b) {
      const a = this.alien;
      if (!a) return;
      const cx = clamp(b.x, a.x - ALIEN_W / 2, a.x + ALIEN_W / 2);
      const cy = clamp(b.y, a.y - ALIEN_H / 2, a.y + ALIEN_H / 2);
      const dx = b.x - cx, dy = b.y - cy;
      if (dx * dx + dy * dy > b.r * b.r) return;
      b.vy = Math.abs(b.vy);
      b.y = a.y + ALIEN_H / 2 + b.r + 1;
      this.#destroyShip();
    }
    /** A hit on an enemy feeds the combo. */
    #countEnemyHit(x = W / 2, y = BRICK_TOP * 0.5) {
      this.#bumpCombo(x, y);
    }
    /** Mark the LAST brick standing as the level's finale beacon: it turns gold and
     *  pulses, so the final hit of a level is a target you can see coming. Purely a
     *  marker — it keeps its own hp and dies to anything, exactly like any other tile.
     *  Megas are skipped: shattering one refills the board with shards, so it is never
     *  really "the last brick". */
    #markFinalBrick() {
      if (this.#finaleFired || this.bricksLeft !== 1) return;
      const last = this.bricks.find((b) => b.alive && !b.seed && !b.mega);
      if (last) last.gold = true;
    }
    /** The board just emptied → the FINALE. Fires once, and deliberately on the CLEAR
     *  rather than on the gold brick's death, so it still pays out when a rocket or a
     *  TNT blast wipes the last several tiles at once (those routes bypass #damage).
     *  Holds the win for FINALE_HOLD so the fireworks play on the live board. */
    #startFinale() {
      if (this.#finaleFired || this.bricksLeft > 0) return;
      this.#finaleFired = true;
      this.finaleTimer = FINALE_HOLD;
      this.rushFlash = FINALE_FLASH;
      this.#addScore(FINALE_JACKPOT);
      this.comboPops.push({ x: W / 2, y: H * 0.42, n: 0, pts: FINALE_JACKPOT, t: 0 });
      for (let i = 0; i < 10; i++) {
        this.explosions.push({ x: W / 2 + Math.cos(i * 0.63) * 78, y: H * 0.42 + Math.sin(i * 0.63) * 46, t: 0 });
      }
    }
    /** The level is won once the board is empty — but NOT while the finale fireworks
     *  are still playing, or the overlay would cut to its tally mid-burst. Every win
     *  check routes through here. */
    #checkWin() {
      if (this.bricksLeft === 0 && this.finaleTimer <= 0) this.state = "won";
    }
    /** True while the finale is playing (renderer/overlay cue). */
    get finale() {
      return this.finaleTimer > 0;
    }
    /** Tick seed bloom timers; a ripe seed blooms into a mega brick. */
    #stepBricks(dt) {
      for (const b of this.bricks) {
        if (b.seed && b.alive && b.bloom !== void 0) {
          b.bloom -= dt;
          if (b.bloom <= 0) this.#bloomSeed(b);
        }
      }
    }
    /** Grow a seed into a big brick over an MEGA_COLS×MEGA_ROWS block. */
    #bloomSeed(seed) {
      const c0 = clamp((seed.col ?? 0) - Math.floor(MEGA_COLS / 2), 0, Math.max(0, COLS - MEGA_COLS));
      const r0 = clamp(seed.row ?? 0, 0, Math.max(0, this.#levelRows - MEGA_ROWS));
      this.#createMega(c0, r0);
    }
    /** Build the big gold brick over the MEGA_COLS×MEGA_ROWS block at (c0,r0),
     *  covering (consuming) any bricks inside the footprint and ejecting any ball
     *  caught within it. */
    #createMega(c0, r0) {
      const cols = MEGA_COLS, rows = MEGA_ROWS;
      for (const b of this.bricks) {
        if (!b.alive || b.mega) continue;
        if (b.col !== void 0 && b.row !== void 0 && b.col >= c0 && b.col < c0 + cols && b.row >= r0 && b.row < r0 + rows) {
          b.alive = false;
          b.seed = false;
          b.covered = true;
        }
      }
      const mx = BRICK_X0 + c0 * BRICK_W, my = BRICK_TOP + r0 * BRICK_H;
      const mw = cols * BRICK_W, mh = rows * BRICK_H;
      const mega = {
        x: mx,
        y: my,
        w: mw,
        h: mh,
        hp: MEGA_HP,
        max: MEGA_HP,
        alive: true,
        mega: true,
        col: c0,
        row: r0,
        megaCols: cols,
        megaRows: rows
      };
      this.bricks.push(mega);
      for (const b of this.balls) {
        if (b.stuck || b.x < mx || b.x > mx + mw || b.y < my || b.y > my + mh) continue;
        const dl = b.x - mx, dr = mx + mw - b.x, dtop = b.y - my, dbot = my + mh - b.y;
        const m = Math.min(dl, dr, dtop, dbot);
        if (m === dl) {
          b.x = mx - b.r;
          b.vx = -Math.abs(b.vx);
        } else if (m === dr) {
          b.x = mx + mw + b.r;
          b.vx = Math.abs(b.vx);
        } else if (m === dtop) {
          b.y = my - b.r;
          b.vy = -Math.abs(b.vy);
        } else {
          b.y = my + mh + b.r;
          b.vy = Math.abs(b.vy);
        }
      }
      return mega;
    }
    /** Shatter a destroyed mega into 1-hit shards filling its footprint; EVERY shard
     *  is a guaranteed power-up tile — each drops a (weighted-random) power-up when
     *  broken, so cracking the big block rains a bonanza of pills. */
    #breakMega(mega) {
      const c0 = mega.col ?? 0, r0 = mega.row ?? 0;
      const cc = mega.megaCols ?? MEGA_COLS, rr = mega.megaRows ?? MEGA_ROWS;
      const shards = [];
      for (let r = r0; r < r0 + rr; r++) {
        for (let c = c0; c < c0 + cc; c++) {
          shards.push({ x: BRICK_X0 + c * BRICK_W, y: BRICK_TOP + r * BRICK_H, w: BRICK_W, h: BRICK_H, hp: 1, max: 1, alive: true, col: c, row: r, drop: this.#randomPower() });
        }
      }
      this.bricks.push(...shards);
      this.#addScore(80);
    }
    #newBall(x, y, vx, vy, stuck = false, primary = false) {
      return { x, y, vx, vy, r: BALL_R, stuck, wobble: 0, primary, color: primary ? BALL_WHITE : this.#pickColor() };
    }
    /** Next colour for an ammo ball, cycling the palette so consecutive shots differ. */
    #pickColor() {
      const c = BALL_COLORS[this.#colorIdx % BALL_COLORS.length];
      this.#colorIdx++;
      return c;
    }
    /** The white primary ball, stuck to the bat — the one you must keep alive. */
    #stuckBall() {
      return this.#newBall(this.paddle.x, this.paddle.y - BALL_R - 1, 0, 0, true, true);
    }
    /** Reset bat width + a single stuck ball + clear power state (load or after a
     *  death). Keeps the bat's current X (only re-clamps to the base width) so a
     *  lost ball never teleports the bat to centre mid-game; the constructor seeds
     *  the initial centre via the field initializer. */
    #resetForLife() {
      this.#paddleBaseW = PADDLE_W;
      this.paddle.w = PADDLE_W;
      this.paddle.x = clamp(this.paddle.x, PADDLE_W / 2, W - PADDLE_W / 2);
      this.#prevPaddleX = this.paddle.x;
      this.balls = [this.#stuckBall()];
      this.capsules = [];
      this.fireballs = [];
      this.rockets = [];
      this.explosions = [];
      this.enemies = [];
      this.extraLife = null;
      this.bumpers = [];
      this.pinballProps = [];
      this.flipLeftRaise = this.flipRightRaise = 0;
      this.#flipLDown = this.#flipRDown = false;
      this.#flipLVel = this.#flipRVel = 0;
      this.#clearTurrets();
      this.paddleHitFlash = 0;
      this.paddleHp = PADDLE_MAX_HP;
      this.shieldHp = this.shieldFlash = 0;
      this.regenShield = false;
      this.tnt = null;
      this.#tntTimer = TNT_FIRST;
      this.rushFlash = 0;
      this.pacman = null;
      this.#activeHazard = "none";
      this.#hazardCooldown = 0;
      this.#colorBallTimer = 0;
      this.#pillPhase = "quiet";
      this.#pillClock = 0;
      this.#waveBudget = 0;
      this.pillMul = Math.max(1, this.pillMul / 2);
      this.freezeTimer = 0;
      this.ballchainTimer = 0;
      this.chainBall = null;
      this.ballchainKills = 0;
      this.#chainBonusPaid = false;
      this.#chainAngle = this.#chainAngVel = 0;
      this.combo = 0;
      this.comboPops = [];
      this.pickups = [];
      this.#levelClock = 0;
      this.expandTimer = this.magnetTimer = this.burstTimer = this.pierceTimer = 0;
      this.pinball = false;
      this.scrambleTimer = this.scrambleLevel = 0;
      this.beamShots = this.beamLevel = this.beamCharge = this.beamFlash = 0;
      this.laserShots = this.laserLevel = this.laserCharge = this.laserMuzzleFlash = 0;
      this.laserCharging = false;
      this.fireballs = [];
      this.oscillateStacks = 0;
      this.#gunLoader = GUN_LOADER;
      this.#beamLoader = BEAM_LOADER;
      this.#laserLoader = LASER_LOADER;
      this.#rocketMax = ROCKET_MAX;
      this.#shieldMax = SHIELD_MAX_HP;
      this.#scrambleDur = SCRAMBLE_DURS[0];
      this.#clockDur = CLOCK_DURATION;
      this.#ballchainDur = BALLCHAIN_DURATION;
      this.goldBonus = this.goldTimer = 0;
      this.milestoneFx = null;
      this.scoreFlash = 0;
      this.gunAmmo = this.gunLevel = this.rocketAmmo = 0;
      this.#laserCd = this.#gunCd = 0;
      this.aimAngle = GUN_AIM_CENTER;
      this.input.left = this.input.right = false;
      this.#pointerX = null;
    }
    get bricksLeft() {
      let n = 0;
      for (const b of this.bricks) if (b.alive) n++;
      return n;
    }
    /** THE AMP — the oscillator's force multiplier on every OTHER power-up.
     *  0 stacks → 1 (un-amped), 1 → 2 (double), 2 → 3 (triple), 3+ → 4 (quadruple).
     *  Every grant site in #applyPower multiplies by this, so one green mushroom
     *  turns the whole kit up a notch. Capped at AMP_MAX — it scales ammo counts,
     *  blast radii, ball caps and durations, none of which may run away. */
    get amp() {
      return Math.min(AMP_MAX, 1 + this.oscillateStacks);
    }
    /** On-screen ball cap — amped, so a quadrupled Break really is a ball storm. */
    get maxBalls() {
      return MAX_BALLS * this.amp;
    }
    /** Life ceiling — amped (5 → 10 → 15 → 20). Extra lives are an effect like any
     *  other, so the amp has to lift the CEILING too: a quadrupled 1-UP that pays +4
     *  into a cap of 5 would hand back nothing. Every "can you still earn a life?"
     *  gate reads this — the carrier spawn, the 1-UP pill roll, the combo milestone.
     *  Only GAINS are gated: a death drops the amp back to 1 without ever clipping
     *  lives you already banked. */
    get maxLives() {
      return MAX_LIVES * this.amp;
    }
    /** Active powers for the HUD badge row (kind, 0..1 bar, label). The gun is NOT
     *  here — it renders its own pip magazine (see gunActive). */
    get activePowers() {
      const out = [];
      const addTimed = (kind, t, dur) => {
        if (t > 0) out.push({ kind, frac: clamp(t / dur, 0, 1), label: `${Math.ceil(t)}s` });
      };
      if (this.oscillateStacks > 0) out.push({ kind: "oscillate", frac: 1, label: `AMP\xD7${this.amp}` });
      addTimed("expand", this.expandTimer, EXPAND_DURATION);
      addTimed("magnet", this.magnetTimer, MAGNET_DURATION);
      addTimed("burst", this.burstTimer, BURST_DURATION);
      if (this.pinball) out.push({ kind: "pinball", frac: 1, label: "ON" });
      addTimed("clock", this.freezeTimer, this.#clockDur);
      addTimed("pierce", this.pierceTimer, PIERCE_DURATION);
      if (this.scrambleTimer > 0) out.push({ kind: "scramble", frac: clamp(this.scrambleTimer / this.#scrambleDur, 0, 1), label: `${Math.ceil(this.scrambleTimer)}s` });
      if (this.shieldHp > 0) {
        out.push({ kind: this.regenShield ? "regen" : "shield", frac: this.shieldHpFrac, label: `${Math.ceil(this.shieldHpFrac * 100)}%` });
      }
      if (this.ballchainTimer > 0) out.push({ kind: "ballchain", frac: clamp(this.ballchainTimer / this.#ballchainDur, 0, 1), label: `${this.ballchainKills}/${CHAIN_BONUS_PILLS}` });
      if (this.beamShots > 0) {
        const lvl = this.beamLevel >= 2 ? `L${this.beamLevel}` : "";
        out.push({ kind: "beam", frac: clamp(this.beamShots / this.#beamLoader, 0, 1), label: `${lvl}\xD7${this.beamShots}` });
      }
      if (this.laserShots > 0) {
        const lvl = this.laserLevel >= 2 ? `L${this.laserLevel}` : "";
        out.push({ kind: "laser", frac: clamp(this.laserShots / this.#laserLoader, 0, 1), label: `${lvl}\xD7${this.laserShots}` });
      }
      if (this.rocketAmmo > 0 || this.rockets.length > 0) {
        out.push({ kind: "rocket", frac: clamp(this.rocketAmmo / this.#rocketMax, 0, 1), label: `\xD7${this.rocketAmmo}` });
      }
      return out;
    }
    get gunActive() {
      return this.gunAmmo > 0;
    }
    /** Pips to draw in the magazine — the loader as GRANTED (amped), so the row
     *  always matches the ammo actually loaded. */
    get gunLoaderSize() {
      return this.#gunLoader;
    }
    /** Shielded while a plain or healing shield is up AND still has strength left. */
    get shielded() {
      return this.shieldHp > 0;
    }
    /** 0..1 remaining shield strength (for the dome / depletion read), against the
     *  pool as GRANTED — an amped shield starts full and depletes over more hits. */
    get shieldHpFrac() {
      return clamp(this.shieldHp / this.#shieldMax, 0, 1);
    }
    /** 0..1 paddle health (for the bar). */
    get paddleHpFrac() {
      return clamp(this.paddleHp / PADDLE_MAX_HP, 0, 1);
    }
    /** 0..1 charge progress of the beam (purple mushroom), for the renderer. */
    get beamChargeFrac() {
      return this.beamShots > 0 ? clamp(this.beamCharge / this.beamTarget, 0, 1) : 0;
    }
    /** 0..1 fade of the beam's release flash, for the renderer. */
    get beamFlashFrac() {
      return clamp(this.beamFlash / BEAM_FLASH, 0, 1);
    }
    /** Hold-charge progress (0..1) of the fireball cannon, for the muzzle orb. */
    get laserChargeFrac() {
      return this.laserShots > 0 && this.laserCharging ? clamp(this.laserCharge / LASER_CHARGE_FULL, 0, 1) : 0;
    }
    /** 0..1 fade of the launch kick-flash at the bat. */
    get laserMuzzleFrac() {
      return clamp(this.laserMuzzleFlash / LASER_MUZZLE_FLASH, 0, 1);
    }
    /** Current charge tier (0 = no cannon), so the renderer can colour the orb. */
    get laserTier() {
      return this.laserShots > 0 ? this.#tierFor(this.laserCharge) : 0;
    }
    /** Hold-time → tier. Single source of truth for the tier mapping. */
    #tierFor(charge) {
      return charge >= LASER_TIER3_AT ? 3 : charge >= LASER_TIER2_AT ? 2 : 1;
    }
    /** 0..1 fade of the paddle's red flash after a turret shot lands, for the renderer. */
    get paddleHitFlashFrac() {
      return clamp(this.paddleHitFlash / PADDLE_HIT_FLASH, 0, 1);
    }
    // ── input ────────────────────────────────────────────────
    movePaddleTo(worldX) {
      this.#pointerX = worldX;
    }
    /** The ball's set position ON the paddle — offset from paddle centre (for overlay reuse). */
    get launchOffset() {
      return this.#launchOffset;
    }
    /** The still-ball anchor + slide range for the aim hint. */
    get aimAnchorX() {
      return AIM_ANCHOR;
    }
    get aimRange() {
      return AIM_RANGE;
    }
    /** One-time aim (the very first start of a game): the ball hangs still at centre
     *  while you slide the PADDLE under it (±25% of paddle width) to choose where on the
     *  paddle the ball sits. The FIRST click SETS that on-paddle spot and UNLOCKS the
     *  paddle (full range) — the ball stays stuck, so you can move around and then LAUNCH
     *  (shoot) whenever you want. The offset is reused for the whole game. */
    aimClick() {
      if (!this.aiming || this.state !== "playing") return;
      this.#launchOffset = clamp(AIM_ANCHOR - this.paddle.x, -AIM_RANGE, AIM_RANGE);
      this.aiming = false;
    }
    /** Pin the on-paddle position set by the first aim — skips aim on later levels/restarts. */
    pinLaunchOffset(offset) {
      this.#launchOffset = clamp(offset, -AIM_RANGE, AIM_RANGE);
      this.aiming = false;
      for (const b of this.balls) if (b.stuck) {
        b.x = this.paddle.x + this.#launchOffset;
        b.y = this.paddle.y - b.r - 1;
      }
    }
    /** Space / left-click: launch stuck balls, else fire gun + laser if armed.
     *  (The missile is on right-click — see fireRocket.) */
    shoot() {
      if (this.state !== "playing" || this.aiming) return;
      let launched = false;
      for (const b of this.balls) {
        if (!b.stuck) continue;
        this.#launchBall(b);
        launched = true;
      }
      if (launched) return;
      if (this.gunAmmo > 0) this.#fireGun();
    }
    /** PRESS: begin a fresh hold-charge of the fireball cannon (called once per press;
     *  the overlay latches key-repeat). No-op if no cannon, aiming, or already charging. */
    startLaserCharge() {
      if (this.laserCharging) return;
      if (this.state !== "playing" || this.aiming || this.laserShots <= 0 || this.#laserCd > 0) return;
      this.laserCharging = true;
      this.laserCharge = 0;
    }
    /** RELEASE: launch the charged fireball (tier by hold time). Releasing with no
     *  shots just cancels the hold. */
    releaseLaser() {
      if (!this.laserCharging) return;
      this.laserCharging = false;
      if (this.laserShots > 0) this.#fireFireball();
      this.laserCharge = 0;
    }
    /** Right-click: launch the one missile if you have it and none is airborne.
     *  It flies up and explodes on the first thing it hits. */
    fireRocket() {
      if (this.state !== "playing" || this.rocketAmmo <= 0 || this.rockets.length >= this.amp) return;
      this.rocketAmmo--;
      this.rockets.push({ x: this.paddle.x, y: this.paddle.y - 8, vy: -ROCKET_SPEED });
    }
    /** Blast every alive brick within ROCKET_RADIUS of the rocket and leave a
     *  visual shock-ring. Does NOT remove the rocket — the caller owns that. */
    #detonateRocket(rk) {
      const radius = ROCKET_RADIUS * this.amp;
      this.explosions.push({ x: rk.x, y: rk.y, t: 0, r: radius });
      for (const brick of [...this.bricks]) {
        if (!brick.alive || brick.seed) continue;
        const bxc = brick.x + brick.w / 2, byc = brick.y + brick.h / 2;
        if (Math.hypot(bxc - rk.x, byc - rk.y) > radius) continue;
        if (brick.mega) {
          brick.alive = false;
          this.#breakMega(brick);
          continue;
        }
        brick.alive = false;
        brick.hp = 0;
        this.#addScore(25);
        if (brick.drop) this.#dropPill(bxc, byc, brick.drop);
        else if (Math.random() < DROP_CHANCE) this.#dropPill(bxc, byc, this.#randomPower());
      }
      if (this.alien && Math.hypot(this.alien.x - rk.x, this.alien.y - rk.y) <= radius) this.#destroyShip();
      if (this.extraLife && Math.hypot(this.extraLife.x - rk.x, this.extraLife.y - rk.y) <= radius) this.#hitExtraLife();
      this.#blastEnemies(rk.x, rk.y, radius);
      if (this.pacman && Math.hypot(this.pacman.x - rk.x, this.pacman.y - rk.y) <= radius) this.#killPacman();
      this.#checkWin();
    }
    #launchBall(b) {
      b.stuck = false;
      const theta = clamp(this.#launchOffset / AIM_RANGE, -1, 1) * LAUNCH_MAX_ANGLE;
      const speed = BALL_SPEED * this.difficulty.ballSpeedMul;
      b.vx = speed * Math.sin(theta);
      b.vy = -speed * Math.cos(theta);
    }
    #fireGun() {
      if (this.gunAmmo <= 0 || this.#gunCd > 0 || this.balls.length >= this.maxBalls) return;
      this.#gunCd = GUN_COOLDOWN;
      this.gunAmmo--;
      const a = this.aimAngle, level = this.gunLevel;
      if (this.gunAmmo <= 0) {
        this.gunLevel = 0;
        this.aimAngle = GUN_AIM_CENTER;
      }
      const dirs = level >= 2 ? [a, a - GUN_DIAG_SPREAD, a + GUN_DIAG_SPREAD] : [a];
      const split = level >= 3 ? [-GUN_DOUBLE_JITTER, GUN_DOUBLE_JITTER] : [0];
      for (const dir of dirs) {
        for (const j of split) {
          if (!this.#spawnGunBall(clamp(dir + j, GUN_AIM_MIN, GUN_AIM_MAX))) return;
        }
      }
    }
    /** Spawn one coloured ammo ball fired along `ang`. Returns false (and spawns
     *  nothing) once the on-screen ball cap is reached, so a volley stops cleanly. */
    #spawnGunBall(ang) {
      if (this.balls.length >= this.maxBalls) return false;
      const r = BALL_R + 4;
      this.balls.push(this.#newBall(
        this.paddle.x + Math.cos(ang) * r,
        this.paddle.y - 2 + Math.sin(ang) * r,
        Math.cos(ang) * BALL_SPEED,
        Math.sin(ang) * BALL_SPEED
      ));
      return true;
    }
    /** Launch one fireball straight up from the bat muzzle, tier set by hold time.
     *  Stats are snapshotted so a later level-up never retro-buffs this orb. */
    #fireFireball() {
      if (this.laserShots <= 0 || this.#laserCd > 0) return;
      this.#laserCd = LASER_FIRE_CD;
      this.laserShots--;
      const tier = this.#tierFor(this.laserCharge);
      const i = tier - 1;
      const amp = this.amp;
      const bulk = 1 + (amp - 1) * 0.5;
      this.fireballs.push({
        x: this.paddle.x,
        y: this.paddle.y - 10,
        vy: -FIREBALL_SPEED,
        tier,
        dmg: FIREBALL_DMG[i] * amp,
        aoe: FIREBALL_AOE[i] * amp,
        pierce: FIREBALL_PIERCE[i] * amp,
        r: FIREBALL_R[i] * bulk,
        tail: FIREBALL_TAIL[i] * bulk,
        spin: 0,
        hit: /* @__PURE__ */ new Set(),
        t: 0
      });
      this.laserMuzzleFlash = LASER_MUZZLE_FLASH;
      if (this.laserShots === 0) this.laserLevel = 0;
    }
    // ── per-frame update ─────────────────────────────────────
    update(dt) {
      if (this.state !== "playing") return;
      this.#tickPowers(dt);
      this.#movePaddle(dt);
      this.#stepFlippers(dt);
      if (this.#laserCd > 0) this.#laserCd = Math.max(0, this.#laserCd - dt);
      if (this.#gunCd > 0) this.#gunCd = Math.max(0, this.#gunCd - dt);
      for (const b of this.balls) {
        if (b.stuck) {
          b.x = this.aiming ? AIM_ANCHOR : this.paddle.x + this.#launchOffset;
          b.y = this.paddle.y - b.r - 1;
          continue;
        }
        if (this.freezeTimer > 0 && b.primary) continue;
        const weaveV = this.oscillateStacks > 0 ? this.#wobbleAmp() * WOBBLE_FREQ * this.difficulty.oscAggroMul : 0;
        const dist = (Math.hypot(b.vx, b.vy) + weaveV) * dt;
        const steps = Math.max(1, Math.ceil(dist / (b.r * 0.9)));
        const sdt = dt / steps;
        for (let i = 0; i < steps && this.state === "playing"; i++) this.#step(b, sdt);
      }
      this.balls = this.balls.filter((b) => b.y - b.r <= H);
      if (!this.balls.some((b) => b.primary) && this.finaleTimer <= 0) {
        this.#loseLife();
        return;
      }
      this.#stepPillWaves(dt);
      this.#stepCapsules(dt);
      this.#stepFireballs(dt);
      this.#stepTurrets(dt);
      this.#stepPinballProps(dt);
      this.#stepTnt(dt);
      this.#stepRockets(dt);
      this.#stepExplosions(dt);
      this.#stepEnemy(dt);
      this.#stepPacman(dt);
      this.#stepBallChain(dt);
      this.#stepBricks(dt);
      this.#stepAlien(dt);
      this.#stepExtraLife(dt);
      if (this.comboPops.length) {
        for (const p of this.comboPops) p.t += dt;
        this.comboPops = this.comboPops.filter((p) => p.t < COMBO_POP_DUR);
      }
      if (this.milestoneFx) {
        this.milestoneFx.t += dt;
        if (this.milestoneFx.t > 1.1) this.milestoneFx = null;
      }
      if (this.scoreFlash > 0) this.scoreFlash = Math.max(0, this.scoreFlash - dt);
      this.#markFinalBrick();
      if (this.bricksLeft === 0) this.#startFinale();
      if (this.finaleTimer > 0) this.finaleTimer = Math.max(0, this.finaleTimer - dt);
      if (this.pickups.length) {
        for (const p of this.pickups) p.t += dt;
        this.pickups = this.pickups.filter((p) => p.t < PICKUP_DUR);
      }
      this.#checkWin();
    }
    #spawnEnemy() {
      const kind = ENEMY_KINDS[Math.floor(Math.random() * ENEMY_KINDS.length)];
      const e = { x: W * (0.25 + Math.random() * 0.5), y: BRICK_TOP * 0.7, hp: ENEMY_HP_BY_KIND[kind], variant: ENEMY_KINDS.indexOf(kind), kind };
      const sgn = () => Math.random() < 0.5 ? -1 : 1;
      switch (kind) {
        case "bomber":
          e.vx = sgn();
          e.cd = 1.8;
          e.y = BRICK_TOP * 0.8;
          break;
        case "mirror":
          e.cd = 2.2;
          e.y = BRICK_TOP;
          break;
        case "splitter":
          e.vx = sgn() * 60;
          e.vy = sgn() * 42;
          e.split = 0;
          break;
        case "leech":
          e.t = 0;
          e.ax = W / 2;
          e.ay = BRICK_TOP + 60;
          e.eaten = 0;
          break;
        case "orbit":
          e.t = 0;
          e.ax = e.x;
          e.ay = e.y;
          e.cd = 0;
          break;
        case "dart":
          e.phase = "patrol";
          e.vx = sgn() * 70;
          e.vy = 0;
          e.cd = 2.5 + Math.random() * 1.5;
          e.ay = e.y;
          break;
        case "blink":
          e.phase = "idle";
          e.cd = 1.4;
          e.ghostX = e.x;
          e.ghostY = e.y;
          e.flash = 0;
          break;
        case "polarity":
          e.polarity = sgn() < 0 ? "blue" : "red";
          e.cd = 3;
          e.vx = sgn();
          e.flash = 0;
          e.y = BRICK_TOP * 0.9;
          break;
        case "queen":
          e.cd = 4;
          e.brood = [];
          break;
      }
      this.enemies.push(e);
    }
    /** Swarm size cap by level: 1 early, 2 by level ~30, 3 by ~60. Harder = more enemies. */
    #enemyCap() {
      return 1 + (this.levelIndex >= 30 ? 1 : 0) + (this.levelIndex >= 60 ? 1 : 0) + this.difficulty.enemyCapBonus;
    }
    /** Ten enemy kinds, each its own motion + threat. The swarm fills to its level cap —
     *  the first after a long dawdle, refills on a short gap. Per-kind move + contact. */
    #stepEnemy(dt) {
      if (this.freezeTimer > 0) return;
      if (this.enemies.length < this.#enemyCap() && this.bricksLeft > 0) {
        this.#levelClock += dt;
        const delay = (this.enemies.length === 0 ? ENEMY_SPAWN_DELAY : ENEMY_REFILL_GAP) * this.difficulty.enemyRefillMul;
        if (this.#levelClock >= delay) {
          this.#spawnEnemy();
          this.#levelClock = 0;
        }
      }
      for (const e of [...this.enemies]) {
        this.#enemyMove(e, dt);
        this.#enemyContact(e);
      }
    }
    /** Per-kind movement + special (bombs, brood, pill-theft, dive, teleport, flip). */
    #enemyMove(e, dt) {
      const white = this.balls.find((b) => b.primary && !b.stuck);
      if (e.flash && e.flash > 0) e.flash = Math.max(0, e.flash - dt * 3);
      switch (e.kind) {
        case "hunter":
        case "queen": {
          const spd = e.kind === "queen" ? 70 : ENEMY_SPEED;
          if (white) {
            const dx = white.x - e.x, dy = white.y - e.y, d = Math.hypot(dx, dy) || 1;
            e.x += dx / d * spd * dt;
            e.y += dy / d * spd * dt;
          }
          if (e.kind === "queen") {
            e.cd = (e.cd ?? 4) - dt;
            if (e.cd <= 0 && (e.brood?.length ?? 0) < 2) {
              e.cd = 4;
              e.flash = 1;
              (e.brood ??= []).push({ x: e.x, y: e.y + 12, vx: (Math.random() - 0.5) * 130, vy: 120 });
            }
            if (e.brood) {
              for (const m of e.brood) {
                m.x += m.vx * dt;
                m.y += m.vy * dt;
              }
              e.brood = e.brood.filter((m) => m.y <= H + 20 && !this.balls.some((b) => !b.stuck && Math.hypot(b.x - m.x, b.y - m.y) < b.r + 5));
            }
          }
          break;
        }
        case "bomber": {
          e.x += (e.vx ?? 1) * 70 * dt;
          if (e.x < ENEMY_R + 30) {
            e.x = ENEMY_R + 30;
            e.vx = 1;
          } else if (e.x > W - ENEMY_R - 30) {
            e.x = W - ENEMY_R - 30;
            e.vx = -1;
          }
          e.cd = (e.cd ?? 1.8) - dt;
          if (e.cd <= 0) {
            e.cd = 1.8 * this.difficulty.enemyFireMul;
            if (Math.random() < 0.3) this.turretShots.push({ x: e.x, y: e.y + 10, vx: 0, vy: 110, kind: "seeker", t: 0 });
            else {
              const dx = clamp(this.paddle.x - e.x, -160, 160);
              this.turretShots.push({ x: e.x, y: e.y + 10, vx: dx * 0.45, vy: 130, kind: "bomb", t: 0 });
            }
          }
          break;
        }
        case "mirror": {
          e.x += clamp(W - this.paddle.x - e.x, -200 * dt, 200 * dt);
          e.cd = (e.cd ?? 2.2) - dt;
          if (e.cd <= 0) {
            e.cd = 2.2 * this.difficulty.enemyFireMul;
            e.flash = 1;
            this.turretShots.push({ x: e.x, y: e.y + 8, vx: 0, vy: 340, kind: "bolt", t: 0 });
          }
          break;
        }
        case "splitter": {
          e.x += (e.vx ?? 0) * dt;
          e.y += (e.vy ?? 0) * dt;
          if (e.x < ENEMY_R + 20 || e.x > W - ENEMY_R - 20) {
            e.vx = -(e.vx ?? 0);
            e.x = clamp(e.x, ENEMY_R + 20, W - ENEMY_R - 20);
          }
          const lo = BRICK_TOP * 0.4, hi = H * 0.55;
          if (e.y < lo || e.y > hi) {
            e.vy = -(e.vy ?? 0);
            e.y = clamp(e.y, lo, hi);
          }
          break;
        }
        case "leech": {
          e.t = (e.t ?? 0) + dt;
          e.x = clamp((e.ax ?? W / 2) + Math.sin(e.t * 1.2) * 120, ENEMY_R, W - ENEMY_R);
          e.y = clamp((e.ay ?? BRICK_TOP + 60) + Math.sin(e.t * 2.4) * 70, BRICK_TOP * 0.3, H * 0.6);
          for (let i = this.capsules.length - 1; i >= 0; i--) {
            const c = this.capsules[i];
            if ((c.delay ?? 0) > 0) continue;
            if (Math.hypot(c.x - e.x, c.y - e.y) < ENEMY_R + 8) {
              this.capsules.splice(i, 1);
              e.eaten = (e.eaten ?? 0) + 1;
              e.flash = 1;
              break;
            }
          }
          break;
        }
        case "orbit": {
          e.t = (e.t ?? 0) + dt;
          e.cd = (e.cd ?? 0) - dt;
          if (e.cd <= 0) {
            const live = this.bricks.filter((b) => b.alive && !b.seed);
            const pick = live.length ? live[Math.floor(Math.random() * live.length)] : null;
            if (pick) {
              e.ax = pick.x + pick.w / 2;
              e.ay = pick.y + pick.h / 2;
            }
            e.cd = 5;
          }
          e.x = (e.ax ?? e.x) + Math.cos(e.t * 2) * 14;
          e.y = (e.ay ?? e.y) + Math.sin(e.t * 2) * 14;
          break;
        }
        case "dart": {
          if (e.phase === "patrol") {
            e.x += (e.vx ?? 70) * dt;
            if (e.x < ENEMY_R + 24 || e.x > W - ENEMY_R - 24) {
              e.vx = -(e.vx ?? 0);
              e.x = clamp(e.x, ENEMY_R + 24, W - ENEMY_R - 24);
            }
            e.cd = (e.cd ?? 2.5) - dt;
            if (e.cd <= 0) {
              e.phase = "dive";
              e.vy = 260;
              e.vx = clamp((white?.x ?? e.x) - e.x, -180, 180);
            }
          } else if (e.phase === "dive") {
            e.x += (e.vx ?? 0) * dt;
            e.y += (e.vy ?? 0) * dt;
            if (e.y > H * 0.7) {
              e.phase = "retreat";
              e.vy = -200;
            }
          } else {
            e.y += (e.vy ?? -200) * dt;
            if (e.y <= (e.ay ?? BRICK_TOP)) {
              e.y = e.ay ?? BRICK_TOP;
              e.phase = "patrol";
              e.vx = (Math.random() < 0.5 ? -1 : 1) * 70;
              e.cd = 2.5 + Math.random() * 1.5;
            }
          }
          break;
        }
        case "blink": {
          e.cd = (e.cd ?? 1.4) - dt;
          if (e.phase === "idle") {
            if (e.cd <= 0.3 && e.ax === void 0) {
              const bias = white ? 0.6 : 0;
              e.ax = clamp(white ? e.x + (white.x - e.x) * bias : Math.random() * W, ENEMY_R, W - ENEMY_R);
              e.ay = clamp(BRICK_TOP + Math.random() * H * 0.35, BRICK_TOP * 0.3, H * 0.45);
            }
            if (e.cd <= 0) {
              e.phase = "out";
              e.cd = 0.3;
            }
          } else if (e.phase === "out") {
            if (e.cd <= 0) {
              e.ghostX = e.x;
              e.ghostY = e.y;
              e.x = e.ax ?? e.x;
              e.y = e.ay ?? e.y;
              e.ax = void 0;
              e.ay = void 0;
              e.phase = "in";
              e.cd = 0.3;
              e.flash = 1;
              if (white && Math.hypot(white.x - e.x, white.y - e.y) < 44) {
                const dx = white.x - e.x, dy = white.y - e.y, d = Math.hypot(dx, dy) || 1;
                white.vx = dx / d * BALL_SPEED_MAX;
                white.vy = dy / d * BALL_SPEED_MAX;
              }
            }
          } else if (e.cd <= 0) {
            e.phase = "idle";
            e.cd = 1.4;
          }
          break;
        }
        case "polarity": {
          e.x += (e.vx ?? 1) * 55 * dt;
          if (e.x < ENEMY_R + 20 || e.x > W - ENEMY_R - 20) {
            e.vx = -(e.vx ?? 1);
            e.x = clamp(e.x, ENEMY_R + 20, W - ENEMY_R - 20);
            e.y += BRICK_H * 0.5;
          }
          e.cd = (e.cd ?? 3) - dt;
          if (e.cd <= 0) {
            e.cd = 3;
            e.polarity = e.polarity === "blue" ? "red" : "blue";
            e.flash = 1;
          }
          break;
        }
      }
    }
    /** Per-kind contact: melee kinds whack the white ball; the rest bounce it like a
     *  bumper. Polarity is TYPE-GATED (white hurts only RED, colour only BLUE); mirror
     *  denies (bounce, no chip). Colour ammo ricochets + chips; lasers always chip. */
    #enemyContact(e) {
      const melee = e.kind === "hunter" || e.kind === "queen" || e.kind === "dart" && e.phase === "dive";
      for (const b of this.balls) {
        if (b.stuck) continue;
        const dx = b.x - e.x, dy = b.y - e.y, d = Math.hypot(dx, dy);
        if (d > ENEMY_R + b.r) continue;
        const nd = d || 1;
        if (b.primary && melee) {
          b.vx = dx / nd * BALL_SPEED_MAX;
          b.vy = dy / nd * BALL_SPEED_MAX;
          b.x = e.x + dx / nd * (ENEMY_R + b.r + 1);
          b.y = e.y + dy / nd * (ENEMY_R + b.r + 1);
          if (this.#hurtEnemy(e)) return;
          continue;
        }
        const sp = Math.hypot(b.vx, b.vy) || BALL_SPEED;
        b.vx = dx / nd * sp;
        b.vy = dy / nd * sp;
        b.x = e.x + dx / nd * (ENEMY_R + b.r + 1);
        b.y = e.y + dy / nd * (ENEMY_R + b.r + 1);
        if (e.kind === "splitter" && (e.split ?? 0) < 1) e.split = 1;
        let chip = e.kind !== "mirror";
        if (e.kind === "polarity") chip = b.primary ? e.polarity === "red" : e.polarity === "blue";
        if (chip && this.#hurtEnemy(e)) return;
      }
    }
    /** Damage the enemy; returns true once it dies. The Leech coughs up a pill it ate. */
    #hurtEnemy(e) {
      this.#countEnemyHit(e.x, e.y);
      e.hp--;
      this.#addScore(15);
      if (e.hp <= 0) {
        this.#killEnemy(e);
        return true;
      }
      return false;
    }
    /** Remove one enemy from the swarm with its death FX + bounty (the Leech coughs up
     *  a pill it ate). Used by ball/laser kills and by AoE (rocket / ball-chain / TNT). */
    #killEnemy(e) {
      const i = this.enemies.indexOf(e);
      if (i < 0) return;
      this.enemies.splice(i, 1);
      this.explosions.push({ x: e.x, y: e.y, t: 0 });
      if (e.kind === "leech" && (e.eaten ?? 0) > 0) this.capsules.push({ x: e.x, y: e.y, kind: this.#randomPower() });
      this.#levelClock = 0;
      this.#addScore(150);
    }
    /** AoE: kill every enemy within `r` of (x,y). Returns true if any died. */
    #blastEnemies(x, y, r) {
      let any = false;
      for (const e of [...this.enemies]) {
        if (Math.hypot(e.x - x, e.y - y) <= r) {
          this.#countEnemyHit(e.x, e.y);
          this.#killEnemy(e);
          any = true;
        }
      }
      return any;
    }
    /** The pill-wave clock no longer drops pills itself — it just RELOADS the alien's
     *  dispenser (#waveBudget) each wave. Pills are released only by HITTING the alien
     *  (see #destroyShip). Paused while frozen or once the board is cleared. */
    #stepPillWaves(dt) {
      if (this.freezeTimer > 0 || this.bricksLeft === 0) return;
      this.#pillClock += dt;
      if (this.#pillPhase === "quiet") {
        if (this.#pillClock >= this.#pillQuiet) {
          this.#pillPhase = "wave";
          this.#pillClock = 0;
          this.#waveBudget = Math.round(PILLS_PER_WAVE * this.difficulty.mayhemMul);
        }
      } else if (this.#pillClock >= PILL_WAVE) {
        this.#pillPhase = "quiet";
        this.#pillClock = 0;
      }
    }
    /** Seconds of calm between pill waves — shortened by the difficulty's mayhem. */
    get #pillQuiet() {
      return PILL_QUIET / this.difficulty.mayhemMul;
    }
    /** True in the last ~1.2s before a wave opens — the renderer can telegraph it. */
    get pillWaveArming() {
      return this.#pillPhase === "quiet" && this.#pillClock >= this.#pillQuiet - 1.2;
    }
    /** Pac-Man: a comedic ammo-economy rival. Summoned when colour balls linger; it
     *  homes and EATS only colour balls (never the white one), is immune to colour
     *  balls, and is killed by the white ball / weapons. A director-gated hazard. */
    #stepPacman(dt) {
      if (this.freezeTimer > 0) return;
      const colours = this.balls.filter((b) => !b.primary && !b.stuck);
      if (!this.pacman) {
        this.#colorBallTimer = colours.length >= PAC_COLOR_MIN ? this.#colorBallTimer + dt : 0;
        if (this.#colorBallTimer >= PAC_SUMMON_HOLD && this.#hazardFree()) {
          const fromLeft = Math.random() < 0.5;
          this.pacman = { x: fromLeft ? -PAC_R : W + PAC_R, y: H * 0.3, dir: fromLeft ? 1 : -1, hp: PACMAN_HP, mouth: 0, eaten: 0, eatCd: 0, leaving: false };
          this.#activeHazard = "pacman";
          this.#colorBallTimer = 0;
        }
        return;
      }
      const p = this.pacman;
      p.mouth = (p.mouth + dt * 8) % (Math.PI * 2);
      if (p.eatCd > 0) p.eatCd = Math.max(0, p.eatCd - dt);
      if (p.leaving) {
        p.x += p.dir * PACMAN_SPEED * dt;
        if (p.x < -PAC_R * 2 || p.x > W + PAC_R * 2) {
          this.pacman = null;
          this.#endHazard();
        }
        return;
      }
      if (colours.length === 0 || p.eaten >= PAC_EAT_CAP) {
        p.leaving = true;
        p.dir = p.x < W / 2 ? -1 : 1;
        return;
      }
      let aimx = p.x, aimy = p.y, bestT = Infinity;
      for (const b of colours) {
        let t = Math.hypot(b.x - p.x, b.y - p.y) / PACMAN_SPEED;
        let px = b.x, py = b.y;
        for (let k = 0; k < 2; k++) {
          px = b.x + b.vx * t;
          py = b.y + b.vy * t;
          px = clamp(px, 0, W);
          py = clamp(py, 0, H);
          t = Math.hypot(px - p.x, py - p.y) / PACMAN_SPEED;
        }
        if (t < bestT) {
          bestT = t;
          aimx = px;
          aimy = py;
        }
      }
      {
        const dx = aimx - p.x, dy = aimy - p.y, d = Math.hypot(dx, dy) || 1;
        p.x += dx / d * PACMAN_SPEED * dt;
        p.y += dy / d * PACMAN_SPEED * dt;
        p.dir = dx >= 0 ? 1 : -1;
      }
      if (p.eatCd <= 0) {
        for (const b of colours) {
          if (Math.hypot(b.x - p.x, b.y - p.y) <= PAC_R + b.r) {
            this.balls = this.balls.filter((x) => x !== b);
            this.explosions.push({ x: b.x, y: b.y, t: 0 });
            p.eaten++;
            p.eatCd = PAC_EAT_CD;
            break;
          }
        }
      }
      for (const b of this.balls) {
        if (!b.primary || b.stuck) continue;
        const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
        if (d > PAC_R + b.r) continue;
        const nd = d || 1, sp = Math.hypot(b.vx, b.vy) || BALL_SPEED;
        b.vx = dx / nd * sp;
        b.vy = dy / nd * sp;
        b.x = p.x + dx / nd * (PAC_R + b.r + 1);
        b.y = p.y + dy / nd * (PAC_R + b.r + 1);
        this.#hurtPacman(1);
        break;
      }
    }
    /** Chip Pac-Man (white ball / laser / beam). It dies at 0 hp. */
    #hurtPacman(dmg) {
      const p = this.pacman;
      if (!p || p.leaving) return;
      p.hp -= dmg;
      this.#addScore(20);
      if (p.hp <= 0) this.#killPacman();
    }
    /** Pac-Man destroyed: explosion, a combo-strung bounty, and one wave-exempt pill. */
    #killPacman() {
      const p = this.pacman;
      if (!p) return;
      this.explosions.push({ x: p.x, y: p.y, t: 0 });
      this.#bumpCombo(p.x, p.y);
      this.#addScore(250);
      this.#dropPill(p.x, p.y, this.#randomPower());
      this.pacman = null;
      this.#endHazard();
    }
    /** Swing the wrecking ball off the white ball (a driven pendulum), then smash
     *  whatever it sweeps — the hunter, the ship, and falling pills. Smash
     *  CHAIN_BONUS_PILLS pills inside the window for the 100,000 jackpot. */
    #stepBallChain(dt) {
      if (this.ballchainTimer <= 0 || this.freezeTimer > 0) return;
      const p = this.balls.find((b) => b.primary);
      if (!p) return;
      const drive = (p.stuck ? 0 : p.vx) * CHAIN_DRIVE;
      this.#chainAngVel += (-CHAIN_K * Math.sin(this.#chainAngle) - drive) * dt;
      this.#chainAngVel *= 1 - CHAIN_DAMP * dt;
      this.#chainAngle += this.#chainAngVel * dt;
      const cx = p.x + Math.sin(this.#chainAngle) * CHAIN_LEN;
      const cy = p.y + Math.cos(this.#chainAngle) * CHAIN_LEN;
      this.chainBall = { x: cx, y: cy };
      this.#blastEnemies(cx, cy, ENEMY_R + WRECK_R);
      if (this.alien && Math.hypot(this.alien.x - cx, this.alien.y - cy) <= ALIEN_W / 2 + WRECK_R) this.#destroyShip();
      if (this.capsules.length) {
        const keep = [];
        for (const cap of this.capsules) {
          if (Math.hypot(cap.x - cx, cap.y - cy) <= WRECK_R + CAPSULE_W / 2) {
            this.ballchainKills++;
            this.#addScore(200);
            this.explosions.push({ x: cap.x, y: cap.y, t: 0 });
            if (!this.#chainBonusPaid && this.ballchainKills >= CHAIN_BONUS_PILLS) {
              this.#chainBonusPaid = true;
              keep.push({ x: cx, y: Math.max(cy, 70), kind: "crane" });
              for (let i = 0; i < 6; i++) this.explosions.push({ x: cx + Math.cos(i) * 22, y: cy + Math.sin(i) * 22, t: 0 });
            }
          } else keep.push(cap);
        }
        this.capsules = keep;
      }
    }
    #stepRockets(dt) {
      if (!this.rockets.length) return;
      const survive = [];
      for (const rk of this.rockets) {
        rk.y += rk.vy * dt;
        if (rk.y <= 0) {
          this.#detonateRocket(rk);
          continue;
        }
        let hit = false;
        for (const brick of this.bricks) {
          if (!brick.alive) continue;
          if (rk.x >= brick.x && rk.x <= brick.x + brick.w && rk.y - 9 <= brick.y + brick.h && rk.y >= brick.y) {
            hit = true;
            break;
          }
        }
        if (!hit && this.enemies.some((e) => Math.hypot(e.x - rk.x, e.y - rk.y) <= ENEMY_R + 4)) hit = true;
        if (!hit && this.#shipHitAt(rk.x, rk.y)) hit = true;
        if (hit) {
          this.#detonateRocket(rk);
          continue;
        }
        survive.push(rk);
      }
      this.rockets = survive;
    }
    #stepExplosions(dt) {
      if (!this.explosions.length) return;
      const survive = [];
      for (const e of this.explosions) {
        e.t += dt;
        if (e.t < EXPLOSION_DUR) survive.push(e);
      }
      this.explosions = survive;
    }
    #tickPowers(dt) {
      if (this.freezeTimer <= 0) {
        if (this.laserCharging && this.laserShots > 0) this.laserCharge = Math.min(LASER_CHARGE_FULL, this.laserCharge + dt);
        if (this.magnetTimer > 0) this.magnetTimer = Math.max(0, this.magnetTimer - dt);
        if (this.burstTimer > 0) this.burstTimer = Math.max(0, this.burstTimer - dt);
        if (this.pierceTimer > 0) {
          this.pierceTimer = Math.max(0, this.pierceTimer - dt);
          if (this.pierceTimer === 0) for (const b of this.balls) b.pierced = void 0;
        }
        if (this.scrambleTimer > 0) {
          this.scrambleTimer = Math.max(0, this.scrambleTimer - dt);
          if (this.scrambleTimer === 0) this.scrambleLevel = 0;
        }
        if (this.goldTimer > 0) {
          this.goldTimer = Math.max(0, this.goldTimer - dt);
          if (this.goldTimer === 0) this.goldBonus = 0;
        }
        if (this.regenShield && this.shieldHp > 0) {
          this.paddleHp = Math.min(PADDLE_MAX_HP, this.paddleHp + REGEN_RATE * this.amp * dt);
        }
        if (this.expandTimer > 0) {
          this.expandTimer = Math.max(0, this.expandTimer - dt);
          if (this.expandTimer === 0) {
            this.paddle.w = this.#paddleBaseW;
            this.paddle.x = clamp(this.paddle.x, this.paddle.w / 2, W - this.paddle.w / 2);
          }
        }
        if (this.beamShots > 0) {
          this.beamCharge += dt;
          if (this.beamCharge >= this.beamTarget) {
            this.#fireBeam();
            this.beamCharge = 0;
            this.beamTarget = BEAM_CHARGE_MIN + Math.random() * (BEAM_CHARGE_MAX - BEAM_CHARGE_MIN);
          }
        }
        if (this.ballchainTimer > 0) {
          this.ballchainTimer = Math.max(0, this.ballchainTimer - dt);
          if (this.ballchainTimer === 0) this.chainBall = null;
        }
      }
      if (this.beamFlash > 0) this.beamFlash = Math.max(0, this.beamFlash - dt);
      if (this.rushFlash > 0) this.rushFlash = Math.max(0, this.rushFlash - dt);
      if (this.laserMuzzleFlash > 0) this.laserMuzzleFlash = Math.max(0, this.laserMuzzleFlash - dt);
      if (this.shieldFlash > 0) this.shieldFlash = Math.max(0, this.shieldFlash - dt * 3);
      for (const bm of this.bumpers) if (bm.flash > 0) bm.flash = Math.max(0, bm.flash - dt * 5);
      if (this.freezeTimer > 0) this.freezeTimer = Math.max(0, this.freezeTimer - dt);
      else if (this.#hazardCooldown > 0) this.#hazardCooldown = Math.max(0, this.#hazardCooldown - dt);
    }
    /** Release one beam shot: a single laser straight up from the paddle's middle.
     *  Level 1 = 1 damage to the column, level 2 = ×2, level 3 clears the whole line. */
    #fireBeam() {
      if (this.beamShots <= 0) return;
      this.beamShots--;
      const bx = this.paddle.x;
      this.beamX = bx;
      this.beamFlash = BEAM_FLASH;
      const dmg = this.beamLevel >= 3 ? 99 : this.beamLevel * this.amp;
      for (const brick of [...this.bricks]) {
        if (!brick.alive || brick.seed) continue;
        if (bx >= brick.x && bx <= brick.x + brick.w) this.#damage(brick, dmg);
      }
      const a = this.alien;
      if (a && bx >= a.x - ALIEN_W / 2 && bx <= a.x + ALIEN_W / 2) this.#destroyShip();
      if (this.extraLife && Math.abs(this.extraLife.x - bx) <= EXTRALIFE_R + 4) this.#hitExtraLife();
      if (this.pacman && Math.abs(this.pacman.x - bx) <= PAC_R + 4) this.#hurtPacman(this.beamLevel >= 3 ? 99 : this.beamLevel);
      if (this.beamShots === 0) this.beamCharge = 0;
    }
    /** Set the white (primary) ball's radius — doubled in pinball mode, normal otherwise. */
    #setPrimaryRadius(r) {
      for (const b of this.balls) if (b.primary) b.r = r;
    }
    #movePaddle(dt) {
      const half = this.paddle.w / 2;
      if (this.input.left || this.input.right) {
        this.#pointerX = null;
        const dir = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
        this.paddle.x += dir * PADDLE_SPEED * dt;
      } else if (this.#pointerX !== null) {
        this.paddle.x = this.#pointerX;
      }
      const lo = this.aiming ? AIM_ANCHOR - AIM_RANGE : half;
      const hi = this.aiming ? AIM_ANCHOR + AIM_RANGE : W - half;
      this.paddle.x = clamp(this.paddle.x, lo, hi);
      if (this.gunAmmo > 0) {
        this.aimAngle = clamp(this.aimAngle + (this.paddle.x - this.#prevPaddleX) * GUN_SENS, GUN_AIM_MIN, GUN_AIM_MAX);
      }
      this.#prevPaddleX = this.paddle.x;
    }
    /** Current lateral weave amplitude (px): the stacking double-up, clamped to the
     *  cap, then scaled by the active difficulty's oscillate-aggression. */
    #wobbleAmp() {
      return Math.min(WOBBLE_AMP_MAX, WOBBLE_BASE_AMP * Math.pow(2, this.oscillateStacks - 1)) * this.difficulty.oscAggroMul;
    }
    #step(b, dt) {
      if (this.magnetTimer > 0 && b.y < H / 2) this.#applyMagnet(b, dt);
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (this.oscillateStacks > 0) {
        const amp = this.#wobbleAmp();
        const freq = WOBBLE_FREQ * this.difficulty.oscAggroMul;
        const sp2 = Math.hypot(b.vx, b.vy) || 1;
        const px = -b.vy / sp2, py = b.vx / sp2;
        const oldW = amp * Math.sin(b.wobble);
        b.wobble += freq * dt;
        const dW = amp * Math.sin(b.wobble) - oldW;
        b.x += px * dW;
        b.y += py * dW;
      }
      if (b.x - b.r < 0) {
        b.x = b.r;
        b.vx = Math.abs(b.vx);
      } else if (b.x + b.r > W) {
        b.x = W - b.r;
        b.vx = -Math.abs(b.vx);
      }
      if (b.y - b.r < 0) {
        b.y = b.r;
        b.vy = Math.abs(b.vy);
      }
      if (this.bumpers.length) this.#bumperBounce(b);
      if (this.pinballProps.length) this.#pinballPropBounce(b, dt);
      if (this.tnt) this.#tntBounce(b);
      if (this.alien) this.#alienBounce(b);
      if (this.extraLife) this.#extraLifeBounce(b);
      if (this.pinball) this.#flipperBounce(b);
      else this.#paddleBounce(b);
      this.#brickHits(b);
      const floor = BALL_SPEED_MIN;
      let sp = Math.hypot(b.vx, b.vy);
      if (sp > 0 && sp < floor) {
        const k = floor / sp;
        b.vx *= k;
        b.vy *= k;
        sp = floor;
      }
      if (sp > 0) {
        const minVy = sp * MIN_VY_RATIO;
        if (Math.abs(b.vy) < minVy) {
          b.vy = (b.vy === 0 ? 1 : Math.sign(b.vy)) * minVy;
          b.vx = Math.sign(b.vx || 1) * Math.sqrt(Math.max(0, sp * sp - b.vy * b.vy));
        }
      }
    }
    /** "Gravity" toward the paddle (the caller only runs this while the ball is in
     *  the top half). Accelerates the ball toward the bat, capped at the max ball
     *  speed so it curves home without running away. Not a sticky catch. */
    #applyMagnet(b, dt) {
      const dx = this.paddle.x - b.x;
      const dy = this.paddle.y - b.y;
      const d = Math.hypot(dx, dy) || 1;
      const g = MAGNET_G * this.amp;
      b.vx += dx / d * g * dt;
      b.vy += dy / d * g * dt;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > BALL_SPEED_MAX) {
        b.vx = b.vx / sp * BALL_SPEED_MAX;
        b.vy = b.vy / sp * BALL_SPEED_MAX;
      }
    }
    #paddleBounce(b) {
      const p = this.paddle;
      if (b.vy <= 0) return;
      if (b.y + b.r < p.y || b.y - b.r > p.y + p.h) return;
      if (b.x < p.x - p.w / 2 - b.r || b.x > p.x + p.w / 2 + b.r) return;
      const off = clamp((b.x - p.x) / (p.w / 2), -1, 1);
      const speed = Math.min(BALL_SPEED_MAX, Math.hypot(b.vx, b.vy) * BALL_SPEEDUP);
      const angle = off * (Math.PI / 3);
      b.vx = speed * Math.sin(angle);
      b.vy = -speed * Math.abs(Math.cos(angle));
      b.y = p.y - b.r - 0.5;
      this.combo = 0;
    }
    #brickHits(b) {
      const pierce = this.pierceTimer > 0 && b.primary;
      if (pierce) {
        if (b.pierced) for (const br of b.pierced) {
          const px = clamp(b.x, br.x, br.x + br.w), py = clamp(b.y, br.y, br.y + br.h);
          if (!br.alive || (b.x - px) ** 2 + (b.y - py) ** 2 > b.r * b.r) b.pierced.delete(br);
        }
        for (const brick of [...this.bricks]) {
          if (!brick.alive) continue;
          const cx = clamp(b.x, brick.x, brick.x + brick.w), cy = clamp(b.y, brick.y, brick.y + brick.h);
          if ((b.x - cx) ** 2 + (b.y - cy) ** 2 > b.r * b.r) continue;
          if (b.pierced?.has(brick)) continue;
          (b.pierced ??= /* @__PURE__ */ new Set()).add(brick);
          this.#damage(brick, 1);
        }
        return;
      }
      for (const brick of this.bricks) {
        if (!brick.alive) continue;
        const cx = clamp(b.x, brick.x, brick.x + brick.w);
        const cy = clamp(b.y, brick.y, brick.y + brick.h);
        const dx = b.x - cx, dy = b.y - cy;
        if (dx * dx + dy * dy > b.r * b.r) continue;
        const overlapX = b.r - Math.abs(dx);
        const overlapY = b.r - Math.abs(dy);
        if (overlapX < overlapY) {
          b.vx = dx >= 0 ? Math.abs(b.vx) : -Math.abs(b.vx);
          b.x += dx >= 0 ? overlapX : -overlapX;
        } else {
          b.vy = dy >= 0 ? Math.abs(b.vy) : -Math.abs(b.vy);
          b.y += dy >= 0 ? overlapY : -overlapY;
        }
        this.#damage(brick, this.pinball && b.primary ? PINBALL_DAMAGE : 1);
        return;
      }
    }
    /** POINTS axis (skill): the combo chain + the unified gold bonus, capped. A getter
     *  so it can never desync from combo/gold. The ceiling amps, so an amped gold pill
     *  is not handed back a bonus the cap immediately clips off. */
    get pointsMul() {
      return Math.min(POINTS_CAP * this.amp, 1 + Math.min(this.combo, 25) * 0.2 + this.goldBonus);
    }
    /** Add points through the two-axis multiplier — POINTS × × PILLS × (capped at
     *  TOTAL_CAP) with the oscillator's booster riding on top. Both the cap and the
     *  booster scale with the AMP; at amp 1 this is byte-for-byte the old ×1 / ×1.6. */
    #addScore(n) {
      const amp = this.amp;
      const boost = 1 + OSC_SCORE_PER_AMP * (amp - 1);
      const total = Math.min(TOTAL_CAP * amp, this.pointsMul * this.pillMul) * boost;
      this.score += Math.round(n * total);
    }
    #damage(brick, dmg = 1) {
      if (brick.seed) return;
      if (this.burstTimer > 0) brick.hp = Math.min(brick.hp, dmg);
      brick.hp -= dmg;
      this.#addScore(5);
      if (brick.hp > 0) return;
      brick.alive = false;
      const cm = this.#bumpCombo(brick.x + brick.w / 2, brick.y + brick.h / 2);
      if (brick.mega) {
        this.#breakMega(brick);
        return;
      }
      const before = this.score;
      this.#addScore(20);
      this.comboPops.push({ x: brick.x + brick.w / 2, y: brick.y + brick.h / 2 - 14, n: cm, pts: this.score - before, t: 0 });
      if (brick.mult) this.#grantMultTile(brick);
      if (brick.drop) {
        this.#dropPill(brick.x + brick.w / 2, brick.y + brick.h / 2, brick.drop);
      } else if (Math.random() < DROP_CHANCE) {
        this.#dropPill(brick.x + brick.w / 2, brick.y + brick.h / 2, this.#randomPower());
      }
    }
    /** Weighted pick — staples common, rares seldom (see POWER_WEIGHTS). The clock is
     *  excluded unless a colour ball is on screen (it only freezes things while colour
     *  balls keep clearing — releasing it otherwise would be a dead pill). */
    /** A dispenser pill: a rare 1-UP when you're below max lives, else a random power. */
    #dispensePower() {
      if (this.lives < this.maxLives && Math.random() < EXTRALIFE_PILL_CHANCE) return "extralife";
      return this.#randomPower();
    }
    #randomPower() {
      const colourUp = this.balls.some((b) => !b.primary && !b.stuck);
      const allow = (k) => k !== "clock" || colourUp;
      const hurt = 1 - clamp(this.paddleHp / PADDLE_MAX_HP, 0, 1);
      const need = 1 + 1.6 * hurt + (this.lives <= 1 ? 0.8 : 0);
      const defBoost = this.difficulty.supportMul * need;
      const wt = (k) => POWER_WEIGHTS[k] * (DEFENSIVE.has(k) ? defBoost : 1);
      let total = 0;
      for (const k of POWER_ORDER) if (allow(k)) total += wt(k);
      let r = Math.random() * total;
      for (const k of POWER_ORDER) {
        if (!allow(k)) continue;
        r -= wt(k);
        if (r < 0) return k;
      }
      return POWER_ORDER[0];
    }
    /** Raise the combo chain by one and flag a floating ×N at (x,y); milestones earn
     *  a reward. The combo IS the score multiplier — shared by brick kills, the bonus
     *  ship, and enemy hits, so every chained kill (not just bricks) strings together. */
    #bumpCombo(x, y) {
      this.combo++;
      const cm = this.combo;
      if (cm >= COMBO_MIN) {
        this.comboPops.push({ x, y, n: cm, t: 0 });
        if (cm % COMBO_MILESTONE === 0) this.#comboReward(cm);
      }
      return cm;
    }
    /** Breaking a ×N multiplier tile ADDS to the unified gold bonus (same pool + window
     *  as the gold pill and pinball disc — no more replace-vs-stack), pays a bonus, pops
     *  a big ×N. The hidden ×5 simply adds more toward the cap. */
    #grantMultTile(brick) {
      const n = brick.mult ?? 1;
      this.goldBonus = Math.min(GOLD_BONUS_CAP, this.goldBonus + n * 0.4);
      this.goldTimer = Math.min(GOLD_WINDOW * 4, this.goldTimer + GOLD_WINDOW);
      this.#addScore(n * 50);
      this.comboPops.push({ x: brick.x + brick.w / 2, y: brick.y + brick.h / 2, n, t: 0 });
    }
    /** Combo milestone (×5, ×10, …): a fat score bonus, +1 life at ×15, and a CELEBRATION
     *  — an escalating tier-coloured burst plus a stream of the bonus points raining up
     *  into the score counter. (No free pill — pills only fall from the alien when hit.) */
    #comboReward(n) {
      const before = this.score;
      this.#addScore(n * 30);
      const reward = this.score - before;
      const gotLife = n % 15 === 0 && this.lives < this.maxLives;
      if (gotLife) this.lives = Math.min(this.maxLives, this.lives + this.amp);
      this.milestoneFx = { n, t: 0, life: gotLife };
      this.scoreFlash = 0.45;
      this.explosions.push({ x: W / 2, y: H * 0.42, t: 0 });
      this.comboPops.push({ x: W / 2, y: H * 0.42, n, t: 0 });
      const beads = Math.min(n, 12), share = Math.max(1, Math.round(reward / beads));
      for (let i = 0; i < beads; i++) {
        this.comboPops.push({ x: W / 2 + (Math.random() - 0.5) * 64, y: H * 0.4, n: 0, pts: share, t: -i * 0.05 });
      }
    }
    /** Spawn a falling pill — enforces the on-screen cap (≤ MAX_CAPSULES) and gives it
     *  a brief hover (PILL_STAGGER) before it starts to fall. Returns false at the cap. */
    #dropPill(x, y, kind) {
      if (this.capsules.length >= MAX_CAPSULES) return false;
      this.capsules.push({ x, y, kind, delay: PILL_STAGGER });
      return true;
    }
    #stepCapsules(dt) {
      if (!this.capsules.length) return;
      const p = this.paddle;
      const survive = [];
      for (const cap of this.capsules) {
        if (cap.delay && cap.delay > 0) {
          cap.delay -= dt;
          survive.push(cap);
          continue;
        }
        if (this.invaderPills) {
          cap.dir ??= cap.x < W / 2 ? 1 : -1;
          cap.x += INVADER_MARCH * cap.dir * dt;
          if (cap.x < CAPSULE_W) {
            cap.x = CAPSULE_W;
            cap.dir = 1;
            cap.y += INVADER_STEP;
          } else if (cap.x > W - CAPSULE_W) {
            cap.x = W - CAPSULE_W;
            cap.dir = -1;
            cap.y += INVADER_STEP;
          }
          cap.y += INVADER_FALL * dt;
        } else {
          cap.y += CAPSULE_SPEED * dt;
        }
        if (cap.y - CAPSULE_H / 2 > H) continue;
        const caught = this.pinball ? this.balls.some((b) => !b.stuck && Math.abs(b.x - cap.x) <= CAPSULE_W / 2 + b.r && Math.abs(b.y - cap.y) <= CAPSULE_H / 2 + b.r) : cap.y + CAPSULE_H / 2 >= p.y - 2 && cap.y - CAPSULE_H / 2 <= p.y + p.h + 2 && cap.x >= p.x - p.w / 2 - CAPSULE_W / 2 && cap.x <= p.x + p.w / 2 + CAPSULE_W / 2;
        if (caught) {
          this.#applyPower(cap.kind);
          this.pillMul = Math.min(PILLS_CAP, this.pillMul + 0.1);
          this.#addScore(100);
          this.pickups.push({ x: cap.x, y: cap.y, kind: cap.kind, t: 0 });
        } else survive.push(cap);
      }
      this.capsules = survive;
    }
    /** Advance every fireball up the screen. Each PIERCES bricks (chipping each once
     *  via fb.hit), carves a small AoE at every pierce, damages enemies it passes, and
     *  detonates a bigger plasma burst on its last pierce or at the ceiling. */
    #stepFireballs(dt) {
      if (!this.fireballs.length) return;
      const survive = [];
      outer: for (const fb of this.fireballs) {
        fb.t += dt;
        fb.spin += dt * 16;
        const steps = Math.max(1, Math.ceil(FIREBALL_SPEED * dt / Math.max(4, fb.r)));
        const sdt = dt / steps;
        for (let s = 0; s < steps; s++) {
          fb.y += fb.vy * sdt;
          if (fb.y < 0) {
            this.#detonateFireball(fb);
            continue outer;
          }
          if (this.#shipHitAt(fb.x, fb.y)) {
            this.#destroyShip();
            this.#detonateFireball(fb);
            continue outer;
          }
          if (this.extraLife && Math.hypot(this.extraLife.x - fb.x, this.extraLife.y - fb.y) <= EXTRALIFE_R) {
            this.#hitExtraLife();
            this.#detonateFireball(fb);
            continue outer;
          }
          if (this.pacman && Math.hypot(this.pacman.x - fb.x, this.pacman.y - fb.y) <= PAC_R) {
            this.#hurtPacman(fb.dmg);
            this.#detonateFireball(fb);
            continue outer;
          }
          for (const e of [...this.enemies]) {
            if (!fb.hit.has(e) && Math.hypot(e.x - fb.x, e.y - fb.y) <= ENEMY_R + fb.r) {
              fb.hit.add(e);
              this.#hurtEnemy(e);
            }
          }
          let hit = null, lowest = -Infinity;
          for (const brick of this.bricks) {
            if (!brick.alive || brick.seed || fb.hit.has(brick)) continue;
            if (fb.x >= brick.x && fb.x <= brick.x + brick.w && fb.y >= brick.y && fb.y <= brick.y + brick.h) {
              if (brick.y > lowest) {
                lowest = brick.y;
                hit = brick;
              }
            }
          }
          if (hit) {
            fb.hit.add(hit);
            this.#damage(hit, fb.dmg);
            this.#fireballSplash(fb.x, fb.y, fb.aoe);
            if (fb.hit.size >= fb.pierce) {
              this.#detonateFireball(fb);
              continue outer;
            }
          }
        }
        survive.push(fb);
      }
      this.fireballs = survive;
    }
    /** A light AoE at each pierce point — chips neighbours (1 dmg) so the orb carves a
     *  channel, and clears any swarm in radius. The punch is the core pierce dmg. */
    #fireballSplash(x, y, r) {
      for (const brick of [...this.bricks]) {
        if (!brick.alive || brick.seed) continue;
        const bxc = brick.x + brick.w / 2, byc = brick.y + brick.h / 2;
        if (Math.hypot(bxc - x, byc - y) > r) continue;
        if (brick.mega) {
          brick.alive = false;
          this.#breakMega(brick);
          continue;
        }
        this.#damage(brick, 1);
      }
      this.#blastEnemies(x, y, r);
    }
    /** The fireball's terminal burst — a plasma shock-ring + a full-strength splash. */
    #detonateFireball(fb) {
      this.explosions.push({ x: fb.x, y: fb.y, t: 0, hue: "plasma" });
      this.#fireballSplash(fb.x, fb.y, fb.aoe * 1.4);
      this.#checkWin();
    }
    #applyPower(kind) {
      const amp = this.amp;
      switch (kind) {
        case "oscillate":
          this.oscillateStacks++;
          this.#paddleBaseW = Math.min(W * 0.6, this.#paddleBaseW * 1.25);
          if (this.expandTimer <= 0) this.paddle.w = this.#paddleBaseW;
          this.paddle.x = clamp(this.paddle.x, this.paddle.w / 2, W - this.paddle.w / 2);
          {
            const speedup = 1 + (OSC_SPEEDUP - 1) * this.difficulty.oscAggroMul;
            for (const b of this.balls) {
              if (b.stuck) continue;
              const sp = Math.hypot(b.vx, b.vy) || 1;
              const ns = Math.min(BALL_SPEED_MAX, sp * speedup);
              b.vx = b.vx / sp * ns;
              b.vy = b.vy / sp * ns;
            }
          }
          break;
        case "break": {
          const add = [];
          const cap = this.maxBalls;
          const n = 2 * amp;
          for (const b of this.balls) {
            if (this.balls.length + add.length >= cap) break;
            const speed = Math.hypot(b.vx, b.vy) || BALL_SPEED;
            const ang = b.stuck ? -Math.PI / 2 : Math.atan2(b.vy, b.vx);
            if (b.stuck) {
              b.stuck = false;
              b.vx = speed * Math.cos(ang);
              b.vy = speed * Math.sin(ang);
            }
            for (let i = 0; i < n; i++) {
              if (this.balls.length + add.length >= cap) break;
              const d = -BREAK_FAN + 2 * BREAK_FAN * (i + 0.5) / n;
              const nb = this.#newBall(b.x, b.y, speed * Math.cos(ang + d), speed * Math.sin(ang + d), false, b.primary);
              nb.r = b.r;
              add.push(nb);
            }
          }
          this.balls.push(...add);
          break;
        }
        case "laser":
          this.laserLevel = this.laserShots > 0 ? Math.min(LASER_MAX_LEVEL, this.laserLevel + 1) : 1;
          this.#laserLoader = LASER_LOADER * amp;
          this.laserShots = this.#laserLoader;
          this.laserCharge = 0;
          this.laserCharging = false;
          break;
        case "expand":
          this.paddle.w = Math.min(W * 0.9, Math.max(PADDLE_EXPAND_W, this.#paddleBaseW * (1 + 0.3 * amp)));
          this.expandTimer = Math.min(EXPAND_DURATION * 4 * amp, this.expandTimer + EXPAND_DURATION * amp);
          this.paddle.x = clamp(this.paddle.x, this.paddle.w / 2, W - this.paddle.w / 2);
          break;
        case "gun":
          this.gunLevel = this.gunAmmo > 0 ? Math.min(GUN_MAX_LEVEL, this.gunLevel + 1) : 1;
          this.#gunLoader = GUN_LOADER * amp;
          this.gunAmmo = this.#gunLoader;
          this.aimAngle = GUN_AIM_CENTER;
          this.#prevPaddleX = this.paddle.x;
          break;
        case "magnet":
          this.magnetTimer = Math.min(MAGNET_DURATION * 4 * amp, this.magnetTimer + MAGNET_DURATION * amp);
          break;
        case "rocket":
          this.#rocketMax = ROCKET_MAX * amp;
          this.rocketAmmo = Math.min(this.#rocketMax, this.rocketAmmo + ROCKET_LOADER * amp);
          break;
        case "multiplier":
          this.goldBonus = Math.min(GOLD_BONUS_CAP * amp, this.goldBonus + 0.5 * amp);
          this.goldTimer = Math.min(GOLD_WINDOW * 4 * amp, this.goldTimer + GOLD_WINDOW * amp);
          break;
        case "burst":
          this.burstTimer = Math.min(BURST_DURATION * 4 * amp, this.burstTimer + BURST_DURATION * amp);
          break;
        case "pierce":
          this.pierceTimer = Math.min(PIERCE_DURATION * 4 * amp, this.pierceTimer + PIERCE_DURATION * amp);
          break;
        case "scramble":
          this.scrambleLevel = this.scrambleTimer > 0 ? Math.min(SCRAMBLE_DURS.length - 1, this.scrambleLevel + 1) : 0;
          this.#scrambleDur = SCRAMBLE_DURS[this.scrambleLevel] * amp;
          this.scrambleTimer = this.#scrambleDur;
          break;
        case "heal":
          this.paddleHp = Math.min(PADDLE_MAX_HP, this.paddleHp + HEAL_AMOUNT * amp);
          break;
        case "shield":
          this.#shieldMax = SHIELD_MAX_HP * amp;
          this.shieldHp = this.#shieldMax;
          break;
        case "regen":
          this.#shieldMax = SHIELD_MAX_HP * amp;
          this.shieldHp = this.#shieldMax;
          this.regenShield = true;
          break;
        case "pinball":
          this.pinball = true;
          this.#spawnBumpers();
          this.#spawnPinballProps();
          this.#setPrimaryRadius(BALL_R * 2);
          break;
        case "beam":
          this.beamLevel = this.beamShots > 0 ? Math.min(BEAM_MAX_LEVEL, this.beamLevel + 1) : 1;
          this.#beamLoader = BEAM_LOADER * amp;
          this.beamShots = this.#beamLoader;
          this.beamCharge = 0;
          this.beamTarget = BEAM_CHARGE_MIN + Math.random() * (BEAM_CHARGE_MAX - BEAM_CHARGE_MIN);
          break;
        case "clock":
          if (this.balls.some((b) => !b.primary)) {
            this.#clockDur = CLOCK_DURATION * amp;
            this.freezeTimer = this.#clockDur;
          }
          break;
        case "ballchain": {
          this.#ballchainDur = BALLCHAIN_DURATION * amp;
          this.ballchainTimer = this.#ballchainDur;
          this.ballchainKills = 0;
          this.#chainBonusPaid = false;
          this.#chainAngle = 0;
          this.#chainAngVel = 0;
          const p = this.balls.find((b) => b.primary) ?? this.balls[0];
          this.chainBall = p ? { x: p.x, y: p.y + CHAIN_LEN } : { x: W / 2, y: H / 2 };
          break;
        }
        case "extralife":
          this.lives = Math.min(this.maxLives, this.lives + amp);
          break;
        // The crane is deliberately NOT amped here: its jackpot is paid through
        // #addScore, which already carries the oscillator's score booster. Amping the
        // payout too would compound the same multiplier twice.
        case "crane": {
          this.#addScore(CHAIN_BONUS);
          this.comboPops.push({ x: this.paddle.x, y: this.paddle.y - 26, n: 0, pts: CHAIN_BONUS, t: 0 });
          for (let i = 0; i < 10; i++) this.explosions.push({ x: this.paddle.x + Math.cos(i) * 26, y: this.paddle.y - 20 + Math.sin(i) * 16, t: 0 });
          break;
        }
      }
    }
    /** Two field bumpers in the open "non-tile" zone below the bricks. */
    #spawnBumpers() {
      this.bumpers = [
        { x: W * 0.3, y: BUMPER_Y, r: BUMPER_R, flash: 0 },
        { x: W * 0.7, y: BUMPER_Y, r: BUMPER_R, flash: 0 }
      ];
    }
    /** Left / right mouse buttons flick the flippers (pinball mode only). */
    flipLeft(down) {
      this.#flipLDown = down;
    }
    flipRight(down) {
      this.#flipRDown = down;
    }
    /** Animate each flipper toward its target (up while its button is held). */
    #stepFlippers(dt) {
      const step = FLIP_RAISE_SPEED * dt;
      const approach = (cur, target) => target > cur ? Math.min(target, cur + step) : Math.max(target, cur - step);
      const pl = this.flipLeftRaise, pr = this.flipRightRaise;
      this.flipLeftRaise = approach(this.flipLeftRaise, this.#flipLDown ? 1 : 0);
      this.flipRightRaise = approach(this.flipRightRaise, this.#flipRDown ? 1 : 0);
      this.#flipLVel = this.flipLeftRaise - pl;
      this.#flipRVel = this.flipRightRaise - pr;
    }
    /** The flipper assembly is BOLTED to the middle of the table — a real machine's
     *  flippers don't slide. (They used to track the bat's x, which turned the whole
     *  assembly into a moving platform.) Click L/R to flip; that's the only control. */
    get flipperCenterX() {
      return W / 2;
    }
    /** The two flippers as segments: pivot (px,py) → tip at the lerped angle. The
     *  right flipper mirrors the left about the table's fixed centre. */
    #flippers() {
      const fy = PADDLE_Y + FLIP_Y_OFF;
      const cxp = this.flipperCenterX;
      const la = FLIP_REST + (FLIP_UP - FLIP_REST) * this.flipLeftRaise;
      const ra = Math.PI - FLIP_REST + (Math.PI - FLIP_UP - (Math.PI - FLIP_REST)) * this.flipRightRaise;
      return [
        { px: cxp - FLIP_PIVOT_DX, py: fy, ang: la, vel: this.#flipLVel },
        { px: cxp + FLIP_PIVOT_DX, py: fy, ang: ra, vel: this.#flipRVel }
      ];
    }
    /** Bounce the ball off the flippers (pinball mode). An actively-rising flipper
     *  launches the ball back up into play; a resting one is a passive wall. The
     *  central gap between the resting tips is the drain. */
    #flipperBounce(b) {
      for (const f of this.#flippers()) {
        const tx = f.px + Math.cos(f.ang) * FLIP_LEN, ty = f.py + Math.sin(f.ang) * FLIP_LEN;
        const ex = tx - f.px, ey = ty - f.py;
        const t = clamp(((b.x - f.px) * ex + (b.y - f.py) * ey) / (ex * ex + ey * ey || 1), 0, 1);
        const cx = f.px + ex * t, cy = f.py + ey * t;
        let nx = b.x - cx, ny = b.y - cy;
        const d = Math.hypot(nx, ny) || 1;
        if (d > b.r + FLIP_THICK) continue;
        nx /= d;
        ny /= d;
        b.x = cx + nx * (b.r + FLIP_THICK);
        b.y = cy + ny * (b.r + FLIP_THICK);
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) {
          b.vx -= 2 * vn * nx;
          b.vy -= 2 * vn * ny;
        }
        if (f.vel > 1e-3) {
          const sweet = t;
          const cur = Math.hypot(b.vx, b.vy) || BALL_SPEED;
          const launch = Math.min(BALL_SPEED_MAX, Math.max(PINBALL_LAUNCH, cur) * (1.2 + 0.7 * sweet));
          const horiz = -Math.sign(b.x - W / 2) * launch * 0.4;
          b.vx = horiz;
          b.vy = -Math.sqrt(Math.max(0, launch * launch - horiz * horiz));
        } else {
          const s = Math.hypot(b.vx, b.vy) || 1;
          const ns = clamp(s, BALL_SPEED, BALL_SPEED_MAX);
          b.vx = b.vx / s * ns;
          b.vy = b.vy / s * ns;
        }
        return;
      }
    }
    /** Pinball bumper: push the ball out, reflect it, and add a speed kick. */
    #bumperBounce(b) {
      for (const bm of this.bumpers) {
        const dx = b.x - bm.x, dy = b.y - bm.y;
        const d = Math.hypot(dx, dy);
        const rr = bm.r + b.r;
        if (d >= rr || d === 0) continue;
        const nx = dx / d, ny = dy / d;
        b.x = bm.x + nx * rr;
        b.y = bm.y + ny * rr;
        const vdot = b.vx * nx + b.vy * ny;
        if (vdot < 0) {
          b.vx -= 2 * vdot * nx;
          b.vy -= 2 * vdot * ny;
        }
        const cur = Math.hypot(b.vx, b.vy) || 1;
        const sp = Math.min(BALL_SPEED_MAX, cur * 2);
        b.vx = b.vx / cur * sp;
        b.vy = b.vy / cur * sp;
        bm.flash = 1;
        this.#addScore(10);
        this.#toggleTurret();
      }
    }
    /** Drop a random handful of pinball props into the open zone below the bricks. */
    #spawnPinballProps() {
      const pool = Object.keys(PINBALL_SHAPE).slice();
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const n = (PINBALL_PROPS_MIN + Math.floor(Math.random() * (PINBALL_PROPS_MAX - PINBALL_PROPS_MIN + 1))) * this.amp;
      const props = [];
      const place = (kind, x, y) => {
        const sh = PINBALL_SHAPE[kind];
        const r = sh === "field" ? 34 : sh === "bar" ? 26 : sh === "target" ? 16 : 15;
        const hp = kind === "bank" ? 3 : kind === "drop" || kind === "extraball" ? 1 : 0;
        const p = { kind, x: clamp(x, 60, W - 60), y, r, hp, flash: 0, spin: 0, lit: kind === "jackpot", cd: 0, partner: -1 };
        props.push(p);
        return p;
      };
      const ys = [H * 0.4, H * 0.5, H * 0.6];
      let slot = 0;
      for (const kind of pool.slice(0, n)) {
        const x = 80 + slot % 3 * (W - 160) / 2 + (Math.random() - 0.5) * 28;
        const y = ys[Math.floor(slot / 3) % ys.length] + (Math.random() - 0.5) * 18;
        const p = place(kind, x, y);
        if (kind === "teleport") {
          const q = place("teleport", W - x, y + 36);
          p.partner = props.indexOf(q);
          q.partner = props.indexOf(p);
        }
        slot++;
      }
      this.pinballProps = props;
    }
    /** Per-frame prop upkeep: flash/cooldown decay + jackpot relight. */
    #stepPinballProps(dt) {
      for (const p of this.pinballProps) {
        if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 3);
        if (p.cd > 0) p.cd = Math.max(0, p.cd - dt);
        if (p.kind === "jackpot" && !p.lit && p.cd <= 0) p.lit = true;
      }
    }
    /** Collide one ball with every pinball prop, by shape. */
    #pinballPropBounce(b, dt) {
      for (const p of this.pinballProps) {
        const sh = PINBALL_SHAPE[p.kind];
        if (sh === "disc") this.#discProp(b, p);
        else if (sh === "target") this.#targetProp(b, p);
        else if (sh === "sling") this.#slingProp(b, p);
        else if (sh === "field") this.#fieldProp(b, p, dt);
        else this.#barProp(b, p);
      }
    }
    #discProp(b, p) {
      const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy), rr = p.r + b.r;
      if (d >= rr || d === 0) return;
      const nx = dx / d, ny = dy / d;
      const pass = p.kind === "tunnel" || p.kind === "teleport";
      if (!pass) {
        b.x = p.x + nx * rr;
        b.y = p.y + ny * rr;
        const vdot = b.vx * nx + b.vy * ny;
        if (vdot < 0) {
          b.vx -= 2 * vdot * nx;
          b.vy -= 2 * vdot * ny;
        }
      }
      const mul = p.kind === "jet" ? 2 : p.kind === "pop" ? 1.35 : p.kind === "tunnel" ? 1.6 : p.kind === "orbit" ? 1.2 : 1;
      if (mul !== 1) {
        const cur = Math.hypot(b.vx, b.vy) || 1;
        const sp = Math.min(BALL_SPEED_MAX, cur * mul);
        b.vx = b.vx / cur * sp;
        b.vy = b.vy / cur * sp;
      }
      if (p.cd > 0) return;
      p.flash = 1;
      p.cd = 0.12;
      switch (p.kind) {
        case "jet":
          this.#addScore(50);
          break;
        case "pop":
          this.#addScore(30);
          break;
        case "mushroom":
          this.#addScore(20);
          break;
        case "orbit":
          this.#addScore(40);
          break;
        case "tunnel":
          this.#addScore(15);
          break;
        case "jackpot":
          if (p.lit) {
            this.#addScore(1e3);
            p.lit = false;
            p.cd = 6;
            this.explosions.push({ x: p.x, y: p.y, t: 0 });
          } else this.#addScore(20);
          break;
        case "multiplier":
          this.goldBonus = Math.min(GOLD_BONUS_CAP, this.goldBonus + 0.5);
          this.goldTimer = Math.min(GOLD_WINDOW * 4, this.goldTimer + GOLD_WINDOW);
          p.cd = 2;
          this.#addScore(10);
          break;
        case "teleport": {
          const q = this.pinballProps[p.partner];
          if (q) {
            b.x = q.x;
            b.y = q.y + q.r + b.r + 2;
            q.cd = p.cd = 0.5;
            q.flash = 1;
          }
          this.#addScore(25);
          break;
        }
        case "extraball":
          if (p.hp > 0 && this.balls.length < MAX_BALLS) {
            p.hp = 0;
            this.balls.push(this.#newBall(p.x, p.y + p.r + b.r + 2, (Math.random() < 0.5 ? -1 : 1) * BALL_SPEED * 0.5, BALL_SPEED * 0.7, false, false));
            this.#addScore(50);
          }
          break;
      }
    }
    #targetProp(b, p) {
      if ((p.kind === "drop" || p.kind === "bank") && p.hp <= 0) return;
      const hw = p.r, hh = 7;
      const cx = clamp(b.x, p.x - hw, p.x + hw), cy = clamp(b.y, p.y - hh, p.y + hh);
      const dx = b.x - cx, dy = b.y - cy;
      if (dx * dx + dy * dy > b.r * b.r) return;
      const ox = b.r - Math.abs(dx), oy = b.r - Math.abs(dy);
      if (ox < oy) {
        b.vx = dx >= 0 ? Math.abs(b.vx) : -Math.abs(b.vx);
        b.x += dx >= 0 ? ox : -ox;
      } else {
        b.vy = dy >= 0 ? Math.abs(b.vy) : -Math.abs(b.vy);
        b.y += dy >= 0 ? oy : -oy;
      }
      if (p.cd > 0) return;
      p.flash = 1;
      p.cd = 0.12;
      if (p.kind === "drop") {
        p.hp = 0;
        this.#addScore(100);
      } else if (p.kind === "bank") {
        p.hp--;
        this.#addScore(60);
      } else this.#addScore(40);
    }
    #slingProp(b, p) {
      const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy), rr = p.r + b.r;
      if (d >= rr || d === 0) return;
      const dir = p.kind === "slingL" ? 1 : -1;
      const sp = Math.min(BALL_SPEED_MAX, Math.max(BALL_SPEED, Math.hypot(b.vx, b.vy) * 1.3));
      const vx = dir * sp * 0.55;
      b.vx = vx;
      b.vy = -Math.sqrt(Math.max(0, sp * sp - vx * vx));
      b.x = p.x + dx / d * rr;
      b.y = p.y + dy / d * rr;
      if (p.cd > 0) return;
      p.flash = 1;
      p.cd = 0.1;
      this.#addScore(25);
    }
    #fieldProp(b, p, dt) {
      const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
      if (d > p.r) return;
      const cap = () => {
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > BALL_SPEED_MAX) {
          b.vx = b.vx / sp * BALL_SPEED_MAX;
          b.vy = b.vy / sp * BALL_SPEED_MAX;
        }
      };
      if (p.kind === "magnet") {
        b.vx += Math.sign(W / 2 - b.x) * 260 * dt;
        cap();
      } else if (p.kind === "fan") {
        b.vy -= 320 * dt;
        cap();
      } else if (b.vy > 0 && p.cd <= 0) {
        const sp = Math.min(BALL_SPEED_MAX, Math.max(BALL_SPEED, Math.hypot(b.vx, b.vy)));
        b.vy = -sp * 0.9;
        b.vx = (Math.random() - 0.5) * sp * 0.4;
        p.cd = 1.5;
        p.flash = 1;
        this.#addScore(15);
      }
    }
    #barProp(b, p) {
      if (b.x < p.x - p.r || b.x > p.x + p.r || Math.abs(b.y - p.y) > b.r + 4) return;
      if (p.kind === "spinner") {
        if (p.cd <= 0) {
          p.spin++;
          this.#addScore(5);
          p.cd = 0.08;
          p.flash = 1;
        }
      } else if (p.kind === "rollover") {
        if (!p.lit) {
          p.lit = true;
          p.flash = 1;
          this.#addScore(25);
        }
      } else if (b.vy > 0 && p.cd <= 0) {
        b.vy = -Math.abs(b.vy);
        b.y = p.y - b.r - 4;
        p.cd = 0.2;
        p.flash = 1;
        this.#addScore(10);
      }
    }
    /** Each bumper hit toggles a single turret: if one is already lit, morph it back
     *  to a plain tile; otherwise light a random live tile so it starts firing. */
    #toggleTurret() {
      const lit = this.bricks.find((b) => b.turret && b.alive);
      if (lit) {
        lit.turret = false;
        return;
      }
      const cands = this.bricks.filter((b) => b.alive && !b.turret && !b.mega && !b.seed && !b.covered);
      if (!cands.length) return;
      cands[Math.floor(Math.random() * cands.length)].turret = true;
      this.#turretFireCd = TURRET_FIRE_INTERVAL * 0.5;
    }
    /** Fire the lit turret at the paddle on a cadence, then advance every shot;
     *  a shot that lands on the paddle breaks the combo chain and flashes it red. */
    #stepTurrets(dt) {
      if (this.freezeTimer > 0) return;
      const turret = this.pinball ? this.bricks.find((b) => b.turret && b.alive) : null;
      if (turret) {
        this.#turretFireCd -= dt;
        if (this.#turretFireCd <= 0) {
          this.#turretFireCd = TURRET_FIRE_INTERVAL;
          const ox = turret.x + turret.w / 2, oy = turret.y + turret.h;
          const base = Math.atan2(this.paddle.y - oy, this.paddle.x - ox);
          for (const a of [-0.32, 0, 0.32]) {
            this.turretShots.push({ x: ox, y: oy, vx: Math.cos(base + a) * TURRET_SHOT_SPEED, vy: Math.sin(base + a) * TURRET_SHOT_SPEED, kind: "spread", t: 0 });
          }
        }
      }
      if (this.paddleHitFlash > 0) this.paddleHitFlash = Math.max(0, this.paddleHitFlash - dt);
      if (!this.turretShots.length) return;
      const p = this.paddle;
      const survive = [];
      for (const s of this.turretShots) {
        s.t = (s.t ?? 0) + dt;
        if (s.kind === "bomb") s.vy += 230 * dt;
        else if (s.kind === "seeker") {
          const dx = this.paddle.x - s.x, dy = this.paddle.y - s.y, d = Math.hypot(dx, dy) || 1;
          s.vx += dx / d * 220 * dt;
          s.vy += dy / d * 220 * dt;
          const ns = Math.hypot(s.vx, s.vy);
          if (ns > 195) {
            s.vx = s.vx / ns * 195;
            s.vy = s.vy / ns * 195;
          }
        }
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (s.y - TURRET_SHOT_R > H || s.x < -20 || s.x > W + 20) continue;
        const hit = !this.pinball && s.y + TURRET_SHOT_R >= p.y && s.y - TURRET_SHOT_R <= p.y + p.h && s.x >= p.x - p.w / 2 - TURRET_SHOT_R && s.x <= p.x + p.w / 2 + TURRET_SHOT_R;
        if (hit) {
          this.combo = 0;
          if (this.shielded) {
            s.vy = -Math.abs(s.vy) * 1.1;
            s.y = p.y - TURRET_SHOT_R - 2;
            s.kind = "shot";
            survive.push(s);
            this.shieldHp = Math.max(0, this.shieldHp - SHIELD_HIT_DMG);
            if (this.shieldHp <= 0) {
              this.regenShield = false;
              this.shieldFlash = 1.6;
            } else this.shieldFlash = 1;
            continue;
          }
          this.paddleHitFlash = PADDLE_HIT_FLASH;
          this.paddleHp -= TURRET_DMG * this.difficulty.turretDmgMul;
          if (this.paddleHp <= 0) {
            this.paddleHp = 0;
            this.turretShots = [];
            this.#loseLife();
            return;
          }
          continue;
        }
        survive.push(s);
      }
      this.turretShots = survive;
    }
    /** Pinball ended (a life lost — there is no timeout): morph every turret back to
     *  a tile and clear any shots in flight. */
    #clearTurrets() {
      for (const b of this.bricks) if (b.turret) b.turret = false;
      this.turretShots = [];
      this.#turretFireCd = 0;
    }
    /** Tick the centre dynamite: spawn one on a cadence, burn a lit fuse down to the
     *  blast, or let an untouched crate fizzle after TNT_LIFETIME. */
    #stepTnt(dt) {
      if (this.freezeTimer > 0) return;
      if (!this.tnt) {
        if (!this.#tntArmedThisLevel) return;
        this.#tntTimer -= dt;
        if (this.#tntTimer <= 0 && this.bricksLeft > 0 && this.#hazardFree()) {
          this.tnt = { x: W / 2, y: BRICK_TOP + this.#levelRows * BRICK_H / 2, t: 0, fuse: TNT_FUSE, lit: false };
          this.#activeHazard = "tnt";
        }
        return;
      }
      const t = this.tnt;
      t.t += dt;
      if (t.lit) {
        t.fuse -= dt;
        if (t.fuse <= 0) this.#detonateTnt();
      } else if (t.t >= TNT_LIFETIME) {
        this.tnt = null;
        this.#tntArmedThisLevel = false;
        this.#endHazard();
      }
    }
    /** A ball touching the crate bounces off it (AABB) and lights the fuse once. */
    #tntBounce(b) {
      const t = this.tnt;
      if (!t) return;
      const cx = clamp(b.x, t.x - TNT_R, t.x + TNT_R);
      const cy = clamp(b.y, t.y - TNT_R, t.y + TNT_R);
      const dx = b.x - cx, dy = b.y - cy;
      if (dx * dx + dy * dy > b.r * b.r) return;
      const ox = b.r - Math.abs(dx), oy = b.r - Math.abs(dy);
      if (ox < oy) {
        b.vx = dx >= 0 ? Math.abs(b.vx) : -Math.abs(b.vx);
        b.x += dx >= 0 ? ox : -ox;
      } else {
        b.vy = dy >= 0 ? Math.abs(b.vy) : -Math.abs(b.vy);
        b.y += dy >= 0 ? oy : -oy;
      }
      if (!t.lit) {
        t.lit = true;
        t.fuse = TNT_FUSE;
      }
    }
    /** Detonate: a big blast that deals a random 1..TNT_DMG_MAX to EVERY tile within
     *  TNT_RADIUS (plus the hunter/ship if caught) and scatters a cluster of fireballs. */
    #detonateTnt() {
      const t = this.tnt;
      if (!t) return;
      const cx = t.x, cy = t.y;
      this.explosions.push({ x: cx, y: cy, t: 0 });
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        this.explosions.push({ x: cx + Math.cos(a) * TNT_RADIUS * 0.45, y: cy + Math.sin(a) * TNT_RADIUS * 0.45, t: 0 });
        this.explosions.push({ x: cx + Math.cos(a + 0.4) * TNT_RADIUS * 0.8, y: cy + Math.sin(a + 0.4) * TNT_RADIUS * 0.8, t: 0 });
      }
      for (const brick of [...this.bricks]) {
        if (!brick.alive || brick.seed) continue;
        const bxc = brick.x + brick.w / 2, byc = brick.y + brick.h / 2;
        if (Math.hypot(bxc - cx, byc - cy) > TNT_RADIUS) continue;
        this.#damage(brick, 1 + Math.floor(Math.random() * TNT_DMG_MAX));
      }
      if (this.alien && Math.hypot(this.alien.x - cx, this.alien.y - cy) <= TNT_RADIUS) this.#destroyShip();
      this.#blastEnemies(cx, cy, TNT_RADIUS);
      if (this.pacman && Math.hypot(this.pacman.x - cx, this.pacman.y - cy) <= TNT_RADIUS) this.#killPacman();
      this.tnt = null;
      this.#tntArmedThisLevel = false;
      this.#endHazard();
      this.#checkWin();
    }
    #loseLife() {
      this.lives--;
      if (this.lives <= 0) {
        this.lives = 0;
        this.state = "gameover";
        this.milestoneFx = null;
        this.scoreFlash = 0;
        this.comboPops = [];
        this.rushFlash = 0;
        return;
      }
      this.#resetForLife();
    }
    /** Continue after a game over: refill lives and drop a fresh ball onto the level
     *  where you fell — score and surviving bricks are kept, so you play right on. */
    continueGame() {
      if (this.state !== "gameover") return;
      this.lives = this.difficulty.lives;
      this.state = "playing";
      this.#resetForLife();
    }
  };

  // hypercomb-essentials/src/games/arkanoid/levels.ts
  var LEVELS = [
    {
      name: "Warmup",
      rows: [
        "11111111111",
        "22222222222",
        "11111111111"
      ]
    },
    {
      name: "Greek Cross",
      rows: [
        "....111....",
        "....111....",
        "11111111111",
        "11121121111",
        "11111111111",
        "....111....",
        "....111...."
      ]
    },
    {
      name: "Whisker",
      rows: [
        "2.1...1.2",
        "11.111.11",
        "11111111111",
        "11.11111.11",
        "11111111111",
        ".111111111.",
        "...11111..."
      ]
    },
    {
      name: "Drift",
      rows: [
        "..1111.....",
        ".1111113...",
        "1111111.111",
        "1111113.111",
        ".1111111...",
        "..1111....."
      ]
    },
    {
      name: "All Smiles",
      rows: [
        ".111111111.",
        "11111111111",
        "11.11111.11",
        "11111111111",
        "11111111111",
        "11.111.111",
        "111111111",
        "..1111111.."
      ]
    },
    {
      name: "Crescent",
      rows: [
        "...2221....",
        ".22211.....",
        "22211......",
        "2231.......",
        "*221.......",
        "2231.......",
        "22211......",
        ".22211.....",
        "...2221...."
      ]
    },
    {
      name: "Sand Pyramid",
      rows: [
        ".....4.....",
        "....111....",
        "...11211...",
        "..1111111..",
        ".111111111.",
        "11111111111"
      ]
    },
    {
      name: "Falling Leaf",
      rows: [
        "....11.....",
        "...1121....",
        "..112211...",
        ".11122111..",
        "..1121111..",
        "...11211...",
        "....3......"
      ]
    },
    {
      name: "Petal Drift",
      rows: [
        "..2.....2..",
        ".1221.1221.",
        "12321.12321",
        ".1221.1221.",
        "..2.*.*.2..",
        ".121...121.",
        "..1.222.1..",
        "...12321...",
        "....1.1...."
      ]
    },
    {
      name: "Moire Stripes",
      rows: [
        "1.1.1.1.1.1",
        "1.1.1.1.1.1",
        ".1.1.1.1.1.",
        ".1.1.1.1.1.",
        "1.1.1.1.1.1",
        "1.1.1.1.1.1",
        ".1.1.1.1.1."
      ]
    },
    {
      name: "Checker Drift",
      rows: [
        "1.1.1.1.1.1",
        ".1.1.1.1.1.",
        "1.1.1.1.1.1",
        ".1.1.1.1.1.",
        "1.1.1.1.1.1",
        ".1.1.1.1.1."
      ]
    },
    {
      name: "Pixel Heart",
      rows: [
        ".11...11..",
        "1111.1111.",
        "1111111111",
        "1111111111",
        ".11111111.",
        "..111111..",
        "...1111...",
        "....11...."
      ]
    },
    {
      name: "Master Key",
      rows: [
        "..2112.....",
        ".211112....",
        ".21..12.333",
        ".211112.2.2",
        ".21..12.333",
        "..2112..2.2",
        "....2....22"
      ]
    },
    {
      name: "Diamond Solitaire",
      rows: [
        "....111....",
        "...11211...",
        "..1112111..",
        ".112323211.",
        ".1123*3211.",
        ".112323211.",
        "..1112111..",
        "....111...."
      ]
    },
    {
      name: "Chevron Cascade",
      rows: [
        "1.1.1.1.1.1",
        ".1.1.1.1.1.",
        "11.111.11..",
        "1.1.1.1.1.1",
        ".1.1.1.1.1."
      ]
    },
    {
      name: "Triforce",
      rows: [
        ".....1.....",
        "....111....",
        "...11111...",
        "..1.1.1.1..",
        ".111.1.111.",
        "11111.11111"
      ]
    },
    {
      name: "Twin Arrows",
      rows: [
        "..1.....1..",
        ".11.....11.",
        "1111111111",
        "1111111111",
        ".11.....11.",
        "..1.....1.."
      ]
    },
    {
      name: "Letter A",
      rows: [
        "....22....",
        "...2332...",
        "..22..22..",
        ".22.11.22.",
        ".2.1111.2.",
        "2*2.11.2*2",
        "2.2.11.2.2",
        "22......22",
        "2........2"
      ]
    },
    {
      name: "Lucky Seven",
      rows: [
        "11111111111",
        "22222222231",
        "......2111.",
        ".....2111..",
        "....2114...",
        "...2112....",
        "..2112.....",
        ".12*1......"
      ]
    },
    {
      name: "Boo",
      rows: [
        ".111111111.",
        "11111111111",
        "11.111.1111",
        "11111111111",
        "11111111111",
        "11111111111",
        "1.1.1.1.1.1"
      ]
    },
    {
      name: "Greys",
      rows: [
        "...11111...",
        "..1111111..",
        ".111111111.",
        "1.3.111.3.1",
        ".111111111.",
        "...11111...",
        "....1.1...."
      ]
    },
    {
      name: "Night Hoot",
      rows: [
        "1.11111.1",
        "11211.112",
        "111111111",
        "111111111",
        "11.111.11",
        "111111111",
        ".1111111.",
        "..11.11.."
      ]
    },
    {
      name: "Pollen",
      rows: [
        "...1...1...",
        "....111....",
        "11111111111",
        "2222222222",
        "11111111111",
        "2222222222",
        "11111111111",
        "....111...."
      ]
    },
    {
      name: "Ringed Planet",
      rows: [
        "...11111...",
        "..1111111..",
        "*111111111*",
        "..1111111..",
        "...11111..."
      ]
    },
    {
      name: "Liftoff",
      rows: [
        "....3....",
        "...121...",
        "..12321..",
        "..12221..",
        ".1122211.",
        ".1121211.",
        "*12211221*",
        ".1.111.1.",
        "..1...1.."
      ]
    },
    {
      name: "Step Ziggurat",
      rows: [
        "....2.2....",
        "...11111...",
        "..1111111..",
        "..2.....2..",
        ".111111111.",
        ".2.......2.",
        "11111111111"
      ]
    },
    {
      name: "Stone Bridge",
      rows: [
        "..1.....1..",
        "..1.....1..",
        "1111111111.",
        ".111111111.",
        "..2.....2..",
        "..2.....2.."
      ]
    },
    {
      name: "Lighthouse",
      rows: [
        "....444....",
        "....111....",
        "....1.1....",
        "....111....",
        "...11111...",
        "..1111111..",
        "..1111111.."
      ]
    },
    {
      name: "Lone Pine",
      rows: [
        ".....1.....",
        "....111....",
        "...11111...",
        "..1112111..",
        ".111111111.",
        ".....3.....",
        ".....3....."
      ]
    },
    {
      name: "Wild Bloom",
      rows: [
        "...1.1.1...",
        "..11111111.",
        ".111121111.",
        "..11111111.",
        "...1.1.1...",
        ".....3.....",
        ".....3....."
      ]
    },
    {
      name: "Spring Shower",
      rows: [
        "..211112...",
        ".21111112..",
        "2111111112.",
        "..1111111..",
        ".1..1..1..1",
        "1..1..1..1.",
        ".1..1..1..1"
      ]
    },
    {
      name: "Zigzag Pulse",
      rows: [
        "12.....2.21",
        "112...2.211",
        "*112.2.211*",
        ".2112.2112.",
        "..211.112..",
        "1.2.2.2.2.1",
        ".1.2.2.2.1.",
        "..1.2.1.."
      ]
    },
    {
      name: "Wave Field",
      rows: [
        "1.1.....1.1",
        ".1.1...1.1.",
        "..1.1.1.1..",
        "...1.1.1...",
        "..1.1.1.1..",
        ".1.1...1.1.",
        "1.1.....1.1"
      ]
    },
    {
      name: "Space Invader",
      rows: [
        "..1.....1..",
        "...1...1...",
        "..1111111..",
        ".11.111.11.",
        "1111111111.",
        "1.1.....1.1",
        "...11.11..."
      ]
    },
    {
      name: "Pac-Man Chomp",
      rows: [
        "..11111....",
        ".1111......",
        "11111....1.",
        "1112.....1.",
        "11111....1.",
        ".1111....1.",
        "..11111...."
      ]
    },
    {
      name: "Blinky Ghost",
      rows: [
        "..11111....",
        ".1111111..",
        "11*111*11.",
        "111111111.",
        "11111111.1",
        "1.11.11.1."
      ]
    },
    {
      name: "Cherry Bonus",
      rows: [
        "......2....",
        ".....2.....",
        "....3.3....",
        "..111.111..",
        ".11111111.1",
        ".11111111.1",
        "..1111111.."
      ]
    },
    {
      name: "Spur Gear",
      rows: [
        ".1.1.1.1.1.",
        "1*1111111*1",
        ".1111111111",
        "1*1111111*1",
        ".1.1.1.1.1."
      ]
    },
    {
      name: "Circuit Trace",
      rows: [
        "2.1111111.2",
        "..1.....1..",
        "111.111.111",
        "..1.....1..",
        "2.1111111.2"
      ]
    },
    {
      name: "Power Cell",
      rows: [
        "....22....",
        "1111111111",
        "11.1111.11",
        "11.1111.11",
        "1111111111"
      ]
    },
    {
      name: "Letter Theta",
      rows: [
        ".211112.",
        "21111112",
        "21....12",
        "21....12",
        "21333312",
        "21....12",
        "21....12",
        "21111112",
        ".211112."
      ]
    },
    {
      name: "Iron Lattice",
      rows: [
        "1.1.1.1.1.1",
        ".2.1.1.1.2.",
        "1.1.2.1.1.1",
        ".2.1.1.1.2.",
        "1.1.1.1.1.1"
      ]
    },
    {
      name: "Nested Frames",
      rows: [
        "***********",
        "*.........*",
        "*.11111.1.*",
        "*.1...1...*",
        "*.11111.1.*",
        "*.........*",
        "***********"
      ]
    },
    {
      name: "Hex Cluster",
      rows: [
        ".11.11.11..",
        "1..1..1..1.",
        "1..1..1..1.",
        ".11.11.11..",
        "1..1..1..1.",
        ".11.11.11.."
      ]
    },
    {
      name: "Heartbeat",
      rows: [
        ".11...11...",
        "1331.1331..",
        "1111111111.",
        ".11111111..",
        "..111111...",
        "...1111....",
        "....11....."
      ]
    },
    {
      name: "Zigzag Z",
      rows: [
        "*1111111111",
        ".......111.",
        ".....111...",
        "...111.....",
        ".111.......",
        "1111111111*"
      ]
    },
    {
      name: "Twin Peaks M",
      rows: [
        "11.....11..",
        "111...111..",
        "1.11.11.1..",
        "1..111..1..",
        "1...1...1..",
        "1.......1.."
      ]
    },
    {
      name: "Crossfire X",
      rows: [
        "11.......11",
        ".11.....11.",
        "..11...11..",
        "...11211...",
        "..11...11..",
        ".11.....11.",
        "11.......11"
      ]
    },
    {
      name: "Wide Open W",
      rows: [
        "1.......1..",
        "1...1...1..",
        "1..111..1..",
        "1.11.11.1..",
        "111...111..",
        "11.....11.."
      ]
    },
    {
      name: "Tin Mind",
      rows: [
        "...3...3...",
        "....111....",
        "11111111111",
        "1*1111*1111",
        "11111111111",
        "11.11111.11",
        "11111111111",
        "..1.....1.."
      ]
    },
    {
      name: "Bone Grin",
      rows: [
        ".1111111.",
        "111111111",
        "11*111*11",
        "111111111",
        ".1111111.",
        "..11.11..",
        "1.1.1.1.1"
      ]
    },
    {
      name: "Tail Chaser",
      rows: [
        ".........33",
        "......11133",
        "...1111133.",
        "1111111....",
        "...11111...",
        "......11..."
      ]
    },
    {
      name: "Star Chart",
      rows: [
        "1..2.2.2..1",
        ".1.2.1.2.1.",
        "2.1.2.2.1.2",
        "..1.2.2.1..",
        ".1.13*31.1.",
        "..1.2.2.1..",
        "2.1.2.2.1.2",
        ".1.2.1.2.1."
      ]
    },
    {
      name: "Saucer",
      rows: [
        "...12321...",
        ".111111111.",
        "11111111111",
        "..1.1.1.1.."
      ]
    },
    {
      name: "Solar Flare",
      rows: [
        "1.1.2.2.1.1",
        ".1.2.2.2.1.",
        "1.2.242.2.1",
        ".12.4*4.21.",
        "1.2.242.2.1",
        ".1.2.2.2.1.",
        "1.1.2.2.1.1"
      ]
    },
    {
      name: "Castle Keep",
      rows: [
        "*.*.*.*.*.*",
        "11111111111",
        "1.1.....1.1",
        "1111111111.",
        "111.....111",
        "111.222.111"
      ]
    },
    {
      name: "Greek Temple",
      rows: [
        "....333....",
        "2222222222.",
        "11111111111",
        "1.1.1.1.1.1",
        "1.1.1.1.1.1",
        "11111111111"
      ]
    },
    {
      name: "Watchtower",
      rows: [
        ".*.*.*.*.*.",
        ".111111111.",
        ".121111121.",
        "..1.....1..",
        ".12.....21.",
        ".111111111.",
        "..1121211..",
        "...12121..."
      ]
    },
    {
      name: "Three Peaks",
      rows: [
        ".....*.....",
        "..*..1..*..",
        ".111.111.11",
        "11111111111",
        "11111111111"
      ]
    },
    {
      name: "Rolling Surf",
      rows: [
        "..2......2.",
        ".1211...121",
        "1111121.111",
        ".11111111..",
        "..1111111.."
      ]
    },
    {
      name: "Spiral In",
      rows: [
        "11111111111",
        "1.........2",
        "1.222222.21",
        "1.2....1.21",
        "1.2.21.1.21",
        "1.2.1..1.21",
        "1.211111.21",
        "1........11"
      ]
    },
    {
      name: "HP Gradient",
      rows: [
        "11111111111",
        "11111111111",
        "11111111111",
        "22222222222",
        "1.1.1.1.1.1",
        "33333333333"
      ]
    },
    {
      name: "Optical Diamond",
      rows: [
        "....1.1....",
        "...12321...",
        "..1122211..",
        ".112242211.",
        ".112*4*211.",
        "..1122211..",
        "...12321...",
        "....1.1...."
      ]
    },
    {
      name: "Power Mushroom",
      rows: [
        "..*2222*...",
        ".2111111.2.",
        "21*1111*12",
        "2111111111.",
        "..1.11.1...",
        "..*.11.*..."
      ]
    },
    {
      name: "Game Controller",
      rows: [
        "...1...11..",
        "..111..1.1.",
        "1111111111.",
        "11*111111.1",
        "1111111111.",
        "..1.....1.."
      ]
    },
    {
      name: "Skeleton Key",
      rows: [
        ".333......",
        "3111.3.....",
        ".333.111111",
        "3111....1.1",
        "3333.....1."
      ]
    },
    {
      name: "Invader March",
      rows: [
        "1.1..1.1..1",
        "11111111111",
        ".1.11.11.1.",
        "1.1.1.1.1.1"
      ]
    },
    {
      name: "Padlock",
      rows: [
        "..3333...",
        "..3..3...",
        "1111111111",
        "1111*11111",
        "1111111111",
        ".11111111."
      ]
    },
    {
      name: "Signal Tower",
      rows: [
        "....4*4....",
        "...12221...",
        "1..12121..1",
        "21.12321.12",
        "121.323.121",
        "2211.1.1122",
        ".221...122.",
        "..21...12.."
      ]
    },
    {
      name: "Tin Robot",
      rows: [
        "..1.1.1.1..",
        "..1111111..",
        "..1*111*1..",
        "..1111111..",
        ".1.11111.1.",
        "...1...1..."
      ]
    },
    {
      name: "Crystal Vault",
      rows: [
        ".....4.....",
        "...4*2*4...",
        ".4*21112*4.",
        "4*2111112*4",
        ".4*21112*4.",
        "...4*2*4...",
        ".....4....."
      ]
    },
    {
      name: "Fractured Star",
      rows: [
        "1...1.1...1",
        ".1..111..1.",
        "..11*3*11..",
        "1.13*3*31.1",
        "..11*3*11..",
        ".1..111..1.",
        "1...1.1...1"
      ]
    },
    {
      name: "Wishing Star",
      rows: [
        ".....1.....",
        "....131....",
        "11111111111",
        ".111313111.",
        "..11...11..",
        ".11.....11."
      ]
    },
    {
      name: "Ampersand",
      rows: [
        "..1111.....",
        ".11..11....",
        ".11.11.....",
        "..111......",
        ".111.11..1.",
        "11..111.11.",
        "11...11111.",
        ".1111..111."
      ]
    },
    {
      name: "Eight Legs",
      rows: [
        "4.1.1.1.4",
        "2.11111.2",
        "2*11111*2",
        "1.11111.1",
        "1.1.1.1.1",
        "..1...1.."
      ]
    },
    {
      name: "Spiral Galaxy",
      rows: [
        "1112.......",
        "2112211....",
        ".21.31.211.",
        "..1.4*4.12.",
        ".112.13.12.",
        "....1122112",
        ".......2111"
      ]
    },
    {
      name: "Black Hole",
      rows: [
        "..1111111..",
        ".11.....11.",
        "11..***..11",
        ".11.....11.",
        "..1111111.."
      ]
    },
    {
      name: "City Gate",
      rows: [
        "3.........3",
        "11.......11",
        "11.......11",
        "11.222.111.",
        "11.212.111.",
        "1111111111."
      ]
    },
    {
      name: "Aqueduct",
      rows: [
        "11111111111",
        "1.1.1.1.1.1",
        "1.1.1.1.1.1",
        "2.2.2.2.2.2",
        "2.2.2.2.2.2"
      ]
    },
    {
      name: "First Frost",
      rows: [
        "..1..2..1..",
        ".1.1.2.1.1.",
        "..1.111.1..",
        "222111222..",
        "..1.111.1..",
        ".1.1.2.1.1.",
        "..1..2..1.."
      ]
    },
    {
      name: "Painted Wings",
      rows: [
        ".11.....11.",
        "1121.2.1211",
        "11111311111",
        "1121.3.1211",
        ".11..3..11.",
        ".....3....."
      ]
    },
    {
      name: "Concentric Rings",
      rows: [
        "22222222222",
        "2.........2",
        "2.1111111.2",
        "2.1.....1.2",
        "2.1.*.1.1.2",
        "2.1111111.2",
        "2.........2",
        "22222222222"
      ]
    },
    {
      name: "Vortex",
      rows: [
        "1111.111111",
        "1....1....1",
        "1.11.1.11.1",
        "1.1..*..1.1",
        "1.11111.1.1",
        "1......11.1",
        "111111.1111"
      ]
    },
    {
      name: "Gold Coin",
      rows: [
        "..*444*....",
        ".4111114..",
        "41131311.4",
        "411.13314",
        "41131311.4",
        ".4111114..",
        "..*444*..."
      ]
    },
    {
      name: "Cog Tower",
      rows: [
        "..2.2.2....",
        ".111111....",
        "..1*1......",
        ".111111....",
        "..1*1......",
        ".111111...."
      ]
    },
    {
      name: "Quarter Note",
      rows: [
        "......11444",
        "......11...",
        "......11...",
        "......11...",
        "..11..11...",
        ".4441.11...",
        ".44441.....",
        "..4441....."
      ]
    },
    {
      name: "Asteroid Belt",
      rows: [
        "..1..1..1..",
        "1.111.111.1",
        ".11*11*11*.",
        "1.111.111.1",
        "..1..1..1.."
      ]
    },
    {
      name: "Golden Citadel",
      rows: [
        "*.*.*.*.*.*",
        "44444444444",
        "4.4.4.4.4.4",
        "33333333333",
        "11111111111",
        "*.*.*.*.*.*"
      ]
    },
    {
      name: "Glacier Wall",
      rows: [
        "*1*1*1*1*1*",
        "13131313131",
        "11111111111",
        "12121212121",
        "11111111111",
        "13131313131",
        "*1*1*1*1*1*"
      ]
    },
    {
      name: "Gold Lattice",
      rows: [
        "*2*2*2*2*2*",
        "2222222222.",
        "*2*2*2*2*2*",
        "2222222222.",
        "*2*2*2*2*2*"
      ]
    },
    {
      name: "Reactor Core",
      rows: [
        "*.*.*.*.*.*",
        "11111111111",
        "1144*4411",
        "11111111111",
        "*.*.*.*.*.*"
      ]
    },
    {
      name: "Treasure Chest",
      rows: [
        "..*******..",
        ".*4444444*.",
        ".*1111111*.",
        ".****1****.",
        ".*1111111*.",
        "..*******.."
      ]
    },
    {
      name: "Fort Rampart",
      rows: [
        "*.*.*.*.*.*",
        "***********",
        "*111111111*",
        "*1*1*1*1*1*",
        "*111111111*",
        "***********"
      ]
    },
    {
      name: "Golden Crown",
      rows: [
        "*..*.*..*",
        "**.*.*.**",
        "***********",
        "*333333333*",
        "*111111111*",
        "***********"
      ]
    },
    {
      name: "Gold Ingots",
      rows: [
        "..4444444..",
        ".*4444444*.",
        "***********",
        "..4444444..",
        ".*4444444*.",
        "***********"
      ]
    },
    {
      name: "Vault Door",
      rows: [
        "***********",
        "*111111111*",
        "*1*44*44*1*",
        "*1*4**4**1*",
        "*1*44*44*1*",
        "*111111111*",
        "***********"
      ]
    },
    {
      name: "Knight's Shield",
      rows: [
        "***********",
        "*4*111*4*",
        ".*41111*4*.",
        "..*411114*.",
        "...*4114*..",
        "....*44*...",
        ".....**...."
      ]
    },
    {
      name: "Dragon's Hoard",
      rows: [
        "*.*.*.*.*.*",
        ".*1*4*1*4*.",
        "*4*1*1*1*4*",
        ".*1*4*4*1*.",
        "*1*4***4*1*",
        ".*1111111*.",
        "..*******.."
      ]
    },
    {
      name: "Sealed Bunker",
      rows: [
        "***********",
        "*4*4*4*4*4*",
        "*111111111*",
        "*4*4*4*4*4*",
        "*111111111*",
        "***********"
      ]
    },
    {
      name: "Sun Disc Idol",
      rows: [
        "*.*.*.*.*.*",
        ".*4*4*4*4*.",
        "*4*11111*4*",
        ".*411*114*.",
        "*4*11111*4*",
        ".*4*4*4*4*.",
        "*.*.*.*.*.*"
      ]
    }
  ];
  function cloneLevel(l) {
    return { name: l.name, rows: [...l.rows] };
  }
  var EDIT_COLS = 11;
  var EDIT_ROWS = 12;

  // hypercomb-essentials/src/games/arkanoid/theme.ts
  function bandFor(theme, levelIndex) {
    return theme.bands[Math.floor(levelIndex / 4) % theme.bands.length];
  }
  var IOC_KEY = "@diamondcoreprocessor.com/ArkanoidThemes";
  var LS_KEY = "ark:theme";
  var ThemeRegistry = class extends EventTarget {
    #themes = [];
    #activeId = null;
    /** Add a theme (idempotent by id). The first registered theme — or the stored pick,
     *  once it registers — becomes active. Announces 'change' so an open picker refreshes. */
    register(theme) {
      if (this.#themes.some((t) => t.id === theme.id)) return;
      this.#themes.push(theme);
      const stored = this.#stored();
      if (this.#activeId === null || theme.id === stored) this.#activeId = stored ?? this.#activeId ?? theme.id;
      this.dispatchEvent(new CustomEvent("change"));
    }
    list() {
      return this.#themes.slice();
    }
    get(id) {
      return this.#themes.find((t) => t.id === id);
    }
    /** The active theme, falling back to the first registered (or null if none yet). */
    active() {
      return this.get(this.#activeId ?? "") ?? this.#themes[0] ?? null;
    }
    activeId() {
      return this.active()?.id ?? null;
    }
    setActive(id) {
      if (!this.get(id)) return;
      this.#activeId = id;
      try {
        localStorage.setItem(LS_KEY, id);
      } catch {
      }
      this.dispatchEvent(new CustomEvent("change"));
    }
    #stored() {
      try {
        return localStorage.getItem(LS_KEY);
      } catch {
        return null;
      }
    }
  };
  var arkanoidThemes = (() => {
    const existing = window.ioc?.get(IOC_KEY);
    if (existing) return existing;
    const reg = new ThemeRegistry();
    window.ioc?.register(IOC_KEY, reg);
    return reg;
  })();

  // hypercomb-essentials/src/games/arkanoid/renderer.ts
  var BRICK_COLORS = {
    1: "#4DE3FF",
    // page .ak-b1 — cyan
    2: "#FFD93B",
    // page .ak-b2 — gold
    3: "#FF5C96",
    // page .ak-b3 — pink
    4: "#A488FF"
    // page .ak-b4 — purple
  };
  var BRICK_SHADE = {
    "#4DE3FF": "#1FA8CC",
    "#FFD93B": "#D3A802",
    "#FF5C96": "#D1246A",
    "#A488FF": "#6C48E0"
  };
  var BRICK_GAP_X = 5;
  var BRICK_GAP_Y = 3;
  var TOUGH_COLOR = "#A488FF";
  var FINALE_GOLD = "#FFD93B";
  var FROG_BODY_TOP = "#7CF05A";
  var FROG_BODY_MID = "#3FD13A";
  var FROG_BODY_BOT = "#1E9E2E";
  var FROG_BELLY = "#E9FFD0";
  var FROG_INK = "#0E5A1E";
  var BEE_BODY_TOP = "#FFD23A";
  var BEE_BODY_MID = "#FFB81F";
  var BEE_BODY_BOT = "#E8870C";
  var BEE_STRIPE = "#241A0A";
  var BEE_INK = "#5A3A0E";
  var BEE_WING = "210,235,255";
  var CRAB_SHELL_TOP = "#FF7A4D";
  var CRAB_SHELL_MID = "#F2452E";
  var CRAB_SHELL_BOT = "#B81E22";
  var CRAB_LIMB = "#FF9166";
  var CRAB_BELLY = "#FFE0C2";
  var CRAB_INK = "#7A1410";
  var GHOST_BODY_TOP = "#FFFFFF";
  var GHOST_BODY_MID = "#F2ECFF";
  var GHOST_BODY_BOT = "#D9C8FF";
  var GHOST_BELLY = "#FBF7FF";
  var GHOST_INK = "#6A4FA8";
  var GHOST_CHEEK = "#FFA7D0";
  var CHICK_BODY_TOP = "#FFE86B";
  var CHICK_BODY_MID = "#FFD23B";
  var CHICK_BODY_BOT = "#F2A521";
  var CHICK_BELLY = "#FFF6C8";
  var CHICK_BEAK = "#FF8A2B";
  var CHICK_INK = "#9A5410";
  var ENEMY_LOOKS = [
    { aura: "255,40,90", top: "#e23a5e", mid: "#b81a3c", bot: "#6e0f24", eye: "#ff5b2e", accent: "#ffd24a", dark: "#7a0f25", spikes: 11 },
    // crimson
    { aura: "70,220,90", top: "#5fe07a", mid: "#23b84a", bot: "#0f6e24", eye: "#aaff5b", accent: "#d8ff7a", dark: "#0f5a1e", spikes: 9 },
    // toxic green
    { aura: "60,150,255", top: "#5a9bff", mid: "#1a5cd8", bot: "#0f2a6e", eye: "#5be0ff", accent: "#a8e6ff", dark: "#10306e", spikes: 13 },
    // electric blue
    { aura: "170,80,255", top: "#b07bff", mid: "#7a2ed8", bot: "#3a1070", eye: "#ff7bff", accent: "#e0a8ff", dark: "#3a106e", spikes: 8 },
    // violet
    { aura: "255,150,40", top: "#ffa64d", mid: "#e2731a", bot: "#7a3a0f", eye: "#ffd24a", accent: "#ffe9a8", dark: "#6e3010", spikes: 12 },
    // amber
    { aura: "40,220,210", top: "#5fe6dc", mid: "#1ab8a8", bot: "#0f6e66", eye: "#d0fff8", accent: "#a8fff0", dark: "#0f5a52", spikes: 10 },
    // teal
    { aura: "255,60,180", top: "#ff6bbf", mid: "#d82e90", bot: "#70104e", eye: "#ffaee0", accent: "#ffc8e8", dark: "#6e1048", spikes: 14 },
    // magenta
    { aura: "170,210,255", top: "#cfe2ff", mid: "#7fa0d6", bot: "#2f4b8a", eye: "#bcdcff", accent: "#eaf3ff", dark: "#2f4b7a", spikes: 7 },
    // ice
    { aura: "210,220,40", top: "#e0e25f", mid: "#b8b023", bot: "#6e660f", eye: "#f0ff7a", accent: "#fbffb0", dark: "#5a5a0f", spikes: 9 },
    // sickly
    { aura: "160,160,210", top: "#c0c0e0", mid: "#7070b8", bot: "#3a3a6e", eye: "#c0a8ff", accent: "#e0e0ff", dark: "#3a3a6e", spikes: 12 }
    // steel
  ];
  var BRICK_CHARRED = { r: 58, g: 50, b: 46 };
  var SCRAMBLE_PALETTE = ["#ff5b5b", "#ffb03a", "#ffe24a", "#5fe08a", "#3dd7ff", "#5b9bff", "#b07bff", "#ff5bd0", "#ff7043", "#39ff6a"];
  var OSC_STACK_PALETTE = ["#5fe0c0", "#5fe08a", "#ffe24a", "#ffb03a", "#ff7043", "#ff5b5b", "#ff3df0"];
  function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255 };
  }
  var rgbStr = (r, g, b) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
  function mix(a, b, t) {
    return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
  }
  function darken(c, k) {
    return { r: c.r * k, g: c.g * k, b: c.b * k };
  }
  function rngFrom(seed) {
    let s = (seed | 0) % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => {
      s = s * 48271 % 2147483647;
      return s / 2147483647;
    };
  }
  var PROP_STYLE = {
    jet: { c: "#ff7043", shape: "disc", label: "J" },
    pop: { c: "#5b9bff", shape: "disc" },
    mushroom: { c: "#5fe08a", shape: "disc" },
    tunnel: { c: "#3dd7ff", shape: "ring" },
    jackpot: { c: "#ffd24a", shape: "disc", label: "$" },
    teleport: { c: "#b07bff", shape: "ring" },
    multiplier: { c: "#ffd24a", shape: "disc", label: "\xD7" },
    extraball: { c: "#eaffff", shape: "disc", label: "+" },
    orbit: { c: "#5fe6dc", shape: "disc" },
    drop: { c: "#ff5b8a", shape: "target" },
    standup: { c: "#ffae4a", shape: "target" },
    bank: { c: "#b07bff", shape: "target" },
    slingL: { c: "#aeb9ff", shape: "slingL" },
    slingR: { c: "#aeb9ff", shape: "slingR" },
    magnet: { c: "#7ec8ff", shape: "field" },
    fan: { c: "#a8fff0", shape: "field" },
    kicker: { c: "#ffd24a", shape: "field" },
    spinner: { c: "#d8c2ff", shape: "spinner" },
    rollover: { c: "#5fe08a", shape: "bar" },
    gate: { c: "#ff8f8f", shape: "gate" }
  };
  var Renderer = class {
    #ctx;
    constructor(ctx) {
      this.#ctx = ctx;
    }
    // ── orchestration spine: one candlelight clock the whole keep breathes on ──
    #pulseV = 0.6;
    // last computed candlelight value (0..1), recomputed atop draw()
    #spike = 0;
    // event energy; brick-break / frenzy / level-start / near-clear add to it
    #lastT = 0;
    // previous draw() time, for frame-rate-independent spike decay
    /** Candlelight: a slow sway + a faster flutter + a deterministic guttering stutter
     *  (no Math.random in render). Folds in #spike so events lift the glow board-wide.
     *  THE shared clock — every glowing element scales its glow by this.#pulse. */
    #computePulse(time) {
      const base = 0.5 + 0.5 * Math.sin(time * 2.1);
      const flutter = 0.5 + 0.5 * Math.sin(time * 11 + 1.3);
      const q = Math.floor(time * 7), s = Math.sin(q * 12.9898) * 43758.5453;
      const stutter = s - Math.floor(s);
      let v = base * 0.62 + flutter * 0.26 + stutter * 0.12;
      v = 0.45 + 0.55 * v;
      this.#pulseV = Math.min(1, v + this.#spike * 0.5);
    }
    /** Poke a synchronised glow spike (an orchestration MOMENT) — the overlay calls
     *  this on brick-break, frenzy, and level-start so the whole keep flares on one beat. */
    spike(amount) {
      this.#spike = Math.min(2.2, this.#spike + amount);
    }
    /** The live candlelight value, for draws inside the class. */
    get #pulse() {
      return this.#pulseV;
    }
    /** Neon convention: shadowColor = the hue, shadowBlur = base + swing*pulse. Call
     *  before filling/stroking a bright neon core so it glows on the shared candle. */
    #neon(hue, base, swing) {
      const ctx = this.#ctx;
      ctx.shadowColor = hue;
      ctx.shadowBlur = base + swing * this.#pulseV;
    }
    draw(engine, time) {
      const dt = Math.min(0.05, Math.max(0, time - this.#lastT));
      this.#lastT = time;
      this.#spike = Math.max(0, this.#spike - dt * 3.2);
      this.#computePulse(time);
      const theme = arkanoidThemes.active();
      if (theme) {
        const band = bandFor(theme, engine.levelIndex);
        const env = { W, H, time, pulse: this.#pulse, band, levelIndex: engine.levelIndex };
        theme.background(this.#ctx, env);
        theme.atmosphere(this.#ctx, env);
      } else {
        this.#ctx.fillStyle = "#06040c";
        this.#ctx.fillRect(0, 0, W, H);
      }
      this.#bricks(engine.bricks, time);
      this.#bumpers(engine.bumpers, time);
      if (engine.pinballProps.length) this.#pinballProps(engine.pinballProps, time);
      this.#turretShots(engine.turretShots, time);
      this.#gunAim(engine, time);
      this.#paddle(engine, time);
      this.#chargeOrb(engine, time);
      this.#fireballs(engine.fireballs, time);
      this.#beam(engine);
      if (engine.alien) this.#alien(engine.alien, time);
      if (engine.extraLife) this.#extraLife(engine.extraLife, time);
      if (engine.tnt) this.#tnt(engine.tnt, time);
      const fiery = engine.tnt !== null;
      const piercing = engine.pierceTimer > 0;
      const scrambled = engine.scrambleTimer > 0;
      const oscStacks = engine.oscillateStacks;
      const oscCol = oscStacks > 0 ? OSC_STACK_PALETTE[Math.min(oscStacks - 1, OSC_STACK_PALETTE.length - 1)] : null;
      let ballIx = 0;
      for (const b of engine.balls) {
        if (oscCol && !b.stuck) this.#oscillationAura(b, oscStacks, oscCol, time);
        this.#ball(b, time, fiery, piercing && b.primary, engine.finale, scrambled, ballIx++);
      }
      if (engine.chainBall) this.#ballChain(engine, time);
      if (engine.freezeTimer > 0) this.#freeze(engine, time);
      this.#capsules(engine.capsules, time);
      if (engine.enemies.length) {
        const white = engine.balls.find((b) => b.primary) ?? null;
        for (const e of engine.enemies) this.#enemy(e, white, time);
      }
      if (engine.pacman) this.#pacman(engine.pacman, time);
      this.#rockets(engine.rockets);
      this.#explosions(engine.explosions);
      this.#pickups(engine.pickups);
      this.#comboPops(engine.comboPops);
      if (engine.milestoneFx) this.#milestone(engine.milestoneFx.n, engine.milestoneFx.t, engine.milestoneFx.life);
      if (engine.rushFlash > 0) this.#finaleBurst(engine.rushFlash, time);
      if (engine.aiming) this.#aimHint(engine, time);
      this.#hud(engine);
    }
    // ── designer view ────────────────────────────────────────
    drawEditor(grid, hover) {
      const ctx = this.#ctx;
      for (let r = 0; r < grid.length; r++) {
        const line = grid[r];
        for (let c = 0; c < line.length; c++) {
          const ch = line[c];
          if (ch === "." || ch === " ") continue;
          const color = ch === "*" ? TOUGH_COLOR : BRICK_COLORS[parseInt(ch, 10) || 1] ?? "#46b6f0";
          this.#drawBrick(BRICK_X0 + c * BRICK_W, BRICK_TOP + r * BRICK_H, BRICK_W, BRICK_H, color, 1);
        }
      }
      const gw = EDIT_COLS * BRICK_W, gh = EDIT_ROWS * BRICK_H;
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1;
      for (let c = 0; c <= EDIT_COLS; c++) {
        ctx.beginPath();
        ctx.moveTo(BRICK_X0 + c * BRICK_W + 0.5, BRICK_TOP);
        ctx.lineTo(BRICK_X0 + c * BRICK_W + 0.5, BRICK_TOP + gh);
        ctx.stroke();
      }
      for (let r = 0; r <= EDIT_ROWS; r++) {
        ctx.beginPath();
        ctx.moveTo(BRICK_X0, BRICK_TOP + r * BRICK_H + 0.5);
        ctx.lineTo(BRICK_X0 + gw, BRICK_TOP + r * BRICK_H + 0.5);
        ctx.stroke();
      }
      if (hover && hover.col >= 0 && hover.row >= 0 && hover.col < EDIT_COLS && hover.row < EDIT_ROWS) {
        ctx.strokeStyle = "rgba(126,224,255,0.9)";
        ctx.lineWidth = 2;
        ctx.strokeRect(BRICK_X0 + hover.col * BRICK_W + 1, BRICK_TOP + hover.row * BRICK_H + 1, BRICK_W - 2, BRICK_H - 2);
      }
      ctx.fillStyle = "rgba(90,169,255,0.4)";
      this.#roundRect(W / 2 - 42, H - 34, 84, 13, 6);
      ctx.fill();
      ctx.fillStyle = "rgba(154,160,200,0.85)";
      ctx.font = '13px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("paint bricks \xB7 \u25B6 Test to play", W / 2, H - 44);
    }
    #bricks(bricks, time) {
      const ctx = this.#ctx;
      for (const b of bricks) {
        if (!b.alive) continue;
        if (b.mega) {
          this.#drawBrick(b.x, b.y, b.w, b.h, FINALE_GOLD, b.hp / b.max);
          this.#sparkle(b, time, 6);
          continue;
        }
        if (b.gold) {
          this.#finalBrick(b, time);
          continue;
        }
        const baseHex = b.max >= 4 ? TOUGH_COLOR : BRICK_COLORS[b.max] ?? "#46b6f0";
        this.#drawBrick(b.x, b.y, b.w, b.h, baseHex, b.hp / b.max);
        if (b.seed) this.#sparkle(b, time, 2);
        if (b.turret) this.#turretTile(b, time);
        if (b.mult && !b.hidden) this.#multBadge(b, time);
      }
      ctx.globalAlpha = 1;
    }
    /** The LAST brick standing — the level's finale beacon. A gold body under a
     *  breathing halo + sparkle, so the final hit of a level reads as a prize worth
     *  chasing instead of one more tile. Deterministic in time (no Math.random). */
    #finalBrick(b, time) {
      const ctx = this.#ctx;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const pulse = 0.5 + 0.5 * Math.sin(time * 6);
      const r = b.w * (0.72 + 0.3 * pulse);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const halo = ctx.createRadialGradient(cx, cy, 1, cx, cy, r);
      halo.addColorStop(0, `rgba(255,215,106,${0.42 + 0.28 * pulse})`);
      halo.addColorStop(1, "rgba(255,176,32,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      this.#drawBrick(b.x, b.y, b.w, b.h, FINALE_GOLD, b.hp / b.max);
      this.#sparkle(b, time, 4);
    }
    /** A ×N badge on a multiplier tile — blue ×1, green ×2, gold ×3. The hidden ×5
     *  has no badge (it looks like a normal brick until broken). */
    #multBadge(b, time) {
      const ctx = this.#ctx;
      const n = b.mult ?? 1;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const col = n >= 3 ? "#ffd24a" : n === 2 ? "#7ee0a0" : "#7ec8ff";
      const pulse = 0.5 + 0.5 * Math.sin(time * 5 + cx * 0.2);
      ctx.save();
      ctx.fillStyle = "rgba(8,12,24,0.5)";
      this.#roundRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4, 3);
      ctx.fill();
      ctx.shadowColor = col;
      ctx.shadowBlur = 5 + 5 * pulse;
      ctx.fillStyle = col;
      ctx.font = `800 ${Math.min(b.h - 3, 13)}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`\xD7${n}`, cx, cy + 0.5);
      ctx.restore();
    }
    /** The centre dynamite crate: a bound bundle of red sticks with a fuse. Unlit it
     *  pulses with a draining lifetime ring; lit, the fuse sparks and the crate shakes. */
    #tnt(t, time) {
      const ctx = this.#ctx;
      const shake = t.lit ? (0.5 - time * 53 % 1) * 3 : 0;
      const x = t.x + shake, y = t.y + shake;
      ctx.save();
      const glow = ctx.createRadialGradient(x, y, 2, x, y, 30);
      glow.addColorStop(0, t.lit ? "rgba(255,80,40,0.5)" : "rgba(255,140,40,0.28)");
      glow.addColorStop(1, "rgba(255,80,40,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, 30, 0, Math.PI * 2);
      ctx.fill();
      for (let i = -1; i <= 1; i++) {
        const sx = x + i * 8;
        const g = ctx.createLinearGradient(sx - 4, 0, sx + 4, 0);
        g.addColorStop(0, "#a01b1b");
        g.addColorStop(0.5, "#e23b3b");
        g.addColorStop(1, "#7a1010");
        ctx.fillStyle = g;
        this.#roundRect(sx - 4, y - 12, 8, 24, 2);
        ctx.fill();
        ctx.fillStyle = "#2a0a0a";
        ctx.fillRect(sx - 4, y - 2, 8, 4);
      }
      ctx.strokeStyle = "#3a3a3a";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 13, y - 5);
      ctx.lineTo(x + 13, y - 5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 13, y + 6);
      ctx.lineTo(x + 13, y + 6);
      ctx.stroke();
      ctx.strokeStyle = "#caa46a";
      ctx.lineWidth = 1.6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, y - 12);
      ctx.quadraticCurveTo(x + 8, y - 20, x + 4, y - 26);
      ctx.stroke();
      if (t.lit) {
        const sp = 0.5 + 0.5 * Math.sin(time * 40);
        ctx.fillStyle = `rgba(255,${180 + Math.floor(60 * sp)},80,1)`;
        ctx.shadowColor = "#ffd24a";
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(x + 4, y - 26, 2 + 2 * sp, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const frac = Math.max(0, 1 - t.t / 30);
        ctx.strokeStyle = "rgba(255,160,60,0.7)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 21, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    /** A lit turret tile: a dark hostile plate, a pulsing red core "eye", and a
     *  barrel poking down out of the bottom edge — clearly aimed at the player. */
    #turretTile(b, time) {
      const ctx = this.#ctx;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const pulse = 0.5 + 0.5 * Math.sin(time * 9);
      ctx.save();
      ctx.fillStyle = "rgba(30,8,12,0.55)";
      this.#roundRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4, 3);
      ctx.fill();
      ctx.fillStyle = "#2a2f3a";
      ctx.fillRect(cx - 3, b.y + b.h - 2, 6, 6);
      ctx.fillStyle = "#11151c";
      ctx.fillRect(cx - 1.5, b.y + b.h + 2, 3, 2);
      ctx.shadowColor = "#ff3b3b";
      ctx.shadowBlur = 8 + 6 * pulse;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 6);
      g.addColorStop(0, "#ffd0d0");
      g.addColorStop(0.5, "#ff4d4d");
      g.addColorStop(1, "rgba(255,40,40,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, 4 + 1.5 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    /** Turret shots raining toward the paddle — small red tracer slugs with a tail. */
    #turretShots(shots, time) {
      if (!shots.length) return;
      const ctx = this.#ctx;
      ctx.save();
      for (const s of shots) {
        const len = Math.hypot(s.vx, s.vy) || 1;
        const dx = s.vx / len, dy = s.vy / len;
        if (s.kind === "bomb") {
          const pulse = 0.5 + 0.5 * Math.sin((s.t ?? 0) * 12);
          ctx.save();
          ctx.fillStyle = "#4a2410";
          for (const f of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(s.x, s.y - 4);
            ctx.lineTo(s.x + f * 5, s.y - 8);
            ctx.lineTo(s.x + f * 2, s.y - 2);
            ctx.closePath();
            ctx.fill();
          }
          const g = ctx.createRadialGradient(s.x - 1.6, s.y - 1.6, 1, s.x, s.y, 6);
          g.addColorStop(0, "#7a4a2a");
          g.addColorStop(1, "#231007");
          ctx.fillStyle = g;
          ctx.shadowColor = "#ffb43c";
          ctx.shadowBlur = 4 + 8 * pulse;
          ctx.beginPath();
          ctx.arc(s.x, s.y, 5.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgba(255,200,80,${0.6 + 0.4 * pulse})`;
          ctx.beginPath();
          ctx.arc(s.x, s.y - 8, 1.4 + pulse, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else if (s.kind === "bolt") {
          ctx.save();
          ctx.strokeStyle = "rgba(150,220,255,0.55)";
          ctx.lineWidth = 4;
          ctx.shadowColor = "#7ee0ff";
          ctx.shadowBlur = 11;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(s.x - dx * 17, s.y - dy * 17);
          ctx.lineTo(s.x, s.y);
          ctx.stroke();
          ctx.strokeStyle = "#eaffff";
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.moveTo(s.x - dx * 8, s.y - dy * 8);
          ctx.lineTo(s.x, s.y);
          ctx.stroke();
          ctx.restore();
        } else if (s.kind === "seeker") {
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          for (let i = 1; i <= 3; i++) {
            ctx.globalAlpha = 0.45 / i;
            ctx.fillStyle = i === 1 ? "#ffd24a" : "#ff7043";
            ctx.beginPath();
            ctx.arc(s.x - dx * i * 5, s.y - dy * i * 5, 3 - i * 0.6, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = 1;
          ctx.translate(s.x, s.y);
          ctx.rotate(Math.atan2(dy, dx));
          ctx.fillStyle = "#dbe3ee";
          ctx.shadowColor = "#ff5b3a";
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.moveTo(6, 0);
          ctx.lineTo(-3, -3.2);
          ctx.lineTo(-3, 3.2);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "#ff5b3a";
          ctx.fillRect(-4.5, -2, 2.2, 4);
          ctx.restore();
        } else {
          const tx = s.x - dx * 9, ty = s.y - dy * 9;
          ctx.strokeStyle = "rgba(255,90,80,0.5)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(s.x, s.y);
          ctx.stroke();
          ctx.shadowColor = "#ff3b3b";
          ctx.shadowBlur = 8;
          const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 4);
          g.addColorStop(0, "#fff0e0");
          g.addColorStop(0.5, "#ff5a45");
          g.addColorStop(1, "rgba(255,60,40,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
      ctx.restore();
    }
    /** A few twinkling 4-point sparkles over a brick (seed or mega). */
    #sparkle(b, time, n) {
      const ctx = this.#ctx;
      ctx.save();
      ctx.fillStyle = "#fffbe6";
      ctx.shadowColor = "#ffe9a8";
      ctx.shadowBlur = 6;
      const iw = Math.max(2, b.w - 12), ih = Math.max(2, b.h - 10);
      for (let i = 0; i < n; i++) {
        const px = b.x + 6 + (i * 37 + 13) % iw;
        const py = b.y + 5 + (i * 53 + 7) % ih;
        const tw = 0.5 + 0.5 * Math.sin(time * 5 + i * 1.7);
        ctx.globalAlpha = tw;
        const r = 1 + 2 * tw;
        ctx.fillRect(px - r, py - 0.6, r * 2, 1.2);
        ctx.fillRect(px - 0.6, py - r, 1.2, r * 2);
      }
      ctx.restore();
    }
    /** Paint one brick — THE ARRIVAL PAGE'S TILE. A rounded plate carrying one
     *  two-stop vertical gradient, separated from its neighbours by the page's
     *  own gutter. The painter used to stack a shine edge, an ink contour, a cel
     *  band, a gloss sweep and a specular hotspot onto every tile; beside the
     *  page's clean wall that read as busy, so all of it is gone.
     *
     *  `wear` is hp/max (1 = fresh, →0 = nearly dead). Damage still shows —
     *  BOTH gradient stops darken toward charred and the fracture network grows
     *  — because that is information the player plays on, not decoration. */
    #drawBrick(x, y, w2, h, baseHex, wear) {
      const ctx = this.#ctx;
      const freshTop = hexRgb(baseHex);
      const pairHex = BRICK_SHADE[baseHex.toUpperCase()];
      const freshBottom = pairHex ? hexRgb(pairHex) : darken(freshTop, 0.62);
      const dmg = 1 - Math.max(0, Math.min(1, wear));
      const toward = dmg * dmg;
      const top = mix(freshTop, BRICK_CHARRED, toward * 0.82);
      const bottom = mix(freshBottom, BRICK_CHARRED, toward * 0.82);
      const gapX = Math.min(BRICK_GAP_X, w2 * 0.18), gapY = Math.min(BRICK_GAP_Y, h * 0.24);
      const rx = x + gapX / 2, ry = y + gapY / 2, rw = w2 - gapX, rh = h - gapY;
      ctx.globalAlpha = 1;
      this.#roundRect(rx, ry, rw, rh, 3);
      const g = ctx.createLinearGradient(rx, ry, rx, ry + rh);
      g.addColorStop(0, rgbStr(top.r, top.g, top.b));
      g.addColorStop(1, rgbStr(bottom.r, bottom.g, bottom.b));
      ctx.fillStyle = g;
      ctx.fill();
      this.#cracks(rx, ry, rw, rh, dmg);
    }
    /** Organic, branching fracture cracks that accumulate as damage rises
     *  (dmg = 1 - wear). Each crack's shape is seeded per brick+index so existing
     *  cracks stay put and only NEW ones appear on each hit (no flicker / reshuffle);
     *  every crack is drawn as a dark fissure with a 1px lit edge so it reads as an
     *  engraved groove rather than a flat scribble. */
    #cracks(rx, ry, rw, rh, dmg) {
      if (dmg <= 0.05 || rw < 6 || rh < 6) return;
      const ctx = this.#ctx;
      const cx = rx + rw / 2, cy = ry + rh / 2;
      const base = Math.floor(rx) * 374761393 ^ Math.floor(ry) * 668265263 | 0;
      const nCracks = Math.max(1, Math.min(5, Math.round(dmg * 4)));
      const span = Math.min(rw, rh);
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let i = 0; i < nCracks; i++) {
        const rnd = rngFrom(base + i * 1013904223 + 1);
        const ang = rnd() * Math.PI * 2;
        const len = span * (0.6 + 0.9 * rnd());
        this.#crackBranch(cx, cy, ang, len, 2, rnd, dmg, rx, ry, rw, rh);
      }
      ctx.restore();
    }
    /** One lightning-shaped crack bolt that recursively forks — "streams out like a
     *  branch". The whole tree depends only on the seeded `rnd`, so a crack stays
     *  put across hits and only its darkness/width grows with damage. */
    #crackBranch(sx, sy, ang, len, depth, rnd, dmg, rx, ry, rw, rh) {
      const segs = 2 + Math.floor(rnd() * 2);
      const pts = [[sx, sy]];
      let px = sx, py = sy, a = ang;
      const step = len / segs;
      for (let s = 0; s < segs; s++) {
        a += (rnd() - 0.5) * 1.15;
        px = Math.max(rx + 1, Math.min(rx + rw - 1, px + Math.cos(a) * step));
        py = Math.max(ry + 1, Math.min(ry + rh - 1, py + Math.sin(a) * step));
        pts.push([px, py]);
      }
      this.#strokeCrack(pts, dmg);
      if (depth <= 0) return;
      const forks = depth >= 2 ? 2 : 1;
      for (let f = 0; f < forks; f++) {
        const p = pts[1 + Math.floor(rnd() * (pts.length - 1))] ?? pts[pts.length - 1];
        const ba = a + (f === 0 ? 1 : -1) * (0.5 + rnd() * 0.7);
        this.#crackBranch(p[0], p[1], ba, len * 0.58, depth - 1, rnd, dmg * 0.9, rx, ry, rw, rh);
      }
    }
    /** Stroke a crack polyline as an engraved groove: a lit far-wall highlight
     *  offset down-right, then the dark fissure on top. */
    #strokeCrack(pts, dmg) {
      if (pts.length < 2) return;
      const ctx = this.#ctx;
      const lw = 0.7 + dmg * 1.1;
      ctx.lineWidth = lw;
      ctx.strokeStyle = `rgba(255,255,255,${0.1 + 0.14 * dmg})`;
      ctx.beginPath();
      ctx.moveTo(pts[0][0] + 0.7, pts[0][1] + 0.7);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] + 0.7, pts[i][1] + 0.7);
      ctx.stroke();
      ctx.strokeStyle = `rgba(6,4,10,${0.5 + 0.4 * dmg})`;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    }
    // The rotating gun: a dashed 120° arc above the bat (the fan the aim can
    // travel) plus a barrel + reticle dot at the current aim — slide the bat to
    // sweep it between the hard stops.
    #gunAim(engine, time) {
      if (!engine.gunActive) return;
      const ctx = this.#ctx;
      const p = engine.paddle;
      const cx = p.x, cy = p.y + p.h / 2;
      const R = 46;
      const a = engine.aimAngle;
      ctx.save();
      ctx.strokeStyle = "rgba(176,123,255,0.35)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.arc(cx, cy, R, GUN_AIM_MIN, GUN_AIM_MAX);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(200,160,255,0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.stroke();
      ctx.strokeStyle = "#d8c2ff";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * 22, cy + Math.sin(a) * 22);
      ctx.stroke();
      if (engine.gunLevel >= 2) {
        ctx.strokeStyle = "rgba(200,160,255,0.45)";
        ctx.lineWidth = 4;
        for (const off of [-GUN_DIAG_SPREAD, GUN_DIAG_SPREAD]) {
          const da = Math.max(GUN_AIM_MIN, Math.min(GUN_AIM_MAX, a + off));
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(da) * 20, cy + Math.sin(da) * 20);
          ctx.stroke();
        }
      }
      const dotR = 4 + Math.sin(time * 8) * 1;
      ctx.fillStyle = "#e9ddff";
      ctx.shadowColor = "rgba(176,123,255,0.9)";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    #paddle(engine, time = 0) {
      const ctx = this.#ctx;
      const p = engine.paddle;
      const x = p.x - p.w / 2;
      if (engine.shielded) {
        const heal = engine.regenShield;
        const frac = engine.shieldHpFrac;
        const flash = engine.shieldFlash;
        const base = hexRgb(heal ? "#43e0a8" : "#7A3CFF");
        const stress = Math.min(1, (1 - frac) * 0.85 + flash * 0.6);
        const c = mix(base, { r: 255, g: 90, b: 70 }, stress);
        const rim = mix(c, { r: 255, g: 255, b: 255 }, 0.45);
        const col = rgbStr(c.r, c.g, c.b), rimCol = rgbStr(rim.r, rim.g, rim.b);
        const pulse = 0.5 + 0.5 * Math.sin(time * 6);
        const cy = p.y + p.h / 2;
        const rx = p.w / 2 + 16, ry = (p.h + 22) * (0.45 + 0.55 * frac);
        ctx.save();
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.ellipse(p.x, cy, rx, ry, 0, Math.PI, Math.PI * 2);
        const bg = ctx.createLinearGradient(p.x, cy - ry, p.x, cy);
        bg.addColorStop(0, `rgba(${Math.round(rim.r)},${Math.round(rim.g)},${Math.round(rim.b)},${0.34 * (0.5 + 0.5 * frac)})`);
        bg.addColorStop(1, `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${0.1 * frac})`);
        ctx.fillStyle = bg;
        ctx.shadowColor = col;
        ctx.shadowBlur = 8 + 16 * flash;
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(p.x, cy, rx, ry, 0, Math.PI, Math.PI * 2);
        ctx.strokeStyle = rimCol;
        ctx.lineWidth = 2 + 1.4 * pulse + flash * 4;
        ctx.globalAlpha = Math.min(1, 0.55 + 0.3 * frac + 0.5 * flash);
        ctx.shadowBlur = 10 + 18 * flash;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.ellipse(p.x, cy, rx * 0.78, ry * 0.78, 0, Math.PI * 1.12, Math.PI * 1.42);
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 2.2;
        ctx.globalAlpha = 0.5 + 0.4 * frac;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.ellipse(p.x, cy, rx, ry, 0, 1.5 * Math.PI - 0.5 * Math.PI * frac, 1.5 * Math.PI + 0.5 * Math.PI * frac);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.6 + flash * 3;
        ctx.globalAlpha = Math.min(1, 0.6 + 0.3 * pulse + 0.5 * flash);
        ctx.shadowColor = rimCol;
        ctx.shadowBlur = 8 + 12 * flash;
        ctx.stroke();
        if (heal) {
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 0.7 * frac;
          ctx.fillStyle = "#caffe8";
          for (let i = 0; i < 3; i++) {
            const sx = p.x + Math.sin(time * 2 + i * 2) * p.w * 0.4;
            const sy = cy - (time * 30 + i * 14) % (ry + 8);
            ctx.beginPath();
            ctx.arc(sx, sy, 1.6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }
      ctx.save();
      if (engine.pinball) {
        this.#flippers(engine);
        ctx.restore();
        return;
      }
      const candle = this.#pulse;
      const r0 = p.h / 2;
      const hpFrac = Math.max(0, Math.min(1, engine.paddleHpFrac));
      const band = hpFrac > 0.5 ? { top: "#bfffd6", mid: "#33e664", bot: "#179a4a" } : hpFrac > 0.25 ? { top: "#ffe7a3", mid: "#f5a82c", bot: "#b9760f" } : { top: "#ffc0c0", mid: "#f24b54", bot: "#9e242e" };
      const glow = hpFrac > 0.5 ? "#33e664" : hpFrac > 0.25 ? "#f5a82c" : "#f24b54";
      this.#roundRect(x, p.y, p.w, p.h, r0);
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = 9;
      ctx.shadowOffsetY = 1.5;
      ctx.fillStyle = "rgba(9,7,17,0.96)";
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      const fw = Math.max(p.h, p.w * hpFrac);
      this.#roundRect(x, p.y, p.w, p.h, r0);
      ctx.save();
      ctx.clip();
      const g = ctx.createLinearGradient(x, p.y, x, p.y + p.h);
      g.addColorStop(0, band.top);
      g.addColorStop(0.5, band.mid);
      g.addColorStop(1, band.bot);
      this.#roundRect(x, p.y, fw, p.h, r0);
      ctx.fillStyle = g;
      ctx.shadowColor = glow;
      ctx.shadowBlur = 8 + 5 * candle;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.5 + 0.3 * candle;
      ctx.fillStyle = band.top;
      ctx.fillRect(Math.min(x + fw - 2.2, x + p.w - 2.2), p.y + 1.5, 2.2, p.h - 3);
      ctx.globalAlpha = 1;
      ctx.globalAlpha = 0.5;
      const sweep = ctx.createLinearGradient(x, p.y, x, p.y + p.h * 0.55);
      sweep.addColorStop(0, "rgba(255,255,255,0.7)");
      sweep.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = sweep;
      this.#roundRect(x + 3, p.y + 1, Math.max(1, fw - 6), p.h * 0.4, p.h / 3);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
      const seamH = p.h * 0.3, seamW = 3.6;
      for (let i = 1; i < 5; i++) {
        const nx = x + p.w * i / 5;
        for (const ny of [p.y + 1.2, p.y + p.h - 1.2 - seamH]) {
          ctx.fillStyle = "rgba(6,4,14,0.5)";
          ctx.fillRect(nx - seamW / 2, ny, seamW, seamH);
          ctx.fillStyle = "rgba(255,255,255,0.16)";
          ctx.fillRect(nx + seamW / 2 - 0.2, ny, 1, seamH);
        }
      }
      this.#roundRect(x, p.y, p.w, p.h, r0);
      this.#inkContour("rgba(6,3,14,0.85)", 1.3);
      const hf = engine.paddleHitFlashFrac;
      if (hf > 0) {
        ctx.save();
        ctx.globalAlpha = 0.55 * hf;
        ctx.shadowColor = "#FF3B6A";
        ctx.shadowBlur = 15 * hf;
        this.#roundRect(x, p.y, p.w, p.h, r0);
        ctx.fillStyle = "#FF4D6A";
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
    /** Draw the two pinball flippers from the engine's raise state, sliding with the bat. */
    #flippers(engine) {
      const fy = engine.paddle.y + FLIP_Y_OFF;
      const cxp = engine.flipperCenterX;
      const la = FLIP_REST + (FLIP_UP - FLIP_REST) * engine.flipLeftRaise;
      const ra = Math.PI - FLIP_REST + (Math.PI - FLIP_UP - (Math.PI - FLIP_REST)) * engine.flipRightRaise;
      this.#flipper(cxp - FLIP_PIVOT_DX, fy, la, engine.flipLeftRaise);
      this.#flipper(cxp + FLIP_PIVOT_DX, fy, ra, engine.flipRightRaise);
    }
    /** One chrome flipper: a tapered bar from pivot to tip, glowing when raised. */
    #flipper(px, py, ang, raise) {
      const ctx = this.#ctx;
      const tx = px + Math.cos(ang) * FLIP_LEN, ty = py + Math.sin(ang) * FLIP_LEN;
      ctx.save();
      ctx.lineCap = "round";
      ctx.shadowColor = `rgba(140,158,255,${0.45 + 0.5 * raise})`;
      ctx.shadowBlur = 9 + 9 * raise;
      const g = ctx.createLinearGradient(px, py, tx, ty);
      g.addColorStop(0, "#f0f4ff");
      g.addColorStop(0.5, "#aeb9ff");
      g.addColorStop(1, "#6b7cff");
      ctx.strokeStyle = g;
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.strokeStyle = "#6b7cff";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo((px + tx) / 2, (py + ty) / 2);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ffe9a8";
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#8a6d2a";
      ctx.beginPath();
      ctx.arc(px, py, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    /** The beam power: a charging glow on the paddle middle, then a violet column
     *  flash up the screen on release. */
    #beam(engine) {
      const ctx = this.#ctx;
      const py = engine.paddle.y;
      const flash = engine.beamFlashFrac;
      if (flash > 0) {
        const bx = engine.beamX;
        const w2 = 5 + 9 * flash;
        ctx.save();
        ctx.globalAlpha = flash;
        ctx.shadowColor = "#9d5cff";
        ctx.shadowBlur = 18;
        const g = ctx.createLinearGradient(bx - w2, 0, bx + w2, 0);
        g.addColorStop(0, "rgba(157,92,255,0)");
        g.addColorStop(0.5, "#ece0ff");
        g.addColorStop(1, "rgba(157,92,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(bx - w2, 0, w2 * 2, py);
        ctx.restore();
      } else if (engine.beamShots > 0) {
        const bx = engine.paddle.x;
        const c = engine.beamChargeFrac;
        ctx.save();
        ctx.globalAlpha = 0.5 + 0.5 * c;
        ctx.shadowColor = "#9d5cff";
        ctx.shadowBlur = 6 + 16 * c;
        ctx.fillStyle = "#c9a8ff";
        ctx.beginPath();
        ctx.arc(bx, py - 2, 2 + 5 * c, 0, Math.PI * 2);
        ctx.fill();
        if (c > 0.6) {
          const h = py * ((c - 0.6) / 0.4);
          ctx.globalAlpha = (c - 0.6) / 0.4 * 0.45;
          ctx.fillStyle = "#9d5cff";
          ctx.fillRect(bx - 1.5, py - h, 3, h);
        }
        ctx.restore();
      }
    }
    #darken(hex) {
      const n = parseInt(hex.slice(1), 16);
      return `rgb(${Math.floor((n >> 16 & 255) * 0.45)},${Math.floor((n >> 8 & 255) * 0.45)},${Math.floor((n & 255) * 0.45)})`;
    }
    /** Draw the random handful of pinball props — discs, targets, slings, fields, bars. */
    #pinballProps(props, time) {
      const ctx = this.#ctx;
      for (const p of props) {
        const s = PROP_STYLE[p.kind];
        if (!s) continue;
        const fl = p.flash;
        ctx.save();
        ctx.shadowColor = s.c;
        ctx.shadowBlur = 6 + 12 * fl;
        if (s.shape === "disc") {
          const g = ctx.createRadialGradient(p.x - 3, p.y - 3, 1, p.x, p.y, p.r);
          g.addColorStop(0, "#ffffff");
          g.addColorStop(0.45, s.c);
          g.addColorStop(1, this.#darken(s.c));
          ctx.fillStyle = p.kind === "jackpot" && !p.lit ? "rgba(110,100,40,0.7)" : g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * (1 + 0.12 * fl), 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = "rgba(0,0,0,0.3)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          if (p.kind === "extraball" && p.hp <= 0) {
          }
          if (s.label) {
            ctx.fillStyle = "#10131f";
            ctx.font = "800 11px system-ui,sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(s.label, p.x, p.y + 0.5);
          }
        } else if (s.shape === "ring") {
          ctx.strokeStyle = s.c;
          ctx.lineWidth = 3 + 2 * fl;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 0.3;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * (0.5 + 0.3 * Math.sin(time * 4)), 0, Math.PI * 2);
          ctx.stroke();
        } else if (s.shape === "target") {
          if ((p.kind === "drop" || p.kind === "bank") && p.hp <= 0) {
            ctx.restore();
            continue;
          }
          this.#roundRect(p.x - p.r, p.y - 7, p.r * 2, 14, 4);
          const g = ctx.createLinearGradient(p.x, p.y - 7, p.x, p.y + 7);
          g.addColorStop(0, fl > 0.3 ? "#fff" : s.c);
          g.addColorStop(1, this.#darken(s.c));
          ctx.fillStyle = g;
          ctx.fill();
          if (p.kind === "bank") {
            ctx.shadowBlur = 0;
            for (let i = 0; i < 3; i++) {
              ctx.fillStyle = i < p.hp ? "#10131f" : "rgba(255,255,255,0.4)";
              ctx.beginPath();
              ctx.arc(p.x - 8 + i * 8, p.y, 1.6, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        } else if (s.shape === "slingL" || s.shape === "slingR") {
          const dir = s.shape === "slingL" ? 1 : -1;
          ctx.fillStyle = fl > 0.3 ? "#fff" : s.c;
          ctx.beginPath();
          ctx.moveTo(p.x - dir * p.r, p.y + p.r);
          ctx.lineTo(p.x + dir * p.r, p.y);
          ctx.lineTo(p.x - dir * p.r, p.y - p.r);
          ctx.closePath();
          ctx.fill();
        } else if (s.shape === "field") {
          ctx.globalAlpha = 0.16 + 0.22 * fl;
          const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, p.r);
          g.addColorStop(0, s.c);
          g.addColorStop(1, s.c + "00");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 0.8;
          ctx.fillStyle = s.c;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fill();
        } else if (s.shape === "spinner") {
          const a = time * (2 + 12 * fl);
          ctx.strokeStyle = s.c;
          ctx.lineWidth = 3;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(p.x - Math.cos(a) * p.r, p.y - Math.sin(a) * 4);
          ctx.lineTo(p.x + Math.cos(a) * p.r, p.y + Math.sin(a) * 4);
          ctx.stroke();
        } else if (s.shape === "gate") {
          ctx.strokeStyle = s.c;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(p.x - p.r, p.y);
          ctx.lineTo(p.x + p.r, p.y);
          ctx.stroke();
          ctx.fillStyle = s.c;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - 6);
          ctx.lineTo(p.x - 4, p.y - 1);
          ctx.lineTo(p.x + 4, p.y - 1);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.strokeStyle = p.lit ? "#fff" : s.c;
          ctx.lineWidth = p.lit ? 4 : 2.5;
          ctx.globalAlpha = p.lit ? 1 : 0.6;
          ctx.beginPath();
          ctx.moveTo(p.x - p.r, p.y);
          ctx.lineTo(p.x + p.r, p.y);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    #bumpers(bumpers, time) {
      if (!bumpers.length) return;
      const ctx = this.#ctx;
      for (const bm of bumpers) {
        ctx.save();
        const pulse = 0.6 + 0.4 * Math.sin(time * 4);
        const glow = Math.max(pulse, bm.flash);
        ctx.shadowColor = "#8c9eff";
        ctx.shadowBlur = 12 + bm.flash * 18;
        ctx.lineWidth = 3;
        ctx.strokeStyle = `rgba(140,158,255,${0.5 + 0.5 * glow})`;
        ctx.beginPath();
        ctx.arc(bm.x, bm.y, bm.r, 0, Math.PI * 2);
        ctx.stroke();
        const g = ctx.createRadialGradient(bm.x, bm.y - 3, 2, bm.x, bm.y, bm.r * 0.7);
        g.addColorStop(0, "#ffffff");
        g.addColorStop(0.5, "#a9b4ff");
        g.addColorStop(1, "#5a6cff");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bm.x, bm.y, bm.r * 0.62, 0, Math.PI * 2);
        ctx.fill();
        if (bm.flash > 0) {
          ctx.globalAlpha = bm.flash;
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(bm.x, bm.y, bm.r + (1 - bm.flash) * 10, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    /** O oscillate readout: a pulsing weave halo + a short afterimage trail (tracing
     *  the sine path) around a ball, in the stack-coded `color`. The hue escalates with
     *  the stack count and the glow/trail grow brighter and longer, so each new stack
     *  visibly changes state — while the hero ball keeps its white core. Additive, so it
     *  reads as energy riding the weave, not a recolour of the ball. */
    #oscillationAura(ball, stacks, color, time) {
      const ctx = this.#ctx;
      const sp = Math.hypot(ball.vx, ball.vy);
      const intensity = Math.min(1, 0.32 + stacks * 0.13);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      if (sp > 1) {
        const dx = ball.vx / sp, dy = ball.vy / sp;
        const tail = Math.min(6, 2 + stacks);
        ctx.fillStyle = color;
        for (let i = 1; i <= tail; i++) {
          const bx = ball.x - dx * i * ball.r * 1.15, by = ball.y - dy * i * ball.r * 1.15;
          ctx.globalAlpha = intensity * 0.5 / i;
          ctx.beginPath();
          ctx.arc(bx, by, ball.r * Math.max(0.2, 1 - i * 0.12), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      const pulse = 0.5 + 0.5 * Math.sin(time * (5 + Math.min(stacks, 4) * 1.2));
      ctx.globalAlpha = intensity * (0.45 + 0.35 * pulse);
      ctx.shadowColor = color;
      ctx.shadowBlur = 6 + stacks * 2;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4 + stacks * 0.4;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r + 2.5 + stacks * 0.6 + pulse * 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    #ball(ball, time, fiery = false, pierce = false, finale = false, scramble = false, index = 0) {
      const ctx = this.#ctx;
      if (fiery) this.#ballFire(ball, time);
      if (pierce) this.#ballPhase(ball, time);
      else if (finale) this.#windTrail(ball);
      ctx.save();
      const speed = Math.hypot(ball.vx, ball.vy);
      const sq = Math.max(0, Math.min(0.22, (speed / 450 - 1) * 0.18));
      if (sq > 1e-3) {
        const dir = Math.atan2(ball.vy, ball.vx);
        ctx.translate(ball.x, ball.y);
        ctx.rotate(dir);
        ctx.scale(1 + sq, 1 - sq * 0.7);
        ctx.translate(-ball.x, -ball.y);
      }
      const scrambleCol = scramble ? this.#scrambleColor(index, time) : null;
      let base;
      if (scrambleCol) {
        this.#neon(scrambleCol, 6, 7);
      } else if (ball.primary) {
        this.#neon("#FFFFFF", 10, 8);
        ctx.shadowColor = pierce ? "rgba(216,230,255,0.95)" : "rgba(255,255,255,0.95)";
      } else {
        this.#neon(ball.color, 6, 7);
      }
      if (scrambleCol) {
        base = scrambleCol;
        const sg = ctx.createRadialGradient(ball.x - ball.r * 0.35, ball.y - ball.r * 0.4, ball.r * 0.1, ball.x, ball.y, ball.r);
        sg.addColorStop(0, "#ffffff");
        sg.addColorStop(0.38, base);
        sg.addColorStop(1, this.#darken(base));
        ctx.fillStyle = sg;
      } else if (ball.primary && !pierce) {
        const g = ctx.createRadialGradient(ball.x - 1, ball.y - 1, 0.5, ball.x, ball.y, ball.r);
        g.addColorStop(0, "#FFFFFF");
        g.addColorStop(0.55, "#F2F6FF");
        g.addColorStop(1, "#CBD6E8");
        ctx.fillStyle = g;
        base = "#FFFFFF";
      } else {
        base = pierce ? "#eef4ff" : ball.color;
        const sg = ctx.createRadialGradient(ball.x - ball.r * 0.35, ball.y - ball.r * 0.4, ball.r * 0.1, ball.x, ball.y, ball.r);
        sg.addColorStop(0, "#ffffff");
        sg.addColorStop(0.38, base);
        sg.addColorStop(1, this.#darken(base));
        ctx.fillStyle = sg;
      }
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
      this.#inkContour(ball.primary && !scrambleCol ? "rgba(200,210,230,0.5)" : this.#darken(base), 1.4);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.beginPath();
      ctx.arc(ball.x - ball.r * 0.32, ball.y - ball.r * 0.36, ball.r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    /** ? scramble: a vivid palette hue for ball `index`, re-rolled ~5×/second (the
     *  `bucket`) and decorrelated per ball via a sin-hash — so every ball keeps
     *  flickering through random colours and you can't pick yours out by colour. */
    #scrambleColor(index, time) {
      const bucket = Math.floor(time * 5);
      const hash = Math.abs(Math.sin(index * 12.9898 + bucket * 78.233)) * 43758.5453;
      return SCRAMBLE_PALETTE[Math.floor(hash) % SCRAMBLE_PALETTE.length];
    }
    /** Pierce active: a ghostly icy halo with two offset afterimages, reading as the
     *  ball phasing THROUGH matter. */
    #ballPhase(ball, time) {
      const ctx = this.#ctx;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const dir = Math.atan2(ball.vy, ball.vx);
      for (let i = 1; i <= 2; i++) {
        const bx = ball.x - Math.cos(dir) * i * ball.r * 1.1, by = ball.y - Math.sin(dir) * i * ball.r * 1.1;
        ctx.globalAlpha = 0.28 / i;
        ctx.fillStyle = "#bcd4ff";
        ctx.beginPath();
        ctx.arc(bx, by, ball.r * (1 - i * 0.12), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(time * 10);
      ctx.strokeStyle = "#d8e6ff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    /** Frenzy wind trail: fading afterimages + thin speed-lines streaking behind a
     *  doubled-speed ball, in its own glow hue. Additive so it reads as wind/motion. */
    #windTrail(ball) {
      const ctx = this.#ctx;
      const sp = Math.hypot(ball.vx, ball.vy);
      if (sp < 1) return;
      const dx = ball.vx / sp, dy = ball.vy / sp;
      const col = ball.primary ? "#9BFFB8" : ball.color;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 1; i <= 4; i++) {
        const bx = ball.x - dx * i * ball.r * 1.25, by = ball.y - dy * i * ball.r * 1.25;
        ctx.globalAlpha = 0.34 / i;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(bx, by, ball.r * (1 - i * 0.16), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = ball.primary ? "rgba(190,255,210,0.85)" : col;
      ctx.lineWidth = 1.3;
      ctx.lineCap = "round";
      const nx = -dy, ny = dx, len = ball.r * 4.5;
      for (const k of [-1, 0, 1]) {
        const ox = nx * k * ball.r * 0.55, oy = ny * k * ball.r * 0.55;
        ctx.beginPath();
        ctx.moveTo(ball.x + ox - dx * ball.r, ball.y + oy - dy * ball.r);
        ctx.lineTo(ball.x + ox - dx * (ball.r + len), ball.y + oy - dy * (ball.r + len));
        ctx.stroke();
      }
      ctx.restore();
    }
    /** A flaming halo + a few flickering tongues around a ball — drawn additively so
     *  the balls visibly burn while a dynamite crate is on the field. */
    #ballFire(ball, time) {
      const ctx = this.#ctx;
      const f = 0.6 + 0.4 * Math.sin(time * 22 + ball.x * 0.3);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(ball.x, ball.y, 0, ball.x, ball.y, ball.r * 2.6);
      g.addColorStop(0, `rgba(255,214,96,${0.7 * f})`);
      g.addColorStop(0.5, `rgba(255,110,30,${0.4 * f})`);
      g.addColorStop(1, "rgba(255,60,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r * 2.6, 0, Math.PI * 2);
      ctx.fill();
      for (let i = -1; i <= 1; i++) {
        const fl = 0.5 + 0.5 * Math.sin(time * 26 + i * 2 + ball.x);
        const fx = ball.x + i * ball.r * 0.6;
        const fy = ball.y - ball.r - 2 - (1 + fl) * 3;
        ctx.fillStyle = `rgba(255,${150 + Math.floor(70 * fl)},50,${0.45 * f})`;
        ctx.beginPath();
        ctx.ellipse(fx, fy, ball.r * 0.42, ball.r * (0.7 + 0.5 * fl), 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    /** The ball & chain: a beaded chain from the white ball to a spiked steel
     *  wrecking ball swinging on the end. */
    #ballChain(engine, time) {
      const c = engine.chainBall;
      if (!c) return;
      const p = engine.balls.find((b) => b.primary);
      if (!p) return;
      const ctx = this.#ctx;
      const dx = c.x - p.x, dy = c.y - p.y, d = Math.hypot(dx, dy) || 1;
      ctx.save();
      ctx.strokeStyle = "rgba(150,155,165,0.7)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(c.x, c.y);
      ctx.stroke();
      const links = Math.max(3, Math.floor(d / 7));
      for (let i = 1; i < links; i++) {
        const t = i / links, lx = p.x + dx * t, ly = p.y + dy * t;
        ctx.fillStyle = i % 2 ? "#b6bbc4" : "#71757e";
        ctx.beginPath();
        ctx.arc(lx, ly, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#5a5f68";
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2 + time * 0.6;
        ctx.beginPath();
        ctx.moveTo(c.x + Math.cos(a) * 13, c.y + Math.sin(a) * 13);
        ctx.lineTo(c.x + Math.cos(a - 0.2) * 8, c.y + Math.sin(a - 0.2) * 8);
        ctx.lineTo(c.x + Math.cos(a + 0.2) * 8, c.y + Math.sin(a + 0.2) * 8);
        ctx.closePath();
        ctx.fill();
      }
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 6;
      const g = ctx.createRadialGradient(c.x - 3, c.y - 3, 1, c.x, c.y, 10);
      g.addColorStop(0, "#dfe3ea");
      g.addColorStop(0.5, "#9aa0aa");
      g.addColorStop(1, "#4a4f58");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    /** Clock freeze: a cool blue wash over the field + frost spikes on frozen white balls. */
    #freeze(engine, time) {
      const ctx = this.#ctx;
      ctx.save();
      ctx.fillStyle = "rgba(126,224,255,0.08)";
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(190,235,255,0.9)";
      ctx.lineWidth = 1.5;
      ctx.shadowColor = "#7ee0ff";
      ctx.shadowBlur = 8;
      for (const b of engine.balls) {
        if (!b.primary) continue;
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * Math.PI * 2 + time * 0.5;
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x + Math.cos(a) * (b.r + 5), b.y + Math.sin(a) * (b.r + 5));
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    /** The time-clock pickup: a cyan clock face with sweeping hands. */
    #clockCapsule(x, y, time) {
      const ctx = this.#ctx;
      ctx.save();
      ctx.shadowColor = "#7ee0ff";
      ctx.shadowBlur = 10;
      const g = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, 10);
      g.addColorStop(0, "#eaffff");
      g.addColorStop(0.6, "#7ee0ff");
      g.addColorStop(1, "#2a8fb0");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#0b3a4a";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(11,58,74,0.7)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * 7.5, y + Math.sin(a) * 7.5);
        ctx.lineTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9);
        ctx.stroke();
      }
      ctx.strokeStyle = "#0b2a36";
      ctx.lineWidth = 1.6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(time * 1.2) * 6, y + Math.sin(time * 1.2) * 6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(time * 0.4) * 4, y + Math.sin(time * 0.4) * 4);
      ctx.stroke();
      ctx.restore();
    }
    /** The gold paper-crane jackpot prize — a folded origami crane that flutters down. */
    #paperCrane(x, y, time) {
      const ctx = this.#ctx;
      const flap = Math.sin(time * 7);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(time * 2.2) * 0.12);
      ctx.shadowColor = "#ffcf3a";
      ctx.shadowBlur = 16;
      const gold = ctx.createLinearGradient(-18, -14, 18, 14);
      gold.addColorStop(0, "#fff3b0");
      gold.addColorStop(0.5, "#ffd24a");
      gold.addColorStop(1, "#e0a516");
      ctx.fillStyle = "#e0a516";
      ctx.beginPath();
      ctx.moveTo(-2, -1);
      ctx.lineTo(-20, -10 - 6 * flap);
      ctx.lineTo(-4, 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = gold;
      ctx.beginPath();
      ctx.moveTo(-2, 0);
      ctx.lineTo(-16, -2);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(2, -5);
      ctx.lineTo(8, 1);
      ctx.lineTo(1, 6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#ffd24a";
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(5, -2);
      ctx.lineTo(15, -12);
      ctx.stroke();
      ctx.fillStyle = "#ffe98a";
      ctx.beginPath();
      ctx.moveTo(15, -12);
      ctx.lineTo(21, -12);
      ctx.lineTo(15, -8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = gold;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(18, -12 - 8 * flap);
      ctx.lineTo(6, 4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(140,90,10,0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(12, -8 - 5 * flap);
      ctx.stroke();
      ctx.restore();
      const sp = 0.5 + 0.5 * Math.sin(time * 5);
      ctx.save();
      ctx.globalAlpha = sp;
      ctx.fillStyle = "#fffbe0";
      ctx.beginPath();
      ctx.arc(x + 16, y - 12, 1.6 + sp, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    #capsules(capsules, time) {
      const ctx = this.#ctx;
      for (const cap of capsules) {
        const meta = POWER_META[cap.kind];
        const pulse = 0.5 + 0.5 * Math.sin(time * 6 + cap.x * 0.3);
        ctx.save();
        const aura = ctx.createRadialGradient(cap.x, cap.y, 2, cap.x, cap.y, 15 + 4 * pulse);
        aura.addColorStop(0, meta.color + "55");
        aura.addColorStop(1, meta.color + "00");
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(cap.x, cap.y, 15 + 4 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        const wob = Math.sin(time * 3.2 + cap.x * 0.12);
        const tilt = wob * 0.1;
        const dx = cap.x + wob * 2.2, dy = cap.y + Math.sin(time * 4.6 + cap.x * 0.12) * 1.3;
        if (cap.kind === "oscillate" || cap.kind === "beam") {
          this.#mushroom(dx, dy, meta.color, tilt);
          continue;
        }
        if (cap.kind === "clock") {
          this.#clockCapsule(cap.x, cap.y, time);
          continue;
        }
        if (cap.kind === "crane") {
          this.#paperCrane(cap.x, cap.y, time);
          continue;
        }
        if (cap.kind === "extralife") {
          this.#lifeCapsule(dx, dy, tilt, time);
          continue;
        }
        const w2 = 32, h = 17, r = h / 2;
        ctx.save();
        ctx.translate(dx, dy);
        ctx.rotate(tilt);
        const lx = -w2 / 2, ly = -h / 2;
        const cbase = hexRgb(meta.color);
        const lite = mix(cbase, { r: 255, g: 255, b: 255 }, 0.55);
        const deep = darken(cbase, 0.62);
        const ink = this.#darken(meta.color);
        ctx.shadowColor = meta.color;
        ctx.shadowBlur = 14;
        this.#roundRect(lx, ly, w2, h, r);
        const g = ctx.createLinearGradient(0, ly, 0, ly + h);
        g.addColorStop(0, rgbStr(lite.r, lite.g, lite.b));
        g.addColorStop(0.45, rgbStr(cbase.r, cbase.g, cbase.b));
        g.addColorStop(1, rgbStr(deep.r, deep.g, deep.b));
        ctx.fillStyle = g;
        ctx.fill();
        ctx.shadowBlur = 0;
        this.#roundRect(lx + 0.5, ly + 0.5, w2 - 1, h - 1, r - 0.5);
        this.#inkContour(ink, 2);
        ctx.beginPath();
        ctx.ellipse(0, ly + h * 0.3, w2 * 0.36, h * 0.24, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(-w2 * 0.26, ly + h * 0.28, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fill();
        ctx.font = '800 12px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        ctx.strokeStyle = ink;
        ctx.lineWidth = 3;
        ctx.strokeText(meta.letter, 0, 1);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(meta.letter, 0, 1);
        ctx.restore();
      }
      void time;
    }
    /** The oscillate pickup, drawn as a magic mushroom: a spotted dome cap in the
     *  power colour over a cream stem. */
    #mushroom(cx, cy, color, tilt = 0) {
      const ctx = this.#ctx;
      const base = hexRgb(color);
      const lite = mix(base, { r: 255, g: 255, b: 255 }, 0.5);
      const deep = darken(base, 0.55);
      const ink = this.#darken(color);
      const squash = 1 + tilt * 0.6;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(tilt * 0.5);
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      const sg = ctx.createLinearGradient(-5, 0, 5, 0);
      sg.addColorStop(0, "#fff6e2");
      sg.addColorStop(0.5, "#fbe7c6");
      sg.addColorStop(1, "#e7c79a");
      this.#roundRect(-5, -1, 10, 13, 4);
      ctx.fillStyle = sg;
      ctx.fill();
      ctx.shadowBlur = 0;
      this.#roundRect(-5, -1, 10, 13, 4);
      this.#inkContour(ink, 1.6);
      this.#roundRect(-3.6, 0.5, 2.2, 10, 1.1);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fill();
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.ellipse(0, 0, 14, 12 * squash, 0, Math.PI, 2 * Math.PI);
      ctx.closePath();
      const dg = ctx.createLinearGradient(0, -12 * squash, 0, 0);
      dg.addColorStop(0, rgbStr(lite.r, lite.g, lite.b));
      dg.addColorStop(0.5, rgbStr(base.r, base.g, base.b));
      dg.addColorStop(1, rgbStr(deep.r, deep.g, deep.b));
      ctx.fillStyle = dg;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.ellipse(0, 0, 14, 12 * squash, 0, Math.PI, 2 * Math.PI);
      ctx.closePath();
      this.#inkContour(ink, 2);
      ctx.beginPath();
      ctx.ellipse(-2, -7 * squash, 7, 3.4, -0.25, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fill();
      this.#roundRect(-13, -2.5, 26, 3, 1.5);
      ctx.fillStyle = rgbStr(deep.r, deep.g, deep.b);
      ctx.globalAlpha = 0.5;
      ctx.fill();
      ctx.globalAlpha = 1;
      for (const [sx, sy, sr] of [[-7, -6, 2.6], [4, -7.5, 2.1], [9, -3, 1.6], [-1, -3, 2.3], [6, -1.5, 1.3]]) {
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fillStyle = "#fffaf0";
        ctx.fill();
        this.#inkContour("rgba(120,90,50,0.45)", 0.8);
        ctx.beginPath();
        ctx.arc(sx - sr * 0.35, sy - sr * 0.35, sr * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fill();
      }
      ctx.restore();
    }
    /** The 1-UP / extra-life pill: a glossy green cartoon heart reading "1UP". */
    #lifeCapsule(cx, cy, tilt, time) {
      const ctx = this.#ctx;
      const green = hexRgb("#5fe08a");
      const lite = mix(green, { r: 255, g: 255, b: 255 }, 0.5);
      const deep = darken(green, 0.55);
      const ink = this.#darken("#2f9e5a");
      const beat = 1 + 0.06 * Math.sin(time * 6);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(tilt);
      const drawHeart = (s) => {
        const yo = -3;
        ctx.beginPath();
        ctx.moveTo(0, yo + 9 * s);
        ctx.bezierCurveTo(-11 * s, yo - 1 * s, -10 * s, yo - 11 * s, 0, yo - 4 * s);
        ctx.bezierCurveTo(10 * s, yo - 11 * s, 11 * s, yo - 1 * s, 0, yo + 9 * s);
        ctx.closePath();
      };
      ctx.shadowColor = "#5fe08a";
      ctx.shadowBlur = 14;
      drawHeart(beat);
      const g = ctx.createLinearGradient(0, -14, 0, 10);
      g.addColorStop(0, rgbStr(lite.r, lite.g, lite.b));
      g.addColorStop(0.5, rgbStr(green.r, green.g, green.b));
      g.addColorStop(1, rgbStr(deep.r, deep.g, deep.b));
      ctx.fillStyle = g;
      ctx.fill();
      ctx.shadowBlur = 0;
      drawHeart(beat);
      this.#inkContour(ink, 2.2);
      ctx.beginPath();
      ctx.ellipse(-4.5 * beat, -7 * beat, 3.6, 2.4, -0.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(4 * beat, -6 * beat, 1.3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fill();
      ctx.rotate(-tilt * 0.3);
      const bw = 26, bh = 11, bx = -bw / 2, by = 1;
      this.#roundRect(bx, by, bw, bh, bh / 2);
      const bg = ctx.createLinearGradient(0, by, 0, by + bh);
      bg.addColorStop(0, "#ffd0e0");
      bg.addColorStop(0.5, "#ff7eb0");
      bg.addColorStop(1, "#e0457f");
      ctx.fillStyle = bg;
      ctx.fill();
      this.#roundRect(bx, by, bw, bh, bh / 2);
      this.#inkContour(this.#darken("#c83a72"), 1.6);
      this.#roundRect(bx + 2, by + 1.4, bw - 4, bh * 0.34, bh / 4);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fill();
      ctx.font = '900 9px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.strokeStyle = this.#darken("#c83a72");
      ctx.lineWidth = 2.5;
      ctx.strokeText("1UP", 0, by + bh / 2 + 0.5);
      ctx.fillStyle = "#ffffff";
      ctx.fillText("1UP", 0, by + bh / 2 + 0.5);
      ctx.restore();
    }
    /** The growing plasma orb at the bat muzzle while the fire input is HELD, plus the
     *  white launch-kick ring on release. Colour escalates with the charge tier. */
    #chargeOrb(engine, time) {
      const ctx = this.#ctx;
      const mx = engine.paddle.x, my = engine.paddle.y - 8;
      const f = engine.laserChargeFrac;
      if (engine.laserCharging && engine.laserShots > 0 && f > 1e-3) {
        const tier = engine.laserTier;
        const baseHex = tier >= 3 ? "#ff6bd5" : tier >= 2 ? "#ffb14e" : "#7ec8ff";
        const base = hexRgb(baseHex);
        const R = (4 + 11 * f) * (1 + 0.12 * Math.sin(time * 22));
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.shadowColor = baseHex;
        ctx.shadowBlur = 10 + 26 * f;
        const g = ctx.createRadialGradient(mx, my, 0, mx, my, R * 2.2);
        g.addColorStop(0, `rgba(255,255,255,${0.4 + 0.5 * f})`);
        g.addColorStop(0.35, rgbStr(base.r, base.g, base.b));
        g.addColorStop(1, `rgba(${Math.round(base.r)},${Math.round(base.g)},${Math.round(base.b)},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(mx, my, R * 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = `rgba(255,255,255,${0.6 + 0.4 * f})`;
        ctx.beginPath();
        ctx.arc(mx, my, R * 0.55, 0, Math.PI * 2);
        ctx.fill();
        const bolts = 3 + Math.round(f * 4);
        ctx.strokeStyle = rgbStr(Math.min(255, base.r + 60), Math.min(255, base.g + 60), Math.min(255, base.b + 60));
        ctx.lineWidth = 1.2;
        for (let k = 0; k < bolts; k++) {
          const a = -Math.PI / 2 + (k / bolts - 0.5) * Math.PI * 1.1 + Math.sin(time * 18 + k) * 0.3;
          const len = R * (1.4 + 1.2 * f) * (0.6 + 0.4 * Math.abs(Math.sin(time * 30 + k * 2)));
          ctx.beginPath();
          ctx.moveTo(mx, my);
          for (let s = 1; s <= 3; s++) {
            const t2 = s / 3;
            ctx.lineTo(mx + Math.cos(a) * len * t2 + Math.sin(time * 50 + k + s) * 3 * f, my + Math.sin(a) * len * t2 + Math.cos(time * 47 + k + s) * 3 * f);
          }
          ctx.stroke();
        }
        if (f > 0.5) {
          ctx.globalAlpha = (f - 0.5) * 2;
          ctx.fillStyle = "rgba(255,255,255,0.7)";
          for (let k = 0; k < 6; k++) {
            const a = time * 6 + k * Math.PI / 3, rr = R * (2.4 - 1.8 * ((time * 1.5 + k) % 1));
            ctx.beginPath();
            ctx.arc(mx + Math.cos(a) * rr, my + Math.sin(a) * rr, 1.4, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
        ctx.restore();
      }
      const mf = engine.laserMuzzleFrac;
      if (mf > 0) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = mf;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2 + 3 * mf;
        ctx.beginPath();
        ctx.arc(mx, my, 6 + 22 * (1 - mf), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    /** Each in-flight fireball: a comet tail + motion streaks + a spinning white-hot
     *  plasma orb with swirl arms and crackling energy bolts. The Hadouken. */
    #fireballs(fbs, time) {
      if (!fbs.length) return;
      const ctx = this.#ctx;
      for (const fb of fbs) {
        const tier = fb.tier;
        const baseHex = tier >= 3 ? "#ff6bd5" : tier >= 2 ? "#ffb14e" : "#7ec8ff";
        const rimHex = tier >= 3 ? "#5fd0e0" : tier >= 2 ? "#ffe24e" : "#bfe3ff";
        const base = hexRgb(baseHex), rim = hexRgb(rimHex);
        const x = fb.x, y = fb.y, R = fb.r, tailLen = fb.tail;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const tg = ctx.createLinearGradient(x, y, x, y + tailLen);
        tg.addColorStop(0, rgbStr(base.r, base.g, base.b));
        tg.addColorStop(0.5, `rgba(${Math.round(base.r)},${Math.round(base.g)},${Math.round(base.b)},0.35)`);
        tg.addColorStop(1, `rgba(${Math.round(base.r)},${Math.round(base.g)},${Math.round(base.b)},0)`);
        ctx.fillStyle = tg;
        ctx.beginPath();
        ctx.moveTo(x - R * 0.7, y);
        ctx.quadraticCurveTo(x, y + tailLen * 0.6, x, y + tailLen);
        ctx.quadraticCurveTo(x, y + tailLen * 0.6, x + R * 0.7, y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = rgbStr(rim.r, rim.g, rim.b);
        ctx.lineWidth = 1;
        for (let k = 0; k < 3; k++) {
          const off = Math.sin(time * 40 + k * 2 + fb.t * 30) * R * 0.5;
          ctx.globalAlpha = 0.4;
          ctx.beginPath();
          ctx.moveTo(x + off, y);
          ctx.lineTo(x + off * 0.3, y + tailLen * (0.5 + 0.2 * k));
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - R * 0.5, y + 2);
        ctx.lineTo(x - R * 0.5, y + tailLen * 0.4);
        ctx.moveTo(x + R * 0.5, y + 2);
        ctx.lineTo(x + R * 0.5, y + tailLen * 0.4);
        ctx.stroke();
        ctx.shadowColor = baseHex;
        ctx.shadowBlur = 14 + tier * 6;
        const og = ctx.createRadialGradient(x, y, 0, x, y, R * 1.4);
        og.addColorStop(0, "#ffffff");
        og.addColorStop(0.3, "#ffffff");
        og.addColorStop(0.55, rgbStr(rim.r, rim.g, rim.b));
        og.addColorStop(0.8, rgbStr(base.r, base.g, base.b));
        og.addColorStop(1, `rgba(${Math.round(base.r)},${Math.round(base.g)},${Math.round(base.b)},0)`);
        ctx.fillStyle = og;
        ctx.beginPath();
        ctx.arc(x, y, R * 1.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(fb.spin);
        ctx.strokeStyle = rgbStr(Math.min(255, rim.r + 40), Math.min(255, rim.g + 40), Math.min(255, rim.b + 40));
        ctx.lineWidth = R * 0.35;
        ctx.globalAlpha = 0.6;
        for (let a = 0; a < 2; a++) {
          ctx.beginPath();
          ctx.arc(0, 0, R * 0.7, a * Math.PI, a * Math.PI + Math.PI * 0.7);
          ctx.stroke();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
        const bolts = 2 + tier * 2;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        for (let k = 0; k < bolts; k++) {
          const a = fb.spin * 2 + k * (Math.PI * 2 / bolts);
          const len = R * (0.8 + 0.6 * Math.abs(Math.sin(time * 35 + k)));
          ctx.globalAlpha = 0.7;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * R * 0.9 + x, Math.sin(a) * R * 0.9 + y);
          ctx.lineTo(Math.cos(a) * (R * 0.9 + len) + x + Math.sin(time * 60 + k * 3) * 3, Math.sin(a) * (R * 0.9 + len) + y + Math.cos(time * 57 + k * 3) * 3);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    }
    #rockets(rockets) {
      if (!rockets.length) return;
      const ctx = this.#ctx;
      for (const rk of rockets) {
        ctx.save();
        ctx.shadowColor = "#ff7043";
        ctx.shadowBlur = 10;
        ctx.fillStyle = "#ffcf5e";
        ctx.beginPath();
        ctx.moveTo(rk.x - 3, rk.y + 6);
        ctx.lineTo(rk.x + 3, rk.y + 6);
        ctx.lineTo(rk.x, rk.y + 13);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#ff7043";
        ctx.beginPath();
        ctx.moveTo(rk.x, rk.y - 9);
        ctx.lineTo(rk.x + 4, rk.y + 6);
        ctx.lineTo(rk.x - 4, rk.y + 6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
    // ── The SCENE (sky, scenery, atmosphere) is a pluggable THEME now — see theme.ts +
    //    themes/. draw() resolves the active theme and delegates background + atmosphere. ──
    /** Dispatch the enemy draw by kind — ten distinct silhouettes. */
    #enemy(enemy, target, time) {
      switch (enemy.kind) {
        case "bomber":
          return this.#enemyBomber(enemy, time);
        case "splitter":
          return this.#enemySplitter(enemy, time);
        case "leech":
          return this.#enemyLeech(enemy, time);
        case "mirror":
          return this.#enemyMirror(enemy, time);
        case "orbit":
          return this.#enemyOrbit(enemy, time);
        case "dart":
          return this.#enemyDart(enemy, time);
        case "blink":
          return this.#enemyBlink(enemy, time);
        case "polarity":
          return this.#enemyPolarity(enemy, time);
        case "queen":
          return this.#enemyQueen(enemy, time);
        default:
          return this.#enemyHunter(enemy, target, time);
      }
    }
    /** Hunter (variant 0): the spiked homing bug — the archetype the others vary from. */
    #enemyHunter(enemy, target, time) {
      const ctx = this.#ctx;
      const { x, y, hp } = enemy;
      const V = ENEMY_LOOKS[(enemy.variant % ENEMY_LOOKS.length + ENEMY_LOOKS.length) % ENEMY_LOOKS.length];
      const r = ENEMY_R;
      const pulse = 0.5 + 0.5 * Math.sin(time * 3);
      const dmg = 1 - hp / 3;
      let lx = 0, ly = 0.5;
      if (target) {
        const dx = target.x - x, dy = target.y - y, d = Math.hypot(dx, dy) || 1;
        lx = dx / d;
        ly = dy / d;
      }
      ctx.save();
      const aura = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 2.5);
      aura.addColorStop(0, `rgba(${V.aura},${0.22 + 0.16 * pulse + 0.18 * dmg})`);
      aura.addColorStop(1, `rgba(${V.aura},0)`);
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(x, y, r * 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineCap = "round";
      for (const s of [-1, 1]) {
        const base = -Math.PI / 2 + s * 0.5, sway = Math.sin(time * 2 + s) * 0.13;
        const bx2 = x + Math.cos(base) * (r - 2), by2 = y + Math.sin(base) * (r - 2);
        const tx = x + Math.cos(base + sway) * (r + 11), ty = y + Math.sin(base + sway) * (r + 11);
        ctx.strokeStyle = V.dark;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(bx2, by2);
        ctx.quadraticCurveTo((bx2 + tx) / 2 + s * 3, (by2 + ty) / 2, tx, ty);
        ctx.stroke();
        ctx.fillStyle = V.accent;
        ctx.shadowColor = V.accent;
        ctx.shadowBlur = 7;
        ctx.beginPath();
        ctx.arc(tx, ty, 1.7 + pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      const open = 0.32 + 0.26 * (0.5 + 0.5 * Math.sin(time * 4));
      for (const s of [-1, 1]) {
        const a = Math.PI / 2 + s * open, baseR = r - 1, tipR = r + 10;
        const nx = Math.cos(a + Math.PI / 2), ny = Math.sin(a + Math.PI / 2);
        const tipx = x + Math.cos(a - s * 0.18) * tipR, tipy = y + Math.sin(a - s * 0.18) * tipR;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * baseR + nx * 2.6, y + Math.sin(a) * baseR + ny * 2.6);
        ctx.quadraticCurveTo(x + Math.cos(a) * (baseR + 5) + nx * 1.6, y + Math.sin(a) * (baseR + 5) + ny * 1.6, tipx, tipy);
        ctx.quadraticCurveTo(x + Math.cos(a) * (baseR + 5) - nx * 1.6, y + Math.sin(a) * (baseR + 5) - ny * 1.6, x + Math.cos(a) * baseR - nx * 2.6, y + Math.sin(a) * baseR - ny * 2.6);
        ctx.closePath();
        ctx.fillStyle = V.mid;
        ctx.fill();
        ctx.fillStyle = V.accent;
        ctx.beginPath();
        ctx.arc(tipx, tipy, 1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowColor = `rgba(${V.aura},0.55)`;
      ctx.shadowBlur = 12;
      const spikes = V.spikes;
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const ang = i / (spikes * 2) * Math.PI * 2 + time * 0.5;
        const rr = i % 2 === 0 ? r + 4 : r - 0.5;
        const px = x + Math.cos(ang) * rr, py = y + Math.sin(ang) * rr;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      const shell = ctx.createLinearGradient(x, y - r, x, y + r);
      shell.addColorStop(0, V.top);
      shell.addColorStop(0.5, V.mid);
      shell.addColorStop(1, V.bot);
      ctx.fillStyle = shell;
      ctx.fill();
      ctx.shadowBlur = 0;
      for (let i = 0; i < 3; i++) {
        const a0 = -Math.PI / 2 - 0.72 + i / 3 * 1.44;
        const lost = i >= hp;
        ctx.strokeStyle = lost ? "rgba(20,10,14,0.9)" : V.accent;
        ctx.lineWidth = lost ? 2.6 : 2;
        ctx.beginPath();
        ctx.arc(x, y, r - 1.5, a0, a0 + 0.42);
        ctx.stroke();
        if (lost) {
          const sa = a0 + 0.21, sx = x + Math.cos(sa) * (r - 1.5), sy = y + Math.sin(sa) * (r - 1.5);
          ctx.fillStyle = `rgba(255,220,120,${0.35 + 0.6 * pulse})`;
          ctx.beginPath();
          ctx.arc(sx, sy, 1.1 + pulse, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      const bezel = ctx.createRadialGradient(x - 2, y - 3, 1, x, y, r - 1);
      bezel.addColorStop(0, V.bot);
      bezel.addColorStop(1, "#160208");
      ctx.fillStyle = bezel;
      ctx.beginPath();
      ctx.arc(x, y, r - 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = V.dark;
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2 + time * 0.5;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * (r - 4), y + Math.sin(a) * (r - 4), 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
      const er = r * 0.62;
      const socket = ctx.createRadialGradient(x, y, 1, x, y, er);
      socket.addColorStop(0, "#ffffff");
      socket.addColorStop(0.45, V.eye);
      socket.addColorStop(1, V.bot);
      ctx.fillStyle = socket;
      ctx.shadowColor = V.accent;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(x, y, er, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(0,0,0,0.32)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, er * 0.78, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, er * 0.55, 0, Math.PI * 2);
      ctx.stroke();
      const pxe = x + lx * er * 0.32, pye = y + ly * er * 0.32;
      ctx.fillStyle = "#0a0205";
      ctx.beginPath();
      ctx.ellipse(pxe, pye, er * 0.22, er * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(pxe - er * 0.17, pye - er * 0.28, er * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      const bx = x + lx * er * 0.32, by = y + ly * er * 0.32 - er * 0.9;
      ctx.strokeStyle = V.dark;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(bx - er * 0.5, by - er * 0.18);
      ctx.lineTo(bx, by + er * 0.12);
      ctx.lineTo(bx + er * 0.5, by - er * 0.18);
      ctx.stroke();
      ctx.restore();
    }
    /** Shared soft aura behind the simpler enemy silhouettes. */
    #enemyAura(x, y, rgb, time, k = 2.2) {
      const ctx = this.#ctx, p = this.#pulse;
      void time;
      const g = ctx.createRadialGradient(x, y, ENEMY_R * 0.5, x, y, ENEMY_R * k);
      g.addColorStop(0, `rgba(${rgb},${0.18 + 0.12 * p})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, ENEMY_R * k, 0, Math.PI * 2);
      ctx.fill();
    }
    #diamond(x, y, r) {
      const ctx = this.#ctx;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.8, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r * 0.8, y);
      ctx.closePath();
    }
    /** Bombardier — an amber mortar dome that strafes a high lane and drops bombs. */
    #enemyBomber(e, time) {
      const ctx = this.#ctx, x = e.x, y = e.y + Math.sin(time * 2 + x * 0.1) * 1.5;
      const fuse = 1 - Math.min(1, (e.cd ?? 1.8) / 1.8);
      this.#enemyAura(x, y, "255,150,40", time);
      ctx.save();
      for (const s of [-1, 1]) {
        ctx.fillStyle = "#7a3a0f";
        ctx.beginPath();
        ctx.moveTo(x + s * 14, y - 4);
        ctx.lineTo(x + s * 22, y - 9);
        ctx.lineTo(x + s * 16, y + 3);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = `rgba(255,150,60,${0.5 + 0.4 * fuse})`;
        ctx.shadowColor = "#ff9f43";
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(x + s * 19, y - 5, 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.shadowColor = "#e2731a";
      ctx.shadowBlur = 10;
      const g = ctx.createLinearGradient(x, y - 12, x, y + 12);
      g.addColorStop(0, "#ffd29a");
      g.addColorStop(0.4, "#e2731a");
      g.addColorStop(1, "#6e3410");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, 17, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(90,42,12,0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(x, y, 12, 7.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#5a2a0c";
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.arc(x + i * 6, y - 5, 1, 0, Math.PI * 2);
        ctx.fill();
      }
      const eg = ctx.createRadialGradient(x, y - 1, 0.5, x, y - 1, 4.5);
      eg.addColorStop(0, "#fff6d8");
      eg.addColorStop(0.6, "#ffb43c");
      eg.addColorStop(1, "#7a3a0f");
      ctx.fillStyle = eg;
      ctx.shadowColor = "#ffd24a";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(x, y - 1, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3a1808";
      ctx.beginPath();
      ctx.arc(x, y + 0.5, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(255,180,60,${0.35 + 0.6 * fuse})`;
      ctx.shadowColor = "#ffb43c";
      ctx.shadowBlur = 4 + 12 * fuse;
      ctx.beginPath();
      ctx.arc(x, y + 9, 4 + 1.8 * fuse, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    /** Mitosis Pod — a blue-green dividing cell that drifts and splits when hit. */
    #enemySplitter(e, time) {
      const ctx = this.#ctx, sep = (e.split ?? 0) > 0 ? 6 : 1.5;
      const seam = 0.5 + 0.5 * Math.sin(time * 5), breathe = 1 + 0.05 * Math.sin(time * 3);
      this.#enemyAura(e.x, e.y, "70,200,140", time, 1.9);
      ctx.save();
      for (const s of [-1, 1]) {
        const cx = e.x + s * sep, r = 11 * breathe;
        ctx.strokeStyle = "rgba(120,224,170,0.55)";
        ctx.lineWidth = 1;
        for (let i = 0; i < 9; i++) {
          const a = i / 9 * Math.PI * 2 + time * 0.6;
          const wob = 2 + Math.sin(time * 5 + i) * 1.5;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * r, e.y + Math.sin(a) * r);
          ctx.lineTo(cx + Math.cos(a) * (r + wob), e.y + Math.sin(a) * (r + wob));
          ctx.stroke();
        }
        const g = ctx.createRadialGradient(cx - 3, e.y - 4, 1, cx, e.y, r);
        g.addColorStop(0, "#9ff2c2");
        g.addColorStop(0.55, "#3a9d6e");
        g.addColorStop(1, "#0d4e35");
        ctx.fillStyle = g;
        ctx.shadowColor = "rgba(95,224,138,0.5)";
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(cx, e.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(200,255,224,0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, e.y, r - 1.5, -2.2, 0.4);
        ctx.stroke();
        ctx.fillStyle = `rgba(190,255,212,${0.5 + 0.4 * seam})`;
        ctx.shadowColor = "#bfffd8";
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(cx + s * 1.5, e.y, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        const lean = s * (0.6 + 0.18 * sep);
        ctx.fillStyle = "#f2fff8";
        ctx.beginPath();
        ctx.arc(cx, e.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#0d2e1e";
        ctx.beginPath();
        ctx.arc(cx + lean, e.y - 0.4, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = `rgba(180,255,210,${0.4 + 0.5 * seam})`;
      ctx.lineWidth = 1.6;
      ctx.shadowColor = "#bfffd8";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(e.x, e.y - 11);
      ctx.lineTo(e.x, e.y + 11);
      ctx.stroke();
      ctx.restore();
    }
    /** Leech Swooper — a magenta winged stingray that vacuums falling pills. */
    #enemyLeech(e, time) {
      const ctx = this.#ctx, x = e.x, y = e.y;
      const flap = Math.sin((e.t ?? 0) * 6), gold = (e.flash ?? 0) > 0;
      const main = gold ? "#ffd24a" : "#ff5bbf", lite = gold ? "#fff0b0" : "#ffaee0";
      this.#enemyAura(x, y, gold ? "255,210,74" : "255,90,200", time, 1.8);
      ctx.save();
      for (const s of [-1, 1]) {
        const tipY = y - 10 - 6 * flap;
        const wg = ctx.createLinearGradient(x, y, x + s * 24, tipY);
        wg.addColorStop(0, main);
        wg.addColorStop(1, gold ? "#ffe98a" : "#ff8fd6");
        ctx.fillStyle = wg;
        ctx.shadowColor = main;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + s * 16, tipY, x + s * 24, y + 2);
        ctx.quadraticCurveTo(x + s * 14, y + 4, x, y + 3);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = gold ? "rgba(255,255,255,0.5)" : "rgba(255,200,235,0.55)";
        ctx.lineWidth = 0.8;
        for (const f of [0.4, 0.7]) {
          ctx.beginPath();
          ctx.moveTo(x, y + 1);
          ctx.quadraticCurveTo(x + s * 14 * f, (tipY + y) / 2, x + s * 22 * f, y + 1);
          ctx.stroke();
        }
      }
      ctx.fillStyle = lite;
      ctx.beginPath();
      ctx.ellipse(x, y, 5, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = gold ? "#a06a10" : "#7a1050";
      ctx.beginPath();
      ctx.arc(x, y - 3, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(x - 0.6, y - 3.6, 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = lite;
      ctx.lineWidth = 1.4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, y + 8);
      ctx.quadraticCurveTo(x + flap * 4, y + 13, x + flap * 6, y + 18);
      ctx.stroke();
      ctx.fillStyle = main;
      ctx.beginPath();
      ctx.arc(x + flap * 6, y + 18, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    /** Mirror Sentinel — a chrome obelisk that mirrors the bat and beams its column. */
    #enemyMirror(e, time) {
      const ctx = this.#ctx, x = e.x, y = e.y, w2 = 11, h = 22;
      const fire = e.flash ?? 0;
      this.#enemyAura(x, y, "192,198,214", time, 1.6);
      ctx.save();
      ctx.shadowColor = "#dfe7ff";
      ctx.shadowBlur = 8;
      const g = ctx.createLinearGradient(x - w2, y, x + w2, y);
      g.addColorStop(0, "#474d5e");
      g.addColorStop(0.35, "#cfd6e6");
      g.addColorStop(0.5, "#f6f9ff");
      g.addColorStop(0.65, "#cfd6e6");
      g.addColorStop(1, "#474d5e");
      this.#roundRect(x - w2 / 2, y - h / 2, w2, h, 3);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#aeb6c8";
      this.#roundRect(x - w2 / 2, y - h / 2, w2, 3, 1.5);
      ctx.fill();
      this.#roundRect(x - w2 / 2, y + h / 2 - 3, w2, 3, 1.5);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 1.5, y - h / 2 + 3);
      ctx.lineTo(x - 1.5, y + h / 2 - 3);
      ctx.stroke();
      ctx.strokeStyle = "rgba(120,140,180,0.5)";
      ctx.beginPath();
      ctx.moveTo(x + 2.5, y - h / 2 + 3);
      ctx.lineTo(x + 2.5, y + h / 2 - 3);
      ctx.stroke();
      const ey = y + Math.sin(time * 3) * (h / 2 - 4);
      ctx.fillStyle = `rgba(120,220,255,${0.6 + 0.4 * fire})`;
      ctx.shadowColor = "#7ee0ff";
      ctx.shadowBlur = 6;
      this.#roundRect(x - w2 / 2 + 1, ey - 1.5, w2 - 2, 3, 1.5);
      ctx.fill();
      ctx.shadowBlur = 0;
      const scan = Math.sin(time * 1.6) * (w2 * 0.18);
      ctx.fillStyle = "#eaf6ff";
      ctx.beginPath();
      ctx.arc(x, ey, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#16202e";
      ctx.beginPath();
      ctx.ellipse(x + scan, ey, 0.9, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      if (fire > 0) {
        ctx.fillStyle = `rgba(150,230,255,${fire})`;
        ctx.shadowColor = "#7ee0ff";
        ctx.shadowBlur = 10 * fire;
        ctx.beginPath();
        ctx.arc(x, y + h / 2, 3 * fire, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    /** Orbit Sentinel — a green core with two orbiting satellites that deflect shots. */
    #enemyOrbit(e, time) {
      const ctx = this.#ctx, x = e.x, y = e.y, t = e.t ?? 0;
      this.#enemyAura(x, y, "200,255,74", time, 1.8);
      ctx.save();
      ctx.strokeStyle = "rgba(200,255,74,0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(200,255,74,0.12)";
      ctx.beginPath();
      ctx.ellipse(x, y, 14, 6, t, 0, Math.PI * 2);
      ctx.stroke();
      const beat = 1 + 0.12 * Math.sin(time * 5);
      const g = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, 10 * beat);
      g.addColorStop(0, "#fbffd0");
      g.addColorStop(0.6, "#cfff4a");
      g.addColorStop(1, "#5a7008");
      ctx.fillStyle = g;
      ctx.shadowColor = "#cfff4a";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(x, y, 9 * beat, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      for (const k of [0, 1]) {
        const a = t * 2 + k * Math.PI, sx = x + Math.cos(a) * 14, sy = y + Math.sin(a) * 14;
        ctx.strokeStyle = "rgba(220,255,140,0.4)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(sx, sy);
        ctx.stroke();
        ctx.fillStyle = "#f4ffc0";
        ctx.shadowColor = "#cfff4a";
        ctx.shadowBlur = 7;
        ctx.beginPath();
        ctx.arc(sx, sy, 3.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.restore();
    }
    /** Dart Diver — a red delta that patrols then commits a straight plunge. */
    #enemyDart(e, time) {
      const ctx = this.#ctx, x = e.x, y = e.y;
      const tilt = e.phase === "patrol" && (e.cd ?? 1) < 0.4 ? 0.18 : 0;
      const diving = e.phase === "dive";
      this.#enemyAura(x, y, "255,90,60", time, 1.7);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(tilt);
      const fl = (diving ? 1 : 0.4) * (0.7 + 0.3 * Math.sin(time * 30));
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = (0.5 - i * 0.13) * fl;
        ctx.fillStyle = i === 0 ? "#fff0c0" : "#ff7043";
        ctx.beginPath();
        ctx.ellipse(0, -12 - i * (4 + 8 * fl), 3 - i * 0.7, 5 + i * 5 * fl, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.shadowColor = "#ff5b3a";
      ctx.shadowBlur = 8;
      const g = ctx.createLinearGradient(0, -14, 0, 12);
      g.addColorStop(0, "#ffd08a");
      g.addColorStop(0.5, "#ff5b3a");
      g.addColorStop(1, "#6e1606");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, 14);
      ctx.lineTo(-11, -12);
      ctx.lineTo(0, -6);
      ctx.lineTo(11, -12);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,220,180,0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 14);
      ctx.lineTo(-11, -12);
      ctx.moveTo(0, 14);
      ctx.lineTo(11, -12);
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.shadowColor = "#fff";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(0, 12, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    /** Blink Imp — a violet tetrahedron that teleport-stalks with a glitch halo. */
    #enemyBlink(e, time) {
      const ctx = this.#ctx, x = e.x, y = e.y;
      const charge = e.phase === "idle" ? 1 - Math.min(1, (e.cd ?? 1.4) / 1.4) : 0;
      if (e.ghostX !== void 0 && (e.flash ?? 0) > 0) {
        ctx.save();
        ctx.globalAlpha = (e.flash ?? 0) * 0.4;
        ctx.fillStyle = "#a86bff";
        this.#diamond(e.ghostX, e.ghostY ?? y, 12);
        ctx.fill();
        ctx.restore();
      }
      if (e.phase === "out") return;
      this.#enemyAura(x, y, "168,107,255", time, 1.6);
      ctx.save();
      ctx.fillStyle = "rgba(200,150,255,0.5)";
      for (let i = 0; i < 5; i++) {
        const a = time * 4 + i * 1.3, rr = 16 + Math.sin(time * 9 + i) * 4;
        const fx = x + Math.cos(a) * rr, fy = y + Math.sin(a) * rr;
        ctx.fillRect(fx - 1.4, fy - 1.4, 2.8, 2.8);
      }
      ctx.strokeStyle = `rgba(200,150,255,${0.4 + 0.5 * charge})`;
      ctx.lineWidth = 2;
      ctx.shadowColor = "#a86bff";
      ctx.shadowBlur = 8 + 12 * charge;
      ctx.beginPath();
      ctx.arc(x, y, 18 - 8 * charge, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      const off = 1.5 + Math.sin(time * 11) * 0.8;
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = "#ff5bd0";
      this.#diamond(x - off, y, 13);
      ctx.fill();
      ctx.fillStyle = "#5bd0ff";
      this.#diamond(x + off, y, 13);
      ctx.fill();
      ctx.globalAlpha = 1;
      const g = ctx.createLinearGradient(x, y - 12, x, y + 12);
      g.addColorStop(0, "#d2a8ff");
      g.addColorStop(1, "#4a2390");
      ctx.fillStyle = g;
      this.#diamond(x, y, 13);
      ctx.fill();
      ctx.fillStyle = "#1a0a30";
      this.#diamond(x, y, 5);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.shadowColor = "#e0c8ff";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    /** Polarity Knight — a hex split blue|red; only the matching damage type hurts it. */
    #enemyPolarity(e, time) {
      const ctx = this.#ctx, x = e.x, y = e.y, r = 15, red = e.polarity === "red";
      const acc = red ? "#ff4a4a" : "#3a7dff";
      this.#enemyAura(x, y, red ? "255,74,74" : "58,125,255", time, 1.7);
      ctx.save();
      const hexPath = () => {
        ctx.beginPath();
        for (let i = 0; i <= 6; i++) {
          const a = -Math.PI / 2 + i * Math.PI / 3;
          const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
      };
      hexPath();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = red ? "#1f4488" : "#3a7dff";
      ctx.fillRect(x - r, y - r, r, r * 2);
      ctx.fillStyle = red ? "#ff4a4a" : "#882a2a";
      ctx.fillRect(x, y - r, r, r * 2);
      ctx.strokeStyle = `rgba(255,255,255,${0.5 + 0.4 * Math.sin(time * 20)})`;
      ctx.lineWidth = 1.2;
      ctx.shadowColor = acc;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      for (let yy = -r + 3; yy < r; yy += 4) ctx.lineTo(x + Math.sin(yy * 1.7 + time * 18) * 2, y + yy);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
      hexPath();
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(time * 1.5);
      ctx.fillStyle = acc;
      ctx.shadowColor = acc;
      ctx.shadowBlur = 12;
      this.#diamond(0, 0, 5);
      ctx.fill();
      ctx.restore();
      ctx.shadowBlur = 0;
      if ((e.flash ?? 0) > 0) {
        ctx.strokeStyle = `rgba(255,255,255,${e.flash})`;
        ctx.lineWidth = 2;
        ctx.shadowColor = "#fff";
        ctx.shadowBlur = 8 * (e.flash ?? 0);
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    /** Hive Queen — the bloated boss-mother; her egg-sac glows before each broodling. */
    #enemyQueen(e, time) {
      const ctx = this.#ctx, x = e.x, y = e.y, r = 22;
      const birth = 1 - Math.min(1, (e.cd ?? 4) / 4);
      if (e.brood) {
        ctx.save();
        ctx.fillStyle = "#ff5b6e";
        ctx.shadowColor = "#ff5b6e";
        ctx.shadowBlur = 5;
        for (const m of e.brood) {
          ctx.beginPath();
          ctx.moveTo(m.x, m.y - 4);
          ctx.lineTo(m.x + 3, m.y + 3);
          ctx.lineTo(m.x - 3, m.y + 3);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
      this.#enemyAura(x, y, "255,40,60", time, 2.4);
      ctx.save();
      ctx.strokeStyle = "#7a0f1e";
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      for (const s of [-1, 1]) for (const k of [0, 1, 2]) {
        const a = Math.PI / 2 + s * (0.35 + k * 0.42), tw = Math.sin(time * 6 + k + (s > 0 ? 1.5 : 0)) * 3;
        const kx = x + Math.cos(a) * (r * 0.7 + 5), ky = y + Math.sin(a) * (r * 0.5 + 4);
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6);
        ctx.lineTo(kx, ky);
        ctx.lineTo(kx + Math.cos(a) * 8, ky + Math.sin(a) * 8 + tw);
        ctx.stroke();
      }
      ctx.shadowColor = "#c41e3a";
      ctx.shadowBlur = 12;
      const g = ctx.createRadialGradient(x - 4, y - 6, 2, x, y + 4, r);
      g.addColorStop(0, "#f06078");
      g.addColorStop(0.55, "#c41e3a");
      g.addColorStop(1, "#600d1a");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y + 3, r * 0.8, r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(110,15,26,0.6)";
      ctx.lineWidth = 1;
      for (const f of [0.35, 0.62, 0.85]) {
        ctx.beginPath();
        ctx.ellipse(x, y + 3, r * 0.8 * (1 - f * 0.15), r * f, 0, 0.5, Math.PI - 0.5);
        ctx.stroke();
      }
      const sg = ctx.createRadialGradient(x, y + 10, 1, x, y + 10, 9 + 2 * birth);
      sg.addColorStop(0, `rgba(255,235,160,${0.5 + 0.5 * birth})`);
      sg.addColorStop(1, "rgba(255,180,60,0)");
      ctx.fillStyle = sg;
      ctx.shadowColor = "#ffd24a";
      ctx.shadowBlur = 4 + 14 * birth;
      ctx.beginPath();
      ctx.arc(x, y + 10, 8 + 2 * birth, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(255,210,120,${0.6 + 0.4 * birth})`;
      for (const o of [[-3, 8], [3, 9], [0, 12], [-2, 13]]) {
        ctx.beginPath();
        ctx.arc(x + o[0], y + o[1], 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#8a1226";
      ctx.beginPath();
      ctx.arc(x, y - r * 0.6, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#5a0a16";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      for (const s of [-1, 1]) {
        const m = 0.3 + birth * 0.4;
        ctx.beginPath();
        ctx.moveTo(x + s * 5, y - r * 0.6 + 4);
        ctx.quadraticCurveTo(x + s * (9 + m * 4), y - r * 0.6 + 8, x + s * (5 + m * 6), y - r * 0.6 + 12);
        ctx.stroke();
      }
      ctx.fillStyle = "#ffd24a";
      ctx.shadowColor = "#ffd24a";
      ctx.shadowBlur = 5;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(x + s * 3.2, y - r * 0.6, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    /** Pac-Man — a chomping yellow rival that eats your colour balls. Faces its
     *  travel direction; HP pips float above; turns translucent as it leaves, full. */
    #pacman(p, time) {
      const ctx = this.#ctx;
      const R = 14;
      const open = 0.06 + 0.34 * (0.5 + 0.5 * Math.sin(p.mouth));
      const facing = p.dir >= 0 ? 0 : Math.PI;
      ctx.save();
      if (p.leaving) ctx.globalAlpha = 0.5;
      ctx.shadowColor = "rgba(255,224,74,0.6)";
      ctx.shadowBlur = 12;
      const g = ctx.createRadialGradient(p.x - 3, p.y - 3, 2, p.x, p.y, R);
      g.addColorStop(0, "#fff3a8");
      g.addColorStop(0.6, "#ffd24a");
      g.addColorStop(1, "#e0a01a");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.arc(p.x, p.y, R, facing + open, facing - open + Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      const ex = p.x + Math.cos(facing - 1.15) * R * 0.42, ey = p.y + Math.sin(facing - 1.15) * R * 0.42;
      ctx.fillStyle = "#221a00";
      ctx.beginPath();
      ctx.arc(ex, ey, 1.9, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i < p.hp ? "#7ee0ff" : "rgba(80,90,110,0.5)";
        ctx.beginPath();
        ctx.arc(p.x - 6 + i * 6, p.y - R - 6, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    /** The alien SHIP — a glowing UFO saucer with a glass dome and underside
     *  lights. Shoot it (ball/laser/beam/rocket) and it drops a power-up. */
    /** The top pill-dispenser — one of a rotating cast of cartoon critters. */
    #alien(a, time) {
      switch (a.kind) {
        case "bee":
          return this.#dispBee(a, time);
        case "crab":
          return this.#dispCrab(a, time);
        case "ghost":
          return this.#dispGhost(a, time);
        case "chick":
          return this.#dispChick(a, time);
        default:
          return this.#dispFrog(a, time);
      }
    }
    /** The hopping FROG — hop phase from a.frame; squashes flat on landing, stretches
     *  tall at apex. Unified ink-contour cartoon. */
    #dispFrog(a, time) {
      void time;
      const ctx = this.#ctx;
      const x = a.x, y = a.y, hw = ALIEN_W / 2;
      const ph = a.frame % FROG_HOP_PERIOD / FROG_HOP_PERIOD;
      const airborne = ph < FROG_AIR_FRAC;
      const lift = airborne ? Math.sin(ph / FROG_AIR_FRAC * Math.PI) : 0;
      const land = airborne ? 0 : 1 - (ph - FROG_AIR_FRAC) / (1 - FROG_AIR_FRAC);
      const sx = 1 + 0.22 * land - 0.12 * lift;
      const sy = 1 - 0.2 * land + 0.14 * lift;
      const dir = Math.sign(a.vx) || 1;
      const bw = 24, bh = 22;
      ctx.save();
      const groundY = 33;
      ctx.fillStyle = `rgba(10,30,12,${0.3 * (1 - 0.6 * lift)})`;
      ctx.beginPath();
      ctx.ellipse(x, groundY, hw * (1 - 0.35 * lift), 3.2 * (1 - 0.35 * lift), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(x, y);
      ctx.scale(sx, sy);
      const legExt = lift;
      ctx.fillStyle = FROG_BODY_MID;
      for (const s of [-1, 1]) {
        const hipX = s * bw * 0.42, hipY = bh * 0.3;
        const footX = hipX + s * (3 + 9 * legExt), footY = hipY + (5 + 9 * legExt);
        const leg = () => {
          ctx.beginPath();
          ctx.moveTo(hipX, hipY - 3);
          ctx.quadraticCurveTo(hipX + s * 7, hipY + 2, footX, footY);
          ctx.quadraticCurveTo(footX + s * 5, footY + 1, footX + s * 8, footY - 1);
          ctx.quadraticCurveTo(footX + s * 4, footY + 3, footX, footY + 2);
          ctx.quadraticCurveTo(hipX + s * 4, hipY + 5, hipX, hipY + 2);
          ctx.closePath();
        };
        leg();
        ctx.fillStyle = FROG_BODY_MID;
        ctx.fill();
        leg();
        this.#inkContour(FROG_INK, 1.4);
      }
      ctx.shadowColor = "rgba(63,209,58,0.5)";
      ctx.shadowBlur = 9;
      const body = ctx.createLinearGradient(0, -bh * 0.5, 0, bh * 0.5);
      body.addColorStop(0, FROG_BODY_TOP);
      body.addColorStop(0.5, FROG_BODY_MID);
      body.addColorStop(1, FROG_BODY_BOT);
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.ellipse(0, 0, bw * 0.5, bh * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = FROG_BELLY;
      ctx.beginPath();
      ctx.ellipse(0, bh * 0.16, bw * 0.3, bh * 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(-bw * 0.18, -bh * 0.2, bw * 0.12, bh * 0.1, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, bw * 0.5, bh * 0.5, 0, 0, Math.PI * 2);
      this.#inkContour(FROG_INK, 1.7);
      const eyeY = -bh * 0.42, eyeDX = bw * 0.26, eyeR = 5.2;
      for (const s of [-1, 1]) {
        const ex = s * eyeDX;
        ctx.fillStyle = FROG_BODY_MID;
        ctx.beginPath();
        ctx.ellipse(ex, eyeY + 2, eyeR + 1, eyeR + 1, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(ex, eyeY, eyeR, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ex, eyeY, eyeR, 0, Math.PI * 2);
        this.#inkContour(FROG_INK, 1.3);
        const pdx = dir * 1.6;
        ctx.fillStyle = "#0c1410";
        ctx.beginPath();
        ctx.arc(ex + pdx, eyeY + 1, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath();
        ctx.arc(ex + pdx - 0.8, eyeY + 0.2, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      const open = 0.5 + 0.5 * lift;
      ctx.strokeStyle = FROG_INK;
      ctx.lineWidth = 1.8;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-bw * 0.3, bh * 0.02);
      ctx.quadraticCurveTo(0, bh * (0.14 + 0.1 * open), bw * 0.3, bh * 0.02);
      ctx.stroke();
      ctx.fillStyle = FROG_INK;
      ctx.beginPath();
      ctx.arc(-bw * 0.07, -bh * 0.06, 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bw * 0.07, -bh * 0.06, 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = "#ff8fb0";
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(s * bw * 0.3, bh * 0.06, 2.4, 1.6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
    /** The buzzing BUMBLEBEE — an alternate top pill-dispenser. The wiggle phase comes
    *  from a.frame (matching the engine); wings flutter on `time` for a fast blur, the
    *  body banks slightly into its travel, and a faint air-shadow tracks it. Unified
    *  ink-contour cartoon to match the frog. */
    #dispBee(a, time) {
      const ctx = this.#ctx;
      const x = a.x, y = a.y, hw = ALIEN_W / 2;
      const dir = Math.sign(a.vx) || 1;
      const w2 = a.frame * BEE_WIGGLE_HZ * Math.PI * 2;
      const wob = Math.sin(w2);
      const bank = dir * 0.14 + wob * 0.1;
      const flap = Math.sin(time * 42);
      const bw = 26, bh = 18;
      ctx.save();
      const groundY = ALIEN_Y + 16;
      ctx.fillStyle = `rgba(20,16,6,${0.22 - 0.06 * wob})`;
      ctx.beginPath();
      ctx.ellipse(x, groundY, hw * 0.7, 2.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(x, y);
      ctx.rotate(bank);
      ctx.save();
      for (const s of [-1, 1]) {
        const open = 0.62 + 0.38 * Math.abs(flap);
        const wx = s * bw * 0.2, wyTop = -bh * 0.78;
        ctx.save();
        ctx.translate(wx, wyTop);
        ctx.rotate(s * (0.5 - 0.32 * Math.abs(flap)));
        ctx.scale(1, open);
        ctx.fillStyle = `rgba(${BEE_WING},0.18)`;
        ctx.beginPath();
        ctx.ellipse(0, 0, bw * 0.42, bh * 0.62, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${BEE_WING},0.34)`;
        ctx.beginPath();
        ctx.ellipse(0, 0, bw * 0.3, bh * 0.46, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(0, 0, bw * 0.42, bh * 0.62, 0, 0, Math.PI * 2);
        this.#inkContour("rgba(140,170,200,0.55)", 1);
        ctx.globalAlpha = 0.22 * Math.abs(flap);
        ctx.fillStyle = `rgba(${BEE_WING},0.5)`;
        ctx.beginPath();
        ctx.ellipse(0, bh * 0.12 * flap, bw * 0.34, bh * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.restore();
      }
      ctx.restore();
      ctx.strokeStyle = BEE_INK;
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      for (let i = -1; i <= 1; i++) {
        const lx = i * bw * 0.26, ly = bh * 0.44;
        const sway = wob * 1.4 + i * 0.4;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.quadraticCurveTo(lx + sway, ly + 4, lx + sway * 1.6 - dir * 1, ly + 6.5);
        ctx.stroke();
      }
      const tailX = -dir * bw * 0.52;
      ctx.fillStyle = BEE_INK;
      ctx.beginPath();
      ctx.moveTo(tailX, -2.5);
      ctx.lineTo(tailX, 2.5);
      ctx.lineTo(tailX - dir * 6, 0);
      ctx.closePath();
      ctx.fill();
      ctx.shadowColor = "rgba(255,184,31,0.5)";
      ctx.shadowBlur = 9;
      const body = ctx.createLinearGradient(0, -bh * 0.5, 0, bh * 0.5);
      body.addColorStop(0, BEE_BODY_TOP);
      body.addColorStop(0.5, BEE_BODY_MID);
      body.addColorStop(1, BEE_BODY_BOT);
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.ellipse(0, 0, bw * 0.5, bh * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, 0, bw * 0.5, bh * 0.5, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = BEE_STRIPE;
      for (const cx of [-bw * 0.14, bw * 0.16]) {
        ctx.save();
        ctx.translate(cx, 0);
        ctx.rotate(-0.12 + dir * 0.04);
        ctx.beginPath();
        ctx.ellipse(0, 0, bw * 0.085, bh * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
      ctx.strokeStyle = "rgba(255,228,120,0.7)";
      ctx.lineWidth = 1;
      for (let i = -3; i <= 3; i++) {
        const hx = i * bw * 0.12, hy = -Math.sqrt(Math.max(0, 1 - (hx / (bw * 0.5)) ** 2)) * bh * 0.5;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + dir * 0.6, hy - 2.4);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(-bw * 0.16, -bh * 0.22, bw * 0.11, bh * 0.12, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, bw * 0.5, bh * 0.5, 0, 0, Math.PI * 2);
      this.#inkContour(BEE_INK, 1.7);
      const faceX = dir * bw * 0.42;
      ctx.fillStyle = BEE_BODY_TOP;
      ctx.beginPath();
      ctx.ellipse(faceX, -bh * 0.06, bw * 0.18, bh * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(faceX, -bh * 0.06, bw * 0.18, bh * 0.34, 0, 0, Math.PI * 2);
      this.#inkContour(BEE_INK, 1.4);
      const eyeR = 4.6;
      for (const s of [-1, 1]) {
        const ex = faceX + dir * 1, ey = -bh * 0.2 + s * 4.4;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
        this.#inkContour(BEE_INK, 1.3);
        const pdx = dir * 1.5, pdy = wob * 0.8;
        ctx.fillStyle = "#160f06";
        ctx.beginPath();
        ctx.arc(ex + pdx, ey + pdy, 2.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath();
        ctx.arc(ex + pdx - 0.7, ey + pdy - 0.7, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = BEE_INK;
      ctx.lineWidth = 1.4;
      ctx.lineCap = "round";
      for (const s of [-1, 1]) {
        const ax = faceX + dir * 2, ay = -bh * 0.44;
        const tipX = ax + dir * 4 + wob * 1.6, tipY = ay - 6 - s * 1.2;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo(ax + dir * 4, ay - 5, tipX, tipY);
        ctx.stroke();
        ctx.fillStyle = BEE_STRIPE;
        ctx.beginPath();
        ctx.arc(tipX, tipY, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = BEE_INK;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(faceX - 2.4, bh * 0.12);
      ctx.quadraticCurveTo(faceX + dir * 1.2, bh * 0.22, faceX + 2.4, bh * 0.12);
      ctx.stroke();
      ctx.restore();
    }
    /** The scuttling CRAB — an alternate top pill-dispenser. Skitter phase comes
     *  from a.frame; legs pump, claws snap, stalk-eyes wobble. Faces its travel
     *  direction. Unified ink-contour cartoon, matching the frog's quality. */
    #dispCrab(a, time) {
      const ctx = this.#ctx;
      const x = a.x, y = a.y, hw = ALIEN_W / 2;
      const dir = Math.sign(a.vx) || 1;
      const ph = a.frame % SCUTTLE_PERIOD / SCUTTLE_PERIOD;
      const bob = Math.abs(Math.sin(ph * Math.PI * 2));
      const step = Math.sin(ph * Math.PI * 2);
      const lean = dir * 0.1 * Math.cos(ph * Math.PI * 2);
      const snap = 0.5 + 0.5 * Math.sin(ph * Math.PI * 4 + 0.6);
      const bw = 26, bh = 15;
      ctx.save();
      const groundY = 34;
      ctx.fillStyle = `rgba(60,12,10,${0.3 * (1 - 0.5 * bob)})`;
      ctx.beginPath();
      ctx.ellipse(x, groundY, hw * (1 - 0.25 * bob), 3 * (1 - 0.25 * bob), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(x, y);
      ctx.rotate(lean);
      ctx.strokeStyle = CRAB_LIMB;
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const gait = Math.sin(ph * Math.PI * 2 + i * 1.1 + (s > 0 ? Math.PI : 0));
          const hipX = s * (bw * 0.3 + i * 4.5), hipY = bh * 0.18;
          const kneeX = hipX + s * (5 + 1.5 * gait), kneeY = hipY + 4;
          const footX = kneeX + s * 3, footY = hipY + 9 + 1.5 * gait;
          ctx.beginPath();
          ctx.moveTo(hipX, hipY);
          ctx.quadraticCurveTo(kneeX, kneeY, footX, footY);
          ctx.strokeStyle = CRAB_LIMB;
          ctx.stroke();
          ctx.strokeStyle = CRAB_INK;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.lineWidth = 2.2;
        }
      }
      for (const s of [-1, 1]) {
        const lead = s === dir;
        const armX = s * bw * 0.46, armY = -bh * 0.05;
        const cx = armX + s * (7 + 2 * (lead ? 1 : 0)), cy = armY - 3 - 2 * bob;
        const cs = lead ? 5.6 : 4.4;
        ctx.strokeStyle = CRAB_LIMB;
        ctx.lineWidth = 3.2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(armX, armY);
        ctx.quadraticCurveTo(armX + s * 4, armY - 4, cx, cy);
        ctx.stroke();
        ctx.strokeStyle = CRAB_INK;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(armX, armY);
        ctx.quadraticCurveTo(armX + s * 4, armY - 4, cx, cy);
        ctx.stroke();
        const gap = (lead ? 0.9 : 0.6) * snap;
        ctx.fillStyle = CRAB_LIMB;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo(cx + s * cs, cy + cs * 0.5, cx + s * cs * 1.5, cy + cs * 0.2);
        ctx.quadraticCurveTo(cx + s * cs, cy + cs * 0.9, cx, cy + cs * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo(cx + s * cs, cy + cs * 0.5, cx + s * cs * 1.5, cy + cs * 0.2);
        ctx.quadraticCurveTo(cx + s * cs, cy + cs * 0.9, cx, cy + cs * 0.3);
        ctx.closePath();
        this.#inkContour(CRAB_INK, 1.3);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-s * gap);
        ctx.fillStyle = CRAB_LIMB;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(s * cs, -cs * 0.5, s * cs * 1.5, -cs * 0.2);
        ctx.quadraticCurveTo(s * cs, -cs * 0.9, 0, -cs * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(s * cs, -cs * 0.5, s * cs * 1.5, -cs * 0.2);
        ctx.quadraticCurveTo(s * cs, -cs * 0.9, 0, -cs * 0.3);
        ctx.closePath();
        this.#inkContour(CRAB_INK, 1.3);
        ctx.restore();
      }
      ctx.shadowColor = "rgba(242,69,46,0.5)";
      ctx.shadowBlur = 9;
      const shell = ctx.createLinearGradient(0, -bh * 0.7, 0, bh * 0.7);
      shell.addColorStop(0, CRAB_SHELL_TOP);
      shell.addColorStop(0.5, CRAB_SHELL_MID);
      shell.addColorStop(1, CRAB_SHELL_BOT);
      ctx.fillStyle = shell;
      ctx.beginPath();
      ctx.ellipse(0, 0, bw * 0.5, bh * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = CRAB_BELLY;
      ctx.beginPath();
      ctx.ellipse(0, bh * 0.3, bw * 0.4, bh * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(-bw * 0.16, -bh * 0.3, bw * 0.13, bh * 0.16, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = this.#darken(CRAB_SHELL_MID);
      ctx.globalAlpha = 0.35;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(s * bw * 0.24, -bh * 0.05, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(0, bh * 0.1, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, bw * 0.5, bh * 0.62, 0, 0, Math.PI * 2);
      this.#inkContour(CRAB_INK, 1.7);
      const wob = Math.sin(time * 11) * 0.9;
      const eyeBaseY = -bh * 0.55, eyeDX = bw * 0.22, stalkH = 8, eyeR = 3.6;
      for (const s of [-1, 1]) {
        const baseX = s * eyeDX;
        const tipX = baseX + dir * 1.2 + s * wob, tipY = eyeBaseY - stalkH;
        ctx.strokeStyle = CRAB_LIMB;
        ctx.lineWidth = 2.4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(baseX, eyeBaseY);
        ctx.quadraticCurveTo(baseX + s * wob * 0.4, eyeBaseY - stalkH * 0.5, tipX, tipY);
        ctx.stroke();
        ctx.strokeStyle = CRAB_INK;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(baseX, eyeBaseY);
        ctx.quadraticCurveTo(baseX + s * wob * 0.4, eyeBaseY - stalkH * 0.5, tipX, tipY);
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(tipX, tipY, eyeR, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(tipX, tipY, eyeR, 0, Math.PI * 2);
        this.#inkContour(CRAB_INK, 1.2);
        const pdx = dir * 1.4, pdy = 0.6 * step;
        ctx.fillStyle = "#1a0606";
        ctx.beginPath();
        ctx.arc(tipX + pdx, tipY + pdy, 1.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath();
        ctx.arc(tipX + pdx - 0.6, tipY + pdy - 0.6, 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = CRAB_INK;
      ctx.lineWidth = 1.6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-bw * 0.18, bh * 0.2);
      ctx.quadraticCurveTo(0, bh * (0.3 + 0.06 * snap), bw * 0.18, bh * 0.2);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath();
      ctx.arc(-bw * 0.1 + dir, bh * 0.34, 1 * snap, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bw * 0.06 + dir, bh * 0.4, 0.8 * snap, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    /** The floating GHOST — an alternate top pill-dispenser. Float phase comes from
     *  a.frame; a slow sine bob drives a soft vertical drift and a tilt, and the
     *  scalloped tail-hem ripples. Slightly translucent with a faint lilac glow.
     *  Unified ink-contour cartoon, matching the frog. */
    #dispGhost(a, time) {
      const ctx = this.#ctx;
      const x = a.x, y = a.y, hw = ALIEN_W / 2;
      const ph = a.frame / GHOST_BOB_PERIOD * Math.PI * 2;
      const bob = Math.sin(ph);
      const dir = Math.sign(a.vx) || 1;
      const bw = 24, bh = 26;
      const lean = -dir * 0.1 + 0.05 * Math.sin(ph * 1.5);
      const rise = (bob + 1) * 0.5;
      ctx.save();
      ctx.fillStyle = `rgba(40,24,70,${0.2 * (1 - 0.5 * rise)})`;
      ctx.beginPath();
      ctx.ellipse(x, 40, hw * (0.85 - 0.3 * rise), 2.8 * (0.85 - 0.3 * rise), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(x, y);
      ctx.rotate(lean);
      ctx.globalAlpha = 0.85;
      const top = -bh * 0.5, bottom = bh * 0.5, hwx = bw * 0.5;
      const buildBody = () => {
        ctx.beginPath();
        ctx.moveTo(-hwx, bottom * 0.1);
        ctx.arc(0, top + hwx, hwx, Math.PI, 0, false);
        ctx.lineTo(hwx, bottom * 0.1);
        const bumps = 4, span = hwx * 2 / bumps;
        for (let i = 0; i < bumps; i++) {
          const x0 = hwx - i * span;
          const x1 = x0 - span;
          const dip = 5 + 2.2 * Math.sin(time * 5 + i * 1.5 + ph);
          ctx.quadraticCurveTo((x0 + x1) / 2, bottom * 0.1 + dip, x1, bottom * 0.1);
        }
        ctx.closePath();
      };
      ctx.shadowColor = `rgba(201,182,255,0.85)`;
      ctx.shadowBlur = 12;
      const body = ctx.createLinearGradient(0, top, 0, bottom);
      body.addColorStop(0, GHOST_BODY_TOP);
      body.addColorStop(0.45, GHOST_BODY_MID);
      body.addColorStop(1, GHOST_BODY_BOT);
      buildBody();
      ctx.fillStyle = body;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.85 * 0.5;
      ctx.fillStyle = GHOST_BELLY;
      ctx.beginPath();
      ctx.ellipse(-bw * 0.1, bh * 0.04, bw * 0.3, bh * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.85 * 0.7;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(-bw * 0.18, -bh * 0.28, bw * 0.13, bh * 0.11, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.85;
      buildBody();
      this.#inkContour(GHOST_INK, 1.7);
      const eyeY = -bh * 0.16, eyeDX = bw * 0.22, eyeRX = 4.2, eyeRY = 5.4;
      const look = dir * 1.5 + 0.6 * Math.sin(time * 2);
      for (const s of [-1, 1]) {
        const ex = s * eyeDX;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.ellipse(ex, eyeY, eyeRX, eyeRY, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(ex, eyeY, eyeRX, eyeRY, 0, 0, Math.PI * 2);
        this.#inkContour(GHOST_INK, 1.2);
        ctx.fillStyle = "#2A1E45";
        ctx.beginPath();
        ctx.arc(ex + look, eyeY + 1.4, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.beginPath();
        ctx.arc(ex + look - 0.9, eyeY + 0.4, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
      const oo = 2.6 + 1.4 * rise;
      ctx.fillStyle = GHOST_INK;
      ctx.beginPath();
      ctx.ellipse(0, bh * 0.2, oo * 0.75, oo, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3A2A5E";
      ctx.beginPath();
      ctx.ellipse(0, bh * 0.21, oo * 0.5, oo * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.85 * 0.55;
      ctx.fillStyle = GHOST_CHEEK;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(s * bw * 0.3, bh * 0.06, 2.6, 1.7, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
    /** The flappy baby CHICK — top pill-dispenser. Wing-beat phase comes from a.frame;
    *  wings sweep down as the body rises. Unified ink-cartoon look. */
    #dispChick(a, time) {
      const ctx = this.#ctx;
      const x = a.x, y = a.y, hw = ALIEN_W / 2;
      const beat = a.frame % CHICK_BOB_PERIOD / CHICK_BOB_PERIOD;
      const flap = -Math.cos(beat * Math.PI * 2) * 0.5 + 0.5;
      const dir = Math.sign(a.vx) || 1;
      const sx = 1 + 0.06 * flap;
      const sy = 1 - 0.06 * flap + 0.03 * Math.sin(time * 9);
      const bw = 23, bh = 21;
      ctx.save();
      const climb = (ALIEN_Y - y) / 12;
      const sh = Math.max(0, Math.min(1, climb));
      ctx.fillStyle = `rgba(40,30,8,${0.26 * (1 - 0.55 * sh)})`;
      ctx.beginPath();
      ctx.ellipse(x, 35, hw * (1 - 0.3 * sh), 3 * (1 - 0.3 * sh), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(x, y);
      ctx.scale(sx, sy);
      const tailX = -dir * bw * 0.46;
      ctx.fillStyle = CHICK_BODY_BOT;
      for (const k of [-1, 0, 1]) {
        const ang = k * 0.42 - 0.1 * dir;
        const tx = tailX - dir * 6 * Math.cos(ang), ty = -bh * 0.06 + 7 * Math.sin(ang);
        const tail = () => {
          ctx.beginPath();
          ctx.moveTo(tailX, -bh * 0.04);
          ctx.quadraticCurveTo(tailX - dir * 3, ty - 2, tx, ty);
          ctx.quadraticCurveTo(tailX - dir * 2, ty + 2, tailX, bh * 0.06);
          ctx.closePath();
        };
        tail();
        ctx.fillStyle = CHICK_BODY_BOT;
        ctx.fill();
        tail();
        this.#inkContour(CHICK_INK, 1.2);
      }
      const wingAng = 0.55 - 1.15 * flap;
      const drawWing = (side, shade) => {
        ctx.save();
        ctx.translate(side * bw * 0.4, -bh * 0.06);
        ctx.rotate(side * wingAng);
        ctx.fillStyle = shade;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(side * 6, -9, side * 15, -3);
        ctx.quadraticCurveTo(side * 18, 2, side * 13, 6);
        ctx.quadraticCurveTo(side * 6, 7, 0, 4);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(side * 6, -9, side * 15, -3);
        ctx.quadraticCurveTo(side * 18, 2, side * 13, 6);
        ctx.quadraticCurveTo(side * 6, 7, 0, 4);
        ctx.closePath();
        this.#inkContour(CHICK_INK, 1.3);
        ctx.strokeStyle = CHICK_INK;
        ctx.lineWidth = 0.8;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(side * 4, 0);
        ctx.quadraticCurveTo(side * 9, -1, side * 12, 1);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(side * 4, 3);
        ctx.quadraticCurveTo(side * 8, 3, side * 11, 4);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.restore();
      };
      drawWing(-dir, CHICK_BODY_BOT);
      const tuftJ = Math.sin(time * 11) * 0.1 + (flap - 0.5) * 0.18;
      ctx.fillStyle = CHICK_BODY_MID;
      for (const k of [-1, 0, 1]) {
        const ang = k * 0.46 + tuftJ;
        const px = Math.sin(ang) * 8, py = -bh * 0.5 - 6 - Math.cos(ang) * 4;
        const tuft = () => {
          ctx.beginPath();
          ctx.moveTo(k * 2.2, -bh * 0.5 + 2);
          ctx.quadraticCurveTo(px * 0.5, py + 4, px, py);
          ctx.quadraticCurveTo(px + 1.2, py + 2.5, k * 2.2 + 1.4, -bh * 0.5 + 3);
          ctx.closePath();
        };
        tuft();
        ctx.fillStyle = CHICK_BODY_MID;
        ctx.fill();
        tuft();
        this.#inkContour(CHICK_INK, 1.1);
      }
      const tuck = flap;
      ctx.strokeStyle = CHICK_BEAK;
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      for (const s of [-1, 1]) {
        const lx = s * bw * 0.16, ly = bh * 0.46;
        const fy = ly + 6 - 4 * tuck;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(lx + s * 1.5, fy);
        ctx.stroke();
        ctx.lineWidth = 1.6;
        for (const t of [-1, 0, 1]) {
          ctx.beginPath();
          ctx.moveTo(lx + s * 1.5, fy);
          ctx.lineTo(lx + s * 1.5 + t * 2.4, fy + 2.4);
          ctx.stroke();
        }
        ctx.lineWidth = 2.2;
      }
      ctx.shadowColor = "rgba(255,210,59,0.5)";
      ctx.shadowBlur = 9;
      const body = ctx.createLinearGradient(0, -bh * 0.5, 0, bh * 0.5);
      body.addColorStop(0, CHICK_BODY_TOP);
      body.addColorStop(0.5, CHICK_BODY_MID);
      body.addColorStop(1, CHICK_BODY_BOT);
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.ellipse(0, 0, bw * 0.5, bh * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = CHICK_BELLY;
      ctx.beginPath();
      ctx.ellipse(0, bh * 0.2, bw * 0.32, bh * 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(-bw * 0.18, -bh * 0.22, bw * 0.13, bh * 0.1, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = this.#darken(CHICK_BODY_MID);
      ctx.lineWidth = 0.9;
      ctx.globalAlpha = 0.35;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.arc(i * bw * 0.16, bh * 0.42, 2.2, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, bw * 0.5, bh * 0.5, 0, 0, Math.PI * 2);
      this.#inkContour(CHICK_INK, 1.7);
      const eyeY = -bh * 0.16, eyeDX = bw * 0.22, eyeR = 5;
      for (const s of [-1, 1]) {
        const ex = s * eyeDX;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(ex, eyeY, eyeR, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ex, eyeY, eyeR, 0, Math.PI * 2);
        this.#inkContour(CHICK_INK, 1.3);
        const pdx = dir * 1.7, pdy = -0.6 + 1.2 * flap;
        ctx.fillStyle = "#1a1206";
        ctx.beginPath();
        ctx.arc(ex + pdx, eyeY + pdy, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.beginPath();
        ctx.arc(ex + pdx - 0.8, eyeY + pdy - 0.9, 0.85, 0, Math.PI * 2);
        ctx.fill();
      }
      const gape = (1 - flap) * 1.4;
      const bkX = dir * 1.5, bkY = bh * 0.04;
      ctx.fillStyle = CHICK_BEAK;
      const beak = () => {
        ctx.beginPath();
        ctx.moveTo(bkX - 4, bkY);
        ctx.lineTo(bkX + 4, bkY - 1);
        ctx.lineTo(bkX + 1, bkY + 2.6 + gape);
        ctx.closePath();
      };
      beak();
      ctx.fillStyle = CHICK_BEAK;
      ctx.fill();
      beak();
      this.#inkContour(this.#darken(CHICK_BEAK), 1.2);
      if (gape > 0.3) {
        ctx.fillStyle = "#d96a14";
        ctx.beginPath();
        ctx.moveTo(bkX - 3, bkY + 1.2);
        ctx.lineTo(bkX + 3, bkY + 0.6);
        ctx.lineTo(bkX + 1, bkY + 2.6 + gape);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = "#ff9a7a";
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(s * bw * 0.34, bh * 0.04, 2.4, 1.6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      drawWing(dir, CHICK_BODY_MID);
      ctx.restore();
    }
    /** The extra-life carrier — a beautiful winged heart trailing sparkles and a soft
     *  golden aura, gently bobbing as it sweeps across. */
    #extraLife(c, time) {
      const ctx = this.#ctx;
      const x = c.x, y = c.y + Math.sin(time * 3) * 3;
      const flap = Math.sin(time * 9);
      ctx.save();
      const aura = ctx.createRadialGradient(x, y, 2, x, y, 30);
      aura.addColorStop(0, "rgba(255,224,120,0.45)");
      aura.addColorStop(1, "rgba(255,224,120,0)");
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(x, y, 30, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 5; i++) {
        const a = time * 2 + i * 1.3, rr = 16 + 6 * Math.sin(time * 4 + i);
        const sx = x - Math.sign(c.vx || 1) * (10 + i * 5), sy = y + Math.sin(a) * 6;
        ctx.globalAlpha = 0.5 - i * 0.08;
        ctx.fillStyle = "#fff6c8";
        ctx.beginPath();
        ctx.arc(sx, sy, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(x + s * 9, y - 2);
        ctx.rotate(s * (-0.5 + 0.35 * flap));
        ctx.shadowColor = "rgba(255,255,255,0.7)";
        ctx.shadowBlur = 8;
        const wg = ctx.createLinearGradient(0, 0, s * 18, -4);
        wg.addColorStop(0, "#ffffff");
        wg.addColorStop(1, "#cfe2ff");
        ctx.fillStyle = wg;
        ctx.beginPath();
        ctx.moveTo(0, 4);
        ctx.quadraticCurveTo(s * 14, -6, s * 20, -2);
        ctx.quadraticCurveTo(s * 13, 2, s * 16, 8);
        ctx.quadraticCurveTo(s * 9, 5, s * 10, 11);
        ctx.quadraticCurveTo(s * 5, 7, 0, 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      const beat = 1 + 0.06 * Math.sin(time * 6);
      ctx.shadowColor = "#ff5b8a";
      ctx.shadowBlur = 12;
      const hg = ctx.createRadialGradient(x - 3, y - 4, 1, x, y, 12);
      hg.addColorStop(0, "#ffd0e0");
      hg.addColorStop(0.5, "#ff5b8a");
      hg.addColorStop(1, "#c81e5a");
      ctx.fillStyle = hg;
      const R = 11 * beat;
      ctx.beginPath();
      ctx.moveTo(x, y + R * 0.85);
      ctx.bezierCurveTo(x - R * 1.3, y - R * 0.25, x - R * 0.55, y - R * 0.95, x, y - R * 0.35);
      ctx.bezierCurveTo(x + R * 0.55, y - R * 0.95, x + R * 1.3, y - R * 0.25, x, y + R * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath();
      ctx.ellipse(x - 3.5, y - 3, 2.4, 1.6, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "800 7px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("1UP", x, y + R + 7);
      ctx.restore();
    }
    /** A flashy burst where a bonus was just caught: an expanding colour ring,
     *  radiating sparks, and the power glyph popping up — keyed to its colour. */
    #pickups(pickups) {
      if (!pickups.length) return;
      const ctx = this.#ctx;
      for (const p of pickups) {
        const meta = POWER_META[p.kind];
        const k = Math.min(1, p.t / 0.5);
        const a = 1 - k;
        ctx.save();
        ctx.shadowColor = meta.color;
        ctx.shadowBlur = 12;
        ctx.globalAlpha = a;
        ctx.strokeStyle = meta.color;
        ctx.lineWidth = 2 + 2.5 * a;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5 + k * 26, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = meta.color;
        for (let i = 0; i < 9; i++) {
          const ang = i / 9 * Math.PI * 2, rr = 7 + k * 24;
          ctx.beginPath();
          ctx.arc(p.x + Math.cos(ang) * rr, p.y + Math.sin(ang) * rr, 1.4 * a + 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.font = `800 ${13 + 6 * a}px "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(meta.letter, p.x, p.y - 12 - k * 18);
        ctx.restore();
      }
    }
    /** Floating combo counters rising from each chained kill (×N). */
    /** Floating combo counters (×N) only — the point NUMBERS no longer clutter the
     *  playfield (the score lives in the corner HUD). */
    #comboPops(pops) {
      if (!pops.length) return;
      const ctx = this.#ctx;
      for (const p of pops) {
        if (p.t < 0) continue;
        if (p.pts !== void 0) continue;
        const k = Math.min(1, p.t / 0.9);
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - k);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const big = p.n >= 6;
        ctx.font = `800 ${13 + Math.min(11, p.n)}px "Segoe UI", system-ui, sans-serif`;
        ctx.fillStyle = big ? "#ffd24a" : "#ffffff";
        ctx.shadowColor = big ? "#ff7043" : "rgba(126,224,255,0.85)";
        ctx.shadowBlur = 8;
        ctx.fillText(`\xD7${p.n}`, p.x, p.y - k * 30);
        ctx.restore();
      }
    }
    /** The milestone eruption (combo ×5/×10/×15/×20+): an escalating tier-coloured burst
     *  with a 'COMBO ×N' headline. Deterministic in time (no Math.random in render). */
    #milestone(n, t, life = false) {
      const ctx = this.#ctx;
      const cx = W / 2, cy = H * 0.4;
      const tier = n >= 20 ? 3 : n >= 15 ? 2 : n >= 10 ? 1 : 0;
      const col = ["#7ee0ff", "#5fe08a", "#ffd24a", "#ff7043"][tier];
      const rings = tier + 1;
      const fade = t > 0.8 ? Math.max(0, 1 - (t - 0.8) / 0.3) : 1;
      ctx.save();
      if (tier >= 1 && t < 0.5) {
        ctx.globalAlpha = (tier >= 3 ? 0.12 : 0.06) * (1 - t / 0.5);
        ctx.fillStyle = col;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
      ctx.shadowColor = col;
      ctx.shadowBlur = 10;
      for (let i = 0; i < rings; i++) {
        const rp = Math.min(1, Math.max(0, (t - i * 0.06) / 1));
        if (rp <= 0) continue;
        ctx.globalAlpha = (1 - rp) * 0.9;
        ctx.strokeStyle = col;
        ctx.lineWidth = 6 - rp * 5;
        ctx.beginPath();
        ctx.arc(cx, cy, 10 + rp * 120, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      const pop = 1 + 0.4 * Math.sin(Math.min(1, t / 0.18) * Math.PI);
      ctx.globalAlpha = fade;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(pop, pop);
      ctx.fillStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 18;
      ctx.font = `800 ${28 + Math.min(28, n)}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`COMBO \xD7${n}`, 0, 0);
      ctx.restore();
      if (life) {
        ctx.globalAlpha = fade;
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = col;
        ctx.shadowBlur = 8;
        ctx.font = '800 16px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("+1 LIFE", cx, cy - 42 - Math.min(28, n) / 2);
      }
      ctx.restore();
    }
    /** FINALE: a gold screen flash + raining gold streaks + a "JACKPOT!" shout — you
     *  cleared the level. Deterministic in time (no Math.random). This is the old
     *  frenzy burst recoloured from red alarm to gold celebration: same shape of juice,
     *  opposite meaning (it used to mean the board had just turned on you). */
    #finaleBurst(flash, time) {
      const ctx = this.#ctx;
      const f = Math.min(1, flash / 0.7);
      ctx.save();
      ctx.fillStyle = `rgba(255,196,64,${0.2 * f})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 4; i++) {
        const baseX = W * (0.18 + 0.21 * i) + Math.sin(time * 30 + i) * 10;
        ctx.strokeStyle = `rgba(255,${i % 2 ? 220 : 240},${140},${(0.55 + 0.35 * Math.sin(time * 50 + i * 2)) * f})`;
        ctx.lineWidth = 2.2;
        ctx.shadowColor = "#ffd76a";
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(baseX, 0);
        for (let y = 0; y <= H; y += 40) {
          const jx = baseX + Math.sin(y * 0.09 + i * 3 + time * 40) * 22 + Math.cos(y * 0.21 + time * 60) * 9;
          ctx.lineTo(jx, y);
        }
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.shadowBlur = 0;
      const pop = 1 + 0.12 * Math.sin(time * 40);
      ctx.save();
      ctx.translate(W / 2 + Math.sin(time * 53) * 4, H * 0.3);
      ctx.scale(pop, pop);
      ctx.globalAlpha = f;
      ctx.fillStyle = "#fff8dc";
      ctx.shadowColor = "#ffb020";
      ctx.shadowBlur = 16;
      ctx.font = '900 36px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("JACKPOT!", 0, 0);
      ctx.restore();
      ctx.restore();
    }
    #explosions(explosions) {
      if (!explosions.length) return;
      const ctx = this.#ctx;
      for (const e of explosions) {
        const p = Math.min(1, e.t / EXPLOSION_DUR);
        const r = 8 + p * (e.r ?? ROCKET_RADIUS);
        const plasma = e.hue === "plasma";
        const core = plasma ? "#7ec8ff" : "#ff7043";
        const ring = plasma ? "#bfe3ff" : "#ffcf5e";
        ctx.save();
        ctx.shadowColor = core;
        ctx.shadowBlur = 14;
        ctx.globalAlpha = (1 - p) * 0.5;
        ctx.fillStyle = plasma ? "#ffffff" : core;
        ctx.beginPath();
        ctx.arc(e.x, e.y, r * 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1 - p;
        ctx.strokeStyle = ring;
        ctx.lineWidth = 3 + (1 - p) * 4;
        ctx.beginPath();
        ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    /** One-time aim hint: the ±25% movable band + a lock/launch prompt. */
    #aimHint(engine, time) {
      const ctx = this.#ctx;
      const p = engine.paddle;
      const anchor = engine.aimAnchorX, range = engine.aimRange;
      const lo = anchor - range, hi = anchor + range;
      ctx.save();
      ctx.strokeStyle = "rgba(126,224,255,0.35)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(lo, p.y + p.h / 2);
      ctx.lineTo(hi, p.y + p.h / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const x of [lo, hi]) {
        ctx.beginPath();
        ctx.moveTo(x, p.y - 6);
        ctx.lineTo(x, p.y + p.h + 6);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(255,210,74,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(anchor, p.y - p.h / 2 - 2);
      ctx.lineTo(anchor, p.y + p.h / 2 + 2);
      ctx.stroke();
      const pulse = 0.5 + 0.5 * Math.sin(time * 6);
      ctx.strokeStyle = `rgba(255,255,255,${0.4 + 0.4 * pulse})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(anchor, p.y - 15, 12 + 3 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#bfe3ff";
      ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = "center";
      ctx.fillText("slide the paddle to set the ball\u2019s spot \xB7 click to set, then launch any time", anchor, p.y - 30);
      ctx.restore();
    }
    #hud(engine) {
      const ctx = this.#ctx;
      ctx.save();
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      const sf = engine.scoreFlash > 0 ? 1 + 0.3 * (engine.scoreFlash / 0.45) : 1;
      ctx.save();
      ctx.translate(8, 8);
      ctx.scale(sf, sf);
      ctx.fillStyle = "rgba(223,231,255,0.95)";
      ctx.font = '600 18px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(`\u2726 ${engine.score}`, 0, 0);
      ctx.restore();
      const pts = engine.pointsMul, pil = engine.pillMul, total = pts * pil;
      const tcol = total >= 12 ? "#ff7043" : total >= 6 ? "#ffd24a" : "#7ee0ff";
      ctx.font = `800 ${16 + Math.min(10, total)}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillStyle = tcol;
      ctx.shadowColor = tcol;
      ctx.shadowBlur = 4 + Math.min(12, total);
      ctx.fillText(`\xD7${total.toFixed(1)}`, 8, 30);
      ctx.shadowBlur = 0;
      const chip = (label, col, frac, y) => {
        ctx.font = '700 11px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = col;
        ctx.fillText(label, 8, y);
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        this.#roundRect(8, y + 13, 72, 3, 1.5);
        ctx.fill();
        ctx.fillStyle = col;
        this.#roundRect(8, y + 13, 72 * Math.max(0, Math.min(1, frac)), 3, 1.5);
        ctx.fill();
      };
      chip(`points \xD7${pts.toFixed(1)}`, pts >= 5.5 ? "#ffd24a" : "#7ee0ff", pts / 6, 54);
      chip(`pills \xD7${pil.toFixed(1)}`, pil >= 3 ? "#ffd24a" : "#3fd6c0", (pil - 1) / 2, 74);
      const reserve = Math.max(0, engine.lives - 1);
      const SOCKET_MAX = 9;
      if (reserve > SOCKET_MAX) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(W - 12, 16, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.font = '700 12px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffffff";
        ctx.fillText(`\xD7${reserve}`, W - 21, 16);
        ctx.restore();
      } else {
        const sockets = Math.max(reserve, 4);
        for (let i = 0; i < sockets; i++) {
          const cx = W - 12 - i * 16;
          ctx.beginPath();
          ctx.arc(cx, 16, 5, 0, Math.PI * 2);
          if (i < reserve) {
            ctx.fillStyle = "#ffffff";
            ctx.fill();
          } else {
            ctx.fillStyle = "rgba(255,255,255,0.14)";
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = reserve === 0 ? "rgba(255,90,90,0.7)" : "rgba(255,255,255,0.3)";
            ctx.stroke();
          }
        }
      }
      if (engine.gunActive) this.#gunMagazine(engine);
      const powers = engine.activePowers;
      if (powers.length) {
        const bw = 46, gap = 6;
        let bx = (W - (powers.length * bw + (powers.length - 1) * gap)) / 2;
        for (const pw of powers) {
          const meta = POWER_META[pw.kind];
          const glyph = meta.letter;
          this.#roundRect(bx, 6, bw, 18, 5);
          ctx.fillStyle = "rgba(10,14,30,0.66)";
          ctx.fill();
          ctx.fillStyle = meta.color;
          ctx.globalAlpha = 0.85;
          this.#roundRect(bx, 21, bw * pw.frac, 3, 1.5);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.fillStyle = meta.color;
          ctx.font = '700 11px "Segoe UI", system-ui, sans-serif';
          ctx.textBaseline = "middle";
          ctx.textAlign = "left";
          ctx.fillText(glyph, bx + 6, 15);
          ctx.fillStyle = "#dfe7ff";
          ctx.textAlign = "right";
          ctx.fillText(pw.label, bx + bw - 6, 15);
          bx += bw + gap;
        }
      }
      ctx.restore();
    }
    /** Gun magazine readout (top-left, under the score): the letter G, its stack
     *  level once upgraded, then a pip per shot — bright = loaded, hollow = used. */
    #gunMagazine(engine) {
      const ctx = this.#ctx;
      const gy = 38;
      ctx.save();
      ctx.fillStyle = "#d8c2ff";
      ctx.font = '700 12px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const label = engine.gunLevel >= 2 ? `G L${engine.gunLevel}` : "G";
      ctx.fillText(label, 10, gy);
      const x0 = 10 + (engine.gunLevel >= 2 ? 36 : 18);
      for (let i = 0; i < engine.gunLoaderSize; i++) {
        const cx = x0 + i * 12;
        ctx.beginPath();
        ctx.arc(cx, gy, 4, 0, Math.PI * 2);
        if (i < engine.gunAmmo) {
          ctx.fillStyle = "#ffffff";
          ctx.fill();
        } else {
          ctx.strokeStyle = "rgba(216,194,255,0.5)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    #roundRect(x, y, w2, h, r) {
      const ctx = this.#ctx;
      const rr = Math.min(r, w2 / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w2, y, x + w2, y + h, rr);
      ctx.arcTo(x + w2, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w2, y, rr);
      ctx.closePath();
    }
    /** Stroke the CURRENT path as a tinted-dark ink contour — the one unifying
     *  cartoon cue. The caller re-issues the same #roundRect/arc path on the line
     *  before. Always a darken()/#darken tint of the body (or soft grey for the
     *  white ball), NEVER #000. Resets shadowBlur so a leftover body glow can't
     *  bleed into the crisp line. A named stroke, not a path-builder. */
    #inkContour(stroke, lineWidth) {
      const ctx = this.#ctx;
      ctx.shadowBlur = 0;
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  };

  // scripts/bridge/_arkanoid-face/_probe/entry.ts
  var w = window;
  w["ARK"] = { W, H, BRICK_W, BRICK_X0, COLS, levels: LEVELS.length };
  w["draw"] = (canvasId, levelIndex) => {
    const c = document.getElementById(canvasId);
    c.width = W * 2;
    c.height = H * 2;
    c.style.width = W + "px";
    c.style.height = H + "px";
    const ctx = c.getContext("2d");
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.fillStyle = "#10204f";
    ctx.fillRect(0, 0, W, H);
    const engine = new Engine(cloneLevel(LEVELS[levelIndex]).rows);
    const r = new Renderer(ctx);
    r.draw(engine, 0);
    const alive = engine.bricks.filter((b) => b.alive);
    const minX = Math.min(...alive.map((b) => b.x)), maxX = Math.max(...alive.map((b) => b.x + b.w));
    return JSON.stringify({ level: LEVELS[levelIndex].name, bricks: alive.length, minX, maxX, W });
  };
})();
