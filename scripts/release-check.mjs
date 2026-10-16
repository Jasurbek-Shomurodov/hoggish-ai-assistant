#!/usr/bin/env node
// Release guard (CLAUDE.md "Releasing"). Default mode runs on every `npm run check`:
// package.json version is at least the last tag, CHANGELOG.md and the README install
// snippet name that version, every dist export has a tsup entry and built files,
// and dist/ is not stale. `--release` also requires the version to be above the last
// tag, i.e. a release is actually pending.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDist } from './check-dist.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = process.argv.includes('--release');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const problems = [];
const fail = (message) => problems.push(message);

const pkg = JSON.parse(read('package.json'));
const version = pkg.version;
const parse = (v) => v.replace(/^v/, '').split('.').map(Number);
const compare = (a, b) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

// 1. Version vs the last git tag.
const tags = spawnSync('git', ['tag', '--list', 'v*'], { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter((t) => /^v\d+\.\d+\.\d+$/.test(t)).sort(compare);
const lastTag = tags.at(-1) ?? 'v0.0.0';
const bump = compare(version, lastTag);
if (bump < 0) fail(`package.json version ${version} is below the last tag ${lastTag}`);
if (release && bump === 0) fail(`package.json version ${version} equals the last tag ${lastTag}; bump it (patch for fixes, minor for features) before tagging`);

// 2. CHANGELOG.md entry.
if (!new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b`, 'm').test(read('CHANGELOG.md'))) fail(`CHANGELOG.md has no "## ${version}" entry`);

// 3. README install snippet.
const readme = read('README.md');
const snippet = readme.match(/hoggish-ai-assistant#(v\d+\.\d+\.\d+)/);
if (!snippet) fail('README.md has no install snippet "hoggish-ai-assistant#vX.Y.Z"');
else if (snippet[1] !== `v${version}`) fail(`README install snippet points at ${snippet[1]}, package.json is ${version}`);

// 4. exports <-> tsup entries <-> dist files.
const tsupConfig = read('tsup.config.ts');
const tsupEntries = new Set([...tsupConfig.matchAll(/\b([A-Za-z0-9_]+):\s*'src\/[^']+'/g)].map((m) => m[1]));
const distExports = new Set();
for (const [key, target] of Object.entries(pkg.exports)) {
  const files = typeof target === 'string' ? [target] : Object.values(target);
  for (const file of files) {
    if (!file.startsWith('./dist/')) continue;
    const name = path.basename(file).replace(/\.d\.ts$|\.js$/, '');
    distExports.add(name);
    if (!tsupEntries.has(name)) fail(`exports["${key}"] -> ${file} has no tsup entry "${name}"`);
    if (!fs.existsSync(path.join(root, file))) fail(`exports["${key}"] -> ${file} is not in dist/`);
  }
}
for (const entry of tsupEntries) if (!distExports.has(entry)) fail(`tsup entry "${entry}" has no package.json exports entry`);

// 5. dist not stale.
for (const problem of checkDist()) fail(`dist/ stale: ${problem}`);

if (problems.length > 0) {
  console.error(`release-check failed for ${version} (last tag ${lastTag}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  bump > 0
    ? `release-check: ${version} is ready to tag (last tag ${lastTag}); changelog, README, exports and dist/ agree.`
    : `release-check: ${version} matches the last tag ${lastTag}; no release pending; exports and dist/ agree.`,
);
