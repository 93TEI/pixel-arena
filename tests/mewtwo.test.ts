import { describe, expect, it } from 'vitest';
import { createBattle, stepBattle } from '../src/game/battle';
import { aiCommand } from '../src/game/ai';
import { emptyCommand, type BattleState, type Command, type Species } from '../src/game/types';

const command = (values: Partial<Command> = {}): Command => ({ ...emptyCommand(), ...values });
function advance(s: BattleState, seconds: number, a = command(), b = command()) {
  for (let i = 0; i < Math.round(seconds * 120); i++) stepBattle(s, [a, b], 1 / 120);
}
function arena(opponent: Species = 'squirtle') {
  const s = createBattle('mewtwo', 7, opponent); s.obstacles = []; return s;
}
function psystrike() {
  const s = arena(); s.fighters[1].pos.x = 500;
  advance(s, 0.5, command({ special: true })); return s;
}

describe('Mewtwo shared combat and psychic moves', () => {
  it('uses shared health, normalized movement, energy and short invulnerable dodge', () => {
    const s = arena();
    expect(s.fighters[0].hp).toBe(100);
    advance(s, 0.3, command({ move: { x: -1, y: 1 } }));
    expect(Math.hypot(s.fighters[0].pos.x - 330, s.fighters[0].pos.y - 312)).toBeCloseTo(182 * .3);
    advance(s, .01, command({ dodge: true }));
    expect(s.fighters[0].action).toBe('dodge'); expect(s.fighters[0].dodgeTime).toBeGreaterThan(.2);
    advance(s, .4);
    expect(s.fighters[0].dodgeTime).toBe(0); expect(s.fighters[0].dodgeCooldown).toBeGreaterThan(0);
  });
  it('Confusion respects windup, facing, reach and shared knockback rules', () => {
    const s = arena(); s.fighters[1].pos.x = 395;
    advance(s, .1, command({ melee: true })); expect(s.fighters[1].hp).toBe(100);
    advance(s, .05, command({ melee: true }));
    expect(s.fighters[1].hp).toBe(88); expect(s.fighters[1].knockdownTime).toBeGreaterThan(0);
    expect(s.fighters[0].velocity.x).toBeLessThan(150);
    const behind = arena(); behind.fighters[1].pos.x = 275;
    advance(behind, .2, command({ melee: true })); expect(behind.fighters[1].hp).toBe(100);
    const far = arena(); advance(far, .2, command({ melee: true })); expect(far.fighters[1].hp).toBe(100);
  });
  it.each(['charmander', 'squirtle', 'pikachu', 'mewtwo'] as const)('Psychic clashes with %s and cannot damage through that clash', opponent => {
    const s = arena(opponent), hold = command({ ranged: true });
    advance(s, 1, hold, hold);
    expect(s.clash).not.toBeNull(); expect(s.beams[0].end).toEqual(s.beams[1].end);
    expect(s.fighters.map(f => f.hp)).toEqual([100, 100]);
    expect(s.effects.some(e => e.kind === 'steam')).toBe(false);
    expect(s.fighters[0].energy).toBeLessThan(100);
    advance(s, .15, hold); expect(s.fighters[1].hp).toBeLessThan(100);
    advance(s, .05); expect(s.beams).toHaveLength(0);
    expect(s.fighters[0].phase).toBe('recovery'); expect(s.fighters[0].rangedCooldown).toBeGreaterThan(0);
  });
  it('Psychic is blocked by props, damages them and stops when energy runs out', () => {
    const s = arena();
    s.obstacles = [{ id: 90, kind: 'rock', pos: { x: 430, y: 312 }, radius: 26, hp: 100, maxHp: 100 }];
    advance(s, 1, command({ ranged: true }));
    expect(s.beams[0].blocked).toBe(true); expect(s.beams[0].end.x).toBeLessThan(430);
    expect(s.obstacles[0].hp).toBeLessThan(100); expect(s.fighters[1].hp).toBe(100);
    s.fighters[0].energy = 1; advance(s, .1, command({ ranged: true }));
    expect(s.beams).toHaveLength(0); expect(s.fighters[0].phase).toBe('recovery');
  });
  it('Psystrike warns, pulses four times, then knocks back once and leaves a crater', () => {
    const s = psystrike(), target = s.fighters[1];
    expect(s.hazards[0].warmup).toBeGreaterThan(.4); expect(target.hp).toBe(100);
    expect(s.fighters[0].energy).toBe(70);
    advance(s, .4); expect(target.hp).toBe(100);
    advance(s, .15); expect(target.hp).toBe(96); expect(target.knockdownTime).toBe(0);
    advance(s, .8); expect(target.hp).toBe(84); expect(target.paralysisTime).toBe(0);
    advance(s, .15); expect(target.hp).toBe(74); expect(target.knockdownTime).toBeGreaterThan(0);
    expect(s.hazards).toHaveLength(0); expect(s.groundMarks.some(m => m.kind === 'crater')).toBe(true);
    expect(s.fighters[0].specialCooldown).toBeGreaterThan(4);
  });
  it('Psystrike permits escape and a timed dodge, damages props, and requires energy', () => {
    const escape = arena(); escape.fighters[1].pos.x = 500;
    advance(escape, .42, command({ special: true })); advance(escape, 1.6, command(), command({ move: { x: 0, y: 1 } }));
    expect(escape.fighters[1].hp).toBe(100);
    const dodge = psystrike(); advance(dodge, .4);
    advance(dodge, .12, command(), command({ dodge: true, move: { x: 0, y: 1 } }));
    expect(dodge.fighters[1].hp).toBe(100);
    const props = psystrike(); props.obstacles = [{ id: 90, kind: 'crate', pos: { x: 500, y: 345 }, radius: 22, hp: 28, maxHp: 28 }];
    advance(props, 1.1); expect(props.obstacles).toHaveLength(0);
    const empty = arena(); empty.fighters[0].energy = 0;
    advance(empty, .1, command({ special: true })); expect(empty.hazards).toHaveLength(0); expect(empty.fighters[0].specialCooldown).toBe(0);
  });
  it('can be selected as CPU and completes a battle through ordinary AI commands', () => {
    const special = createBattle('pikachu', 17, 'mewtwo'); special.obstacles = []; special.fighters[1].pos.x = 500;
    const decision = aiCommand(special, 1, 1 / 60); expect(decision.special).toBe(true);
    advance(special, .5, command(), decision); expect(special.hazards[0].species).toBe('mewtwo');
    const s = createBattle('pikachu', 17, 'mewtwo');
    const seen = new Set<string>();
    for (let i = 0; i < 60 * 90 && s.winner === null; i++) {
      stepBattle(s, [aiCommand(s, 0, 1 / 60), aiCommand(s, 1, 1 / 60)], 1 / 60);
      seen.add(s.fighters[1].action);
    }
    expect(seen.has('ranged')).toBe(true);
    expect(s.fighters[0].hp).toBeLessThan(100); expect(s.winner).not.toBeNull();
  });
});
