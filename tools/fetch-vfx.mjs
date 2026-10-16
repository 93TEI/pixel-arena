import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { origin, revision, sourceFiles } from './vfx-assets.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const dir = `${root}public/assets/vfx`;
await mkdir(dir, { recursive: true });
const check = process.argv.includes('--check');
const expected = check ? JSON.parse(await readFile(`${root}src/render/vfx-manifest.json`, 'utf8')) : null;
for (let i = 0; i < sourceFiles.length; i += 4) {
  await Promise.all(sourceFiles.slice(i, i + 4).map(async asset => {
    let data;
    try { data = await readFile(`${dir}/${asset.file}`); } catch { /* explicit downloader */ }
    if (!data) {
      if (check) throw new Error(`Missing ${asset.file}`);
      const response = await fetch(`${origin}/${asset.path}`, { signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error(`${asset.path}: ${response.status}`);
      data = Buffer.from(await response.arrayBuffer());
      await writeFile(`${dir}/${asset.file}`, data);
    }
    if (asset.file.endsWith('.png') && !data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error(`Invalid PNG: ${asset.file}`);
    if (check && asset.file.endsWith('.png')) {
      const clip = expected[asset.key];
      if (!clip || data.readUInt32BE(16) !== clip.frameWidth * clip.columns || data.readUInt32BE(20) !== clip.frameHeight * clip.rows) throw new Error(`Frame grid mismatch: ${asset.file}`);
      if (createHash('sha256').update(data).digest('hex') !== clip.sha256) throw new Error(`Source bytes changed: ${asset.file}`);
    }
  }));
}
if (!check) {
  const manifest = {};
  for (const asset of sourceFiles.filter(a => a.file.endsWith('.png'))) {
    const data = await readFile(`${dir}/${asset.file}`), width = data.readUInt32BE(16), height = data.readUInt32BE(20);
    const directions = asset.path.includes('.Dir5.') ? 5 : asset.path.includes('.Dir8.') ? 8 : 1;
    let frameHeight = height / directions, frameWidth = frameHeight;
    if (asset.path.startsWith('Beam/')) {
      const xml = await readFile(`${dir}/${asset.key.replace(/(Body|Head|Tail)$/, '')}-BeamData.xml`, 'utf8');
      const frames = Number(xml.match(/<TotalFrames>(\d+)<\/TotalFrames>/)[1]);
      // PMDO beams store animation horizontally, three pieces in separate files.
      frameWidth = width / frames;
    }
    if (!Number.isInteger(frameWidth) || width % frameWidth) throw new Error(`Invalid grid ${asset.file}: ${width} x ${height} / ${frameWidth}`);
    manifest[asset.key] = { file: asset.file, frameWidth, frameHeight, columns: width / frameWidth, rows: directions, fps: 20, origin: [0.5, 0.5], source: `${origin}/${asset.path}`, sha256: createHash('sha256').update(data).digest('hex') };
  }
  await writeFile(`${root}src/render/vfx-manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(`${dir}/SOURCES.md`, `# Effect artwork\n\nOriginal PMD / PMDO effect sheets, preserved without pixel edits. Source: https://github.com/PMDCollab/RawAsset/tree/${revision}\n\nPMD original artwork belongs to its respective Nintendo / Pokémon / CHUNSOFT rights holders; PMDO community additions remain their authors’ work. No claim that these images are MIT-licensed or newly drawn by this project. Local fan-project use; this does not grant redistribution or commercial rights.\n\nFormat: https://wiki.pmdo.pmdcollab.org/Importing_Objects_and_VFX\n\n${sourceFiles.map(a => `- ${a.file}: ${origin}/${a.path}`).join('\n')}\n`);
}
console.log(`${sourceFiles.length} pinned VFX source files verified${check ? '' : '; frame manifest written'}.`);
