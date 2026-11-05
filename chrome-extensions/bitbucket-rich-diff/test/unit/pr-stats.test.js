import { describe, expect, it } from 'vitest';
import { summarizeFiles } from '../../src/core/pr-stats.js';

describe('pull request stats', () => {
  it('counts files, lines, markdown, tests, projects and generated files', () => {
    expect(summarizeFiles([
      { path: 'README.md', added: 3, removed: 1 },
      { path: 'docs/guide.markdown', added: 2, removed: 0 },
      { path: 'src/Payment.Tests/ChargeTests.cs', added: 11, removed: 0, tests: 2 },
      { path: 'src/Payment.Tests/Payment.csproj', added: 1, removed: 0 },
      { path: 'pnpm-lock.yaml', added: 1, removed: 1 },
      { path: 'src/app.js', added: 4, removed: 2 },
    ])).toEqual({
      files: 6,
      added: 22,
      removed: 4,
      markdown: 2,
      testFiles: 2,
      tests: 2,
      projects: 1,
      generated: 1,
    });
  });
});