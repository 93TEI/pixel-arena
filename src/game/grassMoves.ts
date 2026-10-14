import type { Species } from './types';

// Combat and Korean help read the same numbers. These are arena adaptations, not main-game stats.
export const BULBASAUR = {
  speed: 168, overgrow: 1.3,
  vine: { damage: 9, range: 110, halfAngle: Math.PI / 4, windup: .12, active: .14, recovery: .18, cooldown: .55, propDamage: 18, combo: 5 },
  leaf: { damage: 12, chargedDamage: 20, perfectDamage: 26, cost: 12, minimum: .12, charged: .55, perfectStart: .65, perfectEnd: .85, maximum: 1.2, active: .1, recovery: .22, cooldown: .75, speed: 480, range: 420, radius: 10, chargedRadius: 5, combo: 5, chargedCombo: 8 },
  seed: { cost: 25, cooldown: 6.5, windup: .3, active: .12, recovery: .18, speed: 360, range: 400, radius: 7, duration: 4, drain: 2, interval: 1, ticks: 4 },
};
export const IVYSAUR = {
  speed: 173, overgrow: 1.3,
  vine: { damage: 9, tipDamage: 18, tipStart: 90, range: 145, halfAngle: .3, windup: .18, active: .14, recovery: .18, cooldown: .7, propDamage: 22 },
  leaf: { damage: 8, returnDamage: 14, cost: 12, windup: .2, active: .1, recovery: .2, cooldown: 1.1, speed: 360, range: 260, radius: 8, lifetime: 2.3 },
  solar: { damage: 32, cost: 30, cooldown: 6.5, windup: .85, lockTime: .35, active: .12, recovery: .35, range: 430, radius: 7 },
};
export const isGrass = (species: Species) => species === 'bulbasaur' || species === 'ivysaur';
export function leafTier(seconds: number): 'basic' | 'charged' | 'perfect' {
  const l = BULBASAUR.leaf;
  return seconds + 1e-7 < l.charged ? 'basic' : seconds + 1e-7 >= l.perfectStart && seconds <= l.perfectEnd + 1e-7 ? 'perfect' : 'charged';
}
export interface MoveHelp { key: string; name: string; description: string }
export function grassHelp(species: Species): MoveHelp[] {
  const b = BULBASAUR, i = IVYSAUR;
  if (species === 'bulbasaur') return [
    { key: 'J', name: '덩굴채찍', description: `전방 ${b.vine.range}px를 넓게 휘둘러 피해 ${b.vine.damage}. 씨앗이 붙은 적에게 명중하면 씨앗을 소모하여 추가 피해 ${b.vine.combo}. 재사용 ${b.vine.cooldown}초. 옆으로 빠지거나 장애물로 막을 수 있습니다.` },
    { key: 'K / 클릭', name: '잎날가르기', description: `탭: 넓은 잎 한 발, 피해 ${b.leaf.damage}. ${b.leaf.charged}초 이상 길게 누르면 좁은 잎, 피해 ${b.leaf.chargedDamage}. ${b.leaf.perfectStart}~${b.leaf.perfectEnd}초의 밝은 구간에 놓으면 피해 ${b.leaf.perfectDamage}. 씨앗 연계: 기본 +${b.leaf.combo}, 충전·정밀 +${b.leaf.chargedCombo}, 씨앗과 남은 흡수 소모. 에너지 ${b.leaf.cost}, 발사 후 재사용 ${b.leaf.cooldown}초. ${b.leaf.maximum}초에 자동 발사, 다시 눌러야 재발사. 충전 중 이동 60%, 회피로 취소하면 에너지는 반환되지 않습니다. 좁은 잎은 옆걸음·회피·엄폐로 대응할 수 있습니다.` },
    { key: 'L', name: '씨뿌리기', description: `씨앗 명중 즉시 ${b.seed.drain} HP 흡수, 이후 ${b.seed.interval}초마다 흡수하여 최대 ${b.seed.drain * b.seed.ticks} HP. 표식 ${b.seed.duration}초. J·K 명중으로 한 번만 소모하여 추가 피해. 풀 타입은 흡수 면역이지만 연계 표식은 적용됩니다. 에너지 ${b.seed.cost}, 재사용 ${b.seed.cooldown}초. 날아오는 씨앗이나 후속 공격을 피하세요. 붙은 씨앗은 회피만으로 해제되지 않습니다.` },
    { key: '패시브', name: '심록', description: `HP 1/3 이하: 덩굴·잎 직접 피해 +${Math.round((b.overgrow - 1) * 100)}%. 흡수와 연계 추가 피해에는 적용되지 않습니다.` },
  ];
  if (species === 'ivysaur') return [
    { key: 'J', name: '덩굴채찍', description: `전방 ${i.vine.range}px의 좁은 덩굴. 가까운 적 피해 ${i.vine.damage}, ${i.vine.tipStart}~${i.vine.range}px 거리에서 끝으로 맞히면 피해 ${i.vine.tipDamage}. 준비 ${i.vine.windup}초, 재사용 ${i.vine.cooldown}초. 거리 조절로 보상을 얻고, 상대는 옆걸음·회피·엄폐로 대응합니다.` },
    { key: 'K / 클릭', name: '잎날가르기', description: `되돌아오는 잎: 나갈 때 피해 ${i.leaf.damage}, 돌아올 때 피해 ${i.leaf.returnDamage}, 왕복 명중 합계 ${i.leaf.damage + i.leaf.returnDamage}. 이동하여 돌아오는 궤적을 바꿔 다시 맞히세요. 적은 각 구간 1회만 피해를 받으며 잎은 장애물에 막힙니다. 에너지 ${i.leaf.cost}, 재사용 ${i.leaf.cooldown}초. 원작의 잎 공격을 왕복 투척으로 각색했습니다.` },
    { key: 'L', name: '솔라빔', description: `${i.solar.windup}초 제자리에서 모은 뒤 좁은 직선 한 발, 피해 ${i.solar.damage}, 사거리 ${i.solar.range}px. 마지막 ${i.solar.lockTime}초에는 조준이 고정됩니다. 예고선을 보고 옆으로 피하거나 엄폐할 수 있습니다. 에너지 ${i.solar.cost}, 재사용 ${i.solar.cooldown}초. 준비 중 강한 피격으로 취소될 수 있습니다.` },
    { key: '패시브', name: '심록', description: `HP 1/3 이하: 덩굴·왕복 잎·솔라빔 직접 피해 +${Math.round((i.overgrow - 1) * 100)}%. 끝거리와 왕복 명중의 피해도 강화됩니다.` },
  ];
  return [];
}
