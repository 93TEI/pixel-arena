import Phaser from 'phaser';
import { ArenaRenderer, preloadArena } from './render/ArenaRenderer';
import { createBattle, stepBattle } from './game/battle';
import { emptyCommand, type BattleState, type Species } from './game/types';
import { BULBASAUR as B } from './game/grassMoves';
import './vfx-review.css';

const names: Record<Species, string> = { charmander: '파이리', squirtle: '꼬부기', bulbasaur: '이상해씨', ivysaur: '이상해풀', venusaur: '이상해꽃', pikachu: '피카츄', mewtwo: '뮤츠' };
const moves: Record<Species, string[]> = { venusaur: ['꽃보라', '씨폭탄', '하드플랜트'], charmander: ['할퀴기', '화염방사', '불꽃 회오리'], squirtle: ['몸통박치기', '물대포', '물 소용돌이'], bulbasaur: ['덩굴채찍', '잎날가르기', '씨뿌리기'], ivysaur: ['덩굴채찍', '왕복 잎날가르기', '솔라빔'], pikachu: ['전광석화', '10만볼트', '번개'], mewtwo: ['염동력', '사이코키네시스', '사이코브레이크'] };
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const species = $<HTMLSelectElement>('species'), move = $<HTMLSelectElement>('move'), variant = $<HTMLSelectElement>('variant'), direction = $<HTMLSelectElement>('direction');
const slider = $<HTMLInputElement>('time');
for (const [id, name] of Object.entries(names)) species.add(new Option(name, id));
['오른쪽', '오른쪽 아래', '아래', '왼쪽 아래', '왼쪽', '왼쪽 위', '위', '오른쪽 위'].forEach((name, i) => direction.add(new Option(name, String(i))));
let frames: BattleState[] = [], tick = 0, playing = true, renderer: ArenaRenderer, elapsed = 0;
function prepare() {
  const id = species.value as Species, mode = move.value, advanced = variant.value === 'mastery';
  const s = createBattle(id, 42, id === 'squirtle' ? 'charmander' : 'squirtle'); s.obstacles = [];
  const a = Number(direction.value) * Math.PI / 4, aim = { x: Math.cos(a), y: Math.sin(a) }, origin = { x: 480, y: 320 };
  const distance = id === 'venusaur' ? mode === 'melee' ? 65 : mode === 'special' ? advanced ? 310 : 200 : advanced ? 230 : 270 : mode === 'melee' ? id === 'ivysaur' && advanced ? 120 : 65 : mode === 'special' && !['bulbasaur', 'ivysaur'].includes(id) ? 170 : 240;
  s.fighters[0].pos = { ...origin }; s.fighters[0].facing = aim;
  s.fighters[1].pos = { x: origin.x + aim.x * distance, y: origin.y + aim.y * distance };
  if (variant.value === 'miss') s.fighters[1].pos = { x: 150, y: 450 };
  if (variant.value === 'blocked') s.obstacles.push({ id: 500, kind: 'rock', pos: { x: origin.x + aim.x * 115, y: origin.y + aim.y * 115 }, radius: 26, hp: 1000, maxHp: 1000 });
  if (advanced && id === 'bulbasaur' && mode !== 'special') s.leechSeeds.push({ owner: 0, target: 1, life: B.seed.duration, timer: B.seed.interval, ticksLeft: 3 });
  frames = [structuredClone(s)];
  for (let n = 0; n < 300; n++) {
    const cmd = emptyCommand(); cmd.aim = aim;
    cmd.melee = mode === 'melee' && n === 0; cmd.special = mode === 'special' && n === 0;
    cmd.ranged = mode === 'ranged' && n < (id === 'bulbasaur' ? advanced ? 46 : 2 : ['ivysaur', 'venusaur'].includes(id) ? 1 : 100);
    cmd.rangedHeld = cmd.ranged;
    if (id === 'bulbasaur' && mode === 'special' && advanced && n > 70 && n < 114) { cmd.ranged = true; cmd.rangedHeld = true; }
    if (id === 'ivysaur' && mode === 'ranged' && advanced && n > 50 && n < 85) cmd.move = { x: -aim.y, y: aim.x };
    stepBattle(s, [cmd, emptyCommand()], 1 / 60); frames.push(structuredClone(s));
  }
  tick = 0; elapsed = 0; show();
}
function choices() {
  const prev = move.value || 'special'; move.innerHTML = '';
  moves[species.value as Species].forEach((name, i) => move.add(new Option(`${['J', 'K', 'L'][i]} · ${name}`, ['melee', 'ranged', 'special'][i]))); move.value = prev; prepare();
}
function show() {
  if (!renderer || !frames.length) return;
  renderer.render(frames[tick]); slider.value = String(tick); $('clock').textContent = `${(tick / 60).toFixed(2)}초`;
  const f = frames[tick].fighters[0], debug = renderer.debugEffects();
  $('detail').textContent = `${names[f.species]} · ${f.phase} · 상대 HP ${frames[tick].fighters[1].hp.toFixed(1)} · 효과 ${debug.active}개${debug.missing.length ? ` · 누락: ${debug.missing.join(', ')}` : ''}`;
  $('frames').textContent = debug.draws.map(d => `${d.clip}  프레임 ${d.frame}  위치 ${d.x},${d.y}  깊이 ${d.depth.toFixed(0)}`).join('\n');
}
species.onchange = choices; move.onchange = prepare; variant.onchange = prepare; direction.onchange = prepare;
$('play').onclick = () => { playing = !playing; $('play').textContent = playing ? '일시정지' : '재생'; };
$('restart').onclick = prepare;
slider.oninput = () => { playing = false; $('play').textContent = '재생'; tick = Number(slider.value); show(); };
$<HTMLSelectElement>('zoom').onchange = e => { $('stage').style.width = (e.target as HTMLSelectElement).value === '1' ? '' : '1920px'; requestAnimationFrame(() => game.scale.refresh()); };
const game = new Phaser.Game({ type: Phaser.AUTO, parent: 'stage', width: 960, height: 600, pixelArt: true, antialias: false, backgroundColor: '#242a35', scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, scene: { preload() { preloadArena(this); }, create() { renderer = new ArenaRenderer(this); choices(); }, update(_time: number, delta: number) { if (playing && renderer) { elapsed += Math.min(delta, 100) / 1000; while (elapsed >= 1 / 60) { tick = (tick + 1) % 301; elapsed -= 1 / 60; } show(); } } } });
Object.assign(window, { __vfxReview: { select(id: Species, action: string, condition = 'normal', facing = 0) { species.value = id; choices(); move.value = action; variant.value = condition; direction.value = String(facing); prepare(); playing = false; $('play').textContent = '재생'; }, seek(n: number) { tick = clampTick(n); show(); }, debug: () => renderer?.debugEffects(), state: () => frames[tick] } });
function clampTick(n: number) { return Math.max(0, Math.min(300, Math.floor(n))); }
