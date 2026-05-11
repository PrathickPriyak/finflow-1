"""
Transactions Router - Type 01, Type 02 transactions and reversals
"""
from fastapi import APIRouter, HTTPException, Depends, Request, Query
from pydantic import BaseModel, Field
from datetime import datetime, timezone, timedelta
from typing import Optional
import logging

from core.database import db
from core.dependencies import auth_required, check_permission, log_audit
from utils import (
    serialize_doc, serialize_docs, 
    generate_transaction_id, generate_operation_id,
    generate_transaction_checksum, validate_wallet_balance,
    get_next_operation_sequence, get_pending_payment_id,
    rollback_wallet_debit, rollback_wallet_credit, log_operation_failure
)
from models import (
    Transaction, TransactionType01Create, TransactionType02Create,
    WalletOperation
)

router = APIRouter(tags=["Transactions"])
logger = logging.getLogger(__name__)


async def create_pg_charge_expense(transaction_id, transaction_type, gateway_name, 
                                    pg_charge_amount, wallet_id, wallet_name, 
                                    wallet_type, user_id, user_name):
    """Auto-create PG charge expense when transaction is created"""
    from utils import generate_expense_id, get_today_date
    from models import Expense
    
    pg_expense_type = await db.expense_types.find_one({"name": "PG Charges", "is_deleted": False}, {"_id": 0})
    if not pg_expense_type:
        return None
    
    expense_id = await generate_expense_id(db)
    now_iso = datetime.now(timezone.utc).isoformat()
    today = get_today_date()
    
    expense = Expense(
        expense_id=expense_id,
        description=f"PG Charges for {transaction_type} {transaction_id} via {gateway_name}",
        amount=pg_charge_amount,
        expense_type_id=pg_expense_type["id"],
        expense_type_name="PG Charges",
        wallet_id=wallet_id,
        wallet_name=wallet_name,
        wallet_type=wallet_type,
        expense_date=today,
        # BUG-02 FIX: store readable transaction_id so reversals can soft-delete this expense
        transaction_id=transaction_id,
        notes=f"Auto-created for transaction {transaction_id}",
        created_by=user_id,
        created_by_name=user_name,
        is_auto_created=True
    )
    
    expense_doc = expense.model_dump()
    expense_doc['created_at'] = now_iso
    expense_doc['updated_at'] = now_iso
    await db.expenses.insert_one(expense_doc)
    
    return expense


# ============== TRANSACTIONS LIST ==============

@router.get("/transactions")
async def get_transactions(
    customer_id: Optional[str] = None,
    transaction_type: Optional[str] = None,
    status: Optional[str] = None,
    gateway_id: Optional[str] = None,
    created_by: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = "desc",
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    auth: dict = Depends(auth_required)
):
    """Get transactions with filters and pagination"""
    import re as re_module
    query = {"is_deleted": False}
    
    if customer_id:
        query["customer_id"] = customer_id
    if transaction_type:
        query["transaction_type"] = transaction_type
    if status:
        if status == "active":
            query["status"] = {"$ne": "reversed"}
        else:
            query["status"] = status
    if gateway_id:
        query["$or"] = [
            {"swipe_gateway_id": gateway_id},
            {"pay_to_card_gateway_id": gateway_id}
        ]
    if created_by:
        query["created_by"] = created_by
    # AUDIT-FIX-07: Add text search by customer name, transaction ID, or card details
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
        if "$or" in query:
            # Combine with existing $or using $and
            query["$and"] = [{"$or": query.pop("$or")}, {"$or": search_conditions}]
        else:
            query["$or"] = search_conditions
    if date_from:
        query["created_at"] = {"$gte": date_from}
    if date_to:
        if "created_at" in query:
            query["created_at"]["$lte"] = date_to + "T23:59:59.999999"
        else:
            query["created_at"] = {"$lte": date_to + "T23:59:59.999999"}
    
    total = await db.transactions.count_documents(query)
    skip = (page - 1) * limit
    
    # Sorting
    sort_field_map = {
        "date": "created_at",
        "amount": "swipe_amount",
        "commission": "commission_amount",
        "customer": "customer_name",
        "gateway": "swipe_gateway_name",
        "type": "transaction_type",
        "status": "status",
    }
    sort_field = sort_field_map.get(sort_by, "created_at")
    sort_direction = 1 if sort_order == "asc" else -1
    
    transactions = await db.transactions.find(
        query, {"_id": 0}
    ).sort(sort_field, sort_direction).skip(skip).limit(limit).to_list(limit)
    
    return {
        "data": serialize_docs(transactions),
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "pages": (total + limit - 1) // limit
        }
    }


@router.get("/transactions/{transaction_id}")
async def get_transaction(transaction_id: str, verify: bool = False, auth: dict = Depends(auth_required)):
    """Get transaction by ID. Set verify=true to check data integrity via checksum."""
    transaction = await db.transactions.find_one({"id": transaction_id, "is_deleted": False}, {"_id": 0})
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    result = serialize_doc(transaction)
    
    if verify and transaction.get("checksum"):
        from utils import generate_transaction_checksum
        computed = generate_transaction_checksum(transaction)
        result["_integrity"] = {
            "valid": computed == transaction["checksum"],
            "stored_checksum": transaction["checksum"][:8] + "...",
        }
        if computed != transaction["checksum"]:
            logger.warning(f"Checksum mismatch on transaction {transaction.get('transaction_id', transaction_id)}")
            try:
                await db.system_alerts.insert_one({
                    "type": "checksum_mismatch",
                    "severity": "critical",
                    "message": f"Data integrity alert: checksum mismatch on transaction {transaction.get('transaction_id', transaction_id)}",
                    "transaction_id": transaction_id,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
            except Exception:
                pass
    
    return result



@router.get("/transactions/{transaction_id}/audit-trail")
async def get_transaction_audit_trail(transaction_id: str, auth: dict = Depends(auth_required)):
    """Get chronological audit trail for a transaction — all events from creation to current state."""
    transaction = await db.transactions.find_one({"id": transaction_id, "is_deleted": False}, {"_id": 0})
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    readable_id = transaction.get("transaction_id", "")
    events = []
    
    # 1. Transaction creation
    events.append({
        "type": "transaction_created",
        "icon": "plus-circle",
        "color": "blue",
        "title": f"Transaction Created ({transaction.get('transaction_type', '').replace('_', ' ').title()})",
        "description": f"Swipe: {transaction.get('swipe_amount', 0):,.2f}" if transaction.get("transaction_type") == "type_01"
            else f"Pay to Card: {transaction.get('pay_to_card_amount', 0):,.2f}" if transaction.get("transaction_type") == "type_02"
            else f"Transfer: {transaction.get('transfer_amount', 0):,.2f}",
        "user": transaction.get("created_by_name", ""),
        "timestamp": transaction.get("created_at", ""),
        "details": {
            "customer": transaction.get("customer_name", ""),
            "card": transaction.get("card_details", ""),
            "gateway": transaction.get("swipe_gateway_name") or transaction.get("pay_to_card_gateway_name", ""),
        }
    })
    
    # 2. Wallet operations (credits, debits, reversals)
    ops = await db.wallet_operations.find(
        {"$or": [{"reference_id": transaction_id}, {"transaction_id": readable_id}]},
        {"_id": 0}
    ).sort("created_at", 1).to_list(50)
    
    for op in ops:
        ref_type = op.get("reference_type", "")
        op_type = op.get("operation_type", "")
        icon = "trending-up" if op_type == "credit" else "trending-down"
        color = "emerald" if op_type == "credit" else "red"
        
        title_map = {
            "transaction": f"Gateway Wallet {'Credited' if op_type == 'credit' else 'Debited'}",
            "customer_payment": "Customer Payment Processed",
            "payment_void": "Customer Payment Voided",
            "collection_card_swipe": "Collection Settled (Card Swipe)",
            "collection_cash": "Collection Settled (Cash)",
            "collection_bank_transfer": "Collection Settled (Bank Transfer)",
            "settlement_void": "Settlement Voided",
            "reversal": "Transaction Reversed",
            "reversal_cascade": "Service Charge Settlement Reversed",
            "bulk_collection": "Bulk Collection Processed",
        }
        title = title_map.get(ref_type, f"Wallet {op_type.title()}")
        if ref_type in ("settlement_void", "reversal", "payment_void", "reversal_cascade"):
            color = "amber"
            icon = "undo-2"
        
        events.append({
            "type": f"wallet_{op_type}",
            "icon": icon,
            "color": color,
            "title": title,
            "description": f"{'+'if op_type == 'credit' else '-'}{op.get('amount', 0):,.2f} → {op.get('wallet_name', '')}",
            "user": op.get("created_by_name", ""),
            "timestamp": op.get("created_at", ""),
            "details": {
                "operation_id": op.get("operation_id", ""),
                "balance_before": op.get("balance_before", 0),
                "balance_after": op.get("balance_after", 0),
            }
        })
    
    # 3. Collections + settlements
    collections = await db.collections.find(
        {"transaction_id": transaction_id},
        {"_id": 0}
    ).to_list(20)
    
    for coll in collections:
        source = coll.get("source", "type_02_transaction")
        is_sc = source == "service_charge"
        events.append({
            "type": "collection_created",
            "icon": "file-plus" if not is_sc else "receipt",
            "color": "indigo" if not is_sc else "amber",
            "title": f"{'Service Charge ' if is_sc else ''}Collection Created ({coll.get('pending_payment_id', '')})",
            "description": f"Amount: {coll.get('amount', 0):,.2f}",
            "user": coll.get("created_by_name", ""),
            "timestamp": coll.get("created_at", ""),
            "details": {"status": coll.get("status", ""), "source": source}
        })
        
        for s in coll.get("settlements", []):
            is_voided = s.get("voided", False)
            events.append({
                "type": "settlement_voided" if is_voided else "settlement_created",
                "icon": "undo-2" if is_voided else "check-circle",
                "color": "red" if is_voided else "emerald",
                "title": f"Settlement {'Voided' if is_voided else 'Recorded'} ({s.get('method', '').replace('_', ' ').title()})",
                "description": f"Gross: {s.get('gross_amount', 0):,.2f} | Principal: {s.get('principal_amount', 0):,.2f} | Commission: {s.get('commission_amount', 0):,.2f}",
                "user": s.get("settled_by_name", ""),
                "timestamp": s.get("voided_at" if is_voided else "settled_at", ""),
                "details": {
                    "wallet": s.get("wallet_name", ""),
                    "gateway": s.get("gateway_name", ""),
                    "include_charges": s.get("include_charges", False),
                    "voided_by": s.get("voided_by_name", "") if is_voided else None,
                }
            })
    
    # 4. Customer payments
    payments = await db.payments.find(
        {"transaction_id": transaction_id},
        {"_id": 0}
    ).sort("created_at", 1).to_list(20)
    
    for p in payments:
        is_voided = p.get("is_voided", False) or p.get("is_deleted", False)
        events.append({
            "type": "payment_voided" if is_voided else "payment_created",
            "icon": "undo-2" if is_voided else "banknote",
            "color": "amber" if is_voided else "emerald",
            "title": f"Customer Payment {'Voided' if is_voided else 'Made'}",
            "description": f"{p.get('amount', 0):,.2f} via {p.get('source_name', '')}",
            "user": p.get("recorded_by_name", ""),
            "timestamp": p.get("voided_at", p.get("created_at", "")) if is_voided else p.get("created_at", ""),
            "details": {"payment_id": p.get("payment_id", ""), "method": p.get("payment_method", "")}
        })
    
    # 5. Reversal event
    if transaction.get("status") == "reversed" and transaction.get("reversal_details"):
        rd = transaction["reversal_details"]
        events.append({
            "type": "transaction_reversed",
            "icon": "x-circle",
            "color": "red",
            "title": "Transaction Reversed",
            "description": rd.get("reversal_reason", "No reason provided"),
            "user": rd.get("reversed_by_name", ""),
            "timestamp": rd.get("reversed_at", ""),
            "details": rd,
        })
    
    # Sort by timestamp
    events.sort(key=lambda e: e.get("timestamp", "") or "")
    
    return {
        "transaction_id": readable_id,
        "total_events": len(events),
        "events": events,
    }


# ============== TYPE 01 TRANSACTION ==============

@router.post("/transactions/type01")
async def create_type_01_transaction(data: TransactionType01Create, request: Request, auth: dict = Depends(auth_required)):
    """Create Type 01 transaction (Direct Swipe - business owes customer)"""
    await check_permission(auth, "transactions")
    
    customer = await db.customers.find_one({"id": data.customer_id, "is_deleted": False}, {"_id": 0})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    if customer.get("is_blacklisted"):
        raise HTTPException(status_code=400, detail="Cannot create transaction for a blacklisted customer")

    # Rate limit: max 10 transactions per customer in 5 minutes
    five_min_ago = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    recent_count = await db.transactions.count_documents({
        "customer_id": data.customer_id, "is_deleted": False, "created_at": {"$gte": five_min_ago}
    })
    if recent_count >= 10:
        raise HTTPException(status_code=429, detail="Rate limit: max 10 transactions per customer in 5 minutes")

    card = None
    for c in customer.get("cards", []):
        if c["id"] == data.card_id:
            card = c
            break
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    
    gateway = await db.gateways.find_one({"id": data.swipe_gateway_id, "is_deleted": False}, {"_id": 0})
    if not gateway:
        raise HTTPException(status_code=404, detail="Gateway not found")
    
    if not gateway.get("is_active"):
        raise HTTPException(status_code=400, detail="Gateway is inactive")
    
    gateway_wallet = await db.wallets.find_one({
        "wallet_type": "gateway",
        "gateway_id": data.swipe_gateway_id,
        "is_deleted": False
    }, {"_id": 0})
    if not gateway_wallet:
        raise HTTPException(status_code=500, detail="Gateway wallet not found")
    
    server = await db.gateway_servers.find_one({
        "id": data.swipe_server_id,
        "gateway_id": data.swipe_gateway_id,
        "is_deleted": False
    }, {"_id": 0})
    if not server:
        raise HTTPException(status_code=400, detail="Gateway server not found")
    
    if not server.get("is_active", True):
        raise HTTPException(status_code=400, detail="Gateway server is inactive")
    
    gateway_charge_percentage = server["charge_percentage"]
    
    if data.total_charge_percentage < gateway_charge_percentage:
        raise HTTPException(
            status_code=400,
            detail=f"Total charges ({data.total_charge_percentage}%) must be at least PG charges ({gateway_charge_percentage}%)"
        )
    
    commission_percentage = round(data.total_charge_percentage - gateway_charge_percentage, 2)
    gateway_charge_amount = round(data.swipe_amount * gateway_charge_percentage / 100, 2)
    commission_amount = round(data.swipe_amount * commission_percentage / 100, 2)
    
    net_to_customer = data.swipe_amount - gateway_charge_amount - commission_amount
    
    transaction_id_readable = await generate_transaction_id(db, "type_01")
    customer_readable_id = customer.get("customer_id", "")
    
    user_email = auth["user"].get("email", "")
    ip_address = request.client.host if request.client else ""
    user_agent = request.headers.get("user-agent", "")[:255]
    
    transaction = Transaction(
        transaction_id=transaction_id_readable,
        transaction_type="type_01",
        customer_id=data.customer_id,
        customer_readable_id=customer_readable_id,
        customer_name=customer["name"],
        card_id=data.card_id,
        card_details=f"{card['bank_name']} - {card['card_network_name']} - {card['last_four_digits']}",
        swipe_gateway_id=data.swipe_gateway_id,
        swipe_gateway_name=gateway["name"],
        swipe_server_id=data.swipe_server_id,
        swipe_server_name=server["name"],
        swipe_amount=data.swipe_amount,
        gateway_charge_percentage=gateway_charge_percentage,
        gateway_charge_amount=gateway_charge_amount,
        commission_percentage=commission_percentage,
        commission_amount=commission_amount,
        amount_to_customer=net_to_customer,
        amount_remaining_to_customer=net_to_customer,
        status="payment_pending",
        user_email=user_email,
        ip_address=ip_address,
        user_agent=user_agent,
        notes=data.notes,
        created_by=auth["user"]["id"],
        created_by_name=auth["user"]["name"]
    )
    
    doc = transaction.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    
    # Generate checksum for data integrity
    doc['checksum'] = generate_transaction_checksum(doc)
    
    await db.transactions.insert_one(doc)
    
    amount_received = data.swipe_amount - gateway_charge_amount
    wallet_credit_done = False
    wallet_op_id = ""
    
    try:
        # Step 1: Credit gateway wallet (atomic $inc)
        updated_wallet = await db.wallets.find_one_and_update(
            {"id": gateway_wallet["id"]},
            {
                "$inc": {"balance": amount_received},
                "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
            },
            return_document=True,
            projection={"_id": 0}
        )
        if not updated_wallet:
            raise Exception("Failed to update gateway wallet balance")
        wallet_credit_done = True
        
        balance_after = updated_wallet.get("balance", 0)
        balance_before = balance_after - amount_received
        
        # Step 2: Create wallet operation record
        sequence_number = await get_next_operation_sequence(db, gateway_wallet["id"])
        operation_id = await generate_operation_id(db)
        wallet_op_id = operation_id
        
        wallet_op = WalletOperation(
            operation_id=operation_id,
            wallet_id=gateway_wallet["id"],
            wallet_name=gateway_wallet["name"],
            wallet_type="gateway",
            operation_type="credit",
            amount=amount_received,
            balance_before=balance_before,
            balance_after=balance_after,
            reference_id=transaction.id,
            reference_type="transaction",
            transaction_id=transaction_id_readable,
            customer_id=customer_readable_id,
            notes=f"Card swipe: {customer['name']} - {card['bank_name']}",
            created_by=auth["user"]["id"],
            created_by_name=auth["user"]["name"]
        )
        wallet_doc = wallet_op.model_dump()
        wallet_doc['created_at'] = wallet_doc['created_at'].isoformat()
        wallet_doc['updated_at'] = wallet_doc['updated_at'].isoformat()
        wallet_doc['sequence_number'] = sequence_number
        await db.wallet_operations.insert_one(wallet_doc)
        
        # Step 3: PG charge expense
        if gateway_charge_amount > 0:
            await create_pg_charge_expense(
                transaction_id=transaction_id_readable,
                transaction_type="Type 01",
                gateway_name=gateway["name"],
                pg_charge_amount=gateway_charge_amount,
                wallet_id=gateway_wallet["id"],
                wallet_name=gateway_wallet["name"],
                wallet_type="gateway",
                user_id=auth["user"]["id"],
                user_name=auth["user"]["name"]
            )
    except Exception as e:
        # Rollback: reverse wallet credit and delete transaction
        rollback_ok = True
        if wallet_credit_done:
            ok = await rollback_wallet_credit(db, gateway_wallet["id"], amount_received, wallet_op_id)
            if not ok:
                rollback_ok = False
        await db.transactions.delete_one({"id": transaction.id})
        
        await log_operation_failure(
            db, "type01_create", transaction.id, "wallet_operations",
            ["transaction_insert"] + (["wallet_credit"] if wallet_credit_done else []),
            str(e), "complete" if rollback_ok else "partial",
            user_id=auth["user"]["id"]
        )
        raise HTTPException(status_code=500, detail=f"Transaction failed and was rolled back: {str(e)}")
    
    await db.customers.update_one(
        {"id": data.customer_id},
        {"$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "create", "transactions", transaction.id, {
        "type": "type_01",
        "customer": customer["name"],
        "amount": data.swipe_amount,
        "server": server["name"]
    }, ip=request.client.host if request.client else "")
    
    return serialize_doc(doc)


# ============== TYPE 02 TRANSACTION ==============

@router.post("/transactions/type02")
async def create_type_02_transaction(data: TransactionType02Create, request: Request, auth: dict = Depends(auth_required)):
    """Create Type 02 transaction with multi-source pay (always swipe later via collections)"""
    await check_permission(auth, "transactions")
    
    # Validate customer
    customer = await db.customers.find_one({"id": data.customer_id, "is_deleted": False}, {"_id": 0})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    if customer.get("is_blacklisted"):
        raise HTTPException(status_code=400, detail="Cannot create transaction for a blacklisted customer")

    # Rate limit: max 10 transactions per customer in 5 minutes
    five_min_ago = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    recent_count = await db.transactions.count_documents({
        "customer_id": data.customer_id, "is_deleted": False, "created_at": {"$gte": five_min_ago}
    })
    if recent_count >= 10:
        raise HTTPException(status_code=429, detail="Rate limit: max 10 transactions per customer in 5 minutes")

    card = None
    for c in customer.get("cards", []):
        if c["id"] == data.card_id:
            card = c
            break
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    
    # Validate pay sources total matches pay_to_card_amount
    sources_total = sum(s.amount for s in data.pay_sources)
    if abs(sources_total - data.pay_to_card_amount) > 0.01:
        raise HTTPException(
            status_code=400, 
            detail=f"Pay sources total ({sources_total}) must equal pay_to_card_amount ({data.pay_to_card_amount})"
        )
    
    # Validate each pay source gateway exists and has balance
    validated_sources = []
    for i, source in enumerate(data.pay_sources):
        gw = await db.gateways.find_one({"id": source.gateway_id, "is_deleted": False}, {"_id": 0})
        if not gw:
            raise HTTPException(status_code=404, detail=f"Pay source gateway #{i+1} not found")
        if not gw.get("is_active"):
            raise HTTPException(status_code=400, detail=f"Pay source gateway '{gw['name']}' is inactive")
        
        wallet = await db.wallets.find_one({
            "wallet_type": "gateway", "gateway_id": source.gateway_id, "is_deleted": False
        }, {"_id": 0})
        if not wallet:
            raise HTTPException(status_code=500, detail=f"Wallet for gateway '{gw['name']}' not found")
        
        balance_check = await validate_wallet_balance(db, wallet["id"], source.amount)
        if not balance_check["valid"]:
            raise HTTPException(status_code=400, detail=f"Gateway '{gw['name']}': {balance_check['message']}")
        
        validated_sources.append({"gateway": gw, "wallet": wallet, "amount": source.amount})
    
    # Build transaction
    transaction_id_readable = await generate_transaction_id(db, "type_02")
    customer_readable_id = customer.get("customer_id", "")
    user_email = auth["user"].get("email", "")
    ip_address = request.client.host if request.client else ""
    user_agent = request.headers.get("user-agent", "")[:255]
    
    transaction = Transaction(
        transaction_id=transaction_id_readable,
        transaction_type="type_02",
        customer_id=data.customer_id,
        customer_readable_id=customer_readable_id,
        customer_name=customer["name"],
        card_id=data.card_id,
        card_details=f"{card['bank_name']} - {card['card_network_name']} - {card['last_four_digits']}",
        pay_to_card_amount=data.pay_to_card_amount,
        total_pay_to_card=data.pay_to_card_amount,
        pay_sources_count=len(data.pay_sources),
        pending_swipe_amount=data.pay_to_card_amount,
        status="pending_swipe",
        user_email=user_email,
        ip_address=ip_address,
        user_agent=user_agent,
        notes=data.notes,
        created_by=auth["user"]["id"],
        created_by_name=auth["user"]["name"]
    )
    
    doc = transaction.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    doc['checksum'] = generate_transaction_checksum(doc)
    
    await db.transactions.insert_one(doc)
    
    # Process each pay source - debit gateway wallets (with rollback on failure)
    now_iso = datetime.now(timezone.utc).isoformat()
    completed_debits = []  # Track for rollback: [{wallet_id, amount, op_id, pay_source_id}]
    
    try:
        for vs in validated_sources:
            gw = vs["gateway"]
            wallet = vs["wallet"]
            amount = vs["amount"]
            
            updated_wallet = await db.wallets.find_one_and_update(
                {"id": wallet["id"], "balance": {"$gte": amount}},
                {
                    "$inc": {"balance": -amount},
                    "$set": {"updated_at": now_iso}
                },
                return_document=True,
                projection={"_id": 0}
            )
            
            if not updated_wallet:
                raise Exception(f"Insufficient balance in '{gw['name']}' wallet (concurrent update)")
            
            balance_after = updated_wallet.get("balance", 0)
            balance_before = balance_after + amount
            
            op_id = await generate_operation_id(db)
            seq = await get_next_operation_sequence(db, wallet["id"])
            
            wallet_op = WalletOperation(
                operation_id=op_id,
                wallet_id=wallet["id"],
                wallet_name=wallet["name"],
                wallet_type="gateway",
                operation_type="debit",
                amount=amount,
                balance_before=balance_before,
                balance_after=balance_after,
                reference_id=transaction.id,
                reference_type="transaction",
                transaction_id=transaction_id_readable,
                customer_id=customer_readable_id,
                notes=f"Pay to card via {gw['name']}",
                created_by=auth["user"]["id"],
                created_by_name=auth["user"]["name"]
            )
            wallet_doc = wallet_op.model_dump()
            wallet_doc['created_at'] = now_iso
            wallet_doc['updated_at'] = now_iso
            wallet_doc['sequence_number'] = seq
            await db.wallet_operations.insert_one(wallet_doc)
            
            import uuid
            pay_source_id = str(uuid.uuid4())
            pay_source_doc = {
                "id": pay_source_id,
                "transaction_id": transaction.id,
                "gateway_id": gw["id"],
                "gateway_name": gw["name"],
                "amount": amount,
                "wallet_operation_id": op_id,
                "status": "completed",
                "refunded_at": None,
                "created_at": now_iso,
                "created_by": auth["user"]["id"],
                "created_by_name": auth["user"]["name"]
            }
            await db.transaction_pay_sources.insert_one(pay_source_doc)
            
            completed_debits.append({
                "wallet_id": wallet["id"],
                "amount": amount,
                "op_id": op_id,
                "pay_source_id": pay_source_id
            })
    except Exception as e:
        # ROLLBACK: Reverse all completed debits
        rollback_success = True
        for cd in completed_debits:
            ok = await rollback_wallet_debit(db, cd["wallet_id"], cd["amount"], cd["op_id"])
            if ok:
                await db.transaction_pay_sources.delete_one({"id": cd["pay_source_id"]})
            else:
                rollback_success = False
        
        # Delete the transaction document
        await db.transactions.delete_one({"id": transaction.id})
        
        await log_operation_failure(
            db, "type02_create", transaction.id, "pay_source_debit",
            [f"debit_{cd['wallet_id']}" for cd in completed_debits],
            str(e), "complete" if rollback_success else "partial",
            user_id=auth["user"]["id"]
        )
        
        raise HTTPException(status_code=400, detail=str(e))
    
    await db.customers.update_one(
        {"id": data.customer_id},
        {"$set": {"updated_at": now_iso}}
    )
    
    # BUG-S3-07 FIX: wrap collection insert in try/except so a DB failure here
    # rolls back the transaction + all wallet debits (no orphaned Type 02 transaction)
    try:
        pending_payment_id_val = await get_pending_payment_id(db)
        collection_doc = {
            "id": str(uuid.uuid4()),
            "pending_payment_id": pending_payment_id_val,
            "transaction_id": transaction.id,
            "transaction_id_readable": transaction_id_readable,
            "customer_id": data.customer_id,
            "customer_name": customer["name"],
            "customer_readable_id": customer_readable_id,
            "customer_phone": customer.get("phone", ""),
            "amount": data.pay_to_card_amount,
            "settled_amount": 0,
            "total_charges": 0,
            "status": "pending",
            "settlements": [],
            "source": "type_02_transaction",
            "card_id": data.card_id,
            "card_details": f"{card['bank_name']} - {card['card_network_name']} - {card['last_four_digits']}",
            "notes": data.notes or "",
            "created_by": auth["user"]["id"],
            "created_by_name": auth["user"]["name"],
            "created_at": now_iso,
            "updated_at": now_iso,
            "is_deleted": False
        }
        await db.collections.insert_one(collection_doc)
        logger.info(f"Created collection {collection_doc['id']} (PP: {pending_payment_id_val}) for Type 02 transaction {transaction_id_readable}")
    except Exception as e:
        # Rollback: delete transaction and reverse all pay-source wallet debits
        await db.transactions.delete_one({"id": transaction.id})
        for cd in completed_debits:
            ok = await rollback_wallet_debit(db, cd["wallet_id"], cd["amount"], cd["op_id"])
            if ok:
                await db.transaction_pay_sources.delete_one({"id": cd["pay_source_id"]})
        await log_operation_failure(
            db, "type02_create_collection", transaction.id, "collections_insert",
            ["transaction_insert"] + [f"debit_{cd['wallet_id']}" for cd in completed_debits],
            str(e), "complete",
            user_id=auth["user"]["id"]
        )
        raise HTTPException(status_code=500, detail=f"Failed to create collection record and transaction was rolled back: {str(e)}")

    # FIX: Set pay_to_card_gateway fields from primary pay source (first validated source)
    if validated_sources:
        primary_gw = validated_sources[0]["gateway"]
        pay_sources_embedded = [
            {"gateway_id": vs["gateway"]["id"], "gateway_name": vs["gateway"]["name"],
             "wallet_id": vs["wallet"]["id"], "wallet_name": vs["wallet"]["name"],
             "amount": vs["amount"]}
            for vs in validated_sources
        ]
        await db.transactions.update_one(
            {"id": transaction.id},
            {"$set": {
                "pay_to_card_gateway_id": primary_gw["id"],
                "pay_to_card_gateway_name": primary_gw["name"],
                "pay_sources": pay_sources_embedded,
            }}
        )
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "create", "transactions", transaction.id, {
        "type": "type_02",
        "customer": customer["name"],
        "pay_to_card": data.pay_to_card_amount,
        "pay_sources": len(data.pay_sources),
        "collection_id": collection_doc["id"]
    }, ip=ip_address)
    
    # Return fresh doc excluding _id
    final_doc = await db.transactions.find_one({"id": transaction.id}, {"_id": 0})
    return serialize_doc(final_doc)


# ============== TRANSACTION REVERSAL ==============

class ReverseTransactionRequest(BaseModel):
    reason: str = Field(..., min_length=10, max_length=500)


@router.post("/transactions/{transaction_id}/reverse")
async def reverse_transaction(
    transaction_id: str,
    data: ReverseTransactionRequest,
    request: Request,
    auth: dict = Depends(auth_required)
):
    """Reverse/void a transaction"""
    await check_permission(auth, "transactions")
    reason = data.reason
    
    transaction = await db.transactions.find_one({"id": transaction_id, "is_deleted": False}, {"_id": 0})
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    if transaction.get("status") == "reversed":
        raise HTTPException(status_code=400, detail="Transaction already reversed")
    
    if transaction.get("is_locked"):
        raise HTTPException(status_code=400, detail="Cannot reverse locked transaction")
    
    if transaction["transaction_type"] == "type_01":
        if transaction.get("amount_paid_to_customer", 0) > 0:
            raise HTTPException(status_code=400, detail="Cannot reverse - payments already made to customer")
    
    if transaction["transaction_type"] == "type_02":
        # Cancel-first: atomically cancel unsettled collections to prevent race with concurrent settlements
        _rev_now = datetime.now(timezone.utc).isoformat()
        await db.collections.update_many(
            {"transaction_id": transaction_id, "source": {"$ne": "service_charge"},
             "status": "pending", "settled_amount": {"$lte": 0}, "is_deleted": False},
            {"$set": {"status": "cancelled", "updated_at": _rev_now}}
        )
        # Check if any main collections have received payments
        partially_paid = await db.collections.find_one(
            {"transaction_id": transaction_id, "source": {"$ne": "service_charge"},
             "status": {"$nin": ["cancelled"]}, "settled_amount": {"$gt": 0}, "is_deleted": False},
            {"_id": 0}
        )
        if partially_paid:
            # Rollback: restore cancelled collections
            await db.collections.update_many(
                {"transaction_id": transaction_id, "source": {"$ne": "service_charge"},
                 "status": "cancelled", "settled_amount": {"$lte": 0}, "is_deleted": False},
                {"$set": {"status": "pending", "updated_at": _rev_now}}
            )
            raise HTTPException(
                status_code=400,
                detail="Cannot reverse — one or more collections have already received partial or full payment"
            )
    
    reversal_details = {
        "reversed_at": datetime.now(timezone.utc).isoformat(),
        "reversed_by": auth["user"]["id"],
        "reversed_by_name": auth["user"]["name"],
        "reversal_reason": reason,
        "original_status": transaction["status"]
    }
    
    async def reverse_wallet(gateway_id, op_type, amount, notes):
        # BUG-01 FIX: use find_one_and_update with $inc (atomic) instead of $set (non-atomic read-modify-write)
        inc_amount = amount if op_type == "credit" else -amount
        updated_gw = await db.wallets.find_one_and_update(
            {"wallet_type": "gateway", "gateway_id": gateway_id, "is_deleted": False},
            {
                "$inc": {"balance": inc_amount},
                "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
            },
            return_document=True,
            projection={"_id": 0}
        )
        if not updated_gw:
            raise Exception(f"Gateway wallet for gateway_id={gateway_id} not found — reversal aborted")

        balance_after = updated_gw.get("balance", 0)
        balance_before = balance_after - inc_amount

        # Alert on negative wallet balance after reversal
        if balance_after < 0:
            try:
                await db.system_alerts.insert_one({
                    "type": "negative_wallet_balance",
                    "severity": "warning",
                    "message": f"Gateway wallet '{updated_gw.get('name', '')}' went negative ({balance_after:.2f}) after reversing transaction {transaction.get('transaction_id', transaction_id)}",
                    "wallet_id": updated_gw["id"],
                    "balance": balance_after,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
            except Exception:
                logger.warning(f"Negative wallet balance after reversal: {updated_gw['id']} = {balance_after}")

        # BUG-A FIX: generate operation_id and sequence_number for reversal wallet ops
        rev_op_id = await generate_operation_id(db)
        rev_seq = await get_next_operation_sequence(db, updated_gw["id"])

        op = WalletOperation(
            operation_id=rev_op_id,
            wallet_id=updated_gw["id"],
            wallet_name=updated_gw["name"],
            wallet_type="gateway",
            operation_type=op_type,
            amount=amount,
            balance_before=balance_before,
            balance_after=balance_after,
            reference_id=transaction_id,
            reference_type="reversal",
            notes=notes,
            created_by=auth["user"]["id"],
            created_by_name=auth["user"]["name"]
        )
        op_doc = op.model_dump()
        op_doc['created_at'] = op_doc['created_at'].isoformat()
        op_doc['updated_at'] = op_doc['updated_at'].isoformat()
        op_doc['sequence_number'] = rev_seq
        await db.wallet_operations.insert_one(op_doc)
    
    if transaction["transaction_type"] == "type_01":
        net_received = transaction["swipe_amount"] - transaction["gateway_charge_amount"]
        await reverse_wallet(transaction["swipe_gateway_id"], "debit", net_received, f"Reversal: {reason}")
        reversal_details["gateway_balance_reversed"] = net_received
    
    elif transaction["transaction_type"] == "type_02":
        # Refund ALL pay sources from transaction_pay_sources (not just single legacy field)
        pay_sources = await db.transaction_pay_sources.find({
            "transaction_id": transaction_id,
            "status": {"$ne": "refunded"}
        }, {"_id": 0}).to_list(100)
        
        refunded_sources = []
        for ps in pay_sources:
            await reverse_wallet(ps["gateway_id"], "credit", ps["amount"], f"Reversal credit: {reason}")
            await db.transaction_pay_sources.update_one(
                {"id": ps["id"]},
                {"$set": {"status": "refunded", "refunded_at": datetime.now(timezone.utc).isoformat()}}
            )
            refunded_sources.append({"gateway_id": ps["gateway_id"], "gateway_name": ps.get("gateway_name", ""), "amount": ps["amount"]})
        
        reversal_details["pay_sources_refunded"] = refunded_sources
        reversal_details["pay_sources_count"] = len(refunded_sources)
        
        # CASCADE: Reverse sub-settlements and cancel service_charge collections BEFORE bulk cancel
        sc_collections = await db.collections.find(
            {"transaction_id": transaction_id, "source": "service_charge", "status": {"$nin": ["cancelled"]}, "is_deleted": {"$ne": True}},
            {"_id": 0}
        ).to_list(100)
        for sc in sc_collections:
            now_iso = datetime.now(timezone.utc).isoformat()
            for sub in sc.get("settlements", []):
                if sub.get("voided"):
                    continue
                sub_credit = sub.get("wallet_credit_amount") or sub.get("gross_amount") or sub.get("amount", 0)
                sub_wid = sub.get("wallet_id")
                if sub_wid and sub_credit > 0:
                    sub_w = await db.wallets.find_one_and_update(
                        {"id": sub_wid, "balance": {"$gte": sub_credit}},
                        {"$inc": {"balance": -sub_credit}, "$set": {"updated_at": now_iso}},
                        return_document=True, projection={"_id": 0}
                    )
                    if sub_w:
                        rev_op_id = await generate_operation_id(db)
                        rev_seq = await get_next_operation_sequence(db, sub_wid)
                        rev_op = WalletOperation(
                            operation_id=rev_op_id, wallet_id=sub_wid,
                            wallet_name=sub_w["name"], wallet_type=sub_w.get("wallet_type", ""),
                            operation_type="debit", amount=sub_credit,
                            balance_before=sub_w["balance"] + sub_credit,
                            balance_after=sub_w["balance"],
                            reference_id=sc["id"],
                            reference_type="reversal_cascade",
                            notes="Transaction reversal: service charge settlement reversed",
                            created_by=auth["user"]["id"], created_by_name=auth["user"]["name"],
                        )
                        rev_doc = rev_op.model_dump()
                        rev_doc["created_at"] = now_iso
                        rev_doc["updated_at"] = now_iso
                        rev_doc["sequence_number"] = rev_seq
                        await db.wallet_operations.insert_one(rev_doc)
                # Mark sub-settlement as voided
                await db.collections.update_one(
                    {"id": sc["id"], "settlements.id": sub["id"]},
                    {"$set": {"settlements.$.voided": True, "settlements.$.voided_at": now_iso}}
                )
            await db.collections.update_one(
                {"id": sc["id"]},
                {"$set": {"status": "cancelled", "updated_at": now_iso}}
            )
        # Bulk cancel remaining non-settled collections (after cascade has reversed service_charge settlements)
        await db.collections.update_many(
            {"transaction_id": transaction_id, "status": {"$nin": ["settled", "cancelled"]}},
            {"$set": {"status": "cancelled", "updated_at": datetime.now(timezone.utc).isoformat()}}
        )
        reversal_details["pending_payment_cancelled"] = True
    
    await db.transactions.update_one(
        {"id": transaction_id},
        {"$set": {
            "status": "reversed",
            # BUG-04 FIX: zero out pending payout so dashboard/pending-stats exclude it
            "amount_remaining_to_customer": 0,
            # BUG-4 FIX (similar): zero pending_amount so reports don't show stale customer-owed balance
            "pending_amount": 0,
            # P1-5 FIX: zero pending_swipe_amount on reversal
            "pending_swipe_amount": 0,
            # BUG-10 FIX: zero commission and gateway charge so reversed txns don't inflate reports
            "commission_amount": 0,
            "gateway_charge_amount": 0,
            "reversal_details": reversal_details,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )

    # BUG-02 FIX: soft-delete auto-created PG charge expenses for this transaction
    # BUG-S3-05 FIX: use only transaction_id field (remove fragile description regex
    # that matches T01-0001 as substring of T01-00010..T01-00019)
    readable_txn_id = transaction.get("transaction_id", "")
    if readable_txn_id:
        await db.expenses.update_many(
            {
                "is_auto_created": True,
                "is_deleted": False,
                "transaction_id": readable_txn_id
            },
            {"$set": {"is_deleted": True, "updated_at": datetime.now(timezone.utc).isoformat()}}
        )
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "reverse", "transactions", transaction_id, {
        "type": transaction["transaction_type"],
        "amount": transaction["swipe_amount"],
        "reason": reason
    }, ip=request.client.host if request.client else "")
    
    return {"message": "Transaction reversed successfully", "transaction_id": transaction_id, "reversal_details": reversal_details}
