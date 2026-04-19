export type {
  CartDiscount,
  CartHandlerOptions,
  CartLine,
  CartLineInput,
  CartLineKey,
  CartListener,
  CartTotals,
  DuplicateLineStrategy,
  MinorUnits,
  SerializedCartState,
} from './types.js';
export type { CartPersistenceAdapter, LocalStorageLike } from './persistence.js';
export { createLocalStorageAdapter } from './persistence.js';
export { CartHandler } from './cart-handler.js';
