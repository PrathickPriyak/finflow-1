# Phase 1: Backend Bug Analysis Report

> Generated: Feb 2026
> Scope: All backend Python files (routers, utils, auth, models)
> Method: Targeted pattern grep across codebase

---

## BUG 1 (P1) — Proportional Bulk Allocation Can Exceed Per-Transaction Cap

**Files:** `payments/payments.py:859-865`, `payments/collections.py:1282-1288`

**Problem:** In both `bulk_pay_customer` and `bulk_collect_from_customer`, the proportional allocation uses `min(allocation, info["remaining"])` to cap each allocation. However, the rounding correction `allocations[first_key] += diff` is applied AFTER the cap. This means the first transaction's allocation can be pushed above its `remaining` limit.

**Example:** 3 transactions each with `remaining=100`, `total_amount=300`. Floating-point gives 99.99 per item = 299.97 total. `diff = 0.03`, so `allocations[first_key]` becomes `100.02`, exceeding the 100 cap.

**Impact:** The atomic `find_one_and_update` with `amount_remaining: {$gte: amount}` in the per-transaction loop will catch this and raise an exception, causing a partial rollback. The user gets a confusing "concurrent update detected" error on a perfectly valid operation.

**Fix:** After adding the diff, re-clamp: `allocations[first_key] = min(allocations[first_key], tx_remaining[first_key]["remaining"])`. Or distribute the remainder to the last item instead.

---

## BUG 2 (P1) — Reconciliation Treats Cancelled Collections as Pending Discrepancies

**File:** `reconciliation.py:64`

**Problem:** The query `{"status": {"$ne": "settled"}}` includes `cancelled` and `overpaid` collections. Cancelled collections (from reversed transactions) are flagged as orphans or discrepancies, inflating the reconciliation report with false positives.

**Impact:** Reconciliation reports show phantom issues for legitimately cancelled collections, reducing trust in the report and creating noise.

**Fix:** Change filter to `{"status": {"$nin": ["settled", "cancelled", "overpaid"]}}` or explicitly match only `["pending", "partial"]`.

---

## BUG 3 (P2) — Unbounded `to_list(100000)` in Excel Exports

**Files:** `expenses.py:462`, `wallets.py:226`

**Problem:** Excel export endpoints load up to 100,000 documents into memory at once. With large datasets, this can cause OOM crashes or extreme response latency on the server.

**Impact:** Server instability under production workloads with large expense/operation histories. Memory spike can affect all concurrent requests.

**Fix:** Use streaming pagination or apply a hard cap matching `MAX_EXPORT_ROWS` (used elsewhere in `dashboard.py`). Consider chunked writes to the Excel buffer.

---

## BUG 4 (P2) — Wallet Operations Query Missing `_id` Projection

**File:** `wallets.py:180`

**Problem:** The `find()` query for wallet operations does NOT include `{"_id": 0}` as a projection, unlike nearly every other query in the codebase. While `serialize_docs()` strips `_id` before returning, the MongoDB cursor still loads the full ObjectId field into memory for every document.

**Impact:** Minor — extra memory per document and inconsistency with codebase conventions. Not a serialization bug thanks to `serialize_docs`, but breaks the defensive pattern.

**Fix:** Add `{"_id": 0}` projection: `db.wallet_operations.find(query, {"_id": 0}).sort(...)`.

---

## BUG 5 (P1) — Settlement Rounding Adjustment Not Persisted to Collection Document

**File:** `payments/collections.py:243-244`

**Problem:** When a rounding adjustment is detected (micro-amount within 1.0 tolerance), the code sets `settlement_record["rounding_adjustment"] = rounding_adjustment` and adjusts `new_total_settled` in memory. However, the collection document in MongoDB has already been updated via `find_one_and_update` with the original `$inc`. The corrected `new_total_settled = updated_col.get("amount", 0)` is NOT written back to the collection. The `$set: {status: new_status}` update at line 286 only updates the status, not `settled_amount`.

**Impact:** When rounding absorbs a micro-amount (e.g., 0.47), the DB `settled_amount` remains at the pre-absorption value instead of being corrected to `amount`. This means: (a) `amount - settled_amount` is non-zero but < 1.0, causing the collection to report a tiny residual, and (b) subsequent void calculations may produce incorrect reversal amounts.

**Fix:** After computing rounding adjustment, also update `settled_amount` and `total_charges` on the collection:
```python
if rounding_adjustment > 0:
    await db.collections.update_one(
        {"id": collection_id},
        {"$set": {"settled_amount": new_total_settled, "status": new_status}}
    )
```

---

## BUG 6 (P2) — `wallets.py:181` Uses `to_list(None)` Despite Having `.limit(limit)`

**File:** `wallets.py:181`

**Problem:** The query chain is `.skip(skip).limit(limit).to_list(None)`. While MongoDB respects the cursor limit, `to_list(None)` semantically means "no limit" which is confusing and inconsistent with the rest of the codebase where `to_list(limit)` is used.

**Impact:** Low — functionally correct but a code smell that could mask real issues if the `.limit()` is accidentally removed.

**Fix:** Change `to_list(None)` to `to_list(limit)`.

---

## BUG 7 (P2) — Backlog Item BL-01 Already Fixed But Not Marked

**File:** `customers.py:264-271`, `memory/BUGS.md:220`

**Problem:** BUGS.md lists BL-01 as "Card deletion has no active-transaction check" with status "Pending". However, the code at `customers.py:264-271` already has the guard:
```python
active_txns = await db.transactions.count_documents({
    "is_deleted": False, "customer_id": customer_id, "card_id": card_id,
    "status": {"$in": ["pending", "pending_swipe", "partially_completed", "payment_pending"]}
})
if active_txns > 0:
    raise HTTPException(...)
```

**Impact:** Tracking confusion — the backlog shows an unfixed bug that is actually already resolved.

**Fix:** Update BUGS.md to mark BL-01 as FIXED.

---

## BUG 8 — FALSE POSITIVE (Removed)

All `find_one_and_update` calls in `payments.py` already include `projection={"_id": 0}`. Verified all 7 locations. No fix needed.

---

## BUG 10 — DOWNGRADED (Correctly Handled)

The overpayment optimistic lock (`settle_filter["settled_amount"] = X`) works correctly: if a concurrent settlement changes `settled_amount`, the filter won't match and rollback occurs. This is the standard optimistic concurrency pattern. No fix needed.

---

## Summary Table

| # | Priority | File | Bug Summary | Status |
|---|----------|------|-------------|--------|
| 1 | P1 | `payments.py`, `collections.py` | Proportional rounding adjustment exceeds per-transaction cap | FIXED |
| 2 | P1 | `reconciliation.py` | Cancelled collections treated as pending discrepancies | FIXED |
| 3 | P2 | `expenses.py`, `wallets.py` | Unbounded `to_list(100000)` in Excel exports | FIXED |
| 4 | P2 | `wallets.py` | Missing `_id` projection on wallet operations query | FIXED |
| 5 | P1 | `collections.py` | Rounding adjustment not persisted to DB (settled_amount drift) | FIXED |
| 6 | P2 | `wallets.py` | `to_list(None)` with `.limit()` — code smell | FIXED |
| 7 | P2 | `BUGS.md` | BL-01 already fixed but still listed as pending | FIXED |
| 8 | — | `payments.py` | FALSE POSITIVE — all calls already have projection | N/A |
| 9 | P2 | `dashboard.py` | New system gets perfect health score by default | FIXED |
| 10 | — | `collections.py` | DOWNGRADED — optimistic lock handles race correctly | N/A |

**Fixed:** 7 | **False Positives:** 2 | **Downgraded:** 1

---

## Next: Phase 2 — Frontend Analysis
Focus on `NewTransactionPage.js`, `SettlementWizard.js`, and key component state management.
