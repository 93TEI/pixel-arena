import { describe, expect, it } from 'vitest';
import { stepBattle } from '../src/game/battle';
import { createDemoScene, demoCommands, DEMO_SEGMENTS } from '../src/game/demo';

describe('video motion demonstration uses playable mechanics', () => {
  it('shows movement, clash, both elemental zones, and real destruction in its four segments', () => {
    const seen = { walk: false, melee: false, dodge: false, clash: false, fire: false, water: false, destruction: false };
    for (let index = 0; index < DEMO_SEGMENTS.length; index++) {
      const state = createDemoScene(index);
      for (let frame = 0; frame < DEMO_SEGMENTS[index].duration * 60; frame++) {
        const time = frame / 60;
        stepBattle(state, demoCommands(state, index, time), 1 / 60);
        for (const f of state.fighters) {
          seen.walk ||= Math.hypot(f.moveVelocity.x, f.moveVelocity.y) > 30;
          seen.melee ||= f.action === 'melee' && f.phase === 'active';
          seen.dodge ||= f.action === 'dodge' && f.phase === 'active';
          expect(Number.isFinite(f.pos.x + f.pos.y + f.hp)).toBe(true);
        }
        seen.clash ||= !!state.clash;
        seen.fire ||= state.hazards.some(h => h.species === 'charmander' && h.warmup <= 0);
        seen.water ||= state.hazards.some(h => h.species === 'squirtle' && h.warmup <= 0);
        seen.destruction ||= index === 3 && state.obstacles.length < 3 && state.groundMarks.some(m => m.kind === 'crater');
      }
    }
    expect(seen).toEqual({ walk: true, melee: true, dodge: true, clash: true, fire: true, water: true, destruction: true });
  });
});
