/**
 * Bitbucket Cloud integration: URL parsing, REST access (through the same-origin `/!api/2.0`
 * proxy the Bitbucket web app itself uses, so the user's session cookie authorises requests)
 * and DOM lookup for the pull request "Files changed" view.
 */

const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * @typedef {object} PrRef
 * @property {string} workspace
 * @property {string} repo
 * @property {number} prId
 *
 * @typedef {object} FileSide
 * @property {string} path
 * @property {string} url        same-origin API url of the file contents
 * @property {string} repoFullName
 * @property {string} commit
 *
 * @typedef {object} DiffstatEntry
 * @property {'added' | 'removed' | 'modified' | 'renamed' | string} status
 * @property {FileSide | null} old
 * @property {FileSide | null} new
 */

/** @returns {PrRef | null} */
export function parsePrUrl(href) {
  const url = new URL(href);
  const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)(?:\/|$)/);
  if (!m) return null;
  return { workspace: decodeURIComponent(m[1]), repo: decodeURIComponent(m[2]), prId: Number(m[3]) };
}

export function prKey(pr) {
  return `${pr.workspace}/${pr.repo}#${pr.prId}`;
}

/**
 * @param {{ origin: string, fetch?: typeof fetch }} opts
 */
export function createCloudClient({ origin, fetch: fetchImpl = globalThis.fetch.bind(globalThis) }) {
  const apiBase = `${origin}/!api/2.0`;

  async function getJson(url) {
    const res = await fetchImpl(url, { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new ApiError(`Bitbucket API ${res.status} for ${url}`, res.status);
    return res.json();
  }

  return {
    /** @returns {Promise<DiffstatEntry[]>} */
    async getDiffstat(pr) {
      let url = `${apiBase}/repositories/${encodeURIComponent(pr.workspace)}/${encodeURIComponent(pr.repo)}/pullrequests/${pr.prId}/diffstat?pagelen=500`;
      const entries = [];
      while (url) {
        const page = await getJson(url);
        for (const value of page.values || []) entries.push(toEntry(value, origin));
        url = page.next ? toSameOrigin(page.next, origin) : null;
      }
      return entries;
    },

    /** @returns {Promise<string | null>} null when the file does not exist at that revision */
    async getFileText(side) {
      if (!side) return null;
      const res = await fetchImpl(side.url, { credentials: 'include' });
      if (res.status === 404) return null;
      if (!res.ok) throw new ApiError(`Could not load ${side.path} (${res.status})`, res.status);
      const length = Number(res.headers.get('content-length') || 0);
      if (length > MAX_FILE_BYTES) throw new ApiError(`${side.path} is too large to preview (${Math.round(length / 1024)} KB)`, 413);
      const text = await res.text();
      if (text.length > MAX_FILE_BYTES) throw new ApiError(`${side.path} is too large to preview`, 413);
      return text;
    },
  };
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function toEntry(value, origin) {
  return {
    status: value.status,
    old: toSide(value.old, origin),
    new: toSide(value.new, origin),
  };
}

function toSide(side, origin) {
  if (!side || !side.links?.self?.href) return null;
  const url = toSameOrigin(side.links.self.href, origin);
  const m = url.match(/\/repositories\/([^/]+\/[^/]+)\/src\/([^/]+)\//);
  return {
    path: side.path,
    url,
    repoFullName: m ? decodeURIComponent(m[1]) : '',
    commit: m ? m[2] : '',
  };
}

/** api.bitbucket.org links need a token; the same-origin proxy works with the session cookie. */
export function toSameOrigin(href, origin) {
  return href.replace(/^https:\/\/api\.bitbucket\.org\/2\.0/, `${origin}/!api/2.0`);
}

/**
 * Builds a resolver that maps relative markdown image/link URLs to the file's revision, so
 * repository images render and relative links open the right file.
 * @param {FileSide | null} side
 */
export function createUrlResolver(side, origin) {
  if (!side || !side.repoFullName || !side.commit) return undefined;
  const dir = side.path.includes('/') ? side.path.slice(0, side.path.lastIndexOf('/') + 1) : '';
  return (url, kind) => {
    if (!url || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)) return url;
    const [pathPart, suffix = ''] = splitSuffix(url);
    const resolved = resolvePath(dir, pathPart);
    const mode = kind === 'image' ? 'raw' : 'src';
    return `${origin}/${side.repoFullName}/${mode}/${side.commit}/${resolved.split('/').map(encodeURIComponent).join('/')}${suffix}`;
  };
}

function splitSuffix(url) {
  const i = url.search(/[?#]/);
  return i === -1 ? [url] : [url.slice(0, i), url.slice(i)];
}

export function resolvePath(dir, relative) {
  const base = relative.startsWith('/') ? [] : dir.split('/').filter(Boolean);
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') base.pop();
    else base.push(decodeURIComponentSafe(segment));
  }
  return base.join('/');
}

function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/* ----------------------------------------------------------------------------------------- */
/* DOM                                                                                        */
/* ----------------------------------------------------------------------------------------- */

export const SELECTORS = {
  file: 'article[data-qa="branch-diff-file"]',
  header: '[data-qa="bk-file__header"]',
  path: '[data-qa="bk-filepath"]',
  actions: '[data-qa="bk-file__actions"]',
  content: '[data-qa="bk-file__content"]',
};

export function findFileDiffs(root) {
  return [...root.querySelectorAll(SELECTORS.file)];
}

/** Path shown for a file diff; for renames Bitbucket labels the file with its new path last. */
export function getFilePath(article) {
  const label = article.getAttribute('aria-label') || '';
  const m = label.match(/^Diff of file (.+)$/);
  if (m) return lastPathOf(m[1]);
  const h2 = article.querySelector(SELECTORS.path);
  return h2 ? lastPathOf(h2.textContent.trim()) : null;
}

function lastPathOf(text) {
  const parts = text.split(/\s*(?:→|->|⟶|➔)\s*/);
  return parts[parts.length - 1].trim();
}

export function getHeader(article) {
  return article.querySelector(SELECTORS.header);
}

export function getContent(article) {
  return article.querySelector(SELECTORS.content);
}
