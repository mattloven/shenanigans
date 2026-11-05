import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountFileFilters, resetHiddenReveal } from '../../src/content/file-filters.js';
import { mountReviewGroups, resetReviewGroup } from '../../src/content/review-groups.js';
import { DEFAULT_SETTINGS } from '../../src/core/settings.js';

function installPage() {
  document.body.innerHTML = `
    <aside class="sidebar">
      <div class="sidebar-head"><span data-qa="files-changed-count">2 files changed</span></div>
      <ul>
        <li><a href="#chg-README.md">README.md <span class="stat">3 lines added, 1 line removed</span></a></li>
        <li><a href="#chg-src/App.cs">src/App.cs <span class="stat">2 lines added</span></a></li>
      </ul>
    </aside>
    <section class="bbrd-stats"><div class="bbrd-stats-actions"></div></section>
    <div class="toolbar"><div class="right">
      <span data-qa="files-viewed-count">0 of 2 files viewed</span>
      <button type="button"><span>Global diff settings</span></button>
    </div></div>
    <article data-qa="branch-diff-file" aria-label="Diff of file README.md"></article>
    <article data-qa="branch-diff-file" aria-label="Diff of file src/App.cs"></article>`;
}

describe('mountFileFilters', () => {
  beforeEach(() => {
    resetHiddenReveal();
    resetReviewGroup();
    installPage();
  });

  it('puts one menu in the summary bar and drops copies left in the file list', () => {
    const stray = document.createElement('div');
    stray.className = 'bbrd-filters';
    document.querySelector('ul').before(stray);
    const onChange = vi.fn();

    mountFileFilters(document, DEFAULT_SETTINGS, onChange);
    mountFileFilters(document, DEFAULT_SETTINGS, onChange);

    expect(document.querySelectorAll('.bbrd-menu-host')).toHaveLength(1);
    expect(document.querySelectorAll('.bbrd-filters')).toHaveLength(1);
    expect(document.body.contains(stray)).toBe(false);
    expect(document.querySelector('.bbrd-filters').parentElement).toBe(document.body);
    expect(document.querySelector('.bbrd-filters').hidden).toBe(true);
    expect(document.querySelector('.bbrd-filters-head').textContent.trim()).toBe('Hide');
    expect(document.querySelector('.bbrd-comment-explain')).toBeNull();
    expect(document.querySelector('[data-filter="collapseSummaryComments"]').closest('label').textContent).toMatch(/Collapse summary comments/);
    expect(document.querySelector('[data-filter="hideReviewGroups"]').closest('label').textContent).toMatch(/Review path/);
    expect(document.querySelector('.bbrd-filters').lastElementChild.classList.contains('bbrd-filters-foot')).toBe(true);
    expect(document.querySelector('.bbrd-filters-foot').hidden).toBe(true);
    expect(document.querySelector('.bbrd-stats-actions').contains(document.querySelector('.bbrd-menu-host'))).toBe(true);
    expect(document.querySelector('.toolbar .bbrd-menu-host')).toBeNull();
    expect(document.querySelector('.sidebar .bbrd-filters')).toBeNull();
  });

  it('moves the same menu when the summary bar is re-rendered', () => {
    const onChange = vi.fn();
    mountFileFilters(document, DEFAULT_SETTINGS, onChange);

    const fresh = document.createElement('div');
    fresh.className = 'bbrd-stats-actions';
    document.querySelector('.bbrd-stats-actions').replaceWith(fresh);
    mountFileFilters(document, DEFAULT_SETTINGS, onChange);
    mountFileFilters(document, DEFAULT_SETTINGS, onChange);

    expect(document.querySelectorAll('.bbrd-menu-host')).toHaveLength(1);
    expect(document.querySelectorAll('.bbrd-filters')).toHaveLength(1);
    expect(fresh.contains(document.querySelector('.bbrd-menu-host'))).toBe(true);
    expect(document.querySelector('.toolbar .bbrd-menu-host')).toBeNull();
  });

  it('moves a summary that is still in the heading down to the bottom', () => {
    mountFileFilters(document, { ...DEFAULT_SETTINGS, hideMarkdown: true }, vi.fn());
    const foot = document.querySelector('.bbrd-filters-foot');
    foot.classList.remove('bbrd-filters-foot');
    foot.classList.add('bbrd-hidden-actions');
    document.querySelector('.bbrd-filters-head').append(foot);

    mountFileFilters(document, { ...DEFAULT_SETTINGS, hideMarkdown: true }, vi.fn());

    const moved = document.querySelector('.bbrd-filters-foot');
    expect(document.querySelector('.bbrd-filters').lastElementChild).toBe(moved);
    expect(document.querySelector('.bbrd-filters-head').textContent.trim()).toBe('Hide');
    expect(moved.querySelector('.bbrd-hidden-count').textContent).toMatch(/hidden/);
  });

  it('opens from the button, closes on an outside click, and saves a change', () => {
    const onChange = vi.fn();
    mountFileFilters(document, DEFAULT_SETTINGS, onChange);
    const button = document.querySelector('.bbrd-menu-button');
    const panel = document.querySelector('.bbrd-filters');

    button.click();
    expect(panel.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');

    const box = panel.querySelector('[data-filter="hideMarkdown"]');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onChange).toHaveBeenCalledWith('hideMarkdown', true);

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(panel.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('lets a review group replace the file filters and leaves the comment checkboxes on', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <ul id="file-tree" role="list">
        <li><button type="button"><span aria-label="Directory"></span><span>App.Tests</span></button>
          <ul role="list"><li><a href="#chg-src/App.Tests/ChargeTests.cs">ChargeTests.cs</a></li></ul>
        </li>
      </ul>`);
    const onChange = vi.fn();
    const settings = { ...DEFAULT_SETTINGS, hideMarkdown: true, hideTestFolders: true, hideCodeComments: true };
    const reapply = () => {
      mountFileFilters(document, settings, onChange);
      mountReviewGroups(document, null, { getItem: () => null });
    };
    document.addEventListener('bbrd-review-group', reapply);
    try {
      mountFileFilters(document, settings, onChange);
      mountReviewGroups(document, null, { getItem: () => null });
      expect(document.querySelector('a[href="#chg-README.md"]').closest('li').classList.contains('bbrd-file-hidden')).toBe(true);
      expect(document.querySelector('a[href="#chg-src/App.Tests/ChargeTests.cs"]').closest('li').classList.contains('bbrd-file-hidden')).toBe(true);

      document.querySelector('[data-group="tests"]').click();
      expect(document.querySelector('a[href="#chg-src/App.Tests/ChargeTests.cs"]').closest('li').classList.contains('bbrd-file-hidden')).toBe(false);
      expect(document.querySelector('a[href="#chg-src/App.Tests/ChargeTests.cs"]').closest('li').classList.contains('bbrd-group-hidden')).toBe(false);
      expect(document.querySelector('a[href="#chg-README.md"]').closest('li').classList.contains('bbrd-group-hidden')).toBe(true);
      expect(document.querySelector('[data-filter="hideMarkdown"]').disabled).toBe(true);
      expect(document.querySelector('[data-filter="hideTestFolders"]').disabled).toBe(true);
      expect(document.querySelector('[data-filter="hidePattern"]').disabled).toBe(true);
      expect(document.querySelector('[data-filter="hideCodeComments"]').disabled).toBe(false);
      expect(document.querySelector('[data-filter="hideCodeComments"]').checked).toBe(true);
      expect(document.querySelector('[data-filter="collapseSummaryComments"]').disabled).toBe(false);
      expect(document.querySelector('[aria-label="Directory"]').closest('button').querySelector('.bbrd-hidden-pill')).toBeNull();

      document.querySelector('[data-group="tests"]').click();
      expect(document.querySelector('a[href="#chg-README.md"]').closest('li').classList.contains('bbrd-file-hidden')).toBe(true);
      expect(document.querySelector('a[href="#chg-src/App.Tests/ChargeTests.cs"]').closest('li').classList.contains('bbrd-file-hidden')).toBe(true);
      expect(document.querySelector('[data-filter="hideMarkdown"]').disabled).toBe(false);
      expect(document.querySelector('[aria-label="Directory"]').closest('button').querySelector('.bbrd-hidden-pill')).not.toBeNull();
    } finally {
      document.removeEventListener('bbrd-review-group', reapply);
    }
  });

  it('unchecks and disables collapse while summary comments are hidden', () => {
    const onChange = vi.fn();
    mountFileFilters(document, { ...DEFAULT_SETTINGS, hideSummaryComments: true, collapseSummaryComments: true }, onChange);
    const collapse = document.querySelector('[data-filter="collapseSummaryComments"]');
    expect(collapse.checked).toBe(false);
    expect(collapse.disabled).toBe(true);
    expect(collapse.closest('label').classList.contains('bbrd-check-disabled')).toBe(true);

    mountFileFilters(document, { ...DEFAULT_SETTINGS, collapseSummaryComments: true }, onChange);
    const hide = document.querySelector('[data-filter="hideSummaryComments"]');
    expect(collapse.disabled).toBe(false);
    expect(collapse.checked).toBe(true);
    hide.checked = true;
    hide.dispatchEvent(new Event('change', { bubbles: true }));
    expect(collapse.checked).toBe(false);
    expect(collapse.disabled).toBe(true);
    expect(onChange).toHaveBeenCalledWith('hideSummaryComments', true);
  });

  it('hides matching files and keeps Show/Hide in the flyout, never the file tree', () => {
    const onChange = vi.fn();
    mountFileFilters(document, { ...DEFAULT_SETTINGS, hideMarkdown: true, hidePattern: '[' }, onChange);

    expect(document.querySelector('a[href="#chg-README.md"]').closest('li').classList.contains('bbrd-file-hidden')).toBe(true);
    expect(document.querySelector('article[aria-label="Diff of file README.md"]').classList.contains('bbrd-file-hidden')).toBe(true);
    expect(document.querySelector('a[href="#chg-src/App.cs"]').closest('li').classList.contains('bbrd-file-hidden')).toBe(false);
    expect(document.querySelector('.bbrd-filters-foot .bbrd-hidden-count').textContent).toBe('1 hidden · 1 doc +3 −1');
    expect(document.querySelector('.bbrd-filters-foot').hidden).toBe(false);
    expect(document.querySelector('.bbrd-filters-head').contains(document.querySelector('.bbrd-hidden-count'))).toBe(false);
    expect(document.querySelectorAll('.bbrd-hidden-bar')).toHaveLength(0);
    expect(document.querySelector('.sidebar .bbrd-hidden-toggle')).toBeNull();
    expect(document.querySelector('.bbrd-filters .bbrd-hidden-toggle').hidden).toBe(false);
    expect(document.querySelector('[data-qa="files-viewed-count"]').textContent).toBe('0 of 1 viewed · 2 files');
    expect(document.querySelector('[data-qa="files-viewed-count"]').dataset.bbrdViewedOriginal).toBe('0 of 2 files viewed');
    expect(document.querySelector('[data-qa="files-changed-count"]').textContent).toBe('1 of 2 files changed');
    expect(document.querySelector('[data-qa="files-changed-count"]').dataset.bbrdChangedOriginal).toBe('2 files changed');

    document.querySelector('.bbrd-filters .bbrd-hidden-toggle').click();
    expect(document.querySelector('a[href="#chg-README.md"]').closest('li').classList.contains('bbrd-file-hidden')).toBe(false);
    const readme = document.querySelector('a[href="#chg-README.md"]');
    expect(readme.firstElementChild.classList.contains('bbrd-cat')).toBe(true);
    expect(readme.firstElementChild.dataset.kind).toBe('docs');
    expect(readme.firstElementChild.textContent).toBe('Docs');
    expect(document.querySelector('[data-qa="files-viewed-count"]').textContent).toBe('0 of 2 files viewed');
    expect(document.querySelector('[data-qa="files-changed-count"]').textContent).toBe('2 files changed');

    document.querySelector('.bbrd-filters .bbrd-hidden-toggle').click();
    expect(document.querySelector('a[href="#chg-README.md"]').closest('li').classList.contains('bbrd-file-hidden')).toBe(true);
    expect(document.querySelector('a[href="#chg-README.md"]').closest('li').querySelector('.bbrd-cat')).toBeNull();
    expect(document.querySelector('[data-filter="hidePattern"]').getAttribute('aria-invalid')).toBe('true');

    document.querySelector('.bbrd-menu-button').click();
    const pattern = document.querySelector('[data-filter="hidePattern"]');
    pattern.focus();
    pattern.value = 'still typing';
    mountFileFilters(document, { ...DEFAULT_SETTINGS, hideMarkdown: true, hidePattern: '' }, onChange);
    expect(pattern.value).toBe('still typing');
    expect(document.querySelector('[data-qa="files-viewed-count"]').textContent).toBe('0 of 1 viewed · 2 files');
    expect(document.querySelector('[data-qa="files-viewed-count"]').dataset.bbrdViewedOriginal).toBe('0 of 2 files viewed');
    expect(document.querySelector('[data-qa="files-changed-count"]').textContent).toBe('1 of 2 files changed');

    const visible = document.querySelector('article[aria-label="Diff of file src/App.cs"]');
    const hidden = document.querySelector('article[aria-label="Diff of file README.md"]');
    visible.innerHTML = '<label><input type="checkbox" checked> Viewed</label>';
    hidden.innerHTML = '<label><input type="checkbox" checked> Viewed</label>';
    mountFileFilters(document, { ...DEFAULT_SETTINGS, hideMarkdown: true }, onChange);
    expect(document.querySelector('[data-qa="files-viewed-count"]').textContent).toBe('1 of 1 viewed · 2 files');
  });

  it('keeps a hidden folder in the tree and marks it with one pill', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <ul role="list" id="tree">
        <li>
          <button type="button"><span role="img" aria-label="Directory"></span><span>src</span></button>
          <ul role="list">
            <li>
              <button type="button"><span role="img" aria-label="Directory"></span><span>Payment.Tests</span></button>
              <ul role="list"><li><a href="#chg-src/Payment.Tests/ChargeTests.cs">ChargeTests.cs</a></li></ul>
            </li>
            <li><a href="#chg-src/App.cs">App.cs</a></li>
          </ul>
        </li>
      </ul>`);
    const onChange = vi.fn();
    const named = (name) => [...document.querySelectorAll('#tree button')].find((button) => [...button.querySelectorAll('span')].some((span) => span.textContent === name));
    const folder = () => named('Payment.Tests');
    const src = () => named('src');

    mountFileFilters(document, { ...DEFAULT_SETTINGS, hideTestFolders: true }, onChange);
    mountFileFilters(document, { ...DEFAULT_SETTINGS, hideTestFolders: true }, onChange);
    expect(folder().querySelectorAll('.bbrd-hidden-pill')).toHaveLength(1);
    expect(folder().firstElementChild.classList.contains('bbrd-hidden-pill')).toBe(true);
    expect(folder().firstElementChild.nextElementSibling.getAttribute('aria-label')).toBe('Directory');
    expect(folder().querySelector('.bbrd-hidden-pill').textContent).toBe('Hidden');
    expect(folder().closest('li').classList.contains('bbrd-file-hidden')).toBe(false);
    expect(src().querySelector('.bbrd-hidden-pill')).toBeNull();
    expect(document.querySelector('a[href="#chg-src/Payment.Tests/ChargeTests.cs"]').closest('li').classList.contains('bbrd-file-hidden')).toBe(true);
    expect(document.querySelector('a[href="#chg-src/App.cs"]').closest('li').classList.contains('bbrd-file-hidden')).toBe(false);

    mountFileFilters(document, DEFAULT_SETTINGS, onChange);
    expect(folder().querySelector('.bbrd-hidden-pill')).toBeNull();
  });

  it('does not put a summary bar in the file tree, and a second mount does not duplicate the flyout, pill, or chip', () => {
    document.body.innerHTML = `
      <aside class="sidebar">
        <span data-qa="files-changed-count">2 files changed</span>
        <ul role="list" id="tree">
          <li>
            <button type="button"><span role="img" aria-label="Directory"></span><span>Payment.Tests</span></button>
            <ul role="list"><li><a href="#chg-src/Payment.Tests/ChargeTests.cs">ChargeTests.cs <span class="stat">4 lines added</span></a></li></ul>
          </li>
          <li><a href="#chg-src/App.cs">App.cs</a></li>
        </ul>
      </aside>
      <section class="bbrd-stats"><div class="bbrd-stats-actions"></div></section>
      <span data-qa="files-viewed-count">0 of 2 files viewed</span>
      <button type="button"><span>Global diff settings</span></button>
      <article data-qa="branch-diff-file" aria-label="Diff of file src/Payment.Tests/ChargeTests.cs"></article>
      <article data-qa="branch-diff-file" aria-label="Diff of file src/App.cs"></article>`;
    const settings = { ...DEFAULT_SETTINGS, hideTestFolders: true };
    mountFileFilters(document, settings, vi.fn());
    expect(document.querySelector('.sidebar .bbrd-hidden-bar')).toBeNull();
    expect(document.querySelectorAll('.bbrd-hidden-bar')).toHaveLength(0);
    expect(document.querySelector('.bbrd-filters .bbrd-hidden-count').textContent).toMatch(/1 hidden · 1 test/);
    expect(document.querySelector('.bbrd-filters .bbrd-hidden-toggle').hidden).toBe(false);

    document.querySelector('.bbrd-filters .bbrd-hidden-toggle').click();
    expect(document.querySelector('a[href="#chg-src/Payment.Tests/ChargeTests.cs"]').closest('li').querySelectorAll('.bbrd-cat')).toHaveLength(1);
    mountFileFilters(document, settings, vi.fn());
    mountFileFilters(document, settings, vi.fn());
    expect(document.querySelectorAll('.bbrd-filters')).toHaveLength(1);
    expect(document.querySelectorAll('.bbrd-menu-host')).toHaveLength(1);
    expect(document.querySelectorAll('#tree .bbrd-hidden-pill')).toHaveLength(1);
    expect(document.querySelector('a[href="#chg-src/Payment.Tests/ChargeTests.cs"]').closest('li').querySelectorAll('.bbrd-cat')).toHaveLength(1);
    expect(document.querySelector('[data-qa="files-viewed-count"]').textContent).toBe('0 of 2 files viewed');
  });
});
