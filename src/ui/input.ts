import { emptyCommand, WORLD, type Command, type Vec } from '../game/types';

const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
const actionKeys: Record<string, 'melee' | 'ranged' | 'special' | 'dodge'> = { KeyJ: 'melee', KeyK: 'ranged', KeyL: 'special', Space: 'dodge' };

/** One command format for keyboard and simultaneous touch input. */
export class InputController {
  private keys = new Set<string>();
  private pointers = new Map<number, string>();
  // Preserve discrete taps that begin and end between fixed simulation steps.
  private pressed = new Set<string>();
  private stick = { x: 0, y: 0 };
  private stickPointer: number | null = null;
  private pointerAim: Vec | null = null;
  private abort = new AbortController();

  constructor(private element: HTMLElement) {
    const signal = this.abort.signal;
    window.addEventListener('keydown', this.keyDown, { signal });
    window.addEventListener('keyup', this.keyUp, { signal });
    window.addEventListener('blur', this.reset, { signal });
    document.addEventListener('visibilitychange', this.visibility, { signal });
    element.addEventListener('pointerdown', this.pointerDown, { signal });
    element.addEventListener('pointermove', this.pointerMove, { signal });
    element.addEventListener('pointerout', (event) => {
      if (event.pointerType === 'mouse' && event.target instanceof HTMLCanvasElement) this.pointerAim = null;
    }, { signal });
    element.addEventListener('pointerup', this.pointerEnd, { signal });
    element.addEventListener('pointercancel', this.pointerEnd, { signal });
    element.addEventListener('lostpointercapture', this.pointerEnd, { signal });
    element.addEventListener('contextmenu', (event) => {
      if ((event.target as HTMLElement).closest('[data-action], [data-joystick]')) event.preventDefault();
    }, { signal });
  }

  private enabled(): boolean {
    const shell = this.element.matches('[data-game-shell]') ? this.element : this.element.querySelector<HTMLElement>('[data-game-shell]');
    return !shell || (shell.dataset.started === 'true' && shell.dataset.paused !== 'true' && shell.dataset.finished !== 'true');
  }

  private keyDown = (event: KeyboardEvent): void => {
    if (!this.enabled() || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
    if (movementKeys.has(event.code) || actionKeys[event.code]) {
      event.preventDefault();
      this.keys.add(event.code);
      const action = actionKeys[event.code];
      if (!event.repeat && action) this.pressed.add(action);
    }
  };

  private keyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code); };
  private visibility = (): void => { if (document.hidden) this.reset(); };

  private pointerDown = (event: PointerEvent): void => {
    if (!this.enabled()) return;
    if (event.pointerType === 'mouse' && event.button === 0 && event.target instanceof HTMLCanvasElement) {
      event.preventDefault();
      this.updatePointerAim(event);
      this.pointers.set(event.pointerId, 'ranged');
      this.pressed.add('ranged');
      event.target.setPointerCapture(event.pointerId);
      return;
    }
    const control = (event.target as HTMLElement).closest<HTMLElement>('[data-action], [data-joystick]');
    if (!control) return;
    if (event.pointerType !== 'mouse') this.pointerAim = null;
    event.preventDefault();
    if (control.hasAttribute('data-joystick')) {
      if (this.stickPointer !== null) return;
      this.stickPointer = event.pointerId;
      this.pointers.set(event.pointerId, 'stick');
      this.updateStick(event, control);
    } else {
      this.pointers.set(event.pointerId, control.dataset.action!);
      this.pressed.add(control.dataset.action!);
      control.classList.add('is-held');
    }
    control.setPointerCapture(event.pointerId);
  };

  private pointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.target instanceof HTMLCanvasElement && this.enabled()) this.updatePointerAim(event);
    if (event.pointerId !== this.stickPointer) return;
    const stick = this.element.querySelector<HTMLElement>('[data-joystick]');
    if (stick) { event.preventDefault(); this.updateStick(event, stick); }
  };

  private updatePointerAim(event: PointerEvent): void {
    const canvas = this.element.querySelector('canvas');
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    this.pointerAim = x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x: x * WORLD.width, y: y * WORLD.height } : null;
  }

  private updateStick(event: PointerEvent, control: HTMLElement): void {
    const box = control.getBoundingClientRect();
    const radius = box.width * 0.34;
    let x = (event.clientX - box.left - box.width / 2) / radius;
    let y = (event.clientY - box.top - box.height / 2) / radius;
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    if (length < 0.12) { x = 0; y = 0; }
    this.stick = { x, y };
    control.style.setProperty('--stick-x', `${x * radius}px`);
    control.style.setProperty('--stick-y', `${y * radius}px`);
  }

  private pointerEnd = (event: PointerEvent): void => {
    const action = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    if (event.pointerId === this.stickPointer) {
      this.stickPointer = null;
      this.stick = { x: 0, y: 0 };
      const control = this.element.querySelector<HTMLElement>('[data-joystick]');
      control?.style.setProperty('--stick-x', '0px');
      control?.style.setProperty('--stick-y', '0px');
    }
    if (action && ![...this.pointers.values()].includes(action)) {
      this.element.querySelector(`[data-action="${action}"]`)?.classList.remove('is-held');
    }
  };

  sample(origin?: Vec): Command {
    if (!this.enabled()) { this.reset(); return emptyCommand(); }
    const command = emptyCommand();
    const down = (...codes: string[]) => codes.some((code) => this.keys.has(code));
    command.move.x = Number(down('KeyD', 'ArrowRight')) - Number(down('KeyA', 'ArrowLeft')) + this.stick.x;
    command.move.y = Number(down('KeyS', 'ArrowDown')) - Number(down('KeyW', 'ArrowUp')) + this.stick.y;
    const length = Math.hypot(command.move.x, command.move.y);
    if (length > 1) { command.move.x /= length; command.move.y /= length; }
    const touches = new Set(this.pointers.values());
    command.melee = down('KeyJ') || touches.has('melee') || this.pressed.has('melee');
    command.rangedHeld = down('KeyK') || touches.has('ranged');
    command.ranged = command.rangedHeld || this.pressed.has('ranged');
    command.dodge = down('Space') || touches.has('dodge') || this.pressed.has('dodge');
    command.special = down('KeyL') || touches.has('special') || this.pressed.has('special');
    this.pressed.clear();
    if (this.pointerAim && origin) {
      const x = this.pointerAim.x - origin.x;
      const y = this.pointerAim.y - origin.y;
      const distance = Math.hypot(x, y);
      if (distance > 1) command.aim = { x: x / distance, y: y / distance };
    }
    return command;
  }

  reset = (): void => {
    this.keys.clear();
    this.pointers.clear();
    this.pressed.clear();
    this.stickPointer = null;
    this.pointerAim = null;
    this.stick = { x: 0, y: 0 };
    this.element.querySelectorAll('.is-held').forEach((item) => item.classList.remove('is-held'));
    const stick = this.element.querySelector<HTMLElement>('[data-joystick]');
    stick?.style.setProperty('--stick-x', '0px');
    stick?.style.setProperty('--stick-y', '0px');
  };

  destroy(): void { this.reset(); this.abort.abort(); }
}
