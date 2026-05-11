"""
Admin Daily Closing Router - End of day operations
Extracted from admin.py for ARCH-10
"""
from fastapi import APIRouter, HTTPException, Depends, Request
from datetime import datetime, timedelta
import logging

from core.database import db, scheduler
from core.dependencies import auth_required, check_permission, log_audit
from utils import serialize_doc, serialize_docs, get_today_date, get_ist_day_start_utc
from models import DailyClosing

router = APIRouter(tags=["Admin"])
logger = logging.getLogger(__name__)


@router.get("/daily-closing")
async def get_daily_closings(auth: dict = Depends(auth_required)):
    """Get daily closing records"""
    await check_permission(auth, "daily-closing")
    closings = await db.daily_closings.find({"is_deleted": False}, {"_id": 0}).sort("date", -1).to_list(100)
    return serialize_docs(closings)


@router.get("/daily-closing/today")
async def get_today_summary(auth: dict = Depends(auth_required)):
    """Get today's summary for daily closing"""
    await check_permission(auth, "daily-closing")
    # GAP-9/13 FIX: use IST-aware UTC boundaries instead of naive date strings
    today_utc = get_ist_day_start_utc()
    ist_midnight_dt = datetime.fromisoformat(today_utc)
    tomorrow_utc = (ist_midnight_dt + timedelta(days=1)).isoformat()
    today = get_today_date()
    
    # Aggregation for transactions — no truncation
    txn_match = {
        "is_deleted": False,
        "status": {"$ne": "reversed"},
        "created_at": {"$gte": today_utc, "$lt": tomorrow_utc}
    }
    txn_agg = await db.transactions.aggregate([
        {"$match": txn_match},
        {"$group": {
            "_id": None,
            "count": {"$sum": 1},
            "swipe_amount": {"$sum": {"$max": ["$swipe_amount", "$total_swiped"]}},
            "gateway_charges": {"$sum": "$gateway_charge_amount"},
            "commission": {"$sum": "$commission_amount"},
            "pending_created": {"$sum": "$pending_amount"}
        }}
    ]).to_list(1)
    t = txn_agg[0] if txn_agg else {"count": 0, "swipe_amount": 0, "gateway_charges": 0, "commission": 0, "pending_created": 0}
    total_transactions = t["count"]
    total_swipe_amount = t["swipe_amount"]
    total_gateway_charges = t["gateway_charges"]
    total_commission = t["commission"]
    total_pending_created = t["pending_created"]

    # Aggregation for gateway summary
    # BUG-10 FIX: Use $max(swipe_amount, total_swiped) to correctly count multi-swipe Type 02 volume,
    # consistent with the main totals aggregation above
    gw_agg = await db.transactions.aggregate([
        {"$match": txn_match},
        {"$group": {
            "_id": {"id": "$swipe_gateway_id", "name": "$swipe_gateway_name"},
            "transactions": {"$sum": 1},
            "volume": {"$sum": {"$max": ["$swipe_amount", "$total_swiped"]}},
            "charges": {"$sum": "$gateway_charge_amount"}
        }}
    ]).to_list(100)
    gateway_summary = {
        r["_id"]["id"]: {"gateway_name": r["_id"]["name"] or "Unknown", "transactions": r["transactions"], "volume": r["volume"], "charges": r["charges"]}
        for r in gw_agg
    }

    # Aggregation for settlements — unwind sub-documents, filter voided, sum amount
    settlement_agg = await db.collections.aggregate([
        {"$match": {"is_deleted": False, "settlements": {"$elemMatch": {
            "settled_at": {"$gte": today_utc, "$lt": tomorrow_utc},
            "voided": {"$ne": True}
        }}}},
        {"$unwind": "$settlements"},
        {"$match": {
            "settlements.settled_at": {"$gte": today_utc, "$lt": tomorrow_utc},
            "settlements.voided": {"$ne": True}
        }},
        {"$group": {"_id": None, "total": {"$sum": "$settlements.amount"}}}
    ]).to_list(1)
    total_pending_settled = settlement_agg[0]["total"] if settlement_agg else 0
    
    wallets = await db.wallets.find({"is_deleted": False}, {"_id": 0}).to_list(100)
    wallet_snapshots = [
        {"wallet_id": w["id"], "name": w["name"], "wallet_type": w["wallet_type"], "balance": w.get("balance", 0)}
        for w in wallets
    ]
    
    # Writeoff deduction for net profit (matches dashboard formula)
    writeoff_agg = await db.expenses.aggregate([
        {"$match": {"expense_type_name": "Charge Write-Off", "is_deleted": {"$ne": True},
                     "created_at": {"$gte": today_utc, "$lt": tomorrow_utc}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]).to_list(1)
    total_writeoffs = writeoff_agg[0]["total"] if writeoff_agg else 0

    return {
        "date": today,
        "total_transactions": total_transactions,
        "total_swipe_amount": total_swipe_amount,
        "total_gateway_charges": total_gateway_charges,
        "total_commission": total_commission,
        "total_profit": total_commission,  # Gross commission (legacy field)
        "total_net_profit": total_commission - total_writeoffs,  # Net profit = commission - writeoffs (matches dashboard)
        "total_writeoffs": total_writeoffs,
        "total_pending_created": total_pending_created,
        "total_pending_settled": total_pending_settled,
        "gateway_wise_summary": gateway_summary,
        "wallet_snapshots": wallet_snapshots
    }


@router.post("/daily-closing")
async def create_daily_closing(request: Request, notes: str = "", auth: dict = Depends(auth_required)):
    """Create daily closing record"""
    await check_permission(auth, "daily-closing")
    today = get_today_date()
    
    existing = await db.daily_closings.find_one({"date": today, "is_deleted": False}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Daily closing already done for today")
    
    summary = await get_today_summary(auth)
    
    closing = DailyClosing(
        date=today,
        total_transactions=summary["total_transactions"],
        total_swipe_amount=summary["total_swipe_amount"],
        total_gateway_charges=summary["total_gateway_charges"],
        total_commission=summary["total_commission"],
        total_profit=summary["total_profit"],
        total_pending_created=summary["total_pending_created"],
        total_pending_settled=summary["total_pending_settled"],
        gateway_wise_summary=summary["gateway_wise_summary"],
        wallet_snapshots=summary.get("wallet_snapshots", []),
        closed_by=auth["user"]["id"],
        closed_by_name=auth["user"]["name"],
        is_auto_closed=False,
        notes=notes
    )
    
    doc = closing.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.daily_closings.insert_one(doc)
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "create", "daily_closing", closing.id, {"date": today}, ip=request.client.host if request.client else "")
    
    return serialize_doc(doc)


@router.get("/daily-closing/scheduler-status")
async def get_scheduler_status(auth: dict = Depends(auth_required)):
    """Get auto daily closing scheduler status"""
    await check_permission(auth, "daily-closing")
    
    settings = await db.settings.find_one({"id": "app_settings"}, {"_id": 0})
    job = scheduler.get_job("auto_daily_closing") if scheduler.running else None
    
    return {
        "scheduler_running": scheduler.running,
        "auto_closing_enabled": settings.get("auto_daily_closing_enabled", False) if settings else False,
        "scheduled_time": settings.get("auto_daily_closing_time", "00:00") if settings else "00:00",
        "next_run": job.next_run_time.isoformat() if job and job.next_run_time else None,
        "job_exists": job is not None
    }


@router.post("/daily-closing/trigger-auto-close")
async def trigger_auto_close(auth: dict = Depends(auth_required)):
    """Manually trigger the auto daily closing job"""
    await check_permission(auth, "daily-closing")
    
    # Import the auto_daily_closing function from server module
    from server import auto_daily_closing
    
    try:
        await auto_daily_closing()
        return {"message": "Auto daily closing triggered successfully", "status": "success"}
    except Exception as e:
        logger.error(f"Manual auto close trigger failed: {e}")
        raise HTTPException(status_code=500, detail=f"Auto close failed: {str(e)}")


@router.post("/daily-closing/{closing_date}/reopen")
async def reopen_daily_closing(closing_date: str, request: Request, auth: dict = Depends(auth_required)):
    """Reopen a daily closing by soft-deleting it. SuperAdmin only."""
    await check_permission(auth, "daily-closing")
    
    existing = await db.daily_closings.find_one({"date": closing_date, "is_deleted": False}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail=f"No closing found for date {closing_date}")
    
    await db.daily_closings.update_one(
        {"id": existing["id"]},
        {"$set": {"is_deleted": True, "reopened_by": auth["user"]["id"], "reopened_by_name": auth["user"]["name"],
                  "reopened_at": datetime.now().isoformat()}}
    )
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "reopen", "daily_closing", existing["id"],
                    {"date": closing_date}, ip=request.client.host if request.client else "")
    
    return {"message": f"Daily closing for {closing_date} reopened. You can now re-close it.", "date": closing_date}
