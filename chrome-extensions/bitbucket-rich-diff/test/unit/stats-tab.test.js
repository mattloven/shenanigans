import { describe, expect, it } from 'vitest';
import { clearStats, mountStatsTab } from '../../src/content/stats-tab.js';

describe('stats summary', () => {
  it('sits above the file tree and the diff, and reads Lines updated', () => {
    document.body.innerHTML = `
      <nav class="repo-nav" aria-label="Repository">
        <a href="/acme/payments/commits">Commits</a>
      </nav>
      <div role="tablist">
        <a role="tab" href="/acme/payments/pull-requests/42/overview">Overview</a>
        <a role="tab" href="/acme/payments/pull-requests/42/diff">Files changed</a>
        <a role="tab" href="/acme/payments/pull-requests/42/commits">Commits8</a>
      </div>
      <button type="button">Comments (7 unresolved)</button>
      <div>Unresolved Comments (7)</div>
      <div>Resolved Comments (0)</div>
      <div class="shell">
        <div class="split">
          <div id="file-tree">
            <div>
              <span><h5>Lines updated</h5></span>
              <div><span>+1404</span><span>-82</span></div>
            </div>
            <a href="#chg-README.md">README.md <span>1 comment and 999 lines added, 400 lines removed</span></a>
          </div>
          <div class="preview">
            <article data-qa="branch-diff-file" aria-label="Diff of file README.md"></article>
          </div>
        </div>
      </div>`;

    mountStatsTab(document);

    const split = document.querySelector('.split');
    const panel = document.querySelector('.bbrd-stats');
    expect(document.querySelector('.bbrd-stats-tab')).toBeNull();
    expect(split.previousElementSibling).toBe(panel);
    expect(document.querySelector('#file-tree .bbrd-stats')).toBeNull();
    expect(panel.querySelector('h2').textContent).toBe('💩 Betterer Bit Bucket');
    expect(panel.querySelector('.bbrd-stats-actions')).not.toBeNull();
    const lines = panel.querySelector('[data-stat="lines"] strong');
    expect(lines.querySelector('.bbrd-add').textContent).toBe('+1,404');
    expect(lines.querySelector('.bbrd-del').textContent).toBe('−82');
    expect(panel.querySelector('.bbrd-stats-lead').textContent).toContain('+1,404');
    expect(panel.querySelector('[data-stat="comments"] strong').textContent).toBe('0 / 7 resolved');
    expect(panel.querySelector('.bbrd-stats-lead').textContent).toContain('0 / 7 resolved');

    for (const el of [...document.querySelectorAll('div')]) {
      if (/^(un)?resolved comments \(\d+\)$/i.test(el.textContent.trim())) el.remove();
    }
    mountStatsTab(document);
    expect(document.querySelector('[data-stat="comments"] strong').textContent).toBe('0 / 7 resolved');

    clearStats(document);
    document.querySelector('button').textContent = 'Comments (2 unresolved)';
    mountStatsTab(document);
    expect(document.querySelector('[data-stat="comments"] strong').textContent).toBe('2 unresolved');
    expect(document.querySelector('.bbrd-stats').hidden).toBe(false);
  });
});
