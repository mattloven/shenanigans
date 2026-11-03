import { diffArrays } from 'diff';

/**
 * Diffs two item lists by key and turns each removed/added run into an aligned
 * sequence of `pair` (modified), `removed` and `added` operations.
 *
 * @template T
 * @param {T[]} oldItems
 * @param {T[]} newItems
 * @param {{ key: (item: T) => string, similarity: (a: T, b: T) => number, threshold?: number }} opts
 * @returns {Array<{ op: 'same' | 'pair' | 'removed' | 'added', old?: T, new?: T }>}
 */
export function alignSequences(oldItems, newItems, { key, similarity, threshold = 0.3 }) {
  const parts = diffArrays(oldItems.map(key), newItems.map(key));
  const ops = [];
  let oi = 0;
  let ni = 0;
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p];
    if (!part.added && !part.removed) {
      for (let k = 0; k < part.count; k++) ops.push({ op: 'same', old: oldItems[oi++], new: newItems[ni++] });
      continue;
    }
    const removed = [];
    const added = [];
    while (p < parts.length && (parts[p].added || parts[p].removed)) {
      const run = parts[p];
      for (let k = 0; k < run.count; k++) {
        if (run.removed) removed.push(oldItems[oi++]);
        else added.push(newItems[ni++]);
      }
      p++;
    }
    p--;
    ops.push(...pairRuns(removed, added, similarity, threshold));
  }
  return ops;
}

/**
 * Order-preserving alignment (Needleman-Wunsch style) that maximises total similarity of
 * paired items. Pairs below `threshold` are never made.
 */
export function pairRuns(removed, added, similarity, threshold) {
  const n = removed.length;
  const m = added.length;
  if (n === 0) return added.map((item) => ({ op: 'added', new: item }));
  if (m === 0) return removed.map((item) => ({ op: 'removed', old: item }));

  const sim = Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => similarity(removed[i], added[j])));
  const score = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      let best = Math.max(score[i + 1][j], score[i][j + 1]);
      if (sim[i][j] >= threshold) best = Math.max(best, sim[i][j] + score[i + 1][j + 1]);
      score[i][j] = best;
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (sim[i][j] >= threshold && score[i][j] === sim[i][j] + score[i + 1][j + 1]) {
      ops.push({ op: 'pair', old: removed[i++], new: added[j++] });
    } else if (score[i][j] === score[i + 1][j]) {
      ops.push({ op: 'removed', old: removed[i++] });
    } else {
      ops.push({ op: 'added', new: added[j++] });
    }
  }
  while (i < n) ops.push({ op: 'removed', old: removed[i++] });
  while (j < m) ops.push({ op: 'added', new: added[j++] });
  return ops;
}

/** Dice coefficient over word multisets; 1 = same words, 0 = nothing in common. */
export function wordSimilarity(a, b) {
  const wa = words(a);
  const wb = words(b);
  if (wa.length === 0 && wb.length === 0) return 1;
  if (wa.length === 0 || wb.length === 0) return 0;
  const counts = new Map();
  for (const w of wa) counts.set(w, (counts.get(w) || 0) + 1);
  let common = 0;
  for (const w of wb) {
    const c = counts.get(w);
    if (c) {
      common++;
      counts.set(w, c - 1);
    }
  }
  return (2 * common) / (wa.length + wb.length);
}

function words(s) {
  return s.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
}
