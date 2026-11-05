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
    expect([...parseReviewedState('{\"src/App.cs\":true,\"src/Skip.cs\":false}')]).toEqual(['src/App.cs']);
    expect([...parseReviewedState('{\"src/App.cs\":{\"reviewed\":true}}')]).toEqual(['src/App.cs']);
    expect([...parseReviewedState('[\"/src/App.cs\"]')]).toEqual(['src/App.cs']);
    expect(parseReviewedState('{}').size).toBe(0);
    expect(parseReviewedState('not json').size).toBe(0);
  });
});

describe('mountReviewGroups', () => {
  beforeEach(() => resetReviewGroup());

  it('filters the file list to the clicked group and turns a fully viewed group green', () => {
    document.body.innerHTML = `
      <section class=\"bbrd-stats\"></section>
      <ul id=\"file-tree\">
        <li>
          <button type=\"button\"><span aria-label=\"Directory\"></span><span>src</span></button>
          <ul>
            <li><a href=\"#chg-src/App.cs\">App.cs</a></li>
            <li><a href=\"#chg-src/appsettings.json\">appsettings.json <span>+</span><span>12</span><span>12 lines added, 2 lines removed</span></a></li>
            <li><a href=\"#chg-package-lock.json\"><span>+</span><span>4,865</span><span>4,865 lines added</span></a></li>
            <li><a href=\"#chg-src/Note.cs\"><span>+</span><span>22</span><span>22 lines added</span></a></li>
          </ul>
        </li>
        <li><a href=\"#chg-README.md\">README.md</a></li>
      </ul>
      <article data-qa=\"branch-diff-file\" aria-label=\"Diff of file src/App.cs\">
        <div data-qa=\"bk-file__header\"><input type=\"checkbox\" checked /></div>
      </article>
      <article data-qa=\"branch-diff-file\" aria-label=\"Diff of file README.md\"></article>`;
    const storage = { getItem: () => '{\"README.md\":true,\"src/Note.cs\":true}' };
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
    const infrastructure = document.querySelector('[data-group=\"infrastructure\"]');
    expect(infrastructure.querySelector('.bbrd-add').textContent).toBe('+4,877');
    expect(infrastructure.querySelector('.bbrd-del').textContent).toBe('−2');
    const opened = [];
    for (const link of document.querySelectorAll('a[href*=\"#chg-\"]')) {
      link.addEventListener('click', () => opened.push(link.getAttribute('href')));
    }
    const nextUnviewedSwitch = document.querySelector('.bbrd-review-next');
    nextUnviewedSwitch.click();
    expect(nextUnviewedSwitch.checked).toBe(true);
    expect(nextUnviewedSwitch.closest('.bbrd-switch').classList.contains('is-on')).toBe(true);
    expect(nextUnviewedSwitch.title).toBe('Open src/appsettings.json');
    expect(opened).toEqual(['#chg-src/appsettings.json']);
    expect(document.querySelector('a[href=\"#chg-src/App.cs\"]').closest('li').classList.contains('bbrd-group-hidden')).toBe(true);
    expect(document.querySelector('a[href=\"#chg-src/appsettings.json\"]').closest('li').classList.contains('bbrd-group-hidden')).toBe(false);
    nextUnviewedSwitch.click();
    expect(nextUnviewedSwitch.checked).toBe(false);
    expect(document.querySelector('.bbrd-group-hidden')).toBeNull();
    const docs = document.querySelector('[data-group=\"docs\"]');
    expect(docs.dataset.done).toBe('true');
    expect(docs.querySelector('.bbrd-group-viewed').textContent).toBe('Done');
    const business = document.querySelector('[data-group=\"business\"]');
    expect(business.dataset.done).toBe('true');
    expect(business.querySelector('.bbrd-add').textContent).toBe('+22');
    expect(document.querySelector('[data-group=\"tests\"]').disabled).toBe(true);

    document.querySelector('[data-group=\"infrastructure\"]').click();
    expect(document.querySelector('a[href=\"#chg-src/appsettings.json\"]').closest('li').classList.contains('bbrd-group-hidden')).toBe(false);
    expect(document.querySelector('a[href=\"#chg-src/App.cs\"]').closest('li').classList.contains('bbrd-group-hidden')).toBe(true);
    expect(document.querySelector('a[href=\"#chg-README.md\"]').closest('li').classList.contains('bbrd-group-hidden')).toBe(true);
    expect(document.querySelector('article[aria-label=\"Diff of file src/App.cs\"]').classList.contains('bbrd-group-hidden')).toBe(true);
    expect(document.querySelector('#file-tree > li').classList.contains('bbrd-group-hidden')).toBe(false);

    document.querySelector('[data-group=\"docs\"]').click();
    expect(document.querySelector('#file-tree > li').classList.contains('bbrd-group-hidden')).toBe(true);
    expect(document.querySelector('a[href=\"#chg-README.md\"]').closest('li').classList.contains('bbrd-group-hidden')).toBe(false);

    document.querySelector('[data-group=\"docs\"]').click();
    expect(document.querySelector('.bbrd-group-hidden')).toBeNull();
    const continueButton = document.querySelector('.bbrd-review-continue');
    expect(continueButton.textContent).toBe('Continue to Infrastructure');
    continueButton.click();
    const infrastructureCard = document.querySelector('[data-group=\"infrastructure\"]');
    expect(infrastructureCard.getAttribute('aria-pressed')).toBe('true');
    expect(infrastructureCard.querySelector('.bbrd-group-state').textContent).toBe('Showing');
  });

  it('hides the section and clears a selected group', () => {
    document.body.innerHTML = `
      <section class=\"bbrd-stats\"></section>
      <ul id=\"file-tree\"><li><a href=\"#chg-README.md\">README.md</a></li></ul>`;
    const storage = { getItem: () => null };
    mountReviewGroups(document, null, storage);
    document.querySelector('[data-group=\"docs\"]').click();
    mountReviewGroups(document, null, storage, { hideReviewGroups: true });
    expect(document.querySelector('.bbrd-review')).toBeNull();
    expect(document.querySelector('.bbrd-group-hidden')).toBeNull();
  });
});

describe('review workflows', () => {
  beforeEach(() => resetReviewGroup());

  it('keeps the .NET sample and lets a path pattern claim a file first', () => {
    expect(normalizeWorkflowState(undefined, 'missing').activeReviewWorkflow).toBe('dotnet');
    expect(normalizeWorkflowState(undefined, 'dotnet').reviewWorkflows[0].name).toBe('.NET Workflow');
    expect(normalizeWorkflowState([{ id: 'dotnet', name: 'Renamed', groups: [{ id: 'bad id', name: '', color: 'blue', filter: 'nope', pattern: '' }] }], 'dotnet').reviewWorkflows[0].groups[0]).toMatchObject({
      id: 'badid',
      name: 'Group',
      color: '#1558bc',
      filterId: '',
    });
    const sample = dotnetWorkflow().groups;
    expect(assignGroup('src/Api.Tests/Api.Tests.csproj', sample)).toBe('tests');
    expect(assignGroup('src/Api.Tests/PaymentTests.cs', sample)).toBe('tests');
    expect(assignGroup('src/Api/Api.csproj', sample)).toBe('infrastructure');
    expect(assignGroup('serverless console/build.cake', sample)).toBe('infrastructure');
    expect(assignGroup('serverless console/src/Dockerfile.api', sample)).toBe('infrastructure');
    expect(assignGroup('infra/main.tf', sample)).toBe('infrastructure');
    expect(assignGroup('src/appsettings.Development.json', sample)).toBe('infrastructure');
    expect(assignGroup('.github/workflows/ci.yml', sample)).toBe('infrastructure');
    expect(assignGroup('package-lock.json', sample)).toBe('infrastructure');
    expect(assignGroup('CODEOWNERS', sample)).toBe('infrastructure');
    expect(assignGroup('.env.production', sample)).toBe('infrastructure');
    expect(assignGroup('config/production.env', sample)).toBe('infrastructure');
    expect(assignGroup('pnpm-lock.yaml', sample)).toBe('infrastructure');
    expect(assignGroup('assets/app.min.css', sample)).toBe('infrastructure');
    expect(assignGroup('src/Api/Api.g.i.cs', sample)).toBe('infrastructure');
    expect(assignGroup('src/Api/Dto.generated.cs', sample)).toBe('infrastructure');
    expect(assignGroup('README.md', sample)).toBe('docs');
    expect(assignGroup('docs/LICENSE', sample)).toBe('docs');
    expect(assignGroup('src/App.cs', sample)).toBe('business');
    const custom = [
      { id: 'sql', name: 'SQL', color: '#ae2e24', filter: 'pattern', pattern: String.raw`\\.sql$` },
      { id: 'other', name: 'Other', color: '#206a83', filter: 'rest', pattern: '' },
    ];
    expect(assignGroup('db/migrate.sql', custom)).toBe('sql');
    expect(assignGroup('src/App.cs', custom)).toBe('other');
  });

  it('shows the selected workflow and saves a new group', () => {
    document.body.innerHTML = `
      <section class=\"bbrd-stats\"></section>
      <ul id=\"file-tree\">
        <li><a href=\"#chg-db/migrate.sql\">migrate.sql</a></li>
        <li><a href=\"#chg-src/App.cs\">App.cs</a></li>
      </ul>`;
    const settings = {
      reviewWorkflows: [
        dotnetWorkflow(),
        {
          id: 'sql',
          name: 'SQL pass',
          groups: [
            { id: 'sql', name: 'SQL', color: '#ae2e24', filter: 'pattern', pattern: String.raw`\\.sql$` },
            { id: 'other', name: 'Other', color: '#206a83', filter: 'rest', pattern: '' },
          ],
        },
      ],
      activeReviewWorkflow: 'sql',
    };
    const saved = [];
    mountReviewGroups(document, null, { getItem: () => null }, settings, (patch) => saved.push(patch));
    expect(document.querySelector('.bbrd-workflow').value).toBe('sql');
    expect([...document.querySelectorAll('.bbrd-group-name')].map((node) => node.textContent)).toEqual(['SQL', 'Other']);
    expect(document.querySelector('[data-group=\"sql\"]').style.getPropertyValue('--bbrd-group-ink')).toBe('#ae2e24');
    document.querySelector('[data-group=\"sql\"]').click();
    expect(document.querySelector('a[href=\"#chg-src/App.cs\"]').closest('li').classList.contains('bbrd-group-hidden')).toBe(true);
    expect(document.querySelector('a[href=\"#chg-db/migrate.sql\"]').closest('li').classList.contains('bbrd-group-hidden')).toBe(false);

    document.querySelector('.bbrd-workflow-edit').click();
    const dialog = document.querySelector('.bbrd-dialog');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.querySelector('h2').textContent).toBe('Edit workflow');
    expect(document.querySelector('.bbrd-pattern').value).toBe(String.raw`\\.sql$`);
    document.querySelector('[data-act=\"add-group\"]').click();
    expect(saved.at(-1).reviewWorkflows.find((workflow) => workflow.id === 'sql').groups).toHaveLength(3);
    document.querySelectorAll('.bbrd-group-edit [data-act=\"up\"]')[1].click();
    const names = saved.at(-1).reviewWorkflows.find((workflow) => workflow.id === 'sql').groups.map((group) => group.name);
    expect(names[0]).toBe('Other');
  });
});
