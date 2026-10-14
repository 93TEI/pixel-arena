import { build } from 'esbuild';
import { access, mkdir, writeFile } from 'node:fs/promises';
async function bundle(source) {
  const result = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const engine = await bundle(`export { createBattle, stepBattle } from './src/game/battle'; export { aiCommand } from './src/game/ai';`);
let before;
try { await access('docs/pokemon/0001-bulbasaur/before-rework/battle.ts'); } catch { console.log('Original local snapshot unavailable: skipping before profile.'); }
try {
  await access('docs/pokemon/0001-bulbasaur/before-rework/battle.ts');
  before = await bundle(`export { createBattle, stepBattle } from './docs/pokemon/0001-bulbasaur/before-rework/battle'; export { aiCommand } from './docs/pokemon/0001-bulbasaur/before-rework/ai';`);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const count = Number(process.argv[2] ?? 100);
if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('Seeds must be 1..1000');
const reports = [];
for (const profile of [...(before ? ['before'] : []), 'basic', 'combo', 'ivysaur']) {
  const species = profile === 'ivysaur' ? 'ivysaur' : 'bulbasaur';
  const create = profile === 'before' ? before.createBattle : engine.createBattle;
  const step = profile === 'before' ? before.stepBattle : engine.stepBattle;
  const ai = profile === 'before' ? before.aiCommand : engine.aiCommand;
  const opponents = profile === 'before' ? ['charmander','squirtle','pikachu','mewtwo'] : ['charmander','squirtle','pikachu','mewtwo', ...(profile === 'ivysaur' ? ['bulbasaur'] : ['ivysaur'])];
  for (const opponent of opponents) {
    let wins = 0, draws = 0, damage = 0, time = 0; const bySide = [0, 0];
    for (let seed = 1; seed <= count; seed++) for (const slot of [0,1]) {
      const s = create(slot === 0 ? species : opponent, seed, slot === 0 ? opponent : species);
      for (let tick = 0; tick < 60 * 90 && s.winner === null; tick++) {
        const commands = [ai(s,0,1/60),ai(s,1,1/60)];
        if (profile === 'basic') { commands[slot].rangedHeld = false; }
        step(s,commands,1/60);
      }
      if (s.winner === slot) { wins++; bySide[slot]++; }
      if (s.winner === null) draws++;
      damage += 100 - s.fighters[1-slot].hp; time += s.time;
    }
    const item = {profile,opponent,matches:count*2,wins,draws,winRate:wins/(count*2),bySide:bySide.map(n=>n/count),meanOpponentHPLost:damage/(count*2),meanSeconds:time/(count*2)};
    reports.push(item); console.log(JSON.stringify(item));
  }
}
const summary = Object.fromEntries([...new Set(reports.map(r => r.profile))].map(profile => { const rows = reports.filter(r => r.profile === profile); const winRate = rows.reduce((n,r) => n + r.wins, 0) / rows.reduce((n,r) => n + r.matches, 0); return [profile, { winRate, overallTargetMet: winRate >= .45 && winRate <= .55, pairTargetMet: rows.every(r => r.winRate >= .35 && r.winRate <= .65) }]; }));
const report = { summary, profiles: { basic: 'Normal AI with seed and tap leaves; charge disabled', combo: 'Normal AI using charge when preparing seed combo or at long range', ivysaur: 'Normal AI' }, date: new Date().toISOString(), seedCount: count, seeds: `1..${count}`, limitSeconds: 90, caveat: 'AI simulation, not human balance proof. The stock AI phase uses seed % 31, so seeds repeat tactical patterns. Before uses the preserved original engine and AI.', reports };
await mkdir('docs/pokemon/0001-bulbasaur', { recursive: true });
await writeFile('docs/pokemon/0001-bulbasaur/balance.json', JSON.stringify(report,null,2));
