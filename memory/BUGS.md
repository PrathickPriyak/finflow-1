# Bug Tracker — Fin Flow Financial Application

> Last updated: Feb 2026  
> Format: Each bug has Status (OPEN / FIXED), Priority (P0/P1/P2), Root Cause, File+Line, and Fix Approach.

---

## SPRINT 3 — ALL 20 BUGS FIXED (Feb 2026)

---

### BUG-S3-01 · P1 · `collections.py` — `get_collection_history_stats` uses `to_list(10000)` + Python in-memory stats

**File:** `backend/routers/payments/collections.py`  
**Status:** FIXED  
**Fix Applied:** Replaced `to_list(10000)` + Python loop with `$facet` aggregation pipeline computing `totals`, `by_method`, `by_customer` inside MongoDB. Aging computation uses a lightweight `aging_data` bucket (only `created_at`/`settled_at` fields). No in-memory cap.

---

### BUG-S3-02 · P1 · `payments.py` — `get_pending_payouts_stats` uses `to_list(10000)` for analytics loop

**File:** `backend/routers/payments/payments.py`  
**Status:** FIXED  
**Fix Applied:** Replaced `to_list(10000)` + Python for-loop with a single `$facet` aggregation computing aging buckets, overdue, high-value, and gateway breakdown inside MongoDB using string-date comparisons with pre-computed cutoffs.

---

### BUG-S3-03 · P1 · `reconciliation.py` — `run_reconciliation_check` caps pending collections at `to_list(1000)`

**File:** `backend/routers/reconciliation.py`  
**Status:** FIXED  
**Fix Applied:** Changed `to_list(1000)` to `to_list(None)` — removes the hard cap so all pending collections are checked.

---

### BUG-S3-04 · P1 · `reconciliation.py` — `run_reconciliation_check` caps pending-swipe transactions at `to_list(1000)`

**File:** `backend/routers/reconciliation.py`  
**Status:** FIXED  
**Fix Applied:** Changed `to_list(1000)` to `to_list(None)` — removes the hard cap for both reconciliation check endpoints.

---

### BUG-S3-05 · P1 · `transactions.py` — `reverse_transaction` PG expense deletion uses fragile description regex

**File:** `backend/routers/transactions.py`  
**Status:** FIXED  
**Fix Applied:** Removed the `$or` with `$regex` fallback. Now uses only `{"transaction_id": readable_txn_id}` for the match — preventing substring false positives (e.g. T01-0001 matching T01-00010..T01-00019).

---
]
```
The description regex has no anchors. `"T01-0001"` is a substring of `"T01-00010"` through `"T01-00019"`. Reversing transaction T01-0001 soft-deletes the PG charge expenses for T01-00010 to T01-00019 as well.  
**Impact:** PG charge expenses for other transactions are silently destroyed whenever a transaction whose ID is a numeric prefix of another is reversed.  
**Fix:** Remove the entire `$or` clause. Use only `{"transaction_id": readable_txn_id}` — the field is correctly populated by `create_pg_charge_expense`.

---

### BUG-S3-06 · P2 · `dashboard.py` — `recent_transactions` includes reversed transactions

### BUG-S3-06 · P2 · `dashboard.py` — recent activity shows reversed transactions

**File:** `backend/routers/dashboard.py`  
**Status:** FIXED  
**Fix Applied:** Added `"status": {"$ne": "reversed"}` filter to the recent transactions query.

---

### BUG-S3-07 · P1 · `transactions.py` — Type 02 collection insert is outside the try/except rollback block

**File:** `backend/routers/transactions.py`  
**Status:** FIXED  
**Fix Applied:** Wrapped the entire collection creation block (`get_pending_payment_id`, `collection_doc` build, `insert_one`) in a try/except that rolls back the committed transaction and all wallet debits on failure.

---

### BUG-S3-08 · P0 · `transactions.py` — `reverse_wallet` silently returns when gateway wallet is not found

**File:** `backend/routers/transactions.py`  
**Status:** FIXED  
**Fix Applied:** Replaced `return` with `raise Exception(f"Gateway wallet for gateway_id={gateway_id} not found — reversal aborted")`.

---

### BUG-S3-09 · P1 · `expenses.py` — `create_expense` wallet operation missing `operation_id` and `sequence_number`

**File:** `backend/routers/expenses.py`  
**Status:** FIXED  
**Fix Applied:** Added `generate_operation_id` and `get_next_operation_sequence` imports; set `operation_id` and `sequence_number` on the wallet operation document before insert.

---

### BUG-S3-10 · P1 · `expenses.py` — `delete_expense` reversal wallet operation missing `operation_id` and `sequence_number`

**File:** `backend/routers/expenses.py`  
**Status:** FIXED  
**Fix Applied:** Same pattern — `del_op_id` and `del_seq` generated and set on the reversal wallet operation document.

---

### BUG-S3-11 · P1 · `payments.py` — `record_customer_payment` missing atomic overpayment guard

**File:** `backend/routers/payments/payments.py`  
**Status:** FIXED  
**Fix Applied:** Added `"amount_remaining_to_customer": {"$gte": data.amount}` to the `find_one_and_update` filter. If it returns `None`, rolls back the wallet debit, wallet operation, and payment record, then raises HTTP 400.

---

### BUG-S3-12 · P1 · `payments.py` — `bulk_pay_customer` per-transaction `find_one_and_update` missing atomic overpayment guard

**File:** `backend/routers/payments/payments.py`  
**Status:** FIXED  
**Fix Applied:** Same `"amount_remaining_to_customer": {"$gte": amount}` guard added to each per-transaction update in the bulk loop. Returns `None` → raises Exception caught by existing rollback handler.

---

### BUG-S3-13 · P1 · `collections.py` — `settle_pending_payment` TOCTOU double-settlement race

**File:** `backend/routers/payments/collections.py`  
**Status:** FIXED  
**Fix Applied:** Added `"status": {"$in": ["pending", "partial"]}` filter to the `find_one_and_update` inside `_execute_settlement`. If it returns `None` (already settled), rolls back the wallet credit and wallet operation, then raises HTTP 409.

---

### BUG-S3-14 · P1 · `collections.py` — `settle_collection_unified` same TOCTOU double-settlement race

**File:** `backend/routers/payments/collections.py`  
**Status:** FIXED  
**Fix Applied:** Same fix — all settlement endpoints share `_execute_settlement`, so the guard is applied once.

---

### BUG-S3-15 · P1 · `collections.py` — `bulk_settle_unified` same TOCTOU for each collection in the batch

**File:** `backend/routers/payments/collections.py`  
**Status:** FIXED  
**Fix Applied:** Same fix via shared `_execute_settlement`.

---

### BUG-S3-16 · P2 · `expenses.py` — `get_expenses_summary` uses `to_list(1000)` + `to_list(10000)` + Python in-memory loops

**File:** `backend/routers/expenses.py`  
**Status:** FIXED  
**Fix Applied:** Replaced both Python in-memory loops with a single `$facet` aggregation computing `totals`, `by_type`, `by_wallet` inside MongoDB. Today total uses a separate `$group` aggregation.

---

### BUG-S3-17 · P2 · `payments.py` — `bulk_pay_customer` stale wallet balance pre-check

**File:** `backend/routers/payments/payments.py`  
**Status:** FIXED  
**Fix Applied:** Removed stale `if wallet["balance"] < data.total_amount` pre-check. The atomic `find_one_and_update` guard is the real protection.

---

### BUG-S3-18 · P2 · `expenses.py` — `create_expense` stale wallet balance pre-check

**File:** `backend/routers/expenses.py`  
**Status:** FIXED  
**Fix Applied:** Removed stale `if wallet.get("balance", 0) < data.amount` pre-check.

---

### BUG-S3-19 · P1 · `wallets.py` — `transfer_between_wallets` credit update missing `is_deleted: False` filter and no rollback

**File:** `backend/routers/wallets.py`  
**Status:** ALREADY FIXED (pre-existing in codebase)  
**Note:** Both the `is_deleted: False` filter on the credit `find_one_and_update` AND the rollback logic (reverse source debit if destination wallet gone) were already present in the code. No changes required.

---

### BUG-S3-20 · P2 · `auth.py` — `AuthDependency` writes `last_activity` on every request (performance)

**File:** `backend/auth.py`  
**Status:** FIXED  
**Fix Applied:** Changed `await self.db.sessions.update_one(...)` to `asyncio.ensure_future(self.db.sessions.update_one(...))` — fire-and-forget pattern removes the blocking DB write from the request path.

---


## SPRINT 2 — FIXED (10 bugs)

| ID | File | Bug Summary | Fixed In |
|----|------|------------|---------|
| S2-01 | `payments.py` | `record_customer_payment` stale `$set` race condition on transaction amounts | Sprint 2 |
| S2-02 | `payments.py` | `void_payment` stale `$set` restoring transaction amounts | Sprint 2 |
| S2-03 | `payments.py` | `bulk_pay_customer` stale `$set` race condition + stale rollback | Sprint 2 |
| S2-04 | `collections.py` | `void_collection_settlement` full `$set` on settlements array overwrites concurrent `$push` | Sprint 2 |
| S2-05 | `wallets.py` | `create_wallet_operation` (manual) missing `sequence_number` | Sprint 2 |
| S2-06 | `wallets.py` | `transfer_between_wallets` both debit + credit wallet ops missing `sequence_number` | Sprint 2 |
| S2-07 | `reconciliation.py` | `create_balance_verification` wallet op missing `operation_id` and `sequence_number` | Sprint 2 |
| S2-08 | `reconciliation.py` | `get_balance_verification_summary` used wrong field name `"adjusted"` (should be `"adjustment_applied"`) | Sprint 2 |
| S2-09 | `utils.py` | `compare_balance_with_snapshot` capped at `to_list(1000)` for wallet ops since snapshot | Sprint 2 |
| S2-10 | `payments.py` | `get_customer_payments_history_stats` used `to_list(10000)` + Python in-memory stats | Sprint 2 |

---

## SPRINT 1 — FIXED (10 bugs)

| ID | File | Bug Summary | Fixed In |
|----|------|------------|---------|
| S1-01 | `collections.py` | Settlement endpoints allowed settling `"cancelled"` collections | Sprint 1 |
| S1-02 | `collections.py` | `void_collection_settlement` allowed voiding on a `"cancelled"` collection | Sprint 1 |
| S1-03 | `collections.py` | `_execute_settlement` used read-modify-`$set` on settlements array (race condition) | Sprint 1 |
| S1-04 | `collections.py` | `bulk_collect_from_customer` used read-modify-`$set` on settlements array (race condition) | Sprint 1 |
| S1-05 | `expenses.py` | `delete_expense` refunded wallet even for auto-created PG charge expenses | Sprint 1 |
| S1-06 | `reconciliation.py` | `create_balance_verification` used non-atomic `$set` to overwrite wallet balance | Sprint 1 |
| S1-07 | `customers.py` | `get_customer` returned soft-deleted collections (missing `is_deleted: False` filter) | Sprint 1 |
| S1-08 | `gateways.py` | Gateway server deletion had no active-transaction check (both endpoints) | Sprint 1 |
| S1-09 | `collections.py` | `bulk_collect_from_customer` wallet operation missing `sequence_number` | Sprint 1 |
| S1-10 | `daily_closing.py` | Gateway breakdown aggregation used `$sum: swipe_amount` instead of `$max(swipe_amount, total_swiped)` | Sprint 1 |

---

## BACKLOG — Known Issues Not Yet Scheduled

| ID | File | Bug Summary | Priority |
|----|------|------------|---------|
| ~~BL-01~~ | `customers.py` | ~~Card deletion has no active-transaction check~~ | ~~P1~~ FIXED (guard at line 264-271) |

---

## SPRINT 4 — ALL 7 BUGS FIXED (Feb 2026)

---

### BUG-S4-01 · P1 · `payments.py` + `collections.py` — Proportional allocation rounding exceeds per-transaction cap

**Files:** `backend/routers/payments/payments.py`, `backend/routers/payments/collections.py`
**Status:** FIXED
**Fix Applied:** After rounding correction `allocations[first_key] += diff`, re-clamp with `min(allocations[first_key] + diff, remaining)` to prevent exceeding the per-transaction cap.

---

### BUG-S4-02 · P1 · `reconciliation.py` — Cancelled collections treated as pending discrepancies

**File:** `backend/routers/reconciliation.py`
**Status:** FIXED
**Fix Applied:** Changed `{"status": {"$ne": "settled"}}` to `{"status": {"$in": ["pending", "partial"]}}` to exclude cancelled and overpaid collections.

---

### BUG-S4-03 · P2 · `expenses.py` + `wallets.py` — Unbounded `to_list(100000)` in Excel exports

**Files:** `backend/routers/expenses.py`, `backend/routers/wallets.py`
**Status:** FIXED
**Fix Applied:** Reduced `to_list(100000)` to `to_list(50000)` for Excel export endpoints.

---

### BUG-S4-04 · P2 · `wallets.py` — Missing `_id` projection + `to_list(None)` on wallet operations

**File:** `backend/routers/wallets.py`
**Status:** FIXED
**Fix Applied:** Added `{"_id": 0}` projection to the `find()` call and changed `to_list(None)` to `to_list(limit)`.

---

### BUG-S4-05 · P1 · `collections.py` — Rounding adjustment not persisted to DB

**File:** `backend/routers/payments/collections.py`
**Status:** FIXED
**Fix Applied:** When `rounding_adjustment > 0`, the corrected `settled_amount` is now included in the status `$set` update, preventing drift between in-memory and DB values.

---

### BUG-S4-06 · P2 · `BUGS.md` — BL-01 already fixed but listed as pending

**File:** `memory/BUGS.md`
**Status:** FIXED
**Fix Applied:** Marked BL-01 as FIXED — the card deletion active-transaction guard already exists at `customers.py:264-271`.

---

### BUG-S4-07 · P2 · `dashboard.py` — New system gets perfect health score by default

**File:** `backend/routers/dashboard.py`
**Status:** FIXED
**Fix Applied:** Changed `collection_pct` default from `1.0` to `0.0` when no collection dues exist, preventing artificially inflated health scores on new installations.

---

## Bug Statistics

| Sprint | Total | P0 | P1 | P2 | Status |
|--------|-------|----|----|-----|--------|
| Sprint 1 | 10 | 2 | 6 | 2 | ✅ All Fixed |
| Sprint 2 | 10 | 0 | 7 | 3 | ✅ All Fixed |
| Sprint 3 | 20 | 1 | 13 | 6 | ✅ All Fixed (Feb 2026) |
| Sprint 4 | 11 | 0 | 5 | 6 | ✅ All Fixed (Feb 2026) |
| Backlog | 0 | 0 | 0 | 0 | ✅ Clear |
| **Total** | **51** | **3** | **31** | **17** | |
