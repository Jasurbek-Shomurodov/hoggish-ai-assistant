#!/usr/bin/env node
// dist drift guard: builds into a sibling directory of dist/ and fails when the
// output differs from the committed dist/. A sibling directory keeps tsup's
// chunk hashes and source-map paths identical to a build into dist/ itself.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath ?? entry.path, entry.name)))
    .sort();
}

/** Returns the list of differences between a fresh build and dist/ (empty when in sync). */
export function checkDist() {
  const out = fs.mkdtempSync(path.join(root, '.dist-check-'));
  try {
    const build = spawnSync('npx', ['tsup', '--out-dir', path.relative(root, out)], { cwd: root, encoding: 'utf8' });
    if (build.status !== 0) return [`tsup failed (exit ${build.status}):\n${build.stdout}\n${build.stderr}`];
    const expected = listFiles(out);
    const actual = listFiles(dist);
    const problems = [];
    for (const file of expected) {
      if (!actual.includes(file)) problems.push(`missing in dist/: ${file}`);
      else if (!fs.readFileSync(path.join(out, file)).equals(fs.readFileSync(path.join(dist, file)))) problems.push(`differs: dist/${file}`);
    }
    for (const file of actual) if (!expected.includes(file)) problems.push(`stale file in dist/: ${file}`);
    return problems;
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkDist();
  if (problems.length > 0) {
    console.error('dist/ is out of date with src/. Run `npm run build` and commit dist/ with the change.');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log('dist/ matches a fresh build.');
}
