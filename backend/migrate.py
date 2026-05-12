#!/usr/bin/env python3
"""
Fin Flow - Database Migration Script
Run this after fresh deployment to set up database structure.

Usage:
  python migrate.py          # Run all migrations
  python migrate.py --check  # Check migration status only
"""

import asyncio
import argparse
import os
import sys
import secrets
import string
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient
import uuid
import bcrypt

# Database connection - MUST be set via environment variables
MONGO_URL = os.environ.get('MONGO_URL')
DB_NAME = os.environ.get('DB_NAME')

if not MONGO_URL:
    raise ValueError("MONGO_URL environment variable is required")
if not DB_NAME:
    raise ValueError("DB_NAME environment variable is required")

# Default admin from ENV — required only on first bootstrap (no SuperAdmin user yet).
# Redeployments often omit these; do not fail at import time (see create_admin_user).
DEFAULT_ADMIN_EMAIL = (os.environ.get("DEFAULT_ADMIN_EMAIL") or "").strip()
DEFAULT_ADMIN_PASSWORD = os.environ.get("DEFAULT_ADMIN_PASSWORD") or ""

# Migration version
MIGRATION_VERSION = "3.0.0"


def validate_password_strength(password: str) -> tuple:
    """Validate password meets requirements"""
    import re
    errors = []
    if len(password) < 12:
        errors.append("at least 12 characters")
    if not re.search(r'[A-Z]', password):
        errors.append("an uppercase letter")
    if not re.search(r'[0-9]', password):
        errors.append("a number")
    if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        errors.append("a special character")
    return len(errors) == 0, errors


def generate_secure_password(length=16):
    """Generate a secure random password meeting all requirements"""
    password = [
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.digits),
        secrets.choice('!@#$%^&*(),.?":{}|<>'),
    ]
    all_chars = string.ascii_letters + string.digits + '!@#$%^&*(),.?":{}|<>'
    password += [secrets.choice(all_chars) for _ in range(length - 4)]
    secrets.SystemRandom().shuffle(password)
    return ''.join(password)


def hash_password(password: str) -> str:
    """Hash a password using bcrypt"""
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


async def get_db():
    client = AsyncIOMotorClient(MONGO_URL)
    return client[DB_NAME]


async def check_migration_status(db):
    """Check current migration status"""
    return await db.migrations.find_one({"_id": "status"})


async def set_migration_status(db, version, description):
    """Update migration status"""
    await db.migrations.update_one(
        {"_id": "status"},
        {"$set": {
            "version": version,
            "description": description,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )


async def create_indexes(db):
    """Create database indexes for performance (idempotent - safe to run multiple times)"""
    print("Creating indexes...")
    
    async def safe_create_index(collection, keys, **kwargs):
        """Create index, logging if it already exists (ARCH-09 fix)"""
        try:
            await collection.create_index(keys, **kwargs)
        except Exception as e:
            print(f"  Index creation skipped for {collection.name}: {e}")
    
    # Users
    await safe_create_index(db.users, "email", unique=True)
    await safe_create_index(db.users, "is_deleted")
    
    # Roles
    await safe_create_index(db.roles, "name", unique=True)
    
    # Customers
    await safe_create_index(db.customers, "customer_id", unique=True)
    await safe_create_index(db.customers, "phone")
    await safe_create_index(db.customers, "is_deleted")
    await safe_create_index(db.customers, [("name", "text"), ("phone", "text")])
    
    # Transactions
    await safe_create_index(db.transactions, "transaction_id", unique=True)
    await safe_create_index(db.transactions, "customer_id")
    await safe_create_index(db.transactions, "gateway_id")
    await safe_create_index(db.transactions, "is_deleted")
    await safe_create_index(db.transactions, "created_at")
    await safe_create_index(db.transactions, "status")  # Sprint 3: used in payment_pending aggregations
    await safe_create_index(db.transactions, "created_by")  # v2.6: user filter on transactions page
    await safe_create_index(db.transactions, "customer_payment_status")  # v2.6: inline payment status filter
    
    # Gateways
    await safe_create_index(db.gateways, "name")
    await safe_create_index(db.gateways, "is_deleted")
    
    # Wallets
    await safe_create_index(db.wallets, "wallet_type")
    await safe_create_index(db.wallets, "is_deleted")
    
    # Wallet Operations
    await safe_create_index(db.wallet_operations, "wallet_id")
    await safe_create_index(db.wallet_operations, "created_at")
    await safe_create_index(db.wallet_operations, "id", unique=True)     # Sprint 3: rollback delete_one({"id": ...})
    await safe_create_index(db.wallet_operations, "operation_id")        # Sprint 3: rollback delete_one({"operation_id": ...}) — not unique (legacy records have empty string)
    await safe_create_index(db.wallet_operations, "operation_type")      # v2.8: credit/debit filter
    await safe_create_index(db.wallet_operations, "created_by")          # v2.8: user filter
    
    # Payments (money paid OUT to customers)
    await safe_create_index(db.payments, "id", unique=True)
    await safe_create_index(db.payments, "customer_id")
    await safe_create_index(db.payments, "transaction_id")
    await safe_create_index(db.payments, "is_deleted")
    await safe_create_index(db.payments, "created_at")        # v3.0: date range filter on history
    await safe_create_index(db.payments, "payment_method")    # v3.0: method filter on history
    
    # Collections (money owed BY customers - to be collected IN)
    await safe_create_index(db.collections, "id", unique=True)
    await safe_create_index(db.collections, "customer_id")
    await safe_create_index(db.collections, "transaction_id")
    await safe_create_index(db.collections, "source")  # service_charge lookups
    await safe_create_index(db.collections, "status")
    await safe_create_index(db.collections, "is_deleted")
    await safe_create_index(db.collections, "created_at")     # v3.0: date range filter + sort
    
    # Adjustments (balance set-off between pending payouts and pending collections)
    await safe_create_index(db.adjustments, "id", unique=True)
    await safe_create_index(db.adjustments, "customer_id")
    await safe_create_index(db.adjustments, "created_at")
    await safe_create_index(db.adjustments, "is_deleted")
    
    # Expenses
    await safe_create_index(db.expenses, "expense_type_id")
    await safe_create_index(db.expenses, "wallet_id")
    await safe_create_index(db.expenses, "created_at")
    await safe_create_index(db.expenses, "transaction_id")   # BUG-02: fast lookup on reversal
    await safe_create_index(db.expenses, "is_auto_created")  # BUG-02: filter PG charge expenses
    await safe_create_index(db.expenses, "is_deleted")       # Sprint 3: used in every expense query
    await safe_create_index(db.expenses, "expense_date")     # Sprint 3: get_expenses_summary date filter
    await safe_create_index(db.expenses, "created_by")       # v2.8: user filter on expenses page
    await safe_create_index(db.expenses, "vendor_name")      # v2.8: sort/search by vendor
    await safe_create_index(db.expenses, "expense_id")       # v2.8: search by expense ID
    
    # Expense Types
    await safe_create_index(db.expense_types, "is_deleted")
    
    # Audit Log
    await safe_create_index(db.audit_logs, "user_id")
    await safe_create_index(db.audit_logs, "action")
    await safe_create_index(db.audit_logs, [("created_at", -1)])
    
    # Daily Closings
    await safe_create_index(db.daily_closings, "date", unique=True)
    
    # OTP Sessions (with TTL)
    await safe_create_index(db.otp_sessions, "email")
    await safe_create_index(db.otp_sessions, "expires_at", expireAfterSeconds=0)
    
    # Rate Limits (with TTL)
    await safe_create_index(db.rate_limits, "key")
    await safe_create_index(db.rate_limits, "expires_at", expireAfterSeconds=0)
    
    # Login Attempts (for rate limiting) - BUG-FIX: Added TTL index for auto-cleanup
    await safe_create_index(db.login_attempts, "email")
    await safe_create_index(db.login_attempts, "ip_address")
    await safe_create_index(db.login_attempts, "created_at")
    await safe_create_index(db.login_attempts, "expires_at", expireAfterSeconds=0)
    
    # SEC-05 FIX: Sessions with TTL for auto-cleanup of expired sessions
    await safe_create_index(db.sessions, "expires_at", expireAfterSeconds=0)
    await safe_create_index(db.sessions, "user_id")
    
    # Transaction pay sources (Type 02 multi-source)
    await safe_create_index(db.transaction_pay_sources, "transaction_id")
    await safe_create_index(db.transaction_pay_sources, "gateway_id")
    
    # Operation failures (for atomic rollback tracking)
    await safe_create_index(db.operation_failures, "operation_type")
    await safe_create_index(db.operation_failures, "created_at")
    
    # Balance verifications
    await safe_create_index(db.balance_verifications, "created_at")
    
    # Reconciliation reports
    await safe_create_index(db.reconciliation_reports, "created_at")
    
    # Banks & Cards
    await safe_create_index(db.banks, "is_deleted")
    await safe_create_index(db.card_networks, "is_deleted")
    await safe_create_index(db.bank_payment_types, "is_deleted")
    
    # Gateway Servers
    await safe_create_index(db.gateway_servers, "gateway_id")
    await safe_create_index(db.gateway_servers, "is_deleted")
    
    # Settings & Modules
    await safe_create_index(db.settings, "key")
    await safe_create_index(db.modules, "name")
    
    # Balance Snapshots
    await safe_create_index(db.balance_snapshots, "created_at")
    
    # System Alerts (v3.0: negative balance alerts, gateway charge alerts)
    await safe_create_index(db.system_alerts, "alert_type")
    await safe_create_index(db.system_alerts, "created_at")
    await safe_create_index(db.system_alerts, "is_resolved")
    
    # Counters (auto-increment sequences for readable IDs)
    await safe_create_index(db.counters, "name")
    
    # Account Lockouts (brute-force protection)
    await safe_create_index(db.account_lockouts, "email")
    await safe_create_index(db.account_lockouts, "locked_until")
    
    print("✓ Indexes created")


async def create_default_modules(db):
    """Create default navigation modules"""
    print("Setting up navigation modules...")
    
    modules = [
        {"name": "dashboard", "display_name": "Dashboard", "route": "/dashboard", "icon": "layout-dashboard", "order": 1},
        {"name": "customers", "display_name": "Customers", "route": "/customers", "icon": "users", "order": 2},
        {"name": "transactions", "display_name": "Transactions", "route": "/transactions", "icon": "arrow-left-right", "order": 3},
        {"name": "payments", "display_name": "Payments", "route": "/payments", "icon": "banknote", "order": 10},
        {"name": "collections", "display_name": "Collections", "route": "/collections", "icon": "wallet", "order": 11},
        {"name": "adjustments", "display_name": "Adjustments", "route": "/adjustments", "icon": "arrow-left-right", "order": 12},
        {"name": "wallets", "display_name": "Wallets", "route": "/wallets", "icon": "landmark", "order": 12},
        {"name": "expenses", "display_name": "Expenses", "route": "/expenses", "icon": "receipt", "order": 13},
        {"name": "expense-types", "display_name": "Expense Types", "route": "/expense-types", "icon": "tag", "order": 14},
        {"name": "pg-and-servers", "display_name": "PG & Servers", "route": "/pg-and-servers", "icon": "server", "order": 20},
        {"name": "banks-and-cards", "display_name": "Banks & Cards", "route": "/banks-and-cards", "icon": "credit-card", "order": 21},
        {"name": "users", "display_name": "Users", "route": "/users", "icon": "user-cog", "order": 30},
        {"name": "roles", "display_name": "Roles", "route": "/roles", "icon": "shield", "order": 31},
        {"name": "audit-log", "display_name": "Audit Log", "route": "/audit-log", "icon": "file-text", "order": 32},
        {"name": "daily-closing", "display_name": "Daily Closing", "route": "/daily-closing", "icon": "calendar-check", "order": 33},
        {"name": "reconciliation", "display_name": "Reconciliation", "route": "/reconciliation", "icon": "scale", "order": 34},
        {"name": "balance-verification", "display_name": "Balance Verification", "route": "/balance-verification", "icon": "check-circle", "order": 35},
        {"name": "data-integrity", "display_name": "Data Integrity", "route": "/data-integrity", "icon": "shield-check", "order": 36},
        {"name": "reports", "display_name": "Reports", "route": "/reports", "icon": "bar-chart-3", "order": 37},
        {"name": "downloads", "display_name": "Downloads", "route": "/downloads", "icon": "download", "order": 38},
        {"name": "security", "display_name": "Security", "route": "/security", "icon": "lock", "order": 40},
        {"name": "system-reset", "display_name": "System Reset", "route": "/system-reset", "icon": "refresh-cw", "order": 98},
        {"name": "settings", "display_name": "Settings", "route": "/settings", "icon": "settings", "order": 99},
    ]
    
    for module in modules:
        await db.modules.update_one(
            {"name": module["name"]},
            {"$setOnInsert": {
                **module,
                "is_deleted": False,
                "created_at": datetime.now(timezone.utc).isoformat()
            }},
            upsert=True
        )
    
    print(f"✓ {len(modules)} modules configured")


async def create_superadmin_role(db):
    """Create SuperAdmin role"""
    print("Setting up SuperAdmin role...")
    
    existing = await db.roles.find_one({"name": "SuperAdmin"})
    if existing:
        print("✓ SuperAdmin role already exists")
        return existing
    
    role = {
        "id": str(uuid.uuid4()),
        "name": "SuperAdmin",
        "description": "Full system access - all permissions",
        "permissions": [],  # Empty = full access for SuperAdmin
        "is_deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.roles.insert_one(role)
    print("✓ SuperAdmin role created")
    return role


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash"""
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False


async def create_admin_user(db, role):
    """
    Create or update the SINGLE SuperAdmin user from ENV variables.
    - Finds SuperAdmin by ROLE (not email) to ensure only 1 exists
    - Updates both email and password if they change
    - On redeploy, DEFAULT_ADMIN_* may be unset if the host does not inject .env;
      if a SuperAdmin user already exists, bootstrap is skipped (no error).
    """
    print("Setting up SuperAdmin user...")

    # Find existing SuperAdmin by ROLE (not email) - ensures only 1 SuperAdmin
    existing = await db.users.find_one({"role_id": role["id"]})

    missing_email = not DEFAULT_ADMIN_EMAIL
    missing_password = not DEFAULT_ADMIN_PASSWORD
    if missing_email or missing_password:
        if existing:
            print(
                "  DEFAULT_ADMIN_EMAIL / DEFAULT_ADMIN_PASSWORD not set — "
                "SuperAdmin already exists; skipping user bootstrap (OK for redeploy)."
            )
            return
        print("ERROR: First-time setup requires both environment variables:")
        if missing_email:
            print("  - DEFAULT_ADMIN_EMAIL (non-empty)")
        if missing_password:
            print("  - DEFAULT_ADMIN_PASSWORD (non-empty, see strength rules below)")
        print("Set them in your host panel, .env, or docker-compose `environment` for migrate.")
        print("Password must have: 12+ chars, uppercase, digit, special character.")
        sys.exit(1)

    # Validate password strength when we will create or compare/update from ENV
    is_valid, errors = validate_password_strength(DEFAULT_ADMIN_PASSWORD)
    if not is_valid:
        print("ERROR: DEFAULT_ADMIN_PASSWORD does not meet requirements:")
        print(f"       Needs {', '.join(errors)}")
        sys.exit(1)
    
    if existing:
        old_email = existing.get('email')
        needs_update = False
        updates = {"updated_at": datetime.now(timezone.utc).isoformat()}
        
        # Check if email changed
        if old_email != DEFAULT_ADMIN_EMAIL:
            updates["email"] = DEFAULT_ADMIN_EMAIL
            needs_update = True
            print(f"  Email change detected: {old_email} → {DEFAULT_ADMIN_EMAIL}")
        
        # Check if password changed
        if not verify_password(DEFAULT_ADMIN_PASSWORD, existing.get('password_hash', '')):
            updates["password_hash"] = hash_password(DEFAULT_ADMIN_PASSWORD)
            needs_update = True
            print("  Password change detected")
        
        if needs_update:
            await db.users.update_one(
                {"role_id": role["id"]},
                {"$set": updates}
            )
            print(f"✓ SuperAdmin updated ({DEFAULT_ADMIN_EMAIL})")
        else:
            print(f"✓ SuperAdmin already up-to-date ({DEFAULT_ADMIN_EMAIL})")
        return
    
    # Create new SuperAdmin user
    user = {
        "id": str(uuid.uuid4()),
        "email": DEFAULT_ADMIN_EMAIL,
        "password_hash": hash_password(DEFAULT_ADMIN_PASSWORD),
        "name": "Administrator",
        "phone": "",
        "role_id": role["id"],
        "is_active": True,
        "is_deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.users.insert_one(user)
    print("=" * 60)
    print("SUPERADMIN ACCOUNT CREATED")
    print(f"Email: {DEFAULT_ADMIN_EMAIL}")
    print("Password: (set from DEFAULT_ADMIN_PASSWORD env)")
    print("=" * 60)
    print("=" * 60)


async def create_default_expense_types(db):
    """Create default expense types"""
    print("Setting up expense types...")
    
    expense_types = [
        {"name": "PG Charges", "description": "Payment gateway processing fees", "is_system": True},
        {"name": "Bank Charges", "description": "Bank transaction fees", "is_system": True},
        {"name": "Charge Write-Off", "description": "Small charges below threshold written off", "is_system": True},
    ]
    
    for et in expense_types:
        await db.expense_types.update_one(
            {"name": et["name"]},
            {"$setOnInsert": {
                "id": str(uuid.uuid4()),
                **et,
                "is_deleted": False,
                "created_at": datetime.now(timezone.utc).isoformat()
            }},
            upsert=True
        )
    
    print(f"✓ {len(expense_types)} system expense types configured")


async def create_default_card_networks(db):
    """Create default card networks"""
    print("Setting up card networks...")
    
    networks = ["Visa", "Mastercard", "RuPay", "American Express", "Diners Club", "Others"]
    
    for network in networks:
        await db.card_networks.update_one(
            {"name": network},
            {"$setOnInsert": {
                "id": str(uuid.uuid4()),
                "name": network,
                "is_deleted": False,
                "created_at": datetime.now(timezone.utc).isoformat()
            }},
            upsert=True
        )
    
    print(f"✓ {len(networks)} card networks configured")


async def create_default_settings(db):
    """Create default application settings"""
    print("Setting up default settings...")
    
    existing = await db.settings.find_one({"_id": "app_settings"})
    if existing:
        # Migrate: add new fields if missing
        updates = {}
        if "default_commission_percentage" not in existing:
            updates["default_commission_percentage"] = 1.0
        if "min_outstanding_threshold" not in existing:
            updates["min_outstanding_threshold"] = 50.0
        if updates:
            await db.settings.update_one({"_id": "app_settings"}, {"$set": updates})
            print(f"✓ Settings migrated with new fields: {list(updates.keys())}")
        else:
            print("✓ Settings already up to date")
        return
    
    settings = {
        "_id": "app_settings",
        "id": "app_settings",
        "otp_expiry_minutes": 5,
        "session_timeout_hours": 12,
        "currency_symbol": "₹",
        "date_format": "DD/MM/YYYY",
        "business_name": "Fin Flow",
        "default_commission_percentage": 1.0,
        "min_outstanding_threshold": 50.0,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.settings.insert_one(settings)
    print("✓ Default settings configured")


async def create_default_bank_payment_types(db):
    """Create default bank payment types for collections"""
    print("Setting up bank payment types...")
    
    payment_types = [
        {"name": "UPI", "description": "Unified Payments Interface"},
        {"name": "NEFT", "description": "National Electronic Funds Transfer"},
        {"name": "RTGS", "description": "Real Time Gross Settlement"},
        {"name": "IMPS", "description": "Immediate Payment Service"},
        {"name": "QR Code", "description": "QR code scan payment"},
        {"name": "Bank Transfer", "description": "Direct bank transfer"},
        {"name": "Cheque", "description": "Cheque deposit"},
        {"name": "Cash Deposit", "description": "Cash deposited to bank account"},
    ]
    
    count = 0
    for pt in payment_types:
        result = await db.bank_payment_types.update_one(
            {"name": pt["name"], "is_deleted": {"$ne": True}},
            {"$setOnInsert": {
                "id": str(uuid.uuid4()),
                "name": pt["name"],
                "description": pt.get("description", ""),
                "is_deleted": False,
                "created_at": datetime.now(timezone.utc).isoformat()
            }},
            upsert=True
        )
        if result.upserted_id:
            count += 1
    
    total = await db.bank_payment_types.count_documents({"is_deleted": {"$ne": True}})
    print(f"✓ {total} bank payment types configured ({count} new)")


async def create_virtual_adjustments_wallet(db):
    """Create the virtual 'Adjustments' wallet used by the balance set-off feature.

    This wallet:
    - Has `wallet_type="virtual"` so it never appears in cash/bank/gateway selectors.
    - Stays at zero balance — every adjustment credits and debits the same amount.
    - Provides per-leg wallet_operations entries for full auditability.
    """
    print("Setting up virtual Adjustments wallet...")

    existing = await db.wallets.find_one(
        {"name": "Adjustments", "wallet_type": "virtual", "is_deleted": False}
    )
    if existing:
        print("✓ Virtual Adjustments wallet already exists")
        return

    now_iso = datetime.now(timezone.utc).isoformat()
    wallet = {
        "id": str(uuid.uuid4()),
        "name": "Adjustments",
        "wallet_type": "virtual",
        "description": "Virtual wallet for customer balance set-off / adjustments. Stays at zero by design.",
        "balance": 0.0,
        "is_active": True,
        "is_system": True,
        "is_deleted": False,
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.wallets.insert_one(wallet)
    print("✓ Virtual Adjustments wallet created")


async def rename_legacy_collections(db):
    """
    Rename legacy collection names to new standard names.
    This handles upgrades from older versions.
    - customer_payments → payments
    - pending_payments → collections

    Also drops empty orphaned collections that are no longer used:
    - audit_log  (0 docs — code uses audit_logs)
    - payment_methods (0 docs — superseded by bank_payment_types)
    """
    print("Checking for legacy collection names...")
    
    renames = [
        ("customer_payments", "payments"),
        ("pending_payments", "collections"),
    ]
    
    collections = await db.list_collection_names()
    
    for old_name, new_name in renames:
        if old_name in collections:
            if new_name in collections:
                # Both exist - check document counts
                old_count = await db[old_name].count_documents({})
                new_count = await db[new_name].count_documents({})
                
                if old_count == 0:
                    await db.drop_collection(old_name)
                    print(f"  Dropped empty '{old_name}' ('{new_name}' has {new_count} docs)")
                elif new_count == 0:
                    await db.drop_collection(new_name)
                    await db[old_name].rename(new_name)
                    print(f"  Renamed '{old_name}' → '{new_name}' ({old_count} documents)")
                else:
                    print(f"  ⚠️ Both '{old_name}' and '{new_name}' have data - manual merge required")
            else:
                # Only old exists - rename it
                count = await db[old_name].count_documents({})
                await db[old_name].rename(new_name)
                print(f"  Renamed '{old_name}' → '{new_name}' ({count} documents)")
    
    # Drop empty orphaned collections (safe — only if they have 0 documents)
    orphans = [
        ("audit_log",       "empty legacy alias — code uses 'audit_logs'"),
        ("payment_methods", "empty orphan — superseded by 'bank_payment_types'"),
    ]
    for col_name, reason in orphans:
        if col_name in collections:
            count = await db[col_name].count_documents({})
            if count == 0:
                await db.drop_collection(col_name)
                print(f"  Dropped empty orphaned collection '{col_name}' ({reason})")
            else:
                print(f"  ⚠️ Skipped '{col_name}' ({count} docs found — {reason})")

    print("✓ Collection names verified")


async def fix_customer_payment_status(db):
    """v2.6.0: Fix customer_payment_status field on existing transactions.
    Bug: payment endpoints never updated this field, leaving it stale as 'pending'.
    Also fixes 'completed' (invalid value from old settlement code) to 'paid'.
    Idempotent — safe to run multiple times.
    """
    print("Fixing customer_payment_status on existing transactions...")

    fixed = 0
    cursor = db.transactions.find(
        {"is_deleted": False, "status": {"$ne": "reversed"}},
        {"_id": 0, "id": 1, "amount_remaining_to_customer": 1,
         "amount_paid_to_customer": 1, "amount_to_customer": 1, "customer_payment_status": 1}
    )

    async for txn in cursor:
        remaining = txn.get("amount_remaining_to_customer", 0) or 0
        paid = txn.get("amount_paid_to_customer", 0) or 0
        ato = txn.get("amount_to_customer", 0) or 0
        current = txn.get("customer_payment_status", "pending")

        if remaining <= 0:
            expected = "not_applicable" if ato == 0 else "paid"
        elif paid > 0:
            expected = "partial"
        else:
            expected = "pending"

        if current != expected:
            await db.transactions.update_one(
                {"id": txn["id"]},
                {"$set": {"customer_payment_status": expected,
                          "updated_at": datetime.now(timezone.utc).isoformat()}}
            )
            fixed += 1

    print(f"✓ customer_payment_status: {fixed} records corrected")


async def run_migrations():
    """Run all migrations"""
    print("=" * 60)
    print("Fin Flow Database Migration v" + MIGRATION_VERSION)
    print("=" * 60)
    print(f"\nDatabase: {DB_NAME}")
    print()
    
    db = await get_db()
    
    # Check current status
    status = await check_migration_status(db)
    if status:
        print(f"Previous version: {status.get('version', 'unknown')}")
    else:
        print("Fresh installation detected")
    print()
    
    # Run migrations
    print("Running migrations...")
    print("-" * 40)
    
    # First: Rename any legacy collections (for upgrades)
    await rename_legacy_collections(db)
    
    await create_indexes(db)
    await create_default_modules(db)
    role = await create_superadmin_role(db)
    await create_admin_user(db, role)
    await create_default_expense_types(db)
    await create_default_card_networks(db)
    await create_default_bank_payment_types(db)
    await create_default_settings(db)
    await create_virtual_adjustments_wallet(db)
    
    # v2.6.0: Fix stale customer_payment_status on existing transactions
    await fix_customer_payment_status(db)
    
    # Update migration status
    await set_migration_status(db, MIGRATION_VERSION, "Migration complete")
    
    print()
    print("=" * 60)
    print("✓ Migration complete!")
    print("=" * 60)


async def check_only():
    """Check migration status only"""
    db = await get_db()
    status = await check_migration_status(db)
    
    print("Migration Status")
    print("-" * 40)
    if status:
        print(f"Version: {status.get('version', 'unknown')}")
        print(f"Description: {status.get('description', 'N/A')}")
        print(f"Last Updated: {status.get('updated_at', 'unknown')}")
    else:
        print("No migrations have been run yet")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fin Flow Database Migration")
    parser.add_argument("--check", action="store_true", help="Check migration status only")
    args = parser.parse_args()
    
    if args.check:
        asyncio.run(check_only())
    else:
        asyncio.run(run_migrations())
