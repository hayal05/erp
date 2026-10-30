// JSON-only response patches. Null means unchanged; arrays with stable ids preserve
// ordering without resending unchanged rows. Other arrays are patched by index.
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const keyed = a => a.every(v => object(v) && ['string','number'].includes(typeof v.id))
  && new Set(a.map(v => JSON.stringify(v.id))).size === a.length;
export function diffJson(before, after) {
  if (Object.is(before, after)) return null;
  if (Array.isArray(before) && Array.isArray(after)) {
    if (keyed(before) && keyed(after)) {
      const old = new Map(before.map(v => [JSON.stringify(v.id), v]));
      const changes = after.flatMap(v => {
        const key = JSON.stringify(v.id), patch = old.has(key) ? diffJson(old.get(key), v) : ['v', v];
        return patch ? [[v.id, patch]] : [];
      });
      const order = after.map(v => v.id);
      const sameOrder = JSON.stringify(before.map(v => v.id)) === JSON.stringify(order);
      return sameOrder && !changes.length ? null : ['k', sameOrder ? null : order, changes];
    }
    const changes = after.flatMap((v, i) => {
      const patch = i < before.length ? diffJson(before[i], v) : ['v', v];
      return patch ? [[i, patch]] : [];
    });
    return before.length === after.length && !changes.length ? null : ['a', after.length, changes];
  }
  if (object(before) && object(after)) {
    const removed = Object.keys(before).filter(k => !Object.hasOwn(after, k));
    const changes = Object.keys(after).flatMap(k => {
      const patch = Object.hasOwn(before, k) ? diffJson(before[k], after[k]) : ['v', after[k]];
      return patch ? [[k, patch]] : [];
    });
    return !removed.length && !changes.length ? null : ['o', removed, changes];
  }
  return ['v', after];
}
export function applyJsonDelta(before, patch) {
  if (patch === null) return before;
  const [kind, a, b] = patch;
  if (kind === 'v') return a;
  if (kind === 'k') {
    const values = new Map(before.map(v => [JSON.stringify(v.id), v]));
    for (const [id, change] of b) {
      const key = JSON.stringify(id); values.set(key, applyJsonDelta(values.get(key), change));
    }
    return (a ?? before.map(v => v.id)).map(id => values.get(JSON.stringify(id)));
  }
  if (kind === 'a') {
    const out = before.slice(0, a); out.length = a;
    for (const [i, change] of b) out[i] = applyJsonDelta(before[i], change);
    return out;
  }
  if (kind === 'o') {
    const out = { ...before };
    for (const key of a) delete out[key];
    for (const [key, change] of b) Object.defineProperty(out, key, {
      value: applyJsonDelta(before[key], change), enumerable: true, writable: true, configurable: true,
    });
    return out;
  }
  throw new Error('Unknown response patch');
}
