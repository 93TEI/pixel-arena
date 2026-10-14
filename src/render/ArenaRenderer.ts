import { EffectRenderer, preloadEffects } from './EffectRenderer';
import Phaser from 'phaser';
import type { BattleState, Fighter, Obstacle, Vec } from '../game/types';
import { WORLD } from '../game/types';
import { animationData, type AnimationClip } from './animationData';

export function preloadArena(scene: Phaser.Scene): void {
  // Art is optional and local. A clean source checkout deliberately has no PNGs.
  scene.load.maxRetries = 0;
  preloadEffects(scene);
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
const directionRow = (v: Vec) => (Math.round((Math.PI / 2 - Math.atan2(v.y, v.x)) / (Math.PI / 4)) + 8) % 8;
const elementColor = (species: string) => species === 'ivysaur' ? 0xaedd72 : species === 'bulbasaur' ? 0x9cdb68 : species === 'mewtwo' ? 0xc58bff : species === 'pikachu' ? 0xffe15a : species === 'charmander' ? 0xff9a40 : 0x7bdcff;

/** Sprite frames and all effects follow simulation time, so pause freezes motion. */
export class ArenaRenderer {
  private floor: Phaser.GameObjects.Graphics;
  private floorImage: Phaser.GameObjects.Image;
  private vfx: EffectRenderer;
  private props = new Map<number, Phaser.GameObjects.Graphics>();
  private views: FighterView[] = [];
  private lastTime = -1;
  private placeholders = new Set<string>();

  constructor(private scene: Phaser.Scene) {
    this.floor = scene.add.graphics().setDepth(0);
    this.vfx = new EffectRenderer(scene);
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
  debugEffects() { return this.vfx.debug(); }
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
    this.drawObstacles(state.obstacles);
    state.fighters.forEach((fighter, id) => this.drawFighter(this.views[id], fighter, state.time, state));
    this.vfx.render(state);
    const shake = Math.min(2.6, Math.max(0, state.cameraImpact) * 4);
    this.scene.cameras.main.setScroll(Math.sin(state.time * 91) * shake, Math.cos(state.time * 113) * shake * 0.6);
  }
  private clip(species: string, name: string): { name: string; data: AnimationClip } {
    const entry = animationData[species][name]; return 'alias' in entry ? this.clip(species, entry.alias) : { name, data: entry };
  }
  private drawFighter(view: FighterView, f: Fighter, time: number, state: BattleState): void {
    let animation = 'Idle';
    if (f.hp <= 0 || f.knockdownTime > 0) animation = 'Faint';
    else if (f.hitTime > 0 || f.stunTime > 0) animation = 'Hurt';
    else if (f.action === 'dodge') animation = 'Charge';
    else if (f.action === 'melee') animation = 'Attack';
    else if (f.action === 'ranged' || f.action === 'special') animation = f.phase === 'windup' ? 'Charge' : 'Shoot';
    else if (Math.hypot(f.moveVelocity.x, f.moveVelocity.y) > 5) animation = 'Walk';
    if (view.animation !== animation || (view.phase !== f.phase && animation !== 'Faint' && animation !== 'Hurt') || time < view.animationStart) {
      view.animation = animation; view.animationStart = time;
    }
    view.phase = f.phase;
    const { name, data } = this.clip(f.species, animation);
    const progress = f.phaseDuration > 0 ? clamp(1 - f.phaseTime / f.phaseDuration, 0, 0.999) : 0;
    let column = 0;
    const inRange = (first: number, last: number, fraction: number) => Math.floor(first + clamp(fraction, 0, 0.999) * (last - first + 1));
    if (animation === 'Attack') {
      const rush = data.rushFrame ?? 2; const back = data.returnFrame ?? data.columns - 2;
      column = f.phase === 'windup' ? inRange(0, Math.max(0, rush - 1), progress) : f.phase === 'active' ? inRange(rush, Math.max(rush, back - 1), progress) : inRange(back, data.columns - 1, progress);
    // Match time freezes on defeat, so hold the final pose; knockdowns play the full clip.
    } else if (animation === 'Faint') column = f.hp <= 0 ? data.columns - 1 : Math.min(data.columns - 1, Math.floor((time - view.animationStart) / 0.075));
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
    const bars = view.bars.clear(); const x = Math.round(f.pos.x - 29); const y = Math.round(f.pos.y - (f.species === 'mewtwo' ? 85 : 65));
    bars.fillStyle(0x111b2a, 0.92).fillRect(x - 1, y - 1, 60, 10);
    bars.fillStyle(0x324b61).fillRect(x, y, 58, 7);
    bars.fillStyle(f.hp / f.maxHp < 0.25 ? 0xff8171 : 0x39c5f2).fillRect(x, y, 58 * Math.max(0, f.hp / f.maxHp), 7);
    bars.fillStyle(0xc8f5ff, 0.8).fillRect(x, y, 58 * Math.max(0, f.hp / f.maxHp), 1);
    view.label.setPosition(f.pos.x, y - 8);
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
  destroy(): void {
    this.floorImage.destroy();
    this.floor.destroy(); this.vfx.destroy(); this.props.forEach(graphics => graphics.destroy());
    this.views.forEach(view => { view.sprite.destroy(); view.shadow.destroy(); view.bars.destroy(); view.label.destroy(); view.ghosts.forEach(ghost => ghost.destroy()); });
    this.scene.cameras.main.setScroll(0, 0);
  }
}
