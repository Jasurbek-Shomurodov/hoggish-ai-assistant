import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Public API guard. Everything exported from the six entry points, the NDJSON
// event type names and the error codes are a contract with the two consumer
// apps. The snapshot in test/api-snapshot.json changes only on purpose:
//   UPDATE_API_SNAPSHOT=1 npm test
// A removed or renamed name is a breaking change and needs a major version bump.
const root = path.resolve(__dirname, '..');
const snapshotPath = path.join(root, 'test/api-snapshot.json');
const entries = ['index', 'server', 'react', 'markdown', 'excel', 'supabase'] as const;

async function currentApi() {
  const exportsByEntry: Record<string, string[]> = {};
  for (const entry of entries) {
    const mod = (await import(`../dist/${entry}.js`)) as Record<string, unknown>;
    exportsByEntry[entry] = Object.keys(mod).filter((name) => name !== 'default').sort();
  }
  const events = fs.readFileSync(path.join(root, 'src/events.ts'), 'utf8');
  const union = events.match(/export type AssistantEvent =([\s\S]*?);\n/)?.[1] ?? '';
  const eventTypes = [...union.matchAll(/type:\s*'([a-z_]+)'/g)].map((m) => m[1] as string).sort();
  const index = (await import('../dist/index.js')) as { ASSISTANT_ERROR_CODES: readonly string[] };
  return { exports: exportsByEntry, eventTypes, errorCodes: [...index.ASSISTANT_ERROR_CODES].sort() };
}

const hint = [
  'Public API changed. If an export, event type or error code was removed or renamed,',
  'this is a BREAKING change: bump the MAJOR version in package.json and say so in CHANGELOG.md.',
  'An added name needs a minor bump. Then update the snapshot on purpose:',
  '  UPDATE_API_SNAPSHOT=1 npm test',
].join('\n');

describe('public API snapshot', () => {
  it('matches test/api-snapshot.json (runtime exports, NDJSON event types, error codes)', async () => {
    const actual = await currentApi();
    expect(actual.eventTypes.length, 'event union parsed from src/events.ts').toBeGreaterThan(5);
    if (process.env.UPDATE_API_SNAPSHOT) {
      fs.writeFileSync(snapshotPath, `${JSON.stringify(actual, null, 2)}\n`);
      return;
    }
    expect(fs.existsSync(snapshotPath), `${hint}\n(snapshot file missing)`).toBe(true);
    const expected = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    expect(actual, hint).toEqual(expected);
  });
});
