import { createUrlResolver } from '../platform/bitbucket-cloud.js';

/**
 * Per-pull-request data access with caching. Diffstat is fetched once per PR view; file
 * contents are cached per revision URL. Built rich views are cached per path, view, and
 * content hash for the page session so MutationObserver remounts can reattach without
 * re-diffing.
 */
export class PrContext {
  /**
   * @param {import('../platform/bitbucket-cloud.js').PrRef} pr
   * @param {ReturnType<typeof import('../platform/bitbucket-cloud.js').createCloudClient>} client
   * @param {string} origin
   */
  constructor(pr, client, origin) {
    this.pr = pr;
    this.client = client;
    this.origin = origin;
    this.diffstat = null;
    this.texts = new Map();
    /** @type {Map<string, import('../core/file-types.js').ViewId>} view chosen per file this session */
    this.chosenViews = new Map();
    /** @type {Map<string, import('./build-view.js').BuiltView>} */
    this.viewCache = new Map();
  }

  refresh() {
    this.diffstat = null;
    this.texts.clear();
    this.viewCache.clear();
  }

  async findEntry(path) {
    if (!this.diffstat) this.diffstat = this.client.getDiffstat(this.pr);
    let entries;
    try {
      entries = await this.diffstat;
    } catch (error) {
      this.diffstat = null;
      throw error;
    }
    return entries.find((e) => e.new?.path === path) || entries.find((e) => e.old?.path === path) || null;
  }

  text(side) {
    if (!side) return Promise.resolve(null);
    if (!this.texts.has(side.url)) {
      const pending = this.client.getFileText(side).catch((error) => {
        this.texts.delete(side.url);
        throw error;
      });
      this.texts.set(side.url, pending);
    }
    return this.texts.get(side.url);
  }

  /**
   * @returns {Promise<{ entry: object, oldText: string | null, newText: string | null,
   *   resolveOldUrl?: Function, resolveNewUrl?: Function }>}
   */
  async loadFile(path) {
    const entry = await this.findEntry(path);
    if (!entry) throw new Error(`"${path}" is not part of this pull request's diff.`);
    const [oldText, newText] = await Promise.all([this.text(entry.old), this.text(entry.new)]);
    return {
      entry,
      oldText,
      newText,
      resolveOldUrl: createUrlResolver(entry.old, this.origin),
      resolveNewUrl: createUrlResolver(entry.new, this.origin),
    };
  }

  /** @param {string | null | undefined} oldText @param {string | null | undefined} newText */
  contentHash(oldText, newText) {
    return `${oldText?.length ?? 'n'}:${fingerprint(oldText)}:${newText?.length ?? 'n'}:${fingerprint(newText)}`;
  }

  viewCacheKey(path, view, hash) {
    return `${path}\0${view}\0${hash}`;
  }

  /**
   * @param {string} path
   * @param {string} view
   * @param {{ oldText: string | null, newText: string | null }} data
   * @returns {import('./build-view.js').BuiltView | null}
   */
  getCachedView(path, view, data) {
    return this.viewCache.get(this.viewCacheKey(path, view, this.contentHash(data.oldText, data.newText))) ?? null;
  }

  /**
   * @param {string} path
   * @param {string} view
   * @param {{ oldText: string | null, newText: string | null }} data
   * @param {import('./build-view.js').BuiltView} built
   */
  setCachedView(path, view, data, built) {
    this.viewCache.set(this.viewCacheKey(path, view, this.contentHash(data.oldText, data.newText)), built);
  }
}

/** Cheap content fingerprint for session cache keys (not cryptographic). */
function fingerprint(text) {
  if (text == null) return 'null';
  let hash = 2166136261;
  const step = Math.max(1, Math.floor(text.length / 4096));
  for (let i = 0; i < text.length; i += step) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= text.length;
  return (hash >>> 0).toString(36);
}
