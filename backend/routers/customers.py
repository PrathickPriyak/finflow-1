"""
Customers Router - Customer management and cards
"""
from fastapi import APIRouter, HTTPException, Depends, Query, Request
from datetime import datetime, timezone
from typing import Optional
import re

from core.database import db
from core.dependencies import auth_required, check_permission, log_audit
from utils import serialize_doc, serialize_docs, validate_phone, normalize_phone, generate_customer_id, sanitize_text
from models import Customer, CustomerCreate, CustomerUpdate, CustomerCard, CustomerCardCreate
import logging

router = APIRouter(tags=["Customers"])
logger = logging.getLogger(__name__)


@router.get("/customers")
async def get_customers(
    search: Optional[str] = None,
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(50, ge=1, le=100, description="Items per page"),
    auth: dict = Depends(auth_required)
):
    """Get all customers with optional search and pagination"""
    query = {"is_deleted": False}
    
    if search:
        # SEC-06 FIX: Escape regex special characters to prevent ReDoS attacks
        escaped_search = re.escape(search)
        query["phone"] = {"$regex": escaped_search, "$options": "i"}
    
    total = await db.customers.count_documents(query)
    skip = (page - 1) * limit
    
    customers = await db.customers.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    
    return {
        "data": serialize_docs(customers),
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "pages": (total + limit - 1) // limit
        }
    }


@router.get("/customers/recent")
async def get_recent_customers(auth: dict = Depends(auth_required)):
    """Get last 5 customers"""
    customers = await db.customers.find(
        {"is_deleted": False}, 
        {"_id": 0}
    ).sort("updated_at", -1).limit(5).to_list(5)
    return serialize_docs(customers)


@router.get("/customers/{customer_id}")
async def get_customer(
    customer_id: str,
    txn_page: int = Query(1, ge=1),
    txn_limit: int = Query(50, ge=1, le=100),
    auth: dict = Depends(auth_required)
):
    """Get customer by ID with paginated transaction history"""
    customer = await db.customers.find_one({"id": customer_id, "is_deleted": False}, {"_id": 0})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    
    txn_query = {"customer_id": customer_id, "is_deleted": False}
    txn_total = await db.transactions.count_documents(txn_query)
    txn_skip = (txn_page - 1) * txn_limit
    transactions = await db.transactions.find(
        txn_query, {"_id": 0}
    ).sort("created_at", -1).skip(txn_skip).limit(txn_limit).to_list(txn_limit)
    
    collections = await db.collections.find(
        {"customer_id": customer_id, "is_deleted": False, "status": {"$ne": "settled"}},
        {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    
    return {
        "customer": serialize_doc(customer),
        "transactions": serialize_docs(transactions),
        "transactions_pagination": {
            "page": txn_page,
            "limit": txn_limit,
            "total": txn_total,
            "pages": (txn_total + txn_limit - 1) // txn_limit
        },
        "collections": serialize_docs(collections)
    }


@router.get("/customers/{customer_id}/credit-score")
async def get_customer_credit_score(customer_id: str, auth: dict = Depends(auth_required)):
    """Calculate real-time credit score (0-100) based on payment/settlement behavior."""
    from datetime import timedelta
    
    customer = await db.customers.find_one({"id": customer_id, "is_deleted": False}, {"_id": 0, "id": 1, "name": 1})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    
    now = datetime.now(timezone.utc)
    
    # 1. Settlement speed (30 pts) — avg days from collection creation to settlement
    settlement_days_pipeline = [
        {"$match": {"customer_id": customer_id, "is_deleted": False, "status": {"$in": ["settled", "overpaid"]}}},
        {"$unwind": "$settlements"},
        {"$match": {"settlements.voided": {"$ne": True}}},
        {"$project": {
            "created": "$created_at",
            "settled": "$settlements.settled_at",
        }},
    ]
    settlement_records = await db.collections.aggregate(settlement_days_pipeline).to_list(500)
    
    avg_days = 0
    if settlement_records:
        total_days = 0
        valid_count = 0
        for r in settlement_records:
            try:
                created = datetime.fromisoformat(str(r["created"]).replace("Z", "+00:00"))
                settled = datetime.fromisoformat(str(r["settled"]).replace("Z", "+00:00"))
                days = max(0, (settled - created).total_seconds() / 86400)
                total_days += days
                valid_count += 1
            except (ValueError, TypeError):
                logger.debug(f"Bad date in settlement speed calc for {customer_id}")
                continue
        avg_days = total_days / valid_count if valid_count > 0 else 0
    
    # Score: 0 days = 30pts, 7 days = 20pts, 30 days = 5pts, 60+ days = 0pts
    if avg_days <= 1:
        speed_score = 30
    elif avg_days <= 7:
        speed_score = round(30 - (avg_days - 1) * (10 / 6), 1)
    elif avg_days <= 30:
        speed_score = round(20 - (avg_days - 7) * (15 / 23), 1)
    else:
        speed_score = max(0, round(5 - (avg_days - 30) * (5 / 30), 1))
    
    # 2. Overdue frequency (25 pts) — % of collections settled within 7 days
    all_collections = await db.collections.find(
        {"customer_id": customer_id, "is_deleted": False, "source": {"$ne": "service_charge"}},
        {"_id": 0, "status": 1, "created_at": 1}
    ).to_list(500)
    
    total_colls = len(all_collections)
    overdue_count = 0
    for c in all_collections:
        if c.get("status") in ("pending", "partial"):
            try:
                created = datetime.fromisoformat(str(c["created_at"]).replace("Z", "+00:00"))
                if (now - created).days > 7:
                    overdue_count += 1
            except (ValueError, TypeError):
                logger.debug(f"Bad date in overdue calc for {customer_id}")
                continue
    
    overdue_ratio = overdue_count / total_colls if total_colls > 0 else 0
    overdue_score = round((1 - overdue_ratio) * 25, 1)
    
    # 3. Payment completion rate (25 pts) — % of collections fully settled
    settled_colls = sum(1 for c in all_collections if c.get("status") in ("settled", "overpaid"))
    completion_rate = settled_colls / total_colls if total_colls > 0 else 1.0
    completion_score = round(completion_rate * 25, 1)
    
    # 4. Transaction volume & history (20 pts) — more history = more reliable
    txn_count = await db.transactions.count_documents(
        {"customer_id": customer_id, "is_deleted": False, "status": {"$ne": "reversed"}}
    )
    # Score: 0 txns = 5pts (new customer benefit of doubt), 5+ = 15pts, 20+ = 20pts
    if txn_count == 0:
        volume_score = 5
    elif txn_count < 5:
        volume_score = round(5 + txn_count * 2, 1)
    elif txn_count < 20:
        volume_score = round(15 + (txn_count - 5) * (5 / 15), 1)
    else:
        volume_score = 20
    
    total_score = round(min(100, speed_score + overdue_score + completion_score + volume_score))
    
    # Grade
    if total_score >= 80:
        grade = "Excellent"
        grade_color = "emerald"
    elif total_score >= 60:
        grade = "Good"
        grade_color = "blue"
    elif total_score >= 40:
        grade = "Fair"
        grade_color = "amber"
    else:
        grade = "Poor"
        grade_color = "red"
    
    return {
        "customer_id": customer_id,
        "customer_name": customer.get("name", ""),
        "score": total_score,
        "grade": grade,
        "grade_color": grade_color,
        "components": [
            {"name": "Settlement Speed", "score": speed_score, "max": 30,
             "detail": f"Avg {avg_days:.1f} days to settle"},
            {"name": "Overdue Frequency", "score": overdue_score, "max": 25,
             "detail": f"{overdue_count} overdue of {total_colls} collections"},
            {"name": "Completion Rate", "score": completion_score, "max": 25,
             "detail": f"{settled_colls}/{total_colls} collections settled ({completion_rate*100:.0f}%)"},
            {"name": "Transaction History", "score": volume_score, "max": 20,
             "detail": f"{txn_count} transactions"},
        ],
        "stats": {
            "total_collections": total_colls,
            "settled_collections": settled_colls,
            "overdue_collections": overdue_count,
            "avg_settlement_days": round(avg_days, 1),
            "total_transactions": txn_count,
        }
    }



@router.post("/customers")
async def create_customer(data: CustomerCreate, request: Request, auth: dict = Depends(auth_required)):
    """Create new customer"""
    await check_permission(auth, "customers")
    
    if not validate_phone(data.phone):
        raise HTTPException(status_code=400, detail="Invalid phone number. Use 10-digit Indian mobile number.")
    
    normalized_phone = normalize_phone(data.phone)
    
    existing = await db.customers.find_one({"phone": normalized_phone, "is_deleted": False}, {"_id": 0})
    if existing:
        raise HTTPException(
            status_code=400, 
            detail=f"Customer with mobile number {normalized_phone} already exists: {existing.get('name', '')} ({existing.get('customer_id', '')})"
        )
    
    customer_id_readable = await generate_customer_id(db)
    
    customer = Customer(
        customer_id=customer_id_readable,
        name=sanitize_text(data.name),
        phone=normalized_phone,
        id_proof=sanitize_text(data.id_proof) if data.id_proof else "",
        charge_note=sanitize_text(data.charge_note) if data.charge_note else "",
        notes=sanitize_text(data.notes) if data.notes else ""
    )
    doc = customer.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.customers.insert_one(doc)
    doc.pop("_id", None)
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "create", "customers", customer.id, {
        "customer_id": customer_id_readable,
        "name": data.name,
        "phone": normalized_phone
    }, ip=request.client.host if request.client else "")
    
    return serialize_doc(doc)


@router.put("/customers/{customer_id}")
async def update_customer(customer_id: str, data: CustomerUpdate, request: Request, auth: dict = Depends(auth_required)):
    """Update customer"""
    await check_permission(auth, "customers")
    
    customer = await db.customers.find_one({"id": customer_id, "is_deleted": False}, {"_id": 0})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    
    if "phone" in update_data:
        if not validate_phone(update_data["phone"]):
            raise HTTPException(status_code=400, detail="Invalid phone number")
        normalized_phone = normalize_phone(update_data["phone"])
        
        existing = await db.customers.find_one({
            "phone": normalized_phone, 
            "is_deleted": False,
            "id": {"$ne": customer_id}
        }, {"_id": 0})
        if existing:
            raise HTTPException(
                status_code=400, 
                detail=f"Mobile number {normalized_phone} already belongs to: {existing.get('name', '')} ({existing.get('customer_id', '')})"
            )
        update_data["phone"] = normalized_phone
    
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    await db.customers.update_one({"id": customer_id}, {"$set": update_data})
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "update", "customers", customer_id, update_data, ip=request.client.host if request.client else "")
    
    updated = await db.customers.find_one({"id": customer_id}, {"_id": 0})
    return serialize_doc(updated)


@router.delete("/customers/{customer_id}")
async def delete_customer(customer_id: str, request: Request, auth: dict = Depends(auth_required)):
    """Soft delete customer"""
    await check_permission(auth, "customers")
    
    customer = await db.customers.find_one({"id": customer_id, "is_deleted": False}, {"_id": 0})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    
    # AUDIT-FIX-02: Safety check — prevent deleting customers with active financial records
    pending_collections = await db.collections.count_documents({
        "customer_id": customer_id, "is_deleted": False, "status": {"$ne": "settled"}
    })
    if pending_collections > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete: customer has {pending_collections} pending collection(s)")
    
    pending_payouts = await db.transactions.count_documents({
        "customer_id": customer_id, "is_deleted": False,
        "amount_remaining_to_customer": {"$gt": 0}
    })
    if pending_payouts > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete: customer has {pending_payouts} pending payout(s)")
    
    await db.customers.update_one({"id": customer_id}, {"$set": {"is_deleted": True, "updated_at": datetime.now(timezone.utc).isoformat()}})
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "delete", "customers", customer_id, {"name": customer["name"]}, ip=request.client.host if request.client else "")
    
    return {"message": "Customer deleted successfully"}


# ============== CUSTOMER CARDS ==============

@router.post("/customers/{customer_id}/cards")
async def add_customer_card(customer_id: str, data: CustomerCardCreate, request: Request, auth: dict = Depends(auth_required)):
    """Add card to customer"""
    await check_permission(auth, "customers")
    
    customer = await db.customers.find_one({"id": customer_id, "is_deleted": False}, {"_id": 0})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    
    bank = await db.banks.find_one({"id": data.bank_id, "is_deleted": False}, {"_id": 0})
    network = await db.card_networks.find_one({"id": data.card_network_id, "is_deleted": False}, {"_id": 0})
    
    if not bank:
        raise HTTPException(status_code=400, detail="Bank not found")
    if not network:
        raise HTTPException(status_code=400, detail="Card network not found")
    
    if not data.last_four_digits.isdigit() or len(data.last_four_digits) != 4:
        raise HTTPException(status_code=400, detail="Last 4 digits must be exactly 4 numbers")
    
    # Duplicate card check — same bank + network + last 4 digits
    for existing_card in customer.get("cards", []):
        if (existing_card.get("bank_id") == data.bank_id and
            existing_card.get("card_network_id") == data.card_network_id and
            existing_card.get("last_four_digits") == data.last_four_digits):
            raise HTTPException(status_code=400, detail=f"Card already exists: {bank['name']} {network['name']} ending {data.last_four_digits}")

    card = CustomerCard(
        bank_id=data.bank_id,
        bank_name=bank["name"],
        card_network_id=data.card_network_id,
        card_network_name=network["name"],
        last_four_digits=data.last_four_digits
    )
    
    await db.customers.update_one(
        {"id": customer_id},
        {
            "$push": {"cards": card.model_dump()},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
        }
    )
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "add_card", "customers", customer_id, {
        "bank": bank["name"],
        "network": network["name"],
        "last_four": data.last_four_digits
    }, ip=request.client.host if request.client else "")
    
    return card.model_dump()


@router.delete("/customers/{customer_id}/cards/{card_id}")
async def remove_customer_card(customer_id: str, card_id: str, request: Request, auth: dict = Depends(auth_required)):
    """Remove card from customer"""
    await check_permission(auth, "customers")
    
    customer = await db.customers.find_one({"id": customer_id, "is_deleted": False}, {"_id": 0})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    
    # BUG-7 FIX: Check if card is referenced by active transactions
    active_txns = await db.transactions.count_documents({
        "is_deleted": False,
        "customer_id": customer_id,
        "card_id": card_id,
        "status": {"$in": ["pending", "pending_swipe", "partially_completed", "payment_pending"]}
    })
    if active_txns > 0:
        raise HTTPException(status_code=400, detail=f"Cannot remove: card is referenced by {active_txns} active transaction(s)")
    
    await db.customers.update_one(
        {"id": customer_id},
        {
            "$pull": {"cards": {"id": card_id}},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
        }
    )
    
    await log_audit(auth["user"]["id"], auth["user"]["name"], "remove_card", "customers", customer_id, {"card_id": card_id}, ip=request.client.host if request.client else "")
    
    return {"message": "Card removed successfully"}


@router.get("/customers/{customer_id}/ledger")
async def download_customer_ledger(
    customer_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    request: Request = None,
    auth: dict = Depends(auth_required)
):
    """Download full customer ledger as Excel — transactions, payments, collections, wallet ops with running balance."""
    from fastapi.responses import StreamingResponse
    from utils import validate_date_param
    import xlsxwriter
    import io

    if date_from:
        date_from = validate_date_param(date_from, "date_from")
    if date_to:
        date_to = validate_date_param(date_to, "date_to")

    customer = await db.customers.find_one({"id": customer_id, "is_deleted": False}, {"_id": 0})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    settings = await db.settings.find_one({"id": "app_settings"}, {"_id": 0})
    business_name = settings.get("business_name", "Fin Flow") if settings else "Fin Flow"

    # Date filter
    date_query = {}
    if date_from:
        date_query["$gte"] = date_from
    if date_to:
        date_query["$lte"] = date_to + "T23:59:59.999999"

    # ── Fetch all data ──
    txn_query = {"customer_id": customer_id, "is_deleted": False}
    if date_query:
        txn_query["created_at"] = date_query
    transactions = await db.transactions.find(txn_query, {"_id": 0}).sort("created_at", 1).to_list(10000)
    txn_ids = [t["id"] for t in transactions]

    pay_query = {"customer_id": customer_id, "is_deleted": False}
    if date_query:
        pay_query["created_at"] = date_query
    payments = await db.payments.find(pay_query, {"_id": 0}).sort("created_at", 1).to_list(10000)

    coll_query = {"customer_id": customer_id, "is_deleted": False}
    if date_query:
        coll_query["created_at"] = date_query
    collections = await db.collections.find(coll_query, {"_id": 0}).sort("created_at", 1).to_list(10000)

    # Wallet operations for this customer's transactions
    op_query = {"transaction_id": {"$in": [t.get("transaction_id", "") for t in transactions]}}
    if not op_query["transaction_id"]["$in"]:
        op_query = {"reference_id": {"$in": txn_ids}}
    wallet_ops = await db.wallet_operations.find(op_query, {"_id": 0}).sort("created_at", 1).to_list(10000)

    # ── Build ledger entries ──
    entries = []

    for t in transactions:
        tid = t.get("transaction_id", "")
        is_reversed = t.get("status") == "reversed"
        voided_tag = " [REVERSED]" if is_reversed else ""

        if t.get("transaction_type") == "type_01":
            # Type 01: Business owes customer (debit)
            commission = t.get("commission_amount", 0) or 0
            pg = t.get("gateway_charge_amount", 0) or 0
            to_cust = t.get("amount_to_customer", 0) or 0
            entries.append({
                "date": t.get("created_at", ""),
                "txn_id": tid,
                "description": f"Direct Swipe — {t.get('card_details', '')}{voided_tag}",
                "type": "Transaction",
                "debit": to_cust if not is_reversed else 0,
                "credit": 0,
                "commission": commission,
                "pg_charges": pg,
                "gateway": t.get("swipe_gateway_name", ""),
                "notes": t.get("notes", ""),
                "voided": is_reversed,
            })
        elif t.get("transaction_type") == "type_02":
            # Type 02: Pay to card creates a collection (customer owes business)
            ptc = t.get("pay_to_card_amount", 0) or 0
            entries.append({
                "date": t.get("created_at", ""),
                "txn_id": tid,
                "description": f"Pay to Card — {t.get('card_details', '')}{voided_tag}",
                "type": "Transaction",
                "debit": 0,
                "credit": 0,  # No immediate debit/credit to customer — tracked via collection
                "commission": 0,
                "pg_charges": 0,
                "gateway": t.get("pay_to_card_gateway_name", ""),
                "notes": f"₹{ptc:,.2f} paid to card" + (f". {t.get('notes','')}" if t.get("notes") else ""),
                "voided": is_reversed,
            })

    # Payments (money paid TO customer — debit from business perspective)
    for p in payments:
        is_voided = p.get("is_voided", False) or p.get("is_deleted", False)
        voided_tag = " [VOIDED]" if is_voided else ""
        is_adjustment = p.get("payment_method") == "balance_adjustment"
        adj_tag = f" [{p.get('adjustment_readable_id', 'ADJ')}]" if is_adjustment else ""
        if is_adjustment:
            description = f"Balance Adjustment — set-off against collection{adj_tag}{voided_tag}"
        else:
            description = f"Payment to Customer via {p.get('source_name', p.get('wallet_name', ''))}{voided_tag}"
        entries.append({
            "date": p.get("created_at", ""),
            "txn_id": p.get("transaction_id_readable", ""),
            "description": description,
            "type": "Adjustment" if is_adjustment else "Payment",
            "debit": 0 if is_voided else -(p.get("amount", 0)),  # Negative debit = reduces what we owe
            "credit": 0,
            "commission": 0,
            "pg_charges": 0,
            "gateway": "",
            "notes": p.get("notes", ""),
            "voided": is_voided,
        })

    # Collections and settlements
    for c in collections:
        source = c.get("source", "type_02_transaction")
        is_sc = source == "service_charge"
        is_cancelled = c.get("status") == "cancelled"

        for s in c.get("settlements", []):
            is_voided = s.get("voided", False)
            voided_tag = " [VOIDED]" if is_voided else ""
            cancelled_tag = " [CANCELLED]" if is_cancelled else ""
            method = s.get("method", "cash").replace("_", " ").title()
            principal = s.get("principal_amount", s.get("amount", 0)) or 0
            commission = s.get("commission_amount", 0) or 0
            pg = s.get("pg_amount", 0) or 0

            entries.append({
                "date": s.get("settled_at", c.get("created_at", "")),
                "txn_id": c.get("transaction_id_readable", ""),
                "description": f"{'Service Charge ' if is_sc else ''}Collection — {method}{voided_tag}{cancelled_tag}",
                "type": "Collection",
                "debit": 0,
                "credit": principal if not is_voided else 0,
                "commission": commission if not is_voided else 0,
                "pg_charges": pg if not is_voided else 0,
                "gateway": s.get("gateway_name", ""),
                "notes": s.get("notes", ""),
                "voided": is_voided or is_cancelled,
            })

    # Wallet operations
    for op in wallet_ops:
        ref_type = op.get("reference_type", "")
        # Skip operations already captured above (transactions, payments, collections)
        if ref_type in ("transaction", "customer_payment", "bulk_customer_payment",
                        "collection_card_swipe", "collection_cash", "collection_bank_transfer",
                        "bulk_collection", "bulk_unified_collection_card_swipe",
                        "bulk_unified_collection_cash", "bulk_unified_collection_bank_transfer"):
            continue
        # Include reversals, voids, transfers, and other ops
        op_type = op.get("operation_type", "")
        is_void = ref_type in ("settlement_void", "payment_void", "reversal", "reversal_cascade")
        entries.append({
            "date": op.get("created_at", ""),
            "txn_id": op.get("transaction_id", ""),
            "description": f"Wallet {op_type.title()} — {op.get('wallet_name', '')} ({ref_type.replace('_', ' ')})",
            "type": "Wallet Op",
            "debit": op.get("amount", 0) if op_type == "debit" and not is_void else 0,
            "credit": op.get("amount", 0) if op_type == "credit" and not is_void else 0,
            "commission": 0,
            "pg_charges": 0,
            "gateway": "",
            "notes": op.get("notes", ""),
            "voided": is_void,
        })

    # Sort all entries chronologically
    entries.sort(key=lambda e: e.get("date", "") or "")

    # ── Compute running balance & totals ──
    running_balance = 0
    total_debit = 0
    total_credit = 0
    total_commission = 0
    total_pg = 0
    for e in entries:
        if not e["voided"]:
            running_balance += e["debit"] - e["credit"]
            total_debit += e["debit"]
            total_credit += e["credit"]
        total_commission += e["commission"]
        total_pg += e["pg_charges"]
        e["balance"] = running_balance

    # ── Build Excel ──
    output = io.BytesIO()
    workbook = xlsxwriter.Workbook(output)
    ws = workbook.add_worksheet("Ledger")

    # Formats
    fmt_header = workbook.add_format({"bold": True, "bg_color": "#1e293b", "font_color": "white", "border": 1, "text_wrap": True})
    fmt_title = workbook.add_format({"bold": True, "font_size": 14})
    fmt_subtitle = workbook.add_format({"font_size": 10, "italic": True, "font_color": "#666666"})
    fmt_label = workbook.add_format({"bold": True, "bg_color": "#f1f5f9", "border": 1})
    fmt_value = workbook.add_format({"border": 1})
    fmt_money = workbook.add_format({"num_format": "₹#,##0.00", "border": 1})
    fmt_money_bold = workbook.add_format({"num_format": "₹#,##0.00", "border": 1, "bold": True})
    fmt_voided = workbook.add_format({"border": 1, "font_color": "#999999", "italic": True})
    fmt_voided_money = workbook.add_format({"num_format": "₹#,##0.00", "border": 1, "font_color": "#999999", "italic": True})
    fmt_balance_pos = workbook.add_format({"num_format": "₹#,##0.00", "border": 1, "bold": True, "font_color": "#dc2626"})
    fmt_balance_neg = workbook.add_format({"num_format": "₹#,##0.00", "border": 1, "bold": True, "font_color": "#16a34a"})
    fmt_footer = workbook.add_format({"font_size": 8, "italic": True, "font_color": "#999999"})

    row = 0

    # ── Header Section ──
    ws.write(row, 0, business_name, fmt_title)
    row += 1
    ws.write(row, 0, "Customer Ledger", fmt_subtitle)
    row += 2

    ws.write(row, 0, "Customer:", fmt_label)
    ws.write(row, 1, f"{customer.get('name', '')} ({customer.get('customer_id', '')})", fmt_value)
    row += 1
    ws.write(row, 0, "Phone:", fmt_label)
    ws.write(row, 1, customer.get("phone", ""), fmt_value)
    row += 1
    date_range_str = f"{date_from or 'Start'} to {date_to or 'Present'}"
    ws.write(row, 0, "Period:", fmt_label)
    ws.write(row, 1, date_range_str, fmt_value)
    row += 1
    ws.write(row, 0, "Generated:", fmt_label)
    ws.write(row, 1, datetime.now(timezone.utc).strftime("%d %b %Y, %I:%M %p UTC"), fmt_value)
    row += 2

    # ── Summary Section ──
    ws.write(row, 0, "Summary", workbook.add_format({"bold": True, "font_size": 12, "bottom": 1}))
    row += 1
    summary_items = [
        ("Total Transactions", len(transactions)),
        ("Total Debit (Business Owes)", total_debit),
        ("Total Credit (Customer Paid)", total_credit),
        ("Total Commission Earned", total_commission),
        ("Total PG Charges", total_pg),
        ("Net Outstanding to Customer", max(0, running_balance)),
        ("Net Receivable from Customer", max(0, -running_balance)),
        ("Total Payments Made", sum(abs(e["debit"]) for e in entries if e["type"] == "Payment" and not e["voided"])),
        ("Total Collections Received", sum(e["credit"] for e in entries if e["type"] == "Collection" and not e["voided"])),
    ]
    for label, val in summary_items:
        ws.write(row, 0, label, fmt_label)
        if isinstance(val, (int, float)) and label != "Total Transactions":
            ws.write(row, 1, val, fmt_money_bold)
        else:
            ws.write(row, 1, val, fmt_value)
        row += 1
    row += 1

    # ── Ledger Line Items ──
    ws.write(row, 0, "Ledger", workbook.add_format({"bold": True, "font_size": 12, "bottom": 1}))
    row += 1
    headers = ["Date", "Txn ID", "Description", "Type", "Debit", "Credit", "Balance", "Commission", "PG Charges", "Gateway", "Notes"]
    for ci, h in enumerate(headers):
        ws.write(row, ci, h, fmt_header)
    row += 1

    for e in entries:
        is_v = e["voided"]
        tf = fmt_voided if is_v else fmt_value
        mf = fmt_voided_money if is_v else fmt_money

        date_str = e["date"][:19].replace("T", " ") if e["date"] else ""
        ws.write(row, 0, date_str, tf)
        ws.write(row, 1, e["txn_id"], tf)
        ws.write(row, 2, e["description"], tf)
        ws.write(row, 3, e["type"], tf)
        ws.write(row, 4, abs(e["debit"]) if e["debit"] else "", mf)
        ws.write(row, 5, e["credit"] if e["credit"] else "", mf)
        bal_fmt = fmt_balance_pos if e["balance"] > 0 else fmt_balance_neg if e["balance"] < 0 else fmt_money
        ws.write(row, 6, e["balance"], bal_fmt if not is_v else fmt_voided_money)
        ws.write(row, 7, e["commission"] if e["commission"] else "", mf)
        ws.write(row, 8, e["pg_charges"] if e["pg_charges"] else "", mf)
        ws.write(row, 9, e["gateway"], tf)
        ws.write(row, 10, e["notes"], tf)
        row += 1

    # ── Footer ──
    row += 1
    ws.write(row, 0, "Closing Balance:", fmt_label)
    bal_fmt = fmt_balance_pos if running_balance > 0 else fmt_balance_neg
    ws.write(row, 1, running_balance, bal_fmt)
    row += 1
    ws.write(row, 0, "Total Debits:", fmt_label)
    ws.write(row, 1, total_debit, fmt_money_bold)
    ws.write(row, 2, "Total Credits:", fmt_label)
    ws.write(row, 3, total_credit, fmt_money_bold)
    row += 2
    ws.write(row, 0, "This is a computer-generated document and does not require a signature.", fmt_footer)

    # Column widths
    ws.set_column(0, 0, 20)  # Date
    ws.set_column(1, 1, 12)  # Txn ID
    ws.set_column(2, 2, 40)  # Description
    ws.set_column(3, 3, 12)  # Type
    ws.set_column(4, 6, 15)  # Debit/Credit/Balance
    ws.set_column(7, 8, 12)  # Commission/PG
    ws.set_column(9, 9, 18)  # Gateway
    ws.set_column(10, 10, 25) # Notes

    try:
        workbook.close()
    finally:
        output.seek(0)

    cust_id = customer.get("customer_id", customer_id[:8])
    from_str = date_from or "all"
    to_str = date_to or "all"
    filename = f"{cust_id}_Ledger_{from_str}_{to_str}.xlsx"

    await log_audit(auth["user"]["id"], auth["user"]["name"], "export", "customer_ledger", customer_id,
                    {"customer": customer.get("name"), "entries": len(entries), "date_range": date_range_str},
                    ip=request.client.host if request.client else "")

    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
