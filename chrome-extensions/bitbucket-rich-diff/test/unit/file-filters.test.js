import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountFileFilters, resetHiddenReveal } from '../../src/content/file-filters.js';
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
    <div class="toolbar"><div class="right">
      <span data-qa="files-viewed-count">0 of 2 files viewed</span>
      <button type="button"><span>Global diff settings</span></button>
    </div></div>
    <article data-qa="branch-diff-file" aria-label="Diff of file README.md"></article>
    <article data-qa="branch-diff-file" aria-label="Diff of file src/App.cs"></article>`;
}

function cogs() {
  return [...document.querySelectorAll('button')].filter((button) => (button.textContent || '').includes('Global diff settings') && !button.closest('.bbrd-menu-host'));
}

describe('mountFileFilters', () => {
  beforeEach(() => {
    resetHiddenReveal();
    installPage();
  });

  it('puts one menu beside the cog and drops copies left in the file list', () => {
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
    expect(document.querySelector('.bbrd-menu-host').nextElementSibling).toBe(cogs()[0]);
    expect(document.querySelector('.sidebar .bbrd-filters')).toBeNull();
  });

  it('moves the same menu when Bitbucket leaves the old toolbar in the page', () => {
    const onChange = vi.fn();
    mountFileFilters(document, DEFAULT_SETTINGS, onChange);

    const right = document.querySelector('.right');
    const fresh = right.cloneNode(true);
    fresh.querySelector('.bbrd-menu-host')?.remove();
    right.after(fresh);
    mountFileFilters(document, DEFAULT_SETTINGS, onChange);
    mountFileFilters(document, DEFAULT_SETTINGS, onChange);

    const visibleCogs = cogs();
    expect(document.querySelectorAll('.bbrd-menu-host')).toHaveLength(1);
    expect(document.querySelectorAll('.bbrd-filters')).toHaveLength(1);
    expect(document.querySelector('.bbrd-menu-host').nextElementSibling).toBe(visibleCogs[visibleCogs.length - 1]);
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

  it('hides matching files and keeps Show/Hide in the flyout, never the file tree', () => {
    const onChange = vi.fn();
    mountFileFilters(document, { ...DEFAULT_SETTINGS, hideMarkdown: true, hidePattern: '[' }, onChange);

    expect(document.querySelector('a[href="#chg-README.md"]').closest('li').classList.contains('bbrd-file-hidden')).toBe(true);
    expect(document.querySelector('article[aria-label="Diff of file README.md"]').classList.contains('bbrd-file-hidden')).toBe(true);
    expect(document.querySelector('a[href="#chg-src/App.cs"]').closest('li').classList.contains('bbrd-file-hidden')).toBe(false);
    expect(document.querySelector('.bbrd-hidden-count').textContent).toBe('1 hidden · 1 doc +3 −1');
    expect(document.querySelectorAll('.bbrd-hidden-bar')).toHaveLength(0);
    expect(document.querySelector('.sidebar .bbrd-hidden-toggle')).toBeNull();
    expect(document.querySelector('.bbrd-filters .bbrd-hidden-toggle').hidden).toBe(false);
    expect(document.querySelector('[data-qa="files-viewed-count"]').textContent).toBe('0 of 1 viewed · 2 files');
    expect(document.querySelector('[data-qa="files-viewed-count"]').dataset.bbrdViewedOriginal).toBe('0 of 2 files viewed');
    expect(document.querySelector('[data-qa="files-changed-count"]').textContent).toBe('1 of 2 files changed');
    expect(document.querySelector('[data-qa="files-changed-count"]').dataset.bbrdChangedOriginal).toBe('2 files changed');

    document.querySelector('.bbrd-filters .bbrd-hidden-toggle').click();
    expect(document.querySelector('a[href="#chg-README.md"]').closest('li').classList.contains('bbrd-file-hidden')).toBe(false);
    expect(document.querySelector('a[href="#chg-README.md"]').closest('li').querySelector('.bbrd-cat').textContent).toBe('Docs');
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
