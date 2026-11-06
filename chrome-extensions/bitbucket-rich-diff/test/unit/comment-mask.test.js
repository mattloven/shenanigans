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
    expect(el.querySelector('[data-key="code-line"]:last-child').classList.contains('bbrd-hide-line')).toBe(true);

    updateCommentMasks(document, { hideCodeComments: false, hideSummaryComments: false });
    expect(el.querySelector('.bbrd-hide-line, .bbrd-hide-comment')).toBeNull();
    expect(el.querySelector('[data-line-type="+"]').textContent).toContain('// trailing');
    el.remove();
  });

  it('folds summary comments only when collapse is on, and hides them with no bar otherwise', () => {
    const el = article('src/Payment.cs', [
      ['+', '    /// <summary>Docs.</summary>'],
      ['+', '    var a = 1;'],
    ]);
    updateCommentMasks(document, { hideCodeComments: false, hideSummaryComments: false, collapseSummaryComments: true });
    expect(el.querySelector('.bbrd-fold-pill').textContent).toBe('Comments - 1 line');
    expect(el.querySelector('[data-key="code-line"]').classList.contains('bbrd-fold-line')).toBe(true);

    updateCommentMasks(document, { hideCodeComments: false, hideSummaryComments: true, collapseSummaryComments: true });
    expect(el.querySelector('.bbrd-comment-fold')).toBeNull();
    expect(el.querySelector('[data-key="code-line"]').classList.contains('bbrd-hide-line')).toBe(true);
    expect(el.querySelector('.bbrd-fold-line')).toBeNull();
    el.remove();
  });

  it('hides each side of a side-by-side C# row on its own', () => {
    const el = document.createElement('article');
    el.dataset.qa = 'branch-diff-file';
    el.setAttribute('aria-label', 'Diff of file src/Payment.cs');
    el.innerHTML = `
      <div data-key="code-line" role="row">
        <div data-qa="code-line"><span role="gridcell" data-line-type=" "></span></div>
        <div data-qa="code-line"><span role="gridcell" data-line-type="+">    // new note</span></div>
      </div>
      <div data-key="code-line" role="row">
        <div data-qa="code-line"><span role="gridcell" data-line-type="-">    // old note</span></div>
        <div data-qa="code-line"><span role="gridcell" data-line-type="+">    var a = 1; // trailing</span></div>
      </div>
      <div data-key="code-line" role="row">
        <div data-qa="code-line"><span role="gridcell" data-line-type=" ">    /// <summary>Docs.</summary></span></div>
        <div data-qa="code-line"><span role="gridcell" data-line-type=" ">    /// <summary>Docs.</summary></span></div>
      </div>`;
    document.body.append(el);
    updateCommentMasks(document, { hideCodeComments: true, hideSummaryComments: true });
    const rows = [...el.querySelectorAll('[data-key="code-line"]')];
    const hidden = (row) => [...row.querySelectorAll('[data-qa="code-line"]')].map((line) => line.classList.contains('bbrd-hide-line'));
    // Folded runs hide every side, including the blank partner column.
    expect(hidden(rows[0])).toEqual([true, true]);
    expect(hidden(rows[1])).toEqual([true, false]);
    expect(rows[1].querySelector('.bbrd-hide-comment').textContent).toBe('// trailing');
    expect(hidden(rows[2])).toEqual([true, true]);
    expect(rows[2].classList.contains('bbrd-hide-line')).toBe(true);
    const folds = [...el.querySelectorAll('.bbrd-comment-fold')];
    expect(folds).toHaveLength(1);
    expect(folds[0].querySelector('.bbrd-fold-pill').textContent).toBe('Comments - 1 line');
    expect(folds[0].getAttribute('aria-expanded')).toBe('false');
    expect(rows[0].classList.contains('bbrd-hide-line')).toBe(true);
    expect(rows[0].classList.contains('bbrd-comment-open')).toBe(false);
    expect(rows[2].classList.contains('bbrd-hide-line')).toBe(true);
    expect(rows[2].querySelector('.bbrd-comment-fold, .bbrd-fold-line')).toBeNull();
    el.remove();
  });

  it('puts the mask back after syntax highlighting rewrites the cell', () => {
    const el = article('src/Payment.cs', [[' ', '    // ReSharper disable once InconsistentNaming']]);
    updateCommentMasks(document, { hideCodeComments: true, hideSummaryComments: false });
    const cell = el.querySelector('[data-line-type]');
    cell.innerHTML = '<span class="token comment">    // ReSharper disable once InconsistentNaming</span>';
    updateCommentMasks(document, { hideCodeComments: true, hideSummaryComments: false });
    expect(el.querySelector('[data-key="code-line"]').classList.contains('bbrd-hide-line')).toBe(true);
    el.remove();
  });
});
