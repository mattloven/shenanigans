import { describe, expect, it } from 'vitest';
import { buildView } from '../../src/content/build-view.js';
import { alignMarkdownBlocks } from '../../src/core/markdown-diff.js';

const doc = (html) => {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
};

const entry = (oldPath, newPath) => ({
  status: 'modified',
  old: oldPath ? { path: oldPath, commit: 'aaaaaaaaaaaaffff' } : null,
  new: newPath ? { path: newPath, commit: 'bbbbbbbbbbbbffff' } : null,
});

describe('alignMarkdownBlocks', () => {
  it('pairs matching sections and leaves gaps for one-sided blocks', () => {
    const rows = alignMarkdownBlocks('# T\n\nKept.\n\nOld only para here.\n', '# T\n\nNew intro.\n\nKept.\n');
    expect(rows.map((r) => [r.old !== null, r.new !== null])).toEqual([
      [true, true],
      [false, true],
      [true, true],
      [true, false],
    ]);
    expect(rows[2].old).toBe(rows[2].new);
  });
});

describe('buildView preview', () => {
  it('renders an aligned, markup-free markdown comparison with commit labels', () => {
    const view = buildView('markdown', 'preview', { entry: entry('README.md', 'README.md'), oldText: '# A\n\nold words\n', newText: '# A\n\nnew words\n' });
    expect(view.compare).toBe(true);
    const root = doc(view.html);
    expect(root.querySelectorAll('div.cmp-cell--old')).toHaveLength(2);
    expect(root.querySelector('.cmp-cell--old p').textContent).toBe('old words');
    expect(root.querySelector('.cmp-cell--new p').textContent).toBe('new words');
    expect(root.querySelector('ins, del, [data-bbrd-change]')).toBeNull();
    expect(root.querySelector('header.cmp-cell--old').textContent).toBe('Before aaaaaaaaaaaa');
  });

  it('labels the old path of a renamed file', () => {
    const view = buildView('markdown', 'preview', { entry: entry('docs/old.md', 'docs/new.md'), oldText: 'a\n', newText: 'b\n' });
    expect(doc(view.html).querySelector('header.cmp-cell--old .cmp-path').textContent).toBe('docs/old.md');
  });

  it('explains the missing side for added files', () => {
    const view = buildView('markdown', 'preview', { entry: entry(null, 'new.md'), oldText: null, newText: '# New\n' });
    const root = doc(view.html);
    expect(root.querySelector('.cmp-pane--old .cmp-empty').textContent).toMatch(/did not exist/);
    expect(root.querySelector('.cmp-pane--new h1').textContent).toBe('New');
  });

  it('renders both JSON trees and isolates a parse error to its pane', () => {
    const view = buildView('json', 'preview', { entry: entry('a.json', 'a.json'), oldText: '{"a": 1}', newText: '{"a": ' });
    const root = doc(view.html);
    expect(root.querySelector('.cmp-pane--old [data-path="a"]')).not.toBeNull();
    expect(root.querySelector('.cmp-pane--new .bbrd-error').textContent).toMatch(/new version is not valid JSON/);
  });
});
