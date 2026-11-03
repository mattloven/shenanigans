import { diffArrays } from 'diff';

/**
 * @typedef {'unchanged' | 'added' | 'removed' | 'modified'} JsonStatus
 *
 * @typedef {object} JsonNode
 * @property {JsonStatus} status
 * @property {string | number | null} key       object key, array index, or null for the root
 * @property {'object' | 'array' | 'primitive'} kind
 * @property {unknown} [value]                  for unchanged/added/removed nodes
 * @property {unknown} [oldValue]               for modified primitives (or type changes)
 * @property {unknown} [newValue]
 * @property {JsonNode[]} [children]            for modified containers
 *
 * @typedef {{ path: string, type: 'added' | 'removed' | 'modified', oldValue?: unknown, newValue?: unknown }} JsonChange
 */

/**
 * Parses JSON, falling back to a JSONC-tolerant pass (comments and trailing commas) so files
 * like tsconfig.json or .vscode/settings.json still get a structural view.
 * @returns {{ ok: true, value: unknown, loose: boolean } | { ok: false, error: string }}
 */
export function parseJsonLoose(text) {
  try {
    return { ok: true, value: JSON.parse(text), loose: false };
  } catch (strictError) {
    try {
      return { ok: true, value: JSON.parse(stripJsonc(text)), loose: true };
    } catch {
      return { ok: false, error: strictError.message };
    }
  }
}

/** Removes // and /* *\/ comments and trailing commas outside of strings. */
export function stripJsonc(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

export function kindOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value !== null && typeof value === 'object') return 'object';
  return 'primitive';
}

export function deepEqual(a, b) {
  if (a === b) return true;
  const ka = kindOf(a);
  if (ka !== kindOf(b) || ka === 'primitive') return false;
  if (ka === 'array') return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  return keysA.length === keysB.length && keysA.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

/**
 * Structural diff of two JSON values. Pass `undefined` for a side that does not exist
 * (added or deleted file).
 * @returns {JsonNode}
 */
export function diffJson(oldValue, newValue, key = null) {
  if (oldValue === undefined && newValue === undefined) return { status: 'unchanged', key, kind: 'primitive', value: null };
  if (oldValue === undefined) return { status: 'added', key, kind: kindOf(newValue), value: newValue };
  if (newValue === undefined) return { status: 'removed', key, kind: kindOf(oldValue), value: oldValue };
  if (deepEqual(oldValue, newValue)) return { status: 'unchanged', key, kind: kindOf(newValue), value: newValue };

  const oldKind = kindOf(oldValue);
  const newKind = kindOf(newValue);
  if (oldKind === 'object' && newKind === 'object') {
    return { status: 'modified', key, kind: 'object', children: diffObjects(oldValue, newValue) };
  }
  if (oldKind === 'array' && newKind === 'array') {
    return { status: 'modified', key, kind: 'array', children: diffArraysStructural(oldValue, newValue) };
  }
  return { status: 'modified', key, kind: 'primitive', oldValue, newValue };
}

function diffObjects(oldObj, newObj) {
  const oldKeys = Object.keys(oldObj);
  const newKeys = Object.keys(newObj);
  const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);
  const children = [];
  for (const part of diffArrays(oldKeys, newKeys)) {
    for (const k of part.value) {
      if (part.removed) {
        // A key that moved is reported where it now lives, not as removed + added.
        if (!has(newObj, k)) children.push(diffJson(oldObj[k], undefined, k));
      } else {
        children.push(diffJson(has(oldObj, k) ? oldObj[k] : undefined, newObj[k], k));
      }
    }
  }
  return children;
}

function diffArraysStructural(oldArr, newArr) {
  const parts = diffArrays(oldArr, newArr, { comparator: deepEqual });
  const children = [];
  let oi = 0;
  let ni = 0;
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p];
    if (!part.added && !part.removed) {
      for (let k = 0; k < part.count; k++) {
        children.push({ status: 'unchanged', key: ni, kind: kindOf(newArr[ni]), value: newArr[ni] });
        oi++;
        ni++;
      }
      continue;
    }
    const removed = [];
    const added = [];
    while (p < parts.length && (parts[p].added || parts[p].removed)) {
      for (let k = 0; k < parts[p].count; k++) {
        if (parts[p].removed) removed.push(oi++);
        else added.push(ni++);
      }
      p++;
    }
    p--;
    const paired = Math.min(removed.length, added.length);
    for (let k = 0; k < paired; k++) {
      const a = oldArr[removed[k]];
      const b = newArr[added[k]];
      if (kindOf(a) === kindOf(b)) {
        children.push(diffJson(a, b, added[k]));
      } else {
        children.push({ status: 'removed', key: removed[k], kind: kindOf(a), value: a });
        children.push({ status: 'added', key: added[k], kind: kindOf(b), value: b });
      }
    }
    for (let k = paired; k < removed.length; k++) children.push({ status: 'removed', key: removed[k], kind: kindOf(oldArr[removed[k]]), value: oldArr[removed[k]] });
    for (let k = paired; k < added.length; k++) children.push({ status: 'added', key: added[k], kind: kindOf(newArr[added[k]]), value: newArr[added[k]] });
  }
  return children;
}

/** Flattens a diff tree to the list of leaf-most changes, e.g. `dependencies.express`. */
export function collectChanges(node, path = '') {
  const here = node.key === null ? path : joinPath(path, node.key);
  switch (node.status) {
    case 'unchanged':
      return [];
    case 'added':
      return [{ path: here, type: 'added', newValue: node.value }];
    case 'removed':
      return [{ path: here, type: 'removed', oldValue: node.value }];
    case 'modified':
      if (node.children) return node.children.flatMap((child) => collectChanges(child, here));
      return [{ path: here, type: 'modified', oldValue: node.oldValue, newValue: node.newValue }];
    default: {
      const unreachable = /** @type {never} */ (node.status);
      throw new Error(`Unknown status ${unreachable}`);
    }
  }
}

export function joinPath(base, key) {
  if (typeof key === 'number') return `${base}[${key}]`;
  if (/^[A-Za-z_$][\w$]*$/.test(key)) return base ? `${base}.${key}` : key;
  return `${base}[${JSON.stringify(key)}]`;
}

export function summarize(changes) {
  const stats = { added: 0, removed: 0, modified: 0 };
  for (const c of changes) stats[c.type]++;
  return stats;
}
