import { describe, expect, it } from 'vitest';
import { createBattle, stepBattle, rootPoints } from '../src/game/battle';
import { aiCommand } from '../src/game/ai';
import { VENUSAUR as V, grassHelp } from '../src/game/grassMoves';
import { emptyCommand, type BattleState, type Command, type Species } from '../src/game/types';
const c = (values: Partial<Command> = {}): Command => ({ ...emptyCommand(), ...values });
function advance(s: BattleState, seconds: number, a = c(), b = c()) { for (let n = 0; n < Math.round(seconds * 120); n++) stepBattle(s, [a, b], 1 / 120); }
function arena(distance = 230) { const s = createBattle('venusaur', 7, 'squirtle'); s.obstacles = []; s.fighters[1].pos.x = 330 + distance; return s; }
const rock = { id: 90, kind: 'rock' as const, pos: { x: 470, y: 312 }, radius: 26, hp: 100, maxHp: 100 };
describe('Venusaur flower, lob and sequential roots', () => {
  it('easy petals hit all directions once, only after preparation', () => {
    const s = arena(-80); advance(s, .01, c({ melee: true })); advance(s, .14); expect(s.fighters[1].hp).toBe(100);
    advance(s, .1); expect(s.fighters[1].hp).toBe(100 - V.petals.damage); advance(s, .3); expect(s.fighters[1].hp).toBe(100 - V.petals.damage);
    expect(s.beams).toEqual([]); expect(s.hazards).toEqual([]);
  });
  it.each([[230,24],[250,24],[251,12],[300,12],[311,0]])('bomb at distance %s deals %s with exact center threshold', (distance, amount) => {
    const s = arena(distance); advance(s, .01, c({ ranged: true })); expect(s.fighters[0].energy).toBe(85);
    advance(s, .87); expect(s.fighters[1].hp).toBe(100); advance(s, .05); expect(s.fighters[1].hp).toBe(100 - amount);
    advance(s, 1); expect(s.plantAttacks).toEqual([]); expect(s.fighters[1].hp).toBe(100 - amount);
  });
  it('lob crosses cover but blast cannot damage through cover', () => {
    const s = arena(); s.obstacles = [structuredClone(rock)]; advance(s, .01, c({ ranged: true })); advance(s, 1); expect(s.fighters[1].hp).toBe(76);
    const blocked = arena(300); blocked.obstacles = [{ ...structuredClone(rock), pos: { x: 595, y: 312 }, radius: 16 }]; advance(blocked, .01, c({ ranged: true })); advance(blocked, 1); expect(blocked.fighters[1].hp).toBe(100);
  });
  it('moving and timed dodge avoid the delayed bomb', () => {
    const moving = arena(); advance(moving, .01, c({ ranged: true })); advance(moving, 1, c(), c({ move: { x: 0, y: 1 } })); expect(moving.fighters[1].hp).toBe(100);
    const dodge = arena(); advance(dodge, .01, c({ ranged: true })); advance(dodge, .81); advance(dodge, .01, c(), c({ dodge: true, move: { x: 0, y: 1 } })); advance(dodge, .12); expect(dodge.fighters[1].hp).toBe(100);
  });
  it.each([[90,28],[200,28],[310,42]])('roots hit distance %s once for %s', (distance, amount) => {
    const s = arena(distance); advance(s, .01, c({ special: true })); expect(s.fighters[0].energy).toBe(68);
    const pos = { ...s.fighters[0].pos }; advance(s, .55, c({ aim: { x: 0, y: 1 }, move: { x: 0, y: 1 } })); expect(s.fighters[0].pos).toEqual(pos); expect(s.fighters[0].facing).toEqual({ x: 1, y: 0 }); expect(s.fighters[1].hp).toBe(100);
    advance(s, 1.5); expect(s.fighters[1].hp).toBe(100 - amount); expect(s.plantAttacks).toEqual([]); expect(s.fighters[0].specialCooldown).toBeGreaterThan(4);
  });
  it('roots stop before cover and the court; no phantom terminal bonus', () => {
    const s = arena(310); s.obstacles = [structuredClone(rock)]; expect(rootPoints(s,s.fighters[0])).toHaveLength(1);
    advance(s, .01, c({ special: true })); advance(s, 2); expect(s.fighters[1].hp).toBe(100);
    const edge = arena(); edge.fighters[0].pos.x = 800; expect(rootPoints(edge,edge.fighters[0])).toEqual([]);
  });
  it('a strong melee interrupts preparation, keeping the spent cost and cooldown', () => {
    const s = arena(60); advance(s, .01, c({ special: true })); advance(s, .5, c(), c({ melee: true }));
    expect(s.plantAttacks).toEqual([]); expect(s.fighters[0].specialCooldown).toBeGreaterThan(5); expect(s.fighters[0].energy).toBeLessThan(80);
  });
  it('Overgrow snapshots launch power and reset clears pending attacks', () => {
    const s = arena(); s.fighters[0].hp = 30; advance(s, .01, c({ ranged: true })); advance(s, .25); s.fighters[0].hp = 100; advance(s, 1);
    expect(s.fighters[1].hp).toBeCloseTo(100 - V.bomb.coreDamage * V.overgrow);
    expect(createBattle('venusaur').plantAttacks).toEqual([]);
    expect(grassHelp('venusaur').map(h => h.name)).toEqual(['꽃보라','씨폭탄','하드플랜트','심록']);
  });
  it('AI uses all moves with the same command interface', () => {
    expect(aiCommand(arena(80),0,1/60).melee).toBe(true);
    expect(aiCommand(arena(310),0,1/60).special).toBe(true);
    const s = arena(); s.fighters[0].specialCooldown = 3; expect(aiCommand(s,0,1/60).ranged).toBe(true);
  });
  it.each(['bulbasaur','ivysaur','venusaur','charmander','squirtle','pikachu','mewtwo'] as Species[])('plays both slots against %s without invalid state', opponent => {
    for (const slot of [0,1]) {
      const s = createBattle(slot ? opponent : 'venusaur',11,slot ? 'venusaur' : opponent);
      for (let n = 0; n < 5400 && s.winner === null; n++) stepBattle(s,[aiCommand(s,0,1/60),aiCommand(s,1,1/60)],1/60);
      expect(s.winner).not.toBeNull(); expect(s.fighters.every(f => f.hp >= 0 && Number.isFinite(f.pos.x))).toBe(true);
    }
  });
});
