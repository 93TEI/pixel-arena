import { describe, expect, it } from 'vitest';
import { createBattle, stepBattle } from '../src/game/battle';
import { emptyCommand, type BattleState, type Command, type Species } from '../src/game/types';

const command = (values: Partial<Command> = {}): Command => ({ ...emptyCommand(), ...values });
function advance(s: BattleState, seconds: number, player = command(), opponent = command()) {
  for (let i = 0; i < Math.round(seconds * 120); i++) stepBattle(s, [player, opponent], 1 / 120);
}
function arena(player: Species = 'pikachu', opponent: Species = 'squirtle') {
  const state = createBattle(player, 7, opponent); state.obstacles = []; return state;
}
function thunder() {
  const state = arena(); state.fighters[1].pos.x = 500;
  advance(state, 0.5, command({ special: true })); return state;
}

describe('Pikachu electric combat', () => {
  it('supports Pikachu on either side and explicit mirror matches while preserving defaults', () => {
    expect(createBattle('pikachu').fighters.map(f => f.species)).toEqual(['pikachu', 'squirtle']);
    expect(createBattle('squirtle').fighters.map(f => f.species)).toEqual(['squirtle', 'charmander']);
    for (const player of ['charmander', 'squirtle', 'pikachu'] as const) {
      const state = createBattle(player, 9, 'pikachu');
      expect(state.fighters.map(f => f.species)).toEqual([player, 'pikachu']);
      expect(state.fighters.every(f => f.paralysisTime === 0)).toBe(true);
      advance(state, 0.5, command(), command({ ranged: true }));
      expect(state.beams[0].species).toBe('pikachu');
      expect(state.fighters[0].hp).toBeLessThan(100);
    }
  });
  it('walks faster and executes Quick Attack before the other species with a longer lunge', () => {
    const electric = arena(), fire = arena('charmander');
    advance(electric, 0.3, command({ move: { x: -1, y: 0 } }));
    advance(fire, 0.3, command({ move: { x: -1, y: 0 } }));
    expect(330 - electric.fighters[0].pos.x).toBeCloseTo(61.5);
    expect(electric.fighters[0].pos.x).toBeLessThan(fire.fighters[0].pos.x);
    const quick = arena(), ordinary = arena('charmander');
    quick.fighters[1].pos.x = ordinary.fighters[1].pos.x = 415;
    advance(quick, 0.1, command({ melee: true })); advance(ordinary, 0.1, command({ melee: true }));
    expect(quick.fighters[1].hp).toBe(90); expect(ordinary.fighters[1].hp).toBe(100);
    expect(quick.fighters[0].velocity.x).toBeGreaterThan(280);
    expect(quick.fighters[0].phase).toBe('active'); expect(ordinary.fighters[0].phase).toBe('windup');
    expect(quick.effects.some(e => e.kind === 'trail' && e.species === 'pikachu')).toBe(true);
  });
  it('telegraphs Thunder, applies three strikes with a temporary walking slow, and leaves scorch', () => {
    const state = thunder(), target = state.fighters[1];
    expect(state.hazards[0].warmup).toBeGreaterThan(0.4); expect(target.hp).toBe(100);
    advance(state, 0.4); expect(target.hp).toBe(100); expect(target.paralysisTime).toBe(0);
    advance(state, 0.12); expect(target.hp).toBe(93); expect(target.paralysisTime).toBeGreaterThan(0.6);
    advance(state, 1 / 120, command(), command({ move: { x: 0, y: 1 }, ranged: true }));
    expect(target.moveVelocity.y).toBeCloseTo(170 * 0.25 * 0.6);
    expect(target.action).toBe('ranged'); expect(target.stunTime).toBe(0);
    advance(state, 0.65);
    expect(target.hp).toBe(79); expect(state.hazards).toHaveLength(0);
    expect(state.groundMarks.some(m => m.kind === 'scorch')).toBe(true);
    advance(state, 0.8, command(), command({ move: { x: 0, y: 1 } }));
    expect(target.paralysisTime).toBe(0); expect(target.moveVelocity.y).toBe(170);
    expect(state.fighters[0].specialCooldown).toBeGreaterThan(3);
  });
  it('early dodge immunity blocks both lightning damage and paralysis, while paralysis allows a roll', () => {
    const state = thunder(); advance(state, 0.4);
    advance(state, 0.1, command(), command({ dodge: true, move: { x: 0, y: 1 } }));
    expect(state.fighters[1].hp).toBe(100); expect(state.fighters[1].paralysisTime).toBe(0);
    const slowed = thunder(); advance(slowed, 0.52);
    expect(slowed.fighters[1].paralysisTime).toBeGreaterThan(0);
    advance(slowed, 1 / 120, command(), command({ dodge: true }));
    expect(slowed.fighters[1].action).toBe('dodge'); expect(slowed.fighters[1].dodgeTime).toBeGreaterThan(0.2);
  });
  it.each(['charmander', 'squirtle', 'pikachu'] as const)('Thunderbolt clashes with %s without steam or damage through the clash', opponent => {
    const state = arena('pikachu', opponent), hold = command({ ranged: true });
    advance(state, 1, hold, hold);
    expect(state.beams).toHaveLength(2); expect(state.clash).not.toBeNull();
    expect(state.beams.every(b => b.blocked)).toBe(true); expect(state.beams[0].end).toEqual(state.beams[1].end);
    expect(state.fighters.map(f => f.hp)).toEqual([100, 100]);
    expect(state.effects.some(e => e.kind === 'burst' && e.species === 'pikachu')).toBe(true);
    expect(state.effects.some(e => e.kind === 'steam')).toBe(false);
    advance(state, 0.1, hold); expect(state.fighters[1].hp).toBeLessThan(100);
  });
});
