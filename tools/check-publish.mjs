import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const excluded = /(?:^|\/)(?:public\/assets|docs|notes|artifacts|test-results|playwright-report|node_modules|dist|build|coverage|\.openai(?:-local)?|\.codex|\.agents|\.claude|\.local)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:md|markdown|png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|mp4|webm|mov|zip|tar|gz|log)$/i;
const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
const violations = new Set(tracked.filter(path => excluded.test(path)));
// Inspect outgoing history. Existing remote commits are already published and
// are preserved; the complete current index is always checked above.
const revisions = git('rev-list', '--objects', '--all', '--not', '--remotes').trim().split('\n').filter(Boolean);
for (const entry of revisions) {
  const split = entry.indexOf(' ');
  if (split !== -1 && excluded.test(entry.slice(split + 1))) violations.add(entry.slice(split + 1));
}
for (const path of tracked) {
  const bytes = execFileSync('git', ['show', `:${path}`]);
  const magic = bytes.subarray(0, 12).toString('hex');
  if (/^(89504e47|ffd8ff|47494638|424d|00000100)/.test(magic) ||
      (magic.startsWith('52494646') && magic.endsWith('57454250'))) violations.add(path);
  const content = bytes.toString('utf8');
  if (new RegExp('data:' + 'image\\/[^;]+;base64,', 'i').test(content)) violations.add(path);
}
if (violations.size) {
  console.error('Publication blocked: excluded files or embedded images in index/outgoing history.');
  for (const path of violations) console.error(`  ${path}`);
  process.exit(1);
}
console.log(`Publication check passed: ${tracked.length} tracked files; no excluded media, local records or embedded images in index/outgoing history.`);
