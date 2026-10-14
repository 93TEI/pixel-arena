import { BULBASAUR as B, IVYSAUR as I, isGrass, leafTier } from './grassMoves';
import { WORLD, type BattleState, type Beam, type Command, type Effect, type Fighter, type FighterAction, type ActionPhase, type GroundMark, type Obstacle, type Species, type Vec } from './types';

// Timing and damage are explicit prototype adaptations of the reference video.
const SPEED: Record<Species, number> = { bulbasaur: B.speed, ivysaur: I.speed, charmander: 178, squirtle: 170, pikachu: 205, mewtwo: 182 };
const EPSILON = 1e-7;
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const length = (v: Vec) => Math.hypot(v.x, v.y);
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const unit = (v: Vec): Vec => { const n = length(v); return n > EPSILON ? { x: v.x / n, y: v.y / n } : { x: 1, y: 0 }; };
const angle = (v: Vec) => Math.atan2(v.y, v.x);
const point = (p: Vec, d: Vec, distance: number): Vec => ({ x: p.x + d.x * distance, y: p.y + d.y * distance });
const pulse = (time: number, dt: number, interval: number) => Math.floor((time + EPSILON) / interval) !== Math.floor((time - dt + EPSILON) / interval);

function fighter(id: number, species: Species): Fighter {
  return { id, species, pos: { x: id === 0 ? 330 : 630, y: 312 }, facing: { x: id === 0 ? 1 : -1, y: 0 }, hp: 100, maxHp: 100, radius: 15,
    meleeCooldown: 0, rangedCooldown: 0, dodgeCooldown: 0, dodgeTime: 0, stunTime: 0, attackTime: 0, hitTime: 0, velocity: { x: 0, y: 0 },
    chargeTime: 0, chargeRelease: null, rangedNeedsRelease: false, chargeSuspended: false, action: 'none', phase: 'idle', phaseTime: 0, phaseDuration: 0, actionTime: 0, energy: 100, maxEnergy: 100, specialCooldown: 0, paralysisTime: 0, knockdownTime: 0, moveVelocity: { x: 0, y: 0 } };
}

export function createBattle(species: Species, seed = 20261011, opponent?: Species): BattleState {
  const spots: [Obstacle['kind'], number, number][] = [['crate', 230, 190], ['crate', 730, 190], ['crate', 270, 438], ['crate', 690, 438], ['rock', 130, 330], ['rock', 830, 330]];
  return { fighters: [fighter(0, species), fighter(1, opponent ?? (species === 'squirtle' ? 'charmander' : 'squirtle'))], projectiles: [], effects: [], time: 0, winner: null, nextId: 7, seed: seed >>> 0,
    beams: [], clash: null, hazards: [], groundMarks: [], cameraImpact: 0, leechSeeds: [],
    obstacles: spots.map(([kind, x, y], i) => ({ id: i + 1, kind, pos: { x, y }, radius: kind === 'crate' ? 22 : 26, hp: kind === 'crate' ? 28 : 66, maxHp: kind === 'crate' ? 28 : 66 })) };
}

function effect(s: BattleState, kind: Effect['kind'], pos: Vec, species: Species, life = 0.3, direction = 0, size = 1) {
  s.effects.push({ id: s.nextId++, kind, pos: { ...pos }, species, life, maxLife: life, angle: direction, size });
}
function mark(s: BattleState, kind: GroundMark['kind'], pos: Vec, radius: number) {
  s.groundMarks.push({ id: s.nextId++, kind, pos: { ...pos }, radius, life: 24, angle: (s.nextId * 2.39996) % (Math.PI * 2) });
  if (s.groundMarks.length > 48) s.groundMarks.shift();
}
function phase(f: Fighter, action: FighterAction, value: ActionPhase, duration: number) {
  f.action = action; f.phase = value; f.phaseTime = duration; f.phaseDuration = duration;
  f.attackTime = value === 'idle' ? 0 : duration;
}
function idle(f: Fighter) { phase(f, 'none', 'idle', 0); f.actionTime = 0; }
function confine(f: Fighter) {
  f.pos.x = clamp(f.pos.x, WORLD.left + f.radius, WORLD.right - f.radius);
  f.pos.y = clamp(f.pos.y, WORLD.top + f.radius, WORLD.bottom - f.radius);
}
function obstacleDamage(s: BattleState, obstacle: Obstacle, damage: number, species: Species) {
  if (obstacle.hp <= 0) return;
  obstacle.hp = Math.max(0, obstacle.hp - damage);
  if (obstacle.hp === 0) {
    effect(s, 'debris', obstacle.pos, species, 0.85, 0, obstacle.radius);
    effect(s, 'dust', obstacle.pos, species, 0.55, 0, obstacle.radius);
    mark(s, 'crater', obstacle.pos, obstacle.radius + 7);
    s.cameraImpact = Math.max(s.cameraImpact, 0.5);
  }
}
function damage(s: BattleState, target: Fighter, amount: number, direction: Vec, force: number, species: Species, knockdown = false) {
  // Only the first 0.16 seconds of a 0.24-second roll are invulnerable.
  if (target.hp <= 0 || target.dodgeTime > 0.08 || target.knockdownTime > 0.12) return false;
  target.hp = Math.max(0, target.hp - amount);
  if (target.hitTime <= 0) effect(s, 'hit', target.pos, species, 0.18, angle(direction));
  target.hitTime = Math.max(target.hitTime, 0.1);
  if (force > 0) {
    target.velocity = { x: direction.x * force, y: direction.y * force };
    if (force >= 200) {
      target.stunTime = Math.max(target.stunTime, 0.22);
      phase(target, 'none', 'recovery', 0.22);
      target.dodgeTime = 0;
      if (knockdown) target.knockdownTime = 0.48;
      s.cameraImpact = Math.max(s.cameraImpact, 0.34);
    }
  }
  return true;
}

const grassPower = (f: Fighter) => f.hp <= f.maxHp / 3 ? (f.species === 'ivysaur' ? I.overgrow : B.overgrow) : 1;
function comboDamage(s: BattleState, f: Fighter, target: Fighter, direct: number, bonus: number, direction: Vec, force: number) {
  const seed = s.leechSeeds.find(seed => seed.owner === f.id && seed.target === target.id);
  if (damage(s, target, direct + (seed ? bonus : 0), direction, force, f.species) && seed) {
    s.leechSeeds = s.leechSeeds.filter(item => item !== seed);
    effect(s, 'combo', target.pos, f.species, .45, 0, bonus);
    s.cameraImpact = Math.max(s.cameraImpact, .2);
  }
}
function grassProjectile(s: BattleState, f: Fighter, kind: 'leaf' | 'seed' | 'returnLeaf') {
  const tier = leafTier(f.chargeRelease ?? f.chargeTime);
  const leaf = B.leaf, seed = B.seed;
  const speed = kind === 'seed' ? seed.speed : kind === 'returnLeaf' ? I.leaf.speed : leaf.speed;
  s.projectiles.push({ id: s.nextId++, owner: f.id, species: f.species, kind,
    pos: point(f.pos, f.facing, f.radius), velocity: point({ x: 0, y: 0 }, f.facing, speed),
    radius: kind === 'seed' ? seed.radius : kind === 'returnLeaf' ? I.leaf.radius : tier === 'basic' ? leaf.radius : leaf.chargedRadius,
    life: kind === 'seed' ? seed.range / speed : kind === 'returnLeaf' ? I.leaf.lifetime : leaf.range / speed,
    damage: kind === 'seed' ? 0 : (kind === 'returnLeaf' ? I.leaf.damage : tier === 'basic' ? leaf.damage : tier === 'perfect' ? leaf.perfectDamage : leaf.chargedDamage) * grassPower(f),
    combo: kind === 'leaf' ? tier === 'basic' ? leaf.combo : leaf.chargedCombo : 0,
    tier, travelled: 0, returning: false, hitLeg: false, returnDamage: I.leaf.returnDamage * grassPower(f),
  });
}
function clearLine(s: BattleState, start: Vec, end: Vec) {
  const delta = sub(end, start), distance = length(delta);
  return !s.obstacles.some(o => { const hit = o.hp > 0 ? rayCircle(start, unit(delta), o.pos, o.radius) : null; return hit !== null && hit < distance; });
}
function melee(s: BattleState, f: Fighter) {
  if (isGrass(f.species)) {
    const v = f.species === 'bulbasaur' ? B.vine : I.vine;
    const target = s.fighters[1 - f.id], delta = sub(target.pos, f.pos), distance = length(delta);
    if (distance <= v.range && dot(unit(delta), f.facing) >= Math.cos(v.halfAngle) && clearLine(s, f.pos, target.pos)) {
      const direct = f.species === 'ivysaur' && distance >= I.vine.tipStart ? I.vine.tipDamage : v.damage;
      if (f.species === 'bulbasaur') comboDamage(s, f, target, direct * grassPower(f), B.vine.combo, f.facing, 80);
      else damage(s, target, direct * grassPower(f), f.facing, 80, f.species);
    }
    // Capture visibility before destroying props, so a single swing cannot hit through them.
    const props = s.obstacles.filter(o => { const d = sub(o.pos, f.pos); return o.hp > 0 && length(d) <= v.range + o.radius && dot(unit(d), f.facing) >= Math.cos(v.halfAngle) && clearLine(s, f.pos, point(o.pos, unit(d), -o.radius - .01)); });
    for (const o of props) obstacleDamage(s, o, v.propDamage * grassPower(f), f.species);
    const points = Array.from({ length: 17 }, (_, i) => {
      const a = angle(f.facing) - v.halfAngle + v.halfAngle * 2 * i / 16, d = { x: Math.cos(a), y: Math.sin(a) };
      let reach = courtReach(f.pos, d, v.range);
      // Include props destroyed by this swing: the animation shows this hit, not a future clear path.
      for (const o of s.obstacles) { const hit = rayCircle(f.pos, d, o.pos, o.radius); if (hit !== null) reach = Math.min(reach, hit); }
      return point(f.pos, d, reach);
    });
    s.effects.push({ id: s.nextId++, kind: 'melee', pos: { ...f.pos }, species: f.species, life: .2, maxLife: .2, angle: angle(f.facing), size: v.range, points });
    return;
  }
  const center = point(f.pos, f.facing, 30);
  effect(s, 'melee', center, f.species, 0.18, angle(f.facing), 42);
  const quick = f.species === 'pikachu', lunge = quick ? 400 : f.species === 'mewtwo' ? 140 : 280;
  f.velocity = { x: f.facing.x * lunge, y: f.facing.y * lunge };
  if (quick) effect(s, 'trail', f.pos, f.species, 0.2, angle(f.facing), 22);
  const target = s.fighters[1 - f.id];
  const delta = sub(target.pos, f.pos);
  if (length(delta) <= (quick ? 90 : 78) && dot(unit(delta), f.facing) >= 0.25) damage(s, target, quick ? 10 : 12, f.facing, quick ? 300 : 360, f.species, true);
  for (const obstacle of s.obstacles) {
    const delta = sub(obstacle.pos, f.pos);
    if (length(delta) <= 58 + obstacle.radius && dot(unit(delta), f.facing) >= 0.2) obstacleDamage(s, obstacle, 34, f.species);
  }
}
function courtReach(origin: Vec, direction: Vec, maximum: number) {
  let reach = maximum;
  if (direction.x > EPSILON) reach = Math.min(reach, (WORLD.right - origin.x) / direction.x);
  if (direction.x < -EPSILON) reach = Math.min(reach, (WORLD.left - origin.x) / direction.x);
  if (direction.y > EPSILON) reach = Math.min(reach, (WORLD.bottom - origin.y) / direction.y);
  if (direction.y < -EPSILON) reach = Math.min(reach, (WORLD.top - origin.y) / direction.y);
  return reach;
}
// Telegraph and shot share the same clipping, including the first solid target.
export function solarTrace(s: BattleState, f: Fighter) {
  let reach = courtReach(f.pos, f.facing, I.solar.range), blocker: Obstacle | undefined;
  for (const o of s.obstacles) {
    const hit = o.hp > 0 ? rayCircle(f.pos, f.facing, o.pos, o.radius + I.solar.radius) : null;
    if (hit !== null && hit < reach) { reach = hit; blocker = o; }
  }
  const opponent = s.fighters[1 - f.id], hit = rayCircle(f.pos, f.facing, opponent.pos, opponent.radius + I.solar.radius);
  const target = hit !== null && hit < reach ? opponent : undefined;
  if (target) { reach = hit!; blocker = undefined; }
  return { end: point(f.pos, f.facing, reach), target, blocker };
}
function special(s: BattleState, f: Fighter) {
  if (f.species === 'ivysaur') {
    const trace = solarTrace(s, f);
    if (trace.target) damage(s, trace.target, I.solar.damage * grassPower(f), f.facing, 160, f.species);
    else if (trace.blocker) obstacleDamage(s, trace.blocker, I.solar.damage * grassPower(f), f.species);
    s.effects.push({ id: s.nextId++, kind: 'solar', species: f.species, pos: { ...f.pos }, end: trace.end, life: .22, maxLife: .22, angle: angle(f.facing) });
    return;
  }
  if (f.species === 'bulbasaur') { grassProjectile(s, f, 'seed'); return; }
  const target = point(f.pos, f.facing, 170);
  target.x = clamp(target.x, WORLD.left + 70, WORLD.right - 70);
  target.y = clamp(target.y, WORLD.top + 70, WORLD.bottom - 70);
  s.hazards = s.hazards.filter(h => h.owner !== f.id);
  const electric = f.species === 'pikachu', psychic = f.species === 'mewtwo';
  const duration = electric ? 1.15 : psychic ? 1.55 : 2.85;
  s.hazards.push({ id: s.nextId++, owner: f.id, species: f.species, pos: target, radius: 70, life: duration, maxLife: duration, warmup: electric || psychic ? 0.55 : 0.35, damageTimer: 0 });
  effect(s, 'shockwave', target, f.species, 0.35, 0, 70);
}
/** Pausing freezes charge and requires a fresh hold before release can fire. */
export function suspendBattleInput(s: BattleState) {
  // Only human input is cleared on pause; CPU commands resume normally.
  const f = s.fighters[0];
  if (f.species === 'bulbasaur' && f.action === 'ranged' && f.phase === 'windup') f.chargeSuspended = true;
}
function advanceAction(s: BattleState, f: Fighter, command: Command, dt: number) {
  const bulb = f.species === 'bulbasaur', ivy = f.species === 'ivysaur';
  const held = command.rangedHeld ?? command.ranged;
  if (!held) f.rangedNeedsRelease = false;
  const charging = bulb && f.action === 'ranged' && f.phase === 'windup';
  // A roll cancels before this tick can release a charged projectile.
  const canDodge = f.phase === 'idle' || charging || (f.action === 'ranged' && f.phase === 'active');
  if (command.dodge && canDodge && f.dodgeCooldown <= EPSILON && f.stunTime <= 0 && f.knockdownTime <= 0) {
    const direction = length(command.move) > .05 ? unit(command.move) : f.facing;
    if (charging) { f.rangedCooldown = B.leaf.cooldown; f.rangedNeedsRelease = held; }
    f.chargeTime = 0; f.chargeRelease = null; f.chargeSuspended = false;
    f.actionTime = 0; f.dodgeCooldown = 1.25; f.dodgeTime = .24;
    f.velocity = point({ x: 0, y: 0 }, direction, 500);
    phase(f, 'dodge', 'active', .24); effect(s, 'dodge', f.pos, f.species, .24, angle(direction));
    return;
  }
  if (f.phase !== 'idle') {
    if (charging) {
      if (f.chargeSuspended) {
        if (command.ranged && held) f.chargeSuspended = false;
        else return;
      }
      if (!held && f.chargeRelease === null) f.chargeRelease = f.chargeTime;
      f.chargeTime = Math.min(B.leaf.maximum, f.chargeTime + dt);
      f.actionTime += dt; f.phaseTime = Math.max(0, B.leaf.maximum - f.chargeTime);
      if ((f.chargeRelease !== null && f.chargeTime + EPSILON >= B.leaf.minimum) || f.chargeTime + EPSILON >= B.leaf.maximum) {
        f.chargeRelease ??= B.leaf.maximum; // Automatic release is never the perfect timing tier.
        grassProjectile(s, f, 'leaf'); f.rangedCooldown = B.leaf.cooldown; f.rangedNeedsRelease = held;
        phase(f, 'ranged', 'active', B.leaf.active);
      }
    } else {
      f.phaseTime = Math.max(0, f.phaseTime - dt); f.actionTime += dt;
      if (f.action === 'ranged' && f.phase === 'active' && !isGrass(f.species)) {
        f.energy = Math.max(0, f.energy - 24 * dt);
        if (!command.ranged || f.energy <= EPSILON) f.phaseTime = 0;
      }
      if (f.phaseTime <= EPSILON) {
        if (f.phase === 'windup') {
          if (f.action === 'melee') { phase(f, 'melee', 'active', f.species === 'pikachu' ? .12 : .14); melee(s, f); }
          else if (f.action === 'ranged') {
            if (ivy) { phase(f, 'ranged', 'active', I.leaf.active); grassProjectile(s, f, 'returnLeaf'); f.rangedCooldown = I.leaf.cooldown; }
            else if (command.ranged && f.energy > 0) phase(f, 'ranged', 'active', 2.4);
            else phase(f, 'ranged', 'recovery', .25);
          } else if (f.action === 'special') { phase(f, 'special', 'active', .12); special(s, f); }
        } else if (f.phase === 'active') {
          const recovery = f.action === 'ranged' ? bulb ? B.leaf.recovery : ivy ? I.leaf.recovery : .25 : f.action === 'special' && ivy ? I.solar.recovery : f.action === 'dodge' ? .1 : f.action === 'melee' && f.species === 'pikachu' ? .14 : .18;
          if (f.action === 'ranged' && !isGrass(f.species)) f.rangedCooldown = .65;
          if (f.action === 'dodge') { f.dodgeTime = 0; f.velocity.x *= .2; f.velocity.y *= .2; }
          phase(f, f.action, 'recovery', recovery);
        } else idle(f);
      }
    }
  }
  if (f.phase !== 'idle' || f.stunTime > 0 || f.knockdownTime > 0) return;
  f.actionTime = 0;
  const specialCost = bulb ? B.seed.cost : ivy ? I.solar.cost : 30;
  if (command.special && f.specialCooldown <= EPSILON && f.energy >= specialCost) {
    f.energy -= specialCost; f.specialCooldown = bulb ? B.seed.cooldown : ivy ? I.solar.cooldown : 6.5;
    const windup = bulb ? B.seed.windup : ivy ? I.solar.windup : .4;
    phase(f, 'special', 'windup', windup); effect(s, 'charge', f.pos, f.species, windup, 0, 28);
  } else if (command.melee && f.meleeCooldown <= EPSILON) {
    f.meleeCooldown = bulb ? B.vine.cooldown : ivy ? I.vine.cooldown : f.species === 'pikachu' ? .5 : .58;
    phase(f, 'melee', 'windup', bulb ? B.vine.windup : ivy ? I.vine.windup : f.species === 'pikachu' ? .07 : .12);
  } else if (command.ranged && (!bulb || !f.rangedNeedsRelease) && f.rangedCooldown <= EPSILON && f.energy >= (bulb ? B.leaf.cost : ivy ? I.leaf.cost : 8)) {
    if (isGrass(f.species)) f.energy -= bulb ? B.leaf.cost : I.leaf.cost;
    f.chargeTime = 0; f.chargeRelease = bulb && !held ? 0 : null; f.chargeSuspended = false;
    const windup = bulb ? B.leaf.maximum : ivy ? I.leaf.windup : .28;
    phase(f, 'ranged', 'windup', windup); effect(s, 'charge', f.pos, f.species, bulb ? .15 : windup, 0, 18);
  }
}
function moveFighter(s: BattleState, f: Fighter, command: Command, dt: number) {
  for (const key of ['meleeCooldown', 'rangedCooldown', 'dodgeCooldown', 'dodgeTime', 'stunTime', 'hitTime', 'attackTime', 'specialCooldown', 'knockdownTime', 'paralysisTime'] as const) f[key] = Math.max(0, f[key] - dt);
  if (f.hp <= 0) return;
  const raw = command.move;
  const move = length(raw) > 1 ? unit(raw) : raw;
  const aim = command.aim && length(command.aim) > 0.01 ? command.aim : move;
  if (length(aim) > 0.01 && f.action !== 'dodge' && f.knockdownTime <= 0) {
    if (f.action === 'ranged' && f.phase === 'active') {
      const current = angle(f.facing), desired = angle(aim);
      const difference = Math.atan2(Math.sin(desired - current), Math.cos(desired - current));
      const next = current + clamp(difference, -2.2 * dt, 2.2 * dt);
      f.facing = { x: Math.cos(next), y: Math.sin(next) };
    } else if (f.phase === 'idle' || f.phase === 'recovery' || f.action === 'ranged' || (f.species === 'ivysaur' && f.action === 'special' && f.phaseTime > I.solar.lockTime)) f.facing = unit(aim);
  }
  advanceAction(s, f, command, dt);
  if (!(f.action === 'ranged' && f.phase !== 'recovery') && f.action !== 'special') f.energy = Math.min(f.maxEnergy, f.energy + 13 * dt);
  let multiplier = f.phase === 'idle' ? 1 : f.action === 'ranged' && f.phase === 'active' ? 0.42 : f.phase === 'recovery' ? 0.65 : 0.25;
  if (f.species === 'bulbasaur' && f.action === 'ranged' && f.phase === 'windup') multiplier = .6;
  if (f.stunTime > 0 || f.knockdownTime > 0 || f.action === 'dodge' || (f.species === 'ivysaur' && f.action === 'special' && f.phase !== 'recovery')) multiplier = 0;
  if (f.paralysisTime > 0) multiplier *= 0.6;
  f.moveVelocity = { x: move.x * SPEED[f.species] * multiplier, y: move.y * SPEED[f.species] * multiplier };
  f.pos.x += (f.moveVelocity.x + f.velocity.x) * dt;
  f.pos.y += (f.moveVelocity.y + f.velocity.y) * dt;
  if (f.action !== 'dodge' || f.phase !== 'active') {
    const damping = Math.exp(-(f.knockdownTime > 0 ? 5 : 11) * dt);
    f.velocity.x *= damping; f.velocity.y *= damping;
  }
  if (f.action === 'dodge' && f.phase === 'active' && pulse(s.time, dt, 0.045)) {
    effect(s, 'trail', f.pos, f.species, 0.18, angle(f.facing), 18);
    effect(s, 'dust', f.pos, f.species, 0.28, 0, 10);
  }
  for (const obstacle of s.obstacles) {
    if (obstacle.hp <= 0) continue;
    const delta = sub(f.pos, obstacle.pos), distance = length(delta), overlap = obstacle.radius + f.radius - distance;
    if (overlap <= 0) continue;
    const normal = unit(delta);
    const impact = -dot(f.velocity, normal);
    if (impact > 120) {
      obstacleDamage(s, obstacle, impact * 0.14, f.species);
      effect(s, 'dust', f.pos, f.species, 0.3, 0, 20);
      if (obstacle.hp <= 0) continue;
    }
    f.pos = point(f.pos, normal, overlap + 0.01);
    const into = dot(f.velocity, normal);
    if (into < 0) { f.velocity.x -= normal.x * into; f.velocity.y -= normal.y * into; }
    const walkingInto = dot(f.moveVelocity, normal);
    if (walkingInto < 0) { f.moveVelocity.x -= normal.x * walkingInto; f.moveVelocity.y -= normal.y * walkingInto; }
  }
  confine(f);
}

function segmentDistance(start: Vec, end: Vec, p: Vec) {
  const vector = sub(end, start);
  const t = clamp(dot(sub(p, start), vector) / (dot(vector, vector) || 1), 0, 1);
  return length(sub(p, point(start, vector, t)));
}
function rayCircle(start: Vec, direction: Vec, center: Vec, radius: number): number | null {
  const relative = sub(center, start), along = dot(relative, direction), perpendicularSq = dot(relative, relative) - along * along;
  if (perpendicularSq > radius * radius) return null;
  const root = Math.sqrt(Math.max(0, radius * radius - perpendicularSq));
  if (along + root < 0) return null;
  return Math.max(0, along - root);
}
function beamClash(a: Beam, b: Beam): Vec | null {
  const av = sub(a.end, a.start), bv = sub(b.end, b.start), ad = unit(av), bd = unit(bv);
  if (dot(ad, bd) > -0.35) return null;
  const cross = (x: Vec, y: Vec) => x.x * y.y - x.y * y.x;
  const delta = sub(b.start, a.start), divisor = cross(av, bv);
  if (Math.abs(divisor) > 0.001) {
    const t = cross(delta, bv) / divisor, u = cross(delta, av) / divisor;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return point(a.start, av, t);
  }
  // Parallel opposing streams have infinitely many crossing points; meet midway.
  const midpoint = { x: (a.start.x + b.start.x) / 2, y: (a.start.y + b.start.y) / 2 };
  const alongA = dot(sub(midpoint, a.start), ad), alongB = dot(sub(midpoint, b.start), bd);
  if (alongA < 0 || alongB < 0 || alongA > length(av) || alongB > length(bv)) return null;
  return segmentDistance(a.start, a.end, midpoint) <= (a.width + b.width) / 2 && segmentDistance(b.start, b.end, midpoint) <= (a.width + b.width) / 2 ? midpoint : null;
}
function updateBeams(s: BattleState, dt: number) {
  const obstacleHits = new Map<number, Obstacle>();
  s.beams = s.fighters.filter(f => !isGrass(f.species) && f.hp > 0 && f.action === 'ranged' && f.phase === 'active' && f.knockdownTime <= 0).map(f => {
    const start = point(f.pos, f.facing, 24), width = f.species === 'charmander' ? 20 : f.species === 'pikachu' ? 12 : f.species === 'mewtwo' ? 18 : 15;
    let reach = f.species === 'charmander' ? 355 : f.species === 'pikachu' ? 400 : f.species === 'mewtwo' ? 390 : 385;
    // Streams end at the court instead of extending underneath the HUD.
    if (f.facing.x > EPSILON) reach = Math.min(reach, Math.max(0, (WORLD.right - start.x) / f.facing.x));
    if (f.facing.x < -EPSILON) reach = Math.min(reach, Math.max(0, (WORLD.left - start.x) / f.facing.x));
    if (f.facing.y > EPSILON) reach = Math.min(reach, Math.max(0, (WORLD.bottom - start.y) / f.facing.y));
    if (f.facing.y < -EPSILON) reach = Math.min(reach, Math.max(0, (WORLD.top - start.y) / f.facing.y));
    let closest: Obstacle | undefined;
    for (const obstacle of s.obstacles) {
      if (obstacle.hp <= 0) continue;
      const distance = rayCircle(start, f.facing, obstacle.pos, obstacle.radius + width * 0.25);
      if (distance !== null && distance < reach) { reach = distance; closest = obstacle; }
    }
    if (closest) obstacleHits.set(f.id, closest);
    return { owner: f.id, species: f.species, start, end: point(start, f.facing, reach), width, power: 1, blocked: !!closest };
  });
  const clash = s.beams.length === 2 ? beamClash(s.beams[0], s.beams[1]) : null;
  if (clash) {
    const old = s.clash;
    s.clash = { pos: clash, intensity: 1, age: old && length(sub(old.pos, clash)) < 80 ? old.age + dt : 0 };
    for (const beam of s.beams) { beam.end = { ...clash }; beam.blocked = true; obstacleHits.delete(beam.owner); }
    const electric = s.beams.some(b => b.species === 'pikachu');
    const steam = s.beams.some(b => b.species === 'charmander') && s.beams.some(b => b.species === 'squirtle');
    if (steam && pulse(s.time, dt, 0.075)) effect(s, 'steam', clash, 'squirtle', 0.65, -Math.PI / 2, 28);
    if (pulse(s.time, dt, electric ? 0.075 : 0.2)) effect(s, 'burst', clash, electric ? 'pikachu' : s.beams[0].species, 0.2, s.time * 8, 17);
    s.cameraImpact = Math.max(s.cameraImpact, 0.045);
  } else s.clash = null;
  for (const beam of s.beams) {
    const obstacle = obstacleHits.get(beam.owner);
    if (obstacle) {
      obstacleDamage(s, obstacle, 22 * dt, beam.species);
      if (pulse(s.time, dt, 0.16)) effect(s, 'hit', beam.end, beam.species, 0.18, 0, 15);
    }
    const target = s.fighters[1 - beam.owner];
    if (segmentDistance(beam.start, beam.end, target.pos) < target.radius + beam.width * 0.5) {
      const direction = unit(sub(beam.end, beam.start));
      damage(s, target, 18 * dt, direction, 0, beam.species);
      // Continuous pressure, without action cancellation or stun-lock.
      if (target.dodgeTime <= 0.08 && target.knockdownTime <= 0) target.pos = point(target.pos, direction, 28 * dt);
      confine(target);
    }
  }
}
function updateHazards(s: BattleState, dt: number) {
  s.hazards = s.hazards.filter(h => {
    h.life -= dt;
    if (h.warmup > 0) { h.warmup = Math.max(0, h.warmup - dt); return true; }
    if (h.life <= 0) {
      effect(s, 'burst', h.pos, h.species, 0.45, 0, h.radius);
      mark(s, h.species === 'mewtwo' ? 'crater' : h.species === 'squirtle' ? 'wet' : 'scorch', h.pos, h.radius);
      const target = s.fighters[1 - h.owner], delta = sub(target.pos, h.pos);
      if (h.species !== 'pikachu' && length(delta) < h.radius + target.radius) damage(s, target, h.species === 'mewtwo' ? 10 : 5, unit(delta), 290, h.species, true);
      s.cameraImpact = Math.max(s.cameraImpact, 0.3);
      return false;
    }
    h.damageTimer -= dt;
    const target = s.fighters[1 - h.owner], delta = sub(target.pos, h.pos), inRange = length(delta) <= h.radius + target.radius;
    if ((h.species === 'charmander' || h.species === 'squirtle') && inRange && target.dodgeTime <= 0.08 && target.knockdownTime <= 0) {
      const direction = unit(delta), pull = h.species === 'squirtle' ? -25 : 12;
      target.pos = point(target.pos, direction, pull * dt); confine(target);
    }
    if (h.damageTimer <= 0) {
      h.damageTimer += h.species === 'pikachu' ? 0.2 : h.species === 'mewtwo' ? 0.25 : 0.32;
      if (inRange) {
        const hit = damage(s, target, h.species === 'pikachu' ? 7 : h.species === 'charmander' || h.species === 'mewtwo' ? 4 : 3.5, unit(delta), 0, h.species);
        // Thunder slows walking briefly; actions and dodge remain available.
        if (hit && h.species === 'pikachu') target.paralysisTime = Math.max(target.paralysisTime, 0.7);
      }
      for (const obstacle of s.obstacles) if (length(sub(obstacle.pos, h.pos)) < h.radius + obstacle.radius) obstacleDamage(s, obstacle, 12, h.species);
      effect(s, h.species === 'mewtwo' ? 'shockwave' : h.species === 'pikachu' ? 'burst' : h.species === 'charmander' ? 'scorch' : 'splash', h.pos, h.species, 0.35, s.time * 4, h.radius);
    }
    return true;
  });
}
function drainSeed(s: BattleState, owner: Fighter, target: Fighter) {
  if (isGrass(target.species) || owner.hp <= 0) return;
  const before = target.hp;
  if (damage(s, target, B.seed.drain, unit(sub(target.pos, owner.pos)), 0, owner.species)) owner.hp = Math.min(owner.maxHp, owner.hp + before - target.hp);
}
function updateProjectiles(s: BattleState, dt: number) {
  s.projectiles = s.projectiles.filter(p => {
    const owner = s.fighters[p.owner];
    if (p.kind === 'returnLeaf') {
      if (!p.returning && (p.travelled ?? 0) >= I.leaf.range) { p.returning = true; p.hitLeg = false; p.damage = p.returnDamage!; }
      if (p.returning) {
        if (length(sub(owner.pos, p.pos)) < owner.radius || owner.hp <= 0) return false;
        p.velocity = point({ x: 0, y: 0 }, unit(sub(owner.pos, p.pos)), I.leaf.speed);
      }
    }
    const direction = unit(p.velocity), travel = length(p.velocity) * Math.min(dt, p.life);
    let reach = travel; let obstacleHit: Obstacle | undefined;
    for (const obstacle of s.obstacles) {
      if (obstacle.hp <= 0) continue;
      const hit = rayCircle(p.pos, direction, obstacle.pos, obstacle.radius + p.radius);
      if (hit !== null && hit <= reach) { reach = hit; obstacleHit = obstacle; }
    }
    const target = s.fighters[1 - p.owner];
    const targetHit = rayCircle(p.pos, direction, target.pos, target.radius + p.radius);
    if (!p.hitLeg && targetHit !== null && targetHit <= travel && (!obstacleHit || targetHit < reach)) {
      if (p.kind === 'seed') {
        if (owner.hp > 0 && target.hp > 0 && target.dodgeTime <= .08 && target.knockdownTime <= .12) {
          s.leechSeeds = s.leechSeeds.filter(seed => seed.owner !== p.owner);
          s.leechSeeds.push({ owner: p.owner, target: target.id, life: B.seed.duration, timer: B.seed.interval, ticksLeft: B.seed.ticks - 1 });
          drainSeed(s, owner, target);
          effect(s, 'charge', target.pos, p.species, .3, 0, 22);
        }
      } else if (p.kind === 'leaf') comboDamage(s, owner, target, p.damage, p.combo ?? 0, direction, 30);
      else damage(s, target, p.damage, direction, 30, p.species);
      if (p.kind !== 'returnLeaf') return false;
      p.hitLeg = true;
    }
    if (obstacleHit) {
      obstacleDamage(s, obstacleHit, p.kind === 'seed' ? 0 : p.damage, p.species);
      effect(s, 'hit', point(p.pos, direction, reach), p.species, .18); return false;
    }
    p.pos = point(p.pos, direction, travel); p.life -= dt; p.travelled = (p.travelled ?? 0) + travel;
    return p.life > EPSILON && p.pos.x >= WORLD.left && p.pos.x <= WORLD.right && p.pos.y >= WORLD.top && p.pos.y <= WORLD.bottom;
  });
}
function updateLeechSeeds(s: BattleState, dt: number) {
  s.leechSeeds = s.leechSeeds.filter(seed => {
    const owner = s.fighters[seed.owner], target = s.fighters[seed.target];
    seed.life -= dt;
    if (seed.life <= EPSILON || owner.hp <= 0 || target.hp <= 0) return false;
    seed.timer -= dt;
    if (seed.timer <= EPSILON && seed.ticksLeft > 0) {
      seed.timer += B.seed.interval; seed.ticksLeft--; drainSeed(s, owner, target);
    }
    return true;
  });
}
function tick(s: BattleState, commands: [Command, Command], dt: number) {
  s.time += dt;
  s.cameraImpact = Math.max(0, s.cameraImpact - dt * 2);
  s.effects = s.effects.filter(e => (e.life -= dt) > 0);
  s.groundMarks = s.groundMarks.filter(m => (m.life -= dt) > 0);
  s.fighters.forEach((f, i) => moveFighter(s, f, commands[i], dt));
  const [a, b] = s.fighters, delta = sub(b.pos, a.pos), distance = length(delta), overlap = a.radius + b.radius - distance;
  if (overlap > 0) {
    const direction = unit(delta); a.pos = point(a.pos, direction, -overlap / 2); b.pos = point(b.pos, direction, overlap / 2); confine(a); confine(b);
  }
  updateBeams(s, dt);
  updateHazards(s, dt);
  updateProjectiles(s, dt);
  updateLeechSeeds(s, dt);
  s.obstacles = s.obstacles.filter(o => o.hp > 0);
  if (a.hp <= 0 || b.hp <= 0) {
    s.winner = a.hp >= b.hp ? 0 : 1; s.beams = []; s.clash = null; s.projectiles = []; s.leechSeeds = [];
    for (const f of s.fighters) { f.moveVelocity = { x: 0, y: 0 }; f.velocity = { x: 0, y: 0 }; }
  }
}
export function stepBattle(state: BattleState, commands: [Command, Command], dt: number): void {
  if (state.winner !== null || !Number.isFinite(dt) || dt <= 0) return;
  let remaining = Math.min(dt, 0.25);
  while (remaining > EPSILON && state.winner === null) {
    const step = Math.min(remaining, 1 / 120); tick(state, commands, step); remaining -= step;
  }
}
