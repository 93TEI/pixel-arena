import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const state = (page: Page) => page.evaluate(() => (window as any).__arena.getState());
const frames = (page: Page) => page.evaluate(() => (window as any).__arena.getFrames());
const idle = { move: { x: 0, y: 0 }, melee: false, ranged: false, dodge: false, special: false };
const paths = { shots: 'docs/screenshots-v2', records: 'docs/recordings-v2' };
mkdirSync(paths.shots, { recursive: true });
mkdirSync(paths.records, { recursive: true });

function captureErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => Boolean((window as any).__arena?.getFrames()));
}
async function advance(page: Page, seconds: number, a = idle as any, b = idle as any) {
  await page.evaluate(({ seconds, a, b }) => {
    for (let n = 0; n < Math.round(seconds * 60); n++) (window as any).__arena.step([a, b], 1 / 60);
  }, { seconds, a, b });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function prepared(page: Page, species = 'charmander') {
  await page.evaluate((species) => {
    const api = (window as any).__arena;
    api.start(species); api.setPaused(true);
    const next = api.getState(); next.obstacles = [];
    next.fighters[0].pos = { x: 305, y: 312 }; next.fighters[1].pos = { x: 655, y: 312 };
    next.fighters[0].facing = { x: 1, y: 0 }; next.fighters[1].facing = { x: -1, y: 0 };
    api.setState(next);
  }, species);
  // Hide pause overlay only for deterministic rendering captures; game stays paused.
  await page.addStyleTag({ content: '[data-paused="true"] [data-status-overlay] { opacity: 0; pointer-events: none; }' });
}

// Real events drive the normal game loop. The deterministic test below covers exact combat boundaries.
test('desktop real controls: direction, charge-channel-release, mouse aim, special, dodge, pause and reset', async ({ page }) => {
  const errors = captureErrors(page); await open(page);
  await page.screenshot({ path: `${paths.shots}/selection.png`, fullPage: true });
  await page.locator('[data-species="charmander"]').click();
  const x = (await state(page)).fighters[0].pos.x;
  await page.keyboard.down('a');
  await expect.poll(async () => (await state(page)).fighters[0].pos.x).toBeLessThan(x - 20);
  await page.keyboard.up('a');
  await page.keyboard.down('k');
  await expect.poll(async () => (await state(page)).fighters[0].phase, { intervals: [20] }).toBe('windup');
  await expect.poll(async () => (await state(page)).beams.some((b: any) => b.owner === 0)).toBe(true);
  expect((await state(page)).fighters[0].energy).toBeLessThan(100);
  await page.screenshot({ path: `${paths.shots}/desktop-channel.png`, fullPage: true });
  await page.keyboard.up('k');
  await expect.poll(async () => (await state(page)).fighters[0].phase, { intervals: [20] }).toBe('recovery');
  await expect.poll(async () => (await state(page)).fighters[0].phase).toBe('idle');
  const canvas = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width * .45, canvas.y + canvas.height * .15);
  await page.mouse.down();
  await expect.poll(async () => (await state(page)).beams.some((b: any) => b.owner === 0)).toBe(true);
  expect((await state(page)).fighters[0].facing.y).toBeLessThan(-.4);
  await page.mouse.up(); await page.mouse.move(2, 2);
  await expect.poll(async () => (await state(page)).fighters[0].phase).toBe('idle');
  await page.keyboard.down('l');
  await expect.poll(async () => (await state(page)).hazards.some((h: any) => h.owner === 0)).toBe(true);
  await page.keyboard.up('l');
  expect((await state(page)).fighters[0].specialCooldown).toBeGreaterThan(0);
  await expect.poll(async () => (await state(page)).fighters[0].phase).toBe('idle');
  await page.keyboard.down('Space');
  await expect.poll(async () => (await state(page)).fighters[0].dodgeCooldown).toBeGreaterThan(0);
  await page.keyboard.up('Space');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-status-title]')).toHaveText('잠시 쉬어가기');
  const before = (await state(page)).time; await page.waitForTimeout(150); expect((await state(page)).time).toBe(before);
  await page.locator('[data-resume]').click();
  await expect(page.locator('[data-status-overlay]')).toBeHidden();
  await page.locator('[data-pause]').click(); await page.locator('[data-reselect]').click();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as any).__arena.getPaused())).toBe(true);
  await page.locator('[data-species="squirtle"]').click();
  expect((await state(page)).fighters[0].species).toBe('squirtle');
  await page.keyboard.down('l');
  await expect.poll(async () => (await state(page)).hazards.some((h: any) => h.owner === 0 && h.species === 'squirtle')).toBe(true);
  await page.keyboard.up('l');
  expect(errors).toEqual([]);
});

test('deterministic rendered combat: real clash, area telegraph/damage/expiry, knockback crate destruction and victory', async ({ page }) => {
  const errors = captureErrors(page); await open(page); await page.locator('[data-species="charmander"]').click();
  await prepared(page);
  const hold = { ...idle, ranged: true };
  await advance(page, 1.2, hold, hold);
  let current = await state(page);
  expect(current.beams).toHaveLength(2); expect(current.clash).not.toBeNull();
  expect(current.beams[0].end).toEqual(current.beams[1].end);
  expect(current.beams.every((b: any) => b.blocked)).toBe(true);
  expect(current.fighters.map((f: any) => f.hp)).toEqual([100, 100]);
  expect(current.effects.some((e: any) => e.kind === 'steam')).toBe(true);
  await page.screenshot({ path: `${paths.shots}/beam-clash.png`, fullPage: true });
  await advance(page, .4, hold, idle);
  current = await state(page); expect(current.clash).toBeNull(); expect(current.fighters[1].hp).toBeLessThan(100);

  for (const species of ['charmander', 'squirtle']) {
    await prepared(page, species);
    await page.evaluate(() => { const api = (window as any).__arena, next = api.getState(); next.fighters[1].pos.x = 475; api.setState(next); });
    await advance(page, .5, { ...idle, special: true });
    current = await state(page); expect(current.hazards).toHaveLength(1); expect(current.hazards[0].warmup).toBeGreaterThan(0); expect(current.fighters[1].hp).toBe(100);
    await page.screenshot({ path: `${paths.shots}/${species}-telegraph.png` });
    await advance(page, .9);
    current = await state(page); expect(current.hazards[0].warmup).toBe(0); expect(current.fighters[1].hp).toBeLessThan(100);
    await page.screenshot({ path: `${paths.shots}/${species}-special.png` });
    await advance(page, 2.1); expect((await state(page)).hazards).toHaveLength(0);
  }
  await prepared(page);
  await page.evaluate(() => {
    const api = (window as any).__arena, next = api.getState();
    next.obstacles = [{ id: 9900, kind: 'crate', pos: { x: 365, y: 312 }, radius: 22, hp: 28, maxHp: 28 }];
    next.fighters[0].velocity.x = 450; next.fighters[0].knockdownTime = .5; api.setState(next);
  });
  await advance(page, .2);
  current = await state(page); expect(current.obstacles).toHaveLength(0); expect(current.groundMarks.length).toBeGreaterThan(0); expect(current.effects.some((e: any) => e.kind === 'debris')).toBe(true);
  await page.screenshot({ path: `${paths.shots}/knockback-destruction.png` });
  await prepared(page);
  await page.evaluate(() => { const api = (window as any).__arena, next = api.getState(); next.fighters[1].pos = { x: 350, y: 312 }; next.fighters[1].hp = 1; api.setState(next); });
  await advance(page, .2, { ...idle, melee: true });
  expect((await state(page)).winner).toBe(0);
  await page.evaluate(() => (window as any).__arena.setPaused(false));
  await expect(page.locator('[data-status-title]')).toHaveText('승리했습니다!');
  await page.locator('[data-restart]').click();
  current = await state(page); expect(current.winner).toBeNull(); expect(current.hazards).toHaveLength(0); expect(current.obstacles).toHaveLength(6);
  expect(errors).toEqual([]);
});

test('PMD renderer changes real frames and uses eight movement directions', async ({ page }) => {
  await open(page); await page.locator('[data-species="charmander"]').click();
  const observations: unknown[] = [];
  for (const species of ['charmander', 'squirtle', 'pikachu']) {
    await prepared(page, species);
    const sampleFrames = new Set<string>();
    const rows = new Set<number>();
    let animatedWithinDirection = false;
    for (let dir = 0; dir < 8; dir++) {
      const angle = dir * Math.PI / 4;
      const direction = { x: Math.cos(angle), y: Math.sin(angle) };
      await advance(page, .1, { ...idle, move: direction, aim: direction });
      const a = await frames(page); observations.push({ species, direction, frames: a }); sampleFrames.add(JSON.stringify(a[0]));
      await advance(page, .1, { ...idle, move: direction, aim: direction });
      const b = await frames(page); observations.push({ species, direction, frames: b }); sampleFrames.add(JSON.stringify(b[0]));
      expect(a[0].animation).toBe('Walk');
      expect(b[0].animation).toBe('Walk');
      rows.add(a[0].direction);
      animatedWithinDirection ||= a[0].direction === b[0].direction && a[0].frame !== b[0].frame;
    }
    expect(sampleFrames.size).toBeGreaterThanOrEqual(8);
    expect(rows.size).toBe(8);
    expect(animatedWithinDirection).toBe(true);
  }
  writeFileSync(`${paths.records}/animation-frames.json`, JSON.stringify(observations, null, 2));
});

test('mobile landscape: four actions and simultaneous touch movement/channel', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, recordVideo: { dir: 'test-results/browser/mobile-v2' } });
  const page = await context.newPage(); const errors = captureErrors(page); await open(page);
  await page.locator('[data-species="squirtle"]').tap();
  await expect(page.locator('.touch-actions button')).toHaveCount(4);
  const joystick = (await page.locator('[data-joystick]').boundingBox())!;
  const button = (await page.locator('[data-action="ranged"]').boundingBox())!;
  const before = (await state(page)).fighters[0].pos.x;
  const cdp = await context.newCDPSession(page);
  const points = [{ id: 1, x: joystick.x + joystick.width * .2, y: joystick.y + joystick.height * .5 }, { id: 2, x: button.x + button.width * .5, y: button.y + button.height * .5 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
  await expect.poll(async () => { const current = await state(page); return current.fighters[0].pos.x < before - 20 && current.beams.some((b: any) => b.owner === 0); }).toBe(true);
  await page.screenshot({ path: `${paths.shots}/mobile-landscape.png` });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('[data-action="ranged"]')).not.toHaveClass(/is-held/);
  await expect.poll(async () => (await state(page)).fighters[0].phase).toBe('idle');
  const special = (await page.locator('[data-action="special"]').boundingBox())!;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 3, x: special.x + special.width / 2, y: special.y + special.height / 2 }] });
  await page.waitForTimeout(120);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => (await state(page)).hazards.some((h: any) => h.owner === 0)).toBe(true);
  const bounds = (await page.locator('.arena-frame').boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(391);
  expect(errors).toEqual([]);
  await context.close(); await page.video()!.saveAs(`${paths.records}/mobile-controls.webm`);
});

test('full 26-second motion demo: four segments, real clash, hazards and destruction', async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ viewport: { width: 1000, height: 850 }, recordVideo: { dir: 'test-results/browser/demo-v2', size: { width: 1000, height: 850 } } });
  const page = await context.newPage(), errors = captureErrors(page); await open(page); await page.getByRole('button', { name: '영상 동작 보기' }).click();
  const seen = new Set<number>(), captured = new Set<number>(), samples: any[] = [];
  let clash = false, hazard = false, destroyed = false, changedFrames = new Set<string>();
  const start = Date.now(); let completedCycle = false;
  while (Date.now() - start < 70_000) {
    const sample = await page.evaluate(() => { const api = (window as any).__arena; return { demo: api.getDemo(), state: api.getState(), frames: api.getFrames() }; });
    seen.add(sample.demo.index); samples.push({ demo: sample.demo, frames: sample.frames, hp: sample.state.fighters.map((f: any) => f.hp), obstacles: sample.state.obstacles.length, hazards: sample.state.hazards.length, clash: sample.state.clash });
    changedFrames.add(JSON.stringify(sample.frames)); clash ||= sample.state.clash !== null; hazard ||= sample.state.hazards.length > 0;
    if (seen.has(3) && sample.demo.index === 0 && sample.demo.elapsed > .5) completedCycle = true;
    if (sample.demo.index === 3 && sample.state.obstacles.length < 3) destroyed = true;
    if (!captured.has(sample.demo.index) && ((sample.demo.index === 0 && sample.demo.elapsed > 3) || (sample.demo.index === 1 && sample.state.clash) || (sample.demo.index === 2 && sample.state.hazards.some((h: any) => h.warmup <= 0)) || (sample.demo.index === 3 && sample.state.obstacles.length < 3))) {
      await page.screenshot({ path: `${paths.shots}/demo-${sample.demo.index + 1}.png` }); captured.add(sample.demo.index);
    }
    if (completedCycle) break;
    await page.waitForTimeout(150);
  }
  expect(completedCycle).toBe(true); expect([...seen].sort()).toEqual([0, 1, 2, 3]); expect(clash).toBe(true); expect(hazard).toBe(true); expect(destroyed).toBe(true); expect(changedFrames.size).toBeGreaterThan(20); expect(errors).toEqual([]);
  writeFileSync(`${paths.records}/demo-observations.json`, JSON.stringify(samples, null, 2));
  await context.close(); await page.video()!.saveAs(`${paths.records}/motion-demo-26s.webm`);
});

test('Pikachu selection, lightning skills, paralysis, CPU selection and restart', async ({ page }) => {
  const errors = captureErrors(page);
  await open(page);
  await expect(page.locator('[data-species]')).toHaveCount(3);
  await page.locator('[data-opponent]').selectOption('charmander');
  await page.locator('[data-species="pikachu"]').click();
  await expect(page.locator('[data-player-name]')).toHaveText('피카츄');
  await expect(page.locator('[data-enemy-name]')).toHaveText('파이리');
  await expect(page.locator('[data-melee-label]')).toHaveText('전광석화');
  await expect(page.locator('[data-stream-label]')).toHaveText('10만볼트');
  await expect(page.locator('[data-special-label]')).toHaveText('번개');
  await page.keyboard.down('k');
  await expect.poll(async () => (await state(page)).beams.some((b: any) => b.owner === 0 && b.species === 'pikachu')).toBe(true);
  expect((await frames(page))[0].placeholder).toBe(false);
  await page.screenshot({ path: `${paths.shots}/pikachu-thunderbolt.png` });
  await page.keyboard.up('k');
  await prepared(page, 'pikachu');
  await page.evaluate(() => { const api = (window as any).__arena, next = api.getState(); next.fighters[1].pos.x = 475; api.setState(next); });
  await advance(page, .6, { ...idle, special: true });
  let current = await state(page);
  expect(current.hazards[0].species).toBe('pikachu');
  expect(current.hazards[0].warmup).toBeGreaterThan(0);
  expect(current.fighters[1].hp).toBe(100);
  await advance(page, .45);
  current = await state(page);
  expect(current.fighters[1].hp).toBeLessThan(100);
  expect(current.fighters[1].paralysisTime).toBeGreaterThan(0);
  await page.screenshot({ path: `${paths.shots}/pikachu-thunder.png` });
  await advance(page, 1.3);
  expect((await state(page)).fighters[1].paralysisTime).toBe(0);
  await page.addStyleTag({ content: '[data-paused="true"] [data-status-overlay] { opacity: 1; pointer-events: auto; }' });
  await page.evaluate(() => (window as any).__arena.setPaused(false));
  await page.keyboard.press('Escape');
  await page.locator('[data-reselect]').click();
  await page.locator('[data-opponent]').selectOption('pikachu');
  await page.locator('[data-species="squirtle"]').click();
  await expect(page.locator('[data-enemy-name]')).toHaveText('피카츄');
  await page.evaluate(() => { const api = (window as any).__arena, next = api.getState(); next.winner = 0; next.fighters[1].hp = 0; api.setState(next); });
  await page.locator('[data-restart]').click();
  current = await state(page);
  expect(current.fighters.map((f: any) => f.species)).toEqual(['squirtle', 'pikachu']);
  expect(current.fighters[1].hp).toBe(100);
  expect(errors).toEqual([]);
});

test('image-free checkout stays playable and mobile roster fits', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/assets/**/*.png', route => route.fulfill({ status: 404, body: '' }));
  await open(page);
  for (const species of ['charmander', 'squirtle', 'pikachu']) {
    const card = page.locator(`[data-species="${species}"]`);
    await expect(card).toBeVisible();
    await expect(card.locator('.fighter-thumbnail')).toBeHidden();
    await expect(card.locator('.fighter-fallback')).toBeVisible();
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(845);
    expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(391);
  }
  const opponentBox = (await page.locator('[data-opponent]').boundingBox())!;
  expect(opponentBox.y + opponentBox.height).toBeLessThanOrEqual(391);
  await page.screenshot({ path: `${paths.shots}/image-free-mobile-selection.png` });
  await page.locator('[data-species="pikachu"]').tap();
  await expect(page.locator('[data-action="special"]')).toHaveText('번개');
  await expect(page.locator('[data-action="melee"]')).toHaveText('전광석화');
  await expect.poll(async () => (await frames(page))[0].placeholder).toBe(true);
  const cdp = await context.newCDPSession(page);
  const box = (await page.locator('[data-action="ranged"]').boundingBox())!;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await expect.poll(async () => (await state(page)).beams.some((b: any) => b.species === 'pikachu')).toBe(true);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(errors).toEqual([]);
  await context.close();
});
