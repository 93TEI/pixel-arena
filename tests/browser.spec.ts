import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const state = (page: Page) => page.evaluate(() => (window as any).__arena.getState());
const frames = (page: Page) => page.evaluate(() => (window as any).__arena.getFrames());
const idle = { move: { x: 0, y: 0 }, melee: false, ranged: false, dodge: false, special: false };
const paths = { shots: 'docs/screenshots-v2', records: 'docs/recordings-v2' };
mkdirSync('docs/vfx-overhaul/verified', { recursive: true });
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
  for (const species of ['bulbasaur', 'ivysaur', 'charmander', 'squirtle', 'pikachu', 'mewtwo']) {
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
  await expect(page.locator('[data-species]')).toHaveCount(6);
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
  for (const species of ['bulbasaur', 'ivysaur', 'charmander', 'squirtle', 'pikachu', 'mewtwo']) {
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
  await prepared(page, 'mewtwo');
  expect((await frames(page))[0].placeholder).toBe(true);
  await advance(page, .5, { ...idle, ranged: true });
  expect((await state(page)).beams.some((b: any) => b.species === 'mewtwo')).toBe(true);
  await prepared(page, 'bulbasaur');
  expect((await frames(page))[0].placeholder).toBe(true);
  await advance(page, .7, { ...idle, ranged: true, rangedHeld: true });
  await advance(page, .02);
  expect((await state(page)).projectiles).toHaveLength(1);
  expect((await state(page)).projectiles[0].tier).toBe('perfect');
  expect(errors).toEqual([]);
  await context.close();
});

test('Mewtwo controls, psychic channel and telegraphed Psystrike, CPU mirror and restart', async ({ page }) => {
  const errors = captureErrors(page); await open(page);
  await page.locator('[data-opponent]').selectOption('mewtwo');
  await page.locator('[data-species="mewtwo"]').click();
  await expect(page.locator('[data-player-name]')).toHaveText('뮤츠');
  await expect(page.locator('[data-enemy-name]')).toHaveText('뮤츠');
  await expect(page.locator('[data-melee-label]')).toHaveText('염동력');
  await expect(page.locator('[data-stream-label]')).toHaveText('사이코키네시스');
  await expect(page.locator('[data-special-label]')).toHaveText('사이코브레이크');
  await page.keyboard.down('k');
  await expect.poll(async () => (await state(page)).beams.some((b: any) => b.owner === 0 && b.species === 'mewtwo')).toBe(true);
  expect((await frames(page))[0].placeholder).toBe(false);
  await page.screenshot({ path: `${paths.shots}/mewtwo-psychic.png`, fullPage: true });
  await page.keyboard.up('k');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-status-title]')).toHaveText('잠시 쉬어가기');
  await page.locator('[data-resume]').click();
  await page.evaluate(() => { const api = (window as any).__arena, s = api.getState(); s.winner = 0; s.fighters[1].hp = 0; api.setState(s); });
  await page.locator('[data-restart]').click();
  expect((await state(page)).fighters.map((f: any) => f.species)).toEqual(['mewtwo', 'mewtwo']);

  await prepared(page, 'mewtwo');
  await page.evaluate(() => { const api = (window as any).__arena, s = api.getState(); s.fighters[1].pos.x = 475; api.setState(s); });
  await advance(page, .5, { ...idle, special: true });
  expect((await state(page)).fighters[1].hp).toBe(100);
  await page.screenshot({ path: `${paths.shots}/mewtwo-telegraph.png` });
  await advance(page, .7);
  expect((await state(page)).fighters[1].hp).toBeLessThan(100);
  await page.screenshot({ path: `${paths.shots}/mewtwo-psystrike.png` });
  await advance(page, .8);
  expect((await state(page)).hazards).toHaveLength(0);
  expect((await state(page)).fighters[1].knockdownTime).toBeGreaterThan(0);
  await page.screenshot({ path: `${paths.shots}/mewtwo-impact.png` });
  expect(errors).toEqual([]);
});

test('Mewtwo mobile touch skills and six-character roster fit narrow screens', async ({ browser }) => {
  for (const viewport of [{ width: 844, height: 390 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const page = await context.newPage(), errors = captureErrors(page); await open(page);
    const stage = (await page.locator('.game-stage').boundingBox())!;
    for (const card of await page.locator('[data-species]').all()) {
      const box = (await card.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y).toBeGreaterThanOrEqual(stage.y); expect(box.y + box.height).toBeLessThanOrEqual(stage.y + stage.height);
      expect(await card.evaluate(el => ({ fits: el.scrollWidth <= el.clientWidth, name: (el as HTMLElement).dataset.species }))).toEqual({ fits: true, name: await card.getAttribute('data-species') });
    }
    const opponent = (await page.locator('[data-opponent]').boundingBox())!;
    expect(opponent.y + opponent.height).toBeLessThanOrEqual(stage.y + stage.height);
    await page.screenshot({ path: `${paths.shots}/mewtwo-roster-${viewport.width}.png`, fullPage: true });
    await page.locator('[data-species="mewtwo"]').tap();
    await expect(page.locator('[data-action="melee"]')).toHaveText('염동력');
    await expect(page.locator('[data-action="special"]')).toHaveText('사이코브레이크');
    if (viewport.width === 844) {
      const cdp = await context.newCDPSession(page);
      const button = (await page.locator('[data-action="ranged"]').boundingBox())!;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: button.x + button.width / 2, y: button.y + button.height / 2 }] });
      await expect.poll(async () => (await state(page)).beams.some((b: any) => b.owner === 0 && b.species === 'mewtwo')).toBe(true);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(async () => (await state(page)).fighters[0].phase).toBe('idle');
      await page.locator('[data-action="special"]').tap();
      await expect.poll(async () => (await state(page)).hazards.some((h: any) => h.owner === 0 && h.species === 'mewtwo')).toBe(true);
      await page.screenshot({ path: `${paths.shots}/mewtwo-touch.png`, fullPage: true });
    }
    expect(errors).toEqual([]); await context.close();
  }
});

test('brief discrete inputs survive between simulation steps and clear on reset', async ({ page }) => {
  await open(page);
  const results = await page.evaluate(async () => {
    const modulePath = '/src/ui/input.ts';
    const { InputController } = await import(/* @vite-ignore */ modulePath);
    const element = document.createElement('div');
    element.innerHTML = '<main data-game-shell data-started="true" data-paused="false"></main>';
    const input = new InputController(element);
    const press = (code: string) => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
    };
    const samples = ['KeyJ', 'KeyL', 'Space', 'KeyK'].map(code => {
      press(code); return [input.sample(), input.sample()];
    });
    press('KeyL'); input.reset(); const cleared = input.sample();
    press('KeyK'); const ranged = input.sample(); input.destroy();
    return { samples, cleared, ranged };
  });
  for (const [index, action] of ['melee', 'special', 'dodge', 'ranged'].entries()) {
    expect(results.samples[index][0][action]).toBe(true);
    expect(results.samples[index][1][action]).toBe(false);
  }
  expect(results.cleared.special).toBe(false); expect(results.ranged.ranged).toBe(true);
});

const bulbasaurDocs = 'docs/pokemon/0001-bulbasaur';
mkdirSync(bulbasaurDocs, { recursive: true });
test('Bulbasaur keyboard and mouse taps, leaves, seed, pause and mirror reset', async ({ page }) => {
  const errors = captureErrors(page); await open(page);
  await page.locator('[data-opponent]').selectOption('bulbasaur');
  await page.locator('[data-species="bulbasaur"]').click();
  await expect(page.locator('[data-melee-label]')).toHaveText('덩굴채찍');
  await expect(page.locator('[data-stream-label]')).toHaveText('잎날가르기');
  await expect(page.locator('[data-special-label]')).toHaveText('씨뿌리기');
  await page.keyboard.press('k');
  await expect.poll(async () => (await state(page)).fighters[0].rangedCooldown).toBeGreaterThan(0);
  expect((await state(page)).beams).toHaveLength(0);
  await expect.poll(async () => (await state(page)).fighters[0].rangedCooldown).toBe(0);
  const canvas = (await page.locator('canvas').boundingBox())!;
  await page.mouse.click(canvas.x + canvas.width * .6, canvas.y + canvas.height * .2);
  await expect.poll(async () => (await state(page)).fighters[0].rangedCooldown).toBeGreaterThan(0);
  await page.mouse.move(1, 1);
  await prepared(page, 'bulbasaur');
  await page.evaluate(() => { const api = (window as any).__arena, s = api.getState(); s.fighters[1].pos.x = 475; s.fighters[0].hp = 60; api.setState(s); });
  await advance(page, .7, { ...idle, ranged: true, rangedHeld: true });
  await advance(page, .02);
  expect((await state(page)).projectiles).toHaveLength(1);
  expect((await state(page)).projectiles[0].tier).toBe('perfect');
  await page.screenshot({ path: `${bulbasaurDocs}/razor-leaf.png`, fullPage: true });
  await advance(page, 1);
  await advance(page, .95, { ...idle, special: true });
  expect((await state(page)).leechSeeds).toHaveLength(1);
  await page.screenshot({ path: `${bulbasaurDocs}/leech-seed.png`, fullPage: true });
  const frozen = await state(page), frozenFrame = await frames(page);
  await page.waitForTimeout(150);
  expect(await state(page)).toEqual(frozen); expect(await frames(page)).toEqual(frozenFrame);
  await advance(page, .7); expect((await state(page)).fighters[0].hp).toBe(62);
  await advance(page, .02, idle, { ...idle, dodge: true });
  expect((await state(page)).leechSeeds).toHaveLength(1);
  await page.evaluate(() => {
    const api = (window as any).__arena; api.start('bulbasaur', 'bulbasaur'); api.setPaused(true);
    const s = api.getState(); s.fighters[1].hp = 0; s.winner = 0; api.setState(s);
  });
  await page.addStyleTag({ content: '[data-paused="true"] [data-status-overlay] { opacity: 1; pointer-events: auto; }' });
  await page.locator('[data-restart]').click();
  const reset = await state(page);
  expect(reset.fighters.map((f: any) => f.species)).toEqual(['bulbasaur', 'bulbasaur']);
  expect(reset.leechSeeds).toEqual([]); expect(reset.projectiles).toEqual([]);
  expect(errors).toEqual([]);
  await page.close(); await page.video()!.saveAs(`${bulbasaurDocs}/controls.webm`);
});

test('Bulbasaur actual eight-direction frames and action animation phases', async ({ page }) => {
  const errors = captureErrors(page); await open(page); await page.locator('[data-species="bulbasaur"]').click();
  await prepared(page, 'bulbasaur');
  const observations: any[] = [];
  for (let direction = 0; direction < 8; direction++) {
    const angle = Math.PI / 2 - direction * Math.PI / 4, move = { x: Math.cos(angle), y: Math.sin(angle) };
    await advance(page, .05, { ...idle, move }); const first = (await frames(page))[0];
    await advance(page, .09, { ...idle, move }); const second = (await frames(page))[0];
    expect(first.direction).toBe(direction); expect(second.direction).toBe(direction);
    expect(first.animation).toBe('Walk'); expect(first.frame).not.toBe(second.frame); expect(first.placeholder).toBe(false);
    observations.push(second);
  }
  await advance(page, .01, { ...idle, melee: true }); expect((await frames(page))[0].animation).toBe('Attack');
  await advance(page, .19); expect((await frames(page))[0].phase).toBe('active');
  await page.screenshot({ path: `${bulbasaurDocs}/vine-whip.png`, fullPage: true });
  await advance(page, .16); expect((await frames(page))[0].phase).toBe('recovery');
  await advance(page, .3); expect((await frames(page))[0].animation).toBe('Idle');
  await advance(page, .02, { ...idle, ranged: true }); expect((await frames(page))[0].animation).toBe('Charge');
  await advance(page, .13); expect((await frames(page))[0].animation).toBe('Shoot');
  await page.evaluate(() => {
    const api = (window as any).__arena, s = api.getState(); s.fighters[0].hitTime = .1; api.setState(s);
  });
  await advance(page, .01); expect((await frames(page))[0].animation).toBe('Hurt');
  await page.evaluate(() => {
    const api = (window as any).__arena, s = api.getState(); s.fighters[0].knockdownTime = .48; api.setState(s);
  });
  await advance(page, .01); const faint = (await frames(page))[0]; expect(faint.animation).toBe('Faint');
  await advance(page, .28); const last = (await frames(page))[0]; expect(last.animation).toBe('Faint'); expect(last.frame).not.toBe(faint.frame);
  await advance(page, .06); expect((await frames(page))[0].frame).toBe(last.frame);
  await advance(page, .3); expect((await frames(page))[0].animation).toBe('Idle');
  writeFileSync(`${bulbasaurDocs}/frames.json`, JSON.stringify(observations, null, 2));
  await page.evaluate(() => {
    const api = (window as any).__arena, s = api.getState(); s.fighters[0].hp = 0; api.setState(s);
  });
  await advance(page, .02); const defeated = (await frames(page))[0];
  expect(defeated.animation).toBe('Faint'); expect(defeated.frame % 4).toBe(3);
  await page.goto('/docs/pokemon/0001-bulbasaur/preview.html');
  await page.waitForFunction('Object.values(images).every(image => image.complete && image.naturalWidth > 0)');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${bulbasaurDocs}/eight-directions.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test('Bulbasaur short touch taps and roster fit all mobile sizes', async ({ browser }) => {
  for (const viewport of [{ width: 844, height: 390 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
    const page = await context.newPage(), errors = captureErrors(page); await open(page);
    await page.screenshot({ path: `${bulbasaurDocs}/selection-${viewport.width}.png`, fullPage: true });
    await page.locator('[data-species="bulbasaur"]').tap();
    await expect(page.locator('[data-action="ranged"]')).toHaveText('잎날가르기충전');
    await expect(page.locator('[data-action="special"]')).toHaveText('씨뿌리기');
    await page.locator('[data-action="ranged"]').tap();
    await expect.poll(async () => (await state(page)).fighters[0].rangedCooldown).toBeGreaterThan(0);
    await expect.poll(async () => (await state(page)).fighters[0].phase).toBe('idle');
    await page.locator('[data-action="special"]').tap();
    await expect.poll(async () => (await state(page)).fighters[0].specialCooldown).toBeGreaterThan(5);
    await page.screenshot({ path: `${bulbasaurDocs}/touch-${viewport.width}.png`, fullPage: true });
    expect((await frames(page))[0].placeholder).toBe(false); expect(errors).toEqual([]);
    await context.close();
  }
});

const ivysaurDocs = 'docs/pokemon/0002-ivysaur';
mkdirSync(ivysaurDocs, { recursive: true });
test('Ivysaur eight directions, returning leaf, Solar Beam, help and mirror reset', async ({ page }) => {
  const errors = captureErrors(page); await open(page);
  await page.locator('[data-opponent]').selectOption('ivysaur'); await page.locator('[data-species="ivysaur"]').click();
  await expect(page.locator('[data-enemy-name]')).toHaveText('이상해풀');
  await expect(page.locator('[data-special-label]')).toHaveText('솔라빔');
  await page.locator('[data-help]').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('[data-help-dialog]')).toBeVisible();
  await expect(page.locator('[data-help-content]')).toContainText('90~145px');
  expect(await page.evaluate(() => (window as any).__arena.getPaused())).toBe(true);
  await page.screenshot({ path: `${ivysaurDocs}/help.png`, fullPage: true });
  await page.locator('[data-help-species]').selectOption('bulbasaur');
  await expect(page.locator('[data-help-content]')).toContainText('0.65~0.85초');
  await expect(page.locator('[data-help-content]')).toContainText('충전·정밀 +8');
  await page.screenshot({ path: `${bulbasaurDocs}/help.png`, fullPage: true });
  await page.keyboard.press('Escape'); await expect(page.locator('[data-help-dialog]')).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__arena.getPaused())).toBe(false);
  await prepared(page, 'ivysaur');
  const observations: any[] = [];
  for (let direction = 0; direction < 8; direction++) {
    const a = Math.PI / 2 - direction * Math.PI / 4, move = { x: Math.cos(a), y: Math.sin(a) };
    await advance(page, .05, { ...idle, move }); const first = (await frames(page))[0];
    await advance(page, .15, { ...idle, move }); const second = (await frames(page))[0];
    expect(second.direction).toBe(direction); expect(first.frame).not.toBe(second.frame); expect(first.placeholder).toBe(false); observations.push(second);
  }
  writeFileSync(`${ivysaurDocs}/frames.json`, JSON.stringify(observations, null, 2));
  await prepared(page, 'ivysaur'); await advance(page, .02, { ...idle, ranged: true });
  expect((await frames(page))[0].animation).toBe('Charge'); await advance(page, .21); expect((await frames(page))[0].animation).toBe('Shoot');
  await advance(page, .75); expect((await state(page)).projectiles[0].returning).toBe(true);
  await page.screenshot({ path: `${ivysaurDocs}/return-leaf.png`, fullPage: true });
  await prepared(page, 'ivysaur'); await advance(page, .65, { ...idle, special: true });
  expect((await frames(page))[0].animation).toBe('Charge');
  await page.screenshot({ path: `${ivysaurDocs}/solar-charge.png`, fullPage: true });
  await advance(page, .24); expect((await state(page)).fighters[1].hp).toBe(68);
  await page.screenshot({ path: `${ivysaurDocs}/solar-beam.png`, fullPage: true });
  await page.evaluate(() => { const a=(window as any).__arena; a.start('ivysaur','ivysaur'); a.setPaused(true); });
  expect((await state(page)).fighters.map((f: any) => f.species)).toEqual(['ivysaur','ivysaur']); expect((await state(page)).projectiles).toEqual([]);
  await page.goto('/docs/pokemon/0002-ivysaur/preview.html');
  await page.waitForFunction('Object.values(images).every(image => image.complete && image.naturalWidth > 0)');
  await page.screenshot({ path: `${ivysaurDocs}/eight-directions.png`, fullPage: true }); expect(errors).toEqual([]);
  await page.close(); await page.video()!.saveAs(`${ivysaurDocs}/controls.webm`);
});

test('Grass move help fits mobile and real held input charges before release', async ({ browser }) => {
  for (const viewport of [{ width:844,height:390 }, { width:390,height:844 }, { width:320,height:740 }]) {
    const context=await browser.newContext({viewport,isMobile:true,hasTouch:true}), page=await context.newPage();
    const errors=captureErrors(page); await open(page);
    await page.locator('[data-species="ivysaur"]').tap(); await page.locator('[data-help]').tap();
    await expect(page.locator('[data-help-content]')).toContainText('왕복 명중 합계 22');
    const box=(await page.locator('[data-help-dialog]').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x+box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y+box.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({path:`${ivysaurDocs}/help-${viewport.width}.png`,fullPage:true});
    await page.locator('[data-help-close]').tap();
    await page.locator('[data-action="ranged"]').tap(); await expect.poll(async()=>(await state(page)).fighters[0].rangedCooldown).toBeGreaterThan(0);
    await page.evaluate(()=>{const a=(window as any).__arena;a.start('bulbasaur');const s=a.getState();s.fighters[1].pos={x:800,y:130};s.fighters[1].energy=0;a.setState(s);});
    const button=page.locator('[data-action="ranged"]'), bounds=(await button.boundingBox())!;
    const touch=await context.newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2}]});
    await expect.poll(async()=>(await state(page)).fighters[0].chargeTime,{intervals:[20]}).toBeGreaterThan(.55);
    await expect(page.locator('[data-charge]')).toBeVisible();
    await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect.poll(async()=>(await state(page)).fighters[0].rangedCooldown,{intervals:[20]}).toBeGreaterThan(0);
    expect(errors).toEqual([]); await context.close();
  }
});

test('Bulbasaur real pause preserves charge until fresh input', async ({ page }) => {
  await open(page); await page.locator('[data-species="bulbasaur"]').click();
  await page.evaluate(()=>{const a=(window as any).__arena,s=a.getState();s.fighters[1].pos={x:800,y:130};s.fighters[1].energy=0;a.setState(s);});
  await page.keyboard.down('k');
  await expect.poll(async()=>(await state(page)).fighters[0].chargeTime,{intervals:[20]}).toBeGreaterThan(.3);
  await page.keyboard.press('Escape'); await page.keyboard.up('k');
  const frozen=await state(page); await page.waitForTimeout(100); expect(await state(page)).toEqual(frozen);
  await page.keyboard.press('Escape'); await page.waitForTimeout(120);
  expect((await state(page)).fighters[0].chargeTime).toBe(frozen.fighters[0].chargeTime);
  expect((await state(page)).projectiles.filter((p:any)=>p.owner===0)).toEqual([]);
  await page.keyboard.down('k');
  await expect.poll(async()=>(await state(page)).fighters[0].chargeTime,{intervals:[20]}).toBeGreaterThan(frozen.fighters[0].chargeTime+.1);
  await page.keyboard.up('k'); await expect.poll(async()=>(await state(page)).fighters[0].rangedCooldown,{intervals:[20]}).toBeGreaterThan(0);
});

// Effects are evaluated against real command-driven snapshots, not manually invented spell state.
test('VFX review covers all 18 moves, charge tiers, eight directions and local textures', async ({ page }) => {
  test.setTimeout(90000);
  const errors = captureErrors(page);
  await page.goto('/vfx-review.html');
  await page.waitForFunction(() => (window as any).__vfxReview?.debug());
  const species = ['charmander', 'squirtle', 'bulbasaur', 'ivysaur', 'pikachu', 'mewtwo'];
  for (const id of species) for (const action of ['melee', 'ranged', 'special']) {
    const seen = await page.evaluate(({ id, action }) => {
      const api = (window as any).__vfxReview; api.select(id, action, 'mastery');
      const clips = new Set<string>(); const missing = new Set<string>();
      for (const frame of [3, 8, 15, 28, 45, 60, 75, 100, 145, 190]) {
        api.seek(frame); const debug = api.debug();
        for (const d of debug.draws) clips.add(d.clip);
        for (const m of debug.missing) missing.add(m);
      }
      return { clips: [...clips], missing: [...missing] };
    }, { id, action });
    expect(seen.missing).toEqual([]); expect(seen.clips.length, `${id} ${action} has actual art`).toBeGreaterThan(0);
    const captureTick = action === 'melee' ? 12 : action === 'ranged' ? (id === 'bulbasaur' ? 55 : 32) : id === 'ivysaur' ? 55 : id === 'bulbasaur' ? 80 : 65;
    await page.evaluate(tick => (window as any).__vfxReview.seek(tick), captureTick);
    await page.locator('canvas').screenshot({ path: `docs/vfx-overhaul/verified/${id}-${action}.png` });
  }
  for (let facing = 0; facing < 8; facing++) {
    await page.evaluate(facing => { const api = (window as any).__vfxReview; api.select('ivysaur', 'special', 'blocked', facing); api.seek(60); }, facing);
    expect(await page.evaluate(() => (window as any).__vfxReview.debug().missing)).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test('VFX pause freezes frames and resets leave no sprites from previous species', async ({ page }) => {
  await open(page); await page.locator('[data-species="squirtle"]').click(); await prepared(page, 'squirtle');
  await advance(page, 1, { ...idle, special: true });
  const read = () => page.evaluate(() => (window as any).__arena.getVfx());
  const before = await read(); expect(before.draws.some((d: any) => d.clip === 'whirlpool')).toBe(true);
  await page.waitForTimeout(120); expect((await read()).draws).toEqual(before.draws);
  await page.evaluate(() => { const api = (window as any).__arena; api.start('bulbasaur'); api.setPaused(true); });
  await expect.poll(async () => (await read()).active).toBe(0);
  expect((await read()).draws).toEqual([]);
  // Repeated renders reuse the bounded pool instead of accumulating particles.
  await prepared(page, 'charmander'); await advance(page, 1, { ...idle, special: true });
  const allocated = (await read()).allocated;
  await page.waitForTimeout(180); expect((await read()).allocated).toBe(allocated);
  expect(allocated).toBeLessThanOrEqual(384);
});

test('VFX beam follows actual obstacle endpoint; water and fire have separate near/far layers', async ({ page }) => {
  await open(page); await page.locator('[data-species="squirtle"]').click(); await prepared(page, 'squirtle');
  await page.evaluate(() => { const api = (window as any).__arena, s = api.getState(); s.obstacles = [{ id: 500, kind: 'rock', pos: { x: 480, y: 312 }, radius: 26, hp: 1000, maxHp: 1000 }]; api.setState(s); });
  await advance(page, .7, { ...idle, ranged: true });
  const beam = (await state(page)).beams[0];
  const debug = await page.evaluate(() => (window as any).__arena.getVfx());
  expect(beam.blocked).toBe(true); expect(beam.end.x).toBeLessThan(480);
  const body = debug.draws.find((d: any) => d.clip === 'waterBody');
  expect(body.x).toBe(Math.round(beam.end.x)); expect(body.y).toBe(Math.round(beam.end.y - 24));
  await prepared(page, 'charmander'); await advance(page, 1, { ...idle, special: true });
  const d = await page.evaluate(() => (window as any).__arena.getVfx().draws);
  expect(d.find((v: any) => v.clip === 'fireBack').depth).toBeLessThan(d.find((v: any) => v.clip === 'fireFront').depth);
});

test('VFX remain readable on mobile and the review timeline is keyboard operable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/vfx-review.html');
  await page.waitForFunction(() => (window as any).__vfxReview?.debug());
  await page.selectOption('#species', 'squirtle'); await page.selectOption('#move', 'special');
  await page.locator('#time').focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
  expect(await page.locator('#time').inputValue()).toBe('1');
  await page.evaluate(() => (window as any).__vfxReview.seek(65));
  const bounds = (await page.locator('canvas').boundingBox())!;
  expect(bounds.width).toBeLessThanOrEqual(390); expect(bounds.width).toBeGreaterThan(300);
  await page.screenshot({ path: 'docs/vfx-overhaul/verified/mobile-review.png', fullPage: true });
});
