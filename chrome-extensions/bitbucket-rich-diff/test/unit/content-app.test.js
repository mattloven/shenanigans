import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RichDiffApp } from '../../src/content/index.js';
import { DEFAULT_SETTINGS } from '../../src/core/settings.js';

const fileArticle = (path) => `
  <article data-qa="branch-diff-file" aria-label="Diff of file ${path}">
    <div>
      <div data-qa="bk-file__header"><div><h2 data-qa="bk-filepath">${path}</h2></div><div data-qa="bk-file__actions">⋯</div></div>
      <div><div><div data-qa="bk-file__content">diff lines</div></div></div>
    </div>
  </article>`;

function fakeClient(files) {
  return {
    getDiffstat: vi.fn(async () =>
      Object.keys(files).map((path) => ({
        status: 'modified',
        old: { path, url: `old/${path}`, repoFullName: 'acme/repo', commit: 'aaa' },
        new: { path, url: `new/${path}`, repoFullName: 'acme/repo', commit: 'bbb' },
      })),
    ),
    getFileText: vi.fn(async (side) => files[side.path][side.url.startsWith('old/') ? 0 : 1]),
  };
}

async function until(assertion, timeout = 1000) {
  const start = Date.now();
  for (;;) {
    try {
      return assertion();
    } catch (error) {
      if (Date.now() - start > timeout) throw error;
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

describe('RichDiffApp', () => {
  let app;
  const location = { href: 'https://bitbucket.org/acme/repo/pull-requests/1/diff', origin: 'https://bitbucket.org' };

  beforeEach(() => {
    document.body.innerHTML = `<main>${fileArticle('README.md')}${fileArticle('app.js')}${fileArticle('package.json')}</main>`;
  });

  afterEach(() => app?.stop());

  const start = (settings = DEFAULT_SETTINGS, files = { 'README.md': ['# A\n\nold text\n', '# A\n\nnew text\n'], 'package.json': ['{"v":1}', '{"v":2}'] }) => {
    const client = fakeClient(files);
    app = new RichDiffApp({ root: document, location, client, settings });
    app.start();
    return client;
  };

  const article = (path) => document.querySelector(`article[aria-label="Diff of file ${path}"]`);
  const shadow = (path) => article(path).querySelector('.bbrd-host').shadowRoot;

  it('injects tabs only for supported files', () => {
    start();
    expect(article('README.md').querySelectorAll('.bbrd-tab')).toHaveLength(3);
    expect(article('package.json').querySelectorAll('.bbrd-tab')).toHaveLength(3);
    expect(article('app.js').querySelector('.bbrd-tabs')).toBeNull();
  });

  it('renders the default view from fetched file versions, fetching diffstat once', async () => {
    const client = start();
    expect(article('README.md').dataset.bbrdView).toBe('changes');
    await until(() => expect(shadow('README.md').querySelector('del.bbrd-del').textContent).toBe('old'));
    await until(() => expect(shadow('package.json').querySelector('.jd-sum-path').textContent).toBe('v'));
    expect(client.getDiffstat).toHaveBeenCalledTimes(1);
  });

  it('respects the configured default view and disabled types', async () => {
    const client = start({ ...DEFAULT_SETTINGS, markdown: { enabled: true, defaultView: 'diff' }, json: { enabled: false, defaultView: 'changes' } });
    expect(article('README.md').dataset.bbrdView).toBe('diff');
    expect(article('README.md').querySelector('.bbrd-host').hidden).toBe(true);
    expect(article('package.json').querySelector('.bbrd-tabs')).toBeNull();
    expect(client.getFileText).not.toHaveBeenCalled();
  });

  it('keeps tab clicks from reaching the Bitbucket header', () => {
    start();
    const onHeaderClick = vi.fn();
    article('README.md').querySelector('[data-qa="bk-file__header"]').addEventListener('click', onHeaderClick);
    article('README.md').querySelector('.bbrd-tab[data-view="preview"]').click();
    expect(onHeaderClick).not.toHaveBeenCalled();
    expect(article('README.md').dataset.bbrdView).toBe('preview');
  });

  it('remembers the chosen view when Bitbucket re-renders the article', async () => {
    start();
    article('README.md').querySelector('.bbrd-tab[data-view="preview"]').click();
    const replacement = document.createElement('div');
    replacement.innerHTML = fileArticle('README.md');
    article('README.md').replaceWith(replacement.firstElementChild);
    app.scan();
    expect(article('README.md').dataset.bbrdView).toBe('preview');
  });

  it('shows an error with a way back to the standard diff when loading fails', async () => {
    const client = start({ ...DEFAULT_SETTINGS, markdown: { enabled: true, defaultView: 'diff' }, json: { enabled: false, defaultView: 'diff' } });
    client.getDiffstat.mockRejectedValue(Object.assign(new Error('nope'), { status: 403 }));
    article('README.md').querySelector('.bbrd-tab[data-view="preview"]').click();
    await until(() => expect(shadow('README.md').querySelector('.bbrd-error').textContent).toMatch(/signed in/));
    shadow('README.md').querySelector('[data-action="show-diff"]').click();
    expect(article('README.md').dataset.bbrdView).toBe('diff');
  });

  it('removes everything when navigating away from the pull request', () => {
    start();
    location.href = 'https://bitbucket.org/acme/repo/src/main/';
    app.scan();
    expect(document.querySelector('.bbrd-tabs')).toBeNull();
    expect(article('README.md').hasAttribute('data-bbrd-view')).toBe(false);
    location.href = 'https://bitbucket.org/acme/repo/pull-requests/1/diff';
  });
});
