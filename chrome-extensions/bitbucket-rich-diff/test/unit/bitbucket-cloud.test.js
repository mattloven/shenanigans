import { describe, expect, it, vi } from 'vitest';
import { createCloudClient, createUrlResolver, getFilePath, parsePrUrl, resolvePath, toSameOrigin } from '../../src/platform/bitbucket-cloud.js';
import { detectFileType } from '../../src/core/file-types.js';
import { normalizeSettings, DEFAULT_SETTINGS } from '../../src/core/settings.js';

const ORIGIN = 'https://bitbucket.org';

describe('parsePrUrl', () => {
  it('parses pull request urls with any sub-page', () => {
    expect(parsePrUrl('https://bitbucket.org/acme/payments/pull-requests/42/diff')).toEqual({ workspace: 'acme', repo: 'payments', prId: 42 });
    expect(parsePrUrl('https://bitbucket.org/acme/payments/pull-requests/42')).toEqual({ workspace: 'acme', repo: 'payments', prId: 42 });
    expect(parsePrUrl('https://bitbucket.org/acme/payments/pull-requests/42/overview?x=1#y').prId).toBe(42);
  });

  it('ignores other pages', () => {
    expect(parsePrUrl('https://bitbucket.org/acme/payments/src/main/README.md')).toBeNull();
    expect(parsePrUrl('https://bitbucket.org/acme/payments/pull-requests/')).toBeNull();
  });
});

describe('toSameOrigin', () => {
  it('maps api.bitbucket.org to the session-authenticated proxy', () => {
    expect(toSameOrigin('https://api.bitbucket.org/2.0/repositories/a/b/src/c/d', ORIGIN)).toBe('https://bitbucket.org/!api/2.0/repositories/a/b/src/c/d');
  });
});

describe('createCloudClient', () => {
  const jsonResponse = (body) => ({ ok: true, status: 200, json: async () => body, headers: new Headers() });

  it('follows diffstat pagination and extracts commits from file links', async () => {
    const side = (commit, p) => ({ path: p, links: { self: { href: `https://api.bitbucket.org/2.0/repositories/acme/payments/src/${commit}/${p}` } } });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ values: [{ status: 'modified', old: side('aaa', 'README.md'), new: side('bbb', 'README.md') }], next: 'https://api.bitbucket.org/2.0/page2' }))
      .mockResolvedValueOnce(jsonResponse({ values: [{ status: 'added', old: null, new: side('bbb', 'docs/new.md') }] }));
    const client = createCloudClient({ origin: ORIGIN, fetch });
    const entries = await client.getDiffstat({ workspace: 'acme', repo: 'payments', prId: 7 });

    expect(fetch.mock.calls[0][0]).toBe('https://bitbucket.org/!api/2.0/repositories/acme/payments/pullrequests/7/diffstat?pagelen=500');
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'include' });
    expect(fetch.mock.calls[1][0]).toBe('https://bitbucket.org/!api/2.0/page2');
    expect(entries).toEqual([
      {
        status: 'modified',
        old: { path: 'README.md', url: 'https://bitbucket.org/!api/2.0/repositories/acme/payments/src/aaa/README.md', repoFullName: 'acme/payments', commit: 'aaa' },
        new: { path: 'README.md', url: 'https://bitbucket.org/!api/2.0/repositories/acme/payments/src/bbb/README.md', repoFullName: 'acme/payments', commit: 'bbb' },
      },
      { status: 'added', old: null, new: { path: 'docs/new.md', url: 'https://bitbucket.org/!api/2.0/repositories/acme/payments/src/bbb/docs/new.md', repoFullName: 'acme/payments', commit: 'bbb' } },
    ]);
  });

  it('returns null for missing files and errors for auth failures', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 404 }).mockResolvedValueOnce({ ok: false, status: 403 });
    const client = createCloudClient({ origin: ORIGIN, fetch });
    const side = { path: 'a.md', url: 'u' };
    expect(await client.getFileText(side)).toBeNull();
    await expect(client.getFileText(side)).rejects.toMatchObject({ status: 403 });
    expect(await client.getFileText(null)).toBeNull();
  });

  it('refuses very large files', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-length': String(5 * 1024 * 1024) }), text: async () => '' });
    const client = createCloudClient({ origin: ORIGIN, fetch });
    await expect(client.getFileText({ path: 'big.json', url: 'u' })).rejects.toMatchObject({ status: 413 });
  });
});

describe('createUrlResolver', () => {
  const resolve = createUrlResolver({ path: 'docs/guide/README.md', repoFullName: 'acme/payments', commit: 'abc123' }, ORIGIN);

  it('maps relative images to raw and links to src at the commit', () => {
    expect(resolve('img/a b.png', 'image')).toBe('https://bitbucket.org/acme/payments/raw/abc123/docs/guide/img/a%20b.png');
    expect(resolve('../runbook.md#top', 'link')).toBe('https://bitbucket.org/acme/payments/src/abc123/docs/runbook.md#top');
    expect(resolve('/LICENSE', 'link')).toBe('https://bitbucket.org/acme/payments/src/abc123/LICENSE');
  });

  it('leaves absolute urls, anchors and other schemes alone', () => {
    for (const url of ['https://x.io/a.png', '//cdn.io/a.png', '#section', 'mailto:a@b.c', 'data:image/png;base64,AA']) {
      expect(resolve(url, 'image')).toBe(url);
    }
  });

  it('is undefined without revision info', () => {
    expect(createUrlResolver(null, ORIGIN)).toBeUndefined();
  });

  it('normalises dot segments', () => {
    expect(resolvePath('a/b/', './c/../d.md')).toBe('a/b/d.md');
    expect(resolvePath('a/', '../../x.md')).toBe('x.md');
  });
});

describe('getFilePath', () => {
  const make = (label, h2) => {
    const el = document.createElement('article');
    if (label) el.setAttribute('aria-label', label);
    el.innerHTML = `<h2 data-qa="bk-filepath">${h2 || ''}</h2>`;
    return el;
  };

  it('reads the path from the aria-label', () => {
    expect(getFilePath(make('Diff of file .changes/next/patch.json'))).toBe('.changes/next/patch.json');
  });

  it('uses the new path for renames and falls back to the heading', () => {
    expect(getFilePath(make('Diff of file old.md → docs/new.md'))).toBe('docs/new.md');
    expect(getFilePath(make(null, '<span>docs</span><span>/</span><span>a.md</span>'))).toBe('docs/a.md');
  });
});

describe('detectFileType', () => {
  it('recognises markdown and json variants', () => {
    expect(detectFileType('README.md')).toBe('markdown');
    expect(detectFileType('docs/x.MARKDOWN')).toBe('markdown');
    expect(detectFileType('tsconfig.json')).toBe('json');
    expect(detectFileType('.vscode/settings.jsonc')).toBe('json');
    expect(detectFileType('app.js')).toBeNull();
    expect(detectFileType(null)).toBeNull();
  });
});

describe('normalizeSettings', () => {
  it('fills defaults and drops invalid values', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ hideSummaryComments: true, collapseSummaryComments: true }).collapseSummaryComments).toBe(false);
    expect(normalizeSettings({ markdown: { enabled: false, defaultView: 'bogus' }, onlyChanges: 'yes' })).toEqual({
      ...DEFAULT_SETTINGS,
      markdown: { enabled: false, defaultView: 'changes' },
    });
  });
});
