import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// CLAUDE.md: the core and server entries (and everything they import) use only
// Web APIs so they run in Node, Deno, edge runtimes and the browser. Node-only
// code lives in `src/excel.ts`. This test walks the import graph from every
// entry except excel and fails on anything Node-specific it can reach.
const src = path.resolve(__dirname, '../src');
const entries = ['index.ts', 'server.ts', 'react.tsx', 'markdown.ts', 'supabase.ts'];

const NODE_BUILTINS =
  'assert|async_hooks|buffer|child_process|cluster|crypto|dgram|dns|events|fs|http|http2|https|module|net|os|path|perf_hooks|process|querystring|readline|stream|string_decoder|timers|tls|tty|url|util|v8|vm|worker_threads|zlib';

const forbidden: Array<{ name: string; pattern: RegExp }> = [
  { name: 'node: import', pattern: /\b(?:from|import|require)\s*\(?\s*['"]node:/ },
  { name: 'bare Node built-in import', pattern: new RegExp(`\\b(?:from|import|require)\\s*\\(?\\s*['"](?:${NODE_BUILTINS})(?:/[^'"]*)?['"]`) },
  { name: 'Buffer', pattern: /\bBuffer\b/ },
  { name: 'process', pattern: /\bprocess\b/ },
  { name: 'require()', pattern: /\brequire\s*\(/ },
  { name: 'Node global', pattern: /\b(?:__dirname|__filename|setImmediate|clearImmediate|global)\b/ },
];

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function localImports(code: string): string[] {
  const specs: string[] = [];
  const re = /\b(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*['"]([^'"]+)['"]/g;
  for (const match of code.matchAll(re)) {
    const spec = match[1] ?? match[2] ?? match[3];
    if (spec && spec.startsWith('.')) specs.push(spec);
  }
  return specs;
}

function resolveLocal(from: string, spec: string): string {
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`cannot resolve ${spec} from ${path.relative(src, from)}`);
}

function walk(entry: string, seen = new Map<string, string>()): Map<string, string> {
  const file = path.join(src, entry);
  if (seen.has(file)) return seen;
  const code = stripComments(fs.readFileSync(file, 'utf8'));
  seen.set(file, code);
  for (const spec of localImports(code)) walk(path.relative(src, resolveLocal(file, spec)), seen);
  return seen;
}

function violations(files: Map<string, string>): string[] {
  const found: string[] = [];
  for (const [file, code] of files) {
    code.split('\n').forEach((line, index) => {
      for (const { name, pattern } of forbidden) {
        if (pattern.test(line)) found.push(`${path.relative(src, file)}:${index + 1} uses ${name}: ${line.trim()}`);
      }
    });
  }
  return found;
}

describe('runtime portability', () => {
  const reachable = new Map<string, string>();
  for (const entry of entries) walk(entry, reachable);
  const names = [...reachable.keys()].map((file) => path.relative(src, file)).sort();

  it('walks the import graph from every portable entry', () => {
    expect(names).toEqual(expect.arrayContaining(['index.ts', 'server.ts', 'handler.ts', 'loop.ts', 'fallback.ts', 'events.ts', 'react.tsx']));
  });

  it('never reaches src/excel.ts from a portable entry', () => {
    expect(names).not.toContain('excel.ts');
  });

  it('uses no node: imports, Buffer, process or Node globals', () => {
    expect(violations(reachable), 'Web APIs only; move Node-only code to src/excel.ts').toEqual([]);
  });

  it('detects each forbidden pattern', () => {
    const sample = new Map([
      ['a.ts', "import fs from 'node:fs';\nconst b = Buffer.from('x');\nconst e = process.env.X;\nconst r = require('x');\nconst d = __dirname;\nimport { join } from 'path';"],
    ]);
    expect(violations(sample)).toHaveLength(6);
    const clean = new Map([['b.ts', "const s = data as BufferSource; const a: ArrayBuffer = x; headers['X-Accel-Buffering'] = 'no'; // process.env in Deno"]]);
    expect(violations(new Map([['b.ts', stripComments(clean.get('b.ts')!)]]))).toEqual([]);
  });
});
