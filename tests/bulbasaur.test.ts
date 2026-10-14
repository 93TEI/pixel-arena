import { describe, expect, it } from 'vitest';
import { createBattle, stepBattle, suspendBattleInput } from '../src/game/battle';
import { aiCommand } from '../src/game/ai';
import { BULBASAUR as B, leafTier } from '../src/game/grassMoves';
import { emptyCommand, type BattleState, type Command, type Species } from '../src/game/types';
const command = (values: Partial<Command> = {}): Command => ({ ...emptyCommand(), ...values });
const hold = command({ ranged: true, rangedHeld: true });
function advance(s: BattleState, seconds: number, a = command(), b = command()) {
  for (let i = 0; i < Math.round(seconds * 120); i++) stepBattle(s, [a, b], 1 / 120);
}
function arena(opponent: Species = 'squirtle', distance = 170) {
  const s = createBattle('bulbasaur', 7, opponent); s.obstacles = [];
  s.fighters[1].pos.x = s.fighters[0].pos.x + distance; return s;
}
const rock = () => ({ id: 90, kind: 'rock' as const, pos: { x: 400, y: 312 }, radius: 26, hp: 100, maxHp: 100 });
function shoot(s: BattleState, duration = 0) {
  advance(s, 1 / 120, hold); advance(s, duration, hold); advance(s, Math.max(1 / 120, B.leaf.minimum + 1 / 120 - duration));
}
function mark(s: BattleState) { s.leechSeeds.push({ owner: 0, target: 1, life: 4, timer: 10, ticksLeft: 3 }); }

describe('Bulbasaur accessible attacks and charged seed combos', () => {
  it('wide low damage vine has windup, range, directional misses and cover', () => {
    const s = arena('squirtle', 90); s.fighters[1].pos.y += 40;
    advance(s, .12, command({ melee: true })); expect(s.fighters[1].hp).toBe(100);
    advance(s, .02); expect(s.fighters[1].hp).toBe(91);
    expect(s.fighters[0].pos.x).toBe(330);
    for (const offset of [{ x: -80, y: 0 }, { x: 60, y: 70 }, { x: 111, y: 0 }]) {
      const miss = arena(); miss.fighters[1].pos = { x: 330 + offset.x, y: 312 + offset.y };
      advance(miss, .25, command({ melee: true })); expect(miss.fighters[1].hp).toBe(100);
    }
    const blocked = arena('squirtle', 100); blocked.obstacles = [rock()];
    advance(blocked, .25, command({ melee: true })); expect(blocked.fighters[1].hp).toBe(100); expect(blocked.obstacles[0].hp).toBe(82);
    expect(blocked.effects.find(e => e.kind === 'melee')!.points![8].x).toBe(374);
  });
  it.each([[0, 'basic', 12, 10], [.55, 'charged', 20, 5], [.65, 'perfect', 26, 5], [.85, 'perfect', 26, 5], [.86, 'charged', 20, 5]] as const)('release at %s yields %s with travel and one energy cost', (time, tier, damage, radius) => {
    const s = arena('squirtle', 400); shoot(s, time);
    expect(s.projectiles).toHaveLength(1); expect(s.projectiles[0]).toMatchObject({ kind: 'leaf', tier, damage, radius });
    expect(s.fighters[0].energy).toBe(88); expect(s.fighters[1].hp).toBe(100);
    expect(s.beams).toEqual([]); expect(s.fighters[0].rangedCooldown).toBeGreaterThan(.7);
  });
  it('tier boundaries do not reward early, late or automatic release as perfect', () => {
    expect([.549, .55, .649, .65, .85, .851, 1.2].map(leafTier)).toEqual(['basic','charged','charged','perfect','perfect','charged','charged']);
    const s = arena('squirtle', 400); advance(s, 1.22, hold);
    expect(s.projectiles[0].tier).toBe('charged'); advance(s, 2, hold);
    expect(s.projectiles).toHaveLength(0); expect(s.fighters[0].phase).toBe('idle');
    advance(s, .02); advance(s, .02, hold); expect(s.fighters[0].phase).toBe('windup');
  });
  it('one-frame tap survives release, while dodge cancels charge before shooting', () => {
    const tap = arena(); advance(tap, 1 / 120, command({ ranged: true, rangedHeld: false }));
    advance(tap, .1); expect(tap.projectiles).toHaveLength(0); advance(tap, .03); expect(tap.projectiles).toHaveLength(1);
    const s = arena(); advance(s, .7, hold); advance(s, .01, command({ dodge: true }));
    expect(s.projectiles).toHaveLength(0); expect(s.fighters[0].action).toBe('dodge'); expect(s.fighters[0].energy).toBeLessThan(89);
    advance(s, .7); expect(s.projectiles).toHaveLength(0);
  });
  it('pause input clearing freezes charge until a fresh hold, then permits release', () => {
    const s = arena('squirtle', 400); advance(s, .4, hold); suspendBattleInput(s);
    const time = s.fighters[0].chargeTime; advance(s, .3);
    expect(s.fighters[0].chargeTime).toBe(time); expect(s.projectiles).toEqual([]);
    advance(s, .3, hold); advance(s, .01); expect(s.projectiles[0].tier).toBe('perfect');
  });
  it('pausing human input does not leave a CPU charge suspended', () => {
    const s = createBattle('ivysaur', 7, 'bulbasaur'); s.obstacles = [];
    advance(s, .4, command(), hold); suspendBattleInput(s);
    expect(s.fighters[1].chargeSuspended).toBe(false);
    advance(s, .3, command(), hold); advance(s, .01);
    expect(s.projectiles.some(p => p.owner === 1 && p.kind === 'leaf')).toBe(true);
  });
  it('projectiles stop at the first obstacle and can be dodged', () => {
    const s = arena(); s.obstacles = [rock()]; shoot(s); advance(s, .5);
    expect(s.fighters[1].hp).toBe(100); expect(s.obstacles[0].hp).toBeLessThan(100);
    const dodge = arena('squirtle', 90); shoot(dodge);
    advance(dodge, .2, command(), command({ dodge: true, move: { x: 0, y: 1 } })); expect(dodge.fighters[1].hp).toBe(100);
  });
  it('seed drains immediately plus three ticks, caps healing, and expires', () => {
    const s = arena(); s.fighters[0].hp = 70; advance(s, .01, command({ special: true }));
    advance(s, .25); expect(s.projectiles).toHaveLength(0);
    advance(s, .6); expect(s.leechSeeds).toHaveLength(1); expect(s.fighters.map(f => f.hp)).toEqual([72,98]);
    advance(s, 4); expect(s.leechSeeds).toEqual([]); expect(s.fighters.map(f => f.hp)).toEqual([78,92]);
    const capped = arena(); capped.fighters[0].hp = 99; advance(capped, .9, command({ special: true })); expect(capped.fighters[0].hp).toBe(100);
  });
  it('grass is drain immune but receives a consumable combo mark; rolling does not cleanse it', () => {
    const s = arena('ivysaur'); advance(s, .9, command({ special: true }));
    expect(s.fighters[1].hp).toBe(100); expect(s.leechSeeds).toHaveLength(1);
    advance(s, .3, command(), command({ dodge: true })); expect(s.leechSeeds).toHaveLength(1);
    s.fighters[1].pos = { x: 400, y: 312 }; s.fighters[1].velocity = { x: 0, y: 0 };
    advance(s, .2, command({ melee: true })); expect(s.fighters[1].hp).toBe(86); expect(s.leechSeeds).toEqual([]);
  });
  it.each([[0, 17], [.7, 34]] as const)('seed combo at %s deals %s once, cancelling remaining drain', (time, total) => {
    const s = arena(); mark(s); shoot(s, time); advance(s, .5);
    expect(s.fighters[1].hp).toBe(100 - total); expect(s.leechSeeds).toEqual([]);
    advance(s, 4); expect(s.fighters[1].hp).toBe(100 - total);
  });
  it('dodging does not consume seed; Overgrow boosts direct damage only', () => {
    const s = arena('squirtle', 90); mark(s); s.fighters[1].dodgeTime = .24;
    advance(s, .14, command({ melee: true })); expect(s.leechSeeds).toHaveLength(1);
    const low = arena(); low.fighters[0].hp = 33; mark(low); shoot(low, .7); advance(low, .5);
    expect(low.fighters[1].hp).toBeCloseTo(100 - 26 * 1.3 - 8); expect(low.fighters[0].hp).toBe(33);
  });
  it('resource gates, death and reset prevent stale attacks or healing', () => {
    const s = arena(); s.fighters[0].energy = 0; advance(s, .1, command({ ranged: true, special: true }));
    expect(s.fighters[0].phase).toBe('idle'); expect(s.projectiles).toEqual([]);
    mark(s); s.fighters[0].hp = 0; advance(s, .02); expect(s.leechSeeds).toEqual([]);
    expect(createBattle('bulbasaur').fighters[0].chargeTime).toBe(0);
  });
  it('AI uses seed against either type, broad vines nearby and charge farther away', () => {
    expect(aiCommand(arena(), 0, 1 / 60).special).toBe(true);
    expect(aiCommand(arena('ivysaur'), 0, 1 / 60).special).toBe(true);
    expect(aiCommand(arena('squirtle', 100), 0, 1 / 60).melee).toBe(true);
    expect(aiCommand(arena('squirtle', 320), 0, 1 / 60).rangedHeld).toBe(true);
  });
  it('AI keeps its started charge when the target closes, without perfect frame reactions', () => {
    const s = arena('squirtle', 200); advance(s, .3, hold);
    expect(aiCommand(s, 0, 1 / 60).rangedHeld).toBe(true);
    s.fighters[0].chargeTime = .7;
    // The cached command is retained until the normal thinking interval.
    expect(aiCommand(s, 0, 1 / 60).rangedHeld).toBe(true);
    s.time += .23; expect(aiCommand(s, 0, 1 / 60).rangedHeld).toBe(false);
  });
  it('AI does not lock itself into seed windup under a visible Solar Beam warning', () => {
    const s = arena('ivysaur', 220), enemy = s.fighters[1];
    enemy.action = 'special'; enemy.phase = 'windup'; enemy.phaseTime = .2;
    const decision = aiCommand(s, 0, 1 / 60);
    expect(decision.special).toBe(false); expect(decision.dodge).toBe(true);
  });
  it.each(['charmander','squirtle','pikachu','mewtwo','bulbasaur','ivysaur'] as Species[])('finishes both slot matches against %s without invalid state', opponent => {
    for (const slot of [0, 1]) {
      const s = createBattle(slot ? opponent : 'bulbasaur', 7, slot ? 'bulbasaur' : opponent);
      for (let n = 0; n < 5400 && s.winner === null; n++) stepBattle(s, [aiCommand(s, 0, 1 / 60), aiCommand(s, 1, 1 / 60)], 1 / 60);
      expect(s.winner).not.toBeNull(); expect(s.fighters.every(f => Number.isFinite(f.hp) && f.hp >= 0 && f.energy >= 0)).toBe(true);
    }
  });
});
