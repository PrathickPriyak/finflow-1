"""
Utility functions used across routers
"""
import hashlib
import json
import re
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


async def log_operation_failure(db, operation_type: str, entity_id: str, step_failed: str, 
                                completed_steps: list, error_message: str, rollback_status: str,
                                user_id: str = "", extra: dict = None):
    """Log a failed multi-step operation for manual review"""
    doc = {
        "operation_type": operation_type,
        "entity_id": entity_id,
        "step_failed": step_failed,
        "completed_steps": completed_steps,
        "error_message": str(error_message),
        "rollback_status": rollback_status,
        "extra": extra or {},
        "user_id": user_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "resolved": False
    }
    try:
        await db.operation_failures.insert_one(doc)
    except Exception:
        logger.error(f"CRITICAL: Failed to log operation failure: {doc}")


async def rollback_wallet_debit(db, wallet_id: str, amount: float, op_id: str = ""):
    """Reverse a wallet debit (credit back)"""
    try:
        await db.wallets.find_one_and_update(
            {"id": wallet_id},
            {"$inc": {"balance": amount}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
        )
        if op_id:
            await db.wallet_operations.delete_one({"operation_id": op_id})
        return True
    except Exception as e:
        logger.error(f"CRITICAL: Rollback debit failed wallet={wallet_id} amount={amount}: {e}")
        return False


async def rollback_wallet_credit(db, wallet_id: str, amount: float, op_id: str = ""):
    """Reverse a wallet credit (debit back)"""
    try:
        await db.wallets.find_one_and_update(
            {"id": wallet_id},
            {"$inc": {"balance": -amount}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
        )
        if op_id:
            await db.wallet_operations.delete_one({"operation_id": op_id})
        return True
    except Exception as e:
        logger.error(f"CRITICAL: Rollback credit failed wallet={wallet_id} amount={amount}: {e}")
        return False



def serialize_doc(doc):
    """Convert MongoDB document for JSON response.
    
    Returns a NEW dictionary without _id field.
    Does NOT mutate the original document.
    """
    if doc is None:
        return None
    # Create a new dict excluding _id to avoid mutating the original
    return {k: v for k, v in doc.items() if k != "_id"}


def serialize_docs(docs):
    """Convert list of MongoDB documents.
    
    Returns a NEW list of dictionaries without _id fields.
    Does NOT mutate the original documents.
    """
    return [serialize_doc(doc) for doc in docs]


async def sync_id_counters(db):
    """
    Auto-sync ID counters with existing data to prevent duplicate key errors.
    
    This function checks the max sequence number in existing data and ensures
    the counter is always higher. Called on application startup.
    """
    synced_counters = []
    
    # Counter configurations: (counter_id, collection, id_field, prefix_pattern)
    counter_configs = [
        ("customer_id", "customers", "customer_id", r"C(\d+)"),
        ("transaction_id_type_01", "transactions", "transaction_id", r"T1-(\d+)"),
        ("transaction_id_type_02", "transactions", "transaction_id", r"T2-(\d+)"),
        ("transaction_id_transfer", "transactions", "transaction_id", r"TR-(\d+)"),
        ("operation_id", "wallet_operations", "operation_id", r"OP-(\d+)"),
        ("expense_id", "expenses", "expense_id", r"EXP-(\d+)"),
        ("pending_payment_id", "collections", "pending_payment_id", r"PP-(\d+)"),
    ]
    
    for counter_id, collection, id_field, pattern in counter_configs:
        try:
            # Get current counter value
            counter_doc = await db.counters.find_one({"_id": counter_id})
            current_seq = counter_doc.get("seq", 0) if counter_doc else 0
            
            # Find max sequence in existing data
            max_seq = 0
            cursor = db[collection].find({id_field: {"$exists": True}}, {id_field: 1, "_id": 0})
            async for doc in cursor:
                id_value = doc.get(id_field, "")
                if id_value:
                    match = re.search(pattern, str(id_value))
                    if match:
                        seq = int(match.group(1))
                        if seq > max_seq:
                            max_seq = seq
            
            # If max in data is higher than counter, update counter
            if max_seq >= current_seq:
                new_seq = max_seq + 1
                await db.counters.update_one(
                    {"_id": counter_id},
                    {"$set": {"seq": new_seq}},
                    upsert=True
                )
                if max_seq > current_seq:
                    synced_counters.append(f"{counter_id}: {current_seq} -> {new_seq}")
                    logger.info(f"Synced counter {counter_id}: {current_seq} -> {new_seq}")
        except Exception as e:
            logger.warning(f"Failed to sync counter {counter_id}: {e}")
    
    if synced_counters:
        logger.info(f"Counter sync complete. Updated: {len(synced_counters)}")
    else:
        logger.info("Counter sync complete. All counters already in sync.")
    
    return synced_counters


def validate_phone(phone: str) -> bool:
    """Validate Indian phone number (10 digits, optionally with +91)"""
    if not phone:
        return False
    cleaned = re.sub(r'[\s\-\(\)]', '', phone)
    cleaned = re.sub(r'^(\+91|91)', '', cleaned)
    return len(cleaned) == 10 and cleaned.isdigit()


def normalize_phone(phone: str) -> str:
    """Normalize phone to 10 digit format"""
    cleaned = re.sub(r'[\s\-\(\)]', '', phone)
    cleaned = re.sub(r'^(\+91|91)', '', cleaned)
    return cleaned


def get_today_date() -> str:
    """Get today's date in YYYY-MM-DD format (IST)"""
    from datetime import timedelta
    utc_now = datetime.now(timezone.utc)
    ist_offset = timedelta(hours=5, minutes=30)
    ist_now = utc_now + ist_offset
    return ist_now.strftime("%Y-%m-%d")


def get_ist_day_start_utc() -> str:
    """Return the UTC ISO timestamp of today's IST midnight.

    Transactions from 00:00–05:30 IST are stored with UTC timestamps from
    the *previous* UTC day. Using the plain IST date string for $gte
    comparisons misses those early-morning transactions.  This function
    returns the correct UTC lower-bound so that all transactions that
    belong to today (IST) are captured.
    """
    from datetime import timedelta
    IST_OFFSET = timedelta(hours=5, minutes=30)
    utc_now = datetime.now(timezone.utc)
    # Convert to IST wall-clock time (naive, for arithmetic)
    ist_naive = (utc_now + IST_OFFSET).replace(tzinfo=None)
    # Midnight of today in IST
    ist_midnight = ist_naive.replace(hour=0, minute=0, second=0, microsecond=0)
    # Convert back to UTC (naive)
    utc_midnight = ist_midnight - IST_OFFSET
    return utc_midnight.isoformat()


async def generate_customer_id(db) -> str:
    """Generate human-readable customer ID like C001, C002, etc."""
    counter = await db.counters.find_one_and_update(
        {"_id": "customer_id"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    seq = counter.get("seq", 1)
    return f"C{seq:03d}"


async def generate_transaction_id(db, transaction_type: str) -> str:
    """Generate human-readable transaction ID like T1-001, T2-001, TR-001"""
    if transaction_type == "type_01":
        prefix = "T1"
    elif transaction_type == "type_02":
        prefix = "T2"
    elif transaction_type == "transfer":
        prefix = "TR"
    else:
        prefix = "TX"
    
    counter_key = f"transaction_id_{transaction_type}"
    
    counter = await db.counters.find_one_and_update(
        {"_id": counter_key},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    seq = counter.get("seq", 1)
    return f"{prefix}-{seq:04d}"


async def generate_operation_id(db) -> str:
    """Generate human-readable wallet operation ID like OP-0001"""
    counter = await db.counters.find_one_and_update(
        {"_id": "operation_id"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    seq = counter.get("seq", 1)
    return f"OP-{seq:04d}"


async def generate_expense_id(db) -> str:
    """Generate human-readable expense ID like EXP-0001"""
    counter = await db.counters.find_one_and_update(
        {"_id": "expense_id"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    seq = counter.get("seq", 1)
    return f"EXP-{seq:04d}"


async def get_pending_payment_id(db) -> str:
    """Generate human-readable pending payment ID like PP-0001"""
    counter = await db.counters.find_one_and_update(
        {"_id": "pending_payment_id"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    seq = counter.get("seq", 1)
    return f"PP-{seq:04d}"


# ============== DATA INTEGRITY UTILITIES ==============

def generate_transaction_checksum(transaction_data: dict) -> str:
    """
    Generate SHA-256 checksum for transaction data integrity.
    
    Uses immutable fields that should never change after creation.
    Handles all transaction types: type_01, type_02 (single/multi-source), transfer.
    """
    txn_type = transaction_data.get("transaction_type", "")
    
    critical_fields = {
        "customer_id": transaction_data.get("customer_id"),
        "transaction_type": txn_type,
        "created_at": transaction_data.get("created_at"),
        "transaction_id": transaction_data.get("transaction_id"),
    }
    
    if txn_type == "type_01":
        critical_fields["swipe_amount"] = transaction_data.get("swipe_amount")
        critical_fields["swipe_gateway_id"] = transaction_data.get("swipe_gateway_id")
    elif txn_type == "type_02":
        critical_fields["pay_to_card_amount"] = transaction_data.get("pay_to_card_amount")
        critical_fields["total_pay_to_card"] = transaction_data.get("total_pay_to_card")
        critical_fields["pay_sources_count"] = transaction_data.get("pay_sources_count")
    elif txn_type == "transfer":
        critical_fields["transfer_amount"] = transaction_data.get("transfer_amount")
        critical_fields["transfer_from_wallet_id"] = transaction_data.get("transfer_from_wallet_id")
        critical_fields["transfer_to_wallet_id"] = transaction_data.get("transfer_to_wallet_id")
    else:
        # Fallback for data without transaction_type
        critical_fields["amount"] = transaction_data.get("amount")
        critical_fields["gateway_id"] = transaction_data.get("gateway_id")
    
    data_string = json.dumps(critical_fields, sort_keys=True, default=str)
    return hashlib.sha256(data_string.encode()).hexdigest()


def verify_transaction_checksum(transaction_data: dict) -> bool:
    """
    Verify transaction data hasn't been tampered with.
    
    Returns True if checksum matches, False if tampered or no checksum.
    """
    stored_checksum = transaction_data.get("checksum")
    if not stored_checksum:
        return True  # No checksum stored
    
    calculated_checksum = generate_transaction_checksum(transaction_data)
    return stored_checksum == calculated_checksum


async def validate_wallet_balance(db, wallet_id: str, required_amount: float) -> dict:
    """
    Validate wallet has sufficient balance for a debit operation.
    
    Returns: {"valid": bool, "current_balance": float, "shortfall": float, "message": str}
    """
    wallet = await db.wallets.find_one({"id": wallet_id, "is_deleted": False}, {"_id": 0})
    
    if not wallet:
        return {
            "valid": False,
            "current_balance": 0,
            "shortfall": required_amount,
            "message": f"Wallet not found: {wallet_id}"
        }
    
    current_balance = wallet.get("balance", 0)
    
    if current_balance < required_amount:
        return {
            "valid": False,
            "current_balance": current_balance,
            "shortfall": required_amount - current_balance,
            "message": f"Insufficient balance. Available: ₹{current_balance:,.2f}, Required: ₹{required_amount:,.2f}"
        }
    
    return {
        "valid": True,
        "current_balance": current_balance,
        "shortfall": 0,
        "message": "Balance sufficient"
    }


async def get_next_operation_sequence(db, wallet_id: str) -> int:
    """
    Get the next sequence number for wallet operations.
    
    Each wallet maintains its own sequence to ensure operations are ordered.
    """
    counter = await db.counters.find_one_and_update(
        {"_id": f"wallet_op_seq_{wallet_id}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    return counter.get("seq", 1)


async def check_operation_sequence_gaps(db, wallet_id: str) -> dict:
    """
    Check if there are any gaps in wallet operation sequences.

    BUG-10 FIX: Replaced .to_list(10000) with a two-step aggregation so this
    function is safe on any size wallet.  First pass gets min/max/count in a
    single round-trip.  If gaps are detected, a second pass fetches the actual
    sequence numbers only for wallets with a manageable range (<= 50 000).

    Returns: {"has_gaps": bool, "gaps": list, "max_sequence": int}
    """
    # Step 1: get statistics without pulling all documents
    stats_agg = await db.wallet_operations.aggregate([
        {"$match": {"wallet_id": wallet_id, "sequence_number": {"$exists": True}}},
        {"$group": {
            "_id": None,
            "min_seq": {"$min": "$sequence_number"},
            "max_seq": {"$max": "$sequence_number"},
            "count": {"$sum": 1}
        }}
    ]).to_list(1)

    if not stats_agg:
        return {"has_gaps": False, "gaps": [], "max_sequence": 0}

    stats = stats_agg[0]
    min_seq = stats["min_seq"]
    max_seq = stats["max_seq"]
    count = stats["count"]
    expected_count = max_seq - min_seq + 1
    has_gaps = count != expected_count

    gaps = []
    if has_gaps and expected_count <= 50_000:
        # Step 2: only fetch sequences when the range is manageable
        seq_agg = await db.wallet_operations.aggregate([
            {"$match": {"wallet_id": wallet_id, "sequence_number": {"$exists": True}}},
            {"$group": {"_id": None, "seqs": {"$push": "$sequence_number"}}}
        ]).to_list(1)
        if seq_agg:
            actual = set(seq_agg[0]["seqs"])
            expected = set(range(min_seq, max_seq + 1))
            gaps = sorted(list(expected - actual))[:100]  # cap response size

    return {
        "has_gaps": has_gaps,
        "gaps": gaps,
        "max_sequence": max_seq,
        "total_operations": count
    }


async def create_balance_snapshot(db, triggered_by: str = "system") -> dict:
    """
    Create a snapshot of all wallet balances.
    
    Used for daily snapshots and audit trail.
    """
    import uuid
    
    wallets = await db.wallets.find({"is_deleted": False}, {"_id": 0}).to_list(100)
    
    now_iso = datetime.now(timezone.utc).isoformat()
    
    snapshot = {
        "id": str(uuid.uuid4()),
        "date": get_today_date(),
        "timestamp": now_iso,
        "triggered_by": triggered_by,
        "wallets": [],
        "total_balance": 0
    }
    
    for wallet in wallets:
        wallet_snapshot = {
            "wallet_id": wallet["id"],
            "wallet_name": wallet["name"],
            "wallet_type": wallet.get("wallet_type", ""),
            "balance": wallet.get("balance", 0)
        }
        snapshot["wallets"].append(wallet_snapshot)
        snapshot["total_balance"] += wallet.get("balance", 0)
    
    # Store snapshot
    await db.balance_snapshots.insert_one(snapshot)
    
    logger.info(f"Balance snapshot created: {snapshot['id']} with total ₹{snapshot['total_balance']:,.2f}")
    
    return serialize_doc(snapshot)


async def compare_balance_with_snapshot(db, snapshot_id: str = None) -> dict:
    """
    Compare current balances with a snapshot to detect discrepancies.
    
    If no snapshot_id provided, uses the most recent snapshot.
    """
    if snapshot_id:
        snapshot = await db.balance_snapshots.find_one({"id": snapshot_id}, {"_id": 0})
    else:
        snapshots = await db.balance_snapshots.find({}, {"_id": 0}).sort("timestamp", -1).limit(1).to_list(1)
        snapshot = snapshots[0] if snapshots else None
    
    if not snapshot:
        return {"error": "No snapshot found", "discrepancies": []}
    
    discrepancies = []
    current_wallets = await db.wallets.find({"is_deleted": False}, {"_id": 0}).to_list(100)
    current_by_id = {w["id"]: w for w in current_wallets}
    
    for wallet_snap in snapshot.get("wallets", []):
        wallet_id = wallet_snap["wallet_id"]
        snapshot_balance = wallet_snap["balance"]
        
        current_wallet = current_by_id.get(wallet_id)
        if not current_wallet:
            discrepancies.append({
                "wallet_id": wallet_id,
                "wallet_name": wallet_snap["wallet_name"],
                "issue": "Wallet deleted since snapshot",
                "snapshot_balance": snapshot_balance,
                "current_balance": None
            })
            continue
        
        current_balance = current_wallet.get("balance", 0)
        
        # BUG-9 FIX: Use aggregation instead of to_list(1000) — correctly sums all ops regardless of count
        net_agg = await db.wallet_operations.aggregate([
            {"$match": {"wallet_id": wallet_id, "created_at": {"$gt": snapshot["timestamp"]}}},
            {"$group": {
                "_id": None,
                "credits": {"$sum": {"$cond": [{"$eq": ["$operation_type", "credit"]}, "$amount", 0]}},
                "debits": {"$sum": {"$cond": [{"$eq": ["$operation_type", "debit"]}, "$amount", 0]}},
                "count": {"$sum": 1}
            }}
        ]).to_list(1)
        if net_agg:
            expected_change = net_agg[0]["credits"] - net_agg[0]["debits"]
            ops_count = net_agg[0]["count"]
        else:
            expected_change = 0
            ops_count = 0

        expected_balance = snapshot_balance + expected_change

        if abs(current_balance - expected_balance) > 0.01:
            discrepancies.append({
                "wallet_id": wallet_id,
                "wallet_name": current_wallet["name"],
                "issue": "Balance mismatch",
                "snapshot_balance": snapshot_balance,
                "expected_balance": expected_balance,
                "current_balance": current_balance,
                "difference": current_balance - expected_balance,
                "operations_since_snapshot": ops_count
            })
    
    return {
        "snapshot_id": snapshot["id"],
        "snapshot_date": snapshot["date"],
        "snapshot_timestamp": snapshot["timestamp"],
        "has_discrepancies": len(discrepancies) > 0,
        "discrepancies": discrepancies,
        "wallets_checked": len(snapshot.get("wallets", []))
    }


async def get_customer_ids_by_phone(db, search_term: str) -> list:
    """Lookup customer IDs by partial phone match. Returns list of customer_id strings."""
    if not any(c.isdigit() for c in search_term):
        return []
    escaped = re.escape(search_term)
    cursor = db.customers.find(
        {"is_deleted": False, "phone": {"$regex": escaped, "$options": "i"}},
        {"_id": 0, "id": 1}
    )
    return [doc["id"] async for doc in cursor]


def validate_date_param(date_str: str, param_name: str = "date") -> str:
    """Validate and normalize a date string parameter. Returns validated YYYY-MM-DD string."""
    if not date_str:
        return ""
    try:
        parsed = datetime.strptime(date_str.strip()[:10], "%Y-%m-%d")
        return parsed.strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=f"Invalid {param_name}: '{date_str}'. Expected format: YYYY-MM-DD")


def sanitize_text(text: str) -> str:
    """Strip HTML tags and dangerous characters from user input text."""
    if not text:
        return text
    import re as _re
    clean = _re.sub(r'<[^>]+>', '', text)
    clean = _re.sub(r'javascript\s*:', '', clean, flags=_re.IGNORECASE)
    clean = _re.sub(r'on\w+\s*=', '', clean, flags=_re.IGNORECASE)
    return clean.strip()
