import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RichDiffApp } from '../../src/content/index.js';
import { HEAVY_FILE_CHARS } from '../../src/content/file-view.js';
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

  afterEach(() => {
    app?.stop();
    delete globalThis.IntersectionObserver;
  });

  const start = (settings = DEFAULT_SETTINGS, files = { 'README.md': ['# A\n\nold text\n', '# A\n\nnew text\n'], 'package.json': ['{"v":1}', '{"v":2}'] }) => {
    const client = fakeClient(files);
    app = new RichDiffApp({ root: document, location, client, settings });
    app.start();
    return client;
  };

  const article = (path) => document.querySelector(`article[aria-label="Diff of file ${path}"]`);
  const shadow = (path) => article(path).querySelector('.bbrd-host').shadowRoot;
  const openRich = (path, view = 'changes') => article(path).querySelector(`.bbrd-tab[data-view="${view}"]`).click();

  it('injects tabs only for supported files', () => {
    start();
    expect(article('README.md').querySelectorAll('.bbrd-tab')).toHaveLength(3);
    expect(article('package.json').querySelectorAll('.bbrd-tab')).toHaveLength(3);
    expect(article('app.js').querySelector('.bbrd-tabs')).toBeNull();
  });

  it('does not fetch or build a rich panel until Rich Diff is opened', async () => {
    const client = start();
    expect(article('README.md').dataset.bbrdView).toBe('diff');
    expect(article('package.json').dataset.bbrdView).toBe('diff');
    expect(article('README.md').querySelector('.bbrd-host').hidden).toBe(true);
    expect(article('package.json').querySelector('.bbrd-host').hidden).toBe(true);
    expect(client.getDiffstat).not.toHaveBeenCalled();
    expect(client.getFileText).not.toHaveBeenCalled();
    expect(shadow('README.md').querySelector('.markdown-body')).toBeNull();
    expect(shadow('package.json').querySelector('.jd')).toBeNull();
  });

  it('renders the rich view once opened, fetching diffstat once', async () => {
    const client = start();
    openRich('README.md');
    openRich('package.json');
    expect(article('README.md').querySelector('.bbrd-tab[data-view="changes"]').getAttribute('aria-selected')).toBe('true');
    await until(() => expect(shadow('README.md').querySelector('del.bbrd-del').textContent).toBe('old'));
    await until(() => expect(shadow('package.json').querySelector('.jd-sum-path').textContent).toBe('v'));
    expect(client.getDiffstat).toHaveBeenCalledTimes(1);
  });

  it('loads from a near-viewport intersection without a tab click', async () => {
    const observers = [];
    globalThis.IntersectionObserver = class {
      constructor(cb) {
        this.cb = cb;
      }
      observe() {
        observers.push(this);
      }
      disconnect() {}
    };
    const client = start();
    expect(client.getFileText).not.toHaveBeenCalled();
    for (const observer of observers) observer.cb([{ isIntersecting: true }]);
    await until(() => expect(shadow('README.md').querySelector('del.bbrd-del').textContent).toBe('old'));
  });

  it('defers parsing a heavy file discovered via the viewport until Rich Diff is selected', async () => {
    const observers = [];
    globalThis.IntersectionObserver = class {
      constructor(cb) {
        this.cb = cb;
      }
      observe() {
        observers.push(this);
      }
      disconnect() {}
    };
    const pad = 'x'.repeat(HEAVY_FILE_CHARS);
    const client = start(DEFAULT_SETTINGS, {
      'README.md': ['# A\n', '# B\n'],
      'package.json': [`{"v":1,"pad":"${pad}"}`, `{"v":2,"pad":"${pad}"}`],
    });
    for (const observer of observers) observer.cb([{ isIntersecting: true }]);
    await until(() => expect(client.getFileText.mock.calls.some((call) => call[0].path === 'package.json')).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(article('package.json').dataset.bbrdView).toBe('diff');
    expect(shadow('package.json').querySelector('.jd')).toBeNull();
    openRich('package.json');
    await until(() => expect(shadow('package.json').querySelector('.jd-sum-path').textContent).toBe('v'));
  });

  it('reattaches a cached rich panel after Bitbucket replaces the article without refetching', async () => {
    const client = start();
    openRich('README.md');
    await until(() => expect(shadow('README.md').querySelector('del.bbrd-del').textContent).toBe('old'));
    const fetches = client.getFileText.mock.calls.length;
    const replacement = document.createElement('div');
    replacement.innerHTML = fileArticle('README.md');
    article('README.md').replaceWith(replacement.firstElementChild);
    app.scan();
    await until(() => expect(shadow('README.md').querySelector('del.bbrd-del').textContent).toBe('old'));
    expect(client.getFileText.mock.calls.length).toBe(fetches);
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
    expect(article('README.md').querySelector('.bbrd-tab[data-view="preview"]').getAttribute('aria-selected')).toBe('true');
  });

  it('remembers the chosen view when Bitbucket re-renders the article', async () => {
    start();
    article('README.md').querySelector('.bbrd-tab[data-view="preview"]').click();
    const replacement = document.createElement('div');
    replacement.innerHTML = fileArticle('README.md');
    article('README.md').replaceWith(replacement.firstElementChild);
    app.scan();
    expect(article('README.md').querySelector('.bbrd-tab[data-view="preview"]').getAttribute('aria-selected')).toBe('true');
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
