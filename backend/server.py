"""
Fin Flow - Main Server
Credit Card Swiping Business Management Application
Refactored to use modular routers
"""
from fastapi import FastAPI, APIRouter, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
import os
import asyncio
from uuid import uuid4

# Core imports
from core.database import db, client, scheduler
from core.dependencies import get_settings
from core.logging_config import setup_logging, get_logger

# Router imports
from routers import (
    auth_router,
    users_router,
    gateways_router,
    banks_router,
    customers_router,
    transactions_router,
    payments_router,
    wallets_router,
    expenses_router,
    dashboard_router,
    admin_router,
    reconciliation_router,
    smtp_router,
    adjustments_router,
)

# Models for initialization
from models import Role, Settings, ExpenseType

# Auth
from auth import is_dev_mode

# PROD-07: Configure structured JSON logging
# Set LOG_FORMAT=text in .env for human-readable logs during development
setup_logging(
    json_format=os.environ.get("LOG_FORMAT", "json").lower() == "json",
    log_level=os.environ.get("LOG_LEVEL", "INFO")
)
logger = get_logger(__name__)


# ============== DATABASE INITIALIZATION ==============

async def init_database():
    """Initialize database with indexes and default data"""
    try:
        # Create indexes - using try/except for each to handle conflicts gracefully
        index_configs = [
            ("users", "id", True),
            ("users", "email", True),
            ("roles", "id", True),
            ("modules", "id", True),
            ("gateways", "id", True),
            ("gateway_servers", "id", True),
            ("banks", "id", True),
            ("card_networks", "id", True),
            ("customers", "id", True),
            ("customers", "phone", False),
            ("transactions", "id", True),
            ("transactions", "customer_id", False),
            ("collections", "id", True),
            ("collections", "transaction_id", False),
            ("collections", "customer_id", False),
            ("collections", "source", False),
            ("collections", "status", False),
            ("payments", "id", True),
            ("adjustments", "id", True),
            ("adjustments", "customer_id", False),
            ("wallets", "id", True),
            ("wallet_operations", "id", True),
            ("wallet_operations", "wallet_id", False),
            ("sessions", "token", False),
            ("sessions", "user_id", False),
            ("otp_sessions", "email", True),
            ("settings", "id", True),
            ("expenses", "id", True),
            ("expense_types", "id", True),
            ("balance_verifications", "id", True),
            ("daily_closings", "date", True),
            ("bank_payment_types", "id", True),
            ("transaction_pay_sources", "id", True),
            ("transaction_pay_sources", "transaction_id", False),
            ("transaction_pay_sources", "gateway_id", False),
        ]
        
        for collection, field, unique in index_configs:
            try:
                await db[collection].create_index(field, unique=unique)
            except Exception as e:
                # ARCH-09: Log instead of silently ignoring (index may already exist)
                logger.debug(f"Index creation skipped for {collection}.{field}: {e}")
        
        # SEC-05 FIX: TTL indexes for auto-cleanup
        ttl_configs = [
            ("sessions", "expires_at"),
            ("otp_sessions", "expires_at"),
            ("rate_limits", "expires_at"),
        ]
        
        for collection, field in ttl_configs:
            try:
                await db[collection].create_index(field, expireAfterSeconds=0)
            except Exception as e:
                # ARCH-09: Log instead of silently ignoring (TTL index may already exist)
                logger.debug(f"TTL index creation skipped for {collection}.{field}: {e}")
        
        # Compound indexes
        try:
            await db.transactions.create_index([("created_at", -1)])
        except Exception as e:
            logger.debug(f"Index creation skipped for transactions.created_at: {e}")
        try:
            await db.transactions.create_index([("status", 1), ("transaction_type", 1)])
        except Exception as e:
            logger.debug(f"Index creation skipped for transactions.status+type: {e}")
        try:
            await db.wallet_operations.create_index([("created_at", -1)])
        except Exception as e:
            logger.debug(f"Index creation skipped for wallet_operations.created_at: {e}")
        try:
            await db.audit_logs.create_index([("timestamp", -1)])
        except Exception as e:
            logger.debug(f"Index creation skipped for audit_logs.timestamp: {e}")
        try:
            await db.reconciliation_reports.create_index([("timestamp", -1)])
        except Exception as e:
            logger.debug(f"Index creation skipped for reconciliation_reports.timestamp: {e}")
        
        # Create default SuperAdmin role if not exists (admin user created by migrate.py)
        admin_role = await db.roles.find_one({"name": "SuperAdmin"}, {"_id": 0})
        if not admin_role:
            role = Role(name="SuperAdmin", description="Full system access", permissions=[])
            doc = role.model_dump()
            doc['created_at'] = doc['created_at'].isoformat()
            doc['updated_at'] = doc['updated_at'].isoformat()
            await db.roles.insert_one(doc)
            logger.info("Created SuperAdmin role")
        
        # ARCH-06 FIX: Use consistent kebab-case naming for modules (matching migrate.py)
        # Note: Only creates modules that don't exist - uses upsert to avoid duplicates
        default_modules = [
            ("dashboard", "Dashboard", "layout-dashboard", "/dashboard", 1),
            ("transactions", "Transactions", "arrow-left-right", "/transactions", 2),
            ("customers", "Customers", "users", "/customers", 3),
            ("collections", "Collections", "clock", "/collections", 4),
            ("payments", "Payments", "banknote", "/payments", 5),
            ("adjustments", "Adjustments", "arrow-left-right", "/adjustments", 8),
            ("pg-and-servers", "PG & Servers", "server", "/pg-and-servers", 6),
            ("banks-and-cards", "Banks & Cards", "credit-card", "/banks-and-cards", 7),
            ("users", "Users", "user-cog", "/users", 9),
            ("roles", "Roles", "shield", "/roles", 10),
            ("wallets", "Wallets", "wallet", "/wallets", 11),
            ("settings", "Settings", "settings", "/settings", 12),
            ("audit-log", "Audit Log", "scroll-text", "/audit-log", 13),
            ("daily-closing", "Daily Closing", "calendar-check", "/daily-closing", 14),
            ("expense-types", "Expense Types", "tags", "/expense-types", 15),
            ("expenses", "Expenses", "receipt", "/expenses", 16),
            ("reconciliation", "Reconciliation", "shield-check", "/reconciliation", 17),
            ("data-integrity", "Data Integrity", "shield-alert", "/data-integrity", 18),
            ("system-reset", "System Reset", "trash-2", "/system-reset", 19),
            ("balance-verification", "Balance Verification", "scale", "/balance-verification", 20),
            ("downloads", "Downloads", "download", "/downloads", 21),
            ("reports", "Reports", "bar-chart-3", "/reports", 22),
        ]
        
        for name, display_name, icon, route, order in default_modules:
            # Use upsert to avoid duplicates
            await db.modules.update_one(
                {"name": name},
                {"$setOnInsert": {
                    "id": str(__import__('uuid').uuid4()),
                    "name": name,
                    "display_name": display_name,
                    "icon": icon,
                    "route": route,
                    "order": order,
                    "is_deleted": False,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat()
                }},
                upsert=True
            )
        
        # Create default settings
        settings = await db.settings.find_one({"id": "app_settings"}, {"_id": 0})
        if not settings:
            default_settings = Settings()
            doc = default_settings.model_dump()
            await db.settings.insert_one(doc)
            logger.info("Created default settings")
        else:
            # Migrate: add new fields with defaults if missing
            updates = {}
            if "default_commission_percentage" not in settings:
                updates["default_commission_percentage"] = 1.0
            if "min_outstanding_threshold" not in settings:
                updates["min_outstanding_threshold"] = 50.0
            if updates:
                await db.settings.update_one({"id": "app_settings"}, {"$set": updates})
                logger.info(f"Migrated settings with new fields: {list(updates.keys())}")
        
        # Create virtual Adjustments wallet (idempotent) — used by /adjustments
        # Stays at zero balance; every adjustment credits + debits the same amount.
        existing_virtual = await db.wallets.find_one(
            {"name": "Adjustments", "wallet_type": "virtual", "is_deleted": False}, {"_id": 0}
        )
        if not existing_virtual:
            now_iso = datetime.now(timezone.utc).isoformat()
            await db.wallets.insert_one({
                "id": str(__import__('uuid').uuid4()),
                "name": "Adjustments",
                "wallet_type": "virtual",
                "description": "Virtual wallet for customer balance set-off / adjustments. Stays at zero by design.",
                "balance": 0.0,
                "is_active": True,
                "is_system": True,
                "is_deleted": False,
                "created_at": now_iso,
                "updated_at": now_iso,
            })
            logger.info("Created virtual Adjustments wallet")
        
        # Create default expense types
        default_expense_types = ["PG Charges", "Salary", "Office Expenses", "Personal Expenses", "Charge Write-Off"]
        system_expense_types = {"PG Charges", "Charge Write-Off"}
        for name in default_expense_types:
            existing = await db.expense_types.find_one({"name": name, "is_deleted": False}, {"_id": 0})
            if not existing:
                expense_type = ExpenseType(name=name, is_system=(name in system_expense_types))
                doc = expense_type.model_dump()
                doc['created_at'] = doc['created_at'].isoformat()
                doc['updated_at'] = doc['updated_at'].isoformat()
                await db.expense_types.insert_one(doc)
        
        # Sync ID counters to prevent duplicate key errors
        from utils import sync_id_counters
        await sync_id_counters(db)
        
        logger.info("Database initialized successfully")
        
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        raise


# ============== SCHEDULED TASKS ==============

async def _log_system_alert(task_name: str, error: str):
    """Store alert for failed scheduled tasks — visible in health-score"""
    try:
        await db.system_alerts.insert_one({
            "id": str(uuid4()),
            "type": "scheduled_task_failure",
            "task": task_name,
            "error": str(error)[:500],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "resolved": False
        })
    except Exception:
        pass  # Last resort — already logged via logger


async def auto_lock_old_transactions():
    """Background task to auto-lock old transactions"""
    for attempt in range(2):
        try:
            settings = await get_settings()
            lock_hours = settings.get("transaction_lock_hours", 24)
            cutoff_time = datetime.now(timezone.utc) - timedelta(hours=lock_hours)
            cutoff_str = cutoff_time.isoformat()
            
            result = await db.transactions.update_many(
                {"is_deleted": False, "is_locked": False, "created_at": {"$lt": cutoff_str}},
                {"$set": {"is_locked": True, "locked_at": datetime.now(timezone.utc).isoformat()}}
            )
            
            if result.modified_count > 0:
                logger.info(f"Auto-locked {result.modified_count} old transactions")
            return
        except Exception as e:
            if attempt == 0:
                logger.warning(f"Auto-lock failed (attempt 1), retrying in 10s: {e}")
                await asyncio.sleep(10)
            else:
                logger.critical(f"Auto-lock failed after retry: {e}")
                await _log_system_alert("auto_lock_old_transactions", e)


async def auto_daily_closing():
    """Auto daily closing job"""
    for attempt in range(2):
        try:
            from models import DailyClosing
            
            yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
            next_day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            
            existing = await db.daily_closings.find_one({"date": yesterday, "is_deleted": False}, {"_id": 0})
            if existing:
                return
            
            txn_match = {
                "is_deleted": False,
                "created_at": {"$gte": f"{yesterday}T00:00:00", "$lt": f"{next_day}T00:00:00"}
            }
            txn_agg = await db.transactions.aggregate([
                {"$match": txn_match},
                {"$group": {
                    "_id": None,
                    "count": {"$sum": 1},
                    "swipe_amount": {"$sum": {"$ifNull": ["$swipe_amount", 0]}},
                    "gateway_charges": {"$sum": {"$ifNull": ["$gateway_charge_amount", 0]}},
                    "commission": {"$sum": {"$ifNull": ["$commission_amount", 0]}},
                    "pending_created": {"$sum": {"$ifNull": ["$pending_amount", 0]}},
                }}
            ]).to_list(1)
            t = txn_agg[0] if txn_agg else {}
            
            closing = DailyClosing(
                date=yesterday,
                total_transactions=t.get("count", 0),
                total_swipe_amount=t.get("swipe_amount", 0),
                total_gateway_charges=t.get("gateway_charges", 0),
                total_commission=t.get("commission", 0),
                total_profit=t.get("commission", 0),
                total_pending_created=t.get("pending_created", 0),
                total_pending_settled=0,
                gateway_wise_summary={},
                wallet_snapshots=[],
                closed_by="system",
                closed_by_name="Auto Close",
                is_auto_closed=True,
                notes="Auto-generated daily closing"
            )
            
            doc = closing.model_dump()
            doc['created_at'] = doc['created_at'].isoformat()
            doc['updated_at'] = doc['updated_at'].isoformat()
            await db.daily_closings.insert_one(doc)
            
            logger.info(f"Auto daily closing completed for {yesterday}")
            return
        except Exception as e:
            if attempt == 0:
                logger.warning(f"Auto daily closing failed (attempt 1), retrying in 10s: {e}")
                await asyncio.sleep(10)
            else:
                logger.critical(f"Auto daily closing failed after retry: {e}")
                await _log_system_alert("auto_daily_closing", e)


async def auto_balance_snapshot():
    """Create daily balance snapshot for all wallets"""
    for attempt in range(2):
        try:
            from utils import create_balance_snapshot
            
            snapshot = await create_balance_snapshot(db, triggered_by="scheduled")
            logger.info(f"Daily balance snapshot created: {snapshot['id']}")
            return
        except Exception as e:
            if attempt == 0:
                logger.warning(f"Auto balance snapshot failed (attempt 1), retrying in 10s: {e}")
                await asyncio.sleep(10)
            else:
                logger.critical(f"Auto balance snapshot failed after retry: {e}")
                await _log_system_alert("auto_balance_snapshot", e)


def setup_scheduler():
    """Setup background job scheduler"""
    try:
        # Auto-lock old transactions every hour
        scheduler.add_job(auto_lock_old_transactions, 'interval', hours=1, id='auto_lock_transactions', replace_existing=True)
        
        # Auto daily closing at midnight
        scheduler.add_job(auto_daily_closing, 'cron', hour=0, minute=5, id='auto_daily_closing', replace_existing=True)
        
        # Auto balance snapshot at midnight (before daily closing)
        scheduler.add_job(auto_balance_snapshot, 'cron', hour=0, minute=1, id='auto_balance_snapshot', replace_existing=True)
        
        scheduler.start()
        logger.info("Scheduler started with jobs: auto_lock_transactions, auto_daily_closing, auto_balance_snapshot")
    except Exception as e:
        logger.error(f"Scheduler setup failed: {e}")


# ============== APP LIFECYCLE ==============

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle manager"""
    # Startup
    logger.info("Starting Fin Flow application...")
    await init_database()
    setup_scheduler()
    logger.info("Fin Flow initialized successfully")
    
    yield
    
    # Shutdown
    logger.info("Shutting down...")
    if scheduler.running:
        scheduler.shutdown()
    client.close()
    logger.info("Shutdown complete")


# ============== CREATE APP ==============

app = FastAPI(
    title="Fin Flow",
    description="Credit Card Swiping Business Management",
    version="2.0.0",
    lifespan=lifespan
)

# Main API router
api_router = APIRouter(prefix="/api")

# Include all routers
api_router.include_router(auth_router)
api_router.include_router(users_router)
api_router.include_router(gateways_router)
api_router.include_router(banks_router)
api_router.include_router(customers_router)
api_router.include_router(transactions_router)
api_router.include_router(payments_router)
api_router.include_router(wallets_router)
api_router.include_router(expenses_router)
api_router.include_router(dashboard_router)
api_router.include_router(admin_router)
api_router.include_router(reconciliation_router)
api_router.include_router(smtp_router)
api_router.include_router(adjustments_router)


# Health check endpoint
@api_router.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "version": "2.0.0",
        "dev_mode": is_dev_mode()
    }


# Include API router
app.include_router(api_router)

# Security Headers Middleware
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

app.add_middleware(SecurityHeadersMiddleware)

# CORS configuration
# BUG-FIX: Default to empty list instead of wildcard for security
# In production, CORS_ORIGINS should be explicitly set
cors_env = os.environ.get('CORS_ORIGINS', '')
if cors_env == '*':
    # Explicit wildcard — allow all origins
    origins = ["*"]
elif cors_env:
    origins = [o.strip() for o in cors_env.split(',') if o.strip()]
else:
    # Development fallback - allow common local origins
    origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        os.environ.get('REACT_APP_BACKEND_URL', '').replace('/api', ''),
    ]
    # Filter out empty strings
    origins = [o for o in origins if o]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if origins else ["*"],  # Fallback to * only if no origins configured
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger.info("Fin Flow server configured and ready")
