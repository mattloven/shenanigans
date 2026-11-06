import { beforeEach, describe, expect, it } from 'vitest';
import { mountReviewGroups, resetReviewGroup } from '../../src/content/review-groups.js';
import { firstUnfinishedGroup, nextUnviewed, parseReviewedState, reviewGroup } from '../../src/core/review-groups.js';
import { assignGroup, dotnetWorkflow, normalizeWorkflowState } from '../../src/core/review-workflows.js';

describe('reviewGroup', () => {
  it('splits build and config from the application, tests, and notes', () => {
    expect(reviewGroup('serverless console/build.cake')).toBe('infrastructure');
    expect(reviewGroup('serverless console/src/Dockerfile.api')).toBe('infrastructure');
    expect(reviewGroup('serverless console/src/.dockerignore')).toBe('infrastructure');
    expect(reviewGroup('.gitignore')).toBe('infrastructure');
    expect(reviewGroup('infra/main.tf')).toBe('infrastructure');
    expect(reviewGroup('src/appsettings.Development.json')).toBe('infrastructure');
    expect(reviewGroup('.github/workflows/ci.yml')).toBe('infrastructure');
    expect(reviewGroup('src/Api/Api.csproj')).toBe('infrastructure');
    expect(reviewGroup('src/Api/Payment.cs')).toBe('business');
    expect(reviewGroup('src/Api.Tests/PaymentTests.cs')).toBe('tests');
    expect(reviewGroup('src/Api.Tests/Api.Tests.csproj')).toBe('tests');
    expect(reviewGroup('README.md')).toBe('docs');
    expect(reviewGroup('docs/LICENSE')).toBe('docs');
  });
});

describe('review path actions', () => {
  const files = [
    { path: 'build.cake', group: 'infrastructure' },
    { path: 'src/App.cs', group: 'business' },
    { path: 'src/App.Tests/A.cs', group: 'tests' },
    { path: 'README.md', group: 'docs' },
  ];

  it('walks past the open file and wraps to the first unviewed file', () => {
    const reviewed = new Set(['src/App.cs', 'README.md']);
    expect(nextUnviewed(files, reviewed, null, 'src/App.cs')?.path).toBe('src/App.Tests/A.cs');
    expect(nextUnviewed(files, new Set(['src/App.cs', 'src/App.Tests/A.cs', 'README.md']), null, 'src/App.cs')?.path).toBe('build.cake');
    expect(nextUnviewed(files, reviewed, 'tests', null)?.path).toBe('src/App.Tests/A.cs');
    expect(nextUnviewed(files, new Set(files.map((file) => file.path)), null, null)).toBeNull();
  });

  it('picks the first group that still has a file to view', () => {
