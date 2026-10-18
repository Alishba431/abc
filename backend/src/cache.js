// Tiny invalidation bus so read caches (QR state, chat rooms) drop entries when the underlying data changes.
const listeners = new Set();

const onInvalidate = (fn) => listeners.add(fn);
const invalidate = (key) => listeners.forEach((fn) => fn(key));
const clearAll = () => listeners.forEach((fn) => fn(null));

module.exports = { onInvalidate, invalidate, clearAll };
