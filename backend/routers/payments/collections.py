"""
Collections Router - Collections from customers (money IN)
Clean API: /collections/*
"""
from fastapi import APIRouter, HTTPException, Depends, Query, Request
from fastapi.responses import StreamingResponse
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict
import uuid
import io
import logging

from core.database import db
from core.dependencies import auth_required, check_permission, log_audit
from utils import (
    serialize_doc, serialize_docs, get_ist_day_start_utc,
    get_next_operation_sequence,
    generate_operation_id
)
from models import WalletOperation, BulkCollectionCreate, CollectionSettlement, BulkUnifiedCollectionCreate

router = APIRouter(tags=["Collections"])
logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════════════
# CORE SETTLEMENT LOGIC — single source of truth for all settle endpoints
# ══════════════════════════════════════════════════════════════════════════════

async def _execute_settlement(
    collection: dict,
    gross_amount: float,
    method: str,
    charge_percentage: float,
    wallet_id: str,
    wallet_name: str,
    wallet_type: str,
    reference_type: str,
    auth_user_id: str,
    auth_user_name: str,
    gateway_info: dict = None,
    payment_type: str = "",
    notes: str = "",
    extra_fields: dict = None,
    include_charges: bool = False,
):
    """Core settlement logic shared by settle, settle-unified, and bulk-unified.

    Returns dict with: settlement_record, new_status, new_total_settled,
    new_remaining, wallet_credit_amount, net_amount, charge_amount,
    commission_amount, pg_amount, excess_amount, principal_amount,
    outstanding_info, ops_performed (for rollback).
    """
    collection_id = collection["id"]
    now_iso = datetime.now(timezone.utc).isoformat()
    ops = []

    # ── Amounts ──
    charge_amount = round(gross_amount * charge_percentage / 100, 2)
    net_amount = round(gross_amount - charge_amount, 2)
    pg_pct = 0.0
    pg_amount = 0.0
    commission_pct = charge_percentage
    commission_amt = charge_amount

    if method == "card_swipe" and gateway_info:
        pg_pct = gateway_info.get("pg_percentage", 0)
        pg_amount = round(gross_amount * pg_pct / 100, 2)
        commission_pct = round(charge_percentage - pg_pct, 2)
        # FIX-6: Derive commission from charge_amount - pg_amount to guarantee
        # charge_amount == pg_amount + commission_amt (no rounding drift)
        commission_amt = round(charge_amount - pg_amount, 2)
        # Wallet gets gross minus PG only (commission is a receivable, not deducted)
        wallet_credit_amount = round(gross_amount - pg_amount, 2)
    else:
        # Cash/bank: wallet gets full gross
        wallet_credit_amount = round(gross_amount, 2)

    # ── Principal amount (what settles the collection) ──
    if include_charges:
        principal_amount = round(gross_amount * (1 - charge_percentage / 100), 2)
    else:
        principal_amount = gross_amount

    # ── Credit wallet ──
    updated_wallet = await db.wallets.find_one_and_update(
        {"id": wallet_id},
        {"$inc": {"balance": wallet_credit_amount}, "$set": {"updated_at": now_iso}},
        return_document=True, projection={"_id": 0}
    )
    bal_after = updated_wallet.get("balance", 0)
    bal_before = bal_after - wallet_credit_amount
    ops.append(("wallet_credit", wallet_id, wallet_credit_amount))

    # ── Wallet operation (credit) ──
    op_id = await generate_operation_id(db)
    seq = await get_next_operation_sequence(db, wallet_id)
    wallet_op = WalletOperation(
        operation_id=op_id,
        wallet_id=wallet_id,
        wallet_name=wallet_name,
        wallet_type=wallet_type,
        operation_type="credit",
        amount=wallet_credit_amount,
        balance_before=bal_before,
        balance_after=bal_after,
        payment_type=payment_type if wallet_type == "bank" else None,
        reference_id=collection_id,
        reference_type=reference_type,
        transaction_id=collection.get("transaction_id_readable", ""),
        customer_id=collection.get("customer_readable_id", ""),
        notes=notes or f"Settlement: {collection.get('customer_name', '')}",
        created_by=auth_user_id,
        created_by_name=auth_user_name,
    )
    op_doc = wallet_op.model_dump()
    op_doc["created_at"] = now_iso
    op_doc["updated_at"] = now_iso
    op_doc["sequence_number"] = seq
    await db.wallet_operations.insert_one(op_doc)
    ops.append(("wallet_op", op_id))

    # ── Settlement record ──
    settlement_record = {
        "id": str(uuid.uuid4()),
        "method": method,
        "gross_amount": gross_amount,
        "principal_amount": principal_amount,
        "include_charges": include_charges,
        "charge_percentage": charge_percentage,
        "charge_amount": charge_amount,
        "net_amount": net_amount,
        "amount": net_amount,
        "wallet_id": wallet_id,
        "wallet_name": wallet_name,
        "wallet_credit_amount": wallet_credit_amount,
        "commission_percentage": commission_pct,
        "commission_amount": commission_amt,
        "settled_at": now_iso,
        "notes": notes,
        "created_at": now_iso,
        "created_by": auth_user_id,
        "created_by_name": auth_user_name,
        "settled_by": auth_user_id,
        "settled_by_name": auth_user_name,
    }

    if extra_fields and extra_fields.get("idempotency_key"):
        settlement_record["idempotency_key"] = extra_fields["idempotency_key"]

    if method == "card_swipe" and gateway_info:
        settlement_record.update({
            "gateway_id": gateway_info["id"],
            "gateway_name": gateway_info["name"],
            "server_id": gateway_info["server_id"],
            "server_name": gateway_info["server_name"],
            "pg_percentage": pg_pct,
            "pg_amount": pg_amount,
        })
        if pg_amount > 0:
            from routers.transactions import create_pg_charge_expense
            pg_expense = await create_pg_charge_expense(
                transaction_id=collection.get("transaction_id_readable", ""),
                transaction_type="Collection Card Swipe",
                gateway_name=gateway_info["name"],
                pg_charge_amount=pg_amount,
                wallet_id=wallet_id,
                wallet_name=wallet_name,
                wallet_type=wallet_type,
                user_id=auth_user_id,
                user_name=auth_user_name,
            )
            if pg_expense:
                settlement_record["pg_expense_id"] = pg_expense.id
                ops.append(("pg_expense", pg_expense.id))
    else:
        settlement_record.update({
            "wallet_type": wallet_type,
            "payment_type": payment_type,
        })

    if extra_fields:
        settlement_record.update(extra_fields)

    prev_state = {
        "settlements": collection.get("settlements", []),
        "settled_amount": collection.get("settled_amount", 0),
        "total_charges": collection.get("total_charges", 0),
        "status": collection.get("status", "pending"),
    }
    # Build atomic filter — prevent concurrent double-settlement
    settle_filter = {"id": collection_id, "status": {"$in": ["pending", "partial"]}}
    remaining = collection["amount"] - collection.get("settled_amount", 0)
    if principal_amount <= remaining + 1.0:
        # Normal: prevent total from exceeding amount + tolerance
        settle_filter["$expr"] = {
            "$lte": [
                {"$add": ["$settled_amount", round(principal_amount, 2)]},
                {"$add": ["$amount", 1.0]}
            ]
        }
    else:
        # Overpayment: optimistic lock on settled_amount to prevent concurrent double-overpayment
        settle_filter["settled_amount"] = collection.get("settled_amount", 0)
    updated_col = await db.collections.find_one_and_update(
        settle_filter,
        {
            "$push": {"settlements": settlement_record},
            "$inc": {
                "settled_amount": round(principal_amount, 2),
                "total_charges": round(charge_amount, 2),
            },
            "$set": {"updated_at": now_iso},
        },
        return_document=True,
        projection={"_id": 0},
    )
    if not updated_col:
        # Collection is already fully settled — rollback the wallet credit we just made
        await db.wallets.update_one(
            {"id": wallet_id},
            {"$inc": {"balance": -wallet_credit_amount}, "$set": {"updated_at": now_iso}}
        )
        await db.wallet_operations.delete_one({"operation_id": op_id})
        raise HTTPException(
            status_code=409,
            detail="Settlement conflict: this collection was already fully settled by a concurrent request. Please refresh and try again."
        )
    new_total_settled = updated_col.get("settled_amount", 0)
    new_total_charges = updated_col.get("total_charges", 0)
    new_remaining = updated_col.get("amount", 0) - new_total_settled

    # FIX-5: Track rounding adjustments for amounts within ₹1 tolerance
    rounding_adjustment = 0.0
    if new_remaining <= 1.0:
        new_status = "settled"
        if new_remaining > 0:
            rounding_adjustment = round(new_remaining, 2)  # Absorbed micro-amount
            new_total_settled = updated_col.get("amount", 0)
            new_remaining = 0
        elif -1.0 <= new_remaining < 0:
            rounding_adjustment = round(new_remaining, 2)  # Micro-overshoot absorbed
    elif new_total_settled > 0:
        new_status = "partial"
    else:
        new_status = "pending"

    if rounding_adjustment != 0:
        settlement_record["rounding_adjustment"] = rounding_adjustment

    # Overpayment handling — net_payable always equals full excess
    # Charges on the excess are already captured in the gross (Include Charges)
    # or via service_charge on the full gross (Normal mode)
    excess_amount = 0.0
    overpayment_info = None
    if new_remaining < -1.0:
        excess_amount = abs(new_remaining)
        new_status = "overpaid"
        net_payable = excess_amount

        overpayment_info = {
            "excess_principal": excess_amount,
            "charges_on_excess": 0.0,
            "net_payable": net_payable,
            "settlement_id": settlement_record["id"],
        }

        # Store overpayment_info on the collection for accurate void reversal
        await db.collections.update_one(
            {"id": collection_id},
            {"$set": {"overpayment_info": overpayment_info}}
        )

        # BUG-2 FIX: Only modify parent transaction for main collections, not service_charge
        txn_link_id = collection.get("transaction_id")
        if txn_link_id and collection.get("source") != "service_charge":
            # FIX-8: Don't $set pending_swipe_amount here — the swipe field
            # update below handles it via $inc + clamp, avoiding redundant writes
            await db.transactions.update_one(
                {"id": txn_link_id, "is_deleted": False},
                {
                    "$inc": {"amount_remaining_to_customer": round(net_payable, 2),
                             "amount_to_customer": round(net_payable, 2)},
                    "$set": {"status": "payment_pending", "pending_amount": 0,
                             "updated_at": now_iso}
                }
            )

    # Decrement pending_charges_amount when a service_charge collection is settled
    txn_link_id = collection.get("transaction_id")
    if txn_link_id and collection.get("source") == "service_charge":
        await db.transactions.update_one(
            {"id": txn_link_id, "is_deleted": False, "pending_charges_amount": {"$gt": 0}},
            {"$inc": {"pending_charges_amount": -round(principal_amount, 2)},
             "$set": {"updated_at": now_iso}}
        )
        # Clamp to 0 (rounding safety)
        await db.transactions.update_one(
            {"id": txn_link_id, "pending_charges_amount": {"$lt": 0}},
            {"$set": {"pending_charges_amount": 0}}
        )

    # Persist status (and corrected settled_amount when rounding absorbed a micro-amount)
    status_update = {"status": new_status}
    if rounding_adjustment > 0:
        status_update["settled_amount"] = new_total_settled
    await db.collections.update_one(
        {"id": collection_id},
        {"$set": status_update}
    )
    ops.append(("collection", collection_id, prev_state))

    # ── BUG B+C+H FIX: Update transaction swipe fields for card_swipe settlements ──
    txn_link_id = collection.get("transaction_id")
    if method == "card_swipe" and gateway_info and txn_link_id:
        swipe_entry = {
            "swipe_amount": gross_amount,
            "principal_amount": principal_amount,
            "include_charges": include_charges,
            "gateway_id": gateway_info["id"],
            "gateway_name": gateway_info["name"],
            "server_id": gateway_info["server_id"],
            "server_name": gateway_info["server_name"],
            "pg_percentage": pg_pct,
            "pg_amount": pg_amount,
            "commission_percentage": commission_pct,
            "commission_amount": commission_amt,
            "swiped_at": now_iso,
            "settlement_id": settlement_record["id"],
        }
        txn_swipe_update = {
            "$inc": {
                "total_swiped": gross_amount,
                "pending_swipe_amount": -principal_amount,
                "gateway_charge_amount": pg_amount,
                "commission_amount": commission_amt,
            },
            "$push": {"swipe_history": swipe_entry},
            "$set": {"updated_at": now_iso},
        }
        # If first swipe on this transaction, also set primary swipe fields
        first_check = await db.transactions.find_one(
            {"id": txn_link_id, "is_deleted": False},
            {"_id": 0, "swipe_amount": 1}
        )
        if first_check and first_check.get("swipe_amount", 0) == 0:
            txn_swipe_update["$set"].update({
                "swipe_amount": gross_amount,
                "swipe_gateway_id": gateway_info["id"],
                "swipe_gateway_name": gateway_info["name"],
                "swipe_server_id": gateway_info["server_id"],
                "swipe_server_name": gateway_info["server_name"],
                # FIX: also capture the charge percentages on first swipe
                "gateway_charge_percentage": pg_pct,
                "commission_percentage": commission_pct,
            })
        await db.transactions.update_one({"id": txn_link_id}, txn_swipe_update)
        # Clamp pending_swipe_amount to 0 (can go negative with include_charges gross > remaining)
        await db.transactions.update_one(
            {"id": txn_link_id, "pending_swipe_amount": {"$lt": 0}},
            {"$set": {"pending_swipe_amount": 0}}
        )
        ops.append(("txn_swipe", txn_link_id, gross_amount, pg_amount, commission_amt))

    # P1-4 + P1-7 FIX: For cash/bank settlements, update pending_swipe_amount and commission on transaction
    elif method != "card_swipe" and txn_link_id:
        cash_bank_txn_update = {
            "$inc": {"pending_swipe_amount": -principal_amount},
            "$set": {"updated_at": now_iso},
        }
        if commission_amt > 0:
            cash_bank_txn_update["$inc"]["commission_amount"] = commission_amt
        await db.transactions.update_one({"id": txn_link_id, "is_deleted": False}, cash_bank_txn_update)
        # Clamp pending_swipe_amount to 0
        await db.transactions.update_one(
            {"id": txn_link_id, "pending_swipe_amount": {"$lt": 0}},
            {"$set": {"pending_swipe_amount": 0}}
        )

    # P0-1 FIX: Only sync transaction status for main collections, not service_charge
    if new_status == "settled" and collection.get("source") != "service_charge":
        txn_link_id = collection.get("transaction_id")
        if txn_link_id:
            linked_txn = await db.transactions.find_one(
                {"id": txn_link_id, "is_deleted": False},
                {"_id": 0, "status": 1, "amount_remaining_to_customer": 1, "amount_paid_to_customer": 1, "amount_to_customer": 1}
            )
            if linked_txn:
                prev_txn_status = linked_txn.get("status")
                if prev_txn_status not in ("completed", "reversed"):
                    remaining = linked_txn.get("amount_remaining_to_customer", 0)
                    paid = linked_txn.get("amount_paid_to_customer", 0)
                    txn_new_status = "payment_pending" if remaining > 0 else "completed"
                    if remaining <= 0:
                        ato = linked_txn.get("amount_to_customer", 0)
                        cps = "not_applicable" if ato == 0 else "paid"
                    elif paid > 0:
                        cps = "partial"
                    else:
                        cps = "pending"
                    await db.transactions.update_one(
                        {"id": txn_link_id},
                        {"$set": {"status": txn_new_status, "pending_amount": 0,
                                  "pending_swipe_amount": 0,
                                  "customer_payment_status": cps,
                                  "updated_at": now_iso}}
                    )
                    ops.append(("transaction", txn_link_id, prev_txn_status))

    # ── Create service_charge collection or write-off expense (Normal mode only) ──
    outstanding_info = None
    if not include_charges and charge_percentage > 0:
        # Outstanding = commission + PG recovery (difference between gross and wallet credit)
        outstanding_amount = round(commission_amt + (gross_amount - wallet_credit_amount), 2)
        # Depth limit: if settling a service_charge, force write-off (no nested chains)
        force_writeoff = collection.get("source") == "service_charge"

        if outstanding_amount > 0:
            # Get threshold from settings
            settings = await db.settings.find_one({"id": "app_settings"}, {"_id": 0})
            threshold = settings.get("min_outstanding_threshold", 50.0) if settings else 50.0

            if outstanding_amount >= threshold and not force_writeoff:
                # Create service_charge collection
                from utils import get_pending_payment_id
                sc_id = str(uuid.uuid4())
                sc_readable_id = await get_pending_payment_id(db)
                service_charge_doc = {
                    "id": sc_id,
                    "pending_payment_id": sc_readable_id,
                    "source": "service_charge",
                    "parent_settlement_id": settlement_record["id"],
                    "parent_collection_id": collection_id,
                    "transaction_id": collection.get("transaction_id", ""),
                    "transaction_id_readable": collection.get("transaction_id_readable", ""),
                    "customer_id": collection.get("customer_id", ""),
                    "customer_name": collection.get("customer_name", ""),
                    "customer_readable_id": collection.get("customer_readable_id", ""),
                    "customer_phone": collection.get("customer_phone", ""),
                    "card_id": collection.get("card_id", ""),
                    "card_details": collection.get("card_details", ""),
                    "amount": outstanding_amount,
                    "settled_amount": 0,
                    "total_charges": 0,
                    "status": "pending",
                    "settlements": [],
                    "charge_breakdown": {
                        "pg_recovery": round(gross_amount - wallet_credit_amount, 2),
                        "commission": commission_amt,
                    },
                    "notes": f"Service charges for {collection.get('transaction_id_readable', '')} settlement",
                    "is_deleted": False,
                    "created_at": now_iso,
                    "updated_at": now_iso,
                    "created_by": auth_user_id,
                    "created_by_name": auth_user_name,
                }
                await db.collections.insert_one(service_charge_doc)
                # Update settlement record with the link
                await db.collections.update_one(
                    {"id": collection_id, "settlements.id": settlement_record["id"]},
                    {"$set": {"settlements.$.outstanding_collection_id": sc_id}}
                )
                # Track pending charges on parent transaction
                sc_txn_id = collection.get("transaction_id")
                if sc_txn_id:
                    await db.transactions.update_one(
                        {"id": sc_txn_id, "is_deleted": False},
                        {"$inc": {"pending_charges_amount": outstanding_amount},
                         "$set": {"updated_at": now_iso}}
                    )
                outstanding_info = {
                    "type": "service_charge",
                    "collection_id": sc_id,
                    "readable_id": sc_readable_id,
                    "amount": outstanding_amount,
                }
                ops.append(("service_charge", sc_id))
            else:
                # Below threshold — create Charge Write-Off expense
                writeoff_expense_type = await db.expense_types.find_one(
                    {"name": "Charge Write-Off", "is_deleted": False}, {"_id": 0}
                )
                if writeoff_expense_type:
                    from utils import generate_expense_id, get_today_date
                    from models import Expense
                    wo_expense_id = await generate_expense_id(db)
                    wo_expense = Expense(
                        expense_id=wo_expense_id,
                        expense_type_id=writeoff_expense_type["id"],
                        expense_type_name="Charge Write-Off",
                        amount=outstanding_amount,
                        wallet_id=wallet_id,
                        wallet_name=wallet_name,
                        wallet_type=wallet_type,
                        expense_date=get_today_date(),
                        description=f"Charge write-off for {collection.get('transaction_id_readable', '')} settlement (below threshold {settings.get('currency_symbol', '₹')}{threshold})",
                        transaction_id=collection.get("transaction_id_readable", ""),
                        is_auto_created=True,
                        is_writeoff=True,
                        created_by=auth_user_id,
                        created_by_name=auth_user_name,
                    )
                    wo_doc = wo_expense.model_dump()
                    wo_doc["created_at"] = now_iso
                    wo_doc["updated_at"] = now_iso
                    await db.expenses.insert_one(wo_doc)
                    # Update settlement record with the link
                    await db.collections.update_one(
                        {"id": collection_id, "settlements.id": settlement_record["id"]},
                        {"$set": {"settlements.$.writeoff_expense_id": wo_expense.id}}
                    )
                    outstanding_info = {
                        "type": "writeoff",
                        "expense_id": wo_expense.id,
                        "amount": outstanding_amount,
                    }
                    ops.append(("writeoff_expense", wo_expense.id))

    return {
        "settlement_record": settlement_record,
        "new_status": new_status,
        "new_total_settled": new_total_settled,
        "new_total_charges": new_total_charges,
        "new_remaining": new_remaining,
        "wallet_credit_amount": wallet_credit_amount,
        "net_amount": net_amount,
        "charge_amount": charge_amount,
        "commission_amount": commission_amt,
        "pg_amount": pg_amount,
        "principal_amount": principal_amount,
        "excess_amount": excess_amount,
        "overpayment_info": overpayment_info,
        "outstanding_info": outstanding_info,
        "ops_performed": ops,
        "wallet_credited": wallet_name,
    }

@router.get("/collections")
async def get_pending_payments(
    customer_id: Optional[str] = None,
    status: Optional[str] = None,
    source: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    sort_by: Optional[str] = Query(None, description="Sort by: date, customer, amount, settled, remaining"),
    sort_order: Optional[str] = Query("desc", description="Sort order: asc or desc"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    auth: dict = Depends(auth_required)
):
    """Get pending payments (Collections - Type 02 where customer owes business)"""
    import re as re_module
    query = {"is_deleted": False}
    
    if customer_id:
        query["customer_id"] = customer_id
    if status:
        query["status"] = status
    else:
        query["status"] = {"$nin": ["settled", "cancelled", "overpaid"]}
    if source:
        query["source"] = source
    if search:
        escaped_search = re_module.escape(search)
        search_conditions = [
            {"transaction_id_readable": {"$regex": escaped_search, "$options": "i"}},
            {"card_details": {"$regex": escaped_search, "$options": "i"}}
        ]
        # Phone number search via customer lookup
        from utils import get_customer_ids_by_phone
        phone_cids = await get_customer_ids_by_phone(db, search)
        if phone_cids:
            search_conditions.append({"customer_id": {"$in": phone_cids}})
        query["$or"] = search_conditions
    if date_from:
        query["created_at"] = {"$gte": date_from}
    if date_to:
        if "created_at" in query:
            query["created_at"]["$lte"] = date_to + "T23:59:59.999999"
        else:
            query["created_at"] = {"$lte": date_to + "T23:59:59.999999"}
    
    # Get total count for pagination
    total = await db.collections.count_documents(query)
    skip = (page - 1) * limit
    
    # Sorting
    sort_field_map = {
        "date": "created_at", "customer": "customer_name",
        "amount": "amount", "settled": "settled_amount",
    }
    sort_dir = 1 if sort_order == "asc" else -1
    
    if sort_by == "remaining":
        # Remaining is a computed field — use aggregation pipeline
        pipeline = [
            {"$match": query},
            {"$addFields": {"_remaining": {"$subtract": ["$amount", {"$ifNull": ["$settled_amount", 0]}]}}},
            {"$sort": {"_remaining": sort_dir}},
            {"$skip": skip},
            {"$limit": limit},
            {"$project": {"_id": 0, "_remaining": 0}},
        ]
        payments = await db.collections.aggregate(pipeline).to_list(limit)
    else:
        sort_field = sort_field_map.get(sort_by, "created_at")
        payments = await db.collections.find(query, {"_id": 0}).sort(sort_field, sort_dir).skip(skip).limit(limit).to_list(limit)
    
    for payment in payments:
        created = payment.get("created_at", "")
        if created:
            try:
                created_dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
                age_hours = (datetime.now(timezone.utc) - created_dt).total_seconds() / 3600
                payment["age_hours"] = round(age_hours, 1)
                payment["is_old"] = age_hours > 24
            except (ValueError, TypeError):
                payment["age_hours"] = 0
                payment["is_old"] = False
                logger.warning(f"Bad date on collection {payment.get('id','?')}: {created}")
        
        card_details = payment.get("card_details", "")
        if card_details and " - " in card_details:
            parts = card_details.split(" - ")
            payment["card_last_four"] = parts[-1] if len(parts) >= 3 else ""
            payment["card_bank"] = parts[0] if parts else ""
        
        if not payment.get("transaction_id_readable") and payment.get("transaction_id"):
            txn = await db.transactions.find_one(
                {"id": payment["transaction_id"]}, 
                {"_id": 0, "transaction_id": 1, "customer_readable_id": 1}
            )
            if txn:
                payment["transaction_id_readable"] = txn.get("transaction_id", "")
                if not payment.get("customer_readable_id"):
                    payment["customer_readable_id"] = txn.get("customer_readable_id", "")
        
        if payment.get("transaction_id_readable"):
            payment["transaction_id_display"] = payment["transaction_id_readable"]
    
    return {
        "data": serialize_docs(payments),
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "pages": (total + limit - 1) // limit
        }
    }


@router.get("/collections/stats")
async def get_pending_collections_stats(auth: dict = Depends(auth_required)):
    """Get comprehensive statistics for pending collections"""
    # BUG-11/12 FIX: use IST-midnight UTC; replace to_list(1000/5000) with aggregations
    today_utc = get_ist_day_start_utc()
    now = datetime.now(timezone.utc)

    # Totals via aggregation — scales to any collection count
    # GAP-2 FIX: also exclude "overpaid" (negative remaining corrupts total)
    totals_agg = await db.collections.aggregate([
        {"$match": {"is_deleted": False, "status": {"$nin": ["settled", "cancelled", "overpaid"]}}},
        {"$group": {
            "_id": None,
            "total": {"$sum": {"$subtract": ["$amount", {"$ifNull": ["$settled_amount", 0]}]}},
            "count": {"$sum": 1}
        }}
    ]).to_list(1)
    total_receivable = totals_agg[0]["total"] if totals_agg else 0
    pending_count = totals_agg[0]["count"] if totals_agg else 0

    # Today's settled amount (settlements since IST midnight UTC)
    collected_today_agg = await db.collections.aggregate([
        {"$match": {"is_deleted": False, "settlements": {"$exists": True, "$ne": []}}},
        {"$unwind": "$settlements"},
        {"$match": {"settlements.settled_at": {"$gte": today_utc}, "settlements.voided": {"$ne": True}}},
        {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$settlements.amount", 0]}}}}
    ]).to_list(1)
    collected_today = collected_today_agg[0]["total"] if collected_today_agg else 0

    # BUG-S3-21 FIX: replace to_list(10000) + Python analytics loop with a single
    # $facet aggregation — same pattern fixed for payments in S3-02
    week_ago_str  = (now - timedelta(days=7)).isoformat()
    month_ago_str = (now - timedelta(days=30)).isoformat()

    analytics_agg = await db.collections.aggregate([
        {"$match": {"is_deleted": False, "status": {"$nin": ["settled", "cancelled"]}}},
        {"$addFields": {"remaining": {"$subtract": ["$amount", {"$ifNull": ["$settled_amount", 0]}]}}},
        {"$match": {"remaining": {"$gt": 0}}},
        {"$facet": {
            "aging": [
                {"$group": {
                    "_id": None,
                    "today":  {"$sum": {"$cond": [{"$gte": ["$created_at", today_utc]},  "$remaining", 0]}},
                    "week":   {"$sum": {"$cond": [{"$and": [{"$lt": ["$created_at", today_utc]},  {"$gte": ["$created_at", week_ago_str]}]},  "$remaining", 0]}},
                    "month":  {"$sum": {"$cond": [{"$and": [{"$lt": ["$created_at", week_ago_str]},  {"$gte": ["$created_at", month_ago_str]}]}, "$remaining", 0]}},
                    "older":  {"$sum": {"$cond": [{"$lt": ["$created_at", month_ago_str]}, "$remaining", 0]}},
                    "overdue_count":  {"$sum": {"$cond": [{"$lt": ["$created_at", month_ago_str]}, 1, 0]}},
                    "overdue_amount": {"$sum": {"$cond": [{"$lt": ["$created_at", month_ago_str]}, "$remaining", 0]}},
                    "hv_count":  {"$sum": {"$cond": [{"$gt": ["$remaining", 50000]}, 1, 0]}},
                    "hv_amount": {"$sum": {"$cond": [{"$gt": ["$remaining", 50000]}, "$remaining", 0]}},
                }}
            ],
            "gateway": [
                {"$group": {
                    "_id": {"$ifNull": ["$gateway_name", "Other"]},
                    "count": {"$sum": 1},
                    "amount": {"$sum": "$remaining"}
                }},
                {"$sort": {"amount": -1}},
                {"$limit": 5}
            ],
            "top_customers": [
                {"$group": {
                    "_id": {"$ifNull": ["$customer_name", "Unknown"]},
                    "count": {"$sum": 1},
                    "amount": {"$sum": "$remaining"}
                }},
                {"$sort": {"amount": -1}},
                {"$limit": 5}
            ],
            "oldest": [
                {"$sort": {"created_at": 1}},
                {"$limit": 1},
                {"$project": {"_id": 0, "created_at": 1}}
            ]
        }}
    ]).to_list(1)

    analytics = analytics_agg[0] if analytics_agg else {}
    aging_row = analytics.get("aging", [{}])[0] if analytics.get("aging") else {}

    aging_distribution = {
        "today": aging_row.get("today", 0),
        "week":  aging_row.get("week",  0),
        "month": aging_row.get("month", 0),
        "older": aging_row.get("older", 0),
    }
    overdue_count  = aging_row.get("overdue_count", 0)
    overdue_amount = aging_row.get("overdue_amount", 0)
    high_value_count  = aging_row.get("hv_count", 0)
    high_value_amount = aging_row.get("hv_amount", 0)

    gateway_breakdown = [
        {"gateway": r["_id"], "count": r["count"], "amount": r["amount"]}
        for r in analytics.get("gateway", [])
    ]
    customer_breakdown = [
        {"customer": r["_id"], "count": r["count"], "amount": r["amount"]}
        for r in analytics.get("top_customers", [])
    ]

    oldest_days = 0
    oldest_docs = analytics.get("oldest", [])
    if oldest_docs and oldest_docs[0].get("created_at"):
        try:
            oldest_dt = datetime.fromisoformat(oldest_docs[0]["created_at"].replace("Z", "+00:00"))
            oldest_days = (now - oldest_dt).days
        except (ValueError, TypeError):
            logger.warning(f"Bad date in oldest pending collection: {oldest_docs[0].get('created_at')}")
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    month_collected_agg = await db.collections.aggregate([
        {"$match": {"is_deleted": False, "settlements": {"$exists": True, "$ne": []}}},
        {"$unwind": "$settlements"},
        {"$match": {"settlements.settled_at": {"$gte": month_start}, "settlements.voided": {"$ne": True}}},
        {"$group": {"_id": None, "total": {"$sum": {"$ifNull": ["$settlements.amount", 0]}}}}
    ]).to_list(1)
    month_collected = month_collected_agg[0]["total"] if month_collected_agg else 0

    month_created_agg = await db.collections.aggregate([
        {"$match": {"is_deleted": False, "created_at": {"$gte": month_start}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]).to_list(1)
    month_created = month_created_agg[0]["total"] if month_created_agg else 0

    collection_rate = (month_collected / month_created * 100) if month_created > 0 else 0

    return {
        "total_receivable": total_receivable,
        "pending_count": pending_count,
        "collected_today": collected_today,
        "oldest_pending_days": oldest_days,
        "overdue_count": overdue_count,
        "overdue_amount": overdue_amount,
        "high_value_count": high_value_count,
        "high_value_amount": high_value_amount,
        "aging_distribution": aging_distribution,
        "gateway_breakdown": gateway_breakdown,
        "top_pending_customers": customer_breakdown,
        "month_collection_rate": round(collection_rate, 1),
        "month_collected": month_collected
    }


@router.get("/collections/export-excel")
async def export_collections_excel(
    tab: str = Query("pending", description="pending or history"),
    source: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    request: Request = None,
    auth: dict = Depends(auth_required),
):
    """Export collections (pending or history) to a comprehensive Excel file"""
    import xlsxwriter

    if tab == "history":
        # Export collection history (settlements)
        match_query = {"is_deleted": False, "settlements": {"$exists": True, "$ne": []}}
        all_payments = await db.collections.find(match_query, {"_id": 0}).to_list(10000)
        rows = []
        for payment in all_payments:
            for s in payment.get("settlements", []):
                if s.get("voided"):
                    continue
                days_outstanding = 0
                if payment.get("created_at") and s.get("settled_at"):
                    try:
                        c_dt = datetime.fromisoformat(payment["created_at"].replace("Z", "+00:00"))
                        s_dt = datetime.fromisoformat(s["settled_at"].replace("Z", "+00:00"))
                        days_outstanding = (s_dt - c_dt).days
                    except (ValueError, TypeError):
                        pass
                rows.append({
                    "settled_date": s.get("settled_at", "")[:10] if s.get("settled_at") else "",
                    "customer": payment.get("customer_name", ""),
                    "txn_id": payment.get("transaction_id_readable", ""),
                    "card_details": payment.get("card_details", ""),
                    "total_due": payment.get("amount", 0),
                    "collected": s.get("amount", 0),
                    "method": s.get("method", ""),
                    "wallet": s.get("wallet_name", ""),
                    "payment_type": s.get("payment_type", ""),
                    "charge_pct": s.get("charge_percentage", 0),
                    "charge_amt": s.get("charge_amount", 0),
                    "net_amount": s.get("net_amount", 0),
                    "gateway": s.get("gateway_name", ""),
                    "days_outstanding": days_outstanding,
                    "notes": s.get("notes", ""),
                    "collected_by": s.get("settled_by_name", ""),
                })
        rows.sort(key=lambda r: r["settled_date"], reverse=True)

        output = io.BytesIO()
        workbook = xlsxwriter.Workbook(output, {"in_memory": True})
        ws = workbook.add_worksheet("Collection History")
        header_fmt = workbook.add_format({"bold": True, "bg_color": "#1e293b", "font_color": "#ffffff", "border": 1})
        money_fmt = workbook.add_format({"num_format": "#,##0.00", "border": 1})
        pct_fmt = workbook.add_format({"num_format": "0.00%", "border": 1})
        cell_fmt = workbook.add_format({"border": 1})

        headers = ["Date", "Customer", "Txn ID", "Card Details", "Total Due", "Collected",
                    "Method", "Wallet", "Payment Type", "Charge %", "Charge Amt", "Net Amount",
                    "Gateway", "Days Outstanding", "Notes", "Collected By"]
        for col, h in enumerate(headers):
            ws.write(0, col, h, header_fmt)

        for r, row in enumerate(rows, 1):
            ws.write(r, 0, row["settled_date"], cell_fmt)
            ws.write(r, 1, row["customer"], cell_fmt)
            ws.write(r, 2, row["txn_id"], cell_fmt)
            ws.write(r, 3, row["card_details"], cell_fmt)
            ws.write(r, 4, row["total_due"], money_fmt)
            ws.write(r, 5, row["collected"], money_fmt)
            ws.write(r, 6, row["method"], cell_fmt)
            ws.write(r, 7, row["wallet"], cell_fmt)
            ws.write(r, 8, row["payment_type"], cell_fmt)
            ws.write(r, 9, row["charge_pct"] / 100 if row["charge_pct"] else 0, pct_fmt)
            ws.write(r, 10, row["charge_amt"], money_fmt)
            ws.write(r, 11, row["net_amount"], money_fmt)
            ws.write(r, 12, row["gateway"], cell_fmt)
            ws.write(r, 13, row["days_outstanding"], cell_fmt)
            ws.write(r, 14, row["notes"], cell_fmt)
            ws.write(r, 15, row["collected_by"], cell_fmt)

        # Summary row
        if rows:
            sum_row = len(rows) + 2
            sum_fmt = workbook.add_format({"bold": True, "border": 1})
            ws.write(sum_row, 0, "TOTAL", sum_fmt)
            ws.write(sum_row, 4, sum(r["total_due"] for r in rows), workbook.add_format({"bold": True, "num_format": "#,##0.00", "border": 1}))
            ws.write(sum_row, 5, sum(r["collected"] for r in rows), workbook.add_format({"bold": True, "num_format": "#,##0.00", "border": 1}))
            ws.write(sum_row, 10, sum(r["charge_amt"] for r in rows), workbook.add_format({"bold": True, "num_format": "#,##0.00", "border": 1}))
            ws.write(sum_row, 11, sum(r["net_amount"] for r in rows), workbook.add_format({"bold": True, "num_format": "#,##0.00", "border": 1}))
            ws.write(sum_row, 1, f"{len(rows)} settlements", sum_fmt)

        ws.set_column(0, 0, 12)
        ws.set_column(1, 1, 22)
        ws.set_column(2, 2, 14)
        ws.set_column(3, 3, 20)
        ws.set_column(4, 5, 14)
        ws.set_column(6, 8, 14)
        ws.set_column(9, 11, 12)
        ws.set_column(12, 12, 16)
        ws.set_column(13, 13, 10)
        ws.set_column(14, 14, 25)
        ws.set_column(15, 15, 16)
        workbook.close()
        output.seek(0)

        filename = f"collection_history_{datetime.now(timezone.utc).strftime('%Y%m%d')}.xlsx"
        await log_audit(auth["user"]["id"], auth["user"]["name"], "export", "collection_history",
                        details={"count": len(rows)}, ip=request.client.host if request else "")
        return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                 headers={"Content-Disposition": f"attachment; filename={filename}"})

    # ── Pending tab export ──
    query = {"is_deleted": False, "status": {"$nin": ["settled", "cancelled", "overpaid"]}}
    if source and source != "all":
        query["source"] = source
    if status and status != "all":
        query["status"] = status
    if date_from:
        query["created_at"] = {"$gte": date_from}
    if date_to:
        if "created_at" in query:
            query["created_at"]["$lte"] = date_to + "T23:59:59.999999"
        else:
            query["created_at"] = {"$lte": date_to + "T23:59:59.999999"}
    if search:
        import re as re_module
        escaped = re_module.escape(search)
        query["$or"] = [
            {"transaction_id_readable": {"$regex": escaped, "$options": "i"}},
            {"card_details": {"$regex": escaped, "$options": "i"}},
        ]

    payments = await db.collections.find(query, {"_id": 0}).sort("created_at", -1).to_list(10000)

    output = io.BytesIO()
    workbook = xlsxwriter.Workbook(output, {"in_memory": True})
    ws = workbook.add_worksheet("Pending Collections")
    header_fmt = workbook.add_format({"bold": True, "bg_color": "#1e293b", "font_color": "#ffffff", "border": 1})
    money_fmt = workbook.add_format({"num_format": "#,##0.00", "border": 1})
    cell_fmt = workbook.add_format({"border": 1})

    headers = ["Date", "Txn ID", "Customer", "Phone", "Card Details", "Source",
               "Status", "Total Due", "Settled", "Remaining", "Age (Days)"]
    for col, h in enumerate(headers):
        ws.write(0, col, h, header_fmt)

    now = datetime.now(timezone.utc)
    for r, p in enumerate(payments, 1):
        remaining = p.get("amount", 0) - p.get("settled_amount", 0)
        age_days = 0
        if p.get("created_at"):
            try:
                c_dt = datetime.fromisoformat(p["created_at"].replace("Z", "+00:00"))
                age_days = (now - c_dt).days
            except (ValueError, TypeError):
                pass
        ws.write(r, 0, p.get("created_at", "")[:10], cell_fmt)
        ws.write(r, 1, p.get("transaction_id_readable", ""), cell_fmt)
        ws.write(r, 2, p.get("customer_name", ""), cell_fmt)
        ws.write(r, 3, p.get("customer_phone", ""), cell_fmt)
        ws.write(r, 4, p.get("card_details", ""), cell_fmt)
        ws.write(r, 5, p.get("source", ""), cell_fmt)
        ws.write(r, 6, p.get("status", ""), cell_fmt)
        ws.write(r, 7, p.get("amount", 0), money_fmt)
        ws.write(r, 8, p.get("settled_amount", 0), money_fmt)
        ws.write(r, 9, remaining, money_fmt)
        ws.write(r, 10, age_days, cell_fmt)

    # Summary row
    if payments:
        sum_row = len(payments) + 2
        sum_fmt = workbook.add_format({"bold": True, "border": 1})
        bold_money = workbook.add_format({"bold": True, "num_format": "#,##0.00", "border": 1})
        ws.write(sum_row, 0, "TOTAL", sum_fmt)
        ws.write(sum_row, 2, f"{len(payments)} collections", sum_fmt)
        ws.write(sum_row, 7, sum(p.get("amount", 0) for p in payments), bold_money)
        ws.write(sum_row, 8, sum(p.get("settled_amount", 0) for p in payments), bold_money)
        ws.write(sum_row, 9, sum(p.get("amount", 0) - p.get("settled_amount", 0) for p in payments), bold_money)

    ws.set_column(0, 0, 12)
    ws.set_column(1, 1, 14)
    ws.set_column(2, 2, 22)
    ws.set_column(3, 3, 14)
    ws.set_column(4, 4, 22)
    ws.set_column(5, 6, 14)
    ws.set_column(7, 9, 14)
    ws.set_column(10, 10, 10)
    workbook.close()
    output.seek(0)

    filename = f"pending_collections_{datetime.now(timezone.utc).strftime('%Y%m%d')}.xlsx"
    await log_audit(auth["user"]["id"], auth["user"]["name"], "export", "pending_collections",
                    details={"count": len(payments)}, ip=request.client.host if request else "")
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})


@router.post("/collections/{collection_id}/settle-unified")
async def settle_collection_unified(
    collection_id: str,
    data: CollectionSettlement,
    request: Request,
    auth: dict = Depends(auth_required)
):
    """Unified settlement: card_swipe, cash, or bank_transfer with charge handling."""
    await check_permission(auth, "collections")

    # Idempotency check — prevent duplicate submissions
    if data.idempotency_key:
        existing = await db.collections.find_one(
            {"settlements.idempotency_key": data.idempotency_key, "is_deleted": False},
            {"_id": 0, "id": 1}
        )
        if existing:
            raise HTTPException(status_code=409, detail="Duplicate settlement request (idempotency key already used)")

    collection = await db.collections.find_one({"id": collection_id, "is_deleted": False}, {"_id": 0})
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    if collection["status"] == "settled":
        raise HTTPException(status_code=400, detail="Collection already fully settled")
    if collection["status"] == "overpaid":
        raise HTTPException(status_code=400, detail="Collection is overpaid and cannot accept further settlements")
    # BUG-1 FIX: Prevent settling a cancelled collection
    if collection["status"] == "cancelled":
        raise HTTPException(status_code=400, detail="Cannot settle a cancelled collection")

    method = data.method
    if method not in ["card_swipe", "cash", "bank_transfer"]:
        raise HTTPException(status_code=400, detail="Invalid method. Must be: card_swipe, cash, or bank_transfer")

    gateway_info = None
    wallet_id = ""
    wallet_name = ""
    wallet_type = ""
    ref_type = f"collection_{method}"

    if method == "card_swipe":
        if not data.gateway_id or not data.server_id:
            raise HTTPException(status_code=400, detail="gateway_id and server_id required for card_swipe")
        gateway = await db.gateways.find_one({"id": data.gateway_id, "is_deleted": False, "is_active": True}, {"_id": 0})
        if not gateway:
            raise HTTPException(status_code=404, detail="Gateway not found or inactive")
        server = await db.gateway_servers.find_one({"id": data.server_id, "gateway_id": data.gateway_id, "is_deleted": False, "is_active": True}, {"_id": 0})
        if not server:
            raise HTTPException(status_code=404, detail="Gateway server not found or inactive")
        pg_pct = server.get("charge_percentage", 0)
        if data.charge_percentage < pg_pct:
            raise HTTPException(status_code=400, detail=f"charge_percentage ({data.charge_percentage}%) must be at least PG charges ({pg_pct}%)")
        gw_wallet = await db.wallets.find_one({"wallet_type": "gateway", "gateway_id": data.gateway_id, "is_deleted": False}, {"_id": 0})
        if not gw_wallet:
            raise HTTPException(status_code=500, detail="Gateway wallet not found")
        wallet_id = gw_wallet["id"]
        wallet_name = gw_wallet["name"]
        wallet_type = "gateway"
        gateway_info = {"id": data.gateway_id, "name": gateway["name"], "server_id": data.server_id, "server_name": server["name"], "pg_percentage": pg_pct}
    else:
        if not data.wallet_id:
            raise HTTPException(status_code=400, detail="wallet_id required for cash/bank_transfer")
        wallet = await db.wallets.find_one({"id": data.wallet_id, "is_deleted": False}, {"_id": 0})
        if not wallet:
            raise HTTPException(status_code=404, detail="Wallet not found")
        expected_type = "cash" if method == "cash" else "bank"
        if wallet["wallet_type"] != expected_type:
            raise HTTPException(status_code=400, detail=f"Wallet must be of type '{expected_type}' for {method} settlement")
        if method == "bank_transfer" and not data.payment_type:
            raise HTTPException(status_code=400, detail="payment_type required for bank_transfer")
        wallet_id = data.wallet_id
        wallet_name = wallet["name"]
        wallet_type = wallet["wallet_type"]

    # Validate include_charges mode
    if data.include_charges and data.charge_percentage >= 100:
        raise HTTPException(status_code=400, detail="charge_percentage must be less than 100% when using Include All Charges mode")

    result = await _execute_settlement(
        collection=collection,
        gross_amount=data.gross_amount,
        method=method,
        charge_percentage=data.charge_percentage,
        wallet_id=wallet_id,
        wallet_name=wallet_name,
        wallet_type=wallet_type,
        reference_type=ref_type,
        auth_user_id=auth["user"]["id"],
        auth_user_name=auth["user"]["name"],
        gateway_info=gateway_info,
        payment_type=data.payment_type,
        notes=data.notes or "",
        include_charges=data.include_charges,
        extra_fields={"idempotency_key": data.idempotency_key} if data.idempotency_key else None,
    )

    await log_audit(auth["user"]["id"], auth["user"]["name"], "settle_unified", "collections", collection_id, {
        "method": method, "gross_amount": data.gross_amount,
        "charge_percentage": data.charge_percentage,
        "include_charges": data.include_charges,
        "net_amount": result["net_amount"], "new_status": result["new_status"],
        "wallet_credited": result["wallet_credited"],
    }, ip=request.client.host if request.client else "")

    updated_collection = await db.collections.find_one({"id": collection_id}, {"_id": 0})

    payment_created = None
    if result["excess_amount"] > 0:
        payment_created = {"type": "transaction_updated", "excess_amount": round(result["excess_amount"], 2), "transaction_id": collection.get("transaction_id")}

    return {
        "success": True,
        "message": f"Settlement recorded. Status: {result['new_status']}",
        "collection": serialize_doc(updated_collection),
        "settlement": {
            "method": method,
            "gross_amount": data.gross_amount,
            "principal_amount": result["principal_amount"],
            "include_charges": data.include_charges,
            "charges": result["charge_amount"],
            "net_settled": result["net_amount"],
            "remaining_balance": max(0, result["new_remaining"]),
            "wallet_credited": result["wallet_credited"],
            "wallet_credit_amount": result["wallet_credit_amount"],
            "commission_earned": result["commission_amount"],
            "pg_expense": result["pg_amount"] if method == "card_swipe" else 0,
        },
        "outstanding_info": result.get("outstanding_info"),
        "payment_created": payment_created,
    }


@router.get("/collections/history")
async def get_collection_history(
    search: Optional[str] = None,
    sort_by: Optional[str] = Query(None, description="Sort by: date, customer, amount, due"),
    sort_order: Optional[str] = Query("desc", description="Sort order: asc or desc"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    auth: dict = Depends(auth_required)
):
    """Get collection history with full transaction context (all settlements)"""
    skip = (page - 1) * limit
    
    # Build match query (with optional search)
    match_query = {"is_deleted": False, "settlements": {"$exists": True, "$ne": []}}
    if search:
        import re as re_module
        escaped = re_module.escape(search)
        search_conditions = [
            {"transaction_id_readable": {"$regex": escaped, "$options": "i"}},
        ]
        from utils import get_customer_ids_by_phone
        phone_cids = await get_customer_ids_by_phone(db, search)
        if phone_cids:
            search_conditions.append({"customer_id": {"$in": phone_cids}})
        match_query["$or"] = search_conditions
    
    # Compute sort field for aggregation pipeline
    sort_field_map = {
        "date": "settlements_indexed.settled_at",
        "customer": "customer_name",
        "amount": "settlements_indexed.amount",
        "due": "amount",
    }
    agg_sort_field = sort_field_map.get(sort_by, "settlements_indexed.settled_at")
    agg_sort_dir = 1 if sort_order == "asc" else -1
    
    # QA-01 FIX: Use MongoDB aggregation pipeline for DB-level pagination
    # This avoids loading all settlements into memory
    pipeline = [
        # Match pending payments with settlements
        {"$match": match_query},
        # Add settlement index before unwinding for running balance calc
        {"$addFields": {
            "settlements_indexed": {
                "$map": {
                    "input": {"$range": [0, {"$size": "$settlements"}]},
                    "as": "idx",
                    "in": {
                        "$mergeObjects": [
                            {"$arrayElemAt": ["$settlements", "$$idx"]},
                            {
                                "cumulative_settled": {
                                    "$sum": {
                                        "$map": {
                                            "input": {"$slice": ["$settlements", 0, {"$add": ["$$idx", 1]}]},
                                            "as": "s",
                                            "in": {"$ifNull": ["$$s.amount", 0]}
                                        }
                                    }
                                }
                            }
                        ]
                    }
                }
            }
        }},
        # Unwind the indexed settlements
        {"$unwind": "$settlements_indexed"},
        # Sort
        {"$sort": {agg_sort_field: agg_sort_dir}},
        # Project all needed fields
        {"$project": {
            "_id": 0,
            "id": "$settlements_indexed.id",
            "pending_payment_id": "$id",
            "pending_payment_readable_id": "$pending_payment_id",
            "customer_id": 1,
            "customer_name": 1,
            "customer_phone": 1,
            "customer_readable_id": 1,
            "transaction_id": 1,
            "transaction_id_readable": 1,
            "transaction_date": "$created_at",
            "total_due_amount": "$amount",
            "swipe_amount": 1,
            "commission_amount": 1,
            "card_details": 1,
            "amount": "$settlements_indexed.amount",
            "wallet_id": "$settlements_indexed.wallet_id",
            "wallet_name": "$settlements_indexed.wallet_name",
            "wallet_type": "$settlements_indexed.wallet_type",
            "payment_type": "$settlements_indexed.payment_type",
            "notes": "$settlements_indexed.notes",
            "settled_at": "$settlements_indexed.settled_at",
            "settled_by": "$settlements_indexed.settled_by",
            "settled_by_name": "$settlements_indexed.settled_by_name",
            "cumulative_settled": "$settlements_indexed.cumulative_settled",
            "payment_status": "$status",
            "settled_amount": 1,
            "pending_created_at": "$created_at"
        }},
        # Facet for pagination (total count + paginated data)
        {"$facet": {
            "data": [{"$skip": skip}, {"$limit": limit}],
            "total": [{"$count": "count"}]
        }}
    ]
    
    result = await db.collections.aggregate(pipeline).to_list(1)
    
    if not result:
        return {
            "data": [],
            "pagination": {"page": page, "limit": limit, "total": 0, "pages": 0}
        }
    
    settlements = result[0].get("data", [])
    total = result[0].get("total", [{}])[0].get("count", 0) if result[0].get("total") else 0
    
    # Batch fetch transactions for enrichment
    transaction_ids = list(set(s.get("transaction_id") for s in settlements if s.get("transaction_id")))
    if transaction_ids:
        transactions = await db.transactions.find(
            {"id": {"$in": transaction_ids}},
            {"_id": 0, "id": 1, "swipe_gateway_name": 1, "swipe_server_name": 1, "transaction_id": 1}
        ).to_list(len(transaction_ids))
        txn_lookup = {txn["id"]: txn for txn in transactions}
    else:
        txn_lookup = {}
    
    # Enrich with calculated fields and transaction context
    enriched = []
    for s in settlements:
        txn = txn_lookup.get(s.get("transaction_id"))
        
        # Calculate days outstanding
        days_outstanding = 0
        if s.get("pending_created_at") and s.get("settled_at"):
            try:
                created_dt = datetime.fromisoformat(s["pending_created_at"].replace("Z", "+00:00"))
                settled_dt = datetime.fromisoformat(s["settled_at"].replace("Z", "+00:00"))
                days_outstanding = (settled_dt - created_dt).days
            except (ValueError, TypeError):
                days_outstanding = None
                logger.warning(f"Bad date on settlement history entry: pending={s.get('pending_created_at')}, settled={s.get('settled_at')}")
        cumulative = s.get("cumulative_settled", 0)
        running_balance = s.get("total_due_amount", 0) - cumulative
        
        enriched.append({
            **s,
            "gateway_name": txn.get("swipe_gateway_name", "") if txn else "",
            "server_name": txn.get("swipe_server_name", "") if txn else "",
            "days_outstanding": days_outstanding,
            "running_balance_after": max(0, running_balance),
            "is_full_settlement": running_balance <= 1.0,
        })
    
    return {
        "data": serialize_docs(enriched),
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "pages": (total + limit - 1) // limit if total > 0 else 0
        }
    }


@router.get("/collections/history-stats")
async def get_collection_history_stats(
    period: str = Query("all", description="all, today, week, month"),
    auth: dict = Depends(auth_required)
):
    """Get comprehensive statistics for collection history"""
    # GAP-10 FIX: use IST-aware UTC start for "today" filter
    today_utc_start = get_ist_day_start_utc()
    
    # AUDIT-FIX-05: Use MongoDB aggregation pipeline instead of loading all into memory
    # Build date match for settlements
    date_match = {}
    if period == "today":
        date_match = {"settlements.settled_at": {"$gte": today_utc_start}}
    elif period == "week":
        date_match = {"settlements.settled_at": {"$gte": (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()}}
    elif period == "month":
        date_match = {"settlements.settled_at": {"$gte": (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()}}
    
    base_match = {"is_deleted": False, "settlements": {"$exists": True, "$ne": []}}
    if date_match:
        base_match.update(date_match)
    
    # Aggregation: unwind settlements, filter by date, compute stats
    pipeline = [
        {"$match": base_match},
        {"$unwind": "$settlements"},
        # Skip voided settlements
        {"$match": {"settlements.voided": {"$ne": True}}},
    ]
    
    # Add date threshold filter on individual settlements
    if period == "today":
        pipeline.append({"$match": {"settlements.settled_at": {"$gte": today_utc_start}}})
    elif period == "week":
        pipeline.append({"$match": {"settlements.settled_at": {"$gte": (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()}}})
    elif period == "month":
        pipeline.append({"$match": {"settlements.settled_at": {"$gte": (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()}}})
    
    pipeline.extend([
        {"$project": {
            "_id": 0,
            "amount": "$settlements.amount",
            "payment_type": "$settlements.payment_type",
            "settled_at": "$settlements.settled_at",
            "created_at": 1,
            "customer_name": 1,
            "total_due": "$amount",
            "settled_amount": 1,
        }},
        # BUG-S3-01 FIX: push all stats into MongoDB via $facet — eliminates to_list(10000)
        # Python cap and moves computation to the database
        {"$facet": {
            "totals": [
                {"$group": {
                    "_id": None,
                    "total": {"$sum": "$amount"},
                    "count": {"$sum": 1},
                    "largest": {"$max": "$amount"},
                    "latest": {"$max": "$settled_at"},
                }}
            ],
            "by_method": [
                {"$group": {
                    "_id": {"$ifNull": ["$payment_type", "Cash"]},
                    "total": {"$sum": "$amount"},
                    "count": {"$sum": 1},
                }}
            ],
            "by_customer": [
                {"$group": {"_id": "$customer_name", "total": {"$sum": "$amount"}}},
                {"$sort": {"total": -1}},
                {"$limit": 5},
            ],
            # Only fetch the two date fields needed for aging — lightweight even at scale
            "aging_data": [
                {"$project": {"_id": 0, "created_at": 1, "settled_at": 1}}
            ],
        }},
    ])

    facet_result = await db.collections.aggregate(pipeline).to_list(1)
    facet = facet_result[0] if facet_result else {}

    totals_row = facet.get("totals", [])
    total_collected   = totals_row[0]["total"]   if totals_row else 0
    collection_count  = totals_row[0]["count"]   if totals_row else 0
    largest_collection = totals_row[0]["largest"] if totals_row else 0
    latest_collection_date = totals_row[0]["latest"] if totals_row else None
    avg_collection = total_collected / collection_count if collection_count > 0 else 0

    method_breakdown = [
        {"method": r["_id"], "total": r["total"], "count": r["count"]}
        for r in facet.get("by_method", [])
    ]

    top_customers = [
        {"name": r["_id"] or "Unknown", "total": r["total"]}
        for r in facet.get("by_customer", [])
    ]

    # Aging computation — uses only created_at + settled_at, no hard cap
    aging = {"within_7_days": 0, "within_30_days": 0, "over_30_days": 0, "unknown": 0}
    total_days = 0
    for settlement in facet.get("aging_data", []):
        if settlement.get("created_at") and settlement.get("settled_at"):
            try:
                created_dt = datetime.fromisoformat(settlement["created_at"].replace("Z", "+00:00"))
                settled_dt = datetime.fromisoformat(settlement["settled_at"].replace("Z", "+00:00"))
                days = (settled_dt - created_dt).days
                total_days += days
                if days <= 7:
                    aging["within_7_days"] += 1
                elif days <= 30:
                    aging["within_30_days"] += 1
                else:
                    aging["over_30_days"] += 1
            except (ValueError, TypeError):
                aging["unknown"] += 1
                logger.warning(f"Bad date in aging data: created={settlement.get('created_at')}, settled={settlement.get('settled_at')}")

    avg_collection_days = total_days / collection_count if collection_count > 0 else 0

    # Collection efficiency (across all collections, not just filtered by period)
    eff_result = await db.collections.aggregate([
        {"$match": {"is_deleted": False, "settlements": {"$exists": True, "$ne": []}}},
        {"$group": {"_id": None, "total_due": {"$sum": "$amount"}, "total_settled": {"$sum": "$settled_amount"}}}
    ]).to_list(1)
    total_due = eff_result[0]["total_due"] if eff_result else 0
    total_settled_all = eff_result[0]["total_settled"] if eff_result else 0
    efficiency = min((total_settled_all / total_due * 100), 100.0) if total_due > 0 else 0

    return {
        "period": period,
        "total_collected": total_collected,
        "collection_count": collection_count,
        "average_collection": round(avg_collection, 2),
        "collection_efficiency_percent": round(efficiency, 1),
        "average_collection_days": round(avg_collection_days, 1),
        "aging_breakdown": aging,
        "method_breakdown": method_breakdown,
        "top_customers": top_customers,
        "largest_collection": largest_collection,
        "latest_collection_date": latest_collection_date
    }


@router.post("/collections/bulk")
async def bulk_collect_from_customer(data: BulkCollectionCreate, request: Request, auth: dict = Depends(auth_required)):
    """
    Make bulk collection from customer for multiple pending payments at once.
    
    Allocation methods:
    - fifo: Settle oldest pending payments first
    - proportional: Split proportionally by remaining amount
    - manual: Use manual_allocations dict to specify per-payment amounts
    """
    await check_permission(auth, "collections")
    
    # Validate customer exists
    customer = await db.customers.find_one({"id": data.customer_id, "is_deleted": False}, {"_id": 0})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    
    # Get all specified pending payments
    pending_payments = await db.collections.find({
        "id": {"$in": data.pending_payment_ids},
        "customer_id": data.customer_id,
        "is_deleted": False,
        "status": {"$ne": "settled"}
    }, {"_id": 0}).to_list(100)
    
    if len(pending_payments) != len(data.pending_payment_ids):
        found_ids = {p["id"] for p in pending_payments}
        missing = set(data.pending_payment_ids) - found_ids
        raise HTTPException(status_code=404, detail=f"Pending payments not found or already settled: {missing}")
    
    # Calculate remaining amounts
    pp_remaining = {}
    for pp in pending_payments:
        remaining = pp["amount"] - pp.get("settled_amount", 0)
        if remaining <= 0:
            raise HTTPException(status_code=400, detail=f"Pending payment {pp.get('pending_payment_id', pp['id'])} has no remaining amount")
        pp_remaining[pp["id"]] = {"remaining": remaining, "pp": pp}
    
    total_remaining = sum(v["remaining"] for v in pp_remaining.values())
    
    if data.total_amount > total_remaining:
        raise HTTPException(status_code=400, detail=f"Amount ₹{data.total_amount} exceeds total remaining ₹{total_remaining}")
    
    # Validate wallet
    wallet = await db.wallets.find_one({"id": data.wallet_id, "is_deleted": False}, {"_id": 0})
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")
    
    if wallet["wallet_type"] not in ["cash", "bank"]:
        raise HTTPException(status_code=400, detail="Only cash or bank wallets can receive collections")
    
    if wallet["wallet_type"] == "bank" and not data.payment_type:
        raise HTTPException(status_code=400, detail="Payment type is required for bank wallet collections")
    
    # Calculate allocations based on method
    allocations: Dict[str, float] = {}
    
    if data.allocation_method == "manual":
        if not data.manual_allocations:
            raise HTTPException(status_code=400, detail="manual_allocations required for manual method")
        
        for pp_id, amount in data.manual_allocations.items():
            if pp_id not in pp_remaining:
                raise HTTPException(status_code=400, detail=f"Pending payment {pp_id} not in selected list")
            if amount > pp_remaining[pp_id]["remaining"]:
                raise HTTPException(status_code=400, detail=f"Amount for {pp_id} exceeds remaining")
            if amount > 0:
                allocations[pp_id] = amount
        
        if abs(sum(allocations.values()) - data.total_amount) > 0.01:
            raise HTTPException(status_code=400, detail="Manual allocations must sum to total_amount")
    
    elif data.allocation_method == "fifo":
        sorted_pps = sorted(pending_payments, key=lambda x: x.get("created_at", ""))
        remaining_to_allocate = data.total_amount
        
        for pp in sorted_pps:
            if remaining_to_allocate <= 0:
                break
            pp_max = pp_remaining[pp["id"]]["remaining"]
            allocation = min(remaining_to_allocate, pp_max)
            if allocation > 0:
                allocations[pp["id"]] = allocation
                remaining_to_allocate -= allocation
    
    elif data.allocation_method == "proportional":
        for pp_id, info in pp_remaining.items():
            proportion = info["remaining"] / total_remaining
            allocation = round(data.total_amount * proportion, 2)
            if allocation > 0:
                allocations[pp_id] = min(allocation, info["remaining"])
        
        # Adjust for rounding errors — re-clamp to remaining cap after correction
        diff = data.total_amount - sum(allocations.values())
        if abs(diff) > 0.01 and allocations:
            first_key = list(allocations.keys())[0]
            allocations[first_key] = min(allocations[first_key] + diff, pp_remaining[first_key]["remaining"])
    
    else:
        raise HTTPException(status_code=400, detail=f"Invalid allocation_method: {data.allocation_method}")
    
    # Execute the bulk collection using _execute_settlement per allocation
    bulk_collection_id = str(uuid.uuid4())
    method = "bank_transfer" if wallet["wallet_type"] == "bank" else "cash"
    charge_pct = data.charge_percentage

    all_ops = []
    settlements_created = []
    all_results = []

    async def execute_rollbacks():
        max_retries = 3
        for op in reversed(all_ops):
            for attempt in range(max_retries):
                try:
                    t = op[0]
                    if t == "wallet_credit":
                        await db.wallets.update_one({"id": op[1]}, {"$inc": {"balance": -op[2]}})
                    elif t == "wallet_op":
                        await db.wallet_operations.delete_one({"operation_id": op[1]})
                    elif t == "collection":
                        await db.collections.update_one({"id": op[1]}, {"$set": {
                            "settlements": op[2]["settlements"], "settled_amount": op[2]["settled_amount"],
                            "total_charges": op[2]["total_charges"], "status": op[2]["status"],
                        }})
                    elif t == "service_charge":
                        await db.collections.delete_one({"id": op[1]})
                    elif t == "writeoff_expense":
                        await db.expenses.delete_one({"id": op[1]})
                    break  # Success — move to next op
                except Exception as rb_err:
                    if attempt == max_retries - 1:
                        logger.error(f"Bulk collect rollback FAILED after {max_retries} retries ({op[0]}): {rb_err}")
                        try:
                            await db.operation_failures.insert_one({
                                "operation_type": "bulk_rollback",
                                "failed_step": op[0],
                                "details": str(op),
                                "error": str(rb_err),
                                "created_at": datetime.now(timezone.utc).isoformat(),
                            })
                        except Exception:
                            pass
                    else:
                        logger.warning(f"Bulk rollback retry {attempt+1}/{max_retries} for {op[0]}: {rb_err}")

    try:
        for pp_id, amount in allocations.items():
            pp = pp_remaining[pp_id]["pp"]

            result = await _execute_settlement(
                collection=pp,
                gross_amount=amount,
                method=method,
                charge_percentage=charge_pct,
                wallet_id=data.wallet_id,
                wallet_name=wallet["name"],
                wallet_type=wallet["wallet_type"],
                reference_type="bulk_collection",
                auth_user_id=auth["user"]["id"],
                auth_user_name=auth["user"]["name"],
                payment_type=data.payment_type,
                notes=data.notes or f"Bulk collection from {customer['name']}",
                extra_fields={"bulk_collection_id": bulk_collection_id},
                include_charges=data.include_charges,
            )
            all_ops.extend(result["ops_performed"])
            all_results.append(result)
            settlements_created.append({
                "pending_payment_id": pp_id,
                "pending_payment_readable": pp.get("pending_payment_id", ""),
                "amount": amount,
                "new_status": result["new_status"],
            })
    except HTTPException:
        await execute_rollbacks()
        raise
    except Exception as e:
        logger.error(f"Bulk collection failed, rolling back: {e}")
        await execute_rollbacks()
        raise HTTPException(status_code=500, detail=f"Bulk collection failed and was rolled back: {str(e)}")

    # Log audit
    await log_audit(auth["user"]["id"], auth["user"]["name"], "bulk_collection", "collections", bulk_collection_id, {
        "customer": customer["name"],
        "total_amount": data.total_amount,
        "collections_count": len(allocations),
        "allocation_method": data.allocation_method,
        "wallet": wallet["name"]
    }, ip=request.client.host if request.client else "")

    # Get updated wallet balance
    updated_wallet = await db.wallets.find_one({"id": data.wallet_id}, {"_id": 0, "balance": 1})
    balance_after = updated_wallet.get("balance", 0) if updated_wallet else 0

    service_charges_created = [r["outstanding_info"] for r in all_results if r.get("outstanding_info")]

    return {
        "bulk_collection_id": bulk_collection_id,
        "customer_id": data.customer_id,
        "customer_name": customer["name"],
        "total_amount": data.total_amount,
        "collections_settled": len(allocations),
        "allocations": allocations,
        "allocation_method": data.allocation_method,
        "wallet_balance_after": balance_after,
        "settlements": settlements_created,
        "service_charges_created": service_charges_created,
    }



@router.post("/collections/{collection_id}/void-settlement/{settlement_id}")
async def void_collection_settlement(
    collection_id: str,
    settlement_id: str,
    request: Request,
    auth: dict = Depends(auth_required)
):
    """
    Void/reverse a specific settlement on a collection.
    Reverses the wallet credit and recalculates collection status.
    """
    await check_permission(auth, "collections")
    
    collection = await db.collections.find_one({"id": collection_id, "is_deleted": False}, {"_id": 0})
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    # BUG-2 FIX: Prevent voiding a settlement on a cancelled collection (breaks reversal invariants)
    if collection["status"] == "cancelled":
        raise HTTPException(status_code=400, detail="Cannot void a settlement on a cancelled collection")

    settlements = collection.get("settlements", [])
    settlement_to_void = None
    
    for s in settlements:
        if s.get("id") == settlement_id:
            settlement_to_void = s
            break
    
    if not settlement_to_void:
        raise HTTPException(status_code=404, detail="Settlement not found in this collection")
    
    if settlement_to_void.get("voided"):
        raise HTTPException(status_code=400, detail="Settlement already voided")
    
    now_iso = datetime.now(timezone.utc).isoformat()
    
    # Determine the amount to reverse
    reverse_amount = settlement_to_void.get("net_amount") or settlement_to_void.get("amount", 0)
    wallet_credit_amount = settlement_to_void.get("wallet_credit_amount") or settlement_to_void.get("gross_amount") or settlement_to_void.get("amount", 0)
    wallet_id = settlement_to_void.get("wallet_id")
    
    if not wallet_id:
        raise HTTPException(status_code=400, detail="Cannot void: no wallet_id on settlement")
    
    # Reverse the wallet credit (debit the wallet)
    wallet = await db.wallets.find_one({"id": wallet_id, "is_deleted": False}, {"_id": 0})
    if not wallet:
        raise HTTPException(status_code=404, detail="Settlement wallet not found")
    
    # BUG-9 FIX: Allow void even when wallet balance is insufficient — voids are reversals, not new debits
    updated_wallet = await db.wallets.find_one_and_update(
        {"id": wallet_id},
        {
            "$inc": {"balance": -wallet_credit_amount},
            "$set": {"updated_at": now_iso}
        },
        return_document=True,
        projection={"_id": 0}
    )
    
    if not updated_wallet:
        raise HTTPException(status_code=400, detail="Failed to update wallet for void reversal")
    
    balance_after = updated_wallet.get("balance", 0)
    balance_before = balance_after + wallet_credit_amount

    # Alert on negative wallet balance after void
    if balance_after < 0:
        try:
            await db.system_alerts.insert_one({
                "type": "negative_wallet_balance",
                "severity": "warning",
                "message": f"Wallet '{updated_wallet.get('name', wallet_id)}' went negative ({balance_after:.2f}) after voiding settlement {settlement_id} on collection {collection_id}",
                "wallet_id": wallet_id,
                "balance": balance_after,
                "created_at": now_iso,
            })
        except Exception:
            logger.warning(f"Negative wallet balance after void: {wallet_id} = {balance_after}")
    
    # Create reversal wallet operation
    op_id = await generate_operation_id(db)
    seq = await get_next_operation_sequence(db, wallet_id)
    
    wallet_op = WalletOperation(
        operation_id=op_id,
        wallet_id=wallet_id,
        wallet_name=wallet["name"],
        wallet_type=wallet["wallet_type"],
        operation_type="debit",
        amount=wallet_credit_amount,
        balance_before=balance_before,
        balance_after=balance_after,
        reference_id=collection_id,
        reference_type="settlement_void",
        transaction_id=collection.get("transaction_id_readable", ""),
        customer_id=collection.get("customer_readable_id", ""),
        notes=f"Void settlement: {collection.get('customer_name', '')}",
        created_by=auth["user"]["id"],
        created_by_name=auth["user"]["name"]
    )
    
    op_doc = wallet_op.model_dump()
    op_doc['created_at'] = now_iso
    op_doc['updated_at'] = now_iso
    op_doc['sequence_number'] = seq
    await db.wallet_operations.insert_one(op_doc)
    
    # BUG-4 FIX: Use positional $ operator to mark void — avoids overwriting concurrent $push settlements
    await db.collections.update_one(
        {"id": collection_id, "settlements.id": settlement_id},
        {"$set": {
            "settlements.$.voided": True,
            "settlements.$.voided_at": now_iso,
            "settlements.$.voided_by": auth["user"]["id"],
            "settlements.$.voided_by_name": auth["user"]["name"],
        }}
    )

    # BUG-04 FIX: Reverse PG expense if this was a card_swipe settlement
    pg_expense_id = settlement_to_void.get("pg_expense_id")
    if pg_expense_id:
        await db.expenses.update_one(
            {"id": pg_expense_id, "is_deleted": False},
            {"$set": {"is_deleted": True, "updated_at": now_iso}}
        )

    # ── CASCADE: Void linked service_charge collection if present ──
    outstanding_collection_id = settlement_to_void.get("outstanding_collection_id")
    if outstanding_collection_id:
        sc_collection = await db.collections.find_one({"id": outstanding_collection_id, "is_deleted": False}, {"_id": 0})
        if sc_collection and sc_collection.get("status") != "cancelled":
            # Reverse all sub-settlements on the service_charge collection
            sc_total_principal_voided = 0.0
            sc_total_charges_voided = 0.0
            for sub_settlement in sc_collection.get("settlements", []):
                if sub_settlement.get("voided"):
                    continue
                sub_wallet_credit = sub_settlement.get("wallet_credit_amount") or sub_settlement.get("gross_amount") or sub_settlement.get("amount", 0)
                sub_wallet_id = sub_settlement.get("wallet_id")
                if sub_wallet_id and sub_wallet_credit > 0:
                    # FIX-1: Remove $gte balance guard — voids must always reverse
                    # wallet credits, even if balance goes negative (matches main void behavior)
                    sub_wallet = await db.wallets.find_one_and_update(
                        {"id": sub_wallet_id},
                        {"$inc": {"balance": -sub_wallet_credit}, "$set": {"updated_at": now_iso}},
                        return_document=True, projection={"_id": 0}
                    )
                    if sub_wallet:
                        sub_op_id = await generate_operation_id(db)
                        sub_seq = await get_next_operation_sequence(db, sub_wallet_id)
                        sub_rev_op = WalletOperation(
                            operation_id=sub_op_id, wallet_id=sub_wallet_id,
                            wallet_name=sub_wallet["name"], wallet_type=sub_wallet.get("wallet_type", ""),
                            operation_type="debit", amount=sub_wallet_credit,
                            balance_before=sub_wallet["balance"] + sub_wallet_credit,
                            balance_after=sub_wallet["balance"],
                            reference_id=outstanding_collection_id,
                            reference_type="settlement_void_cascade",
                            notes="Cascade void: service charge settlement reversed",
                            created_by=auth["user"]["id"], created_by_name=auth["user"]["name"],
                        )
                        sub_op_doc = sub_rev_op.model_dump()
                        sub_op_doc["created_at"] = now_iso
                        sub_op_doc["updated_at"] = now_iso
                        sub_op_doc["sequence_number"] = sub_seq
                        await db.wallet_operations.insert_one(sub_op_doc)
                # FIX-7: Track principal and charges for settled_amount decrement
                sub_principal = sub_settlement.get("principal_amount") or sub_settlement.get("gross_amount") or sub_settlement.get("amount", 0)
                sub_charges = sub_settlement.get("charge_amount", 0)
                sc_total_principal_voided += sub_principal
                sc_total_charges_voided += sub_charges
                # Mark sub-settlement as voided
                await db.collections.update_one(
                    {"id": outstanding_collection_id, "settlements.id": sub_settlement.get("id")},
                    {"$set": {"settlements.$.voided": True, "settlements.$.voided_at": now_iso}}
                )
            # FIX-7: Decrement settled_amount and total_charges on service_charge collection
            # so the document is internally consistent even when cancelled
            if sc_total_principal_voided > 0 or sc_total_charges_voided > 0:
                await db.collections.update_one(
                    {"id": outstanding_collection_id},
                    {"$inc": {
                        "settled_amount": -round(sc_total_principal_voided, 2),
                        "total_charges": -round(sc_total_charges_voided, 2),
                    }}
                )
            # Cancel the service_charge collection
            await db.collections.update_one(
                {"id": outstanding_collection_id},
                {"$set": {"status": "cancelled", "updated_at": now_iso}}
            )
            # Decrement pending_charges_amount by the unsettled portion
            sc_remaining = max(0, sc_collection.get("amount", 0) - sc_collection.get("settled_amount", 0) + sc_total_principal_voided)
            sc_txn_id = sc_collection.get("transaction_id")
            if sc_txn_id and sc_remaining > 0:
                await db.transactions.update_one(
                    {"id": sc_txn_id, "is_deleted": False, "pending_charges_amount": {"$gt": 0}},
                    {"$inc": {"pending_charges_amount": -round(sc_remaining, 2)},
                     "$set": {"updated_at": now_iso}}
                )
                await db.transactions.update_one(
                    {"id": sc_txn_id, "pending_charges_amount": {"$lt": 0}},
                    {"$set": {"pending_charges_amount": 0}}
                )

    # ── CASCADE: Void linked write-off expense if present ──
    writeoff_expense_id = settlement_to_void.get("writeoff_expense_id")
    if writeoff_expense_id:
        await db.expenses.update_one(
            {"id": writeoff_expense_id, "is_deleted": False},
            {"$set": {"is_deleted": True, "updated_at": now_iso}}
        )

    # Atomically decrement settled_amount and total_charges, then read back for status computation
    # Use principal_amount for settled_amount (not gross_amount) since include_charges mode settles by principal
    principal_voided = settlement_to_void.get("principal_amount") or settlement_to_void.get("gross_amount") or settlement_to_void.get("amount", 0)
    charge_voided = settlement_to_void.get("charge_amount", 0)
    updated_col = await db.collections.find_one_and_update(
        {"id": collection_id},
        {
            "$inc": {"settled_amount": -principal_voided, "total_charges": -charge_voided},
            "$set": {"updated_at": now_iso}
        },
        return_document=True,
        projection={"_id": 0}
    )
    new_settled_amount = max(0, updated_col.get("settled_amount", 0))
    new_total_charges = max(0, updated_col.get("total_charges", 0))

    # Determine new status
    remaining = collection.get("amount", 0) - new_settled_amount
    if new_settled_amount > collection.get("amount", 0) + 1.0:
        new_status = "overpaid"
    elif remaining <= 1.0 and new_settled_amount > 0:
        new_status = "settled"
    elif new_settled_amount > 0:
        new_status = "partial"
    else:
        new_status = "pending"

    await db.collections.update_one(
        {"id": collection_id},
        {"$set": {
            "settled_amount": round(new_settled_amount, 2),
            "total_charges": round(new_total_charges, 2),
            "status": new_status,
        }}
    )
    
    # BUG-E/F FIX: Handle status transitions on void
    # BUG-A FIX: ALWAYS reverse card_swipe transaction swipe fields, regardless of collection status
    old_col_status = collection.get("status")
    txn_id = collection.get("transaction_id")

    if txn_id:
        txn_revert_update = {}

        # Always reverse card_swipe swipe fields when voiding a card_swipe settlement
        voided_method = settlement_to_void.get("method", "")
        if voided_method == "card_swipe":
            voided_gross = settlement_to_void.get("gross_amount", 0)
            voided_principal = settlement_to_void.get("principal_amount") or voided_gross
            voided_pg = settlement_to_void.get("pg_amount", 0)
            voided_comm = settlement_to_void.get("commission_amount", 0)
            txn_revert_update["$inc"] = {
                "total_swiped": -voided_gross,
                "gateway_charge_amount": -voided_pg,
                "commission_amount": -voided_comm,
                "pending_swipe_amount": voided_principal,
            }

            # BUG-2 FIX: Remove voided swipe_history entry
            voided_settlement_id = settlement_to_void.get("id", "")
            txn_revert_update["$pull"] = {"swipe_history": {"settlement_id": voided_settlement_id}}

            # BUG-3 FIX: Clear stale primary swipe fields if all swipes are now voided
            txn_for_void = await db.transactions.find_one(
                {"id": txn_id, "is_deleted": False},
                {"_id": 0, "total_swiped": 1}
            )
            new_total_swiped = (txn_for_void.get("total_swiped", 0) if txn_for_void else 0) - voided_gross
            if new_total_swiped <= 0:
                txn_revert_update.setdefault("$set", {})
                txn_revert_update["$set"].update({
                    "swipe_amount": 0,
                    "swipe_gateway_id": "",
                    "swipe_gateway_name": "",
                    "swipe_server_id": "",
                    "swipe_server_name": "",
                })
        elif voided_method in ("cash", "bank_transfer"):
            # P1-4/P1-7 Void FIX: Reverse pending_swipe_amount and commission for cash/bank voids
            voided_principal = settlement_to_void.get("principal_amount") or settlement_to_void.get("gross_amount") or settlement_to_void.get("amount", 0)
            voided_comm = settlement_to_void.get("commission_amount", 0)
            txn_revert_update.setdefault("$inc", {})
            txn_revert_update["$inc"]["pending_swipe_amount"] = voided_principal
            if voided_comm > 0:
                txn_revert_update["$inc"]["commission_amount"] = -voided_comm

        # Handle settled/overpaid → other status transitions
        if old_col_status in ("settled", "overpaid") and new_status not in ("settled", "overpaid"):
            if collection.get("source") != "service_charge":
                txn_revert_update.setdefault("$set", {})
                # Use correct status based on transaction type
                txn_doc = await db.transactions.find_one(
                    {"id": txn_id, "is_deleted": False}, {"_id": 0, "transaction_type": 1}
                )
                if txn_doc and txn_doc.get("transaction_type") == "type_02":
                    txn_revert_update["$set"]["status"] = "pending_swipe"
                else:
                    txn_revert_update["$set"]["status"] = "payment_pending"
                txn_revert_update["$set"]["updated_at"] = now_iso

        # P0-2b FIX: Reverse overpayment — separated from status-transition check
        if old_col_status == "overpaid":
            overpay_info = collection.get("overpayment_info")
            if overpay_info:
                old_net_payable = overpay_info.get("net_payable", 0)
            else:
                # Fallback for collections without stored overpayment_info
                old_net_payable = max(0, round(collection.get("settled_amount", 0) - collection.get("amount", 0), 2))

            if old_net_payable > 0:
                txn_revert_update.setdefault("$inc", {})
                txn_revert_update["$inc"]["amount_remaining_to_customer"] = txn_revert_update["$inc"].get("amount_remaining_to_customer", 0) - old_net_payable
                txn_revert_update["$inc"]["amount_to_customer"] = txn_revert_update["$inc"].get("amount_to_customer", 0) - old_net_payable

            # Recalculate if still overpaid after void
            if new_status == "overpaid":
                new_excess = max(0, round(new_settled_amount - collection.get("amount", 0), 2))
                if new_excess > 0:
                    # net_payable always equals full excess (no charges deducted)
                    new_net_payable = new_excess

                    txn_revert_update["$inc"]["amount_remaining_to_customer"] = txn_revert_update["$inc"].get("amount_remaining_to_customer", 0) + new_net_payable
                    txn_revert_update["$inc"]["amount_to_customer"] = txn_revert_update["$inc"].get("amount_to_customer", 0) + new_net_payable

                    await db.collections.update_one(
                        {"id": collection_id},
                        {"$set": {"overpayment_info": {
                            "excess_principal": new_excess,
                            "charges_on_excess": 0.0,
                            "net_payable": new_net_payable,
                            "settlement_id": "recalculated_after_void",
                        }}}
                    )
                else:
                    await db.collections.update_one({"id": collection_id}, {"$unset": {"overpayment_info": ""}})
            else:
                await db.collections.update_one({"id": collection_id}, {"$unset": {"overpayment_info": ""}})

        if txn_revert_update:
            await db.transactions.update_one({"id": txn_id}, txn_revert_update)
            # Recalculate customer_payment_status after void
            updated_txn = await db.transactions.find_one({"id": txn_id, "is_deleted": False}, {"_id": 0})
            if updated_txn:
                paid = updated_txn.get("amount_paid_to_customer", 0)
                remaining = updated_txn.get("amount_remaining_to_customer", 0)
                ato = updated_txn.get("amount_to_customer", 0)
                if remaining <= 0:
                    cps = "not_applicable" if ato == 0 else "paid"
                elif paid > 0:
                    cps = "partial"
                else:
                    cps = "pending"
                await db.transactions.update_one({"id": txn_id}, {"$set": {"customer_payment_status": cps}})

        # Re-increment pending_charges_amount when voiding a service_charge settlement
        if collection.get("source") == "service_charge" and txn_id:
            voided_principal = settlement_to_void.get("principal_amount") or settlement_to_void.get("gross_amount", 0)
            if voided_principal > 0:
                await db.transactions.update_one(
                    {"id": txn_id, "is_deleted": False},
                    {"$inc": {"pending_charges_amount": round(voided_principal, 2)},
                     "$set": {"updated_at": now_iso}}
                )
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "void_settlement", "collections", collection_id, {
        "settlement_id": settlement_id,
        "reversed_amount": reverse_amount,
        "wallet_debited": wallet["name"],
        "new_status": new_status
    }, ip=request.client.host if request.client else "")
    
    updated_collection = await db.collections.find_one({"id": collection_id}, {"_id": 0})
    
    return {
        "success": True,
        "message": f"Settlement voided. Collection status: {new_status}",
        "collection": serialize_doc(updated_collection),
        "reversed_amount": reverse_amount,
        "wallet_debited": wallet["name"],
        "wallet_new_balance": balance_after
    }



@router.post("/collections/bulk-unified")
async def bulk_settle_unified(
    data: BulkUnifiedCollectionCreate,
    request: Request,
    auth: dict = Depends(auth_required)
):
    """Atomic bulk settlement with rollback. Uses shared _execute_settlement core."""
    await check_permission(auth, "collections")

    if not data.settlements:
        raise HTTPException(status_code=400, detail="No settlements provided")

    # ── PHASE 1: VALIDATE ──
    collection_ids = [s.collection_id for s in data.settlements]
    
    # BUG-7 FIX: Reject duplicate collection IDs in the same batch (moved BEFORE db lookup)
    if len(collection_ids) != len(set(collection_ids)):
        raise HTTPException(status_code=400, detail="Duplicate collection IDs are not allowed in the same batch")
    
    collections = await db.collections.find(
        {"id": {"$in": collection_ids}, "is_deleted": False}, {"_id": 0}
    ).to_list(100)
    if len(collections) != len(collection_ids):
        found = {c["id"] for c in collections}
        raise HTTPException(status_code=404, detail=f"Collections not found: {set(collection_ids) - found}")

    col_lookup = {c["id"]: c for c in collections}
    for col in collections:
        if col["status"] == "settled":
            raise HTTPException(status_code=400, detail=f"Collection {col['id']} is already fully settled")
        if col["status"] == "overpaid":
            raise HTTPException(status_code=400, detail=f"Collection {col['id']} is overpaid and cannot accept further settlements")
        # BUG-1 FIX: Prevent settling a cancelled collection
        if col["status"] == "cancelled":
            raise HTTPException(status_code=400, detail=f"Collection {col['id']} is cancelled and cannot be settled")

    # P1-6 FIX: Validate include_charges mode for bulk unified
    if data.include_charges and data.charge_percentage >= 100:
        raise HTTPException(status_code=400, detail="charge_percentage must be less than 100% when using Include All Charges mode")

    for item in data.settlements:
        if item.gross_amount <= 0:
            raise HTTPException(status_code=400, detail=f"gross_amount must be positive for collection {item.collection_id}")
        col = col_lookup[item.collection_id]
        remaining = col["amount"] - col.get("settled_amount", 0)
        # BUG-5 FIX: Use correct principal for validation based on mode
        if data.include_charges:
            principal_check = round(item.gross_amount * (1 - data.charge_percentage / 100), 2)
        else:
            principal_check = item.gross_amount
        if principal_check > remaining + 1.0:
            raise HTTPException(status_code=400, detail=f"Principal {principal_check} exceeds remaining {remaining} for collection {item.collection_id}")

    # Method-specific validation
    now_iso = datetime.now(timezone.utc).isoformat()
    gateway_info = None
    wallet_id_to_use = ""
    wallet_name = ""
    wallet_type = ""

    if data.method == "card_swipe":
        if not data.gateway_id or not data.server_id:
            raise HTTPException(status_code=400, detail="gateway_id and server_id required for card_swipe")
        gateway = await db.gateways.find_one({"id": data.gateway_id, "is_deleted": False, "is_active": True}, {"_id": 0})
        if not gateway:
            raise HTTPException(status_code=404, detail="Gateway not found or inactive")
        server = await db.gateway_servers.find_one({"id": data.server_id, "gateway_id": data.gateway_id, "is_deleted": False, "is_active": True}, {"_id": 0})
        if not server:
            raise HTTPException(status_code=404, detail="Gateway server not found or inactive")
        pg_pct = server.get("charge_percentage", 0)
        if data.charge_percentage < pg_pct:
            raise HTTPException(status_code=400, detail=f"charge_percentage must be >= PG charges ({pg_pct}%)")
        wallet_doc = await db.wallets.find_one({"wallet_type": "gateway", "gateway_id": data.gateway_id, "is_deleted": False}, {"_id": 0})
        if not wallet_doc:
            raise HTTPException(status_code=500, detail="Gateway wallet not found")
        wallet_id_to_use = wallet_doc["id"]
        wallet_name = wallet_doc["name"]
        wallet_type = "gateway"
        gateway_info = {"id": data.gateway_id, "name": gateway["name"], "server_id": data.server_id, "server_name": server["name"], "pg_percentage": pg_pct}
    else:
        if not data.wallet_id:
            raise HTTPException(status_code=400, detail="wallet_id required for cash/bank_transfer")
        wallet_doc = await db.wallets.find_one({"id": data.wallet_id, "is_deleted": False}, {"_id": 0})
        if not wallet_doc:
            raise HTTPException(status_code=404, detail="Wallet not found")
        expected_type = "cash" if data.method == "cash" else "bank"
        if wallet_doc["wallet_type"] != expected_type:
            raise HTTPException(status_code=400, detail=f"Wallet must be type '{expected_type}' for {data.method}")
        if data.method == "bank_transfer" and not data.payment_type:
            raise HTTPException(status_code=400, detail="payment_type required for bank_transfer")
        wallet_id_to_use = data.wallet_id
        wallet_name = wallet_doc["name"]
        wallet_type = wallet_doc["wallet_type"]

    # ── PHASE 2: EXECUTE WITH ROLLBACK ──
    bulk_id = str(uuid.uuid4())
    all_ops = []
    settled_results = []

    async def execute_rollbacks():
        for op in reversed(all_ops):
            for attempt in range(3):
                try:
                    t = op[0]
                    if t == "wallet_credit":
                        await db.wallets.update_one({"id": op[1]}, {"$inc": {"balance": -op[2]}})
                    elif t == "wallet_op":
                        await db.wallet_operations.delete_one({"operation_id": op[1]})
                    elif t == "pg_expense":
                        await db.expenses.delete_one({"id": op[1]})
                    elif t == "collection":
                        await db.collections.update_one({"id": op[1]}, {"$set": {
                            "settlements": op[2]["settlements"], "settled_amount": op[2]["settled_amount"],
                            "total_charges": op[2]["total_charges"], "status": op[2]["status"], "updated_at": now_iso
                        }})
                    elif t == "transaction":
                        if op[2]:
                            await db.transactions.update_one({"id": op[1]}, {"$set": {"status": op[2], "updated_at": now_iso}})
                    elif t == "txn_swipe":
                        await db.transactions.update_one({"id": op[1]}, {"$inc": {
                            "total_swiped": -op[2], "pending_swipe_amount": op[2],
                            "gateway_charge_amount": -op[3], "commission_amount": -op[4],
                        }})
                    elif t == "service_charge":
                        await db.collections.delete_one({"id": op[1]})
                    elif t == "writeoff_expense":
                        await db.expenses.delete_one({"id": op[1]})
                    break
                except Exception as rb_err:
                    if attempt == 2:
                        logger.error(f"Bulk-unified rollback FAILED after 3 retries ({op[0]}): {rb_err}")
                        try:
                            await db.operation_failures.insert_one({
                                "operation_type": "bulk_unified_rollback", "failed_step": op[0],
                                "details": str(op), "error": str(rb_err),
                                "created_at": now_iso,
                            })
                        except Exception:
                            pass
                    else:
                        logger.warning(f"Bulk-unified rollback retry {attempt+1}/3 for {op[0]}: {rb_err}")

    try:
        for item in data.settlements:
            col = col_lookup[item.collection_id]
            ref_type = f"bulk_unified_collection_{data.method}"

            result = await _execute_settlement(
                collection=col,
                gross_amount=item.gross_amount,
                method=data.method,
                charge_percentage=data.charge_percentage,
                wallet_id=wallet_id_to_use,
                wallet_name=wallet_name,
                wallet_type=wallet_type,
                reference_type=ref_type,
                auth_user_id=auth["user"]["id"],
                auth_user_name=auth["user"]["name"],
                gateway_info=gateway_info,
                payment_type=data.payment_type,
                notes=data.notes or "",
                extra_fields={"bulk_unified_id": bulk_id},
                include_charges=data.include_charges,
            )
            all_ops.extend(result["ops_performed"])
            settled_results.append({
                "collection_id": item.collection_id,
                "gross_amount": item.gross_amount,
                "net_amount": result["net_amount"],
                "charge_amount": result["charge_amount"],
                "new_status": result["new_status"],
            })

        await log_audit(auth["user"]["id"], auth["user"]["name"], "bulk_collect_unified", "collections", bulk_id, {
            "count": len(data.settlements), "method": data.method,
            "total_gross": sum(s.gross_amount for s in data.settlements),
        }, ip=request.client.host if request.client else "")

        return {
            "success": True, "bulk_unified_id": bulk_id,
            "settled_count": len(settled_results), "method": data.method,
            "results": settled_results,
        }
    except HTTPException:
        await execute_rollbacks()
        raise
    except Exception as e:
        logger.error(f"Bulk unified collection failed, rolling back: {e}")
        await execute_rollbacks()
        raise HTTPException(status_code=500, detail=f"Bulk settlement failed and was rolled back: {str(e)}")
