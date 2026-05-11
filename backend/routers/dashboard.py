"""
Dashboard Router - Dashboard statistics, analytics, and exports
"""
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from datetime import datetime, timezone, timedelta
from typing import Optional
import io
import logging

from core.database import db
from core.dependencies import auth_required, log_audit, check_permission
from utils import serialize_docs, get_ist_day_start_utc, validate_date_param

router = APIRouter(tags=["Dashboard"])
logger = logging.getLogger(__name__)

# ISSUE-03 FIX: Prevent OOM on large exports by capping rows
MAX_EXPORT_ROWS = 100_000


def _build_xlsx(sheet_name: str, columns: list, docs: list, col_widths: list = None) -> io.BytesIO:
    """Generic XLSX builder. Eliminates boilerplate across all export endpoints.

    Args:
        sheet_name: Worksheet tab name.
        columns: List of dicts: {"header": str, "key": str|callable, "fmt": "text"|"money"|"pct"}.
        docs: List of dicts (MongoDB docs or pre-processed rows).
        col_widths: Optional list of (start_col, end_col, width) tuples.
    Returns:
        BytesIO positioned at 0, ready for StreamingResponse.
    """
    import xlsxwriter
    output = io.BytesIO()
    workbook = xlsxwriter.Workbook(output)
    worksheet = workbook.add_worksheet(sheet_name)
    fmts = {
        "header": workbook.add_format({"bold": True, "bg_color": "#1e293b", "font_color": "white", "border": 1}),
        "text": workbook.add_format({"border": 1}),
        "money": workbook.add_format({"num_format": "₹#,##0.00", "border": 1}),
        "pct": workbook.add_format({"num_format": "0.00%", "border": 1}),
    }
    for ci, col in enumerate(columns):
        worksheet.write(0, ci, col["header"], fmts["header"])
    for ri, doc in enumerate(docs, 1):
        for ci, col in enumerate(columns):
            key = col["key"]
            val = key(doc) if callable(key) else doc.get(key, "")
            worksheet.write(ri, ci, val, fmts.get(col.get("fmt", "text"), fmts["text"]))
    if col_widths:
        for s, e, w in col_widths:
            worksheet.set_column(s, e, w)
    try:
        workbook.close()
    finally:
        output.seek(0)
    return output


@router.get("/dashboard")
async def get_dashboard(auth: dict = Depends(auth_required)):
    """Get dashboard statistics"""
    await check_permission(auth, "dashboard")
    # BUG-07 FIX: use UTC start of IST day so midnight–05:30 IST transactions are captured
    today = get_ist_day_start_utc()
    
    # Use aggregation to avoid truncation — no limit, single DB round-trip
    today_agg = await db.transactions.aggregate([
        {"$match": {"is_deleted": False, "status": {"$ne": "reversed"}, "created_at": {"$gte": today}}},
        {"$group": {
            "_id": None,
            "count": {"$sum": 1},
            "volume": {"$sum": {"$max": ["$swipe_amount", "$total_swiped"]}},
            "commission": {"$sum": "$commission_amount"},
            "pg_charges": {"$sum": "$gateway_charge_amount"}
        }}
    ]).to_list(1)
    today_stats = today_agg[0] if today_agg else {"count": 0, "volume": 0, "commission": 0, "pg_charges": 0}
    today_count = today_stats["count"]
    today_volume = today_stats["volume"]
    today_profit = today_stats["commission"]

    # FIX-3: Subtract today's charge write-offs from profit (unrealized commission + unrecovered PG)
    writeoff_today_agg = await db.expenses.aggregate([
        {"$match": {"expense_type_name": "Charge Write-Off", "is_deleted": {"$ne": True}, "created_at": {"$gte": today}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]).to_list(1)
    writeoff_today = writeoff_today_agg[0]["total"] if writeoff_today_agg else 0
    today_profit = today_profit - writeoff_today

    # Pending outflow — all types, no type_01 restriction (BUG-1 FIX: Type 02 payment_pending was excluded)
    pending_agg = await db.transactions.aggregate([
        {"$match": {"is_deleted": False, "amount_remaining_to_customer": {"$gt": 0}, "status": {"$nin": ["reversed", "cancelled"]}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount_remaining_to_customer"}}}
    ]).to_list(1)
    total_pending = pending_agg[0]["total"] if pending_agg else 0

    # Pending inflow — GAP-2 FIX: also exclude "overpaid" (negative remaining corrupts total)
    inflow_agg = await db.collections.aggregate([
        {"$match": {"status": {"$nin": ["settled", "cancelled", "overpaid"]}, "is_deleted": False}},
        {"$group": {"_id": None, "total": {"$sum": {"$subtract": ["$amount", {"$ifNull": ["$settled_amount", 0]}]}}}}
    ]).to_list(1)
    total_receivable = inflow_agg[0]["total"] if inflow_agg else 0
    
    # Total wallet balance (all wallets)
    # Optimized: Only fetch balance
    all_wallets = await db.wallets.find({"is_deleted": False}, {"_id": 0, "balance": 1}).to_list(100)
    total_wallet_balance = sum(w.get("balance", 0) for w in all_wallets)
    
    # Optimized: Only fetch required gateway fields
    gateways = await db.gateways.find({"is_deleted": False}, {"_id": 0, "id": 1, "name": 1, "is_active": 1}).to_list(100)
    gateway_wallets = await db.wallets.find({"wallet_type": "gateway", "is_deleted": False}, {"_id": 0, "gateway_id": 1, "balance": 1}).to_list(100)
    wallet_balance_map = {w.get("gateway_id"): w.get("balance", 0) for w in gateway_wallets}
    
    gateway_balances = [{
        "id": g["id"],
        "name": g["name"],
        "balance": wallet_balance_map.get(g["id"], 0),
        "is_active": g.get("is_active", True)
    } for g in gateways]
    
    # BUG-S3-06 FIX: exclude reversed transactions from recent activity
    recent = await db.transactions.find({"is_deleted": False, "status": {"$ne": "reversed"}}, {"_id": 0}).sort("created_at", -1).limit(10).to_list(10)
    
    return {
        "today_transactions": today_count,
        "today_volume": today_volume,
        "today_profit": today_profit,
        "total_pending": total_pending,
        "total_receivable": total_receivable,
        "total_wallet_balance": total_wallet_balance,
        "gateway_balances": gateway_balances,
        "recent_transactions": serialize_docs(recent)
    }


@router.get("/dashboard/daily-profit")
async def get_daily_profit_summary(auth: dict = Depends(auth_required)):
    """Get detailed daily profit summary"""
    await check_permission(auth, "dashboard")
    # BUG-07 FIX: use UTC start of IST day
    today = get_ist_day_start_utc()
    base_match = {"is_deleted": False, "status": {"$ne": "reversed"}, "created_at": {"$gte": today}}

    # Aggregate by transaction type — no memory limit
    type_agg = await db.transactions.aggregate([
        {"$match": base_match},
        {"$group": {
            "_id": "$transaction_type",
            "count": {"$sum": 1},
            "volume": {"$sum": {"$max": ["$swipe_amount", "$total_swiped"]}},
            "commission": {"$sum": "$commission_amount"},
            "pg_charges": {"$sum": "$gateway_charge_amount"}
        }}
    ]).to_list(10)

    totals = {"count": 0, "volume": 0, "commission": 0, "pg_charges": 0}
    by_type = {}
    for row in type_agg:
        t = row["_id"] or "type_01"
        by_type[t] = row
        for k in ("count", "volume", "commission", "pg_charges"):
            totals[k] += row[k]

    t01 = by_type.get("type_01", {"count": 0, "volume": 0, "commission": 0, "pg_charges": 0})
    t02 = by_type.get("type_02", {"count": 0, "volume": 0, "commission": 0, "pg_charges": 0})

    # Gateway breakdown aggregation
    gw_agg = await db.transactions.aggregate([
        {"$match": base_match},
        {"$group": {
            "_id": {"$ifNull": [{"$ifNull": ["$swipe_gateway_name", "$gateway_name"]}, "Unknown"]},
            "count": {"$sum": 1},
            "volume": {"$sum": {"$max": ["$swipe_amount", "$total_swiped"]}},
            "commission": {"$sum": "$commission_amount"},
            "pg_charges": {"$sum": "$gateway_charge_amount"}
        }},
        {"$sort": {"volume": -1}}
    ]).to_list(100)

    # Payments paid out today
    pay_agg = await db.payments.aggregate([
        {"$match": {"is_deleted": False, "created_at": {"$gte": today}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]).to_list(1)
    total_paid_out = pay_agg[0]["total"] if pay_agg else 0

    # Collections received today — GAP-1 FIX: use all valid collection reference types
    col_agg = await db.wallet_operations.aggregate([
        {"$match": {
            "is_deleted": False,
            "created_at": {"$gte": today},
            "reference_type": {"$in": [
                "collection_card_swipe", "collection_cash", "collection_bank_transfer",
                "pending_payment_settlement", "bulk_collection",
                "bulk_unified_collection_card_swipe", "bulk_unified_collection_cash",
                "bulk_unified_collection_bank_transfer"
            ]},
            "operation_type": "credit"
        }},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]).to_list(1)
    total_collected = col_agg[0]["total"] if col_agg else 0

    net_profit = totals["commission"]

    # FIX-3: Subtract today's charge write-offs from net profit
    wo_daily_agg = await db.expenses.aggregate([
        {"$match": {"expense_type_name": "Charge Write-Off", "is_deleted": {"$ne": True}, "created_at": {"$gte": today}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]).to_list(1)
    daily_writeoff = wo_daily_agg[0]["total"] if wo_daily_agg else 0
    net_profit = net_profit - daily_writeoff

    return {
        "date": today,
        "summary": {
            "total_transactions": totals["count"],
            "total_volume": totals["volume"],
            "total_commission_earned": totals["commission"],
            "total_pg_charges": totals["pg_charges"],
            "total_writeoffs": daily_writeoff,
            "net_profit": net_profit,
            "total_paid_to_customers": total_paid_out,
            "total_collected": total_collected
        },
        "by_transaction_type": {
            "type_01": {
                "name": "Direct Swipe",
                "count": t01["count"],
                "volume": t01["volume"],
                "commission": t01["commission"],
                "pg_charges": t01["pg_charges"],
                "net": t01["commission"]
            },
            "type_02": {
                "name": "Pay to Card + Swipe",
                "count": t02["count"],
                "volume": t02["volume"],
                "commission": t02["commission"],
                "pg_charges": t02["pg_charges"],
                "net": t02["commission"]
            }
        },
        "by_gateway": [
            {"gateway": r["_id"], "count": r["count"], "volume": r["volume"],
             "commission": r["commission"], "pg_charges": r["pg_charges"],
             "net": r["commission"]}
            for r in gw_agg
        ]
    }


@router.get("/dashboard/commission-stats")
async def get_commission_stats(auth: dict = Depends(auth_required)):
    """Commission Tracker: Earned, Collected, Outstanding, Written Off"""
    await check_permission(auth, "dashboard")

    # 1. Commission Earned = sum of commission_amount across ALL settlements on ALL non-deleted collections
    earned_pipeline = [
        {"$match": {"is_deleted": {"$ne": True}}},
        {"$unwind": "$settlements"},
        {"$match": {"settlements.voided": {"$ne": True}}},
        {"$group": {
            "_id": None,
            "total": {"$sum": "$settlements.commission_amount"},
            "count": {"$sum": 1},
        }}
    ]
    earned_agg = await db.collections.aggregate(earned_pipeline).to_list(1)
    commission_earned = earned_agg[0]["total"] if earned_agg else 0
    settlement_count = earned_agg[0]["count"] if earned_agg else 0

    # 2. Commission Collected via Include Charges = sum of commission_amount on settlements where include_charges=true
    include_charges_pipeline = [
        {"$match": {"is_deleted": {"$ne": True}}},
        {"$unwind": "$settlements"},
        {"$match": {"settlements.include_charges": True, "settlements.voided": {"$ne": True}}},
        {"$group": {"_id": None, "total": {"$sum": "$settlements.commission_amount"}}}
    ]
    ic_agg = await db.collections.aggregate(include_charges_pipeline).to_list(1)
    collected_via_include = ic_agg[0]["total"] if ic_agg else 0

    # 3. Commission Collected via service_charge settlements
    # FIX-2: Use commission proportion from charge_breakdown instead of full settled_amount
    # (settled_amount includes PG recovery which is cost recovery, not commission income)
    sc_settled_pipeline = [
        {"$match": {"source": "service_charge", "status": {"$in": ["settled", "partial", "overpaid"]}, "is_deleted": {"$ne": True}}},
        {"$addFields": {
            "commission_portion": {
                "$cond": [
                    {"$and": [{"$gt": ["$amount", 0]}, {"$gt": [{"$ifNull": ["$charge_breakdown.commission", 0]}, 0]}]},
                    {"$multiply": [
                        "$settled_amount",
                        {"$divide": [{"$ifNull": ["$charge_breakdown.commission", "$amount"]}, "$amount"]}
                    ]},
                    "$settled_amount"
                ]
            }
        }},
        {"$group": {"_id": None, "total": {"$sum": "$commission_portion"}}}
    ]
    sc_settled_agg = await db.collections.aggregate(sc_settled_pipeline).to_list(1)
    collected_via_sc = sc_settled_agg[0]["total"] if sc_settled_agg else 0

    # 4. Commission Outstanding = commission proportion of (amount - settled_amount) on pending/partial service_charge
    # FIX-2: Only count the commission portion, not PG recovery
    sc_outstanding_pipeline = [
        {"$match": {"source": "service_charge", "status": {"$in": ["pending", "partial"]}, "is_deleted": {"$ne": True}}},
        {"$addFields": {
            "remaining": {"$subtract": ["$amount", "$settled_amount"]},
            "comm_ratio": {
                "$cond": [
                    {"$and": [{"$gt": ["$amount", 0]}, {"$gt": [{"$ifNull": ["$charge_breakdown.commission", 0]}, 0]}]},
                    {"$divide": [{"$ifNull": ["$charge_breakdown.commission", "$amount"]}, "$amount"]},
                    1
                ]
            }
        }},
        {"$group": {
            "_id": None,
            "total": {"$sum": {"$multiply": ["$remaining", "$comm_ratio"]}},
            "count": {"$sum": 1},
        }}
    ]
    sc_outstanding_agg = await db.collections.aggregate(sc_outstanding_pipeline).to_list(1)
    outstanding_amount = sc_outstanding_agg[0]["total"] if sc_outstanding_agg else 0
    outstanding_count = sc_outstanding_agg[0]["count"] if sc_outstanding_agg else 0

    # 5. Commission Written Off = sum of amount on Charge Write-Off expenses
    writeoff_pipeline = [
        {"$match": {"expense_type_name": "Charge Write-Off", "is_deleted": {"$ne": True}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}, "count": {"$sum": 1}}}
    ]
    writeoff_agg = await db.expenses.aggregate(writeoff_pipeline).to_list(1)
    written_off = writeoff_agg[0]["total"] if writeoff_agg else 0
    writeoff_count = writeoff_agg[0]["count"] if writeoff_agg else 0

    # 6. Type 01 commission (immediate — retained in gateway wallet, not tracked via service_charge)
    type01_pipeline = [
        {"$match": {"transaction_type": "type_01", "is_deleted": False, "status": {"$ne": "reversed"}}},
        {"$group": {"_id": None, "total": {"$sum": "$commission_amount"}, "count": {"$sum": 1}}}
    ]
    type01_agg = await db.transactions.aggregate(type01_pipeline).to_list(1)
    type01_commission = type01_agg[0]["total"] if type01_agg else 0
    type01_count = type01_agg[0]["count"] if type01_agg else 0

    total_collected = round(collected_via_include + collected_via_sc + type01_commission, 2)

    return {
        "commission_earned": round(commission_earned + type01_commission, 2),
        "commission_earned_type01": round(type01_commission, 2),
        "commission_earned_type02": round(commission_earned, 2),
        "type01_transaction_count": type01_count,
        "commission_collected": total_collected,
        "commission_collected_via_include_charges": round(collected_via_include, 2),
        "commission_collected_via_service_charge": round(collected_via_sc, 2),
        "commission_outstanding": round(outstanding_amount, 2),
        "commission_outstanding_count": outstanding_count,
        "commission_written_off": round(written_off, 2),
        "commission_writeoff_count": writeoff_count,
        "total_settlements": settlement_count,
    }


@router.get("/dashboard/health-score")
async def get_health_score(auth: dict = Depends(auth_required)):
    """Calculate Financial Health Score (0-100) from 5 business metrics"""
    await check_permission(auth, "dashboard")
    now = datetime.now(timezone.utc)
    
    # 1. DATA CONSISTENCY (20 pts) — from reconciliation checks
    wallets = await db.wallets.find({"is_deleted": False}, {"_id": 0, "id": 1, "balance": 1}).to_list(200)
    negative_count = sum(1 for w in wallets if w.get("balance", 0) < 0)
    total_wallets = max(len(wallets), 1)
    consistency_ratio = max(0, 1 - (negative_count / total_wallets))
    consistency_score = round(consistency_ratio * 20, 1)
    
    # 2. COLLECTION EFFICIENCY (20 pts) — % settled vs total due
    coll_pipeline = [
        {"$match": {"is_deleted": False}},
        {"$group": {"_id": None, "total_due": {"$sum": "$amount"}, "total_settled": {"$sum": "$settled_amount"}}}
    ]
    coll_result = await db.collections.aggregate(coll_pipeline).to_list(1)
    total_due = coll_result[0]["total_due"] if coll_result else 0
    total_settled = coll_result[0]["total_settled"] if coll_result else 0
    collection_pct = (total_settled / total_due) if total_due > 0 else 0.0
    collection_score = round(min(collection_pct, 1.0) * 20, 1)
    
    # 3. OVERDUE RATIO (20 pts) — fewer overdue payouts = higher score
    seven_days_ago = (now - timedelta(days=7)).isoformat()
    total_pending = await db.transactions.count_documents({
        "is_deleted": False, "status": "payment_pending", "amount_remaining_to_customer": {"$gt": 0}
    })
    overdue_pending = await db.transactions.count_documents({
        "is_deleted": False, "status": "payment_pending", "amount_remaining_to_customer": {"$gt": 0},
        "created_at": {"$lt": seven_days_ago}
    })
    overdue_ratio = (overdue_pending / total_pending) if total_pending > 0 else 0
    overdue_score = round((1 - overdue_ratio) * 20, 1)
    
    # 4. PROFIT MARGIN (20 pts) — today's net profit / volume
    # BUG-07 FIX: use UTC start of IST day
    health_today_agg = await db.transactions.aggregate([
        {"$match": {"is_deleted": False, "status": {"$ne": "reversed"}, "created_at": {"$gte": get_ist_day_start_utc()}}},
        {"$group": {"_id": None, "volume": {"$sum": {"$max": ["$swipe_amount", "$total_swiped"]}}, "commission": {"$sum": "$commission_amount"}, "pg_charges": {"$sum": "$gateway_charge_amount"}}}
    ]).to_list(1)
    ht = health_today_agg[0] if health_today_agg else {"volume": 0, "commission": 0, "pg_charges": 0}
    volume = ht["volume"]
    net_profit = ht["commission"]
    margin_pct = (net_profit / volume) if volume > 0 else 0
    # Scale: 3%+ margin = full score, 0% = zero
    profit_score = round(min(max(margin_pct / 0.03, 0), 1.0) * 20, 1)
    
    # 5. CASH FLOW (20 pts) — wallet balance vs pending outflows
    total_balance = sum(w.get("balance", 0) for w in wallets)
    pending_outflow_pipeline = [
        {"$match": {"is_deleted": False, "status": "payment_pending", "amount_remaining_to_customer": {"$gt": 0}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount_remaining_to_customer"}}}
    ]
    outflow_result = await db.transactions.aggregate(pending_outflow_pipeline).to_list(1)
    pending_outflow = outflow_result[0]["total"] if outflow_result else 0
    
    if pending_outflow > 0:
        coverage = total_balance / pending_outflow
        cashflow_score = round(min(coverage, 1.0) * 20, 1)
    else:
        cashflow_score = 20.0  # No pending outflows = perfect
    
    total_score = round(consistency_score + collection_score + overdue_score + profit_score + cashflow_score)
    
    return {
        "total_score": total_score,
        "grade": "A" if total_score >= 80 else "B" if total_score >= 60 else "C" if total_score >= 40 else "D",
        "components": [
            {
                "name": "Data Consistency",
                "score": consistency_score,
                "max": 20,
                "detail": f"{negative_count} negative balance wallet(s)" if negative_count > 0 else "All wallets healthy"
            },
            {
                "name": "Collection Efficiency",
                "score": collection_score,
                "max": 20,
                "detail": f"{round(collection_pct * 100, 1)}% of dues collected"
            },
            {
                "name": "Overdue Ratio",
                "score": overdue_score,
                "max": 20,
                "detail": f"{overdue_pending} of {total_pending} payouts overdue (>7d)" if total_pending > 0 else "No pending payouts"
            },
            {
                "name": "Profit Margin",
                "score": profit_score,
                "max": 20,
                "detail": f"{round(margin_pct * 100, 1)}% margin on {formatCurrency_backend(volume)} volume" if volume > 0 else "No transactions today"
            },
            {
                "name": "Cash Flow",
                "score": cashflow_score,
                "max": 20,
                "detail": f"{formatCurrency_backend(total_balance)} balance vs {formatCurrency_backend(pending_outflow)} outflow"
            }
        ]
    }


def formatCurrency_backend(amount):
    """Simple INR formatter for backend"""
    if amount >= 10000000:
        return f"₹{amount/10000000:.1f}Cr"
    elif amount >= 100000:
        return f"₹{amount/100000:.1f}L"
    elif amount >= 1000:
        return f"₹{amount/1000:.1f}K"
    return f"₹{amount:,.0f}"


@router.get("/dashboard/analytics")
async def get_dashboard_analytics(days: int = 7, auth: dict = Depends(auth_required)):
    """Get dashboard analytics for charts"""
    await check_permission(auth, "dashboard")
    end_date = datetime.now(timezone.utc)
    start_date = end_date - timedelta(days=days)
    start_str = start_date.strftime("%Y-%m-%d")

    base_match = {"is_deleted": False, "status": {"$ne": "reversed"}, "created_at": {"$gte": start_str}}

    # Daily aggregation — grouped by date prefix (first 10 chars of created_at)
    daily_agg = await db.transactions.aggregate([
        {"$match": base_match},
        {"$group": {
            "_id": {"$substr": ["$created_at", 0, 10]},
            "volume": {"$sum": {"$max": ["$swipe_amount", "$total_swiped"]}},
            "commission": {"$sum": "$commission_amount"},
            "pg_charges": {"$sum": "$gateway_charge_amount"},
            "transactions": {"$sum": 1}
        }}
    ]).to_list(400)

    daily_data = {}
    for i in range(days):
        date = (end_date - timedelta(days=i)).strftime("%Y-%m-%d")
        daily_data[date] = {"date": date, "volume": 0, "profit": 0, "transactions": 0}
    for row in daily_agg:
        d = row["_id"]
        if d in daily_data:
            daily_data[d]["volume"] = row["volume"]
            daily_data[d]["profit"] = row["commission"]
            daily_data[d]["transactions"] = row["transactions"]

    # Gateway breakdown aggregation
    gw_agg = await db.transactions.aggregate([
        {"$match": base_match},
        {"$group": {
            "_id": {"$ifNull": ["$swipe_gateway_name", "Unknown"]},
            "volume": {"$sum": {"$max": ["$swipe_amount", "$total_swiped"]}},
            "transactions": {"$sum": 1}
        }}
    ]).to_list(200)
    gateway_data = [{"name": r["_id"], "volume": r["volume"], "transactions": r["transactions"]} for r in gw_agg]

    # Type breakdown + summary aggregation
    summary_agg = await db.transactions.aggregate([
        {"$match": base_match},
        {"$group": {
            "_id": "$transaction_type",
            "volume": {"$sum": {"$max": ["$swipe_amount", "$total_swiped"]}},
            "commission": {"$sum": "$commission_amount"},
            "pg_charges": {"$sum": "$gateway_charge_amount"},
            "count": {"$sum": 1}
        }}
    ]).to_list(10)

    type_data = {"type_01": 0, "type_02": 0, "transfer": 0}
    total_volume = total_commission = total_gateway_charges = 0
    non_transfer_count = non_transfer_volume = 0
    for row in summary_agg:
        t = row["_id"] or "type_01"
        if t in type_data:
            type_data[t] = row["volume"]
        total_volume += row["volume"]
        total_commission += row["commission"]
        total_gateway_charges += row["pg_charges"]
        if t != "transfer":
            non_transfer_count += row["count"]
            non_transfer_volume += row["volume"]

    return {
        "period_days": days,
        "daily_data": sorted(daily_data.values(), key=lambda x: x["date"]),
        "gateway_data": gateway_data,
        "type_breakdown": type_data,
        "summary": {
            "total_transactions": non_transfer_count,
            "total_volume": total_volume,
            "total_profit": total_commission,
            "total_commission": total_commission,
            "total_gateway_charges": total_gateway_charges,
            "avg_transaction_value": non_transfer_volume / non_transfer_count if non_transfer_count else 0
        }
    }


# ============== REPORTS API ==============

@router.get("/reports/agent-performance")
async def get_agent_performance(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    auth: dict = Depends(auth_required)
):
    """Get agent/user performance metrics"""
    await check_permission(auth, "reports")
    if date_from:
        date_from = validate_date_param(date_from, "date_from")
    if date_to:
        date_to = validate_date_param(date_to, "date_to")
    query = {"is_deleted": False, "status": {"$nin": ["reversed", "cancelled"]}, "transaction_type": {"$ne": "transfer"}}
    if date_from:
        query["created_at"] = {"$gte": date_from}
    if date_to:
        query.setdefault("created_at", {})["$lte"] = date_to + "T23:59:59.999999"

    agg = await db.transactions.aggregate([
        {"$match": query},
        {"$group": {
            "_id": {"id": "$created_by", "name": "$created_by_name"},
            "transaction_count": {"$sum": 1},
            "total_swipe_amount": {"$sum": {"$max": ["$swipe_amount", "$total_swiped"]}},
            "total_commission": {"$sum": "$commission_amount"}
        }},
        {"$sort": {"total_swipe_amount": -1}}
    ]).to_list(500)

    agents = [{"agent_id": r["_id"]["id"], "agent_name": r["_id"]["name"] or "Unknown",
               "transaction_count": r["transaction_count"], "total_swipe_amount": r["total_swipe_amount"],
               "total_commission": r["total_commission"]} for r in agg]

    return {
        "summary": {
            "total_agents": len(agents),
            "total_transactions": sum(a["transaction_count"] for a in agents),
            "total_swipe_amount": sum(a["total_swipe_amount"] for a in agents),
            "total_commission": sum(a["total_commission"] for a in agents)
        },
        "agents": agents
    }


@router.get("/reports/gateway-performance")
async def get_gateway_performance(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    auth: dict = Depends(auth_required)
):
    """Get gateway performance metrics"""
    await check_permission(auth, "reports")
    if date_from:
        date_from = validate_date_param(date_from, "date_from")
    if date_to:
        date_to = validate_date_param(date_to, "date_to")
    query = {"is_deleted": False, "status": {"$nin": ["reversed", "cancelled"]}, "transaction_type": {"$ne": "transfer"},
             "swipe_gateway_id": {"$exists": True, "$nin": ["", None]}}
    if date_from:
        query["created_at"] = {"$gte": date_from}
    if date_to:
        query.setdefault("created_at", {})["$lte"] = date_to + "T23:59:59.999999"

    agg = await db.transactions.aggregate([
        {"$match": query},
        {"$group": {
            "_id": {"id": "$swipe_gateway_id", "name": "$swipe_gateway_name"},
            "transaction_count": {"$sum": 1},
            "total_swipe_amount": {"$sum": {"$max": ["$swipe_amount", "$total_swiped"]}}
        }},
        {"$sort": {"total_swipe_amount": -1}}
    ]).to_list(200)

    gateways = [{"gateway_id": r["_id"]["id"], "gateway_name": r["_id"]["name"] or "Unknown",
                 "transaction_count": r["transaction_count"], "total_swipe_amount": r["total_swipe_amount"]} for r in agg]

    return {
        "summary": {
            "total_gateways": len(gateways),
            "total_transactions": sum(g["transaction_count"] for g in gateways),
            "total_swipe_amount": sum(g["total_swipe_amount"] for g in gateways)
        },
        "gateways": gateways
    }


@router.get("/reports/profit")
async def get_profit_report(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    auth: dict = Depends(auth_required)
):
    """Get profit (commission) report with daily and gateway breakdown"""
    await check_permission(auth, "reports")
    if date_from:
        date_from = validate_date_param(date_from, "date_from")
    if date_to:
        date_to = validate_date_param(date_to, "date_to")
    query = {"is_deleted": False, "status": {"$nin": ["reversed", "cancelled"]}}
    if date_from:
        query["created_at"] = {"$gte": date_from}
    if date_to:
        query.setdefault("created_at", {})["$lte"] = date_to + "T23:59:59.999999"

    # Daily breakdown
    daily_agg = await db.transactions.aggregate([
        {"$match": query},
        {"$group": {
            "_id": {"$substr": ["$created_at", 0, 10]},
            "commission": {"$sum": "$commission_amount"},
            "pg_charges": {"$sum": "$gateway_charge_amount"},
            "transaction_count": {"$sum": 1}
        }},
        {"$sort": {"_id": 1}},
        {"$limit": MAX_EXPORT_ROWS}
    ]).to_list(MAX_EXPORT_ROWS)
    daily_list = [{"date": r["_id"], "commission": r["commission"], "pg_charges": r["pg_charges"],
                   "net_profit": r["commission"], "transaction_count": r["transaction_count"]} for r in daily_agg]

    # Gateway breakdown
    gw_query = {**query, "swipe_gateway_id": {"$exists": True, "$nin": ["", None]}}
    gw_agg = await db.transactions.aggregate([
        {"$match": gw_query},
        {"$group": {
            "_id": {"id": "$swipe_gateway_id", "name": "$swipe_gateway_name"},
            "commission": {"$sum": "$commission_amount"},
            "pg_charges": {"$sum": "$gateway_charge_amount"},
            "transaction_count": {"$sum": 1}
        }},
        {"$sort": {"commission": -1}}
    ]).to_list(200)
    gateway_list = [{"gateway_id": r["_id"]["id"], "gateway_name": r["_id"]["name"] or "Unknown",
                     "commission": r["commission"], "pg_charges": r["pg_charges"],
                     "net_profit": r["commission"], "transaction_count": r["transaction_count"]} for r in gw_agg]

    total_commission = sum(d["commission"] for d in daily_list)
    total_pg_charges = sum(d["pg_charges"] for d in daily_list)
    total_transactions = sum(d["transaction_count"] for d in daily_list)

    return {
        "summary": {
            "total_commission": total_commission,
            "total_pg_charges": total_pg_charges,
            "total_net_profit": total_commission,
            "total_transactions": total_transactions,
            "avg_commission_per_txn": total_commission / total_transactions if total_transactions > 0 else 0
        },
        "daily_breakdown": daily_list,
        "gateway_breakdown": gateway_list
    }


@router.get("/reports/expenses")
async def get_expenses_report(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    auth: dict = Depends(auth_required)
):
    """Get expenses report grouped by expense type"""
    await check_permission(auth, "reports")
    query = {"is_deleted": False}
    if date_from:
        query["created_at"] = {"$gte": date_from}
    if date_to:
        query.setdefault("created_at", {})["$lte"] = date_to + "T23:59:59.999999"

    type_agg = await db.expenses.aggregate([
        {"$match": query},
        {"$group": {
            "_id": {"id": "$expense_type_id", "name": "$expense_type_name"},
            "count": {"$sum": 1},
            "total_amount": {"$sum": "$amount"}
        }},
        {"$sort": {"total_amount": -1}}
    ]).to_list(200)
    types_list = [{"type_id": r["_id"]["id"], "type_name": r["_id"]["name"] or "Unknown",
                   "count": r["count"], "total_amount": r["total_amount"]} for r in type_agg]

    # Latest 100 expense rows for the table display
    recent = await db.expenses.find(query, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)

    return {
        "summary": {
            "total_expenses": sum(t["total_amount"] for t in types_list),
            "total_count": sum(t["count"] for t in types_list),
            "expense_types_count": len(types_list)
        },
        "by_type": types_list,
        "expenses": recent
    }


@router.get("/reports/monthly-pnl")
async def get_monthly_pnl(year: Optional[int] = None, auth: dict = Depends(auth_required)):
    """Monthly P&L: volume, commission, PG charges, net profit grouped by year-month"""
    await check_permission(auth, "reports")
    match: dict = {"is_deleted": False, "status": {"$nin": ["reversed", "cancelled"]}}
    if year:
        match["created_at"] = {"$gte": f"{year}-01-01", "$lte": f"{year}-12-31T23:59:59"}

    agg = await db.transactions.aggregate([
        {"$match": match},
        {"$group": {
            "_id": {"$substr": ["$created_at", 0, 7]},  # YYYY-MM
            "transactions": {"$sum": 1},
            "volume": {"$sum": {"$max": ["$swipe_amount", "$total_swiped"]}},
            "commission": {"$sum": "$commission_amount"},
            "pg_charges": {"$sum": "$gateway_charge_amount"}
        }},
        {"$sort": {"_id": 1}}
    ]).to_list(120)  # max 10 years of monthly data

    months = []
    for i, row in enumerate(agg):
        net_profit = row["commission"]
        prev_net = agg[i - 1]["commission"] if i > 0 else None
        mom_growth = round((net_profit - prev_net) / prev_net * 100, 1) if prev_net else None
        months.append({
            "month": row["_id"],
            "transactions": row["transactions"],
            "volume": row["volume"],
            "commission": row["commission"],
            "pg_charges": row["pg_charges"],
            "net_profit": net_profit,
            "mom_growth": mom_growth,
        })

    best_month = max(months, key=lambda m: m["net_profit"]) if months else None

    return {
        "months": months,
        "summary": {
            "ytd_volume": sum(m["volume"] for m in months),
            "ytd_commission": sum(m["commission"] for m in months),
            "ytd_pg_charges": sum(m["pg_charges"] for m in months),
            "ytd_net_profit": sum(m["net_profit"] for m in months),
            "ytd_transactions": sum(m["transactions"] for m in months),
            "best_month": best_month,
            "total_months": len(months)
        }
    }


# ============== EXPORT ROUTES ==============

@router.get("/export/transactions")
async def export_transactions(
    request: Request,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    format: str = "xlsx",
    auth: dict = Depends(auth_required)
):
    """Export transactions to Excel"""
    await check_permission(auth, "downloads")
    query = {"is_deleted": False}
    if date_from:
        query["created_at"] = {"$gte": date_from}
    if date_to:
        query.setdefault("created_at", {})["$lte"] = date_to + "T23:59:59.999999"
    txns = await db.transactions.find(query, {"_id": 0}).sort("created_at", -1).limit(MAX_EXPORT_ROWS).to_list(MAX_EXPORT_ROWS)
    columns = [
        {"header": "Date", "key": lambda t: t.get("created_at", "")[:19]},
        {"header": "Type", "key": lambda t: "Direct" if t.get("transaction_type") == "type_01" else "Pay+Swipe"},
        {"header": "Customer", "key": "customer_name"},
        {"header": "Card", "key": "card_details"},
        {"header": "Gateway", "key": "swipe_gateway_name"},
        {"header": "Amount", "key": lambda t: max(t.get("swipe_amount", 0), t.get("total_swiped", 0)), "fmt": "money"},
        {"header": "Gateway %", "key": lambda t: t.get("gateway_charge_percentage", 0) / 100, "fmt": "pct"},
        {"header": "Gateway Charges", "key": lambda t: t.get("gateway_charge_amount", 0), "fmt": "money"},
        {"header": "Commission %", "key": lambda t: t.get("commission_percentage", 0) / 100, "fmt": "pct"},
        {"header": "Commission", "key": lambda t: t.get("commission_amount", 0), "fmt": "money"},
        {"header": "To Customer", "key": lambda t: t.get("amount_to_customer", 0), "fmt": "money"},
        {"header": "Pending", "key": lambda t: t.get("pending_amount", 0), "fmt": "money"},
        {"header": "Status", "key": "status"},
        {"header": "Notes", "key": "notes"},
    ]
    output = _build_xlsx("Transactions", columns, txns, [(0, 0, 18), (1, 1, 10), (2, 2, 20), (3, 3, 25), (4, 4, 15), (5, 13, 12)])
    filename = f"transactions_{date_from or 'all'}_{date_to or 'all'}.xlsx"
    await log_audit(auth["user"]["id"], auth["user"]["name"], "export", "transactions", details={"count": len(txns)}, ip=request.client.host if request.client else "")
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f"attachment; filename={filename}"})


@router.get("/export/customers")
async def export_customers(request: Request, auth: dict = Depends(auth_required)):
    """Export customers to Excel with full financial summary"""
    await check_permission(auth, "downloads")
    customers = await db.customers.find({"is_deleted": False}, {"_id": 0}).limit(MAX_EXPORT_ROWS).to_list(MAX_EXPORT_ROWS)

    # Build aggregated stats per customer in bulk
    customer_ids = [c["id"] for c in customers]

    # Transaction aggregation
    txn_pipeline = [
        {"$match": {"customer_id": {"$in": customer_ids}, "is_deleted": False}},
        {"$group": {
            "_id": "$customer_id",
            "total_transactions": {"$sum": 1},
            "total_swipe_volume": {"$sum": {"$ifNull": ["$swipe_amount", 0]}},
            "total_paid": {"$sum": {"$ifNull": ["$amount_paid_to_customer", 0]}},
            "outstanding": {"$sum": {"$ifNull": ["$amount_remaining_to_customer", 0]}},
            "active_count": {"$sum": {"$cond": [{"$not": {"$in": ["$status", ["reversed", "completed"]]}}, 1, 0]}},
            "last_txn_date": {"$max": "$created_at"},
        }},
    ]
    txn_stats = {doc["_id"]: doc for doc in await db.transactions.aggregate(txn_pipeline).to_list(10000)}

    # Pending collections aggregation
    coll_pipeline = [
        {"$match": {"customer_id": {"$in": customer_ids}, "is_deleted": False, "status": {"$in": ["pending", "partial"]}}},
        {"$group": {
            "_id": "$customer_id",
            "pending_collections": {"$sum": {"$subtract": ["$amount", {"$ifNull": ["$settled_amount", 0]}]}},
        }},
    ]
    coll_stats = {doc["_id"]: doc for doc in await db.collections.aggregate(coll_pipeline).to_list(10000)}

    # Enrich each customer row
    for c in customers:
        cid = c["id"]
        ts = txn_stats.get(cid, {})
        cs = coll_stats.get(cid, {})
        c["_total_transactions"] = ts.get("total_transactions", 0)
        c["_total_swipe_volume"] = round(ts.get("total_swipe_volume", 0), 2)
        c["_total_paid"] = round(ts.get("total_paid", 0), 2)
        c["_outstanding"] = round(ts.get("outstanding", 0), 2)
        c["_pending_collections"] = round(cs.get("pending_collections", 0), 2)
        c["_active_txns"] = ts.get("active_count", 0)
        c["_last_txn_date"] = (ts.get("last_txn_date") or "")[:10]
        # Flatten card details
        cards = c.get("cards", [])
        c["_card_details"] = ", ".join(
            f"{cd.get('card_network_name', '')} - {cd.get('bank_name', '')} - ****{cd.get('last_four_digits', '')}"
            for cd in cards
        ) if cards else ""

    columns = [
        {"header": "Customer ID", "key": "customer_id"},
        {"header": "Name", "key": "name"},
        {"header": "Phone", "key": "phone"},
        {"header": "ID Proof", "key": "id_proof"},
        {"header": "Charge Note", "key": "charge_note"},
        {"header": "Cards Count", "key": lambda c: len(c.get("cards", []))},
        {"header": "Card Details", "key": "_card_details"},
        {"header": "Total Transactions", "key": "_total_transactions"},
        {"header": "Active Transactions", "key": "_active_txns"},
        {"header": "Total Swipe Volume", "key": "_total_swipe_volume", "fmt": "money"},
        {"header": "Total Paid to Customer", "key": "_total_paid", "fmt": "money"},
        {"header": "Outstanding to Customer", "key": "_outstanding", "fmt": "money"},
        {"header": "Pending Collections", "key": "_pending_collections", "fmt": "money"},
        {"header": "Last Transaction Date", "key": "_last_txn_date"},
        {"header": "Blacklisted", "key": lambda c: "Yes" if c.get("is_blacklisted") else "No"},
        {"header": "Blacklist Reason", "key": "blacklist_reason"},
        {"header": "Notes", "key": "notes"},
        {"header": "Created At", "key": lambda c: c.get("created_at", "")[:10]},
    ]
    output = _build_xlsx("Customers", columns, customers, [
        (0, 0, 12), (1, 1, 25), (2, 2, 15), (3, 3, 15), (4, 4, 20),
        (5, 5, 10), (6, 6, 40), (7, 8, 12), (9, 12, 18), (13, 13, 14),
        (14, 14, 10), (15, 15, 20), (16, 16, 25), (17, 17, 12),
    ])
    await log_audit(auth["user"]["id"], auth["user"]["name"], "export", "customers", details={"count": len(customers)}, ip=request.client.host if request.client else "")
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=customers.xlsx"})


@router.get("/export/collections")
async def export_collections(request: Request, auth: dict = Depends(auth_required)):
    """Export collections to Excel"""
    await check_permission(auth, "downloads")
    payments = await db.collections.find({"is_deleted": False}, {"_id": 0}).limit(MAX_EXPORT_ROWS).to_list(MAX_EXPORT_ROWS)
    columns = [
        {"header": "Date", "key": lambda p: p.get("created_at", "")[:10]},
        {"header": "Customer", "key": "customer_name"},
        {"header": "Status", "key": "status"},
        {"header": "Total Amount", "key": lambda p: p.get("amount", 0), "fmt": "money"},
        {"header": "Settled Amount", "key": lambda p: p.get("settled_amount", 0), "fmt": "money"},
        {"header": "Remaining", "key": lambda p: p.get("amount", 0) - p.get("settled_amount", 0), "fmt": "money"},
    ]
    output = _build_xlsx("Collections", columns, payments, [(0, 0, 12), (1, 1, 25), (2, 5, 15)])
    await log_audit(auth["user"]["id"], auth["user"]["name"], "export", "collections", details={"count": len(payments)}, ip=request.client.host if request.client else "")
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=collections.xlsx"})


@router.get("/export/payments")
async def export_payments(request: Request, auth: dict = Depends(auth_required)):
    """Export payment history to Excel"""
    await check_permission(auth, "downloads")
    payments = await db.payments.find({"is_deleted": False}, {"_id": 0}).limit(MAX_EXPORT_ROWS).to_list(MAX_EXPORT_ROWS)
    columns = [
        {"header": "Date", "key": lambda p: p.get("created_at", "")[:10]},
        {"header": "Customer", "key": "customer_name"},
        {"header": "Transaction ID", "key": "transaction_id"},
        {"header": "Amount", "key": lambda p: p.get("amount", 0), "fmt": "money"},
        {"header": "Source", "key": "source_name"},
        {"header": "Method", "key": "payment_method"},
        {"header": "Reference", "key": "reference_number"},
        {"header": "Recorded By", "key": "recorded_by_name"},
    ]
    output = _build_xlsx("Customer Payments", columns, payments, [(0, 0, 12), (1, 2, 20), (3, 3, 12), (4, 7, 15)])
    await log_audit(auth["user"]["id"], auth["user"]["name"], "export", "payments", details={"count": len(payments)}, ip=request.client.host if request.client else "")
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=payments.xlsx"})


@router.get("/export/collection-history")
async def export_collection_history(request: Request, auth: dict = Depends(auth_required)):
    """Export collection history to Excel"""
    await check_permission(auth, "downloads")
    all_payments = await db.collections.find(
        {"is_deleted": False, "settlements": {"$exists": True, "$ne": []}}, {"_id": 0}
    ).limit(MAX_EXPORT_ROWS).to_list(MAX_EXPORT_ROWS)
    rows = []
    for payment in all_payments:
        for s in payment.get("settlements", []):
            if s.get("voided"):
                continue
            rows.append({
                "date": s.get("settled_at", "")[:10] if s.get("settled_at") else "",
                "customer": payment.get("customer_name", ""),
                "txn_id": payment.get("transaction_id_readable", ""),
                "total_due": payment.get("amount", 0),
                "collected": s.get("amount", 0),
                "wallet": s.get("wallet_name", ""),
                "payment_type": s.get("payment_type", ""),
                "collected_by": s.get("settled_by_name", ""),
            })
    columns = [
        {"header": "Date", "key": "date"},
        {"header": "Customer", "key": "customer"},
        {"header": "Transaction ID", "key": "txn_id"},
        {"header": "Total Due", "key": "total_due", "fmt": "money"},
        {"header": "Collected", "key": "collected", "fmt": "money"},
        {"header": "Wallet", "key": "wallet"},
        {"header": "Payment Type", "key": "payment_type"},
        {"header": "Collected By", "key": "collected_by"},
    ]
    output = _build_xlsx("Collections", columns, rows, [(0, 0, 12), (1, 2, 20), (3, 4, 12), (5, 7, 15)])
    await log_audit(auth["user"]["id"], auth["user"]["name"], "export", "collections", details={"count": len(rows)}, ip=request.client.host if request.client else "")
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=collections.xlsx"})


@router.get("/export/expenses")
async def export_expenses(request: Request, auth: dict = Depends(auth_required)):
    """Export expenses to Excel"""
    await check_permission(auth, "downloads")
    expenses = await db.expenses.find({"is_deleted": False}, {"_id": 0}).limit(MAX_EXPORT_ROWS).to_list(MAX_EXPORT_ROWS)
    columns = [
        {"header": "Date", "key": "expense_date"},
        {"header": "Expense ID", "key": "expense_id"},
        {"header": "Type", "key": "expense_type_name"},
        {"header": "Amount", "key": lambda e: e.get("amount", 0), "fmt": "money"},
        {"header": "Wallet", "key": "wallet_name"},
        {"header": "Description", "key": "description"},
        {"header": "Vendor", "key": "vendor_name"},
        {"header": "Reference", "key": "reference_number"},
        {"header": "Created By", "key": "created_by_name"},
    ]
    output = _build_xlsx("Expenses", columns, expenses, [(0, 1, 12), (2, 2, 15), (3, 3, 12), (4, 8, 15)])
    await log_audit(auth["user"]["id"], auth["user"]["name"], "export", "expenses", details={"count": len(expenses)}, ip=request.client.host if request.client else "")
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=expenses.xlsx"})


@router.get("/export/wallet-operations")
async def export_wallet_operations(request: Request, auth: dict = Depends(auth_required)):
    """Export wallet operations to Excel"""
    await check_permission(auth, "downloads")
    operations = await db.wallet_operations.find({"is_deleted": False}, {"_id": 0}).sort("created_at", -1).limit(MAX_EXPORT_ROWS).to_list(MAX_EXPORT_ROWS)
    columns = [
        {"header": "Op ID", "key": "operation_id"},
        {"header": "Seq #", "key": lambda o: o.get("sequence_number", "")},
        {"header": "Date", "key": lambda o: o.get("created_at", "")[:19].replace("T", " ")},
        {"header": "Wallet", "key": "wallet_name"},
        {"header": "Wallet Type", "key": lambda o: (o.get("wallet_type", "") or "").replace("_", " ").title()},
        {"header": "Operation", "key": "operation_type"},
        {"header": "Amount", "key": lambda o: o.get("amount", 0), "fmt": "money"},
        {"header": "Balance Before", "key": lambda o: o.get("balance_before", 0), "fmt": "money"},
        {"header": "Balance After", "key": lambda o: o.get("balance_after", 0), "fmt": "money"},
        {"header": "Transaction", "key": "transaction_id"},
        {"header": "Customer", "key": "customer_id"},
        {"header": "Reference", "key": "reference_type"},
        {"header": "Reference ID", "key": lambda o: o.get("reference_id", "")},
        {"header": "Payment Method", "key": lambda o: o.get("payment_type", "") or ""},
        {"header": "Transfer Wallet", "key": lambda o: o.get("transfer_wallet_name", "") or ""},
        {"header": "Notes", "key": "notes"},
        {"header": "Created By", "key": "created_by_name"},
    ]
    output = _build_xlsx("Wallet Operations", columns, operations, [(0, 0, 12), (1, 1, 6), (2, 2, 18), (3, 4, 15), (5, 5, 10), (6, 8, 12), (9, 10, 14), (11, 12, 15), (13, 14, 14), (15, 15, 20), (16, 16, 15)])
    await log_audit(auth["user"]["id"], auth["user"]["name"], "export", "wallet_operations", details={"count": len(operations)}, ip=request.client.host if request.client else "")
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=wallet_operations.xlsx"})


@router.get("/export/daily-closings")
async def export_daily_closings(request: Request, auth: dict = Depends(auth_required)):
    """Export daily closings to Excel"""
    await check_permission(auth, "downloads")
    closings = await db.daily_closings.find({"is_deleted": False}, {"_id": 0}).sort("date", -1).limit(MAX_EXPORT_ROWS).to_list(MAX_EXPORT_ROWS)
    columns = [
        {"header": "Date", "key": "date"},
        {"header": "Transactions", "key": lambda c: c.get("total_transactions", 0)},
        {"header": "Swipe Amount", "key": lambda c: c.get("total_swipe_amount", 0), "fmt": "money"},
        {"header": "Gateway Charges", "key": lambda c: c.get("total_gateway_charges", 0), "fmt": "money"},
        {"header": "Commission", "key": lambda c: c.get("total_commission", 0), "fmt": "money"},
        {"header": "Profit", "key": lambda c: c.get("total_profit", 0), "fmt": "money"},
        {"header": "Pending Created", "key": lambda c: c.get("total_pending_created", 0), "fmt": "money"},
        {"header": "Pending Settled", "key": lambda c: c.get("total_pending_settled", 0), "fmt": "money"},
        {"header": "Closed By", "key": "closed_by_name"},
    ]
    output = _build_xlsx("Daily Closings", columns, closings, [(0, 0, 12), (1, 1, 12), (2, 7, 15), (8, 8, 15)])
    await log_audit(auth["user"]["id"], auth["user"]["name"], "export", "daily_closings", details={"count": len(closings)}, ip=request.client.host if request.client else "")
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=daily_closings.xlsx"})


@router.get("/export/audit-logs")
async def export_audit_logs(request: Request, auth: dict = Depends(auth_required)):
    """Export audit logs to Excel"""
    await check_permission(auth, "downloads")
    logs = await db.audit_logs.find({}, {"_id": 0}).sort("timestamp", -1).limit(MAX_EXPORT_ROWS).to_list(MAX_EXPORT_ROWS)
    columns = [
        {"header": "Timestamp", "key": lambda r: r.get("timestamp", "")[:19].replace("T", " ")},
        {"header": "User", "key": "user_name"},
        {"header": "Action", "key": "action"},
        {"header": "Module", "key": "module"},
        {"header": "Entity ID", "key": "entity_id"},
        {"header": "IP Address", "key": "ip_address"},
        {"header": "Details", "key": lambda r: str(r.get("details", {})) if r.get("details") else ""},
    ]
    output = _build_xlsx("Audit Logs", columns, logs, [(0, 0, 18), (1, 5, 15), (6, 6, 40)])
    await log_audit(auth["user"]["id"], auth["user"]["name"], "export", "audit_logs", details={"count": len(logs)}, ip=request.client.host if request.client else "")
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=audit_logs.xlsx"})


@router.get("/export/gateways")
async def export_gateways(request: Request, auth: dict = Depends(auth_required)):
    """Export gateways and servers to Excel (multi-sheet)"""
    await check_permission(auth, "downloads")
    import xlsxwriter

    gateways = await db.gateways.find({"is_deleted": False}, {"_id": 0}).to_list(100)
    servers = await db.gateway_servers.find({"is_deleted": False}, {"_id": 0}).to_list(500)
    wallets = await db.wallets.find({"wallet_type": "gateway", "is_deleted": False}, {"_id": 0}).to_list(100)
    gateway_lookup = {g["id"]: g for g in gateways}
    wallet_lookup = {w.get("gateway_id"): w for w in wallets}

    output = io.BytesIO()
    workbook = xlsxwriter.Workbook(output)
    hfmt = workbook.add_format({"bold": True, "bg_color": "#1e293b", "font_color": "white", "border": 1})
    mfmt = workbook.add_format({"num_format": "₹#,##0.00", "border": 1})
    cfmt = workbook.add_format({"border": 1})

    ws_gw = workbook.add_worksheet("Gateways")
    for ci, h in enumerate(["Gateway Name", "Description", "Wallet Balance", "Status"]):
        ws_gw.write(0, ci, h, hfmt)
    for ri, gw in enumerate(gateways, 1):
        w = wallet_lookup.get(gw["id"], {})
        ws_gw.write(ri, 0, gw.get("name", ""), cfmt)
        ws_gw.write(ri, 1, gw.get("description", ""), cfmt)
        ws_gw.write(ri, 2, w.get("balance", 0), mfmt)
        ws_gw.write(ri, 3, "Active" if gw.get("is_active", True) else "Inactive", cfmt)
    ws_gw.set_column(0, 1, 20)
    ws_gw.set_column(2, 3, 15)

    ws_srv = workbook.add_worksheet("Servers")
    for ci, h in enumerate(["Gateway", "Server Name", "Charge %", "Status"]):
        ws_srv.write(0, ci, h, hfmt)
    for ri, srv in enumerate(servers, 1):
        gw = gateway_lookup.get(srv.get("gateway_id"), {})
        ws_srv.write(ri, 0, gw.get("name", ""), cfmt)
        ws_srv.write(ri, 1, srv.get("name", ""), cfmt)
        ws_srv.write(ri, 2, srv.get("charge_percentage", 0), cfmt)
        ws_srv.write(ri, 3, "Active" if srv.get("is_active", True) else "Inactive", cfmt)
    ws_srv.set_column(0, 1, 20)
    ws_srv.set_column(2, 3, 12)

    try:
        workbook.close()
    finally:
        output.seek(0)
    await log_audit(auth["user"]["id"], auth["user"]["name"], "export", "gateways", details={"gateways": len(gateways), "servers": len(servers)}, ip=request.client.host if request.client else "")
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=gateways.xlsx"})
