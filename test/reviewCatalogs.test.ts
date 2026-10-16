import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The /cr, /qa and /dr skills run from these catalogs; keep them well formed so
// a run never skips, double-counts or mis-ranks a case.
const root = path.resolve(__dirname, '..');
const skills = ['cr', 'qa', 'dr'] as const;
const catalogPath = (skill: string) => path.join(root, '.claude/skills', skill, 'references/cases.md');
const skillPath = (skill: string) => path.join(root, '.claude/skills', skill, 'SKILL.md');

const PIPE = '\u0000';
const splitRow = (line: string) =>
  line
    .replace(/\\\|/g, PIPE)
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim().replace(new RegExp(PIPE, 'g'), '|'));

const caseRows = (text: string) =>
  text
    .split('\n')
    .filter((line) => /^\| [A-Z0-9]+-\d{3} \|/.test(line))
    .map(splitRow);

const areaCodes = (skillText: string) => {
  const match = skillText.match(/area code \(([^)]+)\)/);
  if (!match) throw new Error('the skill description names no area codes');
  return (match[1] ?? '').split(',').map((area) => area.trim());
};

describe.each(skills)('/%s catalog', (skill) => {
  const catalog = fs.readFileSync(catalogPath(skill), 'utf8');
  const skillText = fs.readFileSync(skillPath(skill), 'utf8');
  const rows = caseRows(catalog);

  it('has cases with five filled columns and S0/S1/S2 severities', () => {
    expect(rows.length).toBeGreaterThan(20);
    for (const cells of rows) {
      expect(cells, `${cells[0]} has ID, Sev, Case, Check and Expect`).toHaveLength(5);
      for (const cell of cells) expect(cell, `${cells[0]} has no empty cell`).not.toBe('');
      expect(cells[1], `${cells[0]} severity`).toMatch(/^S[012]$/);
    }
  });

  it('keeps every case ID unique', () => {
    const ids = rows.map((cells) => cells[0]);
    const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(repeated).toEqual([]);
  });

  it('uses the shared table header in every area section', () => {
    const headers = catalog.split('\n').filter((line) => line.startsWith('| ID |'));
    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) expect(header).toBe('| ID | Sev | Case | Check | Expect |');
  });

  it('starts with a run log table', () => {
    expect(catalog).toMatch(/## Run log[\s\S]*\| Date \| Commit \| Scope \| Findings \(S0\/S1\/S2\) \| Checks run \| Not run \|/);
  });

  it('matches the area codes the skill names, in both directions', () => {
    const named = areaCodes(skillText);
    const present = [...new Set(rows.map((cells) => (cells[0] ?? '').split('-')[0] ?? ''))];
    for (const area of named) expect(present, `area ${area} has cases`).toContain(area);
    for (const area of present) expect(named, `area ${area} is named in the skill`).toContain(area);
    expect(skillText).toMatch(/argument-hint: .*area code \(/);
  });

  it('points at the catalog and the shared contract', () => {
    expect(skillText).toMatch(/references\/cases\.md/);
    expect(skillText).toMatch(/review-core/);
    expect(skillText).toMatch(/CLAUDE\.md/);
  });
});
