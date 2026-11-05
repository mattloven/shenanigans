import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountFileFilters } from '../../src/content/file-filters.js';
import { DEFAULT_SETTINGS } from '../../src/core/settings.js';

function installPage() {
  document.body.innerHTML = `
    <aside class="sidebar">
      <ul>
        <li><a href="#chg-README.md">README.md</a></li>
        <li><a href="#chg-src/App.cs">src/App.cs</a></li>
      </ul>
    </aside>
    <div class="toolbar"><div class="right">
      <span>0 of 2 files viewed</span>
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

  it('hides matching files and keeps an in-progress pattern', () => {
    const onChange = vi.fn();
    mountFileFilters(document, { ...DEFAULT_SETTINGS, hideMarkdown: true, hidePattern: '[' }, onChange);

    expect(document.querySelector('a[href="#chg-README.md"]').closest('li').classList.contains('bbrd-file-hidden')).toBe(true);
    expect(document.querySelector('article[aria-label="Diff of file README.md"]').classList.contains('bbrd-file-hidden')).toBe(true);
    expect(document.querySelector('a[href="#chg-src/App.cs"]').closest('li').classList.contains('bbrd-file-hidden')).toBe(false);
    expect(document.querySelector('.bbrd-hidden-count').textContent).toBe('1 hidden');
    expect(document.querySelector('[data-filter="hidePattern"]').getAttribute('aria-invalid')).toBe('true');

    document.querySelector('.bbrd-menu-button').click();
    const pattern = document.querySelector('[data-filter="hidePattern"]');
    pattern.focus();
    pattern.value = 'still typing';
    mountFileFilters(document, { ...DEFAULT_SETTINGS, hideMarkdown: true, hidePattern: '' }, onChange);
    expect(pattern.value).toBe('still typing');
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
});
