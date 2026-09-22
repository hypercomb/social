// TEMPORARY physics lab — deleted before the work lands.
import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { Engine, SIM_DT, TILE, BRICK, WALL, CRACKED, type LevelDef } from './engine.js'
import { fromAscii } from './levels.js'
const OUT = 'C:/Users/Jaime/AppData/Local/Temp/claude/C--Projects-hypercomb-social-src/5c2ef2cc-c191-467f-9e49-a96f3998d1a2/scratchpad/lab.txt'

class Pad {
  log: string[] = []
  constructor(readonly e: Engine) {}
  at(): string { const p = this.e.player; return `(${((p.x + p.w / 2) / TILE).toFixed(2)}, ${(p.y / TILE).toFixed(2)}) ground=${this.e.onGround} face=${this.e.facing}` }
  tick(input: Partial<{ left: boolean; right: boolean; down: boolean; jump: boolean }> = {}): void {
    Object.assign(this.e.input, { left: false, right: false, down: false, jump: false }, input)
    this.e.update(SIM_DT)
  }
  wait(n: number): void { for (let i = 0; i < n; i++) this.tick() }
  walkTo(col: number): void {
    for (let s = 0; s < 300; s++) {
      const c = (this.e.player.x + this.e.player.w / 2) / TILE
      if (Math.abs(c - col - 0.5) < 0.08) { this.wait(8); return }
      this.tick({ left: c > col + 0.5, right: c < col + 0.5 })
    }
    this.log.push(`walkTo ${col} FAILED at ${this.at()}`)
  }
  jumpToward(col: number): void {
    this.wait(2)
    let air = false
    for (let s = 0; s < 100; s++) {
      const c = (this.e.player.x + this.e.player.w / 2) / TILE
      this.tick({ left: c > col + 0.58, right: c < col + 0.42, jump: true })
      air ||= !this.e.onGround
      if (air && this.e.onGround) return
    }
    this.log.push(`jumpToward ${col} unfinished at ${this.at()}`)
  }
  face(dir: 1 | -1): void { this.tick(dir > 0 ? { right: true } : { left: true }); this.wait(3) }
  cast(down = false): string { this.tick({ down }); const r = this.e.cast() + '@' + JSON.stringify(this.e.targetCell()); this.tick(); return r }
  jumpCast(): string { this.wait(2); this.tick({ jump: true }); this.tick({ jump: true }); this.tick({ jump: true }); const r = this.e.cast() + '@' + JSON.stringify(this.e.targetCell()); this.wait(50); return r }
  note(label: string): void { this.log.push(`${label}: ${this.at()} lives=${this.e.lives} state=${this.e.state}`) }
  foes(): string { return this.e.enemies.map(en => `${en.kind}:${en.alive ? 'alive' : 'dead'}(${((en.x + en.w / 2) / TILE).toFixed(2)},${((en.y + en.h) / TILE).toFixed(2)})${en.state}`).join(' ') }
}

function dump(e: Engine): string {
  const out: string[] = []
  const pc = Math.floor((e.player.x + e.player.w / 2) / TILE), pr = Math.floor((e.player.y + e.player.h - 1) / TILE)
  for (let r = 0; r < e.rows; r++) {
    let line = ''
    for (let c = 0; c < e.cols; c++) {
      const t = e.tileAt(c, r)
      let ch = t === WALL ? '#' : t === BRICK ? 'B' : t === CRACKED ? 'b' : '.'
      if (e.items.some(i => !i.taken && !i.hidden && i.col === c && i.row === r)) ch = 'i'
      if (e.enemies.some(en => en.alive && Math.floor((en.x + en.w / 2) / TILE) === c && Math.floor((en.y + en.h - 1) / TILE) === r)) ch = 'E'
      if (c === pc && r === pr) ch = '@'
      line += ch
    }
    out.push(line)
  }
  return out.join('\n')
}

function level(art: string[]): LevelDef { return { ...fromAscii('lab', art), interconnected: true } }

it('lab', () => {
  const lines: string[] = []
  const run = (art: string[], route: (p: Pad, snap: (label: string) => void) => void): void => {
    const e = new Engine(level(art)); const p = new Pad(e)
    const snap = (label: string): void => { p.note(label); lines.push(...p.log.splice(0), p.foes(), dump(e)) }
    try { route(p, snap) } catch (error) { lines.push('THREW ' + String(error)) }
    snap('end')
  }
  // ── EXPERIMENT ──
  run([
    '################',
    '#.........#....#',
    '#..:..V...#....#',
    '#..BBBB...#K...#',
    '#.........#BB..#',
    '#B........#....#',
    '#..B..g..*#....#',
    '#..BBBBBBB#..BB#',
    '#.........#....#',
    '#....BBB.......#',
    '#.PA...........#',
    '################',
  ], (p, snap) => {
    p.walkTo(4); p.jumpToward(5)
    p.face(1); p.jumpCast()
    p.walkTo(2); p.wait(240)
    p.walkTo(4); p.jumpToward(5); p.walkTo(5); p.jumpToward(6)
    p.walkTo(9); snap('relic')
    p.walkTo(6); p.jumpToward(3); snap('on bumper')
    p.walkTo(3); p.jumpToward(1); snap('on (1,5)')
    p.jumpToward(3); snap('on shelf')
    p.walkTo(4); p.face(-1); p.log.push('c1 ' + p.cast()); p.log.push('c2 ' + p.cast()); snap('deep?')
    p.walkTo(3); p.walkTo(6); snap('treasure+stele')
    p.walkTo(9); p.wait(60); snap('dropped to terrace')
    p.walkTo(10); p.wait(60); p.walkTo(11); snap('right side')
    p.face(1); p.log.push('jc ' + p.jumpCast()); snap('step made')
    p.jumpToward(12); snap('on step')
    p.jumpToward(13); snap('on mid ledge')
    p.walkTo(14); p.face(-1); p.log.push('jc2 ' + p.jumpCast()); snap('step2')
    p.jumpToward(13); snap('on step2')
    p.jumpToward(12); snap('on top')
    p.walkTo(11); snap('key?')
  })
  // ── /EXPERIMENT ──
  writeFileSync(OUT, lines.join('\n'))
})
