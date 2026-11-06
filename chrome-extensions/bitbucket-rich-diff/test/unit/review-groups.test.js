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
    expect(firstUnfinishedGroup([
      { group: 'infrastructure', count: 2, viewed: 2 },
      { group: 'business', count: 4, viewed: 1 },
      { group: 'tests', count: 0, viewed: 0 },
      { group: 'docs', count: 1, viewed: 0 },
    ])).toBe('business');
    expect(firstUnfinishedGroup([
      { group: 'infrastructure', count: 1, viewed: 1 },
      { group: 'business', count: 1, viewed: 1 },
      { group: 'tests', count: 0, viewed: 0 },
      { group: 'docs', count: 1, viewed: 1 },
    ])).toBeNull();
  });
});

describe('parseReviewedState', () => {
  it('reads a path map, a reviewed object, and a list', () => {
    expect([...parseReviewedState('{"src/App.cs":true,"src/Skip.cs":false}')]).toEqual(['src/App.cs']);
    expect([...parseReviewedState('{"src/App.cs":{"reviewed":true}}')]).toEqual(['src/App.cs']);
    expect([...parseReviewedState('["/src/App.cs"]')]).toEqual(['src/App.cs']);
    expect(parseReviewedState('{}').size).toBe(0);
    expect(parseReviewedState('not json').size).toBe(0);
  });
});

describe('mountReviewGroups', () => {
  beforeEach(() => resetReviewGroup());

  it('filters the file list to the clicked group and turns a fully viewed group green', () => {
    document.body.innerHTML = `
      <section class="bbrd-stats"></section>
      <ul id="file-tree">
        <li>
          <button type="button"><span aria-label="Directory"></span><span>src</span></button>
          <ul>
            <li><a href="#chg-src/App.cs">App.cs</a></li>
            <li><a href="#chg-src/appsettings.json">appsettings.json <span>+</span><span>12</span><span>12 lines added, 2 lines removed</span></a></li>
            <li><a href="#chg-package-lock.json"><span>+</span><span>4,865</span><span>4,865 lines added</span></a></li>
            <li><a href="#chg-src/Note.cs"><span>+</span><span>22</span><span>22 lines added</span></a></li>
          </ul>
        </li>
        <li><a href="#chg-README.md">README.md</a></li>
      </ul>
      <article data-qa="branch-diff-file" aria-label="Diff of file src/App.cs">
        <div data-qa="bk-file__header"><input type="checkbox" checked /></div>
      </article>
      <article data-qa="branch-diff-file" aria-label="Diff of file README.md"></article>`;
    const storage = { getItem: () => '{"README.md":true,"src/Note.cs":true}' };
    const pr = { workspace: 'acme', repo: 'payments', prId: 7 };

    mountReviewGroups(document, pr, storage);

    expect(document.querySelector('.bbrd-review h3').textContent).toBe('Review path');
    expect(document.querySelector('.bbrd-info').getAttribute('title')).toMatch(/File hide rules pause/);
    const buttons = [...document.querySelectorAll('.bbrd-group')];
    expect(buttons.map((button) => button.querySelector('.bbrd-group-name').textContent)).toEqual([
      'Infrastructure',
      'Business',
      'Tests',
      'Documentation',
    ]);
    const infrastructure = document.querySelector('[data-group="infrastructure"]');
    expect(infrastructure.querySelector('.bbrd-add').textContent).toBe('+4,877');
    expect(infrastructure.querySelector('.bbrd-del').textContent).toBe('−2');
    const opened = [];
    for (const link of document.querySelectorAll('a[href*="#chg-"]')) {
      link.addEventListener('click', () => opened.push(link.getAttribute('href')));
    }
    const nextUnviewedSwitch = document.querySelector('.bbrd-review-next');
    nextUnviewedSwitch.click();
    expect(nextUnviewedSwitch.checked).toBe(true);
    expect(nextUnviewedSwitch.closest('.bbrd-switch').classList.contains('is-on')).toBe(true);
    expect(nextUnviewedSwitch.title).toBe('Open src/appsettings.json');
    expect(opened).toEqual(['#chg-src/appsettings.json']);
    expect(document.querySelector('a[href="#chg-src/App.cs"]').closest('li').classList.contains('bbrd-group-hidden')).toBe(true);
    expect(document.querySelector('a[href="#chg-src/appsettings.json"]').closest('li').classList.contains('bbrd-group-hidden')).toBe(false);
    nextUnviewedSwitch.click();
    expect(nextUnviewedSwitch.checked).toBe(false);
    expect(document.querySelector('.bbrd-group-hidden')).toBeNull();
    const docs = document.querySelector('[data-group="docs"]');
    expect(docs.dataset.done).toBe('true');
    expect(docs.querySelector('.bbrd-group-viewed').textContent).toBe('Done');
    const business = document.querySelector('[data-group="business"]');
    expect(business.dataset.done).toBe('true');
    expect(business.querySelector('.bbrd-add').textContent).toBe('+22');
    expect(document.querySelector('[data-group="tests"]').disabled).toBe(true);

    document.querySelector('[data-group="infrastructure"]').click();
    expect(document.querySelector('a[href="#chg-src/appsettings.json"]').closest('li').classList.contains('bbrd-group-hidden')).toBe(false);
    expect(document.querySelector('a[href="#chg-src/App.cs"]').closest('li').classList.contains('bbrd-group-hidden')).toBe(true);
    expect(document.querySelector('a[href="#chg-README.md"]').closest('li').classList.contains('bbrd-group-hidden')).toBe(true);
    expect(document.querySelector('article[aria-label="Diff of file src/App.cs"]').classList.contains('bbrd-group-hidden')).toBe(true);
    expect(document.querySelector('#file-tree > li').classList.contains('bbrd-group-hidden')).toBe(false);

    document.querySelector('[data-group="docs"]').click();
    expect(document.querySelector('#file-tree > li').classList.contains('bbrd-group-hidden')).toBe(true);
    expect(document.querySelector('a[href="#chg-README.md"]').closest('li').classList.contains('bbrd-group-hidden')).toBe(false);

    document.querySelector('[data-group="docs"]').click();
