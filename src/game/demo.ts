import { createBattle } from './battle';
import { emptyCommand, type BattleState, type Command, type Vec } from './types';

export const DEMO_SEGMENTS = [
  { duration: 6, title: '01 · 방향별 이동 → 돌진 → 근접 모션', reference: '00:00–00:02 / 00:15–00:19' },
  { duration: 7, title: '02 · 화염과 물줄기 충돌 · 수증기', reference: '00:19.75–00:21.75' },
  { duration: 7, title: '03 · 차지 → 불꽃 소용돌이 / 물 회오리', reference: '00:05.50–00:11.75' },
  { duration: 6, title: '04 · 타격 → 넉백 → 장애물 파괴', reference: '00:00–00:02 / 00:18.50–00:19.50' },
] as const;

/** Every demonstration runs the normal combat simulation, with scripted inputs only. */
export function createDemoScene(index: number): BattleState {
  const state = createBattle('charmander', 42);
  const [a, b] = state.fighters;
  if (index === 0) {
    a.pos = { x: 345, y: 305 }; b.pos = { x: 610, y: 305 };
  } else if (index === 1) {
    a.pos = { x: 305, y: 310 }; b.pos = { x: 655, y: 310 };
  } else if (index === 2) {
    a.pos = { x: 310, y: 238 }; b.pos = { x: 650, y: 378 };
  } else {
    a.pos = { x: 344, y: 315 }; b.pos = { x: 397, y: 315 };
    state.obstacles = [
      { id: 7001, kind: 'crate', pos: { x: 471, y: 315 }, radius: 23, hp: 20, maxHp: 20 },
      { id: 7002, kind: 'crate', pos: { x: 550, y: 315 }, radius: 23, hp: 20, maxHp: 20 },
      { id: 7003, kind: 'rock', pos: { x: 740, y: 400 }, radius: 29, hp: 55, maxHp: 55 },
    ];
  }
  return state;
}

function aim(from: Vec, to: Vec): Vec {
  const x = to.x - from.x, y = to.y - from.y, length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

export function demoCommands(state: BattleState, index: number, time: number): [Command, Command] {
  const a = emptyCommand(), b = emptyCommand();
  const [self, other] = state.fighters;
  a.aim = aim(self.pos, other.pos); b.aim = aim(other.pos, self.pos);
  if (index === 0) {
    if (time < 2.8) {
      a.move = { x: Math.cos(time * 2.25), y: Math.sin(time * 2.25) };
      b.move = { x: -Math.cos(time * 2.25), y: -Math.sin(time * 2.25) };
      a.aim = { ...a.move }; b.aim = { ...b.move };
    } else {
      const distance = Math.hypot(other.pos.x - self.pos.x, other.pos.y - self.pos.y);
      a.move = distance > 52 ? { ...a.aim } : { x: 0, y: 0 };
      b.move = distance > 52 ? { ...b.aim } : { x: 0, y: 0 };
      a.dodge = time > 2.9 && time < 3.15;
      b.dodge = time > 3.2 && time < 3.45;
      a.melee = distance < 82; b.melee = distance < 68 && time % 1.2 > 0.6;
    }
  } else if (index === 1) {
    a.ranged = time > 0.2; b.ranged = time > 0.2;
    a.move.y = Math.sin(time * 1.1) * 0.12;
    b.move.y = -Math.sin(time * 1.1) * 0.12;
  } else if (index === 2) {
    a.aim = { x: 1, y: 0 }; b.aim = { x: -1, y: 0 };
    a.special = time > 0.3 && time < 0.7;
    b.special = time > 1.2 && time < 1.6;
    if (time > 2.5 && time < 3.2) {
      a.move = { x: 0.75, y: 0.45 }; b.move = { x: -0.75, y: -0.45 };
    }
    if (time > 3.2) {
      a.aim = aim(self.pos, other.pos); b.aim = aim(other.pos, self.pos);
      a.ranged = time > 4.2; b.ranged = time > 4.2;
      a.dodge = time < 3.5; b.dodge = time < 3.5;
      a.move.y = -0.12; b.move.y = 0.12;
    }
  } else {
    const distance = Math.hypot(other.pos.x - self.pos.x, other.pos.y - self.pos.y);
    a.move = distance > 45 && time < 2.8 ? { x: a.aim.x * 0.65, y: a.aim.y * 0.65 } : { x: 0, y: 0 };
    a.melee = time > 0.3 && time < 2.8;
    b.ranged = time > 3.8;
  }
  return [a, b];
}
