/**
 * Pluggable persistence so the core stays free of `window` / Node assumptions.
 * Implement with `localStorage`, `sessionStorage`, IndexedDB, or a server sync layer.
 */
export interface CartPersistenceAdapter {
  load(): string | null;
  save(payload: string): void;
  clear(): void;
}

export type LocalStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function createLocalStorageAdapter(
  key: string,
  storage: LocalStorageLike = globalThis.localStorage,
): CartPersistenceAdapter {
  return {
    load: () => storage.getItem(key),
    save: (payload) => storage.setItem(key, payload),
    clear: () => storage.removeItem(key),
  };
}
