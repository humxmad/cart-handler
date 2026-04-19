import type {
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
import type { CartPersistenceAdapter } from './persistence.js';

function lineKey(id: string, variantId?: string): CartLineKey {
  return variantId ? `${id}::${variantId}` : id;
}

function clampQuantity(raw: number, max?: number): number {
  if (!Number.isFinite(raw)) return 0;
  const q = Math.max(0, Math.floor(raw));
  if (max !== undefined && Number.isFinite(max)) {
    return Math.min(q, Math.max(0, Math.floor(max)));
  }
  return q;
}

function lineGrossMinor(line: Pick<CartLine, 'unitPriceMinor' | 'quantity'>): MinorUnits {
  return Math.max(0, line.unitPriceMinor) * Math.max(0, line.quantity);
}

function clampLineDiscountMinor(line: Pick<CartLine, 'unitPriceMinor' | 'quantity' | 'lineDiscountMinor'>): MinorUnits {
  const gross = lineGrossMinor(line);
  const d = line.lineDiscountMinor ?? 0;
  if (!Number.isFinite(d) || d <= 0) return 0;
  return Math.min(Math.floor(d), gross);
}

function normalizeIncomingLine(input: CartLineInput): CartLine {
  const quantity = clampQuantity(input.quantity, input.maxQuantity);
  const base: CartLine = {
    ...input,
    key: lineKey(input.id, input.variantId),
    quantity,
    unitPriceMinor: Math.max(0, Math.floor(input.unitPriceMinor)),
  };
  const ld = input.lineDiscountMinor;
  if (ld !== undefined) {
    base.lineDiscountMinor = clampLineDiscountMinor({ ...base, lineDiscountMinor: ld });
  } else {
    delete base.lineDiscountMinor;
  }
  return base;
}

function mergeLineInput(existing: CartLine, patch: Partial<CartLineInput>): CartLineInput {
  const input: CartLineInput = {
    id: patch.id ?? existing.id,
    unitPriceMinor: patch.unitPriceMinor ?? existing.unitPriceMinor,
    quantity: patch.quantity ?? existing.quantity,
  };
  const variantId = patch.variantId !== undefined ? patch.variantId : existing.variantId;
  if (variantId !== undefined) input.variantId = variantId;
  const sku = patch.sku !== undefined ? patch.sku : existing.sku;
  if (sku !== undefined) input.sku = sku;
  const title = patch.title !== undefined ? patch.title : existing.title;
  if (title !== undefined) input.title = title;
  const imageUrl = patch.imageUrl !== undefined ? patch.imageUrl : existing.imageUrl;
  if (imageUrl !== undefined) input.imageUrl = imageUrl;
  const maxQuantity = patch.maxQuantity !== undefined ? patch.maxQuantity : existing.maxQuantity;
  if (maxQuantity !== undefined) input.maxQuantity = maxQuantity;
  const lineDiscountMinor =
    patch.lineDiscountMinor !== undefined ? patch.lineDiscountMinor : existing.lineDiscountMinor;
  if (lineDiscountMinor !== undefined) input.lineDiscountMinor = lineDiscountMinor;
  const metadata = patch.metadata !== undefined ? patch.metadata : existing.metadata;
  if (metadata !== undefined) input.metadata = metadata;
  return input;
}

const defaultDuplicateStrategy: DuplicateLineStrategy = {
  mode: 'merge',
  pricePolicy: 'useIncoming',
};

export class CartHandler {
  private lines: CartLine[] = [];
  private readonly listeners = new Set<CartListener>();
  private duplicateLineStrategy: DuplicateLineStrategy;
  private notificationDepth = 0;
  private persistence: CartPersistenceAdapter | undefined;
  private taxMinor = 0;
  private shippingMinor = 0;
  private discount: CartDiscount = { kind: 'none' };
  private couponCode: string | undefined;
  private extras: Record<string, unknown> = {};
  private readonly serverLines: readonly CartLine[];

  constructor(options: CartHandlerOptions = {}) {
    this.duplicateLineStrategy = options.duplicateLineStrategy ?? defaultDuplicateStrategy;
    if (options.initialLines?.length) {
      this.lines = options.initialLines.map((l) => normalizeIncomingLine({ ...l }));
    }
    if (options.initialExtras && Object.keys(options.initialExtras).length > 0) {
      this.extras = { ...options.initialExtras };
    }
    this.serverLines = Object.freeze([...this.lines]);
  }

  /** Shallow copy of cart-level custom fields (not line `metadata`). */
  getExtras(): Readonly<Record<string, unknown>> {
    return { ...this.extras };
  }

  /** Replace the entire extras bag; pass `{}` to clear. */
  setExtras(extras: Record<string, unknown>): void {
    this.extras = { ...extras };
    this.notify();
  }

  /** Shallow-merge keys into `extras` (overwrites overlapping keys). */
  patchExtras(patch: Record<string, unknown>): void {
    this.extras = { ...this.extras, ...patch };
    this.notify();
  }

  /** React `useSyncExternalStore` client snapshot. */
  getSnapshot = (): readonly CartLine[] => this.getState();

  /**
   * React `useSyncExternalStore` server snapshot — frozen cart as rendered on the server.
   * Override behavior by constructing a separate instance for SSR with `initialLines` only.
   */
  getServerSnapshot = (): readonly CartLine[] => this.serverLines;

  subscribe(listener: CartListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): readonly CartLine[] {
    return this.lines.map((l) => ({ ...l }));
  }

  /** Full replace of line items (e.g. after re-pricing from the catalog). */
  setLines(next: readonly CartLineInput[]): void {
    this.lines = next.map((l) => normalizeIncomingLine({ ...l }));
    this.notify();
  }

  /** @deprecated Prefer `setLines` — alias kept for familiarity with common cart APIs. */
  replaceItems(next: readonly CartLineInput[]): void {
    this.setLines(next);
  }

  addItem(input: CartLineInput): void {
    const incoming = normalizeIncomingLine({ ...input });
    if (incoming.quantity <= 0) {
      this.removeLine(incoming.key);
      return;
    }

    if (this.duplicateLineStrategy.mode === 'alwaysAppend') {
      this.lines = [...this.lines, incoming];
      this.notify();
      return;
    }

    const idx = this.lines.findIndex((l) => l.key === incoming.key);
    if (idx === -1) {
      this.lines = [...this.lines, incoming];
      this.notify();
      return;
    }

    const existing = this.lines[idx]!;
    const mergedQty = clampQuantity(
      existing.quantity + incoming.quantity,
      incoming.maxQuantity ?? existing.maxQuantity,
    );

    const unitPriceMinor =
      this.duplicateLineStrategy.pricePolicy === 'useIncoming'
        ? incoming.unitPriceMinor
        : existing.unitPriceMinor;

    const merged: CartLine = {
      ...existing,
      ...incoming,
      key: existing.key,
      quantity: mergedQty,
      unitPriceMinor,
    };
    if (incoming.lineDiscountMinor !== undefined) {
      merged.lineDiscountMinor = clampLineDiscountMinor(merged);
    } else if (existing.lineDiscountMinor !== undefined) {
      merged.lineDiscountMinor = clampLineDiscountMinor({
        ...merged,
        lineDiscountMinor: existing.lineDiscountMinor,
      });
    } else {
      delete merged.lineDiscountMinor;
    }

    this.lines = this.lines.map((l, i) => (i === idx ? merged : l));
    this.notify();
  }

  /** Upserts a line to an exact quantity (0 removes). */
  setQuantity(id: string, quantity: number, variantId?: string): void {
    const key = lineKey(id, variantId);
    const idx = this.lines.findIndex((l) => l.key === key);
    if (idx === -1) {
      return;
    }
    const existing = this.lines[idx]!;
    const q = clampQuantity(quantity, existing.maxQuantity);
    if (q <= 0) {
      this.removeLine(key);
      return;
    }
    const next = { ...existing, quantity: q };
    if (next.lineDiscountMinor !== undefined) {
      next.lineDiscountMinor = clampLineDiscountMinor(next);
    }
    this.lines = this.lines.map((l, i) => (i === idx ? next : l));
    this.notify();
  }

  incrementQuantity(id: string, delta: number, variantId?: string): void {
    const key = lineKey(id, variantId);
    const existing = this.lines.find((l) => l.key === key);
    if (!existing) return;
    this.setQuantity(id, existing.quantity + delta, variantId);
  }

  decrementQuantity(id: string, delta: number, variantId?: string): void {
    this.incrementQuantity(id, -delta, variantId);
  }

  updateLine(key: CartLineKey, patch: Partial<CartLineInput>): void {
    const idx = this.lines.findIndex((l) => l.key === key);
    if (idx === -1) return;
    const existing = this.lines[idx]!;
    const mergedInput = mergeLineInput(existing, patch);
    const next = normalizeIncomingLine(mergedInput);
    // Preserve stable key unless id/variantId changed identity
    const nextKey = lineKey(next.id, next.variantId);
    if (nextKey !== key) {
      this.lines = this.lines.filter((_, i) => i !== idx);
      this.addItem(next);
      return;
    }
    const finalized: CartLine = { ...next, key };
    if (finalized.quantity <= 0) {
      this.removeLine(key);
      return;
    }
    this.lines = this.lines.map((l, i) => (i === idx ? finalized : l));
    this.notify();
  }

  removeLine(key: CartLineKey): void {
    const before = this.lines.length;
    this.lines = this.lines.filter((l) => l.key !== key);
    if (this.lines.length !== before) this.notify();
  }

  removeItem(id: string, variantId?: string): void {
    this.removeLine(lineKey(id, variantId));
  }

  clear(): void {
    if (this.lines.length === 0 && !this.couponCode && this.discount.kind === 'none') {
      return;
    }
    this.lines = [];
    this.couponCode = undefined;
    this.discount = { kind: 'none' };
    this.notify();
  }

  hasLine(key: CartLineKey): boolean {
    return this.lines.some((l) => l.key === key);
  }

  hasItem(id: string, variantId?: string): boolean {
    return this.hasLine(lineKey(id, variantId));
  }

  getLine(key: CartLineKey): CartLine | undefined {
    const found = this.lines.find((l) => l.key === key);
    return found ? { ...found } : undefined;
  }

  getItem(id: string, variantId?: string): CartLine | undefined {
    return this.getLine(lineKey(id, variantId));
  }

  /** Count of distinct line rows. */
  get lineCount(): number {
    return this.lines.length;
  }

  /** Sum of all line quantities. */
  get totalQuantity(): number {
    return this.lines.reduce((sum, l) => sum + l.quantity, 0);
  }

  /** Whether any line exists. */
  get isEmpty(): boolean {
    return this.lines.length === 0;
  }

  setTaxMinor(amount: MinorUnits): void {
    const next = Math.max(0, Math.floor(amount));
    if (next === this.taxMinor) return;
    this.taxMinor = next;
    this.notify();
  }

  setShippingMinor(amount: MinorUnits): void {
    const next = Math.max(0, Math.floor(amount));
    if (next === this.shippingMinor) return;
    this.shippingMinor = next;
    this.notify();
  }

  setDiscount(discount: CartDiscount): void {
    this.discount = discount;
    this.notify();
  }

  getDiscount(): CartDiscount {
    return this.discount;
  }

  /** Store a coupon or promo code string; amount logic stays in `setDiscount` / your backend. */
  setCouponCode(code: string | undefined): void {
    if (code === this.couponCode) return;
    this.couponCode = code;
    this.notify();
  }

  getCouponCode(): string | undefined {
    return this.couponCode;
  }

  getLineTotalMinor(line: Pick<CartLine, 'unitPriceMinor' | 'quantity' | 'lineDiscountMinor'>): MinorUnits {
    return Math.max(0, lineGrossMinor(line) - clampLineDiscountMinor(line));
  }

  getSubtotalMinor(): MinorUnits {
    return this.lines.reduce((sum, l) => sum + this.getLineTotalMinor(l), 0);
  }

  getCartDiscountMinor(): MinorUnits {
    const base = this.getSubtotalMinor();
    if (this.discount.kind === 'none') return 0;
    if (this.discount.kind === 'fixed') {
      return Math.min(Math.max(0, Math.floor(this.discount.amountMinor)), base);
    }
    const p = this.discount.percent;
    if (!Number.isFinite(p) || p <= 0) return 0;
    return Math.min(base, Math.floor((base * p) / 100));
  }

  getTotals(): CartTotals {
    const merchandiseMinor = this.lines.reduce((sum, l) => sum + lineGrossMinor(l), 0);
    const lineDiscountMinor = this.lines.reduce((sum, l) => sum + clampLineDiscountMinor(l), 0);
    const subtotalMinor = Math.max(0, merchandiseMinor - lineDiscountMinor);
    const cartDiscountMinor = (() => {
      if (this.discount.kind === 'none') return 0;
      if (this.discount.kind === 'fixed') {
        return Math.min(Math.max(0, Math.floor(this.discount.amountMinor)), subtotalMinor);
      }
      const p = this.discount.percent;
      if (!Number.isFinite(p) || p <= 0) return 0;
      return Math.min(subtotalMinor, Math.floor((subtotalMinor * p) / 100));
    })();
    const taxableBaseMinor = Math.max(0, subtotalMinor - cartDiscountMinor);
    const discountMinor = lineDiscountMinor + cartDiscountMinor;
    const grandTotalMinor = taxableBaseMinor + this.taxMinor + this.shippingMinor;
    return {
      merchandiseMinor,
      lineDiscountMinor,
      subtotalMinor,
      cartDiscountMinor,
      discountMinor,
      taxableBaseMinor,
      taxMinor: this.taxMinor,
      shippingMinor: this.shippingMinor,
      grandTotalMinor,
    };
  }

  /** Guest → authenticated merge, sale recovery, etc. */
  mergeIncoming(incoming: readonly CartLineInput[]): void {
    this.batch(() => {
      for (const raw of incoming) {
        this.addItem(raw);
      }
    });
  }

  /**
   * Perform multiple mutations with a single notification at the end.
   * Re-entrancy increments depth; outermost batch triggers `notify`.
   */
  batch(fn: () => void): void {
    this.notificationDepth += 1;
    try {
      fn();
    } finally {
      this.notificationDepth -= 1;
      if (this.notificationDepth === 0) this.notify();
    }
  }

  /**
   * Binds a persistence adapter without writing immediately, so existing storage
   * stays intact until you call `loadFromPersistence` or mutate the cart.
   * To push the current in-memory cart to storage right away, use `flushPersistence()`.
   */
  attachPersistence(adapter: CartPersistenceAdapter): void {
    this.persistence = adapter;
  }

  detachPersistence(): void {
    this.persistence = undefined;
  }

  /** Persists the current in-memory cart without mutating lines (use after `attachPersistence` if you must push state immediately). */
  flushPersistence(): void {
    this.persist();
  }

  /** Serialize current monetary side-effects (tax, shipping, discounts) and lines. */
  serialize(): SerializedCartState {
    let out: SerializedCartState = {
      version: 1,
      lines: this.getState().map((l) => ({ ...l })),
      taxMinor: this.taxMinor,
      shippingMinor: this.shippingMinor,
      discount: this.discount,
    };
    if (this.couponCode !== undefined) {
      out = { ...out, couponCode: this.couponCode };
    }
    if (Object.keys(this.extras).length > 0) {
      out = { ...out, extras: { ...this.extras } };
    }
    return out;
  }

  hydrate(state: SerializedCartState): void {
    if (state.version !== 1) {
      throw new Error(`CartHandler.hydrate: unsupported state version ${String(state.version)}`);
    }
    this.batch(() => {
      this.lines = state.lines.map((l) => normalizeIncomingLine({ ...l }));
      this.taxMinor = Math.max(0, Math.floor(state.taxMinor));
      this.shippingMinor = Math.max(0, Math.floor(state.shippingMinor));
      this.discount = state.discount;
      this.couponCode = state.couponCode;
      this.extras = state.extras && Object.keys(state.extras).length > 0 ? { ...state.extras } : {};
    });
  }

  loadFromPersistence(adapter: CartPersistenceAdapter): boolean {
    const raw = adapter.load();
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw) as SerializedCartState;
      this.hydrate(parsed);
      return true;
    } catch {
      return false;
    }
  }

  private persist(): void {
    if (!this.persistence) return;
    try {
      this.persistence.save(JSON.stringify(this.serialize()));
    } catch {
      // Swallow storage quota / private mode errors — hosts can wrap adapters to log.
    }
  }

  private notify(): void {
    if (this.notificationDepth > 0) return;
    const snapshot = this.getState();
    for (const listener of this.listeners) listener(snapshot);
    this.persist();
  }
}
