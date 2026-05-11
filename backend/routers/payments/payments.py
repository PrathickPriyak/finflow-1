"""
Payments Router - Payouts to customers
Clean API: /payments/*
"""
from fastapi import APIRouter, HTTPException, Depends, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
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
from models import WalletOperation, CustomerPaymentCreate, BulkPaymentCreate

router = APIRouter(tags=["Payments"])
logger = logging.getLogger(__name__)

@router.get("/payments/summary")
async def get_customer_payments_summary(auth: dict = Depends(auth_required)):
    """Get summary statistics for customer payments"""
    # BUG-6 FIX: use IST-midnight UTC so midnight–05:30 IST payments are included
    today = get_ist_day_start_utc()

    # BUG-8 FIX: aggregation replaces to_list(1000) — scales to any number of pending transactions
    pending_agg = await db.transactions.aggregate([
        {"$match": {"is_deleted": False, "status": "payment_pending", "amount_remaining_to_customer": {"$gt": 0}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount_remaining_to_customer"}, "count": {"$sum": 1}}}
    ]).to_list(1)
    total_pending = pending_agg[0]["total"] if pending_agg else 0
    pending_count = pending_agg[0]["count"] if pending_agg else 0

    # BUG-10 FIX: aggregation replaces to_list(500)
    today_agg = await db.payments.aggregate([
        {"$match": {"is_deleted": False, "created_at": {"$gte": today}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}, "count": {"$sum": 1}}}
    ]).to_list(1)
    today_paid = today_agg[0]["total"] if today_agg else 0
    today_count = today_agg[0]["count"] if today_agg else 0

    all_payments = await db.payments.count_documents({"is_deleted": False})

    return {
        "total_pending_amount": total_pending,
        "pending_payments_count": pending_count,
        "today_paid_amount": today_paid,
        "today_payments_count": today_count,
        "total_payments_count": all_payments
    }


@router.get("/payments/pending-stats")
async def get_pending_payouts_stats(auth: dict = Depends(auth_required)):
    """Get comprehensive statistics for pending customer payouts"""
    # BUG-7 FIX: use IST-midnight UTC so midnight–05:30 IST payments are included
    today = get_ist_day_start_utc()
    now = datetime.now(timezone.utc)

    # BUG-9 FIX: aggregation for totals — replaces to_list(1000), scales to any count
    totals_agg = await db.transactions.aggregate([
        {"$match": {"is_deleted": False, "status": "payment_pending", "amount_remaining_to_customer": {"$gt": 0}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount_remaining_to_customer"}, "count": {"$sum": 1}}}
    ]).to_list(1)
    total_payable = totals_agg[0]["total"] if totals_agg else 0
    pending_count = totals_agg[0]["count"] if totals_agg else 0

    # BUG-9 FIX: aggregation for today's payments — replaces to_list(500)
    today_agg = await db.payments.aggregate([
        {"$match": {"is_deleted": False, "created_at": {"$gte": today}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]).to_list(1)
    paid_today = today_agg[0]["total"] if today_agg else 0

    # BUG-S3-02 FIX: replace Python analytics loop + to_list(10000) with a
    # single $facet aggregation that computes all stats inside MongoDB
    today_str = today  # IST-midnight UTC ISO string
    week_ago_str = (now - timedelta(days=7)).isoformat()
    month_ago_str = (now - timedelta(days=30)).isoformat()

    base_match = {"is_deleted": False, "status": "payment_pending", "amount_remaining_to_customer": {"$gt": 0}}

    analytics_agg = await db.transactions.aggregate([
        {"$match": base_match},
        {"$facet": {
            "aging": [
                {"$group": {
                    "_id": None,
                    "today":  {"$sum": {"$cond": [{"$gte": ["$created_at", today_str]}, "$amount_remaining_to_customer", 0]}},
                    "week":   {"$sum": {"$cond": [{"$and": [{"$lt": ["$created_at", today_str]}, {"$gte": ["$created_at", week_ago_str]}]}, "$amount_remaining_to_customer", 0]}},
                    "month":  {"$sum": {"$cond": [{"$and": [{"$lt": ["$created_at", week_ago_str]}, {"$gte": ["$created_at", month_ago_str]}]}, "$amount_remaining_to_customer", 0]}},
                    "older":  {"$sum": {"$cond": [{"$lt": ["$created_at", month_ago_str]}, "$amount_remaining_to_customer", 0]}},
                    "overdue_count":  {"$sum": {"$cond": [{"$lt": ["$created_at", week_ago_str]}, 1, 0]}},
                    "overdue_amount": {"$sum": {"$cond": [{"$lt": ["$created_at", week_ago_str]}, "$amount_remaining_to_customer", 0]}},
                    "hv_count":  {"$sum": {"$cond": [{"$gt": ["$amount_remaining_to_customer", 50000]}, 1, 0]}},
                    "hv_amount": {"$sum": {"$cond": [{"$gt": ["$amount_remaining_to_customer", 50000]}, "$amount_remaining_to_customer", 0]}}
                }}
            ],
            "gateway": [
                {"$group": {
                    "_id": {"$ifNull": ["$swipe_gateway_name", "Unknown"]},
                    "count": {"$sum": 1},
                    "amount": {"$sum": "$amount_remaining_to_customer"}
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
        "week":  aging_row.get("week", 0),
        "month": aging_row.get("month", 0),
        "older": aging_row.get("older", 0),
    }
    overdue_count  = aging_row.get("overdue_count", 0)
    overdue_amount = aging_row.get("overdue_amount", 0)
    high_value_count  = aging_row.get("hv_count", 0)
    high_value_amount = aging_row.get("hv_amount", 0)

    gateway_list = [
        {"gateway": r["_id"], "count": r["count"], "amount": r["amount"]}
        for r in analytics.get("gateway", [])
    ]

    # Oldest pending days — compute from oldest doc's created_at
    oldest_days = 0
    oldest_docs = analytics.get("oldest", [])
    if oldest_docs and oldest_docs[0].get("created_at"):
        try:
            oldest_dt = datetime.fromisoformat(oldest_docs[0]["created_at"].replace("Z", "+00:00"))
            oldest_days = (now - oldest_dt).days
        except (ValueError, TypeError):
            logger.warning(f"Bad date in oldest pending transaction: {oldest_docs[0].get('created_at')}")
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    month_agg = await db.payments.aggregate([
        {"$match": {"is_deleted": False, "created_at": {"$gte": month_start}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]).to_list(1)
    month_paid = month_agg[0]["total"] if month_agg else 0
    
    return {
        "total_payable": total_payable,
        "pending_count": pending_count,
        "paid_today": paid_today,
        "oldest_pending_days": oldest_days,
        "overdue_count": overdue_count,
        "overdue_amount": overdue_amount,
        "high_value_count": high_value_count,
        "high_value_amount": high_value_amount,
        "aging_distribution": aging_distribution,
        "gateway_breakdown": gateway_list,
        "month_paid": month_paid
    }


@router.get("/payments/pending")
async def get_pending_payouts(
    filter: str = Query("all", description="Filter: all, pending, overdue, high_value"),
    gateway_id: Optional[str] = None,
    customer_id: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    sort_by: Optional[str] = Query(None, description="Sort by: date, customer, swipe, remaining, gateway"),
    sort_order: Optional[str] = Query("desc", description="Sort order: asc or desc"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    auth: dict = Depends(auth_required)
):
    """Get pending payouts to customers with full transaction context"""
    import re as re_module
    now = datetime.now(timezone.utc)
    
    query = {
        "is_deleted": False,
        "status": "payment_pending",
        "amount_remaining_to_customer": {"$gt": 0}
    }
    
    if gateway_id:
        query["swipe_gateway_id"] = gateway_id
    if customer_id:
        query["customer_id"] = customer_id
    # AUDIT-FIX-09: Add search to pending payouts
    if search:
        escaped = re_module.escape(search)
        search_conditions = [
            {"transaction_id": {"$regex": escaped, "$options": "i"}},
            {"card_details": {"$regex": escaped, "$options": "i"}},
        ]
        # Phone number search via customer lookup
        from utils import get_customer_ids_by_phone
        phone_cids = await get_customer_ids_by_phone(db, search)
        if phone_cids:
            search_conditions.append({"customer_id": {"$in": phone_cids}})
        query["$or"] = search_conditions
    
    # Date range filters
    if date_from:
        query.setdefault("created_at", {})
        query["created_at"]["$gte"] = date_from
    if date_to:
        query.setdefault("created_at", {})
        query["created_at"]["$lte"] = date_to + "T23:59:59.999999"

    # Apply filters at database level for proper pagination
    if filter == "overdue":
        # Overdue = created more than 7 days ago
        seven_days_ago = (now - timedelta(days=7)).isoformat()
        query["created_at"] = {"$lt": seven_days_ago}
    elif filter == "high_value":
        # High value = > 50000
        query["amount_remaining_to_customer"] = {"$gt": 50000}
    
    # Get total count for pagination
    total = await db.transactions.count_documents(query)
    skip = (page - 1) * limit
    
    # Sorting
    sort_field_map = {
        "date": "created_at", "customer": "customer_name",
        "swipe": "swipe_amount", "remaining": "amount_remaining_to_customer",
        "gateway": "swipe_gateway_name",
    }
    sort_field = sort_field_map.get(sort_by, "created_at")
    sort_dir = 1 if sort_order == "asc" else -1
    
    pending_txns = await db.transactions.find(query, {"_id": 0}).sort(sort_field, sort_dir).skip(skip).limit(limit).to_list(limit)
    
    # ARCH-04 FIX: Batch get customer payment counts using aggregation instead of N+1 queries
    customer_ids = list(set(txn.get("customer_id") for txn in pending_txns if txn.get("customer_id")))
    
    # Use aggregation to get payment counts per customer in a single query
    payment_counts_pipeline = [
        {"$match": {"is_deleted": False, "customer_id": {"$in": customer_ids}}},
        {"$group": {"_id": "$customer_id", "count": {"$sum": 1}}}
    ]
    payment_counts_result = await db.payments.aggregate(payment_counts_pipeline).to_list(len(customer_ids)) if customer_ids else []
    payment_counts_lookup = {item["_id"]: item["count"] for item in payment_counts_result}
    
    enriched = []
    for txn in pending_txns:
        remaining = txn.get("amount_remaining_to_customer", 0)
        created_at = txn.get("created_at", "")
        
        # Calculate days pending
        days_pending = 0
        is_overdue = False
        if created_at:
            try:
                created_dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
                days_pending = (now - created_dt).days
                is_overdue = days_pending > 7
            except (ValueError, TypeError):
                logger.warning(f"Bad date on pending txn {txn.get('id','?')}: {created_at}")
        
        is_high_value = remaining > 50000
        customer_payments = payment_counts_lookup.get(txn.get("customer_id"), 0)
        
        enriched.append({
            **txn,
            # Enriched/calculated fields
            "customer_payment_history": customer_payments,
            "days_pending": days_pending,
            "is_overdue": is_overdue,
            "is_high_value": is_high_value,
        })
    
    return {
        "data": serialize_docs(enriched),
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "pages": (total + limit - 1) // limit
        }
    }


@router.get("/payments/sources")
async def get_customer_payment_sources(
    amount: float = Query(0, description="Amount to pay"),
    auth: dict = Depends(auth_required)
):
    """Get available payment sources (wallets) for customer payments"""
    # Get all active wallets (exclude bank wallets as per business logic)
    wallets = await db.wallets.find({
        "is_deleted": False,
        "wallet_type": {"$in": ["gateway", "cash"]}  # Only gateway and cash wallets
    }, {"_id": 0}).to_list(100)
    
    sources = []
    for wallet in wallets:
        balance = wallet.get("balance", 0)
        
        # Determine source type
        if wallet["wallet_type"] == "gateway":
            source_type = "gateway_wallet"
        elif wallet["wallet_type"] == "cash":
            source_type = "cash_wallet"
        else:
            source_type = wallet["wallet_type"]
        
        # Include all wallets, but mark insufficient ones
        # Use field names expected by frontend
        source = {
            "source_id": wallet["id"],
            "source_name": wallet["name"],
            "source_type": source_type,
            "balance": balance,
            "sufficient": balance >= amount,
            "is_suggested": False,
            "gateway_id": wallet.get("gateway_id"),
        }
        
        sources.append(source)
    
    # Sort by balance descending
    sources.sort(key=lambda x: x["balance"], reverse=True)
    
    return sources


@router.get("/payments/history")
async def get_customer_payments_history(
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    payment_method: Optional[str] = None,
    sort_by: Optional[str] = Query(None, description="Sort by: date, amount, customer"),
    sort_order: Optional[str] = Query("desc", description="Sort order: asc or desc"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    auth: dict = Depends(auth_required)
):
    """Get customer payments history with full transaction context"""
    import re as re_module
    query = {"is_deleted": False}
    
    if search:
        escaped = re_module.escape(search)
        search_conditions = [
            {"transaction_id_readable": {"$regex": escaped, "$options": "i"}},
        ]
        from utils import get_customer_ids_by_phone
        phone_cids = await get_customer_ids_by_phone(db, search)
        if phone_cids:
            search_conditions.append({"customer_id": {"$in": phone_cids}})
        query["$or"] = search_conditions
    
    if date_from:
        query.setdefault("created_at", {})
        query["created_at"]["$gte"] = date_from
    if date_to:
        query.setdefault("created_at", {})
        query["created_at"]["$lte"] = date_to + "T23:59:59.999999"
    if payment_method and payment_method != "all":
        query["payment_method"] = payment_method
    
    total = await db.payments.count_documents(query)
    skip = (page - 1) * limit
    
    sort_field_map = {"date": "created_at", "amount": "amount", "customer": "customer_name"}
    sort_field = sort_field_map.get(sort_by, "created_at")
    sort_dir = 1 if sort_order == "asc" else -1
    
    payments = await db.payments.find(
        query, {"_id": 0}
    ).sort(sort_field, sort_dir).skip(skip).limit(limit).to_list(limit)
    
    # ARCH-02 FIX: Batch fetch all transactions to avoid N+1 query
    transaction_ids = [p.get("transaction_id") for p in payments if p.get("transaction_id")]
    transactions = await db.transactions.find(
        {"id": {"$in": transaction_ids}},
        {"_id": 0}
    ).to_list(len(transaction_ids))
    
    # Build lookup dict
    txn_lookup = {txn["id"]: txn for txn in transactions}
    
    # Enrich with transaction context
    enriched_payments = []
    for payment in payments:
        txn = txn_lookup.get(payment.get("transaction_id"))
        
        enriched = {
            **payment,
            # Transaction context
            "transaction_id_readable": txn.get("transaction_id", "") if txn else "",
            "swipe_amount": txn.get("swipe_amount", 0) if txn else 0,
            "total_to_customer": txn.get("amount_to_customer", 0) if txn else 0,
            "amount_remaining": txn.get("amount_remaining_to_customer", 0) if txn else 0,
            "gateway_name": txn.get("swipe_gateway_name", "") if txn else "",
            "server_name": txn.get("swipe_server_name", "") if txn else "",
            "card_details": txn.get("card_details", "") if txn else "",
            "transaction_date": txn.get("created_at", "") if txn else "",
            # Calculate days to payment
            "days_to_payment": 0,
            # Payment status
            "is_full_payment": False,
            "cumulative_paid": txn.get("amount_paid_to_customer", 0) if txn else 0,
        }
        
        # Calculate days from transaction to payment
        if txn and txn.get("created_at") and payment.get("created_at"):
            try:
                txn_date = datetime.fromisoformat(txn["created_at"].replace("Z", "+00:00"))
                pay_date = datetime.fromisoformat(payment["created_at"].replace("Z", "+00:00"))
                enriched["days_to_payment"] = (pay_date - txn_date).days
            except (ValueError, TypeError):
                enriched["days_to_payment"] = None
                logger.warning(f"Bad date on payment {payment.get('id','?')} or txn {txn.get('id','?')}")
        if txn:
            enriched["is_full_payment"] = txn.get("amount_remaining_to_customer", 0) <= 0
        
        enriched_payments.append(enriched)
    
    return {
        "data": serialize_docs(enriched_payments),
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "pages": (total + limit - 1) // limit
        }
    }


@router.get("/payments/history-stats")
async def get_customer_payments_history_stats(
    period: str = Query("all", description="all, today, week, month"),
    auth: dict = Depends(auth_required)
):
    """Get comprehensive statistics for payment history"""
    # BUG-D FIX: use IST-aware UTC start for "today" filter
    today_utc_start = get_ist_day_start_utc()
    
    # Build date filter
    date_filter = {}
    if period == "today":
        date_filter = {"created_at": {"$gte": today_utc_start}}
    elif period == "week":
        week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        date_filter = {"created_at": {"$gte": week_ago}}
    elif period == "month":
        month_ago = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        date_filter = {"created_at": {"$gte": month_ago}}
    
    query = {"is_deleted": False, **date_filter}
    
    # BUG-10 FIX: Replace to_list(10000) in-memory processing with DB aggregation pipelines
    # Main stats: total, count, avg, largest, latest
    stats_agg = await db.payments.aggregate([
        {"$match": query},
        {"$group": {
            "_id": None,
            "total_paid": {"$sum": "$amount"},
            "payment_count": {"$sum": 1},
            "largest_payment": {"$max": "$amount"},
            "latest_payment_date": {"$max": "$created_at"}
        }}
    ]).to_list(1)
    if stats_agg:
        total_paid = stats_agg[0]["total_paid"]
        payment_count = stats_agg[0]["payment_count"]
        avg_payment = total_paid / payment_count if payment_count > 0 else 0
        largest_payment = stats_agg[0]["largest_payment"]
        latest_payment_date = stats_agg[0]["latest_payment_date"]
    else:
        total_paid = payment_count = largest_payment = 0
        avg_payment = 0.0
        latest_payment_date = None

    # Full vs partial: join with transactions via aggregation
    full_payments_agg = await db.payments.aggregate([
        {"$match": query},
        {"$lookup": {
            "from": "transactions",
            "localField": "transaction_id",
            "foreignField": "id",
            "as": "txn"
        }},
        {"$unwind": {"path": "$txn", "preserveNullAndEmptyArrays": True}},
        {"$group": {
            "_id": None,
            "full": {"$sum": {"$cond": [{"$lte": [{"$ifNull": ["$txn.amount_remaining_to_customer", 1]}, 0]}, 1, 0]}},
            "partial": {"$sum": {"$cond": [{"$gt": [{"$ifNull": ["$txn.amount_remaining_to_customer", 1]}, 0]}, 1, 0]}}
        }}
    ]).to_list(1)
    if full_payments_agg:
        full_payments = full_payments_agg[0]["full"]
        partial_payments = full_payments_agg[0]["partial"]
    else:
        full_payments = 0
        partial_payments = payment_count

    # Top customers by payout (DB aggregation — no memory cap)
    top_customers_agg = await db.payments.aggregate([
        {"$match": query},
        {"$group": {"_id": "$customer_name", "total": {"$sum": "$amount"}}},
        {"$sort": {"total": -1}},
        {"$limit": 5}
    ]).to_list(5)
    top_customers = [{"name": r["_id"] or "Unknown", "total": r["total"]} for r in top_customers_agg]

    # Payment method breakdown (DB aggregation)
    method_agg = await db.payments.aggregate([
        {"$match": query},
        {"$group": {
            "_id": {"$ifNull": ["$payment_method", "Unknown"]},
            "total": {"$sum": "$amount"},
            "count": {"$sum": 1}
        }}
    ]).to_list(50)
    method_breakdown = [{"method": r["_id"], "total": r["total"], "count": r["count"]} for r in method_agg]
    
    return {
        "period": period,
        "total_paid": total_paid,
        "payment_count": payment_count,
        "average_payment": round(avg_payment, 2),
        "full_payments": full_payments,
        "partial_payments": partial_payments,
        "top_customers": top_customers,
        "method_breakdown": method_breakdown,
        "largest_payment": largest_payment,
        "latest_payment_date": latest_payment_date
    }


@router.get("/payments/export-excel")
async def export_payments_excel(
    tab: str = Query("pending", description="pending or history"),
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    payment_method: Optional[str] = None,
    request: Request = None,
    auth: dict = Depends(auth_required),
):
    """Export payments (pending or history) to a comprehensive Excel file"""
    import xlsxwriter

    now = datetime.now(timezone.utc)

    if tab == "history":
        query = {"is_deleted": False}
        if date_from:
            query.setdefault("created_at", {})
            query["created_at"]["$gte"] = date_from
        if date_to:
            query.setdefault("created_at", {})
            query["created_at"]["$lte"] = date_to + "T23:59:59.999999"
        if payment_method and payment_method != "all":
            query["payment_method"] = payment_method

        payments = await db.payments.find(query, {"_id": 0}).sort("created_at", -1).to_list(10000)

        # Batch fetch transactions
        txn_ids = list(set(p.get("transaction_id") for p in payments if p.get("transaction_id")))
        txns = await db.transactions.find({"id": {"$in": txn_ids}}, {"_id": 0}).to_list(len(txn_ids)) if txn_ids else []
        txn_lookup = {t["id"]: t for t in txns}

        output = io.BytesIO()
        workbook = xlsxwriter.Workbook(output, {"in_memory": True})
        ws = workbook.add_worksheet("Payment History")
        hdr = workbook.add_format({"bold": True, "bg_color": "#1e293b", "font_color": "#ffffff", "border": 1})
        money = workbook.add_format({"num_format": "#,##0.00", "border": 1})
        cell = workbook.add_format({"border": 1})

        headers = ["Date", "Txn ID", "Customer", "Card Details", "Swipe Amount",
                    "Amount Paid", "Payment Method", "Source Wallet", "Reference",
                    "Gateway", "Days to Payment", "Status", "Notes", "Recorded By"]
        for c, h in enumerate(headers):
            ws.write(0, c, h, hdr)

        for r, p in enumerate(payments, 1):
            txn = txn_lookup.get(p.get("transaction_id"))
            days = 0
            if txn and txn.get("created_at") and p.get("created_at"):
                try:
                    c_dt = datetime.fromisoformat(txn["created_at"].replace("Z", "+00:00"))
                    p_dt = datetime.fromisoformat(p["created_at"].replace("Z", "+00:00"))
                    days = (p_dt - c_dt).days
                except (ValueError, TypeError):
                    pass
            is_full = txn.get("amount_remaining_to_customer", 1) <= 0 if txn else False
            ws.write(r, 0, p.get("created_at", "")[:10], cell)
            ws.write(r, 1, txn.get("transaction_id", "") if txn else "", cell)
            ws.write(r, 2, p.get("customer_name", ""), cell)
            ws.write(r, 3, txn.get("card_details", "") if txn else "", cell)
            ws.write(r, 4, txn.get("swipe_amount", 0) if txn else 0, money)
            ws.write(r, 5, p.get("amount", 0), money)
            ws.write(r, 6, p.get("payment_method", ""), cell)
            ws.write(r, 7, p.get("payment_source_name", ""), cell)
            ws.write(r, 8, p.get("reference_number", ""), cell)
            ws.write(r, 9, txn.get("swipe_gateway_name", "") if txn else "", cell)
            ws.write(r, 10, days, cell)
            ws.write(r, 11, "Full" if is_full else "Partial", cell)
            ws.write(r, 12, p.get("notes", ""), cell)
            ws.write(r, 13, p.get("recorded_by_name", ""), cell)

        if payments:
            sr = len(payments) + 2
            bf = workbook.add_format({"bold": True, "border": 1})
            bm = workbook.add_format({"bold": True, "num_format": "#,##0.00", "border": 1})
            ws.write(sr, 0, "TOTAL", bf)
            ws.write(sr, 2, f"{len(payments)} payments", bf)
            ws.write(sr, 5, sum(p.get("amount", 0) for p in payments), bm)

        ws.set_column(0, 0, 12)
        ws.set_column(1, 1, 12)
        ws.set_column(2, 2, 22)
        ws.set_column(3, 3, 22)
        ws.set_column(4, 5, 14)
        ws.set_column(6, 8, 14)
        ws.set_column(9, 9, 16)
        ws.set_column(10, 10, 10)
        ws.set_column(11, 11, 10)
        ws.set_column(12, 12, 25)
        ws.set_column(13, 13, 16)
        workbook.close()
        output.seek(0)

        filename = f"payment_history_{now.strftime('%Y%m%d')}.xlsx"
        await log_audit(auth["user"]["id"], auth["user"]["name"], "export", "payment_history",
                        details={"count": len(payments)}, ip=request.client.host if request else "")
        return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                 headers={"Content-Disposition": f"attachment; filename={filename}"})

    # ── Pending tab export ──
    query = {"is_deleted": False, "status": "payment_pending", "amount_remaining_to_customer": {"$gt": 0}}
    if date_from:
        query.setdefault("created_at", {})
        query["created_at"]["$gte"] = date_from
    if date_to:
        query.setdefault("created_at", {})
        query["created_at"]["$lte"] = date_to + "T23:59:59.999999"

    txns = await db.transactions.find(query, {"_id": 0}).sort("created_at", -1).to_list(10000)

    output = io.BytesIO()
    workbook = xlsxwriter.Workbook(output, {"in_memory": True})
    ws = workbook.add_worksheet("Pending Payouts")
    hdr = workbook.add_format({"bold": True, "bg_color": "#1e293b", "font_color": "#ffffff", "border": 1})
    money = workbook.add_format({"num_format": "#,##0.00", "border": 1})
    cell = workbook.add_format({"border": 1})

    headers = ["Date", "Txn ID", "Customer", "Card Details", "Gateway", "Server",
               "Swipe Amount", "To Pay Customer", "Paid", "Remaining", "Days Pending"]
    for c, h in enumerate(headers):
        ws.write(0, c, h, hdr)

    for r, t in enumerate(txns, 1):
        remaining = t.get("amount_remaining_to_customer", 0)
        paid = t.get("amount_paid_to_customer", 0)
        days = 0
        if t.get("created_at"):
            try:
                c_dt = datetime.fromisoformat(t["created_at"].replace("Z", "+00:00"))
                days = (now - c_dt).days
            except (ValueError, TypeError):
                pass
        ws.write(r, 0, t.get("created_at", "")[:10], cell)
        ws.write(r, 1, t.get("transaction_id", ""), cell)
        ws.write(r, 2, t.get("customer_name", ""), cell)
        ws.write(r, 3, t.get("card_details", ""), cell)
        ws.write(r, 4, t.get("swipe_gateway_name", ""), cell)
        ws.write(r, 5, t.get("swipe_server_name", ""), cell)
        ws.write(r, 6, t.get("swipe_amount", 0), money)
        ws.write(r, 7, t.get("amount_to_customer", 0), money)
        ws.write(r, 8, paid, money)
        ws.write(r, 9, remaining, money)
        ws.write(r, 10, days, cell)

    if txns:
        sr = len(txns) + 2
        bf = workbook.add_format({"bold": True, "border": 1})
        bm = workbook.add_format({"bold": True, "num_format": "#,##0.00", "border": 1})
        ws.write(sr, 0, "TOTAL", bf)
        ws.write(sr, 2, f"{len(txns)} payouts", bf)
        ws.write(sr, 6, sum(t.get("swipe_amount", 0) for t in txns), bm)
        ws.write(sr, 7, sum(t.get("amount_to_customer", 0) for t in txns), bm)
        ws.write(sr, 8, sum(t.get("amount_paid_to_customer", 0) for t in txns), bm)
        ws.write(sr, 9, sum(t.get("amount_remaining_to_customer", 0) for t in txns), bm)

    ws.set_column(0, 0, 12)
    ws.set_column(1, 1, 12)
    ws.set_column(2, 2, 22)
    ws.set_column(3, 3, 22)
    ws.set_column(4, 5, 16)
    ws.set_column(6, 9, 14)
    ws.set_column(10, 10, 10)
    workbook.close()
    output.seek(0)

    filename = f"pending_payouts_{now.strftime('%Y%m%d')}.xlsx"
    await log_audit(auth["user"]["id"], auth["user"]["name"], "export", "pending_payouts",
                    details={"count": len(txns)}, ip=request.client.host if request else "")
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})


@router.get("/payments")
async def get_customer_payments(
    transaction_id: Optional[str] = None,
    customer_id: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    auth: dict = Depends(auth_required)
):
    """Get customer payments history"""
    import re as re_module
    query = {"is_deleted": False}
    
    if transaction_id:
        query["transaction_id"] = transaction_id
    if customer_id:
        query["customer_id"] = customer_id
    # AUDIT-FIX-09: Add text search for payments
    if search:
        escaped = re_module.escape(search)
        search_conditions = [
            {"transaction_id_readable": {"$regex": escaped, "$options": "i"}},
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
    
    total = await db.payments.count_documents(query)
    skip = (page - 1) * limit
    
    payments = await db.payments.find(
        query, {"_id": 0}
    ).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    
    return {
        "data": serialize_docs(payments),
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "pages": (total + limit - 1) // limit
        }
    }


@router.post("/payments/record")
async def record_customer_payment(data: CustomerPaymentCreate, request: Request, auth: dict = Depends(auth_required)):
    """Record payment made to customer"""
    await check_permission(auth, "payments")
    
    transaction = await db.transactions.find_one({
        "id": data.transaction_id,
        "is_deleted": False
    }, {"_id": 0})
    
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    remaining = transaction.get("amount_remaining_to_customer", 0)
    if data.amount > remaining:
        raise HTTPException(status_code=400, detail=f"Amount exceeds remaining balance of ₹{remaining}")
    
    # Get wallet based on source type
    # payment_source_id is always the wallet ID
    wallet = await db.wallets.find_one({"id": data.payment_source_id, "is_deleted": False}, {"_id": 0})
    
    if not wallet:
        # Fallback: for gateway_wallet type, try looking up by gateway_id
        if data.payment_source_type == "gateway_wallet":
            wallet = await db.wallets.find_one({
                "wallet_type": "gateway",
                "gateway_id": data.payment_source_id,
                "is_deleted": False
            }, {"_id": 0})
    
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")
    
    # ARCH-01 FIX: Use atomic $inc for debit with balance check
    now_iso = datetime.now(timezone.utc).isoformat()
    
    updated_wallet = await db.wallets.find_one_and_update(
        {"id": wallet["id"], "balance": {"$gte": data.amount}},
        {
            "$inc": {"balance": -data.amount},
            "$set": {"updated_at": now_iso}
        },
        return_document=True,
        projection={"_id": 0}
    )
    
    if not updated_wallet:
        raise HTTPException(status_code=400, detail="Insufficient balance (concurrent update detected)")
    
    balance_after = updated_wallet.get("balance", 0)
    balance_before = balance_after + data.amount
    
    # Get next sequence number for ordering
    operation_id = await generate_operation_id(db)
    sequence_number = await get_next_operation_sequence(db, wallet["id"])
    
    wallet_op = WalletOperation(
        operation_id=operation_id,
        wallet_id=wallet["id"],
        wallet_name=wallet["name"],
        wallet_type=wallet["wallet_type"],
        operation_type="debit",
        amount=data.amount,
        balance_before=balance_before,
        balance_after=balance_after,
        payment_type=data.payment_method if wallet["wallet_type"] == "bank" else None,
        reference_id=data.transaction_id,
        reference_type="customer_payment",
        transaction_id=transaction.get("transaction_id", ""),
        customer_id=transaction.get("customer_readable_id", ""),
        notes=f"Payment to customer: {transaction.get('customer_name', '')}",
        created_by=auth["user"]["id"],
        created_by_name=auth["user"]["name"]
    )
    
    op_doc = wallet_op.model_dump()
    op_doc['created_at'] = now_iso
    op_doc['updated_at'] = now_iso
    op_doc['sequence_number'] = sequence_number  # Add sequence for ordering
    await db.wallet_operations.insert_one(op_doc)
    
    payment_record = {
        "id": str(uuid.uuid4()),
        "transaction_id": data.transaction_id,
        "transaction_id_readable": transaction.get("transaction_id", ""),
        "customer_id": transaction.get("customer_id"),
        "customer_readable_id": transaction.get("customer_readable_id", ""),
        "customer_name": transaction.get("customer_name"),
        "amount": data.amount,
        "payment_source_type": data.payment_source_type,
        "payment_source_id": data.payment_source_id,
        "wallet_id": wallet["id"],
        "wallet_name": wallet["name"],
        "wallet_type": wallet["wallet_type"],
        "payment_method": data.payment_method,
        "reference_number": data.reference_number,
        "notes": data.notes,
        "created_by": auth["user"]["id"],
        "created_by_name": auth["user"]["name"],
        "created_at": now_iso,
        "updated_at": now_iso,
        "is_deleted": False
    }
    
    await db.payments.insert_one(payment_record)
    
    # BUG-S3-11 FIX: add atomic $gte guard — prevents overpayment race condition where
    # two concurrent payments both pass the stale pre-check and both debit the wallet,
    # but the second transaction update silently over-decrements amount_remaining_to_customer
    updated_txn = await db.transactions.find_one_and_update(
        {"id": data.transaction_id, "amount_remaining_to_customer": {"$gte": data.amount}},
        {
            "$inc": {
                "amount_paid_to_customer": data.amount,
                "amount_remaining_to_customer": -data.amount
            },
            "$push": {
                "customer_payments": {
                    "id": payment_record["id"],
                    "amount": data.amount,
                    "wallet_name": wallet["name"],
                    "wallet_type": wallet["wallet_type"],
                    "payment_method": data.payment_method,
                    "paid_at": now_iso,
                    "paid_by": auth["user"]["name"]
                }
            },
            "$set": {"updated_at": now_iso}
        },
        return_document=True,
        projection={"_id": 0}
    )
    if not updated_txn:
        # Concurrent update won the race — roll back wallet debit, op, and payment record
        await db.wallets.update_one(
            {"id": wallet["id"]},
            {"$inc": {"balance": data.amount}, "$set": {"updated_at": now_iso}}
        )
        await db.wallet_operations.delete_one({"id": wallet_op.id})
        await db.payments.delete_one({"id": payment_record["id"]})
        raise HTTPException(
            status_code=400,
            detail="Payment rejected: amount exceeds remaining balance or concurrent update detected. Please refresh and retry."
        )
    new_remaining = max(0, updated_txn.get("amount_remaining_to_customer", 0))
    new_status = "completed" if new_remaining <= 0 else "payment_pending"
    if new_remaining <= 0:
        ato = updated_txn.get("amount_to_customer", 0) or 0
        payment_status = "not_applicable" if ato == 0 else "paid"
    else:
        payment_status = "partial"
    await db.transactions.update_one(
        {"id": data.transaction_id},
        {"$set": {"status": new_status, "amount_remaining_to_customer": new_remaining,
                  "customer_payment_status": payment_status}}
    )
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "create", "payments", payment_record["id"], {
        "transaction": transaction.get("transaction_id", ""),
        "customer": transaction.get("customer_name", ""),
        "amount": data.amount,
        "wallet": wallet["name"]
    }, ip=request.client.host if request.client else "")
    
    return serialize_doc(payment_record)
@router.post("/payments/bulk")
async def bulk_pay_customer(data: BulkPaymentCreate, request: Request, auth: dict = Depends(auth_required)):
    """
    Make bulk payment to customer for multiple transactions at once.
    
    Allocation methods:
    - fifo: Pay oldest transactions first
    - proportional: Split proportionally by remaining amount
    - manual: Use manual_allocations dict to specify per-transaction amounts
    """
    await check_permission(auth, "payments")
    
    # Validate customer exists
    customer = await db.customers.find_one({"id": data.customer_id, "is_deleted": False}, {"_id": 0})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    
    # Get all specified transactions
    transactions = await db.transactions.find({
        "id": {"$in": data.transaction_ids},
        "customer_id": data.customer_id,
        "is_deleted": False
    }, {"_id": 0}).to_list(100)
    
    if len(transactions) != len(data.transaction_ids):
        found_ids = {t["id"] for t in transactions}
        missing = set(data.transaction_ids) - found_ids
        raise HTTPException(status_code=404, detail=f"Transactions not found: {missing}")
    
    # Calculate remaining amounts and validate
    tx_remaining = {}
    for tx in transactions:
        remaining = tx.get("amount_remaining_to_customer", tx.get("pay_to_customer", 0))
        if remaining <= 0:
            raise HTTPException(status_code=400, detail=f"Transaction {tx.get('transaction_id', tx['id'])} has no remaining amount")
        tx_remaining[tx["id"]] = {"remaining": remaining, "tx": tx}
    
    total_remaining = sum(v["remaining"] for v in tx_remaining.values())
    
    if data.total_amount > total_remaining:
        raise HTTPException(status_code=400, detail=f"Amount ₹{data.total_amount} exceeds total remaining ₹{total_remaining}")
    
    # Validate wallet
    wallet = await db.wallets.find_one({"id": data.payment_source_id, "is_deleted": False}, {"_id": 0})
    if not wallet:
        raise HTTPException(status_code=404, detail="Payment source wallet not found")
    
    # BUG-S3-17 FIX: removed stale balance pre-check here — the atomic $gte guard
    # in the find_one_and_update below is the real guard against overdraft
    
    # Calculate allocations based on method
    allocations: Dict[str, float] = {}
    
    if data.allocation_method == "manual":
        if not data.manual_allocations:
            raise HTTPException(status_code=400, detail="manual_allocations required for manual method")
        
        # Validate manual allocations
        for tx_id, amount in data.manual_allocations.items():
            if tx_id not in tx_remaining:
                raise HTTPException(status_code=400, detail=f"Transaction {tx_id} not in selected transactions")
            if amount > tx_remaining[tx_id]["remaining"]:
                raise HTTPException(status_code=400, detail=f"Amount for {tx_id} exceeds remaining")
            if amount > 0:
                allocations[tx_id] = amount
        
        if abs(sum(allocations.values()) - data.total_amount) > 0.01:
            raise HTTPException(status_code=400, detail="Manual allocations must sum to total_amount")
    
    elif data.allocation_method == "fifo":
        # Sort by created_at (oldest first)
        sorted_txs = sorted(transactions, key=lambda x: x.get("created_at", ""))
        remaining_to_allocate = data.total_amount
        
        for tx in sorted_txs:
            if remaining_to_allocate <= 0:
                break
            tx_max = tx_remaining[tx["id"]]["remaining"]
            allocation = min(remaining_to_allocate, tx_max)
            if allocation > 0:
                allocations[tx["id"]] = allocation
                remaining_to_allocate -= allocation
    
    elif data.allocation_method == "proportional":
        # Split proportionally by remaining amount
        for tx_id, info in tx_remaining.items():
            proportion = info["remaining"] / total_remaining
            allocation = round(data.total_amount * proportion, 2)
            if allocation > 0:
                allocations[tx_id] = min(allocation, info["remaining"])
        
        # Adjust for rounding errors — re-clamp to remaining cap after correction
        diff = data.total_amount - sum(allocations.values())
        if abs(diff) > 0.01 and allocations:
            first_key = list(allocations.keys())[0]
            allocations[first_key] = min(allocations[first_key] + diff, tx_remaining[first_key]["remaining"])
    
    else:
        raise HTTPException(status_code=400, detail=f"Invalid allocation_method: {data.allocation_method}")
    
    # Execute the bulk payment
    bulk_payment_id = str(uuid.uuid4())
    payment_records = []
    now = datetime.now(timezone.utc).isoformat()

    # Debit wallet atomically with balance guard (prevents race-condition overdraft)
    updated_wallet = await db.wallets.find_one_and_update(
        {"id": data.payment_source_id, "balance": {"$gte": data.total_amount}},
        {
            "$inc": {"balance": -data.total_amount},
            "$set": {"updated_at": now}
        },
        return_document=True,
        projection={"_id": 0}
    )

    if not updated_wallet:
        raise HTTPException(status_code=400, detail="Insufficient balance. The wallet may have been updated by another operation. Please refresh and try again.")

    balance_after = updated_wallet.get("balance", 0)
    balance_before = balance_after + data.total_amount
    
    # Create single wallet operation for the bulk payment
    operation_id = await generate_operation_id(db)
    sequence_number = await get_next_operation_sequence(db, data.payment_source_id)
    
    wallet_op = WalletOperation(
        operation_id=operation_id,
        wallet_id=data.payment_source_id,
        wallet_name=wallet["name"],
        wallet_type=wallet["wallet_type"],
        operation_type="debit",
        amount=data.total_amount,
        balance_before=balance_before,
        balance_after=balance_after,
        payment_type=data.payment_method if wallet["wallet_type"] == "bank" else None,
        reference_id=bulk_payment_id,
        reference_type="bulk_customer_payment",
        notes=f"Bulk payment to {customer['name']} for {len(allocations)} transactions",
        created_by=auth["user"]["id"],
        created_by_name=auth["user"]["name"],
    )
    
    op_doc = wallet_op.model_dump()
    op_doc['created_at'] = op_doc['created_at'].isoformat()
    op_doc['updated_at'] = op_doc['updated_at'].isoformat()
    op_doc['sequence_number'] = sequence_number
    await db.wallet_operations.insert_one(op_doc)
    
    # Create individual payment records and update transactions
    # ISSUE-02 FIX: Wrap in try-except; compensate by reversing wallet debit on failure
    created_payment_ids = []
    updated_txn_states = []  # BUG-05 FIX: track for amount_remaining_to_customer restoration
    try:
        for tx_id, amount in allocations.items():
            tx = tx_remaining[tx_id]["tx"]
            
            payment_id = str(uuid.uuid4())
            payment_record = {
                "id": payment_id,
                "bulk_payment_id": bulk_payment_id,  # Link to bulk operation
                "transaction_id": tx_id,
                "transaction_id_readable": tx.get("transaction_id", ""),
                "customer_id": data.customer_id,
                "customer_name": customer["name"],
                "amount": amount,
                "payment_source_type": data.payment_source_type,
                "payment_source_id": data.payment_source_id,
                "payment_source_name": wallet["name"],
                "wallet_id": wallet["id"],
                "wallet_name": wallet["name"],
                "payment_method": data.payment_method,
                "reference_number": data.reference_number,
                "notes": data.notes,
                "paid_by": auth["user"]["id"],
                "paid_by_name": auth["user"]["name"],
                "paid_at": now,
                "created_at": now,
                "updated_at": now,
                "is_deleted": False
            }
            
            await db.payments.insert_one(payment_record)
            created_payment_ids.append(payment_id)
            payment_records.append(payment_record)
            
            # BUG-S3-12 FIX: add atomic $gte guard — prevents overpayment if two concurrent
            # bulk payments race and both include the same transaction
            updated_txn = await db.transactions.find_one_and_update(
                {"id": tx_id, "amount_remaining_to_customer": {"$gte": amount}},
                {
                    "$inc": {
                        "amount_paid_to_customer": amount,
                        "amount_remaining_to_customer": -amount
                    },
                    "$push": {"customer_payments": {
                        "id": payment_id,
                        "amount": amount,
                        "wallet_name": wallet["name"],
                        "wallet_type": wallet["wallet_type"],
                        "payment_method": data.payment_method,
                        "paid_at": now,
                        "paid_by": auth["user"]["name"]
                    }},
                    "$set": {"updated_at": now}
                },
                return_document=True,
                projection={"_id": 0}
            )
            if not updated_txn:
                raise Exception(f"Transaction {tx_id}: concurrent update detected or amount {amount} exceeds remaining balance")
            new_remaining = max(0, updated_txn.get("amount_remaining_to_customer", 0))
            new_txn_status = "completed" if new_remaining <= 0 else "payment_pending"
            if new_remaining <= 0:
                ato = updated_txn.get("amount_to_customer", 0) or 0
                bulk_payment_status = "not_applicable" if ato == 0 else "paid"
            else:
                bulk_payment_status = "partial"
            await db.transactions.update_one(
                {"id": tx_id},
                {"$set": {"status": new_txn_status, "amount_remaining_to_customer": new_remaining,
                          "customer_payment_status": bulk_payment_status}}
            )
            # Track amount for $inc-based rollback (no longer storing stale old values)
            updated_txn_states.append({
                "id": tx_id,
                "amount": amount,
                "payment_id": payment_id
            })
    except Exception as e:
        # COMPENSATION: Reverse wallet debit and delete any created payment records
        logger.error(f"Bulk payment loop failed: {e}. Rolling back wallet debit and {len(created_payment_ids)} payment records.")
        
        async def rollback_step(fn, step_name):
            for attempt in range(3):
                try:
                    await fn()
                    return
                except Exception as rb_err:
                    if attempt == 2:
                        logger.error(f"Bulk pay rollback FAILED after 3 retries ({step_name}): {rb_err}")
                        try:
                            await db.operation_failures.insert_one({
                                "operation_type": "bulk_pay_rollback", "failed_step": step_name,
                                "error": str(rb_err), "created_at": datetime.now(timezone.utc).isoformat(),
                            })
                        except Exception:
                            pass
        
        if created_payment_ids:
            await rollback_step(lambda: db.payments.delete_many({"id": {"$in": created_payment_ids}}), "delete_payments")
        await rollback_step(lambda: db.wallet_operations.delete_one({"operation_id": operation_id}), "delete_wallet_op")
        await rollback_step(lambda: db.wallets.update_one(
            {"id": data.payment_source_id},
            {"$inc": {"balance": data.total_amount}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
        ), "restore_wallet")
        
        for txn_state in updated_txn_states:
            async def revert_txn(ts=txn_state):
                reverted = await db.transactions.find_one_and_update(
                    {"id": ts["id"]},
                    {
                        "$inc": {
                            "amount_paid_to_customer": -ts["amount"],
                            "amount_remaining_to_customer": ts["amount"]
                        },
                        "$pull": {"customer_payments": {"id": ts["payment_id"]}},
                        "$set": {"updated_at": now}
                    },
                    return_document=True,
                    projection={"_id": 0}
                )
                if reverted:
                    rev_remaining = max(0, reverted.get("amount_remaining_to_customer", 0))
                    rev_status = "completed" if rev_remaining <= 0 else "payment_pending"
                    await db.transactions.update_one(
                        {"id": ts["id"]},
                        {"$set": {"status": rev_status, "amount_remaining_to_customer": rev_remaining}}
                    )
            await rollback_step(revert_txn, f"revert_txn_{txn_state['id'][:8]}")
        
        raise HTTPException(status_code=500, detail=f"Bulk payment failed and was rolled back: {str(e)}")
    
    # Log audit
    await log_audit(auth["user"]["id"], auth["user"]["name"], "bulk_payment", "payments", bulk_payment_id, {
        "customer": customer["name"],
        "total_amount": data.total_amount,
        "transactions_count": len(allocations),
        "allocation_method": data.allocation_method,
        "wallet": wallet["name"]
    }, ip=request.client.host if request.client else "")
    
    return {
        "bulk_payment_id": bulk_payment_id,
        "customer_id": data.customer_id,
        "customer_name": customer["name"],
        "total_amount": data.total_amount,
        "transactions_paid": len(allocations),
        "allocations": allocations,
        "allocation_method": data.allocation_method,
        "wallet_balance_after": balance_after,
        "payment_records": [serialize_doc(p) for p in payment_records]
    }


# ============== PAYMENT VOID ==============

class VoidPaymentRequest(BaseModel):
    reason: str = Field(..., min_length=5, max_length=500)


@router.post("/payments/{payment_id}/void")
async def void_payment(
    payment_id: str,
    data: VoidPaymentRequest,
    request: Request,
    auth: dict = Depends(auth_required)
):
    """
    BUG-08 FIX: Void / cancel a payment made to a customer.

    - Credits the wallet back (reverses the debit)
    - Restores amount_remaining_to_customer on the linked transaction
    - Reverts transaction status to payment_pending if it was completed
    - Soft-deletes the payment record with full audit trail
    """
    await check_permission(auth, "payments")
    reason = data.reason

    payment = await db.payments.find_one({"id": payment_id, "is_deleted": False}, {"_id": 0})
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    if payment.get("voided"):
        raise HTTPException(status_code=400, detail="Payment is already voided")

    transaction = await db.transactions.find_one(
        {"id": payment.get("transaction_id"), "is_deleted": False},
        {"_id": 0}
    )
    if not transaction:
        raise HTTPException(status_code=404, detail="Associated transaction not found")

    # P2-8 FIX: Prevent voiding payment on a reversed transaction
    if transaction.get("status") == "reversed":
        raise HTTPException(status_code=400, detail="Cannot void payment on a reversed transaction")

    # Support both single-payment (wallet_id) and bulk-payment (payment_source_id) records
    wallet_id = payment.get("wallet_id") or payment.get("payment_source_id")
    if not wallet_id:
        raise HTTPException(status_code=400, detail="Cannot void: payment record has no wallet reference")

    wallet = await db.wallets.find_one({"id": wallet_id, "is_deleted": False}, {"_id": 0})
    if not wallet:
        raise HTTPException(status_code=404, detail="Payment source wallet not found")

    now_iso = datetime.now(timezone.utc).isoformat()
    amount = payment.get("amount", 0)

    # Credit wallet back (reverse the debit) — atomic $inc
    updated_wallet = await db.wallets.find_one_and_update(
        {"id": wallet["id"]},
        {
            "$inc": {"balance": amount},
            "$set": {"updated_at": now_iso}
        },
        return_document=True,
        projection={"_id": 0}
    )
    if not updated_wallet:
        raise HTTPException(status_code=500, detail="Failed to reverse wallet debit")

    balance_after = updated_wallet.get("balance", 0)
    balance_before = balance_after - amount

    # Create wallet operation record for the reversal
    operation_id = await generate_operation_id(db)
    sequence_number = await get_next_operation_sequence(db, wallet["id"])

    wallet_op = WalletOperation(
        operation_id=operation_id,
        wallet_id=wallet["id"],
        wallet_name=wallet["name"],
        wallet_type=wallet["wallet_type"],
        operation_type="credit",
        amount=amount,
        balance_before=balance_before,
        balance_after=balance_after,
        reference_id=payment_id,
        reference_type="payment_void",
        transaction_id=transaction.get("transaction_id", ""),
        customer_id=transaction.get("customer_readable_id", ""),
        notes=f"Payment voided: {reason}",
        created_by=auth["user"]["id"],
        created_by_name=auth["user"]["name"]
    )
    op_doc = wallet_op.model_dump()
    op_doc["created_at"] = now_iso
    op_doc["updated_at"] = now_iso
    op_doc["sequence_number"] = sequence_number
    await db.wallet_operations.insert_one(op_doc)

    # BUG-2 FIX: Use $inc atomically to prevent race condition when restoring transaction amounts
    # (old $set computed values from stale read — concurrent payment between read and write would be lost)
    updated_txn = await db.transactions.find_one_and_update(
        {"id": payment["transaction_id"]},
        {
            "$inc": {
                "amount_paid_to_customer": -amount,
                "amount_remaining_to_customer": amount
            },
            # BUG-3 FIX: remove the voided payment entry from the embedded array
            "$pull": {"customer_payments": {"id": payment_id}},
            "$set": {"updated_at": now_iso}
        },
        return_document=True,
        projection={"_id": 0}
    )
    new_paid = max(0, updated_txn.get("amount_paid_to_customer", 0))
    new_remaining = max(0, updated_txn.get("amount_remaining_to_customer", 0))
    new_status = "completed" if new_remaining <= 0 else "payment_pending"
    # Recalculate customer_payment_status after void
    if new_remaining <= 0:
        ato = updated_txn.get("amount_to_customer", 0) or 0
        new_cps = "not_applicable" if ato == 0 else "paid"
    elif new_paid > 0:
        new_cps = "partial"
    else:
        new_cps = "pending"
    await db.transactions.update_one(
        {"id": payment["transaction_id"]},
        {"$set": {
            "status": new_status,
            "amount_paid_to_customer": new_paid,
            "amount_remaining_to_customer": new_remaining,
            "customer_payment_status": new_cps
        }}
    )

    # Soft-delete / void the payment record
    await db.payments.update_one(
        {"id": payment_id},
        {"$set": {
            "is_deleted": True,
            "voided": True,
            "void_reason": reason,
            "voided_at": now_iso,
            "voided_by": auth["user"]["id"],
            "voided_by_name": auth["user"]["name"],
            "updated_at": now_iso
        }}
    )

    await log_audit(auth["user"]["id"], auth["user"]["name"], "void", "payments", payment_id, {
        "amount": amount,
        "transaction": transaction.get("transaction_id", ""),
        "customer": transaction.get("customer_name", ""),
        "reason": reason,
        "wallet": wallet["name"]
    }, ip=request.client.host if request.client else "")

    return {
        "message": "Payment voided successfully",
        "payment_id": payment_id,
        "amount_reversed": amount,
        "wallet_balance_after": balance_after,
        "transaction_id": transaction.get("transaction_id", ""),
        "new_transaction_status": new_status
    }
