# Phase 2: Frontend Bug Analysis Report

> Generated: Feb 2026
> Scope: All frontend JS/JSX files (pages, components)
> Method: Targeted grep pattern scan + code review of critical paths

---

## BUG F1 (P1) — Division by Zero in Proportional Allocation Preview

**File:** `pages/CustomerDetailPage.js:264, 402`

**Problem:** In the `bulkPayPreview` and `bulkCollectPreview` memos, the proportional allocation divides by `totalSelectedPayouts` or `totalSelectedCollections`. When these totals are 0 (all selected items have zero pending amount), the division produces `NaN`, displaying "₹NaN" in the UI.

**Fix Applied:** Added guard `totalSelectedPayouts > 0 ? ... : 0` to both divisions.

---

## BUG F2 (P1) — `.sort()` Mutates State-Derived Arrays Inside useMemo

**File:** `pages/CustomerDetailPage.js:253, 387`

**Problem:** FIFO allocation in `bulkPayPreview` and `bulkCollectPreview` calls `.sort()` directly on `selectedPayoutItems` and `selectedCollectionItems`, which are derived from React state. `.sort()` mutates arrays in-place, violating React's immutability principle. Can cause unpredictable re-render behavior.

**Fix Applied:** Changed `.sort(...)` to `[...array].sort(...)` to sort a copy instead.

---

## BUG F3 (P2) — Reconciliation Health Ring Defaults to 100% with No Data

**File:** `pages/ReconciliationPage.js:494`

**Problem:** When `totalChecks` is 0 (no reconciliation has been run), the health ring shows 100%, suggesting the system is perfectly healthy when no data exists. Same pattern as backend Bug 9.

**Fix Applied:** Changed default from `100` to `0`.

---

## BUG F4 (P2) — Debounce Timer Not Cleaned Up on Unmount

**File:** `pages/NewTransactionPage.js:199`

**Problem:** The customer search debounce uses `setTimeout` via `searchDebounceRef`, but there's no cleanup when the component unmounts. If the timer fires after unmount, it attempts to call `setCustomers` on an unmounted component.

**Fix Applied:** Added cleanup in the mount `useEffect`: `return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };`

---

## Summary Table

| # | Priority | File | Bug Summary | Status |
|---|----------|------|-------------|--------|
| F1 | P1 | `CustomerDetailPage.js` | Division by zero in proportional allocation preview (NaN display) | FIXED |
| F2 | P1 | `CustomerDetailPage.js` | `.sort()` mutates state arrays inside `useMemo` | FIXED |
| F3 | P2 | `ReconciliationPage.js` | Health ring shows 100% with no data | FIXED |
| F4 | P2 | `NewTransactionPage.js` | Debounce timer not cleaned up on unmount | FIXED |

**Fixed:** 4 | **P1:** 2 | **P2:** 2
