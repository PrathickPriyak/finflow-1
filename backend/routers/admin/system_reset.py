"""
Admin System Reset Router - Data reset and migration endpoints
Extracted from admin.py for ARCH-10
"""
from fastapi import APIRouter, HTTPException, Depends, Request
from datetime import datetime, timezone
from pydantic import BaseModel
import logging
import os

from core.database import db
from core.dependencies import auth_required, log_audit, check_permission

router = APIRouter(tags=["Admin"])
logger = logging.getLogger(__name__)


# ============== DATA MIGRATION ==============

@router.get("/admin/migration-status")
async def get_migration_status(auth: dict = Depends(auth_required)):
    """Get status of ID migration for all entities"""
    await check_permission(auth, "system-reset")
    
    # Count records with and without human-readable IDs
    customers_total = await db.customers.count_documents({"is_deleted": False})
    customers_with_id = await db.customers.count_documents({"is_deleted": False, "customer_id": {"$exists": True, "$ne": None}})
    
    transactions_total = await db.transactions.count_documents({"is_deleted": False})
    transactions_with_id = await db.transactions.count_documents({"is_deleted": False, "transaction_id": {"$exists": True, "$ne": None}})
    
    operations_total = await db.wallet_operations.count_documents({})
    operations_with_id = await db.wallet_operations.count_documents({"operation_id": {"$exists": True, "$ne": None}})
    
    return {
        "customers": {
            "total": customers_total,
            "migrated": customers_with_id,
            "pending": customers_total - customers_with_id,
            "complete": customers_total == customers_with_id
        },
        "transactions": {
            "total": transactions_total,
            "migrated": transactions_with_id,
            "pending": transactions_total - transactions_with_id,
            "complete": transactions_total == transactions_with_id
        },
        "wallet_operations": {
            "total": operations_total,
            "migrated": operations_with_id,
            "pending": operations_total - operations_with_id,
            "complete": operations_total == operations_with_id
        },
        "all_complete": (
            customers_total == customers_with_id and
            transactions_total == transactions_with_id and
            operations_total == operations_with_id
        )
    }


@router.post("/admin/migrate-ids")
async def migrate_ids(request: Request, auth: dict = Depends(auth_required)):
    """Migrate existing records to use human-readable IDs"""
    await check_permission(auth, "system-reset")
    
    results = {
        "customers": {"migrated": 0, "errors": 0},
        "transactions": {"migrated": 0, "errors": 0},
        "wallet_operations": {"migrated": 0, "errors": 0}
    }
    
    # Migrate customers without customer_id
    customers = await db.customers.find({
        "is_deleted": False,
        "$or": [{"customer_id": {"$exists": False}}, {"customer_id": None}]
    }, {"_id": 0}).to_list(1000)
    
    for customer in customers:
        try:
            # Get next customer ID
            counter = await db.counters.find_one_and_update(
                {"_id": "customer_id"},
                {"$inc": {"seq": 1}},
                upsert=True,
                return_document=True
            )
            customer_id = f"C{str(counter['seq']).zfill(3)}"
            
            await db.customers.update_one(
                {"id": customer["id"]},
                {"$set": {"customer_id": customer_id}}
            )
            results["customers"]["migrated"] += 1
        except Exception as e:
            logger.error(f"Failed to migrate customer {customer.get('id')}: {e}")
            results["customers"]["errors"] += 1
    
    # Migrate transactions without transaction_id
    transactions = await db.transactions.find({
        "is_deleted": False,
        "$or": [{"transaction_id": {"$exists": False}}, {"transaction_id": None}]
    }, {"_id": 0}).to_list(1000)
    
    for txn in transactions:
        try:
            txn_type = txn.get("type", "type_01")
            if txn_type == "type_01":
                prefix = "T1"
                counter_id = "transaction_type01"
            elif txn_type == "type_02":
                prefix = "T2"
                counter_id = "transaction_type02"
            else:
                prefix = "TRF"
                counter_id = "transaction_transfer"
            
            counter = await db.counters.find_one_and_update(
                {"_id": counter_id},
                {"$inc": {"seq": 1}},
                upsert=True,
                return_document=True
            )
            transaction_id = f"{prefix}-{str(counter['seq']).zfill(4)}"
            
            await db.transactions.update_one(
                {"id": txn["id"]},
                {"$set": {"transaction_id": transaction_id}}
            )
            results["transactions"]["migrated"] += 1
        except Exception as e:
            logger.error(f"Failed to migrate transaction {txn.get('id')}: {e}")
            results["transactions"]["errors"] += 1
    
    # Migrate wallet operations without operation_id
    operations = await db.wallet_operations.find({
        "$or": [{"operation_id": {"$exists": False}}, {"operation_id": None}]
    }, {"_id": 0}).to_list(1000)
    
    for op in operations:
        try:
            counter = await db.counters.find_one_and_update(
                {"_id": "wallet_operation"},
                {"$inc": {"seq": 1}},
                upsert=True,
                return_document=True
            )
            operation_id = f"OP-{str(counter['seq']).zfill(4)}"
            
            await db.wallet_operations.update_one(
                {"id": op["id"]},
                {"$set": {"operation_id": operation_id}}
            )
            results["wallet_operations"]["migrated"] += 1
        except Exception as e:
            logger.error(f"Failed to migrate operation {op.get('id')}: {e}")
            results["wallet_operations"]["errors"] += 1
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "migrate_ids", "admin", details=results, ip=request.client.host if request.client else "")
    
    return {
        "message": "Migration completed",
        "results": results,
        "total_migrated": sum(r["migrated"] for r in results.values()),
        "total_errors": sum(r["errors"] for r in results.values())
    }


# ============== SYSTEM RESET ==============

class ResetOptions(BaseModel):
    """Options for selective data reset"""
    # Preset mode (optional - overrides individual options)
    preset: str = ""  # "fresh_start", "financials", "master_data", or "" for custom
    
    # Financial Data
    transactions: bool = False
    wallet_operations: bool = False
    collections: bool = False
    expenses: bool = False
    reset_wallet_balances: bool = False  # Reset all wallet balances to 0 (keeps wallets)
    
    # Master Data
    customers: bool = False
    gateways: bool = False  # Also deletes gateway wallets
    wallets: bool = False  # All wallets (bank + cash)
    gateway_servers: bool = False
    banks: bool = False
    card_networks: bool = False
    expense_types: bool = False
    
    # Reports & Logs
    audit_logs: bool = False
    reconciliation_reports: bool = False
    daily_closings: bool = False
    security_logs: bool = False  # Rate limit data (login attempts, blocked IPs)
    
    # Advanced (rarely used)
    balance_snapshots: bool = False
    balance_verifications: bool = False
    id_counters: bool = False
    users: bool = False  # Except admin
    roles: bool = False  # Except SuperAdmin
    settings: bool = False
    sessions: bool = False
    
    # Confirmation
    confirmation: str = ""  # Must be "RESET"


# Define preset configurations
RESET_PRESETS = {
    "fresh_start": {
        "description": "Complete reset - delete ALL data except admin user",
        "options": [
            "transactions", "wallet_operations", "collections", "expenses",
            "reset_wallet_balances",
            "customers", "gateways", "wallets", "gateway_servers", "banks", 
            "card_networks", "expense_types",
            "audit_logs", "reconciliation_reports", "daily_closings", "security_logs",
            "balance_snapshots", "balance_verifications", "id_counters",
            "users", "roles", "settings", "sessions"
        ]
    },
    "financials": {
        "description": "Reset financial data only - keeps master data for reference",
        "options": [
            "transactions", "wallet_operations", "collections", "expenses",
            "reset_wallet_balances",
            "reconciliation_reports", "daily_closings", "id_counters"
        ]
    },
    "master_data": {
        "description": "Reset master data - customers, gateways, wallets",
        "options": [
            "customers", "gateways", "wallets", "gateway_servers", "banks",
            "card_networks", "expense_types"
        ]
    }
}

# Define smart dependencies - if key is selected, values are auto-selected
RESET_DEPENDENCIES = {
    "customers": ["transactions", "collections"],  # Transactions reference customers
    "gateways": ["gateway_servers", "transactions"],  # Servers belong to gateways
    "wallets": ["wallet_operations"],  # Operations reference wallets
    "transactions": ["collections", "wallet_operations"],  # Related financial data
}


def apply_preset(options: ResetOptions) -> ResetOptions:
    """Apply preset configuration to options"""
    if options.preset and options.preset in RESET_PRESETS:
        preset_options = RESET_PRESETS[options.preset]["options"]
        for opt in preset_options:
            setattr(options, opt, True)
    return options


def apply_dependencies(options: ResetOptions) -> tuple[ResetOptions, list[str]]:
    """Apply smart dependencies and return list of auto-added options"""
    auto_added = []
    options_dict = options.model_dump()
    
    for key, deps in RESET_DEPENDENCIES.items():
        if options_dict.get(key, False):
            for dep in deps:
                if not options_dict.get(dep, False):
                    setattr(options, dep, True)
                    auto_added.append(dep)
    
    return options, auto_added


@router.get("/admin/reset-presets")
async def get_reset_presets(auth: dict = Depends(auth_required)):
    """Get available reset presets with descriptions"""
    await check_permission(auth, "system-reset")
    
    return {
        "presets": RESET_PRESETS,
        "dependencies": RESET_DEPENDENCIES
    }


@router.post("/admin/reset")
async def reset_data(options: ResetOptions, request: Request, auth: dict = Depends(auth_required)):
    """
    Selectively reset application data.
    SuperAdmin only. Requires typing 'RESET' as confirmation.
    Supports presets and smart dependencies.
    """
    # SEC-04 FIX: Gate behind DEV_MODE
    from auth import is_dev_mode
    if not is_dev_mode():
        raise HTTPException(status_code=403, detail="System reset is disabled in production mode")
    
    # Permission check
    await check_permission(auth, "system-reset")
    
    # Confirmation check
    if options.confirmation != "RESET":
        raise HTTPException(status_code=400, detail="Please type 'RESET' to confirm")
    
    # Apply preset if specified
    options = apply_preset(options)
    
    # Apply smart dependencies
    options, auto_added = apply_dependencies(options)
    
    results = {}
    if auto_added:
        results["auto_added_dependencies"] = auto_added
    
    try:
        # Financial Data
        if options.transactions:
            result = await db.transactions.delete_many({"is_deleted": {"$exists": True}})
            results["transactions"] = result.deleted_count
            logger.info(f"Reset: Deleted {result.deleted_count} transactions")
        
        if options.wallet_operations:
            result = await db.wallet_operations.delete_many({})
            results["wallet_operations"] = result.deleted_count
            logger.info(f"Reset: Deleted {result.deleted_count} wallet operations")
        
        if options.collections:
            result = await db.collections.delete_many({})
            results["collections"] = result.deleted_count
            # Also clear payments collection
            try:
                result2 = await db.payments.delete_many({})
                results["payments"] = result2.deleted_count
            except Exception as e:
                # ARCH-09: Collection may not exist, log at debug level
                logger.debug(f"payments collection cleanup skipped: {e}")
            logger.info(f"Reset: Deleted {result.deleted_count} collections")
        
        if options.expenses:
            result = await db.expenses.delete_many({"is_deleted": {"$exists": True}})
            results["expenses"] = result.deleted_count
            logger.info(f"Reset: Deleted {result.deleted_count} expenses")
        
        if options.reset_wallet_balances:
            # Reset all wallet balances to 0 (keeps the wallets, just zeros out balances)
            result = await db.wallets.update_many(
                {},
                {"$set": {"balance": 0}}
            )
            results["wallet_balances_reset"] = result.modified_count
            logger.info(f"Reset: Reset {result.modified_count} wallet balances to 0")
        
        # Master Data
        if options.customers:
            # Delete customers (cards are embedded in customer documents, not separate collection)
            result = await db.customers.delete_many({})
            results["customers"] = result.deleted_count
            logger.info(f"Reset: Deleted {result.deleted_count} customers")
        
        if options.gateways:
            # Delete gateways and their wallets
            result = await db.gateways.delete_many({})
            results["gateways"] = result.deleted_count
            # Delete gateway wallets
            result2 = await db.wallets.delete_many({"wallet_type": "gateway"})
            results["gateway_wallets"] = result2.deleted_count
            logger.info(f"Reset: Deleted {result.deleted_count} gateways and {result2.deleted_count} gateway wallets")
        
        if options.wallets:
            # Delete all non-gateway wallets (bank + cash)
            result = await db.wallets.delete_many({"wallet_type": {"$in": ["bank", "cash"]}})
            results["wallets"] = result.deleted_count
            logger.info(f"Reset: Deleted {result.deleted_count} wallets (bank + cash)")
        
        if options.banks:
            result = await db.banks.delete_many({})
            results["banks"] = result.deleted_count
            logger.info(f"Reset: Deleted {result.deleted_count} banks")
        
        if options.card_networks:
            result = await db.card_networks.delete_many({})
            results["card_networks"] = result.deleted_count
            logger.info(f"Reset: Deleted {result.deleted_count} card networks")
        
        if options.gateway_servers:
            result = await db.gateway_servers.delete_many({})
            results["gateway_servers"] = result.deleted_count
            logger.info(f"Reset: Deleted {result.deleted_count} gateway servers")
        
        if options.expense_types:
            result = await db.expense_types.delete_many({})
            results["expense_types"] = result.deleted_count
            logger.info(f"Reset: Deleted {result.deleted_count} expense types")
        
        # Reports & Logs
        if options.audit_logs:
            result = await db.audit_logs.delete_many({})
            results["audit_logs"] = result.deleted_count
            logger.info(f"Reset: Deleted {result.deleted_count} audit logs")
        
        if options.reconciliation_reports:
            result = await db.reconciliation_reports.delete_many({})
            results["reconciliation_reports"] = result.deleted_count
            logger.info(f"Reset: Deleted {result.deleted_count} reconciliation reports")
        
        if options.daily_closings:
            result = await db.daily_closings.delete_many({})
            results["daily_closings"] = result.deleted_count
            logger.info(f"Reset: Deleted {result.deleted_count} daily closings")
        
        if options.security_logs:
            # Clear login attempts (rate limit tracking)
            result = await db.login_attempts.delete_many({})
            results["login_attempts"] = result.deleted_count
            # Clear OTP rate limits
            result2 = await db.rate_limits.delete_many({})
            results["rate_limits"] = result2.deleted_count
            logger.info(f"Reset: Deleted {result.deleted_count} login attempts and {result2.deleted_count} OTP rate limits")
        
        if options.balance_snapshots:
            result = await db.balance_snapshots.delete_many({})
            results["balance_snapshots"] = result.deleted_count
            logger.info(f"Reset: Deleted {result.deleted_count} balance snapshots")
        
        if options.balance_verifications:
            result = await db.balance_verifications.delete_many({})
            results["balance_verifications"] = result.deleted_count
            logger.info(f"Reset: Deleted {result.deleted_count} balance verifications")
        
        # System
        if options.id_counters:
            # Reset all counters to 1
            counter_ids = [
                "customer_id", "transaction_id_type_01", "transaction_id_type_02",
                "transaction_id_transfer", "operation_id", "expense_id", "pending_payment_id"
            ]
            for counter_id in counter_ids:
                await db.counters.update_one(
                    {"_id": counter_id},
                    {"$set": {"seq": 0}},
                    upsert=True
                )
            # Also reset wallet operation sequence counters
            await db.counters.delete_many({"_id": {"$regex": "^wallet_op_seq_"}})
            results["id_counters_reset"] = len(counter_ids)
            logger.info(f"Reset: Reset {len(counter_ids)} ID counters to 0")
        
        if options.users:
            # Delete all users except the user performing the reset
            result = await db.users.delete_many({
                "id": {"$ne": auth["user"]["id"]}
            })
            results["users"] = result.deleted_count
            logger.info(f"Reset: Deleted {result.deleted_count} users (kept {auth['user']['email']})")
        
        if options.roles:
            # Delete all roles except SuperAdmin
            result = await db.roles.delete_many({
                "name": {"$ne": "SuperAdmin"}
            })
            results["roles"] = result.deleted_count
            logger.info(f"Reset: Deleted {result.deleted_count} roles (kept SuperAdmin)")
        
        if options.settings:
            # Reset settings to defaults
            from models import Settings
            default_settings = Settings()
            await db.settings.update_one(
                {"id": "app_settings"},
                {"$set": default_settings.model_dump()},
                upsert=True
            )
            results["settings_reset"] = True
            logger.info("Reset: Settings reset to defaults")
        
        if options.sessions:
            # Clear OTP sessions and any session data
            try:
                result = await db.otp_sessions.delete_many({})
                results["otp_sessions"] = result.deleted_count
            except Exception as e:
                logger.debug(f"otp_sessions collection cleanup skipped: {e}")
            try:
                result = await db.sessions.delete_many({})
                results["sessions"] = result.deleted_count
            except Exception as e:
                # ARCH-09: Collection may not exist
                logger.debug(f"sessions collection cleanup skipped: {e}")
            logger.info("Reset: Cleared sessions and OTPs")
        
        # Log the reset action (if audit logs weren't cleared)
        if not options.audit_logs:
            await log_audit(
                auth["user"]["id"], 
                auth["user"]["name"], 
                "system_reset", 
                "admin",
                details={
                    "options": options.model_dump(),
                    "results": results
                },
                ip=request.client.host if request.client else ""
            )
        
        return {
            "success": True,
            "message": "Data reset completed successfully",
            "results": results,
            "reset_by": auth["user"]["name"],
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
    except Exception as e:
        logger.error(f"Reset failed: {e}")
        raise HTTPException(status_code=500, detail=f"Reset failed: {str(e)}")


@router.get("/admin/reset-preview")
async def preview_reset(auth: dict = Depends(auth_required)):
    """
    Preview what data would be affected by reset options.
    Returns counts for each data type plus dependency warnings.
    """
    await check_permission(auth, "system-reset")
    
    counts = {}
    
    # Financial Data
    counts["transactions"] = await db.transactions.count_documents({"is_deleted": {"$exists": True}})
    counts["wallet_operations"] = await db.wallet_operations.count_documents({})
    counts["collections"] = await db.collections.count_documents({})
    counts["expenses"] = await db.expenses.count_documents({"is_deleted": {"$exists": True}})
    
    # Master Data
    counts["customers"] = await db.customers.count_documents({})
    counts["gateways"] = await db.gateways.count_documents({})
    counts["gateway_wallets"] = await db.wallets.count_documents({"wallet_type": "gateway"})
    counts["wallets"] = await db.wallets.count_documents({"wallet_type": {"$in": ["bank", "cash"]}})
    counts["banks"] = await db.banks.count_documents({})
    counts["card_networks"] = await db.card_networks.count_documents({})
    counts["gateway_servers"] = await db.gateway_servers.count_documents({})
    counts["expense_types"] = await db.expense_types.count_documents({})
    
    # Reports & Logs
    counts["audit_logs"] = await db.audit_logs.count_documents({})
    counts["reconciliation_reports"] = await db.reconciliation_reports.count_documents({})
    counts["daily_closings"] = await db.daily_closings.count_documents({})
    counts["security_logs"] = await db.login_attempts.count_documents({}) + await db.rate_limits.count_documents({})
    
    # Advanced
    counts["balance_snapshots"] = await db.balance_snapshots.count_documents({})
    counts["balance_verifications"] = await db.balance_verifications.count_documents({})
    counts["users"] = await db.users.count_documents({"id": {"$ne": auth["user"]["id"]}})
    counts["roles"] = await db.roles.count_documents({"name": {"$ne": "SuperAdmin"}})
    
    # Calculate totals
    total_balance = 0
    wallets = await db.wallets.find({"is_deleted": False}, {"balance": 1, "_id": 0}).to_list(500)
    for w in wallets:
        total_balance += w.get("balance", 0)
    counts["total_wallet_balance"] = total_balance
    
    # Generate dependency warnings
    warnings = []
    if counts["customers"] > 0 and counts["transactions"] > 0:
        warnings.append({
            "trigger": "customers",
            "message": f"Deleting customers will also delete {counts['transactions']} transactions (they reference customers)"
        })
    if counts["gateways"] > 0 and counts["gateway_servers"] > 0:
        warnings.append({
            "trigger": "gateways", 
            "message": f"Deleting gateways will also delete {counts['gateway_servers']} gateway servers"
        })
    if counts["wallets"] > 0 and counts["wallet_operations"] > 0:
        warnings.append({
            "trigger": "wallets",
            "message": f"Deleting wallets will also delete {counts['wallet_operations']} wallet operations"
        })
    
    counts["warnings"] = warnings
    counts["presets"] = RESET_PRESETS
    counts["dependencies"] = RESET_DEPENDENCIES
    
    return counts
