import { describe, expect, it } from 'vitest';
import { clearCommentMasks, maskCell, updateCommentMasks } from '../../src/content/comment-mask.js';

describe('maskCell', () => {
  it('hides only the commented slice and can be undone', () => {
    const cell = document.createElement('span');
    cell.setAttribute('data-line-type', '+');
    cell.innerHTML = '<span class="k">const </span><span class="n">a = 1; // note</span>';
    maskCell(cell, [{ start: 13, end: 20 }]);
    expect(cell.textContent).toBe('const a = 1; // note');
    const hidden = cell.querySelector('.bbrd-hide-comment');
    expect(hidden.textContent).toBe('// note');
    expect(cell.querySelector('.k').textContent).toBe('const ');
    clearCommentMasks(cell);
    expect(cell.querySelector('.bbrd-hide-comment')).toBeNull();
    expect(cell.textContent).toBe('const a = 1; // note');
  });
});

describe('updateCommentMasks', () => {
  function article(path, lines) {
    const rows = lines
      .map(([type, text]) => `<div data-key="code-line" role="row"><span role="gridcell" data-line-type="${type}">${text}</span></div>`)
      .join('');
    const el = document.createElement('article');
    el.dataset.qa = 'branch-diff-file';
    el.setAttribute('aria-label', `Diff of file ${path}`);
    el.innerHTML = rows;
    document.body.append(el);
    return el;
  }

  it('hides comment-only lines and trailing comments, and leaves the file alone when turned off', () => {
    const el = article('src/app.js', [
      [' ', 'function charge() {'],
      ['-', '  // old note'],
      ['+', '  const a = 1; // trailing'],
      [' ', '  return a;'],
      ['+', '  /** @param {number} a */'],
    ]);
    updateCommentMasks(document, { hideCodeComments: true, hideSummaryComments: false });
    const rows = [...el.querySelectorAll('[data-key="code-line"]')];
    expect(rows[1].classList.contains('bbrd-hide-line')).toBe(true);
    expect(rows[2].querySelector('.bbrd-hide-comment').textContent).toBe('// trailing');
    expect(rows[2].textContent.startsWith('  const a = 1; ')).toBe(true);
    expect(rows[4].classList.contains('bbrd-hide-line')).toBe(false);
    const fold = el.querySelector('.bbrd-comment-fold');
    expect(fold.querySelector('.bbrd-fold-pill').textContent).toBe('Comments - 1 line');

    updateCommentMasks(document, { hideCodeComments: true, hideSummaryComments: true });
