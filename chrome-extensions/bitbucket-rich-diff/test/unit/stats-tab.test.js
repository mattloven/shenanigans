import { describe, expect, it } from 'vitest';
import { mountStatsTab } from '../../src/content/stats-tab.js';

describe('stats tab', () => {
  it('adds Stats after Commits in the pull request tab list, not the repository sidebar', () => {
    document.body.innerHTML = `
      <nav class="repo-nav" aria-label="Repository">
        <a href="/acme/payments/src">Source</a>
        <a href="/acme/payments/commits">Commits</a>
      </nav>
      <nav aria-label="Pull request">
        <div role="tablist">
          <a role="tab" href="/acme/payments/pull-requests/42/overview">Overview</a>
          <a role="tab" href="/acme/payments/pull-requests/42/diff">Files changed</a>
          <a role="tab" href="/acme/payments/pull-requests/42/commits">Commits8</a>
        </div>
      </nav>
      <a href="#chg-README.md">README.md <span>2 lines added, 1 line removed</span></a>`;

    mountStatsTab(document);

    const commits = document.querySelector('[role="tablist"] a[href$="/commits"]');
    expect(commits.nextElementSibling.classList.contains('bbrd-stats-tab')).toBe(true);
    expect(document.querySelector('.repo-nav .bbrd-stats-tab')).toBeNull();
    expect(document.querySelector('[role="tablist"]').nextElementSibling.classList.contains('bbrd-stats')).toBe(true);

    document.querySelector('.bbrd-stats-tab').click();
    const lines = document.querySelector('[data-stat="lines"] strong');
    expect(lines.querySelector('.bbrd-add').textContent).toBe('+2');
    expect(lines.querySelector('.bbrd-del').textContent).toBe('−1');
  });
});