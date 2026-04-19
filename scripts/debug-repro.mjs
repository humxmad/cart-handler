/**
 * Repro: storage already has a cart; in-memory cart is empty.
 * Typical app order: attachPersistence then loadFromPersistence.
 */
import { CartHandler, createLocalStorageAdapter } from '../dist/index.js';

const key = 'debug-cart-f558a0';
const seeded = {
  version: 1,
  lines: [{ key: 'sku-a', id: 'sku-a', unitPriceMinor: 999, quantity: 3 }],
  taxMinor: 50,
  shippingMinor: 0,
  discount: { kind: 'none' },
};
const mem = new Map([[key, JSON.stringify(seeded)]]);
const storage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, v),
  removeItem: (k) => void mem.delete(k),
};

const cart = new CartHandler();
const adapter = createLocalStorageAdapter(key, storage);

console.log('[repro] stored before attach:', mem.get(key)?.slice(0, 80));
cart.attachPersistence(adapter);
console.log('[repro] stored after attach:', mem.get(key)?.slice(0, 120));
console.log('[repro] lines after attach (memory):', cart.getState().length);

const ok = cart.loadFromPersistence(adapter);
console.log('[repro] loadFromPersistence returned:', ok);
console.log('[repro] lines after load (memory):', cart.getState().length);
console.log('[repro] expected lines if hydrate worked: 1');
