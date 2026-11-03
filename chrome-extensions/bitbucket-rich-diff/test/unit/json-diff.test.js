import { describe, expect, it } from 'vitest';
import { collectChanges, deepEqual, diffJson, parseJsonLoose, stripJsonc, summarize } from '../../src/core/json-diff.js';
import { renderJsonDiff, renderJsonSummary, renderJsonTree } from '../../src/core/json-render.js';

const doc = (html) => {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
};

describe('parseJsonLoose', () => {
  it('parses strict JSON', () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ ok: true, value: { a: 1 }, loose: false });
  });

  it('accepts comments and trailing commas', () => {
    const res = parseJsonLoose('{\n // c\n "a": "http://x", /* b */ "b": [1,2,],\n}');
    expect(res).toEqual({ ok: true, value: { a: 'http://x', b: [1, 2] }, loose: true });
  });

  it('reports errors for invalid input', () => {
    expect(parseJsonLoose('{nope')).toMatchObject({ ok: false });
  });

  it('does not strip comment-like text inside strings', () => {
    expect(stripJsonc('{"a": "// not a comment", "b": "/* nor this */"}')).toBe('{"a": "// not a comment", "b": "/* nor this */"}');
  });
});

describe('deepEqual', () => {
  it('compares nested structures regardless of key order', () => {
    expect(deepEqual({ a: [1, { b: 2 }], c: null }, { c: null, a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: [1] }, { a: [1, 2] })).toBe(false);
    expect(deepEqual([], {})).toBe(false);
  });
});

describe('diffJson + collectChanges', () => {
  it('finds modified, added and removed keys with paths', () => {
    const before = { name: 'x', version: '1.0.0', scripts: { test: 'jest', lint: 'eslint' }, deps: { a: '1' } };
    const after = { name: 'x', version: '1.1.0', scripts: { test: 'vitest', lint: 'eslint', build: 'esbuild' }, deps: {} };
    const changes = collectChanges(diffJson(before, after));
    expect(changes).toEqual([
      { path: 'version', type: 'modified', oldValue: '1.0.0', newValue: '1.1.0' },
      { path: 'scripts.test', type: 'modified', oldValue: 'jest', newValue: 'vitest' },
      { path: 'scripts.build', type: 'added', newValue: 'esbuild' },
      { path: 'deps.a', type: 'removed', oldValue: '1' },
    ]);
    expect(summarize(changes)).toEqual({ added: 1, removed: 1, modified: 2 });
  });

  it('ignores pure key reordering', () => {
    expect(collectChanges(diffJson({ a: 1, b: 2 }, { b: 2, a: 1 }))).toEqual([]);
  });

  it('aligns arrays so an insertion does not mark every later element as changed', () => {
    const changes = collectChanges(diffJson(['a', 'b', 'c'], ['a', 'x', 'b', 'c']));
    expect(changes).toEqual([{ path: '[1]', type: 'added', newValue: 'x' }]);
  });

  it('recurses into modified objects inside arrays', () => {
    const changes = collectChanges(diffJson({ items: [{ id: 1, v: 'a' }, { id: 2, v: 'b' }] }, { items: [{ id: 1, v: 'a' }, { id: 2, v: 'B' }] }));
    expect(changes).toEqual([{ path: 'items[1].v', type: 'modified', oldValue: 'b', newValue: 'B' }]);
  });

  it('quotes keys that are not identifiers', () => {
    const changes = collectChanges(diffJson({ 'my-key': 1 }, { 'my-key': 2 }));
    expect(changes[0].path).toBe('["my-key"]');
  });

  it('handles added and deleted files', () => {
    expect(diffJson(undefined, { a: 1 }).status).toBe('added');
    expect(diffJson({ a: 1 }, undefined).status).toBe('removed');
  });

  it('reports type changes as modifications', () => {
    expect(collectChanges(diffJson({ a: [1] }, { a: { x: 1 } }))).toEqual([{ path: 'a', type: 'modified', oldValue: [1], newValue: { x: 1 } }]);
  });
});

describe('renderJsonDiff', () => {
  it('renders changed rows with markers and collapses unchanged containers', () => {
    const root = doc(renderJsonDiff(diffJson({ v: 1, same: { deep: true }, gone: 1 }, { v: 2, same: { deep: true }, added: 'y' })));
    const changed = [...root.querySelectorAll('[data-bbrd-change]')].map((el) => el.dataset.path);
    expect(changed).toEqual(['v', 'gone', 'added']);
    const sameNode = root.querySelector('[data-path="same"]').closest('details');
    expect(sameNode.open).toBe(false);
    expect(root.querySelector('[data-path="v"] del').textContent).toBe('1');
    expect(root.querySelector('[data-path="v"] ins').textContent).toBe('2');
  });

  it('diffs long strings inline', () => {
    const root = doc(renderJsonDiff(diffJson({ d: 'Library for building add-ons on Express' }, { d: 'Library for building apps on Express' })));
    expect(root.querySelector('[data-path="d"] del').textContent).toBe('add-ons');
    expect(root.querySelector('[data-path="d"] ins').textContent).toBe('apps');
  });

  it('escapes keys and values', () => {
    const html = renderJsonDiff(diffJson({ '<k>': '<v>' }, { '<k>': '<w>' }));
    expect(html).not.toContain('<v>');
    expect(html).toContain('&lt;w&gt;');
  });
});

describe('renderJsonTree / renderJsonSummary', () => {
  it('opens the tree to the requested depth', () => {
    const root = doc(renderJsonTree({ a: { b: { c: 1 } } }, { openDepth: 1 }));
    const details = root.querySelectorAll('details');
    expect(details[0].open).toBe(true);
    expect(details[1].open).toBe(false);
  });

  it('lists changes with jump targets', () => {
    const root = doc(renderJsonSummary([{ path: 'a.b', type: 'modified', oldValue: 1, newValue: 2 }]));
    expect(root.querySelector('tr[data-target-path="a.b"]')).not.toBeNull();
  });

  it('explains when only formatting changed', () => {
    expect(renderJsonSummary([])).toContain('No structural changes');
  });
});
