import { describe, expect, it } from 'vitest';
import { createBattle, stepBattle } from '../src/game/battle';
import { WORLD, emptyCommand, type BattleState, type Command } from '../src/game/types';

const input = (values: Partial<Command> = {}): Command => ({ ...emptyCommand(), ...values });
function advance(s: BattleState, seconds: number, first = input(), second = input()) {
  for (let i = 0; i < Math.round(seconds * 120); i++) stepBattle(s, [first, second], 1 / 120);
}
function clear(species: 'charmander' | 'squirtle' = 'charmander') { const s = createBattle(species); s.obstacles = []; return s; }

describe('video-based battle simulation', () => {
  it('resets every action/resource/world field and creates six sparse obstacles', () => {
    const s = createBattle('squirtle');
    advance(s, 1, input({ special: true }));
    const reset = createBattle('squirtle');
    expect(reset.fighters.map(f => f.species)).toEqual(['squirtle', 'charmander']);
    expect(reset.fighters.map(f => [f.hp, f.energy, f.action])).toEqual([[100, 100, 'none'], [100, 100, 'none']]);
    expect(reset.obstacles.filter(o => o.kind === 'crate')).toHaveLength(4);
    expect(reset.obstacles.filter(o => o.kind === 'rock')).toHaveLength(2);
    expect(reset.hazards).toEqual([]); expect(reset.beams).toEqual([]); expect(reset.clash).toBeNull();
  });
  it('normalizes diagonal walking, confines movement, and records walk velocity separately', () => {
    const a = clear(), b = clear(), origin = { ...a.fighters[0].pos };
    advance(a, 0.5, input({ move: { x: -1, y: 0 } }));
    advance(b, 0.5, input({ move: { x: -1, y: -1 } }));
    const distance = (s: BattleState) => Math.hypot(s.fighters[0].pos.x - origin.x, s.fighters[0].pos.y - origin.y);
    expect(distance(a)).toBeCloseTo(distance(b), 5);
    expect(a.fighters[0].moveVelocity.x).toBeLessThan(0); expect(a.fighters[0].velocity.x).toBe(0);
    advance(b, 10, input({ move: { x: -1, y: -1 } }));
    expect(b.fighters[0].pos).toEqual({ x: WORLD.left + 15, y: WORLD.top + 15 });
  });
  it('telegraphs melee before one forward hit, then recovers and lunges', () => {
    const s = clear(); s.fighters[1].pos.x = 385;
    advance(s, 0.1, input({ melee: true }));
    expect(s.fighters[0].phase).toBe('windup'); expect(s.fighters[1].hp).toBe(100);
    advance(s, 0.1, input({ melee: true }));
    expect(s.fighters[0].phase).toBe('active'); expect(s.fighters[1].hp).toBe(88);
    expect(s.fighters[0].pos.x).toBeGreaterThan(330); expect(s.fighters[1].knockdownTime).toBeGreaterThan(0);
    advance(s, 0.15, input({ melee: true }));
    expect(s.fighters[0].phase).toBe('recovery'); expect(s.fighters[1].hp).toBe(88);
    const back = clear(); back.fighters[1].pos.x = 280;
    advance(back, 0.22, input({ melee: true })); expect(back.fighters[1].hp).toBe(100);
  });
  it('charges before emitting a continuous beam, drains energy and stops on release', () => {
    const s = clear();
    advance(s, 0.2, input({ ranged: true }));
    expect(s.beams).toHaveLength(0); expect(s.fighters[0].phase).toBe('windup');
    advance(s, 0.4, input({ ranged: true }));
    expect(s.beams).toHaveLength(1); expect(s.projectiles).toHaveLength(0);
    expect(s.fighters[1].hp).toBeLessThan(100); expect(s.fighters[0].energy).toBeLessThan(100);
    const hp = s.fighters[1].hp;
    advance(s, 0.05);
    expect(s.beams).toHaveLength(0); expect(s.fighters[0].phase).toBe('recovery'); expect(s.fighters[1].hp).toBe(hp);
    const energy = s.fighters[0].energy; advance(s, 0.5); expect(s.fighters[0].energy).toBeGreaterThan(energy);
  });
  it('limits steering and channel duration even when the button remains held', () => {
    const s = clear(); s.fighters[1].pos.y = 470;
    advance(s, 0.4, input({ ranged: true, aim: { x: 1, y: 0 } }));
    advance(s, 1 / 60, input({ ranged: true, aim: { x: 0, y: 1 } }));
    expect(s.fighters[0].facing.x).toBeGreaterThan(0.99);
    advance(s, 2.35, input({ ranged: true, aim: { x: 1, y: 0 } }));
    expect(s.beams).toHaveLength(0); expect(s.fighters[0].phase).toBe('recovery');
  });
  it('opposing channels actually truncate at the clash, emit steam and block damage', () => {
    const s = clear(); const hold = input({ ranged: true });
    advance(s, 1.2, hold, hold);
    expect(s.beams).toHaveLength(2); expect(s.clash).not.toBeNull();
    expect(s.beams[0].end).toEqual(s.beams[1].end); expect(s.beams.every(b => b.blocked)).toBe(true);
    expect(s.fighters.map(f => f.hp)).toEqual([100, 100]);
    expect(s.effects.some(e => e.kind === 'steam')).toBe(true);
    advance(s, 0.3, hold, input());
    expect(s.clash).toBeNull(); expect(s.fighters[1].hp).toBeLessThan(100);
  });
  it('obstacles block streams and walking, and sustained damage destroys them', () => {
    const s = clear();
    s.obstacles.push({ id: 999, kind: 'crate', pos: { x: 450, y: 312 }, radius: 22, hp: 28, maxHp: 28 });
    advance(s, 1, input({ ranged: true }));
    expect(s.beams[0].blocked).toBe(true); expect(s.beams[0].end.x).toBeLessThan(450); expect(s.fighters[1].hp).toBe(100);
    advance(s, 0.9, input({ ranged: true }));
    expect(s.obstacles).toHaveLength(0); expect(s.fighters[1].hp).toBeLessThan(100);
    expect(s.groundMarks.some(m => m.kind === 'crater')).toBe(true);
    const walking = clear(); walking.obstacles.push({ id: 999, kind: 'rock', pos: { x: 450, y: 312 }, radius: 26, hp: 66, maxHp: 66 });
    advance(walking, 1.5, input({ move: { x: 1, y: 0 } }));
    expect(walking.fighters[0].pos.x).toBeLessThanOrEqual(409.01);
  });
  it('melee and a high-speed knockback can shatter crates and leave debris', () => {
    const s = clear(); s.obstacles.push({ id: 999, kind: 'crate', pos: { x: 390, y: 312 }, radius: 22, hp: 28, maxHp: 28 });
    advance(s, 0.15, input({ melee: true }));
    expect(s.obstacles).toHaveLength(0); expect(s.effects.some(e => e.kind === 'debris')).toBe(true);
    const knockback = clear(); knockback.obstacles.push({ id: 999, kind: 'crate', pos: { x: 390, y: 312 }, radius: 22, hp: 28, maxHp: 28 });
    knockback.fighters[0].velocity.x = 450; knockback.fighters[0].knockdownTime = 0.5;
    advance(knockback, 0.2);
    expect(knockback.obstacles).toHaveLength(0); expect(knockback.groundMarks).toHaveLength(1);
  });
  it.each(['charmander', 'squirtle'] as const)('%s special has telegraph, timed area damage, cooldown and ground aftermath', species => {
    const s = clear(species); s.fighters[1].pos = { x: 500, y: 312 };
    advance(s, 0.5, input({ special: true }));
    expect(s.hazards).toHaveLength(1); expect(s.hazards[0].warmup).toBeGreaterThan(0); expect(s.fighters[1].hp).toBe(100);
    expect(s.fighters[0].energy).toBeLessThan(75); expect(s.fighters[0].specialCooldown).toBeGreaterThan(5);
    advance(s, 1, input({ special: true }));
    expect(s.hazards).toHaveLength(1); expect(s.fighters[1].hp).toBeLessThan(100);
    advance(s, 2, input({ special: true }));
    expect(s.hazards).toHaveLength(0); expect(s.groundMarks.some(m => m.kind === (species === 'charmander' ? 'scorch' : 'wet'))).toBe(true);
  });
  it('roll has early invulnerability only, afterimages and a longer cooldown', () => {
    const s = clear(); s.fighters[1].pos.x = 610;
    advance(s, 0.4, input(), input({ ranged: true }));
    const hp = s.fighters[0].hp;
    advance(s, 0.1, input({ dodge: true }), input({ ranged: true }));
    expect(s.fighters[0].hp).toBe(hp); expect(s.effects.some(e => e.kind === 'trail')).toBe(true);
    advance(s, 0.12, input({ dodge: true }), input({ ranged: true }));
    expect(s.fighters[0].hp).toBeLessThan(hp); expect(s.fighters[0].dodgeTime).toBeGreaterThan(0);
    advance(s, 0.3, input({ dodge: true }));
    expect(s.fighters[0].dodgeTime).toBe(0); expect(s.fighters[0].dodgeCooldown).toBeGreaterThan(0);
  });
  it('freezes a completed match and deterministically reproduces inputs', () => {
    const s = clear(); s.fighters[1].pos.x = 385; s.fighters[1].hp = 5;
    advance(s, 0.2, input({ melee: true }));
    expect(s.winner).toBe(0); expect(s.fighters[1].hp).toBe(0); expect(s.beams).toHaveLength(0);
    const snapshot = JSON.stringify(s); advance(s, 2, input({ ranged: true })); expect(JSON.stringify(s)).toBe(snapshot);
    const a = createBattle('charmander', 42), b = createBattle('charmander', 42);
    advance(a, 4, input({ ranged: true }), input({ special: true })); advance(b, 4, input({ ranged: true }), input({ special: true }));
    expect(a).toEqual(b);
    for (const dt of [0, -1, NaN, Infinity]) stepBattle(a, [input(), input()], dt);
    expect(a).toEqual(b);
  });
});
