import { describe, expect, it } from 'vitest';
import { createBattle, stepBattle } from '../src/game/battle';
import { aiCommand } from '../src/game/ai';
import { emptyCommand, type BattleState, type Command, type Species } from '../src/game/types';
const c = (values: Partial<Command> = {}): Command => ({ ...emptyCommand(), ...values });
function advance(s: BattleState, seconds: number, a = c(), b = c()) { for (let n = 0; n < Math.round(seconds * 120); n++) stepBattle(s, [a,b], 1 / 120); }
function arena(distance = 170) { const s = createBattle('ivysaur', 7, 'squirtle'); s.obstacles = []; s.fighters[1].pos.x = 330 + distance; return s; }
const rock = { id: 90, kind: 'rock' as const, pos: { x: 430, y: 312 }, radius: 26, hp: 100, maxHp: 100 };
describe('Ivysaur spacing, returning leaf and committed Solar Beam', () => {
  it.each([[60,9],[89,9],[90,18],[145,18],[146,0]])('vine distance %s deals %s', (distance, damage) => {
    const s = arena(distance); advance(s, .18, c({ melee: true })); expect(s.fighters[1].hp).toBe(100);
    advance(s, .02); expect(s.fighters[1].hp).toBe(100 - damage);
  });
  it('vine requires narrow aim and cannot hit through cover', () => {
    const miss = arena(100); miss.fighters[1].pos.y += 40; advance(miss, .25, c({ melee: true })); expect(miss.fighters[1].hp).toBe(100);
    const blocked = arena(140); blocked.obstacles = [structuredClone(rock)]; advance(blocked, .25, c({ melee: true })); expect(blocked.fighters[1].hp).toBe(100); expect(blocked.obstacles[0].hp).toBe(78);
  });
  it('one tap throws a leaf with one hit per leg and stronger return', () => {
    const s = arena(); advance(s, .01, c({ ranged: true })); expect(s.fighters[0].energy).toBe(88);
    advance(s, .19); expect(s.projectiles).toHaveLength(0); advance(s, .4); expect(s.fighters[1].hp).toBe(92);
    advance(s, .2); expect(s.fighters[1].hp).toBe(92); advance(s, .6); expect(s.fighters[1].hp).toBe(78);
    advance(s, 1); expect(s.projectiles).toEqual([]); expect(s.beams).toEqual([]);
  });
  it('moving the owner changes the return path; a prop blocks both legs', () => {
    const s = arena(400); advance(s, .95, c({ ranged: true })); s.fighters[0].pos.y = 430;
    advance(s, .1); const p = s.projectiles.find(p => p.returning)!; expect(p).toBeDefined(); expect(p.velocity.y).toBeGreaterThan(0);
    const blocked = arena(); blocked.obstacles = [structuredClone(rock)]; advance(blocked, 1.8, c({ ranged: true })); expect(blocked.fighters[1].hp).toBe(100); expect(blocked.obstacles[0].hp).toBeLessThan(100);
  });
  it('Solar Beam is stationary, telegraphed, aim locked late and hits once', () => {
    const s = arena(); advance(s, .01, c({ special: true })); const pos = { ...s.fighters[0].pos };
    advance(s, .49, c({ move: { x: 1, y: 0 }, aim: { x: 1, y: 0 } })); expect(s.fighters[0].pos).toEqual(pos); expect(s.fighters[1].hp).toBe(100);
    advance(s, .02); advance(s, .3, c({ aim: { x: 0, y: 1 } })); expect(s.fighters[0].facing).toEqual({ x: 1, y: 0 }); expect(s.fighters[1].hp).toBe(100);
    advance(s, .06); expect(s.fighters[1].hp).toBe(68); expect(s.effects.some(e => e.kind === 'solar' && e.end)).toBe(true);
    advance(s, .5); expect(s.fighters[1].hp).toBe(68); expect(s.hazards).toEqual([]);
  });
  it('Solar Beam stops visually at a prop, can miss, and can be interrupted', () => {
    const s = arena(); s.obstacles = [structuredClone(rock)]; advance(s, .88, c({ special: true }));
    expect(s.fighters[1].hp).toBe(100); expect(s.obstacles[0].hp).toBe(68);
    expect(s.effects.find(e => e.kind === 'solar')!.end!.x).toBeCloseTo(397);
    const miss = arena(); advance(miss, .6, c({ special: true })); miss.fighters[1].pos.y += 80; advance(miss, .3); expect(miss.fighters[1].hp).toBe(100);
    const interrupted = arena(60); advance(interrupted, 1, c({ special: true }), c({ melee: true })); expect(interrupted.effects.some(e => e.kind === 'solar')).toBe(false); expect(interrupted.fighters[0].specialCooldown).toBeGreaterThan(5);
  });
  it('AI selects all three moves at their usable distances', () => {
    expect(aiCommand(arena(120),0,1 / 60).melee).toBe(true);
    expect(aiCommand(arena(250),0,1 / 60).special).toBe(true);
    expect(aiCommand(arena(320),0,1 / 60).ranged).toBe(true);
  });
  it.each(['charmander','squirtle','pikachu','mewtwo','bulbasaur','ivysaur'] as Species[])('terminates mirror and both slot matches against %s', opponent => {
    for (const slot of [0,1]) {
      const s = createBattle(slot ? opponent : 'ivysaur', 11, slot ? 'ivysaur' : opponent);
      for (let n = 0; n < 5400 && s.winner === null; n++) stepBattle(s,[aiCommand(s,0,1 / 60),aiCommand(s,1,1 / 60)],1 / 60);
      expect(s.winner).not.toBeNull(); expect(s.fighters.every(f => f.hp >= 0 && Number.isFinite(f.pos.x))).toBe(true);
    }
  });
});
