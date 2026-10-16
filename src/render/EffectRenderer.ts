import Phaser from 'phaser';
import manifest from './vfx-manifest.json';
import whirlpool from './whirlpool.json';
import type { BattleState, Beam, Effect, Fighter, Hazard, PlantAttack, Species, Vec } from '../game/types';
import { BULBASAUR as B, IVYSAUR as I, VENUSAUR as V, isGrass, leafTier } from '../game/grassMoves';
import { solarTrace, rootPoints, bombLanding } from '../game/battle';

const SCALE = 2.4, TAU = Math.PI * 2;
type Clip = keyof typeof manifest | 'whirlpool';
type Draw = { clip: Clip; frame: number; x: number; y: number; depth: number; missing: boolean };
const palettes: Record<Species, string> = { charmander: '#ffbb56', squirtle: '#87dfff', pikachu: '#fff3a0', mewtwo: '#d4a0f3', bulbasaur: '#b7e585', ivysaur: '#e9eda0', venusaur: '#f9b0c5' };
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

export function preloadEffects(scene: Phaser.Scene): void {
  for (const [key, clip] of Object.entries(manifest)) {
    scene.load.spritesheet(`vfx-${key}`, `./assets/vfx/${clip.file}`, { frameWidth: clip.frameWidth, frameHeight: clip.frameHeight });
  }
  scene.load.image('vfx-whirlpool-source', `./assets/vfx/${whirlpool.file}`);
}

/** Original frames at character pixel density. Code controls choreography, never substitutes circles for spell art. */
export class EffectRenderer {
  private pool: Phaser.GameObjects.Image[] = [];
  private used = 0;
  private draws: Draw[] = [];
  private ground: Phaser.Textures.CanvasTexture;
  private paths: Phaser.Textures.CanvasTexture;
  private groundImage: Phaser.GameObjects.Image;
  private pathImage: Phaser.GameObjects.Image;
  private time = 0;
  private missing = new Set<string>();
  private renderMs = 0;

  constructor(private scene: Phaser.Scene) {
    for (const key of Object.keys(manifest)) if (scene.textures.exists(`vfx-${key}`)) scene.textures.get(`vfx-${key}`).setFilter(Phaser.Textures.FilterMode.NEAREST);
    // Import generated cells onto the same logical grid as the original character art.
    // The source stays intact on disk. Fractional source cells are intentional (1774 x 887).
    if (scene.textures.exists('vfx-whirlpool-source') && !scene.textures.exists('vfx-whirlpool')) {
      const source = scene.textures.get('vfx-whirlpool-source').getSourceImage() as HTMLImageElement;
      const tex = scene.textures.createCanvas('vfx-whirlpool', 64 * 8, 64)!;
      const ctx = tex.getContext(); ctx.imageSmoothingEnabled = false;
      for (let i = 0; i < 8; i++) {
        ctx.drawImage(source, i % 4 * source.width / 4, Math.floor(i / 4) * source.height / 2, source.width / 4, source.height / 2, i * 64, 0, 64, 64);
        tex.add(i, 0, i * 64, 0, 64, 64);
      }
      tex.refresh().setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    this.ground = scene.textures.createCanvas('vfx-ground-grid', 400, 250)!;
    this.paths = scene.textures.createCanvas('vfx-path-grid', 400, 250)!;
    this.ground.setFilter(Phaser.Textures.FilterMode.NEAREST); this.paths.setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.groundImage = scene.add.image(0, 0, this.ground.key).setOrigin(0).setScale(SCALE).setDepth(3);
    this.pathImage = scene.add.image(0, 0, this.paths.key).setOrigin(0).setScale(SCALE).setDepth(800);
  }

  debug() { return { active: this.used, allocated: this.pool.length, renderMs: this.renderMs, missing: [...this.missing], draws: this.draws.map(d => ({ ...d })) }; }
  private count(key: Clip): number { return key === 'whirlpool' ? 8 : manifest[key].columns; }
  private frame(key: Clip, age = this.time, fps = 20): number { return Math.floor(Math.max(0, age) * fps) % this.count(key); }
  private emit(key: Clip, x: number, y: number, frame = this.frame(key), depth = y + 12, alpha = 1, origin: [number, number] = [.5, .5]): void {
    const texture = `vfx-${key}`, missing = !this.scene.textures.exists(texture);
    if (missing) { this.missing.add(key); return; }
    if (this.used >= 384) return; // Explicit bounded pool for sustained channels and overlapping zones.
    let sprite = this.pool[this.used];
    if (!sprite) { sprite = this.scene.add.image(0, 0, texture); this.pool.push(sprite); }
    this.used++;
    const px = Math.round(x), py = Math.round(y);
    sprite.setTexture(texture, frame).setPosition(px, py).setOrigin(...origin).setDepth(depth).setScale(SCALE).setRotation(0).setFlip(false, false).clearTint().setAlpha(alpha).setVisible(true);
    this.draws.push({ clip: key, frame, x: px, y: py, depth, missing });
  }

  private stamp(ctx: CanvasRenderingContext2D, key: Clip, x: number, y: number, frame: number, angle = 0, alpha = 1): void {
    if (!this.scene.textures.exists(`vfx-${key}`)) { this.missing.add(key); return; }
    const f = this.scene.textures.getFrame(`vfx-${key}`, frame);
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(Math.round(x / SCALE), Math.round(y / SCALE)); ctx.rotate(angle);
    ctx.drawImage(f.source.image as CanvasImageSource, f.cutX, f.cutY, f.cutWidth, f.cutHeight, -Math.floor(f.cutWidth / 2), -Math.floor(f.cutHeight / 2), f.cutWidth, f.cutHeight);
    ctx.restore();
    this.draws.push({ clip: key, frame, x: Math.round(x), y: Math.round(y), depth: 800, missing: false });
  }

  private boundary(pos: Vec, radius: number, color: string, progress = 1, warning = false): void {
    const c = this.ground.context, x = pos.x / SCALE, y = pos.y / SCALE, r = radius / SCALE;
    c.fillStyle = color; c.globalAlpha = warning ? .8 : .5;
    // Gameplay outline remains a true collision circle, not the decorative perspective ellipse.
    for (let i = 0; i < 96 * progress; i++) {
      if (warning && i % 8 > 4) continue;
      const a = i / 96 * TAU - Math.PI / 2;
      c.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r), 1, 1);
    }
    c.globalAlpha = 1;
  }

  render(s: BattleState): void {
    const start = performance.now(); this.time = s.time; this.used = 0; this.draws = []; this.missing.clear();
    for (const tex of [this.ground, this.paths]) { tex.context.clearRect(0, 0, 400, 250); tex.context.imageSmoothingEnabled = false; }
    for (const mark of s.groundMarks) {
      const c = this.ground.context, wet = mark.kind === 'wet';
      c.fillStyle = wet ? '#287b9b' : '#27222c'; c.globalAlpha = Math.min(.55, mark.life * .1);
      // Sparse, stable chipped puddles / scorch clusters, laid out on the common pixel grid.
      for (let i = 0; i < 28; i++) { const a = i * 2.399 + mark.angle, r = mark.radius / SCALE * Math.sqrt((i + .5) / 28);
        c.fillRect(Math.round(mark.pos.x / SCALE + Math.cos(a) * r), Math.round(mark.pos.y / SCALE + Math.sin(a) * r * .6), 3 + i % 3, 1 + i % 2);
      }
      c.globalAlpha = 1;
    }
    for (const h of s.hazards) this.hazard(h);
    for (const plant of s.plantAttacks) this.plant(plant);
    for (const f of s.fighters) this.fighter(f, s);
    for (const beam of s.beams) this.beam(beam);
    for (const p of s.projectiles) {
      const key = p.kind === 'seed' ? 'seed' : p.kind === 'returnLeaf' ? 'leafSpin' : 'leaf';
      this.emit(key, p.pos.x, p.pos.y - 22, this.frame(key, s.time + p.id * .07, p.returning ? 28 : 20), p.pos.y + 15);
      if (p.tier === 'charged' || p.tier === 'perfect' || p.returning) {
        const speed = Math.hypot(p.velocity.x, p.velocity.y) || 1;
        for (let i = 1; i <= (p.tier === 'perfect' ? 3 : 2); i++) this.emit('solarMote', p.pos.x - p.velocity.x / speed * i * 9, p.pos.y - 22 - p.velocity.y / speed * i * 9, this.frame('solarMote', s.time + i * .1), p.pos.y + 14, 1 - i * .2);
      }
    }
    for (const seed of s.leechSeeds) {
      const target = s.fighters[seed.target], owner = s.fighters[seed.owner];
      for (let i = 0; i < 3; i++) this.emit('sprout', target.pos.x - 13 + i * 13, target.pos.y - 12, this.frame('sprout', s.time + i * .1, 3), target.pos.y + 13);
      this.boundary(target.pos, 24, palettes.bulbasaur, seed.life / B.seed.duration);
      if (!isGrass(target.species)) { const t = s.time * 1.7 % 1; this.emit('absorb', target.pos.x + (owner.pos.x - target.pos.x) * t, target.pos.y - 22 + (owner.pos.y - target.pos.y) * t, this.frame('absorb'), 820); }
    }
    for (const e of s.effects) {
      // Initial placement emits a shockwave event too; keep the warning visually distinct from a hit.
      if (e.kind === 'shockwave' && s.hazards.some(h => h.warmup > 0 && h.species === e.species && Math.hypot(h.pos.x - e.pos.x, h.pos.y - e.pos.y) < 1)) continue;
      this.effect(e);
    }
    if (s.clash) {
      this.emit('heavyHit', s.clash.pos.x, s.clash.pos.y - 24, this.frame('heavyHit'), 850);
      for (let i = 0; i < 3; i++) { const age = (s.clash.age + i * .19) % .7; this.emit('steam', s.clash.pos.x - age * 20 + i * 8, s.clash.pos.y - 28 - age * 95, Math.min(6, Math.floor(age * 10)), 849, 1 - age); }
    }
    for (let i = this.used; i < this.pool.length; i++) this.pool[i].setVisible(false);
    this.ground.refresh(); this.paths.refresh(); this.renderMs = performance.now() - start;
  }

  private plant(a: PlantAttack): void {
    if (a.kind === 'bomb') {
      const p = a.points[0], t = clamp(a.age / V.bomb.flight, 0, 1);
      if (t < 1) {
        this.boundary(p, V.bomb.radius, palettes.venusaur, 1, true);
        this.boundary(p, V.bomb.coreRadius, '#fff3c0', 1, true);
        const x = a.origin.x + (p.x - a.origin.x) * t, y = a.origin.y + (p.y - a.origin.y) * t;
        this.emit('seed', x, y - 28 - Math.sin(t * Math.PI) * 75, 0, y + 70);
        this.emit('leafSpin', x - 6, y - 26 - Math.sin(t * Math.PI) * 75, this.frame('leafSpin', a.age, 25), y + 71);
      } else {
        const age = a.age - V.bomb.flight, alpha = clamp((.5 - age) * 6, 0, 1);
        for (let i = 0; i < 8; i++) {
          const angle = i * TAU / 8, r = 14 + age * 90;
          this.emit(i % 2 ? 'petal' : 'leafSpin', p.x + Math.cos(angle) * r, p.y + Math.sin(angle) * r - Math.sin(age * Math.PI * 2) * 20, this.frame(i % 2 ? 'petal' : 'leafSpin', age + i * .05), p.y + Math.sin(angle) * r + 12, alpha);
        }
      }
      return;
    }
    a.points.forEach((p, i) => {
      const age = a.age - V.roots.warning - i * V.roots.interval;
      if (age < 0) { this.boundary(p, V.roots.radius, i === V.roots.count - 1 ? '#fff3c0' : palettes.venusaur, 1, true); return; }
      if (age > .65) return;
      const frame = Math.min(this.count('roots') - 1, Math.floor(age / .65 * this.count('roots')));
      // The original plant grows out of the bottom of its cell, at the hit location.
      this.emit('roots', p.x, p.y + 4, frame, p.y + 11, clamp((.65 - age) * 12, 0, 1), [.5, .88]);
      if (age < .22) this.emit('dust', p.x, p.y - 2, Math.min(this.count('dust') - 1, Math.floor(age * 25)), p.y + 4, .65);
    });
  }

  private hazard(h: Hazard): void {
    const color = palettes[h.species];
    this.boundary(h.pos, h.radius, color, 1, h.warmup > 0);
    if (h.warmup > 0) {
      const key = h.species === 'charmander' ? 'ember' : h.species === 'squirtle' ? 'waterWave' : h.species === 'pikachu' ? 'spark' : 'psychicCharge';
      this.emit(key, h.pos.x, h.pos.y - 8, this.frame(key, h.maxLife - h.life), h.pos.y + 5, .65); return;
    }
    const warmup = h.species === 'charmander' || h.species === 'squirtle' ? .35 : .55;
    const age = Math.max(0, h.maxLife - h.life - warmup), alpha = Math.min(1, age * 12, h.life * 8);
    if (h.species === 'charmander') {
      const frame = clamp(Math.floor(age / (h.maxLife - warmup) * 50), 0, 49);
      this.emit('fireBack', h.pos.x, h.pos.y - 32, frame, h.pos.y - 4, alpha);
      this.emit('fireFront', h.pos.x, h.pos.y - 32, frame, h.pos.y + 18, alpha);
      for (let i = 0; i < 6; i++) { const a = this.time * 3 + i * TAU / 6, x = h.pos.x + Math.cos(a) * 45, y = h.pos.y + Math.sin(a) * 24;
        this.emit('ember', x, y - 12, this.frame('ember', this.time + i * .08), y + 8, alpha);
      }
    } else if (h.species === 'squirtle') {
      // Ground body keeps fighters legible; individual foreground splashes provide depth.
      const frame = this.frame('whirlpool', age, whirlpool.fps), anchor = whirlpool.anchors[frame];
      this.emit('whirlpool', h.pos.x, h.pos.y - 14, frame, 4, alpha, [anchor.x / whirlpool.frameWidth, anchor.y / whirlpool.frameHeight]);
      for (let i = 0; i < 3; i++) { const a = -this.time * 2.2 + i * TAU / 3, y = h.pos.y + Math.sin(a) * 28;
        this.emit('waterSplash', h.pos.x + Math.cos(a) * 49, y - 9, this.frame('waterSplash', this.time + i * .09, 12), y + 12, alpha);
      }
    } else if (h.species === 'pikachu') {
      const beat = Math.floor(age / .2), a = beat * 2.4;
      const x = h.pos.x + Math.cos(a) * 32, y = h.pos.y + Math.sin(a) * 25;
      this.stamp(this.paths.context, 'lightningBody', x, y - 105, this.frame('lightningBody', age, 30), 0, alpha);
      this.emit('electricHit', x, y - 12, Math.floor(age * 30) % 10, y + 18, alpha);
    } else {
      const frame = Math.min(22, Math.floor(age / (h.maxLife - warmup) * 23));
      this.emit('psychicBack', h.pos.x, h.pos.y - 22, frame, h.pos.y - 5, alpha);
      this.emit('psychicFront', h.pos.x, h.pos.y - 22, frame, h.pos.y + 18, alpha);
      for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + this.time * .8, y = h.pos.y + Math.sin(a) * 28;
        this.emit('rock', h.pos.x + Math.cos(a) * 44, y - 22 - Math.sin(this.time * 3 + i) * 9, this.frame('rock', this.time + i * .09), y + 15, alpha);
      }
    }
  }

  private fighter(f: Fighter, s: BattleState): void {
    if (f.hp <= 0) return;
    const { x, y } = f.pos;
    if (f.phase === 'windup' && (f.action === 'ranged' || f.action === 'special')) {
      const progress = clamp(1 - f.phaseTime / f.phaseDuration, 0, .999);
      const key: Clip = f.species === 'venusaur' ? 'petalBack' : f.species === 'ivysaur' && f.action === 'special' ? 'solarCharge' : isGrass(f.species) ? 'leafCharge' : f.species === 'charmander' ? 'ember' : f.species === 'squirtle' ? 'waterWave' : f.species === 'pikachu' ? 'charge' : 'psychicCharge';
      const frame = Math.min(this.count(key) - 1, Math.floor(progress * this.count(key)));
      this.emit(key, x, y - (f.species === 'ivysaur' ? 35 : 22), frame, y + 14, .9);
      if (f.species === 'venusaur') {
        const points = f.action === 'special' ? rootPoints(s, f) : [bombLanding(f)];
        points.forEach((p, i) => this.boundary(p, f.action === 'special' ? V.roots.radius : V.bomb.radius, i === V.roots.count - 1 ? '#fff3c0' : palettes.venusaur, 1, true));
        for (let i = 0; i < 4; i++) { const a = i * TAU / 4 + progress * 3; this.emit('petal', x + Math.cos(a) * (30 - progress * 12), y - 30 + Math.sin(a) * 14, this.frame('petal', progress + i * .08), y + (Math.sin(a) < 0 ? -2 : 15)); }
      }
      if (f.species === 'bulbasaur') {
        const c = this.paths.context, px = Math.round((x - 27) / SCALE), py = Math.round((y - 53) / SCALE);
        c.fillStyle = '#253528'; c.fillRect(px, py, 23, 2); c.fillStyle = '#f3eda0';
        c.fillRect(px + 23 * B.leaf.perfectStart / B.leaf.maximum, py, 23 * (B.leaf.perfectEnd - B.leaf.perfectStart) / B.leaf.maximum, 2);
        c.fillStyle = leafTier(f.chargeTime) === 'perfect' ? '#f8ffb2' : '#94c973'; c.fillRect(px, py, Math.round(23 * f.chargeTime / B.leaf.maximum), 1);
      }
      if (f.species === 'ivysaur' && f.action === 'special') {
        const end = solarTrace(s, f).end, c = this.ground.context;
        c.strokeStyle = f.phaseTime <= I.solar.lockTime ? '#fff8b5' : '#9bba75'; c.lineWidth = 1;
        c.setLineDash(f.phaseTime <= I.solar.lockTime ? [] : [2, 3]); c.beginPath(); c.moveTo(Math.round(x / SCALE), Math.round(y / SCALE)); c.lineTo(Math.round(end.x / SCALE), Math.round(end.y / SCALE)); c.stroke(); c.setLineDash([]);
      }
    }
    if (f.paralysisTime > 0) this.emit('spark', x, y - 25, this.frame('spark', this.time, 14), y + 13, .8);
    if (isGrass(f.species) && f.hp <= f.maxHp / 3) this.emit('solarMote', x - 17, y - 28, this.frame('solarMote', this.time, 8), y + 14);
  }

  private beam(b: Beam): void {
    const start = { x: b.start.x, y: b.start.y - 24 }, end = { x: b.end.x, y: b.end.y - 24 };
    const dx = end.x - start.x, dy = end.y - start.y, distance = Math.hypot(dx, dy);
    if (distance < 1) return;
    const angle = Math.atan2(dy, dx), ctx = this.paths.context;
    // Compose/rotate at native logical resolution, then enlarge the whole layer once.
    // Clip at the true blocker so decorative frame extents cannot leak through walls.
    ctx.save(); ctx.translate(Math.round(start.x / SCALE), Math.round(start.y / SCALE)); ctx.rotate(angle);
    ctx.beginPath(); ctx.rect(0, -24, distance / SCALE, 48); ctx.clip();
    if (b.species === 'charmander') {
      if (this.scene.textures.exists('vfx-ember')) for (let i = 0; i < distance / SCALE; i += 4) {
        const frame = this.scene.textures.getFrame('vfx-ember', 1 + Math.floor((this.time * 18 - i / 9 + 1000) % 5));
        const bend = Math.round(Math.sin(i * .23 - this.time * 14) * Math.min(2, i / 24));
        ctx.save(); ctx.translate(i, bend); ctx.rotate(Math.PI / 2);
        ctx.drawImage(frame.source.image as CanvasImageSource, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, -12, -12, 24, 24); ctx.restore();
      } else this.missing.add('ember');
    } else {
      const key: Clip = b.species === 'pikachu' ? 'lightningBody' : b.species === 'mewtwo' ? 'psychicBody' : b.species === 'ivysaur' ? 'solarBody' : 'waterFlow';
      if (this.scene.textures.exists(`vfx-${key}`)) {
        const frame = this.scene.textures.getFrame(`vfx-${key}`, this.frame(key));
        ctx.save(); ctx.rotate(-Math.PI / 2);
        if (key === 'lightningBody' || key === 'waterFlow') {
          for (let i = 0; i < distance / SCALE; i += frame.cutHeight) ctx.drawImage(frame.source.image as CanvasImageSource, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, -frame.cutWidth / 2, i, frame.cutWidth, frame.cutHeight);
        } else {
          const width = Math.max(5, Math.round(b.width / SCALE));
          // The source column is wide; import its cross section at the actual gameplay width.
          // Short textured sections shift by a logical pixel, keeping a flowing surface.
          for (let i = 0; i < distance / SCALE; i += 5) {
            ctx.drawImage(frame.source.image as CanvasImageSource, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, -Math.floor(width / 2), i, width, Math.min(5, distance / SCALE - i));
          }
        }
        ctx.restore();
      } else this.missing.add(key);
    }
    // Restore world coordinates while retaining the beam's clipping region for traveling waves.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (b.species === 'mewtwo') for (let i = 0; i < 4; i++) {
      const t = (this.time * 1.5 + i / 4) % 1;
      this.stamp(ctx, 'psychicWave', start.x + dx * t, start.y + dy * t, this.frame('psychicWave') + 2 * manifest.psychicWave.columns, angle);
    }
    ctx.restore();
    const beamClip: Clip = b.species === 'charmander' ? 'ember' : b.species === 'pikachu' ? 'lightningBody' : b.species === 'mewtwo' ? 'psychicBody' : b.species === 'ivysaur' ? 'solarBody' : 'waterFlow';
    this.draws.push({ clip: beamClip, frame: this.frame(beamClip), x: Math.round(end.x), y: Math.round(end.y), depth: 800, missing: this.missing.has(beamClip) });
    if (b.blocked) {
      const key: Clip = b.species === 'charmander' ? 'ember' : b.species === 'squirtle' ? 'waterSplash' : b.species === 'pikachu' ? 'spark' : b.species === 'ivysaur' ? 'grassHit' : 'psychicHit';
      this.emit(key, end.x, end.y, this.frame(key), 825);
    }
  }

  private effect(e: Effect): void {
    const progress = clamp(1 - e.life / e.maxLife, 0, .999), age = e.maxLife - e.life;
    const alpha = Math.min(1, e.life * 12), x = e.pos.x, y = e.pos.y - 22;
    if (e.kind === 'solar' && e.end) { this.beam({ owner: 0, species: 'ivysaur', start: e.pos, end: e.end, width: 14, power: 1, blocked: true }); return; }
    if (e.kind === 'scorch') return; // persistent mark and the flame body already express heat
    if (e.kind === 'melee' && e.species === 'venusaur') {
      const radius = V.petals.range * (.8 + progress * .2);
      this.emit('petalBack', e.pos.x, e.pos.y - 25, Math.min(this.count('petalBack') - 1, Math.floor(progress * this.count('petalBack'))), e.pos.y - 3, alpha);
      for (let i = 0; i < 16; i++) {
        const a = i * TAU / 16 + progress * 2.3, r = radius * (i % 2 ? 1 : .65);
        const py = e.pos.y + Math.sin(a) * r;
        this.emit('petal', e.pos.x + Math.cos(a) * r, py - 18 - Math.sin(progress * Math.PI) * 12, this.frame('petal', age + i * .06), py + 12, alpha);
      }
      this.emit('petalFront', e.pos.x, e.pos.y - 25, Math.min(this.count('petalFront') - 1, Math.floor(progress * this.count('petalFront'))), e.pos.y + 15, alpha);
      return;
    }
    if (e.kind === 'melee') {
      if (isGrass(e.species) && e.points?.length) {
        // Whip tips follow the clipped collision fan, with native-frame bends along the reach.
        const points = e.points, index = Math.floor(progress * (points.length - 1)), tip = points[index];
        const dx = tip.x - x, dy = tip.y - e.pos.y, distance = Math.hypot(dx, dy), ctx = this.paths.context;
        const c = ctx; c.save(); c.strokeStyle = '#315337'; c.lineWidth = 3; c.beginPath();
        c.moveTo(Math.round(x / SCALE), Math.round(y / SCALE));
        c.quadraticCurveTo(Math.round((x + dx * .55 - dy * .2) / SCALE), Math.round((y + dy * .55 + dx * .2) / SCALE), Math.round(tip.x / SCALE), Math.round((tip.y - 22) / SCALE)); c.stroke();
        c.strokeStyle = '#a3d960'; c.lineWidth = 1; c.stroke(); c.restore();
        if (distance > 5) this.emit('leafSpin', tip.x, tip.y - 22, this.frame('leafSpin', age, 30), 820, alpha);
        if (progress > .4 && progress < .8) this.emit('vineHit', tip.x, tip.y - 22, Math.min(2, Math.floor(progress * 3)), 820, alpha);
      } else if (e.species === 'charmander') this.stamp(this.paths.context, 'scratch', x + Math.cos(e.angle) * 32, y + Math.sin(e.angle) * 32, Math.min(6, Math.floor(progress * 7)), e.angle - Math.PI / 2, alpha);
      else {
        const key = e.species === 'mewtwo' ? 'psychicHit' : e.species === 'pikachu' ? 'dash' : 'impact';
        this.emit(key, x + Math.cos(e.angle) * 28, y + Math.sin(e.angle) * 28, Math.min(this.count(key) - 1, Math.floor(progress * this.count(key))), e.pos.y + 16, alpha);
      }
      return;
    }
    const key: Clip = e.kind === 'debris' ? 'rock' : e.kind === 'steam' ? 'steam' : e.kind === 'dust' || e.kind === 'trail' ? 'dust' : e.kind === 'dodge' ? 'dash' : e.kind === 'splash' ? 'waterSplash' : e.kind === 'combo' ? 'grassHit' : e.kind === 'charge' ? 'charge' : e.kind === 'shockwave' ? (e.species === 'squirtle' ? 'waterWave' : 'heavyHit') : e.kind === 'burst' ? (e.species === 'squirtle' ? 'waterHit' : e.species === 'charmander' ? 'flame' : e.species === 'pikachu' ? 'electricHit' : 'psychicHit') : 'hit';
    const frame = Math.min(this.count(key) - 1, Math.floor(progress * this.count(key)));
    const floor = ['dust', 'dodge', 'splash', 'shockwave'].includes(e.kind);
    if (e.kind === 'debris') for (let i = 0; i < 5; i++) { const a = e.angle + i * 2.4; this.emit('rock', x + Math.cos(a) * progress * 42, e.pos.y + Math.sin(a) * progress * 28 - Math.sin(progress * Math.PI) * 28, this.frame('rock', age + i * .1), e.pos.y + 18, alpha); }
    else this.emit(key, x, floor ? e.pos.y - 4 : y, frame, floor ? e.pos.y + 5 : e.pos.y + 18, alpha);
  }

  destroy(): void {
    this.pool.forEach(sprite => sprite.destroy()); this.groundImage.destroy(); this.pathImage.destroy();
    this.scene.textures.remove(this.ground.key); this.scene.textures.remove(this.paths.key);
  }
}
