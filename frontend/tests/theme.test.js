import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeTheme, otherTheme, readTheme, saveTheme, applyTheme } from '../src/components/theme.js';
import { pageInfo } from '../src/components/pagination.js';
import { toastsReducer, MAX_TOASTS } from '../src/components/toasts.js';

test('theme: dark is the default; only "light" selects light; toggle flips', () => {
  for (const v of [undefined, null, '', 'dark', 'blue', 5]) assert.equal(normalizeTheme(v), 'dark');
  assert.equal(normalizeTheme('light'), 'light');
  assert.equal(otherTheme('dark'), 'light');
  assert.equal(otherTheme('light'), 'dark');
});

test('theme storage: round trip, and blocked storage never throws', () => {
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(readTheme(store), 'dark');
  saveTheme('light', store);
  assert.equal(readTheme(store), 'light');
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(readTheme(blocked), 'dark');
  assert.doesNotThrow(() => saveTheme('light', blocked));
  assert.equal(readTheme(undefined), 'dark');
});

test('applyTheme sets data-theme on the root element', () => {
  const root = { dataset: {} };
  applyTheme('light', root); assert.equal(root.dataset.theme, 'light');
  applyTheme('nonsense', root); assert.equal(root.dataset.theme, 'dark');
  assert.doesNotThrow(() => applyTheme('light', null));
});

test('pageInfo: ranges, clamping and empty lists', () => {
  assert.deepEqual(pageInfo({ page: 1, pageSize: 20, total: 45 }), { page: 1, pages: 3, from: 1, to: 20, total: 45, hasPrev: false, hasNext: true });
  assert.deepEqual(pageInfo({ page: 3, pageSize: 20, total: 45 }), { page: 3, pages: 3, from: 41, to: 45, total: 45, hasPrev: true, hasNext: false });
  assert.deepEqual(pageInfo({ page: 9, pageSize: 20, total: 45 }).page, 3);      // beyond the end -> last page
  assert.deepEqual(pageInfo({ page: -2, pageSize: 20, total: 45 }).page, 1);
  assert.deepEqual(pageInfo({ page: 1, pageSize: 20, total: 0 }), { page: 1, pages: 1, from: 0, to: 0, total: 0, hasPrev: false, hasNext: false });
  assert.equal(pageInfo({ page: 'x', pageSize: 0, total: 'y' }).pages, 1);       // junk in, safe values out
  assert.equal(pageInfo({ page: 1, pageSize: 20, total: 40 }).pages, 2);          // exact multiple: no empty last page
});

test('toasts: add keeps newest, caps the stack, remove by id', () => {
  let list = [];
  for (let i = 1; i <= MAX_TOASTS + 2; i++) list = toastsReducer(list, { type: 'add', toast: { id: i } });
  assert.deepEqual(list.map((t) => t.id), [3, 4, 5, 6]);
  list = toastsReducer(list, { type: 'remove', id: 4 });
  assert.deepEqual(list.map((t) => t.id), [3, 5, 6]);
  assert.equal(toastsReducer(list, { type: 'unknown' }), list);
});

// ---- WCAG contrast of the colour tokens, in both themes ----
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const block = (selector) => {
  const m = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `block ${selector} not found`);
  return Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((x) => [x[1], x[2]]));
};
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const themes = { dark: block(':root, :root[data-theme="dark"]'), light: block(':root[data-theme="light"]') };
// [foreground, background, minimum ratio]: 4.5 for text, 3 for control borders (WCAG 1.4.11)
const PAIRS = [
  ['text', 'bg', 4.5], ['text', 'surface', 4.5], ['text', 'surface-2', 4.5],
  ['muted', 'bg', 4.5], ['muted', 'surface', 4.5], ['muted', 'surface-2', 4.5],
  ['accent', 'bg', 4.5], ['accent', 'surface', 4.5],
  ['on-accent', 'accent', 4.5],
  ['danger', 'bg', 4.5], ['danger', 'surface', 4.5], ['warn', 'surface', 4.5], ['ok', 'surface', 4.5],
  ['text', 'input-bg', 4.5], ['input-border', 'input-bg', 3], ['input-border', 'surface', 3],
];
for (const [name, tokens] of Object.entries(themes)) {
  test(`contrast (${name} theme): text, status colours and control borders meet WCAG AA`, () => {
    const bad = [];
    for (const [fg, bg, min] of PAIRS) {
      assert.ok(tokens[fg] && tokens[bg], `missing token ${fg}/${bg} in ${name}`);
      const r = ratio(tokens[fg], tokens[bg]);
      if (r < min) bad.push(`${fg} on ${bg}: ${r.toFixed(2)} < ${min}`);
    }
    assert.deepEqual(bad, []);
  });
}
