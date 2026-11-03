import { describe, expect, it } from 'vitest';
import { diffMarkdown, markElement } from '../../src/core/markdown-diff.js';
import { htmlDiff, tokenizeHtml } from '../../src/core/html-diff.js';
import { parseBlocks, renderMarkdown } from '../../src/core/markdown.js';
import { alignSequences, wordSimilarity } from '../../src/core/align.js';

const doc = (el) => {
  const div = document.createElement('div');
  div.innerHTML = el;
  return div;
};

describe('tokenizeHtml', () => {
  it('splits tags, words, punctuation and whitespace', () => {
    const tokens = tokenizeHtml('<p>Hello, world</p>');
    expect(tokens.map((t) => t.value)).toEqual(['<p>', 'Hello', ',', ' ', 'world', '</p>']);
  });

  it('keeps inline code and images atomic', () => {
    const tokens = tokenizeHtml('<p>run <code>npm i</code> <img src="a.png"></p>');
    expect(tokens.filter((t) => t.type === 'atomic').map((t) => t.value)).toEqual(['<code>npm i</code>', '<img src="a.png">']);
  });
});

describe('htmlDiff', () => {
  it('marks changed words', () => {
    const { html, ratio } = htmlDiff('<p>The quick brown fox</p>', '<p>The quick red fox</p>');
    expect(html).toBe('<p>The quick <del class="bbrd-del">brown</del><ins class="bbrd-ins">red</ins> fox</p>');
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(0.5);
  });

  it('reports no change for identical html', () => {
    expect(htmlDiff('<p>a b</p>', '<p>a b</p>')).toMatchObject({ changed: false, ratio: 0 });
  });

  it('keeps inserted formatting tags and drops removed ones', () => {
    const { html } = htmlDiff('<p>make it bold</p>', '<p>make it <strong>bold</strong> now</p>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<ins class="bbrd-ins"> now</ins>');
  });
});

describe('alignSequences', () => {
  it('pairs similar removed/added items and leaves the rest as added/removed', () => {
    const ops = alignSequences(['alpha beta gamma', 'delete me entirely'], ['alpha beta delta', 'brand new'], {
      key: (s) => s,
      similarity: wordSimilarity,
    });
    expect(ops.map((o) => o.op)).toEqual(['pair', 'removed', 'added']);
  });
});

describe('parseBlocks', () => {
  it('returns one block per top-level element', () => {
    const { blocks } = parseBlocks('# Title\n\nPara one.\n\n- a\n- b\n\n```js\nx()\n```\n');
    expect(blocks.map((b) => b.kind)).toEqual(['heading:h1', 'paragraph', 'bullet_list', 'fence']);
  });

  it('resolves reference links even when blocks are rendered separately', () => {
    const { blocks } = parseBlocks('See [docs][d].\n\n[d]: https://example.com\n');
    expect(blocks[0].html).toContain('href="https://example.com"');
  });
});

describe('renderMarkdown', () => {
  it('renders GFM tables, task lists and rewrites relative urls', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n![logo](img/logo.png) [guide](docs/guide.md)', {
      resolveUrl: (url, kind) => (/^[a-z]+:/i.test(url) ? url : `https://cdn/${kind}/${url}`),
    });
    expect(html).toContain('<table>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('src="https://cdn/image/img/logo.png"');
    expect(html).toContain('href="https://cdn/link/docs/guide.md"');
  });
});

describe('diffMarkdown', () => {
  it('shows nothing as changed for identical input', () => {
    const src = '# Title\n\nSome text.\n';
    const { stats, html } = diffMarkdown(src, src);
    expect(stats).toEqual({ added: 0, removed: 0, modified: 0 });
    expect(html).not.toContain('data-bbrd-change');
  });

  it('marks word edits inside a paragraph', () => {
    const { html, stats } = diffMarkdown('# T\n\nThe quick brown fox jumps.\n', '# T\n\nThe quick red fox jumps.\n');
    expect(stats.modified).toBe(1);
    const root = doc(html);
    expect(root.querySelector('del.bbrd-del').textContent).toBe('brown');
    expect(root.querySelector('ins.bbrd-ins').textContent).toBe('red');
  });

  it('marks inserted and removed blocks', () => {
    const { html, stats } = diffMarkdown('# T\n\nKeep.\n\nGone paragraph here.\n', '# T\n\nKeep.\n\n## New section\n');
    expect(stats.added + stats.removed + stats.modified).toBeGreaterThan(0);
    const root = doc(html);
    expect(root.querySelector('.bbrd-blk--del').textContent).toContain('Gone paragraph here.');
    expect(root.querySelector('.bbrd-blk--ins h2').textContent).toBe('New section');
  });

  it('diffs list items individually', () => {
    const { html, stats } = diffMarkdown('- one\n- two\n- three\n', '- one\n- two!\n- three\n- four\n');
    const root = doc(html);
    expect(root.querySelectorAll('ul').length).toBe(1);
    expect(root.querySelector('li.bbrd-el--ins').textContent).toBe('four');
    expect(root.querySelector('li.bbrd-el--mod ins').textContent).toBe('!');
    expect(stats).toMatchObject({ added: 1, modified: 1 });
  });

  it('diffs table rows when columns are unchanged', () => {
    const before = '| Name | Value |\n|---|---|\n| a | 1 |\n| b | 2 |\n';
    const after = '| Name | Value |\n|---|---|\n| a | 1 |\n| b | 3 |\n| c | 4 |\n';
    const root = doc(diffMarkdown(before, after).html);
    expect(root.querySelectorAll('table').length).toBe(1);
    expect(root.querySelector('tr.bbrd-el--ins').textContent).toContain('c');
    expect(root.querySelector('tr.bbrd-el--mod del').textContent).toBe('2');
  });

  it('replaces the whole table when the columns change', () => {
    const root = doc(diffMarkdown('| a |\n|---|\n| 1 |\n', '| a | b |\n|---|---|\n| 1 | 2 |\n').html);
    expect(root.querySelector('.bbrd-blk--del table')).not.toBeNull();
    expect(root.querySelector('.bbrd-blk--ins table')).not.toBeNull();
  });

  it('shows code block changes line by line', () => {
    const root = doc(diffMarkdown('```js\nconst a = 1;\nconst b = 2;\n```\n', '```js\nconst a = 1;\nconst b = 3;\n```\n').html);
    expect(root.querySelector('.bbrd-code-line--del').textContent).toBe('const b = 2;');
    expect(root.querySelector('.bbrd-code-line--ins').textContent).toBe('const b = 3;');
    expect(root.querySelector('code.language-js')).not.toBeNull();
  });

  it('treats a heavily rewritten paragraph as replaced rather than word confetti', () => {
    const root = doc(diffMarkdown('Alpha beta gamma delta epsilon.\n', 'Alpha one two three four five six.\n').html);
    expect(root.querySelector('.bbrd-blk--del')).not.toBeNull();
    expect(root.querySelector('.bbrd-blk--ins')).not.toBeNull();
  });

  it('renders an added file as fully inserted', () => {
    const { html, stats } = diffMarkdown(null, '# New\n\nHello\n');
    expect(stats.added).toBe(2);
    expect(doc(html).querySelectorAll('.bbrd-blk--ins').length).toBe(2);
  });

  it('folds long runs of unchanged blocks but keeps context next to changes', () => {
    const paras = Array.from({ length: 8 }, (_, i) => `Paragraph number ${i}.`);
    const before = paras.join('\n\n');
    const after = [...paras.slice(0, 7), 'Paragraph number 7 changed.'].join('\n\n');
    const root = doc(diffMarkdown(before, after).html);
    const fold = root.querySelector('.bbrd-fold');
    expect(fold.dataset.count).toBe('6');
    expect(fold.nextElementSibling.textContent).toBe('Paragraph number 6.');
  });

  it('escapes html in code diffs', () => {
    const { html } = diffMarkdown('```\n<b>a</b>\n```\n', '```\n<i>a</i>\n```\n');
    expect(html).toContain('&lt;i&gt;a&lt;/i&gt;');
  });
});

describe('markElement', () => {
  it('adds the class to the first element, merging existing classes', () => {
    expect(markElement('<li class="task">x</li>', 'ins', true)).toBe('<li class="task bbrd-el bbrd-el--ins" data-bbrd-change>x</li>');
    expect(markElement('<tr>\n<td>1</td></tr>', 'del', false)).toBe('<tr class="bbrd-el bbrd-el--del">\n<td>1</td></tr>');
  });
});
