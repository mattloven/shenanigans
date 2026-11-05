import DOMPurify from 'dompurify';
import { formatCount } from '../core/file-filter.js';
import { VIEWS } from '../core/file-types.js';
import { buildView, errorHtml } from './build-view.js';
import { getContent, getHeader } from '../platform/bitbucket-cloud.js';
import { PREVIEW_LAYOUTS } from '../core/settings.js';
import panelCss from '../styles/panel.css';

const ATTR_VIEW = 'data-bbrd-view';
const STOP_EVENTS = ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'keydown', 'keyup'];

/**
 * Owns the tab bar and rich panel for one file diff article.
 */
export class FileView {
  /**
   * @param {HTMLElement} article
   * @param {{ path: string, type: import('../core/file-types.js').RichFileType,
   *   context: import('./pr-context.js').PrContext, settings: import('../core/settings.js').Settings }} opts
   */
  constructor(article, { path, type, context, settings }) {
    this.article = article;
    this.path = path;
    this.type = type;
    this.context = context;
    this.settings = settings;
    this.view = context.chosenViews.get(path) || settings[type].defaultView;
    this.data = null;
    this.loading = null;
    this.renderToken = 0;
    this.changeIndex = -1;
    this.tabs = this.createTabs();
    this.host = this.createHost();
  }

  /** Re-attaches UI after Bitbucket re-renders parts of the article. Safe to call repeatedly. */
  mount() {
    const header = getHeader(this.article);
    if (header && !header.contains(this.tabs)) {
      const actions = header.lastElementChild;
      header.insertBefore(this.tabs, actions);
    }
    if (header) this.host.style.setProperty('--bbrd-sticky-top', `${stickyOffset(header)}px`);
    const content = getContent(this.article);
    if (content && content.previousElementSibling !== this.host) {
      content.parentElement.insertBefore(this.host, content);
    }
    if (this.article.getAttribute(ATTR_VIEW) !== this.view) this.applyView();
  }

  destroy() {
    this.tabs.remove();
    this.host.remove();
    this.article.removeAttribute(ATTR_VIEW);
  }

  isMounted() {
    const header = getHeader(this.article);
    const content = getContent(this.article);
    return (!header || header.contains(this.tabs)) && (!content || content.previousElementSibling === this.host);
  }

  createTabs() {
    const bar = document.createElement('div');
    bar.className = 'bbrd-tabs';
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', `View for ${this.path}`);
    for (const view of VIEWS[this.type]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bbrd-tab';
      button.setAttribute('role', 'tab');
      button.dataset.view = view.id;
      button.title = view.title;
      button.textContent = view.label;
      bar.append(button);
    }
    // The Bitbucket file header toggles collapse on click; keep our interactions to ourselves.
    for (const name of STOP_EVENTS) bar.addEventListener(name, (e) => e.stopPropagation());
    bar.addEventListener('click', (e) => {
      const button = e.target.closest('.bbrd-tab');
      if (!button) return;
      this.setView(button.dataset.view);
    });
    bar.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const ids = VIEWS[this.type].map((v) => v.id);
      const next = ids[(ids.indexOf(this.view) + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
      this.setView(next);
      bar.querySelector(`[data-view="${next}"]`).focus();
    });
    return bar;
  }

  createHost() {
    const host = document.createElement('div');
    host.className = 'bbrd-host';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = panelCss;
    this.panel = document.createElement('div');
    this.panel.className = 'panel';
    this.panel.innerHTML = '<div class="toolbar" hidden></div><div class="body"></div>';
    shadow.append(style, this.panel);
    this.toolbar = this.panel.querySelector('.toolbar');
    this.body = this.panel.querySelector('.body');
    this.panel.addEventListener('click', (e) => this.onPanelClick(e));
    // `toggle` does not bubble, so listen in the capture phase.
    this.panel.addEventListener('toggle', (e) => this.mirrorToggle(e.target), true);
    this.panel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.closest?.('[data-target-path]')) this.onPanelClick(e);
    });
    return host;
  }

  setView(view) {
    if (view === this.view) return;
    this.view = view;
    this.context.chosenViews.set(this.path, view);
    this.applyView();
  }

  applySettings(settings) {
    this.settings = settings;
    this.changeIndex = -1;
    this.updatePanelClasses();
    this.updateCounter();
  }

  applyView() {
    this.article.setAttribute(ATTR_VIEW, this.view);
    for (const tab of this.tabs.querySelectorAll('.bbrd-tab')) {
      const selected = tab.dataset.view === this.view;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    this.host.hidden = this.view === 'diff';
    if (this.view !== 'diff') this.render();
  }

  async render() {
    const token = ++this.renderToken;
    const view = this.view;
    if (!this.data) {
      this.toolbar.hidden = true;
      this.body.innerHTML = '<div class="bbrd-loading" role="status"><span class="spinner"></span>Loading file versions…</div>';
      try {
        this.loading ??= this.context.loadFile(this.path);
        this.data = await this.loading;
      } catch (error) {
        this.loading = null;
        if (token === this.renderToken) this.showError(describeLoadError(error));
        return;
      }
    }
    if (token !== this.renderToken || view !== this.view) return;
    let built;
    try {
      built = buildView(this.type, view, this.data);
    } catch (error) {
      this.showError(error.message);
      return;
    }
    this.renderToolbar(built);
    this.body.innerHTML = sanitize(built.html);
    this.changeIndex = -1;
    this.updatePanelClasses();
    this.updateCounter();
  }

  showError(message) {
    this.toolbar.hidden = false;
    this.toolbar.innerHTML = '<span class="spacer"></span><button type="button" class="btn" data-action="retry">Retry</button><button type="button" class="btn" data-action="show-diff">Show standard diff</button>';
    this.body.innerHTML = errorHtml(message);
  }

  renderToolbar(built) {
    const parts = [];
    if (built.stats) {
      const { added, removed, modified } = built.stats;
      parts.push(
        `<span class="stats" aria-label="${formatCount(added)} added, ${formatCount(removed)} removed, ${formatCount(modified)} changed">` +
          `<span class="chip chip--ins${added ? '' : ' is-zero'}" title="Added">+${formatCount(added)}</span>` +
          `<span class="chip chip--del${removed ? '' : ' is-zero'}" title="Removed">−${formatCount(removed)}</span>` +
          `<span class="chip chip--mod${modified ? '' : ' is-zero'}" title="Changed">~${formatCount(modified)}</span></span>`,
      );
    }
    for (const note of built.notes) parts.push(`<span class="note">${escapeText(note)}</span>`);
    parts.push('<span class="spacer"></span>');
    if (built.navigable) {
      parts.push(
        `<label class="toggle"><input type="checkbox" data-setting="showDeletions"${this.settings.showDeletions ? ' checked' : ''}> Show deletions</label>`,
        `<label class="toggle"><input type="checkbox" data-setting="onlyChanges"${this.settings.onlyChanges ? ' checked' : ''}> Only changes</label>`,
        '<span class="nav"><button type="button" class="btn icon" data-action="prev" title="Previous change" aria-label="Previous change">↑</button>' +
          '<span class="counter" aria-live="polite"></span>' +
          '<button type="button" class="btn icon" data-action="next" title="Next change" aria-label="Next change">↓</button></span>',
      );
    }
    if (built.compare) {
      const layouts = [
        ['old', 'Old', this.data.oldText !== null],
        ['new', 'New', this.data.newText !== null],
        ['split', 'Side by side', this.data.oldText !== null && this.data.newText !== null],
      ];
      parts.push(
        `<span class="seg" role="radiogroup" aria-label="Preview layout">${layouts
          .map(([id, label, available]) => `<button type="button" class="seg-btn" role="radio" data-layout="${id}"${available ? '' : ' disabled'}>${label}</button>`)
          .join('')}</span>`,
      );
    }
    if (built.tree) {
      parts.push('<button type="button" class="btn" data-action="expand">Expand all</button><button type="button" class="btn" data-action="collapse">Collapse all</button>');
    }
    this.toolbar.innerHTML = parts.join('');
    this.toolbar.hidden = false;
    for (const input of this.toolbar.querySelectorAll('input[data-setting]')) {
      input.addEventListener('change', () => {
        this.settings = { ...this.settings, [input.dataset.setting]: input.checked };
        this.changeIndex = -1;
        this.updatePanelClasses();
        this.updateCounter();
        this.onSettingChanged?.(input.dataset.setting, input.checked);
      });
    }
  }

  /** The stored layout, falling back to the only existing version for added/deleted files. */
  effectiveLayout() {
    if (this.data?.oldText === null) return 'new';
    if (this.data?.newText === null) return 'old';
    return this.settings.previewLayout;
  }

  updatePanelClasses() {
    this.panel.classList.toggle('hide-deletions', !this.settings.showDeletions);
    this.panel.classList.toggle('only-changes', this.settings.onlyChanges);
    const layout = this.effectiveLayout();
    for (const id of PREVIEW_LAYOUTS) this.panel.classList.toggle(`layout-${id}`, id === layout);
    for (const btn of this.toolbar.querySelectorAll('[data-layout]')) btn.setAttribute('aria-checked', String(btn.dataset.layout === layout));
    for (const input of this.toolbar.querySelectorAll('input[data-setting]')) input.checked = Boolean(this.settings[input.dataset.setting]);
  }

  visibleChanges() {
    if (this.settings.showDeletions) return [...this.body.querySelectorAll('[data-bbrd-change]')];
    // A replacement is anchored on its deleted half; with deletions hidden, its inserted half
    // (marked data-bbrd-alt) stands in.
    return [...this.body.querySelectorAll('[data-bbrd-change], [data-bbrd-alt]')].filter((el) => !isDeletion(el));
  }

  updateCounter() {
    const counter = this.toolbar.querySelector('.counter');
    if (!counter) return;
    const total = this.visibleChanges().length;
    counter.textContent = total === 0 ? 'No changes' : this.changeIndex < 0 ? `${total} change${total === 1 ? '' : 's'}` : `${this.changeIndex + 1} / ${total}`;
    for (const btn of this.toolbar.querySelectorAll('[data-action="prev"], [data-action="next"]')) btn.disabled = total === 0;
  }

  onPanelClick(e) {
    const layoutButton = e.target.closest('[data-layout]');
    if (layoutButton && !layoutButton.disabled) {
      this.settings = { ...this.settings, previewLayout: layoutButton.dataset.layout };
      this.updatePanelClasses();
      this.onSettingChanged?.('previewLayout', layoutButton.dataset.layout);
      return;
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action) {
      switch (action) {
        case 'prev':
        case 'next':
          this.goToChange(action === 'next' ? 1 : -1);
          break;
        case 'expand':
        case 'collapse':
          for (const d of this.body.querySelectorAll('details')) d.open = action === 'expand';
          break;
        case 'retry':
          this.context.refresh();
          this.data = null;
          this.render();
          break;
        case 'show-diff':
          this.setView('diff');
          break;
        default:
          break;
      }
      return;
    }
    const foldToggle = e.target.closest('.bbrd-fold-toggle');
    if (foldToggle) {
      foldToggle.parentElement.classList.add('is-open');
      return;
    }
    const target = e.target.closest('[data-target-path]');
    if (target) {
      const path = target.dataset.targetPath;
      const row = [...this.body.querySelectorAll('.jd [data-path]')].find((el) => el.dataset.path === path);
      if (row) this.reveal(row);
    }
  }

  /** Keeps the same JSON node expanded/collapsed in both side-by-side panes. */
  mirrorToggle(details) {
    if (details.tagName !== 'DETAILS') return;
    const pane = details.closest('.cmp-pane');
    const path = details.querySelector(':scope > summary')?.dataset.path;
    if (!pane || path === undefined) return;
    const other = this.body.querySelector(`.cmp-pane:not(.cmp-pane--${pane.classList.contains('cmp-pane--old') ? 'old' : 'new'})`);
    const twin = other && [...other.querySelectorAll('details > summary[data-path]')].find((s) => s.dataset.path === path)?.parentElement;
    if (twin && twin.open !== details.open) twin.open = details.open;
  }

  goToChange(direction) {
    const changes = this.visibleChanges();
    if (changes.length === 0) return;
    this.changeIndex = this.changeIndex < 0 && direction < 0 ? changes.length - 1 : (this.changeIndex + direction + changes.length) % changes.length;
    this.reveal(changes[this.changeIndex]);
    this.updateCounter();
  }

  reveal(el) {
    for (let node = el.parentElement; node && node !== this.body; node = node.parentElement) {
      if (node.tagName === 'DETAILS') node.open = true;
      if (node.classList.contains('bbrd-fold')) node.classList.add('is-open');
    }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('bbrd-flash');
    void el.offsetWidth;
    el.classList.add('bbrd-flash');
  }
}

/** The file header is sticky inside Bitbucket's scroll container; our toolbar sticks below it. */
function stickyOffset(header) {
  const cs = getComputedStyle(header);
  if (cs.position !== 'sticky') return 0;
  return (parseFloat(cs.top) || 0) + header.offsetHeight;
}

function isDeletion(el) {
  return el.matches('.bbrd-blk--del, .bbrd-el--del, .jd-row--removed');
}

function describeLoadError(error) {
  if (error?.status === 401 || error?.status === 403) return 'Bitbucket refused access to the file contents. Make sure you are signed in and can view this repository.';
  return error?.message || String(error);
}

function escapeText(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function sanitize(html) {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'loading', 'open'],
    FORBID_TAGS: ['style', 'form'],
  });
}
