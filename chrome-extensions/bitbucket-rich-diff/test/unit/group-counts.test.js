import { describe, expect, it } from 'vitest';
import { groupCounts } from '../../src/content/group-counts.js';
import { mountFileFilters } from '../../src/content/file-filters.js';
import { DEFAULT_SETTINGS } from '../../src/core/settings.js';

describe('groupCounts', () => {
  it('groups thousands in the file list, line numbers, and counters, and leaves code alone', () => {
    document.body.innerHTML = `
      <div id="file-tree">
        <h5>Lines updated</h5>
        <span>+</span><span>1404</span>
        <span>-82</span>
        <span>+247650</span>
        <a href="#chg-report-2024.md">report-2024.md</a>
        <span>NUC-7578</span>
        <span>1 comment and 2350 lines added</span>
        <span>2350 lines added and 4 lines removed</span>
      </div>
      <article data-qa="branch-diff-file">
        <div class="chunk-heading-middle">@@ -1488,6 +1489,13 @@ namespace App</div>
        <div class="line-numbers"><a class="line-number-permalink">1234</a></div>
        <div class="line-numbers"><a class="line-number-permalink">92</a></div>
        <div data-line-type="+"><span>timeout: 5000</span></div>
      </article>
      <b>0 of 1400</b>
      <span>Comments (1400 unresolved)</span>`;

    groupCounts(document);
    groupCounts(document);

    expect(document.querySelector('#file-tree').textContent).toContain('+1,404');
    expect(document.querySelector('#file-tree').textContent).toContain('-82');
    expect(document.querySelector('#file-tree').textContent).toContain('+247,650');
    expect(document.querySelector('#file-tree').textContent).toContain('report-2024.md');
    expect(document.querySelector('#file-tree').textContent).toContain('NUC-7578');
    expect(document.querySelector('#file-tree').textContent).toContain('1 comment and 2,350 lines added');
    expect(document.querySelector('#file-tree').textContent).toContain('2,350 lines added and 4 lines removed');
    expect(document.querySelector('.chunk-heading-middle').textContent).toBe('@@ -1488,6 +1489,13 @@ namespace App');
    expect(document.querySelectorAll('.line-number-permalink')[0].textContent).toBe('1,234');
    expect(document.querySelectorAll('.line-number-permalink')[1].textContent).toBe('92');
    expect(document.querySelector('[data-line-type]').textContent).toBe('timeout: 5000');
    expect(document.querySelector('b').textContent).toBe('0 of 1,400');
    expect(document.body.textContent).toContain('Comments (1,400 unresolved)');
  });

  it('still sums a file-list line count after the commas are in place', () => {
    document.body.innerHTML = `
      <section class="bbrd-stats"><div class="bbrd-stats-actions"></div></section>
      <ul><li><a href="#chg-App.cs">App.cs <span>1,404 lines added, 82 lines removed</span></a></li></ul>
      <article data-qa="branch-diff-file" aria-label="Diff of file App.cs"></article>`;
    mountFileFilters(document, { ...DEFAULT_SETTINGS, hideMarkdown: true }, () => {});
    expect(document.querySelector('.bbrd-hidden-count').textContent).toBe('');
    mountFileFilters(document, { ...DEFAULT_SETTINGS, hidePattern: 'App' }, () => {});
    expect(document.querySelector('.bbrd-hidden-count').textContent).toContain('+1,404');
    expect(document.querySelector('.bbrd-hidden-count').textContent).toContain('−82');
  });
});
