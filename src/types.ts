/** Money in minor units (e.g. cents) to avoid floating-point errors. */
export type MinorUnits = number;

export type CartLineKey = string;

export interface CartLineInput {
  id: string;
  variantId?: string;
  sku?: string;
  title?: string;
  imageUrl?: string;
  /** Price per single unit, in minor currency units (e.g. cents). */
  unitPriceMinor: MinorUnits;
  quantity: number;
  /** Optional cap; `addItem` / `setQuantity` clamp to this maximum. */
  maxQuantity?: number;
  /** Fixed discount for the whole line (not per unit), in minor units. */
  lineDiscountMinor?: MinorUnits;
  metadata?: Record<string, unknown>;
}

export interface CartLine extends CartLineInput {
  /** Stable key for this row (`id` or `id::variantId`). */
  key: CartLineKey;
}

export type CartListener = (lines: readonly CartLine[]) => void;

export type DuplicateLineStrategy =
  /** Combine quantities when the same `id` + `variantId` is added again. */
  | { mode: 'merge'; pricePolicy: 'keepExisting' | 'useIncoming' }
  /** Always append a new line (allows duplicate ids if your catalog needs it). */
  | { mode: 'alwaysAppend' };

export type CartDiscount =
  | { kind: 'none' }
  | { kind: 'fixed'; amountMinor: MinorUnits }
  /** Whole cart, after subtotal before tax/shipping: e.g. `10` means 10%. */
  | { kind: 'percent'; percent: number };

export interface CartTotals {
  /** Sum of unit price × quantity for all lines (before any discounts). */
  merchandiseMinor: MinorUnits;
  /** Sum of per-line discounts. */
  lineDiscountMinor: MinorUnits;
  /** Merchandise minus line discounts — the usual checkout "Subtotal". */
  subtotalMinor: MinorUnits;
  /** Cart-level discount from `setDiscount` (fixed or percent). */
  cartDiscountMinor: MinorUnits;
  /** Line discounts plus cart-level discount. */
  discountMinor: MinorUnits;
  /** Amount tax should be calculated from if you derive tax client-side. */
  taxableBaseMinor: MinorUnits;
  taxMinor: MinorUnits;
  shippingMinor: MinorUnits;
  grandTotalMinor: MinorUnits;
}

export interface SerializedCartState {
  version: 1;
  lines: CartLine[];
  taxMinor: MinorUnits;
  shippingMinor: MinorUnits;
  discount: CartDiscount;
  couponCode?: string;
  /** Arbitrary cart-level data (e.g. affiliate id, A/B flags); persisted with `serialize` / `hydrate`. */
  extras?: Record<string, unknown>;
}

export interface CartHandlerOptions {
  initialLines?: readonly CartLineInput[];
  /** How to treat adding a line that matches an existing `id` + `variantId`. */
  duplicateLineStrategy?: DuplicateLineStrategy;
  /** Initial `extras` bag; see `getExtras` / `setExtras`. */
  initialExtras?: Record<string, unknown>;
}
