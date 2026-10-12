import Phaser from 'phaser';
import './style.css';
import { createBattle, stepBattle } from './game/battle';
import { aiCommand } from './game/ai';
import { WORLD, type BattleState, type Command, type Species } from './game/types';
import { ArenaRenderer, preloadArena } from './render/ArenaRenderer';
import { createUI } from './ui/interface';
import { InputController } from './ui/input';
import { createDemoScene, demoCommands, DEMO_SEGMENTS } from './game/demo';

const root = document.querySelector<HTMLElement>('#app')!;
let selected: Species = 'charmander';
let selectedOpponent: Species | undefined;
let state = createBattle(selected, 42);
let started = false;
let paused = true;
let accumulator = 0;
let input: InputController;
let renderer: ArenaRenderer | null = null;
let demoMode = false;
let demoIndex = 0;
let demoElapsed = 0;
const fixedDt = 1 / 60;

function begin(species: Species, opponent?: Species) {
  demoMode = false;
  selected = species;
  selectedOpponent = opponent;
  state = createBattle(species, 42, opponent);
  started = true;
  paused = false;
  accumulator = 0;
  input?.reset();
  ui.update(state, paused);
  document.querySelector<HTMLElement>('#game-mount')?.focus({ preventScroll: true });
}

function startDemo() {
  begin('charmander');
  demoMode = true;
  demoIndex = 0;
  demoElapsed = 0;
  state = createDemoScene(0);
}

function updateDemoLabel() {
  const shell = root.querySelector<HTMLElement>('[data-game-shell]');
  const active = demoMode && shell?.dataset.started === 'true';
  if (shell) shell.dataset.demo = String(active);
  const label = root.querySelector<HTMLElement>('[data-demo-label]');
  if (label) {
    label.hidden = !active;
    const segment = DEMO_SEGMENTS[demoIndex];
    const text = `${segment.title} · 원본 ${segment.reference}`;
    if (label.textContent !== text) label.textContent = text;
  }
}

function togglePause() {
  if (!started || state.winner !== null || root.querySelector<HTMLElement>('[data-game-shell]')?.dataset.started !== 'true') return;
  paused = !paused;
  accumulator = 0;
  input.reset();
  ui.update(state, paused);
}

const ui = createUI(root, {
  onSelect: begin,
  onRestart: () => demoMode ? startDemo() : begin(selected, selectedOpponent),
  onPause: togglePause,
  onDemo: startDemo,
});
input = new InputController(root);
ui.update(state, paused);

class ArenaScene extends Phaser.Scene {
  private arena!: ArenaRenderer;
  preload() { preloadArena(this); }
  create() {
    this.arena = new ArenaRenderer(this);
    renderer = this.arena;
    this.events.once('shutdown', () => this.arena.destroy());
  }
  update(_time: number, delta: number) {
    if (started && !paused && (state.winner === null || demoMode)) {
      accumulator += Math.min(delta / 1000, 0.1);
      while (accumulator >= fixedDt) {
        if (demoMode) {
          demoElapsed += fixedDt;
          if (demoElapsed >= DEMO_SEGMENTS[demoIndex].duration) {
            demoIndex = (demoIndex + 1) % DEMO_SEGMENTS.length;
            demoElapsed = 0;
            state = createDemoScene(demoIndex);
          }
          stepBattle(state, demoCommands(state, demoIndex, demoElapsed), fixedDt);
        } else {
          const command = input.sample(state.fighters[0].pos);
          if (!command.aim) {
            const [player, target] = state.fighters;
            command.aim = { x: target.pos.x - player.pos.x, y: target.pos.y - player.pos.y };
          }
          stepBattle(state, [command, aiCommand(state, 1, fixedDt)], fixedDt);
        }
        accumulator -= fixedDt;
      }
    } else accumulator = 0;
    this.arena.render(state);
    ui.update(state, paused);
    updateDemoLabel();
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-mount',
  width: WORLD.width,
  height: WORLD.height,
  backgroundColor: '#10131e',
  pixelArt: true,
  antialias: false,
  roundPixels: true,
  audio: { noAudio: true },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: ArenaScene,
  banner: false,
});

window.addEventListener('keydown', (event) => {
  if ((event.code === 'Escape' || event.code === 'KeyP') && !event.repeat) {
    event.preventDefault();
    togglePause();
  }
});
function pauseOnLeave() {
  input.reset();
  if (started && !paused && state.winner === null) togglePause();
}
window.addEventListener('blur', pauseOnLeave);
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseOnLeave(); });

// Explicit development-only observability for repeatable browser acceptance tests.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __arena: {
      getState: (): BattleState => structuredClone(state),
      start: begin,
      startDemo,
      getDemo: () => ({ active: demoMode, index: demoIndex, elapsed: demoElapsed }),
      getFrames: () => renderer?.debugFrames(),
      getPaused: () => paused,
      setPaused: (value: boolean) => { paused = value; input.reset(); },
      step: (commands: [Command, Command], dt = fixedDt) => stepBattle(state, commands, dt),
      setState: (next: BattleState) => { state = structuredClone(next); },
    },
  });
}
