# cart-handler

Framework-agnostic shopping cart state for TypeScript. One `CartHandler` instance holds line items, optional tax/shipping/discounts, and notifies subscribers when anything changes. Use it from React, Vue, Svelte, or plain DOM code.

## Install

```bash
npm install cart-handler
```

ESM and CommonJS builds are published (`exports` in `package.json`). TypeScript types are included.

## Quick start

```ts
import { CartHandler } from 'cart-handler';

const cart = new CartHandler();

const unsubscribe = cart.subscribe((lines) => {
  console.log('Cart updated:', lines);
});

cart.addItem({
  id: 'sku-1',
  title: 'Example product',
  unitPriceMinor: 1299, // $12.99 in cents
  quantity: 1,
});

console.log(cart.getTotals().grandTotalMinor);

unsubscribe();
```

## Money (minor units)

All prices and totals use **integer minor units** (e.g. cents) via `unitPriceMinor` and the `*Minor` fields on `CartTotals`. That avoids floating-point rounding issues in checkout math.

## Line identity

- Each row has a stable **`key`**: `id`, or `id::variantId` when `variantId` is set.
- By default, **`addItem`** merges quantity when `id` + `variantId` match an existing line. Override with `duplicateLineStrategy` in the constructor (`merge` + `pricePolicy`, or `alwaysAppend`).

## Custom data (per line and per cart)

**Per line:** use **`metadata`** on `addItem` / `CartLineInput` — any JSON-serializable structure you need (engraving text, bundle ids, gift wrap). It is returned on each row from `getState()` / `getSnapshot()` and included when you **`serialize()`** / **`hydrate()`**.

```ts
cart.addItem({
  id: 'sku-1',
  unitPriceMinor: 500,
  quantity: 1,
  metadata: { engraving: 'Hello', source: 'campaign-x' },
});
```

**Per cart:** use **`getExtras`**, **`setExtras`**, and **`patchExtras`** for cart-wide fields (affiliate code, experiment flags, checkout notes). These are included in **`serialize()`** / **`hydrate()`** and therefore in **`localStorage`** when persistence is attached. Optional constructor **`initialExtras`** seeds the bag.

```ts
cart.patchExtras({ affiliateId: 'partner-42' });
console.log(cart.getExtras());

cart.setExtras({}); // clear extras
```

`clear()` removes lines and coupon/discount defaults; it does **not** clear `extras` (so session-level flags can survive an empty cart). Call `setExtras({})` if you want those gone too.

## Checkout fields

Set these from your own tax/shipping engines or APIs:

- `setTaxMinor`, `setShippingMinor`
- `setDiscount` — `{ kind: 'none' }`, `{ kind: 'fixed', amountMinor }`, or `{ kind: 'percent', percent }` (percent applies to the subtotal after line discounts)
- `setCouponCode` / `getCouponCode` — stores a string; amount logic stays in your backend or `setDiscount`

Use **`getTotals()`** for `merchandiseMinor`, `subtotalMinor`, `taxableBaseMinor`, `grandTotalMinor`, and related breakdowns.

## Persistence

Implement **`CartPersistenceAdapter`** (`load` / `save` / `clear`) or use **`createLocalStorageAdapter(key, storage?)`** with `localStorage` or `sessionStorage`.

**Important:** `attachPersistence` only binds the adapter; it does **not** write immediately, so existing storage is not overwritten before you call `loadFromPersistence`. Typical order:

```ts
import { CartHandler, createLocalStorageAdapter } from 'cart-handler';

const cart = new CartHandler();
const adapter = createLocalStorageAdapter('my-shop-cart');

cart.attachPersistence(adapter);
cart.loadFromPersistence(adapter); // restores lines + tax/shipping/discount/coupon if present

// Optional: push current in-memory state to storage without changing lines
cart.flushPersistence();
```

You can also use **`serialize()`**, **`hydrate(state)`**, and **`loadFromPersistence`** for custom sync (e.g. IndexedDB or your API).

## React (18+)

`getSnapshot` / `getServerSnapshot` pair with **`useSyncExternalStore`** so the cart and SSR stay consistent:

```tsx
import { useSyncExternalStore } from 'react';
import { cart } from './cart';

export function useCartLines() {
  return useSyncExternalStore(
    (onStoreChange) => cart.subscribe(onStoreChange),
    () => cart.getSnapshot(),
    () => cart.getServerSnapshot(),
  );
}
```

Construct the server-side cart with the same **`initialLines`** you used when rendering HTML.

## Vue (3)

**Yes — Vue is fully supported.** The library does not import Vue; you keep a shared `CartHandler` (module singleton or `provide`/`inject`) and wire `subscribe` into Vue reactivity.

Recommended pattern: **`shallowRef`** for the line array (the handler replaces the array when notifying) and **`computed`** for totals so you do not duplicate pricing logic.

```ts
// cart.ts — create once (e.g. singleton or create per shop session)
import { CartHandler } from 'cart-handler';

export const cart = new CartHandler();
```

```vue
<script setup lang="ts">
import { computed, onUnmounted, shallowRef } from 'vue';
import type { CartLine } from 'cart-handler';
import { cart } from './cart';

const lines = shallowRef<readonly CartLine[]>(cart.getState());

const unsubscribe = cart.subscribe((next) => {
  lines.value = next;
});

onUnmounted(() => {
  unsubscribe();
});

const totals = computed(() => cart.getTotals());

function addExample() {
  cart.addItem({
    id: 'sku-1',
    title: 'Example',
    unitPriceMinor: 999,
    quantity: 1,
  });
}
</script>

<template>
  <div>
    <p>Lines: {{ lines.length }}</p>
    <p>Grand total (minor units): {{ totals.grandTotalMinor }}</p>
    <button type="button" @click="addExample">Add item</button>
  </div>
</template>
```

For Nuxt or SSR, create the `CartHandler` per request (or per app on the client only) so server renders do not share one global cart between users.

## API overview

| Area | Methods |
|------|---------|
| Subscriptions | `subscribe`, `getState`, `getSnapshot`, `getServerSnapshot` |
| Lines | `addItem`, `setLines`, `replaceItems`, `updateLine`, `removeLine`, `removeItem`, `clear` |
| Quantities | `setQuantity`, `incrementQuantity`, `decrementQuantity` |
| Queries | `hasLine`, `hasItem`, `getLine`, `getItem`, `lineCount`, `totalQuantity`, `isEmpty` |
| Totals | `getLineTotalMinor`, `getSubtotalMinor`, `getCartDiscountMinor`, `getTotals` |
| Merge / batch | `mergeIncoming`, `batch` |
| Persistence | `attachPersistence`, `detachPersistence`, `flushPersistence`, `serialize`, `hydrate`, `loadFromPersistence` |
| Custom fields | Line: `metadata` on each item. Cart: `getExtras`, `setExtras`, `patchExtras`, `initialExtras` (constructor) |

## Development

```bash
npm install
npm run check   # TypeScript
npm run build   # dist/ via tsup (runs automatically on publish via prepublishOnly)
```

## License

ISC
