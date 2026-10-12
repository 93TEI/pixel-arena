import { describe, expect, it } from 'vitest';
import { aiCommand } from '../src/game/ai';
import { createBattle, stepBattle } from '../src/game/battle';
import { WORLD, emptyCommand, type Species } from '../src/game/types';

describe('opponent AI', () => {
  const roster: Species[] = ['charmander', 'squirtle', 'pikachu'];
  for (const player of roster) for (const opponent of roster) {
    if (player === opponent) continue;
    it(`${player} versus ${opponent} completes a finite, legal AI duel`, () => {
      const state = createBattle(player, 42, opponent);
      const actions = new Map<number, Set<string>>([[0, new Set()], [1, new Set()]]);
      for (let frame = 0; frame < 120 * 60 && state.winner === null; frame++) {
        stepBattle(state, [aiCommand(state, 0, 1 / 60), aiCommand(state, 1, 1 / 60)], 1 / 60);
        for (const fighter of state.fighters) {
          actions.get(fighter.id)!.add(fighter.action);
          expect(Number.isFinite(fighter.pos.x) && Number.isFinite(fighter.pos.y)).toBe(true);
          expect(fighter.pos.x).toBeGreaterThanOrEqual(WORLD.left + fighter.radius);
          expect(fighter.pos.x).toBeLessThanOrEqual(WORLD.right - fighter.radius);
          expect(fighter.pos.y).toBeGreaterThanOrEqual(WORLD.top + fighter.radius);
          expect(fighter.pos.y).toBeLessThanOrEqual(WORLD.bottom - fighter.radius);
          expect(fighter.hp).toBeGreaterThanOrEqual(0);
          expect(fighter.energy).toBeGreaterThanOrEqual(0);
          expect(fighter.energy).toBeLessThanOrEqual(fighter.maxEnergy);
        }
      }
      expect(state.winner).not.toBeNull();
      expect(state.fighters[1 - state.winner!].hp).toBe(0);
      const pikachu = state.fighters.find(fighter => fighter.species === 'pikachu');
      if (pikachu) {
        const used = actions.get(pikachu.id)!;
        expect(used.has('ranged')).toBe(true);
        expect(used.has('melee')).toBe(true);
        // A short duel may end before the midrange special window opens.
        expect(used.size).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it('uses Pikachu Quick Attack in its additional reach and aims Thunder at midrange', () => {
    const close = createBattle('squirtle', 42, 'pikachu');
    close.fighters[1].pos.x = close.fighters[0].pos.x + 85;
    const quick = aiCommand(close, 1, 1 / 60);
    expect(quick.melee).toBe(true);
    expect(quick.ranged).toBe(false);
    const mid = createBattle('charmander', 42, 'pikachu');
    mid.fighters[1].pos.x = mid.fighters[0].pos.x + 170;
    expect(aiCommand(mid, 1, 1 / 60).special).toBe(true);
    const far = createBattle('charmander', 42, 'pikachu');
    far.fighters[1].pos.x = far.fighters[0].pos.x + 360;
    expect(aiCommand(far, 1, 1 / 60).ranged).toBe(true);
  });

  it('returns commands without changing battle state and does not aim instantly', () => {
    const state = createBattle('charmander', 17);
    const before = JSON.stringify(state);
    const first = aiCommand(state, 1, 1 / 60);
    expect(JSON.stringify(state)).toBe(before);
    state.time = 0.05;
    state.fighters[0].pos.y += 100;
    expect(aiCommand(state, 1, 1 / 60).aim).toEqual(first.aim);
    state.time = 0.25;
    expect(aiCommand(state, 1, 1 / 60).aim).not.toEqual(first.aim);
  });

  for (const species of ['charmander', 'squirtle'] as Species[]) {
    it(`${species} match finishes against an idle player with finite, confined fighters`, () => {
      const state = createBattle(species, 42);
      for (let i = 0; i < 60 * 60 && state.winner === null; i++) {
        stepBattle(state, [emptyCommand(), aiCommand(state, 1, 1 / 60)], 1 / 60);
        for (const f of state.fighters) {
          expect(Number.isFinite(f.pos.x) && Number.isFinite(f.pos.y)).toBe(true);
          expect(f.pos.x).toBeGreaterThanOrEqual(WORLD.left + f.radius);
          expect(f.pos.x).toBeLessThanOrEqual(WORLD.right - f.radius);
          expect(f.pos.y).toBeGreaterThanOrEqual(WORLD.top + f.radius);
          expect(f.pos.y).toBeLessThanOrEqual(WORLD.bottom - f.radius);
        }
      }
      expect(state.winner).toBe(1);
    });
  }

  it('replays a full duel deterministically and reaches a knockout', () => {
    const a = createBattle('charmander', 8);
    const b = createBattle('charmander', 8);
    const actions = new Set<string>();
    let clashFrames = 0;
    for (let i = 0; i < 120 * 60 && a.winner === null; i++) {
      for (const state of [a, b]) stepBattle(state, [aiCommand(state, 0, 1 / 60), aiCommand(state, 1, 1 / 60)], 1 / 60);
      for (const fighter of a.fighters) {
        if (fighter.action !== 'none') actions.add(fighter.action);
        expect(Number.isFinite(fighter.pos.x) && Number.isFinite(fighter.pos.y)).toBe(true);
      }
      if (a.clash) clashFrames++;
    }
    expect(a).toEqual(b);
    expect(a.winner).not.toBeNull();
    expect(actions.has('ranged')).toBe(true);
    expect(actions.has('special')).toBe(true);
    expect(actions.has('melee')).toBe(true);
    expect(actions.has('dodge')).toBe(true);
    expect(clashFrames).toBeGreaterThan(15);
  });

  it('commits through ranged windup and a full channel instead of tapping stream', () => {
    const state = createBattle('charmander', 8);
    let activeFrames = 0;
    let windupFrames = 0;
    let started = false;
    for (let i = 0; i < 5 * 60; i++) {
      const self = state.fighters[1];
      const command = aiCommand(state, 1, 1 / 60);
      if (self.action === 'ranged' && (self.phase === 'windup' || self.phase === 'active')) {
        expect(command.ranged).toBe(true);
        if (self.phase === 'active') activeFrames++;
        else windupFrames++;
        started = true;
      } else if (started) break;
      stepBattle(state, [emptyCommand(), command], 1 / 60);
    }
    expect(windupFrames).toBeGreaterThan(10);
    expect(activeFrames).toBeGreaterThan(138);
  });

  it('escapes an enemy area telegraph after its visible decision delay', () => {
    const state = createBattle('squirtle', 8);
    const self = state.fighters[1];
    aiCommand(state, 1, 1 / 60);
    state.hazards.push({ id: 99, owner: 0, species: 'squirtle', pos: { x: self.pos.x - 20, y: self.pos.y }, radius: 70, life: 2.85, maxLife: 2.85, warmup: 0.25, damageTimer: 0 });
    state.time = 0.1;
    expect(aiCommand(state, 1, 1 / 60).dodge).toBe(false);
    state.time = 0.24;
    const escape = aiCommand(state, 1, 1 / 60);
    expect(escape.dodge).toBe(true);
    expect(escape.move.x).toBeGreaterThan(0);
  });

  it('lets either player species win by dashing through a stream and punishing at melee range', () => {
    for (const species of ['charmander', 'squirtle'] as Species[]) {
      const state = createBattle(species, 42);
      for (let i = 0; i < 90 * 60 && state.winner === null; i++) {
        const [player, target] = state.fighters;
        const delta = { x: target.pos.x - player.pos.x, y: target.pos.y - player.pos.y };
        const distance = Math.hypot(delta.x, delta.y);
        const move = distance > 43 ? { x: delta.x / distance, y: delta.y / distance } : { x: 0, y: 0 };
        const dodge = distance > 110 && distance < 240 && target.action === 'ranged' && player.dodgeCooldown <= 0;
        stepBattle(state, [{ move, aim: delta, melee: distance < 77, ranged: false, dodge }, aiCommand(state, 1, 1 / 60)], 1 / 60);
      }
      expect(state.winner).toBe(0);
    }
  });

  it('ignores invalid IDs, invalid frame times, and completed matches', () => {
    const state = createBattle('squirtle');
    expect(aiCommand(state, 2, 1 / 60)).toEqual(emptyCommand());
    expect(aiCommand(state, 1, NaN)).toEqual(emptyCommand());
    state.winner = 0;
    expect(aiCommand(state, 1, 1 / 60)).toEqual(emptyCommand());
  });
});
