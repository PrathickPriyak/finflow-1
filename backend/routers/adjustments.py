"""
Adjustments Router - Customer balance set-off / netting

Lets an authorized user offset what the company owes a customer (pending payouts)
against what the customer owes the company (outstanding collections), without any
real cash moving. A dedicated virtual "Adjustments" wallet is credited (collection
leg) and debited (payout leg) by the same amount so the wallet stays at zero and
every change is mirrored in `wallet_operations` for full auditability.

API:
    POST /adjustments        Apply a balance adjustment for a single customer.
    GET  /adjustments        List adjustments (optionally filtered by customer).
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from core.database import db
from core.dependencies import auth_required, check_permission, log_audit, get_client_ip
from models import BalanceAdjustmentCreate, WalletOperation
from utils import (
    generate_operation_id,
    get_next_operation_sequence,
    serialize_doc,
    serialize_docs,
)

router = APIRouter(tags=["Adjustments"])
logger = logging.getLogger(__name__)


VIRTUAL_WALLET_NAME = "Adjustments"
VIRTUAL_WALLET_TYPE = "virtual"


async def _get_or_create_virtual_wallet() -> dict:
    """Return the virtual Adjustments wallet, creating it lazily if missing.

    The wallet is normally seeded by `migrate.py` / `init_database`, but we
    create it on demand here too so a fresh install where migrations have not
    been run can still use the feature.
    """
    wallet = await db.wallets.find_one(
        {"name": VIRTUAL_WALLET_NAME, "wallet_type": VIRTUAL_WALLET_TYPE, "is_deleted": False},
        {"_id": 0},
    )
    if wallet:
        return wallet

    now_iso = datetime.now(timezone.utc).isoformat()
    wallet_doc = {
        "id": str(uuid.uuid4()),
        "name": VIRTUAL_WALLET_NAME,
        "wallet_type": VIRTUAL_WALLET_TYPE,
        "description": "Virtual wallet for customer balance set-off / adjustments. Stays at zero by design.",
        "balance": 0.0,
        "is_active": True,
        "is_system": True,
        "is_deleted": False,
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    try:
        await db.wallets.insert_one(wallet_doc)
    except Exception as e:
        # Race: another request created it concurrently — re-fetch
        logger.debug(f"Virtual wallet insert race: {e}; re-fetching")
        wallet = await db.wallets.find_one(
            {"name": VIRTUAL_WALLET_NAME, "wallet_type": VIRTUAL_WALLET_TYPE, "is_deleted": False},
            {"_id": 0},
        )
        if not wallet:
            raise HTTPException(status_code=500, detail="Failed to initialize virtual Adjustments wallet")
        return wallet
    return wallet_doc


async def _generate_adjustment_id(database) -> str:
    """Generate a human-readable adjustment id like ADJ-0001."""
    counter = await database.counters.find_one_and_update(
        {"_id": "adjustment_id"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    seq = counter.get("seq", 1)
    return f"ADJ-{seq:04d}"


def _r2(value: float) -> float:
    """Round a float to 2 decimals (currency)."""
    return round(float(value), 2)


@router.post("/adjustments")
async def create_balance_adjustment(
    data: BalanceAdjustmentCreate,
    request: Request,
    auth: dict = Depends(auth_required),
):
    """Create a balance adjustment that nets pending payouts against outstanding collections.

    Atomicity: every backend mutation is recorded in `ops_performed`. If any step
    fails, the previously performed steps are reversed (same pattern as
    `/payments/bulk` and `/collections/bulk-unified`).
    """
    await check_permission(auth, "adjustments")

    user_id = auth["user"]["id"]
    user_name = auth["user"]["name"]
    ip = get_client_ip(request)

    # ── Basic input validation ──
    if not data.payouts or not data.collections:
        raise HTTPException(status_code=400, detail="Both payouts and collections are required")

    # Dedup ids per side
    payout_ids = [a.id for a in data.payouts]
    collection_ids = [a.id for a in data.collections]
    if len(set(payout_ids)) != len(payout_ids):
        raise HTTPException(status_code=400, detail="Duplicate transaction ids in payouts")
    if len(set(collection_ids)) != len(collection_ids):
        raise HTTPException(status_code=400, detail="Duplicate collection ids in collections")

    payout_total = _r2(sum(a.amount for a in data.payouts))
    collection_total = _r2(sum(a.amount for a in data.collections))

    if payout_total <= 0 or collection_total <= 0:
        raise HTTPException(status_code=400, detail="Adjustment amount must be greater than zero")
    if abs(payout_total - collection_total) > 0.01:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Payout total (₹{payout_total:,.2f}) must equal collection total "
                f"(₹{collection_total:,.2f}) — both sides of an adjustment must net to the same amount."
            ),
        )
    net_amount = payout_total

    # ── Load and validate customer ──
    customer = await db.customers.find_one({"id": data.customer_id, "is_deleted": False}, {"_id": 0})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    # ── Load and validate transactions (payout side) ──
    transactions = await db.transactions.find(
        {"id": {"$in": payout_ids}, "is_deleted": False}, {"_id": 0}
    ).to_list(len(payout_ids))
    tx_by_id = {t["id"]: t for t in transactions}
    for alloc in data.payouts:
        tx = tx_by_id.get(alloc.id)
        if not tx:
            raise HTTPException(status_code=404, detail=f"Transaction not found: {alloc.id}")
        if tx.get("customer_id") != data.customer_id:
            raise HTTPException(
                status_code=400,
                detail=f"Transaction {tx.get('transaction_id', alloc.id)} does not belong to this customer",
            )
        remaining = float(tx.get("amount_remaining_to_customer", 0) or 0)
        if remaining <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"Transaction {tx.get('transaction_id', alloc.id)} has no remaining payable amount",
            )
        if alloc.amount - remaining > 0.01:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Allocation ₹{alloc.amount:,.2f} exceeds remaining ₹{remaining:,.2f} "
                    f"for transaction {tx.get('transaction_id', alloc.id)}"
                ),
            )

    # ── Load and validate collections (collection side) ──
    collections = await db.collections.find(
        {"id": {"$in": collection_ids}, "is_deleted": False}, {"_id": 0}
    ).to_list(len(collection_ids))
    col_by_id = {c["id"]: c for c in collections}
    for alloc in data.collections:
        col = col_by_id.get(alloc.id)
        if not col:
            raise HTTPException(status_code=404, detail=f"Collection not found: {alloc.id}")
        if col.get("customer_id") != data.customer_id:
            raise HTTPException(
                status_code=400,
                detail=f"Collection {col.get('pending_payment_id', alloc.id)} does not belong to this customer",
            )
        if col.get("status") not in ("pending", "partial"):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Collection {col.get('pending_payment_id', alloc.id)} is not open "
                    f"(status: {col.get('status')})"
                ),
            )
        col_remaining = _r2(float(col.get("amount", 0) or 0) - float(col.get("settled_amount", 0) or 0))
        if col_remaining <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"Collection {col.get('pending_payment_id', alloc.id)} has nothing left to settle",
            )
        if alloc.amount - col_remaining > 0.01:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Allocation ₹{alloc.amount:,.2f} exceeds remaining ₹{col_remaining:,.2f} "
                    f"for collection {col.get('pending_payment_id', alloc.id)}"
                ),
            )

    # ── Get / create virtual wallet ──
    wallet = await _get_or_create_virtual_wallet()
    wallet_id = wallet["id"]
    wallet_name = wallet["name"]
    wallet_type = wallet["wallet_type"]

    # ── Generate ids ──
    adjustment_id = str(uuid.uuid4())
    adjustment_readable_id = await _generate_adjustment_id(db)
    now_iso = datetime.now(timezone.utc).isoformat()

    # Rollback tracker — each entry is (op_kind, *payload)
    ops_performed: list = []

    async def _rollback():
        """Best-effort reverse of every op in `ops_performed` (in reverse order)."""
        for op in reversed(ops_performed):
            kind = op[0]
            try:
                if kind == "wallet_credit":
                    _, amt = op
                    await db.wallets.update_one(
                        {"id": wallet_id},
                        {"$inc": {"balance": -amt}, "$set": {"updated_at": now_iso}},
                    )
                elif kind == "wallet_debit":
                    _, amt = op
                    await db.wallets.update_one(
                        {"id": wallet_id},
                        {"$inc": {"balance": amt}, "$set": {"updated_at": now_iso}},
                    )
                elif kind == "wallet_op":
                    _, op_id = op
                    await db.wallet_operations.delete_one({"operation_id": op_id})
                elif kind == "payment_insert":
                    _, pid = op
                    await db.payments.delete_one({"id": pid})
                elif kind == "txn_payout":
                    _, txn_id, amt, payment_id = op
                    reverted = await db.transactions.find_one_and_update(
                        {"id": txn_id},
                        {
                            "$inc": {
                                "amount_paid_to_customer": -amt,
                                "amount_remaining_to_customer": amt,
                            },
                            "$pull": {"customer_payments": {"id": payment_id}},
                            "$set": {"updated_at": now_iso},
                        },
                        return_document=True,
                        projection={"_id": 0},
                    )
                    if reverted:
                        rev_remaining = max(0, reverted.get("amount_remaining_to_customer", 0))
                        rev_status = "completed" if rev_remaining <= 0 else "payment_pending"
                        ato = reverted.get("amount_to_customer", 0) or 0
                        if rev_remaining <= 0:
                            cps = "not_applicable" if ato == 0 else "paid"
                        elif reverted.get("amount_paid_to_customer", 0) > 0:
                            cps = "partial"
                        else:
                            cps = "pending"
                        await db.transactions.update_one(
                            {"id": txn_id},
                            {"$set": {
                                "status": rev_status,
                                "amount_remaining_to_customer": rev_remaining,
                                "customer_payment_status": cps,
                            }},
                        )
                elif kind == "collection_settle":
                    _, col_id, settlement_id, amt, prev_status = op
                    await db.collections.update_one(
                        {"id": col_id},
                        {
                            "$inc": {"settled_amount": -amt},
                            "$pull": {"settlements": {"id": settlement_id}},
                            "$set": {"status": prev_status, "updated_at": now_iso},
                        },
                    )
            except Exception as rb_err:
                logger.error(
                    f"Adjustment rollback step failed ({kind}) for {adjustment_readable_id}: {rb_err}"
                )
                try:
                    await db.operation_failures.insert_one({
                        "operation_type": "adjustment_rollback",
                        "adjustment_id": adjustment_id,
                        "adjustment_readable_id": adjustment_readable_id,
                        "failed_step": kind,
                        "error": str(rb_err),
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    })
                except Exception:
                    pass

    try:
        # ════════════════════════════════════════════════════════════════════
        # 1) COLLECTION LEG — credit virtual wallet, push settlements per collection
        # ════════════════════════════════════════════════════════════════════
        updated_wallet = await db.wallets.find_one_and_update(
            {"id": wallet_id},
            {"$inc": {"balance": net_amount}, "$set": {"updated_at": now_iso}},
            return_document=True,
            projection={"_id": 0},
        )
        if not updated_wallet:
            raise HTTPException(status_code=500, detail="Virtual Adjustments wallet vanished mid-operation")
        ops_performed.append(("wallet_credit", net_amount))
        credit_balance_after = updated_wallet.get("balance", 0)
        credit_balance_before = _r2(credit_balance_after - net_amount)

        credit_op_id = await generate_operation_id(db)
        credit_seq = await get_next_operation_sequence(db, wallet_id)
        credit_op = WalletOperation(
            operation_id=credit_op_id,
            wallet_id=wallet_id,
            wallet_name=wallet_name,
            wallet_type=wallet_type,
            operation_type="credit",
            amount=net_amount,
            balance_before=credit_balance_before,
            balance_after=credit_balance_after,
            reference_id=adjustment_id,
            reference_type="balance_adjustment_collection",
            customer_id=customer.get("customer_id", ""),
            notes=(
                f"Balance adjustment {adjustment_readable_id} — collection leg "
                f"({len(data.collections)} collection(s)) for {customer.get('name', '')}"
            ),
            created_by=user_id,
            created_by_name=user_name,
        )
        credit_op_doc = credit_op.model_dump()
        credit_op_doc["created_at"] = now_iso
        credit_op_doc["updated_at"] = now_iso
        credit_op_doc["sequence_number"] = credit_seq
        await db.wallet_operations.insert_one(credit_op_doc)
        ops_performed.append(("wallet_op", credit_op_id))

        collection_results = []
        for alloc in data.collections:
            col = col_by_id[alloc.id]
            alloc_amt = _r2(alloc.amount)
            settlement_id = str(uuid.uuid4())
            settlement_record = {
                "id": settlement_id,
                "method": "balance_adjustment",
                "gross_amount": alloc_amt,
                "principal_amount": alloc_amt,
                "include_charges": False,
                "charge_percentage": 0,
                "charge_amount": 0,
                "net_amount": alloc_amt,
                "amount": alloc_amt,
                "wallet_id": wallet_id,
                "wallet_name": wallet_name,
                "wallet_credit_amount": alloc_amt,
                "commission_percentage": 0,
                "commission_amount": 0,
                "settled_at": now_iso,
                "notes": (data.notes or "")[:1000],
                "reason": data.reason,
                "adjustment_id": adjustment_id,
                "adjustment_readable_id": adjustment_readable_id,
                "created_at": now_iso,
                "created_by": user_id,
                "created_by_name": user_name,
                "settled_by": user_id,
                "settled_by_name": user_name,
            }

            prev_status = col.get("status", "pending")
            # Atomic settlement guard — prevent total exceeding amount + ₹1 tolerance
            settle_filter = {
                "id": alloc.id,
                "status": {"$in": ["pending", "partial"]},
                "$expr": {
                    "$lte": [
                        {"$add": ["$settled_amount", alloc_amt]},
                        {"$add": ["$amount", 1.0]},
                    ]
                },
            }
            updated_col = await db.collections.find_one_and_update(
                settle_filter,
                {
                    "$push": {"settlements": settlement_record},
                    "$inc": {"settled_amount": alloc_amt},
                    "$set": {"updated_at": now_iso},
                },
                return_document=True,
                projection={"_id": 0},
            )
            if not updated_col:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Collection {col.get('pending_payment_id', alloc.id)} was modified by another "
                        f"operation. Please refresh and retry."
                    ),
                )
            ops_performed.append(("collection_settle", alloc.id, settlement_id, alloc_amt, prev_status))

            new_total_settled = updated_col.get("settled_amount", 0)
            new_remaining = _r2(float(updated_col.get("amount", 0) or 0) - float(new_total_settled or 0))
            if new_remaining <= 1.0:
                new_col_status = "settled"
            elif new_total_settled > 0:
                new_col_status = "partial"
            else:
                new_col_status = "pending"
            await db.collections.update_one({"id": alloc.id}, {"$set": {"status": new_col_status}})

            collection_results.append({
                "collection_id": alloc.id,
                "pending_payment_id": col.get("pending_payment_id", ""),
                "transaction_id_readable": col.get("transaction_id_readable", ""),
                "amount": alloc_amt,
                "previous_status": prev_status,
                "new_status": new_col_status,
                "settlement_id": settlement_id,
            })

        # ════════════════════════════════════════════════════════════════════
        # 2) PAYOUT LEG — debit virtual wallet, insert payments, update transactions
        # ════════════════════════════════════════════════════════════════════
        updated_wallet = await db.wallets.find_one_and_update(
            {"id": wallet_id},
            {"$inc": {"balance": -net_amount}, "$set": {"updated_at": now_iso}},
            return_document=True,
            projection={"_id": 0},
        )
        if not updated_wallet:
            raise HTTPException(status_code=500, detail="Virtual Adjustments wallet vanished mid-operation")
        ops_performed.append(("wallet_debit", net_amount))
        debit_balance_after = updated_wallet.get("balance", 0)
        debit_balance_before = _r2(debit_balance_after + net_amount)

        debit_op_id = await generate_operation_id(db)
        debit_seq = await get_next_operation_sequence(db, wallet_id)
        debit_op = WalletOperation(
            operation_id=debit_op_id,
            wallet_id=wallet_id,
            wallet_name=wallet_name,
            wallet_type=wallet_type,
            operation_type="debit",
            amount=net_amount,
            balance_before=debit_balance_before,
            balance_after=debit_balance_after,
            reference_id=adjustment_id,
            reference_type="balance_adjustment_payout",
            customer_id=customer.get("customer_id", ""),
            notes=(
                f"Balance adjustment {adjustment_readable_id} — payout leg "
                f"({len(data.payouts)} transaction(s)) for {customer.get('name', '')}"
            ),
            created_by=user_id,
            created_by_name=user_name,
        )
        debit_op_doc = debit_op.model_dump()
        debit_op_doc["created_at"] = now_iso
        debit_op_doc["updated_at"] = now_iso
        debit_op_doc["sequence_number"] = debit_seq
        await db.wallet_operations.insert_one(debit_op_doc)
        ops_performed.append(("wallet_op", debit_op_id))

        payout_results = []
        for alloc in data.payouts:
            tx = tx_by_id[alloc.id]
            alloc_amt = _r2(alloc.amount)
            payment_id = str(uuid.uuid4())
            payment_record = {
                "id": payment_id,
                "adjustment_id": adjustment_id,
                "adjustment_readable_id": adjustment_readable_id,
                "transaction_id": alloc.id,
                "transaction_id_readable": tx.get("transaction_id", ""),
                "customer_id": data.customer_id,
                "customer_readable_id": tx.get("customer_readable_id", customer.get("customer_id", "")),
                "customer_name": tx.get("customer_name", customer.get("name", "")),
                "amount": alloc_amt,
                "payment_source_type": VIRTUAL_WALLET_TYPE,
                "payment_source_id": wallet_id,
                "payment_source_name": wallet_name,
                "wallet_id": wallet_id,
                "wallet_name": wallet_name,
                "wallet_type": wallet_type,
                "payment_method": "balance_adjustment",
                "reference_number": adjustment_readable_id,
                "notes": (data.notes or "")[:1000],
                "reason": data.reason,
                "created_by": user_id,
                "created_by_name": user_name,
                "paid_by": user_id,
                "paid_by_name": user_name,
                "paid_at": now_iso,
                "created_at": now_iso,
                "updated_at": now_iso,
                "is_deleted": False,
            }
            await db.payments.insert_one(payment_record)
            ops_performed.append(("payment_insert", payment_id))

            updated_txn = await db.transactions.find_one_and_update(
                {"id": alloc.id, "amount_remaining_to_customer": {"$gte": alloc_amt}},
                {
                    "$inc": {
                        "amount_paid_to_customer": alloc_amt,
                        "amount_remaining_to_customer": -alloc_amt,
                    },
                    "$push": {
                        "customer_payments": {
                            "id": payment_id,
                            "amount": alloc_amt,
                            "wallet_name": wallet_name,
                            "wallet_type": wallet_type,
                            "payment_method": "balance_adjustment",
                            "adjustment_id": adjustment_id,
                            "adjustment_readable_id": adjustment_readable_id,
                            "paid_at": now_iso,
                            "paid_by": user_name,
                        }
                    },
                    "$set": {"updated_at": now_iso},
                },
                return_document=True,
                projection={"_id": 0},
            )
            if not updated_txn:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Transaction {tx.get('transaction_id', alloc.id)} was modified by another "
                        f"operation, or amount exceeds remaining balance. Please refresh and retry."
                    ),
                )
            ops_performed.append(("txn_payout", alloc.id, alloc_amt, payment_id))

            new_remaining = max(0, updated_txn.get("amount_remaining_to_customer", 0))
            new_status = "completed" if new_remaining <= 0 else "payment_pending"
            ato = updated_txn.get("amount_to_customer", 0) or 0
            if new_remaining <= 0:
                cps = "not_applicable" if ato == 0 else "paid"
            else:
                cps = "partial"
            await db.transactions.update_one(
                {"id": alloc.id},
                {"$set": {
                    "status": new_status,
                    "amount_remaining_to_customer": new_remaining,
                    "customer_payment_status": cps,
                }},
            )

            payout_results.append({
                "transaction_id": alloc.id,
                "transaction_id_readable": tx.get("transaction_id", ""),
                "amount": alloc_amt,
                "payment_id": payment_id,
                "new_status": new_status,
                "customer_payment_status": cps,
            })

        # ════════════════════════════════════════════════════════════════════
        # 3) ADJUSTMENT RECORD — first-class history entry
        # ════════════════════════════════════════════════════════════════════
        adjustment_doc = {
            "id": adjustment_id,
            "adjustment_id": adjustment_readable_id,
            "customer_id": data.customer_id,
            "customer_readable_id": customer.get("customer_id", ""),
            "customer_name": customer.get("name", ""),
            "net_amount": net_amount,
            "payout_total": payout_total,
            "collection_total": collection_total,
            "wallet_id": wallet_id,
            "wallet_name": wallet_name,
            "reason": data.reason,
            "notes": (data.notes or "")[:1000],
            "payouts": [
                {
                    "transaction_id": r["transaction_id"],
                    "transaction_id_readable": r["transaction_id_readable"],
                    "amount": r["amount"],
                    "payment_id": r["payment_id"],
                }
                for r in payout_results
            ],
            "collections": [
                {
                    "collection_id": r["collection_id"],
                    "pending_payment_id": r["pending_payment_id"],
                    "transaction_id_readable": r["transaction_id_readable"],
                    "amount": r["amount"],
                    "settlement_id": r["settlement_id"],
                }
                for r in collection_results
            ],
            "credit_wallet_operation_id": credit_op_id,
            "debit_wallet_operation_id": debit_op_id,
            "created_by": user_id,
            "created_by_name": user_name,
            "created_at": now_iso,
            "updated_at": now_iso,
            "is_deleted": False,
        }
        await db.adjustments.insert_one(adjustment_doc)

    except HTTPException:
        await _rollback()
        raise
    except Exception as e:
        logger.error(f"Balance adjustment {adjustment_readable_id} failed: {e}. Rolling back.")
        await _rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Balance adjustment failed and was rolled back: {str(e)}",
        )

    # ── Audit log ──
    await log_audit(
        user_id,
        user_name,
        "balance_adjustment",
        "adjustments",
        adjustment_id,
        details={
            "adjustment_id": adjustment_readable_id,
            "customer": customer.get("name", ""),
            "customer_readable_id": customer.get("customer_id", ""),
            "net_amount": net_amount,
            "payout_count": len(payout_results),
            "collection_count": len(collection_results),
            "transactions": [r["transaction_id_readable"] or r["transaction_id"] for r in payout_results],
            "collections": [r["pending_payment_id"] or r["collection_id"] for r in collection_results],
            "reason": data.reason,
        },
        ip=ip,
    )

    return serialize_doc(adjustment_doc)


@router.get("/adjustments")
async def list_adjustments(
    customer_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    auth: dict = Depends(auth_required),
):
    """List balance adjustments, optionally filtered by customer."""
    await check_permission(auth, "adjustments")

    query = {"is_deleted": False}
    if customer_id:
        query["customer_id"] = customer_id

    total = await db.adjustments.count_documents(query)
    skip = (page - 1) * limit
    rows = (
        await db.adjustments.find(query, {"_id": 0})
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
        .to_list(limit)
    )

    return {
        "data": serialize_docs(rows),
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "pages": (total + limit - 1) // limit,
        },
    }


@router.get("/adjustments/{adjustment_id}")
async def get_adjustment(adjustment_id: str, auth: dict = Depends(auth_required)):
    """Get a single adjustment by id."""
    await check_permission(auth, "adjustments")

    doc = await db.adjustments.find_one({"id": adjustment_id, "is_deleted": False}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Adjustment not found")
    return serialize_doc(doc)
