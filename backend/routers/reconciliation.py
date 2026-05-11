"""
Reconciliation Router - Data reconciliation and balance verification
"""
from fastapi import APIRouter, HTTPException, Depends, Query, Request
from datetime import datetime, timezone
from typing import Optional
import logging

from core.database import db
from core.dependencies import auth_required, check_permission, log_audit
from utils import serialize_doc, serialize_docs, generate_operation_id, get_next_operation_sequence
from models import WalletOperation, BalanceVerification, BalanceVerificationCreate

router = APIRouter(tags=["Reconciliation"])
logger = logging.getLogger(__name__)


# ============== DATA RECONCILIATION ==============

async def run_reconciliation_check(triggered_by_id: str = None, triggered_by_name: str = None, report_type: str = "manual"):
    """Run data reconciliation check"""
    import uuid
    
    wallet_discrepancies = []
    transaction_discrepancies = []
    wallets_checked = 0
    transactions_checked = 0
    
    # Check all wallet balances (not just gateway)
    all_wallets = await db.wallets.find({"is_deleted": False}, {"_id": 0}).to_list(100)
    wallets_checked = len(all_wallets)
    
    # AUDIT-R3-04: Batch aggregate all wallet balances in a single query instead of N+1
    wallet_ids = [w["id"] for w in all_wallets]
    balance_pipeline = [
        {"$match": {"wallet_id": {"$in": wallet_ids}}},
        {"$group": {
            "_id": "$wallet_id",
            "total_credit": {"$sum": {"$cond": [{"$eq": ["$operation_type", "credit"]}, "$amount", 0]}},
            "total_debit": {"$sum": {"$cond": [{"$ne": ["$operation_type", "credit"]}, "$amount", 0]}}
        }}
    ]
    balance_results = await db.wallet_operations.aggregate(balance_pipeline).to_list(200)
    calculated_balances = {r["_id"]: r["total_credit"] - r["total_debit"] for r in balance_results}
    
    for wallet in all_wallets:
        calculated_balance = calculated_balances.get(wallet["id"], 0)
        stored_balance = wallet.get("balance", 0)
        
        if abs(calculated_balance - stored_balance) > 0.01:
            difference = stored_balance - calculated_balance
            wallet_discrepancies.append({
                "wallet_id": wallet["id"],
                "wallet_name": wallet["name"],
                "current_balance": stored_balance,
                "expected_balance": calculated_balance,
                "discrepancy": difference,
                "severity": "high" if abs(difference) > 1000 else "medium"
            })
    
    # Check pending payments vs transactions
    # BUG-S3-03 FIX: remove hard cap of 1000 — use no limit so all pending
    # collections are checked (previously truncated reconciliation for busy systems)
    pending = await db.collections.find({"status": {"$in": ["pending", "partial"]}, "is_deleted": False}, {"_id": 0}).to_list(10000)
    transactions_checked = len(pending)
    
    pending_txn_ids = [p.get("transaction_id") for p in pending if p.get("transaction_id")]
    if pending_txn_ids:
        existing_txns = await db.transactions.find(
            {"id": {"$in": pending_txn_ids}}, {"_id": 0, "id": 1}
        ).to_list(len(pending_txn_ids))
        existing_txn_ids = {t["id"] for t in existing_txns}
    else:
        existing_txn_ids = set()
    
    for p in pending:
        txn_id = p.get("transaction_id")
        if txn_id and txn_id not in existing_txn_ids:
            transaction_discrepancies.append({
                "transaction_id": txn_id or p["id"],
                "customer_name": p.get("customer_name", "Unknown"),
                "recorded_paid": p.get("amount", 0),
                "actual_payments_sum": 0,
                "severity": "high",
                "issue": "orphaned_collection"
            })
    
    # Check pending swipe transactions - pay sources total must match total_pay_to_card
    # BUG-S3-04 FIX: remove hard cap of 1000 — use no limit so all pending-swipe
    # transactions are reconciled (previously capped at 1000)
    pending_swipes = await db.transactions.find({
        "transaction_type": "type_02",
        "status": {"$in": ["pending_swipe", "partially_completed"]},
        "is_deleted": False
    }, {"_id": 0}).to_list(10000)
    transactions_checked += len(pending_swipes)
    
    if pending_swipes:
        swipe_ids = [txn["id"] for txn in pending_swipes]
        pay_sources_pipeline = [
            {"$match": {"transaction_id": {"$in": swipe_ids}, "status": {"$ne": "refunded"}}},
            {"$group": {"_id": "$transaction_id", "total": {"$sum": "$amount"}, "count": {"$sum": 1}}}
        ]
        pay_sources_agg = await db.transaction_pay_sources.aggregate(pay_sources_pipeline).to_list(len(swipe_ids))
        pay_sources_by_txn = {r["_id"]: {"total": r["total"], "count": r["count"]} for r in pay_sources_agg}
    else:
        pay_sources_by_txn = {}
    
    for txn in pending_swipes:
        ps_data = pay_sources_by_txn.get(txn["id"], {"total": 0, "count": 0})
        sources_total = ps_data["total"]
        expected_total = txn.get("total_pay_to_card") or txn.get("pay_to_card_amount", 0)
        
        if abs(sources_total - expected_total) > 0.01:
            transaction_discrepancies.append({
                "transaction_id": txn.get("transaction_id", txn["id"]),
                "customer_name": txn.get("customer_name", "Unknown"),
                "recorded_paid": expected_total,
                "actual_payments_sum": sources_total,
                "severity": "high",
                "issue": "pay_sources_mismatch"
            })
        
        # Check total_swiped consistency with swipe_history
        swipe_history = txn.get("swipe_history", [])
        history_total = sum(sh.get("amount", 0) for sh in swipe_history)
        total_swiped = txn.get("total_swiped", 0)
        
        if abs(history_total - total_swiped) > 0.01:
            transaction_discrepancies.append({
                "transaction_id": txn.get("transaction_id", txn["id"]),
                "customer_name": txn.get("customer_name", "Unknown"),
                "recorded_paid": total_swiped,
                "actual_payments_sum": history_total,
                "severity": "medium",
                "issue": "swipe_history_mismatch"
            })
        
        # Check pending_swipe_amount = total_pay_to_card - total_swiped
        expected_pending = expected_total - total_swiped
        actual_pending = txn.get("pending_swipe_amount", 0)
        
        if abs(expected_pending - actual_pending) > 0.01:
            transaction_discrepancies.append({
                "transaction_id": txn.get("transaction_id", txn["id"]),
                "customer_name": txn.get("customer_name", "Unknown"),
                "recorded_paid": actual_pending,
                "actual_payments_sum": expected_pending,
                "severity": "medium",
                "issue": "pending_amount_mismatch"
            })
    
    # Determine overall status based on discrepancies
    total_issues = len(wallet_discrepancies) + len(transaction_discrepancies)
    high_severity_count = sum(1 for d in wallet_discrepancies + transaction_discrepancies if d.get("severity") == "high")
    
    if total_issues == 0:
        status = "healthy"
        message = "All checks passed. No discrepancies found."
    elif high_severity_count > 0:
        status = "critical"
        message = f"Critical issues found: {high_severity_count} high severity discrepancies."
    else:
        status = "warning"
        message = f"Issues detected: {total_issues} discrepancies found."
    
    now_iso = datetime.now(timezone.utc).isoformat()
    
    return {
        "id": str(uuid.uuid4()),
        "status": status,
        "message": message,
        "report_type": report_type,
        "timestamp": now_iso,
        "created_at": now_iso,
        "completed_at": now_iso,
        "last_check": now_iso,
        "wallets_checked": wallets_checked,
        "wallets_with_issues": len(wallet_discrepancies),
        "transactions_checked": transactions_checked,
        "transactions_with_issues": len(transaction_discrepancies),
        "wallet_discrepancies": wallet_discrepancies,
        "transaction_discrepancies": transaction_discrepancies,
        "triggered_by": triggered_by_id,
        "triggered_by_name": triggered_by_name,
        "auto_reconciliation_enabled": True,
        "reconciliation_interval_hours": 6
    }


@router.get("/reconciliation/status")
async def get_reconciliation_status(auth: dict = Depends(auth_required)):
    """Get latest reconciliation status"""
    latest = await db.reconciliation_reports.find(
        {}, {"_id": 0}
    ).sort("timestamp", -1).limit(1).to_list(1)
    
    if latest and len(latest) > 0:
        report = latest[0]
        # Ensure the report has the expected structure
        return {
            "status": report.get("status", "unknown"),
            "message": report.get("message", ""),
            "last_check": report.get("completed_at") or report.get("timestamp"),
            "auto_reconciliation_enabled": report.get("auto_reconciliation_enabled", True),
            "reconciliation_interval_hours": report.get("reconciliation_interval_hours", 6),
            "wallets_with_issues": report.get("wallets_with_issues", 0),
            "transactions_with_issues": report.get("transactions_with_issues", 0)
        }
    
    return {
        "status": "unknown",
        "message": "No reconciliation reports yet. Run a check to get started.",
        "last_check": None,
        "auto_reconciliation_enabled": True,
        "reconciliation_interval_hours": 6
    }


@router.post("/reconciliation/run")
async def trigger_reconciliation(request: Request, auth: dict = Depends(auth_required)):
    """Manually trigger reconciliation check"""
    await check_permission(auth, "reconciliation")
    
    result = await run_reconciliation_check(
        triggered_by_id=auth["user"]["id"],
        triggered_by_name=auth["user"]["name"],
        report_type="manual"
    )
    
    # Create a copy for database insertion (MongoDB will add _id)
    db_result = dict(result)
    await db.reconciliation_reports.insert_one(db_result)
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "run", "reconciliation", details={
        "status": result["status"],
        "wallets_with_issues": result["wallets_with_issues"],
        "transactions_with_issues": result["transactions_with_issues"]
    }, ip=request.client.host if request.client else "")
    
    # Return the original result without _id
    return result


@router.get("/reconciliation/reports")
async def get_reconciliation_reports(
    limit: int = Query(10, ge=1, le=50),
    auth: dict = Depends(auth_required)
):
    """Get reconciliation report history"""
    reports = await db.reconciliation_reports.find(
        {}, {"_id": 0}
    ).sort("timestamp", -1).limit(limit).to_list(limit)
    
    return serialize_docs(reports)


# ============== BALANCE VERIFICATION ==============

@router.get("/balance-verifications/wallets-status")
async def get_wallets_verification_status(auth: dict = Depends(auth_required)):
    """Get all wallets with their verification status"""
    wallets = await db.wallets.find({"is_deleted": False}, {"_id": 0}).to_list(100)
    
    # ISSUE-06 FIX: Batch fetch latest verification per wallet using aggregation
    latest_verif_pipeline = [
        {"$sort": {"created_at": -1}},
        {"$group": {"_id": "$wallet_id", "doc": {"$first": "$$ROOT"}}}
    ]
    latest_verif_agg = await db.balance_verifications.aggregate(latest_verif_pipeline).to_list(200)
    verif_by_wallet = {item["_id"]: item["doc"] for item in latest_verif_agg}
    
    result = []
    for wallet in wallets:
        latest_verification = verif_by_wallet.get(wallet["id"])
        # Remove _id from the aggregated doc if present
        if latest_verification and "_id" in latest_verification:
            latest_verification = {k: v for k, v in latest_verification.items() if k != "_id"}
        
        wallet_info = {
            "id": wallet["id"],
            "name": wallet["name"],
            "wallet_type": wallet["wallet_type"],
            "balance": wallet.get("balance", 0),
            "system_balance": wallet.get("balance", 0),  # Frontend expects this
            "gateway_id": wallet.get("gateway_id"),
            "last_verified_at": latest_verification.get("created_at") if latest_verification else None,
            "last_actual_balance": latest_verification.get("actual_balance") if latest_verification else None,
            "last_difference": latest_verification.get("difference", 0) if latest_verification else 0,
            "last_verified_by": latest_verification.get("verified_by_name") if latest_verification else None,
            "last_verification": latest_verification
        }
        result.append(wallet_info)
    
    return result


@router.get("/balance-verifications")
async def get_balance_verifications(
    wallet_id: Optional[str] = None,
    limit: int = Query(50, ge=1, le=100),
    auth: dict = Depends(auth_required)
):
    """Get balance verification history"""
    query = {}
    if wallet_id:
        query["wallet_id"] = wallet_id
    
    verifications = await db.balance_verifications.find(
        query, {"_id": 0}
    ).sort("created_at", -1).limit(limit).to_list(limit)
    
    return serialize_docs(verifications)


@router.post("/balance-verifications")
async def create_balance_verification(data: BalanceVerificationCreate, request: Request, auth: dict = Depends(auth_required)):
    """Create balance verification and auto-adjust wallet if needed"""
    await check_permission(auth, "reconciliation")
    
    wallet = await db.wallets.find_one({"id": data.wallet_id, "is_deleted": False}, {"_id": 0})
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")
    
    system_balance = wallet.get("balance", 0)
    difference = data.actual_balance - system_balance
    
    now_iso = datetime.now(timezone.utc).isoformat()
    wallet_operation_id = None
    
    if abs(difference) > 0.01:
        operation_type = "credit" if difference > 0 else "debit"
        adjustment_type = "addition" if difference > 0 else "deduction"
        
        # BUG-7 FIX: Generate operation_id and sequence_number (were missing on balance-verification ops)
        op_id = await generate_operation_id(db)
        seq = await get_next_operation_sequence(db, wallet["id"])
        wallet_op = WalletOperation(
            operation_id=op_id,
            wallet_id=wallet["id"],
            wallet_name=wallet["name"],
            wallet_type=wallet.get("wallet_type", ""),
            operation_type=operation_type,
            amount=abs(difference),
            balance_before=system_balance,
            balance_after=data.actual_balance,
            reference_type="balance_verification",
            notes=f"Balance verification adjustment: {adjustment_type}. {data.notes}".strip(),
            created_by=auth["user"]["id"],
            created_by_name=auth["user"]["name"]
        )
        wallet_op_doc = wallet_op.model_dump()
        wallet_op_doc['created_at'] = now_iso
        wallet_op_doc['updated_at'] = now_iso
        wallet_op_doc['sequence_number'] = seq
        
        await db.wallet_operations.insert_one(wallet_op_doc)
        wallet_operation_id = wallet_op.id
        
        # BUG-6 FIX: Use atomic $inc with the computed difference instead of $set
        # to avoid overwriting concurrent wallet updates
        await db.wallets.update_one(
            {"id": data.wallet_id},
            {"$inc": {"balance": difference}, "$set": {"updated_at": now_iso}}
        )
    
    # Determine adjustment type
    if abs(difference) > 0.01:
        if difference > 0:
            adjustment_type = "excess"
        else:
            adjustment_type = "shortage"
    else:
        adjustment_type = "none"
    
    verification = BalanceVerification(
        wallet_id=data.wallet_id,
        wallet_name=wallet["name"],
        wallet_type=wallet.get("wallet_type", ""),
        system_balance=system_balance,
        actual_balance=data.actual_balance,
        difference=difference,
        adjustment_type=adjustment_type,
        adjustment_applied=abs(difference) > 0.01,
        wallet_operation_id=wallet_operation_id,
        notes=data.notes,
        verified_by=auth["user"]["id"],
        verified_by_name=auth["user"]["name"]
    )
    
    doc = verification.model_dump()
    doc['created_at'] = now_iso
    doc['updated_at'] = now_iso
    await db.balance_verifications.insert_one(doc)
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "create", "balance_verifications", verification.id, {
        "wallet": wallet["name"],
        "system_balance": system_balance,
        "actual_balance": data.actual_balance,
        "adjusted": abs(difference) > 0.01
    }, ip=request.client.host if request.client else "")
    
    return {
        "verification": serialize_doc(doc),
        "adjustment_made": abs(difference) > 0.01,
        "adjustment_amount": abs(difference) if abs(difference) > 0.01 else 0
    }


@router.get("/balance-verifications/summary")
async def get_balance_verification_summary(auth: dict = Depends(auth_required)):
    """Get summary of balance verifications"""
    verifications = await db.balance_verifications.find({}, {"_id": 0}).to_list(1000)
    
    # BUG-8 FIX: Correct field name is 'adjustment_applied', not 'adjusted'
    total_adjustments = sum(abs(v.get("difference", 0)) for v in verifications if v.get("adjustment_applied"))
    adjustment_count = sum(1 for v in verifications if v.get("adjustment_applied"))
    
    by_wallet = {}
    for v in verifications:
        wallet_name = v.get("wallet_name", "Unknown")
        if wallet_name not in by_wallet:
            by_wallet[wallet_name] = {"count": 0, "adjustments": 0, "total_difference": 0}
        by_wallet[wallet_name]["count"] += 1
        if v.get("adjustment_applied"):
            by_wallet[wallet_name]["adjustments"] += 1
            by_wallet[wallet_name]["total_difference"] += abs(v.get("difference", 0))
    
    return {
        "total_verifications": len(verifications),
        "total_adjustments": adjustment_count,
        "total_adjustment_amount": total_adjustments,
        "by_wallet": by_wallet
    }


# ============== DATA INTEGRITY ENDPOINTS ==============

@router.get("/data-integrity/status")
async def get_data_integrity_status(auth: dict = Depends(auth_required)):
    """Get comprehensive data integrity status"""
    from utils import (
        verify_transaction_checksum, 
        check_operation_sequence_gaps,
        compare_balance_with_snapshot
    )
    
    status = {
        "overall_status": "healthy",
        "checks": {},
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    
    # 1. Check transaction checksums
    transactions = await db.transactions.find(
        {"is_deleted": False, "checksum": {"$exists": True}},
        {"_id": 0}
    ).to_list(1000)
    
    tampered_transactions = []
    for txn in transactions:
        if not verify_transaction_checksum(txn):
            tampered_transactions.append({
                "transaction_id": txn.get("transaction_id"),
                "id": txn.get("id")
            })
    
    status["checks"]["transaction_checksums"] = {
        "status": "healthy" if not tampered_transactions else "critical",
        "total_checked": len(transactions),
        "tampered_count": len(tampered_transactions),
        "tampered_transactions": tampered_transactions[:10]  # Limit to 10
    }
    
    # 2. Check operation sequences for all wallets
    wallets = await db.wallets.find({"is_deleted": False}, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    sequence_issues = []
    
    for wallet in wallets:
        gaps = await check_operation_sequence_gaps(db, wallet["id"])
        if gaps["has_gaps"]:
            sequence_issues.append({
                "wallet_id": wallet["id"],
                "wallet_name": wallet["name"],
                "gaps": gaps["gaps"][:5],  # Limit to 5 gaps
                "total_gaps": len(gaps["gaps"])
            })
    
    status["checks"]["operation_sequences"] = {
        "status": "healthy" if not sequence_issues else "warning",
        "wallets_checked": len(wallets),
        "wallets_with_gaps": len(sequence_issues),
        "issues": sequence_issues
    }
    
    # 3. Compare with latest snapshot
    snapshot_comparison = await compare_balance_with_snapshot(db)
    
    status["checks"]["balance_snapshot"] = {
        "status": "healthy" if not snapshot_comparison.get("has_discrepancies") else "warning",
        "snapshot_date": snapshot_comparison.get("snapshot_date"),
        "discrepancies_count": len(snapshot_comparison.get("discrepancies", [])),
        "discrepancies": snapshot_comparison.get("discrepancies", [])[:5]  # Limit to 5
    }
    
    # 4. Check for negative balances
    negative_wallets = await db.wallets.find(
        {"is_deleted": False, "balance": {"$lt": 0}},
        {"_id": 0, "id": 1, "name": 1, "balance": 1}
    ).to_list(100)
    
    status["checks"]["negative_balances"] = {
        "status": "healthy" if not negative_wallets else "critical",
        "count": len(negative_wallets),
        "wallets": negative_wallets
    }
    
    # 5. Check for gateways without wallets (orphan gateways)
    all_gateways = await db.gateways.find(
        {"is_deleted": False},
        {"_id": 0, "id": 1, "name": 1}
    ).to_list(100)
    
    gateway_wallets = await db.wallets.find(
        {"wallet_type": "gateway", "is_deleted": False},
        {"_id": 0, "gateway_id": 1}
    ).to_list(100)
    
    wallet_gateway_ids = {w.get("gateway_id") for w in gateway_wallets}
    orphan_gateways = [g for g in all_gateways if g.get("id") not in wallet_gateway_ids]
    
    status["checks"]["orphan_gateways"] = {
        "status": "healthy" if not orphan_gateways else "critical",
        "description": "Gateways without associated wallets",
        "count": len(orphan_gateways),
        "gateways": orphan_gateways
    }
    
    # 6. Check pending swipe transaction consistency
    # ISSUE-06 FIX: Batch fetch pay_sources instead of N+1 per-swipe query
    pending_swipe_issues = []
    # BUG-S3-04 FIX: remove hard cap of 1000 — use no limit
    pending_swipes = await db.transactions.find({
        "transaction_type": "type_02",
        "status": {"$in": ["pending_swipe", "partially_completed"]},
        "is_deleted": False
    }, {"_id": 0}).to_list(10000)
    
    if pending_swipes:
        txn_ids_batch = [txn["id"] for txn in pending_swipes]
        ps_batch_pipeline = [
            {"$match": {"transaction_id": {"$in": txn_ids_batch}, "status": {"$ne": "refunded"}}},
            {"$group": {
                "_id": "$transaction_id",
                "sources": {"$push": "$$ROOT"},
                "total": {"$sum": "$amount"},
                "count": {"$sum": 1}
            }}
        ]
        ps_batch_agg = await db.transaction_pay_sources.aggregate(ps_batch_pipeline).to_list(len(txn_ids_batch))
        pay_sources_by_txn = {r["_id"]: {"total": r["total"], "count": r["count"]} for r in ps_batch_agg}
    else:
        pay_sources_by_txn = {}
    
    for txn in pending_swipes:
        ps_data = pay_sources_by_txn.get(txn["id"], {"total": 0, "count": 0})
        sources_total = ps_data["total"]
        expected = txn.get("total_pay_to_card") or txn.get("pay_to_card_amount", 0)
        
        issues = []
        if abs(sources_total - expected) > 0.01:
            issues.append(f"pay_sources_total({sources_total}) != total_pay_to_card({expected})")
        
        total_swiped = txn.get("total_swiped", 0)
        pending_amount = txn.get("pending_swipe_amount", 0)
        if abs((expected - total_swiped) - pending_amount) > 0.01:
            issues.append(f"pending_amount({pending_amount}) != expected({expected - total_swiped})")
        
        if ps_data["count"] != txn.get("pay_sources_count", 0):
            issues.append(f"sources_count({ps_data['count']}) != pay_sources_count({txn.get('pay_sources_count', 0)})")
        
        if issues:
            pending_swipe_issues.append({
                "transaction_id": txn.get("transaction_id"),
                "issues": issues
            })
    
    status["checks"]["pending_swipe_consistency"] = {
        "status": "healthy" if not pending_swipe_issues else "warning",
        "description": "Type 02 pending swipe data consistency",
        "transactions_checked": len(pending_swipes),
        "issues_count": len(pending_swipe_issues),
        "issues": pending_swipe_issues[:10]
    }
    
    # Determine overall status
    critical_checks = [c for c in status["checks"].values() if c["status"] == "critical"]
    warning_checks = [c for c in status["checks"].values() if c["status"] == "warning"]
    
    if critical_checks:
        status["overall_status"] = "critical"
    elif warning_checks:
        status["overall_status"] = "warning"
    else:
        status["overall_status"] = "healthy"
    
    return status


@router.post("/data-integrity/create-snapshot")
async def create_snapshot(request: Request, auth: dict = Depends(auth_required)):
    """Manually create a balance snapshot"""
    await check_permission(auth, "reconciliation")
    
    from utils import create_balance_snapshot
    
    snapshot = await create_balance_snapshot(db, triggered_by=auth["user"]["name"])
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "create", "balance_snapshot", snapshot["id"], ip=request.client.host if request.client else "")
    
    return snapshot


@router.get("/data-integrity/snapshots")
async def get_snapshots(
    limit: int = Query(30, ge=1, le=100),
    auth: dict = Depends(auth_required)
):
    """Get balance snapshot history"""
    snapshots = await db.balance_snapshots.find(
        {}, {"_id": 0}
    ).sort("timestamp", -1).limit(limit).to_list(limit)
    
    return serialize_docs(snapshots)


@router.post("/data-integrity/verify-all-checksums")
async def verify_all_checksums(request: Request, auth: dict = Depends(auth_required)):
    """Verify checksums for all transactions"""
    if auth["role"]["name"] != "SuperAdmin":
        raise HTTPException(status_code=403, detail="Only SuperAdmin can run this check")
    
    from utils import verify_transaction_checksum
    
    # GAP-4 FIX: Stream transactions in batches instead of loading all into memory
    results = {
        "total": 0,
        "with_checksum": 0,
        "without_checksum": 0,
        "valid": 0,
        "tampered": 0,
        "tampered_list": []
    }
    
    cursor = db.transactions.find({"is_deleted": False}, {"_id": 0})
    async for txn in cursor:
        results["total"] += 1
        if txn.get("checksum"):
            results["with_checksum"] += 1
            if verify_transaction_checksum(txn):
                results["valid"] += 1
            else:
                results["tampered"] += 1
                results["tampered_list"].append({
                    "transaction_id": txn.get("transaction_id"),
                    "id": txn.get("id"),
                    "amount": txn.get("amount") or txn.get("swipe_amount")
                })
        else:
            results["without_checksum"] += 1
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "verify_checksums", "data_integrity", details={
        "total": results["total"],
        "tampered": results["tampered"]
    }, ip=request.client.host if request.client else "")
    
    return results


@router.post("/data-integrity/add-missing-checksums")
async def add_missing_checksums(request: Request, auth: dict = Depends(auth_required)):
    """Add or regenerate checksums for transactions"""
    if auth["role"]["name"] != "SuperAdmin":
        raise HTTPException(status_code=403, detail="Only SuperAdmin can run this operation")

    from utils import generate_transaction_checksum
    from pymongo import UpdateOne

    # GAP-4 FIX: Stream in batches and bulk-write in chunks to avoid OOM
    CHUNK_SIZE = 500
    updated = 0
    bulk_ops = []

    cursor = db.transactions.find({"is_deleted": False}, {"_id": 0})
    async for txn in cursor:
        bulk_ops.append(
            UpdateOne({"id": txn["id"]}, {"$set": {"checksum": generate_transaction_checksum(txn)}})
        )
        if len(bulk_ops) >= CHUNK_SIZE:
            result = await db.transactions.bulk_write(bulk_ops, ordered=False)
            updated += result.modified_count + result.upserted_count
            bulk_ops = []

    if bulk_ops:
        result = await db.transactions.bulk_write(bulk_ops, ordered=False)
        updated += result.modified_count + result.upserted_count

    await log_audit(auth["user"]["id"], auth["user"]["name"], "add_checksums", "data_integrity", details={
        "updated": updated
    }, ip=request.client.host if request.client else "")

    return {"message": f"Regenerated checksums for {updated} transactions", "updated": updated}
