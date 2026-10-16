import { WORLD, emptyCommand, type BattleState, type Command, type Vec } from './types';
import { BULBASAUR as B, IVYSAUR as I, VENUSAUR as V } from './grassMoves';

interface Memory { nextThink: number; lastTime: number; command: Command }
// Memory belongs to a match, so restart and parallel simulation need no global reset.
const memories = new WeakMap<BattleState, Map<number, Memory>>();
const unit = (v: Vec): Vec => {
  const length = Math.hypot(v.x, v.y);
  return length > 0.0001 ? { x: v.x / length, y: v.y / length } : { x: 1, y: 0 };
};
const copy = (command: Command): Command => ({ ...command, move: { ...command.move }, aim: command.aim && { ...command.aim } });

/** A readable, deliberately imperfect opponent using the player's command API. */
export function aiCommand(state: BattleState, id: number, dt: number): Command {
  if (state.winner !== null || (id !== 0 && id !== 1) || !Number.isFinite(dt) || dt <= 0) return emptyCommand();
  let match = memories.get(state);
  if (!match) { match = new Map(); memories.set(state, match); }
  let memory = match.get(id);
  if (!memory || state.time < memory.lastTime) {
    memory = { nextThink: 0, lastTime: state.time, command: emptyCommand() };
    match.set(id, memory);
  }
  memory.lastTime = state.time;
  if (state.time + Math.min(dt, 1 / 60) < memory.nextThink) return copy(memory.command);
  // Aim and threat recognition update fewer than five times a second. There is
  // no velocity prediction, hidden input reading, or extra combat advantage.
  memory.nextThink = state.time + 0.22;
  const self = state.fighters[id];
  const target = state.fighters[1 - id];
  const delta = { x: target.pos.x - self.pos.x, y: target.pos.y - self.pos.y };
  const distance = Math.hypot(delta.x, delta.y);
  const toward = unit(delta);
  const phase = state.time + (state.seed % 31) * 0.07 + id * 0.43;
  const side = Math.floor(phase / 2.4) % 2 === 0 ? 1 : -1;
  const tangent = { x: -toward.y * side, y: toward.x * side };
  const holdingChannel = self.action === 'ranged' && (self.phase === 'windup' || self.phase === 'active');
  const enemyChannel = target.action === 'ranged' && (target.phase === 'windup' || target.phase === 'active');
  // Rotate between a sustained stream exchange and a deliberate close approach.
  // Do not switch an already-started channel when this tactic window changes.
  const rush = phase % 9 > 5.6 || self.energy < 24;
  const punish = target.phase === 'recovery' && distance < 205;
  const counter = enemyChannel && self.energy >= 38 && Math.floor(phase / 3) % 3 !== 0;
  const electric = self.species === 'pikachu';
  const grass = self.species === 'bulbasaur';
  const ivy = self.species === 'ivysaur';
  const venus = self.species === 'venusaur';
  // Quick Attack reaches farther, while Thunder still targets the shared 170px zone.
  const meleeRange = venus ? V.petals.range : ivy ? I.vine.range : grass ? B.vine.range : electric ? 89 : 79;
  const preferred = venus && (rush || punish || distance < 180) ? 80 : venus ? (self.specialCooldown <= 0 && self.energy >= V.roots.cost ? 285 : V.bomb.range) : rush || punish ? (ivy ? 115 : grass ? 85 : electric ? 63 : 53) : self.species === 'charmander' ? 175 : electric ? 195 : 205;
  const advance = distance > preferred + 20 ? 0.8 : distance < preferred - 40 ? -0.4 : 0;
  const strafe = holdingChannel || counter ? 0.045 : enemyChannel ? 0.45 : 0.15;
  const move = { x: toward.x * advance + tangent.x * strafe, y: toward.y * advance + tangent.y * strafe };
  const error = Math.sin(phase * 2.1) * (counter ? 0.008 : 0.035);
  const aim = { x: toward.x * Math.cos(error) - toward.y * Math.sin(error), y: toward.x * Math.sin(error) + toward.y * Math.cos(error) };
  let dodge = false;
  const danger = state.hazards.find(h => h.owner !== id && h.life > 0 && Math.hypot(self.pos.x - h.pos.x, self.pos.y - h.pos.y) < h.radius + self.radius + 28);
  if (danger) {
    const away = unit({ x: self.pos.x - danger.pos.x, y: self.pos.y - danger.pos.y });
    move.x = away.x; move.y = away.y;
    dodge = self.dodgeCooldown <= 0 && danger.warmup < 0.3;
  } else if (!holdingChannel && !counter && enemyChannel && self.dodgeCooldown <= 0 && phase % 3.6 < 1.15) {
    // Dodge a visible, approximately aligned stream sometimes, never all attacks.
    const alignment = -toward.x * target.facing.x - toward.y * target.facing.y;
    if (distance < 370 && alignment > 0.94) {
      dodge = true; move.x = tangent.x; move.y = tangent.y;
    }
  } else if (!holdingChannel && punish && distance > 120 && self.dodgeCooldown <= 0 && phase % 4 < 1) {
    dodge = true; move.x = toward.x; move.y = toward.y;
  }

  // Steer around intact obstacles ahead; the engine remains the collision authority.
  for (const obstacle of state.obstacles) {
    if (obstacle.hp <= 0) continue;
    const offset = { x: self.pos.x - obstacle.pos.x, y: self.pos.y - obstacle.pos.y };
    const gap = Math.hypot(offset.x, offset.y);
    if (gap < obstacle.radius + self.radius + 60 && offset.x * move.x + offset.y * move.y < 0) {
      const normal = unit(offset);
      const into = move.x * normal.x + move.y * normal.y;
      move.x -= normal.x * into; move.y -= normal.y * into;
      move.x += -normal.y * side * 0.55 + normal.x * 0.15;
      move.y += normal.x * side * 0.55 + normal.y * 0.15;
    }
  }
  if (self.pos.x < WORLD.left + 55) move.x = Math.max(move.x, 0.5);
  if (self.pos.x > WORLD.right - 55) move.x = Math.min(move.x, -0.5);
  if (self.pos.y < WORLD.top + 55) move.y = Math.max(move.y, 0.5);
  if (self.pos.y > WORLD.bottom - 55) move.y = Math.min(move.y, -0.5);
  // React to visible projectiles, without clearing a seed just by rolling.
  if (!holdingChannel && self.dodgeCooldown <= 0 && phase % 2.8 < 1.1 && state.projectiles.some(p => p.owner !== id && Math.hypot(p.pos.x - self.pos.x, p.pos.y - self.pos.y) < 95)) {
    dodge = true; move.x = tangent.x; move.y = tangent.y;
  }
  // Solar Beam exposes its locked line before firing; use that visible warning.
  if (target.species === 'ivysaur' && target.action === 'special' && target.phase === 'windup' && target.phaseTime <= I.solar.lockTime && distance < I.solar.range) {
    const alignment = -toward.x * target.facing.x - toward.y * target.facing.y;
    if (alignment > .97) {
      move.x = tangent.x; move.y = tangent.y;
      dodge = self.dodgeCooldown <= 0;
    }
  }
  // Visible landing/root warnings, with the same reaction cadence as all other threats.
  const plantDanger = state.plantAttacks.find(a => a.owner !== id && a.points.some((p, i) => a.age < (a.kind === 'bomb' ? V.bomb.flight : V.roots.warning + i * V.roots.interval) && Math.hypot(self.pos.x - p.x, self.pos.y - p.y) < (a.kind === 'bomb' ? V.bomb.radius : V.roots.radius) + self.radius));
  if (plantDanger && !holdingChannel) {
    move.x = tangent.x; move.y = tangent.y;
    if (self.dodgeCooldown <= 0 && plantDanger.age > .3) dodge = true;
  }
  if (target.species === 'venusaur' && target.action === 'special' && target.phase === 'windup' && !holdingChannel && distance < 350 && -toward.x * target.facing.x - toward.y * target.facing.y > .97) {
    move.x = tangent.x; move.y = tangent.y;
    dodge = self.dodgeCooldown <= 0 && target.phaseTime < .25;
  }
  const enemyPreparingSpecial = target.action === 'special' && target.phase === 'windup';
  const castSpecial = !holdingChannel && !danger && !counter && !enemyPreparingSpecial && self.specialCooldown <= 0 && self.energy >= 40 && distance > 105 && distance < (grass || ivy ? 300 : 235) && (!grass || !state.leechSeeds.some(seed => seed.owner === id));
  memory.command = {
    move, aim, dodge,
    melee: !holdingChannel && !danger && distance < meleeRange,
    special: castSpecial,
    // Preserve windup AND active channel, independent of changing tactic/distance.
    // Hazard escape is the only intentional early cancel, through the normal dodge.
    ranged: holdingChannel || (!danger && !castSpecial && distance >= meleeRange + 1 && distance < (electric ? 375 : 335) && self.energy >= (grass || ivy ? 12 : 38) && (!rush || counter)),
  };
  if (venus) {
    memory.command.special = !danger && !holdingChannel && (enemyChannel || target.phase === 'recovery' || distance > 285) && !enemyPreparingSpecial && self.specialCooldown <= 0 && self.energy >= V.roots.cost && distance > 135 && distance < 335;
    memory.command.ranged = !danger && !memory.command.special && self.energy >= V.bomb.cost && distance > 160 && distance < 305;
    memory.command.melee = !danger && distance < V.petals.range;
  }
  if (grass) {
    if (self.rangedNeedsRelease) memory.command.ranged = false;
    // Decisions still occur at the same 0.22s cadence. Charge time is visible to players too.
    const prepareCombo = state.leechSeeds.some(seed => seed.owner === id) || state.projectiles.some(p => p.owner === id && p.kind === 'seed');
    memory.command.rangedHeld = memory.command.ranged && (self.action === 'ranged' && self.phase === 'windup' ? self.chargeTime + 1e-7 < B.leaf.perfectStart : prepareCombo || distance > 240);
  }
  return copy(memory.command);
}
