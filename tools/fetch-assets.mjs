#!/usr/bin/env node
// Explicit local opt-in only. The game never fetches third-party art at runtime.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceFiles, origin as effectOrigin } from './vfx-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'public/assets');
const origin = 'https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master';
const pokemon = [
  { name: 'ivysaur', id: '0002', portrait: 2, actions: ['Walk', 'Idle', 'Attack', 'Hurt', 'Charge', 'Shoot', 'Sleep'], markers: true },
  { name: 'bulbasaur', id: '0001', portrait: 1, actions: ['Walk', 'Idle', 'Attack', 'Hurt', 'Charge', 'Shoot', 'Faint'], markers: true },
  { name: 'charmander', id: '0004', portrait: 4, actions: ['Walk', 'Idle', 'Attack', 'Hurt', 'Charge', 'Faint'] },
  { name: 'squirtle', id: '0007', portrait: 7, actions: ['Walk', 'Idle', 'Attack', 'Hurt', 'Charge', 'Shoot', 'Faint'] },
  { name: 'pikachu', id: '0025', portrait: 25, actions: ['Walk', 'Idle', 'Attack', 'Hurt', 'Charge', 'Shoot', 'Faint'] },
  { name: 'mewtwo', id: '0150', portrait: 150, actions: ['Walk', 'Idle', 'Attack', 'Hurt', 'Charge', 'Shoot', 'Faint'] },
];
const files = pokemon.flatMap(({ name, id, portrait, actions, markers }) => [
  ...actions.map(action => ({ path: `animated/${name}/${action}-Anim.png`, url: `${origin}/sprite/${id}/${action}-Anim.png` })),
  ...(markers ? actions.flatMap(action => ['Shadow', 'Offsets'].map(kind => ({ path: `animated/${name}/${action}-${kind}.png`, url: `${origin}/sprite/${id}/${action}-${kind}.png` }))) : []),
  ...['AnimData.xml', 'credits.txt'].map(file => ({ path: `animated/${name}/${file}`, url: `${origin}/sprite/${id}/${file}` })),
  { path: `${name}.png`, url: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/${portrait}.png` },
]);
files.push({ path: 'animated/UPSTREAM-LICENSE.md', url: `${origin}/LICENSE.md` });
files.push(...sourceFiles.map(asset => ({ path: `vfx/${asset.file}`, url: `${effectOrigin}/${asset.path}` })));
const generated = [{ path: 'vfx/whirlpool-source.png' }];

if (process.argv.includes('--help')) {
  console.log('node tools/fetch-assets.mjs          Download optional art into ignored public/assets only.\nnode tools/fetch-assets.mjs --check  Check local files without network access.\nOriginal sheets credit CHUNSOFT via PMDCollab/SpriteCollab; original credits are retained.');
  process.exit(0);
}
function valid(file, data) {
  if (file.path.endsWith('.png')) return data.length > 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return data.length > 0;
}
async function exists(file) {
  try { return valid(file, await readFile(resolve(output, file.path))); } catch { return false; }
}
if (process.argv.includes('--check')) {
  const missing = [];
  for (const file of [...files, ...generated]) if (!await exists(file)) missing.push(file.path);
  console.log(missing.length ? `Optional local files missing or invalid:\n${missing.join('\n')}` : `All ${files.length + generated.length} optional local assets verified (including local-only generated art).`);
  process.exit(missing.length ? 1 : 0);
}
console.log('Downloading optional local art. No Git operations or uploads are performed.');
let downloaded = 0;
for (let start = 0; start < files.length; start += 3) {
  await Promise.all(files.slice(start, start + 3).map(async file => {
    if (await exists(file)) return;
    const response = await fetch(file.url, { signal: AbortSignal.timeout(25_000) });
    if (!response.ok) throw new Error(`${file.path}: HTTP ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (!valid(file, data)) throw new Error(`${file.path}: invalid asset data`);
    const target = resolve(output, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(`${target}.download`, data);
    await rename(`${target}.download`, target);
    downloaded++;
    console.log(`Saved ${file.path}`);
  }));
}
console.log(`Ready: ${downloaded} downloaded; ${files.length - downloaded} valid local files kept. Art stays in public/assets.`);
for (const file of generated) if (!await exists(file)) console.warn(`Local-only generated art is missing: ${file.path}. Restore it from the project art archive; it has no upstream download.`);
