import Phaser from 'phaser';
import type { BattleState, Beam, Effect, Fighter, Hazard, Obstacle, Vec } from '../game/types';
import { WORLD } from '../game/types';
import { animationData, type AnimationClip } from './animationData';

export function preloadArena(scene: Phaser.Scene): void {
  // Art is optional and local. A clean source checkout deliberately has no PNGs.
  scene.load.maxRetries = 0;
  const failed: string[] = [];
  const onMissing = (file: Phaser.Loader.File) => { failed.push(file.key); };
  scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onMissing);
  scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
    scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onMissing);
    scene.registry.set('arenaMissingLocalArt', failed);
  });
  for (const [species, clips] of Object.entries(animationData)) for (const [name, clip] of Object.entries(clips)) {
    if (!('alias' in clip)) scene.load.spritesheet(`${species}-${name}`, `./assets/animated/${clip.file}`, { frameWidth: clip.frameWidth, frameHeight: clip.frameHeight });
  }
}
export interface FrameDebug { id: number; species: string; animation: string; direction: number; frame: number; texture: string; phase: string; anchor: Vec; placeholder: boolean }
interface Ghost { x: number; y: number; texture: string; frame: number; ox: number; oy: number; time: number }
interface FighterView {
  sprite: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Ellipse; bars: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text;
  ghosts: Phaser.GameObjects.Image[]; history: Ghost[]; lastGhostTime: number;
  animation: string; phase: string; animationStart: number; debug: FrameDebug;
}
const clamp = Phaser.Math.Clamp;
const TAU = Math.PI * 2;
const directionRow = (v: Vec) => (Math.round((Math.PI / 2 - Math.atan2(v.y, v.x)) / (Math.PI / 4)) + 8) % 8;
const elementColor = (species: string) => species === 'pikachu' ? 0xffe15a : species === 'charmander' ? 0xff9a40 : 0x7bdcff;

/** Sprite frames and all effects follow simulation time, so pause freezes motion. */
export class ArenaRenderer {
  private floor: Phaser.GameObjects.Graphics;
  private floorImage: Phaser.GameObjects.Image;
  private ground: Phaser.GameObjects.Graphics;
  private zones: Phaser.GameObjects.Graphics;
  private attacks: Phaser.GameObjects.Graphics;
  private effects: Phaser.GameObjects.Graphics;
  private props = new Map<number, Phaser.GameObjects.Graphics>();
  private views: FighterView[] = [];
  private lastTime = -1;
  private placeholders = new Set<string>();

  constructor(private scene: Phaser.Scene) {
    this.floor = scene.add.graphics().setDepth(0);
    this.ground = scene.add.graphics().setDepth(1);
    this.zones = scene.add.graphics().setDepth(700);
    this.attacks = scene.add.graphics().setDepth(800);
    this.effects = scene.add.graphics().setDepth(900);
    this.drawArena();
    // Bake the unchanging stone detail once instead of replaying hundreds of paths.
    this.floor.generateTexture('arena-stone-floor', WORLD.width, WORLD.height);
    this.floorImage = scene.add.image(0, 0, 'arena-stone-floor').setOrigin(0).setDepth(0);
    scene.textures.get('arena-stone-floor').setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.floor.clear();
    for (const [species, clips] of Object.entries(animationData)) for (const [name, clip] of Object.entries(clips)) {
      if (!('alias' in clip)) {
        const key = `${species}-${name}`;
        if (!scene.textures.exists(key)) this.createPlaceholder(key, species, clip);
        scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
      }
    }
    for (let id = 0; id < 2; id++) {
      const species = id === 0 ? 'charmander' : 'squirtle'; const texture = `${species}-Idle`;
      this.views.push({
        sprite: scene.add.image(0, 0, texture).setScale(2.4),
        shadow: scene.add.ellipse(0, 0, 38, 12, 0x131820, 0.5).setDepth(2),
        bars: scene.add.graphics().setDepth(1100),
        label: scene.add.text(0, 0, id === 0 ? 'YOU' : 'CPU', { fontFamily: 'monospace', fontSize: '9px', fontStyle: 'bold', color: '#e8f5fa', stroke: '#141924', strokeThickness: 3, letterSpacing: 1 }).setOrigin(0.5).setDepth(1101),
        ghosts: Array.from({ length: 5 }, () => scene.add.image(0, 0, texture).setScale(2.4).setVisible(false)),
        history: [], lastGhostTime: -1, animation: '', phase: '', animationStart: 0,
        debug: { id, species, animation: 'Idle', direction: 0, frame: 0, texture, phase: 'idle', anchor: { x: 0, y: 0 }, placeholder: this.placeholders.has(texture) },
      });
    }
  }
  debugFrames(): FrameDebug[] { return this.views.map(view => ({ ...view.debug, anchor: { ...view.debug.anchor } })); }
  /** Input coordinates are stage-local 960x600, before the small impact shake. */
  screenToWorld(x: number, y: number): Vec { const point = this.scene.cameras.main.getWorldPoint(x, y); return { x: point.x, y: point.y }; }

  private createPlaceholder(key: string, species: string, clip: AnimationClip): void {
    const texture = this.scene.textures.createCanvas(key, clip.frameWidth * clip.columns, clip.frameHeight * clip.rows);
    if (!texture) throw new Error(`Could not create optional-art fallback: ${key}`);
    const ctx = texture.getContext();
    const color = `#${elementColor(species).toString(16).padStart(6, '0')}`;
    for (let row = 0; row < clip.rows; row++) for (let column = 0; column < clip.columns; column++) {
      const index = row * clip.columns + column; const anchor = clip.shadowAnchors[index];
      const x = column * clip.frameWidth; const y = row * clip.frameHeight;
      texture.add(index, 0, x, y, clip.frameWidth, clip.frameHeight);
      ctx.save(); ctx.translate(x + anchor.x, y + anchor.y - 8);
      // Generic diamond token with a direction arrow: no character silhouette is embedded.
      const radius = 7 + column % 2;
      ctx.fillStyle = '#1d2937'; ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -radius); ctx.lineTo(radius, 0); ctx.lineTo(0, radius); ctx.lineTo(-radius, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.rotate(Math.PI / 2 - row * Math.PI / 4);
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-2, -3); ctx.lineTo(-2, 3); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    texture.refresh(); this.placeholders.add(key);
  }

  private drawArena(): void {
    const g = this.floor;
    g.fillStyle(0x242a35).fillRect(-12, -12, 984, 624);
    let seed = 413;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const palette = [0x505a6c, 0x4a5466, 0x475163, 0x555e70, 0x424d60];
    for (let row = 0; row < 8; row++) {
      let x = row % 2 ? -47 : -4;
      while (x < 962) {
        const w = [73, 95, 117][Math.floor(random() * 3)]; const y = row * 80 - 11;
        g.fillStyle(palette[Math.floor(random() * palette.length)]).fillRect(x + 3, y + 3, w - 4, 76);
        g.fillStyle(0xb1b9bd, 0.32).fillRect(x + 3, y + 3, w - 5, 2);
        g.fillStyle(0x8c9aab, 0.3).fillRect(x + 3, y + 3, 2, 73);
        g.fillStyle(0x181f2b, 0.7).fillRect(x + 3, y + 76, w - 4, 3);
        for (let n = 0; n < 10; n++) {
          const px = Math.round((x + 7 + random() * (w - 15)) / 2) * 2; const py = Math.round((y + 8 + random() * 64) / 2) * 2;
          g.fillStyle(n % 2 ? 0xb0bac5 : 0x222c3b, 0.1).fillRect(px, py, 3 + Math.floor(random() * 3) * 2, 3);
        }
        if (random() > 0.6) {
          const px = x + w * 0.55; const py = y + 13;
          g.lineStyle(2, 0x242d3e, 0.9).beginPath(); g.moveTo(px, py); g.lineTo(px - 10, py + 13); g.lineTo(px - 3, py + 24); g.lineTo(px - 17, py + 35); g.strokePath();
          g.lineStyle(1, 0xb3c4d0, 0.4).lineBetween(px + 2, py + 1, px - 7, py + 13);
        }
        for (let n = 0; n < 6; n++) g.fillStyle(0xc2d4dc, 0.35).fillRect(x + 3 + Math.floor(random() * (w - 8)), y + 2 + Math.floor(random() * 3), 2, 3);
        x += w;
      }
    }
    g.lineStyle(6, 0x242c39, 0.95).strokeCircle(480, 302, 211);
    g.lineStyle(2, 0xd7d9c9, 0.65).strokeCircle(480, 302, 211);
    g.lineStyle(5, 0x242c39, 0.95).strokeCircle(480, 302, 51);
    g.lineStyle(2, 0xd7d9c9, 0.58).strokeCircle(480, 302, 51);
    g.lineStyle(3, 0xd7d9c9, 0.35).lineBetween(480, 22, 480, 580);
    g.lineStyle(2, 0xd7d9c9, 0.45).strokeRect(WORLD.left - 10, WORLD.top - 13, WORLD.right - WORLD.left + 20, WORLD.bottom - WORLD.top + 26);
    g.fillStyle(0x131a28, 0.45).fillRect(0, 0, 960, 63).fillRect(0, 558, 960, 42).fillRect(0, 63, 63, 495).fillRect(897, 63, 63, 495);
  }
  render(state: BattleState): void {
    if (state.time < this.lastTime) this.views.forEach(view => { view.animation = ''; view.history = []; view.lastGhostTime = -1; });
    this.lastTime = state.time;
    this.ground.clear(); this.zones.clear(); this.attacks.clear(); this.effects.clear();
    this.drawGround(state); this.drawObstacles(state.obstacles);
    for (const hazard of state.hazards) this.drawHazard(hazard, state.time);
    state.fighters.forEach((fighter, id) => this.drawFighter(this.views[id], fighter, state.time));
    for (const beam of state.beams) this.drawBeam(beam, state.time);
    if (state.clash) this.drawClash(state.clash.pos, state.clash.intensity, state.time, state.beams.some(beam => beam.species === 'pikachu'));
    for (const effect of state.effects) this.drawEffect(effect);
    const shake = Math.min(2.6, Math.max(0, state.cameraImpact) * 4);
    this.scene.cameras.main.setScroll(Math.sin(state.time * 91) * shake, Math.cos(state.time * 113) * shake * 0.6);
  }
  private clip(species: string, name: string): { name: string; data: AnimationClip } {
    const entry = animationData[species][name]; return 'alias' in entry ? this.clip(species, entry.alias) : { name, data: entry };
  }
  private drawFighter(view: FighterView, f: Fighter, time: number): void {
    let animation = 'Idle';
    if (f.hp <= 0 || f.knockdownTime > 0) animation = 'Faint';
    else if (f.hitTime > 0 || f.stunTime > 0) animation = 'Hurt';
    else if (f.action === 'dodge') animation = 'Charge';
    else if (f.action === 'melee') animation = 'Attack';
    else if (f.action === 'ranged' || f.action === 'special') animation = f.phase === 'windup' ? 'Charge' : 'Shoot';
    else if (Math.hypot(f.moveVelocity.x, f.moveVelocity.y) > 5) animation = 'Walk';
    if (view.animation !== animation || view.phase !== f.phase || time < view.animationStart) {
      view.animation = animation; view.phase = f.phase; view.animationStart = time;
    }
    const { name, data } = this.clip(f.species, animation);
    const progress = f.phaseDuration > 0 ? clamp(1 - f.phaseTime / f.phaseDuration, 0, 0.999) : 0;
    let column = 0;
    const inRange = (first: number, last: number, fraction: number) => Math.floor(first + clamp(fraction, 0, 0.999) * (last - first + 1));
    if (animation === 'Attack') {
      const rush = data.rushFrame ?? 2; const back = data.returnFrame ?? data.columns - 2;
      column = f.phase === 'windup' ? inRange(0, Math.max(0, rush - 1), progress) : f.phase === 'active' ? inRange(rush, Math.max(rush, back - 1), progress) : inRange(back, data.columns - 1, progress);
    } else if (animation === 'Faint') column = Math.min(data.columns - 1, Math.floor((time - view.animationStart) / 0.075));
    else if (animation === 'Hurt') column = time - view.animationStart < 0.04 ? 0 : data.columns - 1;
    else if (animation === 'Charge' && f.phase === 'windup') column = inRange(0, Math.min(data.columns - 1, data.hitFrame ?? 4), progress);
    else if (animation === 'Shoot' && f.phase === 'recovery') column = inRange(data.returnFrame ?? data.columns - 3, data.columns - 1, progress);
    else {
      let first = 0; let last = data.columns - 1;
      if (animation === 'Shoot' && f.phase === 'active') { first = data.hitFrame ?? 2; last = Math.max(first, (data.returnFrame ?? data.columns) - 1); }
      const durations = data.durations.slice(first, last + 1);
      let tick = ((time - view.animationStart) * (animation === 'Walk' ? 74 : 60)) % durations.reduce((sum, d) => sum + d, 0);
      column = first;
      while (column < last && tick >= data.durations[column]) { tick -= data.durations[column]; column++; }
    }
    const direction = directionRow(f.facing); const frame = direction * data.columns + clamp(column, 0, data.columns - 1);
    const anchor = data.shadowAnchors[frame]; const texture = `${f.species}-${name}`;
    view.sprite.setTexture(texture, frame).setOrigin(anchor.x / data.frameWidth, anchor.y / data.frameHeight).setPosition(Math.round(f.pos.x), Math.round(f.pos.y)).setDepth(f.pos.y + 10).setScale(2.4).setRotation(0).setFlipX(false).setAlpha(f.hp <= 0 ? 0.78 : 1);
    if (f.hitTime > 0 && Math.floor(time * 40) % 2 === 0) view.sprite.setTintFill(0xfff4e6); else view.sprite.clearTint();
    view.shadow.setPosition(f.pos.x, f.pos.y + 2).setAlpha(f.hp <= 0 ? 0.3 : 0.6);
    view.debug = { id: f.id, species: f.species, animation, direction, frame, texture, phase: f.phase, anchor: { ...anchor }, placeholder: this.placeholders.has(texture) };
    if ((f.action === 'dodge' || (f.species === 'pikachu' && f.action === 'melee' && f.phase === 'active')) && time - view.lastGhostTime > 0.025) {
      view.history.push({ x: f.pos.x, y: f.pos.y, texture, frame, ox: view.sprite.originX, oy: view.sprite.originY, time }); view.lastGhostTime = time;
    }
    view.history = view.history.filter(ghost => time - ghost.time < 0.19).slice(-5);
    view.ghosts.forEach((image, i) => {
      const ghost = view.history[i]; image.setVisible(Boolean(ghost));
      if (ghost) image.setTexture(ghost.texture, ghost.frame).setOrigin(ghost.ox, ghost.oy).setPosition(ghost.x, ghost.y).setDepth(ghost.y + 4).setTint(elementColor(f.species)).setAlpha((1 - (time - ghost.time) / 0.19) * 0.32);
    });
    const bars = view.bars.clear(); const x = Math.round(f.pos.x - 29); const y = Math.round(f.pos.y - 65);
    bars.fillStyle(0x111b2a, 0.92).fillRect(x - 1, y - 1, 60, 10);
    bars.fillStyle(0x324b61).fillRect(x, y, 58, 7);
    bars.fillStyle(f.hp / f.maxHp < 0.25 ? 0xff8171 : 0x39c5f2).fillRect(x, y, 58 * Math.max(0, f.hp / f.maxHp), 7);
    bars.fillStyle(0xc8f5ff, 0.8).fillRect(x, y, 58 * Math.max(0, f.hp / f.maxHp), 1);
    view.label.setPosition(f.pos.x, y - 8);
    if (f.phase === 'windup' && (f.action === 'ranged' || f.action === 'special')) {
      const color = elementColor(f.species);
      this.ground.lineStyle(2, color, 0.55).strokeEllipse(f.pos.x, f.pos.y, 48 + progress * 14, 19 + progress * 5);
      for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + time * 6; const r = 26 * (1 - progress) + 9;
        this.effects.fillStyle(color, 0.7).fillRect(f.pos.x + Math.cos(a) * r - 1, f.pos.y - 21 + Math.sin(a) * r - 1, 3, 3);
      }
    }
    if (f.paralysisTime > 0 && f.hp > 0) {
      for (let i = 0; i < 3; i++) {
        const angle = time * 5 + i * TAU / 3;
        const start = { x: f.pos.x + Math.cos(angle) * 18, y: f.pos.y - 23 + Math.sin(angle) * 16 };
        this.lightning(this.effects, start, { x: start.x + Math.cos(angle + 1) * 14, y: start.y - 8 }, time + i, 2, 0.9);
      }
    }
  }
  private drawGround(state: BattleState): void {
    const g = this.ground;
    for (const mark of state.groundMarks) {
      const alpha = Math.min(0.6, mark.life * 0.16); const r = mark.radius; const wet = mark.kind === 'wet';
      g.fillStyle(wet ? 0x448caa : 0x141b24, alpha).fillEllipse(mark.pos.x, mark.pos.y, r * 2, r * 1.22);
      g.lineStyle(2, wet ? 0x9cdef4 : 0x9a9182, alpha * 0.6).strokeEllipse(mark.pos.x, mark.pos.y, r * 2.1, r * 1.3);
      if (!wet) for (let i = 0; i < 7; i++) { const a = i * TAU / 7 + mark.angle;
        g.lineStyle(2, 0x18202c, alpha * 1.3).lineBetween(mark.pos.x + Math.cos(a) * r * 0.6, mark.pos.y + Math.sin(a) * r * 0.4, mark.pos.x + Math.cos(a) * r * 1.4, mark.pos.y + Math.sin(a) * r * 0.9);
      }
    }
  }
  private drawObstacles(obstacles: Obstacle[]): void {
    const alive = new Set(obstacles.filter(o => o.hp > 0).map(o => o.id));
    for (const [id, graphics] of this.props) if (!alive.has(id)) { graphics.destroy(); this.props.delete(id); }
    for (const obstacle of obstacles) {
      if (obstacle.hp <= 0) continue;
      let g = this.props.get(obstacle.id); if (!g) { g = this.scene.add.graphics(); this.props.set(obstacle.id, g); }
      g.clear().setPosition(obstacle.pos.x, obstacle.pos.y).setDepth(obstacle.pos.y + 4);
      const r = obstacle.radius; g.fillStyle(0x17202a, 0.45).fillEllipse(3, 4, r * 2.4, r * 1.25);
      if (obstacle.kind === 'crate') {
        g.fillStyle(0x352519).fillRect(-r - 2, -r * 1.7 - 2, r * 2 + 4, r * 1.9 + 4);
        g.fillStyle(0xaa7845).fillRect(-r, -r * 1.7, r * 2, r * 1.9);
        for (let i = 0; i < 4; i++) { const y = -r * 1.7 + i * r * 0.46;
          g.fillStyle(0xdfae70).fillRect(-r + 2, y + 1, r * 2 - 4, 3); g.fillStyle(0x654525).fillRect(-r + 2, y + r * 0.43, r * 2 - 4, 2);
        }
        g.lineStyle(6, 0xd9aa68).lineBetween(-r + 4, 0, r - 4, -r * 1.25);
        g.lineStyle(2, 0x6a462a).lineBetween(-r + 4, 3, r - 4, -r * 1.25 + 3);
        g.fillStyle(0x453122).fillRect(-r + 3, -r * 1.7 + 3, 3, 3).fillRect(r - 6, -2, 3, 3);
      } else {
        const points = [{ x: -r, y: -r * 0.5 }, { x: -r * 0.56, y: -r * 1.55 }, { x: r * 0.38, y: -r * 1.7 }, { x: r, y: -r * 0.9 }, { x: r * 0.82, y: 1 }, { x: -r * 0.35, y: r * 0.24 }];
        g.fillStyle(0x333b46).fillPoints(points, true); g.lineStyle(2, 0x202833).strokePoints(points, true);
        g.fillStyle(0x959890).fillTriangle(-r * 0.56, -r * 1.5, r * 0.3, -r * 1.64, -r * 0.1, -r * 0.55);
        g.fillStyle(0x747b7b).fillTriangle(r * 0.3, -r * 1.64, r * 0.9, -r * 0.8, -r * 0.1, -r * 0.55);
        g.fillStyle(0x5a6468).fillTriangle(-r * 0.95, -r * 0.5, -r * 0.56, -r * 1.5, -r * 0.1, -r * 0.55);
        g.fillStyle(0xa5ab8e).fillRect(-r * 0.5, -r * 1.42, 9, 5).fillRect(-r * 0.34, -r * 1.52, 6, 5);
      }
      if (obstacle.hp < obstacle.maxHp * 0.7) { g.lineStyle(2, 0x1b2029).beginPath(); g.moveTo(-r * 0.35, -r * 1.4); g.lineTo(2, -r * 0.75); g.lineTo(-6, -r * 0.35); g.lineTo(2, 0); g.strokePath(); }
    }
  }
  private drawBeam(beam: Beam, time: number): void {
    const g = this.attacks; const sx = beam.start.x; const sy = beam.start.y - 24; const ex = beam.end.x; const ey = beam.end.y - 24;
    const dx = ex - sx; const dy = ey - sy; const distance = Math.hypot(dx, dy); if (distance < 1) return;
    const ux = dx / distance; const uy = dy / distance; const width = Math.max(8, beam.width); const fire = beam.species === 'charmander';
    if (beam.species === 'pikachu') {
      this.lightning(g, { x: sx, y: sy }, { x: ex, y: ey }, time, width * 0.35, 1);
      for (let branch = 0; branch < 5; branch++) {
        const t = (branch + 1) / 6;
        const side = branch % 2 ? 1 : -1;
        const start = { x: sx + dx * t, y: sy + dy * t };
        const end = { x: start.x + ux * 16 - uy * side * 20, y: start.y + uy * 16 + ux * side * 20 };
        this.lightning(g, start, end, time + branch, 1.5, 0.7);
      }
      g.fillStyle(0xfff5a8, 0.85).fillCircle(sx, sy, 7);
      if (beam.blocked) this.spark(ex, ey, time * 13, 0xffe56f, 24, 0.9);
      return;
    }
    g.lineStyle(width * 2.6, fire ? 0xff6b1d : 0x48a9ff, 0.1).lineBetween(sx, sy, ex, ey);
    if (fire) {
      const count = Math.ceil(distance / 9);
      for (let i = 0; i <= count; i++) {
        const t = i / count; const wave = Math.sin(i * 1.8 - time * 38) * (2 + t * 3);
        const x = sx + dx * t - uy * wave; const y = sy + dy * t + ux * wave;
        const r = width * (0.3 + t * 0.52) + Math.sin(time * 29 - i * 1.6) * 1.5;
        g.fillStyle(0x8f301b).fillCircle(x, y + 2, r + 2); g.fillStyle(0xe9541c).fillCircle(x, y, r + 0.5);
        g.fillStyle(0xff982d).fillCircle(x + ux * 2, y - 1, r * 0.77); g.fillStyle(0xffd25a).fillCircle(x + ux * 3, y - 1.5, r * 0.46);
        g.fillStyle(0xfff1be, 0.9).fillCircle(x + ux * 4, y - 2, r * 0.19);
      }
      for (let i = 0; i < 9; i++) { const t = (time * 0.8 + i / 9) % 1; const side = Math.sin(i * 19 + time * 3);
        g.fillStyle(i % 2 ? 0xffd276 : 0xff8540, 0.7).fillRect(sx + dx * t - uy * side * width * 1.9, sy + dy * t + ux * side * width * 1.9, 2 + i % 2, 2 + i % 2);
      }
    } else {
      for (const [lineWidth, color, alpha] of [[width * 1.4, 0x1458a4, 0.95], [width, 0x248feb, 1], [width * 0.59, 0x8ae8ff, 1], [width * 0.28, 0xf4ffff, 1]]) {
        g.lineStyle(lineWidth, color, alpha).beginPath(); g.moveTo(sx, sy);
        for (let i = 1; i <= 16; i++) { const t = i / 16; const bend = Math.sin(t * 18 - time * 22) * 2.4 * Math.sin(t * Math.PI); g.lineTo(sx + dx * t - uy * bend, sy + dy * t + ux * bend); } g.strokePath();
      }
      for (let i = 0; i < 14; i++) { const t = (time * 1.4 + i / 14) % 1; const side = Math.sin(i * 13) * width * 0.95;
        g.fillStyle(0xdbfbff, 0.7).fillRect(sx + dx * t - uy * side, sy + dy * t + ux * side, 2, 3);
      }
    }
    g.fillStyle(fire ? 0xffcf55 : 0xcffaff, 0.75).fillCircle(sx, sy, width * 0.45);
    if (beam.blocked) this.spark(ex, ey, time * 10, fire ? 0xffc660 : 0xc0f3ff, width * 1.2, 0.8);
  }
  private drawClash(pos: Vec, intensity: number, time: number, electric = false): void {
    const g = this.effects; const y = pos.y - 24; const r = 12 + Math.min(2, intensity) * 5;
    g.fillStyle(0xffebad, 0.13).fillCircle(pos.x, y, r * 2.3); g.fillStyle(0xe3fbff, 0.6).fillCircle(pos.x, y, r);
    g.fillStyle(0xfff9dc).fillCircle(pos.x + Math.sin(time * 31) * 3, y, r * 0.65); this.spark(pos.x, y, time * 7, 0xf0fcff, r * 1.8, 0.9);
    if (electric) {
      for (let i = 0; i < 6; i++) {
        const a = i * TAU / 6 + time;
        this.lightning(g, { x: pos.x, y }, { x: pos.x + Math.cos(a) * 47, y: y + Math.sin(a) * 38 }, time + i, 2, 0.8);
      }
      return;
    }
    // Advect steam from the actual simulation clash, never a fabricated crossing.
    for (let i = 0; i < 18; i++) { const age = (time * 0.85 + i / 18) % 1;
      const x = pos.x + Math.sin(age * 5 + time + i * 0.7) * (7 + age * 25) - age * 19;
      g.fillStyle(i % 3 ? 0xe0eef0 : 0xf2ead7, (1 - age) * 0.28).fillCircle(x, y - age * 111, 5 + age * 19);
    }
  }
  private drawHazard(h: Hazard, time: number): void {
    const g = this.zones; const fire = h.species === 'charmander'; const color = elementColor(h.species); const fade = Math.min(1, h.life * 3);
    if (h.warmup > 0) {
      this.ground.fillStyle(color, 0.07).fillCircle(h.pos.x, h.pos.y, h.radius);
      this.ground.lineStyle(2, color, 0.6 + Math.sin(time * 22) * 0.2).strokeCircle(h.pos.x, h.pos.y, h.radius);
      this.ground.lineStyle(1, color, 0.5).strokeCircle(h.pos.x, h.pos.y, h.radius * 0.76); return;
    }
    if (h.species === 'pikachu') {
      const pulse = Math.max(0.2, 1 - ((0.6 - h.life + 0.6) % 0.2) / 0.2);
      this.ground.fillStyle(0xffd748, 0.13 * pulse).fillCircle(h.pos.x, h.pos.y, h.radius);
      this.ground.lineStyle(3, 0xffe787, fade * 0.8).strokeEllipse(h.pos.x, h.pos.y, h.radius * 2, h.radius * 1.25);
      for (let i = 0; i < 3; i++) {
        const a = i * TAU / 3 + Math.floor(time * 5) * 0.6;
        const target = { x: h.pos.x + Math.cos(a) * h.radius * 0.48, y: h.pos.y + Math.sin(a) * h.radius * 0.36 };
        this.lightning(g, { x: target.x - 20, y: target.y - 145 }, target, time + i, 3 + pulse * 3, Math.max(0.3, fade));
        this.spark(target.x, target.y, time * 12 + i, 0xfff4b5, 15 + pulse * 14, fade);
      }
      return;
    }
    this.ground.fillStyle(fire ? 0x74281d : 0x15588a, fade * 0.24).fillEllipse(h.pos.x, h.pos.y, h.radius * 2, h.radius * 1.25);
    if (fire) {
      const height = 105; const base = h.radius * 0.6;
      for (let band = 0; band < 5; band++) for (const [lineWidth, c, alpha] of [[8, 0xa63a15, 0.85], [5, 0xff761e, 0.96], [2, 0xffdd71, 0.92]]) {
        g.lineStyle(lineWidth, c, alpha * fade).beginPath();
        for (let i = 0; i <= 30; i++) { const t = i / 30; const angle = t * TAU + time * 9 + band * 0.55;
          const lift = (band / 5 + t / 5) * height; const radius = base * (0.54 + lift / height * 0.52);
          const x = h.pos.x + Math.cos(angle) * radius; const y = h.pos.y - lift + Math.sin(angle) * radius * 0.26;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        } g.strokePath();
      }
      for (let i = 0; i < 16; i++) { const age = (time * 0.7 + i / 16) % 1; const a = i * 2.4 + time * 6;
        g.fillStyle(i % 2 ? 0xffedb2 : 0xff903e, fade * (1 - age)).fillRect(h.pos.x + Math.cos(a) * base * (1 + age), h.pos.y - age * 135, 3, 4);
      }
    } else {
      for (let arm = 0; arm < 3; arm++) for (const [lineWidth, c, alpha] of [[13, 0x237eca, 0.45], [7, 0x57bcff, 0.9], [2, 0xe5fcff, 1]]) {
        g.lineStyle(lineWidth, c, alpha * fade).beginPath();
        for (let i = 0; i <= 30; i++) { const t = i / 30; const a = arm * TAU / 3 + t * 2.4 - time * 5; const radius = 8 + t * (h.radius - 8);
          const x = h.pos.x + Math.cos(a) * radius; const y = h.pos.y + Math.sin(a) * radius * 0.62 - 7;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        } g.strokePath();
      }
      for (let i = 0; i < 24; i++) { const a = i * 2.4 + time * 2.8; const r = h.radius * (0.45 + ((i * 0.23 + time * 0.4) % 0.65));
        g.fillStyle(0xbcefff, fade * 0.8).fillRect(h.pos.x + Math.cos(a) * r, h.pos.y + Math.sin(a) * r * 0.65 - 5 - Math.sin(time * 9 + i) * 6, 2, 3);
      }
    }
  }
  private lightning(g: Phaser.GameObjects.Graphics, start: Vec, end: Vec, time: number, width: number, alpha: number): void {
    const dx = end.x - start.x, dy = end.y - start.y, distance = Math.hypot(dx, dy);
    if (distance < 0.01) return;
    const count = Math.max(3, Math.ceil(distance / 15));
    const points: Vec[] = [];
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const zig = i === 0 || i === count ? 0 : Math.sin(i * 17.3 + Math.floor(time * 24) * 9.1) * Math.min(12, distance * 0.2);
      points.push({ x: start.x + dx * t - dy / distance * zig, y: start.y + dy * t + dx / distance * zig });
    }
    for (const [scale, color, opacity] of [[4, 0xffbb22, 0.12], [1.8, 0xe8a924, 0.8], [1, 0xffe467, 1], [0.35, 0xffffff, 1]]) {
      g.lineStyle(width * scale, color, alpha * opacity).strokePoints(points, false);
    }
  }
  private spark(x: number, y: number, phase: number, color: number, radius: number, alpha: number): void {
    for (let i = 0; i < 9; i++) { const angle = i * TAU / 9 + phase * 0.35; const r = radius * (0.65 + Math.sin(i * 17 + phase) * 0.35);
      this.effects.lineStyle(i % 2 ? 2 : 3, color, alpha).lineBetween(x + Math.cos(angle) * r * 0.45, y + Math.sin(angle) * r * 0.45, x + Math.cos(angle) * r, y + Math.sin(angle) * r);
    }
  }
  private drawEffect(e: Effect): void {
    const g = this.effects; const progress = 1 - clamp(e.life / e.maxLife, 0, 1); const alpha = 1 - progress;
    const color = elementColor(e.species); const x = e.pos.x; const y = e.pos.y;
    if (e.kind === 'dust' || e.kind === 'steam' || e.kind === 'trail') {
      for (let i = 0; i < 4; i++) { const a = i * 2.4 + e.id; const r = 4 + progress * 13;
        g.fillStyle(e.kind === 'steam' ? 0xe1eff3 : 0xc3b9a2, alpha * 0.24).fillCircle(x + Math.cos(a) * progress * 14, y - progress * 15 + Math.sin(a) * progress * 5, r * (0.7 + i * 0.13));
      }
    } else if (e.kind === 'debris') {
      for (let i = 0; i < 9; i++) { const a = e.angle + i * 2.4; const distance = progress * (28 + (i % 3) * 17);
        const px = x + Math.cos(a) * distance; const py = y + Math.sin(a) * distance * 0.65 - Math.sin(progress * Math.PI) * (20 + i * 2);
        g.fillStyle(i % 2 ? 0xa59070 : 0x788591, alpha).fillTriangle(px - 4, py - 4, px + 6, py - 1, px - 1, py + 5);
        g.lineStyle(1, 0x26313a, alpha).lineBetween(px - 4, py - 4, px + 6, py - 1);
      }
    } else if (e.kind === 'melee') {
      for (let slash = 0; slash < 2; slash++) { const radius = 17 + progress * 33 + slash * 7;
        g.lineStyle(5 - slash * 2, slash ? color : 0xfff7dc, alpha).beginPath(); g.arc(x, y - 23, radius, e.angle - 0.85 + progress * 0.3, e.angle + 0.75, false); g.strokePath();
      }
    } else if (e.kind === 'hit' || e.kind === 'burst') {
      const radius = (e.kind === 'burst' ? 56 : 30) * (0.4 + progress);
      g.fillStyle(color, alpha * 0.2).fillCircle(x, y - 22, radius * 0.6); this.spark(x, y - 22, e.id + progress, alpha > 0.7 ? 0xffffff : color, radius, alpha);
      if (e.kind === 'burst') g.lineStyle(3, color, alpha).strokeCircle(x, y - 10, radius);
    } else if (e.kind === 'dodge' || e.kind === 'shockwave') {
      g.lineStyle(e.kind === 'shockwave' ? 3 : 2, 0xe0e6db, alpha * 0.7).strokeEllipse(x, y, 25 + progress * 65, 10 + progress * 23);
    } else if (e.kind === 'splash') {
      g.lineStyle(2, 0x91dfff, alpha * 0.8).strokeEllipse(x, y, 16 + progress * 38, 7 + progress * 16);
      for (let i = 0; i < 7; i++) { const a = i * TAU / 7; const r = progress * 22;
        g.fillStyle(0xc4f4ff, alpha).fillRect(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.5 - Math.sin(progress * Math.PI) * 15, 3, 4);
      }
    } else if (e.kind === 'charge') g.lineStyle(2, color, alpha * 0.6).strokeEllipse(x, y - 10, 18 + progress * 35, 12 + progress * 13);
    else if (e.kind === 'scorch') this.ground.fillStyle(0x17181d, alpha * 0.3).fillEllipse(x, y, 22 + progress * 15, 12);
  }
  destroy(): void {
    this.floorImage.destroy();
    [this.floor, this.ground, this.zones, this.attacks, this.effects].forEach(graphics => graphics.destroy()); this.props.forEach(graphics => graphics.destroy());
    this.views.forEach(view => { view.sprite.destroy(); view.shadow.destroy(); view.bars.destroy(); view.label.destroy(); view.ghosts.forEach(ghost => ghost.destroy()); });
    this.scene.cameras.main.setScroll(0, 0);
  }
}
