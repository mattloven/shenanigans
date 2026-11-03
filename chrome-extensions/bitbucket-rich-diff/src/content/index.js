import { detectFileType } from '../core/file-types.js';
import { loadSettings, onSettingsChanged, saveSettings } from '../core/settings.js';
import { createCloudClient, findFileDiffs, getFilePath, parsePrUrl, prKey } from '../platform/bitbucket-cloud.js';
import { updateCommentMasks } from './comment-mask.js';
import { FileView } from './file-view.js';
import { mountFileFilters } from './file-filters.js';
import { PrContext } from './pr-context.js';

/**
 * Watches the Bitbucket single-page app for pull request file diffs and attaches a FileView to
 * every markdown/JSON file.
 */
export class RichDiffApp {
  constructor({ root = document, location = window.location, client, settings }) {
    this.root = root;
    this.location = location;
    this.client = client;
    this.settings = settings;
    this.context = null;
    /** @type {Map<HTMLElement, FileView>} */
    this.views = new Map();
    this.scheduled = false;
    this.observer = new MutationObserver(() => this.schedule());
  }

  start() {
    this.stopped = false;
    this.observer.observe(this.root.body ?? this.root, { childList: true, subtree: true });
    this.scan();
  }

  stop() {
    this.stopped = true;
    this.observer.disconnect();
    for (const view of this.views.values()) view.destroy();
    this.views.clear();
  }

  schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      if (!this.stopped) this.scan();
    });
  }

  updateSettings(settings) {
    const typeToggled = settings.markdown.enabled !== this.settings.markdown.enabled || settings.json.enabled !== this.settings.json.enabled;
    this.settings = settings;
    if (typeToggled) {
      for (const view of this.views.values()) view.destroy();
      this.views.clear();
      this.scan();
      return;
    }
    for (const view of this.views.values()) view.applySettings(settings);
    this.applyPageFilters();
  }

  scan() {
    const pr = parsePrUrl(this.location.href);
    if (!pr) {
      if (this.views.size) this.stop();
      this.context = null;
      return;
    }
    if (!this.context || prKey(this.context.pr) !== prKey(pr)) {
      for (const view of this.views.values()) view.destroy();
      this.views.clear();
      this.context = new PrContext(pr, this.client, this.location.origin);
    }

    for (const [article, view] of this.views) {
      if (!article.isConnected) this.views.delete(article);
      else if (getFilePath(article) !== view.path) {
        view.destroy();
        this.views.delete(article);
      }
    }

    for (const article of findFileDiffs(this.root)) {
      const existing = this.views.get(article);
      if (existing) {
        if (!existing.isMounted()) existing.mount();
        continue;
      }
      const path = getFilePath(article);
      const type = detectFileType(path);
      if (!type || !this.settings[type].enabled) continue;
      const view = new FileView(article, { path, type, context: this.context, settings: this.settings });
      view.onSettingChanged = (key, value) => this.persistSetting(key, value);
      this.views.set(article, view);
      view.mount();
    }
    this.applyPageFilters();
  }

  applyPageFilters() {
    mountFileFilters(this.root, this.settings, (key, value) => this.persistSetting(key, value));
    updateCommentMasks(this.root, this.settings);
  }

  persistSetting(key, value) {
    this.settings = { ...this.settings, [key]: value };
    for (const view of this.views.values()) view.applySettings(this.settings);
    this.applyPageFilters();
    saveSettings(this.settings);
  }
}

async function main() {
  if (window.__bbrdLoaded) return;
  window.__bbrdLoaded = true;
  const settings = await loadSettings();
  const app = new RichDiffApp({ client: createCloudClient({ origin: window.location.origin }), settings });
  onSettingsChanged((next) => app.updateSettings(next));
  app.start();
}

if (typeof chrome !== 'undefined' && chrome.runtime?.id) main();
